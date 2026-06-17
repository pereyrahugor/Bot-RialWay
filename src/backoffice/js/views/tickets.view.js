
/* global showToast, navigate */
/* eslint-disable no-undef */
window.ticketsView = (() => {
    let _token = '';

    function getHTML() {
        return `
        <style>
            #tv-columns {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                align-items: start;
                min-width: 0;
            }
            @media (max-width: 1024px) {
                #tv-columns { grid-template-columns: 1fr; }
            }
            .tv-scroll-row {
                display: flex;
                flex-direction: row;
                overflow-x: auto;
                gap: 12px;
                padding-bottom: 10px;
                scroll-snap-type: x mandatory;
                -webkit-overflow-scrolling: touch;
                scrollbar-width: thin;
                scrollbar-color: rgba(0,153,255,0.3) transparent;
            }
            .tv-list-wrapper {
                min-height: 120px;
                min-width: 0;
                width: 100%;
            }
            @media (min-width: 1025px) {
                .tv-list-wrapper {
                    height: 400px;
                    display: flex;
                    flex-direction: column;
                }
                .tv-scroll-row {
                    flex-direction: column;
                    overflow-x: hidden;
                    overflow-y: auto;
                    height: 100%;
                    max-height: none;
                    scroll-snap-type: y mandatory;
                    padding-right: 8px;
                }
            }
            .tv-scroll-row::-webkit-scrollbar { height: 4px; width: 4px; }
            .tv-scroll-row::-webkit-scrollbar-track { background: transparent; }
            .tv-scroll-row::-webkit-scrollbar-thumb { background: rgba(0,153,255,0.3); border-radius: 2px; }
            .tv-card {
                flex: 0 0 clamp(180px, 70vw, 220px);
                scroll-snap-align: start;
                background: #f8fafc;
                border: 1px solid rgba(0,0,0,0.08);
                border-radius: 12px;
                padding: 16px 14px;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                gap: 6px;
                min-width: 0;
            }
            html[data-theme="dark"] .tv-card, html.dark .tv-card {
                background: rgba(16,42,67,0.65);
                border: 1px solid rgba(0,153,255,0.12);
            }
            @media (min-width: 1025px) {
                .tv-card {
                    flex: 0 0 auto;
                    width: 100%;
                    align-items: flex-start;
                    text-align: left;
                }
                .tv-card-attachments, .tv-card-chips {
                    justify-content: flex-start;
                }
            }
            .tv-card-title {
                font-size: 0.85rem;
                font-weight: 700;
                color: var(--text-main);
                word-break: break-word;
                line-height: 1.3;
            }
            .tv-card-desc {
                font-size: 0.78rem;
                color: var(--text-muted);
                line-height: 1.45;
                word-break: break-word;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .tv-card-date {
                font-size: 0.7rem;
                color: var(--text-muted);
                margin-top: auto;
                padding-top: 6px;
            }
            .tv-card-badge {
                font-size: 0.68rem;
                font-weight: 700;
                font-family: 'Montserrat', sans-serif;
                padding: 3px 10px;
                border-radius: 99px;
            }
            .tv-card-attachments {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                justify-content: center;
                margin-top: 4px;
            }
            .tv-card-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                justify-content: center;
                margin-top: 2px;
            }
            .tv-col-box {
                border: 1px solid rgba(0,153,255,0.12);
                border-radius: 14px;
                padding: 18px 16px;
                min-width: 0;
            }
            #tv-modal.modal-overlay {
                align-items: flex-start;
                overflow-y: auto;
                padding: 64px 0 24px;
            }
            #tv-modal .modal-content {
                max-height: none !important;
                overflow-y: visible !important;
                margin-bottom: 0 !important;
            }

            /* Estilos para la Vista Chat del Ticket */
            .tc-chat-container {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .tc-bubble {
                max-width: 80%;
                padding: 12px 16px;
                border-radius: 12px;
                font-size: 0.9rem;
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
            html.dark .tc-bubble-admin {
                background: #334155;
                color: #f8fafc;
            }
            .tc-bubble-client {
                align-self: flex-end;
                background: #0099FF;
                color: #ffffff;
                border-bottom-right-radius: 4px;
            }
            .tc-time {
                font-size: 0.65rem;
                opacity: 0.7;
                margin-top: 4px;
                text-align: right;
            }
            .tc-input-area {
                padding: 16px;
                border-top: 1px solid var(--border);
                display: flex;
                gap: 10px;
            }
            .tc-input {
                flex: 1;
                border: 1px solid var(--border);
                border-radius: 20px;
                padding: 10px 16px;
                background: transparent;
                color: var(--text-main);
                outline: none;
            }
            .tc-send-btn {
                background: #0099FF;
                color: white;
                border: none;
                width: 42px;
                height: 42px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: transform 0.2s;
            }
            .tc-send-btn:hover { transform: scale(1.05); }
            .tc-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .tv-card { cursor: pointer; transition: transform 0.2s; }
            .tv-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

            /* Fix para vista Mobile del Chat */
            @media (max-width: 768px) {
                #tv-chat-view { padding: 0 !important; }
                .tv-chat-inner { border: none !important; border-radius: 0 !important; }
                .kanban-header { padding: 12px 16px !important; }
                .tc-input-area { 
                    padding: 6px !important; 
                    gap: 4px !important; 
                }
                .tc-send-btn {
                    width: 34px !important;
                    height: 34px !important;
                }
                .tc-send-btn i {
                    font-size: 0.85rem;
                }
                #tc-title {
                    font-size: 0.9rem !important;
                    gap: 6px !important;
                }
                #tc-title i {
                    font-size: 0.85rem !important;
                }
                #tc-status {
                    font-size: 0.55rem !important;
                    padding: 2px 8px !important;
                }
            }
        </style>

        <main class="crm-main-container" style="z-index:10; padding:0; height: 100%; display: flex; flex-direction: column;">
            
            <!-- VISTA: KANBAN -->
            <div id="tv-list-view" style="display:flex; flex-direction:column; height: 100%;">
                <div class="kanban-header animate-fade">
                    <div class="header-info">
                        <h1>
                            <i class="fas fa-ticket-alt kanban-header-icon" style="color:#0099FF;"></i>
                            Tickets de Soporte
                        </h1>
                        <p>Reportá problemas o consultas y seguí su estado</p>
                    </div>
                    <button class="btn-primary" onclick="ticketsView._openModal()" style="display:flex; align-items:center; gap:8px; padding:8px 18px; font-size:0.85rem; flex-shrink:0;">
                        <i class="fas fa-plus"></i> Nuevo
                    </button>
                </div>

                <div class="meta-view-body" style="padding:20px 24px; flex:1; overflow-y:auto;">
                    <div id="tv-columns">
                        <!-- Columna Pendientes -->
                        <div class="tv-col-box bg-white dark:bg-[#102a43a6]">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-bottom:10px; border-bottom:2px solid #ef4444;">
                                <span style="width:8px; height:8px; border-radius:50%; background:#ef4444; flex-shrink:0;"></span>
                                <h3 style="margin:0; font-size:0.82rem; font-weight:700; font-family:'Montserrat',sans-serif; text-transform:uppercase; letter-spacing:1px; color:var(--text-main);">Pendientes</h3>
                                <span id="tv-count-pending" style="margin-left:auto; font-size:0.75rem; color:var(--text-muted);"></span>
                            </div>
                            <div id="tv-list-pending" class="tv-list-wrapper">
                                <div style="text-align:center; color:var(--text-muted); font-size:0.82rem; height:100%; display:flex; align-items:center; justify-content:center;">Cargando...</div>
                            </div>
                        </div>

                        <!-- Columna Cerrados -->
                        <div class="tv-col-box bg-white dark:bg-[#102a43a6]">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-bottom:10px; border-bottom:2px solid #22c55e;">
                                <span style="width:8px; height:8px; border-radius:50%; background:#22c55e; flex-shrink:0;"></span>
                                <h3 style="margin:0; font-size:0.82rem; font-weight:700; font-family:'Montserrat',sans-serif; text-transform:uppercase; letter-spacing:1px; color:var(--text-main);">Cerrados</h3>
                                <span id="tv-count-closed" style="margin-left:auto; font-size:0.75rem; color:var(--text-muted);"></span>
                            </div>
                            <div id="tv-list-closed" class="tv-list-wrapper">
                                <div style="text-align:center; color:var(--text-muted); font-size:0.82rem; height:100%; display:flex; align-items:center; justify-content:center;">Cargando...</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- VISTA: CHAT DINÁMICO -->
            <div id="tv-chat-view" class="animate-fade" style="display:none; height: 100%; flex-direction: row; flex: 1; padding: 20px 24px;">
                <div class="tv-chat-inner bg-white dark:bg-[#102a43a6]" style="flex: 1; display: flex; flex-direction: column; min-width: 0; border: 1px solid rgba(0,153,255,0.12); border-radius: 14px; overflow: hidden;">
                    <div class="kanban-header" style="border-bottom:1px solid rgba(0,153,255,0.1); padding: 12px 24px;">
                        <button class="btn-icon" onclick="ticketsView._goBack()" style="margin-right:12px; font-size:1.1rem; color: var(--text-main);">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                        <div class="header-info" style="flex:1;">
                            <h1 id="tc-title" style="margin-bottom:0; font-size:1.1rem; display:flex; align-items:center; gap:12px; min-width:0;">
                                <div style="display:flex; align-items:center; min-width:0; flex:1;">
                                    <i class="fas fa-ticket-alt" style="color:#0099FF; margin-right:6px; flex-shrink:0;"></i> 
                                    <span id="tc-title-text" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Cargando...</span>
                                </div>
                                <span id="tc-status" class="tv-card-badge" style="font-size:0.65rem; flex-shrink:0;"></span>
                            </h1>
                        </div>
                    </div>
                    <div id="tc-messages" class="tc-chat-container">
                        <!-- Mensajes dinámicos -->
                    </div>
                    <div class="tc-input-area">
                        <input type="text" id="tc-input" class="tc-input" placeholder="Escribí un mensaje..." onkeypress="if(event.key === 'Enter') ticketsView._sendMessage()">
                        <button id="tc-send-btn" class="tc-send-btn" onclick="ticketsView._sendMessage()">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Modal -->
            <div id="tv-modal" class="modal-overlay">
                <div class="modal-content animate-pop-in">
                    <div class="modal-header">
                        <h3><i class="fas fa-ticket-alt modal-h3-icon"></i> Nuevo Ticket de Soporte</h3>
                        <button class="btn-close-modal" onclick="ticketsView._closeModal()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body">
                        <div class="modal-section">
                            <label><i class="fas fa-heading"></i> Asunto</label>
                            <input type="text" id="tv-titulo" class="crm-input" placeholder="Ej: El bot no responde correctamente">
                        </div>
                        <div class="modal-section">
                            <label><i class="fas fa-align-left"></i> Descripcion</label>
                            <textarea id="tv-desc" class="crm-input" rows="4" placeholder="Describí el problema con el mayor detalle posible..."></textarea>
                        </div>
                        <button class="btn-primary btn-full-mt" onclick="ticketsView._submit()">
                            <i class="fas fa-save icon-mr"></i> Enviar Ticket
                        </button>
                    </div>
                </div>
            </div>
        </main>
        `;
    }

    let _chats = [];

    let _socketBound = false;

    async function init(token) {
        _token = (typeof token === 'string' && token && token !== 'undefined') ? token : '';
        if (!_token) {
            _token = (typeof window.getAuthToken === 'function' ? decodeURIComponent(window.getAuthToken()) : '') || localStorage.getItem('backoffice_token') || '';
        }
        if (_token === 'undefined') _token = '';
        _loadChats();
        _fetchAll();

        // Bind socket events for real-time chat updates
        if (!_socketBound && typeof io !== 'undefined') {
            _socketBound = true;
            // Use existing socket from backoffice if available, otherwise create a new one
            const s = typeof socket !== 'undefined' ? socket : (typeof window.crmSocket !== 'undefined' ? window.crmSocket : io());
            
            s.on('ticket_updated', async (payload) => {
                await _fetchAll();
                
                if (_activeTicket && payload && payload.id === _activeTicket.id) {
                    const updatedTicket = _activeTicketsCache.find(x => x.id === _activeTicket.id);
                    if (updatedTicket) {
                        _activeTicket = updatedTicket;
                        _updateChatUI();
                    }
                }
            });
        }
    }

    async function _loadChats() {
        try {
            const res = await fetch(`/api/backoffice/chats?token=${_token}&limit=200`);
            const data = await res.json();
            _chats = Array.isArray(data) ? data : (data.chats || []);
        } catch (e) {
            _chats = typeof window.chats !== 'undefined' ? window.chats : [];
        }
    }

    async function _fetchAll() {
        _fetchColumn('pending');
        _fetchColumn('Cerrado');
    }

    let _activeTicket = null;
    let _activeTicketsCache = []; // Para buscar el ticket rápido

    async function _fetchColumn(filter) {
        const listId = filter === 'pending' ? 'tv-list-pending' : 'tv-list-closed';
        const countId = filter === 'pending' ? 'tv-count-pending' : 'tv-count-closed';
        const list = document.getElementById(listId);
        if (!list) return;

        const estadoParam = filter === 'pending' ? '' : `&estado=${filter}`;
        try {
            const res = await fetch(`/api/backoffice/tickets?token=${_token}${estadoParam}`);
            let tickets = await res.json();
            
            if (Array.isArray(tickets)) {
                tickets = tickets.filter(t => t.tipo === 'Soporte');
                tickets.forEach(t => {
                    const idx = _activeTicketsCache.findIndex(x => x.id === t.id);
                    if (idx >= 0) _activeTicketsCache[idx] = t;
                    else _activeTicketsCache.push(t);
                });
            }
            
            const count = document.getElementById(countId);

            if (!Array.isArray(tickets) || tickets.length === 0) {
                if (count) count.textContent = '0';
                list.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.82rem; height:100%; display:flex; align-items:center; justify-content:center;">Sin tickets</div>`;
                return;
            }

            if (count) count.textContent = tickets.length;
            list.innerHTML = `<div class="tv-scroll-row">${tickets.map(t => _renderCard(t)).join('')}</div>`;
        } catch (e) {
            console.error('[TicketsView]', e);
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#f87171; font-size:0.82rem;">Error al cargar</div>';
        }
    }

    function _renderCard(t) {
        const date = new Date(t.created_at).toLocaleDateString('es-AR');
        const attachments = _parseJson(t.attachments, []);
        let chatsAdj = _parseJson(t.chats_adjuntos, []);
        
        let needsResponse = false;
        if (chatsAdj.length > 0) {
            const lastMsg = chatsAdj[chatsAdj.length - 1];
            if (lastMsg.rol === 'admin') {
                needsResponse = true;
            }
        }

        const statusColor = { 'Abierto': '#ef4444', 'Cerrado': '#22c55e' }[t.estado] || 'var(--text-muted)';
        const statusBg = { 'Abierto': 'rgba(239,68,68,0.12)', 'Cerrado': 'rgba(34,197,94,0.12)' }[t.estado] || 'rgba(255,255,255,0.05)';

        const chips = chatsAdj.filter(c => c.name || c.chat_id);

        const attachHtml = attachments.length ? `
            <div class="tv-card-attachments">
                ${attachments.map(url => `
                    <a href="${url}" target="_blank" onclick="event.stopPropagation()" style="width:44px; height:44px; border-radius:6px; overflow:hidden; border:1px solid var(--border); display:block; flex-shrink:0;">
                        <img src="${url}" style="width:100%; height:100%; object-fit:cover;"
                             onerror="this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;\\'><i class=\\'fas fa-file\\' style=\\'color:var(--text-muted);font-size:0.9rem;\\'></i></div>'">
                    </a>`).join('')}
            </div>` : '';

        const chatsAdjHtml = chips.length ? `
            <div class="tv-card-chips">
                ${chips.map(c => `
                    <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 7px; border-radius:99px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); font-size:0.68rem; color:#0099FF;">
                        <i class="fas fa-link" style="font-size:0.6rem;"></i>Vinculado
                    </span>`).join('')}
            </div>` : '';

        return `
            <div class="tv-card" onclick="ticketsView._openChat('${t.id}')" style="position:relative;">
                ${needsResponse && t.estado !== 'Cerrado' ? `<span style="position:absolute; top:-5px; right:-5px; width:14px; height:14px; background:#ef4444; border-radius:50%; border:2px solid var(--bg-card); z-index:5;"></span>` : ''}
                <span class="tv-card-badge" style="color:${statusColor}; background:${statusBg};">${t.estado}</span>
                <div class="tv-card-title">${t.titulo}</div>
                ${t.descripcion ? `<div class="tv-card-desc">${t.descripcion}</div>` : ''}
                ${chatsAdjHtml}
                ${attachHtml}
                <div class="tv-card-date"><i class="far fa-calendar-alt" style="margin-right:3px;"></i>${date}</div>
            </div>`;
    }

    function _openModal() {
        _files = [];
        const modal = document.getElementById('tv-modal');
        if (modal) modal.classList.add('active');
        const titulo = document.getElementById('tv-titulo');
        if (titulo) { titulo.value = ''; titulo.focus(); }
        const desc = document.getElementById('tv-desc');
        if (desc) desc.value = '';
        const chips = document.getElementById('tv-chat-chips');
        if (chips) chips.innerHTML = '';
        const preview = document.getElementById('tv-file-preview');
        if (preview) preview.innerHTML = '';
        const search = document.getElementById('tv-chat-search');
        if (search) search.value = '';
        const files = document.getElementById('tv-files');
        if (files) files.value = '';
    }

    function _closeModal() {
        const modal = document.getElementById('tv-modal');
        if (modal) modal.classList.remove('active');
        const sugg = document.getElementById('tv-chat-suggestions');
        if (sugg) sugg.style.display = 'none';
    }



    async function _submit() {
        const titulo = (document.getElementById('tv-titulo')?.value || '').trim();
        const descripcion = (document.getElementById('tv-desc')?.value || '').trim();
        if (!titulo) { showToast && showToast('El asunto es obligatorio', 'error'); return; }

        try {
            const res = await fetch(`/api/backoffice/tickets?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titulo, descripcion, chats_adjuntos: [] })
            });
            if (res.ok) {
                showToast && showToast('Ticket enviado correctamente');
                _closeModal();
                _fetchAll();
            } else {
                showToast && showToast('Error al enviar ticket', 'error');
            }
        } catch (e) {
            showToast && showToast('Error de conexión', 'error');
        }
    }

    function _parseJson(val, fallback) {
        if (!val) return fallback;
        if (typeof val !== 'string') return val;
        try { return JSON.parse(val); } catch { return fallback; }
    }

    function destroy() {}

    function _openChat(ticketId) {
        _activeTicket = _activeTicketsCache.find(t => t.id === ticketId);
        if (!_activeTicket) return;

        document.getElementById('tv-list-view').style.display = 'none';
        document.getElementById('tv-chat-view').style.display = 'flex';

        _updateChatUI();
    }

    function _updateChatUI() {
        if (!_activeTicket) return;
        
        document.getElementById('tc-title-text').innerText = _activeTicket.titulo;
        
        const statusColor = { 'Abierto': '#ef4444', 'Cerrado': '#22c55e' }[_activeTicket.estado] || 'var(--text-muted)';
        const statusBg = { 'Abierto': 'rgba(239,68,68,0.12)', 'Cerrado': 'rgba(34,197,94,0.12)' }[_activeTicket.estado] || 'rgba(255,255,255,0.05)';
        document.getElementById('tc-status').style.color = statusColor;
        document.getElementById('tc-status').style.background = statusBg;
        document.getElementById('tc-status').innerText = _activeTicket.estado;

        const isCerrado = _activeTicket.estado === 'Cerrado';
        document.getElementById('tc-input').disabled = isCerrado;
        document.getElementById('tc-send-btn').disabled = isCerrado;
        document.getElementById('tc-input').placeholder = isCerrado ? "Ticket cerrado." : "Escribí un mensaje...";

        _renderChatMessages();
    }


    function _goBack() {
        _activeTicket = null;
        document.getElementById('tv-chat-view').style.display = 'none';
        document.getElementById('tv-list-view').style.display = 'flex';
        _fetchAll();
    }

    function _renderChatMessages() {
        const container = document.getElementById('tc-messages');
        if (!container || !_activeTicket) return;

        let chats = _parseJson(_activeTicket.chats_adjuntos, []);
        chats = chats.filter(c => c.rol && (c.mensaje || c.attachmentUrl));

        let html = '';
        
        if (_activeTicket.descripcion) {
            html += `
                <div class="tc-bubble tc-bubble-client">
                    <div>${_activeTicket.descripcion.replace(/\n/g, '<br>')}</div>
                    <div class="tc-time">Ticket inicial</div>
                </div>
            `;
        }

        if (chats.length === 0 && !_activeTicket.descripcion) {
            html = `<div style="text-align:center; color:var(--text-muted); margin-top:20px;">Sin historial. Empezá a chatear.</div>`;
        } else {
            chats.forEach(msg => {
                const isAdmin = msg.rol === 'admin';
                const bubbleClass = isAdmin ? 'tc-bubble-admin' : 'tc-bubble-client';
                const msgTime = msg.timestamp || msg.fecha;
                const timeStr = msgTime ? new Date(msgTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute:'2-digit' }) : '';
                html += `
                    <div class="tc-bubble ${bubbleClass}">
                        ${isAdmin ? '<div style="font-size:0.7rem; opacity:0.8; margin-bottom:4px; font-weight:bold;">Soporte Técnico</div>' : ''}
                        ${msg.mensaje ? `<div>${msg.mensaje.replace(/\n/g, '<br>')}</div>` : ''}
                        <div class="tc-time">${timeStr}</div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight;
    }

    async function _sendMessage() {
        if (!_activeTicket || _activeTicket.estado === 'Cerrado') return;
        
        const input = document.getElementById('tc-input');
        const text = input.value.trim();
        if (!text) return;

        input.disabled = true;
        document.getElementById('tc-send-btn').disabled = true;

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
            document.getElementById('tc-send-btn').disabled = false;
            input.focus();
        }
    }

    return {
        title: 'Tickets',
        getHTML,
        init,
        destroy,
        _fetchAll,
        _openModal,
        _closeModal,
        _submit,
        _openChat,
        _goBack,
        _sendMessage
    };
})();
