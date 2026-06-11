import { ProviderClass } from '@builderbot/bot';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';

/**
 * Proveedor para Meta Cloud API (WhatsApp Business API)
 * Incluye soporte para coexistencia y envío directo por API.
 */
class MetaCloudProvider extends ProviderClass {
    private config: any;
    globalVendorArgs: any;

    constructor(args: any = {}) {
        super();
        this.config = args; 
        this.globalVendorArgs = args;
    }

    /**
     * Actualiza la configuración del proveedor en caliente (útil tras onboarding)
     */
    public updateConfig(newConfig: any) {
        this.config = { ...this.config, ...newConfig };
        this.globalVendorArgs = this.config;
        console.log(`📡 [MetaCloudProvider] Configuración actualizada dinámicamente.`);
    }

    /**
     * Anula el marcado automático como leído de BuilderBot
     */
    public sendSeen = async (number: string): Promise<any> => {
        // No-op para evitar que el bot marque los mensajes como leídos de forma automática
        return null;
    }

    /**
     * Descarga y guarda archivos multimedia recibidos por webhook
     */
    public async saveFile(ctx: any, options: { path?: string } = {}): Promise<string> {
        const { access_token } = this.config;
        
        // El payload puede estar en varios lugares según el origen del mensaje
        const msg = ctx.payload || ctx;
        let mediaType = ctx.type || msg.type;

        // Normalización: Para Meta, 'voice' se llama 'audio'
        if (mediaType === 'voice') mediaType = 'audio';
        
        // Buscar el objeto de media (WhatsApp Meta tiene una estructura anidada)
        const mediaObj = msg[mediaType] || ctx.media || msg.media || null;

        if (!mediaObj) {
            console.error('❌ [MetaCloudProvider] No se encontró objeto de media para descargar. Tipo:', mediaType);
            return "no-file";
        }

        // Extraer URL e ID con mayor prioridad al ID si es Meta
        const mediaId = mediaObj.id || (ctx.media ? ctx.media.id : null);
        let mediaUrl = mediaObj.url || mediaObj.link || (ctx.media ? ctx.media.url : null);

        // Si no hay URL pero hay ID (estándar de Meta), obtenemos la URL temporal de la API
        if (!mediaUrl && mediaId && access_token) {
            try {
                console.log(`📡 [MetaCloudProvider] Obteniendo URL de descarga para media ID: ${mediaId}`);
                const apiVersion = process.env.META_API_VERSION || 'v22.0';
                const res = await axios.get(`https://graph.facebook.com/${apiVersion}/${mediaId}`, {
                    headers: { 'Authorization': `Bearer ${access_token}` }
                });
                mediaUrl = res.data.url;
            } catch (e: any) {
                const errorDetail = e.response?.data || e.message;
                console.error(`❌ [MetaCloudProvider] Error obteniendo URL de media Meta (ID: ${mediaId}):`, errorDetail);
            }
        }

        if (!mediaUrl) {
            console.error('❌ [MetaCloudProvider] No se pudo obtener una URL válida para la descarga.');
            return "no-file";
        }

        // Preparar destino
        const outPath = options.path || './tmp/';
        if (!fs.existsSync(outPath)) {
            fs.mkdirSync(outPath, { recursive: true });
        }

        const mimeType = mediaObj.mime_type || mediaObj.mimetype || '';
        const ext = this.getExtByMimeOrType(mediaType, mimeType);
        const filename = `${Date.now()}-${mediaId || 'media'}.${ext}`;
        const dest = path.join(process.cwd(), outPath, filename);

        try {
            console.log(`📥 [MetaCloudProvider] Descargando desde: ${mediaUrl.split('?')[0]}...`);
            
            // Si la URL es de Meta, adjuntamos el token. Aumentamos flexibilidad de detección.
            const headers: any = {};
            const isMetaUrl = mediaUrl.includes('fbcdn') || mediaUrl.includes('fbsbx') || mediaUrl.includes('facebook.com');
            
            if (isMetaUrl && access_token) {
                headers['Authorization'] = `Bearer ${access_token}`;
            } else if (isMetaUrl && !access_token) {
                console.warn('⚠️ [MetaCloudProvider] URL de Meta detectada pero no hay access_token disponible para la descarga.');
            }

            const response = await axios.get(mediaUrl, {
                headers,
                responseType: 'stream'
            });

            const writer = fs.createWriteStream(dest);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`✅ [MetaCloudProvider] Archivo guardado en: ${dest}`);
                    resolve(dest);
                });
                writer.on('error', (err) => {
                    console.error('❌ [MetaCloudProvider] Error escribiendo archivo:', err);
                    reject(err);
                });
            });
        } catch (error: any) {
            console.error('❌ [MetaCloudProvider] Error en la descarga:', error.message);
            return "no-file";
        }
    }

    private getExtByMimeOrType(type: string, mime: string): string {
        const m = mime.toLowerCase();
        if (m.includes('image/jpeg') || m.includes('image/jpg')) return 'jpg';
        if (m.includes('image/png')) return 'png';
        if (m.includes('image/webp')) return 'webp';
        if (m.includes('audio/ogg') || m.includes('audio/opus')) return 'ogg';
        if (m.includes('audio/mp3') || m.includes('audio/mpeg')) return 'mp3';
        if (m.includes('audio/aac')) return 'aac';
        if (m.includes('video/mp4')) return 'mp4';
        if (m.includes('video/quicktime')) return 'mov';
        if (m.includes('application/pdf')) return 'pdf';
        if (m.includes('application/msword') || m.includes('wordprocessingml')) return 'doc';
        if (m.includes('spreadsheetml') || m.includes('excel')) return 'xlsx';
        
        // Fallback por tipo general
        if (type === 'image') return 'jpg';
        if (type === 'audio' || type === 'voice') return 'ogg';
        if (type === 'video') return 'mp4';
        if (type === 'document') return 'pdf';
        return 'bin';
    }

    protected initProvider() {
        console.log('🌐 [MetaCloudProvider] Inicializado con Cloud API. Esperando Webhooks...');
    }

    public async initVendor() {
        this.vendor = {};
        setTimeout(() => {
            this.emit('ready', true);
        }, 100);
        return this.vendor;
    }

    public beforeHttpServerInit() {}

    public afterHttpServerInit() {
        if (this.server) {
            console.log('📡 [MetaCloudProvider] Montando endpoints de Webhook HTTP en Polka...');
            this.server.post('/webhook/meta', this.handleWebhook);
            this.server.get('/webhook/meta', this.handleWebhook);
            this.server.post('/webhook', this.handleWebhook);
            this.server.get('/webhook', this.handleWebhook);
        }
    }

    public busEvents = () => {
        return [];
    };

    /**
     * Obtiene la lista de plantillas disponibles en la WABA
     */
    public async getTemplates(): Promise<any[]> {
        const { waba_id, access_token } = this.config;
        if (!waba_id || !access_token) {
            console.error('❌ [MetaCloudProvider] getTemplates: Faltan IDs o token');
            return [];
        }

        try {
            const url = `https://graph.facebook.com/v22.0/${waba_id}/message_templates?fields=id,name,status,components,language,category,parameter_format`;
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${access_token}` }
            });
            return response.data?.data || [];
        } catch (error: any) {
            console.error('❌ [MetaCloudProvider] Error obteniendo plantillas:', error?.response?.data || error.message);
            return [];
        }
    }

    /**
     * Crea una nueva plantilla de mensaje en la WABA
     * @param examples - Valores de ejemplo para variables {{1}}, {{2}}, etc. (requerido por Meta)
     */
    public async createTemplate(name: string, category: string, language: string, text: string, examples: string[] = []): Promise<any> {
        const { waba_id, access_token } = this.config;
        if (!waba_id || !access_token) {
            console.error('❌ [MetaCloudProvider] createTemplate: Faltan IDs o token');
            return null;
        }

        const url = `https://graph.facebook.com/v22.0/${waba_id}/message_templates`;
        
        // Detectar variables en el texto: soporta {{1}}, {{nombre}}, etc.
        const varRegex = /\{\{(\w+)\}\}/g;
        const detectedVars: string[] = [];
        let match;
        while ((match = varRegex.exec(text)) !== null) {
            if (!detectedVars.includes(match[1])) {
                detectedVars.push(match[1]);
            }
        }

        // Determinar si usa variables con nombre ({{nombre}}) o posicionales ({{1}})
        const hasNamedVars = detectedVars.some(v => isNaN(Number(v)));

        // Auto-generar o normalizar ejemplos. Meta requiere strings en body_text
        let finalExamples: string[] = [];

        if (detectedVars.length > 0) {
            // Si no hay ejemplos, auto-generar
            if (!examples || examples.length === 0) {
                finalExamples = detectedVars.map(v => `ejemplo_${v}`);
            } else {
                // Normalizar: pueden venir como strings o como objetos {param_name, example}
                finalExamples = examples.map((ex: any) => {
                    if (typeof ex === 'string') return ex;
                    if (ex && typeof ex === 'object' && ex.example) return String(ex.example);
                    if (ex && typeof ex === 'object' && ex.text) return String(ex.text); // fallback
                    return String(ex || 'ejemplo');
                });
            }
            console.log(`📝 [MetaCloudProvider] Normalizados ${finalExamples.length} ejemplos para variables: [${detectedVars.join(', ')}]`);
        }

        // Construir componente BODY con ejemplos según el tipo de variables
        const bodyComponent: any = {
            type: "BODY",
            text: text
        };

        // Meta REQUIERE valores de ejemplo para plantillas con variables
        if (detectedVars.length > 0 && finalExamples.length > 0) {
            if (hasNamedVars) {
                // ESTRUCTURA PARA PARÁMETROS CON NOMBRE (NAMED)
                bodyComponent.example = {
                    body_text_named_params: detectedVars.map((v, i) => ({
                        param_name: v,
                        example: finalExamples[i] || `ejemplo_${v}`
                    }))
                };
            } else {
                // ESTRUCTURA PARA PARÁMETROS POSICIONALES ({{1}}, {{2}}...)
                bodyComponent.example = {
                    body_text: [finalExamples]
                };
            }
        }

        const body: any = {
            name,
            category, // MARKETING, UTILITY, AUTHENTICATION
            allow_category_change: true,
            language,
            components: [bodyComponent]
        };

        // Meta requiere este campo para usar variables con nombre
        if (hasNamedVars) {
            body.parameter_format = "named";
        }

        console.log(`📡 [MetaCloudProvider] Creando plantilla: ${name} | Categoría: ${category} | Idioma: ${language} | Vars: [${detectedVars.join(', ')}] | Formato: ${hasNamedVars ? 'NAMED' : 'POSITIONAL'}`);
        console.log(`📋 [MetaCloudProvider] Payload completo:`, JSON.stringify(body, null, 2));

        try {
            const response = await axios.post(url, body, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ [MetaCloudProvider] Plantilla '${name}' creada. ID: ${response.data?.id} | Estado: ${response.data?.status}`);
            
            // Incluir info de variables en la respuesta para uso posterior
            if (hasNamedVars) {
                response.data._varNames = detectedVars;
            }
            return response.data;
        } catch (error: any) {
            console.error('❌ [MetaCloudProvider] Error creando plantilla:', error?.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Formatea un número telefónico para la API de Meta (remueve el 9 de Argentina)
     */
    private formatNumberForMeta(number: string): string {
        let clean = number.replace(/\D/g, '');
        // Caso específico Argentina: WhatsApp requiere el '9' móvil intermedio en producción (549... con 13 dígitos)
        if (clean.startsWith('54')) {
            // Si tiene 12 dígitos (ej: 541130792789), le insertamos el '9' móvil para que sea entregable (5491130792789)
            if (clean.length === 12 && !clean.startsWith('549')) {
                clean = '549' + clean.slice(2);
            }
            // Si ya tiene 13 dígitos y empieza con 549, lo dejamos tal cual (no removemos el '9')
        }
        return clean;
    }

    /**
     * Envía un mensaje basado en una plantilla oficial
     */
    public async sendTemplate(number: string, templateName: string, languageCode: string = 'es', components: any[] = []): Promise<any> {
        const { phone_number_id, access_token } = this.config;
        if (!phone_number_id || !access_token) {
            console.error('❌ [MetaCloudProvider] sendTemplate: Faltan IDs o token');
            return null;
        }

        const url = `https://graph.facebook.com/v22.0/${phone_number_id}/messages`;
        
        // Limpiar número: solo dígitos y remover el '9' si corresponde
        const cleanNumber = this.formatNumberForMeta(number);
        
        const body: any = {
            messaging_product: "whatsapp",
            to: cleanNumber,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: languageCode
                },
                components: components
            }
        };

        try {
            const response = await axios.post(url, body, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error: any) {
            const errorDetail = error?.response?.data || error.message;
            console.error('❌ [MetaCloudProvider] Error enviando plantilla:', JSON.stringify(errorDetail, null, 2));
            throw error; // Lanzamos el error para que el proceso masivo lo capture
        }
    }

    /**
     * Obtiene la biblioteca de plantillas pre-configuradas de Meta (con paginación completa)
     */
    public async getLibraryTemplates(): Promise<any[]> {
        const { access_token } = this.config;
        if (!access_token) {
            console.error('❌ [MetaCloudProvider] getLibraryTemplates: Falta token de acceso');
            return this.getDemoTemplates();
        }

        let allTemplates: any[] = [];

        // 1. Intentar obtener de la Biblioteca Oficial de Meta (Paginado)
        try {
            console.log('📡 [MetaCloudProvider] Consultando Biblioteca Global de Meta (Full Fetch)...');
            let nextUrl: string | null = `https://graph.facebook.com/v22.0/message_template_library?fields=id,name,components,language,category,status&limit=100`;
            
            while (nextUrl && allTemplates.length < 2000) { // Limitamos a 2000 para evitar loops infinitos
                const response: any = await axios.get(nextUrl, {
                    headers: { 'Authorization': `Bearer ${access_token}` }
                });
                
                const data = response.data?.data || [];
                allTemplates = [...allTemplates, ...data];
                
                nextUrl = response.data?.paging?.next || null;
                if (nextUrl) console.log(`🔄 [MetaCloudProvider] Cargando siguiente página de la biblioteca... (${allTemplates.length} cargadas)`);
            }

            if (allTemplates.length > 0) {
                console.log(`✅ [MetaCloudProvider] Se cargaron ${allTemplates.length} plantillas de la Biblioteca Global de Meta.`);
                return allTemplates;
            }
        } catch (err: any) {
            console.warn('⚠️ [MetaCloudProvider] Error en Biblioteca Global, intentando Master WABA:', err?.response?.data || err.message);
        }

        // 2. Fallback: Intentar obtener de la Biblioteca Maestra de RialWay
        try {
            const MASTER_WABA_ID = '146603058535041';
            console.log(`📡 [MetaCloudProvider] Consultando Biblioteca Maestra RialWay (${MASTER_WABA_ID})...`);
            const urlMaster = `https://graph.facebook.com/v22.0/${MASTER_WABA_ID}/message_templates?fields=id,name,components,language,category,status&limit=100`;
            
            const responseMaster = await axios.get(urlMaster, {
                headers: { 'Authorization': `Bearer ${access_token}` }
            });
            
            const masterTemplates = responseMaster.data?.data || [];
            if (masterTemplates.length > 0) {
                console.log(`✅ [MetaCloudProvider] Se cargaron ${masterTemplates.length} plantillas de la Biblioteca Maestra.`);
                return masterTemplates.map((t: any) => ({ ...t, isShared: true }));
            }
        } catch (masterErr: any) {
            console.error('⚠️ [MetaCloudProvider] Error consultando Biblioteca Maestra:', masterErr?.response?.data || masterErr.message);
        }

        // 3. Fallback Final
        return this.getDemoTemplates();
    }

    /**
     * Templates de demostración por defecto
     */
    private getDemoTemplates(): any[] {
        return [
            {
                name: "bienvenida_rialway",
                category: "MARKETING",
                language: "es",
                components: [
                    { type: "BODY", text: "¡Hola {{1}}! Bienvenido a nuestra tienda. ¿En qué podemos ayudarte hoy?" }
                ],
                isDemo: true
            },
            {
                name: "recordatorio_cita",
                category: "UTILITY",
                language: "es",
                components: [
                    { type: "BODY", text: "Hola {{1}}, te recordamos tu cita para el día {{2}} a las {{3}}. ¡Te esperamos!" }
                ],
                isDemo: true
            },
            {
                name: "soporte_tecnico",
                category: "UTILITY",
                language: "es",
                components: [
                    { type: "BODY", text: "Hola {{1}}, hemos recibido tu solicitud de soporte con el ticket {{2}}. Un agente te contactará pronto." }
                ],
                isDemo: true
            }
        ];
    }

    /**
     * Sube un archivo local a Meta para obtener un media_id
     */
    private async uploadMedia(filePath: string): Promise<string | null> {
        const { phone_number_id, access_token } = this.config;
        if (!fs.existsSync(filePath)) {
            console.error(`❌ [MetaCloudProvider] uploadMedia: El archivo no existe en ${filePath}`);
            return null;
        }

        const apiVersion = process.env.META_API_VERSION || 'v22.0';
        const url = `https://graph.facebook.com/${apiVersion}/${phone_number_id}/media`;
        
        try {
            const form = new FormData();
            form.append('messaging_product', 'whatsapp');

            const lowerPath = filePath.toLowerCase();
            let contentType = 'application/octet-stream';
            if (lowerPath.endsWith('.webp')) contentType = 'image/webp';
            else if (lowerPath.endsWith('.png')) contentType = 'image/png';
            else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) contentType = 'image/jpeg';
            else if (lowerPath.endsWith('.pdf')) contentType = 'application/pdf';
            else if (lowerPath.endsWith('.mp4')) contentType = 'video/mp4';
            else if (lowerPath.endsWith('.mp3')) contentType = 'audio/mpeg';
            else if (lowerPath.endsWith('.ogg')) contentType = 'audio/ogg';
            else if (lowerPath.endsWith('.opus')) contentType = 'audio/ogg; codecs=opus';

            form.append('file', fs.createReadStream(filePath), { contentType, filename: path.basename(filePath) });

            const response = await axios.post(url, form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${access_token}`
                }
            });
            return response.data.id;
        } catch (error: any) {
            console.error('❌ [MetaCloudProvider] Error subiendo media a Meta:', error?.response?.data || error.message);
            return null;
        }
    }

    /**
     * Envía mensajes a través de la API oficial de Meta
     */
    public async sendMessage(number: string, message: string, options: any = {}): Promise<any> {
        const { phone_number_id, access_token } = this.config;

        if (!phone_number_id || !access_token) {
            console.error('❌ [MetaCloudProvider] Error: Falta phone_number_id o access_token en la configuración');
            return;
        }

        const apiVersion = process.env.META_API_VERSION || 'v22.0';
        const url = `https://graph.facebook.com/${apiVersion}/${phone_number_id}/messages`;
        const cleanNumber = this.formatNumberForMeta(number);
        const toFormat = `+${cleanNumber}`;
        
        // Detectar si el mensaje es una ruta de archivo local
        const isMessagePath = typeof message === 'string' && (message.startsWith('/') || message.includes(':\\')) && fs.existsSync(message);
        
        console.log(`[MetaCloudProvider] ENVÍO: to=${toFormat} | IsPath=${isMessagePath} | Msg=${isMessagePath ? '[FILE]' : (message || '').substring(0, 20)} | OptionsKeys=${Object.keys(options || {})}`);

        const body: any = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: toFormat
        };

        // Soporte para archivos (buscamos en todas las propiedades posibles)
        const mediaSource = options.media || options.url || options.path || (isMessagePath ? message : null) || (typeof options === 'string' && options.includes('/') ? options : null);

        if (mediaSource) {
            console.log(`[MetaCloudProvider] 📂 Media detectado en sendMessage:`, typeof mediaSource === 'string' ? mediaSource : JSON.stringify(mediaSource));
            
            const mediaUrl = typeof mediaSource === 'string' ? mediaSource : (mediaSource.url || mediaSource.path || mediaSource.link);
            const mimeType = (typeof mediaSource === 'object') ? (mediaSource.mimetype || mediaSource.mimeType || '') : '';
            
            // El caption no debe ser la ruta del archivo si el mensaje era una ruta
            const finalCaption = isMessagePath ? (options.body || options.caption || '') : (message || '');

            // Detectar si es una ruta local o una URL
            let finalPath = mediaUrl;
            const isLocal = finalPath && !finalPath.startsWith('http');

            if (isLocal) {
                // Asegurar ruta absoluta
                if (finalPath && !path.isAbsolute(finalPath)) {
                    finalPath = path.join(process.cwd(), finalPath);
                }

                if (finalPath && fs.existsSync(finalPath)) {
                    console.log(`📤 [MetaCloudProvider] Subiendo archivo local a Meta: ${finalPath}`);
                    const mediaId = await this.uploadMedia(finalPath);
                    if (mediaId) {
                        const mediaData = { id: mediaId };
                        const finalLowerPath = finalPath.toLowerCase();
                        const isSticker = finalLowerPath.endsWith('.webp') || mimeType.includes('webp') || mimeType.includes('sticker') || options.type === 'sticker' || (options.media && options.media.type === 'sticker');
                        
                        if (isSticker) {
                            body.type = 'sticker';
                            body.sticker = { ...mediaData };
                        } else if (finalLowerPath.endsWith('.pdf') || mimeType.includes('pdf')) {
                            body.type = 'document';
                            body.document = { ...mediaData, filename: path.basename(finalPath), caption: finalCaption };
                        } else if (finalLowerPath.endsWith('.jpg') || finalLowerPath.endsWith('.png') || finalLowerPath.endsWith('.jpeg') || mimeType.includes('image')) {
                            body.type = 'image';
                            body.image = { ...mediaData, caption: finalCaption };
                        } else if (finalLowerPath.endsWith('.mp4') || finalLowerPath.endsWith('.ogg') || finalLowerPath.endsWith('.opus') || finalLowerPath.endsWith('.mp3') || finalLowerPath.endsWith('.wav') || mimeType.includes('audio')) {
                            body.type = (finalLowerPath.endsWith('.opus') || mimeType.includes('voice')) ? 'voice' : 'audio';
                            body.audio = { ...mediaData };
                        } else if (finalLowerPath.endsWith('.mp4') || mimeType.includes('video')) {
                            body.type = 'video';
                            body.video = { ...mediaData, caption: finalCaption };
                        } else {
                            body.type = 'document';
                            body.document = { ...mediaData, filename: path.basename(finalPath), caption: finalCaption };
                        }

                        try {
                            const res = await axios.post(url, body, {
                                headers: {
                                    'Authorization': `Bearer ${access_token}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            console.log(`✅ [MetaCloudProvider] Media enviado con éxito (ID: ${mediaId})`);
                            return res.data;
                        } catch (err: any) {
                            console.error('❌ [MetaCloudProvider] Error enviando mensaje con mediaId:', err.response?.data || err.message);
                        }
                    } else {
                        console.error(`❌ [MetaCloudProvider] No se pudo obtener mediaId para: ${finalPath}`);
                    }
                } else {
                    console.error(`❌ [MetaCloudProvider] El archivo local NO existe: ${finalPath}`);
                }
                
                // Si falló la subida local, no intentamos enviar como link (porque no es una URL)
                return;
            }

            const mediaData: any = { link: mediaUrl };
            const lowerMediaUrl = (mediaUrl || '').toLowerCase();

            if (lowerMediaUrl.endsWith('.webp') || mimeType.includes('webp') || mimeType.includes('sticker') || options.type === 'sticker' || (options.media && options.media.type === 'sticker')) {
                body.type = 'sticker';
                body.sticker = { ...mediaData };
            } else if (mimeType.includes('image') || lowerMediaUrl.endsWith('.jpg') || lowerMediaUrl.endsWith('.png') || lowerMediaUrl.endsWith('.jpeg')) {
                body.type = 'image';
                body.image = { ...mediaData, caption: finalCaption };
            } else if (mimeType.includes('audio') || mimeType.includes('voice') || lowerMediaUrl.endsWith('.mp3') || lowerMediaUrl.endsWith('.ogg') || lowerMediaUrl.endsWith('.opus')) {
                body.type = (mimeType.includes('voice') || lowerMediaUrl.endsWith('.opus')) ? 'voice' : 'audio';
                body.audio = { ...mediaData };
            } else if (mimeType.includes('video') || lowerMediaUrl.endsWith('.mp4')) {
                body.type = 'video';
                body.video = { ...mediaData, caption: finalCaption };
            } else {
                // Por defecto tratamos como documento (PDF, etc)
                body.type = 'document';
                const filename = (typeof mediaSource === 'object') 
                    ? (mediaSource.fileName || mediaSource.filename || mediaSource.name) 
                    : null;

                body.document = { 
                    ...mediaData, 
                    filename: filename || path.basename(mediaUrl || 'documento.pdf'), 
                    caption: finalCaption 
                };
            }
        } else {
            body.type = 'text';
            body.text = { body: message };
        }

        try {
            const response = await axios.post(url, body, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error: any) {
            console.error('❌ [MetaCloudProvider] Error API:', error?.response?.data || error.message);
            return null;
        }
    }

    /**
     * Solicita la sincronización de datos de la App WhatsApp Business (SMB)
     * @param syncType 'smb_app_state_sync' para contactos o 'history' para historial de mensajes
     */
    public async requestSmbSync(syncType: 'smb_app_state_sync' | 'history'): Promise<any> {
        const { access_token, phone_number_id } = this.config;
        if (!access_token || !phone_number_id) {
            console.error('❌ [MetaCloudProvider] Falta configuración para solicitar sincronización SMB');
            return null;
        }

        const url = `https://graph.facebook.com/v22.0/${phone_number_id}/smb_app_data`;
        const body = { sync_type: syncType };

        try {
            console.log(`📡 [MetaCloudProvider] Solicitando sincronización SMB: ${syncType}`);
            const response = await axios.post(url, body, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error: any) {
            console.error(`❌ [MetaCloudProvider] Error solicitando sincronización ${syncType}:`, error?.response?.data || error.message);
            return null;
        }
    }

    public async sendImage(number: string, media: string, caption: string = ''): Promise<any> {
        return this.sendMessage(number, caption, { media: { url: media, mimetype: 'image/png' } });
    }

    public async sendSticker(number: string, media: string): Promise<any> {
        return this.sendMessage(number, '', { media: { url: media, mimetype: 'image/webp' }, type: 'sticker' });
    }

    public async sendVideo(number: string, media: string, caption: string = ''): Promise<any> {
        return this.sendMessage(number, caption, { media: { url: media, mimetype: 'video/mp4' } });
    }

    public async sendFile(number: string, media: string, caption: string = ''): Promise<any> {
        return this.sendMessage(number, caption, { media: { url: media, mimetype: 'application/pdf' } });
    }

    /**
     * Alias para sendMessage (texto plano) para compatibilidad con otros flujos
     */
    public async sendText(number: string, message: string): Promise<any> {
        return this.sendMessage(number, message);
    }

    /**
     * Procesa el Webhook entrante de Meta
     */
    public handleWebhook = async (req: any, res: any) => {
        try {
            const body = req.body;
            
            // Responder 200 OK inmediatamente (Obligatorio para Meta)
            if (!res.headersSent) {
                res.statusCode = 200;
                res.end('OK');
            }

            // Sincronizar Meta Provider dinámicamente si no hay credenciales activas
            if (!this.config.access_token || this.config.access_token === 'PENDING') {
                try {
                    const { HistoryHandler } = await import('../db/historyHandler');
                    const metaConfig = await HistoryHandler.getMetaOnboardingData();
                    if (metaConfig && metaConfig.access_token && metaConfig.access_token !== 'PENDING') {
                        console.log('📡 [MetaCloudProvider] Sincronizando token de Meta dinámicamente en Webhook...');
                        this.updateConfig({
                            access_token: metaConfig.access_token,
                            phone_number_id: metaConfig.phone_number_id,
                            waba_id: metaConfig.waba_id
                        });
                    }
                } catch (e: any) {
                    console.error('⚠️ [MetaCloudProvider] Error cargando config dinámica en Webhook:', e.message);
                }
            }

            // Verificación del Webhook (GET /webhook)
            if (req.method === 'GET') {
                const mode = req.query['hub.mode'];
                const token = req.query['hub.verify_token'];
                const challenge = req.query['hub.challenge'];
                const { verify_token } = this.config;

                if (mode === 'subscribe' && token === verify_token) {
                    console.log('✅ [MetaCloudProvider] Webhook Verificado Correctamente.');
                    return res.end(challenge);
                } else {
                    console.error('❌ [MetaCloudProvider] Error de Verificación: Token incorrecto');
                    res.statusCode = 403;
                    return res.end('Forbidden');
                }
            }

            if (!body || (body.object !== 'whatsapp_business_account' && body.object !== 'page')) return;

            setImmediate(() => {
                if (body.object === 'page') {
                    this.processMessengerMessage(body);
                } else {
                    // Detectar si algún change viene de campos SMB
                    const hasSmbField = body.entry?.some((entry: any) =>
                        entry.changes?.some((change: any) => 
                            ['smb_message_echoes', 'smb_app_state_sync', 'history'].includes(change.field)
                        )
                    );
                    this.processIncomingMessage(body, hasSmbField);
                }
            });
        } catch (e) {
            console.error('❌ [MetaCloudProvider] Error en handleWebhook:', e);
        }
    }

    // El código anterior duplicado de getTemplates y sendTemplate fue removido.


    private processIncomingMessage = async (body: any, isEchoWebhook: boolean = false) => {
        try {
            // Normalizar el ID del teléfono de la configuración (puede venir como numberId o phone_number_id)
            const phone_number_id = this.config.phone_number_id || this.config.numberId;

            if (isEchoWebhook) {
                console.log('📡 [MetaCloudProvider] 🔄 Detectado evento de field: smb_message_echoes');
            }

            for (const entry of (body.entry || [])) {
                for (const change of (entry.changes || [])) {
                    const value = change.value;
                    const fieldName = change.field || 'messages';
                    const isThisChangeEcho = fieldName === 'smb_message_echoes' || isEchoWebhook;

                    const messages = value?.messages || value?.message_echoes;
                    const contactData = value?.contacts; // Para smb_app_state_sync
                    const statuses = value?.statuses;

                    // 0. MANEJO DE ACTUALIZACIONES DE ESTADO (statuses)
                    if (statuses && Array.isArray(statuses)) {
                        for (const status of statuses) {
                            console.log(`📡 [MetaCloudProvider] Webhook de estado para ${status.recipient_id} (${status.id}): ${status.status}`);
                            if (status.status === 'failed' && status.errors) {
                                for (const err of status.errors) {
                                    console.error(`❌ [MetaCloudProvider] Error de entrega para ${status.recipient_id} (ID: ${status.id}): [Código ${err.code}] ${err.message} - ${err.error_data?.details || ''}`);
                                }
                            }
                        }
                    }

                    // 1. MANEJO DE SINCRONIZACIÓN DE CONTACTOS (smb_app_state_sync)
                    if (fieldName === 'smb_app_state_sync' && contactData && Array.isArray(contactData)) {
                        console.log(`📡 [MetaCloudProvider] Recibida sincronización de ${contactData.length} contactos SMB`);
                        this.emit('contacts_sync', contactData);
                        continue;
                    }

                    // 2. MANEJO DE HISTORIAL O MENSAJES (messages / history / message_echoes)
                    if (messages && Array.isArray(messages)) {
                        
                        // Filtro de número destino para asegurar que es para nosotros
                        if (phone_number_id && value.metadata?.phone_number_id && value.metadata?.phone_number_id !== String(phone_number_id)) {
                            console.log(`⚠️ [MetaCloudProvider] Ignorando mensaje (ID mismatch: ${value.metadata?.phone_number_id} != ${phone_number_id})`);
                            continue;
                        }

                        if (isThisChangeEcho) {
                            console.log(`📡 [MetaCloudProvider] Procesando ${messages.length} mensajes de tipo ECO/SMB (Manual App o Historial)`);
                        }

                        const contact = value.contacts?.[0];
                        const wa_id = contact?.wa_id;
                        // Extraer el BSUID (Business-Scoped User ID)
                        const bsuid = contact?.user_id || messages[0]?.from_user_id;

                        for (const msg of messages) {
                            const mediaObj = msg.image || msg.video || msg.audio || msg.document || msg.voice || msg[msg.type];
                            let type = msg.type;

                            // Mapeo de tipos para eventos de Builderbot
                            if (type === 'audio') type = 'voice';

                            let messageBody = msg.text?.body || 
                                              msg.interactive?.button_reply?.title || 
                                              msg.interactive?.list_reply?.title || 
                                              msg.button?.text || '';
                            
                            // Si es media y no tiene texto (body), intentamos usar el caption o enviamos el evento
                            if (!messageBody && mediaObj) {
                                messageBody = mediaObj.caption || `_event_${type}_`;
                            }

                            // --- DETECCIÓN DE ECHO ---
                            // Caso 1: smb_message_echoes / history → Mensaje enviado desde la app de WhatsApp o histórico
                            // Caso 2: recipient_id presente → Echo estándar de la API
                            const isEcho = isThisChangeEcho || !!msg.recipient_id;

                            // Para el campo 'history', debemos distinguir si el mensaje lo envió el negocio o el cliente
                            let actualIsEcho = isEcho;
                            if (fieldName === 'history') {
                                // Si el 'from' es nuestro número, es un mensaje enviado por nosotros (echo)
                                actualIsEcho = String(msg.from) === String(this.config.phone_number_id);
                            }

                            // Para echos de smb_message_echoes, el "from" contiene nuestro número, 
                            // y el "to" contiene el número del destinatario.
                            const recipientId = msg.recipient_id || msg.to || wa_id || msg.from;

                            if (actualIsEcho) {
                                console.log(`📋 [MetaCloudProvider] ECO/HISTORY (Assistant) DETECTADO. Field: ${fieldName}. De: ${msg.from} Para: ${msg.recipient_id || msg.to || 'N/A'}. Result chatId: ${recipientId}`);
                            } else if (fieldName === 'history') {
                                console.log(`📋 [MetaCloudProvider] HISTORY (User) DETECTADO. De: ${msg.from}. Result chatId: ${msg.from}`);
                            }

                            // Forzar que el body no esté vacío para eventos de voz para que el core del bot los procese
                            const bodyText = type === 'voice' ? '_event_voice_note_' : (messageBody || '');

                            const formatedMessage: any = {
                                from: wa_id || msg.from,
                                body: bodyText,
                                phoneNumber: actualIsEcho ? recipientId : msg.from,
                                userId: bsuid, // Añadimos el BSUID al contexto
                                name: actualIsEcho ? 'Operador (App WhatsApp)' : (contact?.profile?.name || 'User'),
                                type: type,
                                payload: msg,
                                platform: 'whatsapp',
                                isManualIntervention: isThisChangeEcho && fieldName !== 'history' // Solo marcar intervención si no es historial retroactivo
                            };

                            // Enriquecer con objeto media para que los flujos (saveFile) tengan lo necesario
                            // Enriquecer con objeto media para que los flujos (saveFile) tengan lo necesario
                            if (mediaObj) {
                                try {
                                    // Auto-descarga de archivos para que el historial tenga la ruta local (como hace Baileys)
                                    // Ponemos un timeout de 5 segundos para no bloquear el webhook si Meta va lento
                                    const downloadPromise = this.saveFile(formatedMessage);
                                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
                                    
                                    const localPath: any = await Promise.race([downloadPromise, timeoutPromise]);

                                    if (localPath && localPath !== "no-file") {
                                        formatedMessage.localPath = localPath;
                                        // Si el cuerpo era solo un evento que no sea de voz, lo actualizamos con la ruta para que el HistoryHandler lo guarde
                                        if (formatedMessage.body && formatedMessage.body.startsWith('_event_') && formatedMessage.type !== 'voice') {
                                            // Guardamos la ruta relativa para el CRM
                                            formatedMessage.body = localPath; 
                                        }
                                    }
                                } catch (err) {
                                    console.warn(`⚠️ [MetaCloudProvider] Media detectado pero no se pudo descargar a tiempo para el historial.`);
                                }

                                formatedMessage.media = {
                                    url: mediaObj.link || mediaObj.url || null,
                                    mimetype: mediaObj.mime_type || mediaObj.mimetype || null,
                                    id: mediaObj.id || null
                                };
                            }

                            if (actualIsEcho) {
                                this.emit('message_from_me', formatedMessage);
                            } else {
                                this.emit('message', formatedMessage);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('❌ [MetaCloudProvider] Error procesando mensaje entrante:', e);
        }
    }

    /**
     * Procesa el Webhook entrante de Messenger / Instagram (objeto 'page')
     */
    private processMessengerMessage = (body: any) => {
        try {
            body.entry?.forEach((entry: any) => {
                entry.messaging?.forEach((msgEntry: any) => {
                    if (msgEntry.message) {
                        const senderId = msgEntry.sender.id;
                        const msg = msgEntry.message;
                        
                        // Determinar si es Instagram o Messenger basado en el formato del ID o metadata
                        // Usualmente Meta envía info del receptor
                        const isInstagram = !!msgEntry.recipient?.id && entry.id !== msgEntry.recipient.id; 
                        // Nota: Una forma más fiable es ver si el senderId tiene formato numérico largo
                        const platform: 'instagram' | 'messenger' = (senderId.length > 15) ? 'instagram' : 'messenger';

                        const type = msg.attachments ? msg.attachments[0].type : 'text';
                        const messageBody = msg.text || (msg.attachments ? `_event_${type}_` : '');

                        const formatedMessage: any = {
                            body: messageBody,
                            from: senderId,
                            phoneNumber: senderId,
                            userId: senderId,
                            name: 'Meta User',
                            type: type === 'image' || type === 'video' ? type : 'text',
                            payload: msgEntry,
                            platform: platform // Custom field for easier identification
                        };

                        if (msg.attachments) {
                            const att = msg.attachments[0].payload;
                            formatedMessage.media = {
                                url: att.url,
                                mimetype: type === 'image' ? 'image/jpeg' : (type === 'video' ? 'video/mp4' : 'application/octet-stream'),
                                id: null
                            };

                            // Auto-descarga para Messenger/Instagram
                            this.saveFile(formatedMessage).then(localPath => {
                                if (localPath && localPath !== "no-file") {
                                    formatedMessage.localPath = localPath;
                                    if (formatedMessage.body && formatedMessage.body.startsWith('_event_')) {
                                        formatedMessage.body = localPath; 
                                    }
                                }
                                this.emit('message', formatedMessage);
                            }).catch(() => this.emit('message', formatedMessage));
                        } else {
                            this.emit('message', formatedMessage);
                        }
                    }
                });
            });
        } catch (e) {
            console.error('❌ [MetaCloudProvider] Error procesando mensaje de Messenger:', e);
        }
    }

    /**
     * Alternativa de envio para Messenger/Instagram
     */
    public async sendMessenger(recipientId: string, message: string, platform: 'instagram' | 'messenger' = 'messenger'): Promise<any> {
        const { access_token } = this.config;
        if (!access_token) return null;

        const url = `https://graph.facebook.com/v25.0/me/messages?access_token=${access_token}`;
        const body = {
            recipient: { id: recipientId },
            message: { text: message }
        };

        try {
            const response = await axios.post(url, body);
            return response.data;
        } catch (error: any) {
            console.error(`❌ [MetaCloudProvider] Error enviando a ${platform}:`, error?.response?.data || error.message);
            return null;
        }
    }
}

export { MetaCloudProvider };

