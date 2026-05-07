import { addKeyword, EVENTS } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { MemoryDB } from "@builderbot/bot";
import { reset } from "~/bot/timeOut";
import { userQueues, userLocks, handleQueue } from "~/bot/queueManager";
// El timeout se calcula dinámicamente dentro de la acción para soportar configuraciones en caliente

export const welcomeFlowTxt = addKeyword<BaileysProvider, MemoryDB>(EVENTS.WELCOME)
    .addAction(async (ctx, { gotoFlow, flowDynamic, state, provider }) => {
        const userId = ctx.from;

        // Filtrar contactos ignorados antes de agregar a la cola
        if (
            /@broadcast$/.test(userId) ||
            /@newsletter$/.test(userId) ||
            /@channel$/.test(userId)
        ) {
            console.log(`Mensaje ignorado por filtro de contacto: ${userId}`);
            return;
        }

        // --- FILTRO DE ECO / MENSAJES PROPIOS ---
        const botNumber = (process.env.YCLOUD_WABA_NUMBER || '').replace(/\D/g, '');
        const senderNumber = (userId || '').replace(/\D/g, '');
        
        if (ctx.key?.fromMe || (botNumber && senderNumber === botNumber)) {
            return;
        }

        console.log(`📩 Mensaje recibido de :${userId}`);

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

        console.log("📝 Mensaje de texto recibido");

        queue.push({ ctx, flowDynamic, state, provider, gotoFlow });

        if (!userLocks.get(userId) && queue.length === 1) {
            await handleQueue(userId);
        }
    });
