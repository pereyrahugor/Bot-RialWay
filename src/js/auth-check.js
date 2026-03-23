(function() {
    const token = localStorage.getItem('backoffice_token');
    const path = window.location.pathname;
    const protectedPaths = ['/backoffice', '/system-config'];
    
    // Solo redirigir si intenta entrar a una ruta protegida sin token
    if (!token && protectedPaths.some(p => path.startsWith(p))) {
        window.location.href = '/login';
    }
})();
