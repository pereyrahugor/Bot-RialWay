/* global logout, CodeMirror */

// Lógica de colapso fuera del DOMContentLoaded para acceso global
window.togglePromptCollapse = () => {
    const header = document.querySelector('.prompt-header');
    const content = document.getElementById('prompt-content');
    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Variables panel loaded');
    
    const cancelBtn = document.getElementById('cancel-btn');
    const variablesForm = document.getElementById('variables-form');
    const updateBtn = document.getElementById('update-btn');
    
    let initialVariables = {};

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
    }

    // Cargar variables actuales
    async function loadVariables() {
        const token = localStorage.getItem('backoffice_token');
        try {
            const response = await fetch(`/api/variables?token=${token}`);
            if (response.status === 401) return logout();
            const data = await response.json();
            
            if (data.success && data.variables) {
                initialVariables = data.variables;
                // Poblar el formulario
                Object.keys(initialVariables).forEach(key => {
                    const input = document.getElementById(key) || document.getElementsByName(key)[0];
                    if (input) {
                        input.value = initialVariables[key];
                    }
                });

                // Actualizar editor si existe valor en variables de entorno inicialmente
                if (initialVariables['ASSISTANT_PROMPT'] && editor) {
                    editor.setValue(initialVariables['ASSISTANT_PROMPT']);
                }
            } else {
                alert('Error al cargar variables: ' + (data.error || 'Error desconocido'));
            }
        } catch (err) {
            console.error('Error fetching variables:', err);
            alert('Error de conexión al obtener variables.');
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
                // Para textarea (GOOGLE_PRIVATE_KEY)
                input.classList.toggle('hidden-content');
            }
            
            // Cambiar el icono (opcional)
            button.textContent = button.textContent === '👁️' ? '🙈' : '👁️';
        });
    });

    // Botón Cancelar: vuelve al dashboard
    cancelBtn.addEventListener('click', () => {
        window.location.href = '/dashboard';
    });

    // Manejo del formulario
    variablesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(variablesForm);
        const changedVariables = {};
        const changedKeys = [];
        
        formData.forEach((value, key) => {
            // Caso especial para CodeMirror
            if (key === 'ASSISTANT_PROMPT' && editor) {
                value = editor.getValue();
            }

            // Solo agregar si el valor es diferente al inicial
            if (value !== initialVariables[key]) {
                changedVariables[key] = value;
                changedKeys.push(key);
            }
        });

        if (changedKeys.length === 0) {
            alert('No se detectaron cambios en las variables.');
            return;
        }

        const confirmMsg = `Se han modificado las siguientes variables:\n\n${changedKeys.join('\n')}\n\nEl bot se reiniciará automáticamente para aplicar los cambios. ¿Deseas continuar?`;
        
        if (!confirm(confirmMsg)) {
            return;
        }

        updateBtn.disabled = true;
        updateBtn.textContent = 'Actualizando...';
        
        // Incluimos explícitamente el prompt si existe CodeMirror
        if (editor) {
             changedVariables['ASSISTANT_PROMPT'] = editor.getValue();
        }

        try {
            const token = localStorage.getItem('backoffice_token');
            const response = await fetch(`/api/update-variables?token=${token}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ variables: changedVariables })
            });

            if (response.status === 401) return logout();
            const data = await response.json();

            if (data.success) {
                alert('✅ Variables actualizadas correctamente. El bot se está reiniciando...');
                // Redirigir al dashboard después de un momento
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, 3000);
            } else {
                alert('❌ Error: ' + (data.error || 'Error desconocido'));
                updateBtn.disabled = false;
                updateBtn.textContent = 'Actualizar y Reiniciar';
            }
        } catch (err) {
            console.error('Error updating variables:', err);
            alert('Error de conexión al actualizar variables.');
            updateBtn.disabled = false;
            updateBtn.textContent = 'Actualizar y Reiniciar';
        }
    });

    // --- Sincronizar Prompt ---
    const syncBtn = document.getElementById('sync-prompt-btn');
    const syncStatus = document.getElementById('sync-status');
    const promptTextarea = document.getElementById('ASSISTANT_PROMPT');
    const assistantIdInput = document.getElementById('ASSISTANT_ID');

    syncBtn.addEventListener('click', async () => {
        const assistantId = assistantIdInput.value;
        if (!assistantId) {
            alert('Debes ingresar un ASSISTANT_ID para sincronizar.');
            return;
        }

        syncBtn.disabled = true;
        syncStatus.textContent = '⏳ Obteniendo instrucciones...';
        syncStatus.style.color = 'inherit';

        try {
            const token = localStorage.getItem('backoffice_token');
            const response = await fetch(`/api/backoffice/sync-assistant-prompt?token=${token}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ assistantId })
            });

            const data = await response.json();
            if (data.success) {
                if (editor) editor.setValue(data.instructions);
                syncStatus.textContent = '✅ Sincronizado correctamente.';
                syncStatus.style.color = '#10b981';
            } else {
                syncStatus.textContent = '❌ Error sincronizando.';
                syncStatus.style.color = '#ef4444';
                alert('Error: ' + data.error);
            }
        } catch (err) {
            console.error('Error syncing prompt:', err);
            syncStatus.textContent = '❌ Error de conexión.';
            syncStatus.style.color = '#ef4444';
        } finally {
            syncBtn.disabled = false;
        }
    });

    // --- Guardar Prompt sin reiniciar (Hot-update) ---
    const hotSaveBtn = document.getElementById('save-prompt-hot-btn');
    hotSaveBtn.addEventListener('click', async () => {
        const prompt = editor ? editor.getValue() : promptTextarea.value;
        hotSaveBtn.disabled = true;
        syncStatus.textContent = '⏳ Guardando en base de datos...';
        syncStatus.style.color = 'inherit';

        try {
            const token = localStorage.getItem('backoffice_token');
            const response = await fetch(`/api/backoffice/update-prompt?token=${token}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt })
            });

            const data = await response.json();
            if (data.success) {
                syncStatus.textContent = '✅ Guardado correctamente (Hot-update).';
                syncStatus.style.color = '#10b981';
                // Actualizar initialVariables para evitar que el form principal crea que hay cambios
                initialVariables['ASSISTANT_PROMPT'] = prompt;
            } else {
                syncStatus.textContent = '❌ Error al guardar.';
                syncStatus.style.color = '#ef4444';
                alert('Error: ' + data.error);
            }
        } catch (err) {
            console.error('Error saving hot prompt:', err);
            syncStatus.textContent = '❌ Error de conexión.';
        } finally {
            hotSaveBtn.disabled = false;
        }
    });

    // --- Cargar Prompt actual desde DB ---
    async function loadAssistantPrompt() {
        try {
            const token = localStorage.getItem('backoffice_token');
            const response = await fetch(`/api/backoffice/get-prompt?token=${token}`);
            const data = await response.json();
            if (data.success && data.prompt) {
                if (editor) editor.setValue(data.prompt);
                initialVariables['ASSISTANT_PROMPT'] = data.prompt;
            }
        } catch (err) {
            console.error('Error loading stored prompt:', err);
        }
    }
    
    // Llamar a la carga del prompt
    await loadAssistantPrompt();
});
