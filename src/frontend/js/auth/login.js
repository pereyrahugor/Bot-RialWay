const DEMO_BASE_URL = 'https://crm-neurolinks-test-demo.up.railway.app';
const DEMO_HOSTNAME = 'crm-neurolinks-test-demo.up.railway.app';

const REMEMBER_LOGIN_KEY = 'backoffice_remember_login';
const REMEMBER_USER_KEY = 'backoffice_remember_user';
const REMEMBER_PASS_KEY = 'backoffice_remember_pass';

function clearRememberedLogin() {
    localStorage.removeItem(REMEMBER_LOGIN_KEY);
    localStorage.removeItem(REMEMBER_USER_KEY);
    localStorage.removeItem(REMEMBER_PASS_KEY);
}

function saveRememberedLogin(user, pass) {
    localStorage.setItem(REMEMBER_LOGIN_KEY, 'true');
    localStorage.setItem(REMEMBER_USER_KEY, user || '');
    localStorage.setItem(REMEMBER_PASS_KEY, pass || '');
}

function initLoginHelpers() {
    const userInput = document.getElementById('user');
    const passInput = document.getElementById('pass');
    const rememberInput = document.getElementById('remember-login');
    const toggleButton = document.getElementById('toggle-password-visibility');

    if (localStorage.getItem(REMEMBER_LOGIN_KEY) === 'true') {
        if (userInput) userInput.value = localStorage.getItem(REMEMBER_USER_KEY) || '';
        if (passInput) passInput.value = localStorage.getItem(REMEMBER_PASS_KEY) || '';
        if (rememberInput) rememberInput.checked = true;
    }

    if (rememberInput) {
        rememberInput.addEventListener('change', () => {
            if (!rememberInput.checked) clearRememberedLogin();
        });
    }

    if (toggleButton && passInput) {
        toggleButton.addEventListener('click', () => {
            const shouldShow = passInput.type === 'password';
            passInput.type = shouldShow ? 'text' : 'password';
            toggleButton.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
            toggleButton.setAttribute('aria-label', shouldShow ? 'Ocultar contrase\u00f1a' : 'Mostrar contrase\u00f1a');
            const icon = toggleButton.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-eye', shouldShow);
                icon.classList.toggle('fa-eye-slash', !shouldShow);
            }
            passInput.focus();
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === 'true') {
        const errorDiv = document.getElementById('error');
        if (errorDiv) {
            errorDiv.innerText = 'Iniciando sesión en entorno demo...';
            errorDiv.style.display = 'block';
            errorDiv.style.color = '#818cf8';
        }
        const target = urlParams.get('target') || 'dashboard';
        loginDemo(target);
    }
}

function loginDemo(target = 'dashboard') {
    const isDemoHost = window.location.hostname === DEMO_HOSTNAME;
    if (!isDemoHost) {
        window.location.href = `${DEMO_BASE_URL}/login?demo=true&target=${encodeURIComponent(target)}`;
        return;
    }

    const userInput = document.getElementById('user');
    const passInput = document.getElementById('pass');
    if (userInput) userInput.value = 'TestIngMate';
    if (passInput) passInput.value = 'IngMateUndav';
    setTimeout(() => login(target), 150);
}

async function login(forcedTarget) {
    const user = document.getElementById('user').value;
    const pass = document.getElementById('pass').value;
    const errorDiv = document.getElementById('error');
    const urlParams = new URLSearchParams(window.location.search);
    const target = forcedTarget || urlParams.get('target');
    
    // Solo requerimos contraseña para permitir usuario vacío (Master Override)
    if (!pass) return;

    try {
        const response = await fetch('/api/backoffice/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, pass })
        });

        const result = await response.json();
        if (result.success) {
            const token = result.token; // Usamos el token devuelto por el servidor
            const rememberInput = document.getElementById('remember-login');
            if (rememberInput && rememberInput.checked) {
                saveRememberedLogin(user, pass);
            } else {
                clearRememberedLogin();
            }
            const isSuperAdmin = result.isSuperAdmin === true || result.is_superadmin === true;
            localStorage.setItem('user_role', result.role || 'subuser');
            localStorage.setItem('user_id', result.userId || '');
            localStorage.setItem('user_name', result.user || user);
            if (result.email) {
                localStorage.setItem('user_email', result.email);
            } else {
                localStorage.removeItem('user_email');
            }
            localStorage.setItem('is_superadmin', isSuperAdmin ? 'true' : 'false');

            if (target === 'system-config') {
                if (!isSuperAdmin) {
                    errorDiv.innerText = 'Solo el administrador maestro tiene acceso a esta sección';
                    errorDiv.style.display = 'block';
                    return;
                }
                localStorage.setItem('system_config_token', token);
                window.location.href = '/system-config';
            } else if (target === 'dashboard' || target === '/dashboard') {
                localStorage.setItem('backoffice_token', token);
                if (isSuperAdmin) {
                    localStorage.setItem('system_config_token', token);
                } else {
                    localStorage.removeItem('system_config_token');
                }
                window.location.href = '/dashboard';
            } else if (target) {
                localStorage.setItem('backoffice_token', token);
                if (isSuperAdmin) {
                    localStorage.setItem('system_config_token', token);
                } else {
                    localStorage.removeItem('system_config_token');
                }
                window.location.href = target.startsWith('/') ? target : `/${target}`;
            } else {
                localStorage.setItem('backoffice_token', token);
                if (isSuperAdmin) {
                    localStorage.setItem('system_config_token', token);
                } else {
                    localStorage.removeItem('system_config_token');
                }
                window.location.href = '/conversaciones';
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

document.addEventListener('DOMContentLoaded', initLoginHelpers);

document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});
