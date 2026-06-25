/* global loadViewScript, FB, fetchChats, jumpToCRM, _boBotTags, _tagStyle */
window.backofficeView = {
    title: (window.BOT_NAME || 'Backoffice') + ' - Conversaciones',

    getHTML() {
        return `
        <!-- Contenido principal del backoffice -->
        <div class="flex flex-1 h-full overflow-hidden" style="position:relative;">

            <!-- Sidebar chats -->
            <div id="sidebar">
                <div class="sidebar-header">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h2 class="sidebar-title">Chats</h2>
                        <span id="unread-total-badge" style="display:none; background:#ef4444; color:white; font-size:0.75rem; font-weight:700; font-family:'Montserrat',sans-serif; padding:2px 8px; border-radius:12px;">0</span>
                    </div>
                    <div class="sidebar-header-actions">
                        <button class="btn-icon-wa" title="Sincronizar Contactos" onclick="startContactSync()" id="btn-sync-baileys">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="btn-icon-wa" title="Importar Contactos (Excel)" onclick="toggleImportModal()" id="btn-import-extern">
                            <i class="fas fa-file-import"></i>
                        </button>
                    </div>
                </div>

                <div class="platform-tabs" id="platform-tabs">
                    <div class="platform-tab active" id="tab-whatsapp" onclick="switchPlatform('whatsapp')" title="WhatsApp">
                        <i class="fab fa-whatsapp"></i>
                    </div>
                    <div class="platform-tab" id="tab-instagram" onclick="switchPlatform('instagram')" title="Instagram" style="display:none;">
                        <i class="fab fa-instagram"></i>
                    </div>
                    <div class="platform-tab" id="tab-messenger" onclick="switchPlatform('messenger')" title="Messenger" style="display:none;">
                        <i class="fab fa-facebook-messenger"></i>
                    </div>
                    <div class="platform-tab" id="tab-all" onclick="switchPlatform('all')" title="Todos" style="display:none;">
                        <i class="fas fa-list-ul"></i>
                    </div>
                </div>

                <!-- Unread filter container -->
                <div id="unread-filter-container" style="display:none; align-items:center; justify-content:space-between; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--bg-header);">
                    <span style="font-size:0.82rem; font-weight:600; color:var(--text-muted); font-family:'Montserrat',sans-serif; display:flex; align-items:center; gap:6px;">
                        <i class="fas fa-envelope" style="color:#0099FF;"></i> Filtrar no leídos
                    </span>
                    <label style="width: 36px; height: 20px; position: relative; display: inline-block; cursor: pointer;">
                        <input type="checkbox" id="unread-filter-checkbox" onchange="toggleUnreadFilter(this.checked)" style="opacity: 0; width: 0; height: 0; position: absolute;">
                        <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: .3s; border-radius: 34px;" id="unread-slider-bg"></span>
                        <span style="position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%;" id="unread-slider-knob"></span>
                    </label>
                </div>

                <div class="search-container">
                    <div class="search-wrapper">
                        <i class="fas fa-search search-icon"></i>
                        <input type="text" id="search-input" class="search-input" placeholder="Buscar chat..." oninput="handleSearch()">
                    </div>
                    <div class="filter-wrapper">
                        <select id="filter-tag" style="display:none;"><option value="">Todas las etiquetas</option></select>
                        <div class="tag-filter-split">
                            <button class="tag-filter-main" onclick="_toggleTagFilter(event)">
                                <i class="fas fa-tags"></i>
                                <span id="tag-filter-label">Todas las etiquetas</span>
                            </button>
                            <button class="tag-filter-chevron" onclick="_toggleTagFilter(event)">
                                <i class="fas fa-chevron-down" id="tag-filter-chevron-icon"></i>
                            </button>
                        </div>
                        <ul class="tag-filter-dropdown" id="tag-filter-dropdown"></ul>
                    </div>
                </div>

                <div id="chat-list"></div>
            </div>

            <!-- Area de chat -->
            <div id="main-content" style="position:relative;">
                <div id="chat-header">
                    <button class="mobile-back-btn" onclick="document.body.classList.remove('mobile-chat-active')" aria-label="Volver">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <div class="header-user">
                        <div class="chat-avatar" id="active-chat-avatar"></div>
                        <div>
                            <div class="chat-header-phone" id="active-chat-phone">Selecciona un chat</div>
                            <div class="chat-header-name" id="active-chat-name"></div>
                            <div id="active-chat-tags"></div>
                        </div>
                    </div>
                    <div class="switch-container">
                        <div class="header-actions-group">
                            <!-- Blacklist toggle: solo visible cuando la integración está activa -->
                            <button class="btn-icon" id="blacklist-toggle-btn"
                                title="Lista Negra: contacto habilitado"
                                style="display:none;"
                                onclick="toggleBlacklist()"
                                disabled>
                                <i class="fas fa-ban" style="color:var(--text-muted);"></i>
                            </button>
                            <button class="btn-icon" id="open-tags-btn" onclick="toggleTagsPanel()" title="Gestionar Etiquetas" disabled>
                                <i class="fas fa-tags"></i>
                            </button>
                            <button class="btn-icon" id="open-crm-btn" onclick="toggleCRMPanel()" title="Ficha del Cliente" disabled>
                                <i class="fas fa-user-pen"></i>
                            </button>
                            <div id="crm-jump-container" style="display: none !important;">
                                <select id="crm-lead-jump" style="display:none;"></select>
                                <div class="crm-jump-split">
                                    <button class="crm-jump-main" onclick="_crmJumpDefault()">
                                        <i class="fas fa-rocket"></i>
                                        <span>Ver en CRM</span>
                                    </button>
                                    <button class="crm-jump-chevron" onclick="_toggleCRMJumpMenu(event)">
                                        <i class="fas fa-chevron-down" id="crm-jump-chevron-icon"></i>
                                    </button>
                                </div>
                                <ul class="crm-jump-dropdown-menu" id="crm-jump-dropdown"></ul>
                            </div>
                            <!-- Menu 3 puntitos: solo visible en mobile/tablet -->
                            <div class="mobile-header-menu" id="mobile-header-menu-wrap">
                                <button class="btn-icon" id="mobile-header-menu-btn" onclick="_toggleMobileHeaderMenu(event)" title="Mas opciones">
                                    <i class="fas fa-ellipsis-vertical"></i>
                                </button>
                                <ul class="mobile-header-dropdown" id="mobile-header-dropdown">
                                    <li onclick="toggleTagsPanel(); _closeMobileHeaderMenu()">
                                        <i class="fas fa-tags"></i> Gestionar Etiquetas
                                    </li>
                                    <li onclick="toggleCRMPanel(); _closeMobileHeaderMenu()">
                                        <i class="fas fa-user-pen"></i> Ficha del Cliente
                                    </li>
                                    <li id="mobile-blacklist-li" style="display:none;" onclick="toggleBlacklist(); _closeMobileHeaderMenu()">
                                        <i class="fas fa-ban"></i> <span id="mobile-blacklist-label">Lista Negra</span>
                                    </li>
                                    <li class="mobile-bot-toggle-row" onclick="_mobileToggleBotClick()">
                                        <i class="fas fa-robot"></i>
                                        <span id="mobile-bot-label">Bot: off</span>
                                        <label class="switch" onclick="event.stopPropagation()" style="margin-left:auto;">
                                            <input type="checkbox" id="mobile-bot-toggle" onchange="toggleBot(this.checked); const r=document.getElementById('bot-toggle'); if(r) r.checked=this.checked;">
                                            <span class="slider round">
                                                <i class="fas fa-user"></i>
                                                <i class="fas fa-robot"></i>
                                            </span>
                                        </label>
                                    </li>
                                </ul>
                            </div>
                        </div>
                        <div class="header-bot-toggle-wrap">
                            <label class="switch">
                                <input type="checkbox" id="bot-toggle" disabled onchange="toggleBot(this.checked)">
                                <span class="slider round">
                                    <i class="fas fa-user"></i>
                                    <i class="fas fa-robot"></i>
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                <div id="messages">
                    <div class="welcome-container">
                        <i class="fas fa-comments welcome-icon"></i>
                        <h2 class="text-xl font-heading font-bold mb-2">Bienvenido al panel</h2>
                        <p class="text-sm text-secondary-content">Selecciona un chat a la izquierda para comenzar.</p>
                    </div>
                </div>

                <div id="emoji-picker" class="emoji-picker-container" style="display:none;"></div>

                <!-- Popover de Mensajes Rápidos -->
                <div id="quick-messages-popover" class="quick-messages-popover" style="display: none;">
                    <div class="qm-header">
                        <h4>Mensajes Rápidos</h4>
                        <button class="qm-close-btn" onclick="window.toggleQuickMessages(event)"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="qm-form">
                        <input type="text" id="qm-title-input" placeholder="Título para identificarlo..." />
                        <textarea id="qm-message-input" placeholder="Mensaje rápido..."></textarea>
                        <button class="qm-save-btn" onclick="window.saveQuickMessage()">Guardar</button>
                    </div>
                    <div class="qm-list-container">
                        <h5>Guardados:</h5>
                        <div id="qm-list" class="qm-list">
                            <div class="qm-empty">No hay mensajes rápidos guardados.</div>
                        </div>
                    </div>
                </div>

                <!-- File preview overlay -->
                <div id="file-preview-overlay" style="display:none; position:absolute; inset:0; z-index:50; background:#111; flex-direction:column;">
                    <div id="file-preview-header" style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.1);">
                        <button onclick="closeFilePreview()" style="background:none;border:none;color:#fff;font-size:1.2rem;cursor:pointer;"><i class="fas fa-times"></i></button>
                        <span id="file-preview-name" style="color:#fff;font-size:0.85rem;font-weight:600;flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 12px;"></span>
                        <div style="width:24px;"></div>
                    </div>
                    <div id="file-preview-body" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:16px;"></div>
                    <div id="file-preview-footer" style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:8px;">
                        <input type="text" id="file-preview-caption" placeholder="Escribe un comentario..." style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:8px 14px;color:#fff;font-size:0.9rem;outline:none;"
                            onkeydown="if(event.key==='Enter') sendFromPreview()">
                        <button onclick="sendFromPreview()" style="width:42px;height:42px;border-radius:50%;background:#0078D4;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem;">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>

                <div id="input-area">
                    <button class="btn-icon input-action-btn" id="attach-btn" title="Adjuntar archivo" disabled onclick="document.getElementById('file-input').click()">
                        <i class="fas fa-plus"></i>
                    </button>
                    <input type="file" id="file-input" style="display:none;" onchange="handleFileSelect(this)">
                    <div class="input-wrapper" style="position: relative;">
                        <button class="btn-icon input-action-btn" id="emoji-btn" title="Emojis" disabled onclick="toggleEmojiPicker(event)">
                            <i class="far fa-face-smile"></i>
                        </button>
                        <button class="btn-icon input-action-btn" id="quick-msg-btn" title="Mensajes Rápidos" disabled onclick="window.toggleQuickMessages(event)">
                            <i class="fas fa-bolt"></i>
                        </button>
                        <textarea id="message-input" placeholder="Escribe un mensaje" disabled
                            rows="1"
                            onkeydown="window.handleChatTextareaKey(event, window.sendMessage)"
                            oninput="window.autoResizeChatTextarea(this)"
                            style="flex:1;background:transparent;border:0;outline:none;color:var(--text-main);font-size:16px;padding:8px 0;min-width:0;resize:none;overflow-y:auto;max-height:120px;font-family:inherit;line-height:1.4;display:block;"></textarea>
                    </div>
                    <button class="btn-icon input-action-btn" id="mic-btn" title="Grabar audio" disabled onclick="toggleRecording()">
                        <i class="fas fa-microphone"></i>
                    </button>
                    <button class="btn-icon input-action-btn" id="send-btn" title="Enviar mensaje" onclick="sendMessage()" disabled>
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- Panel CRM lateral -->
        <div id="crm-panel">
            <div class="crm-header">
                <button class="btn-icon" onclick="toggleCRMPanel()"><i class="fas fa-times"></i></button>
                <h3>Informacion del Lead</h3>
            </div>
            <div class="crm-content">
                <div class="crm-section" id="crm-fields-container">
                    <div data-field="crm-ticket-title">
                        <label><i class="fas fa-ticket-alt"></i> Titulo del Lead / Ticket</label>
                        <input type="text" id="crm-ticket-title" class="crm-input" placeholder="Titulo...">
                    </div>
                    <div data-field="crm-name">
                        <label>Nombre del Contacto</label>
                        <input type="text" id="crm-name" class="crm-input" placeholder="Nombre completo">
                    </div>
                    <div data-field="crm-phone">
                        <label><i class="fas fa-phone"></i> Telefono</label>
                        <div class="phone-input-wrap">
                            <input type="text" id="crm-phone-side" class="crm-input" readonly>
                            <button class="phone-wa-btn" id="btn-whatsapp-direct-side" onclick="openWhatsAppDirectSide()">
                                <i class="fab fa-whatsapp"></i>
                            </button>
                        </div>
                    </div>
                    <div data-field="crm-email">
                        <label>Correo Electronico</label>
                        <input type="email" id="crm-email" class="crm-input" placeholder="ejemplo@correo.com">
                    </div>
                    <div data-field="crm-cuit">
                        <label><i class="fas fa-id-card"></i> Cuil / Cuit / DNI</label>
                        <input type="text" id="crm-cuit" class="crm-input" placeholder="00-00000000-0">
                    </div>
                    <div data-field="crm-address">
                        <label><i class="fas fa-map-marker-alt"></i> Domicilio</label>
                        <input type="text" id="crm-address" class="crm-input" placeholder="Calle, Nro, Localidad...">
                    </div>
                    <div data-field="crm-tax-status">
                        <label><i class="fas fa-file-invoice-dollar"></i> Situacion Impositiva</label>
                        <div class="csd-wrap">
                            <select id="crm-tax-status" hidden>
                                <option value="Cons. Final">Cons. Final</option>
                                <option value="Responsable Inscripto">Responsable Inscripto</option>
                                <option value="Monotributo">Monotributo</option>
                                <option value="Exento">Exento</option>
                            </select>
                            <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label">Cons. Final</span>
                                <i class="fas fa-chevron-down csd-chevron"></i>
                            </button>
                            <div class="csd-menu">
                                <button class="csd-item selected" type="button" data-val="Cons. Final" onclick="_csdSelect(this,'Cons. Final')">Cons. Final</button>
                                <button class="csd-item" type="button" data-val="Responsable Inscripto" onclick="_csdSelect(this,'Responsable Inscripto')">Responsable Inscripto</button>
                                <button class="csd-item" type="button" data-val="Monotributo" onclick="_csdSelect(this,'Monotributo')">Monotributo</button>
                                <button class="csd-item" type="button" data-val="Exento" onclick="_csdSelect(this,'Exento')">Exento</button>
                            </div>
                        </div>
                    </div>
                    <div data-field="crm-product">
                        <label><i class="fas fa-shopping-bag"></i> Producto Ofrecido</label>
                        <input type="text" id="crm-product" class="crm-input" placeholder="Servicio/Producto...">
                    </div>
                    <div data-field="crm-source">
                        <label><i class="fas fa-bullhorn"></i> Fuente / Canal</label>
                        <div class="csd-wrap">
                            <select id="crm-source" hidden>
                                <option value="">Desconocida</option>
                                <option value="Instagram">Instagram</option>
                                <option value="Facebook">Facebook</option>
                                <option value="WhatsApp">WhatsApp</option>
                                <option value="Web">Web</option>
                                <option value="Referido">Referido</option>
                                <option value="Manual CRM">Manual CRM</option>
                            </select>
                            <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label">Desconocida</span>
                                <i class="fas fa-chevron-down csd-chevron"></i>
                            </button>
                            <div class="csd-menu">
                                <button class="csd-item selected" type="button" data-val="" onclick="_csdSelect(this,'')">Desconocida</button>
                                <button class="csd-item" type="button" data-val="Instagram" onclick="_csdSelect(this,'Instagram')">Instagram</button>
                                <button class="csd-item" type="button" data-val="Facebook" onclick="_csdSelect(this,'Facebook')">Facebook</button>
                                <button class="csd-item" type="button" data-val="WhatsApp" onclick="_csdSelect(this,'WhatsApp')">WhatsApp</button>
                                <button class="csd-item" type="button" data-val="Web" onclick="_csdSelect(this,'Web')">Web</button>
                                <button class="csd-item" type="button" data-val="Referido" onclick="_csdSelect(this,'Referido')">Referido</button>
                                <button class="csd-item" type="button" data-val="Manual CRM" onclick="_csdSelect(this,'Manual CRM')">Manual CRM</button>
                            </div>
                        </div>
                    </div>
                    <div data-field="crm-notes">
                        <label><i class="fas fa-sticky-note"></i> Notas / Observaciones</label>
                        <textarea id="crm-notes" class="crm-input" rows="4" placeholder="Observaciones..."></textarea>
                    </div>
                    <div data-field="crm-due-date">
                        <label><i class="fas fa-calendar-alt"></i> Fecha de Seguimiento</label>
                        <input type="date" id="crm-due-date" class="crm-input">
                    </div>
                    <div data-field="crm-priority">
                        <label><i class="fas fa-flag"></i> Prioridad</label>
                        <div class="csd-wrap">
                            <select id="crm-priority" hidden>
                                <option value="Baja">Baja</option>
                                <option value="Media">Media</option>
                                <option value="Alta">Alta</option>
                            </select>
                            <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label">Baja</span>
                                <i class="fas fa-chevron-down csd-chevron"></i>
                            </button>
                            <div class="csd-menu">
                                <button class="csd-item selected" type="button" data-val="Baja" onclick="_csdSelect(this,'Baja')">Baja</button>
                                <button class="csd-item" type="button" data-val="Media" onclick="_csdSelect(this,'Media')">Media</button>
                                <button class="csd-item" type="button" data-val="Alta" onclick="_csdSelect(this,'Alta')">Alta</button>
                            </div>
                        </div>
                    </div>
                    <div data-field="crm-status">
                        <label><i class="fas fa-tasks"></i> Estado del Lead (CRM)</label>
                        <div class="csd-wrap">
                            <select id="crm-status-select-side" hidden></select>
                            <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                <span class="csd-label">Sin Asignar</span>
                                <i class="fas fa-chevron-down csd-chevron"></i>
                            </button>
                            <div class="csd-menu"></div>
                        </div>
                    </div>
                    <button class="btn-primary crm-save-btn" onclick="saveCRMDetails()">
                        <i class="fas fa-save icon-mr"></i> Guardar Ficha de Cliente
                    </button>
                </div>
            </div>
        </div>

        <!-- Panel Etiquetas -->
        <div id="tags-panel" class="tickets-panel">
            <div class="crm-header">
                <button class="btn-icon" onclick="toggleTagsPanel()"><i class="fas fa-times"></i></button>
                <h3>Gestionar Etiquetas</h3>
            </div>
            <div class="crm-content">
                <div class="crm-section">
                    <h4 class="crm-tags-heading"><i class="fas fa-tags icon-mr"></i> Etiquetas del Chat</h4>
                    <div id="current-chat-tags-section">
                        <div id="available-tags-to-assign"></div>
                    </div>
                    <div class="tag-create-box">
                        <h5 class="text-xs font-heading font-bold text-primary-content mb-3">Crear Nueva Etiqueta</h5>
                        <div class="tag-create-row">
                            <input type="text" id="new-tag-name" class="crm-input" placeholder="Nombre...">
                            <input type="color" id="new-tag-color" value="#0078D4">
                            <button class="btn-icon" onclick="createTag()"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                    <div id="tag-list-editor"></div>
                </div>
            </div>
        </div>

        <!-- Panel Tickets -->
        <div id="tickets-panel" class="tickets-panel">
            <div class="panel-header">
                <h3 class="text-base font-heading font-bold text-primary-content flex items-center gap-2">
                    <i class="fas fa-ticket-alt text-accent-bright"></i> Tickets
                </h3>
                <button class="btn-icon" onclick="toggleTicketsPanel(event)"><i class="fas fa-times"></i></button>
            </div>
            <div class="panel-tabs">
                <button id="tab-pending" class="tab-btn active" onclick="setTicketsFilter('pending')">Pendientes</button>
                <button id="tab-closed"  class="tab-btn"        onclick="setTicketsFilter('Cerrado')">Cerrados</button>
            </div>
            <div id="tickets-list" class="tickets-list">
                <div class="panel-loading-placeholder">Cargando tickets...</div>
            </div>
        </div>

        <!-- Panel Leads -->
        <div id="leads-panel" class="tickets-panel">
            <div class="panel-header">
                <h3 class="text-base font-heading font-bold text-primary-content flex items-center gap-2">
                    <i class="fas fa-address-book text-accent-bright"></i> Leads Editados
                </h3>
                <button class="btn-icon" onclick="toggleLeadsPanel(event)"><i class="fas fa-times"></i></button>
            </div>
            <div id="leads-list" class="tickets-list">
                <div class="panel-loading-placeholder">Cargando leads...</div>
            </div>
        </div>

        <!-- Modal Sincronizar -->
        <div id="sync-modal" class="modal-overlay">
            <div class="modal-content animate-pop-in" style="max-width:400px;">
                <div class="modal-header">
                    <h3><i class="fas fa-sync-alt modal-h3-icon"></i> Sincronizando</h3>
                </div>
                <div class="modal-body sync-modal-body">
                    <div id="sync-loading">
                        <div class="spinner"></div>
                        <p class="sync-loading-title text-base font-heading font-semibold text-primary-content mb-1">Importando datos desde WhatsApp...</p>
                        <p class="sync-loading-desc text-sm text-secondary-content">Esto puede demorar segun la cantidad de contactos.</p>
                    </div>
                    <div id="sync-result" style="display:none;">
                        <i class="sync-success-icon fas fa-check-circle"></i>
                        <h4 class="sync-success-heading text-lg font-heading font-bold text-primary-content mb-2">Sincronizacion Completada!</h4>
                        <p id="sync-summary" class="text-sm text-secondary-content mb-5"></p>
                        <button class="btn-primary btn-sync-close" onclick="closeSyncModal()">Entendido</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Modal Importar Excel -->
        <div id="import-modal" class="modal-overlay">
            <div class="modal-content animate-pop-in" style="max-width:450px;">
                <div class="modal-header">
                    <h3><i class="fas fa-file-excel icon-excel mr-2"></i> Importar Contactos</h3>
                    <button class="btn-close-modal" onclick="toggleImportModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:25px;">
                    <p class="text-sm text-secondary-content mb-5">Carga multiples contactos usando una plantilla Excel.</p>
                    <div class="import-template-section">
                        <h4 class="text-sm font-heading font-semibold text-primary-content mb-3">1. Descarga la plantilla</h4>
                        <button class="btn-primary btn-download-template w-full justify-center" onclick="downloadImportTemplate()">
                            <i class="fas fa-download"></i> Descargar Plantilla .xlsx
                        </button>
                    </div>
                    <div class="import-upload-section">
                        <h4 class="text-sm font-heading font-semibold text-primary-content mb-3">2. Subi tu archivo completado</h4>
                        <input type="file" id="import-file-input" class="crm-input mb-3" accept=".xlsx,.xls">
                        <button class="btn-primary w-full justify-center" onclick="startImportExcel()" id="btn-execute-import">
                            <i class="fas fa-upload"></i> Iniciar Importacion
                        </button>
                    </div>
                    <div id="import-progress" style="display:none;" class="mt-5">
                        <div class="import-progress-track">
                            <div id="import-progress-bar" class="import-progress-bar" style="width:0%"></div>
                        </div>
                        <p id="import-status-text" class="import-status-text">Procesando...</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Lightbox -->
        <div id="lightbox-modal" class="modal-overlay" onclick="closeLightbox()">
            <div class="lightbox-content" onclick="event.stopPropagation()">
                <button class="lightbox-close-btn" onclick="closeLightbox()"><i class="fas fa-times"></i></button>
                <img id="lightbox-img" src="" alt="zoom">
                <div class="lightbox-actions">
                    <a id="lightbox-download-link" href="" download class="btn-primary">
                        <i class="fas fa-download"></i> Descargar Imagen
                    </a>
                </div>
            </div>
        </div>

        <!-- Modal Reenviar Multimedia -->
        <div id="forward-modal" class="modal-overlay">
            <div class="modal-content animate-pop-in" style="max-width:450px;">
                <div class="modal-header">
                    <h3><i class="fas fa-share modal-h3-icon"></i> Reenviar archivo</h3>
                    <button class="btn-close-modal" onclick="closeForwardModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding-top:10px;">
                    <div class="search-container mb-4" style="padding:0;">
                        <div class="search-wrapper">
                            <i class="fas fa-search search-icon"></i>
                            <input type="text" id="forward-search-input" class="search-input" placeholder="Buscar contacto..." oninput="handleForwardSearch()">
                        </div>
                    </div>
                    <div id="forward-chats-list" style="max-height:300px; overflow-y:auto; border-radius:8px; margin-bottom:15px;"></div>
                    <div class="flex justify-end">
                        <button class="btn-outline px-5 py-2.5 text-sm" onclick="closeForwardModal()">Cancelar</button>
                    </div>
                </div>
            </div>
        </div>`;
    },

    async init() {
        // Cargar Facebook SDK si no esta cargado
        if (!window.FB && !document.querySelector('script[src*="connect.facebook.net"]')) {
            const fbSdk = document.createElement('script');
            fbSdk.async = true;
            fbSdk.defer = true;
            fbSdk.crossOrigin = 'anonymous';
            fbSdk.src = 'https://connect.facebook.net/es_LA/sdk.js';
            document.body.appendChild(fbSdk);
        }

        // Inicializar FB cuando cargue
        if (!window.fbAsyncInit) {
            window.fbAsyncInit = function() {
                const activeToken = localStorage.getItem('system_config_token') || localStorage.getItem('backoffice_token');
                fetch('/api/backoffice/whatsapp/config?token=' + activeToken)
                    .then(res => res.json())
                    .then(data => {
                        if (data && data.appId && data.appId !== 'AQUI_TU_ID_DE_APP' && typeof FB !== 'undefined') {
                            FB.init({ appId: data.appId, cookie: true, xfbml: true, version: 'v22.0' });
                        }
                    });
            };
        }

        // Cargar backoffice.js si no esta cargado (primera visita)
        if (!window._backofficeScriptLoaded) {
            await loadViewScript('/js/backoffice.js?v=15');
            window._backofficeScriptLoaded = true;
        }
        // Siempre re-inicializar: tanto primera visita como re-visitas
        // (en primera visita el top-level del script ya corrió fetchChats, pero
        //  initBackofficeView re-engancha scroll listeners y garantiza carga completa)
        if (typeof window.initBackofficeView === 'function') {
            window.initBackofficeView();
        }

        window.toggleUnreadFilter = function(enabled) {
            const bg = document.getElementById('unread-slider-bg');
            const knob = document.getElementById('unread-slider-knob');
            if (bg && knob) {
                if (enabled) {
                    bg.style.backgroundColor = '#0099FF';
                    knob.style.transform = 'translateX(16px)';
                } else {
                    bg.style.backgroundColor = '#cbd5e1';
                    knob.style.transform = 'translateX(0px)';
                }
            }
            if (typeof window.executeUnreadFilter === 'function') {
                window.executeUnreadFilter(enabled);
            }
        };

        window._toggleMobileHeaderMenu = function(e) {
            e.stopPropagation();
            const d = document.getElementById('mobile-header-dropdown');
            if (!d) return;
            const real = document.getElementById('bot-toggle');
            const mob = document.getElementById('mobile-bot-toggle');
            if (real && mob) { mob.checked = real.checked; mob.disabled = real.disabled; }
            const label = document.getElementById('mobile-bot-label');
            if (label && real) label.textContent = real.checked ? 'Bot: on' : 'Bot: off';
            const isOpen = d.classList.toggle('open');
            if (isOpen) document.addEventListener('click', window._closeMobileHeaderMenu, { once: true });
        };
        window._closeMobileHeaderMenu = function() {
            const d = document.getElementById('mobile-header-dropdown');
            if (d) d.classList.remove('open');
        };
        window._toggleTagFilter = function(e) {
            e.stopPropagation();
            const dd = document.getElementById('tag-filter-dropdown');
            const icon = document.getElementById('tag-filter-chevron-icon');
            const label = document.getElementById('tag-filter-label');
            const select = document.getElementById('filter-tag');
            if (!dd || !select) return;
            const cur = select.options[select.selectedIndex];
            if (label && cur) {
                if (cur.value) {
                    const tags = (typeof _boBotTags !== 'undefined') ? _boBotTags : [];
                    const tag  = tags.find(t => String(t.id) === String(cur.value));
                    const color = tag ? tag.color : '#6366f1';
                    label.innerHTML = `<span class="tag-pill" data-tag-color="${color}" style="${_tagStyle(color)}">${cur.textContent}</span>`;
                } else {
                    label.textContent = cur.textContent;
                }
            }
            dd.innerHTML = '';
            Array.from(select.options).forEach(opt => {
                const li = document.createElement('li');
                const active = opt.value === select.value;
                if (opt.value) {
                    const tags = (typeof _boBotTags !== 'undefined') ? _boBotTags : [];
                    const tag  = tags.find(t => String(t.id) === String(opt.value));
                    const color = tag ? tag.color : '#6366f1';
                    li.innerHTML = `<span class="tag-pill" data-tag-color="${color}" style="${_tagStyle(color)}">${opt.textContent}</span>`;
                } else {
                    li.innerHTML = '<i class="fas fa-tags"></i>' + opt.textContent;
                }
                if (active) li.classList.add('active');
                li.onclick = () => {
                    select.value = opt.value;
                    if (label) {
                        label.innerHTML = opt.value
                            ? li.querySelector('.tag-pill').outerHTML
                            : opt.textContent;
                    }
                    if (typeof fetchChats === 'function') fetchChats(true);
                    dd.classList.remove('open');
                    if (icon) icon.style.transform = '';
                };
                dd.appendChild(li);
            });
            const isOpen = dd.classList.toggle('open');
            if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : '';
            if (isOpen) document.addEventListener('click', () => {
                dd.classList.remove('open');
                if (icon) icon.style.transform = '';
            }, { once: true });
        };
        window._crmJumpDefault = function() {
            const select = document.getElementById('crm-lead-jump');
            if (!select) return;
            const first = Array.from(select.options).find(o => o.value);
            if (!first) return;
            select.value = first.value;
            if (typeof jumpToCRM === 'function') jumpToCRM();
        };
        window._toggleCRMJumpMenu = function(e) {
            e.stopPropagation();
            const dd = document.getElementById('crm-jump-dropdown');
            const icon = document.getElementById('crm-jump-chevron-icon');
            if (!dd) return;
            const select = document.getElementById('crm-lead-jump');
            dd.innerHTML = '';
            Array.from(select.options).forEach(opt => {
                if (!opt.value) return;
                const li = document.createElement('li');
                li.innerHTML = '<i class="fas fa-ticket-alt"></i>' + opt.textContent;
                li.onclick = () => {
                    select.value = opt.value;
                    if (typeof jumpToCRM === 'function') jumpToCRM();
                    dd.classList.remove('open');
                    if (icon) icon.style.transform = '';
                };
                dd.appendChild(li);
            });
            if (!dd.children.length) return;
            const isOpen = dd.classList.toggle('open');
            if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : '';
            if (isOpen) document.addEventListener('click', () => {
                dd.classList.remove('open');
                if (icon) icon.style.transform = '';
            }, { once: true });
        };
        window._mobileToggleBotClick = function() {
            const real = document.getElementById('bot-toggle');
            const mob = document.getElementById('mobile-bot-toggle');
            if (!real || real.disabled || !mob) return;
            mob.checked = !mob.checked;
            mob.dispatchEvent(new Event('change'));
        };

        // Manejar parametro openPanel en la URL
        const urlParams = new URLSearchParams(window.location.search);
        const panel = urlParams.get('openPanel') || urlParams.get('panel');
        if (panel) {
            setTimeout(() => {
                if (panel === 'leads' && typeof window.realToggleLeads === 'function') window.realToggleLeads();
                else if (panel === 'tickets' && typeof window.realToggleTickets === 'function') window.realToggleTickets();
                else if (panel === 'meta' && typeof window.toggleMetaPanel === 'function') window.toggleMetaPanel();
            }, 400);
        }
    },

    destroy() {
        document.body.classList.remove('mobile-chat-active');
        if (typeof window._backofficeAbortAll === 'function') window._backofficeAbortAll();
    }
};
