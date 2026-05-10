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
            // icon.className = 'fas fa-layer-group'; // Comentado para evitar cambios no deseados de iconos
            navBtn.title = "Meta Info & Envio Masivo";
            // Opcional: Cambiar color o añadir un indicador si lo deseas
            navBtn.style.color = '#10b981'; // Un verde esmeralda para indicar "activo/masivo"
        }
    } catch (e) {
        console.error('[CRM-Common] Error al verificar estado de Meta:', e);
    }
}

// --- Lógica de Configuración CRM ---
window.crmConfig = [
    { id: 'crm-ticket-title', label: 'Titulo del Ticket', visible: true, order: 0 },
    { id: 'crm-name', label: 'Nombre del Contacto', visible: true, order: 1 },
    { id: 'crm-phone', label: 'Teléfono', visible: true, order: 2 },
    { id: 'crm-cuit', label: 'Cuil / Cuit / DNI', visible: true, order: 3 },
    { id: 'crm-email', label: 'Correo Electrónico', visible: true, order: 4 },
    { id: 'crm-address', label: 'Domicilio', visible: true, order: 5 },
    { id: 'crm-tax-status', label: 'Situación Impositiva', visible: true, order: 6 },
    { id: 'crm-product', label: 'Producto Ofrecido', visible: true, order: 7 },
    { id: 'crm-source', label: 'Fuente / Canal', visible: true, order: 8 },
    { id: 'crm-notes', label: 'Historial de Notas', visible: true, order: 9 },
    { id: 'crm-due-date', label: 'Fecha Alerta / Seguimiento', visible: true, order: 10 },
    { id: 'crm-priority', label: 'Prioridad', visible: true, order: 11 },
    { id: 'crm-status', label: 'Estado del Lead (CRM)', visible: true, order: 12 }
];

window.fetchCRMConfig = async () => {
    const token = localStorage.getItem('backoffice_token');
    if (!token) return;
    try {
        const res = await fetch(`/api/backoffice/get-setting?key=CRM_FIELDS_CONFIG&token=${token}`);
        const data = await res.json();
        if (data.success && data.value) {
            window.crmConfig = JSON.parse(data.value);
        }
    } catch (e) {
        console.error('[CRM Config] Error fetching:', e);
    }
};

window.applyCRMConfig = () => {
    const container = document.getElementById('crm-fields-container');
    if (!container) return;

    window.crmConfig.forEach(f => {
        const el = container.querySelector(`[data-field="${f.id}"]`);
        if (el) {
            el.style.order = f.order;
            el.style.display = f.visible ? 'block' : 'none';
        }
    });
};

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    highlightActiveNav();
    updateMetaNavButton(); // Verificar estado de Meta
    
    // Cargar y aplicar configuración de CRM si corresponde
    await window.fetchCRMConfig();
    window.applyCRMConfig();

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
