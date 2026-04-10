
import { BaileysProvider } from 'builderbot-provider-sherpa';
import makeWASocket, { 
    DisconnectReason, 
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    isJidUser 
} from '@whiskeysockets/baileys';
import { EventEmitter } from 'events';
import pino from 'pino';
import path from 'path';
import fs from 'fs';

// Logger compatible con Baileys
const logger = pino({ level: 'error' });

/**
 * Provider personalizado extendiendo de Sherpa/Baileys para inyectar persistencia local.
 * La sincronización con la nube la maneja externamente sessionSync.ts
 */
export class SupabaseBaileysProvider extends BaileysProvider {
    saveCreds: any = null;
    clearSession: any = null;
    private initialized = false;

    constructor(args: any = {}) {
        super(args);
        console.log('[SupabaseBaileysProvider] 🏗️ Constructor instanciado. Forzando initProvider...');
        
        // --- Overrides de seguridad para propiedades del padre ---
        const originalSendMessage = this.sendMessage.bind(this);
        this.sendMessage = async (number: string, message: string, options: any = {}) => {
            try {
                const isReady = !!(this.vendor?.authState?.creds?.me?.id || this.vendor?.user?.id);
                if (!isReady) {
                    console.warn(`[SupabaseBaileysProvider] 🚫 Envío bloqueado a ${number}: Sin sesión.`);
                    return null;
                }
                return await originalSendMessage(number, message, options);
            } catch (err: any) {
                console.error(`[SupabaseBaileysProvider] ❌ Error en sendMessage:`, err.message);
                return null;
            }
        };

        const originalSendMedia = this.sendMedia.bind(this);
        this.sendMedia = async (number: string, media: string, caption: string) => {
            try {
                const isReady = !!(this.vendor?.authState?.creds?.me?.id || this.vendor?.user?.id);
                if (!isReady) {
                    console.warn(`[SupabaseBaileysProvider] 🚫 Envío media bloqueado a ${number}: Sin sesión.`);
                    return null;
                }
                return await originalSendMedia(number, media, caption);
            } catch (err: any) {
                console.error(`[SupabaseBaileysProvider] ❌ Error en sendMedia:`, err.message);
                return null;
            }
        };

        this.initProvider();
    }

    protected async initProvider() {
        // Si ya está inicializado, evitamos duplicar threads, pero permitimos reconexión si el socket está muerto
        if (this.initialized && this.vendor?.ws?.isOpen) {
             console.log('[SupabaseBaileysProvider] ⚠️ initProvider ya activo y conectado. Omitiendo.');
             return;
        }
        this.initialized = true;

        console.log('[SupabaseBaileysProvider] 🚀 Iniciando Provider (Uso de archivos locales)...');
        
        // 1. Cargar Auth State desde archivos locales (restaurados por SessionSync)
        const authPath = path.join(process.cwd(), `bot_sessions/${this.globalVendorArgs.name || 'default'}`);
        const credsExist = fs.existsSync(path.join(authPath, 'creds.json'));
        console.log(`[SupabaseBaileysProvider] ¿Existe creds.json en ${authPath}?: ${credsExist}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        console.log('[SupabaseBaileysProvider] ✅ Sistema de archivos cargado. Creando Socket...');
        
        this.saveCreds = saveCreds;

        // 2. Crear Socket usando la configuración base más nuestro auth
        this.vendor = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger as any),
            },
            logger: logger as any,
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            // Heredar argumentos que se pasaron al constructor
            ...this.globalVendorArgs
        }) as any;

        // 3. Re-implementar listeners críticos 
        // (Al crear un nuevo vendor, los listeners originales de la clase base no se adjuntan automáticamente)
        
        this.vendor.ev.on('creds.update', this.saveCreds);

        this.vendor.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.emit('require_action', {
                    title: 'Escanea el código QR',
                    instructions: [
                        `Debes escanear el QR Code para vincular el bot de proyecto ${process.env.RAILWAY_PROJECT_ID || 'local'}.`,
                        `Recuerda que el QR caduca en 60 segundos`,
                    ],
                    payload: { qr },
                });
            }

            if (connection === 'open') {
                this.emit('ready', true);
                console.log(`[SupabaseBaileysProvider] ✅ Bot conectado exitosamente (Proyecto: ${process.env.RAILWAY_PROJECT_ID}).`);
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('[SupabaseBaileysProvider] 🔄 Reconectando...');
                    this.initProvider();
                } else {
                    console.log('[SupabaseBaileysProvider] ❌ Desconectado (Logout).');
                    this.emit('auth_failure', { instructions: ['Sesión cerrada. Escanea de nuevo.'] });
                }
            }
        });

        this.vendor.ev.on('messages.upsert', async ({ messages, type }: any) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                // Capturamos el contenido pase lo que pase
                const body = 
                    msg.message?.conversation || 
                    msg.message?.extendedTextMessage?.text || 
                    msg.message?.imageMessage?.caption || 
                    msg.message?.videoMessage?.caption ||
                    '';
                
                const from = msg.key.remoteJid;
                
                // Extraer el tipo real
                const messageType = Object.keys(msg.message || {})[0] || 'text';
                
                // Mapear tipos nativos a tipos estándar de BuilderBot
                const typeMapping: any = {
                    audioMessage: 'voice',
                    imageMessage: 'image',
                    videoMessage: 'video',
                    documentMessage: 'document',
                    locationMessage: 'location',
                    buttonsResponseMessage: 'buttons',
                    templateButtonReplyMessage: 'buttons',
                    contactMessage: 'contact'
                };

                const type = typeMapping[messageType] || 'text';

                // Si el body está vacío (común en audios/imágenes sin caption), ponemos un placeholder
                const finalBody = body || (type !== 'text' ? `_event_${type}_` : '');

                // Mapear eventos nativos de Baileys al formato de BuilderBot
                const payload = {
                    body: finalBody,
                    from,
                    phoneNumber: from?.split('@')[0],
                    name: msg.pushName || 'User',
                    type,
                    payload: msg 
                };

                // Si el mensaje es mío (enviado desde la App móvil), lo emitimos con un evento especial
                // para que el sistema de historial lo guarde, pero el bot no intente responderse a sí mismo.
                if (msg.key.fromMe) {
                    this.emit('message_from_me', payload);
                    continue;
                }

                if (!msg.message) continue;

                this.emit('message', payload);
            }
        });
    }
}
