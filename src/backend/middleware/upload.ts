import multer from 'multer';
import path from 'path';
import fs from 'fs';

export const upload = multer({ 
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const dir = "uploads/";
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
        }
    })
});
