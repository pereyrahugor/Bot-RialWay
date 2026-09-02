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
import { executeDbQuery } from '../../db/dbHandler';
import { JsonBlockFinder } from "../google/JsonBlockFinder";
import { CalendarEvents } from "../google/calendarEvents";
import { downloadFileFromDrive } from '../google/googleDriveHandler';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
import OpenAI from "openai";
import { getOpenAIBaseUrl } from "./openaiHelper";
import { transcribeAudioFile } from './audioTranscriptior';
import { HistoryHandler } from '../../db/historyHandler';
import { executeClientTool } from "../../bot/toolRouter";
//import { handleToolFunctionCall } from '../Api-BotAsistente/handleToolFunctionCall.js';

const baseURL = getOpenAIBaseUrl();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...(baseURL ? { baseURL } : {})
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
    
    // Preservar #tool_nombre#... (Tolerante a espacios y opcionalmente con tag de cierre)
    textoConMarcadores = textoConMarcadores.replace(/#\s*tool_([a-zA-Z0-9_-]+)\s*#\s*(\{[\s\S]*?\})(?:#\/\s*tool_\1\s*#)?/gi, (match) => {
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

    // 2e. Filtrar bloques técnicos de derivación y resumen (procedentes de AiManager o fugas del modelo)
    limpio = limpio.replace(/(?:###\s*)?(?:BLOQUE:\s*)?["']?GET_RESUMEN["']?[\s\S]+/gi, "");
    // Filtrar bloques de reporte técnico iniciados por "Tipo: SI_RESUMEN / NO_REPORTAR..." aún si omiten "GET_RESUMEN"
    limpio = limpio.replace(/(?:^|\n)\s*Tipo:\s*(?:SI_RESUMEN|NO_REPORTAR_SEGUIR|NO_REPORTAR_BAJA|SI_REPORTAR_SEGUIR)[\s\S]*?(?=(?:\n\s*\n[A-ZÁÉÍÓÚ¿¡]|$))/gi, "");
    // Si la respuesta completa es solo la plantilla técnica de reporte, vaciarla por completo
    if (/^\s*Tipo:\s*(?:SI_RESUMEN|NO_REPORTAR_SEGUIR|NO_REPORTAR_BAJA|SI_REPORTAR_SEGUIR)/i.test(limpio)) {
        limpio = "";
    }
    // Regex más flexible: busca "derivar a asistente X" o "derivar a asesor humano" en cualquier parte, opcionalmente con punto final.
    // Sincronizado con AiManager.ts para consistencia total.
    limpio = limpio.replace(/(?:derivar|derivando|derivo)(?:\s+(?:a|al|el|a\s+la))?\s+(?:asistente\s*[1-5]|asesor\s+humano|agente\s+humano|atencion\s+humano|soporte\s+humano)(?:\.|\b|$)/gim, "");
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
    public static async actualizarContextoCliente(state: any, data: any, chatId?: string) {
        if (!state || typeof state.get !== 'function' || typeof state.update !== 'function') return;
        
        const rawContext = state.get('datosClienteContext');
        const contextAny: any = rawContext;
        const current = contextAny || {
            nombre: '',
            apellido: '',
            direccion: '',
            numCliente: '',
            tipoCliente: '',
            incidencias_ids: [],
            esCliente: 'No'
        };

        const updated = {
            ...current,
            nombre: data.nombre || data.nombreCliente || current.nombre,
            apellido: data.apellido || current.apellido,
            direccion: data.direccion || data.domicilioCompleto || data.domicilio || current.direccion,
            numCliente: data.cliente_id || data.numCliente || current.numCliente,
            tipoCliente: data.tipoCliente || current.tipoCliente,
            esCliente: (data.esCliente || (data.cliente_id || data.numCliente ? 'Si' : current.esCliente))
        };

        if (data.incidencia_generada) {
            updated.incidencias_ids = Array.isArray(updated.incidencias_ids) ? updated.incidencias_ids : [];
            updated.incidencias_ids.push(String(data.incidencia_generada));
        }

        if ('numIncidencias' in updated) {
            delete updated.numIncidencias;
        }

        await state.update({ datosClienteContext: updated });

        if (chatId) {
            await HistoryHandler.saveClientContext(chatId, updated);
        }
    }

    static async analizarYProcesarRespuestaAsistente(
        response: any,
        ctx: any,
                                                                                                                                                                                         flowDynamic: any,
        state: any,
        provider: any,
        gotoFlow: any,
        getAssistantResponse: Function,
        ASSISTANT_ID: string,
        agentName?: string,
        recursionDepth: number = 0,
        projectId?: string,
        serviceId?: string | null
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
            try {
                jsonData = JSON.parse(jsonStr);
            } catch (e: any) {
                jsonData = null;
            }
        }

        // 1b) Extraer formato alternativo #tool_nombre# ...
        if (!jsonData) {
            const toolBlockRegex = /#\s*tool_([a-zA-Z0-9_-]+)\s*#\s*(\{[\s\S]*?\})(?:#\/\s*tool_\1\s*#)?/is;
            const toolMatch = sanitizedTextResponse.match(toolBlockRegex);
            if (toolMatch) {
                const toolName = toolMatch[1].trim().toUpperCase();
                const jsonStr = toolMatch[2].trim();
                try {
                    jsonData = JSON.parse(jsonStr);
                    // Inyectar el type para compatibilidad con executeClientTool
                    jsonData.type = toolName;
                } catch (e: any) {
                    jsonData = null;
                }
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
                } else {
                    // Ruta a herramientas específicas del cliente usando el router modular
                    const routerRes = await executeClientTool(tipo, jsonData, { 
                        state, 
                        ctx, 
                        flowDynamic, 
                        provider, 
                        gotoFlow, 
                        getAssistantResponse, 
                        ASSISTANT_ID,
                        projectId,
                        serviceId
                    });
                    
                    // Si el handler retorna un string, lo envolvemos en un objeto resultado; si es objeto, lo pasamos directo
                    apiResponse = typeof routerRes === 'string' ? { result: routerRes } : routerRes;
                }
            } catch (err: any) {
                console.error(`[AssistantResponseProcessor] Error ejecutando tool '${tipo}':`, err.message);
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
                    newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId, projectId, agentName, serviceId);
                } catch (err: any) {
                    // Si falla por run activo, intentamos una vez más tras una espera larga
                    if (err?.message?.includes('active')) {
                        // console.log("[AssistantResponseProcessor] Re-intentando tras detectar run activo residual (API)...");
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        newResponse = await getAssistantResponse(ASSISTANT_ID, feedbackMsg, state, "Error procesando resultado API.", ctx?.from, threadId, projectId, agentName, serviceId);
                    } else {
                        // console.error("Error al obtener respuesta recursiva tras API:", err);
                        if (unblockUser) unblockUser();
                        return;
                    }
                }

                if (unblockUser) unblockUser();

                // Recursión: procesar la respuesta final del asistente
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    newResponse, ctx, flowDynamic, state, provider, gotoFlow, getAssistantResponse, ASSISTANT_ID, agentName, recursionDepth + 1, projectId, serviceId
                );
                return;
            }
            if (unblockUser) unblockUser();
        }


        // 4) Procesar [PDF: ID / URL / PATH] si existen
        const pdfRegex = /\[\s*PDF\s*:\s*([^\]]+)\s*\]/gi;
        const pdfPaths: string[] = [];
        let pdfMatch;

        // Usar sanitizedTextResponse para buscar los IDs antes de limpiar
        while ((pdfMatch = pdfRegex.exec(sanitizedTextResponse)) !== null) {
            const rawTarget = pdfMatch[1].trim();
            console.log(`[AssistantResponseProcessor] 📄 Detectado bloque [PDF: ${rawTarget}]`);
            try {
                const filePath = await downloadFileFromDrive(rawTarget, projectId, serviceId);
                if (filePath && fs.existsSync(filePath) && !pdfPaths.includes(filePath)) {
                    pdfPaths.push(filePath);
                }
            } catch (err: any) {
                console.error(`[AssistantResponseProcessor] ❌ Error procesando PDF (${rawTarget}):`, err?.message || err);
            }
        }

        // 5) Detectar rutas de archivos directas en el texto (ej: /app/temp/...)
        // Esto sucede cuando una herramienta devuelve la ruta y el asistente la repite
        const filePathRegex = /(?:[a-zA-Z]:[\\/]|\.\/|\.\.\/|\/|temp\/|uploads\/)[a-zA-Z0-9._\-/\\]+(?:\s[a-zA-Z0-9._\-/\\]+)*\.pdf/gi;
        let fileMatch;
        while ((fileMatch = filePathRegex.exec(sanitizedTextResponse)) !== null) {
            const p = fileMatch[0].trim();
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
            
            let assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, threadId, projectId, agentName, serviceId);
            // Si la respuesta contiene (ID: ...), no la envíes al usuario, espera 10s y vuelve a enviar ok
            while (assistantApiResponse && /(ID:\s*\w+)/.test(assistantApiResponse)) {
                // console.log('[Debug] Respuesta contiene ID de reserva, esperando 10s y reenviando ok...');
                await new Promise(res => setTimeout(res, 10000));
                assistantApiResponse = await getAssistantResponse(ASSISTANT_ID, 'ok', state, undefined, ctx.from, threadId, projectId, agentName, serviceId);
            }
            // Cuando la respuesta no contiene el ID, envíala al usuario
            if (assistantApiResponse) {
                try {
                    const cleanRes = limpiarBloquesJSON(String(assistantApiResponse)).trim();
                    await AssistantResponseProcessor.sendResponseWithImages(flowDynamic, cleanRes);
                    // Guardar en el historial
                    if (ctx?.from) {
                        await HistoryHandler.saveMessage(ctx.from, 'assistant', cleanRes, 'text', null, ctx.userId, null, ctx.platform, projectId, serviceId || undefined);
                    }
                } catch (err: any) {
                    console.error('[WhatsApp Debug] Error en flowDynamic:', err);
                }
            }
        }

        const hasSummary = /(?:GET_RESUMEN|Tipo:\s*(?:SI_RESUMEN|NO_REPORTAR_SEGUIR|NO_REPORTAR_BAJA|SI_REPORTAR_SEGUIR))/i.test(sanitizedTextResponse);
        
        if (hasSummary) {
            console.log(`[AssistantProcessor] 📋 Resumen técnico detectado en la respuesta cruda. (Longitud limpia para usuario: ${cleanTextResponse.length})`);
        }

        // GUARDAR RESPUESTA DEL ASISTENTE EN EL HISTORIAL Y ENVIAR SOLO SI HAY TEXTO LIMPIO REAL
        if (cleanTextResponse.length > 0) {
            if (ctx && ctx.from) {
                const platform = ctx.platform || 'whatsapp';
                await HistoryHandler.saveMessage(
                    ctx.from, 
                    'assistant', 
                    cleanTextResponse, 
                    'text', 
                    null, 
                    ctx.userId, 
                    null, 
                    platform,
                    projectId,
                    serviceId || undefined
                );
            }
            
            try {
                await AssistantResponseProcessor.sendResponseWithImages(flowDynamic, cleanTextResponse);
            } catch (err: any) {
                console.error('[WhatsApp Debug] Error en sendResponseWithImages:', err);
            }

            // Enviar PDFs recolectados
            for (const pdfPath of pdfPaths) {
                try {
                    const absolutePath = path.resolve(pdfPath);
                    const fromNumber = ctx?.from || ctx?.key?.remoteJid || '';
                    const jid = fromNumber.includes('@') ? fromNumber : `${fromNumber}@s.whatsapp.net`;
                    const fileName = path.basename(absolutePath);
                    
                    // Detectamos si el proveedor es Meta para usar su método nativo de subida
                    const isMeta = provider?.constructor?.name === 'MetaCloudProvider' || provider?.constructor?.name === 'MetaProvider';

                    console.log(`[AssistantResponseProcessor] 📤 Enviando PDF vía ${isMeta ? 'Meta' : 'Baileys/Provider'}: ${absolutePath}`);

                    if (isMeta && fromNumber && typeof provider.sendMessage === 'function') {
                        await provider.sendMessage(fromNumber, absolutePath, { body: "📄 Documento adjunto:", mimetype: 'application/pdf', fileName });
                    } else if (provider?.sendFile && typeof provider.sendFile === 'function') {
                        await provider.sendFile(jid, absolutePath, "📄 Documento adjunto:");
                    } else if (provider?.sendMessage && typeof provider.sendMessage === 'function') {
                        await provider.sendMessage(jid, "📄 Documento adjunto:", { media: absolutePath, fileName });
                    } else {
                        await flowDynamic([{ body: "📄 Documento adjunto:", media: absolutePath }]);
                    }

                    // Persistir referencia al documento en el historial
                    if (ctx?.from) {
                        const platform = ctx.platform || 'whatsapp';
                        await HistoryHandler.saveMessage(
                            ctx.from,
                            'assistant',
                            `[Documento PDF: ${fileName}]`,
                            'document',
                            null,
                            ctx.userId,
                            null,
                            platform,
                            projectId,
                            serviceId || undefined
                        );
                    }
                    
                    // Breve espera entre archivos para asegurar el orden y evitar saturación
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err: any) {
                    console.error('[AssistantResponseProcessor] ❌ Error enviando PDF:', err);
                }
            }

            // Limpieza de archivos temporales descargados o guardados en directorios temporales
            for (const pdfPath of pdfPaths) {
                if (pdfPath.includes('temp/drive') || pdfPath.includes('temp\\drive') || pdfPath.includes('tmp/')) {
                    setTimeout(() => {
                        try {
                            if (fs.existsSync(pdfPath)) {
                                fs.unlinkSync(pdfPath);
                                console.log(`[AssistantResponseProcessor] Archivo temporal eliminado: ${pdfPath}`);
                            }
                        } catch (e: any) {
                            console.error(`[AssistantResponseProcessor] Error al eliminar archivo temporal ${pdfPath}:`, e.message);
                        }
                    }, 10000);
                }
            }
        }
    }

    public static async procesarHandoverYDerivacion(
        response: string,
        ctx: any,
        flowDynamic: any,
        state: any,
        provider: any,
        gotoFlow: any,
        getAssistantResponse: Function,
        currentAssistantId: string,
        assignedAgentName: string,
        assistantMap: Record<string, string | undefined>,
        projectId: string,
        serviceId: string | null = null
    ) {
        if (!response) return;

        const lower = response.toLowerCase();
        
        // Regex robusto para detectar derivación (sincronizado con ai.manager.ts)
        const matchAsistente = lower.match(/(?:derivar|derivando|derivo)(?:\s+(?:a|al|el|a\s+la))?\s+asistente\s*([1-5])(?:\.|\b|$)/i);
        let nextAgentName: string | null = null;
        if (matchAsistente) {
            nextAgentName = `asistente${matchAsistente[1]}`;
        } else if (/(?:derivar|derivando|derivo)(?:\s+(?:a|al|el|a\s+la))?\s+(?:asesor|agente|humano|atencion|soporte)\s+humano\b/i.test(lower)) {
            nextAgentName = 'asistente_humano';
        }

        const matchResumen = response.match(/(?:GET_RESUMEN|Tipo:\s*(?:SI_RESUMEN|NO_REPORTAR_SEGUIR|NO_REPORTAR_BAJA|SI_REPORTAR_SEGUIR))[\s\S]+/i);
        const resumen = matchResumen ? matchResumen[0].trim() : "Continúa con la atención del cliente.";

        if (nextAgentName) {
            if (nextAgentName === 'asistente_humano') {
                console.log(`🚀 [MultiAgent] Handover a HUMANO: Apagando bot para ${ctx.from}`);
                await HistoryHandler.toggleBot(ctx.from, false, projectId, serviceId);
                
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    response, ctx, flowDynamic, state, provider, gotoFlow,
                    getAssistantResponse, currentAssistantId, assignedAgentName, 0, projectId, serviceId
                );
                return;
            }

            const nextAssistantId = assistantMap[nextAgentName];
            
            if (!nextAssistantId) {
                console.warn(`⚠️ [MultiAgent] Handover fallido: No hay Assistant ID configurado para '${nextAgentName}' en el proyecto ${projectId}.`);
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    response, ctx, flowDynamic, state, provider, gotoFlow,
                    getAssistantResponse, currentAssistantId, assignedAgentName, 0, projectId, serviceId
                );
            } else if (nextAgentName === assignedAgentName) {
                console.log(`[MultiAgent] El destino '${nextAgentName}' es el mismo que el actual (${assignedAgentName}). Ignorando handover.`);
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    response, ctx, flowDynamic, state, provider, gotoFlow,
                    getAssistantResponse, currentAssistantId, assignedAgentName, 0, projectId, serviceId
                );
            } else {
                console.log(`🚀 [MultiAgent] Handover detectado: ${assignedAgentName} -> ${nextAgentName} (User: ${ctx.from})`);
                
                // 1. Persistir cambio de agente en DB y state
                await HistoryHandler.setAssignedAgent(ctx.from, nextAgentName, projectId, serviceId || undefined);
                await state.update({ assignedAgent: nextAgentName });

                // 2. Procesar respuesta del agente saliente
                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    response, ctx, flowDynamic, state, provider, gotoFlow,
                    getAssistantResponse, currentAssistantId, assignedAgentName, 0, projectId, serviceId
                );

                // 3. Transición inmediata al nuevo agente
                const resumenContextual = `RESUMEN DE LA CONVERSACIÓN PREVIA (PARA TU CONTEXTO):\n\n${resumen}`;
                console.log(`🚀 [MultiAgent] Iniciando respuesta inmediata del nuevo agente: ${nextAgentName}`);
                
                let threadId = ctx?.thread_id;
                if (!threadId && state?.get) threadId = state.get('thread_id');

                const nextResponseRaw = await getAssistantResponse(
                    nextAssistantId, resumenContextual, state, undefined, ctx.from, threadId, projectId, nextAgentName, serviceId
                );
                
                if (nextResponseRaw) {
                    await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                        nextResponseRaw, ctx, flowDynamic, state, provider, gotoFlow,
                        getAssistantResponse, nextAssistantId, nextAgentName, 0, projectId, serviceId
                    );
                }
            }
        } else {
            await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                response, ctx, flowDynamic, state, provider, gotoFlow,
                getAssistantResponse, currentAssistantId, assignedAgentName, 0, projectId, serviceId
            );
        }
    }

    public static async sendResponseWithImages(flowDynamic: any, text: string) {
        const imageRegex = /(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S+)?)/gi;
        const chunks = text.split(/\n\n+/);
        
        for (const chunk of chunks) {
            const trimmed = chunk.trim();
            if (trimmed.length > 0) {
                const match = trimmed.match(/(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S+)?)/i);
                
                if (match) {
                    const imageUrl = match[1];
                    const escapedUrl = imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const replaceRegex = new RegExp(`(https?:\\/\\/\\s*)?${escapedUrl}`, 'gi');
                    const cleanBody = trimmed.replace(replaceRegex, '').trim();
                    console.log(`[AssistantResponseProcessor] 📸 Enviando imagen parseada con caption: ${imageUrl}`);
                    await flowDynamic([{ body: cleanBody, media: imageUrl }]);
                } else {
                    await flowDynamic([{ body: trimmed }]);
                }
                
                await new Promise(r => setTimeout(r, 600));
            }
        }
    }
}
