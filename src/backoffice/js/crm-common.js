// --- Lógica Común de Navegación y Estilo ---

// Aplica el tema guardado en localStorage al elemento <html>. Llamada en DOMContentLoaded.
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

// Alterna entre light y dark, persiste en localStorage y emite el evento "themeChanged".
// Conecta con el botón #theme-toggle en el HTML.
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    // Disparar evento para que otros módulos se enteren
    window.dispatchEvent(new Event('themeChanged'));
}

// Elimina el token del backoffice y redirige a /login. Usada por todos los módulos del CRM.
function logout() {
    localStorage.removeItem('backoffice_token');
    window.location.href = '/login';
}

// Resaltado automático de la página actual en el Nav
// Marca como "active" el ítem del menú cuyo onclick coincida con la ruta actual.
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
// Si no estamos en /backoffice redirige con ?openPanel=leads; si estamos, delega en window.realToggleLeads (backoffice.js).
window.toggleLeadsPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        window.location.href = '/backoffice?openPanel=leads';
        return;
    }
    // Si ya estamos en backoffice, la función real debe existir en backoffice.js
    if (typeof window.realToggleLeads === 'function') window.realToggleLeads(e);
};

// Igual que toggleLeadsPanel pero para el panel de tickets; delega en window.realToggleTickets.
window.toggleTicketsPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        window.location.href = '/backoffice?openPanel=tickets';
        return;
    }
    if (typeof window.realToggleTickets === 'function') window.realToggleTickets(e);
};

// Igual que toggleLeadsPanel pero para el panel de Meta; delega en window.realToggleMeta.
window.toggleMetaPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        window.location.href = '/backoffice?openPanel=meta';
        return;
    }
    if (typeof window.realToggleMeta === 'function') window.realToggleMeta(e);
};

// Consulta /api/backoffice/whatsapp/config y cambia el ícono del botón de Meta en el nav
// si hay un token de Meta activo. Llamada en DOMContentLoaded.
async function updateMetaNavButton() {
    const navBtn = document.getElementById('nav-meta-btn');
    if (!navBtn) return;

    try {
        const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
        if (!activeToken) return;

        const res = await fetch(`/api/backoffice/whatsapp/config?token=${activeToken}`);
        const data = await res.json();

        // Si hay una configuración activa de Meta (WABA / Token)
        if (data && data.config && data.config.access_token) {
            navBtn.title = "Envio Masivo";
            const icon = navBtn.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-layer-group'; // Nuevo icono para envío masivo
            }
            // Opcional: Cambiar color o añadir un indicador si lo deseas
            navBtn.style.color = '#10b981'; // Un verde esmeralda para indicar "activo/masivo"
        }
    } catch (e) {
        console.error('[CRM-Common] Error al verificar estado de Meta:', e);
    }
}

// Punto de entrada: ejecuta initTheme, highlightActiveNav y updateMetaNavButton.
// También abre automáticamente el panel correcto si llega el query param ?openPanel=.
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    highlightActiveNav();
    updateMetaNavButton(); // Verificar estado de Meta
    
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
