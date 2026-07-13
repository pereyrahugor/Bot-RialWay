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
                    <button class="btn btn-primary" onclick="window.openNewLeadModal()">
                        <i class="fas fa-plus"></i> Crear Lead
                    </button>
                    <div class="header-more-menu">
                        <button class="btn-icon-round" onclick="_toggleTareasMenu(event)" aria-label="Mas opciones">
                            <i class="fas fa-ellipsis-vertical"></i>
                        </button>
                        <ul class="header-dropdown" id="tareas-more-dropdown">
                            <li onclick="_closeTareasMenu(); openClosedLeadsModal()">
                                <i class="fas fa-box-archive"></i> Leads Cerrados
                            </li>
                            <li onclick="_closeTareasMenu(); toggleCRMConfigModal()">
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
        ${modals}`;
    },

    async init() {
        if (typeof Sortable === 'undefined') {
            await loadViewScript('https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js');
        }
        await loadViewScript('/js/crm/crm-tareas.js?v=8');
        if (typeof window.initCRMTareasView === 'function') await window.initCRMTareasView();
    },

    destroy() {
        if (typeof window.destroyCRMTareas === 'function') {
            window.destroyCRMTareas();
        }
    }
};

window._toggleTareasMenu = function(e) {
    e.stopPropagation();
    const d = document.getElementById('tareas-more-dropdown');
    if (!d) return;
    const isOpen = d.classList.toggle('open');
    if (isOpen) document.addEventListener('click', window._closeTareasMenu, { once: true });
};
window._closeTareasMenu = function() {
    const d = document.getElementById('tareas-more-dropdown');
    if (d) d.classList.remove('open');
};
