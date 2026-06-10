/* global showToast, navigate */
window.metaView = (() => {
    let _token = '';
    let _metaConfig = {};
    let _availableTemplates = [];
    let _currentTemplate = null;
    let _selectedTagIds = new Set();
    let _popupCheckInterval = null;

    // ── HTML ──────────────────────────────────────────────────────────────
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">

            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fab fa-meta kanban-header-icon" style="color:#0668E1;"></i> Centro Meta</h1>
                    <p>Herramientas para negocios</p>
                </div>
                <div id="meta-view-badge-bar" class="meta-badge-bar" style="display:none;">
                    <span class="meta-badge-title">Ver en META</span>
                    <a id="link-meta-library" href="https://business.facebook.com/latest/whatsapp_manager/template_library" target="_blank" class="meta-link-item">
                        <i class="fas fa-book"></i> Biblioteca <span class="meta-library-badge">SDK</span>
                    </a>
                    <a id="link-meta-new" href="https://business.facebook.com/latest/whatsapp_manager/message_templates" target="_blank" class="meta-link-item">
                        <i class="fas fa-plus"></i> Nueva Plantilla
                    </a>
                </div>
            </div>

            <!-- Contenido principal con padding -->
            <div class="meta-view-body">

                <!-- Estado: no vinculado -->
                <div id="meta-not-connected" style="display:none;">
                    <div class="meta-onboarding-wrap glass-card animate-fade">
                        <div style="margin-bottom:1.25rem; text-align:center; width:100%;">
                            <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700; display:flex; align-items:center; justify-content:center; gap:10px;">
                                <i class="fas fa-infinity" style="color:#0668E1; font-size:1.5rem; flex-shrink:0;"></i> Conexion Oficial
                            </h2>
                            <div style="height:3px; width:50px; background:#0668E1; border-radius:10px; margin:0 auto 12px;"></div>
                            <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0;">
                                Conecta tu cuenta de <strong>WhatsApp Business</strong> oficial para habilitar funciones profesionales.
                            </p>
                        </div>
                        <div style="background:var(--bg-header); padding:1rem 1.25rem; border-radius:16px; border:1px solid var(--border); width:100%; text-align:left; margin-bottom:1.25rem;">
                            <h4 style="margin:0 0 8px; color:#0668E1; font-size:0.78rem; text-transform:uppercase; letter-spacing:1.5px; font-weight:700;">Beneficios activos:</h4>
                            <ul style="font-size:0.88rem; color:var(--text-main); margin:0; display:flex; flex-direction:column; gap:4px; list-style:none; padding:0;">
                                <li>Integracion por <strong>Coexistencia</strong>.</li>
                                <li>Registro via <strong>Popup de Facebook</strong>.</li>
                                <li>Envio de <strong>Mensajes Masivos (HSM)</strong>.</li>
                                <li>Soporte para <strong>Imagenes y Audios</strong> oficiales.</li>
                            </ul>
                        </div>
                        <button class="btn-primary" onclick="launchMetaOnboardingView()" style="width:100%; padding:13px 20px; display:flex; align-items:center; justify-content:center; gap:10px; font-size:0.95rem; font-weight:600; border-radius:14px;">
                            <i class="fab fa-meta"></i> Vincular con META
                        </button>
                        <div id="meta-onboard-status" style="display:none; margin-top:1rem; color:var(--text-muted); font-size:0.85rem; text-align:center;">
                            <i class="fas fa-circle-notch fa-spin"></i> Esperando confirmacion de vinculacion...
                        </div>
                    </div>
                </div>

                <!-- Estado: vinculado -->
                <div id="meta-connected-area" style="display:none;">

                    <!-- Panel de plantillas (contenedor visual + scroll) -->
                    <div class="meta-view-panel animate-fade">

                        <!-- Tabs bar -->
                        <div class="meta-tabs meta-tabs-bar">
                            <div id="tab-my-templates" class="meta-tab active" onclick="switchMetaTab('my')">
                                <i class="fas fa-list"></i> Mis Plantillas
                            </div>
                            <button class="meta-panel-toggle" onclick="toggleMetaAccordion()" title="Colapsar/Expandir">
                                <i class="fas fa-chevron-up meta-panel-chevron"></i>
                            </button>
                        </div>

                        <!-- Body colapsable -->
                        <div class="meta-panel-body">

                        <!-- Grid de plantillas -->
                        <div id="view-my-templates" class="meta-grid">
                            <div class="text-center py-10 opacity-50" style="grid-column:1/-1;">
                                <i class="fas fa-circle-notch fa-spin text-3xl text-accent-bright"></i>
                                <p class="text-sm text-secondary-content mt-3">Sincronizando con Meta Cloud...</p>
                            </div>
                        </div>

                        <!-- Detalle de plantilla -->
                        <div id="view-template-detail" style="display:none; padding:1.75rem 2rem;">
                            <div class="tpl-detail-grid">
                                <!-- Preview WhatsApp -->
                                <div class="meta-preview-overlay tpl-preview-col rounded-2xl overflow-hidden">
                                    <div class="wa-preview-bubble">
                                        <div id="wa-preview-text-final" class="wa-preview-text">...</div>
                                        <div class="wa-preview-time">12:00 <i class="fas fa-check-double wa-check-icon"></i></div>
                                    </div>
                                </div>
                                <!-- Acciones compactas -->
                                <div class="tpl-actions-col">
                                    <!-- Cabecera: back + nombre + edit -->
                                    <div class="tpl-compact-header">
                                        <button class="btn-icon flex-shrink-0" onclick="switchMetaTab('my')">
                                            <i class="fas fa-arrow-left"></i>
                                        </button>
                                        <div class="min-w-0 flex-1">
                                            <h2 id="detail-tpl-name" class="tpl-name-compact">Nombre de Plantilla</h2>
                                            <div class="tpl-detail-badges" style="margin-top:4px;">
                                                <div id="detail-tpl-status" class="meta-card-tag" style="position:static; transform:none;">ESTADO</div>
                                                <span id="detail-tpl-lang-badge" class="tpl-info-badge"><i class="fas fa-globe"></i> ES</span>
                                                <span id="detail-tpl-cat-badge" class="tpl-info-badge"><i class="fas fa-tag"></i> CATEGORIA</span>
                                            </div>
                                        </div>
                                        <a id="btn-edit-in-meta" href="#" target="_blank" style="display:none; flex-shrink:0; align-items:center; gap:5px; font-size:0.72rem; font-weight:600; padding:5px 10px; border-radius:8px; background:linear-gradient(135deg,#0668E1,#00B2FF); color:#fff; text-decoration:none; white-space:nowrap;">
                                            <i class="fab fa-facebook"></i> META
                                        </a>
                                    </div>
                                    <!-- Boton preview (solo mobile/tablet) -->
                                    <button class="tpl-preview-btn" onclick="showTplPreviewModal()">
                                        <i class="fas fa-eye"></i> Mostrar Plantilla
                                    </button>
                                    <!-- Envio masivo compacto -->
                                    <div id="bulk-actions-section" style="display:none;" class="bulk-compact-body">
                                        <!-- Fechas -->
                                        <div class="bulk-filter-date-grid">
                                            <div>
                                                <label class="bulk-filter-sublabel">Desde</label>
                                                <input type="date" id="bulk-filter-start" class="crm-input bulk-filter-input">
                                            </div>
                                            <div>
                                                <label class="bulk-filter-sublabel">Hasta</label>
                                                <input type="date" id="bulk-filter-end" class="crm-input bulk-filter-input">
                                            </div>
                                        </div>
                                        <!-- Tags chips -->
                                        <div>
                                            <label class="bulk-filter-sublabel" style="margin-bottom:6px; display:block;">Etiquetas</label>
                                            <div class="bulk-tags-box">
                                                <div id="bulk-filter-tags" class="bulk-tags-chips"></div>
                                            </div>
                                        </div>
                                        <!-- Pasos lado a lado -->
                                        <div class="bulk-steps-grid">
                                            <div class="bulk-step-box">
                                                <div class="bulk-step-label"><i class="fas fa-file-excel icon-excel"></i> 1. Descargar</div>
                                                <button class="btn-primary bulk-step-btn" onclick="downloadBulkExcel()">
                                                    Formato Excel
                                                </button>
                                            </div>
                                            <div class="bulk-step-box">
                                                <div class="bulk-step-label"><i class="fas fa-paper-plane" style="color:#0668E1;"></i> 2. Enviar</div>
                                                <div class="bulk-step-row">
                                                    <input type="file" id="bulk-file-input" class="crm-input bulk-step-file" accept=".xlsx,.xls">
                                                    <button class="btn-primary flex-shrink-0 bulk-step-send" onclick="startBulkSend()" id="send-bulk-btn">
                                                        <i class="fas fa-paper-plane"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        <!-- Envío Rápido (Solo para plantillas sin variables) -->
                                        <div id="quick-send-container" style="display:none; flex-direction:column; gap:8px; margin-top:15px; border-top:1px dashed var(--border); padding-top:15px;">
                                            <div class="bulk-step-label"><i class="fas fa-bolt" style="color:#0668E1;"></i> Envío Rápido</div>
                                            <button id="quick-send-btn" class="btn-primary bulk-step-btn" onclick="startQuickBulkSend()" style="display:flex; align-items:center; justify-content:center; gap:8px;">
                                                <i class="fas fa-bolt"></i> Envío Rápido
                                            </button>
                                        </div>
                                        <!-- Progreso -->
                                        <div id="bulk-progress" style="display:none;">
                                            <div class="bulk-progress-track">
                                                <div id="bulk-progress-bar" class="bulk-progress-bar" style="width:0%"></div>
                                            </div>
                                            <p id="bulk-status-text" class="bulk-status-text"></p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        </div><!-- /.meta-panel-body -->

                    </div><!-- /.meta-view-panel -->

                </div><!-- /#meta-connected-area -->

            </div><!-- /.meta-view-body -->

        </main>`;
    }

    // ── Init / Destroy ────────────────────────────────────────────────────
    async function init() {
        _token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
        _availableTemplates = [];
        _currentTemplate = null;
        _selectedTagIds = new Set();
        _popupCheckInterval = null;

        window.switchMetaTab            = switchMetaTab;
        window.showTemplateDetail       = showTemplateDetail;
        window.startBulkSend            = startBulkSend;
        window.downloadBulkExcel        = downloadBulkExcel;
        window.toggleTagChip            = toggleTagChip;
        window.toggleMetaAccordion      = toggleMetaAccordion;
        window.showTplPreviewModal      = showTplPreviewModal;
        window.launchMetaOnboardingView = launchMetaOnboardingView;
        window.startQuickBulkSend       = startQuickBulkSend;

        await checkMetaConnection();
    }

    function destroy() {
        if (_popupCheckInterval) { clearInterval(_popupCheckInterval); _popupCheckInterval = null; }
        document.getElementById('tpl-preview-modal')?.remove();
        ['switchMetaTab', 'showTemplateDetail', 'startBulkSend', 'downloadBulkExcel',
         'toggleTagChip', 'toggleMetaAccordion', 'showTplPreviewModal', 'launchMetaOnboardingView',
         'startQuickBulkSend'
        ].forEach(fn => { delete window[fn]; });
    }

    // ── Verificacion de conexion ──────────────────────────────────────────
    async function checkMetaConnection() {
        try {
            const res  = await fetch(`/api/backoffice/whatsapp/config?token=${_token}`);
            const data = await res.json();
            _metaConfig = (data && data.config) || {};
            const connected = !!(_metaConfig.waba_id && _metaConfig.phone_number_id);

            if (connected) {
                const libLink = document.getElementById('link-meta-library');
                const newLink = document.getElementById('link-meta-new');
                if (libLink) libLink.href = `https://business.facebook.com/latest/whatsapp_manager/template_library?asset_id=${_metaConfig.waba_id}`;
                if (newLink) newLink.href  = `https://business.facebook.com/latest/whatsapp_manager/message_templates?asset_id=${_metaConfig.waba_id}`;

                const notConn = document.getElementById('meta-not-connected');
                if (notConn) notConn.style.display = 'none';

                const badgeBar = document.getElementById('meta-view-badge-bar');
                if (badgeBar) badgeBar.style.display = 'flex';

                const area = document.getElementById('meta-connected-area');
                if (area) area.style.display = 'block';

                loadTags();
                loadTemplates();
            } else {
                const notConn = document.getElementById('meta-not-connected');
                if (notConn) notConn.style.display = 'block';
            }
        } catch (e) {
            console.error('[MetaView] Error al verificar conexion:', e);
        }
    }

    // ── Tags para filtro de descarga ──────────────────────────────────────
    async function loadTags() {
        try {
            const res  = await fetch(`/api/backoffice/tags?token=${_token}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                const container = document.getElementById('bulk-filter-tags');
                if (!container) return;
                if (data.length === 0) {
                    container.innerHTML = '<span class="bulk-filter-sublabel" style="opacity:0.5;">Sin etiquetas disponibles</span>';
                    return;
                }
                container.innerHTML = data.map(t =>
                    `<span class="bulk-tag-chip" data-id="${t.id}" onclick="toggleTagChip(this)">${t.name}</span>`
                ).join('');
            }
        } catch (e) { /* silencioso */ }
    }

    function toggleTagChip(el) {
        const id = el.dataset.id;
        if (_selectedTagIds.has(id)) {
            _selectedTagIds.delete(id);
            el.classList.remove('selected');
        } else {
            _selectedTagIds.add(id);
            el.classList.add('selected');
        }
    }

    // ── Carga y render de plantillas ──────────────────────────────────────
    async function loadTemplates() {
        const container = document.getElementById('view-my-templates');
        if (!container) return;
        container.innerHTML = `
            <div class="text-center py-10 opacity-50" style="grid-column:1/-1;">
                <i class="fas fa-circle-notch fa-spin text-3xl text-accent-bright"></i>
                <p class="text-sm text-secondary-content mt-3">Sincronizando con Meta Cloud...</p>
            </div>`;
        try {
            const res  = await fetch(`/api/backoffice/whatsapp/templates?token=${_token}`);
            const data = await res.json();
            if (data.success) {
                _availableTemplates = data.templates;
                renderCards(container, _availableTemplates);
            } else {
                container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">No se encontraron plantillas.</p>';
            }
        } catch (e) {
            container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Error al sincronizar con Meta Cloud.</p>';
        }
    }

    function renderCards(container, templates) {
        if (!templates || templates.length === 0) {
            container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">No se encontraron plantillas.</p>';
            return;
        }
        container.innerHTML = templates.map(t => {
            let text = 'Sin contenido de previsualización';
            if (t.components && Array.isArray(t.components)) {
                const body = t.components.find(c => c.type === 'BODY' || c.type?.toUpperCase() === 'BODY');
                if (body) text = body.text || body.content || body.example?.body_text?.[0]?.[0] || text;
                if (text === 'Sin contenido de previsualización') {
                    for (const comp of t.components) {
                        if (comp.text || comp.content) { text = comp.text || comp.content; break; }
                    }
                }
            } else if (t.body) {
                text = t.body;
            }
            const cleanText   = text.length > 150 ? text.substring(0, 147) + '...' : text;
            const cardClass = t.status === 'APPROVED' ? 'meta-card-approved' : (t.status === 'REJECTED' ? 'meta-card-rejected' : 'meta-card-pending');
            return `
                <div class="meta-card ${cardClass}" onclick="showTemplateDetail('${t.id || t.name}','${t.language}')">
                    <div class="meta-card-name">${t.name}</div>
                    <div class="meta-card-desc">${cleanText}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:8px; margin-top:auto; padding-top:10px; border-top:1px solid rgba(0,0,0,0.05);">
                        <span style="background:rgba(6,104,225,0.05); padding:2px 6px; border-radius:4px; font-weight:600;"><i class="fas fa-fingerprint"></i> ID: ${t.id || 'N/A'}</span>
                        <span style="background:rgba(0,0,0,0.05); padding:2px 6px; border-radius:4px;"><i class="fas fa-globe"></i> ${t.language.toUpperCase()}</span>
                        <span style="background:rgba(0,0,0,0.05); padding:2px 6px; border-radius:4px;"><i class="fas fa-tag"></i> ${t.category}</span>
                    </div>
                </div>`;
        }).join('');
    }

    // ── Tabs ──────────────────────────────────────────────────────────────
    function switchMetaTab(tab) {
        const myView     = document.getElementById('view-my-templates');
        const detailView = document.getElementById('view-template-detail');
        const tabBtn     = document.getElementById('tab-my-templates');

        if (tab === 'my') {
            if (myView)     { myView.style.display = 'grid'; }
            if (detailView) { detailView.style.display = 'none'; }
            if (tabBtn)     { tabBtn.classList.add('active'); }
            loadTemplates();
        } else if (tab === 'detail') {
            if (myView)     { myView.style.display = 'none'; }
            if (detailView) { detailView.style.display = 'flex'; }
            if (tabBtn)     { tabBtn.classList.remove('active'); }
        }
    }

    // ── Detalle de plantilla ──────────────────────────────────────────────
    function showTemplateDetail(idOrName, language) {
        const template = _availableTemplates.find(t =>
            (t.id === idOrName || t.name === idOrName) && (!language || t.language === language)
        );
        if (!template) return;
        _currentTemplate = template;
        switchMetaTab('detail');

        document.getElementById('detail-tpl-name').innerText = template.name;
        document.getElementById('detail-tpl-lang-badge').innerHTML = `<i class="fas fa-globe"></i> ${template.language.toUpperCase()}`;
        document.getElementById('detail-tpl-cat-badge').innerHTML  = `<i class="fas fa-tag"></i> ${template.category}`;

        const statusEl = document.getElementById('detail-tpl-status');
        statusEl.className = `meta-card-tag ${template.status === 'APPROVED' ? 'meta-status-approved' : (template.status === 'REJECTED' ? 'meta-status-rejected' : 'meta-status-pending')}`;
        statusEl.innerText = template.status;

        const editBtn = document.getElementById('btn-edit-in-meta');
        if (editBtn && _metaConfig.waba_id) {
            editBtn.href         = `https://business.facebook.com/latest/whatsapp_manager/message_templates?asset_id=${_metaConfig.waba_id}&edit_template=${template.name}`;
            editBtn.style.display = 'flex';
        } else if (editBtn) {
            editBtn.style.display = 'none';
        }

        // Preview
        let bodyText = 'Sin contenido';
        let headerText = '';
        let footerText = '';
        if (template.components && Array.isArray(template.components)) {
            const bodyComp   = template.components.find(c => c.type === 'BODY' || c.type?.toUpperCase() === 'BODY');
            if (bodyComp)   bodyText   = bodyComp.text   || bodyComp.content   || bodyComp.example?.body_text?.[0]?.[0]   || bodyText;
            const headerComp = template.components.find(c => c.type === 'HEADER' || c.type?.toUpperCase() === 'HEADER');
            if (headerComp) headerText = headerComp.text || headerComp.example?.header_text?.[0] || '';
            const footerComp = template.components.find(c => c.type === 'FOOTER' || c.type?.toUpperCase() === 'FOOTER');
            if (footerComp) footerText = footerComp.text || '';
        } else if (template.body) {
            bodyText = template.body;
        }

        const previewEl = document.getElementById('wa-preview-text-final');
        if (previewEl) {
            const bubble = previewEl.closest('.wa-preview-bubble');
            if (bubble) bubble.querySelectorAll('.wa-preview-btns-container-integrated').forEach(e => e.remove());

            let html = '';
            const headerComp = template.components?.find(c => c.type === 'HEADER');
            if (headerComp && headerComp.format && headerComp.format !== 'TEXT') {
                const fmt = headerComp.format.toLowerCase();
                if (fmt === 'image') {
                    const imgUrl = headerComp.example?.header_handle?.[0] || '';
                    if (imgUrl) html += `<img src="${imgUrl}" style="width:calc(100% + 30px); margin:-12px -15px 12px -15px; display:block; object-fit:cover; max-height:180px;">`;
                } else if (fmt === 'video') {
                    html += `<div style="width:calc(100% + 30px); margin:-12px -15px 12px -15px; aspect-ratio:16/9; background:#000; display:flex; align-items:center; justify-content:center; color:white;"><i class="fas fa-play-circle fa-3x"></i></div>`;
                } else if (fmt === 'document') {
                    html += `<div style="width:calc(100% + 30px); margin:-12px -15px 12px -15px; padding:12px; background:rgba(0,0,0,0.05); display:flex; align-items:center; gap:8px;"><i class="fas fa-file-pdf fa-2x" style="color:#ef4444;"></i> <span style="font-size:0.85rem; font-weight:600;">Documento</span></div>`;
                }
            }
            if (headerText) html += `<div style="font-weight:700; margin-bottom:8px;">${headerText}</div>`;
            html += `<div style="white-space:pre-wrap;">${bodyText}</div>`;
            if (footerText) html += `<div style="color:var(--text-muted); font-size:0.8rem; margin-top:8px;">${footerText}</div>`;
            previewEl.innerHTML = html;

            const buttonsComp = template.components?.find(c => c.type === 'BUTTONS');
            if (buttonsComp?.buttons && bubble) {
                const btnsContainer = document.createElement('div');
                btnsContainer.className = 'wa-preview-btns-container-integrated';
                buttonsComp.buttons.forEach(b => {
                    const btn = document.createElement('div');
                    btn.className = 'wa-preview-btn-item';
                    let icon = '<i class="fas fa-reply"></i>';
                    if (b.type === 'URL')          icon = '<i class="fas fa-external-link-alt"></i>';
                    if (b.type === 'PHONE_NUMBER') icon = '<i class="fas fa-phone"></i>';
                    btn.innerHTML = `${icon} ${b.text}`;
                    btnsContainer.appendChild(btn);
                });
                bubble.appendChild(btnsContainer);
            }
        }

        const bulkSection = document.getElementById('bulk-actions-section');
        if (bulkSection) bulkSection.style.display = template.status === 'APPROVED' ? 'block' : 'none';

        // Detectar si la plantilla tiene variables
        let hasVariables = false;
        if (template.components && Array.isArray(template.components)) {
            hasVariables = template.components.some(c => {
                if (c.type === 'HEADER') {
                    if (c.format === 'TEXT') {
                        const text = c.text || c.content || '';
                        return /\{\{\w+\}\}/.test(text);
                    }
                    return false;
                }
                if (c.type === 'BODY') {
                    const text = c.text || c.content || '';
                    const hasPlaceholders = /\{\{\w+\}\}/.test(text);
                    if (hasPlaceholders) return true;
                    if (template.parameter_format === 'named' && c.example?.body_text_named_params?.length > 0) {
                        return true;
                    }
                }
                if (c.type === 'BUTTONS' && Array.isArray(c.buttons)) {
                    return c.buttons.some(b => b.type === 'URL' && b.url && b.url.includes('{{'));
                }
                return false;
            });
        }

        const quickSendContainer = document.getElementById('quick-send-container');
        if (quickSendContainer) {
            quickSendContainer.style.display = (!hasVariables && template.status === 'APPROVED') ? 'flex' : 'none';
        }

        const progressEl  = document.getElementById('bulk-progress');
        const fileInput   = document.getElementById('bulk-file-input');
        if (progressEl) progressEl.style.display = 'none';
        if (fileInput)  fileInput.value = '';
    }

    // ── Descarga Excel ────────────────────────────────────────────────────
    function downloadBulkExcel() {
        if (!_currentTemplate) return;
        let url = `/api/backoffice/whatsapp/template-excel/${_currentTemplate.name}?token=${_token}`;
        const start  = document.getElementById('bulk-filter-start')?.value;
        const end    = document.getElementById('bulk-filter-end')?.value;
        if (start) url += `&startDate=${start}`;
        if (end)   url += `&endDate=${end}`;
        if (_selectedTagIds.size > 0) url += `&tagIds=${[..._selectedTagIds].join(',')}`;
        window.open(url, '_blank');
    }

    // ── Envio masivo ──────────────────────────────────────────────────────
    async function startBulkSend() {
        if (!_currentTemplate) return;
        const fileInput   = document.getElementById('bulk-file-input');
        const btn         = document.getElementById('send-bulk-btn');
        const progressDiv = document.getElementById('bulk-progress');
        const progressBar = document.getElementById('bulk-progress-bar');
        const statusText  = document.getElementById('bulk-status-text');

        if (!fileInput.files.length) {
            showToast('⚠️ Suba un archivo Excel para iniciar', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('templateName', _currentTemplate.name);
        formData.append('languageCode', _currentTemplate.language || 'es');

        btn.disabled        = true;
        btn.innerHTML       = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
        progressDiv.style.display = 'block';
        progressBar.style.width   = '0%';
        statusText.innerText      = 'Subiendo y procesando...';

        try {
            const res = await fetch(`/api/backoffice/whatsapp/send-bulk-template?token=${_token}`, {
                method: 'POST',
                body: formData
            });
            if (res.status === 202) {
                statusText.innerText       = '✅ Proceso iniciado en segundo plano.';
                progressBar.style.width    = '100%';
                progressBar.style.background = '#10b981';
                showToast('🚀 Envío masivo iniciado correctamente');
                setTimeout(() => {
                    switchMetaTab('my');
                    btn.disabled   = false;
                    btn.innerHTML  = '<i class="fas fa-paper-plane"></i> Enviar';
                    progressDiv.style.display = 'none';
                    fileInput.value = '';
                }, 2000);
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Error al iniciar envío');
            }
        } catch (e) {
            statusText.innerText          = '❌ ' + e.message;
            progressBar.style.background  = '#ef4444';
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Reintentar';
        }
    }

    // ── Envio masivo rápido (sin Excel) ───────────────────────────────────
    async function startQuickBulkSend() {
        if (!_currentTemplate) return;
        
        // Confirmar envío
        if (!confirm(`¿Iniciar envío rápido de la plantilla "${_currentTemplate.name}" a los contactos filtrados?`)) {
            return;
        }

        const btn         = document.getElementById('quick-send-btn');
        const progressDiv = document.getElementById('bulk-progress');
        const progressBar = document.getElementById('bulk-progress-bar');
        const statusText  = document.getElementById('bulk-status-text');

        const startDate = document.getElementById('bulk-filter-start')?.value || '';
        const endDate   = document.getElementById('bulk-filter-end')?.value || '';
        const tagIds    = [..._selectedTagIds];

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
        }
        if (progressDiv) progressDiv.style.display = 'block';
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.style.background = 'var(--accent-color, #0099FF)';
        }
        if (statusText) statusText.innerText = 'Consultando contactos y procesando envío...';

        try {
            const res = await fetch(`/api/backoffice/whatsapp/send-quick-template?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateName: _currentTemplate.name,
                    languageCode: _currentTemplate.language || 'es',
                    startDate,
                    endDate,
                    tagIds
                })
            });

            const data = await res.json();

            if (res.status === 202 && data.success) {
                if (statusText) statusText.innerText = `✅ Envío rápido iniciado para ${data.total} contactos.`;
                if (progressBar) {
                    progressBar.style.width = '100%';
                    progressBar.style.background = '#10b981';
                }
                showToast(`🚀 Envío rápido iniciado para ${data.total} contactos`);
                setTimeout(() => {
                    switchMetaTab('my');
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-bolt"></i> Envío Rápido';
                    }
                    if (progressDiv) progressDiv.style.display = 'none';
                }, 3000);
            } else {
                throw new Error(data.error || 'Error al iniciar envío rápido');
            }
        } catch (e) {
            console.error('[Quick Bulk] Error:', e);
            if (statusText) statusText.innerText = '❌ ' + e.message;
            if (progressBar) progressBar.style.background = '#ef4444';
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-bolt"></i> Reintentar Envío Rápido';
            }
        }
    }

    // ── Preview modal (mobile/tablet) ─────────────────────────────────────
    function showTplPreviewModal() {
        const src = document.querySelector('.tpl-preview-col');
        if (!src) return;
        const existing = document.getElementById('tpl-preview-modal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.id = 'tpl-preview-modal';
        modal.className = 'tpl-preview-modal-overlay';
        modal.onclick = () => modal.remove();
        modal.innerHTML = `
            <div class="tpl-preview-modal-content" onclick="event.stopPropagation()">
                <button class="tpl-preview-modal-close" onclick="document.getElementById('tpl-preview-modal').remove()">
                    <i class="fas fa-times"></i>
                </button>
                ${src.innerHTML}
            </div>`;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('active'));
    }

    // ── Onboarding (estado no-conectado) ─────────────────────────────────
    function launchMetaOnboardingView() {
        fetch('/api/backoffice/whatsapp/config?token=' + _token)
            .then(res => res.json())
            .then(data => {
                if (!data.appId || !data.railwayProjectId) {
                    showToast('⚠️ Faltan credenciales de Meta en el servidor', 'error');
                    return;
                }
                const url = new URL('https://duskcodes.com.ar/meta-auth');
                const origin = window.location.origin;
                url.searchParams.append('railwayProjectId', data.railwayProjectId);
                url.searchParams.append('RAILWAY_PROJECT_ID', data.railwayProjectId);
                url.searchParams.append('projectId', data.railwayProjectId);
                url.searchParams.append('metaAppId', data.appId);
                url.searchParams.append('metaAppSecret', data.appSecret);
                if (data.configId) url.searchParams.append('configId', data.configId);
                url.searchParams.append('projectUrl', origin);
                url.searchParams.append('redirectUri', `${origin}/api/backoffice/whatsapp/onboard-callback`);

                const w = 600, h = 800;
                const left = (window.screen.width / 2) - (w / 2);
                const top  = (window.screen.height / 2) - (h / 2);
                const popup = window.open(url.toString(), 'MetaOnboarding',
                    `width=${w},height=${h},top=${top},left=${left},scrollbars=yes,status=no,menubar=no`);

                const statusEl = document.getElementById('meta-onboard-status');
                if (statusEl) statusEl.style.display = 'block';

                if (_popupCheckInterval) clearInterval(_popupCheckInterval);
                _popupCheckInterval = setInterval(() => {
                    if (popup && popup.closed) {
                        clearInterval(_popupCheckInterval);
                        _popupCheckInterval = null;
                        if (statusEl) statusEl.style.display = 'none';
                        checkMetaConnection();
                    }
                }, 1000);
            })
            .catch(() => showToast('❌ Error al obtener configuracion', 'error'));
    }

    // ── Acordion del panel ────────────────────────────────────────────────
    function toggleMetaAccordion() {
        const panel = document.querySelector('.meta-view-panel');
        if (panel) panel.classList.toggle('collapsed');
    }

    return {
        title: 'Meta - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy
    };
})();
