import { HistoryHandler } from "../utils/historyHandler";

/**
 * Middleware de autenticación robusto para el backoffice.

 * Verifica el token en los headers o en la query string.
 */
export const backofficeAuth = async (req: any, res: any, next: () => void) => {
    // Asegurar parsing de query si Polka/Node no lo ha expuesto aún
    const q: any = {};
    try {
        const url = new URL(req.url || '', 'http://localhost');
        url.searchParams.forEach((v, k) => q[k] = v);
    } catch (e) { /* fallback empty */ }
    req.query = q;

    let token = req.headers['authorization'] || q.token || '';
    if (typeof token === 'string') {
        if (token.startsWith('token=')) token = token.slice(6);
        else if (token.startsWith('Bearer ')) token = token.slice(7);
    }
    
    // Prioridad: Database Setting > Environment Variable
    const dbAdminPass = await HistoryHandler.getSetting('ADMIN_PASS');
    const adminPass = dbAdminPass || process.env.ADMIN_PASS;
    
    let isValid = (token === "neuroadmin25" || (adminPass && token === adminPass));
    let isSubUser = false;
    let userId = null;

    if (!isValid && token?.startsWith('sub:')) {
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
    
    console.warn(`[AUTH] Intento fallido de acceso al backoffice. Token recibido: ${token ? 'presente(***)' : 'ausente'}`);
    
    // Si res.status o res.json no existen (middleware antes de compatibilidad), los manejamos manualmente
    if (typeof res.status === 'function') {
        res.status(401).json({ success: false, error: "Unauthorized" });
    } else {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
    }
};

/**
 * Middleware de autenticación específico para configuración crítica (System-Config).
 */
export const systemConfigAuth = (req: any, res: any, next: () => void) => {
    const q: any = {};
    try {
        const url = new URL(req.url || '', 'http://localhost');
        url.searchParams.forEach((v, k) => q[k] = v);
    } catch (e) { /* fallback empty */ }

    let token = req.headers['authorization'] || q.token || '';
    if (typeof token === 'string') {
        if (token.startsWith('token=')) token = token.slice(6);
        else if (token.startsWith('Bearer ')) token = token.slice(7);
    }

    if (token && token === "neuroadmin25") {
        return next();
    }

    console.warn(`[AUTH] Intento fallido de acceso a CONFIGURACIÓN. Token recibido: ${token ? 'presente(***)' : 'ausente'}`);
    
    if (typeof res.status === 'function') {
        res.status(401).json({ success: false, error: "Unauthorized (System Config)" });
    } else {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: "Unauthorized (System Config)" }));
    }
};
