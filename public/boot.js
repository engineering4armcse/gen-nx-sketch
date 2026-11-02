// If the app script fails to start (usually old cached files after an update), say so instead of doing nothing.
setTimeout(() => { if (!window.__appReady) { const s = document.getElementById("status"); if (s) { s.className = "status err"; s.textContent = "The app did not start. Press Ctrl+F5 to reload, and restart node server.mjs if it persists."; } } }, 3000);
