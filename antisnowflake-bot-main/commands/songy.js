const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

// Create agent for bypassing YouTube 410 errors
const { createAgent } = require('@distube/ytdl-core');
const agent = createAgent();

async function songCommand(sock, chatId, message) {
    try {
        const text = message.message?.conversation ||
                     message.message?.extendedTextMessage?.text || '';

        if (!text || text.trim() === ".song") {
            return await sock.sendMessage(chatId, {
                text: "🎵 Usage: .song <query or YouTube link>"
            }, { quoted: message });
        }

        // 🔎 Search or Use YouTube Link
        let video;

        if (text.includes('youtube.com') || text.includes('youtu.be')) {
            const info = await ytdl.getInfo(text, { requestOptions: { agent } });
            video = {
                title: info.videoDetails.title,
                url: text,
                thumbnail: info.videoDetails.thumbnails.slice(-1)[0].url,
                timestamp: info.videoDetails.lengthSeconds,
                views: info.videoDetails.viewCount,
                author: { name: info.videoDetails.author.name }
            };
        } else {
            const search = await yts(text);
            if (!search.videos.length) {
                return await sock.sendMessage(chatId,
                    { text: "❌ No results found." },
                    { quoted: message });
            }
            video = search.videos[0];
        }

        // Send video info first
        const songInfo =
            `╭───『 🎧 *ꜱᴏɴɢ ɪɴꜰᴏ* 』──\n` +
            `│ 📀 *Title:* ${video.title}\n` +
            `│ 👁️ *Views:* ${video.views?.toLocaleString() || "Unknown"}\n` +
            `│ 👤 *Author:* ${video.author?.name || "Unknown"}\n` +
            `│ 🔗 *URL:* ${video.url}\n` +
            `╰───────────────╯\n\n` +
            `Reply with:\n1️⃣ Audio\n2️⃣ Document`;

        const sentMsg = await sock.sendMessage(chatId, {
            image: { url: video.thumbnail },
            caption: songInfo
        }, { quoted: message });

        // --- Reply listener for 1️⃣ or 2️⃣ ---
        const listener = async ({ messages }) => {
            try {
                const reply = messages[0];
                const body = reply.message?.conversation ||
                             reply.message?.extendedTextMessage?.text;

                if (!body) return;

                const isReplyToSong =
                    reply.message?.extendedTextMessage?.contextInfo?.stanzaId === sentMsg.key.id;

                if (!["1", "2"].includes(body.trim()) || !isReplyToSong) return;

                clearTimeout(timeout);
                sock.ev.off("messages.upsert", listener);

                await sock.sendMessage(chatId,
                    { text: "⏳ Downloading audio..." },
                    { quoted: reply });

                const outputPath = path.join(__dirname, 'temp.mp3');

                // Download using ytdl-core + ffmpeg with agent
                await new Promise((resolve, reject) => {
                    ffmpeg(ytdl(video.url, { 
                        quality: 'highestaudio',
                        requestOptions: { agent }
                    }))
                        .audioBitrate(128)
                        .save(outputPath)
                        .on('end', resolve)
                        .on('error', reject);
                });

                const fileBuffer = fs.readFileSync(outputPath);
                const fileName = `${video.title}.mp3`;

                if (body.trim() === "1") {
                    await sock.sendMessage(chatId, {
                        audio: fileBuffer,
                        mimetype: "audio/mpeg",
                        fileName
                    }, { quoted: reply });
                } else {
                    await sock.sendMessage(chatId, {
                        document: fileBuffer,
                        mimetype: "audio/mpeg",
                        fileName
                    }, { quoted: reply });
                }

                fs.unlinkSync(outputPath); // remove temp file

            } catch (err) {
                console.error("Reply error:", err.message);
                await sock.sendMessage(chatId,
                    { text: "❌ Download failed. Try again." });
            }
        };

        sock.ev.on("messages.upsert", listener);

        // Timeout for reply
        const timeout = setTimeout(() => {
            sock.ev.off("messages.upsert", listener);
            sock.sendMessage(chatId, { text: "⌛ Session timed out. Please try again." });
        }, 60000);

    } catch (err) {
        console.error("Song command error:", err.message);
        await sock.sendMessage(chatId,
            { text: "❌ Failed to download song." },
            { quoted: message });
    }
}

module.exports = songCommand;