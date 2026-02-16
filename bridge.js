const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();
const app = express();

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

function renderBridgeHTML(statusText = "Verbinde…") {
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
  <div class="overlay" id="status">${statusText}</div>
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

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;

  console.log("Puppeteer startet Chrome, Headless:", process.env.HEADLESS);
  console.log("Cache-Verzeichnis:", process.env.PUPPETEER_CACHE_DIR);

  try {
    browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // nutzt den installierten Browser
  userDataDir: "/data/puppeteer",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=2560,1440",
    "--disable-features=VizDisplayCompositor",
  ],
});
    browser.on("disconnected", () => { browser = null; });
    console.log("Puppeteer: Chrome gestartet ✅");
    return browser;
  } catch (e) {
    console.error("Puppeteer Fehler:", e.message);
    throw new Error("Puppeteer konnte Chrome nicht starten. " + e.message);
  }
}

async function ensureLoggedIn(page) {
  try {
    if (await fs.pathExists(COOKIE_FILE)) {
      const cookies = await fs.readJson(COOKIE_FILE);
      if (Array.isArray(cookies) && cookies.length) {
        await page.setCookie(...cookies);
        console.log("Cookies geladen ✅");
      }
    }

    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForTimeout(4000);

    const needsLogin =
      page.url().toLowerCase().includes("login") || await page.$(USER_SELECTOR);

    if (needsLogin && LOGIN_USER && LOGIN_PASS) {
      await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector(USER_SELECTOR, { timeout: 30000 });
      await page.type(USER_SELECTOR, LOGIN_USER, { delay: 30 });
      await page.type(PASS_SELECTOR, LOGIN_PASS, { delay: 30 });
      await Promise.all([
        page.click(SUBMIT_SELECTOR),
        page.waitForTimeout(5000),
      ]);
      await fs.ensureDir(path.dirname(COOKIE_FILE));
      await fs.writeJson(COOKIE_FILE, await page.cookies());
      console.log("Login erfolgreich ✅");
    }

    if (READY_SELECTOR) {
      await page.waitForSelector(READY_SELECTOR, { timeout: 15000 }).catch(() => {});
    } else {
      await page.waitForFunction(() => {
        const c = document.querySelector("canvas");
        return c && c.width > 300 && c.height > 300;
      }, { timeout: 15000 }).catch(() => {});
    }

    await page.waitForTimeout(2000);

  } catch (err) {
    console.error("Login/Render Fehler:", err.message);
    throw new Error("Login oder Rendering fehlgeschlagen: " + err.message);
  }
}

async function captureScreenshot() {
  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.setViewport(VIEWPORT);
    await ensureLoggedIn(page);
    await page.evaluate(() => { document.body.style.background = "#000"; });
    const img = await page.screenshot({ type: "png" });
    console.log("Screenshot erstellt ✅");
    return img;
  } catch (err) {
    console.error("Screenshot Fehler:", err.message);
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}

// Routes
app.get("/", (_, res) => res.redirect("/bridge"));
app.get("/bridge", (_, res) => res.send(renderBridgeHTML()));
app.get("/bridge-image", async (_, res) => {
  try {
    const img = await captureScreenshot();
    res.setHeader("Content-Type", "image/png");
    res.send(img);
  } catch (err) {
    console.error("Bild-Route Fehler:", err.message);
    res.send(renderBridgeHTML("❌ Fehler: " + err.message));
  }
});
app.get("/health", (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("Bridge läuft auf http://0.0.0.0:" + PORT);
});
