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

        // Limpiar
        qrSection.style.display = 'none';
        sessionInfo.style.display = 'none';
        wsLinkContainer.style.display = 'none';
        sessionError.innerHTML = '';

        if (!data.adapter) {
            statusEl.textContent = '❌ Error de sistema';
            return;
        }

        // Caso 1: Solo Adapter (Modo Estándar Baileys o Meta sin Grupos)
        if (!data.group) {
            renderProviderStatus(data.adapter, 'Principal');
        } 
        // Caso 2: Modo Dual
        else {
            renderProviderStatus(data.adapter, 'Mensajes Privados (Meta)');
            renderProviderStatus(data.group, 'Mensajes de Grupo (Baileys)', true);
        }
    } catch (e) {
        document.getElementById('session-status').textContent = 'Error';
        document.getElementById('session-error').innerHTML = `<div class='error-box'>No se pudo obtener el estado del bot.</div>`;
    }
}

function renderProviderStatus(status, label, isGroup = false) {
    const statusEl = document.getElementById('session-status');
    const qrSection = document.getElementById('qr-section');
    const sessionInfo = document.getElementById('session-info');
    const sessionError = document.getElementById('session-error');

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
        if (status.qrImage) {
            qrImg.src = status.qrImage;
        } else {
            qrImg.src = isGroup ? '/bot.groups.qr.png' : '/qr.png';
        }
        qrImg.style.display = 'inline-block';
        qrImg.nextElementSibling.style.display = 'none';
    } else {
        statusEl.textContent = `⏳ ${label}: ${status.message || 'Cargando...'}`;
    }
}

fetchStatus();
setInterval(fetchStatus, 15000);

// Redirigir a /webreset al hacer click en el botón de reinicio
document.getElementById('go-reset').addEventListener('click', function() {
    window.location.href = '/webreset';
});
