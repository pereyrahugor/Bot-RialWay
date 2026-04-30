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
import { downloadFileFromDrive } from './googleDriveHandler';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
import OpenAI from "openai";
import { transcribeAudioFile } from './audioTranscriptior';
import { HistoryHandler } from './historyHandler';
//import { handleToolFunctionCall } from '../Api-BotAsistente/handleToolFunctionCall.js';

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Eliminadas funciones de Assistants API legacy


// Mapa global para bloquear usuarios de WhatsApp durante operaciones API
const userApiBlockMap = new Map();
const API_BLOCK_TIMEOUT_MS = 5000; // 5 segundos

function limpiarBloquesJSON(texto: string): string {
    // 1. Preservar bloques especiales temporalmente
    const specialBlocks: string[] = [];
    let textoConMarcadores = texto;
    
    // Preservar [API]...[/API] (Tolerante a espacios)
    textoConMarcadores = textoConMarcadores.replace(/\[\s*API\s*\][\s\S]*?\[\/\s*API\s*\]/gi, (match) => {
        const index = specialBlocks.length;
        specialBlocks.push(match);
        return `___SPECIAL_BLOCK_${index}___`;
    });
    
    // 2. Limpiar referencias de OpenAI tipo 【4:0†archivo.pdf】
    let limpio = textoConMarcadores.replace(/【.*?】/g, "");

    // 2b. Limpiar bloques JSON de "queries" que a veces fuga el asistente de OpenAI (File Search / Web Search)
    limpio = limpio.replace(/\{\s*"queries"\s*:\s*\[[\s\S]*?\]\s*\}[\s,]*?/gi, "");
    
    // 2c. Limpiar bloques de PDF [PDF: ID]
    limpio = limpio.replace(/\[\s*PDF\s*:\s*[\s\S]*?\]/gi, "");

    // 2d. Filtrar SYSTEM_DB_RESULT o SYSTEM_API_RESULT filtrados por error del asistente
    limpio = limpio.replace(/\[?\s*SYSTEM_(DB|API)_RESULT[\s\S]*?(?:\]|$)/gi, "");

    // 2e. Filtrar bloques técnicos de derivación y resumen (procedentes de AiManager)
    limpio = limpio.replace(/GET_RESUMEN[\s\S]+/gi, "");
    limpio = limpio.replace(/^[ \t]*derivar(?:ndo)? a (asistente\s*[1-5]|asesor humano)\.?\s*$/gim, "");
    limpio = limpio.replace(/\[Enviando.*$/gim, "");


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
        ASSISTANT_ID: string,
        recursionDepth: number = 0,
        projectId?: string
    ) {
        if (recursionDepth > 5) {
            console.error('[AssistantResponseProcessor] Límite de recursión alcanzado (5). Abortando para evitar bucle infinito.');
            await flowDynamic([{ body: "Lo siento, hubo un problema procesando la respuesta. Por favor, intenta de nuevo." }]);
            return;
        }
        // Log de mensaje entrante del asistente (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            console.log('[Webchat Debug] Mensaje entrante del asistente:', response);
        } else {
            console.log('[WhatsApp Debug] Mensaje entrante del asistente:', response);
        }

        let jsonData: any = null;
        // Sanitización y normalización del texto de respuesta
        const textResponseRaw = typeof response === "string" ? response : String(response || "");
        const textResponse = textResponseRaw.replace(/\0/g, '').trim();

        // Log de mensaje saliente al usuario (antes de cualquier filtro)
        if (ctx && ctx.type === 'webchat') {
            console.log('[Webchat Debug] Mensaje saliente al usuario (sin filtrar):', textResponse.substring(0, 500));
        } else {
            console.log('[WhatsApp Debug] Mensaje saliente al usuario (sin filtrar):', textResponse.substring(0, 500));
        }

        const sanitizedTextResponse = textResponse; // Alias para compatibilidad

        // 1) Extraer bloque [API] ... [/API] (Tolerante a espacios)
        const apiBlockRegex = /\[\s*API\s*\]([\s\S]*?)\[\/\s*API\s*\]/is;
        const match = sanitizedTextResponse.match(apiBlockRegex);
        if (match) {
            const jsonStr = match[1].trim();
            // console.log('[Debug] Bloque [API] detectado:', jsonStr);
            try {
                jsonData = JSON.parse(jsonStr);
            } catch (e) {
                // console.error('[AssistantResponseProcessor] Error al parsear bloque [API]:', e.message);
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

                await new Promise(resolve => setTimeout(resolve, 1000));

                let newResponse: any;
                try {
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                } catch (err: any) {
                    // Si falla por run activo, intentamos una vez más tras una espera larga
                    if (err?.message?.includes('active')) {
                        // console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual (API)...");
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId);
                    } else {
                        // console.error("Error al obtener respuesta recursiva tras API:", err);
                        if (unblockUser) unblockUser();
                        return;
                    }
                }

                if (unblockUser) unblockUser();

                // Recursión: procesar la respuesta final del asistente
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID, recursionDepth + 1, projectId
                );
                return;
            }
            if (unblockUser) unblockUser();
        }


        // 4) Procesar [PDF: ID] si existen
        const pdfRegex = /\[\s*PDF\s*:\s*([a-zA-Z0-9_-]+)\s*\]/gi;
        const pdfPaths: string[] = [];
        let pdfMatch;

        // Usar sanitizedTextResponse para buscar los IDs antes de limpiar
        while ((pdfMatch = pdfRegex.exec(sanitizedTextResponse)) !== null) {
            const fileId = pdfMatch[1];
            try {
                const filePath = await downloadFileFromDrive(fileId);
                if (filePath && fs.existsSync(filePath)) {
                    pdfPaths.push(filePath);
                }
            } catch (err: any) {
                // console.error(`[PDF Processor] Error con ID ${fileId}:`, err.message);
            }
        }

        // 5) Detectar rutas de archivos directas en el texto (ej: /app/temp/...)
        // Esto sucede cuando una herramienta devuelve la ruta y el asistente la repite
        const filePathRegex = /([\/A-Za-z0-9._\-\s:\\]+\.pdf)/gi;
        let fileMatch;
        while ((fileMatch = filePathRegex.exec(sanitizedTextResponse)) !== null) {
            const p = fileMatch[1].trim();
            // Solo agregar si existe en disco y no está ya en la lista
            if (fs.existsSync(p) && !pdfPaths.includes(p)) {
                pdfPaths.push(p);
            }
        }

        let cleanTextResponse = limpiarBloquesJSON(sanitizedTextResponse).trim();

        // 6) Limpiar las rutas de archivos del texto final para evitar enviar texto técnico al usuario
        for (const p of pdfPaths) {
            // Escapar caracteres especiales para el regex
            const escapedPath = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            cleanTextResponse = cleanTextResponse.replace(new RegExp(escapedPath, 'g'), '').trim();
        }
        // Lógica especial para reserva: espera y reintento
        if (cleanTextResponse.includes('Voy a proceder a realizar la reserva.')) {
            // Espera 30 segundos y responde ok al asistente
            await new Promise(res => setTimeout(res, 30000));
            let threadId = ctx?.thread_id;
            if (!threadId && state?.get) threadId = state.get('thread_id');
            
            let assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, threadId);
            // Si la respuesta contiene (ID: ...), no la envíes al usuario, espera 10s y vuelve a enviar ok
            while (assistantApiResponse && /(ID:\s*\w+)/.test(assistantApiResponse)) {
                // console.log('[Debug] Respuesta contiene ID de reserva, esperando 10s y reenviando ok...');
                await new Promise(res => setTimeout(res, 10000));
                assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, threadId);
            }
            // Cuando la respuesta no contiene el ID, envíala al usuario
            if (assistantApiResponse) {
                try {
                    const cleanRes = limpiarBloquesJSON(String(assistantApiResponse)).trim();
                    await flowDynamic([{ body: cleanRes }]);
                    // Guardar en el historial
                    if (ctx?.from) {
                        await HistoryHandler.saveMessage(ctx.from, 'assistant', cleanRes, 'text', null, ctx.userId, null, ctx.platform, projectId);
                    }
                } catch (err) {
                    console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                }
            }
        }

        const hasSummary = /GET_RESUMEN/i.test(sanitizedTextResponse);
        
        if (hasSummary) {
            console.log(`[AssistantProcessor] 📋 Resumen detectado en la respuesta. (Longitud limpia: ${cleanTextResponse.length})`);
        }

        if (cleanTextResponse.length > 0 || pdfPaths.length > 0 || hasSummary) {
            // GUARDAR RESPUESTA DEL ASISTENTE EN EL HISTORIAL
            if (ctx && ctx.from) {
                const platform = ctx.platform || 'whatsapp';
                await HistoryHandler.saveMessage(
                    ctx.from, 
                    'assistant', 
                    cleanTextResponse.length > 0 ? cleanTextResponse : sanitizedTextResponse, 
                    'text', 
                    null, 
                    ctx.userId, 
                    null, 
                    platform,
                    projectId
                );
            }
            
            const chunks = cleanTextResponse.split(/\n\n+/);
            for (const chunk of chunks) {
                if (chunk.trim().length > 0) {
                    try {
                        await flowDynamic([{ body: chunk.trim() }]);
                        // Pequeña pausa para evitar que WhatsApp ignore mensajes muy rápidos
                        await new Promise(r => setTimeout(r, 600)); 
                        // flowDynamic ejecutado correctamente
                    } catch (err) {
                        console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                    }
                }
            }

            // Enviar PDFs recolectados
            for (const pdfPath of pdfPaths) {
                try {
                    const absolutePath = path.resolve(pdfPath);
                    const fromNumber = ctx?.from || ctx?.key?.remoteJid || '';
                    
                    // Detectamos si el proveedor es Meta para usar su método nativo de subida
                    const isMeta = provider?.constructor?.name === 'MetaCloudProvider' || provider?.constructor?.name === 'MetaProvider';

                    if (isMeta && fromNumber && typeof provider.sendMessage === 'function') {
                        console.log(`[AssistantResponseProcessor] Enviando PDF vía Meta (Directo): ${absolutePath}`);
                        await provider.sendMessage(fromNumber, absolutePath, { body: "📄 Documento adjunto:" });
                    } else {
                        // Para Baileys y otros, flowDynamic es el método estándar y más fiable para enviar archivos locales
                        console.log(`[AssistantResponseProcessor] Enviando PDF vía FlowDynamic: ${absolutePath}`);
                        await flowDynamic([{ body: "📄 Documento adjunto:", media: absolutePath }]);
                    }
                    
                    // Breve espera entre archivos para asegurar el orden y evitar saturación
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err) {
                    console.error('[AssistantResponseProcessor] Error enviando PDF:', err);
                }
            }
        }
    }
}
