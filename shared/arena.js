import { ENGINE, GAME_MODES, RENDER, isSubThemedGameMode, laserTagBeamDurationSeconds, laserTagBlastMaxRange, mapTileSizeForGameMode, miningRayLengthForGameMode, miningSecondsForGameMode, playerMassScaleForGameMode, playerRadiusForGameMode, shipFrictionForGameMode, shipThrustForGameMode } from "./constants.js";
import { buildClosestTileRing, buildTileVisibleFromOrigin, closestBuildTileByCenterAngle } from "./build.js";
import {
  ASTEROID_TILE,
  blockingTilesAlongSegment,
  STORM_STATE,
  blockingTilesNearCircle,
  circleBlockerOverlap,
  createAsteroid,
  createLaserTagAsteroid,
  isAsteroidRockTile,
  raycastAsteroid,
  serializeAsteroid,
  sweptCircleBlockerHit
} from "./asteroid.js";
import { createEmptyInput, normalizeInput, numberFromInput } from "./input.js";
import { simulateCarMovement } from "./car-physics.js";
import { simulateCloudMovement } from "./cloud-physics.js";
import {
  clampBugLegStateToCore,
  ensureBugLegState,
  serializeBugLegsForSnapshot,
  simulateBugMovement as simulateBugMovementCore
} from "./bug-physics.js";
import {
  clamp,
  clampMagnitude,
  createSeededRandom,
  inheritedVelocityLaunchAngle,
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
import {
  miningRayClippedSideStartDistance,
  miningRayCountForPlayer,
  miningRayLaneWithStart,
  miningRaySideStartProbe,
  miningSideRayOffsetForPlayer,
  miningRayLanesForPlayer
} from "./mining.js";
import {
  laserTagMapIds
} from "./laser-tag-maps.js";

const DEFAULT_ARENA_ID = "main";
const INITIAL_SPAWN_ANGLE = Math.PI / 4;
const KILL_DROP_SINGLE_DIAMOND_CHANCE = 2 / 3;
const KILL_DROP_NOTICE_TICKS = ENGINE.tickRate * 3;
const LAST_HIT_NOTICE_TICKS = ENGINE.tickRate * 5;
const RANDOM_DIAMOND_SPAWN_TICKS = ENGINE.tickRate * 15;
const LASER_TAG_GHOST_RETURN_SECONDS = 5;
const LASER_TAG_TEAMS = Object.freeze(["red", "blue"]);
const LASER_TAG_DEFAULT_MAP_ID = "map-01";
const LASER_TAG_SMALL_MAP_ID = "map-2p-01";
const LASER_TAG_SMALL_MAP_MAX_PLAYERS = 4;
const LASER_TAG_DUEL_PLAYER_COUNT = 2;
const LASER_TAG_DUEL_SCORE_LIMIT = 250;
const LASER_TAG_DUEL_MATCH_SECONDS = 5 * 60;
const LASER_TAG_GATE_DIAMOND_SPIN_IMPULSE = 8.5;
const LASER_TAG_GATE_DIAMOND_SPIN_DAMPING = 2.2;
const LASER_TAG_GATE_DIAMOND_SPIN_MAX = 42;
const LASER_TAG_GATE_ATTACK_MEMORY_TICKS = ENGINE.tickRate * 8;
const TAU = Math.PI * 2;
const CAR_GROUND_VARIANTS = Object.freeze({
  desert: "desert",
  grass: "grass"
});

export function createArena(options = {}) {
  const seed = options.seed ?? "bitspace-main";
  const mode = normalizeGameMode(options.mode);
  const params = createArenaParams(mode, seed, options.params, options.playerCount);
  const laserTag = mode === GAME_MODES.laserTag;
  const asteroid = options.asteroid ?? (laserTag
    ? createLaserTagAsteroid({
        seed: `${seed}:laser-tag`,
        playerCount: options.playerCount,
        tileSize: mapTileSizeForGameMode(mode),
        variant: params.laserTagMap
      })
    : createAsteroid({
        seed: `${seed}:asteroid`,
        playerCount: options.playerCount,
        tileSize: mapTileSizeForGameMode(mode)
      }));
  const playerDamage = options.playerDamage ?? true;
  const asteroidMining = options.asteroidMining ?? !laserTag;
  const stormEnabled = options.storm ?? (playerDamage && !laserTag);

  const arena = {
    id: options.id ?? DEFAULT_ARENA_ID,
    mode,
    params,
    seed,
    tick: 0,
    players: new Map(),
    asteroid,
    asteroidMining: new Map(),
    asteroidUpdates: [],
    storm: stormEnabled ? createStormState(asteroid, seed) : null,
    stormUpdates: [],
    rules: {
      playerDamage,
      asteroidMining
    },
    bugFootsteps: new Map(),
    // Extension channels are intentionally empty until the game design is explicit.
    entities: new Map(),
    huckRockButtonHits: [],
    effects: []
  };

  if (laserTag) {
    initializeLaserTagArena(arena);
  }

  return arena;
}

export function addPlayer(arena, playerOptions) {
  if (arena.players.size >= ENGINE.maxPlayers) {
    return { ok: false, reason: "arena_full" };
  }

  const number = nextPlayerNumber(arena);
  const spawnNumber = playerOptions.spawnNumber ?? number;
  const laserTag = normalizeGameMode(arena.mode) === GAME_MODES.laserTag;
  const team = laserTagTeamForPlayerNumber(number);
  const spawn = laserTag
    ? laserTagSpawnForPlayer(arena, team, number)
    : spawnForPlayerNumber(spawnNumber, arena.asteroid);
  const startingResources = playerOptions.resources || {};
  const gameMode = normalizeGameMode(arena.mode);
  const healthBars = laserTag ? ENGINE.laserTag.health : ENGINE.player.startingHealthBars;
  const maxHealth = laserTag ? ENGINE.laserTag.health : playerMaxHealth(healthBars, gameMode);
  const player = {
    id: playerOptions.id,
    number,
    spawnNumber,
    name: sanitizePlayerName(playerOptions.name || `Pilot ${number}`),
    gameMode,
    talk: "",
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: spawn.angle,
    carHeading: spawn.angle,
    carSteerAngle: 0,
    subReverseActive: false,
    subReverseConeAngle: spawn.angle + Math.PI,
    cloudPitchX: 0,
    cloudPitchY: 0,
    bugLegCenterX: spawn.x,
    bugLegCenterY: spawn.y,
    bugLegs: null,
    bugActiveLegIndex: -1,
    bugMoveX: 1,
    bugMoveY: 0,
    bugStepCounter: 0,
    facingMoveX: 0,
    facingMoveY: 0,
    pendingFacingSignX: 0,
    pendingFacingSignY: 0,
    pendingFacingSeconds: 0,
    aimAngle: spawn.angle,
    mining: false,
    miningRay: null,
    miningRayCount: 1,
    miningHoldSeconds: 0,
    rayExtension: 0,
    buttonTargetId: null,
    buttonTargetSeconds: 0,
    buttonTargetActivated: false,
    huckRockCooldownSeconds: 0,
    huckRockEngineCutoutSeconds: 0,
    laserTagCooldownSeconds: 0,
    miningTargetIndex: null,
    miningPhase: null,
    miningProgress: 0,
    thrusting: false,
    shake: 0,
    radius: playerRadiusForGameMode(arena.mode),
    upgrades: createUpgradeState(),
    healthBars,
    health: maxHealth,
    maxHealth,
    team: laserTag ? team : null,
    score: 0,
    laserTagGhost: false,
    laserTagGhostReturn: null,
    laserTagOutUntilTick: 0,
    laserTagLastEvent: null,
    kills: 0,
    lastKillDropAmount: 0,
    lastKillDropTick: Number.NEGATIVE_INFINITY,
    lastHitTargetId: null,
    lastHitTick: Number.NEGATIVE_INFINITY,
    lastHitHealth: 0,
    lastHitMaxHealth: 0,
    lastHitHealthBars: ENGINE.player.startingHealthBars,
    lastDamageTick: Number.NEGATIVE_INFINITY,
    killedById: null,
    eliminatedAtTick: null,
    resources: {
      rock: clampResourceAmount(startingResources.rock),
      ore: clampResourceAmount(startingResources.ore),
      diamond: clampResourceAmount(startingResources.diamond)
    },
    stormWarning: "",
    stormDamagePerSecond: 0,
    alive: true,
    input: createEmptyInput(),
    inputSessionId: "",
    lastInputSeq: 0,
    joinedAtTick: arena.tick
  };

  arena.players.set(player.id, player);
  return { ok: true, player };
}

function clampResourceAmount(value) {
  return clamp(Math.floor(Number(value) || 0), 0, ENGINE.player.maxResourceAmount);
}

export function removePlayer(arena, playerId) {
  return arena.players.delete(playerId);
}

export function eliminatePlayer(arena, playerId, options = {}) {
  const player = arena.players.get(playerId);
  if (!player || !player.alive) {
    return false;
  }

  killPlayer(player, {
    arena,
    tick: options.tick ?? arena.tick,
    killedById: options.killedById ?? null
  });
  return true;
}

export function setPlayerInput(arena, playerId, payload) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  const input = normalizeInput(payload);
  if (input.sessionId && input.sessionId !== player.inputSessionId) {
    player.inputSessionId = input.sessionId;
    player.lastInputSeq = 0;
  }

  if (input.seq !== 0 && input.seq < player.lastInputSeq) {
    return false;
  }

  player.input = input;
  player.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
  return true;
}

export function clearPlayerInput(arena, playerId) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  player.input = {
    ...createEmptyInput(),
    sessionId: player.inputSessionId,
    aimAngle: player.input?.aimAngle ?? player.aimAngle,
    huckRockTargetX: player.input?.huckRockTargetX ?? null,
    huckRockTargetY: player.input?.huckRockTargetY ?? null
  };
  player.mining = false;
  player.thrusting = false;
  clearPendingFacing(player);
  player.miningHoldSeconds = 0;
  player.rayExtension = 0;
  player.buttonTargetId = null;
  player.buttonTargetSeconds = 0;
  player.buttonTargetActivated = false;
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
  player.talk = talk;
  return true;
}

export function purchasePlayerUpgrade(arena, playerId, upgradeId) {
  if (normalizeGameMode(arena?.mode) === GAME_MODES.laserTag) {
    return { ok: false, reason: "upgrades_disabled" };
  }

  const player = arena.players.get(playerId);
  if (!player || !player.alive) {
    return { ok: false, reason: "player_unavailable" };
  }

  const definition = upgradeDefinitionById(upgradeId);
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

export function buildPlayerWall(arena, playerId, payload = {}) {
  if (normalizeGameMode(arena?.mode) === GAME_MODES.laserTag) {
    return { ok: false, reason: "building_disabled" };
  }

  const player = arena.players.get(playerId);
  if (!player || !player.alive) {
    return { ok: false, reason: "player_unavailable" };
  }

  const asteroid = arena.asteroid;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "invalid_build_tile" };
  }
  const tileX = Math.floor(numberFromInput(payload.tileX));
  const tileY = Math.floor(numberFromInput(payload.tileY));
  if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
    return { ok: false, reason: "invalid_build_tile" };
  }

  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return { ok: false, reason: "build_out_of_bounds" };
  }

  const index = tileY * asteroid.widthTiles + tileX;
  if (!isPlayableCell(asteroid, index) || asteroid.tiles[index] !== ASTEROID_TILE.empty) {
    return { ok: false, reason: "build_blocked" };
  }

  if (!tileWithinBuildRadius(player, asteroid, tileX, tileY)) {
    return { ok: false, reason: "build_too_far" };
  }

  if (stormStateAt(arena, index) !== STORM_STATE.safe) {
    return { ok: false, reason: "build_storm" };
  }

  if (tileOverlapsAlivePlayer(arena, asteroid, tileX, tileY)) {
    return { ok: false, reason: "build_occupied" };
  }

  if (!tileIsClosestBuildCandidate(arena, player, tileX, tileY, payload.angle)) {
    return { ok: false, reason: "build_obscured" };
  }

  const cost = ENGINE.build.wallCostRock;
  if ((player.resources.rock || 0) < cost) {
    return { ok: false, reason: "insufficient_resources" };
  }

  player.resources.rock = clamp(player.resources.rock - cost, 0, ENGINE.player.maxResourceAmount);
  clearMiningProgress(arena, index);
  setAsteroidTile(arena, index, ASTEROID_TILE.rock, 0);
  return {
    ok: true,
    tileX,
    tileY,
    index
  };
}

export function stepArena(arena, dtSeconds = 1 / ENGINE.tickRate, options = {}) {
  arena.tick += 1;
  const gameMode = normalizeGameMode(arena.mode);
  if (gameMode === GAME_MODES.laserTag) {
    stepLaserTagArena(arena, dtSeconds, options);
    return;
  }

  stepStorm(arena);
  spawnRandomDiamond(arena);

  for (const player of arena.players.values()) {
    if (player.alive) {
      stepPlayer(arena, player, dtSeconds, options);
      if (gameMode === GAME_MODES.bugs) {
        stampBugFootstepsForPlayer(arena, player);
      }
    }
  }

  stepHuckRocks(arena, dtSeconds);
  stepOctopusInkBlobs(arena, dtSeconds);
  resolvePlayerCollisions(arena);
  processMining(arena, dtSeconds);
}

function initializeLaserTagArena(arena) {
  const config = ENGINE.laserTag;
  const scoreLimit = positiveInteger(arena.params?.scoreLimit, config.scoreLimit);
  const matchSeconds = positiveNumber(arena.params?.matchSeconds, config.matchSeconds);
  arena.laserTag = {
    startedTick: arena.tick,
    ended: false,
    winnerTeam: null,
    scoreLimit,
    matchSeconds,
    teamScores: { red: 0, blue: 0 },
    gateDiamonds: {},
    gateAttacks: {},
    shots: [],
    events: []
  };
}

function stepLaserTagArena(arena, dtSeconds, options = {}) {
  for (const player of arena.players.values()) {
    player.alive = true;
    if (laserTagPlayerIsOut(player)) {
      stepLaserTagGhostReturn(arena, player, dtSeconds);
      continue;
    } else if (player.health <= 0) {
      respawnLaserTagPlayer(arena, player);
    }
    stepPlayer(arena, player, dtSeconds, options);
    restoreLaserTagPlayerHealthOnSpawnTile(arena, player);
  }

  stepLaserTagBlasts(arena, dtSeconds);
  stepLaserTagGateDiamonds(arena, dtSeconds);
  pruneLaserTagGateAttacks(arena);
  resolvePlayerCollisions(arena);
  updateLaserTagEndState(arena);
}

function processLaserTagInput(arena, player, dtSeconds) {
  player.laserTagCooldownSeconds = Math.max(0, (player.laserTagCooldownSeconds || 0) - dtSeconds);
  const firing = player.input.mining || player.input.huckRock;
  if (
    !firing ||
    !arena.asteroid ||
    player.laserTagCooldownSeconds > 0 ||
    laserTagPlayerIsOut(player)
  ) {
    return;
  }

  const config = ENGINE.laserTag;
  const angle = laserTagFireAngle(player);
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const startOffset = player.radius || config.radius;
  const startX = player.x + direction.x * startOffset;
  const startY = player.y + direction.y * startOffset;
  const maxDistance = laserTagBlastMaxRange();
  const team = player.team || laserTagTeamForPlayerNumber(player.number);
  const id = `laser-blast:${player.id}:${arena.tick}`;
  const probe = {
    id,
    type: "laserBlast",
    ownerId: player.id,
    team
  };
  const hit = laserTagBlastHit(arena, probe, startX, startY, angle, maxDistance);
  const rayDistance = hit
    ? Math.max(0, Math.min(maxDistance, Number(hit.distance) || 0))
    : maxDistance;
  const endX = startX + direction.x * rayDistance;
  const endY = startY + direction.y * rayDistance;
  const beam = {
    id,
    type: "laserBlast",
    ownerId: player.id,
    team,
    x: roundForSnapshot(endX),
    y: roundForSnapshot(endY),
    spawnX: roundForSnapshot(startX),
    spawnY: roundForSnapshot(startY),
    previousX: roundForSnapshot(startX),
    previousY: roundForSnapshot(startY),
    fullEndX: roundForSnapshot(endX),
    fullEndY: roundForSnapshot(endY),
    hit: Boolean(hit),
    hitX: roundForSnapshot(endX),
    hitY: roundForSnapshot(endY),
    angle: roundForSnapshot(angle),
    radius: config.blastRadius,
    maxDistance: roundForSnapshot(maxDistance),
    targetDistance: roundForSnapshot(rayDistance),
    retractFromDistance: roundForSnapshot(rayDistance),
    retractToDistance: roundForSnapshot(rayDistance),
    beamLerpSeconds: roundForSnapshot(laserTagBeamDurationSeconds()),
    ageSeconds: 0,
    bornTick: arena.tick
  };
  if (hit) {
    handleLaserTagBlastHit(arena, beam, hit);
  }
  addLaserTagShot(arena, beam);
  player.laserTagCooldownSeconds = config.fireIntervalSeconds;
}

function addLaserTagShot(arena, beam) {
  if (!arena?.laserTag || !beam) {
    return;
  }

  arena.laserTag.shots = (arena.laserTag.shots || []).concat({
    ...beam,
    shotTick: arena.tick
  }).slice(-32);
}

function laserTagFireAngle(player) {
  const targetX = player.input?.huckRockTargetX;
  const targetY = player.input?.huckRockTargetY;
  if ((player.input?.huckRock || player.input?.mining) && Number.isFinite(targetX) && Number.isFinite(targetY)) {
    return Math.atan2(targetY - player.y, targetX - player.x);
  }
  return player.aimAngle ?? player.angle;
}

function stepLaserTagBlasts(arena, dtSeconds) {
  pruneLaserTagShots(arena);
  const blasts = Array.from(arena.entities.values()).filter((entity) => entity.type === "laserBlast");

  for (const entity of blasts) {
    entity.ageSeconds = (entity.ageSeconds || 0) + dtSeconds;
    if (entity.ageSeconds > 1 / ENGINE.tickRate) {
      arena.entities.delete(entity.id);
    }
  }
}

function pruneLaserTagShots(arena) {
  if (!arena?.laserTag?.shots?.length) {
    return;
  }

  const retainTicks = Math.max(
    1,
    Math.ceil(Math.max(0.75, laserTagBeamDurationSeconds() * 2) * ENGINE.tickRate)
  );
  arena.laserTag.shots = arena.laserTag.shots.filter((shot) => {
    const shotTick = Number.isFinite(shot.shotTick) ? shot.shotTick : arena.tick;
    return arena.tick - shotTick <= retainTicks;
  });
}

function laserTagBlastHit(arena, entity, startX, startY, angle, distance) {
  if (distance <= 0.000001) {
    return null;
  }

  const start = { x: startX, y: startY };
  let nearest = null;

  const asteroidHit = raycastAsteroid(arena.asteroid, startX, startY, angle, distance, {
    blockNonPlayable: true
  });
  if (asteroidHit?.hit) {
    nearest = {
      type: "asteroid",
      distance: asteroidHit.distance,
      hit: asteroidHit
    };
  }

  const playerHit = laserTagBlastPlayerHit(arena, entity, start, angle, distance);
  if (playerHit && (!nearest || playerHit.distance < nearest.distance)) {
    nearest = playerHit;
  }

  return nearest;
}

function laserTagBlastPlayerHit(arena, entity, start, angle, maxDistance) {
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  let nearest = null;
  for (const target of arena.players.values()) {
    if (
      target.id === entity.ownerId ||
      target.alive === false ||
      laserTagPlayerIsOut(target) ||
      laserTagPlayerTouchesSpawnTile(arena, target)
    ) {
      continue;
    }
    const hit = rayCircleIntersection(start, direction, target, target.radius, maxDistance);
    if (!hit || (nearest && hit.distance >= nearest.distance)) {
      continue;
    }
    nearest = {
      type: "player",
      distance: hit.distance,
      hit,
      target
    };
  }
  return nearest;
}

function handleLaserTagBlastHit(arena, entity, hit) {
  if (hit.type === "player") {
    tagLaserTagPlayer(arena, entity, hit.target);
    return;
  }

  if (hit.type !== "asteroid") {
    return;
  }

  const tileHit = hit.hit;
  const laserTarget = laserTagGateTargetForTile(arena.asteroid, tileHit.index);
  if (laserTarget) {
    tagLaserTagTarget(arena, entity, laserTarget, tileHit.index);
    return;
  }
}

function laserTagGateTargetForTile(asteroid, index) {
  if (!asteroid || index < 0) {
    return null;
  }

  for (const gate of asteroid.laserTag?.gates || []) {
    if (Array.isArray(gate.tileIndices) && gate.tileIndices.includes(index)) {
      return gate;
    }
  }
  return null;
}

function tagLaserTagPlayer(arena, entity, target) {
  const shooter = arena.players.get(entity.ownerId);
  if (!shooter || !target) {
    return;
  }

  if (!laserTagBaseForTeam(arena, target.team)) {
    return;
  }

  if (shooter.team && target.team && shooter.team === target.team) {
    return;
  }

  if (laserTagPlayerTouchesSpawnTile(arena, target)) {
    return;
  }

  target.health = clamp(Math.floor(Number(target.health || 0)) - 1, 0, target.maxHealth || ENGINE.laserTag.health);
  target.lastDamageTick = arena.tick;
  shooter.lastHitTargetId = target.id;
  shooter.lastHitTick = arena.tick;
  shooter.lastHitHealth = target.health;
  shooter.lastHitMaxHealth = target.maxHealth;
  shooter.lastHitHealthBars = target.healthBars;
  addLaserTagScore(arena, shooter, ENGINE.laserTag.hitPoints, "OPPONENT HIT");
  pushLaserTagEvent(arena, "A FRIENDLY WAS HIT", target.team);
  if (target.health > 0) {
    return;
  }

  shooter.kills = Math.max(0, Math.floor(Number(shooter.kills || 0))) + 1;
  startLaserTagGhostReturn(arena, target);
  target.laserTagOutUntilTick = 0;
  target.mining = false;
  target.miningRay = null;
  target.rayExtension = 0;
  target.killedById = shooter.id;
  target.eliminatedAtTick = arena.tick;
}

function tagLaserTagTarget(arena, entity, target, tileIndex = -1) {
  const shooter = arena.players.get(entity.ownerId);
  if (!shooter || !target || shooter.team === target.team) {
    return;
  }

  recordLaserTagGateAttack(arena, entity, target, tileIndex);
  spinLaserTagGateDiamond(arena, target, tileIndex);
  addLaserTagScore(arena, shooter, ENGINE.laserTag.gatePoints, `${target.label} HIT`);
  pushLaserTagEvent(arena, `${target.label} UNDER ATTACK`, target.team);
}

function recordLaserTagGateAttack(arena, entity, target, tileIndex = -1) {
  if (!arena?.laserTag || !target?.id) {
    return;
  }
  if (!arena.laserTag.gateAttacks) {
    arena.laserTag.gateAttacks = {};
  }
  arena.laserTag.gateAttacks[target.id] = {
    id: target.id,
    team: target.team || "",
    tileIndex: Number.isInteger(tileIndex) ? tileIndex : -1,
    hitX: Number.isFinite(entity?.hitX) ? roundForSnapshot(entity.hitX) : null,
    hitY: Number.isFinite(entity?.hitY) ? roundForSnapshot(entity.hitY) : null,
    angle: Number.isFinite(entity?.angle) ? roundForSnapshot(entity.angle) : null,
    tick: arena.tick
  };
}

function pruneLaserTagGateAttacks(arena) {
  const attacks = arena?.laserTag?.gateAttacks;
  if (!attacks) {
    return;
  }
  for (const [id, attack] of Object.entries(attacks)) {
    const tick = Number.isFinite(attack?.tick) ? attack.tick : Number.NEGATIVE_INFINITY;
    if (arena.tick - tick > LASER_TAG_GATE_ATTACK_MEMORY_TICKS) {
      delete attacks[id];
    }
  }
}

function spinLaserTagGateDiamond(arena, target, tileIndex) {
  if (!arena?.laserTag || !Number.isFinite(tileIndex) || tileIndex < 0) {
    return;
  }
  if (!Array.isArray(target?.tileIndices) || !target.tileIndices.includes(tileIndex)) {
    return;
  }

  if (!arena.laserTag.gateDiamonds) {
    arena.laserTag.gateDiamonds = {};
  }

  const key = String(tileIndex);
  const state = arena.laserTag.gateDiamonds[key] || {
    index: tileIndex,
    angle: 0,
    velocity: 0
  };
  const direction = laserTagGateDiamondSpinDirection(arena, target, tileIndex);
  state.index = tileIndex;
  state.angle = normalizePositiveAngle(state.angle || 0);
  state.velocity = clamp(
    Number(state.velocity || 0) + direction * LASER_TAG_GATE_DIAMOND_SPIN_IMPULSE,
    -LASER_TAG_GATE_DIAMOND_SPIN_MAX,
    LASER_TAG_GATE_DIAMOND_SPIN_MAX
  );
  arena.laserTag.gateDiamonds[key] = state;
}

function stepLaserTagGateDiamonds(arena, dtSeconds) {
  const states = arena?.laserTag?.gateDiamonds;
  if (!states) {
    return;
  }

  const damping = Math.exp(-LASER_TAG_GATE_DIAMOND_SPIN_DAMPING * Math.max(0, dtSeconds));
  for (const state of Object.values(states)) {
    const velocity = Number(state.velocity || 0);
    if (Math.abs(velocity) <= 0.001) {
      state.velocity = 0;
      continue;
    }
    state.angle = normalizePositiveAngle(Number(state.angle || 0) + velocity * dtSeconds);
    state.velocity = velocity * damping;
  }
}

function laserTagGateDiamondSpinDirection(arena, target, tileIndex) {
  const random = createSeededRandom(`${arena.seed}:laser-tag:gate-diamond-spin:${target?.id || ""}:${tileIndex}`);
  return random() < 0.5 ? -1 : 1;
}

function normalizePositiveAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function addLaserTagScore(arena, player, amount, reason = "") {
  if (!arena?.laserTag || !player) {
    return;
  }
  const delta = Math.round(Number(amount) || 0);
  player.score = Math.max(0, Math.floor(Number(player.score || 0)) + delta);
  const team = player.team || laserTagTeamForPlayerNumber(player.number);
  arena.laserTag.teamScores[team] = Math.max(0, Math.floor(Number(arena.laserTag.teamScores[team] || 0)) + delta);
  if (reason) {
    player.laserTagLastEvent = {
      tick: arena.tick,
      reason,
      delta
    };
  }
}

function pushLaserTagEvent(arena, text, team = "") {
  if (!arena?.laserTag) {
    return;
  }
  arena.laserTag.events.push({
    id: `${arena.tick}:${arena.laserTag.events.length}:${text}`,
    tick: arena.tick,
    text,
    team
  });
  arena.laserTag.events = arena.laserTag.events.slice(-12);
}

function respawnLaserTagPlayer(arena, player) {
  const spawn = randomFreeLaserTagSpawnForPlayer(arena, player);
  placeLaserTagPlayerAtSpawn(player, spawn);
}

function placeLaserTagPlayerAtSpawn(player, spawn) {
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.angle = spawn.angle;
  player.carHeading = spawn.angle;
  player.aimAngle = spawn.angle;
  player.health = player.maxHealth || ENGINE.laserTag.health;
  player.laserTagGhost = false;
  player.laserTagGhostReturn = null;
  player.laserTagOutUntilTick = 0;
  player.mining = false;
  player.miningRay = null;
  player.rayExtension = 0;
}

function completeLaserTagGhostReturn(arena, player, spawn) {
  placeLaserTagPlayerAtSpawn(player, spawn || randomFreeLaserTagSpawnForPlayer(arena, player));
}

function laserTagPlayerIsOut(player) {
  return player?.laserTagGhost === true;
}

function startLaserTagGhostReturn(arena, player) {
  player.laserTagGhost = true;
  player.laserTagGhostReturn = createLaserTagGhostReturn(arena, player);
}

function createLaserTagGhostReturn(arena, player) {
  const respawn = randomFreeLaserTagSpawnForPlayer(arena, player);
  const points = laserTagRespawnReturnPoints(arena, player, respawn);
  return {
    elapsedSeconds: 0,
    durationSeconds: LASER_TAG_GHOST_RETURN_SECONDS,
    distance: 0,
    totalDistance: pathPointDistance(points),
    respawn,
    points
  };
}

function stepLaserTagGhostReturn(arena, player, dtSeconds) {
  player.health = 0;
  player.vx = 0;
  player.vy = 0;
  player.thrusting = false;
  player.mining = false;
  player.miningRay = null;
  player.rayExtension = 0;
  player.miningHoldSeconds = 0;
  player.huckRockCooldownSeconds = 0;
  player.laserTagCooldownSeconds = Math.max(0, (player.laserTagCooldownSeconds || 0) - dtSeconds);

  if (!player.laserTagGhostReturn?.points?.length) {
    player.laserTagGhostReturn = createLaserTagGhostReturn(arena, player);
  }

  const route = player.laserTagGhostReturn;
  if (!route?.points?.length || route.totalDistance <= 0) {
    completeLaserTagGhostReturn(arena, player, route?.respawn);
    return;
  }

  route.elapsedSeconds = Math.min(
    route.durationSeconds,
    Math.max(0, route.elapsedSeconds + dtSeconds)
  );
  const progress = clamp(route.elapsedSeconds / Math.max(0.001, route.durationSeconds), 0, 1);
  const targetDistance = route.totalDistance * progress;
  const beforeX = player.x;
  const beforeY = player.y;
  const point = pointAlongPath(route.points, targetDistance);
  player.x = point.x;
  player.y = point.y;
  const dx = player.x - beforeX;
  const dy = player.y - beforeY;
  if (dx !== 0 || dy !== 0) {
    player.angle = Math.atan2(dy, dx);
    player.aimAngle = player.angle;
    player.vx = dx / Math.max(0.001, dtSeconds);
    player.vy = dy / Math.max(0.001, dtSeconds);
  }

  if (progress >= 1) {
    player.vx = 0;
    player.vy = 0;
    completeLaserTagGhostReturn(arena, player, route.respawn);
  }
}

function laserTagRespawnReturnPoints(arena, player, respawn) {
  if (!arena?.asteroid || !respawn) {
    return [{ x: player.x, y: player.y }];
  }

  const asteroid = arena.asteroid;
  const startIndex = nearestLaserTagOpenTileIndex(
    asteroid,
    Math.floor(player.x / asteroid.tileSize),
    Math.floor(player.y / asteroid.tileSize)
  );
  const goalIndex = nearestLaserTagOpenTileIndex(
    asteroid,
    Math.floor(respawn.x / asteroid.tileSize),
    Math.floor(respawn.y / asteroid.tileSize)
  );

  if (startIndex < 0 || goalIndex < 0) {
    return [{ x: player.x, y: player.y }, { x: respawn.x, y: respawn.y }];
  }

  const indexes = findLaserTagAStarPath(asteroid, startIndex, goalIndex);
  if (!indexes.length) {
    return [{ x: player.x, y: player.y }, { x: respawn.x, y: respawn.y }];
  }

  const points = [{ x: player.x, y: player.y }];
  for (let index = 1; index < indexes.length; index += 1) {
    points.push(tileCenterPoint(asteroid, indexes[index]));
  }
  points.push({ x: respawn.x, y: respawn.y });
  return simplifyCollinearPath(points);
}

function nearestLaserTagOpenTileIndex(asteroid, tileX, tileY, maxRadius = 10) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let y = tileY - radius; y <= tileY + radius; y += 1) {
      for (let x = tileX - radius; x <= tileX + radius; x += 1) {
        if (Math.max(Math.abs(x - tileX), Math.abs(y - tileY)) !== radius) {
          continue;
        }
        const index = y * asteroid.widthTiles + x;
        if (!laserTagPathTileOpen(asteroid, index)) {
          continue;
        }
        const distance = (x - tileX) * (x - tileX) + (y - tileY) * (y - tileY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    }
    if (bestIndex >= 0) {
      return bestIndex;
    }
  }
  return bestIndex;
}

function findLaserTagAStarPath(asteroid, startIndex, goalIndex) {
  if (startIndex === goalIndex) {
    return [startIndex];
  }

  const count = asteroid.tiles.length;
  const cameFrom = new Int32Array(count);
  const gScore = new Float32Array(count);
  const closed = new Uint8Array(count);
  cameFrom.fill(-1);
  gScore.fill(Number.POSITIVE_INFINITY);
  gScore[startIndex] = 0;

  const open = [{ index: startIndex, priority: laserTagPathHeuristic(asteroid, startIndex, goalIndex) }];
  while (open.length > 0) {
    const current = takeLowestPriorityPathNode(open);
    if (closed[current]) {
      continue;
    }
    if (current === goalIndex) {
      return reconstructIndexPath(cameFrom, current);
    }
    closed[current] = 1;

    for (const neighbor of laserTagPathNeighbors(asteroid, current)) {
      if (
        closed[neighbor] ||
        !laserTagPathTileOpen(asteroid, neighbor) ||
        !laserTagPathEdgeOpen(asteroid, current, neighbor)
      ) {
        continue;
      }
      const nextScore = gScore[current] + 1;
      if (nextScore >= gScore[neighbor]) {
        continue;
      }
      cameFrom[neighbor] = current;
      gScore[neighbor] = nextScore;
      open.push({
        index: neighbor,
        priority: nextScore + laserTagPathHeuristic(asteroid, neighbor, goalIndex)
      });
    }
  }

  return [];
}

function takeLowestPriorityPathNode(open) {
  let bestIndex = 0;
  let bestPriority = open[0].priority;
  for (let index = 1; index < open.length; index += 1) {
    if (open[index].priority < bestPriority) {
      bestPriority = open[index].priority;
      bestIndex = index;
    }
  }
  const [entry] = open.splice(bestIndex, 1);
  return entry.index;
}

function laserTagPathNeighbors(asteroid, index) {
  const x = index % asteroid.widthTiles;
  const y = Math.floor(index / asteroid.widthTiles);
  const neighbors = [];
  if (x > 0) {
    neighbors.push(index - 1);
  }
  if (x < asteroid.widthTiles - 1) {
    neighbors.push(index + 1);
  }
  if (y > 0) {
    neighbors.push(index - asteroid.widthTiles);
  }
  if (y < asteroid.heightTiles - 1) {
    neighbors.push(index + asteroid.widthTiles);
  }
  return neighbors;
}

function laserTagPathTileOpen(asteroid, index) {
  if (index < 0 || index >= asteroid.tiles.length) {
    return false;
  }
  const playable = asteroid.playable[index] === true || asteroid.playable[index] === "1";
  return playable &&
    !isAsteroidRockTile(asteroid.tiles[index]) &&
    !laserTagPathTileHitsWindow(asteroid, index);
}

function laserTagPathTileHitsWindow(asteroid, index) {
  if (!asteroid?.laserTag?.windows?.length) {
    return false;
  }

  const point = tileCenterPoint(asteroid, index);
  const radius = laserTagPathRadius();
  const blockers = blockingTilesNearCircle(asteroid, point.x, point.y, radius, {
    blockNonPlayable: false,
    blockWindows: true
  });
  for (const blocker of blockers) {
    if (blocker?.type !== "laserTagWindow") {
      continue;
    }
    if (circleBlockerOverlap({ x: point.x, y: point.y, radius }, blocker)) {
      return true;
    }
  }
  return false;
}

function laserTagPathEdgeOpen(asteroid, fromIndex, toIndex) {
  if (!asteroid?.laserTag?.windows?.length) {
    return true;
  }

  const from = tileCenterPoint(asteroid, fromIndex);
  const to = tileCenterPoint(asteroid, toIndex);
  const radius = laserTagPathRadius();
  const blockers = blockingTilesAlongSegment(asteroid, from.x, from.y, to.x, to.y, radius, {
    blockNonPlayable: false,
    blockWindows: true
  });
  for (const blocker of blockers) {
    if (blocker?.type !== "laserTagWindow") {
      continue;
    }
    if (sweptCircleBlockerHit(from.x, from.y, to.x, to.y, radius, blocker)) {
      return false;
    }
  }
  return true;
}

function laserTagPathRadius() {
  return Math.max(1, Number(ENGINE.laserTag.radius || ENGINE.ship.radius || 7));
}

function laserTagPathHeuristic(asteroid, fromIndex, toIndex) {
  const fromX = fromIndex % asteroid.widthTiles;
  const fromY = Math.floor(fromIndex / asteroid.widthTiles);
  const toX = toIndex % asteroid.widthTiles;
  const toY = Math.floor(toIndex / asteroid.widthTiles);
  return Math.abs(toX - fromX) + Math.abs(toY - fromY);
}

function reconstructIndexPath(cameFrom, current) {
  const path = [current];
  while (cameFrom[current] >= 0) {
    current = cameFrom[current];
    path.push(current);
  }
  path.reverse();
  return path;
}

function tileCenterPoint(asteroid, index) {
  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  return {
    x: (tileX + 0.5) * asteroid.tileSize,
    y: (tileY + 0.5) * asteroid.tileSize
  };
}

function pathPointDistance(points) {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return distance;
}

function pointAlongPath(points, targetDistance) {
  if (points.length <= 1) {
    return points[0] || { x: 0, y: 0 };
  }

  let remaining = targetDistance;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segmentDistance = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentDistance <= 0) {
      continue;
    }
    if (remaining <= segmentDistance) {
      const t = clamp(remaining / segmentDistance, 0, 1);
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      };
    }
    remaining -= segmentDistance;
  }
  return points[points.length - 1];
}

function simplifyCollinearPath(points) {
  if (points.length <= 2) {
    return points;
  }
  const simplified = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const dx1 = Math.sign(current.x - previous.x);
    const dy1 = Math.sign(current.y - previous.y);
    const dx2 = Math.sign(next.x - current.x);
    const dy2 = Math.sign(next.y - current.y);
    if (dx1 === dx2 && dy1 === dy2) {
      continue;
    }
    simplified.push(current);
  }
  simplified.push(points[points.length - 1]);
  return simplified;
}

function laserTagPlayerAtOwnBase(arena, player) {
  const base = laserTagBaseForTeam(arena, player?.team);
  if (!base) {
    return false;
  }
  return Boolean(circleRectOverlap(player, base));
}

function laserTagBaseForTeam(arena, team) {
  if (!team || !arena?.asteroid?.laserTag) {
    return null;
  }
  const tileSize = arena.asteroid.tileSize || ENGINE.laserTag.tileSize;
  for (const base of arena.asteroid.laserTag.bases || []) {
    if (base.team === team) {
      return {
        id: base.id,
        team: base.team,
        label: base.label,
        x: Math.round(base.x - tileSize),
        y: Math.round(base.y - tileSize),
        width: tileSize * 2,
        height: tileSize * 2
      };
    }
  }
  return null;
}

function laserTagTeamForPlayerNumber(number) {
  return LASER_TAG_TEAMS[(Math.max(1, Math.floor(Number(number) || 1)) - 1) % LASER_TAG_TEAMS.length];
}

function randomFreeLaserTagSpawnForPlayer(arena, player) {
  const teamName = player?.team === "blue" ? "blue" : "red";
  const spawns = arena.asteroid?.laserTag?.spawns?.[teamName] || [];
  const fallback = laserTagSpawnForPlayer(arena, teamName, player?.number);
  if (!spawns.length) {
    return fallback;
  }

  const candidates = spawns
    .map((spawn) => laserTagSpawnPoint(spawn, teamName))
    .filter((spawn) => laserTagSpawnTileIsOpen(arena.asteroid, spawn));
  const pool = candidates.length ? candidates : spawns.map((spawn) => laserTagSpawnPoint(spawn, teamName));
  const random = createSeededRandom(`${arena.seed}:laser-tag:respawn:${arena.tick}:${player?.id || player?.number || teamName}`);
  const order = pool.map((spawn) => ({ spawn, order: random() })).sort((a, b) => a.order - b.order);

  for (const item of order) {
    if (laserTagSpawnPointIsFree(arena, player, item.spawn)) {
      return item.spawn;
    }
  }

  return order[0]?.spawn || fallback;
}

function restoreLaserTagPlayerHealthOnSpawnTile(arena, player) {
  if (!player || laserTagPlayerIsOut(player) || !laserTagPlayerTouchesSpawnTile(arena, player)) {
    return;
  }

  const maxHealth = Math.max(1, Number(player.maxHealth) || ENGINE.laserTag.health);
  if (player.health < maxHealth) {
    player.health = maxHealth;
  }
}

function laserTagPlayerTouchesSpawnTile(arena, player) {
  const asteroid = arena?.asteroid;
  if (!asteroid?.laserTag?.spawns || !player) {
    return false;
  }

  const radius = Math.max(0, Number(player.radius) || playerRadiusForGameMode(GAME_MODES.laserTag));
  const circle = { x: player.x, y: player.y, radius };
  for (const team of LASER_TAG_TEAMS) {
    for (const spawn of asteroid.laserTag.spawns[team] || []) {
      const rect = laserTagSpawnTileRect(asteroid, spawn);
      if (rect && circleTouchesRect(circle, rect)) {
        return true;
      }
    }
  }
  return false;
}

function laserTagSpawnTileRect(asteroid, spawn) {
  if (!asteroid || !spawn) {
    return null;
  }

  const tileSize = asteroid.tileSize || ENGINE.laserTag.tileSize;
  const spawnTileX = Number(spawn.tileX);
  const spawnTileY = Number(spawn.tileY);
  const tileX = Number.isFinite(spawnTileX)
    ? Math.floor(spawnTileX)
    : Math.floor(Number(spawn.spawnX ?? spawn.x) / tileSize);
  const tileY = Number.isFinite(spawnTileY)
    ? Math.floor(spawnTileY)
    : Math.floor(Number(spawn.spawnY ?? spawn.y) / tileSize);
  if (
    !Number.isFinite(tileX) ||
    !Number.isFinite(tileY) ||
    tileX < 0 ||
    tileY < 0 ||
    tileX >= asteroid.widthTiles ||
    tileY >= asteroid.heightTiles
  ) {
    return null;
  }

  return {
    x: tileX * tileSize,
    y: tileY * tileSize,
    width: tileSize,
    height: tileSize
  };
}

function circleTouchesRect(circle, rect) {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.width);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.height);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius + 0.000001;
}

function laserTagSpawnPoint(spawn, teamName) {
  return {
    x: spawn.spawnX ?? spawn.x,
    y: spawn.spawnY ?? spawn.y,
    angle: Number.isFinite(spawn.angle) ? spawn.angle : teamName === "red" ? 0 : Math.PI
  };
}

function laserTagSpawnTileIsOpen(asteroid, spawn) {
  if (!asteroid || !spawn) {
    return false;
  }
  const tileSize = asteroid.tileSize || ENGINE.laserTag.tileSize;
  const tileX = Math.floor(spawn.x / tileSize);
  const tileY = Math.floor(spawn.y / tileSize);
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }
  const index = tileY * asteroid.widthTiles + tileX;
  return !isAsteroidRockTile(asteroid.tiles[index]);
}

function laserTagSpawnPointIsFree(arena, player, spawn) {
  const radius = Math.max(0.1, player?.radius || playerRadiusForGameMode(arena.mode));
  for (const other of arena.players.values()) {
    if (other === player || other.id === player?.id || laserTagPlayerIsOut(other)) {
      continue;
    }
    const otherRadius = Math.max(0.1, other.radius || playerRadiusForGameMode(arena.mode));
    const minDistance = radius + otherRadius + 1;
    const dx = other.x - spawn.x;
    const dy = other.y - spawn.y;
    if (dx * dx + dy * dy < minDistance * minDistance) {
      return false;
    }
  }
  return true;
}

function laserTagSpawnForPlayer(arena, team, number) {
  const teamName = team === "blue" ? "blue" : "red";
  const spawns = arena.asteroid?.laserTag?.spawns?.[teamName] || [];
  const candidates = spawns
    .map((spawn) => laserTagSpawnPoint(spawn, teamName))
    .filter((spawn) => laserTagSpawnTileIsOpen(arena.asteroid, spawn));
  const pool = candidates.length ? candidates : spawns.map((spawn) => laserTagSpawnPoint(spawn, teamName));
  const teamIndex = Math.floor((Math.max(1, Math.floor(Number(number) || 1)) - 1) / LASER_TAG_TEAMS.length);
  const order = shuffledLaserTagSpawnPool(pool, arena.seed, teamName);
  return order[teamIndex % Math.max(1, order.length)] ||
    laserTagSpawnPoint(spawnForPlayerNumber(number, arena.asteroid), teamName);
}

function shuffledLaserTagSpawnPool(spawns, seed, teamName) {
  if (!Array.isArray(spawns) || spawns.length <= 1) {
    return Array.isArray(spawns) ? spawns.slice() : [];
  }

  const random = createSeededRandom(`${seed}:laser-tag:spawn-order:${teamName}:${spawns.length}`);
  const shuffled = spawns.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = value;
  }
  return shuffled;
}

function updateLaserTagEndState(arena) {
  if (!arena?.laserTag || arena.laserTag.ended) {
    return;
  }

  const scores = arena.laserTag.teamScores || {};
  const scoreLimit = positiveInteger(arena.laserTag.scoreLimit, ENGINE.laserTag.scoreLimit);
  const matchSeconds = positiveNumber(arena.laserTag.matchSeconds, ENGINE.laserTag.matchSeconds);
  const ticksElapsed = arena.tick - (arena.laserTag.startedTick || 0);
  const timeExpired = ticksElapsed >= matchSeconds * ENGINE.tickRate;
  const redWon = Number(scores.red || 0) >= scoreLimit;
  const blueWon = Number(scores.blue || 0) >= scoreLimit;
  if (!timeExpired && !redWon && !blueWon) {
    return;
  }

  arena.laserTag.ended = true;
  arena.laserTag.winnerTeam = Number(scores.blue || 0) > Number(scores.red || 0) ? "blue" : "red";
}

export function snapshotArena(arena) {
  return {
    arenaId: arena.id,
    mode: normalizeGameMode(arena.mode),
    params: arena.params || {},
    tick: arena.tick,
    serverTime: Date.now(),
    render: RENDER,
    world: ENGINE.world,
    players: Array.from(arena.players.values()).map((player) => snapshotPlayer(player, arena.tick, arena.mode)),
    bugFootsteps: snapshotBugFootsteps(arena),
    asteroidMining: snapshotAsteroidMining(arena),
    entities: Array.from(arena.entities.values()).filter((entity) => entity.destroyed !== true),
    effects: arena.effects,
    laserTag: snapshotLaserTag(arena)
  };
}

function snapshotLaserTag(arena) {
  if (normalizeGameMode(arena.mode) !== GAME_MODES.laserTag || !arena.laserTag) {
    return null;
  }

  return {
    teamScores: {
      red: Math.max(0, Math.floor(Number(arena.laserTag.teamScores?.red || 0))),
      blue: Math.max(0, Math.floor(Number(arena.laserTag.teamScores?.blue || 0)))
    },
    scoreLimit: positiveInteger(arena.laserTag.scoreLimit, ENGINE.laserTag.scoreLimit),
    startedTick: arena.laserTag.startedTick || 0,
    matchSeconds: positiveNumber(arena.laserTag.matchSeconds, ENGINE.laserTag.matchSeconds),
    ended: arena.laserTag.ended === true,
    winnerTeam: arena.laserTag.winnerTeam || null,
    events: (arena.laserTag.events || []).slice(-8),
    gateDiamonds: snapshotLaserTagGateDiamonds(arena),
    shots: snapshotLaserTagShots(arena)
  };
}

function snapshotLaserTagGateDiamonds(arena) {
  const states = arena?.laserTag?.gateDiamonds;
  if (!states) {
    return [];
  }

  return Object.values(states)
    .filter((state) => Number.isFinite(state?.index))
    .map((state) => ({
      index: Math.max(0, Math.floor(Number(state.index))),
      angle: roundForSnapshot(normalizePositiveAngle(Number(state.angle || 0))),
      velocity: roundForSnapshot(Number(state.velocity || 0))
    }));
}

function snapshotLaserTagShots(arena) {
  if (!Array.isArray(arena?.laserTag?.shots)) {
    return [];
  }

  const retainTicks = Math.max(
    1,
    Math.ceil(Math.max(0.75, laserTagBeamDurationSeconds() * 2) * ENGINE.tickRate)
  );
  return arena.laserTag.shots
    .filter((shot) => arena.tick - (Number.isFinite(shot.shotTick) ? shot.shotTick : arena.tick) <= retainTicks)
    .map((shot) => ({
      ...shot,
      ageSeconds: 0
    }));
}

function snapshotBugFootsteps(arena) {
  if (normalizeGameMode(arena.mode) !== GAME_MODES.bugs) {
    return [];
  }

  for (const player of arena.players.values()) {
    if (player.alive) {
      stampBugFootstepsForPlayer(arena, player);
    }
  }

  return Array.from(arena.bugFootsteps?.values?.() || []);
}

function stampBugFootstepsForPlayer(arena, player) {
  if (!arena || !player || normalizeGameMode(arena.mode) !== GAME_MODES.bugs) {
    return;
  }

  ensureBugLegState(player);
  if (!(arena.bugFootsteps instanceof Map)) {
    arena.bugFootsteps = new Map();
  }

  for (const leg of player.bugLegs || []) {
    if (leg?.step) {
      continue;
    }

    const x = Math.round(Number(leg?.x));
    const y = Math.round(Number(leg?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const id = `${x}:${y}`;
    if (!arena.bugFootsteps.has(id)) {
      arena.bugFootsteps.set(id, { id, x, y });
    }
  }
}

function createArenaParams(mode, seed, params = {}, playerCount = 0) {
  const safeParams = params && typeof params === "object" ? params : {};

  if (mode === GAME_MODES.laserTag) {
    return createLaserTagArenaParams(playerCount);
  }

  if (mode !== GAME_MODES.cars) {
    return {};
  }

  return {
    carGround: sanitizeCarGroundVariant(safeParams.carGround) ||
      randomCarGroundVariant(seed)
  };
}

function createLaserTagArenaParams(playerCount = 0) {
  const count = safePlayerCount(playerCount);
  const duel = count === LASER_TAG_DUEL_PLAYER_COUNT;
  return {
    laserTagMap: defaultLaserTagMap(count),
    scoreLimit: duel ? LASER_TAG_DUEL_SCORE_LIMIT : ENGINE.laserTag.scoreLimit,
    matchSeconds: duel ? LASER_TAG_DUEL_MATCH_SECONDS : ENGINE.laserTag.matchSeconds
  };
}

function defaultLaserTagMap(playerCount = 0) {
  const maps = laserTagMapIds();
  if (
    safePlayerCount(playerCount) > 0 &&
    safePlayerCount(playerCount) <= LASER_TAG_SMALL_MAP_MAX_PLAYERS &&
    maps.includes(LASER_TAG_SMALL_MAP_ID)
  ) {
    return LASER_TAG_SMALL_MAP_ID;
  }
  if (maps.includes(LASER_TAG_DEFAULT_MAP_ID)) {
    return LASER_TAG_DEFAULT_MAP_ID;
  }
  if (maps.length === 0) {
    return LASER_TAG_DEFAULT_MAP_ID;
  }
  return maps[0];
}

function safePlayerCount(value) {
  const count = Math.floor(Number(value) || 0);
  return count > 0 ? count : 0;
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  if (Number.isFinite(number) && number > 0) {
    return number;
  }
  return Math.max(1, Math.floor(Number(fallback) || 1));
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number;
  }
  return Math.max(1, Number(fallback) || 1);
}

function sanitizeCarGroundVariant(value) {
  return value === CAR_GROUND_VARIANTS.grass || value === CAR_GROUND_VARIANTS.desert
    ? value
    : null;
}

function randomCarGroundVariant(seed) {
  const random = createSeededRandom(`${seed}:car-ground`);
  return random() < 0.5
    ? CAR_GROUND_VARIANTS.grass
    : CAR_GROUND_VARIANTS.desert;
}

export function snapshotAsteroid(arena) {
  return {
    ...serializeAsteroid(arena.asteroid),
    storm: arena.storm ? serializeStorm(arena.storm) : null,
    stormWarnings: arena.storm ? serializeStormWarnings(arena.storm) : []
  };
}

function snapshotAsteroidMining(arena) {
  if (arena.asteroidMining.size <= 0) {
    return [];
  }

  const mining = [];
  for (const [index, state] of arena.asteroidMining.entries()) {
    const target = miningTargetForTile(arena.asteroid, index, arena.mode);
    if (!target || target.phase !== state.phase) {
      continue;
    }

    mining.push({
      index,
      phase: state.phase,
      progress: roundForSnapshot(clamp(state.progress / target.seconds, 0, 1))
    });
  }
  return mining;
}

export function takeAsteroidUpdates(arena) {
  if (arena.asteroidUpdates.length <= 0 && arena.stormUpdates.length <= 0) {
    return [];
  }

  const updates = arena.asteroidUpdates.concat(arena.stormUpdates);
  arena.asteroidUpdates = [];
  arena.stormUpdates = [];
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
  return (typeof name === "string" ? name : "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18) || "Pilot";
}

export function sanitizeTalkText(text) {
  return (typeof text === "string" ? text : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 36);
}

function stepPlayer(arena, player, dtSeconds, options = {}) {
  player.shake = Math.max(0, player.shake - ENGINE.collision.shakeDecay * dtSeconds);
  player.huckRockEngineCutoutSeconds = 0;
  syncPlayerDerivedStats(player);
  const effects = aggregateUpgradeEffects(player.upgrades);
  const gameMode = normalizeGameMode(arena.mode);
  applyShipModeFriction(player, dtSeconds, gameMode);

  const move = clampMagnitude(player.input.moveX, player.input.moveY, 1);
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  const canThrust = hasMoveIntent;
  player.thrusting = gameMode === GAME_MODES.bugs ||
    gameMode === GAME_MODES.clouds ||
    gameMode === GAME_MODES.octopus
    ? false
    : canThrust;

  if (gameMode === GAME_MODES.cars) {
    simulateCarMovement(player, move, effects, dtSeconds);
  } else if (gameMode === GAME_MODES.bugs) {
    simulateBugMovement(player, move, effects, dtSeconds, arena.asteroid);
  } else if (gameMode === GAME_MODES.clouds) {
    simulateCloudMovement(player, move, effects, dtSeconds);
  } else {
    updateShipModeFacing(player, move, dtSeconds, gameMode);
    if (canThrust) {
      applyThrusterAcceleration(player, thrustMoveForGameMode(player, move, gameMode), effects, dtSeconds, shipThrustForGameMode(gameMode), gameMode);
    }
  }

  player.aimAngle = player.input.aimAngle;
  player.mining = player.input.mining;
  if (player.mining) {
    player.miningHoldSeconds += dtSeconds;
  } else {
    player.miningHoldSeconds = 0;
  }
  player.rayExtension = miningRayExtension(player.mining, player.miningHoldSeconds);
  rechargePlayerHealth(arena, player, dtSeconds, effects);

  if (gameMode === GAME_MODES.laserTag) {
    processLaserTagInput(arena, player, dtSeconds);
  } else {
    processHuckRockInput(arena, player, dtSeconds);
  }

  const previousX = player.x;
  const previousY = player.y;
  player.x += player.vx * dtSeconds;
  player.y += player.vy * dtSeconds;

  resolveStaticCollisions(arena, player, options, previousX, previousY);
  if (gameMode === GAME_MODES.bugs) {
    clampBugLegCenterToCore(player, arena.asteroid);
  }
  applyStormDamage(arena, player, dtSeconds);
}

function resolveStaticCollisions(arena, player, options = {}, previousX = player.x, previousY = player.y) {
  const gameMode = normalizeGameMode(arena.mode);
  return arena.asteroid
    ? resolveAsteroidCollisions(arena.asteroid, player, {
      blockNonPlayable: !arena.storm,
      blockWindows: gameMode === GAME_MODES.laserTag,
      previousX,
      previousY,
      boundaryRestitution: boundaryRestitutionForGameMode(gameMode),
      onImpact: options.onAsteroidImpact
        ? (speed, blocker, hit) => options.onAsteroidImpact(arena, player, speed, blocker, hit)
        : null
    })
    : 0;
}

function resolveAsteroidCollisions(asteroid, player, options = {}) {
  let impact = 0;

  if (options.blockWindows === true) {
    impact = Math.max(impact, resolveSweptWindowCollisions(asteroid, player, options));
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let resolved = false;
    const blockers = blockingTilesNearCircle(asteroid, player.x, player.y, player.radius, options);

    for (const blocker of blockers) {
      const hit = circleBlockerOverlap(player, blocker);
      if (!hit) {
        continue;
      }

      player.x += hit.normalX * hit.overlap;
      player.y += hit.normalY * hit.overlap;

      const normalSpeed = player.vx * hit.normalX + player.vy * hit.normalY;
      impact = Math.max(impact, Math.abs(normalSpeed));
      if (normalSpeed < 0) {
        if (typeof options.onImpact === "function") {
          options.onImpact(-normalSpeed, blocker, hit);
        }
        const restitution = options.boundaryRestitution ?? ENGINE.collision.boundaryRestitution;
        player.vx -= (1 + restitution) * normalSpeed * hit.normalX;
        player.vy -= (1 + restitution) * normalSpeed * hit.normalY;
      }

      resolved = true;
    }

    if (!resolved) {
      break;
    }
  }

  return impact;
}

function resolveSweptWindowCollisions(asteroid, player, options = {}) {
  const previousX = Number(options.previousX);
  const previousY = Number(options.previousY);
  if (
    !Number.isFinite(previousX) ||
    !Number.isFinite(previousY) ||
    (previousX === player.x && previousY === player.y)
  ) {
    return 0;
  }

  let nearest = null;
  const blockers = blockingTilesAlongSegment(
    asteroid,
    previousX,
    previousY,
    player.x,
    player.y,
    player.radius,
    options
  );
  for (const blocker of blockers) {
    if (blocker?.type !== "laserTagWindow") {
      continue;
    }
    const hit = sweptCircleBlockerHit(previousX, previousY, player.x, player.y, player.radius, blocker);
    if (!hit || (nearest && hit.time >= nearest.time)) {
      continue;
    }
    nearest = hit;
  }

  if (!nearest) {
    return 0;
  }

  player.x = nearest.x + nearest.normalX * Math.max(0.01, nearest.overlap || 0);
  player.y = nearest.y + nearest.normalY * Math.max(0.01, nearest.overlap || 0);

  const normalSpeed = player.vx * nearest.normalX + player.vy * nearest.normalY;
  if (normalSpeed < 0) {
    if (typeof options.onImpact === "function") {
      options.onImpact(-normalSpeed, { type: "laserTagWindow" }, nearest);
    }
    const restitution = options.boundaryRestitution ?? ENGINE.collision.boundaryRestitution;
    player.vx -= (1 + restitution) * normalSpeed * nearest.normalX;
    player.vy -= (1 + restitution) * normalSpeed * nearest.normalY;
  }

  return Math.abs(normalSpeed);
}

function processHuckRockInput(arena, player, dtSeconds) {
  player.huckRockCooldownSeconds = Math.max(0, (player.huckRockCooldownSeconds || 0) - dtSeconds);

  if (
    !player.input.huckRock ||
    !arena.asteroid ||
    player.huckRockCooldownSeconds > 0
  ) {
    return;
  }

  const config = ENGINE.huckRock;
  if (arena.rules.asteroidMining) {
    const cost = config.costRock || 0;
    if ((player.resources.rock || 0) < cost) {
      return;
    }
    player.resources.rock = clamp(player.resources.rock - cost, 0, ENGINE.player.maxResourceAmount);
  }

  const angle = huckRockLaunchAngle(player);
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const id = `huck-rock:${player.id}:${arena.tick}`;
  const random = createSeededRandom(`${arena.seed}:${id}`);

  arena.entities.set(id, {
    id,
    type: "huckRock",
    ownerId: player.id,
    shapeSeed: `${arena.seed}:${id}:shape`,
    x: roundForSnapshot(player.x + direction.x * config.spawnOffset),
    y: roundForSnapshot(player.y + direction.y * config.spawnOffset),
    vx: roundForSnapshot(player.vx + direction.x * config.speed),
    vy: roundForSnapshot(player.vy + direction.y * config.speed),
    radius: config.radius,
    angleX: random() * Math.PI * 2,
    angleY: random() * Math.PI * 2,
    angleZ: random() * Math.PI * 2,
    spinX: (random() - 0.5) * 2.2,
    spinY: (random() - 0.5) * 2.2,
    spinZ: (random() - 0.5) * 1.2,
    bounceCount: 0,
    ageSeconds: 0,
    bornTick: arena.tick
  });
  applyHuckRockRecoil(player, direction, arena.mode);
  player.huckRockCooldownSeconds = config.fireIntervalSeconds;
  player.huckRockEngineCutoutSeconds = 0;
  trimHuckRocks(arena);
}

function huckRockLaunchAngle(player) {
  const fallbackAngle = player.aimAngle ?? player.angle;
  const targetX = player.input?.huckRockTargetX;
  const targetY = player.input?.huckRockTargetY;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    return fallbackAngle;
  }

  return inheritedVelocityLaunchAngle({
    originX: player.x,
    originY: player.y,
    inheritedVx: player.vx || 0,
    inheritedVy: player.vy || 0,
    targetX,
    targetY,
    launchSpeed: ENGINE.huckRock.speed,
    spawnOffset: ENGINE.huckRock.spawnOffset,
    fallbackAngle
  });
}

function applyHuckRockRecoil(player, direction, gameMode = GAME_MODES.bitspace) {
  const impulse = huckRockRecoilImpulse(player, gameMode);
  player.vx -= direction.x * impulse;
  player.vy -= direction.y * impulse;
}

function applyShipFriction(player, dtSeconds, frictionPerTick = ENGINE.ship.friction) {
  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const friction = Math.pow(frictionPerTick, dtSeconds / fixedStepSeconds);
  player.vx *= friction;
  player.vy *= friction;
}

function applyShipModeFriction(player, dtSeconds, gameMode) {
  if (!isSubThemedGameMode(gameMode)) {
    applyShipFriction(player, dtSeconds, shipFrictionForGameMode(gameMode));
    return;
  }

  applyDirectionalShipFriction(
    player,
    dtSeconds,
    ENGINE.subs.forwardFriction,
    ENGINE.subs.sideFriction,
    ENGINE.subs.sideToForwardConversion
  );
}

function applyDirectionalShipFriction(
  player,
  dtSeconds,
  forwardFrictionPerTick,
  sideFrictionPerTick,
  sideToForwardConversion = 0
) {
  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const forwardFriction = Math.pow(forwardFrictionPerTick, dtSeconds / fixedStepSeconds);
  const sideFriction = Math.pow(sideFrictionPerTick, dtSeconds / fixedStepSeconds);
  const angle = Number.isFinite(player.angle) ? player.angle : Number(player.aimAngle) || 0;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const sideX = -forwardY;
  const sideY = forwardX;
  const forwardSpeed = player.vx * forwardX + player.vy * forwardY;
  const sideSpeed = player.vx * sideX + player.vy * sideY;
  const baseForwardSpeed = forwardSpeed * forwardFriction;
  const baseSideSpeed = sideSpeed * sideFriction;
  const redirect = clamp(sideToForwardConversion, 0, 1);
  const dampedSideSpeed = baseSideSpeed * (1 - redirect);
  const dampedSpeedSq = baseForwardSpeed * baseForwardSpeed + baseSideSpeed * baseSideSpeed;
  const redirectedForwardMagnitude = Math.sqrt(Math.max(0, dampedSpeedSq - dampedSideSpeed * dampedSideSpeed));
  const forwardSign = baseForwardSpeed < -0.0001 ? -1 : 1;
  const dampedForwardSpeed = redirectedForwardMagnitude * forwardSign;
  player.vx = forwardX * dampedForwardSpeed + sideX * dampedSideSpeed;
  player.vy = forwardY * dampedForwardSpeed + sideY * dampedSideSpeed;
}

function applyThrusterAcceleration(player, move, effects, dtSeconds, thrust = ENGINE.ship.thrust, gameMode = GAME_MODES.bitspace) {
  const magnitude = Math.hypot(move.x, move.y);
  if (magnitude <= 0.000001) {
    return;
  }

  const direction = { x: move.x / magnitude, y: move.y / magnitude };
  const scale = thrustAccelerationScaleForGameMode(player, direction, gameMode);
  const impulse = thrust * effects.thrustMultiplier * dtSeconds * scale * Math.min(1, magnitude);
  player.vx += direction.x * impulse;
  player.vy += direction.y * impulse;
}

function simulateBugMovement(player, move, effects, dtSeconds, terrain = null) {
  simulateBugMovementCore(player, move, effects, dtSeconds, terrain);
}

function ensureBugLegCenter(player) {
  ensureBugLegState(player);
}

function clampBugLegCenterToCore(player, terrain = null) {
  clampBugLegStateToCore(player, terrain);
}

function thrustAccelerationScaleForGameMode(player, move, gameMode) {
  if (!isSubThemedGameMode(gameMode)) {
    return 1;
  }

  const sameDirectionSpeed = Math.max(0, player.vx * move.x + player.vy * move.y);
  const falloffSpeed = Math.max(1, ENGINE.subs.thrustFalloffSpeed || 1);
  const minScale = clamp(ENGINE.subs.thrustMinScale ?? 0, 0, 1);
  return Math.max(minScale, 1 / (1 + sameDirectionSpeed / falloffSpeed));
}

function thrustMoveForGameMode(player, move, gameMode) {
  if (gameMode !== GAME_MODES.subs) {
    return move;
  }

  const heading = Number.isFinite(player.angle) ? player.angle : Math.atan2(move.y, move.x);
  const headingX = Math.cos(heading);
  const headingY = Math.sin(heading);
  if (player.subReverseActive) {
    const reverseThrottle = clamp(ENGINE.subs.reverseThrottleScale ?? 0.5, 0, 1);
    return {
      x: -headingX * reverseThrottle,
      y: -headingY * reverseThrottle
    };
  }

  const alignment = clamp(headingX * move.x + headingY * move.y, 0, 1);
  const throttle = Math.max(clamp(ENGINE.subs.turnThrottleMinScale ?? 0, 0, 1), alignment);
  return {
    x: headingX * throttle,
    y: headingY * throttle
  };
}

function updateShipModeFacing(player, move, dtSeconds, gameMode) {
  if (gameMode === GAME_MODES.subs) {
    updateSubFacing(player, move, dtSeconds);
    return;
  }
  if (gameMode === GAME_MODES.subs2) {
    updateExactInputFacing(player, move);
    return;
  }

  updateShipFacing(player, move, dtSeconds);
}

function updateExactInputFacing(player, move) {
  if (move.x === 0 && move.y === 0) {
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    player.subReverseActive = false;
    clearPendingFacing(player);
    return;
  }

  player.angle = normalizeAngle(Math.atan2(move.y, move.x));
  player.facingMoveX = move.x;
  player.facingMoveY = move.y;
  player.subReverseActive = false;
  clearPendingFacing(player);
}

function updateSubFacing(player, move, dtSeconds) {
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  if (!hasMoveIntent) {
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    player.subReverseActive = false;
    clearPendingFacing(player);
    return;
  }

  const target = Math.atan2(move.y, move.x);
  const current = Number.isFinite(player.angle) ? player.angle : target;
  const reverseHalfCone = Math.max(0, ENGINE.subs.reverseConeRadians || 0) / 2;
  const reverseCenter = normalizeAngle(current + Math.PI);
  if (!player.subReverseActive && Math.abs(normalizeSignedAngle(target - reverseCenter)) <= reverseHalfCone) {
    player.subReverseActive = true;
    player.subReverseConeAngle = reverseCenter;
  }

  if (player.subReverseActive) {
    const coneCenter = Number.isFinite(player.subReverseConeAngle) ? player.subReverseConeAngle : reverseCenter;
    if (Math.abs(normalizeSignedAngle(target - coneCenter)) <= reverseHalfCone) {
      player.facingMoveX = move.x;
      player.facingMoveY = move.y;
      clearPendingFacing(player);
      return;
    }
    player.subReverseActive = false;
  }

  const maxStep = Math.max(0, ENGINE.subs.turnRate || 0) * dtSeconds;
  const delta = normalizeSignedAngle(target - current);
  player.angle = normalizeAngle(current + clamp(delta, -maxStep, maxStep));
  player.facingMoveX = move.x;
  player.facingMoveY = move.y;
  player.subReverseConeAngle = normalizeAngle(player.angle + Math.PI);
  clearPendingFacing(player);
}

function updateShipFacing(player, move, dtSeconds) {
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  if (!hasMoveIntent) {
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    clearPendingFacing(player);
    return;
  }

  const signX = signAxis(move.x);
  const signY = signAxis(move.y);
  if (
    player.pendingFacingSeconds > 0 &&
    player.pendingFacingSignX === signX &&
    player.pendingFacingSignY === signY
  ) {
    player.pendingFacingSeconds = Math.max(0, player.pendingFacingSeconds - dtSeconds);
    player.facingMoveX = move.x;
    player.facingMoveY = move.y;
    if (player.pendingFacingSeconds > 0.000001) {
      return;
    }
  } else {
    clearPendingFacing(player);
  }

  const previousSignX = signAxis(player.facingMoveX);
  const previousSignY = signAxis(player.facingMoveY);
  if (shouldDelayFacingUpdate(previousSignX, previousSignY, signX, signY)) {
    player.pendingFacingSignX = signX;
    player.pendingFacingSignY = signY;
    player.pendingFacingSeconds = Math.max(0, ENGINE.ship.directionKeyGraceSeconds - dtSeconds);
    player.facingMoveX = move.x;
    player.facingMoveY = move.y;
    if (player.pendingFacingSeconds > 0.000001) {
      return;
    }
  }

  player.angle = normalizeAngle(Math.atan2(move.y, move.x));
  player.facingMoveX = move.x;
  player.facingMoveY = move.y;
}

function shouldDelayFacingUpdate(previousSignX, previousSignY, signX, signY) {
  const previousWasDiagonal = previousSignX !== 0 && previousSignY !== 0;
  const previousWasIdle = previousSignX === 0 && previousSignY === 0;
  const currentIsCardinal = (signX !== 0) !== (signY !== 0);
  const keptOneDiagonalAxis =
    (signX !== 0 && signX === previousSignX) ||
    (signY !== 0 && signY === previousSignY);
  return currentIsCardinal && (
    previousWasIdle ||
    (previousWasDiagonal && keptOneDiagonalAxis)
  );
}

function clearPendingFacing(player) {
  player.pendingFacingSignX = 0;
  player.pendingFacingSignY = 0;
  player.pendingFacingSeconds = 0;
}

function signAxis(value) {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}

function huckRockRecoilImpulse(player, gameMode = GAME_MODES.bitspace) {
  const config = ENGINE.huckRock;
  const rockMass = config.radius * config.radius;
  const shipRadius = Math.max(0.1, player.radius || ENGINE.ship.radius);
  const shipMass = shipRadius * shipRadius * (config.shipMassScale || 1) * playerMassScaleForGameMode(gameMode);
  const hitImpulse = ((1 + config.restitution) * config.speed) /
    ((1 / rockMass) + (1 / shipMass));
  return (hitImpulse / shipMass) * (config.recoilImpulseScale ?? 1);
}

function stepHuckRocks(arena, dtSeconds) {
  const config = ENGINE.huckRock;
  arena.huckRockButtonHits = [];
  const rocks = Array.from(arena.entities.values()).filter((entity) => entity.type === "huckRock");

  for (const entity of rocks) {
    entity.ageSeconds = (entity.ageSeconds || 0) + dtSeconds;
    if (entity.ageSeconds > (entity.lifetimeSeconds || config.lifetimeSeconds)) {
      entity.destroyed = true;
      arena.entities.delete(entity.id);
      continue;
    }

    const previousX = entity.x;
    const previousY = entity.y;
    entity.previousX = previousX;
    entity.previousY = previousY;
    entity.x += entity.vx * dtSeconds;
    entity.y += entity.vy * dtSeconds;
    entity.angleX = normalizeAngle((entity.angleX || 0) + (entity.spinX || 0) * dtSeconds);
    entity.angleY = normalizeAngle((entity.angleY || 0) + (entity.spinY || 0) * dtSeconds);
    entity.angleZ = normalizeAngle((entity.angleZ || 0) + (entity.spinZ || 0) * dtSeconds);
  }

  resolveHuckRockContacts(arena, rocks);

  for (const entity of rocks) {
    if (entity.destroyed) {
      arena.entities.delete(entity.id);
      continue;
    }

    if (entity.fragment) {
      if (huckRockFragmentTerrainHit(arena, entity, entity.previousX, entity.previousY)) {
        arena.entities.delete(entity.id);
        continue;
      }
      roundHuckRockForSnapshot(entity);
      continue;
    }

    if (huckRockPlayerHit(arena, entity, entity.previousX, entity.previousY)) {
      arena.entities.delete(entity.id);
      continue;
    }
    if (resolveHuckRockCollisions(arena, entity, entity.previousX, entity.previousY)) {
      arena.entities.delete(entity.id);
      continue;
    }
    roundHuckRockForSnapshot(entity);
  }
}

function roundHuckRockForSnapshot(rock) {
  rock.x = roundForSnapshot(rock.x);
  rock.y = roundForSnapshot(rock.y);
  rock.vx = roundForSnapshot(rock.vx);
  rock.vy = roundForSnapshot(rock.vy);
  rock.angleX = roundForSnapshot(rock.angleX);
  rock.angleY = roundForSnapshot(rock.angleY);
  rock.angleZ = roundForSnapshot(rock.angleZ);
}

function resolveHuckRockContacts(arena, rocks) {
  for (let index = 0; index < rocks.length; index += 1) {
    const a = rocks[index];
    if (a.destroyed || a.fragment) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < rocks.length; otherIndex += 1) {
      const b = rocks[otherIndex];
      if (b.destroyed || b.fragment || !huckRocksOverlap(a, b)) {
        continue;
      }

      bounceHuckRocks(arena, a, b);
      if (a.destroyed) {
        break;
      }
    }
  }
}

function huckRocksOverlap(a, b) {
  const radius = (a.radius || ENGINE.huckRock.radius) + (b.radius || ENGINE.huckRock.radius);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy < radius * radius;
}

function bounceHuckRocks(arena, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const normal = distance > 0
    ? { x: dx / distance, y: dy / distance }
    : deterministicContactNormal(a.id, b.id);
  const minDistance = (a.radius || ENGINE.huckRock.radius) + (b.radius || ENGINE.huckRock.radius);
  const overlap = Math.max(0, minDistance - distance);

  if (overlap > 0) {
    a.x -= normal.x * overlap * 0.5;
    a.y -= normal.y * overlap * 0.5;
    b.x += normal.x * overlap * 0.5;
    b.y += normal.y * overlap * 0.5;
  }

  const relativeSpeed = (b.vx - a.vx) * normal.x + (b.vy - a.vy) * normal.y;
  if (relativeSpeed < 0) {
    const impulse = (-(1 + ENGINE.huckRock.restitution) * relativeSpeed) / 2;
    a.vx -= normal.x * impulse;
    a.vy -= normal.y * impulse;
    b.vx += normal.x * impulse;
    b.vy += normal.y * impulse;
  }

  breakHuckRock(arena, a, "rock");
  breakHuckRock(arena, b, "rock");
}

function breakHuckRock(arena, rock, reason = "break") {
  if (normalizeGameMode(arena.mode) === GAME_MODES.octopus) {
    spawnOctopusInkBlob(arena, rock, reason);
    rock.destroyed = true;
    return;
  }

  if (!rock.fragment && !rock.fragmentsSpawned) {
    rock.fragmentsSpawned = true;
    spawnHuckRockFragments(arena, rock, reason);
  }
  rock.destroyed = true;
}

function spawnOctopusInkBlob(arena, rock, reason = "impact") {
  const config = ENGINE.octopus?.ink || {};
  const pointCount = Math.max(3, Math.floor(Number(config.pointCount || 8)));
  const random = createSeededRandom(`${arena.seed}:${rock.id}:ink:${arena.tick}:${reason}`);
  const baseAngle = random() * Math.PI * 2;
  const minScale = Number(config.minPointScale || 0.68);
  const maxScale = Number(config.maxPointScale || 1.18);
  const points = [];

  for (let index = 0; index < pointCount; index += 1) {
    points.push({
      angle: roundForSnapshot(baseAngle + (index / pointCount) * Math.PI * 2 + (random() - 0.5) * 0.34),
      scale: roundForSnapshot(minScale + random() * (maxScale - minScale))
    });
  }

  const id = `${rock.id}:ink:${arena.tick}`;
  arena.entities.set(id, {
    id,
    type: "octopusInk",
    ownerId: rock.ownerId,
    x: roundForSnapshot(rock.x),
    y: roundForSnapshot(rock.y),
    radius: Number(config.radius || 30),
    points,
    ageSeconds: 0,
    lifetimeSeconds: Number(config.lifetimeSeconds || 2.8),
    shrinkSeconds: Number(config.shrinkSeconds || 1.8),
    fadeSeconds: Number(config.fadeSeconds || 1),
    minRadiusScale: Number(config.minRadiusScale ?? 0.5),
    bornTick: arena.tick
  });
}

function stepOctopusInkBlobs(arena, dtSeconds) {
  if (normalizeGameMode(arena.mode) !== GAME_MODES.octopus) {
    return;
  }

  for (const entity of arena.entities.values()) {
    if (entity.type !== "octopusInk") {
      continue;
    }

    entity.ageSeconds = roundForSnapshot((entity.ageSeconds || 0) + dtSeconds);
    if (entity.ageSeconds >= (entity.lifetimeSeconds || ENGINE.octopus.ink.lifetimeSeconds)) {
      entity.destroyed = true;
      arena.entities.delete(entity.id);
    }
  }
}

function spawnHuckRockFragments(arena, rock, reason) {
  const config = ENGINE.huckRock.fragments;
  const random = createSeededRandom(`${arena.seed}:${rock.id}:fragments:${arena.tick}:${reason}`);
  const count = config.minCount + Math.floor(random() * (config.maxCount - config.minCount + 1));
  const speed = Math.hypot(rock.vx || 0, rock.vy || 0);
  const baseAngle = speed > 0.001
    ? Math.atan2(rock.vy, rock.vx)
    : Number(rock.angleZ) || 0;
  const fragments = [];

  for (let index = 0; index < count; index += 1) {
    const scale = config.minRadiusScale + random() * (config.maxRadiusScale - config.minRadiusScale);
    const radius = Math.max(1.25, (rock.radius || ENGINE.huckRock.radius) * scale);
    const angle = baseAngle + (random() * 2 - 1) * config.spreadRadians;
    const fragmentSpeed = Math.max(
      18,
      speed * (config.minSpeedScale + random() * (config.maxSpeedScale - config.minSpeedScale))
    );
    const sideAngle = baseAngle + Math.PI / 2;
    const sideJitter = (random() * 2 - 1) * config.spawnJitter;
    const outwardJitter = random() * config.spawnJitter;
    const id = `${rock.id}:fragment:${arena.tick}:${index}`;
    const fragment = {
      id,
      type: "huckRock",
      fragment: true,
      ownerId: rock.ownerId,
      shapeSeed: `${rock.shapeSeed || rock.id}:fragment:${index}`,
      x: roundForSnapshot(
        rock.x +
        Math.cos(baseAngle) * outwardJitter +
        Math.cos(sideAngle) * sideJitter
      ),
      y: roundForSnapshot(
        rock.y +
        Math.sin(baseAngle) * outwardJitter +
        Math.sin(sideAngle) * sideJitter
      ),
      vx: roundForSnapshot(Math.cos(angle) * fragmentSpeed),
      vy: roundForSnapshot(Math.sin(angle) * fragmentSpeed),
      radius: roundForSnapshot(radius),
      angleX: random() * Math.PI * 2,
      angleY: random() * Math.PI * 2,
      angleZ: random() * Math.PI * 2,
      spinX: (random() - 0.5) * 5.5,
      spinY: (random() - 0.5) * 5.5,
      spinZ: (random() - 0.5) * 3.2,
      bounceCount: 2,
      ageSeconds: 0,
      lifetimeSeconds: config.minLifetimeSeconds +
        random() * (config.maxLifetimeSeconds - config.minLifetimeSeconds),
      bornTick: arena.tick
    };

    if (!huckRockFragmentTerrainHit(arena, fragment, fragment.x, fragment.y)) {
      fragments.push(fragment);
    }
  }

  preserveHuckRockFragmentMomentum(fragments, rock.vx || 0, rock.vy || 0);
  for (const fragment of fragments) {
    fragment.vx = roundForSnapshot(fragment.vx);
    fragment.vy = roundForSnapshot(fragment.vy);
    arena.entities.set(fragment.id, fragment);
  }
}

function preserveHuckRockFragmentMomentum(fragments, targetVx, targetVy) {
  const totalMass = fragments.reduce((sum, fragment) => sum + huckRockFragmentMass(fragment), 0);
  if (totalMass <= 0) {
    return;
  }

  let currentVx = 0;
  let currentVy = 0;
  for (const fragment of fragments) {
    const mass = huckRockFragmentMass(fragment);
    currentVx += fragment.vx * mass;
    currentVy += fragment.vy * mass;
  }

  currentVx /= totalMass;
  currentVy /= totalMass;
  const correctionX = targetVx - currentVx;
  const correctionY = targetVy - currentVy;
  for (const fragment of fragments) {
    fragment.vx += correctionX;
    fragment.vy += correctionY;
  }
}

function huckRockFragmentMass(fragment) {
  const radius = Math.max(0.1, fragment.radius || ENGINE.huckRock.radius);
  return radius * radius;
}

function deterministicContactNormal(a, b) {
  const seed = `${a}:${b}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function resolveHuckRockCollisions(arena, rock, previousX = rock.x, previousY = rock.y) {
  if (!arena.asteroid) {
    return false;
  }

  for (const entity of arena.entities.values()) {
    if (entity.type !== "lobbyButton" || entity.hidden) {
      continue;
    }

    const hit = sweptCircleRectHit(previousX, previousY, rock.x, rock.y, rock.radius, entity) ||
      circleRectOverlap(rock, entity);
    if (!hit) {
      continue;
    }

    bounceHuckRock(rock, hit);
    breakHuckRock(arena, rock, "button");
    arena.huckRockButtonHits.push({
      targetId: entity.id,
      ownerId: rock.ownerId
    });
    return true;
  }

  const hit = nearestHuckRockAsteroidHit(arena, rock, previousX, previousY);
  if (!hit) {
    return false;
  }

  if (hit.destroy) {
    if (normalizeGameMode(arena.mode) === GAME_MODES.octopus) {
      spawnOctopusInkBlob(arena, rock, "wall");
    }
    rock.destroyed = true;
    return true;
  }

  if (bounceHuckRock(rock, hit)) {
    const maxBounces = normalizeGameMode(arena.mode) === GAME_MODES.octopus
      ? Number(ENGINE.octopus?.ink?.maxBounces ?? 0)
      : 1;
    if ((rock.bounceCount || 0) >= maxBounces) {
      breakHuckRock(arena, rock, "wall");
      return true;
    }
    rock.bounceCount = (rock.bounceCount || 0) + 1;
  }

  return false;
}

function huckRockPlayerHit(arena, rock, previousX = rock.x, previousY = rock.y) {
  for (const player of arena.players.values()) {
    if (!player.alive) {
      continue;
    }

    if (player.id === rock.ownerId && (rock.ageSeconds || 0) < 0.15 && (rock.bounceCount || 0) === 0) {
      continue;
    }

    const hit = sweptCircleCircleHit(previousX, previousY, rock.x, rock.y, rock.radius, player);
    if (!hit) {
      continue;
    }

    const relativeSpeed = Math.hypot(rock.vx - player.vx, rock.vy - player.vy);
    applyHuckRockPlayerImpulse(arena, rock, player, hit);
    addShake(player, Math.max(ENGINE.collision.shakeThreshold + 10, relativeSpeed * 0.35));
    if (arena.rules.playerDamage && normalizeGameMode(arena.mode) !== GAME_MODES.octopus) {
      damagePlayer(arena, player, ENGINE.huckRock.damage, arena.tick, rock.ownerId);
    }
    breakHuckRock(arena, rock, "player");
    return true;
  }

  return false;
}

function applyHuckRockPlayerImpulse(arena, rock, player, hit) {
  const normalX = Number.isFinite(hit.normalX) ? hit.normalX : 0;
  const normalY = Number.isFinite(hit.normalY) ? hit.normalY : 0;
  if (normalX === 0 && normalY === 0) {
    return;
  }

  if (Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
    rock.x = hit.x + normalX * 0.01;
    rock.y = hit.y + normalY * 0.01;
  } else if (Number.isFinite(hit.overlap) && hit.overlap > 0) {
    rock.x += normalX * hit.overlap;
    rock.y += normalY * hit.overlap;
  }

  const relativeNormalSpeed = (rock.vx - player.vx) * normalX + (rock.vy - player.vy) * normalY;
  if (relativeNormalSpeed >= 0) {
    return;
  }

  const rockMass = huckRockBodyMass(rock);
  const playerMass = playerBodyMass(player, arena.mode);
  const impulse = (-(1 + ENGINE.huckRock.restitution) * relativeNormalSpeed) /
    ((1 / rockMass) + (1 / playerMass));

  rock.vx += (impulse / rockMass) * normalX;
  rock.vy += (impulse / rockMass) * normalY;
  player.vx -= (impulse / playerMass) * normalX;
  player.vy -= (impulse / playerMass) * normalY;
}

function huckRockBodyMass(rock) {
  const radius = Math.max(0.1, rock.radius || ENGINE.huckRock.radius);
  return radius * radius;
}

function playerBodyMass(player, gameMode = GAME_MODES.bitspace) {
  const radius = Math.max(0.1, player.radius || ENGINE.ship.radius);
  return radius * radius * (ENGINE.huckRock.shipMassScale || 1) * playerMassScaleForGameMode(gameMode);
}

function huckRockFragmentTerrainHit(arena, rock, previousX = rock.x, previousY = rock.y) {
  if (!arena.asteroid) {
    return false;
  }

  return Boolean(nearestHuckRockAsteroidHit(arena, rock, previousX, previousY));
}

function nearestHuckRockAsteroidHit(arena, rock, previousX, previousY) {
  const options = huckRockCollisionOptions(arena);
  const blockers = blockingTilesAlongSegment(
    arena.asteroid,
    previousX,
    previousY,
    rock.x,
    rock.y,
    rock.radius,
    options
  );
  const seen = new Set();
  let nearest = null;
  let buried = false;

  for (const blocker of blockers) {
    const key = blocker.key ?? `${blocker.tileX}:${blocker.tileY}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const hit = sweptCircleBlockerHit(
      previousX,
      previousY,
      rock.x,
      rock.y,
      rock.radius,
      blocker
    ) || circleBlockerOverlap(rock, blocker);
    if (!hit) {
      continue;
    }

    if (!isExposedBlockFace(arena.asteroid, blocker, hit, options)) {
      buried = true;
      continue;
    }

    if (nearest && hitTime(hit) >= hitTime(nearest)) {
      continue;
    }

    nearest = hit;
  }

  return nearest || (buried ? { destroy: true } : null);
}

function huckRockCollisionOptions(arena) {
  return {
    blockNonPlayable: !arena.storm
  };
}

function bounceHuckRock(rock, hit) {
  if (hit.destroy) {
    rock.destroyed = true;
    return true;
  }

  if (Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
    rock.x = hit.x + hit.normalX * 0.01;
    rock.y = hit.y + hit.normalY * 0.01;
  } else {
    rock.x += hit.normalX * hit.overlap;
    rock.y += hit.normalY * hit.overlap;
  }

  const normalSpeed = rock.vx * hit.normalX + rock.vy * hit.normalY;
  if (normalSpeed < 0) {
    rock.vx -= (1 + ENGINE.huckRock.restitution) * normalSpeed * hit.normalX;
    rock.vy -= (1 + ENGINE.huckRock.restitution) * normalSpeed * hit.normalY;
    return true;
  }

  return false;
}

function isExposedBlockFace(asteroid, blocker, hit, options = {}) {
  const normalX = Math.abs(hit.normalX) >= Math.abs(hit.normalY) ? Math.sign(hit.normalX) : 0;
  const normalY = normalX === 0 ? Math.sign(hit.normalY) : 0;
  if (normalX === 0 && normalY === 0) {
    return true;
  }

  return !isBlockingAsteroidTile(asteroid, blocker.tileX + normalX, blocker.tileY + normalY, options);
}

function isBlockingAsteroidTile(asteroid, tileX, tileY, options = {}) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return options.blockNonPlayable !== false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return isAsteroidRockTile(asteroid.tiles[index]) ||
    (options.blockNonPlayable !== false && !(asteroid.playable[index] === true || asteroid.playable[index] === "1"));
}

function hitTime(hit) {
  return Number.isFinite(hit.time) ? hit.time : 1;
}

function circleRectOverlap(circle, rect) {
  return circleBoundsOverlap(circle, rect.x, rect.y, rect.width, rect.height);
}

function circleBoundsOverlap(circle, x, y, width, height) {
  const right = x + width;
  const bottom = y + height;
  const closestX = clamp(circle.x, x, right);
  const closestY = clamp(circle.y, y, bottom);
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

  const left = circle.x - x;
  const rightDistance = right - circle.x;
  const top = circle.y - y;
  const bottomDistance = bottom - circle.y;
  const nearest = Math.min(left, rightDistance, top, bottomDistance);

  if (nearest === left) {
    return { normalX: -1, normalY: 0, overlap: circle.radius + left };
  }

  if (nearest === rightDistance) {
    return { normalX: 1, normalY: 0, overlap: circle.radius + rightDistance };
  }

  if (nearest === top) {
    return { normalX: 0, normalY: -1, overlap: circle.radius + top };
  }

  return { normalX: 0, normalY: 1, overlap: circle.radius + bottomDistance };
}

function sweptCircleRectHit(previousX, previousY, x, y, radius, rect) {
  return sweptCircleBoundsHit(previousX, previousY, x, y, radius, rect.x, rect.y, rect.width, rect.height);
}

function sweptCircleBoundsHit(previousX, previousY, x, y, radius, boundsX, boundsY, width, height) {
  const dx = x - previousX;
  const dy = y - previousY;
  const minX = boundsX - radius;
  const minY = boundsY - radius;
  const maxX = boundsX + width + radius;
  const maxY = boundsY + height + radius;
  const axisX = sweptAxisInterval(previousX, dx, minX, maxX);
  const axisY = sweptAxisInterval(previousY, dy, minY, maxY);
  if (!axisX || !axisY) {
    return null;
  }

  const entry = Math.max(axisX.entry, axisY.entry);
  const exit = Math.min(axisX.exit, axisY.exit);
  if (entry > exit || entry < 0 || entry > 1) {
    return null;
  }

  const hitX = previousX + dx * entry;
  const hitY = previousY + dy * entry;
  const normal = axisX.entry > axisY.entry
    ? { x: dx > 0 ? -1 : 1, y: 0 }
    : { x: 0, y: dy > 0 ? -1 : 1 };

  return {
    time: entry,
    x: hitX,
    y: hitY,
    normalX: normal.x,
    normalY: normal.y,
    overlap: 0
  };
}

function sweptAxisInterval(position, delta, min, max) {
  if (Math.abs(delta) < 0.000001) {
    return position >= min && position <= max
      ? { entry: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY }
      : null;
  }

  const t1 = (min - position) / delta;
  const t2 = (max - position) / delta;
  return {
    entry: Math.min(t1, t2),
    exit: Math.max(t1, t2)
  };
}

function sweptCircleCircleHit(previousX, previousY, x, y, radius, target) {
  const targetRadius = target.radius || 0;
  const combinedRadius = radius + targetRadius;
  const dx = x - previousX;
  const dy = y - previousY;
  const sx = previousX - target.x;
  const sy = previousY - target.y;
  const a = dx * dx + dy * dy;
  const c = sx * sx + sy * sy - combinedRadius * combinedRadius;

  if (c <= 0) {
    const distance = Math.hypot(sx, sy);
    const normal = distance > 0
      ? { x: sx / distance, y: sy / distance }
      : { x: -1, y: 0 };
    return {
      time: 0,
      x: previousX,
      y: previousY,
      normalX: normal.x,
      normalY: normal.y,
      overlap: -c
    };
  }

  if (a <= 0.000001) {
    return null;
  }

  const b = 2 * (sx * dx + sy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (time < 0 || time > 1) {
    return null;
  }

  const hitX = previousX + dx * time;
  const hitY = previousY + dy * time;
  const nx = hitX - target.x;
  const ny = hitY - target.y;
  const distance = Math.hypot(nx, ny) || 1;
  return {
    time,
    x: hitX,
    y: hitY,
    normalX: nx / distance,
    normalY: ny / distance,
    overlap: 0
  };
}

function trimHuckRocks(arena) {
  const rocks = Array.from(arena.entities.values())
    .filter((entity) => entity.type === "huckRock")
    .sort((a, b) => (a.bornTick || 0) - (b.bornTick || 0));
  const excess = rocks.length - ENGINE.huckRock.maxLobbyRocks;

  for (let index = 0; index < excess; index += 1) {
    arena.entities.delete(rocks[index].id);
  }
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
  if (normalizeGameMode(arena.mode) === GAME_MODES.laserTag) {
    resetPlayerMiningTarget(player);
    player.miningRay = null;
    return;
  }

  if (!player.mining) {
    resetPlayerMiningTarget(player);
    player.miningRay = null;
    return;
  }

  const angle = player.aimAngle ?? player.angle;
  const effects = aggregateUpgradeEffects(player.upgrades);
  const fullRayLength = playerMiningRayLength(player, effects);
  const sideOffset = miningSideRayOffsetForPlayer(player);
  const lanes = miningRayLanesForPlayer(player, angle, fullRayLength, sideOffset).map((baseLane) => {
    baseLane = clipMiningRayLaneStart(arena, player, baseLane, angle);
    const start = {
      x: baseLane.startX,
      y: baseLane.startY
    };
    const fullRay = raycastMiningRay(arena, player, start, baseLane.rayAngle, baseLane.rayDistance);
    const activeRay = raycastMiningRay(
      arena,
      player,
      start,
      baseLane.rayAngle,
      baseLane.rayDistance * player.rayExtension
    );

    return miningRayLaneState(baseLane, activeRay, fullRay);
  });
  const miningRay = miningRayStateFromLanes(lanes, player.rayExtension);
  player.miningRay = miningRay;

  const miningByIndex = new Map();
  for (const lane of lanes) {
    const playerHit = lane._playerHit;
    const entityHit = lane._entityHit;
    const hit = lane._asteroidHit;
    if (arena.rules.playerDamage) {
      if (playerHit) {
        damagePlayer(
          arena,
          playerHit.target,
          ENGINE.mining.playerDamagePerSecond * effects.rayDamageMultiplier * lane.power * dtSeconds,
          arena.tick,
          player.id
        );
      }
    }

    if (!arena.rules.asteroidMining || playerHit || entityHit || !hit.mineable) {
      continue;
    }

    const target = miningTargetForTile(arena.asteroid, hit.index, arena.mode);
    if (!target) {
      continue;
    }

    const existing = miningByIndex.get(hit.index);
    if (existing?.target.phase === target.phase) {
      existing.power += lane.power;
      existing.lanes.push(lane);
    } else {
      miningByIndex.set(hit.index, {
        hit,
        target,
        power: lane.power,
        lanes: [lane]
      });
    }
  }

  if (miningByIndex.size <= 0) {
    resetPlayerMiningTarget(player);
    stripTransientMiningLaneHits(player.miningRay);
    return;
  }

  const firstMineable = miningByIndex.values().next().value;
  player.miningTargetIndex = firstMineable.hit.index;
  player.miningPhase = firstMineable.target.phase;
  player.miningProgress = 0;

  for (const entry of miningByIndex.values()) {
    const progress = addMiningProgress(
      arena,
      entry.hit.index,
      entry.target,
      dtSeconds * effects.miningPowerMultiplier * entry.power
    );
    const progressRatio = roundForSnapshot(clamp(progress / entry.target.seconds, 0, 1));
    for (const lane of entry.lanes) {
      lane.progress = progressRatio;
    }
    if (entry === firstMineable) {
      player.miningProgress = progress;
      player.miningRay.progress = progressRatio;
    }

    if (progress >= entry.target.seconds) {
      completeMiningTarget(arena, player, entry.hit.index, entry.target);
      clearMiningProgress(arena, entry.hit.index);
      resetPlayerMiningTarget(player);
    }
  }

  stripTransientMiningLaneHits(player.miningRay);
}

function clipMiningRayLaneStart(arena, player, lane, angle) {
  const probe = miningRaySideStartProbe(player, lane, angle);
  if (!probe || !arena.asteroid) {
    return lane;
  }

  const hit = raycastAsteroid(arena.asteroid, probe.startX, probe.startY, probe.angle, probe.distance, {
    blockNonPlayable: !arena.asteroid.storm
  });
  if (!hit.hit) {
    return lane;
  }

  const distance = miningRayClippedSideStartDistance(probe, hit.distance);
  return miningRayLaneWithStart(
    lane,
    probe.startX + probe.directionX * distance,
    probe.startY + probe.directionY * distance
  );
}

function miningRayLaneState(baseLane, activeRay, fullRay) {
  const hit = activeRay.asteroidHit;
  const entityHit = activeRay.entityHit;
  const playerHit = activeRay.playerHit;
  const hitResult = activeRay.hitResult;
  const fullHitResult = fullRay.hitResult;
  const lane = {
    laneIndex: baseLane.index,
    offset: baseLane.offset,
    endOffset: baseLane.endOffset,
    power: baseLane.power,
    rayAngle: roundForSnapshot(baseLane.rayAngle),
    rayDistance: roundForSnapshot(baseLane.rayDistance),
    rayDirectionX: roundForSnapshot(baseLane.rayDirectionX),
    rayDirectionY: roundForSnapshot(baseLane.rayDirectionY),
    startX: roundForSnapshot(baseLane.startX),
    startY: roundForSnapshot(baseLane.startY),
    endX: roundForSnapshot(hitResult.x),
    endY: roundForSnapshot(hitResult.y),
    fullEndX: roundForSnapshot(fullHitResult.x),
    fullEndY: roundForSnapshot(fullHitResult.y),
    hit: hitResult.hit,
    hitType: playerHit ? "player" : entityHit ? "entity" : hit.hit ? "asteroid" : null,
    mineable: !playerHit && !entityHit && hit.mineable,
    tileX: playerHit || entityHit ? null : hit.tileX,
    tileY: playerHit || entityHit ? null : hit.tileY,
    index: playerHit || entityHit ? null : hit.index,
    tile: playerHit || entityHit ? null : hit.tile,
    targetId: playerHit?.target.id ?? entityHit?.target.id ?? null,
    targetNumber: playerHit?.target.number ?? null,
    targetAction: entityHit?.target.action ?? null,
    progress: 0,
    _asteroidHit: hit,
    _entityHit: entityHit,
    _playerHit: playerHit
  };

  return lane;
}

function miningRayStateFromLanes(lanes, extension) {
  const primaryLane = lanes.find((lane) => lane.hit) || lanes[0] || null;
  if (!primaryLane) {
    return null;
  }

  return {
    ...primaryLane,
    extension: roundForSnapshot(extension),
    lanes
  };
}

function stripTransientMiningLaneHits(miningRay) {
  if (!miningRay) {
    return;
  }

  delete miningRay._asteroidHit;
  delete miningRay._entityHit;
  delete miningRay._playerHit;
  for (const lane of miningRay.lanes || []) {
    delete lane._asteroidHit;
    delete lane._entityHit;
    delete lane._playerHit;
  }
}

function raycastMiningRay(arena, player, start, angle, maxDistance) {
  const hit = raycastAsteroid(arena.asteroid, start.x, start.y, angle, maxDistance, {
    blockNonPlayable: !arena.storm
  });
  const entityHit = raycastEntities(arena, player, start, angle, Math.min(hit.distance, maxDistance));
  const playerHit = raycastPlayers(
    arena,
    player,
    start,
    angle,
    Math.min(entityHit?.distance ?? hit.distance, hit.distance, maxDistance)
  );

  return {
    asteroidHit: hit,
    entityHit,
    playerHit,
    hitResult: playerHit || entityHit || hit
  };
}

function miningTargetForTile(asteroid, index, gameMode = GAME_MODES.bitspace) {
  const tile = asteroid.tiles[index];
  const amount = asteroid.amounts[index] || 0;

  if (tile === ASTEROID_TILE.ore && amount > 0) {
    return {
      phase: `${ASTEROID_TILE.ore}:${amount}`,
      resource: "ore",
      seconds: miningSecondsForGameMode(ENGINE.mining.oreSeconds, gameMode)
    };
  }

  if (tile === ASTEROID_TILE.diamond && amount > 0) {
    return {
      phase: ASTEROID_TILE.diamond,
      resource: "diamond",
      seconds: miningSecondsForGameMode(ENGINE.mining.diamondSeconds, gameMode)
    };
  }

  if (tile === ASTEROID_TILE.wall) {
    return {
      phase: ASTEROID_TILE.wall,
      resource: "rock",
      seconds: miningSecondsForGameMode(ENGINE.mining.rockSeconds, gameMode)
    };
  }

  if (tile === ASTEROID_TILE.rock || tile === ASTEROID_TILE.ore || tile === ASTEROID_TILE.diamond) {
    return {
      phase: ASTEROID_TILE.rock,
      resource: "rock",
      seconds: miningSecondsForGameMode(ENGINE.mining.rockSeconds, gameMode)
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

function createStormState(asteroid, seed) {
  let playableCount = 0;
  let radiusSum = 0;
  const centerX = asteroid.widthTiles / 2;
  const centerY = asteroid.heightTiles / 2;
  for (let index = 0; index < asteroid.playable.length; index += 1) {
    if (isPlayableCell(asteroid, index)) {
      playableCount += 1;
      radiusSum += stormCellCenterRadiusFromCenter(asteroid, index, centerX, centerY);
    }
  }

  return {
    state: new Uint8Array(asteroid.tiles.length),
    warningStartedTick: new Int32Array(asteroid.tiles.length),
    warningUntilTick: new Int32Array(asteroid.tiles.length),
    playableCount,
    claimedCount: 0,
    centerX,
    centerY,
    radiusSum,
    claimedRadiusSum: 0,
    radiusStatsClaimedCount: 0,
    initialAverageRadius: playableCount > 0 ? radiusSum / playableCount : 0,
    random: createSeededRandom(`${seed}:storm`)
  };
}

function serializeStorm(storm) {
  return Array.from(storm.state, (state) => state.toString(36)).join("");
}

function serializeStormWarnings(storm) {
  const warnings = [];

  for (let index = 0; index < storm.state.length; index += 1) {
    if (storm.state[index] === STORM_STATE.warning) {
      warnings.push({
        index,
        startedTick: storm.warningStartedTick[index],
        untilTick: storm.warningUntilTick[index]
      });
    }
  }

  return warnings;
}

function stormStateAt(arena, index) {
  return arena.storm?.state[index] ?? STORM_STATE.safe;
}

function stepStorm(arena) {
  if (!arena.storm) {
    return;
  }

  const converted = convertExpiredStormWarnings(arena);
  if (converted > 0) {
    fillStormEnclosedAreas(arena);
  }

  addStormWarnings(arena);
}

function convertExpiredStormWarnings(arena) {
  const storm = arena.storm;
  let converted = 0;

  for (let index = 0; index < storm.state.length; index += 1) {
    if (
      storm.state[index] !== STORM_STATE.warning ||
      storm.warningUntilTick[index] > arena.tick
    ) {
      continue;
    }

    setStormState(arena, index, STORM_STATE.storm);
    converted += 1;
  }

  return converted;
}

function addStormWarnings(arena) {
  const storm = arena.storm;
  const config = ENGINE.storm;
  const safeTicks = Math.ceil(config.safeSeconds * ENGINE.tickRate);
  const closeTicks = Math.ceil(config.closeSeconds * ENGINE.tickRate);
  const warningTicks = Math.ceil(config.warningSeconds * ENGINE.tickRate);
  const selectionEndTick = safeTicks + Math.max(1, closeTicks - warningTicks);
  if (arena.tick <= safeTicks || storm.claimedCount >= storm.playableCount) {
    return;
  }

  const totalSelectionTicks = Math.max(1, selectionEndTick - safeTicks);
  const elapsedSelectionTicks = clamp(arena.tick - safeTicks, 0, totalSelectionTicks);
  const targetAverageRadius = stormTargetAverageSafeRadius(arena, elapsedSelectionTicks / totalSelectionTicks);

  while (stormAverageSafeRadius(arena) > targetAverageRadius && storm.claimedCount < storm.playableCount) {
    const candidates = stormBoundaryCandidates(arena);
    if (candidates.length <= 0) {
      break;
    }

    const currentAverageRadius = stormAverageSafeRadius(arena);
    const outerCandidates = candidates.filter((index) => stormCellCenterRadius(arena, index) >= currentAverageRadius);
    const activeCandidates = outerCandidates.length > 0 ? outerCandidates : candidates;
    shuffleStormCandidates(activeCandidates, storm.random);
    for (const index of activeCandidates) {
      if (storm.state[index] !== STORM_STATE.safe) {
        continue;
      }

      setStormState(arena, index, STORM_STATE.warning, {
        warningStartedTick: arena.tick,
        warningUntilTick: arena.tick + warningTicks
      });

      if (stormAverageSafeRadius(arena) <= targetAverageRadius) {
        return;
      }
    }
  }
}

function shuffleStormCandidates(candidates, random) {
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = candidates[index];
    candidates[index] = candidates[swapIndex];
    candidates[swapIndex] = value;
  }
}

function stormTargetAverageSafeRadius(arena, progress) {
  ensureStormRadiusStats(arena);
  const storm = arena.storm;
  return storm.initialAverageRadius * (1 - clamp(progress, 0, 1));
}

function stormAverageSafeRadius(arena) {
  ensureStormRadiusStats(arena);
  const storm = arena.storm;
  const safeCount = Math.max(0, storm.playableCount - storm.claimedCount);
  if (safeCount <= 0) {
    return 0;
  }

  return Math.max(0, storm.radiusSum - storm.claimedRadiusSum) / safeCount;
}

function ensureStormRadiusStats(arena) {
  const storm = arena.storm;
  if (
    Number.isFinite(storm.radiusSum) &&
    Number.isFinite(storm.claimedRadiusSum) &&
    Number.isFinite(storm.initialAverageRadius) &&
    storm.radiusStatsClaimedCount === storm.claimedCount
  ) {
    return;
  }

  const asteroid = arena.asteroid;
  const centerX = Number.isFinite(storm.centerX) ? storm.centerX : asteroid.widthTiles / 2;
  const centerY = Number.isFinite(storm.centerY) ? storm.centerY : asteroid.heightTiles / 2;
  let radiusSum = 0;
  let claimedRadiusSum = 0;
  let playableCount = 0;
  let claimedCount = 0;

  for (let index = 0; index < asteroid.playable.length; index += 1) {
    if (!isPlayableCell(asteroid, index)) {
      continue;
    }

    const radius = stormCellCenterRadiusFromCenter(asteroid, index, centerX, centerY);
    playableCount += 1;
    radiusSum += radius;
    if (storm.state[index] !== STORM_STATE.safe) {
      claimedCount += 1;
      claimedRadiusSum += radius;
    }
  }

  storm.centerX = centerX;
  storm.centerY = centerY;
  storm.playableCount = playableCount;
  storm.claimedCount = claimedCount;
  storm.radiusSum = radiusSum;
  storm.claimedRadiusSum = claimedRadiusSum;
  storm.radiusStatsClaimedCount = claimedCount;
  storm.initialAverageRadius = playableCount > 0 ? radiusSum / playableCount : 0;
}

function stormCellCenterRadiusFromCenter(asteroid, index, centerX, centerY) {
  const x = index % asteroid.widthTiles;
  const y = Math.floor(index / asteroid.widthTiles);
  return Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
}

function stormCellCenterRadius(arena, index) {
  const asteroid = arena.asteroid;
  const storm = arena.storm;
  const centerX = Number.isFinite(storm.centerX) ? storm.centerX : asteroid.widthTiles / 2;
  const centerY = Number.isFinite(storm.centerY) ? storm.centerY : asteroid.heightTiles / 2;
  return stormCellCenterRadiusFromCenter(asteroid, index, centerX, centerY);
}

function stormBoundaryCandidates(arena) {
  const asteroid = arena.asteroid;
  const storm = arena.storm;
  const candidates = [];

  for (let index = 0; index < asteroid.tiles.length; index += 1) {
    if (!isPlayableCell(asteroid, index) || storm.state[index] !== STORM_STATE.safe) {
      continue;
    }

    if (hasStormBoundaryNeighbor(arena, index)) {
      candidates.push(index);
    }
  }

  return candidates;
}

function hasStormBoundaryNeighbor(arena, index) {
  const asteroid = arena.asteroid;
  const x = index % asteroid.widthTiles;
  const y = Math.floor(index / asteroid.widthTiles);
  const neighbors = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 }
  ];

  return neighbors.some((neighbor) => {
    if (
      neighbor.x < 0 ||
      neighbor.y < 0 ||
      neighbor.x >= asteroid.widthTiles ||
      neighbor.y >= asteroid.heightTiles
    ) {
      return true;
    }

    const neighborIndex = neighbor.y * asteroid.widthTiles + neighbor.x;
    return !isPlayableCell(asteroid, neighborIndex) ||
      arena.storm.state[neighborIndex] !== STORM_STATE.safe;
  });
}

function fillStormEnclosedAreas(arena) {
  const asteroid = arena.asteroid;
  const storm = arena.storm;
  const visited = new Uint8Array(storm.state.length);
  const components = [];

  for (let index = 0; index < storm.state.length; index += 1) {
    if (
      visited[index] ||
      !isPlayableCell(asteroid, index) ||
      storm.state[index] === STORM_STATE.storm
    ) {
      continue;
    }

    components.push(collectNonStormComponent(arena, index, visited));
  }

  if (components.length <= 1) {
    return;
  }

  let keep = components[0];
  for (const component of components) {
    if (component.length > keep.length) {
      keep = component;
    }
  }

  for (const component of components) {
    if (component === keep) {
      continue;
    }

    for (const index of component) {
      setStormState(arena, index, STORM_STATE.storm);
    }
  }
}

function collectNonStormComponent(arena, startIndex, visited) {
  const asteroid = arena.asteroid;
  const storm = arena.storm;
  const queue = [startIndex];
  const component = [];
  visited[startIndex] = 1;

  while (queue.length > 0) {
    const index = queue.shift();
    component.push(index);

    for (const neighborIndex of stormNeighborIndexes(index, asteroid.widthTiles, asteroid.heightTiles)) {
      if (
        visited[neighborIndex] ||
        !isPlayableCell(asteroid, neighborIndex) ||
        storm.state[neighborIndex] === STORM_STATE.storm
      ) {
        continue;
      }

      visited[neighborIndex] = 1;
      queue.push(neighborIndex);
    }
  }

  return component;
}

function stormNeighborIndexes(index, widthTiles, heightTiles) {
  const x = index % widthTiles;
  const y = Math.floor(index / widthTiles);
  const neighbors = [];

  if (x > 0) {
    neighbors.push(index - 1);
  }
  if (x < widthTiles - 1) {
    neighbors.push(index + 1);
  }
  if (y > 0) {
    neighbors.push(index - widthTiles);
  }
  if (y < heightTiles - 1) {
    neighbors.push(index + widthTiles);
  }

  return neighbors;
}

function setStormState(arena, index, state, options = {}) {
  const storm = arena.storm;
  const previous = storm.state[index];
  if (previous === state) {
    return;
  }

  if (previous === STORM_STATE.safe && state !== STORM_STATE.safe) {
    storm.claimedCount += 1;
    storm.claimedRadiusSum = (storm.claimedRadiusSum || 0) + stormCellCenterRadius(arena, index);
    storm.radiusStatsClaimedCount = storm.claimedCount;
  } else if (previous !== STORM_STATE.safe && state === STORM_STATE.safe) {
    storm.claimedCount = Math.max(0, storm.claimedCount - 1);
    storm.claimedRadiusSum = Math.max(0, (storm.claimedRadiusSum || 0) - stormCellCenterRadius(arena, index));
    storm.radiusStatsClaimedCount = storm.claimedCount;
  }
  if (state === STORM_STATE.warning) {
    storm.warningStartedTick[index] = options.warningStartedTick ?? arena.tick;
    storm.warningUntilTick[index] = options.warningUntilTick ?? arena.tick;
  } else {
    storm.warningStartedTick[index] = 0;
    storm.warningUntilTick[index] = 0;
  }

  storm.state[index] = state;
  const update = {
    type: "storm",
    index,
    state
  };
  if (state === STORM_STATE.warning) {
    update.warningStartedTick = storm.warningStartedTick[index];
    update.warningUntilTick = storm.warningUntilTick[index];
  }
  arena.stormUpdates.push(update);
}

function applyStormDamage(arena, player, dtSeconds) {
  const stormHit = playerStormHit(arena, player);
  if (!stormHit) {
    player.stormWarning = "";
    player.stormDamagePerSecond = 0;
    return;
  }

  const tier = stormDamageTier(arena);
  player.stormWarning = tier.warning;
  player.stormDamagePerSecond = tier.damagePerSecond;
  damagePlayer(arena, player, tier.damagePerSecond * dtSeconds, arena.tick, null);
}

function playerStormHit(arena, player) {
  if (!arena.storm) {
    return false;
  }

  const asteroid = arena.asteroid;
  const tileX = Math.floor(player.x / asteroid.tileSize);
  const tileY = Math.floor(player.y / asteroid.tileSize);
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return true;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return !isPlayableCell(asteroid, index) || arena.storm.state[index] === STORM_STATE.storm;
}

function stormDamageTier(arena) {
  const elapsedSeconds = arena.tick / ENGINE.tickRate;
  let selected = ENGINE.storm.damageTiers[0];

  for (const tier of ENGINE.storm.damageTiers) {
    if (elapsedSeconds >= tier.afterSeconds) {
      selected = tier;
    }
  }

  return selected;
}

function spendUpgradeCost(player, cost) {
  for (const [resource, amount] of Object.entries(cost || {})) {
    player.resources[resource] = clamp((player.resources[resource] || 0) - amount, 0, ENGINE.player.maxResourceAmount);
  }
}

function tileWithinBuildRadius(player, asteroid, tileX, tileY) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  return Math.hypot(centerX - player.x, centerY - player.y) <= ENGINE.build.radiusTiles * tileSize;
}

function tileIsClosestBuildCandidate(arena, player, tileX, tileY, angleOverride = null) {
  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  const fallbackAngle = Math.atan2(centerY - player.y, centerX - player.x);
  const requestedAngle = numberFromInput(angleOverride);
  const angle = Number.isFinite(requestedAngle) ? requestedAngle : fallbackAngle;
  const tiles = serverBuildTargetTiles(arena, player, tileSize);
  const closest = closestBuildTileByCenterAngle({
    tiles,
    tileSize,
    startX: player.x,
    startY: player.y,
    angle
  });

  return closest?.tileX === tileX && closest?.tileY === tileY;
}

function serverBuildTargetTiles(arena, player, tileSize) {
  const asteroid = arena.asteroid;
  return buildClosestTileRing({
    widthTiles: asteroid.widthTiles,
    heightTiles: asteroid.heightTiles,
    tileSize,
    startX: player.x,
    startY: player.y,
    originRadius: player.radius || ENGINE.ship.radius || 0,
    maxDistance: ENGINE.build.radiusTiles * tileSize,
    isCandidate(candidateX, candidateY) {
      return isServerBuildCandidate(arena, player, candidateX, candidateY);
    },
    isNormallyVisible(candidateX, candidateY) {
      return isServerBuildTileNormallyVisible(arena, player, candidateX, candidateY, tileSize);
    },
    isCornerVisible(candidateX, candidateY) {
      return isServerBuildTileCornerVisible(arena, player, candidateX, candidateY, tileSize);
    }
  });
}

function isServerBuildTileNormallyVisible(arena, player, tileX, tileY, tileSize) {
  return buildTileVisibleFromOrigin({
    tileX,
    tileY,
    tileSize,
    startX: player.x,
    startY: player.y,
    raycast(angle, distance) {
      return raycastAsteroid(arena.asteroid, player.x, player.y, angle, distance);
    }
  });
}

function isServerBuildTileCornerVisible(arena, player, tileX, tileY, tileSize) {
  return buildTileVisibleFromOrigin({
    tileX,
    tileY,
    tileSize,
    startX: player.x,
    startY: player.y,
    includeCorners: true,
    raycast(angle, distance) {
      return raycastAsteroid(arena.asteroid, player.x, player.y, angle, distance);
    }
  });
}

function isServerBuildCandidate(arena, player, tileX, tileY) {
  const asteroid = arena.asteroid;
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return tileWithinBuildRadius(player, asteroid, tileX, tileY) &&
    isPlayableCell(asteroid, index) &&
    asteroid.tiles[index] === ASTEROID_TILE.empty &&
    stormStateAt(arena, index) === STORM_STATE.safe &&
    !tileOverlapsAlivePlayer(arena, asteroid, tileX, tileY);
}

function tileOverlapsAlivePlayer(arena, asteroid, tileX, tileY) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const tile = {
    x: tileX * tileSize,
    y: tileY * tileSize,
    size: tileSize
  };

  for (const player of arena.players.values()) {
    if (player.alive && circleTileOverlap(player, tile)) {
      return true;
    }
  }

  return false;
}

function isPlayableCell(asteroid, index) {
  return asteroid.playable[index] === true || asteroid.playable[index] === "1";
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

function spawnRandomDiamond(arena) {
  if (
    !arena?.rules?.playerDamage ||
    !arena.asteroid ||
    !arena.storm ||
    arena.tick <= 0 ||
    arena.tick % RANDOM_DIAMOND_SPAWN_TICKS !== 0
  ) {
    return false;
  }

  const index = randomSafeRockIndex(arena, `${arena.seed}:random-diamond:${arena.tick}`);
  if (index === null) {
    return false;
  }

  clearMiningProgress(arena, index);
  setAsteroidTile(arena, index, ASTEROID_TILE.diamond, 1);
  return true;
}

function randomSafeRockIndex(arena, seed) {
  const asteroid = arena.asteroid;
  const random = createSeededRandom(seed);
  let selectedIndex = null;
  let candidateCount = 0;

  for (let index = 0; index < asteroid.tiles.length; index += 1) {
    if (
      asteroid.tiles[index] !== ASTEROID_TILE.rock ||
      !isPlayableCell(asteroid, index) ||
      stormStateAt(arena, index) !== STORM_STATE.safe
    ) {
      continue;
    }

    candidateCount += 1;
    if (random() < 1 / candidateCount) {
      selectedIndex = index;
    }
  }

  return selectedIndex;
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

function raycastEntities(arena, player, start, angle, maxDistance) {
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  let nearest = null;

  for (const entity of arena.entities.values()) {
    if (!entityBlocksRayForPlayer(entity, player)) {
      continue;
    }

    const hit = rayRectIntersection(start, direction, entity, maxDistance);
    if (!hit || (nearest && hit.distance >= nearest.distance)) {
      continue;
    }

    nearest = {
      hit: true,
      mineable: false,
      x: hit.x,
      y: hit.y,
      distance: hit.distance,
      target: entity
    };
  }

  return nearest;
}

function entityBlocksRayForPlayer(entity, player) {
  if (entity.type !== "lobbyButton") {
    return false;
  }

  if (entity.hidden) {
    return false;
  }

  return !entity.hostOnly || player.lobbyHost === true;
}

function rayRectIntersection(start, direction, rect, maxDistance) {
  let near = 0;
  let far = maxDistance;

  if (Math.abs(direction.x) < 0.00001) {
    if (start.x < rect.x || start.x > rect.x + rect.width) {
      return null;
    }
  } else {
    const tx1 = (rect.x - start.x) / direction.x;
    const tx2 = (rect.x + rect.width - start.x) / direction.x;
    near = Math.max(near, Math.min(tx1, tx2));
    far = Math.min(far, Math.max(tx1, tx2));
  }

  if (Math.abs(direction.y) < 0.00001) {
    if (start.y < rect.y || start.y > rect.y + rect.height) {
      return null;
    }
  } else {
    const ty1 = (rect.y - start.y) / direction.y;
    const ty2 = (rect.y + rect.height - start.y) / direction.y;
    near = Math.max(near, Math.min(ty1, ty2));
    far = Math.min(far, Math.max(ty1, ty2));
  }

  if (far < near || far < 0 || near > maxDistance) {
    return null;
  }

  const distance = Math.max(0, near);
  return {
    distance,
    x: start.x + direction.x * distance,
    y: start.y + direction.y * distance
  };
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

function damagePlayer(arena, player, amount, tick = 0, attackerId = null) {
  if (!player || player.alive === false) {
    return;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const damage = Math.max(0, amount * effects.damageTakenMultiplier);

  player.lastDamageTick = tick;
  player.health = clamp(player.health - damage, 0, player.maxHealth);
  if (damage > 0 && attackerId && attackerId !== player.id) {
    const attacker = arena?.players?.get(attackerId);
    if (attacker?.alive !== false) {
      attacker.lastHitTargetId = player.id;
      attacker.lastHitTick = tick;
      attacker.lastHitHealth = player.health;
      attacker.lastHitMaxHealth = player.maxHealth;
      attacker.lastHitHealthBars = player.healthBars;
    }
  }
  if (player.health > 0) {
    return;
  }

  killPlayer(player, { arena, tick, killedById: attackerId });
}

function killPlayer(player, options = {}) {
  if (!player || player.alive === false) {
    return;
  }

  awardKill(options.arena, options.killedById, player.id, options.tick);
  player.alive = false;
  player.health = 0;
  player.killedById = options.killedById ?? null;
  player.eliminatedAtTick = options.tick ?? null;
  player.mining = false;
  player.miningRay = null;
  player.miningHoldSeconds = 0;
  player.rayExtension = 0;
  player.buttonTargetId = null;
  player.buttonTargetSeconds = 0;
  player.buttonTargetActivated = false;
  player.thrusting = false;
  clearPendingFacing(player);
  player.vx = 0;
  player.vy = 0;
}

function awardKill(arena, killerId, victimId, tick = 0) {
  if (!arena || !killerId || killerId === victimId) {
    return;
  }

  const killer = arena.players.get(killerId);
  if (!killer) {
    return;
  }

  killer.kills = Math.max(0, Math.floor(Number(killer.kills || 0))) + 1;
  const dropAmount = killDiamondDropAmount(arena, killerId, victimId, tick);
  const before = Math.max(0, Math.floor(Number(killer.resources?.diamond || 0)));
  addPlayerResource(killer, "diamond", dropAmount);
  const after = Math.max(0, Math.floor(Number(killer.resources?.diamond || 0)));
  const gained = after - before;
  if (gained > 0) {
    killer.lastKillDropAmount = gained;
    killer.lastKillDropTick = Number.isFinite(tick) ? tick : arena.tick;
  }
}

function killDiamondDropAmount(arena, killerId, victimId, tick) {
  const random = createSeededRandom(`${arena.seed}:kill-drop:${tick}:${killerId}:${victimId}`);
  return random() < KILL_DROP_SINGLE_DIAMOND_CHANCE ? 1 : 2;
}

function playerMaxHealth(healthBars, gameMode = GAME_MODES.bitspace) {
  const bars = clamp(Math.round(healthBars), 1, ENGINE.player.maxHealthBars);
  return bars * ENGINE.player.healthPerBar * playerHealthScaleForGameMode(gameMode);
}

function playerHealthScaleForGameMode(gameMode) {
  return normalizeGameMode(gameMode) === GAME_MODES.clouds
    ? Math.max(0.01, Number(ENGINE.clouds.healthScale) || 1)
    : 1;
}

function playerHealthBars(player) {
  const effects = aggregateUpgradeEffects(player.upgrades);
  return clamp(
    ENGINE.player.startingHealthBars + effects.healthBarsBonus,
    ENGINE.player.startingHealthBars,
    ENGINE.player.maxHealthBars
  );
}

function playerMiningRayLength(player, effects = aggregateUpgradeEffects(player.upgrades)) {
  return miningRayLengthForGameMode(player.gameMode, effects);
}

function miningRayExtension(mining, holdSeconds) {
  if (!mining) {
    return 0;
  }

  const extendSeconds = ENGINE.mining.rayExtendSeconds;
  return extendSeconds <= 0 ? 1 : clamp(holdSeconds / extendSeconds, 0, 1);
}

function syncPlayerDerivedStats(player) {
  const gameMode = normalizeGameMode(player.gameMode);
  if (gameMode === GAME_MODES.laserTag) {
    player.miningRayCount = 1;
    player.healthBars = ENGINE.laserTag.health;
    player.maxHealth = ENGINE.laserTag.health;
    player.health = clamp(player.health || 0, 0, player.maxHealth);
    return;
  }

  const oldMaxHealth = player.maxHealth || playerMaxHealth(ENGINE.player.startingHealthBars, gameMode);
  const effects = aggregateUpgradeEffects(player.upgrades);
  const healthBars = playerHealthBars(player);
  const maxHealth = playerMaxHealth(healthBars, gameMode);

  player.miningRayCount = clamp(
    Math.round(effects.miningRayCount || 1),
    1,
    ENGINE.mining.maxRayCount
  );
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
  if (rechargePerSecond <= 0 || player.health >= player.maxHealth) {
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
  const gameMode = normalizeGameMode(arena.mode);
  const players = Array.from(arena.players.values()).filter((player) => (
    player.alive &&
    !(gameMode === GAME_MODES.laserTag && laserTagPlayerIsOut(player))
  ));

  for (let aIndex = 0; aIndex < players.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < players.length; bIndex += 1) {
      resolvePlayerPair(players[aIndex], players[bIndex], aIndex + bIndex, gameMode);
    }
  }

  for (const player of players) {
    resolveStaticCollisions(arena, player);
  }
}

function resolvePlayerPair(a, b, fallbackSeed, gameMode = GAME_MODES.bitspace) {
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
    const shipPush = shipPushForGameMode(gameMode);
    impact = Math.max(impact, shipPush);
    const impulse = (-(1 + shipRestitutionForGameMode(gameMode)) * relativeNormalSpeed) / 2;
    a.vx -= nx * impulse;
    a.vy -= ny * impulse;
    b.vx += nx * impulse;
    b.vy += ny * impulse;
  } else {
    const shipPush = shipPushForGameMode(gameMode);
    impact = Math.max(impact, shipPush);
    a.vx -= nx * shipPush;
    a.vy -= ny * shipPush;
    b.vx += nx * shipPush;
    b.vy += ny * shipPush;
  }

  addShake(a, impact);
  addShake(b, impact);
}

function addShake(player, impact) {
  const amount = Math.max(0, impact - ENGINE.collision.shakeThreshold) * ENGINE.collision.shakeScale;
  player.shake = clamp(player.shake + amount, 0, ENGINE.collision.maxShake);
}

function boundaryRestitutionForGameMode(gameMode) {
  return isSubThemedGameMode(gameMode) || gameMode === GAME_MODES.bugs ? 0 : ENGINE.collision.boundaryRestitution;
}

function shipRestitutionForGameMode(gameMode) {
  return isSubThemedGameMode(gameMode) ? 0 : ENGINE.collision.shipRestitution;
}

function shipPushForGameMode(gameMode) {
  return isSubThemedGameMode(gameMode) ? 0 : ENGINE.collision.shipPush;
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
    return {
      x: pocket.spawnX,
      y: pocket.spawnY,
      angle: INITIAL_SPAWN_ANGLE
    };
  }

  const margin = Math.max(RENDER.width, ENGINE.world.sectorSize * 32);
  const maxX = ENGINE.world.width - margin;
  const maxY = ENGINE.world.height - margin;
  const spawns = [
    { x: margin, y: margin },
    { x: (margin + maxX) / 2, y: margin },
    { x: maxX, y: margin },
    { x: maxX, y: (margin + maxY) / 2 },
    { x: maxX, y: maxY },
    { x: (margin + maxX) / 2, y: maxY },
    { x: margin, y: maxY },
    { x: margin, y: (margin + maxY) / 2 }
  ].map((spawn) => ({ ...spawn, angle: INITIAL_SPAWN_ANGLE }));

  return spawns[(number - 1) % spawns.length];
}

function snapshotPlayer(player, tick = 0, mode = GAME_MODES.bitspace) {
  const killDropAge = tick - Number(player.lastKillDropTick ?? Number.NEGATIVE_INFINITY);
  const killDropAmount = Math.max(0, Math.floor(Number(player.lastKillDropAmount || 0)));
  const killDrop = killDropAmount > 0 && killDropAge >= 0 && killDropAge <= KILL_DROP_NOTICE_TICKS
    ? {
        amount: killDropAmount,
        tick: player.lastKillDropTick
      }
    : null;
  const lastHitAge = tick - Number(player.lastHitTick ?? Number.NEGATIVE_INFINITY);
  const lastHit = player.lastHitTargetId && lastHitAge >= 0 && lastHitAge <= LAST_HIT_NOTICE_TICKS
    ? {
        targetId: player.lastHitTargetId,
        tick: player.lastHitTick,
        health: roundForSnapshot(player.lastHitHealth),
        maxHealth: player.lastHitMaxHealth,
        healthBars: player.lastHitHealthBars
      }
    : null;

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
    carHeading: roundForSnapshot(player.carHeading ?? player.angle),
    carSteerAngle: roundForSnapshot(player.carSteerAngle || 0),
    carAngularVelocity: roundForSnapshot(player.carAngularVelocity || 0),
    subReverseActive: Boolean(player.subReverseActive),
    subReverseConeAngle: roundForSnapshot(player.subReverseConeAngle ?? player.angle + Math.PI),
    cloudPitchX: roundForSnapshot(player.cloudPitchX || 0),
    cloudPitchY: roundForSnapshot(player.cloudPitchY || 0),
    bugLegCenterX: roundForSnapshot(player.bugLegCenterX ?? player.x),
    bugLegCenterY: roundForSnapshot(player.bugLegCenterY ?? player.y),
    bugLegs: normalizeGameMode(mode) === GAME_MODES.bugs ? serializeBugLegsForSnapshot(player) : null,
    bugActiveLegIndex: Number.isInteger(player.bugActiveLegIndex) ? player.bugActiveLegIndex : -1,
    bugMoveX: roundForSnapshot(player.bugMoveX || 0),
    bugMoveY: roundForSnapshot(player.bugMoveY || 0),
    bugStepCounter: Number.isInteger(player.bugStepCounter) ? player.bugStepCounter : 0,
    aimAngle: roundForSnapshot(player.aimAngle),
    moveX: roundForSnapshot(player.input?.moveX || 0),
    moveY: roundForSnapshot(player.input?.moveY || 0),
    mining: player.mining,
    miningRayCount: miningRayCountForPlayer(player),
    huckRockCooldownSeconds: roundForSnapshot(player.huckRockCooldownSeconds || 0),
    huckRockEngineCutoutSeconds: roundForSnapshot(player.huckRockEngineCutoutSeconds || 0),
    laserTagCooldownSeconds: roundForSnapshot(player.laserTagCooldownSeconds || 0),
    miningRay: player.miningRay,
    rayExtension: roundForSnapshot(player.rayExtension || 0),
    thrusting: player.thrusting,
    shake: roundForSnapshot(player.shake),
    radius: player.radius,
    upgrades: sanitizeUpgradeState(player.upgrades),
    healthBars: player.healthBars,
    health: roundForSnapshot(player.health),
    maxHealth: player.maxHealth,
    kills: Math.max(0, Math.floor(Number(player.kills || 0))),
    team: player.team || null,
    score: Math.max(0, Math.floor(Number(player.score || 0))),
    laserTagGhost: player.laserTagGhost === true,
    laserTagOutUntilTick: Math.max(0, Math.floor(Number(player.laserTagOutUntilTick || 0))),
    laserTagLastEvent: player.laserTagLastEvent || null,
    killDrop,
    lastHit,
    killedById: player.killedById,
    eliminatedAtTick: player.eliminatedAtTick,
    resources: {
      rock: player.resources.rock,
      ore: player.resources.ore,
      diamond: player.resources.diamond
    },
    stormWarning: player.stormWarning,
    stormDamagePerSecond: roundForSnapshot(player.stormDamagePerSecond || 0),
    alive: player.alive
  };
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function normalizeSignedAngle(angle) {
  const normalized = normalizeAngle(angle);
  return normalized > Math.PI ? normalized - Math.PI * 2 : normalized;
}

function normalizeVector(x, y, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(x, y);
  if (length <= 0.000001) {
    return fallback;
  }

  return {
    x: x / length,
    y: y / length
  };
}

function normalizeGameMode(mode) {
  if (mode === GAME_MODES.cars) {
    return GAME_MODES.cars;
  }
  if (mode === GAME_MODES.subs) {
    return GAME_MODES.subs;
  }
  if (mode === GAME_MODES.subs2) {
    return GAME_MODES.subs2;
  }
  if (mode === GAME_MODES.bugs) {
    return GAME_MODES.bugs;
  }
  if (mode === GAME_MODES.clouds) {
    return GAME_MODES.clouds;
  }
  if (mode === GAME_MODES.octopus) {
    return GAME_MODES.octopus;
  }
  if (mode === GAME_MODES.laserTag) {
    return GAME_MODES.laserTag;
  }
  return GAME_MODES.bitspace;
}
