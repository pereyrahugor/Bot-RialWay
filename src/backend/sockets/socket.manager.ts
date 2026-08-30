import { Server } from 'socket.io';
import { historyEvents, HistoryHandler } from '../db/historyHandler';

/**
 * Inicializa Socket.IO y configura los eventos globales y de conexión.
 */
export const initSocketIO = (serverInstance: any, { processUserMessage }: any) => {
    try {
        if (!serverInstance) {
            console.error('❌ [Socket.IO] No se pudo obtener serverInstance.');
            return;
        }

        console.log('📡 [INFO] Inicializando Socket.IO en el servidor principal...');
        const io = new Server(serverInstance, { 
            cors: { origin: '*' },
            allowEIO3: true
        });

        // Escuchar eventos de la base de datos (HistoryHandler) y retransmitir a Web con segregación de sala
        historyEvents.on('new_message', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('new_message', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('new_message', payload);
            }
        });

        historyEvents.on('message_deleted', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('message_deleted', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('message_deleted', payload);
            }
        });

        historyEvents.on('bot_toggled', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('bot_toggled', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('bot_toggled', payload);
            }
        });

        historyEvents.on('contact_updated', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('contact_updated', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('contact_updated', payload);
            }
        });

        historyEvents.on('chat_updated', (payload) => {
            io.emit('chat_updated', payload);
        });

        historyEvents.on('ticket_updated', (payload) => {
            const ticket = payload.ticket || payload;
            const projId = ticket.project_id || ticket.projectId || payload.projectId;
            const servId = ticket.service_id || ticket.serviceId || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('ticket_updated', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('ticket_updated', payload);
            }
        });

        historyEvents.on('ticket_deleted', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('ticket_deleted', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('ticket_deleted', payload);
            }
        });

        historyEvents.on('setting_changed', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('setting_changed', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('setting_changed', payload);
            }
        });

        historyEvents.on('whatsapp_line_changed', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('whatsapp_line_changed', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('whatsapp_line_changed', payload);
            } else {
                io.emit('whatsapp_line_changed', payload);
            }
        });

        historyEvents.on('reporte_created', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId || (payload.reporte && payload.reporte.service_id);
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('reporte_created', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('reporte_created', payload);
            }
        });

        historyEvents.on('message_status_update', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('message_status_update', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('message_status_update', payload);
            }
        });

        historyEvents.on('user_updated', (payload) => {
            const projId = payload.project_id || payload.projectId;
            const servId = payload.service_id || payload.serviceId;
            if (projId && servId) {
                io.to(`${projId}:${servId}`).emit('user_updated', payload);
            } else if (projId) {
                io.to(`${projId}:*`).emit('user_updated', payload);
            }
        });

        io.on('connection', (socket) => {
            const query = socket.handshake.query || {};
            const projectId = query.projectId || 'default_project';
            const serviceId = query.serviceId || 'default_service';
            
            const room = `${projectId}:${serviceId}`;
            socket.join(room);
            socket.join(`${projectId}:*`);
            
            // console.log(`💬 Cliente web conectado a sala: ${room}`);
            socket.on('message', async (msg) => {
                try {
                    let ip = '';
                    const xff = socket.handshake.headers['x-forwarded-for'];
                    if (typeof xff === 'string') ip = xff.split(',')[0];
                    else if (Array.isArray(xff)) ip = xff[0];
                    else ip = socket.handshake.address || '';

                    // Manejo rudimentario de historial en memoria para webchat
                    if (!(global as any).webchatHistories) (global as any).webchatHistories = {};
                    const historyKey = `webchat_${ip}`;
                    if (!(global as any).webchatHistories[historyKey]) (global as any).webchatHistories[historyKey] = [];
                    const _history = (global as any).webchatHistories[historyKey];

                    const state = {
                        get: (key: string) => key === 'history' ? _history : undefined,
                        update: async (msg: string, role = 'user') => {
                            _history.push({ role, content: msg });
                            if (_history.length > 10) _history.shift();
                        },
                        clear: async () => { _history.length = 0; }
                    };

                    let replyText = '';
                    const flowDynamic = async (arr: any) => {
                        if (Array.isArray(arr)) replyText = arr.map(a => a.body).join('\n');
                        else if (typeof arr === 'string') replyText = arr;
                    };

                    const cleanMsg = msg.trim().toUpperCase();
                    const dynamicProjectId = await HistoryHandler.getProjectIdByRecipient(null) || HistoryHandler.PROJECT_IDENTIFIER;
                    const dynamicServiceId = await HistoryHandler.getServiceIdByRecipient(null) || HistoryHandler.SERVICE_IDENTIFIER;

                    if (cleanMsg === "#RESET#" || cleanMsg === "#RESET" || cleanMsg === "RESET") {
                        await state.clear();
                        await HistoryHandler.setAssignedAgent(ip, 'asistente1', dynamicProjectId, dynamicServiceId);
                        await HistoryHandler.saveThreadId(ip, '', dynamicProjectId, dynamicServiceId);
                        replyText = "🔄 Sesión y asistente reiniciados.";
                    } else if (cleanMsg === "#HILO_NUEVO#" || cleanMsg === "#HILO_NUEVO" || cleanMsg === "HILO_NUEVO") {
                        await state.clear();
                        await HistoryHandler.clearChatHistory(ip, dynamicProjectId, dynamicServiceId);
                        await HistoryHandler.setAssignedAgent(ip, 'asistente1', dynamicProjectId, dynamicServiceId);
                        await HistoryHandler.saveThreadId(ip, '', dynamicProjectId, dynamicServiceId);
                        replyText = "✅ Se ha borrado todo el historial de conversación de este contacto y se ha iniciado un nuevo hilo de chat.";
                    } else if (cleanMsg === "#CLEAR_CONTEXT#" || cleanMsg === "#CLEAR_CONTEXT" || cleanMsg === "CLEAR_CONTEXT" || cleanMsg === "#ELIMINAR_CONTEXTO#" || cleanMsg === "ELIMINAR_CONTEXTO") {
                        await state.clear();
                        await HistoryHandler.clearClientContext(ip, dynamicProjectId, dynamicServiceId);
                        await HistoryHandler.saveThreadId(ip, '', dynamicProjectId, dynamicServiceId);
                        replyText = "🧹 Contexto de cliente y memoria eliminados.";
                    } else if (cleanMsg === "#ACTUALIZAR#" || cleanMsg === "#ACTUALIZAR" || cleanMsg === "ACTUALIZAR") {
                        const { updateMain } = await import("../apis/google/updateMain");
                        await updateMain(dynamicProjectId, dynamicServiceId);
                        replyText = "🔄 Sincronización de Sheets, RAG y tools completada.";
                    } else {
                        // Llamar al procesador de mensajes centralizado
                        await processUserMessage(
                            { from: ip, body: msg, type: 'webchat' }, 
                            { flowDynamic, state, provider: undefined, gotoFlow: () => {} }
                        );
                    }
                    socket.emit('reply', replyText);
                } catch (err) {
                    socket.emit('reply', 'Error procesando mensaje.');
                }
            });
        });

        return io;
    } catch (e) {
        console.error('❌ [Socket.IO] Error durante la inicialización:', e);
    }
};
