
/* global showToast, navigate */
/* eslint-disable no-undef */
window.ticketsView = (() => {
    let _token = '';
    let _selectedChats = [];
    let _files = [];

    function getHTML() {
        return `
        <style>
            #tv-columns {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                align-items: start;
            }
            @media (max-width: 768px) {
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
            .tv-scroll-row::-webkit-scrollbar { height: 4px; }
            .tv-scroll-row::-webkit-scrollbar-track { background: transparent; }
            .tv-scroll-row::-webkit-scrollbar-thumb { background: rgba(0,153,255,0.3); border-radius: 2px; }
            .tv-card {
                flex: 0 0 clamp(180px, 70vw, 220px);
                scroll-snap-align: start;
                background: rgba(16,42,67,0.65);
                border: 1px solid rgba(0,153,255,0.12);
                border-radius: 12px;
                padding: 16px 14px;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                gap: 6px;
                min-width: 0;
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
                background: rgba(16,42,67,0.65);
                border: 1px solid rgba(0,153,255,0.12);
                border-radius: 14px;
                padding: 18px 16px;
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
        </style>

        <main class="crm-main-container" style="z-index:10; padding:0;">
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

            <div class="meta-view-body" style="padding:20px 24px;">
                <div id="tv-columns">

                    <!-- Columna Pendientes -->
                    <div class="tv-col-box">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-bottom:10px; border-bottom:2px solid #ef4444;">
                            <span style="width:8px; height:8px; border-radius:50%; background:#ef4444; flex-shrink:0;"></span>
                            <h3 style="margin:0; font-size:0.82rem; font-weight:700; font-family:'Montserrat',sans-serif; text-transform:uppercase; letter-spacing:1px; color:var(--text-main);">Pendientes</h3>
                            <span id="tv-count-pending" style="margin-left:auto; font-size:0.75rem; color:var(--text-muted);"></span>
                        </div>
                        <div id="tv-list-pending">
                            <div style="text-align:center; padding:30px 0; color:var(--text-muted); font-size:0.82rem;">Cargando...</div>
                        </div>
                    </div>

                    <!-- Columna Cerrados -->
                    <div class="tv-col-box">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-bottom:10px; border-bottom:2px solid #22c55e;">
                            <span style="width:8px; height:8px; border-radius:50%; background:#22c55e; flex-shrink:0;"></span>
                            <h3 style="margin:0; font-size:0.82rem; font-weight:700; font-family:'Montserrat',sans-serif; text-transform:uppercase; letter-spacing:1px; color:var(--text-main);">Cerrados</h3>
                            <span id="tv-count-closed" style="margin-left:auto; font-size:0.75rem; color:var(--text-muted);"></span>
                        </div>
                        <div id="tv-list-closed">
                            <div style="text-align:center; padding:30px 0; color:var(--text-muted); font-size:0.82rem;">Cargando...</div>
                        </div>
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
                        <div class="modal-section">
                            <label><i class="fas fa-comments"></i> Chats con problema <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted);">(opcional)</span></label>
                            <div style="position:relative;">
                                <input type="text" id="tv-chat-search" class="crm-input" placeholder="Buscar chat por nombre o numero..." oninput="ticketsView._chatSearch(this.value)" autocomplete="off">
                                <div id="tv-chat-suggestions" style="display:none; position:absolute; top:100%; left:0; right:0; z-index:200; border-radius:10px; overflow:hidden; background:rgb(8,20,40); border:1px solid rgba(0,153,255,0.2); max-height:180px; overflow-y:auto;"></div>
                            </div>
                            <div id="tv-chat-chips" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;"></div>
                        </div>
                        <div class="modal-section">
                            <label><i class="fas fa-paperclip"></i> Adjuntar imagenes <span style="font-size:0.75rem; font-weight:400; color:var(--text-muted);">(opcional)</span></label>
                            <div id="tv-drop-zone" onclick="document.getElementById('tv-files').click()"
                                 style="border:2px dashed var(--border); border-radius:10px; padding:18px; text-align:center; cursor:pointer; transition:border-color 0.2s; color:var(--text-muted); font-size:0.82rem; display:flex; flex-direction:column; align-items:center; gap:6px;">
                                <i class="fas fa-cloud-upload-alt" style="font-size:1.6rem; color:#0099FF;"></i>
                                <span>hasta 10MB por archivo</span>
                            </div>
                            <input type="file" id="tv-files" multiple accept="image/*,.pdf" style="display:none" onchange="ticketsView._filesSelected(this.files)">
                            <div id="tv-file-preview" style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;"></div>
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

    async function init(token) {
        _token = (typeof token === 'string' && token && token !== 'undefined') ? token : '';
        if (!_token) {
            _token = (typeof window.getAuthToken === 'function' ? decodeURIComponent(window.getAuthToken()) : '') || localStorage.getItem('backoffice_token') || '';
        }
        if (_token === 'undefined') _token = '';
        _loadChats();
        _fetchAll();
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

    async function _fetchColumn(filter) {
        const listId = filter === 'pending' ? 'tv-list-pending' : 'tv-list-closed';
        const countId = filter === 'pending' ? 'tv-count-pending' : 'tv-count-closed';
        const list = document.getElementById(listId);
        if (!list) return;

        const estadoParam = filter === 'pending' ? '' : `&estado=${filter}`;
        try {
            const res = await fetch(`/api/backoffice/tickets?token=${_token}${estadoParam}`);
            const tickets = await res.json();
            const count = document.getElementById(countId);

            if (!Array.isArray(tickets) || tickets.length === 0) {
                if (count) count.textContent = '0';
                list.innerHTML = `<div style="text-align:center; padding:30px 0; color:var(--text-muted); font-size:0.82rem;">Sin tickets</div>`;
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
        const chatsAdj = _parseJson(t.chats_adjuntos, []);
        const statusColor = { 'Abierto': '#ef4444', 'Cerrado': '#22c55e' }[t.estado] || 'var(--text-muted)';
        const statusBg = { 'Abierto': 'rgba(239,68,68,0.12)', 'Cerrado': 'rgba(34,197,94,0.12)' }[t.estado] || 'rgba(255,255,255,0.05)';

        const attachHtml = attachments.length ? `
            <div class="tv-card-attachments">
                ${attachments.map(url => `
                    <a href="${url}" target="_blank" style="width:44px; height:44px; border-radius:6px; overflow:hidden; border:1px solid var(--border); display:block; flex-shrink:0;">
                        <img src="${url}" style="width:100%; height:100%; object-fit:cover;"
                             onerror="this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;\\'><i class=\\'fas fa-file\\' style=\\'color:var(--text-muted);font-size:0.9rem;\\'></i></div>'">
                    </a>`).join('')}
            </div>` : '';

        const chatsAdjHtml = chatsAdj.length ? `
            <div class="tv-card-chips">
                ${chatsAdj.map(c => `
                    <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 7px; border-radius:99px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); font-size:0.68rem; color:#0099FF;">
                        <i class="fas fa-comment" style="font-size:0.6rem;"></i>${c.name || c.chat_id}
                    </span>`).join('')}
            </div>` : '';

        return `
            <div class="tv-card">
                <span class="tv-card-badge" style="color:${statusColor}; background:${statusBg};">${t.estado}</span>
                <div class="tv-card-title">${t.titulo}</div>
                ${t.descripcion ? `<div class="tv-card-desc">${t.descripcion}</div>` : ''}
                ${chatsAdjHtml}
                ${attachHtml}
                <div class="tv-card-date"><i class="far fa-calendar-alt" style="margin-right:3px;"></i>${date}</div>
            </div>`;
    }

    function _openModal() {
        _selectedChats = [];
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

    function _chatSearch(query) {
        const box = document.getElementById('tv-chat-suggestions');
        if (!box) return;
        if (!query.trim()) { box.style.display = 'none'; return; }
        const allChats = _chats.length ? _chats : (typeof window.chats !== 'undefined' ? window.chats : []);
        const q = query.toLowerCase();
        const matches = allChats.filter(c => {
            const name = (c.name || c.id || '').toLowerCase();
            const num = (c.id || '').toLowerCase();
            return (name.includes(q) || num.includes(q)) && !_selectedChats.find(s => s.chat_id === c.id);
        }).slice(0, 8);

        if (!matches.length) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        box.innerHTML = matches.map(c => {
            const label = c.name || c.id.split('@')[0];
            return `<div onclick="ticketsView._addChat('${c.id}', '${label.replace(/'/g,"\\'")}'); document.getElementById('tv-chat-search').value=''; document.getElementById('tv-chat-suggestions').style.display='none';"
                         style="padding:10px 14px; cursor:pointer; font-size:0.85rem; color:var(--text-main);"
                         onmouseover="this.style.background='rgba(0,153,255,0.1)'" onmouseout="this.style.background=''">
                <i class="fas fa-comment" style="color:#0099FF; margin-right:8px;"></i>${label}
                <span style="color:var(--text-muted); font-size:0.78rem; margin-left:6px;">${c.id.split('@')[0]}</span>
            </div>`;
        }).join('');
    }

    function _addChat(chatId, name) {
        if (_selectedChats.find(s => s.chat_id === chatId)) return;
        _selectedChats.push({ chat_id: chatId, name });
        _renderChips();
    }

    function _removeChat(chatId) {
        _selectedChats = _selectedChats.filter(s => s.chat_id !== chatId);
        _renderChips();
    }

    function _renderChips() {
        const box = document.getElementById('tv-chat-chips');
        if (!box) return;
        box.innerHTML = _selectedChats.map(s =>
            `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:99px; background:rgba(0,153,255,0.12); border:1px solid rgba(0,153,255,0.25); font-size:0.8rem; color:var(--text-main);">
                <i class="fas fa-comment" style="color:#0099FF; font-size:0.75rem;"></i>${s.name}
                <button onclick="ticketsView._removeChat('${s.chat_id}')" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:0; line-height:1;">&times;</button>
            </span>`
        ).join('');
    }

    function _filesSelected(fileList) {
        _files = Array.from(fileList);
        const preview = document.getElementById('tv-file-preview');
        if (!preview) return;
        preview.innerHTML = _files.map((f, i) => {
            const isImg = f.type.startsWith('image/');
            return `<div style="position:relative; width:72px; height:72px; border-radius:8px; overflow:hidden; border:1px solid var(--border); background:var(--bg-card); display:flex; align-items:center; justify-content:center;">
                ${isImg ? `<img src="${URL.createObjectURL(f)}" style="width:100%; height:100%; object-fit:cover;">` : '<i class="fas fa-file-pdf" style="font-size:1.5rem; color:#ef4444;"></i>'}
                <button onclick="ticketsView._removeFile(${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); border:none; border-radius:50%; width:18px; height:18px; cursor:pointer; color:white; font-size:10px; display:flex; align-items:center; justify-content:center;">&times;</button>
            </div>`;
        }).join('');
    }

    function _removeFile(index) {
        _files.splice(index, 1);
        _filesSelected(_files);
    }

    async function _submit() {
        const titulo = (document.getElementById('tv-titulo')?.value || '').trim();
        const descripcion = (document.getElementById('tv-desc')?.value || '').trim();
        if (!titulo) { showToast && showToast('El asunto es obligatorio', 'error'); return; }

        try {
            const res = await fetch(`/api/backoffice/tickets?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titulo, descripcion, chats_adjuntos: _selectedChats })
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

    return {
        title: 'Tickets',
        getHTML,
        init,
        destroy,
        _fetchAll,
        _openModal,
        _closeModal,
        _chatSearch,
        _addChat,
        _removeChat,
        _filesSelected,
        _removeFile,
        _submit
    };
})();
