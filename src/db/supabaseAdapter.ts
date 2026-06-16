
import { createClient } from '@supabase/supabase-js';
import { AuthenticationCreds, AuthenticationState, SignalDataTypeMap, initAuthCreds, BufferJSON } from 'whaileys';

export const useSupabaseAuthState = async (
    supabaseUrl: string,
    supabaseKey: string,
    projectId: string,
    sessionId: string = 'default',
    botName: string | null = null
): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void>, clearSession: () => Promise<void> }> => {

    const supabase = createClient(supabaseUrl, supabaseKey);
    let sessionData: Record<string, any> = {};

    // Cargar toda la sesión al inicio
    const init = async () => {
        try {
            const { data: rows, error } = await supabase
                .from('whatsapp_sessions')
                .select('key_id, data')
                .eq('project_id', projectId)
                .eq('session_id', sessionId);

            if (error) throw error;

            if (rows && rows.length > 0) {
                const backupRow = rows.find(r => r.key_id === 'full_backup');
                if (backupRow) {
                    // Formato unificado (nuevo/estable)
                    sessionData = JSON.parse(JSON.stringify(backupRow.data), BufferJSON.reviver);
                } else {
                    // Migración: cargar formato legacy (múltiples filas)
                    rows.forEach(r => {
                        const key = r.key_id.endsWith('.json') ? r.key_id : `${r.key_id}.json`;
                        sessionData[key] = JSON.parse(JSON.stringify(r.data), BufferJSON.reviver);
                    });
                }
            }
        } catch (error) {
            console.error('[SupabaseAdapter] ❌ Error inicializando sesión:', error);
        }
    };

    await init();

    const saveToDb = async () => {
        try {
            const { error } = await supabase
                .from('whatsapp_sessions')
                .upsert({
                    project_id: projectId,
                    session_id: sessionId,
                    key_id: 'full_backup',
                    data: JSON.parse(JSON.stringify(sessionData, BufferJSON.replacer)),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'project_id,session_id,key_id' });

            if (error) throw error;
        } catch (error) {
            console.error('[SupabaseAdapter] ❌ Error al persistir full_backup:', error);
        }
    };

    const clearSession = async () => {
        try {
            const { error } = await supabase
                .from('whatsapp_sessions')
                .delete()
                .eq('project_id', projectId)
                .eq('session_id', sessionId);
            if (error) throw error;
            sessionData = {};
        } catch (error) {
            console.error('[SupabaseAdapter] ❌ Error eliminando sesión:', error);
        }
    };

    let saveTimeout: NodeJS.Timeout | null = null;
    const saveToDbDebounced = async () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            try {
                await saveToDb();
            } finally {
                saveTimeout = null;
            }
        }, 120000); // Agrupar cambios durante 120 segundos para evitar alto volumen de egreso
    };

    // Baileys espera que 'creds' esté disponible directamente (initAuthCreds lo inicializa si no existe)
    const creds: AuthenticationCreds = sessionData['creds.json'] || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
                    ids.forEach(id => {
                        const key = `${type}-${id}.json`;
                        if (sessionData[key]) {
                            data[id] = sessionData[key];
                        }
                    });
                    return data;
                },
                set: async (data: any) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = (data[category] as any)[id];
                            const key = `${category}-${id}.json`;
                            if (value) {
                                sessionData[key] = value;
                            } else {
                                delete sessionData[key];
                            }
                        }
                    }
                    await saveToDbDebounced();
                }
            }
        },
        saveCreds: async () => {
            sessionData['creds.json'] = creds;
            await saveToDbDebounced();
        },
        clearSession
    };

};
