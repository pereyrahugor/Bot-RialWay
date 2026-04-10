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
                const res = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, {
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
     * Envía mensajes a través de la API oficial de Meta
     */
    public async sendMessage(number: string, message: string, options: any = {}): Promise<any> {
        const { phone_number_id, access_token } = this.config;

        if (!phone_number_id || !access_token) {
            console.error('❌ [MetaCloudProvider] Error: Falta phone_number_id o access_token en la configuración');
            return;
        }

        const url = `https://graph.facebook.com/v20.0/${phone_number_id}/messages`;
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

            if (!body || body.object !== 'whatsapp_business_account') return;

            setImmediate(() => {
                this.processIncomingMessage(body);
            });
        } catch (e) {
            console.error('❌ [MetaCloudProvider] Error en handleWebhook:', e);
        }
    }

    private processIncomingMessage = (body: any) => {
        try {
            const { phone_number_id } = this.config;

            body.entry?.forEach((entry: any) => {
                entry.changes?.forEach((change: any) => {
                    const value = change.value;
                    if (value?.messages) {
                        
                        // Filtro de número destino para asegurar que es para nosotros
                        if (phone_number_id && value.metadata?.phone_number_id !== phone_number_id) {
                            return;
                        }

                        const contact = value.contacts?.[0];
                        const wa_id = contact?.wa_id;
                        // Extraer el BSUID (Business-Scoped User ID)
                        const bsuid = contact?.user_id || value.messages?.[0]?.from_user_id;

                        value.messages.forEach((msg: any) => {
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

                            const formatedMessage: any = {
                                body: messageBody,
                                from: wa_id || msg.from,
                                phoneNumber: msg.from,
                                userId: bsuid, // Añadimos el BSUID al contexto
                                name: contact?.profile?.name || 'User',
                                type: type,
                                payload: msg
                            };

                            // Enriquecer con objeto media para que los flujos (saveFile) tengan lo necesario
                            if (mediaObj) {
                                formatedMessage.media = {
                                    url: mediaObj.link || mediaObj.url || null,
                                    mimetype: mediaObj.mime_type || mediaObj.mimetype || null,
                                    id: mediaObj.id || null
                                };
                            }

                            this.emit('message', formatedMessage);
                        });
                    }
                });
            });
        } catch (e) {
            console.error('❌ [MetaCloudProvider] Error procesando mensaje entrante:', e);
        }
    }
}

export { MetaCloudProvider };

