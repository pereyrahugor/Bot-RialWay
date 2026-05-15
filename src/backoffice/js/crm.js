/* global Sortable, FB, metaAppId */
const backofficeToken = localStorage.getItem('backoffice_token');
const activeToken = backofficeToken;

if (!activeToken) window.location.href = '/login';

const userRole = localStorage.getItem('user_role') || 'subuser';
const userId = localStorage.getItem('user_id');
const isAdmin = (userRole === 'admin' || activeToken === 'neuroadmin25');
const userName = localStorage.getItem('user_name') || 'Usuario';

let teamUsers = [];
let allLeads = [];
let allTickets = [];
let crmData = {};
let botTags = [];

let kanbanBoard = null;
let columns = [
    { id: 'UNASSIGNED', title: 'Tickets Nuevos', fixed: true },
    { id: 'contactado', title: 'Contactado' },
    { id: 'negociacion', title: 'En Negociación' },
    { id: 'propuesta', title: 'Propuesta Enviada' },
    { id: 'cierre', title: 'Cierre' }
];

// crmConfig y applyCRMConfig ahora se cargan desde crm-common.js

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Iniciando CRM como:', userName, `(${userRole})`);
    showToast(`Bienvenido ${userName}`, 'success');
    
    // Mostrar botones de admin si corresponde
    if (isAdmin) {
        const btnNewUser = document.getElementById('btn-new-user');
        const assigneeSection = document.getElementById('assignee-section');
        if (btnNewUser) btnNewUser.style.display = 'block';
        if (assigneeSection) assigneeSection.style.display = 'block';
        
        // Cargar equipo para los selects
        await loadTeam();
    }

    // Cargar etiquetas (para todos)
    await fetchTags();

    // Cargamos primero el estado (columnas) y la configuración de campos
    await Promise.all([
        loadCRMState(),
        window.fetchCRMConfig()
    ]);
    // Luego sincronizamos los datos (tickets, leads y metadatos de posicionamiento)
    await syncCRM();

    // Verificamos si hay un ticket pendiente de abrir (viniendo del Backoffice)
    const pendingId = localStorage.getItem('pendingTicket');
    if (pendingId) {
        localStorage.removeItem('pendingTicket');
        localStorage.removeItem('activeChat'); // Limpiamos también el de chat
        console.log('[CRM] Apertura automática de ticket:', pendingId);
        // Pequeño delay para asegurar que distributeCards terminó de renderizar
        setTimeout(() => openCardModal(pendingId), 300);
    }
    
    // Auto-check de alertas cada minuto
    setInterval(checkAlertsVisual, 60000);
    
    // Cargar config de campos
    await window.fetchCRMConfig();
    
    console.log('✅ CRM Listo');
});

// Exportar globalmente para botones HTML
window.syncCRM = syncCRM;
window.addNewColumn = addNewColumn;
window.openCardModal = openCardModal;
window.closeCardModal = closeCardModal;
window.editColumn = editColumn;
window.closeColumnModal = closeColumnModal;
window.deleteCurrentColumn = deleteCurrentColumn;
window.saveColumnName = saveColumnName;

async function loadCRMState() {
    // Intentar cargar el orden de las columnas desde el servidor
    try {
        const res = await fetch(`/api/backoffice/get-setting?key=CRM_COLUMNS&token=${activeToken}`);
        const data = await res.json();
        if (data.success && data.value) {
            columns = JSON.parse(data.value);
            // Asegurarse de que UNASSIGNED siempre esté presente primero
            if (!columns.some(c => c.id === 'UNASSIGNED')) {
                columns.unshift({ id: 'UNASSIGNED', title: 'Tickets Nuevos', fixed: true });
            }
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

        const leadsData = await resLeads.json();
        allLeads = Array.isArray(leadsData) ? leadsData : [];
        
        const ticketsRaw = await resTickets.json();
        const ticketsData = Array.isArray(ticketsRaw) ? ticketsRaw : [];
        
        // El CRM solo muestra los tickets que NO son Asistencia Externa y que NO estén cerrados
        allTickets = ticketsData.filter(t => t.tipo !== 'Asistencia Externa' && t.estado !== 'Cerrado');
        console.log(`[CRM] Tickets activos: ${allTickets.length}`);

        const resSettings = await fetch(`/api/backoffice/get-setting?key=CRM_METADATA&token=${activeToken}`);
        const setJson = await resSettings.json();
        if (setJson && setJson.success && setJson.value) {
            crmData = JSON.parse(setJson.value);
        } else {
            crmData = {};
        }

        renderBoard();
        await loadTasksDashboard();
    } catch (e) {
        console.error(e);
        showToast('❌ Error al sincronizar datos', 'error');
    }
}

window.toggleTasksDashboard = () => {
    const panel = document.getElementById('tasks-dashboard');
    const btn = document.getElementById('btn-tasks-dashboard');
    panel.classList.toggle('active');
    if (btn) btn.classList.toggle('active');
    
    if (panel.classList.contains('active')) {
        loadTasksDashboard();
    }
};

async function loadTasksDashboard() {
    const container = document.getElementById('tasks-list-content');
    if (!container) return;

    try {
        console.log('[Tasks] Cargando dashboard de tareas...');
        const tasks = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const limitDate = new Date(today);
        limitDate.setDate(today.getDate() + 7); // Ver hasta 7 días adelante
        limitDate.setHours(23, 59, 59, 999);

        allTickets.forEach(ticket => {
            const lead = allLeads.find(l => l.id === ticket.chat_id) || {};
            const metadata = crmData[ticket.id] || {};
            
            // Prioridad: 1. Metadata del Kanban, 2. Campo del Lead en DB
            let alertDateStr = metadata.alertDate || (lead.crm_due_date ? lead.crm_due_date.split('T')[0] : null);
            
            if (alertDateStr) {
                // Normalizar fecha para evitar problemas de zona horaria
                const dateParts = alertDateStr.split('-');
                const alertD = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
                alertD.setHours(0, 0, 0, 0);
                
                // Incluir todas las vencidas Y las que vencen en los próximos 7 días
                if (alertD <= limitDate) {
                    const colTitle = columns.find(c => c.id === metadata.columnId)?.title || lead.crm_status || 'NUEVO';
                    tasks.push({
                        ticket_id: ticket.id,
                        chat_id: ticket.chat_id,
                        name: lead.name || 'Lead sin nombre',
                        crm_status: colTitle,
                        crm_due_date: alertDateStr,
                        priority: metadata.priority || 'Media',
                        alertD: alertD // Guardamos objeto Date para sort preciso
                    });
                }
            }
        });

        // Ordenar: Vencidas primero (más viejas), luego por fecha ascendente
        tasks.sort((a, b) => a.alertD - b.alertD);

        console.log(`[Tasks] Tareas encontradas: ${tasks.length}`);

        if (tasks.length === 0) {
            container.innerHTML = `
                <div class="tasks-empty">
                    <i class="fas fa-check-double" style="font-size: 2rem; display: block; margin-bottom: 10px; opacity: 0.5;"></i>
                    No hay tareas pendientes o vencidas.
                </div>`;
            return;
        }

        const todayStr = today.toISOString().split('T')[0];

        container.innerHTML = tasks.map(t => {
            const dateStr = t.crm_due_date;
            const isToday = dateStr === todayStr;
            const isOverdue = t.alertD < today;
            const statusClass = isToday ? 'today' : (isOverdue ? 'overdue' : '');
            const priorityColor = getPriorityColor(t.priority);
            
            return `
                <div class="task-item ${statusClass}" onclick="openCardModalFromTask('${t.chat_id}')">
                    <div class="task-date ${statusClass}">
                        ${formatDate(dateStr)} ${isToday ? '(HOY)' : (isOverdue ? '(VENCIDO)' : '')}
                    </div>
                    <div class="task-title">${t.name}</div>
                    <div class="task-footer-info">
                        <span class="task-badge-status"><i class="fas fa-columns"></i> ${t.crm_status}</span>
                        <span class="task-badge-priority" style="border-left: 3px solid ${priorityColor}; padding-left: 5px;">
                            ${t.priority}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('[Tasks] Error:', e);
        container.innerHTML = '<div class="tasks-empty" style="color:#ef4444;">Error al cargar tareas en el dashboard.</div>';
    }
}


async function openCardModalFromTask(chatId) {
    // Buscar el ticket asociado a este chat
    const ticket = allTickets.find(t => t.chat_id === chatId);
    if (ticket) {
        openCardModal(ticket.id);
    } else {
        // Si no hay ticket abierto en el tablero, saltar al backoffice
        localStorage.setItem('activeChat', chatId);
        window.location.href = '/backoffice';
    }
}
window.openCardModalFromTask = openCardModalFromTask;
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
        // Priorizar el posicionamiento manual del metadata, pero caer al crm_status de la DB si es nuevo
        const columnId = metadata.columnId || lead?.crm_status || 'UNASSIGNED';
        
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
    
    card.onclick = (e) => {
        if (e.target.closest('button')) return;
        localStorage.setItem('activeChat', ticket.chat_id);
        window.location.href = '/backoffice';
    };
    
    const tags = (lead?.tags || []).map(t => 
        `<span class="card-tag" style="background:${t.color}">${t.name}</span>`
    ).join('');

    const phone = ticket.chat_id ? ticket.chat_id.split('@')[0] : 'Desconocido';
    const email = lead?.email || '';
    const cuit = lead?.cuit_dni || '';
    const product = lead?.offered_product || ticket.tipo || '';
    const alertDateStr = metadata.alertDate ? formatDate(metadata.alertDate) : 'Sin alerta';

    card.innerHTML = `
        <div class="priority-indicator" style="background:${getPriorityColor(metadata.priority)}"></div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="card-tags">${tags}</div>
            <div style="font-size:0.6rem; font-family:monospace; opacity:0.5; background:var(--bg-header); padding:2px 6px; border-radius:4px; margin-top:8px; margin-right:8px;">
                REF: ${ticket.id.slice(-8).toUpperCase()}
            </div>
        </div>
        <div class="card-type-badge">
            <i class="fas fa-shopping-bag"></i> ${product}
        </div>
        <div class="card-title">${ticket.titulo || 'Sin título'} ${cuit ? `<span style="font-size:0.7rem; opacity:0.6;">(${cuit})</span>` : ''}</div>
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
            <div style="display:flex; gap:8px;">
                <button class="btn-action btn-action-primary" title="Cerrar Lead" onclick="event.stopPropagation(); confirmCloseTicket('${ticket.id}')">
                    <i class="fas fa-check"></i>
                </button>
                <button class="btn-action btn-action-primary" title="Ver Detalles/Editar" onclick="event.stopPropagation(); openCardModal('${ticket.id}')">
                    <i class="fas fa-pen"></i>
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
                
                // Sincronizar crm_status con el ID de la columna (más robusto para integraciones)
                const ticket = allTickets.find(t => t.id === ticketId);
                if (ticket && ticket.chat_id) {
                    await updateLeadStatus(ticket.chat_id, newColumnId);
                }

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
    const notes = lead?.notes || metadata.customNotes || '';
    
    document.getElementById('edit-lead-id').value = ticketId;
    const refElement = document.getElementById('modal-ticket-ref');
    if (refElement) refElement.innerText = `REF: ${ticketId.slice(-8).toUpperCase()}`;
    
    document.getElementById('edit-ticket-title').value = ticket.titulo || '';
    document.getElementById('edit-alert-date').value = metadata.alertDate || '';
    document.getElementById('edit-priority').value = metadata.priority || 'Media';
    document.getElementById('edit-custom-notes').value = notes;
    
    // Campos del Lead Expandidos
    document.getElementById('edit-lead-name').value = lead?.name || '';
    document.getElementById('edit-lead-email').value = lead?.email || '';
    document.getElementById('edit-lead-source').value = lead?.source || '';
    document.getElementById('edit-lead-phone').value = ticket.chat_id ? ticket.chat_id.split('@')[0] : 'Desconocido';
    document.getElementById('edit-lead-cuit').value = lead?.cuit_dni || '';
    document.getElementById('edit-lead-address').value = lead?.address || '';
    document.getElementById('edit-lead-tax-status').value = lead?.tax_status || 'Cons. Final';
    document.getElementById('edit-lead-offered-product').value = lead?.offered_product || ticket.tipo || '';

    // Carga de asignación
    if (isAdmin) {
        const selectAssign = document.getElementById('edit-lead-assignee');
        if (selectAssign) selectAssign.value = lead?.assigned_to || '';
    }

    // Cargar opciones de estado basadas en las columnas
    const selectStatus = document.getElementById('edit-lead-status');
    if (selectStatus) {
        selectStatus.innerHTML = columns.map(c => `<option value="${c.id}">${c.title}</option>`).join('');
        selectStatus.value = metadata.columnId || 'UNASSIGNED';
    }

    window.applyCRMConfig(); // Aplicar orden y visibilidad
    renderLeadTags(); // Renderizar etiquetas

    document.getElementById('additional-notes-list').innerHTML = '';
    document.getElementById('card-modal').classList.add('active');
}

// --- Tag Management CRM ---
async function fetchTags() {
    try {
        const res = await fetch(`/api/backoffice/tags?token=${activeToken}`);
        botTags = await res.json();
    } catch (e) {
        console.error('[fetchTags] Error:', e);
    }
}

function renderLeadTags() {
    const ticket = allTickets.find(t => t.id === currentEditId);
    if (!ticket) return;
    const lead = allLeads.find(l => l.id === ticket.chat_id);
    const assignedTagIds = (lead?.tags || []).map(t => typeof t === 'string' ? t : t.id);

    const currentList = document.getElementById('current-lead-tags');
    const availableList = document.getElementById('available-tags-to-assign');
    if (!currentList || !availableList) return;

    // Etiquetas actuales
    currentList.innerHTML = (lead?.tags || []).map(t => {
        const tag = typeof t === 'string' ? botTags.find(bt => bt.id === t) : t;
        if (!tag) return '';
        return `
            <div class="tag-pill" style="background:${tag.color || '#6366f1'}">
                ${tag.name} <i class="fas fa-times" onclick="removeTagFromLead('${tag.id}')" style="margin-left:5px; cursor:pointer;"></i>
            </div>
        `;
    }).join('');

    // Gestión de etiquetas
    availableList.innerHTML = botTags.map(t => {
        const isAssigned = assignedTagIds.includes(t.id);
        return `
            <div onclick="${isAssigned ? 'removeTagFromLead' : 'addTagToLead'}('${t.id}')" 
                 class="tag-pill" 
                 style="background:${t.color || '#6366f1'}; cursor:pointer; opacity:${isAssigned ? 1 : 0.6}; transform:${isAssigned ? 'scale(1.05)' : 'scale(1)'}; border:${isAssigned ? '2px solid white' : '1px solid transparent'}">
                ${t.name} ${isAssigned ? '✓' : '+'}
            </div>
        `;
    }).join('');
}

window.addTagToLead = async (tagId) => {
    const ticket = allTickets.find(t => t.id === currentEditId);
    if (!ticket) return;
    
    try {
        const res = await fetch(`/api/backoffice/chat/${encodeURIComponent(ticket.chat_id)}/tags/${tagId}?token=${activeToken}`, {
            method: 'POST'
        });
        if (res.ok) {
            // Actualizar localmente el lead
            const lead = allLeads.find(l => l.id === ticket.chat_id);
            if (lead) {
                if (!lead.tags) lead.tags = [];
                const tag = botTags.find(t => t.id === tagId);
                if (tag) lead.tags.push(tag);
            }
            renderLeadTags();
            renderBoard();
        }
    } catch (e) {
        console.error(e);
    }
};

window.removeTagFromLead = async (tagId) => {
    const ticket = allTickets.find(t => t.id === currentEditId);
    if (!ticket) return;

    try {
        const res = await fetch(`/api/backoffice/chat/${encodeURIComponent(ticket.chat_id)}/tags/${tagId}?token=${activeToken}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            // Actualizar localmente el lead
            const lead = allLeads.find(l => l.id === ticket.chat_id);
            if (lead) {
                lead.tags = lead.tags.filter(t => (typeof t === 'string' ? t : t.id) !== tagId);
            }
            renderLeadTags();
            renderBoard();
        }
    } catch (e) {
        console.error(e);
    }
};

window.syncStatusToColumn = (statusName) => {
    const col = columns.find(c => c.title === statusName);
    if (col && currentEditId) {
        if (!crmData[currentEditId]) crmData[currentEditId] = {};
        crmData[currentEditId].columnId = col.id;
        console.log(`[CRM] Sincronizando estado ${statusName} con columna ${col.id}`);
    }
};

async function updateLeadStatus(chatId, status) {
    try {
        await fetch(`/api/backoffice/chat/${chatId}/contact?token=${activeToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ crm_status: status })
        });
    } catch (e) {
        console.error('[CRM] Error actualizando status:', e);
    }
}

window.addNewNoteUI = () => {
    const container = document.getElementById('additional-notes-list');
    const date = new Date().toLocaleDateString();
    const noteDiv = document.createElement('div');
    noteDiv.className = 'modal-section';
    noteDiv.innerHTML = `
        <label style="color:var(--primary); font-size:0.8rem; font-weight:600;">
            <i class="fas fa-plus"></i> Nota Adicional ${date}
        </label>
        <textarea class="crm-input additional-note-box" rows="2" placeholder="Escribe aquí la nota adicional..."></textarea>
    `;
    container.appendChild(noteDiv);
}

window.openWhatsAppDirect = () => {
    const phone = document.getElementById('edit-lead-phone').value;
    if (!phone || phone === 'Desconocido') {
        showToast('❌ No hay un número válido registrado.', 'error');
        return;
    }
    // Limpiar el número de cualquier caracter no numérico (especialmente para wa.me)
    const cleanPhone = phone.replace(/\D/g, '');
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
}

function closeCardModal() {
    document.getElementById('card-modal').classList.remove('active');
}

document.getElementById('card-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const ticket = allTickets.find(t => t.id === currentEditId);
    const chatId = ticket?.chat_id;
    const metadata = crmData[currentEditId] || { columnId: 'UNASSIGNED' };
    const columnTitle = columns.find(c => c.id === metadata.columnId)?.title || 'CRM';

    // 1. Datos de Contacto (Lead)
    let mainNotes = document.getElementById('edit-custom-notes').value;
    const additionalNotes = Array.from(document.querySelectorAll('.additional-note-box'))
        .map(box => box.value.trim())
        .filter(val => val !== '');

    if (additionalNotes.length > 0) {
        const date = new Date().toLocaleDateString();
        mainNotes += `\n\n--- [${columnTitle}] Added on ${date} ---\n` + additionalNotes.join('\n');
    }

    const leadData = {
        name: document.getElementById('edit-lead-name').value,
        email: document.getElementById('edit-lead-email').value,
        source: document.getElementById('edit-lead-source').value,
        cuit_dni: document.getElementById('edit-lead-cuit').value,
        address: document.getElementById('edit-lead-address').value,
        tax_status: document.getElementById('edit-lead-tax-status').value,
        offered_product: document.getElementById('edit-lead-offered-product').value,
        crm_status: document.getElementById('edit-lead-status').value,
        crm_due_date: document.getElementById('edit-alert-date').value || null,
        priority: document.getElementById('edit-priority').value || 'Media',
        notes: mainNotes
    };

    // 2. Metadatos del CRM (Tablero)
    metadata.alertDate = document.getElementById('edit-alert-date').value;
    metadata.priority = document.getElementById('edit-priority').value;
    metadata.customNotes = leadData.notes;
    metadata.columnId = leadData.crm_status; 
    
    crmData[currentEditId] = metadata;

    const ticketTitle = document.getElementById('edit-ticket-title').value;

    showToast('💾 Guardando...', 'success');

    try {
        await saveCRMMetadata();
        
        // Usar el endpoint unificado para actualizar Ticket y Lead
        await fetch(`/api/backoffice/crm/ticket/${currentEditId}?token=${activeToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: ticketTitle,
                priority: leadData.priority,
                notas: mainNotes,
                contact: leadData
            })
        });

        if (chatId && isAdmin) {
            // Guardar asignación si es admin
            const assignee = document.getElementById('edit-lead-assignee').value;
            await fetch(`/api/backoffice/chat/assign?token=${activeToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId, userId: assignee || null })
            });
        }
        
        closeCardModal();
        await syncCRM();
        showToast('Ficha de cliente actualizada');
    } catch (e) {
        console.error('Error al guardar:', e);
        showToast('Error al guardar ficha', 'error');
    }
};

// --- Creación Manual de Leads ---
function openNewLeadModal() { document.getElementById('new-lead-modal').classList.add('active'); }
function closeNewLeadModal() { document.getElementById('new-lead-modal').classList.remove('active'); }
window.openNewLeadModal = openNewLeadModal;
window.closeNewLeadModal = closeNewLeadModal;

document.getElementById('new-lead-form').onsubmit = async (e) => {
    e.preventDefault();
    const chatId = document.getElementById('new-lead-id').value.trim();
    const name = document.getElementById('new-lead-name').value.trim();
    const product = document.getElementById('new-lead-product').value.trim();

    showToast('🚀 Creando Lead Card...', 'success');
    try {
        const res = await fetch(`/api/backoffice/chat/manual-lead?token=${activeToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId,
                details: {
                    name,
                    offered_product: product,
                    source: 'Manual CRM',
                    notes: `Lead creado manualmente: ${product}`
                }
            })
        });
        const data = await res.json();
        if (data.success) {
            closeNewLeadModal();
            await syncCRM();
            showToast('✅ Lead Card creada con éxito');
            // Abrir automáticamente la ficha para completar datos
            if (data.ticket?.id) setTimeout(() => openCardModal(data.ticket.id), 500);
        } else throw new Error(data.error);
    } catch (err) {
        showToast('❌ Error: ' + err.message, 'error');
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
            list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No hay leads cerrados.</div>';
            return;
        }

        // Filtro estricto: Solo mostrar si el estado es 'Cerrado' y TIENE fecha de cierre en metadata
        const validClosed = closedTickets.filter(t => {
            const metadata = crmData[t.id] || {};
            return t.estado === 'Cerrado' && metadata.closedAt;
        });

        if (validClosed.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No hay registros completos de cierre todavía.</div>';
            return;
        }

        list.innerHTML = validClosed.map(t => {
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
                        <button class="btn-action btn-action-primary" onclick="localStorage.setItem('activeChat', '${t.chat_id}'); window.location.href='/backoffice'" title="Ver Chat">
                            <i class="fas fa-comments"></i>
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

// --- Gestión de Usuarios (Equipo) ---

async function loadTeam() {
    if (!isAdmin) return;
    try {
        const res = await fetch(`/api/backoffice/users?token=${activeToken}`);
        teamUsers = await res.json();
        renderUsersList();
        renderAssigneeSelect();
    } catch (e) {
        console.error('Error al cargar equipo:', e);
    }
}

function renderUsersList() {
    const list = document.getElementById('users-list');
    if (!list) return;
    list.innerHTML = teamUsers.map(u => `
        <div style="padding: 12px 15px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
            <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:32px; height:32px; background:var(--bg); border-radius:50%; display:flex; align-items:center; justify-content:center; color:var(--accent);">
                    <i class="fas fa-user"></i>
                </div>
                <div>
                    <strong style="color:var(--text); font-size: 0.95rem;">${u.username}</strong>
                    <div style="font-size: 11px; color: var(--text-dim);">${u.role === 'admin' ? 'Administrador' : 'Operador'}</div>
                </div>
            </div>
            <span class="status-badge" style="background: ${u.role === 'admin' ? '#6366f1' : '#059669'}; color: white; border: none; font-size: 10px; padding: 4px 8px;">
                ${u.role.toUpperCase()}
            </span>
        </div>
    `).join('') || '<div style="padding: 30px; text-align: center; color: var(--text-dim);">No hay usuarios registrados</div>';
}

function renderAssigneeSelect() {
    const select = document.getElementById('edit-lead-assignee');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">Sin asignar (Libre)</option>' + 
        teamUsers.map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`).join('');
    select.value = currentVal;
}

window.openNewUserModal = () => {
    document.getElementById('modal-users').classList.add('active');
    loadTeam();
};

window.saveNewUser = async () => {
    const username = document.getElementById('new-user-name').value.trim();
    const password = document.getElementById('new-user-pass').value.trim();
    const role = document.getElementById('new-user-role').value;
    const status = document.getElementById('user-creation-status') || { textContent: '' };

    if (!username || !password) {
        showToast('⚠️ Completa usuario y contraseña', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/backoffice/users?token=${activeToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Usuario creado con éxito');
            document.getElementById('new-user-name').value = '';
            document.getElementById('new-user-pass').value = '';
            await loadTeam();
        } else {
            showToast('❌ Error: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('❌ Error de conexión', 'error');
    }
};

// --- Configuración Dinámica del CRM ---
window.toggleCRMConfigModal = () => {
    const modal = document.getElementById('crm-config-modal');
    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
        renderCRMConfigFields();
    }
};

// fetchCRMConfig ahora está en crm-common.js

window.saveCRMConfig = async () => {
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
            showToast('✅ Configuración guardada');
            window.toggleCRMConfigModal();
            window.applyCRMConfig();
        }
    } catch (e) {
        console.error(e);
    }
}

// applyCRMConfig ahora está en crm-common.js

function renderCRMConfigFields() {
    const list = document.getElementById('crm-fields-list');
    if (!list) return;

    list.innerHTML = '';
    window.crmConfig.sort((a, b) => a.order - b.order).forEach((field, index) => {
        const item = document.createElement('div');
        item.className = 'sortable-item';
        item.draggable = true;
        item.dataset.id = field.id;
        item.dataset.index = index;
        
        item.innerHTML = `
            <i class="fas fa-grip-lines sort-handle"></i>
            <div style="flex:1; display:flex; align-items:center; gap:10px;">
                <input type="checkbox" ${field.visible ? 'checked' : ''} onchange="updateFieldVisibility('${field.id}', this.checked)">
                <span style="font-size:0.9rem; font-weight:600;">${field.label}</span>
            </div>
        `;

        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', () => item.classList.remove('dragging'));

        list.appendChild(item);
    });
}

window.updateFieldVisibility = (id, visible) => {
    const field = window.crmConfig.find(f => f.id === id);
    if (field) field.visible = visible;
};

let dragSrcEl = null;
function handleDragStart(e) {
    e.currentTarget.classList.add('dragging');
    dragSrcEl = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    
    if (dragSrcEl !== e.currentTarget) {
        const fromId = dragSrcEl.getAttribute('data-id');
        const toId = e.currentTarget.getAttribute('data-id');
        
        const fromIndex = window.crmConfig.findIndex(f => f.id === fromId);
        const toIndex = window.crmConfig.findIndex(f => f.id === toId);
        
        if (fromIndex !== -1 && toIndex !== -1) {
            const [movedItem] = window.crmConfig.splice(fromIndex, 1);
            window.crmConfig.splice(toIndex, 0, movedItem);
            
            // Re-asignar órdenes
            window.crmConfig.forEach((f, idx) => f.order = idx);
            renderCRMConfigFields();
        }
    }
    return false;
}

// --- Tasks Dashboard Logic ---

// --- Real-time Updates via Socket.IO ---
/* global io */
if (typeof io !== 'undefined') {
    const socket = io();
    console.log('📡 [Socket] Conectado para actualizaciones en tiempo real');

    socket.on('contact_updated', (payload) => {
        console.log('📡 [Socket] Contacto actualizado:', payload.chatId);
        // Si el contacto actualizado es uno de los que estamos viendo, resincronizar
        syncCRM();
    });

    socket.on('ticket_updated', (payload) => {
        console.log('📡 [Socket] Ticket actualizado o nuevo');
        syncCRM();
    });

    socket.on('new_message', (payload) => {
        // Opcional: mostrar una notificación visual si llega un mensaje nuevo a un lead activo
    });
}
