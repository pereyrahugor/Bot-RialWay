import { spawn } from 'child_process';

const port = process.env.PORT || 8080;

console.log('🚀 Iniciando el servidor local y conectando con Cloudflare...\n');

// 1. Iniciar servidor de desarrollo
const devProcess = spawn('npm', ['run', 'dev'], {
    stdio: ['ignore', process.stdout, process.stderr], // Redirigir todos los logs de la app a la consola
    shell: true
});

// 2. Iniciar túnel de Cloudflare
const tunnelProcess = spawn('npx', ['cloudflared', 'tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'], // Capturamos la salida sin mostrar los logs molestos de Cloudflare
    shell: true
});

tunnelProcess.stderr.on('data', (data) => {
    const output = data.toString();
    // Buscar la URL en la salida de Cloudflare
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match) {
        console.log('\n=============================================================');
        console.log('📱 ENLACE PÚBLICO LISTO PARA PROBAR EN TU TELÉFONO:');
        console.log(`👉  \x1b[32m\x1b[1m${match[0]}\x1b[0m`);
        console.log('=============================================================\n');
    }
});

// Limpieza al presionar Ctrl+C
process.on('SIGINT', () => {
    console.log('\nDeteniendo servidor y túnel...');
    devProcess.kill('SIGINT');
    tunnelProcess.kill('SIGINT');
    process.exit();
});
