const STATION = "8722495"; // Jupiter Inlet, south jetty, FL
const CACHE_KEY = "tides-cache-v1";
const REFRESH_MS = 5 * 60 * 1000;

function pad(n) { return String(n).padStart(2, "0"); }

function fmtDate(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function apiUrl() {
  const today = new Date();
  const begin = new Date(today);
  begin.setDate(begin.getDate() - 1);
  const end = new Date(today);
  end.setDate(end.getDate() + 2);
  const params = new URLSearchParams({
    product: "predictions",
    application: "jupiter_tides_personal",
    begin_date: fmtDate(begin),
    end_date: fmtDate(end),
    datum: "MLLW",
    station: STATION,
    time_zone: "lst_ldt",
    units: "english",
    interval: "hilo",
    format: "json",
  });
  return `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params.toString()}`;
}

function parseLocal(t) {
  // "YYYY-MM-DD HH:MM" in station local time -> treat as local Date
  return new Date(t.replace(" ", "T"));
}

async function fetchPredictions() {
  const res = await fetch(apiUrl());
  if (!res.ok) throw new Error(`NOAA API HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "NOAA API error");
  const points = data.predictions.map((p) => ({
    time: parseLocal(p.t),
    value: parseFloat(p.v),
    type: p.type, // "H" or "L"
  }));
  localStorage.setItem(CACHE_KEY, JSON.stringify({ points: data.predictions, savedAt: Date.now() }));
  return points;
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      points: parsed.points.map((p) => ({ time: parseLocal(p.t), value: parseFloat(p.v), type: p.type })),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function findSurrounding(points, now) {
  let prev = null, next = null;
  for (let i = 0; i < points.length; i++) {
    if (points[i].time <= now) prev = points[i];
    if (points[i].time > now && !next) next = points[i];
  }
  return { prev, next };
}

function interpolateHeight(prev, next, now) {
  if (!prev || !next) return null;
  const total = next.time - prev.time;
  const elapsed = now - prev.time;
  const frac = Math.max(0, Math.min(1, elapsed / total));
  const mid = (prev.value + next.value) / 2;
  return mid + (prev.value - mid) * Math.cos(Math.PI * frac);
}

function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `in ${h}h ${pad(m)}m`;
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtUpdated(d) {
  return `Updated ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function render(points, savedAt) {
  const now = new Date();
  const { prev, next } = findSurrounding(points, now);
  const height = interpolateHeight(prev, next, now);

  const trendEl = document.getElementById("currentTrend");
  if (height !== null) {
    const rising = next.value > prev.value;
    trendEl.innerHTML = rising
      ? `<span class="arrow">&#9650;</span> Rising`
      : `<span class="arrow">&#9660;</span> Falling`;
  } else {
    trendEl.textContent = "";
  }

  const nextLabelEl = document.getElementById("nextLabel");
  const nextTypeEl = document.getElementById("nextType");
  const nextTimeEl = document.getElementById("nextTime");
  const countdownEl = document.getElementById("countdown");
  if (next) {
    nextLabelEl.textContent = "Next tide";
    nextTypeEl.textContent = next.type === "H" ? "High tide" : "Low tide";
    nextTimeEl.textContent = `${fmtTime(next.time)} • ${next.value.toFixed(2)} ft`;
    countdownEl.textContent = fmtCountdown(next.time - now);
  } else {
    nextTypeEl.textContent = "--";
    nextTimeEl.textContent = "";
    countdownEl.textContent = "";
  }

  document.getElementById("updated").textContent = fmtUpdated(new Date(savedAt || Date.now()));

  drawWave(points, now, height);
}

const HALF_SPAN_MS = 9 * 60 * 60 * 1000;

function drawWave(points, now, currentHeight) {
  const svg = document.getElementById("waveChart");
  const windowStart = new Date(now.getTime() - HALF_SPAN_MS);
  const windowEnd = new Date(now.getTime() + HALF_SPAN_MS);

  const relevant = points.filter((p) => p.time >= windowStart && p.time <= windowEnd);

  const x0 = windowStart.getTime();
  const x1 = windowEnd.getTime();
  const W = 400, PLOT_H = 118, AXIS_Y = 136, H = 168;

  const samples = [];
  const stepMs = 15 * 60 * 1000;
  for (let t = x0; t <= x1; t += stepMs) {
    const sampleTime = new Date(t);
    const { prev, next } = findSurrounding(points, sampleTime);
    const h = interpolateHeight(prev, next, sampleTime);
    if (h !== null) samples.push({ time: sampleTime, value: h });
  }
  if (!samples.length) { svg.innerHTML = ""; return; }

  const values = samples.map((s) => s.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const pad = (maxV - minV) * 0.15 || 1;
  const yMin = minV - pad, yMax = maxV + pad;

  const xScale = (t) => ((t - x0) / (x1 - x0)) * W;
  const yScale = (v) => PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  let path = "";
  samples.forEach((s, i) => {
    const x = xScale(s.time.getTime());
    const y = yScale(s.value);
    path += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
  });

  const areaPath = path + `L${W},${PLOT_H} L0,${PLOT_H} Z`;

  const nowX = xScale(now.getTime());
  const nowY = currentHeight !== null ? yScale(currentHeight) : null;

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  let svgContent = `
    <defs>
      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7ec8e3" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#7ec8e3" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#fill)" stroke="none"/>
    <path d="${path.trim()}" fill="none" stroke="#bfe3ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  `;

  // hour axis ticks, aligned to 3-hour clock boundaries
  const axisStart = new Date(windowStart);
  axisStart.setMinutes(0, 0, 0);
  axisStart.setHours(axisStart.getHours() - (axisStart.getHours() % 3));
  for (let t = new Date(axisStart); t.getTime() <= x1; t.setHours(t.getHours() + 3)) {
    const tt = t.getTime();
    if (tt < x0 || tt > x1) continue;
    const x = xScale(tt);
    const label = t.toLocaleTimeString([], { hour: "numeric" }).replace(" ", "").toLowerCase();
    svgContent += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${PLOT_H}" stroke="#ffffff" stroke-width="1" opacity="0.06"/>`;
    svgContent += `<text x="${x.toFixed(1)}" y="${AXIS_Y}" font-size="10" fill="#8fb9d4" text-anchor="middle">${label}</text>`;
  }

  relevant.forEach((p) => {
    if (p.time.getTime() < x0 || p.time.getTime() > x1) return;
    const x = xScale(p.time.getTime());
    const y = yScale(p.value);
    svgContent += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#ffffff" opacity="0.85"/>`;
    const isHigh = p.type === "H";
    const labelY = isHigh ? Math.max(y - 10, 10) : Math.min(y + 18, PLOT_H - 2);
    const timeLabel = p.time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const anchor = x < 25 ? "start" : x > W - 25 ? "end" : "middle";
    svgContent += `<text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="10" font-weight="600" fill="#eaf6ff" text-anchor="${anchor}">${timeLabel}</text>`;
  });

  if (nowY !== null) {
    svgContent += `<line x1="${nowX.toFixed(1)}" y1="0" x2="${nowX.toFixed(1)}" y2="${PLOT_H}" stroke="#ffb347" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.7"/>`;
    svgContent += `<circle cx="${nowX.toFixed(1)}" cy="${nowY.toFixed(1)}" r="5" fill="#ffb347"/>`;
  }

  svg.innerHTML = svgContent;
}

function showError(msg) {
  let el = document.querySelector(".error");
  if (!el) {
    el = document.createElement("div");
    el.className = "error";
    document.getElementById("app").appendChild(el);
  }
  el.textContent = msg;
}

function clearError() {
  const el = document.querySelector(".error");
  if (el) el.remove();
}

async function refreshCam() {
  try {
    const res = await fetch(`northeast-meta.json?q=${Date.now()}`);
    if (!res.ok) throw new Error(`meta HTTP ${res.status}`);
    const meta = await res.json();
    const img = document.getElementById("camImage");
    img.src = `northeast.jpg?v=${meta.fetchedAt}`;
    document.getElementById("camTime").textContent = `Captured ${meta.timedate}`;
  } catch (err) {
    document.getElementById("camTime").textContent = "Webcam unavailable";
  }
}

let currentPoints = null;

async function refresh() {
  try {
    const points = await fetchPredictions();
    currentPoints = points;
    clearError();
    render(points, Date.now());
  } catch (err) {
    const cached = loadCache();
    if (cached) {
      currentPoints = cached.points;
      render(cached.points, cached.savedAt);
      showError("Offline — showing last saved data");
    } else {
      showError("Unable to load tide data. Check your connection.");
    }
  }
}

function tick() {
  if (currentPoints) {
    const now = new Date();
    const { prev, next } = findSurrounding(currentPoints, now);
    const height = interpolateHeight(prev, next, now);
    document.getElementById("countdown").textContent = next ? fmtCountdown(next.time - now) : "";
    if (height !== null) {
      const trendEl = document.getElementById("currentTrend");
      const rising = next.value > prev.value;
      trendEl.innerHTML = rising
        ? `<span class="arrow">&#9650;</span> Rising`
        : `<span class="arrow">&#9660;</span> Falling`;
    }
    drawWave(currentPoints, now, height);
  }
}

refresh();
refreshCam();
setInterval(refresh, REFRESH_MS);
setInterval(refreshCam, REFRESH_MS);
setInterval(tick, 30 * 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
