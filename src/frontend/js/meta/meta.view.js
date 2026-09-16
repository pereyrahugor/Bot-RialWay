/* global showToast, navigate */
window.metaView = (() => {
    let _token = '';
    let _metaConfig = {};
    let _availableTemplates = [];
    let _projectTemplates = [];
    let _currentTemplate = null;
    let _selectedTagIds = new Set();
    let _popupCheckInterval = null;
    let _previewFitFrame = null;
    let _activeBulkCampaignId = null;
    let _bulkPollingTimer = null;
    let _pendingBulkPayload = null;

    // ── HTML ──────────────────────────────────────────────────────────────
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            ${window.renderSectionTabs ? window.renderSectionTabs('integrations') : ''}

            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fab fa-meta kanban-header-icon" style="color:#0668E1;"></i> Plantillas Meta</h1>
                    <p>Gestión de plantillas y envíos masivos oficiales</p>
                </div>
                <div id="meta-view-badge-bar" class="meta-badge-bar" style="display:none;">
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
                    <div class="meta-onboarding-wrap glass-card animate-fade" style="text-align:center; padding:3rem 2rem; max-width:580px; margin:3rem auto; border-radius:18px;">
                        <div style="width:72px; height:72px; border-radius:50%; background:rgba(6,104,225,0.1); display:flex; align-items:center; justify-content:center; margin:0 auto 1.5rem; color:#0668E1; font-size:2rem;">
                            <i class="fab fa-meta"></i>
                        </div>
                        <h2 style="margin:0 0 12px; color:var(--text-main); font-size:1.35rem; font-weight:700;">
                            Conexión de WhatsApp requerida
                        </h2>
                        <p style="color:var(--text-muted); font-size:0.98rem; line-height:1.6; margin:0 0 1.75rem;">
                            Para poder ver y enviar plantillas debe primero conectarse desde la sección de <strong>Conexión</strong>.
                        </p>
                        <button type="button" class="btn-primary" style="padding:10px 24px; font-size:0.95rem; font-weight:600; display:inline-flex; align-items:center; gap:8px;" onclick="navigate('/conexion')">
                            <i class="fas fa-plug-circle-bolt"></i> Ir a Conexión
                        </button>
                    </div>
                </div>


                <!-- Estado: vinculado -->
                <div id="meta-connected-area" style="display:none;">

                    <!-- Panel de plantillas (contenedor visual + scroll) -->
                    <div class="meta-view-panel animate-fade">

                        <div class="meta-templates-header">
                            <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
                                <div id="tab-my-templates" class="meta-templates-title active" onclick="switchMetaTab('my')" style="cursor:pointer;">
                                    <span class="meta-templates-icon"><i class="fas fa-list"></i></span>
                                    <div class="meta-templates-copy">
                                        <h2>Mis Plantillas</h2>
                                        <p id="meta-templates-subtitle">Plantillas de esta línea.</p>
                                    </div>
                                </div>
                                <div id="tab-project-templates" class="meta-templates-title" onclick="switchMetaTab('project')" style="display:none; cursor:pointer; opacity:0.65;">
                                    <span class="meta-templates-icon" style="background:rgba(0,153,255,0.12); color:#0099FF;"><i class="fas fa-network-wired"></i></span>
                                    <div class="meta-templates-copy">
                                        <h2 style="display:flex; align-items:center; gap:8px;">
                                            Otras Líneas del Proyecto
                                            <span id="badge-project-tpl-count" class="meta-card-tag meta-status-approved" style="position:static; transform:none; font-size:0.75rem; padding:2px 8px; display:none;">0</span>
                                        </h2>
                                        <p>Reutiliza o vincula plantillas de tus otras cuentas.</p>
                                    </div>
                                </div>
                            </div>
                            <button id="tpl-detail-back-header" class="tpl-detail-back-btn" style="display:none;" onclick="switchMetaTab('my')">
                                <i class="fas fa-arrow-left"></i> Volver a plantillas
                            </button>
                        </div>

                        <!-- Body colapsable -->
                        <div class="meta-panel-body">

                        <!-- Grid de plantillas propias -->
                        <div id="view-my-templates" class="meta-grid">
                            <div class="text-center py-10 opacity-50" style="grid-column:1/-1;">
                                <i class="fas fa-circle-notch fa-spin text-3xl text-accent-bright"></i>
                                <p class="text-sm text-secondary-content mt-3">Sincronizando con Meta Cloud...</p>
                            </div>
                        </div>

                        <!-- Grid de plantillas de otras líneas del proyecto -->
                        <div id="view-project-templates" class="meta-grid" style="display:none; height:100%; min-height:0; overflow:hidden;">
                            <div class="text-center py-10 opacity-50" style="grid-column:1/-1;">
                                <i class="fas fa-circle-notch fa-spin text-3xl text-accent-bright"></i>
                                <p class="text-sm text-secondary-content mt-3">Consultando plantillas de otras líneas...</p>
                            </div>
                        </div>

                        <!-- Detalle de plantilla -->
                        <div id="view-template-detail" style="display:none; padding:1.75rem 2rem;">
                            <div class="tpl-detail-grid">
                                <!-- Preview WhatsApp -->
                                <div class="meta-preview-overlay tpl-preview-col rounded-2xl overflow-hidden">
                                    <div class="tpl-preview-stage">
                                        <div class="tpl-preview-phone">
                                            <div class="tpl-preview-phone-head">
                                                <span>Vista previa</span>
                                                <i class="fab fa-whatsapp"></i>
                                            </div>
                                            <div class="tpl-preview-screen">
                                                <div class="wa-preview-bubble">
                                                    <div id="wa-preview-text-final" class="wa-preview-text">...</div>
                                                    <div class="wa-preview-time">12:00 <i class="fas fa-check-double wa-check-icon"></i></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <!-- Acciones compactas -->
                                <div class="tpl-actions-col">
                                    <!-- Cabecera: back + nombre + edit -->
                                    <div class="tpl-compact-header">
                                        <div class="min-w-0 flex-1">
                                            <h2 id="detail-tpl-name" class="tpl-name-compact">Nombre de Plantilla</h2>
                                            <div class="tpl-detail-badges" style="margin-top:4px;">
                                                <div id="detail-tpl-status" class="meta-card-tag" style="position:static; transform:none;">ESTADO</div>
                                                <span id="detail-tpl-lang-badge" class="tpl-info-badge"><i class="fas fa-globe"></i> ES</span>
                                                <span id="detail-tpl-cat-badge" class="tpl-info-badge"><i class="fas fa-tag"></i> CATEGORIA</span>
                                            </div>
                                        </div>
                                        <a id="btn-edit-in-meta" href="#" target="_blank" style="display:none; flex-shrink:0;">
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
                                        <div class="bulk-tags-panel">
                                            <div class="bulk-tags-head">
                                                <label class="bulk-filter-sublabel">Etiquetas</label>
                                                <span id="bulk-tags-count" class="bulk-tags-count">0 seleccionadas</span>
                                            </div>
                                            <label class="bulk-tags-search">
                                                <i class="fas fa-search"></i>
                                                <input id="bulk-tags-search" type="search" placeholder="Buscar etiqueta..." oninput="filterBulkTags(this.value)">
                                            </label>
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
                                        <div id="quick-send-container" style="display:none; margin-top:15px; border-top:1px dashed var(--border); padding-top:15px; width:100%;">
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

            <!-- Modal Flujo Envío Masivo (Confirmación + Avance en Tiempo Real + Cancelación) -->
            <div id="bulk-flow-modal" class="modal-overlay" style="display:none; z-index:99999;">
                <div class="modal-content modal-content-md animate-pop-in" style="max-width:560px;">
                    <!-- Header -->
                    <div class="modal-header">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="width:38px; height:38px; border-radius:10px; background:rgba(0,153,255,0.12); color:#0099FF; display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">
                                <i class="fas fa-paper-plane"></i>
                            </div>
                            <div>
                                <h3 id="bulk-modal-title" style="margin:0; font-size:1.15rem; font-weight:700; color:inherit;">Confirmar Envío Masivo</h3>
                                <p id="bulk-modal-subtitle" style="margin:2px 0 0; font-size:0.8rem; color:var(--text-muted);">Verifica los datos antes de iniciar el envío</p>
                            </div>
                        </div>
                        <button class="modal-close" id="bulk-modal-close-x" onclick="closeBulkFlowModal()" type="button" title="Cerrar">&times;</button>
                    </div>

                    <!-- Fase 1: Confirmación Previa -->
                    <div id="bulk-phase-confirm" class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
                        <div class="bulk-summary-grid">
                            <div class="bulk-summary-item">
                                <span class="bulk-summary-label"><i class="fas fa-file-alt"></i> Plantilla</span>
                                <span class="bulk-summary-val" id="bmc-template-name">-</span>
                            </div>
                            <div class="bulk-summary-item highlight">
                                <span class="bulk-summary-label"><i class="fas fa-users"></i> Contactos Afectados</span>
                                <span class="bulk-summary-val bold" id="bmc-total-contacts">0</span>
                            </div>
                            <div class="bulk-summary-item">
                                <span class="bulk-summary-label"><i class="fas fa-database"></i> Origen de Destinatarios</span>
                                <span class="bulk-summary-val" id="bmc-source-type">-</span>
                            </div>
                            <div class="bulk-summary-item" id="bmc-daterange-row">
                                <span class="bulk-summary-label"><i class="fas fa-calendar-alt"></i> Rango de Fechas</span>
                                <span class="bulk-summary-val" id="bmc-date-range">Todo el historial</span>
                            </div>
                            <div class="bulk-summary-item full-width" id="bmc-tags-row">
                                <span class="bulk-summary-label"><i class="fas fa-tags"></i> Filtro de Etiquetas</span>
                                <div class="bulk-summary-tags" id="bmc-tags-list">Sin filtro de etiquetas</div>
                            </div>
                        </div>

                        <div class="bulk-alert-box warning">
                            <i class="fas fa-exclamation-triangle" style="font-size:1.1rem; margin-top:2px; flex-shrink:0;"></i>
                            <div>
                                <strong>Verificación previa:</strong> Por favor confirma que la cantidad de destinatarios y los filtros seleccionados sean correctos. Podrás cancelar el proceso en cualquier momento mientras se encuentre en curso.
                            </div>
                        </div>
                    </div>

                    <div id="bulk-phase-confirm-footer" class="modal-footer">
                        <button type="button" class="btn-secondary" onclick="closeBulkFlowModal()">Cancelar / Revisar</button>
                        <button type="button" class="btn-primary" id="bmc-confirm-btn" onclick="executeConfirmedBulkSend()">
                            <i class="fas fa-paper-plane"></i> Iniciar Envío Masivo
                        </button>
                    </div>

                    <!-- Fase 2: Avance en Vivo + Cancelación -->
                    <div id="bulk-phase-progress" class="modal-body" style="display:none; flex-direction:column; gap:16px;">
                        <div class="bulk-live-status-box">
                            <div class="bulk-live-header">
                                <span id="bulk-live-state-badge" class="bulk-state-badge in-progress">
                                    <i class="fas fa-spinner fa-spin"></i> Enviando...
                                </span>
                                <span id="bulk-live-percentage" class="bulk-live-pct">0%</span>
                            </div>

                            <!-- Barra lineal de avance -->
                            <div class="bulk-linear-track">
                                <div id="bulk-linear-bar" class="bulk-linear-bar" style="width: 0%;"></div>
                            </div>

                            <!-- Contador lineal de avance -->
                            <div class="bulk-counter-box">
                                <span class="bulk-counter-primary" id="bulk-counter-text">0 / 0</span>
                                <span class="bulk-counter-sub">contactos procesados</span>
                            </div>

                            <!-- Estadísticas de entrega -->
                            <div class="bulk-stats-row">
                                <div class="bulk-stat-pill success">
                                    <i class="fas fa-check-circle"></i> Exitosos: <span id="bulk-stat-sent">0</span>
                                </div>
                                <div class="bulk-stat-pill danger">
                                    <i class="fas fa-times-circle"></i> Errores: <span id="bulk-stat-errors">0</span>
                                </div>
                            </div>

                            <div id="bulk-live-info-msg" class="bulk-live-info-msg">
                                Enviando mensajes a WhatsApp respetando los límites de entrega de Meta...
                            </div>
                        </div>
                    </div>

                    <div id="bulk-phase-progress-footer" class="modal-footer" style="display:none;">
                        <button type="button" class="btn-danger" id="bulk-cancel-btn" onclick="requestCancelBulkSend()">
                            <i class="fas fa-stop-circle"></i> Cancelar Envío
                        </button>
                        <button type="button" class="btn-primary" id="bulk-done-btn" style="display:none;" onclick="closeBulkFlowModal()">
                            <i class="fas fa-check"></i> Cerrar
                        </button>
                    </div>
                </div>
            </div>

            <style>
            .bulk-summary-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }
            .bulk-summary-item {
                background: rgba(0, 153, 255, 0.03);
                border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
                border-radius: 12px;
                padding: 12px 14px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            [data-theme="dark"] .bulk-summary-item {
                background: rgba(255, 255, 255, 0.03);
            }
            .bulk-summary-item.highlight {
                background: rgba(0, 153, 255, 0.08);
                border-color: rgba(0, 153, 255, 0.35);
            }
            .bulk-summary-item.full-width {
                grid-column: 1 / -1;
            }
            .bulk-summary-label {
                font-size: 0.72rem;
                color: var(--text-muted, #64748b);
                text-transform: uppercase;
                font-weight: 700;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .bulk-summary-val {
                font-size: 0.95rem;
                font-weight: 600;
                color: var(--text-main, #0f172a);
                word-break: break-word;
            }
            .bulk-summary-val.bold {
                font-size: 1.6rem;
                font-weight: 800;
                color: #0099FF;
            }
            .bulk-summary-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 4px;
            }
            .bulk-tag-chip {
                background: rgba(0, 153, 255, 0.09);
                color: #0284c7;
                padding: 3px 9px;
                border-radius: 6px;
                font-size: 0.78rem;
                font-weight: 600;
                border: 1px solid rgba(0, 153, 255, 0.22);
            }
            [data-theme="dark"] .bulk-tag-chip {
                background: rgba(0, 153, 255, 0.18);
                color: #60a5fa;
                border-color: rgba(0, 153, 255, 0.35);
            }
            .bulk-alert-box {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 12px 14px;
                border-radius: 12px;
                font-size: 0.85rem;
                line-height: 1.45;
            }
            .bulk-alert-box.warning {
                background: #fffbeb;
                border: 1px solid #fde68a;
                color: #b45309;
            }
            [data-theme="dark"] .bulk-alert-box.warning {
                background: rgba(245, 158, 11, 0.12);
                border: 1px solid rgba(245, 158, 11, 0.3);
                color: #fbbf24;
            }
            .bulk-live-status-box {
                display: flex;
                flex-direction: column;
                gap: 16px;
                text-align: center;
            }
            .bulk-live-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .bulk-state-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 0.82rem;
                font-weight: 600;
            }
            .bulk-state-badge.in-progress {
                background: rgba(0, 153, 255, 0.15);
                color: #0099FF;
            }
            .bulk-state-badge.completed {
                background: rgba(16, 185, 129, 0.15);
                color: #10b981;
            }
            .bulk-state-badge.cancelled {
                background: rgba(239, 68, 68, 0.15);
                color: #ef4444;
            }
            .bulk-live-pct {
                font-size: 1.15rem;
                font-weight: 700;
                color: var(--text-main, #0f172a);
            }
            .bulk-linear-track {
                width: 100%;
                height: 12px;
                background: #e2e8f0;
                border-radius: 8px;
                overflow: hidden;
                position: relative;
            }
            [data-theme="dark"] .bulk-linear-track {
                background: rgba(255, 255, 255, 0.1);
            }
            .bulk-linear-bar {
                height: 100%;
                background: linear-gradient(90deg, #0099FF 0%, #0284c7 100%);
                border-radius: 8px;
                transition: width 0.35s ease-out, background 0.3s;
            }
            .bulk-counter-box {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
                margin: 6px 0;
            }
            .bulk-counter-primary {
                font-size: 2.1rem;
                font-weight: 800;
                letter-spacing: -0.5px;
                color: var(--text-main, #0f172a);
                font-family: monospace, system-ui;
            }
            .bulk-counter-sub {
                font-size: 0.82rem;
                color: var(--text-muted, #64748b);
                text-transform: uppercase;
                letter-spacing: 0.8px;
            }
            .bulk-stats-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 14px;
            }
            .bulk-stat-pill {
                padding: 6px 14px;
                border-radius: 10px;
                font-size: 0.85rem;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .bulk-stat-pill.success {
                background: rgba(16, 185, 129, 0.1);
                color: #10b981;
                border: 1px solid rgba(16, 185, 129, 0.25);
            }
            .bulk-stat-pill.danger {
                background: rgba(239, 68, 68, 0.1);
                color: #ef4444;
                border: 1px solid rgba(239, 68, 68, 0.25);
            }
            .bulk-live-info-msg {
                font-size: 0.82rem;
                color: var(--text-muted, #64748b);
                margin-top: 4px;
            }
            </style>

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
        window.syncAndSaveConnection    = syncAndSaveConnection;
        window.startQuickBulkSend       = startQuickBulkSend;
        window.filterBulkTags           = filterBulkTags;
        window.closeBulkFlowModal       = closeBulkFlowModal;
        window.executeConfirmedBulkSend = executeConfirmedBulkSend;
        window.requestCancelBulkSend    = requestCancelBulkSend;
        window.cloneTemplateToCurrentService = cloneTemplateToCurrentService;
        window.addEventListener('resize', scheduleTemplatePreviewFit);

        await checkMetaConnection();
    }

    function destroy() {
        if (_popupCheckInterval) { clearInterval(_popupCheckInterval); _popupCheckInterval = null; }
        if (_previewFitFrame) { cancelAnimationFrame(_previewFitFrame); _previewFitFrame = null; }
        if (_bulkPollingTimer) { clearInterval(_bulkPollingTimer); _bulkPollingTimer = null; }
        window.removeEventListener('resize', scheduleTemplatePreviewFit);
        document.getElementById('tpl-preview-modal')?.remove();
        document.getElementById('bulk-flow-modal')?.remove();
        ['switchMetaTab', 'showTemplateDetail', 'startBulkSend', 'downloadBulkExcel',
         'toggleTagChip', 'toggleMetaAccordion', 'showTplPreviewModal', 'launchMetaOnboardingView',
         'syncAndSaveConnection', 'startQuickBulkSend', 'filterBulkTags',
         'closeBulkFlowModal', 'executeConfirmedBulkSend', 'requestCancelBulkSend',
         'cloneTemplateToCurrentService'
        ].forEach(fn => { delete window[fn]; });
    }

    // ── Verificacion de conexion ──────────────────────────────────────────
    async function checkMetaConnection(silent = false) {
        try {
            const sId = (typeof window !== 'undefined' && window.railwayServiceId) ? window.railwayServiceId : '';
            const pId = (typeof window !== 'undefined' && window.railwayProjectId) ? window.railwayProjectId : '';
            const res  = await fetch(`/api/backoffice/whatsapp/config?token=${_token}&serviceId=${sId}&projectId=${pId}`);
            const data = await res.json();
            _metaConfig = (data && data.config) || {};
            const validId = (v) => v && v !== 'PENDING';
            const connected = validId(_metaConfig.waba_id) && validId(_metaConfig.phone_number_id);

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
                checkProjectTemplates();
            } else if (!silent) {
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
                    updateBulkTagsCount();
                    return;
                }
                container.innerHTML = data.map(t =>
                    `<span class="bulk-tag-chip" data-id="${escapeTemplateText(t.id)}" data-name="${escapeTemplateText(t.name)}" onclick="toggleTagChip(this)">${escapeTemplateText(t.name)}</span>`
                ).join('');
                updateBulkTagsCount();
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
        updateBulkTagsCount();
    }

    function updateBulkTagsCount() {
        const countEl = document.getElementById('bulk-tags-count');
        if (!countEl) return;
        const count = _selectedTagIds.size;
        countEl.innerText = count === 1 ? '1 seleccionada' : `${count} seleccionadas`;
    }

    function filterBulkTags(value = '') {
        const query = String(value).trim().toLowerCase();
        document.querySelectorAll('#bulk-filter-tags .bulk-tag-chip').forEach(chip => {
            const name = (chip.dataset.name || chip.textContent || '').toLowerCase();
            chip.style.display = !query || name.includes(query) ? 'inline-flex' : 'none';
        });
    }

    function scheduleTemplatePreviewFit() {
        if (_previewFitFrame) cancelAnimationFrame(_previewFitFrame);
        _previewFitFrame = requestAnimationFrame(fitTemplatePreview);
    }

    function fitTemplatePreview() {
        _previewFitFrame = null;
        const shell = document.querySelector('#view-template-detail .tpl-preview-screen');
        const bubble = document.querySelector('#view-template-detail .wa-preview-bubble');
        if (!shell || !bubble) return;
        bubble.style.setProperty('--tpl-preview-scale', '1');
        const availableW = Math.max(shell.clientWidth - 28, 1);
        const availableH = Math.max(shell.clientHeight - 28, 1);
        const contentW = Math.max(bubble.scrollWidth, bubble.offsetWidth, 1);
        const contentH = Math.max(bubble.scrollHeight, bubble.offsetHeight, 1);
        const scale = Math.min(1, availableW / contentW, availableH / contentH);
        bubble.style.setProperty('--tpl-preview-scale', String(Math.max(0.48, scale)));
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
            const params = new URLSearchParams({ token: _token });
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
            const res  = await fetch(`/api/backoffice/whatsapp/templates?${params.toString()}`);
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

    function escapeTemplateText(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeTemplateArg(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, ' ');
    }

    function getTemplatePreviewText(template) {
        let text = 'Sin contenido de previsualizacion';
        if (template.components && Array.isArray(template.components)) {
            const body = template.components.find(c => c.type === 'BODY' || c.type?.toUpperCase() === 'BODY');
            if (body) text = body.text || body.content || body.example?.body_text?.[0]?.[0] || text;
            if (text === 'Sin contenido de previsualizacion') {
                for (const comp of template.components) {
                    if (comp.text || comp.content) { text = comp.text || comp.content; break; }
                }
            }
        } else if (template.body) {
            text = template.body;
        }
        return String(text || 'Sin contenido de previsualizacion');
    }

    function formatTemplateDate(template) {
        const value = template.last_updated_time || template.updated_at || template.modified_at || template.created_at;
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function renderCards(container, templates) {
        if (!templates || templates.length === 0) {
            container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">No se encontraron plantillas.</p>';
            return;
        }
        const rows = templates.map(t => {
            const text = getTemplatePreviewText(t);
            const cleanText = text.length > 150 ? text.substring(0, 147) + '...' : text;
            const cardClass = t.status === 'APPROVED' ? 'meta-card-approved' : (t.status === 'REJECTED' ? 'meta-card-rejected' : 'meta-card-pending');
            const statusClass = t.status === 'APPROVED' ? 'meta-status-approved' : (t.status === 'REJECTED' ? 'meta-status-rejected' : 'meta-status-pending');
            return `
                <button type="button" class="meta-template-row meta-card ${cardClass}" onclick="showTemplateDetail('${escapeTemplateArg(t.id || t.name)}','${escapeTemplateArg(t.language)}')">
                    <span class="meta-row-name">${escapeTemplateText(t.name)}</span>
                    <span class="meta-row-category">${escapeTemplateText(t.category || '--')}</span>
                    <span class="meta-row-language">
                        <strong>${escapeTemplateText((t.language || '').toUpperCase() || '--')}</strong>
                        <small>${escapeTemplateText(cleanText)}</small>
                    </span>
                    <span class="meta-row-status"><span class="meta-card-tag ${statusClass}">${escapeTemplateText(t.status || 'PENDING')}</span></span>
                    <span class="meta-row-updated">${escapeTemplateText(formatTemplateDate(t))}</span>
                    <span class="meta-card-mobile-desc">${escapeTemplateText(cleanText)}</span>
                    <span class="meta-card-mobile-meta">
                        <span><i class="fas fa-fingerprint"></i> ID: ${escapeTemplateText(t.id || 'N/A')}</span>
                        <span><i class="fas fa-globe"></i> ${escapeTemplateText((t.language || '').toUpperCase() || '--')}</span>
                        <span><i class="fas fa-tag"></i> ${escapeTemplateText(t.category || '--')}</span>
                    </span>
                </button>`;
        }).join('');
        container.innerHTML = `
            <div class="meta-template-table" style="height:100%; max-height:100%; overflow-y:auto; overflow-x:hidden;">
                <div class="meta-template-row meta-template-head" aria-hidden="true">
                    <span>Nombre de la plantilla</span>
                    <span>Categoria</span>
                    <span>Idioma</span>
                    <span>Estado</span>
                    <span>Ultima modificacion</span>
                </div>
                ${rows}
            </div>`;
    }

    // ── Tabs ──────────────────────────────────────────────────────────────
    function switchMetaTab(tab) {
        const myView      = document.getElementById('view-my-templates');
        const projView    = document.getElementById('view-project-templates');
        const detailView  = document.getElementById('view-template-detail');
        const myTabBtn    = document.getElementById('tab-my-templates');
        const projTabBtn  = document.getElementById('tab-project-templates');
        const backBtn     = document.getElementById('tpl-detail-back-header');
        const subtitle    = document.getElementById('meta-templates-subtitle');

        if (tab === 'my') {
            if (myView)     { myView.style.display = 'grid'; myView.style.height = '100%'; myView.style.minHeight = '0'; myView.style.overflow = 'hidden'; }
            if (projView)   projView.style.display = 'none';
            if (detailView) detailView.style.display = 'none';
            if (myTabBtn)   { myTabBtn.classList.add('active'); myTabBtn.style.opacity = '1'; }
            if (projTabBtn) { projTabBtn.classList.remove('active'); projTabBtn.style.opacity = '0.65'; }
            if (backBtn)    backBtn.style.display = 'none';
            if (subtitle)   subtitle.innerText = 'Plantillas de esta línea.';
            loadTemplates();
        } else if (tab === 'project') {
            if (myView)     myView.style.display = 'none';
            if (projView)   { projView.style.display = 'grid'; projView.style.height = '100%'; projView.style.minHeight = '0'; projView.style.overflow = 'hidden'; }
            if (detailView) detailView.style.display = 'none';
            if (projTabBtn) { projTabBtn.classList.add('active'); projTabBtn.style.opacity = '1'; }
            if (myTabBtn)   { myTabBtn.classList.remove('active'); myTabBtn.style.opacity = '0.65'; }
            if (backBtn)    backBtn.style.display = 'none';
            loadProjectTemplates();
        } else if (tab === 'detail') {
            if (myView)     myView.style.display = 'none';
            if (projView)   projView.style.display = 'none';
            if (detailView) detailView.style.display = 'flex';
            if (myTabBtn)   { myTabBtn.classList.remove('active'); myTabBtn.style.opacity = '0.65'; }
            if (projTabBtn) { projTabBtn.classList.remove('active'); projTabBtn.style.opacity = '0.65'; }
            if (backBtn)    backBtn.style.display = 'inline-flex';
            if (subtitle)   subtitle.innerText = 'Configura filtros y prepara el envío.';
        }
    }

    // ── Plantillas de otras líneas del proyecto (Cross-WABA) ─────────────────
    async function checkProjectTemplates() {
        try {
            const params = new URLSearchParams({ token: _token });
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);

            const res = await fetch(`/api/backoffice/whatsapp/project-templates?${params.toString()}`);
            const data = await res.json();

            const projTab = document.getElementById('tab-project-templates');
            const countBadge = document.getElementById('badge-project-tpl-count');

            if (data.success && data.hasMultipleServices && data.templates && data.templates.length > 0) {
                _projectTemplates = data.templates;
                if (projTab) projTab.style.display = 'flex';
                if (countBadge) {
                    countBadge.innerText = String(data.templates.length);
                    countBadge.style.display = 'inline-flex';
                }
            } else if (projTab) {
                projTab.style.display = 'none';
            }
        } catch (err) {
            console.warn('[ProjectTemplates] Error al verificar plantillas del proyecto:', err);
        }
    }

    async function loadProjectTemplates() {
        const container = document.getElementById('view-project-templates');
        if (!container) return;
        container.innerHTML = `
            <div class="text-center py-10 opacity-50" style="grid-column:1/-1;">
                <i class="fas fa-circle-notch fa-spin text-3xl text-accent-bright"></i>
                <p class="text-sm text-secondary-content mt-3">Sincronizando plantillas de otras líneas del proyecto...</p>
            </div>`;

        try {
            const params = new URLSearchParams({ token: _token });
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);

            const res = await fetch(`/api/backoffice/whatsapp/project-templates?${params.toString()}`);
            const data = await res.json();

            if (data.success && data.templates) {
                _projectTemplates = data.templates;
                renderProjectCards(container, _projectTemplates);
            } else {
                container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">No se encontraron plantillas en otras líneas del proyecto.</p>';
            }
        } catch (e) {
            container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Error al consultar plantillas de otras líneas.</p>';
        }
    }

    function renderProjectCards(container, templates) {
        if (!templates || templates.length === 0) {
            container.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">No se encontraron plantillas en otras líneas del proyecto.</p>';
            return;
        }

        const gridColumns = 'minmax(0, 3.2fr) minmax(105px, 1fr) minmax(75px, 0.7fr) minmax(110px, 0.9fr) minmax(185px, 1.4fr)';

        const rows = templates.map(t => {
            const statusClass = t.status === 'APPROVED' ? 'meta-status-approved' : (t.status === 'REJECTED' ? 'meta-status-rejected' : 'meta-status-pending');

            const actionHtml = t.alreadyInCurrentService
                ? `<span style="color:#10b981; font-size:0.82rem; font-weight:700; display:inline-flex; align-items:center; gap:6px; background:rgba(16,185,129,0.12); padding:5px 12px; border-radius:8px; white-space:nowrap;">
                       <i class="fas fa-check-circle"></i> Disponible en esta línea
                   </span>`
                : `<button type="button" class="btn-primary" style="padding:6px 14px; font-size:0.82rem; min-height:34px; white-space:nowrap;" onclick="cloneTemplateToCurrentService('${escapeTemplateArg(t.originServiceId)}','${escapeTemplateArg(t.id || '')}','${escapeTemplateArg(t.name)}','${escapeTemplateArg(t.language || 'es')}', this)">
                       <i class="fas fa-download"></i> Vincular a esta línea
                   </button>`;

            return `
                <div class="meta-template-row meta-card meta-card-approved" style="cursor:default; display:grid; grid-template-columns: ${gridColumns}; align-items:center; gap:12px; padding:14px 18px;">
                    <div style="min-width:0; overflow:hidden;">
                        <span class="meta-row-name" title="${escapeTemplateText(t.name)}" style="font-weight:700; font-size:0.92rem; color:var(--text-main); display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeTemplateText(t.name)}</span>
                        <div style="margin-top:4px;">
                            <span style="background:rgba(0,153,255,0.1); color:#0099FF; border:1px solid rgba(0,153,255,0.22); padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:600; display:inline-flex; align-items:center; gap:5px; max-width:100%;" title="${escapeTemplateText(t.originServiceName)}">
                                <i class="fas fa-mobile-alt" style="flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeTemplateText(t.originServiceName)}</span>
                            </span>
                        </div>
                    </div>
                    <span class="meta-row-category" style="font-size:0.85rem; color:var(--text-muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeTemplateText(t.category || '--')}</span>
                    <span class="meta-row-language" style="font-size:0.85rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        <strong>${escapeTemplateText((t.language || '').toUpperCase() || '--')}</strong>
                    </span>
                    <span class="meta-row-status" style="min-width:0;">
                        <span class="meta-card-tag ${statusClass}" style="position:static; transform:none;">${escapeTemplateText(t.status || 'PENDING')}</span>
                    </span>
                    <div style="text-align:right; min-width:0; flex-shrink:0;">
                        ${actionHtml}
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = `
            <div class="meta-template-table" style="height:100%; max-height:100%; overflow-y:auto; overflow-x:hidden;">
                <div class="meta-template-row meta-template-head" style="display:grid; grid-template-columns: ${gridColumns}; align-items:center; gap:12px;" aria-hidden="true">
                    <span>Plantilla / Línea de Origen</span>
                    <span>Categoría</span>
                    <span>Idioma</span>
                    <span>Estado en Meta</span>
                    <span style="text-align:right;">Acción</span>
                </div>
                ${rows}
            </div>`;
    }

    async function cloneTemplateToCurrentService(sourceServiceId, templateId, templateName, language, btnEl) {
        if (!sourceServiceId || !templateName) return;

        const originalBtnHtml = btnEl ? btnEl.innerHTML : '';
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vinculando...';
        }

        try {
            const params = new URLSearchParams({ token: _token });
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);

            const res = await fetch(`/api/backoffice/whatsapp/clone-template-to-service?${params.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceServiceId,
                    templateId,
                    templateName,
                    language
                })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                if (btnEl) {
                    btnEl.outerHTML = `<span style="color:#10b981; font-size:0.82rem; font-weight:700; display:inline-flex; align-items:center; gap:6px; background:rgba(16,185,129,0.12); padding:5px 12px; border-radius:8px;">
                        <i class="fas fa-check-circle"></i> Vinculada con éxito
                    </span>`;
                }
                showToast(data.message || `✅ Plantilla "${templateName}" vinculada a esta línea`, 'success');
                // Refrescar plantillas propias en segundo plano
                loadTemplates();
            } else {
                throw new Error(data.error || 'Error al vincular plantilla');
            }
        } catch (e) {
            console.error('[CloneTemplate] Error:', e);
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalBtnHtml;
            }
            showToast('Error: ' + e.message, 'error');
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
                    if (imgUrl) html += `<img src="${escapeTemplateText(imgUrl)}" class="wa-preview-media wa-preview-media-image" alt="Vista previa de plantilla">`;
                } else if (fmt === 'video') {
                    html += `<div class="wa-preview-media wa-preview-media-video"><i class="fas fa-play-circle fa-3x"></i></div>`;
                } else if (fmt === 'document') {
                    html += `<div class="wa-preview-media wa-preview-media-document"><i class="fas fa-file-pdf"></i> <span>Documento</span></div>`;
                }
            }
            if (headerText) html += `<div class="wa-preview-header-text">${escapeTemplateText(headerText)}</div>`;
            html += `<div class="wa-preview-body-text">${escapeTemplateText(bodyText)}</div>`;
            if (footerText) html += `<div class="wa-preview-footer-text">${escapeTemplateText(footerText)}</div>`;
            previewEl.innerHTML = html;
            previewEl.querySelectorAll('img').forEach(img => img.addEventListener('load', scheduleTemplatePreviewFit));

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
                    btn.innerHTML = `${icon} ${escapeTemplateText(b.text)}`;
                    btnsContainer.appendChild(btn);
                });
                bubble.appendChild(btnsContainer);
            }
            scheduleTemplatePreviewFit();
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
        scheduleTemplatePreviewFit();
    }

    // ── Descarga Excel ────────────────────────────────────────────────────
    function downloadBulkExcel() {
        if (!_currentTemplate) return;
        const params = new URLSearchParams({ token: _token });
        if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
        if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
        const start  = document.getElementById('bulk-filter-start')?.value;
        const end    = document.getElementById('bulk-filter-end')?.value;
        if (start) params.set('startDate', start);
        if (end) params.set('endDate', end);
        if (_selectedTagIds.size > 0) params.set('tagIds', [..._selectedTagIds].join(','));
        const url = `/api/backoffice/whatsapp/template-excel/${encodeURIComponent(_currentTemplate.name)}?${params.toString()}`;
        window.open(url, '_blank');
    }

    // ── Helper SheetJS para contar Excel en cliente ────────────────────────
    function ensureXlsx() {
        if (window.XLSX) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('No se pudo cargar el lector XLSX'));
            document.head.appendChild(script);
        });
    }

    async function parseExcelFileCount(file) {
        try {
            await ensureXlsx();
            const buffer = await file.arrayBuffer();
            const workbook = window.XLSX.read(buffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
            if (!data || data.length === 0) return { totalRows: 0, validPhones: 0 };

            let validPhones = 0;
            data.forEach(row => {
                const phoneKey = Object.keys(row).find(k =>
                    ['phone', 'tel', 'movil', 'cel', 'celular', 'telefono', 'whatsapp'].some(p => k.toLowerCase().includes(p))
                );
                const phone = phoneKey ? String(row[phoneKey] ?? '').replace(/\D/g, '') : '';
                if (phone && phone.length >= 6) validPhones++;
            });
            return { totalRows: data.length, validPhones: validPhones || data.length };
        } catch (err) {
            console.warn('Error leyendo Excel en cliente:', err);
            return { totalRows: 0, validPhones: 0 };
        }
    }

    // ── Ventana Modal de Envío Masivo ───────────────────────────────────────
    function openBulkFlowModal(config) {
        const modal = document.getElementById('bulk-flow-modal');
        if (!modal) return;

        // Fase 1 Visible, Fase 2 Oculta
        document.getElementById('bulk-phase-confirm').style.display = 'flex';
        const confirmFooter = document.getElementById('bulk-phase-confirm-footer');
        if (confirmFooter) confirmFooter.style.display = 'flex';
        document.getElementById('bulk-phase-progress').style.display = 'none';
        const progressFooter = document.getElementById('bulk-phase-progress-footer');
        if (progressFooter) progressFooter.style.display = 'none';

        // Setear datos del resumen
        document.getElementById('bmc-template-name').innerText = config.templateName || '-';
        document.getElementById('bmc-total-contacts').innerText = String(config.totalContacts || 0);
        document.getElementById('bmc-source-type').innerText = config.sourceType || '-';
        document.getElementById('bmc-date-range').innerText = config.dateRange || 'Todo el historial';

        const tagsListEl = document.getElementById('bmc-tags-list');
        if (tagsListEl) {
            if (config.tagNames && config.tagNames.length > 0) {
                tagsListEl.innerHTML = config.tagNames.map(t => `<span class="bulk-tag-chip"><i class="fas fa-tag"></i> ${escapeTemplateText(t)}</span>`).join('');
            } else {
                tagsListEl.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Sin filtro de etiquetas</span>';
            }
        }

        const confirmBtn = document.getElementById('bmc-confirm-btn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Iniciar Envío Masivo';
        }

        modal.style.display = 'flex';
    }

    async function closeBulkFlowModal() {
        const modal = document.getElementById('bulk-flow-modal');
        if (!modal) return;

        // Si hay una campaña corriendo, advertir al usuario
        if (_activeBulkCampaignId) {
            const cancel = await window.swalConfirm('¿Cerrar ventana?', 'El envío masivo continúa ejecutándose en segundo plano. ¿Deseas cerrar la ventana de monitoreo?');
            if (!cancel) return;
        }

        if (_bulkPollingTimer) {
            clearInterval(_bulkPollingTimer);
            _bulkPollingTimer = null;
        }
        _activeBulkCampaignId = null;
        _pendingBulkPayload = null;
        modal.style.display = 'none';
    }

    // ── Ejecutar Envío Masivo Confirmado ────────────────────────────────────
    async function executeConfirmedBulkSend() {
        if (!_pendingBulkPayload || !_currentTemplate) return;

        const confirmBody  = document.getElementById('bulk-phase-confirm');
        const progressBody = document.getElementById('bulk-phase-progress');
        const progressBar  = document.getElementById('bulk-linear-bar');
        const counterText  = document.getElementById('bulk-counter-text');
        const pctText      = document.getElementById('bulk-live-percentage');
        const stateBadge   = document.getElementById('bulk-live-state-badge');
        const cancelBtn    = document.getElementById('bulk-cancel-btn');
        const doneBtn      = document.getElementById('bulk-done-btn');
        const infoMsg      = document.getElementById('bulk-live-info-msg');

        confirmBody.style.display  = 'none';
        const confirmFooter = document.getElementById('bulk-phase-confirm-footer');
        if (confirmFooter) confirmFooter.style.display = 'none';
        progressBody.style.display = 'flex';
        const progressFooter = document.getElementById('bulk-phase-progress-footer');
        if (progressFooter) progressFooter.style.display = 'flex';

        // Reset barra y contadores
        const totalExpected = _pendingBulkPayload.totalContacts || 0;
        progressBar.style.width = '0%';
        progressBar.style.background = 'linear-gradient(90deg, #0668E1 0%, #0099FF 100%)';
        counterText.innerText = `0 / ${totalExpected}`;
        pctText.innerText = '0%';
        document.getElementById('bulk-stat-sent').innerText = '0';
        document.getElementById('bulk-stat-errors').innerText = '0';

        stateBadge.className = 'bulk-state-badge in-progress';
        stateBadge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        cancelBtn.style.display = 'inline-flex';
        cancelBtn.disabled = false;
        cancelBtn.innerHTML = '<i class="fas fa-stop-circle"></i> Cancelar Envío';
        doneBtn.style.display = 'none';
        infoMsg.innerText = 'Iniciando envío a WhatsApp a través de Meta...';

        _activeBulkCampaignId = 'bulk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        // Escuchar eventos por socket
        const handleProgress = (data) => {
            if (data.campaignId !== _activeBulkCampaignId) return;
            updateBulkProgressUI(data);
        };

        const sock = window.socket || (typeof io === 'function' ? (window._appSocket || io()) : null);
        if (sock) {
            sock.off?.('bulk_progress');
            sock.on('bulk_progress', handleProgress);
        }

        // Polling de respaldo cada 1200ms
        if (_bulkPollingTimer) clearInterval(_bulkPollingTimer);
        _bulkPollingTimer = setInterval(async () => {
            if (!_activeBulkCampaignId) return;
            try {
                const res = await fetch(`/api/backoffice/whatsapp/bulk-status/${_activeBulkCampaignId}?token=${_token}`);
                const data = await res.json();
                if (data.success && data.campaign) {
                    updateBulkProgressUI(data.campaign);
                }
            } catch (_) {}
        }, 1200);

        try {
            const params = new URLSearchParams({ token: _token });
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);

            if (_pendingBulkPayload.type === 'excel') {
                const formData = new FormData();
                formData.append('file', _pendingBulkPayload.file);
                formData.append('templateName', _currentTemplate.name);
                formData.append('languageCode', _currentTemplate.language || 'es');
                formData.append('campaignId', _activeBulkCampaignId);
                if (window.railwayProjectId) formData.append('projectId', window.railwayProjectId);
                if (window.railwayServiceId) formData.append('serviceId', window.railwayServiceId);

                const res = await fetch(`/api/backoffice/whatsapp/send-bulk-template?${params.toString()}`, {
                    method: 'POST',
                    body: formData
                });
                if (res.status !== 202) {
                    const data = await res.json();
                    throw new Error(data.error || 'Error al iniciar envío masivo por Excel');
                }
            } else if (_pendingBulkPayload.type === 'quick') {
                const res = await fetch(`/api/backoffice/whatsapp/send-quick-template?${params.toString()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        templateName: _currentTemplate.name,
                        languageCode: _currentTemplate.language || 'es',
                        startDate: _pendingBulkPayload.startDate || '',
                        endDate: _pendingBulkPayload.endDate || '',
                        tagIds: _pendingBulkPayload.tagIds || [],
                        campaignId: _activeBulkCampaignId,
                        projectId: window.railwayProjectId || '',
                        serviceId: window.railwayServiceId || ''
                    })
                });
                const data = await res.json();
                if (res.status !== 202 || !data.success) {
                    throw new Error(data.error || 'Error al iniciar envío rápido');
                }
            }
        } catch (err) {
            console.error('[Bulk Send] Error al disparar:', err);
            stateBadge.className = 'bulk-state-badge cancelled';
            stateBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error';
            infoMsg.innerText = '❌ Error al iniciar el envío: ' + err.message;
            cancelBtn.style.display = 'none';
            doneBtn.style.display = 'inline-flex';
            if (_bulkPollingTimer) { clearInterval(_bulkPollingTimer); _bulkPollingTimer = null; }
        }
    }

    function updateBulkProgressUI(data) {
        const progressBar  = document.getElementById('bulk-linear-bar');
        const counterText  = document.getElementById('bulk-counter-text');
        const pctText      = document.getElementById('bulk-live-percentage');
        const stateBadge   = document.getElementById('bulk-live-state-badge');
        const cancelBtn    = document.getElementById('bulk-cancel-btn');
        const doneBtn      = document.getElementById('bulk-done-btn');
        const infoMsg      = document.getElementById('bulk-live-info-msg');
        const sentEl       = document.getElementById('bulk-stat-sent');
        const errorsEl     = document.getElementById('bulk-stat-errors');

        if (!progressBar) return;

        const total = data.total || 1;
        const current = data.current || 0;
        const pct = Math.min(100, Math.round((current / total) * 100));

        progressBar.style.width = `${pct}%`;
        pctText.innerText = `${pct}%`;
        counterText.innerText = `${current} / ${total}`;
        if (sentEl) sentEl.innerText = String(data.sent || 0);
        if (errorsEl) errorsEl.innerText = String(data.errors || 0);

        if (data.status === 'completed') {
            stateBadge.className = 'bulk-state-badge completed';
            stateBadge.innerHTML = '<i class="fas fa-check-circle"></i> Envío Completado';
            progressBar.style.background = '#10b981';
            infoMsg.innerText = `🎉 ¡Envío finalizado! Se procesaron ${current} contactos (${data.sent || 0} exitosos, ${data.errors || 0} fallidos).`;
            cancelBtn.style.display = 'none';
            doneBtn.style.display = 'inline-flex';
            if (_bulkPollingTimer) { clearInterval(_bulkPollingTimer); _bulkPollingTimer = null; }
            _activeBulkCampaignId = null;
        } else if (data.status === 'cancelled' || data.cancelled) {
            stateBadge.className = 'bulk-state-badge cancelled';
            stateBadge.innerHTML = '<i class="fas fa-stop-circle"></i> Envío Cancelado';
            progressBar.style.background = '#f59e0b';
            infoMsg.innerText = `⚠️ El envío fue cancelado por el usuario. Se procesaron ${current} de ${total} contactos (${data.sent || 0} exitosos).`;
            cancelBtn.style.display = 'none';
            doneBtn.style.display = 'inline-flex';
            if (_bulkPollingTimer) { clearInterval(_bulkPollingTimer); _bulkPollingTimer = null; }
            _activeBulkCampaignId = null;
        } else {
            infoMsg.innerText = `Enviando... ${current} de ${total} contactos procesados.`;
        }
    }

    // ── Solicitar Cancelación en Caliente ───────────────────────────────────
    async function requestCancelBulkSend() {
        if (!_activeBulkCampaignId) return;

        const ok = await window.swalConfirm('¿Detener envío masivo?', 'Se cancelará el envío a los contactos restantes. Los mensajes ya enviados no se pueden anular.');
        if (!ok) return;

        const cancelBtn = document.getElementById('bulk-cancel-btn');
        if (cancelBtn) {
            cancelBtn.disabled = true;
            cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';
        }

        try {
            const res = await fetch('/api/backoffice/whatsapp/cancel-bulk-template', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${_token}`
                },
                body: JSON.stringify({ campaignId: _activeBulkCampaignId })
            });
            const data = await res.json();
            if (data.success) {
                showToast('🛑 Solicitud de cancelación enviada', 'info');
            }
        } catch (e) {
            console.error('Error al solicitar cancelación:', e);
            showToast('Error al comunicar la cancelación', 'error');
        }
    }

    // ── Envio masivo (Excel) ───────────────────────────────────────────────
    async function startBulkSend() {
        if (!_currentTemplate) return;
        const fileInput = document.getElementById('bulk-file-input');
        const btn = document.getElementById('send-bulk-btn');

        if (!fileInput.files.length) {
            showToast('⚠️ Suba un archivo Excel para iniciar', 'error');
            return;
        }

        const file = fileInput.files[0];
        const originalBtnHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Leyendo...';

        try {
            const counts = await parseExcelFileCount(file);
            if (counts.totalRows === 0) {
                showToast('❌ El archivo Excel parece estar vacío o no tiene formato válido', 'error');
                btn.disabled = false;
                btn.innerHTML = originalBtnHtml;
                return;
            }

            _pendingBulkPayload = {
                type: 'excel',
                file: file,
                totalContacts: counts.validPhones
            };

            btn.disabled = false;
            btn.innerHTML = originalBtnHtml;

            openBulkFlowModal({
                templateName: _currentTemplate.name,
                language: _currentTemplate.language || 'es',
                totalContacts: counts.validPhones,
                sourceType: `Archivo Excel (${file.name})`,
                dateRange: 'Definido por filas del Excel',
                tagNames: []
            });
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = originalBtnHtml;
            showToast('Error al leer el archivo Excel: ' + e.message, 'error');
        }
    }

    // ── Envio masivo rápido (sin Excel con filtros) ────────────────────────
    async function startQuickBulkSend() {
        if (!_currentTemplate) return;
        const btn = document.getElementById('quick-send-btn');
        const startDate = document.getElementById('bulk-filter-start')?.value || '';
        const endDate   = document.getElementById('bulk-filter-end')?.value || '';
        const tagIds    = [..._selectedTagIds];

        const originalBtnHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando contactos...';
        }

        try {
            const params = new URLSearchParams({ token: _token });
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);

            const res = await fetch(`/api/backoffice/whatsapp/preview-quick-template?${params.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateName: _currentTemplate.name,
                    startDate,
                    endDate,
                    tagIds,
                    projectId: window.railwayProjectId || '',
                    serviceId: window.railwayServiceId || ''
                })
            });

            const data = await res.json();
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalBtnHtml;
            }

            if (!data.success || !data.count || data.count === 0) {
                showToast('⚠️ No se encontraron contactos que coincidan con los filtros aplicados', 'warning');
                return;
            }

            _pendingBulkPayload = {
                type: 'quick',
                startDate,
                endDate,
                tagIds,
                totalContacts: data.count
            };

            const dateStr = (startDate || endDate)
                ? `${startDate || 'Inicio'} hasta ${endDate || 'Hoy'}`
                : 'Todo el historial';

            openBulkFlowModal({
                templateName: _currentTemplate.name,
                language: _currentTemplate.language || 'es',
                totalContacts: data.count,
                sourceType: 'Base de Datos (Contactos Filtrados)',
                dateRange: dateStr,
                tagNames: data.tagNames || []
            });
        } catch (e) {
            console.error('[Quick Bulk Preview] Error:', e);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalBtnHtml;
            }
            showToast('Error al consultar destinatarios: ' + e.message, 'error');
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
        // Abrir popup ANTES del fetch para preservar el gesto del usuario
        const w = 600, h = 800;
        const left = (window.screen.width / 2) - (w / 2);
        const top  = (window.screen.height / 2) - (h / 2);
        const popup = window.open('about:blank', 'MetaOnboarding',
            `width=${w},height=${h},top=${top},left=${left},scrollbars=yes,status=no,menubar=no`);

        if (!popup) {
            showToast('⚠️ El navegador bloqueó la ventana emergente. Permitila e intenta de nuevo.', 'error');
            return;
        }

        const statusEl = document.getElementById('meta-onboard-status');
        if (statusEl) statusEl.style.display = 'block';

        const sId = (typeof window !== 'undefined' && window.railwayServiceId) ? window.railwayServiceId : '';
        const pId = (typeof window !== 'undefined' && window.railwayProjectId) ? window.railwayProjectId : '';
        fetch(`/api/backoffice/whatsapp/config?token=${_token}&serviceId=${sId}&projectId=${pId}`)
            .then(res => res.json())
            .then(data => {
                if (!data.appId) {
                    popup.close();
                    if (statusEl) statusEl.style.display = 'none';
                    showToast('⚠️ Faltan credenciales de Meta en el servidor', 'error');
                    return;
                }
                const origin = window.location.origin;
                const url = new URL('https://duskcodes.com.ar/meta-auth');
                url.searchParams.append('railwayProjectId', data.railwayProjectId);
                url.searchParams.append('RAILWAY_PROJECT_ID', data.railwayProjectId);
                url.searchParams.append('projectId', data.railwayProjectId);
                url.searchParams.append('metaAppId', data.appId);
                url.searchParams.append('metaAppSecret', data.appSecret);
                if (data.configId) url.searchParams.append('configId', data.configId);
                url.searchParams.append('projectUrl', origin);
                url.searchParams.append('redirectUri', `${origin}/api/backoffice/whatsapp/onboard-callback?serviceId=${sId}`);
                url.searchParams.append('state', `${data.railwayProjectId}:${sId}`);
                url.searchParams.append('serviceId', sId);
                url.searchParams.append('railwayServiceId', sId);

                popup.location.href = url.toString();

                if (_popupCheckInterval) clearInterval(_popupCheckInterval);
                _popupCheckInterval = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(_popupCheckInterval);
                        _popupCheckInterval = null;
                        if (statusEl) statusEl.style.display = 'none';
                        const btn = document.getElementById('meta-onboard-btn');
                        if (btn) {
                            btn.innerHTML = '<i class="fas fa-rotate"></i> Sincronizar y guardar';
                            btn.onclick = syncAndSaveConnection;
                        }
                    }
                }, 1000);
            })
            .catch(() => {
                popup.close();
                if (statusEl) statusEl.style.display = 'none';
                showToast('❌ Error al obtener configuracion', 'error');
            });
    }

    async function syncAndSaveConnection() {
        const btn = document.getElementById('meta-onboard-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sincronizando...';
        }
        try {
            const res = await fetch('/api/backoffice/whatsapp/sync-ids?token=' + _token, { method: 'POST' });
            const data = await res.json();
            if (!data.success) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-rotate"></i> Sincronizar y guardar';
                }
                showToast('Hubo un problema interno con las credenciales de vinculacion. Soporte sera notificado de este ticket.', 'error');
                return;
            }
            if (data.already) {
                showToast('Credenciales verificadas correctamente.', 'success');
            } else {
                showToast('Credenciales sincronizadas y guardadas correctamente.', 'success');
            }
        } catch (_) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-rotate"></i> Sincronizar y guardar';
            }
            showToast('Hubo un problema interno con las credenciales de vinculacion. Soporte sera notificado de este ticket.', 'error');
            return;
        }
        try {
            await checkMetaConnection(false);
        } catch (_) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-rotate"></i> Sincronizar y guardar';
            }
            showToast('Hubo un problema interno con las credenciales de vinculacion. Soporte sera notificado de este ticket.', 'error');
        }
    }

    // ── Acordion del panel ────────────────────────────────────────────────
    function toggleMetaAccordion() {
        const panel = document.querySelector('.meta-view-panel');
        if (panel) panel.classList.toggle('collapsed');
    }

    return {
        title: 'Plantillas Meta - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy
    };
})();
