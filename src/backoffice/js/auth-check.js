(function() {
    const path = window.location.pathname;
    
    // 1. Protección de Backoffice, CRM, Docs e Integraciones
    if (path.startsWith('/backoffice') || path.startsWith('/crm') ||
        path.startsWith('/documentacion') || path.startsWith('/docs') ||
        path.startsWith('/dashboard') || path.startsWith('/conexion') ||
        path.startsWith('/webchat') || path.startsWith('/meta') ||
        path.startsWith('/reportes') || path.startsWith('/tickets') ||
        path.startsWith('/lista-negra') || path.startsWith('/mercado-libre') ||
        path.startsWith('/mercado-pago')) {
        const token = localStorage.getItem('backoffice_token');
        if (!token) window.location.href = '/login';
    }
    
    // 2. Protección de Configuración Crítica (Dashboard de Configuración)
    if (path.startsWith('/system-config')) {
        let configToken = localStorage.getItem('system_config_token');
        if (!configToken && localStorage.getItem('backoffice_token') === "neuroadmin25") {
            configToken = "neuroadmin25";
            localStorage.setItem('system_config_token', configToken);
        }
        if (!configToken || configToken !== "neuroadmin25") {
            // Si no es el token maestro, forzar login
            window.location.href = '/login?target=system-config';
        }
    }
})();
