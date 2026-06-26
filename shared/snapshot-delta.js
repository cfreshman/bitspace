export function diffArenaSnapshot(previous, next) {
  if (!previous || !next || previous.arenaId !== next.arenaId) {
    return null;
  }

  const delta = {
    delta: true,
    arenaId: next.arenaId,
    baseTick: previous.tick,
    tick: next.tick,
    serverTime: next.serverTime,
    entities: next.entities || []
  };

  const players = diffKeyedArray(previous.players, next.players, "id");
  const bugFootsteps = diffKeyedArray(previous.bugFootsteps, next.bugFootsteps, "id");
  const asteroidMining = diffKeyedArray(previous.asteroidMining, next.asteroidMining, "index");
  if (players) {
    delta.players = players;
  }
  if (bugFootsteps) {
    delta.bugFootsteps = bugFootsteps;
  }
  if (asteroidMining) {
    delta.asteroidMining = asteroidMining;
  }
  if (!sameJson(previous.effects, next.effects)) {
    delta.effects = next.effects;
  }

  return delta;
}

export function applyArenaSnapshotDelta(base, payload) {
  if (!payload?.delta) {
    return payload;
  }
  if (!base || base.arenaId !== payload.arenaId || base.tick !== payload.baseTick) {
    return null;
  }

  return {
    ...base,
    arenaId: payload.arenaId,
    tick: payload.tick,
    serverTime: payload.serverTime,
    players: applyKeyedArrayDelta(base.players, payload.players, "id"),
    bugFootsteps: applyKeyedArrayDelta(base.bugFootsteps, payload.bugFootsteps, "id"),
    asteroidMining: applyKeyedArrayDelta(base.asteroidMining, payload.asteroidMining, "index"),
    entities: Array.isArray(payload.entities) ? payload.entities : base.entities,
    effects: Object.prototype.hasOwnProperty.call(payload, "effects")
      ? payload.effects
      : base.effects
  };
}

function diffKeyedArray(previousArray = [], nextArray = [], keyField) {
  const previousByKey = new Map();
  for (const item of previousArray || []) {
    const key = item?.[keyField];
    if (key !== undefined && key !== null) {
      previousByKey.set(String(key), item);
    }
  }

  const upserts = [];
  const nextKeys = new Set();
  for (const item of nextArray || []) {
    const key = item?.[keyField];
    if (key === undefined || key === null) {
      continue;
    }

    const stringKey = String(key);
    nextKeys.add(stringKey);
    const previous = previousByKey.get(stringKey);
    if (!previous) {
      upserts.push({ key, value: item });
      continue;
    }

    const patch = diffObject(previous, item);
    if (Object.keys(patch).length > 0) {
      upserts.push({ key, patch });
    }
  }

  const removes = [];
  for (const key of previousByKey.keys()) {
    if (!nextKeys.has(key)) {
      removes.push(coerceKey(key));
    }
  }

  return upserts.length > 0 || removes.length > 0
    ? { upserts, removes }
    : null;
}

function applyKeyedArrayDelta(baseArray = [], delta, keyField) {
  if (!delta) {
    return baseArray || [];
  }

  const removed = new Set((delta.removes || []).map((key) => String(key)));
  const byKey = new Map();
  const order = [];

  for (const item of baseArray || []) {
    const key = item?.[keyField];
    if (key === undefined || key === null || removed.has(String(key))) {
      continue;
    }
    const stringKey = String(key);
    byKey.set(stringKey, item);
    order.push(stringKey);
  }

  for (const entry of delta.upserts || []) {
    const stringKey = String(entry.key);
    const previous = byKey.get(stringKey);
    const next = entry.value
      ? entry.value
      : {
          ...(previous || { [keyField]: entry.key }),
          ...(entry.patch || {})
        };
    if (!byKey.has(stringKey)) {
      order.push(stringKey);
    }
    byKey.set(stringKey, next);
  }

  return order
    .map((key) => byKey.get(key))
    .filter(Boolean);
}

function diffObject(previous, next) {
  const patch = {};
  for (const key of Object.keys(next || {})) {
    if (!sameJson(previous?.[key], next[key])) {
      patch[key] = next[key];
    }
  }
  return patch;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function coerceKey(key) {
  return /^-?\d+$/.test(key) ? Number(key) : key;
}
