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
    console.log('Unified System Config with 5 Assistant Prompts loaded');

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
    const promptTextarea = document.getElementById('prompt-editor-textarea');
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

    const variablesForm = document.getElementById('variables-form');
    const updateBtn = document.getElementById('update-btn');
    const assistantSelect = document.getElementById('assistant-select');
    let initialVariables = {};

    // Cargar variables actuales
    async function loadVariables() {
        const token = localStorage.getItem('system_config_token');
        try {
            const response = await fetch(`/api/backoffice/config?token=${token}`);
            if (response.status === 401) return logout();
            const data = await response.json();
            
            if (data.success && data.variables) {
                initialVariables = data.variables;
                Object.keys(initialVariables).forEach(key => {
                    // Mapeo especial para prompts
                    let elementId = key;
                    if (key === 'ASSISTANT_PROMPT') elementId = 'ASSISTANT_PROMPT_VAL';
                    else if (key.startsWith('ASSISTANT_PROMPT_')) elementId = key + '_VAL';

                    const input = document.getElementById(elementId) || document.getElementsByName(key)[0];
                    if (input) {
                        if (input.tagName === 'SELECT') {
                            input.value = String(initialVariables[key]);
                        } else {
                            input.value = initialVariables[key];
                        }
                    }
                });

                // Cargar el prompt inicial en el editor
                loadEditorFromHidden();
            }
        } catch (err) {
            console.error('Error fetching variables:', err);
        }
    }

    function loadEditorFromHidden() {
        const index = assistantSelect.value;
        const hiddenId = index === '1' ? 'ASSISTANT_PROMPT_VAL' : `ASSISTANT_PROMPT_${index}_VAL`;
        const hiddenInput = document.getElementById(hiddenId);
        if (hiddenInput && editor) {
            editor.setValue(hiddenInput.value || '');
        }
    }

    // Al cambiar el asistente en el select del panel
    assistantSelect.addEventListener('change', () => {
        loadEditorFromHidden();
    });

    // Cada vez que el editor cambie, actualizamos el input oculto correspondiente
    if (editor) {
        editor.on('change', () => {
            const index = assistantSelect.value;
            const hiddenId = index === '1' ? 'ASSISTANT_PROMPT_VAL' : `ASSISTANT_PROMPT_${index}_VAL`;
            const hiddenInput = document.getElementById(hiddenId);
            if (hiddenInput) {
                hiddenInput.value = editor.getValue();
            }
        });
    }

    await loadVariables();

    // Lógica del Panel Lateral
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

    // Lógica para mostrar/ocultar contraseñas
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', () => {
            const wrapper = button.closest('.input-wrapper');
            const input = wrapper.querySelector('input, textarea');
            const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
            input.setAttribute('type', type);
            button.textContent = button.textContent === '👁️' ? '🙈' : '👁️';
        });
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
        window.location.href = '/dashboard';
    });

    // Manejo del formulario UNIFICADO (Bulk Save)
    variablesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(variablesForm);
        const settingsToSave = {};
        let hasChanges = false;
        
        formData.forEach((value, key) => {
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
                alert('✅ Configuración guardada correctamente.');
                Object.assign(initialVariables, settingsToSave);
                
                // Sincronizar prompts cambiados con OpenAI si corresponde
                for (let i = 1; i <= 5; i++) {
                    const key = i === 1 ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${i}`;
                    if (settingsToSave[key]) {
                        await syncPromptWithOpenAI(settingsToSave[key], String(i));
                    }
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

    async function syncPromptWithOpenAI(prompt, index) {
        try {
            const token = localStorage.getItem('system_config_token');
            await fetch(`/api/backoffice/update-prompt?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, index })
            });
        } catch (e) {
            console.error(`Error syncing prompt ${index} with OpenAI:`, e);
        }
    }

    // --- Sincronizar Prompt desde OpenAI (Botón Individual) ---
    const syncBtn = document.getElementById('sync-prompt-btn');
    const syncStatus = document.getElementById('sync-status');

    syncBtn.addEventListener('click', async () => {
        const index = assistantSelect.value;
        const envKey = index === '1' ? 'ASSISTANT_ID' : `ASSISTANT_${index}`;
        const assistantIdInput = document.getElementById(envKey);
        const assistantId = assistantIdInput ? assistantIdInput.value : '';

        if (!assistantId) {
            alert(`Debes ingresar un ID para el Asistente ${index} para sincronizar.`);
            return;
        }

        syncBtn.disabled = true;
        syncStatus.textContent = '⏳ Sincronizando...';

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
                syncStatus.textContent = '✅ Sincronizado.';
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

    // Guardar Prompt individualmente
    const hotSaveBtn = document.getElementById('save-prompt-hot-btn');
    hotSaveBtn.addEventListener('click', async () => {
        const prompt = editor.getValue();
        const index = assistantSelect.value;
        hotSaveBtn.disabled = true;
        syncStatus.textContent = `⏳ Guardando...`;

        try {
            const token = localStorage.getItem('system_config_token');
            const settingKey = index === '1' ? 'ASSISTANT_PROMPT' : `ASSISTANT_PROMPT_${index}`;
            
            const response = await fetch(`/api/backoffice/save-settings-bulk?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { [settingKey]: prompt } })
            });

            const data = await response.json();
            if (data.success) {
                await syncPromptWithOpenAI(prompt, index);
                syncStatus.textContent = `✅ Guardado.`;
                syncStatus.style.color = '#10b981';
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
});
