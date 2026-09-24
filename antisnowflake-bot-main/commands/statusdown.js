/*
WhatsApp Status Downloader (with Owner Notifications + Buttons)
Author: TCHUEK-TECH
Bot: Tchuek Bot
Version: 1.0.0 — Auto Refresh + Persistent Cache + Button UI
*/

const fs = require("fs");
const path = require("path");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

// === CONFIG ===
const OWNER_NUMBER = "237653683174"; // 👈 Replace with your WhatsApp number (no +)
const statusFolder = path.join(__dirname, "../data/statusMedia");
const statusDB = path.join(statusFolder, "statuses.json");

// === INITIALIZE STORAGE ===
if (!fs.existsSync(statusFolder)) fs.mkdirSync(statusFolder, { recursive: true });
if (!fs.existsSync(statusDB)) fs.writeFileSync(statusDB, JSON.stringify([]));

let savedStatuses = JSON.parse(fs.readFileSync(statusDB, "utf-8") || "[]");

// === SAVE FUNCTION ===
function saveStatuses() {
  fs.writeFileSync(statusDB, JSON.stringify(savedStatuses, null, 2));
}

// === CLEAN OLD STATUSES (older than 24h) ===
function cleanOldStatuses() {
  const now = Math.floor(Date.now() / 1000);
  const before = savedStatuses.length;
  savedStatuses = savedStatuses.filter((s) => now - s.timestamp < 86400);
  if (savedStatuses.length !== before) saveStatuses();
}
setInterval(cleanOldStatuses, 60 * 60 * 1000); // every hour

// === AUTO REFRESH FUNCTION ===
function startAutoRefresh(sock) {
  setInterval(async () => {
    try {
      console.log("🔄 Auto-refreshing status cache...");
      const statuses = sock.store?.messages["status@broadcast"]?.array || [];

      for (const msg of statuses) {
        if (msg.key.remoteJid !== "status@broadcast") continue;
        const participant = msg.key.participant?.replace("@s.whatsapp.net", "");
        const isVideo = !!msg.message.videoMessage;
        const isImage = !!msg.message.imageMessage;

        if (isVideo || isImage) {
          const statusObj = {
            sender: participant,
            timestamp: msg.messageTimestamp?.low || Math.floor(Date.now() / 1000),
            type: isVideo ? "video" : "image",
            msg,
          };
          if (!savedStatuses.some((s) => s.msg?.key?.id === msg.key.id)) {
            savedStatuses.push(statusObj);
            if (savedStatuses.length > 50) savedStatuses = savedStatuses.slice(-50);
          }
        }
      }

      saveStatuses();
      console.log(`✅ Status cache refreshed (${savedStatuses.length} saved)`);
    } catch (err) {
      console.error("⚠️ Auto-refresh error:", err.message);
    }
  }, 1000 * 60 * 30); // every 30 minutes
}

// === STATUS DOWNLOAD COMMAND ===
async function statusDownloadCommand(sock, chatId, message) {
  try {
    cleanOldStatuses();

    if (savedStatuses.length === 0) {
      return await sock.sendMessage(chatId, {
        text: "⚠️ No recent statuses found. Wait until someone posts a new status, then use the command again.",
      }, { quoted: message });
    }

    // Show last 5 statuses
    let listText = "📲 *Recent WhatsApp Statuses Found:*\n\n";
    const latest = savedStatuses.slice(-5);

    latest.forEach((s, i) => {
      const sender = s.sender || "Unknown";
      const time = new Date(s.timestamp * 1000).toLocaleTimeString();
      listText += `*${i + 1}.* 👤 +${sender} | 🕒 ${time}\n`;
    });

    listText += `\n📥 Reply with *number (1-${latest.length})* to download that status.`;

    await sock.sendMessage(chatId, { text: listText }, { quoted: message });

    // Wait for reply
    const listener = async ({ messages }) => {
      const m = messages[0];
      if (!m?.message) return;

      const body = m.message.conversation || m.message.extendedTextMessage?.text || "";
      if (!body.match(/^[1-5]$/)) return;

      const index = parseInt(body.trim()) - 1;
      const selected = latest[index];
      if (!selected) return;

      sock.ev.off("messages.upsert", listener);

      const buffer = await downloadMediaMessage(selected.msg, "buffer", {}, {});
      const ext = selected.type === "video" ? "mp4" : "jpg";
      const filename = path.join(statusFolder, `status_${Date.now()}.${ext}`);
      fs.writeFileSync(filename, buffer);

      await sock.sendMessage(
        chatId,
        {
          [ext === "mp4" ? "video" : "image"]: buffer,
          caption: "✅ *Status Downloaded Successfully!*",
        },
        { quoted: m }
      );
    };

    sock.ev.on("messages.upsert", listener);
  } catch (error) {
    console.error("❌ statusDownloadCommand error:", error);
    await sock.sendMessage(chatId, { text: `⚠️ Failed: ${error.message}` }, { quoted: message });
  }
}

// === STATUS CAPTURE LISTENER (with owner notification + buttons) ===
function setupStatusCapture(sock) {
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.remoteJid === "status@broadcast") {
        try {
          const participant = msg.key.participant?.replace("@s.whatsapp.net", "");
          const isVideo = !!msg.message.videoMessage;
          const isImage = !!msg.message.imageMessage;

          if (isVideo || isImage) {
            const statusObj = {
              sender: participant,
              timestamp: msg.messageTimestamp?.low || Math.floor(Date.now() / 1000),
              type: isVideo ? "video" : "image",
              msg,
            };

            // Avoid duplicates
            if (!savedStatuses.some((s) => s.msg?.key?.id === msg.key.id)) {
              savedStatuses.push(statusObj);
              if (savedStatuses.length > 50) savedStatuses = savedStatuses.slice(-50);
              saveStatuses();

              // 💬 Notify owner with buttons
              const time = new Date(statusObj.timestamp * 1000).toLocaleTimeString();
              await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, {
                text: `🆕 *New WhatsApp Status Detected!*\n\n👤 *From:* +${participant}\n📸 *Type:* ${statusObj.type.toUpperCase()}\n🕒 *Time:* ${time}\n\n> 💡 Use *.statusdl* to download manually, or tap a button below.`,
                buttons: [
                  { buttonId: "status_download", buttonText: { displayText: "📥 Download Now" }, type: 1 },
                  { buttonId: "status_view", buttonText: { displayText: "👀 View Status" }, type: 1 },
                ],
                headerType: 1,
              });
            }
          }
        } catch (err) {
          console.log("Status save error:", err.message);
        }
      }
    }
  });

  // Start periodic refresh
  startAutoRefresh(sock);
}

module.exports = { statusDownloadCommand, setupStatusCapture };
