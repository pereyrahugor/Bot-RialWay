import crypto from 'crypto';
import axios from 'axios';
import { historyEvents, HistoryHandler, supabase } from '../db/historyHandler';

export class WebhookDispatcher {
    private static intervalId: NodeJS.Timeout | null = null;

    public static init() {
        console.log('📡 [WebhookDispatcher] Inicializando listeners de eventos salientes...');

        // 1. Escuchar actualización de contactos
        historyEvents.on('contact_updated', async (payload: { chatId: string; project_id: string; details?: any }) => {
            try {
                const { chatId, project_id } = payload;
                const projectId = project_id || HistoryHandler.PROJECT_IDENTIFIER;
                
                await this.dispatch(projectId, 'contact.updated', async () => {
                    const chat = await HistoryHandler.getChat(chatId, projectId);
                    if (!chat) return null;

                    return {
                        chat_id: chat.id,
                        name: chat.name,
                        phone: chat.id, // El ID del chat es el número de teléfono en RialWay
                        email: chat.email || null,
                        cuit_dni: chat.cuit_dni || null,
                        address: chat.address || null,
                        notes: chat.notes || null,
                        crm_status: chat.crm_status || null,
                        offered_product: chat.offered_product || null,
                        source: chat.source || null
                    };
                });
            } catch (err: any) {
                console.error('❌ [WebhookDispatcher] Error en listener contact_updated:', err.message);
            }
        });

        // 2. Escuchar creación o cambios de estado en CRM (ticket_updated)
        historyEvents.on('ticket_updated', async (ticket: any) => {
            try {
                if (!ticket || !ticket.chat_id) return;
                const projectId = ticket.project_id || HistoryHandler.PROJECT_IDENTIFIER;

                // lead.created se dispara cuando el ticket es de tipo 'Nuevo Lead' y está recién creado
                const isNew = ticket.tipo === 'Nuevo Lead' && (!ticket.updated_at || ticket.created_at === ticket.updated_at);
                
                if (isNew) {
                    await this.dispatch(projectId, 'lead.created', async () => {
                        return {
                            ticket_id: ticket.id,
                            chat_id: ticket.chat_id,
                            title: ticket.titulo,
                            description: ticket.descripcion || null,
                            crm_status: ticket.estado || 'Abierto',
                            priority: ticket.prioridad || 'Media',
                            created_at: ticket.created_at
                        };
                    });
                } else {
                    // lead.status_moved se dispara al cambiar de columna o estado en el CRM
                    await this.dispatch(projectId, 'lead.status_moved', async () => {
                        return {
                            ticket_id: ticket.id,
                            chat_id: ticket.chat_id,
                            title: ticket.titulo,
                            crm_status: ticket.estado,
                            priority: ticket.prioridad || 'Media',
                            updated_at: ticket.updated_at || new Date().toISOString()
                        };
                    });
                }
            } catch (err: any) {
                console.error('❌ [WebhookDispatcher] Error en listener ticket_updated:', err.message);
            }
        });

        // 3. Escuchar mensajes nuevos recibidos (new_message)
        historyEvents.on('new_message', async (msg: any) => {
            try {
                if (!msg || msg.role !== 'user') return; // Solo mensajes entrantes del usuario
                const projectId = msg.project_id || msg.projectId || HistoryHandler.PROJECT_IDENTIFIER;

                await this.dispatch(projectId, 'message.received', async () => {
                    return {
                        chat_id: msg.chat_id,
                        role: msg.role,
                        content: msg.content,
                        type: msg.type,
                        external_id: msg.external_id || null,
                        created_at: msg.created_at || new Date().toISOString()
                    };
                });
            } catch (err: any) {
                console.error('❌ [WebhookDispatcher] Error en listener new_message:', err.message);
            }
        });

        // 4. Iniciar chequeo periódico de alertas expiradas (cada 2 minutos)
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.checkExpiredLeads(), 120000);
    }

    /**
     * Verifica y dispara eventos lead.expired para leads cuyo crm_due_date ya pasó
     */
    private static async checkExpiredLeads() {
        try {
            const projectId = HistoryHandler.PROJECT_IDENTIFIER;
            if (!projectId) return;

            const now = new Date();

            if (process.env.STORAGE_MODE === "local") {
                const { LocalHistoryStore } = await import('../db/localHistoryStore');
                const chats = LocalHistoryStore.getChats(projectId);
                const expiredChats = chats.filter(c => 
                    c.is_lead === true && 
                    c.crm_due_date && 
                    new Date(c.crm_due_date) <= now && 
                    !(c.metadata?.alert_notified)
                );

                for (const chat of expiredChats) {
                    const ticket = LocalHistoryStore.getTicketsList(projectId).find(t => t.chat_id === chat.id);
                    await this.triggerLeadExpired(projectId, chat, ticket?.id || null);
                    
                    // Marcar en metadatos para evitar duplicaciones
                    const meta = chat.metadata || {};
                    meta.alert_notified = true;
                    await LocalHistoryStore.updateContactDetails(chat.id, { metadata: meta } as any, projectId);
                }
            } else {
                // Supabase
                const { data: expiredChats, error } = await supabase
                    .from('chats')
                    .select('id, name, crm_status, crm_due_date, metadata')
                    .eq('project_id', projectId)
                    .eq('is_lead', true)
                    .not('crm_due_date', 'is', null)
                    .lte('crm_due_date', now.toISOString());

                if (error) throw error;

                for (const chat of (expiredChats || [])) {
                    const meta = typeof chat.metadata === 'string' ? JSON.parse(chat.metadata) : (chat.metadata || {});
                    if (meta.alert_notified) continue;

                    // Buscar el ticket_id
                    const { data: ticket } = await supabase
                        .from('tickets')
                        .select('id')
                        .eq('project_id', projectId)
                        .eq('chat_id', chat.id)
                        .limit(1)
                        .maybeSingle();

                    await this.triggerLeadExpired(projectId, chat, ticket?.id || null);

                    // Guardar marca en la DB
                    meta.alert_notified = true;
                    await supabase
                        .from('chats')
                        .update({ metadata: meta })
                        .eq('id', chat.id)
                        .eq('project_id', projectId);
                }
            }
        } catch (err: any) {
            console.error('❌ [WebhookDispatcher] Error en checkExpiredLeads:', err.message);
        }
    }

    private static async triggerLeadExpired(projectId: string, chat: any, ticketId: string | null) {
        await this.dispatch(projectId, 'lead.expired', async () => {
            return {
                ticket_id: ticketId,
                chat_id: chat.id,
                title: `Lead: ${chat.name || chat.id}`,
                expired_alert_date: chat.crm_due_date,
                crm_status: chat.crm_status || 'Abierto'
            };
        });
    }

    /**
     * Valida la suscripción del proyecto y despacha el webhook
     */
    public static async dispatch(projectId: string, eventType: string, payloadResolver: () => Promise<any> | any) {
        try {
            const webhookUrl = await HistoryHandler.getSetting('WEBHOOK_URL', projectId);
            if (!webhookUrl || !webhookUrl.startsWith('http')) {
                return; 
            }

            const webhookEventsRaw = await HistoryHandler.getSetting('WEBHOOK_EVENTS', projectId);
            let subscribedEvents: string[] = [];
            
            if (webhookEventsRaw) {
                try {
                    if (webhookEventsRaw.trim().startsWith('[')) {
                        subscribedEvents = JSON.parse(webhookEventsRaw);
                    } else {
                        subscribedEvents = webhookEventsRaw.split(',').map(s => s.trim());
                    }
                } catch {
                    subscribedEvents = webhookEventsRaw.split(',').map(s => s.trim());
                }
            }

            subscribedEvents = subscribedEvents.map(e => e.toLowerCase());

            if (!subscribedEvents.includes(eventType.toLowerCase())) {
                return; 
            }

            const eventData = await payloadResolver();
            if (!eventData) return;

            const payload = {
                event: eventType,
                timestamp: new Date().toISOString(),
                project_id: projectId,
                data: eventData
            };

            const bodyStr = JSON.stringify(payload);
            const headers: Record<string, string> = {
                'Content-Type': 'application/json'
            };

            // Firma HMAC SHA256 si hay secreto configurado
            const secret = await HistoryHandler.getSetting('WEBHOOK_SECRET', projectId);
            if (secret && secret.trim() !== '') {
                const hmac = crypto.createHmac('sha256', secret);
                hmac.update(bodyStr);
                const signature = hmac.digest('hex');
                headers['X-Rialway-Signature'] = signature;
            }

            console.log(`📡 [WebhookDispatcher] Despachando evento '${eventType}' a ${webhookUrl}...`);
            
            axios.post(webhookUrl, bodyStr, { headers, timeout: 5000 })
                .then(response => {
                    console.log(`✅ [WebhookDispatcher] Webhook '${eventType}' enviado correctamente. Status: ${response.status}`);
                })
                .catch(err => {
                    console.error(`❌ [WebhookDispatcher] Error al enviar webhook a ${webhookUrl}:`, err.response?.data || err.message);
                });

        } catch (err: any) {
            console.error('❌ [WebhookDispatcher] Error dispatching webhook:', err.message);
        }
    }
}
