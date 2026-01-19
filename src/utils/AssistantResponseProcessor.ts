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

export async function waitForActiveRuns(threadId: string) {
    if (!threadId) return;
    try {
        console.log(`[AssistantResponseProcessor] Verificando runs activos en thread ${threadId}...`);
        let attempt = 0;
        const maxAttempts = 20; // 40-60 segundos total
        while (attempt < maxAttempts) {
            const runs = await openai.beta.threads.runs.list(threadId, { limit: 5 });
            const activeRun = runs.data.find(run => 
                ["queued", "in_progress", "cancelling", "requires_action"].includes(run.status)
            );
            
            if (activeRun) {
                console.log(`[AssistantResponseProcessor] [${attempt}/${maxAttempts}] Run activo detectado (${activeRun.id}, estado: ${activeRun.status}). Esperando 2s...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempt++;
            } else {
                console.log(`[AssistantResponseProcessor] No hay runs activos. OK.`);
                // Delay adicional reducido pero presente para asegurar sincronización de OpenAI
                await new Promise(resolve => setTimeout(resolve, 1500));
                return;
            }
        }
        console.warn(`[AssistantResponseProcessor] Timeout esperando liberación del thread ${threadId}.`);
    } catch (error) {
        console.error(`[AssistantResponseProcessor] Error verificando runs:`, error);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Mapa global para bloquear usuarios de WhatsApp durante operaciones API
const userApiBlockMap = new Map();
const API_BLOCK_TIMEOUT_MS = 1000; // 5 segundos

function limpiarBloquesJSON(texto: string): string {
    // 1. Preservar bloques especiales temporalmente
    const specialBlocks: string[] = [];
    let textoConMarcadores = texto;
    
    // Preservar [DB_QUERY: ...] (Permitiendo espacios opcionales tras el corchete y alrededor de los dos puntos)
    textoConMarcadores = textoConMarcadores.replace(/\[\s*DB_QUERY\s*:\s*[\s\S]*?\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });
    
    // Preservar [API]...[/API] (Tolerante a espacios)
    textoConMarcadores = textoConMarcadores.replace(/\[\s*API\s*\][\s\S]*?\[\/\s*API\s*\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });
    
    // 2. Limpiar referencias de OpenAI tipo 【4:0†archivo.pdf】
    let limpio = textoConMarcadores.replace(/【.*?】/g, "");
    
    // 3. Restaurar bloques especiales
    specialBlocks.forEach((block, index) => {
        limpio = limpio.replace(`___SPECIAL_BLOCK_${index}___`, block);
    });
    
    return limpio;
}

function corregirFechaAnioVigente(fechaReservaStr: string): string {
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
            console.log('[Webchat Debug] Mensaje saliente al usuario (sin filtrar):', textResponse);
        } else {
            console.log('[WhatsApp Debug] Mensaje saliente al usuario (sin filtrar):', textResponse);
        }
        
        // Log específico para debug de DB_QUERY
        console.log('[DEBUG] Buscando [DB_QUERY] en:', textResponse.substring(0, 200));
        
        // 0) Detectar y procesar DB QUERY [DB_QUERY: ...] (Permitiendo espacios opcionales tras el corchete y alrededor de los dos puntos)
        const dbQueryRegex = /\[\s*DB_QUERY\s*:\s*([\s\S]*?)\]/i;
        const dbMatch = textResponse.match(dbQueryRegex);
        console.log('[DEBUG] DB Match result:', dbMatch ? 'FOUND' : 'NULL');
        if (dbMatch) {
            const sqlQuery = dbMatch[1].trim();
            if (ctx && ctx.type === 'webchat') console.log(`[Webchat Debug] 🔄 Detectada solicitud de DB Query: ${sqlQuery}`);
            else console.log(`[WhatsApp Debug] 🔄 Detectada solicitud de DB Query: ${sqlQuery}`);
            
            // Ejecutar Query
            const queryResult = await executeDbQuery(sqlQuery);
            console.log(`[AssistantResponseProcessor] 📝 Resultado DB RAW:`, queryResult.substring(0, 500) + (queryResult.length > 500 ? "..." : "")); 
            const feedbackMsg = `[SYSTEM_DB_RESULT]: ${queryResult}`;
            
            // Obtener threadId de forma segura
            let threadId = ctx && ctx.thread_id;
            if (!threadId && state && typeof state.get === 'function') {
                threadId = state.get('thread_id');
            }

            // Esperar a que el Run anterior haya finalizado realmente en OpenAI
            if (threadId) {
                await waitForActiveRuns(threadId);
            } else {
                 await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Obtener nueva respuesta del asistente
            let newResponse: any;
            try {
                 newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado DB.", ctx ? ctx.from : null, threadId);
            } catch (err: any) {
                // Si aún así falla por run activo, intentamos una vez más tras una espera larga
                if (err?.message?.includes('active')) {
                    console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual (DB)...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado DB.", ctx ? ctx.from : null, threadId);
                } else {
                    console.error("Error al obtener respuesta recursiva (DB):", err);
                    return;
                }
            }
            
            // Recursión: procesar la nueva respuesta
            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID
            );
            return; // Terminar ejecución actual
        }

        // 1) Extraer bloque [API] ... [/API] (Tolerante a espacios)
        const apiBlockRegex = /\[\s*API\s*\]([\s\S]*?)\[\/\s*API\s*\]/is;
        const match = textResponse.match(apiBlockRegex);
        if (match) {
            const jsonStr = match[1].trim();
            console.log('[Debug] Bloque [API] detectado:', jsonStr);
            try {
                jsonData = JSON.parse(jsonStr);
            } catch (e) {
                console.error('[AssistantResponseProcessor] Error al parsear bloque [API]:', e.message);
                jsonData = null;
            }
        }

        // 3) Procesar JSON si existe
        if (jsonData && typeof jsonData.type === "string") {
            let apiResponse: any = null;

            // Bloquear usuario temporalmente si es WhatsApp
            let unblockUser = null;
            if (ctx && ctx.type !== 'webchat' && ctx.from) {
                userApiBlockMap.set(ctx.from, true);
                const timeoutId = setTimeout(() => { userApiBlockMap.delete(ctx.from); }, API_BLOCK_TIMEOUT_MS);
                unblockUser = () => { clearTimeout(timeoutId); userApiBlockMap.delete(ctx.from); };
            }

            const tipo = jsonData.type.trim();

            try {
                if (tipo === "create_event") {
                    apiResponse = await CalendarEvents.createEvent({
                        fecha: jsonData.fecha,
                        hora: jsonData.hora,
                        titulo: jsonData.titulo,
                        descripcion: jsonData.descripcion,
                        invitados: jsonData.invitados
                    });
                } else if (tipo === "available_event") {
                    const start = `${jsonData.fecha}T${jsonData.hora}:00-03:00`;
                    const end = moment(start).add(1, 'hour').format('YYYY-MM-DDTHH:mm:ssZ');
                    apiResponse = await CalendarEvents.checkAvailability(start, end);
                } else if (tipo === "modify_event") {
                    apiResponse = await CalendarEvents.updateEvent(jsonData.id, {
                        fecha: jsonData.fecha,
                        hora: jsonData.hora,
                        titulo: jsonData.titulo,
                        descripcion: jsonData.descripcion
                    });
                } else if (tipo === "cancel_event") {
                    apiResponse = await CalendarEvents.deleteEvent(jsonData.id);
                }
            } catch (err) {
                apiResponse = { error: "Error en operación API: " + err.message };
            }

            if (apiResponse) {
                // En lugar de enviar el JSON al usuario, se lo devolvemos al asistente para que responda algo natural
                const feedbackMsg = `[SYSTEM_API_RESULT]: ${JSON.stringify(apiResponse)}`;
                
                let threadId = ctx?.thread_id;
                if (!threadId && state?.get) threadId = state.get('thread_id');

                if (threadId) await waitForActiveRuns(threadId);
                else await new Promise(resolve => setTimeout(resolve, 2000));

                let newResponse: any;
                try {
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                } catch (err: any) {
                    // Si falla por run activo, intentamos una vez más tras una espera larga
                    if (err?.message?.includes('active')) {
                        console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual (API)...");
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                    } else {
                        console.error("Error al obtener respuesta recursiva tras API:", err);
                        if (unblockUser) unblockUser();
                        return;
                    }
                }

                if (unblockUser) unblockUser();

                // Recursión: procesar la respuesta final del asistente
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID
                );
                return;
            }
            if (unblockUser) unblockUser();
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

