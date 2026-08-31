/* global Sortable */

// --- Lógica de Configuración CRM ---
window.crmConfig = [
    { id: 'crm-ticket-title', label: 'Titulo del Ticket', visible: true, order: 0 },
    { id: 'crm-name', label: 'Nombre', visible: true, order: 1 },
    { id: 'crm-last-name', label: 'Apellido', visible: true, order: 2 },
    { id: 'crm-phone', label: 'Teléfono', visible: true, order: 3 },
    { id: 'crm-cuit', label: 'Cuil / Cuit / DNI', visible: true, order: 4 },
    { id: 'crm-company', label: 'Empresa / Razón Social', visible: true, order: 5 },
    { id: 'crm-email', label: 'Correo Electrónico', visible: true, order: 6 },
    { id: 'crm-address', label: 'Domicilio', visible: true, order: 7 },
    { id: 'crm-city', label: 'Localidad', visible: true, order: 8 },
    { id: 'crm-province', label: 'Provincia', visible: true, order: 9 },
    { id: 'crm-transport', label: 'Transporte / Logística', visible: true, order: 10 },
    { id: 'crm-tax-status', label: 'Situación Impositiva', visible: true, order: 11 },
    { id: 'crm-product', label: 'Producto Ofrecido', visible: true, order: 12 },
    { id: 'crm-source', label: 'Fuente / Canal', visible: true, order: 13 },
    { id: 'crm-notes', label: 'Notas 1 (Locales)', visible: true, order: 14 },
    { id: 'crm-shared-notes', label: 'Notas 2 (Compartidas Empresa)', visible: true, order: 15 },
    { id: 'crm-due-date', label: 'Fecha Alerta / Seguimiento', visible: true, order: 16 },
    { id: 'crm-priority', label: 'Prioridad', visible: true, order: 17 },
    { id: 'crm-status', label: 'Estado del Lead (CRM)', visible: true, order: 18 }
];

window.fetchCRMConfig = async () => {
    const token = localStorage.getItem('backoffice_token');
    if (!token) return;
    try {
        const res = await fetch(`/api/backoffice/get-setting?key=CRM_FIELDS_CONFIG&token=${token}`);
        const data = await res.json();
        if (data.success && data.value) {
            window.crmConfig = JSON.parse(data.value);
        }
    } catch (e) {
        console.error('[CRM Config] Error fetching:', e);
    }
};

window.applyCRMConfig = () => {
    const container = document.getElementById('crm-fields-container');
    if (!container) return;

    window.crmConfig.forEach(f => {
        const el = container.querySelector(`[data-field="${f.id}"]`);
        if (el) {
            el.style.order = f.order;
            el.style.display = f.visible ? 'flex' : 'none';
        }
    });
};

window.toggleCRMConfigModal = () => {
    const modal = document.getElementById('crm-config-modal');
    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
        window.renderCRMConfigFields();
    }
};

window.saveCRMConfig = async () => {
    const activeToken = localStorage.getItem('backoffice_token');
    try {
        const res = await fetch(`/api/backoffice/save-setting?token=${activeToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'CRM_FIELDS_CONFIG',
                value: JSON.stringify(window.crmConfig)
            })
        });
        if (res.ok) {
            if (typeof window.showToast === 'function') window.showToast('Configuración guardada', 'success');
            window.toggleCRMConfigModal();
            window.applyCRMConfig();
            if (typeof window.distributeCards === 'function') {
                window.distributeCards();
            }
        }
    } catch (e) {
        console.error(e);
    }
}

window.renderCRMConfigFields = () => {
    const list = document.getElementById('crm-fields-list');
    if (!list) return;

    list.innerHTML = '';
    window.crmConfig.sort((a, b) => a.order - b.order).forEach((field, index) => {
        const item = document.createElement('div');
        item.className = 'sortable-item';
        item.dataset.id = field.id;
        item.dataset.index = index;
        
        item.innerHTML = `
            <i class="fas fa-grip-lines sort-handle"></i>
            <div style="flex:1; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" ${field.visible ? 'checked' : ''} onchange="window.updateFieldVisibility('${field.id}', this.checked)">
                <span style="font-size:0.9rem; font-weight:600;">${field.label}</span>
            </div>
        `;

        list.appendChild(item);
    });

    if (typeof Sortable !== 'undefined' && !Sortable.get(list)) {
        new Sortable(list, {
            animation: 150,
            handle: '.sort-handle',
            onEnd: () => {
                const newOrder = Array.from(list.children).map(child => child.dataset.id);
                newOrder.forEach((id, index) => {
                    const field = window.crmConfig.find(f => f.id === id);
                    if (field) field.order = index;
                });
            }
        });
    }
}

window.updateFieldVisibility = (id, visible) => {
    const field = window.crmConfig.find(f => f.id === id);
    if (field) field.visible = visible;
};

// Inicializacion

window.autoFitColumns = () => {
    document.querySelectorAll('.kanban-column').forEach(col => {
        let maxCardWidth = 320;
        col.querySelectorAll('.kanban-card, .kanban-card-expanded').forEach(card => {
            const width = card.scrollWidth + 32;
            if (width > maxCardWidth) maxCardWidth = width;
        });
        const newWidth = Math.min(Math.max(maxCardWidth, 280), 800) + 'px';
        col.style.width = newWidth;
        if (col.dataset.id) {
            localStorage.setItem('col_width_' + col.dataset.id, newWidth);
        }
    });
    if (typeof window.showToast === 'function') window.showToast('Columnas autoajustadas', 'success');
};

window.observeKanbanColumn = (colEl, colId) => {
    const savedWidth = localStorage.getItem('col_width_' + colId);
    if (savedWidth) {
        colEl.style.width = savedWidth;
    }
    if (typeof window.ResizeObserver !== 'undefined') {
        const observer = new window.ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target.style.width) {
                    localStorage.setItem('col_width_' + colId, entry.target.style.width);
                } else {
                    localStorage.setItem('col_width_' + colId, entry.contentRect.width + 'px');
                }
            }
        });
        observer.observe(colEl);
    }
};

window.resetColumnWidth = (colId, e) => {
    if (e) e.stopPropagation();
    localStorage.removeItem('col_width_' + colId);
    const col = document.querySelector(`.kanban-column-wrapper[data-id="${colId}"]`);
    if (col) {
        col.style.width = '445px';
    }
    if (typeof window.showToast === 'function') window.showToast('Tamaño de columna restaurado', 'success');
};
