import path from 'path';
import fs from 'fs';
import bodyParser from 'body-parser';
import axios from 'axios';
import { backofficeAuth } from "../middleware/auth";

/**
 * Registra las rutas del backoffice en la instancia de Polka.
 */
export interface BackofficeDependencies {
    adapterProvider: any;
    groupProvider?: any; // Añadido para soporte dual
    HistoryHandler: any;
    openaiMain: any;
    upload: any;
}

/** Función unificada para procesar el envío de mensajes e historial */
export const processSendMessage = async (
    req: any, 
    res: any, 
    chatId: string, 
    message: string, 
    file: any,
    deps: BackofficeDependencies
) => {
    const { adapterProvider, HistoryHandler, openaiMain } = deps;
    // 1. Determinar tipo y contenido
    let finalType: 'text' | 'image' | 'video' | 'document' = 'text';
    if (file) {
        if (file.mimetype.startsWith('image/')) finalType = 'image';
        else if (file.mimetype.startsWith('video/')) finalType = 'video';
        else finalType = 'document';
    }
    
    const fileUrl = file ? `/uploads/${file.filename}` : '';
    const finalContent = file ? fileUrl : (message || '');

    try {
        if (!adapterProvider) {
            return res.status(503).json({ success: false, error: 'WhatsApp provider not initialized' });
        }

        console.log(`[BACKOFFICE] Procesando envío para ${chatId}...`);
        
        // 2. GUARDAR PRIMERO (Feedback instantáneo)
        await HistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType);
        await HistoryHandler.updateLastHumanMessage(chatId);

        // 3. Inyectar en thread OpenAI (silencioso)
        HistoryHandler.getThreadId(chatId).then((threadId: string) => {
            if (threadId && (message || file)) {
                openaiMain.beta.threads.messages.create(threadId, {
                    role: 'assistant',
                    content: `[Mensaje enviado por operador humano]: ${message || '[Media]'}`
                }).catch(() => {});
            }
        }).catch(() => {});

        // 4. ENVIAR A WHATSAPP
        try {
            const isGroup = chatId.includes('@g.us');
            const providerToSend = (isGroup && deps.groupProvider) ? deps.groupProvider : adapterProvider;
            
            console.log(`[BACKOFFICE] Enviando via ${providerToSend.constructor.name} a ${chatId}`);

            const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
            if (file) {
                const absolutePath = path.resolve(file.path);
                if (finalType === 'image') {
                    if (typeof providerToSend.sendImage === 'function') {
                        await providerToSend.sendImage(jid, absolutePath, message || '');
                    } else {
                        await providerToSend.sendMessage(jid, message || '', { media: absolutePath });
                    }
                } else if (finalType === 'video') {
                    if (typeof (providerToSend as any).sendVideo === 'function') {
                        await (providerToSend as any).sendVideo(jid, absolutePath, message || '');
                    } else {
                        await providerToSend.sendMessage(jid, message || '', { media: absolutePath });
                    }
                } else {
                    if (typeof (providerToSend as any).sendFile === 'function') {
                        await (providerToSend as any).sendFile(jid, absolutePath, message || file.originalname);
                    } else {
                        await providerToSend.sendMessage(jid, message || '', { media: absolutePath, fileName: file.originalname });
                    }
                }
            } else {
                await providerToSend.sendMessage(jid, message, {});
            }
            res.json({ success: true, fileUrl: file ? fileUrl : undefined });
        } catch (waError) {
            console.error('[BACKOFFICE] Error enviando a Whatsapp:', waError);
            res.json({ 
                success: true, 
                fileUrl: file ? fileUrl : undefined,
                warning: 'El mensaje se guardó en el historial pero falló el envío a WhatsApp (¿Bot conectado?)' 
            });
        }

    } catch (e: any) {
        console.error('❌ Error crítico en processSendMessage:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * Registra las rutas del backoffice en la instancia de Polka.
 */
export const registerBackofficeRoutes = (app: any, deps: BackofficeDependencies) => {
    const { adapterProvider, HistoryHandler, openaiMain, upload } = deps;

    // --- AUTH ---

    app.post('/api/backoffice/auth', bodyParser.json(), (req, res) => {
        const { token } = req.body;
        if (token === process.env.BACKOFFICE_TOKEN) {
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: "Invalid token" });
        }
    });

    // --- CHATS & MESSAGES ---

    app.get('/api/backoffice/chats', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = parseInt(req.query.offset as string) || 0;
        const search = req.query.search as string;
        const tag = req.query.tag as string;
        const chats = await HistoryHandler.listChats(limit, offset, search, tag);
        res.json(chats);
    });

    app.get('/api/backoffice/messages/:chatId', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const messages = await HistoryHandler.getMessages(req.params.chatId, limit, offset);
        res.json(messages);
    });

    app.get('/api/backoffice/profile-pic/:chatId', async (req, res) => {
        try {
            const { chatId } = req.params;
            const token = req.query.token as string;

            if (token !== process.env.BACKOFFICE_TOKEN) {
                res.status(401).end();
                return;
            }

            if (!adapterProvider) {
                console.error('[ProfilePic] Error: adapterProvider no inicializado');
                res.status(500).end();
                return;
            }

            let jid = chatId;
            if (chatId.match(/^\d+$/) && !chatId.includes('@')) {
                jid = `${chatId}@s.whatsapp.net`;
            }

            const vendor = (adapterProvider as any).vendor || adapterProvider.globalVendorArgs?.sock;
            if (vendor && typeof vendor.profilePictureUrl === 'function') {
                try {
                    const url = await vendor.profilePictureUrl(jid, 'image');
                    if (url) {
                        res.writeHead(302, { Location: url });
                        return res.end();
                    }
                } catch (picError) {
                    // console.log(`[ProfilePic] No se pudo obtener foto para ${jid}`);
                }
            }
            
            res.status(404).end();
        } catch (e) {
            console.error('[ProfilePic] Error excepcional:', e);
            res.status(500).end();
        }
    });

    // --- SEND MESSAGE & TOGGLE BOT ---

    app.post('/api/backoffice/send-message', backofficeAuth, (req, res, next) => {
        if (req.body && Object.keys(req.body).length > 0) {
            console.warn("⚠️ [BACKOFFICE] Cuerpo detectado ANTES de Multer. Posible conflicto de stream.");
        }

        upload.single('file')(req, res, (err: any) => {
            if (err) {
                console.error("❌ [BACKOFFICE] Error de Multer:", err);
                return res.status(400).json({ success: false, error: `Error de archivo: ${err.message}` });
            }
            const { chatId, message } = req.body;
            if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });
            
            // Pasamos deps como sexto argumento
            processSendMessage(req, res, chatId, message, (req as any).file, deps);
        });
    });

    app.post('/api/backoffice/toggle-bot', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { chatId, enabled } = req.body;
        if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });
        
        try {
            await HistoryHandler.toggleBot(chatId, enabled);
            if ((adapterProvider as any).server?.io) {
                (adapterProvider as any).server.io.emit('bot_toggled', { chatId, enabled });
            }
            res.json({ success: true, enabled });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // --- TAGS ---

    app.get('/api/backoffice/tags', backofficeAuth, async (req, res) => {
        const tags = await HistoryHandler.getTags();
        res.json(tags);
    });

    app.put('/api/backoffice/chat/:id/contact', backofficeAuth, bodyParser.json(), async (req, res) => {
        try {
            const { id } = req.params;
            const { name, email, notes, source } = req.body;
            const result = await HistoryHandler.updateContactDetails(id, { name, email, notes, source });
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/tags', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { name, color } = req.body;
        const result = await HistoryHandler.createTag(name, color);
        res.json(result);
    });

    app.put('/api/backoffice/tags/:id', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { name, color } = req.body;
        const result = await HistoryHandler.updateTag(req.params.id, name, color);
        res.json(result);
    });

    app.delete('/api/backoffice/tags/:id', backofficeAuth, async (req, res) => {
        const result = await HistoryHandler.deleteTag(req.params.id);
        res.json(result);
    });

    app.post('/api/backoffice/chats/:chatId/tags', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { tagId } = req.body;
        const result = await HistoryHandler.addTagToChat(req.params.chatId, tagId);
        res.json(result);
    });

    app.delete('/api/backoffice/chats/:chatId/tags/:tagId', backofficeAuth, async (req, res) => {
        const result = await HistoryHandler.removeTagFromChat(req.params.chatId, req.params.tagId);
        res.json(result);
    });

    // --- TICKETS ---

    app.get('/api/backoffice/tickets/pending-count', backofficeAuth, async (req, res) => {
        const count = await HistoryHandler.getPendingTicketsCount();
        res.json({ count });
    });

    app.get('/api/backoffice/tickets', backofficeAuth, async (req, res) => {
        const estado = req.query.estado as string;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await HistoryHandler.listTickets(limit, offset, estado);
        res.json(result);
    });

    app.post('/api/backoffice/tickets', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { chatId, titulo, descripcion, tipo, prioridad } = req.body;
        if (!chatId || !titulo) return res.status(400).json({ success: false, error: 'chatId and titulo are required' });
        const result = await HistoryHandler.createTicket(chatId, titulo, descripcion, tipo, prioridad);
        res.json(result);
    });

    app.put('/api/backoffice/tickets/:id', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { id } = req.params;
        const { estado } = req.body;
        const result = await HistoryHandler.updateTicketStatus(id, estado);
        res.json(result);
    });

    app.get('/api/backoffice/leads', backofficeAuth, async (req, res) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await HistoryHandler.listEditedLeads(limit, offset);
        res.json(result);
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/config', backofficeAuth, async (req, res) => {
        const config = await HistoryHandler.getMetaOnboardingData();
        res.json({
            appId: process.env.META_APP_ID,
            appSecret: process.env.META_APP_SECRET,
            railwayProjectId: process.env.RAILWAY_PROJECT_ID,
            config: config
        });
    });

    app.post('/api/backoffice/whatsapp/onboard', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, error: 'Code is required' });

        try {
            console.log(`📡 [META-ONBOARD] Llamando a DuskCodes para validación externa...`);
            
            // 1. Llamar al endpoint de DuskCodes pasando credenciales y el código
            const response = await axios.post('https://duskcodes.com.ar/meta-auth', {
                code,
                railwayProjectId: process.env.RAILWAY_PROJECT_ID,
                metaAppId: process.env.META_APP_ID,
                metaAppSecret: process.env.META_APP_SECRET
            });

            const data = response.data;

            if (data.error) {
                throw new Error(data.error || 'La validación en DuskCodes falló');
            }

            // 2. Guardar los datos recibidos (WABA, Phone ID, Token) en la base de datos
            const result = await HistoryHandler.saveMetaOnboardingData(
                data.wabaId || "PENDING", 
                data.phoneNumberId || "PENDING", 
                data.accessToken || data.access_token,
                { ...data, syncedBy: 'duskcodes' }
            );

            res.json(result);
        } catch (error: any) {
            console.error('Error in Meta Onboarding (External):', error.response?.data || error.message);
            res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
        }
    });

    // --- SYNC ASSISTANT PROMPT ---

    app.post('/api/backoffice/sync-assistant-prompt', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { assistantId } = req.body;
        if (!assistantId) return res.status(400).json({ success: false, error: 'assistantId is required' });

        try {
            console.log(`📡 [SYNC] Obteniendo instrucciones para el asistente: ${assistantId}`);
            const assistant = await openaiMain.beta.assistants.retrieve(assistantId);
            
            if (assistant && assistant.instructions) {
                res.json({ 
                    success: true, 
                    instructions: assistant.instructions,
                    name: assistant.name,
                    model: assistant.model
                });
            } else {
                res.status(404).json({ success: false, error: 'Assistant not found or has no instructions' });
            }
        } catch (error: any) {
            console.error('Error syncing assistant prompt:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- GET STORED PROMPT ---
    app.get('/api/backoffice/get-prompt', backofficeAuth, async (req, res) => {
        try {
            const prompt = await HistoryHandler.getSetting('ASSISTANT_PROMPT');
            res.json({ success: true, prompt: prompt || process.env.ASSISTANT_PROMPT || '' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- UPDATE PROMPT WITHOUT RESTART ---
    app.post('/api/backoffice/update-prompt', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { prompt } = req.body;
        if (prompt === undefined) return res.status(400).json({ success: false, error: 'prompt is required' });

        try {
            console.log(`📡 [HOT-UPDATE] Actualizando prompt en base de datos...`);
            await HistoryHandler.saveSetting('ASSISTANT_PROMPT', prompt);

            // Sincronizar hacia OpenAI (Empujar cambio al dashboard de OpenAI)
            const assistantId = process.env.ASSISTANT_ID;
            if (assistantId && openaiMain) {
                console.log(`📡 [SYNC] Empujando nuevo prompt hacia OpenAI Assistant: ${assistantId}`);
                await openaiMain.beta.assistants.update(assistantId, {
                    instructions: prompt
                });
                console.log('✅ [SYNC] Prompt actualizado en OpenAI exitosamente.');
            }

            res.json({ 
                success: true, 
                message: 'Prompt actualizado correctamente en local y en OpenAI (Hot-update)' 
            });
        } catch (error: any) {
            console.error('Error updating prompt and syncing to OpenAI:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });
};
