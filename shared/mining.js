import { ENGINE } from "./constants.js";

export function miningRayCountForPlayer(player) {
  const rawCount = Number(player?.prototypeMiningRayCount ?? player?.miningRayCount ?? 1);
  const count = Math.round(rawCount);
  if (!Number.isFinite(count)) {
    return 1;
  }

  return Math.max(1, Math.min(ENGINE.mining.maxRayCount, count));
}

export function miningRayLaneOffsets(count, sideOffset = ENGINE.mining.sideRayOffset) {
  if (count <= 1) {
    return [0];
  }

  if (count === 2) {
    return [0, -sideOffset];
  }

  return [0, -sideOffset, sideOffset];
}

export function miningSideRayOffsetForPlayer(player) {
  const radius = Number(player?.radius);
  const baseRadius = Number(ENGINE.ship.radius) || 1;
  if (!Number.isFinite(radius) || radius <= 0) {
    return ENGINE.mining.sideRayOffset;
  }

  return ENGINE.mining.sideRayOffset * (radius / baseRadius);
}

export function miningRayLanePower(offset) {
  return offset === 0 ? 1 : 0.5;
}

export function miningRaySideMinStartDistance(player, offset) {
  const sideDistance = Math.abs(Number(offset) || 0);
  const radius = Number(player?.radius ?? ENGINE.ship.radius);
  const minDistance = Math.max(0, radius - 1);
  return Math.min(sideDistance, minDistance);
}

export function miningRayLanesForPlayer(
  player,
  angle = player?.aimAngle ?? player?.angle ?? 0,
  forwardLength = ENGINE.mining.rayLength,
  sideOffset = ENGINE.mining.sideRayOffset
) {
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const radius = Number(player?.radius ?? ENGINE.ship.radius);
  const start = {
    x: Number(player?.x ?? 0) + direction.x * radius,
    y: Number(player?.y ?? 0) + direction.y * radius
  };

  return miningRayLaneOffsets(miningRayCountForPlayer(player), sideOffset).map((offset, index) => ({
    index,
    offset,
    ...miningRayLaneGeometry(start, direction, normal, offset, forwardLength)
  }));
}

function miningRayLaneGeometry(start, direction, normal, offset, forwardLength) {
  const endOffset = offset * ENGINE.mining.sideRayEndOffsetScale;
  const lateralDelta = endOffset - offset;
  const dx = direction.x * forwardLength + normal.x * lateralDelta;
  const dy = direction.y * forwardLength + normal.y * lateralDelta;
  const rayDistance = Math.max(0.000001, Math.hypot(dx, dy));
  const rayDirectionX = dx / rayDistance;
  const rayDirectionY = dy / rayDistance;
  return {
    power: miningRayLanePower(offset),
    startOffset: offset,
    startX: start.x + normal.x * offset,
    startY: start.y + normal.y * offset,
    endOffset,
    fullEndX: start.x + direction.x * forwardLength + normal.x * endOffset,
    fullEndY: start.y + direction.y * forwardLength + normal.y * endOffset,
    rayAngle: Math.atan2(rayDirectionY, rayDirectionX),
    rayDistance,
    rayDirectionX,
    rayDirectionY
  };
}

export function miningRaySideStartProbe(
  player,
  lane,
  angle = player?.aimAngle ?? player?.angle ?? 0
) {
  const offset = Number(lane?.offset) || 0;
  const sideSign = Math.sign(offset);
  if (sideSign === 0) {
    return null;
  }

  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const radius = Number(player?.radius ?? ENGINE.ship.radius);
  const directionX = normal.x * sideSign;
  const directionY = normal.y * sideSign;
  return {
    startX: Number(player?.x ?? 0) + direction.x * radius,
    startY: Number(player?.y ?? 0) + direction.y * radius,
    directionX,
    directionY,
    angle: Math.atan2(directionY, directionX),
    minDistance: miningRaySideMinStartDistance(player, offset),
    distance: Math.abs(offset)
  };
}

export function miningRayClippedSideStartDistance(probe, hitDistance) {
  const distance = Number(probe?.distance) || 0;
  const minDistance = Math.max(0, Math.min(distance, Number(probe?.minDistance) || 0));
  const clippedDistance = Math.min(distance, Number(hitDistance) - 0.5);
  if (!Number.isFinite(clippedDistance)) {
    return distance;
  }

  return Math.max(minDistance, clippedDistance);
}

export function miningRayLaneWithStart(lane, startX, startY) {
  const dx = lane.fullEndX - startX;
  const dy = lane.fullEndY - startY;
  const rayDistance = Math.max(0.000001, Math.hypot(dx, dy));
  const rayDirectionX = dx / rayDistance;
  const rayDirectionY = dy / rayDistance;
  return {
    ...lane,
    startX,
    startY,
    rayAngle: Math.atan2(rayDirectionY, rayDirectionX),
    rayDistance,
    rayDirectionX,
    rayDirectionY
  };
}
