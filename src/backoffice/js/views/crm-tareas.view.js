/* global loadViewScript, Sortable */
window.crmTareasView = {
    title: 'Tareas CRM - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        const modals = typeof window._getCRMModals === 'function' ? window._getCRMModals() : '';
        return `
        <style>
            .kanban-column[data-id="overdue"]  { border-top: 3px solid #ef4444; }
            .kanban-column[data-id="today"]    { border-top: 3px solid #f59e0b; }
            .kanban-column[data-id="tomorrow"] { border-top: 3px solid #3b82f6; }
            .kanban-column[data-id="week"]     { border-top: 3px solid #10b981; }
            .kanban-column[data-id="later"]    { border-top: 3px solid #8b5cf6; }
            .kanban-column[data-id="nodate"]   { border-top: 3px solid #6b7280; }
            .kanban-column[data-id="overdue"]  .column-badge { background: rgba(239,68,68,0.2);   color: #ef4444; }
            .kanban-column[data-id="today"]    .column-badge { background: rgba(245,158,11,0.2);  color: #f59e0b; }
            .kanban-column[data-id="tomorrow"] .column-badge { background: rgba(59,130,246,0.2);  color: #3b82f6; }
            .kanban-column[data-id="week"]     .column-badge { background: rgba(16,185,129,0.2);  color: #10b981; }
            .kanban-column[data-id="later"]    .column-badge { background: rgba(139,92,246,0.2);  color: #8b5cf6; }
            .kanban-column[data-id="nodate"]   .column-badge { background: rgba(107,114,128,0.2); color: #9ca3af; }
        </style>

        <div class="crm-main-container kanban-wrapper relative" style="z-index:10;">

            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-calendar-check kanban-header-icon"></i> Tareas y Vencimientos</h1>
                    <p>${window.BOT_NAME || ''} - Agenda de contactos por fecha de seguimiento</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-primary" onclick="navigate('/crm')">
                        <i class="fas fa-columns"></i> Volver a CRM
                    </button>
                    <button class="btn btn-primary" onclick="openClosedLeadsModal()">
                        <i class="fas fa-archive"></i> Leads Cerrados
                    </button>
                    <button id="btn-new-user" class="btn btn-primary" style="display:none;" onclick="window.openNewUserModal()">
                        <i class="fas fa-users"></i> Nuevo Usuario
                    </button>
                    <button class="btn btn-primary" onclick="toggleCRMConfigModal()">
                        <i class="fas fa-cog"></i> Configurar
                    </button>
                    <button class="btn btn-primary" onclick="window.openNewLeadModal()">
                        <i class="fas fa-plus-circle"></i> Crear Lead
                    </button>
                </div>
            </div>

            <div id="kanban-board" class="kanban-scroll-area">
                <div class="kanban-board-inner" id="kanban-board-inner">

                    <div class="kanban-column animate-fade" data-id="overdue">
                        <div class="column-header">
                            <div class="column-title-group">
                                <i class="fas fa-calendar-times" style="color:#ef4444;"></i>
                                <span class="column-title">Vencidas</span>
                            </div>
                            <span class="column-badge" id="badge-overdue">0</span>
                        </div>
                        <div class="kanban-cards" id="cards-overdue"></div>
                    </div>

                    <div class="kanban-column animate-fade" data-id="today">
                        <div class="column-header">
                            <div class="column-title-group">
                                <i class="fas fa-calendar-day" style="color:#f59e0b;"></i>
                                <span class="column-title">Hoy</span>
                            </div>
                            <span class="column-badge" id="badge-today">0</span>
                        </div>
                        <div class="kanban-cards" id="cards-today"></div>
                    </div>

                    <div class="kanban-column animate-fade" data-id="tomorrow">
                        <div class="column-header">
                            <div class="column-title-group">
                                <i class="fas fa-calendar-minus" style="color:#3b82f6;"></i>
                                <span class="column-title">Manana</span>
                            </div>
                            <span class="column-badge" id="badge-tomorrow">0</span>
                        </div>
                        <div class="kanban-cards" id="cards-tomorrow"></div>
                    </div>

                    <div class="kanban-column animate-fade" data-id="week">
                        <div class="column-header">
                            <div class="column-title-group">
                                <i class="fas fa-calendar-week" style="color:#10b981;"></i>
                                <span class="column-title">Esta Semana</span>
                            </div>
                            <span class="column-badge" id="badge-week">0</span>
                        </div>
                        <div class="kanban-cards" id="cards-week"></div>
                    </div>

                    <div class="kanban-column animate-fade" data-id="later">
                        <div class="column-header">
                            <div class="column-title-group">
                                <i class="fas fa-calendar-plus" style="color:#8b5cf6;"></i>
                                <span class="column-title">Mas Adelante</span>
                            </div>
                            <span class="column-badge" id="badge-later">0</span>
                        </div>
                        <div class="kanban-cards" id="cards-later"></div>
                    </div>

                    <div class="kanban-column animate-fade" data-id="nodate">
                        <div class="column-header">
                            <div class="column-title-group">
                                <i class="fas fa-calendar-xmark" style="color:#6b7280;"></i>
                                <span class="column-title">Sin Fecha</span>
                            </div>
                            <span class="column-badge" id="badge-nodate">0</span>
                        </div>
                        <div class="kanban-cards" id="cards-nodate"></div>
                    </div>
                </div>
            </div>
        </div>
        ${modals}`;
    },

    async init() {
        if (typeof Sortable === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js');
        }
        await loadViewScript('/js/crm-tareas.js?v=2');
        if (typeof window.initCRMTareasView === 'function') await window.initCRMTareasView();
    },

    destroy() {}
};
