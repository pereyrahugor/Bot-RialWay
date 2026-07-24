/* global showToast */
/* eslint-disable no-undef */
window.supportWidget = (() => {
    let _token = '';
    let _isOpen = false;
    let _activeTab = 'home'; // 'home' | 'messages'
    let _isMinimized = false;
    let _chats = [];
    let _activeTicket = null;
    let _activeTicketsCache = [];
    let _socketBound = false;
    let _userName = 'Usuario';

    function init(token) {
        _token = (typeof token === 'string' && token && token !== 'undefined') ? token : '';
        if (!_token) {
            _token = (typeof window.getAuthToken === 'function' ? decodeURIComponent(window.getAuthToken()) : '') || localStorage.getItem('backoffice_token') || '';
        }
        if (_token === 'undefined') _token = '';
        if (!_token) return; // No inicializar si no hay token (no logueado)

        _fetchUserName();
        _injectHTML();
        _loadChats();
        _fetchAll();

        // Bind socket events for real-time chat updates
        if (!_socketBound && typeof io !== 'undefined') {
            _socketBound = true;
            const s = typeof socket !== 'undefined' ? socket : (typeof window.crmSocket !== 'undefined' ? window.crmSocket : io());
            
            s.on('ticket_updated', async (payload) => {
                if (_activeTicket && payload && payload.id === _activeTicket.id) {
                    _activeTicket = { ..._activeTicket, ...payload };
                    _updateChatUI();
                }
                
                await _fetchAll();
                
                if (_activeTicket) {
                    const updatedTicket = _activeTicketsCache.find(x => x.id === _activeTicket.id);
                    if (updatedTicket) {
                        _activeTicket = updatedTicket;
                        _updateChatUI();
                    }
                }
            });

            s.on('ticket_deleted', async (payload) => {
                if (_activeTicket && payload && payload.id === _activeTicket.id) {
                    _activeTicket = null;
                    _updateChatUI();
                }
                await _fetchAll();
            });
        }
    }

    async function _fetchUserName() {
        try {
            const res = await fetch(`/api/backoffice/me?token=${_token}`);
            const data = await res.json();
            if (data && data.success && data.nombre) {
                _userName = data.nombre;
                const nameEl = document.getElementById('sw-user-name');
                if (nameEl) nameEl.innerText = _userName;
            }
        } catch (e) {
            console.error('[SupportWidget] Error fetching user name', e);
        }
    }

    function _injectHTML() {
        if (document.getElementById('support-widget-container')) return;

        const container = document.createElement('div');
        container.id = 'support-widget-container';
        container.innerHTML = `
        <style>
            #sw-root {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 99999;
                font-family: inherit;
                pointer-events: none;
            }

            #sw-popover {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 380px;
                height: 600px;
                max-height: calc(100vh - 100px);
                max-width: calc(100vw - 48px);
                background: #ffffff;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.15);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                opacity: 0;
                pointer-events: none;
                transform: translateY(20px);
                transition: opacity 0.3s, transform 0.3s, width 0.2s, height 0.2s;
                border: 1px solid rgba(0,0,0,0.08);
            }
            #sw-popover.sw-minimized {
                width: 280px;
                height: 56px;
                border-radius: 12px;
                cursor: pointer;
            }
            .sw-window-content {
                display: flex;
                flex: 1;
                min-height: 0;
                flex-direction: column;
            }
            #sw-popover.sw-minimized .sw-window-content {
                display: none;
            }
            .sw-widget-controls {
                position: absolute;
                top: 10px;
                right: 10px;
                z-index: 20;
                display: flex;
                gap: 6px;
            }
            .sw-widget-action {
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 8px;
                background: rgba(15, 23, 42, 0.62);
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: background 0.2s, transform 0.2s;
            }
            .sw-widget-action:hover {
                background: rgba(15, 23, 42, 0.82);
                transform: translateY(-1px);
            }
            html[data-theme="dark"] .sw-widget-action {
                background: rgba(148, 163, 184, 0.28);
                color: #f8fafc;
            }
            html[data-theme="dark"] .sw-widget-action:hover {
                background: rgba(148, 163, 184, 0.42);
            }
            #sw-minimized-bar {
                display: none;
                height: 100%;
                align-items: center;
                gap: 10px;
                padding: 0 84px 0 16px;
                color: #1e293b;
                font-weight: 600;
            }
            #sw-minimized-bar i:first-child {
                color: #0099FF;
            }
            #sw-popover.sw-minimized #sw-minimized-bar {
                display: flex;
            }
            html[data-theme="dark"] #sw-minimized-bar {
                color: #f8fafc;
            }
            html[data-theme="dark"] #sw-popover {
                background: #0A192F;
                border: 1px solid rgba(255,255,255,0.1);
            }
            
            #sw-popover.sw-show {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0);
            }

            .sw-tab-content {
                display: none;
                flex: 1;
                overflow-y: auto;
                flex-direction: column;
            }
            .sw-tab-content.sw-active {
                display: flex;
            }

            /* NAVBAR BOTTOM */
            #sw-navbar {
                display: flex;
                border-top: 1px solid rgba(0,0,0,0.08);
                background: #ffffff;
                flex-shrink: 0;
            }
            html[data-theme="dark"] #sw-navbar {
                background: #0A192F;
                border-top: 1px solid rgba(255,255,255,0.1);
            }
            .sw-nav-btn {
                flex: 1;
                padding: 12px 0;
                text-align: center;
                background: none;
                border: none;
                cursor: pointer;
                color: #64748b;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                font-size: 0.75rem;
                transition: color 0.2s;
            }
            .sw-nav-btn i { font-size: 1.1rem; }
            .sw-nav-btn:hover { color: #334155; }
            .sw-nav-btn.sw-active { color: #0099FF; font-weight: 600; }
            html[data-theme="dark"] .sw-nav-btn:hover { color: #f8fafc; }
            html[data-theme="dark"] .sw-nav-btn.sw-active { color: #0099FF; }

            /* HOME TAB */
            .sw-home-header {
                background: #0099FF;
                padding: 30px 88px 30px 20px;
                color: white;
                position: relative;
            }
            html[data-theme="dark"] .sw-home-header {
                background: #102A43;
            }
            .sw-home-greeting {
                font-size: 1.25rem;
                font-weight: bold;
                margin-bottom: 4px;
            }
            .sw-home-sub {
                font-size: 0.85rem;
                opacity: 0.9;
            }
            .sw-new-msg-btn {
                background: #1e293b;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 12px;
                width: calc(100% - 40px);
                margin: 20px auto;
                font-weight: 600;
                cursor: pointer;
                display: block;
                transition: background 0.2s;
            }
            html[data-theme="dark"] .sw-new-msg-btn { background: #102A43; }
            .sw-new-msg-btn:hover { background: #0f172a; }
            html[data-theme="dark"] .sw-new-msg-btn:hover { background: #0B2447; }
            
            .sw-topics {
                padding: 0 20px 20px;
            }
            .sw-topic-title {
                font-size: 0.8rem;
                color: #64748b;
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .sw-topic-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 16px;
                border: 1px solid rgba(0,0,0,0.08);
                border-radius: 8px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: background 0.2s;
                text-decoration: none;
                color: inherit;
            }
            html[data-theme="dark"] .sw-topic-item { border-color: rgba(255,255,255,0.1); }
            .sw-topic-item:hover { background: rgba(0,0,0,0.02); }
            html[data-theme="dark"] .sw-topic-item:hover { background: rgba(255,255,255,0.05); }
            .sw-topic-text strong { display: block; font-size: 0.9rem; margin-bottom: 2px; color: #1e293b; }
            html[data-theme="dark"] .sw-topic-text strong { color: #f8fafc; }
            .sw-topic-text span { display: block; font-size: 0.75rem; color: #64748b; }

            /* MESSAGES TAB */
            .sw-msg-header {
                padding: 16px 88px 16px 20px;
                border-bottom: 1px solid rgba(0,0,0,0.08);
                display: flex;
                align-items: center;
                justify-content: space-between;
                color: #1e293b;
            }
            html[data-theme="dark"] .sw-msg-header { border-color: rgba(255,255,255,0.1); color: #f8fafc; }
            .sw-msg-header h2 { font-size: 1.1rem; margin: 0; font-weight: 600; }
            .sw-back-btn { background: none; border: none; cursor: pointer; color: inherit; font-size: 1.1rem; padding: 0; margin-right: 12px; display: none; }
            
            .sw-ticket-list {
                padding: 16px;
                flex: 1;
                overflow-y: auto;
            }
            .sw-date-divider {
                font-size: 0.85rem;
                color: #64748b;
                text-align: center;
                margin: 20px 0 10px;
                position: relative;
                font-weight: 500;
            }
            .sw-date-divider::before, .sw-date-divider::after {
                content: '';
                position: absolute;
                top: 50%;
                width: 25%;
                height: 1px;
                background: rgba(0,0,0,0.1);
            }
            .sw-date-divider::before { left: 0; }
            .sw-date-divider::after { right: 0; }
            html[data-theme="dark"] .sw-date-divider::before, html[data-theme="dark"] .sw-date-divider::after { background: rgba(255,255,255,0.1); }
            html[data-theme="dark"] .sw-date-divider { color: #94a3b8; }
            
            .sw-ticket-card {
                padding: 12px;
                border: 1px solid rgba(0,0,0,0.08);
                border-radius: 8px;
                margin-bottom: 10px;
                cursor: pointer;
                transition: box-shadow 0.2s, background 0.2s;
                position: relative;
                color: #1e293b;
            }
            html[data-theme="dark"] .sw-ticket-card { border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.02); color: #f8fafc; }
            .sw-ticket-card:hover { box-shadow: 0 0 12px rgba(0,153,255,0.2); background: rgba(0,153,255,0.02); }
            html[data-theme="dark"] .sw-ticket-card:hover { box-shadow: 0 0 12px rgba(0,153,255,0.3); background: rgba(0,153,255,0.05); }
            .sw-ticket-title { font-size: 0.9rem; font-weight: 600; margin-bottom: 4px; }
            .sw-ticket-status { font-size: 0.7rem; padding: 2px 8px; border-radius: 99px; display: inline-block; }
            .sw-ticket-date { font-size: 0.7rem; color: #64748b; margin-top: 6px; }

            /* CHAT VIEW */
            #sw-chat-view {
                display: none;
                flex-direction: column;
                flex: 1;
                height: 100%;
            }
            .sw-chat-container {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .tc-bubble {
                max-width: 85%;
                padding: 10px 14px;
                border-radius: 12px;
                font-size: 0.85rem;
                line-height: 1.4;
                position: relative;
                word-break: break-word;
            }
            .tc-bubble-admin {
                align-self: flex-start;
                background: #e2e8f0;
                color: #1e293b;
                border-bottom-left-radius: 4px;
            }
            html[data-theme="dark"] .tc-bubble-admin { background: #102A43; color: #f8fafc; }
            .tc-bubble-client {
                align-self: flex-end;
                background: #0099FF;
                color: #ffffff;
                border-bottom-right-radius: 4px;
            }
            .tc-time { font-size: 0.65rem; opacity: 0.7; margin-top: 4px; text-align: right; }
            .sw-chat-input-area {
                padding: 12px;
                border-top: 1px solid rgba(0,0,0,0.08);
                display: flex;
                align-items: flex-end;
                gap: 8px;
            }
            html[data-theme="dark"] .sw-chat-input-area { border-color: rgba(255,255,255,0.1); }
            .tc-input {
                flex: 1;
                border: 1px solid rgba(0,0,0,0.2);
                border-radius: 20px;
                padding: 8px 14px;
                background: #ffffff;
                color: #1e293b;
                outline: none;
                font-size: 0.85rem;
                resize: none;
                max-height: 100px;
            }
            html[data-theme="dark"] .tc-input {
                background: #102A43;
                color: #f8fafc;
                border-color: rgba(255,255,255,0.2);
            }
            .tc-send-btn {
                background: #0099FF;
                color: white;
                border: none;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            /* MODAL TICKET */
            #sw-modal {
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.4);
                backdrop-filter: blur(4px);
                z-index: 10;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            html[data-theme="dark"] #sw-modal { background: rgba(0,0,0,0.6); }
            #sw-modal.sw-active { display: flex; animation: fadeIn 0.2s ease-out; }
            .sw-modal-content {
                background: #fff;
                width: 100%;
                border-radius: 16px;
                padding: 24px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.15);
                color: #1e293b;
                transform: scale(0.95);
                animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            html[data-theme="dark"] .sw-modal-content { background: #0A192F; color: #f8fafc; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
            .sw-modal-content h3 { font-size: 1.25rem; margin-top: 0; margin-bottom: 20px; font-weight: 600; text-align: center; }
            .sw-input { 
                width: 100%; 
                padding: 12px; 
                border-radius: 8px; 
                border: 1px solid rgba(0,0,0,0.2); 
                margin-bottom: 16px; 
                background: #ffffff; 
                color: #1e293b; 
                font-family: inherit;
                transition: border-color 0.2s;
            }
            textarea.sw-input {
                resize: none;
                overflow-y: auto;
                height: 120px;
            }
            html[data-theme="dark"] .sw-input { border-color: rgba(255,255,255,0.15); background: #102A43; color: #f8fafc; }
            .sw-input:focus { outline: none; border-color: #0099FF; }

            .sw-btn-cancel, .sw-btn-send {
                flex: 1;
                padding: 12px;
                border-radius: 8px;
                border: none;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s, box-shadow 0.2s;
                font-size: 0.95rem;
            }
            .sw-btn-cancel { background: #f1f5f9; color: #475569; }
            .sw-btn-cancel:hover { background: #e2e8f0; box-shadow: 0 0 10px rgba(71, 85, 105, 0.2); }
            html[data-theme="dark"] .sw-btn-cancel { background: #1e293b; color: #cbd5e1; }
            html[data-theme="dark"] .sw-btn-cancel:hover { background: #334155; box-shadow: 0 0 10px rgba(255, 255, 255, 0.1); }
            
            .sw-btn-send { background: #0099FF; color: white; }
            .sw-btn-send:hover { background: #0078D4; box-shadow: 0 0 12px rgba(0, 153, 255, 0.4); }
        </style>

        <div id="sw-root">
            <div id="sw-popover">
                <div class="sw-widget-controls">
                    <button class="sw-widget-action" id="sw-minimize-btn" onclick="supportWidget.toggleMinimized(event)" title="Minimizar">
                        <i class="fas fa-minus" id="sw-minimize-icon"></i>
                    </button>
                    <button class="sw-widget-action" onclick="supportWidget.closeWidget(event)" title="Cerrar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div id="sw-minimized-bar" onclick="supportWidget.toggleMinimized(event)">
                    <i class="fas fa-headset"></i>
                    <span>Soporte</span>
                </div>
                <div class="sw-window-content">
                <!-- TAB: HOME -->
                <div id="sw-tab-home" class="sw-tab-content sw-active">
                    <div class="sw-home-header">
                        <div class="sw-home-greeting">Hola, <span id="sw-user-name">Cargando...</span> 👋</div>
                        <div class="sw-home-sub">El equipo de soporte está aquí para ayudarte.</div>
                    </div>
                    <button id="sw-home-action-btn" class="sw-new-msg-btn" onclick="supportWidget.handleHomeAction()">Enviar un mensaje</button>
                    
                    <div class="sw-topics">
                        <div class="sw-topic-title">Temas Populares</div>
                        <a href="/docs" target="_blank" class="sw-topic-item" onclick="event.preventDefault(); supportWidget.toggleOpen(); navigate('/docs');">
                            <div class="sw-topic-text">
                                <strong>Preguntas Frecuentes</strong>
                                <span>Respuestas a dudas comunes y tutoriales</span>
                            </div>
                            <i class="fas fa-chevron-right" style="color: #64748b;"></i>
                        </a>
                    </div>
                </div>

                <!-- TAB: MESSAGES -->
                <div id="sw-tab-messages" class="sw-tab-content">
                    <div class="sw-msg-header">
                        <div style="display:flex; align-items:center;">
                            <button id="sw-back-btn" class="sw-back-btn" onclick="supportWidget.closeChat()"><i class="fas fa-arrow-left"></i></button>
                            <h2 id="sw-msg-title">Mis Tickets</h2>
                        </div>
                    </div>
                    
                    <!-- Lista de Tickets -->
                    <div id="sw-ticket-list-view" class="sw-ticket-list">
                        <div id="sw-tickets-container" style="text-align:center; padding:20px; color:#64748b; font-size:0.9rem;">Cargando...</div>
                    </div>

                    <!-- Vista Chat -->
                    <div id="sw-chat-view">
                        <div id="sw-chat-messages" class="sw-chat-container"></div>
                        <div class="sw-chat-input-area">
                            <textarea id="sw-chat-input" class="tc-input" rows="1" placeholder="Escribí un mensaje..."></textarea>
                            <button id="sw-chat-send" class="tc-send-btn" onclick="supportWidget.sendMessage()"><i class="fas fa-paper-plane"></i></button>
                        </div>
                    </div>
                </div>

                <!-- NAVBAR -->
                <div id="sw-navbar">
                    <button class="sw-nav-btn sw-active" id="sw-nav-home" onclick="supportWidget.switchTab('home')">
                        <i class="fas fa-home"></i> Home
                    </button>
                    <button class="sw-nav-btn" id="sw-nav-messages" onclick="supportWidget.switchTab('messages')">
                        <i class="fas fa-comment-dots"></i> Mensajes
                    </button>
                </div>

                <!-- MODAL NUEVO TICKET -->
                <div id="sw-modal">
                    <div class="sw-modal-content">
                        <h3>Nuevo Ticket de Soporte</h3>
                        <input type="text" id="sw-titulo" class="sw-input" placeholder="Asunto (Ej: Problema con bot)">
                        <textarea id="sw-desc" class="sw-input" placeholder="Describe tu consulta..."></textarea>
                        <div style="display:flex; gap:12px;">
                            <button class="sw-btn-cancel" onclick="supportWidget.closeModal()">Cancelar</button>
                            <button class="sw-btn-send" onclick="supportWidget.submitTicket()">Enviar</button>
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
        `;
        document.body.appendChild(container);

        // Bind enter key
        const input = document.getElementById('sw-chat-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    supportWidget.sendMessage();
                }
            });
        }
    }

    function toggleOpen() {
        if (_isOpen && _isMinimized) {
            _setMinimized(false);
            _syncSidebarTrigger();
            return;
        }

        _isOpen = !_isOpen;
        const popover = document.getElementById('sw-popover');
        
        if (_isOpen) {
            _setMinimized(false);
            popover.classList.add('sw-show');
            _fetchAll();
        } else {
            _setMinimized(false);
            popover.classList.remove('sw-show');
            _updateBadge(); // restore badge if needed
        }
        _syncSidebarTrigger();
    }

    function closeWidget(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        _isOpen = false;
        const popover = document.getElementById('sw-popover');
        if (popover) popover.classList.remove('sw-show');
        _updateBadge();
        _syncSidebarTrigger();
    }

    function toggleMinimized(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!_isOpen) return;
        _setMinimized(!_isMinimized);
    }

    function _setMinimized(minimized) {
        _isMinimized = minimized;
        const popover = document.getElementById('sw-popover');
        const icon = document.getElementById('sw-minimize-icon');
        const btn = document.getElementById('sw-minimize-btn');
        if (popover) popover.classList.toggle('sw-minimized', _isMinimized);
        if (icon) icon.className = _isMinimized ? 'fas fa-chevron-up' : 'fas fa-minus';
        if (btn) btn.title = _isMinimized ? 'Expandir' : 'Minimizar';
    }

    function switchTab(tabId) {
        _activeTab = tabId;
        document.querySelectorAll('.sw-nav-btn').forEach(b => b.classList.remove('sw-active'));
        document.getElementById(`sw-nav-${tabId}`).classList.add('sw-active');

        document.querySelectorAll('.sw-tab-content').forEach(t => t.classList.remove('sw-active'));
        document.getElementById(`sw-tab-${tabId}`).classList.add('sw-active');

        if (tabId === 'messages') {
            const openTicket = _activeTicketsCache && _activeTicketsCache.find(t => t.estado === 'Abierto');
            if (openTicket && !_activeTicket) {
                openChat(openTicket.id);
            } else if (!_activeTicket) {
                _fetchAll();
            }
        }
    }

    function handleHomeAction() {
        const openTicket = _activeTicketsCache && _activeTicketsCache.find(t => t.estado === 'Abierto');
        if (openTicket) {
            switchTab('messages');
            openChat(openTicket.id);
        } else {
            openModal();
        }
    }

    function openModal() {
        document.getElementById('sw-modal').classList.add('sw-active');
        document.getElementById('sw-titulo').value = '';
        document.getElementById('sw-desc').value = '';
    }

    function closeModal() {
        document.getElementById('sw-modal').classList.remove('sw-active');
    }

    async function submitTicket() {
        const titulo = document.getElementById('sw-titulo').value.trim();
        const descripcion = document.getElementById('sw-desc').value.trim();
        if (!titulo) { showToast && showToast('El asunto es obligatorio', 'error'); return; }

        try {
            const res = await fetch(`/api/backoffice/tickets?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titulo, descripcion, chats_adjuntos: [] })
            });
            if (res.ok) {
                showToast && showToast('Mensaje enviado');
                closeModal();
                switchTab('messages');
                _fetchAll();
            } else {
                showToast && showToast('Error al enviar', 'error');
            }
        } catch (e) {
            showToast && showToast('Error de conexión', 'error');
        }
    }

    async function _loadChats() {
        try {
            const res = await fetch(`/api/backoffice/chats?token=${_token}&limit=200`);
            const data = await res.json();
            _chats = Array.isArray(data) ? data : (data.chats || []);
        } catch (e) {
            _chats = [];
        }
    }

    async function _fetchAll() {
        try {
            const resP = await fetch(`/api/backoffice/tickets?token=${_token}`);
            const resC = await fetch(`/api/backoffice/tickets?token=${_token}&estado=Cerrado`);
            let pending = await resP.json();
            let closed = await resC.json();
            
            pending = Array.isArray(pending) ? pending.filter(t => t.tipo === 'Soporte') : [];
            closed = Array.isArray(closed) ? closed.filter(t => t.tipo === 'Soporte') : [];
            
            const tickets = [...pending, ...closed];
            _activeTicketsCache = tickets;

            const container = document.getElementById('sw-tickets-container');
            if (!container) return;

            if (tickets.length === 0) {
                container.innerHTML = `
                    <div style="margin-top:40px;">
                        <i class="fas fa-inbox" style="font-size:3rem; opacity:0.3; margin-bottom:16px;"></i>
                        <br><strong>No hay mensajes</strong><br>
                        <span style="font-size:0.8rem; opacity:0.7;">Solo los mensajes de soporte aparecerán aquí.</span>
                    </div>`;
                _updateBadge();
                return;
            }

            tickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const grouped = tickets.reduce((acc, t) => {
                const dateStr = new Date(t.created_at).toLocaleDateString('es-AR');
                if (!acc[dateStr]) acc[dateStr] = [];
                acc[dateStr].push(t);
                return acc;
            }, {});

            let html = '';
            for (const [date, tks] of Object.entries(grouped)) {
                html += `<div class="sw-date-divider">${date}</div>`;
                html += tks.map(t => _renderCard(t)).join('');
            }
            container.innerHTML = html;
            
            const openTicket = tickets.find(t => t.estado === 'Abierto');
            const homeBtn = document.getElementById('sw-home-action-btn');
            if (homeBtn) {
                homeBtn.innerText = openTicket ? 'Ver Ticket' : 'Enviar un mensaje';
            }

            if (_activeTab === 'messages' && openTicket && !_activeTicket) {
                openChat(openTicket.id);
            }

            _updateBadge();
        } catch (e) {
            console.error(e);
        }
    }

    function _renderCard(t) {
        const date = new Date(t.created_at).toLocaleDateString('es-AR');
        let chatsAdj = _parseJson(t.chats_adjuntos, []);
        let needsResponse = false;
        if (chatsAdj.length > 0) {
            const lastMsg = chatsAdj[chatsAdj.length - 1];
            if (lastMsg.rol === 'admin') needsResponse = true;
        }

        const statusColor = { 'Abierto': '#ef4444', 'Cerrado': '#22c55e' }[t.estado] || '#64748b';
        const statusBg = { 'Abierto': 'rgba(239,68,68,0.12)', 'Cerrado': 'rgba(34,197,94,0.12)' }[t.estado] || 'rgba(0,0,0,0.05)';

        return `
            <div class="sw-ticket-card" onclick="supportWidget.openChat('${t.id}')">
                ${needsResponse && t.estado !== 'Cerrado' ? `<span style="position:absolute; top:-2px; right:-2px; width:12px; height:12px; background:#ef4444; border-radius:50%;"></span>` : ''}
                <div class="sw-ticket-title">${t.titulo}</div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="sw-ticket-status" style="color:${statusColor}; background:${statusBg};">${t.estado}</span>
                    <span class="sw-ticket-date">${date}</span>
                </div>
            </div>`;
    }

    function _updateBadge() {
        const badge = document.getElementById('sw-badge');
        const sidebarBadge = document.getElementById('dot-support-widget');
        const hasUnread = _activeTicketsCache.some(t => {
            let chatsAdj = _parseJson(t.chats_adjuntos, []);
            if (chatsAdj.length > 0 && t.estado !== 'Cerrado') {
                return chatsAdj[chatsAdj.length - 1].rol === 'admin';
            }
            return false;
        });
        const display = (hasUnread && !_isOpen) ? 'inline-block' : 'none';
        if (badge) badge.style.display = display === 'none' ? 'none' : 'block';
        if (sidebarBadge) sidebarBadge.style.display = display;
    }

    function _syncSidebarTrigger() {
        const item = document.getElementById('nav-support-btn');
        if (item) item.classList.toggle('active', _isOpen);
    }

    function openChat(ticketId) {
        _activeTicket = _activeTicketsCache.find(t => t.id === ticketId);
        if (!_activeTicket) return;

        document.getElementById('sw-ticket-list-view').style.display = 'none';
        document.getElementById('sw-chat-view').style.display = 'flex';
        document.getElementById('sw-back-btn').style.display = 'block';
        
        _updateChatUI();
    }

    async function closeChat() {
        if (!_activeTicket) return;
        
        if (_activeTicket.estado === 'Abierto') {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const result = await Swal.fire({
                title: '¿Cerrar Ticket?',
                text: "Al salir del ticket este se marcará como concluido. ¿Deseas continuar?",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#0099FF',
                cancelButtonColor: isDark ? '#334155' : '#64748b',
                confirmButtonText: 'Sí, concluir',
                cancelButtonText: 'Cancelar',
                background: isDark ? '#102A43' : '#ffffff',
                color: isDark ? '#f8fafc' : '#1e293b'
            });

            if (!result.isConfirmed) return;
            
            try {
                let currentChats = _parseJson(_activeTicket.chats_adjuntos, []);
                currentChats.push({
                    rol: 'cliente',
                    mensaje: 'Ticket cerrado por el usuario.',
                    timestamp: new Date().toISOString()
                });
                
                await fetch(`/api/backoffice/tickets/${_activeTicket.id}?token=${_token}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        estado: 'Cerrado',
                        chats_adjuntos: JSON.stringify(currentChats)
                    })
                });
            } catch (e) {
                console.error("Error al cerrar el ticket:", e);
            }
        }

        _activeTicket = null;
        document.getElementById('sw-chat-view').style.display = 'none';
        document.getElementById('sw-ticket-list-view').style.display = 'block';
        document.getElementById('sw-back-btn').style.display = 'none';
        document.getElementById('sw-msg-title').innerText = 'Mis Tickets';
        _fetchAll();
    }

    function _updateChatUI() {
        if (!_activeTicket) return;
        
        document.getElementById('sw-msg-title').innerText = _activeTicket.titulo.length > 20 ? _activeTicket.titulo.substring(0, 20) + '...' : _activeTicket.titulo;
        
        const isCerrado = _activeTicket.estado === 'Cerrado';
        document.getElementById('sw-chat-input').disabled = isCerrado;
        document.getElementById('sw-chat-send').disabled = isCerrado;
        document.getElementById('sw-chat-input').placeholder = isCerrado ? "Ticket cerrado." : "Escribí un mensaje...";

        _renderChatMessages();
    }

    function _renderChatMessages() {
        const container = document.getElementById('sw-chat-messages');
        if (!container || !_activeTicket) return;

        let chats = _parseJson(_activeTicket.chats_adjuntos, []);
        chats = chats.filter(c => c.rol && (c.mensaje || c.attachmentUrl));

        let html = '';
        if (_activeTicket.descripcion) {
            html += `
                <div class="tc-bubble tc-bubble-client">
                    <div>${_activeTicket.descripcion.replace(/\\n/g, '<br>')}</div>
                    <div class="tc-time">Ticket inicial</div>
                </div>
            `;
        }

        if (chats.length === 0 && !_activeTicket.descripcion) {
            html = `<div style="text-align:center; color:#64748b; margin-top:20px;">Sin historial. Empezá a chatear.</div>`;
        } else {
            chats.forEach(msg => {
                const isAdmin = msg.rol === 'admin';
                const bubbleClass = isAdmin ? 'tc-bubble-admin' : 'tc-bubble-client';
                const msgTime = msg.timestamp || msg.fecha;
                const timeStr = msgTime ? new Date(msgTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute:'2-digit' }) : '';
                html += `
                    <div class="tc-bubble ${bubbleClass}">
                        ${isAdmin ? '<div style="font-size:0.65rem; opacity:0.8; margin-bottom:2px; font-weight:bold;">Soporte</div>' : ''}
                        ${msg.mensaje ? `<div>${msg.mensaje.replace(/\\n/g, '<br>')}</div>` : ''}
                        <div class="tc-time">${timeStr}</div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    }

    async function sendMessage() {
        if (!_activeTicket || _activeTicket.estado === 'Cerrado') return;
        
        const input = document.getElementById('sw-chat-input');
        const text = input.value.trim();
        if (!text) return;

        input.disabled = true;
        document.getElementById('sw-chat-send').disabled = true;

        let currentChats = _parseJson(_activeTicket.chats_adjuntos, []);
        
        currentChats.push({
            rol: 'cliente',
            mensaje: text,
            timestamp: new Date().toISOString()
        });

        try {
            const res = await fetch(`/api/backoffice/tickets/${_activeTicket.id}?token=${_token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chats_adjuntos: JSON.stringify(currentChats)
                }) 
            });

            if (res.ok) {
                _activeTicket.chats_adjuntos = JSON.stringify(currentChats);
                input.value = '';
                _renderChatMessages();
            } else {
                showToast && showToast('Error al enviar mensaje', 'error');
            }
        } catch (e) {
            showToast && showToast('Error de conexión', 'error');
        } finally {
            input.disabled = false;
            document.getElementById('sw-chat-send').disabled = false;
            input.focus();
        }
    }

    function _parseJson(val, fallback) {
        if (!val) return fallback;
        if (typeof val !== 'string') return val;
        try { return JSON.parse(val); } catch { return fallback; }
    }

    return {
        init,
        toggleOpen,
        switchTab,
        openModal,
        closeModal,
        submitTicket,
        openChat,
        closeChat,
        sendMessage,
        handleHomeAction,
        closeWidget,
        toggleMinimized
    };
})();
