import { ENGINE, RENDER } from "./constants.js";
import {
  ASTEROID_TILE,
  blockingTilesNearCircle,
  createAsteroid,
  raycastAsteroid,
  serializeAsteroid
} from "./asteroid.js";
import { createEmptyInput, normalizeInput } from "./input.js";
import {
  clamp,
  clampMagnitude,
  roundForSnapshot
} from "./math.js";
import {
  aggregateUpgradeEffects,
  canAffordUpgrade,
  createUpgradeState,
  nextUpgradeCost,
  sanitizeUpgradeState,
  upgradeDefinitionById,
  upgradeLevel
} from "./upgrades.js";

const DEFAULT_ARENA_ID = "main";

export function createArena(options = {}) {
  const seed = options.seed ?? "bitspace-main";

  return {
    id: options.id ?? DEFAULT_ARENA_ID,
    seed,
    tick: 0,
    players: new Map(),
    asteroid: options.asteroid ?? createAsteroid({ seed: `${seed}:asteroid` }),
    asteroidMining: new Map(),
    asteroidUpdates: [],
    // Extension channels are intentionally empty until the game design is explicit.
    entities: new Map(),
    effects: []
  };
}

export function addPlayer(arena, playerOptions) {
  if (arena.players.size >= ENGINE.maxPlayers) {
    return { ok: false, reason: "arena_full" };
  }

  const number = nextPlayerNumber(arena);
  const spawn = spawnForPlayerNumber(number, arena.asteroid);
  const player = {
    id: playerOptions.id,
    number,
    name: sanitizePlayerName(playerOptions.name || `Pilot ${number}`),
    talk: "",
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: spawn.angle,
    aimAngle: spawn.angle,
    mining: false,
    miningRay: null,
    miningTargetIndex: null,
    miningPhase: null,
    miningProgress: 0,
    thrusting: false,
    shake: 0,
    radius: ENGINE.ship.radius,
    upgrades: createUpgradeState(),
    healthBars: ENGINE.player.startingHealthBars,
    health: playerMaxHealth(ENGINE.player.startingHealthBars),
    maxHealth: playerMaxHealth(ENGINE.player.startingHealthBars),
    lastDamageTick: Number.NEGATIVE_INFINITY,
    resources: {
      rock: 0,
      ore: 0,
      diamond: 0
    },
    alive: true,
    input: createEmptyInput(),
    lastInputSeq: 0,
    joinedAtTick: arena.tick
  };

  arena.players.set(player.id, player);
  return { ok: true, player };
}

export function removePlayer(arena, playerId) {
  return arena.players.delete(playerId);
}

export function setPlayerInput(arena, playerId, payload) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  const input = normalizeInput(payload);
  if (input.seq !== 0 && input.seq < player.lastInputSeq) {
    return false;
  }

  player.input = input;
  player.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
  return true;
}

export function setPlayerName(arena, playerId, name) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  player.name = sanitizePlayerName(name || player.name);
  return true;
}

export function setPlayerTalk(arena, playerId, text) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  const talk = sanitizeTalkText(text);
  if (!talk) {
    return false;
  }

  player.talk = talk;
  return true;
}

export function purchasePlayerUpgrade(arena, playerId, upgradeId) {
  const player = arena.players.get(playerId);
  if (!player || !player.alive) {
    return { ok: false, reason: "player_unavailable" };
  }

  const definition = upgradeDefinitionById(String(upgradeId || ""));
  if (!definition) {
    return { ok: false, reason: "unknown_upgrade" };
  }

  const currentLevel = upgradeLevel(player.upgrades, definition.id);
  if (currentLevel >= definition.maxLevel) {
    return { ok: false, reason: "upgrade_maxed" };
  }

  const cost = nextUpgradeCost(player.upgrades, definition.id);
  if (!canAffordUpgrade(player.resources, cost)) {
    return { ok: false, reason: "insufficient_resources" };
  }

  spendUpgradeCost(player, cost);
  player.upgrades[definition.id] = currentLevel + 1;
  syncPlayerDerivedStats(player);

  return {
    ok: true,
    upgradeId: definition.id,
    level: currentLevel + 1
  };
}

export function stepArena(arena, dtSeconds = 1 / ENGINE.tickRate) {
  arena.tick += 1;

  for (const player of arena.players.values()) {
    if (player.alive) {
      stepPlayer(arena, player, dtSeconds);
    }
  }

  resolvePlayerCollisions(arena);
  processMining(arena, dtSeconds);
}

export function snapshotArena(arena) {
  return {
    arenaId: arena.id,
    tick: arena.tick,
    serverTime: Date.now(),
    render: RENDER,
    world: ENGINE.world,
    players: Array.from(arena.players.values()).map(snapshotPlayer),
    asteroidMining: snapshotAsteroidMining(arena),
    entities: Array.from(arena.entities.values()),
    effects: arena.effects
  };
}

export function snapshotAsteroid(arena) {
  return serializeAsteroid(arena.asteroid);
}

function snapshotAsteroidMining(arena) {
  return Array.from(arena.asteroidMining.entries()).flatMap(([index, state]) => {
    const target = miningTargetForTile(arena.asteroid, index);
    if (!target || target.phase !== state.phase) {
      return [];
    }

    return {
      index,
      phase: state.phase,
      progress: roundForSnapshot(clamp(state.progress / target.seconds, 0, 1))
    };
  });
}

export function takeAsteroidUpdates(arena) {
  const updates = arena.asteroidUpdates;
  arena.asteroidUpdates = [];
  return updates;
}

export function lobbySnapshot(arena) {
  return Array.from(arena.players.values())
    .sort((a, b) => a.number - b.number)
    .map((player) => ({
      id: player.id,
      number: player.number,
      name: player.name,
      alive: player.alive
    }));
}

export function sanitizePlayerName(name) {
  return String(name)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18) || "Pilot";
}

export function sanitizeTalkText(text) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 36);
}

function stepPlayer(arena, player, dtSeconds) {
  player.shake = Math.max(0, player.shake - ENGINE.collision.shakeDecay * dtSeconds);
  syncPlayerDerivedStats(player);
  const effects = aggregateUpgradeEffects(player.upgrades);

  const move = clampMagnitude(player.input.moveX, player.input.moveY, 1);
  const isMoving = move.x !== 0 || move.y !== 0;
  player.thrusting = isMoving;

  if (isMoving) {
    player.angle = normalizeAngle(Math.atan2(move.y, move.x));
    player.vx += move.x * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
    player.vy += move.y * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
  }

  player.aimAngle = player.input.aimAngle;
  player.mining = player.input.mining;
  rechargePlayerHealth(arena, player, dtSeconds, effects);

  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const drag = Math.pow(ENGINE.ship.drag * effects.dragMultiplier, dtSeconds / fixedStepSeconds);
  player.vx *= drag;
  player.vy *= drag;

  const velocity = clampMagnitude(player.vx, player.vy, playerMaxSpeed(player, effects));
  player.vx = velocity.x;
  player.vy = velocity.y;

  player.x += player.vx * dtSeconds;
  player.y += player.vy * dtSeconds;

  resolveStaticCollisions(arena, player);
}

function resolveStaticCollisions(arena, player) {
  return arena.asteroid ? resolveAsteroidCollisions(arena.asteroid, player) : 0;
}

function resolveAsteroidCollisions(asteroid, player) {
  let impact = 0;

  for (let pass = 0; pass < 4; pass += 1) {
    let resolved = false;
    const blockers = blockingTilesNearCircle(asteroid, player.x, player.y, player.radius);

    for (const blocker of blockers) {
      const hit = circleTileOverlap(player, blocker);
      if (!hit) {
        continue;
      }

      player.x += hit.normalX * hit.overlap;
      player.y += hit.normalY * hit.overlap;

      const normalSpeed = player.vx * hit.normalX + player.vy * hit.normalY;
      impact = Math.max(impact, Math.abs(normalSpeed));
      if (normalSpeed < 0) {
        player.vx -= (1 + ENGINE.collision.boundaryRestitution) * normalSpeed * hit.normalX;
        player.vy -= (1 + ENGINE.collision.boundaryRestitution) * normalSpeed * hit.normalY;
      }

      resolved = true;
    }

    if (!resolved) {
      break;
    }
  }

  clampPlayerVelocity(player);
  return impact;
}

function processMining(arena, dtSeconds) {
  for (const player of arena.players.values()) {
    if (!player.alive) {
      continue;
    }

    processPlayerMining(arena, player, dtSeconds);
  }
}

function processPlayerMining(arena, player, dtSeconds) {
  if (!player.mining) {
    resetPlayerMiningTarget(player);
    player.miningRay = null;
    return;
  }

  const angle = player.aimAngle ?? player.angle;
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const effects = aggregateUpgradeEffects(player.upgrades);
  const rayLength = playerMiningRayLength(player, effects);
  const start = {
    x: player.x + direction.x * player.radius,
    y: player.y + direction.y * player.radius
  };
  const hit = raycastAsteroid(arena.asteroid, start.x, start.y, angle, rayLength);
  const playerHit = raycastPlayers(arena, player, start, angle, Math.min(hit.distance, rayLength));
  const hitResult = playerHit || hit;
  const end = {
    x: hitResult.x,
    y: hitResult.y
  };

  player.miningRay = {
    startX: roundForSnapshot(start.x),
    startY: roundForSnapshot(start.y),
    endX: roundForSnapshot(end.x),
    endY: roundForSnapshot(end.y),
    hit: hitResult.hit,
    hitType: playerHit ? "player" : hit.hit ? "asteroid" : null,
    mineable: !playerHit && hit.mineable,
    tileX: playerHit ? null : hit.tileX,
    tileY: playerHit ? null : hit.tileY,
    index: playerHit ? null : hit.index,
    tile: playerHit ? null : hit.tile,
    targetId: playerHit?.target.id ?? null,
    targetNumber: playerHit?.target.number ?? null,
    progress: 0
  };

  if (playerHit) {
    damagePlayer(
      playerHit.target,
      ENGINE.mining.playerDamagePerSecond * effects.rayDamageMultiplier * dtSeconds,
      arena.tick
    );
    resetPlayerMiningTarget(player);
    return;
  }

  if (!hit.mineable) {
    resetPlayerMiningTarget(player);
    return;
  }

  const target = miningTargetForTile(arena.asteroid, hit.index);
  if (!target) {
    resetPlayerMiningTarget(player);
    return;
  }

  if (player.miningTargetIndex !== hit.index || player.miningPhase !== target.phase) {
    player.miningTargetIndex = hit.index;
    player.miningPhase = target.phase;
  }

  const progress = addMiningProgress(
    arena,
    hit.index,
    target,
    dtSeconds * effects.miningPowerMultiplier
  );
  player.miningProgress = progress;
  player.miningRay.progress = roundForSnapshot(clamp(progress / target.seconds, 0, 1));

  if (progress < target.seconds) {
    return;
  }

  completeMiningTarget(arena, player, hit.index, target);
  clearMiningProgress(arena, hit.index);
  resetPlayerMiningTarget(player);
}

function miningTargetForTile(asteroid, index) {
  const tile = asteroid.tiles[index];
  const amount = asteroid.amounts[index] || 0;

  if (tile === ASTEROID_TILE.ore && amount > 0) {
    return {
      phase: `${ASTEROID_TILE.ore}:${amount}`,
      resource: "ore",
      seconds: ENGINE.mining.oreSeconds
    };
  }

  if (tile === ASTEROID_TILE.diamond && amount > 0) {
    return {
      phase: ASTEROID_TILE.diamond,
      resource: "diamond",
      seconds: ENGINE.mining.diamondSeconds
    };
  }

  if (tile === ASTEROID_TILE.rock || tile === ASTEROID_TILE.ore || tile === ASTEROID_TILE.diamond) {
    return {
      phase: ASTEROID_TILE.rock,
      resource: "rock",
      seconds: ENGINE.mining.rockSeconds
    };
  }

  return null;
}

function completeMiningTarget(arena, player, index, target) {
  if (target.resource === "ore") {
    const nextAmount = Math.max(0, arena.asteroid.amounts[index] - 1);
    addPlayerResource(player, "ore", 1);
    setAsteroidTile(arena, index, nextAmount > 0 ? ASTEROID_TILE.ore : ASTEROID_TILE.rock, nextAmount);
    return;
  }

  if (target.resource === "diamond") {
    addPlayerResource(player, "diamond", 1);
    setAsteroidTile(arena, index, ASTEROID_TILE.rock, 0);
    return;
  }

  addPlayerResource(player, "rock", 1);
  setAsteroidTile(arena, index, ASTEROID_TILE.empty, 0);
}

function addPlayerResource(player, resource, amount) {
  player.resources[resource] = clamp(
    (player.resources[resource] || 0) + amount,
    0,
    ENGINE.player.maxResourceAmount
  );
}

function spendUpgradeCost(player, cost) {
  for (const [resource, amount] of Object.entries(cost || {})) {
    player.resources[resource] = clamp((player.resources[resource] || 0) - amount, 0, ENGINE.player.maxResourceAmount);
  }
}

function setAsteroidTile(arena, index, tile, amount) {
  arena.asteroid.tiles[index] = tile;
  arena.asteroid.amounts[index] = amount;
  arena.asteroidUpdates.push({
    index,
    tile,
    amount
  });
}

function addMiningProgress(arena, index, target, dtSeconds) {
  const current = arena.asteroidMining.get(index);
  const progress = current?.phase === target.phase ? current.progress + dtSeconds : dtSeconds;
  arena.asteroidMining.set(index, {
    phase: target.phase,
    progress
  });
  return progress;
}

function clearMiningProgress(arena, index) {
  arena.asteroidMining.delete(index);
}

function resetPlayerMiningTarget(player) {
  player.miningTargetIndex = null;
  player.miningPhase = null;
  player.miningProgress = 0;
}

function raycastPlayers(arena, attacker, start, angle, maxDistance) {
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  let nearest = null;

  for (const target of arena.players.values()) {
    if (!target.alive || target.id === attacker.id) {
      continue;
    }

    const hit = rayCircleIntersection(start, direction, target, target.radius, maxDistance);
    if (!hit || (nearest && hit.distance >= nearest.distance)) {
      continue;
    }

    nearest = {
      hit: true,
      mineable: false,
      x: hit.x,
      y: hit.y,
      distance: hit.distance,
      target
    };
  }

  return nearest;
}

function rayCircleIntersection(start, direction, circle, radius, maxDistance) {
  const toCircleX = circle.x - start.x;
  const toCircleY = circle.y - start.y;
  const projection = toCircleX * direction.x + toCircleY * direction.y;
  const closestDistanceSq =
    toCircleX * toCircleX +
    toCircleY * toCircleY -
    projection * projection;
  const radiusSq = radius * radius;

  if (closestDistanceSq > radiusSq) {
    return null;
  }

  const halfChord = Math.sqrt(Math.max(0, radiusSq - closestDistanceSq));
  const distance = projection - halfChord;
  if (distance < 0 || distance > maxDistance) {
    return null;
  }

  return {
    distance,
    x: start.x + direction.x * distance,
    y: start.y + direction.y * distance
  };
}

function damagePlayer(player, amount, tick = 0) {
  const effects = aggregateUpgradeEffects(player.upgrades);
  const damage = Math.max(0, amount * effects.damageTakenMultiplier);

  player.lastDamageTick = tick;
  player.health = clamp(player.health - damage, 0, player.maxHealth);
  if (player.health > 0) {
    return;
  }

  player.alive = false;
  player.mining = false;
  player.miningRay = null;
  player.thrusting = false;
  player.vx = 0;
  player.vy = 0;
}

function playerMaxHealth(healthBars) {
  const bars = clamp(Math.round(healthBars), 1, ENGINE.player.maxHealthBars);
  return bars * ENGINE.player.healthPerBar;
}

function playerHealthBars(player) {
  const effects = aggregateUpgradeEffects(player.upgrades);
  return clamp(
    ENGINE.player.startingHealthBars + effects.healthBarsBonus,
    ENGINE.player.startingHealthBars,
    ENGINE.player.maxHealthBars
  );
}

function playerMaxSpeed(player, effects = aggregateUpgradeEffects(player.upgrades)) {
  return ENGINE.ship.maxSpeed * effects.maxSpeedMultiplier;
}

function playerMiningRayLength(player, effects = aggregateUpgradeEffects(player.upgrades)) {
  return ENGINE.mining.rayLength + effects.rayLengthBonus;
}

function syncPlayerDerivedStats(player) {
  const oldMaxHealth = player.maxHealth || playerMaxHealth(ENGINE.player.startingHealthBars);
  const healthBars = playerHealthBars(player);
  const maxHealth = playerMaxHealth(healthBars);

  player.healthBars = healthBars;
  player.maxHealth = maxHealth;
  if (maxHealth > oldMaxHealth) {
    player.health = clamp((player.health || 0) + (maxHealth - oldMaxHealth), 0, maxHealth);
  } else {
    player.health = clamp(player.health || 0, 0, maxHealth);
  }
}

function rechargePlayerHealth(arena, player, dtSeconds, effects) {
  const rechargePerSecond = effects.healthRechargePerSecond;
  if (rechargePerSecond <= 0 || player.health >= player.maxHealth || player.mining) {
    return;
  }

  const ticksSinceDamage = arena.tick - (player.lastDamageTick ?? Number.NEGATIVE_INFINITY);
  const secondsSinceDamage = ticksSinceDamage / ENGINE.tickRate;
  if (secondsSinceDamage < ENGINE.player.rechargeDelaySeconds) {
    return;
  }

  player.health = clamp(player.health + rechargePerSecond * dtSeconds, 0, player.maxHealth);
}

function circleTileOverlap(circle, tile) {
  const tileRight = tile.x + tile.size;
  const tileBottom = tile.y + tile.size;
  const closestX = clamp(circle.x, tile.x, tileRight);
  const closestY = clamp(circle.y, tile.y, tileBottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const distanceSq = dx * dx + dy * dy;

  if (distanceSq > 0) {
    if (distanceSq >= circle.radius * circle.radius) {
      return null;
    }

    const distance = Math.sqrt(distanceSq);
    return {
      normalX: dx / distance,
      normalY: dy / distance,
      overlap: circle.radius - distance
    };
  }

  const left = circle.x - tile.x;
  const right = tileRight - circle.x;
  const top = circle.y - tile.y;
  const bottom = tileBottom - circle.y;
  const nearest = Math.min(left, right, top, bottom);

  if (nearest === left) {
    return { normalX: -1, normalY: 0, overlap: circle.radius + left };
  }

  if (nearest === right) {
    return { normalX: 1, normalY: 0, overlap: circle.radius + right };
  }

  if (nearest === top) {
    return { normalX: 0, normalY: -1, overlap: circle.radius + top };
  }

  return { normalX: 0, normalY: 1, overlap: circle.radius + bottom };
}

function resolvePlayerCollisions(arena) {
  const players = Array.from(arena.players.values()).filter((player) => player.alive);

  for (let aIndex = 0; aIndex < players.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < players.length; bIndex += 1) {
      resolvePlayerPair(players[aIndex], players[bIndex], aIndex + bIndex);
    }
  }

  for (const player of players) {
    resolveStaticCollisions(arena, player);
  }
}

function resolvePlayerPair(a, b, fallbackSeed) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDistance = a.radius + b.radius;
  const distance = Math.hypot(dx, dy);

  if (distance >= minDistance) {
    return;
  }

  const fallbackAngle = fallbackSeed * Math.PI * 0.5;
  const nx = distance > 0 ? dx / distance : Math.cos(fallbackAngle);
  const ny = distance > 0 ? dy / distance : Math.sin(fallbackAngle);
  const overlap = minDistance - distance;
  const separation = overlap / 2;

  a.x -= nx * separation;
  a.y -= ny * separation;
  b.x += nx * separation;
  b.y += ny * separation;

  const relativeVx = b.vx - a.vx;
  const relativeVy = b.vy - a.vy;
  const relativeNormalSpeed = relativeVx * nx + relativeVy * ny;
  let impact = Math.abs(relativeNormalSpeed);

  if (relativeNormalSpeed < 0) {
    impact = Math.max(impact, ENGINE.collision.shipPush);
    const impulse = (-(1 + ENGINE.collision.shipRestitution) * relativeNormalSpeed) / 2;
    a.vx -= nx * impulse;
    a.vy -= ny * impulse;
    b.vx += nx * impulse;
    b.vy += ny * impulse;
  } else {
    impact = Math.max(impact, ENGINE.collision.shipPush);
    a.vx -= nx * ENGINE.collision.shipPush;
    a.vy -= ny * ENGINE.collision.shipPush;
    b.vx += nx * ENGINE.collision.shipPush;
    b.vy += ny * ENGINE.collision.shipPush;
  }

  clampPlayerVelocity(a);
  clampPlayerVelocity(b);
  addShake(a, impact);
  addShake(b, impact);
}

function clampPlayerVelocity(player) {
  const velocity = clampMagnitude(player.vx, player.vy, playerMaxSpeed(player));
  player.vx = velocity.x;
  player.vy = velocity.y;
}

function addShake(player, impact) {
  const amount = Math.max(0, impact - ENGINE.collision.shakeThreshold) * ENGINE.collision.shakeScale;
  player.shake = clamp(player.shake + amount, 0, ENGINE.collision.maxShake);
}

function nextPlayerNumber(arena) {
  const usedNumbers = new Set(
    Array.from(arena.players.values()).map((player) => player.number)
  );

  for (let number = 1; number <= ENGINE.maxPlayers; number += 1) {
    if (!usedNumbers.has(number)) {
      return number;
    }
  }

  return arena.players.size + 1;
}

function spawnForPlayerNumber(number, asteroid) {
  const pocket = asteroid?.pockets.find((candidate) => candidate.playerNumber === number);
  if (pocket) {
    const centerX = ENGINE.world.width / 2;
    const centerY = ENGINE.world.height / 2;
    return {
      x: pocket.spawnX,
      y: pocket.spawnY,
      angle: Math.atan2(centerY - pocket.spawnY, centerX - pocket.spawnX)
    };
  }

  const margin = Math.max(RENDER.width, ENGINE.world.sectorSize * 32);
  const maxX = ENGINE.world.width - margin;
  const maxY = ENGINE.world.height - margin;
  const spawns = [
    { x: margin, y: margin, angle: Math.PI / 4 },
    { x: maxX, y: margin, angle: (Math.PI * 3) / 4 },
    { x: maxX, y: maxY, angle: (-Math.PI * 3) / 4 },
    { x: margin, y: maxY, angle: -Math.PI / 4 }
  ];

  return spawns[(number - 1) % spawns.length];
}

function snapshotPlayer(player) {
  return {
    id: player.id,
    number: player.number,
    name: player.name,
    talk: player.talk,
    x: roundForSnapshot(player.x),
    y: roundForSnapshot(player.y),
    vx: roundForSnapshot(player.vx),
    vy: roundForSnapshot(player.vy),
    angle: roundForSnapshot(player.angle),
    aimAngle: roundForSnapshot(player.aimAngle),
    mining: player.mining,
    miningRay: player.miningRay,
    thrusting: player.thrusting,
    shake: roundForSnapshot(player.shake),
    radius: player.radius,
    upgrades: sanitizeUpgradeState(player.upgrades),
    healthBars: player.healthBars,
    health: roundForSnapshot(player.health),
    maxHealth: player.maxHealth,
    resources: {
      rock: player.resources.rock,
      ore: player.resources.ore,
      diamond: player.resources.diamond
    },
    alive: player.alive
  };
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}
