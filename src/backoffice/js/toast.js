(function () {
    const ICONS = {
        success: 'fa-check',
        error:   'fa-xmark',
        warning: 'fa-exclamation',
        info:    'fa-info'
    };
    const DURATIONS = { success: 2500, info: 2800, warning: 3500, error: 4000 };

    // --- SISTEMA DE REPORTE GLOBAL DE ERRORES (SAFE GUARDED) ---
    const _errorCache = new Set();
    let _isReporting = false;

    function reportGlobalError(message, details = {}) {
        if (_isReporting) return;
        try {
            const msgStr = typeof message === 'string' ? message : JSON.stringify(message || 'Error desconocido');
            if (_errorCache.has(msgStr)) return;
            _errorCache.add(msgStr);
            setTimeout(() => _errorCache.delete(msgStr), 5000); // Evitar duplicados en un lapso de 5 segundos

            _isReporting = true;
            setTimeout(() => {
                try {
                    const token = localStorage.getItem('backoffice_token') || '';
                    const user = localStorage.getItem('user_name') || localStorage.getItem('user_id') || 'Cliente Web';
                    fetch('/api/backoffice/log-error?token=' + token, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: msgStr,
                            clientId: user,
                            details: details
                        })
                    }).catch(() => {}); // Consumir error silenciosamente si falla la red
                } catch (err) {} finally {
                    _isReporting = false;
                }
            }, 0);
        } catch (e) {
            _isReporting = false;
        }
    }

    // 1. Interceptar console.error
    const origConsoleError = console.error;
    console.error = function (...args) {
        origConsoleError.apply(console, args);
        try {
            const msg = args.map(arg => (typeof arg === 'object' && arg ? (arg.message || JSON.stringify(arg)) : String(arg))).join(' ');
            reportGlobalError(msg, { source: 'console.error', args });
        } catch (e) {}
    };

    // 2. Interceptar window.onerror
    const origOnError = window.onerror;
    window.onerror = function (msg, url, line, col, error) {
        if (origOnError) origOnError(msg, url, line, col, error);
        reportGlobalError(msg, { source: 'window.onerror', url, line, col, stack: error ? error.stack : null });
        return false;
    };

    // 3. Interceptar unhandledrejection
    window.addEventListener('unhandledrejection', function (event) {
        const reason = event.reason;
        const msg = reason ? (reason.message || typeof reason === 'string' ? reason : JSON.stringify(reason)) : 'Unhandled Promise Rejection';
        reportGlobalError(msg, { source: 'unhandledrejection', reason });
    });

    function getContainer() {
        let c = document.getElementById('toast-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toast-container';
            c.className = 'toast-container';
            document.body.appendChild(c);
        }
        return c;
    }

    function dismiss(el) {
        el.classList.remove('toast-show');
        el.classList.add('toast-hide');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }

    window.showToast = function (message, type) {
        type = type || 'success';
        const el = document.createElement('div');
        el.className = 'toast toast-' + type;
        el.innerHTML =
            '<span class="toast-icon"><i class="fas ' + (ICONS[type] || ICONS.success) + '"></i></span>' +
            '<span class="toast-msg">' + message + '</span>' +
            '<button class="toast-close" aria-label="Cerrar"><i class="fas fa-times"></i></button>';

        el.querySelector('.toast-close').addEventListener('click', function () { dismiss(el); });
        getContainer().appendChild(el);

        requestAnimationFrame(function () {
            requestAnimationFrame(function () { el.classList.add('toast-show'); });
        });

        if (type === 'error') {
            reportGlobalError(message, { source: 'showToast' });
        }

        setTimeout(function () { dismiss(el); }, DURATIONS[type] || 2500);
    };
})();
