/* global toggleLeadsPanel, toggleTicketsPanel, toggleMetaPanel, io, showToast, Swal */
// app.js - Client-side SPA router
// Carga views dinamicamente y maneja la navegacion sin recargar la pagina

const ROUTES = window.__APP_ROUTES || {};
const APP_DOCUMENT_TITLE = 'Backoffice - Neurolinks';

const _loadedScripts = {};
let _currentView = null;
let _mountNonce = 0;
const NOTIFICATION_DOT_STORAGE_KEY = 'backoffice_notification_dot_state';
const SECTION_LAST_ROUTE_KEYS = {
    messaging: 'backoffice_last_route_messaging',
    integrations: 'backoffice_last_route_integrations'
};
function collectSectionRoutes(section) {
    const config = window.__NAV_SECTION_TAB_CONFIG || {};
    const visible = typeof window.__NAV_SECTION_TAB_VISIBLE === 'function'
        ? window.__NAV_SECTION_TAB_VISIBLE
        : () => true;
    const routes = [];
    (config[section] || []).filter(visible).forEach(tab => {
        if (tab.route) routes.push(tab.route);
        if (Array.isArray(tab.matchRoutes)) routes.push(...tab.matchRoutes);
        if (Array.isArray(tab.children)) {
            tab.children.filter(visible).forEach(child => {
                if (child.route) routes.push(child.route);
                if (Array.isArray(child.matchRoutes)) routes.push(...child.matchRoutes);
            });
        }
    });
    return Array.from(new Set(routes));
}

const SECTION_ROUTES = {
    messaging: collectSectionRoutes('messaging'),
    integrations: collectSectionRoutes('integrations')
};

function isConversationsPath(path) {
    return path === '/conversaciones';
}

function readNotificationDotState() {
    try {
        return JSON.parse(localStorage.getItem(NOTIFICATION_DOT_STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

const _notificationDotState = readNotificationDotState();

function persistNotificationDotState() {
    try {
        localStorage.setItem(NOTIFICATION_DOT_STORAGE_KEY, JSON.stringify(_notificationDotState));
    } catch {
        // localStorage can fail in restricted contexts; visual state can still be applied in memory.
    }
}

function getDefaultSectionRoute(section) {
    if (section === 'integrations') return window.__CRM_VISIBLE === false ? '/meta' : '/crm';
    return '/dashboard';
}

function getSectionForPath(path) {
    if (SECTION_ROUTES.messaging.includes(path)) return 'messaging';
    if (SECTION_ROUTES.integrations.includes(path)) return 'integrations';
    return null;
}


function rememberSectionRoute(path) {
    const section = getSectionForPath(path);
    if (!section) return;
    try {
        localStorage.setItem(SECTION_LAST_ROUTE_KEYS[section], path);
    } catch {
        // Navigation still works if storage is unavailable.
    }
}


window.navigateToLastSectionRoute = function (section) {
    const allowedRoutes = SECTION_ROUTES[section] || [];
    let route = '';
    try {
        route = localStorage.getItem(SECTION_LAST_ROUTE_KEYS[section]) || '';
    } catch {
        route = '';
    }
    if (!allowedRoutes.includes(route)) route = getDefaultSectionRoute(section);
    if (section === 'integrations' && window.__CRM_VISIBLE === false && ['/crm', '/crm-tareas'].includes(route)) route = '/meta';
    if (section === 'messaging' && window.__BACKOFFICE_VISIBLE === false && ['/conversaciones', '/contactos', '/webchat'].includes(route)) route = '/dashboard';
    navigate(route);
};

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

window.openSupportWidget = async function (e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (window.notificationsWidget && typeof window.notificationsWidget.close === 'function') {
        window.notificationsWidget.close();
    }
    await loadViewScript('/js/tickets/support.widget.js');
    if (window.supportWidget) {
        window.supportWidget.init();
        window.supportWidget.toggleOpen();
    }
};

window.openNotificationsModal = async function (e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    await loadViewScript('/js/notifications/notifications.modal.js');
    if (window.notificationsWidget) {
        window.notificationsWidget.init();
        window.notificationsWidget.toggleOpen();
    }
};

function getViewName(scriptPath) {
    // '/js/views/crm-tareas.view.js' -> 'crmTareasView'
    const base = scriptPath.split('/').pop().replace('.view.js', '');
    return base.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'View';
}

function highlightActiveNav(path) {
    const params = new URLSearchParams(window.location.search);
    document.querySelectorAll('.app-sidemenu-link[data-route]').forEach(item => {
        const route = item.getAttribute('data-route') || '';
        const matchRoutes = (item.getAttribute('data-match-routes') || '').split(',').filter(Boolean);
        const routeMatch = route === path || (route === '/docs' && path === '/documentacion');
        item.classList.toggle('active', Boolean(routeMatch || matchRoutes.includes(path)));
    });
    document.querySelectorAll('.app-sidemenu-details').forEach(details => {
        const active = Boolean(details.querySelector('.app-sidemenu-link.active'));
        details.classList.toggle('active', active);
        if (active) details.open = true;
    });
    document.querySelectorAll('.section-tabs .section-tab').forEach(tab => {
        const route = tab.getAttribute('data-route') || '';
        const panel = tab.getAttribute('data-panel') || '';
        const matchRoutes = (tab.getAttribute('data-match-routes') || '').split(',').filter(Boolean);
        const routeMatch = route === path || (route === '/docs' && path === '/documentacion');
        const groupMatch = matchRoutes.includes(path);
        const panelMatch = panel && isConversationsPath(path) && params.get('openPanel') === panel;
        const backofficeRootMatch = isConversationsPath(route) && isConversationsPath(path) && !params.get('openPanel');
        tab.classList.toggle('active', Boolean(groupMatch || panelMatch || backofficeRootMatch || (routeMatch && !isConversationsPath(route))));
    });
    document.querySelectorAll('.section-tabs .section-tab-menu-item[data-route]').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-route') === path);
    });
}
window.highlightActiveNav = highlightActiveNav;

async function mountView(path) {
    const nonce = ++_mountNonce;

    // Normalizar path (quitar trailing slash)
    const rawPath = path.replace(/\/$/, '') || '/conversaciones';
    const cleanPath = rawPath === '/conexion' ? '/conexion-chatbot' : rawPath;
    const viewScript = ROUTES[cleanPath];
    if (rawPath === '/conexion') {
        history.replaceState(null, '', '/conexion-chatbot');
    }

    if (!viewScript) {
        navigate('/conversaciones');
        return;
    }

    // Validar que exista el token correspondiente antes de proceder al montaje o llamadas a la API
    const isSystemConfig = cleanPath === '/system-config';
    let token = isSystemConfig
        ? localStorage.getItem('system_config_token')
        : localStorage.getItem('backoffice_token');

    if (!token) {
        console.warn(`[Router] No hay token para la ruta ${cleanPath}. Abortando montaje y redirigiendo.`);
        window.location.href = isSystemConfig ? '/login?target=system-config' : '/login';
        return;
    }

    if (isSystemConfig && localStorage.getItem('is_superadmin') !== 'true') {
        window.location.href = '/login?target=system-config';
        return;
    }


    rememberSectionRoute(cleanPath);

    if (typeof window.updateSectionHeader === 'function') {
        window.updateSectionHeader(cleanPath);
    }

    // Destruir view actual
    if (_currentView && typeof _currentView.destroy === 'function') {
        _currentView.destroy();
    }

    const root = document.getElementById('view-content-root') || document.getElementById('view-root');
    if (!root) return;

    root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;width:100%;">' +
        (typeof window.batLoaderHtml === 'function' ? window.batLoaderHtml('Cargando sección...') : '<div class="bat-loader"><div class="bat-stage-wrapper"><div class="bat-stage"><div class="bat-pixel"></div></div></div><span class="bat-loader-text">Cargando sección...</span></div>') +
        '</div>';

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

        document.title = APP_DOCUMENT_TITLE;
        highlightActiveNav(cleanPath);
        applyCachedNotificationDots();
        _currentView = view;

        // Guardar visitas para que el proximo summary confirme si esos pendientes ya fueron leidos.
        // No apagamos visualmente aca: se evita el parpadeo al reconstruir tabs entre views.
        if (cleanPath === '/conversaciones') {
            localStorage.setItem('last_visited_conversaciones', Date.now().toString());
        } else if (cleanPath === '/reportes') {
            localStorage.setItem('last_visited_reportes', Date.now().toString());
        } else if (cleanPath === '/crm') {
            localStorage.setItem('last_visited_crm', Date.now().toString());
        } else if (cleanPath === '/crm-tareas') {
            localStorage.setItem('last_visited_tareas', Date.now().toString());
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
    if (typeof window.updateMetaNavButton === 'function') window.updateMetaNavButton();
});

function setNotificationDot(id, visible, displayMode = 'inline-block') {
    _notificationDotState[id] = { visible: Boolean(visible), displayMode };
    persistNotificationDotState();
    applyNotificationDotElement(id, visible, displayMode);
}

function applyNotificationDotElement(id, visible, displayMode = 'inline-block') {
    const elements = [];
    const el = document.getElementById(id);
    if (el) elements.push(el);
    const selectorId = String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    document.querySelectorAll(`[data-dot-sync="${selectorId}"]`).forEach(syncEl => elements.push(syncEl));
    if (!elements.length) return;

    elements.forEach(dotEl => {
        if (dotEl.classList.contains('section-tab-dot')) {
            dotEl.style.display = 'inline-block';
            dotEl.style.visibility = visible ? 'visible' : 'hidden';
            dotEl.style.opacity = visible ? '1' : '0';
            dotEl.dataset.visible = visible ? 'true' : 'false';
            return;
        }

        dotEl.style.display = visible ? displayMode : 'none';
        dotEl.style.visibility = '';
        dotEl.style.opacity = '';
        delete dotEl.dataset.visible;
    });
}

function isNotificationDotVisible(id) {
    if (_notificationDotState[id]) {
        return _notificationDotState[id].visible === true;
    }

    return false;
}

function applyCachedNotificationDots() {
    Object.entries(_notificationDotState).forEach(([id, state]) => {
        applyNotificationDotElement(id, state.visible === true, state.displayMode || 'inline-block');
    });
}
window.applyCachedNotificationDots = applyCachedNotificationDots;

// Funcion global para actualizar puntos de notificacion en el sidebar
async function updateNotificationDots() {
    const token = localStorage.getItem('backoffice_token') || '';
    if (!token || token === 'undefined') return;

    try {
        const res = await fetch(`/api/backoffice/notifications/summary?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!data || !data.success) return;

        const currentPath = window.location.pathname;

        // --- Notificaciones ---
        const showNotificationsBadge = data.unread_notifications_count > 0 && currentPath !== '/notifications';
        const badgeNotifications = document.getElementById('badge-notifications-count');
        const desktopBadgeNotifications = document.getElementById('desktop-badge-notifications-count');
        const notificationsLabel = data.unread_notifications_count > 99 ? '+99' : data.unread_notifications_count;
        if (badgeNotifications) {
            badgeNotifications.innerText = notificationsLabel;
            badgeNotifications.style.display = showNotificationsBadge ? 'inline-flex' : 'none';
        }
        if (desktopBadgeNotifications) {
            desktopBadgeNotifications.innerText = notificationsLabel;
            desktopBadgeNotifications.style.display = showNotificationsBadge ? 'inline-flex' : 'none';
        }
        document.querySelectorAll('[data-notifications-badge]').forEach(badge => {
            badge.innerText = notificationsLabel;
            badge.style.display = showNotificationsBadge ? 'inline-flex' : 'none';
        });
        document.querySelectorAll('[data-notifications-dot]').forEach(dot => {
            dot.style.display = showNotificationsBadge ? 'inline-flex' : 'none';
        });
        if (typeof window.checkSidebarGlobalDot === 'function') window.checkSidebarGlobalDot();

        // --- Conversaciones ---
        // En chats el pendiente real es el unread count, incluso si la pestaÃ±a
        // Conversaciones esta montada: puede haber chats sin leer dentro.
        const showConversaciones = data.unread_chats_count > 0;
        setNotificationDot('dot-conversaciones', showConversaciones);
        // --- Tickets (Ahora en Support Widget, manejado de forma independiente) ---


        // --- Reportes ---
        const lastReportesVisit = parseInt(localStorage.getItem('last_visited_reportes') || '0');
        const latestReporteTime = data.latest_reporte_time ? new Date(data.latest_reporte_time).getTime() : 0;
        const showReportes = latestReporteTime > lastReportesVisit && currentPath !== '/reportes';
        setNotificationDot('dot-reportes', showReportes);

        // --- CRM / Tareas ---
        const lastCrmVisit = parseInt(localStorage.getItem('last_visited_crm') || '0');
        const latestLeadTime = data.latest_crm_lead_time ? new Date(data.latest_crm_lead_time).getTime() : 0;
        const lastTareasVisit = parseInt(localStorage.getItem('last_visited_tareas') || '0');
        const latestTareaTime = data.latest_tarea_time ? new Date(data.latest_tarea_time).getTime() : 0;
        const crmLeadsCount = Number(data.crm_leads_count || 0);
        const crmTasksCount = Number(data.crm_tasks_count || 0);
        const showCrmLeads = crmLeadsCount > 0 || latestLeadTime > lastCrmVisit;
        setNotificationDot('dot-crm-leads', showCrmLeads);

        const showCrm = showCrmLeads ||
            (crmTasksCount > 0 || latestTareaTime > lastTareasVisit);
        setNotificationDot('dot-crm', showCrm);

        // --- Tareas ---
        const showTareas = crmTasksCount > 0 || latestTareaTime > lastTareasVisit;
        setNotificationDot('dot-tareas', showTareas);

        // --- Gestion (Padre) ---
        const showMessaging = showConversaciones || showReportes;
        setNotificationDot('dot-messaging', showMessaging);

        // --- Integraciones (Padre) ---
        const showIntegraciones = showCrm || showTareas;
        setNotificationDot('dot-integraciones', showIntegraciones);

    } catch (e) {
        console.error('[Router] Error al actualizar puntos de notificacion:', e);
    }
}
window.checkSidebarGlobalDot = function () {
    const hasNotif = document.querySelector('[data-notifications-dot]')?.style.display !== 'none';
    const hasSupport = document.querySelector('[data-support-dot]')?.style.display !== 'none';
    const globalDot = document.getElementById('sidebar-global-dot');
    if (globalDot) {
        globalDot.style.display = (hasNotif || hasSupport) ? 'block' : 'none';
    }
};
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

    // Verificar si el cliente EPC estÃ¡ activo para mostrar el menÃº CBU/CVU/ALIAS
    const backofficeTokenForSlug = localStorage.getItem('backoffice_token');
    if (backofficeTokenForSlug) {
        fetch(`/api/dashboard-status?token=${encodeURIComponent(backofficeTokenForSlug)}`)
            .then(res => res.json())
            .then(data => {
                window.__EPC_VISIBLE = data.clientSlug === 'cas-epc' || data.clientSlug === 'casepc';
                if (typeof window.renderSideMenu === 'function') {
                    window.renderSideMenu();
                }
                if (typeof window.updateSectionHeader === 'function') {
                    window.updateSectionHeader(window.location.pathname, { force: true });
                }
            })
            .catch(err => console.error('[Router] Error checking client slug:', err));
    }

    // Escuchar cambios de settings en tiempo real
    const _appSocket = io();
    _appSocket.on('setting_changed', ({ key }) => {
        if (key === 'GLOBAL_BOT_ENABLED' && typeof window.updateSectionHeader === 'function') {
            window.updateSectionHeader(window.location.pathname, { force: true });
        }
    });

    // Escuchar eventos en tiempo real para actualizar los puntos de notificacion
    _appSocket.on('new_message', (msg) => {
        const normChatId = (id) => String(id || '').split('@')[0];
        const activeBackofficeChatId = window.__activeBackofficeChatId || null;
        const incomingChatId = msg?.chat_id || msg?.chatId || null;
        if (window.location.pathname === '/conversaciones' && activeBackofficeChatId && normChatId(activeBackofficeChatId) === normChatId(incomingChatId)) {
            return;
        }
        updateNotificationDots();
    });
    _appSocket.on('notification_created', () => {
        updateNotificationDots();
        if (window.notificationsWidget && typeof window.notificationsWidget.isOpen === 'function' && window.notificationsWidget.isOpen()) {
            window.notificationsWidget.load();
        }
    });
    _appSocket.on('whatsapp_line_changed', () => {
        if (typeof window.refreshDesktopLineSelector === 'function') {
            window.refreshDesktopLineSelector();
        }
        if (typeof window.refreshConexionStatus === 'function') {
            window.refreshConexionStatus();
        }
    });
    _appSocket.on('baileys_status_changed', () => {
        if (typeof window.refreshConexionStatus === 'function') {
            window.refreshConexionStatus();
        }
        if (typeof window.refreshDesktopLineSelector === 'function') {
            window.refreshDesktopLineSelector();
        }
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

// --- Lógica Global de UI (Movida desde crm-common) ---
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
        `<button class="csd-item" type="button" data-val="${o.value}" onclick="_csdSelect(this,'${o.value.replace(/'/g, "\\'")}')">  ${o.text}</button>`
    ).join('');
}


// Meta vive en /meta view - navegar directamente
window.toggleMetaPanel = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (typeof window.navigate === 'function') window.navigate('/meta');
    else window.location.href = '/meta';
};
window.realToggleMeta = window.toggleMetaPanel;


async function _refreshMetaPanelStatus() {
    try {
        const token = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
        if (!token) return;
        const res = await fetch(`/api/backoffice/whatsapp/config?token=${token}`);
        const data = await res.json();
        const config = (data && data.config) || {};
        const isConnected = !!(config.waba_id && config.phone_number_id);

        const statusEl = document.getElementById('meta-panel-status');
        if (statusEl) {
            statusEl.textContent = isConnected ? 'Meta Cloud API vinculado' : 'Meta Cloud API no vinculado';
            statusEl.style.color = isConnected ? '#10b981' : 'rgba(255,255,255,0.4)';
        }

        const metaPanel = document.getElementById('meta-panel');
        if (!metaPanel) return;
        const content = metaPanel.querySelector('.tickets-list');
        if (!content) return;

        if (isConnected) {
            window.isMetaConnected = true;
            content.innerHTML = `
                <div style="background: linear-gradient(135deg, #10b981, #059669); width: 100px; height: 100px; border-radius: 24px; display: flex; align-items: center; justify-content: center; font-size: 3rem; color: white; box-shadow: 0 15px 30px rgba(16, 185, 129, 0.4); margin-top: 40px;">
                    <i class="fas fa-check-double"></i>
                </div>
                <div>
                    <h2 style="margin: 0; color: var(--text-main); font-size: 1.6rem; font-weight: 700;">Meta Conectado</h2>
                    <div style="height: 3px; width: 50px; background: #10b981; margin: 10px auto; border-radius: 10px;"></div>
                    <p style="color: var(--text-muted); font-size: 1rem; margin-top: 15px; line-height: 1.6;">
                        Tu cuenta de <strong>WhatsApp Business</strong> está vinculada correctamente.
                    </p>
                </div>
                <div style="background: var(--bg-header); padding: 24px; border-radius: 20px; border: 1px solid var(--border); width: 100%; text-align: left;">
                    <h4 style="margin: 0 0 15px 0; color: #10b981; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Detalles de la conexión:</h4>
                    <div style="font-size: 0.9rem; color: var(--text-main); line-height: 1.8;">
                        <div><strong>WABA ID:</strong> ${config.waba_id}</div>
                        <div><strong>ID de Teléfono:</strong> ${config.phone_number_id}</div>
                        ${config.verified_name ? `<div><strong>Nombre:</strong> ${config.verified_name}</div>` : ''}
                    </div>
                </div>
                <button class="btn-primary w-full" onclick="navigate('/meta');" style="margin-top: 20px;">
                    <i class="fas fa-layer-group"></i> Abrir Envío Masivo
                </button>
                <button class="btn-secondary w-full" onclick="launchMetaOnboarding()" style="margin-top:10px;">
                    Actualizar Configuración
                </button>
            `;
        } else {
            window.isMetaConnected = false;
            if (content && !content.querySelector('.fab.fa-meta')) {
                content.innerHTML = `
                    <div style="color: #0668E1; font-size: 4rem; margin-top: 40px; margin-bottom: 20px;">
                        <i class="fas fa-infinity"></i>
                    </div>
                    <div>
                        <h2 style="margin: 0; color: var(--text-main); font-size: 1.6rem; font-weight: 700;">Conexión Oficial</h2>
                        <div style="height: 3px; width: 50px; background: #0668E1; margin: 10px auto; border-radius: 10px;"></div>
                        <p style="color: var(--text-muted); font-size: 1rem; margin-top: 15px; line-height: 1.6;">
                            Conecta tu cuenta de <strong>WhatsApp Business</strong> oficial para habilitar funciones profesionales.
                        </p>
                    </div>
                    <div style="background: var(--bg-header); padding: 24px; border-radius: 20px; border: 1px solid var(--border); width: 100%; text-align: left;">
                        <h4 style="margin: 0 0 15px 0; color: #0668E1; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Beneficios activos:</h4>
                        <ul style="font-size: 0.9rem; padding-left: 20px; color: var(--text-main); line-height: 2.2;">
                            <li>Integración por <strong>Coexistencia</strong>.</li>
                            <li>Registro via <strong>Popup de Facebook</strong>.</li>
                            <li>Envío de <strong>Mensajes Masivos (HSM)</strong>.</li>
                            <li>Soporte para <strong>Imágenes y Audios</strong> oficiales.</li>
                        </ul>
                    </div>
                    <button class="btn-primary w-full" onclick="launchMetaOnboarding()" style="margin-top: 20px;">
                        <i class="fab fa-meta"></i> Vincular con Meta Cloud API
                    </button>
                `;
            }
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

window.openNewUserModal = async () => {
    const modal = document.getElementById('modal-users');
    if (modal) modal.classList.add('active');
    await window.loadGlobalTeam();
};

window.loadGlobalTeam = async () => {
    try {
        const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
        if (!activeToken) return;
        const res = await fetch(`/api/backoffice/users?token=${activeToken}`);
        const teamUsers = await res.json();

        const list = document.getElementById('team-list-container');
        if (list) {
            list.innerHTML = `
                <style>
                    .user-card-item { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; border-bottom: 1px solid var(--border); }
                    .user-card-item:last-child { border-bottom: none; }
                    .user-card-left { display: flex; align-items: center; justify-content: center; gap: 0.75rem; width: 100%; }
                    .user-card-avatar { display: none; }
                    .user-card-info { min-width: 0; text-align: center; }
                    .user-card-right { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.85rem; width: 100%; }
                    .user-card-csd { width: 100%; max-width: 280px; margin: 0 auto; }
                    .user-card-actions { display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; }

                    @media (min-width: 640px) and (max-width: 1023px) {
                        .user-card-item { flex-direction: column; gap: 1.25rem; padding: 1.25rem; }
                        .user-card-left { justify-content: flex-start; }
                        .user-card-avatar { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; background: var(--bg); border-radius: 50%; color: var(--accent); flex-shrink: 0; }
                        .user-card-info { text-align: left; }
                        .user-card-right { flex-direction: row; align-items: center; justify-content: space-between; width: 100%; }
                        .user-card-csd { margin: 0; flex: 1; max-width: 320px; }
                        .user-card-actions { width: auto; justify-content: flex-end; }
                    }

                    @media (min-width: 1024px) {
                        .user-card-item { flex-direction: row; align-items: center; justify-content: space-between; gap: 1.5rem; padding: 1rem 1.25rem; }
                        .user-card-left { width: auto; justify-content: flex-start; }
                        .user-card-avatar { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: var(--bg); border-radius: 50%; color: var(--accent); flex-shrink: 0; }
                        .user-card-info { text-align: left; }
                        .user-card-right { flex-direction: row; align-items: center; justify-content: flex-end; width: auto; gap: 1rem; }
                        .user-card-csd { margin: 0; width: auto; min-width: 200px; }
                        .user-card-actions { width: auto; justify-content: flex-end; }
                    }
                </style>
            ` + (teamUsers.map(u => `
                <div class="user-card-item">
                    <div class="user-card-left">
                        <div class="user-card-avatar">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="user-card-info">
                            <strong style="color:var(--text); font-size: 1.05rem; display: block; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${u.username}</strong>
                            <div style="font-size: 0.75rem; color: var(--text-dim);">${u.role === 'admin' ? 'Administrador' : 'Operador'}</div>
                        </div>
                    </div>
                    <div class="user-card-right">
                        <div class="csd-wrap csd-sm user-card-csd">
                            <select hidden onchange="window.updateUserRole('${u.id}', this.value)">
                                <option value="subuser" ${u.role === 'subuser' ? 'selected' : ''}>Vendedor / Operador (Limitado)</option>
                                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador (Total)</option>
                            </select>
                            <button class="csd-btn w-full" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label text-xs sm:text-sm truncate">${u.role === 'admin' ? 'Administrador (Total)' : 'Vendedor / Operador (Limitado)'}</span>
                                <i class="fas fa-chevron-down csd-chevron flex-shrink-0"></i>
                            </button>
                            <div class="csd-menu">
                                <button class="csd-item ${u.role === 'subuser' ? 'selected' : ''} text-xs sm:text-sm" type="button" data-val="subuser" onclick="_csdSelect(this,'subuser')">Vendedor / Operador (Limitado)</button>
                                <button class="csd-item ${u.role === 'admin' ? 'selected' : ''} text-xs sm:text-sm" type="button" data-val="admin" onclick="_csdSelect(this,'admin')">Administrador (Total)</button>
                            </div>
                        </div>
                        <div class="user-card-actions">
                            <button onclick="window.openEditUserModal('${u.id}', '${u.username}')" title="Editar Usuario" style="background: none; border: none; color: var(--accent); cursor: pointer; padding: 6px 14px; font-size: 16px; transition: opacity 0.2s;">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button onclick="window.deleteUser('${u.id}')" title="Eliminar Usuario" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 6px 14px; font-size: 16px; transition: opacity 0.2s;">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('') || '<div style="padding: 30px; text-align: center; color: var(--text-dim);">No hay usuarios registrados</div>');
        }

        if (typeof window.loadTeam === 'function') {
            window.loadTeam();
        }
    } catch (e) {
        console.error('Error al cargar equipo global:', e);
    }
};

window.saveNewUser = async () => {
    const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
    const usernameEl = document.getElementById('new-user-name');
    const passwordEl = document.getElementById('new-user-pass');
    const roleEl = document.getElementById('new-user-role');

    if (!usernameEl || !passwordEl || !roleEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value.trim();
    const role = roleEl.value;

    if (!username || !password) {
        if (typeof window.showToast === 'function') window.showToast('Completa usuario y contraseña', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/backoffice/users?token=${activeToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast('Usuario creado con éxito', 'success');
            usernameEl.value = '';
            passwordEl.value = '';
            await window.loadGlobalTeam();
        } else {
            if (typeof window.showToast === 'function') window.showToast('Error: ' + data.error, 'error');
        }
    } catch (e) {
        console.error(e);
        if (typeof window.showToast === 'function') window.showToast('Error de conexión', 'error');
    }
};

window.updateUserRole = async (id, role) => {
    const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
    try {
        const res = await fetch(`/api/backoffice/users/${id}?token=${activeToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role })
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast('Rol de usuario actualizado exitosamente', 'success');
            await window.loadGlobalTeam();
        } else {
            if (typeof window.showToast === 'function') window.showToast('Error: ' + data.error, 'error');
            await window.loadGlobalTeam();
        }
    } catch (e) {
        console.error(e);
        if (typeof window.showToast === 'function') window.showToast('Error de conexión', 'error');
    }
};

window.deleteUser = async (id) => {
    if (typeof Swal !== 'undefined') {
        const resSwal = await Swal.fire({
            title: '¿Eliminar usuario?',
            text: '¿Estás seguro de que deseas eliminar este usuario del equipo?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar'
        });
        if (!resSwal.isConfirmed) return;
    } else {
        if (!confirm('¿Estás seguro de que deseas eliminar este usuario?')) return;
    }

    const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
    try {
        const res = await fetch(`/api/backoffice/users/${id}?token=${activeToken}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast('Usuario eliminado con éxito', 'success');
            await window.loadGlobalTeam();
        } else {
            if (typeof window.showToast === 'function') window.showToast('Error: ' + data.error, 'error');
        }
    } catch (e) {
        console.error(e);
        if (typeof window.showToast === 'function') window.showToast('Error de conexión', 'error');
    }
};

window.openEditUserModal = (id, username) => {
    const modal = document.getElementById('edit-user-modal');
    const idInput = document.getElementById('edit-user-id');
    const usernameInput = document.getElementById('edit-user-username');
    const passwordInput = document.getElementById('edit-user-password');
    if (!modal || !idInput || !usernameInput || !passwordInput) return;

    idInput.value = id;
    usernameInput.value = username;
    passwordInput.value = '';
    modal.style.display = 'flex';
};

window.closeEditUserModal = () => {
    const modal = document.getElementById('edit-user-modal');
    if (modal) modal.style.display = 'none';
};

window.saveEditUser = async () => {
    const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
    const id = document.getElementById('edit-user-id')?.value;
    const usernameEl = document.getElementById('edit-user-username');
    const passwordEl = document.getElementById('edit-user-password');
    if (!id || !usernameEl || !passwordEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value.trim();

    if (!username) {
        if (typeof window.showToast === 'function') window.showToast('El nombre de usuario no puede estar vacío', 'warning');
        return;
    }

    const updates = { username };
    if (password) updates.password = password;

    try {
        const res = await fetch(`/api/backoffice/users/${id}?token=${activeToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const data = await res.json();
        if (data.success) {
            if (typeof window.showToast === 'function') window.showToast('Usuario actualizado exitosamente', 'success');
            window.closeEditUserModal();
            await window.loadGlobalTeam();
        } else {
            if (typeof window.showToast === 'function') window.showToast('Error: ' + data.error, 'error');
        }
    } catch (e) {
        console.error(e);
        if (typeof window.showToast === 'function') window.showToast('Error de conexión', 'error');
    }
};

