const axios = require('axios');

async function fetchRssHeadlines() {
    const res = await axios.get('https://feeds.bbci.co.uk/news/world/rss.xml', {
        timeout: 10000,
        headers: { 'User-Agent': 'TchuekBot/1.0' },
    });
    const xml = String(res.data || '');
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
        const block = match[1];
        const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const descMatch = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
        if (titleMatch?.[1]) {
            items.push({
                title: titleMatch[1].trim(),
                description: descMatch?.[1]?.trim() || '',
            });
        }
    }
    return items;
}

module.exports = async function newsCommand(sock, chatId, message = null) {
    try {
        const apiKey = process.env.NEWS_API_KEY || '';
        let articles = [];

        if (apiKey) {
            try {
                const response = await axios.get(
                    `https://newsapi.org/v2/top-headlines?country=us&apiKey=${apiKey}`,
                    { timeout: 10000 }
                );
                articles = (response.data?.articles || []).slice(0, 5);
            } catch (_) {}
        }

        if (!articles.length) {
            articles = await fetchRssHeadlines();
        }

        if (!articles.length) {
            await sock.sendMessage(chatId, { text: '📰 No news headlines available right now.' }, message ? { quoted: message } : undefined);
            return;
        }

        let newsMessage = '📰 *Latest World Headlines:*\n\n';
        articles.forEach((article, index) => {
            newsMessage += `${index + 1}. *${article.title}*\n`;
            if (article.description) newsMessage += `${article.description}\n`;
            newsMessage += '\n';
        });

        await sock.sendMessage(chatId, { text: newsMessage.trim() }, message ? { quoted: message } : undefined);
    } catch (error) {
        console.error('Error fetching news:', error?.message || error);
        await sock.sendMessage(chatId, { text: '❌ Sorry, I could not fetch news right now.' }, message ? { quoted: message } : undefined);
    }
};
