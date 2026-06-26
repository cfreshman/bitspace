import { ASTEROID_TILE } from "../asteroid.js";
import { ENGINE, RENDER, miningSecondsForGameMode } from "../constants.js";
import { createSeededRandom } from "../math.js";

const BLOCKER_STRIDE = 6;
const VISIBILITY_SEGMENT_STRIDE = 4;
const TRAJECTORY_OUT_DOUBLES = 4 + 24 * 2;
const PATH_MAX_INDEXES = 4096;
const PATH_META_DOUBLES = 4;
const VISIBILITY_META_DOUBLES = 6;
const HUCK_ROCK_MAX_HULL_POINTS = 14;

let modulePromise = null;
let coreModule = null;
let blockerPtr = 0;
let blockerCapacity = 0;
let outPtr = 0;
let pathTilePtr = 0;
let pathPlayablePtr = 0;
let pathStormPtr = 0;
let pathAmountPtr = 0;
let pathMiningProgressPtr = 0;
let pathOutPtr = 0;
let pathMetaPtr = 0;
let pathCapacity = 0;
let pathSyncedArena = null;
let pathSyncedKey = "";
let visibilitySegmentPtr = 0;
let visibilitySegmentCapacity = 0;
let visibilityRowPtr = 0;
let visibilityRowCapacity = 0;
let visibilitySpanPtr = 0;
let visibilitySpanCapacity = 0;
let visibilityMetaPtr = 0;
let visibilityTilePtr = 0;
let visibilityPlayablePtr = 0;
let visibilityGridCapacity = 0;
let visibilitySyncedAsteroid = null;
let visibilitySyncedKey = "";
let stormRowPtr = 0;
let stormRowCapacity = 0;
let stormPermPtr = 0;
let stormPermKey = "";
let stormStatePtr = 0;
let stormStateCapacity = 0;
let stormStateSyncedAsteroid = null;
let stormStateSyncedKey = "";
let huckRockHullPtr = 0;
let renderLayerPtr = 0;
let renderLayerCapacity = 0;
let stormRunPtr = 0;
let stormRunCapacity = 0;
let layerMaskRowPtr = 0;
let layerMaskRowCapacity = 0;
let layerMaskSpanPtr = 0;
let layerMaskSpanCapacity = 0;
let loadStartedAt = nowMs();
let loadFinishedAt = 0;
let loadError = null;
const stats = {
  calls: 0,
  nativeCalls: 0,
  notReady: 0,
  failed: 0,
  invalid: 0,
  totalMs: 0,
  blockerCountTotal: 0,
  maxBlockers: 0
};
const pathStats = {
  calls: 0,
  nativeCalls: 0,
  notReady: 0,
  unsupported: 0,
  failed: 0,
  totalMs: 0,
  syncs: 0,
  syncMs: 0,
  maxPath: 0,
  visitedTotal: 0
};
const renderStats = {
  visibilityCalls: 0,
  visibilityNativeCalls: 0,
  visibilityNotReady: 0,
  visibilityFailed: 0,
  visibilityTotalMs: 0,
  visibilityMaxSegments: 0,
  visibilityMaxRows: 0,
  visibilitySpanInts: 0,
  visibilityGridSyncs: 0,
  visibilityGridSyncMs: 0,
  stormCalls: 0,
  stormNativeCalls: 0,
  stormNotReady: 0,
  stormFailed: 0,
  stormTotalMs: 0,
  stormLayerCalls: 0,
  stormLayerNativeCalls: 0,
  stormLayerNotReady: 0,
  stormLayerFailed: 0,
  stormLayerTotalMs: 0,
  huckRockCalls: 0,
  huckRockNativeCalls: 0,
  huckRockNotReady: 0,
  huckRockFailed: 0,
  huckRockTotalMs: 0,
  renderLayerCalls: 0,
  renderLayerNativeCalls: 0,
  renderLayerNotReady: 0,
  renderLayerFailed: 0,
  renderLayerTotalMs: 0,
  stormRunCalls: 0,
  stormRunNativeCalls: 0,
  stormRunNotReady: 0,
  stormRunFailed: 0,
  stormRunOverflow: 0,
  stormRunTotalMs: 0,
  stormRunMaxRuns: 0,
  stormBoundaryRunCalls: 0,
  stormBoundaryRunNativeCalls: 0,
  stormBoundaryRunNotReady: 0,
  stormBoundaryRunFailed: 0,
  stormBoundaryRunOverflow: 0,
  stormBoundaryRunTotalMs: 0,
  stormBoundaryRunMaxRuns: 0
};

export function bitspaceCoreReady() {
  return Boolean(coreModule);
}

export function bitspaceCoreStats() {
  const averageMs = stats.nativeCalls > 0 ? stats.totalMs / stats.nativeCalls : 0;
  const averageBlockers = stats.calls > 0 ? stats.blockerCountTotal / stats.calls : 0;
  return {
    ready: bitspaceCoreReady(),
    loadMs: loadFinishedAt > 0 ? Math.round((loadFinishedAt - loadStartedAt) * 1000) / 1000 : null,
    loadError: loadError ? String(loadError?.message || loadError) : null,
    calls: stats.calls,
    nativeCalls: stats.nativeCalls,
    notReady: stats.notReady,
    failed: stats.failed,
    invalid: stats.invalid,
    avgMs: Math.round(averageMs * 1000) / 1000,
    totalMs: Math.round(stats.totalMs * 1000) / 1000,
    avgBlockers: Math.round(averageBlockers * 100) / 100,
    maxBlockers: stats.maxBlockers
    ,
    pathCalls: pathStats.calls,
    pathNativeCalls: pathStats.nativeCalls,
    pathNotReady: pathStats.notReady,
    pathUnsupported: pathStats.unsupported,
    pathFailed: pathStats.failed,
    pathAvgMs: pathStats.nativeCalls > 0 ? Math.round((pathStats.totalMs / pathStats.nativeCalls) * 1000) / 1000 : 0,
    pathTotalMs: Math.round(pathStats.totalMs * 1000) / 1000,
    pathSyncs: pathStats.syncs,
    pathSyncAvgMs: pathStats.syncs > 0 ? Math.round((pathStats.syncMs / pathStats.syncs) * 1000) / 1000 : 0,
    pathMax: pathStats.maxPath,
    pathAvgVisited: pathStats.nativeCalls > 0 ? Math.round((pathStats.visitedTotal / pathStats.nativeCalls) * 10) / 10 : 0,
    visibilityCalls: renderStats.visibilityCalls,
    visibilityNativeCalls: renderStats.visibilityNativeCalls,
    visibilityNotReady: renderStats.visibilityNotReady,
    visibilityFailed: renderStats.visibilityFailed,
    visibilityAvgMs: renderStats.visibilityNativeCalls > 0
      ? Math.round((renderStats.visibilityTotalMs / renderStats.visibilityNativeCalls) * 1000) / 1000
      : 0,
    visibilityTotalMs: Math.round(renderStats.visibilityTotalMs * 1000) / 1000,
    visibilityMaxSegments: renderStats.visibilityMaxSegments,
    visibilityMaxRows: renderStats.visibilityMaxRows,
    visibilityAvgSpanInts: renderStats.visibilityNativeCalls > 0
      ? Math.round((renderStats.visibilitySpanInts / renderStats.visibilityNativeCalls) * 10) / 10
      : 0,
    visibilityGridSyncs: renderStats.visibilityGridSyncs,
    visibilityGridSyncAvgMs: renderStats.visibilityGridSyncs > 0
      ? Math.round((renderStats.visibilityGridSyncMs / renderStats.visibilityGridSyncs) * 1000) / 1000
      : 0,
    stormCalls: renderStats.stormCalls,
    stormNativeCalls: renderStats.stormNativeCalls,
    stormNotReady: renderStats.stormNotReady,
    stormFailed: renderStats.stormFailed,
    stormAvgMs: renderStats.stormNativeCalls > 0
      ? Math.round((renderStats.stormTotalMs / renderStats.stormNativeCalls) * 1000) / 1000
      : 0,
    stormTotalMs: Math.round(renderStats.stormTotalMs * 1000) / 1000,
    stormLayerCalls: renderStats.stormLayerCalls,
    stormLayerNativeCalls: renderStats.stormLayerNativeCalls,
    stormLayerNotReady: renderStats.stormLayerNotReady,
    stormLayerFailed: renderStats.stormLayerFailed,
    stormLayerAvgMs: renderStats.stormLayerNativeCalls > 0
      ? Math.round((renderStats.stormLayerTotalMs / renderStats.stormLayerNativeCalls) * 1000) / 1000
      : 0,
    stormLayerTotalMs: Math.round(renderStats.stormLayerTotalMs * 1000) / 1000,
    huckRockCalls: renderStats.huckRockCalls,
    huckRockNativeCalls: renderStats.huckRockNativeCalls,
    huckRockNotReady: renderStats.huckRockNotReady,
    huckRockFailed: renderStats.huckRockFailed,
    huckRockAvgMs: renderStats.huckRockNativeCalls > 0
      ? Math.round((renderStats.huckRockTotalMs / renderStats.huckRockNativeCalls) * 1000) / 1000
      : 0,
    huckRockTotalMs: Math.round(renderStats.huckRockTotalMs * 1000) / 1000,
    renderLayerCalls: renderStats.renderLayerCalls,
    renderLayerNativeCalls: renderStats.renderLayerNativeCalls,
    renderLayerNotReady: renderStats.renderLayerNotReady,
    renderLayerFailed: renderStats.renderLayerFailed,
    renderLayerAvgMs: renderStats.renderLayerNativeCalls > 0
      ? Math.round((renderStats.renderLayerTotalMs / renderStats.renderLayerNativeCalls) * 1000) / 1000
      : 0,
    renderLayerTotalMs: Math.round(renderStats.renderLayerTotalMs * 1000) / 1000,
    stormRunCalls: renderStats.stormRunCalls,
    stormRunNativeCalls: renderStats.stormRunNativeCalls,
    stormRunNotReady: renderStats.stormRunNotReady,
    stormRunFailed: renderStats.stormRunFailed,
    stormRunOverflow: renderStats.stormRunOverflow,
    stormRunAvgMs: renderStats.stormRunNativeCalls > 0
      ? Math.round((renderStats.stormRunTotalMs / renderStats.stormRunNativeCalls) * 1000) / 1000
      : 0,
    stormRunTotalMs: Math.round(renderStats.stormRunTotalMs * 1000) / 1000,
    stormRunMaxRuns: renderStats.stormRunMaxRuns,
    stormBoundaryRunCalls: renderStats.stormBoundaryRunCalls,
    stormBoundaryRunNativeCalls: renderStats.stormBoundaryRunNativeCalls,
    stormBoundaryRunNotReady: renderStats.stormBoundaryRunNotReady,
    stormBoundaryRunFailed: renderStats.stormBoundaryRunFailed,
    stormBoundaryRunOverflow: renderStats.stormBoundaryRunOverflow,
    stormBoundaryRunAvgMs: renderStats.stormBoundaryRunNativeCalls > 0
      ? Math.round((renderStats.stormBoundaryRunTotalMs / renderStats.stormBoundaryRunNativeCalls) * 1000) / 1000
      : 0,
    stormBoundaryRunTotalMs: Math.round(renderStats.stormBoundaryRunTotalMs * 1000) / 1000,
    stormBoundaryRunMaxRuns: renderStats.stormBoundaryRunMaxRuns
  };
}

export function resetBitspaceCoreStats() {
  stats.calls = 0;
  stats.nativeCalls = 0;
  stats.notReady = 0;
  stats.failed = 0;
  stats.invalid = 0;
  stats.totalMs = 0;
  stats.blockerCountTotal = 0;
  stats.maxBlockers = 0;
  pathStats.calls = 0;
  pathStats.nativeCalls = 0;
  pathStats.notReady = 0;
  pathStats.unsupported = 0;
  pathStats.failed = 0;
  pathStats.totalMs = 0;
  pathStats.syncs = 0;
  pathStats.syncMs = 0;
  pathStats.maxPath = 0;
  pathStats.visitedTotal = 0;
  renderStats.visibilityCalls = 0;
  renderStats.visibilityNativeCalls = 0;
  renderStats.visibilityNotReady = 0;
  renderStats.visibilityFailed = 0;
  renderStats.visibilityTotalMs = 0;
  renderStats.visibilityMaxSegments = 0;
  renderStats.visibilityMaxRows = 0;
  renderStats.visibilitySpanInts = 0;
  renderStats.visibilityGridSyncs = 0;
  renderStats.visibilityGridSyncMs = 0;
  renderStats.stormCalls = 0;
  renderStats.stormNativeCalls = 0;
  renderStats.stormNotReady = 0;
  renderStats.stormFailed = 0;
  renderStats.stormTotalMs = 0;
  renderStats.stormLayerCalls = 0;
  renderStats.stormLayerNativeCalls = 0;
  renderStats.stormLayerNotReady = 0;
  renderStats.stormLayerFailed = 0;
  renderStats.stormLayerTotalMs = 0;
  renderStats.huckRockCalls = 0;
  renderStats.huckRockNativeCalls = 0;
  renderStats.huckRockNotReady = 0;
  renderStats.huckRockFailed = 0;
  renderStats.huckRockTotalMs = 0;
  renderStats.renderLayerCalls = 0;
  renderStats.renderLayerNativeCalls = 0;
  renderStats.renderLayerNotReady = 0;
  renderStats.renderLayerFailed = 0;
  renderStats.renderLayerTotalMs = 0;
  renderStats.stormRunCalls = 0;
  renderStats.stormRunNativeCalls = 0;
  renderStats.stormRunNotReady = 0;
  renderStats.stormRunFailed = 0;
  renderStats.stormRunOverflow = 0;
  renderStats.stormRunTotalMs = 0;
  renderStats.stormRunMaxRuns = 0;
  renderStats.stormBoundaryRunCalls = 0;
  renderStats.stormBoundaryRunNativeCalls = 0;
  renderStats.stormBoundaryRunNotReady = 0;
  renderStats.stormBoundaryRunFailed = 0;
  renderStats.stormBoundaryRunOverflow = 0;
  renderStats.stormBoundaryRunTotalMs = 0;
  renderStats.stormBoundaryRunMaxRuns = 0;
  return bitspaceCoreStats();
}

export function warmBitspaceCore() {
  if (!modulePromise) {
    loadStartedAt = nowMs();
    modulePromise = loadBitspaceCore()
      .then((module) => {
        coreModule = module;
        loadFinishedAt = nowMs();
        loadError = null;
        console.info(`BITSPACE native core loaded in ${Math.round((loadFinishedAt - loadStartedAt) * 10) / 10}ms`);
        return module;
      })
      .catch((error) => {
        loadFinishedAt = nowMs();
        loadError = error;
        console.warn("BITSPACE native core unavailable", error);
        return null;
      });
  }
  return modulePromise;
}

export function planTrajectoryNative(input, blockers) {
  stats.calls += 1;
  if (!coreModule || !Array.isArray(blockers)) {
    if (!coreModule) {
      stats.notReady += 1;
    } else {
      stats.invalid += 1;
    }
    return null;
  }

  const module = coreModule;
  const blockerCount = blockers.length;
  stats.blockerCountTotal += blockerCount;
  stats.maxBlockers = Math.max(stats.maxBlockers, blockerCount);
  const blockerDoubles = Math.max(1, blockerCount * BLOCKER_STRIDE);
  ensureBlockerBuffer(module, blockerDoubles);
  ensureOutBuffer(module);

  const heap = module.HEAPF64;
  const blockerOffset = blockerPtr >> 3;
  for (let index = 0; index < blockerCount; index += 1) {
    const blocker = blockers[index];
    const shape = blocker?.shape || {};
    const corners = shape.corners || {};
    const base = blockerOffset + index * BLOCKER_STRIDE;
    heap[base] = Number(blocker.x || 0);
    heap[base + 1] = Number(blocker.y || 0);
    heap[base + 2] = Number(blocker.width ?? blocker.size ?? 0);
    heap[base + 3] = Number(blocker.height ?? blocker.size ?? blocker.width ?? 0);
    heap[base + 4] = shape.rounded ? Number(shape.radius || 0) : Number(blocker.radius || 0);
    heap[base + 5] = Number(blocker.cornerMask ?? (
      (corners.topLeft ? 1 : 0) |
        (corners.topRight ? 2 : 0) |
        (corners.bottomRight ? 4 : 0) |
        (corners.bottomLeft ? 8 : 0)
    ));
  }

  const start = nowMs();
  const ok = module._bs_plan_trajectory(
    blockerPtr,
    blockerCount,
    Number(input.x || 0),
    Number(input.y || 0),
    Number(input.vx || 0),
    Number(input.vy || 0),
    Number(input.desiredX || 0),
    Number(input.desiredY || 0),
    Number(input.radius || 1),
    Number(input.acceleration || 0),
    Number(input.friction || 0),
    Number(input.dt || 0),
    Math.floor(Number(input.steps || 1)),
    Math.floor(Number(input.beamWidth || 1)),
    Number(input.scanPixels || 1),
    Number(input.softClearancePixels || 0),
    Number(input.progressWeight || 1),
    Number(input.alignmentWeight || 1),
    Number(input.clearanceWeight || 0),
    Number(input.lateHitWeight || 0),
    Number(input.maxOvershootSpeed || 0),
    outPtr
  );
  stats.nativeCalls += 1;
  stats.totalMs += nowMs() - start;

  if (!ok) {
    stats.failed += 1;
    return null;
  }

  const outOffset = outPtr >> 3;
  if (heap[outOffset] !== 1) {
    stats.failed += 1;
    return null;
  }

  const moveCount = Math.max(0, Math.min(24, Math.floor(Number(heap[outOffset + 1] || 0))));
  const moves = [];
  for (let index = 0; index < moveCount; index += 1) {
    const moveX = Number(heap[outOffset + 4 + index * 2] || 0);
    const moveY = Number(heap[outOffset + 5 + index * 2] || 0);
    moves.push({ x: moveX, y: moveY });
  }

  return {
    safe: true,
    score: Number(heap[outOffset + 2] || 0),
    minClearance: Number(heap[outOffset + 3] || 0),
    moves
  };
}

export function findPathNative(arena, startIndex, goalIndex, options = {}) {
  pathStats.calls += 1;
  if (!coreModule) {
    pathStats.notReady += 1;
    return null;
  }
  if (!nativePathSearchSupported(arena, options)) {
    pathStats.unsupported += 1;
    return null;
  }

  const asteroid = arena.asteroid;
  syncPathGrid(coreModule, arena);
  ensurePathOutputBuffer(coreModule);

  const start = nowMs();
  const ok = coreModule._bs_find_path(
    pathTilePtr,
    pathPlayablePtr,
    arena.storm ? pathStormPtr : 0,
    pathAmountPtr,
    pathMiningProgressPtr,
    asteroid.widthTiles,
    asteroid.heightTiles,
    asteroid.tileSize || RENDER.tileSize || 16,
    Math.floor(Number(startIndex)),
    Math.floor(Number(goalIndex)),
    options.allowMining === true ? 1 : 0,
    options.allowUnsafeStorm === true ? 1 : 0,
    options.allowUnsafeStart === true ? 1 : 0,
    options.pathLimitToView === true ? 1 : 0,
    Number(options.pathViewOriginX || 0),
    Number(options.pathViewOriginY || 0),
    Number(options.pathViewRadius || 0),
    Number(options.pathAirSpeed || ENGINE.ship.baseTerminalSpeed || 1),
    Number(options.pathMiningPower || 1),
    Number(options.pathMiningCostMultiplier || 1),
    Number(options.pathMiningExtraSeconds || 0),
    miningSecondsForGameMode(ENGINE.mining.rockSeconds, arena.mode),
    miningSecondsForGameMode(ENGINE.mining.oreSeconds, arena.mode),
    miningSecondsForGameMode(ENGINE.mining.diamondSeconds, arena.mode),
    2,
    4,
    2.4,
    Number.isFinite(options.pathEnemyDangerX) && Number.isFinite(options.pathEnemyDangerY) ? 1 : 0,
    Number(options.pathEnemyDangerX || 0),
    Number(options.pathEnemyDangerY || 0),
    Math.max(RENDER.tileSize || 16, Number(options.pathEnemyDangerRadius || 0)),
    Number.isFinite(options.pathEnemyDangerScale) ? Math.max(0, Math.min(1, Number(options.pathEnemyDangerScale))) : 1,
    8.5,
    pathOutPtr,
    PATH_MAX_INDEXES,
    pathMetaPtr
  );
  pathStats.nativeCalls += 1;
  pathStats.totalMs += nowMs() - start;

  const meta = coreModule.HEAPF64;
  const metaOffset = pathMetaPtr >> 3;
  if (!ok || meta[metaOffset] !== 1) {
    pathStats.failed += 1;
    return null;
  }

  const pathLength = Math.max(0, Math.min(PATH_MAX_INDEXES, Math.floor(Number(meta[metaOffset + 1] || 0))));
  pathStats.maxPath = Math.max(pathStats.maxPath, pathLength);
  pathStats.visitedTotal += Math.max(0, Number(meta[metaOffset + 3] || 0));

  const path = [];
  const heap = coreModule.HEAP32;
  const pathOffset = pathOutPtr >> 2;
  for (let index = 0; index < pathLength; index += 1) {
    path.push(heap[pathOffset + index]);
  }
  return path;
}

export function visibilitySpansNative(origin, radius, segments, options = {}) {
  renderStats.visibilityCalls += 1;
  if (!coreModule) {
    renderStats.visibilityNotReady += 1;
    return null;
  }
  if (!origin || !Array.isArray(segments) || !Number.isFinite(radius) || radius <= 0) {
    renderStats.visibilityFailed += 1;
    return null;
  }

  const module = coreModule;
  const segmentCount = segments.length;
  ensureVisibilitySegmentBuffer(module, Math.max(1, segmentCount * VISIBILITY_SEGMENT_STRIDE));
  const heap = module.HEAPF64;
  const segmentOffset = visibilitySegmentPtr >> 3;
  for (let index = 0; index < segmentCount; index += 1) {
    const segment = segments[index];
    const offset = segmentOffset + index * VISIBILITY_SEGMENT_STRIDE;
    heap[offset] = Number(segment.x0 || 0);
    heap[offset + 1] = Number(segment.y0 || 0);
    heap[offset + 2] = Number(segment.x1 || 0);
    heap[offset + 3] = Number(segment.y1 || 0);
  }

  const maxRows = Math.max(64, Math.ceil(radius * 2) + 16 + Math.max(0, Number(options.dilatePixels || 0)) * 2);
  const maxSpanInts = Math.max(1024, maxRows * 24, segmentCount * 8);
  ensureVisibilityOutputBuffers(module, maxRows, maxSpanInts);

  const start = nowMs();
  const ok = module._bs_visibility_spans(
    visibilitySegmentPtr,
    segmentCount,
    Number(origin.x || 0),
    Number(origin.y || 0),
    Number(radius),
    Math.floor(Number(options.baseRays || 96)),
    Number(options.angleEpsilon || 0.0008),
    Math.floor(Number(options.dilatePixels || 0)),
    visibilityRowPtr,
    visibilityRowCapacity,
    visibilitySpanPtr,
    visibilitySpanCapacity,
    visibilityMetaPtr
  );
  renderStats.visibilityNativeCalls += 1;
  renderStats.visibilityTotalMs += nowMs() - start;

  const meta = module.HEAPF64;
  const metaOffset = visibilityMetaPtr >> 3;
  if (!ok || meta[metaOffset] !== 1) {
    renderStats.visibilityFailed += 1;
    return null;
  }

  const offsetY = Math.floor(Number(meta[metaOffset + 1] || 0));
  const rowCount = Math.max(0, Math.min(visibilityRowCapacity, Math.floor(Number(meta[metaOffset + 2] || 0))));
  const spanIntCount = Math.max(0, Math.min(visibilitySpanCapacity, Math.floor(Number(meta[metaOffset + 3] || 0))));
  renderStats.visibilityMaxSegments = Math.max(renderStats.visibilityMaxSegments, segmentCount);
  renderStats.visibilityMaxRows = Math.max(renderStats.visibilityMaxRows, rowCount);
  renderStats.visibilitySpanInts += spanIntCount;

  const rowHeap = module.HEAP32;
  const spanHeap = module.HEAP32;
  const rowOffset = visibilityRowPtr >> 2;
  const spanOffset = visibilitySpanPtr >> 2;
  const rows = new Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const startIndex = rowHeap[rowOffset + row * 2];
    const count = rowHeap[rowOffset + row * 2 + 1];
    if (count <= 0) {
      rows[row] = null;
      continue;
    }
    const spans = new Array(count);
    for (let index = 0; index < count; index += 1) {
      spans[index] = spanHeap[spanOffset + startIndex + index];
    }
    rows[row] = spans;
  }

  return { offsetY, rows };
}

export function visibilitySpansFromGridNative(asteroid, player, camera, radius, bounds, options = {}) {
  renderStats.visibilityCalls += 1;
  if (!coreModule) {
    renderStats.visibilityNotReady += 1;
    return null;
  }
  if (!asteroid?.tiles || !asteroid?.playable || !player || !camera || !bounds || !Number.isFinite(radius) || radius <= 0) {
    renderStats.visibilityFailed += 1;
    return null;
  }

  const module = coreModule;
  syncVisibilityGrid(module, asteroid);
  const tileSize = Number(asteroid.tileSize || RENDER.tileSize || 16);
  const maxRows = Math.max(64, Math.ceil(radius * 2) + 16 + Math.max(0, Number(options.dilatePixels || 0)) * 2);
  const maxSpanInts = Math.max(
    8192,
    maxRows * 64,
    Math.max(1, (bounds.maxTileX - bounds.minTileX + 1) * (bounds.maxTileY - bounds.minTileY + 1)) * 8
  );
  ensureVisibilityOutputBuffers(module, maxRows, maxSpanInts);

  const start = nowMs();
  const ok = module._bs_visibility_spans_from_grid(
    visibilityTilePtr,
    visibilityPlayablePtr,
    Math.floor(Number(asteroid.widthTiles || 0)),
    Math.floor(Number(asteroid.heightTiles || 0)),
    tileSize,
    Number(camera.x || 0),
    Number(camera.y || 0),
    Number(player.x || 0),
    Number(player.y || 0),
    Number(radius),
    Math.floor(Number(bounds.minTileX || 0)),
    Math.floor(Number(bounds.maxTileX || 0)),
    Math.floor(Number(bounds.minTileY || 0)),
    Math.floor(Number(bounds.maxTileY || 0)),
    Math.floor(Number(options.baseRays || 96)),
    Number(options.angleEpsilon || 0.0008),
    Math.floor(Number(options.dilatePixels || 0)),
    Math.floor(Number(options.outerBevel || 0)),
    Math.floor(Number(options.innerCorner || 0)),
    Math.floor(Number(options.edgeOverlap || 0)),
    visibilityRowPtr,
    visibilityRowCapacity,
    visibilitySpanPtr,
    visibilitySpanCapacity,
    visibilityMetaPtr
  );
  renderStats.visibilityNativeCalls += 1;
  renderStats.visibilityTotalMs += nowMs() - start;

  const meta = module.HEAPF64;
  const metaOffset = visibilityMetaPtr >> 3;
  if (!ok || meta[metaOffset] !== 1) {
    renderStats.visibilityFailed += 1;
    return null;
  }

  const offsetY = Math.floor(Number(meta[metaOffset + 1] || 0));
  const rowCount = Math.max(0, Math.min(visibilityRowCapacity, Math.floor(Number(meta[metaOffset + 2] || 0))));
  const spanIntCount = Math.max(0, Math.min(visibilitySpanCapacity, Math.floor(Number(meta[metaOffset + 3] || 0))));
  const segmentCount = Math.max(0, Math.floor(Number(meta[metaOffset + 5] || 0)));
  renderStats.visibilityMaxSegments = Math.max(renderStats.visibilityMaxSegments, segmentCount);
  renderStats.visibilityMaxRows = Math.max(renderStats.visibilityMaxRows, rowCount);
  renderStats.visibilitySpanInts += spanIntCount;

  const rowHeap = module.HEAP32;
  const spanHeap = module.HEAP32;
  const rowOffset = visibilityRowPtr >> 2;
  const spanOffset = visibilitySpanPtr >> 2;
  const rows = new Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const startIndex = rowHeap[rowOffset + row * 2];
    const count = rowHeap[rowOffset + row * 2 + 1];
    if (count <= 0) {
      rows[row] = null;
      continue;
    }
    const spans = new Array(count);
    for (let index = 0; index < count; index += 1) {
      spans[index] = spanHeap[spanOffset + startIndex + index];
    }
    rows[row] = spans;
  }

  return { offsetY, rows };
}

export function stormPatternRowsNative(asteroid, tileX, tileY, size, timeSeconds, threshold, constants = {}) {
  renderStats.stormCalls += 1;
  if (!coreModule) {
    renderStats.stormNotReady += 1;
    return null;
  }
  if (!asteroid || size <= 0 || size > 32) {
    renderStats.stormFailed += 1;
    return null;
  }

  const module = coreModule;
  ensureStormRowBuffer(module, size);
  syncStormPermutation(module, `${asteroid.seed || "default"}:storm-visual`);
  const frame = Math.floor(Number(timeSeconds || 0) * Number(constants.fps || 20));
  const start = nowMs();
  const ok = module._bs_storm_pattern_rows(
    stormPermPtr,
    Math.floor(Number(tileX || 0)),
    Math.floor(Number(tileY || 0)),
    Math.floor(Number(size || 0)),
    frame,
    Number(constants.fps || 20),
    Number(threshold ?? 0.34),
    Number(constants.scale || 0.15),
    Number(constants.speedX ?? -2),
    Number(constants.speedY ?? 5),
    Number(constants.speedZ ?? 0.1),
    stormRowPtr
  );
  renderStats.stormNativeCalls += 1;
  renderStats.stormTotalMs += nowMs() - start;
  if (!ok) {
    renderStats.stormFailed += 1;
    return null;
  }

  const rows = module.HEAPU32.subarray(stormRowPtr >> 2, (stormRowPtr >> 2) + size);
  return Uint32Array.from(rows);
}

export function stormLayerNative(asteroid, camera, width, height, timeSeconds, threshold, options = {}) {
  renderStats.stormLayerCalls += 1;
  if (!coreModule) {
    renderStats.stormLayerNotReady += 1;
    return null;
  }
  if (!asteroid?.storm || !camera || width <= 0 || height <= 0) {
    renderStats.stormLayerFailed += 1;
    return null;
  }

  const tileCount = (asteroid.widthTiles || 0) * (asteroid.heightTiles || 0);
  if (!tileCount || !Array.isArray(asteroid.storm)) {
    renderStats.stormLayerFailed += 1;
    return null;
  }

  const module = coreModule;
  syncStormGrid(module, asteroid);
  const hasPlayableGrid = gridLikeLength(asteroid.tiles) === tileCount &&
    gridLikeLength(asteroid.playable) === tileCount;
  if (hasPlayableGrid) {
    syncVisibilityGrid(module, asteroid);
  }
  syncStormPermutation(module, `${asteroid.seed || "default"}:storm-visual`);
  ensureRenderLayerBuffer(module, width * height);
  const mask = syncLayerMask(module, options.visibility);
  const constants = options.constants || {};
  const frame = Math.floor(Number(timeSeconds || 0) * Number(constants.fps || 20));
  const start = nowMs();
  const ok = module._bs_render_storm_layer(
    stormStatePtr,
    hasPlayableGrid ? visibilityPlayablePtr : 0,
    stormPermPtr,
    asteroid.widthTiles,
    asteroid.heightTiles,
    Number(asteroid.tileSize || RENDER.tileSize),
    Number(camera.x || 0),
    Number(camera.y || 0),
    Math.floor(width),
    Math.floor(height),
    Math.floor(Number(options.sourcePadding || 0)),
    options.noLens ? 0 : Number(options.lensEdgeScale || 1),
    Number(options.lensPower || 2),
    Number(options.lensNoiseRadial || 0),
    Number(options.lensNoiseTangential || 0),
    Number(options.lensDefectDensity || 0),
    mask.rowPtr,
    mask.rowCount,
    mask.spanPtr,
    mask.spanCount,
    mask.offsetY,
    frame,
    Number(constants.fps || 20),
    Number(threshold ?? 0.34),
    Number(constants.scale || 0.15),
    Number(constants.speedX ?? -2),
    Number(constants.speedY ?? 5),
    Number(constants.speedZ ?? 0.1),
    renderLayerPtr,
    renderLayerCapacity
  );
  renderStats.stormLayerNativeCalls += 1;
  renderStats.stormLayerTotalMs += nowMs() - start;
  if (!ok || ok <= 0) {
    renderStats.stormLayerFailed += 1;
    return null;
  }

  return Uint8Array.from(module.HEAPU8.subarray(renderLayerPtr, renderLayerPtr + width * height));
}

export function stormRunsNative(asteroid, camera, width, height, timeSeconds, threshold, options = {}) {
  renderStats.stormRunCalls += 1;
  if (!coreModule) {
    renderStats.stormRunNotReady += 1;
    return null;
  }
  if (!asteroid?.storm || !camera || width <= 0 || height <= 0) {
    renderStats.stormRunFailed += 1;
    return null;
  }

  const tileCount = (asteroid.widthTiles || 0) * (asteroid.heightTiles || 0);
  if (!tileCount || !Array.isArray(asteroid.storm)) {
    renderStats.stormRunFailed += 1;
    return null;
  }

  const module = coreModule;
  syncStormGrid(module, asteroid);
  const hasPlayableGrid = gridLikeLength(asteroid.tiles) === tileCount &&
    gridLikeLength(asteroid.playable) === tileCount;
  if (hasPlayableGrid) {
    syncVisibilityGrid(module, asteroid);
  }
  syncStormPermutation(module, `${asteroid.seed || "default"}:storm-visual`);
  const pixelCount = Math.floor(width) * Math.floor(height);
  ensureRenderLayerBuffer(module, pixelCount);
  ensureStormRunBuffer(module, Math.max(1024, Math.ceil(pixelCount / 2)));
  const constants = options.constants || {};
  const frame = Math.floor(Number(timeSeconds || 0) * Number(constants.fps || 20));
  const start = nowMs();
  const count = module._bs_render_storm_runs(
    stormStatePtr,
    hasPlayableGrid ? visibilityPlayablePtr : 0,
    stormPermPtr,
    asteroid.widthTiles,
    asteroid.heightTiles,
    Number(asteroid.tileSize || RENDER.tileSize),
    Number(camera.x || 0),
    Number(camera.y || 0),
    Math.floor(width),
    Math.floor(height),
    Math.floor(Number(options.sourcePadding || 0)),
    options.noLens ? 0 : Number(options.lensEdgeScale || 1),
    Number(options.lensPower || 2),
    Number(options.lensNoiseRadial || 0),
    Number(options.lensNoiseTangential || 0),
    Number(options.lensDefectDensity || 0),
    frame,
    Number(constants.fps || 20),
    Number(threshold ?? 0.34),
    Number(constants.scale || 0.15),
    Number(constants.speedX ?? -2),
    Number(constants.speedY ?? 5),
    Number(constants.speedZ ?? 0.1),
    renderLayerPtr,
    renderLayerCapacity,
    stormRunPtr,
    stormRunCapacity * 4
  );
  renderStats.stormRunNativeCalls += 1;
  renderStats.stormRunTotalMs += nowMs() - start;
  if (!Number.isFinite(count) || count === 0) {
    renderStats.stormRunFailed += 1;
    return null;
  }
  if (count < 0) {
    renderStats.stormRunOverflow += 1;
    renderStats.stormRunFailed += 1;
    return null;
  }

  renderStats.stormRunMaxRuns = Math.max(renderStats.stormRunMaxRuns, count);
  const values = module.HEAP32.subarray(stormRunPtr >> 2, (stormRunPtr >> 2) + count * 4);
  return Int32Array.from(values);
}

export function stormBoundaryRunsNative(asteroid, camera, width, height, timeSeconds, threshold, options = {}) {
  renderStats.stormBoundaryRunCalls += 1;
  if (!coreModule) {
    renderStats.stormBoundaryRunNotReady += 1;
    return null;
  }
  if (!asteroid?.storm || !camera || width <= 0 || height <= 0) {
    renderStats.stormBoundaryRunFailed += 1;
    return null;
  }

  const tileCount = (asteroid.widthTiles || 0) * (asteroid.heightTiles || 0);
  if (
    !tileCount ||
    !Array.isArray(asteroid.storm) ||
    gridLikeLength(asteroid.tiles) !== tileCount ||
    gridLikeLength(asteroid.playable) !== tileCount
  ) {
    renderStats.stormBoundaryRunFailed += 1;
    return null;
  }

  const module = coreModule;
  syncStormGrid(module, asteroid);
  syncVisibilityGrid(module, asteroid);
  syncStormPermutation(module, `${asteroid.seed || "default"}:storm-visual`);
  const pixelCount = Math.floor(width) * Math.floor(height);
  ensureStormRunBuffer(module, Math.max(1024, Math.ceil(pixelCount / 2)));
  const constants = options.constants || {};
  const frame = Math.floor(Number(timeSeconds || 0) * Number(constants.fps || 20));
  const start = nowMs();
  const count = module._bs_render_storm_boundary_runs(
    stormStatePtr,
    visibilityPlayablePtr,
    stormPermPtr,
    asteroid.widthTiles,
    asteroid.heightTiles,
    Number(asteroid.tileSize || RENDER.tileSize),
    Number(camera.x || 0),
    Number(camera.y || 0),
    Math.floor(width),
    Math.floor(height),
    Math.floor(Number(options.sourcePadding || 0)),
    options.noLens ? 0 : Number(options.lensEdgeScale || 1),
    Number(options.lensPower || 2),
    Number(options.lensNoiseRadial || 0),
    Number(options.lensNoiseTangential || 0),
    Number(options.lensDefectDensity || 0),
    frame,
    Number(constants.fps || 20),
    Number(threshold ?? 0),
    Number(constants.scale || 0.15),
    Number(constants.speedX ?? -2),
    Number(constants.speedY ?? 5),
    Number(constants.speedZ ?? 0.1),
    stormRunPtr,
    stormRunCapacity * 4
  );
  renderStats.stormBoundaryRunNativeCalls += 1;
  renderStats.stormBoundaryRunTotalMs += nowMs() - start;
  if (!Number.isFinite(count) || count === 0) {
    renderStats.stormBoundaryRunFailed += 1;
    return null;
  }
  if (count < 0) {
    renderStats.stormBoundaryRunOverflow += 1;
    renderStats.stormBoundaryRunFailed += 1;
    return null;
  }

  renderStats.stormBoundaryRunMaxRuns = Math.max(renderStats.stormBoundaryRunMaxRuns, count);
  const values = module.HEAP32.subarray(stormRunPtr >> 2, (stormRunPtr >> 2) + count * 4);
  return Int32Array.from(values);
}

export function huckRockHullNative(seed, centerX, centerY, radius, yaw, pitch, roll) {
  renderStats.huckRockCalls += 1;
  if (!coreModule) {
    renderStats.huckRockNotReady += 1;
    return null;
  }
  if (![centerX, centerY, radius, yaw, pitch, roll].every(Number.isFinite) || radius <= 0) {
    renderStats.huckRockFailed += 1;
    return null;
  }

  const module = coreModule;
  ensureHuckRockHullBuffer(module);
  const start = nowMs();
  const count = module._bs_huck_rock_hull(
    hashString32(String(seed)),
    Number(centerX),
    Number(centerY),
    Number(radius),
    Number(yaw),
    Number(pitch),
    Number(roll),
    huckRockHullPtr,
    HUCK_ROCK_MAX_HULL_POINTS * 2
  );
  renderStats.huckRockNativeCalls += 1;
  renderStats.huckRockTotalMs += nowMs() - start;
  if (!Number.isInteger(count) || count < 2 || count > HUCK_ROCK_MAX_HULL_POINTS) {
    renderStats.huckRockFailed += 1;
    return null;
  }

  const values = module.HEAPF64.subarray(
    huckRockHullPtr >> 3,
    (huckRockHullPtr >> 3) + count * 2
  );
  const hull = [];
  for (let index = 0; index < count; index += 1) {
    hull.push({
      x: values[index * 2],
      y: values[index * 2 + 1]
    });
  }
  return hull;
}

export function visibilityCheckerLayerNative(asteroid, camera, width, height, options = {}) {
  renderStats.renderLayerCalls += 1;
  if (!coreModule) {
    renderStats.renderLayerNotReady += 1;
    return null;
  }
  if (!asteroid || !camera || width <= 0 || height <= 0) {
    renderStats.renderLayerFailed += 1;
    return null;
  }

  const tileCount = (asteroid.widthTiles || 0) * (asteroid.heightTiles || 0);
  if (
    !tileCount ||
    gridLikeLength(asteroid.tiles) !== tileCount ||
    gridLikeLength(asteroid.playable) !== tileCount
  ) {
    renderStats.renderLayerFailed += 1;
    return null;
  }

  const module = coreModule;
  syncVisibilityGrid(module, asteroid);
  ensureRenderLayerBuffer(module, width * height);
  const start = nowMs();
  const ok = module._bs_render_visibility_checker_layer(
    visibilityTilePtr,
    visibilityPlayablePtr,
    asteroid.widthTiles,
    asteroid.heightTiles,
    Number(asteroid.tileSize || RENDER.tileSize),
    Number(camera.x || 0),
    Number(camera.y || 0),
    Math.floor(width),
    Math.floor(height),
    Math.floor(Number(options.sourcePadding || 0)),
    Number(options.lensEdgeScale || 1),
    Number(options.lensPower || 2),
    Number(options.lensNoiseRadial || 0),
    Number(options.lensNoiseTangential || 0),
    Number(options.lensDefectDensity || 0),
    renderLayerPtr,
    renderLayerCapacity
  );
  renderStats.renderLayerNativeCalls += 1;
  renderStats.renderLayerTotalMs += nowMs() - start;
  if (!ok) {
    renderStats.renderLayerFailed += 1;
    return null;
  }

  return Uint8Array.from(module.HEAPU8.subarray(renderLayerPtr, renderLayerPtr + width * height));
}

function ensureBlockerBuffer(module, requiredDoubles) {
  if (blockerPtr && blockerCapacity >= requiredDoubles) {
    return;
  }
  if (blockerPtr) {
    module._free(blockerPtr);
  }
  blockerCapacity = Math.max(requiredDoubles, blockerCapacity * 2, 128);
  blockerPtr = module._malloc(blockerCapacity * Float64Array.BYTES_PER_ELEMENT);
}

function ensureVisibilitySegmentBuffer(module, requiredDoubles) {
  if (visibilitySegmentPtr && visibilitySegmentCapacity >= requiredDoubles) {
    return;
  }
  if (visibilitySegmentPtr) {
    module._free(visibilitySegmentPtr);
  }
  visibilitySegmentCapacity = Math.max(requiredDoubles, visibilitySegmentCapacity * 2, 256);
  visibilitySegmentPtr = module._malloc(visibilitySegmentCapacity * Float64Array.BYTES_PER_ELEMENT);
}

function ensureVisibilityOutputBuffers(module, requiredRows, requiredSpanInts) {
  if (!visibilityMetaPtr) {
    visibilityMetaPtr = module._malloc(VISIBILITY_META_DOUBLES * Float64Array.BYTES_PER_ELEMENT);
  }
  if (!visibilityRowPtr || visibilityRowCapacity < requiredRows) {
    if (visibilityRowPtr) {
      module._free(visibilityRowPtr);
    }
    visibilityRowCapacity = Math.max(requiredRows, visibilityRowCapacity * 2, 128);
    visibilityRowPtr = module._malloc(visibilityRowCapacity * 2 * Int32Array.BYTES_PER_ELEMENT);
  }
  if (!visibilitySpanPtr || visibilitySpanCapacity < requiredSpanInts) {
    if (visibilitySpanPtr) {
      module._free(visibilitySpanPtr);
    }
    visibilitySpanCapacity = Math.max(requiredSpanInts, visibilitySpanCapacity * 2, 4096);
    visibilitySpanPtr = module._malloc(visibilitySpanCapacity * Int32Array.BYTES_PER_ELEMENT);
  }
}

function syncVisibilityGrid(module, asteroid) {
  const length = asteroid.tiles.length;
  ensureVisibilityGridBuffers(module, length);
  const key = [
    asteroid.seed || "",
    asteroid.revision || asteroid._revision || 0,
    asteroid.tiles.length,
    asteroid.widthTiles,
    asteroid.heightTiles
  ].join(":");
  if (visibilitySyncedAsteroid === asteroid && visibilitySyncedKey === key) {
    return;
  }

  const start = nowMs();
  const heap = module.HEAPU8;
  for (let index = 0; index < length; index += 1) {
    heap[visibilityTilePtr + index] = tileCode(asteroid.tiles[index]);
    heap[visibilityPlayablePtr + index] = asteroid.playable[index] === true || asteroid.playable[index] === "1" ? 1 : 0;
  }
  visibilitySyncedAsteroid = asteroid;
  visibilitySyncedKey = key;
  renderStats.visibilityGridSyncs += 1;
  renderStats.visibilityGridSyncMs += nowMs() - start;
}

function ensureVisibilityGridBuffers(module, length) {
  if (visibilityTilePtr && visibilityGridCapacity >= length) {
    return;
  }
  if (visibilityTilePtr) {
    module._free(visibilityTilePtr);
    module._free(visibilityPlayablePtr);
  }
  visibilityGridCapacity = Math.max(length, visibilityGridCapacity * 2, 1024);
  visibilityTilePtr = module._malloc(visibilityGridCapacity);
  visibilityPlayablePtr = module._malloc(visibilityGridCapacity);
  visibilitySyncedAsteroid = null;
  visibilitySyncedKey = "";
}

function ensureStormRowBuffer(module, requiredRows) {
  if (stormRowPtr && stormRowCapacity >= requiredRows) {
    return;
  }
  if (stormRowPtr) {
    module._free(stormRowPtr);
  }
  stormRowCapacity = Math.max(requiredRows, stormRowCapacity * 2, 32);
  stormRowPtr = module._malloc(stormRowCapacity * Uint32Array.BYTES_PER_ELEMENT);
}

function syncStormGrid(module, asteroid) {
  const length = asteroid.storm.length;
  ensureStormGridBuffer(module, length);
  const key = [
    asteroid.seed || "",
    asteroid.revision || asteroid._revision || 0,
    asteroid.storm.length,
    asteroid.widthTiles,
    asteroid.heightTiles
  ].join(":");
  if (stormStateSyncedAsteroid === asteroid && stormStateSyncedKey === key) {
    return;
  }

  const heap = module.HEAPU8;
  for (let index = 0; index < length; index += 1) {
    heap[stormStatePtr + index] = Number(asteroid.storm[index] || 0);
  }
  stormStateSyncedAsteroid = asteroid;
  stormStateSyncedKey = key;
}

function ensureStormGridBuffer(module, length) {
  if (stormStatePtr && stormStateCapacity >= length) {
    return;
  }
  if (stormStatePtr) {
    module._free(stormStatePtr);
  }
  stormStateCapacity = Math.max(length, stormStateCapacity * 2, 1024);
  stormStatePtr = module._malloc(stormStateCapacity);
  stormStateSyncedAsteroid = null;
  stormStateSyncedKey = "";
}

function syncStormPermutation(module, key) {
  if (!stormPermPtr) {
    stormPermPtr = module._malloc(512);
    stormPermKey = "";
  }
  if (stormPermKey === key) {
    return;
  }

  const random = createSeededRandom(key);
  const permutation = Array.from({ length: 256 }, (_value, index) => index);
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = permutation[index];
    permutation[index] = permutation[swapIndex];
    permutation[swapIndex] = value;
  }

  const heap = module.HEAPU8;
  for (let index = 0; index < 512; index += 1) {
    heap[stormPermPtr + index] = permutation[index & 255];
  }
  stormPermKey = key;
}

function syncLayerMask(module, visibility) {
  const rows = visibility?.spans?.rows;
  if (!Array.isArray(rows) || rows.length <= 0) {
    return {
      rowPtr: 0,
      rowCount: 0,
      spanPtr: 0,
      spanCount: 0,
      offsetY: 0
    };
  }

  let spanCount = 0;
  for (const spans of rows) {
    spanCount += Array.isArray(spans) ? spans.length : 0;
  }
  if (spanCount <= 0) {
    return {
      rowPtr: 0,
      rowCount: 0,
      spanPtr: 0,
      spanCount: 0,
      offsetY: 0
    };
  }

  ensureLayerMaskBuffers(module, rows.length, spanCount);
  const rowHeap = module.HEAP32;
  const spanHeap = module.HEAP32;
  const rowOffset = layerMaskRowPtr >> 2;
  const spanOffset = layerMaskSpanPtr >> 2;
  let write = 0;
  for (let row = 0; row < rows.length; row += 1) {
    const spans = Array.isArray(rows[row]) ? rows[row] : null;
    rowHeap[rowOffset + row * 2] = write;
    rowHeap[rowOffset + row * 2 + 1] = spans ? spans.length : 0;
    if (!spans) {
      continue;
    }
    for (let index = 0; index < spans.length; index += 1) {
      spanHeap[spanOffset + write] = Math.floor(Number(spans[index] || 0));
      write += 1;
    }
  }

  return {
    rowPtr: layerMaskRowPtr,
    rowCount: rows.length,
    spanPtr: layerMaskSpanPtr,
    spanCount: write,
    offsetY: Math.floor(Number(visibility.spans.offsetY || 0))
  };
}

function ensureLayerMaskBuffers(module, rowCount, spanCount) {
  if (!layerMaskRowPtr || layerMaskRowCapacity < rowCount) {
    if (layerMaskRowPtr) {
      module._free(layerMaskRowPtr);
    }
    layerMaskRowCapacity = Math.max(rowCount, layerMaskRowCapacity * 2, 128);
    layerMaskRowPtr = module._malloc(layerMaskRowCapacity * 2 * Int32Array.BYTES_PER_ELEMENT);
  }
  if (!layerMaskSpanPtr || layerMaskSpanCapacity < spanCount) {
    if (layerMaskSpanPtr) {
      module._free(layerMaskSpanPtr);
    }
    layerMaskSpanCapacity = Math.max(spanCount, layerMaskSpanCapacity * 2, 4096);
    layerMaskSpanPtr = module._malloc(layerMaskSpanCapacity * Int32Array.BYTES_PER_ELEMENT);
  }
}

function ensureHuckRockHullBuffer(module) {
  if (huckRockHullPtr) {
    return;
  }
  huckRockHullPtr = module._malloc(HUCK_ROCK_MAX_HULL_POINTS * 2 * Float64Array.BYTES_PER_ELEMENT);
}

function ensureRenderLayerBuffer(module, requiredBytes) {
  if (renderLayerPtr && renderLayerCapacity >= requiredBytes) {
    return;
  }
  if (renderLayerPtr) {
    module._free(renderLayerPtr);
  }
  renderLayerCapacity = Math.max(requiredBytes, renderLayerCapacity * 2, 1024);
  renderLayerPtr = module._malloc(renderLayerCapacity);
}

function ensureStormRunBuffer(module, requiredRuns) {
  if (stormRunPtr && stormRunCapacity >= requiredRuns) {
    return;
  }
  if (stormRunPtr) {
    module._free(stormRunPtr);
  }
  stormRunCapacity = Math.max(requiredRuns, stormRunCapacity * 2, 4096);
  stormRunPtr = module._malloc(stormRunCapacity * 4 * Int32Array.BYTES_PER_ELEMENT);
}

function nativePathSearchSupported(arena, options = {}) {
  if (!arena?.asteroid) {
    return false;
  }
  if (options.pathExploreHeat instanceof Map && options.pathExploreHeat.size > 0) {
    return false;
  }
  if (options.pathThreatSector) {
    return false;
  }
  return true;
}

function syncPathGrid(module, arena) {
  const asteroid = arena.asteroid;
  const length = asteroid.tiles.length;
  ensurePathGridBuffers(module, length);
  const key = `${arena.id || ""}:${arena.tick}:${arena.asteroidUpdates?.length || 0}:${arena.stormUpdates?.length || 0}:${arena.asteroidMining?.size || 0}`;
  if (pathSyncedArena === arena && pathSyncedKey === key) {
    return;
  }

  const start = nowMs();
  const heapU8 = module.HEAPU8;
  const tileOffset = pathTilePtr;
  const playableOffset = pathPlayablePtr;
  const stormOffset = pathStormPtr;
  const amountOffset = pathAmountPtr;
  for (let index = 0; index < length; index += 1) {
    heapU8[tileOffset + index] = tileCode(asteroid.tiles[index]);
    heapU8[playableOffset + index] = asteroid.playable[index] === true || asteroid.playable[index] === "1" ? 1 : 0;
    heapU8[stormOffset + index] = arena.storm ? Number(arena.storm.state[index] || 0) : 0;
    heapU8[amountOffset + index] = Number(asteroid.amounts?.[index] || 0);
  }

  const progress = module.HEAPF32;
  const progressOffset = pathMiningProgressPtr >> 2;
  progress.fill(0, progressOffset, progressOffset + length);
  if (arena.asteroidMining instanceof Map) {
    for (const [index, mining] of arena.asteroidMining.entries()) {
      if (Number.isInteger(index) && index >= 0 && index < length) {
        progress[progressOffset + index] = Number(mining?.progress || 0);
      }
    }
  }

  pathSyncedArena = arena;
  pathSyncedKey = key;
  pathStats.syncs += 1;
  pathStats.syncMs += nowMs() - start;
}

function ensurePathGridBuffers(module, length) {
  if (pathTilePtr && pathCapacity >= length) {
    return;
  }
  if (pathTilePtr) {
    module._free(pathTilePtr);
    module._free(pathPlayablePtr);
    module._free(pathStormPtr);
    module._free(pathAmountPtr);
    module._free(pathMiningProgressPtr);
  }
  pathCapacity = Math.max(length, pathCapacity * 2, 1024);
  pathTilePtr = module._malloc(pathCapacity);
  pathPlayablePtr = module._malloc(pathCapacity);
  pathStormPtr = module._malloc(pathCapacity);
  pathAmountPtr = module._malloc(pathCapacity);
  pathMiningProgressPtr = module._malloc(pathCapacity * Float32Array.BYTES_PER_ELEMENT);
  pathSyncedArena = null;
  pathSyncedKey = "";
}

function ensurePathOutputBuffer(module) {
  if (!pathOutPtr) {
    pathOutPtr = module._malloc(PATH_MAX_INDEXES * Int32Array.BYTES_PER_ELEMENT);
  }
  if (!pathMetaPtr) {
    pathMetaPtr = module._malloc(PATH_META_DOUBLES * Float64Array.BYTES_PER_ELEMENT);
  }
}

function tileCode(tile) {
  if (tile === ASTEROID_TILE.rock) {
    return 1;
  }
  if (tile === ASTEROID_TILE.ore) {
    return 2;
  }
  if (tile === ASTEROID_TILE.diamond) {
    return 3;
  }
  if (tile === ASTEROID_TILE.wall) {
    return 4;
  }
  return 0;
}

function gridLikeLength(value) {
  return (Array.isArray(value) || typeof value === "string" || ArrayBuffer.isView(value))
    ? value.length
    : -1;
}

function hashString32(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function ensureOutBuffer(module) {
  if (outPtr) {
    return;
  }
  outPtr = module._malloc(TRAJECTORY_OUT_DOUBLES * Float64Array.BYTES_PER_ELEMENT);
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

async function loadBitspaceCore() {
  const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  if (isBrowser) {
    const factory = (await import("/wasm/bitspace_core.js")).default;
    return factory({
      locateFile(path) {
        return `/wasm/${path}`;
      }
    });
  }

  const factory = (await import("../../public/wasm/bitspace_core.js")).default;
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const directory = dirname(fileURLToPath(import.meta.url));
  return factory({
    locateFile(path) {
      return join(directory, "../../public/wasm", path);
    }
  });
}

warmBitspaceCore();
