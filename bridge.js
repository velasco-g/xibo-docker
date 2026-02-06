
// bridge.js
// Bridge für Xibo: Login via Puppeteer + Screenshot-Streaming als <img>

const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");

const app = express();

// -------------------------------
// Konfiguration aus ENV
// -------------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const LOGIN_URL = process.env.LOGIN_URL || "https://mpa.noventa-consulting.com/cockpit#/login";
const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://mpa.noventa-consulting.com/cockpit/";

const USER_SELECTOR = process.env.USER_SELECTOR || "#username";
const PASS_SELECTOR = process.env.PASS_SELECTOR || "#password";
const SUBMIT_SELECTOR = process.env.SUBMIT_SELECTOR || 'button[type="submit"]';
const READY_SELECTOR = process.env.READY_SELECTOR || ""; // z.B. ".dashboard-root"

const COOKIE_FILE = process.env.COOKIE_FILE || path.join(__dirname, "cookies.json");

// Screenshot-Qualität
const VIEWPORT = {
  width: process.env.VIEWPORT_WIDTH ? Number(process.env.VIEWPORT_WIDTH) : 3840,
  height: process.env.VIEWPORT_HEIGHT ? Number(process.env.VIEWPORT_HEIGHT) : 2160,
  deviceScaleFactor: process.env.DEVICE_SCALE_FACTOR ? Number(process.env.DEVICE_SCALE_FACTOR) : 2,
};

// Headless-Steuerung
const HEADLESS = String(process.env.HEADLESS || "true").toLowerCase();
const HEADLESS_BOOL = ["1", "true", "yes"].includes(HEADLESS);

// Optional: Wenn du in Docker System-Chromium nutzt (siehe Dockerfile-Hinweis)
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

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
  if (browser && browser.process && browser.process() && !browser.isClosed) {
    return browser;
  }
  browser = await puppeteer.launch({
    headless: HEADLESS_BOOL,
    executablePath: PUPPETEER_EXECUTABLE_PATH, // kann undefined sein
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
    } catch {
      // Ignorieren, wir loggen uns ggf. neu ein
    }
  }

  // Versuche direkt ins Dashboard
  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });

  // Sind wir auf Login?
  const onLoginByUrl = page.url().toLowerCase().includes("login");
  const loginFieldExists = await page.$(USER_SELECTOR);

  if (onLoginByUrl || loginFieldExists) {
    // Sicher zur Login-URL
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    await page.waitForSelector(USER_SELECTOR, { timeout: 20000 });

    // Eingabefelder leeren
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
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    ]);

    // Nach Login zum Dashboard
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    // Cookies persistieren
    try {
      const cookies = await page.cookies();
      await fs.ensureDir(path.dirname(COOKIE_FILE));
      await fs.writeJson(COOKIE_FILE, cookies, { spaces: 2 });
    } catch {
      // nicht kritisch
    }
  }

  // Warten bis App ready
  if (READY_SELECTOR) {
    await page.waitForSelector(READY_SELECTOR, { timeout: 20000 }).catch(() => {});
  } else {
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

    // Scrollbars ausblenden
    await page.evaluateOnNewDocument(() => {
      const style = document.createElement("style");
      style.innerHTML = `
        ::-webkit-scrollbar { display: none !important; width: 0 !important; }
        html, body { overscroll-behavior: none; }
      `;
      document.documentElement.appendChild(style);
    });

    await ensureLoggedIn(page);
    await page.waitForTimeout(300);

    const pngBuffer = await page.screenshot({
      type: "png",
      fullPage: Boolean(fullPage),
    });

    return pngBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

// -------------------------------
// Endpunkt: Live-Bild
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
// Statische Variante: /latest.png (on-demand)
// -------------------------------
const LATEST_IMG = process.env.LATEST_IMG || path.join(path.dirname(COOKIE_FILE), "latest.png");

app.get("/latest.png", async (req, res) => {
  try {
    if (!(await fs.pathExists(LATEST_IMG))) {
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
    object-fit: contain;
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
    const USE_FULLPAGE = false;

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
        setTimeout(loadImage, 1500);
      };

      tmp.src = newSrc;
    }

    loadImage();
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
``
