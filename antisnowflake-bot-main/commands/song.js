const yts = require("yt-search");
const axios = require("axios");

const REPLY_TIMEOUT_MS = 2 * 60 * 1000;

async function resolveAudioUrl(videoUrl) {
    const endpoints = [
        async () => {
            const res = await axios.get(
                `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(videoUrl)}&format=mp3`,
                { timeout: 25000 }
            );
            return res.data?.result?.download || null;
        },
        async () => {
            const res = await axios.get(
                `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 25000 }
            );
            return res.data?.result?.download_url || res.data?.result?.download || null;
        },
        async () => {
            const res = await axios.get(
                `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(videoUrl)}`,
                { timeout: 25000 }
            );
            return res.data?.downloadUrl || res.data?.result?.download || null;
        },
        async () => {
            const res = await axios.get(
                `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(videoUrl)}&format=mp3`,
                { timeout: 25000 }
            );
            return res.data?.downloadURL || res.data?.result?.download || res.data?.url || null;
        },
    ];

    for (const fn of endpoints) {
        try {
            const url = await fn();
            if (url && typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
        } catch (_) {}
    }
    return null;
}

async function songCommand(sock, chatId, message) {
    try {
        const rawText =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text || "";
        const query = rawText.replace(/^\s*\.(?:song|mp3|ytmp3)\b/i, '').trim();

        if (!query) {
            return await sock.sendMessage(chatId, {
                text: "🎵 Usage: .song <song name or YouTube URL>"
            }, { quoted: message });
        }

        const search = await yts(query);
        if (!search?.videos?.length) {
            return await sock.sendMessage(chatId,
                { text: "❌ No results found." },
                { quoted: message });
        }

        const video = search.videos[0];
        const videoUrl = video.url;

        const songInfo =
            `╭───『 🎧 *ꜱᴏɴɢ ɪɴꜰᴏ* 』──\n` +
            `│ 📀 *Title:* ${video.title}\n` +
            `│ ⏱️ *Duration:* ${video.timestamp}\n` +
            `│ 👁️ *Views:* ${video.views?.toLocaleString() || "Unknown"}\n` +
            `│ 🌍 *Published:* ${video.ago || "Unknown"}\n` +
            `│ 👤 *Author:* ${video.author?.name || "Unknown"}\n` +
            `│ 🔗 *URL:* ${videoUrl}\n` +
            `╰───────────────╯\n\n` +
            `╭───⌯ Choose Type ⌯───\n` +
            `│ 1️⃣ 🎵 Audio\n` +
            `│ 2️⃣ 📁 Document\n` +
            `╰───────────────╯\n` +
            `> Powered by TCHUEK-TECH`;

        let sentMsg;
        if (video.thumbnail) {
            try {
                sentMsg = await sock.sendMessage(chatId, {
                    image: { url: video.thumbnail },
                    caption: songInfo
                }, { quoted: message });
            } catch {
                sentMsg = await sock.sendMessage(chatId, { text: songInfo }, { quoted: message });
            }
        } else {
            sentMsg = await sock.sendMessage(chatId, { text: songInfo }, { quoted: message });
        }

        if (!sock?.ev || typeof sock.ev.on !== 'function' || !sentMsg?.key?.id) return;

        const safeFileName = `${(video.title || 'song').replace(/[<>:"/\\|?*]+/g, '')}.mp3`;

        const listener = async ({ messages }) => {
            try {
                const reply = messages?.[0];
                if (!reply?.message || reply.key?.remoteJid !== chatId) return;
                const body =
                    reply.message?.conversation ||
                    reply.message?.extendedTextMessage?.text;

                if (!body) return;
                const choice = body.trim();
                const isReply =
                    reply.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;

                if (!["1", "2"].includes(choice) || !isReply) return;

                clearTimeout(timeout);
                sock.ev.off("messages.upsert", listener);

                await sock.sendMessage(chatId,
                    { text: "⏳ Downloading audio..." },
                    { quoted: reply });

                const downloadUrl = await resolveAudioUrl(videoUrl);
                if (!downloadUrl) {
                    await sock.sendMessage(chatId,
                        { text: "❌ Audio providers are temporarily unavailable. Please try again later." },
                        { quoted: reply });
                    return;
                }

                if (choice === "1") {
                    await sock.sendMessage(chatId, {
                        audio: { url: downloadUrl },
                        mimetype: "audio/mpeg",
                        fileName: safeFileName
                    }, { quoted: reply });
                } else {
                    await sock.sendMessage(chatId, {
                        document: { url: downloadUrl },
                        mimetype: "audio/mpeg",
                        fileName: safeFileName
                    }, { quoted: reply });
                }
            } catch (err) {
                console.error('song reply handler error:', err);
                try {
                    await sock.sendMessage(chatId, { text: "❌ Failed to send audio file." });
                } catch (_) {}
            }
        };

        sock.ev.on("messages.upsert", listener);
        const timeout = setTimeout(() => {
            try { sock.ev.off("messages.upsert", listener); } catch (_) {}
        }, REPLY_TIMEOUT_MS);
        if (typeof timeout.unref === 'function') timeout.unref();

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId,
            { text: "❌ Failed to download song." },
            { quoted: message });
    }
}

module.exports = songCommand;
