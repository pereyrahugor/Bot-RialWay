async function fetchStatus() {
    try {
        const res = await fetch('/api/dashboard-status');
        const data = await res.json();

        if (data.error) {
            console.error('Error status:', data.error);
            return;
        }

        // 1. Renderizar YCLOUD
        const ystatusEl = document.getElementById('ycloud-status');
        const yinfoEl = document.getElementById('ycloud-info');
        const ylinkCont = document.getElementById('ycloud-link-container');
        const ylink = document.getElementById('ycloud-link');

        if (data.ycloud.active) {
            ystatusEl.textContent = '✅ Conectado (API)';
            ystatusEl.style.color = '#28a745';
            yinfoEl.textContent = `La API Oficial está operativa con el número ${data.ycloud.phoneNumber}.`;
            if (data.ycloud.phoneNumber) {
                ylinkCont.style.display = 'block';
                ylink.href = `https://wa.me/${data.ycloud.phoneNumber}`;
            }
        } else {
            ystatusEl.textContent = '❌ Error de Configuración';
            ystatusEl.style.color = '#dc3545';
            yinfoEl.textContent = 'Verifica YCLOUD_API_KEY y YCLOUD_WABA_NUMBER en tu .env';
            ylinkCont.style.display = 'none';
        }

        // 2. Renderizar GROUPS (Baileys)
        const gstatusEl = document.getElementById('groups-status');
        const ginfoEl = document.getElementById('groups-info');
        const gqrSection = document.getElementById('groups-qr-section');

        if (data.groups.active) {
            gstatusEl.textContent = '✅ Conectado';
            gstatusEl.style.color = '#28a745';
            ginfoEl.style.display = 'block';
            ginfoEl.textContent = `Motor de grupos activo (${data.groups.phoneNumber || 'Sincronizado'}).`;
            gqrSection.style.display = 'none';
        } else {
            if (data.groups.source === 'local') {
                gstatusEl.textContent = '⏳ Conectando...';
                gstatusEl.style.color = '#ffc107';
                ginfoEl.style.display = 'block';
                ginfoEl.textContent = 'Sesión local detectada. Intentando conectar...';
                gqrSection.style.display = 'none';
            } else if (data.groups.hasRemote && data.groups.source === 'none') {
                gstatusEl.textContent = '📥 Restaurando...';
                gstatusEl.style.color = '#ffc107';
                ginfoEl.style.display = 'block';
                ginfoEl.textContent = 'Restaurando sesión desde la nube...';
                gqrSection.style.display = 'none';
            } else {
                gstatusEl.textContent = '⏳ Esperando QR';
                gstatusEl.style.color = '#6c757d';
                gqrSection.style.display = 'block';
                ginfoEl.style.display = 'none';

                // Recargar QR de grupos
                const qrImg = gqrSection.querySelector('.qr');
                qrImg.src = '/qr-groups.png?t=' + Date.now();
                qrImg.style.display = 'inline-block';
                if (qrImg.nextElementSibling) qrImg.nextElementSibling.style.display = 'none';
            }
        }

    } catch (e) {
        console.error('Error fetching status:', e);
    }
}
fetchStatus();
setInterval(fetchStatus, 10000);

// Redirigir a /webreset al hacer click en el botón de reinicio
document.getElementById('go-reset').addEventListener('click', function () {
    window.location.href = '/webreset';
});
