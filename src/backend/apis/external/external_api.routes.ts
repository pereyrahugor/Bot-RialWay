
import { randomBytes } from 'crypto';
import bodyParser from 'body-parser';
import axios from 'axios';
import { HistoryHandler, supabase } from "../../db/historyHandler";

interface MetaConnectSession {
    sessionToken: string;
    projectId: string;
    serviceId: string;
    appId: string;
    appSecret: string;
    configId: string;
    expiresAt: number;
}

const activeMetaSessions = new Map<string, MetaConnectSession>();

// Limpieza periódica de sesiones expiradas
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeMetaSessions.entries()) {
        if (session.expiresAt < now) {
            activeMetaSessions.delete(token);
        }
    }
}, 60000);

/**
 * Helper para registrar logs de la API
 */
async function logApiRequest(data: { 
    token?: string, 
    endpoint: string, 
    status: string, 
    error?: string, 
    req: any,
    projectId?: string,
    serviceId?: string | null
}) {
    try {
        const origin_url = data.req.headers.origin || data.req.headers.referer || "direct_request";
        const ip_address = data.req.headers['x-forwarded-for'] || data.req.socket.remoteAddress || null;
        
        const insertData: any = {
            project_id: data.projectId || HistoryHandler.PROJECT_IDENTIFIER,
            token: data.token || null,
            origin_url: origin_url,
            ip_address: ip_address,
            endpoint: data.endpoint,
            status: data.status,
            error_message: data.error || null,
            method: data.req.method
        };

        const currentServiceId = data.serviceId || HistoryHandler.SERVICE_IDENTIFIER;
        if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
            insertData.service_id = currentServiceId;
        }

        await supabase.from('api_logs').insert(insertData);
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

            // 1. Calcular bloqueo exponencial basado en fallos recientes consecutivos (últimos 15 min)
            const fifteenMinsAgo = new Date(Date.now() - 15 * 60000).toISOString();
            const { data: recentLogs } = await supabase
                .from('api_logs')
                .select('status')
                .eq('endpoint', '/api/v1/auth')
                .eq('ip_address', ip_address)
                .gt('created_at', fifteenMinsAgo)
                .order('created_at', { ascending: false });

            let failures = 0;
            if (recentLogs && recentLogs.length > 0) {
                for (const log of recentLogs) {
                    if (log.status === 'success') {
                        break; // Si la petición fue exitosa, reiniciamos el contador de fallos previos
                    }
                    if (log.status === 'error') {
                        failures++;
                    }
                }
            }

            if (failures > 0) {
                const delay = Math.min(30000, Math.pow(2, failures - 1) * 1000);
                console.log(`⏳ [API_AUTH] IP ${ip_address} tiene ${failures} fallos consecutivos. Aplicando delay de ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
            }

            if (!api_key) {
                await logApiRequest({ endpoint: '/api/v1/auth', status: 'error', error: 'Falta api_key', req });
                return res.status(400).json({ success: false, error: "Falta api_key en la solicitud" });
            }

            // Validar la API KEY contra la base de datos (tabla settings) buscando el tenant correspondiente
            const { data: settingData, error: settingError } = await supabase
                .from('settings')
                .select('project_id, service_id')
                .eq('key', 'api_key')
                .eq('value', api_key)
                .maybeSingle();

            if (settingError || !settingData) {
                await logApiRequest({ endpoint: '/api/v1/auth', status: 'error', error: 'API KEY inválida', req });
                return res.status(401).json({ success: false, error: "API KEY inválida" });
            }

            const resolvedProjectId = settingData.project_id;
            const resolvedServiceId = settingData.service_id;

            // Generar token único de un solo uso
            const oneTimeToken = randomBytes(32).toString('hex');
            const expiresInMinutes = 5;
            const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();

            const insertData: any = {
                token: oneTimeToken,
                expires_at: expiresAt,
                is_used: false,
                client_id: resolvedProjectId
            };
            if (resolvedServiceId && resolvedServiceId !== 'default' && resolvedServiceId !== 'default_service') {
                insertData.service_id = resolvedServiceId;
            }

            // Guardar en la tabla api_tokens
            const { error } = await supabase
                .from('api_tokens')
                .insert(insertData);

            if (error) throw error;

            await logApiRequest({ 
                token: oneTimeToken, 
                endpoint: '/api/v1/auth', 
                status: 'success', 
                req,
                projectId: resolvedProjectId,
                serviceId: resolvedServiceId
            });

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
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            if (fetchError || !tokenData) {
                await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: 'Token inválido o expirado', req });
                return res.status(401).json({ success: false, error: "Token inválido, expirado o ya utilizado." });
            }

            const resolvedProjectId = tokenData.client_id;
            const resolvedServiceId = tokenData.service_id;

            // Marcar como usado inmediatamente (Atomicidad para prevenir Race Condition)
            await supabase.from('api_tokens').update({ is_used: true }).eq('id', tokenData.id);

            // Mapear template_id a templateName
            if (!adapterProvider) {
                return res.status(503).json({ success: false, error: "Proveedor de WhatsApp no inicializado" });
            }

            const isMeta = adapterProvider.constructor.name === 'MetaCloudProvider' || typeof adapterProvider.getTemplates === 'function';
            if (!isMeta) {
                return res.status(400).json({ success: false, error: "El envío de plantillas solo está disponible cuando se utiliza el proveedor de Meta (WhatsApp Business Cloud API)." });
            }
            const provider = adapterProvider;

            const templates = await provider.getTemplates();
            // Buscamos por ID (el que pasó el usuario) o por Name (como fallback)
            const foundTemplate = templates.find((t: any) => t.id === template_id || t.name === template_id);

            if (!foundTemplate) {
                await logApiRequest({ 
                    token, 
                    endpoint: '/api/v1/send-template', 
                    status: 'error', 
                    error: `Plantilla no encontrada: ${template_id}`, 
                    req,
                    projectId: resolvedProjectId,
                    serviceId: resolvedServiceId
                });
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
                    
                    await logApiRequest({ 
                        token, 
                        endpoint: '/api/v1/send-template', 
                        status: 'error', 
                        error: errorMsg, 
                        req,
                        projectId: resolvedProjectId,
                        serviceId: resolvedServiceId
                    });
                    
                    return res.status(400).json({ 
                        success: false, 
                        error: errorMsg,
                        expected_format: {
                            template_id: template_id,
                            data: [
                                {
                                    phone: "54911...",
                                    variables: expectedVars.reduce((acc: any, curr: any) => ({ ...acc, [curr]: "valor_ejemplo" }), {})
                                }
                            ]
                        }
                    });
                }
            }

            // --- VALIDACIÓN Y ENVÍO DEL PRIMER MENSAJE ---
            // Probamos siempre con el primer contacto de la lista. 
            // Si este falla (por ejemplo, error de parámetros), informamos de inmediato al cliente.
            const firstItem = data[0];
            const { phone: firstPhone, variables: firstVars } = firstItem;
            let firstMsgId = null;

            try {
                const parameters = firstVars ? Object.entries(firstVars).map(([key, value]) => ({
                    type: 'text',
                    parameter_name: key,
                    text: String(value)
                })) : [];

                const components = parameters.length > 0 ? [{
                    type: 'BODY',
                    parameters: parameters
                }] : [];

                const resApi = await provider.sendTemplate(firstPhone, templateName, finalLanguage, components, { projectId: resolvedProjectId, serviceId: resolvedServiceId });
                
                if (resApi?.messages) {
                    firstMsgId = resApi.messages[0].id;
                    
                    // Renderizar el texto para el historial
                    let renderedText = templateText;
                    if (firstVars) {
                        for (const [key, value] of Object.entries(firstVars)) {
                            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                            renderedText = renderedText.replace(regex, String(value));
                        }
                    }

                    await HistoryHandler.saveMessage(firstPhone, 'assistant', `[API Externa: ${templateName}]\n${renderedText}`, 'text', null, null, firstMsgId, 'whatsapp', resolvedProjectId, resolvedServiceId || undefined);
                } else {
                    throw new Error("Respuesta vacía o inesperada de Meta");
                }
            } catch (e: any) {
                const metaError = e.response?.data || { message: e.message };
                console.error(`❌ [API_EXTERNAL] Error de validación en el primer envío:`, JSON.stringify(metaError));
                
                await logApiRequest({ 
                    token, 
                    endpoint: '/api/v1/send-template', 
                    status: 'error', 
                    error: JSON.stringify(metaError), 
                    req,
                    projectId: resolvedProjectId,
                    serviceId: resolvedServiceId
                });

                return res.status(400).json({
                    success: false,
                    error: "Error de validación en el envío (petición abortada)",
                    details: metaError,
                    note: "Se abortó el proceso porque el primer mensaje falló. Verifica los parámetros y la plantilla."
                });
            }

            // Registro de éxito inicial
            await logApiRequest({ 
                token, 
                endpoint: '/api/v1/send-template', 
                status: 'success', 
                req,
                projectId: resolvedProjectId,
                serviceId: resolvedServiceId
            });

            // --- RESPUESTA SEGÚN VOLUMEN ---
            if (data.length === 1) {
                // Caso individual exitoso
                return res.json({
                    success: true,
                    message: "Mensaje enviado con éxito",
                    message_id: firstMsgId,
                    template: templateName
                });
            } else {
                // Caso masivo: el primero fue un éxito, el resto va a background
                console.log(`🚀 [API_EXTERNAL] Primer envío exitoso. Iniciando resto del masivo (${data.length - 1} pendientes)`);
                
                res.status(202).json({ 
                    success: true, 
                    message: `Validación exitosa. Iniciando resto del envío masivo (${data.length - 1} restantes).`,
                    template_resolved: templateName,
                    first_message_id: firstMsgId,
                    job_id: tokenData.id 
                });

                // Procesamos el RESTO de la lista (del índice 1 en adelante)
                processExternalBulk(provider, templateName, finalLanguage, data.slice(1), token, templateText, resolvedProjectId, resolvedServiceId);
            }

        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en /api/v1/send-template:', err.message);
            await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: err.message, req });
            if (!res.headersSent) {
                return res.status(500).json({ success: false, error: "Error interno del servidor" });
            }
        }
    });

    // --- 3. ENVÍO DE MENSAJES ESTÁNDAR (USA EL TOKEN) ---
    app.post('/api/v1/send-message', bodyParser.json(), async (req: any, res: any) => {
        const { token, to, type } = req.body;

        try {
            if (!token || !to || !type) {
                await logApiRequest({ token, endpoint: '/api/v1/send-message', status: 'error', error: 'Datos incompletos', req });
                return res.status(400).json({ success: false, error: "Datos incompletos. Se requiere token, to y type." });
            }

            // Validar y quemar el token
            const { data: tokenData, error: fetchError } = await supabase
                .from('api_tokens')
                .select('*')
                .eq('token', token)
                .eq('is_used', false)
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            if (fetchError || !tokenData) {
                await logApiRequest({ token, endpoint: '/api/v1/send-message', status: 'error', error: 'Token inválido o expirado', req });
                return res.status(401).json({ success: false, error: "Token inválido, expirado o ya utilizado." });
            }

            const resolvedProjectId = tokenData.client_id;
            const resolvedServiceId = tokenData.service_id;

            // Marcar como usado inmediatamente (Atomicidad para prevenir Race Condition)
            await supabase.from('api_tokens').update({ is_used: true }).eq('id', tokenData.id);

            const isMeta = adapterProvider && (adapterProvider.constructor.name === 'MetaCloudProvider' || typeof adapterProvider.getTemplates === 'function');
            const provider = isMeta ? adapterProvider : (groupProvider || adapterProvider);
            if (!provider) {
                return res.status(503).json({ success: false, error: "Proveedor de WhatsApp no inicializado" });
            }

            let providerResponse: any = null;
            let historyContent = '';

            const cleanNumber = String(to).split('@')[0].replace(/\D/g, '');
            const targetJid = String(to).includes('@') ? to : `${cleanNumber}@s.whatsapp.net`;

            if (type === 'text') {
                const bodyText = req.body.text?.body || '';
                if (!bodyText) {
                    return res.status(400).json({ success: false, error: "Falta el campo text.body para mensajes de tipo text." });
                }
                providerResponse = await provider.sendMessage(targetJid, bodyText, { projectId: resolvedProjectId, serviceId: resolvedServiceId });
                historyContent = bodyText;
            } else if (type === 'image') {
                const caption = req.body.image?.caption || '';
                const media = req.body.image?.link || req.body.image?.id;
                if (!media) {
                    return res.status(400).json({ success: false, error: "Falta el campo image.link o image.id para mensajes de tipo image." });
                }
                providerResponse = await provider.sendMessage(targetJid, caption, { media, type: 'image', projectId: resolvedProjectId, serviceId: resolvedServiceId });
                historyContent = media;
            } else if (type === 'video') {
                const caption = req.body.video?.caption || '';
                const media = req.body.video?.link || req.body.video?.id;
                if (!media) {
                    return res.status(400).json({ success: false, error: "Falta el campo video.link o video.id para mensajes de tipo video." });
                }
                providerResponse = await provider.sendMessage(targetJid, caption, { media, type: 'video', projectId: resolvedProjectId, serviceId: resolvedServiceId });
                historyContent = media;
            } else if (type === 'document') {
                const caption = req.body.document?.caption || '';
                const media = req.body.document?.link || req.body.document?.id;
                const filename = req.body.document?.filename || 'document';
                if (!media) {
                    return res.status(400).json({ success: false, error: "Falta el campo document.link o document.id para mensajes de tipo document." });
                }
                providerResponse = await provider.sendMessage(targetJid, caption, { media, fileName: filename, type: 'document', projectId: resolvedProjectId, serviceId: resolvedServiceId });
                historyContent = media;
            } else if (type === 'audio') {
                const media = req.body.audio?.link || req.body.audio?.id;
                if (!media) {
                    return res.status(400).json({ success: false, error: "Falta el campo audio.link o audio.id para mensajes de tipo audio." });
                }
                providerResponse = await provider.sendMessage(targetJid, '', { media, type: 'audio', projectId: resolvedProjectId, serviceId: resolvedServiceId });
                historyContent = media;
            } else {
                return res.status(400).json({ success: false, error: `Tipo de message no soportado: ${type}` });
            }

            const externalId = providerResponse?.key?.id || providerResponse?.messages?.[0]?.id || providerResponse?.id || null;

            await HistoryHandler.saveMessage(
                targetJid,
                'assistant',
                historyContent,
                type,
                null,
                null,
                externalId,
                'whatsapp',
                resolvedProjectId,
                resolvedServiceId || undefined
            );

            await logApiRequest({
                token,
                endpoint: '/api/v1/send-message',
                status: 'success',
                req,
                projectId: resolvedProjectId,
                serviceId: resolvedServiceId
            });

            return res.json({
                success: true,
                message: "Mensaje enviado con éxito",
                message_id: externalId
            });

        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en /api/v1/send-message:', err.message);
            await logApiRequest({ token, endpoint: '/api/v1/send-message', status: 'error', error: err.message, req });
            return res.status(500).json({ success: false, error: "Error interno del servidor" });
        }
    });

    // =========================================================================
    // --- 4. META EMBEDDED SIGNUP (ONBOARDING AUTÓNOMO VIA API) ---
    // =========================================================================

    /**
     * Helper para autenticar peticiones API mediante x-api-key, Bearer token o api_key en body/query.
     */
    async function resolveApiAuth(req: any) {
        const apiKey = req.headers['x-api-key'] || req.query.api_key || req.body?.api_key;
        const bearerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        const token = req.query.token || req.body?.token || bearerToken;

        if (apiKey) {
            const { data: settingData } = await supabase
                .from('settings')
                .select('project_id, service_id')
                .eq('key', 'api_key')
                .eq('value', apiKey)
                .maybeSingle();

            if (settingData) {
                return {
                    authorized: true,
                    projectId: settingData.project_id,
                    serviceId: req.body?.service_id || req.query?.service_id || settingData.service_id || 'default_service'
                };
            }
        }

        if (token) {
            const { data: tokenData } = await supabase
                .from('api_tokens')
                .select('*')
                .eq('token', token)
                .gt('expires_at', new Date().toISOString())
                .maybeSingle();

            if (tokenData) {
                return {
                    authorized: true,
                    projectId: tokenData.client_id,
                    serviceId: req.body?.service_id || req.query?.service_id || tokenData.service_id || 'default_service'
                };
            }
        }

        return { authorized: false, projectId: null, serviceId: null };
    }

    /**
     * POST /api/v1/meta/connect-session (y alias /api/v1/connect)
     * Genera una URL segura y temporal con el SDK de Meta para que el cliente vincule su WhatsApp.
     */
    const handleConnectSession = async (req: any, res: any) => {
        try {
            const auth = await resolveApiAuth(req);
            if (!auth.authorized || !auth.projectId) {
                await logApiRequest({ endpoint: '/api/v1/meta/connect-session', status: 'error', error: 'No autorizado o API KEY inválida', req });
                return res.status(401).json({ success: false, error: 'No autorizado. Se requiere api_key válida o token.' });
            }

            const projectId = auth.projectId;
            const serviceId = auth.serviceId || 'default_service';

            const appId = await HistoryHandler.getSetting('META_APP_ID', projectId, serviceId)
                || await HistoryHandler.getConfig('META_APP_ID', projectId, serviceId)
                || process.env.META_APP_ID;

            const appSecret = await HistoryHandler.getSetting('META_APP_SECRET', projectId, serviceId)
                || await HistoryHandler.getConfig('META_APP_SECRET', projectId, serviceId)
                || process.env.META_APP_SECRET;

            const configId = await HistoryHandler.getSetting('META_CONFIG_ID', projectId, serviceId)
                || await HistoryHandler.getConfig('META_CONFIG_ID', projectId, serviceId)
                || process.env.META_CONFIG_ID;

            if (!appId || !appSecret) {
                return res.status(400).json({
                    success: false,
                    error: 'Faltan credenciales de Meta (META_APP_ID / META_APP_SECRET) en la configuración del servidor.'
                });
            }

            const sessionToken = randomBytes(32).toString('hex');
            const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutos de validez

            activeMetaSessions.set(sessionToken, {
                sessionToken,
                projectId,
                serviceId,
                appId,
                appSecret,
                configId: configId || '',
                expiresAt
            });

            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const onboardingUrl = `${protocol}://${host}/onboard/meta?session=${sessionToken}`;

            await logApiRequest({
                endpoint: '/api/v1/meta/connect-session',
                status: 'success',
                req,
                projectId,
                serviceId
            });

            return res.json({
                success: true,
                onboarding_url: onboardingUrl,
                session_token: sessionToken,
                expires_in_seconds: 900
            });
        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en connect-session:', err.message);
            return res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    };

    app.post('/api/v1/meta/connect-session', bodyParser.json(), handleConnectSession);
    app.post('/api/v1/connect', bodyParser.json(), handleConnectSession);

    /**
     * GET /onboard/meta?session=...
     * Renderiza la página web autónoma con el Facebook SDK embebido.
     */
    app.get('/onboard/meta', async (req: any, res: any) => {
        const sessionToken = req.query.session;
        if (!sessionToken) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Error de Sesión</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; text-align: center; max-width: 440px; }
                        h2 { color: #f87171; margin-top: 0; }
                        p { color: #94a3b8; line-height: 1.5; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>⚠️ Sesión No Proporcionada</h2>
                        <p>No se especificó un token de sesión de onboarding válido.</p>
                    </div>
                </body>
                </html>
            `);
        }

        const session = activeMetaSessions.get(sessionToken);
        if (!session || session.expiresAt < Date.now()) {
            return res.status(401).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Sesión Expirada</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                        .card { background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; text-align: center; max-width: 440px; }
                        h2 { color: #f87171; margin-top: 0; }
                        p { color: #94a3b8; line-height: 1.5; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>⏳ Sesión Expirada</h2>
                        <p>El enlace de conexión ha expirado por motivos de seguridad. Por favor, solicita uno nuevo desde tu plataforma.</p>
                    </div>
                </body>
                </html>
            `);
        }

        const html = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vincular WhatsApp Business | Meta Cloud API</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: #f8fafc;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: rgba(30, 41, 59, 0.85);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 40px;
            max-width: 520px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            animation: fadeIn 0.4s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .logo-row {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            margin-bottom: 24px;
        }
        .logo-icon {
            width: 60px;
            height: 60px;
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
            color: white;
            box-shadow: 0 10px 20px rgba(37, 211, 102, 0.3);
        }
        h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
            color: #ffffff;
        }
        .subtitle {
            font-size: 14px;
            color: #94a3b8;
            margin-bottom: 28px;
            line-height: 1.5;
        }
        .features {
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 28px;
            text-align: left;
        }
        .feature-item {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 13.5px;
            color: #cbd5e1;
        }
        .feature-item:last-child { margin-bottom: 0; }
        .feature-item i {
            color: #22c55e;
            font-size: 16px;
        }
        .btn-connect {
            background: linear-gradient(135deg, #25D366 0%, #059669 100%);
            color: white;
            border: none;
            border-radius: 14px;
            padding: 16px 28px;
            font-size: 16px;
            font-weight: 600;
            width: 100%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            box-shadow: 0 10px 25px rgba(37, 211, 102, 0.35);
            transition: all 0.2s ease;
        }
        .btn-connect:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 30px rgba(37, 211, 102, 0.45);
        }
        .btn-connect:active {
            transform: translateY(0);
        }
        .status-box {
            display: none;
            margin-top: 24px;
            padding: 20px;
            border-radius: 16px;
            font-size: 14px;
            line-height: 1.5;
            animation: fadeIn 0.3s ease;
        }
        .status-loading {
            background: rgba(59, 130, 246, 0.15);
            border: 1px solid rgba(59, 130, 246, 0.3);
            color: #93c5fd;
        }
        .status-success {
            background: rgba(34, 197, 94, 0.15);
            border: 1px solid rgba(34, 197, 94, 0.3);
            color: #86efac;
        }
        .status-error {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #fca5a5;
        }
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 0.8s linear infinite;
            vertical-align: middle;
            margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .footer-note {
            margin-top: 24px;
            font-size: 12px;
            color: #64748b;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo-row">
            <div class="logo-icon"><i class="fab fa-whatsapp"></i></div>
        </div>
        <h1>Conectar WhatsApp Business</h1>
        <p class="subtitle">Vincula tu número comercial de forma oficial a través del portal de Meta.</p>

        <div class="features" id="features-box">
            <div class="feature-item"><i class="fas fa-check-circle"></i> Envío y recepción de mensajes en tiempo real</div>
            <div class="feature-item"><i class="fas fa-check-circle"></i> Sincronización oficial con Meta Cloud API</div>
            <div class="feature-item"><i class="fas fa-check-circle"></i> Soporte de plantillas y automatización</div>
        </div>

        <button class="btn-connect" id="btn-connect" onclick="launchWhatsAppSignup()">
            <i class="fab fa-whatsapp" style="font-size: 20px;"></i>
            Conectar con WhatsApp
        </button>

        <div id="status-box" class="status-box"></div>

        <div class="footer-note">
            <i class="fas fa-shield-alt"></i> Conexión cifrada y segura con los servidores de Meta Platforms Inc.
        </div>
    </div>

    <script async defer crossorigin="anonymous" src="https://connect.facebook.net/es_LA/sdk.js"></script>
    <script>
        const SESSION_TOKEN = "${sessionToken}";
        const META_APP_ID = "${session.appId}";
        const META_CONFIG_ID = "${session.configId || ''}";

        let capturedWabaId = null;
        let capturedPhoneId = null;

        window.fbAsyncInit = function() {
            FB.init({
                appId: META_APP_ID,
                autoLogAppEvents: true,
                xfbml: true,
                version: 'v25.0'
            });
            console.log('✅ [Meta SDK] Inicializado correctamente con App ID:', META_APP_ID);
        };

        // Escuchar eventos de mensaje de Meta Embedded Signup
        window.addEventListener('message', function(event) {
            if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (data.type === 'WA_EMBEDDED_SIGNUP') {
                    console.log('📡 [Meta Embedded Signup Event]', data);
                    if (data.event === 'FINISH' || data.event === 'FINISH_ALL') {
                        capturedWabaId = data.data?.waba_id;
                        capturedPhoneId = data.data?.phone_number_id;
                    }
                }
            } catch (e) { /* ignore non-json messages */ }
        });

        function showStatus(type, html) {
            const box = document.getElementById('status-box');
            box.className = 'status-box status-' + type;
            box.innerHTML = html;
            box.style.display = 'block';
        }

        function launchWhatsAppSignup() {
            const btn = document.getElementById('btn-connect');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Abriendo portal de Meta...';
            showStatus('loading', '<span class="spinner"></span> Esperando autorización en el popup de Meta...');

            const loginOptions = {
                response_type: 'code',
                override_default_response_type: true,
                extras: {
                    feature: 'whatsapp_embedded_signup',
                    sessionInfoVersion: '2'
                }
            };

            if (META_CONFIG_ID) {
                loginOptions.config_id = META_CONFIG_ID;
            }

            FB.login(function(response) {
                console.log('📡 [FB.login Response]', response);

                if (response.authResponse && response.authResponse.code) {
                    const code = response.authResponse.code;
                    showStatus('loading', '<span class="spinner"></span> Guardando credenciales y configurando Webhooks...');

                    fetch('/api/v1/meta/onboard-callback', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session: SESSION_TOKEN,
                            code: code,
                            wabaId: capturedWabaId,
                            phoneNumberId: capturedPhoneId
                        })
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            btn.style.display = 'none';
                            document.getElementById('features-box').style.display = 'none';
                            showStatus('success', '<h3>🎉 ¡WhatsApp Vinculado con Éxito!</h3><p style="margin-top:8px;">Tu número de WhatsApp Business ha sido configurado y conectado correctamente. Ya puedes cerrar esta ventana.</p>');
                        } else {
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fab fa-whatsapp" style="font-size: 20px;"></i> Reintentar Conexión';
                            showStatus('error', '❌ Error vinculando con el servidor: ' + (data.error || 'Error desconocido'));
                        }
                    })
                    .catch(err => {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fab fa-whatsapp" style="font-size: 20px;"></i> Reintentar Conexión';
                        showStatus('error', '❌ Error de comunicación con el servidor: ' + err.message);
                    });
                } else {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fab fa-whatsapp" style="font-size: 20px;"></i> Conectar con WhatsApp';
                    showStatus('error', '⚠️ No se completó la autorización en Meta. Por favor, intenta de nuevo.');
                }
            }, loginOptions);
        }
    </script>
</body>
</html>
        `;

        return res.send(html);
    });

    /**
     * POST /api/v1/meta/onboard-callback
     * Intercambia el código de autorización por el Access Token de Meta y suscribe los webhooks.
     */
    app.post('/api/v1/meta/onboard-callback', bodyParser.json(), async (req: any, res: any) => {
        const { session, code, wabaId, phoneNumberId, verifiedName } = req.body;
        if (!session) {
            return res.status(400).json({ success: false, error: 'Falta token de sesión' });
        }

        const metaSession = activeMetaSessions.get(session);
        if (!metaSession || metaSession.expiresAt < Date.now()) {
            return res.status(401).json({ success: false, error: 'Sesión de onboarding inválida o expirada' });
        }

        const { projectId, serviceId, appId, appSecret } = metaSession;

        try {
            let accessToken = '';
            let finalWabaId = wabaId;
            let finalPhoneId = phoneNumberId;
            let finalVerifiedName = verifiedName || '';

            if (code) {
                console.log(`📡 [API_CONNECT] Intercambiando code por Access Token para Proyecto: ${projectId}...`);
                const tokenRes = await axios.get('https://graph.facebook.com/v25.0/oauth/access_token', {
                    params: {
                        client_id: appId,
                        client_secret: appSecret,
                        code: code
                    }
                });
                accessToken = tokenRes.data?.access_token;
            }

            if (!accessToken) {
                return res.status(400).json({ success: false, error: 'No se pudo obtener el Access Token de Meta' });
            }

            // Suscribir Webhooks de la WABA (messages y smb_message_echoes)
            if (finalWabaId) {
                try {
                    await axios.post(`https://graph.facebook.com/v25.0/${finalWabaId}/subscribed_apps`,
                        { override_callback_uri: undefined },
                        {
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            params: { subscribed_fields: 'messages,smb_message_echoes' }
                        }
                    );
                    console.log(`✅ [API_CONNECT] WABA ${finalWabaId} suscrita exitosamente a Webhooks.`);
                } catch (subErr: any) {
                    console.warn('⚠️ [API_CONNECT] Error en suscripción de webhooks:', subErr.response?.data || subErr.message);
                }
            }

            // Guardar credenciales en Supabase de forma multi-tenant
            await HistoryHandler.saveMetaOnboardingData(
                finalWabaId,
                finalPhoneId,
                accessToken,
                { verified_name: finalVerifiedName, source: 'api-v1-connect', connected_at: new Date().toISOString() },
                projectId,
                serviceId
            );

            // Eliminar sesión utilizada
            activeMetaSessions.delete(session);

            return res.json({
                success: true,
                message: 'WhatsApp Business conectado con éxito',
                waba_id: finalWabaId,
                phone_number_id: finalPhoneId
            });
        } catch (err: any) {
            console.error('❌ [API_CONNECT] Error en onboard-callback:', err.response?.data || err.message);
            const detail = err.response?.data?.error?.message || err.message;
            return res.status(500).json({ success: false, error: `Error procesando conexión con Meta: ${detail}` });
        }
    });

    /**
     * GET /api/v1/meta/status (y POST /api/v1/meta/status)
     * Consulta el estado actual de la conexión de WhatsApp Business para este tenant.
     */
    const handleMetaStatus = async (req: any, res: any) => {
        try {
            const auth = await resolveApiAuth(req);
            if (!auth.authorized || !auth.projectId) {
                return res.status(401).json({ success: false, error: 'No autorizado. Se requiere api_key válida o token.' });
            }

            const projectId = auth.projectId;
            const serviceId = auth.serviceId || 'default_service';

            const { data: onboardingData } = await supabase
                .from('meta_onboarding')
                .select('waba_id, phone_number_id, onboarding_data, updated_at')
                .eq('project_id', projectId)
                .maybeSingle();

            if (!onboardingData || !onboardingData.waba_id) {
                return res.json({
                    success: true,
                    connected: false,
                    message: 'No hay credenciales de Meta registradas para este servicio.'
                });
            }

            return res.json({
                success: true,
                connected: true,
                data: {
                    waba_id: onboardingData.waba_id,
                    phone_number_id: onboardingData.phone_number_id,
                    verified_name: onboardingData.onboarding_data?.verified_name || null,
                    updated_at: onboardingData.updated_at
                }
            });
        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en meta status:', err.message);
            return res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    };

    app.get('/api/v1/meta/status', handleMetaStatus);
    app.post('/api/v1/meta/status', bodyParser.json(), handleMetaStatus);
};

/**
 * Procesa el envío masivo en segundo plano
 */
async function processExternalBulk(
    provider: any, 
    templateName: string, 
    languageCode: string, 
    data: any[], 
    token?: string, 
    templateText: string = '',
    projectId?: string,
    serviceId?: string | null
) {
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

            const resApi = await provider.sendTemplate(phone, templateName, languageCode, components, { isBulk: true, projectId, serviceId });
            
            if (resApi?.messages) {
                sent++;
                const msgId = resApi.messages[0].id;
                
                // Renderizar para el historial
                let renderedText = templateText;
                if (variables) {
                    for (const [key, value] of Object.entries(variables)) {
                        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                        renderedText = renderedText.replace(regex, String(value));
                    }
                }

                // Guardar en el historial para que el operador lo vea
                await HistoryHandler.saveMessage(phone, 'assistant', `[API Externa: ${templateName}]\n${renderedText}`, 'text', null, null, msgId, 'whatsapp', projectId, serviceId || undefined);
            } else {
                errors++;
            }
        } catch (e: any) {
            errors++;
            const errorDetail = e.response?.data || e.message;
            console.error(`❌ [API_EXTERNAL] Error enviando a ${phone}:`, JSON.stringify(errorDetail));
        }

        await new Promise(r => setTimeout(r, 250));
    }

    console.log(`... [API_EXTERNAL] Envío finalizado: ${sent} éxitos, ${errors} errores.`);
}

