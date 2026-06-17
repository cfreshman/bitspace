import { ENGINE, RENDER } from "./constants.js";

export const BUILD_DIRECTION_STEPS = 360;

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
    traveled <= maxDistance + tileSize &&
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
