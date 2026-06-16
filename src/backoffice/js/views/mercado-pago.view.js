window.mercadoPagoView = (() => {
    let _token = '';

    function getHTML() {
        return `
        <main class="crm-main-container animate-fade" style="z-index:10; padding:0;">
            <div class="kanban-header">
                <div class="header-info">
                    <h1><i class="fas fa-wallet kanban-header-icon" style="color:#009ee3;"></i> Mercado Pago</h1>
                    <p>Integracion con Mercado Libre y Mercado Pago</p>
                </div>
            </div>
            
            <div class="meta-view-body" style="padding: 2rem 1.5rem; max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem;">
                
                <!-- Card principal de Onboarding / Estado -->
                <div class="glass-card" style="padding: 2rem; border-radius: 20px; border: 1px solid var(--border); background: var(--bg-card); width: 100%;">
                    
                    <div style="text-align: center; margin-bottom: 1.5rem;">
                        <div style="color:#009ee3; font-size:4rem; margin-bottom:1rem;">
                            <i class="fas fa-wallet"></i>
                        </div>
                        <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Mercado Pago</h2>
                        <div style="height:3px; width:50px; background:#009ee3; border-radius:10px; margin:0 auto 12px;"></div>
                        <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0;">
                            Vincula tu cuenta y podras ver y gestionar pagos recibidos, crear links de pagos, controlar comprobantes recibidos y realizar acciones automaticas al recibir pagos.
                        </p>
                    </div>

                    <!-- Estado: Cargando -->
                    <div id="mp-loading" style="text-align: center; padding: 2rem 0;">
                        <i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; color: #009ee3;"></i>
                        <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 10px;">Cargando estado de la integración...</p>
                    </div>

                    <!-- Estado: Desconectado / Formulario de Conexión -->
                    <div id="mp-disconnected-section" style="display: none;">
                        <div style="background: rgba(0, 158, 227, 0.05); border: 1px solid rgba(0, 158, 227, 0.2); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem;">
                            <h4 style="margin: 0 0 6px; color: #009ee3; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">¿Cómo obtener tu Access Token?</h4>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
                                Ingresá a <a href="https://www.mercadopago.com.ar/developers/panel" target="_blank" style="color: #009ee3; text-decoration: underline; font-weight: 600;">Mercado Pago Developers</a>, ve a tus Credenciales y copia tu <strong>Access Token</strong> (de producción <code>APP_USR-</code> o de prueba <code>TEST-</code>).
                            </p>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 1.5rem; text-align: left;">
                            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Access Token (Producción o Prueba)</label>
                            <input type="password" id="mp-token-input" class="crm-input" placeholder="APP_USR-... o TEST-..." style="width: 100%; padding: 12px; border-radius: 10px; background: var(--bg-header); border: 1px solid var(--border); color: var(--text-main);">
                        </div>
                        <button id="mp-connect-btn" class="btn-primary" style="width:100%; padding:13px 20px; display:flex; align-items:center; justify-content:center; gap:10px; font-size:0.95rem; font-weight:600; border-radius:12px; background: #009ee3; color: white; border: none; cursor: pointer; transition: all 0.2s;">
                            <i class="fas fa-plug"></i> Vincular Cuenta
                        </button>
                    </div>

                    <!-- Estado: Conectado -->
                    <div id="mp-connected-section" style="display: none;">
                        <div id="mp-badge-container" style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; text-align: center;">
                            <span id="mp-status-badge-text" style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #10b981; display: inline-flex; align-items: center; gap: 6px;">
                                <i class="fas fa-check-circle"></i> Cuenta Vinculada Correctamente
                            </span>
                        </div>

                        <div style="background: var(--bg-header); border: 1px solid var(--border); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 10px; font-size: 0.9rem; margin-bottom: 1.5rem; text-align: left;">
                            <div style="display: flex; justify-content: space-between;"><strong style="color: var(--text-muted);">Usuario:</strong> <span id="mp-nickname" style="font-weight: 600; color: var(--text-main);">Cargando...</span></div>
                            <div style="display: flex; justify-content: space-between;"><strong style="color: var(--text-muted);">Email:</strong> <span id="mp-email" style="font-weight: 600; color: var(--text-main);">Cargando...</span></div>
                            <div style="display: flex; justify-content: space-between;"><strong style="color: var(--text-muted);">User ID:</strong> <span id="mp-userid" style="font-family: monospace; color: var(--text-muted);">Cargando...</span></div>
                        </div>

                        <!-- Override Form container -->
                        <div id="mp-override-container" style="display: none; border-top: 1px solid var(--border); padding-top: 1.5rem; margin-top: 1.5rem; text-align: left;">
                            <h4 style="margin: 0 0 8px; color: var(--text-main); font-size: 0.9rem; font-weight: 700;">Vincular Cuenta de Cliente Personalizada</h4>
                            <p style="margin: 0 0 1.25rem; font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
                                Puedes anular la configuración por defecto vinculando un Access Token propio para este proyecto.
                            </p>
                            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 1rem;">
                                <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-main);">Access Token del Cliente</label>
                                <input type="password" id="mp-override-token-input" class="crm-input" placeholder="APP_USR-... o TEST-..." style="width: 100%; padding: 10px; border-radius: 8px; background: var(--bg-header); border: 1px solid var(--border); color: var(--text-main);">
                            </div>
                            <button id="mp-override-connect-btn" class="btn-primary" style="width:100%; padding:11px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:0.88rem; font-weight:600; border-radius:10px; background: #009ee3; color: white; border: none; cursor: pointer;">
                                <i class="fas fa-plug"></i> Vincular esta Cuenta
                            </button>
                        </div>

                        <button id="mp-disconnect-btn" style="width:100%; padding:11px 20px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:0.88rem; font-weight:600; border-radius:12px; background: transparent; color: #ef4444; border: 1px solid #ef4444; cursor: pointer; transition: all 0.2s; margin-top: 10px;">
                            <i class="fas fa-trash-can"></i> Desvincular Cuenta
                        </button>
                    </div>

                </div>

                <!-- Sección: Generador Manual de Links (Sólo visible si conectado) -->
                <div id="mp-generator-section" class="glass-card" style="display: none; padding: 2rem; border-radius: 20px; border: 1px solid var(--border); background: var(--bg-card); width: 100%; text-align: left;">
                    <h3 style="margin: 0 0 1rem; color: var(--text-main); font-size: 1.15rem; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-link" style="color: #009ee3;"></i> Generar Link de Pago
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
                        <div>
                            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 6px;">Concepto / Título</label>
                            <input type="text" id="mp-link-title" class="crm-input" placeholder="Ej: Pago de cuota, Reserva de producto..." style="width: 100%; padding: 10px; border-radius: 8px; background: var(--bg-header); border: 1px solid var(--border); color: var(--text-main);">
                        </div>
                        <div>
                            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-main); display: block; margin-bottom: 6px;">Monto (ARS)</label>
                            <input type="number" id="mp-link-amount" class="crm-input" placeholder="Ej: 1500" min="1" style="width: 100%; padding: 10px; border-radius: 8px; background: var(--bg-header); border: 1px solid var(--border); color: var(--text-main);">
                        </div>
                    </div>
                    
                    <button id="mp-generate-btn" class="btn-primary" style="width:100%; padding:12px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:0.9rem; font-weight:600; border-radius:10px; background: #009ee3; color: white; border: none; cursor: pointer;">
                        <i class="fas fa-magic"></i> Crear Link de Pago
                    </button>

                    <!-- Link Generado -->
                    <div id="mp-result-container" style="display: none; margin-top: 1.5rem; background: var(--bg-header); border: 1px solid var(--border); border-radius: 12px; padding: 1rem;">
                        <label style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Link Generado</label>
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
                            <input type="text" id="mp-result-url" readonly style="flex: 1; padding: 10px; border-radius: 8px; background: var(--bg-card); border: 1px solid var(--border); color: #009ee3; font-weight: 600; font-size: 0.85rem; min-width: 0;">
                            <button id="mp-copy-btn" title="Copiar al portapapeles" style="padding: 10px 14px; border-radius: 8px; background: var(--bg-card); border: 1px solid var(--border); color: var(--text-main); cursor: pointer;">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                        <a id="mp-open-btn" href="#" target="_blank" style="display: block; text-align: center; padding: 8px; border-radius: 8px; background: rgba(0, 158, 227, 0.1); color: #009ee3; text-decoration: none; font-size: 0.85rem; font-weight: 600;">
                            <i class="fas fa-external-link-alt"></i> Probar Pago
                        </a>
                    </div>
                </div>

            </div>
        </main>`;
    }

    async function checkStatus() {
        const loading = document.getElementById('mp-loading');
        const disconnectedSec = document.getElementById('mp-disconnected-section');
        const connectedSec = document.getElementById('mp-connected-section');
        const generatorSec = document.getElementById('mp-generator-section');

        if (!loading) return; // View unmounted

        loading.style.display = 'block';
        disconnectedSec.style.display = 'none';
        connectedSec.style.display = 'none';
        generatorSec.style.display = 'none';

        try {
            const token = localStorage.getItem('backoffice_token');
            const res = await fetch(`/api/backoffice/mercadopago/status?token=${token}`);
            const data = await res.json();

            if (!loading) return; // Safety check
            loading.style.display = 'none';

            if (data && data.connected) {
                connectedSec.style.display = 'block';
                generatorSec.style.display = 'block';
                
                document.getElementById('mp-nickname').textContent = data.nickname || 'Desconocido';
                document.getElementById('mp-email').textContent = data.email || 'Desconocido';
                document.getElementById('mp-userid').textContent = data.id || 'Desconocido';
                
                const badgeText = document.getElementById('mp-status-badge-text');
                const badgeContainer = document.getElementById('mp-badge-container');
                const overrideContainer = document.getElementById('mp-override-container');
                const disconnectBtn = document.getElementById('mp-disconnect-btn');

                if (badgeText && badgeContainer) {
                    if (data.isFromEnv) {
                        badgeText.innerHTML = '<i class="fas fa-server"></i> Conectado por Defecto (Servidor)';
                        badgeText.style.color = '#009ee3';
                        badgeContainer.style.background = 'rgba(0, 158, 227, 0.05)';
                        badgeContainer.style.borderColor = 'rgba(0, 158, 227, 0.2)';
                        
                        if (overrideContainer) overrideContainer.style.display = 'block';
                        if (disconnectBtn) disconnectBtn.style.display = 'none';
                    } else {
                        badgeText.innerHTML = '<i class="fas fa-check-circle"></i> Cuenta Vinculada (Cliente)';
                        badgeText.style.color = '#10b981';
                        badgeContainer.style.background = 'rgba(16, 185, 129, 0.05)';
                        badgeContainer.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                        
                        if (overrideContainer) overrideContainer.style.display = 'none';
                        if (disconnectBtn) disconnectBtn.style.display = 'block';
                    }
                }
            } else {
                disconnectedSec.style.display = 'block';
            }
        } catch (e) {
            console.error('Error fetching Mercado Pago status:', e);
            if (loading) {
                loading.style.display = 'none';
                disconnectedSec.style.display = 'block';
            }
        }
    }

    async function connectToken(tokenVal, btnElement) {
        if (!tokenVal) {
            showToast('Por favor ingrese un token de acceso válido.', 'error');
            return;
        }

        const originalHtml = btnElement.innerHTML;
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Conectando...';

        try {
            const res = await fetch(`/api/backoffice/mercadopago/connect?token=${_token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: tokenVal })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                showToast('¡Mercado Pago conectado con éxito!', 'success');
                await checkStatus();
            } else {
                showToast(data.error || 'No se pudo conectar Mercado Pago.', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Error de red al conectar.', 'error');
        } finally {
            btnElement.disabled = false;
            btnElement.innerHTML = originalHtml;
        }
    }

    async function init() {
        const token = localStorage.getItem('backoffice_token');
        _token = token;

        await checkStatus();

        // Connect main handler
        const connectBtn = document.getElementById('mp-connect-btn');
        if (connectBtn) {
            connectBtn.addEventListener('click', async () => {
                const tokenInput = document.getElementById('mp-token-input');
                const val = tokenInput ? tokenInput.value.trim() : '';
                await connectToken(val, connectBtn);
                if (tokenInput) tokenInput.value = '';
            });
        }

        // Override connect handler
        const overrideConnectBtn = document.getElementById('mp-override-connect-btn');
        if (overrideConnectBtn) {
            overrideConnectBtn.addEventListener('click', async () => {
                const tokenInput = document.getElementById('mp-override-token-input');
                const val = tokenInput ? tokenInput.value.trim() : '';
                await connectToken(val, overrideConnectBtn);
                if (tokenInput) tokenInput.value = '';
            });
        }

        // Disconnect handler
        const disconnectBtn = document.getElementById('mp-disconnect-btn');
        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', async () => {
                if (!confirm('¿Estás seguro de que deseas desvincular Mercado Pago?')) return;

                disconnectBtn.disabled = true;
                disconnectBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Desvinculando...';

                try {
                    const res = await fetch(`/api/backoffice/mercadopago/disconnect?token=${_token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast('Mercado Pago desvinculado.', 'success');
                        await checkStatus();
                    } else {
                        showToast(data.error || 'No se pudo desvincular.', 'error');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('Error al desvincular.', 'error');
                } finally {
                    disconnectBtn.disabled = false;
                    disconnectBtn.innerHTML = '<i class="fas fa-trash-can"></i> Desvincular Cuenta';
                }
            });
        }

        // Generator handler
        const generateBtn = document.getElementById('mp-generate-btn');
        if (generateBtn) {
            generateBtn.addEventListener('click', async () => {
                const titleInput = document.getElementById('mp-link-title');
                const amountInput = document.getElementById('mp-link-amount');

                const title = titleInput ? titleInput.value.trim() : '';
                const amount = amountInput ? Number(amountInput.value.trim()) : 0;

                if (!title || !amount || amount <= 0) {
                    showToast('Por favor ingrese un título y monto válidos.', 'error');
                    return;
                }

                generateBtn.disabled = true;
                generateBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generando...';

                try {
                    const res = await fetch(`/api/backoffice/mercadopago/create-link?token=${_token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title, amount })
                    });
                    const data = await res.json();

                    if (res.ok && data.success) {
                        showToast('¡Link de pago generado!', 'success');
                        const resultUrl = document.getElementById('mp-result-url');
                        const openBtn = document.getElementById('mp-open-btn');
                        const resultContainer = document.getElementById('mp-result-container');

                        if (resultUrl) resultUrl.value = data.link;
                        if (openBtn) openBtn.href = data.link;
                        if (resultContainer) resultContainer.style.display = 'block';
                    } else {
                        showToast(data.error || 'Error al generar link de pago.', 'error');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('Error al conectarse al servidor.', 'error');
                } finally {
                    generateBtn.disabled = false;
                    generateBtn.innerHTML = '<i class="fas fa-magic"></i> Crear Link de Pago';
                }
            });
        }

        // Copy button handler
        const copyBtn = document.getElementById('mp-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const resultUrl = document.getElementById('mp-result-url');
                if (resultUrl && resultUrl.value) {
                    navigator.clipboard.writeText(resultUrl.value);
                    showToast('¡Link de pago copiado al portapapeles!', 'success');
                }
            });
        }
    }

    return {
        title: 'Mercado Pago - ' + (window.BOT_NAME || 'Backoffice'),
        getHTML,
        init,
    };
})();
