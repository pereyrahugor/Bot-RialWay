async function login() {
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    const errorDiv = document.getElementById('error');
    const urlParams = new URLSearchParams(window.location.search);
    const target = urlParams.get('target');
    
    if (!user || !pass) return;

    try {
        const response = await fetch('/api/backoffice/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });

        const result = await response.json();
        if (result.success) {
            const token = pass; // Usamos pass como token para middleware
            if (target === 'system-config') {
                localStorage.setItem('system_config_token', token);
                window.location.href = '/system-config';
            } else {
                localStorage.setItem('backoffice_token', token);
                window.location.href = '/backoffice';
            }
        } else {
            errorDiv.innerText = 'Usuario o Contraseña Inválidos';
            errorDiv.style.display = 'block';
        }
    } catch (e) {
        console.error('Error de autenticación:', e);
        errorDiv.innerText = 'Error al conectar con el servidor';
        errorDiv.style.display = 'block';
    }
}

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});
