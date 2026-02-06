
async function loadData() {
  try {
    // Cache-Buster gegen aggressive Caches von Playern/Proxies
    const res = await fetch('/bridge-json?_=' + Date.now());
    if (!res.ok) throw new Error('Fehler beim Laden der Daten');
    const data = await res.json();

    const dashboard = document.getElementById('dashboard');
    dashboard.innerHTML = '';

    data.forEach(d => {
      const perfClass = (d.performance || '').trim().startsWith('+') ? 'positive' : 'negative';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h2>${d.line ?? '-'}</h2>
        <div class="status ${perfClass}">
          Performance: ${d.performance ?? '-'}
        </div>
        <div class="details">
          Produkt: ${d.product ?? '-'}<br>
          Stückzahl: ${d.count ?? 0} (Gesamt: ${d.sum ?? 0})<br>
          Start: ${d.start ?? '-'}<br>
          Störungen: ${d.issues ?? '—'}<br>
          Aktuelle Störung: ${d.currentIssue || 'Keine'}
        </div>
      `;
      dashboard.appendChild(card);
    });

    document.getElementById('errorMsg').style.display = 'none';
  } catch (err) {
    const error = document.getElementById('errorMsg');
    error.style.display = 'block';
    error.textContent = "Fehler: " + err.message;
  }
}

// Erstmaliger Load + Auto-Refresh alle 10 Sekunden
loadData();
setInterval(loadData, 10000);
