import { ProviderClass } from '@builderbot/bot';
import axios from 'axios';

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

    public async saveFile(): Promise<string> {
        return "no-file";
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
    public afterHttpServerInit() {}

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

        const body: any = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanNumber
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
                if (mode && token) {
                    // Aquí deberíamos validar el token con el de nuestro .env
                    return res.end(challenge);
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

                        value.messages.forEach((msg: any) => {
                            const formatedMessage = {
                                body: msg.text?.body || 
                                      msg.interactive?.button_reply?.title || 
                                      msg.interactive?.list_reply?.title || 
                                      msg.button?.text || '',
                                from: wa_id || msg.from,
                                phoneNumber: msg.from,
                                name: contact?.profile?.name || 'User',
                                type: msg.type,
                                payload: msg
                            };
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
