// bridge.js – stabile Version
// Puppeteer Bridge für Xibo – Login, WebGL, Cookies, Screenshot

const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
const app = express();

/* ============================================
 *   KONFIGURATION
 * ============================================ */

const PORT = Number(process.env.PORT || 3000);

const DASHBOARD_URL = process.env.DASHBOARD_URL;
const LOGIN_URL = process.env.LOGIN_URL;

const USER_SELECTOR = process.env.USER_SELECTOR || "#username";
const PASS_SELECTOR = process.env.PASS_SELECTOR || "#password";
const SUBMIT_SELECTOR = process.env.SUBMIT_SELECTOR || 'button[type="submit"]';
const READY_SELECTOR = process.env.READY_SELECTOR || "";

const LOGIN_USER = process.env.NOVENTA_USER || "";
const LOGIN_PASS = process.env.NOVENTA_PASS || "";

const COOKIE_FILE = process.env.COOKIE_FILE || "/data/cookies.json";

const VIEWPORT = {
  width: Number(process.env.VIEWPORT_WIDTH || 1920),
  height: Number(process.env.VIEWPORT_HEIGHT || 1080),
  deviceScaleFactor: Number(process.env.DEVICE_SCALE_FACTOR || 2),
};

/* ============================================
 *   HTML OBERFLÄCHE
 * ============================================ */

function renderBridgeHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Bridge</title>
<style>
  body { margin:0; font-family:Arial; background:#111; color:#eee; }
  .frame { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
  img { width:100%; height:100%; object-fit:contain; background:#000; }
  .overlay { position:absolute; bottom:10px; left:10px; padding:6px 10px;
    border-radius:8px; background:rgba(0,0,0,0.6); font-size:14px; }
</style>
</head>
<body>
<div class="frame">
  <img id="imgA">
  <div class="overlay" id="status">Verbinde…</div>
</div>

<script>
function ts(u){ return u + "?_=" + Date.now(); }
function update(){
  const img = document.getElementById("imgA");
  img.src = ts("/bridge-image");
  document.getElementById("status").textContent =
    "Aktualisiert: " + new Date().toLocaleTimeString();
}
update();
setInterval(update, ${process.env.UI_REFRESH_MS || 1500});
</script>
</body>
</html>
`;
}

/* ============================================
 *   PUPPETEER
 * ============================================ */

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;

  browser = await puppeteer.launch({
    headless: "new",
    executablePath: "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=egl",
      "--enable-webgl",
      "--enable-gpu-rasterization",
      "--disable-software-rasterizer",
      "--window-size=2560,1440",
    ],
  });

  browser.on("disconnected", () => {
    browser = null;
  });

  return browser;
}

/* ============================================
 *   LOGIN & SPA-STABILISIERUNG
 * ============================================ */

async function ensureLoggedIn(page) {

  // Cookies laden
  if (await fs.pathExists(COOKIE_FILE)) {
    try {
      const cookies = await fs.readJson(COOKIE_FILE);
      if (Array.isArray(cookies) && cookies.length) {
        await page.setCookie(...cookies);
      }
    } catch (e) {
      console.warn("Cookies konnten nicht geladen werden:", e.message);
    }
  }

  // Dashboard aufrufen
  await page.goto(DASHBOARD_URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // SPA Zeit geben
  await page.waitForTimeout(4000);

  // Prüfen ob Login nötig
  const needsLogin =
    page.url().toLowerCase().includes("login") ||
    await page.$(USER_SELECTOR);

  if (needsLogin && LOGIN_USER && LOGIN_PASS) {

    await page.goto(LOGIN_URL, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    await page.waitForSelector(USER_SELECTOR, { timeout: 30000 });

    await page.type(USER_SELECTOR, LOGIN_USER, { delay: 30 });
    await page.type(PASS_SELECTOR, LOGIN_PASS, { delay: 30 });

    await Promise.all([
      page.click(SUBMIT_SELECTOR),
      page.waitForTimeout(5000), // Hash-Routing → kein echtes Navigation-Event
    ]);

    // Cookies speichern
    await fs.ensureDir(path.dirname(COOKIE_FILE));
    await fs.writeJson(COOKIE_FILE, await page.cookies());
  }

  // Rendering absichern (Canvas/WebGL)
  if (READY_SELECTOR) {
    await page.waitForSelector(READY_SELECTOR, { timeout: 15000 }).catch(() => {});
  } else {
    await page.waitForFunction(() => {
      const c = document.querySelector("canvas");
      return c && c.width > 300 && c.height > 300;
    }, { timeout: 15000 }).catch(() => {});
  }

  await page.waitForTimeout(2000);
}

/* ============================================
 *   SCREENSHOT
 * ============================================ */

async function captureScreenshot() {
  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setViewport(VIEWPORT);
    await ensureLoggedIn(page);

    // Hintergrund erzwingen (gegen transparente Frames)
    await page.evaluate(() => {
      document.body.style.background = "#000";
    });

    return await page.screenshot({ type: "png" });
  } finally {
    await page.close().catch(() => {});
  }
}

/* ============================================
 *   ROUTES
 * ============================================ */

app.get("/", (_, res) => res.redirect("/bridge"));

app.get("/bridge", (_, res) => {
  res.send(renderBridgeHTML());
});

app.get("/bridge-image", async (_, res) => {
  try {
    const img = await captureScreenshot();
    res.setHeader("Content-Type", "image/png");
    res.send(img);
  } catch (err) {
    console.error("Screenshot Error:", err);
    res.status(500).send(err.toString());
  }
});

app.get("/health", (_, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ============================================
 *   START
 * ============================================ */

app.listen(PORT, "0.0.0.0", () => {
  console.log("Bridge läuft auf http://0.0.0.0:" + PORT);
});
