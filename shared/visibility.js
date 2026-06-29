import { raycastAsteroid } from "./asteroid.js";
import { ENGINE, GAME_MODES } from "./constants.js";

export function createPlayerVisibilityRegion(source, observer, radius, options = {}) {
  if (!observer) {
    return null;
  }

  const mode = options.mode || source?.mode || observer.gameMode || GAME_MODES.bitspace;
  const regionRadius = Math.max(0, Number(radius || 0));
  const inkSight = mode === GAME_MODES.octopus
    ? octopusInkSightContext(source, observer, regionRadius, { mode })
    : null;
  return {
    source,
    mode,
    observer,
    radius: regionRadius,
    inkSight,
    inkBlobs: inkSight?.blobs || [],
    insideInkComponent: inkSight?.insideComponent || []
  };
}

export function visibilityRegionAllowsSight(region, from, to) {
  return !region?.inkSight || octopusInkAllowsSight(region.inkSight, from, to);
}

export function visibilityRegionLineOfSightClear(region, asteroid, from, to, maxDistance = null, options = {}) {
  if (!from || !to) {
    return false;
  }

  const distance = maxDistance ?? distanceBetween(from, to);
  if (distance <= 0) {
    return visibilityRegionAllowsSight(region, from, to);
  }

  if (asteroid && options.checkAsteroid !== false) {
    const hit = raycastAsteroid(
      asteroid,
      from.x,
      from.y,
      Math.atan2(to.y - from.y, to.x - from.x),
      distance,
      {
        blockNonPlayable: options.blockNonPlayable !== undefined
          ? options.blockNonPlayable
          : !asteroid.storm
      }
    );
    const hitMargin = Math.max(0, Number(options.hitMargin || 0));
    if (hit?.hit && hit.distance < distance - hitMargin) {
      return false;
    }
  }

  return visibilityRegionAllowsSight(region, from, to);
}

export function octopusInkBlobsForVisibility(source, player, radius, options = {}) {
  const mode = options.mode || source?.mode;
  if (!source || !player || mode !== GAME_MODES.octopus) {
    return [];
  }

  const reachRadius = Math.max(0, Number(radius || 0));
  return octopusInkEntities(source).filter((entity) => {
    if (entity?.type !== "octopusInk" || octopusInkAlpha(entity) <= 0) {
      return false;
    }

    const inkRadius = octopusInkMaxRadius(entity);
    const dx = Number(entity.x || 0) - Number(player.x || 0);
    const dy = Number(entity.y || 0) - Number(player.y || 0);
    const reach = reachRadius + inkRadius + 2;
    return dx * dx + dy * dy <= reach * reach;
  });
}

export function octopusInkConnectedComponentContainingPoint(inkBlobs, x, y) {
  if (!Array.isArray(inkBlobs) || inkBlobs.length === 0) {
    return [];
  }

  const polygons = inkBlobs.map((blob) => octopusInkVisualPolygon(blob));
  const pending = [];
  const visited = new Set();
  const point = { x, y };

  for (let index = 0; index < polygons.length; index += 1) {
    if (pointInsidePolygon(point, polygons[index])) {
      pending.push(index);
      visited.add(index);
    }
  }

  for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
    const currentIndex = pending[pendingIndex];
    const currentBlob = inkBlobs[currentIndex];
    const currentPolygon = polygons[currentIndex];
    for (let nextIndex = 0; nextIndex < inkBlobs.length; nextIndex += 1) {
      if (visited.has(nextIndex)) {
        continue;
      }
      if (!octopusInkBlobsOverlap(currentBlob, currentPolygon, inkBlobs[nextIndex], polygons[nextIndex])) {
        continue;
      }

      visited.add(nextIndex);
      pending.push(nextIndex);
    }
  }

  return pending.map((index) => inkBlobs[index]);
}

export function octopusInkSightContext(source, observer, radius, options = {}) {
  const blobs = octopusInkBlobsForVisibility(source, observer, radius, options);
  if (blobs.length === 0) {
    return null;
  }

  return {
    blobs,
    insideComponent: octopusInkConnectedComponentContainingPoint(blobs, observer.x, observer.y)
  };
}

export function octopusInkAllowsSight(context, from, to) {
  if (!context?.blobs?.length || !from || !to) {
    return true;
  }

  if (context.insideComponent?.length > 0) {
    return context.insideComponent.some((blob) => pointInsidePolygon(to, octopusInkVisualPolygon(blob)));
  }

  return !context.blobs.some((blob) => segmentIntersectsPolygon(from, to, octopusInkVisualPolygon(blob)));
}

export function octopusInkPolygon(entity, camera = null) {
  const rawPoints = Array.isArray(entity?.points) && entity.points.length >= 3
    ? entity.points
    : defaultOctopusInkPoints();
  const radius = Math.max(1, Number(entity?.radius || ENGINE.octopus.ink.radius)) * octopusInkRadiusScale(entity);
  const centerX = Number(entity?.x || 0) - Number(camera?.x || 0);
  const centerY = Number(entity?.y || 0) - Number(camera?.y || 0);
  return rawPoints
    .map((point, index) => ({
      angle: Number.isFinite(point?.angle) ? point.angle : (index / rawPoints.length) * Math.PI * 2,
      scale: Math.max(0.05, Number(point?.scale || 1))
    }))
    .sort((a, b) => a.angle - b.angle)
    .map((point) => ({
      x: centerX + Math.cos(point.angle) * radius * point.scale,
      y: centerY + Math.sin(point.angle) * radius * point.scale
    }));
}

export function octopusInkVisualPolygon(entity, camera = null) {
  const points = octopusInkPolygon(entity, camera);
  if (points.length < 4) {
    return points;
  }

  const smoothed = [];
  const subdivisions = 5;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      smoothed.push(catmullRomPoint(previous, current, next, afterNext, t));
    }
  }

  return smoothed;
}

export function octopusInkAlpha(entity) {
  const lifetime = Math.max(0.001, Number(entity?.lifetimeSeconds || ENGINE.octopus.ink.lifetimeSeconds));
  const fadeSeconds = Math.max(0.001, Number(entity?.fadeSeconds || ENGINE.octopus.ink.fadeSeconds));
  const age = clamp(Number(entity?.ageSeconds || 0), 0, lifetime);
  return clamp((lifetime - age) / fadeSeconds, 0, 1);
}

export function octopusInkRadiusScale(entity) {
  const lifetime = Math.max(0.001, Number(entity?.lifetimeSeconds || ENGINE.octopus.ink.lifetimeSeconds));
  const configuredMinScale = entity?.minRadiusScale ?? ENGINE.octopus.ink.minRadiusScale;
  const minScale = clamp(Number(configuredMinScale), 0, 1);
  const age = clamp(Number(entity?.ageSeconds || 0), 0, lifetime);
  const progress = smoothstep01(clamp((age - lifetime * 0.5) / (lifetime * 0.5), 0, 1));
  return lerp(1, minScale, progress);
}

export function octopusInkMaxRadius(entity) {
  const baseRadius = Math.max(1, Number(entity?.radius || ENGINE.octopus.ink.radius));
  const points = Array.isArray(entity?.points) ? entity.points : [];
  const maxPointScale = points.reduce((max, point) => Math.max(max, Number(point?.scale || 1)), 1);
  return baseRadius * octopusInkRadiusScale(entity) * maxPointScale;
}

function octopusInkEntities(source) {
  const entities = source?.entities;
  if (entities instanceof Map) {
    return Array.from(entities.values());
  }
  if (Array.isArray(entities)) {
    return entities;
  }
  return [];
}

function octopusInkBlobsOverlap(firstBlob, firstPolygon, secondBlob, secondPolygon) {
  if (!firstBlob || !secondBlob) {
    return false;
  }

  const firstRadius = octopusInkMaxRadius(firstBlob);
  const secondRadius = octopusInkMaxRadius(secondBlob);
  const dx = Number(firstBlob.x || 0) - Number(secondBlob.x || 0);
  const dy = Number(firstBlob.y || 0) - Number(secondBlob.y || 0);
  const reach = firstRadius + secondRadius;
  if (dx * dx + dy * dy > reach * reach) {
    return false;
  }

  return polygonsOverlap(firstPolygon, secondPolygon);
}

function polygonsOverlap(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length < 3 || second.length < 3) {
    return false;
  }

  if (first.some((point) => pointInsidePolygon(point, second)) ||
    second.some((point) => pointInsidePolygon(point, first))) {
    return true;
  }

  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstA = first[firstIndex];
    const firstB = first[(firstIndex + 1) % first.length];
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondA = second[secondIndex];
      const secondB = second[(secondIndex + 1) % second.length];
      if (segmentsIntersect(firstA, firstB, secondA, secondB)) {
        return true;
      }
    }
  }

  return false;
}

function segmentIntersectsPolygon(from, to, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  if (pointInsidePolygon(from, polygon) || pointInsidePolygon(to, polygon)) {
    return true;
  }

  for (let index = 0; index < polygon.length; index += 1) {
    if (segmentsIntersect(from, to, polygon[index], polygon[(index + 1) % polygon.length])) {
      return true;
    }
  }

  return false;
}

function pointInsidePolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const crosses = (current.y > point.y) !== (previous.y > point.y);
    if (!crosses) {
      continue;
    }

    const xAtY = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (point.x < xAtY) {
      inside = !inside;
    }
  }

  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const adx = d.x - a.x;
  const ady = d.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const cax = a.x - c.x;
  const cay = a.y - c.y;
  const cbx = b.x - c.x;
  const cby = b.y - c.y;
  const cross1 = abx * acy - aby * acx;
  const cross2 = abx * ady - aby * adx;
  const cross3 = cdx * cay - cdy * cax;
  const cross4 = cdx * cby - cdy * cbx;

  if (Math.abs(cross1) < 0.000001 && pointOnSegment(c, a, b)) {
    return true;
  }
  if (Math.abs(cross2) < 0.000001 && pointOnSegment(d, a, b)) {
    return true;
  }
  if (Math.abs(cross3) < 0.000001 && pointOnSegment(a, c, d)) {
    return true;
  }
  if (Math.abs(cross4) < 0.000001 && pointOnSegment(b, c, d)) {
    return true;
  }

  return (cross1 > 0) !== (cross2 > 0) && (cross3 > 0) !== (cross4 > 0);
}

function pointOnSegment(point, a, b) {
  return point.x >= Math.min(a.x, b.x) - 0.000001 &&
    point.x <= Math.max(a.x, b.x) + 0.000001 &&
    point.y >= Math.min(a.y, b.y) - 0.000001 &&
    point.y <= Math.max(a.y, b.y) + 0.000001;
}

function distanceBetween(a, b) {
  return Math.hypot(Number(b.x || 0) - Number(a.x || 0), Number(b.y || 0) - Number(a.y || 0));
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    )
  };
}

function defaultOctopusInkPoints() {
  const count = Math.max(3, Math.floor(Number(ENGINE.octopus.ink.pointCount || 8)));
  return Array.from({ length: count }, (_value, index) => ({
    angle: (index / count) * Math.PI * 2,
    scale: 1
  }));
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
