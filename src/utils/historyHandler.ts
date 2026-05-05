
import { createClient } from "@supabase/supabase-js";
import { EventEmitter } from "events";
import dotenv from "dotenv";

import { vault } from "./vault";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || vault.supabaseUrl;
const supabaseKey = process.env.SUPABASE_KEY || vault.supabaseKey;
const supabase = createClient(supabaseUrl, supabaseKey);
export { supabase };

// Emitter para notificar cambios en tiempo real a otros módulos (como el de WebSockets)
export const historyEvents = new EventEmitter();

// Identificador único para este bot específico
// Identificador único para este bot específico (Usamos el UUID para consistencia total)
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "default_project";
const PROJECT_NAME = process.env.RAILWAY_SERVICE_NAME || "Bot-RialWay";

export interface Chat {
    id: string; // WAID (Teléfono) o identificador de Webchat
    user_id?: string | null; // BSUID (Meta Business-Scoped User ID)
    project_id: string;
    type: 'whatsapp' | 'webchat' | 'instagram' | 'messenger';
    name: string | null;
    email: string | null;
    notes: string | null;
    source: string | null;
    bot_enabled: boolean;
    last_message_at: string;
    assigned_to?: string | null;
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
    static readonly PROJECT_IDENTIFIER = process.env.RAILWAY_PROJECT_ID || "default_project";
    static readonly PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "default_project";
    static initialized = false;

    static getSupabase() {
        return supabase;
    }

    // Listas de variables para control de UI y persistencia
    static readonly EDITABLE_KEYS = [
        'ASSISTANT_NAME', 'ASSISTANT_ID', 'ASSISTANT_2', 'ASSISTANT_3', 'ASSISTANT_4', 'ASSISTANT_5',
        'ASSISTANT_PROMPT', 'ASSISTANT_PROMPT_2', 'ASSISTANT_PROMPT_3', 'ASSISTANT_PROMPT_4', 'ASSISTANT_PROMPT_5',
        'OPENAI_API_KEY', 'ASSISTANT_ID_IMG', 'OPENAI_API_KEY_IMG', 'VECTOR_STORE_ID', 'EXTRA_SYSTEM_PROMPT',
        'DB_TABLES', 'OPENAI_TOOLS_DEFINITION', 'msjCierre', 'msjSeguimiento1', 'msjSeguimiento2', 'msjSeguimiento3',
        'timeOutCierre', 'timeOutSeguimiento2', 'timeOutSeguimiento3', 'ID_GRUPO_RESUMEN', 'ID_GRUPO_RESUMEN_2',
        'SHEET_ID_RESUMEN', 'SHEET_ID_UPDATE', 'DOCX_ID_UPDATE', 'GOOGLE_CALENDAR_ID',
        'ADMIN_USER', 'ADMIN_PASS', 'WHATSAPP_VISIBLE', 'INSTAGRAM_VISIBLE', 'MESSENGER_VISIBLE', 'CRM_VISIBLE'
    ];

    static readonly FIXED_KEYS = [
        'SUPABASE_URL', 'SUPABASE_KEY', 'RAILWAY_TOKEN', 'BACKOFFICE_TOKEN', 
        'GOOGLE_PRIVATE_KEY', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_MAPS_API_KEY',
        'META_CONFIG_ID', 'META_APP_ID', 'META_APP_SECRET'
    ];

    static async initDatabase() {
        if (this.initialized) return;
        console.log(`[HistoryHandler] Initializing DB for Project: ${this.PROJECT_IDENTIFIER}`);
        if (!supabase) return;

        // 0. Bootstrap de configuración
        await this.bootstrapConfig();

        console.log('🔍 [HistoryHandler] Verificando tablas de historial...');

        const tables = [
            {
                name: 'chats',
                sql: `CREATE TABLE IF NOT EXISTS chats (
                    id TEXT,
                    user_id TEXT,
                    project_id TEXT,
                    type TEXT NOT NULL,
                    name TEXT,
                    bot_enabled BOOLEAN DEFAULT true,
                    assigned_agent TEXT DEFAULT 'asistente1',
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
                name: 'indices',
                sql: `
                    CREATE INDEX IF NOT EXISTS idx_messages_chat_project ON messages(chat_id, project_id);
                    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
                    CREATE INDEX IF NOT EXISTS idx_chats_project_id ON chats(project_id);
                    CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_at DESC);
                `
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
                    external_id TEXT UNIQUE,
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
                    owner_id uuid REFERENCES users(id),
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
            },
            {
                name: 'users',
                sql: `CREATE TABLE IF NOT EXISTS users (
                    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
                    project_id TEXT,
                    username TEXT NOT NULL,
                    password TEXT NOT NULL,
                    full_name TEXT,
                    meta_id TEXT,
                    role TEXT DEFAULT 'subuser',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE (project_id, username)
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

                    // Migración para user_id (Meta BSUID)
                    const { error: bsuidErr } = await supabase.from('chats').select('user_id').limit(1);
                    if (bsuidErr && bsuidErr.code === '42703') {
                        console.log(`🔧 Agregando columna user_id (BSUID) a chats...`);
                        await supabase.rpc('exec_sql', { query: `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_id TEXT;` });
                    }

                    // Migración para external_id en mensajes (Deduplicación)
                    const { error: extIdErr } = await supabase.from('messages').select('external_id').limit(1);
                    if (extIdErr && extIdErr.code === '42703') {
                        console.log(`🔧 Agregando columna external_id a messages...`);
                        await supabase.rpc('exec_sql', { query: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_id TEXT;` });
                        await supabase.rpc('exec_sql', { query: `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_id ON messages (external_id);` });
                    }

                    // Migración para assigned_to
                        const { error: assignedErr } = await supabase.from('chats').select('assigned_to').limit(1);
                        if (assignedErr && assignedErr.code === '42703') {
                            console.log(`🔧 Agregando columna assigned_to a chats...`);
                            await supabase.rpc('exec_sql', { query: `ALTER TABLE chats ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id);` });
                        }
                    }

                    // Migración para owner_id en meta_onboarding
                    if (table.name === 'meta_onboarding') {
                        const { error: ownerErr } = await supabase.from('meta_onboarding').select('owner_id').limit(1);
                        if (ownerErr && ownerErr.code === '42703') {
                            console.log(`🔧 Agregando columna owner_id a meta_onboarding...`);
                            await supabase.rpc('exec_sql', { query: `ALTER TABLE meta_onboarding ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);` });
                        }
                    }

                    console.log(`✅ Tabla '${table.name}' verificada.`);
                }
            } catch (fatalErr) {
                console.error(`❌ Error fatal inicializando tabla '${table.name}':`, fatalErr);
            }
        }

        // Crear índices críticos para optimizar I/O (Lectura rápida)
        console.log('🔍 [HistoryHandler] Verificando índices críticos...');
        try {
            const indexingSql = `
                CREATE INDEX IF NOT EXISTS idx_messages_chat_project_created ON messages (chat_id, project_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_chats_project_last_msg ON chats (project_id, last_message_at DESC);
                CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_lookup ON whatsapp_sessions (project_id, session_id, key_id);
                CREATE INDEX IF NOT EXISTS idx_tickets_project_status_chat ON tickets (project_id, estado, chat_id);
            `;
            const { error: indexError } = await supabase.rpc('exec_sql', { query: indexingSql });
            if (indexError) {
                console.warn('⚠️ No se pudieron crear los índices automáticamente:', indexError.message);
                console.warn('💡 Tip: Intenta ejecutarlos manualmente en el SQL Editor de Supabase si el problema persiste.');
            } else {
                console.log('✅ Índices de rendimiento verificados.');
            }
        } catch (err) {
            console.error('❌ Error fatal creando índices:', err);
        }

        console.log('✅ [HistoryHandler] Inicialización completa.');
    }
    
    /**
     * Normaliza los IDs de chat para evitar duplicados entre Meta y Baileys
     */
    static normalizeId(id: string): string {
        if (!id) return id;
        // Eliminar sufijo de WhatsApp Business API tradicional si existe
        let cleanId = id.replace(/@s\.whatsapp\.net$/, '');
        cleanId = cleanId.replace(/@c\.us$/, '');
        return cleanId;
    }

    /**
     * Obtiene los detalles completos de un chat, incluyendo etiquetas
     */
    static async getChat(rawChatId: string, forcedProjectId?: string): Promise<any | null> {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        try {
            const { data, error } = await supabase
                .from('chats')
                .select('*, chat_tags(tag_id, tags(*))')
                .eq('id', chatId)
                .eq('project_id', currentProjectId)
                .maybeSingle();

            if (error) throw error;
            if (data) {
                data.tags = data.chat_tags ? data.chat_tags.map((ct: any) => ct.tags).filter((t: any) => t !== null) : [];
            }
            return data;
        } catch (err) {
            console.error('[HistoryHandler] Error en getChat:', err);
            return null;
        }
    }

    /**
     * Obtiene o crea un chat en un proyecto específico
     * @param rawChatId - ID del chat (ej: número de teléfono)
     * @param type - Tipo de chat
     * @param name - Nombre del contacto
     * @param userId - El nuevo BSUID (Business-Scoped User ID) de Meta
     * @param forcedProjectId - ID opcional del proyecto para forzar el ruteo
     */
    static async getOrCreateChat(rawChatId: string, type: 'whatsapp' | 'webchat' | 'instagram' | 'messenger', name: string | null = null, userId: string | null = null, forcedProjectId?: string): Promise<Chat | null> {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
            if (name === '[-]') name = null;

        try {
            let data: Chat | null = null;
            let error: any = null;

            // 1. Intentar buscar por user_id (BSUID) si está presente
            if (userId) {
                const { data: byUserId, error: errUser } = await supabase
                    .from('chats')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('project_id', currentProjectId)
                    .maybeSingle();
                
                data = byUserId;
                if (errUser) error = errUser;
            }

            // 2. Si no se encontró por BSUID, intentar por chatId (Phone)
            if (!data && !error) {
                const { data: byChatId, error: errChat } = await supabase
                    .from('chats')
                    .select('*')
                    .eq('id', chatId)
                    .eq('project_id', currentProjectId)
                    .maybeSingle();
                
                data = byChatId;
                error = errChat;

                // Si lo encontramos por Phone pero no tiene el user_id (BSUID) guardado, lo actualizamos
                if (data && userId && !data.user_id) {
                    console.log(`[HistoryHandler] 🔗 Mapeando BSUID ${userId} al chat existente ${chatId}`);
                    await supabase.from('chats')
                        .update({ user_id: userId })
                        .eq('id', chatId)
                        .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
                    data.user_id = userId;
                }
            }

            // 3. Si sigue sin existir, lo creamos
            if (!data) {
                const { data: newData, error: insertError } = await supabase
                    .from('chats')
                    .insert({
                        id: chatId,
                        user_id: userId,
                        project_id: currentProjectId,
                        type,
                        name,
                        bot_enabled: true,
                        assigned_agent: 'asistente1',
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
                await supabase.from('chats').update({ name }).eq('id', chatId).eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
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
    static async saveMessage(rawChatId: string, role: 'user' | 'assistant' | 'system', content: string, type: string = 'text', contactName: string | null = null, userId: string | null = null, external_id: string | null = null, platformType?: 'whatsapp' | 'webchat' | 'instagram' | 'messenger', forcedProjectId?: string) {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        if (contactName === '[-]') contactName = null;
        try {
            // Lógica de resolución de plataforma mejorada
            let resolvedPlatform: 'whatsapp' | 'webchat' | 'instagram' | 'messenger' = platformType || 'whatsapp';

            if (!platformType) {
                if (chatId.includes('@')) {
                    resolvedPlatform = 'whatsapp';
                } else if (chatId.length > 15) { 
                    // IDs de Instagram/Messenger suelen ser más largos que números de teléfono
                    resolvedPlatform = 'messenger'; 
                } else {
                    resolvedPlatform = 'whatsapp';
                }
            }

            // Asegurar que el chat existe
            await this.getOrCreateChat(chatId, resolvedPlatform, contactName, userId, currentProjectId);

            const msgData: any = {
                chat_id: chatId,
                project_id: currentProjectId,
                role,
                content,
                type,
                created_at: new Date().toISOString()
            };

            // --- DEDUPLICACIÓN MULTI-ESTRATEGIA ---
            // 1. Búsqueda exacta por external_id
            if (external_id) {
                msgData.external_id = external_id;
                const { data: exactMatch, error: exactError } = await supabase
                    .from('messages')
                    .select('*')
                    .eq('external_id', external_id)
                    .maybeSingle();
                
                if (!exactError && exactMatch) {
                    return [exactMatch]; // Ya existe, retornamos sin emitir evento repetido
                }
            }

            // 2. BUSQUEDA POR CONTENIDO + TIEMPO (Deduplicación Difusa)
            // Esto evita duplicados cuando el sistema guarda el mensaje antes de enviarlo (ID nulo)
            // y luego llega el webhook (ID real) o viceversa, lo cual es común en Meta Cloud API.
            const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
            
            const { data: recentlySaved, error: searchError } = await supabase
                .from('messages')
                .select('id, external_id')
                .eq('chat_id', chatId)
                .eq('project_id', currentProjectId)
                .eq('role', role)
                .eq('content', content)
                .gt('created_at', thirtySecondsAgo)
                .order('created_at', { ascending: false })
                .limit(1);

            if (recentlySaved && recentlySaved.length > 0) {
                const existing = recentlySaved[0];
                
                // Si el mensaje existente no tiene external_id y ahora lo tenemos, lo actualizamos
                if (!existing.external_id && external_id) {
                    console.log(`[HistoryHandler] 🔄 Vinculando ID externo a mensaje existente: ${existing.id} -> ${external_id}`);
                    await supabase
                        .from('messages')
                        .update({ external_id })
                        .eq('id', existing.id);
                }
                return recentlySaved;
            }

            // 3. INSERCIÓN NORMAL (Si no se encontró duplicado)
            const { error: insertError, data: insertedMsg } = await supabase.from('messages').insert({
                chat_id: chatId,
                project_id: currentProjectId,
                role,
                content,
                type,
                external_id: external_id || null,
                created_at: msgData.created_at
            }).select();

            if (insertError) {
                // Manejar race conditions de inserción concurrente
                if (insertError.code === '23505') {
                    console.log(`[HistoryHandler] ⏩ Mensaje con external_id ${external_id} insertado concurrentemente.`);
                    return null;
                }
                console.error('[HistoryHandler] Error en inserción de mensaje fallback:', insertError);
            }

            // Actualizar timestamp del último mensaje en el chat para el ordenamiento de la lista
            await supabase
                .from('chats')
                .update({ last_message_at: new Date().toISOString() })
                .eq('id', chatId)
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);

            // Emitir evento para WebSockets (esto actualiza la UI en tiempo real)
            historyEvents.emit('new_message', { 
                chat_id: chatId, 
                role, 
                content, 
                type,
                created_at: new Date().toISOString(),
                external_id: external_id || null
            });

        } catch (err) {
            console.error('[HistoryHandler] Error en saveMessage:', err);
        }
    }

    /**
     * Obtiene el asistente asignado al chat
     */
    static async getAssignedAgent(rawChatId: string, forcedProjectId?: string): Promise<string> {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        try {
            const { data, error } = await supabase
                .from('chats')
                .select('assigned_agent')
                .eq('id', chatId)
                .eq('project_id', currentProjectId)
                .maybeSingle();
            
            if (error || !data || !data.assigned_agent) return 'asistente1';
            return data.assigned_agent;
        } catch (err) {
            console.error('[HistoryHandler] Error en getAssignedAgent:', err);
            return 'asistente1';
        }
    }

    /**
     * Actualiza el asistente asignado al chat
     */
    static async setAssignedAgent(rawChatId: string, agentName: string, forcedProjectId?: string) {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        try {
            await supabase
                .from('chats')
                .update({ assigned_agent: agentName })
                .eq('id', chatId)
                .eq('project_id', currentProjectId);
        } catch (err) {
            console.error('[HistoryHandler] Error en setAssignedAgent:', err);
        }
    }

    /**
     * Actualiza los detalles de contacto (CRM)
     */
    static async updateContactDetails(rawChatId: string, details: { 
        name?: string, 
        email?: string, 
        notes?: string, 
        source?: string, 
        is_lead?: boolean,
        cuit_dni?: string,
        tax_status?: string,
        address?: string,
        offered_product?: string
    }, forcedProjectId?: string) {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        if (details.name === '[-]') details.name = undefined;
        try {
            const { error } = await supabase
                .from('chats')
                .update(details)
                .eq('id', chatId)
                .eq('project_id', currentProjectId);

            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en updateContactDetails:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Crea un lead manualmente desde la interfaz (sin necesidad de chat previo)
     */
    static async createNewLeadManual(chatId: string, details: any) {
        try {
            // 1. Crear o actualizar el chat (Lead)
            const { error: chatErr } = await supabase
                .from('chats')
                .upsert({
                    id: chatId,
                    project_id: HistoryHandler.PROJECT_IDENTIFIER,
                    ...details,
                    is_lead: true,
                    created_at: new Date().toISOString()
                }, { onConflict: 'id,project_id' });

            if (chatErr) throw chatErr;

            // 2. Crear un ticket inicial "NUEVO LEAD" para que aparezca en el CRM
            const { data: ticket, error: ticketErr } = await supabase
                .from('tickets')
                .insert({
                    chat_id: chatId,
                    project_id: HistoryHandler.PROJECT_IDENTIFIER,
                    titulo: `Lead: ${details.name || chatId}`,
                    descripcion: details.notes || 'Lead creado manualmente',
                    tipo: details.offered_product || 'Nuevo Lead',
                    prioridad: 'Media',
                    estado: 'Abierto',
                    created_at: new Date().toISOString()
                })
                .select()
                .single();

            if (ticketErr) throw ticketErr;
            return { success: true, ticket };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en createNewLeadManual:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Verifica si el bot está habilitado para un usuario
     */
    static async isBotEnabled(rawChatId: string): Promise<boolean> {
        const chatId = this.normalizeId(rawChatId);
        try {
            const { data, error } = await supabase
                .from('chats')
                .select('bot_enabled')
                .eq('id', chatId)
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                    .maybeSingle();

            if (error) throw error;
            // Si no hay datos, o bot_enabled es null, asumimos que está habilitado (true)
            return data ? (data.bot_enabled !== false) : true;
        } catch (err) {
            console.error('[HistoryHandler] Error en isBotEnabled:', err);
            return true;
        }
    }

    /**
     * Cambia el estado del bot (Intervención humana)
     */
    static async toggleBot(rawChatId: string, enabled: boolean) {
        const chatId = this.normalizeId(rawChatId);
        try {
            const updateData: any = { bot_enabled: enabled };
            if (enabled === false) {
                updateData.last_human_message_at = new Date().toISOString();
            } else {
                // BUGFIX: Cuando el bot se vuelve a activar, el agente asignado DEBE volver al recepcionista (asistente1)
                updateData.assigned_agent = 'asistente1';
            }

            const { error } = await supabase
                .from('chats')
                .update(updateData)
                .eq('id', chatId)
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
            
            if (error) throw error;
            
            // Emitir evento para WebSockets (ahora incluimos el agente para sincronización frontend)
            historyEvents.emit('bot_toggled', { chatId, enabled, assigned_agent: 'asistente1' });

            return { success: true };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en toggleBot:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Actualiza la marca de tiempo de la última intervención humana
     */
    static async updateLastHumanMessage(rawChatId: string) {
        const chatId = this.normalizeId(rawChatId);
        try {
            await supabase
                .from('chats')
                .update({ last_human_message_at: new Date().toISOString() })
                .eq('id', chatId)
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
        } catch (err) {
            console.error('[HistoryHandler] Error en updateLastHumanMessage:', err);
        }
    }

    /**
     * Lista todos los chats activos (con tags incluidos)
     */
    static async listChats(limit: number = 20, offset: number = 0, search?: string, tagId?: string, assignedTo?: string | null, platform?: string) {
        try {
            // Campos mínimos para la lista (se excluyen notas, address, email, etc. para rendimiento)
            let selectString = 'id, type, name, last_message_at, last_human_message_at, assigned_to, bot_enabled, chat_tags(tag_id, tags(*))';
            if (tagId) {
                selectString = 'id, type, name, last_message_at, last_human_message_at, assigned_to, bot_enabled, chat_tags!inner(tag_id, tags(*))';
            }

            let query = supabase
                .from('chats')
                .select(selectString);
            
            // Filtrar estrictamente por el ID único de este bot en Railway
            query = query.eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);

            if (platform && platform !== 'all') {
                query = query.eq('type', platform);
            }

            // Filtro por asignación (si se solicita)
            if (assignedTo) {
                // El subusuario ve lo suyo O lo que no tiene nadie asignado
                query = query.or(`assigned_to.eq.${assignedTo},assigned_to.is.null`);
            }

            if (search) {
                // Filtro optimizado: solo por nombre o ID (evitamos ILIKE en 'notes' que es pesado)
                query = query.or(`name.ilike.%${search}%,id.ilike.%${search}%`);
            }

            if (tagId) {
                query = query.eq('chat_tags.tag_id', tagId);
            }

            const { data, error } = await query
                .order('last_message_at', { ascending: false })
                .range(offset, offset + limit - 1);
            
            if (error) throw error;
            
            return (data || []).map((chat: any) => ({
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
    static async getMessages(rawChatId: string, limit: number = 50, offset: number = 0, projectId: string | null = null) {
        const chatId = this.normalizeId(rawChatId);
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .eq('project_id', targetProjectId)
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
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
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
                .insert({ name, color, project_id: HistoryHandler.PROJECT_IDENTIFIER })
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
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
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
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
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
                .insert({ chat_id: chatId, tag_id: tagId, project_id: HistoryHandler.PROJECT_IDENTIFIER });
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
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
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
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
            if (error) throw error;
            return (data || []).map((item: any) => item.tags);
        } catch (err) {
            console.error('[HistoryHandler] Error en getChatTags:', err);
            return [];
        }
    }



    /**
     * Guarda el thread_id de OpenAI en el metadata del chat
     */
    static async saveThreadId(chatId: string, threadId: string, forcedProjectId?: string) {
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        try {
            // Primero obtenemos metadata actual
            const { data } = await supabase
                .from('chats')
                .select('metadata')
                .eq('id', chatId)
                .eq('project_id', currentProjectId)
                    .maybeSingle();

            const currentMetadata = data?.metadata || {};
            const updatedMetadata = { ...currentMetadata, thread_id: threadId };

            await supabase
                .from('chats')
                .update({ metadata: updatedMetadata })
                .eq('id', chatId)
                .eq('project_id', currentProjectId);
        } catch (err) {
            console.error('[HistoryHandler] Error en saveThreadId:', err);
        }
    }

    /**
     * Obtiene el thread_id de OpenAI del metadata del chat
     */
    static async getThreadId(chatId: string, forcedProjectId?: string): Promise<string | null> {
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        try {
            const { data } = await supabase
                .from('chats')
                .select('metadata')
                .eq('id', chatId)
                .eq('project_id', currentProjectId)
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
    static async createTicket(rawChatId: string, titulo: string, descripcion: string, tipo: string = 'Soporte', prioridad: string = 'Media', forcedProjectId?: string) {
        const chatId = this.normalizeId(rawChatId);
        const currentProjectId = forcedProjectId || this.PROJECT_IDENTIFIER;
        try {
            const { data, error } = await supabase
                .from('tickets')
                .insert({
                    chat_id: chatId,
                    project_id: currentProjectId,
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
    static async getPendingTicketsCount(tipo?: string) {
        try {
            let query = supabase
                .from('tickets')
                .select('*', { count: 'exact', head: true })
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                .in('estado', ['Abierto', 'En progreso']);

            if (tipo) {
                query = query.eq('tipo', tipo);
            }

            const { count, error } = await query;
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
    static async listTickets(limit: number = 50, offset: number = 0, estado?: string, tipo?: string, chatId?: string) {
        console.log(`[HistoryHandler] listTickets -> req: estado=${estado}, tipo=${tipo}, chatId=${chatId}, project=${PROJECT_ID}`);
        try {
            let query = supabase
                .from('tickets')
                .select('*, chats(name, id)')
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);

            if (chatId && chatId !== 'null' && chatId !== 'undefined' && chatId !== '') {
                query = query.eq('chat_id', chatId);
            }

            // Filtro de estado robusto
            if (estado && estado !== 'null' && estado !== 'undefined' && estado !== '') {
                // Forzamos comparación exacta
                query = query.eq('estado', estado);
            } else {
                // Por defecto, solo lo que no esté cerrado
                query = query.in('estado', ['Abierto', 'En progreso']);
            }

            if (tipo && tipo !== 'null' && tipo !== 'undefined' && tipo !== '') {
                query = query.eq('tipo', tipo);
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
                        .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
                    
                    if (chatId) fallbackQuery = fallbackQuery.eq('chat_id', chatId);
                    if (estado) fallbackQuery = fallbackQuery.eq('estado', estado);
                    else fallbackQuery = fallbackQuery.in('estado', ['Abierto', 'En progreso']);

                    if (tipo) fallbackQuery = fallbackQuery.eq('tipo', tipo);

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
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                .select()
                .maybeSingle();

            if (error) throw error;
            
            // Si el ticket se cierra, reseteamos el agente en el chat asociado
            if (nuevoEstado === 'Cerrado' && data?.chat_id) {
                console.log(`[HistoryHandler] Ticket ${ticketId} cerrado. Reseteando agente para chat ${data.chat_id} a asistente1`);
                await supabase
                    .from('chats')
                    .update({ 
                        assigned_agent: 'asistente1',
                        bot_enabled: true // Re-activamos bot por defecto al cerrar thread
                    })
                    .eq('id', data.chat_id)
                    .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
                    
                // Emitir también el evento de bot_toggled para que el front se refresque
                historyEvents.emit('bot_toggled', { chatId: data.chat_id, enabled: true, assigned_agent: 'asistente1' });
            }

            // Notificar cambios del ticket
            historyEvents.emit('ticket_updated', data);
            
            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en updateTicketStatus:', err);
            return { success: false, error: err.message };
        }
    }
    /**
     * Lista los leads que tienen datos de CRM (editados y marcados explicitamente como leads)
     */
    static async listEditedLeads(limit: number = 50, offset: number = 0) {
        try {
            // Filtramos para obtener solo chats marcados como leads (is_lead = true)
            // Esto asegura que la Agenda/Contactos solo tenga contactos generados o validados por alguien.
            const { data, error } = await supabase
                .from('chats')
                .select('*')
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                .eq('is_lead', true)
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
    static async saveMetaOnboardingData(wabaId: string, phoneId: string, token: string, extra: any = {}, projectId: string | null = null) {
        try {
            const targetProjectId = projectId || PROJECT_ID;

            // Identificar al Super Usuario (Carlitos Pepe) para asignar propiedad
            let superUserId = null;
            try {
                const { data: admin } = await supabase.from('users').select('id').eq('meta_id', '61584766540235').maybeSingle();
                if (admin) superUserId = admin.id;
            } catch (e) { /* ignore */ }

            const { data, error } = await supabase
                .from('meta_onboarding')
                .upsert({
                    project_id: targetProjectId,
                    waba_id: wabaId,
                    phone_number_id: phoneId,
                    access_token: token,
                    onboarding_data: extra,
                    owner_id: superUserId,
                    status: 'active',
                    updated_at: new Date().toISOString()
                }, { onConflict: 'project_id' })
                .select()
                .single();

            if (error) throw error;

            // --- PASO ADICIONAL: Sincronizar con la routing_table para habilitar webhooks globales ---
            // Solo si tenemos un dominio público configurado
            const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PROJECT_URL;
            if (publicDomain && phoneId) {
                let projectUrl = publicDomain.startsWith('http') ? publicDomain : `https://${publicDomain}`;
                // Asegurar que termina sin barra lateral para consistencia
                if (projectUrl.endsWith('/')) projectUrl = projectUrl.slice(0, -1);
                console.log(`📡 [HistoryHandler] Sincronizando routing_table para ${phoneId} -> ${projectUrl}`);
                
                await supabase
                    .from('routing_table')
                    .upsert({
                        phone_number_id: phoneId,
                        waba_id: wabaId,
                        project_id: targetProjectId,
                        project_url: projectUrl,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'phone_number_id' });
            }

            // --- PASO ADICIONAL 2: Asegurar suscripción a la WABA vía API de Meta ---
            // Esto garantiza que Meta envíe los webhooks al enrutador
            if (wabaId && token) {
                try {
                    const axios = (await import('axios')).default;
                    // Suscribir a messages + smb_message_echoes para capturar mensajes
                    // enviados manualmente desde la app de WhatsApp (Atención Humana)
                    await axios.post(`https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps`, 
                        {}, 
                        { 
                            headers: { 'Authorization': `Bearer ${token}` },
                            params: { subscribed_fields: 'messages,smb_message_echoes' }
                        }
                    );
                    console.log(`✅ [HistoryHandler] Suscripción de webhooks confirmada para WABA ${wabaId} (messages + smb_message_echoes)`);
                } catch (apiErr: any) {
                    console.warn(`⚠️ [HistoryHandler] No se pudo confirmar la suscripción de webhooks:`, apiErr.response?.data || apiErr.message);
                }
            }

            // --- PASO ADICIONAL 3: Migrar al token maestro si existe ---
            try {
                const mainToken = await this.getMainToken();
                if (mainToken && token !== mainToken) {
                    console.log(`📡 [HistoryHandler] Migrando token de cliente a 'main_token' para WABA ${wabaId}...`);
                    await supabase
                        .from('meta_onboarding')
                        .update({ access_token: mainToken })
                        .eq('waba_id', wabaId);
                }
            } catch (swapErr) {
                console.warn('⚠️ [HistoryHandler] No se pudo migrar al main_token:', swapErr);
            }

            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en saveMetaOnboardingData:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Obtiene los datos de onboarding configurados
     */
    static async getMetaOnboardingData(projectId: string | null = null, fallbackToMain: boolean = false) {
        try {
            const targetProjectId = projectId || PROJECT_ID;
            const { data: initialData, error } = await supabase
                .from('meta_onboarding')
                .select('*')
                .eq('project_id', targetProjectId)
                .maybeSingle();

            if (error) throw error;

            let data = initialData;

            // Si no hay datos y se solicita fallback, buscamos el 'main_token'
            if (!data && fallbackToMain) {
                console.log(`ℹ️ [HistoryHandler] No hay token para ${targetProjectId}, intentando obtener 'main_token'...`);
                const mainRes = await supabase
                    .from('meta_onboarding')
                    .select('*')
                    .eq('project_id', 'main_token')
                    .maybeSingle();
                if (!mainRes.error && mainRes.data) {
                    data = mainRes.data;
                }
            }

            if (data) {
                return {
                    ...data,
                    whatsappToken: data.access_token,
                    whatsappNumberId: data.phone_number_id,
                    whatsappBusinessId: data.waba_id
                };
            }
            return null;
        } catch (err) {
            console.error('[HistoryHandler] Error en getMetaOnboardingData:', err);
            return null;
        }
    }

    /**
     * Obtiene específicamente el token maestro del sistema
     */
    static async getMainToken() {
        const data = await this.getMetaOnboardingData('main_token');
        return data?.access_token || null;
    }

    static async saveSetting(key: string, value: string, projectId: string | null = null) {
        if (!supabase) return;
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const { error } = await supabase
            .from('settings')
            .upsert({ 
                project_id: targetProjectId, 
                key, 
                value, 
                updated_at: new Date().toISOString() 
            }, { onConflict: 'project_id,key' });

        if (error) {
            console.error(`❌ [HistoryHandler] Error guardando setting ${key}:`, error);
        } else {
            // --- PASO ADICIONAL: Si configuramos IDs de Meta, registrar en la routing_table para triangulación ---
            if ((key === 'FACEBOOK_PAGE_ID' || key === 'INSTAGRAM_BUSINESS_ID') && value) {
                const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PROJECT_URL;
                if (publicDomain && value) {
                    let projectUrl = publicDomain.startsWith('http') ? publicDomain : `https://${publicDomain}`;
                    if (projectUrl.endsWith('/')) projectUrl = projectUrl.slice(0, -1);
                    console.log(`📡 [HistoryHandler] Sincronizando routing_table para ${key}: ${value} -> ${projectUrl}`);
                    
                    await supabase
                        .from('routing_table')
                        .upsert({
                            phone_number_id: value, // Reutilizamos esta columna como identificador remoto universal (PhoneID o PageID)
                            waba_id: null,
                            project_id: targetProjectId,
                            project_url: projectUrl,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'phone_number_id' });
                }
            }
        }
    }

    static async getSetting(key: string, projectId: string | null = null): Promise<string | null> {
        if (!supabase) return null;
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        // console.log(`[HistoryHandler] 🔍 Fetching setting: ${key} for project: ${targetProjectId}`);
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('project_id', targetProjectId)
            .eq('key', key)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error(`❌ [HistoryHandler] Error obteniendo setting ${key}:`, error);
        }
        return data ? data.value : null;
    }

    /**
     * Helper de configuración dinámica (Hot-update).
     * Busca primero en la base de datos (settings) y si no existe, recurre a process.env.
     */
    static async getConfig(key: string, projectId: string | null = null): Promise<string | null> {
        const dbValue = await this.getSetting(key, projectId);
        if (dbValue !== null && dbValue !== undefined && dbValue !== '') {
            return dbValue;
        }

        // Si no está en DB, lo tomamos de Railway (env)
        const envValue = process.env[key] || null;
        
        // Si lo encontramos en Railway pero no estaba en DB, lo persistimos para el futuro
        // (Esto cumple la regla: "en caso de que el repositorio ya exista pero le falte algunas variables...")
        if (envValue && !projectId) {
            console.log(`📡 [HistoryHandler] Auto-persistiendo variable faltante en DB: ${key}`);
            await this.saveSetting(key, envValue);
        }

        return envValue;
    }

    private static async bootstrapConfig() {
        try {
            const currentProjectId = this.PROJECT_IDENTIFIER;
            console.log(`[Bootstrap] Verificando configuración para el proyecto: ${currentProjectId}`);

            // 1. Asegurar que el proyecto 'default' existe en la tabla 'projects'
            const { data: defaultProj } = await supabase.from('projects').select('id').eq('id', 'default').maybeSingle();
            if (!defaultProj) {
                console.log(`🆕 [Bootstrap] Creando proyecto maestro 'default'...`);
                await supabase.from('projects').insert({ id: 'default', name: 'Plantilla por Defecto' });
            }

            // 2. Poblar 'default' desde '.env defaul' si está vacío
            const { data: checkDefaultSettings } = await supabase.from('settings').select('key').eq('project_id', 'default').limit(1);
            if (!checkDefaultSettings || checkDefaultSettings.length === 0) {
                console.log(`[Bootstrap] ℹ️ Proyecto 'default' vacío. Cargando desde '.env defaul'...`);
                const fs = await import('fs');
                const path = await import('path');
                const defaultPath = path.join(process.cwd(), '.env defaul');
                
                if (fs.existsSync(defaultPath)) {
                    const content = fs.readFileSync(defaultPath, 'utf-8');
                    const lines = content.split('\n');
                    const settingsToDefault: any[] = [];
                    
                    for (const line of lines) {
                        const cleanLine = line.trim();
                        if (!cleanLine || cleanLine.startsWith('#')) continue;
                        const match = cleanLine.match(/^([^=]+)=(.*)$/);
                        if (match) {
                            let key = match[1].trim();
                            let value = match[2].trim();
                            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                                value = value.slice(1, -1);
                            }
                            settingsToDefault.push({
                                project_id: 'default',
                                key,
                                value,
                                updated_at: new Date().toISOString()
                            });
                        }
                    }
                    if (settingsToDefault.length > 0) {
                        console.log(`📥 [Bootstrap] Guardando ${settingsToDefault.length} variables en proyecto 'default'...`);
                        await supabase.from('settings').upsert(settingsToDefault, { onConflict: 'project_id,key' });
                    }
                }
            }

            // 3. Asegurar que el proyecto actual existe
            const { data: project } = await supabase.from('projects').select('id').eq('id', currentProjectId).maybeSingle();
            if (!project) {
                console.log(`🆕 [Bootstrap] Registrando proyecto actual: ${currentProjectId}`);
                await supabase.from('projects').insert({ 
                    id: currentProjectId, 
                    name: process.env.RAILWAY_SERVICE_NAME || 'Bot-RialWay'
                });
            }

            // 4. Verificar si el proyecto actual tiene settings. Si no, clonar de 'default'
            const { data: currentSettings } = await supabase.from('settings').select('key').eq('project_id', currentProjectId).limit(1);
            if (!currentSettings || currentSettings.length === 0) {
                console.log(`🆕 [Bootstrap] Proyecto ${currentProjectId} sin configuración. Clonando desde 'default'...`);
                const { data: defaultSettings } = await supabase.from('settings').select('key, value').eq('project_id', 'default');
                
                if (defaultSettings && defaultSettings.length > 0) {
                    const settingsToInsert = defaultSettings.map(s => ({
                        project_id: currentProjectId,
                        key: s.key,
                        value: s.value,
                        updated_at: new Date().toISOString()
                    }));

                    // Inyectar variables de visibilidad/admin si no vienen en el default
                    const defaults = [
                        { key: 'WHATSAPP_VISIBLE', value: 'true' },
                        { key: 'INSTAGRAM_VISIBLE', value: 'false' },
                        { key: 'MESSENGER_VISIBLE', value: 'false' },
                        { key: 'CRM_VISIBLE', value: 'false' },
                        { key: 'ADMIN_USER', value: '' },
                        { key: 'ADMIN_PASS', value: '' }
                    ];

                    for (const d of defaults) {
                        if (!settingsToInsert.find(s => s.key === d.key)) {
                            settingsToInsert.push({
                                project_id: currentProjectId,
                                key: d.key,
                                value: d.value,
                                updated_at: new Date().toISOString()
                            });
                        }
                    }

                    console.log(`📥 [Bootstrap] Insertando ${settingsToInsert.length} variables clonadas en ${currentProjectId}...`);
                    await supabase.from('settings').upsert(settingsToInsert, { onConflict: 'project_id,key' });
                }
            } else {
                console.log(`✅ [Bootstrap] Proyecto ${currentProjectId} ya tiene configuración.`);
            }

        } catch (err) {
            console.error('❌ [Bootstrap] Error en Bootstrap:', err);
        }
    }

    // --- User Management ---

    static async createUser(username: string, pass: string, role: string = 'subuser') {
        try {
            const { data, error } = await supabase
                .from('users')
                .insert({ project_id: HistoryHandler.PROJECT_IDENTIFIER, username, password: pass, role })
                .select()
                .single();
            if (error) throw error;
            return { success: true, user: data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en createUser:', err);
            return { success: false, error: err.message };
        }
    }

    static async listUsers() {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id, username, role, created_at')
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[HistoryHandler] Error en listUsers:', err);
            return [];
        }
    }

    static async verifyUser(username: string, pass: string) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER)
                .eq('username', username)
                .eq('password', pass)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (err) {
            console.error('[HistoryHandler] Error en verifyUser:', err);
            return null;
        }
    }

    static async assignChatToUser(rawChatId: string, userId: string | null) {
        const chatId = this.normalizeId(rawChatId);
        try {
            const { error } = await supabase
                .from('chats')
                .update({ assigned_to: userId })
                .eq('id', chatId)
                .eq('project_id', HistoryHandler.PROJECT_IDENTIFIER);
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en assignChatToUser:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Resuelve el project_id a partir del número de teléfono o ID del bot.
     * Útil para ruteo multitenant dinámico.
     */
    static async getProjectIdByRecipient(recipientId: string | null): Promise<string | null> {
        if (!recipientId || !supabase) return null;
        
        try {
            // 1. Intentar buscar por phone_number_id en meta_onboarding
            const { data: metaData } = await supabase
                .from('meta_onboarding')
                .select('project_id')
                .eq('phone_number_id', recipientId)
                .maybeSingle();

            if (metaData) return metaData.project_id;

            // 2. Fallback: buscar en settings por un valor que coincida (ej: WABA_NUMBER)
            const { data: settingsData } = await supabase
                .from('settings')
                .select('project_id')
                .eq('value', recipientId)
                .maybeSingle();

            if (settingsData) return settingsData.project_id;

            return null;
        } catch (err) {
            console.error('[HistoryHandler] Error en getProjectIdByRecipient:', err);
            return null;
        }
    }

    /**
     * Obtiene el project_id asociado a un chat_id específico
     */
    static async getProjectIdByChatId(chatId: string): Promise<string | null> {
        if (!chatId || !supabase) return null;
        try {
            const normalizedChatId = this.normalizeId(chatId);
            const { data, error } = await supabase
                .from('chats')
                .select('project_id')
                .eq('id', normalizedChatId)
                .maybeSingle();
            
            if (error) throw error;
            return data?.project_id || null;
        } catch (err) {
            console.error(`[HistoryHandler] Error en getProjectIdByChatId para ${chatId}:`, err);
            return null;
        }
    }

    /**
     * Sincronización masiva de etiquetas (tags)
     */
    static async syncTags(tags: any[], forcedProjectId?: string) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };
        const targetProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;
        
        try {
            if (tags.length === 0) return { success: true, data: [] };
            
            const tagsToUpsert = tags.map(t => ({
                project_id: targetProjectId,
                name: t.name,
                color: t.color || '#6366f1',
                created_at: new Date().toISOString()
            }));

            // Usamos onConflict 'project_id,name' para no duplicar etiquetas con el mismo nombre en el mismo proyecto
            const { data, error } = await supabase
                .from('tags')
                .upsert(tagsToUpsert, { onConflict: 'project_id,name' })
                .select();

            if (error) throw error;
            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en syncTags:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Sincronización masiva de contactos (chats)
     */
    static async syncChats(chats: any[], forcedProjectId?: string) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };
        const targetProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;

        try {
            if (chats.length === 0) return { success: true, data: [] };

            const chatsToUpsert = chats.map(c => ({
                id: c.id,
                project_id: targetProjectId,
                name: c.name || null,
                type: c.type || 'whatsapp',
                last_message_at: c.last_message_at || new Date().toISOString(),
                metadata: c.metadata || {},
                is_lead: c.is_lead || false
            }));

            const { data, error } = await supabase
                .from('chats')
                .upsert(chatsToUpsert, { onConflict: 'id,project_id' })
                .select();

            if (error) throw error;
            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en syncChats:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Sincronización masiva de asociaciones chat-etiqueta
     */
    static async syncChatTags(associations: any[], forcedProjectId?: string) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };
        const targetProjectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER;

        try {
            if (associations.length === 0) return { success: true, data: [] };

            const associationsToUpsert = associations.map(a => ({
                chat_id: a.chat_id,
                tag_id: a.tag_id,
                project_id: targetProjectId
            }));

            const { data, error } = await supabase
                .from('chat_tags')
                .upsert(associationsToUpsert, { onConflict: 'chat_id,tag_id,project_id' })
                .select();

            if (error) throw error;
            return { success: true, data };
        } catch (err: any) {
            console.error('[HistoryHandler] Error en syncChatTags:', err);
            return { success: false, error: err.message };
        }
    }
}

// Inicializar base de datos al cargar el modulo (Quitado para evitar race condition, se llama en app.ts main)
// HistoryHandler.initDatabase();
