import { supabase, HistoryHandler, normalizeCuitDni, normalizeEmpresa } from '../db/historyHandler';
import { ContactChannel, normalizeChannelValue, normalizeContactPhone } from './contactNormalizer';
import { CrossServiceContactSync } from './crossServiceContactSync';

export interface ContactPayload {
    id?: string | null;
    phone?: string | null;
    phoneRaw?: string | null;
    phoneNormalized?: string | null;
    name?: string | null;
    apellido?: string | null;
    cuit_dni?: string | null;
    empresa?: string | null;
    email?: string | null;
    channel?: ContactChannel | string | null;
    channelValue?: string | null;
    whatsappChannel?: string | null;
    instagramChannel?: string | null;
    facebookChannel?: string | null;
    telegramChannel?: string | null;
    webchatChannel?: string | null;
    address?: string | null;
    localidad?: string | null;
    provincia?: string | null;
    transporte?: string | null;
    tax_status?: string | null;
    offered_product?: string | null;
    crm_status?: string | null;
    crm_due_date?: string | null;
    is_lead?: boolean | null;
    priority?: string | null;
    notes?: string | null;
    shared_notes?: string | null;
    tagIds?: string[] | null;
    source?: string | null;
    metadata?: Record<string, any> | null;
}

export interface ListContactsOptions {
    limit?: number;
    offset?: number;
    search?: string | null;
    channel?: string | null;
    tagId?: string | null;
    leadOnly?: boolean | null;
}

const cleanText = (value: any): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
};

export class ContactService {
    static normalizePhone(rawPhone: string | null | undefined): string | null {
        return normalizeContactPhone(rawPhone);
    }

    /**
     * Formatea un registro de la tabla chats al objeto unificado de Contacto / Ficha Lead
     */
    static formatContactRow(row: any) {
        const meta = row.metadata || {};
        const tags = (row.chat_tags || []).map((ct: any) => ct.tags).filter(Boolean);
        const tagIds = (row.chat_tags || []).map((ct: any) => ct.tag_id).filter(Boolean);

        // Separar o inferir nombre y apellido
        let firstName = meta.nombre || '';
        let lastName = meta.apellido || '';
        if (!firstName && !lastName && row.name) {
            const parts = String(row.name).trim().split(/\s+/);
            if (parts.length > 1) {
                firstName = parts[0];
                lastName = parts.slice(1).join(' ');
            } else {
                firstName = parts[0] || '';
            }
        } else if (!firstName && row.name) {
            firstName = row.name;
        }

        const fullName = row.name || (firstName ? `${firstName} ${lastName}`.trim() : '');

        return {
            id: row.id,
            phone: row.id,
            phoneRaw: row.id,
            phoneNormalized: row.id,
            name: fullName,
            firstName,
            lastName,
            cuit: row.cuit_dni || '',
            cuit_dni: row.cuit_dni || '',
            empresa: meta.empresa || '',
            email: row.email || '',
            channel: row.type || 'whatsapp',
            address: row.address || '',
            localidad: meta.localidad || '',
            provincia: meta.provincia || '',
            transporte: meta.transporte || '',
            tax_status: row.tax_status || '',
            offered_product: row.offered_product || '',
            crm_status: row.crm_status || '',
            crm_due_date: row.crm_due_date || null,
            is_lead: Boolean(row.is_lead),
            priority: meta.priority || 'Media',
            notes: row.notes || '',
            shared_notes: meta.shared_notes || '',
            tags,
            tagIds,
            metadata: meta,
            unread_count: row.unread_count || 0,
            last_message_at: row.last_message_at,
            created_at: row.created_at || row.last_message_at
        };
    }

    /**
     * Lista todos los contactos del proyecto y servicio consultando la tabla principal `chats`
     * cumpliendo estrictamente con la regla de segregación Multi-Tenant y Multi-Servicio.
     */
    static async listContacts(projectId: string, serviceId: string, options: ListContactsOptions = {}): Promise<{ contacts: any[]; total: number }> {
        const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
        const offset = Math.max(Number(options.offset) || 0, 0);

        const selectQuery = options.tagId
            ? `id, project_id, service_id, type, name, email, cuit_dni, address, notes, is_lead, crm_status, crm_due_date, tax_status, offered_product, source, metadata, unread_count, last_message_at, chat_tags!inner(tag_id, tags(id, name, color))`
            : `id, project_id, service_id, type, name, email, cuit_dni, address, notes, is_lead, crm_status, crm_due_date, tax_status, offered_product, source, metadata, unread_count, last_message_at, chat_tags(tag_id, tags(id, name, color))`;

        let query = supabase
            .from('chats')
            .select(selectQuery, { count: 'exact' })
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        if (options.tagId) {
            query = query.eq('chat_tags.tag_id', options.tagId);
        }

        if (options.channel && options.channel !== 'all') {
            query = query.eq('type', options.channel);
        }

        if (options.leadOnly) {
            query = query.or('is_lead.eq.true,crm_status.not.is.null');
        }

        const search = cleanText(options.search);
        if (search) {
            const escapedSearch = search.replace(/[%_]/g, '\\$&');
            query = query.or(`name.ilike.%${escapedSearch}%,id.ilike.%${escapedSearch}%,cuit_dni.ilike.%${escapedSearch}%,email.ilike.%${escapedSearch}%`);
        }

        const { data, error, count } = await query
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error('[ContactService] Error consultando chats/contactos:', error);
            throw error;
        }

        const rawList = (data as any[]) || [];
        return {
            contacts: rawList.map(row => this.formatContactRow(row)),
            total: count ?? rawList.length
        };
    }

    /**
     * Obtiene un contacto puntual por ID con sus etiquetas y ficha completa
     */
    static async getContact(projectId: string, serviceId: string, contactId: string): Promise<any | null> {
        const { data, error } = await supabase
            .from('chats')
            .select(`
                id,
                project_id,
                service_id,
                type,
                name,
                email,
                cuit_dni,
                address,
                notes,
                is_lead,
                crm_status,
                crm_due_date,
                tax_status,
                offered_product,
                source,
                metadata,
                unread_count,
                last_message_at,
                chat_tags(tag_id, tags(id, name, color))
            `)
            .eq('id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .maybeSingle();

        if (error) throw error;
        if (!data) return null;
        return this.formatContactRow(data);
    }

    /**
     * Crea o actualiza un contacto completo con todos sus datos de ficha y etiquetas
     */
    static async createOrUpdateContact(projectId: string, serviceId: string, payload: ContactPayload, isCrossSync = false): Promise<any> {
        let phone = cleanText(payload.phone || payload.phoneNormalized || payload.phoneRaw || payload.whatsappChannel || payload.id);
        if (!phone) {
            throw new Error('Se requiere un número de contacto válido.');
        }

        // Normalizar número telefónico
        phone = phone.replace(/\D/g, '').trim();
        if (phone.startsWith('0')) phone = phone.slice(1);
        if (phone.length === 10) phone = `549${phone}`;
        else if (phone.length === 11 && phone.startsWith('9')) phone = `54${phone}`;
        else if (phone.length === 12 && phone.startsWith('54') && !phone.startsWith('549')) phone = `549${phone.slice(2)}`;

        const cleanCuit = normalizeCuitDni(payload.cuit_dni);
        const cleanEmpresa = normalizeEmpresa(payload.empresa) ? (payload.empresa?.trim() || null) : null;

        // Consultar chat existente para preservar metadata previa
        const { data: existingChat } = await supabase
            .from('chats')
            .select('*')
            .eq('id', phone)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .maybeSingle();

        const existingMeta = existingChat?.metadata || {};
        const mergedMeta = {
            ...existingMeta,
            ...(payload.metadata || {}),
            ...(payload.apellido !== undefined ? { apellido: payload.apellido } : {}),
            ...(cleanEmpresa !== null ? { empresa: cleanEmpresa } : {}),
            ...(payload.localidad !== undefined ? { localidad: payload.localidad } : {}),
            ...(payload.provincia !== undefined ? { provincia: payload.provincia } : {}),
            ...(payload.transporte !== undefined ? { transporte: payload.transporte } : {}),
            ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
            ...(payload.shared_notes !== undefined ? { shared_notes: payload.shared_notes } : {})
        };

        let fullName = payload.name;
        if (!fullName && (payload.name !== undefined || payload.apellido !== undefined)) {
            const fName = payload.name || '';
            const lName = payload.apellido || '';
            fullName = `${fName} ${lName}`.trim() || null;
        }

        const isBlacklisted = await HistoryHandler.isContactBlacklisted(phone, projectId, serviceId);

        const chatRow: any = {
            id: phone,
            project_id: projectId,
            service_id: serviceId,
            type: payload.channel || existingChat?.type || 'whatsapp',
            name: fullName !== undefined ? fullName : (existingChat?.name || null),
            email: payload.email !== undefined ? cleanText(payload.email) : (existingChat?.email || null),
            cuit_dni: cleanCuit !== undefined ? cleanCuit : (existingChat?.cuit_dni || null),
            address: payload.address !== undefined ? cleanText(payload.address) : (existingChat?.address || null),
            tax_status: payload.tax_status !== undefined ? cleanText(payload.tax_status) : (existingChat?.tax_status || null),
            offered_product: payload.offered_product !== undefined ? cleanText(payload.offered_product) : (existingChat?.offered_product || null),
            crm_status: payload.crm_status !== undefined ? cleanText(payload.crm_status) : (existingChat?.crm_status || null),
            crm_due_date: payload.crm_due_date !== undefined ? payload.crm_due_date : (existingChat?.crm_due_date || null),
            is_lead: payload.is_lead !== undefined ? Boolean(payload.is_lead) : (payload.crm_status ? true : (existingChat?.is_lead ?? false)),
            notes: payload.notes !== undefined ? cleanText(payload.notes) : (existingChat?.notes || null),
            source: payload.source || existingChat?.source || payload.channel || 'contactos_manual',
            metadata: mergedMeta,
            bot_enabled: existingChat?.bot_enabled !== undefined ? existingChat.bot_enabled : !isBlacklisted,
            assigned_agent: existingChat?.assigned_agent || 'asistente1',
            last_message_at: existingChat?.last_message_at || new Date().toISOString()
        };

        const { error: upsertErr } = await supabase
            .from('chats')
            .upsert(chatRow, { onConflict: 'id,project_id,service_id' });

        if (upsertErr) {
            console.error('[ContactService] Error al guardar contacto en chats:', upsertErr);
            throw upsertErr;
        }

        // Asignar etiquetas si se proporcionaron tagIds
        if (Array.isArray(payload.tagIds)) {
            await supabase
                .from('chat_tags')
                .delete()
                .eq('chat_id', phone)
                .eq('project_id', projectId)
                .eq('service_id', serviceId);

            if (payload.tagIds.length > 0) {
                const tagRows = payload.tagIds.map(tagId => ({
                    chat_id: phone,
                    tag_id: tagId,
                    project_id: projectId,
                    service_id: serviceId
                }));
                await supabase.from('chat_tags').upsert(tagRows, { onConflict: 'chat_id,tag_id,project_id' });
            }
        }

        // Multi-Servicio: Sincronizar contacto y ficha a servicios hermanos
        if (!isCrossSync && projectId) {
            try {
                await CrossServiceContactSync.syncContactAndLeadAcrossServices(projectId, serviceId, {
                    phone,
                    name: chatRow.name,
                    email: chatRow.email,
                    cuit_dni: chatRow.cuit_dni,
                    address: chatRow.address,
                    notes: chatRow.notes,
                    is_lead: chatRow.is_lead,
                    crm_status: chatRow.crm_status,
                    crm_due_date: chatRow.crm_due_date,
                    tax_status: chatRow.tax_status,
                    offered_product: chatRow.offered_product,
                    source: chatRow.source,
                    metadata: mergedMeta,
                    tagIds: payload.tagIds || undefined
                });
            } catch (syncErr: any) {
                console.warn('[ContactService] Error replicando contacto cross-service:', syncErr.message);
            }
        }

        return this.getContact(projectId, serviceId, phone);
    }

    /**
     * Actualiza un contacto existente por ID
     */
    static async updateContact(projectId: string, serviceId: string, contactId: string, payload: ContactPayload, isCrossSync = false): Promise<any | null> {
        payload.phone = contactId;
        payload.id = contactId;
        return this.createOrUpdateContact(projectId, serviceId, payload, isCrossSync);
    }

    /**
     * Elimina un contacto y sus relaciones asociadas
     */
    static async deleteContact(projectId: string, serviceId: string, contactId: string) {
        // Eliminar chat_tags
        await supabase
            .from('chat_tags')
            .delete()
            .eq('chat_id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        // Eliminar mensajes
        await supabase
            .from('messages')
            .delete()
            .eq('chat_id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        // Eliminar tickets
        await supabase
            .from('tickets')
            .delete()
            .eq('chat_id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        // Eliminar chat
        const { error } = await supabase
            .from('chats')
            .delete()
            .eq('id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        if (error) throw error;
        return { success: true };
    }
}
