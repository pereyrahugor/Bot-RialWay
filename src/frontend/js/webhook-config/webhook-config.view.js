/* global showToast, Swal */
window.webhookConfigView = (() => {
    let _token = '';

    function getHTML() {
        return `
        <div id="main-webhook-content" style="display:flex; opacity:1; flex:1; overflow:auto; flex-direction:column;">
            <main class="crm-main-container relative animate-fade" style="z-index:10; max-width:800px; margin:0 auto; padding: 2rem 1.5rem; width: 100%;">
                
                <div class="kanban-header" style="margin-bottom:2rem;">
                    <div class="header-info">
                        <h1><i class="fas fa-satellite-dish kanban-header-icon" style="color:#8b5cf6;"></i> Suscripciones Webhook</h1>
                        <p>Configura el envío de notificaciones en tiempo real a tus servidores externos</p>
                    </div>
                </div>

                <div class="glass-card" style="padding:2rem; border-radius:16px; border:1px solid var(--border); background:var(--bg-card); display:flex; flex-direction:column; gap:20px;">
                    <!-- URL del webhook -->
                    <div class="variable-group" style="padding:0; background:none; border:none; display:flex; flex-direction:column; gap:6px;">
                        <h3 style="margin:0; font-size:0.95rem; font-weight:700; color:var(--text-main);">URL de Webhook</h3>
                        <p class="description" style="margin:0; font-size:0.82rem; color:var(--text-muted);">La URL HTTPS a la que Neurolinks enviará las peticiones HTTP POST.</p>
                        <input type="text" id="webhook-url" placeholder="https://tu-servidor.com/webhook" style="width:100%; padding:10px 14px; border-radius:10px; border:1.5px solid var(--border); background:var(--bg-header); color:var(--text-main); font-size:0.9rem;">
                    </div>

                    <!-- Secreto HMAC -->
                    <div class="variable-group" style="padding:0; background:none; border:none; display:flex; flex-direction:column; gap:6px;">
                        <h3 style="margin:0; font-size:0.95rem; font-weight:700; color:var(--text-main);">Secreto de Firma HMAC</h3>
                        <p class="description" style="margin:0; font-size:0.82rem; color:var(--text-muted);">Clave secreta utilizada para firmar los payloads y verificar el origen seguro en tu servidor (cabecera <code>X-Neurolinks-Signature</code>).</p>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <div style="position:relative; flex:1;">
                                <input type="password" id="webhook-secret" placeholder="Deja en blanco para no firmar" style="width:100%; padding:10px 14px; padding-right:90px; border-radius:10px; border:1.5px solid var(--border); background:var(--bg-header); color:var(--text-main); font-size:0.9rem;">
                                <button type="button" class="toggle-password-inline" onclick="toggleSecretVisibility()" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); border:none; background:none; color:var(--text-muted); font-size:0.82rem; cursor:pointer;">
                                    <i class="fas fa-eye"></i> Mostrar
                                </button>
                            </div>
                            <button type="button" class="btn-outline" onclick="generateRandomSecret()" style="padding:10px 14px; border-radius:10px; white-space:nowrap; display:flex; align-items:center; gap:6px;">
                                <i class="fas fa-key"></i> Generar
                            </button>
                        </div>
                    </div>

                    <!-- Lista de Checkboxes -->
                    <div class="variable-group" style="padding:0; background:none; border:none; display:flex; flex-direction:column; gap:10px;">
                        <h3 style="margin:0; font-size:0.95rem; font-weight:700; color:var(--text-main);">Eventos Suscritos</h3>
                        <p class="description" style="margin:0 0 6px 0; font-size:0.82rem; color:var(--text-muted);">Selecciona exactamente los eventos que deseas despachar:</p>
                        
                        <div style="display:flex; flex-direction:column; gap:12px; background:var(--bg-header); padding:1.25rem; border-radius:12px; border:1px solid var(--border);">
                            <!-- Evento 1 -->
                            <label style="display:flex; align-items:flex-start; gap:12px; cursor:pointer;">
                                <input type="checkbox" name="webhook-event" value="contact.updated" style="margin-top:4px; transform:scale(1.15);">
                                <div>
                                    <span style="font-weight:600; font-size:0.9rem; color:var(--text-main);">👤 contact.updated</span>
                                    <span style="display:block; font-size:0.8rem; color:var(--text-muted);">Se dispara cuando se actualizan datos del cliente (nombre, teléfono, email, dirección, etc.).</span>
                                </div>
                            </label>

                            <!-- Evento 2 -->
                            <label style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; border-top:1px solid var(--border); padding-top:10px;">
                                <input type="checkbox" name="webhook-event" value="lead.created" style="margin-top:4px; transform:scale(1.15);">
                                <div>
                                    <span style="font-weight:600; font-size:0.9rem; color:var(--text-main);">🌟 lead.created</span>
                                    <span style="display:block; font-size:0.8rem; color:var(--text-muted);">Se dispara cuando un nuevo contacto fue registrado o detectado por el bot.</span>
                                </div>
                            </label>

                            <!-- Evento 3 -->
                            <label style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; border-top:1px solid var(--border); padding-top:10px;">
                                <input type="checkbox" name="webhook-event" value="lead.expired" style="margin-top:4px; transform:scale(1.15);">
                                <div>
                                    <span style="font-weight:600; font-size:0.9rem; color:var(--text-main);">⏰ lead.expired</span>
                                    <span style="display:block; font-size:0.8rem; color:var(--text-muted);">Se dispara cuando se alcanza la fecha y hora de la alerta/seguimiento del lead.</span>
                                </div>
                            </label>

                            <!-- Evento 4 -->
                            <label style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; border-top:1px solid var(--border); padding-top:10px;">
                                <input type="checkbox" name="webhook-event" value="lead.status_moved" style="margin-top:4px; transform:scale(1.15);">
                                <div>
                                    <span style="font-weight:600; font-size:0.9rem; color:var(--text-main);">📊 lead.status_moved</span>
                                    <span style="display:block; font-size:0.8rem; color:var(--text-muted);">Se dispara cuando el estado o la columna del CRM cambia de lugar.</span>
                                </div>
                            </label>

                            <!-- Evento 5 -->
                            <label style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; border-top:1px solid var(--border); padding-top:10px;">
                                <input type="checkbox" name="webhook-event" value="message.received" style="margin-top:4px; transform:scale(1.15);">
                                <div>
                                    <span style="font-weight:600; font-size:0.9rem; color:var(--text-main);">💬 message.received</span>
                                    <span style="display:block; font-size:0.8rem; color:var(--text-muted);">Se dispara al recibir un nuevo mensaje entrante del usuario.</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Botones de Acción -->
                    <div style="display:flex; gap:14px; justify-content:flex-end; border-top:1px solid var(--border); padding-top:20px; margin-top:10px;">
                        <button type="button" class="btn-outline" onclick="sendTestWebhook()" style="padding:10px 20px; border-radius:10px; display:flex; align-items:center; gap:8px; font-weight:600;">
                            <i class="fas fa-flask"></i> Enviar Evento de Prueba
                        </button>
                        <button type="button" class="btn-primary" onclick="saveWebhookConfig()" style="padding:10px 24px; border-radius:10px; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:white; border:none; cursor:pointer; display:flex; align-items:center; gap:8px; font-weight:600; box-shadow:0 4px 12px rgba(99,102,241,0.25);">
                            <i class="fas fa-floppy-disk"></i> Guardar Suscripciones
                        </button>
                    </div>
                </div>
            </main>
        </div>`;
    }

    async function init() {
        _token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';

        // Exponer funciones globales
        window.toggleSecretVisibility = toggleSecretVisibility;
        window.generateRandomSecret = generateRandomSecret;
        window.saveWebhookConfig = saveWebhookConfig;
        window.sendTestWebhook = sendTestWebhook;

        // Cargar configuración actual
        await loadWebhookConfig();
    }

    function destroy() {
        delete window.toggleSecretVisibility;
        delete window.generateRandomSecret;
        delete window.saveWebhookConfig;
        delete window.sendTestWebhook;
    }

    async function loadWebhookConfig() {
        try {
            const res = await fetch(`/api/backoffice/webhooks/config?token=${encodeURIComponent(_token)}`);
            const data = await res.json();
            if (data.success && data.config) {
                const { webhookUrl, webhookSecret, webhookEvents } = data.config;
                document.getElementById('webhook-url').value = webhookUrl || '';
                document.getElementById('webhook-secret').value = webhookSecret || '';

                const checkboxes = document.querySelectorAll('input[name="webhook-event"]');
                checkboxes.forEach(cb => {
                    cb.checked = Array.isArray(webhookEvents) && webhookEvents.includes(cb.value);
                });
            }
        } catch (err) {
            console.error('[WebhookConfigView] Error loading config:', err);
            showToast('❌ Error al cargar configuración', 'error');
        }
    }

    async function saveWebhookConfig() {
        const webhookUrl = document.getElementById('webhook-url').value;
        const webhookSecret = document.getElementById('webhook-secret').value;
        
        const webhookEvents = [];
        document.querySelectorAll('input[name="webhook-event"]:checked').forEach(cb => {
            webhookEvents.push(cb.value);
        });

        try {
            const res = await fetch(`/api/backoffice/webhooks/config?token=${encodeURIComponent(_token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ webhookUrl, webhookSecret, webhookEvents })
            });

            const data = await res.json();
            if (data.success) {
                showToast('✅ Suscripciones guardadas correctamente', 'success');
            } else {
                showToast(`❌ Error: ${data.error}`, 'error');
            }
        } catch (err) {
            console.error('[WebhookConfigView] Error saving config:', err);
            showToast('❌ Error de conexión al guardar', 'error');
        }
    }

    async function sendTestWebhook() {
        const webhookUrl = document.getElementById('webhook-url').value;
        const webhookSecret = document.getElementById('webhook-secret').value;

        if (!webhookUrl || !webhookUrl.startsWith('http')) {
            showToast('⚠️ Proporcione una URL válida antes del test', 'error');
            return;
        }

        showToast('🧪 Enviando evento de prueba...', 'info');

        try {
            const res = await fetch(`/api/backoffice/webhooks/test?token=${encodeURIComponent(_token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ webhookUrl, webhookSecret })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                Swal.fire({
                    title: '¡Webhook Exitoso!',
                    text: data.message,
                    icon: 'success',
                    confirmButtonColor: '#8b5cf6'
                });
            } else {
                Swal.fire({
                    title: 'Error de Conexión',
                    text: data.error || 'El servidor destino no respondió.',
                    icon: 'error',
                    confirmButtonColor: '#8b5cf6'
                });
            }
        } catch (err) {
            showToast(`❌ Falló la petición de test: ${err.message}`, 'error');
        }
    }

    function toggleSecretVisibility() {
        const input = document.getElementById('webhook-secret');
        const btn = input.nextElementSibling;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.innerHTML = show
            ? '<i class="fas fa-eye-slash"></i> Ocultar'
            : '<i class="fas fa-eye"></i> Mostrar';
    }

    function generateRandomSecret() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#%^&*';
        let secret = 'whsec_';
        for (let i = 0; i < 24; i++) {
            secret += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const input = document.getElementById('webhook-secret');
        input.value = secret;
        input.type = 'text';
        showToast('🔑 Secreto generado (visible temporalmente)', 'success');
    }

    return {
        title: 'Webhooks - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
        destroy
    };
})();
