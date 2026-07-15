/* global showToast */
window.mercadoPagoView = (() => {
    let _token = '';
    let _projectId = '';

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
                    <div id="mp-disconnected-section" style="display: none; text-align: center;">
                        <div style="background: rgba(0, 158, 227, 0.05); border: 1px solid rgba(0, 158, 227, 0.2); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; text-align: left;">
                            <h4 style="margin: 0 0 6px; color: #009ee3; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Conexión Segura</h4>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;">
                                Serás redirigido de forma segura a Mercado Pago para iniciar sesión con tus credenciales de usuario y autorizar la vinculación.
                            </p>
                        </div>
                        <button id="mp-connect-btn" class="btn-primary" style="width:100%; padding:13px 20px; display:flex; align-items:center; justify-content:center; gap:10px; font-size:0.95rem; font-weight:600; border-radius:12px; background: #009ee3; color: white; border: none; cursor: pointer; transition: all 0.2s;">
                            <i class="fas fa-plug"></i> Vincular con Mercado Pago
                        </button>
                    </div>

                    <!-- Estado: Conectado -->
                    <div id="mp-connected-section" style="display: none;">
                        <div id="mp-badge-container" style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 1rem; margin-bottom: 1.5rem; text-align: center;">
                            <span id="mp-status-badge-text" style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #10b981; display: inline-flex; align-items: center; gap: 6px;">
                                <i class="fas fa-check-circle"></i> Cuenta Vinculada Correctamente
                            </span>
                        </div>

                        <h4 style="margin: 0 0 12px; color: var(--text-main); font-size: 0.95rem; font-weight: 700; text-align: left;">Cuentas Vinculadas</h4>
                        
                        <div id="mp-accounts-list" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 1.5rem;">
                            <!-- Se renderizará dinámicamente -->
                        </div>

                        <button id="mp-add-account-btn" class="btn-primary" style="width:100%; padding:11px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:0.88rem; font-weight:600; border-radius:10px; background: #009ee3; color: white; border: none; cursor: pointer;">
                            <i class="fas fa-plus"></i> Vincular otra cuenta
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

    function attachAccountActionListeners() {
        document.querySelectorAll('.btn-activate-account').forEach(btn => {
            btn.addEventListener('click', async () => {
                const userId = btn.getAttribute('data-id');
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
                try {
                    const res = await fetch(`/api/backoffice/mercadopago/accounts/activate?token=${_token}&projectId=${_projectId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId })
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast('Cuenta activada con éxito.', 'success');
                        await checkStatus();
                    } else {
                        showToast(data.error || 'No se pudo activar la cuenta.', 'error');
                        await checkStatus();
                    }
                } catch (err) {
                    showToast('Error al activar la cuenta.', 'error');
                    await checkStatus();
                }
            });
        });

        document.querySelectorAll('.btn-delete-account').forEach(btn => {
            btn.addEventListener('click', async () => {
                const userId = btn.getAttribute('data-id');
                if (!await window.swalConfirm('¿Eliminar cuenta vinculada?', '¿Estás seguro de que deseas desvincular esta cuenta de Mercado Pago? El bot dejará de recibir pagos para esta cuenta.')) return;
                
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
                try {
                    const res = await fetch(`/api/backoffice/mercadopago/accounts/delete?token=${_token}&projectId=${_projectId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId })
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                        showToast('Cuenta eliminada con éxito.', 'success');
                        await checkStatus();
                    } else {
                        showToast(data.error || 'No se pudo eliminar la cuenta.', 'error');
                        await checkStatus();
                    }
                } catch (err) {
                    showToast('Error al eliminar la cuenta.', 'error');
                    await checkStatus();
                }
            });
        });
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
            const res = await fetch(`/api/backoffice/mercadopago/status?token=${token}&projectId=${_projectId}`);
            const data = await res.json();

            if (!loading) return; // Safety check
            loading.style.display = 'none';

            if (data && data.connected) {
                connectedSec.style.display = 'block';
                generatorSec.style.display = 'block';
                
                // Cargar todas las cuentas vinculadas
                const accountsRes = await fetch(`/api/backoffice/mercadopago/accounts?token=${token}&projectId=${_projectId}`);
                const accountsData = await accountsRes.json();
                const accounts = accountsData.accounts || [];

                const listContainer = document.getElementById('mp-accounts-list');
                if (listContainer) {
                    listContainer.innerHTML = '';
                    if (accounts.length === 0) {
                        listContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; margin: 10px 0;">No hay cuentas vinculadas.</p>';
                    } else {
                        accounts.forEach(acc => {
                            const accEl = document.createElement('div');
                            accEl.style.cssText = 'background: var(--bg-header); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center;';
                            accEl.innerHTML = `
                                <div style="text-align: left;">
                                    <div style="font-weight: 600; color: var(--text-main); font-size: 0.9rem;">${acc.nickname || 'Desconocido'}</div>
                                    <div style="color: var(--text-muted); font-size: 0.8rem; margin-top: 2px;">${acc.email || 'Sin email'}</div>
                                    <div style="color: var(--text-muted); font-size: 0.75rem; font-family: monospace;">ID: ${acc.user_id}</div>
                                </div>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    ${acc.is_active 
                                        ? `<span style="background: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 6px; text-transform: uppercase;">Activo</span>`
                                        : `<button class="btn-activate-account" data-id="${acc.user_id}" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px; background: #009ee3; color: white; border: none; cursor: pointer; font-weight: 600; transition: background 0.2s;">Activar</button>`
                                    }
                                    <button class="btn-delete-account" data-id="${acc.user_id}" title="Eliminar cuenta" style="background: transparent; color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 6px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                                        <i class="fas fa-trash-can"></i>
                                    </button>
                                </div>
                            `;
                            listContainer.appendChild(accEl);
                        });

                        // Agregar listeners
                        attachAccountActionListeners();
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

    async function startOAuthFlow(btnElement) {
        const originalHtml = btnElement.innerHTML;
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Redirigiendo...';

        try {
            const res = await fetch(`/api/backoffice/mercadopago/auth-url?token=${_token}&projectId=${_projectId}`);
            const data = await res.json();
            
            if (res.ok && data.success && data.url) {
                window.location.href = data.url;
            } else {
                showToast(data.error || 'No se pudo obtener la URL de vinculación.', 'error');
                btnElement.disabled = false;
                btnElement.innerHTML = originalHtml;
            }
        } catch (err) {
            console.error(err);
            showToast('Error de red al iniciar la vinculación.', 'error');
            btnElement.disabled = false;
            btnElement.innerHTML = originalHtml;
        }
    }

    async function init() {
        const token = localStorage.getItem('backoffice_token');
        _token = token;

        const urlParams = new URLSearchParams(window.location.search);
        _projectId = urlParams.get('projectId') || '';

        await checkStatus();

        // Connect main handler
        const connectBtn = document.getElementById('mp-connect-btn');
        if (connectBtn) {
            connectBtn.addEventListener('click', async () => {
                await startOAuthFlow(connectBtn);
            });
        }

        // Add account handler (vincular cuenta adicional)
        const addAccountBtn = document.getElementById('mp-add-account-btn');
        if (addAccountBtn) {
            addAccountBtn.addEventListener('click', async () => {
                await startOAuthFlow(addAccountBtn);
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
                    const res = await fetch(`/api/backoffice/mercadopago/create-link?token=${_token}&projectId=${_projectId}`, {
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
