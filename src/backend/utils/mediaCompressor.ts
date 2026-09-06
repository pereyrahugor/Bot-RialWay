import fs from 'fs';
import path from 'path';

export interface CompressResult {
    outputPath: string;
    isCompressed: boolean;
    originalSizeMB: number;
    finalSizeMB: number;
}

let cachedGsCommand: string | null | undefined = undefined;

/**
 * Detecta qué ejecutable de Ghostscript está disponible en el sistema.
 * En Linux/Docker suele ser 'gs'. En Windows puede ser 'gswin64c', 'gswin32c' o 'gs'.
 */
export function getGhostscriptCommand(): string | null {
    if (cachedGsCommand !== undefined) return cachedGsCommand;

    const candidates = process.platform === 'win32'
        ? ['gswin64c', 'gswin32c', 'gs']
        : ['gs'];

    const { execSync } = require('child_process');
    for (const cmd of candidates) {
        try {
            execSync(`${cmd} --version`, { stdio: 'ignore' });
            cachedGsCommand = cmd;
            console.log(`✅ [MediaCompressor] Ghostscript detectado: ${cmd}`);
            return cmd;
        } catch (_) {}
    }

    cachedGsCommand = null;
    return null;
}

/**
 * Comprime un archivo PDF si supera el umbral especificado (por defecto 95MB para dar margen sobre el límite de 100MB de Meta).
 * Utiliza Ghostscript con presets optimizados para documentos móviles (/ebook -> 150dpi, fallback a /screen -> 72dpi).
 */
export async function compressPdfIfNeeded(
    filePath: string,
    maxSizeMB: number = 95.0
): Promise<CompressResult> {
    if (!filePath || !fs.existsSync(filePath)) {
        return { outputPath: filePath, isCompressed: false, originalSizeMB: 0, finalSizeMB: 0 };
    }

    const stats = fs.statSync(filePath);
    const originalSizeMB = stats.size / (1024 * 1024);

    if (originalSizeMB <= maxSizeMB) {
        return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.pdf') {
        return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
    }

    const gsCmd = getGhostscriptCommand();
    if (!gsCmd) {
        console.warn(`⚠️ [MediaCompressor] PDF de ${originalSizeMB.toFixed(2)}MB excede el límite de WhatsApp (100MB), pero Ghostscript ('gs') no está instalado en este entorno.`);
        return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
    }

    console.log(`📄 [MediaCompressor] PDF pesado (${originalSizeMB.toFixed(2)}MB). Iniciando compresión con Ghostscript (${gsCmd})...`);

    const dir = path.dirname(filePath);
    const base = path.basename(filePath, ext);
    const outPath = path.join(dir, `compressed_${Date.now()}_${base}.pdf`);

    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execPromise = promisify(exec);

        // Nivel 1: Preset /ebook (150 dpi, excelente balance de nitidez y peso para lectura en móviles)
        await execPromise(
            `"${gsCmd}" -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outPath}" "${filePath}"`
        );

        if (fs.existsSync(outPath)) {
            let compressedStats = fs.statSync(outPath);
            let compressedSizeMB = compressedStats.size / (1024 * 1024);

            // Nivel 2: Si aún supera el límite, aplicar preset /screen (72 dpi, máxima compresión)
            if (compressedSizeMB > maxSizeMB) {
                console.log(`⚠️ [MediaCompressor] Con preset /ebook aún pesa ${compressedSizeMB.toFixed(2)}MB. Re-intentando con preset /screen (72dpi)...`);
                const screenOutPath = path.join(dir, `screen_${Date.now()}_${base}.pdf`);
                await execPromise(
                    `"${gsCmd}" -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${screenOutPath}" "${filePath}"`
                );

                if (fs.existsSync(screenOutPath)) {
                    try { fs.unlinkSync(outPath); } catch (_) {}
                    compressedStats = fs.statSync(screenOutPath);
                    compressedSizeMB = compressedStats.size / (1024 * 1024);
                    console.log(`✅ [MediaCompressor] PDF comprimido exitosamente con /screen: ${originalSizeMB.toFixed(2)}MB -> ${compressedSizeMB.toFixed(2)}MB`);
                    return { outputPath: screenOutPath, isCompressed: true, originalSizeMB, finalSizeMB: compressedSizeMB };
                }
            }

            if (compressedSizeMB < originalSizeMB) {
                console.log(`✅ [MediaCompressor] PDF comprimido exitosamente: ${originalSizeMB.toFixed(2)}MB -> ${compressedSizeMB.toFixed(2)}MB`);
                return { outputPath: outPath, isCompressed: true, originalSizeMB, finalSizeMB: compressedSizeMB };
            } else {
                try { fs.unlinkSync(outPath); } catch (_) {}
            }
        }
    } catch (err: any) {
        console.error(`❌ [MediaCompressor] Error comprimiendo PDF con Ghostscript:`, err.message);
        if (fs.existsSync(outPath)) {
            try { fs.unlinkSync(outPath); } catch (_) {}
        }
    }

    return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
}

/**
 * Comprime un archivo de video si supera el umbral especificado (por defecto 15MB para dar margen sobre el límite de 16MB de Meta).
 * Utiliza ffmpeg recalculando bitrate dinámicamente según la duración.
 */
export async function compressVideoIfNeeded(
    filePath: string,
    maxSizeMB: number = 15.0
): Promise<CompressResult> {
    if (!filePath || !fs.existsSync(filePath)) {
        return { outputPath: filePath, isCompressed: false, originalSizeMB: 0, finalSizeMB: 0 };
    }

    const stats = fs.statSync(filePath);
    const originalSizeMB = stats.size / (1024 * 1024);
    if (originalSizeMB <= maxSizeMB) {
        return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!['.mp4', '.mov', '.mkv', '.avi', '.3gp', '.webm', '.flv'].includes(ext)) {
        return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
    }

    console.log(`🎬 [MediaCompressor] Video pesado (${originalSizeMB.toFixed(2)}MB). Comprimiendo para cumplir límite de 16MB de Meta...`);

    const dir = path.dirname(filePath);
    const outPath = path.join(dir, `compressed_${Date.now()}_${path.basename(filePath, ext)}.mp4`);

    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execPromise = promisify(exec);

        let durationStr = '';
        try {
            const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
            durationStr = stdout.trim();
        } catch (_) {
            try {
                const { stderr } = await execPromise(`ffmpeg -i "${filePath}" 2>&1`);
                const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
                if (match) {
                    const hours = parseFloat(match[1]);
                    const mins = parseFloat(match[2]);
                    const secs = parseFloat(match[3]);
                    durationStr = (hours * 3600 + mins * 60 + secs).toString();
                }
            } catch (_) {}
        }

        const duration = parseFloat(durationStr);
        if (!isNaN(duration) && duration > 0) {
            const maxTotalSizeBytes = 14.0 * 1024 * 1024; // 14MB para margen seguro bajo 16MB
            const totalTargetBitrate = Math.floor((maxTotalSizeBytes * 8) / duration);
            const audioBitrate = 64000;
            let videoBitrate = totalTargetBitrate - audioBitrate;
            if (videoBitrate < 150000) videoBitrate = 150000;

            console.log(`🎬 [MediaCompressor] Bitrate objetivo: Video ${videoBitrate} bps, Audio ${audioBitrate} bps (Duración: ${durationStr}s)`);
            await execPromise(`ffmpeg -y -i "${filePath}" -b:v ${videoBitrate} -vcodec libx264 -preset fast -acodec aac -b:a ${audioBitrate} -movflags +faststart "${outPath}"`);

            if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
                const compressedStats = fs.statSync(outPath);
                const compressedSizeMB = compressedStats.size / (1024 * 1024);
                console.log(`✅ [MediaCompressor] Video comprimido con éxito: ${originalSizeMB.toFixed(2)}MB -> ${compressedSizeMB.toFixed(2)}MB`);
                return { outputPath: outPath, isCompressed: true, originalSizeMB, finalSizeMB: compressedSizeMB };
            }
        }
    } catch (err: any) {
        console.error(`❌ [MediaCompressor] Error en compresión automática de video:`, err.message);
        if (fs.existsSync(outPath)) {
            try { fs.unlinkSync(outPath); } catch (_) {}
        }
    }

    return { outputPath: filePath, isCompressed: false, originalSizeMB, finalSizeMB: originalSizeMB };
}
