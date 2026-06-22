import { spawn } from 'child_process';

const port = process.env.PORT || 8080;

console.log('🚀 Iniciando el servidor local y conectando con Cloudflare...\n');

let publicUrl = null;
let serverStarted = false;

function printUrlIfReady() {
    if (publicUrl && serverStarted) {
        console.log('=============================================================');
        console.log('📱 ENLACE PÚBLICO LISTO PARA PROBAR EN TU TELÉFONO:');
        console.log(`👉  \x1b[32m\x1b[1m${publicUrl}\x1b[0m`);
        console.log('=============================================================\n');
    }
}

// 1. Iniciar servidor de desarrollo
const devProcess = spawn('pnpm', ['run', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'], // Capturamos para buscar el texto de inicio
    shell: true
});

devProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
    const output = data.toString();
    if (output.includes(`Servidor local corriendo en http://localhost:${port}`)) {
        serverStarted = true;
        printUrlIfReady();
    }
});

devProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
});

// 2. Iniciar túnel de Cloudflare
const tunnelProcess = spawn('npx', ['cloudflared', 'tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
});

tunnelProcess.stderr.on('data', (data) => {
    const output = data.toString();
    // Buscar la URL en la salida de Cloudflare
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
        publicUrl = match[0];
        printUrlIfReady();
    }
});

// Limpieza al presionar Ctrl+C
process.on('SIGINT', () => {
    console.log('\nDeteniendo servidor y túnel...');
    devProcess.kill('SIGINT');
    tunnelProcess.kill('SIGINT');
    process.exit();
});
