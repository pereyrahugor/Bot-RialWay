import { supabase } from '../utils/historyHandler';
import { backofficeAuth } from '../middleware/auth';

/**
 * Registra las rutas de la API de Dashboard en la instancia de Polka.
 */
export const registerDashboardRoutes = (app: any) => {
    
    app.get('/api/dashboard/stats', backofficeAuth, async (req: any, res: any) => {
        try {
            // 1. Tasa de Conversión y Distribución de Leads
            const { data: chats } = await supabase
                .from('chats')
                .select('is_lead, source, bot_enabled');
            
            // 2. Volumen de Mensajes (Últimas 24h)
            const yesterday = new Date();
            yesterday.setHours(yesterday.getHours() - 24);
            const { count: msgCountLast24h } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .gt('created_at', yesterday.toISOString());

            // 3. Proactividad del Bot (Total histórico)
            const { data: roleStats } = await supabase
                .from('messages')
                .select('role');
            
            // 4. Estado del Funnel y Categorización
            const { data: tickets } = await supabase
                .from('tickets')
                .select('estado, tipo');

            // 5. Productividad (Acciones de auditoría en 7 días)
            const lastWeek = new Date();
            lastWeek.setDate(lastWeek.getDate() - 7);
            const { data: auditoria } = await supabase
                .from('auditoria_acciones')
                .select('usuario, created_at')
                .gt('created_at', lastWeek.toISOString());

            // 6. Tiempo de Respuesta Aproximado (Sampling)
            // Tomamos los últimos 50 mensajes y calculamos el gap promedio entre user y assistant
            const { data: recentMsgs } = await supabase
                .from('messages')
                .select('chat_id, role, created_at')
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
