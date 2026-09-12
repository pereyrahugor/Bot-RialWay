// import { addKeyword, EVENTS } from "@builderbot/bot";
// import { ErrorReporter } from "../errorReporter";

// const welcomeFlowImg = addKeyword(EVENTS.MEDIA).addAnswer(
//   "Por un problema no puedo ver imágenes, me podrás escribir de que trata la imagen? Gracias ",
//   { capture: false },
//   async (ctx) => {
//     if (!ctx?.media?.buffer || ctx.media.buffer.length === 0) {
//       console.error("No se recibió buffer de imagen válido.");
//       return;
//     }
//     console.log("Imagen recibida:", ctx);
//     await new ErrorReporter(ctx.provider, ctx.groupId);
//   }
// );

// export { welcomeFlowImg };

import { addKeyword, EVENTS } from "@builderbot/bot";
import { ErrorReporter } from "../errorReporter";

import { welcomeFlowTxt } from "./welcomeFlowTxt";
import { welcomeFlowVideo } from "./welcomeFlowVideo";
import { OpenAI } from "openai";
import { reset } from "../timeOut";
import { userQueues, userLocks, handleQueue } from "../queueManager";

// El timeout se calcula dinámicamente dentro de la acción

const welcomeFlowImg = addKeyword(EVENTS.MEDIA).addAction(
  async (ctx, { flowDynamic, provider, gotoFlow, state }) => {
    const userId = ctx.from;

    // --- FILTRO DE ECO / MENSAJES PROPIOS ---
    if (ctx.key?.fromMe) {
        return;
    }

    // Filtrar contactos ignorados (difusión, newsletters, canales)
    if (
      /@broadcast$/.test(userId) ||
      /@newsletter$/.test(userId) ||
      /@channel$/.test(userId)
    ) {
      console.log(`Mensaje de imagen ignorado por filtro de contacto: ${userId}`);
      return;
    }

    // Verificar si es una imagen (y no un video)
    const mimetype = ctx?.media?.mimetype || ctx?.message?.imageMessage?.mimetype || "";
    if (mimetype.includes('video')) {
        return gotoFlow(welcomeFlowVideo);
    }

    const { HistoryHandler } = await import("../../db/historyHandler");
    const botPhoneNumber = ctx.recipientPhoneId || provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
    const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || HistoryHandler.PROJECT_IDENTIFIER;
    const dynamicServiceId = await HistoryHandler.getServiceIdByRecipient(botPhoneNumber) || HistoryHandler.SERVICE_IDENTIFIER;

    // --- FILTRO DE LISTA NEGRA TEMPRANO ---
    const isBlocked = await HistoryHandler.isContactBlacklisted(userId, dynamicProjectId, dynamicServiceId);
    if (isBlocked) {
      console.log(`[welcomeFlowImg] ⛔ Contacto ${userId} en LISTA NEGRA. Omitiendo procesamiento.`);
      return;
    }

    // --- VERIFICAR ESTADO DEL BOT (MODO CRM / BOT DESACTIVADO) ---
    const isGlobalBotEnabledSetting = await HistoryHandler.getSetting('GLOBAL_BOT_ENABLED', dynamicProjectId, dynamicServiceId);
    const isGlobalBotEnabled = isGlobalBotEnabledSetting !== 'false';
    const isBotActiveForUser = await HistoryHandler.isBotEnabled(userId, dynamicProjectId, dynamicServiceId);
    const assistantId = await HistoryHandler.getConfig('ASSISTANT_1', dynamicProjectId, dynamicServiceId)
        || await HistoryHandler.getConfig('ASSISTANT_ID', dynamicProjectId, dynamicServiceId);

    if (!isGlobalBotEnabled || !isBotActiveForUser || !assistantId) {
      console.log(`[welcomeFlowImg] ℹ️ Bot desactivado para ${userId} en servicio ${dynamicServiceId} (Modo CRM / Operador humano). Omitiendo análisis de imagen.`);
      return;
    }

    // --- VERIFICAR SI EXISTE API KEY DE IMAGEN CONFIGURADA ---
    const { getOpenAIVision } = await import("../../apis/openai/openaiHelper");
    const openai = await getOpenAIVision(dynamicProjectId, dynamicServiceId);
    if (!openai) {
      console.log(`[welcomeFlowImg] ℹ️ Servicio ${dynamicServiceId} sin OPENAI_API_KEY_IMG. No se analiza la imagen.`);
      const caption = (ctx.body && !ctx.body.includes('_event_')) ? ctx.body : (ctx.payload?.message?.imageMessage?.caption || ctx.payload?.image?.caption || '');
      if (caption && caption.trim()) {
        console.log(`[welcomeFlowImg] 📝 Reenviando subtítulo al flujo de texto para ${userId}: "${caption.trim()}"`);
        ctx.body = caption.trim();
        return gotoFlow(welcomeFlowTxt);
      }
      return; // Sin clave de imagen y sin subtítulo de texto: retorno silencioso
    }

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

    // Procesar la imagen y responder directamente al usuario
    const fs = await import('fs');
    try {
      if (!provider) {
        console.warn("[welcomeFlowImg] No se encontró el provider para descargar la imagen.");
        return;
      }
      
      // Asegurar que la carpeta tmp exista
      if (!fs.default.existsSync("./tmp/")) {
        fs.default.mkdirSync("./tmp/", { recursive: true });
      }
      
      // Usar ./tmp/ para consistencia
      const localPath = await provider.saveFile(ctx, { path: "./tmp/" });
      if (!localPath) {
        console.warn(`[welcomeFlowImg] No se pudo guardar la imagen recibida de ${userId}`);
        return;
      }

      // Eliminar imagen anterior si existe para no acumular archivos
      const oldImage = state.get('lastImage');
      if (oldImage && typeof oldImage === 'string' && fs.default.existsSync(oldImage)) {
        try {
          fs.default.unlinkSync(oldImage);
          console.log(`🗑️ Imagen anterior eliminada: ${oldImage}`);
        } catch (e) {
          console.error(`❌ Error eliminando imagen anterior: ${oldImage}`, e);
        }
      }

      await state.update({ lastImage: localPath });
      const buffer = fs.default.readFileSync(localPath);

      // 1. Intentar validar la imagen como comprobante de Mercado Pago (si está habilitado)
      const isOcrEnabled = await HistoryHandler.getSetting('MERCADOPAGO_OCR_ENABLED', dynamicProjectId, dynamicServiceId)
          || await HistoryHandler.getConfig('MERCADOPAGO_OCR_ENABLED', dynamicProjectId, dynamicServiceId);

      if (isOcrEnabled === 'true') {
          const { verifyReceiptFlow } = await import("../../utils/receiptVerifierMP");
          const processed = await verifyReceiptFlow(buffer, flowDynamic, dynamicProjectId, userId, state, dynamicServiceId);
          
          if (processed) {
              return; // Manejado exitosamente por la verificación estricta de Mercado Pago
          } else {
              await flowDynamic("⚠️ No se pudo validar la transferencia en la API de Mercado Pago. Por favor, verifica que el comprobante sea correcto e intenta nuevamente.");
              return; // Detener flujo para evitar recargas sin verificación real por API
          }
      }

      // Cargar prompt dinámico de imagen de la base de datos
      const customPrompt = await HistoryHandler.getSetting('ASSISTANT_PROMPT_IMG', dynamicProjectId, dynamicServiceId)
          || await HistoryHandler.getConfig('ASSISTANT_PROMPT_IMG', dynamicProjectId, dynamicServiceId);
      const visionPrompt = (customPrompt && typeof customPrompt === 'string' && customPrompt.trim())
          ? customPrompt.trim()
          : "Describe esta imagen detalladamente para que el asistente pueda entender su contenido y responder al usuario.";

      // Cargar modelo dinámico de la base de datos para análisis convencional (default gpt-5.4-mini)
      let visionModel = await HistoryHandler.getConfig('OPENAI_MODEL', dynamicProjectId, dynamicServiceId) || "gpt-5.4-mini";
      // Si el modelo es de razonamiento (o1, o3, etc.) sin visión estándar, fallback
      if (visionModel.startsWith('o1') || visionModel.startsWith('o3')) {
        visionModel = "gpt-5.4-mini";
      }

      console.log(`[welcomeFlowImg] Analizando imagen con modelo: ${visionModel} y prompt (${visionPrompt.length} chars)...`);
      let response: any;
      try {
        response = await openai.chat.completions.create({
          model: visionModel,
          messages: [
            { role: "system", content: visionPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}`, detail: "high" },
                },
              ],
            },
          ],
        });
      } catch (apiErr: any) {
        console.warn(`[welcomeFlowImg] ⚠️ Error en análisis de visión con OpenAI: ${apiErr?.message}`);
        return; // Retorno silencioso sin alertar error al cliente
      }

      const result = response?.choices?.[0]?.message?.content || "No se pudo obtener una descripción de la imagen.";

      // Enviar el mensaje al asistente principal para que lo procese y mantenga el contexto
      const caption = (ctx.body && !ctx.body.includes('_event_')) ? ctx.body : (ctx.payload?.message?.imageMessage?.caption || ctx.payload?.image?.caption || '');
      ctx.body = `[Imagen recibida]${caption ? ': ' + caption : ''}. (Análisis): ${result}`;

      // Guardar el análisis en la base de datos para que el asistente tenga el historial en siguientes turnos
      try {
        await HistoryHandler.saveMessage(
          userId,
          'user',
          `📷 Análisis de imagen: "${result}"`,
          'text',
          null,
          ctx.userId,
          null,
          ctx.platform || 'whatsapp',
          dynamicProjectId,
          dynamicServiceId
        );
      } catch (dbErr) {
        console.error("❌ Error guardando análisis de imagen en base de datos:", dbErr);
      }

      // Reencolar el mensaje para que lo procese el flujo principal (texto)
      if (!userQueues.has(userId)) {
        userQueues.set(userId, []);
      }
      userQueues.get(userId).push({ ctx, flowDynamic, state, provider, gotoFlow });
      
      if (!userLocks.get(userId) && userQueues.get(userId).length === 1) {
        await handleQueue(userId);
      }

      console.log(`💾 Imagen guardada para resumen: ${localPath}`);
    } catch (err: any) {
      console.error("❌ [welcomeFlowImg] Error procesando imagen:", err?.message || err);
      // Silencioso para el usuario final: no enviar "Ocurrió un error al analizar la imagen..."
    }
  }
);

export { welcomeFlowImg };
