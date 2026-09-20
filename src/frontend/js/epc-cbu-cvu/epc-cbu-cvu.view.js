/* global showToast, navigate */
/* eslint-disable no-undef */
window.epcCbuCvuView = (() => {
    let _token = '';
    let _list = [];
    let _isSaving = false;

    // ── HTML ──────────────────────────────────────────────────────────────
    function getHTML() {
        return `
        <main class="crm-main-container relative animate-fade" style="z-index:10; padding:0;">
            <div class="kanban-header">
                <div class="header-info">
                    <h1>
                        <i class="fas fa-money-check-dollar kanban-header-icon" style="color:#0099FF;"></i>
                        Configuración CBU / CVU / ALIAS
                    </h1>
                    <p>Administrá las cuentas de transferencia para el bot de EPC y seleccioná cuál está activa.</p>
                </div>
                <div id="saving-indicator" style="display:none; align-items:center; gap:8px; font-size:0.85rem; color:#10b981; font-weight:500;">
                    <i class="fas fa-circle-notch fa-spin"></i> Guardando cambios...
                </div>
                <div id="saved-badge" style="display:flex; align-items:center; gap:6px; font-size:0.85rem; color:#10b981; font-weight:500;">
                    <i class="fas fa-circle-check"></i> Cambios guardados
                </div>
            </div>

            <div class="meta-view-body" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:24px; max-width:1200px; margin: 24px auto; padding:0 24px;">
                
                <!-- Columna Izquierda: Formulario de Nueva Cuenta -->
                <div class="card animate-reveal-up" style="background:var(--card-bg); border:1px solid var(--card-border-color); padding:24px; border-radius:16px; height:fit-content;">
                    <h2 style="margin:0 0 16px; font-size:1.15rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-plus-circle" style="color:#0099FF; font-size:1rem;"></i> Agregar Nueva Cuenta
                    </h2>
                    
                    <div style="display:flex; flex-direction:column; gap:16px;">
                        <!-- Tipo de cuenta -->
                        <div>
                            <label style="display:block; font-size:0.75rem; text-transform:uppercase; font-weight:700; color:var(--text-muted); margin-bottom:8px; letter-spacing:0.5px;">Tipo de Cuenta</label>
                            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
                                <label id="type-cbu-label" style="display:flex; align-items:center; justify-content:center; gap:6px; padding:10px; border-radius:10px; border:1px solid #0099FF; background:rgba(0,153,255,0.08); color:white; font-size:0.85rem; font-weight:600; cursor:pointer; transition:all 0.2s;">
                                    <input type="radio" name="acc-type" id="type-cbu" value="cbu" checked style="display:none;" onchange="epcCbuCvuView._onTypeChange('cbu')">
                                    CBU
                                </label>
                                <label id="type-cvu-label" style="display:flex; align-items:center; justify-content:center; gap:6px; padding:10px; border-radius:10px; border:1px solid var(--border); color:var(--text-muted); font-size:0.85rem; font-weight:600; cursor:pointer; transition:all 0.2s;">
                                    <input type="radio" name="acc-type" id="type-cvu" value="cvu" style="display:none;" onchange="epcCbuCvuView._onTypeChange('cvu')">
                                    CVU
                                </label>
                                <label id="type-alias-label" style="display:flex; align-items:center; justify-content:center; gap:6px; padding:10px; border-radius:10px; border:1px solid var(--border); color:var(--text-muted); font-size:0.85rem; font-weight:600; cursor:pointer; transition:all 0.2s;">
                                    <input type="radio" name="acc-type" id="type-alias" value="alias" style="display:none;" onchange="epcCbuCvuView._onTypeChange('alias')">
                                    Alias
                                </label>
                            </div>
                        </div>

                        <!-- Número / Alias -->
                        <div>
                            <label id="number-field-label" style="display:block; font-size:0.75rem; text-transform:uppercase; font-weight:700; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.5px;">Número de CBU</label>
                            <input id="acc-number" type="text" placeholder="Ej: 0170000000000000000001" 
                                style="width:100%; box-sizing:border-box; padding:10px 14px; border-radius:10px; background:rgba(0,0,0,0.15); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                        </div>

                        <!-- Titular -->
                        <div>
                            <label style="display:block; font-size:0.75rem; text-transform:uppercase; font-weight:700; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.5px;">Titular de la Cuenta</label>
                            <input id="acc-holder" type="text" placeholder="Ej: Juan Pérez" 
                                style="width:100%; box-sizing:border-box; padding:10px 14px; border-radius:10px; background:rgba(0,0,0,0.15); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                        </div>

                        <!-- Banco / Plataforma -->
                        <div>
                            <label style="display:block; font-size:0.75rem; text-transform:uppercase; font-weight:700; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.5px;">Banco o Entidad</label>
                            <input id="acc-bank" type="text" placeholder="Ej: Banco Galicia o Mercado Pago" 
                                style="width:100%; box-sizing:border-box; padding:10px 14px; border-radius:10px; background:rgba(0,0,0,0.15); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                        </div>

                        <!-- Botón Agregar -->
                        <button onclick="epcCbuCvuView._addAccount()" 
                            style="margin-top:8px; display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:12px; border-radius:12px; border:none; background:linear-gradient(135deg,#0099FF,#0066CC); color:white; font-size:0.9rem; font-weight:700; cursor:pointer; transition:all 0.15s; box-shadow: 0 4px 12px rgba(0,153,255,0.2);"
                            onmouseenter="this.style.filter='brightness(1.15)'" onmouseleave="this.style.filter='none'">
                            <i class="fas fa-plus"></i> Agregar Cuenta
                        </button>
                    </div>
                </div>

                <!-- Columna Derecha: Listado de Cuentas -->
                <div class="card animate-reveal-up" style="background:var(--card-bg); border:1px solid var(--card-border-color); padding:24px; border-radius:16px; min-height:300px; display:flex; flex-direction:column;">
                    <h2 style="margin:0 0 16px; font-size:1.15rem; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-list" style="color:#0099FF; font-size:1rem;"></i> Cuentas Configuradas
                    </h2>

                    <!-- List Container -->
                    <div id="accounts-list-container" style="flex:1; display:flex; flex-direction:column; gap:12px;">
                        ${typeof batLoaderHtml === 'function' ? batLoaderHtml('Cargando listado...') : '<div style="padding:48px 0; text-align:center; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem; color:#0099FF; margin-bottom:8px; display:block;"></i>Cargando listado...</div>'}
                    </div>
                </div>

            </div>
        </main>
        `;
    }

    // ── INIT ──────────────────────────────────────────────────────────────
    async function init() {
        _token = localStorage.getItem('backoffice_token') || '';
        await _loadList();
    }

    async function _loadList() {
        try {
            const res = await fetch(`/api/backoffice/get-setting?key=EPC_CBU_CVU_DATA&token=${_token}`);
            const data = await res.json();
            
            if (data.success && data.value) {
                _list = JSON.parse(data.value);
            } else {
                _list = [];
            }
            _renderList();
        } catch (e) {
            console.error('[CbuCvuView] Error loading list:', e);
            _list = [];
            _renderList();
        }
    }

    function _renderList() {
        const container = document.getElementById('accounts-list-container');
        if (!container) return;

        if (_list.length === 0) {
            container.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 24px; text-align:center; border:2px dashed rgba(255,255,255,0.05); border-radius:12px;">
                <i class="fas fa-money-bills" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
                <p style="color:var(--text-muted); margin:0; font-size:0.9rem; font-weight:600;">No hay cuentas de transferencia registradas</p>
                <p style="color:var(--text-muted); font-size:0.8rem; margin:6px 0 0; max-width:280px;">Utilizá el formulario de la izquierda para registrar una y activarla.</p>
            </div>
            `;
            return;
        }

        container.innerHTML = _list.map((item) => {
            const isActive = item.active === true;
            const cardBorder = isActive ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.06)';
            const cardBg = isActive ? 'rgba(16,185,129,0.03)' : 'rgba(255,255,255,0.01)';
            const typeLabel = item.type.toUpperCase();
            
            let iconClass = 'fa-building-columns';
            if (item.type === 'cvu') iconClass = 'fa-wallet';
            if (item.type === 'alias') iconClass = 'fa-tag';

            return `
            <div class="animate-reveal-up" style="display:flex; align-items:center; justify-content:between; gap:12px; padding:14px 16px; border-radius:12px; background:${cardBg}; border:${cardBorder}; transition:all 0.2s;">
                
                <!-- Radio para elegir activa -->
                <div style="flex-shrink:0;">
                    <label style="display:block; position:relative; cursor:pointer; width:20px; height:20px;">
                        <input type="radio" name="active-acc" ${isActive ? 'checked' : ''} 
                            onclick="epcCbuCvuView._setActive('${item.id}')"
                            style="cursor:pointer; accent-color:#10b981; width:20px; height:20px; margin:0;">
                    </label>
                </div>

                <!-- Icono de tipo -->
                <div style="width:36px; height:36px; border-radius:8px; background:rgba(0,153,255,0.08); border:1px solid rgba(0,153,255,0.15); display:flex; align-items:center; justify-content:center; color:#0099FF; flex-shrink:0;">
                    <i class="fas ${iconClass}" style="font-size:0.9rem;"></i>
                </div>

                <!-- Detalles de cuenta -->
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:#0099FF; background:rgba(0,153,255,0.1); padding:2px 6px; border-radius:4px;">${typeLabel}</span>
                        ${isActive ? '<span style="font-size:0.68rem; font-weight:700; color:#10b981; background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:4px;">Activa</span>' : ''}
                    </div>
                    <div style="font-weight:600; font-size:0.9rem; color:var(--text-main); margin-top:4px; word-break:break-all;">
                        ${_escHtml(item.number)}
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                        Titular: <span style="color:var(--text-main); font-weight:500;">${_escHtml(item.holder || 'N/A')}</span> | Entidad: <span style="color:var(--text-main); font-weight:500;">${_escHtml(item.bank || 'N/A')}</span>
                    </div>
                </div>

                <!-- Botón eliminar -->
                <div style="flex-shrink:0;">
                    <button onclick="epcCbuCvuView._deleteAccount('${item.id}')"
                        style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:8px; border-radius:8px; font-size:0.88rem; transition:all 0.15s;"
                        onmouseenter="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.1)'"
                        onmouseleave="this.style.color='var(--text-muted)'; this.style.background='transparent'"
                        title="Eliminar"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
            `;
        }).join('');
    }

    // ── SELECTION LOGIC ───────────────────────────────────────────────────
    function _onTypeChange(type) {
        const labels = {
            cbu: document.getElementById('type-cbu-label'),
            cvu: document.getElementById('type-cvu-label'),
            alias: document.getElementById('type-alias-label')
        };
        const numberLabel = document.getElementById('number-field-label');
        const numberInput = document.getElementById('acc-number');

        Object.keys(labels).forEach(key => {
            const el = labels[key];
            if (!el) return;
            if (key === type) {
                el.style.borderColor = '#0099FF';
                el.style.background = 'rgba(0,153,255,0.08)';
                el.style.color = 'white';
            } else {
                el.style.borderColor = 'var(--border)';
                el.style.background = 'transparent';
                el.style.color = 'var(--text-muted)';
            }
        });

        if (numberLabel) {
            numberLabel.textContent = type === 'alias' ? 'Alias de cuenta' : `Número de ${type.toUpperCase()}`;
        }
        if (numberInput) {
            numberInput.placeholder = type === 'alias' ? 'Ej: guchi.casino.epc' : (type === 'cvu' ? 'Ej: 0000003100000000000002' : 'Ej: 0170000000000000000001');
        }
    }

    // ── CRUD OPERATIONS ───────────────────────────────────────────────────
    async function _addAccount() {
        const type = document.querySelector('input[name="acc-type"]:checked')?.value || 'cbu';
        const number = (document.getElementById('acc-number')?.value || '').trim();
        const holder = (document.getElementById('acc-holder')?.value || '').trim();
        const bank = (document.getElementById('acc-bank')?.value || '').trim();

        if (!number) {
            document.getElementById('acc-number').style.borderColor = '#ef4444';
            showToast && showToast('Por favor, ingresá el número o alias', 'error');
            return;
        }

        // Si es CBU o CVU, validar longitud numérica básica (deben ser 22 dígitos)
        if ((type === 'cbu' || type === 'cvu') && !/^\d{22}$/.test(number)) {
            document.getElementById('acc-number').style.borderColor = '#ef4444';
            showToast && showToast(`El ${type.toUpperCase()} debe contener exactamente 22 números`, 'error');
            return;
        }

        const newAccount = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            type,
            number,
            holder,
            bank,
            active: _list.length === 0 // Activa por defecto si es la primera
        };

        _list.push(newAccount);
        
        // Limpiar inputs
        document.getElementById('acc-number').value = '';
        document.getElementById('acc-holder').value = '';
        document.getElementById('acc-bank').value = '';

        _renderList();
        await _saveList();
        showToast && showToast('Cuenta agregada exitosamente', 'success');
    }

    async function _setActive(id) {
        _list.forEach((item) => {
            item.active = item.id === id;
        });
        _renderList();
        await _saveList();
    }

    async function _deleteAccount(id) {
        if (!await window.swalConfirm('¿Eliminar cuenta?', '¿Estás seguro de que querés eliminar esta cuenta?')) return;
        
        const wasActive = _list.find(item => item.id === id)?.active === true;
        _list = _list.filter(item => item.id !== id);

        // Si eliminamos la cuenta activa y quedan más, activar la primera de la lista
        if (wasActive && _list.length > 0) {
            _list[0].active = true;
        }

        _renderList();
        await _saveList();
        showToast && showToast('Cuenta eliminada', 'success');
    }

    async function _saveList() {
        const saving = document.getElementById('saving-indicator');
        const saved = document.getElementById('saved-badge');
        if (saving) saving.style.display = 'flex';
        if (saved) saved.style.display = 'none';

        _isSaving = true;
        try {
            const res = await fetch(`/api/backoffice/save-setting?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: 'EPC_CBU_CVU_DATA',
                    value: JSON.stringify(_list)
                })
            });
            const data = await res.json();
            if (!data.success) {
                showToast && showToast('Error al guardar: ' + (data.error || 'Desconocido'), 'error');
            }
        } catch (e) {
            console.error('[CbuCvuView] Error saving list:', e);
            showToast && showToast('Error de conexión al guardar cambios', 'error');
        } finally {
            _isSaving = false;
            if (saving) saving.style.display = 'none';
            if (saved) saved.style.display = 'flex';
        }
    }

    // ── HELPERS ───────────────────────────────────────────────────────────
    function _escHtml(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function destroy() {
        // Clean up if needed
    }

    return {
        title: 'CBU / CVU / ALIAS - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy,
        _onTypeChange,
        _addAccount,
        _setActive,
        _deleteAccount
    };
})();
