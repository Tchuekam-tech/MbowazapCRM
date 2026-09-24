FROM node:20-slim

# Install system dependencies (git: Baileys pulls libsignal from GitHub)
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    openssl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install package dependencies
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy application files
COPY . .

# Everything the bot keeps at runtime lives in /app/data: the WhatsApp
# sessions (data/sessions), the wacrm outbox and Davila switches
# (data/bridge), flow and memory state. On Railway, mount a volume there
# or every deploy unlinks WhatsApp. A fresh volume is empty and hides the
# JSON files shipped in data/, so keep a copy to seed it from at start.
RUN mkdir -p /app/data/sessions /app/data/flow_sessions /app/data/memory /app/data/config /app/catalog /app/tmp/pair_sessions /app/temp /app/scratch \
    && cp -r /app/data /app/data-seed

# Railway and Render inject PORT; Hugging Face Spaces expects 7860.
EXPOSE 7860 8080
ENV PORT=7860
ENV NODE_ENV=production

# Seed missing data files without overwriting anything on the volume.
CMD ["sh", "-c", "mkdir -p /app/data && cp -rn /app/data-seed/. /app/data/ 2>/dev/null; exec node --no-warnings --expose-gc --max-old-space-size=400 preload.js"]
