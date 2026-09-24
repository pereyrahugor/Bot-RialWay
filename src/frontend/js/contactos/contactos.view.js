/* global navigate, showToast, Swal, batLoaderHtml */
window.contactosView = (() => {
    const CHANNELS = [
        { id: 'whatsapp', label: 'WhatsApp', icon: 'fab fa-whatsapp', color: '#22c55e' },
        { id: 'instagram', label: 'Instagram', icon: 'fab fa-instagram', color: '#e1306c' },
        { id: 'facebook', label: 'Facebook', icon: 'fab fa-facebook', color: '#1877f2' },
        { id: 'telegram', label: 'Telegram', icon: 'fab fa-telegram', color: '#0088cc' },
        { id: 'webchat', label: 'Webchat', icon: 'fas fa-headset', color: '#0099ff' }
    ];

    const state = {
        token: '',
        contacts: [],
        tags: [],
        importRows: [],
        selectedChannel: '',
        selectedFileName: '',
        search: '',
        channelFilter: '',
        tagFilter: '',
        leadFilter: '',
        expandedContactIds: new Set(),
        editingContactId: null,
        selectedFormTagIds: new Set(),
        activeDuplicate: null,
        searchTimer: null
    };

    function getHTML() {
        return `
        <main class="crm-main-container contactos-page" style="z-index:10; padding:0; width:100%; height:100%; min-height:0; flex:1; display:flex; flex-direction:column; overflow-y:auto; overflow-x:hidden;">
            ${window.renderSectionTabs ? window.renderSectionTabs('messaging') : ''}

            <header class="contactos-header animate-fade">
                <div class="contactos-header-info">
                    <h1>
                        <i class="fas fa-address-book"></i> 
                        Contactos & Agenda
                        <span id="contactos-total-count" class="contactos-count-badge">0</span>
                    </h1>
                    <p>Ficha de clientes, leads, etiquetas y agenda central unificada</p>
                </div>
                <div class="contactos-header-actions">
                    <button class="btn-primary" onclick="window.contactosView.openCreateModal()">
                        <i class="fas fa-user-plus"></i> Nuevo Contacto
                    </button>
                    <button class="btn-secondary" onclick="window.contactosView.openImportModal()">
                        <i class="fas fa-file-import"></i> Importar
                    </button>
                    <button class="btn-secondary" onclick="window.contactosView.downloadTemplate()" title="Descargar plantilla de Excel para importar contactos">
                        <i class="fas fa-download"></i> Plantilla Excel
                    </button>
                    <button class="btn-secondary" onclick="window.contactosView.loadContacts()" title="Recargar lista">
                        <i class="fas fa-rotate-right"></i>
                    </button>
                </div>
            </header>

            <section class="contactos-toolbar">
                <div class="contactos-search">
                    <i class="fas fa-search"></i>
                    <input id="contactos-search-input" type="text" placeholder="Buscar por nombre, apellido, teléfono, CUIT, empresa..." oninput="window.contactosView.handleSearch(this.value)">
                </div>
                <select id="contactos-channel-filter" onchange="window.contactosView.handleChannelFilter(this.value)">
                    <option value="">Todos los canales</option>
                    ${CHANNELS.map(ch => `<option value="${ch.id}">${ch.label}</option>`).join('')}
                </select>
                <select id="contactos-tag-filter" onchange="window.contactosView.handleTagFilter(this.value)">
                    <option value="">Todas las etiquetas</option>
                </select>
                <select id="contactos-lead-filter" onchange="window.contactosView.handleLeadFilter(this.value)">
                    <option value="">Todos los contactos</option>
                    <option value="leads">Solo Leads / Oportunidades</option>
                </select>
            </section>

            <section class="contactos-list-shell">
                <div class="contactos-table-head">
                    <span>Nombre y Apellido</span>
                    <span>Número / Contacto</span>
                    <span>CUIT / DNI</span>
                    <span>Empresa</span>
                    <span>Canal / Estado</span>
                    <span>Etiquetas</span>
                    <span style="text-align: right;">Acciones</span>
                </div>
                <div id="contactos-list" class="contactos-list">
                    ${typeof batLoaderHtml === 'function' ? batLoaderHtml('Cargando contactos...') : '<div class="contactos-empty"><i class="fas fa-circle-notch fa-spin"></i> Cargando contactos...</div>'}
                </div>
            </section>

            ${renderEditModal()}
            ${renderImportModal()}
            ${renderMergeModal()}
        </main>`;
    }

    function renderEditModal() {
        return `
        <div id="contactos-edit-modal" class="modal-overlay" style="display:none; z-index: 9999;">
            <div class="contactos-modal-shell animate-scale">
                <div class="contactos-modal-header">
                    <h3 id="contactos-modal-title"><i class="fas fa-user-pen"></i> Editar Contacto</h3>
                    <button class="modal-close" onclick="window.contactosView.closeEditModal()"><i class="fas fa-times"></i></button>
                </div>
                <form id="contactos-edit-form" onsubmit="window.contactosView.saveContactForm(event)" class="contactos-modal-body">
                    <!-- SECCIÓN 1: IDENTIDAD BÁSICA -->
                    <div class="contactos-form-section">
                        <div class="contactos-form-section-title"><i class="fas fa-id-badge"></i> Datos Principales</div>
                        <div class="contactos-form-grid-2">
                            <div class="contactos-form-group">
                                <label for="form-contact-name">Nombre *</label>
                                <input id="form-contact-name" type="text" placeholder="Ej: Juan" required>
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-apellido">Apellido</label>
                                <input id="form-contact-apellido" type="text" placeholder="Ej: Pérez">
                            </div>
                        </div>
                        <div class="contactos-form-grid-3">
                            <div class="contactos-form-group">
                                <label for="form-contact-phone">Teléfono / WhatsApp *</label>
                                <input id="form-contact-phone" type="tel" placeholder="Ej: 5491122334455" required>
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-email">Correo Electrónico</label>
                                <input id="form-contact-email" type="email" placeholder="correo@empresa.com">
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-channel">Canal / Origen</label>
                                <select id="form-contact-channel">
                                    ${CHANNELS.map(ch => `<option value="${ch.id}">${ch.label}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- SECCIÓN 2: DATOS COMERCIALES / EMPRESA -->
                    <div class="contactos-form-section">
                        <div class="contactos-form-section-title"><i class="fas fa-building"></i> Información Comercial & Fiscal</div>
                        <div class="contactos-form-grid-2">
                            <div class="contactos-form-group">
                                <label for="form-contact-empresa">Empresa / Razón Social</label>
                                <input id="form-contact-empresa" type="text" placeholder="Ej: Distribuidora Central SA">
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-cuit">CUIT / DNI</label>
                                <input id="form-contact-cuit" type="text" placeholder="Ej: 20-30405060-7">
                            </div>
                        </div>
                        <div class="contactos-form-grid-2">
                            <div class="contactos-form-group">
                                <label for="form-contact-tax-status">Situación Impositiva</label>
                                <select id="form-contact-tax-status">
                                    <option value="">Seleccionar...</option>
                                    <option value="Responsable Inscripto">Responsable Inscripto</option>
                                    <option value="Monotributo">Monotributo</option>
                                    <option value="Consumidor Final">Consumidor Final</option>
                                    <option value="Exento">Exento</option>
                                </select>
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-product">Producto Ofrecido / Interés</label>
                                <input id="form-contact-product" type="text" placeholder="Ej: Software ERP / Abono mensual">
                            </div>
                        </div>
                    </div>

                    <!-- SECCIÓN 3: UBICACIÓN & LOGÍSTICA -->
                    <div class="contactos-form-section">
                        <div class="contactos-form-section-title"><i class="fas fa-location-dot"></i> Domicilio & Logística</div>
                        <div class="contactos-form-grid-2">
                            <div class="contactos-form-group">
                                <label for="form-contact-address">Domicilio / Dirección</label>
                                <input id="form-contact-address" type="text" placeholder="Ej: Av. Colón 1234">
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-city">Localidad / Ciudad</label>
                                <input id="form-contact-city" type="text" placeholder="Ej: Córdoba Capital">
                            </div>
                        </div>
                        <div class="contactos-form-grid-2">
                            <div class="contactos-form-group">
                                <label for="form-contact-province">Provincia</label>
                                <input id="form-contact-province" type="text" placeholder="Ej: Córdoba">
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-transport">Transporte / Expreso</label>
                                <input id="form-contact-transport" type="text" placeholder="Ej: Expreso Brio">
                            </div>
                        </div>
                    </div>

                    <!-- SECCIÓN 4: CRM, PRIORIDAD Y FECHAS -->
                    <div class="contactos-form-section">
                        <div class="contactos-form-section-title"><i class="fas fa-chart-line"></i> Gestión CRM & Seguimiento</div>
                        <div class="contactos-form-grid-3">
                            <div class="contactos-form-group">
                                <label for="form-contact-status">Estado del Lead / CRM</label>
                                <select id="form-contact-status">
                                    <option value="">Sin clasificar (Solo contacto)</option>
                                    <option value="Nuevo">Nuevo Lead</option>
                                    <option value="Contactado">Contactado</option>
                                    <option value="Presupuesto">Presupuesto Enviado</option>
                                    <option value="Negociacion">En Negociación</option>
                                    <option value="Ganado">Cliente Ganado</option>
                                    <option value="Perdido">Perdido / Descartado</option>
                                </select>
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-priority">Prioridad</label>
                                <select id="form-contact-priority">
                                    <option value="Baja">Baja</option>
                                    <option value="Media" selected>Media</option>
                                    <option value="Alta">Alta</option>
                                    <option value="Urgente">Urgente</option>
                                </select>
                            </div>
                            <div class="contactos-form-group">
                                <label for="form-contact-due-date">Fecha Alerta / Seguimiento</label>
                                <input id="form-contact-due-date" type="date">
                            </div>
                        </div>
                    </div>

                    <!-- SECCIÓN 5: ETIQUETAS -->
                    <div class="contactos-form-section">
                        <div class="contactos-form-section-title"><i class="fas fa-tags"></i> Etiquetas Asociadas</div>
                        <div id="contactos-form-tags-selector" class="contactos-tag-selector">
                            <!-- Inyectado dinámicamente -->
                        </div>
                    </div>

                    <!-- SECCIÓN 6: NOTAS -->
                    <div class="contactos-form-section">
                        <div class="contactos-form-section-title"><i class="fas fa-note-sticky"></i> Historial de Notas</div>
                        <div class="contactos-form-group">
                            <label for="form-contact-notes">Notas Individuales del Contacto</label>
                            <textarea id="form-contact-notes" rows="3" placeholder="Comentarios, requerimientos o detalles específicos..."></textarea>
                        </div>
                        <div class="contactos-form-group">
                            <label for="form-contact-shared-notes"><i class="fas fa-share-nodes" style="color:#f59e0b;"></i> Notas Compartidas Corporativas (Sincronizadas por CUIT / Empresa)</label>
                            <textarea id="form-contact-shared-notes" rows="2" placeholder="Notas que se comparten automáticamente con todos los contactos de la misma empresa..."></textarea>
                        </div>
                    </div>

                    <div class="contactos-modal-footer">
                        <button type="button" class="btn-secondary" onclick="window.contactosView.closeEditModal()">Cancelar</button>
                        <button type="submit" id="contactos-save-btn" class="btn-primary">
                            <i class="fas fa-save"></i> Guardar Contacto
                        </button>
                    </div>
                </form>
            </div>
        </div>`;
    }

    function renderImportModal() {
        return `
        <div id="contact-import-modal" class="modal-overlay" style="display:none; z-index: 9999;">
            <div class="modal-content modal-content-lg contactos-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-file-import modal-h3-icon"></i> Importar Contactos desde Archivo</h3>
                    <button class="modal-close" onclick="window.contactosView.closeImportModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <p style="font-size: 0.88rem; color: var(--text-muted); margin: 0 0 1rem;">
                        Selecciona el canal principal para los contactos a importar y sube un archivo Excel (.xlsx, .xls), CSV o vCard (.vcf).
                    </p>
                    <div class="contactos-channel-grid">
                        ${CHANNELS.map(ch => `
                            <button type="button" class="contactos-channel-option" data-channel="${ch.id}" onclick="window.contactosView.selectImportChannel('${ch.id}')">
                                <i class="${ch.icon}" style="color:${ch.color}"></i>
                                <span>${ch.label}</span>
                            </button>
                        `).join('')}
                    </div>

                    <div id="contactos-import-file-step" class="contactos-import-file-step" style="display:none; margin-top: 1.25rem;">
                        <label for="contactos-import-file" style="font-weight: 700; font-size: 0.88rem; display: block; margin-bottom: 0.5rem;">
                            <i class="fas fa-file-excel" style="color: #22c55e;"></i> Seleccionar archivo (.xlsx, .xls, .csv, .vcf)
                        </label>
                        <input id="contactos-import-file" type="file" accept=".xlsx,.xls,.vcf,.csv" onchange="window.contactosView.handleImportFile(this.files)" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px dashed rgba(0,153,255,0.3); background: rgba(15,42,68,0.5);">
                    </div>

                    <div id="contactos-import-summary" class="contactos-import-summary" style="display:none; margin-top: 1rem;"></div>
                    <div id="contactos-import-preview" class="contactos-import-preview" style="max-height: 280px; overflow-y: auto; margin-top: 1rem;"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="window.contactosView.closeImportModal()">Cancelar</button>
                    <button id="contactos-save-import-btn" class="btn-success" onclick="window.contactosView.saveImport()" disabled>
                        <i class="fas fa-check"></i> Guardar Contactos
                    </button>
                </div>
            </div>
        </div>`;
    }

    function renderMergeModal() {
        return `
        <div id="contact-merge-modal" class="modal-overlay" style="display:none; z-index: 10000;">
            <div class="modal-content modal-content-lg contactos-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-code-merge modal-h3-icon"></i> Combinar duplicados</h3>
                    <button class="modal-close" onclick="window.contactosView.closeMergeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="contactos-merge-grid">
                        <div>
                            <h4 class="contactos-merge-title">Filas detectadas</h4>
                            <div id="contactos-merge-options" class="contactos-merge-options"></div>
                        </div>
                        <div>
                            <h4 class="contactos-merge-title">Contacto final</h4>
                            <div class="contactos-merge-form">
                                <label>Número</label>
                                <input id="contactos-merge-phone" type="text">
                                <label>Nombre</label>
                                <input id="contactos-merge-name" type="text">
                                <label>Email</label>
                                <input id="contactos-merge-email" type="email">
                                <label>Identificador del canal</label>
                                <input id="contactos-merge-channel-value" type="text">
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="window.contactosView.closeMergeModal()">Cancelar</button>
                    <button class="btn-success" onclick="window.contactosView.applyMerge()">
                        <i class="fas fa-check"></i> Combinar
                    </button>
                </div>
            </div>
        </div>`;
    }

    async function init() {
        state.token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
        state.contacts = [];
        state.tags = [];
        state.expandedContactIds = new Set();
        state.selectedFormTagIds = new Set();

        await Promise.all([
            loadTags(),
            loadContacts()
        ]);
    }

    function destroy() {
        state.expandedContactIds.clear();
        state.selectedFormTagIds.clear();
        state.activeDuplicate = null;
    }

    async function loadTags() {
        try {
            const res = await fetch(`/api/backoffice/tags?token=${encodeURIComponent(state.token)}`);
            const data = await res.json();
            if (res.ok && Array.isArray(data)) {
                state.tags = data;
                populateTagFilter();
            }
        } catch (e) {
            console.warn('[Contactos] No se pudieron cargar las etiquetas:', e);
        }
    }

    function populateTagFilter() {
        const select = document.getElementById('contactos-tag-filter');
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">Todas las etiquetas</option>' +
            state.tags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        select.value = currentVal || '';
    }

    async function loadContacts() {
        const list = document.getElementById('contactos-list');
        if (list) {
            list.innerHTML = typeof batLoaderHtml === 'function' 
                ? batLoaderHtml('Cargando agenda de contactos...') 
                : '<div class="contactos-empty"><i class="fas fa-circle-notch fa-spin"></i> Cargando contactos...</div>';
        }

        try {
            const params = new URLSearchParams();
            params.set('token', state.token);
            params.set('limit', '200');
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
            if (state.search) params.set('search', state.search);
            if (state.channelFilter) params.set('channel', state.channelFilter);
            if (state.tagFilter) params.set('tagId', state.tagFilter);
            if (state.leadFilter === 'leads') params.set('leadOnly', 'true');

            const res = await fetch(`/api/backoffice/contacts?${params.toString()}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar los contactos');

            state.contacts = Array.isArray(data.contacts) ? data.contacts : [];
            updateTotalBadge();
            renderContacts();
        } catch (error) {
            console.error('[Contactos] Error cargando:', error);
            if (list) list.innerHTML = `<div class="contactos-empty error"><i class="fas fa-triangle-exclamation"></i> ${escapeHtml(error.message)}</div>`;
        }
    }

    function updateTotalBadge() {
        const badge = document.getElementById('contactos-total-count');
        if (badge) badge.textContent = `${state.contacts.length} contactos`;
    }

    function renderContacts() {
        const list = document.getElementById('contactos-list');
        if (!list) return;

        if (!state.contacts.length) {
            list.innerHTML = `
                <div class="contactos-empty">
                    <i class="fas fa-address-book" style="font-size: 2.2rem; opacity: 0.35; margin-bottom: 0.5rem; display:block;"></i>
                    <span>No se encontraron contactos en esta vista.</span>
                    <button class="btn-primary" style="margin-top: 0.85rem;" onclick="window.contactosView.openCreateModal()">
                        <i class="fas fa-user-plus"></i> Agregar Primer Contacto
                    </button>
                </div>`;
            return;
        }

        list.innerHTML = state.contacts.map(contact => {
            const isExpanded = state.expandedContactIds.has(contact.id);
            const initials = getInitials(contact.name || contact.phone || '?');
            const channel = getContactChannel(contact);
            const phone = contact.phone || contact.phoneRaw || contact.id || '-';
            const cuit = contact.cuit_dni || contact.cuit || '-';
            const empresa = contact.empresa || '-';

            return `
            <div class="contactos-item-wrapper ${isExpanded ? 'expanded' : ''}" id="contact-wrapper-${contact.id}">
                <div class="contactos-row" onclick="window.contactosView.toggleExpand('${contact.id}')" title="Haz clic para ver la ficha completa">
                    <!-- NOMBRE Y APELLIDO -->
                    <div class="contactos-name-cell">
                        <div class="contactos-avatar">${escapeHtml(initials)}</div>
                        <div class="contactos-name-info">
                            <span class="contactos-name-primary">${escapeHtml(contact.name || 'Sin nombre registrado')}</span>
                            ${contact.email ? `<span class="contactos-name-sub"><i class="fas fa-envelope"></i> ${escapeHtml(contact.email)}</span>` : ''}
                        </div>
                    </div>

                    <!-- NÚMERO / CONTACTO -->
                    <div class="contactos-phone-cell">
                        <i class="${channel.icon}"></i>
                        <span>${escapeHtml(phone)}</span>
                    </div>

                    <!-- CUIT / DNI -->
                    <div>
                        ${cuit !== '-' ? `<span class="contactos-cuit-badge"><i class="fas fa-fingerprint"></i> ${escapeHtml(cuit)}</span>` : '<span style="color:var(--text-muted); font-size:0.84rem;">-</span>'}
                    </div>

                    <!-- EMPRESA -->
                    <div class="contactos-empresa-cell">
                        ${empresa !== '-' ? `<i class="fas fa-building"></i> <span>${escapeHtml(empresa)}</span>` : '<span style="color:var(--text-muted); font-size:0.84rem;">-</span>'}
                    </div>

                    <!-- CANAL / ESTADO -->
                    <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                        <span class="contactos-channel-pill">
                            <i class="${channel.icon}" style="color:${channel.color}"></i> ${escapeHtml(channel.label)}
                        </span>
                        ${contact.crm_status ? `<span class="contactos-lead-pill"><i class="fas fa-tag"></i> ${escapeHtml(contact.crm_status)}</span>` : ''}
                    </div>

                    <!-- ETIQUETAS -->
                    <div class="contactos-tags-cell">
                        ${(contact.tags && contact.tags.length > 0)
                            ? contact.tags.map(t => `
                                <span class="contactos-tag-chip" style="border-color:${t.color || '#38bdf8'}40; background:${t.color || '#38bdf8'}18;">
                                    <span class="contactos-tag-dot" style="background:${t.color || '#38bdf8'};"></span>
                                    ${escapeHtml(t.name)}
                                </span>
                            `).join('')
                            : '<span style="color:var(--text-muted); font-size:0.75rem;">Sin etiquetas</span>'
                        }
                    </div>

                    <!-- ACCIONES -->
                    <div class="contactos-row-actions" onclick="event.stopPropagation()">
                        <button class="btn-secondary btn-sm" onclick="window.contactosView.openEditContact('${contact.id}')" title="Editar contacto">
                            <i class="fas fa-pen"></i>
                        </button>
                        <div class="contactos-chevron" onclick="window.contactosView.toggleExpand('${contact.id}')">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                </div>

                <!-- DESPLEGABLE / EXPANDABLE DRAWER -->
                <div class="contactos-drawer" id="drawer-${contact.id}" style="${isExpanded ? 'display:block;' : 'display:none;'}">
                    <div class="contactos-drawer-grid">
                        <!-- COLUMNA 1: CONTACTO & UBICACIÓN -->
                        <div class="contactos-drawer-card">
                            <h4 class="contactos-drawer-card-title"><i class="fas fa-map-location-dot"></i> Contacto & Ubicación</h4>
                            <div class="contactos-drawer-fields">
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Correo Electrónico</span>
                                    <span class="contactos-drawer-value">
                                        ${contact.email ? `<a href="mailto:${escapeHtml(contact.email)}" style="color:#38bdf8; text-decoration:none;"><i class="fas fa-envelope"></i> ${escapeHtml(contact.email)}</a>` : '<em style="color:var(--text-muted);">No registrado</em>'}
                                    </span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Domicilio</span>
                                    <span class="contactos-drawer-value">${escapeHtml(contact.address || 'No registrado')}</span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Localidad / Provincia</span>
                                    <span class="contactos-drawer-value">${escapeHtml([contact.localidad, contact.provincia].filter(Boolean).join(', ') || 'No registrado')}</span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Transporte / Expreso</span>
                                    <span class="contactos-drawer-value">${escapeHtml(contact.transporte || 'No registrado')}</span>
                                </div>
                            </div>
                        </div>

                        <!-- COLUMNA 2: COMERCIAL & CRM -->
                        <div class="contactos-drawer-card">
                            <h4 class="contactos-drawer-card-title"><i class="fas fa-briefcase"></i> Ficha Comercial & CRM</h4>
                            <div class="contactos-drawer-fields">
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Empresa / Razón Social</span>
                                    <span class="contactos-drawer-value">${escapeHtml(contact.empresa || 'No especificada')}</span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Situación Impositiva</span>
                                    <span class="contactos-drawer-value">${escapeHtml(contact.tax_status || 'No registrada')}</span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Producto Ofrecido / Interés</span>
                                    <span class="contactos-drawer-value">${escapeHtml(contact.offered_product || 'No especificado')}</span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Estado CRM / Lead</span>
                                    <span class="contactos-drawer-value">
                                        ${contact.crm_status ? `<span class="contactos-lead-pill">${escapeHtml(contact.crm_status)}</span>` : '<em style="color:var(--text-muted);">Sin estado</em>'}
                                        ${contact.priority ? ` &bull; <small>Prioridad: <strong>${escapeHtml(contact.priority)}</strong></small>` : ''}
                                    </span>
                                </div>
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Fecha Alerta / Seguimiento</span>
                                    <span class="contactos-drawer-value">${formatDate(contact.crm_due_date)}</span>
                                </div>
                            </div>
                        </div>

                        <!-- COLUMNA 3: NOTAS Y OBSERVACIONES -->
                        <div class="contactos-drawer-card">
                            <h4 class="contactos-drawer-card-title"><i class="fas fa-comment-dots"></i> Notas & Observaciones</h4>
                            <div class="contactos-drawer-fields">
                                <div class="contactos-drawer-field">
                                    <span class="contactos-drawer-label">Notas del Contacto</span>
                                    <div class="contactos-drawer-notes-box">
                                        ${contact.notes ? escapeHtml(contact.notes) : '<em style="color:var(--text-muted);">Sin notas registradas para este contacto.</em>'}
                                    </div>
                                </div>
                                ${contact.shared_notes ? `
                                    <div class="contactos-drawer-shared-notes">
                                        <div class="contactos-drawer-shared-title">
                                            <i class="fas fa-building"></i> Notas Corporativas Compartidas
                                        </div>
                                        <div style="font-size:0.83rem; color:var(--text-main); white-space:pre-wrap;">
                                            ${escapeHtml(contact.shared_notes)}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <!-- FOOTER DEL DESPLEGABLE: ETIQUETAS Y ACCIONES -->
                    <div class="contactos-drawer-footer">
                        <div class="contactos-drawer-tags-wrap">
                            <span class="contactos-drawer-label" style="margin-right: 0.5rem;"><i class="fas fa-tags"></i> Etiquetas:</span>
                            ${(contact.tags && contact.tags.length > 0)
                                ? contact.tags.map(t => `
                                    <span class="contactos-tag-chip" style="border-color:${t.color || '#38bdf8'}40; background:${t.color || '#38bdf8'}18;">
                                        <span class="contactos-tag-dot" style="background:${t.color || '#38bdf8'};"></span>
                                        ${escapeHtml(t.name)}
                                    </span>
                                `).join('')
                                : '<em style="color:var(--text-muted); font-size:0.82rem;">Ninguna</em>'
                            }
                        </div>

                        <div class="contactos-drawer-btns">
                            <button class="btn-primary btn-sm" onclick="window.contactosView.openEditContact('${contact.id}')">
                                <i class="fas fa-pen-to-square"></i> Editar Ficha Completa
                            </button>
                            <button class="btn-success btn-sm" onclick="window.contactosView.openChat('${contact.id}')" title="Abrir chat en mensajería">
                                <i class="fas fa-comments"></i> Abrir Chat
                            </button>
                            <button class="btn-danger btn-sm" onclick="window.contactosView.deleteContact('${contact.id}')" title="Eliminar contacto de la base de datos">
                                <i class="fas fa-trash-alt"></i> Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function toggleExpand(contactId) {
        const wrapper = document.getElementById(`contact-wrapper-${contactId}`);
        const drawer = document.getElementById(`drawer-${contactId}`);
        if (!wrapper || !drawer) return;

        if (state.expandedContactIds.has(contactId)) {
            state.expandedContactIds.delete(contactId);
            wrapper.classList.remove('expanded');
            drawer.style.display = 'none';
        } else {
            state.expandedContactIds.add(contactId);
            wrapper.classList.add('expanded');
            drawer.style.display = 'block';
        }
    }

    function handleSearch(value) {
        state.search = String(value || '').trim();
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(loadContacts, 250);
    }

    function handleChannelFilter(value) {
        state.channelFilter = value || '';
        loadContacts();
    }

    function handleTagFilter(value) {
        state.tagFilter = value || '';
        loadContacts();
    }

    function handleLeadFilter(value) {
        state.leadFilter = value || '';
        loadContacts();
    }

    function openCreateModal() {
        state.editingContactId = null;
        state.selectedFormTagIds.clear();

        document.getElementById('contactos-modal-title').innerHTML = '<i class="fas fa-user-plus"></i> Nuevo Contacto';
        document.getElementById('contactos-save-btn').innerHTML = '<i class="fas fa-save"></i> Crear Contacto';

        setValue('form-contact-name', '');
        setValue('form-contact-apellido', '');
        setValue('form-contact-phone', '');
        setValue('form-contact-email', '');
        setValue('form-contact-channel', 'whatsapp');
        setValue('form-contact-empresa', '');
        setValue('form-contact-cuit', '');
        setValue('form-contact-tax-status', '');
        setValue('form-contact-product', '');
        setValue('form-contact-address', '');
        setValue('form-contact-city', '');
        setValue('form-contact-province', '');
        setValue('form-contact-transport', '');
        setValue('form-contact-status', '');
        setValue('form-contact-priority', 'Media');
        setValue('form-contact-due-date', '');
        setValue('form-contact-notes', '');
        setValue('form-contact-shared-notes', '');

        document.getElementById('form-contact-phone').readOnly = false;
        renderFormTagSelector();

        const modal = document.getElementById('contactos-edit-modal');
        if (modal) modal.style.display = 'flex';
    }

    function openEditContact(contactId) {
        const contact = state.contacts.find(c => c.id === contactId);
        if (!contact) return;

        state.editingContactId = contactId;
        state.selectedFormTagIds = new Set((contact.tags || []).map(t => t.id));

        document.getElementById('contactos-modal-title').innerHTML = '<i class="fas fa-user-pen"></i> Editar Contacto / Ficha';
        document.getElementById('contactos-save-btn').innerHTML = '<i class="fas fa-save"></i> Guardar Cambios';

        setValue('form-contact-name', contact.firstName || contact.name || '');
        setValue('form-contact-apellido', contact.lastName || '');
        setValue('form-contact-phone', contact.phone || contact.id || '');
        setValue('form-contact-email', contact.email || '');
        setValue('form-contact-channel', contact.channel || 'whatsapp');
        setValue('form-contact-empresa', contact.empresa || '');
        setValue('form-contact-cuit', contact.cuit_dni || contact.cuit || '');
        setValue('form-contact-tax-status', contact.tax_status || '');
        setValue('form-contact-product', contact.offered_product || '');
        setValue('form-contact-address', contact.address || '');
        setValue('form-contact-city', contact.localidad || '');
        setValue('form-contact-province', contact.provincia || '');
        setValue('form-contact-transport', contact.transporte || '');
        setValue('form-contact-status', contact.crm_status || '');
        setValue('form-contact-priority', contact.priority || 'Media');
        setValue('form-contact-due-date', contact.crm_due_date ? contact.crm_due_date.split('T')[0] : '');
        setValue('form-contact-notes', contact.notes || '');
        setValue('form-contact-shared-notes', contact.shared_notes || '');

        document.getElementById('form-contact-phone').readOnly = true;
        renderFormTagSelector();

        const modal = document.getElementById('contactos-edit-modal');
        if (modal) modal.style.display = 'flex';
    }

    function renderFormTagSelector() {
        const container = document.getElementById('contactos-form-tags-selector');
        if (!container) return;

        if (!state.tags.length) {
            container.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">No hay etiquetas creadas en este proyecto.</span>';
            return;
        }

        container.innerHTML = state.tags.map(t => {
            const isSelected = state.selectedFormTagIds.has(t.id);
            return `
            <button type="button" class="contactos-tag-toggle-btn ${isSelected ? 'selected' : ''}" onclick="window.contactosView.toggleFormTag('${t.id}')">
                <span class="contactos-tag-dot" style="background:${t.color || '#38bdf8'};"></span>
                <span>${escapeHtml(t.name)}</span>
                ${isSelected ? '<i class="fas fa-check" style="font-size:0.7rem; margin-left:2px;"></i>' : ''}
            </button>`;
        }).join('');
    }

    function toggleFormTag(tagId) {
        if (state.selectedFormTagIds.has(tagId)) {
            state.selectedFormTagIds.delete(tagId);
        } else {
            state.selectedFormTagIds.add(tagId);
        }
        renderFormTagSelector();
    }

    function closeEditModal() {
        const modal = document.getElementById('contactos-edit-modal');
        if (modal) modal.style.display = 'none';
        state.editingContactId = null;
        state.selectedFormTagIds.clear();
    }

    async function saveContactForm(e) {
        if (e) e.preventDefault();

        const phone = getValue('form-contact-phone');
        if (!phone) {
            notify('El número de teléfono es obligatorio.', 'error');
            return;
        }

        const name = getValue('form-contact-name');
        const apellido = getValue('form-contact-apellido');
        const email = getValue('form-contact-email');
        const channel = getValue('form-contact-channel') || 'whatsapp';
        const empresa = getValue('form-contact-empresa');
        const cuit = getValue('form-contact-cuit');
        const taxStatus = getValue('form-contact-tax-status');
        const product = getValue('form-contact-product');
        const address = getValue('form-contact-address');
        const city = getValue('form-contact-city');
        const province = getValue('form-contact-province');
        const transport = getValue('form-contact-transport');
        const status = getValue('form-contact-status');
        const priority = getValue('form-contact-priority') || 'Media';
        const dueDate = getValue('form-contact-due-date') || null;
        const notes = getValue('form-contact-notes');
        const sharedNotes = getValue('form-contact-shared-notes');
        const tagIds = Array.from(state.selectedFormTagIds);

        const targetProjectId = window.railwayProjectId || '';
        const targetServiceId = window.railwayServiceId || '';

        const payload = {
            phone,
            name,
            apellido,
            email,
            channel,
            empresa,
            cuit_dni: cuit,
            tax_status: taxStatus,
            offered_product: product,
            address,
            localidad: city,
            provincia: province,
            transporte: transport,
            crm_status: status,
            crm_due_date: dueDate,
            priority,
            notes,
            shared_notes: sharedNotes,
            tagIds,
            projectId: targetProjectId,
            serviceId: targetServiceId
        };

        const saveBtn = document.getElementById('contactos-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';
        }

        try {
            const isEdit = Boolean(state.editingContactId);
            const url = isEdit 
                ? `/api/backoffice/contacts/${encodeURIComponent(state.editingContactId)}?token=${encodeURIComponent(state.token)}&projectId=${encodeURIComponent(targetProjectId)}&serviceId=${encodeURIComponent(targetServiceId)}`
                : `/api/backoffice/contacts?token=${encodeURIComponent(state.token)}&projectId=${encodeURIComponent(targetProjectId)}&serviceId=${encodeURIComponent(targetServiceId)}`;

            const res = await fetch(url, {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Error guardando contacto');
            }

            notify(isEdit ? 'Contacto actualizado correctamente' : 'Contacto creado correctamente', 'success');
            closeEditModal();
            await loadContacts();
        } catch (error) {
            console.error('[Contactos] Error al guardar:', error);
            notify(error.message || 'Error al guardar contacto', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Guardar Contacto';
            }
        }
    }

    async function deleteContact(contactId) {
        const contact = state.contacts.find(c => c.id === contactId);
        const name = contact?.name || contactId;

        const confirm = typeof window.swalConfirm === 'function' 
            ? await window.swalConfirm('¿Eliminar contacto?', `Se eliminará '${name}' y su historial asociado de este proyecto.`)
            : window.confirm(`¿Estás seguro de eliminar el contacto '${name}'?`);

        if (!confirm) return;

        try {
            const targetProjectId = window.railwayProjectId || '';
            const targetServiceId = window.railwayServiceId || '';
            const params = new URLSearchParams({ token: state.token });
            if (targetProjectId) params.set('projectId', targetProjectId);
            if (targetServiceId) params.set('serviceId', targetServiceId);

            const res = await fetch(`/api/backoffice/contacts/${encodeURIComponent(contactId)}?${params.toString()}`, {
                method: 'DELETE'
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Error al eliminar contacto');
            }

            notify('Contacto eliminado', 'success');
            state.expandedContactIds.delete(contactId);
            await loadContacts();
        } catch (error) {
            console.error('[Contactos] Error eliminando:', error);
            notify(error.message || 'Error al eliminar', 'error');
        }
    }

    function openChat(contactId) {
        const contact = state.contacts.find(c => c.id === contactId);
        const phone = contact?.phone || contactId;
        if (typeof navigate === 'function') {
            navigate(`/conversaciones?chatId=${encodeURIComponent(phone)}`);
        } else {
            window.location.href = `/conversaciones?chatId=${encodeURIComponent(phone)}`;
        }
    }

    function downloadTemplate() {
        const params = new URLSearchParams({ token: state.token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
        window.open(`/api/backoffice/chats/import-template?${params.toString()}`, '_blank');
    }

    /* --- IMPORT MODAL LOGIC --- */
    function openImportModal() {
        state.importRows = [];
        state.selectedChannel = '';
        state.selectedFileName = '';
        const modal = document.getElementById('contact-import-modal');
        if (modal) modal.style.display = 'flex';
        resetImportModal();
    }

    function closeImportModal() {
        const modal = document.getElementById('contact-import-modal');
        if (modal) modal.style.display = 'none';
    }

    function resetImportModal() {
        document.querySelectorAll('.contactos-channel-option').forEach(btn => btn.classList.remove('active'));
        const fileStep = document.getElementById('contactos-import-file-step');
        const input = document.getElementById('contactos-import-file');
        const preview = document.getElementById('contactos-import-preview');
        const summary = document.getElementById('contactos-import-summary');
        const saveBtn = document.getElementById('contactos-save-import-btn');
        if (fileStep) fileStep.style.display = 'none';
        if (input) input.value = '';
        if (preview) preview.innerHTML = '';
        if (summary) {
            summary.innerHTML = '';
            summary.style.display = 'none';
        }
        if (saveBtn) saveBtn.disabled = true;
    }

    function selectImportChannel(channel) {
        state.selectedChannel = channel;
        document.querySelectorAll('.contactos-channel-option').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-channel') === channel);
        });
        const fileStep = document.getElementById('contactos-import-file-step');
        if (fileStep) fileStep.style.display = 'block';
    }

    async function handleImportFile(files) {
        const file = files && files[0];
        if (!file || !state.selectedChannel) return;

        state.selectedFileName = file.name;
        const preview = document.getElementById('contactos-import-preview');
        if (preview) preview.innerHTML = typeof batLoaderHtml === 'function' ? batLoaderHtml('Procesando archivo...') : '<div class="contactos-empty"><i class="fas fa-circle-notch fa-spin"></i> Procesando archivo...</div>';

        try {
            const ext = file.name.split('.').pop().toLowerCase();
            let rows = [];
            if (ext === 'vcf') rows = parseVcf(await file.text());
            else if (ext === 'csv') rows = parseCsv(await file.text());
            else if (ext === 'xlsx' || ext === 'xls') rows = await parseWorkbook(file);
            else throw new Error('Formato no soportado. Debe ser .xlsx, .xls, .csv o .vcf');

            state.importRows = rows
                .map((row, index) => normalizeImportRow(row, index, state.selectedChannel))
                .filter(row => row.name || row.phoneNormalized || row.email || row.channelValue);

            renderImportPreview();
        } catch (error) {
            console.error('[Contactos] Error importando:', error);
            if (preview) preview.innerHTML = `<div class="contactos-empty error">${escapeHtml(error.message)}</div>`;
            const saveBtn = document.getElementById('contactos-save-import-btn');
            if (saveBtn) saveBtn.disabled = true;
        }
    }

    function renderImportPreview() {
        const preview = document.getElementById('contactos-import-preview');
        const summary = document.getElementById('contactos-import-summary');
        const saveBtn = document.getElementById('contactos-save-import-btn');
        if (!preview || !summary || !saveBtn) return;

        summary.style.display = 'flex';
        summary.innerHTML = `
            <div style="display:flex; align-items:center; gap:1rem; padding:0.6rem 0.85rem; border-radius:8px; background:rgba(0,153,255,0.1); border:1px solid rgba(0,153,255,0.2); font-size:0.84rem; font-weight:700;">
                <span><i class="fas fa-list"></i> ${state.importRows.length} contactos detectados</span>
                <span><i class="fas fa-file"></i> ${escapeHtml(state.selectedFileName)}</span>
            </div>
        `;

        if (!state.importRows.length) {
            preview.innerHTML = '<div class="contactos-empty">No se detectaron contactos válidos en el archivo.</div>';
            saveBtn.disabled = true;
            return;
        }

        preview.innerHTML = `
            <div style="border:1px solid rgba(0,153,255,0.15); border-radius:8px; overflow:hidden; font-size:0.83rem;">
                <div style="display:grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; background:rgba(15,42,68,0.8); padding:0.5rem 0.75rem; font-weight:700; color:var(--text-muted);">
                    <span>Nombre</span>
                    <span>Número</span>
                    <span>CUIT</span>
                    <span>Empresa</span>
                </div>
                ${state.importRows.slice(0, 50).map(row => `
                    <div style="display:grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; padding:0.45rem 0.75rem; border-top:1px solid rgba(255,255,255,0.05);">
                        <span>${escapeHtml(row.name || '-')}</span>
                        <span>${escapeHtml(row.phoneNormalized || row.phoneRaw || '-')}</span>
                        <span>${escapeHtml(row.cuit || '-')}</span>
                        <span>${escapeHtml(row.empresa || '-')}</span>
                    </div>
                `).join('')}
                ${state.importRows.length > 50 ? `<div style="padding:0.5rem; text-align:center; color:var(--text-muted); font-size:0.78rem;">... y ${state.importRows.length - 50} filas más</div>` : ''}
            </div>
        `;
        saveBtn.disabled = false;
    }

    async function saveImport() {
        if (!state.importRows.length) return;

        const saveBtn = document.getElementById('contactos-save-import-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando en base de datos...';
        }

        let saved = 0;
        let failed = 0;

        const targetProjectId = window.railwayProjectId || '';
        const targetServiceId = window.railwayServiceId || '';

        for (const row of state.importRows) {
            try {
                const params = new URLSearchParams({ token: state.token });
                if (targetProjectId) params.set('projectId', targetProjectId);
                if (targetServiceId) params.set('serviceId', targetServiceId);

                const res = await fetch(`/api/backoffice/contacts?${params.toString()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channel: row.channel,
                        channelValue: row.channelValue,
                        name: row.name,
                        apellido: row.apellido,
                        phoneRaw: row.phoneRaw,
                        phoneNormalized: row.phoneNormalized,
                        email: row.email,
                        cuit_dni: row.cuit,
                        empresa: row.empresa,
                        address: row.address,
                        localidad: row.localidad,
                        provincia: row.provincia,
                        transporte: row.transporte,
                        notes: row.notes,
                        source: 'import_file',
                        projectId: targetProjectId,
                        serviceId: targetServiceId,
                        metadata: {
                            file_name: state.selectedFileName,
                            original_row: row.originalIndex + 1
                        }
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Error');
                saved += 1;
            } catch (error) {
                console.error('[Contactos] Error guardando fila:', error);
                failed += 1;
            }
        }

        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Guardar Contactos';
            saveBtn.disabled = false;
        }

        closeImportModal();
        notify(`Importación completada: ${saved} guardados${failed ? `, ${failed} errores` : ''}.`, failed ? 'warning' : 'success');
        await loadContacts();
    }

    function normalizeImportRow(row, index, channel) {
        const name = pickValue(row, ['nombre', 'name', 'first name', 'firstname', 'fn']);
        const apellido = pickValue(row, ['apellido', 'last name', 'lastname', 'ln']);
        const phoneRaw = pickValue(row, ['telefono', 'teléfono', 'phone', 'numero', 'número', 'whatsapp', 'celular', 'mobile', 'tel', 'contacto']);
        const email = pickValue(row, ['email', 'mail', 'correo', 'emails']);
        const cuit = pickValue(row, ['cuit', 'dni', 'cuit_dni', 'cuil', 'documento']);
        const empresa = pickValue(row, ['empresa', 'company', 'razon social', 'razon_social']);
        const address = pickValue(row, ['direccion', 'dirección', 'address', 'domicilio', 'calle']);
        const localidad = pickValue(row, ['localidad', 'city', 'ciudad']);
        const provincia = pickValue(row, ['provincia', 'state']);
        const transporte = pickValue(row, ['transporte', 'expreso', 'logistica']);
        const notes = pickValue(row, ['notas', 'nota', 'notes', 'notas_1', 'notas1', 'observaciones']);

        const channelValue = pickValue(row, [channel, `${channel}_channel`, 'usuario', 'username', 'id', 'identificador']) || phoneRaw || email || name;
        const phoneNormalized = normalizePhone(phoneRaw);

        let fullName = name;
        if (apellido) fullName = name ? `${name} ${apellido}`.trim() : apellido;

        return {
            _tmpId: `row-${Date.now()}-${index}`,
            originalIndex: index,
            channel,
            channelValue: channel === 'whatsapp' ? phoneNormalized || phoneRaw : String(channelValue || '').trim(),
            name: String(fullName || '').trim(),
            apellido: String(apellido || '').trim(),
            phoneRaw: String(phoneRaw || '').trim(),
            phoneNormalized,
            email: String(email || '').trim(),
            cuit: String(cuit || '').trim(),
            empresa: String(empresa || '').trim(),
            address: String(address || '').trim(),
            localidad: String(localidad || '').trim(),
            provincia: String(provincia || '').trim(),
            transporte: String(transporte || '').trim(),
            notes: String(notes || '').trim()
        };
    }

    function pickValue(row, keys) {
        const normalizedMap = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            normalizedMap[normalizeHeader(key)] = value;
        });
        for (const key of keys) {
            const value = normalizedMap[normalizeHeader(key)];
            if (value !== null && value !== undefined && String(value).trim() !== '') return value;
        }
        return '';
    }

    function parseCsv(text) {
        const rows = [];
        const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
        if (!lines.length) return rows;
        const headers = parseCsvLine(lines[0]);
        for (let i = 1; i < lines.length; i += 1) {
            const values = parseCsvLine(lines[i]);
            const row = {};
            headers.forEach((header, index) => { row[header] = values[index] || ''; });
            rows.push(row);
        }
        return rows;
    }

    function parseCsvLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            const next = line[i + 1];
            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if ((char === ',' || char === ';') && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    }

    function parseVcf(text) {
        const cards = String(text || '').split(/BEGIN:VCARD/i).slice(1);
        return cards.map(card => {
            const lines = card.split(/\r?\n/);
            const row = {};
            lines.forEach(line => {
                const idx = line.indexOf(':');
                if (idx === -1) return;
                const key = line.slice(0, idx).split(';')[0].toUpperCase();
                const value = line.slice(idx + 1).trim();
                if (key === 'FN') row.nombre = value;
                if (key === 'N' && !row.nombre) row.nombre = value.split(';').filter(Boolean).join(' ');
                if (key === 'TEL' && !row.telefono) row.telefono = value;
                if (key === 'EMAIL' && !row.email) row.email = value;
                if (key === 'ORG' && !row.empresa) row.empresa = value;
            });
            return row;
        });
    }

    async function parseWorkbook(file) {
        await ensureXlsx();
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }

    function ensureXlsx() {
        if (window.XLSX) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar el lector XLSX'));
            document.head.appendChild(script);
        });
    }

    function normalizePhone(value) {
        const raw = String(value || '').trim();
        if (!raw || raw.includes('@g.us')) return '';
        let digits = raw.replace(/@(s\.whatsapp\.net|c\.us|lid)$/i, '').split(':')[0].replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        if (digits.startsWith('0')) digits = digits.slice(1);
        if (digits.length === 10) digits = `549${digits}`;
        else if (digits.length === 11 && digits.startsWith('9')) digits = `54${digits}`;
        else if (digits.length === 12 && digits.startsWith('54') && !digits.startsWith('549')) digits = `549${digits.slice(2)}`;
        return digits;
    }

    function normalizeHeader(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ');
    }

    function getContactChannel(contact) {
        const type = contact.channel || contact.type;
        const found = CHANNELS.find(ch => ch.id === type || contact[`${ch.id}_channel`]);
        return found || { id: 'whatsapp', label: 'WhatsApp', icon: 'fab fa-whatsapp', color: '#22c55e' };
    }

    function getInitials(name) {
        if (!name) return '?';
        const parts = String(name).trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    }

    function formatDate(dateStr) {
        if (!dateStr) return '<em style="color:var(--text-muted);">Sin fecha asignada</em>';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return escapeHtml(dateStr);
            return `<i class="fas fa-calendar-day"></i> ${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
        } catch (_) {
            return escapeHtml(dateStr);
        }
    }

    function getValue(id) {
        return String(document.getElementById(id)?.value || '').trim();
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }

    function notify(message, type = 'info') {
        if (typeof showToast === 'function') showToast(message, type);
        else if (window.Swal) Swal.fire({ text: message, icon: type, timer: 2200, showConfirmButton: false });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return {
        getHTML,
        init,
        destroy,
        loadContacts,
        handleSearch,
        handleChannelFilter,
        handleTagFilter,
        handleLeadFilter,
        toggleExpand,
        openCreateModal,
        openEditContact,
        closeEditModal,
        saveContactForm,
        deleteContact,
        openChat,
        downloadTemplate,
        toggleFormTag,
        openImportModal,
        closeImportModal,
        selectImportChannel,
        handleImportFile,
        saveImport
    };
})();
