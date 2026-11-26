const fs = require('fs')
const path = require('path')
const STORE_FILE = './baileys_store.json'

// Config: keep last 20 messages per chat & bounded maps for flat long-term RAM
let MAX_MESSAGES = 20
const MAX_CHATS = 1000
const MAX_CONTACTS = 5000

// Try to read config from settings
try {
    const settings = require('../settings.js')
    if (settings.maxStoreMessages && typeof settings.maxStoreMessages === 'number') {
        MAX_MESSAGES = settings.maxStoreMessages
    }
} catch (e) {
    // Use default if settings not available
}

function pruneMapCap(obj, maxKeys) {
    const keys = Object.keys(obj)
    if (keys.length <= maxKeys) return
    const dropCount = keys.length - maxKeys
    for (let i = 0; i < dropCount; i++) {
        delete obj[keys[i]]
    }
}

const store = {
    messages: {},
    contacts: {},
    chats: {},
    _dirty: false,
    _writing: false,

    readFromFile(filePath = STORE_FILE) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
                this.contacts = data.contacts || {}
                this.chats = data.chats || {}
                this.messages = data.messages || {}

                // Clean up any existing data to match bounded format
                this.cleanupData()
                this._dirty = false
            }
        } catch (e) {
            console.warn('Failed to read store file:', e.message)
        }
    },

    /** Synchronous atomic write — used on SIGTERM / clean shutdown. */
    writeToFile(filePath = STORE_FILE) {
        if (!this._dirty && fs.existsSync(filePath)) return
        try {
            const data = JSON.stringify({
                contacts: this.contacts,
                chats: this.chats,
                messages: this.messages
            })
            const tmp = `${filePath}.${process.pid}.tmp`
            fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
            fs.writeFileSync(tmp, data)
            fs.renameSync(tmp, filePath)
            this._dirty = false
        } catch (e) {
            console.warn('Failed to write store file:', e.message)
        }
    },

    /**
     * Non-blocking atomic persistence — skips disk I/O completely when
     * nothing changed and never freezes the event loop on periodic flushes.
     */
    async writeToFileAsync(filePath = STORE_FILE) {
        if (!this._dirty || this._writing) return false
        this._writing = true
        this._dirty = false
        const tmp = `${filePath}.${process.pid}.tmp`
        try {
            const data = JSON.stringify({
                contacts: this.contacts,
                chats: this.chats,
                messages: this.messages
            })
            await fs.promises.mkdir(path.dirname(path.resolve(filePath)), { recursive: true })
            await fs.promises.writeFile(tmp, data, 'utf-8')
            await fs.promises.rename(tmp, filePath)
            return true
        } catch (e) {
            this._dirty = true
            try { await fs.promises.unlink(tmp) } catch (_) {}
            console.warn('Failed to async-write store file:', e.message)
            return false
        } finally {
            this._writing = false
        }
    },

    cleanupData() {
        // Convert old format messages to new format & enforce memory caps
        if (this.messages) {
            Object.keys(this.messages).forEach(jid => {
                if (typeof this.messages[jid] === 'object' && !Array.isArray(this.messages[jid])) {
                    const messages = Object.values(this.messages[jid])
                    this.messages[jid] = messages.slice(-MAX_MESSAGES)
                } else if (Array.isArray(this.messages[jid]) && this.messages[jid].length > MAX_MESSAGES) {
                    this.messages[jid] = this.messages[jid].slice(-MAX_MESSAGES)
                }
            })
            pruneMapCap(this.messages, MAX_CHATS)
        }
        if (this.contacts) pruneMapCap(this.contacts, MAX_CONTACTS)
        if (this.chats) pruneMapCap(this.chats, MAX_CHATS)
        this._dirty = true
    },

    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            let changed = false
            messages.forEach(msg => {
                if (!msg.key?.remoteJid) return
                const jid = msg.key.remoteJid
                this.messages[jid] = this.messages[jid] || []

                this.messages[jid].push(msg)

                if (this.messages[jid].length > MAX_MESSAGES) {
                    this.messages[jid] = this.messages[jid].slice(-MAX_MESSAGES)
                }
                changed = true
            })
            if (changed) {
                pruneMapCap(this.messages, MAX_CHATS)
                this._dirty = true
            }
        })

        ev.on('contacts.update', (contacts) => {
            let changed = false
            contacts.forEach(contact => {
                if (contact.id) {
                    this.contacts[contact.id] = {
                        id: contact.id,
                        name: contact.notify || contact.name || ''
                    }
                    changed = true
                }
            })
            if (changed) {
                pruneMapCap(this.contacts, MAX_CONTACTS)
                this._dirty = true
            }
        })

        ev.on('chats.set', (chats) => {
            this.chats = {}
            chats.forEach(chat => {
                this.chats[chat.id] = { id: chat.id, subject: chat.subject || '' }
            })
            pruneMapCap(this.chats, MAX_CHATS)
            this._dirty = true
        })
    },

    async loadMessage(jid, id) {
        return this.messages[jid]?.find(m => m.key.id === id) || null
    },

    getStats() {
        let totalMessages = 0
        const totalContacts = Object.keys(this.contacts).length
        const totalChats = Object.keys(this.chats).length

        Object.values(this.messages).forEach(chatMessages => {
            if (Array.isArray(chatMessages)) {
                totalMessages += chatMessages.length
            }
        })

        return {
            messages: totalMessages,
            contacts: totalContacts,
            chats: totalChats,
            maxMessagesPerChat: MAX_MESSAGES
        }
    }
}

module.exports = store
