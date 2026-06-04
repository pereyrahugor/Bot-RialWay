(function () {
    const ICONS = {
        success: 'fa-check',
        error:   'fa-xmark',
        warning: 'fa-exclamation',
        info:    'fa-info'
    };
    const DURATIONS = { success: 2500, info: 2800, warning: 3500, error: 4000 };

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

        setTimeout(function () { dismiss(el); }, DURATIONS[type] || 2500);
    };
})();
