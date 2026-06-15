/* global showToast */
/* eslint-disable no-undef */
window.reportesView = (() => {
    let _token = '';
    let _isActive = false;
    let _reportes = [];
    let _tipoFiltro = 'Todos';
    let _socket = null;

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
            if (_isActive) await _load();
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
                _renderState();
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
        _setTipo
    };
})();
