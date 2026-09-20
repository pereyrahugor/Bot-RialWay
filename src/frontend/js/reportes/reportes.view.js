/* global showToast */
/* eslint-disable no-undef */
window.reportesView = (() => {
    let _token = '';
    let _reportes = [];
    let _socket = null;
    let _wabaGroups = [];
    let _wabaCapability = { checked: false, metaLinked: false, groupsEligible: false, reason: 'LOADING' };
    let _activeReportesView = 'reportes';
    let _selectedReporteId = null;
    let _reportDetailModalItems = new Map();
    let _isRestoringReportesScroll = false;

    function _getSelectedReporteStorageKey() {
        return `reportes:selected:${_token || 'default'}`;
    }

    function _getScrollStorageKey() {
        return `reportes:scroll:${_token || 'default'}`;
    }


    function getHTML() {
        return `
        <style>
            .reportes-page {
                height: 100dvh;
                max-height: 100dvh;
                display: flex;
                flex-direction: column;
                overflow-y: auto;
                overflow-x: hidden;
            }
            .reportes-page .kanban-header {
                flex-shrink: 0;
            }
            .reportes-body {
                flex: 1 0 auto;
                min-height: 0;
                overflow: visible;
                box-sizing: border-box;
                padding-bottom: max(80px, env(safe-area-inset-bottom));
            }
            #rep-active {
                height: auto;
                min-height: 0;
                display: flex;
                flex-direction: column;
            }
            .reportes-groups-card {
                flex-shrink: 0;
            }
            .reportes-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 12px;
                padding: 8px;
                border: 1px solid var(--border);
                border-radius: 16px;
                background: var(--card-bg, rgba(15, 35, 55, 0.72));
            }
            .reportes-toolbar.hidden {
                display: none;
            }
            .reportes-search {
                position: relative;
                flex: 1;
                min-width: 240px;
            }
            .reportes-search i {
                position: absolute;
                left: 15px;
                top: 50%;
                transform: translateY(-50%);
                color: var(--text-muted);
                font-size: 0.88rem;
                pointer-events: none;
            }
            .reportes-search input {
                width: 100%;
                box-sizing: border-box;
                padding: 9px 13px 9px 38px;
                border-radius: 12px;
                background: var(--input-bg, rgba(255,255,255,0.04));
                border: 1px solid var(--border);
                color: var(--text-main);
                font-size: 0.84rem;
                outline: none;
                transition: border-color 0.15s ease, background 0.15s ease;
            }
            .reportes-search input:focus {
                border-color: rgba(0,153,255,0.45);
            }
            .reportes-action-btn,
            .reportes-export-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                min-height: 36px;
                height: 36px;
                padding: 0 12px;
                border-radius: 10px;
                flex-shrink: 0;
                border: 1px solid rgba(100,116,139,0.36);
                background: rgba(30,41,59,0.78);
                color: #cbd5e1;
                cursor: pointer;
                font-size: 0.78rem;
                font-weight: 700;
                white-space: nowrap;
                transition: transform 0.14s ease;
            }
            [data-theme="light"] .reportes-action-btn,
            [data-theme="light"] .reportes-export-btn {
                color: #475569;
                background: #f3f4f6;
                border-color: #d1d5db;
            }
            .reportes-action-btn:hover,
            .reportes-export-btn:hover {
                transform: scale(0.97);
            }
            .reportes-action-btn:active,
            .reportes-export-btn:active {
                transform: scale(0.94);
            }
            .reportes-export-btn {
                min-width: 132px;
            }
            .reportes-groups-nav-btn {
                min-width: 156px;
            }
            .reportes-groups-nav-btn:disabled {
                cursor: not-allowed;
                opacity: 0.52;
                color: var(--text-muted);
                border-color: var(--border);
                background: rgba(148,163,184,0.08);
                transform: none;
            }
            .reportes-groups-view {
                display: none;
                flex-direction: column;
                gap: 16px;
            }
            .reportes-groups-view.active {
                display: flex;
            }
            .reportes-groups-shell {
                border: 1px solid var(--border);
                border-radius: 18px;
                padding: 16px;
                background: var(--card-bg, rgba(15, 35, 55, 0.72));
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .reportes-groups-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                flex-wrap: wrap;
            }
            .reportes-groups-title {
                min-width: 0;
                flex: 1;
            }
            .reportes-groups-title h2 {
                margin: 0 0 4px;
                color: var(--text-main);
                font-size: 1.05rem;
                font-weight: 850;
                display: flex;
                align-items: center;
                gap: 9px;
            }
            .reportes-groups-title p {
                margin: 0;
                color: var(--text-muted);
                font-size: 0.82rem;
                line-height: 1.35;
            }
            .reportes-back-btn {
                min-height: 36px;
                height: 36px;
                padding: 0 12px;
                border-radius: 10px;
                border: 1px solid var(--border);
                background: rgba(255,255,255,0.04);
                color: var(--text-main);
                font-size: 0.82rem;
                font-weight: 800;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .reportes-page .btn-primary.btn-sm {
                min-height: 36px;
                height: 36px;
                padding: 0 12px;
                border-radius: 10px;
                font-size: 0.8rem;
            }
            .waba-capability-card {
                border: 1px solid rgba(148,163,184,0.16);
                border-radius: 14px;
                padding: 14px;
                background: rgba(148,163,184,0.08);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                flex-wrap: wrap;
            }
            .waba-capability-title {
                margin: 0 0 4px;
                color: var(--text-main);
                font-weight: 850;
                font-size: 0.95rem;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .waba-capability-text {
                margin: 0;
                color: var(--text-muted);
                font-size: 0.82rem;
                line-height: 1.35;
            }
            .waba-status-pill {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                min-height: 34px;
                padding: 0 12px;
                border-radius: 999px;
                font-size: 0.78rem;
                font-weight: 850;
                border: 1px solid var(--border);
                color: var(--text-muted);
                background: rgba(148,163,184,0.10);
            }
            .waba-status-pill.ok {
                color: #22c55e;
                border-color: rgba(34,197,94,0.28);
                background: rgba(34,197,94,0.10);
            }
            .waba-status-pill.warn {
                color: #f59e0b;
                border-color: rgba(245,158,11,0.28);
                background: rgba(245,158,11,0.10);
            }
            .waba-status-pill.blocked {
                color: #ef4444;
                border-color: rgba(239,68,68,0.28);
                background: rgba(239,68,68,0.10);
            }
            .waba-groups-panel {
                border-top: 1px solid rgba(148,163,184,0.16);
                padding-top: 16px;
            }
            .waba-groups-panel-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 14px;
                flex-wrap: wrap;
            }
            .waba-groups-list-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
                gap: 12px;
            }
            .waba-group-icon-card {
                min-height: 138px;
                border: 1px solid var(--border);
                border-radius: 18px;
                background: rgba(255,255,255,0.035);
                color: var(--text-main);
                padding: 14px;
                cursor: pointer;
                text-align: center;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                position: relative;
            }
            .waba-group-avatar {
                width: 58px;
                height: 58px;
                border-radius: 999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: white;
                background: linear-gradient(135deg, #0099FF, #0ea5e9);
                font-weight: 900;
                font-size: 1.05rem;
            }
            .waba-group-name {
                width: 100%;
                color: var(--text-main);
                font-weight: 850;
                font-size: 0.88rem;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .waba-group-meta {
                color: var(--text-muted);
                font-size: 0.75rem;
                font-weight: 700;
            }
            .waba-group-delete-btn {
                position: absolute;
                top: 8px;
                right: 8px;
                width: 30px;
                height: 30px;
                border-radius: 999px;
                border: 1px solid rgba(239,68,68,0.22);
                background: rgba(239,68,68,0.08);
                color: #ef4444;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .reportes-list-view.hidden {
                display: none;
            }
            .reportes-count {
                font-size: 0.78rem;
                color: var(--text-muted);
                margin: 0 0 12px 4px;
                flex-shrink: 0;
            }
            #rep-list {
                flex: 0 0 auto;
                min-height: 0;
                overflow: visible;
            }
            .reportes-desktop-layout {
                display: none;
            }
            .reportes-mobile-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .report-accordion-card {
                border: 1px solid var(--border);
                border-radius: 16px;
                background: var(--card-bg, rgba(15, 35, 55, 0.72));
                overflow: hidden;
            }
            .report-accordion-card.active {
                border-color: rgba(0,153,255,0.58);
                box-shadow: inset 4px 0 0 #0099FF;
            }
            .report-accordion-toggle {
                width: 100%;
                border: 0;
                background: transparent;
                color: var(--text-main);
                padding: 14px 16px;
                cursor: pointer;
                text-align: left;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .report-accordion-summary {
                min-width: 0;
                display: grid;
                gap: 5px;
            }
            .report-accordion-type {
                color: #22c55e;
                font-size: 0.72rem;
                font-weight: 850;
                text-transform: uppercase;
                letter-spacing: 0.7px;
            }
            .report-accordion-info {
                color: var(--text-main);
                font-size: 0.96rem;
                font-weight: 850;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .report-accordion-date {
                color: var(--text-muted);
                font-size: 0.78rem;
                font-weight: 700;
            }
            .report-accordion-chevron {
                color: var(--text-muted);
                font-size: 0.82rem;
                transition: transform 0.16s ease;
                flex: 0 0 auto;
            }
            .report-accordion-card.active .report-accordion-chevron {
                transform: rotate(180deg);
                color: #0099FF;
            }
            .report-accordion-body {
                display: none;
                border-top: 1px solid var(--border);
                padding: 12px;
            }
            .report-accordion-card.active .report-accordion-body {
                display: block;
            }
            .report-accordion-body .report-detail-card {
                border: 0;
                border-radius: 0;
                background: transparent;
                min-height: 0;
            }
            .report-accordion-body .report-detail-head {
                display: none;
            }
            .report-accordion-body .report-detail-body {
                padding: 0;
            }
            .reportes-lead-list,
            .reportes-detail-panel {
                min-width: 0;
            }
            .reportes-detail-panel {
                height: auto;
                min-height: 0;
                overflow: visible;
            }
            .reportes-lead-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: calc(100dvh - 330px);
                overflow-y: auto;
                padding-right: 4px;
            }
            .report-lead-card {
                width: 100%;
                text-align: left;
                border: 1px solid var(--border);
                border-radius: 14px;
                background: var(--card-bg, rgba(15, 35, 55, 0.72));
                color: var(--text-main);
                cursor: pointer;
                padding: 13px 15px;
                display: grid;
                gap: 6px;
                transition: border-color 0.15s ease, background 0.15s ease;
            }
            .report-lead-card.active {
                border-color: rgba(0,153,255,0.62);
                background: rgba(0,153,255,0.10);
                box-shadow: inset 4px 0 0 #0099FF;
            }
            .report-lead-kicker {
                color: #22c55e;
                font-size: 0.74rem;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.7px;
            }
            .report-lead-name {
                font-size: 0.98rem;
                font-weight: 800;
                color: var(--text-main);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .report-lead-date {
                font-size: 0.78rem;
                color: var(--text-muted);
            }
            .report-detail-card {
                border: 1px solid var(--border);
                border-radius: 18px;
                background: var(--card-bg, rgba(15, 35, 55, 0.72));
                overflow: visible;
                min-height: 380px;
                display: flex;
                flex-direction: column;
            }
            .report-detail-head {
                padding: 14px 16px;
                border-bottom: 1px solid var(--border);
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 12px;
            }
            .report-detail-title {
                margin: 0 0 4px;
                font-size: 0.98rem;
                font-weight: 850;
                color: var(--text-main);
                display: flex;
                align-items: center;
                gap: 9px;
            }
            .report-detail-subtitle {
                margin: 0;
                color: var(--text-muted);
                font-size: 0.76rem;
            }
            .report-detail-body {
                flex: 1;
                padding: 14px 16px 16px;
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
                overflow: visible;
                min-height: 0;
                align-content: start;
                align-items: start;
            }
            .report-detail-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 9px 11px;
                border: 1px solid rgba(148,163,184,0.16);
                border-radius: 12px;
                background: rgba(255,255,255,0.025);
                min-width: 0;
                align-self: start;
            }
            .report-detail-label {
                color: #0099FF;
                font-size: 0.66rem;
                font-weight: 850;
                text-transform: uppercase;
                letter-spacing: 0.75px;
                flex: 0 0 auto;
                max-width: 44%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .report-detail-label::after {
                content: ":";
            }
            .report-detail-value {
                min-width: 0;
                color: var(--text-main);
                font-size: 0.82rem;
                line-height: 1.42;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: left;
                flex: 1 1 auto;
            }
            .report-detail-row.full {
                grid-column: 1 / -1;
            }
            .report-detail-row.full .report-detail-value {
                white-space: normal;
                overflow: visible;
                text-overflow: clip;
                word-break: break-word;
            }
            .report-detail-preview {
                display: flex;
                align-items: center;
                justify-content: flex-start;
                min-width: 0;
            }
            .report-detail-view-btn {
                min-height: 28px;
                height: 28px;
                padding: 0 10px;
                border-radius: 8px;
                border: 1px solid rgba(100,116,139,0.36);
                background: rgba(30,41,59,0.78);
                color: #cbd5e1;
                font-size: 0.72rem;
                font-weight: 800;
                cursor: pointer;
                flex-shrink: 0;
                transition: transform 0.14s ease;
            }
            [data-theme="light"] .report-detail-view-btn {
                color: #475569;
                background: #f3f4f6;
                border-color: #d1d5db;
            }
            .report-detail-view-btn:hover {
                transform: scale(0.97);
            }
            .report-chat-action {
                display: inline-flex;
                align-items: center;
                justify-content: flex-start;
                width: fit-content;
                max-width: 100%;
                color: #0099FF;
                font-weight: 850;
                text-decoration: none;
                transition: transform 0.14s ease;
                transform-origin: left center;
            }
            .report-chat-action:hover {
                transform: scale(0.97);
            }
            @media (min-width: 1024px) {
                .reportes-toolbar {
                    flex-wrap: nowrap;
                }
                .reportes-desktop-layout {
                    display: grid;
                    grid-template-columns: minmax(430px, 34vw) minmax(0, 1fr);
                    gap: 16px;
                    align-items: stretch;
                    height: auto;
                    min-height: 0;
                    overflow: visible;
                }
                .reportes-mobile-list {
                    display: none;
                }
                .report-detail-body {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
            }
            @media (max-width: 1023px) {
                .report-detail-row {
                    flex-wrap: wrap;
                }
                .reportes-page {
                    height: 100dvh;
                    max-height: 100dvh;
                    overflow-y: auto;
                    overflow-x: hidden;
                }
                .reportes-body,
                #rep-active,
                #rep-list {
                    height: auto;
                    overflow: visible;
                }
                .reportes-toolbar {
                    align-items: center;
                }
                .reportes-search {
                    min-width: 0;
                }
            }
            @media (max-width: 767px) {
                .reportes-toolbar {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    align-items: stretch;
                }
                .reportes-search {
                    grid-column: 1 / -1;
                }
                .reportes-action-btn,
                .reportes-export-btn,
                .reportes-groups-nav-btn {
                    width: 100%;
                    min-width: 0;
                }
                .reportes-groups-shell {
                    padding: 12px;
                    border-radius: 14px;
                    gap: 14px;
                }
                .reportes-groups-head {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 10px;
                }
                .reportes-back-btn {
                    width: fit-content;
                    max-width: 100%;
                    order: 0;
                }
                .reportes-groups-title {
                    order: 1;
                    width: 100%;
                }
                .reportes-groups-title h2 {
                    font-size: 0.96rem;
                    line-height: 1.2;
                }
                .reportes-groups-title p,
                .waba-capability-text {
                    font-size: 0.78rem;
                    line-height: 1.45;
                }
                .waba-capability-card {
                    align-items: flex-start;
                    padding: 12px;
                }
                .waba-status-pill {
                    min-height: 30px;
                    padding: 0 10px;
                    font-size: 0.72rem;
                }
                .waba-groups-panel-head {
                    align-items: flex-start;
                    gap: 10px;
                }
                .waba-groups-panel-head .btn-primary {
                    width: fit-content;
                }
            }
            @media (max-width: 424px) {
                .reportes-toolbar {
                    grid-template-columns: 1fr;
                }
            }
        </style>
        <main class="crm-main-container reportes-page" style="z-index:10; padding:0;">
            ${window.renderSectionTabs ? window.renderSectionTabs('messaging') : ''}
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1>
                        <i class="fas fa-file-lines kanban-header-icon" style="color:#0099FF;"></i>
                        Reportes
                    </h1>
                    <p>Reportes generados automaticamente por el asistente</p>
                </div>
            </div>

            <div class="meta-view-body reportes-body">

                <div id="rep-active">

                    <div id="rep-toolbar" class="reportes-toolbar">
                        <div class="reportes-search">
                            <i class="fas fa-search"></i>
                            <input id="rep-search" type="text" placeholder="Buscar por contacto o descripcion..."
                                oninput="reportesView._render()">
                        </div>
                        <button type="button" id="rep-groups-nav-btn" class="reportes-action-btn reportes-groups-nav-btn" onclick="reportesView._openGroupsView()" disabled title="Grupos de WhatsApp"><i class="fas fa-users"></i><span>Grupos de WhatsApp</span></button>
                        <button onclick="reportesView._exportXlsx()" id="rep-export-btn" class="reportes-action-btn reportes-export-btn">
                            <i class="fas fa-file-excel"></i>
                            <span>Exportar XLSX</span>
                        </button>
                    </div>

                    <div id="rep-reports-view" class="reportes-list-view">
                        <div id="rep-count" class="reportes-count"></div>

                        <div id="rep-list" class="animate-fade">
                            ${typeof batLoaderHtml === 'function' ? batLoaderHtml('Cargando reportes...') : '<div style="display:flex; align-items:center; justify-content:center; padding:60px 24px; color:var(--text-muted);"><i class="fas fa-circle-notch fa-spin" style="margin-right:10px;"></i> Cargando reportes...</div>'}
                        </div>
                    </div>

                    <div id="rep-groups-view" class="reportes-groups-view">
                        <div class="reportes-groups-shell">
                            <div class="reportes-groups-head">
                                <button type="button" class="reportes-back-btn" onclick="reportesView._backToReports()">
                                    <i class="fas fa-arrow-left"></i>
                                    Volver a Reportes
                                </button>
                                <div class="reportes-groups-title">
                                    <h2>
                                        <i class="fas fa-users" style="color:#0099FF;"></i>
                                        Grupos de WhatsApp
                                    </h2>
                                    <p>Gestiona grupos oficiales mediante Meta Groups API cuando el numero esta vinculado y es elegible.</p>
                                </div>
                            </div>
                            <div id="waba-groups-capability"></div>
                            <div class="waba-groups-panel">
                                <div class="waba-groups-panel-head">
                                    <span style="font-size:0.82rem; font-weight:850; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px;">Mis grupos de WhatsApp</span>
                                    <button onclick="reportesView._openGroupModal()" id="waba-create-group-btn" class="btn-primary btn-sm">
                                        <i class="fas fa-plus" style="margin-right:4px;"></i> Crear Grupo
                                    </button>
                                </div>
                                <div id="waba-groups-list">
                                    ${typeof batLoaderHtml === 'function' ? batLoaderHtml({ text: 'Cargando grupos...', size: 'sm' }) : '<div style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 0.82rem;"><i class="fas fa-circle-notch fa-spin" style="margin-right: 6px;"></i> Cargando grupos...</div>'}
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

            </div>
        </main>

        <!-- Modal para Crear/Editar Grupo de WhatsApp -->
        <div id="waba-group-modal" class="modal-overlay">
            <div class="modal-content modal-content-md animate-pop-in">
                <div class="modal-header">
                    <h3 id="waba-group-modal-title">
                        <i class="fas fa-users modal-h3-icon"></i>
                        Nuevo Grupo de WhatsApp
                    </h3>
                    <button class="modal-close" onclick="reportesView._closeGroupModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <label style="display:block; font-size:0.82rem; font-weight:600; color:var(--text-main); margin-bottom:6px;">Nombre del Grupo</label>
                        <input type="text" id="waba-group-name" placeholder="Ej: Equipo Ventas"
                            style="width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--text-main); font-size:0.88rem; outline:none; transition:border-color 0.2s;"
                            onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
                    </div>

                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                            <label style="font-size:0.82rem; font-weight:600; color:var(--text-main);">Contactos (MÃ¡x 8)</label>
                            <button type="button" onclick="reportesView._addGroupContactRow()" id="waba-group-add-contact-btn"
                                style="background:transparent; border:none; color:#0099FF; cursor:pointer; font-size:0.8rem; font-weight:600; display:flex; align-items:center; gap:4px;">
                                <i class="fas fa-plus-circle"></i> Agregar Contacto
                            </button>
                        </div>
                        <div id="waba-group-contacts-container" style="display:flex; flex-direction:column; gap:8px; max-height: 240px; overflow-y: auto; padding-right:4px;">
                            <!-- Contact rows will be added dynamically -->
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" onclick="reportesView._closeGroupModal()">
                        Cancelar
                    </button>
                    <button class="btn-success" onclick="reportesView._saveGroup()" id="waba-group-save-btn">
                        Guardar Grupo
                    </button>
                </div>
            </div>
        </div>

        <div id="report-detail-modal" class="modal-overlay">
            <div class="modal-content modal-content-md animate-pop-in">
                <div class="modal-header">
                    <h3 id="report-detail-modal-title">
                        <i class="fas fa-file-lines modal-h3-icon"></i>
                        Detalle
                    </h3>
                    <button class="modal-close" onclick="reportesView._closeReportDetailModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p id="report-detail-modal-text" style="margin:0; color:var(--text-main); font-size:0.88rem; line-height:1.55; white-space:pre-wrap; word-break:break-word;"></p>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="reportesView._closeReportDetailModal()">Cerrar</button>
                </div>
            </div>
        </div>
        `;
    }

    async function init(token) {
        _token = (typeof token === 'string' && token && token !== 'undefined') ? token : '';
        if (!_token) {
            _token = (typeof window.getAuthToken === 'function' ? decodeURIComponent(window.getAuthToken()) : '')
                || localStorage.getItem('backoffice_token')
                || localStorage.getItem('system_config_token')
                || '';
        }
        if (_token === 'undefined') _token = '';
        _selectedReporteId = localStorage.getItem(_getSelectedReporteStorageKey()) || null;

        try {
            await _load();
            _bindReportesScroll();
            _restoreReportesScroll();
            await _loadWabaCapability();
        } catch (e) {
            console.error('[Reportes] Error al iniciar:', e);
            showToast && showToast('Error al conectar con el servidor', 'error');
        }

        _subscribeRealtime();
    }

    async function _loadWabaCapability() {
        _wabaCapability = { checked: false, metaLinked: false, groupsEligible: false, reason: 'LOADING' };
        _renderGroupsNavButton();
        _renderWabaCapability();
        try {
            const res = await fetch(`/api/backoffice/waba-groups/capability?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Error desconocido');
            _wabaCapability = {
                checked: true,
                metaLinked: !!data.metaLinked,
                groupsEligible: data.groupsEligible === true,
                reason: data.reason || null,
                metaMessage: data.metaMessage || null,
                metaCode: data.metaCode || null
            };
            _renderGroupsNavButton();
            _renderWabaCapability();
            if (_wabaCapability.metaLinked) {
                await _loadWabaGroups();
            }
        } catch (e) {
            console.error('[Reportes] Error loading WABA capability:', e);
            _wabaCapability = { checked: true, metaLinked: false, groupsEligible: false, reason: 'CHECK_FAILED', metaMessage: e.message };
            _renderGroupsNavButton();
            _renderWabaCapability();
        }
    }

    function _renderGroupsNavButton() {
        const btn = document.getElementById('rep-groups-nav-btn');
        if (!btn) return;
        btn.disabled = !_wabaCapability.metaLinked;
        btn.title = 'Grupos de WhatsApp';
    }

    function _openGroupsView() {
        if (!_wabaCapability.metaLinked) {
            showToast && showToast('Vincula Meta primero para usar Grupos de WhatsApp', 'info');
            return;
        }
        _activeReportesView = 'groups';
        _renderReportesSubview();
        _renderWabaCapability();
        _renderWabaGroups();
        if (_wabaGroups.length === 0) {
            _loadWabaGroups();
        }
    }

    function _backToReports() {
        _activeReportesView = 'reportes';
        _renderReportesSubview();
    }

    function _renderReportesSubview() {
        const toolbar = document.getElementById('rep-toolbar');
        const reportsView = document.getElementById('rep-reports-view');
        const groupsView = document.getElementById('rep-groups-view');
        if (toolbar) toolbar.classList.toggle('hidden', _activeReportesView !== 'reportes');
        if (reportsView) reportsView.classList.toggle('hidden', _activeReportesView !== 'reportes');
        if (groupsView) groupsView.classList.toggle('active', _activeReportesView === 'groups');
    }

    function _renderWabaCapability() {
        const container = document.getElementById('waba-groups-capability');
        const createBtn = document.getElementById('waba-create-group-btn');
        if (createBtn) {
            createBtn.disabled = !_wabaCapability.groupsEligible;
            createBtn.style.opacity = _wabaCapability.groupsEligible ? '1' : '0.55';
            createBtn.style.pointerEvents = _wabaCapability.groupsEligible ? 'auto' : 'none';
            createBtn.title = _wabaCapability.groupsEligible ? 'Crear grupo de WhatsApp' : '';
        }
        if (!container) return;

        let pillClass = 'warn';
        let pillIcon = 'fa-circle-notch fa-spin';
        let pillText = 'Verificando Meta';
        let title = 'Comprobando vinculacion con Meta';
        let text = 'Estamos validando si el proyecto tiene waba_id, phone_number_id y token activo.';

        if (_wabaCapability.checked && !_wabaCapability.metaLinked) {
            pillClass = 'blocked';
            pillIcon = 'fa-link-slash';
            pillText = 'Meta no vinculado';
            title = 'Meta no esta vinculado';
            text = 'Este proyecto no tiene credenciales Meta completas. El boton queda deshabilitado hasta que se vincule un numero oficial.';
        } else if (_wabaCapability.metaLinked && !_wabaCapability.groupsEligible) {
            pillClass = 'warn';
            pillIcon = 'fa-triangle-exclamation';
            pillText = 'No elegible';
            title = 'Meta vinculado, Groups API no disponible';
            text = _wabaCapability.metaCode === 131215
                ? 'Meta respondio que este phone_number_id no es elegible para usar Groups API. La empresa asociada al numero debe ser Official Business Account (OBA) y Meta debe habilitar Groups API para ese phone_number_id.'
                : `${_wabaCapability.metaMessage || 'No se pudo confirmar la elegibilidad de Groups API para este numero.'} La empresa asociada al numero debe ser Official Business Account (OBA) y Meta debe habilitar Groups API para ese phone_number_id.`;
        } else if (_wabaCapability.groupsEligible) {
            pillClass = 'ok';
            pillIcon = 'fa-check';
            pillText = 'Disponible';
            title = 'Groups API disponible';
            text = 'El proyecto tiene Meta vinculado y el numero esta habilitado para gestionar grupos oficiales.';
        }

        container.innerHTML = `
            <div class="waba-capability-card">
                <div>
                    <h3 class="waba-capability-title"><i class="fas fa-users" style="color:#0099FF;"></i>${title}</h3>
                    <p class="waba-capability-text">${_escHtml(text)}</p>
                </div>
                <span class="waba-status-pill ${pillClass}"><i class="fas ${pillIcon}"></i>${pillText}</span>
            </div>
        `;
    }

    async function _loadWabaGroups() {
        const container = document.getElementById('waba-groups-list');
        if (container) {
            container.innerHTML = typeof batLoaderHtml === 'function' ? batLoaderHtml({ text: 'Cargando grupos de WhatsApp...', size: 'sm' }) : `<div style="padding:15px; text-align:center; color:var(--text-muted); font-size:0.82rem;"><i class="fas fa-circle-notch fa-spin" style="margin-right:6px;"></i> Cargando grupos de WhatsApp...</div>`;
        }
        try {
            const res = await fetch(`/api/backoffice/waba-groups?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            if (data.success) {
                _wabaGroups = data.groups || [];
                _renderWabaGroups();
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        } catch (e) {
            if (container) {
                container.innerHTML = `<div style="padding:15px; text-align:center; color:#ef4444; font-size:0.82rem;"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i> Error cargando grupos: ${e.message}</div>`;
            }
        }
    }

    function _renderWabaGroups() {
        const container = document.getElementById('waba-groups-list');
        if (!container) return;

        if (!_wabaCapability.metaLinked) {
            container.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:0.85rem;"><i class="fas fa-link-slash" style="margin-bottom:8px; font-size:1.5rem; display:block; opacity:0.65;"></i> Vincula Meta para ver grupos de WhatsApp.</div>`;
            return;
        }

        if (!_wabaCapability.groupsEligible) {
            container.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:0.85rem; line-height:1.45;"><i class="fas fa-triangle-exclamation" style="margin-bottom:8px; font-size:1.5rem; display:block; color:#f59e0b;"></i> Este numero no esta habilitado para crear grupos mediante Meta Groups API.<br>La empresa asociada al numero debe ser Official Business Account (OBA) y Meta debe habilitar Groups API para ese phone_number_id.</div>`;
            return;
        }

        if (_wabaGroups.length === 0) {
            container.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted); font-size:0.85rem;"><i class="fas fa-users-slash" style="margin-bottom:8px; font-size:1.5rem; display:block; opacity:0.6;"></i> No tienes grupos de WhatsApp creados todavia.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="waba-groups-list-grid">
                ${_wabaGroups.map(g => {
                    const name = String(g.name || 'Grupo');
                    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'G';
                    const contactCount = (g.contacts || []).length;
                    const contactsList = (g.contacts || []).map(c => `${_escHtml(c.name || 'Sin nombre')} (${_escHtml(c.phone)})`).join(', ');
                    return `
                        <button type="button" class="waba-group-icon-card" onclick="reportesView._openGroupModal('${_escAttr(g.id)}')" title="${_escAttr(contactsList || name)}">
                            <span class="waba-group-avatar">${_escHtml(initials)}</span>
                            <span class="waba-group-name">${_escHtml(name)}</span>
                            <span class="waba-group-meta">${contactCount} contacto${contactCount === 1 ? '' : 's'}</span>
                            <span class="waba-group-meta">${g.jid ? 'Meta API' : 'Sin ID Meta'}</span>
                            <span type="button" role="button" tabindex="0" class="waba-group-delete-btn" onclick="event.stopPropagation(); reportesView._deleteGroup('${_escAttr(g.id)}')" title="Eliminar grupo"><i class="fas fa-trash-alt"></i></span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    }

    async function _deleteGroup(groupId) {
        if (!await window.swalConfirm('Â¿Eliminar grupo de WhatsApp?', 'Â¿EstÃ¡s seguro de que deseas eliminar este grupo de WhatsApp?')) return;
        try {
            const res = await fetch(`/api/backoffice/waba-groups/${groupId}?token=${encodeURIComponent(_token)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                showToast && showToast('Grupo eliminado correctamente', 'success');
                await _loadWabaGroups();
            } else {
                showToast && showToast('Error al eliminar: ' + (data.error || ''), 'error');
            }
        } catch (e) {
            showToast && showToast('Error de red al eliminar el grupo', 'error');
        }
    }

    let _editingGroupId = null;

    function _openGroupModal(groupId = null) {
        if (!_wabaCapability.groupsEligible) {
            showToast && showToast('Groups API no esta disponible para este numero', 'info');
            return;
        }
        const modal = document.getElementById('waba-group-modal');
        const title = document.getElementById('waba-group-modal-title');
        const nameInput = document.getElementById('waba-group-name');
        const container = document.getElementById('waba-group-contacts-container');

        _editingGroupId = groupId;
        if (container) container.innerHTML = '';
        if (nameInput) nameInput.value = '';

        if (groupId) {
            if (title) title.innerHTML = '<i class="fas fa-edit modal-h3-icon" style="color:#0099FF; margin-right:6px;"></i> Editar Grupo de WhatsApp';
            const group = _wabaGroups.find(g => g.id === groupId);
            if (group) {
                if (nameInput) nameInput.value = group.name || '';
                const contacts = group.contacts || [];
                contacts.forEach(c => _addContactRowHTML(c.name, c.phone));
            }
        } else {
            if (title) title.innerHTML = '<i class="fas fa-users modal-h3-icon" style="color:#0099FF; margin-right:6px;"></i> Nuevo Grupo de WhatsApp';
            _addContactRowHTML('', '');
        }

        _updateAddContactButtonState();
        if (modal) modal.classList.add('active');
    }

    function _closeGroupModal() {
        const modal = document.getElementById('waba-group-modal');
        if (modal) modal.classList.remove('active');
        _editingGroupId = null;
    }

    function _addContactRowHTML(name = '', phone = '') {
        const container = document.getElementById('waba-group-contacts-container');
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'waba-contact-row';
        row.style = 'display:flex; gap:8px; align-items:center; width:100%;';
        row.innerHTML = `
            <input type="text" placeholder="Nombre (ej: Pedro)" value="${_escAttr(name)}" class="waba-contact-name-input"
                style="flex:1; padding:8px 10px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--border); color:var(--text-main); font-size:0.82rem; outline:none; transition:border-color 0.2s;"
                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
            <input type="text" placeholder="TelÃ©fono (ej: 54911...)" value="${_escAttr(phone)}" class="waba-contact-phone-input"
                style="flex:1.2; padding:8px 10px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid var(--border); color:var(--text-main); font-size:0.82rem; outline:none; transition:border-color 0.2s;"
                onfocus="this.style.borderColor='rgba(0,153,255,0.4)'" onblur="this.style.borderColor='var(--border)'">
            <button type="button" onclick="this.parentElement.remove(); reportesView._updateAddContactButtonState();"
                style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding:6px; border-radius:6px; display:flex; align-items:center; justify-content:center;"
                onmouseenter="this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.07)'"
                onmouseleave="this.style.color='var(--text-muted)'; this.style.background='transparent'">
                <i class="fas fa-trash-alt" style="font-size:0.85rem;"></i>
            </button>
        `;
        container.appendChild(row);
        _updateAddContactButtonState();
    }

    function _addGroupContactRow() {
        const container = document.getElementById('waba-group-contacts-container');
        if (container && container.children.length < 8) {
            _addContactRowHTML('', '');
        }
    }

    function _updateAddContactButtonState() {
        const container = document.getElementById('waba-group-contacts-container');
        const btn = document.getElementById('waba-group-add-contact-btn');
        if (!container || !btn) return;

        const count = container.children.length;
        if (count >= 8) {
            btn.style.opacity = '0.5';
            btn.style.pointerEvents = 'none';
        } else {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
        }
    }

    async function _saveGroup() {
        const nameInput = document.getElementById('waba-group-name');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            if (nameInput) nameInput.style.borderColor = '#ef4444';
            showToast && showToast('El nombre del grupo es requerido', 'error');
            return;
        }

        const container = document.getElementById('waba-group-contacts-container');
        if (!container || container.children.length === 0) {
            showToast && showToast('Agrega al menos un contacto al grupo', 'error');
            return;
        }

        const contacts = [];
        let hasErrors = false;

        const rows = container.querySelectorAll('.waba-contact-row');
        rows.forEach(row => {
            const nameIn = row.querySelector('.waba-contact-name-input');
            const phoneIn = row.querySelector('.waba-contact-phone-input');

            const contactName = nameIn ? nameIn.value.trim() : '';
            const contactPhone = phoneIn ? phoneIn.value.trim().replace(/[^0-9]/g, '') : '';

            if (!contactPhone) {
                if (phoneIn) phoneIn.style.borderColor = '#ef4444';
                hasErrors = true;
            } else {
                if (phoneIn) phoneIn.style.borderColor = 'var(--border)';
                contacts.push({ name: contactName || contactPhone, phone: contactPhone });
            }
        });

        if (hasErrors) {
            showToast && showToast('Por favor, ingresa los nÃºmeros de telÃ©fono', 'error');
            return;
        }

        const saveBtn = document.getElementById('waba-group-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';
        }

        try {
            const body = {
                name,
                contacts
            };
            if (_editingGroupId) {
                body.id = _editingGroupId;
            }

            const res = await fetch(`/api/backoffice/waba-groups?token=${encodeURIComponent(_token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                showToast && showToast(_editingGroupId ? 'Grupo actualizado con Ã©xito' : 'Grupo creado con Ã©xito', 'success');
                _closeGroupModal();
                await _loadWabaGroups();
            } else {
                showToast && showToast('Error al guardar: ' + (data.error || ''), 'error');
            }
        } catch (e) {
            showToast && showToast('Error de red al guardar el grupo', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = 'Guardar Grupo';
            }
        }
    }

    function _escAttr(str) {
        return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    async function _load() {
        try {
            const res = await fetch(`/api/backoffice/reportes?token=${encodeURIComponent(_token)}&limit=200`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Error desconocido');
            _reportes = data.reportes || [];
            _sortReportes();
            _render();
        } catch (e) {
            const list = document.getElementById('rep-list');
            if (list) list.innerHTML = `<div style="padding:48px 24px; text-align:center; color:#ef4444;"><i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i> Error cargando reportes: ${e.message}</div>`;
        }
    }

    function _render() {
        const list = document.getElementById('rep-list');
        const countEl = document.getElementById('rep-count');
        if (!list) return;

        const filtered = _getFilteredReports();

        if (countEl) countEl.textContent = `${filtered.length} reporte${filtered.length !== 1 ? 's' : ''}`;

        if (filtered.length === 0) {
            list.innerHTML = `
                <div style="padding:60px 24px; text-align:center;">
                    <i class="fas fa-file-circle-xmark" style="font-size:2.5rem; color:var(--text-muted); margin-bottom:12px; display:block;"></i>
                    <p style="color:var(--text-muted); margin:0;">No hay reportes${(document.getElementById('rep-search')?.value || '') ? ' que coincidan con la busqueda' : ' todavia'}.</p>
                </div>`;
            return;
        }

        const isAccordionMode = _isReportesAccordionMode();
        if (!isAccordionMode && (!_selectedReporteId || !filtered.some(r => _getReporteKey(r) === String(_selectedReporteId)))) {
            _selectedReporteId = _getReporteKey(filtered[0]);
        } else if (isAccordionMode && _selectedReporteId && !filtered.some(r => _getReporteKey(r) === String(_selectedReporteId))) {
            _selectedReporteId = null;
            localStorage.removeItem(_getSelectedReporteStorageKey());
        }

        const selected = filtered.find(r => _getReporteKey(r) === String(_selectedReporteId)) || filtered[0];
        list.innerHTML = `
            <div class="reportes-desktop-layout">
                <div class="reportes-lead-list">
                    ${filtered.map(r => _renderLeadCard(r)).join('')}
                </div>
                <div class="reportes-detail-panel">
                    ${_renderReportDetail(selected)}
                </div>
            </div>
            <div class="reportes-mobile-list">
                ${filtered.map(r => _renderAccordionItem(r)).join('')}
            </div>
        `;
        _restoreReportesScroll();
    }

    function _selectReporte(id) {
        _selectedReporteId = id;
        localStorage.setItem(_getSelectedReporteStorageKey(), id);
        _syncSelectedReporte();
    }

    function _syncSelectedReporte() {
        const selected = _reportes.find(r => _getReporteKey(r) === String(_selectedReporteId));
        const detail = document.querySelector('.reportes-detail-panel');
        if (detail) detail.innerHTML = _renderReportDetail(selected);

        document.querySelectorAll('.report-lead-card').forEach(card => {
            card.classList.toggle('active', card.dataset.reportId === String(_selectedReporteId));
        });
    }

    function _toggleReporteAccordion(id) {
        const previousScroll = _getReportesScrollElement()?.scrollTop || 0;
        if (String(_selectedReporteId) === String(id)) {
            _selectedReporteId = null;
            localStorage.removeItem(_getSelectedReporteStorageKey());
        } else {
            _selectedReporteId = id;
            localStorage.setItem(_getSelectedReporteStorageKey(), id);
        }
        _render();
        requestAnimationFrame(() => {
            const scroller = _getReportesScrollElement();
            if (!scroller) return;
            if (!_selectedReporteId) {
                scroller.scrollTop = previousScroll;
                return;
            }
            const openCard = document.querySelector(`.report-accordion-card[data-report-id="${CSS.escape(String(_selectedReporteId))}"]`);
            if (openCard) {
                openCard.scrollIntoView({ block: 'nearest' });
                _saveReportesScroll();
            }
        });
    }
    function _renderLeadCard(r) {
        const displayName = _getLeadDisplayName(r);
        const date = _formatDate(r.created_at);
        const reportKey = _getReporteKey(r);
        const active = reportKey === String(_selectedReporteId);

        return `
        <button type="button" class="report-lead-card ${active ? 'active' : ''}" data-report-id="${_escAttr(reportKey)}" onclick="reportesView._selectReporte('${_escAttr(reportKey)}')">
            <span class="report-lead-kicker">Nuevo lead:</span>
            <span class="report-lead-name">${_escHtml(displayName)}</span>
            <span class="report-lead-date">${_escHtml(date)}</span>
        </button>`;
    }

    function _renderReportDetail(r) {
        if (!r) {
            return `
            <div class="report-detail-card">
                <div style="padding:60px 24px; text-align:center; color:var(--text-muted);">
                    <i class="fas fa-file-lines" style="font-size:2rem; margin-bottom:12px; display:block;"></i>
                    Selecciona un reporte para ver el detalle.
                </div>
            </div>`;
        }

        const displayName = _getLeadDisplayName(r);
        const date = _formatDate(r.created_at);
        const parsed = _parseReportDescription(r.descripcion || '');
        const chatTarget = r.chat_id || parsed.phone || '';
        _reportDetailModalItems = new Map();
        const regularFields = [];
        const expandableFields = [];
        const chatFields = [];
        parsed.fields.forEach(field => {
            if (_isChatReportField(field)) chatFields.push(field);
            else if (_isExpandableReportField(field)) expandableFields.push(field);
            else regularFields.push(field);
        });
        if (parsed.intro) expandableFields.push({ label: 'Detalle adicional', value: parsed.intro });

        const fields = parsed.fields.length > 0
            ? `
                ${regularFields.map(field => `
                    <div class="report-detail-row compact">
                        <div class="report-detail-label">${_escHtml(field.label)}</div>
                        <div class="report-detail-value">${_renderReportFieldValue(field, chatTarget)}</div>
                    </div>
                `).join('')}
                ${expandableFields.map(field => `
                    <div class="report-detail-row compact">
                        <div class="report-detail-label">${_escHtml(field.label)}</div>
                        <div class="report-detail-value">${_renderExpandableReportField(field)}</div>
                    </div>
                `).join('')}
                ${chatFields.map(field => `
                    <div class="report-detail-row compact">
                        <div class="report-detail-label">${_escHtml(field.label)}</div>
                        <div class="report-detail-value">${_renderReportFieldValue(field, chatTarget)}</div>
                    </div>
                `).join('')}
            `
            : `<div class="report-detail-row full">
                    <div class="report-detail-label">Resumen</div>
                    <div class="report-detail-value">${_renderDescription(r.descripcion || '-', r.chat_id || parsed.phone || '')}</div>
               </div>`;

        return `
        <article class="report-detail-card">
            <div class="report-detail-head">
                <div>
                    <h3 class="report-detail-title">
                        <i class="fas fa-clipboard-list" style="color:#0099FF;"></i>
                        Resumen de conversacion
                    </h3>
                    <p class="report-detail-subtitle">${_escHtml(displayName)} - ${_escHtml(date)}</p>
                </div>
                <span style="padding:3px 9px; border-radius:999px; background:rgba(34,197,94,0.12); color:#22c55e; font-size:0.68rem; font-weight:850; white-space:nowrap;">
                    ${_escHtml(r.tipo || 'Nuevo Lead')}
                </span>
            </div>
            <div class="report-detail-body">
                ${fields}
            </div>
        </article>`;
    }

    function _renderAccordionItem(r) {
        const reportKey = _getReporteKey(r);
        const active = reportKey === String(_selectedReporteId);
        const displayName = _getLeadDisplayName(r);
        const date = _formatDate(r.created_at);
        const parsed = _parseReportDescription(r.descripcion || '');
        const interestField = parsed.fields.find(field => String(field.label || '').toLowerCase().startsWith('inter'))?.value;
        const info = interestField || parsed.intro || displayName;

        return `
        <article class="report-accordion-card ${active ? 'active' : ''}" data-report-id="${_escAttr(reportKey)}">
            <button type="button" class="report-accordion-toggle" onclick="reportesView._toggleReporteAccordion('${_escAttr(reportKey)}')" aria-expanded="${active ? 'true' : 'false'}">
                <span class="report-accordion-summary">
                    <span class="report-accordion-type">${_escHtml(r.tipo || 'Nuevo Lead')}</span>
                    <span class="report-accordion-info">${_escHtml(info || '-')}</span>
                    <span class="report-accordion-date">${_escHtml(date)}</span>
                </span>
                <i class="fas fa-chevron-down report-accordion-chevron"></i>
            </button>
            <div class="report-accordion-body">
                ${active ? _renderReportDetail(r) : ''}
            </div>
        </article>`;
    }
    function _renderItem(r, i, total) {
        const displayName = r.nombre || r.chat_id || 'Desconocido';
        const tipo = r.tipo || 'Sin tipo';
        const tipoColor = _tipoColor(tipo);
        const date = _formatDate(r.created_at);
        const desc = _renderDescription(r.descripcion || '-', r.chat_id || '');
        const initial = (displayName[0] || '?').toUpperCase();
        void i;
        void total;

        return `
        <div class="glass-card report-mobile-card" data-report-id="${_escAttr(_getReporteKey(r))}" style="padding:16px 18px; overflow:hidden;">
            <div style="display:flex; align-items:flex-start; gap:12px;">
                <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg,#0099FF,#0078D4); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:0.88rem; flex-shrink:0;">
                    ${initial}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
                        <span style="font-weight:600; font-size:0.88rem; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${_escHtml(displayName)}</span>
                        <span style="padding:2px 9px; border-radius:20px; font-size:0.7rem; font-weight:700; background:${tipoColor.bg}; color:${tipoColor.text}; white-space:nowrap;">${_escHtml(tipo)}</span>
                        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:auto; white-space:nowrap;">${date}</span>
                    </div>
                    <p style="margin:0; font-size:0.83rem; color:var(--text-muted); line-height:1.6; white-space:pre-wrap; word-break:break-word;">${desc}</p>
                    ${r.chat_id && r.nombre ? `<div style="margin-top:5px; font-size:0.72rem; color:var(--text-muted); opacity:0.6;">${_escHtml(r.chat_id)}</div>` : ''}
                </div>
            </div>
        </div>`;
    }

    function _renderDescription(text, chatId) {
        const safeText = _escHtml(text || '-');
        return safeText.replace(/https:\/\/wa\.me\/([0-9]+)/g, (url, phone) => {
            const targetChatId = chatId || phone;
            return `<a href="#" class="report-chat-action" onclick="event.preventDefault(); reportesView._openChat('${_escAttr(targetChatId)}')">${_escHtml(url)}</a>`;
        });
    }

    function _renderReportFieldValue(field, chatTarget) {
        const value = field?.value || '-';
        const linkMatch = String(value).match(/https:\/\/wa\.me\/([0-9]+)/i);
        if (linkMatch) {
            const targetChatId = chatTarget || linkMatch[1];
            return `<a href="#" class="report-chat-action" onclick="event.preventDefault(); reportesView._openChat('${_escAttr(targetChatId)}')">${_escHtml(value)}</a>`;
        }
        return _escHtml(value);
    }

    function _isExpandableReportField(field) {
        return /seguimiento|detalle adicional|observacion|comentario|descripcion/i.test(field?.label || '');
    }

    function _isChatReportField(field) {
        return /chat del usuario/i.test(field?.label || '') || /https:\/\/wa\.me\/[0-9]+/i.test(field?.value || '');
    }

    function _renderExpandableReportField(field) {
        const modalId = _registerReportDetailModalItem(field.label, field.value);
        return `
            <div class="report-detail-preview">
                <button type="button" class="report-detail-view-btn" onclick="reportesView._openReportDetailModal('${_escAttr(modalId)}')">Ver</button>
            </div>
        `;
    }

    function _registerReportDetailModalItem(label, value) {
        const id = `detail-${_reportDetailModalItems.size + 1}`;
        _reportDetailModalItems.set(id, { label: String(label || 'Detalle'), value: String(value || '-') });
        return id;
    }

    function _openReportDetailModal(id) {
        const item = _reportDetailModalItems.get(id);
        if (!item) return;
        const modal = document.getElementById('report-detail-modal');
        const title = document.getElementById('report-detail-modal-title');
        const text = document.getElementById('report-detail-modal-text');
        if (title) title.innerHTML = `<i class="fas fa-file-lines modal-h3-icon"></i>${_escHtml(item.label)}`;
        if (text) text.textContent = item.value;
        if (modal) modal.classList.add('active');
    }

    function _closeReportDetailModal() {
        const modal = document.getElementById('report-detail-modal');
        if (modal) modal.classList.remove('active');
    }

    function _getReporteKey(r) {
        if (!r) return '';
        return String(r.id || `${r.chat_id || ''}-${r.created_at || ''}-${r.tipo || ''}`);
    }

    function _getFilteredReports() {
        const search = (document.getElementById('rep-search')?.value || '').toLowerCase();
        return _reportes.filter(r => {
            if (!search) return true;
            return (r.nombre || r.chat_id || '').toLowerCase().includes(search)
                || (r.descripcion || '').toLowerCase().includes(search)
                || (r.chat_id || '').toLowerCase().includes(search);
        });
    }

    function _sortReportes() {
        _reportes.sort((a, b) => {
            const dateA = new Date(a.created_at || a.updated_at || 0).getTime();
            const dateB = new Date(b.created_at || b.updated_at || 0).getTime();
            return dateB - dateA;
        });
    }

    function _normalizeRealtimeReporte(raw) {
        if (!raw || raw.tipo !== 'Nuevo Lead') return null;
        return {
            ...raw,
            nombre: raw.nombre || raw.titulo,
            descripcion: _getLatestLeadReportDescription(raw.descripcion)
        };
    }

    function _getLatestLeadReportDescription(description) {
        const raw = String(description || '').trim();
        if (!raw) return '';
        const sections = raw
            .split(/\n\s*---[^\n]*\n/g)
            .map(section => section.trim())
            .filter(Boolean);
        const latestSummary = [...sections]
            .reverse()
            .find(section => /RESUMEN\s+DE\s+CONVERSACI/i.test(section) || /Chat del usuario/i.test(section));
        return latestSummary || sections[sections.length - 1] || raw;
    }

    function _handleRealtimeReporte(payload) {
        const raw = payload?.reporte || payload?.ticket || payload;
        const eventProjectId = payload?.projectId || raw?.project_id;
        if (eventProjectId && window.railwayProjectId && eventProjectId !== window.railwayProjectId) return;

        const reporte = _normalizeRealtimeReporte(raw);
        if (!reporte) return;

        const key = _getReporteKey(reporte);
        const existingIndex = _reportes.findIndex(r => _getReporteKey(r) === key);
        if (existingIndex >= 0) {
            _reportes[existingIndex] = { ..._reportes[existingIndex], ...reporte };
        } else {
            _reportes.unshift(reporte);
        }

        _sortReportes();
        _patchRealtimeReport(reporte);
    }

    function _patchRealtimeReport(reporte) {
        if (_activeReportesView !== 'reportes') return;

        const filtered = _getFilteredReports();
        const countEl = document.getElementById('rep-count');
        if (countEl) countEl.textContent = `${filtered.length} reporte${filtered.length !== 1 ? 's' : ''}`;

        const key = _getReporteKey(reporte);
        const isVisible = filtered.some(r => _getReporteKey(r) === key);
        const leadList = document.querySelector('.reportes-lead-list');
        const mobileList = document.querySelector('.reportes-mobile-list');

        if (!leadList || !mobileList) {
            _render();
            return;
        }

        const selectedStillExists = filtered.some(r => _getReporteKey(r) === String(_selectedReporteId));
        if (!_isReportesAccordionMode() && (!_selectedReporteId || !selectedStillExists)) {
            _selectedReporteId = filtered[0] ? _getReporteKey(filtered[0]) : null;
            if (_selectedReporteId) localStorage.setItem(_getSelectedReporteStorageKey(), _selectedReporteId);
        } else if (_isReportesAccordionMode() && _selectedReporteId && !selectedStillExists) {
            _selectedReporteId = null;
            localStorage.removeItem(_getSelectedReporteStorageKey());
        }

        if (isVisible) {
            const updated = filtered.find(r => _getReporteKey(r) === key) || reporte;
            const existingLeadCard = leadList.querySelector(`[data-report-id="${CSS.escape(key)}"]`);
            if (existingLeadCard) existingLeadCard.remove();
            leadList.insertAdjacentHTML('afterbegin', _renderLeadCard(updated));

            const existingMobileCard = mobileList.querySelector(`[data-report-id="${CSS.escape(key)}"]`);
            if (existingMobileCard) existingMobileCard.remove();
            mobileList.insertAdjacentHTML('afterbegin', _renderAccordionItem(updated));
        } else {
            leadList.querySelector(`[data-report-id="${CSS.escape(key)}"]`)?.remove();
            mobileList.querySelector(`[data-report-id="${CSS.escape(key)}"]`)?.remove();
        }

        if (String(_selectedReporteId) === key || !document.querySelector('.reportes-detail-panel .report-detail-card')) {
            _syncSelectedReporte();
        } else {
            document.querySelectorAll('.report-lead-card').forEach(card => {
                card.classList.toggle('active', card.dataset.reportId === String(_selectedReporteId));
            });
        }
    }

    function _getLeadDisplayName(r) {
        if (!r) return 'Lead sin nombre';
        const rawName = String(r.nombre || '').replace(/^Lead:\s*/i, '').trim();
        if (rawName && rawName !== r.chat_id) return rawName;

        const parsedName = _extractReportField(r.descripcion || '', 'Nombre');
        if (parsedName) return parsedName;

        return r.chat_id || 'Lead sin nombre';
    }

    function _parseReportDescription(text) {
        const cleanText = String(text || '').replace(/\r/g, '').trim();
        const fields = [];
        let intro = '';
        let phone = '';

        cleanText.split('\n').forEach(line => {
            const normalized = line
                .replace(/\*/g, '')
                .replace(/^[-\s]+$/, '')
                .trim();

            if (!normalized || /^---/.test(normalized) || /^RESUMEN DE CONVERSACI/i.test(normalized) || /^ðŸ“/.test(normalized)) {
                return;
            }

            const linkMatch = normalized.match(/https:\/\/wa\.me\/([0-9]+)/i);
            if (linkMatch) {
                phone = linkMatch[1];
                fields.push({ label: 'Chat del usuario', value: linkMatch[0] });
                return;
            }

            const fieldMatch = normalized.match(/^([^:]{2,45}):\s*(.*)$/);
            if (fieldMatch) {
                const label = fieldMatch[1].trim();
                const value = fieldMatch[2].trim() || '-';
                fields.push({ label, value });
                return;
            }

            intro += `${intro ? '\n' : ''}${normalized}`;
        });

        return { fields, intro, phone };
    }

    function _extractReportField(text, label) {
        const pattern = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
        const match = String(text || '').replace(/\*/g, '').match(pattern);
        return match ? match[1].trim() : '';
    }

    function _openChat(chatId) {
        if (!chatId) return;
        localStorage.setItem('activeChat', chatId);
        if (typeof window.navigate === 'function') {
            window.navigate('/conversaciones');
        } else {
            window.location.href = '/conversaciones';
        }
    }

    async function _exportXlsx() {
        const btn = document.getElementById('rep-export-btn');
        const original = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><span>Exportando...</span>';
        }

        try {
            const res = await fetch(`/api/backoffice/reportes/export?token=${encodeURIComponent(_token)}`);
            if (!res.ok) {
                let errorMsg = 'No se pudo exportar el archivo';
                try {
                    const data = await res.json();
                    errorMsg = data.error || errorMsg;
                } catch (_) { /* respuesta binaria o vacia */ }
                throw new Error(errorMsg);
            }

            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition') || '';
            const match = disposition.match(/filename="?([^"]+)"?/i);
            const filename = match ? match[1] : `reportes_nuevo_lead_${new Date().toISOString().slice(0, 10)}.xlsx`;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            showToast && showToast('Reportes exportados correctamente', 'success');
        } catch (e) {
            showToast && showToast(`Error al exportar: ${e.message}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }
    }

    function _tipoColor(tipo) {
        const t = (tipo || '').toLowerCase();
        if (t.includes('lead') || t.includes('nuevo')) return { bg: 'rgba(34,197,94,0.12)', text: '#22c55e' };
        if (t.includes('resumen') || t.includes('summary')) return { bg: 'rgba(0,153,255,0.12)', text: '#0099FF' };
        if (t.includes('error') || t.includes('fallo')) return { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' };
        if (t.includes('alerta') || t.includes('warn')) return { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' };
        return { bg: 'rgba(139,92,246,0.12)', text: '#8b5cf6' };
    }

    function _subscribeRealtime() {
        try {
            _socket = (typeof io !== 'undefined' ? io : window.io)();
            _socket.on('reporte_created', _handleRealtimeReporte);
            _socket.on('ticket_updated', _handleRealtimeReporte);
        } catch (e) { /* socket no disponible */ }
    }

    function _isReportesAccordionMode() {
        return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
    }

    function _getReportesScrollElement() {
        return document.querySelector('.reportes-page');
    }

    function _bindReportesScroll() {
        const scroller = _getReportesScrollElement();
        if (!scroller || scroller.dataset.scrollBound === '1') return;
        scroller.dataset.scrollBound = '1';
        scroller.addEventListener('scroll', () => {
            if (!_isRestoringReportesScroll) _saveReportesScroll();
        }, { passive: true });
    }

    function _saveReportesScroll() {
        const scroller = _getReportesScrollElement();
        if (!scroller) return;
        localStorage.setItem(_getScrollStorageKey(), String(scroller.scrollTop || 0));
    }

    function _restoreReportesScroll() {
        requestAnimationFrame(() => {
            const scroller = _getReportesScrollElement();
            if (!scroller) return;
            const stored = Number(localStorage.getItem(_getScrollStorageKey()) || 0);
            if (!Number.isFinite(stored) || stored <= 0) return;
            _isRestoringReportesScroll = true;
            scroller.scrollTop = stored;
            requestAnimationFrame(() => {
                _isRestoringReportesScroll = false;
            });
        });
    }
    function _formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    }

    function _escHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function destroy() {
        if (_socket) {
            _socket.off('reporte_created');
            _socket.off('ticket_updated');
            _socket = null;
        }
    }

    return {
        title: 'Reportes - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy,
        _load,
        _render,
        _selectReporte,
        _toggleReporteAccordion,
        _openGroupsView,
        _backToReports,
        _openGroupModal,
        _closeGroupModal,
        _openReportDetailModal,
        _closeReportDetailModal,
        _openChat,
        _exportXlsx,
        _addGroupContactRow,
        _updateAddContactButtonState,
        _saveGroup,
        _deleteGroup
    };
})();
