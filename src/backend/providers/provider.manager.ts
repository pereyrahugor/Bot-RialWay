import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { EVENTS } from "@builderbot/bot";
import { isSessionInDb } from "./sessionSync";
import { HistoryHandler, historyEvents } from '../db/historyHandler';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// Comprime la imagen en disco y devuelve la ruta web relativa final
async function compressImageToDisk(absolutePath: string): Promise<string> {
    // Retornamos el path original directamente para evitar el uso del módulo nativo C++ sharp.
    // Esto previene los problemas de corrupción de memoria heap (free(): invalid size) en el contenedor.
    return absolutePath;
}

/**
 * Cache temporal para IDs de mensajes enviados desde el backoffice.
 * Evita procesar los "ecos" (message_from_me) de lo que nosotros mismos mandamos.
 */
const sentMessageCache = new Set<string>();

// Cache temporal para evitar rate limit en las llamadas a la API de Meta Graph
let lastMetaSyncTime = 0;
const META_SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos de caché

function unwrapBaileysMessage(message: any): any {
    let current = message || {};
    for (let i = 0; i < 5; i += 1) {
        const next = current?.ephemeralMessage?.message ||
            current?.viewOnceMessage?.message ||
            current?.viewOnceMessageV2?.message ||
            current?.viewOnceMessageV2Extension?.message ||
            current?.documentWithCaptionMessage?.message ||
            current?.editedMessage?.message ||
            null;
        if (!next || next === current) break;
        current = next;
    }
    return current;
}

function getReplyContextInfo(raw: any): any {
    const message = unwrapBaileysMessage(raw?.message || raw?.payload?.message || {});
    return raw?.context ||
        raw?.message?.context ||
        raw?.payload?.context ||
        raw?.payload?.message?.context ||
        message.extendedTextMessage?.contextInfo ||
        message.conversationMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        message.videoMessage?.contextInfo ||
        message.audioMessage?.contextInfo ||
        message.documentMessage?.contextInfo ||
        message.stickerMessage?.contextInfo ||
        message.buttonsResponseMessage?.contextInfo ||
        message.templateButtonReplyMessage?.contextInfo ||
        message.listResponseMessage?.contextInfo ||
        null;
}

function getReplyIdFromContext(contextInfo: any): string | null {
    return contextInfo?.id ||
        contextInfo?.message_id ||
        contextInfo?.messageId ||
        contextInfo?.stanzaId ||
        contextInfo?.quotedMessageId ||
        null;
}

function getQuotedPreview(raw: any): { content: string; type: string } | null {
    const quoted = getReplyContextInfo(raw)?.quotedMessage;
    if (!quoted) return null;

    if (quoted.conversation) return { content: quoted.conversation, type: 'text' };
    if (quoted.extendedTextMessage?.text) return { content: quoted.extendedTextMessage.text, type: 'text' };
    if (quoted.buttonsMessage?.contentText) return { content: quoted.buttonsMessage.contentText, type: 'text' };
    if (quoted.templateMessage?.hydratedTemplate?.hydratedContentText) return { content: quoted.templateMessage.hydratedTemplate.hydratedContentText, type: 'text' };
    if (quoted.interactiveMessage?.body?.text) return { content: quoted.interactiveMessage.body.text, type: 'text' };
    if (quoted.imageMessage) return { content: quoted.imageMessage.caption || 'Imagen', type: 'image' };
    if (quoted.videoMessage) return { content: quoted.videoMessage.caption || 'Video', type: 'video' };
    if (quoted.audioMessage) return { content: 'Audio', type: 'audio' };
    if (quoted.documentMessage) return { content: quoted.documentMessage.fileName || quoted.documentMessage.caption || 'Archivo', type: 'document' };
    if (quoted.stickerMessage) return { content: 'Sticker', type: 'image' };

    return { content: 'Mensaje', type: 'text' };
}

function normalizeReplyPreviewText(content: any, type: string): string {
    if (type !== 'text') {
        if (type === 'image') return 'Imagen';
        if (type === 'video') return 'Video';
        if (type === 'audio' || type === 'voice') return 'Audio';
        return 'Archivo';
    }

    return String(content || 'Mensaje')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500) || 'Mensaje';
}

function extractAdReferral(ctx: any, raw: any, contextInfo: any): any {
    const ref = ctx?.referral || 
                raw?.referral || 
                ctx?.payload?.referral || 
                raw?.payload?.referral || 
                raw?.message?.referral ||
                contextInfo?.referral ||
                null;
    
    const extAd = contextInfo?.externalAdReply ||
                  raw?.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
                  raw?.payload?.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
                  ctx?.payload?.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
                  null;

    if (!ref && !extAd) return null;

    const headline = ref?.headline || extAd?.title || ref?.title || null;
    const body = ref?.body || extAd?.body || null;
    const sourceUrl = ref?.source_url || extAd?.sourceUrl || null;
    const mediaUrl = ref?.image_url || ref?.video_url || ref?.thumbnail_url || extAd?.mediaUrl || extAd?.thumbnailUrl || null;
    const sourceType = ref?.source_type || (extAd ? 'ad' : null);

    if (!headline && !body && !sourceUrl) return null;

    return {
        headline,
        body,
        sourceType,
        sourceId: ref?.source_id || null,
        sourceUrl,
        mediaUrl
    };
}

function buildCompactRawPayload(ctx: any, raw: any, contextInfo: any): any {
    const adReferral = extractAdReferral(ctx, raw, contextInfo);
    return {
        id: ctx?.id || raw?.id || null,
        key: ctx?.key || raw?.key || null,
        from: ctx?.from || raw?.from || null,
        to: ctx?.to || raw?.to || raw?.recipient_id || null,
        body: ctx?.body || raw?.text?.body || raw?.button?.text || raw?.interactive?.button_reply?.title || raw?.interactive?.list_reply?.title || null,
        type: ctx?.type || raw?.type || null,
        platform: ctx?.platform || null,
        userId: ctx?.userId || null,
        recipientPhoneId: ctx?.recipientPhoneId || null,
        context: contextInfo || ctx?.context || raw?.context || ctx?.payload?.context || raw?.payload?.context || null,
        referral: adReferral || null,
        message: raw?.message ? unwrapBaileysMessage(raw.message) : null,
        payloadKeys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 40) : []
    };
}

async function buildReplyRawPayload(ctx: any, chatId: string, projectId: string, serviceId?: string | null): Promise<any> {
    const raw = ctx?.payload || ctx?.rawPayload || ctx || {};
    const contextInfo = getReplyContextInfo(ctx) || getReplyContextInfo(raw);
    let replyId = getReplyIdFromContext(contextInfo);
    const baseRawPayload = buildCompactRawPayload(ctx, raw, contextInfo);

    const isButton = ctx?.type === 'button' || raw?.type === 'button' || ctx?.button || raw?.button || raw?.message?.buttonsResponseMessage || raw?.message?.templateButtonReplyMessage;

    if (!replyId && !isButton) return baseRawPayload;

    console.log(`[ReplyTrace] Reply/Button context detected. chat=${chatId} project=${projectId} service=${serviceId || 'none'} replyId=${replyId || 'none'} isButton=${!!isButton}`);

    let referenced: any = null;
    try {
        const recentMessages = await HistoryHandler.getMessages(chatId, 50, 0, projectId, serviceId || null);
        if (replyId) {
            referenced = recentMessages.find((m: any) => m.external_id === replyId || m.id === replyId);
        }
        // Fallback genérico para botones: si no vino stanzaId o no hizo match, se asocia al último mensaje de asistente
        if (!referenced && isButton) {
            referenced = recentMessages.slice().reverse().find((m: any) => m.role === 'assistant');
            if (referenced) {
                replyId = referenced.external_id || referenced.id;
            }
        }
    } catch {
        referenced = null;
    }

    const quotedPreview = getQuotedPreview(ctx) || getQuotedPreview(raw);
    const replyType = referenced?.type || quotedPreview?.type || 'text';
    const replyContent = referenced
        ? normalizeReplyPreviewText(referenced.content, replyType)
        : normalizeReplyPreviewText(quotedPreview?.content, replyType);
    let replyAuthor = 'Cliente';
    if (referenced?.role === 'assistant') {
        replyAuthor = 'Vos';
    } else {
        const chatInfo = await HistoryHandler.getChat(chatId, projectId, serviceId || undefined).catch(() => null);
        replyAuthor = (chatInfo?.name && chatInfo.name !== '[-]') ? chatInfo.name : String(chatId).split('@')[0];
    }

    return {
        ...baseRawPayload,
        replyTo: replyId || null,
        replyPreview: {
            id: replyId || null,
            localId: referenced?.id || null,
            role: referenced?.role || null,
            author: replyAuthor,
            content: replyContent,
            type: replyType
        }
    };
}

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
                try {
                    const terminalQr = await (QRCode as any).toString(qrString, { type: 'terminal', small: true });
                    console.log(`${prefix} QR para debug en terminal:\n${terminalQr}`);
                } catch (terminalErr: any) {
                    console.warn(`${prefix} No se pudo renderizar el QR en terminal:`, terminalErr?.message || terminalErr);
                }
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

            // Ignorar eventos de reacción (no son mensajes conversacionales)
            if (ctx.type === 'reaction' || ctx.body === '_event_reaction_' || String(ctx.body || '').startsWith('_event_reaction_')) {
                return;
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

            // Guardar en el historial de Supabase si no es un comando de sistema (se permite guardar multimedia/ubicación que tengan _event_)
            const isMediaOrLocation = ['voice', 'audio', 'image', 'video', 'document', 'location'].includes(ctx.type);
            if (ctx.body && (!ctx.body.startsWith('_event_') || isMediaOrLocation)) {
                const { HistoryHandler } = await import('../db/historyHandler');

                // Resolver projectId dinámicamente
                const rawJid = provider?.vendor?.authState?.creds?.me?.id || 
                               provider?.vendor?.user?.id || 
                               provider?.globalVendorArgs?.sock?.user?.id || '';
                const botPhoneNumber = ctx.recipientPhoneId ||
                                       rawJid.split(':')[0].split('@')[0] || 
                                       provider?.globalVendorArgs?.phone_number_id || 
                                       provider?.config?.phone_number_id ||
                                       (ctx.to ? ctx.to.replace(/\D/g, '') : null);
                let dynamicProjectId = HistoryHandler.PROJECT_IDENTIFIER;
                let dynamicServiceId = HistoryHandler.SERVICE_IDENTIFIER;
                if (botPhoneNumber) {
                    const resolvedId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber);
                    if (resolvedId) {
                        dynamicProjectId = resolvedId;
                    }
                    const resolvedServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber);
                    if (resolvedServiceId) {
                        dynamicServiceId = resolvedServiceId;
                    }
                }
                
                // Si es grupo, mantenemos el JID completo. Si es chat privado, extraemos el número.
                const chatId = isGroup ? (from.includes('@') ? from : `${from}@g.us`) : (from.includes('@') ? from.split('@')[0] : from);
                const externalId = ctx.key?.id || ctx.payload?.id || ctx.id;
                
                let contactName = null;
                if (isGroup) {
                    const groupResumenId = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN') || '';
                    const cleanGroupResumenId = groupResumenId.includes('@') ? groupResumenId : (groupResumenId ? `${groupResumenId}@g.us` : '');
                    contactName = (chatId === cleanGroupResumenId) ? 'Grupo de Reportes 1' : 'Grupo de Reportes 2';
                }
                
                // Para media: preferir localPath sobre el caption/body, igual que se hace para voice
                const isMediaType = ['voice', 'audio', 'image', 'video', 'document'].includes(ctx.type);
                let contentToSave = (isMediaType && ctx.localPath) ? ctx.localPath : ctx.body;

                // Normalizar rutas absolutas a URLs relativas web, comprimiendo imágenes en disco
                if (contentToSave && typeof contentToSave === 'string' && !contentToSave.startsWith('http')) {
                    let normalized = contentToSave.replace(/\\/g, '/');
                    const isLocalFile = normalized.includes('/tmp/') || normalized.includes('/uploads/') || path.isAbsolute(contentToSave);
                    if (isLocalFile) {
                        // Comprimir imagen en disco si aplica
                        let absolutePath = contentToSave;
                        if (normalized.startsWith('/tmp/') || normalized.startsWith('/uploads/')) {
                            absolutePath = path.join(process.cwd(), normalized);
                        }
                        const finalAbsPath = await compressImageToDisk(absolutePath);
                        normalized = finalAbsPath.replace(/\\/g, '/');

                        const tmpIdx = normalized.toLowerCase().indexOf('/tmp/');
                        if (tmpIdx !== -1) contentToSave = normalized.substring(tmpIdx);
                        else {
                            const uploadsIdx = normalized.toLowerCase().indexOf('/uploads/');
                            if (uploadsIdx !== -1) contentToSave = normalized.substring(uploadsIdx);
                        }
                    }
                }

                const rawPayloadToSave = await buildReplyRawPayload(ctx, chatId, dynamicProjectId, dynamicServiceId);
                
                await HistoryHandler.saveMessage(
                    chatId, 
                    'user', 
                    contentToSave, 
                    ctx.type || 'text', 
                    contactName, 
                    ctx.userId,
                    externalId,
                    ctx.platform || 'whatsapp',
                    dynamicProjectId,
                    dynamicServiceId,
                    rawPayloadToSave
                );

                // Detección y registro de contexto de Anuncio (Click to WhatsApp Ads - CTWA)
                const referral = ctx.referral || ctx.payload?.referral || null;
                const externalAdReply = ctx.payload?.message?.extendedTextMessage?.contextInfo?.externalAdReply ||
                                        ctx.message?.contextInfo?.externalAdReply || 
                                        ctx.payload?.contextInfo?.externalAdReply || null;
                const adHeadline = referral?.headline || externalAdReply?.title || null;
                const adBody = referral?.body || externalAdReply?.body || null;

                if (adHeadline || adBody) {
                    try {
                        const chat = await HistoryHandler.getChat(chatId, dynamicProjectId, dynamicServiceId);
                        const currentMeta = chat?.metadata || {};
                        const sourceName = adHeadline ? `Anuncio: ${adHeadline}` : 'Anuncio Meta';
                        
                        const updateFields: any = {
                            metadata: {
                                ...currentMeta,
                                referral: referral || externalAdReply
                            }
                        };

                        if (!chat?.source || chat.source === '' || chat.source === 'Asistente AI') {
                            updateFields.source = sourceName;
                        }
                        if (!chat?.offered_product && adBody) {
                            updateFields.offered_product = adBody;
                        }

                        await HistoryHandler.updateContactDetails(chatId, updateFields, dynamicProjectId, dynamicServiceId);
                        console.log(`${prefix} 🎯 [CTWA] Detectado anuncio de origen para ${chatId}: "${adHeadline || ''}" - "${adBody || ''}"`);
                    } catch (adErr: any) {
                        console.warn(`${prefix} Error guardando datos de anuncio CTWA:`, adErr.message);
                    }
                }

                // Si el mensaje original provino de un LID, guardamos el mapeo en metadata de chats para poder resolverlo en la intervención manual
                if (ctx.payload?.key?.remoteJid?.endsWith('@lid')) {
                    const originalLid = ctx.payload.key.remoteJid;
                    try {
                        const chat = await HistoryHandler.getChat(chatId, dynamicProjectId, dynamicServiceId);
                        if (chat) {
                            const currentMeta = chat.metadata || {};
                            if (currentMeta.lid !== originalLid) {
                                currentMeta.lid = originalLid;
                                await HistoryHandler.updateContactDetails(chatId, { metadata: currentMeta }, dynamicProjectId);
                                console.log(`${prefix} 💾 Guardado mapeo LID en metadata del chat: ${chatId} -> ${originalLid} para proyecto ${dynamicProjectId}`);
                            }
                        }
                    } catch (metaErr: any) {
                        console.error(`${prefix} ❌ Error guardando mapeo LID en metadata de chats:`, metaErr.message);
                    }
                }
            }
        } catch (err) {
            console.error(`❌ ${prefix} Error en el logger de mensajes entrantes:`, err);
        }
    });

    // --- CAPTURA DE MENSAJES SALIENTES ---
    provider.on('message_from_me', async (ctx: any) => {
        try {
            // En ecos de mensajes salientes (message_from_me), el JID de la conversación es el destinatario.
            // Para Baileys, ctx.from es el bot y ctx.to o remoteJid es el chat. Para Meta, ctx.from ya es el usuario.
            const from = ctx.to || ctx.key?.remoteJid || ctx.from || '';
            const isGroup = from.includes('@g.us');

            if (isGroupProvider && !isGroup) {
                return; // El proveedor de grupos ignora chats privados para evitar colisiones
            }

            const { HistoryHandler, recentBotSentMessages, normalizeTextForCache } = await import('../db/historyHandler');

            // Resolver projectId dinámicamente
            const rawJid = provider?.vendor?.authState?.creds?.me?.id || 
                           provider?.vendor?.user?.id || 
                           provider?.globalVendorArgs?.sock?.user?.id || '';
            const botPhoneNumber = ctx.recipientPhoneId ||
                                   rawJid.split(':')[0].split('@')[0] || 
                                   provider?.globalVendorArgs?.phone_number_id || 
                                   provider?.config?.phone_number_id ||
                                   (ctx.to ? ctx.to.replace(/\D/g, '') : null);
            let dynamicProjectId = HistoryHandler.PROJECT_IDENTIFIER;
            let dynamicServiceId = HistoryHandler.SERVICE_IDENTIFIER;
            if (botPhoneNumber) {
                const resolvedId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber);
                if (resolvedId) {
                    dynamicProjectId = resolvedId;
                }
                const resolvedServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber);
                if (resolvedServiceId) {
                    dynamicServiceId = resolvedServiceId;
                }
            }

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

            // Ignorar eventos de reacción en ecos de mensajes salientes
            if (ctx.type === 'reaction' || ctx.body === '_event_reaction_' || String(ctx.body || '').startsWith('_event_reaction_')) {
                return;
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

            const rawPayloadToSave = await buildReplyRawPayload(ctx, chatId, dynamicProjectId, dynamicServiceId);

            // Guardamos como 'assistant' para que aparezca en el lado derecho del chat en el backoffice
            await HistoryHandler.saveMessage(
                chatId, 
                'assistant', 
                bodyToSave, 
                ctx.type || 'text', 
                contactName, 
                null,
                externalId,
                ctx.platform || 'whatsapp',
                dynamicProjectId,
                dynamicServiceId,
                rawPayloadToSave
            );

            // Si fue una intervención manual desde la app de WhatsApp (y no es grupo),
            // activar automáticamente el modo "Atención Humana" a menos que la opción esté desactivada para el proyecto
            if (isManual && !isGroup) {
                const disableAutoHuman = await HistoryHandler.getConfig('DISABLE_AUTO_HUMAN_ON_APP_MESSAGE', dynamicProjectId);
                if (disableAutoHuman === 'true' || disableAutoHuman === '1') {
                    console.log(`${prefix} ℹ️ Intervención desde App WhatsApp detectada para ${chatId}, pero DISABLE_AUTO_HUMAN_ON_APP_MESSAGE está activo (No se desactiva el bot).`);
                } else {
                    console.log(`${prefix} 🛑 Activando modo Atención Humana para ${chatId} (operador escribió desde la app) para proyecto ${dynamicProjectId}`);
                    await HistoryHandler.toggleBot(chatId, false, dynamicProjectId, dynamicServiceId, true);
                    await HistoryHandler.updateLastHumanMessage(chatId, dynamicProjectId, dynamicServiceId);
                }
            }
        } catch (err) {
            console.error(`❌ ${prefix} Error guardando mensaje saliente manual:`, err);
        }
    });

    // --- SINCRONIZACIÓN DE CONTACTOS (META SMB) ---
    provider.on('contacts_sync', async (contacts: any[], context: any = {}) => {
        try {
            console.log(`${prefix} 👥 Recibida petición de sincronización para ${contacts.length} contactos...`);
            const { HistoryHandler } = await import('../db/historyHandler');
            const botPhoneNumber = context.recipientPhoneId ||
                                   provider?.config?.phone_number_id ||
                                   provider?.globalVendorArgs?.phone_number_id ||
                                   provider?.vendor?.authState?.creds?.me?.id?.split(':')[0]?.split('@')[0] ||
                                   provider?.vendor?.user?.id?.split(':')[0]?.split('@')[0] ||
                                   null;
            let dynamicProjectId = HistoryHandler.PROJECT_IDENTIFIER;
            let dynamicServiceId = HistoryHandler.SERVICE_IDENTIFIER;
            if (botPhoneNumber) {
                const resolvedProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber);
                const resolvedServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber);
                if (resolvedProjectId) dynamicProjectId = resolvedProjectId;
                if (resolvedServiceId) dynamicServiceId = resolvedServiceId;
            }
            
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

            await HistoryHandler.syncChats(chatsToSync, dynamicProjectId, dynamicServiceId);
            console.log(`${prefix} ✅ Sincronización de contactos persistida en base de datos.`);
        } catch (err) {
            console.error(`❌ ${prefix} Error en sincronización de contactos:`, err);
        }
    });

    provider.on('ready', () => {
        console.log(`✅ ${prefix} READY: El proveedor está conectado.`);
        historyEvents.emit('whatsapp_line_changed', {
            projectId: provider?.globalVendorArgs?.projectId || provider?.globalVendorArgs?.project_id || HistoryHandler.PROJECT_IDENTIFIER,
            project_id: provider?.globalVendorArgs?.projectId || provider?.globalVendorArgs?.project_id || HistoryHandler.PROJECT_IDENTIFIER,
            serviceId: provider?.globalVendorArgs?.serviceId || provider?.globalVendorArgs?.service_id || HistoryHandler.SERVICE_IDENTIFIER,
            service_id: provider?.globalVendorArgs?.serviceId || provider?.globalVendorArgs?.service_id || HistoryHandler.SERVICE_IDENTIFIER,
            provider: isGroupProvider ? 'baileys-groups' : 'baileys',
            active: true
        });
        const qrFilename = isGroupProvider ? 'bot.groups.qr.png' : 'bot.qr.png';
        const qrPath = path.join(process.cwd(), qrFilename);
        if (fs.existsSync(qrPath)) {
            try { fs.unlinkSync(qrPath); } catch (e) {
                // Silently ignore if file doesn't exist
            }
        }
    });

    provider.on('status_change', (payload: any = {}) => {
        historyEvents.emit('whatsapp_line_changed', {
            projectId: provider?.globalVendorArgs?.projectId || provider?.globalVendorArgs?.project_id || HistoryHandler.PROJECT_IDENTIFIER,
            project_id: provider?.globalVendorArgs?.projectId || provider?.globalVendorArgs?.project_id || HistoryHandler.PROJECT_IDENTIFIER,
            serviceId: provider?.globalVendorArgs?.serviceId || provider?.globalVendorArgs?.service_id || HistoryHandler.SERVICE_IDENTIFIER,
            service_id: provider?.globalVendorArgs?.serviceId || provider?.globalVendorArgs?.service_id || HistoryHandler.SERVICE_IDENTIFIER,
            provider: isGroupProvider ? 'baileys-groups' : 'baileys',
            active: payload.active === true,
            connection: payload.connection || null,
            reason: payload.reason || null
        });
    });
};

/**
 * Verifica si existe una sesión activa y devuelve el estado para el dashboard.
 */
export const hasActiveSession = async (adapterProvider: any, groupProvider: any = null, projectId: string | null = null, serviceId: string | null = null) => {
    try {
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const targetServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;
        const getStatus = async (provider: any, isGroup: boolean) => {
            if (!provider) return null;
            
            const isMeta = provider.constructor.name === 'MetaCloudProvider';
            const socketOpen = !!(
                provider?.vendor?.ws?.isOpen ||
                provider?.vendor?.ws?.readyState === 1 ||
                provider?.vendor?.ws?.socket?._readyState === 1
            );
            const hasIdentity = !!(
                provider?.vendor?.authState?.creds?.me?.id ||
                provider?.vendor?.user?.id ||
                provider?.globalVendorArgs?.sock?.user?.id
            );
            const connectionState = provider?.connectionState || null;
            const isReady = connectionState
                ? (connectionState === 'open' && hasIdentity)
                : (socketOpen && hasIdentity);

            if (isMeta) return { active: true, type: 'meta', message: 'Conectado via API' };

            const qrFilename = isGroup ? 'bot.groups.qr.png' : 'bot.qr.png';
            const hasQr = fs.existsSync(path.join(process.cwd(), qrFilename));
            const qrString = provider.qrCodeString || null;
            const pairingCode = provider.pairingCode || null;

            if (isReady) return { active: true, type: 'baileys', message: 'Conectado' };

            if (pairingCode) {
                return { active: false, qr: false, pairingCode, type: 'baileys', message: 'Esperando vinculacion por codigo' };
            }

            if (hasQr || qrString) {
                let qrImage = null;
                if (qrString) {
                    try { qrImage = await QRCode.toDataURL(qrString); } catch (e) {
                    // Ignore QR generation errors
                }
                }
                return { active: false, qr: true, qrData: qrString, qrImage, type: 'baileys', message: 'Esperando vinculacion' };
            }

            // Si el motor fue apagado intencionalmente o no esta inicializado, reportar Desconectado inmediatamente
            if (provider.preventAutoStart || !provider.initialized || connectionState === 'close' || connectionState === 'idle') {
                return { active: false, type: 'baileys', message: 'Desconectado' };
            }
            const isStarting = !!(provider?.vendor);
            return { active: false, type: 'baileys', message: isStarting ? 'Iniciando motor...' : 'Desconectado' };
        };

        const adapterStatus = await getStatus(adapterProvider, false);
        const groupStatus = await getStatus(groupProvider, true);

        // Fetch meta configuration for additional info if not active
        const metaOnboarding = await HistoryHandler.getMetaOnboardingData(targetProjectId, false, targetServiceId);

        const now = Date.now();
        const hasData = metaOnboarding?.onboarding_data && 
                        Object.keys(metaOnboarding.onboarding_data).length > 2 && 
                        metaOnboarding.onboarding_data.display_phone_number;
        const skipSync = hasData && (now - lastMetaSyncTime < META_SYNC_COOLDOWN_MS);

        if (metaOnboarding && metaOnboarding.whatsappToken && metaOnboarding.whatsappNumberId && metaOnboarding.whatsappToken !== 'PENDING' && !skipSync) {
            try {
                const axios = (await import('axios')).default;
                const phoneId = metaOnboarding.whatsappNumberId;
                const token = metaOnboarding.whatsappToken;

                // 1. Consultar nodo del número de teléfono usando v25.0
                const phoneRes = await axios.get(`https://graph.facebook.com/v25.0/${phoneId}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    params: {
                        fields: "id,display_phone_number,verified_name,quality_rating,status,code_verification_status,messaging_limit_tier"
                    }
                });
 
                // 2. Consultar WABA
                let accountReviewStatus = null;
                if (metaOnboarding.whatsappBusinessId) {
                    try {
                        const wabaRes = await axios.get(`https://graph.facebook.com/v25.0/${metaOnboarding.whatsappBusinessId}`, {
                            headers: { 'Authorization': `Bearer ${token}` },
                            params: {
                                fields: "id,account_review_status"
                            }
                        });
                        accountReviewStatus = wabaRes.data?.account_review_status || null;
                    } catch (e) { /* ignore WABA errors */ }
                }
 
                // 3. Unir y guardar en onboarding_data temporal
                const finalMessagingLimit = phoneRes.data?.messaging_limit_tier || null;
                metaOnboarding.onboarding_data = {
                    ...(metaOnboarding.onboarding_data || {}),
                    display_phone_number: phoneRes.data?.display_phone_number || null,
                    verified_name: phoneRes.data?.verified_name || null,
                    quality_rating: phoneRes.data?.quality_rating || null,
                    status: phoneRes.data?.status || null,
                    code_verification_status: phoneRes.data?.code_verification_status || null,
                    messaging_limit_tier: finalMessagingLimit,
                    messagingLimit: finalMessagingLimit,
                    account_review_status: accountReviewStatus
                };

                // Actualizar marca de tiempo tras sincronización exitosa
                lastMetaSyncTime = now;
 
                // 4. Actualizar en la base de datos en segundo plano
                const supabase = HistoryHandler.getSupabase();
                if (supabase) {
                    let updateQuery = supabase.from('meta_onboarding')
                        .update({ onboarding_data: metaOnboarding.onboarding_data })
                        .eq('project_id', metaOnboarding.project_id);
                    
                    if (metaOnboarding.service_id) {
                        updateQuery = updateQuery.eq('service_id', metaOnboarding.service_id);
                    }

                    updateQuery.then(({ error }) => {
                        if (error) console.error("Error actualizando stats de Meta en DB:", error.message);
                    });
                }

            } catch (err: any) {
                console.warn("⚠️ [hasActiveSession] No se pudieron obtener stats dinámicas de Meta:", err.message);
                // Si falla por rate limit, agregamos penalización temporal de 5 minutos antes de volver a intentar
                lastMetaSyncTime = now - (5 * 60 * 1000); 
            }
        }

        let activeProjectId = targetProjectId;
        if (metaOnboarding?.project_id) {
            activeProjectId = metaOnboarding.project_id;
        } else {
            const rawJid = adapterProvider?.vendor?.authState?.creds?.me?.id || 
                           adapterProvider?.vendor?.user?.id || 
                           adapterProvider?.globalVendorArgs?.sock?.user?.id || '';
            const phoneNumber = rawJid.split(':')[0].split('@')[0];
            if (phoneNumber) {
                const resolvedId = await HistoryHandler.getProjectIdByRecipient(phoneNumber);
                if (resolvedId) {
                    activeProjectId = resolvedId;
                }
            }
        }

        return {
            adapter: adapterStatus,
            group: groupStatus,
            metaOnboarding: metaOnboarding || null,
            activeProjectId
        };
    } catch (error: any) {
        return { active: false, error: error.message };
    }
};
