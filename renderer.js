const map = L.map("map", {
  zoomControl: true
}).setView([40.7128, -74.006], 12);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap"
}).addTo(map);

const overlay = document.getElementById("overlay");
const overlayCtx = overlay.getContext("2d");
const sprite = document.getElementById("sprite");

const spacingInput = document.getElementById("spacing");
const speedInput = document.getElementById("speed");
const drawSpiralInput = document.getElementById("drawSpiral");
const spriteSizeInput = document.getElementById("spriteSize");
const refreshWaterBtn = document.getElementById("refreshWater");
const waterStatus = document.getElementById("waterStatus");
const allowWaterInput = document.getElementById("allowWater");
const eventBubble = document.getElementById("eventBubble");
const eventSprite = document.getElementById("eventSprite");
const eventFrequencyInput = document.getElementById("eventFrequency");
const eventPicnicInput = document.getElementById("eventPicnic");
const eventChatInput = document.getElementById("eventChat");
const eventMonsterInput = document.getElementById("eventMonster");

let waterLayer = null;
let waterPolygons = [];
let t = 0;
let lastTimestamp = 0;
let pauseUntil = 0;
let eventUntil = 0;
let travelClock = 0;
let nextEventAt = 10;
let currentEvent = null;

const events = [
  {
    id: "picnic",
    label: "Picnic stop: unpacks a blanket and snacks.",
    durationMs: 3500
  },
  {
    id: "monster",
    label: "Monster encounter: cautious standoff.",
    durationMs: 3000
  },
  {
    id: "chat",
    label: "Chat break: catches up with a friend.",
    durationMs: 3000
  }
];

function resizeOverlay() {
  const { x, y } = map.getSize();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(x * dpr);
  overlay.height = Math.round(y * dpr);
  overlay.style.width = `${x}px`;
  overlay.style.height = `${y}px`;
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function setSpriteSize() {
  const size = Number(spriteSizeInput.value);
  sprite.style.width = `${size}px`;
  sprite.style.height = `${size}px`;
}

function spiralPoint(tValue) {
  const spacing = Number(spacingInput.value);
  const a = 0;
  const b = spacing / (2 * Math.PI);
  const r = a + b * tValue;
  return {
    x: r * Math.cos(tValue),
    y: r * Math.sin(tValue)
  };
}

function pointInWater(latlng) {
  if (!waterPolygons.length) return false;
  const point = turf.point([latlng.lng, latlng.lat]);
  for (const polygon of waterPolygons) {
    try {
      if (turf.booleanPointInPolygon(point, polygon)) return true;
    } catch (err) {
      // Skip invalid polygon
    }
  }
  return false;
}

function getEnabledEvents() {
  return events.filter((event) => {
    if (event.id === "picnic") return eventPicnicInput.checked;
    if (event.id === "chat") return eventChatInput.checked;
    if (event.id === "monster") return eventMonsterInput.checked;
    return false;
  });
}

function nextEventDelay() {
  const base = Number(eventFrequencyInput.value);
  return base * (0.7 + Math.random() * 0.6);
}

function findSafeLatLng(baseCenter, tValue) {
  const centerPoint = map.latLngToLayerPoint(baseCenter);
  let attempts = 0;
  let nextT = tValue;
  let needsScuba = false;

  const idealOffset = spiralPoint(nextT);
  const idealPoint = L.point(
    centerPoint.x + idealOffset.x,
    centerPoint.y + idealOffset.y
  );
  const idealLatLng = map.layerPointToLatLng(idealPoint);
  needsScuba = pointInWater(idealLatLng);

  if (allowWaterInput.checked) {
    return { latlng: idealLatLng, tValue: nextT, needsScuba };
  }

  while (attempts < 40) {
    const spiralOffset = spiralPoint(nextT);
    const candidatePoint = L.point(
      centerPoint.x + spiralOffset.x,
      centerPoint.y + spiralOffset.y
    );
    const latlng = map.layerPointToLatLng(candidatePoint);
    const inWater = pointInWater(latlng);
    if (!inWater) {
      return { latlng, tValue: nextT, needsScuba: false };
    }
    nextT += 0.25;
    attempts += 1;
  }

  // If we can't find a dry point, fall back to the ideal spiral point in water.
  return { latlng: idealLatLng, tValue, needsScuba: true };
}

function drawSpiral(baseCenter) {
  if (!drawSpiralInput.checked) {
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }

  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  overlayCtx.strokeStyle = "rgba(124, 197, 255, 0.9)";
  overlayCtx.lineWidth = 1.6;

  const centerPoint = map.latLngToLayerPoint(baseCenter);
  overlayCtx.beginPath();

  const maxRadius = Math.max(overlay.width, overlay.height);
  const step = 0.2;
  for (let i = 0; i < maxRadius * 2; i += step) {
    const p = spiralPoint(i);
    const x = centerPoint.x + p.x;
    const y = centerPoint.y + p.y;
    if (i === 0) overlayCtx.moveTo(x, y);
    else overlayCtx.lineTo(x, y);
  }

  overlayCtx.stroke();
}

async function fetchWater() {
  const bounds = map.getBounds();
  const bbox = [
    bounds.getSouth(),
    bounds.getWest(),
    bounds.getNorth(),
    bounds.getEast()
  ];

  waterStatus.textContent = "Fetching water polygons…";
  try {
    const query = `
      [out:json][timeout:25];
      (
        way["natural"="water"](${bbox.join(",")});
        relation["natural"="water"](${bbox.join(",")});
        way["waterway"="riverbank"](${bbox.join(",")});
        relation["waterway"="riverbank"](${bbox.join(",")});
        way["landuse"="reservoir"](${bbox.join(",")});
      );
      out body;
      >;
      out skel qt;
    `;

    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query
    });

    if (!response.ok) {
      throw new Error(`Overpass error: ${response.status}`);
    }

    const data = await response.json();
    const geojson = osmtogeojson(data);

    if (waterLayer) map.removeLayer(waterLayer);

    waterLayer = L.geoJSON(geojson, {
      style: {
        color: "#4cc9f0",
        weight: 1,
        fillColor: "#2f8ed1",
        fillOpacity: 0.45
      }
    }).addTo(map);

    waterPolygons = geojson.features
      .filter((feature) =>
        feature.geometry &&
        ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
      )
      .map((feature) => feature);

    waterStatus.textContent = `Loaded ${waterPolygons.length} water polygons.`;
  } catch (err) {
    waterStatus.textContent = "Could not load water data. Try again.";
  }
}

function animate(timestamp) {
  const isPaused = timestamp < pauseUntil;
  const delta = !isPaused ? (timestamp - lastTimestamp) / 1000 || 0 : 0;
  lastTimestamp = timestamp;

  const speed = Number(speedInput.value);
  t += delta * speed * 1.4;

  if (!isPaused) {
    travelClock += delta;
  }

  const baseCenter = map.getCenter();
  const { latlng, tValue, needsScuba } = findSafeLatLng(baseCenter, t);
  t = tValue;

  const point = map.latLngToContainerPoint(latlng);
  sprite.style.left = `${point.x}px`;
  sprite.style.top = `${point.y}px`;
  sprite.classList.toggle("scuba", needsScuba);

  const enabledEvents = getEnabledEvents();
  if (!enabledEvents.length) {
    currentEvent = null;
    eventBubble.classList.add("hidden");
    eventSprite.classList.add("hidden");
  }

  if (enabledEvents.length && timestamp >= eventUntil && travelClock >= nextEventAt) {
    const event = enabledEvents[Math.floor(Math.random() * enabledEvents.length)];
    currentEvent = event;
    eventUntil = timestamp + event.durationMs;
    pauseUntil = Math.max(pauseUntil, eventUntil);
    travelClock = 0;
    nextEventAt = nextEventDelay();
  }

  if (currentEvent) {
    eventBubble.textContent = currentEvent.label;
    eventBubble.classList.remove("hidden");
    eventSprite.classList.remove("hidden");
    eventSprite.classList.remove("picnic", "monster", "chat", "water");
    eventSprite.classList.add(currentEvent.id);
    if (currentEvent.id === "chat" && pointInWater(latlng)) {
      eventSprite.classList.add("water");
    }
    eventSprite.style.left = `${point.x + 70}px`;
    eventSprite.style.top = `${point.y - 10}px`;
    if (timestamp >= eventUntil) {
      currentEvent = null;
      eventBubble.classList.add("hidden");
      eventSprite.classList.add("hidden");
    }
  }

  drawSpiral(baseCenter);
  requestAnimationFrame(animate);
}

map.on("resize", resizeOverlay);
map.on("move", () => drawSpiral(map.getCenter()));
map.on("zoom", () => drawSpiral(map.getCenter()));
map.whenReady(() => {
  resizeOverlay();
  drawSpiral(map.getCenter());
});
window.addEventListener("resize", resizeOverlay);

refreshWaterBtn.addEventListener("click", fetchWater);
spacingInput.addEventListener("input", () => drawSpiral(map.getCenter()));

spriteSizeInput.addEventListener("input", setSpriteSize);

eventFrequencyInput.addEventListener("input", () => {
  nextEventAt = nextEventDelay();
});

eventPicnicInput.addEventListener("change", () => {
  currentEvent = null;
});

eventChatInput.addEventListener("change", () => {
  currentEvent = null;
});

eventMonsterInput.addEventListener("change", () => {
  currentEvent = null;
});

resizeOverlay();
setSpriteSize();
nextEventAt = nextEventDelay();
fetchWater();
requestAnimationFrame(animate);
