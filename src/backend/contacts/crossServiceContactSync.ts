// src/backend/contacts/crossServiceContactSync.ts
import { supabase, HistoryHandler, normalizeCuitDni, normalizeEmpresa } from '../db/historyHandler';

interface ServiceCacheEntry {
    services: string[];
    expiresAt: number;
}

const serviceDiscoveryCache = new Map<string, ServiceCacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 minuto de caché para la lista de servicios del proyecto

export interface CrossServiceContactData {
    phone: string;
    name?: string | null;
    email?: string | null;
    cuit_dni?: string | null;
    address?: string | null;
    notes?: string | null;
    is_lead?: boolean;
    crm_status?: string | null;
    crm_due_date?: string | null;
    tax_status?: string | null;
    offered_product?: string | null;
    source?: string | null;
    metadata?: Record<string, any>;
    tagIds?: string[];
}

export class CrossServiceContactSync {
    /**
     * Obtiene todos los service_id únicos asociados a un proyecto, excluyendo opcionalmente el servicio de origen.
     */
    static async getOtherServicesInProject(projectId: string, excludeServiceId?: string | null): Promise<string[]> {
        if (!projectId) return [];
        const normalizedExclude = (excludeServiceId && excludeServiceId !== 'default' && excludeServiceId !== 'default_service')
            ? excludeServiceId.trim()
            : 'default_service';

        const now = Date.now();
        const cached = serviceDiscoveryCache.get(projectId);
        let allServices: string[] = [];

        if (cached && cached.expiresAt > now) {
            allServices = cached.services;
        } else {
            const sb = HistoryHandler.getSupabase() || supabase;
            if (!sb) return [];

            const servicesSet = new Set<string>();

            // 1. Consultar service_id en settings
            try {
                const { data: settingsData } = await sb
                    .from('settings')
                    .select('service_id')
                    .eq('project_id', projectId);

                if (settingsData) {
                    for (const row of settingsData) {
                        const s = row.service_id?.trim();
                        if (s && s !== 'null' && s !== 'generic') {
                            servicesSet.add(s);
                        }
                    }
                }
            } catch (e: any) {
                console.warn('[CrossServiceContactSync] ⚠️ Error leyendo settings para discovery:', e.message);
            }

            // 2. Consultar service_id en chats (con límite para rendimiento)
            try {
                const { data: chatsData } = await sb
                    .from('chats')
                    .select('service_id')
                    .eq('project_id', projectId)
                    .limit(200);

                if (chatsData) {
                    for (const row of chatsData) {
                        const s = row.service_id?.trim();
                        if (s && s !== 'null' && s !== 'generic') {
                            servicesSet.add(s);
                        }
                    }
                }
            } catch (e: any) {
                console.warn('[CrossServiceContactSync] ⚠️ Error leyendo chats para discovery:', e.message);
            }

            allServices = Array.from(servicesSet);
            if (allServices.length === 0) {
                allServices = ['default_service'];
            }

            serviceDiscoveryCache.set(projectId, {
                services: allServices,
                expiresAt: now + CACHE_TTL_MS
            });
        }

        // Retornar los servicios excluyendo el actual
        return allServices.filter(s => {
            if (s === normalizedExclude) return false;
            if (normalizedExclude === 'default_service' && (s === 'default' || s === 'default_service')) return false;
            return true;
        });
    }

    /**
     * Invalida la caché de servicios de un proyecto cuando se detectan cambios de configuración.
     */
    static invalidateServiceCache(projectId: string) {
        serviceDiscoveryCache.delete(projectId);
    }

    /**
     * Sincroniza la ficha de un contacto y sus datos de lead en la tabla `chats` hacia todos los demás servicios del proyecto.
     * IMPORTANTE: Los mensajes (`messages`) y contadores de mensajes (`unread_count`, `last_message`)
     * permanecen estrictamente independientes por instancia.
     */
    static async syncContactAndLeadAcrossServices(
        projectId: string,
        sourceServiceId: string | null,
        contactData: CrossServiceContactData
    ): Promise<void> {
        if (!projectId || !contactData.phone) return;
        const cleanPhone = String(contactData.phone).replace(/\D/g, '') || String(contactData.phone).trim();
        if (!cleanPhone) return;

        const sb = HistoryHandler.getSupabase() || supabase;
        if (!sb) return;

        try {
            const otherServices = await this.getOtherServicesInProject(projectId, sourceServiceId);
            if (otherServices.length === 0) return;

            console.log(`📡 [CrossServiceContactSync] Replicando contacto/lead ${cleanPhone} a ${otherServices.length} servicios hermanos en proyecto ${projectId}:`, otherServices);

            for (const targetServiceId of otherServices) {
                // 1. Verificar si ya existe el chat en la instancia destino
                const { data: existingChat } = await sb
                    .from('chats')
                    .select('id, name, email, cuit_dni, address, notes, crm_status, crm_due_date, is_lead, metadata')
                    .eq('id', cleanPhone)
                    .eq('project_id', projectId)
                    .eq('service_id', targetServiceId)
                    .maybeSingle();

                const mergedMetadata = {
                    ...(existingChat?.metadata || {}),
                    ...(contactData.metadata || {})
                };

                if (existingChat) {
                    // Actualizar ÚNICAMENTE datos de contacto y ficha de lead.
                    // NUNCA sobreescribir last_message, last_message_at, unread_count, bot_enabled, assigned_agent ni messages.
                    const chatUpdate: any = {
                        metadata: mergedMetadata
                    };

                    if (contactData.name !== undefined && contactData.name !== null) chatUpdate.name = contactData.name;
                    if (contactData.email !== undefined) chatUpdate.email = contactData.email;
                    if (contactData.cuit_dni !== undefined) chatUpdate.cuit_dni = normalizeCuitDni(contactData.cuit_dni) || null;
                    if (contactData.address !== undefined) chatUpdate.address = contactData.address;
                    if (contactData.notes !== undefined) chatUpdate.notes = contactData.notes;
                    if (contactData.crm_status !== undefined) chatUpdate.crm_status = contactData.crm_status;
                    if (contactData.crm_due_date !== undefined) chatUpdate.crm_due_date = contactData.crm_due_date;
                    if (contactData.is_lead !== undefined) chatUpdate.is_lead = contactData.is_lead;
                    if (contactData.tax_status !== undefined) chatUpdate.tax_status = contactData.tax_status;
                    if (contactData.offered_product !== undefined) chatUpdate.offered_product = contactData.offered_product;
                    if (contactData.source !== undefined) chatUpdate.source = contactData.source;

                    const { error: upErr } = await sb
                        .from('chats')
                        .update(chatUpdate)
                        .eq('id', cleanPhone)
                        .eq('project_id', projectId)
                        .eq('service_id', targetServiceId);

                    if (upErr) {
                        console.warn(`[CrossServiceContactSync] ⚠️ Error actualizando chat ${cleanPhone} en servicio ${targetServiceId}:`, upErr.message);
                    }
                } else {
                    // Si el chat no existía en el otro servicio, crearlo como contacto conocido sin mensajes previos
                    const isBlacklisted = await HistoryHandler.isContactBlacklisted(cleanPhone, projectId, targetServiceId);

                    const insertRow: any = {
                        id: cleanPhone,
                        project_id: projectId,
                        service_id: targetServiceId,
                        name: contactData.name || null,
                        email: contactData.email || null,
                        cuit_dni: normalizeCuitDni(contactData.cuit_dni) || null,
                        address: contactData.address || null,
                        notes: contactData.notes || null,
                        is_lead: contactData.is_lead !== undefined ? contactData.is_lead : false,
                        crm_status: contactData.crm_status || null,
                        crm_due_date: contactData.crm_due_date || null,
                        tax_status: contactData.tax_status || null,
                        offered_product: contactData.offered_product || null,
                        source: contactData.source || 'cross_service_sync',
                        metadata: mergedMetadata,
                        type: 'whatsapp',
                        bot_enabled: !isBlacklisted,
                        assigned_agent: 'asistente1',
                        unread_count: 0,
                        last_message_at: new Date().toISOString()
                    };

                    const { error: insErr } = await sb
                        .from('chats')
                        .insert(insertRow);

                    if (insErr && insErr.code !== '23505') {
                        console.warn(`[CrossServiceContactSync] ⚠️ Error insertando chat ${cleanPhone} en servicio ${targetServiceId}:`, insErr.message);
                    }
                }

                // Sincronizar etiquetas de chats si se proveyeron tagIds
                if (Array.isArray(contactData.tagIds) && contactData.tagIds.length > 0) {
                    try {
                        const tagRows = contactData.tagIds.map((tagId: string) => ({
                            chat_id: cleanPhone,
                            tag_id: tagId,
                            project_id: projectId,
                            service_id: targetServiceId
                        }));

                        await sb
                            .from('chat_tags')
                            .upsert(tagRows, { onConflict: 'chat_id,tag_id,project_id' });
                    } catch (tagErr: any) {
                        console.warn(`[CrossServiceContactSync] Error asignando etiquetas para ${cleanPhone} en ${targetServiceId}:`, tagErr.message);
                    }
                }

                HistoryHandler.invalidateChatCache(cleanPhone, projectId);
            }
        } catch (err: any) {
            console.error('[CrossServiceContactSync] ❌ Error en syncContactAndLeadAcrossServices:', err.message);
        }
    }

    /**
     * Sincroniza un lote masivo de contactos hacia los demás servicios del proyecto (usado en importación Excel).
     */
    static async syncBatchContactsAcrossServices(
        projectId: string,
        sourceServiceId: string | null,
        chats: any[]
    ): Promise<void> {
        if (!projectId || !Array.isArray(chats) || chats.length === 0) return;

        const sb = HistoryHandler.getSupabase() || supabase;
        if (!sb) return;

        try {
            const otherServices = await this.getOtherServicesInProject(projectId, sourceServiceId);
            if (otherServices.length === 0) return;

            console.log(`📦 [CrossServiceContactSync] Replicando lote de ${chats.length} contactos a ${otherServices.length} servicios hermanos en proyecto ${projectId}:`, otherServices);

            for (const targetServiceId of otherServices) {
                // Clonar datos de contacto y ficha de lead para el servicio destino, manteniendo mensajería limpia
                const replicatedChats = chats.map((c) => {
                    const cleanId = String(c.id || c.phone || '').replace(/\D/g, '') || String(c.id || c.phone || '').trim();
                    return {
                        id: cleanId,
                        project_id: projectId,
                        service_id: targetServiceId,
                        name: c.name || null,
                        type: c.type || 'whatsapp',
                        metadata: c.metadata || {},
                        is_lead: c.is_lead !== undefined ? c.is_lead : false,
                        bot_enabled: c.bot_enabled !== undefined ? c.bot_enabled : true,
                        assigned_agent: c.assigned_agent || 'asistente1',
                        cuit_dni: c.cuit_dni || null,
                        email: c.email || null,
                        address: c.address || null,
                        notes: c.notes || null,
                        crm_status: c.crm_status || null,
                        assigned_to: c.assigned_to || null,
                        // Limpieza de mensajería para no mezclar historiales
                        unread_count: 0
                    };
                });

                // Upsert en la tabla chats para el servicio destino
                await HistoryHandler.syncChats(replicatedChats, projectId, targetServiceId);
            }
        } catch (err: any) {
            console.error('[CrossServiceContactSync] ❌ Error en syncBatchContactsAcrossServices:', err.message);
        }
    }

    /**
     * Si un contacto no existe en la instancia actual, busca si ya fue registrado previamente
     * en otra instancia del mismo proyecto para heredar sus datos de contacto y del lead.
     */
    static async inheritContactDataFromSibling(
        projectId: string,
        currentServiceId: string,
        phone: string
    ): Promise<any | null> {
        if (!projectId || !phone) return null;
        const cleanPhone = String(phone).replace(/\D/g, '') || String(phone).trim();
        if (!cleanPhone) return null;

        const sb = HistoryHandler.getSupabase() || supabase;
        if (!sb) return null;

        try {
            // Buscar si existe en chats de este proyecto con service_id diferente
            const { data: siblingChat } = await sb
                .from('chats')
                .select('name, email, cuit_dni, address, notes, is_lead, crm_status, crm_due_date, tax_status, offered_product, source, metadata')
                .eq('id', cleanPhone)
                .eq('project_id', projectId)
                .neq('service_id', currentServiceId)
                .not('name', 'is', null)
                .limit(1)
                .maybeSingle();

            if (siblingChat) {
                console.log(`🧬 [CrossServiceContactSync] Heredando datos de contacto para ${cleanPhone} desde otra instancia del proyecto ${projectId}:`, {
                    nombre: siblingChat.name,
                    cuit: siblingChat.cuit_dni,
                    is_lead: siblingChat.is_lead
                });
                return siblingChat;
            }

            // Fallback: Buscar en la tabla contactos
            const { data: contactRow } = await sb
                .from('contactos')
                .select('name, email, phone_raw, phone_normalized, metadata, source')
                .eq('project_id', projectId)
                .or(`phone_normalized.eq.${cleanPhone},whatsapp_channel.eq.${cleanPhone}`)
                .limit(1)
                .maybeSingle();

            if (contactRow && contactRow.name) {
                return {
                    name: contactRow.name,
                    email: contactRow.email,
                    metadata: contactRow.metadata || {},
                    source: contactRow.source
                };
            }

            return null;
        } catch (e: any) {
            console.warn(`[CrossServiceContactSync] ⚠️ Error al intentar heredar datos de sibling para ${cleanPhone}:`, e.message);
            return null;
        }
    }
}
