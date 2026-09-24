const moment = require('moment-timezone');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

async function githubCommand(sock, chatId, message) {
  try {
    const res = await fetch('https://api.github.com/repos/Tchuekam/antisnowflake-bot');
    if (!res.ok) throw new Error('Error fetching repository data');
    const json = await res.json();
    


    let txt = `🚀 *TCHUEK BOT REPO INFO* 🚀

╭────────────━⊷
┊⭘ 🤖 *Name:* ${json.name}
┊⭘ ⭐ *Stars:* ${json.stargazers_count}
┊⭘ 🍴 *Forks:* ${json.forks_count}
┊⭘ 🥸 *Watchers* : ${json.watchers_count}
┊⭘ 👤 *Owner:* TCHUEK-TECH
┊⭘ 🕰️ *Last Updated* : ${moment(json.updated_at).format('DD/MM/YY - HH:mm:ss')}
┊⭘ 📦 *Size* : ${(json.size / 1024).toFixed(2)} MB
┊⭘ 🔗 *Repository:* github.com/Tchuekam/antisnowflake-bot
╰────────━⊷
    `;
   

    // Use the local asset image if available, otherwise send text only
    const imgPath = path.join(__dirname, '../assets/bot_image.jpg');
    if (fs.existsSync(imgPath)) {
        await sock.sendMessage(chatId, { image: fs.readFileSync(imgPath), caption: txt }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: txt }, { quoted: message });
    }
  } catch (error) {
    await sock.sendMessage(chatId, { text: '❌ Error fetching repository information.' }, { quoted: message });
  }
}

module.exports = githubCommand; 
