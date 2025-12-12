import { executeDbQuery } from "./utils/dbHandler";
// ...existing imports y lógica del bot...
import "dotenv/config";
import path from 'path';
import serve from 'serve-static';
import { Server } from 'socket.io';
import fs from 'fs';
import express from 'express';
import { createServer } from 'http';
// Estado global para encender/apagar el bot
let botEnabled = true;
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from "@builderbot/bot";
import { MemoryDB } from "@builderbot/bot";
import { BaileysProvider } from "builderbot-provider-sherpa";
import { restoreSessionFromDb, startSessionSync, deleteSessionFromDb } from "./utils/sessionSync";
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

                // Inicializar servidor Express propio para WebChat y QR
                const app = express();
                const server = createServer(app);

                // Middleware de logging
                app.use((req, res, next) => {
                    console.log(`[REQUEST] ${req.method} ${req.url}`);
                    next();
                });

                // Middleware para parsear JSON
                app.use(express.json());

                // Servir archivos estáticos
                app.use("/js", express.static("src/js"));
                app.use("/style", express.static("src/style"));
                app.use("/assets", express.static("src/assets"));

                // Endpoint para servir la imagen del QR
                app.get('/qr.png', (req, res) => {
                    const qrPath = path.join(process.cwd(), 'bot.qr.png');
                    if (fs.existsSync(qrPath)) {
                        res.setHeader('Content-Type', 'image/png');
                        fs.createReadStream(qrPath).pipe(res);
                    } else {
                        res.status(404).send('QR no encontrado');
                    }
                });

                // Dashboard principal con estado y opciones de control
                app.get('/', (req, res) => {
                    console.log('[DEBUG] Handling root request');
                    try {
                        const sessionExists = hasActiveSession();
                        res.status(200).send(`
                            <html>
                                <head>
                                    <title>Bot Dashboard</title>
                                    <meta name="viewport" content="width=device-width, initial-scale=1">
                                    <style>
                                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background: #f0f2f5; color: #333; }
                                        .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
                                        h1 { margin-top: 0; color: #1a1a1a; font-size: 24px; }
                                        h2 { font-size: 18px; color: #444; margin-bottom: 10px; }
                                        .btn { display: inline-block; padding: 12px 24px; background: #008069; color: white; text-decoration: none; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; transition: background 0.2s; }
                                        .btn:hover { background: #006d59; }
                                        .btn-danger { background: #dc3545; }
                                        .btn-danger:hover { background: #c82333; }
                                        .status { font-weight: bold; color: ${sessionExists ? '#008069' : '#d9534f'}; }
                                        .qr-container { text-align: center; margin: 20px 0; }
                                        img.qr { max-width: 280px; border: 1px solid #eee; border-radius: 8px; }
                                        .info-text { color: #666; font-size: 14px; line-height: 1.5; }
                                    </style>
                                    ${!sessionExists ? '<meta http-equiv="refresh" content="5">' : ''}
                                </head>
                                <body>
                                    <div class="card">
                                        <h1>🤖 Estado del Bot</h1>
                                        <p>Estado de Sesión: <span class="status">${sessionExists ? '✅ Activa (Archivos encontrados)' : '⏳ Esperando Escaneo'}</span></p>
                                        
                                        ${!sessionExists ? `
                                            <div class="qr-container">
                                                <h3>Escanea el código QR con WhatsApp</h3>
                                                <img src="/qr.png" class="qr" alt="Cargando QR..." onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                                                <p style="display:none; color:orange;">Generando QR... por favor espera.</p>
                                                <p class="info-text">La página se actualizará automáticamente cuando aparezca el QR.</p>
                                            </div>
                                        ` : `
                                            <p class="info-text">El bot ha detectado archivos de sesión. Si WhatsApp no responde, usa la opción de reinicio abajo.</p>
                                        `}
                                    </div>

                                    <div class="card">
                                        <h2>💬 WebChat</h2>
                                        <p class="info-text">Accede a la interfaz de chat web para pruebas o soporte.</p>
                                        <a href="/webchat" class="btn">Abrir WebChat</a>
                                    </div>

                                    <div class="card" style="border-left: 5px solid #dc3545;">
                                        <h2>⚠️ Zona de Peligro</h2>
                                        <p class="info-text">Si el bot no responde en WhatsApp, elimina la sesión para generar un nuevo QR.</p>
                                        <form action="/api/reset-session" method="POST" onsubmit="return confirm('¿Estás seguro? Esto desconectará WhatsApp, borrará la sesión actual y reiniciará el bot.');">
                                            <button type="submit" class="btn btn-danger">🗑️ Borrar Sesión y Reiniciar</button>
                                        </form>
                                    </div>
                                </body>
                            </html>
                        `);
                    } catch (e) {
                        console.error('[ERROR] Root handler failed:', e);
                        res.status(500).send('Internal Server Error');
                    }
                });

                // Endpoint para borrar sesión y reiniciar
                app.post('/api/reset-session', async (req, res) => {
                    try {
                        const sessionsDir = path.join(process.cwd(), 'bot_sessions');
                        console.log('[RESET] Solicitud de eliminación de sesión recibida.');
                        
                        // 1. Eliminar sesión local
                        if (fs.existsSync(sessionsDir)) {
                            console.log('[RESET] Eliminando directorio local:', sessionsDir);
                            fs.rmSync(sessionsDir, { recursive: true, force: true });
                        } else {
                            console.log('[RESET] El directorio local no existía.');
                        }

                        // 2. Eliminar sesión remota (Supabase)
                        await deleteSessionFromDb();

                        res.send(`
                            <html>
                                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                                    <h1 style="color: green;">✅ Sesión Eliminada (Local y Remota)</h1>
                                    <p>El bot se está reiniciando. Por favor espera unos 30 segundos y recarga la página principal para escanear el nuevo QR.</p>
                                    <script>
                                        setTimeout(() => { window.location.href = "/"; }, 15000);
                                    </script>
                                </body>
                            </html>
                        `);
                        
                        // Forzar salida del proceso para que Railway/Docker lo reinicie
                        console.log('[RESET] Saliendo del proceso para reiniciar...');
                        setTimeout(() => {
                            process.exit(0); 
                        }, 1000);
                    } catch (error) {
                        console.error('[RESET] Error:', error);
                        res.status(500).send('Error al reiniciar sesión: ' + error.message);
                    }
                });

                // Endpoint para obtener el nombre del asistente de forma dinámica
                app.get('/api/assistant-name', (req, res) => {
                        const assistantName = process.env.ASSISTANT_NAME || 'Asistente demo';
                        res.json({ name: assistantName });
                });

                                // Utilidad para servir páginas HTML estáticas
                                function serveHtmlPage(route, filename) {
                                    const handler = (req, res) => {
                                        console.log(`[DEBUG] Serving HTML for ${req.url} -> ${filename}`);
                                        try {
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
                                                res.sendFile(htmlPath);
                                            } else {
                                                console.error(`[ERROR] File not found. Searched in: ${possiblePaths.join(', ')}`);
                                                res.status(404).send('HTML no encontrado en el servidor');
                                            }
                                        } catch (err) {
                                            console.error(`[ERROR] Failed to serve ${filename}:`, err);
                                            res.status(500).send('Error interno al servir HTML');
                                        }
                                    };
                                    
                                    app.get(route, handler);
                                    // También registrar con slash final por si acaso
                                    app.get(route + '/', handler);
                                }

                                // Endpoint de debug para verificar sistema de archivos
                                app.get('/debug-info', (req, res) => {
                                    try {
                                        res.json({
                                            cwd: process.cwd(),
                                            dirname: __dirname,
                                            filesInSrc: fs.existsSync(path.join(process.cwd(), 'src')) ? fs.readdirSync(path.join(process.cwd(), 'src')) : 'src not found',
                                            filesInCwd: fs.readdirSync(process.cwd())
                                        });
                                    } catch (e) {
                                        res.status(500).json({ error: e.message });
                                    }
                                });

                                // Registrar páginas HTML
                                serveHtmlPage("/webchat", "webchat.html");
                                serveHtmlPage("/webreset", "webreset.html");

  // Endpoint para reiniciar el bot vía Railway
  app.post("/api/restart-bot", async (req, res) => {
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

                app.post('/webchat-api', async (req, res) => {
                    console.log('Llamada a /webchat-api');
                    if (req.body && req.body.message) {
                        try {
                            const message = req.body.message;
                            console.log('Mensaje recibido en webchat:', message);
                            let ip = '';
                            const xff = req.headers['x-forwarded-for'];
                            if (typeof xff === 'string') {
                                ip = xff.split(',')[0];
                            } else if (Array.isArray(xff)) {
                                ip = xff[0];
                            } else {
                                ip = req.ip || '';
                            }

                            // Usar WebChatManager
                            const { getOrCreateThreadId, sendMessageToThread, deleteThread } = await import('./utils-web/openaiThreadBridge');
                            const session = webChatManager.getSession(ip);
                            
                            let replyText = '';
                            
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
                                
                                // Mock state
                                const state = {
                                    get: (key) => key === 'thread_id' ? session.thread_id : undefined,
                                    update: async () => {},
                                    clear: async () => session.clear(),
                                };

                                // Adaptador
                                const webChatAdapterFn = async (assistantId, message, state, fallback, userId, threadId) => {
                                    try {
                                        return await sendMessageToThread(threadId, message, assistantId);
                                    } catch (e) {
                                        console.error("Error en webChatAdapterFn:", e);
                                        return fallback || "";
                                    }
                                };

                                // Obtener respuesta
                                const reply = await webChatAdapterFn(ASSISTANT_ID, finalMessage, state, "", ip, threadId);
                                console.log('🔍 DEBUG RAW ASSISTANT MSG (WebChat):', JSON.stringify(reply));

                                // FlowDynamic simulado
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

                                // Procesar respuesta
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
                            res.json({ reply: replyText });
                        } catch (err) {
                            console.error('Error en /webchat-api:', err);
                            res.status(500).json({ reply: 'Hubo un error procesando tu mensaje.' });
                        }
                    } else {
                        res.status(400).json({ error: "Falta 'message' en el body" });
                    }
                });

    // Iniciar servidor propio
    server.listen(PORT, () => {
        console.log(`✅ [INFO] Servidor Express escuchando en puerto ${PORT}`);
    });

    // Inicializar Socket.IO
    initSocketIO(server);

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