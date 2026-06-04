/* global logout */
// main.js - Webchat widget. initWebchatView() es el unico punto de entrada (SPA).

// ===== Viewport dinamico =====
function setAppVh() {
    const h = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-vh', `${h}px`);
}
setAppVh();
window.addEventListener('resize', setAppVh, { passive: true });
window.addEventListener('orientationchange', setAppVh, { passive: true });
window.addEventListener('pageshow', setAppVh, { passive: true });
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppVh, { passive: true });
    window.visualViewport.addEventListener('scroll', setAppVh, { passive: true });
}

// ===== Autosize helpers (sin estado global de DOM) =====
let _wcMinH = 45, _wcMaxH = 120, _wcBaseH = 45;

function _computeHeights(el) {
    const cs = getComputedStyle(el);
    const minH  = parseFloat(cs.minHeight)      || 45;
    const maxH  = parseFloat(cs.maxHeight)       || 120;
    const lineH = parseFloat(cs.lineHeight)      || 20;
    const vPad  = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const vBord = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const baseH = Math.max(minH, Math.ceil(lineH + vPad + vBord));
    return { minH, maxH, baseH };
}

function _autosizeSmart(el) {
    const HYST = 1;
    if (!el.value.trim()) { el.style.height = _wcBaseH + 'px'; return; }
    el.style.height = _wcBaseH + 'px';
    const sh = el.scrollHeight;
    if (sh <= _wcBaseH + HYST) { el.style.height = _wcBaseH + 'px'; return; }
    el.style.height = Math.min(sh, _wcMaxH) + 'px';
}

// ===== SPA entry point =====
window.initWebchatView = function () {
    const _input    = document.getElementById('input');
    const _send     = document.getElementById('send');
    const _attach   = document.getElementById('attach');
    const _fileInput = document.getElementById('fileInput');
    if (!_input || !_send) return;

    // Calcular alturas desde el DOM actual
    ({ minH: _wcMinH, maxH: _wcMaxH, baseH: _wcBaseH } = _computeHeights(_input));
    setAppVh();
    _input.style.height = _wcBaseH + 'px';

    function _chat() { return document.getElementById('chat'); }

    function _addMsg(text, type) {
        const c = _chat();
        if (!c) return;
        const div = document.createElement('div');
        div.className = 'msg ' + type;
        div.innerText = text;
        c.appendChild(div);
        c.scrollTop = c.scrollHeight;
        if (type === 'assistant') {
            let audio = document.getElementById('msgReceivedAudio');
            if (!audio) {
                audio = document.createElement('audio');
                audio.id = 'msgReceivedAudio';
                audio.src = '/assets/msgReceived.mp3';
                audio.style.display = 'none';
                document.body.appendChild(audio);
            }
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
    }

    const token = localStorage.getItem('backoffice_token');

    function _doSend() {
        const msg = _input.value.trim();
        if (!msg) return;
        _addMsg(msg, 'user');
        _input.value = '';
        _autosizeSmart(_input);
        fetch(`/webchat-api?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        }).then(r => {
            if (r.status === 401) { logout(); return null; }
            return r.json();
        }).then(d => { if (d?.reply) _addMsg(d.reply, 'assistant'); })
          .catch(() => _addMsg('Error procesando tu mensaje.', 'assistant'));
    }

    function _sendPayload(type, base64, filename, mimeType) {
        const icon = type === 'image' ? '🖼️' : type === 'video' ? '📽️' : '📎';
        _addMsg(`${icon} ${filename}`, 'user');
        if (_fileInput) _fileInput.value = '';
        fetch(`/webchat-api?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: '', file: { base64, name: filename, mime: mimeType, type } })
        }).then(r => r.json())
          .then(d => { if (d?.reply) _addMsg(d.reply, 'assistant'); })
          .catch(() => _addMsg('Error enviando archivo.', 'assistant'));
    }

    function _handleFile(file) {
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { alert('Archivo demasiado grande (max 15MB)'); return; }
        if (file.type.startsWith('image/')) {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 1200;
                let w = img.width, h = img.height;
                if (w > h && w > MAX_SIZE) { h *= MAX_SIZE / w; w = MAX_SIZE; }
                else if (h > MAX_SIZE) { w *= MAX_SIZE / h; h = MAX_SIZE; }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                _sendPayload('image', canvas.toDataURL('image/jpeg', 0.85).split(',')[1], file.name, 'image/jpeg');
            };
            img.src = URL.createObjectURL(file);
        } else {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                let type = 'document';
                if (file.type.startsWith('audio/')) type = 'audio';
                else if (file.type.startsWith('video/')) type = 'video';
                _sendPayload(type, base64, file.name, file.type || 'application/octet-stream');
            };
            reader.readAsDataURL(file);
        }
    }

    // Event listeners (solo aqui, sin duplicados top-level)
    _input.addEventListener('input', function () {
        _autosizeSmart(this);
        const c = _chat(); if (c) c.scrollTop = c.scrollHeight;
    });
    _input.addEventListener('focus', () => {
        _autosizeSmart(_input);
        const c = _chat(); if (c) c.scrollTop = 99999;
    });
    _send.onclick = _doSend;
    _input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _doSend(); }
    });

    if (_attach && _fileInput) {
        _attach.onclick = (e) => { e.preventDefault(); _fileInput.click(); };
        _fileInput.onchange = function () { _handleFile(this.files[0]); };
    }

    // Recalcular alturas en resize
    window.addEventListener('resize', () => {
        const prev = _wcBaseH;
        ({ minH: _wcMinH, maxH: _wcMaxH, baseH: _wcBaseH } = _computeHeights(_input));
        if ((parseFloat(_input.style.height) || prev) <= prev + 1) {
            _input.style.height = _wcBaseH + 'px';
        } else {
            _autosizeSmart(_input);
        }
    }, { passive: true });

    // Nombre del asistente
    fetch('/api/assistant-name').then(r => r.json()).then(d => {
        const el = document.getElementById('assistantName');
        if (el && d.name) el.textContent = d.name;
    }).catch(() => {});
};
