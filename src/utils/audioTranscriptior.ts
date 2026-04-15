import { createReadStream } from "fs";
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
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-1",
      language: "es", // Forzar transcripción en español
    });
    

    if (transcription && transcription.text) {
      return transcription.text;
    }

    return transcription.text;
  } catch (error) {
    console.error("❌ Error en la transcripción:", error);
    return null;
  }
};
