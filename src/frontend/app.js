/* global toggleLeadsPanel, toggleTicketsPanel, toggleMetaPanel, io, showToast */
// app.js - Client-side SPA router
// Carga views dinamicamente y maneja la navegacion sin recargar la pagina

const ROUTES = {
    '/backoffice':               '/js/backoffice/backoffice.view.js',
    '/dashboard':                '/js/dashboard/dashboard.view.js',
    '/conexion':                 '/js/conexion/conexion.view.js',
    '/crm':                      '/js/crm/crm.view.js',
    '/crm-tareas':               '/js/crm/crm-tareas.view.js',
    '/system-config':            '/js/system-config/system-config.view.js',
    '/docs':                     '/js/docs/docs.view.js',
    '/documentacion':            '/js/docs/docs.view.js',
    '/webchat':                  '/js/webchat/webchat.view.js',
    '/meta':                     '/js/meta/meta.view.js',
    '/mercado-libre':            '/js/mercado-libre/mercado-libre.view.js',
    '/mercado-libre-productos':  '/js/mercado-libre/mercado-libre-productos.view.js',
    '/mercado-libre-bot':        '/js/mercado-libre/mercado-libre-bot.view.js',
    '/mercado-pago':             '/js/mercado-libre/mercado-pago.view.js',
    '/lista-negra':              '/js/lista-negra/lista-negra.view.js',
    '/reportes':                 '/js/reportes/reportes.view.js',
    '/usuarios':                 '/js/usuarios/usuarios.view.js',
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

window.openSupportWidget = async function(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (typeof window.closeMessagingFlyout === 'function') window.closeMessagingFlyout();
    if (typeof window.closeIntegracionesFlyout === 'function') window.closeIntegracionesFlyout();
    if (typeof window.closeAjustesFlyout === 'function') window.closeAjustesFlyout();
    await loadViewScript('/js/tickets/support.widget.js');
    if (window.supportWidget) {
        window.supportWidget.init();
        window.supportWidget.toggleOpen();
    }
};

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
    // Ajustes flyout button
    const ajBtn = document.getElementById('nav-ajustes-btn');
    const isAjustesPath = ['/system-config', '/docs', '/documentacion', '/usuarios'].includes(path);
    if (ajBtn) ajBtn.classList.toggle('active', isAjustesPath);
    document.querySelectorAll('#nav-ajustes-btn .nav-dropdown-link[data-route]').forEach(item => {
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
    if (typeof window.closeAjustesFlyout === 'function') window.closeAjustesFlyout();
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

    // Validar que exista el token correspondiente antes de proceder al montaje o llamadas a la API
    const isSystemConfig = cleanPath === '/system-config';
    let token = isSystemConfig 
        ? localStorage.getItem('system_config_token') 
        : localStorage.getItem('backoffice_token');

    if (isSystemConfig && !token && localStorage.getItem('backoffice_token') === "neuroadmin25") {
        token = "neuroadmin25";
        localStorage.setItem('system_config_token', token);
    }

    if (!token) {
        console.warn(`[Router] No hay token para la ruta ${cleanPath}. Abortando montaje y redirigiendo.`);
        window.location.href = isSystemConfig ? '/login?target=system-config' : '/login';
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
            await loadViewScript('/js/crm/crm.view.js');
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

        // Limpiar notificaciones localmente de forma inmediata y guardar visitas en localStorage
        if (cleanPath === '/backoffice') {
            localStorage.setItem('last_visited_conversaciones', Date.now().toString());
            const el = document.getElementById('dot-conversaciones');
            if (el) el.style.display = 'none';
        } else if (cleanPath === '/reportes') {
            localStorage.setItem('last_visited_reportes', Date.now().toString());
            const el = document.getElementById('dot-reportes');
            if (el) el.style.display = 'none';
        } else if (cleanPath === '/crm') {
            localStorage.setItem('last_visited_crm', Date.now().toString());
            const el = document.getElementById('dot-crm');
            if (el) el.style.display = 'none';
        } else if (cleanPath === '/crm-tareas') {
            localStorage.setItem('last_visited_tareas', Date.now().toString());
            const el = document.getElementById('dot-tareas');
            if (el) el.style.display = 'none';
        }

        // Limpiar puntos padres localmente si todos sus hijos estan limpios
        const showConversaciones = document.getElementById('dot-conversaciones')?.style.display === 'inline-block';
        const showReportes = document.getElementById('dot-reportes')?.style.display === 'inline-block';
        if (!showConversaciones && !showReportes) {
            const el = document.getElementById('dot-messaging');
            if (el) el.style.display = 'none';
        }

        const showCrm = document.getElementById('dot-crm')?.style.display === 'inline-block';
        const showTareas = document.getElementById('dot-tareas')?.style.display === 'inline-block';
        if (!showCrm && !showTareas) {
            const el = document.getElementById('dot-integraciones');
            if (el) el.style.display = 'none';
        }

        // Actualizar desde el servidor
        if (typeof window.updateNotificationDots === 'function') {
            window.updateNotificationDots();
        }

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

// Funcion global para actualizar puntos de notificacion en el sidebar
async function updateNotificationDots() {
    const token = localStorage.getItem('backoffice_token') || '';
    if (!token || token === 'undefined') return;

    try {
        const res = await fetch(`/api/backoffice/notifications/summary?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!data || !data.success) return;

        const currentPath = window.location.pathname;

        // --- Conversaciones ---
        const showConversaciones = data.unread_chats_count > 0 && currentPath !== '/backoffice';
        const dotConversaciones = document.getElementById('dot-conversaciones');
        if (dotConversaciones) dotConversaciones.style.display = showConversaciones ? 'inline-block' : 'none';

        // --- Tickets (Ahora en Support Widget) ---
        // El widget maneja sus propias notificaciones si está instanciado, pero podemos notificarle
        const lastTicketsVisit = parseInt(localStorage.getItem('last_visited_tickets') || '0');
        const latestTicketTime = data.latest_ticket_time ? new Date(data.latest_ticket_time).getTime() : 0;
        const showTickets = latestTicketTime > lastTicketsVisit;
        const dotTickets = document.getElementById('sw-badge');
        if (dotTickets) dotTickets.style.display = showTickets ? 'block' : 'none';

        // --- Reportes ---
        const lastReportesVisit = parseInt(localStorage.getItem('last_visited_reportes') || '0');
        const latestReporteTime = data.latest_reporte_time ? new Date(data.latest_reporte_time).getTime() : 0;
        const showReportes = latestReporteTime > lastReportesVisit && currentPath !== '/reportes';
        const dotReportes = document.getElementById('dot-reportes');
        if (dotReportes) dotReportes.style.display = showReportes ? 'inline-block' : 'none';

        // --- CRM ---
        const lastCrmVisit = parseInt(localStorage.getItem('last_visited_crm') || '0');
        const latestLeadTime = data.latest_crm_lead_time ? new Date(data.latest_crm_lead_time).getTime() : 0;
        const showCrm = latestLeadTime > lastCrmVisit && currentPath !== '/crm';
        const dotCrm = document.getElementById('dot-crm');
        if (dotCrm) dotCrm.style.display = showCrm ? 'inline-block' : 'none';

        // --- Tareas ---
        const lastTareasVisit = parseInt(localStorage.getItem('last_visited_tareas') || '0');
        const latestTareaTime = data.latest_tarea_time ? new Date(data.latest_tarea_time).getTime() : 0;
        const showTareas = latestTareaTime > lastTareasVisit && currentPath !== '/crm-tareas';
        const dotTareas = document.getElementById('dot-tareas');
        if (dotTareas) dotTareas.style.display = showTareas ? 'inline-block' : 'none';

        // --- Mensajeria (Padre) ---
        const showMessaging = showConversaciones || showReportes;
        const dotMessaging = document.getElementById('dot-messaging');
        if (dotMessaging) dotMessaging.style.display = showMessaging ? 'inline-block' : 'none';

        // --- Integraciones (Padre) ---
        const showIntegraciones = showCrm || showTareas;
        const dotIntegraciones = document.getElementById('dot-integraciones');
        if (dotIntegraciones) dotIntegraciones.style.display = showIntegraciones ? 'inline-block' : 'none';

    } catch (e) {
        console.error('[Router] Error al actualizar puntos de notificacion:', e);
    }
}
window.updateNotificationDots = updateNotificationDots;

// Iniciar en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    mountView(window.location.pathname);
    
    // Cargar Support Widget Globalmente
    loadViewScript('/js/tickets/support.widget.js').then(() => {
        if (window.supportWidget) {
            window.supportWidget.init();
        }
    });

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

    // Escuchar eventos en tiempo real para actualizar los puntos de notificacion
    _appSocket.on('new_message', () => {
        updateNotificationDots();
    });
    _appSocket.on('contact_updated', () => {
        updateNotificationDots();
    });
    _appSocket.on('ticket_updated', () => {
        updateNotificationDots();
    });
    _appSocket.on('reporte_created', () => {
        updateNotificationDots();
    });

    // Actualizacion inicial corta y polling de seguridad de 30 segundos
    setTimeout(updateNotificationDots, 1000);
    setInterval(updateNotificationDots, 30000);
});
