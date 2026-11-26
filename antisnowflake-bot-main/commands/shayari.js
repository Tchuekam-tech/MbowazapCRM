const SHAYARI_LIST = [
    "Khamoshiyan bol deti hain jinki baatein nahi hoti,\nIshq unka bhi hota hai jinki mulaqatein nahi hoti. ✨",
    "Waqt badalta hai zindagi ke saath,\nZindagi badalti hai waqt ke saath,\nWaqt nahi badalta apno ke saath,\nBas apne badal jaate hain waqt ke saath. 🌙",
    "Muskurahat ka koi mol nahi hota,\nKuch rishton ka koi tol nahi hota,\nLog toh mil jaate hain har mod par,\nPar har koi aapki tarah anmol nahi hota. 💫",
    "Chand adhura hai sitaron ke bina,\nGulshan adhura hai baharon ke bina,\nSamundar adhura hai kinaron ke bina,\nAur zindagi adhuri hai aap jaise yaaron ke bina. 🌹",
    "Har subah teri duniya mein roshni kar de,\nRab tere gham ko teri khushi kar de,\nJab bhi tootne lage teri saansein,\nKhuda tujhmein shamil meri zindagi kar de. ✨",
];

async function shayariCommand(sock, chatId, message) {
    try {
        const text = SHAYARI_LIST[Math.floor(Math.random() * SHAYARI_LIST.length)];
        await sock.sendMessage(chatId, {
            text: `🪄 *Shayari:*\n\n${text}`
        }, { quoted: message });
    } catch (error) {
        console.error('Error in shayari command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch shayari. Please try again later.',
        }, { quoted: message });
    }
}

module.exports = { shayariCommand };
