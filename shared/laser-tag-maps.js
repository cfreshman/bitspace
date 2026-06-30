export const LASER_TAG_MAP_COLORS = Object.freeze({
  open: "#000000",
  rock: "#ffffff",
  diamond: "#00ffff",
  redSpawn: "#ff0000",
  blueSpawn: "#0000ff",
  redGate: "#ff66aa",
  blueGate: "#66aaff"
});

export const LASER_TAG_MAP_CHARS = Object.freeze({
  open: " ",
  rock: "#",
  diamond: "D",
  redSpawn: "R",
  blueSpawn: "B",
  redGate: "r",
  blueGate: "b"
});

const COLOR_TO_CHAR = new Map(Object.entries(LASER_TAG_MAP_COLORS).map(([key, color]) => [
  color,
  LASER_TAG_MAP_CHARS[key]
]));
const LASER_TAG_MAP_COLOR_TOLERANCE = 12;
const LASER_TAG_MAP_PALETTE = Object.entries(LASER_TAG_MAP_COLORS).map(([key, color]) => ({
  char: LASER_TAG_MAP_CHARS[key],
  red: Number.parseInt(color.slice(1, 3), 16),
  green: Number.parseInt(color.slice(3, 5), 16),
  blue: Number.parseInt(color.slice(5, 7), 16)
}));
const LASER_TAG_MAPS = new Map();
const DEFAULT_LASER_TAG_MAP_ID = "map-01";

export function registerLaserTagMap(map) {
  const id = sanitizeLaserTagMapId(map?.id);
  const rows = sanitizeLaserTagMapRows(map?.rows);
  if (!id || rows.length === 0) {
    return false;
  }

  LASER_TAG_MAPS.set(id, Object.freeze({
    id,
    widthTiles: rows[0].length,
    heightTiles: rows.length,
    rows: Object.freeze(rows)
  }));
  return true;
}

export function getLaserTagMap(id = DEFAULT_LASER_TAG_MAP_ID) {
  const normalized = sanitizeLaserTagMapId(id);
  return LASER_TAG_MAPS.get(normalized) ||
    LASER_TAG_MAPS.get(DEFAULT_LASER_TAG_MAP_ID) ||
    LASER_TAG_MAPS.values().next().value ||
    null;
}

export function laserTagMapIds() {
  return Array.from(LASER_TAG_MAPS.keys()).sort();
}

export function laserTagMapIdFromFilename(filename) {
  const base = String(filename || "").trim().replace(/\.[^.]+$/, "");
  return sanitizeLaserTagMapId(base);
}

export function sanitizeLaserTagMapId(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,48}$/.test(text) ? text : null;
}

export function laserTagMapCharForRgb(r, g, b, alpha = 255) {
  if (alpha < 128) {
    return LASER_TAG_MAP_CHARS.open;
  }
  const red = hexChannel(r);
  const green = hexChannel(g);
  const blue = hexChannel(b);
  const color = `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
  return COLOR_TO_CHAR.get(color) ?? nearestLaserTagMapPaletteChar(red, green, blue);
}

function nearestLaserTagMapPaletteChar(red, green, blue) {
  let best = null;
  let bestDistanceSq = Infinity;
  for (const entry of LASER_TAG_MAP_PALETTE) {
    const dr = red - entry.red;
    const dg = green - entry.green;
    const db = blue - entry.blue;
    const maxDelta = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
    if (maxDelta > LASER_TAG_MAP_COLOR_TOLERANCE) {
      continue;
    }

    const distanceSq = dr * dr + dg * dg + db * db;
    if (distanceSq < bestDistanceSq) {
      best = entry.char;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

function sanitizeLaserTagMapRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const width = String(rows[0] || "").length;
  if (width <= 0) {
    return [];
  }

  const validChars = new Set(Object.values(LASER_TAG_MAP_CHARS));
  const result = [];
  for (const row of rows) {
    const text = String(row || "");
    if (text.length !== width) {
      return [];
    }
    for (const char of text) {
      if (!validChars.has(char)) {
        return [];
      }
    }
    result.push(text);
  }
  return result;
}

function hexByte(value) {
  return hexChannel(value)
    .toString(16)
    .padStart(2, "0");
}

function hexChannel(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}
