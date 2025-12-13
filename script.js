// ---- CONFIG ----
const VANCOUVER_LAT = 49.2827;
const VANCOUVER_LON = -123.1207;
const RADIUS = 100;

// Fade behavior
const FADE_MINUTES = 15;
const FADE_MS = FADE_MINUTES * 60 * 1000;

const sunSector = document.getElementById("sunSector");
const hourMarks = document.getElementById("hourMarks");
const currentLine = document.getElementById("currentLine");

const leftText = document.getElementById("leftText");
const countdownText = document.getElementById("countdownText");
const countdownLabel = document.getElementById("countdownLabel");
const nowText = document.getElementById("nowText");

// overlays
const nightImage = document.getElementById("nightImage");

let sunriseToday = null;
let sunsetToday = null;
let sunriseTomorrow = null;

// ---- DRAW STATIC 24H CLOCK ----
function drawHourMarks() {
    for (let h = 0; h < 24; h++) {
        const angle = (h / 24) * 2 * Math.PI - Math.PI / 2;

        const inner = 12;
        const x1 = Math.cos(angle) * inner;
        const y1 = Math.sin(angle) * inner;
        const x2 = Math.cos(angle) * RADIUS;
        const y2 = Math.sin(angle) * RADIUS;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("class", "hour-line");
        hourMarks.appendChild(line);

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const labelRadius = RADIUS + 10;
        const lx = Math.cos(angle) * labelRadius;
        const ly = Math.sin(angle) * labelRadius;
        label.setAttribute("x", lx);
        label.setAttribute("y", ly);
        label.setAttribute("class", "hour-label");

        label.textContent = h === 0 ? 24 : h;
        hourMarks.appendChild(label);
    }
}

drawHourMarks();

// ---- HELPERS ----
function to24hFraction(date) {
    return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

function formatHMS(totalSeconds) {
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function formatTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}

function makeSectorPath(startAngle, endAngle) {
    const x1 = RADIUS * Math.cos(startAngle);
    const y1 = RADIUS * Math.sin(startAngle);
    const x2 = RADIUS * Math.cos(endAngle);
    const y2 = RADIUS * Math.sin(endAngle);

    let sweep = endAngle - startAngle;
    while (sweep < 0) sweep += 2 * Math.PI;
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;

    const largeArcFlag = sweep > Math.PI ? 1 : 0;

    return `
    M 0 0
    L ${x1} ${y1}
    A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${x2} ${y2}
    Z
  `;
}

function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

// Color interpolation helpers (hex -> rgb -> hex)
function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgb(hex) {
    const v = hex.replace("#", "").trim();
    return {
        r: parseInt(v.slice(0, 2), 16),
        g: parseInt(v.slice(2, 4), 16),
        b: parseInt(v.slice(4, 6), 16),
    };
}

function rgbToHex({ r, g, b }) {
    return `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
}

function blendHex(dayHex, nightHex, t) {
    const d = hexToRgb(dayHex);
    const n = hexToRgb(nightHex);
    return rgbToHex({
        r: lerp(d.r, n.r, t),
        g: lerp(d.g, n.g, t),
        b: lerp(d.b, n.b, t),
    });
}

/**
 * Returns a nightFactor in [0..1] with your rules:
 * - After sunset: 0 → 1 over 15 minutes
 * - Night: stays 1
 * - 15 minutes before sunrise: 1 → 0
 * - Daytime: 0
 */
function getNightFactor(now) {
    if (!sunriseToday || !sunsetToday || !sunriseTomorrow) return 0;

    const nextSunrise = now < sunriseToday ? sunriseToday : sunriseTomorrow;

    // After sunset → fade in
    if (now >= sunsetToday) {
        const t = (now - sunsetToday) / FADE_MS;
        return t < 1 ? clamp01(t) : 1;
    }

    // Before sunrise → fully night, except fade out right before sunrise
    if (now < sunriseToday) {
        const fadeOutStart = new Date(nextSunrise.getTime() - FADE_MS);
        if (now >= fadeOutStart) {
            const t = (now - fadeOutStart) / FADE_MS; // 0→1
            return 1 - clamp01(t);                    // 1→0
        }
        return 1;
    }

    // Daytime
    return 0;
}

function updateDayNightVisuals(now) {
    const nightFactor = getNightFactor(now);

    // Fade images together
    if (nightImage) {
        nightImage.style.opacity = nightFactor.toFixed(3);
    }

    const dayImage = document.getElementById("dayImage");
    if (dayImage) {
        dayImage.style.opacity = (1 - nightFactor).toFixed(3);
    }

    // Blend SVG colors (already implemented)
    const root = document.documentElement;
    const styles = getComputedStyle(root);

    const dayStroke = styles.getPropertyValue("--svg-day").trim();
    const nightStroke = styles.getPropertyValue("--svg-night").trim();
    const strokeBlend = blendHex(dayStroke, nightStroke, nightFactor);
    root.style.setProperty("--svg-active", strokeBlend);

    const daySector = styles.getPropertyValue("--sector-day").trim();
    const nightSector = styles.getPropertyValue("--sector-night").trim();
    const sectorBlend = blendHex(daySector, nightSector, nightFactor);
    root.style.setProperty("--sector-active", sectorBlend);
}


// ---- MAIN UPDATE LOOP ----
function updateClock() {
    if (!sunriseToday || !sunsetToday) return;

    const now = new Date();

    // NEW: sync illustration + SVG color transitions
    updateDayNightVisuals(now);

    // current time text
    if (nowText) {
        nowText.textContent = formatTime(now);
    }

    const nowH = to24hFraction(now);
    const sunriseH = to24hFraction(sunriseToday);
    const sunsetH = to24hFraction(sunsetToday);

    // Current time line on the clock
    const angleNow = (nowH / 24) * 2 * Math.PI - Math.PI / 2;
    currentLine.setAttribute("x2", RADIUS * Math.cos(angleNow));
    currentLine.setAttribute("y2", RADIUS * Math.sin(angleNow));

    // Daylight slice (remaining today)
    if (nowH >= sunsetH || nowH <= sunriseH) {
        sunSector.setAttribute("d", "");
        if (leftText) leftText.textContent = "0 h";
    } else {
        const startH = Math.max(nowH, sunriseH);
        const endH = sunsetH;
        const hoursLeft = endH - nowH;
        if (leftText) leftText.textContent = `${hoursLeft.toFixed(2)} h`;

        const d = makeSectorPath(
            (startH / 24) * 2 * Math.PI - Math.PI / 2,
            (endH / 24) * 2 * Math.PI - Math.PI / 2
        );
        sunSector.setAttribute("d", d);
    }

    // Countdown label + target
    let target;
    let label;

    if (now < sunriseToday) {
        target = sunriseToday;

    } else if (now >= sunriseToday && now < sunsetToday) {
        target = sunsetToday;

    } else {
        target = sunriseTomorrow;

    }

    if (countdownLabel) countdownLabel.textContent = label;

    const diff = target - now;
    if (countdownText) {
        countdownText.textContent =
            diff > 0 ? formatHMS(Math.floor(diff / 1000)) : "00:00:00";
    }
}

// ---- LOAD SUN TIMES ----
async function loadSunTimes() {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    async function getSunTimes(dateStr) {
        const url = `https://api.sunrise-sunset.org/json?lat=${VANCOUVER_LAT}&lng=${VANCOUVER_LON}&date=${dateStr}&formatted=0`;
        const res = await fetch(url);
        const json = await res.json();
        return json.results;
    }

    const todayTimes = await getSunTimes(todayStr);
    const tomorrowTimes = await getSunTimes(tomorrowStr);

    sunriseToday = new Date(todayTimes.sunrise);
    sunsetToday = new Date(todayTimes.sunset);
    sunriseTomorrow = new Date(tomorrowTimes.sunrise);

    updateClock();
}

loadSunTimes();
setInterval(updateClock, 1000);
