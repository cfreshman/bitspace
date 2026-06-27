import {
  ENGINE,
  GAME_MODES,
  RENDER,
  miningRayLengthForGameMode,
  miningSecondsForGameMode,
  shipFrictionForGameMode,
  shipThrustForGameMode
} from "./constants.js";
import {
  ASTEROID_TILE,
  STORM_STATE,
  blockingTilesAlongSegment,
  blockingTilesNearCircle,
  circleBlockerOverlap,
  isAsteroidRockTile,
  pointDistanceToBlockerShape,
  raycastAsteroid,
  sweptCircleBlockerHit
} from "./asteroid.js";
import { normalizeInput } from "./input.js";
import { inheritedVelocityLaunchAngle } from "./math.js";
import {
  miningRayClippedSideStartDistance,
  miningRayLaneWithStart,
  miningRayLanesForPlayer,
  miningSideRayOffsetForPlayer,
  miningRaySideStartProbe
} from "./mining.js";
import { findPathNative, planTrajectoryNative } from "./core/bitspace-core.js";
import { aggregateUpgradeEffects, canAffordUpgrade, nextUpgradeCost } from "./upgrades.js";

const BOT_ATTACK_DISTANCE = 210;
const BOT_ENEMY_VISIBILITY_RADIUS_SCALE = 0.9;
const BOT_ENEMY_VISIBILITY_RAY_MARGIN = 0.5;
const BOT_ATTACK_STANDOFF_RAY_SCALE = 0.88;
const BOT_ATTACK_STANDOFF_TOLERANCE = 3;
const BOT_ATTACK_STANDOFF_HIT_MARGIN = 2;
const BOT_ATTACK_MINING_COST_MULTIPLIER = 2.35;
const BOT_ATTACK_MINING_EXTRA_SECONDS = 0.2;
const BOT_ATTACK_FALLBACK_SCAN_TILES = 12;
const BOT_FLEE_HEALTH_RATIO = 0.32;
const BOT_FLEE_MINING_COST_MULTIPLIER = 4;
const BOT_FLEE_MINING_EXTRA_SECONDS = 0.35;
const BOT_DODGE_TIME_SECONDS = 0.9;
const BOT_DODGE_RADIUS = 32;
const BOT_FLEE_PATH_CANDIDATES = 24;
const BOT_FLEE_MINED_TILE_SCORE_PENALTY = 7.5;
const BOT_FLEE_OPEN_ROUTE_TIME_BIAS = 1.18;
const BOT_FLEE_SKIP_MINING_SEARCH_SECONDS = 2.5;
const BOT_FLEE_VISIBLE_ESCAPE_MARGIN = 12;
const BOT_FLEE_MIN_ROUTE_DISTANCE = RENDER.tileSize * 2;
const BOT_FLEE_ROUTE_TIE_SECONDS = 0.18;
const BOT_FLEE_CURRENT_VIEW_ESCAPE_BONUS = 900;
const BOT_FLEE_STORM_CLEARANCE_SCAN_TILES = 6;
const BOT_FLEE_STORM_EDGE_PENALTY = 120;
const BOT_FLEE_OPEN_EXIT_TIME_BIAS = 1.45;
const BOT_FLEE_ENEMY_DANGER_RADIUS_SCALE = 0.92;
const BOT_FLEE_ENEMY_DANGER_MAX_SECONDS = 8.5;
const BOT_FLEE_MEMORY_MIN_HOLD_TICKS = 180;
const BOT_FLEE_MEMORY_SWITCH_SCORE_MARGIN = 120;
const BOT_FLEE_MEMORY_SWITCH_SCORE_RATIO = 1.18;
const BOT_STORM_EDGE_ESCAPE_CLEARANCE_TILES = 2;
const BOT_STORM_TARGET_CLEARANCE_TILES = 4;
const BOT_STORM_EDGE_PATH_COST_SECONDS = 2.4;
const BOT_FLEE_HUCK_MIN_DISTANCE_SCALE = 0.75;
const BOT_FLEE_HUCK_RECOIL_ALIGNMENT = 0.35;
const BOT_PATH_REPLAN_TICKS = 12;
const BOT_THETA_MAX_VISITED = 6000;
const BOT_PATH_COST_MAX_VISITED = 2600;
const BOT_FLEE_PATH_COST_MAX_VISITED = 7000;
const BOT_FLEE_TARGET_REPLAN_TICKS = 60;
const BOT_PATH_DIRECTION_COUNT = 5;
const BOT_PATH_START_DIRECTION = 4;
const BOT_PATH_CONTRACT_MAX_NODES = 48;
const BOT_PATH_POINT_TOLERANCE_PIXELS = 2;
const BOT_PATH_TURN_ARRIVAL_PIXELS = 1.75;
const BOT_PATH_STRAIGHT_ARRIVAL_PIXELS = 4.5;
const BOT_PATH_BRAKE_DISTANCE_PIXELS = 28;
const BOT_PATH_BRAKE_SPEED_SCALE = 0.65;
const BOT_PATH_MAX_OVERSHOOT_DOT = 4;
const BOT_PATH_ATTACH_BUFFER_PIXELS = 1;
const BOT_SEGMENT_LOOKAHEAD_PIXELS = RENDER.tileSize * 0.85;
const BOT_SEGMENT_PROGRESS_EPSILON = 0.35;
const BOT_SEGMENT_LATERAL_DEADBAND_PIXELS = 0.35;
const BOT_SEGMENT_LATERAL_COMPONENT_MAX = 0.34;
const BOT_SEGMENT_LATERAL_GAIN = 0.08;
const BOT_SEGMENT_LATERAL_DAMPING = 0.018;
const BOT_SEGMENT_LATERAL_SPEED_MARGIN = 1.5;
const BOT_SEGMENT_STOP_BUFFER_PIXELS = 2.5;
const BOT_SEGMENT_COAST_MAX_TICKS = 180;
const BOT_SEGMENT_COAST_LATERAL_LIMIT_PIXELS = 4;
const BOT_WALL_AVOID_RADIUS_MARGIN = 1.25;
const BOT_WALL_AVOID_ROCK_BUFFER_PIXELS = 1;
const BOT_TRAJECTORY_SOLVER_STEPS = 12;
const BOT_TRAJECTORY_SOLVER_DT_SECONDS = 1 / ENGINE.tickRate;
const BOT_TRAJECTORY_BEAM_WIDTH = 10;
const BOT_TRAJECTORY_CACHE_MAX_TICKS = 12;
const BOT_TRAJECTORY_CACHE_DIRECTION_DOT = 0.965;
const BOT_TRAJECTORY_HARD_RADIUS_MARGIN = 0;
const BOT_TRAJECTORY_SOFT_CLEARANCE_PIXELS = 1.1;
const BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS = 4;
const BOT_TRAJECTORY_PROGRESS_WEIGHT = 4.8;
const BOT_TRAJECTORY_ALIGNMENT_WEIGHT = 5.2;
const BOT_TRAJECTORY_CLEARANCE_WEIGHT = 0.12;
const BOT_TRAJECTORY_LATE_HIT_WEIGHT = 0.85;
const BOT_TRAJECTORY_BLOCKER_SCAN_PADDING = RENDER.tileSize * 2;
const BOT_MINING_PREFIRE_DISTANCE = 18;
const BOT_MINING_QUEUE_LENGTH = 3;
const BOT_COMBAT_RAY_HOLD_TICKS = 14;
const BOT_STUCK_RESET_TICKS = 50;
const BOT_PATH_STORM_TILE_SECONDS = 2;
const BOT_EXPLORE_CHUNK_PIXELS = 32;
const BOT_EXPLORE_CELL_TILES = Math.max(1, Math.round(BOT_EXPLORE_CHUNK_PIXELS / (RENDER.tileSize || 16)));
const BOT_EXPLORE_TARGET_ARRIVAL_PIXELS = 12;
const BOT_EXPLORE_RETARGET_TICKS = 360;
const BOT_EXPLORE_MIN_HOLD_TICKS = 240;
const BOT_EXPLORE_SWITCH_SCORE_MARGIN = 0.75;
const BOT_EXPLORE_SWITCH_SCORE_RATIO = 1.35;
const BOT_EXPLORE_VISIT_CAP = 20;
const BOT_EXPLORE_MARK_TICKS = 120;
const BOT_EXPLORE_UNKNOWN_ORE_TILES_PER_CELL = 1.35;
const BOT_EXPLORE_UNKNOWN_DIAMOND_TILES_PER_CELL = 0.12;
const BOT_EXPLORE_UNKNOWN_VALUE_SCALE = 0.00145;
const BOT_EXPLORE_REMEMBERED_VALUE_SCALE = 0.0028;
const BOT_EXPLORE_EMPTY_MEMORY_PENALTY = 0.35;
const BOT_EXPLORE_HEAT_HALF_LIFE_TICKS = 60 * 24;
const BOT_EXPLORE_HEAT_MARK = 1;
const BOT_EXPLORE_VISIBLE_HEAT_MARK = 0.55;
const BOT_EXPLORE_HEAT_NEIGHBOR_MARK = 0.28;
const BOT_EXPLORE_HEAT_MAX = 5;
const BOT_EXPLORE_HEAT_MIN = 0.04;
const BOT_EXPLORE_HEAT_TARGET_PENALTY = 0.72;
const BOT_EXPLORE_HEAT_ROUTE_SECONDS = 2.2;
const BOT_EXPLORE_ROAM_CANDIDATES = 48;
const BOT_EXPLORE_ROAM_VALUE_WEIGHT = 80;
const BOT_EXPLORE_ROAM_ROUTE_SECONDS_WEIGHT = 0.08;
const BOT_EXPLORE_ROAM_MINED_TILE_WEIGHT = 0.35;
const BOT_EXPLORE_STORM_CACHE_KEY = "__bitspaceBotExploreStormCells";
const BOT_THREAT_SECTOR_MEMORY_TICKS = 60 * 24;
const BOT_THREAT_SECTOR_AVOID_RADIUS = 2.25;
const BOT_THREAT_SECTOR_SCORE_PENALTY = 2.9;
const BOT_THREAT_SECTOR_ROUTE_RADIUS = 1.35;
const BOT_THREAT_SECTOR_ROUTE_MARGIN_CELLS = 0.35;
const BOT_THREAT_SECTOR_ROUTE_PENALTY_SECONDS = 18;
const BOT_CHASE_MEMORY_TICKS = 60 * 8;
const BOT_THREAT_MEMORY_HALF_LIFE_TICKS = 60 * 3;
const BOT_CHASE_MIN_FLEE_DISTANCE = 18;
const BOT_CHASE_PROJECT_SECTOR_SCALE = 0.65;
const BOT_BASE_RESOURCE_SCORE = Object.freeze({
  ore: 170,
  diamond: 1550
});
const BOT_RESOURCE_NEED_SCORE = Object.freeze({
  ore: 430,
  diamond: 1800
});
const BOT_ORE_OFF_PATH_MULTIPLIER = 0.22;
const BOT_DIAMOND_OFF_PATH_MULTIPLIER = 1.12;
const BOT_ORE_OFF_PATH_MIN_ROUTE_SCORE = 14;
const BOT_ORE_DEPOSIT_AMOUNT_BONUS = 115;
const BOT_DIAMOND_NEED_BONUS = 170;
const BOT_DIAMOND_STRATEGY_MULTIPLIER = Object.freeze({
  auxiliary: 1.35,
  duelist: 1.16,
  miner: 1.06,
  scout: 0.98,
  tank: 0.92
});
const BOT_RESOURCE_KEYS = Object.freeze(["ore", "diamond"]);
const BOT_RESOURCE_STICKY_SCORE_BONUS = 180;
const BOT_RESOURCE_MIN_HOLD_TICKS = 240;
const BOT_RESOURCE_TARGET_REPLAN_TICKS = 150;
const BOT_RESOURCE_TARGET_REPLAN_JITTER_TICKS = 30;
const BOT_TARGET_SCORE_TIE_EPSILON = 4;
const BOT_RESOURCE_ROUTE_CANDIDATE_LIMIT = 5;
const BOT_RESOURCE_ROUTE_SCORE_EPSILON = 12;
const BOT_RESOURCE_ROUTE_SECONDS_WEIGHT = 105;
const BOT_RESOURCE_ROUTE_MINED_TILE_WEIGHT = 22;
const BOT_RESOURCE_DISTANCE_SCORE_PENALTY = Object.freeze({
  ore: 0.45,
  diamond: 1.75
});
const BOT_RESOURCE_DISTANCE_TIE_PIXELS = 2;
const BOT_RESOURCE_DIAMOND_VISIBLE_BONUS = 3200;
const BOT_RESOURCE_ROUTE_SECONDS_PENALTY = 14;
const BOT_AIM_ERROR_MIN_RADIANS = 0.012;
const BOT_AIM_ERROR_MAX_RADIANS = 0.18;
const BOT_AIM_NOISE_TICKS = 14;
const BOT_COMBAT_AIM_SAMPLE_RADIUS = RENDER.tileSize;
const BOT_COMBAT_AIM_SAMPLE_TICKS = ENGINE.tickRate;
const BOT_UPGRADE_PLANS = Object.freeze([
  Object.freeze({
    id: "duelist",
    priority: Object.freeze(["power", "range", "speed", "health", "beams", "repair"])
  }),
  Object.freeze({
    id: "scout",
    priority: Object.freeze(["speed", "range", "power", "health", "repair", "beams"])
  }),
  Object.freeze({
    id: "miner",
    priority: Object.freeze(["range", "power", "speed", "health", "beams", "repair"])
  }),
  Object.freeze({
    id: "tank",
    priority: Object.freeze(["health", "power", "repair", "range", "speed", "beams"])
  }),
  Object.freeze({
    id: "auxiliary",
    priority: Object.freeze(["beams", "power", "range", "speed", "health", "repair"])
  })
]);
const BOT_PROFILE_GLOBAL_KEY = "__BITSPACE_BOT_PROFILE";
const BOT_DEBUG_GLOBAL_KEY = "__BITSPACE_BOT_DEBUG";

export function setBotProfileEnabled(enabled = true) {
  const profile = botProfileState();
  profile.enabled = Boolean(enabled);
  if (profile.enabled) {
    profile.startedAt = botProfileNow();
  }
  return botProfileSnapshot();
}

export function resetBotProfile() {
  const profile = botProfileState();
  profile.entries = Object.create(null);
  profile.startedAt = botProfileNow();
  return botProfileSnapshot();
}

export function botProfileSnapshot() {
  const profile = botProfileState();
  const entries = Object.entries(profile.entries || {})
    .map(([name, entry]) => ({
      name,
      calls: entry.calls || 0,
      ms: Math.round((entry.ms || 0) * 1000) / 1000,
      avg: entry.calls > 0 ? Math.round((entry.ms / entry.calls) * 1000) / 1000 : 0
    }))
    .sort((a, b) => b.ms - a.ms);
  return {
    enabled: profile.enabled === true,
    elapsedMs: Math.round((botProfileNow() - Number(profile.startedAt || botProfileNow())) * 1000) / 1000,
    entries
  };
}

export function botProfileMeasure(name, callback) {
  if (!botProfileActive()) {
    return callback();
  }

  const start = botProfileNow();
  try {
    return callback();
  } finally {
    botProfileAdd(name, botProfileNow() - start);
  }
}

function botProfileState() {
  if (!globalThis[BOT_PROFILE_GLOBAL_KEY] || typeof globalThis[BOT_PROFILE_GLOBAL_KEY] !== "object") {
    globalThis[BOT_PROFILE_GLOBAL_KEY] = {
      enabled: false,
      startedAt: botProfileNow(),
      entries: Object.create(null)
    };
  }
  return globalThis[BOT_PROFILE_GLOBAL_KEY];
}

export function botProfileActive() {
  return globalThis[BOT_PROFILE_GLOBAL_KEY]?.enabled === true;
}

export function setBotDebugEnabled(enabled = true) {
  globalThis[BOT_DEBUG_GLOBAL_KEY] = Boolean(enabled);
  return botDebugEnabled();
}

export function botDebugEnabled() {
  return globalThis[BOT_DEBUG_GLOBAL_KEY] === true;
}

function botProfileNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function botProfileAdd(name, elapsedMs) {
  const profile = botProfileState();
  const key = String(name || "unknown");
  const entry = profile.entries[key] || { calls: 0, ms: 0 };
  entry.calls += 1;
  entry.ms += Number(elapsedMs || 0);
  profile.entries[key] = entry;
}

export function createPilotBotBrain(id, options = {}) {
  const seed = options.seed || id || "bot";
  const random = seededRandom(seed, options.randomState);
  const upgradePlan = botUpgradePlan(options.upgradePlan, random);
  const keepExploreState = botExploreStateCompatible(options);
  const fleeWhenLow = typeof options.fleeWhenLow === "boolean"
    ? options.fleeWhenLow
    : stableUnitNoise(`${seed}:fleeWhenLow`) < 0.5;
  return {
    id,
    seed,
    seq: Number.isFinite(options.seq) ? Math.max(0, Math.floor(options.seq)) : 0,
    wanderTarget: copyTarget(options.wanderTarget),
    targetResource: copyTarget(options.targetResource),
    resourceTargetCache: null,
    fleeTarget: copyTarget(options.fleeTarget),
    rememberedDiamondTarget: copyTarget(options.rememberedDiamondTarget),
    lastThreatSector: copyTarget(options.lastThreatSector),
    chaseMemory: sanitizeChaseMemory(options.chaseMemory),
    upgradePlan: upgradePlan.id,
    aimScore: botAimScoreForSeed(seed, options.aimScore ?? options.aimSkill),
    fleeWhenLow,
    exploreCellTiles: BOT_EXPLORE_CELL_TILES,
    exploreChunkPixels: BOT_EXPLORE_CHUNK_PIXELS,
    exploredCells: keepExploreState ? sanitizeExploredCells(options.exploredCells) : new Map(),
    exploreCellValues: keepExploreState ? sanitizeExploreCellValues(options.exploreCellValues) : new Map(),
    exploreHeat: keepExploreState ? sanitizeExploreHeat(options.exploreHeat) : new Map(),
    lastExploreMarkTick: keepExploreState && Number.isFinite(options.lastExploreMarkTick) ? Math.floor(options.lastExploreMarkTick) : -Infinity,
    lastExploreCellKey: keepExploreState && typeof options.lastExploreCellKey === "string" ? options.lastExploreCellKey : "",
    roamSweepCursor: keepExploreState && Number.isFinite(options.roamSweepCursor) ? Math.floor(options.roamSweepCursor) : 0,
    navGoalKey: "",
    navPath: [],
    navPathSteps: [],
    navPathCursor: 0,
    navSegmentCursor: -1,
    navSegmentProgress: 0,
    navAttachIndex: 0,
    navUpdatedTick: 0,
    navFailedKey: "",
    navFailedUntilTick: 0,
    attackFallbackTarget: null,
    combatAimSample: null,
    combatRayTargetId: "",
    combatRayUntilTick: 0,
    mineQueue: sanitizeMineQueue(options.mineQueue),
    input: options.input ? normalizeInput(options.input) : null,
    lastPlanTick: Number.isFinite(options.lastPlanTick) ? Math.floor(options.lastPlanTick) : null,
    trajectoryPlan: null,
    lastX: null,
    lastY: null,
    stuckTicks: 0,
    lastTargetTick: Number.isFinite(options.lastTargetTick) ? Math.floor(options.lastTargetTick) : 0,
    strafeSign: Number(options.strafeSign) < 0
      ? -1
      : Number(options.strafeSign) > 0
        ? 1
        : random() < 0.5
          ? -1
          : 1,
    random,
    sessionId: validSessionId(options.sessionId) ||
      `bot_${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}_${Math.floor(random() * 1e9).toString(36)}`.slice(0, 64)
  };
}

export function snapshotPilotBotBrain(brain) {
  return {
    id: brain.id,
    seed: brain.seed || brain.id || "bot",
    seq: brain.seq || 0,
    wanderTarget: copyTarget(brain.wanderTarget),
    targetResource: copyTarget(brain.targetResource),
    fleeTarget: copyTarget(brain.fleeTarget),
    rememberedDiamondTarget: copyTarget(brain.rememberedDiamondTarget),
    lastThreatSector: copyTarget(brain.lastThreatSector),
    chaseMemory: sanitizeChaseMemory(brain.chaseMemory),
    upgradePlan: brain.upgradePlan || BOT_UPGRADE_PLANS[0].id,
    aimScore: botAimScoreForSeed(brain.seed || brain.id || "bot", brain.aimScore),
    fleeWhenLow: brain.fleeWhenLow === true,
    exploreCellTiles: BOT_EXPLORE_CELL_TILES,
    exploreChunkPixels: BOT_EXPLORE_CHUNK_PIXELS,
    exploredCells: Array.from(brain.exploredCells || []),
    exploreCellValues: Array.from(brain.exploreCellValues || []),
    exploreHeat: Array.from(brain.exploreHeat || []),
    lastExploreMarkTick: Number.isFinite(brain.lastExploreMarkTick) ? brain.lastExploreMarkTick : 0,
    lastExploreCellKey: brain.lastExploreCellKey || "",
    roamSweepCursor: Number.isFinite(brain.roamSweepCursor) ? Math.floor(brain.roamSweepCursor) : 0,
    mineQueue: sanitizeMineQueue(brain.mineQueue),
    input: brain.input ? normalizeInput(brain.input) : null,
    lastPlanTick: Number.isFinite(brain.lastPlanTick) ? Math.floor(brain.lastPlanTick) : null,
    lastTargetTick: brain.lastTargetTick || 0,
    strafeSign: brain.strafeSign || 1,
    sessionId: brain.sessionId || "",
    randomState: typeof brain.random?.getState === "function"
      ? brain.random.getState()
      : null
  };
}

export function scheduledPilotBotInput(arena, bot, brain) {
  if (brain) {
    brain.scheduledAction = null;
  }
  return null;
}

export function updatePilotBotBrain(arena, bot, brain) {
  if (!botProfileActive()) {
    return updatePilotBotBrainImpl(arena, bot, brain);
  }
  return botProfileMeasure("updatePilotBotBrain", () => updatePilotBotBrainImpl(arena, bot, brain));
}

function updatePilotBotBrainImpl(arena, bot, brain) {
  brain.scheduledAction = null;
  brain.navFailedKey = "";
  brain.navFailedUntilTick = 0;
  markBotExploredRegion(arena, bot, brain);
  updateBotStuckState(bot, brain);
  const nearestThreat = nearestVisibleEnemy(arena, bot);
  const incomingRock = incomingRockThreat(arena, bot);
  const healthRatio = botHealthRatio(bot);
  const shouldFleeThreat = nearestThreat && botShouldFleeLowHealth(bot, brain);
  if (nearestThreat) {
    rememberBotThreatSector(arena, brain, nearestThreat.enemy);
    rememberBotChaseMemory(arena, bot, brain, nearestThreat.enemy);
  }
  const effects = aggregateUpgradeEffects(bot.upgrades);
  const rayReach = botMiningRayReach(bot, effects);
  let aimAngle = Number.isFinite(bot.aimAngle) ? bot.aimAngle : bot.angle;
  let move = { x: 0, y: 0 };
  let mining = false;
  let huckRock = false;
  let huckRockTarget = null;
  let debugMode = "idle";
  let debugTarget = null;
  let debugNav = null;

  if (incomingRock) {
    move = addVector(move, incomingRock.dodge);
  }

  const stormEscapeTarget = botStormInteriorTarget(arena, bot);
  if (stormEscapeTarget) {
    debugMode = "storm-escape";
    debugTarget = stormEscapeTarget;
    const toward = directionBetween(bot, stormEscapeTarget);
    aimAngle = Math.atan2(toward.y, toward.x);
    const nav = botNavigateToPoint(arena, bot, brain, stormEscapeTarget, {
      arriveDistance: Math.max(8, bot.radius * 0.9),
      allowMining: true,
      strictPathMining: true,
      allowUnsafeStorm: stormEscapeTarget.allowUnsafeStorm === true,
      pathLimitToView: false,
      key: `storm-escape:${stormEscapeTarget.index}:${stormEscapeTarget.allowUnsafeStorm ? "unsafe" : "edge"}`,
      rayReach
    });
    debugNav = botDebugNav(nav);
    move = addVector(move, nav.move);
    mining = nav.mining;
    aimAngle = nav.aimAngle ?? aimAngle;
  } else if (nearestThreat && shouldFleeThreat) {
    const away = directionBetween(nearestThreat.enemy, bot);
    const fleeTarget = botFleeTarget(arena, bot, brain, nearestThreat.enemy);
    debugMode = "flee";
    debugTarget = fleeTarget;
    if (fleeTarget) {
      const nav = botNavigateToPoint(arena, bot, brain, fleeTarget, {
        arriveDistance: 24,
        allowMining: true,
        ...botFleePathOptions(arena, brain, nearestThreat.enemy),
        key: `flee:${nearestThreat.enemy.id}:${fleeTarget.index ?? fleeTarget.cellKey ?? ""}`,
        rayReach
      });
      debugNav = botDebugNav(nav);
      move = addVector(move, nav.move);
      mining = nav.mining;
      aimAngle = nav.aimAngle ?? Math.atan2(-away.y, -away.x);
    } else {
      move = addVector(move, away);
      clearBotNav(brain);
      aimAngle = Math.atan2(-away.y, -away.x);
    }
    if (botCanRayThreat(bot, nearestThreat, effects)) {
      mining = true;
      aimAngle = botCombatAimAngle(arena, bot, brain, nearestThreat.enemy, "flee-ray");
      holdBotCombatRay(arena, brain, nearestThreat.enemy);
    }
    huckRockTarget = botFleeHuckRockTarget(arena, bot, brain, nearestThreat, rayReach);
    huckRock = huckRockTarget !== null;
  } else if (nearestThreat) {
    aimAngle = botCombatAimAngle(arena, bot, brain, nearestThreat.enemy, "attack-ray");
    const attackDistance = botAttackStandoffDistance(bot, nearestThreat.enemy, effects);
    const attackHitDistance = botMiningHitDistance(bot, nearestThreat.enemy, effects);
    const attackTolerance = botAttackStandoffTolerance(bot);
    const attackMaxStandoffDistance = botAttackMaxStandoffDistance(attackDistance, attackTolerance, attackHitDistance);
    if (nearestThreat.clear && nearestThreat.distance <= attackMaxStandoffDistance) {
      const standoffMove = botAttackStandoffMove(
        bot,
        brain,
        nearestThreat.enemy,
        nearestThreat.distance,
        attackDistance,
        attackHitDistance
      );
      debugMode = "attack-standoff";
      debugTarget = nearestThreat.enemy;
      debugNav = botDebugNav({ move: standoffMove, mining: false, aimAngle: null });
      move = addVector(move, standoffMove);
    } else {
      const chaseTarget = !nearestThreat.clear
        ? botChaseMemoryTarget(arena, bot, brain)
        : null;
      const attackTarget = chaseTarget || nearestThreat.enemy;
      debugMode = "attack-path";
      debugTarget = attackTarget;
      const nav = botNavigateToPoint(arena, bot, brain, attackTarget, {
        arriveDistance: attackDistance,
        allowMining: true,
        ...botAttackPathOptions(),
        key: `enemy:${nearestThreat.enemy.id}:attack-path:${attackTarget.cellKey ?? attackTarget.index ?? ""}`,
        rayReach
      });
      debugNav = botDebugNav(nav);
      move = addVector(move, nav.move);
      aimAngle = nav.aimAngle ?? aimAngle;
      mining = nav.mining;
      if (!mining && Math.hypot(nav.move.x, nav.move.y) < 0.05) {
        const fallback = botAttackFallbackNavigation(arena, bot, brain, nearestThreat, attackDistance, rayReach);
        if (fallback && (fallback.mining || Math.hypot(fallback.move.x, fallback.move.y) > 0.05)) {
          debugMode = "attack-path";
          debugNav = botDebugNav(fallback);
          move = addVector(move, fallback.move);
          mining = fallback.mining;
          aimAngle = fallback.aimAngle ?? aimAngle;
        }
      }
    }
    if (botCanRayThreat(bot, nearestThreat, effects)) {
      mining = true;
      aimAngle = botCombatAimAngle(arena, bot, brain, nearestThreat.enemy, "attack-ray");
      holdBotCombatRay(arena, brain, nearestThreat.enemy);
    }
    const attackRockTarget = botAimedCombatTarget(arena, bot, brain, nearestThreat.enemy, "attack-rock");
    huckRock = bot.resources.rock > 0 &&
      nearestThreat.distance > rayReach * 0.8 &&
      nearestThreat.distance < BOT_ATTACK_DISTANCE &&
      botCanHuckRockAtTarget(arena, bot, attackRockTarget);
    huckRockTarget = huckRock ? attackRockTarget : null;
  } else {
    const rememberedThreat = botShouldFleeLowHealth(bot, brain)
      ? botRememberedThreatPoint(arena, brain)
      : null;
    if (rememberedThreat) {
      const fleeTarget = botFleeTarget(arena, bot, brain, rememberedThreat);
      debugMode = "flee-memory";
      debugTarget = fleeTarget || rememberedThreat;
      if (fleeTarget) {
        const nav = botNavigateToPoint(arena, bot, brain, fleeTarget, {
          arriveDistance: 24,
          allowMining: true,
          ...botFleePathOptions(arena, brain, rememberedThreat),
          key: `flee-memory:${rememberedThreat.enemyId}:${fleeTarget.index ?? fleeTarget.cellKey ?? ""}`,
          rayReach
        });
        debugNav = botDebugNav(nav);
        move = addVector(move, nav.move);
        mining = nav.mining;
        aimAngle = nav.aimAngle ?? Math.atan2(rememberedThreat.y - bot.y, rememberedThreat.x - bot.x);
      }
    } else {
      const chaseTarget = botChaseMemoryTarget(arena, bot, brain);
      if (chaseTarget && !botShouldFleeLowHealth(bot, brain)) {
        const toward = directionBetween(bot, chaseTarget);
        debugMode = "chase";
        debugTarget = chaseTarget;
        const nav = botNavigateToPoint(arena, bot, brain, chaseTarget, {
          arriveDistance: 20,
          allowMining: true,
          key: `chase:${chaseTarget.enemyId}:${chaseTarget.cellKey || ""}:${Math.round(chaseTarget.x)}:${Math.round(chaseTarget.y)}`,
          rayReach
        });
        debugNav = botDebugNav(nav);
        move = addVector(move, nav.move);
        mining = nav.mining;
        aimAngle = nav.aimAngle ?? Math.atan2(toward.y, toward.x);
      } else {
        const resourceNeeds = botUpgradeResourceNeeds(bot, brain);
        const resource = botResourceTarget(arena, bot, brain, resourceNeeds);
        if (resource) {
          debugMode = "resource";
          debugTarget = resource;
          const toward = directionBetween(bot, resource);
          aimAngle = Math.atan2(toward.y, toward.x);
          if (resource.distance > Math.max(10, rayReach * 0.74) || !resource.clear) {
            const navigationTarget = resource.clear
              ? (resourceApproachPoint(arena, bot, resource) || resource)
              : resource;
            const nav = botNavigateToPoint(arena, bot, brain, navigationTarget, {
              ...botResourcePathOptions(bot),
              arriveDistance: Math.max(8, bot.radius * 0.9),
              key: `resource:${resource.index}:${navigationTarget.index ?? ""}`,
              rayReach
            });
            debugNav = botDebugNav(nav);
            move = addVector(move, nav.move);
            aimAngle = nav.aimAngle ?? aimAngle;
            mining = nav.mining;
          } else {
            clearBotNav(brain);
          }
          if (!mining && resource.distance <= rayReach && resource.clear) {
            const command = botMiningCommandForTile(arena, bot, resource, {
              ...botResourcePathOptions(bot),
              arriveDistance: Math.max(8, bot.radius * 0.9),
              key: `resource-direct:${resource.index}`
            }, rayReach);
            mining = command.mining;
            aimAngle = command.aimAngle ?? aimAngle;
          }
        } else {
          const target = botExploreTarget(arena, bot, brain);
          if (target) {
            debugMode = target.phase === "roam" ? "roam" : "explore";
            debugTarget = target;
            const toward = directionBetween(bot, target);
            const exploreAllowMining = target.clear !== true || target.mineable === true;
            const nav = botNavigateToPoint(arena, bot, brain, target, {
              arriveDistance: 18,
              allowMining: exploreAllowMining,
              strictPathMining: exploreAllowMining,
              ...botExploreHeatPathOptions(arena, brain),
              ...botExploreThreatPathOptions(arena, bot, brain),
              key: `${debugMode}:${target.cellKey || Math.round(target.x)}:${Math.round(target.y)}`,
              rayReach
            });
            debugNav = botDebugNav(nav);
            move = addVector(move, nav.move);
            mining = nav.mining;
            aimAngle = nav.aimAngle ?? Math.atan2(toward.y, toward.x);
          }
        }
      }
    }
  }

  if (brain.stuckTicks > BOT_STUCK_RESET_TICKS) {
    brain.wanderTarget = null;
    brain.targetResource = null;
    brain.resourceTargetCache = null;
    brain.attackFallbackTarget = null;
    clearBotNav(brain);
    brain.stuckTicks = 0;
  }

  const plannedMove = move;
  move = botFullThrottleMove(botWallAwareMove(
    arena,
    bot,
    plannedMove,
    brain
  ));
  if (!mining && Math.hypot(move.x, move.y) <= 0.0001 && Math.hypot(plannedMove.x, plannedMove.y) > 0.0001) {
    const fallbackMove = botFirstPathMove(arena, bot, brain) || plannedMove;
    move = botFullThrottleMove(fallbackMove);
    if (debugNav) {
      debugNav = botDebugNav({ ...debugNav, move });
    }
  }
  brain.seq += 1;
  const input = normalizeInput({
    sessionId: brain.sessionId,
    seq: brain.seq,
    moveX: move.x,
    moveY: move.y,
    aimAngle,
    mining,
    huckRock,
    huckRockTargetX: huckRockTarget?.x ?? null,
    huckRockTargetY: huckRockTarget?.y ?? null,
    interact: false,
    build: false
  });
  brain.input = input;
  brain.lastPlanTick = arena.tick;
  if (botDebugEnabled()) {
    brain.debug = {
      tick: arena.tick,
      mode: debugMode,
      target: botDebugTarget(debugTarget),
      nav: debugNav,
      threat: botDebugThreat(nearestThreat),
      stormPressure: null,
      healthRatio: roundBotDebugNumber(healthRatio),
      rayReach: roundBotDebugNumber(rayReach),
      aimScore: roundBotDebugNumber(brain.aimScore),
      fleeWhenLow: brain.fleeWhenLow === true,
      effects: botDebugEffects(effects),
      input: botDebugInput(input),
      huckRockTarget: botDebugTarget(huckRockTarget),
      stuckTicks: brain.stuckTicks || 0,
      navGoalKey: brain.navGoalKey || "",
      navPathCursor: brain.navPathCursor || 0,
      navAttachIndex: brain.navAttachIndex ?? brain.navPathCursor ?? 0,
      navPathLength: Array.isArray(brain.navPath) ? brain.navPath.length : 0,
      navNextIndex: Array.isArray(brain.navPath) ? brain.navPath[(brain.navPathCursor || 0) + 1] ?? null : null
    };
  } else {
    brain.debug = null;
  }
  return {
    input,
    upgradeId: botUpgradeChoice(bot, brain)
  };
}

export function updatePilotBotLocalPlanner(arena, bot, brain) {
  if (!botProfileActive()) {
    return updatePilotBotLocalPlannerImpl(arena, bot, brain);
  }
  return botProfileMeasure("updatePilotBotLocalPlanner", () => updatePilotBotLocalPlannerImpl(arena, bot, brain));
}

function updatePilotBotLocalPlannerImpl(arena, bot, brain) {
  const previousInput = brain.input || bot.input || {};
  const effects = aggregateUpgradeEffects(bot.upgrades);
  const rayReach = botMiningRayReach(bot, effects);
  const navigation = botExecuteCurrentLocalPlan(arena, bot, brain, rayReach);
  const rawMove = navigation?.move || {
    x: Number(previousInput.moveX || 0),
    y: Number(previousInput.moveY || 0)
  };
  let move = botFullThrottleMove(botWallAwareMove(
    arena,
    bot,
    rawMove,
    brain
  ));
  if (
    navigation?.mining !== true &&
    Math.hypot(move.x, move.y) <= 0.0001 &&
    Math.hypot(Number(rawMove.x || 0), Number(rawMove.y || 0)) > 0.0001
  ) {
    move = botFullThrottleMove(botFirstPathMove(arena, bot, brain) || rawMove);
  }
  const heldCombatRay = heldBotCombatRay(arena, bot, brain, effects);
  let mining = navigation?.mining === true || Boolean(previousInput.mining) || heldCombatRay !== null;
  let aimAngle = Number.isFinite(navigation?.aimAngle)
    ? navigation.aimAngle
    : Number.isFinite(previousInput.aimAngle)
      ? previousInput.aimAngle
      : Number.isFinite(bot.aimAngle)
        ? bot.aimAngle
        : Number.isFinite(bot.angle)
          ? bot.angle
          : 0;
  if (heldCombatRay) {
    mining = true;
    aimAngle = botCombatAimAngle(
      arena,
      bot,
      brain,
      heldCombatRay.enemy,
      botShouldFleeLowHealth(bot, brain) ? "flee-ray" : "attack-ray"
    );
  }

  brain.seq += 1;
  const input = normalizeInput({
    sessionId: brain.sessionId,
    seq: brain.seq,
    moveX: move.x,
    moveY: move.y,
    aimAngle,
    mining,
    huckRock: false,
    huckRockTargetX: null,
    huckRockTargetY: null,
    interact: false,
    build: false
  });
  brain.input = input;
  if (botDebugEnabled()) {
    brain.debug = {
      ...(brain.debug || {}),
      tick: arena.tick,
      input: botDebugInput(input),
      nav: navigation ? botDebugNav({ ...navigation, move }) : brain.debug?.nav ?? null,
      stuckTicks: brain.stuckTicks || 0,
      navPathCursor: brain.navPathCursor || 0,
      navAttachIndex: brain.navAttachIndex ?? brain.navPathCursor ?? 0,
      navPathLength: Array.isArray(brain.navPath) ? brain.navPath.length : 0,
      navNextIndex: Array.isArray(brain.navPath) ? brain.navPath[(brain.navPathCursor || 0) + 1] ?? null : null
    };
  } else {
    brain.debug = null;
  }
  return {
    input,
    upgradeId: null
  };
}

export function botUpgradeChoice(bot, brain = null) {
  for (const upgradeId of botUpgradePriority(bot, brain)) {
    const cost = nextUpgradeCost(bot.upgrades, upgradeId);
    if (canAffordUpgrade(bot.resources, cost)) {
      return upgradeId;
    }
  }

  return null;
}

function botDebugNav(nav) {
  if (!nav) {
    return null;
  }

  return {
    moveX: roundBotDebugNumber(nav.move?.x || 0),
    moveY: roundBotDebugNumber(nav.move?.y || 0),
    mining: nav.mining === true,
    aimAngle: roundBotDebugNumber(nav.aimAngle)
  };
}

function botDebugTarget(target) {
  if (!target) {
    return null;
  }

  return {
    id: target.id ?? target.enemyId ?? undefined,
    index: Number.isInteger(target.index) ? target.index : undefined,
    cellKey: target.cellKey ?? undefined,
    resource: target.resource ?? undefined,
    amount: Number.isFinite(target.amount) ? target.amount : undefined,
    need: Number.isFinite(target.need) ? target.need : undefined,
    needed: typeof target.needed === "boolean" ? target.needed : undefined,
    utility: roundBotDebugNumber(target.utility),
    x: roundBotDebugNumber(target.x),
    y: roundBotDebugNumber(target.y),
    distance: roundBotDebugNumber(target.distance),
    clear: typeof target.clear === "boolean" ? target.clear : undefined,
    mineable: typeof target.mineable === "boolean" ? target.mineable : undefined,
    cached: target.cached === true ? true : undefined,
    score: roundBotDebugNumber(target.score),
    routeScore: roundBotDebugNumber(target.routeScore),
    routeSeconds: roundBotDebugNumber(target.routeSeconds),
    minedTiles: Number.isFinite(target.minedTiles) ? target.minedTiles : undefined,
    ageTicks: Number.isFinite(target.ageTicks) ? Math.floor(target.ageTicks) : undefined,
    decay: roundBotDebugNumber(target.decay),
    escapedVisibleArea: typeof target.escapedVisibleArea === "boolean" ? target.escapedVisibleArea : undefined,
    escapedCurrentVisibleArea: typeof target.escapedCurrentVisibleArea === "boolean" ? target.escapedCurrentVisibleArea : undefined,
    currentVisibleMargin: roundBotDebugNumber(target.currentVisibleMargin),
    stormClearanceTiles: Number.isFinite(target.stormClearanceTiles) ? target.stormClearanceTiles : undefined,
    exploreHeat: roundBotDebugNumber(target.exploreHeat),
    roamScore: roundBotDebugNumber(target.roamScore),
    sweepIndex: Number.isFinite(target.sweepIndex) ? Math.floor(target.sweepIndex) : undefined,
    sweepDistance: Number.isFinite(target.sweepDistance) ? Math.floor(target.sweepDistance) : undefined,
    safeNeighborCount: Number.isFinite(target.safeNeighborCount) ? target.safeNeighborCount : undefined
  };
}

function botDebugThreat(threat) {
  if (!threat?.enemy) {
    return null;
  }

  return {
    id: threat.enemy.id,
    distance: roundBotDebugNumber(threat.distance),
    clear: threat.clear === true,
    x: roundBotDebugNumber(threat.enemy.x),
    y: roundBotDebugNumber(threat.enemy.y)
  };
}

function botHealthRatio(player) {
  const maxHealth = Number(player?.maxHealth || 0);
  return maxHealth > 0 ? clamp(Number(player?.health || 0) / maxHealth, 0, 1) : 1;
}

function botInFleeHealth(bot) {
  return botHealthRatio(bot) <= BOT_FLEE_HEALTH_RATIO;
}

function botShouldFleeLowHealth(bot, brain) {
  return brain?.fleeWhenLow === true && botInFleeHealth(bot);
}

function botDebugEffects(effects) {
  return {
    thrust: roundBotDebugNumber(effects?.thrustMultiplier),
    range: roundBotDebugNumber(effects?.rayLengthBonus),
    miningPower: roundBotDebugNumber(effects?.miningPowerMultiplier),
    damage: roundBotDebugNumber(effects?.rayDamageMultiplier),
    rays: roundBotDebugNumber(effects?.miningRayCount),
    healthBars: roundBotDebugNumber(effects?.healthBarsBonus),
    regen: roundBotDebugNumber(effects?.healthRechargePerSecond)
  };
}

function botDebugInput(input) {
  return {
    seq: input.seq,
    moveX: roundBotDebugNumber(input.moveX),
    moveY: roundBotDebugNumber(input.moveY),
    aimAngle: roundBotDebugNumber(input.aimAngle),
    mining: input.mining,
    huckRock: input.huckRock
  };
}

function roundBotDebugNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function botUpgradePlan(planId, random) {
  const existing = BOT_UPGRADE_PLANS.find((plan) => plan.id === planId);
  if (existing) {
    return existing;
  }

  return BOT_UPGRADE_PLANS[Math.floor(random() * BOT_UPGRADE_PLANS.length)] || BOT_UPGRADE_PLANS[0];
}

function botUpgradePriority(bot, brain) {
  const priority = botUpgradePlan(brain?.upgradePlan, () => 0).priority;
  if (!botNeedsFirstRepair(bot)) {
    return priority;
  }

  return ["repair", ...priority.filter((upgradeId) => upgradeId !== "repair")];
}

function botNeedsFirstRepair(bot) {
  return Number(bot?.health || 0) < Number(bot?.maxHealth || 0) - 0.001 &&
    Number(bot?.upgrades?.repair || 0) < 1;
}

function nearestVisibleEnemy(arena, bot) {
  if (!botProfileActive()) {
    return nearestVisibleEnemyImpl(arena, bot);
  }
  return botProfileMeasure("nearestVisibleEnemy", () => nearestVisibleEnemyImpl(arena, bot));
}

function nearestVisibleEnemyImpl(arena, bot) {
  let selected = null;
  const visibleRadius = botHumanVisibleRadius();
  for (const enemy of arena.players.values()) {
    if (!enemy.alive || enemy.id === bot.id) {
      continue;
    }

    const distance = distanceBetween(bot, enemy);
    if (distance > visibleRadius + (enemy.radius || ENGINE.ship.radius)) {
      continue;
    }

    const visibility = botEnemyVisibility(arena, bot, enemy, visibleRadius, distance);
    if (!visibility.visible) {
      continue;
    }

    if (!selected || distance < selected.distance) {
      selected = { enemy, distance, clear: visibility.clear };
    }
  }

  return selected;
}

function botEnemyVisibility(arena, bot, enemy, visibleRadius, centerDistance = distanceBetween(bot, enemy)) {
  const radius = enemy.radius || ENGINE.ship.radius;
  if (botEnemyCenterLineClear(arena, bot, enemy, centerDistance, visibleRadius)) {
    return { visible: true, clear: true };
  }

  const wide = Math.max(1, radius * BOT_ENEMY_VISIBILITY_RADIUS_SCALE);
  const diagonal = wide * Math.SQRT1_2;
  if (
    botEnemyVisibilitySampleClear(arena, bot, enemy.x - diagonal, enemy.y - diagonal, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x + diagonal, enemy.y - diagonal, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x + diagonal, enemy.y + diagonal, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x - diagonal, enemy.y + diagonal, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x - wide, enemy.y, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x + wide, enemy.y, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x, enemy.y - wide, visibleRadius) ||
    botEnemyVisibilitySampleClear(arena, bot, enemy.x, enemy.y + wide, visibleRadius)
  ) {
    return { visible: true, clear: false };
  }

  return { visible: false, clear: false };
}

function botEnemyCenterLineClear(arena, bot, enemy, centerDistance = distanceBetween(bot, enemy), visibleRadius = botHumanVisibleRadius()) {
  const radius = enemy.radius || ENGINE.ship.radius;
  return centerDistance <= visibleRadius &&
    lineOfSight(arena, bot, enemy, Math.max(0, centerDistance - radius));
}

function botEnemyVisibilitySampleClear(arena, bot, sampleX, sampleY, visibleRadius) {
  const dx = sampleX - bot.x;
  const dy = sampleY - bot.y;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq > visibleRadius * visibleRadius) {
    return false;
  }

  const distance = Math.sqrt(distanceSq);
  return lineOfSight(
    arena,
    bot,
    { x: sampleX, y: sampleY },
    Math.max(0, distance - BOT_ENEMY_VISIBILITY_RAY_MARGIN)
  );
}

function botAttackStandoffDistance(bot, enemy, effects) {
  const rayLength = miningRayLengthForGameMode(bot?.gameMode, effects);
  return (bot.radius || ENGINE.ship.radius) +
    (enemy.radius || ENGINE.ship.radius) +
    rayLength * BOT_ATTACK_STANDOFF_RAY_SCALE;
}

function botAttackMaxStandoffDistance(desiredDistance, tolerance, hitDistance) {
  return Math.max(
    1,
    Math.min(
      desiredDistance + tolerance,
      hitDistance - BOT_ATTACK_STANDOFF_HIT_MARGIN
    )
  );
}

function botAttackStandoffTolerance(bot) {
  return Math.max(BOT_ATTACK_STANDOFF_TOLERANCE, (bot.radius || ENGINE.ship.radius) * 0.5);
}

function botMiningRayReach(bot, effects = aggregateUpgradeEffects(bot?.upgrades)) {
  return (bot?.radius || ENGINE.ship.radius) +
    miningRayLengthForGameMode(bot?.gameMode, effects);
}

function botMiningHitDistance(bot, target, effects) {
  return botMiningRayReach(bot, effects) +
    (target.radius || ENGINE.ship.radius);
}

function botCanRayThreat(bot, threat, effects) {
  return threat?.clear === true &&
    threat.distance <= botMiningHitDistance(bot, threat.enemy, effects);
}

function holdBotCombatRay(arena, brain, enemy) {
  if (!brain || !enemy?.id) {
    return;
  }

  brain.combatRayTargetId = enemy.id;
  brain.combatRayUntilTick = arena.tick + BOT_COMBAT_RAY_HOLD_TICKS;
}

function heldBotCombatRay(arena, bot, brain, effects) {
  if (
    !brain?.combatRayTargetId ||
    !Number.isFinite(brain.combatRayUntilTick) ||
    arena.tick > brain.combatRayUntilTick
  ) {
    return null;
  }

  const enemy = arena.players.get(brain.combatRayTargetId);
  if (!enemy?.alive || enemy.id === bot.id) {
    return null;
  }

  const distance = distanceBetween(bot, enemy);
  if (distance > botMiningHitDistance(bot, enemy, effects)) {
    return null;
  }
  if (!botEnemyCenterLineClear(arena, bot, enemy, distance)) {
    return null;
  }

  return { enemy, distance };
}

function botCombatAimAngle(arena, bot, brain, target, kind) {
  void kind;
  return botCombatAimAngleFromSample(arena, bot, brain, target);
}

function botAimedCombatTarget(arena, bot, brain, target, kind) {
  void kind;
  if (!target) {
    return { x: bot.x, y: bot.y };
  }

  const angle = botCombatAimAngleFromSample(arena, bot, brain, target);
  return pointAtAngle(bot, angle, Math.max(RENDER.tileSize, distanceBetween(bot, target)));
}

function botCombatAimAngleFromSample(arena, bot, brain, target) {
  if (!target) {
    return Number.isFinite(bot?.aimAngle) ? bot.aimAngle : Number.isFinite(bot?.angle) ? bot.angle : 0;
  }

  const centerAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
  const tick = Number.isFinite(arena?.tick) ? arena.tick : Number(brain?.seq || 0);
  const bucket = Math.floor(tick / BOT_COMBAT_AIM_SAMPLE_TICKS);
  const targetKey = target.id || `${Math.round(Number(target.x || 0))},${Math.round(Number(target.y || 0))}`;
  const sampleKey = `${targetKey}:${bucket}`;
  if (brain?.combatAimSample?.key === sampleKey && Number.isFinite(brain.combatAimSample.offset)) {
    return centerAngle + brain.combatAimSample.offset;
  }

  const seed = `${brain?.seed || brain?.id || bot?.id || "bot"}:combat-aim:${sampleKey}`;
  const radius = Math.sqrt(stableUnitNoise(`${seed}:radius`)) * BOT_COMBAT_AIM_SAMPLE_RADIUS;
  const sampleAngle = stableUnitNoise(`${seed}:angle`) * Math.PI * 2;
  const sampledTarget = {
    x: target.x + Math.cos(sampleAngle) * radius,
    y: target.y + Math.sin(sampleAngle) * radius
  };
  const sampledAngle = Math.atan2(sampledTarget.y - bot.y, sampledTarget.x - bot.x);
  const offset = normalizeSignedAngle(sampledAngle - centerAngle);
  if (brain) {
    brain.combatAimSample = { key: sampleKey, offset };
  }
  return centerAngle + offset;
}

function botCombatAimErrorRadians(bot, brain, target, kind) {
  const score = botAimScoreForSeed(brain?.seed || brain?.id || bot?.id || "bot", brain?.aimScore);
  const maxError = BOT_AIM_ERROR_MIN_RADIANS +
    (1 - score) * (BOT_AIM_ERROR_MAX_RADIANS - BOT_AIM_ERROR_MIN_RADIANS);
  const bucket = Math.floor(Number(brain?.seq || 0) / BOT_AIM_NOISE_TICKS);
  const targetKey = target?.id || `${Math.round(Number(target?.x || 0))},${Math.round(Number(target?.y || 0))}`;
  const noise = stableUnitNoise(`${brain?.seed || brain?.id || bot?.id || "bot"}:${kind}:${targetKey}:${bucket}`);
  return (noise * 2 - 1) * maxError;
}

function botAimScoreForSeed(seed, value = null) {
  if (Number.isFinite(value)) {
    return clamp(Number(value), 0, 1);
  }

  const noise = stableUnitNoise(`${seed || "bot"}:aim`);
  return 0.56 + noise * 0.36;
}

function botAttackStandoffMove(bot, brain, enemy, distance, desiredDistance, hitDistance) {
  const toward = directionBetween(bot, enemy);
  const tolerance = botAttackStandoffTolerance(bot);
  const targetDistance = Math.min(
    desiredDistance,
    hitDistance - BOT_ATTACK_STANDOFF_HIT_MARGIN - tolerance * 0.5
  );
  const minDistance = Math.max(1, targetDistance - tolerance);
  const maxDistance = botAttackMaxStandoffDistance(targetDistance, tolerance, hitDistance);
  brain.strafeSign = 1;
  if (distance > maxDistance) {
    return toward;
  }
  if (distance < minDistance) {
    return scaleVector(toward, -1);
  }

  const radial = clamp((distance - targetDistance) / Math.max(1, tolerance), -0.85, 0.85);
  const orbit = 0.72 * clamp(
    1 - Math.abs(distance - targetDistance) / Math.max(1, tolerance * 1.35),
    0.2,
    1
  );
  return normalizeVector({
    x: toward.x * radial - toward.y * orbit,
    y: toward.y * radial + toward.x * orbit
  });
}

function botAttackFallbackNavigation(arena, bot, brain, threat, attackDistance, rayReach) {
  const enemy = threat?.enemy;
  if (!enemy) {
    return null;
  }

  if (threat.clear !== true) {
    const blocker = mineableBlockerTowardPoint(arena, bot, enemy, rayReach);
    if (blocker) {
      return {
        move: { x: 0, y: 0 },
        ...botMiningCommandForTile(arena, bot, blocker, {
          allowMining: true,
          key: `enemy:${enemy.id}:los-blocker`
        }, rayReach)
      };
    }
  }

  const target = botAttackFallbackTarget(arena, bot, brain, threat, attackDistance);
  if (!target) {
    return null;
  }

  return botNavigateToPoint(arena, bot, brain, target, {
    arriveDistance: Math.max(10, bot.radius),
    allowMining: false,
    key: `enemy:${enemy.id}:fallback:${target.index}`,
    rayReach
  });
}

function botAttackFallbackTarget(arena, bot, brain, threat, attackDistance) {
  const enemy = threat?.enemy;
  if (!enemy) {
    return null;
  }

  const cached = brain.attackFallbackTarget;
  if (
    cached &&
    cached.enemyId === enemy.id &&
    arena.tick - (cached.tick || 0) < BOT_PATH_REPLAN_TICKS &&
    botExploreTargetUsable(arena, cached, bot, brain) &&
    distanceBetween(bot, cached) > Math.max(8, bot.radius)
  ) {
    return cached;
  }

  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || 16;
  const originTileX = Math.floor(bot.x / tileSize);
  const originTileY = Math.floor(bot.y / tileSize);
  let selected = null;

  for (let radius = 2; radius <= BOT_ATTACK_FALLBACK_SCAN_TILES; radius += 1) {
    for (let y = originTileY - radius; y <= originTileY + radius; y += 1) {
      for (let x = originTileX - radius; x <= originTileX + radius; x += 1) {
        if (Math.max(Math.abs(x - originTileX), Math.abs(y - originTileY)) !== radius) {
          continue;
        }

        const index = tileIndexAtTile(asteroid, x, y);
        if (!botPathTileAllowed(arena, index, { allowMining: false })) {
          continue;
        }

        const point = botNavPointForIndex(arena, index, botPathOptions(bot, { allowMining: false }));
        const distanceToEnemy = distanceBetween(point, enemy);
        const distanceFromBot = distanceBetween(bot, point);
        const clear = lineOfSight(arena, point, enemy, Math.max(0, distanceToEnemy - (enemy.radius || ENGINE.ship.radius)));
        const distanceError = Math.abs(distanceToEnemy - attackDistance);
        const currentError = Math.abs(threat.distance - attackDistance);
        const improvement = currentError - distanceError;
        const score = (clear ? 7 : 0) +
          improvement * 0.055 +
          (distanceToEnemy > threat.distance ? 0.65 : 0) -
          distanceFromBot * 0.012 +
          brain.random() * 0.08;

        if (!selected || score > selected.score) {
          selected = {
            ...point,
            index,
            enemyId: enemy.id,
            tick: arena.tick,
            score
          };
        }
      }
    }

    if (selected && selected.score > 1.5) {
      break;
    }
  }

  brain.attackFallbackTarget = selected;
  return selected;
}

function botFleeHuckRockTarget(arena, bot, brain, threat, rayReach) {
  const enemy = threat?.enemy;
  if (!enemy || !enemy.alive || Number(bot.resources?.rock || 0) <= 0) {
    return null;
  }

  const distance = Number.isFinite(threat.distance)
    ? threat.distance
    : distanceBetween(bot, enemy);
  const minDistance = Math.max(
    rayReach * BOT_FLEE_HUCK_MIN_DISTANCE_SCALE,
    (bot.radius || ENGINE.ship.radius) +
      (enemy.radius || ENGINE.ship.radius) +
      ENGINE.huckRock.spawnOffset * 0.5
  );
  if (distance < minDistance) {
    return null;
  }

  const aimedTarget = botAimedCombatTarget(arena, bot, brain, enemy, "flee-rock");
  const shot = botHuckRockShot(arena, bot, aimedTarget);
  if (!shot?.clear) {
    return null;
  }

  const towardEnemy = directionBetween(bot, enemy);
  const recoilAlignment = shot.launchDirection.x * towardEnemy.x + shot.launchDirection.y * towardEnemy.y;
  if (recoilAlignment < BOT_FLEE_HUCK_RECOIL_ALIGNMENT) {
    return null;
  }

  return {
    x: aimedTarget.x,
    y: aimedTarget.y
  };
}

function botCanHuckRockAtTarget(arena, bot, target) {
  return botHuckRockShot(arena, bot, target)?.clear === true;
}

function botHuckRockShot(arena, bot, target) {
  if (!target) {
    return null;
  }

  if (!arena.asteroid) {
    const fallbackAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    return {
      clear: true,
      angle: fallbackAngle,
      launchDirection: {
        x: Math.cos(fallbackAngle),
        y: Math.sin(fallbackAngle)
      }
    };
  }

  const config = ENGINE.huckRock;
  const fallbackAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
  const angle = inheritedVelocityLaunchAngle({
    originX: bot.x,
    originY: bot.y,
    inheritedVx: bot.vx || 0,
    inheritedVy: bot.vy || 0,
    targetX: target.x,
    targetY: target.y,
    launchSpeed: config.speed,
    spawnOffset: config.spawnOffset,
    fallbackAngle
  });
  const launchDirection = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const startX = bot.x + launchDirection.x * config.spawnOffset;
  const startY = bot.y + launchDirection.y * config.spawnOffset;
  const rockVx = (bot.vx || 0) + launchDirection.x * config.speed;
  const rockVy = (bot.vy || 0) + launchDirection.y * config.speed;
  const speedSq = rockVx * rockVx + rockVy * rockVy;
  if (speedSq <= 0.0001) {
    return null;
  }

  const targetProjectionSeconds = ((target.x - startX) * rockVx + (target.y - startY) * rockVy) / speedSq;
  if (targetProjectionSeconds <= 0) {
    return null;
  }

  const closestX = startX + rockVx * targetProjectionSeconds;
  const closestY = startY + rockVy * targetProjectionSeconds;
  const targetRadius = target.radius || ENGINE.ship.radius;
  if (Math.hypot(target.x - closestX, target.y - closestY) > targetRadius + config.radius + 1) {
    return null;
  }

  const travelDistance = Math.sqrt(speedSq) * targetProjectionSeconds;
  const clearDistance = Math.max(0, travelDistance - targetRadius - config.radius * 0.5);
  const endX = startX + (rockVx / Math.sqrt(speedSq)) * clearDistance;
  const endY = startY + (rockVy / Math.sqrt(speedSq)) * clearDistance;
  return {
    clear: !botSegmentHitsBlockingTile(arena, startX, startY, endX, endY, config.radius),
    angle,
    launchDirection,
    targetProjectionSeconds
  };
}

function incomingRockThreat(arena, bot) {
  if (!botProfileActive()) {
    return incomingRockThreatImpl(arena, bot);
  }
  return botProfileMeasure("incomingRockThreat", () => incomingRockThreatImpl(arena, bot));
}

function incomingRockThreatImpl(arena, bot) {
  let selected = null;
  for (const entity of arena.entities.values()) {
    if (entity.type !== "huckRock" || entity.fragment || entity.ownerId === bot.id) {
      continue;
    }

    const relativeX = bot.x - entity.x;
    const relativeY = bot.y - entity.y;
    const speedSq = entity.vx * entity.vx + entity.vy * entity.vy;
    if (speedSq <= 0.0001) {
      continue;
    }

    const t = clamp((relativeX * entity.vx + relativeY * entity.vy) / speedSq, 0, BOT_DODGE_TIME_SECONDS);
    const closestX = entity.x + entity.vx * t;
    const closestY = entity.y + entity.vy * t;
    const dx = bot.x - closestX;
    const dy = bot.y - closestY;
    const distance = Math.hypot(dx, dy);
    if (distance > BOT_DODGE_RADIUS) {
      continue;
    }

    const travel = Math.hypot(entity.vx, entity.vy) || 1;
    const dodge = normalizeVector({
      x: -entity.vy / travel + dx * 0.03,
      y: entity.vx / travel + dy * 0.03
    });
    if (!selected || t < selected.t) {
      selected = { t, dodge };
    }
  }

  return selected;
}

function botResourceTarget(arena, bot, brain, resourceNeeds = botUpgradeResourceNeeds(bot, brain)) {
  if (!botProfileActive()) {
    return botResourceTargetImpl(arena, bot, brain, resourceNeeds);
  }
  return botProfileMeasure("botResourceTarget", () => botResourceTargetImpl(arena, bot, brain, resourceNeeds));
}

function botResourceTargetImpl(arena, bot, brain, resourceNeeds = botUpgradeResourceNeeds(bot, brain)) {
  const candidates = [];
  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || 16;
  const originTileX = Math.floor(bot.x / tileSize);
  const originTileY = Math.floor(bot.y / tileSize);
  const radiusTiles = Math.ceil(botHumanVisibleRadius() / tileSize);
  const committedTarget = botCommittedResourceTarget(arena, bot, brain, resourceNeeds);
  if (committedTarget && Number.isInteger(bot.miningTargetIndex) && committedTarget.index === bot.miningTargetIndex) {
    brain.targetResource = botResourceTargetMemory(committedTarget, arena.tick, brain);
    brain.resourceTargetCache = cacheBotResourceTarget(committedTarget, arena.tick, brain);
    if (committedTarget.resource === "diamond") {
      brain.rememberedDiamondTarget = botResourceTargetMemory(committedTarget, arena.tick, brain);
    }
    return committedTarget;
  }

  const oreDeposits = collectVisibleOreDeposits(arena, bot, brain, resourceNeeds, originTileX, originTileY, radiusTiles);

  for (let y = originTileY - radiusTiles; y <= originTileY + radiusTiles; y += 1) {
    for (let x = originTileX - radiusTiles; x <= originTileX + radiusTiles; x += 1) {
      if (x < 0 || y < 0 || x >= asteroid.widthTiles || y >= asteroid.heightTiles) {
        continue;
      }
      const index = y * asteroid.widthTiles + x;
      const candidate = resourceTargetForIndex(arena, bot, brain, resourceNeeds, oreDeposits, index);
      if (!candidate) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  if (committedTarget && !candidates.some((candidate) => candidate.index === committedTarget.index)) {
    candidates.push(committedTarget);
  }

  const cachedTarget = botCachedResourceTarget(arena, bot, brain, resourceNeeds);
  if (cachedTarget && !candidates.some((candidate) => candidate.index === cachedTarget.index)) {
    candidates.push(cachedTarget);
  }

  const rememberedDiamond = botRememberedDiamondTarget(arena, bot, brain, resourceNeeds);
  if (rememberedDiamond && !candidates.some((candidate) => candidate.index === rememberedDiamond.index)) {
    candidates.push(rememberedDiamond);
  }

  const diamondCandidates = candidates.filter((candidate) => candidate.resource === "diamond");
  const eligibleCandidates = diamondCandidates.length > 0
    ? diamondCandidates
    : candidates.filter(botResourceTargetEligible);
  if (eligibleCandidates.length <= 0) {
    brain.targetResource = null;
    brain.resourceTargetCache = null;
    return null;
  }

  const selected = botBestRoutedResourceTarget(arena, bot, brain, eligibleCandidates, arena.tick);
  brain.targetResource = selected ? botResourceTargetMemory(selected, arena.tick, brain) : null;
  brain.resourceTargetCache = selected ? cacheBotResourceTarget(selected, arena.tick, brain) : null;
  if (selected?.resource === "diamond") {
    brain.rememberedDiamondTarget = botResourceTargetMemory(selected, arena.tick, brain);
  }
  return selected;
}

function botResourceTargetEligible(candidate) {
  return candidate?.resource === "diamond" ||
    candidate?.needed === true;
}

function botRememberedDiamondTarget(arena, bot, brain, resourceNeeds) {
  const index = brain?.rememberedDiamondTarget?.index;
  if (!Number.isInteger(index)) {
    return null;
  }

  const target = botStickyResourceTargetForIndex(arena, bot, brain, resourceNeeds, index, {
    allowRemembered: true
  });
  if (!target || target.resource !== "diamond") {
    brain.rememberedDiamondTarget = null;
    return null;
  }

  return {
    ...target,
    remembered: true
  };
}

function botCachedResourceTarget(arena, bot, brain, resourceNeeds) {
  const cache = brain.resourceTargetCache;
  if (
    !cache ||
    !Number.isInteger(cache.index) ||
    !Number.isFinite(cache.tick)
  ) {
    brain.resourceTargetCache = null;
    return null;
  }

  const activeTarget = brain?.targetResource?.index === cache.index;
  if (arena.tick > botResourceTargetCacheExpiresTick(cache) && !activeTarget) {
    brain.resourceTargetCache = null;
    return null;
  }

  const target = botStickyResourceTargetForIndex(arena, bot, brain, resourceNeeds, cache.index, {
    allowRemembered: true
  });
  if (!target || target.resource !== cache.resource) {
    brain.resourceTargetCache = null;
    return null;
  }

  const cached = {
    ...target,
    cached: true,
    score: Number.isFinite(cache.score) ? cache.score : target.score,
    expectedSeconds: cache.expectedSeconds
  };

  if (target.resource === "ore" && Array.isArray(cache.indexes)) {
    const indexes = cache.indexes.filter((index) => (
      Number.isInteger(index) &&
      index >= 0 &&
      index < arena.asteroid.tiles.length &&
      arena.asteroid.tiles[index] === ASTEROID_TILE.ore &&
      botSafeStormTile(arena, index)
    ));
    if (indexes.length > 0) {
      cached.indexes = indexes;
      cached.depositTiles = indexes.length;
      cached.amount = indexes.reduce((total, index) => (
        total + botResourceAmountForTile(arena.asteroid, index, ASTEROID_TILE.ore)
      ), 0);
      cached.utility = botResourceUtility("ore", cached.amount, resourceNeeds);
    }
  }

  return cached;
}

function cacheBotResourceTarget(target, tick, brain) {
  if (!target || !Number.isInteger(target.index)) {
    return null;
  }

  const jitter = stablePositiveHash(`${brain?.id || ""}:${target.index}`) % (BOT_RESOURCE_TARGET_REPLAN_JITTER_TICKS + 1);
  const previous = brain?.resourceTargetCache;
  const firstTick = previous?.index === target.index && Number.isFinite(previous.firstTick)
    ? previous.firstTick
    : tick;
  return {
    index: target.index,
    resource: target.resource || "",
    tick,
    firstTick,
    expiresTick: tick + BOT_RESOURCE_TARGET_REPLAN_TICKS + jitter,
    score: target.score,
    expectedSeconds: target.expectedSeconds,
    indexes: Array.isArray(target.indexes)
      ? target.indexes.filter(Number.isInteger)
      : null
  };
}

function botResourceTargetMemory(target, tick, brain = null) {
  const previous = brain?.targetResource;
  const firstTick = previous?.index === target.index && Number.isFinite(previous.firstTick)
    ? previous.firstTick
    : tick;
  return {
    index: target.index,
    resource: target.resource || "",
    tick,
    firstTick
  };
}

function botResourceTargetCacheExpiresTick(cache) {
  return Number.isFinite(cache.expiresTick)
    ? cache.expiresTick
    : cache.tick + BOT_RESOURCE_TARGET_REPLAN_TICKS;
}

function botCommittedResourceTarget(arena, bot, brain, resourceNeeds) {
  const candidates = [];
  if (Number.isInteger(brain?.targetResource?.index)) {
    candidates.push({
      index: brain.targetResource.index,
      resource: brain.targetResource.resource || "",
      allowRemembered: true
    });
  }
  if (
    Number.isInteger(bot.miningTargetIndex) &&
    !candidates.some((candidate) => candidate.index === bot.miningTargetIndex)
  ) {
    candidates.push({
      index: bot.miningTargetIndex,
      resource: "",
      allowRemembered: false
    });
  }

  for (const candidate of candidates) {
    const target = botStickyResourceTargetForIndex(arena, bot, brain, resourceNeeds, candidate.index, {
      allowRemembered: candidate.allowRemembered
    });
    if (target && candidate.resource && target.resource !== candidate.resource) {
      continue;
    }
    if (target) {
      return target;
    }
  }

  return null;
}

function botBestRoutedResourceTarget(arena, bot, brain, candidates, tick = 0) {
  if (!Array.isArray(candidates) || candidates.length <= 0) {
    return null;
  }

  const viableCandidates = candidates.filter((candidate) => botResourceCandidateWorthSelecting(candidate));
  const cheapSelected = viableCandidates.reduce((selected, candidate) => (
    botResourceTargetPreferred(candidate, selected) ? candidate : selected
  ), null);
  const cheapCurrent = viableCandidates.find((candidate) => (
    Number.isInteger(brain?.targetResource?.index) && brain.targetResource.index === candidate.index
  )) || null;
  const routeCandidates = botResourceRouteCandidates(arena, bot, viableCandidates, cheapCurrent);
  const selected = routeCandidates.reduce((selected, candidate) => (
    botResourceTargetPreferred(candidate, selected) ? candidate : selected
  ), null) || cheapSelected;
  const current = routeCandidates.find((candidate) => (
    Number.isInteger(brain?.targetResource?.index) && brain.targetResource.index === candidate.index
  )) || cheapCurrent;

  return botResourceStableSelection(current, selected, brain, tick);
}

function botResourceRouteCandidates(arena, bot, candidates, current = null) {
  const ranked = [...candidates].sort((a, b) => (
    botResourceTargetPreferred(a, b) ? -1 : botResourceTargetPreferred(b, a) ? 1 : 0
  ));
  const shortlist = ranked.slice(0, BOT_RESOURCE_ROUTE_CANDIDATE_LIMIT);
  if (current && !shortlist.some((candidate) => candidate.index === current.index)) {
    if (shortlist.length < BOT_RESOURCE_ROUTE_CANDIDATE_LIMIT) {
      shortlist.push(current);
    } else {
      shortlist[shortlist.length - 1] = current;
    }
  }

  const routed = [];
  for (const candidate of shortlist) {
    const route = botResourceRouteToTarget(arena, bot, candidate);
    if (!route) {
      continue;
    }

    routed.push({
      ...candidate,
      routeSeconds: route.costSeconds,
      routeScore: botResourceRouteChoiceScore(candidate, route),
      minedTiles: route.minedTiles,
      endpointIndex: route.endpointIndex,
      routeTargetIndex: route.routeTargetIndex
    });
  }

  return routed;
}

function botResourceRouteToTarget(arena, bot, candidate) {
  const primaryTarget = candidate.clear
    ? (resourceApproachPoint(arena, bot, candidate) || candidate)
    : candidate;
  const primaryRoute = botPathRouteToTarget(arena, bot, primaryTarget, botResourcePathOptions(bot));
  if (primaryRoute) {
    return {
      ...primaryRoute,
      routeTargetIndex: Number.isInteger(primaryTarget.index) ? primaryTarget.index : candidate.index,
      minedTiles: botPathRouteMinedTiles(arena, primaryRoute.path)
    };
  }

  if (primaryTarget !== candidate) {
    const fallbackRoute = botPathRouteToTarget(arena, bot, candidate, botResourcePathOptions(bot));
    if (fallbackRoute) {
      return {
        ...fallbackRoute,
        routeTargetIndex: candidate.index,
        minedTiles: botPathRouteMinedTiles(arena, fallbackRoute.path)
      };
    }
  }

  return null;
}

function botPathRouteMinedTiles(arena, path) {
  if (!Array.isArray(path)) {
    return 0;
  }

  let count = 0;
  for (const index of path) {
    if (botPathIndexMineable(arena, index)) {
      count += 1;
    }
  }
  return count;
}

function botResourceRouteChoiceScore(candidate, route) {
  return Number(candidate.score || 0) -
    Math.max(0, Number(route?.costSeconds || 0)) * BOT_RESOURCE_ROUTE_SECONDS_WEIGHT -
    Math.max(0, Number(route?.minedTiles || 0)) * BOT_RESOURCE_ROUTE_MINED_TILE_WEIGHT;
}

function botResourceStableSelection(current, selected, brain = null, tick = 0) {
  if (!current || !selected || current.index === selected.index) {
    return selected || current;
  }

  return botResourceShouldSwitchTarget(current, selected, brain, tick)
    ? selected
    : current;
}

function botScoredTargetPreferred(candidate, selected, scoreEpsilon = BOT_TARGET_SCORE_TIE_EPSILON) {
  if (!candidate) {
    return false;
  }
  if (!selected) {
    return true;
  }

  const candidateScore = Number(candidate.score || 0);
  const selectedScore = Number(selected.score || 0);
  const epsilon = Math.max(0, Number(scoreEpsilon || 0));
  if (candidateScore > selectedScore + epsilon) {
    return true;
  }
  if (selectedScore > candidateScore + epsilon) {
    return false;
  }

  const candidateRoute = botTargetTieRouteSeconds(candidate);
  const selectedRoute = botTargetTieRouteSeconds(selected);
  if (Math.abs(candidateRoute - selectedRoute) > 0.02) {
    return candidateRoute < selectedRoute;
  }

  const candidateDistance = botTargetTieDistance(candidate);
  const selectedDistance = botTargetTieDistance(selected);
  if (Math.abs(candidateDistance - selectedDistance) > 0.5) {
    return candidateDistance < selectedDistance;
  }

  const candidateMined = Math.max(0, Number(candidate.minedTiles || 0));
  const selectedMined = Math.max(0, Number(selected.minedTiles || 0));
  if (candidateMined !== selectedMined) {
    return candidateMined < selectedMined;
  }

  return Number(candidate.index ?? Number.POSITIVE_INFINITY) < Number(selected.index ?? Number.POSITIVE_INFINITY);
}

function botTargetTieRouteSeconds(target) {
  if (Number.isFinite(target?.routeSeconds)) {
    return Math.max(0, Number(target.routeSeconds));
  }
  if (Number.isFinite(target?.expectedSeconds)) {
    return Math.max(0, Number(target.expectedSeconds));
  }
  return Number.POSITIVE_INFINITY;
}

function botTargetTieDistance(target) {
  if (Number.isFinite(target?.distance)) {
    return Math.max(0, Number(target.distance));
  }
  return Number.POSITIVE_INFINITY;
}

function botResourceDistanceScorePenalty(target) {
  const distance = Math.max(0, Number(target?.distance || 0));
  const resource = target?.resource || "";
  const scale = Number(BOT_RESOURCE_DISTANCE_SCORE_PENALTY[resource] || 0);
  return distance * scale;
}

function botResourceShouldSwitchTarget(current, candidate, brain = null, tick = 0) {
  if (!candidate) {
    return false;
  }
  if (!current) {
    return true;
  }

  const candidatePriority = botResourcePriority(candidate.resource);
  const currentPriority = botResourcePriority(current.resource);
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  if (botResourceRoutePreferred(candidate, current)) {
    return true;
  }
  if (botResourceRoutePreferred(current, candidate)) {
    return false;
  }

  if (botResourceTargetCloser(candidate, current)) {
    return true;
  }
  if (botResourceTargetCloser(current, candidate)) {
    return false;
  }

  if (botResourceHeldTicks(brain, current, tick) < BOT_RESOURCE_MIN_HOLD_TICKS) {
    return false;
  }

  return botResourceScoreTiePreferred(candidate, current);
}

function botResourceTargetPreferred(candidate, selected) {
  if (!candidate) {
    return false;
  }
  if (!selected) {
    return true;
  }

  const candidatePriority = botResourcePriority(candidate.resource);
  const selectedPriority = botResourcePriority(selected.resource);
  if (candidatePriority !== selectedPriority) {
    return candidatePriority > selectedPriority;
  }

  if (botResourceRoutePreferred(candidate, selected)) {
    return true;
  }
  if (botResourceRoutePreferred(selected, candidate)) {
    return false;
  }

  if (botResourceTargetCloser(candidate, selected)) {
    return true;
  }
  if (botResourceTargetCloser(selected, candidate)) {
    return false;
  }

  return botResourceScoreTiePreferred(candidate, selected);
}

function botResourcePriority(resource) {
  if (resource === "diamond") {
    return 2;
  }
  if (resource === "ore") {
    return 1;
  }
  return 0;
}

function botResourceTargetCloser(candidate, selected) {
  return botTargetTieDistance(candidate) + BOT_RESOURCE_DISTANCE_TIE_PIXELS < botTargetTieDistance(selected);
}

function botResourceRoutePreferred(candidate, selected) {
  const candidateHasRoute = Number.isFinite(candidate?.routeScore);
  const selectedHasRoute = Number.isFinite(selected?.routeScore);
  if (candidateHasRoute !== selectedHasRoute) {
    return candidateHasRoute;
  }
  if (!candidateHasRoute) {
    return false;
  }

  if (candidate.routeScore > selected.routeScore + BOT_RESOURCE_ROUTE_SCORE_EPSILON) {
    return true;
  }
  if (selected.routeScore > candidate.routeScore + BOT_RESOURCE_ROUTE_SCORE_EPSILON) {
    return false;
  }

  const candidateRoute = botTargetTieRouteSeconds(candidate);
  const selectedRoute = botTargetTieRouteSeconds(selected);
  return candidateRoute + 0.15 < selectedRoute;
}

function botResourceScoreTiePreferred(candidate, selected) {
  const candidateScore = Number(candidate.score || 0);
  const selectedScore = Number(selected.score || 0);
  if (Math.abs(candidateScore - selectedScore) > BOT_TARGET_SCORE_TIE_EPSILON) {
    return candidateScore > selectedScore;
  }

  const candidateAmount = Math.max(0, Number(candidate.amount || 0));
  const selectedAmount = Math.max(0, Number(selected.amount || 0));
  if (candidateAmount !== selectedAmount) {
    return candidateAmount > selectedAmount;
  }

  return Number(candidate.index ?? Number.POSITIVE_INFINITY) < Number(selected.index ?? Number.POSITIVE_INFINITY);
}

function botResourceHeldTicks(brain, current, tick) {
  const memory = brain?.targetResource;
  if (!memory || memory.index !== current?.index || !Number.isFinite(memory.firstTick)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, tick - memory.firstTick);
}

function botResourceCandidateWorthSelecting(candidate) {
  if (candidate?.resource !== "ore" || candidate.needed === true) {
    return true;
  }

  return Number(candidate.score || 0) >= BOT_ORE_OFF_PATH_MIN_ROUTE_SCORE;
}

function botResourceRouteFromSearch(arena, bot, target, search) {
  const goalIndex = botPathGoalIndex(arena, target, bot, search.options);
  if (goalIndex === null) {
    return null;
  }

  const endpointState = bestBotPathStateForIndex(search, goalIndex);
  if (endpointState < 0) {
    return null;
  }

  const endpointIndex = botPathStateTile(endpointState);
  return {
    goalIndex,
    endpointIndex,
    costSeconds: Math.max(0.1, search.costs[endpointState]),
    minedTiles: search.minedCounts[endpointState]
  };
}

function botResourcePathOptions(bot) {
  return botPathOptions(bot, {
    allowMining: true,
    strictPathMining: true
  });
}

function botStickyResourceTargetForIndex(arena, bot, brain, resourceNeeds, index, options = {}) {
  const asteroid = arena.asteroid;
  const allowRemembered = options.allowRemembered === true;
  if (
    index === null ||
    index < 0 ||
    index >= asteroid.tiles.length ||
    !botSafeStormTile(arena, index) ||
    (!allowRemembered && !botTileVisibleToBot(asteroid, bot, index))
  ) {
    return null;
  }

  const tile = asteroid.tiles[index];
  const resource = botResourceForTile(tile);
  if (resource !== "ore" && resource !== "diamond") {
    return null;
  }

  const point = tileCenter(asteroid, index);
  const distance = distanceBetween(bot, point);
  const clear = lineOfSight(arena, bot, point, Math.max(0, distance - asteroid.tileSize * 0.7));
  const amount = botResourceAmountForTile(asteroid, index, tile);
  const utility = botResourceUtility(resource, amount, resourceNeeds);
  const need = botResourceNeedAmount(resourceNeeds, resource);
  const acquisitionSeconds = botResourceAcquisitionSeconds(arena, index, distance, clear);
  return {
    index,
    ...point,
    distance,
    clear,
    valuable: true,
    resource,
    amount,
    need,
    needed: need > 0,
    utility,
    committed: true,
    plan: brain?.upgradePlan || BOT_UPGRADE_PLANS[0].id,
    score: botResourceRawScore(utility, acquisitionSeconds, clear, resource, distance)
  };
}

function resourceTargetForIndex(arena, bot, brain, resourceNeeds, oreDeposits, index) {
  const asteroid = arena.asteroid;
  const tile = asteroid.tiles[index];
  if (!isAsteroidRockTile(tile) || !botSafeStormTile(arena, index)) {
    return null;
  }

  if (tile === ASTEROID_TILE.ore) {
    const deposit = oreDeposits.get(index);
    return deposit?.entryIndex === index ? deposit : null;
  }

  const tileSize = asteroid.tileSize || 16;
  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  const x = (tileX + 0.5) * tileSize;
  const y = (tileY + 0.5) * tileSize;
  const distance = Math.hypot(x - bot.x, y - bot.y);
  if (distance > botHumanVisibleRadius()) {
    return null;
  }

  const clear = lineOfSight(arena, bot, { x, y }, Math.max(0, distance - tileSize * 0.7));
  const resource = botResourceForTile(tile);
  if (!resource) {
    return null;
  }
  if (resource === "rock") {
    return null;
  }

  const amount = botResourceAmountForTile(asteroid, index, tile);
  const valuable = tile === ASTEROID_TILE.diamond || tile === ASTEROID_TILE.ore;
  const utility = botResourceUtility(resource, amount, resourceNeeds);
  const need = botResourceNeedAmount(resourceNeeds, resource);
  const acquisitionSeconds = botResourceAcquisitionSeconds(arena, index, distance, clear);
  return {
    index,
    x,
    y,
    distance,
    clear,
    valuable,
    resource,
    amount,
    need,
    needed: need > 0,
    utility,
    plan: brain?.upgradePlan || BOT_UPGRADE_PLANS[0].id,
    score: botResourceRawScore(utility, acquisitionSeconds, clear, resource, distance)
  };
}

function collectVisibleOreDeposits(arena, bot, brain, resourceNeeds, originTileX, originTileY, radiusTiles) {
  const asteroid = arena.asteroid;
  const deposits = new Map();
  const visited = new Set();

  for (let y = originTileY - radiusTiles; y <= originTileY + radiusTiles; y += 1) {
    for (let x = originTileX - radiusTiles; x <= originTileX + radiusTiles; x += 1) {
      const startIndex = tileIndexAtTile(asteroid, x, y);
      if (
        startIndex === null ||
        visited.has(startIndex) ||
        asteroid.tiles[startIndex] !== ASTEROID_TILE.ore ||
        !botSafeStormTile(arena, startIndex) ||
        !botTileVisibleToBot(asteroid, bot, startIndex)
      ) {
        continue;
      }

      const deposit = buildVisibleOreDeposit(arena, bot, brain, resourceNeeds, startIndex);
      for (const index of deposit.indexes) {
        visited.add(index);
        deposits.set(index, deposit);
      }
    }
  }

  return deposits;
}

function buildVisibleOreDeposit(arena, bot, brain, resourceNeeds, startIndex) {
  const asteroid = arena.asteroid;
  const indexes = [];
  const visited = new Set([startIndex]);
  const queue = [startIndex];
  let amount = 0;
  let bestEntry = null;
  let cursor = 0;

  while (cursor < queue.length) {
    const index = queue[cursor];
    cursor += 1;

    indexes.push(index);
    amount += botResourceAmountForTile(asteroid, index, ASTEROID_TILE.ore);

    const entry = oreDepositEntryForIndex(arena, bot, index);
    if (!bestEntry || entry.entryScore < bestEntry.entryScore) {
      bestEntry = entry;
    }

    for (const neighbor of oreDepositNeighbors(asteroid, index)) {
      if (
        visited.has(neighbor) ||
        asteroid.tiles[neighbor] !== ASTEROID_TILE.ore ||
        !botSafeStormTile(arena, neighbor) ||
        !botTileVisibleToBot(asteroid, bot, neighbor)
      ) {
        continue;
      }
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  const entry = bestEntry || oreDepositEntryForIndex(arena, bot, startIndex);
  const need = botResourceNeedAmount(resourceNeeds, "ore");
  const utility = botResourceUtility("ore", amount, resourceNeeds);
  const oreSeconds = miningSecondsForGameMode(ENGINE.mining.oreSeconds, arena.mode);
  const depositSeconds = entry.acquisitionSeconds + Math.max(0, Math.sqrt(amount) - 1) * oreSeconds * 0.2;
  return {
    index: entry.index,
    entryIndex: entry.index,
    x: entry.x,
    y: entry.y,
    distance: entry.distance,
    clear: entry.clear,
    valuable: true,
    resource: "ore",
    amount,
    need,
    needed: need > 0,
    utility,
    depositTiles: indexes.length,
    indexes,
    plan: brain?.upgradePlan || BOT_UPGRADE_PLANS[0].id,
    score: botResourceRawScore(utility, depositSeconds, entry.clear, "ore", entry.distance)
  };
}

function botResourceRawScore(utility, seconds, clear, resource = "", distance = 0) {
  return Number(utility || 0) -
    Math.max(0.1, Number(seconds || 0)) * BOT_RESOURCE_ROUTE_SECONDS_PENALTY +
    (clear ? 18 : 0) +
    (resource === "diamond" ? BOT_RESOURCE_DIAMOND_VISIBLE_BONUS : 0) -
    botResourceDistanceScorePenalty({ resource, distance });
}

function oreDepositEntryForIndex(arena, bot, index) {
  const asteroid = arena.asteroid;
  const point = tileCenter(asteroid, index);
  const distance = distanceBetween(bot, point);
  const clear = lineOfSight(arena, bot, point, Math.max(0, distance - asteroid.tileSize * 0.7));
  const acquisitionSeconds = botResourceAcquisitionSeconds(arena, index, distance, clear);
  return {
    index,
    ...point,
    distance,
    clear,
    acquisitionSeconds,
    entryScore: acquisitionSeconds - (clear ? 0.35 : 0)
  };
}

function oreDepositNeighbors(asteroid, index) {
  const width = asteroid.widthTiles;
  const height = asteroid.heightTiles;
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbors = [];
  if (x > 0) {
    neighbors.push(index - 1);
  }
  if (x < width - 1) {
    neighbors.push(index + 1);
  }
  if (y > 0) {
    neighbors.push(index - width);
  }
  if (y < height - 1) {
    neighbors.push(index + width);
  }
  return neighbors;
}

function botTileVisibleToBot(asteroid, bot, index) {
  const point = tileCenter(asteroid, index);
  return distanceBetween(bot, point) <= botHumanVisibleRadius();
}

function botUpgradeResourceNeeds(bot, brain) {
  const resources = bot.resources || {};
  const planId = botUpgradePlan(brain?.upgradePlan, () => 0).id;
  const needs = {
    rock: 0,
    ore: 0,
    diamond: 0,
    planId,
    diamondStrategyMultiplier: botDiamondStrategyMultiplier(planId)
  };

  for (const upgradeId of botUpgradePriority(bot, brain)) {
    const cost = nextUpgradeCost(bot.upgrades, upgradeId);
    if (!cost) {
      continue;
    }

    let hasDeficit = false;
    for (const resource of BOT_RESOURCE_KEYS) {
      const required = Number(cost[resource] || 0);
      if (required <= 0) {
        continue;
      }

      const available = Number(resources[resource] || 0);
      const deficit = Math.max(0, required - available);
      if (deficit > 0) {
        needs[resource] += deficit * 1.45;
        hasDeficit = true;
      }
    }

    if (hasDeficit) {
      return needs;
    }
  }

  return needs;
}

function botResourceForTile(tile) {
  if (tile === ASTEROID_TILE.diamond) {
    return "diamond";
  }
  if (tile === ASTEROID_TILE.ore) {
    return "ore";
  }
  return null;
}

function botResourceAmountForTile(asteroid, index, tile) {
  if (tile === ASTEROID_TILE.ore) {
    return Math.max(1, Number(asteroid.amounts[index] || 0));
  }
  return 1;
}

function botResourceNeedAmount(resourceNeeds, resource) {
  return Math.max(0, Number(resourceNeeds?.[resource] || 0));
}

function botResourceUtility(resource, amount, resourceNeeds) {
  const need = botResourceNeedAmount(resourceNeeds, resource);
  const amountBonus = resource === "ore"
    ? Math.min(2, Math.max(0, amount - 1)) * BOT_ORE_DEPOSIT_AMOUNT_BONUS
    : 0;

  if (need <= 0) {
    const offPathMultiplier = botOffPathResourceMultiplier(resource, resourceNeeds);
    return (BOT_BASE_RESOURCE_SCORE[resource] + amountBonus) * offPathMultiplier;
  }

  const usefulAmount = resource === "ore"
    ? Math.min(Math.max(1, amount), Math.max(1, Math.ceil(need)))
    : 1;
  const needBonus = resource === "diamond"
    ? Math.min(8, need) * BOT_DIAMOND_NEED_BONUS
    : Math.min(10, need) * 35 + (usefulAmount - 1) * BOT_ORE_DEPOSIT_AMOUNT_BONUS;

  return (BOT_BASE_RESOURCE_SCORE[resource] +
    BOT_RESOURCE_NEED_SCORE[resource] +
    needBonus) * botNeededResourceMultiplier(resource, resourceNeeds);
}

function botOffPathResourceMultiplier(resource, resourceNeeds) {
  if (!botHasSpecificResourceNeed(resourceNeeds)) {
    return resource === "diamond"
      ? botDiamondStrategyMultiplier(resourceNeeds?.planId)
      : 1;
  }

  if (resource === "diamond") {
    return BOT_DIAMOND_OFF_PATH_MULTIPLIER * botDiamondStrategyMultiplier(resourceNeeds?.planId);
  }

  return BOT_ORE_OFF_PATH_MULTIPLIER;
}

function botNeededResourceMultiplier(resource, resourceNeeds) {
  return resource === "diamond"
    ? botDiamondStrategyMultiplier(resourceNeeds?.planId)
    : 1;
}

function botDiamondStrategyMultiplier(planId) {
  return BOT_DIAMOND_STRATEGY_MULTIPLIER[planId] || 1;
}

function botHasSpecificResourceNeed(resourceNeeds) {
  return BOT_RESOURCE_KEYS.some((resource) => Number(resourceNeeds?.[resource] || 0) > 0);
}

function botResourceAcquisitionSeconds(arena, index, distance, clear) {
  return 0.4 +
    distance / botPathAirSpeed() +
    botMiningSecondsForTile(arena, index) * 0.75 +
    (clear ? 0 : 1.2);
}

function resourceBlockerForTarget(arena, bot, resource) {
  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || 16;
  const distance = distanceBetween(bot, resource);
  if (distance <= 0) {
    return null;
  }

  const angle = Math.atan2(resource.y - bot.y, resource.x - bot.x);
  const hit = raycastAsteroid(
    asteroid,
    bot.x,
    bot.y,
    angle,
    Math.max(0, distance - tileSize * 0.7),
    { blockNonPlayable: !arena.storm }
  );
  if (!hit.hit || !hit.mineable || hit.index === null || hit.index < 0) {
    return null;
  }

  return {
    index: hit.index,
    x: hit.x,
    y: hit.y,
    distance: hit.distance,
    tile: hit.tile,
    mineable: true
  };
}

function botExploreTarget(arena, bot, brain) {
  const pathOptions = botExplorePathOptions(arena, bot, brain);
  const stormInteriorTarget = botStormInteriorTarget(arena, bot);
  const urgentStormTarget = botExploreStormTargetUrgent(arena, bot, stormInteriorTarget);
  const currentTarget = botCommittedExploreTarget(arena, bot, brain, null);

  if (currentTarget && !urgentStormTarget) {
    return currentTarget;
  }

  const search = findBotPathCostsFromBot(arena, bot, pathOptions);
  if (stormInteriorTarget && (urgentStormTarget || !currentTarget)) {
    const routedStormTarget = botRouteScoredExploreTarget(arena, bot, stormInteriorTarget, search);
    if (routedStormTarget) {
      brain.wanderTarget = botExploreTargetMemory(brain, routedStormTarget, arena.tick);
      return brain.wanderTarget;
    }
  }

  const candidateCells = botExploreFrontierCells(arena, bot, brain);
  let selected = null;
  let selectedCoverageScore = Number.NEGATIVE_INFINITY;
  let fallbackSelected = null;
  let fallbackCoverageScore = Number.NEGATIVE_INFINITY;

  for (const cell of candidateCells) {
    const target = botExploreCellTarget(arena, bot, brain, cell.x, cell.y, cell);
    if (!target) {
      continue;
    }

    const fallbackScore = botExploreCoverageTargetScore(cell, target);
    if (botScoredTargetPreferred(
      { ...target, score: fallbackScore },
      fallbackSelected ? { ...fallbackSelected, score: fallbackCoverageScore } : null,
      0.25
    )) {
      fallbackSelected = target;
      fallbackCoverageScore = fallbackScore;
    }

    const routedTarget = botRouteScoredExploreTarget(arena, bot, target, search);
    if (!routedTarget) {
      continue;
    }

    const coverageScore = botExploreCoverageTargetScore(cell, routedTarget);
    if (botScoredTargetPreferred(
      { ...routedTarget, score: coverageScore },
      selected ? { ...selected, score: selectedCoverageScore } : null,
      0.25
    )) {
      selected = routedTarget;
      selectedCoverageScore = coverageScore;
    }
  }

  if (!selected) {
    selected = fallbackSelected;
  }

  if (!selected) {
    selected = botExploreReachableFallbackTarget(arena, bot, brain, search);
  }

  if (!selected) {
    return currentTarget || null;
  }

  if (currentTarget && !botExploreTargetCanSwitch(brain, currentTarget, selected, arena.tick)) {
    return currentTarget;
  }

  brain.wanderTarget = selected
    ? botExploreTargetMemory(brain, selected, arena.tick)
    : null;
  return brain.wanderTarget;
}

function botExploreReachableFallbackTarget(arena, bot, brain, search) {
  if (!arena.asteroid || !search || !Array.isArray(search.closedStates)) {
    return null;
  }

  const asteroid = arena.asteroid;
  const seen = new Set();
  const currentIndex = tileIndexAtPoint(asteroid, bot.x, bot.y);
  let selected = null;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (const state of search.closedStates) {
    const index = botPathStateTile(state);
    if (seen.has(index) || index === currentIndex || !botPassableTile(arena, index)) {
      continue;
    }
    seen.add(index);

    const point = tileCenter(asteroid, index);
    const distance = distanceBetween(bot, point);
    if (distance < asteroid.tileSize * 2.5) {
      continue;
    }

    const cell = botExploreCellAtIndex(asteroid, index);
    if (!cell) {
      continue;
    }

    const cellKey = botExploreCellKey(cell.x, cell.y);
    if (botExploreRouteThreatened(arena, bot, brain, point)) {
      continue;
    }

    const visits = Number(brain.exploredCells?.get(cellKey) || 0);
    const routeSeconds = Math.max(0.1, Number(search.costs[state] || 0));
    const minedTiles = Number(search.minedCounts?.[state] || 0);
    const heat = botExploreHeatForCell(arena, brain, cellKey);
    const valueScore = botExploreCellValueScore(arena, brain, cell.x, cell.y);
    const score = (visits <= 0 ? 100000 : 0) +
      valueScore -
      visits * 1200 -
      heat * 90 -
      routeSeconds * 0.6 -
      minedTiles * 3;

    const candidate = {
      index,
      ...point,
      cellKey,
      distance,
      clear: lineOfSight(arena, bot, point, Math.max(0, distance - bot.radius)),
      tile: asteroid.tiles[index],
      mineable: false,
      visits,
      rememberedValue: botExploreRememberedCellValue(brain, cellKey),
      estimatedValue: botExploreEstimatedCellResourceValue(arena, cell.x, cell.y),
      stormClearanceTiles: botStormClearanceTiles(arena, index, BOT_STORM_TARGET_CLEARANCE_TILES),
      exploreHeat: heat,
      routeSeconds,
      minedTiles,
      fallback: "reachable",
      score
    };

    if (botScoredTargetPreferred(
      candidate,
      selected ? { ...selected, score: selectedScore } : null,
      0.25
    )) {
      selectedScore = score;
      selected = candidate;
    }
  }

  return selected;
}

function botCommittedExploreTarget(arena, bot, brain, search) {
  const target = brain?.wanderTarget;
  if (!target || !botExploreTargetUsable(arena, target, bot, brain)) {
    return null;
  }
  if (botExploreTargetReached(arena, bot, brain, target)) {
    return null;
  }

  if (!search) {
    return target;
  }

  const routed = botRouteScoredExploreTarget(arena, bot, target, search);
  if (!routed) {
    const tick = Number.isFinite(arena?.tick) ? arena.tick : 0;
    return botExploreHeldTicks(brain, target, tick) < BOT_EXPLORE_RETARGET_TICKS
      ? target
      : null;
  }

  brain.wanderTarget = botExploreTargetMemory(brain, routed, Number.isFinite(arena?.tick) ? arena.tick : 0);
  return brain.wanderTarget;
}

function botExploreStormTargetUrgent(arena, bot, target) {
  if (!target || !arena.storm || !arena.asteroid) {
    return false;
  }

  const index = tileIndexAtPoint(arena.asteroid, bot.x, bot.y);
  return !botSafeStormTile(arena, index);
}

function botExploreTargetReached(arena, bot, brain, target) {
  if (!target || !arena.asteroid) {
    return true;
  }

  const arrivalDistance = Math.max(
    BOT_EXPLORE_TARGET_ARRIVAL_PIXELS,
    (bot.radius || ENGINE.ship.radius) * 1.7
  );
  if (distanceBetween(bot, target) > arrivalDistance) {
    return false;
  }

  if (!target.cellKey) {
    return true;
  }

  const currentCell = botExploreCellAtPoint(arena.asteroid, bot.x, bot.y);
  const reached = currentCell && botExploreCellKey(currentCell.x, currentCell.y) === target.cellKey;
  if (reached) {
    markBotExploreTargetReached(brain, target, arena.tick);
  }
  return reached;
}

function botExploreTargetCanSwitch(brain, current, candidate, tick) {
  if (!candidate) {
    return false;
  }
  if (!current || botExploreTargetSame(current, candidate)) {
    return true;
  }
  if (current.phase === "roam" && candidate.phase === "explore") {
    return true;
  }

  const heldTicks = botExploreHeldTicks(brain, current, tick);
  if (heldTicks < BOT_EXPLORE_MIN_HOLD_TICKS) {
    return false;
  }

  const currentScore = Number(current.score || 0);
  const candidateScore = Number(candidate.score || 0);
  const ratioScore = currentScore > 0
    ? currentScore * BOT_EXPLORE_SWITCH_SCORE_RATIO
    : currentScore + BOT_EXPLORE_SWITCH_SCORE_MARGIN;
  return candidateScore >= currentScore + BOT_EXPLORE_SWITCH_SCORE_MARGIN &&
    candidateScore >= ratioScore;
}

function markBotExploreTargetReached(brain, target, tick) {
  if (!brain || !target?.cellKey) {
    return;
  }
  if (!brain.exploredCells || typeof brain.exploredCells.get !== "function") {
    brain.exploredCells = sanitizeExploredCells(brain.exploredCells);
  }

  const visits = Number(brain.exploredCells.get(target.cellKey) || 0);
  brain.exploredCells.set(target.cellKey, Math.min(BOT_EXPLORE_VISIT_CAP, Math.max(1, visits)));
  addBotExploreHeat(brain, target.cellKey, BOT_EXPLORE_HEAT_MARK, tick);
}

function botExploreHeldTicks(brain, target, tick) {
  const current = brain?.wanderTarget;
  if (!current || !botExploreTargetSame(current, target) || !Number.isFinite(current.firstTick)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, tick - current.firstTick);
}

function botExploreTargetMemory(brain, target, tick) {
  const previous = brain?.wanderTarget;
  const firstTick = previous && botExploreTargetSame(previous, target) && Number.isFinite(previous.firstTick)
    ? previous.firstTick
    : tick;
  if (target?.phase === "roam" && Number.isFinite(target.sweepIndex)) {
    brain.roamSweepCursor = Math.floor(target.sweepIndex) + 1;
  }
  return {
    ...target,
    tick,
    firstTick
  };
}

function botExploreTargetSame(a, b) {
  if (!a || !b) {
    return false;
  }
  if (a.cellKey && b.cellKey) {
    return a.cellKey === b.cellKey;
  }
  return Number.isInteger(a.index) && Number.isInteger(b.index) && a.index === b.index;
}

function botExploreCoverageTargetScore(cell, target) {
  const visits = Math.max(0, Number(cell?.visits ?? target?.visits ?? 0));
  const depth = Math.max(0, Number(cell?.depth ?? 0));
  const routeSeconds = Math.max(0, Number(target?.routeSeconds ?? 0));
  const heat = Math.max(0, Number(target?.exploreHeat ?? 0));
  if (target?.phase === "roam" || cell?.phase === "roam") {
    const roamScore = Number(cell?.roamScore ?? target?.roamScore ?? target?.score ?? 0);
    const minedTiles = Math.max(0, Number(target?.minedTiles || 0));
    return roamScore -
      routeSeconds * BOT_EXPLORE_ROAM_ROUTE_SECONDS_WEIGHT -
      minedTiles * BOT_EXPLORE_ROAM_MINED_TILE_WEIGHT;
  }

  const unvisitedScore = visits <= 0 ? 100000 : 0;
  return unvisitedScore -
    visits * 1200 -
    depth * 18 -
    routeSeconds * 0.45 -
    heat * 90 +
    botExploreCellNoise(null, target?.cellKey || "") * 0.01;
}

function botExploreFrontierCells(arena, bot, brain) {
  const asteroid = arena.asteroid;
  const current = botExploreCellAtPoint(asteroid, bot.x, bot.y);
  if (!current) {
    return [];
  }

  const cellsX = Math.ceil(asteroid.widthTiles / BOT_EXPLORE_CELL_TILES);
  const cellsY = Math.ceil(asteroid.heightTiles / BOT_EXPLORE_CELL_TILES);
  const visitedArea = new Set();
  const frontier = new Map();
  const queue = [{ ...current, depth: 0 }];
  visitedArea.add(botExploreCellKey(current.x, current.y));

  for (let cursor = 0; cursor < queue.length && cursor < cellsX * cellsY; cursor += 1) {
    const cell = queue[cursor];
    for (const neighbor of botExploreNeighborCells(cell, cellsX, cellsY)) {
      const neighborKey = botExploreCellKey(neighbor.x, neighbor.y);
      const targetIndex = botExploreCandidateTargetIndex(arena, neighbor.x, neighbor.y);
      if (targetIndex === null || !botExploreCellSideSafe(arena, cell, neighbor)) {
        continue;
      }

      const visits = Number(brain.exploredCells?.get(neighborKey) || 0);
      if (visits > 0) {
        if (!visitedArea.has(neighborKey)) {
          visitedArea.add(neighborKey);
          queue.push({
            ...neighbor,
            depth: cell.depth + 1
          });
        }
      } else if (!frontier.has(neighborKey)) {
        frontier.set(neighborKey, {
          ...neighbor,
          fromX: cell.x,
          fromY: cell.y,
          depth: cell.depth + 1,
          phase: "explore",
          targetIndex,
          visits: 0,
          valueScore: botExploreCellValueScore(arena, brain, neighbor.x, neighbor.y)
        });
      }
    }
  }

  if (frontier.size > 0) {
    return Array.from(frontier.values()).sort(botExploreCandidateCellSort);
  }

  const uncovered = botExploreUncoveredCells(arena, bot, brain, current, cellsX, cellsY);
  if (uncovered.length > 0) {
    return uncovered;
  }

  return botExploreRoamCells(arena, bot, brain, current, cellsX, cellsY);
}

function botExploreCandidateCellSort(a, b) {
  if (a.phase === "roam" || b.phase === "roam") {
    return Number(b.roamScore || 0) - Number(a.roamScore || 0) ||
      Number(a.depth || 0) - Number(b.depth || 0) ||
      Number(a.y || 0) - Number(b.y || 0) ||
      Number(a.x || 0) - Number(b.x || 0);
  }

  return Number(a.depth || 0) - Number(b.depth || 0) ||
    Number(a.visits || 0) - Number(b.visits || 0) ||
    Number(b.valueScore || 0) - Number(a.valueScore || 0) ||
    Number(a.y || 0) - Number(b.y || 0) ||
    Number(a.x || 0) - Number(b.x || 0);
}

function botExploreUncoveredCells(arena, bot, brain, current, cellsX, cellsY) {
  const candidates = [];
  for (let cellY = 0; cellY < cellsY; cellY += 1) {
    for (let cellX = 0; cellX < cellsX; cellX += 1) {
      const cellKey = botExploreCellKey(cellX, cellY);
      const visits = Number(brain.exploredCells?.get(cellKey) || 0);
      const targetIndex = botExploreCandidateTargetIndex(arena, cellX, cellY);
      if (visits > 0 || targetIndex === null) {
        continue;
      }

      candidates.push({
        x: cellX,
        y: cellY,
        fromX: current.x,
        fromY: current.y,
        depth: Math.abs(cellX - current.x) + Math.abs(cellY - current.y),
        phase: "explore",
        targetIndex,
        visits: 0,
        valueScore: botExploreCellValueScore(arena, brain, cellX, cellY)
      });
    }
  }

  return candidates
    .sort(botExploreCandidateCellSort)
    .slice(0, 36);
}

function botExploreRoamCells(arena, bot, brain, current, cellsX, cellsY) {
  const candidates = [];
  const tick = Number.isFinite(arena?.tick) ? arena.tick : 0;
  const totalCells = Math.max(1, cellsX * cellsY);
  const cursor = positiveModulo(Math.floor(Number(brain?.roamSweepCursor || 0)), totalCells);
  for (let cellY = 0; cellY < cellsY; cellY += 1) {
    for (let cellX = 0; cellX < cellsX; cellX += 1) {
      const cellKey = botExploreCellKey(cellX, cellY);
      const visits = Number(brain.exploredCells?.get(cellKey) || 0);
      const targetIndex = botExploreCandidateTargetIndex(arena, cellX, cellY);
      if (visits <= 0 || targetIndex === null) {
        continue;
      }

      const heat = botExploreHeatForCell(arena, brain, cellKey);
      const valueScore = botExploreCellValueScore(arena, brain, cellX, cellY);
      const depth = Math.abs(cellX - current.x) + Math.abs(cellY - current.y);
      const sweepIndex = botExploreCellSweepIndex(cellX, cellY, cellsX);
      const sweepDistance = positiveModulo(sweepIndex - cursor, totalCells);
      const cooldown = 1 - clamp(heat / Math.max(1, BOT_EXPLORE_HEAT_MAX), 0, 1);
      const rememberedValue = botExploreRememberedCellValue(brain, cellKey);
      candidates.push({
        x: cellX,
        y: cellY,
        fromX: current.x,
        fromY: current.y,
        depth,
        phase: "roam",
        targetIndex,
        visits,
        valueScore,
        heat,
        sweepIndex,
        sweepDistance,
        rememberedValue,
        roamScore: cooldown * totalCells * 2 -
          sweepDistance +
          valueScore * BOT_EXPLORE_ROAM_VALUE_WEIGHT -
          Math.min(BOT_EXPLORE_VISIT_CAP, visits) * 0.45 -
          Math.min(60, depth) * 0.04 +
          botExploreCellNoise(brain, `${cellKey}:${Math.floor(tick / BOT_EXPLORE_RETARGET_TICKS)}`) * 0.25
      });
    }
  }

  return candidates
    .sort(botExploreCandidateCellSort)
    .slice(0, BOT_EXPLORE_ROAM_CANDIDATES);
}

function botExploreCellSweepIndex(cellX, cellY, cellsX) {
  const row = Math.max(0, Math.floor(Number(cellY) || 0));
  const width = Math.max(1, Math.floor(Number(cellsX) || 1));
  const x = clamp(Math.floor(Number(cellX) || 0), 0, width - 1);
  return row * width + (row % 2 === 0 ? x : width - 1 - x);
}

function positiveModulo(value, modulo) {
  const divisor = Math.max(1, Math.floor(Number(modulo) || 1));
  return ((Math.floor(Number(value) || 0) % divisor) + divisor) % divisor;
}

function botExploreNeighborCells(cell, cellsX, cellsY) {
  const neighbors = [];
  if (cell.x > 0) {
    neighbors.push({ x: cell.x - 1, y: cell.y });
  }
  if (cell.x < cellsX - 1) {
    neighbors.push({ x: cell.x + 1, y: cell.y });
  }
  if (cell.y > 0) {
    neighbors.push({ x: cell.x, y: cell.y - 1 });
  }
  if (cell.y < cellsY - 1) {
    neighbors.push({ x: cell.x, y: cell.y + 1 });
  }
  return neighbors;
}

function botExploreCellCandidateSafe(arena, cellX, cellY) {
  return botExploreCandidateTargetIndex(arena, cellX, cellY) !== null;
}

function botExploreCandidateTargetIndex(arena, cellX, cellY) {
  if (botExploreCellHasKnownStorm(arena, cellX, cellY)) {
    return null;
  }
  return botExploreTargetIndexInCell(arena, cellX, cellY);
}

function botExploreCellHasKnownStorm(arena, cellX, cellY) {
  const stormCells = botExploreStormCellSet(arena);
  return stormCells ? stormCells.has(botExploreCellKey(cellX, cellY)) : false;
}

function botExploreStormCellSet(arena) {
  if (!arena?.storm || !arena.asteroid) {
    return null;
  }

  const cached = arena[BOT_EXPLORE_STORM_CACHE_KEY];
  if (cached && cached.tick === arena.tick && cached.claimedCount === arena.storm.claimedCount) {
    return cached.cells;
  }

  const asteroid = arena.asteroid;
  const cells = new Set();
  const state = arena.storm.state || [];
  for (let index = 0; index < state.length; index += 1) {
    if (Number(state[index]) === STORM_STATE.safe) {
      continue;
    }
    if (!(asteroid.playable[index] === true || asteroid.playable[index] === "1")) {
      continue;
    }

    const cell = botExploreCellAtIndex(asteroid, index);
    if (cell) {
      cells.add(botExploreCellKey(cell.x, cell.y));
    }
  }

  arena[BOT_EXPLORE_STORM_CACHE_KEY] = {
    tick: arena.tick,
    claimedCount: arena.storm.claimedCount,
    cells
  };
  return cells;
}

function botExploreCellSideSafe(arena, fromCell, toCell) {
  if (!arena.storm) {
    return true;
  }

  if (
    botExploreCellHasKnownStorm(arena, fromCell.x, fromCell.y) ||
    botExploreCellHasKnownStorm(arena, toCell.x, toCell.y)
  ) {
    return false;
  }

  const asteroid = arena.asteroid;
  const fromBounds = botExploreCellTileBounds(asteroid, fromCell.x, fromCell.y);
  const toBounds = botExploreCellTileBounds(asteroid, toCell.x, toCell.y);
  if (!fromBounds || !toBounds) {
    return false;
  }

  const dx = Math.sign(toCell.x - fromCell.x);
  const dy = Math.sign(toCell.y - fromCell.y);
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    return false;
  }

  const sideLength = dx !== 0
    ? Math.min(fromBounds.maxY, toBounds.maxY) - Math.max(fromBounds.minY, toBounds.minY) + 1
    : Math.min(fromBounds.maxX, toBounds.maxX) - Math.max(fromBounds.minX, toBounds.minX) + 1;
  if (sideLength <= 0) {
    return false;
  }

  for (let offset = 0; offset < sideLength; offset += 1) {
    const fromTileX = dx > 0
      ? fromBounds.maxX
      : dx < 0
        ? fromBounds.minX
        : Math.max(fromBounds.minX, toBounds.minX) + offset;
    const fromTileY = dy > 0
      ? fromBounds.maxY
      : dy < 0
        ? fromBounds.minY
        : Math.max(fromBounds.minY, toBounds.minY) + offset;
    const toTileX = dx > 0
      ? toBounds.minX
      : dx < 0
        ? toBounds.maxX
        : Math.max(fromBounds.minX, toBounds.minX) + offset;
    const toTileY = dy > 0
      ? toBounds.minY
      : dy < 0
        ? toBounds.maxY
        : Math.max(fromBounds.minY, toBounds.minY) + offset;
    const fromIndex = tileIndexAtTile(asteroid, fromTileX, fromTileY);
    const toIndex = tileIndexAtTile(asteroid, toTileX, toTileY);
    if (!botSafeStormTile(arena, fromIndex) || !botSafeStormTile(arena, toIndex)) {
      return false;
    }
  }

  return true;
}

function botExplorePathOptions(arena, bot, brain) {
  return botPathOptions(bot, {
    allowMining: true,
    strictPathMining: true,
    ...botExploreHeatPathOptions(arena, brain),
    ...botExploreThreatPathOptions(arena, bot, brain)
  });
}

function botExploreHeatPathOptions(arena, brain) {
  return {
    pathExploreHeat: brain?.exploreHeat instanceof Map ? brain.exploreHeat : null,
    pathExploreHeatTick: Number.isFinite(arena?.tick) ? arena.tick : 0
  };
}

function botExploreTargetRoutable(arena, bot, target, search) {
  return Boolean(botRouteScoredExploreTarget(arena, bot, target, search));
}

function botRouteScoredExploreTarget(arena, bot, target, search) {
  if (!search) {
    return null;
  }

  const route = botResourceRouteFromSearch(arena, bot, target, search);
  if (!route) {
    return null;
  }

  return {
    ...target,
    routeSeconds: route.costSeconds,
    minedTiles: route.minedTiles,
    score: target.score - route.costSeconds * 0.026 - route.minedTiles * 0.03
  };
}

function botExploreTargetUsable(arena, target, bot = null, brain = null) {
  const asteroid = arena.asteroid;
  const index = Number.isInteger(target.index)
    ? target.index
    : tileIndexAtPoint(asteroid, target.x, target.y);
  if (target.cellKey) {
    const [cellX, cellY] = target.cellKey.split(":").map((part) => Number(part));
    if (!Number.isFinite(cellX) || !Number.isFinite(cellY) || botExploreCellHasKnownStorm(arena, cellX, cellY)) {
      return false;
    }
    if (target.phase === "explore" && Number(brain?.exploredCells?.get(target.cellKey) || 0) > 0) {
      return false;
    }
  }
  return index !== null &&
    index >= 0 &&
    index < asteroid.tiles.length &&
    (asteroid.playable[index] === true || asteroid.playable[index] === "1") &&
    botSafeStormTile(arena, index) &&
    !botExploreRouteThreatened(arena, bot, brain, target);
}

function botExploreCellTarget(arena, bot, brain, cellX, cellY, cellMeta = null, options = {}) {
  const asteroid = arena.asteroid;
  if (botExploreCellHasKnownStorm(arena, cellX, cellY)) {
    return null;
  }

  const targetIndex = Number.isInteger(cellMeta?.targetIndex)
    ? cellMeta.targetIndex
    : botExploreTargetIndexInCell(arena, cellX, cellY);
  if (targetIndex === null) {
    return null;
  }

  const point = tileCenter(asteroid, targetIndex);
  const distance = distanceBetween(bot, point);
  if (distance < asteroid.tileSize * 3) {
    return null;
  }

  const cellKey = botExploreCellKey(cellX, cellY);
  const visits = Number(brain.exploredCells?.get(cellKey) || 0);
  const valueScore = Number.isFinite(cellMeta?.valueScore)
    ? cellMeta.valueScore
    : botExploreCellValueScore(arena, brain, cellX, cellY);
  const adjacentScore = cellMeta ? 0.85 : 0;
  const distanceScore = -Math.min(1.2, distance / Math.max(1, botHumanVisibleRadius() * 4)) * 0.35;
  const centerNoise = botExploreCellNoise(brain, cellKey) * 0.08;
  const threatPenalty = botThreatSectorPenalty(arena, brain, cellX, cellY);
  if (options.skipThreatRoute !== true && botExploreRouteThreatened(arena, bot, brain, point)) {
    return null;
  }

  const clear = options.computeClear === false
    ? false
    : lineOfSight(arena, bot, point, Math.max(0, distance - bot.radius));
  const tile = asteroid.tiles[targetIndex];
  const mineable = isAsteroidRockTile(tile);
  const empty = tile === ASTEROID_TILE.empty;
  const stormClearanceTiles = botStormClearanceTiles(arena, targetIndex, BOT_STORM_TARGET_CLEARANCE_TILES);
  const stormScore = arena.storm
    ? Math.min(stormClearanceTiles, BOT_STORM_TARGET_CLEARANCE_TILES) * 0.32 -
      Math.max(0, BOT_STORM_EDGE_ESCAPE_CLEARANCE_TILES - stormClearanceTiles) * 1.8
    : 0;
  const exploreHeat = botExploreHeatForCell(arena, brain, cellKey);
  const phase = cellMeta?.phase === "roam" ? "roam" : "explore";
  const roamScore = Number.isFinite(cellMeta?.roamScore) ? cellMeta.roamScore : null;
  const baseScore = valueScore + adjacentScore + distanceScore + centerNoise + stormScore + (clear ? 0.12 : 0) + (empty ? 0.22 : -0.18) - threatPenalty -
    exploreHeat * BOT_EXPLORE_HEAT_TARGET_PENALTY;
  return {
    index: targetIndex,
    ...point,
    cellKey,
    distance,
    clear,
    tile,
    mineable,
    phase,
    fromCellX: Number.isFinite(cellMeta?.fromX) ? cellMeta.fromX : null,
    fromCellY: Number.isFinite(cellMeta?.fromY) ? cellMeta.fromY : null,
    visits,
    rememberedValue: botExploreRememberedCellValue(brain, cellKey),
    estimatedValue: botExploreEstimatedCellResourceValue(arena, cellX, cellY),
    stormClearanceTiles,
    exploreHeat,
    roamScore: roamScore ?? undefined,
    sweepIndex: Number.isFinite(cellMeta?.sweepIndex) ? Math.floor(cellMeta.sweepIndex) : undefined,
    sweepDistance: Number.isFinite(cellMeta?.sweepDistance) ? Math.floor(cellMeta.sweepDistance) : undefined,
    score: phase === "roam" && roamScore !== null ? roamScore : baseScore
  };
}

function botExploreTargetIndexInCell(arena, cellX, cellY) {
  const asteroid = arena.asteroid;
  const minX = cellX * BOT_EXPLORE_CELL_TILES;
  const minY = cellY * BOT_EXPLORE_CELL_TILES;
  const maxX = Math.min(asteroid.widthTiles - 1, minX + BOT_EXPLORE_CELL_TILES - 1);
  const maxY = Math.min(asteroid.heightTiles - 1, minY + BOT_EXPLORE_CELL_TILES - 1);
  const centerX = Math.floor((minX + maxX) / 2);
  const centerY = Math.floor((minY + maxY) / 2);
  let selected = null;

  for (let radius = 0; radius <= BOT_EXPLORE_CELL_TILES; radius += 1) {
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if (
          x < minX ||
          y < minY ||
          x > maxX ||
          y > maxY ||
          (radius > 0 && Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== radius)
        ) {
          continue;
        }

        const index = tileIndexAtTile(asteroid, x, y);
        if (!botExploreTileAllowed(arena, index)) {
          continue;
        }

        selected = { index, score: 0 };
        break;
      }
      if (selected) {
        break;
      }
    }

    if (selected) {
      return selected.index;
    }
  }

  return null;
}

function botExploreTileAllowed(arena, index) {
  const asteroid = arena.asteroid;
  return index !== null &&
    index >= 0 &&
    index < asteroid.tiles.length &&
    (asteroid.playable[index] === true || asteroid.playable[index] === "1") &&
    botSafeStormTile(arena, index) &&
    asteroid.tiles[index] === ASTEROID_TILE.empty;
}

function botExploreCellValueScore(arena, brain, cellX, cellY) {
  if (botExploreCellHasKnownStorm(arena, cellX, cellY)) {
    return 0;
  }

  const cellKey = botExploreCellKey(cellX, cellY);
  const remembered = botExploreRememberedCellValue(brain, cellKey);
  if (remembered !== null) {
    return remembered > 0
      ? remembered * BOT_EXPLORE_REMEMBERED_VALUE_SCALE
      : -BOT_EXPLORE_EMPTY_MEMORY_PENALTY;
  }

  return botExploreEstimatedCellResourceValue(arena, cellX, cellY) * BOT_EXPLORE_UNKNOWN_VALUE_SCALE;
}

function botExploreRememberedCellValue(brain, cellKey) {
  const memory = brain?.exploreCellValues instanceof Map
    ? brain.exploreCellValues.get(cellKey)
    : null;
  if (!memory || !Number.isFinite(memory.value)) {
    return null;
  }
  return Math.max(0, memory.value);
}

function botExploreEstimatedCellResourceValue(arena, cellX, cellY) {
  if (botExploreCellHasKnownStorm(arena, cellX, cellY)) {
    return 0;
  }

  const bounds = botExploreCellTileBounds(arena.asteroid, cellX, cellY);
  if (!bounds) {
    return 0;
  }

  let candidateTiles = 0;
  for (let tileY = bounds.minY; tileY <= bounds.maxY; tileY += 1) {
    for (let tileX = bounds.minX; tileX <= bounds.maxX; tileX += 1) {
      const index = tileIndexAtTile(arena.asteroid, tileX, tileY);
      if (
        index !== null &&
        (arena.asteroid.playable[index] === true || arena.asteroid.playable[index] === "1") &&
        botSafeStormTile(arena, index)
      ) {
        candidateTiles += 1;
      }
    }
  }

  const tileScale = candidateTiles / Math.max(1, BOT_EXPLORE_CELL_TILES * BOT_EXPLORE_CELL_TILES);
  const oreValue = BOT_EXPLORE_UNKNOWN_ORE_TILES_PER_CELL * BOT_BASE_RESOURCE_SCORE.ore;
  const diamondValue = BOT_EXPLORE_UNKNOWN_DIAMOND_TILES_PER_CELL * BOT_BASE_RESOURCE_SCORE.diamond;
  return (oreValue + diamondValue) * tileScale;
}

function updateBotExploreCellValueMemory(arena, bot, brain) {
  if (!brain.exploreCellValues || typeof brain.exploreCellValues.get !== "function") {
    brain.exploreCellValues = sanitizeExploreCellValues(brain.exploreCellValues);
  }
  if (!brain.exploredCells || typeof brain.exploredCells.get !== "function") {
    brain.exploredCells = sanitizeExploredCells(brain.exploredCells);
  }
  if (!brain.exploreHeat || typeof brain.exploreHeat.get !== "function") {
    brain.exploreHeat = sanitizeExploreHeat(brain.exploreHeat);
  }

  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || RENDER.tileSize || 16;
  const radiusTiles = Math.ceil(botHumanVisibleRadius() / tileSize);
  const originTileX = Math.floor(bot.x / tileSize);
  const originTileY = Math.floor(bot.y / tileSize);
  const cells = new Map();

  for (let tileY = originTileY - radiusTiles; tileY <= originTileY + radiusTiles; tileY += 1) {
    for (let tileX = originTileX - radiusTiles; tileX <= originTileX + radiusTiles; tileX += 1) {
      const index = tileIndexAtTile(asteroid, tileX, tileY);
      if (
        index === null ||
        !botSafeStormTile(arena, index) ||
        !botTileVisibleToBot(asteroid, bot, index)
      ) {
        continue;
      }

      const cell = botExploreCellAtIndex(asteroid, index);
      if (!cell) {
        continue;
      }

      const cellKey = botExploreCellKey(cell.x, cell.y);
      const value = botExploreTileResourceValue(arena, index);
      const entry = cells.get(cellKey) || {
        value: 0,
        ore: 0,
        diamond: 0,
        tick: arena.tick
      };
      entry.value += value;
      if (asteroid.tiles[index] === ASTEROID_TILE.ore) {
        entry.ore += botResourceAmountForTile(asteroid, index, ASTEROID_TILE.ore);
      } else if (asteroid.tiles[index] === ASTEROID_TILE.diamond) {
        entry.diamond += 1;
      }
      cells.set(cellKey, entry);
    }
  }

  for (const [cellKey, entry] of cells.entries()) {
    brain.exploreCellValues.set(cellKey, {
      value: Math.max(0, entry.value),
      ore: Math.max(0, entry.ore),
      diamond: Math.max(0, entry.diamond),
      tick: arena.tick
    });
    if (Number(brain.exploredCells?.get(cellKey) || 0) <= 0) {
      brain.exploredCells.set(cellKey, 1);
      addBotExploreHeat(brain, cellKey, BOT_EXPLORE_VISIBLE_HEAT_MARK, arena.tick);
    }
  }
}

function botExploreTileResourceValue(arena, index) {
  const asteroid = arena.asteroid;
  const tile = asteroid.tiles[index];
  if (tile === ASTEROID_TILE.ore) {
    return botResourceAmountForTile(asteroid, index, tile) * BOT_BASE_RESOURCE_SCORE.ore;
  }
  if (tile === ASTEROID_TILE.diamond) {
    return BOT_BASE_RESOURCE_SCORE.diamond;
  }
  return 0;
}

function botExploreCellTileBounds(asteroid, cellX, cellY) {
  const minX = cellX * BOT_EXPLORE_CELL_TILES;
  const minY = cellY * BOT_EXPLORE_CELL_TILES;
  if (minX >= asteroid.widthTiles || minY >= asteroid.heightTiles || cellX < 0 || cellY < 0) {
    return null;
  }
  return {
    minX,
    minY,
    maxX: Math.min(asteroid.widthTiles - 1, minX + BOT_EXPLORE_CELL_TILES - 1),
    maxY: Math.min(asteroid.heightTiles - 1, minY + BOT_EXPLORE_CELL_TILES - 1)
  };
}

function botExploreCellNoise(brain, cellKey) {
  let hash = 2166136261;
  const text = `${brain?.seed || ""}:${cellKey}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0) / 4294967295;
}

function botFleeTarget(arena, bot, brain, threat) {
  if (!botProfileActive()) {
    return botFleeTargetImpl(arena, bot, brain, threat);
  }
  return botProfileMeasure("botFleeTarget", () => botFleeTargetImpl(arena, bot, brain, threat));
}

function botFleeTargetImpl(arena, bot, brain, threat) {
  const asteroid = arena.asteroid;
  const threatKey = botFleeThreatKey(threat);
  const memoryThreat = botFleeThreatIsMemory(threat);
  const cached = botCommittedFleeTarget(arena, bot, brain, threat, threatKey);
  if (cached && !memoryThreat && arena.tick - (cached.tick || 0) < BOT_FLEE_TARGET_REPLAN_TICKS) {
    return cached;
  }
  if (cached && memoryThreat && botFleeTargetHeldTicks(brain, cached, arena.tick) < BOT_FLEE_MEMORY_MIN_HOLD_TICKS) {
    return cached;
  }

  const cellsX = Math.ceil(asteroid.widthTiles / BOT_EXPLORE_CELL_TILES);
  const cellsY = Math.ceil(asteroid.heightTiles / BOT_EXPLORE_CELL_TILES);
  const candidates = [];

  for (let cellY = 0; cellY < cellsY; cellY += 1) {
    for (let cellX = 0; cellX < cellsX; cellX += 1) {
      const target = botExploreCellTarget(arena, bot, brain, cellX, cellY, null, {
        computeClear: false,
        skipThreatRoute: true
      });
      if (!target) {
        continue;
      }

      target.preScore = botFleePreScore(bot, brain, threat, target);
      botPushTopFleeCandidate(candidates, target, BOT_FLEE_PATH_CANDIDATES);
    }
  }

  candidates.sort((a, b) => b.preScore - a.preScore);

  const openPathOptions = botPathOptions(bot, {
    allowMining: false,
    ...botFleePathOptions(arena, brain, threat),
    pathCostMaxVisited: BOT_FLEE_PATH_COST_MAX_VISITED
  });
  const openSearch = findBotPathCostsFromBot(arena, bot, openPathOptions);
  const openRoute = openSearch
    ? botBestFleeRouteFromSearch(arena, bot, brain, threat, candidates, openSearch)
    : null;
  let miningRoute = null;
  if (
    !openRoute ||
    !openRoute.escapedCurrentVisibleArea ||
    openRoute.routeSeconds > BOT_FLEE_SKIP_MINING_SEARCH_SECONDS
  ) {
    const miningPathOptions = botPathOptions(bot, { allowMining: true, ...botFleePathOptions(arena, brain, threat) });
    const miningSearch = findBotPathCostsFromBot(arena, bot, miningPathOptions);
    miningRoute = miningSearch
      ? botBestFleeRouteFromSearch(arena, bot, brain, threat, candidates, miningSearch)
      : null;
  }
  let selected = botChooseFleeRoute(openRoute, miningRoute);

  if (!selected) {
    for (const target of candidates.slice(0, BOT_FLEE_PATH_CANDIDATES)) {
      const threatDistance = distanceBetween(threat, target);
      const botDistance = distanceBetween(bot, target);
      const visits = Number(brain.exploredCells?.get(target.cellKey) || 0);
      const alignment = botFleeAlignment(bot, threat, target);
      const currentVisibleMargin = botDistance - botHumanVisibleRadius();
      const escapedCurrentVisibleArea = currentVisibleMargin >= BOT_FLEE_VISIBLE_ESCAPE_MARGIN;
      const stormClearanceTiles = botStormClearanceTiles(arena, target.index, BOT_FLEE_STORM_CLEARANCE_SCAN_TILES);
      const score = threatDistance * 0.018 +
        (escapedCurrentVisibleArea ? 80 : 0) +
        currentVisibleMargin * 0.12 +
        stormClearanceTiles * 4 +
        alignment * 1.2 -
        botDistance * 0.006 +
        target.score * 1.2 -
        (stormClearanceTiles <= 1 ? 35 : 0) -
        visits * 0.05 +
        (target.clear ? 0.4 : 0);
      if (!selected || score > selected.score) {
        selected = { ...target, score };
      }
    }
  }

  if (!selected) {
    return cached || null;
  }

  if (cached && memoryThreat && !botFleeMemoryTargetCanSwitch(brain, cached, selected, arena.tick)) {
    return cached;
  }

  brain.fleeTarget = botFleeTargetMemory(brain, selected, threatKey, arena.tick);
  return brain.fleeTarget;
}

function botPushTopFleeCandidate(candidates, candidate, limit) {
  if (candidates.length < limit) {
    candidates.push(candidate);
    return;
  }

  let worstIndex = 0;
  let worstScore = Number(candidates[0]?.preScore || 0);
  for (let index = 1; index < candidates.length; index += 1) {
    const score = Number(candidates[index]?.preScore || 0);
    if (score < worstScore) {
      worstScore = score;
      worstIndex = index;
    }
  }

  if (Number(candidate?.preScore || 0) > worstScore) {
    candidates[worstIndex] = candidate;
  }
}

function botCommittedFleeTarget(arena, bot, brain, threat, threatKey) {
  const cached = brain?.fleeTarget;
  if (!cached || cached.threatKey !== threatKey || !botFleeTargetUsable(arena, cached)) {
    return null;
  }

  const memoryThreat = botFleeThreatIsMemory(threat);
  const reachedDistance = memoryThreat
    ? Math.max(10, bot.radius * 1.2)
    : Math.max(18, bot.radius * 2);
  if (distanceBetween(bot, cached) <= reachedDistance) {
    return null;
  }

  if (!memoryThreat && botFleeAlignment(bot, threat, cached) <= -0.35) {
    return null;
  }

  return cached;
}

function botFleeTargetUsable(arena, target) {
  if (!arena.asteroid || !target) {
    return false;
  }

  const asteroid = arena.asteroid;
  const index = Number.isInteger(target.index)
    ? target.index
    : tileIndexAtPoint(asteroid, target.x, target.y);
  return index !== null &&
    index >= 0 &&
    index < asteroid.tiles.length &&
    (asteroid.playable[index] === true || asteroid.playable[index] === "1") &&
    botSafeStormTile(arena, index) &&
    botPhysicallyPassableTile(arena, index);
}

function botFleeThreatIsMemory(threat) {
  return Boolean(threat?.enemyId) && !threat?.id;
}

function botFleeMemoryTargetCanSwitch(brain, current, candidate, tick) {
  if (!candidate) {
    return false;
  }
  if (!current || botFleeTargetSame(current, candidate)) {
    return true;
  }

  const heldTicks = botFleeTargetHeldTicks(brain, current, tick);
  if (heldTicks < BOT_FLEE_MEMORY_MIN_HOLD_TICKS) {
    return false;
  }

  if (candidate.escapedCurrentVisibleArea && !current.escapedCurrentVisibleArea) {
    return true;
  }

  const currentClearance = Number(current.stormClearanceTiles || 0);
  const candidateClearance = Number(candidate.stormClearanceTiles || 0);
  if (currentClearance <= 1 && candidateClearance >= 3) {
    return true;
  }

  const currentScore = Number(current.score || 0);
  const candidateScore = Number(candidate.score || 0);
  const ratioScore = currentScore > 0
    ? currentScore * BOT_FLEE_MEMORY_SWITCH_SCORE_RATIO
    : currentScore + BOT_FLEE_MEMORY_SWITCH_SCORE_MARGIN;
  return candidateScore >= currentScore + BOT_FLEE_MEMORY_SWITCH_SCORE_MARGIN &&
    candidateScore >= ratioScore;
}

function botFleeTargetHeldTicks(brain, target, tick) {
  const current = brain?.fleeTarget;
  if (!current || !botFleeTargetSame(current, target) || !Number.isFinite(current.firstTick)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, tick - current.firstTick);
}

function botFleeTargetMemory(brain, target, threatKey, tick) {
  const previous = brain?.fleeTarget;
  const firstTick = previous &&
    previous.threatKey === threatKey &&
    botFleeTargetSame(previous, target) &&
    Number.isFinite(previous.firstTick)
      ? previous.firstTick
      : tick;
  return {
    ...target,
    threatKey,
    tick,
    firstTick
  };
}

function botFleeTargetSame(a, b) {
  if (!a || !b) {
    return false;
  }
  if (Number.isInteger(a.index) && Number.isInteger(b.index)) {
    return a.index === b.index;
  }
  if (a.cellKey && b.cellKey) {
    return a.cellKey === b.cellKey;
  }
  return false;
}

function botFleeThreatKey(threat) {
  return String(threat?.id ?? threat?.enemyId ?? "threat");
}

function botFleePreScore(bot, brain, threat, target) {
  const threatDistance = distanceBetween(threat, target);
  const botDistance = distanceBetween(bot, target);
  const currentThreatDistance = distanceBetween(threat, bot);
  const visits = Number(brain.exploredCells?.get(target.cellKey) || 0);
  const alignment = botFleeAlignment(bot, threat, target);
  const threatGain = threatDistance - currentThreatDistance;
  return threatGain * 0.02 +
    alignment * 1.4 -
    botDistance * 0.004 +
    target.score * 1.1 -
    visits * 0.04 +
    (target.clear ? 0.35 : 0);
}

function botFleePathOptions(arena, brain, threat = null) {
  const options = {
    pathCostMaxVisited: BOT_FLEE_PATH_COST_MAX_VISITED,
    pathMiningCostMultiplier: BOT_FLEE_MINING_COST_MULTIPLIER,
    pathMiningExtraSeconds: BOT_FLEE_MINING_EXTRA_SECONDS
  };
  if (threat && Number.isFinite(threat.x) && Number.isFinite(threat.y)) {
    options.pathEnemyDangerX = threat.x;
    options.pathEnemyDangerY = threat.y;
    options.pathEnemyDangerRadius = botHumanVisibleRadius() * BOT_FLEE_ENEMY_DANGER_RADIUS_SCALE;
    options.pathEnemyDangerScale = Number.isFinite(threat.decay)
      ? clamp(threat.decay, 0, 1)
      : 1;
    return options;
  }

  const rememberedThreat = botRememberedThreatPoint(arena, brain);
  if (rememberedThreat) {
    options.pathEnemyDangerX = rememberedThreat.x;
    options.pathEnemyDangerY = rememberedThreat.y;
    options.pathEnemyDangerRadius = botHumanVisibleRadius() * BOT_FLEE_ENEMY_DANGER_RADIUS_SCALE;
    options.pathEnemyDangerScale = rememberedThreat.decay;
  }
  return options;
}

function botAttackPathOptions() {
  return {
    strictPathMining: true,
    pathMiningCostMultiplier: BOT_ATTACK_MINING_COST_MULTIPLIER,
    pathMiningExtraSeconds: BOT_ATTACK_MINING_EXTRA_SECONDS
  };
}

function botBestFleeRouteFromSearch(arena, bot, brain, threat, candidates, search) {
  let selected = botBestFleeEscapeRouteFromSearch(arena, bot, brain, threat, search);
  for (const target of candidates) {
    const route = botFleeRouteFromSearch(arena, bot, target, search);
    if (!route) {
      continue;
    }

    const scoredRoute = botFleeScoredRoute(arena, bot, brain, threat, target, route);
    if (botFleeRoutePreferred(scoredRoute, selected)) {
      selected = scoredRoute;
    }
  }
  return selected;
}

function botBestFleeEscapeRouteFromSearch(arena, bot, brain, threat, search) {
  const asteroid = arena.asteroid;
  let selected = null;
  const states = Array.isArray(search.closedStates) ? search.closedStates : [];

  for (const state of states) {
    const index = botPathStateTile(state);
    if (!botFleeEndpointAllowed(arena, index, search.options)) {
      continue;
    }

    const endpoint = botNavPointForIndex(arena, index, search.options);
    if (distanceBetween(bot, endpoint) < BOT_FLEE_MIN_ROUTE_DISTANCE) {
      continue;
    }

    const route = {
      goalIndex: index,
      endpointIndex: index,
      endpoint,
      costSeconds: Math.max(0.1, search.costs[state]),
      reached: true,
      path: null,
      minedTiles: search.minedCounts[state]
    };
    const cell = botExploreCellAtIndex(asteroid, index);
    const target = {
      ...endpoint,
      index,
      cellKey: cell ? botExploreCellKey(cell.x, cell.y) : "",
      score: 0
    };
    const scoredRoute = botFleeScoredRoute(arena, bot, brain, threat, target, route);
    if (botFleeRoutePreferred(scoredRoute, selected)) {
      selected = scoredRoute;
    }
  }

  return selected;
}

function botFleeEndpointAllowed(arena, index, options = {}) {
  return botPhysicallyPassableTile(arena, index) &&
    botSafeStormTile(arena, index) &&
    botPathTileAllowed(arena, index, { ...options, allowMining: false });
}

function botChooseFleeRoute(openRoute, miningRoute) {
  if (!openRoute) {
    return miningRoute;
  }
  if (!miningRoute) {
    return openRoute;
  }

  if (openRoute.escapedCurrentVisibleArea !== miningRoute.escapedCurrentVisibleArea) {
    return openRoute.escapedCurrentVisibleArea ? openRoute : miningRoute;
  }

  if (
    openRoute.escapedCurrentVisibleArea &&
    openRoute.routeSeconds <= miningRoute.routeSeconds * BOT_FLEE_OPEN_EXIT_TIME_BIAS
  ) {
    return openRoute;
  }

  if (openRoute.escapedVisibleArea !== miningRoute.escapedVisibleArea) {
    return openRoute.escapedVisibleArea ? openRoute : miningRoute;
  }

  if (openRoute.escapedVisibleArea && miningRoute.escapedVisibleArea) {
    const delta = openRoute.routeSeconds - miningRoute.routeSeconds;
    if (Math.abs(delta) > BOT_FLEE_ROUTE_TIE_SECONDS) {
      return delta < 0 ? openRoute : miningRoute;
    }
    return openRoute.minedTiles <= miningRoute.minedTiles ? openRoute : miningRoute;
  }

  const minedTiles = Math.max(0, Number(miningRoute.minedTiles || 0));
  if (minedTiles <= 0) {
    return miningRoute.score > openRoute.score ? miningRoute : openRoute;
  }

  if (openRoute.routeSeconds <= miningRoute.routeSeconds * BOT_FLEE_OPEN_ROUTE_TIME_BIAS) {
    return openRoute;
  }

  return miningRoute.score > openRoute.score ? miningRoute : openRoute;
}

function botFleeScoredRoute(arena, bot, brain, threat, target, route) {
  const endpoint = route.endpoint;
  const asteroid = arena.asteroid;
  const currentThreatDistance = distanceBetween(threat, bot);
  const endpointThreatDistance = distanceBetween(threat, endpoint);
  const visibleRadius = botHumanVisibleRadius();
  const visibleMargin = endpointThreatDistance - visibleRadius;
  const escapedVisibleArea = visibleMargin >= BOT_FLEE_VISIBLE_ESCAPE_MARGIN;
  const endpointBotDistance = distanceBetween(bot, endpoint);
  const currentVisibleMargin = endpointBotDistance - visibleRadius;
  const escapedCurrentVisibleArea = currentVisibleMargin >= BOT_FLEE_VISIBLE_ESCAPE_MARGIN;
  const threatGain = endpointThreatDistance - currentThreatDistance;
  const alignment = botFleeAlignment(bot, threat, endpoint);
  const visits = Number(brain.exploredCells?.get(target.cellKey) || 0);
  const minedTiles = Number.isFinite(route.minedTiles)
    ? route.minedTiles
    : botPathMinedTileCount(arena, route.path);
  const stormClearanceTiles = botStormClearanceTiles(arena, route.endpointIndex, BOT_FLEE_STORM_CLEARANCE_SCAN_TILES);
  const safeNeighborCount = botSafeOpenNeighborCount(arena, route.endpointIndex);
  const stormEdgePenalty = stormClearanceTiles <= 1
    ? BOT_FLEE_STORM_EDGE_PENALTY
    : stormClearanceTiles <= 2
      ? BOT_FLEE_STORM_EDGE_PENALTY * 0.45
      : 0;
  const cornerPenalty = safeNeighborCount <= 1
    ? 75
    : safeNeighborCount <= 2
      ? 35
      : 0;
  const escapeEfficiency = (threatGain + Math.max(0, alignment) * 32) / Math.max(0.75, route.costSeconds);
  const visibilityProgress = visibleMargin / Math.max(1, asteroid.tileSize || 16);
  const currentVisibilityProgress = currentVisibleMargin / Math.max(1, asteroid.tileSize || 16);
  const score = (escapedCurrentVisibleArea ? BOT_FLEE_CURRENT_VIEW_ESCAPE_BONUS : 0) +
    (escapedVisibleArea ? 220 : 0) +
    escapeEfficiency +
    visibilityProgress * 3.8 +
    currentVisibilityProgress * 9.5 +
    Math.min(stormClearanceTiles, BOT_FLEE_STORM_CLEARANCE_SCAN_TILES) * 12 +
    threatGain * 0.018 +
    endpointThreatDistance * 0.004 +
    target.score * 0.25 -
    route.costSeconds * 1.1 -
    minedTiles * BOT_FLEE_MINED_TILE_SCORE_PENALTY -
    stormEdgePenalty -
    cornerPenalty -
    (alignment < -0.25 ? 14 : 0) +
    (route.reached ? 1.5 : -5) -
    visits * 0.04;
  const tile = arena.asteroid.tiles[route.endpointIndex];

  return {
    ...target,
    ...endpoint,
    index: route.endpointIndex,
    tile,
    mineable: botPathIndexMineable(arena, route.endpointIndex),
    partial: !route.reached,
    routeSeconds: route.costSeconds,
    minedTiles,
    visibleMargin,
    escapedVisibleArea,
    currentVisibleMargin,
    escapedCurrentVisibleArea,
    stormClearanceTiles,
    safeNeighborCount,
    score
  };
}

function botFleeRoutePreferred(candidate, selected) {
  if (!candidate) {
    return false;
  }
  if (!selected) {
    return true;
  }

  if (candidate.escapedCurrentVisibleArea !== selected.escapedCurrentVisibleArea) {
    return candidate.escapedCurrentVisibleArea;
  }

  if (candidate.escapedCurrentVisibleArea) {
    const candidateClearance = Number(candidate.stormClearanceTiles || 0);
    const selectedClearance = Number(selected.stormClearanceTiles || 0);
    if (Math.min(candidateClearance, selectedClearance) < 3 && candidateClearance !== selectedClearance) {
      return candidateClearance > selectedClearance;
    }

    if (candidate.minedTiles !== selected.minedTiles && Math.abs(candidate.routeSeconds - selected.routeSeconds) <= 1.2) {
      return candidate.minedTiles < selected.minedTiles;
    }

    const delta = candidate.routeSeconds - selected.routeSeconds;
    if (Math.abs(delta) > BOT_FLEE_ROUTE_TIE_SECONDS) {
      return delta < 0;
    }
  }

  if (candidate.escapedVisibleArea !== selected.escapedVisibleArea) {
    return candidate.escapedVisibleArea;
  }

  if (candidate.escapedVisibleArea) {
    const delta = candidate.routeSeconds - selected.routeSeconds;
    if (Math.abs(delta) > BOT_FLEE_ROUTE_TIE_SECONDS) {
      return delta < 0;
    }
    if (candidate.minedTiles !== selected.minedTiles) {
      return candidate.minedTiles < selected.minedTiles;
    }
    return candidate.visibleMargin > selected.visibleMargin;
  }

  return candidate.score > selected.score;
}

function botFleeAlignment(bot, threat, target) {
  const away = normalizeVector({
    x: bot.x - threat.x,
    y: bot.y - threat.y
  });
  const toTarget = normalizeVector({
    x: target.x - bot.x,
    y: target.y - bot.y
  });
  return away.x * toTarget.x + away.y * toTarget.y;
}

function botStormClearanceTiles(arena, index, maxTiles) {
  if (!arena.storm) {
    return maxTiles;
  }

  const asteroid = arena.asteroid;
  if (!botSafeStormTile(arena, index)) {
    return 0;
  }

  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  for (let radius = 1; radius <= maxTiles; radius += 1) {
    for (let y = tileY - radius; y <= tileY + radius; y += 1) {
      for (let x = tileX - radius; x <= tileX + radius; x += 1) {
        if (Math.max(Math.abs(x - tileX), Math.abs(y - tileY)) !== radius) {
          continue;
        }

        const neighbor = tileIndexAtTile(asteroid, x, y);
        if (!botSafeStormTile(arena, neighbor)) {
          return radius - 1;
        }
      }
    }
  }

  return maxTiles;
}

function botSafeOpenNeighborCount(arena, index) {
  const asteroid = arena.asteroid;
  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  let count = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const neighbor = tileIndexAtTile(asteroid, tileX + dx, tileY + dy);
      if (botPhysicallyPassableTile(arena, neighbor) && botSafeStormTile(arena, neighbor)) {
        count += 1;
      }
    }
  }

  return count;
}

function markBotExploredRegion(arena, bot, brain) {
  if (!brain.exploredCells || typeof brain.exploredCells.get !== "function") {
    brain.exploredCells = sanitizeExploredCells(brain.exploredCells);
  }
  if (!brain.exploreHeat || typeof brain.exploreHeat.get !== "function") {
    brain.exploreHeat = sanitizeExploreHeat(brain.exploreHeat);
  }
  updateBotExploreCellValueMemory(arena, bot, brain);

  const cell = botExploreCellAtPoint(arena.asteroid, bot.x, bot.y);
  if (!cell) {
    return;
  }

  const cellKey = botExploreCellKey(cell.x, cell.y);
  if (
    cellKey === brain.lastExploreCellKey &&
    arena.tick - (brain.lastExploreMarkTick || -Infinity) < BOT_EXPLORE_MARK_TICKS
  ) {
    return;
  }

  const visits = Number(brain.exploredCells.get(cellKey) || 0);
  brain.exploredCells.set(cellKey, Math.min(BOT_EXPLORE_VISIT_CAP, visits + 1));
  markBotExploreHeat(arena, brain, cell, arena.tick);
  brain.lastExploreCellKey = cellKey;
  brain.lastExploreMarkTick = arena.tick;
}

function markBotExploreHeat(arena, brain, cell, tick) {
  if (!cell) {
    return;
  }

  pruneBotExploreHeat(brain, tick);
  addBotExploreHeat(brain, botExploreCellKey(cell.x, cell.y), BOT_EXPLORE_HEAT_MARK, tick);

  const cellsX = Math.ceil(arena.asteroid.widthTiles / BOT_EXPLORE_CELL_TILES);
  const cellsY = Math.ceil(arena.asteroid.heightTiles / BOT_EXPLORE_CELL_TILES);
  for (const neighbor of botExploreNeighborCells(cell, cellsX, cellsY)) {
    addBotExploreHeat(brain, botExploreCellKey(neighbor.x, neighbor.y), BOT_EXPLORE_HEAT_NEIGHBOR_MARK, tick);
  }
}

function botExploreCellAtPoint(asteroid, x, y) {
  const tileX = Math.floor(x / asteroid.tileSize);
  const tileY = Math.floor(y / asteroid.tileSize);
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return null;
  }

  return {
    x: Math.floor(tileX / BOT_EXPLORE_CELL_TILES),
    y: Math.floor(tileY / BOT_EXPLORE_CELL_TILES)
  };
}

function botExploreCellAtIndex(asteroid, index) {
  if (!Number.isInteger(index) || index < 0 || index >= asteroid.tiles.length) {
    return null;
  }

  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  return {
    x: Math.floor(tileX / BOT_EXPLORE_CELL_TILES),
    y: Math.floor(tileY / BOT_EXPLORE_CELL_TILES)
  };
}

function botExploreCellKey(cellX, cellY) {
  return `${cellX}:${cellY}`;
}

function rememberBotThreatSector(arena, brain, enemy) {
  const cell = botExploreCellAtPoint(arena.asteroid, enemy.x, enemy.y);
  if (!cell) {
    return;
  }

  brain.lastThreatSector = {
    x: cell.x,
    y: cell.y,
    tick: arena.tick
  };
}

function rememberBotChaseMemory(arena, bot, brain, enemy) {
  const cell = botExploreCellAtPoint(arena.asteroid, enemy.x, enemy.y);
  if (!cell) {
    return;
  }

  const existing = brain.chaseMemory?.enemyId === enemy.id ? brain.chaseMemory : null;
  const existingAge = existing ? arena.tick - existing.lastSeenTick : Infinity;
  const existingTravel = existing ? Math.hypot(enemy.x - existing.startX, enemy.y - existing.startY) : 0;
  const enteredNewSector = !existing ||
    existing.sectorX !== cell.x ||
    existing.sectorY !== cell.y;
  const keepStart = existing &&
    existingAge <= BOT_CHASE_MEMORY_TICKS &&
    existingTravel <= botHumanVisibleRadius() * 0.85;

  brain.chaseMemory = {
    enemyId: enemy.id,
    startX: keepStart ? existing.startX : enemy.x,
    startY: keepStart ? existing.startY : enemy.y,
    lastX: enemy.x,
    lastY: enemy.y,
    sectorX: cell.x,
    sectorY: cell.y,
    sectorEntryX: enteredNewSector ? enemy.x : Number(existing.sectorEntryX ?? enemy.x),
    sectorEntryY: enteredNewSector ? enemy.y : Number(existing.sectorEntryY ?? enemy.y),
    sectorEntryTick: enteredNewSector ? arena.tick : Number(existing.sectorEntryTick ?? arena.tick),
    lastSeenTick: arena.tick
  };
}

function botThreatSectorPenalty(arena, brain, cellX, cellY) {
  const sector = botRememberedThreatSector(arena, brain);
  if (!sector) {
    return 0;
  }

  const distance = Math.hypot(cellX - sector.x, cellY - sector.y);
  if (distance > BOT_THREAT_SECTOR_AVOID_RADIUS) {
    return 0;
  }

  const falloff = 1 - distance / BOT_THREAT_SECTOR_AVOID_RADIUS;
  return BOT_THREAT_SECTOR_SCORE_PENALTY * falloff * falloff;
}

function botExploreThreatPathOptions(arena, bot, brain) {
  const sector = botRememberedThreatSector(arena, brain);
  if (!sector) {
    return {};
  }

  return {
    avoidThreatSector: sector,
    avoidThreatOriginX: bot.x,
    avoidThreatOriginY: bot.y
  };
}

function botExploreRouteThreatened(arena, bot, brain, target) {
  if (!bot || !brain || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    return false;
  }

  const sector = botRememberedThreatSector(arena, brain);
  if (!sector) {
    return false;
  }

  const rect = botThreatSectorRect(arena.asteroid, sector, BOT_THREAT_SECTOR_ROUTE_MARGIN_CELLS);
  const hit = segmentRectFirstHitPoint(bot.x, bot.y, target.x, target.y, rect);
  if (!hit) {
    return false;
  }

  const distance = Math.hypot(hit.x - bot.x, hit.y - bot.y);
  return lineOfSight(arena, bot, hit, Math.max(0, distance - (arena.asteroid.tileSize || 16) * 0.35));
}

function botThreatSectorRect(asteroid, sector, marginCells = 0) {
  const cellSize = BOT_EXPLORE_CELL_TILES * (asteroid.tileSize || 16);
  return {
    x: (sector.x - marginCells) * cellSize,
    y: (sector.y - marginCells) * cellSize,
    width: (1 + marginCells * 2) * cellSize,
    height: (1 + marginCells * 2) * cellSize
  };
}

function botRememberedThreatSector(arena, brain) {
  const sector = brain.lastThreatSector;
  if (
    !sector ||
    !Number.isFinite(sector.x) ||
    !Number.isFinite(sector.y) ||
    !Number.isFinite(sector.tick) ||
    arena.tick - sector.tick > BOT_THREAT_SECTOR_MEMORY_TICKS
  ) {
    return null;
  }

  return sector;
}

function botRememberedThreatPoint(arena, brain) {
  const memory = sanitizeChaseMemory(brain?.chaseMemory);
  if (!memory) {
    return null;
  }

  const enemy = arena.players.get(memory.enemyId);
  if (!enemy || !enemy.alive) {
    brain.chaseMemory = null;
    return null;
  }

  const ageTicks = Math.max(0, arena.tick - memory.lastSeenTick);
  if (ageTicks > BOT_CHASE_MEMORY_TICKS) {
    brain.chaseMemory = null;
    return null;
  }

  const decay = botThreatMemoryDecay(ageTicks);
  if (decay <= 0) {
    return null;
  }

  return {
    x: memory.lastX,
    y: memory.lastY,
    enemyId: memory.enemyId,
    sectorX: memory.sectorX,
    sectorY: memory.sectorY,
    cellKey: botExploreCellKey(memory.sectorX, memory.sectorY),
    ageTicks,
    decay
  };
}

function botThreatMemoryDecay(ageTicks) {
  if (!Number.isFinite(ageTicks) || ageTicks <= 0) {
    return 1;
  }
  if (ageTicks >= BOT_CHASE_MEMORY_TICKS) {
    return 0;
  }

  return Math.pow(0.5, ageTicks / BOT_THREAT_MEMORY_HALF_LIFE_TICKS);
}

function sanitizeThreatSector(sector) {
  if (
    !sector ||
    !Number.isFinite(sector.x) ||
    !Number.isFinite(sector.y) ||
    !Number.isFinite(sector.tick)
  ) {
    return null;
  }

  return {
    x: Math.floor(sector.x),
    y: Math.floor(sector.y),
    tick: Math.floor(sector.tick)
  };
}

function botChaseMemoryTarget(arena, bot, brain) {
  const memory = sanitizeChaseMemory(brain.chaseMemory);
  if (!memory || arena.tick - memory.lastSeenTick > BOT_CHASE_MEMORY_TICKS) {
    brain.chaseMemory = null;
    return null;
  }

  const enemy = arena.players.get(memory.enemyId);
  if (!enemy || !enemy.alive || enemy.id === bot.id) {
    brain.chaseMemory = null;
    return null;
  }

  const asteroid = arena.asteroid;
  const cellSize = BOT_EXPLORE_CELL_TILES * (asteroid.tileSize || 16);
  const lastPoint = { x: memory.lastX, y: memory.lastY };
  const entryPoint = {
    x: Number.isFinite(memory.sectorEntryX) ? memory.sectorEntryX : memory.startX,
    y: Number.isFinite(memory.sectorEntryY) ? memory.sectorEntryY : memory.startY
  };
  const fleeVector = {
    x: memory.lastX - entryPoint.x,
    y: memory.lastY - entryPoint.y
  };
  const fleeDistance = Math.hypot(fleeVector.x, fleeVector.y);
  const chaseDirection = fleeDistance >= BOT_CHASE_MIN_FLEE_DISTANCE
    ? { x: fleeVector.x / fleeDistance, y: fleeVector.y / fleeDistance }
    : directionBetween(bot, lastPoint);
  if (Math.hypot(chaseDirection.x, chaseDirection.y) <= 0.0001) {
    brain.chaseMemory = null;
    return null;
  }

  const sectorCenter = botExploreSectorCenter(asteroid, memory.sectorX, memory.sectorY);
  const projected = {
    x: sectorCenter.x + chaseDirection.x * cellSize * BOT_CHASE_PROJECT_SECTOR_SCALE,
    y: sectorCenter.y + chaseDirection.y * cellSize * BOT_CHASE_PROJECT_SECTOR_SCALE
  };
  const targetIndex = nearestPassableIndexNearPoint(arena, projected, bot, { allowMining: false });
  if (targetIndex === null) {
    return null;
  }

  const target = botNavPointForIndex(arena, targetIndex, { pathTileInfo: new Map() });
  if (distanceBetween(bot, target) < 20 && arena.tick - memory.lastSeenTick > 30) {
    brain.chaseMemory = null;
    return null;
  }

  return {
    ...target,
    index: targetIndex,
    enemyId: memory.enemyId,
    cellKey: botExploreCellKey(memory.sectorX, memory.sectorY),
    ageTicks: arena.tick - memory.lastSeenTick,
    decay: botThreatMemoryDecay(arena.tick - memory.lastSeenTick)
  };
}

function botExploreSectorCenter(asteroid, cellX, cellY) {
  const tileSize = asteroid.tileSize || 16;
  const minTileX = cellX * BOT_EXPLORE_CELL_TILES;
  const minTileY = cellY * BOT_EXPLORE_CELL_TILES;
  const maxTileX = Math.min(asteroid.widthTiles, minTileX + BOT_EXPLORE_CELL_TILES);
  const maxTileY = Math.min(asteroid.heightTiles, minTileY + BOT_EXPLORE_CELL_TILES);
  return {
    x: (minTileX + maxTileX) * tileSize * 0.5,
    y: (minTileY + maxTileY) * tileSize * 0.5
  };
}

function botExploreStateCompatible(options) {
  return Math.floor(Number(options?.exploreCellTiles)) === BOT_EXPLORE_CELL_TILES &&
    Math.floor(Number(options?.exploreChunkPixels)) === BOT_EXPLORE_CHUNK_PIXELS;
}

function sanitizeExploredCells(value) {
  const cells = new Map();
  if (value instanceof Map) {
    for (const [key, visits] of value.entries()) {
      addExploredCell(cells, key, visits);
    }
    return cells;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry)) {
        addExploredCell(cells, entry[0], entry[1]);
      } else {
        addExploredCell(cells, entry, 1);
      }
    }
  }

  return cells;
}

function sanitizeExploreCellValues(value) {
  const cells = new Map();
  const entries = value instanceof Map
    ? Array.from(value.entries())
    : Array.isArray(value)
      ? value
      : [];

  for (const entry of entries) {
    const key = Array.isArray(entry) ? entry[0] : null;
    const raw = Array.isArray(entry) ? entry[1] : null;
    const text = String(key || "");
    if (!/^\d+:\d+$/.test(text) || !raw || typeof raw !== "object") {
      continue;
    }

    cells.set(text, {
      value: Math.max(0, Number(raw.value || 0)),
      ore: Math.max(0, Number(raw.ore || 0)),
      diamond: Math.max(0, Number(raw.diamond || 0)),
      tick: Number.isFinite(raw.tick) ? Math.floor(raw.tick) : 0
    });
  }

  return cells;
}

function sanitizeExploreHeat(value) {
  const cells = new Map();
  const entries = value instanceof Map
    ? Array.from(value.entries())
    : Array.isArray(value)
      ? value
      : [];

  for (const entry of entries) {
    const key = Array.isArray(entry) ? entry[0] : null;
    const raw = Array.isArray(entry) ? entry[1] : null;
    const text = String(key || "");
    if (!/^\d+:\d+$/.test(text)) {
      continue;
    }

    const heat = botRawExploreHeat(raw);
    if (heat < BOT_EXPLORE_HEAT_MIN) {
      continue;
    }

    cells.set(text, {
      heat: Math.min(BOT_EXPLORE_HEAT_MAX, heat),
      tick: Number.isFinite(raw?.tick) ? Math.floor(raw.tick) : 0
    });
  }

  return cells;
}

function sanitizeMineQueue(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const queue = [];
  for (const item of value) {
    const index = Math.floor(Number(item));
    if (!Number.isInteger(index) || index < 0 || queue.includes(index)) {
      continue;
    }
    queue.push(index);
    if (queue.length >= BOT_MINING_QUEUE_LENGTH) {
      break;
    }
  }
  return queue;
}

function addExploredCell(cells, key, visits) {
  const text = String(key || "");
  if (!/^\d+:\d+$/.test(text)) {
    return;
  }

  const count = clamp(Math.floor(Number(visits) || 1), 1, BOT_EXPLORE_VISIT_CAP);
  cells.set(text, count);
}

function botExploreHeatForCell(arena, brain, cellKey) {
  return botExploreHeatValueFromMap(
    brain?.exploreHeat,
    cellKey,
    Number.isFinite(arena?.tick) ? arena.tick : 0
  );
}

function botExploreHeatValueFromMap(heatMap, cellKey, tick) {
  if (!(heatMap instanceof Map)) {
    return 0;
  }

  const entry = heatMap.get(cellKey);
  if (!entry) {
    return 0;
  }

  const heat = botDecayedExploreHeat(entry, tick);
  return heat >= BOT_EXPLORE_HEAT_MIN ? heat : 0;
}

function botDecayedExploreHeat(entry, tick) {
  const heat = botRawExploreHeat(entry);
  if (heat <= 0) {
    return 0;
  }

  const entryTick = Number.isFinite(entry?.tick) ? Math.floor(entry.tick) : tick;
  const age = Math.max(0, tick - entryTick);
  return heat * Math.pow(0.5, age / BOT_EXPLORE_HEAT_HALF_LIFE_TICKS);
}

function botRawExploreHeat(entry) {
  if (Number.isFinite(entry)) {
    return Math.max(0, Number(entry));
  }

  if (!entry || typeof entry !== "object") {
    return 0;
  }

  return Math.max(0, Number(entry.heat ?? entry.value ?? 0));
}

function addBotExploreHeat(brain, cellKey, amount, tick) {
  if (!(brain?.exploreHeat instanceof Map) || !/^\d+:\d+$/.test(String(cellKey || ""))) {
    return;
  }

  const current = botExploreHeatValueFromMap(brain.exploreHeat, cellKey, tick);
  const heat = Math.min(BOT_EXPLORE_HEAT_MAX, current + Math.max(0, amount));
  if (heat < BOT_EXPLORE_HEAT_MIN) {
    brain.exploreHeat.delete(cellKey);
    return;
  }

  brain.exploreHeat.set(cellKey, { heat, tick });
}

function pruneBotExploreHeat(brain, tick) {
  if (!(brain?.exploreHeat instanceof Map)) {
    return;
  }

  for (const [cellKey, entry] of brain.exploreHeat.entries()) {
    const heat = botDecayedExploreHeat(entry, tick);
    if (heat < BOT_EXPLORE_HEAT_MIN) {
      brain.exploreHeat.delete(cellKey);
    } else {
      brain.exploreHeat.set(cellKey, { heat, tick });
    }
  }
}

function botNavigateToPoint(arena, bot, brain, target, options = {}) {
  const distance = distanceBetween(bot, target);
  const arriveDistance = Number.isFinite(options.arriveDistance) ? options.arriveDistance : 10;
  const rayReach = Number.isFinite(options.rayReach)
    ? options.rayReach
    : botMiningRayReach(bot);

  if (target.mineable === true || isAsteroidRockTile(target.tile)) {
    return {
      move: directionBetween(bot, target?.moveTarget || target),
      ...botMiningCommandForTile(arena, bot, target, options, rayReach)
    };
  }

  const blockedGoalStillNeedsPath = options.allowMining && target.clear === false;
  if (distance <= arriveDistance && !blockedGoalStillNeedsPath) {
    if (options.allowMining && options.strictPathMining !== true) {
      const blocker = mineableBlockerTowardPoint(arena, bot, target, rayReach);
      if (blocker) {
        return {
          move: { x: 0, y: 0 },
          ...botMiningCommandForTile(arena, bot, blocker, options, rayReach)
        };
      }
    }

    return { move: { x: 0, y: 0 }, mining: false, aimAngle: null };
  }

  const pathStep = botPathStep(arena, bot, brain, target, options);
  if (!pathStep) {
    return {
      move: { x: 0, y: 0 },
      mining: false,
      aimAngle: null
    };
  }

  if (pathStep.mineable) {
    const miningCommand = botPathMiningCommand(arena, bot, brain, pathStep, options, rayReach);
    return {
      move: botPathSegmentMove(arena, bot, pathStep),
      ...(miningCommand || { mining: false, aimAngle: null })
    };
  }

  const miningCommand = botPathMiningCommand(arena, bot, brain, pathStep, options, rayReach);
  return {
    move: botPathSegmentMove(arena, bot, pathStep),
    ...(miningCommand || { mining: false, aimAngle: null })
  };
}

function botExecuteCurrentLocalPlan(arena, bot, brain, rayReach) {
  const stormEscapePlan = typeof brain?.navGoalKey === "string" &&
    brain.navGoalKey.startsWith("storm-escape:");
  const pathOptions = botVisiblePathOptions(bot, {
    allowMining: true,
    strictPathMining: true,
    allowUnsafeStorm: stormEscapePlan && !botSafeStormTile(arena, tileIndexAtPoint(arena.asteroid, bot.x, bot.y)),
    pathLimitToView: stormEscapePlan ? false : undefined
  });
  const pathStep = botExistingPathStep(arena, bot, brain, pathOptions);

  if (!pathStep) {
    return null;
  }

  if (pathStep.mineable === true) {
    const miningCommand = botPathMiningCommand(arena, bot, brain, pathStep, pathOptions, rayReach);
    return {
      move: botPathSegmentMove(arena, bot, pathStep),
      ...(miningCommand || { mining: false, aimAngle: null })
    };
  }

  const miningCommand = botPathMiningCommand(arena, bot, brain, pathStep, pathOptions, rayReach);
  return {
    move: botPathSegmentMove(arena, bot, pathStep),
    ...(miningCommand || { mining: false, aimAngle: null })
  };
}

function botExistingPathStep(arena, bot, brain, options = {}) {
  if (
    !arena.asteroid ||
    !Array.isArray(brain.navPath) ||
    !Array.isArray(brain.navPathSteps) ||
    brain.navPath.length <= 1
  ) {
    brain.mineQueue = [];
    return null;
  }

  const asteroid = arena.asteroid;
  const pathOptions = botPathOptions(bot, { ...options, gameMode: arena?.mode });
  brain.navPathCursor = clamp(Math.floor(Number(brain.navPathCursor || 0)), 0, brain.navPath.length - 1);

  while (brain.navPathCursor < brain.navPath.length - 1) {
    const nextIndex = brain.navPath[brain.navPathCursor + 1];
    const nextStep = brain.navPathSteps[brain.navPathCursor + 1] || botPathStepForIndex(arena, nextIndex, pathOptions);
    const waypoint = { x: nextStep.x, y: nextStep.y };
    const arrivalDistance = botPathArrivalDistance(asteroid, brain, brain.navPathCursor);
    if (
      botPathIndexMineable(arena, nextIndex) ||
      !botPathReachedWaypoint(arena, bot, brain, brain.navPathCursor, waypoint, arrivalDistance, pathOptions)
    ) {
      break;
    }
    brain.navPathCursor += 1;
    brain.navSegmentCursor = -1;
    brain.navSegmentProgress = 0;
  }

  if (brain.navPathCursor >= brain.navPath.length - 1) {
    brain.mineQueue = [];
    return null;
  }

  const currentCursor = brain.navPathCursor;
  let selectedCursor = null;
  const maxDirectDistance = Number.isFinite(pathOptions.maxDirectDistance)
    ? pathOptions.maxDirectDistance
    : botHumanVisibleRadius();
  for (let cursor = currentCursor + 1; cursor < brain.navPath.length; cursor += 1) {
    const index = brain.navPath[cursor];
    const step = brain.navPathSteps[cursor] || botPathStepForIndex(arena, index, pathOptions);
    if (!step) {
      break;
    }
    if (botPathIndexMineable(arena, index)) {
      if (cursor === currentCursor + 1) {
        selectedCursor = cursor;
      }
      break;
    }
    if (distanceBetween(bot, step) > maxDirectDistance) {
      break;
    }
    if (!botNavigationSegmentClear(arena, bot, step, pathOptions)) {
      break;
    }
    selectedCursor = cursor;
  }

  if (selectedCursor === null) {
    const alignStep = brain.navPathSteps[currentCursor] || botPathStepForIndex(arena, brain.navPath[currentCursor], pathOptions);
    const centerDistance = alignStep ? distanceBetween(bot, alignStep) : 0;
    if (
      alignStep &&
      alignStep.mineable !== true &&
      !botPathIndexMineable(arena, alignStep.index) &&
      centerDistance > BOT_SEGMENT_LATERAL_DEADBAND_PIXELS &&
      botNavigationSegmentClear(arena, bot, alignStep, pathOptions)
    ) {
      brain.navAttachIndex = currentCursor;
      brain.mineQueue = [];
      return {
        ...alignStep,
        fromIndex: tileIndexAtPoint(asteroid, bot.x, bot.y),
        fromX: bot.x,
        fromY: bot.y,
        progressAlong: 0,
        nextIndex: brain.navPath[currentCursor + 1] ?? null,
        direct: true,
        mineable: false
      };
    }
    brain.mineQueue = [];
    return null;
  }

  const fromCursor = Math.max(0, selectedCursor - 1);
  if (selectedCursor > brain.navPathCursor + 1) {
    brain.navPathCursor = fromCursor;
    brain.navSegmentCursor = -1;
    brain.navSegmentProgress = 0;
  }

  const fromIndex = tileIndexAtPoint(asteroid, bot.x, bot.y);
  const waypointIndex = brain.navPath[selectedCursor];
  const nextIndex = brain.navPath[selectedCursor + 1] ?? null;
  const fromStep = {
    ...(brain.navPathSteps[fromCursor] || botPathStepForIndex(arena, brain.navPath[fromCursor], pathOptions)),
    index: fromIndex,
    x: bot.x,
    y: bot.y,
    tile: asteroid.tiles[fromIndex]
  };
  const waypointStep = brain.navPathSteps[selectedCursor] || botPathStepForIndex(arena, waypointIndex, pathOptions);
  const progress = botPathSegmentProgress(bot, fromStep, waypointStep);
  if (brain.navSegmentCursor !== fromCursor) {
    brain.navSegmentCursor = fromCursor;
    brain.navSegmentProgress = Math.max(0, progress.along);
  } else {
    brain.navSegmentProgress = Math.max(Number(brain.navSegmentProgress || 0), progress.along);
  }
  const point = { x: waypointStep.x, y: waypointStep.y };
  const mineable = botPathIndexMineable(arena, waypointIndex);
  brain.navAttachIndex = selectedCursor;
  brain.mineQueue = mineable
    ? [waypointIndex]
    : botPathIndexMineable(arena, nextIndex)
      ? [nextIndex]
      : [];
  return {
    ...point,
    index: waypointIndex,
    fromIndex,
    fromX: fromStep.x,
    fromY: fromStep.y,
    progressAlong: brain.navSegmentProgress,
    nextIndex,
    direct: true,
    tile: asteroid.tiles[waypointIndex],
    mineable
  };
}

function botAttachPathCursorToFurthestVisiblePoint(arena, bot, brain, options = {}) {
  if (
    !arena.asteroid ||
    !Array.isArray(brain.navPath) ||
    !Array.isArray(brain.navPathSteps) ||
    brain.navPath.length <= 2
  ) {
    brain.navAttachIndex = brain.navPathCursor || 0;
    return brain.navAttachIndex;
  }

  const currentCursor = clamp(Math.floor(Number(brain.navPathCursor || 0)), 0, brain.navPath.length - 1);
  let selectedCursor = currentCursor;
  const visibleDistance = botHumanVisibleRadius();
  const attachOptions = {
    ...options,
    pathRadius: botPathPlanningRadius(options) + BOT_PATH_ATTACH_BUFFER_PIXELS
  };

  for (let cursor = currentCursor + 1; cursor < brain.navPath.length - 1; cursor += 1) {
    const index = brain.navPath[cursor];
    const step = brain.navPathSteps[cursor] || botPathStepForIndex(arena, index, attachOptions);
    if (!step || step.mineable === true || botPathIndexMineable(arena, index)) {
      break;
    }
    if (distanceBetween(bot, step) > visibleDistance) {
      break;
    }
    if (!botNavigationSegmentClear(arena, bot, step, attachOptions)) {
      continue;
    }
    selectedCursor = cursor;
  }

  brain.navAttachIndex = selectedCursor;
  if (selectedCursor > currentCursor) {
    brain.navPathCursor = selectedCursor;
    brain.navSegmentCursor = -1;
    brain.navSegmentProgress = 0;
    brain.trajectoryPlan = null;
  }

  return selectedCursor;
}

function botSteerToPoint(arena, bot, brain, target, options = {}) {
  return botNavigateToPoint(arena, bot, brain, target, options).move;
}

function botFirstPathMove(arena, bot, brain) {
  if (!arena.asteroid || !Array.isArray(brain?.navPath) || brain.navPath.length <= 1) {
    return null;
  }

  const cursor = clamp(Math.floor(Number(brain.navPathCursor || 0)), 0, brain.navPath.length - 1);
  const nextIndex = brain.navPath[Math.min(cursor + 1, brain.navPath.length - 1)];
  const nextStep = brain.navPathSteps?.[cursor + 1] || botPathStepForIndex(arena, nextIndex, {});
  if (!nextStep || !Number.isFinite(nextStep.x) || !Number.isFinite(nextStep.y)) {
    return null;
  }

  const move = directionBetween(bot, nextStep);
  return Math.hypot(move.x, move.y) > 0.0001 ? move : null;
}

function botPathMiningCommand(arena, bot, brain, pathStep, options = {}, rayReach) {
  if (!options.allowMining) {
    return null;
  }

  const target = pathStep?.mineable === true
    ? pathStep
    : botQueuedMineableForPrefire(arena, bot, brain, rayReach);
  if (!target) {
    return null;
  }

  const command = botMiningCommandForTile(arena, bot, target, options, rayReach);
  return command.mining ? command : null;
}

function botQueuedMineableForPrefire(arena, bot, brain, rayReach) {
  const asteroid = arena.asteroid;
  if (!asteroid) {
    return null;
  }

  const queue = botSyncMineQueue(arena, brain);
  const nextIndex = queue[0] ?? null;
  if (nextIndex === null) {
    return null;
  }

  const clearance = botTileRectClearance(asteroid, bot, nextIndex);
  if (clearance > rayReach + BOT_MINING_PREFIRE_DISTANCE) {
    return null;
  }

  const aim = botMiningAimForTile(arena, bot, nextIndex, rayReach, bot.input?.aimAngle);
  if (!aim) {
    return null;
  }

  return {
    ...tileCenter(asteroid, nextIndex),
    index: nextIndex,
    aimAngle: aim.angle,
    tile: asteroid.tiles[nextIndex],
    mineable: true
  };
}

function botSyncMineQueue(arena, brain) {
  const upcoming = botUpcomingMineablePathIndices(arena, brain, BOT_MINING_QUEUE_LENGTH * 2);
  if (upcoming.length <= 0) {
    brain.mineQueue = [];
    return brain.mineQueue;
  }

  const queue = [];
  const existing = sanitizeMineQueue(brain.mineQueue);
  for (const index of existing) {
    if (!upcoming.includes(index) || !botPathIndexMineable(arena, index) || queue.includes(index)) {
      continue;
    }
    queue.push(index);
    if (queue.length >= BOT_MINING_QUEUE_LENGTH) {
      break;
    }
  }

  for (const index of upcoming) {
    if (!botPathIndexMineable(arena, index) || queue.includes(index)) {
      continue;
    }
    queue.push(index);
    if (queue.length >= BOT_MINING_QUEUE_LENGTH) {
      break;
    }
  }

  brain.mineQueue = queue;
  return brain.mineQueue;
}

function botUpcomingMineablePathIndices(arena, brain, limit = BOT_MINING_QUEUE_LENGTH) {
  if (!Array.isArray(brain?.navPath)) {
    return [];
  }

  const indexes = [];
  const start = Math.max(0, Math.floor(brain.navPathCursor || 0) + 1);
  for (let index = start; index < brain.navPath.length; index += 1) {
    const tileIndex = brain.navPath[index];
    if (botPathIndexMineable(arena, tileIndex)) {
      indexes.push(tileIndex);
      if (indexes.length >= limit) {
        break;
      }
    }
  }

  return indexes;
}

function botPathSegmentMove(arena, bot, pathStep) {
  const move = botFollowPathSegment(arena, bot, pathStep);
  if (Math.hypot(move.x, move.y) > 0.0001) {
    return move;
  }

  return directionBetween(bot, pathStep);
}

function botFollowPathSegment(arena, bot, target) {
  const from = {
    x: Number.isFinite(target.fromX) ? target.fromX : bot.x,
    y: Number.isFinite(target.fromY) ? target.fromY : bot.y
  };
  const segment = {
    x: target.x - from.x,
    y: target.y - from.y
  };
  const segmentLength = Math.hypot(segment.x, segment.y);
  if (segmentLength <= 0.0001) {
    return { x: 0, y: 0 };
  }

  const forward = {
    x: segment.x / segmentLength,
    y: segment.y / segmentLength
  };
  const normal = {
    x: -forward.y,
    y: forward.x
  };
  const rel = {
    x: bot.x - from.x,
    y: bot.y - from.y
  };
  const along = rel.x * forward.x + rel.y * forward.y;
  const lateral = rel.x * normal.x + rel.y * normal.y;
  const progressAlong = clamp(
    Math.max(along, Number.isFinite(target.progressAlong) ? target.progressAlong : along),
    0,
    segmentLength
  );
  const remaining = segmentLength - progressAlong;
  if (remaining <= BOT_SEGMENT_PROGRESS_EPSILON) {
    return { x: 0, y: 0 };
  }

  const move = botPathCenterlineMove(arena, bot, target, forward, normal, lateral, remaining);
  if (Math.hypot(move.x, move.y) <= 0.0001) {
    return { x: 0, y: 0 };
  }
  return move;
}

function botPathCenterlineMove(arena, bot, target, forward, normal, lateral, remaining) {
  const forwardSpeed = Number(bot.vx || 0) * forward.x + Number(bot.vy || 0) * forward.y;
  const lateralSpeed = Number(bot.vx || 0) * normal.x + Number(bot.vy || 0) * normal.y;
  const lateralAbs = Math.abs(lateral);
  const stopAtTarget = target.mineable === true || !Number.isInteger(target.nextIndex);
  const coast = stopAtTarget &&
    lateralAbs <= BOT_SEGMENT_COAST_LATERAL_LIMIT_PIXELS &&
    botPathShouldCoastToStop(bot, forwardSpeed, remaining, arena?.mode);
  const alongCommand = coast ? 0 : 1;

  if (lateralAbs <= BOT_SEGMENT_LATERAL_DEADBAND_PIXELS) {
    return alongCommand > 0 ? {
      x: forward.x * alongCommand,
      y: forward.y * alongCommand
    } : { x: 0, y: 0 };
  }

  if (alongCommand <= 0) {
    return { x: 0, y: 0 };
  }

  const lateralClosing = lateral * lateralSpeed < -BOT_SEGMENT_LATERAL_SPEED_MARGIN;
  const sideCommand = lateralClosing
    ? 0
    : clamp(
      -lateral * BOT_SEGMENT_LATERAL_GAIN - lateralSpeed * BOT_SEGMENT_LATERAL_DAMPING,
      -BOT_SEGMENT_LATERAL_COMPONENT_MAX,
      BOT_SEGMENT_LATERAL_COMPONENT_MAX
    );
  return normalizeVector({
    x: forward.x * alongCommand + normal.x * sideCommand,
    y: forward.y * alongCommand + normal.y * sideCommand
  });
}

function botPathShouldCoastToStop(bot, forwardSpeed, remaining, gameMode = null) {
  if (remaining <= BOT_SEGMENT_PROGRESS_EPSILON) {
    return true;
  }
  if (forwardSpeed <= 0.0001) {
    return false;
  }

  const distance = botPathFrictionStopDistance(forwardSpeed, gameMode);
  return distance + BOT_SEGMENT_STOP_BUFFER_PIXELS >= remaining;
}

function botPathFrictionStopDistance(forwardSpeed, gameMode = null) {
  const dt = 1 / ENGINE.tickRate;
  const friction = botPhysicsFrictionForMode(gameMode);
  let speed = Math.max(0, Number(forwardSpeed || 0));
  let distance = 0;

  for (let tick = 0; tick < BOT_SEGMENT_COAST_MAX_TICKS && speed > BOT_PATH_MAX_OVERSHOOT_DOT; tick += 1) {
    speed *= friction;
    distance += speed * dt;
  }

  return distance;
}

function botPathSegmentProgress(point, from, to) {
  const segmentX = to.x - from.x;
  const segmentY = to.y - from.y;
  const segmentLength = Math.hypot(segmentX, segmentY);
  if (segmentLength <= 0.0001) {
    return {
      along: 0,
      perpendicular: 0,
      length: 0
    };
  }

  const relX = point.x - from.x;
  const relY = point.y - from.y;
  return {
    along: (relX * segmentX + relY * segmentY) / segmentLength,
    perpendicular: Math.abs(relX * segmentY - relY * segmentX) / segmentLength,
    length: segmentLength
  };
}

function botPathNonBackwardMove(move, forward) {
  const backward = move.x * forward.x + move.y * forward.y;
  if (backward >= -0.0001) {
    return botFullThrottleMove(move);
  }

  return { x: 0, y: 0 };
}

function botFullThrottleMove(move) {
  return Math.hypot(Number(move?.x || 0), Number(move?.y || 0)) > 0.0001
    ? normalizeVector(move)
    : { x: 0, y: 0 };
}

function botPathReachedWaypoint(arena, bot, brain, cursor, waypoint, arrivalDistance, options = {}) {
  if (distanceBetween(bot, waypoint) <= Math.max(arrivalDistance, BOT_PATH_POINT_TOLERANCE_PIXELS)) {
    return true;
  }

  const asteroid = arena.asteroid;
  const fromIndex = brain.navPath[cursor];
  const waypointIndex = brain.navPath[cursor + 1];
  const from = brain.navPathSteps?.[cursor] || botPathStepForIndex(arena, fromIndex, options);
  const to = brain.navPathSteps?.[cursor + 1] || {
    ...botPathStepForIndex(arena, waypointIndex, options),
    x: waypoint.x,
    y: waypoint.y
  };
  const progress = botPathSegmentProgress(bot, from, to);
  if (progress.length <= 0.0001) {
    return true;
  }

  const nextIndex = brain.navPath[cursor + 2] ?? null;
  const turning = nextIndex !== null &&
    botPathDirectionBetween(asteroid, fromIndex, waypointIndex) !==
      botPathDirectionBetween(asteroid, waypointIndex, nextIndex);
  if (turning) {
    return false;
  }

  const tileSize = asteroid.tileSize || RENDER.tileSize || 16;
  const passWidth = Math.max(tileSize * 0.8, (bot.radius || ENGINE.ship.radius) + 2);
  const arrivalBand = Math.max(arrivalDistance, tileSize * 0.25);
  if (progress.along >= progress.length - arrivalBand && progress.perpendicular <= passWidth) {
    return true;
  }

  const nextX = bot.x + Number(bot.vx || 0) / ENGINE.tickRate;
  const nextY = bot.y + Number(bot.vy || 0) / ENGINE.tickRate;
  const nextProgress = botPathSegmentProgress({ x: nextX, y: nextY }, from, to);
  return progress.along < progress.length &&
    nextProgress.along >= progress.length - arrivalBand &&
    nextProgress.perpendicular <= passWidth;
}

function botDesiredPathSpeed(arena, bot, target, distance) {
  const effects = aggregateUpgradeEffects(bot.upgrades);
  const maxSpeed = botPathAirSpeedForEffects(effects, arena?.mode);
  const tileSize = arena.asteroid?.tileSize || RENDER.tileSize || 16;
  const nextIsMineable = target.mineable === true || isAsteroidRockTile(target.tile);
  const stopDistance = nextIsMineable
    ? Math.max(tileSize * 0.5, bot.radius || ENGINE.ship.radius)
    : BOT_PATH_BRAKE_DISTANCE_PIXELS;
  const distanceScale = clamp((distance - stopDistance) / Math.max(1, tileSize * 3), 0.18, 1);
  return maxSpeed * distanceScale;
}

function botPathVelocityOvershotTarget(bot, target, direction) {
  const velocity = {
    x: Number(bot.vx || 0),
    y: Number(bot.vy || 0)
  };
  const speedToward = velocity.x * direction.x + velocity.y * direction.y;
  if (speedToward <= BOT_PATH_MAX_OVERSHOOT_DOT) {
    return false;
  }

  const nextX = bot.x + velocity.x / ENGINE.tickRate;
  const nextY = bot.y + velocity.y / ENGINE.tickRate;
  const currentDot = (target.x - bot.x) * direction.x + (target.y - bot.y) * direction.y;
  const nextDot = (target.x - nextX) * direction.x + (target.y - nextY) * direction.y;
  return currentDot > 0 && nextDot < 0;
}

function botBrakeMove(bot) {
  const speed = Math.hypot(Number(bot.vx || 0), Number(bot.vy || 0));
  if (speed <= 0.0001) {
    return { x: 0, y: 0 };
  }

  return {
    x: -bot.vx / speed,
    y: -bot.vy / speed
  };
}

function botMiningCommandForTile(arena, bot, target, options = {}, rayReach) {
  if (!options.allowMining) {
    return {
      mining: false,
      aimAngle: null
    };
  }

  const asteroid = arena.asteroid;
  const targetIndex = Number.isInteger(target.index)
    ? target.index
    : tileIndexAtPoint(asteroid, target.x, target.y);
  const point = Number.isInteger(targetIndex) && targetIndex >= 0
    ? tileCenter(asteroid, targetIndex)
    : target;
  let aim = null;
  if (Number.isInteger(targetIndex) && Number.isFinite(target.aimAngle)) {
    const preferredHit = botMiningRayMineableHit(arena, bot, target.aimAngle, rayReach, targetIndex);
    if (preferredHit) {
      aim = {
        angle: target.aimAngle,
        hit: preferredHit
      };
    }
  }
  if (!aim && Number.isInteger(targetIndex)) {
    aim = botMiningAimForTile(arena, bot, targetIndex, rayReach, target.aimAngle);
  }
  const aimAngle = aim?.angle ?? Math.atan2(point.y - bot.y, point.x - bot.x);
  const hit = aim?.hit ?? botMiningRayMineableHit(arena, bot, aimAngle, rayReach, targetIndex);

  if (hit) {
    return {
      mining: true,
      aimAngle
    };
  }

  const incidentalHit = options.allowMining && options.allowIncidentalMining === true
    ? botMiningRayMineableHit(arena, bot, aimAngle, rayReach)
    : null;
  if (incidentalHit) {
    return {
      mining: true,
      aimAngle
    };
  }

  const distance = distanceBetween(bot, point);
  const arriveDistance = Number.isFinite(options.arriveDistance) ? options.arriveDistance : rayReach * 0.74;
  if (distance <= arriveDistance) {
    const stance = botMiningStanceForTile(arena, bot, targetIndex, rayReach, options);
    if (stance) {
      const stanceAimAngle = Math.atan2(point.y - bot.y, point.x - bot.x);
      const mining = botKeepMiningRayActive(arena, bot, stanceAimAngle, rayReach, options, targetIndex);
      return {
        mining,
        aimAngle: mining ? stanceAimAngle : null
      };
    }

    return {
      mining: false,
      aimAngle: null
    };
  }

  const mining = botKeepMiningRayActive(arena, bot, aimAngle, rayReach, options, targetIndex);
  return {
    mining,
    aimAngle: mining ? aimAngle : null
  };
}

function pointRectClearanceSq(x, y, rect) {
  const right = Number(rect.x || 0) + Number(rect.width ?? rect.size ?? 0);
  const bottom = Number(rect.y || 0) + Number(rect.height ?? rect.size ?? 0);
  const dx = x < rect.x ? rect.x - x : x > right ? x - right : 0;
  const dy = y < rect.y ? rect.y - y : y > bottom ? y - bottom : 0;
  return dx * dx + dy * dy;
}

function botNthMineablePathIndex(arena, brain, currentIndex, ordinal) {
  if (!Array.isArray(brain.navPath) || !Number.isInteger(currentIndex)) {
    return null;
  }

  const pathIndex = brain.navPath.indexOf(currentIndex);
  if (pathIndex < 0) {
    return null;
  }

  let found = 0;
  for (let index = pathIndex + 1; index < brain.navPath.length; index += 1) {
    const tileIndex = brain.navPath[index];
    if (botPathIndexMineable(arena, tileIndex)) {
      found += 1;
      if (found >= ordinal) {
        return tileIndex;
      }
    }
  }

  return null;
}

function botTileRectClearance(asteroid, point, index) {
  const contact = botTileRectContact(asteroid, point, index);
  return contact ? contact.distance : Number.POSITIVE_INFINITY;
}

function botTileRectContact(asteroid, point, index) {
  const rect = botTileRectDescriptor(asteroid, index);
  if (!rect) {
    return null;
  }

  const closestX = clamp(point.x, rect.x, rect.x + rect.size);
  const closestY = clamp(point.y, rect.y, rect.y + rect.size);
  return {
    x: closestX,
    y: closestY,
    distance: Math.hypot(point.x - closestX, point.y - closestY)
  };
}

function botTileRectDescriptor(asteroid, index) {
  if (!Number.isInteger(index) || index < 0 || index >= asteroid.tiles.length) {
    return null;
  }

  const tileSize = asteroid.tileSize || 16;
  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  return {
    x: tileX * tileSize,
    y: tileY * tileSize,
    size: tileSize
  };
}

function botKeepMiningRayActive(arena, bot, aimAngle, rayReach, options = {}, targetIndex = null) {
  if (!options.allowMining) {
    return false;
  }

  return Boolean(botMiningRayMineableHit(
    arena,
    bot,
    aimAngle,
    rayReach,
    Number.isInteger(targetIndex) ? targetIndex : null
  ));
}

function botMiningAimForTile(arena, bot, targetIndex, rayReach, preferredAngle = null) {
  if (!arena.asteroid || !botPathIndexMineable(arena, targetIndex)) {
    return null;
  }

  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || RENDER.tileSize || 16;
  const tileX = targetIndex % asteroid.widthTiles;
  const tileY = Math.floor(targetIndex / asteroid.widthTiles);
  const inset = Math.max(1, Math.min(3, tileSize * 0.25));
  const fractions = [0.5, 0.28, 0.72];
  const candidates = [];
  const seenCandidates = new Set();
  const addCandidate = (x, y, centerBias = 0) => {
    const clampedX = clamp(x, tileX * tileSize + inset, (tileX + 1) * tileSize - inset);
    const clampedY = clamp(y, tileY * tileSize + inset, (tileY + 1) * tileSize - inset);
    const key = `${Math.round(clampedX * 8)}:${Math.round(clampedY * 8)}`;
    if (seenCandidates.has(key)) {
      return;
    }
    seenCandidates.add(key);
    candidates.push({ x: clampedX, y: clampedY, centerBias });
  };

  for (const fy of fractions) {
    for (const fx of fractions) {
      addCandidate(
        tileX * tileSize + fx * tileSize,
        tileY * tileSize + fy * tileSize,
        Math.hypot(fx - 0.5, fy - 0.5)
      );
    }
  }

  const left = tileX * tileSize;
  const top = tileY * tileSize;
  const right = left + tileSize;
  const bottom = top + tileSize;
  addCandidate(clamp(bot.x, left, right), clamp(bot.y, top, bottom), -0.35);
  addCandidate(left + inset, top + tileSize * 0.5, -0.2);
  addCandidate(right - inset, top + tileSize * 0.5, -0.2);
  addCandidate(left + tileSize * 0.5, top + inset, -0.2);
  addCandidate(left + tileSize * 0.5, bottom - inset, -0.2);

  let selected = null;
  for (const candidate of candidates) {
    const angle = Math.atan2(candidate.y - bot.y, candidate.x - bot.x);
    const targeting = botMiningRayTargeting(arena, bot, angle, rayReach, targetIndex);
    if (!targeting.targetHit) {
      continue;
    }

    const preferredDelta = Number.isFinite(preferredAngle)
      ? Math.abs(normalizeSignedAngle(angle - preferredAngle))
      : 0;
    const offTargetDistanceScore = targeting.offTargetCount > 0
      ? targeting.nearestOffTargetDistance * -0.01
      : 0;
    const firstHitMissPenalty = targeting.firstHit && targeting.firstHit.index !== targetIndex ? 600 : 0;
    const auxiliaryTargetPenalty = Number(targeting.targetHit.laneIndex || 0) !== 0 ? 80 : 0;
    const score = targeting.offTargetCount * 1000 +
      firstHitMissPenalty +
      auxiliaryTargetPenalty +
      offTargetDistanceScore +
      candidate.centerBias * 12 +
      targeting.targetHit.distance * 0.002 +
      preferredDelta * 0.35;
    const result = {
      angle,
      hit: targeting.targetHit,
      offTargetCount: targeting.offTargetCount,
      score
    };
    if (!selected || result.score < selected.score) {
      selected = result;
    }
  }

  return selected;
}

function botMiningRayMineableHit(arena, bot, aimAngle, rayReach, targetIndex = null) {
  const targeting = botMiningRayTargeting(arena, bot, aimAngle, rayReach, targetIndex);
  return targetIndex !== null ? targeting.targetHit : targeting.firstHit;
}

function botMiningRayTargeting(arena, bot, aimAngle, rayReach, targetIndex = null) {
  const empty = {
    firstHit: null,
    targetHit: null,
    offTargetCount: 0,
    nearestOffTargetDistance: Number.POSITIVE_INFINITY
  };
  if (!arena.asteroid || !Number.isFinite(aimAngle)) {
    return empty;
  }

  const lanes = botMiningRayLanes(arena, bot, aimAngle, rayReach);
  let firstHit = null;
  let targetHit = null;
  let offTargetCount = 0;
  let nearestOffTargetDistance = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    const hit = raycastAsteroid(arena.asteroid, lane.startX, lane.startY, lane.rayAngle, lane.rayDistance, {
      blockNonPlayable: !arena.storm
    });
    if (!hit.hit || !hit.mineable || hit.index === null || hit.index < 0) {
      continue;
    }

    const laneHit = {
      ...hit,
      laneIndex: lane.index,
      laneOffset: lane.offset
    };

    if (!firstHit || laneHit.distance < firstHit.distance) {
      firstHit = laneHit;
    }

    if (targetIndex !== null && laneHit.index === targetIndex) {
      if (!targetHit || laneHit.distance < targetHit.distance) {
        targetHit = laneHit;
      }
      continue;
    }

    if (targetIndex !== null && laneHit.index !== targetIndex) {
      offTargetCount += 1;
      nearestOffTargetDistance = Math.min(nearestOffTargetDistance, laneHit.distance);
    }
  }

  return {
    firstHit,
    targetHit,
    offTargetCount,
    nearestOffTargetDistance
  };
}

function botMiningRayLanes(arena, bot, aimAngle, rayReach) {
  const radius = Number(bot?.radius ?? ENGINE.ship.radius);
  const forwardLength = Math.max(0.000001, Number(rayReach || 0) - radius);
  const sideOffset = miningSideRayOffsetForPlayer(bot);
  return miningRayLanesForPlayer(bot, aimAngle, forwardLength, sideOffset).map((lane) => (
    botClipMiningRayLaneStart(arena, bot, lane, aimAngle)
  ));
}

function botClipMiningRayLaneStart(arena, bot, lane, aimAngle) {
  const probe = miningRaySideStartProbe(bot, lane, aimAngle);
  if (!probe || !arena.asteroid) {
    return lane;
  }

  const hit = raycastAsteroid(arena.asteroid, probe.startX, probe.startY, probe.angle, probe.distance, {
    blockNonPlayable: !arena.storm
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

function botAdjacentOpenWanderTarget(arena, bot, brain) {
  let selected = null;
  for (const cell of botExploreFrontierCells(arena, bot, brain)) {
    const target = botExploreCellTarget(arena, bot, brain, cell.x, cell.y, cell);
    if (!target) {
      continue;
    }
    const score = target.score - distanceBetween(bot, target) * 0.002;
    if (!selected || score > selected.score) {
      selected = { ...target, score };
    }
  }
  return selected;
}

function botOpenWanderTarget(arena, bot, brain) {
  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || 16;
  const originTileX = Math.floor(bot.x / tileSize);
  const originTileY = Math.floor(bot.y / tileSize);
  const currentIndex = tileIndexAtTile(asteroid, originTileX, originTileY);
  const maxRadiusTiles = Math.ceil(botHumanVisibleRadius() / tileSize);
  let selected = null;

  for (let radius = 2; radius <= maxRadiusTiles; radius += 1) {
    for (let y = originTileY - radius; y <= originTileY + radius; y += 1) {
      for (let x = originTileX - radius; x <= originTileX + radius; x += 1) {
        if (Math.max(Math.abs(x - originTileX), Math.abs(y - originTileY)) !== radius) {
          continue;
        }

        const index = tileIndexAtTile(asteroid, x, y);
        if (index === currentIndex || !botPathTileAllowed(arena, index, { allowMining: false })) {
          continue;
        }

        const point = tileCenter(asteroid, index);
        const distance = distanceBetween(bot, point);
        if (distance > botHumanVisibleRadius()) {
          continue;
        }

        const clear = lineOfSight(arena, bot, point, Math.max(0, distance - bot.radius)) &&
          botStormSegmentSafe(arena, bot, point);
        if (!clear) {
          continue;
        }

        const score = Math.abs(distance - botHumanVisibleRadius() * 0.45) + brain.random() * tileSize;
        if (!selected || score < selected.score) {
          selected = { ...point, index, score };
        }
      }
    }

    if (selected && radius >= 5) {
      return selected;
    }
  }

  return selected;
}

function mineableBlockerTowardPoint(arena, bot, target, rayReach) {
  const distance = distanceBetween(bot, target);
  if (distance <= 0) {
    return null;
  }

  const angle = Math.atan2(target.y - bot.y, target.x - bot.x);
  const hit = raycastAsteroid(
    arena.asteroid,
    bot.x,
    bot.y,
    angle,
    Math.min(Math.max(distance, rayReach), rayReach),
    { blockNonPlayable: !arena.storm }
  );
  if (!hit.hit || !hit.mineable || hit.index === null || hit.index < 0) {
    return null;
  }

  return {
    index: hit.index,
    x: hit.x,
    y: hit.y,
    distance: hit.distance,
    tile: hit.tile,
    mineable: true
  };
}

function botMiningStanceForTile(arena, bot, targetIndex, rayReach, options = {}) {
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    return null;
  }

  const asteroid = arena.asteroid;
  const target = tileCenter(asteroid, targetIndex);
  const targetTileX = targetIndex % asteroid.widthTiles;
  const targetTileY = Math.floor(targetIndex / asteroid.widthTiles);
  let selected = null;

  for (let radius = 1; radius <= 4; radius += 1) {
    for (let y = targetTileY - radius; y <= targetTileY + radius; y += 1) {
      for (let x = targetTileX - radius; x <= targetTileX + radius; x += 1) {
        if (Math.max(Math.abs(x - targetTileX), Math.abs(y - targetTileY)) !== radius) {
          continue;
        }

        const index = tileIndexAtTile(asteroid, x, y);
        if (!botPathTileAllowed(arena, index, { ...options, allowMining: false })) {
          continue;
        }

        const point = tileCenter(asteroid, index);
        if (distanceBetween(point, target) > rayReach * 0.92) {
          continue;
        }

        const angle = Math.atan2(target.y - point.y, target.x - point.x);
        const hit = raycastAsteroid(asteroid, point.x, point.y, angle, rayReach, {
          blockNonPlayable: !arena.storm
        });
        if (!hit.hit || !hit.mineable || hit.index !== targetIndex) {
          continue;
        }

        const score = distanceBetween(bot, point);
        if (!selected || score < selected.score) {
          selected = { ...point, index, score };
        }
      }
    }

    if (selected) {
      return selected;
    }
  }

  return null;
}

function botPathStep(arena, bot, brain, target, options = {}) {
  if (!botProfileActive()) {
    return botPathStepImpl(arena, bot, brain, target, options);
  }
  return botProfileMeasure("botPathStep", () => botPathStepImpl(arena, bot, brain, target, options));
}

function botPathStepImpl(arena, bot, brain, target, options = {}) {
  const asteroid = arena.asteroid;
  const pathOptions = botVisiblePathOptions(bot, options);
  const startIndex = tileIndexAtPoint(asteroid, bot.x, bot.y);
  if (!botPathTileAllowed(arena, startIndex, { ...pathOptions, startIndex, allowUnsafeStart: true })) {
    clearBotNav(brain);
    return null;
  }

  const pathTarget = botVisiblePathTarget(arena, bot, target, pathOptions);
  const goalIndex = botPathGoalIndex(arena, pathTarget, bot, pathOptions);
  if (goalIndex === null) {
    clearBotNav(brain);
    return null;
  }

  if (startIndex === goalIndex) {
    clearBotNav(brain);
    return pathTarget;
  }

  const viewTileSize = asteroid.tileSize || RENDER.tileSize || 16;
  const viewKey = `${Math.floor(bot.x / viewTileSize)},${Math.floor(bot.y / viewTileSize)}`;
  const goalKey = `${options.key || "point"}:${goalIndex}:${options.allowMining ? "m" : "a"}:${options.allowUnsafeStorm ? "u" : "s"}:${viewKey}:${botPathThreatKey(pathOptions)}:${botPathDangerKey(pathOptions)}`;
  const needsPlan = brain.navGoalKey !== goalKey ||
    !Array.isArray(brain.navPath) ||
    !Array.isArray(brain.navPathSteps) ||
    brain.navPath.length === 0 ||
    brain.navPathSteps.length === 0 ||
    arena.tick - (brain.navUpdatedTick || 0) >= BOT_PATH_REPLAN_TICKS;

  if (needsPlan) {
    brain.navGoalKey = goalKey;
    const plannedSteps = findBotAStarPathSteps(arena, bot, startIndex, goalIndex, pathOptions);
    if (plannedSteps.length <= 1) {
      brain.navPath = [];
      brain.navPathSteps = [];
      brain.navPathCursor = 0;
      brain.navSegmentCursor = -1;
      brain.navSegmentProgress = 0;
      brain.navAttachIndex = 0;
      brain.navUpdatedTick = arena.tick;
      return null;
    }

    brain.navPathSteps = plannedSteps;
    brain.navPath = plannedSteps.map((step) => step.index);
    brain.navPathCursor = 0;
    brain.navSegmentCursor = -1;
    brain.navSegmentProgress = 0;
    brain.navAttachIndex = 0;
    brain.navUpdatedTick = arena.tick;
  }

  return botExistingPathStep(arena, bot, brain, pathOptions);
}

function findBotAStarPathSteps(arena, bot, startIndex, goalIndex, options = {}) {
  if (!botProfileActive()) {
    return findBotAStarPathStepsImpl(arena, bot, startIndex, goalIndex, options);
  }
  return botProfileMeasure("findBotAStarPathSteps", () => findBotAStarPathStepsImpl(arena, bot, startIndex, goalIndex, options));
}

function findBotAStarPathStepsImpl(arena, bot, startIndex, goalIndex, options = {}) {
  const tilePath = startIndex === goalIndex
    ? []
    : findBotPath(arena, startIndex, goalIndex, options);
  if (startIndex !== goalIndex && tilePath.length <= 0) {
    return [];
  }

  const fullPath = [startIndex, ...tilePath];
  return botStepsForTilePath(arena, bot, startIndex, fullPath, options);
}

function botStepsForTilePath(arena, bot, startIndex, path, options = {}) {
  const steps = [];
  if (!Array.isArray(path)) {
    return steps;
  }

  for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
    const index = path[pathIndex];
    const step = pathIndex === 0
      ? {
          index: startIndex,
          ...tileCenter(arena.asteroid, startIndex),
          tile: arena.asteroid.tiles[startIndex],
          mineable: botPathIndexMineable(arena, startIndex)
        }
      : botPathStepForIndex(arena, index, options);
    if (!step || step.index === null) {
      continue;
    }
    steps.push(step);
  }

  return steps;
}

function findBotThetaPath(arena, bot, startIndex, goalIndex, options = {}) {
  const asteroid = arena.asteroid;
  const gridWidth = asteroid.widthTiles;
  const gridHeight = asteroid.heightTiles;
  const nodeCount = gridWidth * gridHeight;
  const startNode = botThetaNodeForPoint(asteroid, bot.x, bot.y);
  const goalPoint = tileCenter(asteroid, goalIndex);
  const goalNode = botThetaNodeForPoint(asteroid, goalPoint.x, goalPoint.y);
  if (startNode < 0 || goalNode < 0) {
    return [];
  }

  const parent = new Int32Array(nodeCount);
  const costs = new Float32Array(nodeCount);
  const closed = new Uint8Array(nodeCount);
  parent.fill(-2);
  costs.fill(Number.POSITIVE_INFINITY);
  parent[startNode] = startNode;
  costs[startNode] = 0;

  const open = [];
  pushOpenPathState(open, startNode, botThetaHeuristicSeconds(asteroid, startNode, goalNode, gridWidth, options));
  let visited = 0;
  let bestNode = startNode;
  let bestHeuristic = botThetaHeuristicSeconds(asteroid, startNode, goalNode, gridWidth, options);

  while (open.length > 0 && visited < BOT_THETA_MAX_VISITED) {
    const entry = takeLowestOpenPathState(open);
    const current = entry.state;
    if (closed[current]) {
      continue;
    }

    closed[current] = 1;
    visited += 1;
    const currentIndex = botThetaNodeTileIndex(asteroid, current, gridWidth);
    if (currentIndex === goalIndex) {
      return botSafeThetaPathSteps(arena, bot, parent, startNode, current, gridWidth, options);
    }

    const currentHeuristic = botThetaHeuristicSeconds(asteroid, current, goalNode, gridWidth, options);
    if (currentHeuristic < bestHeuristic) {
      bestHeuristic = currentHeuristic;
      bestNode = current;
    }

    for (const neighbor of botThetaNeighbors(current, gridWidth, gridHeight)) {
      if (
        closed[neighbor] ||
        !botThetaNeighborAllowed(arena, current, neighbor, gridWidth, startIndex, options)
      ) {
        continue;
      }

      let source = current;
      let nextCost = costs[current] + botThetaMoveCostSeconds(arena, current, neighbor, gridWidth, options);
      const parentNode = parent[current];
      if (
        parentNode >= 0 &&
        parentNode !== current &&
        botThetaCanSkipParent(arena, parentNode, neighbor, gridWidth, startIndex, options)
      ) {
        const skipCost = costs[parentNode] + botThetaMoveCostSeconds(arena, parentNode, neighbor, gridWidth, options);
        if (skipCost < nextCost) {
          source = parentNode;
          nextCost = skipCost;
        }
      }

      if (nextCost >= costs[neighbor] - 0.000001) {
        continue;
      }

      costs[neighbor] = nextCost;
      parent[neighbor] = source;
      pushOpenPathState(
        open,
        neighbor,
        nextCost + botThetaHeuristicSeconds(asteroid, neighbor, goalNode, gridWidth, options)
      );
    }
  }

  return bestNode !== startNode
    ? botSafeThetaPathSteps(arena, bot, parent, startNode, bestNode, gridWidth, options)
    : [];
}

function botSafeThetaPathSteps(arena, bot, parent, startNode, endNode, gridWidth, options = {}) {
  const steps = botThetaPathSteps(arena, bot, parent, startNode, endNode, gridWidth, options);
  return botPathStepsShipSafe(steps) ? steps : [];
}

function botPathStepsShipSafe(steps) {
  if (!Array.isArray(steps) || steps.length <= 1) {
    return false;
  }

  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const step = steps[index];
    if (previous?.mineable === true || step?.mineable === true) {
      continue;
    }
    if (step?.directFromPrevious !== true) {
      return false;
    }
  }

  return true;
}

function botThetaNodeForPoint(asteroid, x, y) {
  const tileSize = asteroid.tileSize || RENDER.tileSize || 16;
  const tileX = clamp(Math.floor(x / tileSize), 0, asteroid.widthTiles - 1);
  const tileY = clamp(Math.floor(y / tileSize), 0, asteroid.heightTiles - 1);
  return botThetaNodeId(tileX, tileY, asteroid.widthTiles);
}

function botThetaNodeId(tileX, tileY, gridWidth) {
  return tileY * gridWidth + tileX;
}

function botThetaNodeGridX(node, gridWidth) {
  return node % gridWidth;
}

function botThetaNodeGridY(node, gridWidth) {
  return Math.floor(node / gridWidth);
}

function botThetaNodePoint(asteroid, node, gridWidth) {
  const tileSize = asteroid.tileSize || RENDER.tileSize || 16;
  return {
    x: botThetaNodeGridX(node, gridWidth) * tileSize + tileSize * 0.5,
    y: botThetaNodeGridY(node, gridWidth) * tileSize + tileSize * 0.5
  };
}

function botThetaNodeTileIndex(asteroid, node, gridWidth) {
  const tileX = clamp(botThetaNodeGridX(node, gridWidth), 0, asteroid.widthTiles - 1);
  const tileY = clamp(botThetaNodeGridY(node, gridWidth), 0, asteroid.heightTiles - 1);
  return tileIndexAtTile(asteroid, tileX, tileY);
}

function botThetaNodeTileXY(asteroid, node, gridWidth) {
  return {
    x: clamp(botThetaNodeGridX(node, gridWidth), 0, asteroid.widthTiles - 1),
    y: clamp(botThetaNodeGridY(node, gridWidth), 0, asteroid.heightTiles - 1)
  };
}

function botThetaNeighbors(node, gridWidth, gridHeight) {
  const tileX = botThetaNodeGridX(node, gridWidth);
  const tileY = botThetaNodeGridY(node, gridWidth);
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = tileX + dx;
      const y = tileY + dy;
      if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) {
        continue;
      }
      neighbors.push(botThetaNodeId(x, y, gridWidth));
    }
  }
  return neighbors;
}

function botThetaNeighborAllowed(arena, fromNode, toNode, gridWidth, startIndex, options = {}) {
  const asteroid = arena.asteroid;
  const fromIndex = botThetaNodeTileIndex(asteroid, fromNode, gridWidth);
  const toIndex = botThetaNodeTileIndex(asteroid, toNode, gridWidth);
  if (!botPathTileAllowed(arena, toIndex, { ...options, startIndex, allowUnsafeStart: toIndex === startIndex })) {
    return false;
  }
  if (
    toIndex !== startIndex &&
    !botPathIndexMineable(arena, toIndex) &&
    !botThetaNodeShipClear(arena, toNode, gridWidth, options)
  ) {
    return false;
  }

  const fromMineable = botPathIndexMineable(arena, fromIndex);
  const toMineable = botPathIndexMineable(arena, toIndex);
  if (toMineable && !options.allowMining) {
    return false;
  }
  if (fromMineable && toMineable && fromIndex === toIndex) {
    return false;
  }

  const fromTile = botThetaNodeTileXY(asteroid, fromNode, gridWidth);
  const toTile = botThetaNodeTileXY(asteroid, toNode, gridWidth);
  const tileDx = toTile.x - fromTile.x;
  const tileDy = toTile.y - fromTile.y;
  if ((fromMineable || toMineable) && Math.abs(tileDx) === 1 && Math.abs(tileDy) === 1) {
    return false;
  }

  if (!fromMineable && !toMineable) {
    return botThetaOpenSegmentClear(arena, fromNode, toNode, gridWidth, options);
  }

  return true;
}

function botThetaCanSkipParent(arena, fromNode, toNode, gridWidth, startIndex, options = {}) {
  const asteroid = arena.asteroid;
  const fromIndex = botThetaNodeTileIndex(asteroid, fromNode, gridWidth);
  const toIndex = botThetaNodeTileIndex(asteroid, toNode, gridWidth);
  if (
    botPathIndexMineable(arena, fromIndex) ||
    botPathIndexMineable(arena, toIndex) ||
    !botPathTileAllowed(arena, toIndex, { ...options, startIndex }) ||
    (
      toIndex !== startIndex &&
      !botThetaNodeShipClear(arena, toNode, gridWidth, options)
    )
  ) {
    return false;
  }

  return botThetaOpenSegmentClear(arena, fromNode, toNode, gridWidth, options);
}

function botThetaOpenSegmentClear(arena, fromNode, toNode, gridWidth, options = {}) {
  const asteroid = arena.asteroid;
  const from = botThetaNodePoint(asteroid, fromNode, gridWidth);
  const to = botThetaNodePoint(asteroid, toNode, gridWidth);
  if (!options.allowUnsafeStorm && !botStormSegmentSafe(arena, from, to)) {
    return false;
  }

  return botNavigationSegmentClear(arena, from, to, options);
}

function botThetaNodeShipClear(arena, node, gridWidth, options = {}) {
  const point = botThetaNodePoint(arena.asteroid, node, gridWidth);
  return botNavigationPointClear(arena, point, options);
}

function botThetaMoveCostSeconds(arena, fromNode, toNode, gridWidth, options = {}) {
  const asteroid = arena.asteroid;
  const from = botThetaNodePoint(asteroid, fromNode, gridWidth);
  const to = botThetaNodePoint(asteroid, toNode, gridWidth);
  const fromIndex = botThetaNodeTileIndex(asteroid, fromNode, gridWidth);
  const toIndex = botThetaNodeTileIndex(asteroid, toNode, gridWidth);
  let cost = Math.max(0.001, distanceBetween(from, to) / botPathAirSpeed(options));

  if (fromIndex !== toIndex && botPathIndexMineable(arena, toIndex)) {
    cost += botMiningSecondsForTile(arena, toIndex, options);
  }

  if (!botSafeStormTile(arena, toIndex) && options.allowUnsafeStorm) {
    cost += BOT_PATH_STORM_TILE_SECONDS;
  }

  cost += botPathThreatSectorCostSeconds(arena, toIndex, options);
  cost += botPathEnemyDangerCostSeconds(arena, toIndex, options);
  return cost;
}

function botThetaHeuristicSeconds(asteroid, node, goalNode, gridWidth, options = {}) {
  const from = botThetaNodePoint(asteroid, node, gridWidth);
  const to = botThetaNodePoint(asteroid, goalNode, gridWidth);
  return distanceBetween(from, to) / botPathAirSpeed(options);
}

function botThetaPathSteps(arena, bot, parent, startNode, endNode, gridWidth, options = {}) {
  const nodes = [];
  let current = endNode;
  let guard = 0;
  while (current >= 0 && guard < parent.length) {
    nodes.push(current);
    if (current === startNode) {
      break;
    }
    current = parent[current];
    guard += 1;
  }

  if (nodes[nodes.length - 1] !== startNode) {
    return [];
  }

  nodes.reverse();
  const steps = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const step = index === 0
      ? {
          index: tileIndexAtPoint(arena.asteroid, bot.x, bot.y),
          ...botThetaNodePoint(arena.asteroid, startNode, gridWidth)
        }
      : botThetaStepForNode(arena, nodes[index], gridWidth, options);
    if (!step || step.index === null) {
      continue;
    }

    const previous = steps[steps.length - 1];
    if (
      previous &&
      previous.index === step.index &&
      botPathIndexMineable(arena, step.index)
    ) {
      continue;
    }
    steps.push(step);
  }
  return annotateBotPathStepSegments(arena, steps, options);
}

function annotateBotPathStepSegments(arena, steps, options = {}) {
  if (!Array.isArray(steps) || steps.length <= 0) {
    return [];
  }

  const annotated = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = {
      ...steps[index],
      directFromPrevious: false
    };
    if (index > 0) {
      step.directFromPrevious = botPathSegmentPointsDirect(
        arena,
        annotated[index - 1],
        step,
        options
      );
    }
    annotated.push(step);
  }

  return annotated;
}

function botThetaStepForNode(arena, node, gridWidth, options = {}) {
  const asteroid = arena.asteroid;
  const index = botThetaNodeTileIndex(asteroid, node, gridWidth);
  if (index === null) {
    return null;
  }

  const point = botPathIndexMineable(arena, index)
    ? tileCenter(asteroid, index)
    : botThetaNodePoint(asteroid, node, gridWidth);
  return {
    index,
    x: point.x,
    y: point.y,
    tile: asteroid.tiles[index],
    mineable: botPathIndexMineable(arena, index)
  };
}

function contractBotPath(arena, path, options = {}) {
  if (!Array.isArray(path) || path.length <= 2) {
    return path;
  }

  const contracted = [path[0]];
  let cursor = 0;
  while (cursor < path.length - 1) {
    let best = cursor + 1;
    const limit = Math.min(path.length - 1, cursor + BOT_PATH_CONTRACT_MAX_NODES);
    for (let candidate = limit; candidate > cursor + 1; candidate -= 1) {
      if (botPathSegmentDirect(arena, path[cursor], path[candidate], options)) {
        best = candidate;
        break;
      }
    }
    contracted.push(path[best]);
    cursor = best;
  }

  return contracted;
}

function botPathSegmentDirect(arena, fromIndex, toIndex, options = {}) {
  if (fromIndex === null || toIndex === null || fromIndex === toIndex) {
    return false;
  }

  if (botPathIndexMineable(arena, fromIndex) || botPathIndexMineable(arena, toIndex)) {
    return false;
  }

  const from = botNavPointForIndex(arena, fromIndex, options);
  const to = botNavPointForIndex(arena, toIndex, options);
  return botNavigationSegmentClear(arena, from, to, options);
}

function botPathStepForIndex(arena, index, options = {}) {
  const point = botNavPointForIndex(arena, index, options);
  return {
    index,
    x: point.x,
    y: point.y,
    tile: arena.asteroid.tiles[index],
    mineable: botPathIndexMineable(arena, index)
  };
}

function botPathSegmentPointsDirect(arena, fromStep, toStep, options = {}) {
  if (!fromStep || !toStep || fromStep.index === toStep.index) {
    return false;
  }
  if (toStep.mineable === true || botPathIndexMineable(arena, toStep.index)) {
    return false;
  }
  if (!options.allowUnsafeStorm && !botStormSegmentSafe(arena, fromStep, toStep)) {
    return false;
  }
  return botNavigationSegmentClear(arena, fromStep, toStep, options);
}

function botPathArrivalDistance(asteroid, brain, cursor) {
  const fromIndex = brain.navPath[cursor];
  const toIndex = brain.navPath[cursor + 1];
  const nextIndex = brain.navPath[cursor + 2] ?? null;
  const turning = nextIndex !== null &&
    botPathDirectionBetween(asteroid, fromIndex, toIndex) !==
      botPathDirectionBetween(asteroid, toIndex, nextIndex);
  return Math.max(
    BOT_PATH_POINT_TOLERANCE_PIXELS,
    turning ? BOT_PATH_TURN_ARRIVAL_PIXELS : BOT_PATH_STRAIGHT_ARRIVAL_PIXELS
  );
}

function botPathRouteToTarget(arena, bot, target, options = {}) {
  const asteroid = arena.asteroid;
  const pathOptions = botPathOptions(bot, { ...options, gameMode: arena?.mode });
  const startIndex = tileIndexAtPoint(asteroid, bot.x, bot.y);
  if (!botPathTileAllowed(arena, startIndex, { ...pathOptions, startIndex, allowUnsafeStart: true })) {
    return null;
  }

  const goalIndex = botPathGoalIndex(arena, target, bot, pathOptions);
  if (goalIndex === null) {
    return null;
  }

  const path = startIndex === goalIndex
    ? []
    : findBotPath(arena, startIndex, goalIndex, pathOptions);
  if (startIndex !== goalIndex && path.length === 0) {
    return null;
  }

  const endpointIndex = path.length > 0 ? path[path.length - 1] : goalIndex;
  if (endpointIndex === null || endpointIndex < 0) {
    return null;
  }

  return {
    goalIndex,
    endpointIndex,
    endpoint: botNavPointForIndex(arena, endpointIndex, pathOptions),
    costSeconds: botPathCostSeconds(arena, path, pathOptions),
    reached: endpointIndex === goalIndex,
    path
  };
}

function findBotPathCostsFromBot(arena, bot, options = {}) {
  const asteroid = arena.asteroid;
  const startIndex = tileIndexAtPoint(asteroid, bot.x, bot.y);
  if (!botPathTileAllowed(arena, startIndex, { ...options, startIndex, allowUnsafeStart: true })) {
    return null;
  }

  return findBotPathCosts(arena, startIndex, options);
}

function botFleeRouteFromSearch(arena, bot, target, search) {
  const goalIndex = botPathGoalIndex(arena, target, bot, {
    ...search.options,
    allowMining: false
  });
  if (goalIndex === null) {
    return null;
  }

  const endpointState = bestBotPathStateForIndex(search, goalIndex);
  if (endpointState < 0) {
    return null;
  }

  const endpointIndex = botPathStateTile(endpointState);
  return {
    goalIndex,
    endpointIndex,
    endpoint: botNavPointForIndex(arena, endpointIndex, search.options),
    costSeconds: Math.max(0.1, search.costs[endpointState]),
    reached: endpointIndex === goalIndex,
    path: null,
    minedTiles: search.minedCounts[endpointState]
  };
}

function botPathOptions(bot, options = {}) {
  if (options.pathPrepared === true) {
    return options;
  }

  const effects = aggregateUpgradeEffects(bot?.upgrades);
  const threatSector = sanitizeThreatSector(options.avoidThreatSector);
  return {
    ...options,
    pathPrepared: true,
    pathRadius: Math.max(1, Number(options.pathRadius ?? bot?.radius ?? ENGINE.ship.radius ?? 7)),
    pathAirSpeed: botPathAirSpeedForEffects(effects, options.gameMode ?? options.mode),
    pathMiningPower: Math.max(0.1, Number(effects.miningPowerMultiplier || 1)),
    pathTileInfo: options.pathTileInfo instanceof Map ? options.pathTileInfo : new Map(),
    pathStormClearance: options.pathStormClearance instanceof Map ? options.pathStormClearance : new Map(),
    pathThreatSector: threatSector,
    pathThreatOriginX: Number.isFinite(options.avoidThreatOriginX) ? options.avoidThreatOriginX : bot?.x,
    pathThreatOriginY: Number.isFinite(options.avoidThreatOriginY) ? options.avoidThreatOriginY : bot?.y,
    pathThreatVisibility: options.pathThreatVisibility instanceof Map ? options.pathThreatVisibility : new Map()
  };
}

function botVisiblePathOptions(bot, options = {}) {
  if (options.pathLimitToView === false) {
    return botPathOptions(bot, options);
  }

  return botPathOptions(bot, {
    ...options,
    pathLimitToView: true,
    pathViewOriginX: Number(bot?.x || 0),
    pathViewOriginY: Number(bot?.y || 0),
    pathViewRadius: botHumanVisibleRadius()
  });
}

function botVisiblePathTarget(arena, bot, target, options = {}) {
  if (
    options.pathLimitToView === false ||
    !arena.asteroid ||
    !target ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y)
  ) {
    return target;
  }

  const radius = Number.isFinite(options.pathViewRadius) ? options.pathViewRadius : botHumanVisibleRadius();
  const tileSize = arena.asteroid.tileSize || RENDER.tileSize || 16;
  const distance = distanceBetween(bot, target);
  if (distance <= Math.max(0, radius - tileSize * 0.5)) {
    return target;
  }

  const angle = Math.atan2(target.y - bot.y, target.x - bot.x);
  const point = pointAtAngle(bot, angle, Math.max(0, radius - tileSize));
  return {
    ...target,
    x: point.x,
    y: point.y,
    index: tileIndexAtPoint(arena.asteroid, point.x, point.y),
    clear: false,
    mineable: false
  };
}

function botPreparePathSearchOptions(asteroid, options = {}, startIndex = null) {
  return {
    ...options,
    startIndex,
    pathAllowedCache: new Int8Array(asteroid.tiles.length),
    pathTileCostCache: new Float32Array(asteroid.tiles.length)
  };
}

function botPathThreatKey(options = {}) {
  const sector = options.pathThreatSector;
  return sector
    ? `t${sector.x},${sector.y},${sector.tick}`
    : "t-";
}

function botPathDangerKey(options = {}) {
  if (!Number.isFinite(options.pathEnemyDangerX) || !Number.isFinite(options.pathEnemyDangerY)) {
    return "e-";
  }

  const tileSize = RENDER.tileSize || 16;
  const scale = Number.isFinite(options.pathEnemyDangerScale)
    ? clamp(options.pathEnemyDangerScale, 0, 1)
    : 1;
  return `e${Math.round(options.pathEnemyDangerX / tileSize)},${Math.round(options.pathEnemyDangerY / tileSize)},${Math.round(scale * 100)}`;
}

function botPathAirSpeedForEffects(effects, gameMode = null) {
  const mode = botGameMode(gameMode);
  const speedScale = mode === GAME_MODES.clouds
    ? Math.max(0.01, Number(ENGINE.clouds.speedMultiplier) || 1)
    : 1;
  return Math.max(
    1,
    (ENGINE.ship.baseTerminalSpeed || 1) * speedScale * Math.max(0.1, Number(effects.thrustMultiplier || 1))
  );
}

function botGameMode(gameMode) {
  return gameMode === GAME_MODES.clouds ? GAME_MODES.clouds : gameMode;
}

function botPhysicsFrictionForMode(gameMode) {
  if (botGameMode(gameMode) === GAME_MODES.clouds) {
    return ENGINE.ship.friction;
  }
  return shipFrictionForGameMode(gameMode);
}

function botPhysicsAccelerationForMode(gameMode, effects) {
  const multiplier = Math.max(0.1, Number(effects?.thrustMultiplier || 1));
  if (botGameMode(gameMode) === GAME_MODES.clouds) {
    return ENGINE.ship.thrust * Math.max(1, Number(ENGINE.clouds.speedMultiplier) || 1) * multiplier;
  }
  return shipThrustForGameMode(gameMode) * multiplier;
}

function findBotPath(arena, startIndex, goalIndex, options = {}) {
  if (!botProfileActive()) {
    return findBotPathImpl(arena, startIndex, goalIndex, options);
  }
  return botProfileMeasure("findBotPath", () => findBotPathImpl(arena, startIndex, goalIndex, options));
}

function findBotPathImpl(arena, startIndex, goalIndex, options = {}) {
  const asteroid = arena.asteroid;
  const searchOptions = botPreparePathSearchOptions(asteroid, options, startIndex);
  const nativePath = findPathNative(arena, startIndex, goalIndex, searchOptions);
  if (nativePath) {
    return nativePath;
  }

  const stateCount = asteroid.tiles.length * BOT_PATH_DIRECTION_COUNT;
  const previous = new Int32Array(stateCount);
  const costs = new Float32Array(stateCount);
  const closed = new Uint8Array(stateCount);
  previous.fill(-2);
  costs.fill(Number.POSITIVE_INFINITY);
  const startState = botPathStateId(startIndex, BOT_PATH_START_DIRECTION);
  previous[startState] = -1;
  costs[startState] = 0;

  const open = [];
  pushOpenPathState(open, startState, botPathHeuristicSeconds(asteroid, startIndex, goalIndex, searchOptions));
  while (open.length > 0) {
    const entry = takeLowestOpenPathState(open);
    const currentState = entry.state;
    if (closed[currentState]) {
      continue;
    }

    closed[currentState] = 1;
    const current = botPathStateTile(currentState);
    const currentDirection = botPathStateDirection(currentState);

    if (current === goalIndex) {
      return reconstructBotPath(previous, startState, currentState);
    }

    for (const neighbor of botPathNeighbors(asteroid, current, goalIndex)) {
      const direction = botPathDirectionBetween(asteroid, current, neighbor);
      const neighborState = botPathStateId(neighbor, direction);
      if (
        closed[neighborState] ||
        !botPathTileAllowedCached(arena, neighbor, searchOptions)
      ) {
        continue;
      }

      const nextCost = costs[currentState] + botPathStepCostSeconds(arena, current, neighbor, currentDirection, direction, searchOptions);
      if (nextCost >= costs[neighborState]) {
        continue;
      }

      costs[neighborState] = nextCost;
      previous[neighborState] = currentState;
      pushOpenPathState(
        open,
        neighborState,
        nextCost + botPathHeuristicSeconds(asteroid, neighbor, goalIndex, searchOptions)
      );
    }
  }

  return [];
}

function findBotPathCosts(arena, startIndex, options = {}) {
  const asteroid = arena.asteroid;
  const searchOptions = botPreparePathSearchOptions(asteroid, options, startIndex);
  const stateCount = asteroid.tiles.length * BOT_PATH_DIRECTION_COUNT;
  const previous = new Int32Array(stateCount);
  const costs = new Float32Array(stateCount);
  const closed = new Uint8Array(stateCount);
  const minedCounts = new Uint16Array(stateCount);
  const closedStates = [];
  previous.fill(-2);
  costs.fill(Number.POSITIVE_INFINITY);
  const startState = botPathStateId(startIndex, BOT_PATH_START_DIRECTION);
  previous[startState] = -1;
  costs[startState] = 0;

  const open = [];
  pushOpenPathState(open, startState, 0);
  let visited = 0;
  const maxVisited = Math.max(1, Math.floor(Number(options.pathCostMaxVisited) || BOT_PATH_COST_MAX_VISITED));

  while (open.length > 0 && visited < maxVisited) {
    const entry = takeLowestOpenPathState(open);
    const currentState = entry.state;
    if (closed[currentState] || entry.cost !== costs[currentState]) {
      continue;
    }

    closed[currentState] = 1;
    closedStates.push(currentState);
    visited += 1;
    const current = botPathStateTile(currentState);
    const currentDirection = botPathStateDirection(currentState);

    forEachBotPathNeighbor(asteroid, current, (neighbor) => {
      const direction = botPathDirectionBetween(asteroid, current, neighbor);
      const neighborState = botPathStateId(neighbor, direction);
      if (
        closed[neighborState] ||
        !botPathTileAllowedCached(arena, neighbor, searchOptions)
      ) {
        return;
      }

      const nextCost = costs[currentState] + botPathStepCostSeconds(arena, current, neighbor, currentDirection, direction, searchOptions);
      if (nextCost >= costs[neighborState]) {
        return;
      }

      costs[neighborState] = nextCost;
      previous[neighborState] = currentState;
      minedCounts[neighborState] = minedCounts[currentState] + (botPathIndexMineable(arena, neighbor) ? 1 : 0);
      pushOpenPathState(open, neighborState, nextCost);
    });
  }

  return {
    startIndex,
    startState,
    previous,
    costs,
    closed,
    closedStates,
    minedCounts,
    options: searchOptions
  };
}

function botPathCostSeconds(arena, path, options = {}) {
  if (!Array.isArray(path) || path.length === 0) {
    return 0.1;
  }

  let cost = 0;
  for (let index = 0; index < path.length; index += 1) {
    const previous = path[index - 1] ?? null;
    const current = path[index];
    const next = path[index + 1] ?? null;
    const previousDirection = previous === null
      ? BOT_PATH_START_DIRECTION
      : botPathDirectionBetween(arena.asteroid, previous, current);
    const direction = next === null
      ? previousDirection
      : botPathDirectionBetween(arena.asteroid, current, next);
    cost += botPathStepCostSeconds(arena, previous, current, previousDirection, direction, options);
  }
  return Math.max(0.1, cost);
}

function botPathStateId(index, direction) {
  return index * BOT_PATH_DIRECTION_COUNT + direction;
}

function botPathStateTile(stateId) {
  return Math.floor(stateId / BOT_PATH_DIRECTION_COUNT);
}

function botPathStateDirection(stateId) {
  return stateId % BOT_PATH_DIRECTION_COUNT;
}

function botPathDirectionBetween(asteroid, fromIndex, toIndex) {
  if (fromIndex === null || toIndex === null || fromIndex < 0 || toIndex < 0) {
    return BOT_PATH_START_DIRECTION;
  }

  const width = asteroid.widthTiles;
  const dx = (toIndex % width) - (fromIndex % width);
  const dy = Math.floor(toIndex / width) - Math.floor(fromIndex / width);
  if (dx < 0) {
    return 0;
  }
  if (dx > 0) {
    return 1;
  }
  if (dy < 0) {
    return 2;
  }
  if (dy > 0) {
    return 3;
  }
  return BOT_PATH_START_DIRECTION;
}

function botPathStepCostSeconds(arena, fromIndex, toIndex, previousDirection, direction, options = {}) {
  return botPathTileCostSeconds(arena, toIndex, options) +
    botPathTurnCostSeconds(arena, fromIndex, toIndex, previousDirection, direction, options);
}

function botPathTurnCostSeconds() {
  return 0;
}

function botPathHeuristicSeconds(asteroid, index, goalIndex, options = {}) {
  return Math.sqrt(tileDistanceScore(asteroid, index, goalIndex)) *
    (asteroid.tileSize || 16) /
    botPathAirSpeed(options);
}

function pushOpenPathState(open, state, cost) {
  const entry = { state, cost };
  open.push(entry);
  let index = open.length - 1;
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    if (open[parentIndex].cost <= entry.cost) {
      break;
    }
    open[index] = open[parentIndex];
    index = parentIndex;
  }
  open[index] = entry;
}

function takeLowestOpenPathState(open) {
  const first = open[0];
  const last = open.pop();
  if (open.length === 0) {
    return first;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= open.length) {
      break;
    }

    const childIndex = rightIndex < open.length && open[rightIndex].cost < open[leftIndex].cost
      ? rightIndex
      : leftIndex;
    if (open[childIndex].cost >= last.cost) {
      break;
    }

    open[index] = open[childIndex];
    index = childIndex;
  }
  open[index] = last;
  return first;
}

function bestBotPathStateForIndex(search, index) {
  let selected = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let direction = 0; direction < BOT_PATH_DIRECTION_COUNT; direction += 1) {
    const state = botPathStateId(index, direction);
    if (!search.closed[state] && state !== search.startState) {
      continue;
    }

    if (search.costs[state] < bestCost) {
      bestCost = search.costs[state];
      selected = state;
    }
  }

  return selected;
}

function botPathGoalIndex(arena, target, bot, options = {}) {
  const targetIndex = Number.isInteger(target.index) ? target.index : null;
  if (
    options.allowMining &&
    targetIndex !== null &&
    botPathTileAllowed(arena, targetIndex, options)
  ) {
    return targetIndex;
  }

  return nearestPassableIndexNearPoint(arena, target, bot, options);
}

function botPathTileAllowed(arena, index, options = {}) {
  if (index === null || index < 0 || index >= arena.asteroid.tiles.length) {
    return false;
  }

  const asteroid = arena.asteroid;
  const tile = asteroid.tiles[index];
  const empty = tile === ASTEROID_TILE.empty;
  const mineable = isAsteroidRockTile(tile);
  if (options.allowUnsafeStart === true && index === options.startIndex) {
    return empty || (options.allowMining && mineable);
  }

  if (!botPathTileWithinView(arena, index, options)) {
    return false;
  }

  if (options.allowMining && mineable) {
    return botSafeStormTile(arena, index) || options.allowUnsafeStorm === true;
  }

  if (asteroid.playable[index] !== true && asteroid.playable[index] !== "1") {
    return false;
  }

  if (!empty) {
    return false;
  }

  if (botSafeStormTile(arena, index)) {
    return true;
  }

  return options.allowUnsafeStorm === true ||
    (options.allowUnsafeStart === true && index === options.startIndex);
}

function botPathTileWithinView(arena, index, options = {}) {
  if (options.pathLimitToView !== true) {
    return true;
  }

  if (
    !Number.isFinite(options.pathViewOriginX) ||
    !Number.isFinite(options.pathViewOriginY) ||
    !Number.isFinite(options.pathViewRadius)
  ) {
    return true;
  }

  const center = tileCenter(arena.asteroid, index);
  return Math.hypot(
    center.x - options.pathViewOriginX,
    center.y - options.pathViewOriginY
  ) <= options.pathViewRadius;
}

function botPathTileAllowedCached(arena, index, options = {}) {
  const cache = options.pathAllowedCache;
  if (!(cache instanceof Int8Array)) {
    return botPathTileAllowed(arena, index, options);
  }

  if (!Number.isInteger(index) || index < 0 || index >= cache.length) {
    return false;
  }

  const cached = cache[index];
  if (cached !== 0) {
    return cached === 2;
  }

  const allowed = botPathTileAllowed(arena, index, options);
  cache[index] = allowed ? 2 : 1;
  return allowed;
}

function botPathIndexMineable(arena, index) {
  return index !== null &&
    index >= 0 &&
    index < arena.asteroid.tiles.length &&
    isAsteroidRockTile(arena.asteroid.tiles[index]);
}

function botPathMinedTileCount(arena, path) {
  if (!Array.isArray(path)) {
    return 0;
  }

  let count = 0;
  for (const index of path) {
    if (botPathIndexMineable(arena, index)) {
      count += 1;
    }
  }
  return count;
}

function botPathTileCostSeconds(arena, index, options = {}) {
  const cache = options.pathTileCostCache;
  if (cache instanceof Float64Array && Number.isInteger(index) && index >= 0 && index < cache.length) {
    const cached = cache[index];
    if (cached > 0) {
      return cached;
    }

    const cost = botComputePathTileCostSeconds(arena, index, options);
    cache[index] = cost;
    return cost;
  }

  return botComputePathTileCostSeconds(arena, index, options);
}

function botComputePathTileCostSeconds(arena, index, options = {}) {
  const asteroid = arena.asteroid;
  const movementSeconds = (asteroid.tileSize || 16) / botPathAirSpeed(options);
  let cost = movementSeconds;

  if (botPathIndexMineable(arena, index)) {
    cost += botMiningSecondsForTile(arena, index, options);
  }

  if (!botSafeStormTile(arena, index) && options.allowUnsafeStorm) {
    cost += BOT_PATH_STORM_TILE_SECONDS;
  }

  cost += botPathStormClearanceCostSeconds(arena, index, options);
  cost += botPathExploreHeatCostSeconds(arena, index, options);
  cost += botPathThreatSectorCostSeconds(arena, index, options);
  cost += botPathEnemyDangerCostSeconds(arena, index, options);

  return cost;
}

function botPathStormClearanceCostSeconds(arena, index, options = {}) {
  if (!arena.storm || !botSafeStormTile(arena, index)) {
    return 0;
  }

  const clearance = botCachedStormClearanceTiles(arena, index, BOT_STORM_TARGET_CLEARANCE_TILES, options);
  const deficit = Math.max(0, BOT_STORM_TARGET_CLEARANCE_TILES - clearance);
  return deficit * deficit * BOT_STORM_EDGE_PATH_COST_SECONDS;
}

function botCachedStormClearanceTiles(arena, index, maxTiles, options = {}) {
  const cache = options.pathStormClearance;
  if (!(cache instanceof Map)) {
    return botStormClearanceTiles(arena, index, maxTiles);
  }

  const key = `${index}:${maxTiles}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const clearance = botStormClearanceTiles(arena, index, maxTiles);
  cache.set(key, clearance);
  return clearance;
}

function botPathExploreHeatCostSeconds(arena, index, options = {}) {
  const heatMap = options.pathExploreHeat;
  if (!(heatMap instanceof Map)) {
    return 0;
  }

  const cell = botExploreCellAtIndex(arena.asteroid, index);
  if (!cell) {
    return 0;
  }

  const cellKey = botExploreCellKey(cell.x, cell.y);
  const heat = botExploreHeatValueFromMap(
    heatMap,
    cellKey,
    Number.isFinite(options.pathExploreHeatTick) ? options.pathExploreHeatTick : arena.tick
  );
  return heat * BOT_EXPLORE_HEAT_ROUTE_SECONDS;
}

function botPathEnemyDangerCostSeconds(arena, index, options = {}) {
  const enemyX = Number(options.pathEnemyDangerX);
  const enemyY = Number(options.pathEnemyDangerY);
  if (!Number.isFinite(enemyX) || !Number.isFinite(enemyY)) {
    return 0;
  }
  const scale = Number.isFinite(options.pathEnemyDangerScale)
    ? clamp(options.pathEnemyDangerScale, 0, 1)
    : 1;
  if (scale <= 0) {
    return 0;
  }

  const radius = Math.max(
    arena.asteroid?.tileSize || RENDER.tileSize || 16,
    Number(options.pathEnemyDangerRadius || 0)
  );
  if (radius <= 0) {
    return 0;
  }

  const asteroid = arena.asteroid;
  const tileSize = asteroid.tileSize || RENDER.tileSize || 16;
  const tileX = index % asteroid.widthTiles;
  const tileY = Math.floor(index / asteroid.widthTiles);
  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  const distance = Math.hypot(centerX - enemyX, centerY - enemyY);
  if (distance >= radius) {
    return 0;
  }

  const falloff = 1 - distance / radius;
  return BOT_FLEE_ENEMY_DANGER_MAX_SECONDS * scale * falloff * falloff;
}

function botPathThreatSectorCostSeconds(arena, index, options = {}) {
  const sector = options.pathThreatSector;
  if (!sector || !botPathThreatTileVisible(arena, index, options)) {
    return 0;
  }

  const cell = botExploreCellAtIndex(arena.asteroid, index);
  if (!cell) {
    return 0;
  }

  const distance = Math.hypot(cell.x - sector.x, cell.y - sector.y);
  if (distance > BOT_THREAT_SECTOR_ROUTE_RADIUS) {
    return 0;
  }

  const falloff = 1 - distance / BOT_THREAT_SECTOR_ROUTE_RADIUS;
  return BOT_THREAT_SECTOR_ROUTE_PENALTY_SECONDS * falloff * falloff;
}

function botPathThreatTileVisible(arena, index, options = {}) {
  const originX = Number(options.pathThreatOriginX);
  const originY = Number(options.pathThreatOriginY);
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
    return true;
  }

  const cache = options.pathThreatVisibility;
  if (cache instanceof Map && cache.has(index)) {
    return cache.get(index);
  }

  const asteroid = arena.asteroid;
  const point = tileCenter(asteroid, index);
  const origin = { x: originX, y: originY };
  const distance = distanceBetween(origin, point);
  const visible = lineOfSight(arena, origin, point, Math.max(0, distance - (asteroid.tileSize || 16) * 0.35));
  if (cache instanceof Map) {
    cache.set(index, visible);
  }
  return visible;
}

function botMiningSecondsForTile(arena, index, options = {}) {
  const target = botMiningTargetForTile(arena.asteroid, index, arena.mode);
  if (!target) {
    return 0;
  }

  const miningPower = Math.max(0.1, Number(options.pathMiningPower || 1));
  const seconds = botRemainingMiningSecondsForTarget(arena, index, target);
  const multiplier = Math.max(0.1, Number(options.pathMiningCostMultiplier || 1));
  const extraSeconds = Math.max(0, Number(options.pathMiningExtraSeconds || 0));
  return seconds > 0
    ? seconds / miningPower * multiplier + extraSeconds
    : 0;
}

function botMiningTargetForTile(asteroid, index, gameMode = null) {
  const tile = asteroid.tiles[index];
  const amount = Number(asteroid.amounts[index] || 0);
  const oreSeconds = miningSecondsForGameMode(ENGINE.mining.oreSeconds, gameMode);
  const diamondSeconds = miningSecondsForGameMode(ENGINE.mining.diamondSeconds, gameMode);
  const rockSeconds = miningSecondsForGameMode(ENGINE.mining.rockSeconds, gameMode);

  if (tile === ASTEROID_TILE.ore) {
    return {
      phase: `${ASTEROID_TILE.ore}:${amount}`,
      oreAmount: Math.max(1, amount),
      seconds: Math.max(1, amount) * oreSeconds + rockSeconds,
      currentStageSeconds: oreSeconds
    };
  }

  if (tile === ASTEROID_TILE.diamond) {
    return {
      phase: ASTEROID_TILE.diamond,
      seconds: diamondSeconds + rockSeconds,
      currentStageSeconds: diamondSeconds
    };
  }

  if (tile === ASTEROID_TILE.wall) {
    return {
      phase: ASTEROID_TILE.wall,
      seconds: rockSeconds,
      currentStageSeconds: rockSeconds
    };
  }

  if (tile === ASTEROID_TILE.rock) {
    return {
      phase: ASTEROID_TILE.rock,
      seconds: rockSeconds,
      currentStageSeconds: rockSeconds
    };
  }

  return null;
}

function botRemainingMiningSecondsForTarget(arena, index, target) {
  const mining = arena.asteroidMining?.get(index);
  const progress = mining?.phase === target.phase
    ? clamp(Number(mining.progress || 0), 0, target.currentStageSeconds)
    : 0;
  return Math.max(0, target.seconds - progress);
}

function botPathAirSpeed(options = {}) {
  return Math.max(1, Number(options.pathAirSpeed || ENGINE.ship.baseTerminalSpeed || 1));
}

function botNavPointForIndex(arena, index, options = {}) {
  return tileCenter(arena.asteroid, index);
}

function reconstructBotPath(previous, startState, endState) {
  const path = [];
  let current = endState;
  while (current !== startState && current >= 0) {
    path.push(botPathStateTile(current));
    current = previous[current];
  }
  path.reverse();
  return path;
}

function botPathNeighbors(asteroid, index, goalIndex) {
  const width = asteroid.widthTiles;
  const height = asteroid.heightTiles;
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbors = [];

  if (x > 0) {
    neighbors.push(index - 1);
  }
  if (x < width - 1) {
    neighbors.push(index + 1);
  }
  if (y > 0) {
    neighbors.push(index - width);
  }
  if (y < height - 1) {
    neighbors.push(index + width);
  }

  neighbors.sort((a, b) => tileDistanceScore(asteroid, a, goalIndex) - tileDistanceScore(asteroid, b, goalIndex));
  return neighbors;
}

function forEachBotPathNeighbor(asteroid, index, visit) {
  const width = asteroid.widthTiles;
  const height = asteroid.heightTiles;
  const x = index % width;
  const y = Math.floor(index / width);

  if (x > 0) {
    visit(index - 1);
  }
  if (x < width - 1) {
    visit(index + 1);
  }
  if (y > 0) {
    visit(index - width);
  }
  if (y < height - 1) {
    visit(index + width);
  }
}

function resourceApproachPoint(arena, bot, resource) {
  const asteroid = arena.asteroid;
  const tileX = resource.index % asteroid.widthTiles;
  const tileY = Math.floor(resource.index / asteroid.widthTiles);
  let selected = null;

  for (let radius = 1; radius <= 4; radius += 1) {
    for (let y = tileY - radius; y <= tileY + radius; y += 1) {
      for (let x = tileX - radius; x <= tileX + radius; x += 1) {
        if (Math.max(Math.abs(x - tileX), Math.abs(y - tileY)) !== radius) {
          continue;
        }

        const index = tileIndexAtTile(asteroid, x, y);
        if (!botPassableTile(arena, index)) {
          continue;
        }

        const point = tileCenter(asteroid, index);
        const distanceToResource = distanceBetween(point, resource);
        const clear = lineOfSight(arena, point, resource, Math.max(0, distanceToResource - asteroid.tileSize * 0.7)) &&
          botStormSegmentSafe(arena, point, resource);
        if (!clear) {
          continue;
        }

        const score = distanceBetween(bot, point) + distanceToResource * 0.2;
        if (!selected || score < selected.score) {
          selected = {
            ...point,
            index,
            score
          };
        }
      }
    }

    if (selected) {
      return selected;
    }
  }

  return null;
}

function nearestPassableIndexNearPoint(arena, point, from, options = {}) {
  const asteroid = arena.asteroid;
  const originTileX = Math.floor(point.x / asteroid.tileSize);
  const originTileY = Math.floor(point.y / asteroid.tileSize);
  let selected = null;

  for (let radius = 0; radius <= 6; radius += 1) {
    for (let y = originTileY - radius; y <= originTileY + radius; y += 1) {
      for (let x = originTileX - radius; x <= originTileX + radius; x += 1) {
        if (radius > 0 && Math.max(Math.abs(x - originTileX), Math.abs(y - originTileY)) !== radius) {
          continue;
        }

        const index = tileIndexAtTile(asteroid, x, y);
        if (!botPathTileAllowed(arena, index, options)) {
          continue;
        }

        const center = tileCenter(asteroid, index);
        const score = distanceBetween(center, point) * 1.6 + distanceBetween(center, from);
        if (!selected || score < selected.score) {
          selected = { index, score };
        }
      }
    }

    if (selected) {
      return selected.index;
    }
  }

  return null;
}

function updateBotStuckState(bot, brain) {
  if (!Number.isFinite(brain.lastX) || !Number.isFinite(brain.lastY)) {
    brain.lastX = bot.x;
    brain.lastY = bot.y;
    brain.stuckTicks = 0;
    return;
  }

  const moved = Math.hypot(bot.x - brain.lastX, bot.y - brain.lastY);
  const speed = Math.hypot(bot.vx || 0, bot.vy || 0);
  if (moved < 0.05 && speed < 2) {
    brain.stuckTicks = (brain.stuckTicks || 0) + 1;
  } else {
    brain.stuckTicks = Math.max(0, (brain.stuckTicks || 0) - 2);
  }

  brain.lastX = bot.x;
  brain.lastY = bot.y;
}

function botStormInteriorTarget(arena, bot) {
  if (!arena.storm) {
    return null;
  }

  const asteroid = arena.asteroid;
  const index = tileIndexAtPoint(asteroid, bot.x, bot.y);
  const currentSafe = botSafeStormTile(arena, index);
  const currentClearance = botStormClearanceTiles(arena, index, BOT_STORM_TARGET_CLEARANCE_TILES);
  if (currentSafe && currentClearance >= BOT_STORM_EDGE_ESCAPE_CLEARANCE_TILES) {
    return null;
  }

  const safeIndex = nearestSafePassableIndexByScan(arena, bot);
  if (safeIndex === null) {
    return null;
  }

  return {
    ...tileCenter(asteroid, safeIndex),
    index: safeIndex,
    allowUnsafeStorm: !currentSafe,
    stormClearanceTiles: botStormClearanceTiles(arena, safeIndex, BOT_STORM_TARGET_CLEARANCE_TILES),
    clear: false,
    score: 5
  };
}

function nearestSafePassableIndexByScan(arena, bot) {
  const asteroid = arena.asteroid;
  let selected = null;
  let fallback = null;

  for (let index = 0; index < asteroid.tiles.length; index += 1) {
    if (!botPassableTile(arena, index)) {
      continue;
    }

    const center = tileCenter(asteroid, index);
    const distance = distanceBetween(bot, center);
    const clearance = botStormClearanceTiles(arena, index, BOT_STORM_TARGET_CLEARANCE_TILES);
    const score = distance - clearance * (asteroid.tileSize || RENDER.tileSize || 16) * 1.6;
    if (!fallback || distance < fallback.distance) {
      fallback = { index, distance };
    }
    if (clearance < BOT_STORM_TARGET_CLEARANCE_TILES) {
      continue;
    }
    if (!selected || score < selected.score) {
      selected = { index, score };
    }
  }

  return selected ? selected.index : fallback?.index ?? null;
}

function clearBotNav(brain) {
  brain.navGoalKey = "";
  brain.navPath = [];
  brain.navPathSteps = [];
  brain.navPathCursor = 0;
  brain.navSegmentCursor = -1;
  brain.navSegmentProgress = 0;
  brain.navAttachIndex = 0;
  brain.navUpdatedTick = 0;
  brain.trajectoryPlan = null;
}

function botWallAwareMove(arena, bot, move, brain = null) {
  if (!botProfileActive()) {
    return botWallAwareMoveImpl(arena, bot, move, brain);
  }
  return botProfileMeasure("botWallAwareMove", () => botWallAwareMoveImpl(arena, bot, move, brain));
}

function botWallAwareMoveImpl(arena, bot, move, brain = null) {
  if (!arena.asteroid || Math.hypot(move.x, move.y) <= 0.0001) {
    if (brain) {
      brain.trajectoryPlan = null;
    }
    return move;
  }

  const solved = botTrajectorySolvedMove(arena, bot, move, brain);
  if (solved) {
    return solved;
  }

  if (brain) {
    brain.trajectoryPlan = null;
  }
  const currentTileCenteringMove = botCurrentTileCenteringMove(arena, bot, move);
  if (currentTileCenteringMove) {
    return currentTileCenteringMove;
  }
  return { x: 0, y: 0 };
}

function botCurrentTileCenteringMove(arena, bot, move) {
  if (!arena.asteroid || Math.hypot(Number(move?.x || 0), Number(move?.y || 0)) <= 0.0001) {
    return null;
  }

  const index = tileIndexAtPoint(arena.asteroid, bot.x, bot.y);
  if (
    index === null ||
    !botPathTileAllowed(arena, index, {
      startIndex: index,
      allowUnsafeStart: true,
      allowUnsafeStorm: true,
      allowMining: false
    })
  ) {
    return null;
  }

  const center = tileCenter(arena.asteroid, index);
  const toCenter = {
    x: center.x - bot.x,
    y: center.y - bot.y
  };
  const distance = Math.hypot(toCenter.x, toCenter.y);
  if (distance <= BOT_SEGMENT_LATERAL_DEADBAND_PIXELS) {
    return null;
  }

  const centerMove = {
    x: toCenter.x / distance,
    y: toCenter.y / distance
  };
  const desired = normalizeVector(move);
  return centerMove.x * desired.x + centerMove.y * desired.y > 0.82
    ? centerMove
    : null;
}

function botTrajectorySolvedMove(arena, bot, desiredMove, brain = null) {
  if (!botProfileActive()) {
    return botTrajectorySolvedMoveImpl(arena, bot, desiredMove, brain);
  }
  return botProfileMeasure("botTrajectorySolvedMove", () => botTrajectorySolvedMoveImpl(arena, bot, desiredMove, brain));
}

function botTrajectorySolvedMoveImpl(arena, bot, desiredMove, brain = null) {
  const desired = normalizeVector(desiredMove);
  if (Math.hypot(desired.x, desired.y) <= 0.0001) {
    return null;
  }

  const cached = botCachedTrajectoryMove(arena, brain, desired);
  if (cached) {
    return cached;
  }

  const plan = botPlanTrajectorySequence(arena, bot, desired);
  if (!plan?.safe) {
    if (brain) {
      brain.trajectoryPlan = null;
    }
    return null;
  }
  const moves = botTrajectoryStateMoves(plan);
  if (brain && moves.length > 0) {
    brain.trajectoryPlan = {
      desiredX: desired.x,
      desiredY: desired.y,
      tick: arena.tick,
      cursor: 1,
      moves
    };
  }
  return moves[0] || plan?.firstMove || null;
}

function botCachedTrajectoryMove(arena, brain, desired) {
  const cache = brain?.trajectoryPlan;
  if (
    !cache ||
    !Array.isArray(cache.moves) ||
    cache.cursor >= cache.moves.length ||
    arena.tick - Number(cache.tick || 0) > BOT_TRAJECTORY_CACHE_MAX_TICKS
  ) {
    return null;
  }

  const dot = Number(cache.desiredX || 0) * desired.x + Number(cache.desiredY || 0) * desired.y;
  if (dot < BOT_TRAJECTORY_CACHE_DIRECTION_DOT) {
    return null;
  }

  const move = cache.moves[cache.cursor];
  cache.cursor += 1;
  return move || null;
}

function botTrajectoryStateMoves(state) {
  const reversed = [];
  let cursor = state;
  while (cursor && Number.isFinite(cursor.moveX) && Number.isFinite(cursor.moveY)) {
    reversed.push({ x: cursor.moveX, y: cursor.moveY });
    cursor = cursor.previous;
  }
  reversed.reverse();
  return reversed;
}

function botPlanNativeTrajectorySequence(arena, bot, desired, radius, acceleration, friction, dt, trajectoryContext) {
  if (!trajectoryContext?.blockers) {
    return null;
  }

  const plan = planTrajectoryNative({
    x: bot.x,
    y: bot.y,
    vx: bot.vx,
    vy: bot.vy,
    desiredX: desired.x,
    desiredY: desired.y,
    radius,
    acceleration,
    friction,
    dt,
    steps: BOT_TRAJECTORY_SOLVER_STEPS,
    beamWidth: BOT_TRAJECTORY_BEAM_WIDTH,
    scanPixels: BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS,
    softClearancePixels: BOT_TRAJECTORY_SOFT_CLEARANCE_PIXELS,
    progressWeight: BOT_TRAJECTORY_PROGRESS_WEIGHT,
    alignmentWeight: BOT_TRAJECTORY_ALIGNMENT_WEIGHT,
    clearanceWeight: BOT_TRAJECTORY_CLEARANCE_WEIGHT,
    lateHitWeight: BOT_TRAJECTORY_LATE_HIT_WEIGHT,
    maxOvershootSpeed: BOT_PATH_MAX_OVERSHOOT_DOT
  }, trajectoryContext.blockers);

  if (!plan?.safe || !Array.isArray(plan.moves) || plan.moves.length <= 0) {
    return null;
  }

  let previous = null;
  let firstMove = null;
  for (const move of plan.moves) {
    const node = {
      moveX: Number(move.x || 0),
      moveY: Number(move.y || 0),
      firstMove: firstMove || { x: Number(move.x || 0), y: Number(move.y || 0) },
      previous,
      safe: true,
      score: plan.score,
      minClearance: plan.minClearance
    };
    firstMove ||= node.firstMove;
    previous = node;
  }

  return previous;
}

function botTrajectoryCandidateControls(desired, bot) {
  const baseAngle = Math.atan2(desired.y, desired.x);
  const fineOffsets = [
    0,
    -Math.PI / 18,
    Math.PI / 18,
    -Math.PI / 9,
    Math.PI / 9,
    -Math.PI / 6,
    Math.PI / 6,
    -Math.PI / 4,
    Math.PI / 4,
    -Math.PI / 3,
    Math.PI / 3,
    -Math.PI / 2,
    Math.PI / 2
  ];
  const candidates = [];
  const seen = new Set();
  candidates.push({ x: 0, y: 0, thrust: 0 });

  const addAngle = (angle) => {
    const candidate = {
      x: Math.cos(angle),
      y: Math.sin(angle),
      thrust: 1
    };
    if (candidate.x * desired.x + candidate.y * desired.y < -0.0001) {
      return;
    }
    const key = `${Math.round(candidate.x * 1000)}:${Math.round(candidate.y * 1000)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
  };

  for (const offset of fineOffsets) {
    addAngle(baseAngle + offset);
  }

  const vx = Number(bot?.vx || 0);
  const vy = Number(bot?.vy || 0);
  if (Math.hypot(vx, vy) > 0.01) {
    const velocityAngle = Math.atan2(vy, vx);
    addAngle(velocityAngle + Math.PI / 2);
    addAngle(velocityAngle - Math.PI / 2);
  }

  for (let index = 0; index < 8; index += 1) {
    addAngle(index * Math.PI / 4);
  }
  return candidates;
}

function botPlanTrajectorySequence(arena, bot, desired) {
  if (!botProfileActive()) {
    return botPlanTrajectorySequenceImpl(arena, bot, desired);
  }
  return botProfileMeasure("botPlanTrajectorySequence", () => botPlanTrajectorySequenceImpl(arena, bot, desired));
}

function botPlanTrajectorySequenceImpl(arena, bot, desired) {
  const effects = aggregateUpgradeEffects(bot.upgrades);
  const dt = BOT_TRAJECTORY_SOLVER_DT_SECONDS;
  const friction = Math.pow(botPhysicsFrictionForMode(arena?.mode), dt / (1 / ENGINE.tickRate));
  const acceleration = botPhysicsAccelerationForMode(arena?.mode, effects);
  const radius = Math.max(1, Number(bot.radius || ENGINE.ship.radius)) + BOT_TRAJECTORY_HARD_RADIUS_MARGIN;
  const trajectoryContext = botTrajectoryContext(arena, bot, radius, acceleration, dt);
  const nativePlan = botPlanNativeTrajectorySequence(
    arena,
    bot,
    desired,
    radius,
    acceleration,
    friction,
    dt,
    trajectoryContext
  );
  if (nativePlan) {
    return nativePlan;
  }

  const controls = botTrajectoryCandidateControls(desired, bot);
  const initialClearance = botTrajectoryClearance(arena, bot.x, bot.y, radius, trajectoryContext);
  let beam = [{
    x: Number(bot.x || 0),
    y: Number(bot.y || 0),
    vx: Number(bot.vx || 0),
    vy: Number(bot.vy || 0),
    firstMove: null,
    moveX: null,
    moveY: null,
    previous: null,
    score: 0,
    safe: true,
    recovering: initialClearance < 0,
    hitStep: BOT_TRAJECTORY_SOLVER_STEPS + 1,
    clearance: initialClearance,
    minClearance: initialClearance
  }];

  for (let step = 1; step <= BOT_TRAJECTORY_SOLVER_STEPS; step += 1) {
    const nextBeam = [];
    for (const state of beam) {
      for (const control of controls) {
        const next = botTrajectoryStepState(
          arena,
          state,
          control,
          desired,
          radius,
          acceleration,
          friction,
          dt,
          step,
          trajectoryContext
        );
        nextBeam.push(next);
      }
    }
    nextBeam.sort((a, b) => b.score - a.score);
    beam = nextBeam.slice(0, BOT_TRAJECTORY_BEAM_WIDTH);
  }

  const safeStates = beam.filter((state) => state.safe);
  if (safeStates.length <= 0) {
    return null;
  }

  const speed = Math.hypot(Number(bot.vx || 0), Number(bot.vy || 0));
  if (speed <= BOT_PATH_MAX_OVERSHOOT_DOT) {
    const movingState = safeStates.find((state) => {
      const firstMove = state.firstMove;
      return Math.hypot(Number(firstMove?.x || 0), Number(firstMove?.y || 0)) > 0.0001;
    });
    if (movingState) {
      return movingState;
    }
  }

  return safeStates[0];
}

function botTrajectoryStepState(arena, state, control, desired, radius, acceleration, friction, dt, step, trajectoryContext = null) {
  const canThrust = control.thrust > 0;
  const moveX = canThrust ? control.x : 0;
  const moveY = canThrust ? control.y : 0;
  const frictionVx = state.vx * friction;
  const frictionVy = state.vy * friction;
  const thrustVx = moveX * acceleration * dt;
  const thrustVy = moveY * acceleration * dt;
  const vx = frictionVx + thrustVx;
  const vy = frictionVy + thrustVy;
  const nextX = state.x + vx * dt;
  const nextY = state.y + vy * dt;
  const momentumProgress = frictionVx * desired.x + frictionVy * desired.y;
  const thrustProgress = thrustVx * desired.x + thrustVy * desired.y;
  const clearance = botTrajectoryClearance(arena, nextX, nextY, radius, trajectoryContext);
  const previousClearance = Number.isFinite(state.clearance) ? state.clearance : state.minClearance;
  const recovering = state.recovering === true && previousClearance < 0;
  const segmentDx = nextX - state.x;
  const segmentDy = nextY - state.y;
  const segmentLength = Math.sqrt(segmentDx * segmentDx + segmentDy * segmentDy);
  const segmentHit = !recovering && segmentLength > Math.max(0, previousClearance)
    ? botSegmentHitsBlockingTile(arena, state.x, state.y, nextX, nextY, radius, {
        blockers: trajectoryContext?.blockers,
        squareCollision: trajectoryContext?.squareCollision === true,
        blockNonPlayable: !arena.storm
      })
    : false;
  const progress = (nextX - state.x) * desired.x + (nextY - state.y) * desired.y;
  const alignment = moveX * desired.x + moveY * desired.y;
  const recoveryImprovement = clearance - previousClearance;
  const recoveryProgress = progress > 0.002;
  const recoverySafe = recoveryImprovement >= -0.05 && recoveryProgress;
  const safe = state.safe && (
    recovering
      ? recoverySafe
      : !segmentHit && clearance >= 0
  );
  const stillRecovering = safe && clearance < 0;
  const hitStep = safe ? state.hitStep : Math.min(state.hitStep, step);
  const softClearance = clearance - BOT_TRAJECTORY_SOFT_CLEARANCE_PIXELS;
  const clearanceScore = clamp(
    clearance,
    -BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS,
    BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS
  );
  const softClearancePenalty = softClearance < 0 ? softClearance * softClearance * -2.5 : 0;
  const safetyScore = safe ? 75 : -1000 + hitStep * BOT_TRAJECTORY_LATE_HIT_WEIGHT;
  const recoveryScore = recovering ? recoveryImprovement * 160 : 0;
  const stepScore = progress * BOT_TRAJECTORY_PROGRESS_WEIGHT +
    alignment * BOT_TRAJECTORY_ALIGNMENT_WEIGHT +
    momentumProgress * 0.015 +
    thrustProgress * 0.06 +
    clearanceScore * BOT_TRAJECTORY_CLEARANCE_WEIGHT +
    recoveryScore +
    softClearancePenalty +
    safetyScore;

  return {
    x: nextX,
    y: nextY,
    vx,
    vy,
    firstMove: state.firstMove || { x: moveX, y: moveY },
    moveX,
    moveY,
    previous: state,
    score: state.score + stepScore,
    safe,
    recovering: stillRecovering,
    hitStep,
    clearance,
    minClearance: Math.min(state.minClearance, clearance)
  };
}

function botTrajectoryContext(arena, bot, radius, acceleration, dt) {
  const horizonSeconds = dt * BOT_TRAJECTORY_SOLVER_STEPS;
  const speed = Math.hypot(Number(bot.vx || 0), Number(bot.vy || 0));
  const scanRadius = radius +
    BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS +
    BOT_TRAJECTORY_BLOCKER_SCAN_PADDING +
    speed * horizonSeconds +
    0.5 * acceleration * horizonSeconds * horizonSeconds;
  return {
    blockers: blockingTilesNearCircle(
      arena.asteroid,
      Number(bot.x || 0),
      Number(bot.y || 0),
      scanRadius,
      { blockNonPlayable: !arena.storm }
    )
  };
}

function botTrajectoryClearance(arena, x, y, radius, trajectoryContext = null) {
  if (!botProfileActive()) {
    return botTrajectoryClearanceImpl(arena, x, y, radius, trajectoryContext);
  }
  return botProfileMeasure("botTrajectoryClearance", () => botTrajectoryClearanceImpl(arena, x, y, radius, trajectoryContext));
}

function botTrajectoryClearanceImpl(arena, x, y, radius, trajectoryContext = null) {
  const blockers = Array.isArray(trajectoryContext?.blockers)
    ? trajectoryContext.blockers
    : blockingTilesNearCircle(
        arena.asteroid,
        x,
        y,
        radius + BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS,
        { blockNonPlayable: !arena.storm }
      );
  let clearance = BOT_TRAJECTORY_CLEARANCE_SCAN_PIXELS;

  for (const blocker of blockers) {
    const rejectDistance = radius + clearance;
    const roughDistanceSq = pointRectClearanceSq(x, y, blocker);
    if (roughDistanceSq > rejectDistance * rejectDistance) {
      continue;
    }

    const distance = blocker?.shape?.rounded
      ? pointDistanceToBlockerShape(x, y, blocker)
      : Math.sqrt(roughDistanceSq);
    clearance = Math.min(clearance, distance - radius);
  }

  return clearance;
}

function botWallAvoidRadius(bot = null) {
  return Math.max(
    1,
    Number(bot?.radius ?? ENGINE.ship.radius ?? 7) +
      BOT_WALL_AVOID_RADIUS_MARGIN +
      BOT_WALL_AVOID_ROCK_BUFFER_PIXELS
  );
}

function botPathPlanningRadius(source = null) {
  return Math.max(
    1,
    Number(source?.pathRadius ?? source?.radius ?? ENGINE.ship.radius ?? 7)
  );
}

function botNavigationPointClear(arena, point, options = {}) {
  return !botCircleHitsBlockingTile(
    arena,
    point.x,
    point.y,
    botPathPlanningRadius(options),
    options
  );
}

function botNavigationSegmentClear(arena, from, to, options = {}) {
  if (!botNavigationPointClear(arena, from, options) || !botNavigationPointClear(arena, to, options)) {
    return false;
  }

  return !botSegmentHitsBlockingTile(
    arena,
    from.x,
    from.y,
    to.x,
    to.y,
    botPathPlanningRadius(options),
    options
  );
}

function nearestBotBlockingContact(arena, bot, radius) {
  const blockers = blockingTilesNearCircle(
    arena.asteroid,
    bot.x,
    bot.y,
    radius,
    { blockNonPlayable: !arena.storm }
  );
  let nearest = null;

  for (const blocker of blockers) {
    const contact = circleBlockerOverlap({ x: bot.x, y: bot.y, radius }, blocker);
    if (!contact) {
      continue;
    }

    if (!nearest || contact.distance < nearest.distance) {
      nearest = contact;
    }
  }

  return nearest;
}

function circleRectContact(x, y, rect, radius) {
  const right = rect.x + rect.size;
  const bottom = rect.y + rect.size;
  const closestX = clamp(x, rect.x, right);
  const closestY = clamp(y, rect.y, bottom);
  const dx = x - closestX;
  const dy = y - closestY;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) {
    return null;
  }

  if (distance > 0.0001) {
    return {
      normalX: dx / distance,
      normalY: dy / distance,
      distance
    };
  }

  const leftDistance = x - rect.x;
  const rightDistance = right - x;
  const topDistance = y - rect.y;
  const bottomDistance = bottom - y;
  const nearest = Math.min(leftDistance, rightDistance, topDistance, bottomDistance);
  if (nearest === leftDistance) {
    return { normalX: -1, normalY: 0, distance: 0 };
  }
  if (nearest === rightDistance) {
    return { normalX: 1, normalY: 0, distance: 0 };
  }
  if (nearest === topDistance) {
    return { normalX: 0, normalY: -1, distance: 0 };
  }
  return { normalX: 0, normalY: 1, distance: 0 };
}

function botSegmentHitsBlockingTile(arena, startX, startY, endX, endY, radius, options = {}) {
  if (!botProfileActive()) {
    return botSegmentHitsBlockingTileImpl(arena, startX, startY, endX, endY, radius, options);
  }
  return botProfileMeasure("botSegmentHitsBlockingTile", () => botSegmentHitsBlockingTileImpl(arena, startX, startY, endX, endY, radius, options));
}

function botSegmentHitsBlockingTileImpl(arena, startX, startY, endX, endY, radius, options = {}) {
  const blockers = Array.isArray(options.blockers)
    ? options.blockers
    : blockingTilesAlongSegment(
        arena.asteroid,
        startX,
        startY,
        endX,
        endY,
        radius,
        { blockNonPlayable: !arena.storm && options.allowUnsafeStorm !== true }
      );

  for (const blocker of blockers) {
    const hit = options.squareCollision === true
      ? sweptCircleRectSegmentHit(startX, startY, endX, endY, radius, blocker)
      : sweptCircleBlockerHit(startX, startY, endX, endY, radius, blocker);
    if (hit) {
      return true;
    }
  }

  return false;
}

function botCircleHitsBlockingTile(arena, x, y, radius, options = {}) {
  if (!botProfileActive()) {
    return botCircleHitsBlockingTileImpl(arena, x, y, radius, options);
  }
  return botProfileMeasure("botCircleHitsBlockingTile", () => botCircleHitsBlockingTileImpl(arena, x, y, radius, options));
}

function botCircleHitsBlockingTileImpl(arena, x, y, radius, options = {}) {
  const blockers = Array.isArray(options.blockers)
    ? options.blockers
    : blockingTilesNearCircle(
        arena.asteroid,
        x,
        y,
        radius,
        { blockNonPlayable: !arena.storm && options.allowUnsafeStorm !== true }
      );

  for (const blocker of blockers) {
    const hit = options.squareCollision === true
      ? circleRectContact(x, y, blocker, radius)
      : circleBlockerOverlap({ x, y, radius }, blocker);
    if (hit) {
      return true;
    }
  }

  return false;
}

function sweptCircleRectSegmentHit(startX, startY, endX, endY, radius, rect) {
  const minX = rect.x - radius;
  const minY = rect.y - radius;
  const maxX = rect.x + rect.size + radius;
  const maxY = rect.y + rect.size + radius;
  const dx = endX - startX;
  const dy = endY - startY;

  if (startX >= minX && startX <= maxX && startY >= minY && startY <= maxY) {
    const centerX = rect.x + rect.size / 2;
    const centerY = rect.y + rect.size / 2;
    return dx * (centerX - startX) + dy * (centerY - startY) > 0;
  }

  let enter = 0;
  let exit = 1;
  const xRange = sweptSegmentAxisRange(startX, dx, minX, maxX, enter, exit);
  if (!xRange) {
    return false;
  }
  enter = xRange.enter;
  exit = xRange.exit;
  const yRange = sweptSegmentAxisRange(startY, dy, minY, maxY, enter, exit);
  return Boolean(yRange);
}

function segmentRectFirstHitPoint(startX, startY, endX, endY, rect) {
  const minX = rect.x;
  const minY = rect.y;
  const maxX = rect.x + rect.width;
  const maxY = rect.y + rect.height;
  const dx = endX - startX;
  const dy = endY - startY;

  if (startX >= minX && startX <= maxX && startY >= minY && startY <= maxY) {
    return { x: startX, y: startY, t: 0 };
  }

  let enter = 0;
  let exit = 1;
  const xRange = sweptSegmentAxisRange(startX, dx, minX, maxX, enter, exit);
  if (!xRange) {
    return null;
  }
  enter = xRange.enter;
  exit = xRange.exit;
  const yRange = sweptSegmentAxisRange(startY, dy, minY, maxY, enter, exit);
  if (!yRange) {
    return null;
  }

  const t = Math.max(0, yRange.enter);
  return {
    x: startX + dx * t,
    y: startY + dy * t,
    t
  };
}

function sweptSegmentAxisRange(start, delta, min, max, enter, exit) {
  if (Math.abs(delta) <= 0.000001) {
    return start >= min && start <= max ? { enter, exit } : null;
  }

  const first = (min - start) / delta;
  const second = (max - start) / delta;
  const axisEnter = Math.min(first, second);
  const axisExit = Math.max(first, second);
  const nextEnter = Math.max(enter, axisEnter);
  const nextExit = Math.min(exit, axisExit);
  return nextEnter <= nextExit && nextExit >= 0 && nextEnter <= 1
    ? { enter: nextEnter, exit: nextExit }
    : null;
}

function botPassableTile(arena, index, options = {}) {
  return botPhysicallyPassableTile(arena, index) &&
    (options.allowUnsafeStart || botSafeStormTile(arena, index));
}

function botPhysicallyPassableTile(arena, index) {
  const asteroid = arena.asteroid;
  return index !== null &&
    index >= 0 &&
    index < asteroid.tiles.length &&
    asteroid.tiles[index] === ASTEROID_TILE.empty &&
    (asteroid.playable[index] === true || asteroid.playable[index] === "1");
}

function botSafeStormTile(arena, index) {
  if (!arena.storm) {
    return true;
  }

  return index !== null &&
    index >= 0 &&
    index < arena.storm.state.length &&
    arena.storm.state[index] === STORM_STATE.safe;
}

function botStormSegmentSafe(arena, from, to) {
  if (!arena.storm) {
    return true;
  }

  const asteroid = arena.asteroid;
  const distance = distanceBetween(from, to);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, asteroid.tileSize * 0.5)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    if (!botSafeStormTile(arena, tileIndexAtPoint(asteroid, x, y))) {
      return false;
    }
  }

  return true;
}

function botHumanVisibleRadius() {
  return Math.min(RENDER.width, RENDER.height) / 2 * Math.max(1, RENDER.lensEdgeScale || 1);
}

function tileIndexAtPoint(asteroid, x, y) {
  return tileIndexAtTile(
    asteroid,
    Math.floor(x / asteroid.tileSize),
    Math.floor(y / asteroid.tileSize)
  );
}

function tileIndexAtTile(asteroid, x, y) {
  if (x < 0 || y < 0 || x >= asteroid.widthTiles || y >= asteroid.heightTiles) {
    return null;
  }
  return y * asteroid.widthTiles + x;
}

function tileCenter(asteroid, index) {
  const x = index % asteroid.widthTiles;
  const y = Math.floor(index / asteroid.widthTiles);
  return {
    x: (x + 0.5) * asteroid.tileSize,
    y: (y + 0.5) * asteroid.tileSize
  };
}

function tileDistanceScore(asteroid, a, b) {
  const ax = a % asteroid.widthTiles;
  const ay = Math.floor(a / asteroid.widthTiles);
  const bx = b % asteroid.widthTiles;
  const by = Math.floor(b / asteroid.widthTiles);
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function lineOfSight(arena, from, to, maxDistance = null) {
  const distance = maxDistance ?? distanceBetween(from, to);
  if (distance <= 0) {
    return true;
  }

  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const hit = raycastAsteroid(arena.asteroid, from.x, from.y, angle, distance, {
    blockNonPlayable: !arena.storm
  });
  return !hit.hit;
}

function pointAtAngle(origin, angle, distance) {
  return {
    x: origin.x + Math.cos(angle) * distance,
    y: origin.y + Math.sin(angle) * distance
  };
}

function directionBetween(from, to) {
  return normalizeVector({
    x: to.x - from.x,
    y: to.y - from.y
  });
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeSignedAngle(angle) {
  let value = angle;
  while (value <= -Math.PI) {
    value += Math.PI * 2;
  }
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  return value;
}

function addVector(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y
  };
}

function scaleVector(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.000001) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stablePositiveHash(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnitNoise(value) {
  return stablePositiveHash(value) / 4294967295;
}

function copyTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  const copy = {};
  for (const key of ["x", "y", "tick", "firstTick", "index", "score", "routeScore", "routeSeconds", "roamScore", "sweepIndex", "sweepDistance", "exploreHeat", "visits"]) {
    if (Number.isFinite(target[key])) {
      copy[key] = target[key];
    }
  }
  for (const key of ["cellKey", "resource", "id", "enemyId", "threatKey", "phase"]) {
    if (typeof target[key] === "string" && target[key]) {
      copy[key] = target[key];
    }
  }
  return Object.keys(copy).length > 0 ? copy : null;
}

function sanitizeChaseMemory(memory) {
  if (!memory || typeof memory !== "object") {
    return null;
  }

  const enemyId = String(memory.enemyId || "").slice(0, 64);
  if (!enemyId) {
    return null;
  }

  const copy = { enemyId };
  for (const key of ["startX", "startY", "lastX", "lastY", "sectorX", "sectorY", "lastSeenTick"]) {
    if (!Number.isFinite(memory[key])) {
      return null;
    }
    copy[key] = key.startsWith("sector")
      ? Math.floor(memory[key])
      : memory[key];
  }

  for (const key of ["sectorEntryX", "sectorEntryY", "sectorEntryTick"]) {
    if (Number.isFinite(memory[key])) {
      copy[key] = key === "sectorEntryTick"
        ? Math.floor(memory[key])
        : memory[key];
    }
  }

  return copy;
}

function validSessionId(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(text) ? text : "";
}

function seededRandom(seed, initialState = null) {
  let hash = 2166136261;
  if (Number.isInteger(initialState)) {
    hash = initialState >>> 0;
  } else {
    for (let index = 0; index < String(seed).length; index += 1) {
      hash ^= String(seed).charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }

  const random = () => {
    hash = (hash + 0x6d2b79f5) >>> 0;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  random.getState = () => hash >>> 0;
  return random;
}
