const fetch = require('node-fetch');
const FormData = require('form-data');
const FileType = require('file-type');
const fs = require('fs');
const path = require('path');

async function uploadImage(buffer) {
    let tempFile = null;
    try {
        const tmpDir = path.join(process.cwd(), 'tmp');
        fs.mkdirSync(tmpDir, { recursive: true });

        const fileType = await FileType.fromBuffer(buffer);
        const { ext, mime } = fileType || { ext: 'png', mime: 'image/png' };
        tempFile = path.join(tmpDir, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
        fs.writeFileSync(tempFile, buffer);

        // 1. Primary: qu.ax
        try {
            const form = new FormData();
            form.append('files[]', fs.createReadStream(tempFile));
            const response = await fetch('https://qu.ax/upload.php', {
                method: 'POST',
                body: form,
                headers: form.getHeaders(),
                timeout: 20000,
            });
            const result = await response.json();
            if (result?.success && result.files?.[0]?.url) {
                return result.files[0].url;
            }
        } catch (_) {}

        // 2. Fallback: catbox.moe (replaces retired telegra.ph)
        const catboxForm = new FormData();
        catboxForm.append('reqtype', 'fileupload');
        catboxForm.append('fileToUpload', buffer, {
            filename: `upload.${ext}`,
            contentType: mime,
        });
        const catboxRes = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: catboxForm,
            headers: catboxForm.getHeaders(),
            timeout: 20000,
        });
        const urlText = (await catboxRes.text()).trim();
        if (catboxRes.ok && /^https?:\/\//i.test(urlText)) {
            return urlText;
        }

        throw new Error('Failed to upload image to hosting providers');
    } catch (error) {
        console.error('Upload error:', error?.message || error);
        throw error;
    } finally {
        try {
            if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (_) {}
    }
}

module.exports = { uploadImage };
