/* global logout */
let currentProjectId = window.railwayProjectId || 'default';
let _conexionIntervals = [];
let _qrSkeletonTimer = null;
let _qrNoResultTimer = null;
let _lastRenderedQrSource = null;
let _qrRequestPendingUntil = 0;
let _stableGroupStatus = null;
let _groupCandidateStatus = null;
let _groupCandidateCount = 0;

function isQrRequestPending() {
    return _qrRequestPendingUntil > Date.now();
}

function markQrRequestPending() {
    _qrRequestPendingUntil = Date.now() + 120000;
}

function clearQrRequestPending() {
    _qrRequestPendingUntil = 0;
    if (_qrNoResultTimer) {
        clearTimeout(_qrNoResultTimer);
        _qrNoResultTimer = null;
    }
}

function scheduleQrNoResultGuard(message = 'No se pudo generar el QR') {
    if (_qrNoResultTimer) clearTimeout(_qrNoResultTimer);
    _qrNoResultTimer = setTimeout(() => {
        if (!isQrRequestPending()) return;
        clearQrRequestPending();
        showQrError(message);
        setConnectionButtonsBusy(false);
    }, 30000);
}
function scheduleConnectionStatusRefreshes() {
    [1000, 2500, 5000, 9000, 15000, 23000].forEach((delay) => {
        setTimeout(fetchStatus, delay);
    });
}

function getGroupStatusKey(status) {
    if (!status) return 'none';
    if (status.qr) return 'qr';
    if (status.pairingCode) return 'pairing';
    if (status.active) return 'active';
    return 'inactive';
}

function getStableGroupStatus(status) {
    if (!status) {
        _stableGroupStatus = null;
        _groupCandidateStatus = null;
        _groupCandidateCount = 0;
        return status;
    }

    const currentKey = getGroupStatusKey(status);

    if (!_stableGroupStatus) {
        if (currentKey === 'active') {
            if (_groupCandidateStatus === currentKey) {
                _groupCandidateCount += 1;
            } else {
                _groupCandidateStatus = currentKey;
                _groupCandidateCount = 1;
            }

            if (_groupCandidateCount >= 2) {
                _stableGroupStatus = status;
                _groupCandidateStatus = null;
                _groupCandidateCount = 0;
                return _stableGroupStatus;
            }

            return { ...status, active: false, message: 'Desconectado' };
        }

        _stableGroupStatus = status;
        _groupCandidateStatus = null;
        _groupCandidateCount = 0;
        return _stableGroupStatus;
    }

    const stableKey = getGroupStatusKey(_stableGroupStatus);
    if (currentKey === stableKey) {
        _stableGroupStatus = status;
        _groupCandidateStatus = null;
        _groupCandidateCount = 0;
        return _stableGroupStatus;
    }

    if (_groupCandidateStatus === currentKey) {
        _groupCandidateCount += 1;
    } else {
        _groupCandidateStatus = currentKey;
        _groupCandidateCount = 1;
    }

    const requiredRepeats = currentKey === 'active' ? 2 : stableKey === 'active' && currentKey === 'inactive' ? 3 : 1;
    if (_groupCandidateCount >= requiredRepeats) {
        _stableGroupStatus = status;
        _groupCandidateStatus = null;
        _groupCandidateCount = 0;
    }

    return _stableGroupStatus;
}

function getConexionServiceId() {
    return window.railwayServiceId || undefined;
}

function getConexionStatusUrl() {
    const token = localStorage.getItem('backoffice_token') || '';
    const params = new URLSearchParams({ token });
    if (currentProjectId && currentProjectId !== 'default') params.set('projectId', currentProjectId);
    const serviceId = getConexionServiceId();
    if (serviceId) params.set('serviceId', serviceId);
    return `/api/dashboard-status?${params.toString()}`;
}

function setConnectionProviderTarget(target) {
    const qrBtn = document.getElementById('generate-qr-btn');
    const pairingBtn = document.getElementById('generate-pairing-btn');
    [qrBtn, pairingBtn].forEach((button) => {
        if (button) button.dataset.providerTarget = target;
    });
}

function isGroupConnectionTarget() {
    return document.getElementById('generate-qr-btn')?.dataset.providerTarget === 'groups';
}

function renderMetaConnectionInfo(metaOnboarding, isPrimaryMeta) {
    const obData = metaOnboarding?.onboarding_data || {};
    const phoneDisplay = obData.display_phone_number || metaOnboarding?.phone_number || metaOnboarding?.display_phone_number || metaOnboarding?.phone_number_id || metaOnboarding?.whatsappNumberId || 'No configurado';
    const phoneId = metaOnboarding?.phone_number_id || metaOnboarding?.whatsappNumberId || obData.id || 'No configurado';
    const wabaId = metaOnboarding?.waba_id || metaOnboarding?.whatsappBusinessId || obData.waba_id || 'No configurado';
    const verifiedName = obData.verified_name || metaOnboarding?.verified_name || metaOnboarding?.business_name || 'Sin Nombre de Marca';
    const metaStatus = obData.status || metaOnboarding?.status || 'Desconocido';
    const accountReview = obData.account_review_status || metaOnboarding?.account_review_status || 'UNKNOWN';

    let metaStatusLabel = '<span class="meta-status-badge" style="background:#94a3b8;color:white;padding:2px 8px;border-radius:10px;font-size:.8rem;display:inline-block;">' + metaStatus + '</span>';
    if (metaStatus === 'CONNECTED' || metaStatus === 'APPROVED' || metaStatus === 'active') {
        metaStatusLabel = '<span class="meta-status-badge" style="background:#10b981;color:white;padding:2px 8px;border-radius:10px;font-size:.8rem;display:inline-block;"><i class="fas fa-circle-check"></i> Conectado</span>';
    } else if (metaStatus === 'BANNED') {
        metaStatusLabel = '<span class="meta-status-badge" style="background:#ef4444;color:white;padding:2px 8px;border-radius:10px;font-size:.8rem;display:inline-block;"><i class="fas fa-ban"></i> Baneado / Bloqueado</span>';
    } else if (metaStatus === 'RESTRICTED' || metaStatus === 'FLAGGED' || metaStatus === 'rejected') {
        metaStatusLabel = '<span class="meta-status-badge" style="background:#f59e0b;color:white;padding:2px 8px;border-radius:10px;font-size:.8rem;display:inline-block;"><i class="fas fa-triangle-exclamation"></i> ' + metaStatus + '</span>';
    }

    const quality = obData.quality_rating || 'UNKNOWN';
    let qualityLabel = '<span style="font-weight:600;color:#94a3b8;">Desconocida</span>';
    if (quality === 'GREEN') qualityLabel = '<span style="font-weight:600;color:#10b981;">Alta (Verde)</span>';
    else if (quality === 'YELLOW') qualityLabel = '<span style="font-weight:600;color:#f59e0b;">Media (Amarillo)</span>';
    else if (quality === 'RED') qualityLabel = '<span style="font-weight:600;color:#ef4444;">Baja (Rojo)</span>';

    const isVerified = (obData.is_official_business_account === true) ||
        (obData.code_verification_status === 'verified' || obData.code_verification_status === 'VERIFIED') ||
        (obData.name_status === 'APPROVED' || obData.name_status === 'VERIFIED');
    const vStatusLabel = isVerified
        ? '<span style="color:#10b981;font-weight:600;">Verificado</span>'
        : '<span style="color:#ef4444;font-weight:600;">No Verificado</span>';

    let wabaReviewLabel = '<span style="font-weight:600;color:#94a3b8;">Pendiente</span>';
    if (accountReview === 'APPROVED') wabaReviewLabel = '<span style="color:#10b981;font-weight:600;">Aprobada</span>';
    else if (accountReview === 'REJECTED') wabaReviewLabel = '<span style="color:#ef4444;font-weight:600;">Rechazada</span>';
    else if (accountReview === 'NEEDS_COMPLIANCE_REVIEW') wabaReviewLabel = '<span style="color:#f59e0b;font-weight:600;">Requiere revision</span>';

    const tier = obData.messaging_limit_tier || obData.messagingLimit || 'Desconocido';
    const tierMap = {
        TIER_50: '50 conversaciones / 24h',
        TIER_250: '250 conversaciones / 24h',
        TIER_1K: '1,000 conversaciones / 24h',
        TIER_2K: '2,000 conversaciones / 24h',
        TIER_10K: '10,000 conversaciones / 24h',
        TIER_100K: '100,000 conversaciones / 24h',
        TIER_UNLIMITED: 'Conversaciones ilimitadas',
        UNTIERED: 'Sin limite definido'
    };
    const tierHuman = tierMap[tier] || tier;
    const title = isPrimaryMeta ? 'Meta Cloud API Activa' : 'Meta Cloud API registrada';

    return `
        <div><strong>Configuracion:</strong> ${title}</div>
        <div class="meta-stats" style="margin-top:15px;padding:15px;background:rgba(6,104,225,0.05);border-radius:12px;border:1px solid rgba(6,104,225,0.15);display:flex;flex-direction:column;gap:10px;text-align:left;font-size:.95rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(6,104,225,0.1);padding-bottom:8px;"><strong>Marca / Nombre:</strong><span style="font-weight:600;">${verifiedName}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Numero de Telefono:</strong><span style="font-weight:600;">${phoneDisplay}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>ID del Telefono (Phone ID):</strong><span style="font-family:monospace;font-size:.85rem;color:#64748b;">${phoneId}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(6,104,225,0.1);padding-bottom:8px;"><strong>ID de WABA:</strong><span style="font-family:monospace;font-size:.85rem;color:#64748b;">${wabaId}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Estado del Canal:</strong>${metaStatusLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Calificacion de Calidad:</strong>${qualityLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Verificacion del Numero:</strong>${vStatusLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Revision de WABA:</strong>${wabaReviewLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(6,104,225,0.1);padding-top:8px;"><strong>Limite de Mensajes (Tier):</strong><span class="meta-status-badge" style="background:#0668E1;color:white;padding:3px 10px;border-radius:12px;font-size:.85rem;font-weight:600;display:inline-block;">${tierHuman}</span></div>
        </div>
    `;
}


async function runBotCommand(command, chatId) {
    const token = localStorage.getItem('backoffice_token');
    const res = await fetch(`/api/backoffice/bot-command?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token,
            command,
            chatId,
            projectId: currentProjectId,
            serviceId: getConexionServiceId()
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo ejecutar el comando');
    return data;
}

function setCommandButtonBusy(button, isBusy, busyText) {
    if (!button) return;
    if (isBusy) {
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${busyText || 'Ejecutando...'}`;
    } else {
        button.disabled = false;
        if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
    }
}

const commandChatSelectorState = {
    chats: [],
    selected: new Set(),
    draftSelected: new Set(),
    loaded: false
};

function escapeCommandHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getCommandChatPhone(chatId) {
    return String(chatId || '').split('@')[0] || String(chatId || '');
}

function getCommandChatLabel(chat) {
    const name = chat?.contact_name || (chat?.name && chat.name !== '[-]' ? chat.name : '');
    const phone = getCommandChatPhone(chat?.id);
    return {
        name: name || phone || 'Sin nombre',
        phone
    };
}

function getSelectedCommandChatIds() {
    return Array.from(commandChatSelectorState.selected);
}

function updateCommandSelectionSummary() {
    const label = document.getElementById('bot-command-selection-label');
    const badge = document.getElementById('bot-command-selection-badge');
    const selectedCount = commandChatSelectorState.selected.size;
    const total = commandChatSelectorState.chats.length;

    if (label) {
        if (!selectedCount) label.textContent = 'Seleccionar chats';
        else if (total && selectedCount === total) label.textContent = 'Todos los chats';
        else label.textContent = `${selectedCount} chat${selectedCount === 1 ? '' : 's'} seleccionado${selectedCount === 1 ? '' : 's'}`;
    }
    if (badge) {
        badge.textContent = String(selectedCount);
        badge.style.display = selectedCount ? 'inline-flex' : 'none';
    }
}

function updateCommandModalCount() {
    const count = document.getElementById('bot-command-modal-count');
    if (count) {
        const selectedCount = commandChatSelectorState.draftSelected.size;
        count.textContent = `${selectedCount} seleccionado${selectedCount === 1 ? '' : 's'}`;
    }

    const selectAllBtn = document.getElementById('bot-command-select-all');
    if (selectAllBtn) {
        const allSelected = commandChatSelectorState.chats.length > 0 && commandChatSelectorState.draftSelected.size === commandChatSelectorState.chats.length;
        selectAllBtn.innerHTML = allSelected
            ? '<i class="fas fa-xmark"></i> Limpiar seleccion'
            : '<i class="fas fa-check-double"></i> Seleccionar todos';
    }
}

function renderCommandChatList() {
    const list = document.getElementById('bot-command-chat-list');
    if (!list) return;

    const query = (document.getElementById('bot-command-chat-search')?.value || '').trim().toLowerCase();
    const chats = commandChatSelectorState.chats.filter((chat) => {
        const label = getCommandChatLabel(chat);
        return !query || label.name.toLowerCase().includes(query) || label.phone.toLowerCase().includes(query);
    });

    if (!chats.length) {
        list.innerHTML = '<div class="conexion-command-empty">No se encontraron chats.</div>';
        updateCommandModalCount();
        return;
    }

    list.innerHTML = chats.map((chat) => {
        const chatId = String(chat.id || '');
        const label = getCommandChatLabel(chat);
        const checked = commandChatSelectorState.draftSelected.has(chatId) ? 'checked' : '';
        return `
            <label class="conexion-command-chat-option">
                <input type="checkbox" value="${escapeCommandHtml(chatId)}" ${checked}>
                <span>
                    <strong>${escapeCommandHtml(label.name)}</strong>
                    <small>${escapeCommandHtml(label.phone)}</small>
                </span>
            </label>`;
    }).join('');

    list.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.addEventListener('change', () => {
            if (input.checked) commandChatSelectorState.draftSelected.add(input.value);
            else commandChatSelectorState.draftSelected.delete(input.value);
            updateCommandModalCount();
        });
    });
    updateCommandModalCount();
}

async function loadCommandChats() {
    const list = document.getElementById('bot-command-chat-list');
    if (commandChatSelectorState.loaded) {
        renderCommandChatList();
        return;
    }
    if (list) list.innerHTML = '<div class="conexion-command-empty"><i class="fas fa-circle-notch fa-spin"></i> Cargando chats...</div>';
    const token = localStorage.getItem('backoffice_token') || '';
    const params = new URLSearchParams({ token, limit: '10000', offset: '0' });
    if (currentProjectId && currentProjectId !== 'default') params.set('projectId', currentProjectId);
    const serviceId = getConexionServiceId();
    if (serviceId) params.set('serviceId', serviceId);

    const res = await fetch(`/api/backoffice/chats?${params.toString()}`);
    if (res.status === 401) return logout();
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) throw new Error(data.error || 'No se pudieron cargar los chats');
    commandChatSelectorState.chats = data.filter((chat) => chat && chat.id);
    commandChatSelectorState.loaded = true;
    renderCommandChatList();
    updateCommandSelectionSummary();
}

function openCommandChatModal() {
    const modal = document.getElementById('bot-command-chat-modal');
    const search = document.getElementById('bot-command-chat-search');
    if (!modal) return;
    commandChatSelectorState.draftSelected = new Set(commandChatSelectorState.selected);
    modal.classList.add('active');
    if (search) search.value = '';
    loadCommandChats().catch((err) => {
        const list = document.getElementById('bot-command-chat-list');
        if (list) list.innerHTML = `<div class="conexion-command-empty error">${escapeCommandHtml(err.message)}</div>`;
    });
}

function closeCommandChatModal(commit = false) {
    const modal = document.getElementById('bot-command-chat-modal');
    if (commit) {
        commandChatSelectorState.selected = new Set(commandChatSelectorState.draftSelected);
        updateCommandSelectionSummary();
    }
    if (modal) modal.classList.remove('active');
}

async function runBotCommandForSelectedChats(command) {
    const chatIds = getSelectedCommandChatIds();
    if (!chatIds.length) throw new Error('Selecciona al menos un chat.');

    const results = [];
    for (const chatId of chatIds) {
        results.push(await runBotCommand(command, chatId));
    }
    return results;
}


function getQrElements() {
    return {
        section: document.getElementById('qr-section'),
        title: document.getElementById('qr-section-title'),
        skeleton: document.getElementById('qr-skeleton'),
        img: document.getElementById('baileys-qr-img') || document.querySelector('.qr'),
        empty: document.getElementById('qr-empty-message') || document.querySelector('.qr-error-msg'),
        pairing: document.getElementById('pairing-code-container')
    };
}

function setConnectionButtonsBusy(isBusy) {
    const buttons = [document.getElementById('generate-qr-btn'), document.getElementById('generate-pairing-btn')];
    buttons.forEach((button) => {
        if (button) button.disabled = isBusy;
    });
    const loading = document.getElementById('generate-qr-loading');
    if (loading && !isBusy) loading.style.display = 'none';
}

function showQrLoading(titleText) {
    const { section, title, skeleton, img, empty, pairing } = getQrElements();
    const loading = document.getElementById('generate-qr-loading');
    if (loading) loading.style.display = 'none';
    if (!section) return;
    section.style.display = 'block';
    if (title) title.textContent = titleText || 'Generando QR';
    if (skeleton) skeleton.style.display = 'grid';
    if (img) img.style.display = 'none';
    if (empty) empty.style.display = 'none';
    if (pairing) pairing.style.display = 'none';
}

function showQrError(message = 'No se pudo generar el QR') {
    const { section, title, skeleton, img, empty, pairing } = getQrElements();
    if (section) section.style.display = 'block';
    if (title) title.textContent = message;
    if (skeleton) skeleton.style.display = 'none';
    if (img) img.style.display = 'none';
    if (pairing) pairing.style.display = 'none';
    if (empty) {
        empty.textContent = 'Reintenta la vinculacion o revisa el estado del proveedor.';
        empty.style.display = 'block';
    }
}

function getQrDisplaySource(source) {
    const qrSource = source || '/qr.png';
    if (qrSource.startsWith('data:')) return qrSource;
    const separator = qrSource.includes('?') ? '&' : '?';
    return `${qrSource}${separator}v=${Date.now()}`;
}

function showQrConnected(titleText = 'WhatsApp de grupos conectado') {
    clearQrRequestPending();
    if (_qrSkeletonTimer) clearTimeout(_qrSkeletonTimer);
    _qrSkeletonTimer = null;
    _lastRenderedQrSource = null;
    const { section, title, skeleton, img, empty, pairing } = getQrElements();
    if (section) section.style.display = 'block';
    if (title) title.textContent = titleText;
    if (skeleton) skeleton.style.display = 'none';
    if (img) img.style.display = 'none';
    if (pairing) pairing.style.display = 'none';
    if (empty) {
        empty.textContent = 'La sesion auxiliar de Baileys esta vinculada.';
        empty.style.display = 'block';
    }
}

function renderQrImage(source, titleText) {
    clearQrRequestPending();
    const qrSource = source || '/qr.png';
    const { section, title, skeleton, img, empty, pairing } = getQrElements();
    if (!section || !img) return;
    section.style.display = 'block';
    if (title) title.textContent = titleText || 'Escanea con WhatsApp';
    if (pairing) pairing.style.display = 'none';

    if (_lastRenderedQrSource === qrSource) {
        if (_qrSkeletonTimer) return;
        if (skeleton) skeleton.style.display = 'none';
        if (img.dataset.loadedQrSource === qrSource) {
            if (empty) empty.style.display = 'none';
            img.style.display = 'block';
        }
        return;
    }

    _lastRenderedQrSource = qrSource;
    if (_qrSkeletonTimer) clearTimeout(_qrSkeletonTimer);
    _qrSkeletonTimer = null;

    const isDataUrl = qrSource.startsWith('data:');
    if (isDataUrl) {
        img.dataset.loadedQrSource = qrSource;
        if (skeleton) skeleton.style.display = 'none';
        if (empty) empty.style.display = 'none';
        img.style.display = 'block';
        img.src = qrSource;
        return;
    }

    showQrLoading(titleText || 'Escanea con WhatsApp');
    img.onload = () => {
        img.dataset.loadedQrSource = qrSource;
        if (skeleton) skeleton.style.display = 'none';
        if (empty) empty.style.display = 'none';
        img.style.display = 'block';
    };
    img.onerror = () => {
        if (skeleton) skeleton.style.display = 'none';
        img.style.display = 'none';
        if (empty) {
            empty.textContent = 'No se pudo cargar el QR. Reintenta la vinculacion.';
            empty.style.display = 'block';
        }
    };
    img.src = getQrDisplaySource(qrSource);
}

function renderPairingCode(code, titleText) {
    const { section, title, skeleton, img, empty, pairing } = getQrElements();
    if (!section || !pairing) return;
    clearQrRequestPending();
    if (_qrSkeletonTimer) clearTimeout(_qrSkeletonTimer);
    _lastRenderedQrSource = null;
    section.style.display = 'block';
    if (title) title.textContent = titleText || 'Codigo de vinculacion';
    if (skeleton) skeleton.style.display = 'none';
    if (img) img.style.display = 'none';
    if (empty) empty.style.display = 'none';
    pairing.style.display = 'block';
    pairing.innerHTML = '<div class="conexion-pairing-code-value"></div><p>Ingresa este codigo en WhatsApp cuando se solicite la vinculacion.</p>';
    const value = pairing.querySelector('.conexion-pairing-code-value');
    if (value) value.textContent = String(code || '');
}

function showQrIdle(titleText = 'Vinculacion pendiente') {
    const { section, title, skeleton, img, empty, pairing } = getQrElements();
    if (_qrSkeletonTimer) clearTimeout(_qrSkeletonTimer);
    _qrSkeletonTimer = null;
    _lastRenderedQrSource = null;
    if (section) section.style.display = 'block';
    if (title) title.textContent = titleText;
    if (skeleton) skeleton.style.display = 'none';
    if (img) img.style.display = 'none';
    if (empty) {
        empty.textContent = 'Genera un QR o solicita un codigo para iniciar la vinculacion.';
        empty.style.display = 'block';
    }
    if (pairing) pairing.style.display = 'none';
}

function hideQrPresentation() {
    showQrIdle();
}

async function fetchStatus() {
    try {
        const res = await fetch(getConexionStatusUrl());
        if (res.status === 401) return logout();
        const data = await res.json();
        console.log('[fetchStatus] status data received:', data);

        if (data) {
            currentProjectId = data.activeProjectId || (data.metaOnboarding && data.metaOnboarding.project_id) || 'default';
        }

        const statusEl = document.getElementById('session-status');
        const sessionInfo = document.getElementById('session-info');
        const sessionError = document.getElementById('session-error');
        const wsLinkContainer = document.getElementById('whatsapp-link-container');
        const groupContainer = document.getElementById('group-connection-container');
        const groupStatusEl = document.getElementById('group-session-status');
        const startContainer = document.getElementById('baileys-start-container');
        const statusSkeleton = document.getElementById('session-status-skeleton');
        const groupStatusSkeleton = document.getElementById('group-session-status-skeleton');

        if (!statusEl) return; // view desmontada
        statusEl.style.display = '';
        if (statusSkeleton) statusSkeleton.style.display = 'none';
        if (groupStatusEl) groupStatusEl.style.display = '';
        if (groupStatusSkeleton) groupStatusSkeleton.style.display = 'none';
        sessionInfo.style.display = 'none';
        wsLinkContainer.style.display = 'none';
        sessionError.innerHTML = '';
        sessionInfo.innerHTML = '';

        if (!data || !data.adapter) {
            statusEl.textContent = '❌ Error de sistema';
            return;
        }

        const isMeta = data.adapter.type === 'meta';
        const hasMetaOnboarding = Boolean(data.metaOnboarding);

        if (isMeta || hasMetaOnboarding) {
            const metaStatus = data.metaOnboarding?.onboarding_data?.status || data.metaOnboarding?.status || 'Registrada';
            statusEl.textContent = isMeta ? 'Principal: META' : `META: ${metaStatus}`;
            statusEl.style.color = '#0668E1';
            sessionInfo.style.display = 'block';
            sessionInfo.innerHTML = renderMetaConnectionInfo(data.metaOnboarding, isMeta);
        } else {
            renderProviderStatus(data.adapter, 'Principal', { preserveQr: Boolean(data.group && !data.group.active) });
        }

        const groupStatus = getStableGroupStatus(data.group);
        if (groupContainer) groupContainer.style.display = 'block';
        if (startContainer) startContainer.style.display = 'block';

        if (groupStatus && groupStatusEl) {
            const btn = document.getElementById('generate-qr-btn');
            if (btn) btn.innerHTML = `<i class="fas fa-qrcode"></i> Generar QR Grupos`;
            setConnectionProviderTarget('groups');

            if (groupStatus.active) {
                groupStatusEl.textContent = 'Grupos: Baileys';
                groupStatusEl.style.color = '#10b981';
                showQrConnected();
                if (!data.adapter?.qr && !data.adapter?.pairingCode) {
                    hideQrPresentation();
                }
                clearQrRequestPending();
                setConnectionButtonsBusy(false);
            } else if (groupStatus.pairingCode) {
                groupStatusEl.textContent = 'Grupos: Esperando vinculacion por codigo';
                groupStatusEl.style.color = '#f59e0b';
                renderPairingCode(groupStatus.pairingCode, 'Codigo de vinculacion para grupos');
                setConnectionButtonsBusy(false);
            } else if (groupStatus.qr) {
                groupStatusEl.textContent = 'Grupos: Esperando vinculacion';
                groupStatusEl.style.color = '#f59e0b';
                renderQrImage(groupStatus.qrImage || '/bot.groups.qr.png', 'Escanea con WhatsApp para grupos');
                setConnectionButtonsBusy(false);
            } else {
                const groupMessage = isQrRequestPending() ? (groupStatus.message || 'Iniciando motor...') : 'Desconectado';
                groupStatusEl.textContent = 'Grupos: ' + groupMessage;
                groupStatusEl.style.color = '#94a3b8';
                if (isQrRequestPending()) {
                    showQrLoading(groupMessage || 'Generando QR de grupos');
                    setConnectionButtonsBusy(true);
                } else {
                    setConnectionProviderTarget('primary');
                    if (!data.adapter?.qr && !data.adapter?.pairingCode) {
                        hideQrPresentation();
                    }
                    setConnectionButtonsBusy(false);
                }
            }
        } else if (groupStatusEl) {
            groupStatusEl.textContent = 'Grupos: No configurado';
            groupStatusEl.style.color = '#94a3b8';
            setConnectionProviderTarget('primary');
            if (!data.adapter?.qr && !data.adapter?.pairingCode) {
                if (!isQrRequestPending()) {
                    hideQrPresentation();
                    setConnectionButtonsBusy(false);
                }
            } else {
                setConnectionButtonsBusy(false);
            }
        }
    } catch (e) {
        console.error(e);
        const el = document.getElementById('session-status');
        const err = document.getElementById('session-error');
        if (el) el.textContent = 'Error';
        if (err) err.innerHTML = `<div class='error-box'>No se pudo obtener el estado del bot.</div>`;
    }
}

function renderProviderStatus(status, label, options = {}) {
    console.log('[renderProviderStatus] status:', status, 'label:', label);
    const statusEl = document.getElementById('session-status');
    const sessionInfo = document.getElementById('session-info');
    const startContainer = document.getElementById('baileys-start-container');
    const preserveQr = options.preserveQr === true;
    if (!statusEl) return;

    if (status.active) {
        statusEl.textContent = label + ': ' + (status.message || 'Conectado');
        statusEl.style.color = '#10b981';
        if (sessionInfo) {
            sessionInfo.style.display = 'block';
            sessionInfo.innerHTML += '<div class="conexion-provider-line"><strong>' + label + ':</strong><span>' + (status.message || 'Operativo') + '</span></div>';
        }
        if (startContainer) startContainer.style.display = 'none';
        clearQrRequestPending();
        if (!preserveQr) hideQrPresentation();
        setConnectionButtonsBusy(false);
    } else if (status.pairingCode) {
        statusEl.textContent = label + ': Esperando vinculacion por codigo';
        statusEl.style.color = '#f59e0b';
        if (startContainer) startContainer.style.display = 'block';
        renderPairingCode(status.pairingCode, 'Codigo de vinculacion para WhatsApp');
        setConnectionButtonsBusy(false);
    } else if (status.qr) {
        statusEl.textContent = label + ': Esperando vinculacion';
        statusEl.style.color = '#f59e0b';
        if (startContainer) startContainer.style.display = 'block';
        renderQrImage(status.qrImage || '/qr.png', 'Escanea con WhatsApp');
        setConnectionProviderTarget('primary');
        setConnectionButtonsBusy(false);
    } else {
        statusEl.textContent = label + ': ' + (status.message || 'Cargando...');
        if (startContainer && !status.active) {
            startContainer.style.display = 'block';
            const btn = document.getElementById('generate-qr-btn');
            if (btn) btn.innerHTML = '<i class="fas fa-qrcode"></i> Generar QR Baileys';
            setConnectionProviderTarget('primary');
        }
        if (isQrRequestPending()) {
            if (startContainer) startContainer.style.display = 'block';
            showQrLoading(label.includes('Grupos') ? 'Generando QR de grupos' : 'Generando QR Baileys');
            setConnectionButtonsBusy(true);
        } else {
            if (!preserveQr) hideQrPresentation();
            setConnectionButtonsBusy(false);
        }
    }
}

async function fetchBotStatus() {
    const botToggle = document.getElementById('global-bot-toggle');
    if (!botToggle) return;
    try {
        const token = localStorage.getItem('backoffice_token');
        const serviceParam = window.railwayServiceId ? `&serviceId=${encodeURIComponent(window.railwayServiceId)}` : '';
        const res = await fetch(`/api/backoffice/get-setting?key=GLOBAL_BOT_ENABLED&projectId=${currentProjectId}${serviceParam}&token=${token}`);
        const data = await res.json();
        if (data.success) botToggle.checked = data.value !== 'false';
    } catch (e) { console.error("Error fetching bot status", e); }
}

let _currentTimeoutUnit = 'min'; // 'min' | 'hs'

function updateTimeoutUnitUI(unit) {
    _currentTimeoutUnit = unit;
    const btnMin = document.getElementById('human-timeout-unit-min');
    const btnHs = document.getElementById('human-timeout-unit-hs');
    if (btnMin && btnHs) {
        if (unit === 'hs') {
            btnMin.style.background = 'transparent';
            btnMin.style.color = 'var(--text-muted)';
            btnHs.style.background = '#0099FF';
            btnHs.style.color = '#ffffff';
        } else {
            btnMin.style.background = '#0099FF';
            btnMin.style.color = '#ffffff';
            btnHs.style.background = 'transparent';
            btnHs.style.color = 'var(--text-muted)';
        }
    }
}

async function fetchHumanTimeoutSetting() {
    const timeoutSlider = document.getElementById('human-timeout-slider');
    const timeoutBadge = document.getElementById('human-timeout-badge');
    if (!timeoutSlider) return;
    try {
        const token = localStorage.getItem('backoffice_token');
        const serviceParam = window.railwayServiceId ? `&serviceId=${encodeURIComponent(window.railwayServiceId)}` : '';
        const res = await fetch(`/api/backoffice/get-setting?key=HUMAN_INACTIVITY_TIMEOUT_MINUTES&projectId=${currentProjectId}${serviceParam}&token=${token}`);
        const data = await res.json();
        if (data.success && data.value) {
            const totalMinutes = parseInt(data.value, 10);
            if (!isNaN(totalMinutes) && totalMinutes >= 1 && totalMinutes <= 720) {
                if (totalMinutes >= 60 && totalMinutes % 60 === 0) {
                    updateTimeoutUnitUI('hs');
                    timeoutSlider.min = '1';
                    timeoutSlider.max = '12';
                    timeoutSlider.step = '1';
                    timeoutSlider.value = String(totalMinutes / 60);
                    if (timeoutBadge) timeoutBadge.textContent = `${totalMinutes / 60} hs`;
                } else {
                    updateTimeoutUnitUI('min');
                    timeoutSlider.min = '1';
                    timeoutSlider.max = '60';
                    timeoutSlider.step = '1';
                    timeoutSlider.value = String(Math.min(60, totalMinutes));
                    if (timeoutBadge) timeoutBadge.textContent = `${timeoutSlider.value} min`;
                }
            }
        }
    } catch (e) { console.error("Error fetching human inactivity timeout", e); }
}

// Funcion de inicializacion para SPA (se llama en cada visita)
window.initConexionView = function () {
    // Limpiar intervalos anteriores
    _conexionIntervals.forEach(clearInterval);
    _conexionIntervals = [];

    // Carga inicial
    fetchBotStatus();
    fetchHumanTimeoutSetting();
    fetchStatus();

    // Intervalos de polling
    _conexionIntervals.push(setInterval(fetchStatus, 5000));
    _conexionIntervals.push(setInterval(fetchBotStatus, 30000));
    _conexionIntervals.push(setInterval(fetchHumanTimeoutSetting, 30000));

    // --- Toggle Bot Global ---
    const botToggle = document.getElementById('global-bot-toggle');
    if (botToggle) {
        botToggle.addEventListener('change', async () => {
            const enabled = botToggle.checked;
            try {
                const token = localStorage.getItem('backoffice_token');
                const serviceId = window.railwayServiceId || undefined;
                const res = await fetch(`/api/backoffice/save-setting?token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: 'GLOBAL_BOT_ENABLED', value: enabled ? 'true' : 'false', projectId: currentProjectId, serviceId })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Server error');
            } catch (e) {
                window.swalAlert("Error", "Error al cambiar el estado del bot", "error");
                botToggle.checked = !enabled;
            }
        });
    }

    // --- Selector de Unidad y Slider Tiempo de Reactivación ---
    const timeoutSlider = document.getElementById('human-timeout-slider');
    const timeoutBadge = document.getElementById('human-timeout-badge');
    const btnMin = document.getElementById('human-timeout-unit-min');
    const btnHs = document.getElementById('human-timeout-unit-hs');

    const saveTimeoutSetting = async (totalMinutes, displayText) => {
        try {
            const token = localStorage.getItem('backoffice_token');
            const serviceId = window.railwayServiceId || undefined;
            const res = await fetch(`/api/backoffice/save-setting?token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: 'HUMAN_INACTIVITY_TIMEOUT_MINUTES',
                    value: String(totalMinutes),
                    projectId: currentProjectId,
                    serviceId
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Server error');
            if (typeof showToast === 'function') {
                showToast(`Reactivación a modo bot configurada en ${displayText}`, 'success');
            }
        } catch (e) {
            console.error("Error al guardar tiempo de reactivación", e);
            if (window.swalAlert) {
                window.swalAlert("Error", "Error al guardar el tiempo de reactivación", "error");
            }
        }
    };

    if (btnMin && btnHs && timeoutSlider) {
        btnMin.addEventListener('click', () => {
            if (_currentTimeoutUnit === 'min') return;
            updateTimeoutUnitUI('min');
            timeoutSlider.min = '1';
            timeoutSlider.max = '60';
            timeoutSlider.step = '1';
            timeoutSlider.value = '30';
            if (timeoutBadge) timeoutBadge.textContent = '30 min';
            saveTimeoutSetting(30, '30 min');
        });

        btnHs.addEventListener('click', () => {
            if (_currentTimeoutUnit === 'hs') return;
            updateTimeoutUnitUI('hs');
            timeoutSlider.min = '1';
            timeoutSlider.max = '12';
            timeoutSlider.step = '1';
            timeoutSlider.value = '1';
            if (timeoutBadge) timeoutBadge.textContent = '1 hs';
            saveTimeoutSetting(60, '1 hs');
        });

        timeoutSlider.addEventListener('input', () => {
            const val = timeoutSlider.value;
            if (timeoutBadge) {
                timeoutBadge.textContent = _currentTimeoutUnit === 'hs' ? `${val} hs` : `${val} min`;
            }
        });

        timeoutSlider.addEventListener('change', () => {
            const val = parseInt(timeoutSlider.value, 10);
            const totalMinutes = _currentTimeoutUnit === 'hs' ? val * 60 : val;
            const displayText = _currentTimeoutUnit === 'hs' ? `${val} hs` : `${val} min`;
            saveTimeoutSetting(totalMinutes, displayText);
        });
    }

    // --- Reload Bot ---
    const reloadBtn = document.getElementById('system-reload-btn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', async function restartBot() {
            if (!await window.swalConfirm('¿Reiniciar bot?', '¿Seguro que quieres reiniciar el bot? Esto desconectará temporalmente el servicio.')) return;
            reloadBtn.disabled = true;
            reloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reiniciando...';
            try {
                const token = localStorage.getItem('backoffice_token');
                const res = await fetch(`/api/restart-bot?token=${encodeURIComponent(token || '')}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `token=${token || ''}`
                    }
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) throw new Error(data.error || 'Error al solicitar el reinicio');
                window.swalAlert("Reinicio solicitado", "El contenedor se está reiniciando. La página se recargará en 10 segundos.", "success");
                setTimeout(() => window.location.reload(), 10000);
            } catch (e) {
                window.swalAlert("Error", e.message || "Error al solicitar el reinicio", "error");
                reloadBtn.disabled = false;
                reloadBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Reiniciar';
            }
        });
    }

    const syncCommandBtn = document.getElementById('bot-command-sync');
    if (syncCommandBtn) {
        syncCommandBtn.addEventListener('click', async () => {
            setCommandButtonBusy(syncCommandBtn, true, 'Sincronizando...');
            try {
                const data = await runBotCommand('#ACTUALIZAR#');
                window.swalAlert('Sincronizacion completada', `Sheets, RAG y tools actualizados. Asistentes sincronizados: ${data.assistantsSynced || 0}.`, 'success');
            } catch (err) {
                window.swalAlert('Error', err.message || 'No se pudo ejecutar #ACTUALIZAR#', 'error');
            } finally {
                setCommandButtonBusy(syncCommandBtn, false);
            }
        });
    }

    const commandChatSelector = document.getElementById('bot-command-chat-selector');
    const commandChatModalClose = document.getElementById('bot-command-chat-modal-close');
    const commandChatCancel = document.getElementById('bot-command-chat-cancel');
    const commandChatAccept = document.getElementById('bot-command-chat-accept');
    const commandChatSearch = document.getElementById('bot-command-chat-search');
    const commandSelectAll = document.getElementById('bot-command-select-all');
    const resetCommandBtn = document.getElementById('bot-command-reset');
    const newThreadCommandBtn = document.getElementById('bot-command-new-thread');
    commandChatSelectorState.loaded = false;
    commandChatSelectorState.chats = [];
    commandChatSelectorState.selected = new Set();
    commandChatSelectorState.draftSelected = new Set();
    updateCommandSelectionSummary();

    if (commandChatSelector) commandChatSelector.addEventListener('click', openCommandChatModal);
    if (commandChatModalClose) commandChatModalClose.addEventListener('click', () => closeCommandChatModal(false));
    if (commandChatCancel) commandChatCancel.addEventListener('click', () => closeCommandChatModal(false));
    if (commandChatAccept) commandChatAccept.addEventListener('click', () => closeCommandChatModal(true));
    if (commandChatSearch) commandChatSearch.addEventListener('input', renderCommandChatList);
    if (commandSelectAll) {
        commandSelectAll.addEventListener('click', () => {
            const allSelected = commandChatSelectorState.chats.length > 0 && commandChatSelectorState.draftSelected.size === commandChatSelectorState.chats.length;
            commandChatSelectorState.draftSelected = allSelected
                ? new Set()
                : new Set(commandChatSelectorState.chats.map((chat) => String(chat.id || '')).filter(Boolean));
            renderCommandChatList();
        });
    }

    if (resetCommandBtn) {
        resetCommandBtn.addEventListener('click', async () => {
            const selectedCount = getSelectedCommandChatIds().length;
            if (!selectedCount) return window.swalAlert('Falta el contacto', 'Selecciona al menos un chat antes de ejecutar Reset.', 'warning');
            setCommandButtonBusy(resetCommandBtn, true, 'Reiniciando...');
            try {
                await runBotCommandForSelectedChats('#RESET#');
                window.swalAlert('Asistente reiniciado', `${selectedCount} chat${selectedCount === 1 ? '' : 's'} vuelto${selectedCount === 1 ? '' : 's'} a asistente1.`, 'success');
            } catch (err) {
                window.swalAlert('Error', err.message || 'No se pudo ejecutar #RESET#', 'error');
            } finally {
                setCommandButtonBusy(resetCommandBtn, false);
            }
        });
    }

    if (newThreadCommandBtn) {
        newThreadCommandBtn.addEventListener('click', async () => {
            const selectedCount = getSelectedCommandChatIds().length;
            if (!selectedCount) return window.swalAlert('Falta el contacto', 'Selecciona al menos un chat antes de ejecutar Hilo nuevo.', 'warning');
            const confirmed = await window.swalConfirm('Borrar historial?', `Se eliminara el historial de ${selectedCount} chat${selectedCount === 1 ? '' : 's'} y se iniciara un hilo limpio.`);
            if (!confirmed) return;
            setCommandButtonBusy(newThreadCommandBtn, true, 'Borrando...');
            try {
                await runBotCommandForSelectedChats('#HILO_NUEVO#');
                window.swalAlert('Hilo nuevo iniciado', `Historial eliminado en ${selectedCount} chat${selectedCount === 1 ? '' : 's'}.`, 'success');
            } catch (err) {
                window.swalAlert('Error', err.message || 'No se pudo ejecutar #HILO_NUEVO#', 'error');
            } finally {
                setCommandButtonBusy(newThreadCommandBtn, false);
            }
        });
    }

    // --- Modal Reiniciar Sesion ---
    const goResetBtn = document.getElementById('go-reset');
    const resetModal = document.getElementById('resetModal');
    const confirmSi = document.getElementById('confirmSi');
    const confirmNo = document.getElementById('confirmNo');

    if (goResetBtn) goResetBtn.addEventListener('click', (e) => { e.preventDefault(); resetModal.classList.remove('hidden'); });
    if (confirmNo) confirmNo.addEventListener('click', () => resetModal.classList.add('hidden'));
    if (confirmSi) {
        confirmSi.addEventListener('click', async () => {
            confirmSi.disabled = true;
            confirmSi.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reiniciando...';
            try {
                const token = localStorage.getItem('backoffice_token');
                const delRes = await fetch(`/api/delete-session?token=${token}`, { method: 'POST' });
                if (!delRes.ok) throw new Error("Error al borrar la sesión en DB");
                const restRes = await fetch(`/api/restart-bot?token=${encodeURIComponent(token || '')}`, { method: 'POST' });
                const restData = await restRes.json().catch(() => ({}));
                if (!restRes.ok || restData.success === false) throw new Error(restData.error || "Error al solicitar el reinicio del bot");
                resetModal.innerHTML = `<div class="glass-strong p-8 text-center"><i class="fas fa-check-circle" style="font-size:3rem;color:#25d366;display:block;margin-bottom:20px;"></i><h3 class="text-xl font-heading font-bold mb-3">¡Listo!</h3><p class="text-secondary-content text-sm">El bot se está reiniciando. La página se recargará en 5 segundos.</p></div>`;
                setTimeout(() => window.location.reload(), 5000);
            } catch (err) {
                console.error(err);
                window.swalAlert("Error", "Hubo un error: " + err.message, "error");
                confirmSi.disabled = false;
                confirmSi.innerText = 'SÍ, REINICIAR';
            }
        });
    }

    // --- Modal Desvincular Meta ---
    const goUnlinkBtn = document.getElementById('go-unlink-meta');
    const unlinkModal = document.getElementById('unlinkMetaModal');
    const confirmUnlinkSi = document.getElementById('confirmUnlinkSi');
    const confirmUnlinkNo = document.getElementById('confirmUnlinkNo');

    if (goUnlinkBtn) goUnlinkBtn.addEventListener('click', (e) => { e.preventDefault(); unlinkModal.classList.remove('hidden'); });
    if (confirmUnlinkNo) confirmUnlinkNo.addEventListener('click', () => unlinkModal.classList.add('hidden'));
    if (confirmUnlinkSi) {
        confirmUnlinkSi.addEventListener('click', async () => {
            confirmUnlinkSi.disabled = true;
            confirmUnlinkSi.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Desvinculando...';
            try {
                const token = localStorage.getItem('backoffice_token');
                const serviceParam = window.railwayServiceId ? `&serviceId=${encodeURIComponent(window.railwayServiceId)}` : '';
                const res = await fetch(`/api/backoffice/whatsapp/unlink-meta?projectId=${currentProjectId}${serviceParam}&token=${encodeURIComponent(token || '')}`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) {
                    throw new Error(data.error || "Error al desvincular de Meta en el servidor");
                }
                const warningText = data.restartWarning
                    ? ' La desvinculacion se completo, pero el reinicio automatico no pudo solicitarse.'
                    : ' La pagina se recargara en 5 segundos.';
                unlinkModal.innerHTML = `<div class="glass-strong p-8 text-center" style="border-top:5px solid #25d366;"><i class="fas fa-check-circle" style="font-size:3rem;color:#25d366;display:block;margin-bottom:20px;"></i><h3 class="text-xl font-heading font-bold mb-3">Listo</h3><p class="text-secondary-content text-sm">Meta fue desvinculado correctamente.${warningText}</p></div>`;
                setTimeout(() => window.location.reload(), 5000);
            } catch (err) {
                console.error(err);
                window.swalAlert("Error", "Hubo un error al desvincular Meta: " + err.message, "error");
                confirmUnlinkSi.disabled = false;
                confirmUnlinkSi.innerText = 'SÍ, DESVINCULAR';
            }
        });
    }

    // --- Modal Vaciar Contactos y Chats ---
    const goClearChatsBtn = document.getElementById('go-clear-chats');
    const clearChatsModal = document.getElementById('clearChatsModal');
    const confirmClearChatsSi = document.getElementById('confirmClearChatsSi');
    const confirmClearChatsNo = document.getElementById('confirmClearChatsNo');

    if (goClearChatsBtn) goClearChatsBtn.addEventListener('click', (e) => { e.preventDefault(); if (clearChatsModal) clearChatsModal.classList.remove('hidden'); });
    if (confirmClearChatsNo) confirmClearChatsNo.addEventListener('click', () => { if (clearChatsModal) clearChatsModal.classList.add('hidden'); });
    if (confirmClearChatsSi) {
        confirmClearChatsSi.addEventListener('click', async () => {
            confirmClearChatsSi.disabled = true;
            confirmClearChatsSi.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vaciando...';
            try {
                const token = localStorage.getItem('backoffice_token');
                const serviceParam = window.railwayServiceId ? `&serviceId=${encodeURIComponent(window.railwayServiceId)}` : '';
                const pId = currentProjectId || window.railwayProjectId || '';
                const projectParam = pId ? `&projectId=${encodeURIComponent(pId)}` : '';
                const res = await fetch(`/api/backoffice/chats/vaciar?token=${encodeURIComponent(token || '')}${serviceParam}${projectParam}`, { method: 'DELETE' });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.success === false) {
                    throw new Error(data.error || "Error al vaciar los contactos en el servidor");
                }
                if (clearChatsModal) {
                    clearChatsModal.innerHTML = `<div class="glass-strong p-8 text-center" style="border-top:5px solid #25d366;"><i class="fas fa-check-circle" style="font-size:3rem;color:#25d366;display:block;margin-bottom:20px;"></i><h3 class="text-xl font-heading font-bold mb-3">Vaciado Completo</h3><p class="text-secondary-content text-sm">Se han eliminado todos los contactos, mensajes y tickets de este servicio. La página se recargará en 4 segundos.</p></div>`;
                }
                setTimeout(() => window.location.reload(), 4000);
            } catch (err) {
                console.error(err);
                if (typeof window.swalAlert === 'function') {
                    window.swalAlert("Error", "Hubo un error al vaciar los contactos: " + err.message, "error");
                } else {
                    alert("Hubo un error al vaciar los contactos: " + err.message);
                }
                confirmClearChatsSi.disabled = false;
                confirmClearChatsSi.innerText = 'SÍ, VACIAR TODO';
            }
        });
    }

    // --- Generar QR manual ---
    const generateQrBtn = document.getElementById('generate-qr-btn');
    if (generateQrBtn) {
        generateQrBtn.addEventListener('click', async () => {
            const isGroup = isGroupConnectionTarget();
            setConnectionButtonsBusy(true);
            markQrRequestPending();
            scheduleQrNoResultGuard();
            showQrLoading(isGroup ? 'Generando QR de grupos' : 'Generando QR Baileys');
            try {
                const token = localStorage.getItem('backoffice_token');
                const res = await fetch(`/api/backoffice/baileys/start?token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        isGroup,
                        projectId: currentProjectId,
                        serviceId: getConexionServiceId()
                    })
                });
                if (res.ok) {
                    scheduleConnectionStatusRefreshes();
                } else {
                    const err = await res.json();
                    window.swalAlert('Error', 'Error al iniciar generador de QR: ' + (err.error || 'error desconocido'), 'error');
                    clearQrRequestPending();
                    hideQrPresentation();
                    setConnectionButtonsBusy(false);
                }
            } catch (e) {
                console.error(e);
                window.swalAlert('Error', 'Error al iniciar generador de QR', 'error');
                clearQrRequestPending();
                hideQrPresentation();
                setConnectionButtonsBusy(false);
            }
        });
    }

    // --- Generar Codigo de Vinculacion manual ---
    const generatePairingBtn = document.getElementById('generate-pairing-btn');
    const pairingPhoneInput = document.getElementById('pairing-phone-input');
    if (generatePairingBtn) {
        generatePairingBtn.addEventListener('click', async () => {
            const phoneNumber = pairingPhoneInput.value.trim();
            if (!phoneNumber) {
                window.swalAlert('Atencion', 'Por favor ingresa un numero de telefono valido (con codigo de pais, ej: 5491122334455)', 'warning');
                return;
            }

            const isGroup = isGroupConnectionTarget();

            setConnectionButtonsBusy(true);
            markQrRequestPending();
            scheduleQrNoResultGuard('No se pudo generar el codigo');
            showQrLoading('Solicitando codigo de vinculacion');

            try {
                const token = localStorage.getItem('backoffice_token');
                const res = await fetch(`/api/backoffice/baileys/start?token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        isGroup,
                        usePairingCode: true,
                        phoneNumber,
                        projectId: currentProjectId,
                        serviceId: getConexionServiceId()
                    })
                });
                if (res.ok) {
                    scheduleConnectionStatusRefreshes();
                } else {
                    const err = await res.json();
                    window.swalAlert('Error', 'Error al iniciar vinculacion: ' + (err.error || 'error desconocido'), 'error');
                    clearQrRequestPending();
                    hideQrPresentation();
                    setConnectionButtonsBusy(false);
                }
            } catch (e) {
                console.error(e);
                window.swalAlert('Error', 'Error al iniciar vinculacion', 'error');
                clearQrRequestPending();
                hideQrPresentation();
                setConnectionButtonsBusy(false);
            }
        });
    }
};

window.refreshConexionStatus = fetchStatus;

window.destroyConexionView = function () {
    _conexionIntervals.forEach(clearInterval);
    _conexionIntervals = [];
    if (_qrSkeletonTimer) clearTimeout(_qrSkeletonTimer);
    _qrSkeletonTimer = null;
    if (_qrNoResultTimer) clearTimeout(_qrNoResultTimer);
    _qrNoResultTimer = null;
    _lastRenderedQrSource = null;
    clearQrRequestPending();
};
