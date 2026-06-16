import { ENGINE, RENDER } from "./constants.js";
import {
  createSeededRandom,
  createSimplexNoise3D
} from "./math.js";

export const ASTEROID_TILE = Object.freeze({
  empty: ".",
  rock: "r",
  ore: "o",
  diamond: "d",
  wall: "w"
});

export const RESOURCE_TYPE = Object.freeze({
  rock: "ROCK",
  ore: "ORE",
  diamond: "DIAMOND"
});

export const STORM_STATE = Object.freeze({
  safe: 0,
  warning: 1,
  storm: 2
});

const DEFAULT_GENERATION = Object.freeze({
  playerPocketRadius: 3,
  playerOrbitRadius: 56,
  playerSpawnSeparation: 28,
  noiseScale: 0.044,
  noiseDetailScale: 0.12,
  noiseWarpScale: 0.025,
  noiseWarpStrength: 10,
  noiseCaveScale: 0.04,
  noiseCaveSecondaryScale: 0.056,
  noiseCaveDetailScale: 0.13,
  noiseCaveBand: 0.078,
  noiseCaveJunctionBand: 0.048,
  noiseCaveWidthJitter: 0.028,
  noiseCaveMinDepth: 0.14,
  tunnelNodeCount: 72,
  tunnelExtraConnectionCount: 4,
  tunnelMaxNodeDegree: 3,
  tunnelCenterMaxDegree: 3,
  tunnelMinNodeDistance: 5.4,
  tunnelMaxConnectionLength: 22,
  tunnelCenterRadius: 2.7,
  tunnelRadius: 0.95,
  tunnelEndRadius: 0.58,
  tunnelMaxRadius: 0.78,
  tunnelFeather: 0.58,
  tunnelDensityStrength: 1.65,
  tunnelRadiusJitter: 0.12,
  tunnelNoiseScale: 0.18,
  tunnelCurveStrength: 3.2,
  tunnelMinRockComponentSize: 3,
  noiseOctaves: 5,
  noisePersistence: 0.54,
  noiseLacunarity: 2.05,
  noiseFieldRadius: 88,
  noiseThreshold: 0.04,
  noiseRadialFalloff: 0.9,
  noiseMinComponentSize: 18,
  caveCloseMaxSize: 80,
  caveCloseProbabilityPower: 1.35,
  edgeMargin: 30,
  resourceCandidateChance: 0.95,
  resourceNoiseScale: 0.24,
  resourceNoiseDetailScale: 0.56,
  resourceNoiseDetailWeight: 0.55,
  resourceNoiseMultiplier: 1.62,
  resourceNoiseThreshold: 0.9,
  resourceNoiseFeather: 0.075,
  resourceNoiseJitter: 0.1,
  resourceConnectionChance: 0.55,
  resourceConnectionMaxDistance: 6,
  resourceGraphKeepDegradation: 0.92,
  resourceGraphMinKeepChance: 0.04,
  resourceSmallOreCullMaxSize: 3,
  resourceSmallOreKeepDegradation: 0.55,
  resourcePlayerBaseline: 2,
  resourcePlayerScaleExponent: 0.72,
  resourcePlayerMaxScale: 3,
  resourcePlayerThresholdDrop: 0.025,
  resourcePlayerDiamondBoost: 0.35,
  resourcePlayerOreBoost: 0.045,
  resourcePlayerNoiseScaleBoost: 0.16,
  resourceMaxGraphs: 360,
  resourceMaxSpawnTiles: 940,
  oreChance: 0.8,
  diamondChance: 0.035,
  oreAmountNoiseScale: 0.09,
  oreAmountNoiseDetailScale: 0.23,
  oreAmountNoiseMultiplier: 1.7,
  oreAmountTwoThreshold: 0.48,
  oreAmountThreeThreshold: 0.62,
  boundaryDilate: 28,
  boundaryShrink: 20,
  boundaryGap: 7
});

export function createAsteroid(options = {}) {
  return createNaturalAsteroid({
    ...options,
    seed: options.seed || "bitspace-asteroid"
  });
}

export function createNaturalAsteroid(options = {}) {
  const config = applyPlayerResourceScaling({
    ...DEFAULT_GENERATION,
    ...(options.generation || {})
  }, options.playerCount);
  const seed = options.seed || "bitspace-natural";
  const random = createSeededRandom(seed);
  const widthTiles = options.widthTiles || Math.floor(ENGINE.world.width / RENDER.tileSize);
  const heightTiles = options.heightTiles || Math.floor(ENGINE.world.height / RENDER.tileSize);
  const tiles = new Array(widthTiles * heightTiles).fill(ASTEROID_TILE.empty);
  const amounts = new Uint8Array(widthTiles * heightTiles);

  generateSimplexAsteroidField(tiles, widthTiles, heightTiles, random, config, seed);
  clearAsteroidCircles(tiles, amounts, widthTiles, heightTiles, RENDER.tileSize, options.clearCircles || []);

  const playable = createPlayableBoundary(tiles, widthTiles, heightTiles, config);
  markPlayableCircles(playable, widthTiles, heightTiles, RENDER.tileSize, options.playableCircles || options.clearCircles || []);
  const pockets = options.createPockets === false
    ? []
    : createPlayerPockets(tiles, playable, widthTiles, heightTiles, config);

  if (options.seedResources !== false) {
    seedResourceNodes(tiles, amounts, widthTiles, heightTiles, random, config, seed);
  }

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize: RENDER.tileSize,
    generation: {
      resourceGraphKeepDegradation: config.resourceGraphKeepDegradation,
      resourceGraphMinKeepChance: config.resourceGraphMinKeepChance,
      resourceConnectionChance: config.resourceConnectionChance,
      resourceConnectionMaxDistance: config.resourceConnectionMaxDistance,
      resourceMaxGraphs: config.resourceMaxGraphs,
      resourceMaxSpawnTiles: config.resourceMaxSpawnTiles,
      resourceNoiseMultiplier: config.resourceNoiseMultiplier,
      resourceNoiseThreshold: config.resourceNoiseThreshold,
      resourceSmallOreCullMaxSize: config.resourceSmallOreCullMaxSize,
      resourceSmallOreKeepDegradation: config.resourceSmallOreKeepDegradation,
      resourcePlayerCount: config.resourcePlayerCount,
      resourcePlayerScale: config.resourcePlayerScale,
      oreAmountNoiseMultiplier: config.oreAmountNoiseMultiplier,
      oreAmountThreeThreshold: config.oreAmountThreeThreshold,
      noiseScale: config.noiseScale,
      noiseFieldRadius: config.noiseFieldRadius,
      noiseThreshold: config.noiseThreshold,
      noiseCaveBand: config.noiseCaveBand,
      tunnelNodeCount: config.tunnelNodeCount,
      tunnelExtraConnectionCount: config.tunnelExtraConnectionCount,
      tunnelMaxNodeDegree: config.tunnelMaxNodeDegree,
      tunnelCenterRadius: config.tunnelCenterRadius,
      tunnelRadius: config.tunnelRadius,
      tunnelMaxRadius: config.tunnelMaxRadius,
      tunnelMinRockComponentSize: config.tunnelMinRockComponentSize,
      caveCloseMaxSize: config.caveCloseMaxSize,
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

function applyPlayerResourceScaling(config, playerCount) {
  const rawPlayerCount = Number(playerCount);
  if (!Number.isFinite(rawPlayerCount) || rawPlayerCount <= 0) {
    return {
      ...config,
      resourcePlayerCount: null,
      resourcePlayerScale: 1
    };
  }

  const players = Math.max(1, Math.min(ENGINE.maxPlayers, Math.round(rawPlayerCount)));
  const playerRatio = Math.max(1, players / Math.max(1, config.resourcePlayerBaseline));
  const scale = Math.min(
    config.resourcePlayerMaxScale,
    Math.pow(playerRatio, config.resourcePlayerScaleExponent)
  );
  const noiseScale = 1 + (scale - 1) * config.resourcePlayerNoiseScaleBoost;

  return {
    ...config,
    resourcePlayerCount: players,
    resourcePlayerScale: scale,
    resourceMaxGraphs: Math.round(config.resourceMaxGraphs * scale),
    resourceMaxSpawnTiles: Math.round(config.resourceMaxSpawnTiles * scale),
    resourceNoiseThreshold: Math.max(
      0,
      config.resourceNoiseThreshold - (scale - 1) * config.resourcePlayerThresholdDrop
    ),
    resourceNoiseScale: config.resourceNoiseScale * noiseScale,
    resourceNoiseDetailScale: config.resourceNoiseDetailScale * noiseScale,
    diamondChance: Math.min(
      0.12,
      config.diamondChance * (1 + (scale - 1) * config.resourcePlayerDiamondBoost)
    ),
    oreChance: Math.min(
      0.94,
      config.oreChance + (scale - 1) * config.resourcePlayerOreBoost
    )
  };
}

function clearAsteroidCircles(tiles, amounts, widthTiles, heightTiles, tileSize, circles) {
  for (const circle of circles) {
    const centerX = Number(circle.x);
    const centerY = Number(circle.y);
    const radius = Number(circle.radius);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius <= 0) {
      continue;
    }

    const radiusSq = radius * radius;
    for (let tileY = 0; tileY < heightTiles; tileY += 1) {
      for (let tileX = 0; tileX < widthTiles; tileX += 1) {
        const x = (tileX + 0.5) * tileSize;
        const y = (tileY + 0.5) * tileSize;
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > radiusSq) {
          continue;
        }

        const index = tileY * widthTiles + tileX;
        tiles[index] = ASTEROID_TILE.empty;
        amounts[index] = 0;
      }
    }
  }
}

function markPlayableCircles(playable, widthTiles, heightTiles, tileSize, circles) {
  for (const circle of circles) {
    const centerX = Number(circle.x);
    const centerY = Number(circle.y);
    const radius = Number(circle.radius);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius) || radius <= 0) {
      continue;
    }

    const radiusSq = radius * radius;
    for (let tileY = 0; tileY < heightTiles; tileY += 1) {
      for (let tileX = 0; tileX < widthTiles; tileX += 1) {
        const x = (tileX + 0.5) * tileSize;
        const y = (tileY + 0.5) * tileSize;
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radiusSq) {
          playable[tileY * widthTiles + tileX] = true;
        }
      }
    }
  }
}

export function createLobbyAsteroid(options = {}) {
  const seed = options.seed || "bitspace-lobby";
  const widthTiles = options.widthTiles || 48;
  const heightTiles = options.heightTiles || 48;
  const tiles = new Array(widthTiles * heightTiles).fill(ASTEROID_TILE.empty);
  const amounts = new Uint8Array(widthTiles * heightTiles);
  const playable = new Array(widthTiles * heightTiles).fill(false);
  const margin = options.marginTiles || 4;
  const minTileX = margin;
  const minTileY = margin;
  const maxTileX = widthTiles - margin - 1;
  const maxTileY = heightTiles - margin - 1;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      playable[tileY * widthTiles + tileX] = true;
    }
  }

  const centerX = ((minTileX + maxTileX + 1) / 2) * RENDER.tileSize;
  const centerY = ((minTileY + maxTileY + 1) / 2) * RENDER.tileSize;
  const orbitRadius = options.spawnRadius || 92;
  const pockets = Array.from({ length: ENGINE.maxPlayers }, (_unused, index) => {
    const angle = Math.PI / 4 + (index * Math.PI * 2) / ENGINE.maxPlayers;
    return {
      playerNumber: index + 1,
      tileX: Math.round(centerX / RENDER.tileSize),
      tileY: Math.round(centerY / RENDER.tileSize),
      radius: 0,
      spawnX: centerX + Math.cos(angle) * orbitRadius,
      spawnY: centerY + Math.sin(angle) * orbitRadius
    };
  });

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize: RENDER.tileSize,
    generation: {
      mode: "lobby"
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

export function blockingTilesNearCircle(asteroid, x, y, radius, options = {}) {
  const minTileX = Math.floor((x - radius) / asteroid.tileSize) - 1;
  const maxTileX = Math.floor((x + radius) / asteroid.tileSize) + 1;
  const minTileY = Math.floor((y - radius) / asteroid.tileSize) - 1;
  const maxTileY = Math.floor((y + radius) / asteroid.tileSize) + 1;
  const tiles = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isBlockingTile(asteroid, tileX, tileY, options)) {
        tiles.push(blockingTileDescriptor(asteroid, tileX, tileY));
      }
    }
  }

  return tiles;
}

export function blockingTilesAlongSegment(asteroid, startX, startY, endX, endY, radius, options = {}) {
  const minTileX = Math.floor((Math.min(startX, endX) - radius) / asteroid.tileSize) - 1;
  const maxTileX = Math.floor((Math.max(startX, endX) + radius) / asteroid.tileSize) + 1;
  const minTileY = Math.floor((Math.min(startY, endY) - radius) / asteroid.tileSize) - 1;
  const maxTileY = Math.floor((Math.max(startY, endY) + radius) / asteroid.tileSize) + 1;
  const tiles = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isBlockingTile(asteroid, tileX, tileY, options)) {
        tiles.push(blockingTileDescriptor(asteroid, tileX, tileY));
      }
    }
  }

  return tiles;
}

export function raycastAsteroid(asteroid, startX, startY, angle, maxDistance, options = {}) {
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
    const hit = asteroidCollisionAt(asteroid, tileX, tileY, options);

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
  return tile === ASTEROID_TILE.rock ||
    tile === ASTEROID_TILE.ore ||
    tile === ASTEROID_TILE.diamond ||
    tile === ASTEROID_TILE.wall;
}

function asteroidCollisionAt(asteroid, tileX, tileY, options = {}) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return options.blockNonPlayable === false
      ? null
      : {
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

  if (options.blockNonPlayable !== false && !isPlayableCell(asteroid, index)) {
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

function isBlockingTile(asteroid, tileX, tileY, options = {}) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return options.blockNonPlayable !== false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return isAsteroidRockTile(asteroid.tiles[index]) ||
    (options.blockNonPlayable !== false && !isPlayableCell(asteroid, index));
}

function blockingTileDescriptor(asteroid, tileX, tileY) {
  const inBounds = tileX >= 0 && tileY >= 0 && tileX < asteroid.widthTiles && tileY < asteroid.heightTiles;
  const index = inBounds ? tileY * asteroid.widthTiles + tileX : null;
  return {
    tileX,
    tileY,
    index,
    key: `${tileX}:${tileY}`,
    x: tileX * asteroid.tileSize,
    y: tileY * asteroid.tileSize,
    size: asteroid.tileSize
  };
}

function isPlayableCell(asteroid, index) {
  return asteroid.playable[index] === true || asteroid.playable[index] === "1";
}

function createPlayerPockets(tiles, playable, widthTiles, heightTiles, config) {
  const centerX = (widthTiles - 1) / 2;
  const centerY = (heightTiles - 1) / 2;
  const players = ENGINE.maxPlayers;
  const mainComponent = passableComponents(tiles, playable, widthTiles, heightTiles)[0];
  const passableIndexes = mainComponent?.indexes ?? [];
  const selected = [];

  if (passableIndexes.length === 0) {
    return [];
  }

  for (let index = 0; index < players; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / players;
    const target = {
      x: centerX + Math.cos(angle) * config.playerOrbitRadius,
      y: centerY + Math.sin(angle) * config.playerOrbitRadius
    };
    const spawn = nearestSpawnTile(
      passableIndexes,
      selected,
      target,
      tiles,
      playable,
      widthTiles,
      heightTiles,
      config
    );

    selected.push({
      playerNumber: index + 1,
      tileX: spawn.x,
      tileY: spawn.y,
      x: spawn.x,
      y: spawn.y,
      radius: spawn.clearance,
      spawnX: (spawn.x + 0.5) * RENDER.tileSize,
      spawnY: (spawn.y + 0.5) * RENDER.tileSize
    });
  }

  return selected;
}

function nearestSpawnTile(passableIndexes, selected, target, tiles, playable, widthTiles, heightTiles, config) {
  for (let clearance = config.playerPocketRadius; clearance >= 1; clearance -= 1) {
    let best = null;
    let bestScore = Infinity;

    for (const index of passableIndexes) {
      const x = index % widthTiles;
      const y = Math.floor(index / widthTiles);
      if (!hasSpawnClearance(tiles, playable, widthTiles, heightTiles, x, y, clearance)) {
        continue;
      }

      const distanceToTarget = tileDistanceSq(x, y, target.x, target.y);
      let separationPenalty = 0;
      for (const spawn of selected) {
        const distanceToSpawn = tileDistanceSq(x, y, spawn.tileX, spawn.tileY);
        const minDistanceSq = config.playerSpawnSeparation * config.playerSpawnSeparation;
        if (distanceToSpawn < minDistanceSq) {
          separationPenalty += (minDistanceSq - distanceToSpawn) * 8;
        }
      }

      const score = distanceToTarget + separationPenalty;
      if (score < bestScore) {
        best = { x, y, clearance };
        bestScore = score;
      }
    }

    if (best) {
      return best;
    }
  }

  const fallbackIndex = passableIndexes[0];
  return {
    x: fallbackIndex % widthTiles,
    y: Math.floor(fallbackIndex / widthTiles),
    clearance: 1
  };
}

function hasSpawnClearance(tiles, playable, widthTiles, heightTiles, centerX, centerY, radius) {
  const radiusSq = radius * radius;

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || y < 0 || x >= widthTiles || y >= heightTiles) {
        return false;
      }

      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }

      const index = y * widthTiles + x;
      if (!playable[index] || isAsteroidRockTile(tiles[index])) {
        return false;
      }
    }
  }

  return true;
}

function tileDistanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function generateSimplexAsteroidField(tiles, widthTiles, heightTiles, random, config, seed) {
  const bodyNoise = createSimplexNoise3D(`${seed}:body`);
  const caveNoise = createSimplexNoise3D(`${seed}:caves`);
  const warpNoise = createSimplexNoise3D(`${seed}:warp`);
  const mask = new Array(tiles.length).fill(false);
  const centerX = (widthTiles - 1) / 2;
  const centerY = (heightTiles - 1) / 2;
  const z = random() * 1024;
  const tunnelNetwork = createTunnelNetwork(widthTiles, heightTiles, config, seed);

  for (let y = config.edgeMargin; y < heightTiles - config.edgeMargin; y += 1) {
    for (let x = config.edgeMargin; x < widthTiles - config.edgeMargin; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const radial = Math.hypot(dx, dy) / config.noiseFieldRadius;
      if (radial > 1.05) {
        continue;
      }

      const warpX = warpNoise(
        dx * config.noiseWarpScale,
        dy * config.noiseWarpScale,
        z + 19.73
      ) * config.noiseWarpStrength;
      const warpY = warpNoise(
        dx * config.noiseWarpScale,
        dy * config.noiseWarpScale,
        z + 83.11
      ) * config.noiseWarpStrength;
      const sampleX = dx + warpX;
      const sampleY = dy + warpY;
      const body = fractalSimplex3D(
        bodyNoise,
        sampleX * config.noiseScale,
        sampleY * config.noiseScale,
        z * 0.07,
        config
      );
      const detail = fractalSimplex3D(
        bodyNoise,
        sampleX * config.noiseDetailScale,
        sampleY * config.noiseDetailScale,
        z * 0.11 + 173.31,
        config
      );
      const density =
        body * 0.68 +
        detail * 0.24 +
        (1 - radial) * 0.72 -
        Math.max(0, radial - 0.42) * config.noiseRadialFalloff;
      const tunnelCut = tunnelDensityCut(tunnelNetwork, x, y, sampleX, sampleY, caveNoise, z, config);
      const index = y * widthTiles + x;

      if (density - tunnelCut <= config.noiseThreshold) {
        continue;
      }

      const caveDepth = smoothstep(
        config.noiseThreshold + config.noiseCaveMinDepth,
        config.noiseThreshold + config.noiseCaveMinDepth + 0.24,
        density
      );
      const caveRadial = smoothstep(0.08, 0.32, radial) * (1 - smoothstep(0.88, 1.04, radial));
      const primaryContour = Math.abs(fractalSimplex3D(
        caveNoise,
        (sampleX - warpY * 0.45) * config.noiseCaveScale,
        (sampleY + warpX * 0.45) * config.noiseCaveScale,
        z * 0.13 + 41.7,
        config
      ));
      const secondaryContour = Math.abs(fractalSimplex3D(
        caveNoise,
        (sampleX + warpY * 0.35) * config.noiseCaveSecondaryScale,
        (sampleY - warpX * 0.35) * config.noiseCaveSecondaryScale,
        z * 0.19 + 113.6,
        config
      ));
      const widthNoise = (caveNoise(
        (sampleX + warpX * 0.3) * config.noiseCaveDetailScale,
        (sampleY + warpY * 0.3) * config.noiseCaveDetailScale,
        z * 0.17 + 207.4
      ) + 1) * 0.5;
      const contourDistance = Math.min(primaryContour, secondaryContour + config.noiseCaveJunctionBand * 0.5);
      const caveBand =
        (config.noiseCaveBand + widthNoise * config.noiseCaveWidthJitter) *
        (0.28 + caveDepth * 0.72);

      if (caveDepth > 0.5 && caveRadial > 0.15 && contourDistance < caveBand * caveRadial) {
        continue;
      }

      mask[index] = true;
    }
  }

  const manipulated = pruneSmallRockMaskComponents(
    mask,
    widthTiles,
    heightTiles,
    config.noiseMinComponentSize
  );
  closeSmallCaves(manipulated, widthTiles, heightTiles, random, config);
  const cleaned = pruneSmallRockMaskComponents(
    manipulated,
    widthTiles,
    heightTiles,
    config.tunnelMinRockComponentSize
  );

  for (let index = 0; index < tiles.length; index += 1) {
    if (cleaned[index]) {
      tiles[index] = ASTEROID_TILE.rock;
    }
  }
}

function createTunnelNetwork(widthTiles, heightTiles, config, seed) {
  const nodeCount = Math.max(0, Math.round(config.tunnelNodeCount || 0));
  const center = {
    x: (widthTiles - 1) / 2,
    y: (heightTiles - 1) / 2,
    radius: config.tunnelCenterRadius
  };
  const network = {
    centerX: center.x,
    centerY: center.y,
    nodes: [],
    segments: []
  };

  if (nodeCount === 0) {
    return network;
  }

  network.nodes.push(center);
  const tunnelRandom = createSeededRandom(`${seed}:tunnel-network`);
  const maxRadius = config.noiseFieldRadius * config.tunnelMaxRadius;

  scatterTunnelNodes(network, nodeCount, maxRadius, widthTiles, heightTiles, config, tunnelRandom);
  connectTunnelNodeGraph(network, maxRadius, config, tunnelRandom);

  return network;
}

function scatterTunnelNodes(network, nodeCount, maxRadius, widthTiles, heightTiles, config, random) {
  const maxAttempts = nodeCount * 48;
  let attempts = 0;

  while (network.nodes.length < nodeCount && attempts < maxAttempts) {
    attempts += 1;
    const angle = random() * Math.PI * 2;
    const radial = maxRadius * Math.sqrt(random()) * lerp(0.2, 1, random());
    const x = network.centerX + Math.cos(angle) * radial;
    const y = network.centerY + Math.sin(angle) * radial;
    const minDistance = attempts > maxAttempts * 0.65
      ? config.tunnelMinNodeDistance * 0.55
      : config.tunnelMinNodeDistance;

    if (
      x < config.edgeMargin ||
      y < config.edgeMargin ||
      x >= widthTiles - config.edgeMargin ||
      y >= heightTiles - config.edgeMargin ||
      Math.hypot(x - network.centerX, y - network.centerY) > maxRadius ||
      tunnelNodeTooClose(network.nodes, x, y, minDistance)
    ) {
      continue;
    }

    const radialProgress = Math.max(0, Math.min(1, Math.hypot(x - network.centerX, y - network.centerY) / maxRadius));
    network.nodes.push({
      x,
      y,
      radius: Math.max(
        config.tunnelEndRadius,
        lerp(config.tunnelRadius, config.tunnelEndRadius, radialProgress) + (random() - 0.5) * 0.24
      )
    });
  }
}

function tunnelNodeTooClose(nodes, x, y, minDistance) {
  const minDistanceSq = minDistance * minDistance;
  return nodes.some((node) => {
    const dx = node.x - x;
    const dy = node.y - y;
    return dx * dx + dy * dy < minDistanceSq;
  });
}

function connectTunnelNodeGraph(network, maxRadius, config, random) {
  if (network.nodes.length <= 1) {
    return;
  }

  const connected = new Set([0]);
  const degrees = new Array(network.nodes.length).fill(0);
  const edges = new Set();

  while (connected.size < network.nodes.length) {
    let best = null;
    let fallback = null;

    for (const fromIndex of connected) {
      for (let toIndex = 1; toIndex < network.nodes.length; toIndex += 1) {
        if (connected.has(toIndex)) {
          continue;
        }

        const fromMaxDegree = fromIndex === 0 ? config.tunnelCenterMaxDegree : config.tunnelMaxNodeDegree;
        const score = tunnelConnectionScore(
          network.nodes[fromIndex],
          network.nodes[toIndex],
          fromIndex,
          degrees,
          network,
          maxRadius,
          config,
          random
        );
        const candidate = { fromIndex, toIndex, score };
        if (!fallback || score < fallback.score) {
          fallback = candidate;
        }
        if (degrees[fromIndex] >= fromMaxDegree) {
          continue;
        }
        if (!best || score < best.score) {
          best = candidate;
        }
      }
    }

    const next = best || fallback;
    if (!next) {
      break;
    }

    addTunnelGraphEdge(network, next.fromIndex, next.toIndex, degrees, edges, config, random);
    connected.add(next.toIndex);
  }

  const candidates = [];
  for (let fromIndex = 0; fromIndex < network.nodes.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < network.nodes.length; toIndex += 1) {
      const key = tunnelEdgeKey(fromIndex, toIndex);
      const distance = tunnelNodeDistance(network.nodes[fromIndex], network.nodes[toIndex]);
      if (
        edges.has(key) ||
        distance > config.tunnelMaxConnectionLength ||
        degrees[fromIndex] >= (fromIndex === 0 ? config.tunnelCenterMaxDegree : config.tunnelMaxNodeDegree) ||
        degrees[toIndex] >= (toIndex === 0 ? config.tunnelCenterMaxDegree : config.tunnelMaxNodeDegree)
      ) {
        continue;
      }

      candidates.push({
        fromIndex,
        toIndex,
        score: distance * lerp(0.75, 1.35, random()) * (1 + (degrees[fromIndex] + degrees[toIndex]) * 0.12)
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const extraCount = Math.min(Math.max(0, Math.round(config.tunnelExtraConnectionCount || 0)), candidates.length);
  for (let index = 0; index < extraCount; index += 1) {
    const candidate = candidates[index];
    addTunnelGraphEdge(network, candidate.fromIndex, candidate.toIndex, degrees, edges, config, random);
  }
}

function tunnelConnectionScore(from, to, fromIndex, degrees, network, maxRadius, config, random) {
  const distance = tunnelNodeDistance(from, to);
  const centerPenalty = fromIndex === 0 && degrees[fromIndex] >= 2 ? 5 + degrees[fromIndex] : 1;
  const degreePenalty = 1 + degrees[fromIndex] * 0.28;
  const fromRadial = Math.hypot(from.x - network.centerX, from.y - network.centerY);
  const toRadial = Math.hypot(to.x - network.centerX, to.y - network.centerY);
  const radialBias = 1 + Math.abs(toRadial - fromRadial) / Math.max(1, maxRadius) * 0.18;
  return distance * centerPenalty * degreePenalty * radialBias * lerp(0.85, 1.18, random());
}

function addTunnelGraphEdge(network, fromIndex, toIndex, degrees, edges, config, random) {
  const key = tunnelEdgeKey(fromIndex, toIndex);
  if (edges.has(key)) {
    return;
  }

  edges.add(key);
  degrees[fromIndex] += 1;
  degrees[toIndex] += 1;
  network.segments.push({
    from: network.nodes[fromIndex],
    to: network.nodes[toIndex],
    curve: (random() - 0.5) * config.tunnelCurveStrength
  });
}

function tunnelNodeDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tunnelEdgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function tunnelDensityCut(network, x, y, sampleX, sampleY, noise, z, config) {
  if (network.nodes.length === 0) {
    return 0;
  }

  const radiusNoise =
    noise(
      sampleX * config.tunnelNoiseScale,
      sampleY * config.tunnelNoiseScale,
      z * 0.23 + 509.7
    ) * config.tunnelRadiusJitter;
  let influence = 0;

  for (const node of network.nodes) {
    const radius = Math.max(config.tunnelEndRadius, node.radius + radiusNoise);
    influence = Math.max(influence, radialTunnelInfluence(Math.hypot(x - node.x, y - node.y), radius, config));
  }

  for (const segment of network.segments) {
    influence = Math.max(influence, segmentTunnelInfluence(x, y, segment, radiusNoise, config));
  }

  if (influence <= 0) {
    return 0;
  }

  return influence * config.tunnelDensityStrength;
}

function segmentTunnelInfluence(x, y, segment, radiusNoise, config) {
  const ax = segment.from.x;
  const ay = segment.from.y;
  const bx = segment.to.x;
  const by = segment.to.y;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
  const length = Math.sqrt(lengthSq);
  const bend = segment.curve * Math.sin(t * Math.PI);
  const normalX = length === 0 ? 0 : -dy / length;
  const normalY = length === 0 ? 0 : dx / length;
  const closestX = ax + dx * t + normalX * bend;
  const closestY = ay + dy * t + normalY * bend;
  const radius = Math.max(
    config.tunnelEndRadius,
    lerp(segment.from.radius, segment.to.radius, t) + radiusNoise
  );

  return radialTunnelInfluence(Math.hypot(x - closestX, y - closestY), radius, config);
}

function radialTunnelInfluence(distance, radius, config) {
  if (distance <= radius) {
    return 1;
  }

  return 1 - smoothstep(radius, radius + config.tunnelFeather, distance);
}

function fractalSimplex3D(noise, x, y, z, config) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let maxAmplitude = 0;

  for (let octave = 0; octave < config.noiseOctaves; octave += 1) {
    total += noise(x * frequency, y * frequency, z * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= config.noisePersistence;
    frequency *= config.noiseLacunarity;
  }

  return maxAmplitude === 0 ? 0 : total / maxAmplitude;
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }

  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function pruneSmallRockMaskComponents(mask, widthTiles, heightTiles, minSize) {
  const output = mask.slice();
  const visited = new Set();

  for (let index = 0; index < mask.length; index += 1) {
    if (visited.has(index) || !mask[index]) {
      continue;
    }

    const component = collectMaskComponent(index, mask, visited, widthTiles, heightTiles);
    if (component.length >= minSize) {
      continue;
    }

    for (const componentIndex of component) {
      output[componentIndex] = false;
    }
  }

  return output;
}

function closeSmallCaves(mask, widthTiles, heightTiles, random, config) {
  const visited = new Set();

  for (let index = 0; index < mask.length; index += 1) {
    if (visited.has(index) || mask[index]) {
      continue;
    }

    const cave = collectEmptyComponent(index, mask, visited, widthTiles, heightTiles);
    if (cave.touchesEdge || cave.indexes.length > config.caveCloseMaxSize) {
      continue;
    }

    const normalizedSize = cave.indexes.length / config.caveCloseMaxSize;
    const closeProbability = Math.pow(1 - normalizedSize, config.caveCloseProbabilityPower);
    if (random() > closeProbability) {
      continue;
    }

    for (const caveIndex of cave.indexes) {
      mask[caveIndex] = true;
    }
  }
}

function collectEmptyComponent(startIndex, mask, visited, widthTiles, heightTiles) {
  const queue = [startIndex];
  const indexes = [];
  let touchesEdge = false;
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    const x = index % widthTiles;
    const y = Math.floor(index / widthTiles);
    indexes.push(index);

    if (x === 0 || y === 0 || x === widthTiles - 1 || y === heightTiles - 1) {
      touchesEdge = true;
    }

    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighbor) || mask[neighbor]) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return { indexes, touchesEdge };
}

function collectMaskComponent(startIndex, mask, visited, widthTiles, heightTiles) {
  const queue = [startIndex];
  const component = [];
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    component.push(index);

    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighbor) || !mask[neighbor]) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return component;
}

function createPlayableBoundary(tiles, widthTiles, heightTiles, config) {
  const asteroidMask = tiles.map((tile) => isAsteroidRockTile(tile));
  const gapMask = dilateMaskPadded(asteroidMask, widthTiles, heightTiles, config.boundaryGap);
  const shellMask = closeMaskPadded(asteroidMask, widthTiles, heightTiles, config.boundaryDilate, config.boundaryShrink);
  return unionMasks(gapMask, shellMask);
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
  const indexes = [];
  let size = 0;
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    indexes.push(index);
    size += 1;

    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighbor) || !playable[neighbor] || isAsteroidRockTile(tiles[neighbor])) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return { seed, size, indexes };
}

function seedResourceNodes(tiles, amounts, widthTiles, heightTiles, random, config, seed) {
  const candidates = createResourceCandidateSeeds(tiles, widthTiles, heightTiles, random, config, seed);
  connectResourceCandidates(tiles, candidates, widthTiles, heightTiles, random, config);

  const visited = new Set();
  const keptGraphs = [];

  for (const candidate of candidates.values()) {
    if (visited.has(candidate.index)) {
      continue;
    }

    const component = collectCandidateComponent(candidate, candidates, visited, widthTiles, heightTiles);
    const graphAmount = component.reduce((total, node) => total + resourceGraphAmount(node), 0);
    const spawnCount = component.filter((node) => node.resource !== RESOURCE_TYPE.rock).length;
    const keepProbability = resourceGraphKeepProbability(spawnCount, config);
    if (random() > keepProbability) {
      continue;
    }

    keptGraphs.push({
      nodes: component,
      graphAmount,
      spawnCount,
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

  cullSmallOreComponents(tiles, amounts, widthTiles, heightTiles, random, config);
}

function createResourceCandidateSeeds(tiles, widthTiles, heightTiles, random, config, seed) {
  const candidates = new Map();
  const resourceNoise = createSimplexNoise3D(`${seed}:resource-density`);
  const oreAmountNoise = createSimplexNoise3D(`${seed}:ore-amount`);

  for (let y = 1; y < heightTiles - 1; y += 1) {
    for (let x = 1; x < widthTiles - 1; x += 1) {
      const index = y * widthTiles + x;
      if (tiles[index] !== ASTEROID_TILE.rock) {
        continue;
      }

      const density = resourceCandidateDensity(x, y, random, config, resourceNoise);
      if (density <= 0 || random() > config.resourceCandidateChance * density) {
        continue;
      }

      addResourceCandidate(candidates, index, x, y, randomResourceType(random, config), random, config, oreAmountNoise);
    }
  }

  return candidates;
}

function resourceCandidateDensity(x, y, random, config, resourceNoise) {
  const broad = (resourceNoise(
    x * config.resourceNoiseScale,
    y * config.resourceNoiseScale,
    41.17
  ) + 1) * 0.5;
  const detail = (resourceNoise(
    x * config.resourceNoiseDetailScale,
    y * config.resourceNoiseDetailScale,
    93.61
  ) + 1) * 0.5;
  const jitter = (random() - 0.5) * config.resourceNoiseJitter;
  const detailWeight = Math.max(0, Math.min(1, config.resourceNoiseDetailWeight));
  const score = (broad * (1 - detailWeight) + detail * detailWeight + jitter) * config.resourceNoiseMultiplier;

  return smoothstep(config.resourceNoiseThreshold, config.resourceNoiseThreshold + config.resourceNoiseFeather, score);
}

function randomResourceType(random, config) {
  const roll = random();
  if (roll < config.diamondChance) {
    return RESOURCE_TYPE.diamond;
  }

  if (roll < config.diamondChance + config.oreChance) {
    return RESOURCE_TYPE.ore;
  }

  return RESOURCE_TYPE.rock;
}

function addResourceCandidate(candidates, index, x, y, resource, random, config, oreAmountNoise) {
  if (candidates.has(index)) {
    return candidates.get(index);
  }

  const candidate = {
    index,
    x,
    y,
    resource,
    amount: resource === RESOURCE_TYPE.ore
      ? oreAmountForCandidate(x, y, random, config, oreAmountNoise)
      : 1
  };
  candidates.set(index, candidate);
  return candidate;
}

function oreAmountForCandidate(x, y, random, config, oreAmountNoise) {
  const broad = (oreAmountNoise(
    x * config.oreAmountNoiseScale,
    y * config.oreAmountNoiseScale,
    19.31
  ) + 1) * 0.5;
  const detail = (oreAmountNoise(
    x * config.oreAmountNoiseDetailScale,
    y * config.oreAmountNoiseDetailScale,
    71.73
  ) + 1) * 0.5;
  const jitter = (random() - 0.5) * 0.08;
  const score = (broad * 0.78 + detail * 0.22 + jitter) * config.oreAmountNoiseMultiplier;

  if (score >= config.oreAmountThreeThreshold) {
    return 3;
  }

  if (score >= config.oreAmountTwoThreshold) {
    return 2;
  }

  return 1;
}

function connectResourceCandidates(tiles, candidates, widthTiles, heightTiles, random, config) {
  const seeds = shuffle(Array.from(candidates.values()), random);

  for (const seed of seeds) {
    if (random() > config.resourceConnectionChance) {
      continue;
    }

    const path = bfsPathToNearestCandidate(
      tiles,
      candidates,
      seed.index,
      widthTiles,
      heightTiles,
      config.resourceConnectionMaxDistance
    );
    if (!path) {
      continue;
    }

    for (let pathIndex = 1; pathIndex < path.length - 1; pathIndex += 1) {
      const index = path[pathIndex];
      addResourceCandidate(
        candidates,
        index,
        index % widthTiles,
        Math.floor(index / widthTiles),
        RESOURCE_TYPE.rock,
        random,
        config,
        null
      );
    }
  }
}

function shuffle(items, random) {
  const shuffled = items.slice();

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = value;
  }

  return shuffled;
}

function bfsPathToNearestCandidate(tiles, candidates, startIndex, widthTiles, heightTiles, maxDistance) {
  const visited = new Set([startIndex]);
  const previous = new Map();
  const distance = new Map([[startIndex, 0]]);
  const queue = [startIndex];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const index = queue[queueIndex];
    queueIndex += 1;
    const currentDistance = distance.get(index);

    if (currentDistance >= maxDistance) {
      continue;
    }

    for (const neighbor of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighbor) || tiles[neighbor] !== ASTEROID_TILE.rock) {
        continue;
      }

      visited.add(neighbor);
      previous.set(neighbor, index);
      distance.set(neighbor, currentDistance + 1);

      if (neighbor !== startIndex && candidates.has(neighbor)) {
        return reconstructPath(previous, startIndex, neighbor);
      }

      queue.push(neighbor);
    }
  }

  return null;
}

function reconstructPath(previous, startIndex, endIndex) {
  const path = [endIndex];
  let current = endIndex;

  while (current !== startIndex) {
    current = previous.get(current);
    if (current === undefined) {
      return null;
    }

    path.push(current);
  }

  return path.reverse();
}

function resourceGraphAmount(node) {
  if (node.resource === RESOURCE_TYPE.diamond) {
    return 4;
  }

  return node.amount;
}

function resourceGraphKeepProbability(spawnCount, config) {
  if (spawnCount <= 0) {
    return 0;
  }

  const cullProbability = Math.pow(config.resourceGraphKeepDegradation, spawnCount);
  return Math.max(config.resourceGraphMinKeepChance, 1 - cullProbability);
}

function cullSmallOreComponents(tiles, amounts, widthTiles, heightTiles, random, config) {
  const maxSize = Math.max(0, Math.round(config.resourceSmallOreCullMaxSize || 0));
  if (maxSize <= 0) {
    return;
  }

  const visited = new Set();
  for (let index = 0; index < tiles.length; index += 1) {
    if (visited.has(index) || tiles[index] !== ASTEROID_TILE.ore) {
      continue;
    }

    const component = collectOreComponent(index, tiles, visited, widthTiles, heightTiles);
    if (component.length > maxSize) {
      continue;
    }

    const keepProbability = 1 - Math.pow(config.resourceSmallOreKeepDegradation, component.length);
    if (random() <= keepProbability) {
      continue;
    }

    for (const oreIndex of component) {
      tiles[oreIndex] = ASTEROID_TILE.rock;
      amounts[oreIndex] = 0;
    }
  }
}

function collectOreComponent(startIndex, tiles, visited, widthTiles, heightTiles) {
  const queue = [startIndex];
  const component = [];
  visited.add(startIndex);

  while (queue.length > 0) {
    const index = queue.shift();
    component.push(index);

    for (const neighborIndex of neighborIndexes(index, widthTiles, heightTiles)) {
      if (visited.has(neighborIndex) || tiles[neighborIndex] !== ASTEROID_TILE.ore) {
        continue;
      }

      visited.add(neighborIndex);
      queue.push(neighborIndex);
    }
  }

  return component;
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
