import { supabase, historyEvents, HistoryHandler } from '../db/historyHandler';
import { invalidateAuthCache } from '../backoffice/middleware/auth';
import crypto from 'crypto';

export class SettingsService {
    public static readonly settingsCache = new Map<string, { value: string | null; timestamp: number }>();
    public static readonly CACHE_TTL_MS = 60 * 1000; // 1 minuto de cache para settings

    /**
     * Limpia la cache de settings en memoria.
     */
    static invalidateCache(key?: string, projectId?: string | null, serviceId?: string | null) {
        if (!key) {
            this.settingsCache.clear();
            return;
        }
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const targetServiceId = serviceId || 'default';
        this.settingsCache.delete(`${targetProjectId}:${targetServiceId}:${key}`);
        this.settingsCache.delete(`${targetProjectId}:${targetServiceId}:${key}:strict`);
    }

    /**
     * Obtiene una configuración desde la base de datos con cache en memoria.
     */
    static async getSetting(
        key: string,
        projectId: string | null = null,
        serviceId: string | null = null,
        strictService: boolean = false
    ): Promise<string | null> {
        if (!supabase) return null;
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const rawServiceId = serviceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER;

        const isGenericService = !rawServiceId ||
            rawServiceId === 'default_service' ||
            rawServiceId === 'generic' ||
            rawServiceId === 'null' ||
            rawServiceId.trim() === '';

        const targetServiceId = isGenericService ? null : rawServiceId;
        const cacheKey = `${targetProjectId}:${targetServiceId || 'default'}:${key}${strictService ? ':strict' : ''}`;
        const now = Date.now();

        // 1. Intentar obtener desde cache en memoria (excepto credenciales para garantizar realtime)
        if (key !== 'ADMIN_USER' && key !== 'ADMIN_PASS') {
            const cached = this.settingsCache.get(cacheKey);
            if (cached && (now - cached.timestamp < this.CACHE_TTL_MS)) {
                return cached.value;
            }
        }

        let query = supabase
            .from('settings')
            .select('value')
            .eq('project_id', targetProjectId)
            .eq('key', key);

        if (targetServiceId) {
            query = query.eq('service_id', targetServiceId);
        } else if (strictService) {
            query = query.is('service_id', null);
        }

        const { data: mainData, error } = await query.maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error(`❌ [SettingsService] Error obteniendo setting ${key}:`, error);
        }

        let data = mainData;

        // Fallback: Si no lo encontró con service_id específico, buscar configuraciones globales del proyecto
        // NUNCA debe adoptar registros que pertenezcan explícitamente a otro service_id
        if (!data && targetServiceId && !strictService) {
            const fallbackRes = await supabase
                .from('settings')
                .select('value')
                .eq('project_id', targetProjectId)
                .eq('key', key)
                .or('service_id.is.null,service_id.eq.default_service,service_id.eq.generic')
                .limit(1)
                .maybeSingle();
            if (fallbackRes.data) {
                data = fallbackRes.data;
            }
        }

        let value = data ? data.value : null;

        if (key === 'CRM_FIELDS_CONFIG' && (!value || value.trim() === '')) {
            const slug = await this.getConfig('CLIENT_SLUG', targetProjectId);
            const cleanSlug = String(slug || '').trim().toLowerCase();

            if (cleanSlug === 'ganemos' || cleanSlug === 'ganemos-net' || cleanSlug === 'cas-epc' || cleanSlug === 'casepc') {
                value = JSON.stringify([
                    { id: 'crm-ticket-title', label: 'Titulo del Ticket', visible: true, order: 0 },
                    { id: 'crm-name', label: 'Nombre del Contacto', visible: true, order: 1 },
                    { id: 'crm-phone', label: 'Teléfono', visible: true, order: 2 },
                    { id: 'crm-cuit', label: 'Usuario / DNI', visible: true, order: 3 },
                    { id: 'crm-email', label: 'Correo Electrónico', visible: true, order: 4 },
                    { id: 'crm-address', label: 'Domicilio', visible: true, order: 5 },
                    { id: 'crm-tax-status', label: 'Situación Impositiva', visible: true, order: 6 },
                    { id: 'crm-product', label: 'Producto Ofrecido', visible: true, order: 7 },
                    { id: 'crm-source', label: 'Fuente / Canal', visible: true, order: 8 },
                    { id: 'crm-notes', label: 'Historial de Notas', visible: true, order: 9 },
                    { id: 'crm-due-date', label: 'Fecha Alerta / Seguimiento', visible: true, order: 10 },
                    { id: 'crm-priority', label: 'Prioridad', visible: true, order: 11 },
                    { id: 'crm-status', label: 'Estado del Lead (CRM)', visible: true, order: 12 }
                ]);
            } else if (cleanSlug === 'aquavita') {
                value = JSON.stringify([
                    { id: 'crm-ticket-title', label: 'Titulo del Ticket', visible: true, order: 0 },
                    { id: 'crm-name', label: 'Nombre del Contacto', visible: true, order: 1 },
                    { id: 'crm-phone', label: 'Teléfono', visible: true, order: 2 },
                    { id: 'crm-cuit', label: 'Nro Cliente / DNI', visible: true, order: 3 },
                    { id: 'crm-email', label: 'Correo Electrónico', visible: true, order: 4 },
                    { id: 'crm-address', label: 'Dirección', visible: true, order: 5 },
                    { id: 'crm-tax-status', label: 'Tipo Cliente', visible: true, order: 6 },
                    { id: 'crm-product', label: 'Producto Ofrecido', visible: true, order: 7 },
                    { id: 'crm-source', label: 'Fuente / Canal', visible: true, order: 8 },
                    { id: 'crm-notes', label: 'Historial de Notas', visible: true, order: 9 },
                    { id: 'crm-due-date', label: 'Fecha Alerta / Seguimiento', visible: true, order: 10 },
                    { id: 'crm-priority', label: 'Prioridad', visible: true, order: 11 },
                    { id: 'crm-status', label: 'Estado del Lead (CRM)', visible: true, order: 12 }
                ]);
            }
        }

        if ((key === 'ADMIN_USER' || key === 'ADMIN_PASS') && value && value.startsWith('b64:')) {
            try {
                value = Buffer.from(value.slice(4), 'base64').toString('utf-8');
            } catch (e) {
                console.error(`[SettingsService] Error decoding base64 setting ${key}:`, e);
            }
        }

        // 2. Guardar en cache antes de retornar
        this.settingsCache.set(cacheKey, { value, timestamp: now });

        return value;
    }

    /**
     * Helper de configuración dinámica (Hot-update).
     * Busca primero en la base de datos (settings) y si no existe, recurre a process.env.
     */
    static async getConfig(key: string, projectId: string | null = null, serviceId: string | null = null, strictService: boolean = false): Promise<string | null> {
        const dbValue = await this.getSetting(key, projectId, serviceId, strictService);
        if (dbValue !== null && dbValue !== undefined && dbValue !== '') {
            return dbValue;
        }
        if (strictService && serviceId) {
            return null;
        }
        return process.env[key] || null;
    }

    /**
     * Guarda una configuración en la base de datos y actualiza cache y variables de entorno.
     */
    static async saveSetting(key: string, value: string, projectId: string | null = null, serviceId: string | null = null): Promise<void> {
        if (!supabase) return;
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const targetServiceId = serviceId || process.env.SERVICE_ID || process.env.RAILWAY_SERVICE_ID || HistoryHandler.SERVICE_IDENTIFIER;

        // Invalidar cache en memoria
        const cacheKey = `${targetProjectId}:${targetServiceId}:${key}`;
        this.settingsCache.delete(cacheKey);
        this.settingsCache.delete(`${cacheKey}:strict`);

        const payload: any = {
            project_id: targetProjectId,
            service_id: targetServiceId,
            key,
            value,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('settings')
            .upsert(payload, { onConflict: 'project_id,service_id,key' });

        if (error) {
            console.error(`❌ [SettingsService] Error guardando setting ${key}:`, error);
            throw new Error(`Error guardando configuracion ${key}: ${error.message}`);
        } else {
            // Sincronizar en process.env para que el bot actualice su comportamiento de inmediato (Hot-update)
            if (targetProjectId === HistoryHandler.PROJECT_IDENTIFIER && value !== 'PENDING') {
                process.env[key] = value;
            }

            // Si configuramos IDs de Meta, registrar en la routing_table para triangulación
            if ((key === 'FACEBOOK_PAGE_ID' || key === 'INSTAGRAM_BUSINESS_ID') && value) {
                const explicitProjectUrl = process.env.PROJECT_URL || (await this.getSetting('PROJECT_URL', targetProjectId, targetServiceId));
                const publicDomain = explicitProjectUrl
                    || ((process.env.RAILWAY_STATIC_URL && process.env.RAILWAY_STATIC_URL.includes('.up.railway.app'))
                        ? process.env.RAILWAY_STATIC_URL
                        : (process.env.RAILWAY_PUBLIC_DOMAIN && process.env.RAILWAY_PUBLIC_DOMAIN.includes('.up.railway.app'))
                            ? process.env.RAILWAY_PUBLIC_DOMAIN
                            : (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PROJECT_URL));
                if (publicDomain && value) {
                    let projectUrl = publicDomain.startsWith('http')
                        ? publicDomain
                        : `https://${publicDomain}`;

                    if (projectUrl.endsWith('/')) {
                        projectUrl = projectUrl.slice(0, -1);
                    }

                    console.log(`📡 [SettingsService] Sincronizando routing_table para ${key}: ${value} -> ${projectUrl}`);

                    await supabase
                        .from('routing_table')
                        .upsert({
                            phone_number_id: value,
                            waba_id: null,
                            project_id: targetProjectId,
                            service_id: targetServiceId,
                            project_url: projectUrl,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'phone_number_id' });
                }
            }
        }
    }

    /**
     * Guarda múltiples configuraciones en bulk.
     */
    static async saveSettingsBulk(
        settings: Record<string, string>,
        projectId: string,
        serviceId: string | null = null
    ): Promise<{ savedCount: number; omittedCount: number }> {
        const PROTECTED_KEYS = ['OPENAI_ADMIN_API_KEY', 'OPENAI_API_KEY_TOOLS'];
        const keys = Object.keys(settings);
        const keysToSave = keys.filter(k => !PROTECTED_KEYS.includes(k));

        console.log(`📡 [SettingsService] Guardando bulk de ${keysToSave.length} variables para proyecto ${projectId} (Servicio: ${serviceId})...`);

        const promises = keysToSave.map(key => {
            let val = settings[key];
            if ((key === 'ADMIN_USER' || key === 'ADMIN_PASS') && val) {
                val = 'b64:' + Buffer.from(val).toString('base64');
            }
            return this.saveSetting(key, val, projectId, serviceId);
        });

        await Promise.all(promises);

        const credentialKeys = ['ADMIN_PASS', 'ADMIN_USER'];
        if (keysToSave.some(k => credentialKeys.includes(k))) {
            invalidateAuthCache();
            console.log('[SettingsService] Credenciales actualizadas — cache de auth invalidado.');
        }

        return {
            savedCount: keysToSave.length,
            omittedCount: keys.length - keysToSave.length
        };
    }

    /**
     * Obtiene el API_KEY oficial de la instancia. Si no existe, la genera.
     */
    static async getProjectApiKey(projectId: string | null = null, serviceId: string | null = null): Promise<string> {
        if (!supabase) return '';
        const targetProjectId = projectId || HistoryHandler.PROJECT_IDENTIFIER;
        const targetServiceId = serviceId || HistoryHandler.SERVICE_IDENTIFIER;

        try {
            const { data } = await supabase
                .from('settings')
                .select('value')
                .eq('project_id', targetProjectId)
                .eq('service_id', targetServiceId)
                .eq('key', 'api_key')
                .maybeSingle();

            if (data?.value) return data.value;

            if (targetServiceId !== HistoryHandler.SERVICE_IDENTIFIER) {
                const { data: defData } = await supabase
                    .from('settings')
                    .select('value')
                    .eq('project_id', targetProjectId)
                    .eq('service_id', HistoryHandler.SERVICE_IDENTIFIER)
                    .eq('key', 'api_key')
                    .maybeSingle();
                if (defData?.value) return defData.value;
            }

            const uniqueKey = `sk_dusk_${crypto.randomBytes(16).toString('hex')}`;
            await supabase.from('settings').insert({
                project_id: targetProjectId,
                service_id: targetServiceId,
                key: 'api_key',
                value: uniqueKey,
                updated_at: new Date().toISOString()
            });
            return uniqueKey;
        } catch (e: any) {
            console.error('❌ [SettingsService] Error obteniendo getProjectApiKey:', e.message);
            return '';
        }
    }

    /**
     * Obtiene todos los service_id únicos asociados al proyecto.
     */
    static async getAllProjectServices(projectId: string): Promise<string[]> {
        if (!supabase) return ['default_service'];
        try {
            const { data, error } = await supabase
                .from('settings')
                .select('service_id')
                .eq('project_id', projectId);

            if (error) throw error;

            const services = (data || [])
                .map((item: any) => item.service_id)
                .filter((val: any, idx: number, self: any[]) => val && val !== 'null' && val !== 'generic' && self.indexOf(val) === idx);

            return services.length > 0 ? services : ['default_service'];
        } catch (e: any) {
            console.error('[SettingsService] Error en getAllProjectServices:', e.message);
            return ['default_service'];
        }
    }

    /**
     * Obtiene y combina todos los settings del proyecto y servicio para el panel.
     */
    static async getMergedSettings(projectId: string, serviceId?: string | null): Promise<Record<string, string>> {
        let query = supabase
            .from('settings')
            .select('key, value, service_id')
            .eq('project_id', projectId);

        if (serviceId && serviceId !== 'default' && serviceId !== 'default_service') {
            query = query.in('service_id', [serviceId, 'default_service']);
        }

        const { data: dbSettings, error } = await query;
        if (error) throw error;

        const selectedSettings: Record<string, string> = {};
        const settingOrigins: Record<string, string> = {};

        dbSettings?.forEach((s: any) => {
            const existingOrigin = settingOrigins[s.key];
            let val = s.value;
            if ((s.key === 'ADMIN_USER' || s.key === 'ADMIN_PASS') && typeof val === 'string' && val.startsWith('b64:')) {
                try {
                    val = Buffer.from(val.slice(4), 'base64').toString('utf-8');
                } catch (_e) { /* intentional */ }
            }

            if (!existingOrigin) {
                selectedSettings[s.key] = val;
                settingOrigins[s.key] = s.service_id || 'default_service';
            } else {
                if (existingOrigin === 'default_service' && s.service_id !== 'default_service') {
                    selectedSettings[s.key] = val;
                    settingOrigins[s.key] = s.service_id;
                }
            }
        });

        return selectedSettings;
    }

    /**
     * Obtiene los servicios del proyecto con sus metadatos (nombre, asistente, teléfono)
     */
    static async getProjectServicesWithMetadata(projectId: string, serviceId?: string | null): Promise<{ services: any[]; isSupervisorActive: boolean }> {
        const isSuperAdminSetting = await this.getSetting('SUPER_ADMIN_MODE', projectId, serviceId, true);
        const supervisorApiKey = await this.getSetting('SUPERVISOR_API_KEY', projectId, serviceId, true);
        const realApiKey = await this.getProjectApiKey(projectId, serviceId);
        const isAuthorizedSupervisor = (isSuperAdminSetting === 'true' && !!supervisorApiKey && !!realApiKey && supervisorApiKey.trim() === realApiKey.trim());

        if (!isAuthorizedSupervisor) {
            return { services: [], isSupervisorActive: false };
        }

        const services = await this.getAllProjectServices(projectId);

        const { data: slugData } = await supabase
            .from('settings')
            .select('service_id, key, value')
            .eq('project_id', projectId)
            .in('key', ['CLIENT_SLUG', 'BOT_NAME', 'PHONE_NUMBER_ID', 'ASSISTANT_NAME']);

        const serviceMetadata: Record<string, any> = {};
        services.forEach(s => {
            serviceMetadata[s] = {
                id: s,
                name: s === 'default_service' ? 'Servicio Principal' : s,
                assistantName: '',
                phone: ''
            };
        });

        slugData?.forEach((item: any) => {
            const sId = item.service_id || 'default_service';
            if (!serviceMetadata[sId]) {
                serviceMetadata[sId] = { id: sId, name: sId, assistantName: '', phone: '' };
            }
            if (item.key === 'ASSISTANT_NAME') {
                serviceMetadata[sId].assistantName = item.value;
            } else if (item.key === 'CLIENT_SLUG' || item.key === 'BOT_NAME') {
                serviceMetadata[sId].name = item.value;
            } else if (item.key === 'PHONE_NUMBER_ID') {
                serviceMetadata[sId].phone = item.value;
            }
        });

        Object.values(serviceMetadata).forEach((s: any) => {
            if (!s.assistantName) {
                s.assistantName = s.name || s.id;
            }
        });

        return {
            services: Object.values(serviceMetadata),
            isSupervisorActive: true
        };
    }
}
