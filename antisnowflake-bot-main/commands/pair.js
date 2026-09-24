
const axios = require('axios');
const { sleep } = require('../lib/myfunc');

async function pairCommand(sock, chatId, message, q) {
    try {
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: "Please provide a valid WhatsApp number\nExample: .pair 237653683174"
            }, { quoted: message });
        }

        const numbers = q.split(',')
            .map((v) => v.replace(/[^0-9]/g, ''))
            .filter((v) => v.length > 5 && v.length < 20);

        if (numbers.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "Invalid number❌️ Please use the correct format!"
            }, { quoted: message });
        }

        for (const number of numbers) {
            const whatsappID = number + '@s.whatsapp.net';
            console.log("Checking WhatsApp ID:", whatsappID);

            const result = await sock.onWhatsApp(whatsappID);
            console.log("onWhatsApp result:", result);

            if (!result || result.length === 0 || !result[0]?.exists) {
                await sock.sendMessage(chatId, {
                    text: `This number (${number}) is not registered on WhatsApp❗️`
                }, { quoted: message });
                continue;
            }

            await sock.sendMessage(chatId, { text: `⏳ Generating pairing code for ${number}, Please wait...`
            }, { quoted: message });
            await sleep(1000);

            try {
                const localPort = process.env.PORT || 8080;
                const response = await axios.get(`http://127.0.0.1:${localPort}/pair?number=${number}`);
                console.log("API response:", response.data);

                if (response.data && response.data.code) {
                    const code = response.data.code;
                    if (code === "Service Unavailable") {
                        throw new Error('Service Unavailable');
                    }

                    await sleep(1000);
                    await sock.sendMessage(chatId, {
                        text: `${code}`
                    }, { quoted: message });
                } else {
                    throw new Error('Invalid response from server');
                }
            } catch (apiError) {
                console.error('API Error:', apiError);
                const errorMessage = apiError.message === 'Service Unavailable'
                    ? "⚠️ Service is currently unavailable. Please try again later."
                    : "❌ Failed to generate pairing code. Please try again later.";

                await sock.sendMessage(chatId, { text: errorMessage });
            }
        }
    } catch (error) {
        console.error("pairCommand error:", error);
        await sock.sendMessage(chatId, {
            text: "⚠️ An error occurred. Please try again later."
        });
    }
}

module.exports = pairCommand;
