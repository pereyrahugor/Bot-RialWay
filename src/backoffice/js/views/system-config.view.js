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
            <main class="crm-main-container relative" style="z-index:10; max-width:none;">

                <div class="flex items-center gap-3 mb-2 animate-reveal-up">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style="background:rgba(0,153,255,0.15); border:1px solid rgba(0,153,255,0.2);">
                        <i class="fas fa-gears text-accent-bright"></i>
                    </div>
                    <div>
                        <h1 class="text-2xl font-heading font-bold text-gradient-accent leading-tight">Configuracion del Sistema</h1>
                        <p class="text-xs text-secondary-content">${window.BOT_NAME || ''}</p>
                    </div>
                </div>
                <p class="text-sm text-secondary-content mb-8">Gestiona los parametros operativos y de IA en tiempo real.</p>

                <form id="variables-form">

                    <!-- Seccion 1: Asistentes -->
                    <div class="variables-grid">
                        <div class="section-header"><h2><i class="fas fa-robot"></i> Asistentes OpenAI (1-5)</h2></div>
                        <div class="variable-group"><h3>ASSISTANT_NAME</h3><p class="description">Nombre publico del bot.</p><input type="text" name="ASSISTANT_NAME" id="ASSISTANT_NAME"></div>
                        <div class="variable-group"><h3>OPENAI_API_KEY</h3><p class="description">API Key principal de OpenAI.</p><div class="input-wrapper"><input type="password" name="OPENAI_API_KEY" id="OPENAI_API_KEY" autocomplete="new-password"><button type="button" class="toggle-password">&#128065;&#65039;</button></div></div>
                        <div class="variable-group"><h3>ASSISTANT_ID (Principal)</h3><input type="text" name="ASSISTANT_ID" id="ASSISTANT_ID"></div>
                        <div class="variable-group"><h3>ASSISTANT_2</h3><input type="text" name="ASSISTANT_2" id="ASSISTANT_2"></div>
                        <div class="variable-group"><h3>ASSISTANT_3</h3><input type="text" name="ASSISTANT_3" id="ASSISTANT_3"></div>
                        <div class="variable-group"><h3>ASSISTANT_4</h3><input type="text" name="ASSISTANT_4" id="ASSISTANT_4"></div>
                        <div class="variable-group"><h3>ASSISTANT_5</h3><input type="text" name="ASSISTANT_5" id="ASSISTANT_5"></div>
                        <div class="variable-group variable-group-span2">
                            <div class="trigger-card" onclick="togglePromptPanel()">
                                <div>
                                    <h3 class="trigger-card-title"><i class="fas fa-magic"></i> Logica Maestra (Prompts)</h3>
                                    <p class="description mt-1">Configura las instrucciones para cada uno de tus 5 asistentes.</p>
                                </div>
                                <button type="button" class="btn flex-shrink-0">Editar Prompts</button>
                            </div>
                        </div>
                    </div>

                    <!-- Seccion 2: IA Avanzada -->
                    <div class="variables-grid">
                        <div class="section-header"><h2><i class="fas fa-sparkles"></i> IA Avanzada &amp; Multimedia</h2></div>
                        <div class="variable-group"><h3>ASSISTANT_ID_IMG</h3><p class="description">ID del asistente de Vision.</p><input type="text" name="ASSISTANT_ID_IMG" id="ASSISTANT_ID_IMG"></div>
                        <div class="variable-group"><h3>OPENAI_API_KEY_IMG</h3><p class="description">API Key para Vision.</p><div class="input-wrapper"><input type="password" name="OPENAI_API_KEY_IMG" id="OPENAI_API_KEY_IMG" autocomplete="new-password"><button type="button" class="toggle-password">&#128065;&#65039;</button></div></div>
                        <div class="variable-group"><h3>VECTOR_STORE_ID</h3><input type="text" name="VECTOR_STORE_ID" id="VECTOR_STORE_ID"></div>
                        <div class="variable-group"><h3>EXTRA_SYSTEM_PROMPT</h3><p class="description">Reglas globales adicionales.</p><textarea name="EXTRA_SYSTEM_PROMPT" id="EXTRA_SYSTEM_PROMPT"></textarea></div>
                        <div class="variable-group"><h3>DB_TABLES</h3><p class="description">Definicion de tablas SQL para la IA.</p><textarea name="DB_TABLES" id="DB_TABLES"></textarea></div>
                        <div class="variable-group"><h3>OPENAI_TOOLS_DEFINITION</h3><textarea name="OPENAI_TOOLS_DEFINITION" id="OPENAI_TOOLS_DEFINITION"></textarea></div>
                    </div>

                    <!-- Seccion 3: Mensajeria -->
                    <div class="variables-grid">
                        <div class="section-header"><h2><i class="fas fa-comment-dots"></i> Seguimiento &amp; Inactividad</h2></div>
                        <div class="variable-group"><h3>msjCierre</h3><textarea name="msjCierre" id="msjCierre"></textarea></div>
                        <div class="variable-group"><h3>timeOutCierre (min)</h3><input type="number" name="timeOutCierre" id="timeOutCierre"></div>
                        <div class="variable-group"><h3>msjSeguimiento 1</h3><textarea name="msjSeguimiento1" id="msjSeguimiento1"></textarea></div>
                        <div class="variable-group"><h3>msjSeguimiento 2</h3><textarea name="msjSeguimiento2" id="msjSeguimiento2"></textarea></div>
                        <div class="variable-group"><h3>timeOutSeguimiento 2</h3><input type="number" name="timeOutSeguimiento2" id="timeOutSeguimiento2"></div>
                        <div class="variable-group"><h3>msjSeguimiento 3</h3><textarea name="msjSeguimiento3" id="msjSeguimiento3"></textarea></div>
                        <div class="variable-group"><h3>timeOutSeguimiento 3</h3><input type="number" name="timeOutSeguimiento3" id="timeOutSeguimiento3"></div>
                    </div>

                    <!-- Seccion 4: Google & Grupos -->
                    <div class="variables-grid">
                        <div class="section-header"><h2><i class="fab fa-google"></i> Google &amp; Grupos</h2></div>
                        <div class="col-span-full mb-2" style="grid-column:1/-1;">
                            <button type="button" id="btn-load-groups" class="btn w-full justify-center py-3">
                                <i class="fab fa-whatsapp"></i>
                                <i class="fas fa-spinner animate-spin-loader" id="load-groups-spinner" style="display:none;"></i>
                                <span id="btn-load-groups-text">Cargar Grupos de WhatsApp</span>
                            </button>
                        </div>
                        <div class="variable-group"><h3>ID_GRUPO_RESUMEN (1)</h3><select name="ID_GRUPO_RESUMEN" id="ID_GRUPO_RESUMEN"></select></div>
                        <div class="variable-group"><h3>ID_GRUPO_RESUMEN (2)</h3><select name="ID_GRUPO_RESUMEN_2" id="ID_GRUPO_RESUMEN_2"></select></div>
                        <div class="variable-group"><h3>SHEET_ID_RESUMEN</h3><input type="text" name="SHEET_ID_RESUMEN" id="SHEET_ID_RESUMEN"></div>
                        <div class="variable-group"><h3>SHEET_ID_UPDATE</h3><input type="text" name="SHEET_ID_UPDATE" id="SHEET_ID_UPDATE"></div>
                        <div class="variable-group"><h3>DOCX_ID_UPDATE</h3><input type="text" name="DOCX_ID_UPDATE" id="DOCX_ID_UPDATE"></div>
                        <div class="variable-group"><h3>GOOGLE_CALENDAR_ID</h3><input type="text" name="GOOGLE_CALENDAR_ID" id="GOOGLE_CALENDAR_ID"></div>
                    </div>

                    <!-- Seccion 5: Acceso -->
                    <div class="variables-grid">
                        <div class="section-header"><h2><i class="fas fa-shield-halved"></i> Acceso &amp; Navegacion</h2></div>
                        <div class="variable-group"><h3>ADMIN_USER</h3><input type="text" name="ADMIN_USER" id="ADMIN_USER"></div>
                        <div class="variable-group"><h3>ADMIN_PASS</h3><input type="password" name="ADMIN_PASS" id="ADMIN_PASS" autocomplete="new-password"></div>
                        <div class="variable-group">
                            <h3>STORAGE_MODE</h3><p class="description">Donde se guardan los mensajes, chats y tickets.</p>
                            <select name="STORAGE_MODE" id="STORAGE_MODE">
                                <option value="db">Base de Datos (Supabase)</option>
                                <option value="local">Guardado Local (JSON)</option>
                            </select>
                        </div>
                        <div class="variable-group"><h3>WHATSAPP_VISIBLE</h3><select name="WHATSAPP_VISIBLE" id="WHATSAPP_VISIBLE"><option value="true">ON</option><option value="false">OFF</option></select></div>
                        <div class="variable-group"><h3>INSTAGRAM_VISIBLE</h3><select name="INSTAGRAM_VISIBLE" id="INSTAGRAM_VISIBLE"><option value="true">ON</option><option value="false">OFF</option></select></div>
                        <div class="variable-group"><h3>MESSENGER_VISIBLE</h3><select name="MESSENGER_VISIBLE" id="MESSENGER_VISIBLE"><option value="true">ON</option><option value="false">OFF</option></select></div>
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
                            <i class="fas fa-save"></i> Guardar (Sin reiniciar)
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
                        <i class="fas fa-magic prompt-panel-title-icon"></i> Editor de Logica Maestra
                    </h3>
                </div>
                <div class="prompt-select-wrapper">
                    <select id="assistant-select" class="input-field text-sm" style="width:200px; margin:0;">
                        <option value="1">Asistente 1 (Principal)</option>
                        <option value="2">Asistente 2</option>
                        <option value="3">Asistente 3</option>
                        <option value="4">Asistente 4</option>
                        <option value="5">Asistente 5</option>
                    </select>
                </div>
                <button type="button" class="btn-icon" onclick="togglePromptPanel()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="prompt-panel-content">
                <textarea id="prompt-editor-textarea"></textarea>
                <div class="prompt-panel-footer">
                    <div class="prompt-footer-actions">
                        <button type="button" id="sync-prompt-btn" class="btn-outline px-4 py-2 text-sm">
                            <i class="fas fa-sync"></i> Sincronizar
                        </button>
                        <button type="button" id="save-prompt-hot-btn" class="btn px-5 py-2 text-sm"
                            style="background:linear-gradient(135deg,#10b981,#059669);">
                            <i class="fas fa-save"></i> Guardar
                        </button>
                    </div>
                    <div id="sync-status" class="text-sm font-heading font-semibold text-accent-bright"></div>
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
