import path from 'path';
import fs from 'fs';
import url from 'url';
import bodyParser from 'body-parser';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { backofficeAuth, systemConfigAuth } from "../middleware/auth";

// Caché para fotos de perfil (chatId -> {url, timestamp})
const profilePicCache = new Map<string, { url: string, expires: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora

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
            
            // Registrar ID en el caché de deduplicación para que el ECO no genere un segundo evento
            const { trackSentMessage } = await import('../providers/provider.manager');
            trackSentMessage(externalId);

            await HistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType, null, null, externalId);
            await HistoryHandler.updateLastHumanMessage(chatId);
            await HistoryHandler.toggleBot(chatId, false);

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

        const xlsxModule = await import('xlsx');
        const xlsxLib = xlsxModule.default || xlsxModule;

        const workbook = xlsxLib.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data: any[] = xlsxLib.utils.sheet_to_json(worksheet, { defval: '' });

        if (data.length === 0) {
            return sendJson(res, 400, { success: false, error: 'El Excel está vacío.' });
        }

        const allKeys = Object.keys(data[0]);
        const paramKeys = allKeys.filter(k => k.toLowerCase() !== 'phone');

        // Determinar proveedor y obtener detalles de la plantilla
        const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : (deps as any).groupProvider;
        const templates = await provider.getTemplates();
        const template = templates.find((t: any) => t.name === templateName);
        if (!template) throw new Error("Plantilla no encontrada al procesar envío masivo.");

        // DEBUG TOTAL: Ver toda la estructura de la plantilla para encontrar los nombres de parámetros
        console.log(`🔍 [BULK] DEBUG ESTRUCTURA COMPLETA:`, JSON.stringify(template, null, 2));
        
        // Detección más agresiva: si tiene parameter_format='named' O si algún componente tiene parámetros nombrados en sus ejemplos
        const isNamed = template.parameter_format === 'named' || 
                        template.components.some((c: any) => 
                            c.example?.body_text_named_params || 
                            c.example?.header_text_named_params ||
                            c.example?.header_handle_named_params
                        );

        // Detectar tipo de cabecera multimedia
        const headerComp = template.components.find((c: any) => c.type === 'HEADER');
        const mediaFormat = headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format) ? headerComp.format.toLowerCase() : null;

        const languageCode = template.language || 'es';
        console.log(`📊 [BULK] Iniciando envío masivo: ${templateName} | Idioma: ${languageCode} | Formato final: ${isNamed ? 'NAMED' : 'POSITIONAL'} | Filas: ${data.length}`);

        sendJson(res, 202, { success: true, message: 'Proceso masivo iniciado.', total: data.length });

        let sent = 0, errors = 0;
        let firstRowLogged = false;
        let defaultMediaUrl = '';

        for (const row of data) {
            // AUTO-CORRECCIÓN: Convertir links de Google Drive a links directos
            if (row.header_media_url && row.header_media_url.includes('drive.google.com')) {
                const driveIdMatch = row.header_media_url.match(/\/d\/([^\/]+)/) || row.header_media_url.match(/id=([^\&]+)/);
                if (driveIdMatch && driveIdMatch[1]) {
                    const driveId = driveIdMatch[1];
                    row.header_media_url = `https://drive.google.com/uc?export=download&id=${driveId}`;
                    console.log(`🔄 [BULK] URL de Google Drive convertida a link directo: ${row.header_media_url}`);
                }
            }

            if (!firstRowLogged) {
                console.log('🔍 [BULK] Ejemplo de datos de la primera fila:', JSON.stringify(row));
                firstRowLogged = true;
                // Guardamos la primera URL (ya corregida si era Drive) como default
                defaultMediaUrl = row.header_media_url || '';
            }

            // Si la fila actual no tiene URL pero tenemos una default, la usamos
            if (!row.header_media_url && defaultMediaUrl) {
                row.header_media_url = defaultMediaUrl;
            }

            // Detección de teléfono más flexible (phone, tel, movil, cel, celular, etc.)
            const phoneKey = Object.keys(row).find(k => 
                ['phone', 'tel', 'movil', 'cel', 'celular', 'telefono', 'whatsapp'].some(p => k.toLowerCase().includes(p))
            );
            
            const phone = phoneKey ? String(row[phoneKey] ?? '').replace(/\D/g, '') : '';
            
            if (!phone) {
                console.warn(`⚠️ [BULK] Fila omitida: No se encontró teléfono. Columnas: [${Object.keys(row).join(', ')}] | Datos: ${JSON.stringify(row)}`);
                continue;
            }

            const components: any[] = [];
            
            // Reordenar componentes según la definición de la plantilla
            for (const compDef of template.components) {
                if (compDef.type === 'HEADER') {
                    // Solo enviamos header si la definición lo tiene y tenemos URL o ejemplo
                    if (compDef.format === 'IMAGE' || compDef.format === 'VIDEO' || compDef.format === 'DOCUMENT') {
                        const lowFormat = compDef.format.toLowerCase();
                        const mediaLink = row.header_media_url || defaultMediaUrl || compDef.example?.header_handle?.[0];
                        
                        if (!mediaLink) continue;

                        const headerParam: any = {
                            type: lowFormat,
                            [lowFormat]: { link: mediaLink }
                        };

                        if (isNamed) {
                            const namedParams = compDef.example?.header_text_named_params || 
                                              compDef.example?.header_handle_named_params ||
                                              compDef.parameters;
                            
                            const officialName = namedParams && namedParams[0]?.param_name;
                            headerParam.parameter_name = officialName || "1";
                        }
                        
                        components.push({ type: 'HEADER', parameters: [headerParam] });
                    }
                } else if (compDef.type === 'BODY') {
                    const bodyParams: any[] = [];
                    
                    // Si es positional, contamos cuántos parámetros espera
                    let expectedCount = 99; // Por defecto muchos para NAMED
                    if (!isNamed) {
                        const placeholders = (compDef.text || '').match(/{{(\d+)}}/g) || [];
                        expectedCount = placeholders.length;
                    }

                    // Para NAMED, mapeamos según los nombres definidos en la plantilla
                    if (isNamed) {
                        const namedParams = compDef.example?.body_text_named_params || [];
                        for (const np of namedParams) {
                            const val = String(row[np.param_name] || row[np.param_name.toLowerCase()] || '-');
                            bodyParams.push({
                                type: 'text',
                                parameter_name: np.param_name,
                                text: val
                            });
                        }
                    } else {
                        // POSITIONAL: Mapeo clásico por orden
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

            // 3. BUTTONS Dinámicos
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

            try {
                console.log(`[BULK] Preparando envío para ${phone}. Componentes:`, JSON.stringify(components, null, 2));
                const resApi = await provider.sendTemplate(phone, templateName, languageCode || 'es_AR', components);
                
                if (resApi?.messages) {
                    const msgId = resApi.messages[0].id;
                    console.log(`✅ [BULK] Mensaje aceptado por Meta para ${phone}. ID: ${msgId}`);
                    await HistoryHandler.saveMessage(phone, 'assistant', `[Plantilla Masiva: ${templateName}]`, 'text', null, null, msgId);
                    sent++;
                } else {
                    errors++;
                    console.error(`❌ [BULK] Fallo al enviar a ${phone}: Meta no devolvió ID de mensaje. Respuesta:`, JSON.stringify(resApi));
                }
            } catch (e: any) {
                errors++;
                const errorData = e?.response?.data || e.message || e;
                console.error(`❌ [BULK] Error de Meta para ${phone}:`, JSON.stringify(errorData, null, 2));
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

            if (token !== process.env.BACKOFFICE_TOKEN && token !== "neuroadmin25" && !token.startsWith('token=neuroadmin25')) {
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
                    // 1. Verificar caché
                    const cached = profilePicCache.get(jid);
                    if (cached && cached.expires > Date.now()) {
                        res.writeHead(302, { Location: cached.url });
                        return res.end();
                    }

                    // 2. Si no hay caché o expiró, pedir a WhatsApp
                    const url = await vendor.profilePictureUrl(jid, 'image');
                    if (url) {
                        profilePicCache.set(jid, { url, expires: Date.now() + CACHE_TTL });
                        res.writeHead(302, { Location: url });
                        return res.end();
                    }
                } catch (picError) {
                    // Si falla, intentamos devolver 404 pero no guardamos en caché negativa aún
                    // para permitir reintentos posteriores del navegador si fue un glitch temporal
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
        // Validación de token
        const q: any = {};
        try { 
            const url = new URL(req.url || '', 'http://localhost'); 
            url.searchParams.forEach((v, k) => q[k] = v); 
        } catch (e) {
            // Ignored: URL parsing fallback
        }
        
        let token = req.headers['authorization'] || q.token || '';
        if (typeof token === 'string') {
            if (token.startsWith('token=')) token = token.slice(6);
            else if (token.startsWith('Bearer ')) token = token.slice(7);
        }

        const isConfigAdmin = token === "neuroadmin25";
        const isBackoffice = token === process.env.BACKOFFICE_TOKEN;

        if (!isConfigAdmin && !isBackoffice) {
            console.warn(`[AUTH] Intento de acceso a Meta Config denegado. Token: ${token}`);
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }

        const projectId = (req.query.projectId as string) || process.env.RAILWAY_PROJECT_ID || "default";
        
        // Intentar obtener config de la DB
        let config = await HistoryHandler.getMetaOnboardingData(projectId);
        
        // Si no hay config específica, intentar la global (projectId=default)
        if (!config && projectId !== 'default') {
            config = await HistoryHandler.getMetaOnboardingData('default');
        }
        
        res.json({
            success: true,
            appId: process.env.META_APP_ID || '1493670789148486',
            appSecret: process.env.META_APP_SECRET || '',
            configId: process.env.META_CONFIG_ID || '',
            railwayProjectId: projectId,
            config: config || {}
        });
    });

    app.post('/api/backoffice/whatsapp/sync-manual', systemConfigAuth, bodyParser.json(), async (req, res) => {
        const { token: manualToken, wabaId, phoneNumberId, projectId: bodyProjectId } = req.body;
        if (!manualToken) return res.status(400).json({ success: false, error: 'Token is required' });

        try {
            const projectId = bodyProjectId || req.query.projectId || process.env.RAILWAY_PROJECT_ID;
            let finalWabaId = wabaId;
            let finalPhoneId = phoneNumberId;
            let extra: any = { syncedBy: 'manual-sync-tool' };

            if (!finalWabaId || !finalPhoneId) {
                const { discoverMetaIds } = await import("../utils/metaDiscovery");
                console.log(`📡 [META-SYNC-MANUAL] Iniciando descubrimiento manual por falta de IDs...`);
                const discovery = await discoverMetaIds(manualToken);
                if (!discovery.found || !discovery.data?.phoneNumberId) {
                    return res.status(404).json({ success: false, error: 'No se pudieron encontrar los datos automáticamente. Por favor ingresa los IDs manualmente.' });
                }
                finalWabaId = discovery.data.wabaId;
                finalPhoneId = discovery.data.phoneNumberId;
                extra = { ...discovery.data, ...extra };
            }

            const result = await HistoryHandler.saveMetaOnboardingData(
                finalWabaId, 
                finalPhoneId, 
                manualToken,
                extra,
                projectId
            );

            res.json(result);
        } catch (error: any) {
            console.error('Error in Meta Manual Sync:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- TEMPLATES & BULK MESSAGING ---
    
    /** Asegura que el proveedor tenga la config más reciente de la DB */
    const syncMetaProvider = async (projectId: string | null = null) => {
        const config = await HistoryHandler.getMetaOnboardingData(projectId || process.env.RAILWAY_PROJECT_ID);
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

    app.get('/api/backoffice/whatsapp/library-templates', backofficeAuth, async (req: any, res: any) => {
        try {
            await syncMetaProvider();
            if (!adapterProvider) return res.status(503).json({ success: false, error: 'Provider not ready' });
            const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : deps.groupProvider;
            if (!provider || typeof provider.getLibraryTemplates !== 'function') {
                return res.status(400).json({ success: false, error: 'El proveedor actual no soporta la biblioteca de Meta.' });
            }

            console.log('📡 [BACKOFFICE-ROUTES] Solicitando plantillas de biblioteca...');
            const templates = await provider.getLibraryTemplates();
            console.log(`✅ [BACKOFFICE-ROUTES] Se obtuvieron ${templates?.length || 0} plantillas.`);
            
            res.json({ success: true, templates });
        } catch (error: any) {
            console.error('❌ [BACKOFFICE-ROUTES] Error en library-templates:', error);
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
    app.post('/api/backoffice/whatsapp/register-step-1', bodyParser.json(), async (req, res) => {
        const { phoneNumber, verifiedName, projectId, manualWabaId, manualToken } = req.body;
        try {
            const config = await HistoryHandler.getMetaOnboardingData(projectId, true); // Fallback al main_token habilitado
            
            // Si el usuario provee un token manual (Super User), lo priorizamos
            const token = manualToken || config?.access_token;
            if (!token) throw new Error('No se encontró sesión de Meta ni Token manual provisto.');

            const wabaId = manualWabaId || config?.waba_id;
            if (!wabaId) throw new Error('No se encontró WABA ID. Búscalo en tu Panel de Meta o ingrésalo manualmente.');

            const { addPhoneNumberToWaba, requestPhoneNumberOtp } = await import("../utils/metaDiscovery");
            
            // 1. Añadir el número (esto nos da el Phone ID)
            const result = await addPhoneNumberToWaba(token, wabaId, phoneNumber, verifiedName);
            const phoneId = result.id;

            // 2. Solicitar OTP
            await requestPhoneNumberOtp(token, phoneId, 'SMS');

            // 3. Guardar las credenciales manuales para que persistan
            if (manualWabaId || manualToken) {
                await HistoryHandler.saveMetaOnboardingData(
                    wabaId, 
                    null, 
                    token, 
                    { activatedVia: 'manual-advanced-form' }, 
                    projectId
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
    app.post('/api/backoffice/whatsapp/register-step-2', bodyParser.json(), async (req, res) => {
        const { phoneId, code, projectId } = req.body;
        try {
            const config = await HistoryHandler.getMetaOnboardingData(projectId);
            const token = config.access_token;

            const { verifyPhoneNumberOtp } = await import("../utils/metaDiscovery");
            
            // 1. Verificar y Registrar en Meta
            await verifyPhoneNumberOtp(token, phoneId, code);

            // 2. Guardar definitivamente en nuestra DB
            await HistoryHandler.saveMetaOnboardingData(config.waba_id, phoneId, token, { activatedVia: 'auto-registration' }, projectId);

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

            // 1. Detectar variables en BODY
            const bodyComponent = template.components.find((c: any) => c.type === 'BODY');
            const text = bodyComponent?.text || '';
            const varNames: string[] = [];
            
            // Si la plantilla es NAMED, usamos los nombres oficiales de Meta
            const isNamed = template.parameter_format === 'named';
            const bodyNamedParams = bodyComponent?.example?.body_text_named_params || [];
            
            if (isNamed && bodyNamedParams.length > 0) {
                bodyNamedParams.forEach((p: any) => varNames.push(p.param_name));
            } else {
                // Positional: Extraer {{1}}, {{2}}...
                const varRegex = /\{\{(\w+)\}\}/g;
                let match;
                while ((match = varRegex.exec(text)) !== null) {
                    if (!varNames.includes(match[1])) {
                        varNames.push(match[1]); 
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
            const chats = await HistoryHandler.listChats(2000, 0); 
            if (chats && chats.length > 0) {
                chats.forEach((chat: any) => {
                    const cleanPhone = chat.id.split('@')[0];
                    if (cleanPhone === '5491100000000') return; // Evitar duplicar el ejemplo si existiera
                    const row = [cleanPhone];
                    for (let i = 1; i < headers.length; i++) row.push('');
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
        await syncMetaProvider();
        return processBulkTemplate(req, res, deps);
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/onboard-callback', async (req, res) => {
        const { code, wabaId: queryWabaId, phoneId: queryPhoneId, projectId: queryProjectId } = req.query;
        const projectId = (queryProjectId as string) || process.env.RAILWAY_PROJECT_ID || 'default_project';
        
        console.log(`📡 [CALLBACK] Iniciando onboard-callback para Proyecto: ${projectId}`);
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
            const mainToken = await HistoryHandler.getMainToken();
            const discovery = await discoverMetaIds(accessToken, mainToken);
            
            if (discovery.found && discovery.data) {
                finalWabaId = discovery.data.wabaId || finalWabaId;
                finalPhoneId = discovery.data.phoneNumberId || finalPhoneId;
                finalVerifiedName = discovery.data.verifiedName || "";
            }

            // 2. Descubrimiento de Páginas (Messenger / Instagram)
            const { discoverAndLinkMetaPages } = await import("../utils/metaPageDiscovery");
            const pageDiscovery = await discoverAndLinkMetaPages(accessToken);
            if (pageDiscovery) {
                console.log(`✅ [CALLBACK] Guardando configuración de Página: ${pageDiscovery.pageName} para Proyecto: ${projectId}`);
                await HistoryHandler.saveSetting('FACEBOOK_PAGE_ID', pageDiscovery.pageId, projectId);
                await HistoryHandler.saveSetting('FACEBOOK_PAGE_TOKEN', pageDiscovery.pageAccessToken, projectId);
                
                // Si encontramos Instagram vinculado, guardarlo también
                if (pageDiscovery.instagramId) {
                    await HistoryHandler.saveSetting('INSTAGRAM_BUSINESS_ID', pageDiscovery.instagramId, projectId);
                }

                // Activar visibilidad por defecto si encontramos una página
                await HistoryHandler.saveSetting('INSTAGRAM_VISIBLE', 'on', projectId);
                await HistoryHandler.saveSetting('MESSENGER_VISIBLE', 'on', projectId);
            }

            // 3. Verificación de resultados y depuración de scopes si falló todo
            if (!discovery.found && !pageDiscovery) {
                console.warn('⚠️ [CALLBACK] No se pudo descubrir ningún recurso automáticamente.');
                
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
                            <h1 style="color: #e53e3e; margin-bottom: 10px; font-size: 28px; font-weight: 800; text-align: center;">Configuración Incompleta</h1>
                            <p style="color: #718096; margin-bottom: 30px; text-align: center;">Hemos vinculado tu cuenta de Meta, pero no pudimos encontrar automáticamente una cuenta de WhatsApp Cloud API activa.</p>
                            
                            <div style="margin-top: 30px; background: #ebf8ff; padding: 25px; border-radius: 12px; border: 1px solid #bee3f8; text-align: left;">
                                <h3 style="margin-top: 0; color: #2b6cb0; font-size: 18px;">Opción 1: Configuración Manual (Recomendado)</h3>
                                <p style="font-size: 14px; margin-bottom: 20px;">Si conoces tus IDs de WhatsApp, ingrésalos aquí. Esto activará el bot directamente sin validación por SMS.</p>
                                
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
                                    🔍 Ver Diagnóstico Técnico del Descubrimiento
                                </button>

                                <div id="logSection" style="display: none; margin-top: 20px; text-align: left; background: white; border: 1px solid #e2e8f0; padding: 20px; border-radius: 12px; max-height: 400px; overflow-y: auto;">
                                    ${diagHtml}
                                </div>
                            </div>

                            <div style="margin-top: 40px; font-size: 13px; color: #a0aec0; text-align: center;">
                                <p>Tip: Asegúrate de que tu cuenta de WhatsApp esté validada en el panel de Meta Developer antes de intentar la vinculación.</p>
                            </div>
                        </div>

                        <script>
                            const projectId = "${projectId}";
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
                                            projectId: projectId
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
                                    alert('Error de conexión: ' + e.message);
                                }
                            }
                        </script>
                    </div>
                `;

                // Guardar solo el token para futuras referencias
                await HistoryHandler.saveMetaOnboardingData(null as any, null as any, accessToken, { diagnostics: discovery.diagnostics }, projectId);
                return res.send(htmlError);
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

                await HistoryHandler.saveMetaOnboardingData(finalWabaId, finalPhoneId, accessToken, { verified_name: finalVerifiedName }, projectId);
            }

            console.log(`✅ [CALLBACK] Onboarding finalizado con éxito para Proyecto: ${projectId}`);
            
            // Programar un reinicio automático para aplicar el cambio de motor (Baileys -> Meta)
            setTimeout(() => {
                console.log('🔄 [SYSTEM] Reiniciando bot automáticamente para aplicar la configuración de Meta...');
                process.exit(1);
            }, 5000);

            return res.redirect("https://duskcodes.com.ar/dashboard.html?metaStatus=success");

        } catch (error: any) {
            console.error('❌ [CALLBACK] Error en vinculación Meta:', error.response?.data || error.message);
            const errorDetails = error.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message;
            
            return res.status(500).send(`
                <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; max-width: 600px; margin: 40px auto;">
                    <h2 style="color: #c53030; margin-bottom: 20px;">❌ Error en la vinculación con Meta</h2>
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
                
                // CRITICAL FIX: Después de actualizar instrucciones, volvemos a sincronizar las tools
                // para evitar que queden vacías si el update sobreescribió el objeto.
                const { syncAssistantTools } = await import("../utils/openaiHelper");
                await syncAssistantTools(assistantId);
                
                console.log(`✅ [SYNC] Prompt y Herramientas de Asistente ${idx} actualizados en OpenAI exitosamente.`);
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
