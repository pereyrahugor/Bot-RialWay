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
                        <span style="position:relative; display:inline-flex; align-items:center; margin-right:6px;">
                            <i class="fas fa-list-ul kanban-header-icon" style="color:#25D366;"></i>
                            <i class="fas fa-pencil" style="font-size:0.7em; color:#128C7E; position:absolute; bottom:-2px; right:-6px;"></i>
                        </span>
                        Lista Negra
                    </h1>
                    <p>Control de contactos excluidos del bot o del CRM</p>
                </div>
                <div id="ln-header-actions" style="display:none; gap:8px; align-items:center;">
                    <button id="ln-add-btn" class="btn-primary" onclick="listaNegraView._openAddModal()" style="display:flex; align-items:center; gap:6px; padding:8px 16px; font-size:0.88rem; border-radius:10px; background:linear-gradient(135deg,#25D366,#128C7E);">
                        <i class="fas fa-plus"></i> Agregar contacto
                    </button>
                    <button onclick="listaNegraView._confirmDeactivate()" style="display:flex; align-items:center; gap:6px; padding:8px 16px; font-size:0.88rem; border-radius:10px; background:transparent; border:1.5px solid var(--border); color:var(--text-muted); cursor:pointer;">
                        <i class="fas fa-power-off"></i> Desactivar
                    </button>
                </div>
            </div>

            <div class="meta-view-body">

                <!-- Estado: inactivo (onboarding) -->
                <div id="ln-onboarding" style="display:none;">
                    <div class="meta-onboarding-wrap glass-card animate-fade" style="border-top: 4px solid #25D366;">
                        <div style="font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%; position:relative; display:inline-block;">
                            <i class="fas fa-list-ul" style="color:#25D366;"></i>
                            <i class="fas fa-pencil" style="font-size:1.2rem; color:#128C7E; position:absolute; bottom:4px; right:calc(50% - 28px);"></i>
                        </div>
                        <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                            <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Lista Negra</h2>
                            <div style="height:3px; width:50px; background:linear-gradient(90deg,#25D366,#128C7E); border-radius:10px; margin:0 auto 12px;"></div>
                            <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.6; margin:0; max-width:440px;">
                                Aquí puedes gestionar qué contactos no reciben atención automática del bot o qué contactos quieres que queden excluidos totalmente de los chats del CRM.
                            </p>
                        </div>
                        <div style="background:var(--bg-header); padding:1rem 1.25rem; border-radius:16px; border:1px solid var(--border); width:100%; margin-bottom:1.5rem;">
                            <h4 style="margin:0 0 8px; color:#25D366; font-size:0.78rem; text-transform:uppercase; letter-spacing:1.5px; font-weight:700;">¿Cómo funciona?</h4>
                            <ul style="font-size:0.88rem; color:var(--text-main); margin:0; display:flex; flex-direction:column; gap:6px; list-style:none; padding:0;">
                                <li style="display:flex; align-items:flex-start; gap:8px;">
                                    <i class="fas fa-robot" style="color:#25D366; margin-top:2px; flex-shrink:0;"></i>
                                    <span><strong>Sin Bot:</strong> El chat sigue visible en el CRM pero el bot nunca retoma el control. Permanece en atención humana.</span>
                                </li>
                                <li style="display:flex; align-items:flex-start; gap:8px;">
                                    <i class="fas fa-eye-slash" style="color:#ef4444; margin-top:2px; flex-shrink:0;"></i>
                                    <span><strong>Bloqueado CRM:</strong> Además de lo anterior, el contacto queda completamente oculto en el backoffice.</span>
                                </li>
                            </ul>
                        </div>
                        <button id="ln-activate-btn" class="btn-primary" onclick="listaNegraView._activar()" style="width:100%; padding:13px 20px; display:flex; align-items:center; justify-content:center; gap:10px; font-size:0.95rem; font-weight:600; border-radius:14px; background:linear-gradient(135deg,#25D366,#128C7E);">
                            <i class="fas fa-power-off"></i> Activar Lista Negra
                        </button>
                    </div>
                </div>

                <!-- Estado: activo (grilla) -->
                <div id="ln-active" style="display:none;">
                    <div class="glass-card animate-fade" style="padding:0; overflow:hidden; border-top:4px solid #25D366;">

                        <!-- Search bar -->
                        <div style="padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; background:var(--bg-header);">
                            <i class="fas fa-search" style="color:var(--text-muted);"></i>
                            <input id="ln-search" type="text" placeholder="Buscar contacto..." oninput="listaNegraView._renderTable()" style="flex:1; background:transparent; border:none; outline:none; color:var(--text-main); font-size:0.9rem;">
                        </div>

                        <!-- Table -->
                        <div style="overflow-x:auto;">
                            <table id="ln-table" style="width:100%; border-collapse:collapse; font-size:0.88rem;">
                                <thead>
                                    <tr style="background:var(--bg-header); border-bottom:2px solid var(--border);">
                                        <th style="padding:12px 16px; text-align:left; font-weight:700; color:var(--text-muted); font-size:0.78rem; text-transform:uppercase; letter-spacing:1px;">Contacto</th>
                                        <th style="padding:12px 16px; text-align:center; font-weight:700; color:#25D366; font-size:0.78rem; text-transform:uppercase; letter-spacing:1px; white-space:nowrap;">
                                            <i class="fas fa-robot"></i> Sin Bot
                                        </th>
                                        <th style="padding:12px 16px; text-align:center; font-weight:700; color:#ef4444; font-size:0.78rem; text-transform:uppercase; letter-spacing:1px; white-space:nowrap;">
                                            <i class="fas fa-eye-slash"></i> Bloqueado CRM
                                        </th>
                                        <th style="padding:12px 16px; text-align:left; font-weight:700; color:var(--text-muted); font-size:0.78rem; text-transform:uppercase; letter-spacing:1px;">Notas</th>
                                        <th style="padding:12px 16px; text-align:center; font-weight:700; color:var(--text-muted); font-size:0.78rem; text-transform:uppercase; letter-spacing:1px;">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody id="ln-tbody">
                                    <tr><td colspan="5" style="padding:32px; text-align:center; color:var(--text-muted);">
                                        <i class="fas fa-circle-notch fa-spin"></i> Cargando...
                                    </td></tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Empty state -->
                        <div id="ln-empty" style="display:none; padding:48px 24px; text-align:center;">
                            <i class="fas fa-list-check" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
                            <p style="color:var(--text-muted); margin:0;">No hay contactos en la lista negra.</p>
                            <p style="color:var(--text-muted); font-size:0.85rem; margin:4px 0 0;">Usá el botón <strong>Agregar contacto</strong> para añadir uno.</p>
                        </div>
                    </div>
                </div>

            </div>
        </main>

        <!-- Modal: Agregar contacto -->
        <div id="ln-modal-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:9999; display:none; align-items:center; justify-content:center;">
            <div class="glass-card" style="width:100%; max-width:440px; padding:28px 24px; border-radius:20px; border-top:4px solid #25D366; position:relative;">
                <h3 style="margin:0 0 4px; font-size:1.1rem; font-weight:700; color:var(--text-main);">Agregar a Lista Negra</h3>
                <p style="margin:0 0 20px; font-size:0.85rem; color:var(--text-muted);">Ingresa el ID del contacto (número de teléfono con código de país)</p>
                
                <div style="margin-bottom:14px;">
                    <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">ID Contacto (ej: 5491112345678)</label>
                    <input id="ln-modal-chatid" type="text" placeholder="5491112345678@s.whatsapp.net o solo el número" style="width:100%; padding:10px 12px; border-radius:10px; border:1.5px solid var(--border); background:var(--bg-header); color:var(--text-main); font-size:0.9rem; box-sizing:border-box; outline:none;" oninput="this.style.borderColor='var(--border)'">
                </div>

                <div style="margin-bottom:14px; display:flex; gap:12px;">
                    <label id="ln-modal-sinbot-label" style="flex:1; padding:12px; border-radius:12px; border:2px solid var(--border); cursor:pointer; display:flex; align-items:center; gap:8px; transition:all 0.2s;" onclick="listaNegraView._toggleModalMode('sinbot')">
                        <input type="radio" name="ln-mode" id="ln-radio-sinbot" value="sinbot" checked style="accent-color:#25D366;">
                        <span>
                            <strong style="font-size:0.88rem;">Sin Bot</strong><br>
                            <span style="font-size:0.78rem; color:var(--text-muted);">Visible, sin reset automático</span>
                        </span>
                    </label>
                    <label id="ln-modal-blocked-label" style="flex:1; padding:12px; border-radius:12px; border:2px solid var(--border); cursor:pointer; display:flex; align-items:center; gap:8px; transition:all 0.2s;" onclick="listaNegraView._toggleModalMode('bloqueado')">
                        <input type="radio" name="ln-mode" id="ln-radio-bloqueado" value="bloqueado" style="accent-color:#ef4444;">
                        <span>
                            <strong style="font-size:0.88rem;">Bloqueado CRM</strong><br>
                            <span style="font-size:0.78rem; color:var(--text-muted);">Oculto completamente</span>
                        </span>
                    </label>
                </div>

                <div style="margin-bottom:18px;">
                    <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Notas (opcional)</label>
                    <input id="ln-modal-notes" type="text" placeholder="Ej: Spam, cliente problemático..." style="width:100%; padding:10px 12px; border-radius:10px; border:1.5px solid var(--border); background:var(--bg-header); color:var(--text-main); font-size:0.9rem; box-sizing:border-box; outline:none;">
                </div>

                <div style="display:flex; gap:10px;">
                    <button onclick="listaNegraView._closeModal()" style="flex:1; padding:11px; border-radius:10px; border:1.5px solid var(--border); background:transparent; color:var(--text-muted); cursor:pointer; font-size:0.9rem;">Cancelar</button>
                    <button id="ln-modal-save-btn" onclick="listaNegraView._saveEntry()" style="flex:1; padding:11px; border-radius:10px; border:none; background:linear-gradient(135deg,#25D366,#128C7E); color:white; cursor:pointer; font-size:0.9rem; font-weight:600;">
                        <i class="fas fa-check"></i> Guardar
                    </button>
                </div>
            </div>
        </div>
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
        const onboarding = document.getElementById('ln-onboarding');
        const active = document.getElementById('ln-active');
        const headerActions = document.getElementById('ln-header-actions');

        if (_isActive) {
            if (onboarding) onboarding.style.display = 'none';
            if (active) active.style.display = 'block';
            if (headerActions) headerActions.style.display = 'flex';
        } else {
            if (onboarding) onboarding.style.display = 'block';
            if (active) active.style.display = 'none';
            if (headerActions) headerActions.style.display = 'none';
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

        tbody.innerHTML = filtered.map(entry => {
            const sinBotChecked = entry.sin_bot ? 'checked' : '';
            const bloqCrmChecked = entry.bloqueado_crm ? 'checked' : '';
            const displayName = entry.name || entry.chat_id;

            return `
            <tr style="border-bottom:1px solid var(--border); transition:background 0.15s;" onmouseenter="this.style.background='var(--bg-header)'" onmouseleave="this.style.background='transparent'">
                <td style="padding:12px 16px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg,#25D366,#128C7E); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:0.85rem; flex-shrink:0;">
                            ${(displayName[0] || '?').toUpperCase()}
                        </div>
                        <div>
                            <div style="font-weight:600; color:var(--text-main); font-size:0.9rem;">${_escHtml(displayName)}</div>
                            <div style="font-size:0.75rem; color:var(--text-muted);">${_escHtml(entry.chat_id)}</div>
                        </div>
                    </div>
                </td>
                <td style="padding:12px 16px; text-align:center;">
                    <label class="ln-radio-cell" title="Sin Bot" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <input type="checkbox" ${sinBotChecked} onchange="listaNegraView._onSinBotChange('${_escAttr(entry.chat_id)}', this)"
                            style="width:18px; height:18px; accent-color:#25D366; cursor:pointer;">
                    </label>
                </td>
                <td style="padding:12px 16px; text-align:center;">
                    <label class="ln-radio-cell" title="Bloqueado CRM" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
                        <input type="checkbox" ${bloqCrmChecked} onchange="listaNegraView._onBloqCrmChange('${_escAttr(entry.chat_id)}', this)"
                            style="width:18px; height:18px; accent-color:#ef4444; cursor:pointer;">
                    </label>
                </td>
                <td style="padding:12px 16px;">
                    <input type="text" value="${_escAttr(entry.notes || '')}" placeholder="Sin notas..."
                        style="background:transparent; border:none; border-bottom:1px dashed var(--border); color:var(--text-main); font-size:0.85rem; width:100%; outline:none; padding:2px 4px;"
                        onblur="listaNegraView._onNotesBlur('${_escAttr(entry.chat_id)}', this.value)"
                        onkeydown="if(event.key==='Enter') this.blur()">
                </td>
                <td style="padding:12px 16px; text-align:center;">
                    <button onclick="listaNegraView._deleteEntry('${_escAttr(entry.chat_id)}')"
                        style="background:transparent; border:none; color:#ef4444; cursor:pointer; padding:6px 10px; border-radius:8px; font-size:0.88rem; transition:background 0.15s;"
                        onmouseenter="this.style.background='rgba(239,68,68,0.1)'" onmouseleave="this.style.background='transparent'"
                        title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ── CHECKBOX LOGIC (mutually exclusive) ───────────────────────────────

    async function _onSinBotChange(chatId, checkbox) {
        const entry = _entries.find(e => e.chat_id === chatId);
        if (!entry) return;

        // Si activa Sin Bot, desactiva Bloqueado CRM
        if (checkbox.checked) {
            entry.sin_bot = true;
            entry.bloqueado_crm = false;
        } else {
            entry.sin_bot = false;
        }

        // Actualizar otro checkbox en el DOM
        _syncRowCheckboxes(chatId, entry.sin_bot, entry.bloqueado_crm);
        await _upsertEntry(entry);
    }

    async function _onBloqCrmChange(chatId, checkbox) {
        const entry = _entries.find(e => e.chat_id === chatId);
        if (!entry) return;

        if (checkbox.checked) {
            entry.bloqueado_crm = true;
            entry.sin_bot = false;
        } else {
            entry.bloqueado_crm = false;
        }

        _syncRowCheckboxes(chatId, entry.sin_bot, entry.bloqueado_crm);
        await _upsertEntry(entry);
    }

    function _syncRowCheckboxes(chatId, sinBot, bloqCrm) {
        // Re-renderizar para mantener consistencia sin flickering
        const entry = _entries.find(e => e.chat_id === chatId);
        if (entry) {
            entry.sin_bot = sinBot;
            entry.bloqueado_crm = bloqCrm;
        }
        _renderTable();
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
        if (!confirm('¿Eliminar este contacto de la lista negra?')) return;
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
                showToast && showToast('Contacto agregado a la lista negra', 'success');
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

    async function _activar() {
        const btn = document.getElementById('ln-activate-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Activando...'; }
        try {
            const res = await fetch(`/api/backoffice/blacklist/activate?token=${_token}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = true;
                _render();
                await _loadEntries();
                showToast && showToast('Lista Negra activada', 'success');
            } else {
                showToast && showToast('Error activando: ' + (data.error || ''), 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-power-off"></i> Activar Lista Negra'; }
            }
        } catch (e) {
            showToast && showToast('Error de red', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-power-off"></i> Activar Lista Negra'; }
        }
    }

    function _confirmDeactivate() {
        if (!confirm('¿Desactivar la Lista Negra? Se eliminarán TODOS los registros de contactos en la lista.')) return;
        _desactivar();
    }

    async function _desactivar() {
        try {
            const res = await fetch(`/api/backoffice/blacklist/deactivate?token=${_token}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                _isActive = false;
                _entries = [];
                _render();
                showToast && showToast('Lista Negra desactivada y registros eliminados', 'success');
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
        title: 'Lista Negra',
        getHTML,
        init,
        destroy,
        // Exponer métodos para handlers inline
        _activar,
        _confirmDeactivate,
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
