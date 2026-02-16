const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const dotenv = require("dotenv");

dotenv.config();
const app = express();

const PORT = Number(process.env.PORT || 3500);
const TARGET = "https://mpa.noventa-consulting.com";

// ---------------------------------------------------
// UI – DEIN NEUES COOLER RAHMEN
// ---------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Noventa Live</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body{
    margin:0;
    background:radial-gradient(circle at 20% 20%, #0f172a, #020617);
    font-family:Arial, Helvetica, sans-serif;
    overflow:hidden;
  }

  header{
    position:fixed;
    top:0;
    left:0;
    right:0;
    height:54px;
    background:rgba(0,0,0,0.6);
    backdrop-filter: blur(6px);
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:0 20px;
    z-index:10;
    border-bottom:1px solid rgba(255,255,255,0.1);
  }

  .pulse{
    width:10px;
    height:10px;
    background:#22c55e;
    border-radius:50%;
    box-shadow:0 0 10px #22c55e;
    margin-right:10px;
  }

  iframe{
    position:absolute;
    top:54px;
    left:0;
    width:100%;
    height:calc(100% - 54px);
    border:0;
    background:#000;
  }

  .clock{
    font-size:14px;
    opacity:0.8;
  }
</style>
</head>

<body>
  <header>
    <div style="display:flex;align-items:center;">
      <div class="pulse"></div>
      <div>Noventa Leitstand • LIVE</div>
    </div>
    <div class="clock" id="clock"></div>
  </header>

  <iframe src="/proxy/cockpit#/"></iframe>

<script>
function updateClock(){
  document.getElementById("clock").textContent =
    new Date().toLocaleTimeString();
}
setInterval(updateClock,1000);
updateClock();
</script>
</body>
</html>
`);
});

// ---------------------------------------------------
// PROXY – HOLT DIE ECHTE SEITE
// ---------------------------------------------------
app.use(
  "/proxy",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: {
      "^/proxy": "",
    },
    onProxyRes(proxyRes) {
      delete proxyRes.headers["x-frame-options"];
      delete proxyRes.headers["content-security-policy"];
    },
  })
);

// ---------------------------------------------------
app.get("/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("HTML Bridge läuft auf Port " + PORT);
});
