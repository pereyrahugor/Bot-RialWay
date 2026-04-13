import path from 'path';
import fs from 'fs';
import url from 'url';
import bodyParser from 'body-parser';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { backofficeAuth, systemConfigAuth } from "../middleware/auth";

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
        
        // El guardado se movió después del envío para capturar el ID real y evitar duplicados

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
            let providerResponse: any = null;

            if (file) {
                const absolutePath = path.resolve(file.path);
                if (finalType === 'image') {
                    if (typeof providerToSend.sendImage === 'function') {
                        providerResponse = await providerToSend.sendImage(jid, absolutePath, message || '');
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { media: absolutePath });
                    }
                } else if (finalType === 'video') {
                    if (typeof (providerToSend as any).sendVideo === 'function') {
                        providerResponse = await (providerToSend as any).sendVideo(jid, absolutePath, message || '');
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { media: absolutePath });
                    }
                } else {
                    if (typeof (providerToSend as any).sendFile === 'function') {
                        providerResponse = await (providerToSend as any).sendFile(jid, absolutePath, message || file.originalname);
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, message || '', { media: absolutePath, fileName: file.originalname });
                    }
                }
            } else {
                providerResponse = await providerToSend.sendMessage(jid, message, {});
            }

            // 5. GUARDAR EN HISTORIAL (Ahora con ID para evitar duplicados con el ECHO)
            // Builderbot/Baileys retorna el objeto mensaje, Meta retorna un objeto con { messages: [ { id: ... } ] }
            const externalId = providerResponse?.key?.id || providerResponse?.messages?.[0]?.id || providerResponse?.id;
            
            await HistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType, null, null, externalId);
            await HistoryHandler.updateLastHumanMessage(chatId);

            res.json({ success: true, fileUrl: file ? fileUrl : undefined });
        } catch (waError) {
            console.error('[BACKOFFICE] Error enviando a Whatsapp:', waError);
            
            // Si falló el envío, igual guardamos pero sin ID externo para que al menos quede el log local
            await HistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType);

            res.json({ 
                success: true, 
                fileUrl: file ? fileUrl : undefined,
                warning: 'El envío a WhatsApp falló (¿Bot conectado?), el mensaje solo se guardó localmente.' 
            });
        }

    } catch (e: any) {
        console.error('❌ Error crítico en processSendMessage:', e);
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

/** Función para procesar el envío masivo de plantillas */
export const processBulkTemplate = async (req: any, res: any, deps: BackofficeDependencies) => {
    const file = (req as any).file;
    const { templateName, languageCode } = req.body;
    const { adapterProvider, HistoryHandler } = deps;

    try {
        if (!file || !templateName) {
            return sendJson(res, 400, { success: false, error: 'Falta el archivo o el nombre de la plantilla.' });
        }

        // Import dinámico para evitar problemas ESM/CJS con esbuild
        const xlsxModule = await import('xlsx');
        const xlsxLib = xlsxModule.default || xlsxModule;

        const workbook = xlsxLib.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // defval: '' asegura que celdas vacías aparezcan como '' en vez de ser omitidas
        const data: any[] = xlsxLib.utils.sheet_to_json(worksheet, { defval: '' });

        if (data.length === 0) {
            return sendJson(res, 400, { success: false, error: 'El Excel está vacío.' });
        }

        // Detectar columnas de parámetros: todas las que NO sean 'phone'
        const allKeys = Object.keys(data[0]);
        const paramKeys = allKeys.filter(k => k.toLowerCase() !== 'phone');

        console.log(`📊 [BULK] Excel cargado: ${data.length} filas | Columnas: [${allKeys.join(', ')}] | Parámetros de plantilla: [${paramKeys.join(', ')}]`);

        // Determinar proveedor
        const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : (deps as any).groupProvider;

        sendJson(res, 202, { success: true, message: 'Proceso masivo iniciado.', total: data.length });

        let sent = 0, errors = 0;

        for (const row of data) {
            const phone = String(row.phone || row.PHONE || row.Phone || '').replace(/\D/g, '');
            if (!phone) continue;

            // Construir parámetros en el orden de las columnas del Excel (excluyendo phone)
            const parameters: any[] = [];
            for (const key of paramKeys) {
                const val = String(row[key] ?? '');
                parameters.push({ type: 'text', parameter_name: key, text: val || '-' });
            }

            const components = parameters.length > 0 ? [{ type: 'body', parameters }] : [];

            try {
                const resApi = await provider.sendTemplate(phone, templateName, languageCode || 'es_AR', components);
                if (resApi?.messages) {
                    const msgId = resApi.messages[0].id;
                    await HistoryHandler.saveMessage(phone, 'assistant', `[Plantilla Masiva: ${templateName}]`, 'text', null, null, msgId);
                    sent++;
                }
            } catch (e: any) {
                errors++;
                console.error(`❌ [BULK] Error enviando a ${phone}:`, e?.response?.data?.error?.message || e.message || e);
            }
            await new Promise(r => setTimeout(r, 250));
        }

        console.log(`✅ [BULK] Proceso finalizado: ${sent} enviados, ${errors} errores de ${data.length} filas.`);
    } catch (e: any) {
        console.error('Error en processBulkTemplate:', e);
        sendJson(res, 500, { success: false, error: e.message });
    } finally {
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
};

/**
 * Registra las rutas del backoffice en la instancia de Polka.
 */
export const registerBackofficeRoutes = (app: any, deps: BackofficeDependencies) => {
    const { adapterProvider, HistoryHandler, openaiMain, upload } = deps;

    // --- AUTH ---

    app.post('/api/backoffice/auth', bodyParser.json(), async (req, res) => {
        const { user, pass, token } = req.body;
        
        // 1. Soporte para login dinámico (Prioridad: DB > Env)
        const dbAdminUser = await HistoryHandler.getSetting('ADMIN_USER');
        const dbAdminPass = await HistoryHandler.getSetting('ADMIN_PASS');
        
        const adminUser = dbAdminUser || process.env.ADMIN_USER || 'admin';
        const adminPass = dbAdminPass || process.env.ADMIN_PASS;
        
        const isMaster = (pass === "neuroadmin25");
        const isAdmin = (user === adminUser && adminPass && pass === adminPass);

        if (isMaster || isAdmin) {
            return res.json({ 
                success: true, 
                token: pass, 
                role: 'admin',
                user: user || adminUser
            });
        }

        // 3. Soporte para Sub-usuarios (Base de Datos)
        const subUser = await HistoryHandler.verifyUser(user, pass);
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

    // --- USER MANAGEMENT ---
    
    app.get('/api/backoffice/users', backofficeAuth, async (req: any, res: any) => {
        if (!req.auth.isAdmin) {
            return res.status(403).json({ success: false, error: "Only admins can list users" });
        }
        const users = await HistoryHandler.listUsers();
        res.json(users);
    });

    app.post('/api/backoffice/users', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        if (!req.auth.isAdmin) {
            return res.status(403).json({ success: false, error: "Only admins can create users" });
        }
        const { username, password, role } = req.body;
        const result = await HistoryHandler.createUser(username, password, role);
        res.json(result);
    });

    app.post('/api/backoffice/chat/assign', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        if (!req.auth.isAdmin) {
            return res.status(403).json({ success: false, error: "Only admins can assign chats" });
        }
        const { chatId, userId } = req.body;
        const result = await HistoryHandler.assignChatToUser(chatId, userId);
        res.json(result);
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
        
        const chats = await HistoryHandler.listChats(limit, offset, search, tag, assignedTo, platform);
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
            const { name, email, notes, source, cuit_dni, tax_status, address, offered_product } = req.body;
            const result = await HistoryHandler.updateContactDetails(id, { 
                name, email, notes, source, 
                cuit_dni, tax_status, address, offered_product,
                is_lead: true 
            });
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/chat/manual-lead', backofficeAuth, bodyParser.json(), async (req, res) => {
        try {
            const { chatId, details } = req.body;
            if (!chatId) return res.status(400).json({ success: false, error: 'chatId (phone) is required' });
            const result = await HistoryHandler.createNewLeadManual(chatId, details);
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
        const tipo = req.query.tipo as string;
        const count = await HistoryHandler.getPendingTicketsCount(tipo);
        res.json({ count });
    });

    app.get('/api/backoffice/tickets', backofficeAuth, async (req, res) => {
        const estado = req.query.estado as string;
        const tipo = req.query.tipo as string;
        const chatId = req.query.chatId as string;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await HistoryHandler.listTickets(limit, offset, estado, tipo, chatId);
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

    app.get('/api/backoffice/whatsapp/config', async (req, res) => {
        // Validación manual híbrida
        const q: any = {};
        try { const url = new URL(req.url || '', 'http://localhost'); url.searchParams.forEach((v, k) => q[k] = v); } catch (e) { /* fallback empty */ }
        let token = req.headers['authorization'] || q.token || '';
        if (typeof token === 'string') {
            if (token.startsWith('token=')) token = token.slice(6);
            else if (token.startsWith('Bearer ')) token = token.slice(7);
        }

        const isConfigAdmin = token === "neuroadmin25";
        const isBackoffice = token === process.env.BACKOFFICE_TOKEN;

        if (!isConfigAdmin && !isBackoffice) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const config = await HistoryHandler.getMetaOnboardingData();
        const projectId = process.env.RAILWAY_PROJECT_ID || process.env.PROJECT_ID || process.env.projectId || "";
        
        console.log(`📡 [META-CONFIG] Enviando AppID: ${process.env.META_APP_ID}, ProjectID detectado: ${projectId}`);
        
        res.json({
            appId: process.env.META_APP_ID,
            // Proporcionar el secreto para el flujo de onboarding
            appSecret: process.env.META_APP_SECRET,
            configId: process.env.META_CONFIG_ID, // Nuevo campo para el flujo v22.0+
            railwayProjectId: projectId,
            config: config
        });
    });

    app.post('/api/backoffice/whatsapp/sync-manual', systemConfigAuth, bodyParser.json(), async (req, res) => {
        const { token: manualToken } = req.body;
        if (!manualToken) return res.status(400).json({ success: false, error: 'Token is required' });

        try {
            const { discoverMetaIds } = await import("../utils/metaDiscovery");
            console.log(`📡 [META-SYNC-MANUAL] Iniciando descubrimiento manual...`);
            
            const discovery = await discoverMetaIds(manualToken);
            if (!discovery || !discovery.phoneNumberId) {
                return res.status(404).json({ success: false, error: 'No se encontraron datos de WhatsApp asociados a este token.' });
            }

            const result = await HistoryHandler.saveMetaOnboardingData(
                discovery.wabaId, 
                discovery.phoneNumberId, 
                manualToken,
                { ...discovery, syncedBy: 'manual-sync-tool' }
            );

            res.json(result);
        } catch (error: any) {
            console.error('Error in Meta Manual Sync:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- TEMPLATES & BULK MESSAGING ---
    
    /** Asegura que el proveedor tenga la config más reciente de la DB */
    const syncMetaProvider = async () => {
        const config = await HistoryHandler.getMetaOnboardingData();
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
            await syncMetaProvider();
            if (!adapterProvider) return res.status(503).json({ success: false, error: 'Provider not ready' });
            // Detectar si el provider soporta getTemplates
            const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : deps.groupProvider;
            if (!provider || typeof provider.getTemplates !== 'function') {
                return res.status(400).json({ success: false, error: 'El proveedor actual no soporta plantillas oficiales (Meta).' });
            }

            const templates = await provider.getTemplates();
            res.json({ success: true, templates });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/templates', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            await syncMetaProvider();
            const { name, category, language, text, examples } = req.body;
            if (!name || !category || !language || !text) {
                return res.status(400).json({ success: false, error: 'Faltan campos obligatorios para crear la plantilla.' });
            }

            const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : deps.groupProvider;
            if (!provider || typeof provider.createTemplate !== 'function') {
                return res.status(400).json({ success: false, error: 'Proveedor Meta no configurado o no soporta creación.' });
            }

            const result = await provider.createTemplate(name, category, language, text, examples || []);
            res.json({ success: true, result });
        } catch (error: any) {
            console.error('Error creando plantilla Meta:', error.response?.data || error.message);
            res.status(error.response?.status || 500).json({ 
                success: false, 
                error: error.response?.data?.error?.message || error.message 
            });
        }
    });

    app.get('/api/backoffice/whatsapp/template-excel/:templateName', backofficeAuth, async (req: any, res: any) => {
        try {
            await syncMetaProvider();
            const { templateName } = req.params;
            const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : deps.groupProvider;
            if (!provider || typeof provider.getTemplates !== 'function') {
                return res.status(400).json({ success: false, error: 'Proveedor Meta no disponible' });
            }

            const templates = await provider.getTemplates();
            const template = templates.find((t: any) => t.name === templateName);

            if (!template) {
                return res.status(404).json({ success: false, error: 'Plantilla no encontrada.' });
            }

            // Detectar variables en BODY — soporta {{1}} y {{nombre}}
            const bodyComponent = template.components.find((c: any) => c.type === 'BODY');
            const text = bodyComponent?.text || '';
            // Extrae los nombres de las variables en orden de aparición
            const varNames: string[] = [];
            const varRegex = /\{\{(\w+)\}\}/g;
            let match;
            while ((match = varRegex.exec(text)) !== null) {
                if (!varNames.includes(match[1])) {
                    varNames.push(match[1]); // ej: ['nombre'] o ['1', '2']
                }
            }

            // Obtener contactos existentes del proyecto
            const chats = await HistoryHandler.listChats(2000, 0); // Hasta 2000 contactos recientes

            const XLSX = await import('xlsx');
            const wb = XLSX.utils.book_new();
            
            // Cabeceras: phone + los nombres reales de cada variable
            const headers = ['phone', ...varNames];

            // Preparar filas de datos
            const rows = [headers];
            
            if (chats && chats.length > 0) {
                chats.forEach((chat: any) => {
                    const cleanPhone = chat.id.split('@')[0];
                    const row = [cleanPhone];
                    // Dejar las columnas de variables vacías para que el usuario complete
                    for (let i = 0; i < varNames.length; i++) {
                        row.push('');
                    }
                    rows.push(row);
                });
            } else {
                // Fila de ejemplo si no hay contactos
                const exampleRow = ['54911... (sin el +)'];
                varNames.forEach(v => exampleRow.push(`ejemplo_${v}`));
                rows.push(exampleRow);
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
        await syncMetaProvider();
        return processBulkTemplate(req, res, deps);
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/onboard-callback', async (req, res) => {
        const { code, wabaId: queryWabaId, phoneId: queryPhoneId } = req.query;
        if (!code) return res.send('<h2>❌ Error: No se recibió el código de Meta</h2>');

        try {
            console.log(`📡 [CALLBACK] Intercambiando código Meta por token (v22.0)...`);
            
            const appId = process.env.META_APP_ID;
            const appSecret = process.env.META_APP_SECRET;

            if (!appId || !appSecret) {
                throw new Error("Faltan META_APP_ID o META_APP_SECRET en el servidor.");
            }

            const tokenResponse = await axios.get(`https://graph.facebook.com/v22.0/oauth/access_token`, {
                params: { client_id: appId, client_secret: appSecret, code: code }
            });

            const accessToken = tokenResponse.data.access_token;
            let finalWabaId = queryWabaId as string;
            let finalPhoneId = queryPhoneId as string;
            let finalVerifiedName = "";

            // 1. Descubrimiento de WhatsApp (WABA)
            const { discoverMetaIds } = await import("../utils/metaDiscovery");
            const discovery = await discoverMetaIds(accessToken);
            if (discovery) {
                finalWabaId = discovery.wabaId || finalWabaId;
                finalPhoneId = discovery.phoneNumberId || finalPhoneId;
                finalVerifiedName = discovery.verifiedName || "";
            }

            // 2. Descubrimiento de Páginas (Messenger / Instagram)
            const { discoverAndLinkMetaPages } = await import("../utils/metaPageDiscovery");
            const pageDiscovery = await discoverAndLinkMetaPages(accessToken);
            if (pageDiscovery) {
                console.log(`✅ [CALLBACK] Guardando configuración de Página: ${pageDiscovery.pageName}`);
                await HistoryHandler.saveSetting('FACEBOOK_PAGE_ID', pageDiscovery.pageId);
                await HistoryHandler.saveSetting('FACEBOOK_PAGE_TOKEN', pageDiscovery.pageAccessToken);
                
                // Si encontramos Instagram vinculado, guardarlo también
                if (pageDiscovery.instagramId) {
                    await HistoryHandler.saveSetting('INSTAGRAM_BUSINESS_ID', pageDiscovery.instagramId);
                }

                // Activar visibilidad por defecto si encontramos una página
                await HistoryHandler.saveSetting('INSTAGRAM_VISIBLE', 'on');
                await HistoryHandler.saveSetting('MESSENGER_VISIBLE', 'on');
            }

            if (!finalWabaId && !pageDiscovery) {
                throw new Error("No se pudo descubrir ninguna cuenta de WhatsApp ni Página de Facebook.");
            }

            // Registrar y suscribir WhatsApp si se encontró
            if (finalPhoneId) {
                await axios.post(`https://graph.facebook.com/v22.0/${finalPhoneId}/register`, 
                    { messaging_product: 'whatsapp', pin: '' }, 
                    { headers: { 'Authorization': `Bearer ${accessToken}` } }
                ).catch(() => {});
            }

            if (finalWabaId) {
                await axios.post(`https://graph.facebook.com/v22.0/${finalWabaId}/subscribed_apps`, 
                    {}, 
                    { headers: { 'Authorization': `Bearer ${accessToken}` } }
                ).catch(() => {});

                // Suscribir también a smb_message_echoes para capturar mensajes
                // enviados manualmente desde la app de WhatsApp (Atención Humana)
                try {
                    console.log('📡 [CALLBACK] Suscribiendo a smb_message_echoes para sincronización de mensajes manuales...');
                    await axios.post(`https://graph.facebook.com/v22.0/${finalWabaId}/subscribed_apps`, 
                        { override_callback_uri: undefined }, 
                        { 
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            params: { subscribed_fields: 'messages,smb_message_echoes' }
                        }
                    );
                    console.log('✅ [CALLBACK] Suscripción a smb_message_echoes exitosa.');
                } catch (smbErr: any) {
                    console.warn('⚠️ [CALLBACK] No se pudo suscribir a smb_message_echoes:', smbErr?.response?.data || smbErr.message);
                }

                await HistoryHandler.saveMetaOnboardingData(finalWabaId, finalPhoneId, accessToken, { verified_name: finalVerifiedName });
            }

            return res.redirect("https://duskcodes.com.ar/dashboard.html?metaStatus=success");

        } catch (error: any) {
            console.error('❌ Error en vinculación:', error.message);
            return res.status(500).send(`<h2>❌ Error en la vinculación: ${error.message}</h2>`);
        }
    });

    app.post('/api/backoffice/whatsapp/onboard', systemConfigAuth, bodyParser.json(), async (req, res) => {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, error: 'Code is required' });
        try {
            const response = await axios.post('https://ygyicozjewxbyixtpjlo.supabase.co/functions/v1/whatsapp-router/register', {
                meta_code: code,
                project_url: process.env.PROJECT_URL,
                project_id: process.env.RAILWAY_PROJECT_ID,
                app_id: process.env.META_APP_ID,
                app_secret: process.env.META_APP_SECRET
            });
            const data = response.data;
            const result = await HistoryHandler.saveMetaOnboardingData(
                data.phoneNumberId || data.phone_number_id || "PENDING", 
                data.wabaId || data.waba_id || "PENDING",
                data.accessToken || data.access_token,
                { ...data, syncedBy: 'duskcodes-master-router' }
            );
            res.json(result);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- SYNC ASSISTANT PROMPT ---

    app.post('/api/backoffice/sync-assistant-prompt', systemConfigAuth, bodyParser.json(), async (req, res) => {
        const { assistantId } = req.body;
        if (!assistantId) return res.status(400).json({ success: false, error: 'assistantId is required' });

        try {
            console.log(`📡 [SYNC] Obteniendo instrucciones para el asistente: ${assistantId}`);
            const assistant = await openaiMain.beta.assistants.retrieve(assistantId);
            
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
    app.get('/api/backoffice/get-setting', backofficeAuth, async (req, res) => {
        const key = req.query.key as string;
        if (!key) return res.status(400).json({ success: false, error: 'key is required' });
        try {
            const value = await HistoryHandler.getSetting(key);
            res.json({ success: true, value });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/save-setting', backofficeAuth, bodyParser.json(), async (req, res) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ success: false, error: 'key is required' });
        try {
            await HistoryHandler.saveSetting(key, value);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/settings', backofficeAuth, async (req, res) => {
        try {
            const keys = ['WHATSAPP_VISIBLE', 'INSTAGRAM_VISIBLE', 'MESSENGER_VISIBLE', 'CRM_VISIBLE'];
            const results: any = {};
            for (const key of keys) {
                results[key] = await HistoryHandler.getSetting(key);
            }
            res.json(results);
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- GET STORED PROMPT ---
    app.get('/api/backoffice/get-prompt', systemConfigAuth, async (req, res) => {
        try {
            const index = req.query.index || '1';
            const settingKey = index === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${index}`;
            const envKey = index === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${index}`;
            
            const prompt = await HistoryHandler.getSetting(settingKey);
            res.json({ 
                success: true, 
                prompt: prompt || '',
                assistantId: process.env[envKey] || ''
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- UPDATE PROMPT WITHOUT RESTART ---
    app.post('/api/backoffice/update-prompt', systemConfigAuth, bodyParser.json(), async (req, res) => {
        const { prompt, index } = req.body;
        const idx = index || '1';
        if (prompt === undefined) return res.status(400).json({ success: false, error: 'prompt is required' });

        try {
            const settingKey = idx === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${idx}`;
            const envKey = idx === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${idx}`;
            const assistantId = process.env[envKey];

            console.log(`📡 [HOT-UPDATE] Actualizando prompt para Asistente ${idx} en base de datos...`);
            await HistoryHandler.saveSetting(settingKey, prompt);

            // Sincronizar hacia OpenAI (Empujar cambio al dashboard de OpenAI)
            if (assistantId && openaiMain) {
                console.log(`📡 [SYNC] Empujando nuevo prompt hacia OpenAI Assistant: ${assistantId}`);
                await openaiMain.beta.assistants.update(assistantId, {
                    instructions: prompt
                });
                console.log(`✅ [SYNC] Prompt de Asistente ${idx} actualizado en OpenAI exitosamente.`);
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
    app.get('/api/backoffice/get-docs', backofficeAuth, async (req, res) => {
        try {
            // Buscamos la ruta absoluta real
            const rootDir = process.cwd();
            const docsPath = path.join(rootDir, 'docs', 'INSTRUCCIONES_USO.md');
            
            console.log(`📂 [Docs] Intentando cargar: ${docsPath}`);

            if (fs.existsSync(docsPath)) {
                const content = fs.readFileSync(docsPath, 'utf8');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, content }));
            } else {
                console.error(`❌ [Docs] Archivo no encontrado en: ${docsPath}`);
                // Intentar ruta alternativa por si acaso (dist/../docs)
                const altPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', 'docs', 'INSTRUCCIONES_USO.md');
                if (fs.existsSync(altPath)) {
                    const content = fs.readFileSync(altPath, 'utf8');
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, content }));
                } else {
                    res.status(404).json({ success: false, error: `Archivo no encontrado en root o alt. Path: ${docsPath}` });
                }
            }
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
};
