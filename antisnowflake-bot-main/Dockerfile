FROM node:20-slim

# Install system dependencies
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

# Pre-create writable runtime directories
RUN mkdir -p /app/data/sessions /app/data/flow_sessions /app/data/memory /app/data/config /app/catalog /app/tmp/pair_sessions /app/temp /app/scratch

# Expose port for Hugging Face Spaces (7860) and Railway/Render (8080)
EXPOSE 7860 8080

# HF Spaces uses port 7860 by default
ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "--no-warnings", "--expose-gc", "--max-old-space-size=400", "preload.js"]
