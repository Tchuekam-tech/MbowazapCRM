const axios = require('axios');
const { sleep } = require('../lib/myfunc');
const isOwnerOrSudo = require('../lib/isOwner');

async function pairCommand(sock, chatId, message, q) {
    try {
        const senderId = message?.key?.participant || message?.key?.remoteJid || '';
        const allowed = Boolean(message?.key?.fromMe) || await isOwnerOrSudo(senderId, sock, chatId);
        if (!allowed) {
            return await sock.sendMessage(chatId, {
                text: "❌ Only the bot owner or sudo can request pairing codes."
            }, { quoted: message });
        }

        if (!q || !q.trim()) {
            return await sock.sendMessage(chatId, {
                text: "Please provide a valid WhatsApp number\nExample: .pair 237653683174"
            }, { quoted: message });
        }

        const numbers = q.split(',')
            .map((v) => v.replace(/[^0-9]/g, ''))
            .filter((v) => v.length >= 8 && v.length <= 15);

        if (numbers.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "Invalid number❌ Please use the full international format without + or spaces (8–15 digits)."
            }, { quoted: message });
        }

        for (const number of numbers) {
            const whatsappID = number + '@s.whatsapp.net';
            if (typeof sock.onWhatsApp === 'function') {
                const result = await sock.onWhatsApp(whatsappID);
                if (!result || result.length === 0 || !result[0]?.exists) {
                    await sock.sendMessage(chatId, {
                        text: `This number (${number}) is not registered on WhatsApp❗️`
                    }, { quoted: message });
                    continue;
                }
            }

            await sock.sendMessage(chatId, {
                text: `⏳ Generating pairing code for ${number}, please wait...`
            }, { quoted: message });

            try {
                let code = null;
                let isConnected = false;

                // Prefer direct in-process generator (works even when bridge mode locks /pair HTTP)
                if (typeof global.requestPairingCodeForNumber === 'function') {
                    const res = await global.requestPairingCodeForNumber(number);
                    if (res?.isConnected) {
                        isConnected = true;
                    } else if (res?.code) {
                        code = res.code;
                    } else if (res?.error) {
                        throw new Error(res.error);
                    }
                } else {
                    const localPort = process.env.PORT || 8080;
                    const response = await axios.get(`http://127.0.0.1:${localPort}/pair?number=${encodeURIComponent(number)}`, { timeout: 30000 });
                    if (response.data?.isConnected) isConnected = true;
                    else if (response.data?.code) code = response.data.code;
                }

                if (isConnected) {
                    await sock.sendMessage(chatId, {
                        text: `✅ Number ${number} is already linked and connected!`
                    }, { quoted: message });
                    continue;
                }

                if (!code || code === "Service Unavailable") {
                    throw new Error('Service Unavailable');
                }

                await sleep(500);
                await sock.sendMessage(chatId, {
                    text: `🔑 Pairing code for *${number}*:\n\n*${code}*\n\nOpen WhatsApp → Linked Devices → Link with phone number.`
                }, { quoted: message });
            } catch (apiError) {
                console.error('Pair generation error:', apiError?.message || apiError);
                await sock.sendMessage(chatId, {
                    text: `❌ Failed to generate pairing code for ${number}: ${apiError?.message || 'Please try again later.'}`
                }, { quoted: message });
            }
        }
    } catch (error) {
        console.error("pairCommand error:", error);
        await sock.sendMessage(chatId, {
            text: "⚠️ An error occurred. Please try again later."
        }, { quoted: message });
    }
}

module.exports = pairCommand;
