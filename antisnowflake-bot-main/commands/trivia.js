const axios = require('axios');

let triviaGames = {};

function decodeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&eacute;/g, 'é')
        .replace(/&rsquo;|&lsquo;/g, "'")
        .replace(/&ldquo;|&rdquo;/g, '"')
        .replace(/&hellip;/g, '...')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

async function startTrivia(sock, chatId) {
    if (triviaGames[chatId]) {
        await sock.sendMessage(chatId, { text: 'A trivia game is already in progress! Answer with *.answer <your answer>*' });
        return;
    }

    try {
        const response = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 10000 });
        const questionData = response.data?.results?.[0];
        if (!questionData) throw new Error('No question returned');

        const question = decodeHtml(questionData.question);
        const correctAnswer = decodeHtml(questionData.correct_answer);
        const options = [...questionData.incorrect_answers.map(decodeHtml), correctAnswer]
            .sort(() => Math.random() - 0.5);

        triviaGames[chatId] = { question, correctAnswer, options };

        await sock.sendMessage(chatId, {
            text: `🧠 *Trivia Time!*\n\n*Question:* ${question}\n\n*Options:*\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\nReply with *.answer <answer>*`
        });
    } catch (error) {
        console.error('Error in startTrivia:', error?.message || error);
        await sock.sendMessage(chatId, { text: '❌ Error fetching trivia question. Try again later.' });
    }
}

async function answerTrivia(sock, chatId, answer) {
    if (!triviaGames[chatId]) {
        await sock.sendMessage(chatId, { text: 'No trivia game is in progress. Start one with *.trivia*' });
        return;
    }

    const game = triviaGames[chatId];
    const clean = (answer || '').trim().toLowerCase();
    // Accept either option number (1-4) or exact text match
    const asIdx = /^[1-4]$/.test(clean) ? Number(clean) - 1 : -1;
    const chosenText = asIdx >= 0 && game.options[asIdx] ? game.options[asIdx].toLowerCase() : clean;

    if (chosenText === game.correctAnswer.toLowerCase()) {
        await sock.sendMessage(chatId, { text: `✅ Correct! The answer is *${game.correctAnswer}*` });
    } else {
        await sock.sendMessage(chatId, { text: `❌ Wrong! The correct answer was *${game.correctAnswer}*` });
    }

    delete triviaGames[chatId];
}

module.exports = { startTrivia, answerTrivia };
