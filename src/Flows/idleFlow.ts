import { addKeyword, EVENTS } from '@builderbot/bot';
import { safeToAsk } from '../utils/openaiHelper';
import { errorReporter } from "../app";
import { GenericResumenData, extraerDatosResumen } from '~/utils/extractJsonData';
import { addToSheet } from '~/utils/googleSheetsResumen';
import fs from 'fs';
import path from 'path';// Import the new logic
import { ReconectionFlow } from './reconectionFlow';
import { HistoryHandler } from '../utils/historyHandler'; // Integración con CRM
import { getGroupProvider } from '../providers/instances';

//** Variables de entorno para el envio de msj de resumen a grupo de WS */
const ASSISTANT_ID = process.env.ASSISTANT_ID ?? '';
const ID_GRUPO_RESUMEN = process.env.ID_GRUPO_RESUMEN ?? '';
const ID_GRUPO_RESUMEN_2 = process.env.ID_GRUPO_RESUMEN_2 ?? '';
const msjCierre: string = process.env.msjCierre as string;

// Función para formatear el resumen (JSON o texto) de forma amigable para WhatsApp y CRM
function formatSummary(resumen: string, data: GenericResumenData, userId?: string): string {
    // Si el resumen es JSON puro, lo convertimos a un formato de lista legible
    let cleanText = resumen;
    try {
        const parsed = typeof resumen === 'string' ? JSON.parse(resumen) : resumen;
        if (typeof parsed === 'object') {
            cleanText = Object.entries(parsed)
                .filter(([k]) => k.toLowerCase() !== 'tipo' && k.toLowerCase() !== 'type')
                .map(([k, v]) => `*${k}:* ${v}`)
                .join('\n');
        }
    } catch (e) {
        // Si no es JSON, usamos el resumen original pero quitamos el bloque de tipo si existe
        cleanText = resumen.replace(/Tipo:\s*\w+/i, '').replace(/###\s*BLOQUE:\s*GET_RESUMEN/i, '').trim();
    }

    const phone = (data.from || userId || '').replace(/[^0-9]/g, '');
    const linkWS = data.linkWS || `https://wa.me/${phone}`;
    return `📝 *RESUMEN DE CONVERSACIÓN*\n\n${cleanText}\n\n🔗 *Chat del usuario:* ${linkWS}`;
}

// Función auxiliar para reenviar media
async function sendMediaToGroup(provider: any, state: any, targetGroup: string, data: any) {
    // Detectar variaciones de "si" (si, sí, sii, si., Si, YES, etc - aunque el json suele ser español)
    // Usamos regex flexible que busca "s" seguido de "i" o "í"
    const fotoOVideoRaw = data["Foto o video"] || '';
    const debeEnviar = /s[ií]+/i.test(fotoOVideoRaw);

    if (debeEnviar) {
        const lastImage = state.get('lastImage');
        const lastVideo = state.get('lastVideo');

        if (lastImage && typeof lastImage === 'string') {
            if (fs.existsSync(lastImage)) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`📡 Intentando enviar imagen: ${lastImage} a ${targetGroup}`);
                await provider.sendImage(targetGroup, lastImage, "");
                console.log(`✅ Imagen reenviada al grupo ${targetGroup}`);
                try {
                    fs.unlinkSync(lastImage);
                    await state.update({ lastImage: null });
                } catch (e) { console.error('Error borrando img:', e.message); }
            }
        }

        if (lastVideo && typeof lastVideo === 'string') {
            if (fs.existsSync(lastVideo)) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`📡 Intentando enviar video: ${lastVideo} a ${targetGroup}`);
                if (provider.sendVideo) {
                    await provider.sendVideo(targetGroup, lastVideo, "");
                } else {
                    await provider.sendImage(targetGroup, lastVideo, "");
                }
                console.log(`✅ Video reenviada al grupo ${targetGroup}`);
                try {
                    fs.unlinkSync(lastVideo);
                    await state.update({ lastVideo: null });
                } catch (e) { console.error('Error borrando video:', e.message); }
            }
        }
    }
}

//** Flow para cierre de conversación, generación de resumen y envio a grupo de WS */
const idleFlow = addKeyword(EVENTS.ACTION).addAction(
    async (ctx, { endFlow, provider, state, flowDynamic, gotoFlow }) => {
        const userId = ctx.from;
        // Filtrar contactos ignorados antes de procesar el flujo
        if (
            /@broadcast$/.test(userId) ||
            /@newsletter$/.test(userId) ||
            /@channel$/.test(userId)
        ) {
            // console.log(`idleFlow ignorado por filtro de contacto: ${userId}`);
            return endFlow();
        }

        try {
            // Recuperar contexto dinámico del state o de la DB (RAILWAY_PROJECT_ID)
            let dynamicProjectId = state.get('dynamicProjectId') || process.env.RAILWAY_PROJECT_ID;

            const targetAssistantId = state.get('assignedAssistantId') || ASSISTANT_ID;

            console.log(`[idleFlow] 🤖 Generando resumen con Asistente: ${targetAssistantId} | Proyecto: ${dynamicProjectId}`);

            // Obtener el resumen del asistente de OpenAI con reintentos y reporte de errores
            const resumen = await safeToAsk(targetAssistantId, "GET_RESUMEN", state, userId, errorReporter, 5, false, dynamicProjectId, true) as string;

            if (!resumen) {
                console.warn("No se pudo obtener el resumen.");
                return endFlow();
            }

            let data: GenericResumenData;
            try {
                data = JSON.parse(resumen);
            } catch (error) {
                console.warn("⚠️ El resumen no es JSON. Se extraerán los datos manualmente.");
                data = extraerDatosResumen(resumen);
            }

            // --- LÓGICA DE AUTOMATIZACIÓN DE NUEVO LEAD ---
            try {
                const cleanNombre = (data.Nombre || data.nombre || data.contactName || '').trim();
                const cleanEmail = (data.Correo || data.correo || data.Email || data.email || '').trim();
                const cleanSource = (data.Origen || data.origen || data.Source || data.source || 'Asistente AI').trim();

                // 1. Actualizar detalles del contacto en el CRM
                if (cleanNombre || cleanEmail || resumen) {
                    console.log(`[idleFlow] 📝 Actualizando contacto ${userId} en CRM. Project: ${dynamicProjectId}`);
                    
                    // Intentar obtener notas previas para no sobreescribir (evitar data loss)
                    const chatData = await HistoryHandler.getChat(userId, dynamicProjectId);
                    const previousNotes = chatData?.notes ? `${chatData.notes}\n\n---\n\n` : '';
                    
                    // Formateamos el resumen para que sea legible en las notas del CRM
                    const newSummary = formatSummary(resumen, data, userId);
                    const summaryForNotes = previousNotes + newSummary;
                    
                    const updateData: any = {
                        notes: summaryForNotes,
                        is_lead: true // Marcamos explícitamente como Lead para que aparezca en el CRM
                    };

                    // Solo actualizamos si tenemos datos nuevos, para no borrar lo existente
                    if (cleanNombre) updateData.name = cleanNombre;
                    if (cleanEmail) updateData.email = cleanEmail;
                    if (cleanSource) updateData.source = cleanSource;

                    const updateResult = await HistoryHandler.updateContactDetails(userId, updateData, dynamicProjectId);
                    
                    if (!updateResult.success) {
                        console.error(`❌ Error actualizando contacto en CRM:`, updateResult.error);
                    } else {
                        console.log(`✅ CRM Actualizado para ${userId} | Proyecto: ${dynamicProjectId}`);
                    }

                    // 2. Crear Ticket de "Nuevo Lead" automáticamente
                    console.log(`[idleFlow] 🎟️ Creando ticket para ${userId}.`);
                    const ticketResult = await HistoryHandler.createTicket(
                        userId, 
                        `Nuevo Lead: ${cleanNombre || chatData?.name || userId}`, 
                        newSummary, // Usar solo el resumen nuevo en el ticket
                        'Nuevo Lead', 
                        'Alta',
                        dynamicProjectId
                    );

                    if (!ticketResult.success) {
                        console.error(`❌ Error creando ticket:`, ticketResult.error);
                    } else {
                        console.log(`🚀 Ticket "Nuevo Lead" creado automáticamente para ${userId}`);
                    }
                }

            } catch (leadError) {
                console.error("❌ Error en automatización de Nuevo Lead:", leadError.message);
            }
            // ----------------------------------------------

            // Log para depuración del valor real de tipo
            console.log('Valor de tipo:', JSON.stringify(data.tipo), '| Longitud:', data.tipo?.length);
            // Limpieza robusta de caracteres invisibles y espacios, preservando números y guiones bajos
            const tipo = (data.tipo ?? '').replace(/[^A-Z0-9_]/gi, '').toUpperCase();

            if (tipo === 'NO_REPORTAR_BAJA') {
                // No seguimiento, no enviar resumen al grupo ws, envia resumen a sheet, envia msj de cierre
                console.log('NO_REPORTAR_BAJA: No se realiza seguimiento ni se envía resumen al grupo.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                // Limpieza de imagen o video si existe
                const lastImage = state.get('lastImage');
                if (lastImage && typeof lastImage === 'string' && fs.existsSync(lastImage)) {
                    fs.unlinkSync(lastImage);
                    await state.update({ lastImage: null });
                }
                const lastVideo = state.get('lastVideo');
                if (lastVideo && typeof lastVideo === 'string' && fs.existsSync(lastVideo)) {
                    fs.unlinkSync(lastVideo);
                    await state.update({ lastVideo: null });
                }

                await addToSheet(data);
                return endFlow(); //("BNI, cambiando la forma en que el mundo hace negocios\nGracias por su contacto.");
            } else if (tipo === 'NO_REPORTAR_SEGUIR') {
                // Solo este activa seguimiento
                console.log('NO_REPORTAR_SEGUIR: Se realiza seguimiento, pero no se envía resumen al grupo.');
                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    flowDynamic,
                    gotoFlow,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        // Derivar al flujo conversacional usando gotoFlow
                        if (typeof gotoFlow === 'function') {
                            if (ctx.type === 'voice_note' || ctx.type === 'VOICE_NOTE') {
                                const mod = await import('./welcomeFlowVoice');
                                return gotoFlow(mod.welcomeFlowVoice);
                            } else {
                                const mod = await import('./welcomeFlowTxt');
                                return gotoFlow(mod.welcomeFlowTxt);
                            }
                        }
                    },
                    onFail: async () => {
                        data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;
                        await addToSheet(data);
                    }
                });
                return await reconFlow.start();
                // No cerrar el hilo aquí, dejar abierto para que el usuario pueda responder
                // Bloque SI_RESUMEN_G2
            } else if (tipo === 'SI_REPORTAR_SEGUIR') {
                // Se envía resumen al grupo y se activa seguimiento
                console.log('SI_REPORTAR_SEGUIR: Se envía resumen al grupo y se realiza seguimiento.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = formatSummary(resumen, data, userId);

                try {
                    const groupProvider = getGroupProvider();
                    const providerToSend = groupProvider || provider;
                    console.log(`[idleFlow] Enviando resumen (SI_REPORTAR_SEGUIR) via ${providerToSend.constructor.name} a ${ID_GRUPO_RESUMEN}`);
                    
                    await providerToSend.sendMessage(ID_GRUPO_RESUMEN, resumenConLink, {});
                    console.log(`✅ SI_REPORTAR_SEGUIR: Resumen enviado a ${ID_GRUPO_RESUMEN}`);
                    await sendMediaToGroup(providerToSend, state, ID_GRUPO_RESUMEN, data);

                } catch (err: any) {
                    console.error(`❌ SI_REPORTAR_SEGUIR Error:`, err?.message || err);
                }

                await addToSheet(data);

                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    flowDynamic,
                    gotoFlow,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        // Derivar al flujo conversacional usando gotoFlow
                        if (typeof gotoFlow === 'function') {
                            if (ctx.type === 'voice_note' || ctx.type === 'VOICE_NOTE') {
                                const mod = await import('./welcomeFlowVoice');
                                return gotoFlow(mod.welcomeFlowVoice);
                            } else {
                                const mod = await import('./welcomeFlowTxt');
                                return gotoFlow(mod.welcomeFlowTxt);
                            }
                        }
                    },
                    onFail: async () => {
                        console.log('SI_REPORTAR_SEGUIR: No se obtuvo respuesta luego del seguimiento.');
                    }
                });
                return await reconFlow.start();
                // No cerrar el hilo aquí, dejar abierto para que el usuario pueda responder
                // Bloque SI_RESUMEN_G2
            } else if (tipo === 'SI_RESUMEN_G2') {
                console.log('SI_RESUMEN_G2: Solo se envía resumen al grupo y sheets.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = formatSummary(resumen, data, userId);
                try {
                    const groupProvider = getGroupProvider();
                    const providerToSend = groupProvider || provider;
                    console.log(`[idleFlow] Enviando resumen (SI_RESUMEN_G2) via ${providerToSend.constructor.name} a ${ID_GRUPO_RESUMEN_2}`);
                    
                    // Usar sendMessage por compatibilidad con Meta y mejor manejo en Baileys
                    await providerToSend.sendMessage(ID_GRUPO_RESUMEN_2, resumenConLink, {});
                    console.log(`✅ SI_RESUMEN_G2: Resumen enviado a ${ID_GRUPO_RESUMEN_2}`);

                    await sendMediaToGroup(providerToSend, state, ID_GRUPO_RESUMEN_2, data);

                } catch (err: any) {
                    console.error(`❌ SI_RESUMEN_G2 Error:`, err?.message || err);
                }

                await addToSheet(data);
                return;

            } else if (tipo === 'SI_RESUMEN') {
                console.log('SI_RESUMEN: Solo se envía resumen al grupo y sheets.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = formatSummary(resumen, data, userId);
                try {
                    const groupProvider = getGroupProvider();
                    const providerToSend = groupProvider || provider;
                    console.log(`[idleFlow] Enviando resumen (SI_RESUMEN) via ${providerToSend.constructor.name} a ${ID_GRUPO_RESUMEN}`);

                    await providerToSend.sendMessage(ID_GRUPO_RESUMEN, resumenConLink, {});
                    console.log(`✅ SI_RESUMEN: Resumen enviado a ${ID_GRUPO_RESUMEN}`);

                    await sendMediaToGroup(providerToSend, state, ID_GRUPO_RESUMEN, data);

                } catch (err: any) {
                    console.error(`❌ SI_RESUMEN Error:`, err?.message || err);
                }

                await addToSheet(data);
                return;

            } else {
                // DEFAULT
                console.log('Tipo desconocido, procesando como SI_RESUMEN por defecto.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = formatSummary(resumen, data, userId);
                try {
                    const groupProvider = getGroupProvider();
                    const providerToSend = groupProvider || provider;
                    console.log(`[idleFlow] Enviando resumen (DEFAULT) via ${providerToSend.constructor.name} a ${ID_GRUPO_RESUMEN}`);

                    await providerToSend.sendMessage(ID_GRUPO_RESUMEN, resumenConLink, {});
                    console.log(`✅ DEFAULT: Resumen enviado a ${ID_GRUPO_RESUMEN}`);

                    await sendMediaToGroup(providerToSend, state, ID_GRUPO_RESUMEN, data);

                } catch (err: any) {
                    console.error(`❌ DEFAULT Error:`, err?.message || err);
                }

                await addToSheet(data);
                return;
            }
        } catch (error) {
            console.error("Error al obtener el resumen de OpenAI:", error);
            return endFlow();
        }
    });

export { idleFlow };