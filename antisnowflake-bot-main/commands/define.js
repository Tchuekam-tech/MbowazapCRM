
// commands/define.js
const axios = require("axios");

async function defineCommand(sock, chatId, message, q) {
  try {
    if (!q) {
      return await sock.sendMessage(
        chatId,
        { text: "❌ Please provide a word to define.\n\n📌 *Usage:* .define [word]" },
        { quoted: message }
      );
    }

    const word = q.trim();
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;
    const response = await axios.get(url);
    const definitionData = response.data[0];

    // Get the first valid definition
    const allMeanings = definitionData.meanings || [];
    let definition = "❌ No definition found";
    let example = "❌ No example available";
    let synonyms = "❌ No synonyms available";

    for (const meaning of allMeanings) {
      for (const def of meaning.definitions) {
        if (def.definition && definition === "❌ No definition found") {
          definition = def.definition;
        }
        if (def.example && example === "❌ No example available") {
          example = def.example;
        }
        if (def.synonyms && def.synonyms.length > 0 && synonyms === "❌ No synonyms available") {
          synonyms = def.synonyms.join(", ");
        }
      }
    }

    const phonetics = definitionData.phonetics?.[0]?.text || "🔇 No phonetics available";
    const audio = definitionData.phonetics?.find(p => p.audio)?.audio || null;

    const wordInfo =
      `📖 *Word*: *${definitionData.word}*\n` +
      `🗣️ *Pronunciation*: _${phonetics}_\n` +
      `📚 *Definition*: ${definition}\n` +
      `✍️ *Example*: ${example}\n` +
      `📝 *Synonyms*: ${synonyms}\n\n` +
      `🔗 *Powered By TCHUEK-TECH*`;

    // Send audio if available
    if (audio) {
      await sock.sendMessage(
        chatId,
        { audio: { url: audio }, mimetype: "audio/mpeg" },
        { quoted: message }
      );
    }

    await sock.sendMessage(chatId, { text: wordInfo }, { quoted: message });
  } catch (e) {
    console.error("defineCommand error:", e);
    if (e.response && e.response.status === 404) {
      return await sock.sendMessage(
        chatId,
        { text: "🚫 *Word not found.* Please check the spelling and try again." },
        { quoted: message }
      );
    }
    return await sock.sendMessage(
      chatId,
      { text: "⚠️ An error occurred while fetching the definition. Please try again later." },
      { quoted: message }
    );
  }
}

module.exports = defineCommand;
