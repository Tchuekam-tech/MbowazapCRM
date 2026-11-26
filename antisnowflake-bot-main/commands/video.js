const axios = require('axios');
const yts = require('yt-search');

const izumi = {
    baseURL: "https://izumiiiiiiii.dpdns.org"
};

async function videoCommand(sock, chatId, message) {
    try {
        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            '';
        const searchQuery = text.trim().split(/\s+/).slice(1).join(' ').trim();

        if (!searchQuery) {
            await sock.sendMessage(chatId, {
                text: "🎥 *Usage:* `.video <video name or url>`\n💡 Example: `.video despacito`"
            }, { quoted: message });
            return;
        }

        let videoUrl = '';
        let videoInfo = null;

        if (searchQuery.startsWith('http://') || searchQuery.startsWith('https://')) {
            videoUrl = searchQuery;
            try {
                const { videos } = await yts(videoUrl);
                videoInfo = videos ? videos[0] : null;
            } catch (_) {}
        } else {
            const { videos } = await yts(searchQuery);
            if (!videos || videos.length === 0) {
                await sock.sendMessage(chatId, { text: "❌ No videos found!" }, { quoted: message });
                return;
            }
            videoInfo = videos[0];
            videoUrl = videoInfo.url;
        }

        // Fetch downloadable video link with multi-API fallback
        let videoData = null;
        const endpoints = [
            `${izumi.baseURL}/downloader/youtube?url=${encodeURIComponent(videoUrl)}&format=720`,
            `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(videoUrl)}`,
            `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        ];

        for (const apiUrl of endpoints) {
            try {
                const res = await axios.get(apiUrl, { timeout: 25000 });
                const dl =
                    res.data?.result?.download ||
                    res.data?.result?.download_url ||
                    res.data?.result?.mp4 ||
                    res.data?.downloadUrl ||
                    res.data?.url;
                if (dl && typeof dl === 'string') {
                    videoData = {
                        title: res.data?.result?.title || videoInfo?.title || 'Video',
                        download: dl,
                    };
                    break;
                }
            } catch (apiErr) {
                console.log('[VIDEO] Endpoint fallback:', apiErr.message);
            }
        }

        if (!videoData) {
            await sock.sendMessage(chatId, {
                text: "❌ Video download providers are temporarily unavailable. Please try again later."
            }, { quoted: message });
            return;
        }

        const videoCaption =
            `╭───『 🎬 *ᴠɪᴅᴇᴏ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ* 』──\n` +
            `│ 📀 Title: ${videoInfo?.title || videoData.title || "Unknown"}\n` +
            `│ ⏱️ Duration: ${videoInfo?.timestamp || "Unknown"}\n` +
            `│ 👁️ Views: ${videoInfo?.views?.toLocaleString() || "Unknown"}\n` +
            `│ 🌍 Published: ${videoInfo?.ago || "Unknown"}\n` +
            `│ 👤 Author: ${videoInfo?.author?.name || "Unknown"}\n` +
            `│ 🔗 URL: ${videoUrl}\n` +
            `╰──────────\n\n` +
            `╭───⌯ Choose Type ⌯───\n` +
            `│ 1️⃣ 🎬 Play (Video)\n` +
            `│ 2️⃣ 📁 Save (Document)\n` +
            `╰───────────────╯\n` +
            `> Powered by TCHUEK-TECH`;

        let sentMsg;
        if (videoInfo?.thumbnail) {
            try {
                sentMsg = await sock.sendMessage(chatId, {
                    image: { url: videoInfo.thumbnail },
                    caption: videoCaption
                }, { quoted: message });
            } catch {
                sentMsg = await sock.sendMessage(chatId, { text: videoCaption }, { quoted: message });
            }
        } else {
            sentMsg = await sock.sendMessage(chatId, { text: videoCaption }, { quoted: message });
        }

        if (!sock?.ev || typeof sock.ev.on !== 'function' || !sentMsg?.key?.id) return;

        const messageID = sentMsg.key.id;
        const safeFileName = `${(videoData.title || "video").replace(/[<>:"/\\|?*]+/g, '')}.mp4`;

        const handler = async (msgData) => {
            try {
                const rMsg = msgData?.messages?.[0];
                if (!rMsg?.message || rMsg.key?.remoteJid !== chatId) return;

                const body = rMsg.message.conversation || rMsg.message.extendedTextMessage?.text;
                if (!body) return;

                const choice = body.trim();
                const isReply = rMsg.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

                if (isReply && (choice === "1" || choice === "2")) {
                    if (choice === "1") {
                        await sock.sendMessage(chatId, {
                            video: { url: videoData.download },
                            mimetype: "video/mp4",
                            fileName: safeFileName,
                            caption: `▶️ *Now Playing:* ${videoData.title || "Video"}`
                        }, { quoted: rMsg });
                    } else {
                        await sock.sendMessage(chatId, {
                            document: { url: videoData.download },
                            mimetype: "video/mp4",
                            fileName: safeFileName,
                            caption: `💾 *Saved:* ${videoData.title || "Video"}`
                        }, { quoted: rMsg });
                    }

                    await sock.sendMessage(chatId, {
                        react: { text: '✅', key: rMsg.key }
                    });
                }
            } catch (err) {
                console.error("Video reply handler error:", err);
                try {
                    await sock.sendMessage(chatId, { text: "❌ Failed to send video file." });
                } catch (_) {}
            }
        };

        sock.ev.on("messages.upsert", handler);
        const timer = setTimeout(() => {
            try { sock.ev.off("messages.upsert", handler); } catch (_) {}
        }, 5 * 60 * 1000);
        if (typeof timer.unref === 'function') timer.unref();

    } catch (error) {
        console.error("[VIDEO] Command Error:", error?.message || error);
        await sock.sendMessage(chatId, { text: "❌ Download failed: " + (error?.message || "Unknown error") }, { quoted: message });
    }
}

module.exports = videoCommand;
