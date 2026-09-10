(function() {
    const path = window.location.pathname;
    
    // 1. Protección de Backoffice, CRM, Docs e Integraciones
    if (path.startsWith('/conversaciones') || path.startsWith('/crm') ||
        path.startsWith('/documentacion') || path.startsWith('/docs') ||
        path.startsWith('/dashboard') || path.startsWith('/conexion') ||
        path.startsWith('/webchat') || path.startsWith('/meta') ||
        path.startsWith('/reportes') || path.startsWith('/tickets') ||
        path.startsWith('/lista-negra') || path.startsWith('/mercado-libre') ||
        path.startsWith('/mercado-pago')) {
        const token = localStorage.getItem('backoffice_token');
        if (!token) {
            if (window.location.hostname === 'crm-neurolinks-test-demo.up.railway.app') {
                const target = path.replace(/^\//, '') || 'dashboard';
                window.location.href = `/login?demo=true&target=${encodeURIComponent(target)}`;
            } else {
                window.location.href = '/login';
            }
        }
    }
    
    // 2. Proteccion de Configuracion Critica (Dashboard de Configuracion)
    if (path.startsWith('/system-config')) {
        const configToken = localStorage.getItem('system_config_token');
        const isSuperAdmin = localStorage.getItem('is_superadmin') === 'true';
        if (!configToken || !isSuperAdmin) {
            window.location.href = '/login?target=system-config';
        }
    }
})();

// Interceptor de Fetch global para codificar automáticamente el token en query strings
(function() {
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            const tokenIdx = input.indexOf('token=');
            if (tokenIdx !== -1) {
                const prefix = input.substring(0, tokenIdx + 6);
                const remainder = input.substring(tokenIdx + 6);
                const ampIdx = remainder.indexOf('&');
                let rawToken, suffix;
                if (ampIdx !== -1) {
                    rawToken = remainder.substring(0, ampIdx);
                    suffix = remainder.substring(ampIdx);
                } else {
                    rawToken = remainder;
                    suffix = '';
                }
                const decodedToken = decodeURIComponent(rawToken);
                const encodedToken = encodeURIComponent(decodedToken);
                input = prefix + encodedToken + suffix;
            }
        } else if (input && typeof input === 'object' && typeof input.toString === 'function') {
            let inputStr = input.toString();
            const tokenIdx = inputStr.indexOf('token=');
            if (tokenIdx !== -1) {
                const prefix = inputStr.substring(0, tokenIdx + 6);
                const remainder = inputStr.substring(tokenIdx + 6);
                const ampIdx = remainder.indexOf('&');
                let rawToken, suffix;
                if (ampIdx !== -1) {
                    rawToken = remainder.substring(0, ampIdx);
                    suffix = remainder.substring(ampIdx);
                } else {
                    rawToken = remainder;
                    suffix = '';
                }
                const decodedToken = decodeURIComponent(rawToken);
                const encodedToken = encodeURIComponent(decodedToken);
                input = prefix + encodedToken + suffix;
            }
        }
        return originalFetch(input, init);
    };
})();

/**
 * Retorna el token de autenticación del backoffice listo para usar en URLs.
 * Usa encodeURIComponent para evitar que caracteres especiales (#, &, etc.)
 * rompan la query string.
 */
window.getAuthToken = function() {
    const raw = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token') || '';
    return encodeURIComponent(raw);
};
