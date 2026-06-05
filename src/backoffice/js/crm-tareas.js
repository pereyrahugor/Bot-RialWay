/* global Sortable, FB, metaAppId, showToast, _csdRebuild, _csdSync */
(function() {
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
let standardColumns = [
    { id: 'UNASSIGNED', title: 'Tickets Nuevos', fixed: true },
    { id: 'contactado', title: 'Contactado' },
    { id: 'negociacion', title: 'En Negociación' },
    { id: 'propuesta', title: 'Propuesta Enviada' },
    { id: 'cierre', title: 'Cierre' }
];

// --- Helper Date Formatting ---
function getLocalDateString(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// --- Inicialización ---
async function _initCRMTareasPage() {
    console.log('🚀 Iniciando CRM Tareas como:', userName, `(${userRole})`);
    
    // Mostrar botones de admin si corresponde
    if (isAdmin) {
        const btnNewUser = document.getElementById('btn-new-user');
        const assigneeSection = document.getElementById('assignee-section');
        if (btnNewUser) btnNewUser.style.display = 'block';
        if (assigneeSection) assigneeSection.style.display = 'block';
        
        // Cargar equipo para los selects
        await loadTeam();
    }

    // Cargar etiquetas
    await fetchTags();

    // Cargar columnas y campos dinámicos
    await Promise.all([
        loadCRMState(),
        window.fetchCRMConfig()
    ]);
    
    // Sincronizar datos y renderizar columnas
    await syncCRM();

    // Verificamos si hay un ticket pendiente de abrir (viniendo del Backoffice)
    const pendingId = localStorage.getItem('pendingTicket');
    if (pendingId) {
        localStorage.removeItem('pendingTicket');
        localStorage.removeItem('activeChat');
        console.log('[CRM Tareas] Apertura automática de ticket:', pendingId);
        setTimeout(() => openCardModal(pendingId), 300);
    }
    
    // Auto-check de alertas visuales cada minuto (evitar acumulacion en re-visitas SPA)
    if (window._crmTareasAlertInterval) clearInterval(window._crmTareasAlertInterval);
    window._crmTareasAlertInterval = setInterval(checkAlertsVisual, 60000);

    _setupCRMTareasFormHandlers();

    // Re-afirmar globals de tareas (para que al volver desde CRM no queden los de CRM)
    window.syncCRM = syncCRM;
    window.openCardModal = openCardModal;
    window.closeCardModal = closeCardModal;
    window.closeColumnModal = () => {};

    console.log('✅ CRM Tareas Listo');
}

window.initCRMTareasView = _initCRMTareasPage;

// Exportar globalmente para botones HTML
window.syncCRM = syncCRM;
window.openCardModal = openCardModal;
window.closeCardModal = closeCardModal;
window.closeColumnModal = () => {};

async function loadCRMState() {
    try {
        const res = await fetch(`/api/backoffice/get-setting?key=CRM_COLUMNS&token=${activeToken}`);
        const data = await res.json();
        if (data.success && data.value) {
            standardColumns = JSON.parse(data.value);
            if (!standardColumns.some(c => c.id === 'UNASSIGNED')) {
                standardColumns.unshift({ id: 'UNASSIGNED', title: 'Tickets Nuevos', fixed: true });
            }
        }
    } catch (e) {
        console.log('Usando columnas estándar por defecto');
    }
}

async function syncCRM() {
    showToast('Sincronizando datos...', 'info');
    try {
        const [resLeads, resTickets] = await Promise.all([
            fetch(`/api/backoffice/leads?token=${activeToken}&limit=300`),
            fetch(`/api/backoffice/tickets?token=${activeToken}&estado=Abierto`) // Forzamos solo abiertos
        ]);

        const leadsData = await resLeads.json();
        allLeads = Array.isArray(leadsData) ? leadsData : [];
        
        const ticketsRaw = await resTickets.json();
        const ticketsData = Array.isArray(ticketsRaw) ? ticketsRaw : [];
        
        // Excluir Asistencia Externa y Cerrados
        allTickets = ticketsData.filter(t => t.tipo !== 'Asistencia Externa' && t.estado !== 'Cerrado');
        console.log(`[CRM Tareas] Tickets activos: ${allTickets.length}`);

        const resSettings = await fetch(`/api/backoffice/get-setting?key=CRM_METADATA&token=${activeToken}`);
        const setJson = await resSettings.json();
        if (setJson && setJson.success && setJson.value) {
            crmData = JSON.parse(setJson.value);
        } else {
            crmData = {};
        }

        renderBoard();
        showToast('Tareas Actualizadas', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error al sincronizar datos', 'error');
    }
}

function renderBoard() {
    const board = document.getElementById('kanban-board-inner');
    if (!board) return;
    board.innerHTML = '';
    const cols = [
        { id: 'overdue',  icon: 'fa-calendar-times',  color: '#ef4444', title: 'Vencidas' },
        { id: 'today',    icon: 'fa-calendar-day',    color: '#f59e0b', title: 'Hoy' },
        { id: 'tomorrow', icon: 'fa-calendar-minus',  color: '#3b82f6', title: 'Manana' },
        { id: 'week',     icon: 'fa-calendar-week',   color: '#10b981', title: 'Esta Semana' },
        { id: 'later',    icon: 'fa-calendar-plus',   color: '#8b5cf6', title: 'Mas Adelante' },
        { id: 'nodate',   icon: 'fa-calendar-xmark',  color: '#6b7280', title: 'Sin Fecha' },
    ];
    cols.forEach(col => {
        const colEl = document.createElement('div');
        colEl.className = 'kanban-column animate-fade';
        colEl.dataset.id = col.id;
        colEl.innerHTML = `
            <div class="column-header">
                <div class="column-title-group">
                    <i class="fas ${col.icon}" style="color:${col.color};"></i>
                    <span class="column-title">${col.title}</span>
                </div>
                <span class="column-badge" id="badge-${col.id}">0</span>
            </div>
            <div class="kanban-cards" id="cards-${col.id}"></div>
        `;
        board.appendChild(colEl);
    });
    distributeCards();
}

function distributeCards() {

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const weekLimit = new Date(today);
    weekLimit.setDate(today.getDate() + 7);
    weekLimit.setHours(23, 59, 59, 999);

    allTickets.forEach(ticket => {
        const lead = allLeads.find(l => l.id === ticket.chat_id);
        const metadata = crmData[ticket.id] || {};
        
        // Prioridad: 1. Metadata del Kanban, 2. Campo del Lead en DB (Spliteado de timestamp)
        let alertDateStr = metadata.alertDate || (lead?.crm_due_date ? lead.crm_due_date.split('T')[0] : null);
        
        let columnId = 'nodate';

        if (alertDateStr) {
            const dateParts = alertDateStr.split('-');
            const alertD = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
            alertD.setHours(0, 0, 0, 0);
            
            if (alertD < today) {
                columnId = 'overdue';
            } else if (alertD.getTime() === today.getTime()) {
                columnId = 'today';
            } else if (alertD.getTime() === tomorrow.getTime()) {
                columnId = 'tomorrow';
            } else if (alertD <= weekLimit) {
                columnId = 'week';
            } else {
                columnId = 'later';
            }
        }

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
    card.dataset.chatId = ticket.chat_id;
    card.id = `card-${ticket.id}`;
    
    card.onclick = (e) => {
        if (e.target.closest('button')) return;
        localStorage.setItem('activeChat', ticket.chat_id);
        if (typeof window.navigate === 'function') window.navigate('/backoffice');
        else window.location.href = '/backoffice';
    };
    
    const tags = (lead?.tags || []).map(t => 
        `<span class="card-tag" style="background:${t.color}">${t.name}</span>`
    ).join('');

    const phone = ticket.chat_id ? ticket.chat_id.split('@')[0] : 'Desconocido';
    const email = lead?.email || '';
    const cuit = lead?.cuit_dni || '';
    const product = lead?.offered_product || ticket.tipo || '';
    
    let alertDateStr = metadata.alertDate || (lead?.crm_due_date ? lead.crm_due_date.split('T')[0] : null);
    const alertFormatted = alertDateStr ? formatDate(alertDateStr) : 'Sin alerta';

    // Helper para verificar visibilidad según configuración dinámica
    const isVisible = (fieldId) => {
        const f = (window.crmConfig || []).find(x => x.id === fieldId);
        return f ? f.visible !== false : true;
    };

    const priorityIndicatorHtml = isVisible('crm-priority') 
        ? `<div class="priority-indicator" style="background:${getPriorityColor(metadata.priority || lead?.priority)}"></div>`
        : '';

    const productBadgeHtml = isVisible('crm-product')
        ? `<div class="card-type-badge"><i class="fas fa-shopping-bag"></i> ${product}</div>`
        : '';

    let titleHtml = '';
    if (isVisible('crm-ticket-title')) {
        const cuilSpan = (cuit && isVisible('crm-cuit')) ? ` <span style="font-size:0.7rem; opacity:0.6;">(${cuit})</span>` : '';
        if (ticket.titulo && ticket.titulo.trim() !== '') {
            titleHtml = `<div class="card-title">${ticket.titulo}${cuilSpan}</div>`;
        } else if (cuilSpan) {
            titleHtml = `<div class="card-title">${cuilSpan}</div>`;
        }
    } else if (cuit && isVisible('crm-cuit')) {
        titleHtml = `<div class="card-title"><span style="font-size:0.7rem; opacity:0.6;">CUIL: ${cuit}</span></div>`;
    }

    const leadNameHtml = isVisible('crm-name')
        ? `<div class="card-lead-main"><i class="fas fa-user-circle"></i> ${lead?.name || 'Lead sin nombre'}</div>`
        : '';

    let detailsHtml = '';
    const phoneHtml = isVisible('crm-phone') ? `<div class="detail-item"><i class="fas fa-phone"></i> ${phone}</div>` : '';
    const emailHtml = (email && isVisible('crm-email')) ? `<div class="detail-item"><i class="fas fa-envelope"></i> ${email}</div>` : '';
    if (phoneHtml || emailHtml) {
        detailsHtml = `<div class="card-lead-details">${phoneHtml}${emailHtml}</div>`;
    }

    const alertHtml = isVisible('crm-due-date')
        ? `<div class="card-alert ${getAlertClass(alertDateStr)}" id="alert-card-${ticket.id}"><i class="fas fa-bell"></i> ${alertFormatted}</div>`
        : '';

    card.innerHTML = `
        ${priorityIndicatorHtml}
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div class="card-tags">${tags}</div>
            <div style="font-size:0.6rem; font-family:monospace; opacity:0.5; background:var(--bg-header); padding:2px 6px; border-radius:4px; margin-top:8px; margin-right:8px;">
                REF: ${ticket.id.slice(-8).toUpperCase()}
            </div>
        </div>
        ${productBadgeHtml}
        ${titleHtml}
        ${leadNameHtml}
        ${detailsHtml}
        <div class="card-footer">
            ${alertHtml}
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
    const colIds = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate'];
    colIds.forEach(id => {
        const count = document.querySelectorAll(`#cards-${id} .kanban-card`).length;
        const badge = document.getElementById(`badge-${id}`);
        if (badge) badge.innerText = count;
    });
}

// --- Modales Ficha Lead ---
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
    
    let alertDateStr = metadata.alertDate || (lead?.crm_due_date ? lead.crm_due_date.split('T')[0] : '');
    document.getElementById('edit-alert-date').value = alertDateStr;
    document.getElementById('edit-priority').value = metadata.priority || lead?.priority || 'Media';
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
        if (selectAssign) {
            selectAssign.value = lead?.assigned_to || '';
            _csdSync('edit-lead-assignee');
        }
    }

    // Cargar opciones de estado basadas en las columnas estándar
    const selectStatus = document.getElementById('edit-lead-status');
    if (selectStatus) {
        selectStatus.innerHTML = standardColumns.map(c => `<option value="${c.id}">${c.title}</option>`).join('');
        selectStatus.value = metadata.columnId || lead?.crm_status || 'UNASSIGNED';
        _csdRebuild('edit-lead-status');
        _csdSync('edit-lead-status');
    }

    window.applyCRMConfig(); // Aplicar orden y visibilidad
    renderLeadTags(); // Renderizar etiquetas

    document.getElementById('additional-notes-list').innerHTML = '';
    document.getElementById('card-modal').classList.add('active');
}

function closeCardModal() {
    document.getElementById('card-modal').classList.remove('active');
}

function _setupCRMTareasFormHandlers() {
    const cardForm = document.getElementById('card-edit-form');
    if (cardForm) cardForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!currentEditId) return;

        const ticket = allTickets.find(t => t.id === currentEditId);
        const chatId = ticket?.chat_id;
        const metadata = crmData[currentEditId] || { columnId: 'UNASSIGNED' };

        let mainNotes = document.getElementById('edit-custom-notes').value;
        const additionalNotes = Array.from(document.querySelectorAll('.additional-note-box'))
            .map(box => box.value.trim())
            .filter(val => val !== '');

        if (additionalNotes.length > 0) {
            const date = new Date().toLocaleDateString();
            mainNotes += `\n\n--- [Tareas] Added on ${date} ---\n` + additionalNotes.join('\n');
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

        metadata.alertDate = document.getElementById('edit-alert-date').value;
        metadata.priority = document.getElementById('edit-priority').value;
        metadata.customNotes = leadData.notes;
        metadata.columnId = leadData.crm_status;
        crmData[currentEditId] = metadata;

        const ticketTitle = document.getElementById('edit-ticket-title').value;
        showToast('Guardando...', 'info');

        try {
            await saveCRMMetadata();
            await fetch(`/api/backoffice/crm/ticket/${currentEditId}?token=${activeToken}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titulo: ticketTitle, priority: leadData.priority, notas: mainNotes, contact: leadData })
            });

            if (chatId && isAdmin) {
                const assignee = document.getElementById('edit-lead-assignee').value;
                await fetch(`/api/backoffice/chat/assign?token=${activeToken}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId, userId: assignee || null })
                });
            }
            closeCardModal();
            await syncCRM();
            showToast('Ficha de cliente actualizada', 'success');
        } catch (e) {
            console.error('Error al guardar:', e);
            showToast('Error al guardar ficha', 'error');
        }
    };

    const leadForm = document.getElementById('new-lead-form');
    if (leadForm) leadForm.onsubmit = async (e) => {
        e.preventDefault();
        const chatId = document.getElementById('new-lead-id').value.trim();
        const name = document.getElementById('new-lead-name').value.trim();
        const product = document.getElementById('new-lead-product').value.trim();

        showToast('Creando Lead Card...', 'info');
        try {
            const res = await fetch(`/api/backoffice/chat/manual-lead?token=${activeToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatId,
                    details: { name, offered_product: product, source: 'Manual CRM', notes: `Lead creado manualmente: ${product}` }
                })
            });
            const data = await res.json();
            if (data.success) {
                closeNewLeadModal();
                await syncCRM();
                showToast('Lead Card creada con éxito', 'success');
                if (data.ticket?.id) setTimeout(() => openCardModal(data.ticket.id), 500);
            } else throw new Error(data.error);
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    };
}

// --- Tag Management ---
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

    currentList.innerHTML = (lead?.tags || []).map(t => {
        const tag = typeof t === 'string' ? botTags.find(bt => bt.id === t) : t;
        if (!tag) return '';
        return `
            <div class="tag-pill" style="background:${tag.color || '#6366f1'}">
                ${tag.name} <i class="fas fa-times" onclick="removeTagFromLead('${tag.id}')" style="margin-left:5px; cursor:pointer;"></i>
            </div>
        `;
    }).join('');

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
            const lead = allLeads.find(l => l.id === ticket.chat_id);
            if (lead) {
                if (!lead.tags) lead.tags = [];
                const tag = botTags.find(t => t.id === tagId);
                if (tag) lead.tags.push(tag);
            }
            renderLeadTags();
            distributeCards();
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
            const lead = allLeads.find(l => l.id === ticket.chat_id);
            if (lead) {
                lead.tags = lead.tags.filter(t => (typeof t === 'string' ? t : t.id) !== tagId);
            }
            renderLeadTags();
            distributeCards();
        }
    } catch (e) {
        console.error(e);
    }
};

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
};

window.openWhatsAppDirect = () => {
    const phone = document.getElementById('edit-lead-phone').value;
    if (!phone || phone === 'Desconocido') {
        showToast('No hay un número válido registrado.', 'error');
        return;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
};

// --- Cierre de Leads ---
window.confirmCloseTicket = async (ticketId) => {
    if (!confirm('¿Seguro quieres cerrar este lead? Se moverá al historial de cerrados.')) return;
    
    showToast('Cerrando lead...', 'info');
    try {
        if (!crmData[ticketId]) crmData[ticketId] = {};
        crmData[ticketId].closedAt = new Date().toISOString();
        await saveCRMMetadata();

        await fetch(`/api/backoffice/tickets/${ticketId}?token=${activeToken}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Cerrado' })
        });

        await syncCRM();
        showToast('Lead cerrado con éxito', 'success');
    } catch (e) {
        console.error('Error cerrando ticket:', e);
        showToast('Error al cerrar ticket', 'error');
    }
};

window.openClosedLeadsModal = async () => {
    const modal = document.getElementById('closed-leads-modal');
    const list = document.getElementById('closed-leads-list');
    if (!modal || !list) return;
    modal.classList.add('active');
    list.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> Cargando historial...</div>';
    
    try {
        const res = await fetch(`/api/backoffice/tickets?token=${activeToken}&estado=Cerrado`);
        const closedTickets = await res.json();
        
        if (!closedTickets || closedTickets.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">No hay leads cerrados.</div>';
            return;
        }

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
                        <div style="font-size:0.9rem; color:var(--text-muted);"><i class="fas fa-user"></i> ${lead?.name || 'Lead sin nombre'} | <i class="fas fa-phone"></i> ${t.chat_id?.split('@')[0]}</div>
                        <div style="font-size:0.8rem; color:var(--accent); margin-top:5px;"><i class="fas fa-calendar-check"></i> Cerrado el: ${closedDate}</div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button class="btn-action btn-action-primary" onclick="localStorage.setItem('activeChat', '${t.chat_id}'); if(window.navigate) window.navigate('/backoffice'); else window.location.href='/backoffice';" title="Ver Chat">
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

// --- Gestión de Usuarios ---
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
    const list = document.getElementById('team-list-container');
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
    _csdRebuild('edit-lead-assignee');
    _csdSync('edit-lead-assignee');
}

window.openNewUserModal = () => {
    document.getElementById('modal-users').classList.add('active');
    loadTeam();
};

window.saveNewUser = async () => {
    const username = document.getElementById('new-user-name').value.trim();
    const password = document.getElementById('new-user-pass').value.trim();
    const role = document.getElementById('new-user-role').value;

    if (!username || !password) {
        showToast('Completa usuario y contraseña', 'warning');
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
            showToast('Usuario creado con éxito', 'success');
            document.getElementById('new-user-name').value = '';
            document.getElementById('new-user-pass').value = '';
            await loadTeam();
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
};

// --- Configuración Dinámica de Campos ---
window.toggleCRMConfigModal = () => {
    const modal = document.getElementById('crm-config-modal');
    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
        renderCRMConfigFields();
    }
};

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
            showToast('Configuración guardada', 'success');
            window.toggleCRMConfigModal();
            window.applyCRMConfig();
            distributeCards();
        }
    } catch (e) {
        console.error(e);
    }
};

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
            
            window.crmConfig.forEach((f, idx) => f.order = idx);
            renderCRMConfigFields();
        }
    }
    return false;
}

// --- Creación Manual de Leads ---
function openNewLeadModal() { document.getElementById('new-lead-modal').classList.add('active'); }
function closeNewLeadModal() { document.getElementById('new-lead-modal').classList.remove('active'); }
window.openNewLeadModal = openNewLeadModal;
window.closeNewLeadModal = closeNewLeadModal;

// --- Utilidades Visuales ---
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
    const today = getLocalDateString(new Date());
    if (date < today) return 'alert-active';
    if (date === today) return 'alert-today';
    return '';
}

function checkAlertsVisual() {
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
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        // Formato local preciso DD/MM
        return `${parts[2]}/${parts[1]}`;
    }
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}


// --- Real-time Updates via Socket.IO ---
/* global io */
if (typeof io !== 'undefined') {
    const socket = io();
    console.log('📡 [Socket Tareas] Conectado para actualizaciones en tiempo real');

    socket.on('contact_updated', (payload) => {
        console.log('📡 [Socket Tareas] Contacto actualizado:', payload.chatId);
        syncCRM();
    });

    socket.on('ticket_updated', (payload) => {
        console.log('📡 [Socket Tareas] Ticket actualizado');
        syncCRM();
    });
}
})();
