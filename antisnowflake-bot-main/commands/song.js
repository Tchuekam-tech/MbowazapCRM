const yts = require("yt-search");
const axios = require("axios");

async function songCommand(sock, chatId, message) {
    try {
        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text || "";

        if (!text || text.trim() === ".song") {
            return await sock.sendMessage(chatId, {
                text: "🎵 Usage: .song <song name>"
            }, { quoted: message });
        }

        // 🔎 Search YouTube
        const search = await yts(text);
        if (!search.videos.length) {
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
            `│ 👁️ *Views:* ${video.views?.toLocaleString()}\n` +
            `│ 🌍 *Published:* ${video.ago}\n` +
            `│ 👤 *Author:* ${video.author?.name}\n` +
            `│ 🔗 *URL:* ${videoUrl}\n` +
            `╰───────────────╯\n\n` +
            `╭───⌯ Choose Type ⌯───\n` +
            `│ 1️⃣ 🎵 Audio\n` +
            `│ 2️⃣ 📁 Document\n` +
            `╰───────────────╯\n` +
            `> Powered by TCHUEK-TECH`;

        const sentMsg = await sock.sendMessage(chatId, {
            image: { url: video.thumbnail },
            caption: songInfo
        }, { quoted: message });

        const listener = async ({ messages }) => {
            const reply = messages[0];
            const body =
                reply.message?.conversation ||
                reply.message?.extendedTextMessage?.text;

            if (!body) return;

            const isReply =
                reply.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;

            if (!["1", "2"].includes(body.trim()) || !isReply) return;

            sock.ev.off("messages.upsert", listener);

            await sock.sendMessage(chatId,
                { text: "⏳ Downloading audio..." },
                { quoted: reply });

            // 🔥 Public YouTube MP3 API
            const api = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(videoUrl)}&format=mp3`;

            if (body.trim() === "1") {
                await sock.sendMessage(chatId, {
                    audio: { url: api },
                    mimetype: "audio/mpeg",
                    fileName: `${video.title}.mp3`
                }, { quoted: reply });
            } else {
                await sock.sendMessage(chatId, {
                    document: { url: api },
                    mimetype: "audio/mpeg",
                    fileName: `${video.title}.mp3`
                }, { quoted: reply });
            }
        };

        sock.ev.on("messages.upsert", listener);

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId,
            { text: "❌ Failed to download song." },
            { quoted: message });
    }
}

module.exports = songCommand;