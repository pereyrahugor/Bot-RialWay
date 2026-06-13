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
    const { getOpenAIVision } = await import("../../apis/openai/openaiHelper");
    const openai = await getOpenAIVision();
    if (!openai) {
      console.warn("⚠️ IA Vision Desactivada: Saltando análisis de imagen en flujo.");
      const caption = ctx.body && !ctx.body.includes('_event_') ? ctx.body : '';
      ctx.body = `[Imagen recibida (Sin procesar para IA)]${caption ? ': ' + caption : ''}`;
      // Continuar al flujo de texto para no romper la experiencia
      return gotoFlow(welcomeFlowTxt);
    }
    const userId = ctx.from;

    // Verificar si es una imagen (y no un video)
    const mimetype = ctx?.media?.mimetype || ctx?.message?.imageMessage?.mimetype || "";
    if (mimetype.includes('video')) {
        return gotoFlow(welcomeFlowVideo);
    }

    // Filtrar contactos ignorados antes de agregar a la cola
    if (
      /@broadcast$/.test(userId) ||
      /@newsletter$/.test(userId) ||
      /@channel$/.test(userId)
    ) {
      console.log(`Mensaje de imagen ignorado por filtro de contacto: ${userId}`);
      return;
    }

    // --- FILTRO DE ECO / MENSAJES PROPIOS ---
    if (ctx.key?.fromMe) {
        return;
    }

    const { HistoryHandler } = await import("../../db/historyHandler");

    const timeoutCierreValue = await HistoryHandler.getConfig('timeOutCierre') || 45;
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
        await flowDynamic("No se encontró el provider para descargar la imagen.");
        return;
      }
      
      // Asegurar que la carpeta tmp exista
      if (!fs.default.existsSync("./tmp/")) {
        fs.default.mkdirSync("./tmp/", { recursive: true });
      }
      
      // Usar ./tmp/ para consistencia
      const localPath = await provider.saveFile(ctx, { path: "./tmp/" });
      if (!localPath) {
        await flowDynamic("No se pudo guardar la imagen recibida.");
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
      
      console.log("Analizando imagen con GPT-4o...");
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe esta imagen detalladamente para que el asistente pueda entender su contenido y responder al usuario." },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` },
              },
            ],
          },
        ],
      });

      const result = response.choices[0].message.content || "No se pudo obtener una descripción de la imagen.";

      // Enviar el mensaje al asistente principal para que lo procese y mantenga el contexto
      const caption = ctx.body && !ctx.body.includes('_event_') ? ctx.body : '';
      ctx.body = `[Imagen recibida]${caption ? ': ' + caption : ''}. (Análisis): ${result}`;

      // Guardar el análisis en la base de datos para que el asistente tenga el historial en siguientes turnos
      try {
        const botPhoneNumber = provider?.globalVendorArgs?.phone_number_id || (ctx.to ? ctx.to.replace(/\D/g, '') : null);
        const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(botPhoneNumber) || HistoryHandler.PROJECT_IDENTIFIER;
        
        await HistoryHandler.saveMessage(
          userId,
          'user',
          `📷 Análisis de imagen: "${result}"`,
          'text',
          null,
          ctx.userId,
          null,
          ctx.platform || 'whatsapp',
          dynamicProjectId
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
    } catch (err) {
      console.error("Error procesando imagen:", err);
      await flowDynamic("Ocurrió un error al analizar la imagen. Intenta más tarde.");
    }
  }
);

export { welcomeFlowImg };
