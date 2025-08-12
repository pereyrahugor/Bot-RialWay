import { ASSISTANT_ID } from '../app';
import { toAsk } from '@builderbot-plugins/openai-assistants';

// Estado mínimo para cumplir con BotStateStandAlone
const minimalState = {
  update: async () => {},
  getMyState: () => ({}),
  get: () => undefined,
  clear: async () => {},
};

// Versión simplificada para webchat
export async function processUserMessageWeb(msg: string): Promise<string> {
  if (!msg || msg.trim() === "") return "Por favor, escribe un mensaje.";
  try {
    const response = await toAsk(ASSISTANT_ID, msg, minimalState);
    return typeof response === 'string' ? response : String(response);
  } catch (error) {
    console.error('Error en el asistente:', error);
    return 'Hubo un error procesando tu mensaje.';
  }
}