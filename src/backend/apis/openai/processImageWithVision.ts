import { OpenAI } from "openai";
import { getOpenAIBaseUrl } from "./openaiHelper";

const DEFAULT_OCR_PROMPT = `ROL Y OBJETIVO
Actuá como un Agente de Visión (OCR) especializado en comprobantes de transferencias y pagos de Mercado Pago.
Tu única tarea es analizar la imagen del comprobante enviada por el usuario, extraer los datos clave y devolver EXCLUSIVAMENTE un objeto JSON estructurado. 

Este JSON será consumido por un backend automatizado para consultar la API de Mercado Pago y verificar la acreditación del dinero. No debes conversar, no debes emitir juicios sobre si el comprobante es falso, verdadero, viejo o nuevo, ni agregar texto fuera del JSON.

REGLAS ESTRICTAS DE EXTRACCIÓN
1. Fidelidad absoluta: Extraé los datos exactamente como aparecen. Si un dato no está visible, está cortado o borroso, asigná el valor null. NO inventes ni deduzcas información.
2. Número de Operación (Payment ID): Es el dato más crítico para la API. Buscalo bajo etiquetas como "Número de operación", "Comprobante N°", o códigos largos de más de 10 dígitos.
3. Monto: Extraé solo el valor numérico. Ignorá el signo "$" o "ARS". Usá punto para decimales (ej: 5000.00).
4. Regla de Tiempo y Fecha: Es OBLIGATORIO extraer la fecha y la hora exactas visibles en el comprobante. Debes normalizarla al formato ISO 8601 local (YYYY-MM-DDTHH:MM:SS) para que el backend calcule la validez temporal.
5. Cuentas: Extraé los CVU/CBU y CUIT/CUIL tanto del emisor como del receptor si están disponibles.

ESTRUCTURA JSON REQUERIDA
Debes devolver únicamente este JSON. NO uses formato markdown (\`\`\`json), NO uses comillas invertidas. Solo devuelve el texto plano del JSON:

{
  "estado_lectura": "EXITO", 
  "numero_operacion": "12345678901",
  "monto_numerico": 5000.00,
  "fecha_texto_original": "10 de julio de 2026 a las 14:30 hs",
  "fecha_normalizada": "2026-07-10T14:30:00",
  "emisor": {
    "nombre": "Juan Perez",
    "cuit_cuil": "20-12345678-9",
    "cvu_cbu": "0000003100012345678901"
  },
  "receptor": {
    "nombre": "Destinatario",
    "cuit_cuil": "30-12345678-9",
    "cvu_cbu": "0000003100098765432109"
  }
}`;

const DEFAULT_IMG_PROMPT = `Actuá como un asistente de visión experto.
Analizá la imagen o documento recibido de forma detallada y precisa.
- Extraé todo el texto visible, títulos, datos numéricos o tablas.
- Si se trata de un comprobante o documento de pago, identificá remitente, destinatario, monto, fecha y código de operación.
- Si es una foto de un producto, envase, etiqueta o falla técnica, describí el producto, modelo y detalles relevantes observados.
Devolvé un resumen claro, fiel y estructurado de la información observada para que el asistente operativo pueda atender al cliente.`;

export async function processImageWithVision(
  buffer: Buffer, 
  flowDynamic: any, 
  projectId?: string, 
  assistantKey: string = 'ASSISTANT_ID_IMG',
  silent: boolean = false,
  serviceId?: string
): Promise<string> {
  const { HistoryHandler } = await import("../../db/historyHandler");
  
  // 1. Obtener la clave de OpenAI exclusiva para imágenes
  const openaiKey = await HistoryHandler.getSetting('OPENAI_API_KEY_IMG', projectId, serviceId) 
    || await HistoryHandler.getConfig('OPENAI_API_KEY_IMG', projectId, serviceId);
  
  if (!openaiKey || openaiKey.includes('*****') || openaiKey === 'tu_api_key_aqui' || openaiKey.trim() === '') {
    console.log(`[processImageWithVision] ℹ️ OPENAI_API_KEY_IMG no configurada para servicio ${serviceId || 'default'}. Procesamiento de imagen omitido.`);
    return "";
  }

  // 2. Determinar el prompt correspondiente según el tipo de análisis (OCR vs Visión General)
  let systemPrompt: string = DEFAULT_IMG_PROMPT;
  if (assistantKey === 'ASSISTANT_ID_MP_OCR') {
    systemPrompt = (await HistoryHandler.getSetting('ASSISTANT_PROMPT_MP_OCR', projectId, serviceId) 
      || await HistoryHandler.getConfig('ASSISTANT_PROMPT_MP_OCR', projectId, serviceId)) 
      || DEFAULT_OCR_PROMPT;
  } else {
    systemPrompt = (await HistoryHandler.getSetting('ASSISTANT_PROMPT_IMG', projectId, serviceId) 
      || await HistoryHandler.getConfig('ASSISTANT_PROMPT_IMG', projectId, serviceId)) 
      || DEFAULT_IMG_PROMPT;
  }

  // 3. Obtener el modelo configurado o fallback a gpt-5.4-mini
  const model = await HistoryHandler.getConfig('OPENAI_MODEL', projectId, serviceId) || "gpt-5.4-mini";

  const baseURL = getOpenAIBaseUrl();
  const openai = new OpenAI({ 
      apiKey: openaiKey,
      ...(baseURL ? { baseURL } : {})
  });

  try {
    const base64Image = buffer.toString("base64");
    console.log(`👁️ [Vision] Procesando imagen con Chat Completions (Model: ${model}, Key: ${assistantKey}, Length: ${buffer.length} bytes)...`);

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 1500,
      temperature: 0.2
    });

    const result = completion.choices[0]?.message?.content?.trim() || "";
    console.log(`👁️ [Vision] Análisis completado con éxito (${result.length} caracteres).`);

    if (!silent && flowDynamic && result) {
      await flowDynamic(result);
    }
    return result;

  } catch (error: any) {
    console.error("❌ [Vision] Error procesando imagen con OpenAI:", error.message);
    return "";
  }
}