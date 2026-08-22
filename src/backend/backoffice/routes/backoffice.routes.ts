import path from 'path';
import fs from 'fs';
import { execSync, exec } from 'child_process';
import url from 'url';
import bodyParser from 'body-parser';
import axios from 'axios';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { backofficeAuth, systemConfigAuth, invalidateAuthCache } from "../middleware/auth";
import { supabase, HistoryHandler as HistoryHandlerClass, historyEvents } from "../db/historyHandler";
import { invalidateVisibilityCache } from "./static.routes";
import { getOpenAI } from "../../apis/openai/openaiHelper";
import { updateMain } from "../../apis/google/updateMain";
import { getAdapterProvider, getGroupProvider } from "../../providers/instances";
import { upload } from "../../middleware/upload";
import { getIdsByHost } from '../utils/routingResolver';
import { ContactService } from "../../contacts/contactService";
import { getVisibleServiceIds } from '../utils/databaseSync';

// Invalidar visibility cache cuando cambia cualquier setting de visibilidad via Realtime
const VISIBILITY_KEYS = ['WHATSAPP_VISIBLE', 'INSTAGRAM_VISIBLE', 'MESSENGER_VISIBLE', 'CRM_VISIBLE'];
const SUPERADMIN_PASSWORDS = [
    process.env.SUPERADMIN_PASSWORD,
    process.env.MASTER_ADMIN_PASSWORD,
    'neurolinks25',
    'neuroadmin25'
].filter(Boolean) as string[];
const isSuperAdminPassword = (pass: unknown): boolean => typeof pass === 'string' && SUPERADMIN_PASSWORDS.includes(pass);
const getLatestLeadReportDescription = (description: string | null | undefined): string => {
    const raw = String(description || '').trim();
    if (!raw) return '';

    const sections = raw
        .split(/\n\s*---[^\n]*\n/g)
        .map(section => section.trim())
        .filter(Boolean);

    const latestSummary = [...sections]
        .reverse()
        .find(section => /RESUMEN\s+DE\s+CONVERSACI/i.test(section) || /Chat del usuario/i.test(section));

    return latestSummary || sections[sections.length - 1] || raw;
};
historyEvents.on('setting_changed', async ({ key, value, projectId, serviceId }: { key: string; value: any; projectId: string; serviceId?: string | null }) => {
    if (VISIBILITY_KEYS.includes(key)) invalidateVisibilityCache();
    if (key === 'ADMIN_PASS' || key === 'ADMIN_USER') invalidateAuthCache();

    // SincronizaciÃ³n automÃ¡tica de herramientas segÃºn el CLIENT_SLUG configurado
    if (key === 'CLIENT_SLUG') {
        const slug = String(value || '').trim().toLowerCase();
        console.log(`📡 [toolRouter/OpenAI] CLIENT_SLUG cambiado a '${slug}' en proyecto ${projectId}, servicio ${serviceId}.`);

        // Limpiar el CRM_FIELDS_CONFIG anterior para que al entrar al CRM cargue los nuevos defaults del slug elegido
        try {
            await HistoryHandlerClass.saveSetting('CRM_FIELDS_CONFIG', '', projectId, serviceId);
            console.log(`🧹 [CRM Config] Reset CRM_FIELDS_CONFIG a vacío para usar defaults de '${slug}' en ${projectId}, servicio ${serviceId}.`);
        } catch (e: any) {
            console.error(`âŒ [CRM Config] Error al resetear CRM_FIELDS_CONFIG en cambio de slug:`, e.message);
        }

        // Intentar cargar el mÃ³dulo cliente dinÃ¡micamente desde el registro
        try {
            const { moduleRegistry } = await import('../../bot/toolRegistry');
            const activeModule = (moduleRegistry as any)[slug];

            if (activeModule && activeModule.openAiTools) {
                console.log(`🤖 [OpenAI] Registrando automáticamente herramientas del módulo '${slug}' para proyecto ${projectId}, servicio ${serviceId}...`);
                await HistoryHandlerClass.saveSetting('OPENAI_TOOLS_DEFINITION', JSON.stringify(activeModule.openAiTools), projectId, serviceId);
            } else {
                // Si el slug está vacío o no tiene herramientas nativas de OpenAI, limpiamos la definición actual del proyecto
                const currentTools = await HistoryHandlerClass.getConfig('OPENAI_TOOLS_DEFINITION', projectId, serviceId);
                if (currentTools && currentTools.trim() !== '') {
                    console.log(`🗑️ [OpenAI] Quitando herramientas para proyecto ${projectId}, servicio ${serviceId} (SLUG vacío o sin herramientas)...`);
                    await HistoryHandlerClass.saveSetting('OPENAI_TOOLS_DEFINITION', '', projectId, serviceId);
                }
            }
        } catch (err: any) {
            console.error(`âŒ [OpenAI] Error al resolver el mÃ³dulo de cliente para registrar herramientas:`, err.message);
        }
    }

    // Si cambian las definiciones de herramientas, sincronizarlas de inmediato con todos los asistentes de OpenAI
    if (key === 'OPENAI_TOOLS_DEFINITION') {
        try {
            const { syncAssistantTools } = await import('../../apis/openai/openaiHelper');
            const assistantsKeys = ['ASSISTANT_ID', 'ASSISTANT_2', 'ASSISTANT_3', 'ASSISTANT_4', 'ASSISTANT_5'];
            for (const envKey of assistantsKeys) {
                const assistantId = await HistoryHandlerClass.getConfig(envKey, projectId, serviceId);
                if (assistantId && assistantId.trim() !== '' && !assistantId.includes('+') && /^asst_[a-zA-Z0-9_-]+$/.test(assistantId.trim())) {
                    console.log(`🔄 [OpenAI] Sincronizando herramientas para Asistente (${envKey}: ${assistantId}) en proyecto ${projectId}, servicio ${serviceId}...`);
                    await syncAssistantTools(assistantId, projectId, serviceId);
                }
            }
        } catch (e: any) {
            console.error(`âŒ [OpenAI] Error al sincronizar herramientas de asistentes:`, e.message);
        }
    }
});


// Helper to dynamically extract projectId from query, body, or headers
export const resolveProjectId = (req: any): string | null => {
    const pId = req?.query?.projectId || (req?.body && req?.body.projectId) || req?.headers?.['x-project-id'] || (req?.auth && req?.auth.projectId);
    if (pId && pId !== 'default') return pId;
    if (req?.hostInfo) return req.hostInfo.projectId;
    return null;
};

// Helper to dynamically extract serviceId from query, body, or headers
export const resolveServiceId = (req: any): string | null => {
    const sId = req?.query?.serviceId || (req?.body && req?.body.serviceId) || req?.headers?.['x-service-id'] || (req?.auth && req?.auth.serviceId);
    if (sId && sId !== 'default') return sId;
    if (req?.hostInfo) return req.hostInfo.serviceId;
    return (process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || 'default_service');
};

// CachÃ© para fotos de perfil (chatId -> {url, timestamp})
const profilePicCache = new Map<string, { url: string, expires: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora
// Negative cache: chatIds sin foto de perfil (evita llamadas repetidas a WhatsApp)
const profilePicNotFound = new Map<string, number>();
const NOT_FOUND_TTL = 1000 * 60 * 10; // 10 minutos

/**
 * Registra las rutas del backoffice en la instancia de Polka.
 */


/**
 * Helper para disparar la sincronizacion de Meta SMB (contactos + historial).
 */
async function triggerMetaSync(accessToken: string, phoneId: string) {
    console.log(`[SMB-SYNC] Iniciando sincronizacion automatica para ${phoneId}...`);
    await axios.post(`https://graph.facebook.com/v25.0/${phoneId}/smb_app_data`,
        { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' },
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    console.log('[SMB-SYNC] Solicitud de contactos enviada.');

    try {
        await axios.post(`https://graph.facebook.com/v25.0/${phoneId}/smb_app_data`,
            { messaging_product: 'whatsapp', sync_type: 'history' },
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        console.log('[SMB-SYNC] Solicitud de historial enviada.');
        return { contacts: true, history: true, historySkipped: false };
    } catch (historyErr: any) {
        const errorData = historyErr?.response?.data || {};
        const details = errorData.error?.error_data?.details || errorData.error?.message || historyErr.message;
        if (String(details).includes('outside of allowed time window')) {
            console.warn('[SMB-SYNC] Historial fuera de ventana; contactos solicitados correctamente.');
            return { contacts: true, history: false, historySkipped: true };
        }
        throw historyErr;
    }
}
/** FunciÃ³n unificada para procesar el envÃ­o de mensajes e historial */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isMetaProvider = (provider: any): boolean => {
    if (!provider) return false;
    return typeof provider.getTemplates === 'function' || typeof provider.sendTemplate === 'function';
};

const getStoredRawPayload = (messageData: any): any => {
    return messageData?.raw_payload || messageData?.rawPayload || null;
};

const getStoredBaileysMessage = (messageData: any): any => {
    const raw = getStoredRawPayload(messageData);
    if (!raw) return null;
    if (raw.key && raw.message) return raw;
    if (raw.payload?.key && raw.payload?.message) return raw.payload;
    if (raw.waMessage?.key && raw.waMessage?.message) return raw.waMessage;
    return null;
};

const getBaileysMessageContent = (messageData: any): any => {
    const content = String(messageData?.content || '');
    const type = messageData?.type || 'text';
    if (type === 'image') return { imageMessage: { caption: content } };
    if (type === 'video') return { videoMessage: { caption: content } };
    if (type === 'audio' || type === 'voice') return { audioMessage: {} };
    if (type === 'document') {
        const rawName = content.split('?')[0].split('/').pop() || 'archivo';
        let filename = rawName;
        try {
            filename = decodeURIComponent(rawName);
        } catch {
            filename = rawName;
        }
        return { documentMessage: { fileName: filename, title: filename } };
    }
    return { conversation: content || 'Mensaje' };
};

const buildFallbackBaileysQuote = (messageData: any, jid: string): any => {
    const externalId = messageData?.external_id;
    if (!externalId) return null;
    const timestamp = messageData?.created_at
        ? Math.floor(new Date(messageData.created_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
    return {
        key: {
            remoteJid: jid,
            id: externalId,
            fromMe: messageData?.role === 'assistant'
        },
        message: getBaileysMessageContent(messageData),
        messageTimestamp: timestamp
    };
};

const buildReplyPreviewPayload = async (messageData: any, chatId: string, projectId: string, serviceId: string | null, replyId: string): Promise<any> => {
    if (!messageData && !replyId) return null;
    const replyType = messageData?.type || 'text';
    const cleanReplyContent = String(messageData?.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const replyPreviewText = replyType !== 'text'
        ? (replyType === 'image' ? 'Imagen' : replyType === 'video' ? 'Video' : replyType === 'audio' || replyType === 'voice' ? 'Audio' : 'Archivo')
        : (cleanReplyContent || 'Mensaje').slice(0, 120);
    let replyAuthor = 'Cliente';
    if (messageData?.role === 'assistant') {
        replyAuthor = 'Vos';
    } else {
        const chatInfo = await HistoryHandlerClass.getChat(chatId, projectId, serviceId || undefined).catch(() => null);
        replyAuthor = (chatInfo?.name && chatInfo.name !== '[-]') ? chatInfo.name : String(chatId).split('@')[0];
    }

    return {
        replyTo: replyId,
        replyPreview: {
            id: replyId,
            localId: messageData?.id || null,
            role: messageData?.role || null,
            author: replyAuthor,
            content: replyPreviewText,
            type: replyType
        }
    };
};

export const processSendMessage = async (
    req: any,
    res: any,
    chatId: string,
    message: string,
    file: any,
    replyTo?: string
) => {
    const projectId = req.query.projectId || (req.body && req.body.projectId) || req.headers['x-project-id'] || (req.auth && req.auth.projectId) || null;
    const currentProjectId = projectId || HistoryHandlerClass.PROJECT_IDENTIFIER;
    const currentServiceId = resolveServiceId(req) || HistoryHandlerClass.SERVICE_IDENTIFIER;
    const serviceId = req.query.serviceId || (req.body && req.body.serviceId) || req.headers['x-service-id'] || (req.auth && req.auth.serviceId) || null;
    const adapterProvider = getAdapterProvider();
    const depsHistoryHandler = HistoryHandlerClass;
    const openaiMain = await getOpenAI(currentProjectId, currentServiceId);
    const groupProvider = getGroupProvider();
    // 1. Determinar tipo y contenido
    let finalType: 'text' | 'image' | 'video' | 'document' | 'sticker' | 'audio' = 'text';
    if (file) {
        const lowerOrigName = (file.originalname || '').toLowerCase();
        const lowerFileName = (file.filename || '').toLowerCase();
        if (file.mimetype === 'image/webp' || lowerOrigName.endsWith('.webp') || lowerFileName.endsWith('.webp')) {
            finalType = 'sticker';
        } else if (file.mimetype.startsWith('image/')) {
            finalType = 'image';
        } else if (file.mimetype.startsWith('video/')) {
            finalType = 'video';
        } else if (file.mimetype.startsWith('audio/')) {
            finalType = 'audio';
        } else {
            finalType = 'document';
        }
    }

    const fileUrl = file ? `/uploads/${file.filename}?name=${encodeURIComponent(file.originalname)}` : '';
    const finalContent = file ? fileUrl : (message || '');

    try {
        if (!adapterProvider) {
            return res.status(503).json({ success: false, error: 'WhatsApp provider not initialized' });
        }

        console.log(`[BACKOFFICE] Procesando envío para ${chatId}...`);
        let replyMessageData: any = null;
        let replyExternalId = '';
        let replyRawPayload: any = null;
        
        // Resolver el serviceId específico de este chat
        let targetServiceId = serviceId || currentServiceId;
        if (!targetServiceId || targetServiceId === 'default_service') {
            const chatObj = await depsHistoryHandler.getChat(chatId, currentProjectId);
            if (chatObj && chatObj.service_id) {
                targetServiceId = chatObj.service_id;
            }
        }
        if (!targetServiceId) targetServiceId = 'default_service';

        // El guardado se movió después del envío para capturar el ID real y evitar duplicados

        // 3. Inyectar en thread OpenAI (silencioso)
        depsHistoryHandler.getThreadId(chatId).then((threadId: string | null) => {
            if (threadId && (message || file) && openaiMain) {
                openaiMain.beta.threads.messages.create(threadId, {
                    role: 'assistant',
                    content: `[Mensaje enviado por operador humano]: ${message || '[Media]'}`
                }).catch(() => {});
            }
        }).catch(() => {});

        // 4. ENVIAR A WHATSAPP
        try {
            const isGroup = chatId.includes('@g.us');
            const providerToSend = (isGroup && groupProvider) ? groupProvider : adapterProvider;
            if (replyTo) {
                if (process.env.STORAGE_MODE === "local") {
                    const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                    const messages = await LocalHistoryStore.getMessages(chatId, 1000, 0, currentProjectId, targetServiceId);
                    replyMessageData = messages.find((m: any) => m.id === replyTo || m.external_id === replyTo);
                } else {
                    const isUuid = UUID_RE.test(replyTo);
                    let query = supabase.from('messages').select('*').eq('chat_id', chatId).eq('project_id', currentProjectId);
                    if (targetServiceId && targetServiceId !== 'default' && targetServiceId !== 'default_service') {
                        query = query.eq('service_id', targetServiceId);
                    }
                    if (isUuid) {
                        query = query.or(`id.eq.${replyTo},external_id.eq.${replyTo}`);
                    } else {
                        query = query.eq('external_id', replyTo);
                    }
                    const { data, error } = await query.maybeSingle();
                    if (!error && data) replyMessageData = data;
                }

                if (replyMessageData?.external_id) {
                    replyExternalId = replyMessageData.external_id;
                } else if (!UUID_RE.test(replyTo)) {
                    replyExternalId = replyTo;
                }

                if (replyExternalId || replyMessageData) {
                    replyRawPayload = await buildReplyPreviewPayload(replyMessageData, chatId, currentProjectId, targetServiceId, replyExternalId || replyTo);
                }
            }
            
            console.log(`[BACKOFFICE] Enviando via ${providerToSend.constructor.name} a ${chatId} (Service: ${targetServiceId})`);

            const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
            let providerResponse: any = null;
            const providerIsMeta = isMetaProvider(providerToSend);
            const baileysQuoted = replyMessageData
                ? (getStoredBaileysMessage(replyMessageData) || buildFallbackBaileysQuote(replyMessageData, jid))
                : null;

            if (file) {
                const absolutePath = path.resolve(file.path);
                const opts: any = { media: absolutePath, mimetype: file.mimetype, fileName: file.originalname };
                if (replyExternalId) opts.replyTo = replyExternalId;

                if (providerIsMeta) {
                    if (finalType === 'sticker') opts.type = 'sticker';
                    providerResponse = await providerToSend.sendMessage(jid, message || '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                } else if (baileysQuoted && providerToSend.vendor && typeof providerToSend.vendor.sendMessage === 'function') {
                    const mediaContent: any = {};
                    if (finalType === 'image') mediaContent.image = { url: absolutePath };
                    else if (finalType === 'video') mediaContent.video = { url: absolutePath };
                    else if (finalType === 'audio') mediaContent.audio = { url: absolutePath };
                    else if (finalType === 'sticker') mediaContent.sticker = { url: absolutePath };
                    else mediaContent.document = { url: absolutePath };
                    if (message && finalType !== 'audio' && finalType !== 'sticker') mediaContent.caption = message;
                    if (finalType === 'document') {
                        mediaContent.fileName = file.originalname;
                        mediaContent.mimetype = file.mimetype;
                    }
                    providerResponse = await providerToSend.vendor.sendMessage(jid, mediaContent, { quoted: baileysQuoted });
                } else if (finalType === 'sticker') {
                    opts.type = 'sticker';
                    if (typeof (providerToSend as any).sendSticker === 'function') {
                        providerResponse = await (providerToSend as any).sendSticker(jid, absolutePath, { serviceId: targetServiceId, projectId: currentProjectId });
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                    }
                } else if (finalType === 'image') {
                    if (typeof providerToSend.sendImage === 'function') {
                        providerResponse = await providerToSend.sendImage(jid, absolutePath, message || '', { serviceId: targetServiceId, projectId: currentProjectId });
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                    }
                } else if (finalType === 'video') {
                    if (typeof (providerToSend as any).sendVideo === 'function') {
                        providerResponse = await (providerToSend as any).sendVideo(jid, absolutePath, message || '', { serviceId: targetServiceId, projectId: currentProjectId });
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                    }
                } else if (finalType === 'audio') {
                    if (typeof (providerToSend as any).sendAudio === 'function') {
                        providerResponse = await (providerToSend as any).sendAudio(jid, absolutePath, message || file.originalname, { serviceId: targetServiceId, projectId: currentProjectId });
                    } else {
                        opts.media = { url: absolutePath, mimetype: file.mimetype };
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                    }
                } else {
                    opts.fileName = file.originalname;
                    if (isMetaProvider(providerToSend)) {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                    } else if (typeof (providerToSend as any).sendFile === 'function') {
                        providerResponse = await (providerToSend as any).sendFile(jid, absolutePath, message || file.originalname, { serviceId: targetServiceId, projectId: currentProjectId });
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { ...opts, serviceId: targetServiceId, projectId: currentProjectId });
                    }
                }
            } else {
                if (replyExternalId && providerIsMeta) {
                    providerResponse = await providerToSend.sendMessage(jid, message, { replyTo: replyExternalId, serviceId: targetServiceId, projectId: currentProjectId });
                } else if (baileysQuoted && providerToSend.vendor && typeof providerToSend.vendor.sendMessage === 'function') {
                    providerResponse = await providerToSend.vendor.sendMessage(jid, { text: message }, { quoted: baileysQuoted }); // serviceId no soportado aquí
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, message, { ...(replyExternalId ? { replyTo: replyExternalId } : {}), serviceId: targetServiceId, projectId: currentProjectId });
                }
            }

            // 5. GUARDAR EN HISTORIAL (Ahora con ID para evitar duplicados con el ECHO)
            // Builderbot/Baileys retorna el objeto mensaje, Meta retorna un objeto con { messages: [ { id: ... } ] }
            const externalId = providerResponse?.key?.id || providerResponse?.messages?.[0]?.id || providerResponse?.id;

            // Registrar ID en el cachÃ© de deduplicaciÃ³n para que el ECO no genere un segundo evento
            const { trackSentMessage } = await import('../../providers/provider.manager');
            trackSentMessage(externalId);

            await depsHistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType, undefined, undefined, externalId, 'whatsapp', currentProjectId, targetServiceId, replyRawPayload);
            await depsHistoryHandler.updateLastHumanMessage(chatId, currentProjectId, targetServiceId);
            await depsHistoryHandler.toggleBot(chatId, false, currentProjectId, targetServiceId);

            res.json({ success: true, messageId: externalId, fileUrl: file ? fileUrl : undefined });
        } catch (waError) {
            console.error('[BACKOFFICE] Error enviando a Whatsapp:', waError);
            // Si falló el envío, igual guardamos pero sin ID externo para que al menos quede el log local, marcado como 'failed'
            await depsHistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType, undefined, undefined, null, 'whatsapp', currentProjectId, targetServiceId, replyRawPayload, 'failed');

            res.json({
                success: true,
                fileUrl: file ? fileUrl : undefined,
                warning: 'El envÃ­o a WhatsApp fallÃ³ (Â¿Bot conectado?), el mensaje solo se guardÃ³ localmente.'
            });
        }

    } catch (e: any) {
        console.error('âŒ Error crÃ­tico en processSendMessage:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

/** Helper: responder JSON compatible con Polka crudo (sin compatibilityLayer) */
const sendJson = (res: any, statusCode: number, data: any) => {
    if (res.headersSent) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
};

export const processBulkTemplate = async (req: any, res: any) => {
    const depsHistoryHandler = HistoryHandlerClass;
    const projectId = resolveProjectId(req) || req.query.projectId || (req.body && req.body.projectId) || req.headers['x-project-id'] || (req.auth && req.auth.projectId) || null;
    const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
    const file = (req as any).file;
    const { templateName, languageCode } = req.body;
    const adapterProvider = getAdapterProvider();
    const groupProvider = getGroupProvider();

    try {
        if (!file || !templateName) {
            return sendJson(res, 400, { success: false, error: 'Falta el archivo o el nombre de la plantilla.' });
        }

        const xlsxModule = await import('xlsx');
        const xlsxLib = xlsxModule.default || xlsxModule;

        const workbook = xlsxLib.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data: any[] = xlsxLib.utils.sheet_to_json(worksheet, { defval: '' });

        if (data.length === 0) {
            return sendJson(res, 400, { success: false, error: 'El Excel estÃ¡ vacÃ­o.' });
        }

        const allKeys = Object.keys(data[0]);
        const paramKeys = allKeys.filter(k => k.toLowerCase() !== 'phone');

        // Determinar proveedor y obtener detalles de la plantilla
        const provider = (adapterProvider && typeof adapterProvider.sendTemplate === 'function') ? adapterProvider : groupProvider;
        const templates = await provider.getTemplates();
        const template = templates.find((t: any) => t.name === templateName);
        if (!template) throw new Error("Plantilla no encontrada al procesar envÃ­o masivo.");

        // DEBUG TOTAL: Ver toda la estructura de la plantilla para encontrar los nombres de parÃ¡metros
        console.log(`ðŸ” [BULK] DEBUG ESTRUCTURA COMPLETA:`, JSON.stringify(template, null, 2));

        // DetecciÃ³n mÃ¡s agresiva: si tiene parameter_format='named' O si algÃºn componente tiene parÃ¡metros nombrados en sus ejemplos
        const isNamed = (template.parameter_format || '').toLowerCase() === 'named' ||
                        template.components.some((c: any) =>
                            c.example?.body_text_named_params ||
                            c.example?.header_text_named_params ||
                            c.example?.header_handle_named_params
                        );

        // Detectar tipo de cabecera multimedia
        const headerComp = template.components.find((c: any) => c.type === 'HEADER');
        const mediaFormat = headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format) ? headerComp.format.toLowerCase() : null;

        const languageCode = template.language || 'es';
        console.log(`ðŸ“Š [BULK] Iniciando envÃ­o masivo: ${templateName} | Idioma: ${languageCode} | Formato final: ${isNamed ? 'NAMED' : 'POSITIONAL'} | Filas: ${data.length}`);

        sendJson(res, 202, { success: true, message: 'Proceso masivo iniciado.', total: data.length });

        let sent = 0, errors = 0;
        let firstRowLogged = false;
        let defaultMediaUrl = '';

        // CachÃ© local para no descargar 100 veces el mismo video de Drive
        const mediaCache = new Map<string, string>();
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        for (const row of data) {
            // AUTO-CORRECCIÃ“N: Convertir links externos a links locales servidos por nosotros
            if (row.header_media_url && (row.header_media_url.includes('drive.google.com') || row.header_media_url.includes('scontent.whatsapp.net') || row.header_media_url.includes('fbcdn.net'))) {

                let directUrl = row.header_media_url;
                const isDrive = row.header_media_url.includes('drive.google.com');

                if (isDrive) {
                    const driveIdMatch = row.header_media_url.match(/\/d\/([^/]+)/) || row.header_media_url.match(/id=([^&]+)/);
                    if (driveIdMatch && driveIdMatch[1]) {
                        directUrl = `https://drive.google.com/uc?export=download&id=${driveIdMatch[1]}`;
                    }
                }

                if (mediaCache.has(directUrl)) {
                    row.header_media_url = mediaCache.get(directUrl);
                } else {
                    try {
                        console.log(`ðŸ“¥ [BULK] Descargando media para servir localmente: ${directUrl.substring(0, 50)}...`);
                        const response = await axios.get(directUrl, {
                            responseType: 'arraybuffer',
                            timeout: 60000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,video/mp4,*/*;q=0.8'
                            }
                        });
                        const contentType = String(response.headers['content-type'] || '');
                        let ext = 'bin';
                        try {
                            const mimeModule = await import('mime-types');
                            const mime = mimeModule.default || mimeModule;
                            ext = mime.extension(contentType) || 'bin';
                            if (ext === 'bin') {
                                const urlWithoutQuery = row.header_media_url.split('?')[0];
                                ext = urlWithoutQuery.split('.').pop() || 'mp4';
                            }
                        } catch {
                            if (contentType.includes('video')) ext = 'mp4';
                            else if (contentType.includes('image')) ext = 'jpg';
                            else if (contentType.includes('pdf')) ext = 'pdf';
                            else {
                                const urlWithoutQuery = row.header_media_url.split('?')[0];
                                ext = urlWithoutQuery.split('.').pop() || 'mp4';
                            }
                        }

                        const filename = `bulk-${Date.now()}-${Math.floor(Math.random()*1000)}.${ext}`;
                        const dest = path.join(uploadsDir, filename);
                        fs.writeFileSync(dest, response.data);

                        // Construir URL pÃºblica priorizando el host de la peticiÃ³n actual (ej: ngrok)
                        let baseUrl = process.env.PROJECT_URL;
                        if (!baseUrl) {
                            const host = req.headers.host || '';
                            if (!host.includes('localhost')) {
                                baseUrl = `https://${host}`;
                            } else {
                                baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://${host}`;
                            }
                        }
                        if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
                        let finalUrl = `${baseUrl.replace(/\/$/, '')}/uploads/${filename}`;

                        // --- LÃ“GICA DE COMPRESIÃ“N AUTOMÃTICA ---
                        try {
                            const stats = fs.statSync(dest);
                            const sizeMB = stats.size / (1024 * 1024);

                            if (sizeMB > 15.5 && ext === 'mp4') {
                                console.log(`âš ï¸ [BULK] Video muy pesado (${sizeMB.toFixed(2)}MB). Iniciando compresiÃ³n...`);
                                const compressedFilename = `compressed-${filename}`;
                                const compressedDest = path.join(uploadsDir, compressedFilename);

                                // 1. Obtener duraciÃ³n (intentamos con ffprobe, fallback a ffmpeg)
                                let durationStr = '';
                                try {
                                    durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${dest}"`).toString().trim();
                                } catch (e) {
                                    try {
                                        const output = execSync(`ffmpeg -i "${dest}" 2>&1 | grep Duration`).toString();
                                        const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
                                        if (match) {
                                            const hours = parseFloat(match[1]);
                                            const mins = parseFloat(match[2]);
                                            const secs = parseFloat(match[3]);
                                            durationStr = (hours * 3600 + mins * 60 + secs).toString();
                                        }
                                    } catch (e2) {
                                        console.warn('âš ï¸ [BULK] Ni ffprobe ni ffmpeg estÃ¡n disponibles para obtener duraciÃ³n.');
                                    }
                                }
                                const duration = parseFloat(durationStr);

                                if (!isNaN(duration) && duration > 0) {
                                    // 2. Calcular bitrate contemplando video + audio + margen de seguridad (14MB total)
                                    const maxTotalSizeBytes = 14.0 * 1024 * 1024; // 14MB para estar seguros bajo los 16MB
                                    const totalTargetBitrate = Math.floor((maxTotalSizeBytes * 8) / duration);

                                    const audioBitrate = 64000; // 64 kbps es ideal y de excelente calidad para audio comprimido en WhatsApp
                                    let videoBitrate = totalTargetBitrate - audioBitrate;
                                    if (videoBitrate < 150000) {
                                        videoBitrate = 150000; // Bitrate mÃ­nimo de video de seguridad para evitar mala calidad extrema
                                    }

                                    // 3. Ejecutar ffmpeg especificando bitrates de video y audio
                                    console.log(`ðŸŽ¬ [BULK] Comprimiendo: Video a ${videoBitrate} bps, Audio a ${audioBitrate} bps (DuraciÃ³n: ${durationStr}s)`);
                                    execSync(`ffmpeg -i "${dest}" -b:v ${videoBitrate} -vcodec libx264 -preset fast -acodec aac -b:a ${audioBitrate} -movflags +faststart -y "${compressedDest}"`);

                                    // 4. Cambiar a la versiÃ³n comprimida
                                    finalUrl = `${baseUrl.replace(/\/$/, '')}/uploads/${compressedFilename}`;
                                    console.log(`âœ… [BULK] Video comprimido con Ã©xito: ${finalUrl}`);
                                }
                            }
                        } catch (compressError: any) {
                            console.error(`âŒ [BULK] Error en compresiÃ³n automÃ¡tica:`, compressError.message);
                            if (compressError.stderr) {
                                console.error(`ðŸ” [BULK] Detalle tÃ©cnico (stderr):`, compressError.stderr.toString());
                            }
                            // Si falla la compresiÃ³n, seguimos con el original como fallback
                        }
                        // ---------------------------------------

                        mediaCache.set(directUrl, finalUrl);
                        row.header_media_url = finalUrl;
                        console.log(`âœ… [BULK] Media lista para envÃ­o: ${finalUrl}`);
                    } catch (e: any) {
                        console.error(`âŒ [BULK] Error descargando media de URL externa:`, e.message);
                        // Fallback al link directo original si falla
                        row.header_media_url = directUrl;
                    }
                }
            }

            if (!firstRowLogged) {
                console.log('ðŸ” [BULK] Ejemplo de datos de la primera fila:', JSON.stringify(row));
                firstRowLogged = true;
                // Guardamos la primera URL (ya corregida si era Drive) como default
                defaultMediaUrl = row.header_media_url || '';
            }

            // Si la fila actual no tiene URL pero tenemos una default, la usamos
            if (!row.header_media_url && defaultMediaUrl) {
                row.header_media_url = defaultMediaUrl;
            }

            // DetecciÃ³n de telÃ©fono mÃ¡s flexible
            const phoneKey = Object.keys(row).find(k =>
                ['phone', 'tel', 'movil', 'cel', 'celular', 'telefono', 'whatsapp'].some(p => k.toLowerCase().includes(p))
            );

            const phone = phoneKey ? String(row[phoneKey] ?? '').replace(/\D/g, '') : '';

            if (!phone) {
                console.warn(`âš ï¸ [BULK] Fila omitida: No se encontrÃ³ telÃ©fono.`);
                continue;
            }

            const components: any[] = [];

            // Reordenar componentes segÃºn la definiciÃ³n de la plantilla
            for (const compDef of template.components) {
                if (compDef.type === 'HEADER') {
                    if (compDef.format === 'IMAGE' || compDef.format === 'VIDEO' || compDef.format === 'DOCUMENT') {
                        const lowFormat = compDef.format.toLowerCase();
                        const hasNamedParams = compDef.example?.header_handle_named_params || compDef.example?.header_text_named_params;

                        // Meta requiere SIEMPRE enviar el componente HEADER si la plantilla lo define.
                        // Si el usuario deja la celda vacÃ­a o con el link scontent original, lo usamos.
                        const mediaLink = row.header_media_url || defaultMediaUrl || compDef.example?.header_handle?.[0];

                        if (!mediaLink) {
                            console.warn(`âš ï¸ [BULK] No hay mediaLink para HEADER en la plantilla ${templateName}. Esto causarÃ¡ error en Meta.`);
                            continue; // Si realmente no hay nada que enviar, saltamos pero fallarÃ¡.
                        }

                        const headerParam: any = {
                            type: lowFormat,
                            [lowFormat]: { link: mediaLink }
                        };

                        if (isNamed) {
                            const officialName = hasNamedParams && hasNamedParams[0]?.param_name;
                            headerParam.parameter_name = officialName || (isNamed ? "video" : "1");
                        }

                        components.push({ type: 'HEADER', parameters: [headerParam] });
                    }
                } else if (compDef.type === 'BODY') {
                    const bodyParams: any[] = [];

                    // Si es positional, contamos cuÃ¡ntos parÃ¡metros espera
                    let expectedCount = 99; // Por defecto muchos para NAMED
                    if (!isNamed) {
                        const placeholders = (compDef.text || '').match(/{{(\d+)}}/g) || [];
                        expectedCount = placeholders.length;
                    }

                    // Para NAMED, mapeamos segÃºn los nombres definidos en la plantilla
                    if (isNamed) {
                        const namedParams = compDef.example?.body_text_named_params || [];
                        const varNames: string[] = [];
                        if (namedParams.length > 0) {
                            namedParams.forEach((np: any) => varNames.push(np.param_name));
                        } else {
                            // Fallback: Extraer variables del texto del cuerpo
                            const varRegex = /\{\{([^}]+)\}\}/g;
                            let match;
                            while ((match = varRegex.exec(compDef.text || '')) !== null) {
                                const varName = match[1].trim();
                                if (!varNames.includes(varName)) {
                                    varNames.push(varName);
                                }
                            }
                        }

                        for (const varName of varNames) {
                            // Buscar en el row del excel de forma case-insensitive
                            const matchedKey = Object.keys(row).find(k => k.toLowerCase() === varName.toLowerCase());
                            let val = matchedKey ? String(row[matchedKey] ?? '') : '';

                            // Auto-completado desde DB si es una variable de nombre y viene vacÃ­a
                            const lowerVar = varName.toLowerCase();
                            const isNameVar = ['nombre', 'name', 'nombre_cliente', 'nombrecliente'].includes(lowerVar);
                            if (isNameVar && (!val || val.trim() === '' || val === '-')) {
                                try {
                                    const chat = await depsHistoryHandler.getChat(phone, projectId, serviceId);
                                    if (chat && chat.name) {
                                        val = chat.name;
                                        console.log(`ðŸ‘¤ [BULK] Nombre autocompletado desde DB para ${phone}: ${val}`);
                                    }
                                } catch (dbErr: any) {
                                    console.warn(`âš ï¸ [BULK] No se pudo obtener el nombre desde DB para ${phone}:`, dbErr.message);
                                }
                            }

                            bodyParams.push({
                                type: 'text',
                                parameter_name: varName,
                                text: val || '-'
                            });
                        }
                    } else {
                        // POSITIONAL: Mapeo clÃ¡sico por orden
                        let added = 0;
                        for (const key of paramKeys) {
                            if (key === 'header_media_url' || key.startsWith('button_') || key === phoneKey) continue;
                            if (added >= expectedCount) break;

                            const val = String(row[key] ?? '');
                            bodyParams.push({ type: 'text', text: val || '-' });
                            added++;
                        }
                    }

                    if (bodyParams.length > 0) {
                        components.push({ type: 'BODY', parameters: bodyParams });
                    }
                }
            }

            // 3. BUTTONS DinÃ¡micos
            for (const key of paramKeys) {
                if (key.startsWith('button_') && key.endsWith('_url_suffix') && row[key]) {
                    const idxMatch = key.match(/button_(\d+)_/);
                    if (idxMatch) {
                        const btnIdx = parseInt(idxMatch[1]) - 1;
                        components.push({
                            type: 'button',
                            sub_type: 'url',
                            index: String(btnIdx),
                            parameters: [{ type: 'text', text: row[key] }]
                        });
                    }
                }
            }

            // --- RENDERIZAR TEXTO PARA EL HISTORIAL (Antes de intentar enviar) ---
            let renderedText = "";
            const bodyComp = template.components.find((c: any) => c.type === 'BODY');
            if (bodyComp) {
                renderedText = bodyComp.text || "";
                // Reemplazar variables (soporta {{1}} y {{nombre}})
                const varRegex = /\{\{(\w+)\}\}/g;
                renderedText = renderedText.replace(varRegex, (match, p1) => {
                    // Intentar obtener el valor de la fila (case-insensitive)
                    const val = row[p1] || row[p1.toLowerCase()] || row[p1.toUpperCase()] || match;
                    return String(val);
                });
            }
            const historyContent = `[Campaña: ${templateName}]\n${renderedText}`;

            try {
                console.log(`[BULK] Preparando envío para ${phone}. Componentes:`, JSON.stringify(components, null, 2));
                const resApi = await provider.sendTemplate(phone, templateName, languageCode || 'es_AR', components, { isBulk: true, projectId, serviceId });

                if (resApi?.messages) {
                    const msgId = resApi.messages[0].id;
                    console.log(`âœ… [BULK] Mensaje aceptado por Meta para ${phone}. ID: ${msgId}`);

                    // Si la plantilla tiene cabecera multimedia, guardar primero el mensaje multimedia
                    const headerComp = template.components.find((c: any) => c.type === 'HEADER');
                    if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
                        const lowFormat = headerComp.format.toLowerCase();
                        const mediaLink = row.header_media_url || defaultMediaUrl || headerComp.example?.header_handle?.[0];
                        if (mediaLink) {
                            await depsHistoryHandler.saveMessage(phone, 'assistant', mediaLink, lowFormat, undefined, undefined, `${msgId}_media`, 'whatsapp', projectId, serviceId);
                        }
                    }

                    // --- RENDERIZAR TEXTO PARA EL ASISTENTE ---
                    let renderedText = "";
                    const bodyComp = template.components.find((c: any) => c.type === 'BODY');
                    if (bodyComp) {
                        renderedText = bodyComp.text || "";
                        // Reemplazar variables (soporta {{1}} y {{nombre}})
                        const varRegex = /\{\{(\w+)\}\}/g;
                        renderedText = renderedText.replace(varRegex, (match, p1) => {
                            // Intentar obtener el valor de la fila (case-insensitive)
                            const val = row[p1] || row[p1.toLowerCase()] || row[p1.toUpperCase()] || match;
                            return String(val);
                        });
                    }

                    // Guardar con un prefijo informativo para el asistente
                    const historyContent = `[Campaña: ${templateName}]\n${renderedText}`;
                    await depsHistoryHandler.saveMessage(phone, 'assistant', historyContent, 'text', undefined, undefined, msgId, 'whatsapp', projectId, serviceId);
                    sent++;
                } else {
                    errors++;
                    console.error(`❌ [BULK] Fallo al enviar a ${phone}: Meta no devolvió ID de mensaje. Respuesta:`, JSON.stringify(resApi));
                    try {
                        await depsHistoryHandler.saveMessage(phone, 'assistant', historyContent, 'text', undefined, undefined, null, 'whatsapp', projectId, serviceId, undefined, 'failed');
                    } catch (saveErr: any) {
                        console.error('[BULK] Error al guardar mensaje fallido:', saveErr.message);
                    }
                }
            } catch (e: any) {
                errors++;
                const errorData = e?.response?.data || e.message || e;
                console.error(`❌ [BULK] Error de Meta para ${phone}:`, JSON.stringify(errorData, null, 2));
                try {
                    await depsHistoryHandler.saveMessage(phone, 'assistant', historyContent, 'text', undefined, undefined, null, 'whatsapp', projectId, serviceId, undefined, 'failed');
                } catch (saveErr: any) {
                    console.error('[BULK] Error al guardar mensaje fallido en catch:', saveErr.message);
                }
            }
            // Pequeño delay para no saturar la API
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`✅ [BULK] Proceso finalizado: ${sent} enviados, ${errors} errores de ${data.length} filas.`);
    } catch (e: any) {
        console.error('Error en processBulkTemplate:', e);
        // Nota: El res ya fue enviado (202), este error solo va a logs si ocurre después
    } finally {
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
};

/**
 * Registra las rutas del backoffice en la instancia de Polka.
 */
export const registerBackofficeRoutes = (app: any) => {
    const adapterProvider = getAdapterProvider();
    const depsHistoryHandler = HistoryHandlerClass;
    const groupProvider = getGroupProvider();

    // Middleware to dynamically resolve project and service IDs based on hostname
    app.use(async (req: any, res: any, next: any) => {
        const host = req.headers.host;
        if (host) {
            req.hostInfo = await getIdsByHost(host);
        }
        next();
    });

    if (!(process as any)._hasGlobalLogHandler) {
        (process as any)._hasGlobalLogHandler = true;
        process.on('uncaughtException', (err: any) => {
            console.error('[UncaughtException]', err);
            try {
                HistoryHandlerClass.saveSystemLog('SYSTEM', 'ERROR', err?.message || String(err), null, { stack: err?.stack, source: 'uncaughtException' });
            } catch (e) { /* ignore */ }
        });
        process.on('unhandledRejection', (reason: any) => {
            console.error('[UnhandledRejection]', reason);
            try {
                const msg = reason ? (reason.message || typeof reason === 'string' ? reason : JSON.stringify(reason)) : 'Unhandled Promise Rejection';
                HistoryHandlerClass.saveSystemLog('SYSTEM', 'ERROR', msg, null, { reason, source: 'unhandledRejection' });
            } catch (e) { /* ignore */ }
        });
    }



    // --- SYSTEM LOGS ---
    app.post('/api/backoffice/log-error', backofficeAuth, bodyParser.json(), (req: any, res: any) => {
        res.json({ success: true });
        try {
            const { message, clientId, details } = req.body || {};
            HistoryHandlerClass.saveSystemLog('SYSTEM', 'ERROR', message || 'Error desconocido del cliente', clientId || 'Cliente Web', details || {});
        } catch (e) { /* ignore */ }
    });

    // --- AUTH ---

    app.post('/api/backoffice/auth', bodyParser.json(), async (req: any, res: any) => {
        const { user, pass, token } = req.body;

        const isMaster = isSuperAdminPassword(pass);
        const projectId = (depsHistoryHandler as any).PROJECT_IDENTIFIER || process.env.RAILWAY_PROJECT_ID || 'unknown';

        let adminUser = '';
        let adminPass = '';

        // 0. Bloquear login si es proyecto huérfano (salvo SuperAdmin)
        if (!isMaster) {
            const tenantResolution = await (depsHistoryHandler as any).resolveTenantIdByProjectId(projectId);
            if (!tenantResolution.resolved && !tenantResolution.globalScope) {
                console.warn(`[AUTH-LOGIN] Proyecto ${projectId} huérfano. Rechazando intento de login normal.`);
                return res.status(401).json({ success: false, error: "Credenciales inválidas" });
            }

            // 1. Soporte para login dinámico
            const dbAdminUser = await depsHistoryHandler.getSetting('ADMIN_USER');
            const dbAdminPass = await depsHistoryHandler.getSetting('ADMIN_PASS');

            if (tenantResolution.tenantId && !tenantResolution.globalScope) {
                adminUser = dbAdminUser || ''; // Nunca hacer fallback a env para tenant real
                adminPass = dbAdminPass || ''; // Nunca hacer fallback a env para tenant real
            } else {
                adminUser = dbAdminUser || process.env.ADMIN_USER || 'admin';
                adminPass = dbAdminPass || process.env.ADMIN_PASS;
            }
        } else {
            const dbAdminUser = await depsHistoryHandler.getSetting('ADMIN_USER');
            adminUser = dbAdminUser || process.env.ADMIN_USER || 'admin';
        }

        const isAdmin = (!isMaster && adminUser !== '' && adminPass !== '' && user === adminUser && pass === adminPass);

        if (isMaster || isAdmin) {
            invalidateAuthCache();
            return res.json({
                success: true,
                token: pass,
                role: 'admin',
                user: user || adminUser,
                isSuperAdmin: isMaster
            });
        }

        // 3. Soporte para Sub-usuarios (Base de Datos)
        const subUser = await depsHistoryHandler.verifyUser(user, pass);
        if (subUser) {
            return res.json({
                success: true,
                token: `sub:${subUser.id}`,
                role: subUser.role,
                userId: subUser.id,
                user: subUser.username
            });
        }

        return res.status(401).json({ success: false, error: "Credenciales inválidas" });
    });

    app.get('/api/backoffice/me', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || HistoryHandlerClass.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || HistoryHandlerClass.SERVICE_IDENTIFIER;
            const isSuperAdmin = req.auth?.isSuperAdmin === true;
            let nombre = 'Usuario';
            let email: string | null = null;
            let plan_tipo: string | null = null;
            const clientResult = await supabase.from('clientes').select('nombre,email,plan_tipo').eq('id', projectId).maybeSingle();
            const clientData: any = clientResult.data;
            if (clientData) {
                plan_tipo = clientData.plan_tipo || null;
            }

            if (req.auth && req.auth.isSubUser && req.auth.userId) {
                const user = await depsHistoryHandler.getUserById(req.auth.userId);
                if (user) {
                    nombre = user.full_name || user.username || 'Usuario';
                    email = user.email || user.username || null;
                }
            } else {
                let data: any = clientData;
                if (clientResult.error) {
                    const fallback = await supabase.from('clientes').select('nombre,email').eq('id', projectId).maybeSingle();
                    data = fallback.data;
                }
                if (data && data.nombre) {
                    nombre = data.nombre;
                    email = data.email || null;
                } else {
                    nombre = process.env.RAILWAY_SERVICE_NAME || process.env.PROJECT_NAME || 'Admin';
                }
            }
            res.json({
                success: true,
                nombre,
                email,
                plan_tipo,
                isSuperAdmin,
                ...(isSuperAdmin ? { project_id: projectId, service_id: serviceId } : {})
            });
        } catch (e) {
            const isSuperAdmin = req.auth?.isSuperAdmin === true;
            res.json({
                success: true,
                nombre: 'Usuario',
                email: null,
                plan_tipo: null,
                isSuperAdmin,
                ...(isSuperAdmin
                    ? {
                        project_id: resolveProjectId(req) || HistoryHandlerClass.PROJECT_IDENTIFIER,
                        service_id: resolveServiceId(req) || HistoryHandlerClass.SERVICE_IDENTIFIER
                    }
                    : {})
            });
        }
    });

    // --- USER MANAGEMENT ---

    app.get('/api/backoffice/users', backofficeAuth, async (req: any, res: any) => {
        const users = await depsHistoryHandler.listUsers();
        res.json(users);
    });

    app.post('/api/backoffice/users', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        if (!req.auth.isAdmin) {
            return res.status(403).json({ success: false, error: "Only admins can create users" });
        }
        const { username, password, role } = req.body;
        const result = await depsHistoryHandler.createUser(username, password, role);
        res.json(result);
    });

    app.put('/api/backoffice/users/:id', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        if (!req.auth.isAdmin) {
            return res.status(403).json({ success: false, error: "Only admins can modify users" });
        }
        const { id } = req.params;
        const { role, username, password } = req.body;
        const result = await depsHistoryHandler.updateUser(id, { role, username, password });
        res.json(result);
    });

    app.delete('/api/backoffice/users/:id', backofficeAuth, async (req: any, res: any) => {
        if (!req.auth.isAdmin) {
            return res.status(403).json({ success: false, error: "Only admins can delete users" });
        }
        const { id } = req.params;
        const result = await depsHistoryHandler.deleteUser(id);
        res.json(result);
    });

    app.post('/api/backoffice/chat/assign', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, userId } = req.body;
        const result = await depsHistoryHandler.assignChatToUser(chatId, userId, resolveProjectId(req), resolveServiceId(req));
        res.json(result);
    });

    // --- CONTACTOS (Agenda central) ---

    const mapContactPayload = (body: any = {}) => ({
        channel: body.channel ?? null,
        channelValue: body.channelValue ?? body.channel_value ?? null,
        name: body.name ?? null,
        phoneRaw: body.phoneRaw ?? body.phone_raw ?? null,
        phoneNormalized: body.phoneNormalized ?? body.phone_normalized ?? null,
        email: body.email ?? null,
        whatsappChannel: body.whatsappChannel ?? body.whatsapp_channel ?? null,
        instagramChannel: body.instagramChannel ?? body.instagram_channel ?? null,
        facebookChannel: body.facebookChannel ?? body.facebook_channel ?? null,
        telegramChannel: body.telegramChannel ?? body.telegram_channel ?? null,
        webchatChannel: body.webchatChannel ?? body.webchat_channel ?? null,
        source: body.source ?? null,
        metadata: body.metadata ?? {}
    });

    const hasContactIdentity = (body: any = {}) => {
        return [
            body.name,
            body.channelValue,
            body.channel_value,
            body.phoneRaw,
            body.phone_raw,
            body.phoneNormalized,
            body.phone_normalized,
            body.email,
            body.whatsappChannel,
            body.whatsapp_channel,
            body.instagramChannel,
            body.instagram_channel,
            body.facebookChannel,
            body.facebook_channel,
            body.telegramChannel,
            body.telegram_channel,
            body.webchatChannel,
            body.webchat_channel
        ].some(v => v !== null && v !== undefined && String(v).trim() !== '');
    };

    app.get('/api/backoffice/contacts', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const contacts = await ContactService.listContacts(projectId, serviceId, {
                limit: parseInt(req.query.limit as string) || 50,
                offset: parseInt(req.query.offset as string) || 0,
                search: req.query.search as string,
                channel: req.query.channel as any
            });
            res.json({ success: true, contacts });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/backoffice/contacts/:contactId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const contact = await ContactService.getContact(projectId, serviceId, req.params.contactId);
            if (!contact) return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
            res.json({ success: true, contact });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/contacts', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            if (!hasContactIdentity(req.body)) {
                return res.status(400).json({ success: false, error: 'Se requiere al menos un dato del contacto' });
            }
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const contact = await ContactService.createOrUpdateContact(projectId, serviceId, mapContactPayload(req.body));
            res.json({ success: true, contact });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.patch('/api/backoffice/contacts/:contactId', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            if (!hasContactIdentity(req.body)) {
                return res.status(400).json({ success: false, error: 'Se requiere al menos un dato del contacto' });
            }
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const contact = await ContactService.updateContact(projectId, serviceId, req.params.contactId, mapContactPayload(req.body));
            if (!contact) return res.status(404).json({ success: false, error: 'Contacto no encontrado' });
            res.json({ success: true, contact });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.delete('/api/backoffice/contacts/:contactId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            await ContactService.deleteContact(projectId, serviceId, req.params.contactId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // --- CHATS & MESSAGES ---

    app.get('/api/backoffice/chats', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = parseInt(req.query.offset as string) || 0;
                        const search = req.query.search as string;
        const tag = req.query.tag as string;
        const platform = req.query.platform as string;

        // Si es subusuario, aplicamos filtro de asignación (ve lo suyo + lo libre)
        const assignedTo = req.auth.isSubUser ? req.auth.userId : null;

        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const visibleServices = await getVisibleServiceIds(projectId, serviceId);
        const chats = await depsHistoryHandler.listChats(limit, offset, search, tag, assignedTo, platform, projectId, visibleServices.join(','));
        res.json(chats);
    });

    // --- IMPORTACIÓN Y GESTIÓN DE CONTACTOS (Debe ir antes de :chatId) ---
    app.get('/api/backoffice/chats/import-template', backofficeAuth, (req: any, res: any) => {
        try {
            const data = [
                { phone: '5491122334455', name: 'Juan Perez', tags: 'Cliente, Interesado' },
                { phone: '5491166778899', name: 'Maria Lopez', tags: 'Soporte' }
            ];
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename=plantilla_contactos.xlsx');
            res.end(buf);
        } catch (error: any) {
            console.error('Error generando plantilla de importación:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/chats/import', backofficeAuth, (req: any, res: any) => {
        return processImportExcel(req, res);
    });

    app.post('/api/backoffice/chats/create-individual', backofficeAuth, (req: any, res: any) => {
        return processCreateIndividualContact(req, res);
    });

    app.get('/api/backoffice/chats/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const cleanId = depsHistoryHandler.normalizeId(req.params.chatId);

            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                const chat = await LocalHistoryStore.getChat(cleanId, projectId);
                return chat ? res.json(chat) : res.status(404).json({ success: false, error: 'Chat no encontrado' });
            }

            let query = supabase
                .from('chats')
                .select('id, type, name, last_message_at, last_human_message_at, assigned_to, bot_enabled, crm_status, crm_due_date, notes, email, source, is_lead, cuit_dni, tax_status, address, offered_product, unread_count, service_id, project_id, chat_tags(tag_id, tags(*))')
                .eq('id', cleanId)
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                query = query.eq('service_id', serviceId);
            }

            const { data, error } = await query.maybeSingle();
            if (error) throw error;
            if (!data) return res.status(404).json({ success: false, error: 'Chat no encontrado' });

            res.json({
                ...data,
                tags: data.chat_tags ? data.chat_tags.map((ct: any) => ct.tags).filter((t: any) => t !== null) : []
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.delete('/api/backoffice/chats/vaciar', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        if (!projectId) return res.status(400).json({ success: false, error: 'Se requiere ID de proyecto' });

        try {
            console.log(`[VACIAR] Iniciando eliminación secuencial para project_id: ${projectId}...`);
            await supabase.from("chat_tags").delete().eq("project_id", projectId);
            await supabase.from("messages").delete().eq("project_id", projectId);
            await supabase.from("tickets").delete().eq("project_id", projectId);
            await supabase.from("chats").delete().eq("project_id", projectId);
            await supabase.from("tags").delete().eq("project_id", projectId);

            console.log(`[VACIAR] Éxito: Base de datos vaciada para el proyecto.`);
            res.json({ success: true });
        } catch (e: any) {
            console.error(`[VACIAR] Error:`, e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // --- NUEVO: SUMARIO DE NOTIFICACIONES ---
    app.get('/api/backoffice/notifications/summary', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            let unread_chats_count = 0;
            let unread_notifications_count = 0;
            let latest_ticket_time: string | null = null;
            let latest_reporte_time: string | null = null;
            let latest_crm_lead_time: string | null = null;
            let latest_tarea_time: string | null = null;
            let crm_leads_count = 0;
            let crm_tasks_count = 0;

            unread_notifications_count = await depsHistoryHandler.getUnreadNotificationsCount(projectId, serviceId);

            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                const chats = LocalHistoryStore.getChats(projectId);
                const tickets = LocalHistoryStore.getTicketsList(projectId);

                // 1. Unread chats
                unread_chats_count = chats.filter(c => (c.unread_count || 0) > 0).length;

                // 2. Latest ticket time (tipo = 'Soporte')
                const activeTickets = tickets.filter(t => t.tipo === 'Soporte' && t.estado !== 'Cerrado');
                if (activeTickets.length > 0) {
                    const times = activeTickets.map(t => Math.max(new Date(t.created_at).getTime(), new Date(t.updated_at).getTime()));
                    latest_ticket_time = new Date(Math.max(...times)).toISOString();
                }

                // 3. Latest reporte time (tipo = 'Nuevo Lead')
                const reportes = tickets.filter(t => t.tipo === 'Nuevo Lead');
                if (reportes.length > 0) {
                    const times = reportes.map(t => Math.max(new Date(t.created_at).getTime(), new Date(t.updated_at).getTime()));
                    latest_reporte_time = new Date(Math.max(...times)).toISOString();
                }

                // 4. Latest CRM lead time
                const leads = chats.filter(c => c.is_lead === true || c.crm_status !== null);
                crm_leads_count = leads.length;
                if (leads.length > 0) {
                    const times = leads.map(c => new Date(c.last_message_at).getTime());
                    latest_crm_lead_time = new Date(Math.max(...times)).toISOString();
                }

                // 5. Latest CRM task time
                const tasks = chats.filter(c => c.is_lead === true && c.crm_due_date !== null);
                crm_tasks_count = tasks.length;
                if (tasks.length > 0) {
                    const times = tasks.map(c => new Date(c.last_message_at).getTime());
                    latest_tarea_time = new Date(Math.max(...times)).toISOString();
                }
            } else {
                // 1. Count chats with unread_count > 0
                const { data: unreadChats, error: unreadError } = await supabase
                    .from('chats')
                    .select('id')
                    .eq('project_id', projectId)
                    .gt('unread_count', 0);
                if (unreadError) throw unreadError;
                unread_chats_count = unreadChats?.length || 0;

                // 2. Latest ticket (tipo = 'Soporte')
                const { data: latestTicket, error: ticketError } = await supabase
                    .from('tickets')
                    .select('created_at, updated_at')
                    .eq('project_id', projectId)
                    .eq('tipo', 'Soporte')
                    .neq('estado', 'Cerrado')
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (ticketError) throw ticketError;
                if (latestTicket) {
                    latest_ticket_time = new Date(Math.max(new Date(latestTicket.created_at).getTime(), new Date(latestTicket.updated_at).getTime())).toISOString();
                }

                // 3. Latest reporte (tipo = 'Nuevo Lead')
                const { data: latestReporte, error: reporteError } = await supabase
                    .from('tickets')
                    .select('created_at, updated_at')
                    .eq('project_id', projectId)
                    .eq('tipo', 'Nuevo Lead')
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (reporteError) throw reporteError;
                if (latestReporte) {
                    latest_reporte_time = new Date(Math.max(new Date(latestReporte.created_at).getTime(), new Date(latestReporte.updated_at).getTime())).toISOString();
                }

                // 4. Latest CRM lead
                const { data: latestLead, error: leadError } = await supabase
                    .from('chats')
                    .select('last_message_at')
                    .eq('project_id', projectId)
                    .or('is_lead.eq.true,crm_status.not.is.null')
                    .order('last_message_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (leadError) throw leadError;
                if (latestLead) {
                    latest_crm_lead_time = latestLead.last_message_at;
                }
                const { count: crmLeadCount, error: leadCountError } = await supabase
                    .from('chats')
                    .select('id', { count: 'exact', head: true })
                    .eq('project_id', projectId)
                    .or('is_lead.eq.true,crm_status.not.is.null');
                if (leadCountError) throw leadCountError;
                crm_leads_count = crmLeadCount || 0;

                // 5. Latest CRM task
                const { data: latestTarea, error: tareaError } = await supabase
                    .from('chats')
                    .select('last_message_at')
                    .eq('project_id', projectId)
                    .eq('is_lead', true)
                    .not('crm_due_date', 'is', null)
                    .order('last_message_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (tareaError) throw tareaError;
                if (latestTarea) {
                    latest_tarea_time = latestTarea.last_message_at;
                }
                const { count: crmTaskCount, error: tareaCountError } = await supabase
                    .from('chats')
                    .select('id', { count: 'exact', head: true })
                    .eq('project_id', projectId)
                    .eq('is_lead', true)
                    .not('crm_due_date', 'is', null);
                if (tareaCountError) throw tareaCountError;
                crm_tasks_count = crmTaskCount || 0;
            }

            res.json({
                success: true,
                unread_chats_count,
                unread_notifications_count,
                latest_ticket_time,
                latest_reporte_time,
                latest_crm_lead_time,
                latest_tarea_time,
                crm_leads_count,
                crm_tasks_count
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.delete('/api/backoffice/chats/:chatId', backofficeAuth, (req: any, res: any) => {
        return processDeleteChat(req, res);
    });


    // --- QUICK MESSAGES ---

    app.get('/api/backoffice/quick-messages', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const messages = await depsHistoryHandler.getQuickMessages(projectId);
            res.json(messages);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/quick-messages', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const { title, message } = req.body;
            if (!title || !message) {
                return res.status(400).json({ success: false, error: 'Falta título o mensaje' });
            }
            const qm = await depsHistoryHandler.createQuickMessage(projectId, title, message);
            res.json({ success: true, data: qm });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.delete('/api/backoffice/quick-messages/:id', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const { id } = req.params;
            const success = await depsHistoryHandler.deleteQuickMessage(id, projectId);
            res.json({ success });
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.get('/api/backoffice/messages/:chatId', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const visibleServices = await getVisibleServiceIds(projectId, serviceId);
        const messages = await depsHistoryHandler.getMessages(req.params.chatId, limit, offset, projectId, visibleServices.join(','));
        res.json(messages);
    });

    app.get('/api/backoffice/profile-pic/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const { chatId } = req.params;

            if (!adapterProvider) {
                console.error('[ProfilePic] Error: adapterProvider no inicializado');
                res.status(500).end();
                return;
            }

            let jid = chatId;
            if (chatId.match(/^\d+$/) && !chatId.includes('@')) {
                jid = `${chatId}@s.whatsapp.net`;
            }

            // Negative cache: si ya sabemos que no tiene foto, responder 404 inmediatamente
            const notFoundAt = profilePicNotFound.get(jid);
            if (notFoundAt && (Date.now() - notFoundAt) < NOT_FOUND_TTL) {
                res.status(404).end();
                return;
            }

            const vendor = (adapterProvider as any).vendor || adapterProvider.globalVendorArgs?.sock;
            if (vendor && typeof vendor.profilePictureUrl === 'function') {
                try {
                    // 1. Verificar caché positivo
                    const cached = profilePicCache.get(jid);
                    if (cached && cached.expires > Date.now()) {
                        res.writeHead(302, { Location: cached.url });
                        return res.end();
                    }

                    // 2. Pedir a WhatsApp con timeout de 3s para no bloquear el pool de conexiones
                    const timeout = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
                    const url = await Promise.race([
                        vendor.profilePictureUrl(jid, 'image'),
                        timeout
                    ]) as string | null;

                    if (url) {
                        profilePicCache.set(jid, { url, expires: Date.now() + CACHE_TTL });
                        res.writeHead(302, { Location: url });
                        return res.end();
                    }
                } catch (_picError) {
                    // timeout o error de WhatsApp
                }
            }

            // Guardar en negative cache para evitar llamadas repetidas
            profilePicNotFound.set(jid, Date.now());
            res.status(404).end();
        } catch (e) {
            console.error('[ProfilePic] Error excepcional:', e);
        }
    });

    // --- WHATSAPP SYNC (BAILEYS / META) ---

    app.post('/api/backoffice/whatsapp/sync-contacts', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            // 1. Revisar si estamos en modo META OFFICIAL
            const metaConfig = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
            if (metaConfig && metaConfig.access_token && metaConfig.phone_number_id) {
                console.log(`¡ [SYNC] Sincronización Meta detectada. Solicitando historial SMB...`);
                try {
                    const tokenForSync = metaConfig.onboarding_data?.client_token || metaConfig.access_token;
                    const syncResult = await triggerMetaSync(tokenForSync, metaConfig.phone_number_id);
                    return res.json({
                        success: true,
                        summary: {
                            contacts: 'Meta Sync Triggered',
                            labels: 'N/A',
                            associations: 0,
                            meta_sync_triggered: true,
                            history_skipped: syncResult.historySkipped
                        }
                    });
                } catch (metaErr: any) {
                    const errorData = metaErr?.response?.data || {};
                    const details = errorData.error?.error_data?.details || errorData.error?.message || metaErr.message;

                    console.error('[SMB-SYNC] Fallo la sincronizacion de Meta:', details);

                    if (details.includes('outside of allowed time window')) {
                        return res.status(403).json({
                            success: false,
                            error: 'Meta ya no permite importar historial. Los chats entran al escribir.'
                        });
                    }

                    return res.status(500).json({
                        success: false,
                        error: `Error de Meta: ${details}`
                    });
                }
            }

            // 2. Fallback a Baileys si no hay Meta
            // Priorizamos el groupProvider ya que es el que suele ser Baileys en modo dual
            const provider = groupProvider || adapterProvider;

            // Intentamos obtener el socket (vendor) de todas las formas posibles conocidas
            const vendor = provider?.vendor ||
                           provider?.globalVendorArgs?.sock ||
                           (provider as any)?.sock ||
                           (provider as any)?.vendor?.sock;

            console.log(`¡ [SYNC] Intento de sincronización.`);
            console.log(`   - Provider: ${provider?.constructor?.name || 'Unknown'}`);
            console.log(`   - Vendor encontrado: ${!!vendor}`);
            if (vendor) {
                console.log(`   - WS Status: ${vendor.ws?.isOpen ? 'OPEN' : 'CLOSED/OTHER'}`);
                console.log(`   - User ID: ${vendor.user?.id || 'No user'}`);
                console.log(`   - Auth ID: ${vendor.authState?.creds?.me?.id || 'No auth'}`);
            }

            // DEBUG: Ver qué tiene el vendor realmente
            if (vendor) {
                const keys = Object.keys(vendor).filter(k => !k.startsWith('_'));
                console.log(`   - Propiedades del Vendor: ${keys.slice(0, 15).join(', ')}...`);
                console.log(`   - Store detectado: ${!!(vendor as any).store}`);
            }

            // Un motor es válido si tiene el vendor y alguna señal de sesión activa
            const isConnected = vendor && (
                vendor.ws?.isOpen ||
                !!vendor.user?.id ||
                !!vendor.authState?.creds?.me?.id
            );

            if (!isConnected) {
                console.warn('⚠️ [SYNC] Intento de sincronización con motor desconectado.');
                return res.status(503).json({
                    success: false,
                    error: 'El motor de WhatsApp (Baileys) no está conectado o la sesión ha expirado. Por favor, vuelva a vincular el dispositivo desde el panel de control.'
                });
            }

            if (vendor.ws?.isOpen === false) {
                console.warn('⚠️ [SYNC] El motor tiene sesión pero el WebSocket está cerrado. Los datos podrían estar desactualizados.');
            }

            console.log('¡ [SYNC] Iniciando extracción de datos desde el socket...');

            // 1. Obtener Etiquetas (Labels) por Query (solo Business)
            let labels: any[] = [];
            try {
                if (typeof vendor.labelsQuery === 'function') {
                    console.log('¡ [SYNC] Usando labelsQuery()...');
                    labels = await vendor.labelsQuery() || [];
                } else if (typeof (vendor as any).getLabels === 'function') {
                    console.log('¡ [SYNC] Usando getLabels()...');
                    labels = await (vendor as any).getLabels() || [];
                }
            } catch (e) {
                console.warn('⚠️ [SYNC] Error obteniendo etiquetas vía Query:', e);
            }

            // 2. Obtener Datos del Store
            // Buscamos el store en vendor, provider, o el provider interno (wrapper de builderbot)
            const store = (vendor as any).store ||
                          (provider as any).store ||
                          (provider as any).provider?.store ||
                          (provider as any).globalVendorArgs?.store;

            console.log(`¡ [SYNC] Diagnóstico de Store:`);
            console.log(`   - En vendor: ${!!(vendor as any).store}`);
            console.log(`   - En provider: ${!!(provider as any).store}`);
            console.log(`   - En provider.provider: ${!!(provider as any).provider?.store}`);

            let contactList: any[] = [];

            if (store) {
                console.log(`   - Store Keys: ${Object.keys(store).join(', ')}`);
                const storeContacts = store.contacts;
                const storeChats = store.chats;

                // Detectar si contacts es un Map, un Object o un KeyedDB
                if (storeContacts) {
                    if (storeContacts instanceof Map) {
                        console.log(`   - Store Data: ${storeContacts.size} contactos en store.contacts (Map)`);
                        contactList = Array.from(storeContacts.values());
                    } else if (typeof storeContacts.all === 'function') {
                        const allC = storeContacts.all();
                        console.log(`   - Store Data: ${allC.length} contactos en store.contacts (KeyedDB)`);
                        contactList = allC;
                    } else {
                        const keys = Object.keys(storeContacts);
                        console.log(`   - Store Data: ${keys.length} contactos en store.contacts (Object)`);
                        contactList = Object.values(storeContacts);
                    }
                }

                // Si hay pocos contactos, intentar complementar con la lista de chats
                if (storeChats) {
                    const allChats = typeof storeChats.all === 'function' ? storeChats.all() :
                                    (typeof storeChats.toJSON === 'function' ? storeChats.toJSON() : []);

                    console.log(`   - Store Data: ${allChats.length} chats en store.chats`);

                    // Fusionar: Agregar chats que no estén en contactList
                    const existingIds = new Set(contactList.map(c => c.id));
                    for (const chat of allChats) {
                        if (chat.id && !existingIds.has(chat.id)) {
                            contactList.push(chat);
                        }
                    }
                }

                // Extraer etiquetas del store si no se obtuvieron por query
                if (labels.length === 0 && store.labels) {
                    const storeLabels = store.labels;
                    if (storeLabels instanceof Map) {
                        labels = Array.from(storeLabels.values());
                    } else if (typeof storeLabels.values === 'function') {
                        labels = Array.from(storeLabels.values());
                    } else {
                        labels = Object.values(storeLabels);
                    }
                    console.log(`   - Store Labels: ${labels.length} encontradas en el store.`);
                }
            }

            // Fallback total al vendor si todo lo anterior falló (intentamos obtener del socket directamente)
            if (contactList.length === 0) {
                console.log('¡ [SYNC] ContactList vacía, intentando fallback a vendor.contacts o vendor.chats...');
                const vendorContacts = vendor.contacts || (vendor as any).contacts || (vendor as any).chats || {};

                if (vendorContacts && typeof (vendorContacts as any).all === 'function') {
                    contactList = (vendorContacts as any).all();
                } else {
                    contactList = Object.values(vendorContacts);
                }
            }

            console.log(`¡ [SYNC] Resultado extracción: ${contactList.length} registros, ${labels.length} etiquetas.`);

            // 3. Sincronizar Etiquetas en DB
            const tagMap = new Map<string, string>(); // name -> uuid_db
            let syncTagsSummary = 0;

            if (labels.length > 0) {
                const tagsToSync = labels.map(l => ({
                    name: l.name,
                    color: l.color !== undefined ? `#${Number(l.color).toString(16).padStart(6, '0')}` : '#6366f1'
                }));

                const syncRes = await depsHistoryHandler.syncTags(tagsToSync, projectId, serviceId);
                if (syncRes.success && syncRes.data) {
                    syncRes.data.forEach((t: any) => tagMap.set(t.name, t.id));
                    syncTagsSummary = syncRes.data.length;
                }
            }

            // 4. Sincronizar Contactos en DB (Chats)
            const chatsToSync = contactList
                .filter((c: any) => c.id && (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@g.us')))
                .map((c: any) => {
                    const id = c.id;
                    const isGroup = id.endsWith('@g.us');

                    // Normalizar el ID igual que lo hace depsHistoryHandler.getOrCreateChat
                    let cleanId = id.replace(/@s\.whatsapp\.net$/, '');
                    cleanId = cleanId.replace(/@c\.us$/, '');

                    // Intentar obtener el mejor nombre posible
                    let name = c.notify || c.name || c.subject || c.verifiedName || cleanId;
                    if (name === '[-]') name = null;

                    return {
                        id: cleanId,
                        name,
                        type: isGroup ? 'group' : 'whatsapp',
                        is_lead: false,
                        last_message_at: c.conversationTimestamp
                            ? new Date(c.conversationTimestamp * 1000).toISOString()
                            : new Date().toISOString()
                    };
                });

            console.log(`¡ [SYNC] Procesados ${chatsToSync.length} candidatos para upsert.`);
            const syncChatsRes = await depsHistoryHandler.syncChats(chatsToSync, projectId, serviceId);

            // 5. Vincular Etiquetas a Contactos
            const associations: any[] = [];
            for (const contact of contactList as any[]) {
                if (contact.id && contact.labels && Array.isArray(contact.labels) && contact.labels.length > 0) {
                    // Normalizar ID para la asociación
                    let cleanId = contact.id.replace(/@s\.whatsapp\.net$/, '');
                    cleanId = cleanId.replace(/@c\.us$/, '');

                    for (const labelId of contact.labels) {
                        const labelObj = labels.find(l => l.id === labelId || l.labelId === labelId);
                        if (labelObj && tagMap.has(labelObj.name)) {
                            associations.push({
                                chat_id: cleanId,
                                tag_id: tagMap.get(labelObj.name)
                            });
                        }
                    }
                }
            }

            if (associations.length > 0) {
                console.log(`¡ [SYNC] Vinculando ${associations.length} etiquetas a contactos...`);
                await depsHistoryHandler.syncChatTags(associations, projectId, serviceId);
            }

            res.json({
                success: true,
                summary: {
                    contacts: chatsToSync.length,
                    labels: syncTagsSummary,
                    associations: associations.length
                }
            });

        } catch (error: any) {
            console.error('❌ [SYNC] Error en ruta de sincronización:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- SEND MESSAGE & TOGGLE BOT ---

    app.post('/api/backoffice/send-message', backofficeAuth, (req: any, res: any, _next: any) => {
        if (req.body && Object.keys(req.body).length > 0) {
            console.warn("⚠️ [BACKOFFICE] Cuerpo detectado ANTES de Multer. Posible conflicto de stream.");
        }

        upload.single('file')(req, res, (err: any) => {
            if (err) {
                console.error("❌ [BACKOFFICE] Error de Multer:", err);
                return res.status(400).json({ success: false, error: `Error de archivo: ${err.message}` });
            }
            const { chatId, message, replyTo } = req.body;
            if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });

            // Pasamos deps como sexto argumento y replyTo como el séptimo
            processSendMessage(req, res, chatId, message, (req as any).file, replyTo);
        });
    });

    app.delete('/api/backoffice/messages/:chatId/:messageId', backofficeAuth, async (req: any, res: any) => {
        const { chatId, messageId } = req.params;
        const currentProjectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

        let messageData: any = null;
        if (process.env.STORAGE_MODE === "local") {
            const { LocalHistoryStore } = await import('../../db/localHistoryStore');
            const messages = await LocalHistoryStore.getMessages(chatId, 1000, 0, currentProjectId, currentServiceId);
            messageData = messages.find((m: any) => m.id === messageId || m.external_id === messageId);
        } else {
            let query = supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .eq('project_id', currentProjectId);
            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }
            const { data, error } = await query
                .or(`id.eq.${messageId},external_id.eq.${messageId}`)
                .maybeSingle();
            if (!error && data) {
                messageData = data;
            }
        }

        if (!messageData) {
            return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
        }

        const isGroup = chatId.includes('@g.us');
        const provider = (isGroup && groupProvider) ? groupProvider : adapterProvider;
        const isMeta = isMetaProvider(provider);

        let deletedInWhatsApp = false;

        if (!isMeta && provider && messageData.external_id) {
            try {
                const vendor = provider.vendor || provider.globalVendorArgs?.sock;
                if (vendor && typeof vendor.sendMessage === 'function') {
                    const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
                    await vendor.sendMessage(jid, {
                        delete: {
                            remoteJid: jid,
                            fromMe: messageData.role === 'assistant',
                            id: messageData.external_id
                        }
                    });
                    deletedInWhatsApp = true;
                    console.log(`[BACKOFFICE] Mensaje ${messageData.external_id} revocado en WhatsApp (Baileys)`);
                }
            } catch (err: any) {
                console.error('[BACKOFFICE] Error intentando revocar mensaje en WhatsApp (Baileys):', err.message);
            }
        }

        // Borrar del historial
        const success = await depsHistoryHandler.deleteMessage(messageData.id || messageId, chatId, currentProjectId);

        if (success) {
            res.json({
                success: true,
                deletedInWhatsApp,
                message: isMeta ? 'Mensaje eliminado del Backoffice. Nota: Meta Cloud API no admite eliminar/revocar mensajes enviados en la app de WhatsApp.' : 'Mensaje eliminado correctamente.'
            });
        } else {
            res.status(500).json({ success: false, error: 'No se pudo eliminar el mensaje' });
        }
    });

    app.post('/api/backoffice/messages/react', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, messageId, reaction } = req.body;
        if (!chatId || !messageId) {
            return res.status(400).json({ success: false, error: 'chatId and messageId are required' });
        }

        try {
            const currentProjectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const currentServiceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

            // 1. Look up message in DB to get fromMe
            let messageData: any = null;
            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                const messages = await LocalHistoryStore.getMessages(chatId, 1000, 0, currentProjectId, currentServiceId);
                messageData = messages.find((m: any) => m.id === messageId || m.external_id === messageId);
            } else {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId);
                let query = supabase.from('messages').select('*').eq('chat_id', chatId).eq('project_id', currentProjectId);
                if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                    query = query.eq('service_id', currentServiceId);
                }
                if (isUuid) {
                    query = query.or(`id.eq.${messageId},external_id.eq.${messageId}`);
                } else {
                    query = query.eq('external_id', messageId);
                }
                const { data, error } = await query.maybeSingle();
                if (!error && data) {
                    messageData = data;
                }
            }

            if (!messageData) {
                return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
            }

            const fromMe = messageData.role === 'assistant';
            const externalId = messageData.external_id || messageId;

            const isGroup = chatId.includes('@g.us');
            const provider = (isGroup && groupProvider) ? groupProvider : adapterProvider;
            const isMeta = isMetaProvider(provider);

            let reactedInWhatsApp = false;

            if (!isMeta && provider && externalId) {
                const vendor = provider.vendor || provider.globalVendorArgs?.sock;
                if (vendor && typeof vendor.sendMessage === 'function') {
                    const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
                    await vendor.sendMessage(jid, {
                        react: {
                            text: reaction || '',
                            key: {
                                remoteJid: jid,
                                id: externalId,
                                fromMe: fromMe
                            }
                        }
                    });
                    reactedInWhatsApp = true;
                }
            } else if (isMeta && externalId) {
                if (!externalId.startsWith('wamid.')) {
                    return res.status(400).json({ success: false, error: 'Este mensaje no tiene un ID de Meta válido (wamid) para reaccionar. Fue enviado localmente o con otro proveedor.' });
                }
                const { phone_number_id, access_token } = provider.config || (provider as any).globalVendorArgs || {};
                if (phone_number_id && access_token) {
                    const cleanNumber = typeof provider.formatNumberForMeta === 'function'
                        ? provider.formatNumberForMeta(chatId)
                        : chatId.replace(/\D/g, '');
                    const apiVersion = process.env.META_API_VERSION || 'v25.0';
                    const url = `https://graph.facebook.com/${apiVersion}/${phone_number_id}/messages`;
                    const body = {
                        messaging_product: "whatsapp",
                        recipient_type: isGroup ? "group" : "individual",
                        to: isGroup ? chatId.split('@')[0] : cleanNumber,
                        type: "reaction",
                        reaction: {
                            message_id: externalId,
                            emoji: reaction || ""
                        }
                    };
                    await axios.post(url, body, {
                        headers: {
                            'Authorization': `Bearer ${access_token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    reactedInWhatsApp = true;
                    console.log(`[BACKOFFICE] Reacción enviada a Meta Cloud API (ID: ${externalId})`);
                }
            }

            // Save reaction in DB
            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                await LocalHistoryStore.updateMessageReaction(messageData.id, reaction || '', currentProjectId);
            } else {
                await supabase.from('messages').update({ reaction: reaction || '' }).eq('id', messageData.id);
            }

            res.json({ success: true, reactedInWhatsApp, message: 'Reacción enviada' });
        } catch (e: any) {
            console.error('❌ Error enviando reacción:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/forward-message', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, mediaUrl, mediaType } = req.body;
        if (!chatId || !mediaUrl) {
            return res.status(400).json({ success: false, error: 'chatId and mediaUrl are required' });
        }

        try {
            const isGroup = chatId.includes('@g.us');
            const providerToSend = (isGroup && groupProvider) ? groupProvider : adapterProvider;
            const currentProjectId = resolveProjectId(req) || HistoryHandlerClass.PROJECT_IDENTIFIER;
            let targetServiceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            if ((!targetServiceId || targetServiceId === 'default' || targetServiceId === 'default_service') && chatId) {
                const chatObj = await depsHistoryHandler.getChat(chatId.split('@')[0], currentProjectId);
                if (chatObj?.service_id) targetServiceId = chatObj.service_id;
            }


            if (!providerToSend) {
                return res.status(503).json({ success: false, error: 'WhatsApp provider not initialized' });
            }

            console.log(`[FORWARD] Reenviando media a ${chatId}. URL: ${mediaUrl}, Tipo: ${mediaType}`);

            const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
            let providerResponse: any = null;

            // Determinar si la URL es local (del backoffice) o externa
            let absolutePath = mediaUrl;
            let isLocal = false;
            let cleanRelativePath = '';

            // Si es un URL completo, extraer la parte del path
            let pathToCheck = mediaUrl;
            if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
                try {
                    const parsed = new URL(mediaUrl);
                    pathToCheck = parsed.pathname;
                } catch (e) {
                    // Ignorar error de parseo y usar original
                }
            }

            if (mediaType !== 'text') {
                if (pathToCheck.startsWith('/uploads/') || pathToCheck.startsWith('uploads/') ||
                    pathToCheck.startsWith('/tmp/') || pathToCheck.startsWith('tmp/') ||
                    pathToCheck.startsWith('/temp/') || pathToCheck.startsWith('temp/')) {
                    isLocal = true;
                    cleanRelativePath = pathToCheck.startsWith('/') ? pathToCheck.substring(1) : pathToCheck;
                    if (cleanRelativePath.startsWith('temp/')) {
                        cleanRelativePath = cleanRelativePath.replace('temp/', 'tmp/');
                    }
                }

                if (isLocal) {
                    absolutePath = path.resolve(process.cwd(), cleanRelativePath);

                    if (!fs.existsSync(absolutePath)) {
                        console.error(`[FORWARD] El archivo local no existe en: ${absolutePath}`);
                        return res.status(404).json({ success: false, error: 'El archivo local a reenviar no existe en el servidor' });
                    }
                }
            }

            // Normalizar tipo de media
            let finalType: 'text' | 'image' | 'video' | 'document' | 'sticker' = 'document';
            if (mediaType === 'text') {
                finalType = 'text';
            } else if (mediaType === 'sticker' || mediaUrl.match(/\.webp$/i)) {
                finalType = 'sticker';
            } else if (mediaType === 'image' || mediaUrl.match(/\.(jpeg|jpg|gif|png|svg)$/i)) {
                finalType = 'image';
            } else if (mediaType === 'video' || mediaUrl.match(/\.(mp4|webm)$/i)) {
                finalType = 'video';
            }

            // Enviar usando el método adecuado del proveedor
            if (finalType === 'text') {
                providerResponse = await providerToSend.sendMessage(jid, mediaUrl, { projectId: currentProjectId, serviceId: targetServiceId });
            } else if (finalType === 'sticker') {
                if (typeof (providerToSend as any).sendSticker === 'function') {
                    providerResponse = await (providerToSend as any).sendSticker(jid, absolutePath, { serviceId: targetServiceId, projectId: currentProjectId });
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, type: 'sticker', projectId: currentProjectId, serviceId: targetServiceId });
                }
            } else if (finalType === 'image') {
                if (typeof providerToSend.sendImage === 'function') {
                    providerResponse = await providerToSend.sendImage(jid, absolutePath, '', { serviceId: targetServiceId, projectId: currentProjectId });
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, projectId: currentProjectId, serviceId: targetServiceId });
                }
            } else if (finalType === 'video') {
                if (typeof providerToSend.sendVideo === 'function') {
                    providerResponse = await providerToSend.sendVideo(jid, absolutePath, '', { serviceId: targetServiceId, projectId: currentProjectId });
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, projectId: currentProjectId, serviceId: targetServiceId });
                }
            } else {
                if (typeof providerToSend.sendFile === 'function') {
                    providerResponse = await providerToSend.sendFile(jid, absolutePath, path.basename(absolutePath), { serviceId: targetServiceId, projectId: currentProjectId });
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, fileName: path.basename(absolutePath), projectId: currentProjectId, serviceId: targetServiceId });
                }
            }

            // Guardar en el historial
            const externalId = providerResponse?.key?.id || providerResponse?.messages?.[0]?.id || providerResponse?.id;

            const { trackSentMessage } = await import('../../providers/provider.manager');
            trackSentMessage(externalId);

            await depsHistoryHandler.saveMessage(chatId, 'assistant', mediaUrl, finalType, undefined, undefined, externalId, 'whatsapp', currentProjectId || undefined, targetServiceId || undefined);
            await depsHistoryHandler.updateLastHumanMessage(chatId, currentProjectId, targetServiceId);
            await depsHistoryHandler.toggleBot(chatId, false, currentProjectId, targetServiceId);

            res.json({ success: true, message: 'Archivo reenviado correctamente' });
        } catch (e: any) {
            console.error('❌ Error crítico en reenviar mensaje:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/baileys/start', bodyParser.json(), async (req: any, res: any) => {
        const { isGroup, usePairingCode, phoneNumber } = req.body;
        const adapterIsMeta = isMetaProvider(adapterProvider);
        const targetIsGroup = Boolean(isGroup) || Boolean(adapterIsMeta && groupProvider);
        const provider = targetIsGroup ? groupProvider : adapterProvider;
        const requestContext = {
            target: targetIsGroup ? 'groups' : 'primary',
            usePairingCode: Boolean(usePairingCode),
            hasPhoneNumber: Boolean(phoneNumber),
            projectId: req.body?.projectId || null,
            serviceId: req.body?.serviceId || null
        };
        console.log('[BACKOFFICE] Baileys start requested', requestContext);

        if (!provider) {
            return res.status(404).json({ success: false, error: 'Proveedor no configurado o no disponible' });
        }

        const { hasActiveSession } = await import('../../providers/provider.manager');
        const statusObj = await hasActiveSession(adapterProvider, groupProvider, req.body?.projectId || null, req.body?.serviceId || null);
        const providerStatus = targetIsGroup ? statusObj.group : statusObj.adapter;
        if (providerStatus?.active) {
            console.log('[BACKOFFICE] Baileys start skipped: provider already connected', requestContext);
            return res.json({ success: true, message: 'El proveedor ya esta conectado' });
        }

        console.log(`[BACKOFFICE] Iniciando vinculación para Baileys (Grupo: ${!!targetIsGroup}, PairingCode: ${!!usePairingCode})...`);

        try {
            if (provider.globalVendorArgs) {
                provider.globalVendorArgs.usePairingCode = !!usePairingCode;
                provider.globalVendorArgs.phoneNumber = phoneNumber || undefined;
            }
            if ('preventAutoStart' in provider) {
                provider.preventAutoStart = false;
            }
            if (typeof provider.initVendor === 'function') {
                await provider.initVendor();
            }

            // Configurar timeout de 5 minutos (300000 ms) para frenar si no se escanea
            setTimeout(async () => {
                try {
                    const currentStatus = await hasActiveSession(adapterProvider, groupProvider, req.body?.projectId || null, req.body?.serviceId || null);
                    const currentProvStatus = targetIsGroup ? currentStatus.group : currentStatus.adapter;

                    if (currentProvStatus && !currentProvStatus.active) {
                        console.log(`[TIMEOUT] Pasaron 5 minutos y no se escaneó el QR. Deteniendo proveedor Baileys (Grupo: ${!!targetIsGroup}) para ahorrar recursos.`);
                        if (typeof provider.stopProvider === 'function') {
                            await provider.stopProvider();
                        }

                        if ((adapterProvider as any).server?.io) {
                            (adapterProvider as any).server.io.emit('baileys_stopped', { isGroup: targetIsGroup });
                        }
                    }
                } catch (e: any) {
                    console.error('Error en timeout de apagado Baileys:', e.message);
                }
            }, 5 * 60 * 1000);

            res.json({ success: true, message: 'Generador de QR iniciado. Expira en 5 minutos si no se escanea.' });
        } catch (err: any) {
            console.error('Error al iniciar Baileys:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/toggle-bot', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, enabled } = req.body;
        if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });

        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const result = await depsHistoryHandler.toggleBot(chatId, enabled, projectId, serviceId, false, req.body?.force === true);
            if (result && !result.success) {
                return res.status(400).json({ success: false, error: result.error || 'No se pudo cambiar el estado del bot' });
            }
            if ((adapterProvider as any).server?.io) {
                (adapterProvider as any).server.io.emit('bot_toggled', { chatId, enabled, projectId, serviceId });
            }
            res.json({ success: true, enabled });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/bot-command', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const command = String(req.body?.command || '').trim().toUpperCase();
        const chatId = String(req.body?.chatId || '').trim();
        const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
        const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

        try {
            if (command === '#ACTUALIZAR#') {
                await updateMain(projectId, serviceId);

                const { syncAssistantTools } = await import("../../apis/openai/openaiHelper");
                const assistantKeys = ['ASSISTANT_ID', 'ASSISTANT_1', 'ASSISTANT_2', 'ASSISTANT_3', 'ASSISTANT_4', 'ASSISTANT_5'];
                const assistantIds = new Set<string>();

                for (const key of assistantKeys) {
                    const assistantId = await depsHistoryHandler.getConfig(key, projectId, serviceId) || process.env[key];
                    if (assistantId && /^asst_[a-zA-Z0-9_-]+$/.test(String(assistantId).trim())) {
                        assistantIds.add(String(assistantId).trim());
                    }
                }

                for (const assistantId of assistantIds) {
                    await syncAssistantTools(assistantId, projectId, serviceId);
                }

                return res.json({ success: true, message: 'Sincronizacion completada.', assistantsSynced: assistantIds.size });
            }

            if (!chatId) {
                return res.status(400).json({ success: false, error: 'chatId is required' });
            }

            if (command === '#RESET#') {
                await depsHistoryHandler.setAssignedAgent(chatId, 'asistente1', projectId, serviceId);
                return res.json({ success: true, message: 'Asistente reiniciado a asistente1.' });
            }

            if (command === '#HILO_NUEVO#') {
                const cleared = await depsHistoryHandler.clearChatHistory(chatId, projectId, serviceId);
                if (!cleared) {
                    return res.status(500).json({ success: false, error: 'No se pudo limpiar el historial.' });
                }
                await depsHistoryHandler.setAssignedAgent(chatId, 'asistente1', projectId, serviceId);
                return res.json({ success: true, message: 'Historial borrado y asistente reiniciado.' });
            }

            return res.status(400).json({ success: false, error: 'Comando no soportado.' });
        } catch (e: any) {
            console.error('[Backoffice Bot Command] Error:', e.message);
            return res.status(500).json({ success: false, error: e.message });
        }
    });

    // --- TAGS ---

    app.get('/api/backoffice/tags', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const tags = await depsHistoryHandler.getTags(projectId, serviceId);
        res.json(tags);
    });

    app.get('/api/backoffice/chat/:id/contact', backofficeAuth, async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const projectId = resolveProjectId(req);
            const contact = await depsHistoryHandler.getChat(id, projectId || undefined);
            if (!contact) {
                return res.status(404).json({ success: false, error: 'Contact not found' });
            }
            res.json(contact);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.put('/api/backoffice/chat/:id/contact', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const { name, email, notes, source, cuit_dni, tax_status, address, offered_product, crm_status, crm_due_date, ticket_title } = req.body;
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const result = await depsHistoryHandler.updateContactDetails(id, {
                name, email, notes, source,
                cuit_dni, tax_status, address, offered_product,
                crm_status, crm_due_date,
                is_lead: true,
                ticket_title
            }, projectId || undefined, serviceId || undefined);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/chat/manual-lead', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { chatId, details } = req.body;
            if (!chatId) return res.status(400).json({ success: false, error: 'chatId (phone) is required' });
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const result = await depsHistoryHandler.createNewLeadManual(chatId, details, projectId, serviceId);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/tags', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { name, color } = req.body;
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const result = await depsHistoryHandler.createTag(name, color, projectId, serviceId);
        res.json(result);
    });

    app.put('/api/backoffice/tags/:id', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { name, color } = req.body;
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const result = await depsHistoryHandler.updateTag(req.params.id, name, color, projectId, serviceId);
        res.json(result);
    });

    app.delete('/api/backoffice/tags/:id', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const result = await depsHistoryHandler.deleteTag(req.params.id, projectId, serviceId);
        res.json(result);
    });

    app.post('/api/backoffice/chats/:chatId/tags', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { tagId } = req.body;
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const result = await depsHistoryHandler.addTagToChat(req.params.chatId, tagId, projectId, serviceId);
        res.json(result);
    });

    app.delete('/api/backoffice/chats/:chatId/tags/:tagId', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const result = await depsHistoryHandler.removeTagFromChat(req.params.chatId, req.params.tagId, projectId, serviceId);
        res.json(result);
    });

    // --- TICKETS ---

    app.get('/api/backoffice/tickets/pending-count', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        const tipo = req.query.tipo as string;
        const count = await depsHistoryHandler.getPendingTicketsCount(projectId, tipo);
        res.json({ count });
    });

    app.get('/api/backoffice/tickets', backofficeAuth, async (req: any, res: any) => {
        const estado = req.query.estado as string;
        const tipo = req.query.tipo as string;
        const id = req.query.id as string;
        const limit = parseInt(req.query.limit as string) || 300;
        const offset = parseInt(req.query.offset as string) || 0;
        const chatId = req.query.chatId as string;
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const visibleServices = await getVisibleServiceIds(projectId, serviceId);
        const result = await depsHistoryHandler.listTickets(limit, offset, estado, tipo, chatId, id, projectId, visibleServices.join(','));
        res.json(result);
    });

    app.post('/api/backoffice/tickets', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, titulo, descripcion, chats_adjuntos, attachments, tipo } = req.body;
        if (!titulo) return sendJson(res, 400, { success: false, error: 'titulo is required' });
        const adjuntos = Array.isArray(chats_adjuntos) ? chats_adjuntos : [];
        const atts = Array.isArray(attachments) ? attachments : [];
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const result = await depsHistoryHandler.createTicket(chatId, titulo, descripcion, tipo || 'Soporte', 'Media', projectId || undefined, atts, adjuntos, serviceId);
        res.json(result);
    });

    app.put('/api/backoffice/crm/ticket/:id', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const result = await depsHistoryHandler.updateLeadAndTicket(id, req.body);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.put('/api/backoffice/tickets/:id', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const result = await depsHistoryHandler.updateTicket(id, req.body);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.delete('/api/backoffice/tickets/:id', backofficeAuth, async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const projectId = resolveProjectId(req);
            const result = await depsHistoryHandler.deleteTicket(id, projectId || undefined);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/crm/bulk-delete-leads', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { ticketIds } = req.body;
            const projectId = resolveProjectId(req);

            if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
                return sendJson(res, 400, { success: false, error: 'ticketIds array is required' });
            }

            let deletedCount = 0;
            for (const ticketId of ticketIds) {
                const resDel = await depsHistoryHandler.deleteTicket(ticketId, projectId || undefined);
                if (resDel && resDel.success) {
                    deletedCount++;
                }
            }

            res.json({ success: true, deletedCount });
        } catch (err: any) {
            console.error('[Bulk Delete Leads Error]:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // --- CRM CONFIG & DASHBOARD ---

    app.get('/api/backoffice/crm/config', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const configStr = await depsHistoryHandler.getSetting('CRM_CONFIG', projectId);
            const config = configStr ? JSON.parse(configStr) : null;
            res.json({ success: true, config });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/crm/config', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { config } = req.body;
            const projectId = resolveProjectId(req);
            await depsHistoryHandler.saveSetting('CRM_CONFIG', JSON.stringify(config), projectId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/backoffice/crm/tasks', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const visibleServices = await getVisibleServiceIds(projectId, serviceId);
            const tasks = await depsHistoryHandler.getTasksDashboard(projectId, visibleServices.join(','));
            res.json(tasks);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/backoffice/leads', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        const visibleServices = await getVisibleServiceIds(projectId, serviceId);
        const result = await depsHistoryHandler.listEditedLeads(limit, offset, projectId, visibleServices.join(','));
        res.json(result);
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/config', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req) || process.env.RAILWAY_PROJECT_ID || "default";
        const serviceId = resolveServiceId(req);

        // Intentar obtener config de la DB para este proyecto
        const config = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);

        // Merge: DB tiene prioridad, pero "PENDING" se considera ausente
        const dbConfig: Record<string, any> = config || {};
        const mergedConfig: Record<string, any> = { ...dbConfig };
        const isAbsent = (v: any) => !v || v === 'PENDING';
        if (isAbsent(mergedConfig.waba_id)        && process.env.META_WABA_ID)      mergedConfig.waba_id        = process.env.META_WABA_ID;
        if (isAbsent(mergedConfig.phone_number_id) && process.env.META_PHONE_ID)     mergedConfig.phone_number_id = process.env.META_PHONE_ID;
        if (isAbsent(mergedConfig.access_token)   && process.env.META_ACCESS_TOKEN) mergedConfig.access_token   = process.env.META_ACCESS_TOKEN;

        const dbAppId = await depsHistoryHandler.getConfig('META_APP_ID', projectId, serviceId);
        const dbAppSecret = await depsHistoryHandler.getConfig('META_APP_SECRET', projectId, serviceId);
        const dbConfigId = await depsHistoryHandler.getConfig('META_CONFIG_ID', projectId, serviceId);

        res.json({
            success: true,
            appId: dbAppId || process.env.META_APP_ID,
            appSecret: dbAppSecret || process.env.META_APP_SECRET,
            configId: dbConfigId || process.env.META_CONFIG_ID,
            railwayProjectId: projectId,
            serviceId: serviceId,
            config: mergedConfig
        });
    });

    app.get('/api/backoffice/whatsapp/lines', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || process.env.RAILWAY_PROJECT_ID || "default";
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const lines: any[] = [];
            const cleanNumber = (value: any) => String(value || '').replace(/[^\d]/g, '');
            const isPresent = (value: any) => !!value && value !== 'PENDING';

            const metaConfig = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
            const metaData = metaConfig?.onboarding_data || {};
            const metaNumber = metaData.display_phone_number || metaData.phone?.display_phone_number || metaData.phoneNumber || metaData.phone_number || metaConfig?.display_phone_number || null;
            const metaPhoneId = metaConfig?.phone_number_id || metaConfig?.whatsappNumberId || null;
            const metaWabaId = metaConfig?.waba_id || metaConfig?.whatsappBusinessId || null;

            if (isPresent(metaPhoneId) || isPresent(metaNumber)) {
                const cleanMetaNumber = cleanNumber(metaNumber);
                lines.push({
                    id: metaPhoneId || cleanMetaNumber || 'meta-line',
                    provider: 'Meta',
                    number: cleanMetaNumber || metaNumber || metaPhoneId,
                    displayNumber: cleanMetaNumber || metaNumber || `Meta ${metaPhoneId}`,
                    phoneNumberId: metaPhoneId,
                    wabaId: metaWabaId,
                    linked: true
                });
            }

            const currentProvider = getAdapterProvider();
            const baileysJid = currentProvider?.vendor?.authState?.creds?.me?.id || currentProvider?.vendor?.user?.id || '';
            const baileysNumber = cleanNumber(String(baileysJid).split(':')[0].split('@')[0]);
            if (!lines.length && baileysNumber) {
                lines.push({
                    id: baileysNumber,
                    provider: 'Baileys',
                    number: baileysNumber,
                    displayNumber: baileysNumber,
                    linked: true
                });
            }

            res.json({ success: true, projectId, serviceId, lines, activeLine: lines[0] || null });
        } catch (error: any) {
            console.error('[WHATSAPP-LINES] Error obteniendo linea vinculada:', error);
            res.status(500).json({ success: false, error: error.message, lines: [], activeLine: null });
        }
    });

    app.post('/api/backoffice/whatsapp/sync-manual', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { token: manualToken, wabaId, phoneNumberId, projectId: bodyProjectId } = req.body;
        if (!manualToken) return res.status(400).json({ success: false, error: 'Token is required' });

        try {
            const projectId = bodyProjectId || resolveProjectId(req) || process.env.RAILWAY_PROJECT_ID;
            const serviceId = resolveServiceId(req);
            let finalWabaId = wabaId;
            let finalPhoneId = phoneNumberId;
            let extra: any = { syncedBy: 'manual-sync-tool' };

            if (!finalWabaId || !finalPhoneId) {
                const { discoverMetaIds } = await import("../../apis/meta/metaDiscovery");
                console.log(`¡ [META-SYNC-MANUAL] Iniciando descubrimiento manual por falta de IDs...`);
                const appId = await depsHistoryHandler.getConfig('META_APP_ID', projectId, serviceId) || process.env.META_APP_ID || '1493670789148486';
                const appSecret = await depsHistoryHandler.getConfig('META_APP_SECRET', projectId, serviceId) || process.env.META_APP_SECRET || '362b2ec20c00bdf51336fd165ad47160';
                const discovery = await discoverMetaIds(manualToken, null, appId, appSecret);
                if (!discovery.found || !discovery.data?.phoneNumberId) {
                    return res.status(404).json({ success: false, error: 'No se pudieron encontrar los datos automáticamente. Por favor ingresa los IDs manualmente.' });
                }
                finalWabaId = discovery.data.wabaId;
                finalPhoneId = discovery.data.phoneNumberId;
                extra = { ...discovery.data, ...extra };
            }

            const result = await depsHistoryHandler.saveMetaOnboardingData(
                finalWabaId,
                finalPhoneId,
                manualToken,
                extra,
                projectId,
                serviceId
            );

            res.json(result);
        } catch (error: any) {
            console.error('Error in Meta Manual Sync:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- TEMPLATES & BULK MESSAGING ---

    /** Asegura que el proveedor tenga la config más reciente de la DB */
    const syncMetaProvider = async (projectId: string | null = null, serviceId: string | null = null) => {
        const config = await depsHistoryHandler.getMetaOnboardingData(projectId || process.env.RAILWAY_PROJECT_ID, false, serviceId);
        if (config && adapterProvider && adapterProvider.updateConfig) {
            // El objeto config puede venir de la DB (whatsappToken) o de una sincronización previa (access_token)
            const token = config.whatsappToken || config.access_token;
            const phoneId = config.whatsappNumberId || config.phone_number_id;
            const wabaId = config.whatsappBusinessId || config.waba_id;

            if (token && token !== 'PENDING') {
                console.log("🔄 [MetaSync] Sincronizando credenciales de Meta...");
                adapterProvider.updateConfig({
                    jwtToken: token,
                    numberId: phoneId,
                    verifyToken: process.env.META_VERIFY_TOKEN,
                    businessId: wabaId,
                    // Compatibilidad con versiones antiguas del provider:
                    access_token: token,
                    phone_number_id: phoneId,
                    waba_id: wabaId
                });
            }
        }
    };

    app.get('/api/backoffice/whatsapp/templates', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            
            let wabaId = null;
            let token = null;

            const activeAdapter = getAdapterProvider();
            const activeGroup = getGroupProvider();
            const provider = isMetaProvider(activeAdapter) ? activeAdapter : activeGroup;
            if (isMetaProvider(provider)) {
                wabaId = provider.config.waba_id;
                token = provider.config.access_token;
            } else {
                const config = await depsHistoryHandler.getMetaOnboardingData(projectId || process.env.RAILWAY_PROJECT_ID, false, serviceId);
                if (config) {
                    wabaId = config.whatsappBusinessId || config.waba_id;
                    token = config.whatsappToken || config.access_token;
                }
            }

            if (!wabaId || !token || wabaId === 'PENDING' || token === 'PENDING') {
                return res.status(400).json({ success: false, error: 'El proveedor Meta no está configurado para este servicio.' });
            }

            const axios = (await import('axios')).default;
            const url = `https://graph.facebook.com/v25.0/${wabaId}/message_templates?fields=id,name,status,components,language,category,parameter_format&limit=1000`;
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const templates = response.data?.data || [];
            res.json({ success: true, templates });
        } catch (error: any) {
            console.error('❌ [BackofficeRoutes] Error obteniendo plantillas:', error?.response?.data || error.message);
            res.status(500).json({ success: false, error: error?.response?.data?.error?.message || error.message });
        }
    });

    app.get('/api/backoffice/whatsapp/library-templates', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            
            let token = null;

            const activeAdapter = getAdapterProvider();
            const activeGroup = getGroupProvider();
            const provider = isMetaProvider(activeAdapter) ? activeAdapter : activeGroup;
            if (isMetaProvider(provider)) {
                token = provider.config.access_token;
            } else {
                const config = await depsHistoryHandler.getMetaOnboardingData(projectId || process.env.RAILWAY_PROJECT_ID, false, serviceId);
                if (config) {
                    token = config.whatsappToken || config.access_token;
                }
            }

            if (!token || token === 'PENDING') {
                return res.status(400).json({ success: false, error: 'El proveedor Meta no está configurado para este servicio.' });
            }

            const axios = (await import('axios')).default;
            let allTemplates: any[] = [];
            
            // 1. Intentar obtener de la Biblioteca Oficial de Meta (Paginado)
            try {
                let nextUrl: string | null = `https://graph.facebook.com/v25.0/message_template_library?fields=id,name,components,language,category,status&limit=100`;
                while (nextUrl && allTemplates.length < 1000) {
                    const response = await axios.get(nextUrl, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const data = response.data?.data || [];
                    allTemplates = [...allTemplates, ...data];
                    nextUrl = response.data?.paging?.next || null;
                }
            } catch (err: any) {
                console.warn('⚠️ Error en Biblioteca Global, intentando Master WABA:', err?.response?.data || err.message);
            }

            // 2. Fallback: Biblioteca Maestra
            if (allTemplates.length === 0) {
                try {
                    const MASTER_WABA_ID = '146603058535041';
                    const urlMaster = `https://graph.facebook.com/v25.0/${MASTER_WABA_ID}/message_templates?fields=id,name,components,language,category,status&limit=100`;
                    const responseMaster = await axios.get(urlMaster, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    allTemplates = responseMaster.data?.data || [];
                    allTemplates = allTemplates.map((t: any) => ({ ...t, isShared: true }));
                } catch (masterErr: any) {
                    console.error('⚠️ Error consultando Biblioteca Maestra:', masterErr?.response?.data || masterErr.message);
                }
            }

            res.json({ success: true, templates: allTemplates });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/templates', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            await syncMetaProvider(resolveProjectId(req), resolveServiceId(req));
            const { name, category, language, text, examples } = req.body;
            if (!name || !category || !language || !text) {
                return res.status(400).json({ success: false, error: 'Faltan campos obligatorios para crear la plantilla.' });
            }

            const activeAdapter = getAdapterProvider();
            const activeGroup = getGroupProvider();
            const provider = isMetaProvider(activeAdapter) ? activeAdapter : activeGroup;
            if (!provider || typeof provider.createTemplate !== 'function') {
                return res.status(400).json({ success: false, error: 'Proveedor Meta no configurado o no soporta creación.' });
            }

            const result = await provider.createTemplate(name, category, language, text, examples || []);
            res.json({ success: true, result });
        } catch (error: any) {
            const metaError = error.response?.data?.error;
            let errorMessage = error.message;

            if (metaError) {
                // Priorizar el mensaje amigable de Meta si existe
                const title = metaError.error_user_title;
                const detail = metaError.error_user_msg || metaError.message;
                errorMessage = title ? `${title}: ${detail}` : detail;
            }

            console.error('Error creando plantilla Meta:', metaError || error.message);
            res.status(error.response?.status || 500).json({
                success: false,
                error: errorMessage
            });
        }
    });

    /** Paso 1: Añadir número a Meta y solicitar OTP */
    app.post('/api/backoffice/whatsapp/register-step-1', bodyParser.json(), async (req: any, res: any) => {
        const { phoneNumber, verifiedName, projectId, manualWabaId, manualToken } = req.body;
        try {
            const serviceId = resolveServiceId(req);
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId, true, serviceId); // Fallback al main_token habilitado

            // Si el usuario provee un token manual (Super User), lo priorizamos
            const token = manualToken || config?.access_token;
            if (!token) throw new Error('No se encontró sesión de Meta ni Token manual provisto.');

            const wabaId = manualWabaId || config?.waba_id;
            if (!wabaId) throw new Error('No se encontró WABA ID. Búscalo en tu Panel de Meta o ingrésalo manualmente.');

            const { addPhoneNumberToWaba, requestPhoneNumberOtp } = await import("../../apis/meta/metaDiscovery");

            // 1. Añadir el número (esto nos da el Phone ID)
            const result = await addPhoneNumberToWaba(token, wabaId, phoneNumber, verifiedName);
            const phoneId = result.id;

            // 2. Solicitar OTP
            await requestPhoneNumberOtp(token, phoneId, 'SMS');

            // 3. Guardar las credenciales manuales para que persistan
            if (manualWabaId || manualToken) {
                await depsHistoryHandler.saveMetaOnboardingData(
                    wabaId, 
                    phoneId, 
                    token, 
                    { activatedVia: 'manual-advanced-form' }, 
                    projectId,
                    serviceId
                );
            }

            res.json({ success: true, phoneId });
        } catch (error: any) {
            const metaError = error.response?.data?.error;
            let errorMessage = error.message;

            if (metaError) {
                const title = metaError.error_user_title;
                const detail = metaError.error_user_msg || metaError.message;
                errorMessage = title ? `${title}: ${detail}` : detail;
            }

            console.error('❌ [Register-Step-1] Error:', metaError || error.message);
            res.status(error.response?.status || 400).json({
                success: false,
                error: errorMessage
            });
        }
    });

    /** Paso 2: Verificar OTP y activar el bot */
    app.post('/api/backoffice/whatsapp/register-step-2', bodyParser.json(), async (req: any, res: any) => {
        const { phoneId, code, projectId } = req.body;
        try {
            const serviceId = resolveServiceId(req);
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
            const token = config.access_token;

            const { verifyPhoneNumberOtp } = await import("../../apis/meta/metaDiscovery");

            // 1. Verificar y Registrar en Meta
            await verifyPhoneNumberOtp(token, phoneId, code);

            // 2. Guardar definitivamente en nuestra DB
            await depsHistoryHandler.saveMetaOnboardingData(config.waba_id, phoneId, token, { activatedVia: 'auto-registration' }, projectId, serviceId);

            res.json({ success: true });
        } catch (error: any) {
            const metaError = error.response?.data?.error;
            let errorMessage = error.message;

            if (metaError) {
                const title = metaError.error_user_title;
                const detail = metaError.error_user_msg || metaError.message;
                errorMessage = title ? `${title}: ${detail}` : detail;
            }

            console.error('❌ [Register-Step-2] Error:', metaError || error.message);
            res.status(error.response?.status || 400).json({
                success: false,
                error: errorMessage
            });
        }
    });

    app.get('/api/backoffice/whatsapp/template-excel/:templateName', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            await syncMetaProvider(projectId, serviceId);
            const { templateName } = req.params;
            const activeAdapter = getAdapterProvider();
            const activeGroup = getGroupProvider();
            const provider = (activeAdapter && typeof activeAdapter.getTemplates === 'function') ? activeAdapter : activeGroup;
            if (!provider || typeof provider.getTemplates !== 'function') {
                return res.status(400).json({ success: false, error: 'Proveedor Meta no disponible' });
            }

            const templates = await provider.getTemplates();
            const template = templates.find((t: any) => t.name === templateName);

            if (!template) {
                return res.status(404).json({ success: false, error: 'Plantilla no encontrada.' });
            }

            // 1. Detectar variables en BODY
            const bodyComponent = template.components.find((c: any) => c.type === 'BODY');
            const text = bodyComponent?.text || '';
            const varNames: string[] = [];

            // Detección robusta: si tiene parameter_format='named' (case-insensitive)
            const isNamed = (template.parameter_format || '').toLowerCase() === 'named';
            const bodyNamedParams = bodyComponent?.example?.body_text_named_params || [];

            if (isNamed && bodyNamedParams.length > 0) {
                bodyNamedParams.forEach((p: any) => varNames.push(p.param_name));
            }

            // Fallback: Si no es named o si varNames quedó vacío, escaneamos el texto del cuerpo.
            // Esto sirve para Positional ({{1}}) o si es Named ({{nombre}}) pero no tenía ejemplos oficiales.
            if (varNames.length === 0 && text) {
                const varRegex = /\{\{([^}]+)\}\}/g;
                let match;
                while ((match = varRegex.exec(text)) !== null) {
                    const varName = match[1].trim();
                    if (!varNames.includes(varName)) {
                        varNames.push(varName);
                    }
                }
            }

            // 2. Detectar HEADER Multimedia y sus ejemplos
            const headerComp = template.components.find((c: any) => c.type === 'HEADER');
            const hasMediaHeader = headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format);
            const headerExampleUrl = headerComp?.example?.header_handle?.[0] || '';

            // 3. Detectar BUTTONS dinámicos
            const buttonsComp = template.components.find((c: any) => c.type === 'BUTTONS');
            const dynamicButtonIndices: number[] = [];
            if (buttonsComp && buttonsComp.buttons) {
                buttonsComp.buttons.forEach((btn: any, idx: number) => {
                    if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
                        dynamicButtonIndices.push(idx);
                    }
                });
            }

            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();

            // Cabeceras
            const headers = ['phone', ...varNames];
            if (hasMediaHeader) headers.push('header_media_url');
            dynamicButtonIndices.forEach(idx => headers.push(`button_${idx + 1}_url_suffix`));

            const rows = [headers];

            // --- FILA DE EJEMPLO (Basada en Meta) ---
            const exampleRow = ['5491100000000'];

            // Llenar variables del cuerpo con ejemplos de Meta
            varNames.forEach(vName => {
                const exMatch = bodyNamedParams.find((p: any) => p.param_name === vName);
                exampleRow.push(exMatch?.example || `ejemplo_${vName}`);
            });

            // Llenar header con el link de ejemplo de Meta si existe
            if (hasMediaHeader) {
                exampleRow.push(headerExampleUrl || 'https://tu-imagen.com/foto.jpg');
            }

            // Llenar sufijos de botones
            dynamicButtonIndices.forEach(() => exampleRow.push('promocion-2024'));

            rows.push(exampleRow);

            // --- CONTACTOS REALES ---
            const { startDate, endDate, tagIds } = req.query;
            const tagIdArray = tagIds ? String(tagIds).split(',').filter(Boolean) : [];

            let chats: any[] = [];
            if (tagIdArray.length === 1) {
                chats = await depsHistoryHandler.listChats(10000, 0, undefined, tagIdArray[0], undefined, undefined, projectId, serviceId);
            } else if (tagIdArray.length > 1) {
                const supabase = depsHistoryHandler.getSupabase();
                let tagQuery = supabase
                    .from('chat_tags')
                    .select('chat_id')
                    .eq('project_id', projectId)
                    .in('tag_id', tagIdArray);
                if (serviceId && serviceId !== 'default_service') {
                    tagQuery = tagQuery.or(`service_id.eq.${serviceId},service_id.eq.default_service,service_id.is.null`);
                }
                const { data: taggedEntries } = await tagQuery;

                const matchingIds = Array.from(new Set((taggedEntries || []).map((te: any) => te.chat_id)));
                if (matchingIds.length > 0) {
                    let chatsQuery = supabase
                        .from('chats')
                        .select('id, type, name, last_message_at, last_human_message_at, assigned_to, bot_enabled, crm_status, crm_due_date, notes, email, source, is_lead, cuit_dni, tax_status, address, offered_product, unread_count, chat_tags(tag_id, tags(*))')
                        .eq('project_id', projectId)
                        .in('id', matchingIds);
                    if (serviceId && serviceId !== 'default_service') {
                        chatsQuery = chatsQuery.or(`service_id.eq.${serviceId},service_id.eq.default_service,service_id.is.null`);
                    }
                    const { data: rawChats } = await chatsQuery;

                    chats = (rawChats || []).map((chat: any) => ({
                        ...chat,
                        tags: chat.chat_tags ? chat.chat_tags.map((ct: any) => ct.tags).filter((t: any) => t !== null) : []
                    }));
                }
            } else {
                chats = await depsHistoryHandler.listChats(10000, 0, undefined, undefined, undefined, undefined, projectId, serviceId);
            }

            if (chats && chats.length > 0) {
                // Filtrar por fecha si fue provisto
                if (startDate || endDate) {
                    chats = chats.filter((c: any) => {
                        if (!c.last_message_at) return false;
                        const msgDate = new Date(c.last_message_at);
                        if (startDate && msgDate < new Date(`${startDate}T00:00:00.000Z`)) return false;
                        if (endDate && msgDate > new Date(`${endDate}T23:59:59.999Z`)) return false;
                        return true;
                    });
                }

                const autoCompletable = [
                    'name', 'last_message_at', 'last_human_message_at', 'notes', 'email',
                    'crm_status', 'crm_due_date', 'cuit_dni', 'tax_status', 'address', 'offered_product'
                ];

                chats.forEach((chat: any) => {
                    const cleanPhone = chat.id.split('@')[0];
                    if (cleanPhone === '5491100000000') return; // Evitar duplicar el ejemplo si existiera
                    const row = [cleanPhone];

                    // Llenar variables si coinciden con los nombres de campos del chat
                    for (let i = 1; i < headers.length; i++) {
                        const h = headers[i];
                        const lowerH = h.toLowerCase();

                        if (lowerH === 'nombre' || lowerH === 'name' || lowerH === 'nombre_cliente' || lowerH === 'nombrecliente') {
                            row.push(chat.name || '');
                        } else if (autoCompletable.includes(h)) {
                            row.push(chat[h] || '');
                        } else {
                            row.push('');
                        }
                    }
                    rows.push(row);
                });
            }

            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, 'EnvioMasivo');

            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Disposition', `attachment; filename="plantilla_${templateName}.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.end(buf);
        } catch (error: any) {
            console.error('Error generando Excel:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });


    app.post('/api/backoffice/whatsapp/send-bulk-template', async (req: any, res: any) => {
        await syncMetaProvider(resolveProjectId(req), resolveServiceId(req));
        return processBulkTemplate(req, res);
    });

    app.post('/api/backoffice/whatsapp/send-single-template', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        await syncMetaProvider(projectId, serviceId);
        const { chatId, phone, templateName, languageCode, components, renderedText, mediaHeader } = req.body;

        try {
            if (!templateName || (!chatId && !phone)) {
                return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos (templateName, chatId o phone).' });
            }

            const rawTarget = phone || chatId || '';
            const targetPhone = String(rawTarget).split('@')[0].replace(/\D/g, '');
            if (!targetPhone) {
                return res.status(400).json({ success: false, error: 'Número de teléfono de destino no válido.' });
            }
            const targetJid = String(rawTarget).includes('@') ? rawTarget : `${targetPhone}@s.whatsapp.net`;

            const activeAdapter = getAdapterProvider();
            const activeGroup = getGroupProvider();
            const provider = (activeAdapter && typeof activeAdapter.sendTemplate === 'function') ? activeAdapter : activeGroup;
            if (!provider || typeof provider.sendTemplate !== 'function') {
                return res.status(400).json({ success: false, error: 'El proveedor WhatsApp configurado no soporta plantillas de Meta.' });
            }

            const templates = await provider.getTemplates();
            const template = templates?.find((t: any) => t.name === templateName);
            if (!template) {
                return res.status(404).json({ success: false, error: `La plantilla '${templateName}' no existe o no fue encontrada.` });
            }

            const lang = languageCode || template.language || 'es';
            console.log(`¡ [SINGLE-TEMPLATE] Enviando plantilla '${templateName}' (${lang}) a ${targetPhone}...`);

            // Procesar componentes (en especial cabeceras multimedia) para subir directamente a Meta
            const finalComponents: any[] = JSON.parse(JSON.stringify(components || []));

            for (const comp of finalComponents) {
                if (comp.type === 'HEADER' && Array.isArray(comp.parameters)) {
                    for (const param of comp.parameters) {
                        const formatType = param.type; // 'image' | 'video' | 'document'
                        if (formatType && param[formatType]) {
                            const mediaObj = param[formatType];
                            const rawLink = mediaObj.link || mediaObj.url;

                            if (rawLink && typeof rawLink === 'string') {
                                try {
                                    console.log(`📥 [SINGLE-TEMPLATE] Procesando multimedia de cabecera: ${rawLink.substring(0, 60)}...`);
                                    const isMetaUrl = rawLink.includes('fbcdn') || rawLink.includes('fbsbx') || rawLink.includes('facebook.com') || rawLink.includes('lookaside.fbsbx.com') || rawLink.includes('whatsapp.net') || rawLink.includes('whatsapp.com');
                                    const isDrive = rawLink.includes('drive.google.com');

                                    let downloadUrl = rawLink;
                                    if (isDrive) {
                                        const driveIdMatch = rawLink.match(/\/d\/([^/]+)/) || rawLink.match(/id=([^&]+)/);
                                        if (driveIdMatch && driveIdMatch[1]) {
                                            downloadUrl = `https://drive.google.com/uc?export=download&id=${driveIdMatch[1]}`;
                                        }
                                    }

                                    const accessToken = provider.config?.access_token || '';
                                    const downloadHeaders: any = {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0 Safari/120.0.0.0',
                                        'Accept': '*/*'
                                    };
                                    if (isMetaUrl && accessToken) {
                                        downloadHeaders['Authorization'] = `Bearer ${accessToken}`;
                                    }

                                    const response = await axios.get(downloadUrl, {
                                        responseType: 'arraybuffer',
                                        timeout: 30000,
                                        headers: downloadHeaders
                                    });

                                    const contentType = String(response.headers['content-type'] || '');
                                    let ext = 'bin';
                                    try {
                                        const mimeModule = await import('mime-types');
                                        const mime = mimeModule.default || mimeModule;
                                        ext = mime.extension(contentType) || 'bin';
                                        if (ext === 'bin') {
                                            ext = formatType === 'image' ? 'jpg' : formatType === 'video' ? 'mp4' : 'pdf';
                                        }
                                    } catch {
                                        if (contentType.includes('video')) ext = 'mp4';
                                        else if (contentType.includes('image')) ext = 'jpg';
                                        else if (contentType.includes('pdf')) ext = 'pdf';
                                        else {
                                            ext = formatType === 'image' ? 'jpg' : formatType === 'video' ? 'mp4' : 'pdf';
                                        }
                                    }

                                    const uploadsDir = path.join(process.cwd(), 'uploads');
                                    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

                                    const filename = `single-template-${Date.now()}-${Math.floor(Math.random()*1000)}.${ext}`;
                                    const downloadedPath = path.join(uploadsDir, filename);
                                    fs.writeFileSync(downloadedPath, response.data);

                                    // 1. Intentar subir directamente a Meta Cloud API para obtener media_id
                                    let uploadedMediaId: string | null = null;
                                    if (typeof (provider as any).uploadMedia === 'function') {
                                        uploadedMediaId = await (provider as any).uploadMedia(downloadedPath);
                                    }

                                    if (uploadedMediaId) {
                                        delete param[formatType].link;
                                        param[formatType].id = uploadedMediaId;
                                        console.log(`✅ [SINGLE-TEMPLATE] Multimedia de cabecera subido exitosamente a Meta. Media ID: ${uploadedMediaId}`);
                                    } else {
                                        // 2. Fallback: Servir desde nuestro propio dominio público
                                        let baseUrl = process.env.PROJECT_URL;
                                        if (!baseUrl) {
                                            const host = req.headers.host || '';
                                            if (!host.includes('localhost')) {
                                                baseUrl = `https://${host}`;
                                            } else {
                                                baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://${host}`;
                                            }
                                        }
                                        if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
                                        param[formatType].link = `${baseUrl.replace(/\/$/, '')}/uploads/${filename}`;
                                        console.log(`✅ [SINGLE-TEMPLATE] Multimedia servido localmente en: ${param[formatType].link}`);
                                    }
                                } catch (downloadErr: any) {
                                    console.error(`❌ [SINGLE-TEMPLATE] Error procesando multimedia de cabecera:`, downloadErr.message);
                                    // Fallback: Si el link falló y la plantilla original de Meta define header_handle
                                    const headerCompDef = template.components?.find((c: any) => c.type === 'HEADER');
                                    const rawHandle = headerCompDef?.example?.header_handle?.[0];
                                    if (rawHandle) {
                                        delete param[formatType].link;
                                        if (rawHandle.startsWith('http://') || rawHandle.startsWith('https://')) {
                                            param[formatType].link = rawHandle;
                                        } else {
                                            param[formatType].handle = rawHandle;
                                        }
                                        console.log(`⚠️ [SINGLE-TEMPLATE] Usando handle/link de ejemplo original de la plantilla: ${rawHandle}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            const resApi = await provider.sendTemplate(targetPhone, templateName, lang, finalComponents, { projectId, serviceId });

            if (resApi?.messages?.[0]?.id) {
                const msgId = resApi.messages[0].id;

                try {
                    const { trackSentMessage } = await import('../../providers/provider.manager');
                    trackSentMessage(msgId);
                } catch (_) { /* ignore */ }

                if (mediaHeader && mediaHeader.url) {
                    const mediaType = mediaHeader.type || 'document';
                    await depsHistoryHandler.saveMessage(targetJid, 'assistant', mediaHeader.url, mediaType, undefined, undefined, `${msgId}_media`, 'whatsapp', projectId || undefined, serviceId || undefined);
                }

                const textToSave = renderedText || `[Plantilla Meta: ${templateName}]`;
                await depsHistoryHandler.saveMessage(targetJid, 'assistant', textToSave, 'text', undefined, undefined, msgId, 'whatsapp', projectId || undefined, serviceId || undefined);
                await depsHistoryHandler.updateLastHumanMessage(targetJid, projectId, serviceId);
                await depsHistoryHandler.toggleBot(targetJid, false, projectId, serviceId);

                return res.json({ success: true, messageId: msgId });
            } else {
                console.error('❌ [SINGLE-TEMPLATE] Meta no devolvió un ID de mensaje:', resApi);
                return res.status(400).json({ success: false, error: 'Meta no devolvió un ID de mensaje válido.', details: resApi });
            }
        } catch (error: any) {
            const errDetail = error?.response?.data || error?.message || error;
            console.error('❌ [SINGLE-TEMPLATE] Error enviando plantilla:', JSON.stringify(errDetail, null, 2));
            return res.status(500).json({ success: false, error: error?.response?.data?.error?.message || error.message || 'Error al enviar la plantilla' });
        }
    });

    app.post('/api/backoffice/whatsapp/send-quick-template', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const projectId = resolveProjectId(req);
        const serviceId = resolveServiceId(req);
        await syncMetaProvider(projectId, serviceId);
        const { templateName, languageCode, startDate, endDate, tagIds } = req.body;

        try {
            if (!templateName) {
                return res.status(400).json({ success: false, error: 'Falta el nombre de la plantilla.' });
            }

            // 1. Obtener contactos reales filtrados
            const tagIdArray = Array.isArray(tagIds) ? tagIds : (typeof tagIds === 'string' ? tagIds.split(',').filter(Boolean) : []);
            let chatsList: any[] = [];

            if (tagIdArray.length === 1) {
                chatsList = await depsHistoryHandler.listChats(10000, 0, undefined, tagIdArray[0], undefined, undefined, projectId, serviceId);
            } else if (tagIdArray.length > 1) {
                const supabase = depsHistoryHandler.getSupabase();
                let tagQuery = supabase
                    .from('chat_tags')
                    .select('chat_id')
                    .eq('project_id', projectId)
                    .in('tag_id', tagIdArray);
                if (serviceId && serviceId !== 'default_service') {
                    tagQuery = tagQuery.or(`service_id.eq.${serviceId},service_id.eq.default_service,service_id.is.null`);
                }
                const { data: taggedEntries } = await tagQuery;

                const matchingIds = Array.from(new Set((taggedEntries || []).map((te: any) => te.chat_id)));
                if (matchingIds.length > 0) {
                    let chatsQuery = supabase
                        .from('chats')
                        .select('id, type, name, last_message_at, last_human_message_at, assigned_to, bot_enabled, crm_status, crm_due_date, notes, email, source, is_lead, cuit_dni, tax_status, address, offered_product, unread_count, chat_tags(tag_id, tags(*))')
                        .eq('project_id', projectId)
                        .in('id', matchingIds);
                    if (serviceId && serviceId !== 'default_service') {
                        chatsQuery = chatsQuery.or(`service_id.eq.${serviceId},service_id.eq.default_service,service_id.is.null`);
                    }
                    const { data: rawChats } = await chatsQuery;

                    chatsList = (rawChats || []).map((chat: any) => ({
                        ...chat,
                        tags: chat.chat_tags ? chat.chat_tags.map((ct: any) => ct.tags).filter((t: any) => t !== null) : []
                    }));
                }
            } else {
                chatsList = await depsHistoryHandler.listChats(10000, 0, undefined, undefined, undefined, undefined, projectId, serviceId);
            }

            if (chatsList && chatsList.length > 0) {
                // Filtrar por fecha
                if (startDate || endDate) {
                    chatsList = chatsList.filter((c: any) => {
                        if (!c.last_message_at) return false;
                        const msgDate = new Date(c.last_message_at);
                        if (startDate && msgDate < new Date(`${startDate}T00:00:00.000Z`)) return false;
                        if (endDate && msgDate > new Date(`${endDate}T23:59:59.999Z`)) return false;
                        return true;
                    });
                }
            } else {
                chatsList = [];
            }

            // Filtrar el número de ejemplo
            chatsList = chatsList.filter((chat: any) => {
                const cleanPhone = chat.id.split('@')[0];
                return cleanPhone !== '5491100000000';
            });

            if (chatsList.length === 0) {
                return res.status(400).json({ success: false, error: 'No se encontraron contactos que coincidan con los filtros aplicados.' });
            }

            // 2. Responder 202 de inmediato
            res.status(202).json({ success: true, message: 'Envío rápido masivo iniciado.', total: chatsList.length });

            // 3. Procesar envíos en segundo plano
            (async () => {
                const activeAdapter = getAdapterProvider();
            const activeGroup = getGroupProvider();
            const provider = isMetaProvider(activeAdapter) ? activeAdapter : activeGroup;
                const templates = await provider.getTemplates();
                const template = templates.find((t: any) => t.name === templateName);
                if (!template) {
                    console.error(`❌ [QUICK BULK] Plantilla ${templateName} no encontrada.`);
                    return;
                }

                let bodyText = "";
                const bodyComp = template.components?.find((c: any) => c.type === 'BODY');
                if (bodyComp) {
                    bodyText = bodyComp.text || "";
                }

                const historyContent = `[Campaña Rápida: ${templateName}]\n${bodyText}`;

                // Construir componentes (como multimedia por defecto)
                const components: any[] = [];
                let mediaLink = "";
                const headerComp = template.components?.find((c: any) => c.type === 'HEADER');
                if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
                    const lowFormat = headerComp.format.toLowerCase();
                    mediaLink = headerComp.example?.header_handle?.[0] || '';
                    let headerParamPayload: any = null;

                    if (mediaLink) {
                        const isMetaUrl = mediaLink.includes('fbcdn') || mediaLink.includes('fbsbx') || mediaLink.includes('facebook.com') || mediaLink.includes('lookaside.fbsbx.com') || mediaLink.includes('whatsapp.net') || mediaLink.includes('whatsapp.com');
                        if (isMetaUrl) {
                            try {
                                console.log(`📥 [QUICK BULK] Descargando multimedia de cabecera de Meta: ${mediaLink.substring(0, 50)}...`);
                                const accessToken = provider.config?.access_token || '';
                                const downloadHeaders: any = {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0 Safari/120.0.0.0',
                                    'Accept': '*/*'
                                };
                                if (accessToken) {
                                    downloadHeaders['Authorization'] = `Bearer ${accessToken}`;
                                }

                                const response = await axios.get(mediaLink, {
                                    responseType: 'arraybuffer',
                                    timeout: 30000,
                                    headers: downloadHeaders
                                });

                                const contentType = String(response.headers['content-type'] || '');
                                let ext = 'bin';
                                try {
                                    const mimeModule = await import('mime-types');
                                    const mime = mimeModule.default || mimeModule;
                                    ext = mime.extension(contentType) || 'bin';
                                    if (ext === 'bin') {
                                        ext = lowFormat === 'image' ? 'jpg' : lowFormat === 'video' ? 'mp4' : 'pdf';
                                    }
                                } catch {
                                    if (contentType.includes('video')) ext = 'mp4';
                                    else if (contentType.includes('image')) ext = 'jpg';
                                    else if (contentType.includes('pdf')) ext = 'pdf';
                                    else {
                                        ext = lowFormat === 'image' ? 'jpg' : lowFormat === 'video' ? 'mp4' : 'pdf';
                                    }
                                }

                                const uploadsDir = path.join(process.cwd(), 'uploads');
                                if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

                                const filename = `quick-bulk-${Date.now()}-${Math.floor(Math.random()*1000)}.${ext}`;
                                const downloadedPath = path.join(uploadsDir, filename);
                                fs.writeFileSync(downloadedPath, response.data);

                                // Intentar subir directamente a Meta para obtener media_id
                                if (typeof (provider as any).uploadMedia === 'function') {
                                    const uploadedMediaId = await (provider as any).uploadMedia(downloadedPath);
                                    if (uploadedMediaId) {
                                        headerParamPayload = { id: uploadedMediaId };
                                        console.log(`✅ [QUICK BULK] Multimedia subida a Meta con éxito. Media ID: ${uploadedMediaId}`);
                                    }
                                }

                                if (!headerParamPayload) {
                                    let baseUrl = process.env.PROJECT_URL;
                                    if (!baseUrl) {
                                        const host = req.headers.host || '';
                                        if (!host.includes('localhost')) {
                                            baseUrl = `https://${host}`;
                                        } else {
                                            baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://${host}`;
                                        }
                                    }
                                    if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
                                    const publicUrl = `${baseUrl.replace(/\/$/, '')}/uploads/${filename}`;
                                    headerParamPayload = { link: publicUrl };
                                    console.log(`✅ [QUICK BULK] Multimedia servida localmente en: ${publicUrl}`);
                                }
                            } catch (downloadErr: any) {
                                console.error(`❌ [QUICK BULK] Error descargando multimedia de cabecera:`, downloadErr.message);
                            }
                        }
                    }

                    // Fallback: Si no hay payload listo pero hay handle/link original
                    if (!headerParamPayload) {
                        const rawHandle = headerComp.example?.header_handle?.[0];
                        if (rawHandle) {
                            if (rawHandle.startsWith('http://') || rawHandle.startsWith('https://')) {
                                headerParamPayload = { link: rawHandle };
                            } else {
                                headerParamPayload = { handle: rawHandle };
                            }
                        } else if (mediaLink) {
                            headerParamPayload = { link: mediaLink };
                        }
                    }

                    if (headerParamPayload) {
                        components.push({
                            type: 'HEADER',
                            parameters: [{
                                type: lowFormat,
                                [lowFormat]: headerParamPayload
                            }]
                        });
                    } else {
                        console.warn(`⚠️ [QUICK BULK] Plantilla ${templateName} tiene cabecera multimedia pero no fue posible resolver un parámetro válido.`);
                    }
                }

                let sent = 0, errors = 0;
                for (const chat of chatsList) {
                    const phone = chat.id.split('@')[0];
                    try {
                        const resApi = await provider.sendTemplate(phone, templateName, languageCode || template.language || 'es', components, { isBulk: true, projectId, serviceId });
                        if (resApi?.messages) {
                            const msgId = resApi.messages[0].id;

                            // Si la plantilla tiene cabecera multimedia, guardar primero el mensaje multimedia
                            if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format) && mediaLink) {
                                const mediaType = headerComp.format.toLowerCase();
                                await depsHistoryHandler.saveMessage(chat.id, 'assistant', mediaLink, mediaType, undefined, undefined, `${msgId}_media`, 'whatsapp', projectId || undefined, serviceId || undefined);
                            }

                            await depsHistoryHandler.saveMessage(chat.id, 'assistant', historyContent, 'text', undefined, undefined, msgId, 'whatsapp', projectId || undefined, serviceId || undefined);
                            sent++;
                        } else {
                            errors++;
                            try {
                                await depsHistoryHandler.saveMessage(chat.id, 'assistant', historyContent, 'text', undefined, undefined, null, 'whatsapp', projectId || undefined, undefined, undefined, 'failed');
                            } catch (saveErr: any) {
                                console.error('[QUICK BULK] Error al guardar mensaje fallido:', saveErr.message);
                            }
                        }
                    } catch (e: any) {
                        errors++;
                        console.error(`❌ [QUICK BULK] Error de Meta para ${phone}:`, e.message || e);
                        try {
                            await depsHistoryHandler.saveMessage(chat.id, 'assistant', historyContent, 'text', undefined, undefined, null, 'whatsapp', projectId || undefined, undefined, undefined, 'failed');
                        } catch (saveErr: any) {
                            console.error('[QUICK BULK] Error al guardar mensaje fallido en catch:', saveErr.message);
                        }
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                console.log(`âœ… [QUICK BULK] EnvÃ­o rÃ¡pido finalizado: ${sent} enviados, ${errors} errores de ${chatsList.length} contactos.`);
            })();

        } catch (error: any) {
            console.error('Error en send-quick-template:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: error.message });
            }
        }
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/onboard-callback', async (req: any, res: any) => {
        const { code, wabaId: queryWabaId, phoneId: queryPhoneId, projectId: queryProjectId, state, serviceId: queryServiceId } = req.query;
        let projectId = (queryProjectId as string) || process.env.RAILWAY_PROJECT_ID || 'default_project';
        let serviceId = (queryServiceId as string) || resolveServiceId(req) || 'default_service';

        if (state && typeof state === 'string') {
            if (state.includes(':')) {
                const parts = state.split(':');
                projectId = parts[0];
                serviceId = parts[1];
            } else {
                projectId = state;
            }
        }
        
        console.log(`📡 [CALLBACK] Iniciando onboard-callback para Proyecto: ${projectId}, Servicio: ${serviceId}`);
        if (!code) return res.send('<h2>❌ Error: No se recibió el código de Meta</h2>');

        try {
            console.log(`ðŸ“¡ [CALLBACK] Intercambiando cÃ³digo Meta por token (v25.0)...`);

            const appId = await depsHistoryHandler.getConfig('META_APP_ID', projectId) || process.env.META_APP_ID || '1493670789148486';
            const appSecret = await depsHistoryHandler.getConfig('META_APP_SECRET', projectId) || process.env.META_APP_SECRET || '362b2ec20c00bdf51336fd165ad47160';

            if (!appId || !appSecret) {
                throw new Error("Faltan META_APP_ID o META_APP_SECRET en el servidor.");
            }

            const tokenResponse = await axios.get(`https://graph.facebook.com/v25.0/oauth/access_token`, {
                params: { client_id: appId, client_secret: appSecret, code: code }
            });

            const accessToken = tokenResponse.data.access_token;
            let finalWabaId = queryWabaId as string;
            let finalPhoneId = queryPhoneId as string;
            let finalVerifiedName = "";

            // 1. Descubrimiento de WhatsApp (WABA)
            const { discoverMetaIds } = await import("../../apis/meta/metaDiscovery");
            const mainToken = await depsHistoryHandler.getMainToken();
            const discovery = await discoverMetaIds(accessToken, mainToken, appId, appSecret);

            if (discovery.found && discovery.data) {
                finalWabaId = discovery.data.wabaId || finalWabaId;
                finalPhoneId = discovery.data.phoneNumberId || finalPhoneId;
                finalVerifiedName = discovery.data.verifiedName || "";
            }

            // 2. Descubrimiento de PÃ¡ginas (Messenger / Instagram)
            const { discoverAndLinkMetaPages } = await import("../../apis/meta/metaPageDiscovery");
            const pageDiscovery = await discoverAndLinkMetaPages(accessToken);
            if (pageDiscovery) {
                console.log(`✅ [CALLBACK] Guardando configuración de Página: ${pageDiscovery.pageName} para Proyecto: ${projectId}, Servicio: ${serviceId}`);
                await depsHistoryHandler.saveSetting('FACEBOOK_PAGE_ID', pageDiscovery.pageId, projectId, serviceId);
                await depsHistoryHandler.saveSetting('FACEBOOK_PAGE_TOKEN', pageDiscovery.pageAccessToken, projectId, serviceId);

                // Si encontramos Instagram vinculado, guardarlo tambiÃ©n
                if (pageDiscovery.instagramId) {
                    await depsHistoryHandler.saveSetting('INSTAGRAM_BUSINESS_ID', pageDiscovery.instagramId, projectId, serviceId);
                }

                // Activar visibilidad por defecto si encontramos una página
                await depsHistoryHandler.saveSetting('INSTAGRAM_VISIBLE', 'on', projectId, serviceId);
                await depsHistoryHandler.saveSetting('MESSENGER_VISIBLE', 'on', projectId, serviceId);
            }

            // 3. VerificaciÃ³n de resultados y depuraciÃ³n de scopes si fallÃ³ todo
            if (!discovery.found && !pageDiscovery) {
                console.warn('âš ï¸ [CALLBACK] No se pudo descubrir ningÃºn recurso automÃ¡ticamente.');

                const diagHtml = discovery.diagnostics.map(d => `
                    <div style="margin-bottom: 15px; border-bottom: 1px solid #edf2f7; padding-bottom: 10px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <strong style="font-size: 14px; color: #2d3748;">${d.step}</strong>
                            <span style="font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: bold; text-transform: uppercase;
                                background: ${d.status === 'success' ? '#c6f6d5' : d.status === 'empty' ? '#feebc8' : '#fed7d7'};
                                color: ${d.status === 'success' ? '#22543d' : d.status === 'empty' ? '#744210' : '#822727'};">
                                ${d.status}
                            </span>
                        </div>
                        <p style="font-size: 13px; color: #4a5568; margin: 4px 0;">${d.description}</p>
                        ${d.error ? `<p style="font-size: 12px; color: #e53e3e; font-family: monospace; background: #fff5f5; padding: 5px; border-radius: 4px; margin: 2px 0;">${d.error}</p>` : ''}
                        ${d.fbtrace_id ? `<p style="font-size: 10px; color: #a0aec0;">fbtrace_id: ${d.fbtrace_id}</p>` : ''}
                    </div>
                `).join('');

                const htmlError = `
                    <div style="font-family: sans-serif; padding: 40px; color: #2d3748; max-width: 800px; margin: 0 auto; line-height: 1.6; background: #f7fafc; min-height: 100vh;">
                        <div style="background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
                            <h1 style="color: #e53e3e; margin-bottom: 10px; font-size: 28px; font-weight: 800; text-align: center;">ConfiguraciÃ³n Incompleta</h1>
                            <p style="color: #718096; margin-bottom: 30px; text-align: center;">Hemos vinculado tu cuenta de Meta, pero no pudimos encontrar automÃ¡ticamente una cuenta de WhatsApp Cloud API activa.</p>

                            <div style="margin-top: 30px; background: #ebf8ff; padding: 25px; border-radius: 12px; border: 1px solid #bee3f8; text-align: left;">
                                <h3 style="margin-top: 0; color: #2b6cb0; font-size: 18px;">OpciÃ³n 1: ConfiguraciÃ³n Manual (Recomendado)</h3>
                                <p style="font-size: 14px; margin-bottom: 20px;">Si conoces tus IDs de WhatsApp, ingrÃ©salos aquÃ­. Esto activarÃ¡ el bot directamente sin validaciÃ³n por SMS.</p>

                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                    <div>
                                        <label style="display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #4a5568;">WABA ID (Account):</label>
                                        <input type="text" id="wabaManual" placeholder="1234567890..." style="width: 100%; padding: 12px; border: 1px solid #cbd5e0; border-radius: 8px; box-sizing: border-box;">
                                    </div>
                                    <div>
                                        <label style="display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #4a5568;">Phone Number ID:</label>
                                        <input type="text" id="phoneManual" placeholder="9876543210..." style="width: 100%; padding: 12px; border: 1px solid #cbd5e0; border-radius: 8px; box-sizing: border-box;">
                                    </div>
                                </div>

                                <button onclick="saveManual()" id="btnSaveManual" style="background: #3182ce; color: white; padding: 15px 25px; border-radius: 10px; border: none; font-weight: bold; width: 100%; margin-top: 20px; cursor: pointer; transition: all 0.2s;">
                                    Vincular con estos IDs
                                </button>
                            </div>

                            <div style="margin-top: 35px; border-top: 1px solid #edf2f7; padding-top: 25px; text-align: center;">
                                <button onclick="toggleLogs()" style="background: #edf2f7; border: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; color: #4a5568; cursor: pointer; font-weight: 600;">
                                    ðŸ” Ver DiagnÃ³stico TÃ©cnico del Descubrimiento
                                </button>

                                <div id="logSection" style="display: none; margin-top: 20px; text-align: left; background: white; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px; max-height: 400px; overflow-y: auto;">
                                    ${diagHtml}
                                </div>
                            </div>

                            <div style="margin-top: 40px; font-size: 13px; color: #a0aec0; text-align: center;">
                                <p>Tip: AsegÃºrate de que tu cuenta de WhatsApp estÃ© validada en el panel de Meta Developer antes de intentar la vinculaciÃ³n.</p>
                            </div>
                        </div>

                        <script>
                            const projectId = "${projectId}";
                            const serviceId = "${serviceId}";
                            const accessToken = "${accessToken}";

                            function toggleLogs() {
                                const section = document.getElementById('logSection');
                                section.style.display = section.style.display === 'none' ? 'block' : 'none';
                            }

                            async function saveManual() {
                                const waba = document.getElementById('wabaManual').value;
                                const phone = document.getElementById('phoneManual').value;
                                if (!waba || !phone) return alert('Por favor completa ambos IDs');

                                document.getElementById('btnSaveManual').innerText = 'Guardando...';
                                document.getElementById('btnSaveManual').disabled = true;

                                try {
                                    const res = await fetch('/api/backoffice/whatsapp/sync-manual', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            token: accessToken,
                                            wabaId: waba,
                                            phoneNumberId: phone,
                                            projectId: projectId,
                                            serviceId: serviceId
                                        })
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                        window.location.href = window.location.origin + "/dashboard.html?metaStatus=success";
                                    } else {
                                        alert('Error: ' + data.error);
                                        document.getElementById('btnSaveManual').innerText = 'Vincular con estos IDs';
                                        document.getElementById('btnSaveManual').disabled = false;
                                    }
                                } catch (e) {
                                    alert('Error de conexiÃ³n: ' + e.message);
                                }
                            }
                        </script>
                    </div>
                `;

                // Guardar solo el token para futuras referencias
                await depsHistoryHandler.saveMetaOnboardingData(null as any, null as any, accessToken, { diagnostics: discovery.diagnostics }, projectId, serviceId);
                return res.send(htmlError);
            }

            // Registrar y suscribir WhatsApp si se encontrÃ³
            const tokenToUse = mainToken || accessToken;
            if (finalPhoneId) {
                await axios.post(`https://graph.facebook.com/v25.0/${finalPhoneId}/register`,
                    { messaging_product: 'whatsapp', pin: '' },
                    { headers: { 'Authorization': `Bearer ${tokenToUse}` } }
                ).catch(() => {});
            }

            if (finalWabaId) {
                await axios.post(`https://graph.facebook.com/v25.0/${finalWabaId}/subscribed_apps`,
                    {},
                    { headers: { 'Authorization': `Bearer ${tokenToUse}` } }
                ).catch(() => {});

                // Suscribir tambiÃ©n a smb_message_echoes para capturar mensajes
                // enviados manualmente desde la app de WhatsApp (AtenciÃ³n Humana)
                try {
                    console.log('ðŸ“¡ [CALLBACK] Suscribiendo a smb_message_echoes para sincronizaciÃ³n de mensajes manuales...');
                    await axios.post(`https://graph.facebook.com/v25.0/${finalWabaId}/subscribed_apps`,
                        { override_callback_uri: undefined },
                        {
                            headers: { 'Authorization': `Bearer ${tokenToUse}` },
                            params: { subscribed_fields: 'messages,smb_message_echoes' }
                        }
                    );
                    console.log('âœ… [CALLBACK] SuscripciÃ³n a smb_message_echoes exitosa.');
                } catch (smbErr: any) {
                    console.warn('âš ï¸ [CALLBACK] No se pudo suscribir a smb_message_echoes:', smbErr?.response?.data || smbErr.message);
                }

                await depsHistoryHandler.saveMetaOnboardingData(finalWabaId, finalPhoneId, tokenToUse, { verified_name: finalVerifiedName }, projectId, serviceId);

                // --- SINCRONIZACIÃ“N AUTOMÃTICA SMB ---
                // Solicitamos contactos e historial inmediatamente tras la vinculaciÃ³n
                if (finalPhoneId) {
                    try {
                        await triggerMetaSync(accessToken, finalPhoneId);
                    } catch (syncErr: any) {
                        console.warn('âš ï¸ [CALLBACK] SincronizaciÃ³n automÃ¡tica de contactos/historial fallÃ³ (omitiendo para no bloquear la vinculaciÃ³n):', syncErr.response?.data || syncErr.message);
                    }
                }
            }

            console.log(`âœ… [CALLBACK] Onboarding finalizado con Ã©xito para Proyecto: ${projectId}`);

            // Programar un reinicio automÃ¡tico para aplicar el cambio de motor (Baileys -> Meta)
            setTimeout(() => {
                console.log('ðŸ”„ [SYSTEM] Reiniciando bot automÃ¡ticamente para aplicar la configuraciÃ³n de Meta...');
                process.exit(1);
            }, 5000);

            return res.redirect("https://duskcodes.com.ar/dashboard.html?metaStatus=success");

        } catch (error: any) {
            console.error('âŒ [CALLBACK] Error en vinculaciÃ³n Meta:', error.response?.data || error.message);
            const errorDetails = error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message;

            return res.status(500).send(`
                <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; max-width: 600px; margin: 40px auto;">
                    <h2 style="color: #c53030; margin-bottom: 20px;">âŒ Error en la vinculaciÃ³n con Meta</h2>
                    <p style="color: #4a5568; margin-bottom: 20px;">No se pudieron guardar las credenciales del proyecto <b>${projectId || 'No Detectado'}</b>.</p>
                    <div style="text-align: left; background: #fff; padding: 15px; border-radius: 4px; border: 1px solid #edf2f7; overflow: auto; max-height: 200px;">
                        <pre style="font-size: 12px; color: #718096; margin: 0;">${errorDetails}</pre>
                    </div>
                    <div style="margin-top: 30px;">
                        <a href="https://duskcodes.com.ar/dashboard.html" style="background: #3182ce; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Volver al Dashboard</a>
                    </div>
                </div>
            `);
        }
    });

    /**
     * Endpoint para vinculaciÃ³n manual de IDs si el auto-descubrimiento fallÃ³.
     * TambiÃ©n dispara la sincronizaciÃ³n SMB automÃ¡tica.
     */
    app.post('/api/backoffice/whatsapp/sync-manual', bodyParser.json(), async (req: any, res: any) => {
        const { token, wabaId, phoneNumberId, projectId, serviceId: bodyServiceId } = req.body;
        if (!token || !wabaId || !phoneNumberId) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }
        const serviceId = bodyServiceId || resolveServiceId(req) || 'default_service';

        try {
            console.log(`📡 [SYNC-MANUAL] Vinculando manualmente para Proyecto: ${projectId}, Servicio: ${serviceId}`);
            await depsHistoryHandler.saveMetaOnboardingData(wabaId, phoneNumberId, token, { manual: true }, projectId, serviceId);

            // Disparar sincronizaciÃ³n SMB
            try {
                await triggerMetaSync(token, phoneNumberId);
            } catch (syncErr: any) {
                console.warn('âš ï¸ [SYNC-MANUAL] SincronizaciÃ³n automÃ¡tica manual fallÃ³ (omitiendo para no bloquear la vinculaciÃ³n):', syncErr.response?.data || syncErr.message);
            }

            // Programar reinicio
            setTimeout(() => {
                console.log('ðŸ”„ [SYSTEM] Reiniciando bot por vinculaciÃ³n manual...');
                process.exit(1);
            }, 3000);

            res.json({ success: true });
        } catch (error: any) {
            console.error('âŒ [SYNC-MANUAL] Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/sync-ids', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req) || (req.query.projectId as string) || process.env.RAILWAY_PROJECT_ID || 'default';
        const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
        console.log(`ðŸ”„ [SYNC-IDS] Iniciando sincronizacion para proyecto: ${projectId}, servicio: ${serviceId}`);
        try {
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);

            if (!config?.access_token || config.access_token === 'PENDING') {
                console.warn(`âš ï¸ [SYNC-IDS] No hay access_token guardado para proyecto: ${projectId}`);
                return res.status(400).json({ success: false, error: 'No hay token guardado para este proyecto. Completa el proceso de vinculacion primero.' });
            }

            console.log(`âœ… [SYNC-IDS] Token encontrado. waba_id=${config.waba_id || 'null'}, phone_number_id=${config.phone_number_id || 'null'}`);

            const isAbsent = (v: any) => !v || v === 'PENDING';
            if (!isAbsent(config.waba_id) && !isAbsent(config.phone_number_id)) {
                console.log(`âœ… [SYNC-IDS] IDs ya presentes en Supabase. No requiere discovery.`);
                return res.json({ success: true, already: true, waba_id: config.waba_id, phone_number_id: config.phone_number_id });
            }

            console.log(`ðŸ” [SYNC-IDS] IDs faltantes. Iniciando discovery con token guardado...`);
            const { discoverMetaIds } = await import('../../apis/meta/metaDiscovery');
            const mainToken = await depsHistoryHandler.getMainToken();
            const appId = await depsHistoryHandler.getConfig('META_APP_ID', projectId) || process.env.META_APP_ID || '1493670789148486';
            const appSecret = await depsHistoryHandler.getConfig('META_APP_SECRET', projectId) || process.env.META_APP_SECRET || '362b2ec20c00bdf51336fd165ad47160';
            const discovery = await discoverMetaIds(config.access_token, mainToken, appId, appSecret);

            if (!discovery.found || !discovery.data?.wabaId || !discovery.data?.phoneNumberId) {
                console.error(`âŒ [SYNC-IDS] Discovery fallo para proyecto ${projectId}. No se encontraron IDs.`);
                return res.status(404).json({ success: false, error: 'No se pudieron descubrir los IDs automaticamente. Ingresalos manualmente.' });
            }

            console.log(`ðŸ” [SYNC-IDS] Discovery exitoso: WABA=${discovery.data.wabaId}, Phone=${discovery.data.phoneNumberId}. Guardando en Supabase...`);
            const saveResult = await depsHistoryHandler.saveMetaOnboardingData(
                discovery.data.wabaId,
                discovery.data.phoneNumberId,
                config.access_token,
                { verified_name: discovery.data.verifiedName || '' },
                projectId,
                serviceId
            );

            if (!saveResult.success) {
                console.error(`âŒ [SYNC-IDS] Fallo al guardar en Supabase para proyecto ${projectId}:`, saveResult.error);
                return res.status(500).json({ success: false, error: 'No se pudieron guardar los IDs en la base de datos.' });
            }

            console.log(`âœ… [SYNC-IDS] IDs guardados exitosamente para proyecto ${projectId}.`);
            res.json({ success: true, waba_id: discovery.data.wabaId, phone_number_id: discovery.data.phoneNumberId });
        } catch (error: any) {
            console.error(`âŒ [SYNC-IDS] Error inesperado para proyecto ${projectId}:`, error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/unlink-meta', backofficeAuth, async (req: any, res: any) => {
        const projectId = resolveProjectId(req) || req.query.projectId || process.env.RAILWAY_PROJECT_ID || "default";
        const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
        console.log(`ðŸ“¡ [UNLINK-META] Iniciando desvinculaciÃ³n de Meta para Proyecto: ${projectId}, Servicio: ${serviceId}`);
        try {
            // 1. Obtener datos de onboarding actuales de la base de datos
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
            if (config) {
                const token = config.access_token || config.whatsappToken;
                const phoneId = config.phone_number_id || config.whatsappNumberId;
                const wabaId = config.waba_id || config.whatsappBusinessId;

                if (token && token !== 'PENDING') {
                    // 2. Llamada a la API de Meta para desvincular (Deregister del telÃ©fono y DELETE de subscribed_apps)
                    try {
                        if (phoneId && phoneId !== 'PENDING') {
                            console.log(`ðŸ“¡ [UNLINK-META] Ejecutando deregister para Phone ID: ${phoneId}...`);
                            await axios.post(`https://graph.facebook.com/v25.0/${phoneId}/deregister`,
                                {},
                                { headers: { 'Authorization': `Bearer ${token}` } }
                            );
                            console.log(`âœ… [UNLINK-META] Phone ID deregistered exitosamente.`);
                        }
                    } catch (metaPhoneErr: any) {
                        console.warn(`âš ï¸ [UNLINK-META] Error desregistrando nÃºmero en Meta (puede estar ya desregistrado):`, metaPhoneErr.response?.data || metaPhoneErr.message);
                    }

                    try {
                        if (wabaId && wabaId !== 'PENDING') {
                            console.log(`ðŸ“¡ [UNLINK-META] Eliminando suscripciÃ³n de app para WABA ID: ${wabaId}...`);
                            await axios.delete(`https://graph.facebook.com/v25.0/${wabaId}/subscribed_apps`,
                                { headers: { 'Authorization': `Bearer ${token}` } }
                            );
                            console.log(`âœ… [UNLINK-META] App unsubscribed de WABA exitosamente.`);
                        }
                    } catch (metaWabaErr: any) {
                        console.warn(`âš ï¸ [UNLINK-META] Error eliminando suscripciÃ³n en Meta (puede estar ya eliminada):`, metaWabaErr.response?.data || metaWabaErr.message);
                    }
                }
            }

            // 3. Eliminar onboarding de la base de datos para este proyecto
            console.log(`ðŸ§¹ [UNLINK-META] Eliminando registro onboarding de la DB...`);
            let obQuery = supabase
                .from('meta_onboarding')
                .delete()
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                obQuery = obQuery.eq('service_id', serviceId);
            }

            const { error: errOnboard } = await obQuery;
            if (errOnboard) throw errOnboard;

            // 4. Eliminar rutas de routing_table de la base de datos para este proyecto
            console.log(`ðŸ§¹ [UNLINK-META] Eliminando registros de rutas en routing_table de la DB...`);
            let rtQuery = supabase
                .from('routing_table')
                .delete()
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                rtQuery = rtQuery.eq('service_id', serviceId);
            }

            const { error: errRoutes } = await rtQuery;
            if (errRoutes) throw errRoutes;

            historyEvents.emit('whatsapp_line_changed', {
                projectId,
                project_id: projectId,
                serviceId,
                service_id: serviceId,
                provider: 'meta-unlink'
            });
            console.log(`âœ… [UNLINK-META] DesvinculaciÃ³n de Meta completada para el proyecto ${projectId}.`);

            // 5. Programar reinicio automÃ¡tico del bot para limpiar cachÃ© y revertir motor a por defecto
            setTimeout(() => {
                console.log('ðŸ”„ [SYSTEM] Reiniciando bot automÃ¡ticamente para aplicar desvinculaciÃ³n...');
                process.exit(1);
            }, 3000);

            res.json({ success: true });
        } catch (error: any) {
            console.error('âŒ [UNLINK-META] Error crÃ­tico:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/onboard', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, error: 'Code is required' });
        try {
            const projectId = resolveProjectId(req) || process.env.RAILWAY_PROJECT_ID || 'default_project';
            const appId = await depsHistoryHandler.getConfig('META_APP_ID', projectId) || process.env.META_APP_ID || '1493670789148486';
            const appSecret = await depsHistoryHandler.getConfig('META_APP_SECRET', projectId) || process.env.META_APP_SECRET || '362b2ec20c00bdf51336fd165ad47160';

            const response = await axios.post('https://ygyicozjewxbyixtpjlo.supabase.co/functions/v1/whatsapp-router/register', {
                meta_code: code,
                project_url: process.env.PROJECT_URL,
                project_id: projectId,
                app_id: appId,
                app_secret: appSecret
            });
            const data = response.data;
            const serviceId = resolveServiceId(req);
            const result = await depsHistoryHandler.saveMetaOnboardingData(
                data.phoneNumberId || data.phone_number_id || "PENDING",
                data.wabaId || data.waba_id || "PENDING",
                data.accessToken || data.access_token,
                { ...data, syncedBy: 'duskcodes-master-router' },
                projectId,
                serviceId
            );
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- SYNC ASSISTANT PROMPT ---

    app.post('/api/backoffice/sync-assistant-prompt', systemConfigAuth, bodyParser.json(), async (req: any, res: any) => {
        const { assistantId } = req.body;
        if (!assistantId) return res.status(400).json({ success: false, error: 'assistantId is required' });

        try {
            console.log(`ðŸ“¡ [SYNC] Obteniendo instrucciones para el asistente: ${assistantId}`);
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const dynamicOpenAI = await getOpenAI(projectId || undefined, serviceId || undefined);
            if (!dynamicOpenAI) {
                return res.status(400).json({ success: false, error: 'OpenAI API Key no configurada. Por favor, guarde la configuraciÃ³n con una clave vÃ¡lida primero.' });
            }
            const assistant = await dynamicOpenAI.beta.assistants.retrieve(assistantId);

            if (assistant) {
                res.json({
                    success: true,
                    instructions: assistant.instructions || '',
                    name: assistant.name,
                    model: assistant.model
                });
            } else {
                res.status(404).json({ success: false, error: 'Assistant not found' });
            }
        } catch (error: any) {
            console.error('Error syncing assistant prompt:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- GENERIC SETTINGS (Used by CRM) ---
    app.get('/api/backoffice/get-setting', backofficeAuth, async (req: any, res: any) => {
        const key = req.query.key as string;
        if (!key) return res.status(400).json({ success: false, error: 'key is required' });
        try {
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const value = await depsHistoryHandler.getSetting(key, projectId, serviceId);
            res.json({ success: true, value });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/save-setting', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ success: false, error: 'key is required' });
        try {
            const PROTECTED_KEYS = ['OPENAI_ADMIN_API_KEY', 'OPENAI_API_KEY_TOOLS'];
            if (PROTECTED_KEYS.includes(key)) {
                return res.status(403).json({ success: false, error: 'Esta variable es estÃ¡tica y solo puede editarse vÃ­a base de datos.' });
            }
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            await depsHistoryHandler.saveSetting(key, value, projectId, serviceId);
            if (key === 'GLOBAL_BOT_ENABLED') {
                historyEvents.emit('setting_changed', { key, value, projectId, serviceId });
            }
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- MERCADO PAGO ---
    app.get('/api/backoffice/mercadopago/status', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || 'default';
            const { data: acc } = await supabase
                .from('mercadopago_acount_user')
                .select('*')
                .eq('project_id', projectId)
                .eq('is_active', true)
                .maybeSingle();

            if (!acc) {
                return res.json({ success: true, connected: false });
            }

            return res.json({
                success: true,
                connected: true,
                nickname: acc.nickname || 'Desconocido',
                email: acc.email || 'Desconocido',
                id: acc.user_id || 'Desconocido',
                isFromEnv: false
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- NUEVAS RUTAS PARA MULTIPLE CUENTAS MERCADO PAGO ---
    app.get('/api/backoffice/mercadopago/accounts', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || 'default';
            const { data: accounts, error } = await supabase
                .from('mercadopago_acount_user')
                .select('user_id, nickname, email, is_active, updated_at')
                .eq('project_id', projectId)
                .order('updated_at', { ascending: false });

            if (error) throw error;
            res.json({ success: true, accounts: accounts || [] });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/mercadopago/accounts/activate', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || 'default';
            const { userId } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, error: 'userId faltante en la peticiÃ³n' });
            }

            // Desactivar todas las cuentas de este proyecto
            const { error: deactivateErr } = await supabase
                .from('mercadopago_acount_user')
                .update({ is_active: false })
                .eq('project_id', projectId);

            if (deactivateErr) throw deactivateErr;

            // Activar la cuenta seleccionada
            const { error: activateErr } = await supabase
                .from('mercadopago_acount_user')
                .update({ is_active: true })
                .eq('project_id', projectId)
                .eq('user_id', String(userId));

            if (activateErr) throw activateErr;

            res.json({ success: true, message: 'Cuenta de Mercado Pago activada con Ã©xito.' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/mercadopago/accounts/delete', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || 'default';
            const { userId } = req.body;
            if (!userId) {
                return res.status(400).json({ success: false, error: 'userId faltante en la peticiÃ³n' });
            }

            // 1. Obtener la cuenta para ver si es la activa
            const { data: targetAccount } = await supabase
                .from('mercadopago_acount_user')
                .select('is_active, access_token')
                .eq('project_id', projectId)
                .eq('user_id', String(userId))
                .maybeSingle();

            if (!targetAccount) {
                return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
            }

            const wasActive = targetAccount.is_active;

            // 2. Revocar token en Mercado Pago (Opcional - Mejor esfuerzo)
            try {
                const appId = await depsHistoryHandler.getSetting('MP_APP_ID', projectId) || process.env.MP_APP_ID;
                const appSecret = await depsHistoryHandler.getSetting('MP_PASS', projectId) || process.env.MP_PASS;
                if (appId && appSecret && targetAccount.access_token) {
                    await axios.post('https://api.mercadopago.com/oauth/token/revoke', {
                        client_id: appId,
                        client_secret: appSecret,
                        token: targetAccount.access_token
                    });
                    console.log(`[MP Revoke] Token de usuario ${userId} revocado con Ã©xito en Mercado Pago.`);
                }
            } catch (revokeErr: any) {
                console.warn('[MP Revoke] No se pudo revocar el token en Mercado Pago:', revokeErr.response?.data || revokeErr.message);
            }

            // 3. Eliminar de las tablas de base de datos
            await supabase.from('mercadopago_user_routoing').delete().eq('user_id', String(userId));
            const { error: deleteErr } = await supabase
                .from('mercadopago_acount_user')
                .delete()
                .eq('project_id', projectId)
                .eq('user_id', String(userId));

            if (deleteErr) throw deleteErr;

            // 4. Si la cuenta que eliminamos era la activa, buscar otra cuenta vinculada para activarla
            if (wasActive) {
                const { data: otherAccounts } = await supabase
                    .from('mercadopago_acount_user')
                    .select('user_id')
                    .eq('project_id', projectId)
                    .order('updated_at', { ascending: false });

                if (otherAccounts && otherAccounts.length > 0) {
                    const nextActiveUserId = otherAccounts[0].user_id;
                    await supabase
                        .from('mercadopago_acount_user')
                        .update({ is_active: true })
                        .eq('project_id', projectId)
                        .eq('user_id', nextActiveUserId);
                    console.log(`[MP Delete] Cuenta activa eliminada. Activando cuenta ${nextActiveUserId} automÃ¡ticamente.`);
                }
            }

            res.json({ success: true, message: 'Cuenta de Mercado Pago eliminada con Ã©xito.' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });



    app.get('/api/backoffice/mercadopago/auth-url', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || 'default';

            // Detectar dominio pÃºblico y guardarlo dinÃ¡micamente en settings
            const host = req.headers.host || '';
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PROJECT_URL || `${protocol}://${host}`;

            if (domain.startsWith('http')) {
                const urlObj = new URL(domain);
                await depsHistoryHandler.saveSetting('RAILWAY_PUBLIC_DOMAIN', urlObj.host, projectId);
            } else {
                await depsHistoryHandler.saveSetting('RAILWAY_PUBLIC_DOMAIN', domain, projectId);
            }

            let fullUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            if (fullUrl.endsWith('/')) fullUrl = fullUrl.slice(0, -1);
            await depsHistoryHandler.saveSetting('PROJECT_URL', fullUrl, projectId);

            const appId = await depsHistoryHandler.getSetting('MP_APP_ID', projectId) || process.env.MP_APP_ID;
            if (!appId) {
                return res.status(500).json({ success: false, error: 'ConfiguraciÃ³n MP_APP_ID faltante en el servidor o base de datos.' });
            }

            const supabaseUrl = process.env.SUPABASE_URL || '';
            const redirectUri = encodeURIComponent(`${supabaseUrl}/functions/v1/clientes-mercadopago-webhook`);

            // Codificar el state como base64 conteniendo el projectId y el initiatorDomain (fullUrl)
            const stateObj = { projectId, initiatorDomain: fullUrl };
            const stateBase64 = Buffer.from(JSON.stringify(stateObj)).toString('base64');

            const authUrl = `https://auth.mercadopago.com.ar/authorization?client_id=${appId}&response_type=code&platform_id=mp&redirect_uri=${redirectUri}&state=${stateBase64}`;

            res.json({ success: true, url: authUrl });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/mercadopago/callback', async (req: any, res: any) => {
        const { code, state } = req.query;
        if (!code) {
            return res.status(400).send('CÃ³digo de autorizaciÃ³n faltante de Mercado Pago.');
        }

        try {
            const projectId = (state && state !== 'default') ? state : 'default';
            const appId = await depsHistoryHandler.getSetting('MP_APP_ID', projectId) || process.env.MP_APP_ID;
            const appSecret = await depsHistoryHandler.getSetting('MP_PASS', projectId) || process.env.MP_PASS; // client_secret

            if (!appId || !appSecret) {
                console.error('[MercadoPago Callback] Faltan credenciales de aplicaciÃ³n en env o DB:', { appId, appSecret, projectId });
                return res.status(500).send(`Error interno: ConfiguraciÃ³n de la aplicaciÃ³n faltante. (Project: ${projectId}, AppID: ${appId ? 'Presente' : 'Faltante'}, Secret: ${appSecret ? 'Presente' : 'Faltante'})`);
            }

            const supabaseUrl = process.env.SUPABASE_URL || '';
            const redirectUri = `${supabaseUrl}/functions/v1/clientes-mercadopago-webhook`;

            // Exchange code for token
            const tokenRes = await axios.post('https://api.mercadopago.com/oauth/token',
                new URLSearchParams({
                    client_id: appId,
                    client_secret: appSecret,
                    grant_type: 'authorization_code',
                    code: code as string,
                    redirect_uri: redirectUri
                }).toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );

            const { access_token, public_key, user_id } = tokenRes.data;

            if (!access_token) {
                return res.status(400).send('No se recibiÃ³ el access token en la respuesta de Mercado Pago.');
            }

            // Obtener el nickname e email del vendedor desde Mercado Pago
            let nickname = 'Desconocido';
            let email = 'Desconocido';
            try {
                const mpUserRes = await axios.get('https://api.mercadopago.com/users/me', {
                    headers: { 'Authorization': `Bearer ${access_token}` }
                });
                nickname = mpUserRes.data.nickname || 'Desconocido';
                email = mpUserRes.data.email || 'Desconocido';
            } catch (err: any) {
                console.warn('[MercadoPago Callback] Error obteniendo info de usuario:', err.message);
            }

            // Determinar si esta debe ser la cuenta activa por defecto o si ya estaba vinculada
            const { data: existingAccounts } = await supabase
                .from('mercadopago_acount_user')
                .select('user_id, is_active')
                .eq('project_id', projectId);

            const hasActiveAccount = (existingAccounts || []).some((acc: any) => acc.is_active);
            const isAlreadyLinked = (existingAccounts || []).some((acc: any) => String(acc.user_id) === String(user_id));
            const isFirst = (existingAccounts || []).length === 0;
            const makeActive = isFirst || !hasActiveAccount;

            // Guardar en la tabla mercadopago_acount_user (Soporta mÃºltiples cuentas por proyecto)
            await supabase.from('mercadopago_acount_user').upsert({
                project_id: projectId,
                access_token,
                public_key: public_key || null,
                user_id: String(user_id),
                nickname: nickname || null,
                email: email || null,
                is_active: makeActive,
                updated_at: new Date().toISOString()
            }, { onConflict: 'project_id,user_id' });

            // Guardar en la tabla mercadopago_user_routoing para enrutamiento
            await supabase.from('mercadopago_user_routoing').upsert({
                user_id: String(user_id),
                project_id: projectId,
                project_url: process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '',
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

            // Retornar pÃ¡gina HTML para cerrar el popup y notificar a la ventana principal, o redirigir si no hay opener
            const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PROJECT_URL || "";
            const cleanDomain = publicDomain.startsWith("http") ? publicDomain : publicDomain ? `https://${publicDomain}` : "";
            const origin = cleanDomain || '';
            const targetUrl = `${origin}/mercado-pago?projectId=${projectId}`;

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>VinculaciÃ³n Exitosa</title>
                </head>
                <body>
                    <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                        <h2>Vinculando cuenta...</h2>
                        <p>Esta ventana se cerrarÃ¡ automÃ¡ticamente.</p>
                    </div>
                    <script>
                        try {
                            if (window.opener) {
                                window.opener.postMessage({
                                    type: '${isAlreadyLinked ? 'mp-linked-existing' : 'mp-linked'}',
                                    projectId: '${projectId}',
                                    nickname: '${nickname}'
                                }, '*');
                                window.close();
                            } else {
                                window.location.href = '${targetUrl}';
                            }
                        } catch (e) {
                            window.location.href = '${targetUrl}';
                        }
                    </script>
                </body>
                </html>
            `);
        } catch (error: any) {
            console.error('[MercadoPago Callback] Error en el intercambio de token:', error.response?.data || error.message);
            res.status(500).send(`Error al vincular cuenta: ${error.response?.data?.message || error.message}`);
        }
    });

    // --- MERCADO PAGO CUSTOMER PAYMENT CALLBACK ---
    app.get('/api/mercadopago/callback', (req: any, res: any) => {
        const { status, payment_id } = req.query;
        const isApproved = status === 'approved';

        let title = 'Estado de Pago';
        let color = '#f59e0b'; // pending yellow
        let icon = 'fa-clock';
        let message = 'Tu pago se encuentra en proceso o pendiente.';

        if (isApproved) {
            title = 'Â¡Pago Exitoso!';
            color = '#10b981'; // green
            icon = 'fa-circle-check';
            message = 'Â¡Muchas gracias! Tu pago ha sido procesado con Ã©xito.';
        } else if (status === 'rejected' || status === 'cancelled') {
            title = 'Pago Rechazado';
            color = '#ef4444'; // red
            icon = 'fa-circle-xmark';
            message = 'Lo sentimos, el pago no pudo ser completado.';
        }

        res.setHeader('Content-Type', 'text/html');
        res.end(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${title}</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
                        background: #0f172a;
                        color: #f8fafc;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                    }
                    .card {
                        background: #1e293b;
                        border: 1px solid #334155;
                        border-radius: 24px;
                        padding: 2.5rem 2rem;
                        max-width: 420px;
                        width: 90%;
                        text-align: center;
                        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
                    }
                    .icon {
                        font-size: 4.5rem;
                        color: ${color};
                        margin-bottom: 1.5rem;
                    }
                    h1 {
                        font-size: 1.75rem;
                        font-weight: 700;
                        margin: 0 0 10px;
                        color: #f8fafc;
                    }
                    p {
                        color: #94a3b8;
                        font-size: 1rem;
                        line-height: 1.5;
                        margin: 0 0 1.5rem;
                    }
                    .details {
                        background: #0f172a;
                        border-radius: 12px;
                        padding: 1rem;
                        margin-bottom: 2rem;
                        font-size: 0.9rem;
                        text-align: left;
                        border: 1px solid #1e293b;
                    }
                    .detail-row {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 6px;
                    }
                    .detail-row:last-child {
                        margin-bottom: 0;
                    }
                    .label {
                        color: #64748b;
                    }
                    .value {
                        color: #cbd5e1;
                        font-weight: 600;
                    }
                    .btn {
                        display: inline-block;
                        width: 100%;
                        box-sizing: border-box;
                        background: #009ee3;
                        color: white;
                        text-decoration: none;
                        padding: 12px;
                        border-radius: 12px;
                        font-weight: 600;
                        transition: background 0.2s;
                        cursor: pointer;
                        border: none;
                        text-align: center;
                    }
                    .btn:hover {
                        background: #008cd1;
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon"><i class="fa-solid ${icon}"></i></div>
                    <h1>${title}</h1>
                    <p>${message}</p>

                    <div class="details">
                        <div class="detail-row">
                            <span class="label">ID de OperaciÃ³n:</span>
                            <span class="value">${payment_id || 'N/D'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Estado del Pago:</span>
                            <span class="value" style="color: ${color};">${status ? status.toUpperCase() : 'DESCONOCIDO'}</span>
                        </div>
                    </div>

                    <button class="btn" onclick="window.close()">Cerrar Ventana</button>
                </div>
            </body>
            </html>
        `);
    });

    // --- MERCADO PAGO CUSTOMER PAYMENT WEBHOOK ---
    app.get('/api/clientes/mercadopago/webhook', (req: any, res: any) => {
        res.statusCode = 200;
        res.end('OK');
    });

    app.post('/api/clientes/mercadopago/webhook', bodyParser.json(), async (req: any, res: any) => {
        res.statusCode = 200;
        res.end('OK');

        try {
            console.log('ðŸ“¡ [MP Webhook] Recibida notificaciÃ³n de pago:', JSON.stringify(req.body));

            const paymentId = req.body?.data?.id || req.body?.id || req.query?.id;
            const type = req.body?.type || req.body?.topic || req.query?.topic;
            const userId = req.body?.user_id || req.query?.user_id;

            if (type !== 'payment' || !paymentId) {
                console.log(`[MP Webhook] Ignorando notificaciÃ³n tipo: ${type || 'indefinido'}, ID: ${paymentId || 'indefinido'}`);
                return;
            }

            // 1. Identificar el projectId usando el user_id de Mercado Pago
            let projectId: string | null = null;
            if (userId) {
                const { data: routeData, error: dbErr } = await supabase
                    .from('mercadopago_user_routoing')
                    .select('project_id')
                    .eq('user_id', String(userId))
                    .limit(1);

                if (dbErr) {
                    console.error('[MP Webhook] Error consultando mercadopago_user_routoing:', dbErr.message);
                } else if (routeData && routeData.length > 0) {
                    projectId = routeData[0].project_id;
                }
            }

            // 2. Obtener el token de acceso correspondiente (DB o fallback a ENV)
            let accessToken = "";
            if (projectId) {
                const { data: acc } = await supabase
                    .from('mercadopago_acount_user')
                    .select('access_token')
                    .eq('project_id', projectId)
                    .eq('is_active', true)
                    .maybeSingle();
                accessToken = acc?.access_token || "";
            }
            if (!accessToken) {
                accessToken = process.env.MP_TOKEN_TEST || process.env.MP_ACCESS_TOKEN || "";
            }

            if (!accessToken) {
                console.error('[MP Webhook] Error: No se encontrÃ³ Access Token para procesar el pago ID:', paymentId);
                return;
            }

            // 3. Consultar los detalles del pago a la API de Mercado Pago
            const paymentRes = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const payment = paymentRes.data;

            // 3.5 Extraer projectId y chatId de external_reference
            const extRef = payment?.external_reference || "";
            const parts = extRef.split(':');
            const refProjectId = parts[0] || projectId;
            const chatId = parts[1];

            // 5. Evitar procesar el mismo pago mÃ¡s de una vez (DeduplicaciÃ³n)
            const { data: existingPayment, error: payErr } = await supabase
                .from('mercadopago_payments_clients')
                .select('id, status')
                .eq('id', String(paymentId))
                .maybeSingle();

            if (payErr) {
                console.error('[MP Webhook] Error deduplicando pago:', payErr.message);
            } else if (existingPayment && existingPayment.status === 'approved') {
                console.log(`[MP Webhook] El pago ${paymentId} ya fue procesado como aprobado previamente.`);
                return;
            }

            // Guardar registro de la transacciÃ³n en la base de datos mercadopago_payments_clients
            if (payment) {
                const { error: savePayErr } = await supabase
                    .from('mercadopago_payments_clients')
                    .upsert({
                        id: String(paymentId),
                        project_id: refProjectId,
                        chat_id: chatId || null,
                        status: payment.status || null,
                        description: payment.description || null,
                        transaction_amount: payment.transaction_amount || null,
                        payment_method_id: payment.payment_method_id || null,
                        user_id: userId ? String(userId) : null,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'id' });

                if (savePayErr) {
                    console.error('[MP Webhook] Error guardando registro en mercadopago_payments_clients:', savePayErr.message);
                } else {
                    console.log(`[MP Webhook] Registro de pago ${paymentId} (${payment.status}) guardado en base de datos.`);
                }
            }

            if (!payment || payment.status !== 'approved') {
                console.log(`[MP Webhook] Pago ${paymentId} no estÃ¡ aprobado (Estado: ${payment?.status || 'indefinido'}). Ignorando.`);
                return;
            }

            if (!chatId) {
                console.warn(`[MP Webhook] Pago aprobado ${paymentId} no tiene un chatId asociado en external_reference.`);
                return;
            }

            console.log(`âœ… [MP Webhook] Procesando pago aprobado ${paymentId} para chat: ${chatId}, proyecto: ${refProjectId}`);

            // 6. Enviar mensaje de confirmaciÃ³n por WhatsApp
            const cleanChatId = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
            const isGroup = cleanChatId.includes('@g.us');
            let refServiceId = depsHistoryHandler.SERVICE_IDENTIFIER;
            try {
                const chatData = await depsHistoryHandler.getChat(chatId.split('@')[0], refProjectId);
                if (chatData?.service_id) refServiceId = chatData.service_id;
            } catch (_) {
                // Mantener fallback del servicio por defecto.
            }

            const { getAdapterProvider, getGroupProvider } = await import('../../providers/instances');
            const activeAdapter = getAdapterProvider();
            const activeGroupAdapter = getGroupProvider();

            const providerToSend = (isGroup && activeGroupAdapter) ? activeGroupAdapter : activeAdapter;

            if (!providerToSend) {
                console.error('[MP Webhook] Error: No hay proveedor de WhatsApp disponible para enviar la confirmaciÃ³n.');
                return;
            }

            const confMessage = `âœ… *Pago Aprobado*
Hemos recibido tu pago con Ã©xito.

*Detalles del pago:*
â€¢ *Concepto:* ${payment.description || 'Cobro'}
â€¢ *Monto:* $${payment.transaction_amount} ARS
â€¢ *ID de Pago:* ${paymentId}

Â¡Muchas gracias!`;

            try {
                const providerResponse = await providerToSend.sendMessage(cleanChatId, confMessage, { projectId: refProjectId, serviceId: refServiceId });
                console.log(`[MP Webhook] Mensaje enviado correctamente a ${cleanChatId}`);

                const externalId = providerResponse?.key?.id || providerResponse?.messages?.[0]?.id || providerResponse?.id || null;
                await depsHistoryHandler.saveMessage(chatId, 'assistant', confMessage, 'text', undefined, undefined, externalId, 'whatsapp', refProjectId, refServiceId);
            } catch (sendErr: any) {
                console.error('[MP Webhook] Error al enviar confirmaciÃ³n de WhatsApp:', sendErr.message);
            }

        } catch (error: any) {
            console.error('[MP Webhook] Error crÃ­tico procesando webhook:', error.response?.data || error.message);
        }
    });

    app.post('/api/backoffice/mercadopago/disconnect', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || 'default';

            // Buscar el user_id antes de borrar para limpiar ruteo
            const { data: acc } = await supabase
                .from('mercadopago_acount_user')
                .select('user_id')
                .eq('project_id', projectId)
                .maybeSingle();

            if (acc && acc.user_id) {
                await supabase.from('mercadopago_user_routoing').delete().eq('user_id', acc.user_id);
            }

            await supabase.from('mercadopago_acount_user').delete().eq('project_id', projectId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/mercadopago/create-link', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { title, amount } = req.body;
        if (!title || !amount) {
            return res.status(400).json({ success: false, error: 'TÃ­tulo y monto son requeridos.' });
        }
        try {
            const projectId = resolveProjectId(req);
            const { createMercadoPagoPreference } = await import('../../utils/mercadopago');
            const result = await createMercadoPagoPreference(title, Number(amount), 1, projectId);
            res.json({ success: true, link: result.initPoint, preferenceId: result.preferenceId });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- META SMB SYNC ---
    /**
     * Dispara la sincronizaciÃ³n de contactos o historial desde Meta SMB API.
     * Esto enviarÃ¡ webhooks smb_app_state_sync o history que son procesados por el provider.
     */
    app.post('/api/backoffice/whatsapp/sync-smb', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { type } = req.body; // 'contacts' | 'history'
        if (!['contacts', 'history'].includes(type)) {
            return res.status(400).json({ success: false, error: 'Tipo de sincronizaciÃ³n invÃ¡lido. Use "contacts" o "history".' });
        }

        try {
            // @ts-ignore
            const provider = app.get('whatsappProvider');

            if (!isMetaProvider(provider)) {
                return res.status(400).json({
                    success: false,
                    error: 'El proveedor Meta Cloud no estÃ¡ activo. Verifique que el bot estÃ© configurado con Meta.'
                });
            }

            const syncType = type === 'contacts' ? 'smb_app_state_sync' : 'history';
            console.log(`ðŸ“¡ [BACKOFFICE] Disparando sincronizaciÃ³n SMB: ${syncType}`);
            const result = await (provider as any).requestSmbSync(syncType);

            if (result) {
                res.json({
                    success: true,
                    message: `Solicitud de sincronizaciÃ³n de ${type} enviada a Meta correctamente.`,
                    data: result
                });
            } else {
                res.status(500).json({ success: false, error: 'Meta rechazÃ³ la solicitud de sincronizaciÃ³n o hubo un error de red.' });
            }
        } catch (error: any) {
            console.error('âŒ [BACKOFFICE] Error en sync-smb:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/whatsapp/groups', backofficeAuth, async (req: any, res: any) => {
        try {
            const { getGroupProvider, getAdapterProvider } = await import('../../providers/instances');

            // 1. Intentar con el proveedor de grupos (Baileys)
            const groupProvider = getGroupProvider();
            let sock: any = null;

            if (groupProvider && typeof groupProvider.getInstance === 'function') {
                sock = await groupProvider.getInstance();
            }

            // 2. Si no hay proveedor de grupos, intentar con el principal (Baileys)
            if (!sock) {
                const adapterProvider = getAdapterProvider();
                if (adapterProvider && typeof adapterProvider.getInstance === 'function') {
                    sock = await adapterProvider.getInstance();
                }
            }

            if (!sock || typeof sock.groupFetchAllParticipating !== 'function') {
                return res.status(400).json({
                    success: false,
                    error: 'No hay un proveedor de WhatsApp (Baileys) activo o conectado para listar grupos. Verifica el cÃ³digo QR en la secciÃ³n de ConexiÃ³n.'
                });
            }

            console.log('[API/Groups] Obteniendo lista de grupos de WhatsApp...');
            const chats = await sock.groupFetchAllParticipating();
            const groupsList = Object.entries(chats).map(([jid, group]: [string, any]) => ({
                id: jid,
                name: group.subject || 'Sin nombre'
            }));

            res.json({ success: true, groups: groupsList });
        } catch (error: any) {
            console.error('[API/Groups] Error al listar grupos:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- CRM ROUTES ---
    app.get('/api/backoffice/crm/tasks', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const tasks = await depsHistoryHandler.getTasksDashboard(projectId);
            res.json({ success: true, tasks });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/crm/update-lead', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { leadId, crm_status, crm_due_date } = req.body;
        if (!leadId) return res.status(400).json({ success: false, error: 'leadId is required' });

        try {
            const updateData: any = {};
            if (crm_status !== undefined) updateData.crm_status = crm_status;
            if (crm_due_date !== undefined) updateData.crm_due_date = crm_due_date;

            const { error } = await supabase
                .from('chats')
                .update(updateData)
                .eq('id', leadId)
                .eq('project_id', depsHistoryHandler.PROJECT_IDENTIFIER);

            if (error) throw error;
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Endpoint para derivar chats entre agentes (Humanos o Bot)
     */
    app.post('/api/backoffice/chat/assign', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, agentId, userId } = req.body;
        // agentId: 'asistente1', 'asistente2'... (LÃ³gica del Bot)
        // userId: uuid del usuario humano (LÃ³gica CRM)

        if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });

        try {
            console.log(`[BACKOFFICE] Reasignando chat ${chatId}: agentId=${agentId}, userId=${userId}`);

            // 1. Si se especifica un agente del bot, lo asignamos y activamos el bot
            if (agentId) {
                await depsHistoryHandler.setAssignedAgent(chatId, agentId, resolveProjectId(req) || undefined, resolveServiceId(req) || undefined);
            }

            // 2. Si se especifica un usuario humano (o se limpia con null), actualizamos assigned_to
            if (userId !== undefined) {
                await depsHistoryHandler.assignChatToUser(chatId, userId, resolveProjectId(req), resolveServiceId(req));

                // Si se asignÃ³ a un humano, desactivamos el bot automÃ¡ticamente para no interferir
                if (userId) {
                    await depsHistoryHandler.toggleBot(chatId, false, resolveProjectId(req), resolveServiceId(req));
                }
            }

            res.json({ success: true });
        } catch (error: any) {
            console.error('âŒ Error en /api/backoffice/chat/assign:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/crm/config', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req);
            const config = await depsHistoryHandler.getSetting('CRM_CONFIG', projectId);
            res.json({ success: true, config: config ? JSON.parse(config) : null });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/crm/config', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { config } = req.body;
        try {
            const projectId = resolveProjectId(req);
            await depsHistoryHandler.saveSetting('CRM_CONFIG', JSON.stringify(config), projectId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- CONFIGURACION DINAMICA (HOT-UPDATE) ---

    /**
     * Obtiene todas las variables de configuraciÃ³n mezclando el entorno (.env)
     * con la base de datos (settings), priorizando la base de datos.
     */
    app.get('/api/backoffice/config', systemConfigAuth, async (req: any, res: any) => {
        try {
            // 1. Obtener variables de Railway si es posible (como base)
            let railwayVars = {};
            try {
                const RailwayApi = (await import("../../apis/railway/Railway")).RailwayApi;
                railwayVars = await RailwayApi.getVariables() || {};
            } catch (e) {
                console.warn("[Config] No se pudieron cargar variables de Railway, usando process.env");
                railwayVars = process.env;
            }

            // 2. Obtener todas las configuraciones de la base de datos
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

            let query = supabase
                .from('settings')
                .select('key, value, service_id')
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                query = query.in('service_id', [serviceId, 'default_service']);
            }

            const { data: dbSettings, error } = await query;
            if (error) throw error;

            // 3. Mezclar: Prioridad DB > Railway/Env
            const mergedConfig: any = { ...railwayVars };
            
            // Agrupar para dar prioridad al servicio especÃ­fico
            const selectedSettings: Record<string, any> = {};
            const settingOrigins: Record<string, string> = {};

            dbSettings?.forEach((s: any) => {
                if (s.value !== null && s.value !== undefined) {
                    let val = s.value;
                    if ((s.key === 'ADMIN_USER' || s.key === 'ADMIN_PASS') && typeof val === 'string' && val.startsWith('b64:')) {
                        try {
                            val = Buffer.from(val.slice(4), 'base64').toString('utf-8');
                        } catch (_e) { /* intentional */ }
                    }
                    
                    const existingOrigin = settingOrigins[s.key];
                    if (!existingOrigin) {
                        selectedSettings[s.key] = val;
                        settingOrigins[s.key] = s.service_id || 'default_service';
                    } else {
                        if (existingOrigin === 'default_service' && s.service_id !== 'default_service') {
                            selectedSettings[s.key] = val;
                            settingOrigins[s.key] = s.service_id;
                        }
                    }
                }
            });

            // Aplicar la selecciÃ³n final sobre la configuraciÃ³n mezclada
            Object.keys(selectedSettings).forEach(k => {
                mergedConfig[k] = selectedSettings[k];
            });

            res.json({ success: true, variables: mergedConfig });
        } catch (error: any) {
            console.error('Error al obtener configuraciÃ³n:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Guarda mÃºltiples configuraciones en la base de datos sin reiniciar el bot.
     */
    app.post('/api/backoffice/save-settings-bulk', systemConfigAuth, bodyParser.json(), async (req: any, res: any) => {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, error: 'settings object is required' });
        }

        try {
            const keys = Object.keys(settings);
            const PROTECTED_KEYS = ['OPENAI_ADMIN_API_KEY', 'OPENAI_API_KEY_TOOLS'];
            const keysToSave = keys.filter(k => !PROTECTED_KEYS.includes(k));

            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            console.log(`ðŸ“¡ [HOT-UPDATE] Guardando ${keysToSave.length} variables en la base de datos para proyecto ${projectId} (Servicio: ${serviceId})...`);

            const promises = keysToSave.map(key => {
                let val = settings[key];
                if ((key === 'ADMIN_USER' || key === 'ADMIN_PASS') && val) {
                    val = 'b64:' + Buffer.from(val).toString('base64');
                }
                return depsHistoryHandler.saveSetting(key, val, projectId, serviceId);
            });
            await Promise.all(promises);

            // Si se actualizaron credenciales de acceso, invalida el cache del middleware de auth
            const credentialKeys = ['ADMIN_PASS', 'ADMIN_USER'];
            if (keysToSave.some(k => credentialKeys.includes(k))) {
                invalidateAuthCache();
                console.log('[HOT-UPDATE] Credenciales actualizadas â€” cache de auth invalidado.');
            }

            res.json({ success: true, message: `${keysToSave.length} variables guardadas (se omitieron ${keys.length - keysToSave.length} protegidas)` });
        } catch (error: any) {
            console.error('Error al guardar settings bulk:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/project-services', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const services = await depsHistoryHandler.getAllProjectServices(projectId);
            
            const { data: slugData } = await supabase
                .from('settings')
                .select('service_id, key, value')
                .eq('project_id', projectId)
                .in('key', ['CLIENT_SLUG', 'BOT_NAME', 'PHONE_NUMBER_ID']);
            
            const serviceMetadata: Record<string, any> = {};
            services.forEach(s => {
                serviceMetadata[s] = {
                    id: s,
                    name: s === 'default_service' ? 'Servicio Principal' : s,
                    phone: ''
                };
            });
            
            slugData?.forEach((item: any) => {
                const sId = item.service_id || 'default_service';
                if (!serviceMetadata[sId]) {
                    serviceMetadata[sId] = { id: sId, name: sId, phone: '' };
                }
                if (item.key === 'CLIENT_SLUG' || item.key === 'BOT_NAME') {
                    serviceMetadata[sId].name = item.value;
                } else if (item.key === 'PHONE_NUMBER_ID') {
                    serviceMetadata[sId].phone = item.value;
                }
            });
            
            res.json({ success: true, services: Object.values(serviceMetadata) });
        } catch (error: any) {
            console.error('Error al obtener servicios del proyecto:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/settings', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            
            let query = supabase
                .from('settings')
                .select('key, value, service_id')
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                query = query.in('service_id', [serviceId, 'default_service']);
            }

            const { data: dbSettings, error } = await query;
            if (error) throw error;
            
            // Agrupar por key para dar prioridad al servicio especÃ­fico
            const selectedSettings: Record<string, string> = {};
            const settingOrigins: Record<string, string> = {};
            
            dbSettings?.forEach((s: any) => {
                const existingOrigin = settingOrigins[s.key];
                let val = s.value;
                if ((s.key === 'ADMIN_USER' || s.key === 'ADMIN_PASS') && typeof val === 'string' && val.startsWith('b64:')) {
                    try {
                        val = Buffer.from(val.slice(4), 'base64').toString('utf-8');
                    } catch (_e) { /* intentional */ }
                }
                
                if (!existingOrigin) {
                    selectedSettings[s.key] = val;
                    settingOrigins[s.key] = s.service_id || 'default_service';
                } else {
                    if (existingOrigin === 'default_service' && s.service_id !== 'default_service') {
                        selectedSettings[s.key] = val;
                        settingOrigins[s.key] = s.service_id;
                    }
                }
            });
            res.json(selectedSettings);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- GET STORED PROMPT ---
    app.get('/api/backoffice/get-prompt', systemConfigAuth, async (req: any, res: any) => {
        try {
            const index = req.query.index || '1';
            const settingKey = index === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${index}`;
            const envKey = index === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${index}`;

            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const prompt = await depsHistoryHandler.getSetting(settingKey, projectId, serviceId);
            const assistantId = await depsHistoryHandler.getConfig(envKey, projectId, serviceId) || process.env[envKey] || '';
            res.json({
                success: true,
                prompt: prompt || '',
                assistantId: assistantId
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- GET AVAILABLE OPENAI MODELS ---
    app.get('/api/backoffice/openai/models', systemConfigAuth, async (req: any, res: any) => {
        try {
            const { getOpenAI } = await import("../../apis/openai/openaiHelper");
            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            const dynamicOpenAI = await getOpenAI(projectId || undefined, serviceId || undefined);

            let models: string[] = [];

            if (dynamicOpenAI) {
                try {
                    const list = await dynamicOpenAI.models.list();
                    models = list.data
                        .map((m: any) => m.id)
                        .filter((id: string) => {
                            const cleanId = id.toLowerCase();
                            // Excluir embeddings, audio, imÃ¡genes, moderaciones, etc.
                            if (
                                cleanId.includes('embed') ||
                                cleanId.includes('whisper') ||
                                cleanId.includes('tts') ||
                                cleanId.includes('dall-e') ||
                                cleanId.includes('moderation') ||
                                cleanId.includes('instruct') ||
                                cleanId.includes('search') ||
                                cleanId.includes('realtime') ||
                                cleanId.includes('babbage') ||
                                cleanId.includes('davinci')
                            ) {
                                return false;
                            }
                            // Solo incluir gpt y modelos de razonamiento (o1, o3, etc.)
                            return cleanId.startsWith('gpt-') || cleanId.startsWith('o1-') || cleanId.startsWith('o3-') || cleanId.includes('chatgpt');
                        });
                } catch (apiErr: any) {
                    console.warn(`[OpenAI Models API] Error al listar modelos desde OpenAI: ${apiErr.message}. Usando fallbacks.`);
                }
            }

            // Fallbacks si la API no devuelve nada o no hay API Key configurada
            if (models.length === 0) {
                models = ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o3-mini', 'gpt-4', 'gpt-3.5-turbo'];
            }

            // Eliminar duplicados y ordenar
            models = Array.from(new Set(models)).sort();

            res.json({ success: true, models });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- UPDATE PROMPT WITHOUT RESTART ---
    app.post('/api/backoffice/update-prompt', systemConfigAuth, bodyParser.json(), async (req: any, res: any) => {
        const { prompt, index } = req.body;
        const idx = index || '1';
        if (prompt === undefined) return res.status(400).json({ success: false, error: 'prompt is required' });

        try {
            const settingKey = idx === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${idx}`;
            const envKey = idx === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${idx}`;

            const projectId = resolveProjectId(req);
            const serviceId = resolveServiceId(req);
            // Prioridad: 1. DB, 2. Env
            const assistantId = await depsHistoryHandler.getConfig(envKey, projectId, serviceId) || process.env[envKey];

            console.log(`ðŸ“¡ [HOT-UPDATE] Actualizando prompt para Asistente ${idx} en base de datos para proyecto ${projectId}...`);
            await depsHistoryHandler.saveSetting(settingKey, prompt, projectId, serviceId);

            // Sincronizar hacia OpenAI (Empujar cambio al dashboard de OpenAI)
            const { getOpenAI } = await import("../../apis/openai/openaiHelper");
            const dynamicOpenAI = await getOpenAI(projectId || undefined, serviceId || undefined);

            if (assistantId && dynamicOpenAI) {
                try {
                    console.log(`ðŸ“¡ [SYNC] Empujando nuevo prompt hacia OpenAI Assistant: ${assistantId}`);
                    await dynamicOpenAI.beta.assistants.update(assistantId, {
                        instructions: prompt
                    });

                    // CRITICAL FIX: DespuÃ©s de actualizar instrucciones, volvemos a sincronizar las tools
                    // para evitar que queden vacÃ­as si el update sobreescribiÃ³ el objeto.
                    const { syncAssistantTools } = await import("../../apis/openai/openaiHelper");
                    await syncAssistantTools(assistantId, projectId, serviceId);

                    console.log(`âœ… [SYNC] Prompt y Herramientas de Asistente ${idx} actualizados en OpenAI exitosamente.`);
                } catch (apiError: any) {
                    console.error(`âš ï¸ [HOT-UPDATE-SYNC-ERROR] FallÃ³ sincronizaciÃ³n con OpenAI para ${assistantId}:`, apiError.message);
                }
            } else if (!dynamicOpenAI) {
                console.warn(`âš ï¸ [HOT-UPDATE] No se pudo obtener instancia de OpenAI. El prompt se guardÃ³ solo localmente.`);
            }

            res.json({
                success: true,
                message: `Prompt de Asistente ${idx} actualizado correctamente en local y en OpenAI (Hot-update)`
            });
        } catch (error: any) {
            console.error('Error updating prompt and syncing to OpenAI:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- GET README / INSTRUCTIONS ---
    app.get('/api/backoffice/get-docs', backofficeAuth, async (req: any, res: any) => {
        try {
            let docType = 'INSTRUCCIONES_USO.md';
            if (req.query.type === 'api' || req.query.type === 'api_templates') {
                docType = 'INSTRUCCIONES_API_PLANTILLAS.md';
            } else if (req.query.type === 'api_envio_recepcion') {
                docType = 'INSTRUCCIONES_API_ENVIO_RECEPCION.md';
            } else if (req.query.type === 'webhook') {
                docType = 'INSTRUCCIONES_WEBHOOK.md';
            } else if (req.query.type === 'connect' || req.query.type === 'connet' || req.query.type === 'api_connect') {
                docType = 'INSTRUCCIONES_CONNECT.md';
            }
            const rootDir = process.cwd();
            const docsPath = path.join(rootDir, 'docs', docType);
            const distDocsPath = path.join(rootDir, 'dist', 'docs', docType);
            const altPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', 'docs', docType);

            console.log(`ðŸ“‚ [Docs] Buscando (${docType}) en: ${docsPath}, ${distDocsPath}, ${altPath}`);

            let content = '';
            if (fs.existsSync(docsPath)) {
                content = fs.readFileSync(docsPath, 'utf8');
            } else if (fs.existsSync(distDocsPath)) {
                content = fs.readFileSync(distDocsPath, 'utf8');
            } else if (fs.existsSync(altPath)) {
                content = fs.readFileSync(altPath, 'utf8');
            }

            if (content) {
                return res.json({ success: true, content });
            } else {
                return res.status(404).json({ success: false, error: `Archivo no encontrado. Intentado en: ${docsPath} y rutas alternativas.` });
            }
        } catch (error: any) {
            console.error('âŒ [Docs] Error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // LISTA NEGRA
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** GET /api/backoffice/blacklist/status â€” Â¿EstÃ¡ activa la integraciÃ³n? */
    app.get('/api/backoffice/blacklist/status', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const active = await depsHistoryHandler.getSetting('BLACKLIST_ACTIVE', projectId, serviceId);
            res.json({ active: active === 'true' });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist/activate â€” Activa la lista negra */
    app.post('/api/backoffice/blacklist/activate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            await depsHistoryHandler.saveSetting('BLACKLIST_ACTIVE', 'true', projectId, serviceId && serviceId !== 'default' && serviceId !== 'default_service' ? serviceId : null);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist/deactivate â€” Desactiva y elimina todos los registros */
    app.post('/api/backoffice/blacklist/deactivate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            // 1. Eliminar todas las entradas de blacklist del proyecto/servicio
            let blQuery = supabase
                .from('blacklist')
                .delete()
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                blQuery = blQuery.eq('service_id', serviceId);
            }

            const { error: delErr } = await blQuery;
            if (delErr) throw delErr;
            // 2. Desactivar el setting
            await depsHistoryHandler.saveSetting('BLACKLIST_ACTIVE', 'false', projectId, serviceId && serviceId !== 'default' && serviceId !== 'default_service' ? serviceId : null);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/blacklist â€” Lista todas las entradas del proyecto */
    app.get('/api/backoffice/blacklist', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            let blQuery = supabase
                .from('blacklist')
                .select('chat_id, sin_bot, bloqueado_crm, notes, updated_at')
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                blQuery = blQuery.eq('service_id', serviceId);
            }

            const { data, error } = await blQuery.order('updated_at', { ascending: false });
            if (error) throw error;
            // Enriquecer con nombre del contacto desde chats
            const chatIds = (data || []).map((r: any) => r.chat_id);
            const chatNames: Record<string, string> = {};
            if (chatIds.length > 0) {
                const extendedChatIds = new Set<string>();
                chatIds.forEach(id => {
                    const norm = depsHistoryHandler.normalizeId(id);
                    extendedChatIds.add(id);
                    extendedChatIds.add(norm);
                    if (norm.startsWith('54')) {
                        if (norm.startsWith('549')) {
                            extendedChatIds.add('54' + norm.slice(3));
                        } else {
                            extendedChatIds.add('549' + norm.slice(2));
                        }
                    }
                });

                let chatQuery = supabase
                    .from('chats')
                    .select('id, name')
                    .in('id', Array.from(extendedChatIds))
                    .eq('project_id', projectId);

                if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                    chatQuery = chatQuery.eq('service_id', serviceId);
                }

                const { data: chatRows } = await chatQuery;
                (chatRows || []).forEach((c: any) => {
                    const normCId = depsHistoryHandler.normalizeId(c.id);
                    chatNames[c.id] = c.name || c.id;
                    chatNames[normCId] = c.name || c.id;
                    if (normCId.startsWith('54')) {
                        if (normCId.startsWith('549')) {
                            chatNames['54' + normCId.slice(3)] = c.name || c.id;
                        } else {
                            chatNames['549' + normCId.slice(2)] = c.name || c.id;
                        }
                    }
                });
            }
            const enriched = (data || []).map((r: any) => {
                const normRId = depsHistoryHandler.normalizeId(r.chat_id);
                return {
                    ...r,
                    name: chatNames[r.chat_id] || chatNames[normRId] || r.chat_id
                };
            });
            res.json(enriched);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist — Upsert de una entrada */
    app.post('/api/backoffice/blacklist', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { chat_id, sin_bot, bloqueado_crm, notes } = req.body;
            if (!chat_id) return res.status(400).json({ success: false, error: 'chat_id requerido' });
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

            const upsertData: any = {
                chat_id,
                project_id: projectId,
                sin_bot: !!sin_bot,
                bloqueado_crm: !!bloqueado_crm,
                notes: notes || '',
                updated_at: new Date().toISOString()
            };
            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                upsertData.service_id = serviceId;
            }

            const { error } = await supabase
                .from('blacklist')
                .upsert(upsertData, { onConflict: 'chat_id,project_id' });
            if (error) throw error;

            if (sin_bot || bloqueado_crm) {
                await depsHistoryHandler.toggleBot(chat_id, false, projectId, serviceId);
            }

            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** DELETE /api/backoffice/blacklist/:chatId — Elimina una entrada */
    app.delete('/api/backoffice/blacklist/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const chatId = req.params.chatId;
            const possibleIds = depsHistoryHandler.getPossibleJids(chatId);

            let query = supabase
                .from('blacklist')
                .delete()
                .in('chat_id', possibleIds)
                .eq('project_id', projectId);

            if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                query = query.eq('service_id', serviceId);
            }

            const { error } = await query;
            if (error) throw error;
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/blacklist/check/:chatId — Verifica si un chat está en lista negra */
    app.get('/api/backoffice/blacklist/check/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const chatId = req.params.chatId;

            const isBlocked = await depsHistoryHandler.isContactBlacklisted(chatId, projectId, serviceId);
            res.json({ inBlacklist: isBlocked, sin_bot: isBlocked, bloqueado_crm: false });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist/toggle/:chatId — Agrega o quita de lista negra (toggle rápido desde header) */
    app.post('/api/backoffice/blacklist/toggle/:chatId', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const chatId = req.params.chatId;
            const { inBlacklist } = req.body;

            if (inBlacklist) {
                // Agregar con sin_bot=true por defecto
                const upsertData: any = {
                    chat_id: chatId,
                    project_id: projectId,
                    sin_bot: true,
                    bloqueado_crm: false,
                    notes: '',
                    updated_at: new Date().toISOString()
                };
                if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                    upsertData.service_id = serviceId;
                }

                const { error } = await supabase
                    .from('blacklist')
                    .upsert(upsertData, { onConflict: 'chat_id,project_id' });
                if (error) throw error;

                // Desactivar el bot inmediatamente para este contacto
                await depsHistoryHandler.toggleBot(chatId, false, projectId, serviceId);
            } else {
                // Quitar de la lista
                const possibleIds = depsHistoryHandler.getPossibleJids(chatId);

                let query = supabase
                    .from('blacklist')
                    .delete()
                    .in('chat_id', possibleIds)
                    .eq('project_id', projectId);

                if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
                    query = query.eq('service_id', serviceId);
                }

                const { error } = await query;
                if (error) throw error;
            }
            res.json({ success: true, inBlacklist });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // NOTIFICACIONES
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** GET /api/backoffice/notifications/status â€” Â¿EstÃ¡ activa la integraciÃ³n? */
    app.get('/api/backoffice/notifications/status', backofficeAuth, async (req: any, res: any) => {
        try {
            res.json({ active: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/notifications/activate â€” Activa la integraciÃ³n de notificaciones */
    app.post('/api/backoffice/notifications/activate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            await depsHistoryHandler.saveSetting('NOTIFICATIONS_ACTIVE', 'true', projectId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/notifications/deactivate â€” Desactiva la integraciÃ³n y resetea contadores */
    app.post('/api/backoffice/notifications/deactivate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            // 1. Resetear todos los unread_count de chats a 0
            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                const chats = LocalHistoryStore.getChats(projectId);
                chats.forEach(c => c.unread_count = 0);
                LocalHistoryStore.saveChats(projectId, chats);
            } else {
                const { error: resetErr } = await supabase
                    .from('chats')
                    .update({ unread_count: 0 })
                    .eq('project_id', projectId);
                if (resetErr) throw resetErr;
            }
            // 2. Guardar setting como false
            await depsHistoryHandler.saveSetting('NOTIFICATIONS_ACTIVE', 'false', projectId);

            // Notificar a clientes conectados que la integraciÃ³n se desactivÃ³ para limpiar badges
            historyEvents.emit('notifications_deactivated', { projectId });

            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/notifications — Obtener notificaciones del sistema paginadas */
    app.get('/api/backoffice/notifications', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;

            const notifications = await depsHistoryHandler.getSystemNotifications(projectId, serviceId, limit, offset);
            const totalUnread = await depsHistoryHandler.getUnreadNotificationsCount(projectId, serviceId);

            res.json({
                success: true,
                data: notifications,
                unread_count: totalUnread
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/notifications/read — Marcar notificaciones como leídas */
    app.post('/api/backoffice/notifications/read', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            const { ids } = req.body;

            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ success: false, error: 'Se requiere una lista de IDs válida.' });
            }

            const ok = await depsHistoryHandler.markNotificationsAsRead(projectId, serviceId, ids);
            let unread_notifications_count = 0;
            if (ok) {
                unread_notifications_count = await depsHistoryHandler.getUnreadNotificationsCount(projectId, serviceId);
            }
            res.json({ success: ok, unread_notifications_count });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // API BASE DE DATOS Y RAG (INTEGRACIONES)
    // ─────────────────────────────────────────────────────────────

    /** GET /api/backoffice/database/settings — Obtener configuraciones del bot (si tiene sheets o docs) */
    app.get('/api/backoffice/database/settings', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            const visibleServices = await getVisibleServiceIds(projectId, serviceId);
            
            let hasTables = false;
            let hasRag = false;
            
            for (const sId of visibleServices) {
                const hasSheetsSetting = await depsHistoryHandler.getSetting('SHEET_ID_UPDATE', projectId, sId);
                const hasDocsSetting = await depsHistoryHandler.getSetting('DOCX_ID_UPDATE', projectId, sId);
                if (hasSheetsSetting && hasSheetsSetting !== 'default' && hasSheetsSetting !== 'PENDING') {
                    hasTables = true;
                }
                if (hasDocsSetting && hasDocsSetting !== 'default' && hasDocsSetting !== 'PENDING') {
                    hasRag = true;
                }
            }

            const isSuperAdmin = await depsHistoryHandler.getSetting('SUPER_ADMIN_MODE', projectId, serviceId, true);

            res.json({
                success: true,
                hasTables,
                hasRag,
                isSuperAdmin: isSuperAdmin === 'true'
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/database/tables — Obtener lista de tablas vinculadas al proyecto/servicio */
    app.get('/api/backoffice/database/tables', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            const visibleServices = await getVisibleServiceIds(projectId, serviceId);

            const { getTablesMetadata } = await import('../utils/databaseSync.js');
            
            let allTables: any[] = [];
            for (const sId of visibleServices) {
                const tables = await getTablesMetadata(projectId, sId);
                tables.forEach((t: any) => {
                    t.serviceId = sId;
                });
                allTables = allTables.concat(tables);
            }

            res.json({
                success: true,
                tables: allTables
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/database/table/:tableName — Obtener filas de una tabla específica */
    app.get('/api/backoffice/database/table/:tableName', backofficeAuth, async (req: any, res: any) => {
        try {
            const { tableName } = req.params;

            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .order('created_at', { ascending: true });

            if (error) throw error;

            res.json({
                success: true,
                data
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/database/table/:tableName/row — Agregar fila en base de datos y Google Sheet */
    app.post('/api/backoffice/database/table/:tableName/row', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const { tableName } = req.params;
            const rowData = req.body.row;
            const { sheetId, sheetTitle, headers } = req.body;

            if (!rowData || !sheetId || !sheetTitle || !headers) {
                return res.status(400).json({ success: false, error: 'Parámetros incompletos.' });
            }

            // 1. Insertar en Supabase
            const { error: insError } = await supabase
                .from(tableName)
                .insert(rowData);

            if (insError) throw insError;

            // 2. Sincronizar hacia Google Sheets
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const { syncTableToGoogleSheet } = await import('../utils/databaseSync.js');
            await syncTableToGoogleSheet(tableName, sheetId, sheetTitle, headers, projectId, serviceId);

            res.json({ success: true });
        } catch (e: any) {
            console.error('[DB-Sync] Error insertando fila:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** PUT /api/backoffice/database/table/:tableName/row/:id — Editar fila en base de datos y Google Sheet */
    app.put('/api/backoffice/database/table/:tableName/row/:id', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const { tableName, id } = req.params;
            const rowData = req.body.row;
            const { sheetId, sheetTitle, headers } = req.body;

            if (!rowData || !sheetId || !sheetTitle || !headers) {
                return res.status(400).json({ success: false, error: 'Parámetros incompletos.' });
            }

            // 1. Actualizar en Supabase
            const { error: updError } = await supabase
                .from(tableName)
                .update(rowData)
                .eq('id', id);

            if (updError) throw updError;

            // 2. Sincronizar hacia Google Sheets
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const { syncTableToGoogleSheet } = await import('../utils/databaseSync.js');
            await syncTableToGoogleSheet(tableName, sheetId, sheetTitle, headers, projectId, serviceId);

            res.json({ success: true });
        } catch (e: any) {
            console.error('[DB-Sync] Error actualizando fila:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** DELETE /api/backoffice/database/table/:tableName/rows — Eliminar una o más filas en base de datos y Google Sheet */
    app.delete('/api/backoffice/database/table/:tableName/rows', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const { tableName } = req.params;
            const { ids, sheetId, sheetTitle, headers } = req.body;

            if (!Array.isArray(ids) || ids.length === 0 || !sheetId || !sheetTitle || !headers) {
                return res.status(400).json({ success: false, error: 'Parámetros de eliminación incompletos.' });
            }

            // 1. Eliminar en Supabase
            const { error: delError } = await supabase
                .from(tableName)
                .delete()
                .in('id', ids);

            if (delError) throw delError;

            // 2. Sincronizar hacia Google Sheets
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const { syncTableToGoogleSheet } = await import('../utils/databaseSync.js');
            await syncTableToGoogleSheet(tableName, sheetId, sheetTitle, headers, projectId, serviceId);

            res.json({ success: true });
        } catch (e: any) {
            console.error('[DB-Sync] Error eliminando filas:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/database/rag — Obtener metadatos de documentos RAG vinculados */
    app.get('/api/backoffice/database/rag', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            const visibleServices = await getVisibleServiceIds(projectId, serviceId);

            const { getRagDocsMetadata } = await import('../utils/databaseSync.js');
            
            let allDocs: any[] = [];
            for (const sId of visibleServices) {
                const docs = await getRagDocsMetadata(projectId, sId);
                docs.forEach((d: any) => {
                    d.serviceId = sId;
                });
                allDocs = allDocs.concat(docs);
            }

            res.json({
                success: true,
                docs: allDocs
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/database/rag/:docId — Obtener texto de un documento RAG de Google Drive */
    app.get('/api/backoffice/database/rag/:docId', backofficeAuth, async (req: any, res: any) => {
        try {
            const { docId } = req.params;
            const { getDriveDocText } = await import('../utils/databaseSync.js');
            const text = await getDriveDocText(docId);

            res.json({
                success: true,
                text
            });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** PUT /api/backoffice/database/rag/:docId — Guardar texto modificado en Drive y re-indexar RAG */
    app.put('/api/backoffice/database/rag/:docId', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req);
            const { docId } = req.params;
            const { text } = req.body;

            if (text === undefined) {
                return res.status(400).json({ success: false, error: 'Se requiere el contenido de texto.' });
            }

            const { saveDriveDocText } = await import('../utils/databaseSync.js');
            await saveDriveDocText(docId, text, projectId, serviceId);

            res.json({ success: true });
        } catch (e: any) {
            console.error('[DB-Sync] Error actualizando documento RAG:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // REPORTES BOT
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** GET /api/backoffice/reportes/status */
    app.get('/api/backoffice/reportes/status', backofficeAuth, async (req: any, res: any) => {
        try {
            res.json({ success: true, active: true, native: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/reportes/activate */
    app.post('/api/backoffice/reportes/activate', backofficeAuth, async (req: any, res: any) => {
        try {
            res.json({ success: true, active: true, native: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/reportes/deactivate */
    app.post('/api/backoffice/reportes/deactivate', backofficeAuth, async (req: any, res: any) => {
        try {
            res.json({ success: true, active: true, native: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/reportes â€” Lista reportes del bot (tickets tipo Nuevo Lead) para este proyecto */
    app.get('/api/backoffice/reportes', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
            const { data, error } = await supabase
                .from('tickets')
                .select('id, chat_id, titulo, tipo, descripcion, created_at, updated_at')
                .eq('project_id', projectId)
                .eq('tipo', 'Nuevo Lead')
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            const reportes = (data || []).map((t: any) => ({
                ...t,
                nombre: t.titulo,
                descripcion: getLatestLeadReportDescription(t.descripcion)
            }));
            res.json({ success: true, reportes });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/reportes/export â€” Exporta solo tickets tipo Nuevo Lead */
    app.get('/api/backoffice/reportes/export', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

            let query = supabase
                .from('tickets')
                .select('id, chat_id, titulo, tipo, estado, prioridad, descripcion, created_at, updated_at, service_id')
                .eq('project_id', projectId)
                .eq('tipo', 'Nuevo Lead')
                .order('created_at', { ascending: false });

            if (serviceId && serviceId !== 'default_service') {
                query = query.or(`service_id.eq.${serviceId},service_id.eq.default_service,service_id.is.null`);
            }

            const { data, error } = await query;
            if (error) throw error;

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'Bot-RialWay';
            workbook.created = new Date();
            workbook.modified = new Date();

            const sheet = workbook.addWorksheet('Reportes de Leads', {
                views: [{ state: 'frozen', ySplit: 1 }]
            });

            sheet.columns = [
                { header: 'Fecha creacion', key: 'created_at', width: 22 },
                { header: 'Ultima actualizacion', key: 'updated_at', width: 22 },
                { header: 'Tipo', key: 'tipo', width: 16 },
                { header: 'Estado', key: 'estado', width: 18 },
                { header: 'Prioridad', key: 'prioridad', width: 14 },
                { header: 'Lead / Nombre', key: 'titulo', width: 32 },
                { header: 'Telefono', key: 'telefono', width: 18 },
                { header: 'Resumen / Descripcion', key: 'descripcion', width: 90 }
            ];

            const headerRow = sheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C81' } };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            headerRow.height = 24;

            (data || []).forEach((ticket: any) => {
                const chatId = ticket.chat_id || '';
                const phone = String(chatId).replace(/\D/g, '');
                const row = sheet.addRow({
                    created_at: ticket.created_at ? new Date(ticket.created_at) : '',
                    updated_at: ticket.updated_at ? new Date(ticket.updated_at) : '',
                    tipo: ticket.tipo || '',
                    estado: ticket.estado || '',
                    prioridad: ticket.prioridad || '',
                    titulo: ticket.titulo || chatId || 'Sin nombre',
                    telefono: phone,
                    descripcion: getLatestLeadReportDescription(ticket.descripcion)
                });
                row.alignment = { vertical: 'top', wrapText: true };
            });

            sheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: sheet.columnCount }
            };

            sheet.eachRow((row, rowNumber) => {
                row.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFD7DEE8' } },
                        left: { style: 'thin', color: { argb: 'FFD7DEE8' } },
                        bottom: { style: 'thin', color: { argb: 'FFD7DEE8' } },
                        right: { style: 'thin', color: { argb: 'FFD7DEE8' } }
                    };
                    if (rowNumber > 1) {
                        cell.alignment = { vertical: 'top', wrapText: true };
                    }
                });
            });

            sheet.getColumn('created_at').numFmt = 'dd/mm/yyyy hh:mm';
            sheet.getColumn('updated_at').numFmt = 'dd/mm/yyyy hh:mm';

            const buffer = await workbook.xlsx.writeBuffer();
            const filename = `reportes_nuevo_lead_${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.end(Buffer.from(buffer));
        } catch (e: any) {
            console.error('[Reportes] Error exportando XLSX:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });


    /** GET /api/backoffice/waba-groups/capability */
    app.get('/api/backoffice/waba-groups/capability', backofficeAuth, async (req: any, res: any) => {
        const isPresentMetaValue = (value: any): boolean => {
            if (value === null || value === undefined) return false;
            const normalized = String(value).trim();
            return normalized.length > 0 && normalized.toUpperCase() !== 'PENDING';
        };

        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const metaConfig = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);

            const whatsappToken = metaConfig?.whatsappToken || metaConfig?.access_token;
            const whatsappNumberId = metaConfig?.whatsappNumberId || metaConfig?.phone_number_id;
            const wabaId = metaConfig?.whatsappBusinessId || metaConfig?.waba_id;
            const metaLinked = isPresentMetaValue(wabaId) && isPresentMetaValue(whatsappNumberId) && isPresentMetaValue(whatsappToken);

            if (!metaLinked) {
                return res.json({
                    success: true,
                    metaLinked: false,
                    groupsEligible: false,
                    reason: 'META_NOT_LINKED'
                });
            }

            try {
                await axios.get(`https://graph.facebook.com/v25.0/${whatsappNumberId}/groups`, {
                    params: { limit: 1 },
                    timeout: 7000,
                    headers: { Authorization: `Bearer ${whatsappToken}` }
                });

                return res.json({
                    success: true,
                    metaLinked: true,
                    groupsEligible: true,
                    reason: 'GROUPS_API_AVAILABLE'
                });
            } catch (err: any) {
                const metaError = err.response?.data?.error;
                const metaCode = metaError?.code || null;
                const metaMessage = metaError?.message || err.message || 'No se pudo validar Groups API.';

                return res.json({
                    success: true,
                    metaLinked: true,
                    groupsEligible: false,
                    reason: metaCode === 131215 ? 'PHONE_NOT_ELIGIBLE' : 'GROUPS_API_UNAVAILABLE',
                    metaCode,
                    metaMessage
                });
            }
        } catch (e: any) {
            console.error('[WabaGroups] Error verificando capacidad Groups API:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /** GET /api/backoffice/waba-groups/status */
    app.get('/api/backoffice/waba-groups/status', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            const active = await depsHistoryHandler.getSetting('META_GROUP_REPORTS_ENABLED', projectId, serviceId);
            res.json({ success: true, active: active === 'true' });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/waba-groups/status */
    app.post('/api/backoffice/waba-groups/status', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { active } = req.body;
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;
            await depsHistoryHandler.saveSetting('META_GROUP_REPORTS_ENABLED', active ? 'true' : 'false', projectId, serviceId);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/waba-groups */
    app.get('/api/backoffice/waba-groups', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const groups = await depsHistoryHandler.getWabaReportGroups(projectId);
            res.json({ success: true, groups });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/waba-groups */
    app.post('/api/backoffice/waba-groups', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { id, name, contacts } = req.body;
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

            if (!name) {
                return res.status(400).json({ success: false, error: 'El nombre del grupo es obligatorio.' });
            }
            if (!Array.isArray(contacts)) {
                return res.status(400).json({ success: false, error: 'Los contactos deben ser un array.' });
            }
            if (contacts.length > 8) {
                return res.status(400).json({ success: false, error: 'Un grupo no puede tener mÃ¡s de 8 contactos.' });
            }

            // Helpers para envÃ­o de invitaciÃ³n y creaciÃ³n en Meta
            const sendDirectWabaMessage = async (phone: string, text: string, whatsappNumberId: string, whatsappToken: string) => {
                const cleanNumber = phone.replace(/\D/g, '');
                let toFormat = cleanNumber;
                if (cleanNumber.startsWith('54')) {
                    if (cleanNumber.length === 12 && !cleanNumber.startsWith('549')) {
                        toFormat = '549' + cleanNumber.slice(2);
                    }
                }
                const url = `https://graph.facebook.com/v25.0/${whatsappNumberId}/messages`;
                console.log(`[MetaGroupsAPI] Enviando mensaje de invitaciÃ³n a +${toFormat}...`);
                try {
                    const resMsg = await axios.post(url, {
                        messaging_product: "whatsapp",
                        recipient_type: "individual",
                        to: toFormat,
                        type: "text",
                        text: { body: text }
                    }, {
                        headers: {
                            'Authorization': `Bearer ${whatsappToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    console.log(`[MetaGroupsAPI] Mensaje de invitaciÃ³n enviado con Ã©xito a +${toFormat}. ID: ${resMsg.data.messages?.[0]?.id || 'unknown'}`);
                    return true;
                } catch (err: any) {
                    console.error(`[MetaGroupsAPI] Error al enviar invitaciÃ³n a +${toFormat}:`, err.response?.data || err.message);
                    return false;
                }
            };

            const attemptCreateMetaWabaGroup = async (groupName: string, groupContacts: any[], metaConfig: any) => {
                const { whatsappToken, whatsappNumberId } = metaConfig;
                if (!whatsappToken || !whatsappNumberId) {
                    throw new Error('Faltan credenciales de Meta (whatsappToken o whatsappNumberId).');
                }

                console.log(`[MetaGroupsAPI] Intentando crear grupo Meta WABA '${groupName}'...`);
                const createUrl = `https://graph.facebook.com/v25.0/${whatsappNumberId}/groups`;

                let groupId: string;
                try {
                    const resCreate = await axios.post(createUrl, {
                        messaging_product: 'whatsapp',
                        subject: groupName
                    }, {
                        headers: {
                            'Authorization': `Bearer ${whatsappToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    groupId = resCreate.data.id;
                    console.log(`[MetaGroupsAPI] Grupo creado con Ã©xito en Meta WABA. ID: ${groupId}`);
                } catch (err: any) {
                    console.error(`[MetaGroupsAPI] Error al crear grupo en Meta WABA:`, err.response?.data || err.message);
                    throw err;
                }

                // Obtener enlace de invitaciÃ³n
                console.log(`[MetaGroupsAPI] Solicitando enlace de invitaciÃ³n para el grupo ${groupId}...`);
                const inviteUrl = `https://graph.facebook.com/v25.0/${groupId}/invite_link`;
                let inviteLink: string;
                try {
                    const resInvite = await axios.post(inviteUrl, {
                        messaging_product: 'whatsapp'
                    }, {
                        headers: {
                            'Authorization': `Bearer ${whatsappToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    inviteLink = resInvite.data.invite_link;
                    console.log(`[MetaGroupsAPI] Enlace de invitaciÃ³n obtenido para el grupo ${groupId}: ${inviteLink}`);
                } catch (err: any) {
                    console.error(`[MetaGroupsAPI] Error al obtener el enlace de invitaciÃ³n para ${groupId}:`, err.response?.data || err.message);
                    throw err;
                }

                // Enviar invitaciones
                if (groupContacts.length > 0) {
                    console.log(`[MetaGroupsAPI] Enviando invitaciones a ${groupContacts.length} contactos...`);
                    const inviteMessage = `Â¡Hola! Te invitamos a unirte al grupo oficial de reportes de RialWay *"${groupName}"*. Para unirte, haz clic en el siguiente enlace de invitaciÃ³n: ${inviteLink}`;

                    for (const contact of groupContacts) {
                        if (contact.phone) {
                            await sendDirectWabaMessage(contact.phone, inviteMessage, whatsappNumberId, whatsappToken);
                        }
                    }
                }

                return groupId;
            };

            const metaConfig = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
            let groupJid = null;
            let metaError: any = null;

            // Recuperar el grupo actual si se proporciona un ID
            let existingGroup: any = null;
            if (id) {
                const existingGroups = await depsHistoryHandler.getWabaReportGroups(projectId);
                existingGroup = existingGroups.find((g: any) => g.id === id);
            }

            if (existingGroup && existingGroup.jid && !existingGroup.jid.includes('@g.us')) {
                // Caso A: El grupo ya existÃ­a como grupo de Meta
                groupJid = existingGroup.jid;
                if (metaConfig?.whatsappToken && metaConfig?.whatsappNumberId) {
                    try {
                        // 1. Actualizar el subject si cambiÃ³
                        if (existingGroup.name !== name) {
                            console.log(`[MetaGroupsAPI] Actualizando subject del grupo Meta ${groupJid} a: ${name}`);
                            const updateUrl = `https://graph.facebook.com/v25.0/${groupJid}`;
                            await axios.post(updateUrl, {
                                messaging_product: 'whatsapp',
                                subject: name
                            }, {
                                headers: {
                                    'Authorization': `Bearer ${metaConfig.whatsappToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            console.log(`[MetaGroupsAPI] Subject de grupo Meta ${groupJid} actualizado con Ã©xito.`);
                        }

                        // 2. Enviar invitaciÃ³n a los contactos nuevos
                        const oldPhones = (existingGroup.contacts || []).map((c: any) => c.phone).filter(Boolean);
                        const newContacts = contacts.filter((c: any) => c.phone && !oldPhones.includes(c.phone));
                        if (newContacts.length > 0) {
                            console.log(`[MetaGroupsAPI] Se detectaron ${newContacts.length} contactos nuevos. Obteniendo enlace de invitaciÃ³n...`);
                            const inviteUrl = `https://graph.facebook.com/v25.0/${groupJid}/invite_link`;
                            const resInvite = await axios.post(inviteUrl, {
                                messaging_product: 'whatsapp'
                            }, {
                                headers: {
                                    'Authorization': `Bearer ${metaConfig.whatsappToken}`,
                                    'Content-Type': 'application/json'
                                }
                            });
                            const inviteLink = resInvite.data.invite_link;
                            console.log(`[MetaGroupsAPI] Enlace de invitaciÃ³n obtenido para el grupo existente: ${inviteLink}`);

                            const inviteMessage = `Â¡Hola! Te invitamos a unirte al grupo oficial de reportes de RialWay *"${name}"*. Para unirte, haz clic en el siguiente enlace de invitaciÃ³n: ${inviteLink}`;
                            for (const contact of newContacts) {
                                await sendDirectWabaMessage(contact.phone, inviteMessage, metaConfig.whatsappNumberId, metaConfig.whatsappToken);
                            }
                        }
                    } catch (err: any) {
                        console.error(`[MetaGroupsAPI] Error al actualizar el grupo de Meta ${groupJid}:`, err.response?.data || err.message);
                    }
                } else {
                    console.warn(`[MetaGroupsAPI] No hay credenciales de Meta configuradas para actualizar el grupo Meta ${groupJid}.`);
                }
            } else if (existingGroup && existingGroup.jid && existingGroup.jid.includes('@g.us')) {
                // Caso B: El grupo ya existÃ­a como grupo de Baileys
                groupJid = existingGroup.jid;

                let sock: any = null;
                const groupProvider = getGroupProvider();
                if (groupProvider && typeof groupProvider.getInstance === 'function') {
                    sock = await groupProvider.getInstance();
                }
                if (!sock) {
                    const adapterProvider = getAdapterProvider();
                    if (adapterProvider && typeof adapterProvider.getInstance === 'function') {
                        sock = await adapterProvider.getInstance();
                    }
                }

                if (sock && typeof sock.groupUpdateSubject === 'function') {
                    try {
                        const participantJids = contacts
                            .map((c: any) => c.phone ? c.phone.replace(/[^0-9]/g, '') : '')
                            .filter(Boolean)
                            .map((num: string) => `${num}@s.whatsapp.net`);

                        // Actualizar nombre si cambiÃ³
                        if (existingGroup.name !== name) {
                            console.log(`[WabaGroups] Actualizando subject del grupo Baileys ${groupJid} a: ${name}`);
                            await sock.groupUpdateSubject(groupJid, name);
                        }

                        // Sincronizar participantes
                        const oldParticipantJids = (existingGroup.contacts || [])
                            .map((c: any) => c.phone ? c.phone.replace(/[^0-9]/g, '') : '')
                            .filter(Boolean)
                            .map((num: string) => `${num}@s.whatsapp.net`);

                        const toAdd = participantJids.filter((jid: string) => !oldParticipantJids.includes(jid));
                        const toRemoveCorrect = oldParticipantJids.filter((jid: string) => !participantJids.includes(jid));

                        if (toRemoveCorrect.length > 0) {
                            console.log(`[WabaGroups] Removiendo participantes de ${groupJid}:`, toRemoveCorrect);
                            await sock.groupParticipantsUpdate(groupJid, toRemoveCorrect, 'remove');
                        }
                        if (toAdd.length > 0) {
                            console.log(`[WabaGroups] Agregando participantes a ${groupJid}:`, toAdd);
                            await sock.groupParticipantsUpdate(groupJid, toAdd, 'add');
                        }
                    } catch (wsErr: any) {
                        console.warn(`[WabaGroups] Advertencia al actualizar grupo Baileys en WhatsApp (JID: ${groupJid}):`, wsErr.message || wsErr);
                    }
                }
            } else {
                // Caso C: Es un grupo nuevo o el grupo existente no tenÃ­a JID
                // CreaciÃ³n estrictamente con Meta WABA
                if (!metaConfig?.whatsappToken || !metaConfig?.whatsappNumberId) {
                    return res.status(400).json({
                        success: false,
                        error: 'No se detectaron credenciales de Meta WABA activas. Para crear grupos oficiales, configura Meta WABA primero.'
                    });
                }

                try {
                    groupJid = await attemptCreateMetaWabaGroup(name, contacts, metaConfig);
                    console.log(`[MetaGroupsAPI] Grupo Meta creado y guardado con JID/ID: ${groupJid}`);
                } catch (err: any) {
                    metaError = err.response?.data || err.message;
                    console.error(`[MetaGroupsAPI] Error al intentar crear grupo en Meta WABA:`, JSON.stringify(metaError));

                    let errorMsg = 'No se pudo crear el grupo en Meta WABA.';
                    if (metaError && metaError.error && metaError.error.message) {
                        errorMsg += ` Detalle: ${metaError.error.message}`;
                    } else if (typeof metaError === 'string') {
                        errorMsg += ` Detalle: ${metaError}`;
                    }
                    return res.status(400).json({
                        success: false,
                        error: errorMsg
                    });
                }
            }

            const result = await depsHistoryHandler.saveWabaReportGroup({ id, name, contacts, jid: groupJid }, projectId);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** DELETE /api/backoffice/waba-groups/:id */
    app.delete('/api/backoffice/waba-groups/:id', backofficeAuth, async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
            const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

            const existingGroups = await depsHistoryHandler.getWabaReportGroups(projectId);
            const existingGroup = existingGroups.find((g: any) => g.id === id);

            if (existingGroup && existingGroup.jid) {
                if (existingGroup.jid.includes('@g.us')) {
                    // Grupo de Baileys: salir
                    let sock: any = null;
                    const groupProvider = getGroupProvider();
                    if (groupProvider && typeof groupProvider.getInstance === 'function') {
                        sock = await groupProvider.getInstance();
                    }
                    if (!sock) {
                        const adapterProvider = getAdapterProvider();
                        if (adapterProvider && typeof adapterProvider.getInstance === 'function') {
                            sock = await adapterProvider.getInstance();
                        }
                    }

                    if (sock && typeof sock.groupLeave === 'function') {
                        try {
                            console.log(`[WabaGroups] Saliendo del grupo WhatsApp Baileys ${existingGroup.jid}...`);
                            await sock.groupLeave(existingGroup.jid);
                        } catch (wsErr: any) {
                            console.warn(`[WabaGroups] No se pudo salir del grupo WhatsApp ${existingGroup.jid}:`, wsErr.message || wsErr);
                        }
                    }
                } else {
                    // Grupo de Meta: revocar enlace de invitaciÃ³n
                    const metaConfig = await depsHistoryHandler.getMetaOnboardingData(projectId, false, serviceId);
                    if (metaConfig?.whatsappToken) {
                        console.log(`[MetaGroupsAPI] Revocando enlace de invitaciÃ³n para el grupo Meta ${existingGroup.jid}...`);
                        try {
                            await axios.delete(`https://graph.facebook.com/v25.0/${existingGroup.jid}/invite_link`, {
                                headers: { 'Authorization': `Bearer ${metaConfig.whatsappToken}` }
                            });
                            console.log(`[MetaGroupsAPI] Enlace de invitaciÃ³n revocado con Ã©xito.`);
                        } catch (metaErr: any) {
                            console.warn(`[MetaGroupsAPI] Advertencia al revocar enlace del grupo Meta ${existingGroup.jid}:`, metaErr.response?.data || metaErr.message);
                        }
                    }
                }
            }

            const result = await depsHistoryHandler.deleteWabaReportGroup(id);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/chat/read/:chatId â€” Resetea unread_count a 0 para un chat */
    app.post('/api/backoffice/chat/read/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const { chatId } = req.params;
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const cleanId = depsHistoryHandler.normalizeId(chatId);

            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../../db/localHistoryStore');
                await LocalHistoryStore.updateContactDetails(cleanId, { unread_count: 0 }, projectId);
            } else {
                const { error } = await supabase
                    .from('chats')
                    .update({ unread_count: 0 })
                    .eq('id', cleanId)
                    .eq('project_id', projectId);
                if (error) throw error;
            }
            (depsHistoryHandler as any).invalidateChatCache?.(cleanId, projectId);

            // Emitir evento para WebSockets
            historyEvents.emit('chat_read', { chatId: cleanId, projectId });

            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
};

/** Procesa la importaciÃ³n de contactos desde Excel */
export const processImportExcel = async (req: any, res: any) => {
    const depsHistoryHandler = HistoryHandlerClass;

    if (!req.file) return res.status(400).json({ success: false, error: 'No se subiÃ³ ningÃºn archivo' });

    const projectId = resolveProjectId(req) || depsHistoryHandler.PROJECT_IDENTIFIER;
    const serviceId = resolveServiceId(req) || depsHistoryHandler.SERVICE_IDENTIFIER;

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) as any[];

        if (!data || data.length === 0) {
            return res.status(400).json({ success: false, error: 'El archivo estÃ¡ vacÃ­o' });
        }

        const uniqueChatsMap = new Map<string, any>();
        const tagsToProcess = new Map<string, string[]>(); // phone -> [tagNames]
        const allUniqueTags = new Set<string>();

        for (const row of data) {
            let rawPhone = '';
            let name = '';
            let tagsStr = '';

            for (const key of Object.keys(row)) {
                const cleanKey = key.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const val = String(row[key] ?? '').trim();

                if (!rawPhone && (cleanKey.includes('phone') || cleanKey.includes('telefono') || cleanKey.includes('celular') || cleanKey.includes('mobile') || cleanKey.includes('numero') || cleanKey.includes('jid'))) {
                    rawPhone = val;
                } else if (!name && (cleanKey.includes('name') || cleanKey.includes('nombre') || cleanKey.includes('cliente'))) {
                    name = val;
                } else if (!tagsStr && (cleanKey.includes('tag') || cleanKey.includes('etiqueta'))) {
                    tagsStr = val;
                }
            }

            // Fallback directo por nombres de propiedad comunes
            if (!rawPhone) {
                rawPhone = String(row.phone || row.Phone || row.telefono || row.Telefono || row.celular || row.Celular || row.contacto || row.Contacto || '').trim();
            }
            if (!name) {
                name = String(row.name || row.Name || row.nombre || row.Nombre || '').trim();
            }

            // NORMALIZACIÃ“N Y FORMATO INTERNACIONAL: Quitar caracteres no numÃ©ricos y formatear (ej: 2914464733 -> 5492914464733)
            let phone = rawPhone.replace(/\D/g, '');
            if (!phone) continue;

            if (phone.length === 10) {
                phone = `549${phone}`;
            } else if (phone.length === 11 && phone.startsWith('9')) {
                phone = `54${phone}`;
            } else if (phone.length === 12 && phone.startsWith('54') && !phone.startsWith('549')) {
                phone = `549${phone.slice(2)}`;
            }

            // DeduplicaciÃ³n en memoria para el archivo importado
            const existing = uniqueChatsMap.get(phone);
            if (!existing || (!existing.name && name)) {
                uniqueChatsMap.set(phone, {
                    id: phone,
                    name: name || null,
                    type: 'whatsapp',
                    bot_enabled: true,
                    assigned_agent: 'asistente1'
                });
            }

            if (tagsStr) {
                const tagList = tagsStr.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
                if (tagList.length > 0) {
                    const currentTags = tagsToProcess.get(phone) || [];
                    const mergedTags = Array.from(new Set([...currentTags, ...tagList]));
                    tagsToProcess.set(phone, mergedTags);
                    mergedTags.forEach((t: string) => allUniqueTags.add(t));
                }
            }
        }

        const chatsToSync = Array.from(uniqueChatsMap.values());

        // 1. Upsert de Chats (Normalizados)
        await depsHistoryHandler.syncChats(chatsToSync, projectId, serviceId);

        // 2. Procesar Etiquetas
        if (allUniqueTags.size > 0) {
            const existingTags = await depsHistoryHandler.getTags(projectId, serviceId);
            const tagMap = new Map<string, string>(); // name -> id
            existingTags.forEach((t: any) => tagMap.set(t.name.toLowerCase(), t.id));

            for (const tagName of allUniqueTags) {
                if (!tagMap.has(tagName.toLowerCase())) {
                    const newTag = await depsHistoryHandler.createTag(tagName, '#6366f1', projectId, serviceId);
                    if (newTag.success && newTag.tag) {
                        tagMap.set(tagName.toLowerCase(), newTag.tag.id);
                    }
                }
            }

            const associations = [];
            for (const [phone, tagNames] of tagsToProcess.entries()) {
                for (const name of tagNames) {
                    const tagId = tagMap.get(name.toLowerCase());
                    if (tagId) {
                        associations.push({ chat_id: phone, tag_id: tagId });
                    }
                }
            }

            if (associations.length > 0) {
                await depsHistoryHandler.syncChatTags(associations, projectId, serviceId);
            }
        }

        // Limpiar archivo temporal
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        return res.json({
            success: true,
            imported: chatsToSync.length,
            tags_processed: allUniqueTags.size
        });

    } catch (error: any) {
        console.error('âŒ Error importando contactos:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

export const processCreateIndividualContact = async (req: any, res: any) => {
    try {
        const { rawPhone, name, tagIds, projectId: bodyProjectId } = req.body;
        const targetProjectId = bodyProjectId || req.query.projectId || resolveProjectId(req) || (HistoryHandlerClass as any).PROJECT_ID || 'default';
        const targetServiceId = resolveServiceId(req) || (HistoryHandlerClass as any).SERVICE_IDENTIFIER;

        let phone = String(rawPhone || '').replace(/\D/g, '').trim();
        if (!phone) {
            return res.status(400).json({ success: false, error: 'Proporciona un nÃºmero de telÃ©fono vÃ¡lido.' });
        }

        if (phone.startsWith('0')) {
            phone = phone.slice(1);
        }
        if (phone.length === 10) {
            phone = `549${phone}`;
        } else if (phone.length === 11 && phone.startsWith('9')) {
            phone = `54${phone}`;
        } else if (phone.length === 12 && phone.startsWith('54') && !phone.startsWith('549')) {
            phone = `549${phone.slice(2)}`;
        }

        const supabase = HistoryHandlerClass.getSupabase();
        if (!supabase) {
            return res.status(500).json({ success: false, error: 'Base de datos no disponible.' });
        }

        const chatRow: any = {
            id: phone,
            project_id: targetProjectId,
            name: name && String(name).trim() !== '' ? String(name).trim() : null,
            type: 'whatsapp',
            bot_enabled: true,
            assigned_agent: 'asistente1',
            last_message_at: new Date().toISOString()
        };

        if (targetServiceId && targetServiceId !== 'default' && targetServiceId !== 'default_service') {
            chatRow.service_id = targetServiceId;
        } else {
            chatRow.service_id = HistoryHandlerClass.SERVICE_IDENTIFIER;
        }

        const { error: chatErr } = await supabase
            .from('chats')
            .upsert(chatRow, { onConflict: 'id,project_id,service_id' });

        if (chatErr) {
            console.error('[create-individual] Error guardando chat:', chatErr);
            return res.status(500).json({ success: false, error: chatErr.message });
        }

        if (Array.isArray(tagIds) && tagIds.length > 0) {
            const tagRows = tagIds.map((tagId: string) => {
                const row: any = {
                    chat_id: phone,
                    tag_id: tagId,
                    project_id: targetProjectId
                };
                if (targetServiceId && targetServiceId !== 'default' && targetServiceId !== 'default_service') {
                    row.service_id = targetServiceId;
                } else {
                    row.service_id = HistoryHandlerClass.SERVICE_IDENTIFIER;
                }
                return row;
            });

            const { error: tagErr } = await supabase
                .from('chat_tags')
                .upsert(tagRows, { onConflict: 'chat_id,tag_id,project_id' });

            if (tagErr) {
                console.error('[create-individual] Error asignando etiquetas:', tagErr.message);
            }
        }

        console.log(`âœ… [create-individual] Contacto ${phone} (${name || 'Sin nombre'}) creado para proyecto ${targetProjectId}`);

        return res.json({
            success: true,
            chatId: phone,
            normalizedPhone: phone,
            message: 'Contacto creado exitosamente.'
        });
    } catch (err: any) {
        console.error('[create-individual] Error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Error interno al crear contacto.' });
    }
};

export const processDeleteChat = async (req: any, res: any) => {
    try {
        const { chatId } = req.params;
        const targetProjectId = req.query.projectId || resolveProjectId(req) || (HistoryHandlerClass as any).PROJECT_ID || 'default';

        if (!chatId) {
            return res.status(400).json({ success: false, error: 'Se requiere el ID del chat a eliminar.' });
        }

        const supabase = HistoryHandlerClass.getSupabase();
        if (!supabase) {
            return res.status(500).json({ success: false, error: 'Base de datos no disponible.' });
        }

        console.log(`ðŸ—‘ï¸ [DeleteChat] Solicitando eliminaciÃ³n del chat ${chatId} exclusivamente para el proyecto ${targetProjectId}...`);

        // 1. Eliminar mensajes pertenecientes Ãºnicamente a este chat y proyecto
        const { error: msgErr } = await supabase
            .from('messages')
            .delete()
            .eq('chat_id', chatId)
            .eq('project_id', targetProjectId);

        if (msgErr) {
            console.error('[DeleteChat] Error eliminando mensajes del proyecto:', msgErr.message);
        }

        // 2. Eliminar tickets asociados a este chat y proyecto
        try {
            await supabase
                .from('tickets')
                .delete()
                .eq('chat_id', chatId)
                .eq('project_id', targetProjectId);
        } catch (tErr) { /* ignore */ }

        // 3. Eliminar chat Ãºnicamente para ESTE project_id (aislamiento estricto por proyecto)
        const { error: chatErr } = await supabase
            .from('chats')
            .delete()
            .eq('id', chatId)
            .eq('project_id', targetProjectId);

        if (chatErr) {
            console.error('[DeleteChat] Error eliminando registro de chat:', chatErr);
            return res.status(500).json({ success: false, error: chatErr.message });
        }

        console.log(`âœ… [DeleteChat] Chat ${chatId} borrado con Ã©xito del proyecto ${targetProjectId}.`);

        return res.json({
            success: true,
            chatId,
            projectId: targetProjectId,
            message: `El chat ha sido eliminado exitosamente de este proyecto.`
        });
    } catch (err: any) {
        console.error('[DeleteChat] Error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Error interno al eliminar chat' });
    }
};
