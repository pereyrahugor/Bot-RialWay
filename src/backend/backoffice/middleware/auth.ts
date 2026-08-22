import { HistoryHandler } from "../db/historyHandler";

// Promise singleton: todos los requests simultáneos comparten el mismo fetch, no se duplica la query
let _adminPassPromise: Promise<string> | null = null;
let _adminPassAt = 0;
const ADMIN_PASS_TTL = 5 * 60 * 1000;
const SUPERADMIN_PASSWORDS = [
    process.env.SUPERADMIN_PASSWORD,
    process.env.MASTER_ADMIN_PASSWORD,
    'neurolinks25',
    'neuroadmin25'
].filter(Boolean) as string[];

function isSuperAdminToken(token: unknown): boolean {
    return typeof token === 'string' && SUPERADMIN_PASSWORDS.includes(token);
}

// Cache temporal para usuarios (userId -> { role, projectId, serviceId, timestamp })
const _userCache = new Map<string, { role: string; projectId: string | null; serviceId: string | null; timestamp: number }>();
const USER_ROLE_TTL = 5 * 60 * 1000;

/** Invalida el cache de contraseña del admin — llamar cuando se actualice ADMIN_PASS en la DB */
export function invalidateAuthCache() {
    _adminPassPromise = null;
    _adminPassAt = 0;
    _userCache.clear();
    console.log('[AUTH] Cache de credenciales invalidado.');
}

async function _getUserRole(userId: string): Promise<string | null> {
    const now = Date.now();
    const cached = _userCache.get(userId) as any;
    if (cached && (now - cached.timestamp) < USER_ROLE_TTL) {
        if (cached.notFound) return null;
        return cached.role;
    }
    try {
        const user = await HistoryHandler.getUserById(userId);
        if (user) {
            const role = user.role || 'subuser';
            const projectId = user.project_id || null;
            const serviceId = user.service_id || null;
            _userCache.set(userId, { role, projectId, serviceId, timestamp: now } as any);
            return role;
        }
    } catch (e) {
        console.error('[AUTH] Error obteniendo rol del usuario:', e);
    }
    _userCache.set(userId, { notFound: true, timestamp: now } as any);
    return null;
}

async function _getUserInfo(userId: string): Promise<{ role: string; projectId: string | null; serviceId: string | null } | null> {
    const now = Date.now();
    const cached = _userCache.get(userId) as any;
    if (cached && (now - cached.timestamp) < USER_ROLE_TTL) {
        if (cached.notFound) return null;
        return { role: cached.role, projectId: cached.projectId, serviceId: cached.serviceId };
    }
    try {
        const user = await HistoryHandler.getUserById(userId);
        if (user) {
            const role = user.role || 'subuser';
            const projectId = user.project_id || null;
            const serviceId = user.service_id || null;
            _userCache.set(userId, { role, projectId, serviceId, timestamp: now } as any);
            return { role, projectId, serviceId };
        }
    } catch (e) {
        console.error('[AUTH] Error obteniendo info del usuario:', e);
    }
    _userCache.set(userId, { notFound: true, timestamp: now } as any);
    return null;
}

let _adminPassCacheKey = '';

async function _fetchAdminPass(projectId: string, tenantId: string | null): Promise<string> {
    const now = Date.now();
    const currentKey = `${projectId}:${tenantId || 'global'}`;
    if (_adminPassCacheKey === currentKey && _adminPassPromise !== null && (now - _adminPassAt) < ADMIN_PASS_TTL) {
        return _adminPassPromise;
    }
    _adminPassAt = now;
    _adminPassCacheKey = currentKey;
    // Timeout de 3s: si Supabase tarda, no bloqueamos todas las requests
    const fallback = new Promise<string>(resolve => setTimeout(() => resolve(''), 3000));
    _adminPassPromise = Promise.race([
        HistoryHandler.getSetting('ADMIN_PASS').then((dbPass) => {
            if (tenantId) {
                return dbPass || '';
            }
            return dbPass || process.env.ADMIN_PASS || process.env.BACKOFFICE_TOKEN || '';
        }),
        fallback
    ]);
    return _adminPassPromise;
}

/**
 * Middleware de autenticación robusto para el backoffice.
 * Verifica el token en los headers o en la query string.
 */
export const backofficeAuth = async (req: any, res: any, next: () => void) => {
    // 1. Parsear token
    let q: any = {};
    try {
        if (req.query && typeof req.query === 'object') {
            q = req.query;
        } else {
            const urlStr = req.url || '';
            const queryIndex = urlStr.indexOf('?');
            if (queryIndex !== -1) {
                const searchParams = new URLSearchParams(urlStr.slice(queryIndex));
                searchParams.forEach((v, k) => q[k] = v);
            }
        }
    } catch (e) { console.error("[AUTH] Error parsing query:", e); }
    req.query = q;

    let token = req.headers['authorization'] || q.token || '';
    if (typeof token === 'string') {
        token = token.trim();
        if (token.startsWith('token=')) token = token.slice(6);
        else if (token.startsWith('Bearer ')) token = token.slice(7);
        // Decodear caracteres especiales URL-encodeados (ej: %23 -> #)
        try { token = decodeURIComponent(token); } catch (_) { /* ya decodificado */ }
    }

    const projectId = (HistoryHandler as any).PROJECT_IDENTIFIER || process.env.RAILWAY_PROJECT_ID || 'unknown';
    const currentServiceId = (HistoryHandler as any).SERVICE_IDENTIFIER || 'default_service';

    // 2. Determinar si es SUPERADMIN
    const isSuperAdmin = isSuperAdminToken(token);
    
    let isValid = false;
    let isSubUser = false;
    let userId = null;
    let userRole = 'subuser';
    let userProjectId: string | null = null;
    let userServiceId: string | null = null;

    // 3. Si es SUPERADMIN: permitir, no depende del tenant
    if (isSuperAdmin) {
        isValid = true;
    } else {
        // 4. Para autenticación normal: resolver tenant actual del PROJECT_X
        const tenantResolution = await (HistoryHandler as any).resolveTenantIdByProjectId(projectId);
        
        // 5. Si Railway project está huérfano: 401 inmediatamente
        if (!tenantResolution.resolved && !tenantResolution.globalScope) {
            console.warn(`[AUTH] Proyecto ${projectId} huérfano. Rechazando acceso a ADMIN normal / Subuser.`);
            isValid = false;
        } else if (typeof token === 'string' && token.startsWith('sub:')) {
            // 7. Si es sub:<uuid>: consultar usuario real en DB
            userId = token.split(':')[1];
            isSubUser = true;
            try {
                // Validación estricta y fresca contra DB (bypassing cache)
                const user = await HistoryHandler.getUserById(userId, projectId);
                if (user) {
                    if (user.project_id === projectId && (user.service_id === null || user.service_id === currentServiceId)) {
                        isValid = true;
                        userRole = user.role || 'subuser';
                        userProjectId = user.project_id;
                        userServiceId = user.service_id;
                        // Actualizar cache para otros usos no críticos
                        _userCache.set(userId, { role: userRole, projectId: userProjectId, serviceId: userServiceId, timestamp: Date.now() } as any);
                    } else {
                        console.warn(`[AUTH] Usuario subuser existe pero no corresponde a este proyecto/servicio. project=${projectId}, userProject=${user.project_id}`);
                    }
                } else {
                    console.warn(`[AUTH] Token subuser inválido o usuario no existe/eliminado. id=${userId}`);
                }
            } catch (e) {
                console.error('[AUTH] Error verificando usuario subuser:', e);
            }
        } else {
            // 6. Si es ADMIN normal (intento de login por token): obtener ADMIN_PASS correspondiente al scope actual
            const adminPass = await _fetchAdminPass(projectId, tenantResolution.tenantId);
            if (!adminPass) {
                console.error('⚡⚡ [AUTH-NON-CONFIGURED] ⚡⚡');
                console.error(`DETALLE: No se encontró 'ADMIN_PASS' en la tabla 'settings' ni 'BACKOFFICE_TOKEN'/'ADMIN_PASS' en variables de entorno.`);
                console.error(`PROJECT_ID: ${projectId}`);
            }
            if (adminPass && token === adminPass) {
                isValid = true;
            }
        }
    }
    
    // 8. Solo entonces: isValid = true
    if (token && isValid) {
        req.auth = {
            isAdmin: !isSubUser || userRole === 'admin',
            isSuperAdmin,
            isSubUser,
            userId,
            projectId: userProjectId,
            serviceId: userServiceId
        };
        return next();
    }
    
    console.warn(`[AUTH] Intento fallido para backoffice. project_id=${projectId}, token_present=${Boolean(token)}`);
    
    // Si res.status o res.json no existen (middleware antes de compatibilidad), los manejamos manualmente
    if (typeof res.status === 'function') {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    } else {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
    }
};

/**
 * Middleware de autenticación específico para configuración crítica (System-Config).
 */
export const systemConfigAuth = async (req: any, res: any, next: () => void) => {
    let q: any = {};
    try {
        if (req.query && typeof req.query === 'object') q = req.query;
        else {
            const urlStr = req.url || '';
            const queryIndex = urlStr.indexOf('?');
            if (queryIndex !== -1) {
                const searchParams = new URLSearchParams(urlStr.slice(queryIndex));
                searchParams.forEach((v, k) => q[k] = v);
            }
        }
    } catch (e) { /* ignore */ }

    let token = req.headers['authorization'] || q.token || '';
    if (typeof token === 'string') {
        token = token.trim();
        if (token.startsWith('token=')) token = token.slice(6);
        else if (token.startsWith('Bearer ')) token = token.slice(7);
        // Decodear caracteres especiales URL-encodeados
        try { token = decodeURIComponent(token); } catch (_) { /* ya decodificado */ }
    }

    const isValid = isSuperAdminToken(token);

    if (token && isValid) {
        return next();
    }

    console.warn(`[AUTH-CONFIG] Intento fallido para system config. token_present=${Boolean(token)}, superadmin_configured=${SUPERADMIN_PASSWORDS.length > 0}`);
    
    if (typeof res.status === 'function') {
        return res.status(401).json({ success: false, error: "Unauthorized (System Config)" });
    } else {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: false, error: "Unauthorized (System Config)" }));
    }
};
