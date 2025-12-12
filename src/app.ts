import { executeDbQuery } from "./utils/dbHandler";
// ...existing imports y lógica del bot...
import "dotenv/config";
import path from 'path';
import serve from 'serve-static';
import { Server } from 'socket.io';
import fs from 'fs';
// Estado global para encender/apagar el bot
let botEnabled = true;
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from "@builderbot/bot";
import { MemoryDB } from "@builderbot/bot";
import { BaileysProvider } from "builderbot-provider-sherpa";
import { restoreSessionFromDb, startSessionSync } from "./utils/sessionSync";
import { toAsk, httpInject } from "@builderbot-plugins/openai-assistants";
import { typing } from "./utils/presence";
import { idleFlow } from "./Flows/idleFlow";
import { welcomeFlowTxt } from "./Flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./Flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./Flows/welcomeFlowImg";
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
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_WS ?? "";

const userQueues = new Map();
const userLocks = new Map();


const adapterProvider = createProvider(BaileysProvider, {
    version: [2, 3000, 1030817285],
    groupsIgnore: false,
    readStatus: false,
    // SIEMPRE deshabilitar el servidor HTTP de Sherpa para evitar reinicios
    // El QR se mostrará en los logs de Railway (Deployments > Logs)
    disableHttpServer: true,
});

const errorReporter = new ErrorReporter(adapterProvider, ID_GRUPO_RESUMEN); // Reemplaza YOUR_GROUP_ID con el ID del grupo de WhatsApp

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

// Función auxiliar para verificar si existe sesión activa
const hasActiveSession = () => {
    try {
        const sessionsDir = path.join(process.cwd(), 'bot_sessions');
        if (!fs.existsSync(sessionsDir)) return false;
        const files = fs.readdirSync(sessionsDir);
        // Verificar si hay archivos que no sean ocultos (opcional, pero length > 0 suele bastar)
        return files.length > 0;
    } catch (error) {
        console.error('Error verificando sesión:', error);
        return false;
    }
};

// Main function to initialize the bot and load Google Sheets data
const main = async () => {
    // Verificar credenciales de Google Sheets al iniciar
    //await testAuth();

    // Actualizar listado de imágenes en vector store
    //await listImg();

    // // Paso 1: Inicializar datos desde Google Sheets
     console.log("📌 Inicializando datos desde Google Sheets...");

    // Restaurar sesión de WhatsApp desde Supabase si existe
    await restoreSessionFromDb();

    // Cargar todas las hojas principales con una sola función reutilizable
    await updateMain();


                // ...existing code...
                const adapterFlow = createFlow([welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, locationFlow, idleFlow]);

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

                // httpInject(adapterProvider.server); // DESHABILITADO: Causa reinicios al acceder a rutas del QR

                // Usar la instancia Polka (httpServer de createBot es la más confiable)
                let polkaApp = (httpServer || adapterProvider.server) as any;
                
                if (!polkaApp || typeof polkaApp.get !== 'function' || typeof polkaApp.use !== 'function') {
                    console.error('❌ [ERROR] No se pudo obtener una instancia válida de Polka (httpServer). Usando dummy app para evitar crash.');
                    polkaApp = {
                        use: (...args) => console.log('⚠️ [DUMMY] use called', args[0]),
                        get: (...args) => console.log('⚠️ [DUMMY] get called', args[0]),
                        post: (...args) => console.log('⚠️ [DUMMY] post called', args[0]),
                        listen: (...args) => console.log('⚠️ [DUMMY] listen called')
                    };
                }

                // Middleware de logging para debug
                polkaApp.use((req, res, next) => {
                    console.log(`[REQUEST] ${req.method} ${req.url}`);
                    next();
                });

                polkaApp.use("/js", serve("src/js"));
                polkaApp.use("/style", serve("src/style"));
                polkaApp.use("/assets", serve("src/assets"));

                // Endpoint para servir la imagen del QR
                polkaApp.get('/qr.png', (req, res) => {
                    const qrPath = path.join(process.cwd(), 'bot.qr.png');
                    if (fs.existsSync(qrPath)) {
                        res.setHeader('Content-Type', 'image/png');
                        fs.createReadStream(qrPath).pipe(res);
                    } else {
                        res.writeHead(404);
                        res.end('QR no encontrado');
                    }
                });

                // Redireccionar raíz a /webchat SOLO si hay sesión activa
                polkaApp.get('/', (req, res) => {
                    console.log('[DEBUG] Handling root request');
                    try {
                        if (hasActiveSession()) {
                            console.log('[DEBUG] Session active, redirecting to /webchat');
                            res.writeHead(302, { 'Location': '/webchat' });
                            res.end();
                        } else {
                            console.log('[DEBUG] No session, showing QR page');
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(`
                            <html>
                                <head>
                                    <title>Bot QR</title>
                                    <meta http-equiv="refresh" content="5">
                                    <style>
                                        body { display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f2f5; font-family: sans-serif; }
                                        .container { text-align: center; background: white; padding: 2rem; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                                        img { max-width: 300px; margin-bottom: 1rem; }
                                        p { color: #54656f; }
                                    </style>
                                </head>
                                <body>
                                    <div class="container">
                                        <h1>Escanea el código QR</h1>
                                        <img src="/qr.png" alt="Cargando QR..." onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                                        <p style="display:none">Esperando generación del QR...</p>
                                        <p>La página se actualizará automáticamente.</p>
                                    </div>
                                </body>
                            </html>
                        `);
                        }
                    } catch (e) {
                        console.error('[ERROR] Root handler failed:', e);
                        res.statusCode = 500;
                        res.end('Internal Server Error');
                    }
                });

                                // Endpoint para obtener el nombre del asistente de forma dinámica
                                polkaApp.get('/api/assistant-name', (req, res) => {
                                        const assistantName = process.env.ASSISTANT_NAME || 'Asistente demo';
                                        res.setHeader('Content-Type', 'application/json');
                                        res.end(JSON.stringify({ name: assistantName }));
                                });

                                // Utilidad para servir páginas HTML estáticas
                                function serveHtmlPage(route, filename) {
                                    const handler = (req, res) => {
                                        console.log(`[DEBUG] Serving HTML for ${req.url} -> ${filename}`);
                                        try {
                                            res.setHeader("Content-Type", "text/html");
                                            
                                            // Intentar múltiples rutas posibles
                                            const possiblePaths = [
                                                path.join(process.cwd(), 'src', filename),
                                                path.join(__dirname, filename),
                                                path.join(process.cwd(), filename),
                                                path.join(__dirname, '..', 'src', filename)
                                            ];

                                            let htmlPath = null;
                                            for (const p of possiblePaths) {
                                                if (fs.existsSync(p)) {
                                                    htmlPath = p;
                                                    break;
                                                }
                                            }

                                            if (htmlPath) {
                                                console.log(`[DEBUG] Found file at: ${htmlPath}`);
                                                const content = fs.readFileSync(htmlPath);
                                                res.end(content);
                                            } else {
                                                console.error(`[ERROR] File not found. Searched in: ${possiblePaths.join(', ')}`);
                                                res.statusCode = 404;
                                                res.end('HTML no encontrado en el servidor');
                                            }
                                        } catch (err) {
                                            console.error(`[ERROR] Failed to serve ${filename}:`, err);
                                            res.statusCode = 500;
                                            res.end('Error interno al servir HTML');
                                        }
                                    };
                                    
                                    polkaApp.get(route, handler);
                                    // También registrar con slash final por si acaso
                                    polkaApp.get(route + '/', handler);
                                }

                                // Endpoint de debug para verificar sistema de archivos
                                polkaApp.get('/debug-info', (req, res) => {
                                    try {
                                        res.setHeader('Content-Type', 'application/json');
                                        res.end(JSON.stringify({
                                            cwd: process.cwd(),
                                            dirname: __dirname,
                                            filesInSrc: fs.existsSync(path.join(process.cwd(), 'src')) ? fs.readdirSync(path.join(process.cwd(), 'src')) : 'src not found',
                                            filesInCwd: fs.readdirSync(process.cwd())
                                        }, null, 2));
                                    } catch (e) {
                                        res.statusCode = 500;
                                        res.end(JSON.stringify({ error: e.message }));
                                    }
                                });

                                // Registrar páginas HTML
                                serveHtmlPage("/webchat", "webchat.html");
                                serveHtmlPage("/webreset", "webreset.html");

  // Endpoint para reiniciar el bot vía Railway
  polkaApp.post("/api/restart-bot", async (req, res) => {
  console.log('POST /api/restart-bot recibido');
  try {
    const result = await RailwayApi.restartActiveDeployment();
    console.log('Resultado de restartRailwayDeployment:', result);
    if (result.success) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: "Reinicio solicitado correctamente."
      }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: result.error || "Error desconocido" }));
    }
  } catch (err: any) {
    console.error('Error en /api/restart-bot:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
});


                // Integrar Socket.IO sobre el servidor HTTP real de BuilderBot
                // Se inicializa DESPUÉS de iniciar el servidor para asegurar que la instancia exista
                const initSocketIO = (serverInstance) => {
                    if (serverInstance) {
                        console.log('✅ [DEBUG] Inicializando Socket.IO...');
                        const io = new Server(serverInstance, { cors: { origin: '*' } });
                        io.on('connection', (socket) => {
                            console.log('💬 Cliente web conectado');
                            socket.on('message', async (msg) => {
                                // Procesar el mensaje usando la lógica principal del bot
                                try {
                                    let ip = '';
                                    const xff = socket.handshake.headers['x-forwarded-for'];
                                    if (typeof xff === 'string') {
                                        ip = xff.split(',')[0];
                                    } else if (Array.isArray(xff)) {
                                        ip = xff[0];
                                    } else {
                                        ip = socket.handshake.address || '';
                                    }
                                    // Centralizar historial y estado igual que WhatsApp
                                    if (!global.webchatHistories) global.webchatHistories = {};
                                    const historyKey = `webchat_${ip}`;
                                    if (!global.webchatHistories[historyKey]) global.webchatHistories[historyKey] = [];
                                    const _history = global.webchatHistories[historyKey];
                                    const state = {
                                        get: function (key) {
                                            if (key === 'history') return _history;
                                            return undefined;
                                        },
                                        update: async function (msg, role = 'user') {
                                            if (_history.length > 0) {
                                                const last = _history[_history.length - 1];
                                                if (last.role === role && last.content === msg) return;
                                            }
                                            _history.push({ role, content: msg });
                                            if (_history.length >= 6) {
                                                const last3 = _history.slice(-3);
                                                if (last3.every(h => h.role === 'user' && h.content === msg)) {
                                                    _history.length = 0;
                                                }
                                            }
                                        },
                                        clear: async function () { _history.length = 0; }
                                    };
                                    const provider = undefined;
                                    const gotoFlow = () => {};
                                    let replyText = '';
                                    const flowDynamic = async (arr) => {
                                        if (Array.isArray(arr)) {
                                            replyText = arr.map(a => a.body).join('\n');
                                        } else if (typeof arr === 'string') {
                                            replyText = arr;
                                        }
                                    };
                                    if (msg.trim().toLowerCase() === "#reset" || msg.trim().toLowerCase() === "#cerrar") {
                                        await state.clear();
                                        replyText = "🔄 El chat ha sido reiniciado. Puedes comenzar una nueva conversación.";
                                    } else {
                                        const threadId = state.get && state.get('thread_id');
                                        let finalMessage = msg;
                                        if (!threadId) {
                                            finalMessage = `Fecha y hora actual: ${getArgentinaDatetimeString()}\n` + msg;
                                        }
                                        await processUserMessage({ from: ip, body: finalMessage, type: 'webchat' }, { flowDynamic, state, provider, gotoFlow });
                                    }
                                    socket.emit('reply', replyText);
                                } catch (err) {
                                    console.error('Error procesando mensaje webchat:', err);
                                    socket.emit('reply', 'Hubo un error procesando tu mensaje.');
                                }
                            });
                        });
                    } else {
                        console.error('❌ [ERROR] No se pudo obtener realHttpServer para Socket.IO');
                    }
                };



                // Integrar AssistantBridge si es necesario
                // const assistantBridge = new AssistantBridge();
                // assistantBridge.setupWebChat(polkaApp, realHttpServer);

                                polkaApp.post('/webchat-api', async (req, res) => {
                                    console.log('Llamada a /webchat-api'); // log para debug
                                    // Si el body ya está disponible (por ejemplo, con body-parser), úsalo directamente
                                    if (req.body && req.body.message) {
                                        console.log('Body recibido por body-parser:', req.body); // debug
                                        try {
                                            const message = req.body.message;
                                            console.log('Mensaje recibido en webchat:', message); // debug
                                            let ip = '';
                                            const xff = req.headers['x-forwarded-for'];
                                            if (typeof xff === 'string') {
                                                ip = xff.split(',')[0];
                                            } else if (Array.isArray(xff)) {
                                                ip = xff[0];
                                            } else {
                                                ip = req.socket.remoteAddress || '';
                                            }
                                            // Crear un ctx similar al de WhatsApp, usando el IP como 'from'
                                            const ctx = {
                                                from: ip,
                                                body: message,
                                                type: 'webchat',
                                                // Puedes agregar más propiedades si tu lógica lo requiere
                                            };
                                            // Usar la lógica principal del bot (processUserMessage)
                                            let replyText = '';
                                            // Simular flowDynamic para capturar la respuesta (acumulativo)
                                            const flowDynamic = async (arr) => {
                                                let textToAdd = "";
                                                if (Array.isArray(arr)) {
                                                   textToAdd = arr.map(a => a.body).join('\n');
                                                } else if (typeof arr === 'string') {
                                                   textToAdd = arr;
                                                }
                                                if (replyText) replyText += "\n\n" + textToAdd;
                                                else replyText = textToAdd;
                                            };
                                                // Usar WebChatManager y WebChatSession para gestionar la sesión webchat
                                                const { getOrCreateThreadId, sendMessageToThread, deleteThread } = await import('./utils-web/openaiThreadBridge');
                                                const session = webChatManager.getSession(ip);
                                                if (message.trim().toLowerCase() === "#reset" || message.trim().toLowerCase() === "#cerrar") {
                                                    await deleteThread(session);
                                                    session.clear();
                                                    replyText = "🔄 El chat ha sido reiniciado. Puedes comenzar una nueva conversación.";
                                                } else {
                                                    let threadId = await getOrCreateThreadId(session);
                                                    let finalMessage = message;
                                                    if (!threadId) {
                                                        finalMessage = `Fecha y hora actual: ${getArgentinaDatetimeString()}\n` + message;
                                                    }
                                                    session.addUserMessage(finalMessage);
                                                    threadId = await getOrCreateThreadId(session);
                                                    
                                                    // Mock state para compatibilidad con AssistantResponseProcessor
                                                    const state = {
                                                        get: (key) => key === 'thread_id' ? session.thread_id : undefined,
                                                        update: async () => {}, // No necesitamos historial aqui, lo maneja session
                                                        clear: async () => session.clear(),
                                                    };

                                                     // Adaptador para getAssistantResponse usando sendMessageToThread
                                                    const webChatAdapterFn = async (assistantId, message, state, fallback, userId, threadId) => {
                                                        try {
                                                            return await sendMessageToThread(threadId, message, assistantId);
                                                        } catch (e) {
                                                            console.error("Error en webChatAdapterFn:", e);
                                                            return fallback || "";
                                                        }
                                                    };

                                                    // Obtener primera respuesta
                                                    const reply = await webChatAdapterFn(ASSISTANT_ID, finalMessage, state, "", ip, threadId);
                                                    console.log('🔍 DEBUG RAW ASSISTANT MSG (WebChat):', JSON.stringify(reply));

                                                    // Usar AssistantResponseProcessor
                                                    const ctxMock = { type: 'webchat', from: ip, thread_id: threadId, body: finalMessage };
                                                    
                                                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                                                        reply,
                                                        ctxMock,
                                                        flowDynamic,
                                                        state,
                                                        undefined,
                                                        () => {},
                                                        webChatAdapterFn,
                                                        ASSISTANT_ID
                                                    );

                                                    session.addAssistantMessage(replyText);
                                            }
                                            res.setHeader('Content-Type', 'application/json');
                                            res.end(JSON.stringify({ reply: replyText }));
                                        } catch (err) {
                                            console.error('Error en /webchat-api:', err); // debug
                                            res.statusCode = 500;
                                            res.end(JSON.stringify({ reply: 'Hubo un error procesando tu mensaje.' }));
                                        }
                                    } else {
                                        // Fallback manual si req.body no está disponible
                                        let body = '';
                                        req.on('data', chunk => { body += chunk; });
                                        req.on('end', async () => {
                                            console.log('Body recibido en /webchat-api:', body); // log para debug
                                            try {
                                                const { message } = JSON.parse(body);
                                                console.log('Mensaje recibido en webchat:', message); // debug
                                                let ip = '';
                                                const xff = req.headers['x-forwarded-for'];
                                                if (typeof xff === 'string') {
                                                    ip = xff.split(',')[0];
                                                } else if (Array.isArray(xff)) {
                                                    ip = xff[0];
                                                } else {
                                                    ip = req.socket.remoteAddress || '';
                                                }
                                                // Centralizar historial y estado igual que WhatsApp
                                                if (!global.webchatHistories) global.webchatHistories = {};
                                                const historyKey = `webchat_${ip}`;
                                                if (!global.webchatHistories[historyKey]) global.webchatHistories[historyKey] = { history: [], thread_id: null };
                                                const _store = global.webchatHistories[historyKey];
                                                const _history = _store.history;
                                                const state = {
                                                    get: function (key) {
                                                        if (key === 'history') return _history;
                                                        if (key === 'thread_id') return _store.thread_id;
                                                        return undefined;
                                                    },
                                                    setThreadId: function (id) {
                                                        _store.thread_id = id;
                                                    },
                                                    update: async function (msg, role = 'user') {
                                                        if (_history.length > 0) {
                                                            const last = _history[_history.length - 1];
                                                            if (last.role === role && last.content === msg) return;
                                                        }
                                                        _history.push({ role, content: msg });
                                                        if (_history.length >= 6) {
                                                            const last3 = _history.slice(-3);
                                                            if (last3.every(h => h.role === 'user' && h.content === msg)) {
                                                                _history.length = 0;
                                                                _store.thread_id = null;
                                                            }
                                                        }
                                                    },
                                                    clear: async function () { _history.length = 0; _store.thread_id = null; }
                                                };
                                                const provider = undefined;
                                                const gotoFlow = () => {};
                                                let replyText = '';
                                                const flowDynamic = async (arr) => {
                                                    if (Array.isArray(arr)) {
                                                        replyText = arr.map(a => a.body).join('\n');
                                                    } else if (typeof arr === 'string') {
                                                        replyText = arr;
                                                    }
                                                };
                                                if (message.trim().toLowerCase() === "#reset" || message.trim().toLowerCase() === "#cerrar") {
                                                    await state.clear();
                                                    replyText = "🔄 El chat ha sido reiniciado. Puedes comenzar una nueva conversación.";
                                                } else {
                                                    // ...thread_id gestionado por openaiThreadBridge, no es necesario actualizar aquí...
                                                }
                                                res.setHeader('Content-Type', 'application/json');
                                                res.end(JSON.stringify({ reply: replyText }));
                                            } catch (err) {
                                                console.error('Error en /webchat-api:', err); // debug
                                                res.statusCode = 500;
                                                res.end(JSON.stringify({ reply: 'Hubo un error procesando tu mensaje.' }));
                                            }
                                        });
                                    }
                                });

            // No llamar a listen, BuilderBot ya inicia el servidor

    // ...existing code...
    const serverInstance = httpServer(+PORT) as any;
    
    // Intentar inicializar Socket.IO con la instancia devuelta
    if (serverInstance) {
        initSocketIO(serverInstance);
    } else {
        // Fallback: intentar buscar en adapterProvider.server.server si httpServer no devolvió nada
        const fallbackServer = (adapterProvider.server as any)?.server;
        if (fallbackServer) {
            console.log('⚠️ [WARN] Usando fallbackServer para Socket.IO');
            initSocketIO(fallbackServer);
        } else {
             console.error('❌ [ERROR] No se pudo obtener ninguna instancia de servidor para Socket.IO');
        }
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

export { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, locationFlow,
        handleQueue, userQueues, userLocks,
 };

main();

//ok