FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    openssl \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install package dependencies
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy application files
COPY . .

# Pre-create writable runtime directories
RUN mkdir -p /app/data/sessions \
             /app/data/flow_sessions \
             /app/data/memory \
             /app/data/config \
             /app/data/bridge \
             /app/catalog \
             /app/tmp/pair_sessions \
             /app/temp \
             /app/scratch && \
    [ -f /app/data/owner.json ] || echo '["237653683174"]' > /app/data/owner.json

# Expose ports for Railway (8080) and HF Spaces (7860)
EXPOSE 8080 7860

ENV PORT=8080
ENV HOST="::"
ENV NODE_ENV=production

CMD ["node", "--no-warnings", "--expose-gc", "--max-old-space-size=400", "preload.js"]
