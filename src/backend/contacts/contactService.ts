import { supabase } from '../db/historyHandler';
import { ContactChannel, normalizeChannelValue, normalizeContactPhone } from './contactNormalizer';

export interface ContactPayload {
    channel?: ContactChannel | null;
    channelValue?: string | null;
    name?: string | null;
    phoneRaw?: string | null;
    phoneNormalized?: string | null;
    email?: string | null;
    whatsappChannel?: string | null;
    instagramChannel?: string | null;
    facebookChannel?: string | null;
    telegramChannel?: string | null;
    webchatChannel?: string | null;
    source?: string | null;
    metadata?: Record<string, any> | null;
}

export interface ListContactsOptions {
    limit?: number;
    offset?: number;
    search?: string | null;
    channel?: ContactChannel | null;
}

const CHANNEL_COLUMN: Record<ContactChannel, string> = {
    whatsapp: 'whatsapp_channel',
    instagram: 'instagram_channel',
    facebook: 'facebook_channel',
    telegram: 'telegram_channel',
    webchat: 'webchat_channel'
};

const CONTACT_SELECT = [
    'id',
    'project_id',
    'service_id',
    'name',
    'phone_raw',
    'phone_normalized',
    'email',
    'whatsapp_channel',
    'instagram_channel',
    'facebook_channel',
    'telegram_channel',
    'webchat_channel',
    'source',
    'metadata',
    'created_at',
    'updated_at'
].join(', ');

const cleanText = (value: any): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
};

const isDuplicateError = (error: any): boolean => {
    return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate key');
};

export class ContactService {
    static normalizePhone(rawPhone: string | null | undefined): string | null {
        return normalizeContactPhone(rawPhone);
    }

    static async listContacts(projectId: string, serviceId: string, options: ListContactsOptions = {}): Promise<any[]> {
        const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
        const offset = Math.max(Number(options.offset) || 0, 0);

        let query = supabase
            .from('contactos')
            .select(CONTACT_SELECT)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .order('updated_at', { ascending: false })
            .range(offset, offset + limit - 1);

        const search = cleanText(options.search);
        if (search) {
            const normalizedSearch = normalizeContactPhone(search);
            const escapedSearch = search.replace(/[%_]/g, '\\$&');
            const filters = [
                `name.ilike.%${escapedSearch}%`,
                `email.ilike.%${escapedSearch}%`,
                `whatsapp_channel.ilike.%${escapedSearch}%`,
                `instagram_channel.ilike.%${escapedSearch}%`,
                `facebook_channel.ilike.%${escapedSearch}%`,
                `telegram_channel.ilike.%${escapedSearch}%`,
                `webchat_channel.ilike.%${escapedSearch}%`
            ];
            if (normalizedSearch) {
                filters.push(`phone_normalized.ilike.%${normalizedSearch}%`);
            }
            query = query.or(filters.join(','));
        }

        if (options.channel && CHANNEL_COLUMN[options.channel]) {
            query = query.not(CHANNEL_COLUMN[options.channel], 'is', null);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data as any[]) || [];
    }

    static async getContact(projectId: string, serviceId: string, contactId: string): Promise<any | null> {
        const { data, error } = await supabase
            .from('contactos')
            .select(CONTACT_SELECT)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .eq('id', contactId)
            .maybeSingle();

        if (error) throw error;
        return (data as any) || null;
    }

    static async findContactByChannel(projectId: string, serviceId: string, channel: ContactChannel, channelValue: string | null | undefined): Promise<any | null> {
        const column = CHANNEL_COLUMN[channel];
        const value = normalizeChannelValue(channel, channelValue);
        if (!column || !value) return null;

        const { data, error } = await supabase
            .from('contactos')
            .select(CONTACT_SELECT)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .eq(column, value)
            .maybeSingle();

        if (error) throw error;
        return (data as any) || null;
    }

    static async findContactByPhone(projectId: string, serviceId: string, phone: string | null | undefined): Promise<any | null> {
        const phoneNormalized = normalizeContactPhone(phone);
        if (!phoneNormalized) return null;

        const { data, error } = await supabase
            .from('contactos')
            .select(CONTACT_SELECT)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .eq('phone_normalized', phoneNormalized)
            .maybeSingle();

        if (error) throw error;
        return (data as any) || null;
    }

    static async createOrUpdateContact(projectId: string, serviceId: string, payload: ContactPayload, isCrossSync = false): Promise<any> {
        const row = this.buildContactRow(projectId, serviceId, payload);
        const existing = await this.resolveExistingContact(projectId, serviceId, row);
        let result: any = null;

        if (existing) {
            const { data, error } = await supabase
                .from('contactos')
                .update({
                    ...this.mergeContactRows(existing, row),
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
                .eq('project_id', projectId)
                .eq('service_id', serviceId)
                .select(CONTACT_SELECT)
                .single();

            if (error) throw error;
            result = data as any;
        } else {
            const insertRow = { ...row, source: row.source || 'manual' };
            const { data, error } = await supabase
                .from('contactos')
                .insert(insertRow)
                .select(CONTACT_SELECT)
                .single();

            if (error) {
                if (isDuplicateError(error)) {
                    const duplicate = await this.resolveExistingContact(projectId, serviceId, row);
                    if (duplicate) result = duplicate;
                }
                if (!result) throw error;
            } else {
                result = data as any;
            }
        }

        // Replicar en los demás servicios del proyecto si no es una llamada recursiva
        if (!isCrossSync && projectId) {
            try {
                const { CrossServiceContactSync } = await import('./crossServiceContactSync');
                const otherServices = await CrossServiceContactSync.getOtherServicesInProject(projectId, serviceId);
                for (const targetService of otherServices) {
                    await this.createOrUpdateContact(projectId, targetService, payload, true);
                }

                // Sincronizar también en la tabla chats para que esté visible en CRM y contactos de todas las instancias
                const phone = payload.phoneNormalized || payload.phoneRaw || payload.whatsappChannel;
                if (phone) {
                    await CrossServiceContactSync.syncContactAndLeadAcrossServices(projectId, serviceId, {
                        phone,
                        name: payload.name,
                        email: payload.email,
                        source: payload.source || 'contactos_sync',
                        metadata: payload.metadata || {}
                    });
                }
            } catch (syncErr: any) {
                console.warn('[ContactService] ⚠️ Error en propagación cross-service:', syncErr.message);
            }
        }

        return result;
    }

    static async updateContact(projectId: string, serviceId: string, contactId: string, payload: ContactPayload, isCrossSync = false): Promise<any | null> {
        const existing = await this.getContact(projectId, serviceId, contactId);
        if (!existing) return null;

        const row = this.buildContactRow(projectId, serviceId, payload);
        const { data, error } = await supabase
            .from('contactos')
            .update({
                ...this.mergeContactRows(existing, row),
                updated_at: new Date().toISOString()
            })
            .eq('id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId)
            .select(CONTACT_SELECT)
            .single();

        if (error) throw error;
        const result = data as any;

        // Replicar actualización a los demás servicios
        if (!isCrossSync && projectId) {
            try {
                const { CrossServiceContactSync } = await import('./crossServiceContactSync');
                const otherServices = await CrossServiceContactSync.getOtherServicesInProject(projectId, serviceId);
                for (const targetService of otherServices) {
                    await this.createOrUpdateContact(projectId, targetService, payload, true);
                }

                const phone = payload.phoneNormalized || payload.phoneRaw || existing.phone_normalized || existing.phone_raw;
                if (phone) {
                    await CrossServiceContactSync.syncContactAndLeadAcrossServices(projectId, serviceId, {
                        phone,
                        name: payload.name !== undefined ? payload.name : existing.name,
                        email: payload.email !== undefined ? payload.email : existing.email,
                        metadata: payload.metadata || {}
                    });
                }
            } catch (syncErr: any) {
                console.warn('[ContactService] ⚠️ Error actualizando contacto cross-service:', syncErr.message);
            }
        }

        return result;
    }

    static async deleteContact(projectId: string, serviceId: string, contactId: string) {
        const { error } = await supabase
            .from('contactos')
            .delete()
            .eq('id', contactId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        if (error) throw error;
        return { success: true };
    }

    static async linkChatToContact(projectId: string, serviceId: string, chatId: string, contactId: string) {
        const { error } = await supabase
            .from('chats')
            .update({ contact_id: contactId })
            .eq('id', chatId)
            .eq('project_id', projectId)
            .eq('service_id', serviceId);

        if (error) throw error;
        return { success: true };
    }

    static async resolveContactForIncomingWhatsapp(projectId: string, serviceId: string, chatId: string, displayName?: string | null): Promise<any | null> {
        const whatsappChannel = normalizeChannelValue('whatsapp', chatId);
        if (!whatsappChannel) return null;

        const existing = await this.findContactByChannel(projectId, serviceId, 'whatsapp', whatsappChannel)
            || await this.findContactByPhone(projectId, serviceId, whatsappChannel);

        const contact = existing || await this.createOrUpdateContact(projectId, serviceId, {
            name: displayName || null,
            phoneRaw: chatId,
            phoneNormalized: whatsappChannel,
            whatsappChannel,
            source: 'whatsapp_inbound',
            metadata: { created_from_chat_id: chatId }
        });

        await this.linkChatToContact(projectId, serviceId, chatId, contact.id);
        return contact;
    }

    private static buildContactRow(projectId: string, serviceId: string, payload: ContactPayload) {
        const phoneRaw = cleanText(payload.phoneRaw);
        const phoneNormalized = normalizeContactPhone(payload.phoneNormalized || phoneRaw || payload.whatsappChannel || null);
        const selectedChannel = payload.channel && CHANNEL_COLUMN[payload.channel] ? payload.channel : null;
        const channelValue = cleanText(payload.channelValue);
        const whatsappChannel = normalizeChannelValue('whatsapp', payload.whatsappChannel || (selectedChannel === 'whatsapp' ? channelValue || phoneNormalized : null) || (!selectedChannel ? phoneNormalized : null));

        return {
            project_id: projectId,
            service_id: serviceId,
            name: cleanText(payload.name),
            phone_raw: phoneRaw,
            phone_normalized: phoneNormalized,
            email: cleanText(payload.email),
            whatsapp_channel: whatsappChannel,
            instagram_channel: normalizeChannelValue('instagram', payload.instagramChannel || (selectedChannel === 'instagram' ? channelValue : null)),
            facebook_channel: normalizeChannelValue('facebook', payload.facebookChannel || (selectedChannel === 'facebook' ? channelValue : null)),
            telegram_channel: normalizeChannelValue('telegram', payload.telegramChannel || (selectedChannel === 'telegram' ? channelValue : null)),
            webchat_channel: normalizeChannelValue('webchat', payload.webchatChannel || (selectedChannel === 'webchat' ? channelValue : null)),
            source: cleanText(payload.source),
            metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
        };
    }

    private static async resolveExistingContact(projectId: string, serviceId: string, row: any) {
        if (row.whatsapp_channel) {
            const contact = await this.findContactByChannel(projectId, serviceId, 'whatsapp', row.whatsapp_channel);
            if (contact) return contact;
        }

        if (row.phone_normalized) {
            const contact = await this.findContactByPhone(projectId, serviceId, row.phone_normalized);
            if (contact) return contact;
        }

        for (const channel of ['instagram', 'facebook', 'telegram', 'webchat'] as ContactChannel[]) {
            const column = CHANNEL_COLUMN[channel];
            if (!row[column]) continue;
            const contact = await this.findContactByChannel(projectId, serviceId, channel, row[column]);
            if (contact) return contact;
        }

        return null;
    }

    private static mergeContactRows(existing: any, next: any) {
        const merged: any = {};
        for (const key of [
            'name',
            'phone_raw',
            'phone_normalized',
            'email',
            'whatsapp_channel',
            'instagram_channel',
            'facebook_channel',
            'telegram_channel',
            'webchat_channel',
            'source'
        ]) {
            merged[key] = next[key] ?? existing[key] ?? null;
        }

        merged.metadata = {
            ...(existing.metadata || {}),
            ...(next.metadata || {})
        };

        return merged;
    }
}
