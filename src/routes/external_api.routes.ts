
import { randomBytes } from 'crypto';
import bodyParser from 'body-parser';
import { HistoryHandler, supabase } from "../utils/historyHandler";

/**
 * Helper para registrar logs de la API
 */
async function logApiRequest(data: { 
    token?: string, 
    endpoint: string, 
    status: string, 
    error?: string, 
    req: any 
}) {
    try {
        const origin_url = data.req.headers.origin || data.req.headers.referer || "direct_request";
        const ip_address = data.req.headers['x-forwarded-for'] || data.req.socket.remoteAddress || null;
        
        await supabase.from('api_logs').insert({
            project_id: HistoryHandler.PROJECT_IDENTIFIER,
            token: data.token || null,
            origin_url: origin_url,
            ip_address: ip_address,
            endpoint: data.endpoint,
            status: data.status,
            error_message: data.error || null,
            method: data.req.method
        });
    } catch (err) {
        console.error('⚠️ [API_LOGS] Error guardando log:', err);
    }
}

/**
 * Registra las rutas de la API Externa en la instancia de Express.
 */
export const registerExternalApiRoutes = (app: any, deps: any) => {
    const { adapterProvider, groupProvider } = deps;

    // --- 1. SOLICITUD DE TOKEN DE UN SOLO USO ---
    app.post('/api/v1/auth', bodyParser.json(), async (req: any, res: any) => {
        try {
            const { api_key } = req.body;
            const ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

            // 1. Calcular bloqueo exponencial basado en fallos recientes (últimos 15 min)
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
            const { count: failedAttempts } = await supabase
                .from('api_logs')
                .select('*', { count: 'exact', head: true })
                .eq('endpoint', '/api/v1/auth')
                .eq('status', 'error')
                .eq('ip_address', ip_address)
                .gt('created_at', fifteenMinsAgo);

            const failures = failedAttempts || 0;
            if (failures > 0) {
                const delay = Math.min(30000, Math.pow(2, failures - 1) * 1000);
                console.log(`⏳ [API_AUTH] IP ${ip_address} tiene ${failures} fallos. Aplicando delay de ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
            }

            if (!api_key) {
                await logApiRequest({ endpoint: '/api/v1/auth', status: 'error', error: 'Falta api_key', req });
                return res.status(400).json({ success: false, error: "Falta api_key en la solicitud" });
            }

            // Validar la API KEY contra la base de datos (tabla settings)
            const storedApiKey = await HistoryHandler.getSetting('api_key');
            
            if (!storedApiKey || api_key !== storedApiKey) {
                await logApiRequest({ endpoint: '/api/v1/auth', status: 'error', error: 'API KEY inválida', req });
                return res.status(401).json({ success: false, error: "API KEY inválida" });
            }

            // Generar token único de un solo uso
            const oneTimeToken = randomBytes(32).toString('hex');
            const expiresInMinutes = 5;
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();

            // Guardar en la tabla api_tokens
            const { error } = await supabase
                .from('api_tokens')
                .insert({
                    token: oneTimeToken,
                    expires_at: expiresAt,
                    is_used: false,
                    client_id: HistoryHandler.PROJECT_IDENTIFIER
                });

            if (error) throw error;

            await logApiRequest({ token: oneTimeToken, endpoint: '/api/v1/auth', status: 'success', req });

            return res.json({ 
                success: true, 
                token: oneTimeToken, 
                expires_in: `${expiresInMinutes} minutes` 
            });

        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en /api/auth/token:', err.message);
            await logApiRequest({ endpoint: '/api/auth/token', status: 'error', error: err.message, req });
            return res.status(500).json({ success: false, error: "Error interno del servidor" });
        }
    });

    // --- 2. ENVÍO DE PLANTILLA (USA EL TOKEN) ---
    app.post('/api/v1/send-template', bodyParser.json(), async (req: any, res: any) => {
        const { token, template_id, data, languageCode = 'es' } = req.body;
        
        try {
            if (!token || !template_id || !data || !Array.isArray(data)) {
                await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: 'Datos incompletos', req });
                return res.status(400).json({ success: false, error: "Datos incompletos. Se requiere token, template_id y data (array)." });
            }

            // Límite de seguridad: Máximo 2500 destinatarios por petición
            if (data.length > 2500) {
                await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: 'Exceso de destinatarios', req });
                return res.status(400).json({ success: false, error: "El límite es de 2500 destinatarios por solicitud masiva." });
            }

            // Validar y quemar el token
            const { data: tokenData, error: fetchError } = await supabase
                .from('api_tokens')
                .select('*')
                .eq('token', token)
                .eq('is_used', false)
                .eq('client_id', HistoryHandler.PROJECT_IDENTIFIER) // Validación de scope por proyecto
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            if (fetchError || !tokenData) {
                await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: 'Token inválido o expirado', req });
                return res.status(401).json({ success: false, error: "Token inválido, expirado o ya utilizado." });
            }

            // Marcar como usado inmediatamente (Atomicidad para prevenir Race Condition)
            await supabase.from('api_tokens').update({ is_used: true }).eq('id', tokenData.id);

            // Mapear template_id a templateName
            const provider = adapterProvider.constructor.name === 'MetaCloudProvider' ? adapterProvider : groupProvider;
            if (!provider) {
                return res.status(503).json({ success: false, error: "Proveedor de WhatsApp no inicializado" });
            }

            const templates = await provider.getTemplates();
            // Buscamos por ID (el que pasó el usuario) o por Name (como fallback)
            const foundTemplate = templates.find((t: any) => t.id === template_id || t.name === template_id);

            if (!foundTemplate) {
                await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: `Plantilla no encontrada: ${template_id}`, req });
                return res.status(404).json({ success: false, error: `Plantilla no encontrada: ${template_id}` });
            }

            const templateName = foundTemplate.name;
            const finalLanguage = foundTemplate.language || languageCode || 'es';

            // --- VALIDACIÓN DE VARIABLES ---
            const bodyComponent = foundTemplate.components?.find((c: any) => c.type === 'BODY');
            const templateText = bodyComponent?.text || '';
            const expectedVars = (templateText.match(/\{\{(.+?)\}\}/g) || []).map((v: string) => v.replace(/\{\{|\}\}/g, ''));
            
            // Validar el primer elemento del data como muestra
            if (data.length > 0) {
                const sampleVars = data[0].variables || {};
                const sampleKeys = Object.keys(sampleVars);
                
                // Si la plantilla tiene variables pero el JSON no las tiene o el número no coincide
                if (expectedVars.length !== sampleKeys.length) {
                    const errorMsg = `Estructura de variables inválida. La plantilla '${templateName}' espera ${expectedVars.length} variables: [${expectedVars.join(', ')}]. Tú enviaste ${sampleKeys.length}.`;
                    
                    await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: errorMsg, req });
                    
                    return res.status(400).json({ 
                        success: false, 
                        error: errorMsg,
                        expected_format: {
                            template_id: template_id,
                            data: [
                                {
                                    phone: "54911...",
                                    variables: expectedVars.reduce((acc, curr) => ({ ...acc, [curr]: "valor_ejemplo" }), {})
                                }
                            ]
                        }
                    });
                }
            }

            // Iniciar proceso de envío
            console.log(`🚀 [API_EXTERNAL] Iniciando envío masivo para plantilla: ${templateName} (${finalLanguage}) con ${data.length} destinatarios`);

            await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'success', req });

            // Respondemos 202 (Accepted) para no bloquear al cliente
            res.status(202).json({ 
                success: true, 
                message: `Envío iniciado para ${data.length} contactos.`,
                template_resolved: templateName,
                language_used: finalLanguage,
                job_id: tokenData.id 
            });

            // Proceso en background (Async)
            processExternalBulk(provider, templateName, finalLanguage, data, token);

        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en /api/v1/send-template:', err.message);
            await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: err.message, req });
            if (!res.headersSent) {
                return res.status(500).json({ success: false, error: "Error interno del servidor" });
            }
        }
    });
};

/**
 * Procesa el envío masivo en segundo plano
 */
async function processExternalBulk(provider: any, templateName: string, languageCode: string, data: any[], token?: string) {
    let sent = 0;
    let errors = 0;

    for (const item of data) {
        const { phone, variables } = item;
        
        if (!phone) continue;

        try {
            // El formato esperado de variables es un objeto { nombre: "valor", ... }
            const parameters = variables ? Object.entries(variables).map(([key, value]) => ({
                type: 'text',
                parameter_name: key, // Requerido para plantillas con variables con nombre (Named Parameters)
                text: String(value)
            })) : [];

            const components = parameters.length > 0 ? [{
                type: 'BODY',
                parameters: parameters
            }] : [];

            const resApi = await provider.sendTemplate(phone, templateName, languageCode, components);
            
            if (resApi?.messages) {
                sent++;
                const msgId = resApi.messages[0].id;
                // Guardar en el historial para que el operador lo vea
                await HistoryHandler.saveMessage(phone, 'assistant', `[API Externa: ${templateName}]`, 'text', null, null, msgId);
            } else {
                errors++;
            }
        } catch (e: any) {
            errors++;
            console.error(`❌ [API_EXTERNAL] Error enviando a ${phone}:`, e.message);
        }

        await new Promise(r => setTimeout(r, 250));
    }

    console.log(`✅ [API_EXTERNAL] Envío finalizado: ${sent} éxitos, ${errors} errores.`);
}

