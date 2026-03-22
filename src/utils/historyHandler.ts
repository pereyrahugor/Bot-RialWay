
import { createClient } from "@supabase/supabase-js";
import { EventEmitter } from "events";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);
export { supabase };

// Emitter para notificar cambios en tiempo real a otros módulos (como el de WebSockets)
export const historyEvents = new EventEmitter();

// Identificador único para este bot específico
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "default_project";
const PROJECT_NAME = process.env.RAILWAY_SERVICE_NAME || "Bot-RialWay";
const PROJECT_IDENTIFIER = process.env.RAILWAY_PROJECT_NAME ? `${process.env.RAILWAY_PROJECT_NAME}-${PROJECT_NAME}` : PROJECT_ID;

export interface Chat {
    id: string;
    project_id: string;
    type: 'whatsapp' | 'webchat';
    name: string | null;
    email: string | null;
    notes: string | null;
    source: string | null;
    bot_enabled: boolean;
    last_message_at: string;
    last_human_message_at: string | null;
    metadata: any;
}

export interface Message {
    id?: string;
    chat_id: string;
    project_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    type: 'text' | 'image' | 'audio' | 'video' | 'location' | 'document';
    created_at?: string;
}

export class HistoryHandler {

    static async initDatabase() {
        if (!supabase) return;

        console.log('🔍 [HistoryHandler] Verificando tablas de historial...');

        const tables = [
            {
                name: 'chats',
                sql: `CREATE TABLE IF NOT EXISTS chats (
                    id TEXT,
                    project_id TEXT,
                    type TEXT NOT NULL,
                    name TEXT,
                    bot_enabled BOOLEAN DEFAULT true,
                    last_message_at TIMESTAMPTZ DEFAULT NOW(),
                    last_human_message_at TIMESTAMPTZ,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    PRIMARY KEY (id, project_id)
                );`
            },
            {
                name: 'tags',
                sql: `CREATE TABLE IF NOT EXISTS tags (
                    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                    project_id TEXT,
                    name TEXT NOT NULL,
                    color TEXT DEFAULT '#000000',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );`
            },
            {
                name: 'chat_tags',
                sql: `CREATE TABLE IF NOT EXISTS chat_tags (
                    chat_id TEXT,
                    tag_id uuid REFERENCES tags(id) ON DELETE CASCADE,
                    project_id TEXT,
                    PRIMARY KEY (chat_id, tag_id, project_id),
                    FOREIGN KEY (chat_id, project_id) REFERENCES chats(id, project_id)
                );`
            },
            {
                name: 'messages',
                sql: `CREATE TABLE IF NOT EXISTS messages (
                    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                    chat_id TEXT,
                    project_id TEXT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    type TEXT DEFAULT 'text',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    FOREIGN KEY (chat_id, project_id) REFERENCES chats(id, project_id)
                );`
            },
            {
                name: 'tickets',
                sql: `CREATE TABLE IF NOT EXISTS tickets (
                    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                    project_id TEXT,
                    chat_id TEXT,
                    titulo TEXT NOT NULL,
                    descripcion TEXT,
                    tipo TEXT DEFAULT 'Soporte',
                    estado TEXT DEFAULT 'Abierto',
                    prioridad TEXT DEFAULT 'Media',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    FOREIGN KEY (chat_id, project_id) REFERENCES chats(id, project_id)
                );`
            },
            {
                name: 'meta_onboarding',
                sql: `CREATE TABLE IF NOT EXISTS meta_onboarding (
                    project_id TEXT PRIMARY KEY,
                    waba_id TEXT,
                    phone_number_id TEXT,
                    access_token TEXT,
                    onboarding_data JSONB DEFAULT '{}'::jsonb,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );`
            },
            {
                name: 'settings',
                sql: `CREATE TABLE IF NOT EXISTS settings (
                    project_id TEXT,
                    key TEXT,
                    value TEXT,
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    PRIMARY KEY (project_id, key)
                );`
            }
        ];

        for (const table of tables) {
            console.log(`🔍 [HistoryHandler] Procesando tabla: ${table.name}`);
            try {
                // Verificar si la tabla existe
                const { error: checkError } = await supabase.from(table.name).select('*').limit(1);
                
                if (checkError && (checkError.code === '42P01' || checkError.code === 'PGRST204' || checkError.code === 'PGRST205')) {
                    console.log(`⚠️ Tabla '${table.name}' no encontrada. Creándola...`);
                    const { error: rpcError } = await supabase.rpc('exec_sql', { query: table.sql });
                    
                    if (rpcError) {
                        console.error(`❌ Error al crear tabla '${table.name}':`, rpcError.message);
                        if (rpcError.message.includes('function') && rpcError.message.includes('does not exist')) {
                            console.error(`💡 TIP: Debes crear la función 'exec_sql' en el SQL Editor de Supabase.`);
                        }
                    } else {
                        console.log(`✅ Tabla '${table.name}' creada exitosamente.`);
                    }
                } else if (checkError && checkError.code !== '42703') {
                    console.error(`❌ Error verificando tabla '${table.name}':`, checkError.message);
                } else {
                    // Verificar columnas adicionales (Migración)
                    const { error: columnError } = await supabase.from(table.name).select('project_id').limit(1);
                    if (columnError && columnError.code === '42703') {
                         console.log(`🔧 Actualizando tabla '${table.name}' para incluir project_id...`);
                         const alterSql = table.name === 'chats' 
                            ? `ALTER TABLE chats ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'default_project'; 
                               DO $$ 
                               BEGIN 
                                 IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='chats_pkey') THEN
                                   ALTER TABLE chats DROP CONSTRAINT chats_pkey; 
                                 END IF;
                               END $$;
                               ALTER TABLE chats ADD PRIMARY KEY (id, project_id);`
                            : `ALTER TABLE messages ADD COLUMN IF NOT EXISTS project_id TEXT DEFAULT 'default_project';`;
                         
                         const { error: alterError } = await supabase.rpc('exec_sql', { query: alterSql });
                         if (alterError) {
                             console.error(`❌ Error en migración de '${table.name}':`, alterError.message);
                         } else {
                             console.log(`✅ Tabla '${table.name}' migrada a multitenancy.`);
                         }
                    }

                    // Migración para last_human_message_at y campos CRM
                    if (table.name === 'chats') {
                        const { error: humanMsgErr } = await supabase.from('chats').select('last_human_message_at').limit(1);
                        if (humanMsgErr && humanMsgErr.code === '42703') {
                            console.log(`🔧 Agregando columna last_human_message_at a chats...`);
                            await supabase.rpc('exec_sql', { query: `ALTER TABLE chats ADD COLUMN last_human_message_at TIMESTAMPTZ;` });
                        }

                        // Verificar campos CRM
                        const { error: crmErr } = await supabase.from('chats').select('notes, email, source').limit(1);
                        if (crmErr && crmErr.code === '42703') {
                            console.log(`🔧 Agregando columnas CRM a chats...`);
                            await supabase.rpc('exec_sql', { query: `ALTER TABLE chats ADD COLUMN IF NOT EXISTS notes TEXT, ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS source TEXT;` });
                        }
                    }

                    console.log(`✅ Tabla '${table.name}' verificada.`);
                }
            } catch (fatalErr) {
                console.error(`❌ Error fatal inicializando tabla '${table.name}':`, fatalErr);
            }
        }
        console.log('✅ [HistoryHandler] Inicialización completa.');
    }
    
    /**
     * Obtiene o crea un registro de chat
     */
    static async getOrCreateChat(chatId: string, type: 'whatsapp' | 'webchat', name: string | null = null): Promise<Chat | null> {
        try {
            const { data, error } = await supabase
                .from('chats')
                .select('*')
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID)
                .maybeSingle();

            if (!data) {
                const { data: newData, error: insertError } = await supabase
                    .from('chats')
                    .insert({
                        id: chatId,
                        project_id: PROJECT_ID,
                        type,
                        name,
                        bot_enabled: true,
                        last_message_at: new Date().toISOString()
                    })
                    .select()
                    .single();
                
                if (insertError) throw insertError;
                return newData;
            }

            if (error) throw error;

            // Actualizar nombre si es null y ahora tenemos uno
            if (name && !data.name) {
                await supabase.from('chats').update({ name }).eq('id', chatId).eq('project_id', PROJECT_ID);
            }

            return data;
        } catch (err) {
            console.error('[HistoryHandler] Error en getOrCreateChat:', err);
            return null;
        }
    }

    /**
     * Guarda un mensaje en la base de datos
     */
    static async saveMessage(chatId: string, role: 'user' | 'assistant' | 'system', content: string, type: string = 'text', contactName: string | null = null) {
        try {
            // Asegurar que el chat existe
            await this.getOrCreateChat(chatId, chatId.includes('@') ? 'whatsapp' : 'webchat', contactName);

            const { error } = await supabase
                .from('messages')
                .insert({
                    chat_id: chatId,
                    project_id: PROJECT_ID,
                    role,
                    content,
                    type,
                    created_at: new Date().toISOString()
                });

            if (error) throw error;

            // Actualizar timestamp del último mensaje en el chat
            await supabase
                .from('chats')
                .update({ last_message_at: new Date().toISOString() })
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID);

            // Emitir evento para WebSockets
            historyEvents.emit('new_message', { chatId, role, content, type });

        } catch (err) {
            console.error('[HistoryHandler] Error en saveMessage:', err);
        }
    }

    /**
     * Actualiza los detalles de contacto (CRM)
     */
    static async updateContactDetails(chatId: string, details: { name?: string, email?: string, notes?: string, source?: string }) {
        try {
            const { error } = await supabase
                .from('chats')
                .update(details)
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID);

            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en updateContactDetails:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Verifica si el bot está habilitado para un usuario
     */
    static async isBotEnabled(chatId: string): Promise<boolean> {
        try {
            const { data, error } = await supabase
                .from('chats')
                .select('bot_enabled')
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID)
                .maybeSingle();

            if (error) throw error;
            return data ? data.bot_enabled : true;
        } catch (err) {
            console.error('[HistoryHandler] Error en isBotEnabled:', err);
            return true;
        }
    }

    /**
     * Cambia el estado del bot (Intervención humana)
     */
    static async toggleBot(chatId: string, enabled: boolean) {
        try {
            const updateData: any = { bot_enabled: enabled };
            if (enabled === false) {
                updateData.last_human_message_at = new Date().toISOString();
            }

            const { error } = await supabase
                .from('chats')
                .update(updateData)
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID);
            
            if (error) throw error;
            
            // Emitir evento para WebSockets
            historyEvents.emit('bot_toggled', { chatId, enabled });

            return { success: true };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en toggleBot:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Lista todos los chats activos (con tags incluidos)
     */
    static async listChats(limit: number = 20, offset: number = 0, search?: string, tagId?: string) {
        try {
            let query = supabase
                .from('chats')
                .select('*, chat_tags!inner(tag_id, tags(*))')
                .eq('project_id', PROJECT_ID);

            if (search) {
                // Filtro por nombre, ID, email, notas o fuente
                query = query.or(`name.ilike.%${search}%,id.ilike.%${search}%,email.ilike.%${search}%,notes.ilike.%${search}%,source.ilike.%${search}%`);
            }

            if (tagId) {
                // El !inner ya está en el select, así que podemos filtrar por tag_id
                query = query.eq('chat_tags.tag_id', tagId);
            } else {
                // Si no hay filtro por tag, queremos TODOS los chats, tengan tags o no.
                // Usamos left join (por defecto en PostgREST si no usamos !inner)
                query = supabase
                    .from('chats')
                    .select('*, chat_tags(tag_id, tags(*))')
                    .eq('project_id', PROJECT_ID);
                
                if (search) {
                    // Filtro por nombre, ID, email, notas o fuente
                    query = query.or(`name.ilike.%${search}%,id.ilike.%${search}%,email.ilike.%${search}%,notes.ilike.%${search}%,source.ilike.%${search}%`);
                }
            }

            const { data, error } = await query
                .order('last_message_at', { ascending: false })
                .range(offset, offset + limit - 1);
            
            if (error) throw error;
            
            return (data || []).map(chat => ({
                ...chat,
                tags: chat.chat_tags ? chat.chat_tags.map((ct: any) => ct.tags).filter((t: any) => t !== null) : []
            }));
        } catch (err) {
            console.error('[HistoryHandler] Error en listChats:', err);
            return [];
        }
    }

    /**
     * Obtiene los mensajes de un chat específico
     */
    static async getMessages(chatId: string, limit: number = 50, offset: number = 0) {
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .eq('project_id', PROJECT_ID)
                .order('created_at', { ascending: false }) // Primero los más nuevos para el LIMIT
                .range(offset, offset + limit - 1);
            
            if (error) throw error;
            return (data || []).reverse(); // Revertir para orden cronológico
        } catch (err) {
            console.error('[HistoryHandler] Error en getMessages:', err);
            return [];
        }
    }

    // --- Tag Management ---

    static async getTags() {
        try {
            const { data, error } = await supabase
                .from('tags')
                .select('*')
                .eq('project_id', PROJECT_ID)
                .order('name');
            if (error) throw error;
            return data;
        } catch (err) {
            console.error('[HistoryHandler] Error en getTags:', err);
            return [];
        }
    }

    static async createTag(name: string, color: string) {
        try {
            const { data, error } = await supabase
                .from('tags')
                .insert({ name, color, project_id: PROJECT_ID })
                .select()
                .single();
            if (error) throw error;
            return { success: true, tag: data };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    static async updateTag(id: string, name: string, color: string) {
        try {
            const { error } = await supabase
                .from('tags')
                .update({ name, color })
                .eq('id', id)
                .eq('project_id', PROJECT_ID);
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    static async deleteTag(id: string) {
        try {
            const { error } = await supabase
                .from('tags')
                .delete()
                .eq('id', id)
                .eq('project_id', PROJECT_ID);
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    static async addTagToChat(chatId: string, tagId: string) {
        try {
            const { error } = await supabase
                .from('chat_tags')
                .insert({ chat_id: chatId, tag_id: tagId, project_id: PROJECT_ID });
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    static async removeTagFromChat(chatId: string, tagId: string) {
        try {
            const { error } = await supabase
                .from('chat_tags')
                .delete()
                .eq('chat_id', chatId)
                .eq('tag_id', tagId)
                .eq('project_id', PROJECT_ID);
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }

    static async getChatTags(chatId: string) {
        try {
            const { data, error } = await supabase
                .from('chat_tags')
                .select('tag_id, tags(*)')
                .eq('chat_id', chatId)
                .eq('project_id', PROJECT_ID);
            if (error) throw error;
            return (data || []).map((item: any) => item.tags);
        } catch (err) {
            console.error('[HistoryHandler] Error en getChatTags:', err);
            return [];
        }
    }

    static async updateLastHumanMessage(chatId: string) {
        try {
            await supabase
                .from('chats')
                .update({ last_human_message_at: new Date().toISOString() })
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID);
        } catch (err) {
            console.error('[HistoryHandler] Error en updateLastHumanMessage:', err);
        }
    }

    /**
     * Guarda el thread_id de OpenAI en el metadata del chat
     */
    static async saveThreadId(chatId: string, threadId: string) {
        try {
            // Primero obtenemos metadata actual
            const { data } = await supabase
                .from('chats')
                .select('metadata')
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID)
                .maybeSingle();

            const currentMetadata = data?.metadata || {};
            const updatedMetadata = { ...currentMetadata, thread_id: threadId };

            await supabase
                .from('chats')
                .update({ metadata: updatedMetadata })
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID);
        } catch (err) {
            console.error('[HistoryHandler] Error en saveThreadId:', err);
        }
    }

    /**
     * Obtiene el thread_id de OpenAI del metadata del chat
     */
    static async getThreadId(chatId: string): Promise<string | null> {
        try {
            const { data } = await supabase
                .from('chats')
                .select('metadata')
                .eq('id', chatId)
                .eq('project_id', PROJECT_ID)
                .maybeSingle();

            return data?.metadata?.thread_id || null;
        } catch (err) {
            console.error('[HistoryHandler] Error en getThreadId:', err);
            return null;
        }
    }

    /**
     * Crea un nuevo ticket
     */
    static async createTicket(chatId: string, titulo: string, descripcion: string, tipo: string = 'Soporte', prioridad: string = 'Media') {
        try {
            const { data, error } = await supabase
                .from('tickets')
                .insert({
                    chat_id: chatId,
                    project_id: PROJECT_ID,
                    titulo,
                    descripcion,
                    tipo,
                    prioridad,
                    estado: 'Abierto'
                })
                .select()
                .single();

            if (error) throw error;
            
            // Emitir evento para WebSockets
            historyEvents.emit('ticket_updated', { chatId, ticket: data });
            
            return { success: true, ticket: data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en createTicket:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene el conteo de tickets pendientes (Abiertos o En progreso)
     */
    static async getPendingTicketsCount() {
        try {
            const { count, error } = await supabase
                .from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('project_id', PROJECT_ID)
                .in('estado', ['Abierto', 'En progreso']);

            if (error) throw error;
            return count || 0;
        } catch (err) {
            console.error('[HistoryHandler] Error en getPendingTicketsCount:', err);
            return 0;
        }
    }

    /**
     * Lista los tickets del proyecto
     */
    static async listTickets(limit: number = 50, offset: number = 0, estado?: string) {
        try {
            // Unir con la tabla chats para traer el nombre del contacto
            let query = supabase
                .from('tickets')
                .select('*, chats(name, id)')
                .eq('project_id', PROJECT_ID);

            if (estado) {
                query = query.eq('estado', estado);
            } else {
                query = query.in('estado', ['Abierto', 'En progreso']);
            }

            const { data, error } = await query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);
            
            if (error) {
                // Si falla por problemas de relación (JOIN), intentamos sin join
                if (error.code === 'PGRST200' || error.message.includes('relationship')) {
                    console.warn('[HistoryHandler] Reintentando listTickets sin JOIN debido a:', error.message);
                    let fallbackQuery = supabase
                        .from('tickets')
                        .select('*')
                        .eq('project_id', PROJECT_ID);
                    
                    if (estado) fallbackQuery = fallbackQuery.eq('estado', estado);
                    else fallbackQuery = fallbackQuery.in('estado', ['Abierto', 'En progreso']);

                    const { data: fallbackData, error: fallbackError } = await fallbackQuery
                        .order('created_at', { ascending: false })
                        .range(offset, offset + limit - 1);
                    
                    if (fallbackError) throw fallbackError;
                    return fallbackData || [];
                }
                throw error;
            }
            
            return data || [];
        } catch (err) {
            console.error('[HistoryHandler] Error en listTickets:', err);
            return [];
        }
    }
    /**
     * Actualiza el estado de un ticket
     */
    static async updateTicketStatus(ticketId: string, nuevoEstado: string) {
        try {
            const { data, error } = await supabase
                .from('tickets')
                .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
                .eq('id', ticketId)
                .eq('project_id', PROJECT_ID)
                .select()
                .maybeSingle();

            if (error) throw error;
            
            // Notificar cambios
            historyEvents.emit('ticket_updated', data);
            
            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en updateTicketStatus:', err);
            return { success: false, error: err.message };
        }
    }
    /**
     * Lista los leads que tienen datos de CRM (editados)
     */
    static async listEditedLeads(limit: number = 50, offset: number = 0) {
        try {
            const { data, error } = await supabase
                .from('chats')
                .select('*')
                .eq('project_id', PROJECT_ID)
                .or('notes.neq."",email.neq."",source.neq.""')
                .order('last_human_message_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[HistoryHandler] Error en listEditedLeads:', err);
            return [];
        }
    }
    /**
     * Guarda o actualiza los datos de onboarding de Meta
     */
    static async saveMetaOnboardingData(wabaId: string, phoneId: string, token: string, extra: any = {}) {
        try {
            const { data, error } = await supabase
                .from('meta_onboarding')
                .upsert({
                    project_id: PROJECT_ID,
                    waba_id: wabaId,
                    phone_number_id: phoneId,
                    access_token: token,
                    onboarding_data: extra,
                    status: 'active',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'project_id' })
                .select()
                .single();

            if (error) throw error;
            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en saveMetaOnboardingData:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene los datos de onboarding configurados
     */
    static async getMetaOnboardingData() {
        try {
            const { data, error } = await supabase
                .from('meta_onboarding')
                .select('*')
                .eq('project_id', PROJECT_ID)
                .maybeSingle();

            if (error) throw error;
            return data;
        } catch (err) {
            console.error('[HistoryHandler] Error en getMetaOnboardingData:', err);
            return null;
        }
    }

    static async saveSetting(key: string, value: string) {
        if (!supabase) return;
        const { error } = await supabase
            .from('settings')
            .upsert({ 
                project_id: PROJECT_IDENTIFIER, 
                key, 
                value, 
                updated_at: new Date().toISOString() 
            }, { onConflict: 'project_id,key' });

        if (error) console.error(`❌ [HistoryHandler] Error guardando setting ${key}:`, error);
    }

    static async getSetting(key: string): Promise<string | null> {
        if (!supabase) return null;
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('project_id', PROJECT_IDENTIFIER)
            .eq('key', key)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error(`❌ [HistoryHandler] Error obteniendo setting ${key}:`, error);
        }
        return data ? data.value : null;
    }
}

// Inicializar base de datos al cargar el modulo (Quitado para evitar race condition, se llama en app.ts main)
// HistoryHandler.initDatabase();
