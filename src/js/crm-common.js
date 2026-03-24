// --- Lógica Común de Navegación y Estilo ---

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Disparar evento para que otros módulos se enteren
    window.dispatchEvent(new Event('themeChanged'));
}

function logout() {
    localStorage.removeItem('backoffice_token');
    window.location.href = '/login';
}

// Resaltado automático de la página actual en el Nav
function highlightActiveNav() {
    const path = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        const onclick = item.getAttribute('onclick') || '';
        item.classList.remove('active');
        
        if (path === '/backoffice' && onclick.includes('/backoffice')) item.classList.add('active');
        if (path === '/dashboard' && onclick.includes('/dashboard')) item.classList.add('active');
        if (path === '/crm' && onclick.includes('/crm')) item.classList.add('active');
        if (path === '/webchat' && onclick.includes('/webchat')) item.classList.add('active');
        if (path === '/system-config' && onclick.includes('/system-config')) item.classList.add('active');
    });
}

// Manejo inteligente de Paneles laterales desde cualquier página
window.toggleLeadsPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        window.location.href = '/backoffice?openPanel=leads';
        return;
    }
    // Si ya estamos en backoffice, la función real debe existir en backoffice.js
    if (typeof window.realToggleLeads === 'function') window.realToggleLeads(e);
};

window.toggleTicketsPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        window.location.href = '/backoffice?openPanel=tickets';
        return;
    }
    if (typeof window.realToggleTickets === 'function') window.realToggleTickets(e);
};

window.toggleMetaPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        window.location.href = '/backoffice?openPanel=meta';
        return;
    }
    if (typeof window.realToggleMeta === 'function') window.realToggleMeta(e);
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    highlightActiveNav();
    
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    
    // Verificar si venimos redirigidos para abrir un panel
    const urlParams = new URLSearchParams(window.location.search);
    const panelToOpen = urlParams.get('openPanel');
    if (panelToOpen && window.location.pathname === '/backoffice') {
        // Esperar un momento a que backoffice.js cargue y defina las funciones
        setTimeout(() => {
            if (panelToOpen === 'leads') window.toggleLeadsPanel();
            if (panelToOpen === 'tickets') window.toggleTicketsPanel();
            if (panelToOpen === 'meta') window.toggleMetaPanel();
        }, 500);
    }
});
