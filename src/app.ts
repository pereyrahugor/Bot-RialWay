import { executeDbQuery } from "./utils/dbHandler";
// ...existing imports y lógica del bot...
import { exec } from 'child_process';
import "dotenv/config";
import path from 'path';
import serve from 'serve-static';
import { Server } from 'socket.io';
import fs from 'fs';
import polka from 'polka';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import QRCode from 'qrcode';
// Estado global para encender/apagar el bot
let botEnabled = true;
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from "@builderbot/bot";
import { MemoryDB } from "@builderbot/bot";
import { BaileysProvider } from "builderbot-provider-sherpa";
import { restoreSessionFromDb, startSessionSync, deleteSessionFromDb, isSessionInDb } from "./utils/sessionSync";
import { toAsk, httpInject } from "@builderbot-plugins/openai-assistants";
import { typing } from "./utils/presence";
import { idleFlow } from "./Flows/idleFlow";
import { welcomeFlowTxt } from "./Flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./Flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./Flows/welcomeFlowImg";
import { welcomeFlowVideo } from "./Flows/welcomeFlowVideo";
import { welcomeFlowDoc } from "./Flows/welcomeFlowDoc";
import { locationFlow } from "./Flows/locationFlow";
import { AssistantResponseProcessor } from "./utils/AssistantResponseProcessor";
import { updateMain } from "./addModule/updateMain";
import { ErrorReporter } from "./utils/errorReporter";
// import { AssistantBridge } from './utils-web/AssistantBridge';
import { WebChatManager } from './utils-web/WebChatManager';
import { fileURLToPath } from 'url';
import { getArgentinaDatetimeString } from "./utils/ArgentinaTime";
import { RailwayApi } from "./Api-RailWay/Railway";

//import { imgResponseFlow } from "./Flows/imgResponse";
//import { listImg } from "./addModule/listImg";
//import { testAuth } from './utils/test-google-auth.js';

// Definir __dirname para ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Instancia global de WebChatManager para sesiones webchat
const webChatManager = new WebChatManager();
// Eliminado: processUserMessageWeb. Usar lógica principal para ambos canales.

/** Puerto en el que se ejecutará el servidor (Railway usa 8080 por defecto) */
const PORT = process.env.PORT || 8080;
/** ID del asistente de OpenAI */
export const ASSISTANT_ID = process.env.ASSISTANT_ID;
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_RESUMEN ?? "";

const userQueues = new Map();
const userLocks = new Map();


// Listener para generar el archivo QR manualmente cuando se solicite
export let adapterProvider;
let errorReporter;

const TIMEOUT_MS = 30000;

// Control de timeout por usuario para evitar ejecuciones automáticas superpuestas
const userTimeouts = new Map();

// Wrapper seguro para toAsk que SIEMPRE verifica runs activos
export const safeToAsk = async (assistantId: string, message: string, state: any) => {
        const threadId = state && typeof state.get === 'function' && state.get('thread_id');
        if (threadId) {
                try {
                        const { waitForActiveRuns } = await import('./utils/AssistantResponseProcessor.js');
                        await waitForActiveRuns(threadId);
                } catch (err) {
                        console.error('[safeToAsk] Error esperando runs activos:', err);
                        await new Promise(r => setTimeout(r, 3000));
                }
        }
        return toAsk(assistantId, message, state);
};

export const getAssistantResponse = async (assistantId, message, state, fallbackMessage, userId, thread_id = null) => {
        // Solo enviar la fecha/hora si es realmente un hilo nuevo (no existe thread_id ni en el argumento ni en el state)
        let effectiveThreadId = thread_id;
        if (!effectiveThreadId && state && typeof state.get === 'function') {
                effectiveThreadId = state.get('thread_id');
        }
        let systemPrompt = "";
        if (!effectiveThreadId) {
                systemPrompt += `Fecha y hora actual: ${getArgentinaDatetimeString()}\n`;
        }
        const finalMessage = systemPrompt + message;
        // Si hay un timeout previo, lo limpiamos
        if (userTimeouts.has(userId)) {
                clearTimeout(userTimeouts.get(userId));
                userTimeouts.delete(userId);
        }

        let timeoutResolve;
        const timeoutPromise = new Promise((resolve) => {
                timeoutResolve = resolve;
                const timeoutId = setTimeout(async () => {
                        console.warn("⏱ Timeout alcanzado. Reintentando con mensaje de control...");
                        resolve(await safeToAsk(assistantId, fallbackMessage ?? finalMessage, state));
                        userTimeouts.delete(userId);
                }, TIMEOUT_MS);
                userTimeouts.set(userId, timeoutId);
        });

        // Lanzamos la petición a OpenAI, pasando thread_id si existe
        const askPromise = safeToAsk(assistantId, finalMessage, state).then((result) => {
                if (userTimeouts.has(userId)) {
                        clearTimeout(userTimeouts.get(userId));
                        userTimeouts.delete(userId);
                }
                timeoutResolve(result);
                return result;
        });

        return Promise.race([askPromise, timeoutPromise]);
};

export const processUserMessage = async (
    ctx,
    { flowDynamic, state, provider, gotoFlow }
) => {
    await typing(ctx, provider);
    try {
        const body = ctx.body && ctx.body.trim();


        // Comando para encender el bot
        if (body === "#ON#") {
            if (!botEnabled) {
                botEnabled = true;
                await flowDynamic([{ body: "🤖 Bot activado." }]);
            } else {
                await flowDynamic([{ body: "🤖 El bot ya está activado." }]);
            }
            return state;
        }

        // Comando para apagar el bot
        if (body === "#OFF#") {
            if (botEnabled) {
                botEnabled = false;
                await flowDynamic([{ body: "🛑 Bot desactivado. No responderé a más mensajes hasta recibir #ON#." }]);
            } else {
                await flowDynamic([{ body: "🛑 El bot ya está desactivado." }]);
            }
            return state;
        }

        // Comando para actualizar datos desde sheets
        if (body === "#ACTUALIZAR#") {
            try {
                await updateMain();
                await flowDynamic([{ body: "🔄 Datos actualizados desde Google." }]);
            } catch (err) {
                await flowDynamic([{ body: "❌ Error al actualizar datos desde Google." }]);
            }
            return state;
        }

        // Si el bot está apagado, ignorar todo excepto #ON#
        if (!botEnabled) {
            return;
        }

        // Ignorar mensajes de listas de difusión, newsletters, canales o contactos @lid
        if (ctx.from) {
            if (/@broadcast$/.test(ctx.from) || /@newsletter$/.test(ctx.from) || /@channel$/.test(ctx.from)) {
                console.log('Mensaje de difusión/canal ignorado:', ctx.from);
                return;
            }
            if (/@lid$/.test(ctx.from)) {
                console.log('Mensaje de contacto @lid ignorado:', ctx.from);
                // Reportar al admin
                const assistantName = process.env.ASSISTANT_NAME || 'Asistente demo';
                const assistantId = process.env.ASSISTANT_ID || 'ID no definido';
                if (provider && typeof provider.sendMessage === 'function') {
                    await provider.sendMessage(
                        '+5491130792789',
                        `⚠️ Mensaje recibido de contacto @lid (${ctx.from}). El bot no responde a estos contactos. Asistente: ${assistantName} | ID: ${assistantId}`
                    );
                }
                return;
            }
        }

        // Interceptar trigger de imagen antes de pasar al asistente
        // if (body === "#TestImg#") {
        //     // Usar el flow de imagen para responder y detener el flujo
        //     return gotoFlow(imgResponseFlow);
        // }

            // Usar el nuevo wrapper para obtener respuesta y thread_id
            const response = (await getAssistantResponse(ASSISTANT_ID, ctx.body, state, "Por favor, reenvia el msj anterior ya que no llego al usuario.", ctx.from, ctx.thread_id)) as string;
            console.log('🔍 DEBUG RAW ASSISTANT MSG (WhatsApp):', JSON.stringify(response));

            // Delegar procesamiento al AssistantResponseProcessor (Maneja DB_QUERY y envios)
            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                response,
                ctx,
                flowDynamic,
                state,
                provider,
                gotoFlow,
                getAssistantResponse,
                ASSISTANT_ID
            );

        // Si es un contacto con nombre, intentamos guardar el nombre (si no lo tenemos)
        // en algún lugar, o manejarlo como variable de sesión.
        // Aquí podrías agregar lógica para actualizar nombre en sheet si el asistente lo extrajo.
        return state;
        
    } catch (error) {
        console.error("Error al procesar el mensaje del usuario:", error);

        // Enviar reporte de error al grupo de WhatsApp
        await errorReporter.reportError(
            error,
            ctx.from,
            `https://wa.me/${ctx.from}`
        );

        // 📌 Manejo de error: volver al flujo adecuado
        if (ctx.type === EVENTS.VOICE_NOTE) {
            return gotoFlow(welcomeFlowVoice);
        } else {
            return gotoFlow(welcomeFlowTxt);
        }
    }
};


const handleQueue = async (userId) => {
    const queue = userQueues.get(userId);

    if (userLocks.get(userId)) return;

    userLocks.set(userId, true);

    while (queue.length > 0) {
        const { ctx, flowDynamic, state, provider, gotoFlow } = queue.shift();
        try {
            await processUserMessage(ctx, { flowDynamic, state, provider, gotoFlow });
        } catch (error) {
            console.error(`Error procesando el mensaje de ${userId}:`, error);
        }
    }

    userLocks.set(userId, false);
    userQueues.delete(userId);
};

// Función auxiliar para verificar si existe sesión activa (Local o Remota)
const hasActiveSession = async () => {
    try {
        // 1. Verificar si el proveedor está realmente conectado
        // En builderbot-provider-sherpa (Baileys), el socket suele estar en vendor
        const isReady = !!(adapterProvider?.vendor?.user || adapterProvider?.globalVendorArgs?.sock?.user);
        
        // 2. Verificar localmente
        const sessionsDir = path.join(process.cwd(), 'bot_sessions');
        let localActive = false;
        if (fs.existsSync(sessionsDir)) {
            const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
            // creds.json es el archivo crítico para Baileys
            localActive = files.includes('creds.json');
        }

        // Si está conectado, es la prioridad máxima
        if (isReady) return { active: true, source: 'connected' };
        
        // Si tiene creds.json, es muy probable que se conecte pronto
        if (localActive) return { active: true, source: 'local' };

        // 3. Si no hay nada local, verificar en DB
        const remoteActive = await isSessionInDb();
        if (remoteActive) {
            return { 
                active: false, 
                hasRemote: true, 
                message: 'Sesión encontrada en la nube. El bot está intentando restaurarla. Si el QR aparece, puedes escanearlo para generar una nueva.' 
            };
        }

        return { active: false, hasRemote: false };
    } catch (error) {
        console.error('Error verificando sesión:', error);
        return { active: false, error: error instanceof Error ? error.message : String(error) };
    }
};

// Main function to initialize the bot and load Google Sheets data
const main = async () => {
    // 0. Ejecutar script de inicialización de funciones (solo si no existen)
    try {
        console.log('🔄 [Init] Verificando funciones RPC en Supabase...');
        const isProd = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_ID;
        const scriptPath = isProd ? './dist/utils/init_functions.js' : './src/utils/init_functions.ts';
        const command = isProd ? `node ${scriptPath}` : `npx ts-node ${scriptPath}`;
        await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Init] Error ejecutando ${scriptPath}:`, stderr || error);
                    reject(error);
                } else {
                    console.log(stdout);
                    resolve(true);
                }
            });
        });
    } catch (e) {
        console.error('[Init] Error en inicialización de funciones:', e);
    }

    // 1. Limpiar QR antiguo al inicio
    const qrPath = path.join(process.cwd(), 'bot.qr.png');
    if (fs.existsSync(qrPath)) {
        try {
            fs.unlinkSync(qrPath);
            console.log('🗑️ [Init] QR antiguo eliminado.');
        } catch (e) {
            console.error('⚠️ [Init] No se pudo eliminar QR antiguo:', e);
        }
    }

    // 2. Restaurar sesión desde DB ANTES de inicializar el provider
    // Esto asegura que Baileys encuentre los archivos al arrancar
    try {
        await restoreSessionFromDb();
        // Pequeña espera para asegurar que el sistema de archivos se asiente
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
        console.error('[Init] Error restaurando sesión desde DB:', e);
    }

    // 3. Inicializar Provider ÚNICO
    adapterProvider = createProvider(BaileysProvider, {
        version: [2, 3000, 1030817285],
        groupsIgnore: false,
        readStatus: false,
        disableHttpServer: true,
        // Forzar el uso de la carpeta bot_sessions explícitamente si el provider lo permite
        // o asegurar que no haya conflictos de caché
    });

    // 4. Listeners del Provider
    adapterProvider.on('require_action', async (payload: any) => {
        console.log('⚡ [Provider] require_action received. Payload:', payload);
        let qrString = null;
        if (typeof payload === 'string') {
            qrString = payload;
        } else if (payload && typeof payload === 'object') {
            if (payload.qr) qrString = payload.qr;
            else if (payload.code) qrString = payload.code;
        }
        if (qrString && typeof qrString === 'string') {
            console.log('⚡ [Provider] QR Code detected (length: ' + qrString.length + '). Generating image...');
            try {
                const qrPath = path.join(process.cwd(), 'bot.qr.png');
                await QRCode.toFile(qrPath, qrString, {
                    color: { dark: '#000000', light: '#ffffff' },
                    scale: 4,
                    margin: 2
                });
                console.log(`✅ [Provider] QR Image saved to ${qrPath}`);
            } catch (err) {
                console.error('❌ [Provider] Error generating QR image:', err);
            }
        }
    });

    adapterProvider.on('message', (payload) => { console.log('⚡ [Provider] message received'); });
    adapterProvider.on('ready', () => { 
        console.log('✅ [Provider] READY: El bot está conectado y operativo.'); 
    });
    adapterProvider.on('auth_failure', (payload) => { 
        console.log('❌ [Provider] AUTH_FAILURE: Error de autenticación.', payload); 
    });

    // Evento adicional para detectar desconexiones
    adapterProvider.on('host_failure', (payload) => {
        console.log('⚠️ [Provider] HOST_FAILURE: Problema de conexión con WhatsApp.', payload);
    });

    errorReporter = new ErrorReporter(adapterProvider, ID_GRUPO_RESUMEN);

    console.log("📌 Inicializando datos desde Google Sheets...");
    await updateMain();

    console.log('🚀 [Init] Iniciando createBot...');
    const adapterFlow = createFlow([welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow, idleFlow]);
    const adapterDB = new MemoryDB();
    
    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    console.log('🔍 [DEBUG] createBot httpServer:', !!httpServer);
    console.log('🔍 [DEBUG] adapterProvider.server:', !!adapterProvider.server);

    // Iniciar sincronización periódica de sesión hacia Supabase
    startSessionSync();

    // Inicializar servidor Polka propio para WebChat y QR
    const app = adapterProvider.server;

    // Middleware para parsear JSON en el body
    app.use(bodyParser.json());

    // 1. Middleware de compatibilidad (res.json, res.send, res.sendFile, etc)
    app.use((req, res, next) => {
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (body) => { 
            if (res.headersSent) return res;
            if (typeof body === 'object') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(body || null));
            } else {
                res.end(body || '');
            }
            return res; 
        };
        res.json = (data) => { 
            if (res.headersSent) return res;
            res.setHeader('Content-Type', 'application/json'); 
            res.end(JSON.stringify(data || null)); 
            return res; 
        };
        res.sendFile = (filepath) => {
            if (res.headersSent) return;
            try {
                if (fs.existsSync(filepath)) {
                    const ext = path.extname(filepath).toLowerCase();
                    const mimeTypes = {
                        '.html': 'text/html',
                        '.js': 'application/javascript',
                        '.css': 'text/css',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.svg': 'image/svg+xml',
                        '.json': 'application/json'
                    };
                    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
                    fs.createReadStream(filepath)
                        .on('error', (err) => {
                            console.error(`[ERROR] Stream error in sendFile (${filepath}):`, err);
                            if (!res.headersSent) {
                                res.statusCode = 500;
                                res.end('Internal Server Error');
                            }
                        })
                        .pipe(res);
                } else {
                    console.error(`[ERROR] sendFile: File not found: ${filepath}`);
                    res.statusCode = 404;
                    res.end('Not Found');
                }
            } catch (e) {
                console.error(`[ERROR] Error in sendFile (${filepath}):`, e);
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end('Internal Error');
                }
            }
        };
        next();
    });

    // 2. Middleware de logging y redirección de raíz
    app.use((req, res, next) => {
        console.log(`[REQUEST] ${req.method} ${req.url}`);
        try {
            if (req.url === "/" || req.url === "") {
                console.log('[DEBUG] Redirigiendo raíz (/) a /dashboard via middleware');
                res.writeHead(302, { 'Location': '/dashboard' });
                return res.end();
            }
            next();
        } catch (err) {
            console.error('❌ [ERROR] Crash en cadena de middleware:', err);
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Internal Server Error');
            }
        }
    });

    // 3. Función para servir páginas HTML
    function serveHtmlPage(route, filename) {
        const handler = (req, res) => {
            console.log(`[DEBUG] Serving HTML for ${req.url} -> ${filename}`);
            try {
                const possiblePaths = [
                    path.join(process.cwd(), 'src', 'html', filename),
                    path.join(process.cwd(), filename),
                    path.join(process.cwd(), 'src', filename),
                    path.join(__dirname, 'html', filename),
                    path.join(__dirname, filename),
                    path.join(__dirname, '..', 'src', 'html', filename)
                ];

                let htmlPath = null;
                for (const p of possiblePaths) {
                    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
                        htmlPath = p;
                        break;
                    }
                }

                if (htmlPath) {
                    res.sendFile(htmlPath);
                } else {
                    console.error(`[ERROR] File not found: ${filename}`);
                    res.status(404).send('HTML no encontrado en el servidor');
                }
            } catch (err) {
                console.error(`[ERROR] Failed to serve ${filename}:`, err);
                res.status(500).send('Error interno al servir HTML');
            }
        };
        app.get(route, handler);
        if (route !== "/") {
            app.get(route + '/', handler);
        }
    }

    // Inyectar rutas del plugin
    httpInject(app);

    // Registrar páginas HTML
    serveHtmlPage("/dashboard", "dashboard.html");
    serveHtmlPage("/webchat", "webchat.html");
    serveHtmlPage("/webreset", "webreset.html");
    serveHtmlPage("/variables", "variables.html");

    // Servir archivos estáticos
    app.use("/js", serve(path.join(process.cwd(), "src", "js")));
    app.use("/style", serve(path.join(process.cwd(), "src", "style")));
    app.use("/assets", serve(path.join(process.cwd(), "src", "assets")));

    // Servir el código QR
    app.get("/qr.png", (req, res) => {
        const qrPath = path.join(process.cwd(), 'bot.qr.png');
        if (fs.existsSync(qrPath)) {
            res.setHeader('Content-Type', 'image/png');
            fs.createReadStream(qrPath).pipe(res);
        } else {
            res.statusCode = 404;
            res.end('QR not found');
        }
    });

    // API Endpoints
    app.get('/api/assistant-name', (req, res) => {
        const assistantName = process.env.ASSISTANT_NAME || 'Asistente demo';
        res.json({ name: assistantName });
    });

    app.get('/api/dashboard-status', async (req, res) => {
        const status = await hasActiveSession();
        res.json(status);
    });

    app.post('/api/delete-session', async (req, res) => {
        try {
            await deleteSessionFromDb();
            res.json({ success: true });
        } catch (err) {
            console.error('Error en /api/delete-session:', err);
            res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
    });

    app.post("/api/restart-bot", async (req, res) => {
        console.log('POST /api/restart-bot recibido');
        try {
            const result = await RailwayApi.restartActiveDeployment();
            if (result.success) {
                res.json({ success: true, message: "Reinicio solicitado correctamente." });
            } else {
                res.status(500).json({ success: false, error: result.error || "Error desconocido" });
            }
        } catch (err: any) {
            console.error('Error en /api/restart-bot:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.get("/api/variables", async (req, res) => {
        try {
            const variables = await RailwayApi.getVariables();
            if (variables) {
                res.json({ success: true, variables });
            } else {
                res.status(500).json({ success: false, error: "No se pudieron obtener las variables de Railway" });
            }
        } catch (err: any) {
            console.error('Error en GET /api/variables:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post("/api/update-variables", async (req, res) => {
        try {
            const { variables } = req.body;
            if (!variables || typeof variables !== 'object') {
                return res.status(400).json({ success: false, error: "Variables no proporcionadas o formato inválido" });
            }

            console.log("[API] Actualizando variables en Railway...");
            const updateResult = await RailwayApi.updateVariables(variables);
            
            if (!updateResult.success) {
                return res.status(500).json({ success: false, error: updateResult.error });
            }

            console.log("[API] Variables actualizadas. Solicitando reinicio...");
            const restartResult = await RailwayApi.restartActiveDeployment();

            if (restartResult.success) {
                res.json({ success: true, message: "Variables actualizadas y reinicio solicitado." });
            } else {
                res.json({ success: true, message: "Variables actualizadas, pero falló el reinicio automático.", warning: restartResult.error });
            }
        } catch (err: any) {
            console.error('Error en POST /api/update-variables:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Socket.IO initialization function
    const initSocketIO = (serverInstance) => {
        if (!serverInstance) {
            console.error('❌ [ERROR] No se pudo obtener serverInstance para Socket.IO');
            return;
        }
        console.log('✅ [DEBUG] Inicializando Socket.IO...');
        const io = new Server(serverInstance, { cors: { origin: '*' } });
        io.on('connection', (socket) => {
            console.log('💬 Cliente web conectado');
            socket.on('message', async (msg) => {
                try {
                    let ip = '';
                    const xff = socket.handshake.headers['x-forwarded-for'];
                    if (typeof xff === 'string') ip = xff.split(',')[0];
                    else if (Array.isArray(xff)) ip = xff[0];
                    else ip = socket.handshake.address || '';

                    if (!global.webchatHistories) global.webchatHistories = {};
                    const historyKey = `webchat_${ip}`;
                    if (!global.webchatHistories[historyKey]) global.webchatHistories[historyKey] = [];
                    const _history = global.webchatHistories[historyKey];
                    
                    const state = {
                        get: (key) => key === 'history' ? _history : undefined,
                        update: async (msg, role = 'user') => {
                            _history.push({ role, content: msg });
                            if (_history.length > 10) _history.shift();
                        },
                        clear: async () => { _history.length = 0; }
                    };

                    let replyText = '';
                    const flowDynamic = async (arr) => {
                        if (Array.isArray(arr)) replyText = arr.map(a => a.body).join('\n');
                        else if (typeof arr === 'string') replyText = arr;
                    };

                    if (msg.trim().toLowerCase() === "#reset") {
                        await state.clear();
                        replyText = "🔄 Chat reiniciado.";
                    } else {
                        await processUserMessage({ from: ip, body: msg, type: 'webchat' }, { flowDynamic, state, provider: undefined, gotoFlow: () => {} });
                    }
                    socket.emit('reply', replyText);
                } catch (err) {
                    console.error('Error Socket.IO:', err);
                    socket.emit('reply', 'Error procesando mensaje.');
                }
            });
        });
    };

    app.post('/webchat-api', async (req, res) => {
        if (!req.body || !req.body.message) {
            return res.status(400).json({ error: "Falta 'message'" });
        }
        try {
            const message = req.body.message;
            let ip = '';
            const xff = req.headers['x-forwarded-for'];
            if (typeof xff === 'string') ip = xff.split(',')[0];
            else ip = req.ip || '';

            const { getOrCreateThreadId, sendMessageToThread, deleteThread } = await import('./utils-web/openaiThreadBridge');
            const session = webChatManager.getSession(ip);
            let replyText = '';

            if (message.trim().toLowerCase() === "#reset") {
                await deleteThread(session);
                session.clear();
                replyText = "🔄 Chat reiniciado.";
            } else {
                const threadId = await getOrCreateThreadId(session);
                session.addUserMessage(message);
                
                const state = {
                    get: (key) => key === 'thread_id' ? session.thread_id : undefined,
                    update: async () => {},
                    clear: async () => session.clear(),
                };

                const webChatAdapterFn = async (assistantId, message, state, fallback, userId, threadId) => {
                    return await sendMessageToThread(threadId, message, assistantId);
                };

                const reply = await webChatAdapterFn(ASSISTANT_ID, message, state, "", ip, threadId);
                
                const flowDynamic = async (arr) => {
                    const text = Array.isArray(arr) ? arr.map(a => a.body).join('\n') : arr;
                    replyText = replyText ? replyText + "\n\n" + text : text;
                };

                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    reply,
                    { type: 'webchat', from: ip, thread_id: threadId, body: message },
                    flowDynamic,
                    state,
                    undefined,
                    () => {},
                    webChatAdapterFn,
                    ASSISTANT_ID
                );
                session.addAssistantMessage(replyText);
            }
            res.json({ reply: replyText });
        } catch (err) {
            console.error('Error /webchat-api:', err);
            res.status(500).json({ reply: 'Error interno.' });
        }
    });

    // Iniciar servidor
    try {
        console.log(`🚀 [INFO] Iniciando servidor en puerto ${PORT}...`);
        httpServer(+PORT);
        console.log(`✅ [INFO] Servidor escuchando en puerto ${PORT}`);
        if (app.server) {
            initSocketIO(app.server);
        }
    } catch (err) {
        console.error('❌ [ERROR] Error al iniciar servidor:', err);
    }

    console.log('✅ [INFO] Main function completed');
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Opcional: reiniciar proceso si es crítico
    // process.exit(1);
});

export { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowVideo, welcomeFlowDoc, locationFlow,
        handleQueue, userQueues, userLocks,
 };

main().catch(err => {
    console.error('❌ [FATAL] Error en la función main:', err);
});

//ok
//restored - Commit 210290e
