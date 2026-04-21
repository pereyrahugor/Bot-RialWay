/* global logout */
async function fetchStatus() {
    const token = localStorage.getItem('backoffice_token');
    try {
        const res = await fetch(`/api/dashboard-status?token=${token}`);
        if (res.status === 401) return logout();
        const data = await res.json();
        
        const statusEl = document.getElementById('session-status');
        const qrSection = document.getElementById('qr-section');
        const sessionInfo = document.getElementById('session-info');
        const sessionError = document.getElementById('session-error');
        const wsLinkContainer = document.getElementById('whatsapp-link-container');
        const groupContainer = document.getElementById('group-connection-container');
        const groupStatusEl = document.getElementById('group-session-status');

        // Limpiar
        qrSection.style.display = 'none';
        sessionInfo.style.display = 'none';
        wsLinkContainer.style.display = 'none';
        groupContainer.style.display = 'none';
        sessionError.innerHTML = '';
        sessionInfo.innerHTML = '';

        if (!data || !data.adapter) {
            statusEl.textContent = '❌ Error de sistema';
            return;
        }

        // --- MANEJO DEL ADAPTER PRINCIPAL ---
        const isMeta = data.adapter.type === 'meta';
        const hasMetaConfig = data.metaOnboarding && data.metaOnboarding.status === 'active';

        if (isMeta) {
            statusEl.textContent = '✅ Principal: META';
            statusEl.style.color = '#0668E1'; // Azul Meta
            sessionInfo.style.display = 'block';
            
            let extraInfo = '';
            if (data.metaOnboarding.onboarding_data) {
                const { verificationStatus, messagingLimit } = data.metaOnboarding.onboarding_data;
                const vStatusLabel = verificationStatus === 'verified' ? '✅ Verificado' : (verificationStatus === 'not_verified' ? '❌ No Verificado' : `⏳ ${verificationStatus || 'Pendiente'}`);
                extraInfo = `
                    <div class="meta-stats" style="margin-top: 10px; padding: 10px; background: rgba(6, 104, 225, 0.1); border-radius: 8px; border: 1px solid rgba(6, 104, 225, 0.2);">
                        <div style="margin-bottom: 5px;"><strong>Verificación:</strong> ${vStatusLabel}</div>
                        <div><strong>Límite de Mensajes:</strong> <span class="badge" style="background: #0668E1; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem;">${messagingLimit || 'Desconocido'}</span></div>
                    </div>
                `;
            }
            
            sessionInfo.innerHTML = `<div><strong>Configuración:</strong> Meta Cloud API Activa</div>${extraInfo}`;
        } else if (hasMetaConfig) {
            statusEl.textContent = '⏳ Principal: META (En curso)';
            statusEl.style.color = '#f59e0b';
            
            // Mostrar info de por qué no está activo
            const missing = !data.metaOnboarding.access_token ? 'Token' : (!data.metaOnboarding.phone_number_id || data.metaOnboarding.phone_number_id === 'PENDING' ? 'Phone ID' : 'Desconocido');
            sessionInfo.style.display = 'block';
            sessionInfo.innerHTML = `<div class="warning-box">Vinculación de Meta detectada pero incompleta (Falta: ${missing}). Usando Baileys como respaldo.</div>`;
            renderProviderStatus(data.adapter, 'Baileys (Respaldo)');
        } else {
            renderProviderStatus(data.adapter, 'Principal');
        }

        // --- MANEJO DE GRUPOS (SI EXISTE) ---
        if (data.group) {
            groupContainer.style.display = 'block';
            if (data.group.active) {
                groupStatusEl.textContent = '✅ Grupos: Baileys';
                groupStatusEl.style.color = '#10b981';
            } else if (data.group.qr) {
                groupStatusEl.textContent = '⏳ Grupos: Esperando vinculación';
                groupStatusEl.style.color = '#f59e0b';
                
                // Mostrar el QR para los grupos
                qrSection.style.display = 'block';
                const qrImg = document.querySelector('.qr');
                qrImg.src = data.group.qrImage || '/bot.groups.qr.png';
                qrImg.style.display = 'inline-block';
                if (qrImg.nextElementSibling) qrImg.nextElementSibling.style.display = 'none';
            } else {
                groupStatusEl.textContent = '⏳ Grupos: ' + (data.group.message || 'Cargando...');
                groupStatusEl.style.color = '#94a3b8';
            }
        }
    } catch (e) {
        console.error(e);
        document.getElementById('session-status').textContent = 'Error';
        document.getElementById('session-error').innerHTML = `<div class='error-box'>No se pudo obtener el estado del bot.</div>`;
    }
}

function renderProviderStatus(status, label) {
    const statusEl = document.getElementById('session-status');
    const qrSection = document.getElementById('qr-section');
    const sessionInfo = document.getElementById('session-info');

    if (status.active) {
        statusEl.textContent = `✅ ${label}: ${status.message || 'Conectado'}`;
        statusEl.style.color = '#10b981';
        sessionInfo.style.display = 'block';
        sessionInfo.innerHTML += `<div><strong>${label}:</strong> ${status.message || 'Operativo'}</div>`;
    } else if (status.qr) {
        statusEl.textContent = `⏳ ${label}: Esperando vinculación`;
        statusEl.style.color = '#f59e0b';
        qrSection.style.display = 'block';
        
        const qrImg = document.querySelector('.qr');
        qrImg.src = status.qrImage || '/qr.png';
        qrImg.style.display = 'inline-block';
        if (qrImg.nextElementSibling) qrImg.nextElementSibling.style.display = 'none';
    } else {
        statusEl.textContent = `⏳ ${label}: ${status.message || 'Cargando...'}`;
    }
}

// --- MASTER CONTROL LOGIC ---
const botToggle = document.getElementById('global-bot-toggle');
const reloadBtn = document.getElementById('system-reload-btn');

async function fetchBotStatus() {
    try {
        const res = await fetch(`/api/backoffice/settings/bot-status?token=${localStorage.getItem('backoffice_token')}`);
        const data = await res.json();
        if (data.success) {
            botToggle.checked = data.enabled;
        }
    } catch (e) { console.error("Error fetching bot status", e); }
}

if (botToggle) {
    botToggle.addEventListener('change', async () => {
        const enabled = botToggle.checked;
        try {
            await fetch('/api/backoffice/settings/toggle-bot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: localStorage.getItem('backoffice_token'), enabled })
            });
        } catch (e) { 
            alert("Error al cambiar el estado del bot"); 
            botToggle.checked = !enabled;
        }
    });
}

if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
        if (!confirm("¿Estás seguro de que deseas reiniciar el motor del bot? Esto aplicará cambios de Meta y Google Sheets. El servicio estará fuera de línea unos 30-45 segundos.")) return;
        
        reloadBtn.disabled = true;
        reloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reiniciando...';
        
        try {
            const res = await fetch('/api/backoffice/system/restart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: localStorage.getItem('backoffice_token') })
            });
            if (res.ok) {
                alert("Reinicio solicitado con éxito. La página se recargará en 10 segundos.");
                setTimeout(() => window.location.reload(), 10000);
            }
        } catch (e) {
            alert("Error al solicitar el reinicio");
            reloadBtn.disabled = false;
            reloadBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Reiniciar';
        }
    });
}

// Inicializar
fetchBotStatus();
fetchStatus();
setInterval(fetchStatus, 15000);
setInterval(fetchBotStatus, 30000); // Polling lento para el estado del bot

// Redirigir a /webreset al hacer click en el botón de reinicio

// --- REINICIO COMPLETO ---
const goResetBtn = document.getElementById('go-reset');
const resetModal = document.getElementById('resetModal');
const confirmSi = document.getElementById('confirmSi');
const confirmNo = document.getElementById('confirmNo');

if (goResetBtn) {
    goResetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resetModal.classList.remove('hidden');
    });
}

if (confirmNo) {
    confirmNo.addEventListener('click', () => {
        resetModal.classList.add('hidden');
    });
}

if (confirmSi) {
    confirmSi.addEventListener('click', async () => {
        confirmSi.disabled = true;
        confirmSi.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reiniciando...';
        
        try {
            const token = localStorage.getItem('backoffice_token');
            
            // 1. Borrar sesión
            console.log("📡 Borrando sesión...");
            const delRes = await fetch(`/api/delete-session?token=${token}`, { method: 'POST' });
            
            if (!delRes.ok) throw new Error("Error al borrar la sesión en DB");

            // 2. Reiniciar bot
            console.log("📡 Solicitando reinicio de bot en Railway...");
            const restRes = await fetch(`/api/restart-bot?token=${token}`, { method: 'POST' });
            
            if (!restRes.ok) throw new Error("Error al solicitar el reinicio del bot");

            // 3. Éxito
            resetModal.innerHTML = `
                <div class="modal-content">
                    <i class="fas fa-check-circle" style="font-size: 3rem; color: #25d366; margin-bottom: 20px;"></i>
                    <h3>¡Listo!</h3>
                    <p>El bot se está reiniciando. La página se recargará en 5 segundos.</p>
                </div>
            `;
            
            setTimeout(() => {
                window.location.reload();
            }, 5000);

        } catch (err) {
            console.error(err);
            alert("Hubo un error: " + err.message);
            confirmSi.disabled = false;
            confirmSi.innerText = 'SÍ, REINICIAR';
        }
    });
}

