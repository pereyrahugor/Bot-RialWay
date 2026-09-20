
import { randomBytes, createHmac } from 'crypto';
import bodyParser from 'body-parser';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { upload } from '../../middleware/upload';
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

const TOKEN_SIGN_SECRET = process.env.API_TOKEN_SECRET || process.env.JWT_SECRET || process.env.SUPABASE_KEY || 'rialway_api_token_signature_secret_2026';

/**
 * Genera un token firmado criptográficamente que contiene el service_id emisor.
 * Formato: tk_${serviceId}_${randomPart}_${signature}
 */
function generateSignedApiToken(serviceId: string, projectId: string): string {
    const cleanServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER || 'default_service';
    const cleanProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER || 'default';
    const randomPart = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', TOKEN_SIGN_SECRET)
        .update(`${cleanServiceId}:${cleanProjectId}:${randomPart}`)
        .digest('hex')
        .substring(0, 16);
    return `tk_${cleanServiceId}_${randomPart}_${signature}`;
}

interface TokenValidationResult {
    valid: boolean;
    statusCode: number;
    error?: string;
    tokenData?: any;
    projectId?: string;
    serviceId?: string;
}

/**
 * Valida un token verificando la firma del service_id, la no expiración, y que corresponda a la instancia actual.
 */
async function verifyAndValidateApiToken(
    token: string,
    options: { burn?: boolean; endpoint: string; req: any }
): Promise<TokenValidationResult> {
    const { burn = false, endpoint, req } = options;
    if (!token) {
        return { valid: false, statusCode: 400, error: 'Falta token de autenticación.' };
    }

    const currentServiceId = HistoryHandler.SERVICE_IDENTIFIER;
    const currentProjectId = HistoryHandler.PROJECT_IDENTIFIER;

    // 1. Verificar estructura del token con firma de service_id: tk_${serviceId}_${randomPart}_${signature}
    const tokenMatch = String(token).match(/^tk_([a-zA-Z0-9_-]+)_([a-f0-9]{32})_([a-f0-9]{16})$/);

    if (tokenMatch) {
        const tokenServiceId = tokenMatch[1];
        // Comprobación de cruce de instancias antes de consultar base de datos
        if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
            if (tokenServiceId !== currentServiceId) {
                const errorMsg = `Acceso denegado: El token fue generado para el servicio '${tokenServiceId}', pero esta solicitud fue recibida por la instancia del servicio '${currentServiceId}'. Cada servicio debe enviar sus peticiones al dominio/URL correspondiente a su propia instancia.`;
                await logApiRequest({ token, endpoint, status: 'error', error: errorMsg, req, serviceId: currentServiceId, projectId: currentProjectId });
                return { valid: false, statusCode: 403, error: errorMsg };
            }
        }
    }

    // 2. Consulta en la tabla api_tokens (cumpliendo estricto filtrado multi-tenant y multi-servicio)
    let query = supabase
        .from('api_tokens')
        .select('*')
        .eq('token', token)
        .eq('is_used', false)
        .gt('expires_at', new Date().toISOString());

    if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
        query = query.eq('service_id', currentServiceId);
    }

    const { data: tokenData, error: fetchError } = await query.maybeSingle();

    if (fetchError || !tokenData) {
        // Diagnóstico para mensaje de error preciso si el token existe en otra instancia o está expirado/usado
        const { data: anyToken } = await supabase
            .from('api_tokens')
            .select('*')
            .eq('token', token)
            .maybeSingle();

        if (anyToken) {
            if (anyToken.service_id && currentServiceId && anyToken.service_id !== currentServiceId) {
                const crossMsg = `Acceso denegado: El token pertenece al servicio '${anyToken.service_id}', pero se intentó utilizar en la instancia '${currentServiceId}'.`;
                await logApiRequest({ token, endpoint, status: 'error', error: crossMsg, req, serviceId: currentServiceId, projectId: anyToken.client_id });
                return { valid: false, statusCode: 403, error: crossMsg };
            }
            if (anyToken.is_used) {
                await logApiRequest({ token, endpoint, status: 'error', error: 'Token ya utilizado', req, serviceId: anyToken.service_id, projectId: anyToken.client_id });
                return { valid: false, statusCode: 401, error: 'Token inválido: ya fue utilizado.' };
            }
            if (new Date(anyToken.expires_at) <= new Date()) {
                await logApiRequest({ token, endpoint, status: 'error', error: 'Token expirado', req, serviceId: anyToken.service_id, projectId: anyToken.client_id });
                return { valid: false, statusCode: 401, error: 'Token expirado (validez máxima de 5 minutos).' };
            }
        }

        await logApiRequest({ token, endpoint, status: 'error', error: 'Token inválido o expirado', req });
        return { valid: false, statusCode: 401, error: 'Token inválido, expirado o ya utilizado.' };
    }

    // 3. Verificación criptográfica de la firma del token si tiene el formato firmado
    if (tokenMatch) {
        const tokenServiceId = tokenMatch[1];
        const randomPart = tokenMatch[2];
        const providedSignature = tokenMatch[3];
        const expectedSignature = createHmac('sha256', TOKEN_SIGN_SECRET)
            .update(`${tokenData.service_id || tokenServiceId}:${tokenData.client_id}:${randomPart}`)
            .digest('hex')
            .substring(0, 16);

        if (providedSignature !== expectedSignature) {
            const sigMsg = 'Firma criptográfica del token inválida o adulterada.';
            await logApiRequest({ token, endpoint, status: 'error', error: sigMsg, req, serviceId: tokenData.service_id, projectId: tokenData.client_id });
            return { valid: false, statusCode: 401, error: sigMsg };
        }
    }

    // 4. Si se solicita quemar el token (un solo uso), se marca como usado
    if (burn) {
        await supabase.from('api_tokens').update({ is_used: true }).eq('id', tokenData.id);
    }

    return {
        valid: true,
        statusCode: 200,
        tokenData,
        projectId: tokenData.client_id,
        serviceId: tokenData.service_id || currentServiceId
    };
}

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
 * Helper para decodificar y guardar archivos Base64 en uploads/
 */
function saveBase64Media(base64Data: string, rawFilename?: string, fallbackType: string = 'document'): { filePath: string, filename: string, serverFileName: string, mimeType: string } {
    let cleanBase64 = String(base64Data || '').trim();
    let detectedMime = '';

    if (cleanBase64.includes(';base64,')) {
        const parts = cleanBase64.split(';base64,');
        detectedMime = parts[0].replace(/^data:/, '').trim();
        cleanBase64 = parts[1].trim();
    }

    const buffer = Buffer.from(cleanBase64, 'base64');
    
    let ext = '';
    if (rawFilename && path.extname(rawFilename)) {
        ext = path.extname(rawFilename);
    } else if (detectedMime) {
        if (detectedMime.includes('pdf')) ext = '.pdf';
        else if (detectedMime.includes('jpeg') || detectedMime.includes('jpg')) ext = '.jpg';
        else if (detectedMime.includes('png')) ext = '.png';
        else if (detectedMime.includes('webp')) ext = '.webp';
        else if (detectedMime.includes('mp4')) ext = '.mp4';
        else if (detectedMime.includes('ogg')) ext = '.ogg';
        else if (detectedMime.includes('mp3') || detectedMime.includes('mpeg')) ext = '.mp3';
        else if (detectedMime.includes('excel') || detectedMime.includes('spreadsheet')) ext = '.xlsx';
    }
    if (!ext) {
        if (fallbackType === 'image') ext = '.jpg';
        else if (fallbackType === 'video') ext = '.mp4';
        else if (fallbackType === 'audio') ext = '.mp3';
        else ext = '.pdf';
    }

    if (!detectedMime) {
        if (ext === '.pdf') detectedMime = 'application/pdf';
        else if (ext === '.jpg' || ext === '.jpeg') detectedMime = 'image/jpeg';
        else if (ext === '.png') detectedMime = 'image/png';
        else if (ext === '.webp') detectedMime = 'image/webp';
        else if (ext === '.mp4') detectedMime = 'video/mp4';
        else if (ext === '.mp3') detectedMime = 'audio/mpeg';
        else if (ext === '.ogg') detectedMime = 'audio/ogg';
        else detectedMime = 'application/octet-stream';
    }

    const safeBaseName = rawFilename ? path.basename(rawFilename, path.extname(rawFilename)).replace(/[^a-zA-Z0-9_-]/g, '_') : `file_${Date.now()}`;
    const filename = `${safeBaseName}${ext}`;
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
    const tempFileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${filename}`;
    const filePath = path.join(uploadDir, tempFileName);
    fs.writeFileSync(filePath, buffer);

    return { filePath, filename, serverFileName: tempFileName, mimeType: detectedMime };
}

/**
 * Sube un archivo local a Meta Cloud API o genera su URL pública de descarga como fallback
 */
async function uploadOrLinkLocalFile(
    localPath: string,
    mimeType: string,
    filename: string,
    formatType: string,
    provider: any,
    projectId: string,
    serviceId?: string | null,
    serverFileName?: string
): Promise<any> {
    let uploadedMediaId: string | null = null;
    try {
        const tenantOnboarding = await HistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
        const tenantSendConfig = {
            phone_number_id: tenantOnboarding?.phoneNumberId || tenantOnboarding?.whatsappNumberId || tenantOnboarding?.phone_number_id || provider.config?.phone_number_id,
            access_token: tenantOnboarding?.whatsappToken || tenantOnboarding?.access_token || provider.config?.access_token
        };
        if (typeof provider.uploadMedia === 'function') {
            uploadedMediaId = await provider.uploadMedia(localPath, mimeType, filename, tenantSendConfig);
        }
    } catch (upErr: any) {
        console.warn('⚠️ [API_EXTERNAL] Falló subida directa a Meta, usando fallback de link local:', upErr.message);
    }

    if (uploadedMediaId) {
        const mediaParam: any = { id: uploadedMediaId };
        if (formatType === 'document') mediaParam.filename = filename;
        return {
            type: 'HEADER',
            parameters: [{ type: formatType, [formatType]: mediaParam }]
        };
    }

    // Fallback: Servir con URL local pública si no se pudo subir directamente a Meta
    let baseUrl = process.env.PROJECT_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
    if (baseUrl && !baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
    const publicName = serverFileName || filename;
    const mediaParam: any = { link: `${baseUrl.replace(/\/$/, '')}/uploads/${publicName}` };
    if (formatType === 'document') mediaParam.filename = filename;
    return {
        type: 'HEADER',
        parameters: [{ type: formatType, [formatType]: mediaParam }]
    };
}

/**
 * Resuelve y genera el componente HEADER para plantillas multimedia (documento, imagen, video)
 */
async function buildTemplateHeaderComponent(
    headerFormat: string | undefined,
    itemMedia: any,
    rootMedia: any,
    provider: any,
    projectId: string,
    serviceId?: string | null
): Promise<any | null> {
    if (!headerFormat) return null;
    const formatUpper = String(headerFormat).toUpperCase();
    if (!['DOCUMENT', 'IMAGE', 'VIDEO'].includes(formatUpper)) return null;

    const mediaSource = itemMedia || rootMedia;
    if (!mediaSource) return null;

    const formatType = formatUpper.toLowerCase(); // 'document' | 'image' | 'video'
    let rawLink = typeof mediaSource === 'string' ? mediaSource : (mediaSource.link || mediaSource.url || null);
    const base64Data = typeof mediaSource === 'object' ? (mediaSource.base64 || mediaSource.data) : null;
    const directMediaId = typeof mediaSource === 'object' ? mediaSource.id : null;
    let customFilename = typeof mediaSource === 'object' ? (mediaSource.filename || mediaSource.fileName || mediaSource.name) : undefined;

    // Si es un string que parece base64 directo
    if (typeof mediaSource === 'string' && !mediaSource.startsWith('http://') && !mediaSource.startsWith('https://') && mediaSource.length > 100) {
        const decoded = saveBase64Media(mediaSource, customFilename, formatType);
        return await uploadOrLinkLocalFile(decoded.filePath, decoded.mimeType, decoded.filename, formatType, provider, projectId, serviceId, decoded.serverFileName);
    }

    // 1. Media ID de Meta ya generado
    if (directMediaId) {
        const mediaParam: any = { id: String(directMediaId) };
        if (formatType === 'document' && customFilename) mediaParam.filename = customFilename;
        return {
            type: 'HEADER',
            parameters: [{ type: formatType, [formatType]: mediaParam }]
        };
    }

    // 2. Base64
    if (base64Data) {
        const decoded = saveBase64Media(base64Data, customFilename, formatType);
        return await uploadOrLinkLocalFile(decoded.filePath, decoded.mimeType, decoded.filename, formatType, provider, projectId, serviceId, decoded.serverFileName);
    }

    // 3. Link / URL directa
    if (rawLink) {
        if (!customFilename && formatType === 'document') {
            try {
                const urlPath = new URL(rawLink).pathname;
                customFilename = path.basename(urlPath);
            } catch (_) {
                customFilename = 'documento.pdf';
            }
        }
        const mediaParam: any = { link: rawLink };
        if (formatType === 'document' && customFilename) mediaParam.filename = customFilename;
        return {
            type: 'HEADER',
            parameters: [{ type: formatType, [formatType]: mediaParam }]
        };
    }

    return null;
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
            const currentServiceId = HistoryHandler.SERVICE_IDENTIFIER;
            const currentProjectId = HistoryHandler.PROJECT_IDENTIFIER;

            let settingQuery = supabase
                .from('settings')
                .select('project_id, service_id')
                .eq('key', 'api_key')
                .eq('value', api_key);

            // Filtrado estricto multi-tenant y multi-servicio
            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                settingQuery = settingQuery.eq('service_id', currentServiceId);
            }

            const { data: settingData, error: settingError } = await settingQuery.maybeSingle();

            if (settingError || !settingData) {
                // Diagnóstico para detectar si la API KEY pertenece a otra instancia del proyecto
                const { data: crossSetting } = await supabase
                    .from('settings')
                    .select('project_id, service_id')
                    .eq('key', 'api_key')
                    .eq('value', api_key)
                    .maybeSingle();

                if (crossSetting && crossSetting.service_id && currentServiceId && crossSetting.service_id !== currentServiceId) {
                    const crossMsg = `API KEY pertenece al servicio '${crossSetting.service_id}', pero esta solicitud fue enviada a la instancia del servicio '${currentServiceId}'. Debe solicitar la autenticación en la URL correspondiente a su propio servicio.`;
                    await logApiRequest({ endpoint: '/api/v1/auth', status: 'error', error: crossMsg, req, serviceId: currentServiceId, projectId: crossSetting.project_id });
                    return res.status(403).json({ success: false, error: crossMsg });
                }

                await logApiRequest({ endpoint: '/api/v1/auth', status: 'error', error: 'API KEY inválida', req, serviceId: currentServiceId, projectId: currentProjectId });
                return res.status(401).json({ success: false, error: "API KEY inválida" });
            }

            const resolvedProjectId = settingData.project_id;
            const resolvedServiceId = settingData.service_id || currentServiceId;

            // Generar token único de un solo uso firmado con el service_id
            const oneTimeToken = generateSignedApiToken(resolvedServiceId, resolvedProjectId);
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
    app.post('/api/v1/send-template', bodyParser.json({ limit: '50mb' }), async (req: any, res: any) => {
        const { token, template_id, data, document, media, languageCode = 'es' } = req.body;
        
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

            // Validar y quemar el token con firma de service_id
            const authResult = await verifyAndValidateApiToken(token, { burn: true, endpoint: '/api/v1/send-template', req });
            if (!authResult.valid) {
                return res.status(authResult.statusCode).json({ success: false, error: authResult.error });
            }

            const tokenData = authResult.tokenData;
            const resolvedProjectId = authResult.projectId;
            const resolvedServiceId = authResult.serviceId;

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

            // --- VALIDACIÓN DE CABECERA MULTIMEDIA (HEADER) ---
            const headerComponentDef = foundTemplate.components?.find((c: any) => c.type === 'HEADER');
            const headerFormat = headerComponentDef?.format; // 'DOCUMENT' | 'IMAGE' | 'VIDEO'
            const requiresMediaHeader = ['DOCUMENT', 'IMAGE', 'VIDEO'].includes(String(headerFormat || '').toUpperCase());

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

                // Validar si la plantilla exige archivo multimedia en la cabecera
                if (requiresMediaHeader) {
                    const sampleMedia = data[0]?.document || data[0]?.media || data[0]?.header || document || media;
                    if (!sampleMedia) {
                        const errorMsg = `La plantilla '${templateName}' requiere un archivo multimedia en la cabecera (${headerFormat}). Debes incluir 'document' con { link: "https://..." } o { base64: "...", filename: "archivo.pdf" }.`;
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
                                document: {
                                    link: "https://tudominio.com/archivo.pdf",
                                    filename: "Comprobante.pdf"
                                },
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

                const components: any[] = [];

                if (requiresMediaHeader) {
                    const headerComp = await buildTemplateHeaderComponent(
                        headerFormat,
                        firstItem.document || firstItem.media || firstItem.header,
                        document || media,
                        provider,
                        resolvedProjectId,
                        resolvedServiceId
                    );
                    if (headerComp) {
                        components.push(headerComp);
                    }
                }

                if (parameters.length > 0) {
                    components.push({
                        type: 'BODY',
                        parameters: parameters
                    });
                }

                console.log(`🚀 [API_EXTERNAL] /api/v1/send-template -> Enviando plantilla "${templateName}" a ${firstPhone} (Lote: ${data.length} contacto(s))`);

                const resApi = await provider.sendTemplate(firstPhone, templateName, finalLanguage, components, { projectId: resolvedProjectId, serviceId: resolvedServiceId });
                
                if (resApi?.messages) {
                    firstMsgId = resApi.messages[0].id;
                    console.log(`✅ [API_EXTERNAL] /api/v1/send-template -> Aceptado por Meta para ${firstPhone}. WAMID: ${firstMsgId}`);
                    
                    // Renderizar el texto para el historial
                    let renderedText = templateText;
                    if (firstVars) {
                        for (const [key, value] of Object.entries(firstVars)) {
                            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                            renderedText = renderedText.replace(regex, String(value));
                        }
                    }

                    const firstMediaInfo = firstItem.document || firstItem.media || document || media;
                    const mediaName = typeof firstMediaInfo === 'object' ? (firstMediaInfo.filename || firstMediaInfo.link || 'archivo') : '';
                    const historyPrefix = mediaName ? `[API Externa: ${templateName} | Adjunto: ${mediaName}]` : `[API Externa: ${templateName}]`;

                    await HistoryHandler.saveMessage(firstPhone, 'assistant', `${historyPrefix}\n${renderedText}`, 'text', null, null, firstMsgId, 'whatsapp', resolvedProjectId, resolvedServiceId || undefined);
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
                processExternalBulk(
                    provider, 
                    templateName, 
                    finalLanguage, 
                    data.slice(1), 
                    token, 
                    templateText, 
                    resolvedProjectId, 
                    resolvedServiceId,
                    requiresMediaHeader ? headerFormat : undefined,
                    document || media
                );
            }

        } catch (err: any) {
            console.error('❌ [API_EXTERNAL] Error en /api/v1/send-template:', err.message);
            await logApiRequest({ token, endpoint: '/api/v1/send-template', status: 'error', error: err.message, req });
            if (!res.headersSent) {
                return res.status(500).json({ success: false, error: "Error interno del servidor" });
            }
        }
    });

    /**
     * Middleware dual para /api/v1/send-message (soporta JSON y multipart/form-data)
     */
    const handleSendMessageUpload = (req: any, res: any, next: any) => {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            return upload.any()(req, res, (err: any) => {
                if (err) {
                    console.error('❌ [API_EXTERNAL] Multer Error en /api/v1/send-message:', err);
                    return res.status(400).json({ success: false, error: `Error procesando archivo: ${err.message}` });
                }
                next();
            });
        }
        return bodyParser.json({ limit: '50mb' })(req, res, next);
    };

    // --- 3. ENVÍO DE MENSAJES ESTÁNDAR (USA EL TOKEN) ---
    app.post('/api/v1/send-message', handleSendMessageUpload, async (req: any, res: any) => {
        const uploadedFile = (req.files && req.files.length > 0) ? req.files[0] : (req.file || null);
        let { token, to, type } = req.body;

        // Auto-inferir 'type' si se adjuntó un archivo y no se especificó el tipo
        if (!type && uploadedFile) {
            const m = (uploadedFile.mimetype || '').toLowerCase();
            if (m.startsWith('image/')) type = 'image';
            else if (m.startsWith('video/')) type = 'video';
            else if (m.startsWith('audio/')) type = 'audio';
            else type = 'document';
        }

        try {
            if (!token || !to || !type) {
                await logApiRequest({ token, endpoint: '/api/v1/send-message', status: 'error', error: 'Datos incompletos', req });
                return res.status(400).json({ success: false, error: "Datos incompletos. Se requiere token, to y type." });
            }

            // Validar y quemar el token con firma de service_id
            const authResult = await verifyAndValidateApiToken(token, { burn: true, endpoint: '/api/v1/send-message', req });
            if (!authResult.valid) {
                return res.status(authResult.statusCode).json({ success: false, error: authResult.error });
            }

            const tokenData = authResult.tokenData;
            const resolvedProjectId = authResult.projectId;
            const resolvedServiceId = authResult.serviceId;

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
                const bodyText = req.body.text?.body || req.body.message || req.body.body || '';
                if (!bodyText) {
                    return res.status(400).json({ success: false, error: "Falta el campo text.body para mensajes de tipo text." });
                }
                providerResponse = await provider.sendMessage(targetJid, bodyText, { projectId: resolvedProjectId, serviceId: resolvedServiceId });
                historyContent = bodyText;
            } else if (['image', 'video', 'document', 'audio', 'sticker'].includes(type)) {
                const typeObj = req.body[type] || {};
                const caption = typeObj.caption || req.body.caption || req.body.message || '';
                let customFilename = typeObj.filename || req.body.filename || req.body.fileName || '';
                let mediaSource = typeObj.link || typeObj.id || req.body.link || req.body.id || null;
                let localFilePath: string | null = null;
                let mimeType: string = typeObj.mimetype || req.body.mimetype || '';

                // Caso 1: Archivo binario adjunto vía multipart/form-data
                if (uploadedFile) {
                    localFilePath = path.resolve(uploadedFile.path);
                    customFilename = customFilename || uploadedFile.originalname;
                    mimeType = mimeType || uploadedFile.mimetype;
                } 
                // Caso 2: Archivo en Base64 en el cuerpo JSON
                else if (typeObj.base64 || req.body.base64) {
                    const base64Data = typeObj.base64 || req.body.base64;
                    const saved = saveBase64Media(base64Data, customFilename, type);
                    localFilePath = saved.filePath;
                    customFilename = saved.filename;
                    mimeType = mimeType || saved.mimeType;
                }

                // Si no hay archivo local ni link ni ID, devolver error
                if (!mediaSource && !localFilePath) {
                    return res.status(400).json({ 
                        success: false, 
                        error: `Falta el archivo o identificador para mensajes de tipo ${type}. Se requiere adjuntar 'file' (form-data), '${type}.base64', '${type}.link' o '${type}.id'.` 
                    });
                }

                const sendOptions: any = {
                    media: localFilePath || mediaSource,
                    fileName: customFilename || (type === 'document' ? 'documento.pdf' : undefined),
                    type: type,
                    projectId: resolvedProjectId,
                    serviceId: resolvedServiceId
                };
                if (mimeType) sendOptions.mimetype = mimeType;

                providerResponse = await provider.sendMessage(targetJid, caption, sendOptions);
                historyContent = localFilePath ? `/uploads/${path.basename(localFilePath)}` : (mediaSource || `[${type}]`);
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

        const currentServiceId = HistoryHandler.SERVICE_IDENTIFIER;

        if (apiKey) {
            let settingQuery = supabase
                .from('settings')
                .select('project_id, service_id')
                .eq('key', 'api_key')
                .eq('value', apiKey);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                settingQuery = settingQuery.eq('service_id', currentServiceId);
            }

            const { data: settingData } = await settingQuery.maybeSingle();

            if (settingData) {
                return {
                    authorized: true,
                    projectId: settingData.project_id,
                    serviceId: settingData.service_id || currentServiceId || 'default_service'
                };
            }
        }

        if (token) {
            const authResult = await verifyAndValidateApiToken(token, { burn: false, endpoint: req.originalUrl || req.path || '/api/v1/meta-auth', req });
            if (authResult.valid && authResult.projectId) {
                return {
                    authorized: true,
                    projectId: authResult.projectId,
                    serviceId: authResult.serviceId || currentServiceId || 'default_service'
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
    serviceId?: string | null,
    headerFormat?: string,
    rootMedia?: any
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

            const components: any[] = [];

            if (headerFormat) {
                const headerComp = await buildTemplateHeaderComponent(
                    headerFormat,
                    item.document || item.media || item.header,
                    rootMedia,
                    provider,
                    projectId || '',
                    serviceId
                );
                if (headerComp) {
                    components.push(headerComp);
                }
            }

            if (parameters.length > 0) {
                components.push({
                    type: 'BODY',
                    parameters: parameters
                });
            }

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

                const itemMediaInfo = item.document || item.media || rootMedia;
                const mediaName = typeof itemMediaInfo === 'object' ? (itemMediaInfo.filename || itemMediaInfo.link || 'archivo') : '';
                const historyPrefix = mediaName ? `[API Externa: ${templateName} | Adjunto: ${mediaName}]` : `[API Externa: ${templateName}]`;

                // Guardar en el historial para que el operador lo vea
                await HistoryHandler.saveMessage(phone, 'assistant', `${historyPrefix}\n${renderedText}`, 'text', null, null, msgId, 'whatsapp', projectId, serviceId || undefined);
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

