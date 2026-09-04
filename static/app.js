// Mirrors the CSS custom properties in style.css — Chart.js needs real color
// values, it can't read CSS variables directly.
const COLOR_ACCENT = "#ff6a3d"; // warm — effort, charge, action
const COLOR_COOL = "#4fd6e8";   // cool — récupération, sommeil, VFC
const COLOR_GOOD = "#3ddc97";
const COLOR_WARN = "#ffb454";
const COLOR_BAD = "#ff5470";
const COLOR_MUTED = "#8b93a7";
const COLOR_GRID = "rgba(255, 255, 255, 0.06)";

if (typeof Chart !== "undefined") {
  Chart.defaults.font.family = "'Manrope', sans-serif";
  Chart.defaults.color = COLOR_MUTED;
  Chart.defaults.borderColor = COLOR_GRID;
}

const ICONS = {
  trendingUp: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,17 9,11 13,15 21,7"/><polyline points="15,7 21,7 21,13"/></svg>',
  target: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/></svg>',
  bolt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10"/></svg>',
  pulse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,12 7,12 9,6 13,18 15,12 22,12"/></svg>',
  battery: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2"/><line x1="22" y1="10" x2="22" y2="14"/></svg>',
  moon: '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/><circle cx="16.5" cy="8.5" r="7" fill="var(--panel)"/></svg>',
  wave: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12c2 -5 4 -5 6 0s4 5 6 0 4 -5 6 0"/></svg>',
};

const SPORT_LABELS = {
  100: "Course",
  102: "Trail",
  203: "Vélo",
  9904: "Muscu",
};

function sportLabel(type) {
  return SPORT_LABELS[type] || `Sport ${type}`;
}

const RUN_TYPES = [100, 101, 102, 103];
const BIKE_TYPES = [200, 203, 204];

const ZONE_NAMES = [
  "Récupération", "Aérobic (Endur.)", "Aérobic (Puiss.)",
  "Seuil", "Endurance anaérobie", "Anaérobie (Puiss.)",
];

function dateFromYmd(yyyymmdd) {
  const s = String(yyyymmdd);
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}

function dayOfWeekLabel(yyyymmdd) {
  const names = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  return names[dateFromYmd(yyyymmdd).getDay()];
}

function ymdString(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatChartDate(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${s.slice(6, 8)}/${s.slice(4, 6)}`;
}

function formatFullDate(yyyymmdd) {
  const s = String(yyyymmdd);
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
}

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

function showLoading(message) {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  document.getElementById("loading-message").textContent = message;
  overlay.hidden = false;
}

function hideLoading() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.hidden = true;
}

// ---- Login page ----
const loginForm = document.getElementById("login-form");
if (loginForm) {
  const statusEl = document.getElementById("status");
  const submitBtn = document.getElementById("submit-btn");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    submitBtn.disabled = true;
    showLoading("Connexion à COROS et récupération des données en cours (10-30s)...");

    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await resp.json();
      if (resp.ok && body.status === "ok") {
        if (body.mcp_connected) {
          // Already authorized via COROS MCP before — just go straight to the
          // dashboard, which triggers its own background MCP refresh.
          showLoading(`${body.activity_count} activités récupérées. Redirection...`);
          window.location.href = "/dashboard?mcp_connected=1";
          return;
        }
        // First time: chain straight into the MCP OAuth authorization so one
        // button click covers both data sources, as COROS's consent screen
        // needs a real page redirect (can't be done via background fetch).
        showLoading(`${body.activity_count} activités récupérées. Connexion à COROS (MCP) pour le sommeil/stress/prédictions...`);
        const mcpResp = await fetch("/api/mcp/login/start");
        const mcpBody = await mcpResp.json();
        if (mcpResp.ok && mcpBody.status === "ok") {
          window.location.href = mcpBody.auth_url;
        } else {
          // Scraping succeeded — only the MCP half failed, so still go to the
          // dashboard rather than stranding the user on the login page.
          hideLoading();
          setStatus(statusEl, `Données récupérées, mais connexion MCP impossible: ${mcpBody.message || "erreur inconnue"}. Tu peux réessayer depuis le dashboard.`, "error");
          window.location.href = "/dashboard";
        }
      } else {
        hideLoading();
        setStatus(statusEl, body.message || "Erreur inconnue.", "error");
        submitBtn.disabled = false;
      }
    } catch (err) {
      hideLoading();
      setStatus(statusEl, "Erreur réseau: " + err, "error");
      submitBtn.disabled = false;
    }
  });
}

// ---- Dashboard page ----
const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  const statusEl = document.getElementById("status");

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    showLoading("Rechargement des données...");
    try {
      const [resp] = await Promise.all([
        fetch("/api/refresh", { method: "POST" }),
        // Best-effort: silently no-ops with a 401 if the user never connected via MCP.
        fetch("/api/mcp/refresh", { method: "POST" }).catch(() => {}),
      ]);
      const body = await resp.json();
      if (resp.ok && body.status === "ok") {
        setStatus(statusEl, `${body.activity_count} activités à jour.`, "ok");
        await loadDashboard();
      } else {
        setStatus(statusEl, body.message || "Erreur inconnue.", "error");
      }
    } catch (err) {
      setStatus(statusEl, "Erreur réseau: " + err, "error");
    }
    hideLoading();
    refreshBtn.disabled = false;
  });

  loadDashboard();

  const urlParams = new URLSearchParams(window.location.search);
  const mcpError = urlParams.get("mcp_error");
  if (mcpError) {
    history.replaceState(null, "", window.location.pathname);
    setStatus(statusEl, `Données scrapées à jour, mais connexion MCP échouée: ${mcpError}`, "error");
  }

  // Just connected via COROS MCP (see redirect in app.py's /api/mcp/callback):
  // fetch the actual data now, in the background, rather than blocking the
  // OAuth redirect on it (COROS's MCP server can take 8s+ per call).
  if (urlParams.get("mcp_connected") === "1") {
    history.replaceState(null, "", window.location.pathname);
    setStatus(statusEl, "Connecté via COROS (MCP) — récupération du sommeil, stress, charge en cours...", "");
    fetch("/api/mcp/refresh", { method: "POST" })
      .then(resp => resp.json())
      .then(async body => {
        if (body.status === "ok") {
          setStatus(statusEl, "Données MCP à jour (sommeil, stress, charge, prédicteur).", "ok");
          await loadDashboard();
        } else {
          setStatus(statusEl, body.message || "Erreur lors de la récupération MCP.", "error");
        }
      })
      .catch(err => setStatus(statusEl, "Erreur réseau (MCP): " + err, "error"));
  }
}

// ---- Coach (persistent sidebar, chat-style — visible under any tab) ----
function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const coachForm = document.getElementById("coach-form");
if (coachForm) {
  const chatEl = document.getElementById("coach-chat");
  const statusEl = document.getElementById("coach-status");
  const noteEl = document.getElementById("coach-note");
  const submitBtn = document.getElementById("coach-digest-btn");

  function appendMessage(role, html, extraClass) {
    const div = document.createElement("div");
    div.className = `chat-msg ${role}${extraClass ? " " + extraClass : ""}`;
    div.innerHTML = html;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
    return div;
  }

  coachForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = noteEl.value.trim();
    submitBtn.disabled = true;

    appendMessage("user", note ? escapeHtml(note) : "<em>Point coaching (14 derniers jours)</em>");
    noteEl.value = "";
    const pending = appendMessage("assistant", "En train d'analyser (peut prendre 30-90s)…", "pending");

    try {
      const resp = await fetch("/api/coach/weekly-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_note: note }),
      });
      const body = await resp.json();
      pending.classList.remove("pending");
      if (resp.ok && body.status === "ok") {
        pending.innerHTML = marked.parse(body.text);
      } else {
        pending.classList.add("error");
        pending.textContent = body.message || "Erreur inconnue.";
      }
    } catch (err) {
      pending.classList.remove("pending");
      pending.classList.add("error");
      pending.textContent = "Erreur réseau: " + err;
    }
    chatEl.scrollTop = chatEl.scrollHeight;
    submitBtn.disabled = false;
  });
}

// ---- Tabs ----
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

function formatPace(secPerKm) {
  if (!secPerKm) return "—";
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}'${String(s).padStart(2, "0")}"`;
}

function parseDurationToSeconds(text) {
  if (!text) return null;
  const parts = text.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function loadDashboard() {
  const [dataResp, analyseResp] = await Promise.all([
    fetch("/api/data"),
    fetch("/api/analyse"),
  ]);
  const data = await dataResp.json();
  const analyse = await analyseResp.json();

  renderHeroStrip(data, analyse);
  renderLoadChart(data.daily);
  renderVo2Chart(data.daily);
  renderActivitiesTable(data.activities);

  renderZoneTables(data);
  renderRendementChart(data.daily);
  renderWeeklyActivityChart(data.activities);
  renderSleepTable(data);
  renderRecordsTable(data.activities);
  renderPredictorTable(data.activities, data.fitness_assessment);

  renderAnalyse(data, analyse);
}

// ---- Zone tables ----
function renderZoneTables(data) {
  const s = data.dashboard.summaryInfo || {};
  const lthrZone = s.lthrZone || [];
  const ltspZone = s.ltspZone || [];
  const lastRhr = data.daily.length ? data.daily[data.daily.length - 1].test_rhr : null;

  document.getElementById("hr-zone-header").innerHTML = `
    <div class="mini"><div class="label">Pt d'infl. lactate</div><div class="value">${s.lthr ?? "—"} bpm</div></div>
    <div class="mini"><div class="label">F.Card. Max</div><div class="value">${s.fitnessMaxHr ?? "—"} bpm</div></div>
    <div class="mini"><div class="label">FC au repos</div><div class="value">${lastRhr ?? "—"} bpm</div></div>
  `;
  if (lthrZone.length >= 5) {
    const b = lthrZone.map(z => z.hr);
    const rows = [
      [ZONE_NAMES[0], `< ${b[0]}`],
      [ZONE_NAMES[1], `${b[0]} - ${b[1]}`],
      [ZONE_NAMES[2], `${b[1] + 1} - ${b[2]}`],
      [ZONE_NAMES[3], `${b[2] + 1} - ${b[3]}`],
      [ZONE_NAMES[4], `${b[3] + 1} - ${b[4]}`],
      [ZONE_NAMES[5], `> ${b[4]}`],
    ];
    document.querySelector("#hr-zone-table tbody").innerHTML =
      rows.map(([name, range]) => `<tr><td>${name}</td><td>${range}</td></tr>`).join("");
  }

  document.getElementById("pace-zone-header").innerHTML = `
    <div class="mini"><div class="label">Allure au seuil</div><div class="value">${formatPace(s.ltsp)}</div></div>
  `;
  if (ltspZone.length >= 7) {
    // indices 0,1,2,4,5 are the zone boundaries; index 3 is the threshold pace itself, index 6 is a sprint reference
    const b = [0, 1, 2, 4, 5].map(i => ltspZone[i].pace);
    const rows = [
      [ZONE_NAMES[0], `> ${formatPace(b[0])}`],
      [ZONE_NAMES[1], `${formatPace(b[1])} - ${formatPace(b[0])}`],
      [ZONE_NAMES[2], `${formatPace(b[2])} - ${formatPace(b[1] - 1)}`],
      [ZONE_NAMES[3], `${formatPace(b[3])} - ${formatPace(b[2] - 1)}`],
      [ZONE_NAMES[4], `${formatPace(b[4])} - ${formatPace(b[3] - 1)}`],
      [ZONE_NAMES[5], `< ${formatPace(b[4])}`],
    ];
    document.querySelector("#pace-zone-table tbody").innerHTML =
      rows.map(([name, range]) => `<tr><td>${name}</td><td>${range}</td></tr>`).join("");
  }
}

// ---- Rendement 7 jours ----
let rendementChartInstance = null;

function renderRendementChart(daily) {
  const last7 = daily.slice(-7);
  if (rendementChartInstance) rendementChartInstance.destroy();
  rendementChartInstance = new Chart(document.getElementById("rendement-chart"), {
    type: "bar",
    data: {
      labels: last7.map((d, i) => i === last7.length - 1 ? "auj." : dayOfWeekLabel(d.happen_day)),
      datasets: [
        {
          label: "Rendement (%)",
          data: last7.map(d => d.training_load_ratio != null ? Math.round(d.training_load_ratio * 100) : null),
          backgroundColor: COLOR_ACCENT,
          borderRadius: 4,
          borderSkipped: false,
        },
        {
          label: "Cible", type: "line", data: last7.map(() => 100),
          borderColor: COLOR_COOL, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0,
        },
      ],
    },
  });
}

// ---- Activité hebdomadaire ----
let weeklyActivityChartInstance = null;

function renderWeeklyActivityChart(activities) {
  if (!activities.length) return;
  const latestDate = dateFromYmd(Math.max(...activities.map(a => a.date)));
  const dow = (latestDate.getDay() + 6) % 7; // Monday=0
  const monday = new Date(latestDate);
  monday.setDate(latestDate.getDate() - dow);

  const todayYmd = +ymdString(latestDate);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const ymd = +ymdString(d);
    days.push({ ymd, label: ymd === todayYmd ? "auj." : ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i] });
  }

  const totals = days.map(d => activities.filter(a => a.date === d.ymd).reduce((sum, a) => sum + (a.distance || 0), 0) / 1000);

  if (weeklyActivityChartInstance) weeklyActivityChartInstance.destroy();
  weeklyActivityChartInstance = new Chart(document.getElementById("weekly-activity-chart"), {
    type: "bar",
    data: {
      labels: days.map(d => d.label),
      datasets: [{ label: "Distance (km)", data: totals, backgroundColor: COLOR_COOL, borderRadius: 4, borderSkipped: false }],
    },
  });
}

// ---- Sommeil & stress (MCP) ----
function renderSleepTable(data) {
  const sleep = data.sleep || [];
  const noteEl = document.getElementById("sleep-note");
  const tableEl = document.getElementById("sleep-table");

  if (!sleep.length) {
    noteEl.hidden = false;
    tableEl.hidden = true;
    return;
  }
  noteEl.hidden = true;
  tableEl.hidden = false;

  const stressByDay = {};
  for (const h of data.daily_health || []) stressByDay[h.day] = h.stress_avg;

  const toPill = cls => cls ? cls.replace("value-", "pill-") : "pill-neutral";

  const phaseBar = (deep, light, rem) => {
    if (deep == null && light == null && rem == null) return "—";
    const d = Math.round((deep || 0) * 100), l = Math.round((light || 0) * 100), r = Math.round((rem || 0) * 100);
    const total = (d + l + r) || 1;
    return `
      <div class="sleep-phase-cell">
        <div class="sleep-phase-bar">
          <span style="width:${d / total * 100}%;background:var(--cool-dark)"></span>
          <span style="width:${l / total * 100}%;background:var(--cool)"></span>
          <span style="width:${r / total * 100}%;background:var(--accent)"></span>
        </div>
        <span class="sleep-phase-legend">Profond ${d}% · Léger ${l}% · REM ${r}%</span>
      </div>`;
  };

  const rows = sleep.slice(-7).reverse().map(s => {
    const h = Math.floor((s.main_sleep_minutes || 0) / 60);
    const m = (s.main_sleep_minutes || 0) % 60;
    const stress = stressByDay[s.wake_day];
    return `
      <tr>
        <td>${formatFullDate(s.wake_day)}</td>
        <td><span class="pill ${toPill(scoreClass(s.sleep_score))}">${s.sleep_score ?? "—"}</span></td>
        <td>${s.main_sleep_minutes ? `${h}h${String(m).padStart(2, "0")}` : "—"}</td>
        <td>${phaseBar(s.deep_ratio, s.light_ratio, s.rem_ratio)}</td>
        <td><span class="pill ${toPill(stressClass(stress))}">${stress ?? "—"}</span></td>
      </tr>`;
  }).join("");
  document.querySelector("#sleep-table tbody").innerHTML = rows;
}

// ---- Records personnels ----
function renderRecordsTable(activities) {
  if (!activities.length) return;
  const latestDate = Math.max(...activities.map(a => a.date));
  const cutoff = +ymdString(new Date(dateFromYmd(latestDate).getTime() - 28 * 86400000));
  const recent = activities.filter(a => a.date >= cutoff);

  const rows = [];
  for (const [label, types] of [["Course", RUN_TYPES], ["Vélo", BIKE_TYPES]]) {
    const items = recent.filter(a => types.includes(a.sport_type));
    if (!items.length) continue;
    const longest = items.reduce((a, b) => (b.distance || 0) > (a.distance || 0) ? b : a);
    const climb = items.reduce((a, b) => (b.ascent || 0) > (a.ascent || 0) ? b : a);
    rows.push([`${label} — distance la plus longue`, `${(longest.distance / 1000).toFixed(2)} km`, longest.name, formatFullDate(longest.date)]);
    rows.push([`${label} — dénivelé max`, `${climb.ascent ?? 0} m`, climb.name, formatFullDate(climb.date)]);
  }

  document.querySelector("#records-table tbody").innerHTML = rows.map(([cat, rec, detail, date]) => `
    <tr><td>${cat}</td><td>${rec}</td><td>${detail}</td><td>${date}</td></tr>
  `).join("") || "<tr><td colspan='4'>Pas assez de données sur 4 semaines.</td></tr>";
}

// ---- Prédicteur de course (COROS via MCP si connecté, sinon estimation Riegel) ----
function renderPredictorTable(activities, fitnessAssessment) {
  if (fitnessAssessment && (fitnessAssessment.pred_5k || fitnessAssessment.pred_10k)) {
    document.getElementById("predictor-source").textContent = "modèle officiel COROS (via MCP)";
    document.getElementById("predictor-note").textContent =
      `Fourni directement par COROS. VO2max: ${fitnessAssessment.vo2max ?? "—"} | `
      + `Allure au seuil: ${fitnessAssessment.threshold_pace ?? "—"}`;
    const rows = [
      ["5 km", fitnessAssessment.pred_5k, 5],
      ["10 km", fitnessAssessment.pred_10k, 10],
      ["Semi Marathon", fitnessAssessment.pred_half, 21.0975],
      ["Marathon", fitnessAssessment.pred_marathon, 42.195],
    ];
    document.querySelector("#predictor-table tbody").innerHTML = rows.map(([d, t, distKm]) => {
      const totalSec = parseDurationToSeconds(t);
      const pace = totalSec ? formatPace(totalSec / distKm) : "—";
      return `<tr><td>${d}</td><td>${t ?? "—"}</td><td>${pace}</td></tr>`;
    }).join("");
    return;
  }

  const candidates = activities.filter(a => RUN_TYPES.includes(a.sport_type) && a.distance >= 3000 && a.total_time > 0);
  if (!candidates.length) {
    document.querySelector("#predictor-table tbody").innerHTML = "<tr><td colspan='3'>Pas d'activité de référence trouvée.</td></tr>";
    return;
  }
  // Riegel comparison score: lower time/distance^1.06 = better relative performance
  const best = candidates.reduce((a, b) =>
    (b.total_time / Math.pow(b.distance, 1.06)) < (a.total_time / Math.pow(a.distance, 1.06)) ? b : a);

  const targets = [
    ["5 km", 5000],
    ["10 km", 10000],
    ["Semi Marathon", 21097.5],
    ["Marathon", 42195],
  ];
  const rows = targets.map(([label, dist]) => {
    const predictedSec = best.total_time * Math.pow(dist / best.distance, 1.06);
    const paceSecPerKm = predictedSec / (dist / 1000);
    return [label, formatDuration(Math.round(predictedSec)), formatPace(paceSecPerKm)];
  });

  document.querySelector("#predictor-table tbody").innerHTML = rows.map(([d, t, p]) => `
    <tr><td>${d}</td><td>${t}</td><td>${p}</td></tr>
  `).join("");
}

// COROS/Garmin-style stress convention: 0-25 rest, 26-50 low, 51-75 medium, 76-100 high.
function stressClass(v) {
  return v == null ? "" : v <= 50 ? "value-good" : v <= 75 ? "value-warn" : "value-bad";
}
function scoreClass(v) {
  return v == null ? "" : v >= 85 ? "value-good" : v >= 70 ? "value-warn" : "value-bad";
}

function clampPct(v, min, max) {
  if (v == null) return null;
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

// Simple 0→max fill bar, for scores that already have a natural scale (0-100 style).
function gaugeSimple(value, max, color) {
  const pct = clampPct(value, 0, max);
  if (pct == null) return "";
  return `<div class="gauge"><div class="gauge-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

// A bar spanning [min,max] with a highlighted "good/normal" band and a marker at
// the current value — for metrics where "where do I sit relative to a range"
// matters more than an absolute 0-100 score.
function gaugeBand(value, min, max, goodMin, goodMax, caption) {
  const markerPct = clampPct(value, min, max);
  if (markerPct == null) return "";
  const bandStart = clampPct(goodMin, min, max);
  const bandWidth = clampPct(goodMax, min, max) - bandStart;
  return `
    <div class="gauge">
      <div class="gauge-band" style="left:${bandStart}%;width:${bandWidth}%"></div>
      <div class="gauge-marker" style="left:${markerPct}%"></div>
    </div>
    ${caption ? `<div class="gauge-caption">${caption}</div>` : ""}
  `;
}

// COROS doesn't test VO2max/resting-HR every single day — the very last row in
// `daily` often has these as null. Look backwards for the last day that actually
// has a value instead of showing a blank just because today wasn't tested.
function lastNonNull(arr, field) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i][field] != null) return arr[i][field];
  }
  return null;
}

function renderHeroStrip(data, analyse) {
  const dash = data.dashboard.summaryInfo || {};
  const lastDay = data.daily.length ? data.daily[data.daily.length - 1] : {};
  const lastVo2max = lastNonNull(data.daily, "vo2max");
  const lastRhr = lastNonNull(data.daily, "test_rhr");
  const lastSleep = (data.sleep || []).length ? data.sleep[data.sleep.length - 1] : null;
  const lastHealth = (data.daily_health || []).length ? data.daily_health[data.daily_health.length - 1] : null;

  const t7 = analyse?.t7dayList || [];
  const lastHrv = t7.length ? t7[t7.length - 1] : null;
  const hrvInterval = lastHrv?.sleepHrvIntervalList || [];
  const [hrvMin, hrvMax] = hrvInterval.length >= 4 ? [hrvInterval[2], hrvInterval[3]] : [null, null];
  let hrvSub = "—";
  if (lastHrv?.avgSleepHrv != null && hrvMin != null) {
    hrvSub = lastHrv.avgSleepHrv < hrvMin ? "Réduite" : lastHrv.avgSleepHrv > hrvMax ? "Élevée" : "Normale";
  }

  const sleepDuration = lastSleep?.main_sleep_minutes
    ? `${Math.floor(lastSleep.main_sleep_minutes / 60)}h${String(lastSleep.main_sleep_minutes % 60).padStart(2, "0")}`
    : "—";

  const ratioPct = lastDay.training_load_ratio != null ? Math.round(lastDay.training_load_ratio * 100) : null;

  const tiles = [
    { label: "Nb activités", value: data.activities.length, icon: "trendingUp" },
    {
      label: "Niveau course à pied", value: dash.aerobicEnduranceScore ?? "—", icon: "target",
      gauge: gaugeSimple(dash.aerobicEnduranceScore, 100, "var(--accent)"),
    },
    {
      label: "VO2max", value: lastVo2max ?? "—", icon: "bolt",
      gauge: gaugeBand(lastVo2max, 25, 75, 45, 60, "repère générique — 45-60 = bon niveau"),
    },
    {
      label: "FC repos", value: lastRhr ?? "—", sub: "bpm", icon: "pulse",
      gauge: gaugeBand(lastRhr, 40, 100, 45, 65, "repère indicatif, sportif entraîné"),
    },
    { label: "Fatigue (dernier jour)", value: lastDay.tired_rate ?? "—", icon: "battery" },
    {
      label: "Rendement (aujourd'hui)", icon: "trendingUp",
      value: ratioPct != null ? `${ratioPct}%` : "—",
      gauge: gaugeBand(ratioPct, 50, 150, 80, 100, "cible ~100%"),
    },
    {
      label: "Sommeil (dernière nuit)", value: lastSleep?.sleep_score ?? "—", icon: "moon", cool: true,
      cls: scoreClass(lastSleep?.sleep_score), sub: sleepDuration,
      gauge: gaugeSimple(lastSleep?.sleep_score, 100, "var(--cool)"),
    },
    {
      label: "Stress (dernier jour)", value: lastHealth?.stress_avg ?? "—", icon: "wave", cool: true,
      cls: stressClass(lastHealth?.stress_avg),
      gauge: gaugeBand(lastHealth?.stress_avg, 0, 100, 0, 50, "bas = plus reposé"),
    },
    {
      label: "VFC nocturne", icon: "pulse", cool: true,
      value: lastHrv?.avgSleepHrv != null ? `${lastHrv.avgSleepHrv} ms` : "—", sub: hrvSub,
      gauge: hrvMin != null ? gaugeBand(lastHrv.avgSleepHrv, hrvMin - 20, hrvMax + 20, hrvMin, hrvMax, "plage normale (COROS)") : "",
    },
  ];

  document.getElementById("hero-cards").innerHTML = tiles.map(t => `
    <div class="hero-card ${t.cool ? "cool" : ""}">
      <div class="hero-icon">${ICONS[t.icon]}</div>
      <div class="label">${t.label}</div>
      <div class="value ${t.cls || ""}">${t.value}</div>
      ${t.sub ? `<div class="sub">${t.sub}</div>` : ""}
      ${t.gauge || ""}
    </div>
  `).join("");
}

let loadChartInstance = null;
let vo2ChartInstance = null;

// `daily` accumulates every day ever scraped (months/years of history), but these
// two charts are titled "90 derniers jours" — without slicing, hundreds of bars
// packed into one canvas visually merge into a solid mass that reads as a filled
// curve rather than distinct bars.
const CHART_WINDOW_DAYS = 90;

function renderLoadChart(daily) {
  const recent = daily.slice(-CHART_WINDOW_DAYS);
  const ctx = document.getElementById("load-chart");
  if (loadChartInstance) loadChartInstance.destroy();
  loadChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: recent.map(d => formatChartDate(d.happen_day)),
      datasets: [{
        label: "Charge d'entraînement",
        data: recent.map(d => d.training_load),
        backgroundColor: COLOR_ACCENT,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 12 } } } },
  });
}

function renderVo2Chart(daily) {
  const recent = daily.slice(-CHART_WINDOW_DAYS);
  const ctx = document.getElementById("vo2-chart");
  if (vo2ChartInstance) vo2ChartInstance.destroy();
  vo2ChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: recent.map(d => formatChartDate(d.happen_day)),
      datasets: [
        {
          label: "VO2max", data: recent.map(d => d.vo2max), borderColor: COLOR_COOL,
          backgroundColor: "rgba(79, 214, 232, 0.12)", fill: true, yAxisID: "y", spanGaps: true, tension: 0.3,
        },
        {
          label: "FC repos", data: recent.map(d => d.test_rhr), borderColor: COLOR_BAD,
          yAxisID: "y1", spanGaps: true, tension: 0.3,
        },
      ],
    },
    options: {
      scales: {
        x: { ticks: { maxTicksLimit: 12 } },
        y: { position: "left" },
        y1: { position: "right", grid: { drawOnChartArea: false } },
      },
    },
  });
}

const ACTIVITIES_PREVIEW_COUNT = 15;
let activitiesExpanded = false;

function renderActivityRows(activities) {
  return activities.map(a => `
    <tr>
      <td>${formatFullDate(a.date)}</td>
      <td>${a.name}</td>
      <td>${(a.distance / 1000).toFixed(2)}</td>
      <td>${(a.total_time / 60).toFixed(0)}</td>
      <td>${a.avg_hr ?? "—"}</td>
      <td>${a.ascent ?? "—"}</td>
      <td>${a.training_load ?? "—"}</td>
      <td>${a.device ?? "—"}</td>
    </tr>
  `).join("");
}

function renderActivitiesTable(activities) {
  const tbody = document.querySelector("#activities-table tbody");
  const toggleBtn = document.getElementById("activities-toggle-btn");

  const showAll = activitiesExpanded || activities.length <= ACTIVITIES_PREVIEW_COUNT;
  tbody.innerHTML = renderActivityRows(showAll ? activities : activities.slice(0, ACTIVITIES_PREVIEW_COUNT));

  if (activities.length <= ACTIVITIES_PREVIEW_COUNT) {
    toggleBtn.hidden = true;
    return;
  }
  toggleBtn.hidden = false;
  toggleBtn.textContent = activitiesExpanded
    ? "Réduire"
    : `Afficher les ${activities.length} activités`;
  toggleBtn.onclick = () => {
    activitiesExpanded = !activitiesExpanded;
    renderActivitiesTable(activities);
  };
}

// ---- Analyse tab ----
let weeklyLoadChartInstance = null;
let intensityChartInstance = null;
let paceZoneChartInstance = null;
let distanceZoneChartInstance = null;
let hrZoneChartInstance = null;
let hrvChartInstance = null;

function cards(containerId, items) {
  document.getElementById(containerId).innerHTML = items.map(c => `
    <div class="card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      ${c.sub ? `<div class="label">${c.sub}</div>` : ""}
    </div>
  `).join("");
}

function minicards(containerId, items) {
  document.getElementById(containerId).innerHTML = items.map(c => `
    <div class="mini">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
    </div>
  `).join("");
}

function renderAnalyse(data, analyse) {
  if (!analyse || !analyse.dayList) return;

  const dashSummary = data.dashboard.summaryInfo || {};
  const daily = data.daily; // ordered ascending by happen_day, 84 days

  // -- Récap de l'entraînement (4 semaines) --
  const total = (analyse.sportStatistic || []).find(s => s.sportType === 65535) || {};
  cards("recap-cards", [
    { label: "Distance totale", value: ((total.distance || 0) / 1000).toFixed(2), sub: "(km)" },
    { label: "Charge totale", value: total.trainingLoad ?? "—", sub: "(TL)" },
    { label: "Temps total", value: total.duration ? formatDuration(total.duration) : "—", sub: "(h:m:s)" },
    { label: "Nombre", value: total.count ?? "—", sub: "(activités en 4 semaines)" },
    { label: "FC moy", value: total.avgHeartRate ?? "—", sub: "(bpm)" },
  ]);

  // -- Données d'activité / Charge d'entraîn. (12 semaines) --
  const tl = (analyse.record || {}).tlRecord || {};
  cards("tl-completion-cards", [
    { label: "Charge totale", value: `${tl.totalValue ?? "—"} / ${tl.totalTarget ?? "—"}` },
    { label: "Ratio d'achèvement", value: tl.percentage != null ? `${tl.percentage}%` : "—" },
  ]);

  // -- VO2 Max (12 semaines) --
  const vo2Values = daily.map(d => d.vo2max).filter(v => v);
  minicards("vo2max-minicards", [
    { label: "Max", value: vo2Values.length ? Math.max(...vo2Values) : "—" },
    { label: "Moyenne", value: vo2Values.length ? Math.round(vo2Values.reduce((a, b) => a + b, 0) / vo2Values.length) : "—" },
  ]);

  // -- FC au repos (12 semaines) --
  const rhrValues = daily.map(d => d.test_rhr).filter(v => v);
  minicards("rhr-minicards", [
    { label: "Plus bas", value: rhrValues.length ? Math.min(...rhrValues) : "—" },
    { label: "Moyenne", value: rhrValues.length ? Math.round(rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length) : "—" },
  ]);

  // -- FC et allure au seuil (12 semaines) --
  minicards("threshold-minicards", [
    { label: "FC au seuil Max", value: dashSummary.lthr ?? "—" },
    { label: "Allure au seuil Max", value: formatPace(dashSummary.ltsp) },
  ]);

  // -- VFC nocturne (4 semaines) --
  const t7 = analyse.t7dayList || [];
  const hrvValues = t7.map(d => d.avgSleepHrv).filter(v => v);
  const hrvAvg = hrvValues.length ? Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length) : null;
  minicards("hrv-minicards", [{ label: "Moyenne", value: hrvAvg != null ? `${hrvAvg}ms` : "—" }]);

  if (hrvChartInstance) hrvChartInstance.destroy();
  hrvChartInstance = new Chart(document.getElementById("hrv-chart"), {
    type: "line",
    data: {
      labels: t7.map(d => formatChartDate(d.happenDay)),
      datasets: [{
        label: "VFC nocturne (ms)", data: t7.map(d => d.avgSleepHrv || null), borderColor: COLOR_COOL,
        backgroundColor: "rgba(79, 214, 232, 0.12)", fill: true, tension: 0.3, spanGaps: true,
      }],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 8 } } } },
  });

  // -- Charge d'entraînement hebdomadaire (12 semaines) --
  const weeks = (tl.detailList || []).slice().sort((a, b) => a.firstDayOfWeek - b.firstDayOfWeek);
  if (weeklyLoadChartInstance) weeklyLoadChartInstance.destroy();
  weeklyLoadChartInstance = new Chart(document.getElementById("weekly-load-chart"), {
    type: "bar",
    data: {
      labels: weeks.map(w => formatChartDate(w.firstDayOfWeek)),
      datasets: [
        { label: "Charge réalisée", data: weeks.map(w => w.value), backgroundColor: COLOR_ACCENT, borderRadius: 4, borderSkipped: false },
        { label: "Charge cible", data: weeks.map(w => w.target), type: "line", borderColor: COLOR_COOL, fill: false },
      ],
    },
  });

  // -- Distribution d'intensité (par semaine) --
  const intWeeks = (analyse.tlIntensity?.detailList || []).slice().sort((a, b) => a.firstDayOfWeek - b.firstDayOfWeek);
  if (intensityChartInstance) intensityChartInstance.destroy();
  intensityChartInstance = new Chart(document.getElementById("intensity-chart"), {
    type: "bar",
    data: {
      labels: intWeeks.map(w => formatChartDate(w.firstDayOfWeek)),
      datasets: [
        { label: "Intense", data: intWeeks.map(w => w.periodHighPct), backgroundColor: COLOR_BAD },
        { label: "Modérée", data: intWeeks.map(w => w.periodMediumPct), backgroundColor: COLOR_WARN },
        { label: "Faible", data: intWeeks.map(w => w.periodLowPct), backgroundColor: COLOR_GOOD },
      ],
    },
    options: { scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 } }, y: { stacked: true } } },
  });

  // -- Répartition par zone d'allure (tlAreaList, 7 zones) --
  const ltspZone = dashSummary.ltspZone || [];
  const paceZoneLabels = (analyse.summaryInfo?.tlAreaList || []).map((_, i) =>
    ltspZone[i] ? formatPace(ltspZone[i].pace) : `Z${i + 1}`);
  if (paceZoneChartInstance) paceZoneChartInstance.destroy();
  paceZoneChartInstance = new Chart(document.getElementById("pace-zone-chart"), {
    type: "bar",
    data: {
      labels: paceZoneLabels,
      datasets: [{ label: "Charge d'entraîn.", data: (analyse.summaryInfo?.tlAreaList || []).map(z => z.value), backgroundColor: COLOR_ACCENT, borderRadius: 4, borderSkipped: false }],
    },
  });

  // -- Distribution des zones de distance (distanceCountAreaList, 6 zones) --
  if (distanceZoneChartInstance) distanceZoneChartInstance.destroy();
  distanceZoneChartInstance = new Chart(document.getElementById("distance-zone-chart"), {
    type: "bar",
    data: {
      labels: (analyse.summaryInfo?.distanceCountAreaList || []).map((_, i) => `Zone ${i + 1}`),
      datasets: [{ label: "Fréquence", data: (analyse.summaryInfo?.distanceCountAreaList || []).map(z => z.value), backgroundColor: COLOR_COOL, borderRadius: 4, borderSkipped: false }],
    },
  });

  // -- Distribution zones de FC seuil (hrTlAreaList, 6 zones) --
  const lthrZone = dashSummary.lthrZone || [];
  const hrZoneLabels = (analyse.summaryInfo?.hrTlAreaList || []).map((_, i) =>
    lthrZone[i] ? `${lthrZone[i].hr} bpm` : `Z${i + 1}`);
  if (hrZoneChartInstance) hrZoneChartInstance.destroy();
  hrZoneChartInstance = new Chart(document.getElementById("hr-zone-chart"), {
    type: "bar",
    data: {
      labels: hrZoneLabels,
      datasets: [{ label: "Charge d'entraîn.", data: (analyse.summaryInfo?.hrTlAreaList || []).map(z => z.value), backgroundColor: COLOR_ACCENT, borderRadius: 4, borderSkipped: false }],
    },
  });
}
