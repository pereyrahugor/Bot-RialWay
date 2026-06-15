/* global showToast */
window.mercadoPagoView = (() => {
    function getHTML() {
        return `
        <main class="crm-main-container" style="z-index:10; padding:0;">
            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-credit-card kanban-header-icon" style="color:#009ee3;"></i> Mercado Pago</h1>
                    <p>Integracion de pagos y cobros</p>
                </div>
            </div>
            <div class="meta-view-body">
                <!-- NOT CONNECTED STATE -->
                <div id="mp-not-connected" style="display:none; width: 100%; max-width: 550px;">
                    <div class="meta-onboarding-wrap glass-card animate-fade">
                        <div style="color:#009ee3; font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%;">
                            <i class="fas fa-credit-card"></i>
                        </div>
                        <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                            <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Vincular Mercado Pago</h2>
                            <div style="height:3px; width:50px; background:#009ee3; border-radius:10px; margin:0 auto 12px;"></div>
                            <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0 0 15px;">
                                Vincula tu cuenta para poder recibir notificaciones de pagos, generar links de pago y verificar transacciones en tiempo real.
                            </p>
                        </div>
                        
                        <div style="width: 100%; display: flex; flex-direction: column; gap: 15px; margin-bottom: 1.5rem; text-align: left;">
                            <div>
                                <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-main); margin-bottom: 5px;">ID de la Aplicación (App ID)</label>
                                <input type="text" id="mp-input-appid" placeholder="Ej: 2653149953941422" style="width: 100%; padding: 10px 14px; border: 1px solid var(--border); background: var(--bg-header); color: var(--text-main); border-radius: 8px; font-size: 0.9rem;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-main); margin-bottom: 5px;">Clave Pública (Public Key)</label>
                                <input type="text" id="mp-input-publickey" placeholder="Ej: APP_USR-..." style="width: 100%; padding: 10px 14px; border: 1px solid var(--border); background: var(--bg-header); color: var(--text-main); border-radius: 8px; font-size: 0.9rem;">
                            </div>
                            <div>
                                <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-main); margin-bottom: 5px;">Access Token de Producción / Prueba</label>
                                <input type="password" id="mp-input-accesotoken" placeholder="Ej: APP_USR-..." style="width: 100%; padding: 10px 14px; border: 1px solid var(--border); background: var(--bg-header); color: var(--text-main); border-radius: 8px; font-size: 0.9rem;">
                            </div>
                        </div>

                        <div style="background:var(--bg-header); padding:0.75rem 1rem; border-radius:12px; border:1px solid var(--border); width:100%; text-align:left; margin-bottom:1.5rem; font-size:0.85rem; color:var(--text-muted);">
                            <i class="fas fa-info-circle" style="color:#009ee3; margin-right:5px;"></i> Podes obtener tus credenciales desde el 
                            <a href="https://www.mercadopago.com.ar/developers/panel" target="_blank" style="color:#009ee3; font-weight:600; text-decoration:underline;">Panel de Desarrolladores de Mercado Pago</a>.
                        </div>

                        <button id="mp-btn-connect" onclick="connectMercadoPago()" style="width:100%; padding:12px; background:#009ee3; color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; font-size:0.95rem; display:flex; align-items:center; justify-content:center; gap:8px; transition: brightness 0.2s;">
                            <i class="fas fa-plug"></i> Vincular Cuenta
                        </button>
                    </div>
                </div>

                <!-- CONNECTED STATE -->
                <div id="mp-connected" style="display:none; width: 100%; max-width: 550px;">
                    <div class="meta-onboarding-wrap glass-card animate-fade" style="border-top: 3px solid #10b981;">
                        <div style="color:#10b981; font-size:3.5rem; margin-bottom:1.25rem; text-align:center; width:100%;">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <div style="margin-bottom:1.5rem; text-align:center; width:100%;">
                            <h2 style="margin:0 0 8px; color:var(--text-main); font-size:1.45rem; font-weight:700;">Mercado Pago Conectado</h2>
                            <div style="height:3px; width:50px; background:#10b981; border-radius:10px; margin:0 auto 12px;"></div>
                            <p style="color:var(--text-muted); font-size:0.95rem; line-height:1.5; margin:0;">
                                Tu cuenta de Mercado Pago está vinculada correctamente a este proyecto.
                            </p>
                        </div>

                        <div style="width: 100%; background: var(--bg-header); padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border); text-align: left; margin-bottom: 1.5rem; font-size: 0.9rem; display: flex; flex-direction: column; gap: 8px;">
                            <div><strong style="color: var(--text-main);">Cuenta vinculada:</strong> <span id="mp-info-nickname" style="color:var(--text-muted)"></span></div>
                            <div><strong style="color: var(--text-main);">User ID:</strong> <span id="mp-info-userid" style="color:var(--text-muted)"></span></div>
                            <div><strong style="color: var(--text-main);">App ID:</strong> <span id="mp-info-appid" style="color:var(--text-muted)"></span></div>
                            <div><strong style="color: var(--text-main);">Clave Pública:</strong> <span id="mp-info-publickey" style="color:var(--text-muted)"></span></div>
                        </div>

                        <!-- Generator Panel -->
                        <div style="width: 100%; border-top: 1px dashed var(--border); margin-top: 1.5rem; padding-top: 1.5rem; text-align: left; margin-bottom: 1.5rem;">
                            <h3 style="color: var(--text-main); font-size: 1.1rem; font-weight: 700; margin: 0 0 12px 0;">Generar Link de Pago</h3>
                            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 1rem;">
                                <div>
                                    <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Concepto / Título</label>
                                    <input type="text" id="mp-link-title" placeholder="Ej: Reserva de Servicio" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); background: var(--bg-header); color: var(--text-main); border-radius: 6px; font-size: 0.85rem;">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">Monto (ARS)</label>
                                    <input type="number" id="mp-link-amount" placeholder="Ej: 1500" style="width: 100%; padding: 8px 12px; border: 1px solid var(--border); background: var(--bg-header); color: var(--text-main); border-radius: 6px; font-size: 0.85rem;">
                                </div>
                            </div>
                            <button id="mp-btn-generate-link" onclick="generatePaymentLink()" style="width:100%; padding:10px; background:#009ee3; color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer; font-size:0.85rem; display:flex; align-items:center; justify-content:center; gap:6px; margin-bottom:12px;">
                                <i class="fas fa-link"></i> Generar Link
                            </button>

                            <!-- Generated Link Result -->
                            <div id="mp-link-result" style="display: none; margin-top: 1rem; background: rgba(0, 158, 227, 0.05); border: 1px solid rgba(0, 158, 227, 0.2); padding: 12px; border-radius: 8px; flex-direction: column; gap: 8px;">
                                <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-main);">¡Link generado con éxito!</div>
                                <div style="display: flex; gap: 8px;">
                                    <input type="text" id="mp-generated-url" readonly style="flex: 1; padding: 6px 10px; border: 1px solid var(--border); background: var(--bg-header); color: var(--text-main); border-radius: 6px; font-size: 0.8rem;">
                                    <button onclick="copyGeneratedLink()" style="padding: 6px 12px; background: var(--bg-header); border: 1px solid var(--border); color: var(--text-main); border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer;">
                                        Copiar
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button id="mp-btn-disconnect" onclick="disconnectMercadoPago()" style="width:100%; padding:12px; background:#ef4444; color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; font-size:0.95rem; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <i class="fas fa-trash-alt"></i> Desvincular Cuenta
                        </button>
                    </div>
                </div>
            </div>
        </main>`;
    }

    async function checkConnection() {
        try {
            const token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
            const res = await fetch(`/api/backoffice/mercadopago/config?token=${token}`);
            const data = await res.json();
            
            const notConn = document.getElementById('mp-not-connected');
            const conn = document.getElementById('mp-connected');
            
            if (data.success && data.config && data.config.accessToken) {
                if (notConn) notConn.style.display = 'none';
                if (conn) conn.style.display = 'block';
                
                document.getElementById('mp-info-nickname').textContent = data.config.nickname || 'Usuario de Mercado Pago';
                document.getElementById('mp-info-userid').textContent = data.config.userId || 'N/A';
                document.getElementById('mp-info-appid').textContent = data.config.appId || 'N/A';
                document.getElementById('mp-info-publickey').textContent = data.config.publicKey || 'N/A';
            } else {
                if (conn) conn.style.display = 'none';
                if (notConn) notConn.style.display = 'block';
            }
        } catch (e) {
            console.error('Error checking MP connection:', e);
        }
    }

    async function connectMercadoPago() {
        const appId = document.getElementById('mp-input-appid').value.trim();
        const publicKey = document.getElementById('mp-input-publickey').value.trim();
        const accessToken = document.getElementById('mp-input-accesotoken').value.trim();
        
        if (!appId || !publicKey || !accessToken) {
            showToast('⚠️ Por favor completa todos los campos', 'error');
            return;
        }
        
        const btn = document.getElementById('mp-btn-connect');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Conectando...';
        
        try {
            const token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
            const res = await fetch(`/api/backoffice/mercadopago/connect?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appId, publicKey, accessToken })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                showToast(`✅ Conectado exitosamente como ${data.nickname || 'Mercado Pago'}`, 'success');
                await checkConnection();
            } else {
                showToast(`❌ Error: ${data.error || 'No se pudo vincular la cuenta'}`, 'error');
            }
        } catch (e) {
            console.error('Error connecting Mercado Pago:', e);
            showToast('❌ Error de conexión al servidor', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug"></i> Vincular Cuenta';
        }
    }

    async function disconnectMercadoPago() {
        if (!confirm('¿Estás seguro de que deseas desvincular tu cuenta de Mercado Pago?')) return;
        
        const btn = document.getElementById('mp-btn-disconnect');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Desconectando...';
        
        try {
            const token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
            const res = await fetch(`/api/backoffice/mercadopago/disconnect?token=${token}`);
            const data = await res.json();
            
            if (res.ok && data.success) {
                showToast('✅ Cuenta desvinculada correctamente', 'success');
                await checkConnection();
            } else {
                showToast(`❌ Error: ${data.error || 'No se pudo desvincular la cuenta'}`, 'error');
            }
        } catch (e) {
            console.error('Error disconnecting Mercado Pago:', e);
            showToast('❌ Error de conexión al servidor', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash-alt"></i> Desvincular Cuenta';
        }
    }

    async function generatePaymentLink() {
        const title = document.getElementById('mp-link-title').value.trim();
        const amount = document.getElementById('mp-link-amount').value.trim();
        
        if (!title || !amount) {
            showToast('⚠️ Por favor completa el concepto y el monto', 'error');
            return;
        }
        
        const btn = document.getElementById('mp-btn-generate-link');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generando...';
        
        try {
            const token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
            const res = await fetch(`/api/backoffice/mercadopago/create-link?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, amount })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                showToast('✅ Link de pago generado correctamente', 'success');
                const resultDiv = document.getElementById('mp-link-result');
                const urlInput = document.getElementById('mp-generated-url');
                
                urlInput.value = data.initPoint;
                resultDiv.style.display = 'flex';
            } else {
                showToast(`❌ Error: ${data.error || 'No se pudo generar el link'}`, 'error');
            }
        } catch (e) {
            console.error('Error generating link:', e);
            showToast('❌ Error de conexión al servidor', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-link"></i> Generar Link';
        }
    }

    function copyGeneratedLink() {
        const urlInput = document.getElementById('mp-generated-url');
        urlInput.select();
        document.execCommand('copy');
        showToast('📋 Link copiado al portapapeles', 'success');
    }

    async function init() {
        window.connectMercadoPago = connectMercadoPago;
        window.disconnectMercadoPago = disconnectMercadoPago;
        window.generatePaymentLink = generatePaymentLink;
        window.copyGeneratedLink = copyGeneratedLink;
        await checkConnection();
    }

    function destroy() {
        delete window.connectMercadoPago;
        delete window.disconnectMercadoPago;
        delete window.generatePaymentLink;
        delete window.copyGeneratedLink;
    }

    return {
        title: 'Mercado Pago',
        getHTML,
        init,
        destroy
    };
})();
