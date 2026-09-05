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

        // --- FILTRO DE EVENTOS DE REACCIÓN ---
        if (ctx.type === 'reaction' || ctx.body === '_event_reaction_' || String(ctx.body || '').startsWith('_event_reaction_')) {
            return;
        }

        // --- FILTRO DE ECO / MENSAJES PROPIOS ---
        if (ctx.key?.fromMe) {
            return;
        }

        const { HistoryHandler } = await import("~/db/historyHandler");
        const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || HistoryHandler.PROJECT_IDENTIFIER;
        const dynamicServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber) || HistoryHandler.SERVICE_IDENTIFIER;

        // --- FILTRO DE LISTA NEGRA TEMPRANO ---
        const isBlocked = await HistoryHandler.isContactBlacklisted(userId, dynamicProjectId, dynamicServiceId);
        if (isBlocked) {
            console.log(`[welcomeFlowTxt] ⛔ Contacto ${userId} en LISTA NEGRA. Omitiendo procesamiento.`);
            return;
        }

        console.log(`📩 Mensaje recibido de :${userId}`);

        const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre', dynamicProjectId, dynamicServiceId) || 45;
        const setTime = Number(timeoutCierreValue) * 60 * 1000;
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
