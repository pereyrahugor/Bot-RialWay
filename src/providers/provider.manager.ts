import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { EVENTS } from "@builderbot/bot";
import { isSessionInDb } from "./sessionSync";
import { HistoryHandler } from '../db/historyHandler';

/**
 * Cache temporal para IDs de mensajes enviados desde el backoffice.
 * Evita procesar los "ecos" (message_from_me) de lo que nosotros mismos mandamos.
 */
const sentMessageCache = new Set<string>();

export const trackSentMessage = (id: string) => {
    if (!id) return;
    sentMessageCache.add(id);
    // Limpiar después de 10 segundos
    setTimeout(() => sentMessageCache.delete(id), 10000);
};

/**
 * Registra los listeners de los proveedores (Meta/Baileys) para QR, fallos y mensajes entrantes.
 */
export const registerProviderEvents = (provider: any, isGroupProvider: boolean = false) => {
    let isGeneratingQR = false;
    const prefix = isGroupProvider ? '[GroupProvider]' : '[AdapterProvider]';

    const handleQR = async (payload: any) => {
        if (isGeneratingQR) return;
        isGeneratingQR = true;

        try {
            let qrString = null;
            if (typeof payload === 'string') qrString = payload;
            else if (payload?.qr) qrString = payload.qr;
            else if (payload?.code) qrString = payload.code;

            if (qrString && typeof qrString === 'string') {
                provider.qrCodeString = qrString; // <--- Sincronizar con la instancia para el dashboard
                console.log(`${prefix} 🆕 Nuevo QR recibido. Guardando...`);
                const qrFilename = isGroupProvider ? 'bot.groups.qr.png' : 'bot.qr.png';
                const qrPath = path.join(process.cwd(), qrFilename);
                await QRCode.toFile(qrPath, qrString, {
                    color: { dark: '#000000', light: '#ffffff' },
                    scale: 4,
                    margin: 2
                });
                console.log(`${prefix} ✅ QR guardado en ${qrPath}`);
            }
        } catch (err) {
            console.error(`❌ ${prefix} Error generating QR image:`, err);
        } finally {
            isGeneratingQR = false;
        }
    };

    provider.on('qr', handleQR);
    provider.on('require_action', handleQR);
    provider.on('auth_require', handleQR);    // Registrar eventos de procesamiento de mensajes (tanto para proveedor normal como de grupos)
    provider.on('message', async (ctx: any) => {
        try {
            const from = ctx.from || '';
            const isGroup = from.includes('@g.us');

            if (isGroupProvider && !isGroup) {
                return; // El proveedor de grupos ignora chats privados para evitar colisiones
            }

            if (isGroup) {
                // Filtro estricto: solo procedemos si es uno de los grupos de reportes oficiales
                const { HistoryHandler } = await import('../db/historyHandler');
                const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN') || '';
                const groupResumenId2 = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN_2') || '';
                const cleanFrom = from.includes('@') ? from : `${from}@g.us`;
                
                const cleanGroupResumenId = groupResumenId.includes('@') ? groupResumenId : (groupResumenId ? `${groupResumenId}@g.us` : '');
                const cleanGroupResumenId2 = groupResumenId2.includes('@') ? groupResumenId2 : (groupResumenId2 ? `${groupResumenId2}@g.us` : '');

                if (cleanFrom !== cleanGroupResumenId && cleanFrom !== cleanGroupResumenId2) {
                    return; // Ignorar cualquier otro grupo
                }
            }

            console.log(`${prefix} 📩 Mensaje entrante - Tipo: ${ctx.type}, De: ${from}`);
            
            // Si el mensaje es una nota de voz, forzamos el log específico para confirmar detección
            if (ctx.type === 'voice') {
                console.log(`${prefix} 🎙️ NOTA DE VOZ DETECTADA. Enviando a los flujos...`);
            }

            // Guardar en el historial de Supabase si no es un comando de sistema (se permite guardar notas de voz que tengan _event_)
            if (ctx.body && (!ctx.body.startsWith('_event_') || ctx.type === 'voice')) {
                const { HistoryHandler } = await import('../db/historyHandler');
                
                // Si es grupo, mantenemos el JID completo. Si es chat privado, extraemos el número.
                const chatId = isGroup ? (from.includes('@') ? from : `${from}@g.us`) : (from.includes('@') ? from.split('@')[0] : from);
                const externalId = ctx.key?.id || ctx.payload?.id || ctx.id;
                
                let contactName = null;
                if (isGroup) {
                    const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN') || '';
                    const cleanGroupResumenId = groupResumenId.includes('@') ? groupResumenId : (groupResumenId ? `${groupResumenId}@g.us` : '');
                    contactName = (chatId === cleanGroupResumenId) ? 'Grupo de Reportes 1' : 'Grupo de Reportes 2';
                }
                
                let contentToSave = ctx.type === 'voice' ? (ctx.localPath || ctx.body) : ctx.body;
                
                // Normalizar rutas absolutas del sistema de archivos a URLs relativas web para el navegador
                if (contentToSave && typeof contentToSave === 'string') {
                    const normalized = contentToSave.replace(/\\/g, '/');
                    const tmpIdx = normalized.toLowerCase().indexOf('/tmp/');
                    if (tmpIdx !== -1) {
                        contentToSave = normalized.substring(tmpIdx);
                    } else {
                        const uploadsIdx = normalized.toLowerCase().indexOf('/uploads/');
                        if (uploadsIdx !== -1) {
                            contentToSave = normalized.substring(uploadsIdx);
                        }
                    }
                }
                
                await HistoryHandler.saveMessage(
                    chatId, 
                    'user', 
                    contentToSave, 
                    ctx.type || 'text', 
                    contactName, 
                    ctx.userId,
                    externalId,
                    ctx.platform || 'whatsapp'
                );
            }
        } catch (err) {
            console.error(`❌ ${prefix} Error en el logger de mensajes entrantes:`, err);
        }
    });

    // --- CAPTURA DE MENSAJES SALIENTES ---
    provider.on('message_from_me', async (ctx: any) => {
        try {
            const from = ctx.from || '';
            const isGroup = from.includes('@g.us');

            if (isGroupProvider && !isGroup) {
                return; // El proveedor de grupos ignora chats privados para evitar colisiones
            }

            const { HistoryHandler, recentBotSentMessages, normalizeTextForCache } = await import('../db/historyHandler');

            if (isGroup) {
                // Filtro estricto: solo procedemos si es uno de los grupos de reportes oficiales
                const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN') || '';
                const groupResumenId2 = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN_2') || '';
                const cleanFrom = from.includes('@') ? from : `${from}@g.us`;
                
                const cleanGroupResumenId = groupResumenId.includes('@') ? groupResumenId : (groupResumenId ? `${groupResumenId}@g.us` : '');
                const cleanGroupResumenId2 = groupResumenId2.includes('@') ? groupResumenId2 : (groupResumenId2 ? `${groupResumenId2}@g.us` : '');

                if (cleanFrom !== cleanGroupResumenId && cleanFrom !== cleanGroupResumenId2) {
                    return; // Ignorar cualquier otro grupo
                }
            }

            // Si el mensaje está en el caché de enviados por el bot/asistente, no es una intervención manual
            const normalizedBody = normalizeTextForCache(ctx.body || '');
            let isBotSent = recentBotSentMessages.has(normalizedBody);

            if (!isBotSent && normalizedBody.length >= 15) {
                // Si no hay coincidencia exacta pero el cuerpo es largo, buscar si es una subcadena de algún mensaje en caché
                for (const cachedMsg of recentBotSentMessages) {
                    if (cachedMsg.includes(normalizedBody)) {
                        isBotSent = true;
                        break;
                    }
                }
            }

            if (isBotSent) {
                console.log(`${prefix} 🤖 Eco de mensaje enviado por el bot detectado (no es manual): "${ctx.body.substring(0, 40)}..."`);
                return; // Evitar duplicar en la base de datos y en el Backoffice ya que el procesador del bot ya guardó la respuesta completa
            }

            const isManual = ctx.isManualIntervention;
            console.log(`${prefix} 📤 Mensaje saliente manual detectado. ID: ${from}. Body: ${ctx.body}${isManual ? ' [INTERVENCIÓN DESDE APP WHATSAPP]' : ''}`);
            
            const chatId = isGroup ? (from.includes('@') ? from : `${from}@g.us`) : (from.includes('@') ? from.split('@')[0] : from);
            const externalId = ctx.key?.id || ctx.payload?.id || ctx.id;

            // DEDUPLICACIÓN: Si el ID está en el caché, es un eco de algo que enviamos desde el backoffice
            if (externalId && sentMessageCache.has(externalId)) {
                return;
            }

            let contactName = null;
            if (isGroup) {
                const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN') || '';
                const cleanGroupResumenId = groupResumenId.includes('@') ? groupResumenId : (groupResumenId ? `${groupResumenId}@g.us` : '');
                contactName = (chatId === cleanGroupResumenId) ? 'Grupo de Reportes 1' : 'Grupo de Reportes 2';
            }

            let bodyToSave = ctx.body;
            if (bodyToSave && typeof bodyToSave === 'string') {
                const normalized = bodyToSave.replace(/\\/g, '/');
                const tmpIdx = normalized.toLowerCase().indexOf('/tmp/');
                if (tmpIdx !== -1) {
                    bodyToSave = normalized.substring(tmpIdx);
                } else {
                    const uploadsIdx = normalized.toLowerCase().indexOf('/uploads/');
                    if (uploadsIdx !== -1) {
                        bodyToSave = normalized.substring(uploadsIdx);
                    }
                }
            }

            // Guardamos como 'assistant' para que aparezca en el lado derecho del chat en el backoffice
            await HistoryHandler.saveMessage(
                chatId, 
                'assistant', 
                bodyToSave, 
                ctx.type || 'text', 
                contactName, 
                null,
                externalId,
                ctx.platform || 'whatsapp'
            );

            // Si fue una intervención manual desde la app de WhatsApp (y no es grupo),
            // activar automáticamente el modo "Atención Humana"
            if (isManual && !isGroup) {
                console.log(`${prefix} 🛑 Activando modo Atención Humana para ${chatId} (operador escribió desde la app)`);
                await HistoryHandler.toggleBot(chatId, false);
                await HistoryHandler.updateLastHumanMessage(chatId);
            }
        } catch (err) {
            console.error(`❌ ${prefix} Error guardando mensaje saliente manual:`, err);
        }
    });

    // --- SINCRONIZACIÓN DE CONTACTOS (META SMB) ---
    provider.on('contacts_sync', async (contacts: any[]) => {
        try {
            console.log(`${prefix} 👥 Recibida petición de sincronización para ${contacts.length} contactos...`);
            const { HistoryHandler } = await import('../db/historyHandler');
            
            const chatsToSync = contacts.map(c => ({
                id: c.wa_id,
                name: c.profile?.name || 'User',
                type: 'whatsapp',
                last_message_at: new Date().toISOString(),
                metadata: {
                    user_id: c.user_id, // BSUID
                    profile: c.profile
                }
            }));

            await HistoryHandler.syncChats(chatsToSync);
            console.log(`${prefix} ✅ Sincronización de contactos persistida en base de datos.`);
        } catch (err) {
            console.error(`❌ ${prefix} Error en sincronización de contactos:`, err);
        }
    });

    provider.on('ready', () => {
        console.log(`✅ ${prefix} READY: El proveedor está conectado.`);
        const qrFilename = isGroupProvider ? 'bot.groups.qr.png' : 'bot.qr.png';
        const qrPath = path.join(process.cwd(), qrFilename);
        if (fs.existsSync(qrPath)) {
            try { fs.unlinkSync(qrPath); } catch (e) {
                // Silently ignore if file doesn't exist
            }
        }
    });
};

/**
 * Verifica si existe una sesión activa y devuelve el estado para el dashboard.
 */
export const hasActiveSession = async (adapterProvider: any, groupProvider: any = null) => {
    try {
        const getStatus = async (provider: any, isGroup: boolean) => {
            if (!provider) return null;
            
            const isMeta = provider.constructor.name === 'MetaCloudProvider';
            const isReady = !!(provider?.vendor?.user || provider?.globalVendorArgs?.sock?.user) && provider?.vendor?.ws?.isOpen;

            if (isMeta) return { active: true, type: 'meta', message: 'Conectado via API' };

            const qrFilename = isGroup ? 'bot.groups.qr.png' : 'bot.qr.png';
            const hasQr = fs.existsSync(path.join(process.cwd(), qrFilename));
            const qrString = provider.qrCodeString || null;

            if (isReady) return { active: true, type: 'baileys', message: 'Conectado' };

            if (hasQr || qrString) {
                let qrImage = null;
                if (qrString) {
                    try { qrImage = await QRCode.toDataURL(qrString); } catch (e) {
                    // Ignore QR generation errors
                }
                }
                return { active: false, qr: true, qrData: qrString, qrImage, type: 'baileys', message: 'Esperando vinculación' };
            }

            return { active: false, type: 'baileys', message: 'Iniciando motor...' };
        };

        const adapterStatus = await getStatus(adapterProvider, false);
        const groupStatus = await getStatus(groupProvider, true);

        // Fetch meta configuration for additional info if not active
        const { HistoryHandler } = await import('../db/historyHandler');
        const metaOnboarding = await HistoryHandler.getMetaOnboardingData();

        return {
            adapter: adapterStatus,
            group: groupStatus,
            metaOnboarding: metaOnboarding || null
        };
    } catch (error: any) {
        return { active: false, error: error.message };
    }
};
