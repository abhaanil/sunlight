// ---- CONFIG ----
const DEFAULT_LAT = 49.2827;     // Vancouver fallback
const DEFAULT_LON = -123.1207;

let LAT = DEFAULT_LAT;
let LON = DEFAULT_LON;

const RADIUS = 100;

// Fade behavior
const FADE_MINUTES = 15;
const FADE_MS = FADE_MINUTES * 60 * 1000;

// SVG refs
const sunSector = document.getElementById("sunSector");
const hourMarks = document.getElementById("hourMarks");
const currentLine = document.getElementById("currentLine");

// UI refs
const leftText = document.getElementById("leftText");
const countdownText = document.getElementById("countdownText");
const countdownLabel = document.getElementById("countdownLabel");
const nowText = document.getElementById("nowText"); // safe if missing
const locationText = document.getElementById("locationText");

// overlays
const nightImage = document.getElementById("nightImage");
const dayImage = document.getElementById("dayImage");

let sunriseToday = null;
let sunsetToday = null;
let sunriseTomorrow = null;

let ticker = null;

// ---- LOCATION ----
function setLocationLabel(text) {
    if (locationText) locationText.textContent = text;
}

function getUserLocation() {
    return new Promise((resolve) => {
        if (!("geolocation" in navigator)) {
            resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON, ok: false });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                resolve({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    ok: true,
                });
            },
            () => resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON, ok: false }),
            {
                enableHighAccuracy: false,
                timeout: 8000,
                maximumAge: 5 * 60 * 1000,
            }
        );
    });
}

// Reverse geocode: lat/lon -> "City, CC" using OpenStreetMap Nominatim
async function reverseGeocode(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
        const res = await fetch(url, {
            headers: { "Accept": "application/json" }
        });
        const data = await res.json();

        const addr = data.address || {};
        const city =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.hamlet ||
            addr.municipality ||
            addr.county ||
            addr.state ||
            "Unknown place";

        const cc = addr.country_code ? addr.country_code.toUpperCase() : "";
        return cc ? `${city}, ${cc}` : city;
    } catch {
        return "Your location";
    }
}

// ---- LOCAL DATE STRING (fixes UTC day flip) ----
function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// ---- DRAW STATIC 24H CLOCK ----
function drawHourMarks() {
    if (!hourMarks) return;

    hourMarks.innerHTML = "";
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

// ---- COLOR BLEND HELPERS ----
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

// ---- NIGHT FACTOR ----
function getNightFactor(now) {
    if (!sunriseToday || !sunsetToday || !sunriseTomorrow) return 0;

    const nextSunrise = now < sunriseToday ? sunriseToday : sunriseTomorrow;

    if (now >= sunsetToday) {
        const t = (now - sunsetToday) / FADE_MS;
        return t < 1 ? clamp01(t) : 1;
    }

    if (now < sunriseToday) {
        const fadeOutStart = new Date(nextSunrise.getTime() - FADE_MS);
        if (now >= fadeOutStart) {
            const t = (now - fadeOutStart) / FADE_MS;
            return 1 - clamp01(t);
        }
        return 1;
    }

    return 0;
}

function updateDayNightVisuals(now) {
    const nightFactor = getNightFactor(now);

    if (nightImage) nightImage.style.opacity = nightFactor.toFixed(3);
    if (dayImage) dayImage.style.opacity = (1 - nightFactor).toFixed(3);

    const root = document.documentElement;
    const styles = getComputedStyle(root);

    const dayStroke = styles.getPropertyValue("--svg-day").trim() || "#FF812C";
    const nightStroke = styles.getPropertyValue("--svg-night").trim() || "#769CFF";
    const daySector = styles.getPropertyValue("--sector-day").trim() || "#F8B848";
    const nightSector = styles.getPropertyValue("--sector-night").trim() || "#CECFD4";

    root.style.setProperty("--svg-active", blendHex(dayStroke, nightStroke, nightFactor));
    root.style.setProperty("--sector-active", blendHex(daySector, nightSector, nightFactor));
}

// ---- MAIN UPDATE LOOP ----
function updateClock() {
    if (!sunriseToday || !sunsetToday || !sunriseTomorrow) return;

    const now = new Date();

    updateDayNightVisuals(now);

    if (nowText) nowText.textContent = formatTime(now);

    const nowH = to24hFraction(now);
    const sunriseH = to24hFraction(sunriseToday);
    const sunsetH = to24hFraction(sunsetToday);

    if (currentLine) {
        const angleNow = (nowH / 24) * 2 * Math.PI - Math.PI / 2;
        currentLine.setAttribute("x2", RADIUS * Math.cos(angleNow));
        currentLine.setAttribute("y2", RADIUS * Math.sin(angleNow));
    }

    // Sector + % sunlight left
    if (now >= sunsetToday || now <= sunriseToday) {
        if (sunSector) sunSector.setAttribute("d", "");
        if (leftText) leftText.textContent = "0%";
    } else {
        const startH = Math.max(nowH, sunriseH);
        const endH = sunsetH;

        const totalMs = sunsetToday - sunriseToday;
        const leftMs = sunsetToday - now;
        const pctLeft = Math.max(0, Math.min(100, (leftMs / totalMs) * 100));

        if (leftText) leftText.textContent = `${pctLeft.toFixed(0)}%`;

        if (sunSector) {
            const d = makeSectorPath(
                (startH / 24) * 2 * Math.PI - Math.PI / 2,
                (endH / 24) * 2 * Math.PI - Math.PI / 2
            );
            sunSector.setAttribute("d", d);
        }
    }

    // Countdown
    let target;
    let label;

    if (now < sunriseToday) {
        target = sunriseToday;
        label = "Minutes to sunrise:";
    } else if (now >= sunriseToday && now < sunsetToday) {
        target = sunsetToday;
        label = "Minutes of sun left:";
    } else {
        target = sunriseTomorrow;
        label = "Minutes to sunrise:";
    }

    if (countdownLabel) countdownLabel.textContent = label;

    const diff = target - now;
    if (countdownText) {
        countdownText.textContent = diff > 0 ? formatHMS(Math.floor(diff / 1000)) : "00:00:00";
    }
}

// ---- LOAD SUN TIMES ----
async function loadSunTimes() {
    const today = new Date();
    const todayStr = localDateStr(today);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = localDateStr(tomorrow);

    async function getSunTimes(dateStr) {
        const url = `https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LON}&date=${dateStr}&formatted=0`;
        const res = await fetch(url);
        const json = await res.json();

        if (!json || json.status !== "OK" || !json.results) {
            throw new Error("Sun API error");
        }
        return json.results;
    }

    const todayTimes = await getSunTimes(todayStr);
    const tomorrowTimes = await getSunTimes(tomorrowStr);

    sunriseToday = new Date(todayTimes.sunrise);
    sunsetToday = new Date(todayTimes.sunset);
    sunriseTomorrow = new Date(tomorrowTimes.sunrise);

    updateClock();
}

// ---- INIT ----
(async function init() {
    try {
        setLocationLabel("Locating…");

        const loc = await getUserLocation();
        LAT = loc.lat;
        LON = loc.lon;

        // Show real place name
        const placeName = await reverseGeocode(LAT, LON);
        setLocationLabel(placeName);

        await loadSunTimes();

        if (ticker) clearInterval(ticker);
        ticker = setInterval(updateClock, 1000);
    } catch (e) {
        console.error(e);
        setLocationLabel("Location unavailable");
        if (countdownText) countdownText.textContent = "error";
        if (leftText) leftText.textContent = "—";
    }
})();
