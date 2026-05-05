/* global logout, CodeMirror */

// Función de validación de acceso centralizada
window.checkAdminAccess = () => {
    const passInput = document.getElementById('admin-pass');
    const overlay = document.getElementById('config-auth-overlay');
    const content = document.getElementById('main-config-content');
    
    if (passInput.value === 'neuroadmin25') {
        overlay.style.display = 'none';
        content.style.display = 'flex';
        setTimeout(() => content.style.opacity = '1', 10);
        localStorage.setItem('config_authenticated', 'true');
        localStorage.setItem('system_config_token', 'neuroadmin25');
        if (window.cmEditor) window.cmEditor.refresh();
    } else {
        passInput.style.borderColor = '#ef4444';
        passInput.style.boxShadow = '0 0 0 4px rgba(239, 68, 68, 0.1)';
        alert('❌ Clave incorrecta. Acceso denegado.');
        passInput.value = '';
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Unified System Config loaded');

    if (localStorage.getItem('config_authenticated') === 'true') {
        const overlay = document.getElementById('config-auth-overlay');
        const content = document.getElementById('main-config-content');
        if (overlay) overlay.style.display = 'none';
        if (content) {
            content.style.display = 'flex';
            content.style.opacity = '1';
        }
    }
    
    // Inicialización de CodeMirror
    const promptTextarea = document.getElementById('ASSISTANT_PROMPT');
    let editor = null;
    
    if (promptTextarea) {
        editor = CodeMirror.fromTextArea(promptTextarea, {
            lineNumbers: true,
            mode: "markdown",
            theme: "dracula",
            lineWrapping: true,
            scrollbarStyle: "native"
        });
        window.cmEditor = editor;
    }

    // Lógica del Panel Lateral (Editor de Prompt)
    window.togglePromptPanel = () => {
        const panel = document.getElementById('prompt-panel');
        const overlay = document.getElementById('panel-overlay');
        const isActive = panel.classList.toggle('active');
        overlay.classList.toggle('active');

        if (isActive && editor) {
            setTimeout(() => {
                editor.refresh();
                editor.focus();
            }, 300);
        }
    };

    const cancelBtn = document.getElementById('cancel-btn');
    const variablesForm = document.getElementById('variables-form');
    const updateBtn = document.getElementById('update-btn');
    
    let initialVariables = {};

    // Cargar variables actuales (Mezcladas DB + Railway)
    async function loadVariables() {
        const token = localStorage.getItem('system_config_token');
        try {
            // Usamos el nuevo endpoint que mezcla DB y Railway
            const response = await fetch(`/api/backoffice/config?token=${token}`);
            if (response.status === 401) return logout();
            const data = await response.json();
            
            if (data.success && data.variables) {
                initialVariables = data.variables;
                Object.keys(initialVariables).forEach(key => {
                    const input = document.getElementById(key) || document.getElementsByName(key)[0];
                    if (input) {
                        if (input.tagName === 'SELECT') {
                            input.value = String(initialVariables[key]);
                        } else {
                            input.value = initialVariables[key];
                        }
                    }
                });

                if (initialVariables['ASSISTANT_PROMPT'] && editor) {
                    editor.setValue(initialVariables['ASSISTANT_PROMPT']);
                }
            } else {
                console.warn('No se pudieron cargar variables mezcladas, reintentando con railway/env...');
                const resAlt = await fetch(`/api/variables?token=${token}`);
                const dataAlt = await resAlt.json();
                if (dataAlt.success) {
                    initialVariables = dataAlt.variables;
                    // ... mismo proceso ...
                }
            }
        } catch (err) {
            console.error('Error fetching variables:', err);
        }
    }

    await loadVariables();

    // Lógica para mostrar/ocultar contraseñas
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', () => {
            const wrapper = button.closest('.input-wrapper');
            const input = wrapper.querySelector('input, textarea');
            if (input.tagName.toLowerCase() === 'input') {
                const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
                input.setAttribute('type', type);
            } else {
                input.classList.toggle('hidden-content');
            }
            button.textContent = button.textContent === '👁️' ? '🙈' : '👁️';
        });
    });

    cancelBtn.addEventListener('click', () => {
        window.location.href = '/dashboard';
    });

    // Manejo del formulario UNIFICADO
    variablesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(variablesForm);
        const settingsToSave = {};
        let hasChanges = false;
        
        formData.forEach((value, key) => {
            if (key === 'ASSISTANT_PROMPT' && editor) {
                value = editor.getValue();
            }

            // Solo guardamos si es diferente al inicial
            if (String(value) !== String(initialVariables[key] || '')) {
                settingsToSave[key] = value;
                hasChanges = true;
            }
        });

        if (!hasChanges) {
            alert('No se detectaron cambios para guardar.');
            return;
        }

        updateBtn.disabled = true;
        updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        
        try {
            const token = localStorage.getItem('system_config_token');
            const response = await fetch(`/api/backoffice/save-settings-bulk?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: settingsToSave })
            });

            if (response.status === 401) return logout();
            const data = await response.json();

            if (data.success) {
                alert('✅ Configuración guardada correctamente (Hot-update aplicado).');
                // Actualizar initialVariables
                Object.assign(initialVariables, settingsToSave);
                // Si se cambió el prompt, sincronizar con OpenAI
                if (settingsToSave['ASSISTANT_PROMPT']) {
                     await syncWithOpenAI(settingsToSave['ASSISTANT_PROMPT']);
                }
            } else {
                alert('❌ Error: ' + (data.error || 'Error desconocido'));
            }
        } catch (err) {
            console.error('Error saving settings:', err);
            alert('Error de conexión al guardar.');
        } finally {
            updateBtn.disabled = false;
            updateBtn.innerHTML = '<i class="fas fa-save" style="margin-right:8px;"></i> Guardar (Sin reiniciar)';
        }
    });

    async function syncWithOpenAI(prompt) {
        const assistantSelect = document.getElementById('assistant-select');
        const index = assistantSelect ? assistantSelect.value : '1';
        try {
            const token = localStorage.getItem('system_config_token');
            await fetch(`/api/backoffice/update-prompt?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, index })
            });
        } catch (e) {
            console.error('Error syncing prompt with OpenAI:', e);
        }
    }

    // --- Sincronizar Prompt desde OpenAI ---
    const syncBtn = document.getElementById('sync-prompt-btn');
    const syncStatus = document.getElementById('sync-status');
    const assistantSelect = document.getElementById('assistant-select');

    syncBtn.addEventListener('click', async () => {
        const index = assistantSelect.value;
        const envKey = index === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${index}`;
        const assistantIdInput = document.getElementById(envKey);
        const assistantId = assistantIdInput ? assistantIdInput.value : '';

        if (!assistantId) {
            alert(`Debes ingresar un ID para el Asistente ${index} en la configuración para sincronizar.`);
            return;
        }

        syncBtn.disabled = true;
        syncStatus.textContent = '⏳ Obteniendo instrucciones...';
        syncStatus.style.color = 'inherit';

        try {
            const token = localStorage.getItem('system_config_token');
            const response = await fetch(`/api/backoffice/sync-assistant-prompt?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assistantId })
            });

            const data = await response.json();
            if (data.success) {
                if (editor) editor.setValue(data.instructions);
                syncStatus.textContent = '✅ Sincronizado desde OpenAI.';
                syncStatus.style.color = '#10b981';
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            console.error('Error syncing prompt:', err);
        } finally {
            syncBtn.disabled = false;
        }
    });

    // Guardar Prompt individualmente (desde el panel lateral)
    const hotSaveBtn = document.getElementById('save-prompt-hot-btn');
    hotSaveBtn.addEventListener('click', async () => {
        const prompt = editor ? editor.getValue() : promptTextarea.value;
        const index = assistantSelect.value;
        hotSaveBtn.disabled = true;
        syncStatus.textContent = `⏳ Guardando Asistente ${index}...`;

        try {
            const token = localStorage.getItem('system_config_token');
            const response = await fetch(`/api/backoffice/update-prompt?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, index })
            });

            const data = await response.json();
            if (data.success) {
                syncStatus.textContent = `✅ Guardado correctamente.`;
                syncStatus.style.color = '#10b981';
                const settingKey = index === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${index}`;
                initialVariables[settingKey] = prompt;
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            console.error('Error saving prompt:', err);
        } finally {
            hotSaveBtn.disabled = false;
        }
    });

    // Cargar Prompt al cambiar de asistente en el editor
    async function loadAssistantPrompt() {
        try {
            const index = assistantSelect.value || '1';
            const token = localStorage.getItem('system_config_token');
            const response = await fetch(`/api/backoffice/get-prompt?index=${index}&token=${token}`);
            const data = await response.json();
            if (data.success && data.prompt) {
                if (editor) editor.setValue(data.prompt);
                const settingKey = index === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${index}`;
                initialVariables[settingKey] = data.prompt;
            } else if (editor) {
                editor.setValue('');
            }
        } catch (err) {
            console.error('Error loading stored prompt:', err);
        }
    }
    
    assistantSelect.addEventListener('change', async () => {
        syncStatus.textContent = '⏳ Cargando...';
        await loadAssistantPrompt();
        syncStatus.textContent = '';
    });
    
    await loadAssistantPrompt();
});
