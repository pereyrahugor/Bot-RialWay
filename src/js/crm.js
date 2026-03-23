/* global Sortable, FB, metaAppId */
const token = localStorage.getItem('backoffice_token');
const configToken = localStorage.getItem('system_config_token');
const activeToken = configToken || token;

if (!activeToken) window.location.href = '/login';

let kanbanBoard = null;
let columns = [
    { id: 'UNASSIGNED', title: 'Tickets Nuevos', fixed: true },
    { id: 'contactado', title: 'Contactado' },
    { id: 'negociacion', title: 'En Negociación' },
    { id: 'propuesta', title: 'Propuesta Enviada' },
    { id: 'cierre', title: 'Cierre' }
];

let allLeads = [];
let allTickets = [];
let crmData = {}; // Para guardar metadatos (alertas, notas adicionales) de cada prospecto

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    loadCRMState();
    syncCRM();
    initTheme();
    
    // Auto-check de alertas cada minuto
    setInterval(checkAlertsVisual, 60000);
});

// Exportar globalmente para botones HTML
window.syncCRM = syncCRM;
window.addNewColumn = addNewColumn;

async function loadCRMState() {
    // Intentar cargar el orden de las columnas desde el servidor
    try {
        const res = await fetch(`/api/backoffice/get-setting?key=CRM_COLUMNS&token=${activeToken}`);
        const data = await res.json();
        if (data.success && data.value) {
            columns = JSON.parse(data.value);
        }
    } catch (e) {
        console.log('Usando columnas por defecto');
    }
    renderBoard();
}

async function saveCRMState() {
    try {
        await fetch(`/api/backoffice/save-setting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'CRM_COLUMNS',
                value: JSON.stringify(columns),
                token: activeToken
            })
        });
    } catch (e) { console.error('Error guardando estado:', e); }
}

async function syncCRM() {
    showToast('🔄 Sincronizando datos...');
    try {
        const [resLeads, resTickets] = await Promise.all([
            fetch(`/api/backoffice/leads?token=${activeToken}&limit=300`),
            fetch(`/api/backoffice/tickets?token=${activeToken}`)
        ]);

        allLeads = await resLeads.json();
        allTickets = await resTickets.json();

        const resSettings = await fetch(`/api/backoffice/get-setting?key=CRM_METADATA&token=${activeToken}`);
        const setJson = await resSettings.json();
        if (setJson.success && setJson.value) {
            crmData = JSON.parse(setJson.value);
        }

        renderBoard();
    } catch (e) {
        console.error(e);
        showToast('❌ Error al sincronizar datos', 'error');
    }
}
window.syncCRM = syncCRM; // Exportar globalmente

function renderBoard() {
    const board = document.getElementById('dynamic-columns');
    board.innerHTML = '';

    // Renderizar solo las dinámicas aquí. La fija está en el HTML
    columns.forEach((col, index) => {
        if (col.fixed) return; 

        const columnEl = document.createElement('div');
        columnEl.className = 'kanban-column animate-fade';
        columnEl.style.animationDelay = `${index * 0.1}s`;
        columnEl.dataset.id = col.id;
        
        columnEl.innerHTML = `
            <div class="column-header" onclick="editColumn('${col.id}')">
                <div class="column-title-group">
                    <span class="column-title">${col.title}</span>
                </div>
                <span class="column-badge" id="badge-${col.id}">0</span>
            </div>
            <div class="kanban-cards" id="cards-${col.id}"></div>
        `;
        board.appendChild(columnEl);
    });

    // Repartir tarjetas
    distributeCards();

    // Inicializar Drag & Drop en todas las columnas
    initDragAndDrop();
}

function distributeCards() {
    // Limpiar contenedores
    const containers = document.querySelectorAll('.kanban-cards');
    containers.forEach(c => c.innerHTML = '');

    // Primero los tickets abiertos. Si un ticket no tiene columna asignada (metadata), va a UNASSIGNED.
    allTickets.forEach(ticket => {
        const lead = allLeads.find(l => l.id === ticket.chat_id);
        const metadata = crmData[ticket.id] || {};
        const columnId = metadata.columnId || 'UNASSIGNED';
        
        const container = document.getElementById(`cards-${columnId}`);
        if (container) {
            container.appendChild(createCardElement(ticket, lead, metadata));
        }
    });

    updateCounters();
    checkAlertsVisual();
}

function createCardElement(ticket, lead, metadata) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.dataset.id = ticket.id;
    card.id = `card-${ticket.id}`;
    
    const tags = (lead?.tags || []).map(t => 
        `<span class="card-tag" style="background:${t.color}">${t.name}</span>`
    ).join('');

    const phone = ticket.chat_id ? ticket.chat_id.split('@')[0] : 'Desconocido';
    const alertDateStr = metadata.alertDate ? formatDate(metadata.alertDate) : 'Sin alerta';
    const hasAlert = !!metadata.alertDate;

    card.innerHTML = `
        <div class="priority-indicator" style="background:${getPriorityColor(metadata.priority)}"></div>
        <div class="card-tags">${tags}</div>
        <div class="card-title">${ticket.titulo || 'Sin título'}</div>
        <div class="card-lead">
            <i class="fas fa-user-circle"></i> ${lead?.name || phone}
        </div>
        <div class="card-footer">
            <div class="card-alert ${getAlertClass(metadata.alertDate)}" id="alert-card-${ticket.id}">
                <i class="fas fa-bell"></i> ${alertDateStr}
            </div>
            <button class="btn-icon" onclick="openCardModal('${ticket.id}')">
                <i class="fas fa-external-link-alt"></i>
            </button>
        </div>
    `;

    return card;
}

function initDragAndDrop() {
    const containers = document.querySelectorAll('.kanban-cards');
    containers.forEach(container => {
        new Sortable(container, {
            group: 'kanban',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                const ticketId = evt.item.dataset.id;
                const newColumnId = evt.to.id.replace('cards-', '');
                
                showToast(`Moviendo a ${newColumnId}...`);
                
                // Actualizar metadatos localmente
                if (!crmData[ticketId]) crmData[ticketId] = {};
                crmData[ticketId].columnId = newColumnId;
                
                // Persistir el cambio de columna
                saveCRMMetadata();
                updateCounters();
            }
        });
    });
}

async function saveCRMMetadata() {
    try {
        await fetch(`/api/backoffice/save-setting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'CRM_METADATA',
                value: JSON.stringify(crmData),
                token: activeToken
            })
        });
    } catch (e) { console.error('Error guardando metadatos:', e); }
}

function updateCounters() {
    columns.forEach(col => {
        const count = document.querySelectorAll(`#cards-${col.id} .kanban-card`).length;
        const badge = document.getElementById(`badge-${col.id}`);
        if (badge) badge.innerText = count;
    });
}

// --- Modales ---
let currentEditId = null;
function openCardModal(ticketId) {
    currentEditId = ticketId;
    const ticket = allTickets.find(t => t.id === ticketId);
    const metadata = crmData[ticketId] || {};

    document.getElementById('edit-lead-id').value = ticketId;
    document.getElementById('edit-ticket-title').value = ticket.titulo || '';
    document.getElementById('edit-alert-date').value = metadata.alertDate || '';
    document.getElementById('edit-priority').value = metadata.priority || 'Media';
    document.getElementById('edit-custom-notes').value = metadata.customNotes || '';

    document.getElementById('card-modal').classList.add('active');
}

function closeCardModal() {
    document.getElementById('card-modal').classList.remove('active');
}

document.getElementById('card-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const metadata = crmData[currentEditId] || { columnId: 'UNASSIGNED' };
    metadata.alertDate = document.getElementById('edit-alert-date').value;
    metadata.priority = document.getElementById('edit-priority').value;
    metadata.customNotes = document.getElementById('edit-custom-notes').value;
    
    crmData[currentEditId] = metadata;

    showToast('💾 Guardando cambios...');
    await saveCRMMetadata();
    closeCardModal();
    syncCRM();
};

// --- Gestión de Columnas ---
let editingColIdx = -1;
function editColumn(colId) {
    const idx = columns.findIndex(c => c.id === colId);
    if (idx === -1 || columns[idx].fixed) return;
    
    editingColIdx = idx;
    document.getElementById('column-name-input').value = columns[idx].title;
    document.getElementById('column-modal').classList.add('active');
}

function closeColumnModal() {
    document.getElementById('column-modal').classList.remove('active');
    editingColIdx = -1;
}

function saveColumnName() {
    if (editingColIdx === -1) return;
    const newName = document.getElementById('column-name-input').value.trim();
    if (newName) {
        columns[editingColIdx].title = newName;
        saveCRMState();
        renderBoard();
        closeColumnModal();
    }
}

function addNewColumn() {
    if (columns.length >= 10) {
        showToast('Máximo de 10 columnas alcanzado', 'error');
        return;
    }
    const newId = 'col-' + Date.now();
    columns.push({ id: newId, title: 'Nueva Etapa' });
    saveCRMState();
    renderBoard();
    editColumn(newId);
}

function deleteCurrentColumn() {
    if (editingColIdx === -1) return;
    const cards = document.querySelectorAll(`#cards-${columns[editingColIdx].id} .kanban-card`);
    if (cards.length > 0) {
        if (!confirm('Esta columna tiene tickets. ¿Seguro que quieres eliminarla? Los tickets volverán a Nuevos.')) return;
        cards.forEach(card => {
            const tid = card.dataset.id;
            if (crmData[tid]) crmData[tid].columnId = 'UNASSIGNED';
        });
        saveCRMMetadata();
    }
    columns.splice(editingColIdx, 1);
    saveCRMState();
    renderBoard();
    closeColumnModal();
}

// --- Utilidades ---
function getPriorityColor(priority) {
    switch (priority) {
        case 'Alta': return '#ef4444';
        case 'Media': return '#f59e0b';
        case 'Baja': return '#10b981';
        default: return '#cbd5e1';
    }
}

function getAlertClass(date) {
    if (!date) return '';
    const today = new Date().toISOString().split('T')[0];
    if (date < today) return 'alert-active';
    if (date === today) return 'alert-today';
    return '';
}

function checkAlertsVisual() {
    const today = new Date().toISOString().split('T')[0];
    for (const tid in crmData) {
        const metadata = crmData[tid];
        const el = document.getElementById(`alert-card-${tid}`);
        if (el && metadata.alertDate) {
            el.className = 'card-alert ' + getAlertClass(metadata.alertDate);
        }
    }
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function logout() {
    localStorage.removeItem('backoffice_token');
    localStorage.removeItem('system_config_token');
    window.location.href = '/login';
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}" style="margin-right:8px;"></i> ${message}`;
    
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%) translateY(100px)',
        background: type === 'success' ? '#10b981' : '#ef4444',
        color: 'white',
        padding: '12px 24px',
        borderRadius: '12px',
        zIndex: '10000',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        fontWeight: '600',
        boxShadow: '0 10px 15px rgba(0,0,0,0.1)'
    });

    document.body.appendChild(toast);
    setTimeout(() => toast.style.transform = 'translateX(-50%) translateY(0)', 10);
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    
    // El tema ya viene pre-cargado por crm-common.js
    toggle.onclick = () => {
        const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        toggle.innerHTML = newTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    };
}
