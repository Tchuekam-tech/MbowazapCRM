const axios = require("axios");

async function weatherCommand(sock, chatId, message, q) {
  try {
    if (!q || !q.trim()) {
      return await sock.sendMessage(
        chatId,
        { text: "❗ Please provide a city name.\n\n📌 Example: `.weather Douala`" },
        { quoted: message }
      );
    }

    const city = q.trim();
    const apiKey = process.env.OPENWEATHER_API_KEY || "";

    if (apiKey) {
      try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
        const response = await axios.get(url, { timeout: 10000 });
        const weather = response.data;
        const weatherReport =
          `╭━━〔 WEATHER REPORT 〕━━╮\n` +
          `┃ 📍 *Location:* ${weather.name}, ${weather.sys?.country || ''}\n` +
          `┃ 🌡️ *Temp:* ${weather.main.temp}°C\n` +
          `┃ 🌡️ *Feels like:* ${weather.main.feels_like}°C\n` +
          `┃ 🌡️ *Min / Max:* ${weather.main.temp_min}°C / ${weather.main.temp_max}°C\n` +
          `┃ ☁️ *Weather:* ${weather.weather?.[0]?.main || ''} (${weather.weather?.[0]?.description || ''})\n` +
          `┃ 💧 *Humidity:* ${weather.main.humidity}%\n` +
          `┃ 🌬️ *Wind Speed:* ${weather.wind?.speed ?? 0} m/s\n` +
          `┃ 🌪️ *Pressure:* ${weather.main.pressure} hPa\n` +
          `╰═❀════════════════❀═╯\n\n> *Powered By TCHUEK-TECH*`;

        return await sock.sendMessage(chatId, { text: weatherReport }, { quoted: message });
      } catch (owErr) {
        if (owErr.response?.status === 404) {
          return await sock.sendMessage(
            chatId,
            { text: `🚫 City "${city}" not found. Please check the spelling and try again.` },
            { quoted: message }
          );
        }
        // Fall through to keyless wttr.in fallback
      }
    }

    // Keyless fallback via wttr.in JSON API
    const wttrRes = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      timeout: 10000,
      headers: { "User-Agent": "TchuekBot/1.0" },
    });
    const current = wttrRes.data?.current_condition?.[0];
    const area = wttrRes.data?.nearest_area?.[0];
    if (!current) {
      throw new Error("No weather data returned");
    }

    const areaName = area?.areaName?.[0]?.value || city;
    const countryName = area?.country?.[0]?.value || "";
    const desc = current.weatherDesc?.[0]?.value || "Clear";

    const report =
      `╭━━〔 WEATHER REPORT 〕━━╮\n` +
      `┃ 📍 *Location:* ${areaName}${countryName ? `, ${countryName}` : ""}\n` +
      `┃ 🌡️ *Temp:* ${current.temp_C}°C (Feels like ${current.FeelsLikeC}°C)\n` +
      `┃ ☁️ *Condition:* ${desc}\n` +
      `┃ 💧 *Humidity:* ${current.humidity}%\n` +
      `┃ 🌬️ *Wind:* ${current.windspeedKmph} km/h (${current.winddir16Point || ""})\n` +
      `┃ 🌪️ *Pressure:* ${current.pressure} hPa\n` +
      `╰═❀════════════════❀═╯\n\n> *Powered By TCHUEK-TECH*`;

    await sock.sendMessage(chatId, { text: report }, { quoted: message });
  } catch (e) {
    console.error("weatherCommand error:", e.message || e);
    await sock.sendMessage(
      chatId,
      { text: "⚠️ Could not fetch weather info right now. Check the city name and try again." },
      { quoted: message }
    );
  }
}

module.exports = weatherCommand;
