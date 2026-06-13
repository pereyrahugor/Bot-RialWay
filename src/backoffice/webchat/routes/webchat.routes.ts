import path from 'path';
import fs from 'fs';
import { backofficeAuth } from "../../middleware/auth";

export const registerWebchatRoutes = (app: any, {
    webChatManager,
    openaiVision,
    aiManager,
    safeToAsk,
    AssistantResponseProcessor,
    transcribeAudioFile,
    withRetry
}: any) => {

    app.post('/webchat-api', async (req: any, res: any) => {
        if (!req.body || (!req.body.message && !req.body.file)) {
            return res.status(400).json({ error: "Falta 'message' o 'file'" });
        }
        try {
            let message = req.body.message || "";
            let ip = '';
            const xff = req.headers['x-forwarded-for'];
            if (typeof xff === 'string') {
                ip = xff.split(',')[0].trim();
            } else if (Array.isArray(xff) && xff.length > 0) {
                ip = xff[0].trim();
            } else {
                ip = (req as any).ip || req.socket?.remoteAddress || (req as any).connection?.remoteAddress || '127.0.0.1';
            }
            // Normalizar IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1)
            ip = ip.replace(/^::ffff:/, '');
            if (!ip) ip = '127.0.0.1';

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

                        if (!openaiVision) {
                            console.warn("⚠️ IA Vision Desactivada: Saltando análisis de imagen en webchat.");
                            message = `[Imagen recibida (Sin procesar)]: \n${message}`;
                        } else {
                            const { HistoryHandler } = await import("../../db/historyHandler");
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

            const { HistoryHandler } = await import("../../db/historyHandler");
            const session = webChatManager.getSession(ip);
            let replyText = '';

            if (message.trim().toLowerCase() === "#reset") {
                session.clear();
                replyText = "🔄 Chat reiniciado.";
            } else {
                session.addUserMessage(message);

                // Guardar mensaje del usuario en el historial persistente (Backoffice)
                await HistoryHandler.saveMessage(
                    ip,
                    'user',
                    message,
                    'text',
                    'Webchat User',
                    ip,
                    null,
                    'whatsapp'
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

                const projectId = process.env.RAILWAY_PROJECT_ID || '';
                const assigned = await HistoryHandler.getAssignedAgent(ip, projectId) || 'asistente1';
                const assistantMap = await aiManager.getAssistantMap(projectId);
                const currentAssistantId = await aiManager.getAssignedAssistantId(ip, projectId);
                
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
                    // COMANDO RESET
                    if (msg.toLowerCase() === '#reset#') {
                        console.log(`[Webchat] 🔄 Reset solicitado para: ${uid}`);
                        await state.update({ thread_id: null });
                        await HistoryHandler.saveThreadId(uid, ''); // Limpiar en DB
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
                            agentName
                        );
                        return response;
                    } catch (e) {
                        console.error(e);
                        return null;
                    }
                };

                const reply = await safeToAsk(currentAssistantId, message, state, ip, undefined, 5, true, projectId, true, assigned);

                const flowDynamic = async (arr: any) => {
                    const text = Array.isArray(arr) ? arr.map(a => a.body).join('\n') : arr;
                    replyText = replyText ? replyText + "\n\n" + text : text;
                };

                await AssistantResponseProcessor.procesarHandoverYDerivacion(
                    reply,
                    { type: 'webchat', from: ip, thread_id: session.thread_id, body: message },
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
            }
            res.json({ reply: replyText });
        } catch (err) {
            console.error('[Error Webchat API] check failed:', err);
            res.status(500).json({ reply: 'Error interno.' });
        }
    });

};
