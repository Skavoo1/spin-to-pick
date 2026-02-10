// Spin-To-Pick (vanilla)
// Added: odds + results tracking (counts + observed %) inspired by wheelofnames-style stats UX.

const $ = (s) => document.querySelector(s);

const canvas = $("#wheel");
const ctx = canvas.getContext("2d");

const btnSpin = $("#btnSpin");
const btnShuffle = $("#btnShuffle");
const btnReset = $("#btnReset");
const btnCopy = $("#btnCopy");
const btnResetStats = $("#btnResetStats");

const input = $("#newItem");
const btnAdd = $("#btnAdd");
const chips = $("#chips");

const presetSel = $("#preset");
const btnSaveList = $("#btnSaveList");
const savedListsSel = $("#savedLists");
const btnLoadList = $("#btnLoadList");
const btnDeleteList = $("#btnDeleteList");

const resultText = $("#resultText");
const totalSpinsText = $("#totalSpinsText");

const oddsList = $("#oddsList");
const resultsList = $("#resultsList");

const btnTheme = $("#btnTheme");

const LS_ITEMS = "stp_items_v1";
const LS_LISTS = "stp_saved_lists_v1";
const LS_THEME = "stp_theme_v1";
const LS_STATS = "stp_stats_v1";

let items = loadItems() ?? ["Pizza", "Tacos", "Sushi", "Burgers", "Salad", "Pasta"];
let stats = loadStats() ?? { total: 0, counts: {} };

let isSpinning = false;
let angle = 0; // radians
let spinRaf = null;

// ---- wheel drawing ----
function hashToHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

function drawWheel() {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 10;

  ctx.clearRect(0, 0, w, h);

  // background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();

  if (!items.length) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "20px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Add options to spin!", cx, cy);
    return;
  }

  const seg = (Math.PI * 2) / items.length;

  for (let i = 0; i < items.length; i++) {
    const start = angle + i * seg;
    const end = start + seg;

    const hue = hashToHue(items[i]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.40)`;
    ctx.fill();

    // divider line
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + seg / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 18px ui-sans-serif, system-ui";
    wrapText(items[i], r - 16, 0, 180);
    ctx.restore();
  }

  // center cap
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();
}

function wrapText(text, x, y, maxWidth) {
  const words = String(text).split(" ");
  let line = "";
  const lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);

  const lineHeight = 20;
  const startY = y - (lines.length - 1) * (lineHeight / 2);
  lines.forEach((ln, idx) => ctx.fillText(ln, x, startY + idx * lineHeight));
}

// ---- UI helpers ----
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function renderChips() {
  chips.innerHTML = "";
  items.forEach((it, idx) => {
    const el = document.createElement("div");
    el.className = "chip";
    el.innerHTML = `
      <span>${escapeHtml(it)}</span>
      <button aria-label="Remove">✕</button>
    `;
    el.querySelector("button").addEventListener("click", () => {
      items.splice(idx, 1);
      persistItems();
      // keep stats history, but refresh displays for current items
      updateAll();
    });
    chips.appendChild(el);
  });

  btnSpin.disabled = items.length < 2 || isSpinning;
  btnShuffle.disabled = items.length < 2 || isSpinning;
  btnReset.disabled = items.length === 0 || isSpinning;
}

function setResult(text) {
  resultText.textContent = text;
  btnCopy.disabled = (text === "—");
}

function fmtPct(x) {
  // x is in [0, 1]
  const pct = x * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return pct.toFixed(2) + "%";
  if (pct < 10) return pct.toFixed(1) + "%";
  return Math.round(pct) + "%";
}

function syncStatsKeys() {
  // Ensure stats.counts has keys for current items (without deleting old history keys)
  stats.counts ||= {};
  for (const it of items) {
    if (typeof stats.counts[it] !== "number") stats.counts[it] = 0;
  }
}

function renderOddsAndResults() {
  syncStatsKeys();

  // Odds: equal probability per current option
  oddsList.innerHTML = "";
  resultsList.innerHTML = "";

  if (!items.length) {
    oddsList.innerHTML = `<div class="small muted">Add options to see odds.</div>`;
    resultsList.innerHTML = `<div class="small muted">Spin the wheel to see results.</div>`;
    totalSpinsText.textContent = `Total spins: ${stats.total || 0}`;
    return;
  }

  const theoretical = 1 / items.length;
  const total = stats.total || 0;

  // Sort results by count desc, then name
  const sorted = [...items].sort((a, b) => {
    const ca = stats.counts[a] ?? 0;
    const cb = stats.counts[b] ?? 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });

  // Odds (keep alphabetical so it's predictable)
  [...items].sort((a,b)=>a.localeCompare(b)).forEach((it) => {
    const row = document.createElement("div");
    row.className = "itemRow";
    row.innerHTML = `
      <div>${escapeHtml(it)}</div>
      <div class="value">${fmtPct(theoretical)}</div>
      <div class="badge">1 / ${items.length}</div>
    `;
    oddsList.appendChild(row);
  });

  // Results (sorted by most common)
  sorted.forEach((it) => {
    const count = stats.counts[it] ?? 0;
    const observed = total > 0 ? (count / total) : 0;

    const row = document.createElement("div");
    row.className = "itemRow";
    row.innerHTML = `
      <div>${escapeHtml(it)}</div>
      <div class="value">${count}</div>
      <div class="badge">${fmtPct(observed)}</div>
    `;
    resultsList.appendChild(row);
  });

  totalSpinsText.textContent = `Total spins: ${total}`;
}

function updateAll() {
  renderChips();
  drawWheel();
  renderOddsAndResults();
}

// ---- spin logic ----
function pickIndexFromAngle() {
  const seg = (Math.PI * 2) / items.length;
  const pointerAngle = (Math.PI * 1.5 - angle) % (Math.PI * 2);
  const idx = Math.floor(pointerAngle / seg);
  return (idx + items.length) % items.length;
}

function recordWin(winner) {
  syncStatsKeys();
  stats.total = (stats.total || 0) + 1;
  stats.counts[winner] = (stats.counts[winner] || 0) + 1;
  persistStats();
}

function spin() {
  if (isSpinning || items.length < 2) return;
  isSpinning = true;
  setResult("Spinning…");
  btnSpin.disabled = true;
  btnShuffle.disabled = true;
  btnReset.disabled = true;

  const start = performance.now();
  const duration = 2200 + Math.random() * 1200;
  const startAngle = angle;
  const extraSpins = 6 + Math.random() * 6;
  const target = startAngle + extraSpins * Math.PI * 2 + Math.random() * Math.PI * 2;

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    angle = startAngle + (target - startAngle) * easeOutCubic(t);
    drawWheel();

    if (t < 1) {
      spinRaf = requestAnimationFrame(frame);
    } else {
      isSpinning = false;
      const idx = pickIndexFromAngle();
      const winner = items[idx];

      setResult(winner);
      recordWin(winner);
      renderOddsAndResults();

      btnSpin.disabled = items.length < 2;
      btnShuffle.disabled = items.length < 2;
      btnReset.disabled = items.length === 0;
    }
  }

  spinRaf = requestAnimationFrame(frame);
}

// ---- presets ----
const PRESETS = {
  food: ["Pizza", "Tacos", "Sushi", "Burgers", "Ramen", "Salad"],
  movie: ["Comedy", "Action", "Horror", "Romcom", "Documentary", "Anime"],
  workout: ["Push", "Pull", "Legs", "Cardio", "Yoga", "Mobility"],
  study: ["Math", "Coding", "Reading", "Flashcards", "Practice test", "Notes cleanup"],
  chores: ["Dishes", "Laundry", "Vacuum", "Wipe surfaces", "Trash", "Organize desk"]
};

// ---- localStorage ----
function loadItems() {
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function persistItems() {
  localStorage.setItem(LS_ITEMS, JSON.stringify(items));
}

function loadStats() {
  try {
    const raw = localStorage.getItem(LS_STATS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function persistStats() {
  localStorage.setItem(LS_STATS, JSON.stringify(stats));
}

function loadLists() {
  try {
    return JSON.parse(localStorage.getItem(LS_LISTS) || "{}");
  } catch { return {}; }
}
function saveLists(lists) {
  localStorage.setItem(LS_LISTS, JSON.stringify(lists));
}
function refreshSavedListsDropdown() {
  const lists = loadLists();
  savedListsSel.innerHTML = `<option value="">Saved lists…</option>`;
  Object.keys(lists).sort().forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    savedListsSel.appendChild(opt);
  });
}

// ---- events ----
btnSpin.addEventListener("click", spin);

btnShuffle.addEventListener("click", () => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  persistItems();
  updateAll();
});

btnReset.addEventListener("click", () => {
  items = [];
  persistItems();
  setResult("—");
  updateAll();
});

btnResetStats.addEventListener("click", () => {
  const ok = confirm("Reset results tracking? This clears counts and total spins.");
  if (!ok) return;
  stats = { total: 0, counts: {} };
  persistStats();
  updateAll();
});

function addItem() {
  const v = input.value.trim();
  if (!v) return;
  items.push(v);
  input.value = "";
  persistItems();
  updateAll();
}
btnAdd.addEventListener("click", addItem);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addItem();
});

presetSel.addEventListener("change", () => {
  const key = presetSel.value;
  if (!key) return;
  items = [...PRESETS[key]];
  persistItems();
  setResult("—");
  updateAll();
  presetSel.value = "";
});

btnCopy.addEventListener("click", async () => {
  const txt = resultText.textContent;
  if (!txt || txt === "—") return;
  try {
    await navigator.clipboard.writeText(txt);
    btnCopy.textContent = "Copied!";
    setTimeout(() => (btnCopy.textContent = "Copy"), 900);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    btnCopy.textContent = "Copied!";
    setTimeout(() => (btnCopy.textContent = "Copy"), 900);
  }
});

btnSaveList.addEventListener("click", () => {
  if (!items.length) return;
  const name = prompt("Name this list (e.g., 'Lunch Ideas'):");
  if (!name) return;
  const lists = loadLists();
  lists[name] = items;
  saveLists(lists);
  refreshSavedListsDropdown();
});

btnLoadList.addEventListener("click", () => {
  const name = savedListsSel.value;
  if (!name) return;
  const lists = loadLists();
  const list = lists[name];
  if (!Array.isArray(list)) return;
  items = [...list];
  persistItems();
  setResult("—");
  updateAll();
});

btnDeleteList.addEventListener("click", () => {
  const name = savedListsSel.value;
  if (!name) return;
  const ok = confirm(`Delete saved list "${name}"?`);
  if (!ok) return;
  const lists = loadLists();
  delete lists[name];
  saveLists(lists);
  refreshSavedListsDropdown();
  savedListsSel.value = "";
});

// ---- theme ----
function applyTheme(theme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem(LS_THEME, theme);
}
btnTheme.addEventListener("click", () => {
  const current = localStorage.getItem(LS_THEME) || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});

// ---- init ----
(function init(){
  const theme = localStorage.getItem(LS_THEME) || "dark";
  applyTheme(theme);

  refreshSavedListsDropdown();
  updateAll();
  setResult("—");
})();
