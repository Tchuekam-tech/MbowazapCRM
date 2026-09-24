/**
 * Baileys Message Sender Wrapper
 * Formats and handles WhatsApp messages (text, buttons, lists) with viewOnceMessage
 * wrapping to guarantee rendering stability across mobile and WhatsApp Web clients.
 */
class MessageSender {
    /**
     * @param {object} sock The Baileys socket instance
     */
    constructor(sock) {
        if (!sock) {
            throw new Error('[MessageSender] Socket instance is required');
        }
        this.sock = sock;
    }

    /**
     * Sends a plain text message
     * @param {string} chatId Target JID
     * @param {string} text Message content
     * @param {object} [quoted] Message to reply to
     */
    async sendText(chatId, text, quoted = null) {
        return await this.sock.sendMessage(chatId, { text }, { quoted });
    }

    /**
     * Sends a button message wrapped in viewOnceMessage for stability
     * @param {string} chatId Target JID
     * @param {string} text Main description text
     * @param {Array<{id: string, text: string}>} buttons List of buttons (max 3)
     * @param {string} [footer] Optional footer text
     * @param {object} [quoted] Message to reply to
     */
    async sendButtons(chatId, text, buttons, footer = "MboWazap", quoted = null) {
        const formattedButtons = buttons.map(btn => ({
            buttonId: btn.id,
            buttonText: { displayText: btn.text },
            type: 1
        }));

        const message = {
            viewOnceMessage: {
                message: {
                    buttonsMessage: {
                        contentText: text,
                        footerText: footer,
                        buttons: formattedButtons,
                        headerType: 1
                    }
                }
            }
        };

        return await this.sock.sendMessage(chatId, message, { quoted });
    }

    /**
     * Sends a list message wrapped in viewOnceMessage for stability
     * @param {string} chatId Target JID
     * @param {string} text Description text
     * @param {string} title Main list title
     * @param {string} buttonText Action button display text
     * @param {Array<{title: string, rows: Array<{title: string, rowId: string, description: string}>}>} sections List sections
     * @param {string} [footer] Optional footer text
     * @param {object} [quoted] Message to reply to
     */
    async sendList(chatId, text, title, buttonText, sections, footer = "MboWazap", quoted = null) {
        const formattedSections = sections.map(sec => ({
            title: sec.title || "",
            rows: sec.rows.map(row => ({
                title: row.title || "",
                rowId: row.rowId,
                description: row.description || ""
            }))
        }));

        const message = {
            viewOnceMessage: {
                message: {
                    listMessage: {
                        title: title || "",
                        description: text,
                        buttonText: buttonText || "Sélectionner",
                        footerText: footer,
                        listType: 1,
                        sections: formattedSections
                    }
                }
            }
        };

        return await this.sock.sendMessage(chatId, message, { quoted });
    }

    /**
     * Sends an image message
     * @param {string} chatId Target JID
     * @param {Buffer|string} image Path to image or image buffer
     * @param {string} [caption] Caption text
     * @param {object} [quoted] Message to reply to
     */
    async sendImage(chatId, image, caption = "", quoted = null) {
        const content = typeof image === 'string' ? { url: image } : { image };
        return await this.sock.sendMessage(chatId, { ...content, caption }, { quoted });
    }
}

module.exports = MessageSender;
