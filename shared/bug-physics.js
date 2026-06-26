import { ENGINE } from "./constants.js";
import {
  ASTEROID_TILE,
  blockingTilesNearCircle,
  circleBlockerOverlap,
  isAsteroidRockTile
} from "./asteroid.js";
import { clamp, roundForSnapshot } from "./math.js";

const BUG_LEG_COUNT = 8;
const BUG_LEG_ANGLE_OFFSET = Math.PI * 2 / 16;
const BUG_LEG_ACTIVE_NONE = -1;

export function simulateBugMovement(player, move, effects, dtSeconds, terrain = null) {
  const speedScale = Math.max(1, Number(effects?.thrustMultiplier) || 1);
  player.bugSpeedScale = speedScale;
  player.bugLegSizeScale = Math.max(0.1, ENGINE.bugs.legBaseSizeScale ?? 1) +
    (speedScale - 1) * (ENGINE.bugs.legSizeRampScale ?? 0.5);
  ensureBugLegState(player);
  clampBugLegStateToCore(player, terrain);

  const magnitude = Math.hypot(move.x, move.y);
  const moving = magnitude > 0.000001;
  const direction = moving
    ? { x: move.x / magnitude, y: move.y / magnitude }
    : bugLastMoveDirection(player);
  const contactNormals = bugTerrainContactNormals(player, terrain);
  const contactMove = moving ? bugProjectVectorOutOfContacts(direction, contactNormals) : direction;
  const contactMoveMagnitude = Math.hypot(contactMove.x, contactMove.y);
  const driveDirection = moving && contactMoveMagnitude > 0.0001
    ? { x: contactMove.x / contactMoveMagnitude, y: contactMove.y / contactMoveMagnitude }
    : direction;
  const canDrive = moving && contactMoveMagnitude > 0.0001;

  if (moving) {
    player.bugMoveX = direction.x;
    player.bugMoveY = direction.y;
  }

  const hadActiveLegAtTickStart = bugHasActiveLeg(player);
  advanceBugActiveLeg(player, dtSeconds);
  if (canDrive && !hadActiveLegAtTickStart && !bugHasActiveLeg(player)) {
    for (const legIndex of bugConstrainingLegCandidates(player, driveDirection)) {
      if (startBugLegStep(player, legIndex, driveDirection, terrain)) {
        advanceBugActiveLeg(player, dtSeconds);
        break;
      }
    }
  }

  const currentVelocity = bugProjectVectorOutOfContacts({ x: player.vx, y: player.vy }, contactNormals);
  player.vx = currentVelocity.x;
  player.vy = currentVelocity.y;

  const targetVelocity = bugLegDrivenVelocity(player, driveDirection, canDrive);
  const correction = bugProjectVectorOutOfContacts(bugLegConstraintCorrection(player), contactNormals);
  const damping = Math.max(0, ENGINE.bugs.legDamping ?? ENGINE.bugs.coreDamping ?? 0);
  const pull = Math.max(0, ENGINE.bugs.corePull || 0) * bugLegSizeScale(player);

  player.vx += correction.x * pull * dtSeconds;
  player.vy += correction.y * pull * dtSeconds;
  player.vx += (targetVelocity.x - player.vx) * clamp(damping * dtSeconds, 0, 1);
  player.vy += (targetVelocity.y - player.vy) * clamp(damping * dtSeconds, 0, 1);
  const nextVelocity = bugProjectVectorOutOfContacts({ x: player.vx, y: player.vy }, contactNormals);
  player.vx = nextVelocity.x;
  player.vy = nextVelocity.y;
  updateBugLegCenter(player);
}

export function ensureBugLegState(player) {
  if (!Array.isArray(player.bugLegs) || player.bugLegs.length !== BUG_LEG_COUNT) {
    player.bugLegs = createBugLegs(player);
  } else {
    for (let index = 0; index < BUG_LEG_COUNT; index += 1) {
      const leg = player.bugLegs[index] || {};
      const fallback = bugRestFoot(player, index);
      player.bugLegs[index] = {
        ...leg,
        x: Number.isFinite(leg.x) ? leg.x : fallback.x,
        y: Number.isFinite(leg.y) ? leg.y : fallback.y,
        lift: Number.isFinite(leg.lift) ? leg.lift : 0
      };
    }
  }

  if (!Number.isInteger(player.bugActiveLegIndex)) {
    player.bugActiveLegIndex = BUG_LEG_ACTIVE_NONE;
  }
  if (!Number.isFinite(player.bugMoveX) || !Number.isFinite(player.bugMoveY)) {
    player.bugMoveX = 1;
    player.bugMoveY = 0;
  }
  if (!Number.isInteger(player.bugStepCounter)) {
    player.bugStepCounter = 0;
  }
  updateBugLegCenter(player);
}

export function clampBugLegStateToCore(player, terrain = null) {
  ensureBugLegState(player);
  const radius = bugLegTargetRadius(player) * 1.08;
  for (let index = 0; index < player.bugLegs.length; index += 1) {
    const leg = player.bugLegs[index];
    const targetCenter = bugLegTargetCenter(player, index);
    const dx = leg.x - targetCenter.x;
    const dy = leg.y - targetCenter.y;
    const distance = Math.hypot(dx, dy);
    if ((distance <= radius || distance <= 0.0001) && !bugLegPlacementBlocked(player, index, terrain, leg)) {
      continue;
    }
    const scale = distance > 0.0001 ? radius / distance : 0;
    const clamped = distance > 0.0001
      ? {
          x: targetCenter.x + dx * scale,
          y: targetCenter.y + dy * scale
        }
      : targetCenter;
    const safe = bugSafeLegPoint(player, index, clamped, terrain, bugLegRadial(index));
    if (!safe) {
      continue;
    }
    leg.x = safe.x;
    leg.y = safe.y;
    leg.lift = 0;
  }
  updateBugLegCenter(player);
}

export function cloneBugLegs(legs) {
  return Array.isArray(legs)
    ? legs.map((leg) => ({
        ...leg,
        step: leg?.step ? { ...leg.step } : null
      }))
    : null;
}

export function serializeBugLegsForSnapshot(player) {
  ensureBugLegState(player);
  return player.bugLegs.map((leg) => ({
    x: roundForSnapshot(leg.x),
    y: roundForSnapshot(leg.y),
    lift: roundForSnapshot(leg.lift || 0),
    step: serializeBugLegStep(leg)
  }));
}

function serializeBugLegStep(leg) {
  const step = leg?.step;
  if (!step) {
    return null;
  }

  return {
    fromX: roundForSnapshot(step.fromX),
    fromY: roundForSnapshot(step.fromY),
    targetX: roundForSnapshot(step.targetX),
    targetY: roundForSnapshot(step.targetY),
    progress: roundForSnapshot(clamp(step.elapsed / Math.max(0.001, step.duration), 0, 1))
  };
}

function createBugLegs(player) {
  return Array.from({ length: BUG_LEG_COUNT }, (_value, index) => {
    const foot = bugRestFoot(player, index);
    return {
      x: foot.x,
      y: foot.y,
      lift: 0
    };
  });
}

function bugRestFoot(player, index) {
  return bugLegTargetCenter(player, index);
}

function bugLegTargetCenter(player, index) {
  const radial = bugLegRadial(index);
  const distance = Math.max(1, player.radius || ENGINE.ship.radius) *
    (ENGINE.bugs.legRestScale ?? 1.55) *
    bugLegSizeScale(player);
  return {
    x: (Number.isFinite(player.x) ? player.x : 0) + radial.x * distance,
    y: (Number.isFinite(player.y) ? player.y : 0) + radial.y * distance
  };
}

function bugLegAnchor(player, index) {
  const radial = bugLegRadial(index);
  const distance = Math.max(1, player.radius || ENGINE.ship.radius) *
    (ENGINE.bugs.legAttachmentScale ?? 0.66) *
    bugLegSizeScale(player);
  return {
    x: player.x + radial.x * distance,
    y: player.y + radial.y * distance
  };
}

function bugLegRadial(index) {
  const angle = index / BUG_LEG_COUNT * Math.PI * 2 + BUG_LEG_ANGLE_OFFSET;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function bugAllowedLegRadius(player) {
  const scale = bugLegSizeScale(player);
  return Math.max(
    2,
    (Number(ENGINE.bugs.legRadius) ||
      Number(ENGINE.bugs.maxLegCenterOffset) ||
      Math.max(1, player.radius || ENGINE.ship.radius) * 1.8) * scale
  );
}

function bugLegTargetRadius(player) {
  return Math.max(
    2,
    Math.max(1, player.radius || ENGINE.ship.radius) *
      (ENGINE.bugs.legTargetRadiusScale ?? 0.95) *
      bugLegSizeScale(player)
  );
}

function bugLegSizeScale(player) {
  const scale = Number(player?.bugLegSizeScale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function bugSpeedScale(player) {
  const scale = Number(player?.bugSpeedScale);
  return Number.isFinite(scale) && scale > 0 ? scale : bugLegSizeScale(player);
}

function bugHasActiveLeg(player) {
  const index = player.bugActiveLegIndex;
  return Number.isInteger(index) &&
    index >= 0 &&
    index < BUG_LEG_COUNT &&
    Boolean(player.bugLegs[index]?.step);
}

function bugLastMoveDirection(player) {
  const x = Number(player.bugMoveX) || 0;
  const y = Number(player.bugMoveY) || 0;
  const magnitude = Math.hypot(x, y);
  return magnitude > 0.0001
    ? { x: x / magnitude, y: y / magnitude }
    : { x: 1, y: 0 };
}

function bugConstrainingLegCandidates(player, direction) {
  const candidates = [];
  const targetRadius = bugLegTargetRadius(player);
  const side = { x: -direction.y, y: direction.x };
  const frontScale = ENGINE.bugs.legFrontScale ?? 0.95;

  for (let index = 0; index < BUG_LEG_COUNT; index += 1) {
    const leg = player.bugLegs[index];
    if (!leg || leg.step) {
      continue;
    }
    const targetCenter = bugLegTargetCenter(player, index);
    const dx = leg.x - targetCenter.x;
    const dy = leg.y - targetCenter.y;
    const progress = (dx * direction.x + dy * direction.y) / targetRadius;
    const forwardGain = frontScale - progress;
    if (forwardGain <= 0.05) {
      continue;
    }
    const extension = Math.hypot(dx, dy) / targetRadius;
    const sideLoad = Math.abs(dx * side.x + dy * side.y) / targetRadius;
    const score = forwardGain + Math.max(0, extension - 1) * 1.5 - sideLoad * 0.12;
    if (score > 0.18) {
      candidates.push({ index, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((candidate) => candidate.index);
}

function startBugLegStep(player, index, direction, terrain = null) {
  const leg = player.bugLegs[index];
  if (!leg) {
    return false;
  }

  const targetCenter = bugLegTargetCenter(player, index);
  const targetRadius = bugLegTargetRadius(player);
  const jitter = bugLegStepJitter(player, index, direction, targetRadius);
  const target = {
    x: targetCenter.x + direction.x * targetRadius * (ENGINE.bugs.legFrontScale ?? 0.95) + jitter.x,
    y: targetCenter.y + direction.y * targetRadius * (ENGINE.bugs.legFrontScale ?? 0.95) + jitter.y
  };
  const clampedTarget = bugSafeLegPoint(player, index, target, terrain, direction);
  if (!clampedTarget) {
    return false;
  }
  const currentProgress = ((leg.x - targetCenter.x) * direction.x + (leg.y - targetCenter.y) * direction.y) / targetRadius;
  const targetProgress = ((clampedTarget.x - targetCenter.x) * direction.x + (clampedTarget.y - targetCenter.y) * direction.y) / targetRadius;
  if (targetProgress <= currentProgress + 0.05) {
    return false;
  }
  const distance = Math.hypot(clampedTarget.x - leg.x, clampedTarget.y - leg.y);
  const speed = Math.max(1, ENGINE.bugs.legSwingSpeed || ENGINE.bugs.legSpeed || 1) * bugSpeedScale(player);
  player.bugStepCounter += 1;
  leg.step = {
    fromX: leg.x,
    fromY: leg.y,
    targetX: clampedTarget.x,
    targetY: clampedTarget.y,
    elapsed: 0,
    duration: clamp(distance / speed, 0.025, ENGINE.bugs.legMaxStepSeconds ?? 0.11)
  };
  player.bugActiveLegIndex = index;
  return true;
}

function bugLegStepJitter(player, index, direction, targetRadius) {
  const side = { x: -direction.y, y: direction.x };
  const seed = bugStepSeed(player, index);
  const forward = bugCenteredRandom(seed, 0) *
    targetRadius * (ENGINE.bugs.legRandomForwardScale ?? 0.3);
  const lateral = bugCenteredRandom(seed, 1) *
    targetRadius * (ENGINE.bugs.legRandomSideScale ?? 0.6);
  return {
    x: direction.x * forward + side.x * lateral,
    y: direction.y * forward + side.y * lateral
  };
}

function bugCenteredRandom(seed, salt) {
  return (
    bugRandomUnit(seed, salt * 3) +
    bugRandomUnit(seed, salt * 3 + 1) +
    bugRandomUnit(seed, salt * 3 + 2)
  ) / 1.5 - 1;
}

function bugStepSeed(player, index) {
  const id = String(player?.id || player?.number || "bug");
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= Math.imul(index + 1, 374761393);
  hash ^= Math.imul((Number(player.bugStepCounter) || 0) + 1, 668265263);
  return hash >>> 0;
}

function bugRandomUnit(seed, salt) {
  let value = (seed + Math.imul(salt + 1, 2246822519)) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 2246822519) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489917) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function clampBugPointToLegTarget(player, index, point) {
  const center = bugLegTargetCenter(player, index);
  const radius = bugLegTargetRadius(player);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance <= 0.0001) {
    return point;
  }
  const scale = radius / distance;
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale
  };
}

function bugSafeLegPoint(player, index, point, terrain = null, direction = null) {
  const clamped = clampBugPointToLegTarget(player, index, point);
  const bodyRayPoint = bugBodyRaycastLegPoint(player, clamped, terrain);
  if (bodyRayPoint) {
    return bodyRayPoint;
  }

  const center = bugLegTargetCenter(player, index);
  const radius = bugLegTargetRadius(player);
  const forward = bugNormalizedDirection(direction) ||
    bugNormalizedDirection({ x: clamped.x - center.x, y: clamped.y - center.y }) ||
    bugLegRadial(index);
  const side = { x: -forward.y, y: forward.x };
  const candidates = [
    { f: 0.78, s: 0 },
    { f: 0.58, s: 0 },
    { f: 0.36, s: 0 },
    { f: 0.68, s: 0.32 },
    { f: 0.68, s: -0.32 },
    { f: 0.42, s: 0.52 },
    { f: 0.42, s: -0.52 },
    { f: 0, s: 0.62 },
    { f: 0, s: -0.62 },
    { f: 0, s: 0 }
  ];

  for (const candidate of candidates) {
    const next = {
      x: center.x + forward.x * radius * candidate.f + side.x * radius * candidate.s,
      y: center.y + forward.y * radius * candidate.f + side.y * radius * candidate.s
    };
    const safe = bugBodyRaycastLegPoint(player, clampBugPointToLegTarget(player, index, next), terrain);
    if (safe) {
      return safe;
    }
  }

  const bodyPoint = { x: player.x, y: player.y };
  return bugLegPlacementBlocked(player, index, terrain, bodyPoint) ? null : bodyPoint;
}

function bugBodyRaycastLegPoint(player, point, terrain = null) {
  if (!terrain || !point) {
    return point;
  }

  const hit = bugBodyRaycast(player, point, terrain);
  return hit.hit ? hit.lastSafe : point;
}

function bugBodyRaycast(player, point, terrain = null) {
  const from = {
    x: Number(player?.x) || 0,
    y: Number(player?.y) || 0
  };
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.0001) {
    return {
      hit: bugFootBlocked(terrain, point),
      lastSafe: bugFootBlocked(terrain, point) ? null : point,
      hitPoint: bugFootBlocked(terrain, point) ? point : null
    };
  }

  const tileSize = Math.max(1, Number(terrain.tileSize) || ENGINE.bugs.tileSize || 1);
  const stepSize = Math.max(0.5, Math.min(2, tileSize / 6));
  const steps = Math.max(1, Math.ceil(distance / stepSize));
  const initialBlockedTolerance = Math.max(stepSize, (Number(ENGINE.bugs.footClearance) || 1) + 1);
  let lastSafe = bugFootBlocked(terrain, from) ? null : from;
  let startedBlocked = lastSafe === null;

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const candidate = {
      x: from.x + dx * t,
      y: from.y + dy * t
    };
    if (bugFootBlocked(terrain, candidate)) {
      if (startedBlocked && !lastSafe && distance * t <= initialBlockedTolerance) {
        continue;
      }
      return {
        hit: true,
        lastSafe,
        hitPoint: candidate
      };
    }
    startedBlocked = false;
    lastSafe = candidate;
  }

  return {
    hit: false,
    lastSafe: point,
    hitPoint: null
  };
}

function bugTerrainContactNormals(player, terrain = null) {
  if (!terrain || !player) {
    return [];
  }

  const radius = Math.max(1, Number(player.radius) || ENGINE.ship.radius || 1);
  const skin = Math.max(0.5, Number(ENGINE.bugs.wallContactSkin) || 1.25);
  const circle = {
    x: Number(player.x) || 0,
    y: Number(player.y) || 0,
    radius: radius + skin
  };
  const normals = [];

  for (const blocker of blockingTilesNearCircle(terrain, circle.x, circle.y, circle.radius)) {
    const hit = circleBlockerOverlap(circle, blocker);
    if (!hit) {
      continue;
    }
    const length = Math.hypot(hit.normalX, hit.normalY);
    if (length <= 0.0001) {
      continue;
    }
    normals.push({
      x: hit.normalX / length,
      y: hit.normalY / length
    });
  }

  return normals;
}

function bugProjectVectorOutOfContacts(vector, normals) {
  let x = Number(vector?.x) || 0;
  let y = Number(vector?.y) || 0;
  if (!Array.isArray(normals) || normals.length <= 0 || (x === 0 && y === 0)) {
    return { x, y };
  }

  for (const normal of normals) {
    const dot = x * normal.x + y * normal.y;
    if (dot < 0) {
      x -= dot * normal.x;
      y -= dot * normal.y;
    }
  }

  return Math.hypot(x, y) > 0.000001
    ? { x, y }
    : { x: 0, y: 0 };
}

function bugNormalizedDirection(value) {
  const x = Number(value?.x) || 0;
  const y = Number(value?.y) || 0;
  const length = Math.hypot(x, y);
  return length > 0.0001 ? { x: x / length, y: y / length } : null;
}

function bugFootBlocked(terrain, point) {
  if (!terrain || !point) {
    return false;
  }

  const clearance = Math.max(0, Number(ENGINE.bugs.footClearance) || 1);
  return bugTerrainPointBlocked(terrain, point.x, point.y) ||
    bugTerrainPointBlocked(terrain, point.x - clearance, point.y) ||
    bugTerrainPointBlocked(terrain, point.x + clearance, point.y) ||
    bugTerrainPointBlocked(terrain, point.x, point.y - clearance) ||
    bugTerrainPointBlocked(terrain, point.x, point.y + clearance);
}

function bugLegPlacementBlocked(player, index, terrain, point) {
  if (!terrain || !point) {
    return false;
  }
  if (bugFootBlocked(terrain, point)) {
    return true;
  }

  const anchor = bugLegAnchor(player, index);
  return bugTerrainSegmentBlocked(terrain, anchor, point);
}

function bugTerrainSegmentBlocked(terrain, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.0001) {
    return bugFootBlocked(terrain, from);
  }

  const tileSize = Math.max(1, Number(terrain.tileSize) || ENGINE.bugs.tileSize || 1);
  const stepSize = Math.max(1, Math.min(3, tileSize / 4));
  const steps = Math.max(1, Math.ceil(distance / stepSize));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    if (bugFootBlocked(terrain, { x, y })) {
      return true;
    }
  }

  return false;
}

function bugTerrainPointBlocked(terrain, x, y) {
  const tileSize = Math.max(1, Number(terrain.tileSize) || ENGINE.bugs.tileSize || 1);
  const tileX = Math.floor(x / tileSize);
  const tileY = Math.floor(y / tileSize);
  if (tileX < 0 || tileY < 0 || tileX >= terrain.widthTiles || tileY >= terrain.heightTiles) {
    return true;
  }

  const index = tileY * terrain.widthTiles + tileX;
  const playable = terrain.playable?.[index];
  if (!(playable === true || playable === "1")) {
    return true;
  }

  const tile = terrain.tiles?.[index] ?? ASTEROID_TILE.empty;
  return isAsteroidRockTile(tile);
}

function advanceBugActiveLeg(player, dtSeconds) {
  if (!bugHasActiveLeg(player)) {
    player.bugActiveLegIndex = BUG_LEG_ACTIVE_NONE;
    return;
  }

  const leg = player.bugLegs[player.bugActiveLegIndex];
  const step = leg.step;
  step.elapsed += Math.max(0, dtSeconds);
  const progress = clamp(step.elapsed / Math.max(0.001, step.duration), 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  leg.x = step.fromX + (step.targetX - step.fromX) * eased;
  leg.y = step.fromY + (step.targetY - step.fromY) * eased;
  leg.lift = 0;

  if (progress >= 1) {
    leg.x = step.targetX;
    leg.y = step.targetY;
    leg.lift = 0;
    leg.step = null;
    player.bugActiveLegIndex = BUG_LEG_ACTIVE_NONE;
  }
}

function bugLegDrivenVelocity(player, direction, moving) {
  if (!moving) {
    return { x: 0, y: 0 };
  }

  const targetRadius = bugLegTargetRadius(player);
  let forwardSupport = 0;
  let count = 0;
  for (let index = 0; index < BUG_LEG_COUNT; index += 1) {
    const leg = player.bugLegs[index];
    const targetCenter = bugLegTargetCenter(player, index);
    forwardSupport += ((leg.x - targetCenter.x) * direction.x + (leg.y - targetCenter.y) * direction.y) / targetRadius;
    count += 1;
  }

  const support = count > 0 ? forwardSupport / count : 0;
  const drive01 = clamp(support * 0.7 + (ENGINE.bugs.legDriveBias ?? 0.48), 0, 1);
  const speed = Math.max(0, ENGINE.bugs.legDriveSpeed ?? ENGINE.bugs.legSpeed ?? 0) * bugSpeedScale(player) * drive01;
  return {
    x: direction.x * speed,
    y: direction.y * speed
  };
}

function bugLegConstraintCorrection(player) {
  const allowed = bugAllowedLegRadius(player) * 0.84;
  const targetRadius = bugLegTargetRadius(player);
  let x = 0;
  let y = 0;
  let count = 0;

  for (let index = 0; index < BUG_LEG_COUNT; index += 1) {
    const leg = player.bugLegs[index];
    const anchor = bugLegAnchor(player, index);
    const targetCenter = bugLegTargetCenter(player, index);
    const anchorDx = leg.x - anchor.x;
    const anchorDy = leg.y - anchor.y;
    const anchorDistance = Math.hypot(anchorDx, anchorDy);
    if (anchorDistance > allowed && anchorDistance > 0.0001) {
      const excess = anchorDistance - allowed;
      x += (anchorDx / anchorDistance) * excess;
      y += (anchorDy / anchorDistance) * excess;
      count += 1;
    }

    const targetDx = leg.x - targetCenter.x;
    const targetDy = leg.y - targetCenter.y;
    const targetDistance = Math.hypot(targetDx, targetDy);
    if (targetDistance <= targetRadius || targetDistance <= 0.0001) {
      continue;
    }
    const excess = targetDistance - targetRadius;
    x += (targetDx / targetDistance) * excess;
    y += (targetDy / targetDistance) * excess;
    count += 1;
  }

  return count > 0
    ? { x: x / count, y: y / count }
    : { x: 0, y: 0 };
}

function updateBugLegCenter(player) {
  if (!Array.isArray(player.bugLegs) || player.bugLegs.length <= 0) {
    player.bugLegCenterX = Number.isFinite(player.x) ? player.x : 0;
    player.bugLegCenterY = Number.isFinite(player.y) ? player.y : 0;
    return;
  }

  let x = 0;
  let y = 0;
  for (const leg of player.bugLegs) {
    x += leg.x;
    y += leg.y;
  }
  player.bugLegCenterX = x / player.bugLegs.length;
  player.bugLegCenterY = y / player.bugLegs.length;
}
