# syntax=docker/dockerfile:1.6
FROM node:20-bullseye-slim

ENV NODE_ENV=production
WORKDIR /app

# Systemlibs für Puppeteer + Chrome
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation fonts-noto fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core \
    libnss3 libx11-6 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libcairo2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libpangocairo-1.0-0 \
    libxcomposite1 libxdamage1 libxrandr2 libxcb1 \
    libglu1-mesa mesa-utils libvulkan1 \
    wget curl unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Node Dependencies
COPY package*.json ./
RUN npm install --omit=dev

# App Code
COPY bridge.js ./

# Nicht-root user
RUN useradd -m -u 10001 appuser
USER appuser

# Puppeteer Cache auf Volume /data/puppeteer
ENV PUPPETEER_CACHE_DIR=/data/puppeteer

# Installiere Chrome für Puppeteer
RUN npx puppeteer install chrome

EXPOSE 3500

# Start der Bridge
CMD ["node", "bridge.js"]
