/* global loadViewScript, CodeMirror */
window.systemConfigView = {
    title: 'Configuracion - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <!-- Auth overlay -->
        <div id="config-auth-overlay">
            <div class="auth-card">
                <i class="fas fa-user-shield auth-icon"></i>
                <h2>Acceso Restringido</h2>
                <p>Ingresa la clave de administrador para configurar el sistema.</p>
                <input type="password" id="admin-pass" class="auth-input" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                    onkeydown="if(event.key === 'Enter') checkAdminAccess()">
                <button class="btn w-full justify-center" onclick="checkAdminAccess()">
                    <i class="fas fa-unlock-alt"></i> Acceder al Sistema
                </button>
            </div>
        </div>

        <!-- Contenido principal (JS lo muestra tras auth) -->
        <div id="main-config-content" style="display:none; opacity:0; flex:1; overflow:auto; flex-direction:column;">
            <main class="crm-main-container relative" style="z-index:10; max-width:none; padding:0;">

                <div class="kanban-header animate-fade">
                    <div class="header-info">
                        <h1><i class="fas fa-gears kanban-header-icon"></i> Configuracion del Sistema</h1>
                        <p>Gestiona los parametros operativos y de IA en tiempo real</p>
                    </div>
                </div>

                <form id="variables-form" style="padding: 2rem 2.5rem;">

                    <!-- Seccion 1: OpenAI & Asistentes -->
                    <div class="variables-grid">
                        <div class="section-header">
                            <h2><i class="fas fa-robot"></i> OpenAI &amp; Asistentes</h2>
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_NAME</h3>
                            <p class="description">Nombre publico del bot.</p>
                            <input type="text" name="ASSISTANT_NAME" id="ASSISTANT_NAME">
                        </div>
                        <div class="variable-group">
                            <h3>OPENAI_API_KEY</h3>
                            <p class="description">API Key principal de OpenAI.</p>
                            <input type="password" name="OPENAI_API_KEY" id="OPENAI_API_KEY" autocomplete="new-password">
                            <button type="button" class="toggle-password-inline" onclick="toggleFieldVisibility('OPENAI_API_KEY', this)"><i class="fas fa-eye"></i> Mostrar</button>
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_ID <span style="opacity:0.5;font-weight:400;">Principal</span></h3>
                            <input type="text" name="ASSISTANT_ID" id="ASSISTANT_ID">
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_2</h3>
                            <input type="text" name="ASSISTANT_2" id="ASSISTANT_2">
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_3</h3>
                            <input type="text" name="ASSISTANT_3" id="ASSISTANT_3">
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_4</h3>
                            <input type="text" name="ASSISTANT_4" id="ASSISTANT_4">
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_5</h3>
                            <input type="text" name="ASSISTANT_5" id="ASSISTANT_5">
                        </div>
                        <div class="variable-group variable-group-span2">
                            <div class="trigger-card" onclick="togglePromptPanel()">
                                <div>
                                    <h3 class="trigger-card-title"><i class="fas fa-file-code"></i> Logica Maestra (Prompts)</h3>
                                    <p class="description mt-1">Configura las instrucciones para cada uno de tus 5 asistentes.</p>
                                </div>
                                <button type="button" class="btn flex-shrink-0">
                                    <i class="fas fa-pen-to-square"></i> Editar Prompts
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Seccion 2: IA Avanzada -->
                    <div class="variables-grid">
                        <div class="section-header">
                            <h2><i class="fas fa-brain"></i> IA Avanzada &amp; Vision</h2>
                        </div>
                        <div class="variable-group">
                            <h3>ASSISTANT_ID_IMG</h3>
                            <p class="description">ID del asistente de Vision (imagenes).</p>
                            <input type="text" name="ASSISTANT_ID_IMG" id="ASSISTANT_ID_IMG">
                        </div>
                        <div class="variable-group">
                            <h3>OPENAI_API_KEY_IMG</h3>
                            <p class="description">API Key para el asistente de Vision.</p>
                            <input type="password" name="OPENAI_API_KEY_IMG" id="OPENAI_API_KEY_IMG" autocomplete="new-password">
                            <button type="button" class="toggle-password-inline" onclick="toggleFieldVisibility('OPENAI_API_KEY_IMG', this)"><i class="fas fa-eye"></i> Mostrar</button>
                        </div>
                        <div class="variable-group">
                            <h3>VECTOR_STORE_ID</h3>
                            <p class="description">ID del Vector Store para busqueda semantica.</p>
                            <input type="text" name="VECTOR_STORE_ID" id="VECTOR_STORE_ID">
                        </div>
                        <div class="variable-group">
                            <h3>EXTRA_SYSTEM_PROMPT</h3>
                            <p class="description">Reglas globales adicionales para todos los asistentes.</p>
                            <textarea name="EXTRA_SYSTEM_PROMPT" id="EXTRA_SYSTEM_PROMPT" rows="4"></textarea>
                        </div>
                        <div class="variable-group">
                            <h3>DB_TABLES</h3>
                            <p class="description">Definicion de tablas SQL disponibles para la IA.</p>
                            <textarea name="DB_TABLES" id="DB_TABLES" rows="4"></textarea>
                        </div>
                        <div class="variable-group">
                            <h3>OPENAI_TOOLS_DEFINITION</h3>
                            <p class="description">Definicion de herramientas (function calling).</p>
                            <textarea name="OPENAI_TOOLS_DEFINITION" id="OPENAI_TOOLS_DEFINITION" rows="4"></textarea>
                        </div>
                    </div>

                    <!-- Seccion 3: Automatizacion -->
                    <div class="variables-grid">
                        <div class="section-header">
                            <h2><i class="fas fa-clock-rotate-left"></i> Automatizacion &amp; Seguimiento</h2>
                        </div>
                        <div class="variable-group">
                            <h3>MENSAJE DE CIERRE</h3>
                            <p class="description">Mensaje enviado al cerrar una conversacion inactiva.</p>
                            <textarea name="msjCierre" id="msjCierre" rows="3"></textarea>
                        </div>
                        <div class="variable-group">
                            <h3>TIMEOUT CIERRE <span style="opacity:0.5;font-weight:400;">(min)</span></h3>
                            <p class="description">Minutos de inactividad antes del cierre automatico.</p>
                            <div class="number-stepper">
                                <button type="button" class="stepper-btn" onclick="stepperChange('timeOutCierre',-1)">−</button>
                                <input type="number" name="timeOutCierre" id="timeOutCierre" class="stepper-input" min="0">
                                <button type="button" class="stepper-btn" onclick="stepperChange('timeOutCierre',1)">+</button>
                            </div>
                        </div>
                        <div class="variable-group">
                            <h3>SEGUIMIENTO 1</h3>
                            <p class="description">Primer mensaje de reactivacion al contacto.</p>
                            <textarea name="msjSeguimiento1" id="msjSeguimiento1" rows="3"></textarea>
                        </div>
                        <div class="variable-group">
                            <h3>SEGUIMIENTO 2</h3>
                            <p class="description">Segundo mensaje de reactivacion al contacto.</p>
                            <textarea name="msjSeguimiento2" id="msjSeguimiento2" rows="3"></textarea>
                        </div>
                        <div class="variable-group">
                            <h3>TIMEOUT SEGUIMIENTO 2 <span style="opacity:0.5;font-weight:400;">(min)</span></h3>
                            <p class="description">Minutos de espera antes del segundo seguimiento.</p>
                            <div class="number-stepper">
                                <button type="button" class="stepper-btn" onclick="stepperChange('timeOutSeguimiento2',-1)">−</button>
                                <input type="number" name="timeOutSeguimiento2" id="timeOutSeguimiento2" class="stepper-input" min="0">
                                <button type="button" class="stepper-btn" onclick="stepperChange('timeOutSeguimiento2',1)">+</button>
                            </div>
                        </div>
                        <div class="variable-group">
                            <h3>SEGUIMIENTO 3</h3>
                            <p class="description">Tercer mensaje de reactivacion al contacto.</p>
                            <textarea name="msjSeguimiento3" id="msjSeguimiento3" rows="3"></textarea>
                        </div>
                        <div class="variable-group">
                            <h3>TIMEOUT SEGUIMIENTO 3 <span style="opacity:0.5;font-weight:400;">(min)</span></h3>
                            <p class="description">Minutos de espera antes del tercer seguimiento.</p>
                            <div class="number-stepper">
                                <button type="button" class="stepper-btn" onclick="stepperChange('timeOutSeguimiento3',-1)">−</button>
                                <input type="number" name="timeOutSeguimiento3" id="timeOutSeguimiento3" class="stepper-input" min="0">
                                <button type="button" class="stepper-btn" onclick="stepperChange('timeOutSeguimiento3',1)">+</button>
                            </div>
                        </div>
                    </div>

                    <!-- Seccion 4: Integraciones -->
                    <div class="variables-grid">
                        <div class="section-header">
                            <h2><i class="fas fa-plug"></i> Integraciones &amp; Google</h2>
                        </div>
                        <div class="col-span-full" style="grid-column:1/-1;">
                            <button type="button" id="btn-load-groups" class="btn w-full justify-center py-3">
                                <i class="fab fa-whatsapp"></i>
                                <i class="fas fa-spinner animate-spin-loader" id="load-groups-spinner" style="display:none;"></i>
                                <span id="btn-load-groups-text">Cargar Grupos de WhatsApp</span>
                            </button>
                        </div>
                        <div class="variable-group">
                            <h3>GRUPO RESUMEN <span style="opacity:0.5;font-weight:400;">1</span></h3>
                            <div class="csd-wrap csd-sm">
                                <select name="ID_GRUPO_RESUMEN" id="ID_GRUPO_RESUMEN" hidden></select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">-- Sin grupos cargados --</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu"><span style="display:block;padding:10px 16px;font-size:0.75rem;opacity:0.45;text-align:center;cursor:default;">Sin grupos cargados</span></div>
                            </div>
                        </div>
                        <div class="variable-group">
                            <h3>GRUPO RESUMEN <span style="opacity:0.5;font-weight:400;">2</span></h3>
                            <div class="csd-wrap csd-sm">
                                <select name="ID_GRUPO_RESUMEN_2" id="ID_GRUPO_RESUMEN_2" hidden></select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">-- Sin grupos cargados --</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu"><span style="display:block;padding:10px 16px;font-size:0.75rem;opacity:0.45;text-align:center;cursor:default;">Sin grupos cargados</span></div>
                            </div>
                        </div>
                        <div class="variable-group">
                            <h3>SHEET_ID_RESUMEN</h3>
                            <input type="text" name="SHEET_ID_RESUMEN" id="SHEET_ID_RESUMEN">
                        </div>
                        <div class="variable-group">
                            <h3>SHEET_ID_UPDATE</h3>
                            <input type="text" name="SHEET_ID_UPDATE" id="SHEET_ID_UPDATE">
                        </div>
                        <div class="variable-group">
                            <h3>DOCX_ID_UPDATE</h3>
                            <input type="text" name="DOCX_ID_UPDATE" id="DOCX_ID_UPDATE">
                        </div>
                        <div class="variable-group">
                            <h3>GOOGLE_CALENDAR_ID</h3>
                            <input type="text" name="GOOGLE_CALENDAR_ID" id="GOOGLE_CALENDAR_ID">
                        </div>
                    </div>

                    <!-- Seccion 5: Sistema & Acceso -->
                    <div class="variables-grid">
                        <div class="section-header">
                            <h2><i class="fas fa-shield-halved"></i> Sistema &amp; Acceso</h2>
                        </div>
                        <div class="variable-group">
                            <h3>ADMIN_USER</h3>
                            <p class="description">Usuario administrador del backoffice.</p>
                            <input type="text" name="ADMIN_USER" id="ADMIN_USER">
                        </div>
                        <div class="variable-group">
                            <h3>ADMIN_PASS</h3>
                            <p class="description">Contrasena de acceso al sistema.</p>
                            <input type="password" name="ADMIN_PASS" id="ADMIN_PASS" autocomplete="new-password">
                        </div>
                        <div class="variable-group">
                            <h3>STORAGE_MODE</h3>
                            <p class="description">Donde se almacenan mensajes, chats y tickets.</p>
                            <div class="csd-wrap csd-sm">
                                <select name="STORAGE_MODE" id="STORAGE_MODE" hidden>
                                    <option value="db">Base de Datos (Supabase)</option>
                                    <option value="local">Guardado Local (JSON)</option>
                                </select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">Base de Datos (Supabase)</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu">
                                    <button class="csd-item selected" type="button" data-val="db" onclick="_csdSelect(this,'db')">Base de Datos (Supabase)</button>
                                    <button class="csd-item" type="button" data-val="local" onclick="_csdSelect(this,'local')">Guardado Local (JSON)</button>
                                </div>
                            </div>
                        </div>
                        <div class="variable-group">
                            <h3>WHATSAPP_VISIBLE</h3>
                            <p class="description">Habilitar canal de WhatsApp.</p>
                            <input type="hidden" name="WHATSAPP_VISIBLE" id="WHATSAPP_VISIBLE" value="true">
                            <label class="switch mt-1">
                                <input type="checkbox" onchange="_cfgToggle('WHATSAPP_VISIBLE',this.checked)" checked>
                                <span class="slider"><i class="fas fa-times"></i><i class="fas fa-check"></i></span>
                            </label>
                        </div>
                        <div class="variable-group">
                            <h3>INSTAGRAM_VISIBLE</h3>
                            <p class="description">Habilitar canal de Instagram.</p>
                            <input type="hidden" name="INSTAGRAM_VISIBLE" id="INSTAGRAM_VISIBLE" value="true">
                            <label class="switch mt-1">
                                <input type="checkbox" onchange="_cfgToggle('INSTAGRAM_VISIBLE',this.checked)" checked>
                                <span class="slider"><i class="fas fa-times"></i><i class="fas fa-check"></i></span>
                            </label>
                        </div>
                        <div class="variable-group">
                            <h3>MESSENGER_VISIBLE</h3>
                            <p class="description">Habilitar canal de Messenger.</p>
                            <input type="hidden" name="MESSENGER_VISIBLE" id="MESSENGER_VISIBLE" value="true">
                            <label class="switch mt-1">
                                <input type="checkbox" onchange="_cfgToggle('MESSENGER_VISIBLE',this.checked)" checked>
                                <span class="slider"><i class="fas fa-times"></i><i class="fas fa-check"></i></span>
                            </label>
                        </div>
                    </div>

                    <!-- Prompts ocultos -->
                    <textarea name="ASSISTANT_PROMPT"   id="ASSISTANT_PROMPT_VAL"   hidden></textarea>
                    <textarea name="ASSISTANT_PROMPT_2" id="ASSISTANT_PROMPT_2_VAL" hidden></textarea>
                    <textarea name="ASSISTANT_PROMPT_3" id="ASSISTANT_PROMPT_3_VAL" hidden></textarea>
                    <textarea name="ASSISTANT_PROMPT_4" id="ASSISTANT_PROMPT_4_VAL" hidden></textarea>
                    <textarea name="ASSISTANT_PROMPT_5" id="ASSISTANT_PROMPT_5_VAL" hidden></textarea>

                    <div class="actions">
                        <button type="button" id="cancel-btn" class="btn-outline px-6 py-2.5">Cancelar</button>
                        <button type="submit" id="update-btn" class="btn px-8"
                            style="background:linear-gradient(135deg,#10b981,#059669); box-shadow:0 4px 12px rgba(16,185,129,0.3);">
                            <i class="fas fa-floppy-disk"></i> Guardar cambios
                        </button>
                    </div>
                </form>
            </main>
        </div>

        <!-- Panel overlay -->
        <div id="panel-overlay" class="panel-overlay" onclick="togglePromptPanel()"></div>

        <!-- Panel de prompts -->
        <div id="prompt-panel" class="prompt-panel">

            <div class="prompt-panel-header">
                <div class="prompt-panel-title-group">
                    <h3 class="prompt-panel-title">
                        <i class="fas fa-file-code prompt-panel-title-icon"></i>
                        Editor de Prompts
                    </h3>
                    <p class="prompt-panel-subtitle">Instrucciones del asistente seleccionado</p>
                </div>
                <button type="button" class="prompt-close-btn" onclick="togglePromptPanel()" aria-label="Cerrar">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Tabs de asistentes -->
            <div class="prompt-assistant-tabs" id="prompt-assistant-tabs">
                <button class="prompt-tab active" onclick="_selectPromptTab(this, 1)">
                    <i class="fas fa-robot"></i><span>Principal</span>
                </button>
                <button class="prompt-tab" onclick="_selectPromptTab(this, 2)">
                    <span>Asistente 2</span>
                </button>
                <button class="prompt-tab" onclick="_selectPromptTab(this, 3)">
                    <span>Asistente 3</span>
                </button>
                <button class="prompt-tab" onclick="_selectPromptTab(this, 4)">
                    <span>Asistente 4</span>
                </button>
                <button class="prompt-tab" onclick="_selectPromptTab(this, 5)">
                    <span>Asistente 5</span>
                </button>
            </div>
            <!-- Select oculto - compatibilidad con system-config.js -->
            <select id="assistant-select" hidden>
                <option value="1">Asistente 1 (Principal)</option>
                <option value="2">Asistente 2</option>
                <option value="3">Asistente 3</option>
                <option value="4">Asistente 4</option>
                <option value="5">Asistente 5</option>
            </select>

            <div class="prompt-panel-content">
                <textarea id="prompt-editor-textarea"></textarea>
            </div>

            <div class="prompt-panel-footer">
                <div id="sync-status" class="prompt-sync-status"></div>
                <div class="prompt-footer-actions">
                    <button type="button" id="sync-prompt-btn" class="btn-outline px-4 py-2 text-sm">
                        <i class="fas fa-rotate"></i> Sincronizar
                    </button>
                    <button type="button" id="save-prompt-hot-btn" class="btn-primary px-5 py-2 text-sm">
                        <i class="fas fa-floppy-disk"></i> Guardar
                    </button>
                </div>
            </div>

        </div>`;
    },

    async init() {
        // Cargar CodeMirror CSS dinamicamente
        if (!document.querySelector('link[href*="codemirror"]')) {
            const link1 = document.createElement('link');
            link1.rel = 'stylesheet';
            link1.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.css';
            document.head.appendChild(link1);
            const link2 = document.createElement('link');
            link2.rel = 'stylesheet';
            link2.href = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/theme/dracula.min.css';
            document.head.appendChild(link2);
        }
        if (typeof CodeMirror === 'undefined') {
            await loadViewScript('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.js');
            await loadViewScript('https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/mode/markdown/markdown.min.js');
        }
        await loadViewScript('/js/system-config.js');
        if (typeof window.initSystemConfigView === 'function') window.initSystemConfigView();
    },

    destroy() {}
};

window._selectPromptTab = function(btn, index) {
    document.querySelectorAll('#prompt-assistant-tabs .prompt-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const sel = document.getElementById('assistant-select');
    if (sel) {
        sel.value = String(index);
        sel.dispatchEvent(new Event('change'));
    }
};

window.stepperChange = function(id, delta) {
    const input = document.getElementById(id);
    if (!input) return;
    const min = parseInt(input.min ?? 0);
    const val = parseInt(input.value) || 0;
    input.value = Math.max(min, val + delta);
};

window.toggleFieldVisibility = function(id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show
        ? '<i class="fas fa-eye-slash"></i> Ocultar'
        : '<i class="fas fa-eye"></i> Mostrar';
};

window._cfgToggle = function(id, checked) {
    const hidden = document.getElementById(id);
    if (hidden) hidden.value = checked ? 'true' : 'false';
};
