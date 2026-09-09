/* global io, metaAppId, FB, toggleLeadsPanel, toggleTicketsPanel, toggleMetaPanel, showToast, _csdSync, _csdRebuild, navigate, Swal */

function _tagStyle(hex) {
    const color = hex || '#6366f1';
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return isDark
        ? `background:${color}; color:#ffffff;`
        : `background:${color}22; color:${color};`;
}

window.addEventListener('themeChanged', () => {
    document.querySelectorAll('.tag-pill[data-tag-color]').forEach(el => {
        const base = (el.getAttribute('style') || '').replace(/background:[^;]+;?\s*/g, '').replace(/color:[^;]+;?\s*/g, '');
        el.setAttribute('style', base + _tagStyle(el.dataset.tagColor));
    });
    if (document.getElementById('tag-list-editor')) renderTagManager();
});

const token = localStorage.getItem('backoffice_token');
if (!token) window.location.href = '/login';

let activeChatId = null;
let activeTicketId = null;
let _notificationsActive = true;
let _showOnlyUnreadChats = false;
let crmColumns = [];
let _boCrmData = {};
let chats = [];
let allMessages = [];
let _boBotTags = [];
let selectedFile = null;
let replyTargetMessageId = null;
let replyTargetMessage = null;
let isSending = false;
let _mediaRecorder = null;
let _audioChunks = [];
let _isRecording = false;
let _isAudioCancelled = false;
let _audioStream = null;
window.__activeBackofficeChatId = null;
let _activeChatSyncTimer = null;
let _syncingActiveChat = false;
let _backofficeChatScrollTop = null;
let _backofficeChatListScrollTop = 0;
let _restoringBackofficeView = false;
let _globalBotEnabled = localStorage.getItem(getGlobalBotCacheKey()) !== 'false';

function getGlobalBotCacheKey() {
    const projectId = window.railwayProjectId || 'default';
    const serviceId = window.railwayServiceId || 'default_service';
    return `global_bot_enabled:${projectId}:${serviceId}`;
}

function setGlobalBotEnabled(enabled) {
    _globalBotEnabled = enabled !== false && enabled !== 'false';
    localStorage.setItem(getGlobalBotCacheKey(), _globalBotEnabled ? 'true' : 'false');
}

function isBotEffectivelyEnabled(chatOrEnabled) {
    const chatEnabled = typeof chatOrEnabled === 'object'
        ? chatOrEnabled?.bot_enabled
        : chatOrEnabled;
    return _globalBotEnabled && (chatEnabled === true || chatEnabled === 'true' || chatEnabled === 1 || chatEnabled === '1');
}

function rememberBackofficeChatScroll() {
    const messages = document.getElementById('messages');
    if (messages) _backofficeChatScrollTop = messages.scrollTop;
}

function clearActiveChatSelection() {
    activeChatId = null;
    window.__activeBackofficeChatId = null;
    activeTicketId = null;
    allMessages = [];
    _backofficeChatScrollTop = null;
    replyTargetMessageId = null;
    replyTargetMessage = null;
    document.body.classList.remove('mobile-chat-active');

    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) chatHeader.style.display = 'none';

    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = 'none';

    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) messagesContainer.innerHTML = '';

    const messages = document.getElementById('messages');
    if (messages) messages.innerHTML = '';

    const replyPreview = document.getElementById('reply-preview-container');
    if (replyPreview) replyPreview.style.display = 'none';

    ['open-tags-btn', 'open-crm-btn', 'open-ticket-btn', 'quick-msg-btn', 'meta-templates-btn', 'delete-chat-btn', 'chatbot-toggle-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });

    renderChatList();
}

function restoreBackofficeChatFromMemory() {
    if (!activeChatId) return false;

    const chat = chats.find(c => normChatId(c.id) === normChatId(activeChatId));
    if (!chat) return false;

    _restoringBackofficeView = true;
    window.__activeBackofficeChatId = activeChatId;
    activeTicketId = null;

    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) chatHeader.style.display = 'flex';

    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = 'flex';

    const phoneEl = document.getElementById('active-chat-phone');
    if (phoneEl) phoneEl.innerText = chat.id.split('@')[0];

    const nameEl = document.getElementById('active-chat-name');
    if (nameEl) nameEl.innerText = (chat.name && chat.name !== '[-]') ? chat.name : 'Lead sin nombre';

    const headerAvatar = document.getElementById('active-chat-avatar');
    if (headerAvatar) {
        const nameForAvatar = (chat.name && chat.name !== '[-]') ? chat.name : chat.id.split('@')[0];
        headerAvatar.style.background = getAvatarBg(chat.id || '');
        headerAvatar.innerHTML = `<span>${getInitials(nameForAvatar)}</span>`;
    }

    ['open-tags-btn', 'open-crm-btn', 'open-ticket-btn', 'quick-msg-btn', 'meta-templates-btn', 'delete-chat-btn', 'chatbot-toggle-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = false;
    });

    renderChatList();
    renderActiveChatTags();
    populateCRMFields(chat);
    refreshBotStateUI();
    renderMessages();

    const messages = document.getElementById('messages');
    if (messages) {
        if (_backofficeChatScrollTop !== null) messages.scrollTop = _backofficeChatScrollTop;
        else messages.scrollTop = messages.scrollHeight;
    }

    _restoringBackofficeView = false;
    return true;
}

async function fetchGlobalBotStatus() {
    try {
        const params = new URLSearchParams({ key: 'GLOBAL_BOT_ENABLED', token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
        const res = await fetch(`/api/backoffice/get-setting?${params.toString()}`);
        const data = await res.json();
        if (data?.success) setGlobalBotEnabled(data.value !== 'false');
    } catch (e) {
        console.warn('[Backoffice] No se pudo obtener el estado global del bot:', e);
    }
}

function refreshBotStateUI() {
    const chat = getActiveChat();
    if (chat) {
        const effectiveEnabled = isBotEffectivelyEnabled(chat);
        const chatEnabled = chat.bot_enabled === true || chat.bot_enabled === 'true' || chat.bot_enabled === 1 || chat.bot_enabled === '1';
        updateBotStatusText(effectiveEnabled);
        updateInputState(effectiveEnabled);
        updateChatbotToggleButton(chatEnabled, effectiveEnabled);
        const toggle = document.getElementById('bot-toggle');
        if (toggle) {
            toggle.checked = effectiveEnabled;
            toggle.disabled = !_globalBotEnabled;
            toggle.title = _globalBotEnabled ? '' : 'Bot desactivado globalmente';
        }
        const mobileToggle = document.getElementById('mobile-bot-toggle');
        if (mobileToggle) {
            mobileToggle.checked = effectiveEnabled;
            mobileToggle.disabled = !_globalBotEnabled;
        }
    } else {
        updateChatbotToggleButton(false, false);
    }
    renderChatList();
}

function updateChatbotToggleButton(chatEnabled, effectiveEnabled) {
    const btn = document.getElementById('chatbot-toggle-btn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    btn.disabled = !activeChatId || !_globalBotEnabled;
    btn.classList.toggle('is-human', !effectiveEnabled);
    btn.classList.toggle('is-global-off', !_globalBotEnabled);
    if (icon) {
        icon.className = effectiveEnabled ? 'fas fa-robot' : 'fas fa-user';
    }
    btn.title = !_globalBotEnabled
        ? 'Chatbot desactivado globalmente'
        : (chatEnabled ? 'Desactivar chatbot para este chat' : 'Reanudar chatbot para este chat');
}
let _isSuperAdminMode = false;
let _projectServices = [];
let _activeServiceFilter = 'all';

async function initSuperAdminMode(settings) {
    _isSuperAdminMode = settings.SUPER_ADMIN_MODE === 'true';
    if (!_isSuperAdminMode) return;

    try {
        const res = await fetch(`/api/backoffice/project-services?token=${token}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.services)) {
            _projectServices = data.services;
            
            const filterContainer = document.getElementById('multi-crm-selector-container');
            if (filterContainer) {
                filterContainer.style.display = 'block';
            }
            
            const selectEl = document.getElementById('multi-crm-service-filter');
            if (selectEl) {
                const currentValue = selectEl.value || 'all';
                selectEl.innerHTML = '<option value="all">Ver Todos los CRMs</option>' +
                    _projectServices.map(s => `<option value="${s.id}">${s.assistantName || s.name} (${s.phone || 'Sin línea'})</option>`).join('');
                selectEl.value = currentValue;
            }
            if (typeof renderChatList === 'function') {
                renderChatList();
            }
        }
    } catch (e) {
        console.error('[Multi-CRM] Error cargando servicios del proyecto:', e);
    }
}

window.filterChatsByService = function(val) {
    _activeServiceFilter = val;
    fetchChats(true);
};

async function initCRMData() {
    try {
        const resSettings = await fetch(`/api/backoffice/settings?token=${token}`);
        if (!resSettings.ok) return;
        const settings = await resSettings.json();

        if (typeof initSuperAdminMode === 'function') {
            await initSuperAdminMode(settings);
        }

        const colSettingValue = settings.CRM_COLUMNS;
        if (colSettingValue) {
            crmColumns = JSON.parse(colSettingValue);
            // Asegurarse de que UNASSIGNED siempre tenga el título "Leads Nuevos"
            const unassigned = crmColumns.find(c => c.id === 'UNASSIGNED');
            if (unassigned) {
                unassigned.title = 'Leads Nuevos';
            } else {
                crmColumns.unshift({ id: 'UNASSIGNED', title: 'Leads Nuevos' });
            }
        } else {
            crmColumns = [
                { id: 'UNASSIGNED', title: 'Leads Nuevos' },
                { id: 'contactado', title: 'Contactado' },
                { id: 'negociacion', title: 'En Negociación' },
                { id: 'propuesta', title: 'Propuesta Enviada' },
                { id: 'cierre', title: 'Cierre' }
            ];
        }

        const dataSettingValue = settings.CRM_METADATA;
        if (dataSettingValue) {
            _boCrmData = JSON.parse(dataSettingValue);
        }

        // Poblar el selector de estados si existe
        const statusSelect = document.getElementById('crm-status-select-side');
        if (statusSelect) {
            statusSelect.innerHTML = crmColumns.map(col => `<option value="${col.id}">${col.title}</option>`).join('');
            _csdRebuild('crm-status-select-side');
        }
    } catch (e) {
        console.error('[initCRMData] Error:', e);
    }
}

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
let currentPlatform = 'all';
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
let _fetchMessagesController = null;
let _seenMessageIds = new Set();

// Paginación de chats
const CHAT_LIMIT = 20;
let loadingChats = false;
let _fetchChatsController = null;
function findMessageById(messageId) {
    return allMessages.find(m => m.id === messageId || m.external_id === messageId);
}

function getActiveChat() {
    return chats.find(c => normChatId(c.id) === normChatId(activeChatId)) || null;
}

function getActiveChatScopeParams() {
    const chat = getActiveChat();
    const params = new URLSearchParams();
    if (chat?.project_id) params.set('projectId', chat.project_id);
    if (chat?.service_id) params.set('serviceId', chat.service_id);
    return params.toString();
}

function appendActiveChatScope(formData) {
    const chat = getActiveChat();
    if (chat?.project_id) formData.append('projectId', chat.project_id);
    if (chat?.service_id) formData.append('serviceId', chat.service_id);
}

function getActiveChatScopeBody(extra = {}) {
    const chat = getActiveChat();
    return {
        ...extra,
        ...(chat?.project_id ? { projectId: chat.project_id } : {}),
        ...(chat?.service_id ? { serviceId: chat.service_id } : {})
    };
}

function closeMessageMenus() {
    document.querySelectorAll('.msg-dropdown-menu.show').forEach(m => {
        m.classList.remove('show');
        m.classList.remove('menu-up');
        m.style.left = '';
        m.style.right = '';
    });
}

function getSelectedTextForMessage(messageEl) {
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.rangeCount === 0) return '';

    const selectedText = selection.toString().trim();
    if (!selectedText) return '';

    const range = selection.getRangeAt(0);
    const anchorInside = messageEl && selection.anchorNode && messageEl.contains(selection.anchorNode);
    const focusInside = messageEl && selection.focusNode && messageEl.contains(selection.focusNode);
    const commonInside = messageEl && range.commonAncestorContainer && messageEl.contains(range.commonAncestorContainer);

    return anchorInside || focusInside || commonInside ? selectedText : '';
}

function showCopyToast(message, type = 'success') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(0,0,0,0.7)';
    toast.style.color = 'white';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '20px';
    toast.style.zIndex = '9999';
    toast.style.fontSize = '0.9rem';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function initMessageLongPressMenu() {
    const container = document.getElementById('messages');
    if (!container || container.dataset.longPressBound === 'true') return;
    container.dataset.longPressBound = 'true';

    let timer = null;
    let startX = 0;
    let startY = 0;
    let targetMsg = null;

    const clearTimer = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        targetMsg = null;
    };

    let longPressTriggered = false;

    container.addEventListener('touchstart', (event) => {
        if (window.innerWidth > 769) return;
        if (event.target.closest('button, a, input, textarea, .msg-dropdown-menu, .msg-reaction-badge')) return;
        const msg = event.target.closest('.msg');
        if (!msg || !container.contains(msg)) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        targetMsg = msg;
        longPressTriggered = false;

        if (targetMsg) {
            targetMsg.style.transform = 'scale(0.98)';
            targetMsg.style.transition = 'transform 0.15s ease';
        }

        timer = setTimeout(() => {
            longPressTriggered = true;
            const msgId = targetMsg?.dataset?.id;
            if (msgId && window.toggleMsgDropdown) {
                if (targetMsg) {
                    targetMsg.style.transform = 'scale(1)';
                    targetMsg.style.opacity = '0.6';
                    setTimeout(() => { targetMsg.style.opacity = ''; }, 300);
                }
                window.toggleMsgDropdown(msgId);
            }
            clearTimer();
        }, 500);
    }, { passive: true });

    container.addEventListener('touchmove', (event) => {
        if (!timer) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) {
            if (targetMsg) targetMsg.style.transform = 'scale(1)';
            clearTimer();
        }
    }, { passive: true });

    container.addEventListener('touchend', (event) => {
        if (targetMsg) targetMsg.style.transform = 'scale(1)';
        clearTimer();
        if (longPressTriggered) {
            if (event.cancelable) event.preventDefault();
            longPressTriggered = false;
        }
    }, { passive: false });

    container.addEventListener('touchcancel', (event) => {
        if (targetMsg) targetMsg.style.transform = 'scale(1)';
        clearTimer();
    }, { passive: true });

    container.addEventListener('contextmenu', (event) => {
        const msg = event.target.closest('.msg');
        if (!msg || !container.contains(msg)) return;
        event.preventDefault();
        if (window.toggleMsgDropdown) window.toggleMsgDropdown(msg.dataset.id);
    });
}

function getMessagePreviewText(message) {
    if (!message) return '';
    const type = message.type || 'text';
    if (type !== 'text') return type === 'image' ? 'Imagen' : type === 'video' ? 'Video' : type === 'audio' || type === 'voice' ? 'Audio' : 'Archivo';
    return String(message.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function escapeMsgHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function escapeAttr(value) {
    return escapeMsgHtml(value);
}

function escapeJsString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function getReplyAuthor(message) {
    if (!message) return 'Cliente';
    if (message.role === 'assistant') return 'Vos';
    const chatId = message.chat_id || activeChatId;
    const chat = chats.find(c => normChatId(c.id) === normChatId(chatId));
    const headerName = document.getElementById('active-chat-name')?.textContent?.trim();
    const headerPhone = document.getElementById('active-chat-phone')?.textContent?.trim();
    const fallbackPhone = chatId ? String(chatId).split('@')[0] : '';
    return chat?.contact_name || (chat?.name && chat.name !== '[-]' ? chat.name : '') || (headerName && headerName !== 'Selecciona un chat' && headerName !== 'Lead sin nombre' ? headerName : '') || headerPhone || fallbackPhone || 'Cliente';
}

function buildReplyPreview(message) {
    if (!message) return null;
    return {
        id: message.external_id || message.id || null,
        localId: message.id || null,
        role: message.role || null,
        author: getReplyAuthor(message),
        content: getMessagePreviewText(message),
        type: message.type || 'text'
    };
}

function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (!size || Number.isNaN(size)) return '';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} kB`;
}

function getFileDisplayName(fileUrl) {
    try {
        const parsed = new URL(fileUrl, window.location.origin);
        const fromQuery = parsed.searchParams.get('name');
        if (fromQuery) return decodeURIComponent(fromQuery);
        return decodeURIComponent(parsed.pathname.split('/').pop() || 'archivo');
    } catch {
        const clean = String(fileUrl || '').split('?')[0];
        return decodeURIComponent(clean.split('/').pop() || 'archivo');
    }
}

function loadFileSizes() {
    document.querySelectorAll('.msg-file-meta[data-file-src]:not([data-size-loaded])').forEach(async el => {
        const src = el.getAttribute('data-file-src');
        if (!src) return;
        el.setAttribute('data-size-loaded', '1');
        try {
            const res = await fetch(src, { method: 'HEAD' });
            const size = formatFileSize(res.headers.get('content-length'));
            if (size) {
                const type = el.getAttribute('data-file-type') || 'Archivo';
                el.textContent = `${type} - ${size}`;
            }
        } catch {
            // Size is optional; keep the file type visible.
        }
    });
}

function getReplyPreviewFromMessage(message) {
    if (!message) return null;
    let raw = message.rawPayload || message.raw_payload || {};
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
    }
    const preview = message.replyPreview || message.reply_preview || raw.replyPreview || raw.reply_preview || null;
    if (preview) {
        return {
            ...preview,
            author: preview.author || (preview.role === 'assistant' ? 'Vos' : getReplyAuthor({ ...message, role: preview.role || 'user' }))
        };
    }

    const replyId = message.reply_to || raw.replyTo || raw.reply_to;
    if (replyId) {
        const referenced = findMessageById(replyId);
        return buildReplyPreview(referenced) || { id: replyId, author: getReplyAuthor(message), content: 'Mensaje', type: 'text' };
    }

    // Fallback genérico para botones sin replyTo explícito:
    // Si el usuario seleccionó un botón, asociar al último mensaje saliente de la empresa
    const isButton = message.type === 'button' || raw?.type === 'button' || !!raw?.button || !!raw?.interactive;
    if (isButton && Array.isArray(allMessages)) {
        const msgIdx = allMessages.findIndex(m => (m.id && m.id === message.id) || (m.external_id && m.external_id === message.external_id));
        const listToSearch = msgIdx > 0 ? allMessages.slice(0, msgIdx) : allMessages;
        const lastAssistant = listToSearch.slice().reverse().find(m => m.role === 'assistant');
        if (lastAssistant) {
            return buildReplyPreview(lastAssistant);
        }
    }

    return null;
}

function getAdReferralFromMessage(message) {
    if (!message) return null;
    let raw = message.rawPayload || message.raw_payload || {};
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
    }
    const referral = message.referral || raw.referral || null;
    const externalAd = raw?.context?.externalAdReply || raw?.externalAdReply || null;

    if (referral) {
        return {
            headline: referral.headline || referral.title || 'Anuncio en Facebook / Instagram',
            body: referral.body || '',
            sourceUrl: referral.source_url || referral.sourceUrl || '',
            mediaUrl: referral.mediaUrl || referral.image_url || referral.video_url || referral.thumbnail_url || null
        };
    }
    if (externalAd) {
        return {
            headline: externalAd.title || 'Anuncio en Facebook / Instagram',
            body: externalAd.body || '',
            sourceUrl: externalAd.sourceUrl || '',
            mediaUrl: externalAd.mediaUrl || externalAd.thumbnailUrl || null
        };
    }
    return null;
}


// Inicializar Socket.IO para tiempo real
const socket = io();

socket.on('connect', () => {
    console.log('✅ Conectado al servidor de tiempo real');
});

const normChatId = id => (id || '').split('@')[0];
const messageKey = m => m?.id || m?.external_id || `${m?.role || ''}:${m?.created_at || ''}:${m?.content || ''}`;

async function syncActiveChatMessages(reason = 'sync') {
    if (!activeChatId || _syncingActiveChat || document.hidden) return;
    _syncingActiveChat = true;
    const syncChatId = activeChatId;
    try {
        const scopeParams = getActiveChatScopeParams();
        const res = await fetch(
            `/api/backoffice/messages/${encodeURIComponent(syncChatId)}?token=${token}&limit=${MSG_LIMIT}&offset=0${scopeParams ? `&${scopeParams}` : ''}`,
            { cache: 'no-store' }
        );
        if (!res.ok || syncChatId !== activeChatId) return;
        const latestMessages = await res.json();
        if (!Array.isArray(latestMessages) || syncChatId !== activeChatId) return;

        const beforeKeys = new Set(allMessages.map(messageKey));
        const merged = new Map();
        allMessages.forEach(m => merged.set(messageKey(m), m));
        latestMessages.forEach(m => merged.set(messageKey(m), m));

        const nextMessages = Array.from(merged.values()).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        const hasNew = latestMessages.some(m => !beforeKeys.has(messageKey(m)));
        const changedLength = nextMessages.length !== allMessages.length;
        if (hasNew || changedLength) {
            allMessages = nextMessages;
            _seenMessageIds = new Set(allMessages.map(messageKey).filter(Boolean));
            renderMessages();
            scrollToBottom();
            if (latestMessages.some(m => m.role === 'user')) markChatAsRead(syncChatId, true);
        }
    } catch (e) {
        if (reason !== 'poll') console.warn('[Realtime] No se pudo sincronizar chat activo:', e);
    } finally {
        _syncingActiveChat = false;
    }
}

socket.on('new_message', (msg) => {
    if (msg.projectId && window.railwayProjectId && msg.projectId !== window.railwayProjectId) return;
    if (msg.project_id && window.railwayProjectId && msg.project_id !== window.railwayProjectId) return;
    if (msg.serviceId && window.railwayServiceId && msg.serviceId !== window.railwayServiceId && window.railwayServiceId !== 'default_service') return;
    if (msg.service_id && window.railwayServiceId && msg.service_id !== window.railwayServiceId && window.railwayServiceId !== 'default_service') return;

    console.log('📩 Nuevo mensaje recibido por socket:', msg);
    const cid = msg.chat_id || msg.chatId;
    if (!msg.chat_id) msg.chat_id = cid;

    // 1. Si es el chat activo, añadir mensaje a la vista
    if (normChatId(cid) === normChatId(activeChatId)) {
        const normContent = (str) => (str || '').replace(/\r\n/g, '\n').trim();
        const normMsg = normContent(msg.content);

        // Quitar el pending optimista que coincida con este mensaje real
        if (msg.role === 'assistant') {
            const pendingIdx = allMessages.findIndex(m =>
                m._pending && m.role === 'assistant' && (
                    normContent(m.content) === normMsg ||
                    (m.external_id && msg.external_id && m.external_id === msg.external_id)
                )
            );
            if (pendingIdx !== -1) {
                allMessages.splice(pendingIdx, 1);
                msg._noAnimate = true; // replacing a pending - no slide-in
            }
        }

        const isDuplicate = allMessages.some(m =>
            (m.id === msg.id && msg.id !== undefined) ||
            (m.external_id === msg.external_id && msg.external_id !== undefined && msg.external_id !== null) ||
            (!m._pending && m.role === msg.role && normContent(m.content) === normMsg && Math.abs(new Date(m.created_at || 0) - new Date(msg.created_at || Date.now())) < 15000)
        );
        if (!isDuplicate) {
            allMessages.push(msg);
            renderMessages();
            scrollToBottom();
            if (msg.role === 'user') markChatAsRead(cid, true);
        }
    }

    // 2. Actualizar lista de chats localmente (Optimización)
    const chatIdx = chats.findIndex(c => normChatId(c.id) === normChatId(cid));
    if (chatIdx !== -1) {
        chats[chatIdx].last_message_at = msg.created_at || new Date().toISOString();
        chats[chatIdx].last_message = msg.content;
        if (_notificationsActive && msg.role === 'user' && normChatId(cid) !== normChatId(activeChatId)) {
            chats[chatIdx].unread_count = (chats[chatIdx].unread_count || 0) + 1;
        }
        sortChats();
        renderChatList();
        saveChatsToCache(chats);
    } else {
        // Chat nuevo: obtener datos del chat individual y añadirlo a la lista local sin destruir el estado de paginación ni scroll
        const chatParams = new URLSearchParams({ token });
        if (msg.projectId || msg.project_id) chatParams.set('projectId', msg.projectId || msg.project_id);
        if (msg.serviceId || msg.service_id) chatParams.set('serviceId', msg.serviceId || msg.service_id);
        fetch(`/api/backoffice/chats/${encodeURIComponent(cid)}?${chatParams.toString()}`)
            .then(res => res.ok ? res.json() : null)
            .then(newChat => {
                if (newChat && newChat.id) {
                    const exists = chats.some(c => normChatId(c.id) === normChatId(newChat.id));
                    if (!exists) {
                        if (_notificationsActive && msg.role === 'user' && normChatId(cid) !== normChatId(activeChatId)) {
                            newChat.unread_count = Math.max(1, newChat.unread_count || 1);
                        }
                        chats.unshift(newChat);
                        sortChats();
                        renderChatList();
                        saveChatsToCache(chats);
                    }
                }
            })
            .catch(err => console.error('Error cargando chat nuevo:', err));
    }
});

socket.on('chat_updated', (payload) => {
    if (payload.projectId && window.railwayProjectId && payload.projectId !== window.railwayProjectId) return;
    if (payload.project_id && window.railwayProjectId && payload.project_id !== window.railwayProjectId) return;
    if (payload.serviceId && window.railwayServiceId && payload.serviceId !== window.railwayServiceId && window.railwayServiceId !== 'default_service') return;
    if (payload.service_id && window.railwayServiceId && payload.service_id !== window.railwayServiceId && window.railwayServiceId !== 'default_service') return;

    const cid = payload.chatId || payload.id;
    if (!cid) return;
    const chatIdx = chats.findIndex(c => normChatId(c.id) === normChatId(cid));
    if (chatIdx !== -1) {
        chats[chatIdx] = { ...chats[chatIdx], ...payload, id: chats[chatIdx].id };
        sortChats();
        renderChatList();
        saveChatsToCache(chats);
    }
    if (normChatId(cid) === normChatId(activeChatId)) {
        syncActiveChatMessages('chat_updated');
    }
});

socket.on('bot_toggled', (payload) => {
    if (payload.projectId && window.railwayProjectId && payload.projectId !== window.railwayProjectId) return;
    if (payload.serviceId && window.railwayServiceId && payload.serviceId !== window.railwayServiceId) return;
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
        refreshBotStateUI();
    } else {
        renderChatList();
    }
});

socket.on('setting_changed', (payload) => {
    if (payload?.key !== 'GLOBAL_BOT_ENABLED') return;
    if (payload.projectId && window.railwayProjectId && payload.projectId !== window.railwayProjectId) return;
    if (payload.serviceId && window.railwayServiceId && payload.serviceId !== window.railwayServiceId) return;
    setGlobalBotEnabled(payload.value !== 'false');
    refreshBotStateUI();
});

socket.on('message_deleted', (payload) => {
    console.log('🗑️ Mensaje eliminado por socket:', payload);
    const mId = payload.messageId;
    const extId = payload.externalId;
    allMessages = allMessages.filter(m => m.id !== mId && m.external_id !== extId);
    if (activeChatId === payload.chatId) {
        renderMessages();
    }
});

socket.on('message_status_update', ({ externalId, chatId, status }) => {
    const msg = allMessages.find(m => m.external_id === externalId || m.id === externalId);
    if (!msg) return;
    msg.status = status;
    if (normChatId(chatId) !== normChatId(activeChatId)) return;
    if (status === 'failed') {
        renderMessages();
        return;
    }
    // Patch only the icon in place - avoids full re-render and scroll jump
    const dataId = CSS.escape(String(msg.id || msg.external_id || ''));
    const msgEl = document.querySelector(`.msg[data-id="${dataId}"]`);
    if (msgEl) {
        const icon = msgEl.querySelector('.msg-time i');
        if (icon && status === 'read') {
            icon.style.color = '#53bdeb';
            icon.style.opacity = '';
        }
    } else {
        renderMessages();
    }
});

socket.on('chat_read', (payload) => {
    const cid = payload.chatId;
    const chat = chats.find(c => normChatId(c.id) === normChatId(cid));
    if (chat) {
        chat.unread_count = 0;
        renderChatList();
    }
});

socket.on('notifications_deactivated', () => {
    _notificationsActive = false;
    _updateNotificationsUI();
});

socket.on('notifications_activated', () => {
    loadNotificationsStatus();
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
    _fetchChatsController = new AbortController();
    try {
        const platformParam = currentPlatform === 'all' ? '' : `&platform=${currentPlatform}`;
        const serviceParam = _isSuperAdminMode && _activeServiceFilter !== 'all'
            ? `&serviceId=${_activeServiceFilter}`
            : (window.railwayServiceId ? `&serviceId=${window.railwayServiceId}` : '');
        const url = `/api/backoffice/chats?token=${token}&limit=${CHAT_LIMIT}&offset=${chatOffset}&search=${encodeURIComponent(query)}&tag=${tagFilter}${platformParam}${serviceParam}`;
        const res = await fetch(url, { signal: _fetchChatsController.signal });
        if (res.status === 401) {
            logout();
            return;
        }

        const newChats = await res.json();
        if (!Array.isArray(newChats)) {
            console.error('❌ La respuesta del servidor no es un arreglo válido de chats:', newChats);
            return;
        }
        if (newChats.length < CHAT_LIMIT) allChatsLoaded = true;

        if (refresh) {
            // Si el usuario ya tenía más chats cargados por scroll previo y no está aplicando filtros nuevos,
            // actualizamos los datos de los chats existentes sin truncar la lista a 50 para no perder el scroll.
            if (chats.length > CHAT_LIMIT && !query && !tagFilter) {
                const newMap = new Map(newChats.map(c => [c.id, c]));
                const updatedChats = chats.map(c => newMap.has(c.id) ? { ...c, ...newMap.get(c.id) } : c);
                const existingIds = new Set(chats.map(c => c.id));
                const freshNew = newChats.filter(nc => !existingIds.has(nc.id));
                chats = freshNew.length > 0 ? [...freshNew, ...updatedChats] : updatedChats;
            } else {
                chats = newChats;
            }
        } else {
            // Evitar duplicados si hay mensajes en tiempo real entrando
            const existingIds = chats.map(c => c.id);
            const filteredNew = newChats.filter(nc => !existingIds.includes(nc.id));
            chats = [...chats, ...filteredNew];
        }

        chatOffset = chats.length;
        renderChatList();

        // Auto-abrir chat si venimos desde el CRM
        const pendingChatId = localStorage.getItem('activeChat');
        if (pendingChatId) {
            localStorage.removeItem('activeChat');
            activeChatId = pendingChatId;
            console.log('[CRM] Auto-abriendo chat:', pendingChatId);
            // Esperar un breve instante para asegurar que el DOM está listo
            setTimeout(() => selectChat(pendingChatId), 100);
            return;
        }

        if (activeChatId) {
            const activeChat = chats.find(c => c.id === activeChatId);
            const chatHeader = document.getElementById('chat-header');
            const needsRestore = !chatHeader || chatHeader.style.display === 'none';
            if (needsRestore) {
                restoreBackofficeChatFromMemory();
            } else if (activeChat) {
                refreshBotStateUI();
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error(e);
    } finally {
        loadingChats = false;
    }
}

async function fetchBotTags() {
    try {
        const res = await fetch(`/api/backoffice/tags?token=${token}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            _boBotTags = data;
            renderTagManager();
            renderFilterDropdown();
            renderBulkFilterDropdown();
        } else {
            console.error('❌ La respuesta del servidor no es un arreglo válido de etiquetas:', data);
        }
    } catch (e) { console.error(e); }
}

function renderBulkFilterDropdown() {
    const select = document.getElementById('bulk-filter-tags');
    if (!select) return;

    const selectedVals = Array.from(select.selectedOptions).map(o => o.value);

    select.innerHTML =
        _boBotTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

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
    select.innerHTML = '<option value="">Etiquetas</option>' +
        _boBotTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
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

const avatarCache = new Map();
const avatarFailed = new Set();
window._avatarFail = (chatId) => avatarFailed.add(chatId);

function getInitials(name) {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

function getAvatarBg(str) {
    const colors = ['#0078D4', '#25d366', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f97316', '#6366f1'];
    let hash = 0;
    for (let i = 0; i < (str || '').length; i++) hash = (str.charCodeAt(i) + ((hash << 5) - hash)) | 0;
    return colors[Math.abs(hash) % colors.length];
}

function renderChatList(listToRender = chats) {
    const list = document.getElementById('chat-list');
    if (!list) return;

    // Solo leer el scrollTop si la lista es visible (clientHeight > 0).
    // Si la lista está oculta (por ejemplo en móvil dentro de un chat), usar el scroll previamente guardado.
    const isVisible = list.clientHeight > 0;
    if (isVisible && list.scrollTop > 0) {
        _backofficeChatListScrollTop = list.scrollTop;
    }
    const prevScrollTop = _backofficeChatListScrollTop || 0;

    let filteredList = listToRender;
    if (_isSuperAdminMode && _activeServiceFilter !== 'all') {
        filteredList = filteredList.filter(c => c.service_id === _activeServiceFilter);
    }
    if (_notificationsActive && _showOnlyUnreadChats) {
        // Mantener chats no leídos O el chat activo actual que se está atendiendo
        filteredList = filteredList.filter(c => (c.unread_count || 0) > 0 || c.id === activeChatId);
    }

    // Calcular unread total de la lista master (chats)
    let totalUnread = 0;
    if (_notificationsActive) {
        totalUnread = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    }
    const totalBadge = document.getElementById('unread-total-badge');
    if (totalBadge) {
        if (_notificationsActive && totalUnread > 0) {
            totalBadge.innerText = totalUnread > 99 ? '+99' : totalUnread;
            totalBadge.style.display = 'inline-block';
        } else {
            totalBadge.style.display = 'none';
        }
    }

    if (filteredList.length === 0) {
        list.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
            ${_showOnlyUnreadChats ? 'No hay chats con mensajes sin leer' : 'No se encontraron chats'}
        </div>`;
        list.scrollTop = prevScrollTop;
        return;
    }

    list.innerHTML = filteredList.map(chat => {
        const nameForAvatar = (chat.name && chat.name !== '[-]') ? chat.name : chat.id.split('@')[0];
        const initials = getInitials(nameForAvatar);
        const bg = getAvatarBg(chat.id || '');

        // Icono de plataforma
        let platformIcon = '';
        if (chat.type === 'instagram') platformIcon = '<i class="fab fa-instagram platform-instagram"></i>';
        else if (chat.type === 'messenger') platformIcon = '<i class="fab fa-facebook-messenger platform-messenger"></i>';

        const showIconOverlay = currentPlatform === 'all' && chat.type !== 'whatsapp';
        const iconOverlayHtml = showIconOverlay ? `<div class="platform-icon-overlay">${platformIcon}</div>` : '';

        let tagsHtml = '';
        if (chat.tags && chat.tags.length > 0) {
            const MAX_TAGS = 2;
            const visibleTags = chat.tags.slice(0, MAX_TAGS);
            const hiddenCount = chat.tags.length - MAX_TAGS;

            tagsHtml = `<div class="chat-tags-list" style="display:flex; flex-wrap:nowrap; overflow:hidden; gap:3px; min-width:0; margin-top:3px;">` + visibleTags.map(t =>
                `<span class="tag-pill" data-tag-color="${t.color || '#6366f1'}" style="${_tagStyle(t.color)}; font-size: 0.6rem; padding: 2px 6px; line-height: 1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70px;">${t.name}</span>`
            ).join('');

            if (hiddenCount > 0) {
                tagsHtml += `<span class="tag-pill" style="background:var(--bg-secondary); color:var(--text-muted); font-size: 0.6rem; padding: 2px 6px; line-height: 1.1; border: 1px solid var(--border-color); white-space:nowrap; flex-shrink:0; font-weight: 600;">+${hiddenCount}</span>`;
            }
            tagsHtml += `</div>`;
        }

        const timeStr = formatLastMessageTime(chat.last_message_at);
        const unreadCount = chat.unread_count || 0;
        const displayCount = unreadCount > 99 ? '+99' : unreadCount;
        
        const hasUnread = _notificationsActive && unreadCount > 0;
        const timeHtml = `<span style="font-size: 0.65rem; opacity: 0.7; font-weight: 500; margin-bottom: 2px;">${timeStr}</span>`;
        const unreadHtml = hasUnread ? `<div class="unread-badge">${displayCount}</div>` : '';

        const isBotActive = isBotEffectivelyEnabled(chat);
        const botIconColor = isBotActive ? '#22c55e' : '#f87171';
        const botIconClass = isBotActive ? 'fa-robot' : 'fa-user';
        const avatarBotBadge = `
            <div class="chat-bot-badge">
                <i class="fas ${botIconClass}" style="color: ${botIconColor}; font-size: 0.65rem; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center;"></i>
            </div>
        `;

        // CRM Status Badge
        let crmStatusHtml = '';
        if (chat.crm_status && chat.crm_status !== 'UNASSIGNED') {
            const col = (crmColumns || []).find(c => c.id === chat.crm_status || c.title === chat.crm_status);
            const statusLabel = col ? col.title : chat.crm_status;
            crmStatusHtml = `<span class="crm-status-badge" style="font-size: 0.65rem; background: rgba(99, 102, 241, 0.1); color: var(--accent); padding: 2px 6px; border-radius: 6px; font-weight: 700; margin-top: 4px; display: inline-block; border: 1px solid rgba(99, 102, 241, 0.2); line-height: 1.2;">${statusLabel}</span>`;
        }

        let serviceBadgeHtml = '';
        if (_isSuperAdminMode && (_activeServiceFilter === 'all' || !_activeServiceFilter) && _projectServices.length > 0) {
            const svc = _projectServices.find(s => s.id === chat.service_id || (!chat.service_id && s.id === 'default_service'));
            const crmName = svc ? (svc.assistantName || svc.name) : (chat.service_id ? chat.service_id.substring(0, 8) : '');
            if (crmName) {
                serviceBadgeHtml = `<span class="service-badge" title="CRM: ${crmName}" style="font-size: 0.62rem; background: rgba(99, 102, 241, 0.12); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.25); padding: 1px 5px; border-radius: 4px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; display: inline-flex; align-items: center; gap: 3px; line-height: 1.2;"><i class="fas fa-robot" style="font-size: 0.55rem; opacity: 0.85;"></i><span>${crmName}</span></span>`;
            }
        }

        return `
            <div class="chat-item ${activeChatId === chat.id ? 'active' : ''}" onclick="selectChat('${chat.id}')">
                <div class="chat-avatar" style="background:${bg}; position: relative; overflow: visible;">
                    <span>${initials}</span>
                    ${iconOverlayHtml}
                    ${avatarBotBadge}
                </div>
                <div class="chat-info">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                        <div style="display:flex; flex-direction:column; min-width:0; flex:1; overflow:hidden;">
                            <div style="display:flex; align-items:center; gap:4px; overflow:hidden;">
                                <span class="chat-name" style="flex-shrink:0; max-width:120px;">${(chat.name && chat.name !== '[-]') ? chat.name : chat.id.split('@')[0]}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px; min-width:0; overflow:hidden; margin-top:1px;">
                                <span class="chat-phone" style="white-space:nowrap;">${chat.id.split('@')[0]}</span>
                                ${serviceBadgeHtml}
                            </div>
                            ${tagsHtml}
                            ${crmStatusHtml ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${crmStatusHtml}</div>` : ''}
                        </div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:center; flex-shrink:0; min-width: 45px; gap: 2px;">
                            ${timeHtml}
                            ${unreadHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (isVisible) {
        list.scrollTop = prevScrollTop;
    }
    requestAnimationFrame(() => {
        if (list && list.clientHeight > 0) {
            list.scrollTop = prevScrollTop;
        }
    });
}


async function switchPlatform(platform) {
    if (loadingChats) return;
    currentPlatform = platform;

    // Actualizar UI de tabs
    document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${platform}`)?.classList.add('active');

    console.log(`[Platform] Cambiando a ${platform}`);
    fetchChats(true);
}

async function checkPlatformVisibility() {
    try {
        const tabs = document.getElementById('platform-tabs');
        if (!tabs) {
            currentPlatform = 'all';
            return;
        }

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

window.backofficeCloseMobileChat = function () {
    document.body.classList.remove('mobile-chat-active');
    const list = document.getElementById('chat-list');
    if (list) {
        const target = _backofficeChatListScrollTop || 0;
        requestAnimationFrame(() => {
            list.scrollTop = target;
        });
        setTimeout(() => {
            if (list) list.scrollTop = target;
        }, 50);
    }
};

async function selectChat(id) {
    const listEl = document.getElementById('chat-list');
    if (listEl && listEl.clientHeight > 0 && listEl.scrollTop > 0) {
        _backofficeChatListScrollTop = listEl.scrollTop;
    }
    if (_isRecording) cancelRecording();
    activeChatId = id;
    window.__activeBackofficeChatId = id;
    activeTicketId = null;
    if (window.innerWidth <= 768) document.body.classList.add('mobile-chat-active');

    let chat = chats.find(c => c.id === id);
    if (!chat) {
        console.log(`🔍 [UI] Chat ${id} no encontrado en la lista local, buscando en el servidor...`);
        try {
            const res = await fetch(`/api/backoffice/chats/${id}?token=${token}`);
            if (res.ok) {
                chat = await res.json();
                if (chat && chat.id) {
                    chats.unshift(chat);
                    renderChatList();
                }
            }
        } catch (err) {
            console.error('Error buscando chat en el servidor:', err);
        }
    }

    if (!chat) {
        console.error(`❌ Chat ${id} no encontrado en local ni en el servidor.`);
        return;
    }

    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) chatHeader.style.display = 'flex';

    const inputArea = document.getElementById('input-area');
    if (inputArea) inputArea.style.display = 'flex';

    if (_notificationsActive && chat) {
        markChatAsRead(id);
    }

    document.getElementById('active-chat-phone').innerText = chat.id.split('@')[0];
    const displayName = (chat.name && chat.name !== '[-]') ? chat.name : 'Lead sin nombre';
    document.getElementById('active-chat-name').innerText = displayName;

    const headerAvatar = document.getElementById('active-chat-avatar');
    const nameForAvatar = (chat.name && chat.name !== '[-]') ? chat.name : chat.id.split('@')[0];
    const headerInitials = getInitials(nameForAvatar);
    const headerBg = getAvatarBg(chat.id || '');
    headerAvatar.style.background = headerBg;
    headerAvatar.innerHTML = `<span>${headerInitials}</span>`;

    const botToggle = document.getElementById('bot-toggle');
    if (botToggle) botToggle.disabled = false;
    refreshBotStateUI();

    // Habilitar botones de acción independientes
    const tagsBtn = document.getElementById('open-tags-btn');
    const crmBtn = document.getElementById('open-crm-btn');
    const ticketBtn = document.getElementById('open-ticket-btn');
    const quickMsgBtn = document.getElementById('quick-msg-btn');
    const metaTemplatesBtn = document.getElementById('meta-templates-btn');
    const deleteChatBtn = document.getElementById('delete-chat-btn');
    const chatbotToggleBtn = document.getElementById('chatbot-toggle-btn');
    if (tagsBtn) tagsBtn.disabled = false;
    if (crmBtn) crmBtn.disabled = false;
    if (ticketBtn) ticketBtn.disabled = false;
    if (quickMsgBtn) quickMsgBtn.disabled = false;
    if (metaTemplatesBtn) metaTemplatesBtn.disabled = false;
    if (deleteChatBtn) deleteChatBtn.disabled = false;
    if (chatbotToggleBtn) chatbotToggleBtn.disabled = !_globalBotEnabled;

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
    if (_restoringBackofficeView && allMessages.length) {
        renderMessages();
    } else {
        fetchMessages(id, true);
    }
    checkBlacklistForChat(id); // Verificar estado en lista negra
}

function renderActiveChatTags() {
    const chat = chats.find(c => c.id === activeChatId);
    const container = document.getElementById('active-chat-tags');
    if (!container) return;
    if (chat && chat.tags) {
        container.innerHTML = chat.tags.map(t =>
            `<span class="tag-pill" data-tag-color="${t.color || '#6366f1'}" style="${_tagStyle(t.color)}">${t.name}</span>`
        ).join('');
    } else {
        container.innerHTML = '';
    }
}

function updateBotStatusText(enabled) {
    const txt = document.getElementById('bot-status-text');
    if (!txt) return;
    const isEnabled = enabled === true || enabled === 'true' || enabled === 1;
    txt.innerHTML = isEnabled
        ? '<i class="fas fa-robot"></i>'
        : '<i class="fas fa-user"></i>';
    txt.className = isEnabled ? 'status-bot' : 'status-human';
    const mobileLabel = document.getElementById('mobile-bot-label');
    if (mobileLabel) mobileLabel.textContent = isEnabled ? 'Bot: on' : 'Bot: off';
}

function updateInputState(botEnabled) {
    const input = document.getElementById('message-input');
    const btn = document.getElementById('send-btn');
    const attachBtn = document.getElementById('attach-btn');
    if (!input || !btn || !attachBtn) return;

    // Normalización estricta a booleano
    const isBotEnabled = (botEnabled === true || botEnabled === 'true' || botEnabled === 1 || botEnabled === '1');

    console.log(`[UI] Actualizando estado de input. Bot habilitado: ${isBotEnabled}`);

    // Bot activo = todo bloqueado; bot inactivo = todo habilitado
    input.disabled = isBotEnabled;
    btn.disabled = isBotEnabled;
    attachBtn.disabled = false;
    const fileAction = document.getElementById('input-plus-file-action');
    if (fileAction) {
        fileAction.classList.toggle('disabled', isBotEnabled);
        fileAction.setAttribute('aria-disabled', String(isBotEnabled));
    }
    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn) emojiBtn.disabled = isBotEnabled;
    const quickMsgBtn = document.getElementById('quick-msg-btn');
    if (quickMsgBtn) quickMsgBtn.disabled = false; // Siempre habilitado si hay un chat seleccionado
    const metaTemplatesBtn = document.getElementById('meta-templates-btn');
    if (metaTemplatesBtn) metaTemplatesBtn.disabled = false; // Siempre habilitado si hay un chat seleccionado
    const micBtn = document.getElementById('mic-btn');
    if (micBtn && !_isRecording) micBtn.disabled = isBotEnabled;

    if (isBotEnabled) {
        input.parentElement.style.borderColor = 'var(--accent)';
        input.style.opacity = '0.6';
        input.placeholder = "Asistente Activo";
    } else {
        input.parentElement.style.borderColor = '#f87171';
        input.style.opacity = '1';
        input.placeholder = "Escribe un mensaje aquí";
    }

    // Refrescar el estado de los mensajes rápidos si el popover está abierto
    const popover = document.getElementById('quick-messages-popover');
    if (popover && popover.style.display !== 'none') {
        window.loadQuickMessages();
    }
}



async function fetchMessages(chatId, reset = false) {
    // Al cambiar de chat, cancelar el fetch anterior y forzar la nueva carga
    if (reset) {
        if (_fetchMessagesController) _fetchMessagesController.abort();
        loadingMessages = false;
        messageOffset = 0;
        allMessagesLoaded = false;
    }

    if (loadingMessages) return;
    if (allMessagesLoaded && !reset) return;

    loadingMessages = true;
    const myController = new AbortController();
    _fetchMessagesController = myController;

    try {
        const scopeParams = getActiveChatScopeParams();
        const res = await fetch(
            `/api/backoffice/messages/${chatId}?token=${token}&limit=${MSG_LIMIT}&offset=${messageOffset}${scopeParams ? `&${scopeParams}` : ''}`,
            { signal: myController.signal }
        );

        // Si el usuario cambio de chat mientras esperabamos la respuesta, descartar
        if (chatId !== activeChatId) return;

        const newMessages = await res.json();

        if (chatId !== activeChatId) return;

        if (newMessages.length < MSG_LIMIT) allMessagesLoaded = true;

        const container = document.getElementById('messages');
        if (!container) return;
        const oldScrollHeight = container.scrollHeight;

        if (reset) {
            allMessages = newMessages;
            _seenMessageIds = new Set(newMessages.map(m => m.id || m.external_id).filter(Boolean));
        } else {
            allMessages = [...newMessages, ...allMessages];
        }

        renderMessages();

        if (reset) {
            container.scrollTop = container.scrollHeight;
        } else {
            container.scrollTop = container.scrollHeight - oldScrollHeight;
        }

        messageOffset += newMessages.length;
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error(e);
    } finally {
        // Solo resetear el flag si somos el fetch activo (evita que un abort previo resetee el flag del nuevo chat)
        if (_fetchMessagesController === myController) loadingMessages = false;
    }
}

// --- SISTEMA DE CACHÉ DE MEDIA EN INDEXEDDB (OFFLINE-FIRST) ---
const mediaCache = {
    db: null,
    init() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve();
            const request = indexedDB.open('RialWayMediaCache', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('media')) {
                    db.createObjectStore('media');
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },
    async get(url) {
        const isCacheable = url.startsWith('/') || url.includes('/uploads/') || url.includes('/tmp/') || url.includes('/temp/');
        if (!isCacheable) return url;

        try {
            await this.init();
            return new Promise((resolve) => {
                const transaction = this.db.transaction(['media'], 'readonly');
                const store = transaction.objectStore('media');
                const request = store.get(url);

                request.onsuccess = async (e) => {
                    const cached = e.target.result;
                    if (cached === 'NOT_FOUND') { resolve(null); return; }
                    if (cached) { resolve(URL.createObjectURL(cached)); return; }
                    try {
                        const res = await fetch(url);
                        if (!res.ok) {
                            const tx = this.db.transaction(['media'], 'readwrite');
                            tx.objectStore('media').put('NOT_FOUND', url);
                            resolve(null);
                            return;
                        }
                        const blob = await res.blob();
                        const tx = this.db.transaction(['media'], 'readwrite');
                        tx.objectStore('media').put(blob, url);
                        resolve(URL.createObjectURL(blob));
                    } catch (fetchErr) {
                        resolve(null);
                    }
                };
                request.onerror = () => resolve(url);
            });
        } catch (err) {
            return url;
        }
    }
};

async function loadCachedMedia() {
    const elements = document.querySelectorAll('.cached-media[data-media-src]');
    elements.forEach(async (el) => {
        const src = el.getAttribute('data-media-src');
        if (!src) return;
        try {
            const finalSrc = await mediaCache.get(src);
            if (finalSrc) {
                el.src = finalSrc;
                el.removeAttribute('data-media-src');
                const parent = el.closest('.image-container, .video-container, .msg-audio, .wa-audio-player');
                if (parent) {
                    const downloadBtn = parent.querySelector('.cached-download');
                    if (downloadBtn) downloadBtn.href = finalSrc;
                    if (parent.classList.contains('wa-audio-player')) _initWaPlayer(parent);
                }
            } else {
                const parent = el.closest('.image-container, .video-container, .msg-audio, .wa-audio-player');
                if (parent) parent.style.display = 'none';
            }
        } catch (e) {
            // silently ignore
        }
    });
}

// --- WhatsApp-style audio player ---
function _waWaveform(url) {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
    let out = '';
    for (let i = 0; i < 30; i++) {
        h = (h * 1664525 + 1013904223) | 0;
        out += `<span class="wa-bar" style="height:${18 + (Math.abs(h) % 65)}%"></span>`;
    }
    return out;
}

function _waFmtTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function _initWaPlayer(playerEl) {
    const audio = playerEl.querySelector('audio');
    const timeEl = playerEl.querySelector('.wa-audio-time');
    const bars = playerEl.querySelectorAll('.wa-bar');
    const icon = playerEl.querySelector('.wa-play-btn i');
    if (!audio || !timeEl) return;

    const updateBars = () => {
        if (!audio.duration) return;
        const filled = Math.floor((audio.currentTime / audio.duration) * bars.length);
        bars.forEach((b, i) => { b.style.opacity = i < filled ? '1' : '0.35'; });
    };

    audio.addEventListener('loadedmetadata', () => { timeEl.textContent = _waFmtTime(audio.duration); });
    audio.addEventListener('timeupdate', () => { updateBars(); timeEl.textContent = _waFmtTime(audio.currentTime); });
    audio.addEventListener('ended', () => {
        icon.className = 'fas fa-play';
        playerEl.classList.remove('wa-playing');
        bars.forEach(b => { b.style.opacity = '0.35'; });
        timeEl.textContent = _waFmtTime(audio.duration);
    });
}

function waTogglePlay(pid) {
    const box = document.getElementById(pid);
    if (!box) return;
    const audio = box.querySelector('audio');
    const icon = box.querySelector('.wa-play-btn i');
    document.querySelectorAll('.wa-audio-player').forEach(p => {
        if (p.id !== pid) {
            const a = p.querySelector('audio');
            if (a && !a.paused) {
                a.pause();
                const i = p.querySelector('.wa-play-btn i');
                if (i) i.className = 'fas fa-play';
                p.classList.remove('wa-playing');
            }
        }
    });
    if (!audio) return;
    if (audio.paused) {
        audio.play();
        icon.className = 'fas fa-pause';
        box.classList.add('wa-playing');
    } else {
        audio.pause();
        icon.className = 'fas fa-play';
        box.classList.remove('wa-playing');
    }
}

function waSeek(pid, e) {
    const box = document.getElementById(pid);
    const audio = box?.querySelector('audio');
    if (!audio?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
}

function renderMessages() {
    const container = document.getElementById('messages');
    const wasAtBottom = !container || container.scrollTop >= container.scrollHeight - container.clientHeight - 60;
    const prevScrollTop = container ? container.scrollTop : 0;
    let html = '';
    let lastDate = null;

    const newIds = [];
    allMessages.forEach(m => {
        const date = new Date(m.created_at);
        const dateStr = date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

        if (dateStr !== lastDate) {
            html += `<div class="date-separator"><span>${dateStr}</span></div>`;
            lastDate = dateStr;
        }
        const msgId = m.id || m.external_id;
        const isNew = !!(msgId && !_seenMessageIds.has(msgId) && !m._noAnimate);
        if (isNew && msgId) newIds.push(msgId);
        html += generateMessageHtml(m, isNew);
    });

    container.innerHTML = html;
    newIds.forEach(id => _seenMessageIds.add(id));
    container.scrollTop = wasAtBottom ? container.scrollHeight : prevScrollTop;
    initMessageLongPressMenu();
    loadCachedMedia();
    loadFileSizes();
}

function generateMessageHtml(m, isNew = false) {
    const date = new Date(m.created_at);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let raw = m.rawPayload || m.raw_payload || {};
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
    }

    let contentHtml = m.content || '';
    const type = m.type || raw.type || 'text';

    const adReferral = getAdReferralFromMessage(m);
    const adCardHtml = adReferral ? `
            <div class="msg-ad-card" onclick="event.stopPropagation();">
                <div class="msg-ad-header">
                    <span class="msg-ad-badge"><i class="fab fa-facebook"></i> Anuncio</span>
                    ${adReferral.sourceUrl ? `<a href="${escapeMsgHtml(adReferral.sourceUrl)}" target="_blank" rel="noopener" class="msg-ad-link"><i class="fas fa-external-link-alt"></i> Ver anuncio</a>` : ''}
                </div>
                <div class="msg-ad-title">${escapeMsgHtml(adReferral.headline)}</div>
                ${adReferral.body ? `<div class="msg-ad-desc">${escapeMsgHtml(adReferral.body)}</div>` : ''}
            </div>` : '';

    const isButton = type === 'button' || raw?.type === 'button' || !!raw?.button || !!raw?.interactive;
    const buttonTagHtml = isButton ? `
            <div class="msg-button-tag">
                <i class="fas fa-hand-pointer"></i> Opción seleccionada
            </div>` : '';

    const replyPreview = getReplyPreviewFromMessage(m);
    const replyPreviewHtml = replyPreview ? `
            <div class="msg-reply-quote" onclick="event.stopPropagation();">
                <div class="msg-reply-author">${escapeMsgHtml(replyPreview.author || (replyPreview.role === 'assistant' ? 'Vos' : 'Cliente'))}</div>
                <div class="msg-reply-text">${escapeMsgHtml(replyPreview.content || getMessagePreviewText(replyPreview) || 'Mensaje')}</div>
            </div>` : '';

    // Solo tratar como media si el content parece una URL real (no texto de caption)
    const looksLikeUrl = contentHtml.startsWith('/') || contentHtml.startsWith('http://') || contentHtml.startsWith('https://') || contentHtml.includes('/uploads/') || contentHtml.includes('/tmp/');

    const isImageUrl = looksLikeUrl && (type === 'image' || type === 'sticker' || contentHtml.match(/\.(jpeg|jpg|gif|png|webp|svg)($|\?)/i));
    const isAudioType = type === 'voice' || type === 'audio';
    const isVideoUrl = looksLikeUrl && !isAudioType && (type === 'video' || contentHtml.match(/\.(mp4|webm)($|\?)/i));
    const isAudioUrl = looksLikeUrl && (isAudioType || contentHtml.match(/\.(ogg|opus|mp3|wav|aac|m4a|webm)($|\?)/i));
    const isFileUrl = looksLikeUrl && (type === 'document' || (contentHtml.includes('/uploads/') && !isImageUrl && !isVideoUrl && !isAudioUrl));

    if (isImageUrl && contentHtml) {
        contentHtml = `
            <div class="msg-media image-container">
                <img data-media-src="${contentHtml}" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23f1f5f9'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='10' fill='%2394a3b8'>Cargando...</text></svg>" alt="imagen" onclick="openLightbox(this.src)" class="zoomable-image cached-media">
                <div class="media-actions">
                    <button onclick="event.stopPropagation(); openForwardModal('${contentHtml}', 'image')" class="media-action-btn" title="Reenviar Imagen" style="background: rgba(0,0,0,0.5); border: none; color: white; border-radius: 4px; padding: 6px 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                        <i class="fas fa-share"></i>
                    </button>
                    <a href="${contentHtml}" download class="media-action-btn cached-download" title="Descargar Imagen">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            </div>`;
    } else if (isVideoUrl && contentHtml) {
        contentHtml = `
            <div class="msg-media video-container">
                <video data-media-src="${contentHtml}" controls class="cached-media"></video>
                <div class="media-actions">
                    <button onclick="event.stopPropagation(); openForwardModal('${contentHtml}', 'video')" class="media-action-btn" title="Reenviar Video" style="background: rgba(0,0,0,0.5); border: none; color: white; border-radius: 4px; padding: 6px 10px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">
                        <i class="fas fa-share"></i>
                    </button>
                    <a href="${contentHtml}" download class="media-action-btn cached-download" title="Descargar Video">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            </div>`;
    } else if (isAudioUrl && contentHtml) {
        const audioUrl = contentHtml;
        const pid = 'wap-' + (m.id || m.external_id || Date.now()).toString().replace(/\W/g, '_');
        const chat = chats.find(c => c.id === (m.chat_id || activeChatId));
        const name = chat?.contact_name || chat?.name || '';
        const initial = name ? name.charAt(0).toUpperCase() : '<i class="fas fa-user"></i>';
        const avatarHtml = m.role === 'user'
            ? (name ? `<span>${initial}</span>` : '<i class="fas fa-user"></i>')
            : '<i class="fas fa-microphone"></i>';
        contentHtml = `
            <div class="wa-audio-player" id="${pid}">
                <audio class="cached-media" data-media-src="${audioUrl}" preload="metadata"></audio>
                <button class="wa-play-btn" onclick="waTogglePlay('${pid}')">
                    <i class="fas fa-play"></i>
                </button>
                <div class="wa-audio-body">
                    <div class="wa-waveform" onclick="waSeek('${pid}', event)">${_waWaveform(audioUrl)}</div>
                    <span class="wa-audio-time">0:00</span>
                </div>
                <div class="wa-avatar">${avatarHtml}</div>
            </div>`;
    } else if (isFileUrl && contentHtml) {
        const fileUrl = contentHtml;
        const fileName = getFileDisplayName(fileUrl);
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        const displayExt = (ext || 'archivo').toUpperCase();
        const safeFileUrl = escapeMsgHtml(fileUrl);
        const iconMap = { pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word', xls: 'fa-file-excel', xlsx: 'fa-file-excel', csv: 'fa-file-csv', zip: 'fa-file-zipper', rar: 'fa-file-zipper', txt: 'fa-file-lines', png: 'fa-file-image', jpg: 'fa-file-image', jpeg: 'fa-file-image' };
        const icon = iconMap[ext] || 'fa-file';
        contentHtml = `
            <a href="${safeFileUrl}" download class="msg-file" onclick="event.stopPropagation();">
                <div class="msg-file-link">
                    <div class="msg-file-icon"><i class="fas ${icon}"></i></div>
                    <div class="msg-file-info">
                        <span class="msg-file-name">${escapeMsgHtml(fileName)}</span>
                        <span class="msg-file-meta" data-file-src="${safeFileUrl}" data-file-type="${escapeMsgHtml(displayExt)}">${escapeMsgHtml(displayExt)}</span>
                    </div>
                </div>
            </a>`;
    }

    const externalId = m.id || m.external_id || '';

    const reactionHtml = m.reaction ? `<div class="msg-reaction-badge" onclick="event.stopPropagation();">${m.reaction}</div>` : '';

    let checkHtml = '';
    const hasFailed = m._failed || m.status === 'failed';
    if (hasFailed) checkHtml = ' <i class="fas fa-times-circle" style="color:#ef4444;font-size:0.62rem;"></i>';
    else if (m._pending) checkHtml = ' <i class="fas fa-check" style="opacity:0.55;font-size:0.62rem;"></i>';
    else if (m.status === 'read') checkHtml = ' <i class="fas fa-check-double" style="color:#53bdeb;font-size:0.62rem;"></i>';
    else checkHtml = ' <i class="fas fa-check-double" style="opacity:0.75;font-size:0.62rem;"></i>';

    const dropdownHtml = `
            <div id="dropdown-${externalId}" class="msg-dropdown-menu" onclick="event.stopPropagation();">
                <div class="msg-reactions-bar">
                    <button class="msg-reaction-btn" onclick="window.reactToMessage('${externalId}', '👍')">👍</button>
                    <button class="msg-reaction-btn" onclick="window.reactToMessage('${externalId}', '❤️')">❤️</button>
                    <button class="msg-reaction-btn" onclick="window.reactToMessage('${externalId}', '😂')">😂</button>
                    <button class="msg-reaction-btn" onclick="window.reactToMessage('${externalId}', '😮')">😮</button>
                    <button class="msg-reaction-btn" onclick="window.reactToMessage('${externalId}', '😢')">😢</button>
                    <button class="msg-reaction-btn" onclick="window.reactToMessage('${externalId}', '🙏')">🙏</button>
                </div>
                <div class="msg-dropdown-item" onclick="window.replyToMessage('${externalId}')">
                    <i class="fas fa-reply"></i> Responder
                </div>
                <div class="msg-dropdown-item" onclick="window.openForwardModal('${externalId}')">
                    <i class="fas fa-share"></i> Reenviar
                </div>
                <div class="msg-dropdown-item" onclick="window.copyMessage('${externalId}')">
                    <i class="fas fa-copy"></i> Copiar mensaje
                </div>
                <div class="msg-dropdown-item" onclick="window.copySelectedMessageText('${externalId}')">
                    <i class="fas fa-i-cursor"></i> Copiar selección
                </div>
                <div class="msg-dropdown-item text-red-500" onclick="window.deleteMessage('${externalId}')">
                    <i class="fas fa-trash"></i> Eliminar
                </div>
            </div>
    `;

    return `
        <div class="msg ${m.role}${isNew ? ' msg-animate' : ''}" data-id="${externalId}" onclick="window.onMsgClick && window.onMsgClick(event, '${externalId}')" style="position:relative; margin-bottom:${m.reaction ? '16px' : '8px'};">
            <div class="msg-checkbox-container">
                <input type="checkbox" class="msg-checkbox" id="checkbox-${externalId}" onchange="window.toggleDeleteSelection && window.toggleDeleteSelection('${externalId}')">
            </div>
            ${dropdownHtml}
            ${adCardHtml}
            ${replyPreviewHtml}
            ${buttonTagHtml}
            <div class="msg-content">${contentHtml}</div>
            <span class="msg-time">${time}${checkHtml}</span>
            ${reactionHtml}
        </div>
    `;
}

function getActiveChatDisplayName() {
    const chat = getActiveChat();
    const headerName = document.getElementById('active-chat-name')?.textContent?.trim();
    return (chat?.name && chat.name !== '[-]')
        ? chat.name
        : (headerName && headerName !== 'Selecciona un chat' && headerName !== 'Lead sin nombre'
            ? headerName
            : (chat?.id ? String(chat.id).split('@')[0] : 'este chat'));
}

async function toggleBot(enabled, options = {}) {
    try {
        const res = await fetch('/api/backoffice/toggle-bot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'token=' + token
            },
            body: JSON.stringify({ chatId: activeChatId, enabled })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) chat.bot_enabled = enabled;
            refreshBotStateUI();
            if (options.toast) {
                const name = getActiveChatDisplayName();
                showToast(enabled ? `Chatbot reanudado para ${name}` : `Chatbot desactivado para ${name}`);
            }
        } else {
            refreshBotStateUI();
            if (typeof showToast === 'function') {
                showToast(data.error || 'No se puede activar el bot: contacto en lista negra.', 'warning');
            }
        }
    } catch (e) {
        refreshBotStateUI();
        if (typeof showToast === 'function') {
            showToast('Error al cambiar el estado del bot.', 'error');
        }
    }
}

window.toggleChatbotForActiveChat = function () {
    if (!_globalBotEnabled) return;
    const chat = getActiveChat();
    if (!chat) return;
    const chatEnabled = chat.bot_enabled === true || chat.bot_enabled === 'true' || chat.bot_enabled === 1 || chat.bot_enabled === '1';
    toggleBot(!chatEnabled, { toast: true });
};

function handleFileSelect(input) {
    if (input.files && input.files[0]) {
        selectedFile = input.files[0];
        openFilePreview(selectedFile);
    }
}

function openFilePreview(file) {
    if (!file) return;
    let targetFile = file;
    if (!targetFile.name || targetFile.name.trim() === '') {
        const ext = targetFile.type ? targetFile.type.split('/')[1] || 'png' : 'png';
        const desc = targetFile.type && targetFile.type.startsWith('image/') ? 'imagen' : (targetFile.type && targetFile.type.startsWith('video/') ? 'video' : 'archivo');
        const defaultName = `${desc}_pegado_${Date.now()}.${ext}`;
        try {
            targetFile = new File([targetFile], defaultName, { type: targetFile.type });
        } catch (_) {
            // File constructor fallback is best-effort for pasted files.
        }
    }
    selectedFile = targetFile;

    const overlay = document.getElementById('file-preview-overlay');
    if (!overlay) return;
    const body = document.getElementById('file-preview-body');
    const name = document.getElementById('file-preview-name');
    if (!body || !name) return;

    name.textContent = targetFile.name || 'Archivo adjunto';
    body.innerHTML = '';

    const mime = targetFile.type || '';
    if (mime.startsWith('image/')) {
        const img = document.createElement('img');
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;';
        img.src = URL.createObjectURL(targetFile);
        body.appendChild(img);
    } else if (mime.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.controls = true;
        vid.style.cssText = 'max-width:100%;max-height:100%;border-radius:4px;';
        vid.src = URL.createObjectURL(targetFile);
        body.appendChild(vid);
    } else {
        const ext = (targetFile.name || '').split('.').pop()?.toUpperCase() || 'FILE';
        const sizeKb = Math.round((targetFile.size || 0) / 1024);
        const sizeStr = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} kB`;
        body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:32px;background:rgba(255,255,255,0.05);border-radius:12px;min-width:220px;">
                <div style="width:72px;height:80px;background:rgba(255,255,255,0.1);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">
                    <i class="fas fa-file" style="font-size:1.8rem;color:rgba(255,255,255,0.6);"></i>
                </div>
                <div style="text-align:center;">
                    <div style="color:rgba(255,255,255,0.5);font-size:0.85rem;margin-bottom:4px;">No preview available</div>
                    <div style="color:rgba(255,255,255,0.7);font-size:0.8rem;">${sizeStr} - ${ext}</div>
                </div>
            </div>`;
    }

    overlay.style.display = 'flex';
    const captionInput = document.getElementById('file-preview-caption');
    if (captionInput) {
        captionInput.value = '';
        captionInput.focus();
    }
}

// --- COPIAR/PEGAR (Ctrl+V) Y ARRASTRAR/SOLTAR (Drag & Drop) DE ARCHIVOS EN CHAT ---
let _chatDragCounter = 0;

document.addEventListener('paste', (e) => {
    if (!activeChatId) return;
    const input = document.getElementById('message-input');
    if (!input || input.disabled) return;

    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file && file.size > 0) {
            e.preventDefault();
            openFilePreview(file);
        }
    }
});

window.addEventListener('dragenter', (e) => {
    if (!activeChatId) return;
    const input = document.getElementById('message-input');
    if (!input || input.disabled) return;

    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        _chatDragCounter++;
        const overlay = document.getElementById('chat-drop-overlay');
        if (overlay) overlay.style.display = 'flex';
    }
});

window.addEventListener('dragover', (e) => {
    if (!activeChatId) return;
    const input = document.getElementById('message-input');
    if (!input || input.disabled) return;

    if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
    }
});

window.addEventListener('dragleave', (e) => {
    if (!activeChatId) return;
    _chatDragCounter = Math.max(0, _chatDragCounter - 1);
    if (_chatDragCounter === 0) {
        const overlay = document.getElementById('chat-drop-overlay');
        if (overlay) overlay.style.display = 'none';
    }
});

window.addEventListener('drop', (e) => {
    if (!activeChatId) return;
    _chatDragCounter = 0;
    const overlay = document.getElementById('chat-drop-overlay');
    if (overlay) overlay.style.display = 'none';

    const input = document.getElementById('message-input');
    if (!input || input.disabled) return;

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.size > 0) {
            openFilePreview(file);
        }
    }
});

function closeFilePreview() {
    const overlay = document.getElementById('file-preview-overlay');
    if (overlay) overlay.style.display = 'none';
    selectedFile = null;
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
}

async function sendFromPreview() {
    const caption = document.getElementById('file-preview-caption')?.value.trim() || '';
    const input = document.getElementById('message-input');
    if (input) input.value = caption;
    const overlay = document.getElementById('file-preview-overlay');
    if (overlay) overlay.style.display = 'none';
    await sendMessage();
}

window.toggleRecording = toggleRecording;
window.cancelRecording = cancelRecording;

async function toggleRecording() {
    if (_isRecording) {
        stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    if (!activeChatId) return;
    try {
        _isAudioCancelled = false;
        _audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _audioChunks = [];
        _mediaRecorder = new MediaRecorder(_audioStream);
        _mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) _audioChunks.push(e.data);
        };
        _mediaRecorder.onstop = async () => {
            if (_audioStream) {
                _audioStream.getTracks().forEach(t => t.stop());
                _audioStream = null;
            }
            if (_isAudioCancelled) {
                _isAudioCancelled = false;
                _audioChunks = [];
                _resetRecordingUI();
                return;
            }
            _resetRecordingUI();
            const mimeType = _mediaRecorder?.mimeType || 'audio/webm';
            const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
            const blob = new Blob(_audioChunks, { type: mimeType });
            _audioChunks = [];
            const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: mimeType });
            await sendAudioFile(file);
        };
        _mediaRecorder.start();
        _isRecording = true;

        const micBtn = document.getElementById('mic-btn');
        if (micBtn) {
            micBtn.classList.add('recording');
            micBtn.querySelector('i').className = 'fas fa-paper-plane';
            micBtn.title = 'Enviar audio grabado';
        }
        const cancelBtn = document.getElementById('mic-cancel-btn');
        if (cancelBtn) {
            cancelBtn.style.display = 'inline-flex';
        }
    } catch (err) {
        _resetRecordingUI();
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            window.swalAlert('Permiso denegado', 'Permiso de microfono denegado. Habilitalo en la configuracion del navegador.', 'error');
        } else {
            console.error('Error al iniciar grabacion:', err);
        }
    }
}

function stopRecording() {
    if (_mediaRecorder && _isRecording) {
        _isRecording = false;
        _mediaRecorder.stop();
    }
}

function cancelRecording() {
    if (_mediaRecorder && _isRecording) {
        _isAudioCancelled = true;
        _isRecording = false;
        _mediaRecorder.stop();
        _resetRecordingUI();
        if (typeof window.showToast === 'function') {
            window.showToast('Grabación de audio descartada');
        }
    }
}

function _resetRecordingUI() {
    _isRecording = false;
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) {
        micBtn.classList.remove('recording');
        micBtn.querySelector('i').className = 'fas fa-microphone';
        micBtn.title = 'Grabar audio';
    }
    const cancelBtn = document.getElementById('mic-cancel-btn');
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
}

async function sendAudioFile(file) {
    if (isSending) return;
    isSending = true;
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) micBtn.disabled = true;
    try {
        const token = localStorage.getItem('backoffice_token');
        const formData = new FormData();
        formData.append('chatId', activeChatId);
        formData.append('file', file);
        appendActiveChatScope(formData);
        if (replyTargetMessageId) formData.append('replyTo', replyTargetMessageId);
        const res = await fetch('/api/backoffice/send-message', {
            method: 'POST',
            headers: { 'Authorization': 'token=' + token },
            body: formData
        });
        if (res.ok) {
            const data = await res.json();
            if (data.warning) window.swalAlert('Advertencia', data.warning, 'warning');
        } else {
            let errorMsg = 'Error desconocido';
            const text = await res.text();
            try { errorMsg = JSON.parse(text).error || errorMsg; } catch (_) { errorMsg = text || errorMsg; }
            window.swalAlert('Error al enviar audio', errorMsg, 'error');
        }
    } catch (err) {
        console.error('Error al enviar audio:', err);
        window.swalAlert('Error de conexión', 'Error de conexion al enviar el audio', 'error');
    } finally {
        isSending = false;
        if (micBtn) micBtn.disabled = false;
        window.cancelReply();
    }
}

function _clearSendUI() {
    const input = document.getElementById('message-input');
    if (input) { window.resetChatTextarea(input); input.placeholder = 'Escribe un mensaje aquí'; }
    selectedFile = null;
    const fi = document.getElementById('file-input');
    if (fi) fi.value = '';
    const po = document.getElementById('file-preview-overlay');
    if (po) po.style.display = 'none';
    const mic = document.getElementById('mic-btn');
    if (mic) mic.style.display = '';
    updateInputState(false);
    const toggle = document.getElementById('bot-toggle');
    if (toggle) toggle.checked = false;
    window.cancelReply();
}

async function sendMessage() {
    if (isSending) return;
    isSending = true;

    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content && !selectedFile) { isSending = false; return; }
    if (!activeChatId) { isSending = false; return; }

    const token = localStorage.getItem('backoffice_token');
    const chatId = activeChatId;
    const replyTo = replyTargetMessageId;
    const replyPreview = buildReplyPreview(replyTargetMessage);

    if (selectedFile) {
        // Archivo: esperar respuesta (necesitamos la URL real para mostrar)
        const btn = document.getElementById('send-btn');
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '...';
        try {
            const formData = new FormData();
            formData.append('chatId', chatId);
            if (content) formData.append('message', content);
            formData.append('file', selectedFile);
            appendActiveChatScope(formData);
            if (replyTo) formData.append('replyTo', replyTo);
            const res = await fetch('/api/backoffice/send-message', {
                method: 'POST',
                headers: { 'Authorization': 'token=' + token },
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                if (data.warning) window.swalAlert('Advertencia', data.warning, 'warning');
            } else {
                const text = await res.text();
                let msg = 'Error desconocido';
                try { msg = JSON.parse(text).error || msg; } catch (_) { msg = text || msg; }
                window.swalAlert('Error al enviar', msg, 'error');
            }
        } catch (_) {
            window.swalAlert('Error de conexión', 'Error de conexión al enviar el archivo', 'error');
        } finally {
            isSending = false;
            btn.disabled = false;
            btn.innerHTML = origHtml;
            _clearSendUI();
        }
        return;
    }

    // Texto: UI optimista - mostrar inmediatamente con check simple
    const tempId = '_p_' + Date.now();
    allMessages.push({
        id: tempId, chat_id: chatId, role: 'assistant',
        content, type: 'text',
        reply_to: replyTo || null,
        replyPreview,
        rawPayload: replyTo ? { replyTo, replyPreview } : null,
        created_at: new Date().toISOString(),
        _pending: true
    });
    renderMessages();
    _clearSendUI();
    scrollToBottom();
    // POST en background
    try {
        const formData = new FormData();
        formData.append('chatId', chatId);
        formData.append('message', content);
        appendActiveChatScope(formData);
        if (replyTo) formData.append('replyTo', replyTo);

        const res = await fetch('/api/backoffice/send-message', {
            method: 'POST',
            headers: { 'Authorization': 'token=' + token },
            body: formData
        });
        if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.warning) window.swalAlert('Advertencia', data.warning, 'warning');
            const idx = allMessages.findIndex(m => m.id === tempId);
            if (idx !== -1 && data.messageId) {
                allMessages[idx].external_id = data.messageId;
            }
        } else {
            const idx = allMessages.findIndex(m => m.id === tempId);
            if (idx !== -1) { allMessages[idx]._failed = true; allMessages[idx]._pending = false; renderMessages(); }
        }
    } catch (_) {
        const idx = allMessages.findIndex(m => m.id === tempId);
        if (idx !== -1) { allMessages[idx]._failed = true; allMessages[idx]._pending = false; renderMessages(); }
    } finally {
        isSending = false;
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
            container.style.display = 'none';
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

                // Buscar estado actual en el ticket o en metadatos
                const meta = _boCrmData[activeTicketId] || {};
                let currentColumnId = lastTicket.estado || meta.columnId || 'UNASSIGNED';
                if (currentColumnId === 'Abierto') currentColumnId = 'UNASSIGNED';

                statusSelect.value = currentColumnId;
                if (statusSelect.selectedIndex === -1) {
                    const col = crmColumns.find(c => c.id === currentColumnId || c.title === currentColumnId);
                    if (col) statusSelect.value = col.id;
                }
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
    if (document.getElementById('crm-last-name-side')) document.getElementById('crm-last-name-side').value = chat.metadata?.apellido || '';
    document.getElementById('crm-email').value = chat.email || '';
    document.getElementById('crm-source').value = chat.source || '';
    document.getElementById('crm-notes').value = chat.notes || '';
    document.getElementById('crm-cuit').value = chat.cuit_dni || '';
    if (document.getElementById('crm-company-side')) document.getElementById('crm-company-side').value = chat.metadata?.empresa || '';
    document.getElementById('crm-address').value = chat.address || '';
    if (document.getElementById('crm-city-side')) document.getElementById('crm-city-side').value = chat.metadata?.localidad || '';
    if (document.getElementById('crm-province-side')) document.getElementById('crm-province-side').value = chat.metadata?.provincia || '';
    if (document.getElementById('crm-transport-side')) document.getElementById('crm-transport-side').value = chat.metadata?.transporte || '';
    document.getElementById('crm-tax-status').value = chat.tax_status || 'Cons. Final';
    document.getElementById('crm-product').value = chat.offered_product || '';
    if (document.getElementById('crm-shared-notes-side')) document.getElementById('crm-shared-notes-side').value = chat.metadata?.shared_notes || '';
    _csdSync('crm-source');
    _csdSync('crm-tax-status');

    // Cargar notas de empresa compartidas si existen
    checkAndFetchSharedNotesSide(chat);

    // Nuevos campos sincronizados con CRM
    const ticketTitleEl = document.getElementById('crm-ticket-title');
    if (ticketTitleEl && !activeTicketId) ticketTitleEl.value = '';

    const phoneEl = document.getElementById('crm-phone-side');
    if (phoneEl) phoneEl.value = chat.id ? chat.id.split('@')[0] : '';

    const priorityEl = document.getElementById('crm-priority');
    if (priorityEl) { priorityEl.value = chat.priority || 'Baja'; _csdSync('crm-priority'); }

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
            _csdRebuild('crm-status-select-side');
        }

        const currentVal = chat.crm_status || 'UNASSIGNED';
        statusEl.value = currentVal;

        if (statusEl.selectedIndex === -1) {
            const col = crmColumns.find(c => c.id === currentVal || c.title === currentVal);
            if (col) statusEl.value = col.id;
            else statusEl.value = currentVal;
        }

        _csdSync('crm-status-select-side');
        console.log(`[CRM] Poblando estado: ${currentVal} -> Asignado: ${statusEl.value}`);
    }

    const dueDateEl = document.getElementById('crm-due-date');
    if (dueDateEl) dueDateEl.value = chat.crm_due_date ? chat.crm_due_date.split('T')[0] : '';

    // Aplicar configuración de vista
    if (typeof window.applyCRMConfig === 'function') window.applyCRMConfig();
}

async function checkAndFetchSharedNotesSide(chat) {
    const cuitInput = document.getElementById('crm-cuit');
    const empresaInput = document.getElementById('crm-company-side');
    const notesTextarea = document.getElementById('crm-shared-notes-side');
    const indicator = document.getElementById('crm-shared-notes-side-indicator');
    const hint = document.getElementById('crm-shared-notes-side-hint');

    if (!notesTextarea) return;

    const cuit = (cuitInput?.value || chat?.cuit_dni || '').trim();
    const empresa = (empresaInput?.value || chat?.metadata?.empresa || '').trim();

    // Solo habilitar si hay Empresa o CUIT asignado
    if (!cuit && !empresa) {
        notesTextarea.disabled = true;
        notesTextarea.style.opacity = '0.6';
        notesTextarea.style.cursor = 'not-allowed';
        notesTextarea.placeholder = 'Asigne Empresa o CUIT arriba para habilitar y sincronizar Notas 2...';
        if (indicator) {
            indicator.textContent = '🔒 Requiere CUIT o Empresa';
            indicator.style.color = '#f59e0b';
        }
        if (hint) hint.style.display = 'block';
        return;
    }

    // Habilitar edición
    notesTextarea.disabled = false;
    notesTextarea.style.opacity = '1';
    notesTextarea.style.cursor = 'text';
    notesTextarea.placeholder = 'Notas corporativas compartidas entre CRMs del mismo cliente/empresa...';
    if (hint) hint.style.display = 'none';

    if (indicator) {
        indicator.textContent = '⏳ Buscando notas...';
        indicator.style.color = '#38bdf8';
    }

    try {
        const res = await fetch(`/api/backoffice/company-notes?token=${token}&cuit=${encodeURIComponent(cuit)}&empresa=${encodeURIComponent(empresa)}`);
        const data = await res.json();
        if (data.success && data.notes) {
            if (!notesTextarea.value.trim()) {
                notesTextarea.value = data.notes;
            }
            if (indicator) {
                indicator.textContent = '✅ Sincronizado';
                indicator.style.color = '#10b981';
            }
        } else {
            if (indicator) {
                indicator.textContent = '⚡ Habilitado (Sin notas previas)';
                indicator.style.color = '#38bdf8';
            }
        }
    } catch (err) {
        console.error('[CRM Side] Error fetching shared notes:', err);
        if (indicator) {
            indicator.textContent = '⚡ Habilitado para editar';
            indicator.style.color = '#38bdf8';
        }
    }
}

function openWhatsAppDirectSide() {
    const phone = document.getElementById('crm-phone-side').value;
    if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, '')}`, '_blank');
}

async function saveCRMDetails() {
    if (!activeChatId) return;

    const phoneInputVal = document.getElementById('crm-phone-side')?.value || '';

    const details = {
        name: document.getElementById('crm-name').value,
        apellido: document.getElementById('crm-last-name-side')?.value || '',
        phone: phoneInputVal,
        email: document.getElementById('crm-email').value,
        source: document.getElementById('crm-source').value,
        notes: document.getElementById('crm-notes').value,
        cuit_dni: document.getElementById('crm-cuit').value,
        empresa: document.getElementById('crm-company-side')?.value || '',
        address: document.getElementById('crm-address').value,
        localidad: document.getElementById('crm-city-side')?.value || '',
        provincia: document.getElementById('crm-province-side')?.value || '',
        transporte: document.getElementById('crm-transport-side')?.value || '',
        tax_status: document.getElementById('crm-tax-status').value,
        offered_product: document.getElementById('crm-product').value,
        shared_notes: document.getElementById('crm-shared-notes-side')?.value || '',
        ticket_title: document.getElementById('crm-ticket-title')?.value || '',
        priority: document.getElementById('crm-priority')?.value || 'Baja',
        crm_status: document.getElementById('crm-status-select-side')?.value || 'UNASSIGNED',
        crm_due_date: document.getElementById('crm-due-date')?.value || null
    };

    try {
        showToast('💾 Guardando cambios...');
        let updatedNewPhone = null;

        // 1. Si hay un ticket activo, actualizar Ticket y Metadatos
        if (activeTicketId) {
            const ticketData = {
                titulo: details.ticket_title,
                notas: details.notes,
                priority: details.priority,
                vencimiento: details.crm_due_date,
                contact: details
            };

            const res = await fetch(`/api/backoffice/crm/ticket/${activeTicketId}?token=${token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ticketData)
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || `Error ${res.status} al guardar ticket`);
            }
            const resJson = await res.json();
            if (resJson.success === false) {
                throw new Error(resJson.error || 'Error al guardar detalles de ticket');
            }

            if (resJson.newPhone) updatedNewPhone = resJson.newPhone;

            // Sincronizar Metadatos (Columna)
            const col = crmColumns.find(c => c.id === details.crm_status || c.title === details.crm_status);
            if (col) {
                if (!_boCrmData[activeTicketId]) _boCrmData[activeTicketId] = {};
                _boCrmData[activeTicketId].columnId = col.id;
                _boCrmData[activeTicketId].priority = details.priority;
                _boCrmData[activeTicketId].alertDate = details.crm_due_date;

                const resSet = await fetch(`/api/backoffice/save-setting?token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'CRM_METADATA', value: JSON.stringify(_boCrmData) })
                });
                if (!resSet.ok) console.warn('No se pudo guardar la configuración CRM_METADATA');
            }
        } else {
            // Si no hay ticket, solo actualizar contacto
            const res = await fetch(`/api/backoffice/chat/${activeChatId}/contact?token=${token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(details)
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || `Error ${res.status} al guardar contacto`);
            }
            const resJson = await res.json();
            if (resJson.success === false) {
                throw new Error(resJson.error || 'Error al guardar contacto');
            }
            if (resJson.newPhone) updatedNewPhone = resJson.newPhone;
        }

        if (updatedNewPhone && updatedNewPhone !== activeChatId) {
            console.log(`[saveCRMDetails] Teléfono de chat modificado de ${activeChatId} -> ${updatedNewPhone}`);
            activeChatId = updatedNewPhone;
            await fetchChats(true);
            selectChat(activeChatId);
        } else {
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) {
                Object.assign(chat, details);
                chat.metadata = {
                    ...(chat.metadata || {}),
                    apellido: details.apellido,
                    empresa: details.empresa,
                    localidad: details.localidad,
                    provincia: details.provincia,
                    transporte: details.transporte,
                    shared_notes: details.shared_notes
                };
                const updatedName = (chat.name && chat.name !== '[-]') ? chat.name : 'Lead sin nombre';
                document.getElementById('active-chat-name').innerText = updatedName;
                renderChatList();
            }
        }

        showToast('✅ Cambios guardados y sincronizados');
    } catch (e) {
        console.error('[saveCRMDetails] Error:', e);
        showToast('Error al guardar: ' + e.message, 'error');
    }
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
    if (!await window.swalConfirm('¿Eliminar etiqueta?', '¿Eliminar esta etiqueta?')) return;
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
        const tag = _boBotTags.find(t => t.id === tagId);
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
        <div style="max-height: 280px; overflow-y: auto; overflow-x: hidden; margin-top: 10px;">
            ${_boBotTags.map(t => `
                <div class="tag-item-edit">
                    <span class="tag-pill" style="${_tagStyle(t.color)}">${t.name}</span>
                    <button class="btn-icon" onclick="deleteTag('${t.id}')" style="color:#f87171;"><i class="fas fa-trash-alt"></i></button>
                </div>
            `).join('')}
        </div>
    `;

    const chat = chats.find(c => c.id === activeChatId);
    if (chat) {
        const assignedTagIds = (chat.tags || []).map(t => t.id);
        const assignList = document.getElementById('available-tags-to-assign');
        assignList.innerHTML = _boBotTags.map(t => {
            const isAssigned = assignedTagIds.includes(t.id);
            return `
                <div onclick="${isAssigned ? 'removeTagFromChat' : 'addTagToChat'}('${t.id}')"
                     class="tag-pill"
                     data-tag-color="${t.color || '#6366f1'}" style="cursor:pointer; ${_tagStyle(t.color)}${isAssigned ? ' transform:scale(1.04);' : ' opacity:0.55;'}">
                    ${t.name} ${isAssigned ? '✓' : '+'}
                </div>
            `;
        }).join('');
    }
}

function logout() {
    localStorage.removeItem('backoffice_token');
    localStorage.removeItem('system_config_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_id');
    localStorage.removeItem('user_name');
    window.location.href = '/login';
}

setInterval(() => fetchChats(true), 60000);
socket.on('ticket_updated', (payload) => {
    console.log('📡 Ticket actualizado:', payload);
    fetchPendingTicketsCount();
    const _tp = document.getElementById('tickets-panel');
    if (_tp && _tp.classList.contains('active')) {
        fetchTickets();
    }
    // Si el ticket pertenece al chat activo, recargar el Salto al CRM para actualizar prioridad, título, etc.
    if (activeChatId && payload.chat_id && normChatId(payload.chat_id) === normChatId(activeChatId)) {
        loadCRMJump(activeChatId);
    }
});
socket.on('contact_updated', (payload) => {
    console.log('📡 Contacto actualizado:', payload);
    const chatId = payload.chatId;
    const details = payload.details || {};

    // Buscar y actualizar el chat local en el array de chats
    const chatIndex = chats.findIndex(c => normChatId(c.id) === normChatId(chatId));
    if (chatIndex !== -1) {
        // Combinar datos nuevos
        chats[chatIndex] = { ...chats[chatIndex], ...details };

        // Si es el chat activo, actualizar la vista
        if (normChatId(chatId) === normChatId(activeChatId)) {
            populateCRMFields(chats[chatIndex]);
        }

        // Re-renderizar lista de chats
        renderChatList();
    }
});
socket.on('user_updated', (payload) => {
    console.log('📡 Usuario actualizado en tiempo real:', payload);
    if (typeof window.loadGlobalTeam === 'function') {
        window.loadGlobalTeam();
    }
});

// --- TICKETS LOGIC ---

let currentTicketsFilter = 'pending';

async function fetchPendingTicketsCount() {
    try {
        const res = await fetch(`/api/backoffice/tickets/pending-count?token=${token}&tipo=Soporte`);
        const { count } = await res.json();

        const badge = document.getElementById('tickets-badge');
        if (!badge) return;
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
        const res = await fetch(`/api/backoffice/tickets?token=${token}${estadoParam}`);
        const tickets = await res.json();

        if (!Array.isArray(tickets) || tickets.length === 0) {
            list.innerHTML = `<div style="text-align:center; padding:20px; opacity:0.5;">No hay tickets ${currentTicketsFilter === 'pending' ? 'pendientes' : 'cerrados'}</div>`;
            return;
        }

        list.innerHTML = tickets.map(t => {
            const date = new Date(t.created_at).toLocaleDateString('es-AR');
            const contactName = t.chats?.name || (t.chat_id ? t.chat_id.split('@')[0] : '—');
            const attachments = t.attachments ? (typeof t.attachments === 'string' ? JSON.parse(t.attachments) : t.attachments) : [];
            const chatsAdj = t.chats_adjuntos ? (typeof t.chats_adjuntos === 'string' ? JSON.parse(t.chats_adjuntos) : t.chats_adjuntos) : [];

            const attachHtml = attachments.length ? `
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                    ${attachments.map(url => `<a href="${url}" target="_blank" style="display:block; width:56px; height:56px; border-radius:6px; overflow:hidden; border:1px solid var(--border);">
                        <img src="${url}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-file\\' style=\\'color:var(--text-muted); font-size:1.2rem; width:100%; height:100%; display:flex; align-items:center; justify-content:center;\\'></i>'">
                    </a>`).join('')}
                </div>` : '';

            const chatsAdjHtml = chatsAdj.length ? `
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:6px;">
                    ${chatsAdj.map(c => `<span onclick="goToTicketChat('${c.chat_id}')" style="display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:99px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); font-size:0.75rem; color:#0099FF; cursor:pointer;">
                        <i class="fas fa-comment" style="font-size:0.7rem;"></i>${c.name}
                    </span>`).join('')}
                </div>` : '';

            return `
                <div class="ticket-item">
                    <div>
                        <div class="ticket-header">
                            <div class="ticket-title">${t.titulo}</div>
                        </div>
                        ${t.descripcion ? `<div style="font-size:0.82rem; color:var(--text-muted); margin:4px 0 6px; line-height:1.5;">${t.descripcion}</div>` : ''}
                        <div class="ticket-meta" style="margin-bottom:2px;">
                            <span><i class="far fa-calendar-alt"></i> ${date}</span>
                            <span onclick="${t.chat_id ? `goToTicketChat('${t.chat_id}')` : ''}" style="${t.chat_id ? 'cursor:pointer; color:#0099FF;' : ''}"><i class="fas fa-user"></i> ${contactName}</span>
                        </div>
                        ${chatsAdjHtml}
                        ${attachHtml}
                    </div>
                    <div class="ticket-status-row">
                        <span style="font-size:0.75rem; color:var(--text-muted);">Estado:</span>
                        <div class="csd-wrap csd-sm" style="width:auto; min-width:120px;">
                            <select class="status-select" hidden onchange="updateTicketStatus('${t.id}', this.value)">
                                <option value="Abierto" ${t.estado === 'Abierto' ? 'selected' : ''}>Abierto</option>
                                <option value="En progreso" ${t.estado === 'En progreso' ? 'selected' : ''}>En progreso</option>
                                <option value="Cerrado" ${t.estado === 'Cerrado' ? 'selected' : ''}>Cerrado</option>
                            </select>
                            <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label">${t.estado}</span>
                                <i class="fas fa-chevron-down csd-chevron"></i>
                            </button>
                            <div class="csd-menu">
                                <button class="csd-item ${t.estado === 'Abierto' ? 'selected' : ''}" type="button" data-val="Abierto" onclick="_csdSelect(this,'Abierto')">Abierto</button>
                                <button class="csd-item ${t.estado === 'En progreso' ? 'selected' : ''}" type="button" data-val="En progreso" onclick="_csdSelect(this,'En progreso')">En progreso</button>
                                <button class="csd-item ${t.estado === 'Cerrado' ? 'selected' : ''}" type="button" data-val="Cerrado" onclick="_csdSelect(this,'Cerrado')">Cerrado</button>
                            </div>
                        </div>
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

let _ticketSelectedChats = [];
let _ticketFiles = [];

function openTicketModal() {
    _ticketSelectedChats = [];
    _ticketFiles = [];
    document.getElementById('ticket-modal').classList.add('active');
    document.getElementById('ticket-title').focus();
    document.getElementById('ticket-chat-chips').innerHTML = '';
    document.getElementById('ticket-file-preview').innerHTML = '';
    document.getElementById('ticket-chat-search').value = '';
    document.getElementById('ticket-files').value = '';
}

function closeTicketModal() {
    document.getElementById('ticket-modal').classList.remove('active');
    document.getElementById('ticket-chat-suggestions').style.display = 'none';
}

function _ticketChatSearch(query) {
    const box = document.getElementById('ticket-chat-suggestions');
    if (!query.trim()) { box.style.display = 'none'; return; }
    const q = query.toLowerCase();
    const matches = chats.filter(c => {
        const name = (c.name || c.id || '').toLowerCase();
        const num = (c.id || '').toLowerCase();
        return (name.includes(q) || num.includes(q)) && !_ticketSelectedChats.find(s => s.chat_id === c.id);
    }).slice(0, 8);
    if (!matches.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = matches.map(c => {
        const label = c.name || c.id.split('@')[0];
        return `<div onclick="_ticketAddChat('${c.id}', '${label.replace(/'/g, "\\'")}'); document.getElementById('ticket-chat-search').value=''; document.getElementById('ticket-chat-suggestions').style.display='none';"
                     style="padding:10px 14px; cursor:pointer; font-size:0.85rem; color:var(--text-main); transition:background 0.15s;"
                     onmouseover="this.style.background='rgba(0,153,255,0.1)'" onmouseout="this.style.background=''">
                <i class="fas fa-comment" style="color:#0099FF; margin-right:8px;"></i>${label}
                <span style="color:var(--text-muted); font-size:0.78rem; margin-left:6px;">${c.id.split('@')[0]}</span>
            </div>`;
    }).join('');
}

function _ticketAddChat(chatId, name) {
    if (_ticketSelectedChats.find(s => s.chat_id === chatId)) return;
    _ticketSelectedChats.push({ chat_id: chatId, name });
    _renderTicketChips();
}

function _ticketRemoveChat(chatId) {
    _ticketSelectedChats = _ticketSelectedChats.filter(s => s.chat_id !== chatId);
    _renderTicketChips();
}

function _renderTicketChips() {
    const box = document.getElementById('ticket-chat-chips');
    box.innerHTML = _ticketSelectedChats.map(s =>
        `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:99px; background:rgba(0,153,255,0.12); border:1px solid rgba(0,153,255,0.25); font-size:0.8rem; color:var(--text-main);">
            <i class="fas fa-comment" style="color:#0099FF; font-size:0.75rem;"></i>
            ${s.name}
            <button onclick="_ticketRemoveChat('${s.chat_id}')" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:0; line-height:1; font-size:0.85rem;">&times;</button>
        </span>`
    ).join('');
}

function _ticketFilesSelected(fileList) {
    _ticketFiles = Array.from(fileList);
    const preview = document.getElementById('ticket-file-preview');
    preview.innerHTML = _ticketFiles.map((f, i) => {
        const isImg = f.type.startsWith('image/');
        const icon = isImg ? '' : '<i class="fas fa-file-pdf" style="font-size:1.5rem; color:#ef4444;"></i>';
        return `<div style="position:relative; width:72px; height:72px; border-radius:8px; overflow:hidden; border:1px solid var(--border); background:var(--bg-card); display:flex; align-items:center; justify-content:center;" id="ticket-fp-${i}">
            ${isImg ? `<img src="${URL.createObjectURL(f)}" style="width:100%; height:100%; object-fit:cover;">` : icon}
            <button onclick="_ticketRemoveFile(${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); border:none; border-radius:50%; width:18px; height:18px; cursor:pointer; color:white; font-size:10px; display:flex; align-items:center; justify-content:center;">&times;</button>
        </div>`;
    }).join('');
}

function _ticketRemoveFile(index) {
    _ticketFiles.splice(index, 1);
    _ticketFilesSelected(_ticketFiles);
}

async function createTicket() {
    const titulo = document.getElementById('ticket-title').value.trim();
    const descripcion = document.getElementById('ticket-desc').value.trim();

    if (!titulo) {
        showToast('El asunto es obligatorio', 'error');
        return;
    }

    const fd = new FormData();
    fd.append('chatId', activeChatId || '');
    fd.append('titulo', titulo);
    fd.append('descripcion', descripcion);
    fd.append('chats_adjuntos', JSON.stringify(_ticketSelectedChats));
    for (const file of _ticketFiles) fd.append('attachments', file);

    try {
        const res = await fetch(`/api/backoffice/tickets?token=${token}`, { method: 'POST', body: fd });
        if (res.ok) {
            showToast('Ticket enviado correctamente');
            closeTicketModal();
            fetchPendingTicketsCount();
            document.getElementById('ticket-title').value = '';
            document.getElementById('ticket-desc').value = '';
        } else {
            showToast('Error al enviar ticket', 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error de conexión', 'error');
    }
}

// --- LEADS LOGIC ---

async function fetchLeads() {
    const list = document.getElementById('leads-list');
    list.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.5;">Cargando leads editados...</div>';

    try {
        const serviceParam = window.railwayServiceId ? `&serviceId=${encodeURIComponent(window.railwayServiceId)}` : '';
        const projectParam = window.railwayProjectId ? `&projectId=${encodeURIComponent(window.railwayProjectId)}` : '';
        const res = await fetch(`/api/backoffice/leads?token=${token}${serviceParam}${projectParam}`);
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
            setTimeout(() => { if (!metaPanel.classList.contains('active')) metaPanel.style.visibility = 'hidden'; }, 400);
        }

        console.log(`📊 [PANEL] Meta Panel Status: ${isOpen ? 'OPEN' : 'CLOSED'}`);
    } else {
        console.error('❌ [PANEL] Error: #meta-panel not found in DOM');
        if (typeof showToast === 'function') showToast('❌ Error: No se encontró el componente de Meta', 'error');
    }
}
// No sobreescribir window.toggleMetaPanel - crm-common.js lo maneja
window.realToggleMeta = toggleMetaPanel;

function launchMetaOnboarding() {
    const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
    const sId = (typeof window !== 'undefined' && window.railwayServiceId) ? window.railwayServiceId : '';
    const pId = (typeof window !== 'undefined' && window.railwayProjectId) ? window.railwayProjectId : '';
    fetch(`/api/backoffice/whatsapp/config?token=${activeToken}&serviceId=${sId}&projectId=${pId}`)
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
            url.searchParams.append('redirectUri', `${currentOrigin}/api/backoffice/whatsapp/onboard-callback?serviceId=${sId}`);
            url.searchParams.append('state', `${data.railwayProjectId}:${sId}`);
            url.searchParams.append('serviceId', sId);
            url.searchParams.append('railwayServiceId', sId);

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

    if (!await window.swalConfirm('¿Cerrar ticket?', '¿Desea cerrar el ticket actual?')) return;

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

    if (!await window.swalConfirm('¿Eliminar ticket?', '⚠️ ¿Está seguro de ELIMINAR este ticket? esta acción no se puede deshacer.')) return;

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
    const toggle = document.getElementById('bot-toggle');
    if (toggle) toggleBot(toggle.checked);
}

// Inicialización principal - los datos los carga initBackofficeView (primera y posteriores visitas)
setInterval(fetchPendingTicketsCount, 30000);

// Manejo de URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('openPanel') === 'meta') {
    console.log('🚀 [BACKOFFICE] Abriendo panel Meta por URL param');
    setTimeout(() => {
        if (typeof window.realToggleMeta === 'function') window.realToggleMeta();
    }, 500);
}

// Listeners para Infinite Scroll - con null check para no crashear si el script carga fuera del view
const _chatListEl = document.getElementById('chat-list');
if (_chatListEl) _chatListEl.addEventListener('scroll', function () {
    if (this.clientHeight > 0) {
        _backofficeChatListScrollTop = this.scrollTop;
    }
    const { scrollTop, scrollHeight, clientHeight } = this;
    if (scrollTop + clientHeight >= scrollHeight - 20) {
        if (!loadingChats && !allChatsLoaded) fetchChats();
    }
}, { passive: true });

const _messagesEl = document.getElementById('messages');
if (_messagesEl) _messagesEl.addEventListener('scroll', function () {
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
        const sId = (typeof window !== 'undefined' && window.railwayServiceId) ? window.railwayServiceId : '';
        const pId = (typeof window !== 'undefined' && window.railwayProjectId) ? window.railwayProjectId : '';
        const res = await fetch(`/api/backoffice/whatsapp/config?token=${token}&serviceId=${sId}&projectId=${pId}`);
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
                        <button class="btn-primary w-full" onclick="navigate('/meta');" style="margin-top: 20px;">
                            <i class="fas fa-layer-group"></i> Abrir Envío Masivo
                        </button>
                        <button class="btn-secondary w-full" onclick="launchMetaOnboarding()" style="margin-top:10px;">
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
                        <button class="btn-primary w-full" onclick="launchMetaOnboarding()" style="margin-top: 20px;">
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

function toggleBulkModal() {
    const metaPanel = document.getElementById('meta-panel');
    if (metaPanel && metaPanel.classList.contains('active')) {
        toggleMetaPanel();
    }
    if (typeof navigate === 'function') navigate('/meta');
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
        const params = new URLSearchParams({ token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
        const res = await fetch(`/api/backoffice/whatsapp/templates?${params.toString()}`);
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
            showToast("Completa el ejemplo para la variable {{${varName}}}", 'error');
            return;
        }
        examples.push(value);
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

    try {
        const params = new URLSearchParams({ token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
        const res = await fetch(`/api/backoffice/whatsapp/templates?${params.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                category,
                language,
                text,
                examples,
                projectId: window.railwayProjectId || '',
                serviceId: window.railwayServiceId || ''
            })
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
    if (window.railwayProjectId) formData.append('projectId', window.railwayProjectId);
    if (window.railwayServiceId) formData.append('serviceId', window.railwayServiceId);

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
    progressDiv.style.display = 'block';
    progressBar.style.width = '0%';
    statusText.innerText = 'Subiendo y procesando...';

    try {
        const params = new URLSearchParams({ token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
        const res = await fetch(`/api/backoffice/whatsapp/send-bulk-template?${params.toString()}`, {
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
});

// --- Exportaciones Finales ---
// NO sobreescribir toggleLeadsPanel/toggleTicketsPanel/toggleMetaPanel:
// crm-common.js los maneja con routing SPA. Solo exponer las funciones reales.
window.realToggleMeta = toggleMetaPanel;
window.checkMetaStatus = checkMetaStatus;
window.toggleBulkModal = toggleBulkModal;
window.downloadBulkExcel = () => {
    if (currentSelectedTemplate) {
        const params = new URLSearchParams({ token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);

        const start = document.getElementById('bulk-filter-start')?.value;
        const end = document.getElementById('bulk-filter-end')?.value;
        const select = document.getElementById('bulk-filter-tags');

        let tags = '';
        if (select && select.selectedOptions) {
            tags = Array.from(select.selectedOptions).map(o => o.value).join(',');
        }

        if (start) params.set('startDate', start);
        if (end) params.set('endDate', end);
        if (tags) params.set('tagIds', tags);

        const url = `/api/backoffice/whatsapp/template-excel/${encodeURIComponent(currentSelectedTemplate.name)}?${params.toString()}`;
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
async function confirmClearContacts() {
    const result = await Swal.fire({
        title: '¿Vaciar contactos?',
        text: 'Estás a punto de eliminar todos los contactos y chats. Esta acción no se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar',
        scrollbarPadding: false,
        heightAuto: false
    });

    if (result.isConfirmed) {
        Swal.fire({
            title: 'Vaciando...',
            text: 'Eliminando contactos y chats, por favor espera.',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            },
            scrollbarPadding: false,
            heightAuto: false
        });

        try {
            const serviceParam = window.railwayServiceId ? `&serviceId=${encodeURIComponent(window.railwayServiceId)}` : '';
            const projectParam = window.railwayProjectId ? `&projectId=${encodeURIComponent(window.railwayProjectId)}` : '';
            const res = await fetch(`/api/backoffice/chats/vaciar?token=${token}${serviceParam}${projectParam}`, { method: 'DELETE' });
            const data = await res.json();

            if (data.success) {
                await Swal.fire({
                    title: '¡Vaciado Completo!',
                    text: 'Se han eliminado todos los chats y contactos.',
                    icon: 'success',
                    scrollbarPadding: false,
                    heightAuto: false
                });
                window.location.reload();
            } else {
                Swal.fire({
                    title: 'Error',
                    text: data.error || 'Ocurrió un error al vaciar los contactos.',
                    icon: 'error',
                    scrollbarPadding: false,
                    heightAuto: false
                });
            }
        } catch (e) {
            Swal.fire({
                title: 'Error',
                text: 'Hubo un problema de conexión.',
                icon: 'error',
                scrollbarPadding: false,
                heightAuto: false
            });
        }
    }
}
window.confirmClearContacts = confirmClearContacts;

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
            const { contacts, labels, associations, meta_sync_triggered, history_skipped } = data.summary;
            if (meta_sync_triggered) {
                summaryText.innerHTML = `
                    <div style="color: #059669; margin-bottom: 10px;"><i class="fab fa-whatsapp"></i> <b>Sincronización Oficial Meta Solicitada</b></div>
                    La petición ha sido enviada a los servidores de Meta.<br/>
                    Los contactos se cargarán en segundo plano.${history_skipped ? '<br/>El historial anterior ya no está disponible por ventana de Meta.' : '<br/>El historial se cargará en segundo plano.'}
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
        const syncError = String(e.message || '').includes('outside of allowed time window')
            ? 'Meta ya no permite importar historial. Los chats entran al escribir.'
            : e.message;
        showToast('Error: ' + syncError, 'error');
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
    window.open(`/api/backoffice/chats/import-template?token=${encodeURIComponent(token)}`, '_blank');
}

async function startImportExcel() {
    const fileInput = document.getElementById('import-file-input');
    const btn = document.getElementById('btn-execute-import');
    const progressDiv = document.getElementById('import-progress');
    const progressBar = document.getElementById('import-progress-bar');
    const statusText = document.getElementById('import-status-text');

    if (!fileInput.files || fileInput.files.length === 0) {
        window.swalAlert('Atención', 'Por favor selecciona un archivo Excel.', 'warning');
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
                window.swalAlert('¡Importación Exitosa!', `Importación finalizada: ${data.imported} contactos procesados.`, 'success');
                toggleImportModal();
            }, 1500);
        } else {
            throw new Error(data.error || 'Error en el proceso de importación');
        }
    } catch (e) {
        console.error('[Import] Error:', e);
        statusText.innerText = '❌ Error: ' + e.message;
        statusText.style.color = '#f87171';
        window.swalAlert('Error al importar', e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

window.toggleImportModal = toggleImportModal;
window.downloadImportTemplate = downloadImportTemplate;
window.startImportExcel = startImportExcel;

// --- Modal Agregar Contacto Individual ---
async function openIndividualContactModal() {
    const importModal = document.getElementById('import-modal');
    if (importModal) importModal.style.display = 'none';

    const indModal = document.getElementById('individual-contact-modal');
    if (!indModal) return;

    indModal.style.display = 'flex';
    document.getElementById('ind-phone-input').value = '';
    document.getElementById('ind-name-input').value = '';
    const previewEl = document.getElementById('ind-phone-preview');
    if (previewEl) previewEl.style.display = 'none';

    if (!Array.isArray(_boBotTags) || _boBotTags.length === 0) {
        await fetchBotTags();
    }

    // Poblar etiquetas existentes
    const tagsContainer = document.getElementById('ind-tags-container');
    if (tagsContainer) {
        if (!Array.isArray(_boBotTags) || _boBotTags.length === 0) {
            tagsContainer.innerHTML = '<span style="font-size:0.75rem; color:var(--text-muted);">No hay etiquetas registradas.</span>';
        } else {
            tagsContainer.innerHTML = _boBotTags.map(tag => {
                const color = tag.color || '#6366f1';
                return `
                    <label style="display:inline-flex; align-items:center; gap:5px; background:${color}20; border:1px solid ${color}40; color:${color}; padding:3px 8px; border-radius:14px; font-size:0.75rem; cursor:pointer; font-weight:600;">
                        <input type="checkbox" class="ind-tag-checkbox" value="${tag.id}" style="accent-color:${color}; cursor:pointer;" />
                        ${tag.name}
                    </label>
                `;
            }).join('');
        }
    }
}

function closeIndividualContactModal() {
    const indModal = document.getElementById('individual-contact-modal');
    if (indModal) indModal.style.display = 'none';
}

function normalizePhoneNumberClient(rawPhone) {
    let phone = String(rawPhone || '').replace(/\D/g, '').trim();
    if (!phone) return '';
    if (phone.startsWith('0')) {
        phone = phone.slice(1);
    }
    if (phone.length === 10) {
        phone = `549${phone}`;
    } else if (phone.length === 11 && phone.startsWith('9')) {
        phone = `54${phone}`;
    } else if (phone.length === 12 && phone.startsWith('54') && !phone.startsWith('549')) {
        phone = `549${phone.slice(2)}`;
    }
    return phone;
}

function previewNormalizedPhone(val) {
    const previewEl = document.getElementById('ind-phone-preview');
    if (!previewEl) return;
    const normalized = normalizePhoneNumberClient(val);
    if (normalized) {
        previewEl.style.display = 'block';
        previewEl.innerHTML = `<i class="fas fa-check-circle mr-1"></i> Formato Normalizado: <strong>${normalized}</strong>`;
    } else {
        previewEl.style.display = 'none';
    }
}

async function saveIndividualContact() {
    const phoneVal = document.getElementById('ind-phone-input')?.value;
    const nameVal = document.getElementById('ind-name-input')?.value;
    const btn = document.getElementById('btn-save-ind-contact');

    const normalized = normalizePhoneNumberClient(phoneVal);
    if (!normalized || normalized.length < 8) {
        window.swalAlert('Atención', 'Por favor ingresa un número de teléfono válido.', 'warning');
        return;
    }

    const tagCheckboxes = document.querySelectorAll('.ind-tag-checkbox:checked');
    const selectedTagIds = Array.from(tagCheckboxes).map((cb) => cb.value);

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Guardando...';
    }

    try {
        const activeChat = chats.find(c => c.id === activeChatId);
        const pId = activeChat?.project_id || '';

        const res = await fetch(`/api/backoffice/chats/create-individual?token=${token}&projectId=${pId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rawPhone: phoneVal,
                name: nameVal,
                tagIds: selectedTagIds,
                projectId: pId
            })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Error al guardar el contacto');
        }

        window.swalAlert('¡Contacto Creado!', `Contacto ${data.normalizedPhone} registrado exitosamente.`, 'success');
        closeIndividualContactModal();

        // Refrescar chats
        await fetchChats(true);
        await fetchBotTags();

        // Seleccionar automáticamente el chat creado
        if (data.normalizedPhone) {
            window.selectChat(data.normalizedPhone);
        }
    } catch (err) {
        console.error('[saveIndividualContact] Error:', err);
        window.swalAlert('Error', err.message || 'No se pudo guardar el contacto', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save mr-1"></i> Guardar Contacto';
        }
    }
}

window.openIndividualContactModal = openIndividualContactModal;
window.closeIndividualContactModal = closeIndividualContactModal;
window.normalizePhoneNumberClient = normalizePhoneNumberClient;
window.previewNormalizedPhone = previewNormalizedPhone;
window.saveIndividualContact = saveIndividualContact;

// --- Eliminar Chat Activo ---
async function deleteActiveChat() {
    if (!activeChatId) {
        window.swalAlert('Atención', 'No hay ningún chat seleccionado.', 'warning');
        return;
    }

    const activeChat = chats.find(c => c.id === activeChatId);
    const displayName = activeChat?.name || activeChatId;
    const pId = activeChat?.project_id || '';

    const confirm = await window.swalConfirm(
        '¿Eliminar conversación?',
        `¿Estás seguro de que deseas eliminar permanentemente el chat con "${displayName}" (${activeChatId})?\n\nEsta acción borrará el historial de este contacto únicamente para este proyecto.`,
        'warning'
    );

    if (!confirm) return;

    const btn = document.getElementById('delete-chat-btn');
    if (btn) btn.disabled = true;

    try {
        const res = await fetch(`/api/backoffice/chats/${encodeURIComponent(activeChatId)}?token=${token}&projectId=${pId}`, {
            method: 'DELETE'
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Error al eliminar la conversación');
        }

        window.swalAlert('¡Chat Eliminado!', `La conversación con "${displayName}" fue eliminada del proyecto.`, 'success');

        clearActiveChatSelection();

        // Deshabilitar botones de cabecera
        if (btn) btn.disabled = true;

        // Refrescar la lista de chats
        await fetchChats(true);
    } catch (err) {
        console.error('[deleteActiveChat] Error:', err);
        window.swalAlert('Error', err.message || 'No se pudo eliminar la conversación', 'error');
        if (btn) btn.disabled = false;
    }
}

window.deleteActiveChat = deleteActiveChat;
window.clearActiveChatSelection = clearActiveChatSelection;

window.startContactSync = startContactSync;
window.closeSyncModal = closeSyncModal;

// --- NUEVOS CONTROLADORES PARA EMOJIS Y LIGHTBOX ---

const EMOJI_LIST = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
    '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏',
    '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
    '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥',
    '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
    '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻',
    '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚',
    '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
    '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪',
    '🦾', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸', '❤️', '🧡', '💛',
    '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💖', '💗', '💓', '💞', '💕', '💟', '❣️',
    '✨', '⭐', '🌟', '💫', '🔥', '💥', '💯', '🎉', '🎊', '🎈', '🎂', '🎁', '🎗️'
];

function toggleEmojiPicker(event) {
    if (event) event.stopPropagation();
    const picker = document.getElementById('emoji-picker');
    if (!picker) return;

    if (picker.style.display === 'none' || picker.style.display === '') {
        if (picker.children.length === 0) {
            picker.innerHTML = EMOJI_LIST.map(emoji =>
                `<div class="emoji-item" onclick="insertEmoji('${emoji}')">${emoji}</div>`
            ).join('');
        }
        picker.style.display = 'grid';
    } else {
        picker.style.display = 'none';
    }
}

function insertEmoji(emoji) {
    const input = document.getElementById('message-input');
    if (!input) return;

    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const text = input.value;

    input.value = text.substring(0, start) + emoji + text.substring(end);
    input.focus();

    const newPos = start + emoji.length;
    input.setSelectionRange(newPos, newPos);
}

function openLightbox(src) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    const downloadLink = document.getElementById('lightbox-download-link');

    if (modal && img && downloadLink) {
        img.src = src;
        downloadLink.href = src;
        modal.classList.add('active');
    }
}

function closeLightbox() {
    const modal = document.getElementById('lightbox-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// Cierre del picker al hacer clic afuera
document.addEventListener('click', (e) => {
    const picker = document.getElementById('emoji-picker');
    const btn = document.getElementById('emoji-btn');
    if (picker && picker.style.display === 'grid' && !picker.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        picker.style.display = 'none';
    }
});

let forwardMediaUrl = '';
let forwardMediaType = '';

async function deleteMessage(chatId, messageId) {
    if (!await window.swalConfirm('¿Eliminar mensaje?', '¿Estás seguro de que quieres eliminar este mensaje?')) return;

    try {
        const res = await fetch(`/api/backoffice/messages/${chatId}/${messageId}?token=${token}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            const data = await res.json();
            allMessages = allMessages.filter(m => m.id !== messageId && m.external_id !== messageId);
            renderMessages();

            if (data.deletedInWhatsApp) {
                console.log('Mensaje eliminado del Backoffice y de WhatsApp');
            } else {
                console.log(data.message);
                if (data.message.includes('Nota:')) {
                    window.swalAlert('Aviso', data.message, 'info');
                }
            }
        } else {
            const err = await res.json();
            window.swalAlert('Error', 'Error al eliminar mensaje: ' + (err.error || 'error desconocido'), 'error');
        }
    } catch (e) {
        console.error(e);
        window.swalAlert('Error', 'Error al eliminar el mensaje', 'error');
    }
}

function openForwardModal(mediaUrl, mediaType) {
    forwardMediaUrl = mediaUrl;
    forwardMediaType = mediaType;

    const modal = document.getElementById('forward-modal');
    if (modal) modal.style.display = 'flex';

    const searchInput = document.getElementById('forward-search-input');
    if (searchInput) searchInput.value = '';

    renderForwardChatsList();
}

function closeForwardModal() {
    const modal = document.getElementById('forward-modal');
    if (modal) modal.style.display = 'none';
    forwardMediaUrl = '';
    forwardMediaType = '';
}

function handleForwardSearch() {
    renderForwardChatsList();
}

function renderForwardChatsList() {
    const listContainer = document.getElementById('forward-chats-list');
    if (!listContainer) return;

    const query = (document.getElementById('forward-search-input')?.value || '').toLowerCase();

    const filteredChats = chats.filter(chat => {
        const name = (chat.name || '').toLowerCase();
        const phone = chat.id.toLowerCase();
        return name.includes(query) || phone.includes(query);
    });

    if (filteredChats.length === 0) {
        listContainer.innerHTML = `<div style="padding: 20px; text-align: center; opacity: 0.5; color: var(--text-muted);">No se encontraron contactos</div>`;
        return;
    }

    listContainer.innerHTML = filteredChats.map(chat => {
        const displayName = (chat.name && chat.name !== '[-]') ? chat.name : chat.id.split('@')[0];
        const displayPhone = chat.id.split('@')[0];

        return `
            <div class="forward-chat-item">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600; font-size: 0.9rem;">${displayName}</span>
                    <span style="font-size: 0.75rem; opacity: 0.6; color: var(--text-muted);">${displayPhone}</span>
                </div>
                <button onclick="executeForward('${chat.id}')" class="btn-primary btn-sm">
                    <i class="fas fa-paper-plane" style="margin-right: 4px;"></i> Enviar
                </button>
            </div>
        `;
    }).join('');
}

async function executeForward(targetChatId) {
    if (!forwardMediaUrl || !targetChatId) return;

    console.log(`Reenviando media a ${targetChatId}...`);

    try {
        const res = await fetch(`/api/backoffice/forward-message?token=${token}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatId: targetChatId,
                mediaUrl: forwardMediaUrl,
                mediaType: forwardMediaType
            })
        });

        if (res.ok) {

            closeForwardModal();
            if (targetChatId === activeChatId) {
                fetchMessages(activeChatId, true);
            }
        } else {
            const err = await res.json();
            window.swalAlert('Error', 'Error al reenviar archivo: ' + (err.error || 'error desconocido'), 'error');
        }
    } catch (e) {
        console.error(e);
        window.swalAlert('Error', 'Error al reenviar archivo', 'error');
    }
}

// Registrar funciones en el scope global
window.toggleEmojiPicker = toggleEmojiPicker;
window.insertEmoji = insertEmoji;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.deleteMessage = deleteMessage;
window.openForwardModal = openForwardModal;
window.closeForwardModal = closeForwardModal;
window.handleForwardSearch = handleForwardSearch;
window.executeForward = executeForward;

console.log('✅ [BACKOFFICE] Cargado Correctamente.');

// Funcion de re-inicializacion para SPA (llamada en cada visita a la view)
window.initBackofficeView = function () {
    if (!window.__backofficeEscapeCloseBound) {
        window.__backofficeEscapeCloseBound = true;
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || window.location.pathname !== '/conversaciones') return;
            const quickPopover = document.getElementById('quick-messages-popover');
            const metaPopover = document.getElementById('meta-templates-popover');
            const quickOpen = quickPopover && quickPopover.style.display !== 'none';
            const metaOpen = metaPopover && metaPopover.style.display !== 'none';
            if (quickOpen || metaOpen) {
                e.preventDefault();
                e.stopPropagation();
                if (quickPopover) quickPopover.style.display = 'none';
                if (metaPopover) metaPopover.style.display = 'none';
                if (quickOpen) window.clearCommandInputPrefix?.('quick');
                if (metaOpen) window.clearCommandInputPrefix?.('meta');
                return;
            }
            if (!activeChatId) return;
            e.preventDefault();
            clearActiveChatSelection();
        });
    }

    if (_activeChatSyncTimer) clearInterval(_activeChatSyncTimer);
    _activeChatSyncTimer = setInterval(() => syncActiveChatMessages('poll'), 3000);

    restoreBackofficeChatFromMemory();
    fetchGlobalBotStatus().finally(() => {
        const restoredChatId = activeChatId;
        fetchChats(true).then(() => {
            if (restoredChatId && activeChatId === restoredChatId) fetchMessages(restoredChatId, true);
        });
    });
    checkMetaStatus();
    initCRMData();
    fetchBotTags();
    fetchPendingTicketsCount();
    initBlacklist();
    loadNotificationsStatus();

    // Re-attach scroll listeners en el nuevo DOM
    const chatList = document.getElementById('chat-list');
    if (chatList) {
        chatList.addEventListener('scroll', function () {
            if (this.clientHeight > 0) {
                _backofficeChatListScrollTop = this.scrollTop;
            }
            const { scrollTop, scrollHeight, clientHeight } = this;
            if (scrollTop + clientHeight >= scrollHeight - 20) {
                if (!loadingChats && !allChatsLoaded) fetchChats();
            }
        }, { passive: true });
    }
    const messagesEl = document.getElementById('messages');
    if (messagesEl) {
        messagesEl.addEventListener('scroll', function () {
            if (this.scrollTop < 50 && !loadingMessages && !allMessagesLoaded) {
                fetchMessages(activeChatId);
            }
        });
    }

    // Ocultar mic al escribir, mostrar al vaciar (como WhatsApp)
    const msgInput = document.getElementById('message-input');
    const micBtn = document.getElementById('mic-btn');
    if (msgInput && micBtn) {
        msgInput.addEventListener('input', function () {
            micBtn.style.display = this.value.length > 0 ? 'none' : '';
        });
    }
};

window._backofficeAbortAll = function () {
    rememberBackofficeChatScroll();
    if (_fetchChatsController) { _fetchChatsController.abort(); _fetchChatsController = null; }
    if (_fetchMessagesController) { _fetchMessagesController.abort(); _fetchMessagesController = null; }
    loadingChats = false;
    loadingMessages = false;
};

// ─────────────────────────────────────────────────────────────────────────────
// LISTA NEGRA - Lógica de integración en el backoffice
// ─────────────────────────────────────────────────────────────────────────────

let _blacklistActive = false;
let _currentChatBlacklisted = false;

/** Verifica si la Lista Negra está activa y muestra/oculta el toggle en el header */
async function initBlacklist() {
    try {
        const res = await fetch(`/api/backoffice/blacklist/status?token=${token}`);
        const data = await res.json();
        _blacklistActive = !!data.active;
        _updateBlacklistBtnVisibility();
    } catch (e) {
        console.warn('[Blacklist] No se pudo verificar status:', e);
        _blacklistActive = false;
    }
}

function _updateBlacklistBtnVisibility() {
    const btn = document.getElementById('blacklist-toggle-btn');
    if (btn) btn.style.display = _blacklistActive ? 'inline-flex' : 'none';
    const mobileLi = document.getElementById('mobile-blacklist-li');
    if (mobileLi) mobileLi.style.display = _blacklistActive ? '' : 'none';
}

/** Llamada al seleccionar un chat: verifica si está en la lista negra y actualiza el botón */
async function checkBlacklistForChat(chatId) {
    if (!_blacklistActive) return;
    const btn = document.getElementById('blacklist-toggle-btn');
    if (!btn) return;

    btn.disabled = true;
    try {
        const res = await fetch(`/api/backoffice/blacklist/check/${encodeURIComponent(chatId)}?token=${token}`);
        const data = await res.json();
        _currentChatBlacklisted = !!data.inBlacklist;
        _updateBlacklistBtn(_currentChatBlacklisted);
    } catch (e) {
        console.warn('[Blacklist] Error verificando chat:', e);
    } finally {
        btn.disabled = false;
    }
}

function _updateBlacklistBtn(isBlacklisted) {
    const btn = document.getElementById('blacklist-toggle-btn');
    if (!btn) return;
    if (isBlacklisted) {
        btn.innerHTML = '<i class="fas fa-ban" style="color:#25D366;"></i>';
        btn.title = 'Lista BOT/CRM Desactivado: contacto bloqueado — Clic para quitar';
    } else {
        btn.innerHTML = '<i class="fas fa-ban" style="color:var(--text-muted);"></i>';
        btn.title = 'Lista BOT/CRM Desactivado: contacto habilitado — Clic para agregar';
    }
}

/** Toggle rápido desde el header: agrega o quita de la lista negra */
async function toggleBlacklist() {
    if (!activeChatId || !_blacklistActive) return;
    const btn = document.getElementById('blacklist-toggle-btn');
    if (btn) btn.disabled = true;

    const newState = !_currentChatBlacklisted; // nuevo valor: true = agregar, false = quitar
    try {
        const res = await fetch(`/api/backoffice/blacklist/toggle/${encodeURIComponent(activeChatId)}?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inBlacklist: newState })
        });
        const data = await res.json();
        if (data.success) {
            _currentChatBlacklisted = newState;
            _updateBlacklistBtn(_currentChatBlacklisted);
            const msg = newState
                ? '⛔ Contacto agregado a la lista (Sin Bot)'
                : '✅ Contacto quitado de la lista';
            if (typeof showToast === 'function') showToast(msg, newState ? 'warning' : 'success');
        }
    } catch (e) {
        console.error('[Blacklist] Error en toggle:', e);
        if (typeof showToast === 'function') showToast('Error al actualizar la lista', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

window.toggleBlacklist = toggleBlacklist;

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES - Lógica de integración en el backoffice
// ─────────────────────────────────────────────────────────────────────────────

async function loadNotificationsStatus() {
    try {
        const res = await fetch(`/api/backoffice/notifications/status?token=${token}`);
        const data = await res.json();
        _notificationsActive = !!data.active;
        _updateNotificationsUI();
    } catch (e) {
        console.warn('[Notifications] No se pudo verificar status:', e);
        _notificationsActive = false;
        _updateNotificationsUI();
    }
}

function _updateNotificationsUI() {
    const filterContainer = document.getElementById('unread-filter-container');
    const totalBadge = document.getElementById('unread-total-badge');
    if (_notificationsActive) {
        if (filterContainer) filterContainer.style.display = 'flex';
    } else {
        if (filterContainer) filterContainer.style.display = 'none';
        if (totalBadge) totalBadge.style.display = 'none';
        chats.forEach(c => c.unread_count = 0);
    }

    const allButton = document.getElementById('unread-filter-all');
    const unreadButton = document.getElementById('unread-filter-unread');
    allButton?.classList.toggle('active', !_showOnlyUnreadChats);
    unreadButton?.classList.toggle('active', _showOnlyUnreadChats);

    renderChatList();
}

async function markChatAsRead(chatId, force = false) {
    if (!_notificationsActive) return;
    const chat = chats.find(c => normChatId(c.id) === normChatId(chatId));
    const shouldMark = force || (chat && (chat.unread_count || 0) > 0);
    if (!shouldMark) return;
    if (chat) {
        chat.unread_count = 0;
        renderChatList();
    }
    try {
        await fetch(`/api/backoffice/chat/read/${encodeURIComponent(chatId)}?token=${token}`, { method: 'POST' });
    } catch (e) {
        console.warn('[Notifications] Error al marcar como leido:', e);
    }
}

function executeUnreadFilter(enabled) {
    _showOnlyUnreadChats = enabled;
    document.getElementById('unread-filter-all')?.classList.toggle('active', !enabled);
    document.getElementById('unread-filter-unread')?.classList.toggle('active', enabled);
    renderChatList();
}

// --- MENSAJES RÁPIDOS (QUICK MESSAGES) ---

window.toggleQuickMessages = function (e) {
    if (e) e.stopPropagation();
    const popover = document.getElementById('quick-messages-popover');
    if (!popover) return;
    const isShowing = popover.style.display !== 'none';
    if (isShowing) {
        popover.style.display = 'none';
    } else {
        popover.style.display = 'flex';
        window.loadQuickMessages();
    }
};

window.loadQuickMessages = async function () {
    const listEl = document.getElementById('qm-list');
    if (!listEl) return;

    try {
        const activeChat = chats.find(c => c.id === activeChatId);
        // Si el bot está activo, no son seleccionables (modo intervención humana desactivado)
        const isBotActive = activeChat ? isBotEffectivelyEnabled(activeChat) : true;

        const res = await fetch(`/api/backoffice/quick-messages?token=${token}&projectId=${activeChat?.project_id || ''}`);
        if (!res.ok) throw new Error('Error al cargar mensajes rápidos');
        const qMessages = await res.json();

        if (!Array.isArray(qMessages) || qMessages.length === 0) {
            listEl.innerHTML = '<div class="qm-empty">No hay mensajes rápidos guardados.</div>';
            return;
        }

        listEl.innerHTML = qMessages.map(qm => {
            const disabledClass = isBotActive ? 'disabled' : '';
            return `
                <div class="qm-item ${disabledClass}" onclick="window.sendQuickMessage('${qm.id}', '${encodeURIComponent(qm.message)}', ${isBotActive})">
                    <div class="qm-item-info">
                        <div class="qm-item-title">${qm.title}</div>
                        <div class="qm-item-body">${qm.message}</div>
                    </div>
                    <button class="qm-delete-btn" onclick="window.deleteQuickMessage(event, '${qm.id}')" title="Eliminar mensaje rápido">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Error cargando mensajes rápidos:', e);
        listEl.innerHTML = '<div class="qm-empty">Error al cargar mensajes rápidos.</div>';
    }
};

window.saveQuickMessage = async function () {
    const titleInput = document.getElementById('qm-title-input');
    const msgInput = document.getElementById('qm-message-input');
    if (!titleInput || !msgInput) return;

    const title = titleInput.value.trim();
    const message = msgInput.value.trim();

    if (!title || !message) {
        window.swalAlert('Atención', 'Por favor, ingresa un título y un mensaje', 'warning');
        return;
    }

    try {
        const activeChat = chats.find(c => c.id === activeChatId);
        const res = await fetch(`/api/backoffice/quick-messages?token=${token}&projectId=${activeChat?.project_id || ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, message })
        });

        if (res.ok) {
            titleInput.value = '';
            msgInput.value = '';
            window.loadQuickMessages();
        } else {
            window.swalAlert('Error', 'Error al guardar el mensaje rápido', 'error');
        }
    } catch (e) {
        console.error('Error al guardar mensaje rápido:', e);
    }
};

window.deleteQuickMessage = async function (e, id) {
    if (e) e.stopPropagation();
    if (!await window.swalConfirm('¿Eliminar mensaje rápido?', '¿Estás seguro de eliminar este mensaje rápido?')) return;

    try {
        const activeChat = chats.find(c => c.id === activeChatId);
        const res = await fetch(`/api/backoffice/quick-messages/${id}?token=${token}&projectId=${activeChat?.project_id || ''}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            window.loadQuickMessages();
        } else {
            window.swalAlert('Error', 'Error al eliminar el mensaje rápido', 'error');
        }
    } catch (e) {
        console.error('Error al eliminar mensaje rápido:', e);
    }
};

window.sendQuickMessage = async function (id, encodedMsg, isBotActive) {
    if (isBotActive) {
        showToast('⚠️ No seleccionable: Desactiva el Bot para enviar mensajes manuales', 'warning');
        return;
    }
    const messageText = decodeURIComponent(encodedMsg);

    // Ocultar popover
    const popover = document.getElementById('quick-messages-popover');
    if (popover) popover.style.display = 'none';

    // Rellenar textarea
    const input = document.getElementById('message-input');
    if (input) {
        input.value = messageText;
        window.autoResizeChatTextarea(input);

        // Enviar mensaje de inmediato
        await sendMessage();
    }
};

// Cerrar popover si se hace click fuera
document.addEventListener('click', (e) => {
    const popover = document.getElementById('quick-messages-popover');
    const quickBtn = document.getElementById('quick-msg-btn');
    if (popover && popover.style.display !== 'none' && !popover.contains(e.target) && !quickBtn.contains(e.target)) {
        popover.style.display = 'none';
    }
});

// Exponer métodos para ser llamados por otros módulos
window.executeUnreadFilter = executeUnreadFilter;
window.backofficeController = {
    loadNotificationsStatus,
    refreshChatsList: () => renderChatList()
};

// --- PLANTILLAS DE META (META TEMPLATES) ---

window._cachedMetaTemplates = null;
window._selectedMetaTemplate = null;
window._metaTemplateFormValues = {};

function getActiveMetaTemplateScope() {
    const activeChat = chats.find(c => c.id === activeChatId);
    const projectId = activeChat?.project_id || window.railwayProjectId || '';
    const serviceId = activeChat?.service_id || window.railwayServiceId || '';
    return {
        activeChat,
        projectId,
        serviceId,
        cacheKey: `${projectId || 'default'}:${serviceId || 'default_service'}`
    };
}

function getCachedMetaTemplatesForScope(cacheKey) {
    if (!window._cachedMetaTemplates || window._cachedMetaTemplates.cacheKey !== cacheKey) return null;
    return window._cachedMetaTemplates.templates;
}

window.toggleMetaTemplatesPopover = function (e) {
    if (e) e.stopPropagation();
    const popover = document.getElementById('meta-templates-popover');
    const qmPopover = document.getElementById('quick-messages-popover');
    if (qmPopover) qmPopover.style.display = 'none';

    if (!popover) return;
    const isShowing = popover.style.display !== 'none';
    if (isShowing) {
        popover.style.display = 'none';
    } else {
        popover.style.display = 'flex';
        window.backToMetaTemplatesList();
        window.loadMetaTemplates();
    }
};

window.backToMetaTemplatesList = function () {
    const stepList = document.getElementById('mt-step-list');
    const stepConfig = document.getElementById('mt-step-configure');
    if (stepList) stepList.style.display = 'block';
    if (stepConfig) stepConfig.style.display = 'none';
    window._selectedMetaTemplate = null;
    window._metaTemplateFormValues = {};
};

window.loadMetaTemplates = async function (forceRefresh = false) {
    const listEl = document.getElementById('mt-list');
    if (!listEl) return;

    const scope = getActiveMetaTemplateScope();
    const cachedTemplates = getCachedMetaTemplatesForScope(scope.cacheKey);
    if (cachedTemplates && !forceRefresh) {
        window.renderMetaTemplatesList(cachedTemplates);
        return;
    }

    listEl.innerHTML = '<div class="qm-empty"><i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i> Cargando plantillas...</div>';

    try {
        const params = new URLSearchParams({ token });
        if (scope.projectId) params.set('projectId', scope.projectId);
        if (scope.serviceId) params.set('serviceId', scope.serviceId);
        const res = await fetch(`/api/backoffice/whatsapp/templates?${params.toString()}`);
        const data = await res.json();

        if (!data.success || !Array.isArray(data.templates)) {
            listEl.innerHTML = `<div class="qm-empty">${escapeMsgHtml(data.error || 'No se pudieron cargar las plantillas de Meta.')}</div>`;
            return;
        }

        window._cachedMetaTemplates = { cacheKey: scope.cacheKey, templates: data.templates };
        window.renderMetaTemplatesList(data.templates);
    } catch (err) {
        console.error('Error cargando plantillas de Meta:', err);
        listEl.innerHTML = '<div class="qm-empty">Error de conexión al cargar plantillas.</div>';
    }
};

window.renderMetaTemplatesList = function (templatesToRender) {
    const listEl = document.getElementById('mt-list');
    if (!listEl) return;

    if (!Array.isArray(templatesToRender) || templatesToRender.length === 0) {
        listEl.innerHTML = '<div class="qm-empty">No hay plantillas de Meta disponibles.</div>';
        return;
    }

    listEl.innerHTML = templatesToRender.map(t => {
        const bodyComp = t.components?.find(c => c.type === 'BODY');
        const previewText = bodyComp?.text || '';
        const category = t.category || 'UTILITY';

        let catColor = '#6366f1';
        if (category === 'MARKETING') catColor = '#ec4899';
        else if (category === 'AUTHENTICATION') catColor = '#f59e0b';

        return `
            <div class="qm-item meta-template-item" onclick="window.selectMetaTemplateForChat('${escapeJsString(t.name)}')">
                <div class="qm-item-info">
                    <div class="meta-template-item-head">
                        <span class="qm-item-title">${escapeMsgHtml(t.name)}</span>
                        <span class="meta-template-category" style="--mt-cat:${catColor};">${escapeMsgHtml(category)}</span>
                    </div>
                    <div class="qm-item-body">${escapeMsgHtml(previewText)}</div>
                </div>
            </div>
        `;
    }).join('');
};

window.filterMetaTemplates = function (query) {
    const templates = window._cachedMetaTemplates?.templates;
    if (!Array.isArray(templates)) return;
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        window.renderMetaTemplatesList(templates);
        return;
    }
    const filtered = templates.filter(t =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        t.components?.some(c => (c.text || '').toLowerCase().includes(q))
    );
    window.renderMetaTemplatesList(filtered);
};

window.selectMetaTemplateForChat = function (templateName) {
    const templates = window._cachedMetaTemplates?.templates;
    if (!Array.isArray(templates)) return;
    const template = templates.find(t => t.name === templateName);
    if (!template) return;

    window._selectedMetaTemplate = template;
    window._metaTemplateFormValues = {};

    const stepList = document.getElementById('mt-step-list');
    const stepConfig = document.getElementById('mt-step-configure');
    const titleEl = document.getElementById('mt-selected-name');

    if (stepList) stepList.style.display = 'none';
    if (stepConfig) stepConfig.style.display = 'flex';
    if (titleEl) titleEl.innerText = template.name;

    const activeChat = chats.find(c => c.id === activeChatId);
    const chatName = (activeChat?.name && activeChat.name !== '[-]') ? activeChat.name : (activeChat?.contact_name || '');
    const chatPhone = activeChat?.id ? activeChat.id.split('@')[0] : '';

    const bodyComp = template.components?.find(c => c.type === 'BODY');
    const isNamed = (template.parameter_format || '').toLowerCase() === 'named';
    const bodyNamedParams = bodyComp?.example?.body_text_named_params || [];

    const varNames = [];
    if (isNamed && bodyNamedParams.length > 0) {
        bodyNamedParams.forEach(p => varNames.push(p.param_name));
    }
    if (varNames.length === 0 && bodyComp?.text) {
        const varRegex = /\{\{([^}]+)\}\}/g;
        let match;
        while ((match = varRegex.exec(bodyComp.text)) !== null) {
            const vName = match[1].trim();
            if (!varNames.includes(vName)) varNames.push(vName);
        }
    }

    varNames.forEach((varName, idx) => {
        const lower = varName.toLowerCase();
        let autoVal = '';
        if (['nombre', 'name', 'nombre_cliente', 'nombrecliente'].includes(lower) || (!isNamed && idx === 0)) {
            autoVal = chatName;
        } else if (['telefono', 'phone', 'celular', 'tel', 'movil'].includes(lower)) {
            autoVal = chatPhone;
        } else if (['email', 'correo'].includes(lower) && activeChat?.crm_email) {
            autoVal = activeChat.crm_email;
        } else if (['cuit', 'cuil', 'dni'].includes(lower) && activeChat?.crm_cuit) {
            autoVal = activeChat.crm_cuit;
        } else if (['direccion', 'domicilio', 'address'].includes(lower) && activeChat?.crm_address) {
            autoVal = activeChat.crm_address;
        }
        window._metaTemplateFormValues[varName] = autoVal;
    });

    const headerComp = template.components?.find(c => c.type === 'HEADER');
    if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
        const exampleUrl = headerComp.example?.header_handle?.[0] || '';
        window._metaTemplateFormValues['_header_media_url'] = exampleUrl;
    }

    const buttonsComp = template.components?.find(c => c.type === 'BUTTONS');
    if (buttonsComp && Array.isArray(buttonsComp.buttons)) {
        buttonsComp.buttons.forEach((btn, idx) => {
            if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
                window._metaTemplateFormValues[`_button_${idx+1}_url_suffix`] = '';
            }
        });
    }

    window.renderMetaTemplateForm();
};

window.updateMetaTemplatePreview = function () {
    const template = window._selectedMetaTemplate;
    if (!template) return;

    const previewEl = document.getElementById('mt-template-preview');
    if (!previewEl) return;

    const bodyComp = template.components?.find(c => c.type === 'BODY');
    const headerComp = template.components?.find(c => c.type === 'HEADER');

    let rawText = bodyComp?.text || '';
    let renderedText = rawText;

    const varRegex = /\{\{([^}]+)\}\}/g;
    renderedText = renderedText.replace(varRegex, (match, p1) => {
        const vName = p1.trim();
        const val = window._metaTemplateFormValues[vName];
        if (val && val.trim() !== '') {
            return `<strong class="mt-preview-variable">${escapeMsgHtml(val)}</strong>`;
        }
        return `<span class="mt-preview-missing">{${escapeMsgHtml(vName)}}</span>`;
    });

    let headerHtml = '';
    if (headerComp) {
        if (headerComp.format === 'TEXT' && headerComp.text) {
            headerHtml = `<div class="mt-preview-header-text">${escapeMsgHtml(headerComp.text)}</div>`;
        } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
            headerHtml = `<div class="mt-preview-media">
                <i class="fas fa-file-invoice icon-mr"></i> Cabecera Multimedia (${escapeMsgHtml(headerComp.format)})
            </div>`;
        }
    }

    previewEl.innerHTML = `
        <div class="mt-preview-card">
            ${headerHtml}
            <div>${renderedText.replace(/\n/g, '<br/>')}</div>
        </div>
    `;
};
window.renderMetaTemplateForm = function () {
    const template = window._selectedMetaTemplate;
    if (!template) return;

    const formEl = document.getElementById('mt-variables-form');
    if (!formEl) return;

    window.updateMetaTemplatePreview();

    const headerComp = template.components?.find(c => c.type === 'HEADER');
    const isNamed = (template.parameter_format || '').toLowerCase() === 'named';

    let formHtml = '';

    if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
        const mediaVal = window._metaTemplateFormValues['_header_media_url'] || '';
        formHtml += `
            <div class="mt-form-field">
                <label>
                    <i class="fas fa-link icon-mr"></i> URL Cabecera (${escapeMsgHtml(headerComp.format)}):
                </label>
                <input type="text" value="${escapeAttr(mediaVal)}" placeholder="URL pública..."
                    oninput="window._metaTemplateFormValues['_header_media_url']=this.value; window.updateMetaTemplatePreview();"
                />
            </div>
        `;
    }

    const keys = Object.keys(window._metaTemplateFormValues).filter(k => !k.startsWith('_'));
    if (keys.length > 0) {
        formHtml += `<div class="mt-form-section-title">Variables del Mensaje:</div>`;
        keys.forEach(key => {
            const val = window._metaTemplateFormValues[key] || '';
            const labelText = isNamed ? `Variable {{${key}}}` : `Parámetro {{${key}}}`;
            formHtml += `
                <div class="mt-form-field">
                    <label>${escapeMsgHtml(labelText)}:</label>
                    <input type="text" value="${escapeAttr(val)}" placeholder="Valor para ${escapeAttr(key)}..."
                        oninput="window._metaTemplateFormValues['${escapeJsString(key)}']=this.value; window.updateMetaTemplatePreview();"
                    />
                </div>
            `;
        });
    }

    const btnKeys = Object.keys(window._metaTemplateFormValues).filter(k => k.startsWith('_button_'));
    if (btnKeys.length > 0) {
        formHtml += `<div class="mt-form-section-title">Botones con URL dinámica:</div>`;
        btnKeys.forEach(btnKey => {
            const val = window._metaTemplateFormValues[btnKey] || '';
            const btnNum = btnKey.split('_')[2];
            formHtml += `
                <div class="mt-form-field">
                    <label>Sufijo URL Botón ${escapeMsgHtml(btnNum)}:</label>
                    <input type="text" value="${escapeAttr(val)}" placeholder="Ej: codigo123..."
                        oninput="window._metaTemplateFormValues['${escapeJsString(btnKey)}']=this.value; window.updateMetaTemplatePreview();"
                    />
                </div>
            `;
        });
    }

    formEl.innerHTML = formHtml;
};
window.sendMetaTemplateToActiveChat = async function () {
    const template = window._selectedMetaTemplate;
    if (!template || !activeChatId) return;

    const scope = getActiveMetaTemplateScope();
    const targetPhone = activeChatId.split('@')[0];

    const sendBtn = document.getElementById('mt-send-btn');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin icon-mr"></i> Enviando...';
    }

    try {
        const isNamed = (template.parameter_format || '').toLowerCase() === 'named';
        const bodyComp = template.components?.find(c => c.type === 'BODY');
        const headerComp = template.components?.find(c => c.type === 'HEADER');
        const components = [];

        let mediaHeaderObj = null;
        if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
            const lowFormat = headerComp.format.toLowerCase();
            const mediaUrl = window._metaTemplateFormValues['_header_media_url'] || headerComp.example?.header_handle?.[0];

            if (mediaUrl) {
                components.push({
                    type: 'HEADER',
                    parameters: [{
                        type: lowFormat,
                        [lowFormat]: { link: mediaUrl }
                    }]
                });
                mediaHeaderObj = { url: mediaUrl, type: lowFormat };
            }
        }

        const varKeys = Object.keys(window._metaTemplateFormValues).filter(k => !k.startsWith('_'));
        if (varKeys.length > 0) {
            const bodyParams = [];
            varKeys.forEach(vKey => {
                const val = (window._metaTemplateFormValues[vKey] || '').trim() || '-';
                if (isNamed) {
                    bodyParams.push({ type: 'text', parameter_name: vKey, text: val });
                } else {
                    bodyParams.push({ type: 'text', text: val });
                }
            });
            components.push({ type: 'BODY', parameters: bodyParams });
        }

        const btnKeys = Object.keys(window._metaTemplateFormValues).filter(k => k.startsWith('_button_'));
        btnKeys.forEach(bKey => {
            const idx = parseInt(bKey.split('_')[2]) - 1;
            const val = (window._metaTemplateFormValues[bKey] || '').trim();
            if (val) {
                components.push({
                    type: 'button',
                    sub_type: 'url',
                    index: String(idx),
                    parameters: [{ type: 'text', text: val }]
                });
            }
        });

        let renderedText = bodyComp?.text || '';
        renderedText = renderedText.replace(/\{\{([^}]+)\}\}/g, (m, p1) => {
            const vKey = p1.trim();
            return window._metaTemplateFormValues[vKey] || m;
        });
        const historyText = `[Plantilla Meta: ${template.name}]\n${renderedText}`;

        const params = new URLSearchParams({ token });
        if (scope.projectId) params.set('projectId', scope.projectId);
        if (scope.serviceId) params.set('serviceId', scope.serviceId);

        const res = await fetch(`/api/backoffice/whatsapp/send-single-template?${params.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatId: activeChatId,
                phone: targetPhone,
                templateName: template.name,
                languageCode: template.language || 'es',
                components,
                renderedText: historyText,
                mediaHeader: mediaHeaderObj,
                projectId: scope.projectId,
                serviceId: scope.serviceId
            })
        });

        const data = await res.json();

        if (data.success) {
            if (window.swalAlert) {
                window.swalAlert('¡Enviado!', `La plantilla '${template.name}' se envió con éxito.`, 'success');
            }
            const popover = document.getElementById('meta-templates-popover');
            if (popover) popover.style.display = 'none';
            window.backToMetaTemplatesList();
            fetchMessages(activeChatId, true);
        } else {
            throw new Error(data.error || 'Error al enviar la plantilla.');
        }
    } catch (err) {
        console.error('Error enviando plantilla Meta:', err);
        if (window.swalAlert) {
            window.swalAlert('Error', err.message || 'No se pudo enviar la plantilla.', 'error');
        }
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane icon-mr"></i> Enviar Plantilla';
        }
    }
};
document.addEventListener('click', (e) => {
    const popover = document.getElementById('meta-templates-popover');
    const mtBtn = document.getElementById('meta-templates-btn');
    if (popover && popover.style.display !== 'none' && !popover.contains(e.target) && mtBtn && !mtBtn.contains(e.target)) {
        popover.style.display = 'none';
    }
});


window.toggleMsgDropdown = function(msgId) {
    const menu = document.getElementById("dropdown-" + msgId);
    const isShowing = menu && menu.classList.contains('show');

    document.querySelectorAll('.msg-dropdown-menu.show').forEach(m => {
        m.classList.remove('show');
        m.classList.remove('menu-up');
    });

    if (!isShowing && menu) {
        const msgContainer = menu.closest('.msg');
        const scrollContainer = document.getElementById('messages');
        if (msgContainer && scrollContainer) {
            const cRect = scrollContainer.getBoundingClientRect();
            const mRect = msgContainer.getBoundingClientRect();
            if (cRect.bottom - mRect.bottom < 250) {
                menu.classList.add('menu-up');
            }
        }
        menu.classList.add('show');
    }
};

// Cerrar dropdowns al hacer click afuera
document.addEventListener('click', () => {
    document.querySelectorAll('.msg-dropdown-menu.show').forEach(m => {
        m.classList.remove('show');
        m.classList.remove('menu-up');
    });
});


window.copyMessage = function(msgId) {
    document.querySelectorAll('.msg-dropdown-menu.show').forEach(m => { m.classList.remove('show'); m.classList.remove('menu-up'); });
    const msg = allMessages.find(m => m.id === msgId || m.external_id === msgId);
    if (!msg || !msg.content) return;
    navigator.clipboard.writeText(msg.content).then(() => {
        showCopyToast('Mensaje copiado');
    }).catch(err => console.error('Error copying text: ', err));
};

window.copySelectedMessageText = function(msgId) {
    const menu = document.getElementById("dropdown-" + msgId);
    const msgContainer = menu?.closest('.msg') || document.querySelector(`.msg[data-id="${CSS.escape(msgId)}"]`);
    const selectedText = menu?.dataset.selectedText || getSelectedTextForMessage(msgContainer);

    closeMessageMenus();

    if (!selectedText) {
        showCopyToast('No hay texto seleccionado', 'warning');
        return;
    }

    navigator.clipboard.writeText(selectedText).then(() => {
        showCopyToast('Selección copiada');
    }).catch(err => console.error('Error copying selected text: ', err));
};

window.replyToMessage = function(msgId) {
    closeMessageMenus();
    const msg = findMessageById(msgId);
    if (!msg) return;
    replyTargetMessageId = msg.external_id || msg.id || msgId;
    replyTargetMessage = msg;
    const container = document.getElementById('reply-preview-container');
    const text = document.getElementById('reply-preview-text');
    if (text) {
        text.innerHTML = `<span class="reply-preview-author">${escapeMsgHtml(getReplyAuthor(msg))}</span>${escapeMsgHtml(getMessagePreviewText(msg) || 'Mensaje')}`;
    }
    if (container) container.style.display = 'block';
    const input = document.getElementById('message-input');
    if (input) input.focus();
};

window.cancelReply = function() {
    replyTargetMessageId = null;
    replyTargetMessage = null;
    const container = document.getElementById('reply-preview-container');
    if (container) container.style.display = 'none';
};

window.deleteMessage = async function(messageId) {
    closeMessageMenus();
    if (!activeChatId || !messageId) return;
    if (!await window.swalConfirm('\u00bfEliminar mensaje?', '\u00bfEst\u00e1s seguro de que deseas eliminar el mensaje?')) return;

    try {
        const scopeParams = getActiveChatScopeParams();
        const res = await fetch(`/api/backoffice/messages/${activeChatId}/${messageId}?token=${token}${scopeParams ? `&${scopeParams}` : ''}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            const data = await res.json();
            allMessages = allMessages.filter(m => m.id !== messageId && m.external_id !== messageId);
            renderMessages();
            if (!data.deletedInWhatsApp && data.message && data.message.includes('Nota:')) {
                window.swalAlert('Aviso', data.message, 'info');
            }
        } else {
            const err = await res.json();
            window.swalAlert('Error', 'Error al eliminar mensaje: ' + (err.error || 'error desconocido'), 'error');
        }
    } catch (e) {
        console.error(e);
        window.swalAlert('Error', 'Error al eliminar el mensaje', 'error');
    }
};

window.openForwardModal = function(mediaUrl, mediaType) {
    closeMessageMenus();
    if (!mediaType) {
        const msg = findMessageById(mediaUrl);
        if (!msg) return;
        forwardMediaUrl = msg.content || '';
        forwardMediaType = msg.type || 'text';
    } else {
        forwardMediaUrl = mediaUrl;
        forwardMediaType = mediaType;
    }
    if (!forwardMediaUrl) return;
    const modal = document.getElementById('forward-modal');
    if (modal) modal.style.display = 'flex';
    const searchInput = document.getElementById('forward-search-input');
    if (searchInput) searchInput.value = '';
    renderForwardChatsList();
};

window.reactToMessage = async function(msgId, reaction) {
    closeMessageMenus();
    if (!activeChatId || !msgId) return;
    try {
        const res = await fetch('/api/backoffice/messages/react', {
            method: 'POST',
            headers: { 'Authorization': 'token=' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(getActiveChatScopeBody({ chatId: activeChatId, messageId: msgId, reaction }))
        });
        if (!res.ok) {
            const err = await res.json();
            window.swalAlert('Error', err.error || 'No se pudo enviar la reaccion', 'error');
            return;
        }
        const msg = findMessageById(msgId);
        if (msg) msg.reaction = reaction;
        renderMessages();
    } catch (e) {
        console.error('Error enviando reaccion:', e);
        window.swalAlert('Error', 'No se pudo enviar la reaccion', 'error');
    }
};

window.toggleMsgDropdown = function(msgId) {
    const menu = document.getElementById("dropdown-" + msgId);
    const isShowing = menu && menu.classList.contains('show');
    if (!menu) return;
    closeMessageMenus();
    menu.style.left = '';
    menu.style.right = '';
    if (isShowing) return;
    const msgContainer = menu.closest('.msg');
    menu.dataset.selectedText = getSelectedTextForMessage(msgContainer);
    const scrollContainer = document.getElementById('messages');
    if (msgContainer && scrollContainer) {
        const cRect = scrollContainer.getBoundingClientRect();
        const mRect = msgContainer.getBoundingClientRect();
        if (cRect.bottom - mRect.bottom < 250) {
            menu.classList.add('menu-up');
        }
    }
    menu.classList.add('show');
    if (msgContainer && scrollContainer) {
        const cRect = scrollContainer.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > cRect.right - 8) {
            menu.style.left = 'auto';
            menu.style.right = '0';
        } else if (menuRect.left < cRect.left + 8) {
            menu.style.left = '0';
            menu.style.right = 'auto';
        }
    }
};



// --- Funciones Globales para Textareas de Chat (Movidas desde crm-common) ---
window.handleChatTextareaKey = function(e, sendCallback) {
    if (e.key === 'Enter') {
        if (window.innerWidth <= 1024) {
            return;
        } else {
            if (!e.shiftKey) {
                e.preventDefault();
                if (typeof sendCallback === 'function') sendCallback();
            }
        }
    }
};
window.autoResizeChatTextarea = function(el) {
    el.style.height = 'auto';
    const paddingY = 16;
    const lineHeight = 20;
    const maxLines = window.innerWidth <= 1024 ? 5 : 8;
    const maxHeight = paddingY + (lineHeight * maxLines);
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
};
window.resetChatTextarea = function(el) {
    if (!el) return;
    el.value = '';
    el.style.height = 'auto';
};
