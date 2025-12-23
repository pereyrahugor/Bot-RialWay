async function fetchStatus() {
    try {
        const res = await fetch('/api/dashboard-status');
        const data = await res.json();
        
        const statusEl = document.getElementById('session-status');
        const qrSection = document.getElementById('qr-section');
        const sessionInfo = document.getElementById('session-info');
        const sessionError = document.getElementById('session-error');

        if (data.active) {
            qrSection.style.display = 'none';
            sessionInfo.style.display = '';
            
            if (data.source === 'database') {
                statusEl.textContent = '⏳ Restaurando desde Nube...';
                sessionInfo.textContent = data.message || 'Se encontró una sesión en la base de datos. El bot la está descargando, por favor espera...';
                sessionInfo.style.color = '#ffc107'; // Amarillo/Naranja para indicar espera
            } else {
                statusEl.textContent = '✅ Activa (Archivos encontrados)';
                sessionInfo.textContent = 'El bot está conectado y operativo. Si WhatsApp no responde, usa la opción de reinicio abajo.';
                sessionInfo.style.color = ''; // Reset color
            }
        } else {
            statusEl.textContent = '⏳ Esperando Escaneo';
            qrSection.style.display = '';
            sessionInfo.style.display = 'none';
            
            // Intentar recargar el QR si no se ha cargado
            const qrImg = document.querySelector('.qr');
            qrImg.src = '/qr.png?t=' + Date.now();
            qrImg.style.display = 'inline-block';
            qrImg.nextElementSibling.style.display = 'none';
        }

        if (data.error) {
            sessionError.innerHTML = `<div class='error-box'>⚠️ Error al verificar sesión: ${data.error}</div>`;
        } else {
            sessionError.innerHTML = '';
        }
    } catch (e) {
        document.getElementById('session-status').textContent = 'Error';
        document.getElementById('session-error').innerHTML = `<div class='error-box'>No se pudo obtener el estado del bot.</div>`;
    }
}
fetchStatus();
setInterval(fetchStatus, 10000);

// Redirigir a /webreset al hacer click en el botón de reinicio
document.getElementById('go-reset').addEventListener('click', function() {
    window.location.href = '/webreset';
});
