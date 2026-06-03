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
                    <button class="btn btn-primary" onclick="addNewColumn()">
                        <i class="fas fa-plus"></i> Nuevo Estado
                    </button>
                    <button class="btn btn-primary" onclick="openClosedLeadsModal()">
                        <i class="fas fa-archive"></i> Leads Cerrados
                    </button>
                    <button id="btn-new-user" class="btn btn-primary" onclick="window.openNewUserModal()">
                        <i class="fas fa-users"></i> Nuevo Usuario
                    </button>
                    <button class="btn btn-primary" onclick="toggleCRMConfigModal()">
                        <i class="fas fa-cog"></i> Configurar Campos
                    </button>
                    <button class="btn btn-primary" onclick="window.openNewLeadModal()">
                        <i class="fas fa-plus-circle"></i> Crear Lead Card
                    </button>
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
        await loadViewScript('/js/crm.js?v=2');
        if (typeof window.initCRMView === 'function') await window.initCRMView();
    },

    destroy() {}
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
                        <div class="modal-grid">
                            <div class="modal-section" data-field="crm-name">
                                <label><i class="fas fa-user"></i> Nombre Completo / Razon Social</label>
                                <input type="text" id="edit-lead-name" class="crm-input" placeholder="Nombre completo...">
                            </div>
                            <div class="modal-section" data-field="crm-phone">
                                <label><i class="fas fa-phone"></i> Telefono</label>
                                <div class="input-with-action">
                                    <input type="text" id="edit-lead-phone" class="crm-input" readonly>
                                    <button type="button" class="btn-action btn-action-primary" onclick="openWhatsAppDirect()">
                                        <i class="fab fa-whatsapp"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-grid">
                            <div class="modal-section" data-field="crm-cuit">
                                <label><i class="fas fa-id-card"></i> Cuil / Cuit / DNI</label>
                                <input type="text" id="edit-lead-cuit" class="crm-input" placeholder="00-00000000-0">
                            </div>
                            <div class="modal-section" data-field="crm-email">
                                <label><i class="fas fa-envelope"></i> Email</label>
                                <input type="email" id="edit-lead-email" class="crm-input" placeholder="email@ejemplo.com">
                            </div>
                        </div>
                        <div class="modal-grid">
                            <div class="modal-section" data-field="crm-address">
                                <label><i class="fas fa-map-marker-alt"></i> Domicilio</label>
                                <input type="text" id="edit-lead-address" class="crm-input" placeholder="Calle, Nro, Localidad...">
                            </div>
                            <div class="modal-section" data-field="crm-tax-status">
                                <label><i class="fas fa-file-invoice-dollar"></i> Situacion Impositiva</label>
                                <select id="edit-lead-tax-status" class="crm-input">
                                    <option value="Cons. Final">Cons. Final</option>
                                    <option value="Responsable Inscripto">Responsable Inscripto</option>
                                    <option value="Monotributo">Monotributo</option>
                                    <option value="Exento">Exento</option>
                                </select>
                            </div>
                        </div>
                        <div class="modal-grid">
                            <div class="modal-section" data-field="crm-product">
                                <label><i class="fas fa-shopping-bag"></i> Producto Ofrecido</label>
                                <input type="text" id="edit-lead-offered-product" class="crm-input" placeholder="Servicio/Producto...">
                            </div>
                            <div class="modal-section" data-field="crm-source">
                                <label><i class="fas fa-bullhorn"></i> Fuente / Canal</label>
                                <select id="edit-lead-source" class="crm-input">
                                    <option value="">Desconocida</option>
                                    <option value="Instagram">Instagram</option>
                                    <option value="Facebook">Facebook</option>
                                    <option value="WhatsApp">WhatsApp</option>
                                    <option value="Web">Web</option>
                                    <option value="Referido">Referido</option>
                                    <option value="Manual CRM">Manual CRM</option>
                                </select>
                            </div>
                        </div>
                        <div class="modal-section" data-field="crm-notes">
                            <label><i class="fas fa-sticky-note"></i> Historial de Notas / Comentarios</label>
                            <textarea id="edit-custom-notes" class="crm-input" rows="4" placeholder="Observaciones generales..."></textarea>
                        </div>
                        <div class="modal-grid">
                            <div class="modal-section" data-field="crm-due-date">
                                <label><i class="fas fa-bell"></i> Fecha Alerta / Seguimiento</label>
                                <input type="date" id="edit-alert-date" class="crm-input">
                            </div>
                            <div class="modal-section" data-field="crm-priority">
                                <label><i class="fas fa-tag"></i> Prioridad</label>
                                <select id="edit-priority" class="crm-input">
                                    <option value="Baja">Baja</option>
                                    <option value="Media" selected>Media</option>
                                    <option value="Alta">Alta</option>
                                </select>
                            </div>
                        </div>
                        <div class="modal-section" data-field="crm-status">
                            <label><i class="fas fa-tasks"></i> Estado del Lead (CRM)</label>
                            <select id="edit-lead-status" class="crm-input" onchange="syncStatusToColumn && syncStatusToColumn(this.value)"></select>
                        </div>
                    </div>
                    <div id="additional-notes-list"></div>
                    <button type="button" class="btn-add-note" onclick="addNewNoteUI()">
                        <i class="fas fa-plus-circle"></i> Agregar Nota con Fecha
                    </button>
                    <div id="alert-status-info"></div>
                    <div id="assignee-section" class="modal-section">
                        <label><i class="fas fa-user-tag assignee-icon"></i> Asignar Lead a:</label>
                        <select id="edit-lead-assignee" class="crm-input">
                            <option value="">Sin asignar (Libre)</option>
                        </select>
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

    <!-- Modal Equipo -->
    <div id="modal-users" class="modal-overlay">
        <div class="modal-content modal-content-md animate-pop-in">
            <div class="modal-header">
                <h3><i class="fas fa-users-cog modal-h3-icon"></i> Gestion de Equipo</h3>
                <button class="btn-close-modal" onclick="document.getElementById('modal-users').classList.remove('active')"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="user-register-box">
                    <h4 class="user-register-title">REGISTRAR NUEVO SUB-USUARIO</h4>
                    <div class="modal-section">
                        <input type="text" id="new-user-name" class="crm-input mb-10" placeholder="Nombre completo">
                        <input type="text" id="new-user-user" class="crm-input mb-10" placeholder="Usuario (Ej: juan_vendedor)">
                        <input type="password" id="new-user-pass" class="crm-input mb-10" placeholder="Contrasena">
                        <select id="new-user-role" class="crm-input mb-15">
                            <option value="subuser">Vendedor / Operador (Limitado)</option>
                            <option value="admin">Administrador (Total)</option>
                        </select>
                        <button class="btn btn-primary btn-full-tall" onclick="window.saveNewUser()">
                            <i class="fas fa-user-plus"></i> Crear Usuario
                        </button>
                    </div>
                </div>
                <h4 class="team-list-title">Usuarios en el equipo</h4>
                <div id="team-list-container"></div>
            </div>
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
