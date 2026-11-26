const words = [
    'javascript', 'bot', 'hangman', 'whatsapp', 'nodejs',
    'automation', 'marketing', 'pipeline', 'customer', 'analytics'
];
let hangmanGames = {};

async function startHangman(sock, chatId) {
    const word = words[Math.floor(Math.random() * words.length)];
    const maskedWord = '_ '.repeat(word.length).trim();

    hangmanGames[chatId] = {
        word,
        maskedWord: maskedWord.split(' '),
        guessedLetters: [],
        wrongGuesses: 0,
        maxWrongGuesses: 6,
    };

    await sock.sendMessage(chatId, {
        text: `🎮 *Hangman Started!*\nWord: \`${maskedWord}\` (${word.length} letters)\nGuess a letter with *.guess <letter>*`
    });
}

async function guessLetter(sock, chatId, rawLetter) {
    if (!hangmanGames[chatId]) {
        await sock.sendMessage(chatId, { text: 'No game in progress. Start a new game with *.hangman*' });
        return;
    }

    const letter = String(rawLetter || '').trim().toLowerCase();
    if (!/^[a-z]$/.test(letter)) {
        await sock.sendMessage(chatId, { text: '❌ Please guess a single letter (a–z). Example: *.guess a*' });
        return;
    }

    const game = hangmanGames[chatId];
    const { word, guessedLetters, maskedWord, maxWrongGuesses } = game;

    if (guessedLetters.includes(letter)) {
        await sock.sendMessage(chatId, { text: `You already guessed "${letter}". Try another letter.` });
        return;
    }

    guessedLetters.push(letter);

    if (word.includes(letter)) {
        for (let i = 0; i < word.length; i++) {
            if (word[i] === letter) {
                maskedWord[i] = letter;
            }
        }

        if (!maskedWord.includes('_')) {
            await sock.sendMessage(chatId, { text: `🎉 Congratulations! You guessed the word: *${word}*` });
            delete hangmanGames[chatId];
        } else {
            await sock.sendMessage(chatId, { text: `✅ Good guess! \`${maskedWord.join(' ')}\`` });
        }
    } else {
        game.wrongGuesses += 1;
        if (game.wrongGuesses >= maxWrongGuesses) {
            await sock.sendMessage(chatId, { text: `💀 Game over! The word was: *${word}*` });
            delete hangmanGames[chatId];
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ Wrong guess! \`${maskedWord.join(' ')}\` — ${maxWrongGuesses - game.wrongGuesses} tries left.`
            });
        }
    }
}

module.exports = { startHangman, guessLetter };
