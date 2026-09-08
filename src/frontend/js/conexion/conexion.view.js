/* global loadViewScript */
window.conexionView = {
    title: 'Conexión & Chatbot - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <main class="crm-main-container conexion-main relative" style="z-index:10; padding:0;">
            ${window.renderSectionTabs ? window.renderSectionTabs('messaging') : ''}
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-plug-circle-bolt kanban-header-icon"></i> Conexión & Chatbot</h1>
                    <p>Estado de canales, vinculacion y acciones operativas del bot</p>
                </div>
            </div>

            <div class="conexion-page animate-reveal-up">
                <div class="conexion-grid">
                    <section class="conexion-panel conexion-status-card">
                        <div class="conexion-panel-head">
                            <div>
                                <h2><i class="fas fa-satellite-dish text-accent-bright"></i> Canales de WhatsApp</h2>
                                <p>Proveedor activo, estado de sesion y vinculacion por QR o codigo.</p>
                            </div>
                        </div>
                        <div class="conexion-desktop-msg">UNICAMENTE DISPONIBLE EN FORMATO DESKTOP</div>
                        <div class="conexion-status-content">
                            <div class="conexion-status-summary">
                                <div class="conexion-kpi">
                                    <span class="conexion-kpi-label">Estado de sesion</span>
                                    <span class="status" id="session-status" style="display:none;">Cargando...</span>
                                    <div class="conexion-skeleton" id="session-status-skeleton">
                                        <span class="skeleton-title"></span>
                                        <span class="skeleton-text"></span>
                                    </div>
                                </div>
                                <div id="group-connection-container" class="conexion-kpi" style="display:block;">
                                    <span class="conexion-kpi-label">Estado de grupos</span>
                                    <span id="group-session-status" class="status" style="display:none;">No configurado</span>
                                    <div class="conexion-skeleton" id="group-session-status-skeleton">
                                        <span class="skeleton-title"></span>
                                        <span class="skeleton-text"></span>
                                    </div>
                                </div>
                            </div>
                            <div id="session-error" class="mb-3"></div>
                            <div class="conexion-link-grid">
                                <div id="baileys-start-container" style="display:block;" class="conexion-start-panel">
                                    <p class="info-text mb-4">Vinculacion auxiliar de Baileys por QR o codigo para grupos.</p>
                                    <div class="conexion-start-options">
                                        <div>
                                            <button id="generate-qr-btn" class="btn w-full">
                                                <i class="fas fa-qrcode"></i> Generar QR Baileys
                                            </button>
                                        </div>
                                        <div class="conexion-option-divider">O BIEN</div>
                                        <div class="flex flex-col gap-2">
                                            <input type="text" id="pairing-phone-input" class="input text-center" placeholder="Ej: 5491122334455">
                                            <button id="generate-pairing-btn" class="btn-primary w-full">
                                                <i class="fas fa-key"></i> Vincular con codigo
                                            </button>
                                        </div>
                                    </div>
                                    <div id="generate-qr-loading" style="display:none;" class="mt-4 flex flex-col items-center gap-2">
                                        <i class="fas fa-spinner animate-spin-loader text-accent-bright text-2xl"></i>
                                        <p class="info-text text-center">Iniciando motor de WhatsApp... esto puede tardar unos segundos.</p>
                                    </div>
                                </div>
                                <div id="qr-section" style="display:block;" class="conexion-qr-section">
                                    <div class="conexion-qr-card">
                                        <h3 id="qr-section-title">Vinculacion pendiente</h3>
                                        <div class="conexion-qr-frame">
                                            <div id="qr-skeleton" class="conexion-qr-skeleton" style="display:none;" aria-hidden="true">
                                                <span class="skeleton-title"></span>
                                                <span class="skeleton-text"></span>
                                                <span class="skeleton-text"></span>
                                            </div>
                                            <img id="baileys-qr-img" src="/qr.png" class="qr" alt="Codigo QR" style="display:none;"
                                                onload="this.style.display='block';document.getElementById('qr-empty-message').style.display='none'"
                                                onerror="this.style.display='none';document.getElementById('qr-empty-message').style.display='block'">
                                            <p id="qr-empty-message" class="qr-error-msg" style="display:block;">Genera un QR o solicita un codigo para iniciar la vinculacion.</p>
                                            <div id="pairing-code-container" class="conexion-pairing-code" style="display:none;"></div>
                                        </div>
                                    </div>
                                    <p class="info-text mt-4 text-xs">La pagina se actualizara automaticamente cuando estes vinculado.</p>
                                </div>
                            </div>
                            <div id="session-info" style="display:none;" class="conexion-session-info"></div>
                            <div id="whatsapp-link-container" style="display:none;" class="mt-5">
                                <a id="whatsapp-link" href="#" target="_blank" class="btn-primary">
                                    <i class="fab fa-whatsapp"></i> Abrir en WhatsApp
                                </a>
                            </div>
                        </div>
                    </section>

                    <div class="conexion-side-column">
                        <section class="conexion-panel">
                            <div class="conexion-panel-head">
                                <div>
                                    <h2><i class="fas fa-sliders-h text-accent-bright"></i> Chatbot</h2>
                                    <p>Control global, reinicio operativo y comandos del bot.</p>
                                </div>
                            </div>
                            <div class="conexion-actions-list">
                                <div class="conexion-action-row">
                                    <div>
                                        <div class="conexion-action-title">Estado global del bot (IA)</div>
                                        <div class="conexion-action-desc">Cuando esta desactivado, el bot no responde a ningun mensaje.</div>
                                    </div>
                                    <label class="switch flex-shrink-0 self-end sm:self-center">
                                        <input type="checkbox" id="global-bot-toggle" checked>
                                        <span class="slider round">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>
                                        </span>
                                    </label>
                                </div>
                                <div class="conexion-action-row">
                                    <div>
                                        <div class="conexion-action-title">Reactivación a modo bot</div>
                                        <div class="conexion-action-desc">Tiempo de inactividad tras atención humana antes de que el bot vuelva a responder (máx 12 hs).</div>
                                    </div>
                                    <div class="flex items-center gap-2.5 flex-shrink-0 self-end sm:self-center flex-wrap sm:flex-nowrap justify-end">
                                        <div class="inline-flex rounded-lg p-0.5" style="background: rgba(0, 153, 255, 0.08); border: 1px solid rgba(0, 153, 255, 0.2);">
                                            <button type="button" id="human-timeout-unit-min" class="px-2 py-0.5 rounded font-bold text-xs transition-colors" style="background: #0099FF; color: #ffffff; cursor: pointer; border: none;">Min</button>
                                            <button type="button" id="human-timeout-unit-hs" class="px-2 py-0.5 rounded font-bold text-xs transition-colors" style="background: transparent; color: var(--text-muted); cursor: pointer; border: none;">Hs</button>
                                        </div>
                                        <input type="range" id="human-timeout-slider" min="1" max="60" value="30" step="1"
                                            class="cursor-pointer"
                                            style="accent-color: #0099FF; width: 100px;">
                                        <span id="human-timeout-badge" class="status"
                                            style="font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 6px; background: rgba(0, 153, 255, 0.12); border: 1px solid rgba(0, 153, 255, 0.25); color: #0099FF; min-width: 58px; text-align: center; display: inline-block;">30 min</span>
                                    </div>
                                </div>
                                <div class="conexion-action-row">
                                    <div>
                                        <div class="conexion-action-title">Recargar motor del bot</div>
                                        <div class="conexion-action-desc">Aplica cambios de Meta o Google Sheets sin entrar a Railway.</div>
                                    </div>
                                    <button id="system-reload-btn" class="btn-primary flex-shrink-0 self-end sm:self-center">
                                        <i class="fas fa-sync-alt"></i> Reiniciar
                                    </button>
                                </div>
                                <div class="conexion-actions-divider"></div>
                                <div class="conexion-actions-subhead">
                                    <h3><i class="fas fa-terminal text-accent-bright"></i> Comandos del bot</h3>
                                    <p>Comandos para ejecuta acciones operativas.</p>
                                </div>
                                <div class="conexion-action-row conexion-command-row">
                                    <div>
                                        <div class="conexion-action-title">Sincronizacion</div>
                                        <div class="conexion-action-desc">Actualiza Sheets, RAG y tools de OpenAI en tiempo real.</div>
                                    </div>
                                    <button id="bot-command-sync" class="btn-primary flex-shrink-0 self-end sm:self-center">
                                        <i class="fas fa-arrows-rotate"></i> Actualizar
                                    </button>
                                </div>
                                <div class="conexion-action-row conexion-command-row conexion-command-history">
                                    <div>
                                        <div class="conexion-action-title">Gestion de historial</div>
                                        <div class="conexion-action-desc">Indica el telefono o chat ID del contacto antes de ejecutar la accion.</div>
                                    </div>
                                    <div class="conexion-command-controls">
                                        <button type="button" id="bot-command-chat-selector" class="input conexion-command-selector">
                                            <span id="bot-command-selection-label">Seleccionar chats</span>
                                            <span id="bot-command-selection-badge" class="conexion-command-selection-badge">0</span>
                                            <i class="fas fa-chevron-down"></i>
                                        </button>
                                        <div class="conexion-command-buttons">
                                            <button id="bot-command-reset" class="btn">
                                                <i class="fas fa-rotate-left"></i> Reset
                                            </button>
                                            <button id="bot-command-new-thread" class="btn">
                                                <i class="fas fa-broom"></i> Hilo nuevo
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section class="conexion-panel conexion-danger-panel">
                            <div class="conexion-panel-head">
                                <div>
                                    <h2><i class="fas fa-triangle-exclamation"></i> Zona de peligro</h2>
                                    <p>Acciones destructivas para recuperar o limpiar conexiones.</p>
                                </div>
                            </div>
                            <div class="conexion-danger-actions">
                                <button id="go-reset" class="btn-danger">
                                    <i class="fas fa-trash-alt"></i> Reiniciar sesion
                                </button>
                                <button id="go-unlink-meta" class="btn-danger">
                                    <i class="fab fa-meta"></i> Desvincular Meta
                                </button>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </main>

        <div id="bot-command-chat-modal" class="modal-overlay">
            <div class="modal-content modal-content-md animate-pop-in">
                <div class="modal-header">
                    <h3><i class="fas fa-comments modal-h3-icon"></i> Seleccionar chats</h3>
                    <button class="modal-close" id="bot-command-chat-modal-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="modal-section">
                        <label for="bot-command-chat-search"><i class="fas fa-search"></i> Buscar conversacion</label>
                        <input type="text" id="bot-command-chat-search" placeholder="Nombre o numero">
                    </div>
                    <div class="conexion-command-selectbar">
                        <button type="button" id="bot-command-select-all" class="btn-secondary btn-sm">
                            <i class="fas fa-check-double"></i> Seleccionar todos
                        </button>
                        <span id="bot-command-modal-count">0 seleccionados</span>
                    </div>
                    <div id="bot-command-chat-list" class="conexion-command-chat-list">
                        <div class="conexion-command-empty"><i class="fas fa-circle-notch fa-spin"></i> Cargando chats...</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" id="bot-command-chat-cancel" class="btn-secondary">Cancelar</button>
                    <button type="button" id="bot-command-chat-accept" class="btn-primary">Aceptar</button>
                </div>
            </div>
        </div>

        <div id="resetModal" class="hidden fixed inset-0 z-50 flex items-center justify-center"
            style="background:rgba(5,10,20,0.8); backdrop-filter:blur(8px);">
            <div class="glass-strong w-full max-w-sm mx-4 p-8 text-center animate-pop-in">
                <i class="fas fa-exclamation-triangle text-4xl text-red-400 mb-5 block"></i>
                <h3 class="text-xl font-heading font-bold text-red-400 mb-3">Estas seguro?</h3>
                <p class="info-text text-sm mb-6">Se borraran las credenciales actuales y el bot se reiniciara completamente. Tendras que escanear el QR de nuevo.</p>
                <div class="flex gap-3 justify-center">
                    <button id="confirmNo" class="btn-outline px-5 py-2.5 text-sm">Cancelar</button>
                    <button id="confirmSi" class="btn btn-danger px-5 py-2.5 text-sm">
                        <i class="fas fa-check"></i> Si, reiniciar
                    </button>
                </div>
            </div>
        </div>

        <div id="unlinkMetaModal" class="hidden fixed inset-0 z-50 flex items-center justify-center"
            style="background:rgba(5,10,20,0.8); backdrop-filter:blur(8px);">
            <div class="glass-strong w-full max-w-sm mx-4 p-8 text-center animate-pop-in" style="border-top:3px solid #ef4444;">
                <i class="fab fa-meta text-5xl text-red-400 mb-5 block"></i>
                <h3 class="text-xl font-heading font-bold text-red-400 mb-3">Desvincular Meta?</h3>
                <p class="info-text text-sm mb-6">Se desvinculara permanentemente el numero de telefono y la app en los servidores de Meta, y se limpiara el onboarding en la base de datos. El bot se reiniciara automaticamente.</p>
                <div class="flex gap-3 justify-center">
                    <button id="confirmUnlinkNo" class="btn-outline px-5 py-2.5 text-sm">Cancelar</button>
                    <button id="confirmUnlinkSi" class="btn btn-danger px-5 py-2.5 text-sm">
                        <i class="fas fa-check"></i> Si, desvincular
                    </button>
                </div>
            </div>
        </div>`;
    },

    async init() {
        await loadViewScript('/js/conexion/conexion.js');
        if (typeof window.initConexionView === 'function') window.initConexionView();
    },

    destroy() {
        if (typeof window.destroyConexionView === 'function') window.destroyConexionView();
    }
};
