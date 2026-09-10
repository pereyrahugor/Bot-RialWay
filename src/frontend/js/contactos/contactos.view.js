/* global navigate, showToast, Swal */
window.contactosView = (() => {
    const CHANNELS = [
        { id: 'whatsapp', label: 'WhatsApp', icon: 'fab fa-whatsapp' },
        { id: 'instagram', label: 'Instagram', icon: 'fab fa-instagram' },
        { id: 'facebook', label: 'Facebook', icon: 'fab fa-facebook' },
        { id: 'telegram', label: 'Telegram', icon: 'fab fa-telegram' },
        { id: 'webchat', label: 'Webchat', icon: 'fas fa-headset' },
    ];

    const state = {
        token: '',
        contacts: [],
        importRows: [],
        selectedChannel: '',
        selectedFileName: '',
        activeDuplicate: null,
        search: '',
        channelFilter: ''
    };

    function getHTML() {
        return `
        <main class="crm-main-container contactos-page" style="z-index:10; padding:0;">
            ${window.renderSectionTabs ? window.renderSectionTabs('messaging') : ''}

            <div class="kanban-header animate-fade">
                <div class="header-info">
                    <h1><i class="fas fa-address-book kanban-header-icon"></i> Contactos</h1>
                    <p>Agenda central por proyecto y servicio</p>
                </div>
                <div class="header-actions">
                    <button class="btn-primary" onclick="window.contactosView.openImportModal()">
                        <i class="fas fa-file-import"></i> Importar contactos
                    </button>
                </div>
            </div>

            <section class="contactos-toolbar">
                <div class="contactos-search">
                    <i class="fas fa-search"></i>
                    <input id="contactos-search-input" type="text" placeholder="Buscar por nombre, numero o canal" oninput="window.contactosView.handleSearch(this.value)">
                </div>
                <select id="contactos-channel-filter" onchange="window.contactosView.handleChannelFilter(this.value)">
                    <option value="">Todos los canales</option>
                    ${CHANNELS.map(ch => `<option value="${ch.id}">${ch.label}</option>`).join('')}
                </select>
                <button class="btn-secondary" onclick="window.contactosView.loadContacts()">
                    <i class="fas fa-rotate-right"></i> Actualizar
                </button>
            </section>

            <section id="contactos-duplicate-alert" class="contactos-duplicate-alert" style="display:none;"></section>

            <section class="contactos-list-shell">
                <div class="contactos-table-head">
                    <span>Numero</span>
                    <span>Nombre</span>
                    <span>Canal</span>
                    <span></span>
                </div>
                <div id="contactos-list" class="contactos-list">
                    <div class="contactos-empty"><i class="fas fa-circle-notch fa-spin"></i> Cargando contactos...</div>
                </div>
            </section>

            ${renderImportModal()}
            ${renderMergeModal()}
        </main>`;
    }

    function renderImportModal() {
        return `
        <div id="contact-import-modal" class="modal-overlay">
            <div class="modal-content modal-content-lg contactos-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-file-import modal-h3-icon"></i> Importar contactos</h3>
                    <button class="modal-close" onclick="window.contactosView.closeImportModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="contactos-channel-grid">
                        ${CHANNELS.map(ch => `
                            <button class="contactos-channel-option" data-channel="${ch.id}" onclick="window.contactosView.selectImportChannel('${ch.id}')">
                                <i class="${ch.icon}"></i>
                                <span>${ch.label}</span>
                            </button>
                        `).join('')}
                    </div>

                    <div id="contactos-import-file-step" class="contactos-import-file-step" style="display:none;">
                        <label for="contactos-import-file"><i class="fas fa-file-arrow-up"></i> Archivo</label>
                        <input id="contactos-import-file" type="file" accept=".xlsx,.xls,.vcf,.csv" onchange="window.contactosView.handleImportFile(this.files)">
                    </div>

                    <div id="contactos-import-summary" class="contactos-import-summary" style="display:none;"></div>
                    <div id="contactos-import-preview" class="contactos-import-preview"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="window.contactosView.closeImportModal()">Cancelar</button>
                    <button id="contactos-save-import-btn" class="btn-success" onclick="window.contactosView.saveImport()" disabled>
                        <i class="fas fa-check"></i> Guardar contactos
                    </button>
                </div>
            </div>
        </div>`;
    }

    function renderMergeModal() {
        return `
        <div id="contact-merge-modal" class="modal-overlay">
            <div class="modal-content modal-content-lg contactos-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-code-merge modal-h3-icon"></i> Combinar duplicados</h3>
                    <button class="modal-close" onclick="window.contactosView.closeMergeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="contactos-merge-grid">
                        <div>
                            <h4 class="contactos-merge-title">Filas detectadas</h4>
                            <div id="contactos-merge-options" class="contactos-merge-options"></div>
                        </div>
                        <div>
                            <h4 class="contactos-merge-title">Contacto final</h4>
                            <div class="contactos-merge-form">
                                <label>Numero</label>
                                <input id="contactos-merge-phone" type="text">
                                <label>Nombre</label>
                                <input id="contactos-merge-name" type="text">
                                <label>Email</label>
                                <input id="contactos-merge-email" type="email">
                                <label>Identificador del canal</label>
                                <input id="contactos-merge-channel-value" type="text">
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="window.contactosView.closeMergeModal()">Cancelar</button>
                    <button class="btn-success" onclick="window.contactosView.applyMerge()">
                        <i class="fas fa-check"></i> Combinar
                    </button>
                </div>
            </div>
        </div>`;
    }

    async function init() {
        state.token = localStorage.getItem('backoffice_token') || localStorage.getItem('system_config_token') || '';
        state.contacts = [];
        state.importRows = [];
        state.selectedChannel = '';
        state.selectedFileName = '';
        await loadContacts();
    }

    function destroy() {
        state.activeDuplicate = null;
    }

    async function loadContacts() {
        const list = document.getElementById('contactos-list');
        if (list) list.innerHTML = '<div class="contactos-empty"><i class="fas fa-circle-notch fa-spin"></i> Cargando contactos...</div>';

        try {
            const params = new URLSearchParams();
            params.set('token', state.token);
            params.set('limit', '200');
            if (window.railwayProjectId) params.set('projectId', window.railwayProjectId);
            if (window.railwayServiceId) params.set('serviceId', window.railwayServiceId);
            if (state.search) params.set('search', state.search);
            if (state.channelFilter) params.set('channel', state.channelFilter);

            const res = await fetch(`/api/backoffice/contacts?${params.toString()}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar los contactos');

            state.contacts = Array.isArray(data.contacts) ? data.contacts : [];
            renderContacts();
        } catch (error) {
            console.error('[Contactos] Error cargando:', error);
            if (list) list.innerHTML = `<div class="contactos-empty error">${escapeHtml(error.message)}</div>`;
        }
    }

    function renderContacts() {
        const list = document.getElementById('contactos-list');
        if (!list) return;

        renderDuplicateAlert('saved', state.contacts);

        if (!state.contacts.length) {
            list.innerHTML = '<div class="contactos-empty">No hay contactos cargados.</div>';
            return;
        }

        list.innerHTML = state.contacts.map(contact => {
            const channel = getContactChannel(contact);
            const phone = contact.phone_normalized || contact.phone_raw || contact.whatsapp_channel || '-';
            const name = contact.name || '-';
            return `
                <article class="contactos-row">
                    <span class="contactos-cell contactos-phone">${escapeHtml(phone)}</span>
                    <span class="contactos-cell contactos-name">${escapeHtml(name)}</span>
                    <span class="contactos-cell">
                        <span class="contactos-channel-badge">${channel.icon ? `<i class="${channel.icon}"></i>` : ''}${escapeHtml(channel.label)}</span>
                    </span>
                    <span class="contactos-cell contactos-row-actions">
                        <button class="btn-secondary btn-sm" onclick="window.contactosView.openEditContact('${contact.id}')">
                            <i class="fas fa-pen"></i> Editar
                        </button>
                    </span>
                </article>
            `;
        }).join('');
    }

    function handleSearch(value) {
        state.search = String(value || '').trim();
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(loadContacts, 250);
    }

    function handleChannelFilter(value) {
        state.channelFilter = value || '';
        loadContacts();
    }

    function openImportModal() {
        state.importRows = [];
        state.selectedChannel = '';
        state.selectedFileName = '';
        const modal = document.getElementById('contact-import-modal');
        if (modal) modal.style.display = 'flex';
        resetImportModal();
    }

    function closeImportModal() {
        const modal = document.getElementById('contact-import-modal');
        if (modal) modal.style.display = 'none';
    }

    function resetImportModal() {
        document.querySelectorAll('.contactos-channel-option').forEach(btn => btn.classList.remove('active'));
        const fileStep = document.getElementById('contactos-import-file-step');
        const input = document.getElementById('contactos-import-file');
        const preview = document.getElementById('contactos-import-preview');
        const summary = document.getElementById('contactos-import-summary');
        const saveBtn = document.getElementById('contactos-save-import-btn');
        if (fileStep) fileStep.style.display = 'none';
        if (input) input.value = '';
        if (preview) preview.innerHTML = '';
        if (summary) {
            summary.innerHTML = '';
            summary.style.display = 'none';
        }
        if (saveBtn) saveBtn.disabled = true;
    }

    function selectImportChannel(channel) {
        state.selectedChannel = channel;
        document.querySelectorAll('.contactos-channel-option').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-channel') === channel);
        });
        const fileStep = document.getElementById('contactos-import-file-step');
        if (fileStep) fileStep.style.display = 'block';
    }

    async function handleImportFile(files) {
        const file = files && files[0];
        if (!file || !state.selectedChannel) return;

        state.selectedFileName = file.name;
        const preview = document.getElementById('contactos-import-preview');
        if (preview) preview.innerHTML = '<div class="contactos-empty"><i class="fas fa-circle-notch fa-spin"></i> Procesando archivo...</div>';

        try {
            const ext = file.name.split('.').pop().toLowerCase();
            let rows = [];
            if (ext === 'vcf') rows = parseVcf(await file.text());
            else if (ext === 'csv') rows = parseCsv(await file.text());
            else if (ext === 'xlsx' || ext === 'xls') rows = await parseWorkbook(file);
            else throw new Error('Formato no soportado');

            state.importRows = rows
                .map((row, index) => normalizeImportRow(row, index, state.selectedChannel))
                .filter(row => row.name || row.phoneNormalized || row.email || row.channelValue);

            renderImportPreview();
        } catch (error) {
            console.error('[Contactos] Error importando:', error);
            if (preview) preview.innerHTML = `<div class="contactos-empty error">${escapeHtml(error.message)}</div>`;
            const saveBtn = document.getElementById('contactos-save-import-btn');
            if (saveBtn) saveBtn.disabled = true;
        }
    }

    function renderImportPreview() {
        const preview = document.getElementById('contactos-import-preview');
        const summary = document.getElementById('contactos-import-summary');
        const saveBtn = document.getElementById('contactos-save-import-btn');
        if (!preview || !summary || !saveBtn) return;

        const duplicateGroups = findDuplicateGroups(state.importRows);
        summary.style.display = 'flex';
        summary.innerHTML = `
            <span><i class="fas fa-list"></i> ${state.importRows.length} contactos detectados</span>
            <span><i class="fas fa-layer-group"></i> ${duplicateGroups.length} duplicados</span>
            <span><i class="fas fa-file"></i> ${escapeHtml(state.selectedFileName)}</span>
        `;

        if (!state.importRows.length) {
            preview.innerHTML = '<div class="contactos-empty">No se detectaron contactos validos.</div>';
            saveBtn.disabled = true;
            return;
        }

        const duplicateIds = new Set(duplicateGroups.flatMap(group => group.rows.map(row => row._tmpId)));
        const duplicatesHtml = duplicateGroups.length ? `
            <div class="contactos-import-duplicates">
                <span><i class="fas fa-triangle-exclamation"></i> Hay contactos duplicados por nombre o numero.</span>
                ${duplicateGroups.map((group, index) => `
                    <button class="btn-secondary btn-sm" onclick="window.contactosView.openMergeDuplicate('preview', ${index})">
                        Combinar ${group.rows.length}
                    </button>
                `).join('')}
            </div>
        ` : '';

        preview.innerHTML = `
            ${duplicatesHtml}
            <div class="contactos-preview-table">
                ${state.importRows.map(row => `
                    <div class="contactos-preview-row${duplicateIds.has(row._tmpId) ? ' duplicate' : ''}">
                        <span>${escapeHtml(row.phoneNormalized || row.phoneRaw || '-')}</span>
                        <span>${escapeHtml(row.name || '-')}</span>
                        <span>${escapeHtml(getChannelLabel(row.channel))}</span>
                    </div>
                `).join('')}
            </div>
        `;
        saveBtn.disabled = false;
    }

    async function saveImport() {
        if (!state.importRows.length) return;

        const saveBtn = document.getElementById('contactos-save-import-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...';
        }

        let saved = 0;
        let failed = 0;

        const targetProjectId = (typeof window !== 'undefined' && window.railwayProjectId) ? window.railwayProjectId : '';
        const targetServiceId = (typeof window !== 'undefined' && window.railwayServiceId) ? window.railwayServiceId : '';

        for (const row of state.importRows) {
            try {
                const params = new URLSearchParams({ token: state.token });
                if (targetProjectId) params.set('projectId', targetProjectId);
                if (targetServiceId) params.set('serviceId', targetServiceId);

                const res = await fetch(`/api/backoffice/contacts?${params.toString()}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        channel: row.channel,
                        channelValue: row.channelValue,
                        name: row.name,
                        phoneRaw: row.phoneRaw,
                        phoneNormalized: row.phoneNormalized,
                        email: row.email,
                        source: 'import_file',
                        projectId: targetProjectId,
                        serviceId: targetServiceId,
                        metadata: {
                            file_name: state.selectedFileName,
                            original_row: row.originalIndex + 1
                        }
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Error guardando contacto');
                saved += 1;
            } catch (error) {
                console.error('[Contactos] Error guardando fila:', error);
                failed += 1;
            }
        }

        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Guardar contactos';
            saveBtn.disabled = false;
        }

        closeImportModal();
        notify(`Importacion finalizada: ${saved} guardados${failed ? `, ${failed} errores` : ''}.`, failed ? 'warning' : 'success');
        await loadContacts();
    }

    function renderDuplicateAlert(scope, rows) {
        const target = document.getElementById('contactos-duplicate-alert');
        if (!target) return;
        const groups = findDuplicateGroups(rows);
        if (!groups.length) {
            target.style.display = 'none';
            target.innerHTML = '';
            return;
        }

        target.style.display = 'flex';
        target.innerHTML = `
            <span><i class="fas fa-triangle-exclamation"></i> ${groups.length} grupo(s) duplicado(s) detectado(s).</span>
            <div class="contactos-duplicate-actions">
                ${groups.slice(0, 4).map((group, index) => `
                    <button class="btn-secondary btn-sm" onclick="window.contactosView.openMergeDuplicate('${scope}', ${index})">
                        Combinar ${group.rows.length}
                    </button>
                `).join('')}
            </div>
        `;
    }

    function findDuplicateGroups(rows) {
        const groups = new Map();
        rows.forEach(row => {
            const phone = normalizePhone(row.phone_normalized || row.phoneNormalized || row.phone_raw || row.phoneRaw || row.whatsapp_channel || row.whatsappChannel);
            const name = normalizeName(row.name);
            if (phone) addDuplicateKey(groups, `phone:${phone}`, 'numero', row);
            if (name) addDuplicateKey(groups, `name:${name}`, 'nombre', row);
        });
        return Array.from(groups.values()).filter(group => group.rows.length > 1);
    }

    function addDuplicateKey(groups, key, type, row) {
        if (!groups.has(key)) groups.set(key, { key, type, rows: [] });
        const group = groups.get(key);
        if (!group.rows.some(item => getRowId(item) === getRowId(row))) group.rows.push(row);
    }

    function openMergeDuplicate(scope, index) {
        const rows = scope === 'preview' ? state.importRows : state.contacts;
        const group = findDuplicateGroups(rows)[index];
        if (!group) return;

        state.activeDuplicate = { scope, group };
        const modal = document.getElementById('contact-merge-modal');
        const options = document.getElementById('contactos-merge-options');
        if (!modal || !options) return;

        options.innerHTML = group.rows.map((row, rowIndex) => `
            <label class="contactos-merge-option">
                <input type="radio" name="contactos-merge-keeper" value="${rowIndex}" ${rowIndex === 0 ? 'checked' : ''} onchange="window.contactosView.selectMergeKeeper(${rowIndex})">
                <span>
                    <strong>Fila ${getDisplayRowNumber(row)}</strong>
                    <em>${escapeHtml(row.name || '-')}</em>
                    <small>${escapeHtml(row.phone_normalized || row.phoneNormalized || row.phone_raw || row.phoneRaw || '-')}</small>
                </span>
            </label>
        `).join('');

        fillMergeForm(group.rows[0]);
        modal.style.display = 'flex';
    }

    function selectMergeKeeper(index) {
        const row = state.activeDuplicate?.group?.rows?.[index];
        if (row) fillMergeForm(row);
    }

    function fillMergeForm(row) {
        setValue('contactos-merge-phone', row.phone_normalized || row.phoneNormalized || row.phone_raw || row.phoneRaw || '');
        setValue('contactos-merge-name', row.name || '');
        setValue('contactos-merge-email', row.email || '');
        setValue('contactos-merge-channel-value', getChannelValue(row) || '');
    }

    function closeMergeModal() {
        const modal = document.getElementById('contact-merge-modal');
        if (modal) modal.style.display = 'none';
        state.activeDuplicate = null;
    }

    async function applyMerge() {
        const active = state.activeDuplicate;
        if (!active) return;

        const selectedIndex = Number(document.querySelector('input[name="contactos-merge-keeper"]:checked')?.value || 0);
        const keeper = active.group.rows[selectedIndex] || active.group.rows[0];
        const phoneRaw = getValue('contactos-merge-phone');
        const phoneNormalized = normalizePhone(phoneRaw);
        const finalRow = {
            ...keeper,
            name: getValue('contactos-merge-name'),
            email: getValue('contactos-merge-email'),
            phoneRaw,
            phoneNormalized,
            channelValue: getValue('contactos-merge-channel-value') || phoneNormalized || phoneRaw,
            channel: keeper.channel || getContactChannel(keeper).id || state.selectedChannel || 'whatsapp'
        };

        if (active.scope === 'preview') {
            const duplicateIds = new Set(active.group.rows.map(getRowId));
            state.importRows = state.importRows.filter(row => !duplicateIds.has(getRowId(row)));
            state.importRows.push(finalRow);
            closeMergeModal();
            renderImportPreview();
            return;
        }

        try {
            const keeperId = keeper.id;
            if (!keeperId) throw new Error('No se encontro el contacto principal');

            const body = {
                channel: finalRow.channel,
                channelValue: finalRow.channelValue,
                name: finalRow.name,
                email: finalRow.email,
                phoneRaw: finalRow.phoneRaw,
                phoneNormalized: finalRow.phoneNormalized
            };

            const patchRes = await fetch(`/api/backoffice/contacts/${keeperId}?token=${encodeURIComponent(state.token)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const patchData = await patchRes.json();
            if (!patchRes.ok || !patchData.success) throw new Error(patchData.error || 'No se pudo actualizar el contacto');

            const deleteRows = active.group.rows.filter(row => row.id && row.id !== keeperId);
            for (const row of deleteRows) {
                const delRes = await fetch(`/api/backoffice/contacts/${row.id}?token=${encodeURIComponent(state.token)}`, { method: 'DELETE' });
                if (!delRes.ok) console.warn('[Contactos] No se pudo borrar duplicado:', row.id);
            }

            closeMergeModal();
            notify('Duplicados combinados.', 'success');
            await loadContacts();
        } catch (error) {
            console.error('[Contactos] Error combinando:', error);
            notify(error.message, 'error');
        }
    }

    function openEditContact(contactId) {
        const contact = state.contacts.find(item => item.id === contactId);
        if (!contact) return;
        state.activeDuplicate = { scope: 'saved', group: { rows: [contact] } };
        const modal = document.getElementById('contact-merge-modal');
        const options = document.getElementById('contactos-merge-options');
        if (!modal || !options) return;
        options.innerHTML = `
            <label class="contactos-merge-option">
                <input type="radio" name="contactos-merge-keeper" value="0" checked>
                <span>
                    <strong>Contacto guardado</strong>
                    <em>${escapeHtml(contact.name || '-')}</em>
                    <small>${escapeHtml(contact.phone_normalized || contact.phone_raw || '-')}</small>
                </span>
            </label>
        `;
        fillMergeForm(contact);
        modal.style.display = 'flex';
    }

    function normalizeImportRow(row, index, channel) {
        const name = pickValue(row, ['nombre', 'name', 'full name', 'fullname', 'razon social', 'razon_social', 'fn']);
        const phoneRaw = pickValue(row, ['telefono', 'teléfono', 'phone', 'numero', 'número', 'whatsapp', 'celular', 'mobile', 'tel']);
        const email = pickValue(row, ['email', 'mail', 'correo']);
        const channelValue = pickValue(row, [channel, `${channel}_channel`, 'usuario', 'username', 'id', 'identificador']) || phoneRaw || email || name;
        const phoneNormalized = normalizePhone(phoneRaw);

        return {
            _tmpId: `row-${Date.now()}-${index}`,
            originalIndex: index,
            channel,
            channelValue: channel === 'whatsapp' ? phoneNormalized || phoneRaw : String(channelValue || '').trim(),
            name: String(name || '').trim(),
            phoneRaw: String(phoneRaw || '').trim(),
            phoneNormalized,
            email: String(email || '').trim()
        };
    }

    function pickValue(row, keys) {
        const normalizedMap = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            normalizedMap[normalizeHeader(key)] = value;
        });
        for (const key of keys) {
            const value = normalizedMap[normalizeHeader(key)];
            if (value !== null && value !== undefined && String(value).trim() !== '') return value;
        }
        return '';
    }

    function parseCsv(text) {
        const rows = [];
        const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
        if (!lines.length) return rows;
        const headers = parseCsvLine(lines[0]);
        for (let i = 1; i < lines.length; i += 1) {
            const values = parseCsvLine(lines[i]);
            const row = {};
            headers.forEach((header, index) => { row[header] = values[index] || ''; });
            rows.push(row);
        }
        return rows;
    }

    function parseCsvLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i += 1) {
            const char = line[i];
            const next = line[i + 1];
            if (char === '"' && inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if ((char === ',' || char === ';') && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim());
        return values;
    }

    function parseVcf(text) {
        const cards = String(text || '').split(/BEGIN:VCARD/i).slice(1);
        return cards.map(card => {
            const lines = card.split(/\r?\n/);
            const row = {};
            lines.forEach(line => {
                const idx = line.indexOf(':');
                if (idx === -1) return;
                const key = line.slice(0, idx).split(';')[0].toUpperCase();
                const value = line.slice(idx + 1).trim();
                if (key === 'FN') row.nombre = value;
                if (key === 'N' && !row.nombre) row.nombre = value.split(';').filter(Boolean).join(' ');
                if (key === 'TEL' && !row.telefono) row.telefono = value;
                if (key === 'EMAIL' && !row.email) row.email = value;
            });
            return row;
        });
    }

    async function parseWorkbook(file) {
        await ensureXlsx();
        const buffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }

    function ensureXlsx() {
        if (window.XLSX) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar el lector XLSX'));
            document.head.appendChild(script);
        });
    }

    function normalizePhone(value) {
        const raw = String(value || '').trim();
        if (!raw || raw.includes('@g.us')) return '';
        let digits = raw.replace(/@(s\.whatsapp\.net|c\.us|lid)$/i, '').split(':')[0].replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        if (digits.startsWith('54') && !digits.startsWith('549') && digits.length >= 12) {
            digits = `549${digits.slice(2)}`;
        }
        return digits;
    }

    function normalizeName(value) {
        return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function normalizeHeader(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ');
    }

    function getContactChannel(contact) {
        const found = CHANNELS.find(ch => contact[`${ch.id}_channel`] || contact.channel === ch.id);
        return found || { id: '', label: '-', icon: '' };
    }

    function getChannelLabel(channelId) {
        return CHANNELS.find(ch => ch.id === channelId)?.label || channelId || '-';
    }

    function getChannelValue(row) {
        const channel = row.channel || getContactChannel(row).id;
        return row.channelValue || row.channel_value || row[`${channel}_channel`] || '';
    }

    function getRowId(row) {
        return row.id || row._tmpId || `${row.name || ''}:${row.phone_normalized || row.phoneNormalized || row.phone_raw || row.phoneRaw || ''}`;
    }

    function getDisplayRowNumber(row) {
        return row.originalIndex !== undefined ? row.originalIndex + 1 : row.id ? row.id.slice(0, 8) : '-';
    }

    function getValue(id) {
        return String(document.getElementById(id)?.value || '').trim();
    }

    function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    }

    function notify(message, type = 'info') {
        if (typeof showToast === 'function') showToast(message, type);
        else if (window.Swal) Swal.fire({ text: message, icon: type, timer: 2200, showConfirmButton: false });
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return {
        getHTML,
        init,
        destroy,
        loadContacts,
        handleSearch,
        handleChannelFilter,
        openImportModal,
        closeImportModal,
        selectImportChannel,
        handleImportFile,
        saveImport,
        openMergeDuplicate,
        closeMergeModal,
        selectMergeKeeper,
        applyMerge,
        openEditContact
    };
})();
