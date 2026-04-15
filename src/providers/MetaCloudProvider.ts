import { ProviderClass } from '@builderbot/bot';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

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
     * Descarga y guarda archivos multimedia recibidos por webhook
     */
    public async saveFile(ctx: any, options: { path?: string } = {}): Promise<string> {
        const { access_token } = this.config;
        // El payload puede estar en ctx.payload o en ctx directamente dependiendo de quién llame
        const msg = ctx.payload || ctx;
        const mediaType = msg.type || ctx.type;
        
        // Intentar obtener el objeto de media (image, audio, voice, video, document)
        const mediaObj = msg[mediaType] || ctx.media || (msg.type ? msg[msg.type] : null);

        if (!mediaObj) {
            console.error('❌ [MetaCloudProvider] No se encontró objeto de media para descargar.');
            return "no-file";
        }

        let mediaUrl = mediaObj.link || mediaObj.url || (ctx.media ? ctx.media.url : null);
        const mediaId = mediaObj.id || (ctx.media ? ctx.media.id : null);

        // Si no hay URL pero hay ID (estándar de Meta), obtenemos la URL temporal de la API
        if (!mediaUrl && mediaId && access_token) {
            try {
                console.log(`📡 [MetaCloudProvider] Obteniendo URL de descarga para media ID: ${mediaId}`);
                const res = await axios.get(`https://graph.facebook.com/v22.0/${mediaId}`, {
                    headers: { 'Authorization': `Bearer ${access_token}` }
                });
                mediaUrl = res.data.url;
            } catch (e: any) {
                console.error(`❌ [MetaCloudProvider] Error obteniendo URL de media Meta:`, e.response?.data || e.message);
            }
        }

        if (!mediaUrl) {
            console.error('❌ [MetaCloudProvider] No se pudo obtener una URL válida para la descarga.');
            return "no-file";
        }

        // Preparar destino
        const outPath = options.path || './temp/';
        if (!fs.existsSync(outPath)) {
            fs.mkdirSync(outPath, { recursive: true });
        }

        const mimeType = mediaObj.mime_type || mediaObj.mimetype || '';
        const ext = this.getExtByMimeOrType(mediaType, mimeType);
        const filename = `${Date.now()}-${mediaId || 'media'}.${ext}`;
        const dest = path.join(process.cwd(), outPath, filename);

        try {
            console.log(`📥 [MetaCloudProvider] Descargando desde: ${mediaUrl.split('?')[0]}...`);
            
            // Si la URL es de Meta (fbcdn.net), adjuntamos el token
            const headers: any = {};
            if (mediaUrl.includes('fbcdn.net') && access_token) {
                headers['Authorization'] = `Bearer ${access_token}`;
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
        if (mime) {
            if (mime.includes('image')) return 'jpg';
            if (mime.includes('audio')) return 'ogg';
            if (mime.includes('video')) return 'mp4';
            if (mime.includes('pdf')) return 'pdf';
        }
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
            const url = `https://graph.facebook.com/v22.0/${waba_id}/message_templates`;
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
     * Envía un mensaje basado en una plantilla oficial
     */
    public async sendTemplate(number: string, templateName: string, languageCode: string = 'es', components: any[] = []): Promise<any> {
        const { phone_number_id, access_token } = this.config;
        if (!phone_number_id || !access_token) {
            console.error('❌ [MetaCloudProvider] sendTemplate: Faltan IDs o token');
            return null;
        }

        const url = `https://graph.facebook.com/v22.0/${phone_number_id}/messages`;
        
        // Limpiar número: solo dígitos
        const cleanNumber = number.replace(/\D/g, '');
        // El formato debe ser internacional sin el + o con él, dependiendo de la configuración. 
        // Usualmente Meta acepta el número internacional directo.
        
        const body = {
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
            console.error('❌ [MetaCloudProvider] Error enviando plantilla:', error?.response?.data || error.message);
            return null;
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
            let nextUrl: string | null = `https://graph.facebook.com/v22.0/message_template_library?limit=100`;
            
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
            const urlMaster = `https://graph.facebook.com/v22.0/${MASTER_WABA_ID}/message_templates?limit=100`;
            
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
     * Envía mensajes a través de la API oficial de Meta
     */
    public async sendMessage(number: string, message: string, options: any = {}): Promise<any> {
        const { phone_number_id, access_token } = this.config;

        if (!phone_number_id || !access_token) {
            console.error('❌ [MetaCloudProvider] Error: Falta phone_number_id o access_token en la configuración');
            return;
        }

        const url = `https://graph.facebook.com/v22.0/${phone_number_id}/messages`;
        const cleanNumber = number.replace(/\D/g, '');
        const toFormat = `+${cleanNumber}`;
        console.log(`[MetaCloudProvider] Intentando enviar a: raw=${number}, to=${toFormat}`);

        const body: any = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: toFormat
        };

        // Soporte para archivos
        if (options.media) {
            const mediaUrl = typeof options.media === 'string' ? options.media : options.media.url;
            const mimeType = options.media.mimetype || '';

            if (mimeType.includes('image')) {
                body.type = 'image';
                body.image = { link: mediaUrl, caption: message || '' };
            } else if (mimeType.includes('pdf') || mimeType.includes('document')) {
                body.type = 'document';
                body.document = { link: mediaUrl, filename: options.media.fileName || 'archivo', caption: message || '' };
            } else if (mimeType.includes('video')) {
                body.type = 'video';
                body.video = { link: mediaUrl, caption: message || '' };
            } else {
                body.type = 'document';
                body.document = { link: mediaUrl, filename: 'archivo', caption: message || '' };
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

    public async sendImage(number: string, media: string, caption: string = ''): Promise<any> {
        return this.sendMessage(number, caption, { media: { url: media, mimetype: 'image/png' } });
    }

    public async sendVideo(number: string, media: string, caption: string = ''): Promise<any> {
        return this.sendMessage(number, caption, { media: { url: media, mimetype: 'video/mp4' } });
    }

    public async sendFile(number: string, media: string, caption: string = ''): Promise<any> {
        return this.sendMessage(number, caption, { media: { url: media, mimetype: 'application/pdf' } });
    }

    /**
     * Procesa el Webhook entrante de Meta
     */
    public handleWebhook = (req: any, res: any) => {
        try {
            const body = req.body;
            
            // Responder 200 OK inmediatamente (Obligatorio para Meta)
            if (!res.headersSent) {
                res.statusCode = 200;
                res.end('OK');
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
                    // Detectar si algún change viene del campo 'smb_message_echoes'
                    // Esto indica mensajes enviados manualmente desde la app de WhatsApp Business
                    const hasSmbEcho = body.entry?.some((entry: any) =>
                        entry.changes?.some((change: any) => change.field === 'smb_message_echoes')
                    );
                    this.processIncomingMessage(body, hasSmbEcho);
                }
            });
        } catch (e) {
            console.error('❌ [MetaCloudProvider] Error en handleWebhook:', e);
        }
    }

    // El código anterior duplicado de getTemplates y sendTemplate fue removido.


    private processIncomingMessage = (body: any, isEchoWebhook: boolean = false) => {
        try {
            // Normalizar el ID del teléfono de la configuración (puede venir como numberId o phone_number_id)
            const phone_number_id = this.config.phone_number_id || this.config.numberId;

            if (isEchoWebhook) {
                console.log('📡 [MetaCloudProvider] 🔄 Detectado evento de field: smb_message_echoes');
            }

            body.entry?.forEach((entry: any) => {
                entry.changes?.forEach((change: any) => {
                    const value = change.value;
                    const fieldName = change.field || 'messages';
                    const isThisChangeEcho = fieldName === 'smb_message_echoes' || isEchoWebhook;

                    const messages = value?.messages || value?.message_echoes;

                    if (messages && Array.isArray(messages)) {
                        
                        // Filtro de número destino para asegurar que es para nosotros
                        if (phone_number_id && value.metadata?.phone_number_id && value.metadata?.phone_number_id !== String(phone_number_id)) {
                            console.log(`⚠️ [MetaCloudProvider] Ignorando mensaje (ID mismatch: ${value.metadata?.phone_number_id} != ${phone_number_id})`);
                            return;
                        }

                        if (isThisChangeEcho) {
                            console.log(`📡 [MetaCloudProvider] Procesando ${messages.length} mensajes de tipo ECO (Manual App)`);
                        }

                        const contact = value.contacts?.[0];
                        const wa_id = contact?.wa_id;
                        // Extraer el BSUID (Business-Scoped User ID)
                        const bsuid = contact?.user_id || messages[0]?.from_user_id;

                        messages.forEach((msg: any) => {
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
                            // Caso 1: smb_message_echoes → Mensaje enviado desde la app de WhatsApp (Atención Humana)
                            // Caso 2: recipient_id presente → Echo estándar de la API
                            const isEcho = isThisChangeEcho || !!msg.recipient_id;

                            // Para echos de smb_message_echoes, el "from" contiene nuestro número, 
                            // y el "to" contiene el número del destinatario.
                            const recipientId = msg.recipient_id || msg.to || wa_id || msg.from;

                            if (isEcho) {
                                console.log(`📋 [MetaCloudProvider] ECO DETECTADO. Field: ${fieldName}. De: ${msg.from} Para: ${msg.recipient_id || msg.to || 'N/A'}. Result chatId: ${recipientId}`);
                                if (recipientId === String(this.config.phone_number_id) || recipientId === String(this.config.numberId)) {
                                    console.warn(`⚠️ [MetaCloudProvider] ATENCIÓN: El recipientId coincide con el Bot ID. El mensaje podría no verse en el chat del cliente.`);
                                }
                            }

                            const formatedMessage: any = {
                                body: messageBody,
                                from: isEcho ? recipientId : (wa_id || msg.from),
                                phoneNumber: isEcho ? recipientId : msg.from,
                                userId: bsuid, // Añadimos el BSUID al contexto
                                name: isEcho ? 'Operador (App WhatsApp)' : (contact?.profile?.name || 'User'),
                                type: type,
                                payload: msg,
                                platform: 'whatsapp',
                                isManualIntervention: isThisChangeEcho // Flag para que el provider.manager active modo humano
                            };

                            // Enriquecer con objeto media para que los flujos (saveFile) tengan lo necesario
                            if (mediaObj) {
                                formatedMessage.media = {
                                    url: mediaObj.link || mediaObj.url || null,
                                    mimetype: mediaObj.mime_type || mediaObj.mimetype || null,
                                    id: mediaObj.id || null
                                };
                            }

                            if (isEcho) {
                                this.emit('message_from_me', formatedMessage);
                            } else {
                                this.emit('message', formatedMessage);
                            }
                        });
                    }
                });
            });
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
                        }

                        this.emit('message', formatedMessage);
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

        const url = `https://graph.facebook.com/v22.0/me/messages?access_token=${access_token}`;
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

