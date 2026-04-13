
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
    qrCodeString: string | null = null;
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

        const { useSupabaseAuthState } = await import('../utils/supabaseAdapter');
        
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;
        const projectId = process.env.RAILWAY_PROJECT_ID || 'default_project';
        const botName = this.globalVendorArgs.name || 'default';

        if (!supabaseUrl || !supabaseKey) {
            console.error('[SupabaseBaileysProvider] ❌ Faltan SUPABASE_URL o SUPABASE_KEY en el entorno.');
            return;
        }

        const { state, saveCreds } = await useSupabaseAuthState(
            supabaseUrl,
            supabaseKey,
            projectId,
            botName, // Usar el nombre del bot como session_id para evitar conflictos
            botName
        );
        
        this.saveCreds = saveCreds;

        this.vendor = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger as any),
            },
            logger: logger as any,
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            browser: ["Ubuntu", "Chrome", "131.0.6778.85"],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            linkPreviewImageThumbnailWidth: 192,
            ...this.globalVendorArgs
        }) as any;

        this.vendor.ev.on('creds.update', async () => {
            await this.saveCreds();
        });

        this.vendor.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr || connection) {
                console.log(`[SupabaseBaileysProvider] 📡 Status [${this.globalVendorArgs.name}]: connection=${connection || 'pending'}, hasQR=${!!qr}`);
            }

            if (qr) {
                this.qrCodeString = qr;
                this.emit('qr', qr);
                this.emit('require_action', {
                    title: 'Vincular WhatsApp',
                    instructions: ['Escanea el código QR'],
                    payload: { qr },
                });
            }

            if (connection === 'open') {
                console.log(`[SupabaseBaileysProvider] ✅ Conexión ABIERTA para: ${this.globalVendorArgs.name}`);
                this.emit('ready', true);
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'unknown';
                console.log(`[SupabaseBaileysProvider] ❌ Conexión CERRADA [${this.globalVendorArgs.name}]. Razón: ${reason} (Código: ${statusCode})`);
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log(`[SupabaseBaileysProvider] 🔄 Intentando reconexión en 5s...`);
                    setTimeout(() => this.initProvider(), 5000);
                } else {
                    console.log(`[SupabaseBaileysProvider] ⚠️ Sesión cerrada por el usuario o expirada. No se reconectará automáticamente.`);
                }
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
