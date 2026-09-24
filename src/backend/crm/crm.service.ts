import { supabase, historyEvents, HistoryHandler, normalizeCuitDni, normalizeEmpresa } from '../db/historyHandler';
import { LocalHistoryStore } from '../db/localHistoryStore';
import { CrossServiceContactSync } from '../contacts/crossServiceContactSync';

export interface TicketPayload {
    chatId?: string;
    titulo: string;
    descripcion?: string;
    tipo?: string;
    prioridad?: string;
    attachments?: any[];
    chats_adjuntos?: any[];
    estado?: string;
    [key: string]: any;
}

export class CrmService {
    /**
     * Crea un nuevo ticket
     */
    static async createTicket(
        rawChatId: string | null,
        titulo: string,
        descripcion: string = '',
        tipo: string = 'Soporte',
        prioridad: string = 'Media',
        forcedProjectId?: string,
        attachments: any[] = [],
        chats_adjuntos: any[] = [],
        serviceId?: string | null
    ) {
        const chatId = rawChatId ? HistoryHandler.normalizeId(rawChatId) : null;
        const currentProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;

        if (process.env.STORAGE_MODE === "local") {
            const ticket = await LocalHistoryStore.createTicket(
                chatId || '',
                titulo,
                descripcion,
                tipo,
                prioridad,
                currentProjectId,
                attachments,
                chats_adjuntos,
                serviceId
            );
            historyEvents.emit('ticket_updated', { ticket });
            return { success: true, ticket };
        }

        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            const { data: proyectoRow } = await sb
                .from('proyectos_railway')
                .select('cliente_id')
                .eq('railway_project_id', currentProjectId)
                .maybeSingle();
            const clienteId = proyectoRow?.cliente_id || null;

            const targetServiceId = serviceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER || "default_service";

            const { data, error } = await sb
                .from('tickets')
                .insert({
                    project_id: currentProjectId,
                    service_id: targetServiceId,
                    chat_id: chatId,
                    titulo,
                    descripcion,
                    prioridad,
                    estado: 'Abierto',
                    tipo: tipo,
                    attachments: JSON.stringify(attachments),
                    chats_adjuntos: JSON.stringify(chats_adjuntos),
                    ...(clienteId ? { cliente_id: clienteId } : {})
                })
                .select()
                .single();

            if (error) throw error;
            historyEvents.emit('ticket_updated', { ticket: data });
            return { success: true, ticket: data };
        } catch (err: any) {
            console.error('[CrmService] Error en createTicket:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene el conteo de tickets pendientes (Abiertos o En progreso)
     */
    static async getPendingTicketsCount(projectId?: string | null, tipo?: string): Promise<number> {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.getPendingTicketsCount(tipo || '', currentProjectId);
        }

        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            let query = sb
                .from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('project_id', currentProjectId)
                .in('estado', ['Abierto', 'En progreso']);

            if (tipo) {
                query = query.eq('tipo', tipo);
            }

            const { count, error } = await query;
            if (error) throw error;
            return count || 0;
        } catch (err) {
            console.error('[CrmService] Error en getPendingTicketsCount:', err);
            return 0;
        }
    }

    /**
     * Crea un reporte de nuevo lead generado automáticamente por el bot
     */
    static async createReporteBot(
        rawChatId: string,
        descripcion: string,
        tipo: string = 'Nuevo Lead',
        forcedProjectId?: string
    ) {
        const chatId = HistoryHandler.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;

        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            const { data: proyectoRow } = await sb
                .from('proyectos_railway')
                .select('cliente_id')
                .eq('railway_project_id', currentProjectId)
                .maybeSingle();

            const clienteId = (proyectoRow as any)?.cliente_id || null;

            // Obtener el nombre real del contacto desde la tabla chats
            const { data: chatData } = await sb
                .from('chats')
                .select('name')
                .eq('id', chatId)
                .eq('project_id', currentProjectId)
                .maybeSingle();
            const contactName = chatData?.name || chatId;

            const { data, error } = await sb
                .from('tickets')
                .insert({
                    project_id: currentProjectId,
                    chat_id: chatId,
                    titulo: `Lead: ${contactName}`,
                    descripcion,
                    tipo,
                    estado: 'Abierto',
                    prioridad: 'Media',
                    attachments: '[]',
                    chats_adjuntos: '[]',
                    created_at: new Date().toISOString(),
                    ...(clienteId ? { cliente_id: clienteId } : {})
                })
                .select()
                .single();

            if (error) throw error;
            return { success: true, reporte: data };
        } catch (err: any) {
            console.error('[CrmService] Error en createReporteBot:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene el reporte bot activo para un contacto específico
     */
    static async getActiveReporteBot(rawChatId: string, forcedProjectId?: string) {
        const chatId = HistoryHandler.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;

        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            const { data, error } = await sb
                .from('tickets')
                .select('*')
                .eq('chat_id', chatId)
                .eq('project_id', currentProjectId)
                .eq('tipo', 'Nuevo Lead')
                .eq('estado', 'Abierto')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            return data || null;
        } catch (err) {
            console.error('[CrmService] Error en getActiveReporteBot:', err);
            return null;
        }
    }

    /**
     * Actualiza la descripción de un reporte de bot
     */
    static async updateReporteBotDescription(reporteId: string, descripcion: string) {
        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            const { data, error } = await sb
                .from('tickets')
                .update({ descripcion, updated_at: new Date().toISOString() })
                .eq('id', reporteId)
                .select()
                .single();

            if (error) throw error;
            return { success: true, reporte: data };
        } catch (err: any) {
            console.error('[CrmService] Error en updateReporteBotDescription:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Lista los tickets del proyecto con filtros avanzados y segregación multi-servicio
     */
    static async listTickets(
        limit: number = 50,
        offset: number = 0,
        estado?: string,
        tipo?: string,
        chatId?: string,
        ticketId?: string,
        projectId?: string | null,
        serviceId?: string | null
    ) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            const res = await LocalHistoryStore.listTickets(limit, offset, estado, tipo, chatId, ticketId, currentProjectId);
            return res.data;
        }

        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            let query = sb
                .from('tickets')
                .select('*')
                .eq('project_id', currentProjectId);

            const currentServiceId = serviceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER;
            if (currentServiceId && currentServiceId !== 'all') {
                if (currentServiceId.includes(',')) {
                    const servicesList = currentServiceId.split(',').map(s => s.trim()).filter(Boolean);
                    query = query.in('service_id', servicesList);
                } else if (currentServiceId !== 'default_service') {
                    query = query.eq('service_id', currentServiceId);
                }
            }

            if (ticketId && ticketId !== 'null' && ticketId !== 'undefined' && ticketId !== '') {
                query = query.eq('id', ticketId);
            }

            if (chatId && chatId !== 'null' && chatId !== 'undefined' && chatId !== '') {
                query = query.eq('chat_id', HistoryHandler.normalizeId(chatId));
            }

            if (tipo && tipo !== 'null' && tipo !== 'undefined' && tipo !== '') {
                query = query.eq('tipo', tipo);
            }

            if (estado && estado !== 'null' && estado !== 'undefined' && estado !== '') {
                if (estado.includes(',')) {
                    query = query.in('estado', estado.split(','));
                } else if (estado === 'all_active') {
                    query = query.neq('estado', 'Cerrado');
                } else {
                    query = query.eq('estado', estado);
                }
            } else if (estado === 'null' || estado === 'undefined') {
                // No aplicar filtro de estado (trae todos)
            } else {
                query = query.in('estado', ['Abierto', 'En progreso']);
            }

            const { data, error } = await query
                .order('updated_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[CrmService] Error en listTickets:', err);
            return [];
        }
    }

    /**
     * Actualiza un Lead y su Ticket correspondiente, sincronizando datos de contacto en chats
     */
    static async updateLeadAndTicket(ticketId: string, details: any) {
        if (process.env.STORAGE_MODE === "local") {
            const success = await LocalHistoryStore.updateLeadAndTicket(ticketId, details, HistoryHandler.PROJECT_IDENTIFIER);
            return { success };
        }

        try {
            console.log(`[CrmService] Actualizando Lead/Ticket ${ticketId}`);
            const sb = HistoryHandler.getSupabase() || supabase;

            const { data: ticket, error: tError } = await sb
                .from('tickets')
                .select('chat_id, project_id, service_id')
                .eq('id', ticketId)
                .single();

            if (tError || !ticket) throw new Error('Ticket no encontrado');
            const currentProjectId = ticket.project_id || HistoryHandler.PROJECT_IDENTIFIER;
            const currentServiceId = (ticket as any).service_id || details.service_id || null;

            const ticketUpdate: any = { updated_at: new Date().toISOString() };
            if (details.titulo !== undefined) ticketUpdate.titulo = details.titulo;

            const notesVal = details.notas !== undefined ? details.notas : details.notes;
            if (notesVal !== undefined) ticketUpdate.descripcion = notesVal;

            const priorityVal = details.priority || details.prioridad;
            if (priorityVal !== undefined) ticketUpdate.prioridad = priorityVal;

            if (details.chats_adjuntos !== undefined) ticketUpdate.chats_adjuntos = details.chats_adjuntos;

            if (details.estado !== undefined) {
                ticketUpdate.estado = details.estado;
            } else if (details.contact?.crm_status !== undefined) {
                ticketUpdate.estado = details.contact.crm_status;
            } else if (details.contact?.crm_status === 'Cerrado' || details.contact?.crm_status === 'Vendido') {
                ticketUpdate.estado = 'Cerrado';
            }

            const { error: upTicketErr } = await sb
                .from('tickets')
                .update(ticketUpdate)
                .eq('id', ticketId)
                .eq('project_id', currentProjectId);

            if (upTicketErr) throw upTicketErr;

            // Actualizar Contacto (Chat) en Supabase si corresponde o si se cierra el ticket
            const hasContactDetails = details.contact !== undefined;
            let updatedPhoneId: string | null = null;

            if (hasContactDetails && ticket.chat_id) {
                const targetNewPhone = details.contact.phone || details.contact.newPhone;
                if (targetNewPhone && typeof targetNewPhone === 'string') {
                    let cleanPhone = targetNewPhone.replace(/\D/g, '').trim();
                    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
                    if (cleanPhone.length === 10) cleanPhone = `549${cleanPhone}`;

                    if (cleanPhone && cleanPhone !== ticket.chat_id) {
                        console.log(`📌 [CrmService] Actualizando teléfono de chat: ${ticket.chat_id} -> ${cleanPhone} para el proyecto ${currentProjectId}`);
                        const { error: phoneErr } = await sb
                            .from('chats')
                            .update({ id: cleanPhone })
                            .eq('id', ticket.chat_id)
                            .eq('project_id', currentProjectId);

                        if (!phoneErr) {
                            updatedPhoneId = cleanPhone;
                        } else {
                            console.error('❌ [CrmService] Error actualizando ID de teléfono:', phoneErr.message);
                        }
                    }
                }
            }

            const activeChatTargetId = updatedPhoneId || ticket.chat_id;

            if ((hasContactDetails || ticketUpdate.estado === 'Cerrado') && activeChatTargetId) {
                const chatUpdate: any = {};
                let currentChatRow: any = null;
                let targetCuit: string | null = null;
                let targetEmpresa: string | null = null;

                if (hasContactDetails) {
                    if (details.contact.name !== undefined) chatUpdate.name = details.contact.name;
                    if (details.contact.email !== undefined) chatUpdate.email = details.contact.email;
                    if (details.contact.cuit_dni !== undefined) chatUpdate.cuit_dni = normalizeCuitDni(details.contact.cuit_dni) || null;
                    if (details.contact.empresa !== undefined) {
                        const normEmp = normalizeEmpresa(details.contact.empresa);
                        details.contact.empresa = normEmp ? details.contact.empresa.trim() : '';
                    }
                    if (details.contact.address !== undefined) chatUpdate.address = details.contact.address;
                    if (details.contact.tax_status !== undefined) chatUpdate.tax_status = details.contact.tax_status;
                    if (details.contact.offered_product !== undefined) chatUpdate.offered_product = details.contact.offered_product;
                    if (details.contact.crm_status !== undefined) chatUpdate.crm_status = details.contact.crm_status;
                    if (details.contact.crm_due_date !== undefined) chatUpdate.crm_due_date = details.contact.crm_due_date;
                    if (notesVal !== undefined) chatUpdate.notes = notesVal;
                    if (details.contact.source !== undefined) chatUpdate.source = details.contact.source;

                    const { data: cRow } = await sb
                        .from('chats')
                        .select('metadata, cuit_dni')
                        .eq('id', activeChatTargetId)
                        .eq('project_id', currentProjectId)
                        .maybeSingle();
                    currentChatRow = cRow;

                    const existingMeta = currentChatRow?.metadata || {};
                    const rawTargetCuit = details.contact.cuit_dni !== undefined ? details.contact.cuit_dni : currentChatRow?.cuit_dni;
                    const rawTargetEmpresa = details.contact.empresa !== undefined ? details.contact.empresa : (existingMeta.empresa || currentChatRow?.metadata?.empresa);
                    targetCuit = normalizeCuitDni(rawTargetCuit);
                    targetEmpresa = normalizeEmpresa(rawTargetEmpresa) ? (rawTargetEmpresa?.trim() || null) : null;

                    let effectiveSharedNotes = details.contact.shared_notes;
                    if (currentProjectId && (targetCuit || targetEmpresa)) {
                        const existingCompanyNotes = await HistoryHandler.getCompanySharedNotes(currentProjectId, targetCuit, targetEmpresa);
                        if (existingCompanyNotes && (!effectiveSharedNotes || !String(effectiveSharedNotes).trim())) {
                            effectiveSharedNotes = existingCompanyNotes;
                        }
                    }

                    const mergedMeta = {
                        ...existingMeta,
                        ...(details.contact.metadata || {}),
                        ...(details.contact.apellido !== undefined ? { apellido: details.contact.apellido } : {}),
                        ...(details.contact.empresa !== undefined ? { empresa: details.contact.empresa } : {}),
                        ...(details.contact.localidad !== undefined ? { localidad: details.contact.localidad } : {}),
                        ...(details.contact.provincia !== undefined ? { provincia: details.contact.provincia } : {}),
                        ...(details.contact.transporte !== undefined ? { transporte: details.contact.transporte } : {}),
                        ...(effectiveSharedNotes !== undefined ? { shared_notes: effectiveSharedNotes } : {})
                    };
                    chatUpdate.metadata = mergedMeta;
                }

                // Si el estado es cerrado, aplicar lógica de reset de bot y desclasificación de lead
                if (ticketUpdate.estado === 'Cerrado') {
                    const isBlacklisted = await HistoryHandler.isContactBlacklisted(activeChatTargetId, currentProjectId, currentServiceId);
                    chatUpdate.assigned_agent = 'asistente1';
                    chatUpdate.bot_enabled = !isBlacklisted;
                    chatUpdate.last_db_result = null;
                    chatUpdate.is_lead = false;
                    chatUpdate.crm_status = null;
                }

                if (Object.keys(chatUpdate).length > 0) {
                    let query = sb
                        .from('chats')
                        .update(chatUpdate)
                        .eq('id', activeChatTargetId)
                        .eq('project_id', currentProjectId);

                    if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                        query = query.eq('service_id', currentServiceId);
                    }

                    const { error: upChatErr } = await query;
                    if (upChatErr) throw upChatErr;

                    // Multi-Servicio: Sincronizar datos de contacto y ficha de lead a servicios hermanos
                    try {
                        await CrossServiceContactSync.syncContactAndLeadAcrossServices(currentProjectId, currentServiceId, {
                            phone: activeChatTargetId,
                            name: chatUpdate.name,
                            email: chatUpdate.email,
                            cuit_dni: chatUpdate.cuit_dni,
                            address: chatUpdate.address,
                            notes: chatUpdate.notes,
                            is_lead: chatUpdate.is_lead,
                            crm_status: chatUpdate.crm_status,
                            crm_due_date: chatUpdate.crm_due_date,
                            tax_status: chatUpdate.tax_status,
                            offered_product: chatUpdate.offered_product,
                            source: chatUpdate.source,
                            metadata: chatUpdate.metadata
                        });
                    } catch (crossSyncErr: any) {
                        console.error('[CrmService] Error sincronizando lead con servicios hermanos:', crossSyncErr.message);
                    }

                    // Sincronizar Notas compartidas de empresa por CUIT o Empresa
                    if (hasContactDetails && currentProjectId && (targetCuit || targetEmpresa)) {
                        const notesToSync = chatUpdate.metadata?.shared_notes;
                        if (notesToSync !== undefined) {
                            await HistoryHandler.syncCompanySharedNotes(currentProjectId, targetCuit, targetEmpresa, notesToSync);
                        }
                    }

                    // Sincronización Dual de Instancias (LID <-> Teléfono)
                    try {
                        const { data: currentChat } = await sb
                            .from('chats')
                            .select('metadata')
                            .eq('id', activeChatTargetId)
                            .eq('project_id', currentProjectId)
                            .maybeSingle();

                        let companionId: string | null = null;
                        if (currentChat) {
                            const metadata = currentChat.metadata || {};
                            if (metadata.lid) {
                                companionId = HistoryHandler.normalizeId(metadata.lid);
                            } else if (metadata.phone_jid) {
                                companionId = HistoryHandler.normalizeId(metadata.phone_jid);
                            } else {
                                const { data: phoneChat } = await sb
                                    .from('chats')
                                    .select('id')
                                    .eq('project_id', currentProjectId)
                                    .eq('metadata->>lid', `${activeChatTargetId}@lid`)
                                    .maybeSingle();
                                if (phoneChat) companionId = phoneChat.id;
                            }
                        }

                        if (companionId && companionId !== activeChatTargetId) {
                            await sb
                                .from('chats')
                                .update(chatUpdate)
                                .eq('id', companionId)
                                .eq('project_id', currentProjectId);
                        }
                    } catch (syncErr: any) {
                        console.error(`[CrmService] Error en sincronización dual LID/Teléfono:`, syncErr.message);
                    }

                    historyEvents.emit('contact_updated', {
                        chatId: activeChatTargetId,
                        project_id: currentProjectId,
                        details: chatUpdate
                    });
                }

                HistoryHandler.invalidateChatCache(activeChatTargetId, currentProjectId);

                if (ticketUpdate.estado === 'Cerrado') {
                    const isBlacklisted = await HistoryHandler.isContactBlacklisted(activeChatTargetId, currentProjectId, currentServiceId);
                    historyEvents.emit('bot_toggled', {
                        chatId: activeChatTargetId,
                        enabled: !isBlacklisted,
                        assigned_agent: 'asistente1',
                        projectId: currentProjectId
                    });
                }
            }

            historyEvents.emit('ticket_updated', { id: ticketId, chat_id: activeChatTargetId, ...ticketUpdate });
            return { success: true, newPhone: updatedPhoneId || undefined };
        } catch (err: any) {
            console.error('[CrmService] Error en updateLeadAndTicket:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Actualiza un ticket
     */
    static async updateTicket(ticketId: string, details: any, serviceId?: string | null) {
        return this.updateLeadAndTicket(ticketId, { ...details, ...(serviceId ? { service_id: serviceId } : {}) });
    }

    /**
     * Elimina un ticket
     */
    static async deleteTicket(ticketId: string, forcedProjectId?: string) {
        const currentProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            const success = await LocalHistoryStore.deleteTicket(ticketId, currentProjectId);
            return { success };
        }

        try {
            console.log(`[CrmService] Eliminando ticket ${ticketId}`);
            const sb = HistoryHandler.getSupabase() || supabase;

            const { data: ticket } = await sb
                .from('tickets')
                .select('chat_id, service_id')
                .eq('id', ticketId)
                .eq('project_id', currentProjectId)
                .single();

            const { error } = await sb
                .from('tickets')
                .delete()
                .eq('id', ticketId)
                .eq('project_id', currentProjectId);

            if (error) throw error;

            if (ticket && ticket.chat_id) {
                const isBlacklisted = await HistoryHandler.isContactBlacklisted(ticket.chat_id, currentProjectId);
                const chatUpdate = {
                    is_lead: false,
                    crm_status: null,
                    assigned_agent: 'asistente1',
                    bot_enabled: !isBlacklisted,
                    last_db_result: null
                };

                await sb
                    .from('chats')
                    .update(chatUpdate)
                    .eq('id', ticket.chat_id)
                    .eq('project_id', currentProjectId);

                try {
                    await CrossServiceContactSync.syncContactAndLeadAcrossServices(currentProjectId, ticket.service_id || null, {
                        phone: ticket.chat_id,
                        is_lead: false,
                        crm_status: null
                    });
                } catch (crossSyncErr: any) {
                    console.error('[CrmService] Error sincronizando eliminación de ticket con servicios hermanos:', crossSyncErr.message);
                }

                historyEvents.emit('contact_updated', {
                    chatId: ticket.chat_id,
                    project_id: currentProjectId,
                    details: chatUpdate
                });

                HistoryHandler.invalidateChatCache(ticket.chat_id, currentProjectId);
                historyEvents.emit('bot_toggled', {
                    chatId: ticket.chat_id,
                    enabled: !isBlacklisted,
                    assigned_agent: 'asistente1',
                    projectId: currentProjectId
                });
            }

            historyEvents.emit('ticket_deleted', { id: ticketId, projectId: currentProjectId });
            return { success: true };
        } catch (err: any) {
            console.error('[CrmService] Error en deleteTicket:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Elimina múltiples leads/tickets de forma masiva
     */
    static async bulkDeleteLeads(ticketIds: string[], projectId: string | null = null): Promise<number> {
        let deletedCount = 0;
        for (const ticketId of ticketIds) {
            const resDel = await this.deleteTicket(ticketId, projectId || undefined);
            if (resDel && resDel.success) {
                deletedCount++;
            }
        }
        return deletedCount;
    }

    /**
     * Lista los leads con datos de CRM
     */
    static async listEditedLeads(
        limit: number = 50,
        offset: number = 0,
        projectId?: string | null,
        serviceId?: string | null
    ) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            return LocalHistoryStore.listEditedLeads(limit, offset, currentProjectId);
        }

        try {
            const sb = HistoryHandler.getSupabase() || supabase;
            const currentServiceId = serviceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER;
            let query = sb
                .from('chats')
                .select('*, chat_tags(tag_id, tags(*))')
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'all') {
                if (currentServiceId.includes(',')) {
                    const servicesList = currentServiceId.split(',').map(s => s.trim()).filter(Boolean);
                    query = query.in('service_id', servicesList);
                } else if (currentServiceId !== 'default_service') {
                    query = query.eq('service_id', currentServiceId);
                }
            }

            const { data, error } = await query
                .or('is_lead.eq.true,crm_status.not.is.null')
                .order('last_message_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;
            return (data || []).map(chat => ({
                ...chat,
                tags: chat.chat_tags ? chat.chat_tags.map((ct: any) => ct.tags).filter((t: any) => t !== null) : []
            }));
        } catch (err) {
            console.error('[CrmService] Error en listEditedLeads:', err);
            return [];
        }
    }

    /**
     * Obtiene los leads con tareas próximas (hoy + 5 días)
     */
    static async getTasksDashboard(projectId?: string | null, serviceId?: string | null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        if (process.env.STORAGE_MODE === "local") {
            const chats = LocalHistoryStore.getChats(currentProjectId);
            const fiveDaysLater = new Date();
            fiveDaysLater.setDate(fiveDaysLater.getDate() + 5);
            fiveDaysLater.setHours(23, 59, 59, 999);

            const tasks = chats
                .filter(c => c.is_lead === true && c.crm_due_date)
                .filter(c => new Date(c.crm_due_date!) <= fiveDaysLater);

            tasks.sort((a, b) => new Date(a.crm_due_date!).getTime() - new Date(b.crm_due_date!).getTime());
            return tasks.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                crm_status: c.crm_status,
                crm_due_date: c.crm_due_date
            }));
        }

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const fiveDaysLater = new Date();
            fiveDaysLater.setDate(today.getDate() + 5);
            fiveDaysLater.setHours(23, 59, 59, 999);

            const sb = HistoryHandler.getSupabase() || supabase;
            const currentServiceId = serviceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER;

            let query = sb
                .from('chats')
                .select('id, name, type, crm_status, crm_due_date')
                .eq('project_id', currentProjectId)
                .eq('is_lead', true);

            if (currentServiceId && currentServiceId !== 'all') {
                if (currentServiceId.includes(',')) {
                    const servicesList = currentServiceId.split(',').map(s => s.trim()).filter(Boolean);
                    query = query.in('service_id', servicesList);
                } else if (currentServiceId !== 'default_service') {
                    query = query.eq('service_id', currentServiceId);
                }
            }

            const { data, error } = await query
                .not('crm_due_date', 'is', null)
                .lte('crm_due_date', fiveDaysLater.toISOString())
                .order('crm_due_date', { ascending: true });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[CrmService] Error en getTasksDashboard:', err);
            return [];
        }
    }

    /**
     * Obtiene la configuración del CRM (columnas Kanban, etapas, etc.)
     */
    static async getCrmConfig(projectId: string | null, serviceId?: string | null): Promise<any> {
        const configStr = await HistoryHandler.getSetting('CRM_CONFIG', projectId, serviceId);
        return configStr ? JSON.parse(configStr) : null;
    }

    /**
     * Guarda la configuración del CRM
     */
    static async saveCrmConfig(config: any, projectId: string | null, serviceId?: string | null): Promise<void> {
        await HistoryHandler.saveSetting('CRM_CONFIG', JSON.stringify(config), projectId, serviceId);
    }

    /**
     * Actualiza estado y fecha límite de un lead en chats
     */
    static async updateLeadStatus(leadId: string, crmStatus?: string, crmDueDate?: string, projectId?: string | null, serviceId?: string | null) {
        const sb = HistoryHandler.getSupabase() || supabase;
        if (!sb) throw new Error("Base de datos no disponible");

        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const updateData: any = {};
        if (crmStatus !== undefined) updateData.crm_status = crmStatus;
        if (crmDueDate !== undefined) updateData.crm_due_date = crmDueDate;

        let query = sb
            .from('chats')
            .update(updateData)
            .eq('id', leadId)
            .eq('project_id', targetProjectId);

        if (serviceId && serviceId !== 'default_service') {
            query = query.eq('service_id', serviceId);
        }

        const { error } = await query;
        if (error) throw error;

        // Multi-Servicio: Sincronizar estado y fecha límite de lead a todos los servicios hermanos
        try {
            await CrossServiceContactSync.syncContactAndLeadAcrossServices(targetProjectId, serviceId || null, {
                phone: leadId,
                crm_status: updateData.crm_status,
                crm_due_date: updateData.crm_due_date
            });
        } catch (crossSyncErr: any) {
            console.error('[CrmService] Error sincronizando estado de lead con servicios hermanos:', crossSyncErr.message);
        }

        return { success: true };
    }

    /**
     * Deriva / reasigna un chat a un operador humano o a un agente bot
     */
    static async assignChat(chatId: string, agentId?: string, userId?: string | null, projectId?: string | null, serviceId?: string | null) {
        if (agentId) {
            await HistoryHandler.setAssignedAgent(chatId, agentId, projectId || undefined, serviceId || undefined);
        }

        if (userId !== undefined) {
            await HistoryHandler.assignChatToUser(chatId, userId, projectId, serviceId);

            if (userId) {
                await HistoryHandler.toggleBot(chatId, false, projectId, serviceId);
            }
        }

        return { success: true };
    }
}
