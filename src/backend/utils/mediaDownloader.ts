import axios from 'axios';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import crypto from 'crypto';

const MEDIA_CACHE_DIR = path.resolve(process.cwd(), 'scratch', 'media_cache');

if (!fs.existsSync(MEDIA_CACHE_DIR)) {
    fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
}

export function normalizeMediaUrl(rawUrl: string): string {
    let url = rawUrl.trim();

    // Eliminar posibles caracteres de escape de markdown o corchetes
    url = url.replace(/^[<(\[]+/, '').replace(/[>)\].,;]+$/, '');

    // Soporte para Google Drive
    // Formato 1: https://drive.google.com/file/d/FILE_ID/view...
    const driveMatch1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
    if (driveMatch1 && driveMatch1[1]) {
        return `https://drive.google.com/uc?export=download&id=${driveMatch1[1]}`;
    }

    // Formato 2: https://drive.google.com/open?id=FILE_ID
    const driveMatch2 = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/i);
    if (driveMatch2 && driveMatch2[1]) {
        return `https://drive.google.com/uc?export=download&id=${driveMatch2[1]}`;
    }

    // Formato 3: https://drive.google.com/uc?id=FILE_ID
    const driveMatch3 = url.match(/drive\.google\.com\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/i);
    if (driveMatch3 && driveMatch3[1] && !url.includes('export=download')) {
        return `https://drive.google.com/uc?export=download&id=${driveMatch3[1]}`;
    }

    return url;
}

export async function downloadMediaFile(urlToDownload: string): Promise<{ localPath: string; mimeType: string; fileName: string; isImage: boolean } | null> {
    try {
        const cleanUrl = normalizeMediaUrl(urlToDownload);
        console.log(`[MediaDownloader] 📥 Descargando archivo desde: ${cleanUrl}`);

        const response = await axios.get(cleanUrl, {
            responseType: 'arraybuffer',
            timeout: 20000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
            }
        });

        // Manejo especial de advertencia de Google Drive para archivos grandes
        let buffer = Buffer.from(response.data);
        let contentType = response.headers['content-type'] || '';

        if (contentType.includes('text/html') && cleanUrl.includes('drive.google.com')) {
            const html = buffer.toString('utf-8');
            const confirmMatch = html.match(/href="(\/uc\?export=download[^"]+confirm=([^"&]+)[^"]*)"/i);
            if (confirmMatch) {
                const confirmUrl = `https://drive.google.com${confirmMatch[1].replace(/&amp;/g, '&')}`;
                console.log(`[MediaDownloader] Confirmando descarga de Google Drive: ${confirmUrl}`);
                const secondResp = await axios.get(confirmUrl, {
                    responseType: 'arraybuffer',
                    timeout: 20000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                buffer = Buffer.from(secondResp.data);
                contentType = secondResp.headers['content-type'] || contentType;
            }
        }

        // Determinar extensión adecuada
        let ext = mime.extension(contentType) || '';
        if (!ext) {
            const matchExt = cleanUrl.split('?')[0].match(/\.(png|jpe?g|gif|webp|pdf|mp4)$/i);
            if (matchExt) ext = matchExt[1].toLowerCase();
        }
        if (ext === 'jpeg') ext = 'jpg';
        if (!ext) ext = 'jpg';

        const hash = crypto.createHash('md5').update(cleanUrl).digest('hex').slice(0, 12);
        const fileName = `media_${hash}.${ext}`;
        const localPath = path.join(MEDIA_CACHE_DIR, fileName);

        fs.writeFileSync(localPath, buffer);
        console.log(`[MediaDownloader] ✅ Archivo descargado exitosamente: ${localPath} (${buffer.length} bytes, tipo: ${contentType})`);

        const isImage = contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);

        return {
            localPath,
            mimeType: contentType || `image/${ext}`,
            fileName,
            isImage
        };
    } catch (err: any) {
        console.error(`[MediaDownloader] ❌ Error descargando multimedia (${urlToDownload}):`, err.message);
        return null;
    }
}
