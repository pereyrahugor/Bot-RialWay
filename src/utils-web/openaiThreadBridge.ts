import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Obtiene o crea un thread_id para el usuario webchat
 * @param store objeto de sesión por IP
 * @returns thread_id
 */
export async function getOrCreateThreadId(store: { thread_id?: string | null }) {
  if (store.thread_id) return store.thread_id;
  const thread = await openai.beta.threads.create();
  store.thread_id = thread.id;
  return thread.id;
}

/**
 * Envía un mensaje al thread y ejecuta el run
 * @param threadId string
 * @param userMessage string
 * @param assistantId string
 * @returns respuesta del asistente
 */
export async function sendMessageToThread(threadId: string, userMessage: string, assistantId: string) {
  // CRÍTICO: Esperar a que no haya runs activos antes de enviar mensaje
  try {
    console.log(`[sendMessageToThread] Verificando runs activos en thread ${threadId}...`);
    let attempt = 0;
    while (attempt < 30) { // Max 60 seconds wait
      const runs = await openai.beta.threads.runs.list(threadId, { limit: 1 });
      const activeRun = runs.data.find(run => 
        ["queued", "in_progress", "cancelling"].includes(run.status)
      );
      
      if (activeRun) {
        if (attempt % 5 === 0) console.log(`[sendMessageToThread] Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempt++;
      } else {
        console.log(`[sendMessageToThread] No hay runs activos. Procediendo.`);
        break;
      }
    }
    if (attempt >= 30) {
      console.warn(`[sendMessageToThread] Timeout esperando liberación del thread. Intentando proceder de todos modos.`);
    }
  } catch (error) {
    console.error(`[sendMessageToThread] Error verificando runs:`, error);
    // Fallback to simple wait if API fails
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  await openai.beta.threads.messages.create(
    threadId,
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
    }
  );
  const run = await openai.beta.threads.runs.create(
    threadId,
    { assistant_id: assistantId }
  );
  // Esperar la finalización del run
  let runStatus = run.status;
  const runId = run.id;
  while (runStatus !== 'completed') {
    await new Promise(res => setTimeout(res, 1000));
    const runInfo = await openai.beta.threads.runs.retrieve(threadId, runId);
    runStatus = runInfo.status;
    if (runStatus === 'failed' || runStatus === 'cancelled') {
      throw new Error('Run fallido o cancelado');
    }
  }
  // Obtener el último mensaje del asistente (más reciente)
  const messages = await openai.beta.threads.messages.list(threadId);
  const assistantMessages = messages.data.filter(m => m.role === 'assistant');
  if (!assistantMessages.length) return '';
  const lastMsg = assistantMessages[0]; // El primero es el más reciente
  const textBlock = lastMsg.content.find(block => block.type === 'text' && typeof (block as any).text?.value === 'string');
  if (textBlock && textBlock.type === 'text') {
    return (textBlock as { type: 'text'; text: { value: string } }).text.value;
  }
  return lastMsg.content.length ? JSON.stringify(lastMsg.content[0]) : '';
}

/**
 * Elimina el thread y limpia el thread_id
 */
export async function deleteThread(store: { thread_id?: string | null }) {
  // No existe un método delete para threads en la API de OpenAI.
  // Simplemente limpia el thread_id en el store.
  if (store.thread_id) {
    store.thread_id = null;
  }
}
