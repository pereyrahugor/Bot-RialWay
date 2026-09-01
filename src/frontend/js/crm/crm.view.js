/* global loadViewScript, Sortable */
window.crmView = {
    title: 'CRM - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        const crmModals = _getCRMModals();
        return `
        <div class="crm-main-container kanban-wrapper relative" data-crm-view="crm" style="z-index:10;">
            ${window.renderSectionTabs ? window.renderSectionTabs('integrations') : ''}

            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-layer-group kanban-header-icon"></i> CRM</h1>
                    <p>Gestiona oportunidades, clientes y seguimiento.</p>
                </div>
                <div class="header-actions">
                    <div class="crm-subview-switch" role="tablist" aria-label="Vistas CRM">
                        <button type="button" class="crm-subview-btn active" onclick="window.navigate('/crm')" role="tab" aria-selected="true">
                            <span>CRM</span>
                            <span class="nav-dot crm-subview-badge" data-dot-sync="dot-crm-leads" style="display:none;" aria-hidden="true"></span>
                        </button>
                        <button type="button" class="crm-subview-btn" onclick="window.navigate('/crm-tareas')" role="tab" aria-selected="false">
                            <span>Ver tareas</span>
                            <span class="nav-dot crm-subview-badge" data-dot-sync="dot-tareas" style="display:none;" aria-hidden="true"></span>
                        </button>
                    </div>
                    <button class="btn btn-primary" onclick="window.openNewLeadModal()">
                        <i class="fas fa-plus"></i> Crear Lead
                    </button>
                    <div class="header-more-menu">
                        <button class="btn-icon-round" onclick="_toggleCRMMenu(event)" aria-label="Mas opciones">
                            <i class="fas fa-ellipsis-vertical"></i>
                        </button>
                        <ul class="header-dropdown" id="crm-more-dropdown">
                            <li onclick="_closeCRMMenu(); addNewColumn()">
                                <i class="fas fa-plus"></i> Nuevo Estado
                            </li>
                            <li onclick="_closeCRMMenu(); openClosedLeadsModal()">
                                <i class="fas fa-box-archive"></i> Leads Cerrados
                            </li>
                            <li onclick="_closeCRMMenu(); toggleCRMConfigModal()">
                                <i class="fas fa-sliders"></i> Campos
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <!-- Toolbar compacta CRM -->
            <div class="crm-filter-bar crm-filter-bar-compact animate-fade">
                <div class="crm-toolbar-filter-wrap">
                    <button class="btn-secondary btn-sm crm-toolbar-filter-btn" onclick="window.toggleCRMFiltersDropdown()" title="Abrir filtros" aria-expanded="false" aria-controls="crm-filters-dropdown">
                        <i class="fas fa-filter"></i> Filtros
                    </button>
                    <div id="crm-filters-dropdown" class="crm-filters-dropdown">
                        <div class="crm-filter-dropdown-grid">
                            <div class="modal-section">
                                <label><i class="fas fa-tag"></i> Etiqueta</label>
                                <select id="crm-filter-tag" class="crm-input" onchange="window.applyCRMFilters()">
                                    <option value="">Todas las etiquetas</option>
                                </select>
                            </div>
                            <div class="modal-section">
                                <label><i class="fas fa-calendar-alt"></i> Desde</label>
                                <input type="date" id="crm-filter-date-from" class="crm-input" onchange="window.applyCRMFilters()">
                            </div>
                            <div class="modal-section">
                                <label><i class="fas fa-calendar-alt"></i> Hasta</label>
                                <input type="date" id="crm-filter-date-to" class="crm-input" onchange="window.applyCRMFilters()">
                            </div>
                        </div>
                        <div class="crm-filter-dropdown-actions">
                            <button type="button" class="btn-secondary btn-sm" onclick="window.clearCRMFilters()"><i class="fas fa-undo"></i> Limpiar</button>
                            <button type="button" class="btn btn-primary btn-sm" onclick="window.closeCRMFiltersDropdown()"><i class="fas fa-check"></i> Aplicar</button>
                        </div>
                    </div>
                </div>
                <div class="crm-filter-actions crm-filter-actions-compact">
                    <button class="btn-danger btn-sm crm-filter-danger" onclick="window.openBulkDeleteLeadsModal()">
                        <i class="fas fa-trash-alt"></i> Eliminar
                    </button>
                    <span id="crm-filtered-count-badge" class="crm-filtered-badge">
                        Mostrando todos los leads
                    </span>
                </div>
            </div>
            <div id="kanban-board" class="kanban-scroll-area">
                <div class="kanban-board-inner" id="kanban-board-inner">
                    ${window.renderCRMSkeletonHTML ? window.renderCRMSkeletonHTML('crm') : ''}
                </div>
            </div>
        </div>
        ${crmModals}`;
    },

    async init() {
        if (typeof Sortable === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js');
        }
        await loadViewScript('/js/crm/crm-common.js');
        await loadViewScript('/js/crm/crm.js');
        if (typeof window.initCRMView === 'function') await window.initCRMView();
    },

    destroy() {
        if (typeof window.destroyCRM === 'function') {
            window.destroyCRM();
        }
    }
};

window._toggleCRMMenu = function(e) {
    e.stopPropagation();
    const d = document.getElementById('crm-more-dropdown');
    if (!d) return;
    const isOpen = d.classList.toggle('open');
    if (isOpen) document.addEventListener('click', window._closeCRMMenu, { once: true });
};

window._closeCRMMenu = function() {
    const d = document.getElementById('crm-more-dropdown');
    if (d) d.classList.remove('open');
};

window.renderCRMSkeletonHTML = window.renderCRMSkeletonHTML || function(type = 'crm') {
    const cols = type === 'tareas'
        ? [
            { id: 'overdue', icon: 'fa-calendar-times', color: '#ef4444', title: 'Vencidas' },
            { id: 'today', icon: 'fa-calendar-day', color: '#f59e0b', title: 'Hoy' },
            { id: 'tomorrow', icon: 'fa-calendar-minus', color: '#3b82f6', title: 'Manana' },
            { id: 'week', icon: 'fa-calendar-week', color: '#10b981', title: 'Esta Semana' },
            { id: 'later', icon: 'fa-calendar-plus', color: '#8b5cf6', title: 'Mas Adelante' },
            { id: 'nodate', icon: 'fa-calendar-xmark', color: '#6b7280', title: 'Sin Fecha' },
        ]
        : [
            { id: 'UNASSIGNED', icon: 'fa-star', color: '#f59e0b', title: 'Leads Nuevos' },
            { id: 'contactado', title: 'Contactado' },
            { id: 'negociacion', title: 'En Negociacion' },
            { id: 'propuesta', title: 'Propuesta Enviada' },
            { id: 'cierre', title: 'Cierre' },
        ];
    return cols.map((col) => {
        const savedWidth = col.id ? localStorage.getItem('col_width_' + col.id) : '';
        const widthStyle = savedWidth ? ` style="width:${savedWidth};"` : '';
        const titleContent = type === 'crm'
            ? '<span class="crm-skeleton-line crm-skeleton-column-title"></span>'
            : `<span class="column-title">${col.title}</span>`;
        return `
        <div class="kanban-column-wrapper crm-skeleton-column-wrapper" data-id="${col.id || ''}"${widthStyle}>
            <div class="kanban-column crm-skeleton-column" data-id="${col.id || ''}">
                <div class="column-header">
                    <div class="column-title-group">
                        ${col.icon ? `<i class="fas ${col.icon}" style="color:${col.color}; flex-shrink:0;"></i>` : ''}
                        ${titleContent}
                    </div>
                    <span class="column-badge skeleton-badge"></span>
                </div>
                <div class="kanban-cards crm-skeleton-cards">
                    ${Array.from({ length: 2 }).map(() => `
                        <div class="kanban-card crm-skeleton-card">
                            <div class="crm-skeleton-line crm-skeleton-ref"></div>
                            <div class="crm-skeleton-pill"></div>
                            <div class="crm-skeleton-line crm-skeleton-title"></div>
                            <div class="crm-skeleton-line crm-skeleton-phone"></div>
                            <div class="crm-skeleton-footer">
                                <div class="crm-skeleton-button"></div>
                                <div class="crm-skeleton-icon"></div>
                                <div class="crm-skeleton-icon"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    }).join('');
};

// Modales compartidos entre crm.view.js y crm-tareas.view.js
function _getCRMModals() {
    return `
    <!-- Modal Eliminacion Selectiva CRM -->
    <div id="crm-bulk-delete-modal" class="modal-overlay">
        <div class="modal-content modal-content-md animate-pop-in">
            <div class="modal-header-top">
                <div>
                    <h3><i class="fas fa-trash-alt modal-h3-icon danger"></i> Eliminar leads</h3>
                    <p>Selecciona los leads visibles que queres eliminar.</p>
                </div>
                <button class="btn-close-modal" onclick="window.closeBulkDeleteLeadsModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="crm-bulk-filter-panel">
                    <div class="crm-bulk-filter-grid">
                        <div class="modal-section">
                            <label><i class="fas fa-tag"></i> Etiqueta</label>
                            <select id="crm-bulk-filter-tag" class="crm-input" onchange="window.applyBulkDeleteFilters()">
                                <option value="">Todas las etiquetas</option>
                            </select>
                        </div>
                        <div class="modal-section">
                            <label><i class="fas fa-calendar-alt"></i> Desde</label>
                            <input type="date" id="crm-bulk-filter-date-from" class="crm-input" onchange="window.applyBulkDeleteFilters()">
                        </div>
                        <div class="modal-section">
                            <label><i class="fas fa-calendar-alt"></i> Hasta</label>
                            <input type="date" id="crm-bulk-filter-date-to" class="crm-input" onchange="window.applyBulkDeleteFilters()">
                        </div>
                    </div>
                    <button type="button" class="btn-secondary btn-sm" onclick="window.clearBulkDeleteFilters()"><i class="fas fa-undo"></i> Limpiar filtros</button>
                </div>
                <div class="crm-bulk-delete-toolbar">
                    <label class="crm-bulk-select-all">
                        <input type="checkbox" id="crm-bulk-delete-select-all" onchange="window.toggleBulkDeleteSelectAll(this.checked)">
                        <span>Seleccionar todos</span>
                    </label>
                    <span id="crm-bulk-delete-count" class="crm-bulk-delete-count">0 seleccionados</span>
                </div>
                <div id="crm-bulk-delete-list" class="crm-bulk-delete-list"></div>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn-secondary" onclick="window.closeBulkDeleteLeadsModal()">Cancelar</button>
                <button type="button" class="btn-danger" onclick="window.confirmBulkDeleteSelectedLeads()"><i class="fas fa-trash-alt"></i> Eliminar seleccionados</button>
            </div>
        </div>
    </div>
    <!-- Modal Editar Lead -->
    <div id="card-modal" class="modal-overlay">
        <div class="modal-content modal-content-md animate-pop-in">
            <div class="modal-header-top">
                <div>
                    <h3><i class="fas fa-clipboard-list modal-h3-icon"></i> Detalle del Lead</h3>
                    <div id="modal-ticket-ref"></div>
                </div>
                <button class="btn-close-modal" onclick="closeCardModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <form id="card-edit-form">
                    <input type="hidden" id="edit-lead-id">
                    <div id="crm-fields-container">
                        <div class="modal-section" data-field="crm-ticket-title">
                            <label><i class="fas fa-envelope-open-text"></i> Titulo del Ticket</label>
                            <input type="text" id="edit-ticket-title" class="crm-input" placeholder="Ej: Consulta por preventa">
                        </div>
                        <div class="modal-section" data-field="crm-name">
                            <label><i class="fas fa-user"></i> Nombre</label>
                            <input type="text" id="edit-lead-name" class="crm-input" placeholder="Nombre...">
                        </div>
                        <div class="modal-section" data-field="crm-last-name">
                            <label><i class="fas fa-user-tag"></i> Apellido</label>
                            <input type="text" id="edit-lead-last-name" class="crm-input" placeholder="Apellido...">
                        </div>
                        <div class="modal-section" data-field="crm-phone">
                            <label><i class="fas fa-phone"></i> Telefono</label>
                            <div class="phone-input-wrap">
                                <input type="text" id="edit-lead-phone" class="crm-input" readonly>
                                <button type="button" class="phone-wa-btn" onclick="openWhatsAppDirect()">
                                    <i class="fab fa-whatsapp"></i>
                                </button>
                            </div>
                        </div>
                        <div class="modal-section" data-field="crm-cuit">
                            <label><i class="fas fa-id-card"></i> Cuil / Cuit / DNI</label>
                            <input type="text" id="edit-lead-cuit" class="crm-input" placeholder="00-00000000-0" onblur="checkAndFetchSharedNotes && checkAndFetchSharedNotes()">
                        </div>
                        <div class="modal-section" data-field="crm-company">
                            <label><i class="fas fa-building"></i> Empresa / Razon Social</label>
                            <input type="text" id="edit-lead-company" class="crm-input" placeholder="Nombre de la empresa..." onblur="checkAndFetchSharedNotes && checkAndFetchSharedNotes()">
                        </div>
                        <div class="modal-section" data-field="crm-email">
                            <label><i class="fas fa-envelope"></i> Email</label>
                            <input type="email" id="edit-lead-email" class="crm-input" placeholder="email@ejemplo.com">
                        </div>
                        <div class="modal-section" data-field="crm-address">
                            <label><i class="fas fa-map-marker-alt"></i> Domicilio / Direccion</label>
                            <input type="text" id="edit-lead-address" class="crm-input" placeholder="Calle y altura...">
                        </div>
                        <div class="modal-section" data-field="crm-city">
                            <label><i class="fas fa-city"></i> Localidad</label>
                            <input type="text" id="edit-lead-city" class="crm-input" placeholder="Localidad / Ciudad...">
                        </div>
                        <div class="modal-section" data-field="crm-province">
                            <label><i class="fas fa-map"></i> Provincia</label>
                            <input type="text" id="edit-lead-province" class="crm-input" placeholder="Provincia...">
                        </div>
                        <div class="modal-section" data-field="crm-transport">
                            <label><i class="fas fa-truck"></i> Transporte / Logistica</label>
                            <input type="text" id="edit-lead-transport" class="crm-input" placeholder="Expreso o transporte asignado...">
                        </div>
                        <div class="modal-section" data-field="crm-tax-status">
                            <label><i class="fas fa-file-invoice-dollar"></i> Situacion Impositiva</label>
                            <div class="csd-wrap">
                                <select id="edit-lead-tax-status" hidden>
                                    <option value="Cons. Final">Cons. Final</option>
                                    <option value="Responsable Inscripto">Responsable Inscripto</option>
                                    <option value="Monotributo">Monotributo</option>
                                    <option value="Exento">Exento</option>
                                </select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">Cons. Final</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu">
                                    <button class="csd-item selected" type="button" data-val="Cons. Final" onclick="_csdSelect(this,'Cons. Final')">Cons. Final</button>
                                    <button class="csd-item" type="button" data-val="Responsable Inscripto" onclick="_csdSelect(this,'Responsable Inscripto')">Responsable Inscripto</button>
                                    <button class="csd-item" type="button" data-val="Monotributo" onclick="_csdSelect(this,'Monotributo')">Monotributo</button>
                                    <button class="csd-item" type="button" data-val="Exento" onclick="_csdSelect(this,'Exento')">Exento</button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-section" data-field="crm-product">
                            <label><i class="fas fa-shopping-bag"></i> Producto Ofrecido</label>
                            <input type="text" id="edit-lead-offered-product" class="crm-input" placeholder="Servicio/Producto...">
                        </div>
                        <div class="modal-section" data-field="crm-source">
                            <label><i class="fas fa-bullhorn"></i> Fuente / Canal</label>
                            <div class="csd-wrap">
                                <select id="edit-lead-source" hidden>
                                    <option value="">Desconocida</option>
                                    <option value="Instagram">Instagram</option>
                                    <option value="Facebook">Facebook</option>
                                    <option value="WhatsApp">WhatsApp</option>
                                    <option value="Web">Web</option>
                                    <option value="Referido">Referido</option>
                                    <option value="Manual CRM">Manual CRM</option>
                                </select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">Desconocida</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu">
                                    <button class="csd-item selected" type="button" data-val="" onclick="_csdSelect(this,'')">Desconocida</button>
                                    <button class="csd-item" type="button" data-val="Instagram" onclick="_csdSelect(this,'Instagram')">Instagram</button>
                                    <button class="csd-item" type="button" data-val="Facebook" onclick="_csdSelect(this,'Facebook')">Facebook</button>
                                    <button class="csd-item" type="button" data-val="WhatsApp" onclick="_csdSelect(this,'WhatsApp')">WhatsApp</button>
                                    <button class="csd-item" type="button" data-val="Web" onclick="_csdSelect(this,'Web')">Web</button>
                                    <button class="csd-item" type="button" data-val="Referido" onclick="_csdSelect(this,'Referido')">Referido</button>
                                    <button class="csd-item" type="button" data-val="Manual CRM" onclick="_csdSelect(this,'Manual CRM')">Manual CRM</button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-section" data-field="crm-notes" style="grid-column: 1 / -1; width: 100%;">
                            <label><i class="fas fa-sticky-note"></i> Notas 1 (Locales de este chat)</label>
                            <textarea id="edit-custom-notes" class="crm-input" rows="3" style="width: 100%; min-height: 80px; resize: vertical; box-sizing: border-box;" placeholder="Observaciones locales de esta conversación..."></textarea>
                        </div>
                        <div class="modal-section" data-field="crm-shared-notes" style="background:rgba(56, 189, 248, 0.05); padding:12px; border-radius:12px; border:1px solid rgba(56, 189, 248, 0.25); grid-column: 1 / -1; width: 100%; box-sizing: border-box;">
                            <label style="color:var(--accent-bright, #38bdf8); display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
                                <span><i class="fas fa-network-wired"></i> Notas 2 (Compartidas de Empresa - Multi-CRM)</span>
                                <span id="shared-notes-indicator" style="font-size:0.75rem; font-weight:normal; opacity:0.85;">Vinculadas por CUIT/Empresa</span>
                            </label>
                            <textarea id="edit-company-shared-notes" class="crm-input" rows="3" style="width: 100%; min-height: 80px; resize: vertical; box-sizing: border-box;" placeholder="Notas corporativas compartidas entre todos los CRM vinculados por CUIT o Empresa..."></textarea>
                        </div>
                        <div class="modal-section" data-field="crm-due-date">
                            <label><i class="fas fa-bell"></i> Fecha Alerta / Seguimiento</label>
                            <input type="date" id="edit-alert-date" class="crm-input">
                        </div>
                        <div class="modal-section" data-field="crm-priority">
                            <label><i class="fas fa-tag"></i> Prioridad</label>
                            <div class="csd-wrap">
                                <select id="edit-priority" hidden>
                                    <option value="Baja">Baja</option>
                                    <option value="Media" selected>Media</option>
                                    <option value="Alta">Alta</option>
                                </select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">Media</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu">
                                    <button class="csd-item" type="button" data-val="Baja" onclick="_csdSelect(this,'Baja')">Baja</button>
                                    <button class="csd-item selected" type="button" data-val="Media" onclick="_csdSelect(this,'Media')">Media</button>
                                    <button class="csd-item" type="button" data-val="Alta" onclick="_csdSelect(this,'Alta')">Alta</button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-section" data-field="crm-status">
                            <label><i class="fas fa-tasks"></i> Estado del Lead (CRM)</label>
                            <div class="csd-wrap">
                                <select id="edit-lead-status" hidden onchange="syncStatusToColumn && syncStatusToColumn(this.value)"></select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">Sin Asignar</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu"></div>
                            </div>
                        </div>
                    </div>
                    <div id="additional-notes-list"></div>
                    <button type="button" class="btn-add-note" onclick="addNewNoteUI()">
                        <i class="fas fa-plus-circle"></i> Agregar Nota con Fecha
                    </button>
                    <div id="alert-status-info"></div>
                    <div id="assignee-section" class="modal-section">
                        <label><i class="fas fa-user-tag assignee-icon"></i> Asignar Lead a:</label>
                        <div class="csd-wrap">
                            <select id="edit-lead-assignee" hidden>
                                <option value="">Sin asignar (Libre)</option>
                            </select>
                            <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label">Sin asignar (Libre)</span>
                                <i class="fas fa-chevron-down csd-chevron"></i>
                            </button>
                            <div class="csd-menu">
                                <button class="csd-item selected" type="button" data-val="" onclick="_csdSelect(this,'')">Sin asignar (Libre)</button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-tags-section">
                        <h4 class="modal-tags-title"><i class="fas fa-tags modal-tags-icon"></i> Etiquetas</h4>
                        <div id="current-lead-tags"></div>
                        <div class="tag-mgmt-box">
                            <h5 class="tag-mgmt-title">Gestionar Etiquetas</h5>
                            <div id="available-tags-to-assign"></div>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-success btn-save-lead">
                        <i class="fas fa-save btn-save-icon"></i> Guardar y Sincronizar
                    </button>
                </form>
            </div>
        </div>
    </div>

    <!-- Modal Editar Nombre Columna -->
    <div id="column-modal" class="modal-overlay">
        <div class="modal-content modal-content-sm animate-pop-in">
            <div class="modal-header">
                <h3 class="flex items-center gap-2">
                    <i class="fas fa-pen text-accent-bright text-sm"></i> Editar Estado
                </h3>
                <button class="btn-close-modal" onclick="closeColumnModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <input type="text" id="column-name-input" class="crm-input mb-4" placeholder="Nombre del estado...">
                <div class="modal-action-row">
                    <button class="btn btn-danger btn-flex-1" onclick="deleteCurrentColumn()" id="btn-delete-col">
                        <i class="fas fa-trash-alt"></i> Eliminar
                    </button>
                    <button class="btn btn-success btn-flex-2" onclick="saveColumnName()">
                        <i class="fas fa-check"></i> Guardar
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Modal Leads Cerrados -->
    <div id="closed-leads-modal" class="modal-overlay">
        <div class="modal-content modal-content-lg animate-pop-in">
            <div class="modal-header">
                <h3><i class="fas fa-check-double modal-h3-icon"></i> Historico de Leads Cerrados</h3>
                <button class="btn-close-modal" onclick="closeClosedLeadsModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div id="closed-leads-list" class="closed-list-container"></div>
            </div>
        </div>
    </div>

    <!-- Modal Crear Nuevo Lead -->
    <div id="new-lead-modal" class="modal-overlay">
        <div class="modal-content modal-content-sm-plus animate-pop-in">
            <div class="modal-header">
                <h3><i class="fas fa-user-plus modal-h3-icon"></i> Crear Nuevo Lead</h3>
                <button class="btn-close-modal" onclick="closeNewLeadModal()"><i class="fas fa-times"></i></button>
            </div>
            <form id="new-lead-form">
                <div class="modal-body">
                    <div class="modal-section">
                        <label><i class="fas fa-phone"></i> Telefono / ID (WhatsApp)</label>
                        <input type="text" id="new-lead-id" class="crm-input" placeholder="Ej: 54911..." required>
                    </div>
                    <div class="modal-section">
                        <label><i class="fas fa-user"></i> Nombre Completo / Razon Social</label>
                        <input type="text" id="new-lead-name" class="crm-input" placeholder="Ej: Juan Perez" required>
                    </div>
                    <div class="modal-section">
                        <label><i class="fas fa-shopping-bag"></i> Producto Ofrecido</label>
                        <input type="text" id="new-lead-product" class="crm-input" placeholder="Seguro, Plan, etc...">
                    </div>
                </div>
                <div class="form-actions-row">
                    <button type="button" class="btn btn-secondary btn-flex-1" onclick="closeNewLeadModal()">Cancelar</button>
                    <button type="submit" class="btn btn-primary btn-flex-2">
                        <i class="fas fa-plus"></i> Crear Card
                    </button>
                </div>
            </form>
        </div>
    </div>

    <!-- Modal Configuracion CRM -->
    <div id="crm-config-modal" class="modal-overlay">
        <div class="modal-content modal-content-md animate-pop-in">
            <div class="modal-header">
                <h3 class="modal-config-title"><i class="fas fa-cog modal-h3-icon"></i> Configuracion de Campos CRM</h3>
                <button class="btn-icon" onclick="toggleCRMConfigModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <p class="modal-config-desc">
                    Arrasta los campos para cambiar su orden. Marca o desmarca para mostrar u ocultar.
                </p>
                <div id="crm-fields-list" class="sortable-list"></div>
                <div class="modal-config-actions">
                    <button class="btn btn-success btn-flex-1" onclick="saveCRMConfig()">
                        <i class="fas fa-save"></i> Guardar Configuracion
                    </button>
                    <button class="btn btn-secondary" onclick="toggleCRMConfigModal()">Cancelar</button>
                </div>
            </div>
        </div>
    </div>`;
}
window._getCRMModals = _getCRMModals;
