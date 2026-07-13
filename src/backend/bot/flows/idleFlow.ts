import { addKeyword, EVENTS } from '@builderbot/bot';
import { safeToAsk } from '../../apis/openai/openaiHelper';
import { errorReporter } from "../../../app";
import { GenericResumenData, extraerDatosResumen } from '~/utils/extractJsonData';
import { addToSheet } from '~/apis/google/googleSheetsResumen';
import fs from 'fs';
import path from 'path';// Import the new logic
import { ReconectionFlow } from './reconectionFlow';
import { HistoryHandler } from '../../db/historyHandler'; // Integración con CRM
import { getGroupProvider } from '../../providers/instances';

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
    } catch (e: any) {
        // Si no es JSON, usamos el resumen original pero quitamos el bloque de tipo si existe
        cleanText = resumen.replace(/Tipo:\s*\w+/i, '').replace(/###\s*BLOQUE:\s*GET_RESUMEN/i, '').trim();
    }

    const phone = (data.from || userId || '').replace(/[^0-9]/g, '');
    const linkWS = data.linkWS || `https://wa.me/${phone}`;
    return `📝 *RESUMEN DE CONVERSACIÓN*\n\n${cleanText}\n\n🔗 *Chat del usuario:* ${linkWS}`;
}

// Función auxiliar para enviar texto de forma nativa via Baileys para evitar redirección del wrapper
async function sendTextToGroup(providerToSend: any, jid: string, text: string) {
    const vendor = providerToSend?.vendor;
    const isReady = !!(vendor?.authState?.creds?.me?.id || vendor?.user?.id);
    if (vendor && isReady) {
        console.log(`[idleFlow] Enviando mensaje nativo de Baileys a grupo: ${jid}`);
        await vendor.sendMessage(jid, { text });
    } else {
        console.log(`[idleFlow] Enviando mensaje normal a: ${jid}`);
        await providerToSend.sendMessage(jid, text, {});
    }
}

// Función auxiliar para reenviar media
async function sendMediaToGroup(provider: any, state: any, targetGroup: string, data: any, skipDelete: boolean = false) {
    const lastImage = state.get('lastImage');
    const lastVideo = state.get('lastVideo');
    const fotoOVideoRaw = data["Foto o video"] || data["foto o video"] || '';
    
    let debeEnviar = false;
    if (fotoOVideoRaw === '') {
        // Si no se incluyó la clave en el JSON de resumen, pero hay archivos de media en el state,
        // asumimos por defecto que sí debemos enviarlos para evitar pérdida de información.
        if (lastImage || lastVideo) {
            console.log(`[idleFlow] 📂 Se detectó media en el estado sin clave 'Foto o video' en el resumen. Activando envío automático.`);
            debeEnviar = true;
        }
    } else {
        debeEnviar = /s[ií]+/i.test(fotoOVideoRaw);
    }

    if (debeEnviar) {
        const lastImage = state.get('lastImage');
        const lastVideo = state.get('lastVideo');
        const vendor = provider?.vendor;
        const isReady = !!(vendor?.authState?.creds?.me?.id || vendor?.user?.id);

        if (lastImage && typeof lastImage === 'string') {
            if (fs.existsSync(lastImage)) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`📡 Intentando enviar imagen: ${lastImage} a ${targetGroup}`);
                if (vendor && isReady) {
                    await vendor.sendMessage(targetGroup, { image: fs.readFileSync(lastImage) });
                } else {
                    await provider.sendImage(targetGroup, lastImage, "");
                }
                console.log(`✅ Imagen reenviada al grupo ${targetGroup}`);
                if (!skipDelete) {
                    try {
                        fs.unlinkSync(lastImage);
                        await state.update({ lastImage: null });
                    } catch (e: any) { console.error('Error borrando img:', e.message); }
                }
            }
        }

        if (lastVideo && typeof lastVideo === 'string') {
            if (fs.existsSync(lastVideo)) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log(`📡 Intentando enviar video: ${lastVideo} a ${targetGroup}`);
                if (vendor && isReady) {
                    await vendor.sendMessage(targetGroup, { video: fs.readFileSync(lastVideo) });
                } else {
                    if (provider.sendVideo) {
                        await provider.sendVideo(targetGroup, lastVideo, "");
                    } else {
                        await provider.sendImage(targetGroup, lastVideo, "");
                    }
                }
                console.log(`✅ Video reenviada al grupo ${targetGroup}`);
                if (!skipDelete) {
                    try {
                        fs.unlinkSync(lastVideo);
                        await state.update({ lastVideo: null });
                    } catch (e: any) { console.error('Error borrando video:', e.message); }
                }
            }
        }
    }
}

// Función para limpiar archivos locales de media de forma segura
async function cleanUpMediaFiles(state: any) {
    const lastImage = state.get('lastImage');
    if (lastImage && typeof lastImage === 'string' && fs.existsSync(lastImage)) {
        try {
            fs.unlinkSync(lastImage);
        } catch (e: any) { console.error('Error borrando img al limpiar:', e.message); }
    }
    const lastVideo = state.get('lastVideo');
    if (lastVideo && typeof lastVideo === 'string' && fs.existsSync(lastVideo)) {
        try {
            fs.unlinkSync(lastVideo);
        } catch (e: any) { console.error('Error borrando video al limpiar:', e.message); }
    }
    await state.update({ lastImage: null, lastVideo: null });
}

/*
// Envía el reporte a todos los grupos virtuales configurados para el proyecto
async function dispatchVirtualGroupReports(projectId: string, message: string, state: any, provider: any, data: any) {
    try {
        const enabled = await HistoryHandler.getConfig('META_GROUP_REPORTS_ENABLED', projectId);
        if (enabled !== 'true') {
            console.log(`[idleFlow] Envío a grupos virtuales (WABA) desactivado.`);
            return;
        }

        const groups = await HistoryHandler.getWabaReportGroups(projectId);
        if (groups.length === 0) {
            console.log(`[idleFlow] No hay grupos virtuales de reportes configurados.`);
            return;
        }

        console.log(`[idleFlow] Iniciando envío de reporte a ${groups.length} grupos virtuales...`);

        const fotoOVideoRaw = data["Foto o video"] || '';
        const debeEnviarMedia = /s[ií]+/i.test(fotoOVideoRaw);
        const lastImage = state.get('lastImage');
        const lastVideo = state.get('lastVideo');

        const groupProvider = getGroupProvider();
        const providersToTry = [];
        if (groupProvider) {
            providersToTry.push({ name: 'Baileys', instance: groupProvider });
        }
        if (provider) {
            const isDifferent = !groupProvider || (provider.constructor.name !== groupProvider.constructor.name);
            if (isDifferent) {
                providersToTry.push({ name: 'Meta WABA', instance: provider });
            }
        }

        if (providersToTry.length === 0 && provider) {
            providersToTry.push({ name: 'Default', instance: provider });
        }

        const fallbackProvider = groupProvider || provider;

        for (const group of groups) {
            if (group.jid) {
                for (const p of providersToTry) {
                    console.log(`[idleFlow] Grupo WhatsApp '${group.name}' (${group.jid}): enviando un solo reporte via ${p.name}...`);
                    try {
                        await sendTextToGroup(p.instance, group.jid, message);
                        
                        if (debeEnviarMedia) {
                            const vendor = p.instance?.vendor;
                            const isReady = !!(vendor?.authState?.creds?.me?.id || vendor?.user?.id);

                            if (lastImage && fs.existsSync(lastImage)) {
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                console.log(`[idleFlow] Enviando imagen a grupo WhatsApp '${group.name}' via ${p.name}...`);
                                if (vendor && isReady) {
                                    await vendor.sendMessage(group.jid, { image: fs.readFileSync(lastImage) });
                                } else if (typeof p.instance.sendImage === 'function') {
                                    await p.instance.sendImage(group.jid, lastImage, "");
                                } else {
                                    await p.instance.sendMessage(group.jid, "", { media: lastImage });
                                }
                            }
                            if (lastVideo && fs.existsSync(lastVideo)) {
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                console.log(`[idleFlow] Enviando video a grupo WhatsApp '${group.name}' via ${p.name}...`);
                                if (vendor && isReady) {
                                    await vendor.sendMessage(group.jid, { video: fs.readFileSync(lastVideo) });
                                } else if (typeof p.instance.sendVideo === 'function') {
                                    await p.instance.sendVideo(group.jid, lastVideo, "");
                                } else {
                                    await p.instance.sendMessage(group.jid, "", { media: lastVideo });
                                }
                            }
                        }
                    } catch (err: any) {
                        console.error(`❌ Error enviando reporte a grupo WhatsApp '${group.name}' (${group.jid}) via ${p.name}:`, err.message || err);
                    }
                }
            } else {
                // Fallback heredado: enviar de forma individual si el grupo no cuenta con un jid
                const contacts = group.contacts || [];
                console.log(`[idleFlow] Grupo Virtual '${group.name}' sin JID: enviando a ${contacts.length} contactos individualmente (fallback)...`);
                
                for (const contact of contacts) {
                    const phone = contact.phone ? contact.phone.replace(/[^0-9]/g, '') : '';
                    if (!phone) continue;
                    
                    const jid = `${phone}@s.whatsapp.net`;
                    
                    try {
                        console.log(`[idleFlow] Enviando reporte de texto (fallback) a ${contact.name || phone}...`);
                        await fallbackProvider.sendMessage(jid, message, {});
                        
                        if (debeEnviarMedia) {
                            if (lastImage && fs.existsSync(lastImage)) {
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                console.log(`[idleFlow] Enviando imagen (fallback) a ${phone}...`);
                                if (typeof fallbackProvider.sendImage === 'function') {
                                    await fallbackProvider.sendImage(jid, lastImage, "");
                                } else {
                                    await fallbackProvider.sendMessage(jid, "", { media: lastImage });
                                }
                            }
                            if (lastVideo && fs.existsSync(lastVideo)) {
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                console.log(`[idleFlow] Enviando video (fallback) a ${phone}...`);
                                if (typeof fallbackProvider.sendVideo === 'function') {
                                    await fallbackProvider.sendVideo(jid, lastVideo, "");
                                } else {
                                    await fallbackProvider.sendMessage(jid, "", { media: lastVideo });
                                }
                            }
                        }
                    } catch (err: any) {
                        console.error(`❌ Error de fallback enviando reporte virtual a ${phone} (${group.name}):`, err.message || err);
                    }
                }
            }
        }
    } catch (err: any) {
        console.error(`❌ Exception en dispatchVirtualGroupReports:`, err.message || err);
    }
}
*/

async function reportAndClose(
    tipo: string,
    resumen: string,
    data: any,
    ctx: any,
    state: any,
    provider: any,
    dynamicProjectId: string,
    ID_GRUPO_RESUMEN: string,
    ID_GRUPO_RESUMEN_2: string,
    sheetId: any,
    sheetRange: any
) {
    const userId = ctx.from;
    const targetGroup = (tipo === 'SI_RESUMEN_G2') ? ID_GRUPO_RESUMEN_2 : ID_GRUPO_RESUMEN;
    
    console.log(`[idleFlow] Procesando reporte y cierre para tipo: ${tipo} | Proyecto: ${dynamicProjectId}`);
    data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

    const resumenConLink = formatSummary(resumen, data, userId);

    if (tipo !== 'NO_REPORTAR_BAJA') {
        try {
            const groupProvider = getGroupProvider();
            const providerToSend = groupProvider || provider;
            console.log(`[idleFlow] Enviando resumen (${tipo}) via ${providerToSend.constructor.name} a ${targetGroup}`);

            await sendTextToGroup(providerToSend, targetGroup, resumenConLink);
            console.log(`✅ ${tipo}: Resumen enviado a ${targetGroup}`);

            await sendMediaToGroup(providerToSend, state, targetGroup, data, true);
        } catch (err: any) {
            console.error(`❌ ${tipo} Error en envío de reporte:`, err?.message || err);
        }

        // await dispatchVirtualGroupReports(dynamicProjectId, resumenConLink, state, provider, data);
    }

    await cleanUpMediaFiles(state);

    if (sheetId) {
        await addToSheet(data, sheetId ?? undefined, sheetRange ?? undefined);
    }

    // Resetear al asistente 1 al cerrar la conversación
    await HistoryHandler.setAssignedAgent(userId, 'asistente1', dynamicProjectId);
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
            const dynamicProjectId = state.get('dynamicProjectId') || process.env.RAILWAY_PROJECT_ID;

            // Fetch dynamic configs
            const ASSISTANT_ID = await HistoryHandler.getConfig('ASSISTANT_ID', dynamicProjectId) || '';
            const ID_GRUPO_RESUMEN = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN', dynamicProjectId) || '';
            const ID_GRUPO_RESUMEN_2 = await HistoryHandler.getConfig('ID_GRUPO_RESUMEN_2', dynamicProjectId) || '';
            const sheetId = await HistoryHandler.getConfig('SHEET_ID_RESUMEN', dynamicProjectId);
            const sheetRange = await HistoryHandler.getConfig('SHEET_RESUMEN_RANGE', dynamicProjectId);
            // const msjCierre = await HistoryHandler.getConfig('msjCierre', dynamicProjectId) || '';

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
            } catch (error: any) {
                console.warn("⚠️ El resumen no es JSON. Se extraerán los datos manualmente.");
                data = extraerDatosResumen(resumen);
            }

            // --- LÓGICA DE AUTOMATIZACIÓN DE NUEVO LEAD ---
            try {
                const cleanNombre = (data.Nombre || data.nombre || data.contactName || '').trim();
                const cleanEmail = (data.Correo || data.correo || data.Email || data.email || '').trim();
                const cleanSource = (data.Origen || data.origen || data.Source || data.source || 'Asistente AI').trim();
                
                // Extraer Estado y Etiquetas (o sinónimos)
                const cleanStatus = (data.Estado || data.estado || data.Status || data.status || '').trim();
                const rawTags = (data.Etiqueta || data.etiqueta || data.Etiquetas || data.etiquetas || data.Tag || data.tag || data.Tags || data.tags || '').trim();
                const tagsList = rawTags ? rawTags.split(',').map(t => t.trim()).filter(t => t !== '' && t !== '-') : [];

                // 1. Actualizar detalles del contacto en el CRM
                if (cleanNombre || cleanEmail || resumen || cleanStatus || tagsList.length > 0) {
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
                    if (cleanNombre && cleanNombre !== '-') updateData.name = cleanNombre;
                    if (cleanEmail && cleanEmail !== '-') updateData.email = cleanEmail;
                    if (cleanSource && cleanSource !== '-') updateData.source = cleanSource;
                    if (cleanStatus && cleanStatus !== '-') {
                        updateData.crm_status = await HistoryHandler.mapStatusToId(cleanStatus, dynamicProjectId);
                    }

                    const updateResult = await HistoryHandler.updateContactDetails(userId, updateData, dynamicProjectId);
                    
                    if (!updateResult.success) {
                        console.error(`❌ Error actualizando contacto en CRM:`, updateResult.error);
                            } else {
                        console.log(`✅ CRM Actualizado para ${userId} | Proyecto: ${dynamicProjectId}`);
                        
                        // 1.1 Asignar etiquetas si existen
                        if (tagsList.length > 0) {
                            await HistoryHandler.assignTagsToContact(userId, tagsList, dynamicProjectId);
                        }
                    }
                }

            } catch (leadError: any) {
                console.error("❌ Error en automatización de Nuevo Lead:", leadError.message);
            }
            // ----------------------------------------------

            // Log para depuración del valor real de tipo
            console.log('Valor de tipo:', JSON.stringify(data.tipo), '| Longitud:', data.tipo?.length);
            // Limpieza robusta de caracteres invisibles y espacios, preservando números y guiones bajos
            const tipo = (data.tipo ?? '').replace(/[^A-Z0-9_]/gi, '').toUpperCase();

            if (tipo === 'NO_REPORTAR_BAJA') {
                console.log('NO_REPORTAR_BAJA: No se realiza seguimiento ni se envía resumen al grupo.');
                await reportAndClose('NO_REPORTAR_BAJA', resumen, data, ctx, state, provider, dynamicProjectId, ID_GRUPO_RESUMEN, ID_GRUPO_RESUMEN_2, sheetId, sheetRange);
                return endFlow();
            } else if (tipo === 'NO_REPORTAR_SEGUIR') {
                console.log('NO_REPORTAR_SEGUIR: Se realiza seguimiento, pero no se envía resumen al grupo.');
                
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;
                if (sheetId) {
                    await addToSheet(data, sheetId ?? undefined, sheetRange ?? undefined);
                }

                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    flowDynamic,
                    gotoFlow,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        if (newData && (newData as any).userResponded) {
                            console.log(`[idleFlow] El usuario respondió al seguimiento. Dejando que el bot lo procese naturalmente.`);
                            return;
                        }
                        if (newData && (newData as any).resumenRaw) {
                            console.log(`[idleFlow] Seguimiento finalizado con resumen. Reportando y cerrando...`);
                            const finalTipo = ((newData as any).tipo ?? '').replace(/[^A-Z0-9_]/gi, '').toUpperCase() || 'SI_RESUMEN';
                            await reportAndClose(
                                finalTipo,
                                (newData as any).resumenRaw,
                                newData,
                                ctx,
                                state,
                                provider,
                                dynamicProjectId,
                                ID_GRUPO_RESUMEN,
                                ID_GRUPO_RESUMEN_2,
                                sheetId,
                                sheetRange
                            );
                        }
                    },
                    onFail: async () => {
                        console.log('NO_REPORTAR_SEGUIR: No se obtuvo respuesta luego del seguimiento. Reseteando agente...');
                        await HistoryHandler.setAssignedAgent(userId, 'asistente1', dynamicProjectId);
                    }
                });
                return await reconFlow.start();

            } else if (tipo === 'SI_REPORTAR_SEGUIR') {
                console.log('SI_REPORTAR_SEGUIR: Se envía resumen al grupo y se realiza seguimiento.');
                data.linkWS = `https://wa.me/${ctx.from.replace(/[^0-9]/g, '')}`;

                const resumenConLink = formatSummary(resumen, data, userId);

                try {
                    const groupProvider = getGroupProvider();
                    const providerToSend = groupProvider || provider;
                    console.log(`[idleFlow] Enviando resumen (SI_REPORTAR_SEGUIR) via ${providerToSend.constructor.name} a ${ID_GRUPO_RESUMEN}`);
                    
                    await sendTextToGroup(providerToSend, ID_GRUPO_RESUMEN, resumenConLink);
                    console.log(`✅ SI_REPORTAR_SEGUIR: Resumen enviado a ${ID_GRUPO_RESUMEN}`);
                    await sendMediaToGroup(providerToSend, state, ID_GRUPO_RESUMEN, data, true);

                } catch (err: any) {
                    console.error(`❌ SI_REPORTAR_SEGUIR Error:`, err?.message || err);
                }

                // await dispatchVirtualGroupReports(dynamicProjectId, resumenConLink, state, provider, data);
                await cleanUpMediaFiles(state);

                if (sheetId) {
                    await addToSheet(data, sheetId ?? undefined, sheetRange ?? undefined);
                }

                const reconFlow = new ReconectionFlow({
                    ctx,
                    state,
                    provider,
                    flowDynamic,
                    gotoFlow,
                    maxAttempts: 3,
                    onSuccess: async (newData) => {
                        if (newData && (newData as any).userResponded) {
                            console.log(`[idleFlow] El usuario respondió al seguimiento. Dejando que el bot lo procese naturalmente.`);
                            return;
                        }
                        if (newData && (newData as any).resumenRaw) {
                            console.log(`[idleFlow] Seguimiento finalizado con resumen. Reportando y cerrando...`);
                            const finalTipo = ((newData as any).tipo ?? '').replace(/[^A-Z0-9_]/gi, '').toUpperCase() || 'SI_RESUMEN';
                            await reportAndClose(
                                finalTipo,
                                (newData as any).resumenRaw,
                                newData,
                                ctx,
                                state,
                                provider,
                                dynamicProjectId,
                                ID_GRUPO_RESUMEN,
                                ID_GRUPO_RESUMEN_2,
                                sheetId,
                                sheetRange
                            );
                        }
                    },
                    onFail: async () => {
                        console.log('SI_REPORTAR_SEGUIR: No se obtuvo respuesta luego del seguimiento. Reseteando agente...');
                        await HistoryHandler.setAssignedAgent(userId, 'asistente1', dynamicProjectId);
                    }
                });
                return await reconFlow.start();

            } else if (tipo === 'SI_RESUMEN_G2') {
                await reportAndClose('SI_RESUMEN_G2', resumen, data, ctx, state, provider, dynamicProjectId, ID_GRUPO_RESUMEN, ID_GRUPO_RESUMEN_2, sheetId, sheetRange);
                return;

            } else if (tipo === 'SI_RESUMEN') {
                await reportAndClose('SI_RESUMEN', resumen, data, ctx, state, provider, dynamicProjectId, ID_GRUPO_RESUMEN, ID_GRUPO_RESUMEN_2, sheetId, sheetRange);
                return;

            } else {
                await reportAndClose('DEFAULT', resumen, data, ctx, state, provider, dynamicProjectId, ID_GRUPO_RESUMEN, ID_GRUPO_RESUMEN_2, sheetId, sheetRange);
                return;
            }
        } catch (error: any) {
            console.error("Error al obtener el resumen de OpenAI:", error);
            // Asegurar reset incluso en error
            const userId = ctx.from;
            const dynamicProjectId = state.get('dynamicProjectId') || process.env.RAILWAY_PROJECT_ID;
            await HistoryHandler.setAssignedAgent(userId, 'asistente1', dynamicProjectId);
            return endFlow();
        }
    });

export { idleFlow };