import { BaileysProvider } from 'builderbot-provider-sherpa';
import { utils } from '@builderbot/bot';
import * as baileys from '@whiskeysockets/baileys';
const makeWASocket = (baileys as any).default || (baileys as any).makeWASocket || baileys;
import { 
    DisconnectReason, 
    makeCacheableSignalKeyStore,
    Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logger = pino({ level: 'error' });

export class SupabaseBaileysProvider extends BaileysProvider {
    saveCreds: any = null;
    qrCodeString: string | null = null;
    public pairingCode: string | null = null;
    public preventAutoStart = false;
    public initialized = false;
    private lidToPnCache = new Map<string, string>();
    private connectionFailures = 0;
    private isConnecting = false;

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
    /**
     * Obtiene el mimetype de un mensaje de Baileys
     */
    private getMimeTypeCustom(msg: any): string | undefined {
        const message = msg.message;
        if (!message) return undefined;
        const { imageMessage, videoMessage, documentMessage, audioMessage, documentWithCaptionMessage } = message;
        return (imageMessage?.mimetype ??
            audioMessage?.mimetype ??
            videoMessage?.mimetype ??
            documentMessage?.mimetype ??
            documentWithCaptionMessage?.message?.documentMessage?.mimetype);
    }

    /**
     * Descarga y guarda archivos multimedia recibidos por Baileys,
     * preservando el nombre original del archivo si es un documento.
     */
    public saveFile = async (ctx: any, options: { path?: string } = {}): Promise<string> => {
        // El WAMessage original puede estar en payload o en ctx directamente
        const msg = ctx.payload || ctx;
        
        // Obtener mimetype
        const mimeType = this.getMimeTypeCustom(msg);
        if (!mimeType) {
            throw new Error("MIME type not found");
        }

        // Obtener la extensión
        // @ts-ignore
        const mimeModule = await import('mime-types');
        const mime = mimeModule.default || mimeModule;
        const extension = (mime as any).extension(mimeType) || 'bin';

        // Obtener el tipo de media
        let finalType = 'document';
        if (mimeType.startsWith('image/')) {
            finalType = 'image';
        } else if (mimeType.startsWith('video/')) {
            finalType = 'video';
        } else if (mimeType.startsWith('audio/')) {
            finalType = 'audio';
        }

        // Intentar extraer el nombre original si es un documento
        const docMsg = msg.message?.documentMessage || 
                       msg.message?.documentWithCaptionMessage?.message?.documentMessage || 
                       msg.documentMessage || 
                       null;
        
        let fileName = '';
        if (docMsg && docMsg.fileName) {
            // Sanitizar el nombre de archivo para evitar caracteres problemáticos
            const sanitized = docMsg.fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            fileName = `${Date.now()}-${sanitized}`;
            // Asegurar que termina con la extensión correcta si no la tiene
            if (!fileName.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) {
                fileName = `${fileName}.${extension}`;
            }
        } else {
            fileName = `file-${Date.now()}.${extension}`;
        }

        // Buscar el objeto de media con las llaves de descarga (mediaKey, url, directPath)
        const rawMsg = msg.message || msg;
        let targetMedia = rawMsg?.documentMessage 
            || rawMsg?.documentWithCaptionMessage?.message?.documentMessage 
            || rawMsg?.ephemeralMessage?.message?.documentMessage 
            || rawMsg?.viewOnceMessage?.message?.documentMessage 
            || rawMsg?.viewOnceMessageV2?.message?.documentMessage 
            || rawMsg?.imageMessage
            || rawMsg?.videoMessage
            || rawMsg?.audioMessage
            || rawMsg;

        if (targetMedia?.message) {
            targetMedia = targetMedia.message.documentMessage || targetMedia.message.imageMessage || targetMedia.message.videoMessage || targetMedia.message.audioMessage || targetMedia.message;
        }

        if (!targetMedia?.mediaKey && !targetMedia?.url && !targetMedia?.directPath) {
            const findMediaObj = (obj: any, depth = 0): any => {
                if (!obj || typeof obj !== 'object' || depth > 4) {
                    return null;
                }
                if (obj.mediaKey || obj.url || obj.directPath) {
                    return obj;
                }
                for (const k of Object.keys(obj)) {
                    if (k === 'key' || k === 'client' || k === 'provider') {
                        continue;
                    }
                    const res = findMediaObj(obj[k], depth + 1);
                    if (res) {
                        return res;
                    }
                }
                return null;
            };
            targetMedia = findMediaObj(msg) || targetMedia;
        }

        if (!targetMedia || (!targetMedia.url && !targetMedia.directPath && !targetMedia.mediaKey)) {
            throw new Error("No media credentials/keys found in message payload");
        }

        // Descargar el buffer usando whiskeysockets/baileys downloadContentFromMessage
        const { downloadContentFromMessage } = await import("@whiskeysockets/baileys");
        const stream = await downloadContentFromMessage(targetMedia, finalType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (buffer.length === 0) {
            throw new Error("Downloaded media buffer is empty");
        }

        const outPath = options.path || './tmp/';
        if (!fs.existsSync(outPath)) {
            fs.mkdirSync(outPath, { recursive: true });
        }

        const pathFile = path.join(process.cwd(), outPath, fileName);
        fs.writeFileSync(pathFile, buffer);
        
        return path.resolve(pathFile);
    }

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
        if (this.isConnecting) {
            console.log(`[SupabaseBaileysProvider] ℹ️ Ya hay un intento de conexión en curso para ${this.globalVendorArgs.name || 'default'}. Saltando.`);
            return null;
        }

        // Evitar múltiples inicializaciones simultáneas
        if (this.initialized && this.vendor?.ws?.isOpen) {
            console.log(`[SupabaseBaileysProvider] ℹ️ Conexión ya activa para ${this.globalVendorArgs.name}. Saltando.`);
            return this.vendor;
        }

        this.isConnecting = true;

        try {
            if (this.preventAutoStart) {
                console.log(`[SupabaseBaileysProvider] ℹ️ Auto-start prevenido para ${this.globalVendorArgs.name || 'default'}. Esperando activación manual.`);
                this.isConnecting = false;
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
                this.isConnecting = false;
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

            const serviceId = this.globalVendorArgs.service_id || null;

            const { state, saveCreds } = await useSupabaseAuthState(
                supabaseUrl,
                supabaseKey,
                projectId,
                botName,
                botName,
                serviceId
            );
            
            this.saveCreds = saveCreds;
            this.initialized = true;

            // --- STORE INICIALIZACIÓN (DESACTIVADO POR RENDIMIENTO) ---
            (this as any).store = null;

            // Usar versión fija conocida de WhatsApp Web para mantener activa la sesión tras reinicios o redeploys
            const version: any = [2, 3000, 1043857760];
            console.log(`[SupabaseBaileysProvider] 📡 Usando versión fija de WhatsApp Web: v${version.join('.')}`);

            console.log(`[SupabaseBaileysProvider] 📡 Iniciando socket con globalVendorArgs:`, JSON.stringify(this.globalVendorArgs));

            const { browser, ...cleanVendorArgs } = this.globalVendorArgs;

            this.vendor = makeWASocket({
                ...cleanVendorArgs,
                browser: Browsers.ubuntu('Chrome'),
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger as any),
                },
                logger: logger as any,
                printQRInTerminal: false,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                markOnlineOnConnect: false,
                linkPreviewImageThumbnailWidth: 192
            }) as any;

            // Asignar el store al vendor como null para fácil acceso y compatibilidad
            (this.vendor as any).store = null;

            const usePairingCode = this.globalVendorArgs.usePairingCode;
            const phoneNumber = this.globalVendorArgs.phoneNumber;

            if (usePairingCode && !this.vendor.authState.creds.registered) {
                if (phoneNumber) {
                    const cleanPhone = phoneNumber.replace(/\D/g, '');
                    console.log(`[SupabaseBaileysProvider] 🔑 Solicitando código de vinculación para: ${cleanPhone}...`);
                    setTimeout(async () => {
                        try {
                            const code = await this.vendor.requestPairingCode(cleanPhone);
                            this.pairingCode = code;
                            this.emit('pairing_code', code);
                            console.log(`[SupabaseBaileysProvider] 🔑 Código de vinculación recibido: ${code}`);
                        } catch (err: any) {
                            console.error('[SupabaseBaileysProvider] ❌ Error requesting pairing code:', err);
                        }
                    }, 5000);
                } else {
                    console.error('[SupabaseBaileysProvider] ❌ Se solicitó pairing code pero no se configuró un número de teléfono.');
                }
            }

            this.vendor.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }: any) => {
                if (!botName.includes('groups')) {
                    console.log(`[SupabaseBaileysProvider] 📥 [${botName}] History Sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contactos, ${messages?.length || 0} mensajes. (isLatest: ${isLatest})`);
                }
                if (contacts && Array.isArray(contacts)) {
                    for (const c of contacts) {
                        if (c.id && c.id.endsWith('@lid') && c.phone) {
                            const formattedPhone = `${c.phone}@s.whatsapp.net`;
                            if (!botName.includes('groups')) {
                                console.log(`[SupabaseBaileysProvider] 🔗 Mapeo LID detectado en history sync: ${c.id} -> ${formattedPhone}`);
                            }
                            this.lidToPnCache.set(c.id, formattedPhone);
                        }
                    }
                }
            });

            this.vendor.ev.on('contacts.upsert', (contacts: any) => {
                if (!botName.includes('groups')) {
                    console.log(`[SupabaseBaileysProvider] 📥 [${botName}] Contacts Upsert: ${contacts?.length || 0} nuevos contactos.`);
                }
                for (const c of contacts) {
                    if (c.id && (c.id.endsWith('@lid') || c.id.endsWith('@s.whatsapp.net'))) {
                        if (!botName.includes('groups')) {
                            console.log(`[SupabaseBaileysProvider] 👥 Contact Upsert details: id=${c.id}, name=${c.name || c.verifiedName || ''}, phone=${c.phone || ''}`);
                        }
                        // Si el contacto viene con id (LID) y campo phone (número de teléfono), guardamos el mapeo en cache
                        if (c.id.endsWith('@lid') && c.phone) {
                            const formattedPhone = `${c.phone}@s.whatsapp.net`;
                            if (!botName.includes('groups')) {
                                console.log(`[SupabaseBaileysProvider] 🔗 Mapeo LID detectado en upsert: ${c.id} -> ${formattedPhone}`);
                            }
                            this.lidToPnCache.set(c.id, formattedPhone);
                        }
                    }
                }
            });

            this.vendor.ev.on('contacts.update', (updates: any) => {
                for (const u of updates) {
                    if (u.id && (u.id.endsWith('@lid') || u.id.endsWith('@s.whatsapp.net'))) {
                        if (!botName.includes('groups')) {
                            console.log(`[SupabaseBaileysProvider] 👥 Contact Update details:`, JSON.stringify(u));
                        }
                        if (u.id.endsWith('@lid') && u.phone) {
                            const formattedPhone = `${u.phone}@s.whatsapp.net`;
                            if (!botName.includes('groups')) {
                                console.log(`[SupabaseBaileysProvider] 🔗 Mapeo LID detectado en update: ${u.id} -> ${formattedPhone}`);
                            }
                            this.lidToPnCache.set(u.id, formattedPhone);
                        }
                    }
                }
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
                    const usePairingCode = this.globalVendorArgs.usePairingCode;
                    if (!usePairingCode) {
                        this.qrCodeString = qr;
                        this.emit('qr', qr);
                        this.emit('require_action', {
                            title: 'Vincular WhatsApp',
                            instructions: ['Escanea el código QR'],
                            payload: { qr },
                        });
                    } else {
                        console.log(`[SupabaseBaileysProvider] ℹ️ Omitiendo emisión de QR porque usePairingCode está activo.`);
                    }
                }

                if (connection === 'open') {
                    console.log(`[SupabaseBaileysProvider] ✅ Conexión ABIERTA para: ${this.globalVendorArgs.name}`);
                    this.isConnecting = false; // Resetear bandera al conectar con éxito
                    this.connectionFailures = 0; // Resetear contador al conectar con éxito
                    this.qrCodeString = null; // Limpiar QR al conectar
                    this.pairingCode = null; // Limpiar código al conectar
                    this.emit('ready', true);
                }

                if (connection === 'close') {
                    this.isConnecting = false; // Resetear bandera al cerrar la conexión
                    this.connectionFailures++;
                    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || 'unknown';
                    console.log(`[SupabaseBaileysProvider] ❌ Conexión CERRADA [${this.globalVendorArgs.name}]. Razón: ${reason} (Código: ${statusCode}) (Fallo consecutivo #${this.connectionFailures})`);
                    
                    this.initialized = false;
                    this.qrCodeString = null;
                    this.pairingCode = null; // Limpiar código al cerrar
                    
                    if (this.preventAutoStart) {
                        console.log(`[SupabaseBaileysProvider] ℹ️ Conexión cerrada intencionalmente para ${this.globalVendorArgs.name}. No se reintentará reconexión.`);
                        return;
                    }
                    
                    // Si hay 3 o más fallos consecutivos, asumimos que las credenciales están obsoletas o corruptas y las limpiamos.
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                    const isCorrupted = this.connectionFailures >= 3;

                    if (isLoggedOut || isCorrupted) {
                        console.log(`[SupabaseBaileysProvider] ⚠️ Sesión inválida o corrupta (${isLoggedOut ? 'Logout' : 'Límite de 3 fallos superado'}). Limpiando credenciales de la DB y solicitando nuevo QR...`);
                        this.connectionFailures = 0; // Resetear
                        const { deleteSessionFromDb } = await import('./sessionSync');
                        await deleteSessionFromDb(this.globalVendorArgs.name);
                        
                        // Reiniciar para generar nuevo QR
                        setTimeout(() => this.initProvider(), 1000);
                    } else {
                        // Si el error es 515 (restartRequired), reintentamos rápidamente en 5 segundos.
                        const delay = (statusCode === 515 || statusCode === DisconnectReason.restartRequired) ? 5000 : 15000;
                        console.log(`[SupabaseBaileysProvider] 🔄 Reintentando en ${delay / 1000}s...`);
                        setTimeout(() => this.initProvider(), delay);
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
                            if (!botName.includes('groups')) {
                                console.log(`[SupabaseBaileysProvider] 📤 DETECTADO manual fromMe msg remoteJid=${from}, keyDetails=`, JSON.stringify(msg.key));
                            }
                            if (from && from.endsWith('@lid')) {
                                let resolvedPn = this.lidToPnCache.get(from);
                                
                                if (!resolvedPn) {
                                    try {
                                        const { HistoryHandler } = await import('../db/historyHandler.js');
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
                                                resolvedPn = `${data.id}@s.whatsapp.net`;
                                                this.lidToPnCache.set(from, resolvedPn);
                                            }
                                        }
                                    } catch (dbErr) {
                                        // ignore
                                    }
                                }
                                
                                if (resolvedPn) {
                                    from = resolvedPn;
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

                    //--- DECODIFICACIÓN Y REENVÍO DE MENSAJES ENTRANTES ---
                    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
                    let from = msg.key.remoteJid;

                    //--- FILTRADO DE GRUPOS Y ESTADOS (STORIES) ---
                    if (from?.endsWith('@g.us') || from === 'status@broadcast') {
                        continue;
                    }

                    // Si el JID de origen es un LID, lo resolvemos a su número de teléfono real usando senderPn
                    if (from && from.endsWith('@lid')) {
                        const resolvedPn = msg.key.senderPn || this.lidToPnCache.get(from);
                        if (resolvedPn && resolvedPn.endsWith('@s.whatsapp.net')) {
                            if (!botName.includes('groups')) {
                                console.log(`[SupabaseBaileysProvider] 🔄 Detectado LID (${from}). Resolviendo a JID de teléfono: ${resolvedPn}`);
                            }
                            
                            const lid = from.split('@')[0];
                            const phone = resolvedPn.split('@')[0];
                            const projectId = process.env.RAILWAY_PROJECT_ID || 'local-dev';
                            
                            // Migrar chat y mensajes en Supabase
                            migrateLidChatToPhone(lid, phone, projectId).catch(console.error);

                            this.lidToPnCache.set(from, resolvedPn);
                            from = resolvedPn;
                        }
                    }

                    const messageType = Object.keys(msg.message || {})[0] || 'text';
                    let finalType = 'text';
                    let finalBody = body || '';

                    if (msg.message?.imageMessage) {
                        finalType = 'image';
                        finalBody = utils.generateRefProvider('_event_media_');
                    } else if (msg.message?.videoMessage) {
                        finalType = 'video';
                        finalBody = utils.generateRefProvider('_event_media_');
                    } else if (msg.message?.audioMessage) {
                        finalType = 'voice';
                        finalBody = utils.generateRefProvider('_event_voice_note_');
                    } else if (msg.message?.documentMessage || msg.message?.documentWithCaptionMessage) {
                        finalType = 'document';
                        finalBody = utils.generateRefProvider('_event_document_');
                    } else if (msg.message?.locationMessage) {
                        finalType = 'location';
                        finalBody = utils.generateRefProvider('_event_location_');
                    } else if (msg.message?.stickerMessage) {
                        finalType = 'image';
                        finalBody = utils.generateRefProvider('_event_media_');
                    }

                    const payload: any = { body: finalBody, from, phoneNumber: from?.split('@')[0], name: msg.pushName || 'User', type: finalType, payload: msg };

                    const isMedia = ['image', 'video', 'voice', 'document'].includes(finalType);
                    if (isMedia) {
                        // Asegurar mimetypes por defecto para evitar errores en saveFile
                        const docMsg = msg.message?.documentMessage || msg.message?.documentWithCaptionMessage?.message?.documentMessage;
                        if (docMsg && !docMsg.mimetype) {
                            const fileName = docMsg.fileName || '';
                            const ext = fileName.split('.').pop()?.toLowerCase();
                            if (ext === 'png') {
                                docMsg.mimetype = "image/png";
                            } else if (ext === 'jpg' || ext === 'jpeg') {
                                docMsg.mimetype = "image/jpeg";
                            } else {
                                docMsg.mimetype = "application/pdf";
                            }
                        }

                        try {
                            const { SystemLogger } = await import('../utils/logger.js');
                            await SystemLogger.info('SYSTEM', `Iniciando auto-descarga de archivo Baileys. Tipo: ${finalType}`, null, { msgKey: msg.key });

                            if (!fs.existsSync("./tmp/")) {
                                fs.mkdirSync("./tmp/", { recursive: true });
                            }
                            const localPath = await this.saveFile(msg, { path: "./tmp/" });
                            if (localPath) {
                                payload.localPath = localPath;
                                // No sobreescribir payload.body para no romper el enrutamiento de BuilderBot (EVENTS.DOCUMENT / EVENTS.IMAGE)
                                await SystemLogger.info('SYSTEM', `Auto-descarga exitosa. localPath: ${localPath}`, null, { msgKey: msg.key });
                            } else {
                                await SystemLogger.warn('SYSTEM', `Auto-descarga retornó localPath vacío`, null, { msgKey: msg.key });
                            }
                        } catch (downloadErr: any) {
                            console.error('[SupabaseBaileysProvider] ❌ Error auto-descargando archivo multimedia:', downloadErr.stack || downloadErr.message || downloadErr);
                            try {
                                const { SystemLogger } = await import('../utils/logger.js');
                                await SystemLogger.error('SYSTEM', `Error auto-descargando archivo Baileys: ${downloadErr.message}`, null, { stack: downloadErr.stack, msgKey: msg.key });
                                fs.appendFileSync('download_error.log', `[${new Date().toISOString()}] Error: ${downloadErr.message}\nStack: ${downloadErr.stack}\nMsg: ${JSON.stringify(msg)}\n\n`);
                            } catch (logErr) { /* ignore */ }
                        }
                    }

                    if (msg.message) this.emit('message', payload);
                }
            });

            // SHIM: builderbot espera que el vendor tenga un método .on para registrar listeners.
            // Como el socket de Baileys usa .ev.on, redirigimos las llamadas de .on a nuestro propio emisor.
            (this.vendor as any).on = (event: string, handler: any) => this.on(event, handler);

            return this.vendor;
        } catch (err: any) {
            console.error(`[SupabaseBaileysProvider] ❌ Error durante la inicialización del proveedor:`, err);
            this.isConnecting = false;
            throw err;
        }
    }

    /**
     * Detiene la conexión del socket de Baileys y limpia los recursos del motor.
     */
     public stopProvider = async (): Promise<void> => {
        console.log(`[SupabaseBaileysProvider] 🛑 Deteniendo instancia para: ${this.globalVendorArgs.name || 'default'}`);
        this.initialized = false;
        this.preventAutoStart = true;
        this.qrCodeString = null;
        this.pairingCode = null;
        
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

async function migrateLidChatToPhone(lid: string, phone: string, projectId: string) {
    try {
        const { HistoryHandler } = await import('../db/historyHandler.js');
        const supabase = HistoryHandler.getSupabase();
        if (!supabase) return;

        console.log(`[SupabaseBaileysProvider] 🔄 Iniciando migración de chat LID a Teléfono: ${lid} -> ${phone} (Proyecto: ${projectId})`);

        // 1. Verificar si existe el chat con el LID
        const { data: lidChat, error: fetchLidErr } = await supabase
            .from('chats')
            .select('*')
            .eq('id', lid)
            .eq('project_id', projectId)
            .maybeSingle();

        if (fetchLidErr) {
            console.error(`[SupabaseBaileysProvider] Error buscando chat LID:`, fetchLidErr.message);
            return;
        }

        if (!lidChat) {
            console.log(`[SupabaseBaileysProvider] ℹ️ No existe chat en DB con LID '${lid}'. No se requiere migración.`);
            return;
        }

        // 2. Verificar si existe el chat con el Teléfono
        const { data: phoneChat, error: fetchPhoneErr } = await supabase
            .from('chats')
            .select('*')
            .eq('id', phone)
            .eq('project_id', projectId)
            .maybeSingle();

        if (fetchPhoneErr) {
            console.error(`[SupabaseBaileysProvider] Error buscando chat teléfono:`, fetchPhoneErr.message);
            return;
        }

        if (!phoneChat) {
            // Caso A: No existe el chat del teléfono. Lo creamos copiando los datos del chat LID.
            console.log(`[SupabaseBaileysProvider] 📝 Creando chat de teléfono '${phone}' con datos de LID...`);
            const newChatData = {
                ...lidChat,
                id: phone,
                metadata: {
                    ...(lidChat.metadata || {}),
                    lid: `${lid}@lid`
                }
            };
            delete (newChatData as any).chat_tags; // Eliminar campos de relación si existen

            const { error: insertErr } = await supabase
                .from('chats')
                .insert(newChatData);

            if (insertErr) {
                console.error(`[SupabaseBaileysProvider] Error creando chat de teléfono:`, insertErr.message);
                return;
            }
        } else {
            // Caso B: El chat del teléfono ya existe. Actualizamos su metadata para conservar el LID.
            console.log(`[SupabaseBaileysProvider] 📝 Chat de teléfono '${phone}' ya existe. Vinculando LID en metadata...`);
            const updatedMeta = {
                ...(phoneChat.metadata || {}),
                lid: `${lid}@lid`
            };
            await supabase
                .from('chats')
                .update({ metadata: updatedMeta })
                .eq('id', phone)
                .eq('project_id', projectId);
        }

        // 3. Mover mensajes del chat LID al chat Teléfono
        const { error: updateMsgsErr } = await supabase
            .from('messages')
            .update({ chat_id: phone })
            .eq('chat_id', lid)
            .eq('project_id', projectId);

        if (updateMsgsErr) {
            console.error(`[SupabaseBaileysProvider] Error migrando mensajes de LID a Teléfono:`, updateMsgsErr.message);
        } else {
            console.log(`[SupabaseBaileysProvider] ✅ Mensajes migrados.`);
        }

        // 4. Mover tickets
        await supabase
            .from('tickets')
            .update({ chat_id: phone })
            .eq('chat_id', lid)
            .eq('project_id', projectId);

        // 5. Mover tags
        await supabase
            .from('chat_tags')
            .update({ chat_id: phone })
            .eq('chat_id', lid)
            .eq('project_id', projectId);

        // 6. Actualizar el chat LID en lugar de eliminarlo (para mantener compatibilidad con webs externas)
        console.log(`[SupabaseBaileysProvider] 📝 Sincronizando chat LID '${lid}' con el de Teléfono '${phone}'...`);
        const updatedLidMeta = {
            ...(lidChat.metadata || {}),
            phone_jid: `${phone}@s.whatsapp.net`
        };
        const { error: updateLidErr } = await supabase
            .from('chats')
            .update({
                name: phoneChat?.name || lidChat.name,
                email: phoneChat?.email || lidChat.email,
                notes: phoneChat?.notes || lidChat.notes,
                source: phoneChat?.source || lidChat.source,
                crm_status: phoneChat?.crm_status || lidChat.crm_status,
                crm_due_date: phoneChat?.crm_due_date || lidChat.crm_due_date,
                is_lead: phoneChat?.is_lead !== undefined ? phoneChat.is_lead : lidChat.is_lead,
                cuit_dni: phoneChat?.cuit_dni || lidChat.cuit_dni,
                address: phoneChat?.address || lidChat.address,
                tax_status: phoneChat?.tax_status || lidChat.tax_status,
                offered_product: phoneChat?.offered_product || lidChat.offered_product,
                assigned_to: phoneChat?.assigned_to || lidChat.assigned_to,
                metadata: updatedLidMeta
            })
            .eq('id', lid)
            .eq('project_id', projectId);

        if (updateLidErr) {
            console.error(`[SupabaseBaileysProvider] Error actualizando chat LID:`, updateLidErr.message);
        } else {
            console.log(`[SupabaseBaileysProvider] ✅ Chat LID '${lid}' sincronizado y conservado correctamente. Migración finalizada.`);
        }

    } catch (err: any) {
        console.error(`[SupabaseBaileysProvider] ❌ Excepción en la migración de chat LID:`, err.message);
    }
}
