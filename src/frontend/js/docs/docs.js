/* global marked */
// docs.js - Logica de la pagina de documentacion

let _docsCurrentType = 'user';

async function _loadDocsContent() {
    const token = localStorage.getItem('backoffice_token');
    const contentEl = document.getElementById('content');
    if (!contentEl) return;
    try {
        const response = await fetch(`/api/backoffice/get-docs?token=${token}&type=${_docsCurrentType}`);
        const data = await response.json();
        if (data.success) {
            contentEl.innerHTML = window.marked ? marked.parse(data.content) : data.content;
        } else {
            contentEl.innerHTML = '<div style="color:red">Error: ' + data.error + '</div>';
        }
    } catch (err) {
        contentEl.innerHTML = '<div style="color:red">Error de conexion con el servidor de documentacion.</div>';
    }
}

window.switchDoc = function(type) {
    if (_docsCurrentType === type) return;
    _docsCurrentType = type;
    const userBtn = document.getElementById('btn-user-docs');
    const comandosBtn = document.getElementById('btn-comandos-docs');
    const apiEnvioBtn = document.getElementById('btn-api-envio-docs');
    const apiTemplatesBtn = document.getElementById('btn-api-templates-docs');
    const webhookBtn = document.getElementById('btn-webhook-docs');
    const connectBtn = document.getElementById('btn-connect-docs');
    const testGuiadoBtn = document.getElementById('btn-test-guiado-docs');
    if (userBtn) userBtn.classList.toggle('active', type === 'user');
    if (comandosBtn) comandosBtn.classList.toggle('active', type === 'comandos');
    if (apiEnvioBtn) apiEnvioBtn.classList.toggle('active', type === 'api_envio_recepcion');
    if (apiTemplatesBtn) apiTemplatesBtn.classList.toggle('active', type === 'api_templates');
    if (webhookBtn) webhookBtn.classList.toggle('active', type === 'webhook');
    if (connectBtn) connectBtn.classList.toggle('active', type === 'connect');
    if (testGuiadoBtn) testGuiadoBtn.classList.toggle('active', type === 'test_guiado');
    const contentEl = document.getElementById('content');
    if (contentEl) contentEl.innerHTML = 'Cargando manual...';
    _loadDocsContent();
};

window.initDocsView = function() {
    _docsCurrentType = 'user';
    const userBtn = document.getElementById('btn-user-docs');
    const comandosBtn = document.getElementById('btn-comandos-docs');
    const apiEnvioBtn = document.getElementById('btn-api-envio-docs');
    const apiTemplatesBtn = document.getElementById('btn-api-templates-docs');
    const webhookBtn = document.getElementById('btn-webhook-docs');
    const connectBtn = document.getElementById('btn-connect-docs');
    const testGuiadoBtn = document.getElementById('btn-test-guiado-docs');
    if (userBtn) userBtn.classList.add('active');
    if (comandosBtn) comandosBtn.classList.remove('active');
    if (apiEnvioBtn) apiEnvioBtn.classList.remove('active');
    if (apiTemplatesBtn) apiTemplatesBtn.classList.remove('active');
    if (webhookBtn) webhookBtn.classList.remove('active');
    if (connectBtn) connectBtn.classList.remove('active');
    if (testGuiadoBtn) testGuiadoBtn.classList.remove('active');
    _loadDocsContent();
};
