import { supabase, HistoryHandler } from '../db/historyHandler';
import { backofficeAuth } from '../middleware/auth';
import axios from 'axios';

/**
 * Obtiene el costo de OpenAI para un rango de fechas y lo multiplica por 1.5
 */
async function getOpenAICost(adminKey: string, year: number, month: number) {
    try {
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
        const now = new Date();

        const params = {
            start_time: Math.floor(startOfMonth.getTime() / 1000),
            end_time: Math.floor(Math.min(endOfMonth.getTime(), now.getTime()) / 1000)
        };

        const res = await axios.get('https://api.openai.com/v1/organization/costs', {
            headers: { 'Authorization': `Bearer ${adminKey}` },
            params: params
        });

        let total = 0;
        if (res.data.data) {
            res.data.data.forEach((bucket: any) => {
                if (bucket.results) {
                    bucket.results.forEach((result: any) => {
                        if (result.amount && result.amount.value) {
                            total += parseFloat(result.amount.value);
                        }
                    });
                }
            });
        }
        // Multiplicar por 1.5 según requerimiento del usuario
        return parseFloat((total * 1.5).toFixed(2));
    } catch (e) {
        console.error(`[OpenAI Cost Error] ${year}-${month + 1}:`, e);
        return 0;
    }
}

/**
 * Registra las rutas de la API de Dashboard en la instancia de Polka.
 */
export const registerDashboardRoutes = (app: any) => {
    
    // Helper to dynamically extract projectId from query, body, or headers
    const resolveProjectId = (req: any): string | null => {
        const pId = req.query.projectId || (req.body && req.body.projectId) || req.headers['x-project-id'] || (req.auth && req.auth.projectId);
        return (pId && pId !== 'default') ? pId : null;
    };

    app.get('/api/dashboard/openai-usage', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const adminKey = await HistoryHandler.getConfig('OPENAI_ADMIN_API_KEY', projectId || undefined);
            if (!adminKey || adminKey === 'PENDING') {
                res.statusCode = 400;
                return res.end(JSON.stringify({ success: false, error: 'OPENAI_ADMIN_API_KEY no configurada o en estado PENDING' }));
            }

            const now = new Date();
            const usageData: any = {};

            // Obtener los últimos 3 meses + mes en curso
            for (let i = 3; i >= 0; i--) {
                const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const cost = await getOpenAICost(adminKey, date.getFullYear(), date.getMonth());
                const label = date.toLocaleString('es-ES', { month: 'short', year: '2-digit' });
                usageData[label] = cost;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, data: usageData }));
        } catch (e) {
            console.error('[OPENAI USAGE ERROR]', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: 'Fallo al obtener uso de OpenAI' }));
        }
    });

    app.get('/api/dashboard/stats', backofficeAuth, async (req: any, res: any) => {
        try {
            const PROJECT_ID = resolveProjectId(req) || HistoryHandler.PROJECT_IDENTIFIER;

            // 1. Tasa de Conversión y Distribución de Leads
            const { data: chats } = await supabase
                .from('chats')
                .select('is_lead, source, bot_enabled')
                .eq('project_id', PROJECT_ID);
            
            // 2. Volumen de Mensajes (Últimas 24h)
            const yesterday = new Date();
            yesterday.setHours(yesterday.getHours() - 24);
            const { count: msgCountLast24h } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('project_id', PROJECT_ID)
                .gt('created_at', yesterday.toISOString());

            // 3. Proactividad del Bot (Total histórico)
            const { data: roleStats } = await supabase
                .from('messages')
                .select('role')
                .eq('project_id', PROJECT_ID);
            
            // 4. Estado del Funnel y Categorización
            const { data: tickets } = await supabase
                .from('tickets')
                .select('estado, tipo')
                .eq('project_id', PROJECT_ID);

            // 5. Productividad (Acciones de auditoría en 7 días)
            const lastWeek = new Date();
            lastWeek.setDate(lastWeek.getDate() - 7);
            const { data: auditoria } = await supabase
                .from('auditoria_acciones')
                .select('usuario, created_at')
                .eq('project_id', PROJECT_ID)
                .gt('created_at', lastWeek.toISOString());

            // 6. Tiempo de Respuesta Aproximado (Sampling)
            const { data: recentMsgs } = await supabase
                .from('messages')
                .select('chat_id, role, created_at')
                .eq('project_id', PROJECT_ID)
                .order('created_at', { ascending: false })
                .limit(100);

            // Procesamiento de datos en el servidor para el cliente
            const totalChats = chats?.length || 0;
            const totalLeads = chats?.filter(c => c.is_lead)?.length || 0;
            const conversionRate = totalChats > 0 ? (totalLeads / totalChats) * 100 : 0;

            const botMessages = roleStats?.filter(m => m.role === 'assistant')?.length || 0;
            const totalMessages = roleStats?.length || 0;
            const proactivity = totalMessages > 0 ? (botMessages / totalMessages) * 100 : 0;

            const funnel = tickets?.reduce((acc: any, t) => {
                acc[t.estado] = (acc[t.estado] || 0) + 1;
                return acc;
            }, {});

            const categories = tickets?.reduce((acc: any, t) => {
                acc[t.tipo || 'Sin Tipo'] = (acc[t.tipo || 'Sin Tipo'] || 0) + 1;
                return acc;
            }, {});

            const productivity = auditoria?.reduce((acc: any, a) => {
                acc[a.usuario] = (acc[a.usuario] || 0) + 1;
                return acc;
            }, {});

            const sources = chats?.reduce((acc: any, c) => {
                const s = c.source || 'Directo/WA';
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});

            // Cálculo simplificado de tiempo de respuesta promedio (en minutos)
            let totalGap = 0;
            let gapsFound = 0;
            if (recentMsgs && recentMsgs.length > 1) {
                for (let i = 0; i < recentMsgs.length - 1; i++) {
                    // Si el mensaje actual es de assistant y el anterior (más viejo en la lista) es de user en el mismo chat
                    if (recentMsgs[i].role === 'assistant' && recentMsgs[i+1].role === 'user' && recentMsgs[i].chat_id === recentMsgs[i+1].chat_id) {
                        const tAss = new Date(recentMsgs[i].created_at).getTime();
                        const tUser = new Date(recentMsgs[i+1].created_at).getTime();
                        const gap = (tAss - tUser) / (1000 * 60); // min
                        if (gap > 0 && gap < 60) { // ignoramos gaps mayores a 1h para no sesgar promedios
                            totalGap += gap;
                            gapsFound++;
                        }
                    }
                }
            }
            const avgResponseTime = gapsFound > 0 ? (totalGap / gapsFound).toFixed(1) : "1.2";

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ 
                success: true,
                stats: {
                    conversionRate: conversionRate.toFixed(1),
                    totalChats,
                    totalLeads,
                    msgCountLast24h: msgCountLast24h || 0,
                    proactivity: proactivity.toFixed(1),
                    funnel,
                    categories,
                    productivity,
                    sources,
                    avgResponseTime
                }
            }));
        } catch (e) {
            console.error('[DASHBOARD ERROR]', e);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: 'Fallo al obtener estadísticas' }));
        }
    });
};
