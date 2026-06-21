import { ENGINE, RENDER } from "./constants.js";

export const BUILD_DIRECTION_STEPS = 360;
const BUILD_VISIBILITY_EPSILON = 0.001;

export function firstTileAlongBuildRay({
  widthTiles,
  heightTiles,
  tileSize = RENDER.tileSize,
  startX,
  startY,
  angle,
  maxDistance = ENGINE.build.radiusTiles * tileSize,
  isCandidate,
  isBlocked = null
}) {
  if (
    !Number.isFinite(widthTiles) ||
    !Number.isFinite(heightTiles) ||
    !Number.isFinite(tileSize) ||
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(angle) ||
    typeof isCandidate !== "function" ||
    (isBlocked !== null && typeof isBlocked !== "function")
  ) {
    return null;
  }

  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (Math.abs(dx) < 0.000001 && Math.abs(dy) < 0.000001) {
    return null;
  }

  let tileX = Math.floor(startX / tileSize);
  let tileY = Math.floor(startY / tileSize);
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const nextBoundaryX = stepX > 0 ? (tileX + 1) * tileSize : tileX * tileSize;
  const nextBoundaryY = stepY > 0 ? (tileY + 1) * tileSize : tileY * tileSize;
  let tMaxX = Math.abs(dx) < 0.000001 ? Infinity : (nextBoundaryX - startX) / dx;
  let tMaxY = Math.abs(dy) < 0.000001 ? Infinity : (nextBoundaryY - startY) / dy;
  const tDeltaX = Math.abs(dx) < 0.000001 ? Infinity : tileSize / Math.abs(dx);
  const tDeltaY = Math.abs(dy) < 0.000001 ? Infinity : tileSize / Math.abs(dy);
  let traveled = 0;
  let guard = widthTiles + heightTiles + Math.ceil(maxDistance / tileSize) * 4 + 8;

  while (
    guard > 0 &&
    traveled <= maxDistance + 0.000001 &&
    tileX >= 0 &&
    tileY >= 0 &&
    tileX < widthTiles &&
    tileY < heightTiles
  ) {
    if (isCandidate(tileX, tileY)) {
      return { tileX, tileY };
    }

    if (isBlocked?.(tileX, tileY)) {
      return null;
    }

    if (tMaxX < tMaxY) {
      traveled = tMaxX;
      tMaxX += tDeltaX;
      tileX += stepX;
    } else if (tMaxY < tMaxX) {
      traveled = tMaxY;
      tMaxY += tDeltaY;
      tileY += stepY;
    } else {
      traveled = tMaxX;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      tileX += stepX;
      tileY += stepY;
    }

    guard -= 1;
  }

  return null;
}

export function buildDirectionAngle(step, steps = BUILD_DIRECTION_STEPS) {
  return (Math.PI * 2 * step) / steps;
}

export function closestBuildTileByCenterAngle({
  tiles = null,
  widthTiles,
  heightTiles,
  tileSize = RENDER.tileSize,
  startX,
  startY,
  angle,
  maxDistance = ENGINE.build.radiusTiles * tileSize,
  isCandidate,
  isVisible = null
}) {
  if (Array.isArray(tiles)) {
    return closestBuildTileFromList(tiles, tileSize, startX, startY, angle);
  }

  if (
    !Number.isFinite(widthTiles) ||
    !Number.isFinite(heightTiles) ||
    !Number.isFinite(tileSize) ||
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(angle) ||
    !Number.isFinite(maxDistance) ||
    typeof isCandidate !== "function" ||
    (isVisible !== null && typeof isVisible !== "function")
  ) {
    return null;
  }

  const minTileX = Math.max(0, Math.floor((startX - maxDistance) / tileSize) - 1);
  const maxTileX = Math.min(widthTiles - 1, Math.ceil((startX + maxDistance) / tileSize) + 1);
  const minTileY = Math.max(0, Math.floor((startY - maxDistance) / tileSize) - 1);
  const maxTileY = Math.min(heightTiles - 1, Math.ceil((startY + maxDistance) / tileSize) + 1);
  let selected = null;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (!isCandidate(tileX, tileY) || (isVisible && !isVisible(tileX, tileY))) {
        continue;
      }

      const centerX = (tileX + 0.5) * tileSize;
      const centerY = (tileY + 0.5) * tileSize;
      const dx = centerX - startX;
      const dy = centerY - startY;
      const distance = Math.hypot(dx, dy);
      if (distance > maxDistance + BUILD_VISIBILITY_EPSILON) {
        continue;
      }

      const centerAngle = Math.atan2(dy, dx);
      const angleDelta = angularDistance(angle, centerAngle);
      if (
        !selected ||
        angleDelta < selected.angleDelta - BUILD_VISIBILITY_EPSILON ||
        (Math.abs(angleDelta - selected.angleDelta) <= BUILD_VISIBILITY_EPSILON &&
          distance < selected.distance - BUILD_VISIBILITY_EPSILON)
      ) {
        selected = {
          tileX,
          tileY,
          angleDelta,
          distance
        };
      }
    }
  }

  return selected ? { tileX: selected.tileX, tileY: selected.tileY } : null;
}

export function buildClosestTileRing({
  widthTiles,
  heightTiles,
  tileSize = RENDER.tileSize,
  startX,
  startY,
  originRadius = ENGINE.ship.radius || 0,
  maxDistance = ENGINE.build.radiusTiles * tileSize,
  isCandidate,
  isNormallyVisible,
  isCornerVisible = null
}) {
  if (
    !Number.isFinite(widthTiles) ||
    !Number.isFinite(heightTiles) ||
    !Number.isFinite(tileSize) ||
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(originRadius) ||
    !Number.isFinite(maxDistance) ||
    typeof isCandidate !== "function" ||
    typeof isNormallyVisible !== "function" ||
    (isCornerVisible !== null && typeof isCornerVisible !== "function")
  ) {
    return [];
  }

  const minTileX = Math.max(0, Math.floor((startX - maxDistance) / tileSize) - 1);
  const maxTileX = Math.min(widthTiles - 1, Math.ceil((startX + maxDistance) / tileSize) + 1);
  const minTileY = Math.max(0, Math.floor((startY - maxDistance) / tileSize) - 1);
  const maxTileY = Math.min(heightTiles - 1, Math.ceil((startY + maxDistance) / tileSize) + 1);
  const originMinTileX = Math.floor((startX - Math.max(0, originRadius)) / tileSize);
  const originMaxTileX = Math.floor((startX + Math.max(0, originRadius)) / tileSize);
  const originMinTileY = Math.floor((startY - Math.max(0, originRadius)) / tileSize);
  const originMaxTileY = Math.floor((startY + Math.max(0, originRadius)) / tileSize);
  const maxRing = Math.max(
    Math.abs(minTileX - originMinTileX),
    Math.abs(maxTileX - originMaxTileX),
    Math.abs(minTileY - originMinTileY),
    Math.abs(maxTileY - originMaxTileY)
  );

  for (let ringDistance = 1; ringDistance <= maxRing; ringDistance += 1) {
    const ring = new Map();
    const left = originMinTileX - ringDistance;
    const right = originMaxTileX + ringDistance;
    const top = originMinTileY - ringDistance;
    const bottom = originMaxTileY + ringDistance;

    for (let tileX = left; tileX <= right; tileX += 1) {
      addBuildRingCandidate(ring, tileX, top, {
        widthTiles,
        heightTiles,
        minTileX,
        maxTileX,
        minTileY,
        maxTileY,
        tileSize,
        startX,
        startY,
        maxDistance,
        isCandidate,
        isNormallyVisible,
        isCornerVisible
      });
      if (bottom !== top) {
        addBuildRingCandidate(ring, tileX, bottom, {
          widthTiles,
          heightTiles,
          minTileX,
          maxTileX,
          minTileY,
          maxTileY,
          tileSize,
          startX,
          startY,
          maxDistance,
          isCandidate,
          isNormallyVisible,
          isCornerVisible
        });
      }
    }

    for (let tileY = top + 1; tileY <= bottom - 1; tileY += 1) {
      addBuildRingCandidate(ring, left, tileY, {
        widthTiles,
        heightTiles,
        minTileX,
        maxTileX,
        minTileY,
        maxTileY,
        tileSize,
        startX,
        startY,
        maxDistance,
        isCandidate,
        isNormallyVisible,
        isCornerVisible
      });
      if (right !== left) {
        addBuildRingCandidate(ring, right, tileY, {
          widthTiles,
          heightTiles,
          minTileX,
          maxTileX,
          minTileY,
          maxTileY,
          tileSize,
          startX,
          startY,
          maxDistance,
          isCandidate,
          isNormallyVisible,
          isCornerVisible
        });
      }
    }

    if (ring.size > 0) {
      return Array.from(ring.values())
        .sort((a, b) => (a.tileY - b.tileY) || (a.tileX - b.tileX))
        .map(({ tileX, tileY }) => ({ tileX, tileY }));
    }
  }

  return [];
}

export function buildTileVisibleFromOrigin({
  tileX,
  tileY,
  tileSize = RENDER.tileSize,
  startX,
  startY,
  includeCorners = false,
  raycast
}) {
  if (
    !Number.isFinite(tileX) ||
    !Number.isFinite(tileY) ||
    !Number.isFinite(tileSize) ||
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    typeof raycast !== "function"
  ) {
    return false;
  }

  const left = tileX * tileSize;
  const top = tileY * tileSize;
  const right = left + tileSize;
  const bottom = top + tileSize;
  const inset = Math.min(0.5, tileSize * 0.25);
  const samples = [
    [left + tileSize * 0.5, top + tileSize * 0.5],
    [left + tileSize * 0.5, top + inset],
    [right - inset, top + tileSize * 0.5],
    [left + tileSize * 0.5, bottom - inset],
    [left + inset, top + tileSize * 0.5]
  ];

  if (includeCorners) {
    samples.push(
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
      [left + inset, top + inset],
      [right - inset, top + inset],
      [right - inset, bottom - inset],
      [left + inset, bottom - inset]
    );
  }

  for (const [sampleX, sampleY] of samples) {
    const dx = sampleX - startX;
    const dy = sampleY - startY;
    const distance = Math.hypot(dx, dy);
    if (distance <= BUILD_VISIBILITY_EPSILON) {
      return true;
    }

    const hit = raycast(Math.atan2(dy, dx), distance);
    if (!hit?.hit || hit.distance >= distance - BUILD_VISIBILITY_EPSILON) {
      return true;
    }
  }

  return false;
}

function addBuildRingCandidate(ring, tileX, tileY, options) {
  const {
    widthTiles,
    heightTiles,
    minTileX,
    maxTileX,
    minTileY,
    maxTileY,
    tileSize,
    startX,
    startY,
    maxDistance,
    isCandidate,
    isNormallyVisible,
    isCornerVisible
  } = options;

  if (
    tileX < 0 ||
    tileY < 0 ||
    tileX >= widthTiles ||
    tileY >= heightTiles ||
    tileX < minTileX ||
    tileX > maxTileX ||
    tileY < minTileY ||
    tileY > maxTileY ||
    !isCandidate(tileX, tileY)
  ) {
    return;
  }

  const candidate = buildTileCandidate(tileX, tileY, tileSize, startX, startY);
  if (candidate.distance > maxDistance + BUILD_VISIBILITY_EPSILON) {
    return;
  }

  if (!isNormallyVisible(tileX, tileY) && !(isCornerVisible && isCornerVisible(tileX, tileY))) {
    return;
  }

  ring.set(buildTileKey(tileX, tileY), candidate);
}

function angularDistance(a, b) {
  let delta = Math.abs(a - b) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta = Math.PI * 2 - delta;
  }
  return delta;
}

function closestBuildTileFromList(tiles, tileSize, startX, startY, angle) {
  if (
    !Number.isFinite(tileSize) ||
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(angle)
  ) {
    return null;
  }

  let selected = null;
  for (const tile of tiles) {
    if (!Number.isFinite(tile?.tileX) || !Number.isFinite(tile?.tileY)) {
      continue;
    }

    if (!rayIntersectsBuildTile(tile.tileX, tile.tileY, tileSize, startX, startY, angle)) {
      continue;
    }

    const candidate = buildTileCandidate(tile.tileX, tile.tileY, tileSize, startX, startY);
    const angleDelta = angularDistance(angle, candidate.angle);
    if (
      !selected ||
      angleDelta < selected.angleDelta - BUILD_VISIBILITY_EPSILON ||
      (Math.abs(angleDelta - selected.angleDelta) <= BUILD_VISIBILITY_EPSILON &&
        candidate.distance < selected.distance - BUILD_VISIBILITY_EPSILON)
    ) {
      selected = {
        ...candidate,
        angleDelta
      };
    }
  }

  return selected ? { tileX: selected.tileX, tileY: selected.tileY } : null;
}

function rayIntersectsBuildTile(tileX, tileY, tileSize, startX, startY, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (Math.abs(dx) < BUILD_VISIBILITY_EPSILON && Math.abs(dy) < BUILD_VISIBILITY_EPSILON) {
    return false;
  }

  const left = tileX * tileSize;
  const right = left + tileSize;
  const top = tileY * tileSize;
  const bottom = top + tileSize;
  let minT = 0;
  let maxT = Infinity;

  if (Math.abs(dx) < BUILD_VISIBILITY_EPSILON) {
    if (startX < left - BUILD_VISIBILITY_EPSILON || startX > right + BUILD_VISIBILITY_EPSILON) {
      return false;
    }
  } else {
    const tx1 = (left - startX) / dx;
    const tx2 = (right - startX) / dx;
    minT = Math.max(minT, Math.min(tx1, tx2));
    maxT = Math.min(maxT, Math.max(tx1, tx2));
  }

  if (Math.abs(dy) < BUILD_VISIBILITY_EPSILON) {
    if (startY < top - BUILD_VISIBILITY_EPSILON || startY > bottom + BUILD_VISIBILITY_EPSILON) {
      return false;
    }
  } else {
    const ty1 = (top - startY) / dy;
    const ty2 = (bottom - startY) / dy;
    minT = Math.max(minT, Math.min(ty1, ty2));
    maxT = Math.min(maxT, Math.max(ty1, ty2));
  }

  return maxT >= minT - BUILD_VISIBILITY_EPSILON && maxT >= -BUILD_VISIBILITY_EPSILON;
}

function buildTileCandidate(tileX, tileY, tileSize, startX, startY) {
  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  const dx = centerX - startX;
  const dy = centerY - startY;
  return {
    tileX,
    tileY,
    angle: Math.atan2(dy, dx),
    distance: Math.hypot(dx, dy)
  };
}

function buildTileKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}
