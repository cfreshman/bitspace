export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampMagnitude(x, y, maxMagnitude) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return { x, y };
  }

  const scale = maxMagnitude / magnitude;
  return { x: x * scale, y: y * scale };
}

export function squaredDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function roundForSnapshot(value) {
  return Math.round(value * 100) / 100;
}

export function createSeededRandom(seed) {
  let state = 1779033703 ^ String(seed).length;

  for (let index = 0; index < String(seed).length; index += 1) {
    state = Math.imul(state ^ String(seed).charCodeAt(index), 3432918353);
    state = (state << 13) | (state >>> 19);
  }

  return function random() {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}
