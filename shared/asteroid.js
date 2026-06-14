import { ENGINE, RENDER } from "./constants.js";
import { createSeededRandom } from "./math.js";

export const ASTEROID_TILE = Object.freeze({
  empty: ".",
  rock: "r",
  ore: "o",
  diamond: "d"
});

export const RESOURCE_TYPE = Object.freeze({
  rock: "ROCK",
  ore: "ORE",
  diamond: "DIAMOND"
});

const DEFAULT_GENERATION = Object.freeze({
  playerBodyRadius: 12,
  playerPocketRadius: 7,
  playerExitRadius: 2,
  playerOrbitRadius: 31,
  fieldRadius: 34,
  bodyCount: 112,
  bodyMinRadius: 3,
  bodyMaxRadius: 9,
  webThickness: 8,
  webBranchCount: 72,
  webBranchMinLength: 8,
  webBranchMaxLength: 24,
  edgeMargin: 14,
  bodyLobesMin: 2,
  bodyLobesMax: 4,
  caveMinRadius: 2,
  caveMaxRadius: 5,
  resourceCandidateChance: 0.5,
  resourceGraphKeepDegradation: 0.985,
  resourceMaxGraphs: 360,
  resourceMaxSpawnTiles: 900,
  oreChance: 0.78,
  diamondChance: 0.035,
  boundaryDilate: 24,
  boundaryShrink: 17,
  boundaryGap: 6,
  boundaryMaxDilate: 42
});

export function createAsteroid(options = {}) {
  const config = {
    ...DEFAULT_GENERATION,
    ...(options.generation || {})
  };
  const seed = options.seed || "bitspace-asteroid";
  const random = createSeededRandom(seed);
  const widthTiles = Math.floor(ENGINE.world.width / RENDER.tileSize);
  const heightTiles = Math.floor(ENGINE.world.height / RENDER.tileSize);
  const tiles = new Array(widthTiles * heightTiles).fill(ASTEROID_TILE.empty);
  const amounts = new Uint8Array(widthTiles * heightTiles);
  const pockets = createPlayerPockets(widthTiles, heightTiles, config);

  stampConnectedAsteroidWeb(tiles, widthTiles, heightTiles, pockets, random, config);

  for (const pocket of pockets) {
    carvePocket(tiles, widthTiles, heightTiles, pocket.tileX, pocket.tileY, pocket.radius);
    carvePocketExits(tiles, widthTiles, heightTiles, pocket, config);
  }

  let playable = createPlayableBoundary(tiles, widthTiles, heightTiles, config);
  connectPlayableSpace(tiles, playable, widthTiles, heightTiles, config);
  playable = createPlayableBoundary(tiles, widthTiles, heightTiles, config);
  connectPlayableSpace(tiles, playable, widthTiles, heightTiles, config);
  playable = createPlayableBoundary(tiles, widthTiles, heightTiles, config);
  seedResourceNodes(tiles, amounts, widthTiles, heightTiles, random, config);

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize: RENDER.tileSize,
    generation: {
      resourceGraphKeepDegradation: config.resourceGraphKeepDegradation,
      resourceMaxGraphs: config.resourceMaxGraphs,
      resourceMaxSpawnTiles: config.resourceMaxSpawnTiles,
      boundaryDilate: config.boundaryDilate,
      boundaryShrink: config.boundaryShrink,
      boundaryGap: config.boundaryGap
    },
    tiles,
    amounts,
    playable,
    pockets
  };
}

export function serializeAsteroid(asteroid) {
  return {
    seed: asteroid.seed,
    widthTiles: asteroid.widthTiles,
    heightTiles: asteroid.heightTiles,
    tileSize: asteroid.tileSize,
    generation: asteroid.generation,
    tiles: asteroid.tiles.join(""),
    amounts: Array.from(asteroid.amounts, (amount) => amount.toString(36)).join(""),
    playable: maskToString(asteroid.playable),
    pockets: asteroid.pockets.map((pocket) => ({
      playerNumber: pocket.playerNumber,
      tileX: pocket.tileX,
      tileY: pocket.tileY,
      radius: pocket.radius,
      spawnX: pocket.spawnX,
      spawnY: pocket.spawnY
    }))
  };
}

export function blockingTilesNearCircle(asteroid, x, y, radius) {
  const minTileX = Math.floor((x - radius) / asteroid.tileSize) - 1;
  const maxTileX = Math.floor((x + radius) / asteroid.tileSize) + 1;
  const minTileY = Math.floor((y - radius) / asteroid.tileSize) - 1;
  const maxTileY = Math.floor((y + radius) / asteroid.tileSize) + 1;
  const tiles = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isBlockingTile(asteroid, tileX, tileY)) {
        tiles.push({
          tileX,
          tileY,
          x: tileX * asteroid.tileSize,
          y: tileY * asteroid.tileSize,
          size: asteroid.tileSize
        });
      }
    }
  }

  return tiles;
}

export function raycastAsteroid(asteroid, startX, startY, angle, maxDistance) {
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const step = 0.5;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const x = startX + direction.x * distance;
    const y = startY + direction.y * distance;
    const tileX = Math.floor(x / asteroid.tileSize);
    const tileY = Math.floor(y / asteroid.tileSize);
    const hit = asteroidCollisionAt(asteroid, tileX, tileY);

    if (hit) {
      return {
        ...hit,
        x,
        y,
        distance
      };
    }
  }

  return {
    hit: false,
    mineable: false,
    x: startX + direction.x * maxDistance,
    y: startY + direction.y * maxDistance,
    distance: maxDistance
  };
}

export function isAsteroidRockTile(tile) {
  return tile === ASTEROID_TILE.rock || tile === ASTEROID_TILE.ore || tile === ASTEROID_TILE.diamond;
}

function asteroidCollisionAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return {
      hit: true,
      mineable: false,
      tileX,
      tileY,
      index: -1,
      tile: ASTEROID_TILE.empty
    };
  }

  const index = tileY * asteroid.widthTiles + tileX;
  const tile = asteroid.tiles[index];

  if (isAsteroidRockTile(tile)) {
    return {
      hit: true,
      mineable: true,
      tileX,
      tileY,
      index,
      tile
    };
  }

  if (!isPlayableCell(asteroid, index)) {
    return {
      hit: true,
      mineable: false,
      tileX,
      tileY,
      index,
      tile
    };
  }

  return null;
}

function isBlockingTile(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return true;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return !isPlayableCell(asteroid, index) || isAsteroidRockTile(asteroid.tiles[index]);
}

function isPlayableCell(asteroid, index) {
  return asteroid.playable[index] === true || asteroid.playable[index] === "1";
}

function createPlayerPockets(widthTiles, heightTiles, config) {
  const centerX = (widthTiles - 1) / 2;
  const centerY = (heightTiles - 1) / 2;
  const players = ENGINE.maxPlayers;
  const centers = Array.from({ length: players }, (_value, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / players;

    return {
      tileX: Math.round(centerX + Math.cos(angle) * config.playerOrbitRadius),
      tileY: Math.round(centerY + Math.sin(angle) * config.playerOrbitRadius)
    };
  });

  return centers.map((center, index) => ({
    playerNumber: index + 1,
    tileX: center.tileX,
    tileY: center.tileY,
    x: center.tileX,
    y: center.tileY,
    radius: config.playerPocketRadius,
    spawnX: (center.tileX + 0.5) * RENDER.tileSize,
    spawnY: (center.tileY + 0.5) * RENDER.tileSize
  }));
}

function stampConnectedAsteroidWeb(tiles, widthTiles, heightTiles, pockets, random, config) {
  const centerX = (widthTiles - 1) / 2;
  const centerY = (heightTiles - 1) / 2;

  for (const pocket of pockets) {
    stampAsteroidPath(
      tiles,
      widthTiles,
      heightTiles,
      pocket.tileX,
      pocket.tileY,
      centerX,
      centerY,
      config.webThickness,
      random,
      config
    );
  }

  for (let index = 0; index < pockets.length; index += 1) {
    const next = pockets[(index + 1) % pockets.length];
    stampAsteroidPath(
      tiles,
      widthTiles,
      heightTiles,
      pockets[index].tileX,
      pockets[index].tileY,
      next.tileX,
      next.tileY,
      Math.max(4, config.webThickness - 2),
      random,
      config
    );
  }

  stampRadialAsteroidBodies(tiles, widthTiles, heightTiles, pockets, random, config);
  stampConnectedBranches(tiles, widthTiles, heightTiles, random, config);
}

function stampAsteroidPath(tiles, widthTiles, heightTiles, fromX, fromY, toX, toY, radius, random, config) {
  const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY));
  const bend = (random() - 0.5) * 18;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  const normal = {
    x: -dy / length,
    y: dx / length
  };

  for (let step = 0; step <= steps; step += 1) {
    const progress = steps === 0 ? 1 : step / steps;
    const curve = Math.sin(progress * Math.PI) * bend;
    const x = Math.round(fromX + dx * progress + normal.x * curve);
    const y = Math.round(fromY + dy * progress + normal.y * curve);
    const pathRadius = Math.max(2, Math.round(radius + Math.sin(progress * Math.PI * 3) * 1.5));
    stampRockDisk(tiles, widthTiles, heightTiles, x, y, pathRadius, config.edgeMargin);

    if (step % 7 === 0 && random() < 0.65) {
      stampAsteroidBody(tiles, widthTiles, heightTiles, x, y, randomInt(random, config.bodyMinRadius, config.bodyMaxRadius), random, config);
    }
  }
}

function stampConnectedBranches(tiles, widthTiles, heightTiles, random, config) {
  for (let index = 0; index < config.webBranchCount; index += 1) {
    const start = randomRockTile(tiles, widthTiles, heightTiles, random);
    if (!start) {
      return;
    }

    const angle = random() * Math.PI * 2;
    const length = randomInt(random, config.webBranchMinLength, config.webBranchMaxLength);
    const end = clampGenerationPoint({
      x: Math.round(start.x + Math.cos(angle) * length),
      y: Math.round(start.y + Math.sin(angle) * length)
    }, widthTiles, heightTiles, config);
    stampAsteroidPath(
      tiles,
      widthTiles,
      heightTiles,
      start.x,
      start.y,
      end.x,
      end.y,
      randomInt(random, 3, Math.max(3, config.webThickness - 2)),
      random,
      config
    );
  }
}

function randomRockTile(tiles, widthTiles, heightTiles, random) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = 1 + Math.floor(random() * (widthTiles - 2));
    const y = 1 + Math.floor(random() * (heightTiles - 2));
    if (isAsteroidRockTile(tiles[y * widthTiles + x])) {
      return { x, y };
    }
  }

  return null;
}

function stampRadialAsteroidBodies(tiles, widthTiles, heightTiles, pockets, random, config) {
  const centerX = (widthTiles - 1) / 2;
  const centerY = (heightTiles - 1) / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < config.bodyCount; index += 1) {
    const progress = (index + 0.5) / config.bodyCount;
    const angle = index * goldenAngle + (random() - 0.5) * 0.45;
    const distance = 5 + Math.sqrt(progress) * (config.fieldRadius - 5) + (random() - 0.5) * 4;
    const radius = randomInt(random, config.bodyMinRadius, config.bodyMaxRadius);
    const center = clampGenerationPoint({
      x: Math.round(centerX + Math.cos(angle) * distance),
      y: Math.round(centerY + Math.sin(angle) * distance)
    }, widthTiles, heightTiles, config);

    if (tooCloseToPocketExit(center, pockets, config)) {
      continue;
    }

    const start =
      nearestRockTile(tiles, widthTiles, heightTiles, center.x, center.y, 18) ||
      nearestRockTile(tiles, widthTiles, heightTiles, center.x, center.y, Math.max(widthTiles, heightTiles));
    if (!start) {
      continue;
    }

    stampAsteroidPath(
      tiles,
      widthTiles,
      heightTiles,
      start.x,
      start.y,
      center.x,
      center.y,
      randomInt(random, 2, 4),
      random,
      config
    );

    stampAsteroidBody(tiles, widthTiles, heightTiles, center.x, center.y, radius, random, config);
    carveBodyCaves(tiles, widthTiles, heightTiles, center, radius, random, config);
  }
}

function nearestRockTile(tiles, widthTiles, heightTiles, targetX, targetY, radius) {
  let best = null;
  let bestDistance = Infinity;

  for (let y = Math.max(0, targetY - radius); y <= Math.min(heightTiles - 1, targetY + radius); y += 1) {
    for (let x = Math.max(0, targetX - radius); x <= Math.min(widthTiles - 1, targetX + radius); x += 1) {
      if (!isAsteroidRockTile(tiles[y * widthTiles + x])) {
        continue;
      }

      const dx = x - targetX;
      const dy = y - targetY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }

  return best;
}

function tooCloseToPocketExit(center, pockets, config) {
  return pockets.some((pocket) => {
    const dx = center.x - pocket.tileX;
    const dy = center.y - pocket.tileY;
    const distance = Math.hypot(dx, dy);
    return distance < config.playerPocketRadius + 3;
  });
}

function stampAsteroidBody(tiles, widthTiles, heightTiles, centerX, centerY, radius, random, config) {
  const lobes = randomInt(random, config.bodyLobesMin, config.bodyLobesMax);

  stampRockDisk(tiles, widthTiles, heightTiles, centerX, centerY, radius, config.edgeMargin);

  for (let index = 0; index < lobes; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * radius * 0.55;
    const lobeRadius = Math.max(3, Math.floor(radius * (0.35 + random() * 0.38)));
    const lobeCenter = clampGenerationPoint(
      {
        x: Math.round(centerX + Math.cos(angle) * distance),
        y: Math.round(centerY + Math.sin(angle) * distance)
      },
      widthTiles,
      heightTiles,
      config
    );
    stampRockDisk(
      tiles,
      widthTiles,
      heightTiles,
      lobeCenter.x,
      lobeCenter.y,
      lobeRadius,
      config.edgeMargin
    );
  }
}

function clampGenerationPoint(point, widthTiles, heightTiles, config) {
  const margin = config.edgeMargin + config.bodyMaxRadius + 1;
  return {
    x: Math.max(margin, Math.min(widthTiles - 1 - margin, point.x)),
    y: Math.max(margin, Math.min(heightTiles - 1 - margin, point.y))
  };
}

function stampRockDisk(tiles, widthTiles, heightTiles, centerX, centerY, radius, edgeMargin = DEFAULT_GENERATION.edgeMargin) {
  const radiusSq = radius * radius;

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (
        x < edgeMargin ||
        y < edgeMargin ||
        x >= widthTiles - edgeMargin ||
        y >= heightTiles - edgeMargin
      ) {
        continue;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSq) {
        tiles[y * widthTiles + x] = ASTEROID_TILE.rock;
      }
    }
  }
}

function carveBodyCaves(tiles, widthTiles, heightTiles, center, radius, random, config) {
  const caveCount = Math.max(1, Math.floor(radius / 5));

  for (let index = 0; index < caveCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * radius * 0.45;
    const caveRadius = randomInt(random, config.caveMinRadius, config.caveMaxRadius);
    carvePocket(
      tiles,
      widthTiles,
      heightTiles,
      Math.round(center.x + Math.cos(angle) * distance),
      Math.round(center.y + Math.sin(angle) * distance),
      caveRadius
    );
  }
}

function carvePocket(tiles, widthTiles, heightTiles, centerX, centerY, radius) {
  const radiusSq = radius * radius;

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= widthTiles || y >= heightTiles) {
        continue;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSq) {
        tiles[y * widthTiles + x] = ASTEROID_TILE.empty;
      }
    }
  }
}

function carveTunnel(tiles, widthTiles, heightTiles, fromX, fromY, toX, toY, radius) {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));

  for (let step = 0; step <= steps; step += 1) {
    const progress = steps === 0 ? 1 : step / steps;
    const x = Math.round(fromX + (toX - fromX) * progress);
    const y = Math.round(fromY + (toY - fromY) * progress);
    carvePocket(tiles, widthTiles, heightTiles, x, y, radius);
  }
}

function carvePocketExits(tiles, widthTiles, heightTiles, pocket, config) {
  const centerX = widthTiles / 2;
  const centerY = heightTiles / 2;
  const dx = centerX - pocket.tileX;
  const dy = centerY - pocket.tileY;
  const length = Math.hypot(dx, dy) || 1;
  const inward = {
    x: dx / length,
    y: dy / length
  };
  const tangent = {
    x: -inward.y,
    y: inward.x
  };
  const distance = config.playerBodyRadius + 6;
  const mouth = {
    x: Math.round(pocket.tileX + inward.x * distance),
    y: Math.round(pocket.tileY + inward.y * distance)
  };

  carveTunnel(tiles, widthTiles, heightTiles, pocket.tileX, pocket.tileY, mouth.x, mouth.y, config.playerExitRadius);
  carveTunnel(
    tiles,
    widthTiles,
    heightTiles,
    mouth.x,
    mouth.y,
    Math.round(mouth.x + tangent.x * 5),
    Math.round(mouth.y + tangent.y * 5),
    config.playerExitRadius
  );
  carveTunnel(
    tiles,
    widthTiles,
    heightTiles,
    mouth.x,
    mouth.y,
    Math.round(mouth.x - tangent.x * 5),
    Math.round(mouth.y - tangent.y * 5),
    config.playerExitRadius
  );
}

function createPlayableBoundary(tiles, widthTiles, heightTiles, config) {
  const asteroidMask = tiles.map((tile) => isAsteroidRockTile(tile));
  const gapMask = dilateMaskPadded(asteroidMask, widthTiles, heightTiles, config.boundaryGap);
  let dilateRadius = config.boundaryDilate;
  let playable = gapMask;

  while (dilateRadius <= config.boundaryMaxDilate) {
    playable = unionMasks(
      gapMask,
      closeMaskPadded(asteroidMask, widthTiles, heightTiles, dilateRadius, config.boundaryShrink)
    );
    playable = connectBoundaryMask(playable, widthTiles, heightTiles, config);

    if (
      containsMask(playable, asteroidMask) &&
      isConnectedPlayable(playable, asteroidMask, widthTiles, heightTiles)
    ) {
      return playable;
    }

    dilateRadius += 3;
  }

  return connectBoundaryMask(unionMasks(gapMask, playable), widthTiles, heightTiles, config);
}

function closeMaskPadded(mask, widthTiles, heightTiles, dilateRadius, erodeRadius) {
  const pad = dilateRadius + erodeRadius + 2;
  const padded = copyMaskToPadded(mask, widthTiles, heightTiles, pad);
  const paddedWidth = widthTiles + pad * 2;
  const paddedHeight = heightTiles + pad * 2;
  const dilated = dilateMask(padded, paddedWidth, paddedHeight, dilateRadius);
  const eroded = erodeMask(dilated, paddedWidth, paddedHeight, erodeRadius);
  return cropPaddedMask(eroded, widthTiles, heightTiles, pad);
}

function dilateMaskPadded(mask, widthTiles, heightTiles, radius) {
  const pad = radius + 2;
  const padded = copyMaskToPadded(mask, widthTiles, heightTiles, pad);
  const paddedWidth = widthTiles + pad * 2;
  const paddedHeight = heightTiles + pad * 2;
  const dilated = dilateMask(padded, paddedWidth, paddedHeight, radius);
  return cropPaddedMask(dilated, widthTiles, heightTiles, pad);
}

function copyMaskToPadded(mask, widthTiles, heightTiles, pad) {
  const paddedWidth = widthTiles + pad * 2;
  const padded = new Array(paddedWidth * (heightTiles + pad * 2)).fill(false);

  for (let y = 0; y < heightTiles; y += 1) {
    for (let x = 0; x < widthTiles; x += 1) {
      padded[(y + pad) * paddedWidth + x + pad] = mask[y * widthTiles + x];
    }
  }

  return padded;
}

function cropPaddedMask(mask, widthTiles, heightTiles, pad) {
  const paddedWidth = widthTiles + pad * 2;
  const cropped = new Array(widthTiles * heightTiles).fill(false);

  for (let y = 0; y < heightTiles; y += 1) {
    for (let x = 0; x < widthTiles; x += 1) {
      cropped[y * widthTiles + x] = mask[(y + pad) * paddedWidth + x + pad];
    }
  }

  return cropped;
}

function unionMasks(a, b) {
  return a.map((cell, index) => cell || b[index]);
}

function containsMask(container, contained) {
  return contained.every((cell, index) => !cell || container[index]);
}

function connectBoundaryMask(mask, widthTiles, heightTiles, config) {
  const connected = mask.slice();
  let components = maskComponents(connected, widthTiles, heightTiles);
  let guard = 0;

  while (components.length > 1 && guard < 64) {
    const base = components[0];
    const nearest = nearestComponent(base, components.slice(1));
    stampMaskTunnel(
      connected,
      widthTiles,
      heightTiles,
      base.seed.x,
      base.seed.y,
      nearest.seed.x,
      nearest.seed.y,
      Math.max(2, config.boundaryGap)
    );
    components = maskComponents(connected, widthTiles, heightTiles);
    guard += 1;
  }

  return connected;
}

function maskComponents(mask, widthTiles, heightTiles) {
  const visited = new Set();
  const components = [];

  for (let index = 0; index < mask.length; index += 1) {
    if (visited.has(index) || !mask[index]) {
      continue;
    }

    const component = floodMask(index, mask, visited, widthTiles, heightTiles);
    components.push(component);
  }

  return components.sort((a, b) => b.size - a.size);
}

function floodMask(startIndex, mask, visited, widthTiles, heightTiles) {
  const queue = [startIndex];
  const seed = {
    x: startIndex % widthTiles,
    y: Math.floor(startIndex / widthTiles)
  };
  let size = 0;
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    size += 1;

    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighbor) || !mask[neighbor]) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return { seed, size };
}

function stampMaskTunnel(mask, widthTiles, heightTiles, fromX, fromY, toX, toY, radius) {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));

  for (let step = 0; step <= steps; step += 1) {
    const progress = steps === 0 ? 1 : step / steps;
    const x = Math.round(fromX + (toX - fromX) * progress);
    const y = Math.round(fromY + (toY - fromY) * progress);
    stampMaskDisk(mask, widthTiles, heightTiles, x, y, radius);
  }
}

function stampMaskDisk(mask, widthTiles, heightTiles, centerX, centerY, radius) {
  const radiusSq = radius * radius;

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= widthTiles || y >= heightTiles) {
        continue;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSq) {
        mask[y * widthTiles + x] = true;
      }
    }
  }
}

function dilateMask(mask, widthTiles, heightTiles, radius) {
  const output = new Array(mask.length).fill(false);
  const radiusSq = radius * radius;

  for (let y = 0; y < heightTiles; y += 1) {
    for (let x = 0; x < widthTiles; x += 1) {
      if (!mask[y * widthTiles + x]) {
        continue;
      }

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radiusSq) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX >= 0 && nextY >= 0 && nextX < widthTiles && nextY < heightTiles) {
            output[nextY * widthTiles + nextX] = true;
          }
        }
      }
    }
  }

  return output;
}

function erodeMask(mask, widthTiles, heightTiles, radius) {
  const output = new Array(mask.length).fill(false);
  const radiusSq = radius * radius;

  for (let y = 0; y < heightTiles; y += 1) {
    for (let x = 0; x < widthTiles; x += 1) {
      if (!mask[y * widthTiles + x]) {
        continue;
      }

      let keep = true;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radiusSq) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= widthTiles || nextY >= heightTiles || !mask[nextY * widthTiles + nextX]) {
            keep = false;
            break;
          }
        }
      }

      output[y * widthTiles + x] = keep;
    }
  }

  return output;
}

function connectPlayableSpace(tiles, playable, widthTiles, heightTiles, config) {
  let components = passableComponents(tiles, playable, widthTiles, heightTiles);
  let guard = 0;

  while (components.length > 1 && guard < 64) {
    const base = components[0];
    const nearest = nearestComponent(base, components.slice(1));
    carveTunnel(tiles, widthTiles, heightTiles, base.seed.x, base.seed.y, nearest.seed.x, nearest.seed.y, config.playerExitRadius);
    components = passableComponents(tiles, playable, widthTiles, heightTiles);
    guard += 1;
  }
}

function passableComponents(tiles, playable, widthTiles, heightTiles) {
  const visited = new Set();
  const components = [];

  for (let index = 0; index < tiles.length; index += 1) {
    if (visited.has(index) || !playable[index] || isAsteroidRockTile(tiles[index])) {
      continue;
    }

    const component = floodPassable(index, tiles, playable, visited, widthTiles, heightTiles);
    components.push(component);
  }

  return components.sort((a, b) => b.size - a.size);
}

function floodPassable(startIndex, tiles, playable, visited, widthTiles, heightTiles) {
  const queue = [startIndex];
  const seed = {
    x: startIndex % widthTiles,
    y: Math.floor(startIndex / widthTiles)
  };
  let size = 0;
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    size += 1;

    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighbor) || !playable[neighbor] || isAsteroidRockTile(tiles[neighbor])) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return { seed, size };
}

function nearestComponent(base, components) {
  let nearest = components[0];
  let nearestDistance = Infinity;

  for (const component of components) {
    const dx = component.seed.x - base.seed.x;
    const dy = component.seed.y - base.seed.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = component;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function isConnectedPlayable(playable, asteroidMask, widthTiles, heightTiles) {
  const passable = playable.map((cell, index) => cell && !asteroidMask[index]);
  const start = passable.findIndex(Boolean);
  if (start === -1) {
    return false;
  }

  const visited = new Set([start]);
  const queue = [start];

  while (queue.length > 0) {
    const index = queue.shift();
    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (!passable[neighbor] || visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return passable.every((cell, index) => !cell || visited.has(index));
}

function seedResourceNodes(tiles, amounts, widthTiles, heightTiles, random, config) {
  const candidates = new Map();

  for (let y = 1; y < heightTiles - 1; y += 1) {
    for (let x = 1; x < widthTiles - 1; x += 1) {
      const index = y * widthTiles + x;
      if (tiles[index] !== ASTEROID_TILE.rock || !touchesEmpty(tiles, widthTiles, heightTiles, x, y)) {
        continue;
      }

      if (random() > config.resourceCandidateChance) {
        continue;
      }

      const roll = random();
      const resource =
        roll < config.diamondChance
          ? RESOURCE_TYPE.diamond
          : roll < config.diamondChance + config.oreChance
            ? RESOURCE_TYPE.ore
            : RESOURCE_TYPE.rock;

      candidates.set(index, {
        index,
        x,
        y,
        resource,
        amount: resource === RESOURCE_TYPE.ore ? 1 + Math.floor(random() * 3) : 1
      });
    }
  }

  const visited = new Set();
  const keptGraphs = [];

  for (const candidate of candidates.values()) {
    if (visited.has(candidate.index)) {
      continue;
    }

    const component = collectCandidateComponent(candidate, candidates, visited, widthTiles, heightTiles);
    const graphAmount = component.reduce((total, node) => total + resourceGraphAmount(node), 0);
    const keepProbability = Math.pow(config.resourceGraphKeepDegradation, Math.max(0, graphAmount - 1));
    if (random() > keepProbability) {
      continue;
    }

    keptGraphs.push({
      nodes: component,
      graphAmount,
      spawnCount: component.filter((node) => node.resource !== RESOURCE_TYPE.rock).length,
      order: random()
    });
  }

  keptGraphs.sort((a, b) => a.order - b.order);

  let spawnedGraphs = 0;
  let spawnedTiles = 0;
  for (const graph of keptGraphs) {
    if (spawnedGraphs >= config.resourceMaxGraphs || spawnedTiles >= config.resourceMaxSpawnTiles) {
      break;
    }

    if (graph.spawnCount === 0 || spawnedTiles + graph.spawnCount > config.resourceMaxSpawnTiles) {
      continue;
    }

    for (const node of graph.nodes) {
      if (node.resource === RESOURCE_TYPE.ore) {
        tiles[node.index] = ASTEROID_TILE.ore;
        amounts[node.index] = node.amount;
      } else if (node.resource === RESOURCE_TYPE.diamond) {
        tiles[node.index] = ASTEROID_TILE.diamond;
        amounts[node.index] = 1;
      }
    }

    spawnedGraphs += 1;
    spawnedTiles += graph.spawnCount;
  }
}

function resourceGraphAmount(node) {
  if (node.resource === RESOURCE_TYPE.diamond) {
    return 4;
  }

  return node.amount;
}

function collectCandidateComponent(start, candidates, visited, widthTiles, heightTiles) {
  const queue = [start];
  const component = [];
  visited.add(start.index);

  while (queue.length > 0) {
    const node = queue.shift();
    component.push(node);

    for (const neighborIndex of neighborIndexes(node.index, widthTiles, heightTiles)) {
      const neighbor = candidates.get(neighborIndex);
      if (!neighbor || visited.has(neighborIndex)) {
        continue;
      }

      visited.add(neighborIndex);
      queue.push(neighbor);
    }
  }

  return component;
}

function touchesEmpty(tiles, widthTiles, heightTiles, x, y) {
  return neighborIndexes(y * widthTiles + x, widthTiles, heightTiles).some(
    (index) => tiles[index] === ASTEROID_TILE.empty
  );
}

function neighborIndexes(index, widthTiles, heightTiles) {
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

function maskToString(mask) {
  return mask.map((cell) => (cell ? "1" : "0")).join("");
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}
