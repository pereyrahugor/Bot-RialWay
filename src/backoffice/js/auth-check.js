(function() {
    const path = window.location.pathname;
    
    // 1. Protección de Backoffice, CRM y Docs
    if (path.startsWith('/backoffice') || path.startsWith('/crm') ||
        path.startsWith('/documentacion') || path.startsWith('/docs') ||
        path.startsWith('/dashboard') || path.startsWith('/conexion') ||
        path.startsWith('/webchat')) {
        const token = localStorage.getItem('backoffice_token');
        if (!token) window.location.href = '/login';
    }
    
    // 2. Protección de Configuración Crítica (Dashboard de Configuración)
    if (path.startsWith('/system-config')) {
        const configToken = localStorage.getItem('system_config_token');
        if (!configToken || configToken !== "neuroadmin25") {
            // Si no es el token maestro, forzar login
            window.location.href = '/login?target=system-config';
        }
    }
})();
