# syntax=docker/dockerfile:1.6

FROM node:20-bullseye-slim

ENV NODE_ENV=production

WORKDIR /app

# ---------------------------------------------------------
# Systemlibs für Chromium + Schriften + WebGL
# ---------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    # Fonts (Emoji + International)
    fonts-liberation fonts-noto fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core \
    # Chromium Runtime Dependencies
    libnss3 libx11-6 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libcairo2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libpangocairo-1.0-0 \
    libxcomposite1 libxdamage1 libxrandr2 libxcb1 \
    # WebGL / Software Rendering
    libglu1-mesa mesa-utils libvulkan1 \
  && rm -rf /var/lib/apt/lists/*


# ---------------------------------------------------------
# Node Dependencies zuerst – Build cache optimieren
# ---------------------------------------------------------
COPY package*.json ./


# Installiere NUR die Production-Dependencies
# Puppeteer lädt hier automatisch Chromium!
RUN npm install --omit=dev


# ---------------------------------------------------------
# App Code
# ---------------------------------------------------------
COPY bridge.js ./


# ---------------------------------------------------------
# Nicht-root User
# ---------------------------------------------------------
RUN useradd -m -u 10001 appuser
USER appuser

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation fonts-noto fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core \
    libnss3 libx11-6 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libcairo2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libpangocairo-1.0-0 \
    libxcomposite1 libxdamage1 libxrandr2 libxcb1 \
    libglu1-mesa mesa-utils libvulkan1 \
  && rm -rf /var/lib/apt/lists/*

# >>> Add this <<<
RUN apt-get update && apt-get install -y chromium && \
    rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y chromium && \
    rm -rf /var/lib/apt/lists/*


# ---------------------------------------------------------
# Runtime
# ---------------------------------------------------------
EXPOSE 3000

CMD ["node", "bridge.js"]