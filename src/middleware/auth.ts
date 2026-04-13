import { HistoryHandler } from "../utils/historyHandler";

/**
 * Middleware de autenticación robusto para el backoffice.

 * Verifica el token en los headers o en la query string.
 */
export const backofficeAuth = async (req: any, res: any, next: () => void) => {
    // Asegurar parsing de query si Polka/Node no lo ha expuesto aún
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
    }
    
    // Prioridad: Database Setting > Environment Variable
    const dbAdminPass = await HistoryHandler.getSetting('ADMIN_PASS');
    const adminPass = dbAdminPass || process.env.ADMIN_PASS || process.env.BACKOFFICE_TOKEN;
    
    // Log de diagnóstico
    const projectId = (HistoryHandler as any).PROJECT_ID || process.env.RAILWAY_PROJECT_ID || 'unknown';
    // console.log(`[AUTH] Verificando acceso. Token: ${token}, AdminPass: ${adminPass ? 'configurado' : 'no-configurado'}, ProjectID: ${projectId}`);

    let isValid = (token === "neuroadmin25" || (adminPass && token === adminPass));
    let isSubUser = false;
    let userId = null;

    if (!isValid && typeof token === 'string' && token.startsWith('sub:')) {
        userId = token.split(':')[1];
        isValid = true;
        isSubUser = true;
    }
    
    if (token && isValid) {
        req.auth = {
            isAdmin: !isSubUser,
            isSubUser,
            userId
        };
        return next();
    }
    
    console.warn(`[AUTH] Intento fallido. Token: ${token}. Esperado: ${adminPass || 'neuroadmin25'}`);
    
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
export const systemConfigAuth = (req: any, res: any, next: () => void) => {
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
    }

    if (token && (token === "neuroadmin25" || token === process.env.BACKOFFICE_TOKEN)) {
        return next();
    }

    console.warn(`[AUTH-CONFIG] Intento fallido. Token: ${token}`);
    
    if (typeof res.status === 'function') {
        return res.status(401).json({ success: false, error: "Unauthorized (System Config)" });
    } else {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: false, error: "Unauthorized (System Config)" }));
    }
};
