/* global logout */
let currentProjectId = 'default';

async function fetchStatus() {
    const token = localStorage.getItem('backoffice_token');
    try {
        const res = await fetch(`/api/dashboard-status?token=${token}`);
        if (res.status === 401) return logout();
        const data = await res.json();
        
        if (data && data.metaOnboarding && data.metaOnboarding.project_id) {
            currentProjectId = data.metaOnboarding.project_id;
        }
        
        const statusEl = document.getElementById('session-status');
        const qrSection = document.getElementById('qr-section');
        const sessionInfo = document.getElementById('session-info');
        const sessionError = document.getElementById('session-error');
        const wsLinkContainer = document.getElementById('whatsapp-link-container');
        const groupContainer = document.getElementById('group-connection-container');
        const groupStatusEl = document.getElementById('group-session-status');
        const startContainer = document.getElementById('baileys-start-container');

        // Limpiar
        qrSection.style.display = 'none';
        sessionInfo.style.display = 'none';
        wsLinkContainer.style.display = 'none';
        groupContainer.style.display = 'none';
        if (startContainer) startContainer.style.display = 'none';
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
                const obData = data.metaOnboarding.onboarding_data;
                
                // 1. Número de teléfono
                const phoneDisplay = obData.display_phone_number || data.metaOnboarding.phone_number_id || 'No configurado';
                
                // 2. Nombre verificado (Verified Name)
                const verifiedName = obData.verified_name || 'Sin Nombre de Marca';
                
                // 3. Estado del número de Meta
                const metaStatus = obData.status || 'Desconocido';
                let metaStatusLabel = `<span class="badge" style="background: #94a3b8; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem;">${metaStatus}</span>`;
                if (metaStatus === 'CONNECTED' || metaStatus === 'APPROVED') {
                    metaStatusLabel = `<span class="badge" style="background: #10b981; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem;"><i class="fas fa-circle-check"></i> Conectado</span>`;
                } else if (metaStatus === 'BANNED') {
                    metaStatusLabel = `<span class="badge" style="background: #ef4444; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem;"><i class="fas fa-ban"></i> Baneado / Bloqueado</span>`;
                } else if (metaStatus === 'RESTRICTED' || metaStatus === 'FLAGGED') {
                    metaStatusLabel = `<span class="badge" style="background: #f59e0b; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8rem;"><i class="fas fa-triangle-exclamation"></i> ${metaStatus === 'RESTRICTED' ? 'Restringido' : 'Advertencia'}</span>`;
                }
                
                // 4. Calificación de Calidad (Quality Rating)
                const quality = obData.quality_rating || 'UNKNOWN';
                let qualityLabel = `<span style="font-weight: 600; color: #94a3b8;">⚪ Desconocida</span>`;
                if (quality === 'GREEN') {
                    qualityLabel = `<span style="font-weight: 600; color: #10b981;">🟢 Alta (Verde)</span>`;
                } else if (quality === 'YELLOW') {
                    qualityLabel = `<span style="font-weight: 600; color: #f59e0b;">🟡 Media (Amarillo)</span>`;
                } else if (quality === 'RED') {
                    qualityLabel = `<span style="font-weight: 600; color: #ef4444;">🔴 Baja (Rojo)</span>`;
                }
                
                // 5. Estado de Verificación de Cuenta WABA (Business Verification)
                const verificationStatus = obData.code_verification_status || obData.verificationStatus || 'not_verified';
                const vStatusLabel = (verificationStatus === 'verified' || verificationStatus === 'VERIFIED') 
                    ? '<span style="color: #10b981; font-weight: 600;">✅ Verificado</span>' 
                    : '<span style="color: #ef4444; font-weight: 600;">❌ No Verificado</span>';

                // 6. Revisión de Cuenta Comercial WABA
                const wabaReview = obData.account_review_status || 'UNKNOWN';
                let wabaReviewLabel = `<span style="font-weight: 600; color: #94a3b8;">⏳ Pendiente</span>`;
                if (wabaReview === 'APPROVED') {
                    wabaReviewLabel = `<span style="color: #10b981; font-weight: 600;">✅ Aprobada</span>`;
                } else if (wabaReview === 'REJECTED') {
                    wabaReviewLabel = `<span style="color: #ef4444; font-weight: 600;">❌ Rechazada</span>`;
                } else if (wabaReview === 'NEEDS_COMPLIANCE_REVIEW') {
                    wabaReviewLabel = `<span style="color: #f59e0b; font-weight: 600;">⚠️ Requiere Revisión</span>`;
                }

                // 7. Límite de mensajes salientes (Tier)
                const tier = obData.messaging_limit_tier || obData.messagingLimit || 'Desconocido';
                let tierHuman = tier;
                if (tier === 'TIER_50') tierHuman = '50 conversaciones / 24h';
                else if (tier === 'TIER_250') tierHuman = '250 conversaciones / 24h';
                else if (tier === 'TIER_1K') tierHuman = '1,000 conversaciones / 24h';
                else if (tier === 'TIER_10K') tierHuman = '10,000 conversaciones / 24h';
                else if (tier === 'TIER_100K') tierHuman = '100,000 conversaciones / 24h';
                else if (tier === 'TIER_UNLIMITED') tierHuman = 'Conversaciones Ilimitadas';

                extraInfo = `
                    <div class="meta-stats" style="margin-top: 15px; padding: 15px; background: rgba(6, 104, 225, 0.05); border-radius: 12px; border: 1px solid rgba(6, 104, 225, 0.15); display: flex; flex-direction: column; gap: 10px; text-align: left; font-size: 0.95rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(6, 104, 225, 0.1); padding-bottom: 8px;">
                            <strong>Marca / Nombre:</strong>
                            <span style="font-weight: 600; color: #1e293b;">${verifiedName}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong>Número de Teléfono:</strong>
                            <span style="font-weight: 600; color: #1e293b;">${phoneDisplay}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong>Estado del Canal:</strong>
                            ${metaStatusLabel}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong>Calificación de Calidad:</strong>
                            ${qualityLabel}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong>Verificación del Número:</strong>
                            ${vStatusLabel}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <strong>Revisión de WABA:</strong>
                            ${wabaReviewLabel}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(6, 104, 225, 0.1); padding-top: 8px;">
                            <strong>Límite de Mensajes (Tier):</strong>
                            <span class="badge" style="background: #0668E1; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.85rem; font-weight: 600;">${tierHuman}</span>
                        </div>
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
                if (startContainer) startContainer.style.display = 'none';
            } else if (data.group.qr) {
                groupStatusEl.textContent = '⏳ Grupos: Esperando vinculación';
                groupStatusEl.style.color = '#f59e0b';
                if (startContainer) startContainer.style.display = 'none';
                
                // Mostrar el QR para los grupos
                qrSection.style.display = 'block';
                const qrImg = document.querySelector('.qr');
                qrImg.src = data.group.qrImage || '/bot.groups.qr.png';
                qrImg.style.display = 'inline-block';
                if (qrImg.nextElementSibling) qrImg.nextElementSibling.style.display = 'none';
            } else {
                groupStatusEl.textContent = '⏳ Grupos: ' + (data.group.message || 'Cargando...');
                groupStatusEl.style.color = '#94a3b8';
                
                // Si Meta está activo pero grupos está inactivo, mostrar botón para QR de grupos
                if (startContainer && !data.group.active) {
                    startContainer.style.display = 'block';
                    const btn = document.getElementById('generate-qr-btn');
                    btn.innerHTML = `<i class="fas fa-qrcode"></i> Generar QR Grupos`;
                }
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
    const startContainer = document.getElementById('baileys-start-container');

    if (status.active) {
        statusEl.textContent = `✅ ${label}: ${status.message || 'Conectado'}`;
        statusEl.style.color = '#10b981';
        sessionInfo.style.display = 'block';
        sessionInfo.innerHTML += `<div><strong>${label}:</strong> ${status.message || 'Operativo'}</div>`;
        if (startContainer) startContainer.style.display = 'none';
    } else if (status.qr) {
        statusEl.textContent = `⏳ ${label}: Esperando vinculación`;
        statusEl.style.color = '#f59e0b';
        qrSection.style.display = 'block';
        if (startContainer) startContainer.style.display = 'none';
        
        const qrImg = document.querySelector('.qr');
        qrImg.src = status.qrImage || '/qr.png';
        qrImg.style.display = 'inline-block';
        if (qrImg.nextElementSibling) qrImg.nextElementSibling.style.display = 'none';
    } else {
        statusEl.textContent = `⏳ ${label}: ${status.message || 'Cargando...'}`;
        // Si no está conectado ni tiene QR, está inactivo/desconectado. Mostramos botón para generar QR.
        if (startContainer && !status.active) {
            startContainer.style.display = 'block';
            const btn = document.getElementById('generate-qr-btn');
            btn.innerHTML = `<i class="fas fa-qrcode"></i> Generar QR Baileys`;
        }
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

// --- DESVINCULAR META ---
const goUnlinkBtn = document.getElementById('go-unlink-meta');
const unlinkModal = document.getElementById('unlinkMetaModal');
const confirmUnlinkSi = document.getElementById('confirmUnlinkSi');
const confirmUnlinkNo = document.getElementById('confirmUnlinkNo');

if (goUnlinkBtn) {
    goUnlinkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        unlinkModal.classList.remove('hidden');
    });
}

if (confirmUnlinkNo) {
    confirmUnlinkNo.addEventListener('click', () => {
        unlinkModal.classList.add('hidden');
    });
}

if (confirmUnlinkSi) {
    confirmUnlinkSi.addEventListener('click', async () => {
        confirmUnlinkSi.disabled = true;
        confirmUnlinkSi.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Desvinculando...';
        
        try {
            const token = localStorage.getItem('backoffice_token');
            console.log(`📡 Solicitando desvinculación de Meta para el proyecto: ${currentProjectId}`);
            
            const res = await fetch(`/api/backoffice/whatsapp/unlink-meta?projectId=${currentProjectId}&token=${token}`, {
                method: 'POST'
            });
            
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Error al desvincular de Meta en el servidor");
            }
            
            // Éxito
            unlinkModal.innerHTML = `
                <div class="modal-content" style="border-top: 5px solid #25d366;">
                    <i class="fas fa-check-circle" style="font-size: 3rem; color: #25d366; margin-bottom: 20px;"></i>
                    <h3>¡Listo!</h3>
                    <p>La desvinculación se completó correctamente. El bot se está reiniciando y la página se recargará en 5 segundos.</p>
                </div>
            `;
            
            setTimeout(() => {
                window.location.reload();
            }, 5000);
            
        } catch (err) {
            console.error(err);
            alert("Hubo un error al desvincular Meta: " + err.message);
            confirmUnlinkSi.disabled = false;
            confirmUnlinkSi.innerText = 'SÍ, DESVINCULAR';
        }
    });
}

// --- LOGIC TO GENERATE QR MANUALLY ---
const generateQrBtn = document.getElementById('generate-qr-btn');
if (generateQrBtn) {
    generateQrBtn.addEventListener('click', async () => {
        const isGroup = !!document.getElementById('group-connection-container').style.display && 
                        document.getElementById('group-connection-container').style.display !== 'none' &&
                        document.getElementById('generate-qr-btn').textContent.includes('Grupos');
        
        generateQrBtn.style.display = 'none';
        document.getElementById('generate-qr-loading').style.display = 'block';
        
        try {
            const token = localStorage.getItem('backoffice_token');
            const res = await fetch(`/api/backoffice/baileys/start?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isGroup })
            });
            
            if (res.ok) {
                // Sincronizar de inmediato tras una pausa de inicio
                setTimeout(fetchStatus, 1500);
            } else {
                const err = await res.json();
                alert('Error al iniciar generador de QR: ' + (err.error || 'error desconocido'));
                generateQrBtn.style.display = 'inline-flex';
                document.getElementById('generate-qr-loading').style.display = 'none';
            }
        } catch (e) {
            console.error(e);
            alert('Error al iniciar generador de QR');
            generateQrBtn.style.display = 'inline-flex';
            document.getElementById('generate-qr-loading').style.display = 'none';
        }
    });
}

