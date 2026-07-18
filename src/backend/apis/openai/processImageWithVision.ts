import axios from "axios";
import { OpenAI } from "openai";
import fs from "fs";
import { getOpenAIBaseUrl } from "./openaiHelper";

const IMGUR_CLIENT_ID = "dbe415c6bbb950d";

export async function processImageWithVision(
  buffer: Buffer, 
  flowDynamic: any, 
  projectId?: string, 
  assistantKey: string = 'ASSISTANT_ID_IMG',
  silent: boolean = false
): Promise<string> {
  const { HistoryHandler } = await import("../../db/historyHandler");
  
  // 1. Obtener la clave de imagen de la base de datos (u obtener el fallback principal si no hay)
  const openaiKey = await HistoryHandler.getSetting('OPENAI_API_KEY_IMG', projectId) || await HistoryHandler.getConfig('OPENAI_API_KEY_IMG') || await HistoryHandler.getConfig('OPENAI_API_KEY');
  
  if (!openaiKey || openaiKey.includes('*****') || openaiKey.trim() === '') {
    console.warn("⚠️ OPENAI_API_KEY_IMG no detectada. Procesamiento de imágenes desactivado.");
    if (!silent) {
      await flowDynamic("Lo siento, el análisis de imágenes no está configurado en este momento.");
    }
    return "";
  }

  // 2. Obtener el Assistant ID de la base de datos según la clave
  const assistantId = await HistoryHandler.getSetting(assistantKey, projectId) || await HistoryHandler.getConfig(assistantKey);
  if (!assistantId) {
    if (!silent) {
      await flowDynamic(`No se encontró el ${assistantKey} en la base de datos.`);
    }
    return "";
  }

  // 3. Obtener el prompt (instrucciones) específico para sobreescribir si está en la base de datos
  let promptOverride: string | undefined = undefined;
  if (assistantKey === 'ASSISTANT_ID_MP_OCR') {
    promptOverride = await HistoryHandler.getSetting('ASSISTANT_PROMPT_MP_OCR', projectId) 
      || await HistoryHandler.getConfig('ASSISTANT_PROMPT_MP_OCR');
  }

  const baseURL = getOpenAIBaseUrl();
  const openai = new OpenAI({ 
      apiKey: openaiKey,
      ...(baseURL ? { baseURL } : {})
  });

  // Subir imagen a Imgur
  const imgurRes = await axios.post(
    "https://api.imgur.com/3/image",
    {
      image: buffer.toString("base64"),
      type: "base64",
    },
    {
      headers: {
        Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
      },
    }
  );
  const imgUrl = imgurRes.data.data.link;

  // Crear un thread solo con la imagen
  const thread = await openai.beta.threads.create({
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imgUrl } },
        ],
      },
    ],
  });

  // Ejecutar el asistente sobre el thread
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
    ...(promptOverride ? { instructions: promptOverride } : {})
  });

  // Esperar a que termine el procesamiento
  let runStatus;
  do {
    await new Promise((res) => setTimeout(res, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  } while (runStatus.status !== "completed" && runStatus.status !== "failed");

  if (runStatus.status === "failed") {
    if (!silent) {
      await flowDynamic("El asistente falló al procesar la imagen.");
    }
    return "";
  }

  // Obtener el mensaje de respuesta
  const messages = await openai.beta.threads.messages.list(thread.id);
  const resultMsg = messages.data.find((msg) => msg.role === "assistant");
  let result = "No se obtuvo respuesta del asistente.";
  if (resultMsg && Array.isArray(resultMsg.content)) {
    const textBlock = resultMsg.content.find(
      (block: any) => block.type === "text" && typeof (block as any).text?.value === "string"
    );
    if (textBlock && (textBlock as any).text && typeof (textBlock as any).text.value === "string") {
      result = (textBlock as any).text.value;
    }
  }
  if (!silent) {
    await flowDynamic(result);
  }
  return result;
}