
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
    public preventAutoStart = false;
    private initialized = false;
    private lidToPnCache = new Map<string, string>();

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
     * Anula el marcado automático como leído de BuilderBot
     */
    public sendSeen = async (number: string): Promise<any> => {
        // No-op para evitar que el bot marque los mensajes como leídos de forma automática
        return null;
    }

    /**
     * Envía un sticker de forma nativa usando Baileys
     */
    // @ts-ignore - signature differs from base class intentionally
    public sendSticker = async (number: string, mediaPath: string): Promise<any> => {
        try {
            const isReady = !!(this.vendor?.authState?.creds?.me?.id || this.vendor?.user?.id);
            if (!isReady) {
                console.error('[SupabaseBaileysProvider] ❌ Socket no listo para enviar sticker');
                return null;
            }
            const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
            const absolutePath = path.isAbsolute(mediaPath) ? mediaPath : path.resolve(mediaPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[SupabaseBaileysProvider] ❌ El archivo de sticker no existe: ${absolutePath}`);
                return null;
            }
            console.log(`[SupabaseBaileysProvider] 📤 Enviando sticker via Baileys nativo a ${jid}: ${absolutePath}`);
            const buffer = fs.readFileSync(absolutePath);
            const response = await this.vendor.sendMessage(jid, { sticker: buffer });
            return response;
        } catch (err: any) {
            console.error('[SupabaseBaileysProvider] ❌ Error enviando sticker:', err);
            return null;
        }
    }

    /**
     * BuilderBot define initVendor como una propiedad asignada a una función.
     * Debemos seguir el mismo patrón para evitar conflictos de tipos.
     */
    public initVendor = async (): Promise<any> => {
        return await this.initProvider();
    }

    /**
     * Anula el registro de listeners automáticos de la clase base.
     * Evita que se dupliquen las suscripciones al evento `messages.upsert`
     * y por ende que el bot responda dos veces. Todo el flujo se controla
     * en nuestro `initProvider` personalizado.
     */
    protected listenOnEvents = (vendor: any): void => {
        // No-op
    }

    protected initProvider = async (): Promise<any> => {
        // Evitar múltiples inicializaciones simultáneas
        if (this.initialized && this.vendor?.ws?.isOpen) {
            console.log(`[SupabaseBaileysProvider] ℹ️ Conexión ya activa para ${this.globalVendorArgs.name}. Saltando.`);
            return this.vendor;
        }

        if (this.preventAutoStart) {
            console.log(`[SupabaseBaileysProvider] ℹ️ Auto-start prevenido para ${this.globalVendorArgs.name || 'default'}. Esperando activación manual.`);
            return null;
        }

        const { useSupabaseAuthState } = await import('../db/supabaseAdapter');
        const { vault } = await import('../db/vault');
        
        const supabaseUrl = process.env.SUPABASE_URL || vault.supabaseUrl;
        const supabaseKey = process.env.SUPABASE_KEY || vault.supabaseKey;
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

        // --- STORE INICIALIZACIÓN (DESACTIVADO POR RENDIMIENTO) ---
        (this as any).store = null;

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

        // Asignar el store al vendor como null para fácil acceso y compatibilidad
        (this.vendor as any).store = null;

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
                    const { deleteSessionFromDb } = await import('./sessionSync');
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

                        let from = msg.key.remoteJid;
                        if (from && from.endsWith('@lid')) {
                            const cachedPn = this.lidToPnCache.get(from);
                            if (cachedPn) {
                                from = cachedPn;
                            } else {
                                try {
                                    const { HistoryHandler } = await import('../db/historyHandler');
                                    const dbSupabase = HistoryHandler.getSupabase();
                                    if (dbSupabase) {
                                        const projectId = process.env.RAILWAY_PROJECT_ID || 'local-dev';
                                        const { data } = await dbSupabase
                                            .from('chats')
                                            .select('id')
                                            .eq('metadata->>lid', from)
                                            .eq('project_id', projectId)
                                            .maybeSingle();
                                        if (data && data.id) {
                                            const resolvedPn = `${data.id}@s.whatsapp.net`;
                                            this.lidToPnCache.set(from, resolvedPn);
                                            from = resolvedPn;
                                        }
                                    }
                                } catch (dbErr) {
                                    // ignore
                                }
                            }
                        }

                        this.emit('message_from_me', {
                            body,
                            from,
                            isManualIntervention: true,
                            id: msg.key.id,
                            platform: 'whatsapp'
                        });
                    }
                    continue;
                }

                const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
                let from = msg.key.remoteJid;

                //--- FILTRADO DE GRUPOS ---
                // Si el mensaje viene de un grupo (@g.us), lo ignoramos para evitar que el bot responda
                if (from?.endsWith('@g.us')) {
                    continue;
                }

                // Si el JID de origen es un LID, lo resolvemos a su número de teléfono real usando senderPn
                if (from && from.endsWith('@lid')) {
                    const resolvedPn = msg.key.senderPn;
                    if (resolvedPn && resolvedPn.endsWith('@s.whatsapp.net')) {
                        console.log(`[SupabaseBaileysProvider] 🔄 Detectado LID (${from}). Resolviendo a JID de teléfono: ${resolvedPn}`);
                        this.lidToPnCache.set(from, resolvedPn);
                        from = resolvedPn;
                    }
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

    /**
     * Detiene la conexión del socket de Baileys y limpia los recursos del motor.
     */
    public stopProvider = async (): Promise<void> => {
        console.log(`[SupabaseBaileysProvider] 🛑 Deteniendo instancia para: ${this.globalVendorArgs.name || 'default'}`);
        this.initialized = false;
        this.qrCodeString = null;
        
        if (this.vendor) {
            try {
                this.vendor.ev.removeAllListeners('connection.update');
                this.vendor.ev.removeAllListeners('creds.update');
                this.vendor.ev.removeAllListeners('messages.upsert');
                this.vendor.end(undefined);
            } catch (e) {
                // Ignore close errors
            }
            (this as any).vendor = null;
        }
        
        // Limpiar archivo QR local
        const qrFilename = this.globalVendorArgs.name?.includes('groups') ? 'bot.groups.qr.png' : 'bot.qr.png';
        const qrPath = path.join(process.cwd(), qrFilename);
        if (fs.existsSync(qrPath)) {
            try { fs.unlinkSync(qrPath); } catch (e) { /* ignore */ }
        }
    }
}
