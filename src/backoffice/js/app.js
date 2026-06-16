/* global toggleLeadsPanel, toggleTicketsPanel, toggleMetaPanel, io, showToast */
// app.js - Client-side SPA router
// Carga views dinamicamente y maneja la navegacion sin recargar la pagina

const ROUTES = {
    '/backoffice':               '/js/views/backoffice.view.js',
    '/dashboard':                '/js/views/dashboard.view.js',
    '/conexion':                 '/js/views/conexion.view.js',
    '/crm':                      '/js/views/crm.view.js',
    '/crm-tareas':               '/js/views/crm-tareas.view.js',
    '/system-config':            '/js/views/system-config.view.js',
    '/docs':                     '/js/views/docs.view.js',
    '/documentacion':            '/js/views/docs.view.js',
    '/webchat':                  '/js/views/webchat.view.js',
    '/meta':                     '/js/views/meta.view.js',
    '/mercado-libre':            '/js/views/mercado-libre.view.js',
    '/mercado-libre-productos':  '/js/views/mercado-libre-productos.view.js',
    '/mercado-libre-bot':        '/js/views/mercado-libre-bot.view.js',
    '/mercado-pago':             '/js/views/mercado-pago.view.js',
    '/lista-negra':              '/js/views/lista-negra.view.js',
    '/reportes':                 '/js/views/reportes.view.js',
    '/tickets':                  '/js/views/tickets.view.js',
};

const _loadedScripts = {};
let _currentView = null;
let _mountNonce = 0;

function loadViewScript(src) {
    if (_loadedScripts[src]) return Promise.resolve();
    return new Promise((resolve) => {
        const el = document.createElement('script');
        el.src = src + '?v=' + (window.BOT_NAME ? encodeURIComponent(window.BOT_NAME) : '10');
        const done = () => { _loadedScripts[src] = true; resolve(); };
        // Timeout de 30s: safety net para CDN lento; scripts locales no deben llegar a esto
        const t = setTimeout(() => {
            console.warn('[Router] Timeout cargando script, continuando:', src);
            done();
        }, 30000);
        el.onload = () => { clearTimeout(t); done(); };
        el.onerror = () => { clearTimeout(t); console.warn('[Router] Error cargando script:', src); done(); };
        document.head.appendChild(el);
    });
}
window.loadViewScript = loadViewScript;

function getViewName(scriptPath) {
    // '/js/views/crm-tareas.view.js' -> 'crmTareasView'
    const base = scriptPath.split('/').pop().replace('.view.js', '');
    return base.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'View';
}

function highlightActiveNav(path) {
    document.querySelectorAll('#navbar .nav-item[data-route]').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-route') === path);
    });
    // Messaging flyout button
    const msgBtn = document.getElementById('nav-messaging-btn');
    if (msgBtn) msgBtn.classList.toggle('active', path === '/backoffice');
    // Dropdown links de Mensajeria
    document.querySelectorAll('#nav-messaging-btn .nav-dropdown-link[data-route]').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-route') === path);
    });
    // Integraciones flyout button
    const intBtn = document.getElementById('nav-integraciones-btn');
    const isIntegrationPath = ['/crm', '/crm-tareas', '/meta', '/mercado-libre', '/mercado-libre-productos', '/mercado-libre-bot', '/mercado-pago', '/lista-negra'].includes(path);
    if (intBtn) intBtn.classList.toggle('active', isIntegrationPath);
    // Dropdown links de Integraciones
    document.querySelectorAll('#nav-integraciones-btn .nav-dropdown-link[data-route]').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-route') === path);
    });

    // Expandir y activar sub-dropdown de Mercado Libre si corresponde
    const meliSub = document.getElementById('nav-mercado-libre-sub');
    if (meliSub) {
        const isMeliPath = ['/mercado-libre-productos', '/mercado-libre-bot', '/mercado-pago'].includes(path);
        meliSub.classList.toggle('active', isMeliPath);
        const subMenu = meliSub.querySelector('.nav-sub-dropdown-menu');
        const chevron = meliSub.querySelector('.nav-sub-dropdown-icon');
        if (isMeliPath) {
            meliSub.classList.add('open');
            if (subMenu) subMenu.style.height = subMenu.scrollHeight + 'px';
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
            meliSub.classList.remove('open');
            if (subMenu) subMenu.style.height = '0';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    }

    // Cerrar flyouts al navegar (solo si no es ruta interna de integraciones que necesite mantenerlas abiertas en mobile)
    if (typeof window.closeMessagingFlyout === 'function') window.closeMessagingFlyout();
    if (typeof window.closeIntegracionesFlyout === 'function') window.closeIntegracionesFlyout();
}
window.highlightActiveNav = highlightActiveNav;

async function mountView(path) {
    const nonce = ++_mountNonce;

    // Normalizar path (quitar trailing slash)
    const cleanPath = path.replace(/\/$/, '') || '/backoffice';
    const viewScript = ROUTES[cleanPath];

    if (!viewScript) {
        navigate('/backoffice');
        return;
    }

    if (cleanPath === '/system-config' && window.__SYSTEM_CONFIG_VISIBLE === false) {
        navigate('/dashboard');
        return;
    }

    // Destruir view actual
    if (_currentView && typeof _currentView.destroy === 'function') {
        _currentView.destroy();
    }

    const root = document.getElementById('view-root');
    if (!root) return;

    root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;"><i class="fas fa-circle-notch fa-spin" style="font-size:2rem;color:var(--accent-color,#0099FF);"></i></div>';

    try {
        // Para crm-tareas: pre-cargar crm.view.js para que _getCRMModals este disponible
        if (cleanPath === '/crm-tareas') {
            await loadViewScript('/js/views/crm.view.js');
        }
        if (nonce !== _mountNonce) return;

        await loadViewScript(viewScript);
        if (nonce !== _mountNonce) return;

        const viewName = getViewName(viewScript);
        const view = window[viewName];

        if (!view) {
            console.error(`[Router] View "${viewName}" no encontrada despues de cargar ${viewScript}`);
            return;
        }

        root.innerHTML = view.getHTML ? view.getHTML() : '';
        if (nonce !== _mountNonce) return;

        if (view.title) document.title = view.title;
        highlightActiveNav(cleanPath);
        _currentView = view;

        if (typeof view.init === 'function') {
            await view.init();
        }
    } catch (err) {
        if (nonce !== _mountNonce) return;
        console.error('[Router] Error montando view:', err);
        root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;color:#ef4444;"><i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i> Error cargando la pagina.</div>`;
    }
}

// Funcion global de navegacion SPA
function navigate(path) {
    // Separar path de query string para comparacion
    const [pathname] = path.split('?');
    const current = window.location.pathname;

    // Si el path es el mismo no hacer nada (pero si hay query string, actualizar)
    if (pathname === current && !path.includes('?')) return;

    history.pushState({}, '', path);
    mountView(pathname);
}
window.navigate = navigate;

// Manejar navegacion con el boton atras/adelante del browser
window.addEventListener('popstate', () => {
    mountView(window.location.pathname);
});

// Iniciar en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    mountView(window.location.pathname);

    // Escuchar cambios de settings en tiempo real
    const _appSocket = io();
    _appSocket.on('setting_changed', ({ key, value }) => {
        if (key === 'SYSTEM_CONFIG_VISIBLE') {
            const enabled = value !== 'false';
            window.__SYSTEM_CONFIG_VISIBLE = enabled;
            const navItem = document.querySelector('[data-route="/system-config"]')?.closest('li');
            if (navItem) navItem.classList.toggle('hidden-item', !enabled);
            const label = enabled ? 'Activado: Developer Settings' : 'Desactivado: Developer Settings';
            showToast(label, enabled ? 'success' : 'info');
            if (!enabled && window.location.pathname === '/system-config') {
                navigate('/dashboard');
            }
        }
    });
});
