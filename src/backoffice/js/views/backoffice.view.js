/* global loadViewScript, FB */
window.backofficeView = {
    title: (window.BOT_NAME || 'Backoffice') + ' - Conversaciones',

    getHTML() {
        return `
        <!-- Contenido principal del backoffice -->
        <div class="flex flex-1 h-screen overflow-hidden" style="position:relative;">

            <!-- Sidebar chats -->
            <div id="sidebar">
                <div class="sidebar-header">
                    <h2 class="sidebar-title">Chats</h2>
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

                <div class="search-container">
                    <div class="search-wrapper">
                        <i class="fas fa-search search-icon"></i>
                        <input type="text" id="search-input" class="search-input" placeholder="Buscar chat..." oninput="handleSearch()">
                    </div>
                    <div class="filter-wrapper">
                        <select id="filter-tag" class="crm-input filter-select-compact" onchange="fetchChats(true)">
                            <option value="">Todas las etiquetas</option>
                        </select>
                    </div>
                </div>

                <div id="chat-list"></div>
            </div>

            <!-- Area de chat -->
            <div id="main-content" style="position:relative;">
                <div id="chat-header">
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
                            <button class="btn-icon" id="open-tags-btn" onclick="toggleTagsPanel()" title="Gestionar Etiquetas" disabled>
                                <i class="fas fa-tags"></i>
                            </button>
                            <button class="btn-icon" id="open-crm-btn" onclick="toggleCRMPanel()" title="Ficha del Cliente" disabled>
                                <i class="fas fa-user-pen"></i>
                            </button>
                            <button class="btn-icon" id="open-ticket-btn" onclick="openTicketModal()" title="Generar Ticket" disabled>
                                <i class="fas fa-plus-circle"></i>
                            </button>
                            <div id="crm-jump-container">
                                <i class="fas fa-rocket crm-jump-icon"></i>
                                <select id="crm-lead-jump" class="search-input crm-jump-select" onchange="jumpToCRM(this.value)">
                                    <option value="" style="background:#1e293b;color:white;">Ver en CRM...</option>
                                </select>
                            </div>
                        </div>
                        <span id="bot-status-text" class="text-xs text-secondary-content">Sin chat seleccionado</span>
                        <label class="switch">
                            <input type="checkbox" id="bot-toggle" disabled onchange="toggleBot(this.checked)">
                            <span class="slider round"></span>
                        </label>
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

                <div id="input-area">
                    <button class="btn-icon" id="attach-btn" title="Adjuntar archivo" disabled onclick="document.getElementById('file-input').click()">
                        <i class="fas fa-paperclip"></i>
                    </button>
                    <input type="file" id="file-input" style="display:none;" onchange="handleFileSelect(this)">
                    <button class="btn-icon" id="emoji-btn" title="Emojis" disabled onclick="toggleEmojiPicker(event)">
                        <i class="far fa-smile"></i>
                    </button>
                    <div class="input-wrapper">
                        <input type="text" id="message-input" placeholder="Escribe un mensaje aqui" disabled
                            onkeydown="if(event.key === 'Enter') sendMessage()">
                    </div>
                    <button class="btn-icon" id="send-btn" title="Enviar mensaje" onclick="sendMessage()" disabled
                        style="color:#00a884;">
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
                        <div class="crm-phone-row">
                            <input type="text" id="crm-phone-side" class="crm-input" readonly>
                            <button class="btn-icon" id="btn-whatsapp-direct-side" onclick="openWhatsAppDirectSide()" style="color:#25d366;">
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
                        <select id="crm-tax-status" class="crm-input">
                            <option value="Cons. Final">Cons. Final</option>
                            <option value="Responsable Inscripto">Responsable Inscripto</option>
                            <option value="Monotributo">Monotributo</option>
                            <option value="Exento">Exento</option>
                        </select>
                    </div>
                    <div data-field="crm-product">
                        <label><i class="fas fa-shopping-bag"></i> Producto Ofrecido</label>
                        <input type="text" id="crm-product" class="crm-input" placeholder="Servicio/Producto...">
                    </div>
                    <div data-field="crm-source">
                        <label><i class="fas fa-bullhorn"></i> Fuente / Canal</label>
                        <select id="crm-source" class="crm-input">
                            <option value="">Desconocida</option>
                            <option value="Instagram">Instagram</option>
                            <option value="Facebook">Facebook</option>
                            <option value="WhatsApp">WhatsApp</option>
                            <option value="Web">Web</option>
                            <option value="Referido">Referido</option>
                            <option value="Manual CRM">Manual CRM</option>
                        </select>
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
                        <select id="crm-priority" class="crm-input">
                            <option value="Baja">Baja</option>
                            <option value="Media">Media</option>
                            <option value="Alta">Alta</option>
                        </select>
                    </div>
                    <div data-field="crm-status">
                        <label><i class="fas fa-tasks"></i> Estado del Lead (CRM)</label>
                        <select id="crm-status-select-side" class="crm-input"></select>
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

        <!-- Modal Generar Ticket -->
        <div id="ticket-modal" class="modal-overlay">
            <div class="modal-content animate-pop-in">
                <div class="modal-header">
                    <h3><i class="fas fa-ticket-alt modal-h3-icon"></i> Generar Nuevo Ticket</h3>
                    <button class="btn-close-modal" onclick="closeTicketModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="modal-section">
                        <label><i class="fas fa-heading"></i> Titulo del Ticket</label>
                        <input type="text" id="ticket-title" class="crm-input" placeholder="Ej: Problema con el pago">
                    </div>
                    <div class="ticket-modal-row">
                        <div class="ticket-modal-col">
                            <div class="modal-section">
                                <label><i class="fas fa-tag"></i> Tipo</label>
                                <select id="ticket-type" class="crm-input">
                                    <option value="Soporte">Soporte</option>
                                    <option value="Ventas">Ventas</option>
                                    <option value="Tecnico">Tecnico</option>
                                    <option value="Asistencia Externa">Asistencia Externa</option>
                                    <option value="Otro">Otro</option>
                                </select>
                            </div>
                        </div>
                        <div class="ticket-modal-col">
                            <div class="modal-section">
                                <label><i class="fas fa-flag"></i> Prioridad</label>
                                <select id="ticket-priority" class="crm-input">
                                    <option value="Baja">Baja</option>
                                    <option value="Media" selected>Media</option>
                                    <option value="Alta">Alta</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="modal-section">
                        <label><i class="fas fa-align-left"></i> Descripcion</label>
                        <textarea id="ticket-desc" class="crm-input" rows="4" placeholder="Detalles de la incidencia..."></textarea>
                    </div>
                    <button class="btn-primary btn-full-mt" onclick="createTicket()">
                        <i class="fas fa-save icon-mr"></i> Crear Ticket
                    </button>
                </div>
            </div>
        </div>

        <!-- Modal Plantillas Meta (Bulk) -->
        <div id="bulk-modal" class="modal-overlay">
            <div class="modal-content meta-modal-content animate-pop-in">
                <div class="modal-header">
                    <h3><i class="fab fa-whatsapp platform-whatsapp mr-2"></i> Centro de Plantillas Meta</h3>
                    <button class="btn-close-modal" onclick="toggleBulkModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="meta-tabs meta-tabs-bar">
                    <div id="tab-my-templates" class="meta-tab active" onclick="switchMetaTab('my')">
                        <i class="fas fa-list"></i> Mis Plantillas
                    </div>
                    <div class="meta-badge-bar">
                        <span class="meta-badge-title">Ver en META</span>
                        <a id="link-meta-library" href="https://business.facebook.com/latest/whatsapp_manager/template_library" target="_blank" class="meta-link-item">
                            <i class="fas fa-book"></i> Biblioteca <span class="meta-library-badge">SDK</span>
                        </a>
                        <a id="link-meta-new" href="https://business.facebook.com/latest/whatsapp_manager/message_templates" target="_blank" class="meta-link-item">
                            <i class="fas fa-plus"></i> Nueva Plantilla
                        </a>
                    </div>
                </div>
                <div class="meta-scroll-area">
                    <div id="view-my-templates" class="meta-grid">
                        <div id="my-templates-loader" class="text-center py-10 opacity-50" style="grid-column:1/-1;">
                            <i class="fas fa-circle-notch fa-spin text-3xl text-accent-bright"></i>
                            <p class="loader-sync-text text-sm text-secondary-content mt-3">Sincronizando con Meta Cloud...</p>
                        </div>
                    </div>
                    <div id="view-template-detail" style="display:none; padding:40px;">
                        <button class="btn-icon tpl-detail-back-btn mb-5" onclick="switchMetaTab('my')">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                        <div class="tpl-detail-grid">
                            <div class="meta-preview-overlay tpl-preview-col rounded-2xl overflow-hidden">
                                <div class="wa-preview-bubble">
                                    <div id="wa-preview-text-final" class="wa-preview-text">...</div>
                                    <div class="wa-preview-time">12:00 <i class="fas fa-check-double wa-check-icon"></i></div>
                                </div>
                            </div>
                            <div>
                                <div class="tpl-name-row">
                                    <h2 id="detail-tpl-name" class="tpl-name-header">Nombre de Plantilla</h2>
                                    <a id="btn-edit-in-meta" href="#" target="_blank">
                                        <i class="fab fa-facebook"></i> Editar en META
                                    </a>
                                </div>
                                <div id="detail-badges" class="tpl-detail-badges">
                                    <div id="detail-tpl-status" class="meta-card-tag">ESTADO</div>
                                    <span id="detail-tpl-lang-badge" class="tpl-info-badge"><i class="fas fa-globe"></i> ES</span>
                                    <span id="detail-tpl-cat-badge" class="tpl-info-badge"><i class="fas fa-tag"></i> CATEGORIA</span>
                                </div>
                                <div id="library-adopt-section" style="display:none;">
                                    <h4 class="library-adopt-heading text-sm font-heading font-bold text-primary-content mb-2">
                                        <i class="fas fa-copy"></i> Te gusta esta plantilla?
                                    </h4>
                                    <p class="library-adopt-desc text-xs text-secondary-content mb-3">Podes usarla como base para crear la tuya propia.</p>
                                    <button class="btn-primary w-full justify-center" onclick="useTemplateAsBase()">
                                        <i class="fas fa-magic"></i> Usar como Base
                                    </button>
                                </div>
                                <div id="bulk-actions-section" style="display:none;">
                                    <h4 class="bulk-actions-heading text-sm font-heading font-bold text-primary-content mb-2">
                                        <i class="fas fa-play"></i> Ejecutar Envio Masivo
                                    </h4>
                                    <p class="bulk-actions-desc text-xs text-secondary-content mb-4">Configura el archivo Excel para iniciar el envio.</p>
                                    <div class="bulk-actions-body">
                                        <div class="bulk-filter-section">
                                            <label class="bulk-filter-label"><i class="fas fa-filter"></i> Filtros de Descarga</label>
                                            <div class="bulk-filter-date-grid">
                                                <div>
                                                    <label class="bulk-filter-sublabel">Desde:</label>
                                                    <input type="date" id="bulk-filter-start" class="crm-input bulk-filter-input">
                                                </div>
                                                <div>
                                                    <label class="bulk-filter-sublabel">Hasta:</label>
                                                    <input type="date" id="bulk-filter-end" class="crm-input bulk-filter-input">
                                                </div>
                                            </div>
                                            <label class="bulk-filter-sublabel mb-1 block">Etiquetas (Ctrl/Cmd para varias)</label>
                                            <select id="bulk-filter-tags" class="crm-input" multiple style="min-height:80px;"></select>
                                        </div>
                                        <button class="btn-primary btn-download-excel" onclick="downloadBulkExcel()">
                                            <i class="fas fa-file-excel"></i> 1. Descargar Formato Excel
                                        </button>
                                        <div class="bulk-upload-section mt-5 pt-5" style="border-top:1px solid rgba(255,255,255,0.07);">
                                            <label class="bulk-filter-label">2. Subir Excel Completado</label>
                                            <div class="bulk-upload-row">
                                                <input type="file" id="bulk-file-input" class="crm-input" accept=".xlsx,.xls">
                                                <button class="btn-primary flex-shrink-0" onclick="startBulkSend()" id="send-bulk-btn">
                                                    <i class="fas fa-paper-plane"></i> Enviar
                                                </button>
                                            </div>
                                        </div>
                                        <div id="bulk-progress" style="display:none;" class="mt-5">
                                            <div class="bulk-progress-track">
                                                <div id="bulk-progress-bar" class="bulk-progress-bar" style="width:0%"></div>
                                            </div>
                                            <p id="bulk-status-text" class="bulk-status-text"></p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
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
            await loadViewScript('/js/backoffice.js?v=2');
            window._backofficeScriptLoaded = true;
        }
        // Siempre re-inicializar: tanto primera visita como re-visitas
        // (en primera visita el top-level del script ya corrió fetchChats, pero
        //  initBackofficeView re-engancha scroll listeners y garantiza carga completa)
        if (typeof window.initBackofficeView === 'function') {
            window.initBackofficeView();
        }

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
        // El socket de backoffice.js persiste entre visitas (no se desconecta)
    }
};
