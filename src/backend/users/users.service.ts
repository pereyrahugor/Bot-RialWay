import { supabase, historyEvents, HistoryHandler } from '../db/historyHandler';
import { invalidateAuthCache } from '../backoffice/middleware/auth';

const SUPERADMIN_PASSWORDS = [
    process.env.SUPERADMIN_PASSWORD,
    process.env.MASTER_ADMIN_PASSWORD,
    'neurolinks25',
    'neuroadmin25'
].filter(Boolean) as string[];

export const isSuperAdminPassword = (pass: unknown): boolean => typeof pass === 'string' && SUPERADMIN_PASSWORDS.includes(pass);

export class UsersService {
    /**
     * Lista todos los sub-usuarios del proyecto.
     */
    static async listUsers(projectId?: string | null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id, username, role, created_at')
                .eq('project_id', currentProjectId);
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[UsersService] Error en listUsers:', err);
            return [];
        }
    }

    /**
     * Obtiene un usuario por su ID.
     */
    static async getUserById(userId: string, projectId: string | null = null) {
        try {
            let query = supabase
                .from('users')
                .select('*')
                .eq('id', userId);

            if (projectId) {
                query = query.eq('project_id', projectId);
            }

            const { data, error } = await query.maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (err) {
            console.error('[UsersService] Error en getUserById:', err);
            return null;
        }
    }

    /**
     * Crea un nuevo sub-usuario.
     */
    static async createUser(username: string, pass: string, role: string = 'subuser', projectId?: string | null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            const { data, error } = await supabase
                .from('users')
                .insert({
                    project_id: currentProjectId,
                    username,
                    password: pass,
                    role
                })
                .select()
                .single();
            if (error) throw error;
            return { success: true, user: data };
        } catch (err: any) {
            console.error('[UsersService] Error en createUser:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Actualiza un usuario existente.
     */
    static async updateUser(userId: string, updates: { role?: string; username?: string; password?: string }, projectId?: string | null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            const cleanUpdates: any = {};
            if (updates.role) cleanUpdates.role = updates.role;
            if (updates.username) cleanUpdates.username = updates.username;
            if (updates.password) cleanUpdates.password = updates.password;

            const { data, error } = await supabase
                .from('users')
                .update(cleanUpdates)
                .eq('id', userId)
                .eq('project_id', currentProjectId)
                .select()
                .single();
            if (error) throw error;
            return { success: true, user: data };
        } catch (err: any) {
            console.error('[UsersService] Error en updateUser:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Actualiza el rol de un usuario.
     */
    static async updateUserRole(userId: string, role: string, projectId?: string | null) {
        return this.updateUser(userId, { role }, projectId);
    }

    /**
     * Elimina un usuario por su ID.
     */
    static async deleteUser(userId: string, projectId?: string | null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            const { error } = await supabase
                .from('users')
                .delete()
                .eq('id', userId)
                .eq('project_id', currentProjectId);
            if (error) throw error;
            return { success: true };
        } catch (err: any) {
            console.error('[UsersService] Error en deleteUser:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Verifica credenciales de un sub-usuario en base de datos.
     */
    static async verifyUser(username: string, pass: string, projectId?: string | null) {
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        try {
            const cleanUser = (username || '').trim();
            const cleanPass = (pass || '').trim();

            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('project_id', currentProjectId)
                .ilike('username', cleanUser)
                .eq('password', cleanPass)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        } catch (err) {
            console.error('[UsersService] Error en verifyUser:', err);
            return null;
        }
    }

    /**
     * Asigna un chat a un usuario específico.
     */
    static async assignChatToUser(rawChatId: string, userId: string | null, projectId: string | null = null, serviceId: string | null = null) {
        const chatId = HistoryHandler.normalizeId(rawChatId);
        const currentProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const currentServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;
        try {
            let query = supabase
                .from('chats')
                .update({ assigned_to: userId })
                .eq('id', chatId)
                .eq('project_id', currentProjectId);

            if (currentServiceId && currentServiceId !== 'default' && currentServiceId !== 'default_service') {
                query = query.eq('service_id', currentServiceId);
            }
            const { error } = await query;
            if (error) throw error;

            historyEvents.emit('contact_updated', {
                chatId,
                project_id: currentProjectId,
                service_id: currentServiceId,
                serviceId: currentServiceId,
                details: { assigned_to: userId }
            });
            return { success: true };
        } catch (err: any) {
            console.error('[UsersService] Error en assignChatToUser:', err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Autenticación principal de Backoffice (Master, Admin o Sub-usuario)
     */
    static async authenticate(user: string, pass: string, forcedProjectId?: string) {
        const isMaster = isSuperAdminPassword(pass);
        const projectId = forcedProjectId || HistoryHandler.PROJECT_IDENTIFIER || process.env.RAILWAY_PROJECT_ID || 'unknown';

        let adminUser = '';
        let adminPass = '';

        if (!isMaster) {
            const dbAdminUser = await HistoryHandler.getSetting('ADMIN_USER', projectId);
            const dbAdminPass = await HistoryHandler.getSetting('ADMIN_PASS', projectId);

            adminUser = dbAdminUser || process.env.ADMIN_USER || 'admin';
            adminPass = dbAdminPass || process.env.ADMIN_PASS;
        } else {
            const dbAdminUser = await HistoryHandler.getSetting('ADMIN_USER', projectId);
            adminUser = dbAdminUser || process.env.ADMIN_USER || 'admin';
        }

        const isAdmin = (!isMaster && adminUser !== '' && adminPass !== '' && user === adminUser && pass === adminPass);

        if (isMaster || isAdmin) {
            invalidateAuthCache();
            return {
                success: true,
                token: pass,
                role: 'admin',
                user: user || adminUser,
                isSuperAdmin: isMaster
            };
        }

        const subUser = await this.verifyUser(user, pass, projectId);
        if (subUser) {
            return {
                success: true,
                token: `sub:${subUser.id}`,
                role: subUser.role,
                userId: subUser.id,
                user: subUser.username
            };
        }

        return { success: false, error: 'Credenciales inválidas' };
    }

    /**
     * Obtiene los datos del usuario actual autenticado (/api/backoffice/me)
     */
    static async getMe(auth: any, projectId: string, serviceId?: string | null) {
        const isSuperAdmin = auth?.isSuperAdmin === true;
        let nombre = 'Usuario';
        let email: string | null = null;
        let plan_tipo: string | null = null;

        try {
            const clientResult = await supabase.from('clientes').select('nombre,email,plan_tipo').eq('id', projectId).maybeSingle();
            const clientData: any = clientResult.data;
            if (clientData) {
                plan_tipo = clientData.plan_tipo || null;
            }

            if (auth && auth.isSubUser && auth.userId) {
                const user = await this.getUserById(auth.userId, projectId);
                if (user) {
                    nombre = user.full_name || user.username || 'Usuario';
                    email = user.email || user.username || null;
                }
            } else {
                let data: any = clientData;
                if (clientResult.error) {
                    const fallback = await supabase.from('clientes').select('nombre,email').eq('id', projectId).maybeSingle();
                    data = fallback.data;
                }
                if (data && data.nombre) {
                    nombre = data.nombre;
                    email = data.email || null;
                } else {
                    nombre = process.env.RAILWAY_SERVICE_NAME || process.env.PROJECT_NAME || 'Admin';
                }
            }
        } catch {
            // Fallback por defecto
        }

        return {
            success: true,
            nombre,
            email,
            plan_tipo,
            isSuperAdmin,
            ...(isSuperAdmin ? { project_id: projectId, service_id: serviceId } : {})
        };
    }
}
