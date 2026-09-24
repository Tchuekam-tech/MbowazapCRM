const yts = require('yt-search');
const axios = require('axios');

const REPLY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

async function playCommand(sock, chatId, message) {
    try {
        const rawText =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            '';

        const quoted =
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
            message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
            '';

        const withoutCmd = rawText.replace(/^\s*(?:[.\/!])?(?:play|song|yt)\b/i, '').trim();
        const searchQuery = withoutCmd || quoted || '';

        if (!searchQuery) {
            return await sock.sendMessage(
                chatId,
                { text: "🎵 What song do you want to play?\nUsage: .play <song name or YouTube URL>" },
                { quoted: message }
            );
        }

        await sock.sendMessage(chatId, { text: "_🎶 Searching for your song..._" }, { quoted: message });

        // 🔍 Search YouTube
        const search = await yts(searchQuery);
        if (!search.videos || !search.videos.length) {
            return await sock.sendMessage(chatId, { text: "❌ No songs found for that query." }, { quoted: message });
        }

        const video = search.videos[0];
        const videoUrl = video.url;
        let songData = null;

        // --- Multi-API fallback (Izumi → Violetics → SnapSave) ---
        try {
            // 1️⃣ Izumi API
            const res = await axios.get(izumiUrl, { timeout: 25000 });
            if (res.data?.result?.download) {
                songData = {
                    title: res.data.result.title,
                    download: res.data.result.download
                };
            } else {
                throw new Error("Izumi invalid data");
            }
        } catch (err) {
            console.log("Izumi API failed:", err.message);
        }

        if (!songData) {
            // 2️⃣ Violetics API
            try {
                const violeticsUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(videoUrl)}`;
                const res = await axios.get(violeticsUrl, { timeout: 25000 });
                if (res.data?.result?.download_url) {
                    songData = {
                        title: res.data.result.title,
                        download: res.data.result.download_url
                    };
                } else {
                    throw new Error("Violetics invalid data");
                }
            } catch (err) {
                console.log("Violetics API failed:", err.message);
            }
        }

        if (!songData) {
            // 3️⃣ SnapSave API
            try {
                const snapUrl = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(videoUrl)}`;
                const res = await axios.get(snapUrl, { timeout: 25000 });
                if (res.data?.downloadUrl) {
                    songData = {
                        title: video.title,
                        download: res.data.downloadUrl
                    };
                } else {
                    throw new Error("SnapSave invalid data");
                }
            } catch (err) {
                console.log("SnapSave API failed:", err.message);
            }
        }

        if (!songData) {
            return await sock.sendMessage(chatId, { text: "❌ All APIs failed. Please try again later." }, { quoted: message });
        }

        // 🎧 Song info
        const songInfo =
            `╭───『 🎧 *ꜱᴏɴɢ ᴘʟᴀʏᴇʀ* 』──\n` +
            `│ 📀 *Title:* ${songData.title || video.title}\n` +
            `│ ⏱️ *Duration:* ${video.timestamp || "Unknown"}\n` +
            `│ 👁️ *Views:* ${video.views?.toLocaleString() || "Unknown"}\n` +
            `│ 🌍 *Published:* ${video.ago || "Unknown"}\n` +
            `│ 👤 *Author:* ${video.author?.name || "Unknown"}\n` +
            `│ 🔗 *URL:* ${videoUrl}\n` +
            `╰───────────────╯\n\n` +
            `╭───⌯ Choose Type ⌯───\n` +
            `│ 1️⃣ 🎵 Audio (Play)\n` +
            `│ 2️⃣ 📁 Document (Save)\n` +
            `╰───────────────╯\n` +
            `> Powered by TCHUEK-TECH`;

        let sentMsg;
        try {
            sentMsg = await sock.sendMessage(chatId, {
                image: { url: video.thumbnail },
                caption: songInfo
            }, { quoted: message });
        } catch {
            sentMsg = await sock.sendMessage(chatId, { text: songInfo }, { quoted: message });
        }

        // 🕹️ Wait for user reply
        const listener = async ({ messages }) => {
            try {
                const r = messages[0];
                const body = r.message?.conversation || r.message?.extendedTextMessage?.text;
                if (!body) return;
                const normalized = body.trim();
                const isReplyToSong = r.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;
                if (!["1", "2"].includes(normalized) || !isReplyToSong) return;

                clearTimeout(timeout);
                sock.ev.off("messages.upsert", listener);

                await sock.sendMessage(chatId, { text: "⏳ Downloading your song..." }, { quoted: r });

                const fileName = `${(songData.title || video.title || "song").replace(/[<>:"/\\|?*]+/g, '')}.mp3`;

                if (normalized === "1") {
                    await sock.sendMessage(chatId, {
                        audio: { url: songData.download },
                        mimetype: "audio/mpeg",
                        fileName
                    }, { quoted: r });
                } else {
                    await sock.sendMessage(chatId, {
                        document: { url: songData.download },
                        mimetype: "audio/mpeg",
                        fileName
                    }, { quoted: r });
                }

            } catch (err) {
                console.error("play reply error:", err);
                await sock.sendMessage(chatId, { text: "❌ Download failed. Try again later." });
            }
        };

        sock.ev.on("messages.upsert", listener);
        const timeout = setTimeout(() => {
            sock.ev.off("messages.upsert", listener);
            sock.sendMessage(chatId, { text: "⌛ Session timed out. Please use the command again." });
        }, REPLY_TIMEOUT_MS);

    } catch (error) {
        console.error('Error in playCommand:', error);
        await sock.sendMessage(chatId, { text: "❌ Failed to play song. Try again later." }, { quoted: message });
    }
}

module.exports = playCommand;
