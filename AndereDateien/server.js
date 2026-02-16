
// server.js
// Bridge für Xibo: Login via Puppeteer + Screenshot-Streaming als <img>
// Autor: für Gabriela Velasco
// Node >= 18 empfohlen

const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

// -------------------------------
// Konfiguration
// -------------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const LOGIN_URL = process.env.LOGIN_URL || "https://mpa.noventa-consulting.com/cockpit#/login";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://mpa.noventa-consulting.com/cockpit/";

const USER_SELECTOR = process.env.USER_SELECTOR || "#username";
const PASS_SELECTOR = process.env.PASS_SELECTOR || "#password";
const SUBMIT_SELECTOR = process.env.SUBMIT_SELECTOR || 'button[type="submit"]';

// Optionaler "Ready"-Selector, wenn bekannt (ansonsten wird heuristisch gewartet)
const READY_SELECTOR = process.env.READY_SELECTOR || ""; // z.B. ".dashboard-root"

const COOKIE_FILE = path.join(__dirname, "cookies.json");

// Screenshot-Qualität
const VIEWPORT = {
  width: process.env.VIEWPORT_WIDTH ? Number(process.env.VIEWPORT_WIDTH) : 3840,
  height: process.env.VIEWPORT_HEIGHT ? Number(process.env.VIEWPORT_HEIGHT) : 2160,
  deviceScaleFactor: process.env.DEVICE_SCALE_FACTOR ? Number(process.env.DEVICE_SCALE_FACTOR) : 2,
};

// -------------------------------
// HTTP-Header: Cache verbieten (wichtig in Xibo)
// -------------------------------
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// -------------------------------
// Puppeteer: Browser-Management (einmal starten, wiederverwenden)
// -------------------------------
let browser;

async function getBrowser() {
  if (browser && browser.process() && !browser.isClosed) {
    return browser;
  }
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--window-size=1920,1080",
    ],
  });
  return browser;
}

// -------------------------------
// Login-Handling
// -------------------------------
async function ensureLoggedIn(page) {
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(30000);

  // Sprache/UA für stabile Darstellung
  await page.setExtraHTTPHeaders({
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
  });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );

  // Vorhandene Cookies laden
  if (await fs.pathExists(COOKIE_FILE)) {
    try {
      const cookies = await fs.readJson(COOKIE_FILE);
      if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    } catch (e) {
      // Ignorieren, neu einloggen
    }
  }

  // Mit Cookies versuchen direkt das Dashboard zu öffnen
  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });

  // Prüfen, ob wir auf der Login-Seite gelandet sind
  const onLoginByUrl = page.url().toLowerCase().includes("login");
  const loginFieldExists = await page.$(USER_SELECTOR);

  if (onLoginByUrl || loginFieldExists) {
    // Sicher zur Login-URL
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    // Eingabe abwarten
    await page.waitForSelector(USER_SELECTOR, { timeout: 20000 });

    // Vorherige Inhalte leeren (zur Sicherheit)
    await page.evaluate(
      (uSel, pSel) => {
        const u = document.querySelector(uSel);
        const p = document.querySelector(pSel);
        if (u) u.value = "";
        if (p) p.value = "";
      },
      USER_SELECTOR,
      PASS_SELECTOR
    );

    await page.type(USER_SELECTOR, process.env.NOVENTA_USER || "", { delay: 35 });
    await page.type(PASS_SELECTOR, process.env.NOVENTA_PASS || "", { delay: 35 });

    await Promise.all([
      page.click(SUBMIT_SELECTOR),
      // SPA: Navigation kann hängen -> nicht nur auf Navigation warten
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    ]);

    // Nach dem Login sicher auf Dashboard
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
    // Kurze "Calm-Down"-Zeit, bis SPA initialisiert ist
    await page.waitForTimeout(1200);

    // Cookies speichern (Session erhalten)
    try {
      const cookies = await page.cookies();
      await fs.writeJson(COOKIE_FILE, cookies, { spaces: 2 });
    } catch (e) {
      // Nicht kritisch
    }
  }

  // Warten, bis die App "ready" ist
  if (READY_SELECTOR) {
    await page.waitForSelector(READY_SELECTOR, { timeout: 20000 }).catch(() => {});
  } else {
    // Heuristik: Netzwerk beruhigen + kleiner Delay
    // (SPAs feuern oft ständig Requests – networkidle kann daher hängen)
    await Promise.race([
      page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {}),
      page.waitForTimeout(2500),
    ]);
  }
}

// -------------------------------
// Hilfsfunktion: Screenshot als Buffer
// -------------------------------
async function captureScreenshot({ fullPage = false }) {
  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setViewport(VIEWPORT);

    // Scrollbars ausblenden (optisch sauberer)
    await page.evaluateOnNewDocument(() => {
      const style = document.createElement("style");
      style.innerHTML = `
        ::-webkit-scrollbar { display: none !important; width: 0 !important; }
        html, body { overscroll-behavior: none; }
      `;
      document.documentElement.appendChild(style);
    });

    await ensureLoggedIn(page);

    // Als zusätzliche Absicherung: wenige ms warten
    await page.waitForTimeout(300);

    const pngBuffer = await page.screenshot({
      type: "png",
      fullPage: Boolean(fullPage),
      // omitBackground: false  // falls Transparenz gewünscht wäre
    });

    return pngBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

// -------------------------------
// Endpunkt: Live-Bild
// - optional ?full=1 für Vollseiten-Screenshot
// -------------------------------
app.get("/bridge-image", async (req, res) => {
  try {
    const fullPage = ["1", "true", "yes"].includes(String(req.query.full || "").toLowerCase());
    const img = await captureScreenshot({ fullPage });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.send(img);
  } catch (err) {
    console.error("Screenshot error", err);
    res.status(500).send("Screenshot Error: " + err.toString());
  }
});

// -------------------------------
// Optionale statische Variante: /latest.png
// (Wenn du das später als Cron/Interval rendern willst, kannst du unten einen Job aktivieren.)
// -------------------------------
const LATEST_IMG = path.join(__dirname, "latest.png");

app.get("/latest.png", async (req, res) => {
  try {
    if (!(await fs.pathExists(LATEST_IMG))) {
      // Fallback: jetzt rendern
      const img = await captureScreenshot({ fullPage: false });
      await fs.writeFile(LATEST_IMG, img);
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.sendFile(LATEST_IMG);
  } catch (err) {
    console.error("latest.png error", err);
    res.status(500).send("Latest image Error: " + err.toString());
  }
});

// -------------------------------
// Bridge-Frontend (Fading <img>)
// -------------------------------
app.get("/bridge", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>MPA Leitstand</title>
<meta http-equiv="Cache-Control" content="no-store" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  html, body {
    margin: 0;
    background: #111;
    font-family: Arial, sans-serif;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  #screen {
    width: 100vw;
    height: 100vh;
    object-fit: contain; /* oder 'cover' je nach Wunsch */
    opacity: 0;
    transition: opacity 0.6s ease-in-out;
    display: block;
    background: #000;
  }
  #version {
    position: fixed;
    top: 4px;
    left: 4px;
    padding: 4px 6px;
    background:#000c;
    color:#0f0;
    font-size:12px;
    z-index: 9999;
    font-family: monospace;
    border: 1px solid #0f0;
    border-radius: 3px;
  }
</style>
</head>
<body>
  <div id="version">Bridge v2.1 – Smooth Fade • ${new Date().toISOString()}</div>
  <img id="screen" src="" alt="loading..." />
  <script>
    const USE_FULLPAGE = false; // Bei Bedarf auf true setzen oder per Querystring an /bridge-image?full=1

    function nextImageUrl() {
      const base = "/bridge-image" + (USE_FULLPAGE ? "?full=1" : "");
      const ts = Date.now();
      return base + (base.includes("?") ? "&" : "?") + "_=" + ts;
    }

    function loadImage() {
      const img = document.getElementById("screen");
      const tmp = new Image();
      const newSrc = nextImageUrl();

      tmp.onload = () => {
        img.style.opacity = 0;
        setTimeout(() => {
          img.src = newSrc;
          img.style.opacity = 1;
        }, 80);
      };

      tmp.onerror = () => {
        // Beim Fehler minimalen Retry-Backoff
        setTimeout(loadImage, 1500);
      };

      tmp.src = newSrc;
    }

    // Initial laden
    loadImage();
    // Alle 3 Sekunden neues Bild
    setInterval(loadImage, 3000);
  </script>
</body>
</html>`);
});

// -------------------------------
// Healthcheck
// -------------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// -------------------------------
// Serverstart
// -------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge läuft auf http://0.0.0.0:${PORT}/bridge`);
});

// -------------------------------
// OPTIONALER Hintergrund-Renderer für /latest.png
// -> auskommentiert lassen, wenn Live-/bridge-image genutzt wird
// -------------------------------
// async function updateLatestLoop() {
//   while (true) {
//     try {
//       const img = await captureScreenshot({ fullPage: false });
//       // Atomar schreiben
//       const tmp = LATEST_IMG + ".tmp";
//       await fs.writeFile(tmp, img);
//       await fs.move(tmp, LATEST_IMG, { overwrite: true });
//     } catch (e) {
//       console.error("updateLatestLoop error:", e);
//     }
//     // Alle 5 Sekunden aktualisieren
//     await new Promise(r => setTimeout(r, 5000));
//   }
// }
// updateLatestLoop().catch(console.error);
