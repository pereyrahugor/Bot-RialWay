/**
 * system-banner.js
 * Banner superior persistente para avisos de sistema, novedades y alertas de errores.
 * No desaparece hasta que el usuario hace clic en "Entendido".
 */
(() => {
    let currentBanner = null;
    let bannerElement = null;

    const ICONS = {
        info: 'fa-rocket',
        update: 'fa-rocket',
        warning: 'fa-triangle-exclamation',
        error: 'fa-circle-exclamation',
        success: 'fa-circle-check'
    };

    const THEMES = {
        info: {
            bg: 'linear-gradient(135deg, rgba(30, 58, 138, 0.95), rgba(59, 130, 246, 0.95))',
            border: 'rgba(96, 165, 250, 0.3)',
            btnBg: '#ffffff',
            btnColor: '#1e3a8a',
            btnHoverBg: '#eff6ff',
            badgeBg: 'rgba(255, 255, 255, 0.2)',
            badgeText: '#ffffff'
        },
        warning: {
            bg: 'linear-gradient(135deg, rgba(146, 64, 14, 0.95), rgba(217, 119, 6, 0.95))',
            border: 'rgba(251, 191, 36, 0.3)',
            btnBg: '#ffffff',
            btnColor: '#92400e',
            btnHoverBg: '#fffbeb',
            badgeBg: 'rgba(0, 0, 0, 0.2)',
            badgeText: '#ffffff'
        },
        error: {
            bg: 'linear-gradient(135deg, rgba(153, 27, 27, 0.96), rgba(225, 29, 72, 0.96))',
            border: 'rgba(248, 113, 113, 0.3)',
            btnBg: '#ffffff',
            btnColor: '#991b1b',
            btnHoverBg: '#fff1f2',
            badgeBg: 'rgba(0, 0, 0, 0.25)',
            badgeText: '#ffffff'
        },
        success: {
            bg: 'linear-gradient(135deg, rgba(6, 95, 70, 0.95), rgba(16, 185, 129, 0.95))',
            border: 'rgba(52, 211, 153, 0.3)',
            btnBg: '#ffffff',
            btnColor: '#065f46',
            btnHoverBg: '#ecfdf5',
            badgeBg: 'rgba(255, 255, 255, 0.2)',
            badgeText: '#ffffff'
        }
    };

    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    async function fetchActiveBanner() {
        try {
            const token = localStorage.getItem('backoffice_token') || '';
            const projectId = window.railwayProjectId || '';
            const query = new URLSearchParams();
            if (token) query.set('token', token);
            if (projectId) query.set('projectId', projectId);

            const res = await fetch(`/api/backoffice/system-banner?${query.toString()}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.banner || null;
        } catch (e) {
            console.warn('[SystemBanner] No se pudo consultar banner de sistema:', e.message);
            return null;
        }
    }

    function isDismissed(bannerId) {
        if (!bannerId) return false;
        return localStorage.getItem(`crm_banner_dismissed_${bannerId}`) === 'true';
    }

    function renderBanner(banner) {
        if (!banner || !banner.id || !banner.active) {
            removeBanner();
            return;
        }

        if (isDismissed(banner.id)) {
            removeBanner();
            return;
        }

        currentBanner = banner;
        const type = (banner.type || 'info').toLowerCase();
        const theme = THEMES[type] || THEMES.info;
        const icon = banner.icon || ICONS[type] || 'fa-bell';
        const title = escapeHtml(banner.title || 'Aviso del Sistema');
        const message = escapeHtml(banner.message || '');
        const badgeLabel = escapeHtml(banner.badge || (type === 'error' ? 'Alerta Crítica' : type === 'warning' ? 'Mantenimiento' : 'Novedad'));

        if (!bannerElement) {
            bannerElement = document.createElement('div');
            bannerElement.id = 'crm-system-banner-root';
            document.body.appendChild(bannerElement);
        }

        bannerElement.innerHTML = `
            <style>
                #crm-system-banner-bar {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    z-index: 99998;
                    background: ${theme.bg};
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border-bottom: 1px solid ${theme.border};
                    color: #ffffff;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
                    padding: 10px 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    animation: crmBannerSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    box-sizing: border-box;
                }

                @keyframes crmBannerSlideDown {
                    from {
                        transform: translateY(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }

                @keyframes crmBannerSlideUp {
                    from {
                        transform: translateY(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateY(-100%);
                        opacity: 0;
                    }
                }

                .crm-banner-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    flex: 1;
                    min-width: 0;
                }

                .crm-banner-icon-badge {
                    width: 36px;
                    height: 36px;
                    border-radius: 10px;
                    background: ${theme.badgeBg};
                    color: ${theme.badgeText};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 1.1rem;
                    flex-shrink: 0;
                    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
                }

                .crm-banner-content {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    min-width: 0;
                }

                .crm-banner-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .crm-banner-tag {
                    font-size: 0.68rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    padding: 2px 7px;
                    border-radius: 9999px;
                    background: rgba(255, 255, 255, 0.22);
                    color: #ffffff;
                }

                .crm-banner-title {
                    font-size: 0.92rem;
                    font-weight: 700;
                    letter-spacing: -0.01em;
                    color: #ffffff;
                    margin: 0;
                }

                .crm-banner-msg {
                    font-size: 0.82rem;
                    color: rgba(255, 255, 255, 0.92);
                    margin: 0;
                    line-height: 1.35;
                    white-space: normal;
                    word-break: break-word;
                }

                .crm-banner-actions {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-shrink: 0;
                }

                .crm-banner-btn-understood {
                    background: ${theme.btnBg};
                    color: ${theme.btnColor};
                    border: none;
                    border-radius: 8px;
                    font-size: 0.82rem;
                    font-weight: 700;
                    padding: 8px 16px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    transition: transform 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
                }

                .crm-banner-btn-understood:hover {
                    background: ${theme.btnHoverBg};
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }

                .crm-banner-btn-understood:active {
                    transform: translateY(0);
                }

                @media (max-width: 640px) {
                    #crm-system-banner-bar {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 10px;
                        padding: 12px;
                    }
                    .crm-banner-actions {
                        width: 100%;
                        justify-content: flex-end;
                    }
                }
            </style>

            <div id="crm-system-banner-bar" role="alert" aria-live="assertive">
                <div class="crm-banner-left">
                    <div class="crm-banner-icon-badge">
                        <i class="fas ${icon}"></i>
                    </div>
                    <div class="crm-banner-content">
                        <div class="crm-banner-header">
                            <span class="crm-banner-tag">${badgeLabel}</span>
                            <span class="crm-banner-title">${title}</span>
                        </div>
                        <p class="crm-banner-msg">${message}</p>
                    </div>
                </div>
                <div class="crm-banner-actions">
                    <button type="button" class="crm-banner-btn-understood" onclick="window.crmSystemBanner.dismiss()">
                        <i class="fas fa-check"></i>
                        <span>Entendido</span>
                    </button>
                </div>
            </div>
        `;
    }

    function removeBanner() {
        const bar = document.getElementById('crm-system-banner-bar');
        if (bar) {
            bar.style.animation = 'crmBannerSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
            setTimeout(() => {
                if (bannerElement && bannerElement.parentNode) {
                    bannerElement.parentNode.removeChild(bannerElement);
                    bannerElement = null;
                }
            }, 300);
        }
    }

    function dismiss() {
        if (currentBanner && currentBanner.id) {
            try {
                localStorage.setItem(`crm_banner_dismissed_${currentBanner.id}`, 'true');
            } catch (e) {
                console.warn('[SystemBanner] No se pudo guardar estado en localStorage:', e);
            }
        }
        removeBanner();
    }

    async function check() {
        const banner = await fetchActiveBanner();
        renderBanner(banner);
    }

    function init() {
        check();

        // Escuchar actualizaciones en tiempo real si el socket está disponible
        const trySetupSocket = () => {
            if (window.io && typeof window.io === 'function' && window._socketInstance) {
                window._socketInstance.on('setting_changed', (payload) => {
                    if (payload && payload.key === 'SYSTEM_BANNER_ALERT') {
                        check();
                    }
                });
            } else if (window.socket) {
                window.socket.on('setting_changed', (payload) => {
                    if (payload && payload.key === 'SYSTEM_BANNER_ALERT') {
                        check();
                    }
                });
            }
        };

        trySetupSocket();
        setTimeout(trySetupSocket, 2000);
    }

    window.crmSystemBanner = {
        init,
        check,
        dismiss,
        show: renderBanner,
        hide: removeBanner
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
