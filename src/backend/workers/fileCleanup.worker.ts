import fs from 'fs';
import path from 'path';

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
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile() && (now - stat.mtimeMs) > thresholdMs) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    }
                } catch (_e) { /* ignore locked/missing files */ }
            }
            if (deletedCount > 0) {
                console.log(`🧹 [Worker] Directorio '${dirName}': ${deletedCount} archivos eliminados (> ${daysThreshold} días).`);
            }
        } catch (e: any) {
            console.error(`❌ [Worker] Error limpiando '${dirName}':`, e.message);
        }
    };

    const runCleanup = () => {
        cleanDirectory('tmp');
        cleanDirectory('uploads');
        cleanDirectory('temp/drive');
    };

    runCleanup();
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
};
