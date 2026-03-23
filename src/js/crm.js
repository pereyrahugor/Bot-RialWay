/* global Sortable, FB, metaAppId */
const backofficeToken = localStorage.getItem('backoffice_token');
const activeToken = backofficeToken;

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
        await fetch(`/api/backoffice/save-setting?token=${activeToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'CRM_COLUMNS',
                value: JSON.stringify(columns)
            })
        });
    } catch (e) { console.error('Error guardando estado:', e); }
}

async function syncCRM() {
    showToast('🔄 Sincronizando datos...');
    try {
        const [resLeads, resTickets] = await Promise.all([
            fetch(`/api/backoffice/leads?token=${activeToken}&limit=300`),
            fetch(`/api/backoffice/tickets?token=${activeToken}&estado=Abierto`) // Forzamos solo abiertos para el tablero
        ]);

        allLeads = await resLeads.json();
        const ticketsData = await resTickets.json();
        // El CRM solo muestra los tickets que NO son Asistencia Externa y que NO estén cerrados
        allTickets = (ticketsData || []).filter(t => t.tipo !== 'Asistencia Externa' && t.estado !== 'Cerrado');
        console.log(`[CRM] Tickets activos: ${allTickets.length} (excluidos cerrados y externos)`);

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
    const board = document.getElementById('kanban-board-inner');
    if (!board) return;
    board.innerHTML = '';

    columns.forEach((col, index) => {
        const columnEl = document.createElement('div');
        columnEl.className = 'kanban-column animate-fade';
        columnEl.style.animationDelay = `${index * 0.1}s`;
        columnEl.dataset.id = col.id;
        
        columnEl.innerHTML = `
            <div class="column-header" ${col.fixed ? '' : `onclick="editColumn('${col.id}')"`}>
                <div class="column-title-group">
                    ${col.fixed ? '<i class="fas fa-star" style="color:#f59e0b;"></i>' : ''}
                    <span class="column-title">${col.title}</span>
                </div>
                <span class="column-badge" id="badge-${col.id}">0</span>
            </div>
            <div class="kanban-cards" id="cards-${col.id}"></div>
        `;
        board.appendChild(columnEl);
    });

    distributeCards();
    initDragAndDrop();
}

function distributeCards() {
    const containers = document.querySelectorAll('.kanban-cards');
    containers.forEach(c => c.innerHTML = '');

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
    
    // Al hacer clic en la card, vamos al chat en el backoffice
    card.onclick = (e) => {
        // Evitar que el clic en botones internos dispare esto
        if (e.target.closest('button')) return;
        localStorage.setItem('activeChat', ticket.chat_id);
        window.location.href = '/backoffice';
    };
    
    const tags = (lead?.tags || []).map(t => 
        `<span class="card-tag" style="background:${t.color}">${t.name}</span>`
    ).join('');

    const phone = ticket.chat_id ? ticket.chat_id.split('@')[0] : 'Desconocido';
    const email = lead?.email || '';
    const alertDateStr = metadata.alertDate ? formatDate(metadata.alertDate) : 'Sin alerta';

    card.innerHTML = `
        <div class="priority-indicator" style="background:${getPriorityColor(metadata.priority)}"></div>
        <div class="card-tags">${tags}</div>
        <div class="card-title">${ticket.titulo || 'Sin título'}</div>
        <div class="card-lead-main">
            <i class="fas fa-user-circle"></i> ${lead?.name || 'Lead sin nombre'}
        </div>
        <div class="card-lead-details">
            <div class="detail-item"><i class="fas fa-phone"></i> ${phone}</div>
            ${email ? `<div class="detail-item"><i class="fas fa-envelope"></i> ${email}</div>` : ''}
        </div>
        <div class="card-footer">
            <div class="card-alert ${getAlertClass(metadata.alertDate)}" id="alert-card-${ticket.id}">
                <i class="fas fa-bell"></i> ${alertDateStr}
            </div>
            <div style="display:flex; gap:5px;">
                <button class="btn-icon" title="Cerrar Lead" onclick="event.stopPropagation(); confirmCloseTicket('${ticket.id}')" style="color:#10b981; font-size:1.1rem;">
                    <i class="fas fa-check-circle"></i>
                </button>
                <button class="btn-icon" title="Ver Detalles" onclick="event.stopPropagation(); openCardModal('${ticket.id}')">
                    <i class="fas fa-external-link-alt"></i>
                </button>
            </div>
        </div>
    `;

    return card;
}

function initDragAndDrop() {
    // 1. Arrastre de tarjetas entre columnas
    const containers = document.querySelectorAll('.kanban-cards');
    containers.forEach(container => {
        new Sortable(container, {
            group: 'kanban',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: async (evt) => {
                const ticketId = evt.item.dataset.id;
                const newColumnId = evt.to.id.replace('cards-', '');
                if (!crmData[ticketId]) crmData[ticketId] = {};
                crmData[ticketId].columnId = newColumnId;
                saveCRMMetadata();
                updateCounters();
            }
        });
    });

    // 2. Arrastre de columnas (Reordenar etapas)
    const boardInner = document.getElementById('kanban-board-inner');
    if (boardInner) {
        new Sortable(boardInner, {
            animation: 150,
            draggable: '.kanban-column',
            handle: '.column-header',
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                const newOrder = [];
                document.querySelectorAll('.kanban-column').forEach(col => {
                    const colId = col.dataset.id;
                    const existingCol = columns.find(c => c.id === colId);
                    if (existingCol) newOrder.push(existingCol);
                });
                columns = newOrder;
                saveCRMState();
                showToast('CRM Actualizado', 'success');
            }
        });
    }
}

async function saveCRMMetadata() {
    try {
        await fetch(`/api/backoffice/save-setting?token=${activeToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: 'CRM_METADATA',
                value: JSON.stringify(crmData)
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
    const lead = allLeads.find(l => l.id === ticket.chat_id);
    const metadata = crmData[ticketId] || {};

    document.getElementById('edit-lead-id').value = ticketId;
    document.getElementById('edit-ticket-title').value = ticket.titulo || '';
    document.getElementById('edit-alert-date').value = metadata.alertDate || '';
    document.getElementById('edit-priority').value = metadata.priority || 'Media';
    document.getElementById('edit-custom-notes').value = metadata.customNotes || '';
    
    // Nuevos campos del Lead
    document.getElementById('edit-lead-name').value = lead?.name || '';
    document.getElementById('edit-lead-email').value = lead?.email || '';
    document.getElementById('edit-lead-source').value = lead?.source || '';

    document.getElementById('card-modal').classList.add('active');
}

function closeCardModal() {
    document.getElementById('card-modal').classList.remove('active');
}

document.getElementById('card-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const ticket = allTickets.find(t => t.id === currentEditId);
    const chatId = ticket?.chat_id;

    // 1. Datos de Contacto (Lead)
    const leadData = {
        name: document.getElementById('edit-lead-name').value,
        email: document.getElementById('edit-lead-email').value,
        source: document.getElementById('edit-lead-source').value,
        notes: document.getElementById('edit-custom-notes').value // Duplicamos notas en contacto para consistencia
    };

    // 2. Metadatos del CRM (Tablero)
    const metadata = crmData[currentEditId] || { columnId: 'UNASSIGNED' };
    metadata.alertDate = document.getElementById('edit-alert-date').value;
    metadata.priority = document.getElementById('edit-priority').value;
    metadata.customNotes = leadData.notes;
    
    crmData[currentEditId] = metadata;

    showToast('💾 Guardando...', 'success');

    try {
        // Guardar metadatos (Tablero)
        await saveCRMMetadata();
        
        // Guardar datos de contacto (Lead)
        if (chatId) {
            await fetch(`/api/backoffice/chat/${chatId}/contact?token=${activeToken}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(leadData)
            });
        }
        
        closeCardModal();
        await syncCRM(); // Recargar todo para reflejar cambios
        showToast('Cambios guardados con éxito');
    } catch (e) {
        console.error('Error al guardar:', e);
        showToast('Error al guardar algunos datos', 'error');
    }
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
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
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

// --- Cierre de Leads ---
window.confirmCloseTicket = async (ticketId) => {
    if (!confirm('¿Seguro quieres cerrar este lead? Se moverá al historial de cerrados.')) return;
    
    showToast('🔏 Cerrando lead...', 'success');
    try {
        // 1. Guardar metadatos con fecha de cierre
        if (!crmData[ticketId]) crmData[ticketId] = {};
        crmData[ticketId].closedAt = new Date().toISOString();
        await saveCRMMetadata();

        // 2. Actualizar estado del ticket
        await fetch(`/api/backoffice/tickets/${ticketId}?token=${activeToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Cerrado' })
        });

        await syncCRM(); // Refrescar tablero
        showToast('Lead cerrado con éxito');
    } catch (e) {
        console.error('Error cerrando ticket:', e);
        showToast('Error al cerrar ticket', 'error');
    }
};

window.openClosedLeadsModal = async () => {
    const list = document.getElementById('closed-leads-list');
    list.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Cargando historial...</div>';
    document.getElementById('closed-leads-modal').classList.add('active');
    
    try {
        const res = await fetch(`/api/backoffice/tickets?token=${activeToken}&estado=Cerrado`);
        const closedTickets = await res.json();
        
        if (!closedTickets || closedTickets.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No hay leads cerrados por ahora.</div>';
            return;
        }

        list.innerHTML = closedTickets.map(t => {
            const metadata = crmData[t.id] || {};
            const closedDate = metadata.closedAt ? new Date(metadata.closedAt).toLocaleString() : 'Fecha no registrada';
            const lead = allLeads.find(l => l.id === t.chat_id);
            
            return `
                <div class="closed-item" style="display:flex; justify-content:space-between; align-items:center; padding:15px; border-bottom:1px solid var(--border); background:var(--bg-card); border-radius:12px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:700; color:var(--text-main); font-size:1.1rem;">${t.titulo || 'Sin título'}</div>
                        <div style="font-size:0.9rem; color:var(--text-muted);"><i class="fas fa-user"></i> ${lead?.name || 'Sin nombre'} | <i class="fas fa-phone"></i> ${t.chat_id?.split('@')[0]}</div>
                        <div style="font-size:0.8rem; color:var(--accent); margin-top:5px;"><i class="fas fa-calendar-check"></i> Cerrado el: ${closedDate}</div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-icon" onclick="localStorage.setItem('activeChat', '${t.chat_id}'); window.location.href='/backoffice'" title="Ver Chat">
                            <i class="fas fa-comment-dots"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error(e);
        list.innerHTML = '<div style="color:#ef4444; text-align:center; padding:20px;">Error cargando historial de cerrados.</div>';
    }
};

window.closeClosedLeadsModal = () => {
    document.getElementById('closed-leads-modal').classList.remove('active');
};

