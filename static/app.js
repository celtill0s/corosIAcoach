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

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
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
    setStatus(statusEl, "Connexion à COROS et récupération des données en cours (10-30s)...", "");

    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await resp.json();
      if (resp.ok && body.status === "ok") {
        setStatus(statusEl, `${body.activity_count} activités récupérées. Redirection...`, "ok");
        window.location.href = "/dashboard";
      } else {
        setStatus(statusEl, body.message || "Erreur inconnue.", "error");
        submitBtn.disabled = false;
      }
    } catch (err) {
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
    setStatus(statusEl, "Rechargement des données...", "");
    try {
      const resp = await fetch("/api/refresh", { method: "POST" });
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
    refreshBtn.disabled = false;
  });

  loadDashboard();
}

// ---- Coach ----
const coachBtn = document.getElementById("coach-digest-btn");
if (coachBtn) {
  const statusEl = document.getElementById("coach-status");
  const outputEl = document.getElementById("coach-output");
  const noteEl = document.getElementById("coach-note");

  coachBtn.addEventListener("click", async () => {
    coachBtn.disabled = true;
    outputEl.innerHTML = "";
    setStatus(statusEl, "Démarrage du modèle local et analyse en cours (peut prendre 30-90s)...", "");
    try {
      const resp = await fetch("/api/coach/weekly-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_note: noteEl.value.trim() }),
      });
      const body = await resp.json();
      if (resp.ok && body.status === "ok") {
        setStatus(statusEl, "Terminé.", "ok");
        outputEl.innerHTML = marked.parse(body.text);
      } else {
        setStatus(statusEl, body.message || "Erreur inconnue.", "error");
      }
    } catch (err) {
      setStatus(statusEl, "Erreur réseau: " + err, "error");
    }
    coachBtn.disabled = false;
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
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
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

  renderCards(data);
  renderLoadChart(data.daily);
  renderVo2Chart(data.daily);
  renderActivitiesTable(data.activities);

  renderZoneTables(data);
  renderRendementChart(data.daily);
  renderWeeklyActivityChart(data.activities);
  renderHrvDashboardWidget(analyse);
  renderRecordsTable(data.activities);
  renderPredictorTable(data.activities);

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
      datasets: [{
        label: "Rendement (%)",
        data: last7.map(d => d.training_load_ratio != null ? Math.round(d.training_load_ratio * 100) : null),
        backgroundColor: "#3fd6a8",
      }],
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
      datasets: [{ label: "Distance (km)", data: totals, backgroundColor: "#3fd6a8" }],
    },
  });
}

// ---- VFC nocturne (dashboard widget) ----
function renderHrvDashboardWidget(analyse) {
  const t7 = analyse?.t7dayList || [];
  if (!t7.length) {
    document.getElementById("hrv-dashboard-widget").innerHTML = "<p class='note'>Pas de données VFC disponibles.</p>";
    return;
  }
  const latest = t7[t7.length - 1];
  const interval = latest.sleepHrvIntervalList || [];
  const [normalMin, normalMax] = interval.length >= 4 ? [interval[2], interval[3]] : [null, null];
  const value = latest.avgSleepHrv;

  let badge = "";
  if (value != null && normalMin != null) {
    if (value < normalMin) badge = `<span class="hrv-badge low">Réduite</span>`;
    else if (value > normalMax) badge = `<span class="hrv-badge high">Élevée</span>`;
    else badge = `<span class="hrv-badge normal">Normale</span>`;
  }

  document.getElementById("hrv-dashboard-widget").innerHTML = `
    <div class="hrv-widget">
      <div><div class="value">${value ?? "—"} ms</div><div class="label">Moy. dernière nuit</div></div>
      ${normalMin != null ? `<div><div class="value">${normalMin}-${normalMax} ms</div><div class="label">Plage normale</div></div>` : ""}
      ${badge}
    </div>
  `;
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
    rows.push([`${label} — distance la plus longue`, `${(longest.distance / 1000).toFixed(2)} km`, longest.name, longest.date]);
    rows.push([`${label} — dénivelé max`, `${climb.ascent ?? 0} m`, climb.name, climb.date]);
  }

  document.querySelector("#records-table tbody").innerHTML = rows.map(([cat, rec, detail, date]) => `
    <tr><td>${cat}</td><td>${rec}</td><td>${detail}</td><td>${date}</td></tr>
  `).join("") || "<tr><td colspan='4'>Pas assez de données sur 4 semaines.</td></tr>";
}

// ---- Prédicteur de course (Riegel) ----
function renderPredictorTable(activities) {
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

function renderCards(data) {
  const dash = data.dashboard.summaryInfo || {};
  const lastDay = data.daily.length ? data.daily[data.daily.length - 1] : {};
  const cards = [
    { label: "Nb activités", value: data.activities.length },
    { label: "Niveau course à pied", value: dash.aerobicEnduranceScore ?? "—" },
    { label: "VO2max", value: lastDay.vo2max ?? "—" },
    { label: "FC repos", value: lastDay.test_rhr ?? "—" },
    { label: "Fatigue (dernier jour)", value: lastDay.tired_rate ?? "—" },
  ];
  const container = document.getElementById("summary-cards");
  container.innerHTML = cards.map(c => `
    <div class="card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
    </div>
  `).join("");
}

let loadChartInstance = null;
let vo2ChartInstance = null;

function renderLoadChart(daily) {
  const ctx = document.getElementById("load-chart");
  if (loadChartInstance) loadChartInstance.destroy();
  loadChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: daily.map(d => String(d.happen_day)),
      datasets: [{
        label: "Charge d'entraînement",
        data: daily.map(d => d.training_load),
        backgroundColor: "#3fd6a8",
      }],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 12 } } } },
  });
}

function renderVo2Chart(daily) {
  const ctx = document.getElementById("vo2-chart");
  if (vo2ChartInstance) vo2ChartInstance.destroy();
  vo2ChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: daily.map(d => String(d.happen_day)),
      datasets: [
        { label: "VO2max", data: daily.map(d => d.vo2max), borderColor: "#3fd6a8", yAxisID: "y" },
        { label: "FC repos", data: daily.map(d => d.test_rhr), borderColor: "#ff8080", yAxisID: "y1" },
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

function renderActivitiesTable(activities) {
  const tbody = document.querySelector("#activities-table tbody");
  tbody.innerHTML = activities.map(a => `
    <tr>
      <td>${a.date}</td>
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
      labels: t7.map(d => String(d.happenDay)),
      datasets: [{ label: "VFC nocturne (ms)", data: t7.map(d => d.avgSleepHrv || null), borderColor: "#3fd6a8", spanGaps: true }],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 8 } } } },
  });

  // -- Charge d'entraînement hebdomadaire (12 semaines) --
  const weeks = (tl.detailList || []).slice().sort((a, b) => a.firstDayOfWeek - b.firstDayOfWeek);
  if (weeklyLoadChartInstance) weeklyLoadChartInstance.destroy();
  weeklyLoadChartInstance = new Chart(document.getElementById("weekly-load-chart"), {
    type: "bar",
    data: {
      labels: weeks.map(w => String(w.firstDayOfWeek)),
      datasets: [
        { label: "Charge réalisée", data: weeks.map(w => w.value), backgroundColor: "#3fd6a8" },
        { label: "Charge cible", data: weeks.map(w => w.target), type: "line", borderColor: "#ff8080", fill: false },
      ],
    },
  });

  // -- Distribution d'intensité (par semaine) --
  const intWeeks = (analyse.tlIntensity?.detailList || []).slice().sort((a, b) => a.firstDayOfWeek - b.firstDayOfWeek);
  if (intensityChartInstance) intensityChartInstance.destroy();
  intensityChartInstance = new Chart(document.getElementById("intensity-chart"), {
    type: "bar",
    data: {
      labels: intWeeks.map(w => String(w.firstDayOfWeek)),
      datasets: [
        { label: "Intense", data: intWeeks.map(w => w.periodHighPct), backgroundColor: "#ff8080" },
        { label: "Modérée", data: intWeeks.map(w => w.periodMediumPct), backgroundColor: "#f5c26b" },
        { label: "Faible", data: intWeeks.map(w => w.periodLowPct), backgroundColor: "#3fd6a8" },
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
      datasets: [{ label: "Charge d'entraîn.", data: (analyse.summaryInfo?.tlAreaList || []).map(z => z.value), backgroundColor: "#3fd6a8" }],
    },
  });

  // -- Distribution des zones de distance (distanceCountAreaList, 6 zones) --
  if (distanceZoneChartInstance) distanceZoneChartInstance.destroy();
  distanceZoneChartInstance = new Chart(document.getElementById("distance-zone-chart"), {
    type: "bar",
    data: {
      labels: (analyse.summaryInfo?.distanceCountAreaList || []).map((_, i) => `Zone ${i + 1}`),
      datasets: [{ label: "Fréquence", data: (analyse.summaryInfo?.distanceCountAreaList || []).map(z => z.value), backgroundColor: "#3fd6a8" }],
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
      datasets: [{ label: "Charge d'entraîn.", data: (analyse.summaryInfo?.hrTlAreaList || []).map(z => z.value), backgroundColor: "#3fd6a8" }],
    },
  });
}
