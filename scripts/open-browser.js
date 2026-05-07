// Espera a que el servidor esté listo y luego abre el browser
import { exec } from 'child_process';

const TARGET_URL = process.argv[2] || 'http://localhost:8080/backoffice';
const HEALTH_URL = TARGET_URL.replace(/\/[^/]*$/, '/health');
const POLL_MS    = 2000;
const MAX_TRIES  = 30; // 60 segundos máximo

let tries = 0;

const openBrowser = () => {
    const cmd = process.platform === 'win32' ? `start "" "${TARGET_URL}"`
              : process.platform === 'darwin' ? `open "${TARGET_URL}"`
              : `xdg-open "${TARGET_URL}"`;
    exec(cmd, err => {
        if (err) console.error('[browser] No se pudo abrir el navegador:', err.message);
    });
};

const poll = async () => {
    tries++;
    try {
        const res = await fetch(HEALTH_URL);
        if (res.ok) {
            console.log(`\n[browser] ✅ Servidor listo. Abriendo ${TARGET_URL}\n`);
            openBrowser();
            return;
        }
    } catch {
        // server aún no responde
    }

    if (tries >= MAX_TRIES) {
        console.warn('[browser] ⚠️  Timeout esperando el servidor. Abriendo de todas formas...');
        openBrowser();
        return;
    }

    setTimeout(poll, POLL_MS);
};

console.log(`[browser] Esperando que el servidor esté en ${HEALTH_URL}...`);
setTimeout(poll, POLL_MS); // primer intento a los 2s
