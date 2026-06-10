/* global showToast, navigate */
/* eslint-disable no-undef */
window.notificacionesView = (() => {
    let _token = '';
    let _isActive = false;

    // ── HTML ──────────────────────────────────────────────────────────────
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1>
                        <span style="position:relative; display:inline-flex; align-items:center; margin-right:6px;">
                            <i class="fas fa-bell kanban-header-icon" style="color:#25D366;"></i>
                        </span>
                        Notificaciones de Chats
                    </h1>
                    <p>Control de notificaciones de mensajes sin leer en el Backoffice</p>
                </div>
            </div>

            <div class="meta-view-body" style="padding: 20px;">
                <!-- Estado: inactivo (onboarding) -->
                <div id="notif-onboarding" style="display:none;">
                    <div class="meta-onboarding-wrap glass-card animate-fade" style="border-top: 4px solid #25D366; max-width: 500px; margin: 2rem auto; padding: 2rem; border-radius: 16px; background: var(--bg-card); box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2); border: 1px solid var(--border);">
                        <div style="font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%; position:relative; display:inline-block;">
                            <i class="fas fa-bell" style="color:#25D366;"></i>
                            <i class="fas fa-envelope-open-text" style="font-size:1.2rem; color:#128C7E; position:absolute; bottom:4px; right:calc(50% - 28px);"></i>
                        </div>
                        <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                            <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Notificaciones de Mensajes</h2>
                            <div style="height:3px; width:50px; background:linear-gradient(90deg,#25D366,#128C7E); border-radius:10px; margin:0 auto 12px;"></div>
                            <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.6; margin:0;">
                                Activa esta integración para visualizar el número de mensajes sin leer en cada chat y filtrar de manera rápida las conversaciones pendientes.
                            </p>
                        </div>
                        <div style="background:var(--bg-header); padding:1rem 1.25rem; border-radius:16px; border:1px solid var(--border); width:100%; margin-bottom:1.5rem;">
                            <h4 style="margin:0 0 8px; color:#25D366; font-size:0.78rem; text-transform:uppercase; letter-spacing:1.5px; font-weight:700;">Características clave</h4>
                            <ul style="font-size:0.88rem; color:var(--text-main); margin:0; display:flex; flex-direction:column; gap:8px; list-style:none; padding:0;">
                                <li style="display:flex; align-items:flex-start; gap:8px;">
                                    <i class="fas fa-check" style="color:#25D366; margin-top:2px; flex-shrink:0;"></i>
                                    <span><strong>Globos de chat:</strong> Muestra un contador en verde con la cantidad de mensajes sin leer de cada cliente.</span>
                                </li>
                                <li style="display:flex; align-items:flex-start; gap:8px;">
                                    <i class="fas fa-check" style="color:#25D366; margin-top:2px; flex-shrink:0;"></i>
                                    <span><strong>Totalizador en cabecera:</strong> Muestra la suma total de mensajes sin leer arriba de tu lista de chats.</span>
                                </li>
                                <li style="display:flex; align-items:flex-start; gap:8px;">
                                    <i class="fas fa-check" style="color:#25D366; margin-top:2px; flex-shrink:0;"></i>
                                    <span><strong>Filtro rápido:</strong> Agrega un interruptor sobre el buscador para ver únicamente chats con mensajes pendientes.</span>
                                </li>
                            </ul>
                        </div>
                        <button id="notif-activate-btn" class="btn-primary" onclick="notificacionesView._activar()" style="width:100%; padding:13px 20px; display:flex; align-items:center; justify-content:center; gap:10px; font-size:0.95rem; font-weight:600; border-radius:14px; background:linear-gradient(135deg,#25D366,#128C7E); color:white; border:none; cursor:pointer; transition: transform 0.2s, filter 0.2s;">
                            <i class="fas fa-power-off"></i> Activar Notificaciones
                        </button>
                    </div>
                </div>

                <!-- Estado: activo -->
                <div id="notif-active" style="display:none;">
                    <div class="meta-onboarding-wrap glass-card animate-fade" style="border-top: 4px solid #10b981; max-width: 500px; margin: 2rem auto; padding: 2rem; border-radius: 16px; background: var(--bg-card); box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2); border: 1px solid var(--border);">
                        <div style="font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%; position:relative; display:inline-block;">
                            <i class="fas fa-bell" style="color:#10b981;"></i>
                            <i class="fas fa-check-circle" style="font-size:1.2rem; color:#10b981; position:absolute; bottom:4px; right:calc(50% - 28px);"></i>
                        </div>
                        <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                            <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Integración Activa</h2>
                            <div style="height:3px; width:50px; background:#10b981; border-radius:10px; margin:0 auto 12px;"></div>
                            <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.6; margin:0;">
                                La integración de notificaciones está funcionando correctamente. Los mensajes sin leer de tus usuarios se mostrarán en la barra lateral del Backoffice en tiempo real.
                            </p>
                        </div>
                        <div style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.2); padding:1rem 1.25rem; border-radius:16px; width:100%; margin-bottom:1.5rem; display:flex; align-items:center; gap:12px;">
                            <i class="fas fa-info-circle" style="color:#10b981; font-size:1.2rem; flex-shrink:0;"></i>
                            <span style="font-size:0.88rem; color:var(--text-main);">Las notificaciones se reinician a 0 en cuanto entres a chatear con el contacto correspondiente.</span>
                        </div>
                        <button id="notif-deactivate-btn" onclick="notificacionesView._desactivar()" style="width:100%; padding:13px 20px; display:flex; align-items:center; justify-content:center; gap:10px; font-size:0.95rem; font-weight:600; border-radius:14px; background:transparent; border:1.5px solid var(--border); color:var(--text-muted); cursor:pointer; transition: background-color 0.2s;">
                            <i class="fas fa-power-off"></i> Desactivar Notificaciones
                        </button>
                    </div>
                </div>
            </div>
        </main>
        `;
    }

    // ── INITIALIZATION ────────────────────────────────────────────────────
    async function init(token) {
        _token = (typeof token === 'string' && token && token !== 'undefined') ? token : '';
        if (!_token) {
            _token = (typeof window.getAuthToken === 'function' ? decodeURIComponent(window.getAuthToken()) : '') || localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
        }
        if (_token === 'undefined') {
            _token = '';
        }
        _renderLoading();
        try {
            const res = await fetch(`/api/backoffice/notifications/status?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            _isActive = !!data.active;
            _render();
        } catch (e) {
            console.error('Error al iniciar vista de notificaciones:', e);
            showToast && showToast('Error al conectar con el servidor', 'error');
        }
    }

    function _renderLoading() {
        const wrap = document.querySelector('.meta-view-body');
        if (wrap) {
            wrap.innerHTML = `
                <div style="display:flex; justify-content:center; align-items:center; height:200px; color:var(--text-muted);">
                    <i class="fas fa-circle-notch fa-spin" style="font-size:2rem; margin-right:10px;"></i> Cargando...
                </div>
            `;
        }
    }

    function _render() {
        const wrap = document.querySelector('.meta-view-body');
        if (!wrap) return;

        // Volver a renderizar la estructura si se cargó la animación de carga
        wrap.innerHTML = `
            <!-- Estado: inactivo (onboarding) -->
            <div id="notif-onboarding" style="display:none;"></div>
            <!-- Estado: activo -->
            <div id="notif-active" style="display:none;"></div>
        `;

        const html = getHTML();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const onboardingSrc = doc.querySelector('#notif-onboarding').innerHTML;
        const activeSrc = doc.querySelector('#notif-active').innerHTML;

        const onboardingEl = document.getElementById('notif-onboarding');
        const activeEl = document.getElementById('notif-active');

        if (onboardingEl) {
            onboardingEl.innerHTML = onboardingSrc;
            onboardingEl.style.display = _isActive ? 'none' : 'block';
        }
        if (activeEl) {
            activeEl.innerHTML = activeSrc;
            activeEl.style.display = _isActive ? 'block' : 'none';
        }
    }

    // ── OPERATIONS ────────────────────────────────────────────────────────
    async function _activar() {
        const btn = document.getElementById('notif-activate-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Activando...';
        }
        try {
            const res = await fetch(`/api/backoffice/notifications/activate?token=${encodeURIComponent(_token)}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = true;
                _render();
                showToast && showToast('Notificaciones activadas', 'success');
                // Forzar reload de la barra de chats para reflejar que la integración está activa
                if (window.backofficeController && typeof window.backofficeController.loadNotificationsStatus === 'function') {
                    await window.backofficeController.loadNotificationsStatus();
                    window.backofficeController.refreshChatsList && window.backofficeController.refreshChatsList();
                }
            } else {
                showToast && showToast('Error al activar: ' + (data.error || ''), 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-power-off"></i> Activar Notificaciones';
                }
            }
        } catch (e) {
            showToast && showToast('Error de red al activar', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-power-off"></i> Activar Notificaciones';
            }
        }
    }

    async function _desactivar() {
        if (!confirm('¿Desactivar la integración de Notificaciones? Esto reseteará todos los mensajes sin leer a 0.')) return;

        const btn = document.getElementById('notif-deactivate-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Desactivando...';
        }
        try {
            const res = await fetch(`/api/backoffice/notifications/deactivate?token=${encodeURIComponent(_token)}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = false;
                _render();
                showToast && showToast('Notificaciones desactivadas', 'success');
                // Forzar reload de la barra de chats para reflejar que la integración está inactiva
                if (window.backofficeController && typeof window.backofficeController.loadNotificationsStatus === 'function') {
                    await window.backofficeController.loadNotificationsStatus();
                    window.backofficeController.refreshChatsList && window.backofficeController.refreshChatsList();
                }
            } else {
                showToast && showToast('Error al desactivar: ' + (data.error || ''), 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-power-off"></i> Desactivar Notificaciones';
                }
            }
        } catch (e) {
            showToast && showToast('Error de red al desactivar', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-power-off"></i> Desactivar Notificaciones';
            }
        }
    }

    function destroy() {
        // Nada que liberar por ahora
    }

    return {
        title: 'Notificaciones',
        getHTML,
        init,
        destroy,
        // Exponer handlers
        _activar,
        _desactivar
    };
})();
