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
import { ErrorReporter } from "./utils/errorReporter";
import Vapi from '@vapi-ai/web';

/** Puerto en el que se ejecutará el servidor */
const PORT = process.env.PORT ?? "";
/** ID del asistente de OpenAI */
const ASSISTANT_ID = process.env.ASSISTANT_ID;
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
            // Detecta "un momento" en cualquier combinación de mayúsculas/minúsculas
            if (/un momento/i.test(chunk.trim())) {
                await flowDynamic([{ body: chunk.trim() }]);
                // Esperar 5 segundos y volver a consultar al asistente por la respuesta final
                await new Promise(res => setTimeout(res, 20000));
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

    // Paso 4: Crear el flujo principal del bot
    const adapterFlow = createFlow([welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc, idleFlow]);
    // Paso 5: Crear el proveedor de WhatsApp (Baileys)
    const adapterProvider = createProvider(BaileysProvider, {
        groupsIgnore: false,
        readStatus: false,
    });
    // Paso 6: Crear la base de datos en memoria
    const adapterDB = new MemoryDB();
    // Paso 7: Inicializar el bot con los flujos, proveedor y base de datos
    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    // Paso 8: Inyectar el servidor HTTP para el proveedor
    httpInject(adapterProvider.server);
    // Paso 9: Iniciar el servidor HTTP en el puerto especificado
    httpServer(+PORT);

    // Ejecutar la llamada Vapi al iniciar el bot
    // try {
    //     const { DerivationFlowCall } = await import('./utils/derivationFlowCall');
    //     const vapi = new DerivationFlowCall('744e89bf-37d1-4f2a-bdf5-ec6bb02b1a4b');
    //     vapi.startCall('65689436-679f-4889-9774-091545cc846b', 'e732810d-144e-482f-80a2-2419319b56e4', {
    //         customer: {
    //             number: '+5491130792789' // número destino
    //         }
    //     });
    // } catch (err) {
    //     console.error('Error en la llamada Vapi desde main:', err);
    // }
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

export { welcomeFlowTxt, welcomeFlowVoice, welcomeFlowImg, welcomeFlowDoc,
    handleQueue, userQueues, userLocks,
 };

main();

//ok