/* global showToast, bootstrap */
/* eslint-disable no-undef */
window.databaseView = (() => {
    let _token = '';
    let _hasTables = false;
    let _hasRag = false;
    let _activeTab = 'tables'; // 'tables' | 'rag'
    
    // State Tables
    let _tablesList = [];
    let _activeTable = null; // TableMeta: { tableName, sheetId, sheetTitle, headers }
    let _tableRows = [];
    
    // State RAG
    let _docsList = [];
    let _activeDoc = null; // RagDocMeta: { docId, docName }
    let _docText = '';

    // State Super Admin
    let _isSuperAdmin = false;
    let _allServicesList = [];
    let _visibleServicesSet = new Set();

    // HTML Structure
    function getHTML() {
        return `
        <main class="crm-main-container animate-fade" style="padding: 24px; display: flex; flex-direction: column; height: 100%; overflow: hidden;">
            
            <!-- HEADER -->
            <div class="kanban-header" style="flex-shrink: 0; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div class="header-info">
                    <h1>
                        <i class="fas fa-database kanban-header-icon" style="color: var(--accent);"></i>
                        Base de Datos y RAG
                    </h1>
                    <p>Gestioná las tablas sincronizadas y documentos de conocimiento del bot en tiempo real</p>
                </div>
                
                <!-- TABS SWITCH -->
                <div style="display: flex; gap: 8px; background: var(--bg-secondary); padding: 4px; border-radius: 12px; border: 1px solid var(--card-border-color);">
                    <button onclick="databaseView._switchTab('tables')" id="btn-tab-tables" class="filter-pill active" style="border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-table"></i> Tablas
                    </button>
                    <button onclick="databaseView._switchTab('rag')" id="btn-tab-rag" class="filter-pill" style="border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-brain"></i> Documentos RAG
                    </button>
                    <button onclick="databaseView._switchTab('multicrm')" id="btn-tab-multicrm" class="filter-pill" style="border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; display: none; align-items: center; gap: 8px;">
                        <i class="fas fa-user-shield"></i> Modo Supervisor
                    </button>
                </div>
            </div>

            <!-- CONTAINER MAIN BODY -->
            <div style="display: flex; flex: 1; min-height: 0; gap: 24px; width: 100%;">
                
                <!-- SIDEBAR: LIST OF AVAILABLE SHEETS/DOCS -->
                <div style="width: 260px; flex-shrink: 0; background: var(--card-bg); border: 1px solid var(--card-border-color); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
                    <div style="padding: 16px; border-bottom: 1px solid var(--card-border-color);">
                        <h3 id="sidebar-title" style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-folder-open" style="color: var(--accent);"></i> Tablas Disponibles
                        </h3>
                    </div>
                    <div id="sidebar-items-list" style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
                        <!-- dynamic sidebar list items -->
                    </div>
                </div>

                <!-- CONTENT WORKSPACE -->
                <div style="flex: 1; background: var(--card-bg); border: 1px solid var(--card-border-color); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); position: relative;">
                    
                    <!-- Loading state overlay -->
                    <div id="workspace-loading" style="position: absolute; top:0; left:0; right:0; bottom:0; background: rgba(255,255,255,0.7); z-index: 100; display: none; align-items: center; justify-content: center; backdrop-filter: blur(2px);">
                        ${typeof batLoaderHtml === 'function' ? batLoaderHtml('Procesando cambios...') : '<div class="bat-loader"><div class="bat-stage-wrapper"><div class="bat-stage"><div class="bat-pixel"></div></div></div><span class="bat-loader-text">Procesando cambios...</span></div>'}
                    </div>

                    <!-- Panel Tables -->
                    <div id="panel-tables" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
                        <div style="padding: 16px; border-bottom: 1px solid var(--card-border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; flex-wrap: wrap; gap: 12px;">
                            <div>
                                <h2 id="active-table-name" style="margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-main);">Ninguna tabla seleccionada</h2>
                                <p id="active-table-sub" style="margin: 2px 0 0; font-size: 0.75rem; color: var(--text-muted);"></p>
                            </div>
                            <div id="table-actions" style="display: none; gap: 10px; align-items: center;">
                                <button onclick="databaseView._openRowModal()" class="filter-pill active" style="cursor: pointer; padding: 8px 16px; border-radius: 10px; font-weight: bold; background: #10B981; color: white;">
                                    <i class="fas fa-plus"></i> Agregar Fila
                                </button>
                                <button onclick="databaseView._deleteSelectedRows()" id="btn-delete-selected" class="filter-pill" style="cursor: pointer; padding: 8px 16px; border-radius: 10px; font-weight: bold; background: #EF4444; color: white; display: none;">
                                    <i class="fas fa-trash-can"></i> Eliminar (<span id="delete-selected-count">0</span>)
                                </button>
                            </div>
                        </div>
                        <div id="table-table-wrapper" style="flex: 1; overflow: auto; padding: 0;">
                            <!-- Dynamic Spreadsheet Grid -->
                            <div style="padding: 40px; text-align: center; color: var(--text-muted);">
                                <i class="fas fa-table" style="font-size: 3rem; opacity: 0.3; margin-bottom: 16px;"></i>
                                <p>Seleccioná una tabla del menú lateral para comenzar a editar</p>
                            </div>
                        </div>
                    </div>

                    <!-- Panel RAG -->
                    <div id="panel-rag" style="display: none; flex-direction: column; height: 100%; width: 100%;">
                        <div style="padding: 16px; border-bottom: 1px solid var(--card-border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; flex-wrap: wrap; gap: 12px;">
                            <div>
                                <h2 id="active-doc-name" style="margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-main);">Ningún documento seleccionado</h2>
                                <p id="active-doc-sub" style="margin: 2px 0 0; font-size: 0.75rem; color: var(--text-muted);">El texto modificado se re-indexará en la base de conocimientos RAG automáticamente</p>
                            </div>
                            <button onclick="databaseView._saveDocText()" id="btn-save-doc" class="filter-pill active" style="display: none; cursor: pointer; padding: 8px 16px; border-radius: 10px; font-weight: bold; background: var(--accent); color: white;">
                                <i class="fas fa-floppy-disk"></i> Guardar Cambios
                            </button>
                        </div>
                        <div style="flex: 1; display: flex; flex-direction: column; padding: 20px;">
                            <textarea id="rag-text-editor" style="flex: 1; width: 100%; height: 100%; border: 1px solid var(--card-border-color); border-radius: 12px; padding: 16px; font-family: 'Courier New', Courier, monospace; font-size: 0.9rem; line-height: 1.6; resize: none; outline: none; background: #0A0F1D; color: #E2E8F0;" disabled placeholder="Seleccioná un documento RAG para editar..."></textarea>
                        </div>
                    </div>

                    <!-- Panel Multi-CRM -->
                    <div id="panel-multicrm" style="display: none; flex-direction: column; height: 100%; width: 100%;">
                        <div style="padding: 16px; border-bottom: 1px solid var(--card-border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; flex-wrap: wrap; gap: 12px;">
                            <div>
                                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-main);">Configuración de Consola Modo Supervisor (Multi-CRM)</h2>
                                <p style="margin: 2px 0 0; font-size: 0.75rem; color: var(--text-muted);">Seleccioná qué instancias de CRM/Servicios deseas visualizar y administrar en este panel consolidado</p>
                            </div>
                            <button onclick="databaseView._saveMultiCrmConfig()" id="btn-save-multicrm" class="filter-pill active" style="cursor: pointer; padding: 8px 16px; border-radius: 10px; font-weight: bold; background: var(--accent); color: white;">
                                <i class="fas fa-floppy-disk"></i> Guardar Cambios
                            </button>
                        </div>
                        <div style="flex: 1; padding: 20px; overflow-y: auto;">
                            <div id="multicrm-services-list" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                                <!-- Dynamic service cards injected here -->
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            <!-- MODAL ADD/EDIT ROW -->
            <div id="row-modal" class="modal-overlay-wa" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(15,23,42,0.45); backdrop-filter: blur(4px); z-index: 10000; display: none; align-items: center; justify-content: center;">
                <div class="notif-modal-content" style="max-width: 500px; width: 100%; max-height: 90vh; display: flex; flex-direction: column;">
                    <div class="notif-modal-header">
                        <h3 id="row-modal-title" style="margin: 0; font-weight: 700;">Agregar Fila</h3>
                        <button onclick="databaseView._closeRowModal()" class="btn-icon-wa" style="width:32px; height:32px; border-radius:8px; background:rgba(0,0,0,0.05); color:var(--text-muted);">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div id="row-modal-body" style="padding: 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;">
                        <!-- Dynamic inputs injected here -->
                    </div>
                    <div style="padding: 16px; border-top: 1px solid var(--card-border-color); display: flex; gap: 12px; justify-content: flex-end; background: var(--bg-secondary);">
                        <button onclick="databaseView._closeRowModal()" class="sw-btn-cancel" style="padding: 8px 16px;">Cancelar</button>
                        <button onclick="databaseView._saveRow()" class="sw-btn-send" style="padding: 8px 16px; background: #10B981;">Guardar</button>
                    </div>
                </div>
            </div>

        </main>
        `;
    }

    // INIT
    async function init() {
        _token = localStorage.getItem('backoffice_token') || '';
        
        // 1. Validar configuraciones habilitadas (si tiene tables y/o RAG)
        try {
            const res = await fetch(`/api/backoffice/database/settings?token=${_token}`);
            const result = await res.json();
            if (result.success) {
                _hasTables = result.hasTables;
                _hasRag = result.hasRag;
                _isSuperAdmin = result.isSuperAdmin || false;

                const btnMultiCrm = document.getElementById('btn-tab-multicrm');
                if (btnMultiCrm) {
                    btnMultiCrm.style.display = _isSuperAdmin ? 'flex' : 'none';
                }
            }
        } catch (e) {
            console.error(e);
        }

        // Cargar por defecto tab de tablas si está disponible
        _switchTab('tables');
    }

    // SWITCH TAB
    async function _switchTab(tabId) {
        _activeTab = tabId;
        
        const btnTables = document.getElementById('btn-tab-tables');
        const btnRag = document.getElementById('btn-tab-rag');
        const btnMultiCrm = document.getElementById('btn-tab-multicrm');
        const panelTables = document.getElementById('panel-tables');
        const panelRag = document.getElementById('panel-rag');
        const panelMultiCrm = document.getElementById('panel-multicrm');
        const sidebarTitle = document.getElementById('sidebar-title');
        const sidebarItemsList = document.getElementById('sidebar-items-list');

        if (tabId === 'tables') {
            btnTables.classList.add('active');
            btnRag.classList.remove('active');
            if (btnMultiCrm) btnMultiCrm.classList.remove('active');
            panelTables.style.display = 'flex';
            panelRag.style.display = 'none';
            if (panelMultiCrm) panelMultiCrm.style.display = 'none';
            sidebarTitle.innerHTML = `<i class="fas fa-table" style="color: var(--accent);"></i> Tablas Disponibles`;
            await _loadTablesList();
        } else if (tabId === 'rag') {
            btnTables.classList.remove('active');
            btnRag.classList.add('active');
            if (btnMultiCrm) btnMultiCrm.classList.remove('active');
            panelTables.style.display = 'none';
            panelRag.style.display = 'flex';
            if (panelMultiCrm) panelMultiCrm.style.display = 'none';
            sidebarTitle.innerHTML = `<i class="fas fa-brain" style="color: var(--accent);"></i> Documentos RAG`;
            await _loadDocsList();
        } else if (tabId === 'multicrm') {
            btnTables.classList.remove('active');
            btnRag.classList.remove('active');
            if (btnMultiCrm) btnMultiCrm.classList.add('active');
            panelTables.style.display = 'none';
            panelRag.style.display = 'none';
            if (panelMultiCrm) panelMultiCrm.style.display = 'flex';
            sidebarTitle.innerHTML = `<i class="fas fa-network-wired" style="color: var(--accent);"></i> Multi-CRM`;
            sidebarItemsList.innerHTML = `<div style="padding:16px; font-size:0.8rem; color:var(--text-muted); text-align:center;">Configuración de vista unificada de servicios</div>`;
            await _loadMultiCrmList();
        }
    }

    // --- LÓGICA DE TABLAS ---
    async function _loadTablesList() {
        const listEl = document.getElementById('sidebar-items-list');
        listEl.innerHTML = typeof batLoaderHtml === 'function' ? batLoaderHtml({ text: 'Cargando...', size: 'sm' }) : `<div style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin"></i> Cargando...</div>`;

        try {
            const res = await fetch(`/api/backoffice/database/tables?token=${_token}`);
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            _tablesList = result.tables || [];
            
            if (_tablesList.length === 0) {
                listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">No hay tablas configuradas</div>`;
                return;
            }

            listEl.innerHTML = _tablesList.map(t => {
                const activeClass = _activeTable && _activeTable.tableName === t.tableName ? 'active' : '';
                return `
                    <div onclick="databaseView._selectActiveTable('${t.tableName}')" class="crm-chat-item ${activeClass}" style="padding:10px 12px; border-radius:10px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:all 0.2s;">
                        <div style="width:32px; height:32px; border-radius:8px; background:rgba(0,153,255,0.1); color:var(--accent); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i class="fas fa-table" style="font-size:0.9rem;"></i>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <h4 style="margin:0; font-size:0.85rem; font-weight:700; color:var(--text-main); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${_esc(t.sheetTitle)}</h4>
                            <span style="font-size:0.68rem; color:var(--text-muted);">Tabla: ${t.tableName}</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Auto-seleccionar la primera tabla si no hay ninguna seleccionada
            if (_tablesList.length > 0 && !_activeTable) {
                _selectActiveTable(_tablesList[0].tableName);
            }
        } catch (e) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#ef4444; font-size:0.8rem;">Fallo al cargar tablas</div>`;
        }
    }

    async function _selectActiveTable(tableName) {
        _activeTable = _tablesList.find(t => t.tableName === tableName);
        if (!_activeTable) return;

        // Render sidebar active state
        _loadTablesList();

        document.getElementById('active-table-name').innerText = _activeTable.sheetTitle;
        document.getElementById('active-table-sub').innerText = `Sheet ID: ${_activeTable.sheetId} | Tabla: ${_activeTable.tableName}`;
        document.getElementById('table-actions').style.display = 'flex';
        document.getElementById('btn-delete-selected').style.display = 'none';

        const wrapper = document.getElementById('table-table-wrapper');
        wrapper.innerHTML = typeof batLoaderHtml === 'function' ? batLoaderHtml('Cargando registros...') : `<div style="text-align:center; padding:60px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:10px;">Cargando registros...</p></div>`;

        try {
            const res = await fetch(`/api/backoffice/database/table/${_activeTable.tableName}?token=${_token}`);
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            _tableRows = result.data || [];
            _renderTableGrid();
        } catch (e) {
            console.error(e);
            wrapper.innerHTML = `<div style="text-align:center; padding:60px; color:#ef4444;"><i class="fas fa-triangle-exclamation fa-2x"></i><p style="margin-top:10px;">Error al cargar los datos de la tabla.</p></div>`;
        }
    }

    function _renderTableGrid() {
        const wrapper = document.getElementById('table-table-wrapper');
        if (!_activeTable) return;

        if (_tableRows.length === 0) {
            wrapper.innerHTML = `
                <div style="padding: 60px; text-align: center; color: var(--text-muted);">
                    <i class="fas fa-folder-open" style="font-size: 3rem; opacity: 0.3; margin-bottom: 16px;"></i>
                    <p>La tabla está vacía. Hacé click en "Agregar Fila" para crear el primer registro.</p>
                </div>
            `;
            return;
        }

        const headers = _activeTable.headers;
        const columns = headers.map(h => _activeTable.columnsMapping[h]);

        const headerHtml = `
            <th style="width: 40px; text-align: center;"><input type="checkbox" id="check-all-rows" onclick="databaseView._toggleSelectAllRows(this)" style="cursor:pointer;" /></th>
            ${headers.map(h => `<th style="padding: 12px 16px; text-align: left; font-weight: 700; border-bottom: 2px solid var(--card-border-color);">${_esc(h)}</th>`).join('')}
            <th style="width: 100px; text-align: center; border-bottom: 2px solid var(--card-border-color);">Acciones</th>
        `;

        const rowsHtml = _tableRows.map((row, idx) => {
            const cellsHtml = columns.map(col => {
                const val = row[col];
                return `<td style="padding: 12px 16px; border-bottom: 1px solid var(--card-border-color); font-size: 0.88rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${_esc(val)}</td>`;
            }).join('');

            return `
                <tr data-row-id="${row.id}">
                    <td style="text-align: center; border-bottom: 1px solid var(--card-border-color);"><input type="checkbox" class="row-checkbox" value="${row.id}" onclick="databaseView._onRowSelect()" style="cursor:pointer;" /></td>
                    ${cellsHtml}
                    <td style="text-align: center; border-bottom: 1px solid var(--card-border-color);">
                        <div style="display:flex; justify-content:center; gap:6px;">
                            <button onclick="databaseView._openRowModal('${row.id}')" class="btn-icon-wa" title="Editar fila" style="width:28px; height:28px; border-radius:6px; color:var(--accent); background:rgba(0,153,255,0.08);"><i class="fas fa-edit"></i></button>
                            <button onclick="databaseView._deleteSingleRow('${row.id}')" class="btn-icon-wa" title="Eliminar fila" style="width:28px; height:28px; border-radius:6px; color:#EF4444; background:rgba(239,68,68,0.08);"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        wrapper.innerHTML = `
            <table class="crm-table" style="width: 100%; border-collapse: collapse; background: var(--card-bg);">
                <thead>
                    <tr style="background: var(--bg-secondary);">${headerHtml}</tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
    }

    function _toggleSelectAllRows(masterCheckbox) {
        document.querySelectorAll('.row-checkbox').forEach(cb => {
            cb.checked = masterCheckbox.checked;
        });
        _onRowSelect();
    }

    function _onRowSelect() {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        const count = checked.length;
        const btnDeleteSelected = document.getElementById('btn-delete-selected');
        const deleteCount = document.getElementById('delete-selected-count');

        if (count > 0) {
            btnDeleteSelected.style.display = 'inline-block';
            deleteCount.innerText = count;
        } else {
            btnDeleteSelected.style.display = 'none';
        }
    }

    // MODAL ROW: ADD/EDIT
    let _editingRowId = null;

    function _openRowModal(rowId = null) {
        _editingRowId = rowId;
        const modal = document.getElementById('row-modal');
        const titleEl = document.getElementById('row-modal-title');
        const bodyEl = document.getElementById('row-modal-body');

        if (!_activeTable) return;

        titleEl.innerText = _editingRowId ? 'Editar Fila' : 'Agregar Fila';
        modal.style.display = 'flex';

        // Encontrar datos de fila si se está editando
        const rowData = _editingRowId ? _tableRows.find(r => r.id === _editingRowId) : {};

        // Inyectar controles dinámicos para cada columna
        bodyEl.innerHTML = _activeTable.headers.map(h => {
            const col = _activeTable.columnsMapping[h];
            const val = rowData[col] !== undefined ? rowData[col] : '';
            return `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <label style="font-weight:700; font-size:0.8rem; color:var(--text-main); text-transform:uppercase;">${_esc(h)}</label>
                    <input type="text" class="sw-input row-modal-input" data-col="${col}" value="${_esc(val)}" style="margin-bottom:0;" placeholder="Valor de ${h.toLowerCase()}" />
                </div>
            `;
        }).join('');
    }

    function _closeRowModal() {
        document.getElementById('row-modal').style.display = 'none';
        _editingRowId = null;
    }

    async function _saveRow() {
        if (!_activeTable) return;

        const loader = document.getElementById('workspace-loading');
        loader.style.display = 'flex';

        // 1. Recolectar datos
        const rowData = {};
        document.querySelectorAll('.row-modal-input').forEach(input => {
            const col = input.getAttribute('data-col');
            rowData[col] = input.value.trim();
        });

        try {
            const url = _editingRowId 
                ? `/api/backoffice/database/table/${_activeTable.tableName}/row/${_editingRowId}?token=${_token}`
                : `/api/backoffice/database/table/${_activeTable.tableName}/row?token=${_token}`;

            const method = _editingRowId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    row: rowData,
                    sheetId: _activeTable.sheetId,
                    sheetTitle: _activeTable.sheetTitle,
                    headers: _activeTable.headers
                })
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            showToast && showToast(_editingRowId ? 'Fila modificada' : 'Fila agregada', 'success');
            _closeRowModal();
            
            // Recargar datos actualizados de la tabla
            await _selectActiveTable(_activeTable.tableName);
        } catch (e) {
            console.error(e);
            showToast && showToast('Error al guardar cambios', 'error');
        } finally {
            loader.style.display = 'none';
        }
    }

    // ELIMINAR INDIVIDUAL
    async function _deleteSingleRow(rowId) {
        if (!confirm('¿Estás seguro de que deseas eliminar esta fila?')) return;
        await _deleteRowsAPI([rowId]);
    }

    // ELIMINAR SELECCIONADOS (MASIVA)
    async function _deleteSelectedRows() {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        const ids = Array.from(checked).map(cb => cb.value);
        if (ids.length === 0) return;

        if (!confirm(`¿Estás seguro de que deseas eliminar las ${ids.length} filas seleccionadas?`)) return;
        await _deleteRowsAPI(ids);
    }

    async function _deleteRowsAPI(ids) {
        if (!_activeTable) return;

        const loader = document.getElementById('workspace-loading');
        loader.style.display = 'flex';

        try {
            const res = await fetch(`/api/backoffice/database/table/${_activeTable.tableName}/rows?token=${_token}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids,
                    sheetId: _activeTable.sheetId,
                    sheetTitle: _activeTable.sheetTitle,
                    headers: _activeTable.headers
                })
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            showToast && showToast(ids.length > 1 ? 'Filas eliminadas' : 'Fila eliminada', 'success');
            await _selectActiveTable(_activeTable.tableName);
        } catch (e) {
            console.error(e);
            showToast && showToast('Error al eliminar fila(s)', 'error');
        } finally {
            loader.style.display = 'none';
        }
    }


    // --- LÓGICA DE RAG ---
    async function _loadDocsList() {
        const listEl = document.getElementById('sidebar-items-list');
        listEl.innerHTML = typeof batLoaderHtml === 'function' ? batLoaderHtml({ text: 'Cargando...', size: 'sm' }) : `<div style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin"></i> Cargando...</div>`;

        try {
            const res = await fetch(`/api/backoffice/database/rag?token=${_token}`);
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            _docsList = result.docs || [];
            
            if (_docsList.length === 0) {
                listEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">No hay documentos RAG configurados</div>`;
                return;
            }

            listEl.innerHTML = _docsList.map(d => {
                const activeClass = _activeDoc && _activeDoc.docId === d.docId ? 'active' : '';
                return `
                    <div onclick="databaseView._selectActiveDoc('${d.docId}')" class="crm-chat-item ${activeClass}" style="padding:10px 12px; border-radius:10px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:all 0.2s;">
                        <div style="width:32px; height:32px; border-radius:8px; background:rgba(168,85,247,0.1); color:rgba(168,85,247,1); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i class="fas fa-brain" style="font-size:0.9rem;"></i>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <h4 style="margin:0; font-size:0.85rem; font-weight:700; color:var(--text-main); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${_esc(d.docName)}</h4>
                            <span style="font-size:0.68rem; color:var(--text-muted);">Doc ID: ${d.docId.substring(0, 8)}...</span>
                        </div>
                    </div>
                `;
            }).join('');

            // Auto-seleccionar la primera tabla si no hay ninguna seleccionada
            if (_docsList.length > 0 && !_activeDoc) {
                _selectActiveDoc(_docsList[0].docId);
            }
        } catch (e) {
            listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#ef4444; font-size:0.8rem;">Fallo al cargar documentos</div>`;
        }
    }

    async function _selectActiveDoc(docId) {
        _activeDoc = _docsList.find(d => d.docId === docId);
        if (!_activeDoc) return;

        // Render sidebar active state
        _loadDocsList();

        document.getElementById('active-doc-name').innerText = _activeDoc.docName;
        document.getElementById('active-doc-sub').innerText = `Google Drive ID: ${_activeDoc.docId}`;
        
        const editor = document.getElementById('rag-text-editor');
        editor.value = 'Descargando contenido del documento desde Google Drive...';
        editor.disabled = true;
        
        document.getElementById('btn-save-doc').style.display = 'none';

        try {
            const res = await fetch(`/api/backoffice/database/rag/${_activeDoc.docId}?token=${_token}`);
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            _docText = result.text || '';
            editor.value = _docText;
            editor.disabled = false;
            document.getElementById('btn-save-doc').style.display = 'inline-block';
        } catch (e) {
            console.error(e);
            editor.value = 'Error al descargar el contenido desde Google Drive. Asegurate de que el ID sea correcto y que el token de Google tenga los permisos necesarios.';
        }
    }

    async function _saveDocText() {
        if (!_activeDoc) return;

        const loader = document.getElementById('workspace-loading');
        loader.style.display = 'flex';

        const newText = document.getElementById('rag-text-editor').value;

        try {
            const res = await fetch(`/api/backoffice/database/rag/${_activeDoc.docId}?token=${_token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: newText
                })
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            showToast && showToast('Documento guardado y RAG re-indexando', 'success');
            _docText = newText;
        } catch (e) {
            console.error(e);
            showToast && showToast('Error al guardar el documento', 'error');
        } finally {
            loader.style.display = 'none';
        }
    }


    async function _loadMultiCrmList() {
        const container = document.getElementById('multicrm-services-list');
        container.innerHTML = typeof batLoaderHtml === 'function' ? `<div style="grid-column:1/-1;">${batLoaderHtml('Cargando servicios del proyecto...')}</div>` : `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:10px;">Cargando servicios del proyecto...</p></div>`;
        
        try {
            const servicesRes = await fetch(`/api/backoffice/project-services?token=${_token}`);
            const servicesData = await servicesRes.json();
            if (!servicesData.success) throw new Error(servicesData.error);
            _allServicesList = servicesData.services || [];

            const settingsRes = await fetch(`/api/backoffice/settings?token=${_token}`);
            const settingsData = await settingsRes.json();
            
            const visibleServicesStr = settingsData.SUPER_ADMIN_VISIBLE_SERVICES || '';
            const visibleServicesList = visibleServicesStr.split(',').map((s) => s.trim()).filter(Boolean);
            _visibleServicesSet = new Set(visibleServicesList);

            container.innerHTML = _allServicesList.map((service) => {
                const isChecked = _visibleServicesSet.has(service.id) ? 'checked' : '';
                return `
                    <div style="background: var(--bg-secondary); border: 1px solid var(--card-border-color); border-radius: 12px; padding: 16px; display: flex; align-items: flex-start; gap: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.02); text-align: left;">
                        <label class="switch" style="flex-shrink: 0; margin-top: 4px;">
                            <input type="checkbox" onchange="databaseView._toggleServiceVisibility('${service.id}', this.checked)" ${isChecked}>
                            <span class="slider"><i class="fas fa-times"></i><i class="fas fa-check"></i></span>
                        </label>
                        <div style="flex:1; min-width:0;">
                            <h4 style="margin:0; font-size:0.9rem; font-weight:700; color:var(--text-main); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${_esc(service.name)}</h4>
                            <p style="margin:4px 0 0; font-size:0.75rem; color:var(--text-muted); font-family:monospace;">ID: ${service.id}</p>
                            ${service.phone ? `<p style="margin:2px 0 0; font-size:0.75rem; color:var(--text-muted);"><i class="fab fa-whatsapp" style="color:#25d366;"></i> ${service.phone}</p>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            console.error(e);
            container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#ef4444;"><i class="fas fa-triangle-exclamation fa-2x"></i><p style="margin-top:10px;">Error al cargar configuración de Multi-CRM.</p></div>`;
        }
    }

    function _toggleServiceVisibility(serviceId, isChecked) {
        if (isChecked) {
            _visibleServicesSet.add(serviceId);
        } else {
            _visibleServicesSet.delete(serviceId);
        }
    }

    async function _saveMultiCrmConfig() {
        const loader = document.getElementById('workspace-loading');
        if (loader) loader.style.display = 'flex';

        const visibleStr = Array.from(_visibleServicesSet).join(',');

        try {
            const res = await fetch(`/api/backoffice/save-setting?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: 'SUPER_ADMIN_VISIBLE_SERVICES',
                    value: visibleStr
                })
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            showToast && showToast('Configuración Multi-CRM guardada con éxito', 'success');
        } catch (e) {
            console.error(e);
            showToast && showToast('Error al guardar configuración', 'error');
        } finally {
            if (loader) loader.style.display = 'none';
        }
    }

    // UTILS
    function _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function destroy() {
        _activeTable = null;
        _activeDoc = null;
    }

    return {
        title: 'Base de Datos y RAG',
        getHTML,
        init,
        destroy,
        _switchTab,
        _selectActiveTable,
        _openRowModal,
        _closeRowModal,
        _saveRow,
        _deleteSingleRow,
        _deleteSelectedRows,
        _toggleSelectAllRows,
        _onRowSelect,
        _selectActiveDoc,
        _saveDocText,
        _toggleServiceVisibility,
        _saveMultiCrmConfig
    };
})();
