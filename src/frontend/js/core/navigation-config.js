/* global navigate */
(function () {
    const APP_ROUTES = {
        '/conversaciones': '/js/backoffice/backoffice.view.js',
        '/contactos': '/js/contactos/contactos.view.js',
        '/dashboard': '/js/dashboard/dashboard.view.js',
        '/conexion-chatbot': '/js/conexion/conexion.view.js',
        '/conexion': '/js/conexion/conexion.view.js',
        '/crm': '/js/crm/crm.view.js',
        '/crm-tareas': '/js/crm/crm-tareas.view.js',
        '/system-config': '/js/system-config/system-config.view.js',
        '/docs': '/js/docs/docs.view.js',
        '/documentacion': '/js/docs/docs.view.js',
        '/webchat': '/js/webchat/webchat.view.js',
        '/meta': '/js/meta/meta.view.js',
        '/database': '/js/database/database.view.js',
        '/mercado-libre': '/js/mercado-libre/mercado-libre.view.js',
        '/mercado-libre-productos': '/js/mercado-libre/mercado-libre-productos.view.js',
        '/mercado-libre-bot': '/js/mercado-libre/mercado-libre-bot.view.js',
        '/mercado-pago': '/js/mercado-libre/mercado-pago.view.js',
        '/lista-negra': '/js/lista-negra/lista-negra.view.js',
        '/reportes': '/js/reportes/reportes.view.js',
        '/usuarios': '/js/usuarios/usuarios.view.js',
        '/webhooks': '/js/webhook-config/webhook-config.view.js',
        '/epc-cbu-cvu': '/js/epc-cbu-cvu/epc-cbu-cvu.view.js',
        // Agregar futuras rutas aca abajo. Lo consumo statics.routes.ts luego.
    };

    const SECTION_TAB_CONFIG = {
        messaging: [
            { label: 'Dashboard', icon: 'fas fa-chart-simple', route: '/dashboard' },
            { label: 'Conversaciones', icon: 'fas fa-comments', route: '/conversaciones', dotId: 'dot-conversaciones', requires: 'backoffice' },
            { label: 'Contactos', icon: 'fas fa-user-group', route: '/contactos', requires: 'backoffice' },
            { label: 'Reportes', icon: 'fas fa-file-lines', route: '/reportes', dotId: 'dot-reportes' },
            { label: 'Conexión & Chatbot', icon: 'fas fa-plug-circle-bolt', route: '/conexion-chatbot', matchRoutes: ['/conexion', '/conexion-chatbot'] },
            { label: 'Webchat', icon: 'fas fa-headset', route: '/webchat', requires: 'backoffice' },
        ],
        integrations: [
            { label: 'CRM & Tareas', icon: 'fas fa-id-card-clip', route: '/crm', matchRoutes: ['/crm-tareas'], dotId: 'dot-crm', requires: 'crm' },
            { label: 'Plantillas Meta', icon: 'fab fa-meta', route: '/meta', requires: 'backoffice' },
            { label: 'Base de Datos', icon: 'fas fa-database', route: '/database' },
            {
                label: 'Mercado Libre',
                icon: 'fas fa-handshake',
                route: '/mercado-libre-productos',
                matchRoutes: ['/mercado-libre', '/mercado-libre-productos', '/mercado-libre-bot', '/mercado-pago'],
                children: [
                    { label: 'Productos', icon: 'fas fa-boxes', route: '/mercado-libre-productos' },
                    { label: 'Bot', icon: 'fas fa-robot', route: '/mercado-libre-bot' },
                    { label: 'Mercado Pago', icon: 'fas fa-wallet', route: '/mercado-pago' },
                ],
            },
            { label: 'Lista Negra', icon: 'fas fa-ban', route: '/lista-negra' },
            { label: 'Webhooks', icon: 'fas fa-satellite-dish', route: '/webhooks' },
            { label: 'CBU/CVU EPC', icon: 'fas fa-building-columns', route: '/epc-cbu-cvu', requires: 'epc' },
        ],
    };

    function sectionTabVisible(tab) {
        if (tab.requires === 'backoffice') return window.__BACKOFFICE_VISIBLE !== false;
        if (tab.requires === 'crm') return window.__CRM_VISIBLE !== false;
        if (tab.requires === 'system_config') return localStorage.getItem('is_superadmin') === 'true';
        if (tab.requires === 'epc') return window.__EPC_VISIBLE === true;
        return true;
    }

    function isConversationsPath(value) {
        return value === '/conversaciones';
    }

    function sectionTabActive(tab, path, params) {
        if (tab.activePanel) return isConversationsPath(path) && params.get('openPanel') === tab.activePanel;
        if (Array.isArray(tab.matchRoutes) && tab.matchRoutes.includes(path)) return true;
        if (!tab.route) return false;
        if (tab.route === '/docs') return path === '/docs' || path === '/documentacion';
        if (isConversationsPath(tab.route)) return isConversationsPath(path) && !params.get('openPanel');
        return tab.route === path;
    }

    function sectionTabAriaLabel(section) {
        if (section === 'messaging') return 'Gestion';
        if (section === 'integrations') return 'Integraciones';
        if (section === 'settings') return 'Ajustes';
        return 'Seccion';
    }

    function getSectionTabMenuHost() {
        let host = document.getElementById('section-tab-menu-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'section-tab-menu-host';
            document.body.appendChild(host);
        }
        return host;
    }

    function projectInitials(name) {
        const cleanName = String(name || '').replace(/{{|}}/g, '').trim();
        const words = cleanName
            .split(/[^A-Za-z0-9]+/)
            .map(word => word.trim())
            .filter(Boolean);
        const relevantWords = words.filter(word => !['bot', 'railway'].includes(word.toLowerCase()));
        const source = relevantWords.length ? relevantWords : words;
        const initials = source.slice(0, 2).map(word => word.charAt(0).toUpperCase()).join('');
        return initials || 'NL';
    }

    function initSideMenuProjectAvatar() {
        const avatar = document.getElementById('sidemenu-project-avatar');
        const mobileAvatar = document.getElementById('mobile-user-avatar');
        const source = avatar || mobileAvatar;
        if (!source) return;
        const name = source.dataset?.projectName || source.textContent || window.PROJECT_NAME || window.BOT_NAME || '';
        const initials = projectInitials(name);
        if (avatar) avatar.textContent = initials;
        if (mobileAvatar) mobileAvatar.textContent = initials;
    }

    function setAccountIdentifiers(visible, projectId = '', serviceId = '') {
        ['desktop', 'mobile'].forEach((scope) => {
            const wrapper = document.getElementById(`${scope}-account-identifiers`);
            const projectValue = document.getElementById(`${scope}-account-project-id`);
            const serviceValue = document.getElementById(`${scope}-account-service-id`);
            const projectButton = document.getElementById(`${scope}-account-project-id-copy`);
            const serviceButton = document.getElementById(`${scope}-account-service-id-copy`);
            const shouldShow = visible && (projectId || serviceId);

            if (wrapper) wrapper.hidden = !shouldShow;
            if (projectValue) projectValue.textContent = projectId || '-';
            if (serviceValue) serviceValue.textContent = serviceId || '-';
            if (projectButton) {
                projectButton.dataset.copyValue = projectId || '';
                projectButton.disabled = !projectId;
            }
            if (serviceButton) {
                serviceButton.dataset.copyValue = serviceId || '';
                serviceButton.disabled = !serviceId;
            }
        });
    }

    async function copyTextToClipboard(value) {
        if (!value) return false;
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        return copied;
    }

    window.copyAccountIdentifier = async function (event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        const button = event?.currentTarget;
        const value = button?.dataset?.copyValue || '';
        const label = button?.dataset?.copyLabel || 'ID';
        const copied = await copyTextToClipboard(value);

        if (copied) {
            if (typeof window.showToast === 'function') {
                window.showToast(`${label} copiado`, 'success');
            } else if (window.Swal) {
                window.Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: `${label} copiado`,
                    showConfirmButton: false,
                    timer: 1400
                });
            }
        }
    };

    async function initSideMenuUserEmail() {
        const label = document.getElementById('sidemenu-user-email');
        const detailProject = document.getElementById('desktop-account-detail-project');
        const detailAvatar = document.getElementById('desktop-account-detail-avatar');
        const mobileDetailProject = document.getElementById('mobile-account-detail-project');
        const mobileDetailAvatar = document.getElementById('mobile-account-detail-avatar');
        const detailName = document.getElementById('desktop-account-detail-name');
        const detailEmail = document.getElementById('desktop-account-detail-email');
        const detailPlan = document.getElementById('desktop-account-detail-plan');
        const mobileDetailName = document.getElementById('mobile-account-detail-name');
        const mobileDetailEmail = document.getElementById('mobile-account-detail-email');
        const mobileDetailPlan = document.getElementById('mobile-account-detail-plan');
        if (!label && !detailAvatar && !detailName && !detailEmail && !detailPlan) return;

        const sidemenuAvatar = document.getElementById('sidemenu-project-avatar');
        const mobileAvatar = document.getElementById('mobile-user-avatar');
        const projectAvatarName =
            sidemenuAvatar?.dataset?.projectName ||
            mobileAvatar?.dataset?.projectName ||
            window.PROJECT_NAME ||
            window.BOT_NAME ||
            'Neurolinks';
        const projectAvatarInitials = projectInitials(projectAvatarName);
        const storedEmail = localStorage.getItem('user_email');
        const storedUser = localStorage.getItem('user_name');
        const storedPlan = localStorage.getItem('user_plan_tipo');
        const initialEmail = storedEmail || storedUser || '';
        if (label) label.textContent = initialEmail;
        if (detailProject) detailProject.textContent = window.BOT_NAME || 'Neurolinks';
        if (mobileDetailProject) mobileDetailProject.textContent = window.BOT_NAME || 'Neurolinks';
        if (detailAvatar) detailAvatar.textContent = projectAvatarInitials;
        if (mobileDetailAvatar) mobileDetailAvatar.textContent = projectAvatarInitials;
        if (detailName) detailName.textContent = storedUser || 'Usuario';
        if (detailEmail) detailEmail.textContent = initialEmail;
        if (detailPlan) detailPlan.textContent = storedPlan || 'Sin plan';
        if (mobileDetailName) mobileDetailName.textContent = storedUser || 'Usuario';
        if (mobileDetailEmail) mobileDetailEmail.textContent = initialEmail;
        if (mobileDetailPlan) mobileDetailPlan.textContent = storedPlan || 'Sin plan';
        setAccountIdentifiers(false);

        const token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token');
        if (!token) return;

        try {
            const response = await fetch(`/api/backoffice/me?token=${encodeURIComponent(token)}`);
            const data = await response.json();
            const email = data?.email || storedEmail || storedUser || '';
            const name = data?.nombre || storedUser || 'Usuario';
            const plan = data?.plan_tipo || storedPlan || 'Sin plan';
            if (label) label.textContent = email;
            if (detailAvatar) detailAvatar.textContent = projectAvatarInitials;
            if (mobileDetailAvatar) mobileDetailAvatar.textContent = projectAvatarInitials;
            if (detailName) detailName.textContent = name;
            if (detailEmail) detailEmail.textContent = email;
            if (detailPlan) detailPlan.textContent = plan;
            if (mobileDetailName) mobileDetailName.textContent = name;
            if (mobileDetailEmail) mobileDetailEmail.textContent = email;
            if (mobileDetailPlan) mobileDetailPlan.textContent = plan;
            setAccountIdentifiers(
                data?.isSuperAdmin === true,
                data?.project_id || data?.projectId || '',
                data?.service_id || data?.serviceId || ''
            );
            if (data?.email) localStorage.setItem('user_email', data.email);
            if (data?.nombre) localStorage.setItem('user_name', data.nombre);
            if (data?.plan_tipo) localStorage.setItem('user_plan_tipo', data.plan_tipo);
            if (data?.isSuperAdmin === true) {
                localStorage.setItem('is_superadmin', 'true');
                localStorage.setItem('system_config_token', token);
                updateSystemConfigNavVisibility();
            }
        } catch (err) {
            if (label) label.textContent = initialEmail;
            if (detailAvatar) detailAvatar.textContent = projectAvatarInitials;
            if (mobileDetailAvatar) mobileDetailAvatar.textContent = projectAvatarInitials;
                if (detailName) detailName.textContent = storedUser || 'Usuario';
            if (detailEmail) detailEmail.textContent = initialEmail;
            if (detailPlan) detailPlan.textContent = storedPlan || 'Sin plan';
            if (mobileDetailName) mobileDetailName.textContent = storedUser || 'Usuario';
            if (mobileDetailEmail) mobileDetailEmail.textContent = initialEmail;
            if (mobileDetailPlan) mobileDetailPlan.textContent = storedPlan || 'Sin plan';
            setAccountIdentifiers(false);
        }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        }[char]));
    }

    function closeDesktopLineMenu() {
        const menu = document.getElementById('desktop-line-menu');
        const button = document.getElementById('desktop-line-selector-btn');
        if (menu) menu.classList.remove('open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    let sideMenuCollapseTimer = null;

    function getSideMenuElement() {
        return document.getElementById('sidemenu');
    }

    function isMobileSideMenuViewport() {
        return window.matchMedia('(max-width: 1024px)').matches;
    }

    function closeSideMenuFlyouts(exceptDetails = null) {
        const sidemenu = getSideMenuElement();
        if (!sidemenu) return;
        sidemenu.querySelectorAll('.app-sidemenu-details[open]').forEach(details => {
            if (details !== exceptDetails && (!exceptDetails || !details.contains(exceptDetails))) details.open = false;
        });
    }

    function positionSideMenuFlyout(details) {
        const sidemenu = getSideMenuElement();
        const summary = details?.querySelector(':scope > .app-sidemenu-summary');
        const sublist = details?.querySelector(':scope > .app-sidemenu-sublist');
        if (!sidemenu || !summary || !sublist) return;

        const summaryRect = summary.getBoundingClientRect();
        const contentRect = sidemenu.querySelector('.app-sidemenu-content')?.getBoundingClientRect() || sidemenu.getBoundingClientRect();
        const parentFlyout = details.parentElement?.closest('.app-sidemenu-sublist');
        const width = sublist.offsetWidth || 220;
        const height = sublist.offsetHeight || 120;
        const desiredLeft = parentFlyout ? summaryRect.right : contentRect.right;
        const maxLeft = Math.max(8, window.innerWidth - width - 8);
        const maxTop = Math.max(8, window.innerHeight - height - 8);
        const left = Math.min(Math.max(8, desiredLeft), maxLeft);
        const top = Math.min(Math.max(8, summaryRect.top), maxTop);

        sublist.style.setProperty('--sidemenu-flyout-left', `${Math.round(left)}px`);
        sublist.style.setProperty('--sidemenu-flyout-top', `${Math.round(top)}px`);
    }

    function positionOpenSideMenuFlyouts() {
        document.querySelectorAll('#sidemenu .app-sidemenu-details[open]').forEach(positionSideMenuFlyout);
    }

    function setSideMenuExpanded(expanded) {
        const sidemenu = getSideMenuElement();
        if (!sidemenu) return;
        window.clearTimeout(sideMenuCollapseTimer);
        sidemenu.classList.toggle('is-expanded', expanded);
        if (expanded) {
            window.requestAnimationFrame(positionOpenSideMenuFlyouts);
            return;
        }
        closeDesktopLineMenu();
        closeDesktopAccountMenu();
        closeMobileAccountMenu();
        closeSideMenuFlyouts();
    }

    function closeMobileSideMenu(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const sidemenu = getSideMenuElement();
        const button = document.getElementById('mobile-sidemenu-toggle');
        document.body.classList.remove('mobile-sidemenu-open');
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.setAttribute('aria-label', 'Abrir menu');
            const icon = button.querySelector('i');
            if (icon) icon.className = 'fas fa-bars';
        }
        if (sidemenu && isMobileSideMenuViewport()) {
            sidemenu.classList.remove('is-expanded');
        }
        closeDesktopLineMenu();
        closeDesktopAccountMenu();
        closeMobileAccountMenu();
        closeSideMenuFlyouts();
    }

    function openMobileSideMenu(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        closeMobileAccountMenu();
        const sidemenu = getSideMenuElement();
        const button = document.getElementById('mobile-sidemenu-toggle');
        document.body.classList.add('mobile-sidemenu-open');
        if (button) {
            button.setAttribute('aria-expanded', 'true');
            button.setAttribute('aria-label', 'Cerrar menu');
            const icon = button.querySelector('i');
            if (icon) icon.className = 'fas fa-times';
        }
        if (sidemenu) sidemenu.classList.add('is-expanded');
    }

    function toggleMobileSideMenu(e) {
        if (document.body.classList.contains('mobile-sidemenu-open')) {
            closeMobileSideMenu(e);
            return;
        }
        openMobileSideMenu(e);
    }

    function navigateFromSideMenu(route) {
        if (isMobileSideMenuViewport()) closeMobileSideMenu();
        navigate(route);
    }

    function initSideMenuController() {
        const sidemenu = getSideMenuElement();
        if (!sidemenu || sidemenu.dataset.controllerBound === 'true') return;
        sidemenu.dataset.controllerBound = 'true';

        sidemenu.addEventListener('mouseenter', () => {
            if (!isMobileSideMenuViewport()) setSideMenuExpanded(true);
        });
        sidemenu.addEventListener('mouseleave', (event) => {
            if (isMobileSideMenuViewport()) return;
            if (event.relatedTarget instanceof Element && event.relatedTarget.closest('#sidemenu')) return;
            sideMenuCollapseTimer = window.setTimeout(() => setSideMenuExpanded(false), 0);
        });

        const content = sidemenu.querySelector('.app-sidemenu-content');
        if (content) content.addEventListener('scroll', positionOpenSideMenuFlyouts, { passive: true });
        window.addEventListener('resize', positionOpenSideMenuFlyouts);
    }

    function bindSideMenuFlyouts() {
        document.querySelectorAll('#sidemenu .app-sidemenu-details').forEach(details => {
            if (details.dataset.flyoutBound === 'true') return;
            details.dataset.flyoutBound = 'true';
            details.addEventListener('toggle', () => {
                if (!details.open) return;
                setSideMenuExpanded(true);
                closeSideMenuFlyouts(details);
                window.requestAnimationFrame(() => positionSideMenuFlyout(details));
            });
        });
    }

    function setDesktopLineEmpty() {
        const button = document.getElementById('desktop-line-selector-btn');
        const label = document.getElementById('desktop-line-selector-label');
        const status = document.getElementById('desktop-line-menu-status');
        if (button) button.classList.remove('is-loading');
        if (label) label.textContent = 'Sin linea vinculada';
        if (status) status.innerHTML = '<span class="desktop-line-menu-empty">Sin linea vinculada</span>';
    }

    async function refreshDesktopLineSelector() {
        const button = document.getElementById('desktop-line-selector-btn');
        const label = document.getElementById('desktop-line-selector-label');
        const status = document.getElementById('desktop-line-menu-status');
        if (!label || !status) return;

        const token = localStorage.getItem('backoffice_token');
        if (!token) {
            setDesktopLineEmpty();
            return;
        }

        if (button) button.classList.add('is-loading');
        label.textContent = 'Cargando linea';
        status.innerHTML = '<span class="desktop-line-menu-empty">Cargando linea...</span>';

        try {
            const response = await fetch(`/api/backoffice/whatsapp/lines?token=${encodeURIComponent(token)}`);
            const data = await response.json();
            const lines = Array.isArray(data.lines) ? data.lines : [];
            const line = data.activeLine || lines[0] || null;

            if (!line) {
                setDesktopLineEmpty();
                return;
            }

            const number = line.displayNumber || line.number || 'Linea vinculada';
            const provider = line.provider ? `Via ${line.provider}` : 'Linea vinculada';
            if (button) button.classList.remove('is-loading');
            label.textContent = number;
            status.innerHTML = `
                <span class="desktop-line-menu-primary">${escapeHtml(number)}</span>
                <span class="desktop-line-menu-secondary">${escapeHtml(provider)}</span>
            `;
        } catch {
            setDesktopLineEmpty();
        }
    }

    function updateThemeNavState(theme) {
        const isDark = theme === 'dark';
        const cb = document.getElementById('theme-toggle-input');
        if (cb) cb.checked = isDark;

        document.querySelectorAll('#theme-mode-icon, #desktop-theme-icon, #mobile-theme-icon').forEach(icon => {
            icon.classList.toggle('fa-sun', !isDark);
            icon.classList.toggle('fa-moon', isDark);
        });
        const desktopThemeBtn = document.getElementById('desktop-theme-btn');
        if (desktopThemeBtn) desktopThemeBtn.classList.remove('active');

        const flyoutLabel = document.getElementById('theme-flyout-label');
        if (flyoutLabel) flyoutLabel.textContent = isDark ? 'Tema: Oscuro' : 'Tema: Claro';

        const desktopLabel = document.getElementById('desktop-theme-label');
        if (desktopLabel) desktopLabel.textContent = isDark ? 'Tema: Oscuro' : 'Tema: Claro';
        const mobileLabel = document.getElementById('mobile-theme-label');
        if (mobileLabel) mobileLabel.textContent = isDark ? 'Tema: Oscuro' : 'Tema: Claro';
    }

    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeNavState(savedTheme);
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeNavState(newTheme);
        window.dispatchEvent(new Event('themeChanged'));
    }

    function updateSystemConfigNavVisibility() {
        const navItem = document.querySelector('[data-route="/system-config"]')?.closest('li');
        const isSuperAdmin = localStorage.getItem('is_superadmin') === 'true';
        const canShow = isSuperAdmin;
        if (navItem) {
            navItem.classList.toggle('hidden-item', !canShow);
            navItem.style.display = canShow ? '' : 'none';
        }
        const accountItem = document.getElementById('desktop-system-config-account-item');
        if (accountItem) {
            accountItem.style.display = canShow ? '' : 'none';
        }
        const mobileAccountItem = document.getElementById('mobile-system-config-account-item');
        if (mobileAccountItem) {
            mobileAccountItem.style.display = canShow ? '' : 'none';
        }
        document.querySelectorAll('.app-sidemenu-link[data-route="/system-config"]').forEach(item => {
            const li = item.closest('li');
            if (li) li.style.display = canShow ? '' : 'none';
        });
    }

    function logout() {
        localStorage.removeItem('backoffice_token');
        localStorage.removeItem('system_config_token');
        localStorage.removeItem('is_superadmin');
        localStorage.removeItem('user_role');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_name');
        window.location.href = '/login';
    }

    window.__APP_ROUTES = APP_ROUTES;
    window.__NAV_SECTION_TAB_CONFIG = SECTION_TAB_CONFIG;
    window.__NAV_SECTION_TAB_VISIBLE = sectionTabVisible;
    window.__NAV_SECTION_TAB_ACTIVE = sectionTabActive;
    window.initTheme = initTheme;
    window.toggleTheme = toggleTheme;
    window.updateSystemConfigNavVisibility = updateSystemConfigNavVisibility;
    window.refreshDesktopLineSelector = refreshDesktopLineSelector;
    window.openMobileSideMenu = openMobileSideMenu;
    window.closeMobileSideMenu = closeMobileSideMenu;
    window.toggleMobileSideMenu = toggleMobileSideMenu;
    window.navigateFromSideMenu = navigateFromSideMenu;
    window.logout = logout;

    function tabMatchRoutes(tab) {
        const routes = [];
        if (tab.route) routes.push(tab.route);
        if (Array.isArray(tab.matchRoutes)) routes.push(...tab.matchRoutes);
        if (Array.isArray(tab.children)) {
            tab.children.forEach(child => routes.push(...tabMatchRoutes(child)));
        }
        return Array.from(new Set(routes));
    }

    function sideMenuDot(tab, parentDotId = '') {
        const dotId = tab.dotId || parentDotId;
        return dotId
            ? `<span class="nav-dot app-sidemenu-dot" data-dot-sync="${dotId}" style="display:none;"></span>`
            : '';
    }

    function renderSideMenuLink(tab, level = 0) {
        if (!sectionTabVisible(tab)) return '';
        const route = tab.route || '#';
        const matchRoutes = tabMatchRoutes(tab).join(',');
        const className = level > 0 ? 'app-sidemenu-link app-sidemenu-link-child' : 'app-sidemenu-link';
        return `
            <li>
                <button type="button" class="${className}" data-route="${route}" data-match-routes="${matchRoutes}" onclick="navigateFromSideMenu('${route}')">
                    <span class="app-sidemenu-link-main">
                        <i class="${tab.icon}"></i>
                        <span>${escapeHtml(tab.label)}</span>
                    </span>
                    ${sideMenuDot(tab)}
                </button>
            </li>
        `;
    }

    function renderSideMenuDetails(label, icon, tabs, parentDotId = '') {
        const visibleTabs = tabs.filter(sectionTabVisible);
        if (!visibleTabs.length) return '';
        const dot = parentDotId ? `<span class="nav-dot app-sidemenu-dot" data-dot-sync="${parentDotId}" style="display:none;"></span>` : '';
        return `
            <li>
                <details class="app-sidemenu-details group">
                    <summary class="app-sidemenu-summary">
                        <span class="app-sidemenu-link-main">
                            <i class="${icon}"></i>
                            <span>${escapeHtml(label)}</span>
                        </span>
                        <span class="app-sidemenu-summary-actions">
                            ${dot}
                            <i class="fas fa-chevron-right app-sidemenu-chevron"></i>
                        </span>
                    </summary>
                    <ul class="app-sidemenu-sublist">
                        ${visibleTabs.map(tab => {
            const children = Array.isArray(tab.children) ? tab.children.filter(sectionTabVisible) : [];
            if (children.length) {
                return `
                                    <li>
                                        <details class="app-sidemenu-details app-sidemenu-nested group">
                                            <summary class="app-sidemenu-summary app-sidemenu-link-child">
                                                <span class="app-sidemenu-link-main">
                                                    <i class="${tab.icon}"></i>
                                                    <span>${escapeHtml(tab.label)}</span>
                                                </span>
                                                <span class="app-sidemenu-summary-actions">
                                                    ${sideMenuDot(tab)}
                                                    <i class="fas fa-chevron-right app-sidemenu-chevron"></i>
                                                </span>
                                            </summary>
                                            <ul class="app-sidemenu-sublist">
                                                ${children.map(child => renderSideMenuLink(child, 2)).join('')}
                                            </ul>
                                        </details>
                                    </li>
                                `;
            }
            return renderSideMenuLink(tab, 1);
        }).join('')}
                    </ul>
                </details>
            </li>
        `;
    }

    function renderSideMenuSection(label, icon, tabs, parentDotId = '') {
        const visibleTabs = tabs.filter(sectionTabVisible);
        if (!visibleTabs.length) return '';
        const dot = parentDotId ? `<span class="nav-dot app-sidemenu-dot" data-dot-sync="${parentDotId}" style="display:none;"></span>` : '';
        return `
            <li class="app-sidemenu-section">
                <div class="app-sidemenu-section-title">
                    <span class="app-sidemenu-link-main">
                        <i class="${icon}"></i>
                        <span>${escapeHtml(label)}</span>
                    </span>
                    ${dot}
                </div>
                <ul class="app-sidemenu-section-list">
                    ${visibleTabs.map(tab => {
            const children = Array.isArray(tab.children) ? tab.children.filter(sectionTabVisible) : [];
            if (children.length) {
                return `
                                <li>
                                    <details class="app-sidemenu-details app-sidemenu-nested group">
                                        <summary class="app-sidemenu-summary">
                                            <span class="app-sidemenu-link-main">
                                                <i class="${tab.icon}"></i>
                                                <span>${escapeHtml(tab.label)}</span>
                                            </span>
                                            <span class="app-sidemenu-summary-actions">
                                                ${sideMenuDot(tab)}
                                                <i class="fas fa-chevron-right app-sidemenu-chevron"></i>
                                            </span>
                                        </summary>
                                        <ul class="app-sidemenu-sublist">
                                            ${children.map(child => renderSideMenuLink(child, 1)).join('')}
                                        </ul>
                                    </details>
                                </li>
                            `;
            }
            return renderSideMenuLink(tab);
        }).join('')}
                </ul>
            </li>
        `;
    }

    function renderSideMenu() {
        const list = document.getElementById('sidemenu-list');
        if (!list) return;
        list.innerHTML = `
            ${renderSideMenuSection('Gestion', 'fas fa-mobile-screen-button', SECTION_TAB_CONFIG.messaging, 'dot-messaging')}
            ${renderSideMenuSection('Integraciones', 'fas fa-puzzle-piece', SECTION_TAB_CONFIG.integrations, 'dot-integraciones')}
        `;
        updateSystemConfigNavVisibility();
        if (typeof window.highlightActiveNav === 'function') window.highlightActiveNav(window.location.pathname);
        if (typeof window.applyCachedNotificationDots === 'function') window.applyCachedNotificationDots();
        bindSideMenuFlyouts();
    }

    window.renderSideMenu = renderSideMenu;

    function closeDesktopAccountMenu() {
        const menu = document.getElementById('desktop-account-menu');
        const avatar = document.getElementById('desktop-account-trigger');
        if (menu) menu.classList.remove('open');
        if (avatar) avatar.setAttribute('aria-expanded', 'false');
    }
    window.closeDesktopAccountMenu = closeDesktopAccountMenu;

    function closeMobileAccountMenu() {
        const menu = document.getElementById('mobile-account-menu');
        const avatar = document.getElementById('mobile-account-trigger');
        if (menu) menu.classList.remove('open');
        if (avatar) avatar.setAttribute('aria-expanded', 'false');
    }
    window.closeMobileAccountMenu = closeMobileAccountMenu;

    window.toggleMobileAccountMenu = function (e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        closeDesktopAccountMenu();
        const menu = document.getElementById('mobile-account-menu');
        const avatar = document.getElementById('mobile-account-trigger');
        if (!menu || !avatar) return;
        const open = !menu.classList.contains('open');
        menu.classList.toggle('open', open);
        avatar.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    window.toggleDesktopAccountMenu = function (e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setSideMenuExpanded(true);
        closeDesktopLineMenu();
        const menu = document.getElementById('desktop-account-menu');
        const avatar = document.getElementById('desktop-account-trigger');
        if (!menu || !avatar) return;
        const open = !menu.classList.contains('open');
        menu.classList.toggle('open', open);
        avatar.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    window.toggleDesktopLineMenu = function (e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setSideMenuExpanded(true);
        closeDesktopAccountMenu();
        const menu = document.getElementById('desktop-line-menu');
        const button = document.getElementById('desktop-line-selector-btn');
        if (!menu || !button) return;
        const open = !menu.classList.contains('open');
        menu.classList.toggle('open', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    window.showAddLineSoon = function (e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        closeDesktopLineMenu();
        if (window.Swal) {
            window.Swal.fire({
                title: 'Proximamente',
                text: 'Esta funcion estara disponible pronto.',
                icon: 'info',
                confirmButtonText: 'Aceptar',
                buttonsStyling: false,
                customClass: {
                    popup: 'app-standard-swal',
                    title: 'app-standard-swal-title',
                    htmlContainer: 'app-standard-swal-html',
                    actions: 'app-standard-swal-actions',
                    confirmButton: 'app-standard-swal-confirm'
                }
            });
        } else if (typeof window.showToast === 'function') {
            window.showToast('Proximamente', 'info');
        }
    };

    window.navigateFromDesktopAccount = function (route) {
        closeDesktopAccountMenu();
        closeMobileAccountMenu();
        navigate(route);
    };

    document.addEventListener('DOMContentLoaded', () => {
        initTheme();
        updateSystemConfigNavVisibility();
        initSideMenuProjectAvatar();
        initSideMenuUserEmail();
        renderSideMenu();
        initSideMenuController();
        refreshDesktopLineSelector();
        if (typeof window.highlightActiveNav === 'function') window.highlightActiveNav(window.location.pathname);
    });
    window.renderSectionTabs = function (section, options = {}) {
        if (window.__PERSISTENT_SECTION_HEADER && !options.persistent) return '';

        const tabs = SECTION_TAB_CONFIG[section] || [];
        const path = window.location.pathname;
        const params = new URLSearchParams(window.location.search);
        const visibleTabs = tabs.filter(sectionTabVisible);

        if (!visibleTabs.length) return '';

        return `
            <nav class="docs-nav section-tabs no-print" role="tablist" aria-label="${sectionTabAriaLabel(section)}">
                ${visibleTabs.map((tab, index) => {
            const active = sectionTabActive(tab, path, params) ? ' active' : '';
            const onclick = tab.action || `navigate('${tab.route}')`;
            const route = tab.route || '';
            const panel = tab.activePanel || '';
            const dot = tab.dotId
                ? `<span class="nav-dot section-tab-dot" id="${tab.dotId}" style="display:inline-block; visibility:hidden; opacity:0;" data-visible="false"></span>`
                : '<span class="section-tab-dot section-tab-dot-placeholder" aria-hidden="true"></span>';
            const matchRoutes = Array.isArray(tab.matchRoutes) ? tab.matchRoutes.join(',') : '';
            if (Array.isArray(tab.children) && tab.children.length) {
                const menuId = `section-tab-menu-${section}-${index}`;
                const children = tab.children.filter(sectionTabVisible);
                return `
                            <span class="section-tab-group${active}" data-section-tab-group>
                                <button class="docs-nav-tab section-tab section-tab-dropdown-toggle${active}" data-route="${route}" data-panel="${panel}" data-match-routes="${matchRoutes}" onclick="toggleSectionTabMenu(event, '${menuId}')" role="tab" aria-haspopup="menu" aria-expanded="false">
                                    <i class="${tab.icon}"></i><span>${tab.label}</span>${dot}<i class="fas fa-chevron-down section-tab-chevron"></i>
                                </button>
                                <span class="section-tab-menu" id="${menuId}" role="menu">
                                    ${children.map(child => {
                    const childActive = sectionTabActive(child, path, params) ? ' active' : '';
                    return `
                                            <button class="section-tab-menu-item${childActive}" data-route="${child.route || ''}" onclick="closeSectionTabMenus(); navigate('${child.route}')" role="menuitem">
                                                <i class="${child.icon}"></i><span>${child.label}</span>
                                            </button>
                                        `;
                }).join('')}
                                </span>
                            </span>
                        `;
            }
            return `
                        <button class="docs-nav-tab section-tab${active}" data-route="${route}" data-panel="${panel}" data-match-routes="${matchRoutes}" onclick="${onclick}" role="tab">
                            <i class="${tab.icon}"></i><span>${tab.label}</span>${dot}
                        </button>
                    `;
        }).join('')}
            </nav>
        `;
    };

    window.closeSectionTabMenus = function () {
        document.querySelectorAll('.section-tab-menu.open').forEach(menu => menu.classList.remove('open'));
        document.querySelectorAll('.section-tab-dropdown-toggle[aria-expanded="true"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
    };

    window.toggleSectionTabMenu = function (e, menuId) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const button = e?.currentTarget;
        const group = button?.closest('[data-section-tab-group]');
        const menu = group?.querySelector(`#${menuId}`) || document.getElementById(menuId);
        if (!menu || !button) return;
        const isOpen = menu.classList.contains('open');
        window.closeSectionTabMenus();
        if (isOpen) return;
        getSectionTabMenuHost().appendChild(menu);
        const rect = button.getBoundingClientRect();
        const maxLeft = window.innerWidth - Math.max(rect.width, menu.offsetWidth || rect.width) - 12;
        menu.style.top = `${rect.bottom + 8}px`;
        menu.style.left = `${Math.max(12, Math.min(rect.left, maxLeft))}px`;
        menu.style.minWidth = `${rect.width}px`;
        menu.classList.add('open');
        button.setAttribute('aria-expanded', 'true');
    };

    if (!window.__sectionTabMenuCloseBound) {
        window.__sectionTabMenuCloseBound = true;
        document.addEventListener('click', (e) => {
            if (!e.target.closest('[data-section-tab-group]')) window.closeSectionTabMenus();
            if (!e.target.closest('#desktop-account-menu') && !e.target.closest('#desktop-account-trigger')) closeDesktopAccountMenu();
            if (!e.target.closest('#mobile-account-menu') && !e.target.closest('#mobile-account-trigger')) closeMobileAccountMenu();
            if (!e.target.closest('#desktop-line-menu') && !e.target.closest('#desktop-line-selector-btn')) closeDesktopLineMenu();
            if (!e.target.closest('#sidemenu')) closeSideMenuFlyouts();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeMobileSideMenu();
                closeDesktopAccountMenu();
                closeMobileAccountMenu();
                closeDesktopLineMenu();
                closeSideMenuFlyouts();
            }
        });
        window.addEventListener('resize', () => {
            window.closeSectionTabMenus();
            if (!isMobileSideMenuViewport()) {
                document.body.classList.remove('mobile-sidemenu-open');
                const button = document.getElementById('mobile-sidemenu-toggle');
                if (button) button.setAttribute('aria-expanded', 'false');
            }
            positionOpenSideMenuFlyouts();
        });
    }
})();
