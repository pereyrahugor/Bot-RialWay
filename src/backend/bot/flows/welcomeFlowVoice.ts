import { addKeyword, EVENTS } from "@builderbot/bot";
import { BaileysProvider } from "@builderbot/provider-baileys";
import { MemoryDB } from "@builderbot/bot";
import { reset, stop } from "~/bot/timeOut";
import { userQueues, userLocks, handleQueue } from "~/bot/queueManager"; 
import { transcribeAudioFile } from "~/apis/openai/audioTranscriptior";
import path from "path";
import fs from "fs";

// El timeout se calcula dinámicamente dentro de la acción

export const welcomeFlowVoice = addKeyword<any, any>(EVENTS.VOICE_NOTE)
    .addAction(async (ctx, { gotoFlow, flowDynamic, state, provider }) => {
        const userId = ctx.from;

        // Filtrar contactos ignorados antes de agregar a la cola
        if (
            /@broadcast$/.test(userId) ||
            /@newsletter$/.test(userId) ||
            /@channel$/.test(userId)
        ) {
            console.log(`Mensaje de voz ignorado por filtro de contacto: ${userId}`);
            return;
        }

        // --- FILTRO DE ECO / MENSAJES PROPIOS ---
        if (ctx.key?.fromMe) {
            return;
        }

        const { HistoryHandler } = await import("~/db/historyHandler");

        console.log(`🎙️ Mensaje de voz recibido de ${userId}`);

        const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre') || 45;
        const setTime = Number(timeoutCierreValue) * 60 * 1000;
        reset(ctx, gotoFlow, setTime);

        // Asegurar que userQueues tenga un array inicializado para este usuario
        if (!userQueues.has(userId)) {
            userQueues.set(userId, []);
        }


        // 📌 Definir ruta donde se guardarán los audios
        const audioFolder = path.join("./tmp/voiceNote/");

        // 📌 Crear la carpeta si no existe
        if (!fs.existsSync(audioFolder)) {
            fs.mkdirSync(audioFolder, { recursive: true });
            console.log("📂 Carpeta 'tmp/voiceNote' creada.");
        }

        // Descargar el archivo de audio internamente en el flujo para garantizar su integridad y correcta transcripción
        const localPath = await provider.saveFile(ctx, { path: "./tmp/voiceNote/" });
        console.log(`📂 Ruta del archivo de audio: ${localPath}`);

        const { supabase } = await import("~/db/historyHandler");
        const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || HistoryHandler.PROJECT_IDENTIFIER;
        const chatId = userId;
        const externalId = ctx.key?.id || ctx.payload?.id || ctx.id;

        // Normalizar la ruta a URL relativa web
        let webPath = localPath;
        if (webPath && typeof webPath === 'string') {
            const normalized = webPath.replace(/\\/g, '/');
            const tmpIdx = normalized.toLowerCase().indexOf('/tmp/');
            if (tmpIdx !== -1) {
                webPath = normalized.substring(tmpIdx);
            }
        }

        // Actualizar el mensaje original con la ruta real del audio para que sea reproducible en el CRM
        if (process.env.STORAGE_MODE === "local") {
            try {
                const { LocalHistoryStore } = await import("~/db/localHistoryStore");
                const list = LocalHistoryStore.getMessagesList(dynamicProjectId);
                const msgIdx = list.findIndex(m => m.external_id === externalId);
                if (msgIdx !== -1) {
                    list[msgIdx].content = webPath;
                    list[msgIdx].type = ctx.type || 'voice';
                    LocalHistoryStore.saveMessagesList(dynamicProjectId, list);
                    console.log(`💾 Mensaje de voz ${externalId} actualizado en BD local: ${webPath}`);
                }
            } catch (dbErr: any) {
                console.error("❌ Error actualizando ruta local de nota de voz:", dbErr.message);
            }
        } else if (supabase && externalId) {
            try {
                await supabase
                    .from('messages')
                    .update({
                        content: webPath,
                        type: ctx.type || 'voice'
                    })
                    .eq('external_id', externalId)
                    .eq('project_id', dynamicProjectId);
                console.log(`💾 Mensaje de voz ${externalId} actualizado en BD con la ruta local: ${webPath}`);
            } catch (dbErr: any) {
                console.error("❌ Error actualizando ruta de nota de voz en base de datos:", dbErr.message);
            }
        }

        // Verificar si el bot está activo para este chat/proyecto
        const isBotActiveForUser = await HistoryHandler.isBotEnabled(chatId, dynamicProjectId);
        const isGlobalBotEnabledSetting = await HistoryHandler.getSetting('GLOBAL_BOT_ENABLED', dynamicProjectId);
        const isGlobalBotEnabled = isGlobalBotEnabledSetting !== 'false';
        const botEnabledForChat = isGlobalBotEnabled && isBotActiveForUser;

        if (!botEnabledForChat) {
            console.log(`[welcomeFlowVoice] Bot desactivado para el chat ${chatId} o globalmente. Omitiendo transcripción y respuesta del bot.`);
            stop(ctx);
            return;
        }

        // Verificar si la IA está activa (si existe OPENAI_API_KEY)
        const { getOpenAI } = await import("~/apis/openai/openaiHelper");
        const openai = await getOpenAI();

        if (!openai) {
            console.log(`[welcomeFlowVoice] IA Desactivada (sin OPENAI_API_KEY). Omitiendo transcripción y respuesta del bot.`);
            return;
        }

        // Transcribir el audio antes de procesarlo
        const transcription = await transcribeAudioFile(`${localPath}`);

        if (!transcription) {
            console.warn(`[welcomeFlowVoice] ⚠️ No se pudo transcribir el audio de ${chatId}. Omitiendo respuesta del bot.`);
            stop(ctx);
            return;
        }

        console.log(`📝 Transcripción: ${transcription}`);
        ctx.body = transcription;

        // Guardar la transcripción en la base de datos como mensaje de texto para visibilidad en el Backoffice
        try {
            await HistoryHandler.saveMessage(
                chatId,
                'user',
                `🎤 Transcripción de audio: "${transcription}"`,
                'text',
                null,
                ctx.userId,
                null,
                ctx.platform || 'whatsapp',
                dynamicProjectId
            );
        } catch (dbErr) {
            console.error("❌ Error guardando transcripción en base de datos:", dbErr);
        }

        // Enviar la transcripción al asistente
        const queue = userQueues.get(userId);
        queue.push({ ctx, flowDynamic, state, provider, gotoFlow });

        if (!userLocks.get(userId) && queue.length === 1) {
            await handleQueue(userId);
        }

        // Nota: No eliminamos el archivo localmente para que el reproductor de audio del Backoffice pueda servirlo del disco.
    });
