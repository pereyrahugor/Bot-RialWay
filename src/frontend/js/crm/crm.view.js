/* global loadViewScript, Sortable */
window.crmView = {
    title: 'CRM - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        const crmModals = _getCRMModals();
        return `
        <div class="crm-main-container kanban-wrapper relative" style="z-index:10;">

            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-layer-group kanban-header-icon"></i> CRM ${window.BOT_NAME || ''}</h1>
                    <p>Gestion visual de oportunidades y seguimiento de clientes.</p>
                </div>
                <div class="header-actions">
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

            <div id="kanban-board" class="kanban-scroll-area">
                <div class="kanban-board-inner" id="kanban-board-inner"></div>
            </div>
        </div>
        ${crmModals}`;
    },

    async init() {
        if (typeof Sortable === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js');
        }
        await loadViewScript('/js/crm/crm.js?v=4');
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

// Modales compartidos entre crm.view.js y crm-tareas.view.js
function _getCRMModals() {
    return `
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
                            <label><i class="fas fa-user"></i> Nombre / Razon Social</label>
                            <input type="text" id="edit-lead-name" class="crm-input" placeholder="Nombre completo...">
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
                            <input type="text" id="edit-lead-cuit" class="crm-input" placeholder="00-00000000-0">
                        </div>
                        <div class="modal-section" data-field="crm-email">
                            <label><i class="fas fa-envelope"></i> Email</label>
                            <input type="email" id="edit-lead-email" class="crm-input" placeholder="email@ejemplo.com">
                        </div>
                        <div class="modal-section" data-field="crm-address">
                            <label><i class="fas fa-map-marker-alt"></i> Domicilio</label>
                            <input type="text" id="edit-lead-address" class="crm-input" placeholder="Calle, Nro, Localidad...">
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
                        <div class="modal-section" data-field="crm-notes">
                            <label><i class="fas fa-sticky-note"></i> Historial de Notas / Comentarios</label>
                            <textarea id="edit-custom-notes" class="crm-input" rows="4" placeholder="Observaciones generales..."></textarea>
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
                    <button type="submit" class="btn btn-primary btn-save-lead">
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
                    <button class="btn btn-primary btn-flex-2" onclick="saveColumnName()">
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
                    <button class="btn btn-primary btn-flex-1" onclick="saveCRMConfig()">
                        <i class="fas fa-save"></i> Guardar Configuracion
                    </button>
                    <button class="btn btn-secondary" onclick="toggleCRMConfigModal()">Cancelar</button>
                </div>
            </div>
        </div>
    </div>`;
}
window._getCRMModals = _getCRMModals;
