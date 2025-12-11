// src/utils/AssistantResponseProcessor.ts
// Ajustar fecha/hora a GMT-3 (hora argentina)
function toArgentinaTime(fechaReservaStr: string): string {
    const [fecha, hora] = fechaReservaStr.split(' ');
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [hh, min] = hora.split(':').map(Number);
    const date = new Date(Date.UTC(anio, mes - 1, dia, hh, min));
    date.setHours(date.getHours() - 3);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hhh = String(date.getHours()).padStart(2, '0');
    const mmm = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hhh}:${mmm}`;
}
import { executeDbQuery } from '../utils/dbHandler';
import { JsonBlockFinder } from "../Api-Google/JsonBlockFinder";
import { CalendarEvents } from "../Api-Google/calendarEvents";
import fs from 'fs';
import moment from 'moment';
import OpenAI from "openai";
//import { handleToolFunctionCall } from '../Api-BotAsistente/handleToolFunctionCall.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function waitForActiveRuns(threadId: string) {
    if (!threadId) return;
    try {
        console.log(`[AssistantResponseProcessor] Verificando runs activos en thread ${threadId}...`);
        let attempt = 0;
        while (attempt < 30) { // Max 60 seconds wait
            const runs = await openai.beta.threads.runs.list(threadId, { limit: 1 });
            const activeRun = runs.data.find(run => 
                ["queued", "in_progress", "cancelling"].includes(run.status)
            );
            
            if (activeRun) {
                if (attempt % 5 === 0) console.log(`[AssistantResponseProcessor] Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempt++;
            } else {
                console.log(`[AssistantResponseProcessor] No hay runs activos. Procediendo.`);
                return;
            }
        }
        console.warn(`[AssistantResponseProcessor] Timeout esperando liberación del thread ${threadId}. Intentando proceder de todos modos.`);
    } catch (error) {
        console.error(`[AssistantResponseProcessor] Error verificando runs:`, error);
        // Fallback to simple wait if API fails
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// Mapa global para bloquear usuarios de WhatsApp durante operaciones API
const userApiBlockMap = new Map();
const API_BLOCK_TIMEOUT_MS = 1000; // 5 segundos

function limpiarBloquesJSON(texto: string): string {
    let limpio = texto.replace(/\[API\][\s\S]*?\[\/API\]/g, "");
    // Eliminar referencias de OpenAI tipo 【4:0†archivo.pdf】 o variantes
    limpio = limpio.replace(/【.*?】/g, "");
    return limpio;
}

function corregirFechaAnioVigente(fechaReservaStr: string): string {
function toArgentinaTime(fechaReservaStr: string): string {
    // Recibe 'YYYY-MM-DD HH:mm' y ajusta a GMT-3
    const [fecha, hora] = fechaReservaStr.split(' ');
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [hh, min] = hora.split(':').map(Number);
    // Construir fecha en UTC y restar 3 horas
    const date = new Date(Date.UTC(anio, mes - 1, dia, hh, min));
    date.setHours(date.getHours() - 3);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hhh = String(date.getHours()).padStart(2, '0');
    const mmm = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hhh}:${mmm}`;
}
    const ahora = new Date();
    const vigente = ahora.getFullYear();
    const [fecha, hora] = fechaReservaStr.split(" ");
    const [anioRaw, mes, dia] = fecha.split("-").map(Number);
    let anio = anioRaw;
    if (anio < vigente) anio = vigente;
    return `${anio.toString().padStart(4, "0")}-${mes.toString().padStart(2, "0")}-${dia.toString().padStart(2, "0")} ${hora}`;
}

function esFechaFutura(fechaReservaStr: string): boolean {
    const ahora = new Date();
    const fechaReserva = new Date(fechaReservaStr.replace(" ", "T"));
    return fechaReserva >= ahora;
}

export class AssistantResponseProcessor {
    static async analizarYProcesarRespuestaAsistente(
        response: any,
        ctx: any,
                                                                                                                                                                                         flowDynamic: any,
        state: any,
        provider: any,
        gotoFlow: any,
        getAssistantResponse: Function,
        ASSISTANT_ID: string
    ) {
        // Soporte para tool/function call genérico
        // if (response && typeof response === 'object' && response.tool_call) {
        //     // Espera que response.tool_call tenga { name, parameters }
        //     const toolResponse = handleToolFunctionCall(response.tool_call);
        //     // Enviar la respuesta al asistente (como tool response)
        //     await flowDynamic([{ body: JSON.stringify(toolResponse, null, 2) }]);
        //     return;
        // }
        // Log de mensaje entrante del asistente (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            // console.log('[Webchat Debug] Mensaje entrante del asistente:', response);
        } else {
            // console.log('[WhatsApp Debug] Mensaje entrante del asistente:', response);
            // Si el usuario está bloqueado por una operación API, evitar procesar nuevos mensajes
            if (userApiBlockMap.has(ctx.from)) {
                console.log(`[API Block] Mensaje ignorado de usuario bloqueado: ${ctx.from}`);
                return;
            }
        }
        let jsonData: any = null;
        const textResponse = typeof response === "string" ? response : String(response || "");

        // Log de mensaje saliente al usuario (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            // console.log('[Webchat Debug] Mensaje saliente al usuario (sin filtrar):', textResponse);
        } else {
            // console.log('[WhatsApp Debug] Mensaje saliente al usuario (sin filtrar):', textResponse);
        }
        // 0) Detectar y procesar DB QUERY [DB_QUERY: ...]
        const dbQueryRegex = /\[DB_QUERY\s*:\s*([\s\S]*?)\]/i;
        const dbMatch = textResponse.match(dbQueryRegex);
        if (dbMatch) {
            const sqlQuery = dbMatch[1].trim();
            if (ctx && ctx.type === 'webchat') console.log(`[Webchat Debug] 🔄 Detectada solicitud de DB Query: ${sqlQuery}`);
            else console.log(`[WhatsApp Debug] 🔄 Detectada solicitud de DB Query: ${sqlQuery}`);
            
            // Ejecutar Query
            const queryResult = await executeDbQuery(sqlQuery);
            console.log(`[AssistantResponseProcessor] 📝 Resultado DB RAW:`, queryResult.substring(0, 500) + (queryResult.length > 500 ? "..." : "")); // Loguear primeros 500 chars
            const feedbackMsg = `[SYSTEM_DB_RESULT]: ${queryResult}`;
            
            // console.log(`[AssistantResponseProcessor] 📤 Enviando resultado DB al asistente...`);

            // Esperar a que el Run anterior haya finalizado realmente en OpenAI
            const threadId = (ctx && ctx.thread_id) || (state && typeof state.get === 'function' && state.get('thread_id'));
            if (threadId) {
                await waitForActiveRuns(threadId);
            } else {
                 // Fallback si no tenemos threadId
                 await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Obtener nueva respuesta del asistente
            let newResponse: any;
            try {
                 newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado DB.", ctx ? ctx.from : null, ctx && ctx.thread_id ? ctx.thread_id : null);
            } catch (err) {
                console.error("Error al obtener respuesta recursiva:", err);
                return;
            }
            
            // Recursión: procesar la nueva respuesta
            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID
            );
            return; // Terminar ejecución actual
        }

        // 1) Extraer bloque [API] ... [/API]
        const apiBlockRegex = /\[API\](.*?)\[\/API\]/is;
        const match = textResponse.match(apiBlockRegex);
        if (match) {
            const jsonStr = match[1].trim();
            console.log('[Debug] Bloque [API] detectado:', jsonStr);
            try {
                jsonData = JSON.parse(jsonStr);
            } catch (e) {
                jsonData = null;
                if (ctx && ctx.type === 'webchat') {
                    console.log('[Webchat Debug] Error al parsear bloque [API]:', jsonStr);
                }
            }
        }

        // 2) Fallback heurístico (desactivado, solo [API])
        // jsonData = null;
        if (!jsonData) {
            jsonData = JsonBlockFinder.buscarBloquesJSONEnTexto(textResponse) || (typeof response === "object" ? JsonBlockFinder.buscarBloquesJSONProfundo(response) : null);
            if (!jsonData && ctx && ctx.type === 'webchat') {
                console.log('[Webchat Debug] No JSON block detected in assistant response. Raw output:', textResponse);
            }
        }

        // 3) Procesar JSON si existe
        if (jsonData && typeof jsonData.type === "string") {
            // Si es WhatsApp, bloquear usuario por 20 segundos o hasta finalizar la operación API
            let unblockUser = null;
            if (ctx && ctx.type !== 'webchat' && ctx.from) {
                userApiBlockMap.set(ctx.from, true);
                // Desbloqueo automático tras timeout de seguridad
                const timeoutId = setTimeout(() => {
                    userApiBlockMap.delete(ctx.from);
                }, API_BLOCK_TIMEOUT_MS);
                unblockUser = () => {
                    clearTimeout(timeoutId);
                    userApiBlockMap.delete(ctx.from);
                };
            }
            // Log para detectar canal y datos antes de enviar
            if (ctx && ctx.type !== 'webchat') {
                console.log('[WhatsApp Debug] Antes de enviar con flowDynamic:', jsonData, ctx.from);
            }
            const tipo = jsonData.type.trim();

            if (tipo === "create_event") {
                // 1. Extraer datos necesarios del jsonData
                const { fecha, hora, titulo, descripcion, invitados } = jsonData;
                // 2. Llamar a la API para crear el evento
                let apiResponse;
                try {
                    apiResponse = await CalendarEvents.createEvent({
                        fecha,
                        hora,
                        titulo,
                        descripcion,
                        invitados
                    });
                } catch (err) {
                    apiResponse = { error: "Error al crear el evento: " + err.message };
                }
                // 3. Enviar la respuesta al asistente
                await flowDynamic([{ body: JSON.stringify(apiResponse, null, 2) }]);
                if (unblockUser) unblockUser();
                return;
            }

            if (tipo === "available_event") {
                // 1. Extraer datos necesarios del jsonData
                const { fecha, hora } = jsonData;
                // 2. Llamar a la API para consultar disponibilidad
                let apiResponse;
                try {
                    // Construir start y end en formato ISO
                    const start = `${fecha}T${hora}:00-03:00`;
                    // Suponiendo duración de 1 hora para el evento
                    const startMoment = moment(start);
                    const endMoment = startMoment.clone().add(1, 'hour');
                    const end = endMoment.format('YYYY-MM-DDTHH:mm:ssZ');
                    apiResponse = await CalendarEvents.checkAvailability(start, end);
                } catch (err) {
                    apiResponse = { error: "Error al consultar disponibilidad: " + err.message };
                }
                // 3. Enviar la respuesta al asistente
                await flowDynamic([{ body: JSON.stringify(apiResponse, null, 2) }]);
                if (unblockUser) unblockUser();
                return;
            }

            if (tipo === "modify_event") {
                // 1. Extraer datos necesarios del jsonData
                const { id, fecha, hora, titulo, descripcion } = jsonData;
                // 2. Llamar a la API para modificar el evento
                let apiResponse;
                try {
                    apiResponse = await CalendarEvents.updateEvent(
                        id,
                        { fecha, hora, titulo, descripcion }
                    );
                } catch (err) {
                    apiResponse = { error: "Error al modificar el evento: " + err.message };
                }
                // 3. Enviar la respuesta al asistente
                await flowDynamic([{ body: JSON.stringify(apiResponse, null, 2) }]);
                if (unblockUser) unblockUser();
                return;
            }

            if (tipo === "cancel_event") {
                // 1. Extraer datos necesarios del jsonData
                const { id } = jsonData;
                // 2. Llamar a la API para cancelar el evento
                let apiResponse;
                try {
                    apiResponse = await CalendarEvents.deleteEvent(id);
                } catch (err) {
                    apiResponse = { error: "Error al cancelar el evento: " + err.message };
                }
                // 3. Enviar la respuesta al asistente
                await flowDynamic([{ body: JSON.stringify(apiResponse, null, 2) }]);
                if (unblockUser) unblockUser();
                return;
            }
        }

        // Si no hubo bloque JSON válido, enviar el texto limpio
    const cleanTextResponse = limpiarBloquesJSON(textResponse).trim();
        // Lógica especial para reserva: espera y reintento
        if (cleanTextResponse.includes('Voy a proceder a realizar la reserva.')) {
            // Espera 30 segundos y responde ok al asistente
            await new Promise(res => setTimeout(res, 30000));
            let assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, ctx.from);
            // Si la respuesta contiene (ID: ...), no la envíes al usuario, espera 10s y vuelve a enviar ok
            while (assistantApiResponse && /(ID:\s*\w+)/.test(assistantApiResponse)) {
                console.log('[Debug] Respuesta contiene ID de reserva, esperando 10s y reenviando ok...');
                await new Promise(res => setTimeout(res, 10000));
                assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, ctx.from);
            }
            // Cuando la respuesta no contiene el ID, envíala al usuario
            if (assistantApiResponse) {
                try {
                    await flowDynamic([{ body: limpiarBloquesJSON(String(assistantApiResponse)).trim() }]);
                    if (ctx && ctx.type !== 'webchat') {
                        // console.log('[WhatsApp Debug] flowDynamic ejecutado correctamente');
                    }
                } catch (err) {
                    console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                }
            }
        } else if (cleanTextResponse.length > 0) {
            const chunks = cleanTextResponse.split(/\n\n+/);
            for (const chunk of chunks) {
                if (chunk.trim().length > 0) {
                    try {
                        await flowDynamic([{ body: chunk.trim() }]);
                        // Pequeña pausa para evitar que WhatsApp ignore mensajes muy rápidos
                        await new Promise(r => setTimeout(r, 600)); 
                        if (ctx && ctx.type !== 'webchat') {
                            // console.log('[WhatsApp Debug] flowDynamic ejecutado correctamente');
                        }
                    } catch (err) {
                        console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                    }
                }
            }
        }
    }
}

