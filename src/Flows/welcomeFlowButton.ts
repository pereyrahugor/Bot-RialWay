import { addKeyword, EVENTS } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { MemoryDB } from "@builderbot/bot";
import { reset } from "../utils/timeOut";
import { userQueues, userLocks, handleQueue } from "../utils/queueManager";

// El timeout se calcula dinámicamente dentro de la acción

export const welcomeFlowButton = addKeyword<BaileysProvider, MemoryDB>(EVENTS.ACTION)
    .addAction(async (ctx, { gotoFlow, flowDynamic, state, provider }) => {
        const userId = ctx.from;

        // Filtrar contactos ignorados
        if (
            /@broadcast$/.test(userId) ||
            /@newsletter$/.test(userId) ||
            /@channel$/.test(userId)
        ) {
            console.log(`Botón ignorado por filtro de contacto: ${userId}`);
            return;
        }

        console.log(`🔘 Botón recibido de :${userId}`);
        console.log(`Cuerpo del botón: ${ctx.body}`);

        const setTime = (Number(process.env.timeOutCierre) || 45) * 60 * 1000;
        reset(ctx, gotoFlow, setTime);

        // Asegurar que userQueues tenga un array inicializado para este usuario
        if (!userQueues.has(userId)) {
            userQueues.set(userId, []);
        }

        const queue = userQueues.get(userId);

        if (!queue) {
            console.error(`❌ Error: No se pudo inicializar la cola de mensajes para ${userId}`);
            return;
        }

        console.log("📝 Procesando interacción de botón");

        // Agregamos a la cola para que el asistente lo procese
        queue.push({ ctx, flowDynamic, state, provider, gotoFlow });

        if (!userLocks.get(userId) && queue.length === 1) {
            await handleQueue(userId);
        }
    });
