/* global showToast, navigate */
/* eslint-disable no-undef */
window.listaNegraView = (() => {
    let _token = '';
    let _isActive = false;
    let _entries = [];

    // ── HTML ──────────────────────────────────────────────────────────────
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1>
                        <i class="fas fa-ban kanban-header-icon" style="color:#0099FF;"></i>
                        Lista BOT/CRM Desactivado
                    </h1>
                    <p>Control de contactos excluidos del bot o del CRM</p>
                </div>
                <div id="ln-header-actions" style="display:flex; gap:10px; align-items:center;">
                    <span id="ln-status-label" style="font-size:0.88rem; font-weight:500; color:var(--text-muted);">Apagado</span>
                    <label class="switch flex-shrink-0">
                        <input type="checkbox" id="ln-toggle" onchange="listaNegraView._onToggle(this.checked)">
                        <span class="slider round">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
                        </span>
                    </label>
                </div>
            </div>

            <div class="meta-view-body">

                <!-- Explicacion (visible cuando inactivo) -->
                <div id="ln-info" class="animate-fade" style="max-width:520px; width:100%; margin:20px auto 28px; padding:clamp(16px,4vw,28px); border-radius:1rem; background:var(--card-bg); border:1px solid var(--card-border-color);">

                    <!-- Icono + titulo -->
                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="position:relative; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px;">
                            <span style="width:56px; height:56px; border-radius:16px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); display:flex; align-items:center; justify-content:center; position:relative;">
                                <i class="fas fa-ban" style="font-size:1.4rem; color:#0099FF;"></i>
                            </span>
                        </div>
                        <h2 style="margin:0 0 6px; font-size:1.25rem; font-weight:700; color:var(--text-main);">Lista BOT/CRM Desactivado</h2>
                        <div style="height:3px; width:40px; background:linear-gradient(90deg,#0099FF,#0078D4); border-radius:10px; margin:0 auto 10px;"></div>
                        <p style="margin:0; font-size:0.88rem; color:var(--text-muted); line-height:1.6; max-width:380px; margin-inline:auto;">
                            Gestioná qué contactos no reciben atención automática del bot o quedan excluidos de los chats del CRM.
                        </p>
                    </div>

                    <!-- Separador -->
                    <div style="height:1px; background:rgba(255,255,255,0.07); margin:0 0 18px;"></div>

                    <!-- Como funciona -->
                    <p style="margin:0 0 12px; font-size:0.72rem; text-transform:uppercase; letter-spacing:1.5px; font-weight:700; color:#0099FF;">¿Cómo funciona?</p>
                    <div style="display:flex; flex-direction:column; gap:14px;">
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(37,211,102,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-robot" style="color:#25D366; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Sin Bot</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">El chat sigue visible en el CRM pero el bot nunca retoma el control. Permanece en atención humana.</p>
                            </div>
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(239,68,68,0.1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-eye-slash" style="color:#ef4444; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">Bloqueado CRM</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Además de lo anterior, el contacto queda completamente oculto en el backoffice.</p>
                            </div>
                        </div>
                        <div style="display:flex; align-items:flex-start; gap:12px;">
                            <span style="min-width:32px; height:32px; border-radius:8px; background:rgba(18,140,126,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                <i class="fas fa-toggle-on" style="color:#128C7E; font-size:0.85rem;"></i>
                            </span>
                            <div style="min-width:0;">
                                <p style="margin:0 0 3px; font-weight:600; font-size:0.85rem; color:var(--text-main);">¿Cómo agregar?</p>
                                <p style="margin:0; font-size:0.82rem; color:var(--text-muted); line-height:1.6;">Abrí un chat en el backoffice y usá el ícono <i class="fas fa-ban" style="color:var(--text-muted);"></i> del encabezado para agregar o quitar ese contacto.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Estado: activo (grilla) -->
                <div id="ln-active" style="display:none;">

                    <!-- Search -->
                    <div style="position:relative; margin-bottom:14px;">
                        <i class="fas fa-search" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-muted); font-size:0.82rem; pointer-events:none;"></i>
                        <input id="ln-search" type="text" placeholder="Buscar contacto..."
                            oninput="listaNegraView._renderTable()"
                            style="width:100%; box-sizing:border-box; padding:10px 14px 10px 38px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                            onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                    </div>

                    <!-- List container -->
                    <div style="overflow:hidden; border-radius:1rem; background:var(--card-bg); border:1px solid var(--card-border-color);">
                        <div id="ln-tbody" class="animate-fade">
                            <div style="padding:32px; text-align:center; color:var(--text-muted);">
                                <i class="fas fa-circle-notch fa-spin"></i> Cargando...
                            </div>
                        </div>
                        <div id="ln-empty" style="display:none; padding:48px 24px; text-align:center;">
                            <i class="fas fa-list-check" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
                            <p style="color:var(--text-muted); margin:0;">No hay contactos en la lista.</p>
                            <p style="color:var(--text-muted); font-size:0.82rem; margin:6px 0 0;">
                                Abrí un chat y usá el ícono <i class="fas fa-ban" style="color:var(--text-muted);"></i> del encabezado para agregar un contacto.
                            </p>
                        </div>
                    </div>

                </div>

            </div>
        </main>
        `;
    }


    // ── INIT ──────────────────────────────────────────────────────────────
    async function init() {
        _token = localStorage.getItem('backoffice_token') || '';
        await _loadStatus();
    }

    async function _loadStatus() {
        try {
            const res = await fetch(`/api/backoffice/blacklist/status?token=${_token}`);
            const data = await res.json();
            _isActive = !!data.active;
            _render();
            if (_isActive) await _loadEntries();
        } catch (e) {
            console.error('[ListaNegra] Error loading status:', e);
        }
    }

    function _render() {
        const active = document.getElementById('ln-active');
        const info = document.getElementById('ln-info');
        const toggle = document.getElementById('ln-toggle');
        const statusLabel = document.getElementById('ln-status-label');

        if (_isActive) {
            if (active) active.style.display = 'block';
            if (info) info.style.display = 'none';
            if (toggle) toggle.checked = true;
            if (statusLabel) { statusLabel.textContent = 'Encendido'; statusLabel.style.color = '#22c55e'; }
        } else {
            if (active) active.style.display = 'none';
            if (info) info.style.display = 'block';
            if (toggle) toggle.checked = false;
            if (statusLabel) { statusLabel.textContent = 'Apagado'; statusLabel.style.color = 'var(--text-muted)'; }
        }
    }

    async function _loadEntries() {
        try {
            const res = await fetch(`/api/backoffice/blacklist?token=${_token}`);
            _entries = await res.json();
            _renderTable();
        } catch (e) {
            console.error('[ListaNegra] Error loading entries:', e);
        }
    }

    function _renderTable() {
        const tbody = document.getElementById('ln-tbody');
        const emptyEl = document.getElementById('ln-empty');
        if (!tbody) return;

        const search = (document.getElementById('ln-search')?.value || '').toLowerCase();
        const filtered = _entries.filter(e =>
            !search ||
            (e.name || '').toLowerCase().includes(search) ||
            (e.chat_id || '').toLowerCase().includes(search)
        );

        if (emptyEl) emptyEl.style.display = filtered.length === 0 ? 'block' : 'none';

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            return;
        }

        const svgX = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`;
        const svgCheck = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>`;

        tbody.innerHTML = filtered.map((entry, i) => {
            const displayName = entry.name || entry.chat_id;
            const idSinBot = `ln-sinbot-${i}`;
            const idBloq = `ln-bloq-${i}`;

            return `
            <div style="padding:14px 16px; border-bottom:1px solid rgba(255,255,255,0.06);">

                <!-- Línea 1: avatar + nombre + delete -->
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#0099FF,#0078D4); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:0.85rem; flex-shrink:0;">
                        ${(displayName[0] || '?').toUpperCase()}
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; color:var(--text-main); font-size:0.88rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escHtml(displayName)}</div>
                        <div style="font-size:0.73rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${_escHtml(entry.chat_id)}</div>
                    </div>
                    <button onclick="listaNegraView._deleteEntry('${_escAttr(entry.chat_id)}')"
                        style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:6px 8px; border-radius:8px; font-size:0.85rem; transition:all 0.15s; flex-shrink:0;"
                        onmouseenter="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.1)'"
                        onmouseleave="this.style.color='var(--text-muted)'; this.style.background='transparent'"
                        title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>

                <!-- Línea 2: toggles + notas -->
                <div style="display:flex; align-items:center; gap:14px; padding-left:46px; flex-wrap:wrap;">

                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.78rem; color:var(--text-muted); font-weight:500; white-space:nowrap;">Sin Bot</span>
                        <label class="switch" style="cursor:pointer; transform:scale(0.78); transform-origin:left center; margin-right:-12px;">
                            <input type="checkbox" id="${idSinBot}" ${entry.sin_bot ? 'checked' : ''} onchange="listaNegraView._onSinBotChange('${_escAttr(entry.chat_id)}', this.checked, '${idBloq}')">
                            <span class="slider">${svgX}${svgCheck}</span>
                        </label>
                    </div>

                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.78rem; color:var(--text-muted); font-weight:500; white-space:nowrap;">Bloqueado CRM</span>
                        <label class="switch" style="cursor:pointer; transform:scale(0.78); transform-origin:left center; margin-right:-12px;">
                            <input type="checkbox" id="${idBloq}" ${entry.bloqueado_crm ? 'checked' : ''} onchange="listaNegraView._onBloqCrmChange('${_escAttr(entry.chat_id)}', this.checked, '${idSinBot}')">
                            <span class="slider">${svgX}${svgCheck}</span>
                        </label>
                    </div>

                    <input type="text" value="${_escAttr(entry.notes || '')}" placeholder="Sin notas..."
                        style="flex:1; min-width:80px; background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.12); color:var(--text-muted); font-size:0.8rem; outline:none; padding:3px 2px; transition:all 0.2s;"
                        onfocus="this.style.borderBottomColor='rgba(0,153,255,0.4)'; this.style.color='var(--text-main)'"
                        onblur="listaNegraView._onNotesBlur('${_escAttr(entry.chat_id)}', this.value); this.style.borderBottomColor='rgba(255,255,255,0.12)'; this.style.color='var(--text-muted)'"
                        onkeydown="if(event.key==='Enter') this.blur()">

                </div>
            </div>`;
        }).join('');
    }

    // ── CHECKBOX LOGIC (mutually exclusive) ───────────────────────────────

    async function _onSinBotChange(chatId, newValue, pairedId) {
        const entry = _entries.find(e => e.chat_id === chatId);
        if (!entry) return;
        entry.sin_bot = newValue;
        if (newValue) {
            entry.bloqueado_crm = false;
            const paired = document.getElementById(pairedId);
            if (paired) paired.checked = false;
        }
        await _upsertEntry(entry);
    }

    async function _onBloqCrmChange(chatId, newValue, pairedId) {
        const entry = _entries.find(e => e.chat_id === chatId);
        if (!entry) return;
        entry.bloqueado_crm = newValue;
        if (newValue) {
            entry.sin_bot = false;
            const paired = document.getElementById(pairedId);
            if (paired) paired.checked = false;
        }
        await _upsertEntry(entry);
    }

    async function _onNotesBlur(chatId, notes) {
        const entry = _entries.find(e => e.chat_id === chatId);
        if (!entry || entry.notes === notes) return;
        entry.notes = notes;
        await _upsertEntry(entry);
    }

    // ── CRUD ──────────────────────────────────────────────────────────────

    async function _upsertEntry(entry) {
        try {
            await fetch(`/api/backoffice/blacklist?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: entry.chat_id,
                    sin_bot: entry.sin_bot,
                    bloqueado_crm: entry.bloqueado_crm,
                    notes: entry.notes || ''
                })
            });
        } catch (e) {
            showToast && showToast('Error guardando cambios', 'error');
        }
    }

    async function _deleteEntry(chatId) {
        if (!await window.swalConfirm('¿Eliminar contacto?', '¿Eliminar este contacto de la lista?')) return;
        try {
            await fetch(`/api/backoffice/blacklist/${encodeURIComponent(chatId)}?token=${_token}`, { method: 'DELETE' });
            _entries = _entries.filter(e => e.chat_id !== chatId);
            _renderTable();
            showToast && showToast('Contacto eliminado', 'success');
        } catch (e) {
            showToast && showToast('Error eliminando contacto', 'error');
        }
    }

    // ── MODAL ─────────────────────────────────────────────────────────────

    function _openAddModal() {
        const overlay = document.getElementById('ln-modal-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            document.getElementById('ln-modal-chatid').value = '';
            document.getElementById('ln-modal-notes').value = '';
            document.getElementById('ln-radio-sinbot').checked = true;
            _toggleModalMode('sinbot');
        }
    }

    function _closeModal() {
        const overlay = document.getElementById('ln-modal-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function _toggleModalMode(mode) {
        const sinbotLabel = document.getElementById('ln-modal-sinbot-label');
        const blockedLabel = document.getElementById('ln-modal-blocked-label');
        if (!sinbotLabel || !blockedLabel) return;

        if (mode === 'sinbot') {
            sinbotLabel.style.borderColor = '#25D366';
            sinbotLabel.style.background = 'rgba(37,211,102,0.07)';
            blockedLabel.style.borderColor = 'var(--border)';
            blockedLabel.style.background = 'transparent';
            document.getElementById('ln-radio-sinbot').checked = true;
        } else {
            blockedLabel.style.borderColor = '#ef4444';
            blockedLabel.style.background = 'rgba(239,68,68,0.07)';
            sinbotLabel.style.borderColor = 'var(--border)';
            sinbotLabel.style.background = 'transparent';
            document.getElementById('ln-radio-bloqueado').checked = true;
        }
    }

    async function _saveEntry() {
        const chatIdRaw = (document.getElementById('ln-modal-chatid')?.value || '').trim();
        if (!chatIdRaw) {
            document.getElementById('ln-modal-chatid').style.borderColor = '#ef4444';
            return;
        }

        // Normalizar: si es solo número, agregar sufijo de WhatsApp
        let chatId = chatIdRaw;
        if (!chatId.includes('@')) {
            chatId = chatId.replace(/\D/g, '') + '@s.whatsapp.net';
        }

        const mode = document.querySelector('input[name="ln-mode"]:checked')?.value || 'sinbot';
        const notes = document.getElementById('ln-modal-notes')?.value.trim() || '';

        const btn = document.getElementById('ln-modal-save-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>'; }

        try {
            const res = await fetch(`/api/backoffice/blacklist?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    sin_bot: mode === 'sinbot',
                    bloqueado_crm: mode === 'bloqueado',
                    notes
                })
            });
            const data = await res.json();
            if (data.success) {
                _closeModal();
                showToast && showToast('Contacto agregado a la lista', 'success');
                await _loadEntries();
            } else {
                showToast && showToast('Error: ' + (data.error || 'Desconocido'), 'error');
            }
        } catch (e) {
            showToast && showToast('Error guardando contacto', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Guardar'; }
        }
    }

    // ── ACTIVAR / DESACTIVAR ──────────────────────────────────────────────

    async function _onToggle(checked) {
        if (checked) {
            _activar();
        } else {
            const confirmed = await window.swalConfirm('¿Desactivar Lista?', '¿Desactivar la lista? Se eliminarán TODOS los registros de contactos en la lista.');
            if (!confirmed) {
                const toggle = document.getElementById('ln-toggle');
                if (toggle) toggle.checked = true;
                return;
            }
            _desactivar();
        }
    }

    async function _activar() {
        const toggle = document.getElementById('ln-toggle');
        if (toggle) toggle.disabled = true;
        try {
            const res = await fetch(`/api/backoffice/blacklist/activate?token=${_token}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = true;
                _render();
                await _loadEntries();
                showToast && showToast('Lista activada', 'success');
            } else {
                showToast && showToast('Error activando: ' + (data.error || ''), 'error');
                if (toggle) { toggle.checked = false; }
            }
        } catch (e) {
            showToast && showToast('Error de red', 'error');
            if (toggle) { toggle.checked = false; }
        } finally {
            if (toggle) toggle.disabled = false;
        }
    }

    async function _desactivar() {
        try {
            const res = await fetch(`/api/backoffice/blacklist/deactivate?token=${_token}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = false;
                _entries = [];
                _render();
                showToast && showToast('Lista desactivada y registros eliminados', 'success');
            } else {
                showToast && showToast('Error desactivando: ' + (data.error || ''), 'error');
            }
        } catch (e) {
            showToast && showToast('Error de red', 'error');
        }
    }

    // ── HELPERS ───────────────────────────────────────────────────────────

    function _escHtml(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function _escAttr(str) {
        return String(str || '').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    }

    function destroy() {
        // Clean up if needed
    }

    return {
        title: 'Lista BOT/CRM Desactivado',
        getHTML,
        init,
        destroy,
        _onToggle,
        _openAddModal,
        _closeModal,
        _toggleModalMode,
        _saveEntry,
        _deleteEntry,
        _onSinBotChange,
        _onBloqCrmChange,
        _onNotesBlur,
        _renderTable
    };
})();
