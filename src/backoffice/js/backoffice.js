/* global io, metaAppId, FB, toggleLeadsPanel, toggleTicketsPanel, toggleMetaPanel */
const token = localStorage.getItem('backoffice_token');
if (!token) window.location.href = '/login';

let activeChatId = null;
let activeTicketId = null;
let crmColumns = [];
let crmData = {};
let chats = [];
let allMessages = [];
let botTags = [];
let selectedFile = null;
let isSending = false;

async function initCRMData() {
    try {
        const resSettings = await fetch(`/api/backoffice/settings?token=${token}`);
        if (!resSettings.ok) return;
        const settings = await resSettings.json();
        
        const colSettingValue = settings.CRM_COLUMNS;
        if (colSettingValue) {
            crmColumns = JSON.parse(colSettingValue);
        } else {
            crmColumns = [
                { id: 'UNASSIGNED', title: 'Tickets Nuevos' },
                { id: 'contactado', title: 'Contactado' },
                { id: 'negociacion', title: 'En Negociación' },
                { id: 'propuesta', title: 'Propuesta Enviada' },
                { id: 'cierre', title: 'Cierre' }
            ];
        }

        const dataSettingValue = settings.CRM_METADATA;
        if (dataSettingValue) {
            crmData = JSON.parse(dataSettingValue);
        }

        // Poblar el selector de estados si existe
        const statusSelect = document.getElementById('crm-status-select-side');
        if (statusSelect) {
            statusSelect.innerHTML = crmColumns.map(col => `<option value="${col.id}">${col.title}</option>`).join('');
        }
    } catch (e) {
        console.error('[initCRMData] Error:', e);
    }
}
initCRMData();

// Función para scroll al fondo del chat
function scrollToBottom() {
    const container = document.getElementById('messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

// Función para ordenar chats por fecha de último mensaje
function sortChats() {
    if (!chats || chats.length === 0) return;
    chats.sort((a, b) => {
        const dateA = new Date(a.last_message_at || 0);
        const dateB = new Date(b.last_message_at || 0);
        return dateB - dateA;
    });
}

// --- Tema Claro// El tema ahora se maneja en crm-common.js

// Paginación de chats
let chatOffset = 0;
let allChatsLoaded = false;
let currentPlatform = 'whatsapp';
let platformSettings = {
    whatsapp: true,
    instagram: false,
    messenger: false
};

// Paginación de mensajes
let messageOffset = 0;
const MSG_LIMIT = 50;
let loadingMessages = false;
let allMessagesLoaded = false;

// Paginación de chats
const CHAT_LIMIT = 50;
let loadingChats = false;

// Inicializar Socket.IO para tiempo real
const socket = io();

socket.on('connect', () => {
    console.log('✅ Conectado al servidor de tiempo real');
});

socket.on('new_message', (msg) => {
    console.log('📩 Nuevo mensaje recibido por socket:', msg);
    // Normalizar chat_id por si el servidor lo envía como chatId
    const cid = msg.chat_id || msg.chatId;
    if (!msg.chat_id) msg.chat_id = cid;

    // 1. Si es el chat activo, añadir mensaje a la vista
    if (cid === activeChatId) {
        // Evitar duplicados si el mensaje ya está en la lista (comparando ID y external_id)
        const isDuplicate = allMessages.some(m => 
            (m.id === msg.id && msg.id !== undefined) || 
            (m.external_id === msg.external_id && msg.external_id !== undefined && msg.external_id !== null)
        );
        if (!isDuplicate) {
            allMessages.push(msg);
            renderMessages();
            scrollToBottom();
        }
    }
    
    // 2. Actualizar lista de chats localmente (Optimización)
    const chatIdx = chats.findIndex(c => c.id === cid);
    if (chatIdx !== -1) {
        chats[chatIdx].last_message_at = msg.created_at || new Date().toISOString();
        chats[chatIdx].last_message = msg.content;
        sortChats();
        renderChatList();
        saveChatsToCache(chats);
    } else {
        // Chat nuevo: refrescar del servidor
        fetchChats(true);
    }
});

socket.on('bot_toggled', (payload) => {
    console.log('📡 Bot toggled:', payload);
    const chat = chats.find(c => c.id === payload.chatId);
    if (chat) {
        chat.bot_enabled = payload.enabled;
        if (payload.assigned_agent) {
            chat.assigned_agent = payload.assigned_agent;
            // Si el backend lo devuelve como assigned_to (usado en la tabla), lo actualizamos también
            chat.assigned_to = payload.assigned_agent; 
        }
    }
    
    if (activeChatId === payload.chatId) {
        const toggle = document.getElementById('bot-toggle');
        if (toggle) toggle.checked = payload.enabled;
        updateBotStatusText(payload.enabled);
        updateInputState(payload.enabled);
    }
    renderChatList();
});

// Sistema de Caché para la lista de chats (Persistencia para carga instantánea al refrescar)
function saveChatsToCache(chatData) {
    try {
        localStorage.setItem('cached_chats_data', JSON.stringify({
            timestamp: Date.now(),
            data: chatData
        }));
    } catch (e) { console.error('Error guardando cache:', e); }
}

function loadChatsFromCache() {
    try {
        const cached = localStorage.getItem('cached_chats_data');
        if (cached) {
            const { timestamp, data } = JSON.parse(cached);
            // Si el cache tiene menos de 10 minutos, lo usamos
            if (Date.now() - timestamp < 600000) {
                return data;
            }
        }
    } catch (e) { console.error('Error cargando cache:', e); }
    return null;
}

async function fetchChats(refresh = false) {
    if (loadingChats) return;
    
    // Si es la carga inicial y hay caché, renderizamos inmediatamente
    if (chats.length === 0 && !refresh) {
        const cachedData = loadChatsFromCache();
        if (cachedData) {
            console.log('⚡ [UI] Cargando lista de chats desde caché local...');
            chats = cachedData;
            renderChatList();
        }
    }

    if (refresh) {
        chatOffset = 0;
        allChatsLoaded = false;
    }
    if (allChatsLoaded && !refresh) return;

    const query = document.getElementById('search-input')?.value || '';
    const tagFilter = document.getElementById('filter-tag')?.value || '';

    loadingChats = true;
    try {
        const platformParam = currentPlatform === 'all' ? '' : `&platform=${currentPlatform}`;
        const url = `/api/backoffice/chats?token=${token}&limit=${CHAT_LIMIT}&offset=${chatOffset}&search=${encodeURIComponent(query)}&tag=${tagFilter}${platformParam}`;
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
        renderBulkFilterDropdown();
    } catch (e) { console.error(e); }
}

function renderBulkFilterDropdown() {
    const select = document.getElementById('bulk-filter-tags');
    if (!select) return;
    
    const selectedVals = Array.from(select.selectedOptions).map(o => o.value);
    
    select.innerHTML = 
        botTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        
    Array.from(select.options).forEach(opt => {
        if (selectedVals.includes(opt.value)) {
            opt.selected = true;
        }
    });
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
    if (!select) return; // Si no existe el filtro en el HTML, no hacer nada
    
    const currentValue = select.value;
    select.innerHTML = '<option value="">Todas las etiquetas</option>' + 
        botTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    select.value = currentValue;
}

function formatLastMessageTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isYesterday) return 'Ayer';
    return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

// Local cache for avatar URLs to avoid re-requesting during current session
const avatarCache = new Map();

function renderChatList(listToRender = chats) {
    const list = document.getElementById('chat-list');
    list.innerHTML = listToRender.map(chat => {
        const initial = (chat.name || chat.id).charAt(0).toUpperCase();
        const avatarUrl = `/api/backoffice/profile-pic/${chat.id}?token=${token}`;
        
        // Si ya lo tenemos en caché local, usarlo directamente
        const finalSrc = avatarCache.has(chat.id) ? avatarCache.get(chat.id) : '';
        
        // Icono de plataforma
        let platformIcon = '';
        if (chat.type === 'instagram') platformIcon = '<i class="fab fa-instagram platform-instagram"></i>';
        else if (chat.type === 'messenger') platformIcon = '<i class="fab fa-facebook-messenger platform-messenger"></i>';
        
        const showIconOverlay = currentPlatform === 'all' && chat.type !== 'whatsapp';
        const iconOverlayHtml = showIconOverlay ? `<div class="platform-icon-overlay">${platformIcon}</div>` : '';

        const tagsHtml = (chat.tags || []).map(t => 
            `<span class="tag-pill" style="background:${t.color || '#6366f1'}">${t.name}</span>`
        ).join('');

        const timeStr = formatLastMessageTime(chat.last_message_at);
        const unreadCount = chat.unread_count || 0;
        const unreadHtml = unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : '';

        const statusBadge = chat.bot_enabled 
            ? `<div style="text-align:right;"><span style="color: var(--accent); font-size: 0.75rem;">🤖 Bot</span><br/><span style="font-size:0.65rem; opacity:0.7;">${timeStr}</span></div>`
            : `<div style="text-align:right;"><span style="color: #f87171; font-size: 0.75rem;">👤 Humano</span><br/><span style="font-size:0.65rem; opacity:0.7;">${timeStr}</span></div>`;

        // CRM Status Badge
        let crmStatusHtml = '';
        if (chat.crm_status && chat.crm_status !== 'UNASSIGNED') {
            const col = (crmColumns || []).find(c => c.id === chat.crm_status || c.title === chat.crm_status);
            const statusLabel = col ? col.title : chat.crm_status;
            crmStatusHtml = `<span class="crm-status-badge" style="font-size: 0.65rem; background: rgba(99, 102, 241, 0.1); color: var(--accent); padding: 2px 6px; border-radius: 6px; font-weight: 700; margin-top: 4px; display: inline-block; border: 1px solid rgba(99, 102, 241, 0.2); line-height: 1.2;">${statusLabel}</span>`;
        }

        return `
            <div class="chat-item ${activeChatId === chat.id ? 'active' : ''}" onclick="selectChat('${chat.id}')">
                <div class="chat-avatar">
                   <img data-src="${avatarUrl}" src="${finalSrc || `https://ui-avatars.com/api/?name=${initial}&background=random`}" 
                        class="avatar-img"
                        onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${initial}&background=random'">
                    ${iconOverlayHtml}
                </div>
                <div class="chat-info">
                    <div style="display:flex; justify-content:space-between; align-items: baseline;">
                        <div style="display:flex; flex-direction:column;">
                            <span class="chat-name">${(chat.name && chat.name !== '[-]') ? chat.name : chat.id.split('@')[0]}</span>
                            <span style="font-size: 0.75rem; opacity: 0.6; color: var(--text-muted); font-weight: normal;">${chat.id.split('@')[0]}</span>
                            ${crmStatusHtml}
                        </div>
                        ${statusBadge}
                    </div>
                    <div class="chat-info-bottom">
                       <div class="chat-tags-list" style="display:flex; flex-wrap:wrap; margin-top:2px;">${tagsHtml}</div>
                       ${unreadHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Activar Lazy Loading para las nuevas imágenes
    observeAvatars();
}

function observeAvatars() {
    const options = {
        root: document.getElementById('chat-list'),
        rootMargin: '100px',
        threshold: 0.01
    };

    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.getAttribute('data-src');
                if (src) {
                    // Si ya tiene el src correcto, no hacer nada
                    if (img.getAttribute('src') === src) return;
                    
                    // Cargar imagen
                    img.src = src;
                    img.removeAttribute('data-src');
                    
                    // Guardar en caché local para que si se re-renderiza la lista no parpadee
                    const chatIdMatch = src.match(/\/profile-pic\/([^?]+)/);
                    if (chatIdMatch) {
                        const chatId = chatIdMatch[1];
                        avatarCache.set(chatId, src);
                    }
                }
                obs.unobserve(img);
            }
        });
    }, options);

    document.querySelectorAll('.avatar-img[data-src]').forEach(img => observer.observe(img));
}


async function switchPlatform(platform) {
    if (loadingChats) return;
    currentPlatform = platform;
    
    // Actualizar UI de tabs
    document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${platform}`).classList.add('active');
    
    console.log(`[Platform] Cambiando a ${platform}`);
    fetchChats(true);
}

async function checkPlatformVisibility() {
    try {
        const res = await fetch(`/api/backoffice/settings?token=${token}`);
        const settings = await res.json();
        
        platformSettings.whatsapp = settings.WHATSAPP_VISIBLE !== 'false';
        platformSettings.instagram = settings.INSTAGRAM_VISIBLE === 'true';
        platformSettings.messenger = settings.MESSENGER_VISIBLE === 'true';

        // Mostrar/ocultar los tabs según configuración
        document.getElementById('tab-whatsapp').style.display = platformSettings.whatsapp ? 'flex' : 'none';
        document.getElementById('tab-instagram').style.display = platformSettings.instagram ? 'flex' : 'none';
        document.getElementById('tab-messenger').style.display = platformSettings.messenger ? 'flex' : 'none';

        // Si hay más de una plataforma activa, mostrar el tab "Todos"
        const activeCount = [platformSettings.whatsapp, platformSettings.instagram, platformSettings.messenger].filter(v => v === true).length;
        if (activeCount > 1) {
            document.getElementById('tab-all').style.display = 'flex';
        } else {
            document.getElementById('tab-all').style.display = 'none';
        }

        // Si la plataforma actual no está habilitada, cambiar a la primera disponible o 'all' si corresponde
        if (!platformSettings[currentPlatform] && currentPlatform !== 'all') {
            if (platformSettings.whatsapp) switchPlatform('whatsapp');
            else if (platformSettings.instagram) switchPlatform('instagram');
            else if (platformSettings.messenger) switchPlatform('messenger');
        }
    } catch (e) {
        console.error('Error verificando visibilidad de plataformas:', e);
    }
}

async function selectChat(id) {
    activeChatId = id;
    const chat = chats.find(c => c.id === id);
    
    document.getElementById('active-chat-phone').innerText = chat.id.split('@')[0];
    const displayName = (chat.name && chat.name !== '[-]') ? chat.name : 'Sin nombre';
    document.getElementById('active-chat-name').innerText = displayName;
    
    const headerAvatar = document.getElementById('active-chat-avatar');
    const nameForInitial = (chat.name && chat.name !== '[-]') ? chat.name : chat.id;
    const initial = nameForInitial.charAt(0).toUpperCase();
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

    // Habilitar botones de acción independientes
    const tagsBtn = document.getElementById('open-tags-btn');
    const crmBtn = document.getElementById('open-crm-btn');
    if (tagsBtn) tagsBtn.disabled = false;
    if (crmBtn) crmBtn.disabled = false;

    renderActiveChatTags();
    populateCRMFields(chat);
    
    // Refrescar paneles si están abiertos
    if (document.getElementById('crm-panel').classList.contains('active')) {
        populateCRMFields(chat);
    }
    if (document.getElementById('tags-panel')?.classList.contains('active')) {
        renderTagManager();
    }

    renderChatList();
    loadCRMJump(id); // Cargamos los datos para el "Salto al CRM"
    fetchMessages(id, true);
}

function renderActiveChatTags() {
    const chat = chats.find(c => c.id === activeChatId);
    const container = document.getElementById('active-chat-tags');
    if (!container) return;
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



async function fetchMessages(chatId, reset = false) {
    if (loadingMessages) return;
    loadingMessages = true;

    if (reset) {
        messageOffset = 0;
        allMessagesLoaded = false;
        // No limpiamos allMessages aquí para evitar parpadeo blanco, solo marcamos
    }
    
    if (allMessagesLoaded && !reset) {
        loadingMessages = false;
        return;
    }

    try {
        const res = await fetch(`/api/backoffice/messages/${chatId}?token=${token}&limit=${MSG_LIMIT}&offset=${messageOffset}`);
        const newMessages = await res.json();
        
        if (newMessages.length < MSG_LIMIT) allMessagesLoaded = true;

        const container = document.getElementById('messages');
        const oldScrollHeight = container.scrollHeight;

        if (reset) {
            allMessages = newMessages; // REEMPLAZAR en vez de concatenar
        } else {
            allMessages = [...newMessages, ...allMessages]; // Infinit scroll up: concatenar al inicio
        }
        
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
            
            // Forzar habilitación inmediata del input para mejor UX
            updateInputState(false);
            const toggle = document.getElementById('bot-toggle');
            if (toggle) toggle.checked = false;
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
function closeAllPanels(exceptId) {
    const panels = ['crm-panel', 'tags-panel', 'leads-panel', 'tickets-panel', 'meta-panel'];
    panels.forEach(id => {
        if (id !== exceptId) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        }
    });
}

function toggleCRMPanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const panel = document.getElementById('crm-panel');
    const isOpening = !panel.classList.contains('active');
    
    if (isOpening) {
        closeAllPanels('crm-panel');
        const chat = chats.find(c => c.id === activeChatId);
        if (chat) populateCRMFields(chat);
    }
    panel.classList.toggle('active');
}

function toggleTagsPanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const panel = document.getElementById('tags-panel');
    const isOpening = !panel.classList.contains('active');
    
    if (isOpening) {
        closeAllPanels('tags-panel');
        renderTagManager();
    }
    panel.classList.toggle('active');
}

async function loadCRMJump(chatId) {
    const container = document.getElementById('crm-jump-container');
    const select = document.getElementById('crm-lead-jump');
    if (!container || !select) return;

    try {
        // Buscamos TODOS los tickets para este chat_id (de cualquier estado)
        const res = await fetch(`/api/backoffice/tickets?token=${token}&chatId=${chatId}&limit=50&estado=null`);
        const tickets = await res.json();

        // Limpiar activeTicketId al cambiar de chat
        activeTicketId = null;

        if (Array.isArray(tickets) && tickets.length > 0) {
            container.style.display = 'flex';
            select.innerHTML = '<option value="">🚀 Ver en CRM...</option>' + 
                tickets.map(t => `<option value="${t.id}" data-chat="${t.chat_id}">${t.titulo} (${t.tipo})</option>`).join('');
            
            // Tomar el primer ticket como el activo para la vista rápida
            const lastTicket = tickets[0];
            activeTicketId = lastTicket.id;
            
            // Rellenar campos del ticket en el sidebar
            const titleEl = document.getElementById('crm-ticket-title');
            if (titleEl) titleEl.value = lastTicket.titulo || '';

            const priorityEl = document.getElementById('crm-priority');
            if (priorityEl) priorityEl.value = lastTicket.prioridad || 'Media';

            const statusSelect = document.getElementById('crm-status-select-side');
            if (statusSelect) {
                // Rellenar opciones según columnas del CRM
                statusSelect.innerHTML = crmColumns.map(c => `<option value="${c.id}">${c.title}</option>`).join('');
                
                // Buscar estado actual en metadatos
                const meta = crmData[activeTicketId] || {};
                const currentColumnId = meta.columnId || 'UNASSIGNED';
                statusSelect.value = currentColumnId;
            }
        } else {
            container.style.display = 'none';
            // Si no hay ticket, limpiar campos de ticket
            const titleEl = document.getElementById('crm-ticket-title');
            if (titleEl) titleEl.value = '';
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

    // Establecemos el ticket activo al seleccionado
    activeTicketId = ticketId;
    activeChatId = chatId;

    // Abrimos el panel lateral en lugar del modal del CRM
    const panel = document.getElementById('crm-panel');
    if (panel && !panel.classList.contains('active')) {
        panel.classList.add('active');
    }

    // Llenamos los datos del chat en el panel
    const chat = chats.find(c => c.id === activeChatId);
    if (chat) populateCRMFields(chat);
    if (typeof renderTagManager === 'function') renderTagManager();

    // Rellenamos los datos del ticket seleccionado desde las opciones del select (para que coincida el título)
    const titleEl = document.getElementById('crm-ticket-title');
    if (titleEl) {
        // Extraer el título limpiando el tipo "(Soporte)" del texto
        const optionText = option.innerText;
        titleEl.value = optionText.substring(0, optionText.lastIndexOf('(')).trim();
    }

    // Reseteamos el desplegable para futuras selecciones
    select.value = "";
}

function populateCRMFields(chat) {
    if (!chat) return;
    document.getElementById('crm-name').value = (chat.name && chat.name !== '[-]') ? chat.name : '';
    document.getElementById('crm-email').value = chat.email || '';
    document.getElementById('crm-source').value = chat.source || '';
    document.getElementById('crm-notes').value = chat.notes || '';
    document.getElementById('crm-cuit').value = chat.cuit_dni || '';
    document.getElementById('crm-address').value = chat.address || '';
    document.getElementById('crm-tax-status').value = chat.tax_status || 'Cons. Final';
    document.getElementById('crm-product').value = chat.offered_product || '';
    
    // Nuevos campos sincronizados con CRM
    const ticketTitleEl = document.getElementById('crm-ticket-title');
    if (ticketTitleEl) ticketTitleEl.value = chat.ticket_title || '';
    
    const phoneEl = document.getElementById('crm-phone-side');
    if (phoneEl) phoneEl.value = chat.id ? chat.id.split('@')[0] : '';

    const priorityEl = document.getElementById('crm-priority');
    if (priorityEl) priorityEl.value = chat.priority || 'Baja';

    // CRM Native Columns
    const statusEl = document.getElementById('crm-status-select-side');
    if (statusEl) {
        // Asegurar que el select tenga las opciones cargadas
        if (statusEl.options.length <= 1 && crmColumns && crmColumns.length > 0) {
            let optionsHtml = '';
            if (!crmColumns.some(c => c.id === 'UNASSIGNED')) {
                optionsHtml += '<option value="UNASSIGNED">Sin Asignar</option>';
            }
            optionsHtml += crmColumns.map(c => `<option value="${c.id}">${c.title}</option>`).join('');
            statusEl.innerHTML = optionsHtml;
        }

        const currentVal = chat.crm_status || 'UNASSIGNED';
        // Intentar establecer por valor (ID)
        statusEl.value = currentVal;
        
        // Si no hay coincidencia exacta (selectedIndex -1), intentar buscar por Título (para compatibilidad)
        if (statusEl.selectedIndex === -1) {
            const col = crmColumns.find(c => c.id === currentVal || c.title === currentVal);
            if (col) statusEl.value = col.id;
            else statusEl.value = currentVal; // Fallback al valor crudo si no coincide
        }
        
        console.log(`[CRM] Poblando estado: ${currentVal} -> Asignado: ${statusEl.value}`);
    }
    
    const dueDateEl = document.getElementById('crm-due-date');
    if (dueDateEl) dueDateEl.value = chat.crm_due_date ? chat.crm_due_date.split('T')[0] : '';

    // Aplicar configuración de vista
    if (typeof window.applyCRMConfig === 'function') window.applyCRMConfig();
}

function openWhatsAppDirectSide() {
    const phone = document.getElementById('crm-phone-side').value;
    if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank');
}

async function saveCRMDetails() {
    if (!activeChatId) return;

    const details = {
        name: document.getElementById('crm-name').value,
        email: document.getElementById('crm-email').value,
        source: document.getElementById('crm-source').value,
        notes: document.getElementById('crm-notes').value,
        cuit_dni: document.getElementById('crm-cuit').value,
        address: document.getElementById('crm-address').value,
        tax_status: document.getElementById('crm-tax-status').value,
        offered_product: document.getElementById('crm-product').value,
        ticket_title: document.getElementById('crm-ticket-title')?.value || '',
        priority: document.getElementById('crm-priority')?.value || 'Baja',
        crm_status: document.getElementById('crm-status-select-side')?.value || 'UNASSIGNED',
        crm_due_date: document.getElementById('crm-due-date')?.value || null
    };

    try {
        showToast('💾 Guardando cambios...');

        // 1. Si hay un ticket activo, actualizar Ticket y Metadatos
        if (activeTicketId) {
            const ticketData = {
                titulo: details.ticket_title,
                notas: details.notes,
                priority: details.priority,
                vencimiento: details.crm_due_date,
                contact: details
            };

            await fetch(`/api/backoffice/crm/ticket/${activeTicketId}?token=${token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ticketData)
            });

            // Sincronizar Metadatos (Columna)
            const col = crmColumns.find(c => c.id === details.crm_status || c.title === details.crm_status);
            if (col) {
                if (!crmData[activeTicketId]) crmData[activeTicketId] = {};
                crmData[activeTicketId].columnId = col.id;
                crmData[activeTicketId].priority = details.priority;
                crmData[activeTicketId].alertDate = details.crm_due_date;
                
                await fetch(`/api/backoffice/save-setting?token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'CRM_METADATA', value: JSON.stringify(crmData) })
                });
            }
        } else {
            // Si no hay ticket, solo actualizar contacto
            await fetch(`/api/backoffice/chat/${activeChatId}/contact?token=${token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(details)
            });
        }

        const chat = chats.find(c => c.id === activeChatId);
        if (chat) {
            Object.assign(chat, details);
            const updatedName = (chat.name && chat.name !== '[-]') ? chat.name : 'Sin nombre';
            document.getElementById('active-chat-name').innerText = updatedName;
            renderChatList();
        }
        
        showToast('✅ Cambios guardados y sincronizados');
    } catch (e) {
        console.error('[saveCRMDetails] Error:', e);
        showToast('Error al guardar cambios', 'error');
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

function realToggleLeads(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    console.log('🔘 [PANEL] Intentando abrir panel de Leads...');
    
    const leadsPanel = document.getElementById('leads-panel');
    
    // Cerrar otros explícitamente
    closeAllPanels('leads-panel');
    
    if (leadsPanel) {
        leadsPanel.classList.toggle('active');
        const isOpen = leadsPanel.classList.contains('active');
        console.log(`📊 [PANEL] Leads: ${isOpen ? 'ABIERTO' : 'CERRADO'}`);
        if (isOpen) fetchLeads();
    } else {
        console.error('❌ [PANEL] No se encontró #leads-panel');
    }
}
window.realToggleLeads = realToggleLeads;

function realToggleTickets(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    console.log('🔘 [PANEL] Intentando abrir panel de Tickets...');
    
    const ticketsPanel = document.getElementById('tickets-panel');
    
    // Cerrar otros explícitamente
    closeAllPanels('tickets-panel');
    
    if (ticketsPanel) {
        ticketsPanel.classList.toggle('active');
        const isOpen = ticketsPanel.classList.contains('active');
        console.log(`📊 [PANEL] Tickets: ${isOpen ? 'ABIERTO' : 'CERRADO'}`);
        if (isOpen) setTicketsFilter('pending');
    } else {
        console.error('❌ [PANEL] No se encontró #tickets-panel');
    }
}
window.realToggleTickets = realToggleTickets;

function toggleMetaPanel(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    
    console.log('🔘 [PANEL] Toggle Meta Panel initiated...');
    const metaPanel = document.getElementById('meta-panel');

    // Cerrar otros paneles explícitamente para evitar solapamientos
    closeAllPanels('meta-panel');

    if (metaPanel) {
        metaPanel.classList.toggle('active');
        const isOpen = metaPanel.classList.contains('active');
        
        if (isOpen) {
            checkMetaStatus(); // Refrescar estado
        } else {
            metaPanel.style.transform = 'translateX(100%)';
            setTimeout(() => { if(!metaPanel.classList.contains('active')) metaPanel.style.visibility = 'hidden'; }, 400);
        }

        console.log(`📊 [PANEL] Meta Panel Status: ${isOpen ? 'OPEN' : 'CLOSED'}`);
    } else {
        console.error('❌ [PANEL] Error: #meta-panel not found in DOM');
        if (typeof showToast === 'function') showToast('❌ Error: No se encontró el componente de Meta', 'error');
    }
}
window.toggleMetaPanel = toggleMetaPanel;

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
          if (data.configId) url.searchParams.append('configId', data.configId);
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



// --- Ticket Management Actions ---

async function assignTicketToMe() {
    if (!activeChatId) {
        showToast('⚠️ Seleccione un chat primero', 'error');
        return;
    }
    
    // Obtenemos el userId desde el token sub:ID si existe
    let userId = null;
    if (token.startsWith('sub:')) {
        userId = token.split(':')[1];
    }

    try {
        const res = await fetch(`/api/backoffice/chat/assign?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: activeChatId, userId })
        });
        const data = await res.json();
        if (data.success || res.ok) {
            showToast('✅ Chat asignado correctamente');
            fetchChats(true);
        } else {
            showToast('❌ Error: ' + (data.error || 'No se pudo asignar'), 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('❌ Error de conexión al asignar', 'error');
    }
}

async function closeActiveTicket() {
    if (!activeChatId) return;
    const ticketId = document.getElementById('crm-lead-jump')?.value; 
    if (!ticketId) {
        showToast('⚠️ No hay un ticket activo detectado para este chat', 'error');
        return;
    }

    if (!confirm('¿Desea cerrar el ticket actual?')) return;

    try {
        const res = await fetch(`/api/backoffice/tickets/${ticketId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Cerrado' })
        });
        if (res.ok) {
            showToast('✅ Ticket cerrado correctamente');
            fetchPendingTicketsCount();
            loadCRMJump(activeChatId);
        }
    } catch (e) {
        console.error(e);
        showToast('❌ Error al cerrar ticket', 'error');
    }
}

async function reopenActiveTicket() {
    if (!activeChatId) return;
    const ticketId = document.getElementById('crm-lead-jump')?.value;
    if (!ticketId) return;

    try {
        const res = await fetch(`/api/backoffice/tickets/${ticketId}?token=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Abierto' })
        });
        if (res.ok) {
            showToast('✅ Ticket reabierto');
            fetchPendingTicketsCount();
            loadCRMJump(activeChatId);
        }
    } catch (e) { console.error(e); }
}

async function deleteActiveTicket() {
    if (!activeChatId) return;
    const ticketId = document.getElementById('crm-lead-jump')?.value;
    if (!ticketId) return;

    if (!confirm('⚠️ ¿Está seguro de ELIMINAR este ticket? esta acción no se puede deshacer.')) return;

    try {
        const res = await fetch(`/api/backoffice/tickets/${ticketId}?token=${token}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast('🗑️ Ticket eliminado');
            fetchPendingTicketsCount();
            loadCRMJump(activeChatId);
        }
    } catch (e) { console.error(e); }
}

async function toggleIntervention() {
    // En RialWay, la intervención se maneja a través del toggleBot
    const toggle = document.getElementById('bot-toggle');
    if (toggle) {
        const newState = !toggle.checked;
        toggleBot(newState);
    }
}

// Inicialización principal
fetchPendingTicketsCount();
setInterval(fetchPendingTicketsCount, 30000);
fetchBotTags();
checkMetaStatus(); // Check if bulk messaging should be enabled
fetchChats(true);  // CARGA INICIAL (CORRECCIÓN)

// Manejo de URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('openPanel') === 'meta') {
    console.log('🚀 [BACKOFFICE] Abriendo panel Meta por URL param');
    setTimeout(() => {
        if (typeof window.realToggleMeta === 'function') window.realToggleMeta();
    }, 500);
}

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

// --- BULK MESSAGING LOGIC ---

let availableTemplates = [];
let libraryTemplates = [];
let currentSelectedTemplate = null;
window.isMetaConnected = false; 

async function checkMetaStatus() {
    try {
        const res = await fetch(`/api/backoffice/whatsapp/config?token=${token}`);
        const data = await res.json();
        console.log('📡 [META-STATUS] Configuración recibida:', data);

        const config = data.config || {};
        window.metaConfig = config; // Guardar globalmente
        const isConnected = !!(config.waba_id && config.phone_number_id);

        if (isConnected) {
            console.log('✅ [META-STATUS] Cuenta vinculada:', config.waba_id);
            window.isMetaConnected = true;
            
            // Actualizar enlaces dinámicos con el WABA ID para abrir la cuenta correcta directamente
            if (config.waba_id) {
                const libLink = document.getElementById('link-meta-library');
                const newLink = document.getElementById('link-meta-new');
                if (libLink) libLink.href = `https://business.facebook.com/latest/whatsapp_manager/template_library?asset_id=${config.waba_id}`;
                if (newLink) newLink.href = `https://business.facebook.com/latest/whatsapp_manager/message_templates?asset_id=${config.waba_id}`;
            }
            
            const metaPanel = document.getElementById('meta-panel');
            if (metaPanel) {
                const content = metaPanel.querySelector('.tickets-list');
                if (content) {
                    content.innerHTML = `
                        <div style="background: linear-gradient(135deg, #10b981, #059669); width: 100px; height: 100px; border-radius: 24px; display: flex; align-items: center; justify-content: center; font-size: 3rem; color: white; box-shadow: 0 15px 30px rgba(16, 185, 129, 0.4); margin-top: 40px;">
                            <i class="fas fa-check-double"></i>
                        </div>
                        <div>
                            <h2 style="margin: 0; color: var(--text-main); font-size: 1.6rem; font-weight: 700;">Meta Conectado</h2>
                            <div style="height: 3px; width: 50px; background: #10b981; margin: 10px auto; border-radius: 10px;"></div>
                            <p style="color: var(--text-muted); font-size: 1rem; margin-top: 15px; line-height: 1.6;">
                                Tu cuenta de <strong>WhatsApp Business</strong> está vinculada correctamente.
                            </p>
                        </div>
                        <div style="background: var(--bg-header); padding: 24px; border-radius: 20px; border: 1px solid var(--border); width: 100%; text-align: left;">
                            <h4 style="margin: 0 0 15px 0; color: #10b981; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Detalles de la conexión:</h4>
                            <div style="font-size: 0.9rem; color: var(--text-main); line-height: 1.8;">
                                <div><strong>WABA ID:</strong> ${config.waba_id}</div>
                                <div><strong>ID de Teléfono:</strong> ${config.phone_number_id}</div>
                                ${config.verified_name ? `<div><strong>Nombre:</strong> ${config.verified_name}</div>` : ''}
                            </div>
                        </div>
                        <button class="btn-primary" onclick="toggleBulkModal();" style="width:100%; height:45px; display:flex; align-items:center; justify-content:center; gap:10px; background:#10b981; border:none; border-radius:12px; font-weight:600; cursor:pointer; color:white; margin-top: 20px;">
                            <i class="fas fa-layer-group"></i> Abrir Envío Masivo
                        </button>
                        <button class="btn-secondary" onclick="launchMetaOnboarding()" style="width:100%; margin-top:10px; opacity:0.7; font-size:0.8rem;">
                            Actualizar Configuración
                        </button>
                    `;
                }
            }
        } else {
            console.warn('⚠️ [META-STATUS] Meta no vinculado o pendiente.');
            window.isMetaConnected = false;
            
            // Revertir a UI de Onboarding si el panel existe
            const metaPanel = document.getElementById('meta-panel');
            if (metaPanel) {
                const content = metaPanel.querySelector('.tickets-list');
                if (content && !content.querySelector('.fab.fa-meta')) { // Si no tiene el logo de meta (default)
                    content.innerHTML = `
                        <div style="color: #0668E1; font-size: 4rem; margin-top: 40px; margin-bottom: 20px;">
                            <i class="fas fa-infinity"></i>
                        </div>
                        <div>
                            <h2 style="margin: 0; color: var(--text-main); font-size: 1.6rem; font-weight: 700;">Conexión Oficial</h2>
                            <div style="height: 3px; width: 50px; background: #0668E1; margin: 10px auto; border-radius: 10px;"></div>
                            <p style="color: var(--text-muted); font-size: 1rem; margin-top: 15px; line-height: 1.6;">
                                Conecta tu cuenta de <strong>WhatsApp Business</strong> oficial para habilitar funciones profesionales de envío masivo y gestión avanzada.
                            </p>
                        </div>
                        <div style="background: var(--bg-header); padding: 24px; border-radius: 20px; border: 1px solid var(--border); width: 100%; text-align: left;">
                            <h4 style="margin: 0 0 15px 0; color: #0668E1; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Beneficios activos:</h4>
                            <ul style="font-size: 0.9rem; padding-left: 20px; color: var(--text-main); line-height: 2.2;">
                                <li>Integración por <strong>Coexistencia</strong> (Usa tu App y el Bot).</li>
                                <li>Registro instantáneo vía <strong>Popup de Facebook</strong>.</li>
                                <li>Envío de <strong>Mensajes Masivos (HSM)</strong>.</li>
                                <li>Soporte para <strong>Imágenes y Audios</strong> oficiales.</li>
                            </ul>
                        </div>
                        <button class="btn-primary" onclick="launchMetaOnboarding()" style="width:100%; height:45px; display:flex; align-items:center; justify-content:center; gap:10px; background:#0668E1; border:none; border-radius:12px; font-weight:600; cursor:pointer; color:white; margin-top: 20px;">
                            <i class="fab fa-meta"></i> Vincular con Meta Cloud API
                        </button>
                    `;
                }
            }
        }
    } catch (e) {
        console.error('[Bulk] Error checking Meta status:', e);
    }
}

async function toggleBulkModal() {
    const modal = document.getElementById('bulk-modal');
    const isOpening = !modal.classList.contains('active');
    
    if (isOpening) {
        const metaPanel = document.getElementById('meta-panel');
        if (metaPanel && metaPanel.classList.contains('active')) {
            toggleMetaPanel(); // Cerramos el panel de Meta para centrar la atención en el modal
        }
    }

    modal.classList.toggle('active');
    if (modal.classList.contains('active')) {
        switchMetaTab('my');
    }
}

function switchMetaTab(tab) {
    const viewsMap = { 'my': 'view-my-templates', 'detail': 'view-template-detail' };
    
    // Reset active states
    Object.values(viewsMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // Set active
    if (tab === 'my') {
        const tabEl = document.getElementById('tab-my-templates');
        if (tabEl) tabEl.classList.add('active');
        const view = document.getElementById('view-my-templates');
        if (view) view.style.display = 'grid';
        loadTemplates();
    } else if (tab === 'detail') {
        const tabEl = document.getElementById('tab-my-templates');
        if (tabEl) tabEl.classList.remove('active'); // No tab active when in detail
        const view = document.getElementById('view-template-detail');
        if (view) view.style.display = 'block';
    }
}

function useTemplateAsBase() {
    if (!currentSelectedTemplate) return;
    
    // Cambiar a la pestaña de Nueva Plantilla
    switchMetaTab('new');
    
    // Rellenar formulario
    document.getElementById('tpl-name').value = `${currentSelectedTemplate.name}_copy`;
    document.getElementById('tpl-category').value = currentSelectedTemplate.category;
    document.getElementById('tpl-lang').value = currentSelectedTemplate.language;
    
    let bodyText = '';
    if (currentSelectedTemplate.components && Array.isArray(currentSelectedTemplate.components)) {
        const bodyComp = currentSelectedTemplate.components.find(c => c.type === 'BODY' || c.type === 'message' || c.type?.toUpperCase() === 'BODY');
        if (bodyComp) {
            bodyText = bodyComp.text || bodyComp.content || (bodyComp.example?.body_text?.[0]?.[0]) || '';
        }
        
        // Fallback si el body está vacío
        if (!bodyText) {
            for (const comp of currentSelectedTemplate.components) {
                if (comp.text || comp.content) {
                    bodyText = comp.text || comp.content;
                    break;
                }
            }
        }
    } else if (currentSelectedTemplate.body) {
        bodyText = currentSelectedTemplate.body;
    }
    document.getElementById('tpl-body').value = bodyText;
    
    // Disparar actualización de variables
    const event = new Event('input', { bubbles: true });
    document.getElementById('tpl-body').dispatchEvent(event);
    
    showToast('✨ Datos cargados. Personaliza tu plantilla y envíala a revisión.');
}

async function loadTemplates() {
    const container = document.getElementById('view-my-templates');
    try {
        const res = await fetch(`/api/backoffice/whatsapp/templates?token=${token}`);
        const data = await res.json();
        if (data.success) {
            availableTemplates = data.templates;
            renderTemplateCards(container, availableTemplates, false);
        }
    } catch (e) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-muted);">Error al sincronizar con Meta Cloud.</p>';
    }
}

async function loadLibraryTemplates() {
    const grid = document.getElementById('library-templates-grid');
    if (grid) grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; opacity:0.5;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p>Explorando Biblioteca de Meta...</p></div>';
    
    try {
        const res = await fetch(`/api/backoffice/whatsapp/library-templates?token=${token}`);
        const data = await res.json();
        if (data.success) {
            libraryTemplates = data.templates;
            populateLibraryFilters();
            applyLibraryFilters();
        } else {
            if (grid) grid.innerHTML = `<p style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-muted);">${data.error || 'No se pudo cargar la biblioteca.'}</p>`;
        }
    } catch (e) {
        if (grid) grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-muted);">Error de conexión con la biblioteca.</p>';
    }
}

function populateLibraryFilters() {
    const langSelect = document.getElementById('filter-lib-lang');
    const catSelect = document.getElementById('filter-lib-cat');
    if (!langSelect || !catSelect) return;

    // Normalización: es_AR -> ar para el selector
    const rawLangs = [...new Set(libraryTemplates.map(t => t.language))].sort();
    const displayLangs = rawLangs.map(l => {
        const lowerL = l.toLowerCase();
        if (lowerL === 'es_ar' || lowerL === 'ar') return { value: 'ar', label: 'AR' };
        return { value: l, label: l.toUpperCase() };
    });

    // Eliminar duplicados de etiquetas (ej: si hay 'ar' y 'es_ar' ambos mapeados a 'AR')
    const finalLangs = [];
    const seenValues = new Set();
    displayLangs.forEach(item => {
        if (!seenValues.has(item.value)) {
            finalLangs.push(item);
            seenValues.add(item.value);
        }
    });

    const cats = [...new Set(libraryTemplates.map(t => t.category))].sort();

    // Llenar Idiomas
    langSelect.innerHTML = '<option value="">Todos los idiomas</option>' + 
        finalLangs.map(l => `<option value="${l.value}">${l.label}</option>`).join('');

    // Forzar selección de 'AR' (valor 'ar')
    const hasAR = finalLangs.some(l => l.value === 'ar');
    if (hasAR) {
        langSelect.value = 'ar';
    } else if (finalLangs.length > 0) {
        // Fallback a cualquier español si no hay AR directo
        const anyEs = finalLangs.find(l => l.value.startsWith('es'));
        if (anyEs) langSelect.value = anyEs.value;
    }

    // Llenar Categorías
    catSelect.innerHTML = '<option value="">Todas las categorías</option>' + 
        cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function applyLibraryFilters() {
    const grid = document.getElementById('library-templates-grid');
    if (!grid) return;

    const lang = document.getElementById('filter-lib-lang').value;
    const cat = document.getElementById('filter-lib-cat').value;
    const search = document.getElementById('filter-lib-search').value.toLowerCase().trim();

    const filtered = libraryTemplates.filter(t => {
        // Normalización para el match de idioma
        const tLang = t.language.toLowerCase();
        const matchLang = !lang || (lang === 'ar' && (tLang === 'ar' || tLang === 'es_ar')) || tLang === lang.toLowerCase();

        const matchCat = !cat || t.category === cat;
        const matchSearch = !search || t.name.toLowerCase().includes(search);
        return matchLang && matchCat && matchSearch;
    });

    renderTemplateCards(grid, filtered, true);
}

function renderTemplateCards(container, templates, isLibrary = false) {
    if (!templates || templates.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:20px; color:var(--text-muted);">No se encontraron plantillas.</p>';
        return;
    }
    container.innerHTML = templates.map(t => {
        // DEBUG: Descomentar para ver estructura en consola si falta contenido
        if (isLibrary && !t.body && (!t.components || t.components.length === 0)) {
            console.warn('[Backoffice] Plantilla de biblioteca sin estructura conocida:', t);
        }

        // Buscar contenido de forma agresiva en los componentes
        let text = 'Sin contenido de previsualización';
        
        if (t.components && Array.isArray(t.components)) {
            // 1. Buscar el componente BODY (el más común para el mensaje principal)
            const body = t.components.find(c => c.type === 'BODY' || c.type === 'message' || c.type?.toUpperCase() === 'BODY');
            if (body) {
                text = body.text || body.content || (body.example?.header_text?.[0]) || (body.example?.body_text?.[0]?.[0]) || text;
            }
            
            // 2. Si no hay body o está vacío, buscar en cualquier componente que tenga texto
            if (text === 'Sin contenido de previsualización') {
                for (const comp of t.components) {
                    const fallbackText = comp.text || comp.content;
                    if (fallbackText && typeof fallbackText === 'string') {
                        text = fallbackText;
                        break;
                    }
                }
            }
        } else if (t.body) {
            // Soporte para objetos planos que vienen con .body
            text = t.body;
        }
        
        // Limpiar variables {{1}} para que no se vea feo si son muchas
        const cleanText = text.length > 150 ? text.substring(0, 147) + '...' : text;
        
        const statusClass = t.status === 'APPROVED' ? 'meta-status-approved' : (t.status === 'REJECTED' ? 'meta-status-rejected' : 'meta-status-pending');
        const statusLabel = t.status === 'APPROVED' ? 'Aprobada' : (t.status === 'REJECTED' ? 'Rechazada' : 'Pendiente');
        
        return `
            <div class="meta-card" onclick="showTemplateDetail('${t.id || t.name}', ${isLibrary}, '${t.language}')">
                <div class="meta-card-tag ${statusClass}">${isLibrary ? 'BIBLIOTECA' : statusLabel}</div>
                <div class="meta-card-name" style="font-weight:700;">${t.name}</div>
                <div class="meta-card-desc" style="font-size:0.85rem; line-height:1.4; color:var(--text-main);">${cleanText}</div>
                <div style="font-size:0.7rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:8px; margin-top:auto; padding-top:10px; border-top:1px solid rgba(0,0,0,0.05);">
                    <span title="ID de Plantilla" style="background:rgba(6,104,225,0.05); padding:2px 6px; border-radius:4px; font-weight: 600;"><i class="fas fa-fingerprint"></i> ID: ${t.id || 'N/A'}</span>
                    <span title="Idioma" style="background:rgba(0,0,0,0.05); padding:2px 6px; border-radius:4px;"><i class="fas fa-globe"></i> ${t.language.toUpperCase()}</span>
                    <span title="Categoría" style="background:rgba(0,0,0,0.05); padding:2px 6px; border-radius:4px;"><i class="fas fa-tag"></i> ${t.category}</span>
                </div>
            </div>
        `;
    }).join('');
}

function showTemplateDetail(idOrName, isLibrary, language) {
    const templates = isLibrary ? libraryTemplates : availableTemplates;
    const template = templates.find(t => (t.id === idOrName || t.name === idOrName) && (!language || t.language === language));
    if (!template) return;

    currentSelectedTemplate = template;
    
    // Usar la lógica centralizada de pestañas para mostrar el detalle
    switchMetaTab('detail');
    
    // Show detail
    const detailView = document.getElementById('view-template-detail');
    detailView.style.display = 'block';
    
    document.getElementById('detail-tpl-name').innerText = template.name;
    document.getElementById('detail-tpl-lang-badge').innerHTML = `<i class="fas fa-globe"></i> ${template.language.toUpperCase()}`;
    document.getElementById('detail-tpl-cat-badge').innerHTML = `<i class="fas fa-tag"></i> ${template.category}`;
    
    // Mostrar ID en el detalle si existe
    const nameHeader = document.getElementById('detail-tpl-name');
    if (template.id && !document.getElementById('detail-tpl-id')) {
        const idBadge = document.createElement('div');
        idBadge.id = 'detail-tpl-id';
        idBadge.style = 'font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; font-family: monospace;';
        idBadge.innerText = `ID: ${template.id}`;
        nameHeader.parentNode.insertBefore(idBadge, nameHeader.nextSibling);
    } else if (document.getElementById('detail-tpl-id')) {
        document.getElementById('detail-tpl-id').innerText = `ID: ${template.id || ''}`;
    }
    
    const statusEl = document.getElementById('detail-tpl-status');
    const statusClass = template.status === 'APPROVED' ? 'meta-status-approved' : (template.status === 'REJECTED' ? 'meta-status-rejected' : 'meta-status-pending');
    statusEl.className = `meta-card-tag ${statusClass}`;
    statusEl.innerText = template.status || 'LIBRARY';

    // Configurar botón "Editar en META"
    const editBtn = document.getElementById('btn-edit-in-meta');
    if (editBtn && window.metaConfig && window.metaConfig.waba_id && template.status !== 'LIBRARY') {
        editBtn.href = `https://business.facebook.com/latest/whatsapp_manager/message_templates?asset_id=${window.metaConfig.waba_id}&edit_template=${template.name}`;
        editBtn.style.display = 'flex';
    } else if (editBtn) {
        editBtn.style.display = 'none';
    }

    let bodyText = 'Sin contenido de texto disponible';
    let headerText = '';
    let footerText = '';

    if (template.components && Array.isArray(template.components)) {
        const bodyComp = template.components.find(c => c.type === 'BODY' || c.type === 'message' || c.type?.toUpperCase() === 'BODY');
        if (bodyComp) {
            bodyText = bodyComp.text || bodyComp.content || (bodyComp.example?.body_text?.[0]?.[0]) || bodyText;
        }

        const headerComp = template.components.find(c => c.type === 'HEADER' || c.type?.toUpperCase() === 'HEADER');
        if (headerComp) {
            headerText = headerComp.text || headerComp.content || (headerComp.example?.header_text?.[0]) || '';
        }

        const footerComp = template.components.find(c => c.type === 'FOOTER' || c.type?.toUpperCase() === 'FOOTER');
        if (footerComp) {
            footerText = footerComp.text || footerComp.content || '';
        }
    } else if (template.body) {
        bodyText = template.body;
    }

    const previewFinal = document.getElementById('wa-preview-text-final');
    if (previewFinal) {
        // Limpiar botones previos si existen dentro o fuera
        const bubble = previewFinal.closest('.wa-preview-bubble');
        if (bubble) {
            const oldIntegrated = bubble.querySelector('.wa-preview-btns-container-integrated');
            if (oldIntegrated) oldIntegrated.remove();
            
            const oldExternal = bubble.parentNode.querySelectorAll('.wa-preview-btns-container');
            oldExternal.forEach(b => b.remove());
        }

        let html = '';
        
        // 1. Header Media (IMAGE, VIDEO, DOCUMENT)
        const headerComp = template.components?.find(c => c.type === 'HEADER');
        if (headerComp && headerComp.format && headerComp.format !== 'TEXT') {
            const format = headerComp.format.toLowerCase();
            if (format === 'image') {
                const imgUrl = headerComp.example?.header_handle?.[0] || 'https://via.placeholder.com/300x150?text=Imagen+de+Cabecera';
                html += `<img src="${imgUrl}" style="width:calc(100% + 30px); margin: -12px -15px 12px -15px; border-radius:0; display:block; object-fit:cover; max-height:200px; border-bottom: 1px solid rgba(0,0,0,0.05);">`;
            } else if (format === 'video') {
                html += `<div style="width:calc(100% + 30px); margin: -12px -15px 12px -15px; aspect-ratio:16/9; background:#000; border-radius:0; display:flex; align-items:center; justify-content:center; color:white; border-bottom: 1px solid rgba(0,0,0,0.05);"><i class="fas fa-play-circle fa-3x"></i></div>`;
            } else if (format === 'document') {
                html += `<div style="width:calc(100% + 30px); margin: -12px -15px 12px -15px; padding:15px; background:rgba(0,0,0,0.05); border-radius:0; display:flex; align-items:center; gap:10px; border-bottom:1px solid rgba(0,0,0,0.05);"><i class="fas fa-file-pdf fa-2x" style="color:#ef4444;"></i> <span style="font-size:0.85rem; font-weight:600;">Documento PDF</span></div>`;
            }
        }

        if (headerText) html += `<div style="font-weight:700; margin-bottom:8px;">${headerText}</div>`;
        
        html += `<div style="white-space: pre-wrap;">${bodyText}</div>`;
        
        if (footerText) html += `<div style="color:var(--text-muted); font-size:0.8rem; margin-top:8px;">${footerText}</div>`;
        
        previewFinal.innerHTML = html;

        // 2. Botones Integrados
        const buttonsComp = template.components?.find(c => c.type === 'BUTTONS');
        if (buttonsComp && buttonsComp.buttons && bubble) {
            const btnsContainer = document.createElement('div');
            btnsContainer.className = 'wa-preview-btns-container-integrated';
            
            buttonsComp.buttons.forEach(b => {
                const btn = document.createElement('div');
                btn.className = 'wa-preview-btn-item';
                
                let icon = '<i class="fas fa-reply"></i>';
                if (b.type === 'URL') icon = '<i class="fas fa-external-link-alt"></i>';
                if (b.type === 'PHONE_NUMBER') icon = '<i class="fas fa-phone"></i>';
                
                btn.innerHTML = `${icon} ${b.text}`;
                btnsContainer.appendChild(btn);
            });
            bubble.appendChild(btnsContainer);
        }
    }

    const bulkSection = document.getElementById('bulk-actions-section');
    const adoptSection = document.getElementById('library-adopt-section');

    if (bulkSection) {
        if (template.status === 'APPROVED' && !isLibrary) {
            bulkSection.style.display = 'block';
        } else {
            bulkSection.style.display = 'none';
        }
    }

    if (adoptSection) {
        adoptSection.style.display = isLibrary ? 'block' : 'none';
    }

    const progressEl = document.getElementById('bulk-progress');
    const fileInput = document.getElementById('bulk-file-input');
    if (progressEl) progressEl.style.display = 'none';
    if (fileInput) fileInput.value = '';
}


async function submitTemplateForReview() {
    const name = document.getElementById('tpl-name').value.trim();
    const category = document.getElementById('tpl-category').value;
    const language = document.getElementById('tpl-lang').value;
    const text = document.getElementById('tpl-body').value.trim();
    const btn = document.getElementById('btn-submit-tpl');

    if (!name || !text) {
        showToast('⚠️ Nombre y cuerpo son obligatorios', 'error');
        return;
    }

    // Validar nombre (minúsculas y guiones bajos)
    if (!/^[a-z0-9_]+$/.test(name)) {
        showToast('⚠️ El nombre solo permite minúsculas y guiones bajos', 'error');
        return;
    }

    // Recolectar valores de ejemplo para las variables (soporta {{1}} y {{nombre}})
    const varRegex = /\{\{(\w+)\}\}/g;
    const varNames = [];
    let m;
    while ((m = varRegex.exec(text)) !== null) {
        if (!varNames.includes(m[1])) varNames.push(m[1]);
    }
    const examples = [];
    for (const varName of varNames) {
        const input = document.getElementById(`tpl-example-${varName}`);
        const value = input ? input.value.trim() : '';
        if (!value) {
            showToast(`⚠️ Completá el ejemplo para la variable {{${varName}}}`, 'error');
            return;
        }
        examples.push(value);
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

    try {
        const res = await fetch(`/api/backoffice/whatsapp/templates?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, category, language, text, examples })
        });

        const data = await res.json();
        if (data.success) {
            showToast('✅ Plantilla enviada a Meta para revisión. Aparecerá como ⏳ PENDIENTE hasta que la aprueben.');
            cancelTemplateCreation();
            loadTemplates();
        } else {
            showToast('❌ Error: ' + (data.error || 'No se pudo crear'), 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('❌ Error de conexión al crear plantilla', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Enviar a Revisión';
    }
}

function cancelTemplateCreation() {
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-body').value = '';
    document.getElementById('tpl-examples-container').style.display = 'none';
    document.getElementById('tpl-examples-fields').innerHTML = '';
    switchMetaTab('my');
}

/** Auto-detecta variables {{nombre}} o {{1}} en el textarea y genera campos de ejemplo */
function detectTemplateVariables() {
    const text = document.getElementById('tpl-body').value;
    const container = document.getElementById('tpl-examples-container');
    const fieldsDiv = document.getElementById('tpl-examples-fields');
    const varRegex = /\{\{(\w+)\}\}/g;
    const varNames = [];
    let m;
    while ((m = varRegex.exec(text)) !== null) {
        if (!varNames.includes(m[1])) varNames.push(m[1]);
    }

    if (varNames.length === 0) {
        container.style.display = 'none';
        fieldsDiv.innerHTML = '';
        return;
    }

    container.style.display = 'block';
    fieldsDiv.innerHTML = varNames.map(varName => {
        return `<div style="display:flex; align-items:center; gap:12px; margin-top:12px;">
            <span style="font-size:0.85rem; min-width:110px; font-weight:700; color:var(--text-main);"><span style="color:var(--primary)">{{</span>${varName}<span style="color:var(--primary)">}}</span></span>
            <input type="text" id="tpl-example-${varName}" class="crm-input" placeholder="ej: Valor para ${varName}" style="flex:1; margin-bottom:0;">
        </div>`;
    }).join('');
}

// Vincular detección de variables al textarea
document.addEventListener('DOMContentLoaded', () => {
    const tplBody = document.getElementById('tpl-body');
    if (tplBody) {
        tplBody.addEventListener('input', detectTemplateVariables);
    }
});


async function startBulkSend() {
    if (!currentSelectedTemplate) return;
    const templateName = currentSelectedTemplate.name;
    const fileInput = document.getElementById('bulk-file-input');
    const btn = document.getElementById('send-bulk-btn');
    const progressDiv = document.getElementById('bulk-progress');
    const progressBar = document.getElementById('bulk-progress-bar');
    const statusText = document.getElementById('bulk-status-text');
    
    if (fileInput.files.length === 0) {
        showToast('⚠️ Suba un archivo Excel para iniciar', 'error');
        return;
    }
    
    const file = fileInput.files[0];
    const languageCode = currentSelectedTemplate.language || 'es';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('templateName', templateName);
    formData.append('languageCode', languageCode);
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
    progressDiv.style.display = 'block';
    progressBar.style.width = '0%';
    statusText.innerText = 'Subiendo y procesando...';
    
    try {
        const res = await fetch(`/api/backoffice/whatsapp/send-bulk-template?token=${token}`, {
            method: 'POST',
            body: formData
        });
        
        if (res.status === 202) {
            statusText.innerText = '✅ Proceso iniciado en segundo plano.';
            progressBar.style.width = '100%';
            progressBar.style.background = '#10b981';
            showToast('🚀 Envío masivo iniciado correctamente');
            
            setTimeout(() => {
                toggleBulkModal();
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
                progressDiv.style.display = 'none';
                fileInput.value = '';
            }, 2000);
            
        } else {
            const data = await res.json();
            throw new Error(data.error || 'Error al iniciar envío');
        }
    } catch (e) {
        console.error('[Bulk] Error:', e);
        statusText.innerText = '❌ Error: ' + e.message;
        progressBar.style.background = '#ef4444';
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Reintentar';
    }
}

// --- Registro de Listeners Globales ---
document.addEventListener('DOMContentLoaded', () => {
    const tplBody = document.getElementById('tpl-body');
    if (tplBody) tplBody.addEventListener('input', detectTemplateVariables);
    
    // Verificar estado de Meta al cargar para inicializar window.isMetaConnected
    checkMetaStatus();
});

// --- Exportaciones Finales ---
window.toggleLeadsPanel = window.realToggleLeads;
window.toggleTicketsPanel = window.realToggleTickets;
window.toggleMetaPanel = toggleMetaPanel;
window.realToggleMeta = toggleMetaPanel;
window.toggleBulkModal = toggleBulkModal;
window.switchMetaTab = switchMetaTab;
window.showTemplateDetail = showTemplateDetail;
window.startBulkSend = startBulkSend;
window.downloadBulkExcel = () => {
    if (currentSelectedTemplate) {
        let url = `/api/backoffice/whatsapp/template-excel/${currentSelectedTemplate.name}?token=${token}`;
        
        const start = document.getElementById('bulk-filter-start')?.value;
        const end = document.getElementById('bulk-filter-end')?.value;
        const select = document.getElementById('bulk-filter-tags');
        
        let tags = '';
        if (select && select.selectedOptions) {
            tags = Array.from(select.selectedOptions).map(o => o.value).join(',');
        }

        if (start) url += `&startDate=${start}`;
        if (end) url += `&endDate=${end}`;
        if (tags) url += `&tagIds=${tags}`;
        
        window.open(url, '_blank');
    }
};
window.launchMetaOnboarding = launchMetaOnboarding;
window.submitTemplateForReview = submitTemplateForReview;
window.cancelTemplateCreation = cancelTemplateCreation;
window.loadTemplates = loadTemplates;
window.detectTemplateVariables = detectTemplateVariables;
window.assignTicketToMe = assignTicketToMe;
window.closeActiveTicket = closeActiveTicket;
window.reopenActiveTicket = reopenActiveTicket;

// Manejar parámetros de URL para abrir paneles específicos
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const panel = urlParams.get('panel');
    
    if (panel === 'leads' || panel === 'contacts') {
        setTimeout(() => window.toggleLeadsPanel(), 1000);
    } else if (panel === 'tickets') {
        setTimeout(() => window.toggleTicketsPanel(), 1000);
    } else if (panel === 'meta') {
        setTimeout(() => window.toggleMetaPanel(), 1000);
    }
});

window.deleteActiveTicket = deleteActiveTicket;
window.toggleIntervention = toggleIntervention;

// --- Sincronización Manual de Contactos (Baileys) ---
async function startContactSync() {
    const modal = document.getElementById('sync-modal');
    const loading = document.getElementById('sync-loading');
    const result = document.getElementById('sync-result');
    const summaryText = document.getElementById('sync-summary');
    
    if (!modal) return;
    
    // Reset modal
    modal.style.display = 'flex';
    loading.style.display = 'block';
    result.style.display = 'none';
    
    try {
        const res = await fetch(`/api/backoffice/whatsapp/sync-contacts?token=${token}`, {
            method: 'POST'
        });
        
        const data = await res.json();
        
        if (data.success) {
            const { contacts, labels, associations, meta_sync_triggered } = data.summary;
            if (meta_sync_triggered) {
                summaryText.innerHTML = `
                    <div style="color: #059669; margin-bottom: 10px;"><i class="fab fa-whatsapp"></i> <b>Sincronización Oficial Meta Solicitada</b></div>
                    La petición ha sido enviada a los servidores de Meta.<br/>
                    Los contactos y el historial se cargarán en segundo plano.
                `;
            } else {
                summaryText.innerHTML = `
                    Sincronizados <b>${contacts}</b> contactos y <b>${labels}</b> etiquetas.<br/>
                    Se crearon <b>${associations}</b> vinculaciones.
                `;
            }
            // Refrescar datos locales
            await fetchChats(true);
            await fetchBotTags();
            
            loading.style.display = 'none';
            result.style.display = 'block';
        } else {
            throw new Error(data.error || 'Error desconocido');
        }
    } catch (e) {
        console.error('[Sync] Error:', e);
        loading.style.display = 'none';
        modal.style.display = 'none';
        showToast('❌ Error: ' + e.message, 'error');
    }
}

function closeSyncModal() {
    const modal = document.getElementById('sync-modal');
    if (modal) modal.style.display = 'none';
}

// --- Importación Externa de Contactos (Excel) ---
function toggleImportModal() {
    const modal = document.getElementById('import-modal');
    if (!modal) return;
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    
    // Reset state if closing
    if (modal.style.display === 'none') {
        document.getElementById('import-progress').style.display = 'none';
        document.getElementById('import-file-input').value = '';
        document.getElementById('import-status-text').innerText = 'Procesando...';
        document.getElementById('import-progress-bar').style.width = '0%';
    }
}

function downloadImportTemplate() {
    window.open(`/api/backoffice/chats/import-template?token=${token}`, '_blank');
}

async function startImportExcel() {
    const fileInput = document.getElementById('import-file-input');
    const btn = document.getElementById('btn-execute-import');
    const progressDiv = document.getElementById('import-progress');
    const progressBar = document.getElementById('import-progress-bar');
    const statusText = document.getElementById('import-status-text');

    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Por favor selecciona un archivo Excel.');
        return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    btn.disabled = true;
    progressDiv.style.display = 'block';
    progressBar.style.width = '10%';
    statusText.innerText = 'Subiendo archivo...';

    try {
        const res = await fetch(`/api/backoffice/chats/import?token=${token}`, {
            method: 'POST',
            body: formData
        });

        progressBar.style.width = '50%';
        statusText.innerText = 'Procesando datos en el servidor...';

        const data = await res.json();
        
        if (data.success) {
            progressBar.style.width = '100%';
            statusText.innerText = `¡Éxito! Se importaron ${data.imported} contactos.`;
            statusText.style.color = '#10b981';
            
            // Refrescar chats
            setTimeout(async () => {
                await fetchChats(true);
                await fetchBotTags();
                alert(`Importación finalizada: ${data.imported} contactos procesados.`);
                toggleImportModal();
            }, 1500);
        } else {
            throw new Error(data.error || 'Error en el proceso de importación');
        }
    } catch (e) {
        console.error('[Import] Error:', e);
        statusText.innerText = '❌ Error: ' + e.message;
        statusText.style.color = '#f87171';
        alert('Error al importar: ' + e.message);
    } finally {
        btn.disabled = false;
    }
}

window.toggleImportModal = toggleImportModal;
window.downloadImportTemplate = downloadImportTemplate;
window.startImportExcel = startImportExcel;

window.startContactSync = startContactSync;
window.closeSyncModal = closeSyncModal;

console.log('✅ [BACKOFFICE] Cargado Correctamente.');

