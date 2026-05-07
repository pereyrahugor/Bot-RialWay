import { createReadStream, renameSync, existsSync } from "fs";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
}) : null;

/**
 * Transcribe an audio file using the OpenAI Whisper model.
 * @param filePath - Local path to the audio file.
 * @returns The transcription of the audio.
 */
export const transcribeAudioFile = async (filePath: string): Promise<string | null> => {
  if (!openai) {
    console.warn("⚠️ IA Desactivada: No se puede transcribir audio sin OPENAI_API_KEY.");
    return null;
  }
  let finalPath = filePath;
  try {
    console.log(`[AudioTranscriptor] Procesando archivo: ${filePath}`);
    
    // OpenAI Whisper requiere una extensión válida. Asegurar que tenga .ogg si no la tiene.
    const extension = filePath.split('.').pop()?.toLowerCase();
    const validExtensions = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'];
    
    if (!extension || !validExtensions.includes(extension)) {
      finalPath = `${filePath}.ogg`;
      renameSync(filePath, finalPath);
      console.log(`[AudioTranscriptor] Renombrado a: ${finalPath}`);
    }

    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(finalPath),
      model: "whisper-1",
      language: "es", // Forzar transcripción en español
    });
    
    // Si se renombró, restauramos el nombre original para que el flujo lo pueda borrar correctamente
    if (finalPath !== filePath) {
       renameSync(finalPath, filePath);
    }

    if (transcription && transcription.text) {
      return transcription.text;
    }

    return transcription.text || null;
  } catch (error: any) {
    console.error("❌ Error en la transcripción:", error?.response?.data || error.message || error);
    // Intentar restaurar si falló
    if (finalPath !== filePath && existsSync(finalPath)) {
         renameSync(finalPath, filePath);
    }
    return null;
  }
};
