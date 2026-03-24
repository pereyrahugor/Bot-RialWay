/* global io, metaAppId, FB */
const token = localStorage.getItem('backoffice_token');
if (!token) window.location.href = '/login';

let activeChatId = null;
let chats = [];
let botTags = [];
let selectedFile = null;
let isSending = false;

// --- Tema Claro// El tema ahora se maneja en crm-common.js

// Paginación de chats
let chatOffset = 0;
const CHAT_LIMIT = 20;
let loadingChats = false;
let allChatsLoaded = false;

// Paginación de mensajes
let messageOffset = 0;
const MSG_LIMIT = 50;
let loadingMessages = false;
let allMessagesLoaded = false;

// Inicializar Socket.IO para tiempo real
const socket = io();

socket.on('connect', () => {
    console.log('✅ Conectado al servidor de tiempo real');
});

socket.on('new_message', (payload) => {
    console.log('📡 Nuevo mensaje recibido:', payload);
    if (activeChatId === payload.chatId) {
        fetchMessages(activeChatId, true);
    }
    fetchChats(true);
});

socket.on('bot_toggled', (payload) => {
    console.log('📡 Bot toggled:', payload);
    if (activeChatId === payload.chatId) {
        const toggle = document.getElementById('bot-toggle');
        toggle.checked = payload.enabled;
        updateBotStatusText(payload.enabled);
        updateInputState(payload.enabled);
    }
    fetchChats(true);
});

async function fetchChats(refresh = false) {
    if (loadingChats) return;
    if (refresh) {
        chatOffset = 0;
        allChatsLoaded = false;
    }
    if (allChatsLoaded && !refresh) return;

    const query = document.getElementById('search-input')?.value || '';
    const tagFilter = document.getElementById('filter-tag')?.value || '';

    loadingChats = true;
    try {
        const url = `/api/backoffice/chats?token=${token}&limit=${CHAT_LIMIT}&offset=${chatOffset}&search=${encodeURIComponent(query)}&tag=${tagFilter}`;
        const res = await fetch(url);
        if (res.status === 401) {
            logout();
            return;
        }
        
        const newChats = await res.json();
        if (newChats.length < CHAT_LIMIT) allChatsLoaded = true;

        if (refresh) {
            chats = newChats;
        } else {
            // Evitar duplicados si hay mensajes en tiempo real entrando
            const existingIds = chats.map(c => c.id);
            const filteredNew = newChats.filter(nc => !existingIds.includes(nc.id));
            chats = [...chats, ...filteredNew];
        }

        chatOffset = chats.length;
        renderChatList();
        
        // Auto-abrir chat si venimos desde el CRM
        if (!activeChatId) {
            const pendingChatId = localStorage.getItem('activeChat');
            if (pendingChatId) {
                localStorage.removeItem('activeChat');
                console.log('[CRM] Auto-abriendo chat:', pendingChatId);
                // Esperar un breve instante para asegurar que el DOM está listo
                setTimeout(() => selectChat(pendingChatId), 100);
                return;
            }
        }
        
        if (activeChatId) {
            const activeChat = chats.find(c => c.id === activeChatId);
            if (activeChat) {
                updateBotStatusText(activeChat.bot_enabled);
                updateInputState(activeChat.bot_enabled);
                const toggle = document.getElementById('bot-toggle');
                if (toggle) toggle.checked = activeChat.bot_enabled;
            }
        }
    } catch (e) { 
        console.error(e); 
    } finally {
        loadingChats = false;
    }
}

async function fetchBotTags() {
    try {
        const res = await fetch(`/api/backoffice/tags?token=${token}`);
        botTags = await res.json();
        renderTagManager();
        renderFilterDropdown();
    } catch (e) { console.error(e); }
}

let searchTimeout = null;
function handleSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        console.log('[Search] Disparando búsqueda en servidor...');
        fetchChats(true);
    }, 500);
}

function renderFilterDropdown() {
    const select = document.getElementById('filter-tag');
    const currentValue = select.value;
    select.innerHTML = '<option value="">Todas las etiquetas</option>' + 
        botTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    select.value = currentValue;
}

function renderChatList(listToRender = chats) {
    const list = document.getElementById('chat-list');
    list.innerHTML = listToRender.map(chat => {
        const initial = (chat.name || chat.id).charAt(0).toUpperCase();
        const avatarUrl = `/api/backoffice/profile-pic/${chat.id}?token=${token}`;
        
        const tagsHtml = (chat.tags || []).map(t => 
            `<span class="tag-pill" style="background:${t.color || '#6366f1'}">${t.name}</span>`
        ).join('');

        const statusBadge = chat.bot_enabled 
            ? `<span style="color: var(--accent); font-size: 0.75rem;">🤖 Bot</span>`
            : `<span style="color: #f87171; font-size: 0.75rem;">👤 Humano</span>`;

        return `
            <div class="chat-item ${activeChatId === chat.id ? 'active' : ''}" onclick="selectChat('${chat.id}')">
                <div class="chat-avatar">
                    <span style="position:relative; z-index:1;">${initial}</span>
                    <img src="${avatarUrl}" onerror="this.style.display='none'">
                </div>
                <div class="chat-info">
                    <div style="display:flex; justify-content:space-between; align-items: baseline;">
                        <div class="chat-phone">${chat.id.split('@')[0]}</div>
                        ${statusBadge}
                    </div>
                    <div class="chat-name-small">${chat.name || ''}</div>
                    <div class="chat-tags-list" style="display:flex; flex-wrap:wrap; margin-top:2px;">${tagsHtml}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function selectChat(id) {
    activeChatId = id;
    const chat = chats.find(c => c.id === id);
    
    document.getElementById('active-chat-phone').innerText = chat.id.split('@')[0];
    document.getElementById('active-chat-name').innerText = chat.name || 'Sin nombre';
    
    const headerAvatar = document.getElementById('active-chat-avatar');
    const initial = (chat.name || chat.id).charAt(0).toUpperCase();
    const avatarUrl = `/api/backoffice/profile-pic/${chat.id}?token=${token}`;
    
    headerAvatar.innerHTML = `
        <span style="position:relative; z-index:1;">${initial}</span>
        <img src="${avatarUrl}" style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0; z-index:2;" onerror="this.style.display='none'">
    `;
    
    const botToggle = document.getElementById('bot-toggle');
    botToggle.disabled = false;
    botToggle.checked = chat.bot_enabled;
    updateBotStatusText(chat.bot_enabled);
    updateInputState(chat.bot_enabled);

    renderActiveChatTags();
    populateCRMFields(chat);
    
    if (document.getElementById('crm-panel').classList.contains('active')) {
        renderTagManager();
    }

    renderChatList();
    loadCRMJump(id); // Cargamos los datos para el "Salto al CRM"
    fetchMessages(id, true);
}

function renderActiveChatTags() {
    const chat = chats.find(c => c.id === activeChatId);
    const container = document.getElementById('active-chat-tags');
    if (chat && chat.tags) {
        container.innerHTML = chat.tags.map(t => 
            `<span class="tag-pill" style="background:${t.color}">${t.name}</span>`
        ).join('');
    } else {
        container.innerHTML = '';
    }
}

function updateBotStatusText(enabled) {
    const txt = document.getElementById('bot-status-text');
    if (!txt) return;
    const isEnabled = enabled === true || enabled === 'true' || enabled === 1;
    txt.innerText = isEnabled ? 'Bot Activo' : 'Intervención Humana';
    txt.className = isEnabled ? 'status-bot' : 'status-human';
}

function updateInputState(botEnabled) {
    const input = document.getElementById('message-input');
    const btn = document.getElementById('send-btn');
    const attachBtn = document.getElementById('attach-btn');
    if (!input || !btn || !attachBtn) return;

    // Normalización estricta a booleano
    const isBotEnabled = (botEnabled === true || botEnabled === 'true' || botEnabled === 1 || botEnabled === '1');
    
    console.log(`[UI] Actualizando estado de input. Bot habilitado: ${isBotEnabled}`);

    // Bloqueamos el input si el bot está activo para evitar interferencias
    input.disabled = isBotEnabled;
    btn.disabled = isBotEnabled;
    attachBtn.disabled = isBotEnabled;
    
    if (isBotEnabled) {
        input.parentElement.style.borderColor = 'var(--accent)';
        input.style.opacity = '0.6';
        input.placeholder = "🤖 Bot activo - Desactiva para intervenir";
    } else {
        input.parentElement.style.borderColor = '#f87171';
        input.style.opacity = '1';
        input.placeholder = "Escribe un mensaje aquí";
    }
}

let allMessages = [];

async function fetchMessages(chatId, reset = false) {
    if (loadingMessages) return;
    if (reset) {
        messageOffset = 0;
        allMessagesLoaded = false;
        allMessages = [];
    }
    if (allMessagesLoaded && !reset) return;

    loadingMessages = true;
    try {
        const res = await fetch(`/api/backoffice/messages/${chatId}?token=${token}&limit=${MSG_LIMIT}&offset=${messageOffset}`);
        const newMessages = await res.json();
        
        if (newMessages.length < MSG_LIMIT) allMessagesLoaded = true;

        const container = document.getElementById('messages');
        const oldScrollHeight = container.scrollHeight;

        // Concatenar al inicio (los nuevos/viejos mensajes según el offset)
        allMessages = [...newMessages, ...allMessages];
        
        renderMessages();

        if (reset) {
            container.scrollTop = container.scrollHeight;
        } else {
            container.scrollTop = container.scrollHeight - oldScrollHeight;
        }

        messageOffset += newMessages.length;
    } catch (e) {
        console.error(e);
    } finally {
        loadingMessages = false;
    }
}

function renderMessages() {
    const container = document.getElementById('messages');
    let html = '';
    let lastDate = null;

    allMessages.forEach(m => {
        const date = new Date(m.created_at);
        const dateStr = date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
        
        if (dateStr !== lastDate) {
            html += `<div class="date-separator"><span>${dateStr}</span></div>`;
            lastDate = dateStr;
        }
        html += generateMessageHtml(m);
    });

    container.innerHTML = html;
}

function generateMessageHtml(m) {
    const date = new Date(m.created_at);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let contentHtml = m.content || '';
    const type = m.type || 'text';
    
    const isImageUrl = type === 'image' || contentHtml.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) || (contentHtml.includes('/uploads/') && contentHtml.match(/\.(jpeg|jpg|gif|png|webp|svg)/i));
    const isVideoUrl = type === 'video' || contentHtml.match(/\.(mp4|webm|ogg)$/i) || (contentHtml.includes('/uploads/') && contentHtml.match(/\.(mp4|webm|ogg)/i));
    const isFileUrl = type === 'document' || (contentHtml.includes('/uploads/') && !isImageUrl && !isVideoUrl);

    if (isImageUrl && contentHtml) {
        contentHtml = `<div class="msg-media"><img src="${contentHtml}" alt="imagen"></div>`;
    } else if (isVideoUrl && contentHtml) {
        contentHtml = `<div class="msg-media"><video src="${contentHtml}" controls></video></div>`;
    } else if (isFileUrl && contentHtml) {
        const fileName = contentHtml.split('/').pop();
        contentHtml = `<div class="msg-file"><a href="${contentHtml}" target="_blank">📄 Documento adjunto (${fileName})</a></div>`;
    }
    
    return `
        <div class="msg ${m.role}">
            <div class="msg-content">${contentHtml}</div>
            <span class="msg-time">${time}</span>
        </div>
    `;
}

async function toggleBot(enabled) {
    const res = await fetch('/api/backoffice/toggle-bot', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'token=' + token
        },
        body: JSON.stringify({ chatId: activeChatId, enabled })
    });

    if (res.ok) {
        const chat = chats.find(c => c.id === activeChatId);
        chat.bot_enabled = enabled;
        updateBotStatusText(enabled);
        updateInputState(enabled);
        renderChatList();
    }
}

function handleFileSelect(input) {
    if (input.files && input.files[0]) {
        selectedFile = input.files[0];
        document.getElementById('message-input').placeholder = `Archivo: ${selectedFile.name} (Escribe un comentario opcional)`;
        document.getElementById('message-input').focus();
    }
}

async function sendMessage() {
    if (isSending) return;
    isSending = true;

    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content && !selectedFile) {
        console.log('⚠️ Intento de envío vacío ignorado');
        isSending = false;
        return;
    }
    if (!activeChatId) {
        console.warn('⚠️ No hay chat activo seleccionado');
        isSending = false;
        return;
    }

    console.log(`📤 Enviando mensaje a ${activeChatId}...`, { hasFile: !!selectedFile });
    const btn = document.getElementById('send-btn');
    const originalBtnText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '...';

    try {
        let res;
        const token = localStorage.getItem('backoffice_token');

        if (!selectedFile) {
            // Enviar como JSON simple (más confiable para texto)
            res = await fetch('/api/backoffice/send-message', {
                method: 'POST',
                headers: { 
                    'Authorization': 'token=' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    chatId: activeChatId,
                    message: content
                })
            });
        } else {
            // Enviar como FormData (necesario para archivos)
            const formData = new FormData();
            formData.append('chatId', activeChatId);
            if (content) formData.append('message', content);
            formData.append('file', selectedFile);

            res = await fetch('/api/backoffice/send-message', {
                method: 'POST',
                headers: { 
                    'Authorization': 'token=' + token
                },
                body: formData
            });
        }

        if (res.ok) {
            const data = await res.json();
            if (data.warning) {
                console.warn('⚠️ Advertencia del servidor:', data.warning);
                alert('⚠️ ' + data.warning);
            } else {
                console.log('✅ Mensaje enviado exitosamente');
            }
            input.value = '';
            input.placeholder = "Escribe un mensaje aquí";
            selectedFile = null;
            document.getElementById('file-input').value = '';
            fetchMessages(activeChatId, true);
        } else {
            let errorMsg = 'Error desconocido';
            const text = await res.text();
            try {
                const errorData = JSON.parse(text);
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                errorMsg = text || res.statusText || 'Error del servidor';
            }
            console.error('❌ Error del servidor:', errorMsg);
            alert('Error al enviar mensaje: ' + errorMsg);
        }
    } catch (err) {
        console.error('❌ Error de red:', err);
        alert('Error de conexión al enviar el mensaje');
    } finally {
        isSending = false;
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
    }
}

// CRM & Tag Management Functions
function toggleCRMPanel() {
    const panel = document.getElementById('crm-panel');
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        const chat = chats.find(c => c.id === activeChatId);
        if (chat) populateCRMFields(chat);
        renderTagManager();
    }
}

async function loadCRMJump(chatId) {
    const container = document.getElementById('crm-jump-container');
    const select = document.getElementById('crm-lead-jump');
    if (!container || !select) return;

    try {
        // Buscamos TODOS los tickets para este chat_id (de cualquier estado)
        const res = await fetch(`/api/backoffice/tickets?token=${token}&chatId=${chatId}&limit=50&estado=null`);
        const tickets = await res.json();

        if (Array.isArray(tickets) && tickets.length > 0) {
            container.style.display = 'flex';
            select.innerHTML = '<option value="">🚀 Ver en CRM...</option>' + 
                tickets.map(t => `<option value="${t.id}" data-chat="${t.chat_id}">${t.titulo} (${t.tipo})</option>`).join('');
        } else {
            container.style.display = 'none';
        }
    } catch (e) {
        console.error('[loadCRMJump] Error:', e);
        container.style.display = 'none';
    }
}

function jumpToCRM() {
    const select = document.getElementById('crm-lead-jump');
    const ticketId = select.value;
    if (!ticketId) return;

    const option = select.options[select.selectedIndex];
    const chatId = option.getAttribute('data-chat');

    // Guardamos ambos IDs para que el CRM abra el modal específico
    localStorage.setItem('activeChat', chatId);
    localStorage.setItem('pendingTicket', ticketId);
    window.location.href = '/crm';
}

function populateCRMFields(chat) {
    if (!chat) return;
    document.getElementById('crm-name').value = chat.name || '';
    document.getElementById('crm-email').value = chat.email || '';
    document.getElementById('crm-source').value = chat.source || '';
    document.getElementById('crm-notes').value = chat.notes || '';
}

async function saveCRMDetails() {
    if (!activeChatId) return;

    const details = {
        name: document.getElementById('crm-name').value,
        email: document.getElementById('crm-email').value,
        source: document.getElementById('crm-source').value,
        notes: document.getElementById('crm-notes').value
    };

    try {
        const res = await fetch(`/api/backoffice/chat/${activeChatId}/contact?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(details)
        });

        if (res.ok) {
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) {
                Object.assign(chat, details);
                document.getElementById('active-chat-name').innerText = chat.name || 'Sin nombre';
            }
            renderChatList();
            showToast('✅ Información guardada correctamente');
        } else {
            showToast('❌ Error al guardar información', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('❌ Error de conexión', 'error');
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}" style="margin-right:8px;"></i> ${message}`;
    
    // Estilos inline rápidos para el toast si no están en CSS
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%) translateY(100px)',
        background: type === 'success' ? '#10b981' : '#ef4444',
        color: 'white',
        padding: '12px 24px',
        borderRadius: '12px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        zIndex: '10000',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        fontWeight: '600'
    });

    document.body.appendChild(toast);
    
    // Animar entrada
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);

    // Salida
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

async function createTag() {
    const name = document.getElementById('new-tag-name').value;
    const color = document.getElementById('new-tag-color').value;
    if (!name) return;

    const res = await fetch(`/api/backoffice/tags?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color })
    });

    if (res.ok) {
        document.getElementById('new-tag-name').value = '';
        await fetchBotTags();
    }
}

async function deleteTag(id) {
    if (!confirm('¿Eliminar esta etiqueta?')) return;
    const res = await fetch(`/api/backoffice/tags/${id}?token=${token}`, {
        method: 'DELETE'
    });
    if (res.ok) {
        await fetchBotTags();
        chats.forEach(c => {
            if (c.tags) c.tags = c.tags.filter(t => t.id !== id);
        });
        handleSearch();
    }
}

async function addTagToChat(tagId) {
    const res = await fetch(`/api/backoffice/chats/${activeChatId}/tags?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId })
    });
    if (res.ok) {
        const tag = botTags.find(t => t.id === tagId);
        const chat = chats.find(c => c.id === activeChatId);
        if (chat && tag) {
            if (!chat.tags) chat.tags = [];
            if (!chat.tags.find(t => t.id === tagId)) chat.tags.push(tag);
        }
        handleSearch(); 
        renderActiveChatTags();
        renderTagManager();
    }
}

async function removeTagFromChat(tagId) {
    const res = await fetch(`/api/backoffice/chats/${activeChatId}/tags/${tagId}?token=${token}`, {
        method: 'DELETE'
    });
    if (res.ok) {
        const chat = chats.find(c => c.id === activeChatId);
        if (chat && chat.tags) {
            chat.tags = chat.tags.filter(t => t.id !== tagId);
        }
        handleSearch();
        renderActiveChatTags();
        renderTagManager();
    }
}

function renderTagManager() {
    const editorList = document.getElementById('tag-list-editor');
    if (!editorList) return;
    
    editorList.innerHTML = `
        <div style="max-height: 200px; overflow-y: auto; margin-top: 10px;">
            ${botTags.map(t => `
                <div class="tag-item-edit">
                    <span class="tag-pill" style="background:${t.color || '#6366f1'}">${t.name}</span>
                    <button class="btn-icon" onclick="deleteTag('${t.id}')" style="color:#f87171;"><i class="fas fa-trash-alt"></i></button>
                </div>
            `).join('')}
        </div>
    `;

    const chat = chats.find(c => c.id === activeChatId);
    if (chat) {
        const assignedTagIds = (chat.tags || []).map(t => t.id);
        const assignList = document.getElementById('available-tags-to-assign');
        assignList.innerHTML = botTags.map(t => {
            const isAssigned = assignedTagIds.includes(t.id);
            return `
                <div onclick="${isAssigned ? 'removeTagFromChat' : 'addTagToChat'}('${t.id}')" 
                     class="tag-pill" 
                     style="background:${t.color || '#6366f1'}; cursor:pointer; opacity:${isAssigned ? 1 : 0.6}; transform:${isAssigned ? 'scale(1.05)' : 'scale(1)'}; border:${isAssigned ? '2px solid white' : '1px solid transparent'}">
                    ${t.name} ${isAssigned ? '✓' : '+'}
                </div>
            `;
        }).join('');
    }
}

function logout() {
    localStorage.removeItem('backoffice_token');
    window.location.href = '/login';
}

setInterval(() => fetchChats(true), 60000);
socket.on('ticket_updated', (payload) => {
    console.log('📡 Ticket actualizado:', payload);
    fetchPendingTicketsCount();
    if (document.getElementById('tickets-panel').classList.contains('active')) {
        fetchTickets();
    }
});

// --- TICKETS LOGIC ---

let currentTicketsFilter = 'pending';

async function fetchPendingTicketsCount() {
    try {
        const res = await fetch(`/api/backoffice/tickets/pending-count?token=${token}&tipo=Asistencia Externa`);
        const { count } = await res.json();
        
        const badge = document.getElementById('tickets-badge');
        if (count > 0) {
            badge.innerText = count > 99 ? '99+' : count;
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        console.error('Error fetching tickets count:', e);
    }
}

function realToggleTickets(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('tickets-panel');
    if (!panel) return;
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        setTicketsFilter('pending'); // Default to pending when opening
    }
}
window.realToggleTickets = realToggleTickets;

function setTicketsFilter(filter) {
    currentTicketsFilter = filter;
    
    // Update tabs UI
    document.getElementById('tab-pending').classList.toggle('active', filter === 'pending');
    document.getElementById('tab-closed').classList.toggle('active', filter === 'Cerrado');
    
    fetchTickets();
}

async function fetchTickets() {
    const list = document.getElementById('tickets-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.5;">Cargando tickets...</div>';
    
    try {
        const estadoParam = currentTicketsFilter === 'pending' ? '' : `&estado=${currentTicketsFilter}`;
        const res = await fetch(`/api/backoffice/tickets?token=${token}${estadoParam}&tipo=Asistencia Externa`);
        const tickets = await res.json();

        if (!Array.isArray(tickets) || tickets.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:20px; opacity:0.5;">No hay tickets ${currentTicketsFilter === 'pending' ? 'pendientes' : 'cerrados'}</div>`;
            return;
        }

        list.innerHTML = tickets.map(t => {
            const date = new Date(t.created_at).toLocaleDateString();
            const contactName = t.chats?.name || (t.chat_id ? t.chat_id.split('@')[0] : 'Sin contacto');
            
            return `
                <div class="ticket-item">
                    <div onclick="${t.chat_id ? `goToTicketChat('${t.chat_id}')` : ''}" style="cursor:pointer;">
                        <div class="ticket-header">
                            <div class="ticket-title">${t.titulo}</div>
                            <div class="ticket-badge priority-${t.prioridad}">${t.prioridad}</div>
                        </div>
                        <div style="font-size:0.85rem; color:var(--text-main); margin-bottom:4px;">${contactName}</div>
                        <div class="ticket-meta">
                            <span><i class="far fa-calendar-alt"></i> ${date}</span>
                            <span><i class="fas fa-tag"></i> ${t.tipo}</span>
                        </div>
                    </div>
                    
                    <div class="ticket-status-row">
                        <span style="font-size:0.75rem; color:var(--text-muted);">Estado:</span>
                        <select class="status-select" onchange="updateTicketStatus('${t.id}', this.value)">
                            <option value="Abierto" ${t.estado === 'Abierto' ? 'selected' : ''}>Abierto</option>
                            <option value="En progreso" ${t.estado === 'En progreso' ? 'selected' : ''}>En progreso</option>
                            <option value="Cerrado" ${t.estado === 'Cerrado' ? 'selected' : ''}>Cerrado</option>
                        </select>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Error fetching tickets:', e);
        list.innerHTML = '<div style="color:#f87171; text-align:center; padding:20px;">Error al cargar tickets</div>';
    }
}

async function updateTicketStatus(ticketId, nuevoEstado) {
    try {
        const res = await fetch(`/api/backoffice/tickets/${ticketId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        
        const result = await res.json();
        if (result.success) {
            showToast(`Ticket ${nuevoEstado === 'Cerrado' ? 'cerrado' : 'actualizado'} correctamente`);
            fetchPendingTicketsCount();
            fetchTickets(); // Refresh list to remove if closed
        } else {
            showToast('❌ Error al actualizar ticket: ' + (result.error || 'Desconocido'));
        }
    } catch (e) {
        console.error('Error updating ticket status:', e);
        showToast('❌ Error de conexión al actualizar ticket');
    }
}

function goToTicketChat(chatId) {
    realToggleTickets();
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
        selectChat(chatId);
    } else {
        // Si el chat no está en la lista actual (paginación), forzamos búsqueda
        document.getElementById('search-input').value = chatId.split('@')[0];
        fetchChats(true).then(() => {
            selectChat(chatId);
        });
    }
}

function openTicketModal() {
    if (!activeChatId) {
        showToast('⚠️ Selecciona un chat primero', 'error');
        return;
    }
    document.getElementById('ticket-modal').classList.add('active');
    document.getElementById('ticket-title').focus();
}

function closeTicketModal() {
    document.getElementById('ticket-modal').classList.remove('active');
}

async function createTicket() {
    const titulo = document.getElementById('ticket-title').value.trim();
    const descripcion = document.getElementById('ticket-desc').value.trim();
    const tipo = document.getElementById('ticket-type').value;
    const prioridad = document.getElementById('ticket-priority').value;

    if (!titulo) {
        showToast('⚠️ El título es obligatorio', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/backoffice/tickets?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: activeChatId,
                titulo,
                descripcion,
                tipo,
                prioridad
            })
        });

        if (res.ok) {
            showToast('✅ Ticket generado correctamente');
            closeTicketModal();
            fetchPendingTicketsCount();
            
            // Limpiar campos
            document.getElementById('ticket-title').value = '';
            document.getElementById('ticket-desc').value = '';
        } else {
            showToast('❌ Error al generar ticket', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('❌ Error de conexión', 'error');
    }
}

// --- LEADS LOGIC ---

function realToggleLeads(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('leads-panel');
    if (!panel) return;
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
        fetchLeads();
    }
}
window.realToggleLeads = realToggleLeads;

async function fetchLeads() {
    const list = document.getElementById('leads-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.5;">Cargando leads editados...</div>';
    
    try {
        const res = await fetch(`/api/backoffice/leads?token=${token}`);
        const leads = await res.json();

        if (!Array.isArray(leads) || leads.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.5;">No hay leads editados (con notas, email o fuente)</div>';
            return;
        }

        list.innerHTML = leads.map(l => {
            const date = l.last_human_message_at ? new Date(l.last_human_message_at).toLocaleDateString() : 'Sin actividad';
            const name = l.name || l.id.split('@')[0];
            
            return `
                <div class="ticket-item" onclick="selectLead('${l.id}')" style="cursor:pointer;">
                    <div class="ticket-header">
                        <div class="ticket-title">${name}</div>
                        <div style="font-size:0.7rem; opacity:0.6;">${l.source || 'Sin fuente'}</div>
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">
                        ${l.notes || 'Sin notas'}
                    </div>
                    <div class="ticket-meta">
                        <span><i class="far fa-envelope"></i> ${l.email || 'Sin email'}</span>
                        <span><i class="far fa-clock"></i> ${date}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Error fetching leads:', e);
        list.innerHTML = '<div style="color:#f87171; text-align:center; padding:20px;">Error al cargar leads</div>';
    }
}

function selectLead(chatId) {
    realToggleLeads();
    selectChat(chatId);
}

function realToggleMeta(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('meta-panel');
    if (!panel) return;
    panel.classList.toggle('active');
}
window.realToggleMeta = realToggleMeta;

function launchMetaOnboarding() {
    const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
    fetch('/api/backoffice/whatsapp/config?token=' + activeToken)
      .then(res => res.json())
      .then(data => {
          if (!data.appId || !data.railwayProjectId) {
              showToast('⚠️ Faltan credenciales de Meta o Project ID en el servidor', 'error');
              return;
          }
          
          // Abrir DuskCodes con parámetros de redirección dinámica
          const url = new URL('https://duskcodes.com.ar/meta-auth');
          const currentOrigin = window.location.origin;
          
          url.searchParams.append('railwayProjectId', data.railwayProjectId);
          url.searchParams.append('RAILWAY_PROJECT_ID', data.railwayProjectId);
          url.searchParams.append('projectId', data.railwayProjectId);
          url.searchParams.append('metaAppId', data.appId);
          url.searchParams.append('metaAppSecret', data.appSecret);
          url.searchParams.append('projectUrl', currentOrigin);
          url.searchParams.append('redirectUri', `${currentOrigin}/api/backoffice/whatsapp/onboard-callback`);
          
          const width = 600;
          const height = 800;
          const left = (window.screen.width / 2) - (width / 2);
          const top = (window.screen.height / 2) - (height / 2);

          window.open(url.toString(), 'MetaOnboarding', 
            `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=no,menubar=no`);
      })
      .catch(err => {
          console.error(err);
          showToast('❌ Error de conexión al obtener configuración', 'error');
      });
}

// Inicialización
fetchPendingTicketsCount();
setInterval(fetchPendingTicketsCount, 30000);

fetchChats(true);
fetchBotTags();

// Listeners para Infinite Scroll
document.getElementById('chat-list').addEventListener('scroll', function() {
    const { scrollTop, scrollHeight, clientHeight } = this;
    if (scrollTop + clientHeight >= scrollHeight - 20) {
        if (!loadingChats && !allChatsLoaded) fetchChats();
    }
});

document.getElementById('messages').addEventListener('scroll', function() {
    if (this.scrollTop < 50 && !loadingMessages && !allMessagesLoaded) {
        fetchMessages(activeChatId);
    }
});
