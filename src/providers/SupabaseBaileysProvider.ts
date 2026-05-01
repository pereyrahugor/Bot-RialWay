
import { BaileysProvider } from 'builderbot-provider-sherpa';
import whaileys from 'whaileys';
const makeWASocket = (whaileys as any).default || whaileys;
import { 
    DisconnectReason, 
    makeCacheableSignalKeyStore,
} from 'whaileys';
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
        
        // Overrides para evitar envíos si no hay sesión
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
    }

    /**
     * BuilderBot define initVendor como una propiedad asignada a una función.
     * Debemos seguir el mismo patrón para evitar conflictos de tipos.
     */
    public initVendor = async (): Promise<any> => {
        return await this.initProvider();
    }

    protected initProvider = async (): Promise<any> => {
        // Evitar múltiples inicializaciones simultáneas
        if (this.initialized && this.vendor?.ws?.isOpen) {
            console.log(`[SupabaseBaileysProvider] ℹ️ Conexión ya activa para ${this.globalVendorArgs.name}. Saltando.`);
            return this.vendor;
        }

        const { useSupabaseAuthState } = await import('../utils/supabaseAdapter');
        
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_KEY;
        const projectId = process.env.RAILWAY_PROJECT_ID || 'local-dev';
        const botName = this.globalVendorArgs.name || 'default';

        if (!supabaseUrl || !supabaseKey) {
            console.error('[SupabaseBaileysProvider] ❌ Faltan SUPABASE_URL o SUPABASE_KEY en el entorno.');
            return null;
        }

        console.log(`[SupabaseBaileysProvider] 📡 Iniciando instancia para: ${botName}...`);
        
        // Cerrar socket previo si existe antes de crear uno nuevo
        if (this.vendor) {
            try {
                this.vendor.ev.removeAllListeners('connection.update');
                this.vendor.ev.removeAllListeners('creds.update');
                this.vendor.ev.removeAllListeners('messages.upsert');
                this.vendor.end(undefined);
            } catch (e) {
                // Ignorar fallos al cerrar
            }
        }

        const { state, saveCreds } = await useSupabaseAuthState(
            supabaseUrl,
            supabaseKey,
            projectId,
            botName,
            botName
        );
        
        this.saveCreds = saveCreds;
        this.initialized = true;

        // --- STORE INICIALIZACIÓN ---
        const sessionsDir = path.join(process.cwd(), 'sessions');
        if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
        
        const storeFile = path.join(sessionsDir, `${botName}_store.json`);
        
        if (!(this as any).store) {
            console.log(`[SupabaseBaileysProvider] 📦 Inicializando Store para ${botName}`);
            const { makeInMemoryStore } = await import('whaileys');
            const store = makeInMemoryStore({ logger: logger as any });
            
            if (fs.existsSync(storeFile)) {
                try {
                    console.log(`[SupabaseBaileysProvider] 📥 Cargando Store desde disco...`);
                    store.readFromFile(storeFile);
                } catch (e) {
                    console.warn(`[SupabaseBaileysProvider] ⚠️ No se pudo cargar el store previo:`, e);
                }
            }
            (this as any).store = store;

            // Auto-guardado periódico
            setInterval(() => {
                try {
                    store.writeToFile(storeFile);
                } catch (e) { /* ignore */ }
            }, 60000); // Cada 1 minuto
        }
        const store = (this as any).store;

        this.vendor = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger as any),
            },
            logger: logger as any,
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            syncFullHistory: true,
            markOnlineOnConnect: false,
            linkPreviewImageThumbnailWidth: 192,
            ...this.globalVendorArgs
        }) as any;

        // Asignar el store al vendor para fácil acceso desde rutas
        (this.vendor as any).store = store;

        // Vincular el store al socket
        console.log(`[SupabaseBaileysProvider] 📦 Vinculando InMemoryStore al socket de ${botName}...`);
        store.bind(this.vendor.ev as any);

        // Logging de eventos de historial para depuración
        this.vendor.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
            console.log(`[SupabaseBaileysProvider] 📥 [${botName}] History Sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contactos, ${messages?.length || 0} mensajes. (isLatest: ${isLatest})`);
        });

        this.vendor.ev.on('contacts.upsert', (contacts: any) => {
            console.log(`[SupabaseBaileysProvider] 📥 [${botName}] Contacts Upsert: ${contacts?.length || 0} nuevos contactos.`);
        });

        this.vendor.ev.on('creds.update', async () => {
            await this.saveCreds();
        });

        this.vendor.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr || (connection && connection !== 'connecting')) {
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
                this.qrCodeString = null; // Limpiar QR al conectar
                this.emit('ready', true);
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'unknown';
                console.log(`[SupabaseBaileysProvider] ❌ Conexión CERRADA [${this.globalVendorArgs.name}]. Razón: ${reason} (Código: ${statusCode})`);
                
                this.initialized = false;
                this.qrCodeString = null;
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log(`[SupabaseBaileysProvider] 🔄 Reintentando en 5s...`);
                    setTimeout(() => this.initProvider(), 5000);
                } else {
                    console.log(`[SupabaseBaileysProvider] ⚠️ Sesión cerrada por el usuario/logout. Limpiando credenciales y solicitando nuevo QR...`);
                    const { deleteSessionFromDb } = await import('../utils/sessionSync');
                    await deleteSessionFromDb(this.globalVendorArgs.name);
                    
                    // Reiniciar para generar nuevo QR
                    setTimeout(() => this.initProvider(), 1000);
                }
            }
        });

        this.vendor.ev.on('messages.upsert', async ({ messages, type }: any) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                //--- FILTRADO DE MENSAJES PROPIOS (EVITAR ECHOES DEL BOT) ---
                if (msg.key.fromMe) {
                    // Solo emitir 'message_from_me' si NO es un mensaje que acabamos de enviar nosotros como bot
                    // Heurística: Si no tiene 'messageContextInfo' es muy probable que sea intervención manual desde el celular
                    const isManual = !msg.message?.protocolMessage && !msg.messageContextInfo;
                    
                    if (isManual) {
                        const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                        if (!body) continue;

                        this.emit('message_from_me', {
                            body,
                            from: msg.key.remoteJid,
                            isManualIntervention: true,
                            id: msg.key.id,
                            platform: 'whatsapp'
                        });
                    }
                    continue;
                }

                const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
                const from = msg.key.remoteJid;

                //--- FILTRADO DE GRUPOS ---
                // Si el mensaje viene de un grupo (@g.us), lo ignoramos para evitar que el bot responda
                if (from?.endsWith('@g.us')) {
                    continue;
                }
                
                const messageType = Object.keys(msg.message || {})[0] || 'text';
                
                const typeMapping: any = { audioMessage: 'voice', imageMessage: 'image', videoMessage: 'video' };
                const finalType = typeMapping[messageType] || 'text';
                const finalBody = body || (finalType !== 'text' ? `_event_${finalType}_` : '');

                const payload = { body: finalBody, from, phoneNumber: from?.split('@')[0], name: msg.pushName || 'User', type: finalType, payload: msg };
                if (msg.message) this.emit('message', payload);
            }
        });

        // SHIM: builderbot espera que el vendor tenga un método .on para registrar listeners.
        // Como el socket de Baileys usa .ev.on, redirigimos las llamadas de .on a nuestro propio emisor.
        (this.vendor as any).on = (event: string, handler: any) => this.on(event, handler);

        return this.vendor;
    }
}
