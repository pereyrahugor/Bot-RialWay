// --- Lógica Común de Navegación y Estilo ---

// ── Custom Select Dropdown (CSD) helpers ─────────────────────────────
function _csdCloseAll() {
    document.querySelectorAll('.csd-menu.open').forEach(m => {
        m.classList.remove('open', 'csd-sm');
        m.style.cssText = '';
        if (m._csdWrap) {
            m._csdWrap.appendChild(m);
            const b = m._csdWrap.querySelector('.csd-btn');
            if (b) b.classList.remove('open');
            delete m._csdWrap;
        }
    });
}
function _csdToggle(btn) {
    const wrap = btn.closest('.csd-wrap');
    const isOpen = btn.classList.contains('open');
    _csdCloseAll();
    if (isOpen) return;
    const menu = wrap.querySelector('.csd-menu');
    if (!menu) return;

    menu._csdWrap = wrap;
    if (wrap.classList.contains('csd-sm')) menu.classList.add('csd-sm');
    document.body.appendChild(menu);

    // Measure actual height off-screen before positioning
    menu.style.cssText = 'position:fixed;visibility:hidden;top:-9999px;left:-9999px;';
    menu.classList.add('open');
    const menuH = menu.offsetHeight || 228;

    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuH;
    const top = openAbove ? Math.max(4, rect.top - menuH - 4) : rect.bottom + 4;

    menu.style.cssText = `position:fixed;top:${top}px;left:${rect.left}px;width:${rect.width}px;right:auto;z-index:99999;`;
    btn.classList.add('open');

    setTimeout(() => {
        function h(e) {
            if (!wrap.contains(e.target) && !menu.contains(e.target)) {
                _csdCloseAll();
                document.removeEventListener('click', h, { capture: true });
                document.removeEventListener('scroll', h, { capture: true });
            }
        }
        document.addEventListener('click', h, { capture: true });
        document.addEventListener('scroll', h, { capture: true });
    }, 0);
}
function _csdSelect(item, value) {
    const menu = item.closest('.csd-menu');
    const wrap = (menu && menu._csdWrap) || item.closest('.csd-wrap');
    if (!wrap) return;
    const sel = wrap.querySelector('select');
    const label = wrap.querySelector('.csd-label');
    if (sel) { sel.value = value; sel.dispatchEvent(new Event('change')); }
    if (label) label.textContent = item.textContent.trim();
    if (menu) menu.querySelectorAll('.csd-item').forEach(i => i.classList.toggle('selected', i === item));
    _csdCloseAll();
}
function _csdSync(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const wrap = sel.closest('.csd-wrap');
    if (!wrap) return;
    const label = wrap.querySelector('.csd-label');
    const opt = sel.options[sel.selectedIndex];
    if (label && opt) label.textContent = opt.text;
    const menu = wrap.querySelector('.csd-menu');
    if (menu) menu.querySelectorAll('.csd-item').forEach(i => i.classList.toggle('selected', i.dataset.val === sel.value));
}
function _csdRebuild(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const wrap = sel.closest('.csd-wrap');
    if (!wrap) return;
    const menu = wrap.querySelector('.csd-menu');
    if (!menu) return;
    menu.innerHTML = Array.from(sel.options).map(o =>
        `<button class="csd-item" type="button" data-val="${o.value}" onclick="_csdSelect(this,'${o.value.replace(/'/g,"\\'")}')">  ${o.text}</button>`
    ).join('');
}

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
        item.classList.remove('active');
        const route = item.getAttribute('data-route');
        if (route) {
            if (route === path) item.classList.add('active');
            return;
        }
        const onclick = item.getAttribute('onclick') || '';
        if (path === '/backoffice' && onclick.includes('/backoffice')) item.classList.add('active');
        if (path === '/dashboard' && onclick.includes('/dashboard')) item.classList.add('active');
        if (path === '/crm' && onclick.includes("'/crm'")) item.classList.add('active');
        if (path === '/crm-tareas' && onclick.includes("'/crm-tareas'")) item.classList.add('active');
        if (path === '/webchat' && onclick.includes('/webchat')) item.classList.add('active');
        if (path === '/system-config' && onclick.includes('/system-config')) item.classList.add('active');
    });

    // Mensajeria: activo solo en /backoffice (ruta directa del dropdown)
    const msgBtn = document.getElementById('nav-messaging-btn');
    if (msgBtn) msgBtn.classList.toggle('active', path === '/backoffice');
}

// ── Dropdown Mensajeria ────────────────────────────────────────────
function _closeAllNavDropdowns() {
    document.querySelectorAll('#navbar .nav-dropdown.open').forEach(el => {
        el.classList.remove('open');
        const menu = el.querySelector('.nav-dropdown-menu');
        if (menu) menu.style.height = '0';
    });
}

window.toggleMessagingFlyout = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const container = document.getElementById('nav-messaging-btn');
    if (!container) return;
    const menu = container.querySelector('.nav-dropdown-menu');
    if (!menu) return;

    const isOpen = container.classList.contains('open');
    _closeAllNavDropdowns();
    if (!isOpen) {
        container.classList.add('open');
        menu.style.height = menu.scrollHeight + 'px';
        // Mark active links
        const path = window.location.pathname;
        document.querySelectorAll('#nav-messaging-btn .nav-dropdown-link[data-route]').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-route') === path);
        });
    }
};

window.closeMessagingFlyout = function() {
    const container = document.getElementById('nav-messaging-btn');
    if (!container) return;
    container.classList.remove('open');
    const menu = container.querySelector('.nav-dropdown-menu');
    if (menu) menu.style.height = '0';
};

window.toggleIntegracionesFlyout = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const container = document.getElementById('nav-integraciones-btn');
    if (!container) return;
    const menu = container.querySelector('.nav-dropdown-menu');
    if (!menu) return;
    const isOpen = container.classList.contains('open');
    _closeAllNavDropdowns();
    if (!isOpen) {
        container.classList.add('open');
        menu.style.height = menu.scrollHeight + 'px';
        const path = window.location.pathname;
        container.querySelectorAll('.nav-dropdown-link[data-route]').forEach(item => {
            item.classList.toggle('active', item.getAttribute('data-route') === path);
        });
    }
};

window.closeIntegracionesFlyout = function() {
    const container = document.getElementById('nav-integraciones-btn');
    if (!container) return;
    container.classList.remove('open');
    const menu = container.querySelector('.nav-dropdown-menu');
    if (menu) menu.style.height = '0';
};

window.toggleAjustesFlyout = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const container = document.getElementById('nav-ajustes-btn');
    if (!container) return;
    const menu = container.querySelector('.nav-dropdown-menu');
    if (!menu) return;
    const isOpen = container.classList.contains('open');
    _closeAllNavDropdowns();
    if (!isOpen) {
        container.classList.add('open');
        menu.style.height = menu.scrollHeight + 'px';
    }
};

window.closeAjustesFlyout = function() {
    const container = document.getElementById('nav-ajustes-btn');
    if (!container) return;
    container.classList.remove('open');
    const menu = container.querySelector('.nav-dropdown-menu');
    if (menu) menu.style.height = '0';
};

// Manejo inteligente de Paneles laterales desde cualquier página
window.toggleLeadsPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        if (typeof window.navigate === 'function') window.navigate('/backoffice?openPanel=leads');
        else window.location.href = '/backoffice?openPanel=leads';
        return;
    }
    if (typeof window.realToggleLeads === 'function') window.realToggleLeads(e);
};

window.toggleTicketsPanel = (e) => {
    if (window.location.pathname !== '/backoffice') {
        if (typeof window.navigate === 'function') window.navigate('/backoffice?openPanel=tickets');
        else window.location.href = '/backoffice?openPanel=tickets';
        return;
    }
    if (typeof window.realToggleTickets === 'function') window.realToggleTickets(e);
};

// Meta panel vive en el shell - siempre disponible desde cualquier view
window.toggleMetaPanel = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const panel = document.getElementById('meta-panel');
    if (!panel) return;
    // Cerrar otros paneles globales si estan abiertos
    ['leads-panel', 'tickets-panel'].forEach(id => {
        const p = document.getElementById(id);
        if (p) p.classList.remove('active');
    });
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        _refreshMetaPanelStatus();
    }
};
window.realToggleMeta = window.toggleMetaPanel;


async function _refreshMetaPanelStatus() {
    const statusEl = document.getElementById('meta-panel-status');
    if (!statusEl) return;
    try {
        const token = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
        if (!token) return;
        const res = await fetch(`/api/backoffice/whatsapp/config?token=${token}`);
        const data = await res.json();
        if (data && data.config && data.config.access_token) {
            statusEl.textContent = 'Meta Cloud API vinculado';
            statusEl.style.color = '#10b981';
        } else {
            statusEl.textContent = 'Meta Cloud API no vinculado';
            statusEl.style.color = 'rgba(255,255,255,0.4)';
        }
    } catch (_) { /* silencioso */ }
}

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

// ── Sidebar toggle ────────────────────────────────────────────────
function _clearFlyoutStyles() {
    document.querySelectorAll('#navbar .nav-dropdown-menu').forEach(m => {
        m.classList.remove('flyout-active');
    });
}

function _setSidebarCollapsed(collapsed) {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    _closeAllNavDropdowns();
    nav.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
    _clearFlyoutStyles();
}

function _initFlyoutHover() {
    document.querySelectorAll('#navbar .nav-item').forEach(item => {
        const link = item.querySelector(':scope > .nav-link');
        const menu = item.querySelector(':scope > .nav-dropdown-menu');
        if (!link || !menu) return;
        let _t = null;
        const show = () => {
            const nav = document.getElementById('navbar');
            if (!nav || !nav.classList.contains('collapsed')) return;
            if (window.innerWidth <= 768) return;
            clearTimeout(_t);
            menu.classList.add('flyout-active');
        };
        const hide = (delay) => {
            clearTimeout(_t);
            _t = setTimeout(() => menu.classList.remove('flyout-active'), delay);
        };
        link.addEventListener('mouseenter', show);
        link.addEventListener('mouseleave', () => hide(120));
        menu.addEventListener('mouseenter', () => clearTimeout(_t));
        menu.addEventListener('mouseleave', () => hide(80));
    });
}

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    highlightActiveNav();
    updateMetaNavButton();

    // Iniciales del bot en el avatar del header
    const avatar = document.getElementById('nav-brand-avatar');
    if (avatar) {
        const name = (window.BOT_NAME || '').trim();
        const words = name.split(/\s+/).filter(Boolean);
        avatar.textContent = words.length >= 2
            ? (words[0][0] + words[1][0]).toUpperCase()
            : (words[0] || 'B').slice(0, 2).toUpperCase();
    }

    await window.fetchCRMConfig();
    window.applyCRMConfig();


    // Sidebar toggle
    const savedCollapsed = localStorage.getItem('sidebar-collapsed') === '1';
    const isSmall = window.innerWidth <= 768;
    _setSidebarCollapsed(isSmall ? true : savedCollapsed);

    if (isSmall) {
        const t = document.getElementById('sidebar-toggler');
        if (t) t.style.display = 'none';
    }

    _initFlyoutHover();

    const toggler = document.getElementById('sidebar-toggler');
    const mobileBtn = document.getElementById('sidebar-menu-btn');
    const nav = document.getElementById('navbar');
    if (toggler && nav) {
        toggler.addEventListener('click', () => {
            _closeAllNavDropdowns();
            _setSidebarCollapsed(!nav.classList.contains('collapsed'));
        });
    }
    if (mobileBtn && nav) {
        mobileBtn.addEventListener('click', () => {
            _closeAllNavDropdowns();
            _setSidebarCollapsed(!nav.classList.contains('collapsed'));
        });
    }

    // Mobile: cerrar sidebar al navegar a una seccion
    if (nav) {
        nav.addEventListener('click', (e) => {
            if (window.innerWidth > 768) return;
            const link = e.target.closest('.nav-link');
            if (!link) return;
            if (link.closest('.nav-item.nav-dropdown') && !link.classList.contains('nav-dropdown-link')) return;
            _setSidebarCollapsed(true);
        });
    }
});
