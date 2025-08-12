// Estado global para encender/apagar el bot
let botEnabled = true;
import "dotenv/config";
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from "@builderbot/bot";
import { MemoryDB } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { toAsk, httpInject } from "@builderbot-plugins/openai-assistants";
import { typing } from "./utils/presence";
import { idleFlow } from "./Flows/idleFlow";
import { welcomeFlowTxt } from "./Flows/welcomeFlowTxt";
import { welcomeFlowVoice } from "./Flows/welcomeFlowVoice";
import { welcomeFlowImg } from "./Flows/welcomeFlowImg";
import { welcomeFlowDoc } from "./Flows/welcomeFlowDoc";
//import { imgResponseFlow } from "./Flows/imgResponse";
//import { getSheet2 } from "./addModule/getSheet2";
//import { getSheet1 } from "./addModule/getSheet1";
//import { listImg } from "./addModule/listImg";
import { ErrorReporter } from "./utils/errorReporter";
//import { testAuth } from './utils/test-google-auth.js';
import { AssistantBridge } from './utils/AssistantBridge';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Definir __dirname para ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { processUserMessageWeb } from './utils/processUserMessageWeb';

/** Puerto en el que se ejecutará el servidor */
const PORT = process.env.PORT ?? "";
/** ID del asistente de OpenAI */
export const ASSISTANT_ID = process.env.ASSISTANT_ID;
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_WS ?? "";

const userQueues = new Map();
const userLocks = new Map();

const adapterProvider = createProvider(BaileysProvider, {
    groupsIgnore: false,
    readStatus: false,
});

const errorReporter = new ErrorReporter(adapterProvider, ID_GRUPO_RESUMEN); // Reemplaza YOUR_GROUP_ID con el ID del grupo de WhatsApp

const TIMEOUT_MS = 30000;

// Control de timeout por usuario para evitar ejecuciones automáticas superpuestas
const userTimeouts = new Map();

const getAssistantResponse = async (assistantId, message, state, fallbackMessage, userId) => {
  // Si hay un timeout previo, lo limpiamos
  if (userTimeouts.has(userId)) {
    clearTimeout(userTimeouts.get(userId));
    userTimeouts.delete(userId);
  }

  let timeoutResolve;
  const timeoutPromise = new Promise((resolve) => {
    timeoutResolve = resolve;
    const timeoutId = setTimeout(() => {
      console.warn("⏱ Timeout alcanzado. Reintentando con mensaje de control...");
      resolve(toAsk(assistantId, fallbackMessage ?? message, state));
      userTimeouts.delete(userId);
    }, TIMEOUT_MS);
    userTimeouts.set(userId, timeoutId);
  });

  // Lanzamos la petición a OpenAI
  const askPromise = toAsk(assistantId, message, state).then((result) => {
    // Si responde antes del timeout, limpiamos el timeout
    if (userTimeouts.has(userId)) {
      clearTimeout(userTimeouts.get(userId));
      userTimeouts.delete(userId);
    }
    // Resolvemos el timeout para evitar que quede pendiente
    timeoutResolve(result);
    return result;
  });

  // El primero que responda (OpenAI o timeout) gana
  return Promise.race([askPromise, timeoutPromise]);
};

const processUserMessage = async (
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

        // Si el bot está apagado, ignorar todo excepto #ON#
        if (!botEnabled) {
            return;
        }

        // Interceptar trigger de imagen antes de pasar al asistente
        // if (body === "#TestImg#") {
        //     // Usar el flow de imagen para responder y detener el flujo
        //     return gotoFlow(imgResponseFlow);
        // }

        // const response = await toAsk(ASSISTANT_ID, ctx.body, state);
        const response = await getAssistantResponse(ASSISTANT_ID, ctx.body, state, "Por favor, responde aunque sea brevemente.", ctx.from);

        if (!response) {
            // Enviar reporte de error al grupo de WhatsApp
            await errorReporter.reportError(
                new Error("No se recibió respuesta del asistente."),
                ctx.from,
                `https://wa.me/${ctx.from}`
            );
        }

        const textResponse = typeof response === "string" ? response : String(response);
        const chunks = textResponse.split(/\n\n+/);
        for (const chunk of chunks) {
            // Detecta trigger de imagen en la respuesta del asistente
            const imgMatch = chunk.trim().match(/\[IMG\]\s*(.+)/i);
            if (imgMatch) {
                const imageName = imgMatch[1].trim();
                // Buscar imagen en Drive usando el flow
                // const { getDriveImageUrl } = await import("./Flows/imgResponse.js");
                // const imageUrl = await getDriveImageUrl(imageName);
                // if (imageUrl) {
                //     await flowDynamic([
                //         {
                //             body: `Aquí tienes la imagen solicitada: ${imageName}`,
                //             media: imageUrl
                //         }
                //     ]);
                // }
                // No enviar el chunk como texto
                continue;
            }
            // Detecta "un momento" en cualquier combinación de mayúsculas/minúsculas
            if (/un momento/i.test(chunk.trim())) {
                await flowDynamic([{ body: chunk.trim() }]);
                // Esperar 5 segundos y volver a consultar al asistente por la respuesta final
                await new Promise(res => setTimeout(res, 10000));
                const followup = await toAsk(ASSISTANT_ID, ctx.body, state);
                if (followup && !/un momento/i.test(followup)) {
                    await flowDynamic([{ body: String(followup).trim() }]);
                }
                continue;
            }
            // Enviar el chunk tal como lo entrega el asistente, sin limpiar ni alterar el formato
            await flowDynamic([{ body: chunk.trim() }]);
        }
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

// Main function to initialize the bot and load Google Sheets data
const main = async () => {
    // Verificar credenciales de Google Sheets al iniciar
    //await testAuth();

    // Actualizar listado de imágenes en vector store
    //await listImg();

    // Paso 1: Inicializar datos desde Google Sheets
    // ...existing code...


        // Inicializar el servidor Express y Socket.IO para el webchat en el puerto 3000
        const webchatApp = express();
        webchatApp.get('/', (req, res) => {
          res.sendFile(path.resolve(__dirname, 'src/webchat.html'));
        });

        webchatApp.get('/qr', (req, res) => {
          res.sendFile(path.resolve(__dirname, 'bot.qr.png'));
        });

        const webchatServer = http.createServer(webchatApp);
        const io = new Server(webchatServer, {
            cors: { origin: "*" }
        });

        io.on('connection', (socket) => {
            console.log('💬 Cliente web conectado');
            socket.on('message', async (msg) => {
                try {
                    console.log(`📩 Mensaje web: ${msg}`);
                    const reply = await processUserMessageWeb(msg);
                    socket.emit('reply', reply);
                } catch (err) {
                    console.error("❌ Error procesando mensaje:", err);
                    socket.emit('reply', "Hubo un error procesando tu mensaje.");
                }
            });
            socket.on('disconnect', () => {
                console.log('👋 Cliente web desconectado');
            });
        });

        webchatServer.listen(3000, () => {
            console.log('🚀 Webchat escuchando en http://localhost:3000/webchat');
        });
    // ...existing code...
    const adapterFlow = createFlow([welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, idleFlow]);
    const adapterProvider = createProvider(BaileysProvider, {
        groupsIgnore: false,
        readStatus: false,
    });
    const adapterDB = new MemoryDB();
    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });
    httpInject(adapterProvider.server);
    httpServer(+PORT);
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc,
        handleQueue, userQueues, userLocks,
 };

main();

//ok