import path from 'path';
import fs from 'fs';
import { backofficeAuth } from "../../middleware/auth";
import { WebChatManager } from "../WebChatManager";
import { aiManagerInstance } from "../../../../app";
import { getOpenAIVision, safeToAsk } from "../../../apis/openai/openaiHelper";
import { AssistantResponseProcessor } from "../../../apis/openai/AssistantResponseProcessor";
import { transcribeAudioFile } from "../../../apis/openai/audioTranscriptior";
import { withRetry } from "../../../utils/retryHelper";
import { isApiKeyCommand, isAuthorizedApiKeyRequester, containsApiKeyCommand } from "../../../utils/authCommands";

const webChatManager = new WebChatManager();

function getWebchatClientKey(req: any): string {
    let ip = '';
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
        ip = xff.split(',')[0].trim();
    } else if (Array.isArray(xff) && xff.length > 0) {
        ip = xff[0].trim();
    } else {
        ip = (req as any).ip || req.socket?.remoteAddress || (req as any).connection?.remoteAddress || '127.0.0.1';
    }
    ip = ip.replace(/^::ffff:/, '');
    return ip || '127.0.0.1';
}

function getWebchatClientIdentifier(req: any): string {
    const rawClientId = req.body?.clientId || req.query?.clientId;
    if (rawClientId && typeof rawClientId === 'string' && rawClientId.trim() !== '') {
        return rawClientId.trim();
    }
    return getWebchatClientKey(req);
}

export const registerWebchatRoutes = (app: any) => {

    app.post('/webchat-api/command', backofficeAuth, async (req: any, res: any) => {
        const command = String(req.body?.command || '').trim().toUpperCase();
        const clientKey = getWebchatClientIdentifier(req);

        try {
            const { HistoryHandler } = await import("../../../db/historyHandler");
            const projectId = String(req.body?.projectId || req.query?.projectId || process.env.RAILWAY_PROJECT_ID || HistoryHandler.PROJECT_IDENTIFIER || '').trim();
            const serviceId = String(req.body?.serviceId || req.query?.serviceId || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER || '').trim();
            const session = webChatManager.getSession(clientKey);

            if (command === 'RESET' || command === '#RESET#' || command === '#RESET') {
                session.thread_id = null;
                await HistoryHandler.setAssignedAgent(clientKey, 'asistente1', projectId, serviceId || undefined);
                await HistoryHandler.saveThreadId(clientKey, '', projectId, serviceId || undefined);
                return res.json({ success: true, command: 'RESET', message: 'Reset aplicado solo al webchat.' });
            }

            if (command === 'HILO_NUEVO' || command === '#HILO_NUEVO#' || command === '#HILO_NUEVO') {
                session.clear();
                await HistoryHandler.clearChatHistory(clientKey, projectId, serviceId || undefined);
                await HistoryHandler.setAssignedAgent(clientKey, 'asistente1', projectId, serviceId || undefined);
                await HistoryHandler.saveThreadId(clientKey, '', projectId, serviceId || undefined);
                return res.json({ success: true, command: 'HILO_NUEVO', clearChat: true, message: 'Hilo nuevo iniciado solo para el webchat.' });
            }

            if (command === 'CLEAR_CONTEXT' || command === '#CLEAR_CONTEXT#' || command === '#CLEAR_CONTEXT' || command === '#ELIMINAR_CONTEXTO#' || command === 'ELIMINAR_CONTEXTO') {
                session.thread_id = null;
                const keys = Object.keys(session);
                for (const k of keys) {
                    if (k !== 'history' && k !== 'thread_id') {
                        delete session[k];
                    }
                }
                await HistoryHandler.clearClientContext(clientKey, projectId, serviceId || undefined);
                await HistoryHandler.saveThreadId(clientKey, '', projectId, serviceId || undefined);
                return res.json({ success: true, command: 'CLEAR_CONTEXT', message: 'Contexto de cliente eliminado de la sesión del webchat.' });
            }

            if (isApiKeyCommand(command)) {
                const code = req.body?.code || req.body?.phone || req.body?.verificationCode;
                if (code && isAuthorizedApiKeyRequester(code)) {
                    const apiKey = await HistoryHandler.getProjectApiKey(projectId, serviceId || undefined);
                    return res.json({ success: true, command: 'API_KEY', apiKey, message: `El API_KEY de la instancia consultada es:\n${apiKey}` });
                }
                const session = webChatManager.getSession(clientKey);
                session.awaitingApiKeyVerification = true;
                session.apiKeyVerificationRequestedAt = Date.now();
                return res.json({
                    success: false,
                    requiresVerification: true,
                    message: "🔒 Para consultar el API_KEY desde el webchat, por favor ingresa el código de verificación"
                });
            }

            return res.status(400).json({ success: false, error: 'Comando no soportado para webchat.' });
        } catch (err: any) {
            console.error('[Webchat Command] Error:', err.message);
            return res.status(500).json({ success: false, error: err.message || 'No se pudo ejecutar el comando.' });
        }
    });

    app.get('/webchat-api/history', backofficeAuth, async (req: any, res: any) => {
        const clientKey = getWebchatClientIdentifier(req);
        try {
            const session = webChatManager.getSession(clientKey);
            return res.json({ success: true, history: session.history });
        } catch (err: any) {
            console.error('[Webchat History] Error:', err.message);
            return res.status(500).json({ success: false, error: 'No se pudo obtener el historial.' });
        }
    });

    app.post('/webchat-api', async (req: any, res: any) => {
        if (!req.body || (!req.body.message && !req.body.file)) {
            return res.status(400).json({ error: "Falta 'message' o 'file'" });
        }
        try {
            let message = req.body.message || "";
            const clientKey = getWebchatClientIdentifier(req);

            if (req.body.file) {
                const file = req.body.file;
                const mimetype = file.mime || '';
                const base64Data = file.base64;
                const ext = mimetype.split('/')[1] || 'bin';
                
                try {
                    const buffer = Buffer.from(base64Data, 'base64');
                    
                    if (mimetype.startsWith('image/')) {
                        const localDir = path.join("./tmp/");
                        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
                        const localPath = path.join(localDir, Date.now() + "." + ext);
                        fs.writeFileSync(localPath, buffer);

                        const openaiVision = await getOpenAIVision().catch(() => null);
                        if (!openaiVision) {
                            console.warn("⚠️ IA Vision Desactivada: Saltando análisis de imagen en webchat.");
                            message = `[Imagen recibida (Sin procesar)]: \n${message}`;
                        } else {
                            const { HistoryHandler } = await import("../../../db/historyHandler");
                            let visionModel = await HistoryHandler.getConfig('OPENAI_MODEL') || "gpt-4o-mini";
                            if (visionModel.startsWith('o1') || visionModel.startsWith('o3')) {
                                visionModel = "gpt-4o-mini";
                            }

                            const visionResponse = await withRetry(async () => {
                                return await openaiVision.chat.completions.create({
                                    model: visionModel,
                                    messages: [{
                                        role: "user",
                                        content: [
                                            { type: "text", text: "Describe esta imagen detalladamente..." },
                                            { type: "image_url", image_url: { url: `data:${mimetype};base64,${base64Data}` } }
                                        ]
                                    }]
                                });
                            }, { maxRetries: 3 });
                            
                            const result = visionResponse.choices?.[0]?.message?.content || "No se pudo obtener una descripción.";
                            message = `[Imagen recibida]: ${result} \n${message}`;
                        }

                    } else if (mimetype.startsWith('audio/') || mimetype.startsWith('video/')) {
                        const localDir = path.join("./tmp/voiceNote/");
                        if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
                        const localPath = path.join(localDir, Date.now() + "." + ext);
                        fs.writeFileSync(localPath, buffer);

                        try {
                            const transcription = await transcribeAudioFile(localPath);
                            message = `[Audio/Video transcrito]: ${transcription} \n${message}`;
                        } catch (err) {
                            message = `[Error] No se pudo procesar el audio/video. \n${message}`;
                        }
                    } else {
                        message = `[Archivo adjunto] ${file.name} \n${message}`;
                    }
                } catch (e) {
                    message = `[Error al procesar archivo adjunto] \n${message}`;
                }
            }

            const { HistoryHandler } = await import("../../../db/historyHandler");
            const session = webChatManager.getSession(clientKey);
            const projectId = String(req.body?.projectId || req.query?.projectId || process.env.RAILWAY_PROJECT_ID || HistoryHandler.PROJECT_IDENTIFIER || '').trim();
            const serviceId = String(req.body?.serviceId || req.query?.serviceId || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER || '').trim();
            let replyText = '';

            const normalizedCmd = message.trim().toUpperCase();

            // --- ESTADO: VERIFICACIÓN PENDIENTE DE CÓDIGO PARA API_KEY EN WEBCHAT ---
            if (session.awaitingApiKeyVerification) {
                const isExpired = !session.apiKeyVerificationRequestedAt || (Date.now() - session.apiKeyVerificationRequestedAt > 5 * 60 * 1000);
                if (isExpired) {
                    session.awaitingApiKeyVerification = false;
                } else {
                    const trimmedMsg = message.trim();
                    if (trimmedMsg.toLowerCase() === 'cancelar' || trimmedMsg.toLowerCase() === 'salir') {
                        session.awaitingApiKeyVerification = false;
                        const replyMsg = "Solicitud de API_KEY cancelada.";
                        session.addUserMessage(message);
                        session.addAssistantMessage(replyMsg);
                        await HistoryHandler.saveMessage(clientKey, 'user', message, 'text', 'Supervisor', clientKey, null, 'webchat', projectId, serviceId || undefined);
                        await HistoryHandler.saveMessage(clientKey, 'assistant', replyMsg, 'text', null, null, null, 'webchat', projectId, serviceId || undefined);
                        return res.json({ reply: replyMsg });
                    }

                    if (isAuthorizedApiKeyRequester(trimmedMsg)) {
                        session.awaitingApiKeyVerification = false;
                        const apiKey = await HistoryHandler.getProjectApiKey(projectId, serviceId || undefined);
                        const replyMsg = `El API_KEY de la instancia consultada es:\n${apiKey}`;
                        session.addUserMessage(message);
                        session.addAssistantMessage(replyMsg);
                        await HistoryHandler.saveMessage(clientKey, 'user', message, 'text', 'Supervisor', clientKey, null, 'webchat', projectId, serviceId || undefined);
                        await HistoryHandler.saveMessage(clientKey, 'assistant', replyMsg, 'text', null, null, null, 'webchat', projectId, serviceId || undefined);
                        return res.json({ reply: replyMsg });
                    } else {
                        session.awaitingApiKeyVerification = false;
                        const replyMsg = "❌ Código de verificación no autorizado. Solicitud de API_KEY cancelada.";
                        session.addUserMessage(message);
                        session.addAssistantMessage(replyMsg);
                        await HistoryHandler.saveMessage(clientKey, 'user', message, 'text', 'Supervisor', clientKey, null, 'webchat', projectId, serviceId || undefined);
                        await HistoryHandler.saveMessage(clientKey, 'assistant', replyMsg, 'text', null, null, null, 'webchat', projectId, serviceId || undefined);
                        return res.json({ reply: replyMsg });
                    }
                }
            }

            // --- INTERCEPTAR COMANDO API_KEY EN EL TEXTO DEL WEBCHAT ---
            if (isApiKeyCommand(message) || containsApiKeyCommand(message)) {
                // Si el usuario ya adjuntó el teléfono autorizado en el mismo mensaje (ej: #API_KEY# +5491130792789)
                if (isAuthorizedApiKeyRequester(message)) {
                    session.awaitingApiKeyVerification = false;
                    const apiKey = await HistoryHandler.getProjectApiKey(projectId, serviceId || undefined);
                    const replyMsg = `El API_KEY de la instancia consultada es:\n${apiKey}`;
                    session.addUserMessage(message);
                    session.addAssistantMessage(replyMsg);
                    await HistoryHandler.saveMessage(clientKey, 'user', message, 'text', 'Supervisor', clientKey, null, 'webchat', projectId, serviceId || undefined);
                    await HistoryHandler.saveMessage(clientKey, 'assistant', replyMsg, 'text', null, null, null, 'webchat', projectId, serviceId || undefined);
                    return res.json({ reply: replyMsg });
                }

                // Al recibirse desde webchat (conexión por IP / sin teléfono de origen), solicitar código de verificación
                session.awaitingApiKeyVerification = true;
                session.apiKeyVerificationRequestedAt = Date.now();
                const replyMsg = "🔒 Para consultar el API_KEY desde el webchat, por favor ingresa el código de verificación";
                session.addUserMessage(message);
                session.addAssistantMessage(replyMsg);
                await HistoryHandler.saveMessage(clientKey, 'user', message, 'text', 'Supervisor', clientKey, null, 'webchat', projectId, serviceId || undefined);
                await HistoryHandler.saveMessage(clientKey, 'assistant', replyMsg, 'text', null, null, null, 'webchat', projectId, serviceId || undefined);
                return res.json({ reply: replyMsg });
            }

            if (normalizedCmd === "#RESET#" || normalizedCmd === "#RESET") {
                session.thread_id = null;
                await HistoryHandler.setAssignedAgent(clientKey, 'asistente1', projectId, serviceId || undefined);
                await HistoryHandler.saveThreadId(clientKey, '', projectId, serviceId || undefined);
                return res.json({ reply: "🔄 Sesión y asistente reiniciados para este webchat." });
            }

            if (normalizedCmd === "#HILO_NUEVO#" || normalizedCmd === "#HILO_NUEVO") {
                session.clear();
                await HistoryHandler.clearChatHistory(clientKey, projectId, serviceId || undefined);
                await HistoryHandler.setAssignedAgent(clientKey, 'asistente1', projectId, serviceId || undefined);
                await HistoryHandler.saveThreadId(clientKey, '', projectId, serviceId || undefined);
                return res.json({ reply: "✅ Historial de conversación borrado y nuevo hilo iniciado." });
            }

            if (normalizedCmd === "#CLEAR_CONTEXT#" || normalizedCmd === "#CLEAR_CONTEXT" || normalizedCmd === "#ELIMINAR_CONTEXTO#" || normalizedCmd === "#ELIMINAR_CONTEXTO") {
                session.thread_id = null;
                const keys = Object.keys(session);
                for (const k of keys) {
                    if (k !== 'history' && k !== 'thread_id') {
                        delete session[k];
                    }
                }
                await HistoryHandler.clearClientContext(clientKey, projectId, serviceId || undefined);
                await HistoryHandler.saveThreadId(clientKey, '', projectId, serviceId || undefined);
                return res.json({ reply: "🧹 Contexto de cliente y memoria eliminados de esta sesión." });
            }

            if (normalizedCmd === "#ACTUALIZAR#" || normalizedCmd === "#ACTUALIZAR") {
                try {
                    const { updateMain } = await import("../../../apis/google/updateMain");
                    const { syncAssistantTools } = await import("../../../apis/openai/openaiHelper");
                    await updateMain(projectId, serviceId);
                    const assigned = (await HistoryHandler.getAssignedAgent(clientKey, projectId, serviceId || undefined)) as string || 'asistente1';
                    const currentAssistantMap = await aiManagerInstance.getAssistantMap(projectId, serviceId || undefined);
                    const currentAssistantId = currentAssistantMap[assigned] || aiManagerInstance.assistantId;
                    if (currentAssistantId) {
                        await syncAssistantTools(currentAssistantId, projectId, serviceId || undefined);
                    }
                    return res.json({ reply: "🔄 Sincronización completada: Google Sheets, RAG y OpenAI Tools actualizados." });
                } catch (err: any) {
                    console.error("[Webchat] Error en #ACTUALIZAR#:", err.message);
                    return res.json({ reply: `❌ Error al sincronizar: ${err.message}` });
                }
            }

            if (normalizedCmd === "#ON#" || normalizedCmd === "#ON") {
                await HistoryHandler.toggleBot(clientKey, true, projectId, serviceId || undefined);
                return res.json({ reply: "🤖 Bot activado para este chat." });
            }

            if (normalizedCmd === "#OFF#" || normalizedCmd === "#OFF") {
                await HistoryHandler.toggleBot(clientKey, false, projectId, serviceId || undefined);
                return res.json({ reply: "🛑 Bot desactivado." });
            }

            if (normalizedCmd === "#FULL_ON#" || normalizedCmd === "#FULL_ON") {
                await HistoryHandler.saveSetting('GLOBAL_BOT_ENABLED', 'true', projectId, serviceId || undefined);
                return res.json({ reply: "🤖 Bot activado GLOBALMENTE." });
            }

            if (normalizedCmd === "#FULL_OFF#" || normalizedCmd === "#FULL_OFF") {
                await HistoryHandler.saveSetting('GLOBAL_BOT_ENABLED', 'false', projectId, serviceId || undefined);
                return res.json({ reply: "🛑 Bot desactivado GLOBALMENTE." });
            }

            session.addUserMessage(message);

            // Guardar mensaje del usuario en el historial persistente (Backoffice)
            await HistoryHandler.saveMessage(
                clientKey,
                'user',
                message,
                'text',
                'Webchat User',
                clientKey,
                null,
                'whatsapp',
                projectId,
                serviceId || undefined
            );

            // Estado compatible con safeToAsk
            const state = {
                get: (key: string) => {
                    if (key === 'thread_id') return session.thread_id;
                    return (session as any)[key];
                },
                update: async (data: any) => {
                    for (const k of Object.keys(data)) {
                        if (k === 'thread_id') {
                            session.thread_id = data.thread_id;
                        } else {
                            (session as any)[k] = data[k];
                        }
                    }
                },
                clear: async () => session.clear(),
            };

            const assigned: string = (await HistoryHandler.getAssignedAgent(clientKey, projectId, serviceId || undefined)) as string || 'asistente1';
            const assistantMap = await aiManagerInstance.getAssistantMap(projectId, serviceId || undefined);
            const currentAssistantId = await aiManagerInstance.getAssignedAssistantId(clientKey, projectId, serviceId || undefined);
            
            // Función adaptadora para recursión en AssistantResponseProcessor
            const webChatAdapterFn = async (
                asId: string,
                msg: string,
                st: any,
                _fb: any,
                uid: any,
                _tid?: string,
                projId?: string,
                agentName?: string
            ) => {
                const innerCmd = msg.trim().toUpperCase();
                // COMANDO RESET EN ADAPTADOR
                if (innerCmd === '#RESET#' || innerCmd === '#RESET') {
                    console.log(`[Webchat] 🔄 Reset solicitado para: ${uid}`);
                    await state.update({ thread_id: null });
                    session.thread_id = null;
                    await HistoryHandler.saveThreadId(uid, '', projId || projectId, serviceId || undefined);
                    return res.json({ response: "🔄 Sesión reiniciada. ¿En qué puedo ayudarte?" });
                }

                try {
                    console.log(`[Webchat] 📨 Enviando a safeToAsk. Project: ${projId || projectId}`);
                    const response = await safeToAsk(
                        asId, 
                        msg, 
                        st, 
                        uid, 
                        undefined, 
                        5, 
                        true, 
                        projId || projectId,
                        true,
                        agentName,
                        serviceId || undefined
                    );
                    return response;
                } catch (e) {
                    console.error(e);
                    return null;
                }
            };

            const flowDynamic = async (arr: any) => {
                if (Array.isArray(arr)) {
                    for (const a of arr) {
                        const img = a.mediaUrl || (typeof a.media === 'string' && a.media.startsWith('http') ? a.media : null);
                        const caption = a.body ? a.body.trim() : '';
                        const formatted = img ? `![Imagen](${img})\n\n${caption}`.trim() : caption;
                        if (formatted) {
                            replyText = replyText ? replyText + "\n\n" + formatted : formatted;
                        }
                    }
                } else if (typeof arr === 'string' && arr.trim()) {
                    replyText = replyText ? replyText + "\n\n" + arr.trim() : arr.trim();
                }
            };

            const reply = await safeToAsk(
                currentAssistantId, 
                message, 
                state, 
                clientKey, 
                undefined, 
                5, 
                true, 
                projectId, 
                true, 
                assigned, 
                serviceId || undefined,
                { flowDynamic, ctx: { type: 'webchat', from: clientKey }, isWebchat: true }
            );

            await AssistantResponseProcessor.procesarHandoverYDerivacion(
                reply as string,
                { type: 'webchat', from: clientKey, thread_id: session.thread_id, body: message },
                flowDynamic,
                state,
                undefined,
                () => {},
                webChatAdapterFn,
                currentAssistantId,
                assigned,
                assistantMap,
                projectId
            );
            session.addAssistantMessage(replyText);

            res.json({ reply: replyText });
        } catch (err) {
            console.error('[Error Webchat API] check failed:', err);
            res.status(500).json({ reply: 'Error interno.' });
        }
    });

};
