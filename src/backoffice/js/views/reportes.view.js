/* global showToast */
/* eslint-disable no-undef */
window.reportesView = (() => {
    let _token = '';
    let _isActive = false;
    let _reportes = [];
    let _tipoFiltro = 'Todos';
    let _socket = null;
    let _wabaGroups = [];
    let _wabaIntegrationActive = false;

    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1>
                        <i class="fas fa-file-lines kanban-header-icon" style="color:#0099FF;"></i>
                        Reportes
                    </h1>
                    <p>Reportes generados automaticamente por el asistente</p>
                </div>
                <div id="rep-header-actions" style="display:flex; gap:10px; align-items:center;">
                    <span id="rep-status-label" style="font-size:0.88rem; font-weight:500; color:var(--text-muted);">Apagado</span>
                    <label class="switch flex-shrink-0">
                        <input type="checkbox" id="rep-toggle" onchange="reportesView._onToggle(this.checked)">
                        <span class="slider round">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
                        </span>
                    </label>
                </div>
            </div>

            <div class="meta-view-body">

                <!-- Estado: inactivo -->
                <div id="rep-onboarding" class="meta-onboarding-wrap glass-card animate-fade" style="display:none;">

                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="position:relative; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px;">
                            <span style="width:56px; height:56px; border-radius:16px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); display:flex; align-items:center; justify-content:center;">
                                <i class="fas fa-file-lines" style="font-size:1.4rem; color:#0099FF;"></i>
                            </span>
                        </div>
                        <h2 style="margin:0 0 6px; font-size:1.25rem; font-weight:700; color:var(--text-main);">Reportes del Asistente</h2>
                        <div style="height:3px; width:40px; background:linear-gradient(90deg,#0099FF,#0078D4); border-radius:10px; margin:0 auto 10px;"></div>
                        <p style="margin:0; font-size:0.88rem; color:var(--text-muted); line-height:1.6; max-width:380px; margin-inline:auto;">
                            Activa esta funcion para que el asistente genere reportes automaticos sobre cada conversacion y nuevo lead detectado.
                        </p>
                    </div>

                    <div style="height:1px; background:var(--border); margin:0 0 18px;"></div>

                    <p style="margin:0 0 12px; font-size:0.72rem; text-transform:uppercase; letter-spacing:1.5px; font-weight:700; color:#0099FF;">Que incluyen los reportes</p>
                    <div style="display:flex; flex-direction:column; gap:14px; width:100%; text-align:left;">
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(34,197,94,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-user-plus" style="color:#22c55e; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Nuevos Leads</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Cuando el bot detecta un potencial cliente, genera un resumen automatico del contacto y su interes.</p>
                            </div>
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(0,153,255,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-align-left" style="color:#0099FF; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Resumenes de conversacion</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Al cierre de cada chat, el asistente genera un resumen con los puntos clave tratados.</p>
                            </div>
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(139,92,246,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-bolt" style="color:#8b5cf6; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Tiempo real</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Los reportes aparecen automaticamente en cuanto el bot los genera, sin necesidad de recargar.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Estado: activo -->
                <div id="rep-active" style="display:none;">

                    <!-- Integración Grupos Virtuales (Meta/WABA) -->
                    <div class="glass-card animate-fade" style="margin-bottom: 20px; padding: 20px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
                            <div>
                                <h3 style="margin:0 0 4px; font-size:1.05rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                                    <i class="fas fa-users" style="color:#0099FF;"></i>
                                    Grupos de Reporte vía Meta WABA
                                </h3>
                                <p style="margin:0; font-size:0.8rem; color:var(--text-muted);">
                                    Envía reportes en paralelo de manera individual a grupos virtuales de hasta 8 contactos mediante la API oficial.
                                </p>
                            </div>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span id="waba-group-status-label" style="font-size:0.8rem; font-weight:500; color:var(--text-muted);">Desactivado</span>
                                <label class="switch flex-shrink-0" style="transform: scale(0.9);">
                                    <input type="checkbox" id="waba-group-toggle" onchange="reportesView._onWabaToggle(this.checked)">
                                    <span class="slider round">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
                                    </span>
                                </label>
                            </div>
                        </div>

                        <!-- Panel de Grupos (visible cuando activado) -->
                        <div id="waba-groups-panel" style="display:none; border-top: 1px solid rgba(255,255,255,0.06); padding-top:15px; margin-top:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                                <span style="font-size:0.82rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px;">Mis Grupos Virtuales</span>
                                <button onclick="reportesView._openGroupModal()" class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 8px; cursor:pointer;">
                                    <i class="fas fa-plus" style="margin-right:4px;"></i> Crear Grupo
                                </button>
                            </div>
                            <div id="waba-groups-list">
                                <div style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
                                    <i class="fas fa-circle-notch fa-spin" style="margin-right: 6px;"></i> Cargando grupos...
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap;">
                        <div style="position:relative; flex:1; min-width:180px;">
                            <i class="fas fa-search" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:0.82rem; pointer-events:none;"></i>
                            <input id="rep-search" type="text" placeholder="Buscar por contacto o descripcion..."
                                oninput="reportesView._render()"
                                style="width:100%; box-sizing:border-box; padding:10px 14px 10px 38px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                        </div>
                        <div id="rep-tipo-filters" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
                        <button onclick="reportesView._load()" id="rep-refresh-btn"
                            style="background:transparent; border:1px solid var(--border); color:var(--text-muted); cursor:pointer; padding:9px 14px; border-radius:10px; font-size:0.85rem; transition:all 0.15s; flex-shrink:0;"
                            onmouseenter="this.style.borderColor='rgba(0,153,255,0.4)'; this.style.color='var(--text-main)'"
                            onmouseleave="this.style.borderColor='var(--border)'; this.style.color='var(--text-muted)'">
                            <i class="fas fa-rotate-right"></i>
                        </button>
                    </div>

                    <div id="rep-count" style="font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;"></div>

                    <div id="rep-list" class="animate-fade">
                        <div style="display:flex; align-items:center; justify-content:center; padding:60px 24px; color:var(--text-muted);">
                            <i class="fas fa-circle-notch fa-spin" style="margin-right:10px;"></i> Cargando reportes...
                        </div>
                    </div>

                </div>

            </div>
        </main>

        <!-- Modal para Crear/Editar Grupo Virtual -->
        <div id="waba-group-modal" class="modal-overlay">
            <div class="modal-content modal-content-md animate-pop-in">
                <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:12px;">
                    <h3 id="waba-group-modal-title" style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-users" style="color:#0099FF;"></i>
                        Nuevo Grupo Virtual
                    </h3>
                    <button class="btn-close-modal" onclick="reportesView._closeGroupModal()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <label style="display:block; font-size:0.82rem; font-weight:600; color:var(--text-main); margin-bottom:6px;">Nombre del Grupo</label>
                        <input type="text" id="waba-group-name" placeholder="Ej: Equipo Ventas" 
                            style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                            onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                    </div>
                    
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--text-main);">Contactos (Máx 8)</label>
                            <button type="button" onclick="reportesView._addGroupContactRow()" id="waba-group-add-contact-btn" 
                                style="background:transparent; border:none; color:#0099FF; cursor:pointer; font-size:0.8rem; font-weight:600; display:flex; align-items:center; gap:4px;">
                                <i class="fas fa-plus-circle"></i> Agregar Contacto
                            </button>
                        </div>
                        <div id="waba-group-contacts-container" style="display:flex; flex-direction:column; gap:8px; max-height: 240px; overflow-y: auto; padding-right:4px;">
                            <!-- Contact rows will be added dynamically -->
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid rgba(255,255,255,0.06); padding-top:15px;">
                    <button onclick="reportesView._closeGroupModal()" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; background:transparent; border:1px solid var(--border); color:var(--text-muted); cursor:pointer; transition:all 0.15s;"
                        onmouseenter="this.style.borderColor='var(--text-main)'; this.style.color='var(--text-main)'"
                        onmouseleave="this.style.borderColor='var(--border)'; this.style.color='var(--text-muted)'">
                        Cancelar
                    </button>
                    <button onclick="reportesView._saveGroup()" id="waba-group-save-btn" style="padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; background:#0099FF; color:white; border:none; cursor:pointer; font-weight:600; transition:all 0.15s;"
                        onmouseenter="this.style.background='#0078D4'"
                        onmouseleave="this.style.background='#0099FF'">
                        Guardar Grupo
                    </button>
                </div>
            </div>
        </div>
        `;
    }

    async function init(token) {
        _token = (typeof token === 'string' && token && token !== 'undefined') ? token : '';
        if (!_token) {
            _token = (typeof window.getAuthToken === 'function' ? decodeURIComponent(window.getAuthToken()) : '')
                || localStorage.getItem('backoffice_token')
                || localStorage.getItem('system_config_token')
                || '';
        }
        if (_token === 'undefined') _token = '';

        try {
            const res = await fetch(`/api/backoffice/reportes/status?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            _isActive = !!data.active;
            _renderState();
            if (_isActive) {
                await _load();
                await _loadWabaStatus();
            }
        } catch (e) {
            console.error('[Reportes] Error al iniciar:', e);
            showToast && showToast('Error al conectar con el servidor', 'error');
        }

        _subscribeRealtime();
    }

    function _renderState() {
        const onboarding = document.getElementById('rep-onboarding');
        const active = document.getElementById('rep-active');
        const toggle = document.getElementById('rep-toggle');
        const statusLabel = document.getElementById('rep-status-label');

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

    function _onToggle(checked) {
        if (checked) {
            _activar();
        } else {
            const confirmed = confirm('¿Desactivar los Reportes? El asistente dejara de generar reportes nuevos.');
            if (!confirmed) {
                const toggle = document.getElementById('rep-toggle');
                if (toggle) toggle.checked = true;
                return;
            }
            _desactivar();
        }
    }

    async function _activar() {
        const toggle = document.getElementById('rep-toggle');
        if (toggle) toggle.disabled = true;
        try {
            const res = await fetch(`/api/backoffice/reportes/activate?token=${encodeURIComponent(_token)}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = true;
                _renderState();
                await _load();
                await _loadWabaStatus();
                showToast && showToast('Reportes activados', 'success');
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
            const res = await fetch(`/api/backoffice/reportes/deactivate?token=${encodeURIComponent(_token)}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = false;
                _reportes = [];
                _wabaGroups = [];
                _wabaIntegrationActive = false;
                _renderState();
                _renderWabaState();
                showToast && showToast('Reportes desactivados', 'success');
            } else {
                showToast && showToast('Error al desactivar: ' + (data.error || ''), 'error');
                const toggle = document.getElementById('rep-toggle');
                if (toggle) toggle.checked = true;
            }
        } catch (e) {
            showToast && showToast('Error de red al desactivar', 'error');
            const toggle = document.getElementById('rep-toggle');
            if (toggle) toggle.checked = true;
        }
    }

    async function _loadWabaStatus() {
        try {
            const res = await fetch(`/api/backoffice/waba-groups/status?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            _wabaIntegrationActive = !!data.active;
            _renderWabaState();
            if (_wabaIntegrationActive) {
                await _loadWabaGroups();
            }
        } catch (e) {
            console.error('[Reportes] Error loading WABA status:', e);
        }
    }

    function _renderWabaState() {
        const toggle = document.getElementById('waba-group-toggle');
        const statusLabel = document.getElementById('waba-group-status-label');
        const panel = document.getElementById('waba-groups-panel');

        if (toggle) toggle.checked = _wabaIntegrationActive;
        if (statusLabel) {
            if (_wabaIntegrationActive) {
                statusLabel.textContent = 'Activo';
                statusLabel.style.color = '#22c55e';
            } else {
                statusLabel.textContent = 'Desactivado';
                statusLabel.style.color = 'var(--text-muted)';
            }
        }
        if (panel) {
            panel.style.display = _wabaIntegrationActive ? 'block' : 'none';
        }
    }

    async function _onWabaToggle(checked) {
        try {
            const res = await fetch(`/api/backoffice/waba-groups/status?token=${encodeURIComponent(_token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: checked })
            });
            const data = await res.json();
            if (data.success) {
                _wabaIntegrationActive = checked;
                _renderWabaState();
                if (_wabaIntegrationActive) {
                    await _loadWabaGroups();
                }
                showToast && showToast(checked ? 'Integración WABA activada' : 'Integración WABA desactivada', 'success');
            } else {
                showToast && showToast('Error al cambiar estado: ' + (data.error || ''), 'error');
                const toggle = document.getElementById('waba-group-toggle');
                if (toggle) toggle.checked = !_wabaIntegrationActive;
            }
        } catch (e) {
            showToast && showToast('Error de red al cambiar estado WABA', 'error');
            const toggle = document.getElementById('waba-group-toggle');
            if (toggle) toggle.checked = !_wabaIntegrationActive;
        }
    }

    async function _loadWabaGroups() {
        const container = document.getElementById('waba-groups-list');
        if (container) {
            container.innerHTML = `<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:0.82rem;"><i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i> Cargando grupos virtuales...</div>`;
        }
        try {
            const res = await fetch(`/api/backoffice/waba-groups?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            if (data.success) {
                _wabaGroups = data.groups || [];
                _renderWabaGroups();
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        } catch (e) {
            if (container) {
                container.innerHTML = `<div style="padding:15px; text-align:center; color:#ef4444; font-size:0.82rem;"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i> Error cargando grupos: ${e.message}</div>`;
            }
        }
    }

    function _renderWabaGroups() {
        const container = document.getElementById('waba-groups-list');
        if (!container) return;

        if (_wabaGroups.length === 0) {
            container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.85rem;"><i class="fas fa-users-slash" style="margin-bottom:8px; font-size:1.5rem; display:block; opacity:0.6;"></i> No tienes grupos virtuales creados todavía.</div>`;
            return;
        }

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                ${_wabaGroups.map(g => {
                    const contactsList = (g.contacts || []).map(c => `${_escHtml(c.name || 'Sin nombre')} (${_escHtml(c.phone)})`).join(', ');
                    return `
                    <div class="waba-group-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:10px; gap:15px;">
                        <div style="min-width:0; flex:1;">
                            <div style="font-weight:600; font-size:0.88rem; color:var(--text-main); margin-bottom:3px; display:flex; align-items:center;">
                                ${_escHtml(g.name)}
                                <span style="font-size:0.75rem; font-weight:500; color:#0099FF; background:rgba(0,153,255,0.08); padding:1px 6px; border-radius:10px; margin-left:6px;">
                                    ${(g.contacts || []).length} contactos
                                </span>
                            </div>
                            <div style="font-size:0.78rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${contactsList || 'Sin contactos'}
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; flex-shrink:0;">
                            <button onclick="reportesView._openGroupModal('${g.id}')" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:6px 8px; border-radius:6px; font-size:0.82rem; transition:all 0.15s;"
                                onmouseenter="this.style.color='#0099FF'; this.style.background='rgba(0,153,255,0.08)'"
                                onmouseleave="this.style.color='var(--text-muted)'; this.style.background='transparent'">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="reportesView._deleteGroup('${g.id}')" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:6px 8px; border-radius:6px; font-size:0.82rem; transition:all 0.15s;"
                                onmouseenter="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.08)'"
                                onmouseleave="this.style.color='var(--text-muted)'; this.style.background='transparent'">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    async function _deleteGroup(groupId) {
        if (!confirm('¿Estás seguro de que deseas eliminar este grupo virtual?')) return;
        try {
            const res = await fetch(`/api/backoffice/waba-groups/${groupId}?token=${encodeURIComponent(_token)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                showToast && showToast('Grupo eliminado correctamente', 'success');
                await _loadWabaGroups();
            } else {
                showToast && showToast('Error al eliminar: ' + (data.error || ''), 'error');
            }
        } catch (e) {
            showToast && showToast('Error de red al eliminar el grupo', 'error');
        }
    }

    let _editingGroupId = null;

    function _openGroupModal(groupId = null) {
        const modal = document.getElementById('waba-group-modal');
        const title = document.getElementById('waba-group-modal-title');
        const nameInput = document.getElementById('waba-group-name');
        const container = document.getElementById('waba-group-contacts-container');
        
        _editingGroupId = groupId;
        if (container) container.innerHTML = '';
        if (nameInput) nameInput.value = '';
        
        if (groupId) {
            if (title) title.innerHTML = '<i class="fas fa-edit modal-h3-icon" style="color:#0099FF; margin-right:6px;"></i> Editar Grupo Virtual';
            const group = _wabaGroups.find(g => g.id === groupId);
            if (group) {
                if (nameInput) nameInput.value = group.name || '';
                const contacts = group.contacts || [];
                contacts.forEach(c => _addContactRowHTML(c.name, c.phone));
            }
        } else {
            if (title) title.innerHTML = '<i class="fas fa-users modal-h3-icon" style="color:#0099FF; margin-right:6px;"></i> Nuevo Grupo Virtual';
            _addContactRowHTML('', '');
        }
        
        _updateAddContactButtonState();
        if (modal) modal.classList.add('active');
    }

    function _closeGroupModal() {
        const modal = document.getElementById('waba-group-modal');
        if (modal) modal.classList.remove('active');
        _editingGroupId = null;
    }

    function _addContactRowHTML(name = '', phone = '') {
        const container = document.getElementById('waba-group-contacts-container');
        if (!container) return;
        
        const row = document.createElement('div');
        row.className = 'waba-contact-row';
        row.style = 'display:flex; gap:8px; align-items:center; width:100%;';
        row.innerHTML = `
            <input type="text" placeholder="Nombre (ej: Pedro)" value="${_escAttr(name)}" class="waba-contact-name-input"
                style="flex:1; padding:8px 10px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--border); color:var(--text-main); font-size:0.82rem; outline:none; transition:border-color 0.2s;"
                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
            <input type="text" placeholder="Teléfono (ej: 54911...)" value="${_escAttr(phone)}" class="waba-contact-phone-input"
                style="flex:1.2; padding:8px 10px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--border); color:var(--text-main); font-size:0.82rem; outline:none; transition:border-color 0.2s;"
                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
            <button type="button" onclick="this.parentElement.remove(); reportesView._updateAddContactButtonState();" 
                style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:6px; border-radius:6px; display:flex; align-items:center; justify-content:center;"
                onmouseenter="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.07)'"
                onmouseleave="this.style.color='var(--text-muted)'; this.style.background='transparent'">
                <i class="fas fa-trash-alt" style="font-size:0.85rem;"></i>
            </button>
        `;
        container.appendChild(row);
        _updateAddContactButtonState();
    }

    function _addGroupContactRow() {
        const container = document.getElementById('waba-group-contacts-container');
        if (container && container.children.length < 8) {
            _addContactRowHTML('', '');
        }
    }

    function _updateAddContactButtonState() {
        const container = document.getElementById('waba-group-contacts-container');
        const btn = document.getElementById('waba-group-add-contact-btn');
        if (!container || !btn) return;
        
        const count = container.children.length;
        if (count >= 8) {
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
        } else {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
    }

    async function _saveGroup() {
        const nameInput = document.getElementById('waba-group-name');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            if (nameInput) nameInput.style.borderColor = '#ef4444';
            showToast && showToast('El nombre del grupo es requerido', 'error');
            return;
        }

        const container = document.getElementById('waba-group-contacts-container');
        if (!container || container.children.length === 0) {
            showToast && showToast('Agrega al menos un contacto al grupo', 'error');
            return;
        }

        const contacts = [];
        let hasErrors = false;
        
        const rows = container.querySelectorAll('.waba-contact-row');
        rows.forEach(row => {
            const nameIn = row.querySelector('.waba-contact-name-input');
            const phoneIn = row.querySelector('.waba-contact-phone-input');
            
            const contactName = nameIn ? nameIn.value.trim() : '';
            const contactPhone = phoneIn ? phoneIn.value.trim().replace(/[^0-9]/g, '') : '';
            
            if (!contactPhone) {
                if (phoneIn) phoneIn.style.borderColor = '#ef4444';
                hasErrors = true;
            } else {
                if (phoneIn) phoneIn.style.borderColor = 'var(--border)';
                contacts.push({ name: contactName || contactPhone, phone: contactPhone });
            }
        });

        if (hasErrors) {
            showToast && showToast('Por favor, ingresa los números de teléfono', 'error');
            return;
        }

        const saveBtn = document.getElementById('waba-group-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';
        }

        try {
            const body = {
                name,
                contacts
            };
            if (_editingGroupId) {
                body.id = _editingGroupId;
            }

            const res = await fetch(`/api/backoffice/waba-groups?token=${encodeURIComponent(_token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            
            if (data.success) {
                showToast && showToast(_editingGroupId ? 'Grupo actualizado con éxito' : 'Grupo creado con éxito', 'success');
                _closeGroupModal();
                await _loadWabaGroups();
            } else {
                showToast && showToast('Error al guardar: ' + (data.error || ''), 'error');
            }
        } catch (e) {
            showToast && showToast('Error de red al guardar el grupo', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = 'Guardar Grupo';
            }
        }
    }

    function _escAttr(str) {
        return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    async function _load() {
        const btn = document.getElementById('rep-refresh-btn');
        if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

        try {
            const res = await fetch(`/api/backoffice/reportes?token=${encodeURIComponent(_token)}&limit=200`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Error desconocido');
            _reportes = data.reportes || [];
            _buildTipoFilters();
            _render();
        } catch (e) {
            const list = document.getElementById('rep-list');
            if (list) list.innerHTML = `<div style="padding:48px 24px; text-align:center; color:#ef4444;"><i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i> Error cargando reportes: ${e.message}</div>`;
        } finally {
            if (btn) btn.innerHTML = '<i class="fas fa-rotate-right"></i>';
        }
    }

    function _buildTipoFilters() {
        const container = document.getElementById('rep-tipo-filters');
        if (!container) return;
        const tipos = ['Todos', ...new Set(_reportes.map(r => r.tipo || 'Sin tipo'))];
        if (!tipos.includes(_tipoFiltro)) _tipoFiltro = 'Todos';
        container.innerHTML = tipos.map(t => {
            const active = t === _tipoFiltro;
            return `<button onclick="reportesView._setTipo('${t.replace(/'/g, "\\'")}'); reportesView._render()"
                style="padding:5px 12px; border-radius:20px; font-size:0.75rem; font-weight:600; cursor:pointer; transition:all 0.15s; border:1px solid ${active ? '#0099FF' : 'var(--border)'}; background:${active ? 'rgba(0,153,255,0.12)' : 'transparent'}; color:${active ? '#0099FF' : 'var(--text-muted)'};">
                ${t}
            </button>`;
        }).join('');
    }

    function _setTipo(tipo) {
        _tipoFiltro = tipo;
        _buildTipoFilters();
    }

    function _render() {
        const list = document.getElementById('rep-list');
        const countEl = document.getElementById('rep-count');
        if (!list) return;

        const search = (document.getElementById('rep-search')?.value || '').toLowerCase();
        const filtered = _reportes.filter(r => {
            if (_tipoFiltro !== 'Todos' && (r.tipo || 'Sin tipo') !== _tipoFiltro) return false;
            if (!search) return true;
            return (r.nombre || r.chat_id || '').toLowerCase().includes(search)
                || (r.descripcion || '').toLowerCase().includes(search)
                || (r.chat_id || '').toLowerCase().includes(search);
        });

        if (countEl) countEl.textContent = `${filtered.length} reporte${filtered.length !== 1 ? 's' : ''}`;

        if (filtered.length === 0) {
            list.innerHTML = `
                <div style="padding:60px 24px; text-align:center;">
                    <i class="fas fa-file-circle-xmark" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
                    <p style="color:var(--text-muted); margin:0;">No hay reportes${search || _tipoFiltro !== 'Todos' ? ' que coincidan con el filtro' : ' todavia'}.</p>
                </div>`;
            return;
        }

        list.innerHTML = `<div class="glass-card" style="overflow:hidden;">
            ${filtered.map((r, i) => _renderItem(r, i, filtered.length)).join('')}
        </div>`;
    }

    function _renderItem(r, i, total) {
        const displayName = r.nombre || r.chat_id || 'Desconocido';
        const tipo = r.tipo || 'Sin tipo';
        const tipoColor = _tipoColor(tipo);
        const date = _formatDate(r.created_at);
        const desc = _escHtml(r.descripcion || '-');
        const initial = (displayName[0] || '?').toUpperCase();
        const isLast = i === total - 1;

        return `
        <div style="padding:16px 18px; ${isLast ? '' : 'border-bottom:1px solid var(--border);'}">
            <div style="display:flex; align-items:flex-start; gap:12px;">
                <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg,#0099FF,#0078D4); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:0.88rem; flex-shrink:0;">
                    ${initial}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
                        <span style="font-weight:600; font-size:0.88rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${_escHtml(displayName)}</span>
                        <span style="padding:2px 9px; border-radius:20px; font-size:0.7rem; font-weight:700; background:${tipoColor.bg}; color:${tipoColor.text}; white-space:nowrap;">${_escHtml(tipo)}</span>
                        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:auto; white-space:nowrap;">${date}</span>
                    </div>
                    <p style="margin:0; font-size:0.83rem; color:var(--text-muted); line-height:1.6; white-space:pre-wrap; word-break:break-word;">${desc}</p>
                    ${r.chat_id && r.nombre ? `<div style="margin-top:5px; font-size:0.72rem; color:var(--text-muted); opacity:0.6;">${_escHtml(r.chat_id)}</div>` : ''}
                </div>
            </div>
        </div>`;
    }

    function _tipoColor(tipo) {
        const t = (tipo || '').toLowerCase();
        if (t.includes('lead') || t.includes('nuevo')) return { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' };
        if (t.includes('resumen') || t.includes('summary')) return { bg: 'rgba(0,153,255,0.12)', text: '#0099FF' };
        if (t.includes('error') || t.includes('fallo')) return { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' };
        if (t.includes('alerta') || t.includes('warn')) return { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' };
        return { bg: 'rgba(139,92,246,0.12)', text: '#8b5cf6' };
    }

    function _subscribeRealtime() {
        try {
            _socket = (typeof io !== 'undefined' ? io : window.io)();
            _socket.on('reporte_created', () => {
                if (_isActive) _load();
            });
        } catch (e) { /* socket no disponible */ }
    }

    function _formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    }

    function _escHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function destroy() {
        if (_socket) {
            _socket.off('reporte_created');
            _socket = null;
        }
    }

    return {
        title: 'Reportes - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy,
        _onToggle,
        _load,
        _render,
        _setTipo,
        _onWabaToggle,
        _openGroupModal,
        _closeGroupModal,
        _addGroupContactRow,
        _updateAddContactButtonState,
        _saveGroup,
        _deleteGroup
    };
})();
