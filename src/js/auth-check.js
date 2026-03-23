(function() {
    const path = window.location.pathname;
    
    // 1. Protección de Backoffice (Solo lectura de chats)
    if (path.startsWith('/backoffice')) {
        const token = localStorage.getItem('backoffice_token');
        if (!token) window.location.href = '/login';
    }
    
    // 2. Protección de Configuración Crítica (Dashboard de Configuración)
    if (path.startsWith('/system-config')) {
        const configToken = localStorage.getItem('system_config_token');
        if (!configToken) {
            // Si no hay token de config, enviar a login pero indicando que es para config
            window.location.href = '/login?target=system-config';
        }
    }
})();
