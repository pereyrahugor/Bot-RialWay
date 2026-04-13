
import { BaileysProvider } from 'builderbot-provider-sherpa';
import makeWASocket, { 
    DisconnectReason, 
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logger = pino({ level: 'error' });

export class SupabaseBaileysProvider extends BaileysProvider {
    saveCreds: any = null;
    private initialized = false;

    constructor(args: any = {}) {
        super(args);
        console.log(`[SupabaseBaileysProvider] 🏗️ Constructor instanciado para: ${args.name || 'default'}`);
        
        // Overrides
        const originalSendMessage = this.sendMessage.bind(this);
        this.sendMessage = async (number: string, message: string, options: any = {}) => {
            try {
                const isReady = !!(this.vendor?.authState?.creds?.me?.id || this.vendor?.user?.id);
                if (!isReady) return null;
                return await originalSendMessage(number, message, options);
            } catch (err: any) {
                return null;
            }
        };

        // Retardar inicio
        setTimeout(() => {
            this.initProvider().catch(err => {
                console.error('[SupabaseBaileysProvider] ❌ Error:', err.message);
            });
        }, 100);
    }

    protected async initProvider() {
        if (this.initialized && this.vendor?.ws?.isOpen) return;
        this.initialized = true;

        const authPath = path.join(process.cwd(), `bot_sessions/${this.globalVendorArgs.name || 'default'}`);
        if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
        
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        this.saveCreds = saveCreds;

        this.vendor = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger as any),
            },
            logger: logger as any,
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            ...this.globalVendorArgs
        }) as any;

        this.vendor.ev.on('creds.update', this.saveCreds);

        this.vendor.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr || connection) {
                console.log(`[SupabaseBaileysProvider] 📡 Status [${this.globalVendorArgs.name}]: connection=${connection || 'pending'}, hasQR=${!!qr}`);
            }

            if (qr) {
                this.emit('qr', qr);
                this.emit('require_action', {
                    title: 'Vincular WhatsApp',
                    instructions: ['Escanea el código QR'],
                    payload: { qr },
                });
            }

            if (connection === 'open') {
                this.emit('ready', true);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) this.initProvider();
            }
        });

        this.vendor.ev.on('messages.upsert', async ({ messages, type }: any) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
                const from = msg.key.remoteJid;
                const messageType = Object.keys(msg.message || {})[0] || 'text';
                
                const typeMapping: any = { audioMessage: 'voice', imageMessage: 'image', videoMessage: 'video' };
                const type = typeMapping[messageType] || 'text';
                const finalBody = body || (type !== 'text' ? `_event_${type}_` : '');

                const payload = { body: finalBody, from, phoneNumber: from?.split('@')[0], name: msg.pushName || 'User', type, payload: msg };

                if (msg.key.fromMe) {
                    this.emit('message_from_me', payload);
                    continue;
                }
                if (msg.message) this.emit('message', payload);
            }
        });
    }
}
