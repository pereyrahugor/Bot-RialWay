async function login() {
    const token = document.getElementById('token').value;
    const errorDiv = document.getElementById('error');
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    
    if (!token) return;

    try {
        // Enviar el token al servidor para validación genérica 
        // (El servidor responderá success si el token coincide con CUALQUIERA de las claves válidas)
        // Pero el cliente guardará el que corresponda
        const response = await fetch('/api/backoffice/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });

        const result = await response.json();
        if (result.success) {
            if (target === 'system-config') {
                localStorage.setItem('system_config_token', token);
                window.location.href = '/system-config';
            } else {
                localStorage.setItem('backoffice_token', token);
                window.location.href = '/backoffice';
            }
        } else {
            errorDiv.innerText = 'Token Inválido';
            errorDiv.style.display = 'block';
        }
    } catch (e) {
        console.error('Error de autenticación:', e);
        errorDiv.innerText = 'Error al conectar con el servidor';
        errorDiv.style.display = 'block';
    }
}

document.getElementById('token')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});
