FROM node:20-bullseye-slim

WORKDIR /app

# Kopiere nur package.json zuerst (schnellerer rebuild)
COPY package.json ./

RUN npm install --production

# Kopiere App
COPY bridge.js ./

# Abhängigkeiten für Headless Chrome
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libnss3 libx11-6 libxss1 libasound2 libatk1.0-0 \
    libatk-bridge2.0-0 libcairo2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libpangocairo-1.0-0 \
    libxcomposite1 libxdamage1 libxrandr2 libxcb1 wget --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3000
CMD ["node", "bridge.js"]
