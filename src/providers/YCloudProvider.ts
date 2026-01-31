import { ProviderClass } from '@builderbot/bot';
import axios from 'axios';

class YCloudProvider extends ProviderClass {
    globalVendorArgs: any;

    constructor(args: any = {}) {
        super();
        this.globalVendorArgs = args;
    }

    protected initProvider() {
        console.log('[YCloudProvider] Listo. Esperando Webhooks...');
    }

    public async initVendor() {
        this.vendor = {};
        return this.vendor;
    }

    public beforeHttpServerInit() {
    }

    public afterHttpServerInit() {
    }

    public busEvents = () => {
        return [];
    };

    public saveFile() {
        return Promise.resolve('no-file');
    }

    public async sendMessage(number: string, message: string, options: any = {}): Promise<any> {
        const apiKey = process.env.YCLOUD_API_KEY;
        const fromNumber = process.env.YCLOUD_WABA_NUMBER;

        if (!apiKey) {
            console.error('[YCloudProvider] Error: YCLOUD_API_KEY no definida en variables de entorno.');
            return;
        }

        if (!fromNumber) {
            console.error('[YCloudProvider] Error: YCLOUD_WABA_NUMBER no definida en variables de entorno.');
            return;
        }

        const url = 'https://api.ycloud.com/v2/whatsapp/messages';
        const cleanNumber = number.replace(/\D/g, '');

        const body: any = {
            from: fromNumber.replace(/\D/g, ''),
            to: cleanNumber,
            type: 'text',
            text: { body: message }
        };

        try {
            const response = await axios.post(url, body, {
                headers: {
                    'X-API-Key': apiKey,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error: any) {
            console.error('[YCloudProvider] Error enviando mensaje:', JSON.stringify(error?.response?.data || error.message, null, 2));
            return Promise.resolve(null);
        }
    }

    public handleWebhook = (req: any, res: any) => {
        try {
            const body = req.body;
            console.log('[YCloudProvider] Webhook recibido:', JSON.stringify(body));

            if (body.type === 'whatsapp.inbound_message.received' && body.whatsappInboundMessage) {
                const msg = body.whatsappInboundMessage;
                const formatedMessage = {
                    body: msg.text?.body || 
                          msg.interactive?.button_reply?.title || 
                          msg.interactive?.list_reply?.title || 
                          msg.button?.text || '',
                    from: msg.from.replace('+', ''),
                    name: msg.customerProfile?.name || 'User',
                    type: msg.type,
                    payload: msg
                };
                this.emit('message', formatedMessage);
            } 
            else if (body.object === 'whatsapp_business_account' || body.entry) {
                body.entry?.forEach((entry: any) => {
                    entry.changes?.forEach((change: any) => {
                        if (change.value?.messages) {
                            change.value.messages.forEach((msg: any) => {
                                const formatedMessage = {
                                    body: msg.text?.body || 
                                          msg.interactive?.button_reply?.title || 
                                          msg.interactive?.list_reply?.title || 
                                          msg.button?.text || '',
                                    from: msg.from.replace('+', ''),
                                    name: msg.profile?.name || 'User',
                                    type: msg.type,
                                    payload: msg
                                };
                                this.emit('message', formatedMessage);
                            });
                        }
                    });
                });
            }

            if (!res.headersSent) {
                res.statusCode = 200;
                res.end('OK');
            }
        } catch (e) {
            console.error('[YCloudProvider] Error parsing webhook:', e);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Error');
            }
        }
    }
}

export { YCloudProvider };
