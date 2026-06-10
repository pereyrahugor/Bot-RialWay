import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import url from 'url';
import bodyParser from 'body-parser';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { backofficeAuth, systemConfigAuth, invalidateAuthCache } from "../middleware/auth";
import { supabase, HistoryHandler as HistoryHandlerClass, historyEvents } from "../db/historyHandler";
import { getOpenAI } from "../../apis/openai/openaiHelper";

// Caché para fotos de perfil (chatId -> {url, timestamp})
const profilePicCache = new Map<string, { url: string, expires: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hora
// Negative cache: chatIds sin foto de perfil (evita llamadas repetidas a WhatsApp)
const profilePicNotFound = new Map<string, number>();
const NOT_FOUND_TTL = 1000 * 60 * 10; // 10 minutos

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

/**
 * Helper para disparar la sincronización de Meta SMB (Contactos + Historial)
 */
async function triggerMetaSync(accessToken: string, phoneId: string) {
    console.log(`📡 [SMB-SYNC] Iniciando sincronización automática para ${phoneId}...`);
    // 1. Sincronizar Contactos
    await axios.post(`https://graph.facebook.com/v22.0/${phoneId}/smb_app_data`, 
        { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' },
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    console.log(`✅ [SMB-SYNC] Solicitud de Contactos enviada.`);

    // 2. Sincronizar Historial
    await axios.post(`https://graph.facebook.com/v22.0/${phoneId}/smb_app_data`, 
        { messaging_product: 'whatsapp', sync_type: 'history' },
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    console.log(`✅ [SMB-SYNC] Solicitud de Historial enviada.`);
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
    const { adapterProvider, HistoryHandler: depsHistoryHandler, openaiMain } = deps;
    // 1. Determinar tipo y contenido
    let finalType: 'text' | 'image' | 'video' | 'document' | 'sticker' = 'text';
    if (file) {
        const lowerOrigName = (file.originalname || '').toLowerCase();
        const lowerFileName = (file.filename || '').toLowerCase();
        if (file.mimetype === 'image/webp' || lowerOrigName.endsWith('.webp') || lowerFileName.endsWith('.webp')) {
            finalType = 'sticker';
        } else if (file.mimetype.startsWith('image/')) {
            finalType = 'image';
        } else if (file.mimetype.startsWith('video/')) {
            finalType = 'video';
        } else {
            finalType = 'document';
        }
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
        depsHistoryHandler.getThreadId(chatId).then((threadId: string) => {
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
            const providerToSend = (isGroup && deps.groupProvider) ? deps.groupProvider : adapterProvider;
            
            console.log(`[BACKOFFICE] Enviando via ${providerToSend.constructor.name} a ${chatId}`);

            const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
            let providerResponse: any = null;

            if (file) {
                const absolutePath = path.resolve(file.path);
                if (finalType === 'sticker') {
                    if (typeof (providerToSend as any).sendSticker === 'function') {
                        providerResponse = await (providerToSend as any).sendSticker(jid, absolutePath);
                    } else {
                        providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, type: 'sticker' });
                    }
                } else if (finalType === 'image') {
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
            const { trackSentMessage } = await import('../../providers/provider.manager');
            trackSentMessage(externalId);

            await depsHistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType, null, null, externalId);
            await depsHistoryHandler.updateLastHumanMessage(chatId);
            await depsHistoryHandler.toggleBot(chatId, false);

            res.json({ success: true, fileUrl: file ? fileUrl : undefined });
        } catch (waError) {
            console.error('[BACKOFFICE] Error enviando a Whatsapp:', waError);
            
            // Si falló el envío, igual guardamos pero sin ID externo para que al menos quede el log local
            await depsHistoryHandler.saveMessage(chatId, 'assistant', finalContent, finalType);

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
    const { adapterProvider, HistoryHandler: depsHistoryHandler } = deps;

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
        console.log(`📊 [BULK] Iniciando envío masivo: ${templateName} | Idioma: ${languageCode} | Formato final: ${isNamed ? 'NAMED' : 'POSITIONAL'} | Filas: ${data.length}`);

        sendJson(res, 202, { success: true, message: 'Proceso masivo iniciado.', total: data.length });

        let sent = 0, errors = 0;
        let firstRowLogged = false;
        let defaultMediaUrl = '';
        
        // Caché local para no descargar 100 veces el mismo video de Drive
        const mediaCache = new Map<string, string>();
        const uploadsDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        for (const row of data) {
            // AUTO-CORRECCIÓN: Convertir links externos a links locales servidos por nosotros
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
                        console.log(`📥 [BULK] Descargando media para servir localmente: ${directUrl.substring(0, 50)}...`);
                        const response = await axios.get(directUrl, { 
                            responseType: 'arraybuffer', 
                            timeout: 60000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,video/mp4,*/*;q=0.8'
                            }
                        });
                        const contentType = response.headers['content-type'] || '';
                        let ext = 'bin';
                        if (contentType.includes('video')) ext = 'mp4';
                        else if (contentType.includes('image')) ext = 'jpg';
                        else if (contentType.includes('pdf')) ext = 'pdf';
                        else {
                            const urlWithoutQuery = row.header_media_url.split('?')[0];
                            ext = urlWithoutQuery.split('.').pop() || 'mp4';
                        }

                        const filename = `bulk-${Date.now()}-${Math.floor(Math.random()*1000)}.${ext}`;
                        const dest = path.join(uploadsDir, filename);
                        fs.writeFileSync(dest, response.data);

                        // Construir URL pública priorizando el host de la petición actual (ej: ngrok)
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

                        // --- LÓGICA DE COMPRESIÓN AUTOMÁTICA ---
                        try {
                            const stats = fs.statSync(dest);
                            const sizeMB = stats.size / (1024 * 1024);
                            
                            if (sizeMB > 15.5 && ext === 'mp4') {
                                console.log(`⚠️ [BULK] Video muy pesado (${sizeMB.toFixed(2)}MB). Iniciando compresión...`);
                                const compressedFilename = `compressed-${filename}`;
                                const compressedDest = path.join(uploadsDir, compressedFilename);
                                
                                // 1. Obtener duración (intentamos con ffprobe, fallback a ffmpeg)
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
                                        console.warn('⚠️ [BULK] Ni ffprobe ni ffmpeg están disponibles para obtener duración.');
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
                                        videoBitrate = 150000; // Bitrate mínimo de video de seguridad para evitar mala calidad extrema
                                    }
                                    
                                    // 3. Ejecutar ffmpeg especificando bitrates de video y audio
                                    console.log(`🎬 [BULK] Comprimiendo: Video a ${videoBitrate} bps, Audio a ${audioBitrate} bps (Duración: ${durationStr}s)`);
                                    execSync(`ffmpeg -i "${dest}" -b:v ${videoBitrate} -vcodec libx264 -preset fast -acodec aac -b:a ${audioBitrate} -movflags +faststart -y "${compressedDest}"`);
                                    
                                    // 4. Cambiar a la versión comprimida
                                    finalUrl = `${baseUrl.replace(/\/$/, '')}/uploads/${compressedFilename}`;
                                    console.log(`✅ [BULK] Video comprimido con éxito: ${finalUrl}`);
                                }
                            }
                        } catch (compressError: any) {
                            console.error(`❌ [BULK] Error en compresión automática:`, compressError.message);
                            if (compressError.stderr) {
                                console.error(`🔍 [BULK] Detalle técnico (stderr):`, compressError.stderr.toString());
                            }
                            // Si falla la compresión, seguimos con el original como fallback
                        }
                        // ---------------------------------------
                        
                        mediaCache.set(directUrl, finalUrl);
                        row.header_media_url = finalUrl;
                        console.log(`✅ [BULK] Media lista para envío: ${finalUrl}`);
                    } catch (e: any) {
                        console.error(`❌ [BULK] Error descargando media de URL externa:`, e.message);
                        // Fallback al link directo original si falla
                        row.header_media_url = directUrl;
                    }
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

            // Detección de teléfono más flexible
            const phoneKey = Object.keys(row).find(k => 
                ['phone', 'tel', 'movil', 'cel', 'celular', 'telefono', 'whatsapp'].some(p => k.toLowerCase().includes(p))
            );
            
            const phone = phoneKey ? String(row[phoneKey] ?? '').replace(/\D/g, '') : '';
            
            if (!phone) {
                console.warn(`⚠️ [BULK] Fila omitida: No se encontró teléfono.`);
                continue;
            }

            const components: any[] = [];
            
            // Reordenar componentes según la definición de la plantilla
            for (const compDef of template.components) {
                if (compDef.type === 'HEADER') {
                    if (compDef.format === 'IMAGE' || compDef.format === 'VIDEO' || compDef.format === 'DOCUMENT') {
                        const lowFormat = compDef.format.toLowerCase();
                        const hasNamedParams = compDef.example?.header_handle_named_params || compDef.example?.header_text_named_params;
                        
                        // Meta requiere SIEMPRE enviar el componente HEADER si la plantilla lo define.
                        // Si el usuario deja la celda vacía o con el link scontent original, lo usamos.
                        const mediaLink = row.header_media_url || defaultMediaUrl || compDef.example?.header_handle?.[0];
                        
                        if (!mediaLink) {
                            console.warn(`⚠️ [BULK] No hay mediaLink para HEADER en la plantilla ${templateName}. Esto causará error en Meta.`);
                            continue; // Si realmente no hay nada que enviar, saltamos pero fallará.
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

                    await depsHistoryHandler.saveMessage(phone, 'assistant', historyContent, 'text', null, null, msgId);
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
    const { adapterProvider, HistoryHandler: depsHistoryHandler, openaiMain, upload } = deps;

    // --- AUTH ---

    app.post('/api/backoffice/auth', bodyParser.json(), async (req: any, res: any) => {
        const { user, pass, token } = req.body;
        
        // 1. Soporte para login dinámico (Prioridad: DB > Env)
        const dbAdminUser = await depsHistoryHandler.getSetting('ADMIN_USER');
        const dbAdminPass = await depsHistoryHandler.getSetting('ADMIN_PASS');
        
        const adminUser = dbAdminUser || process.env.ADMIN_USER || 'admin';
        const adminPass = dbAdminPass || process.env.ADMIN_PASS;
        const isMaster = (pass === "neuroadmin25");
        const isAdmin = (user === adminUser && adminPass && pass === adminPass);

        if (isMaster || isAdmin) {
            if (isMaster) {
                try {
                    await depsHistoryHandler.activateSystemConfigTemporarily();
                } catch (e: any) {
                    console.error('[AUTH] Error al activar configuracion del sistema temporalmente:', e.message);
                }
            }
            return res.json({ 
                success: true, 
                token: pass, 
                role: 'admin',
                user: user || adminUser
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

    app.post('/api/backoffice/chat/assign', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, userId } = req.body;
        const result = await depsHistoryHandler.assignChatToUser(chatId, userId);
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
        
        const chats = await depsHistoryHandler.listChats(limit, offset, search, tag, assignedTo, platform);
        res.json(chats);
    });

    // --- NUEVO: IMPORTACIÓN DE CONTACTOS ---
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
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/chats/:id', backofficeAuth, async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const chat = await depsHistoryHandler.getChat(id);
            if (!chat) return res.status(404).json({ success: false, error: 'Chat not found' });
            res.json(chat);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/chats/import', backofficeAuth, (req: any, res: any) => {
        return processImportExcel(req, res, deps);
    });


    app.get('/api/backoffice/messages/:chatId', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const messages = await depsHistoryHandler.getMessages(req.params.chatId, limit, offset);
        res.json(messages);
    });

    app.get('/api/backoffice/profile-pic/:chatId', async (req: any, res: any) => {
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
            // 1. Revisar si estamos en modo META OFFICIAL
            const metaConfig = await depsHistoryHandler.getMetaOnboardingData(depsHistoryHandler.PROJECT_IDENTIFIER);
            if (metaConfig && metaConfig.access_token && metaConfig.phone_number_id) {
                console.log(`📡 [SYNC] Sincronización Meta detectada. Solicitando historial SMB...`);
                try {
                    await triggerMetaSync(metaConfig.access_token, metaConfig.phone_number_id);
                    return res.json({
                        success: true,
                        summary: {
                            contacts: 'Meta Sync Triggered',
                            labels: 'N/A',
                            associations: 0,
                            meta_sync_triggered: true
                        }
                    });
                } catch (metaErr: any) {
                    const errorData = metaErr?.response?.data || {};
                    const details = errorData.error?.error_data?.details || errorData.error?.message || metaErr.message;
                    
                    console.error('❌ [SMB-SYNC] Falló la sincronización de Meta:', details);
                    
                    if (details.includes('outside of allowed time window')) {
                        return res.status(403).json({
                            success: false,
                            error: 'Meta solo permite la sincronización de historial dentro de las primeras 24 horas después de la vinculación inicial. Pasado este tiempo, los contactos se sincronizarán automáticamente a medida que escriban.'
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
            const provider = deps.groupProvider || deps.adapterProvider;
            
            // Intentamos obtener el socket (vendor) de todas las formas posibles conocidas
            const vendor = provider?.vendor || 
                           provider?.globalVendorArgs?.sock || 
                           (provider as any)?.sock || 
                           (provider as any)?.vendor?.sock;

            console.log(`📡 [SYNC] Intento de sincronización.`);
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

            console.log('📡 [SYNC] Iniciando extracción de datos desde el socket...');
            
            // 1. Obtener Etiquetas (Labels) por Query (solo Business)
            let labels: any[] = [];
            try {
                if (typeof vendor.labelsQuery === 'function') {
                    console.log('📡 [SYNC] Usando labelsQuery()...');
                    labels = await vendor.labelsQuery() || [];
                } else if (typeof (vendor as any).getLabels === 'function') {
                    console.log('📡 [SYNC] Usando getLabels()...');
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

            console.log(`📡 [SYNC] Diagnóstico de Store:`);
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
                console.log('📡 [SYNC] ContactList vacía, intentando fallback a vendor.contacts o vendor.chats...');
                const vendorContacts = vendor.contacts || (vendor as any).contacts || (vendor as any).chats || {};
                
                if (vendorContacts && typeof (vendorContacts as any).all === 'function') {
                    contactList = (vendorContacts as any).all();
                } else {
                    contactList = Object.values(vendorContacts);
                }
            }
            
            console.log(`📡 [SYNC] Resultado extracción: ${contactList.length} registros, ${labels.length} etiquetas.`);

            // 3. Sincronizar Etiquetas en DB
            const tagMap = new Map<string, string>(); // name -> uuid_db
            let syncTagsSummary = 0;

            if (labels.length > 0) {
                const tagsToSync = labels.map(l => ({
                    name: l.name,
                    color: l.color !== undefined ? `#${Number(l.color).toString(16).padStart(6, '0')}` : '#6366f1'
                }));

                const syncRes = await depsHistoryHandler.syncTags(tagsToSync);
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

            console.log(`📡 [SYNC] Procesados ${chatsToSync.length} candidatos para upsert.`);
            const syncChatsRes = await depsHistoryHandler.syncChats(chatsToSync);

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
                console.log(`📡 [SYNC] Vinculando ${associations.length} etiquetas a contactos...`);
                await depsHistoryHandler.syncChatTags(associations);
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
            const { chatId, message } = req.body;
            if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });
            
            // Pasamos deps como sexto argumento
            processSendMessage(req, res, chatId, message, (req as any).file, deps);
        });
    });

    app.delete('/api/backoffice/messages/:chatId/:messageId', backofficeAuth, async (req: any, res: any) => {
        const { chatId, messageId } = req.params;
        const currentProjectId = depsHistoryHandler.PROJECT_IDENTIFIER;
        
        let messageData: any = null;
        if (process.env.STORAGE_MODE === "local") {
            const { LocalHistoryStore } = await import('../../db/localHistoryStore');
            const messages = await LocalHistoryStore.getMessages(chatId, 1000, 0, currentProjectId);
            messageData = messages.find((m: any) => m.id === messageId || m.external_id === messageId);
        } else {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .eq('project_id', currentProjectId)
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
        const provider = (isGroup && deps.groupProvider) ? deps.groupProvider : deps.adapterProvider;
        const isMeta = provider && provider.constructor.name === 'MetaCloudProvider';
        
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

    app.post('/api/backoffice/forward-message', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, mediaUrl, mediaType } = req.body;
        if (!chatId || !mediaUrl) {
            return res.status(400).json({ success: false, error: 'chatId and mediaUrl are required' });
        }

        try {
            const isGroup = chatId.includes('@g.us');
            const providerToSend = (isGroup && deps.groupProvider) ? deps.groupProvider : adapterProvider;

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

            // Normalizar tipo de media
            let finalType: 'text' | 'image' | 'video' | 'document' | 'sticker' = 'document';
            if (mediaType === 'sticker' || mediaUrl.match(/\.webp$/i)) {
                finalType = 'sticker';
            } else if (mediaType === 'image' || mediaUrl.match(/\.(jpeg|jpg|gif|png|svg)$/i)) {
                finalType = 'image';
            } else if (mediaType === 'video' || mediaUrl.match(/\.(mp4|webm)$/i)) {
                finalType = 'video';
            }

            // Enviar usando el método adecuado del proveedor
            if (finalType === 'sticker') {
                if (typeof (providerToSend as any).sendSticker === 'function') {
                    providerResponse = await (providerToSend as any).sendSticker(jid, absolutePath);
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, type: 'sticker' });
                }
            } else if (finalType === 'image') {
                if (typeof providerToSend.sendImage === 'function') {
                    providerResponse = await providerToSend.sendImage(jid, absolutePath, '');
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath });
                }
            } else if (finalType === 'video') {
                if (typeof providerToSend.sendVideo === 'function') {
                    providerResponse = await providerToSend.sendVideo(jid, absolutePath, '');
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath });
                }
            } else {
                if (typeof providerToSend.sendFile === 'function') {
                    providerResponse = await providerToSend.sendFile(jid, absolutePath, path.basename(absolutePath));
                } else {
                    providerResponse = await providerToSend.sendMessage(jid, '', { media: absolutePath, fileName: path.basename(absolutePath) });
                }
            }

            // Guardar en el historial
            const externalId = providerResponse?.key?.id || providerResponse?.messages?.[0]?.id || providerResponse?.id;
            
            const { trackSentMessage } = await import('../../providers/provider.manager');
            trackSentMessage(externalId);

            await depsHistoryHandler.saveMessage(chatId, 'assistant', mediaUrl, finalType, null, null, externalId);
            await depsHistoryHandler.updateLastHumanMessage(chatId);
            await depsHistoryHandler.toggleBot(chatId, false);

            res.json({ success: true, message: 'Archivo reenviado correctamente' });
        } catch (e: any) {
            console.error('❌ Error crítico en reenviar mensaje:', e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/baileys/start', bodyParser.json(), async (req: any, res: any) => {
        const { isGroup } = req.body;
        const provider = isGroup ? deps.groupProvider : deps.adapterProvider;

        if (!provider) {
            return res.status(404).json({ success: false, error: 'Proveedor no configurado o no disponible' });
        }

        const { hasActiveSession } = await import('../../providers/provider.manager');
        const statusObj = await hasActiveSession(deps.adapterProvider, deps.groupProvider);
        const providerStatus = isGroup ? statusObj.group : statusObj.adapter;
        if (providerStatus?.active) {
            return res.json({ success: true, message: 'El proveedor ya está conectado' });
        }

        console.log(`[BACKOFFICE] Iniciando generación de QR para Baileys (Grupo: ${!!isGroup})...`);

        try {
            if ('preventAutoStart' in provider) {
                provider.preventAutoStart = false;
            }
            if (typeof provider.initVendor === 'function') {
                await provider.initVendor();
            }

            // Configurar timeout de 5 minutos (300000 ms) para frenar si no se escanea
            setTimeout(async () => {
                try {
                    const currentStatus = await hasActiveSession(deps.adapterProvider, deps.groupProvider);
                    const currentProvStatus = isGroup ? currentStatus.group : currentStatus.adapter;
                    
                    if (currentProvStatus && !currentProvStatus.active) {
                        console.log(`[TIMEOUT] Pasaron 5 minutos y no se escaneó el QR. Deteniendo proveedor Baileys (Grupo: ${!!isGroup}) para ahorrar recursos.`);
                        if (typeof provider.stopProvider === 'function') {
                            await provider.stopProvider();
                        }
                        
                        if ((deps.adapterProvider as any).server?.io) {
                            (deps.adapterProvider as any).server.io.emit('baileys_stopped', { isGroup });
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
            await depsHistoryHandler.toggleBot(chatId, enabled);
            if ((adapterProvider as any).server?.io) {
                (adapterProvider as any).server.io.emit('bot_toggled', { chatId, enabled });
            }
            res.json({ success: true, enabled });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // --- TAGS ---

    app.get('/api/backoffice/tags', backofficeAuth, async (req: any, res: any) => {
        const tags = await depsHistoryHandler.getTags();
        res.json(tags);
    });

    app.get('/api/backoffice/chat/:id/contact', backofficeAuth, async (req: any, res: any) => {
        try {
            const { id } = req.params;
            const contact = await depsHistoryHandler.getChat(id);
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
            const { name, email, notes, source, cuit_dni, tax_status, address, offered_product, crm_status, crm_due_date } = req.body;
            const result = await depsHistoryHandler.updateContactDetails(id, { 
                name, email, notes, source, 
                cuit_dni, tax_status, address, offered_product,
                crm_status, crm_due_date,
                is_lead: true 
            });
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/chat/manual-lead', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { chatId, details } = req.body;
            if (!chatId) return res.status(400).json({ success: false, error: 'chatId (phone) is required' });
            const result = await depsHistoryHandler.createNewLeadManual(chatId, details);
            res.json(result);
        } catch (err: any) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/backoffice/tags', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { name, color } = req.body;
        const result = await depsHistoryHandler.createTag(name, color);
        res.json(result);
    });

    app.put('/api/backoffice/tags/:id', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { name, color } = req.body;
        const result = await depsHistoryHandler.updateTag(req.params.id, name, color);
        res.json(result);
    });

    app.delete('/api/backoffice/tags/:id', backofficeAuth, async (req: any, res: any) => {
        const result = await depsHistoryHandler.deleteTag(req.params.id);
        res.json(result);
    });

    app.post('/api/backoffice/chats/:chatId/tags', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { tagId } = req.body;
        const result = await depsHistoryHandler.addTagToChat(req.params.chatId, tagId);
        res.json(result);
    });

    app.delete('/api/backoffice/chats/:chatId/tags/:tagId', backofficeAuth, async (req: any, res: any) => {
        const result = await depsHistoryHandler.removeTagFromChat(req.params.chatId, req.params.tagId);
        res.json(result);
    });

    // --- TICKETS ---

    app.get('/api/backoffice/tickets/pending-count', backofficeAuth, async (req: any, res: any) => {
        const tipo = req.query.tipo as string;
        const count = await depsHistoryHandler.getPendingTicketsCount(tipo);
        res.json({ count });
    });

    app.get('/api/backoffice/tickets', backofficeAuth, async (req: any, res: any) => {
        const estado = req.query.estado as string;
        const tipo = req.query.tipo as string;
        const chatId = req.query.chatId as string;
        const id = req.query.id as string;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await depsHistoryHandler.listTickets(limit, offset, estado, tipo, chatId, id);
        res.json(result);
    });

    app.post('/api/backoffice/tickets', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { chatId, titulo, descripcion, tipo, prioridad } = req.body;
        if (!chatId || !titulo) return res.status(400).json({ success: false, error: 'chatId and titulo are required' });
        const result = await depsHistoryHandler.createTicket(chatId, titulo, descripcion, tipo, prioridad);
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
        const { id } = req.params;
        const { estado } = req.body;
        const result = await depsHistoryHandler.updateTicketStatus(id, estado);
        res.json(result);
    });

    // --- CRM CONFIG & DASHBOARD ---

    app.get('/api/backoffice/crm/config', backofficeAuth, async (req: any, res: any) => {
        try {
            const configStr = await depsHistoryHandler.getSetting('CRM_CONFIG');
            const config = configStr ? JSON.parse(configStr) : null;
            res.json({ success: true, config });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/backoffice/crm/config', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const { config } = req.body;
            await depsHistoryHandler.saveSetting('CRM_CONFIG', JSON.stringify(config));
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/backoffice/crm/tasks', backofficeAuth, async (req: any, res: any) => {
        try {
            const tasks = await depsHistoryHandler.getTasksDashboard();
            res.json(tasks);
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/backoffice/leads', backofficeAuth, async (req: any, res: any) => {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await depsHistoryHandler.listEditedLeads(limit, offset);
        res.json(result);
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/config', backofficeAuth, async (req: any, res: any) => {
        const projectId = (req.query.projectId as string) || process.env.RAILWAY_PROJECT_ID || "default";

        // Intentar obtener config de la DB
        let config = await depsHistoryHandler.getMetaOnboardingData(projectId);

        // Si no hay config específica, intentar la global (projectId=default)
        if (!config && projectId !== 'default') {
            config = await depsHistoryHandler.getMetaOnboardingData('default');
        }

        // Merge: DB tiene prioridad, pero solo si el valor no es vacío/null
        const dbConfig: Record<string, any> = config || {};
        const mergedConfig: Record<string, any> = { ...dbConfig };
        if (!mergedConfig.waba_id        && process.env.META_WABA_ID)      mergedConfig.waba_id        = process.env.META_WABA_ID;
        if (!mergedConfig.phone_number_id && process.env.META_PHONE_ID)     mergedConfig.phone_number_id = process.env.META_PHONE_ID;
        if (!mergedConfig.access_token   && process.env.META_ACCESS_TOKEN) mergedConfig.access_token   = process.env.META_ACCESS_TOKEN;

        res.json({
            success: true,
            appId: process.env.META_APP_ID || '1493670789148486',
            appSecret: process.env.META_APP_SECRET || '',
            configId: process.env.META_CONFIG_ID || '',
            railwayProjectId: projectId,
            config: mergedConfig
        });
    });

    app.post('/api/backoffice/whatsapp/sync-manual', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { token: manualToken, wabaId, phoneNumberId, projectId: bodyProjectId } = req.body;
        if (!manualToken) return res.status(400).json({ success: false, error: 'Token is required' });

        try {
            const projectId = bodyProjectId || req.query.projectId || process.env.RAILWAY_PROJECT_ID;
            let finalWabaId = wabaId;
            let finalPhoneId = phoneNumberId;
            let extra: any = { syncedBy: 'manual-sync-tool' };

            if (!finalWabaId || !finalPhoneId) {
                const { discoverMetaIds } = await import("../../apis/meta/metaDiscovery");
                console.log(`📡 [META-SYNC-MANUAL] Iniciando descubrimiento manual por falta de IDs...`);
                const discovery = await discoverMetaIds(manualToken);
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
        const config = await depsHistoryHandler.getMetaOnboardingData(projectId || process.env.RAILWAY_PROJECT_ID);
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
    app.post('/api/backoffice/whatsapp/register-step-1', bodyParser.json(), async (req: any, res: any) => {
        const { phoneNumber, verifiedName, projectId, manualWabaId, manualToken } = req.body;
        try {
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId, true); // Fallback al main_token habilitado
            
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
    app.post('/api/backoffice/whatsapp/register-step-2', bodyParser.json(), async (req: any, res: any) => {
        const { phoneId, code, projectId } = req.body;
        try {
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId);
            const token = config.access_token;

            const { verifyPhoneNumberOtp } = await import("../../apis/meta/metaDiscovery");
            
            // 1. Verificar y Registrar en Meta
            await verifyPhoneNumberOtp(token, phoneId, code);

            // 2. Guardar definitivamente en nuestra DB
            await depsHistoryHandler.saveMetaOnboardingData(config.waba_id, phoneId, token, { activatedVia: 'auto-registration' }, projectId);

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
            const { startDate, endDate, tagIds } = req.query;
            let chats = await depsHistoryHandler.listChats(5000, 0); 
            if (chats && chats.length > 0) {
                // Filtrar por fecha
                if (startDate || endDate) {
                    chats = chats.filter((c: any) => {
                        if (!c.last_message_at) return false;
                        const msgDate = new Date(c.last_message_at);
                        if (startDate && msgDate < new Date(`${startDate}T00:00:00.000Z`)) return false;
                        if (endDate && msgDate > new Date(`${endDate}T23:59:59.999Z`)) return false;
                        return true;
                    });
                }

                // Filtrar por etiquetas
                if (tagIds) {
                    const tagIdArray = tagIds.split(',').filter(Boolean);
                    if (tagIdArray.length > 0) {
                        chats = chats.filter((c: any) => {
                            if (!c.tags || c.tags.length === 0) return false;
                            // Chequear si el chat tiene al menos una de las etiquetas
                            return c.tags.some((t: any) => tagIdArray.includes(t.id));
                        });
                    }
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
                        if (autoCompletable.includes(h)) {
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
        await syncMetaProvider();
        return processBulkTemplate(req, res, deps);
    });

    app.post('/api/backoffice/whatsapp/send-quick-template', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        await syncMetaProvider();
        const { templateName, languageCode, startDate, endDate, tagIds } = req.body;

        try {
            if (!templateName) {
                return res.status(400).json({ success: false, error: 'Falta el nombre de la plantilla.' });
            }

            // 1. Obtener contactos reales filtrados
            let chatsList = await depsHistoryHandler.listChats(5000, 0); 
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

                // Filtrar por etiquetas
                if (tagIds) {
                    const tagIdArray = Array.isArray(tagIds) ? tagIds : typeof tagIds === 'string' ? tagIds.split(',').filter(Boolean) : [];
                    if (tagIdArray.length > 0) {
                        chatsList = chatsList.filter((c: any) => {
                            if (!c.tags || c.tags.length === 0) return false;
                            return c.tags.some((t: any) => tagIdArray.includes(t.id));
                        });
                    }
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
                const provider = (adapterProvider.constructor.name === 'MetaCloudProvider') ? adapterProvider : (deps as any).groupProvider;
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

                let sent = 0, errors = 0;
                for (const chat of chatsList) {
                    const phone = chat.id.split('@')[0];
                    try {
                        const resApi = await provider.sendTemplate(phone, templateName, languageCode || template.language || 'es', []);
                        if (resApi?.messages) {
                            const msgId = resApi.messages[0].id;
                            await depsHistoryHandler.saveMessage(chat.id, 'assistant', historyContent, 'text', null, null, msgId);
                            sent++;
                        } else {
                            errors++;
                        }
                    } catch (e: any) {
                        errors++;
                        console.error(`❌ [QUICK BULK] Error de Meta para ${phone}:`, e.message || e);
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
                console.log(`✅ [QUICK BULK] Envío rápido finalizado: ${sent} enviados, ${errors} errores de ${chatsList.length} contactos.`);
            })();

        } catch (error: any) {
            console.error('Error en send-quick-template:', error);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: error.message });
            }
        }
    });

    // --- IMPORTACION EXTERNA DE CONTACTOS ---
    
    app.get('/api/backoffice/chats/import-template', backofficeAuth, async (req: any, res: any) => {
        try {
            const wb = XLSX.utils.book_new();
            const headers = [['phone', 'name', 'tags']];
            const ws = XLSX.utils.aoa_to_sheet(headers);
            XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');

            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Disposition', 'attachment; filename="plantilla_importacion.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.end(buf);
        } catch (error: any) {
            console.error('Error generando plantilla de importación:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- ONBOARDING META ---

    app.get('/api/backoffice/whatsapp/onboard-callback', async (req: any, res: any) => {
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
            const { discoverMetaIds } = await import("../../apis/meta/metaDiscovery");
            const mainToken = await depsHistoryHandler.getMainToken();
            const discovery = await discoverMetaIds(accessToken, mainToken);
            
            if (discovery.found && discovery.data) {
                finalWabaId = discovery.data.wabaId || finalWabaId;
                finalPhoneId = discovery.data.phoneNumberId || finalPhoneId;
                finalVerifiedName = discovery.data.verifiedName || "";
            }

            // 2. Descubrimiento de Páginas (Messenger / Instagram)
            const { discoverAndLinkMetaPages } = await import("../../apis/meta/metaPageDiscovery");
            const pageDiscovery = await discoverAndLinkMetaPages(accessToken);
            if (pageDiscovery) {
                console.log(`✅ [CALLBACK] Guardando configuración de Página: ${pageDiscovery.pageName} para Proyecto: ${projectId}`);
                await depsHistoryHandler.saveSetting('FACEBOOK_PAGE_ID', pageDiscovery.pageId, projectId);
                await depsHistoryHandler.saveSetting('FACEBOOK_PAGE_TOKEN', pageDiscovery.pageAccessToken, projectId);
                
                // Si encontramos Instagram vinculado, guardarlo también
                if (pageDiscovery.instagramId) {
                    await depsHistoryHandler.saveSetting('INSTAGRAM_BUSINESS_ID', pageDiscovery.instagramId, projectId);
                }

                // Activar visibilidad por defecto si encontramos una página
                await depsHistoryHandler.saveSetting('INSTAGRAM_VISIBLE', 'on', projectId);
                await depsHistoryHandler.saveSetting('MESSENGER_VISIBLE', 'on', projectId);
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
                await depsHistoryHandler.saveMetaOnboardingData(null as any, null as any, accessToken, { diagnostics: discovery.diagnostics }, projectId);
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

                await depsHistoryHandler.saveMetaOnboardingData(finalWabaId, finalPhoneId, accessToken, { verified_name: finalVerifiedName }, projectId);
                
                // --- SINCRONIZACIÓN AUTOMÁTICA SMB ---
                // Solicitamos contactos e historial inmediatamente tras la vinculación
                if (finalPhoneId) {
                    await triggerMetaSync(accessToken, finalPhoneId);
                }
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

    /**
     * Endpoint para vinculación manual de IDs si el auto-descubrimiento falló.
     * También dispara la sincronización SMB automática.
     */
    app.post('/api/backoffice/whatsapp/sync-manual', bodyParser.json(), async (req: any, res: any) => {
        const { token, wabaId, phoneNumberId, projectId } = req.body;
        if (!token || !wabaId || !phoneNumberId) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });
        }

        try {
            console.log(`📡 [SYNC-MANUAL] Vinculando manualmente para Proyecto: ${projectId}`);
            await depsHistoryHandler.saveMetaOnboardingData(wabaId, phoneNumberId, token, { manual: true }, projectId);
            
            // Disparar sincronización SMB
            await triggerMetaSync(token, phoneNumberId);

            // Programar reinicio
            setTimeout(() => {
                console.log('🔄 [SYSTEM] Reiniciando bot por vinculación manual...');
                process.exit(1);
            }, 3000);

            res.json({ success: true });
        } catch (error: any) {
            console.error('❌ [SYNC-MANUAL] Error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/unlink-meta', backofficeAuth, async (req: any, res: any) => {
        const projectId = req.query.projectId || process.env.RAILWAY_PROJECT_ID || "default";
        console.log(`📡 [UNLINK-META] Iniciando desvinculación de Meta para Proyecto: ${projectId}`);
        try {
            // 1. Obtener datos de onboarding actuales de la base de datos
            const config = await depsHistoryHandler.getMetaOnboardingData(projectId);
            if (config) {
                const token = config.access_token || config.whatsappToken;
                const phoneId = config.phone_number_id || config.whatsappNumberId;
                const wabaId = config.waba_id || config.whatsappBusinessId;

                if (token && token !== 'PENDING') {
                    // 2. Llamada a la API de Meta para desvincular (Deregister del teléfono y DELETE de subscribed_apps)
                    try {
                        if (phoneId && phoneId !== 'PENDING') {
                            console.log(`📡 [UNLINK-META] Ejecutando deregister para Phone ID: ${phoneId}...`);
                            await axios.post(`https://graph.facebook.com/v22.0/${phoneId}/deregister`, 
                                {}, 
                                { headers: { 'Authorization': `Bearer ${token}` } }
                            );
                            console.log(`✅ [UNLINK-META] Phone ID deregistered exitosamente.`);
                        }
                    } catch (metaPhoneErr: any) {
                        console.warn(`⚠️ [UNLINK-META] Error desregistrando número en Meta (puede estar ya desregistrado):`, metaPhoneErr.response?.data || metaPhoneErr.message);
                    }

                    try {
                        if (wabaId && wabaId !== 'PENDING') {
                            console.log(`📡 [UNLINK-META] Eliminando suscripción de app para WABA ID: ${wabaId}...`);
                            await axios.delete(`https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps`, 
                                { headers: { 'Authorization': `Bearer ${token}` } }
                            );
                            console.log(`✅ [UNLINK-META] App unsubscribed de WABA exitosamente.`);
                        }
                    } catch (metaWabaErr: any) {
                        console.warn(`⚠️ [UNLINK-META] Error eliminando suscripción en Meta (puede estar ya eliminada):`, metaWabaErr.response?.data || metaWabaErr.message);
                    }
                }
            }

            // 3. Eliminar onboarding de la base de datos para este proyecto
            console.log(`🧹 [UNLINK-META] Eliminando registro onboarding de la DB...`);
            const { error: errOnboard } = await supabase
                .from('meta_onboarding')
                .delete()
                .eq('project_id', projectId);
            if (errOnboard) throw errOnboard;

            // 4. Eliminar rutas de routing_table de la base de datos para este proyecto
            console.log(`🧹 [UNLINK-META] Eliminando registros de rutas en routing_table de la DB...`);
            const { error: errRoutes } = await supabase
                .from('routing_table')
                .delete()
                .eq('project_id', projectId);
            if (errRoutes) throw errRoutes;

            console.log(`✅ [UNLINK-META] Desvinculación de Meta completada para el proyecto ${projectId}.`);

            // 5. Programar reinicio automático del bot para limpiar caché y revertir motor a por defecto
            setTimeout(() => {
                console.log('🔄 [SYSTEM] Reiniciando bot automáticamente para aplicar desvinculación...');
                process.exit(1);
            }, 3000);

            res.json({ success: true });
        } catch (error: any) {
            console.error('❌ [UNLINK-META] Error crítico:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/whatsapp/onboard', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
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
            const result = await depsHistoryHandler.saveMetaOnboardingData(
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

    app.post('/api/backoffice/sync-assistant-prompt', systemConfigAuth, bodyParser.json(), async (req: any, res: any) => {
        const { assistantId } = req.body;
        if (!assistantId) return res.status(400).json({ success: false, error: 'assistantId is required' });

        try {
            console.log(`📡 [SYNC] Obteniendo instrucciones para el asistente: ${assistantId}`);
            const dynamicOpenAI = await getOpenAI();
            if (!dynamicOpenAI) {
                return res.status(400).json({ success: false, error: 'OpenAI API Key no configurada. Por favor, guarde la configuración con una clave válida primero.' });
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
            const value = await depsHistoryHandler.getSetting(key);
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
                return res.status(403).json({ success: false, error: 'Esta variable es estática y solo puede editarse vía base de datos.' });
            }
            let val = value;
            if ((key === 'ADMIN_USER' || key === 'ADMIN_PASS') && val) {
                val = 'b64:' + Buffer.from(val).toString('base64');
            }
            await depsHistoryHandler.saveSetting(key, val);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- META SMB SYNC ---
    /**
     * Dispara la sincronización de contactos o historial desde Meta SMB API.
     * Esto enviará webhooks smb_app_state_sync o history que son procesados por el provider.
     */
    app.post('/api/backoffice/whatsapp/sync-smb', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { type } = req.body; // 'contacts' | 'history'
        if (!['contacts', 'history'].includes(type)) {
            return res.status(400).json({ success: false, error: 'Tipo de sincronización inválido. Use "contacts" o "history".' });
        }

        try {
            // @ts-ignore
            const provider = app.get('whatsappProvider');
            
            if (!provider || provider.constructor.name !== 'MetaCloudProvider') {
                return res.status(400).json({ 
                    success: false, 
                    error: 'El proveedor Meta Cloud no está activo. Verifique que el bot esté configurado con Meta.' 
                });
            }

            const syncType = type === 'contacts' ? 'smb_app_state_sync' : 'history';
            console.log(`📡 [BACKOFFICE] Disparando sincronización SMB: ${syncType}`);
            const result = await (provider as any).requestSmbSync(syncType);

            if (result) {
                res.json({ 
                    success: true, 
                    message: `Solicitud de sincronización de ${type} enviada a Meta correctamente.`, 
                    data: result 
                });
            } else {
                res.status(500).json({ success: false, error: 'Meta rechazó la solicitud de sincronización o hubo un error de red.' });
            }
        } catch (error: any) {
            console.error('❌ [BACKOFFICE] Error en sync-smb:', error);
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
                    error: 'No hay un proveedor de WhatsApp (Baileys) activo o conectado para listar grupos. Verifica el código QR en la sección de Conexión.' 
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
            const tasks = await depsHistoryHandler.getTasksDashboard();
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
        // agentId: 'asistente1', 'asistente2'... (Lógica del Bot)
        // userId: uuid del usuario humano (Lógica CRM)
        
        if (!chatId) return res.status(400).json({ success: false, error: 'chatId is required' });

        try {
            console.log(`[BACKOFFICE] Reasignando chat ${chatId}: agentId=${agentId}, userId=${userId}`);
            
            // 1. Si se especifica un agente del bot, lo asignamos y activamos el bot
            if (agentId) {
                await depsHistoryHandler.setAssignedAgent(chatId, agentId);
            }
            
            // 2. Si se especifica un usuario humano (o se limpia con null), actualizamos assigned_to
            if (userId !== undefined) {
                await depsHistoryHandler.assignChatToUser(chatId, userId);
                
                // Si se asignó a un humano, desactivamos el bot automáticamente para no interferir
                if (userId) {
                    await depsHistoryHandler.toggleBot(chatId, false);
                }
            }

            res.json({ success: true });
        } catch (error: any) {
            console.error('❌ Error en /api/backoffice/chat/assign:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/crm/config', backofficeAuth, async (req: any, res: any) => {
        try {
            const config = await depsHistoryHandler.getSetting('CRM_CONFIG');
            res.json({ success: true, config: config ? JSON.parse(config) : null });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/backoffice/crm/config', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        const { config } = req.body;
        try {
            await depsHistoryHandler.saveSetting('CRM_CONFIG', JSON.stringify(config));
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // --- CONFIGURACION DINAMICA (HOT-UPDATE) ---

    /**
     * Obtiene todas las variables de configuración mezclando el entorno (.env) 
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
            const { data: dbSettings, error } = await supabase
                .from('settings')
                .select('key, value')
                .eq('project_id', depsHistoryHandler.PROJECT_IDENTIFIER);

            if (error) throw error;

            // 3. Mezclar: Prioridad DB > Railway/Env
            const mergedConfig: any = { ...railwayVars };
            dbSettings?.forEach((s: any) => {
                if (s.value !== null && s.value !== undefined) {
                    let val = s.value;
                    if ((s.key === 'ADMIN_USER' || s.key === 'ADMIN_PASS') && typeof val === 'string' && val.startsWith('b64:')) {
                        try {
                            val = Buffer.from(val.slice(4), 'base64').toString('utf-8');
                        } catch (e) {}
                    }
                    mergedConfig[s.key] = val;
                }
            });

            res.json({ success: true, variables: mergedConfig });
        } catch (error: any) {
            console.error('Error al obtener configuración:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * Guarda múltiples configuraciones en la base de datos sin reiniciar el bot.
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
            
            console.log(`📡 [HOT-UPDATE] Guardando ${keysToSave.length} variables en la base de datos...`);

            const promises = keysToSave.map(key => {
                let val = settings[key];
                if ((key === 'ADMIN_USER' || key === 'ADMIN_PASS') && val) {
                    val = 'b64:' + Buffer.from(val).toString('base64');
                }
                return depsHistoryHandler.saveSetting(key, val);
            });
            await Promise.all(promises);

            // Si se actualizaron credenciales de acceso, invalida el cache del middleware de auth
            const credentialKeys = ['ADMIN_PASS', 'ADMIN_USER'];
            if (keysToSave.some(k => credentialKeys.includes(k))) {
                invalidateAuthCache();
                console.log('[HOT-UPDATE] Credenciales actualizadas — cache de auth invalidado.');
            }

            res.json({ success: true, message: `${keysToSave.length} variables guardadas (se omitieron ${keys.length - keysToSave.length} protegidas)` });
        } catch (error: any) {
            console.error('Error al guardar settings bulk:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/backoffice/settings', backofficeAuth, async (req: any, res: any) => {
        try {
            const { data: dbSettings, error } = await supabase
                .from('settings')
                .select('key, value')
                .eq('project_id', depsHistoryHandler.PROJECT_IDENTIFIER);

            if (error) throw error;
            const results: any = {};
            dbSettings?.forEach((s: any) => {
                let val = s.value;
                if ((s.key === 'ADMIN_USER' || s.key === 'ADMIN_PASS') && typeof val === 'string' && val.startsWith('b64:')) {
                    try {
                        val = Buffer.from(val.slice(4), 'base64').toString('utf-8');
                    } catch (e) {}
                }
                results[s.key] = val;
            });
            res.json(results);
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
            
            const prompt = await depsHistoryHandler.getSetting(settingKey);
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
    app.post('/api/backoffice/update-prompt', systemConfigAuth, bodyParser.json(), async (req: any, res: any) => {
        const { prompt, index } = req.body;
        const idx = index || '1';
        if (prompt === undefined) return res.status(400).json({ success: false, error: 'prompt is required' });

        try {
            const settingKey = idx === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${idx}`;
            const envKey = idx === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${idx}`;
            
            // Prioridad: 1. DB, 2. Env
            const assistantId = await depsHistoryHandler.getConfig(envKey) || process.env[envKey];

            console.log(`📡 [HOT-UPDATE] Actualizando prompt para Asistente ${idx} en base de datos...`);
            await depsHistoryHandler.saveSetting(settingKey, prompt);

            // Sincronizar hacia OpenAI (Empujar cambio al dashboard de OpenAI)
            const { getOpenAI } = await import("../../apis/openai/openaiHelper");
            const dynamicOpenAI = await getOpenAI();

            if (assistantId && dynamicOpenAI) {
                try {
                    console.log(`📡 [SYNC] Empujando nuevo prompt hacia OpenAI Assistant: ${assistantId}`);
                    await dynamicOpenAI.beta.assistants.update(assistantId, {
                        instructions: prompt
                    });
                    
                    // CRITICAL FIX: Después de actualizar instrucciones, volvemos a sincronizar las tools
                    // para evitar que queden vacías si el update sobreescribió el objeto.
                    const { syncAssistantTools } = await import("../../apis/openai/openaiHelper");
                    await syncAssistantTools(assistantId);
                    
                    console.log(`✅ [SYNC] Prompt y Herramientas de Asistente ${idx} actualizados en OpenAI exitosamente.`);
                } catch (apiError: any) {
                    console.error(`⚠️ [HOT-UPDATE-SYNC-ERROR] Falló sincronización con OpenAI para ${assistantId}:`, apiError.message);
                }
            } else if (!dynamicOpenAI) {
                console.warn(`⚠️ [HOT-UPDATE] No se pudo obtener instancia de OpenAI. El prompt se guardó solo localmente.`);
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
            const docType = req.query.type === 'api' ? 'INSTRUCCIONES_API.md' : 'INSTRUCCIONES_USO.md';
            const rootDir = process.cwd();
            const docsPath = path.join(rootDir, 'docs', docType);
            const distDocsPath = path.join(rootDir, 'dist', 'docs', docType);
            const altPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', 'docs', docType);
            
            console.log(`📂 [Docs] Buscando (${docType}) en: ${docsPath}, ${distDocsPath}, ${altPath}`);

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
            console.error('❌ [Docs] Error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // LISTA NEGRA
    // ─────────────────────────────────────────────────────────────

    /** GET /api/backoffice/blacklist/status — ¿Está activa la integración? */
    app.get('/api/backoffice/blacklist/status', backofficeAuth, async (req: any, res: any) => {
        try {
            const active = await depsHistoryHandler.getSetting('BLACKLIST_ACTIVE');
            res.json({ active: active === 'true' });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist/activate — Activa la lista negra */
    app.post('/api/backoffice/blacklist/activate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const { error } = await supabase
                .from('settings')
                .upsert({ project_id: projectId, key: 'BLACKLIST_ACTIVE', value: 'true' }, { onConflict: 'project_id,key' });
            if (error) throw error;
            // Invalidar caché
            depsHistoryHandler.settingsCache?.delete?.(`${projectId}:BLACKLIST_ACTIVE`);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist/deactivate — Desactiva y elimina todos los registros */
    app.post('/api/backoffice/blacklist/deactivate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            // 1. Eliminar todas las entradas de blacklist del proyecto
            const { error: delErr } = await supabase
                .from('blacklist')
                .delete()
                .eq('project_id', projectId);
            if (delErr) throw delErr;
            // 2. Desactivar el setting
            const { error: settErr } = await supabase
                .from('settings')
                .upsert({ project_id: projectId, key: 'BLACKLIST_ACTIVE', value: 'false' }, { onConflict: 'project_id,key' });
            if (settErr) throw settErr;
            depsHistoryHandler.settingsCache?.delete?.(`${projectId}:BLACKLIST_ACTIVE`);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/blacklist — Lista todas las entradas del proyecto */
    app.get('/api/backoffice/blacklist', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const { data, error } = await supabase
                .from('blacklist')
                .select('chat_id, sin_bot, bloqueado_crm, notes, updated_at')
                .eq('project_id', projectId)
                .order('updated_at', { ascending: false });
            if (error) throw error;
            // Enriquecer con nombre del contacto desde chats
            const chatIds = (data || []).map((r: any) => r.chat_id);
            let chatNames: Record<string, string> = {};
            if (chatIds.length > 0) {
                const { data: chatRows } = await supabase
                    .from('chats')
                    .select('id, name')
                    .in('id', chatIds)
                    .eq('project_id', projectId);
                (chatRows || []).forEach((c: any) => { chatNames[c.id] = c.name || c.id; });
            }
            const enriched = (data || []).map((r: any) => ({
                ...r,
                name: chatNames[r.chat_id] || r.chat_id
            }));
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
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const { error } = await supabase
                .from('blacklist')
                .upsert({
                    chat_id,
                    project_id: projectId,
                    sin_bot: !!sin_bot,
                    bloqueado_crm: !!bloqueado_crm,
                    notes: notes || '',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'chat_id,project_id' });
            if (error) throw error;
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** DELETE /api/backoffice/blacklist/:chatId — Elimina una entrada */
    app.delete('/api/backoffice/blacklist/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const { error } = await supabase
                .from('blacklist')
                .delete()
                .eq('chat_id', req.params.chatId)
                .eq('project_id', projectId);
            if (error) throw error;
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** GET /api/backoffice/blacklist/check/:chatId — Verifica si un chat está en lista negra */
    app.get('/api/backoffice/blacklist/check/:chatId', backofficeAuth, async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const { data } = await supabase
                .from('blacklist')
                .select('sin_bot, bloqueado_crm')
                .eq('chat_id', req.params.chatId)
                .eq('project_id', projectId)
                .maybeSingle();
            res.json({ inBlacklist: !!data, sin_bot: data?.sin_bot || false, bloqueado_crm: data?.bloqueado_crm || false });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/blacklist/toggle/:chatId — Agrega o quita de lista negra (toggle rápido desde header) */
    app.post('/api/backoffice/blacklist/toggle/:chatId', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const chatId = req.params.chatId;
            const { inBlacklist } = req.body;

            if (inBlacklist) {
                // Agregar con sin_bot=true por defecto
                const { error } = await supabase
                    .from('blacklist')
                    .upsert({
                        chat_id: chatId,
                        project_id: projectId,
                        sin_bot: true,
                        bloqueado_crm: false,
                        notes: '',
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'chat_id,project_id' });
                if (error) throw error;
            } else {
                // Quitar de la lista
                const { error } = await supabase
                    .from('blacklist')
                    .delete()
                    .eq('chat_id', chatId)
                    .eq('project_id', projectId);
                if (error) throw error;
            }
            res.json({ success: true, inBlacklist });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────
    // NOTIFICACIONES
    // ─────────────────────────────────────────────────────────────

    /** GET /api/backoffice/notifications/status — ¿Está activa la integración? */
    app.get('/api/backoffice/notifications/status', backofficeAuth, async (req: any, res: any) => {
        try {
            const active = await depsHistoryHandler.getSetting('NOTIFICATIONS_ACTIVE');
            res.json({ active: active === 'true' });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/notifications/activate — Activa la integración de notificaciones */
    app.post('/api/backoffice/notifications/activate', backofficeAuth, bodyParser.json(), async (req: any, res: any) => {
        try {
            const projectId = depsHistoryHandler.PROJECT_IDENTIFIER;
            const { error } = await supabase
                .from('settings')
                .upsert({ project_id: projectId, key: 'NOTIFICATIONS_ACTIVE', value: 'true' }, { onConflict: 'project_id,key' });
            if (error) throw error;
            depsHistoryHandler.settingsCache?.delete?.(`${projectId}:NOTIFICATIONS_ACTIVE`);
            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/notifications/deactivate — Desactiva la integración y resetea contadores */
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
            const { error: settErr } = await supabase
                .from('settings')
                .upsert({ project_id: projectId, key: 'NOTIFICATIONS_ACTIVE', value: 'false' }, { onConflict: 'project_id,key' });
            if (settErr) throw settErr;
            depsHistoryHandler.settingsCache?.delete?.(`${projectId}:NOTIFICATIONS_ACTIVE`);
            
            // Notificar a clientes conectados que la integración se desactivó para limpiar badges
            historyEvents.emit('notifications_deactivated', { projectId });

            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    /** POST /api/backoffice/chat/read/:chatId — Resetea unread_count a 0 para un chat */
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
            depsHistoryHandler.invalidateChatCache?.(cleanId, projectId);
            
            // Emitir evento para WebSockets
            historyEvents.emit('chat_read', { chatId: cleanId, projectId });

            res.json({ success: true });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
};

/** Procesa la importación de contactos desde Excel */
export const processImportExcel = async (req: any, res: any, deps: BackofficeDependencies) => {
    const { HistoryHandler: depsHistoryHandler } = deps;
    
    if (!req.file) return res.status(400).json({ success: false, error: 'No se subió ningún archivo' });

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]) as any[];

        if (!data || data.length === 0) {
            return res.status(400).json({ success: false, error: 'El archivo está vacío' });
        }

        const chatsToSync = [];
        const tagsToProcess = new Map<string, string[]>(); // phone -> [tagNames]
        const allUniqueTags = new Set<string>();

        for (const row of data) {
            const phone = String(row.phone || row.Phone || '').replace(/\D/g, '');
            if (!phone) continue;

            const name = row.name || row.Name || '';
            const tagsStr = row.tags || row.Tags || '';

            chatsToSync.push({
                id: phone,
                name: name || null,
                type: 'whatsapp',
                bot_enabled: true,
                assigned_agent: 'asistente1'
            });

            if (tagsStr) {
                const tagList = tagsStr.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
                if (tagList.length > 0) {
                    tagsToProcess.set(phone, tagList);
                    tagList.forEach((t: string) => allUniqueTags.add(t));
                }
            }
        }

        // 1. Upsert de Chats
        await depsHistoryHandler.syncChats(chatsToSync);

        // 2. Procesar Etiquetas
        if (allUniqueTags.size > 0) {
            const existingTags = await depsHistoryHandler.getTags();
            const tagMap = new Map<string, string>(); // name -> id
            existingTags.forEach((t: any) => tagMap.set(t.name.toLowerCase(), t.id));

            for (const tagName of allUniqueTags) {
                if (!tagMap.has(tagName.toLowerCase())) {
                    const newTag = await depsHistoryHandler.createTag(tagName, '#6366f1');
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
                await depsHistoryHandler.syncChatTags(associations);
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
        console.error('❌ Error importando contactos:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
