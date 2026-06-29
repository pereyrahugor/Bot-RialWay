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
                        <i class="fas fa-bell kanban-header-icon" style="color:#0099FF;"></i>
                        Notificaciones de Chats
                    </h1>
                    <p>Control de notificaciones de mensajes sin leer en el Backoffice</p>
                </div>
                <div id="notif-header-actions" style="display:flex; gap:10px; align-items:center;">
                    <span id="notif-status-label" style="font-size:0.88rem; font-weight:500; color:var(--text-muted);">Apagado</span>
                    <label class="switch flex-shrink-0">
                        <input type="checkbox" id="notif-toggle" onchange="notificacionesView._onToggle(this.checked)">
                        <span class="slider round">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
                        </span>
                    </label>
                </div>
            </div>

            <div class="meta-view-body">

                <!-- Estado: inactivo -->
                <div id="notif-onboarding" class="animate-fade" style="display:none; max-width:520px; width:100%; margin:20px auto 28px; padding:clamp(16px,4vw,28px); border-radius:1rem; background:var(--card-bg); border:1px solid var(--card-border-color);">

                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="position:relative; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px;">
                            <span style="width:56px; height:56px; border-radius:16px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); display:flex; align-items:center; justify-content:center; position:relative;">
                                <i class="fas fa-bell" style="font-size:1.4rem; color:#0099FF;"></i>
                                <i class="fas fa-envelope-open-text" style="font-size:0.6rem; color:#0078D4; position:absolute; bottom:8px; right:6px;"></i>
                            </span>
                        </div>
                        <h2 style="margin:0 0 6px; font-size:1.25rem; font-weight:700; color:var(--text-main);">Notificaciones de Mensajes</h2>
                        <div style="height:3px; width:40px; background:linear-gradient(90deg,#0099FF,#0078D4); border-radius:10px; margin:0 auto 10px;"></div>
                        <p style="margin:0; font-size:0.88rem; color:var(--text-muted); line-height:1.6; max-width:380px; margin-inline:auto;">
                            Activa esta integración para visualizar el número de mensajes sin leer en cada chat y filtrar de manera rápida las conversaciones pendientes.
                        </p>
                    </div>

                    <div style="height:1px; background:rgba(255,255,255,0.07); margin:0 0 18px;"></div>

                    <p style="margin:0 0 12px; font-size:0.72rem; text-transform:uppercase; letter-spacing:1.5px; font-weight:700; color:#0099FF;">Características clave</p>
                    <div style="display:flex; flex-direction:column; gap:14px;">
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(0,153,255,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-comment-dots" style="color:#0099FF; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Globos de chat</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Muestra un contador en verde con la cantidad de mensajes sin leer de cada cliente.</p>
                            </div>
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(0,153,255,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-layer-group" style="color:#0099FF; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Totalizador en cabecera</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Muestra la suma total de mensajes sin leer arriba de tu lista de chats.</p>
                            </div>
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(0,153,255,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-filter" style="color:#0099FF; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Filtro rápido</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Agrega un interruptor sobre el buscador para ver únicamente chats con mensajes pendientes.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Estado: activo -->
                <div id="notif-active" class="animate-fade" style="display:none; max-width:520px; width:100%; margin:20px auto 28px; padding:clamp(16px,4vw,28px); border-radius:1rem; background:var(--card-bg); border:1px solid var(--card-border-color);">

                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="position:relative; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px;">
                            <span style="width:56px; height:56px; border-radius:16px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); display:flex; align-items:center; justify-content:center; position:relative;">
                                <i class="fas fa-bell" style="font-size:1.4rem; color:#22c55e;"></i>
                                <i class="fas fa-check-circle" style="font-size:0.6rem; color:#22c55e; position:absolute; bottom:8px; right:6px;"></i>
                            </span>
                        </div>
                        <h2 style="margin:0 0 6px; font-size:1.25rem; font-weight:700; color:var(--text-main);">Integración Activa</h2>
                        <div style="height:3px; width:40px; background:#22c55e; border-radius:10px; margin:0 auto 10px;"></div>
                        <p style="margin:0; font-size:0.88rem; color:var(--text-muted); line-height:1.6; max-width:380px; margin-inline:auto;">
                            Las notificaciones están funcionando. Los mensajes sin leer se mostrarán en la barra lateral en tiempo real.
                        </p>
                    </div>

                    <div style="height:1px; background:rgba(255,255,255,0.07); margin:0 0 18px;"></div>

                    <div style="display:flex; align-items:flex-start; gap:12px;">
                        <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(34,197,94,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i class="fas fa-info-circle" style="color:#22c55e; font-size:0.85rem;"></i>
                        </span>
                        <div style="min-width:0;">
                            <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Las notificaciones se reinician a 0 en cuanto entres a chatear con el contacto correspondiente.</p>
                        </div>
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
        if (_token === 'undefined') _token = '';

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

    function _render() {
        const onboarding = document.getElementById('notif-onboarding');
        const active = document.getElementById('notif-active');
        const toggle = document.getElementById('notif-toggle');
        const statusLabel = document.getElementById('notif-status-label');

        if (_isActive) {
            if (onboarding) onboarding.style.display = 'none';
            if (active) active.style.display = 'block';
            if (toggle) toggle.checked = true;
            if (statusLabel) { statusLabel.textContent = 'Encendido'; statusLabel.style.color = '#22c55e'; }
        } else {
            if (onboarding) onboarding.style.display = 'block';
            if (active) active.style.display = 'none';
            if (toggle) toggle.checked = false;
            if (statusLabel) { statusLabel.textContent = 'Apagado'; statusLabel.style.color = 'var(--text-muted)'; }
        }
    }

    // ── TOGGLE ────────────────────────────────────────────────────────────
    async function _onToggle(checked) {
        if (checked) {
            _activar();
        } else {
            const confirmed = await window.swalConfirm('¿Desactivar Notificaciones?', '¿Desactivar las Notificaciones? Esto reseteará todos los mensajes sin leer a 0.');
            if (!confirmed) {
                const toggle = document.getElementById('notif-toggle');
                if (toggle) toggle.checked = true;
                return;
            }
            _desactivar();
        }
    }

    // ── OPERATIONS ────────────────────────────────────────────────────────
    async function _activar() {
        const toggle = document.getElementById('notif-toggle');
        if (toggle) toggle.disabled = true;
        try {
            const res = await fetch(`/api/backoffice/notifications/activate?token=${encodeURIComponent(_token)}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = true;
                _render();
                showToast && showToast('Notificaciones activadas', 'success');
                if (window.backofficeController && typeof window.backofficeController.loadNotificationsStatus === 'function') {
                    await window.backofficeController.loadNotificationsStatus();
                    window.backofficeController.refreshChatsList && window.backofficeController.refreshChatsList();
                }
            } else {
                showToast && showToast('Error al activar: ' + (data.error || ''), 'error');
                if (toggle) toggle.checked = false;
            }
        } catch (e) {
            showToast && showToast('Error de red al activar', 'error');
            if (toggle) toggle.checked = false;
        } finally {
            if (toggle) toggle.disabled = false;
        }
    }

    async function _desactivar() {
        try {
            const res = await fetch(`/api/backoffice/notifications/deactivate?token=${encodeURIComponent(_token)}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = false;
                _render();
                showToast && showToast('Notificaciones desactivadas', 'success');
                if (window.backofficeController && typeof window.backofficeController.loadNotificationsStatus === 'function') {
                    await window.backofficeController.loadNotificationsStatus();
                    window.backofficeController.refreshChatsList && window.backofficeController.refreshChatsList();
                }
            } else {
                showToast && showToast('Error al desactivar: ' + (data.error || ''), 'error');
                const toggle = document.getElementById('notif-toggle');
                if (toggle) toggle.checked = true;
            }
        } catch (e) {
            showToast && showToast('Error de red al desactivar', 'error');
            const toggle = document.getElementById('notif-toggle');
            if (toggle) toggle.checked = true;
        }
    }

    function destroy() {}

    return {
        title: 'Notificaciones',
        getHTML,
        init,
        destroy,
        _onToggle,
        _activar,
        _desactivar
    };
})();
