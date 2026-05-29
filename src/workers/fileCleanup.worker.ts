import fs from 'fs';
import path from 'path';

/**
 * Inicia un worker que corre cada 24 horas y elimina archivos locales en 'tmp' y 'uploads'
 * con más de 5 días de antigüedad.
 */
export const startFileCleanupWorker = (daysThreshold = 5) => {
    console.log(`🧹 [Worker] Iniciando worker de limpieza de archivos temporales (límite: ${daysThreshold} días)...`);

    const cleanDirectory = (dirName: string) => {
        const dirPath = path.join(process.cwd(), dirName);
        if (!fs.existsSync(dirPath)) return;

        try {
            const files = fs.readdirSync(dirPath);
            const now = Date.now();
            const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                
                // Evitar borrar el propio directorio o archivos que no se puedan leer
                try {
                    const stat = fs.statSync(filePath);

                    if (stat.isFile()) {
                        const ageMs = now - stat.mtimeMs;
                        if (ageMs > thresholdMs) {
                            fs.unlinkSync(filePath);
                            deletedCount++;
                        }
                    }
                } catch (err) {
                    // Ignorar errores individuales si el archivo está bloqueado o desapareció
                }
            }

            if (deletedCount > 0) {
                console.log(`🧹 [Worker] [Limpieza] Directorio '${dirName}': Se eliminaron ${deletedCount} archivos obsoletos (> ${daysThreshold} días).`);
            }
        } catch (e: any) {
            console.error(`❌ [Worker] Error limpiando directorio '${dirName}':`, e.message);
        }
    };

    const runCleanup = () => {
        cleanDirectory('tmp');
        cleanDirectory('uploads');
    };

    // 1. Ejecutar inmediatamente al iniciar para hacer limpieza en frío
    runCleanup();

    // 2. Ejecutar cada 24 horas de forma continua
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
};
