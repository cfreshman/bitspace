import { ENGINE, RENDER } from "./constants.js";
import {
  getLaserTagMap,
  LASER_TAG_MAP_CHARS
} from "./laser-tag-maps.js";
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

const ROCK_COLLISION_CORNER_RADIUS_SCALE = 1 / 3;

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
  const tileSize = Math.max(1, Math.floor(Number(options.tileSize) || RENDER.tileSize));
  const widthTiles = options.widthTiles || Math.floor(ENGINE.world.width / RENDER.tileSize);
  const heightTiles = options.heightTiles || Math.floor(ENGINE.world.height / RENDER.tileSize);
  const tiles = new Array(widthTiles * heightTiles).fill(ASTEROID_TILE.empty);
  const amounts = new Uint8Array(widthTiles * heightTiles);

  generateSimplexAsteroidField(tiles, widthTiles, heightTiles, random, config, seed);
  clearAsteroidCircles(tiles, amounts, widthTiles, heightTiles, tileSize, options.clearCircles || []);

  const playable = createPlayableBoundary(tiles, widthTiles, heightTiles, config);
  markPlayableCircles(playable, widthTiles, heightTiles, tileSize, options.playableCircles || options.clearCircles || []);
  const pockets = options.createPockets === false
    ? []
    : createPlayerPockets(tiles, playable, widthTiles, heightTiles, config, tileSize);

  if (options.seedResources !== false) {
    seedResourceNodes(tiles, amounts, widthTiles, heightTiles, random, config, seed);
  }

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize,
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
  const tileSize = Math.max(1, Math.floor(Number(options.tileSize) || RENDER.tileSize));
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

  const centerX = ((minTileX + maxTileX + 1) / 2) * tileSize;
  const centerY = ((minTileY + maxTileY + 1) / 2) * tileSize;
  const orbitRadius = options.spawnRadius || 92;
  const pockets = Array.from({ length: ENGINE.maxPlayers }, (_unused, index) => {
    const angle = Math.PI / 4 + (index * Math.PI * 2) / ENGINE.maxPlayers;
    return {
      playerNumber: index + 1,
      tileX: Math.round(centerX / tileSize),
      tileY: Math.round(centerY / tileSize),
      radius: 0,
      spawnX: centerX + Math.cos(angle) * orbitRadius,
      spawnY: centerY + Math.sin(angle) * orbitRadius
    };
  });

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize,
    generation: {
      mode: "lobby"
    },
    tiles,
    amounts,
    playable,
    pockets
  };
}

export function createThemeAsteroid(options = {}) {
  const widthTiles = options.widthTiles || 80;
  const heightTiles = options.heightTiles || 80;
  const tileSize = Math.max(1, Math.floor(Number(options.tileSize) || RENDER.tileSize));
  const clearRadius = options.clearRadius ?? 116;
  const playableExpansionTiles = Number.isFinite(Number(options.playableExpansionTiles))
    ? Number(options.playableExpansionTiles)
    : 6;
  const center = {
    x: (widthTiles * tileSize) / 2,
    y: (heightTiles * tileSize) / 2
  };
  const asteroid = createNaturalAsteroid({
    seed: options.seed || "bitspace-theme",
    widthTiles,
    heightTiles,
    tileSize,
    playerCount: options.playerCount,
    createPockets: false,
    seedResources: options.seedResources,
    clearCircles: [{ x: center.x, y: center.y, radius: clearRadius }],
    playableCircles: [{ x: center.x, y: center.y, radius: clearRadius + tileSize * playableExpansionTiles }],
    generation: {
      ...THEME_ASTEROID_GENERATION,
      ...(options.generation || {})
    }
  });

  if (options.createLobbyPockets) {
    asteroid.pockets = createCenteredLobbyPockets(asteroid, center, options.spawnRadius || 92);
  }

  return asteroid;
}

export function createLaserTagAsteroid(options = {}) {
  const map = getLaserTagMap(options.variant || options.mapId);
  if (map) {
    return createLaserTagAsteroidFromMap(map, options);
  }

  const seed = options.seed || "bitspace-laser-tag";
  const tileSize = Math.max(1, Math.floor(Number(options.tileSize) || RENDER.tileSize));
  const widthTiles = options.widthTiles || 72;
  const heightTiles = options.heightTiles || 56;
  const tiles = new Array(widthTiles * heightTiles).fill(ASTEROID_TILE.empty);
  const amounts = new Uint8Array(widthTiles * heightTiles);
  const playable = new Array(widthTiles * heightTiles).fill(true);
  const random = createSeededRandom(`${seed}:layout`);
  const variants = ["waldo", "odlaw", "wenda", "wizard"];
  const requestedVariant = String(options.variant || "").toLowerCase();
  const variant = variants.includes(requestedVariant)
    ? requestedVariant
    : variants[Math.floor(random() * variants.length) % variants.length];

  fillLaserTagBorder(tiles, widthTiles, heightTiles);
  carveLaserTagLayout(tiles, widthTiles, heightTiles, variant);

  const redBase = {
    id: "laser-base-red",
    team: "red",
    label: "RED BASE",
    x: 3 * tileSize,
    y: Math.floor(heightTiles / 2) * tileSize
  };
  const blueBase = {
    id: "laser-base-blue",
    team: "blue",
    label: "BLUE BASE",
    x: (widthTiles - 4) * tileSize,
    y: Math.floor(heightTiles / 2) * tileSize
  };
  const redGate = {
    id: "laser-gate-red",
    team: "red",
    label: "WEST GATE",
    x: 9 * tileSize,
    y: Math.floor(heightTiles / 2) * tileSize
  };
  const blueGate = {
    id: "laser-gate-blue",
    team: "blue",
    label: "EAST GATE",
    x: (widthTiles - 10) * tileSize,
    y: Math.floor(heightTiles / 2) * tileSize
  };
  const centerY = (heightTiles * tileSize) / 2;
  const redSpawnX = 4 * tileSize;
  const blueSpawnX = (widthTiles - 5) * tileSize;
  const spawnSpread = tileSize * 4;
  const pockets = Array.from({ length: ENGINE.maxPlayers }, (_unused, index) => {
    const red = index % 2 === 0;
    const teamIndex = Math.floor(index / 2);
    const row = teamIndex - 1.5;
    return {
      playerNumber: index + 1,
      tileX: red ? 10 : widthTiles - 10,
      tileY: Math.floor(heightTiles / 2 + row * 4),
      radius: 0,
      spawnX: red ? redSpawnX : blueSpawnX,
      spawnY: centerY + row * spawnSpread,
      angle: red ? 0 : Math.PI
    };
  });

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize,
    generation: {
      mode: "laser-tag",
      variant
    },
    tiles,
    amounts,
    playable,
    pockets,
    laserTag: {
      variant,
      spawns: {
        red: pockets.filter((_pocket, index) => index % 2 === 0),
        blue: pockets.filter((_pocket, index) => index % 2 === 1)
      },
      bases: [redBase, blueBase],
      gates: [redGate, blueGate]
    }
  };
}

function createLaserTagAsteroidFromMap(map, options = {}) {
  const seed = options.seed || `bitspace-laser-tag:${map.id}`;
  const tileSize = Math.max(1, Math.floor(Number(options.tileSize) || RENDER.tileSize));
  const widthTiles = map.widthTiles;
  const heightTiles = map.heightTiles;
  const tiles = new Array(widthTiles * heightTiles).fill(ASTEROID_TILE.empty);
  const amounts = new Uint8Array(widthTiles * heightTiles);
  const playable = new Array(widthTiles * heightTiles).fill(true);
  const markers = {
    redSpawn: [],
    blueSpawn: [],
    redGate: [],
    blueGate: []
  };

  for (let tileY = 0; tileY < heightTiles; tileY += 1) {
    const row = map.rows[tileY];
    for (let tileX = 0; tileX < widthTiles; tileX += 1) {
      const char = row[tileX];
      const index = tileY * widthTiles + tileX;
      if (char === LASER_TAG_MAP_CHARS.rock) {
        tiles[index] = ASTEROID_TILE.rock;
      } else if (char === LASER_TAG_MAP_CHARS.diamond) {
        tiles[index] = ASTEROID_TILE.rock;
      } else if (char === LASER_TAG_MAP_CHARS.redSpawn) {
        markers.redSpawn.push({ tileX, tileY });
      } else if (char === LASER_TAG_MAP_CHARS.blueSpawn) {
        markers.blueSpawn.push({ tileX, tileY });
      } else if (char === LASER_TAG_MAP_CHARS.redGate) {
        markers.redGate.push({ tileX, tileY });
      } else if (char === LASER_TAG_MAP_CHARS.blueGate) {
        markers.blueGate.push({ tileX, tileY });
      }
    }
  }

  const redSpawns = laserTagSpawnPointsFromMarkers(markers.redSpawn, tileSize, "red");
  const blueSpawns = laserTagSpawnPointsFromMarkers(markers.blueSpawn, tileSize, "blue");
  const pockets = Array.from({ length: ENGINE.maxPlayers }, (_unused, index) => {
    const red = index % 2 === 0;
    const spawns = red ? redSpawns : blueSpawns;
    const spawn = spawns[Math.floor(index / 2) % Math.max(1, spawns.length)] ||
      fallbackLaserTagSpawn(widthTiles, heightTiles, tileSize, red ? "red" : "blue");
    return {
      playerNumber: index + 1,
      tileX: Math.floor(spawn.x / tileSize),
      tileY: Math.floor(spawn.y / tileSize),
      radius: 0,
      spawnX: spawn.x,
      spawnY: spawn.y,
      angle: spawn.angle
    };
  });
  const redBase = laserTagBaseFromSpawns(redSpawns, widthTiles, heightTiles, tileSize, "red");
  const blueBase = laserTagBaseFromSpawns(blueSpawns, widthTiles, heightTiles, tileSize, "blue");

  return {
    seed,
    widthTiles,
    heightTiles,
    tileSize,
    generation: {
      mode: "laser-tag",
      variant: map.id,
      source: "png"
    },
    tiles,
    amounts,
    playable,
    pockets,
    laserTag: {
      variant: map.id,
      spawns: {
        red: pockets.filter((_pocket, index) => index % 2 === 0),
        blue: pockets.filter((_pocket, index) => index % 2 === 1)
      },
      bases: [redBase, blueBase],
      gates: [
        ...laserTagGateTargetsFromMarkers(markers.redGate, tileSize, "red"),
        ...laserTagGateTargetsFromMarkers(markers.blueGate, tileSize, "blue")
      ]
    }
  };
}

function laserTagSpawnPointsFromMarkers(markers, tileSize, team) {
  const angle = team === "red" ? 0 : Math.PI;
  return markers.map((marker) => ({
    x: (marker.tileX + 0.5) * tileSize,
    y: (marker.tileY + 0.5) * tileSize,
    angle
  }));
}

function fallbackLaserTagSpawn(widthTiles, heightTiles, tileSize, team) {
  const red = team === "red";
  return {
    x: (red ? 2.5 : widthTiles - 2.5) * tileSize,
    y: heightTiles * tileSize * 0.5,
    angle: red ? 0 : Math.PI
  };
}

function laserTagBaseFromSpawns(spawns, widthTiles, heightTiles, tileSize, team) {
  const fallback = fallbackLaserTagSpawn(widthTiles, heightTiles, tileSize, team);
  const center = averagePoints(spawns.length ? spawns : [fallback]);
  return {
    id: `laser-base-${team}`,
    team,
    label: `${team.toUpperCase()} BASE`,
    x: center.x,
    y: center.y
  };
}

function laserTagGateTargetsFromMarkers(markers, tileSize, team) {
  const components = connectedMarkerComponents(markers);
  components.sort((a, b) => averageTileY(a) - averageTileY(b));
  return components.map((component, index) => {
    const center = averageMarkerCenter(component, tileSize);
    const gateName = index === 0 ? "NORTH GATE" : index === 1 ? "SOUTH GATE" : `GATE ${index + 1}`;
    return {
      id: `laser-gate-${team}-${index + 1}`,
      team,
      label: gateName,
      x: center.x,
      y: center.y
    };
  });
}

function connectedMarkerComponents(markers) {
  const remaining = new Map(markers.map((marker) => [`${marker.tileX}:${marker.tileY}`, marker]));
  const components = [];
  for (const marker of markers) {
    const key = `${marker.tileX}:${marker.tileY}`;
    if (!remaining.has(key)) {
      continue;
    }

    remaining.delete(key);
    const component = [];
    const stack = [marker];
    while (stack.length > 0) {
      const current = stack.pop();
      component.push(current);
      for (const neighbor of markerNeighbors(current)) {
        const neighborKey = `${neighbor.tileX}:${neighbor.tileY}`;
        const next = remaining.get(neighborKey);
        if (!next) {
          continue;
        }
        remaining.delete(neighborKey);
        stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function markerNeighbors(marker) {
  return [
    { tileX: marker.tileX + 1, tileY: marker.tileY },
    { tileX: marker.tileX - 1, tileY: marker.tileY },
    { tileX: marker.tileX, tileY: marker.tileY + 1 },
    { tileX: marker.tileX, tileY: marker.tileY - 1 }
  ];
}

function averageMarkerCenter(markers, tileSize) {
  const average = averagePoints(markers.map((marker) => ({
    x: (marker.tileX + 0.5) * tileSize,
    y: (marker.tileY + 0.5) * tileSize
  })));
  return average;
}

function averagePoints(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  const count = Math.max(1, points.length);
  return {
    x: x / count,
    y: y / count
  };
}

function averageTileY(markers) {
  return markers.reduce((sum, marker) => sum + marker.tileY, 0) / Math.max(1, markers.length);
}

function fillLaserTagBorder(tiles, widthTiles, heightTiles) {
  for (let tileX = 0; tileX < widthTiles; tileX += 1) {
    setLaserTagWallTile(tiles, widthTiles, tileX, 0);
    setLaserTagWallTile(tiles, widthTiles, tileX, heightTiles - 1);
  }
  for (let tileY = 0; tileY < heightTiles; tileY += 1) {
    setLaserTagWallTile(tiles, widthTiles, 0, tileY);
    setLaserTagWallTile(tiles, widthTiles, widthTiles - 1, tileY);
  }
}

function carveLaserTagLayout(tiles, widthTiles, heightTiles, variant) {
  const midX = Math.floor(widthTiles / 2);
  const midY = Math.floor(heightTiles / 2);
  const layouts = {
    waldo: [
      [midX - 2, 6, 4, 15], [midX - 2, heightTiles - 21, 4, 15],
      [16, 12, 4, 12], [16, heightTiles - 24, 4, 12],
      [widthTiles - 20, 12, 4, 12], [widthTiles - 20, heightTiles - 24, 4, 12],
      [24, midY - 2, 10, 4], [widthTiles - 34, midY - 2, 10, 4],
      [midX - 12, midY - 10, 6, 4], [midX + 6, midY + 6, 6, 4]
    ],
    odlaw: [
      [midX - 10, 9, 4, 16], [midX + 6, heightTiles - 25, 4, 16],
      [10, midY - 9, 16, 4], [widthTiles - 26, midY + 5, 16, 4],
      [24, 12, 10, 4], [widthTiles - 34, heightTiles - 16, 10, 4],
      [midX - 2, midY - 2, 4, 4], [midX - 18, midY + 10, 8, 4], [midX + 10, midY - 14, 8, 4]
    ],
    wenda: [
      [midX - 18, 8, 4, 14], [midX + 14, 8, 4, 14],
      [midX - 18, heightTiles - 22, 4, 14], [midX + 14, heightTiles - 22, 4, 14],
      [18, midY - 8, 14, 4], [widthTiles - 32, midY - 8, 14, 4],
      [18, midY + 4, 14, 4], [widthTiles - 32, midY + 4, 14, 4],
      [midX - 4, midY - 12, 8, 4], [midX - 4, midY + 8, 8, 4]
    ],
    wizard: [
      [midX - 2, 7, 4, 11], [midX - 2, heightTiles - 18, 4, 11],
      [midX - 12, midY - 2, 24, 4],
      [12, 12, 4, 12], [widthTiles - 16, 12, 4, 12],
      [12, heightTiles - 24, 4, 12], [widthTiles - 16, heightTiles - 24, 4, 12],
      [25, 18, 7, 4], [widthTiles - 32, 18, 7, 4],
      [25, heightTiles - 22, 7, 4], [widthTiles - 32, heightTiles - 22, 7, 4]
    ]
  };

  for (const rect of layouts[variant] || layouts.waldo) {
    fillLaserTagWallRect(tiles, widthTiles, heightTiles, ...rect);
  }
}

function fillLaserTagWallRect(tiles, widthTiles, heightTiles, x, y, width, height) {
  const minX = Math.max(1, Math.floor(x));
  const minY = Math.max(1, Math.floor(y));
  const maxX = Math.min(widthTiles - 2, Math.floor(x + width - 1));
  const maxY = Math.min(heightTiles - 2, Math.floor(y + height - 1));
  for (let tileY = minY; tileY <= maxY; tileY += 1) {
    for (let tileX = minX; tileX <= maxX; tileX += 1) {
      setLaserTagWallTile(tiles, widthTiles, tileX, tileY);
    }
  }
}

function setLaserTagWallTile(tiles, widthTiles, tileX, tileY) {
  tiles[tileY * widthTiles + tileX] = ASTEROID_TILE.rock;
}

const THEME_ASTEROID_GENERATION = Object.freeze({
  edgeMargin: 5,
  noiseScale: 0.09,
  noiseDetailScale: 0.22,
  noiseWarpScale: 0.06,
  noiseWarpStrength: 4,
  noiseCaveScale: 0.13,
  noiseCaveSecondaryScale: 0.17,
  noiseCaveDetailScale: 0.28,
  noiseCaveBand: 0.04,
  noiseCaveJunctionBand: 0.025,
  noiseCaveWidthJitter: 0.018,
  noiseCaveMinDepth: 0.08,
  noiseOctaves: 4,
  noisePersistence: 0.52,
  noiseLacunarity: 2,
  noiseFieldRadius: 19,
  noiseThreshold: -0.14,
  noiseRadialFalloff: 0.45,
  noiseMinComponentSize: 4,
  caveCloseMaxSize: 10,
  caveCloseProbabilityPower: 1.15,
  resourceCandidateChance: 0.95,
  resourceNoiseThreshold: 0.76,
  resourceConnectionChance: 0.6,
  resourceConnectionMaxDistance: 5,
  resourceGraphKeepDegradation: 0.92,
  resourceMaxGraphs: 160,
  resourceMaxSpawnTiles: 260,
  oreChance: 0.84,
  diamondChance: 0.07,
  boundaryDilate: 24,
  boundaryShrink: 12,
  boundaryGap: 12
});

function createCenteredLobbyPockets(asteroid, center, orbitRadius) {
  return Array.from({ length: ENGINE.maxPlayers }, (_unused, index) => {
    const angle = Math.PI / 4 + (index * Math.PI * 2) / ENGINE.maxPlayers;
    return {
      playerNumber: index + 1,
      tileX: Math.round(center.x / asteroid.tileSize),
      tileY: Math.round(center.y / asteroid.tileSize),
      radius: 0,
      spawnX: center.x + Math.cos(angle) * orbitRadius,
      spawnY: center.y + Math.sin(angle) * orbitRadius
    };
  });
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
      spawnY: pocket.spawnY,
      angle: pocket.angle
    })),
    laserTag: asteroid.laserTag || null
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
  let previousTileX = Math.floor(startX / asteroid.tileSize);
  let previousTileY = Math.floor(startY / asteroid.tileSize);
  let previousX = startX;
  let previousY = startY;

  for (let distance = 0; distance <= maxDistance; distance += step) {
    const x = startX + direction.x * distance;
    const y = startY + direction.y * distance;
    const tileX = Math.floor(x / asteroid.tileSize);
    const tileY = Math.floor(y / asteroid.tileSize);
    const cornerHit = raycastCornerBlock(
      asteroid,
      previousTileX,
      previousTileY,
      tileX,
      tileY,
      previousX,
      previousY,
      x,
      y,
      options
    );
    if (cornerHit) {
      return {
        ...cornerHit,
        x,
        y,
        distance
      };
    }

    const hit = asteroidCollisionAt(asteroid, tileX, tileY, options);

    if (hit) {
      const blocker = blockingTileDescriptor(asteroid, tileX, tileY);
      if (!pointOverlapsBlockerShape(x, y, blocker)) {
        previousTileX = tileX;
        previousTileY = tileY;
        previousX = x;
        previousY = y;
        continue;
      }

      return {
        ...hit,
        x,
        y,
        distance
      };
    }

    previousTileX = tileX;
    previousTileY = tileY;
    previousX = x;
    previousY = y;
  }

  return {
    hit: false,
    mineable: false,
    x: startX + direction.x * maxDistance,
    y: startY + direction.y * maxDistance,
    distance: maxDistance
  };
}

function raycastCornerBlock(
  asteroid,
  previousTileX,
  previousTileY,
  tileX,
  tileY,
  previousX,
  previousY,
  x,
  y,
  options = {}
) {
  const dx = tileX - previousTileX;
  const dy = tileY - previousTileY;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
    return null;
  }

  const sideA = {
    tileX,
    tileY: previousTileY
  };
  const sideB = {
    tileX: previousTileX,
    tileY
  };
  const sideAHit = asteroidCollisionAt(asteroid, sideA.tileX, sideA.tileY, options);
  const sideBHit = asteroidCollisionAt(asteroid, sideB.tileX, sideB.tileY, options);
  if (!sideAHit || !sideBHit) {
    return null;
  }

  const segmentDx = x - previousX;
  const segmentDy = y - previousY;
  const verticalBoundary = dx > 0
    ? tileX * asteroid.tileSize
    : previousTileX * asteroid.tileSize;
  const horizontalBoundary = dy > 0
    ? tileY * asteroid.tileSize
    : previousTileY * asteroid.tileSize;
  const verticalT = Math.abs(segmentDx) > 0.000001
    ? (verticalBoundary - previousX) / segmentDx
    : Number.POSITIVE_INFINITY;
  const horizontalT = Math.abs(segmentDy) > 0.000001
    ? (horizontalBoundary - previousY) / segmentDy
    : Number.POSITIVE_INFINITY;

  return verticalT <= horizontalT ? sideAHit : sideBHit;
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
  const tile = inBounds ? asteroid.tiles[index] : ASTEROID_TILE.empty;
  const x = tileX * asteroid.tileSize;
  const y = tileY * asteroid.tileSize;
  const size = asteroid.tileSize;
  return {
    tileX,
    tileY,
    index,
    tile,
    key: `${tileX}:${tileY}`,
    x,
    y,
    size,
    width: size,
    height: size,
    right: x + size,
    bottom: y + size,
    shape: inBounds ? rockCollisionShape(asteroid, tileX, tileY, tile) : null
  };
}

export function pointOverlapsBlockerShape(x, y, blocker) {
  if (!blocker) {
    return false;
  }

  const bounds = blockerBounds(blocker);
  if (!pointInBounds(x, y, bounds)) {
    return false;
  }

  const shape = blocker.shape;
  if (!shape?.rounded) {
    return true;
  }

  return !pointInRoundedCutout(x, y, bounds, shape);
}

export function pointDistanceToBlockerShape(x, y, blocker) {
  const bounds = blockerBounds(blocker);
  if (!blocker?.shape?.rounded) {
    return pointDistanceToBounds(x, y, bounds);
  }

  if (pointOverlapsBlockerShape(x, y, blocker)) {
    return -pointInsideBoundsDepth(x, y, bounds);
  }

  let distance = Number.POSITIVE_INFINITY;
  for (const primitive of roundedBlockerPrimitives(blocker)) {
    distance = Math.min(distance, pointDistanceToPrimitive(x, y, primitive));
  }
  return distance;
}

export function circleBlockerOverlap(circle, blocker) {
  if (!circle || !blocker) {
    return null;
  }

  const bounds = blockerBounds(blocker);
  const broad = circleBoundsOverlap(circle, bounds.x, bounds.y, bounds.width, bounds.height);
  if (!broad) {
    return null;
  }

  if (!blocker.shape?.rounded) {
    return broad;
  }

  if (pointOverlapsBlockerShape(circle.x, circle.y, blocker)) {
    return broad;
  }

  let best = null;
  for (const primitive of roundedBlockerPrimitives(blocker)) {
    const hit = circlePrimitiveOverlap(circle, primitive);
    best = betterCircleOverlap(best, hit);
  }

  return best;
}

export function sweptCircleBlockerHit(previousX, previousY, x, y, radius, blocker) {
  if (!blocker) {
    return null;
  }

  const bounds = blockerBounds(blocker);
  if (!blocker.shape?.rounded) {
    return sweptCircleBoundsHit(previousX, previousY, x, y, radius, bounds.x, bounds.y, bounds.width, bounds.height);
  }

  const startOverlap = circleBlockerOverlap({ x: previousX, y: previousY, radius }, blocker);
  if (startOverlap) {
    return {
      ...startOverlap,
      time: 0,
      x: previousX,
      y: previousY
    };
  }

  const broad = sweptCircleBoundsHit(previousX, previousY, x, y, radius, bounds.x, bounds.y, bounds.width, bounds.height);
  const endOverlap = circleBlockerOverlap({ x, y, radius }, blocker);
  if (!broad && !endOverlap) {
    return null;
  }

  const dx = x - previousX;
  const dy = y - previousY;
  let low = 0;
  let high = null;
  const scanSteps = 16;
  for (let step = 1; step <= scanSteps; step += 1) {
    const t = step / scanSteps;
    const probe = {
      x: previousX + dx * t,
      y: previousY + dy * t,
      radius
    };
    if (circleBlockerOverlap(probe, blocker)) {
      high = t;
      break;
    }
    low = t;
  }

  if (high === null) {
    return null;
  }

  for (let step = 0; step < 8; step += 1) {
    const t = (low + high) * 0.5;
    const probe = {
      x: previousX + dx * t,
      y: previousY + dy * t,
      radius
    };
    if (circleBlockerOverlap(probe, blocker)) {
      high = t;
    } else {
      low = t;
    }
  }

  const hitX = previousX + dx * high;
  const hitY = previousY + dy * high;
  const hit = circleBlockerOverlap({ x: hitX, y: hitY, radius }, blocker);
  if (!hit) {
    return null;
  }

  return {
    ...hit,
    time: high,
    x: hitX,
    y: hitY
  };
}

function rockCollisionShape(asteroid, tileX, tileY, tile) {
  if (!isAsteroidRockTile(tile) || tile === ASTEROID_TILE.wall) {
    return null;
  }

  const north = isRockCollisionTileAt(asteroid, tileX, tileY - 1);
  const east = isRockCollisionTileAt(asteroid, tileX + 1, tileY);
  const south = isRockCollisionTileAt(asteroid, tileX, tileY + 1);
  const west = isRockCollisionTileAt(asteroid, tileX - 1, tileY);
  const corners = {
    topLeft: !north && !west,
    topRight: !north && !east,
    bottomRight: !south && !east,
    bottomLeft: !south && !west
  };

  if (!corners.topLeft && !corners.topRight && !corners.bottomRight && !corners.bottomLeft) {
    return null;
  }

  return {
    rounded: true,
    radius: Math.max(1, Math.round(asteroid.tileSize * ROCK_COLLISION_CORNER_RADIUS_SCALE)),
    corners
  };
}

function isRockCollisionTileAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  const tile = asteroid.tiles[tileY * asteroid.widthTiles + tileX];
  return isAsteroidRockTile(tile) && tile !== ASTEROID_TILE.wall;
}

function blockerBounds(blocker) {
  if (
    Number.isFinite(blocker?.right) &&
    Number.isFinite(blocker?.bottom) &&
    Number.isFinite(blocker?.width) &&
    Number.isFinite(blocker?.height)
  ) {
    return blocker;
  }

  const width = Number(blocker.width ?? blocker.size ?? 0);
  const height = Number(blocker.height ?? blocker.size ?? width);
  return {
    x: Number(blocker.x || 0),
    y: Number(blocker.y || 0),
    width,
    height,
    right: Number(blocker.x || 0) + width,
    bottom: Number(blocker.y || 0) + height
  };
}

function pointInBounds(x, y, bounds) {
  return x >= bounds.x && x <= bounds.right && y >= bounds.y && y <= bounds.bottom;
}

function pointInRoundedCutout(x, y, bounds, shape) {
  const radius = Math.max(0, Number(shape.radius || 0));
  if (radius <= 0) {
    return false;
  }

  const corners = shape.corners || {};
  if (
    corners.topLeft &&
    x < bounds.x + radius &&
    y < bounds.y + radius &&
    Math.hypot(x - (bounds.x + radius), y - (bounds.y + radius)) > radius
  ) {
    return true;
  }

  if (
    corners.topRight &&
    x > bounds.right - radius &&
    y < bounds.y + radius &&
    Math.hypot(x - (bounds.right - radius), y - (bounds.y + radius)) > radius
  ) {
    return true;
  }

  if (
    corners.bottomRight &&
    x > bounds.right - radius &&
    y > bounds.bottom - radius &&
    Math.hypot(x - (bounds.right - radius), y - (bounds.bottom - radius)) > radius
  ) {
    return true;
  }

  return corners.bottomLeft &&
    x < bounds.x + radius &&
    y > bounds.bottom - radius &&
    Math.hypot(x - (bounds.x + radius), y - (bounds.bottom - radius)) > radius;
}

function roundedBlockerPrimitives(blocker) {
  const bounds = blockerBounds(blocker);
  const shape = blocker.shape || {};
  const radius = Math.max(
    0,
    Math.min(Math.min(bounds.width, bounds.height) * 0.5, Number(shape.radius || 0))
  );
  if (!shape.rounded || radius <= 0) {
    return [{ type: "rect", x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }];
  }

  const primitives = [];
  const centerWidth = Math.max(0, bounds.width - radius * 2);
  const centerHeight = Math.max(0, bounds.height - radius * 2);
  if (centerWidth > 0) {
    primitives.push({
      type: "rect",
      x: bounds.x + radius,
      y: bounds.y,
      width: centerWidth,
      height: bounds.height
    });
  }
  if (centerHeight > 0) {
    primitives.push({
      type: "rect",
      x: bounds.x,
      y: bounds.y + radius,
      width: bounds.width,
      height: centerHeight
    });
  }

  addRoundedCornerPrimitive(primitives, bounds, shape.corners?.topLeft, bounds.x, bounds.y, bounds.x + radius, bounds.y + radius, radius);
  addRoundedCornerPrimitive(primitives, bounds, shape.corners?.topRight, bounds.right - radius, bounds.y, bounds.right - radius, bounds.y + radius, radius);
  addRoundedCornerPrimitive(primitives, bounds, shape.corners?.bottomRight, bounds.right - radius, bounds.bottom - radius, bounds.right - radius, bounds.bottom - radius, radius);
  addRoundedCornerPrimitive(primitives, bounds, shape.corners?.bottomLeft, bounds.x, bounds.bottom - radius, bounds.x + radius, bounds.bottom - radius, radius);

  return primitives;
}

function addRoundedCornerPrimitive(primitives, bounds, rounded, rectX, rectY, circleX, circleY, radius) {
  if (rounded) {
    primitives.push({
      type: "circle",
      x: circleX,
      y: circleY,
      radius
    });
    return;
  }

  primitives.push({
    type: "rect",
    x: rectX,
    y: rectY,
    width: radius,
    height: radius
  });
}

function circlePrimitiveOverlap(circle, primitive) {
  if (primitive.type === "circle") {
    const combinedRadius = Number(circle.radius || 0) + primitive.radius;
    const dx = circle.x - primitive.x;
    const dy = circle.y - primitive.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= combinedRadius) {
      return null;
    }
    const normalX = distance > 0.0001 ? dx / distance : 1;
    const normalY = distance > 0.0001 ? dy / distance : 0;
    return {
      normalX,
      normalY,
      overlap: combinedRadius - distance,
      distance: Math.max(0, distance - primitive.radius)
    };
  }

  return circleBoundsOverlap(circle, primitive.x, primitive.y, primitive.width, primitive.height);
}

function betterCircleOverlap(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return candidate.overlap > current.overlap ? candidate : current;
}

function pointDistanceToPrimitive(x, y, primitive) {
  if (primitive.type === "circle") {
    return Math.max(0, Math.hypot(x - primitive.x, y - primitive.y) - primitive.radius);
  }

  return pointDistanceToBounds(x, y, {
    x: primitive.x,
    y: primitive.y,
    right: primitive.x + primitive.width,
    bottom: primitive.y + primitive.height,
    width: primitive.width,
    height: primitive.height
  });
}

function pointDistanceToBounds(x, y, bounds) {
  const dx = x < bounds.x ? bounds.x - x : x > bounds.right ? x - bounds.right : 0;
  const dy = y < bounds.y ? bounds.y - y : y > bounds.bottom ? y - bounds.bottom : 0;
  return Math.hypot(dx, dy);
}

function pointInsideBoundsDepth(x, y, bounds) {
  if (!pointInBounds(x, y, bounds)) {
    return 0;
  }

  return Math.min(x - bounds.x, bounds.right - x, y - bounds.y, bounds.bottom - y);
}

function circleBoundsOverlap(circle, x, y, width, height) {
  const right = x + width;
  const bottom = y + height;
  const closestX = clampNumber(circle.x, x, right);
  const closestY = clampNumber(circle.y, y, bottom);
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
      overlap: circle.radius - distance,
      distance
    };
  }

  const left = circle.x - x;
  const rightDistance = right - circle.x;
  const top = circle.y - y;
  const bottomDistance = bottom - circle.y;
  const nearest = Math.min(left, rightDistance, top, bottomDistance);

  if (nearest === left) {
    return { normalX: -1, normalY: 0, overlap: circle.radius + left, distance: 0 };
  }

  if (nearest === rightDistance) {
    return { normalX: 1, normalY: 0, overlap: circle.radius + rightDistance, distance: 0 };
  }

  if (nearest === top) {
    return { normalX: 0, normalY: -1, overlap: circle.radius + top, distance: 0 };
  }

  return { normalX: 0, normalY: 1, overlap: circle.radius + bottomDistance, distance: 0 };
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
    overlap: 0,
    distance: 0
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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isPlayableCell(asteroid, index) {
  return asteroid.playable[index] === true || asteroid.playable[index] === "1";
}

function createPlayerPockets(tiles, playable, widthTiles, heightTiles, config, tileSize = RENDER.tileSize) {
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
      spawnX: (spawn.x + 0.5) * tileSize,
      spawnY: (spawn.y + 0.5) * tileSize
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
