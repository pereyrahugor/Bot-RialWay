import path from 'path';
import fs from 'fs';
import { withRetry } from "../../utils/retryHelper";
import { safeToAsk } from "../../apis/openai/openaiHelper";
import { AssistantResponseProcessor } from "../../apis/openai/AssistantResponseProcessor";
import { transcribeAudioFile } from "../../apis/openai/audioTranscriptior";

import { backofficeAuth } from "../../backoffice/middleware/auth";

/**
 * Registra las rutas de Webchat en la instancia de Polka.
 */
export const registerWebchatRoutes = (app: any, { 
    webChatManager, 
    openaiVision, 
    aiManager 
}: any) => {

    app.post('/webchat-api', async (req: any, res: any) => {
        if (!req.body || (!req.body.message && !req.body.file)) {
            return res.status(400).json({ error: "Falta 'message' o 'file'" });
        }
        try {
            let message = req.body.message || "";
            let ip = '';
            const xff = req.headers['x-forwarded-for'];
            if (typeof xff === 'string') ip = xff.split(',')[0];
            else ip = req.ip || '';

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
                            const visionResponse = await withRetry(async () => {
                                return await openaiVision.chat.completions.create({
                                    model: "gpt-4o",
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
                    ip
                );

                // Estado compatible con safeToAsk
                const state = {
                    get: (key: string) => {
                        if (key === 'thread_id') return session.thread_id;
                        return undefined;
                    },
                    update: async (data: any) => {
                        if (data.thread_id) {
                            session.thread_id = data.thread_id;
                        }
                    },
                    clear: async () => session.clear(),
                };

                const currentAssistantId = await aiManager.getAssignedAssistantId(ip);
                
                // Función adaptadora para recursión en AssistantResponseProcessor
                const webChatAdapterFn = async (asId: string, msg: string, st: any, _fb: any, uid: any, _tid?: string, forceDb = false) => {
                    // COMANDO RESET
                    if (msg.toLowerCase() === '#reset#') {
                        console.log(`[Webchat] 🔄 Reset solicitado para: ${uid}`);
                        await state.update({ thread_id: null });
                        await HistoryHandler.saveThreadId(uid, ''); // Limpiar en DB
                        return res.json({ response: "🔄 Sesión reiniciada. ¿En qué puedo ayudarte?" });
                    }

                    try {
                        console.log(`[Webchat] 📨 Enviando a safeToAsk. Project: ${process.env.RAILWAY_PROJECT_ID}`);
                        const response = await safeToAsk(
                            asId, 
                            msg, 
                            st, 
                            uid, 
                            undefined, 
                            5, 
                            forceDb, 
                            process.env.RAILWAY_PROJECT_ID,
                            true
                        );
                        return response;
                    } catch (e) {
                        console.error(e);
                        return null;
                    }
                };

                const reply = await safeToAsk(currentAssistantId, message, state, ip, undefined, 5, true, process.env.RAILWAY_PROJECT_ID, true);

                const flowDynamic = async (arr: any) => {
                    const text = Array.isArray(arr) ? arr.map(a => a.body).join('\n') : arr;
                    replyText = replyText ? replyText + "\n\n" + text : text;
                };

                await AssistantResponseProcessor.analizarYProcesarRespuestaAsistente(
                    reply,
                    { type: 'webchat', from: ip, thread_id: session.thread_id, body: message },
                    flowDynamic,
                    state,
                    undefined,
                    () => {},
                    webChatAdapterFn,
                    currentAssistantId
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
