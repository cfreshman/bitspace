import {
  huckRockHullNative,
  planTrajectoryNative,
  stormBoundaryRunsNative,
  stormLayerNative,
  stormPatternRowsNative,
  stormRunsNative,
  visibilityCheckerLayerNative,
  visibilitySpansFromGridNative,
  visibilitySpansNative,
  warmBitspaceCore
} from "../shared/core/bitspace-core.js";
import { createSimplexNoise3D } from "../shared/math.js";

await warmBitspaceCore();

const plan = planTrajectoryNative({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  desiredX: 1,
  desiredY: 0,
  radius: 7,
  acceleration: 360,
  friction: 0.9,
  dt: 1 / 60,
  steps: 12,
  beamWidth: 10,
  scanPixels: 4,
  softClearancePixels: 1.1,
  progressWeight: 4.8,
  alignmentWeight: 5.2,
  clearanceWeight: 0.12,
  lateHitWeight: 0.85,
  maxOvershootSpeed: 4
}, []);

if (!plan?.safe || !Array.isArray(plan.moves) || plan.moves.length <= 0) {
  throw new Error("native trajectory smoke failed: no safe move");
}

const first = plan.moves[0];
if (first.x <= 0 || Math.abs(first.y) > 0.001) {
  throw new Error(`native trajectory smoke failed: unexpected first move ${JSON.stringify(first)}`);
}

const stormRows = stormPatternRowsNative(
  { seed: "smoke" },
  0,
  0,
  16,
  1,
  0.34,
  {
    fps: 20,
    scale: 0.15,
    speedX: -2,
    speedY: 5,
    speedZ: 0.1
  }
);
if (!(stormRows instanceof Uint32Array) || stormRows.length !== 16) {
  throw new Error("native storm smoke failed: missing rows");
}
const stormNoise = createSimplexNoise3D("smoke:storm-visual");
const expectedStormRows = new Uint32Array(16);
for (let py = 0; py < 16; py += 1) {
  let row = 0;
  for (let px = 0; px < 16; px += 1) {
    const sampleX = px * 0.15 + 1 * -2 * 0.15;
    const sampleY = py * 0.15 + 1 * 5 * 0.15;
    const sampleZ = 1 * 0.1;
    if (stormNoise(sampleX, sampleY, sampleZ) >= 0.34) {
      row |= 1 << px;
    }
  }
  expectedStormRows[py] = row;
}
for (let index = 0; index < 16; index += 1) {
  if (stormRows[index] !== expectedStormRows[index]) {
    throw new Error(`native storm smoke failed: simplex mismatch at row ${index}`);
  }
}

const visibility = visibilitySpansNative(
  { x: 8, y: 8 },
  32,
  [
    { x0: 20, y0: 0, x1: 20, y1: 30 },
    { x0: 20, y0: 30, x1: 40, y1: 30 }
  ],
  {
    baseRays: 32,
    angleEpsilon: 0.0008,
    dilatePixels: 1
  }
);
if (!visibility || !Array.isArray(visibility.rows) || visibility.rows.length <= 0) {
  throw new Error("native visibility smoke failed: missing spans");
}

const gridSize = 16;
const gridTiles = new Array(gridSize * gridSize).fill(".");
const gridPlayable = new Array(gridSize * gridSize).fill("1");
for (let y = 4; y < 12; y += 1) {
  gridTiles[y * gridSize + 8] = "r";
}
const gridVisibility = visibilitySpansFromGridNative(
  {
    seed: "smoke-grid",
    tick: 1,
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: gridPlayable
  },
  { x: 80, y: 80 },
  { x: 0, y: 0 },
  96,
  {
    minTileX: 0,
    maxTileX: gridSize - 1,
    minTileY: 0,
    maxTileY: gridSize - 1
  },
  {
    baseRays: 32,
    angleEpsilon: 0.0008,
    dilatePixels: 1,
    outerBevel: 3,
    innerCorner: 1,
    edgeOverlap: 1
  }
);
if (!gridVisibility || !Array.isArray(gridVisibility.rows) || gridVisibility.rows.length <= 0) {
  throw new Error("native grid visibility smoke failed: missing spans");
}

const huckHull = huckRockHullNative("smoke-rock", 24, 32, 5, 0.3, 0.4, 0.2);
if (!Array.isArray(huckHull) || huckHull.length < 3) {
  throw new Error("native huck-rock smoke failed: missing hull");
}
if (!huckHull.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
  throw new Error("native huck-rock smoke failed: invalid point");
}

const checkerLayer = visibilityCheckerLayerNative(
  {
    seed: "smoke-layer",
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: gridPlayable
  },
  { x: 0, y: 0 },
  64,
  64,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0
  }
);
if (!(checkerLayer instanceof Uint8Array) || checkerLayer.length !== 64 * 64) {
  throw new Error("native checker layer smoke failed: missing layer");
}
if (!checkerLayer.some((value) => value === 1)) {
  throw new Error("native checker layer smoke failed: empty layer");
}

const stormLayer = stormLayerNative(
  {
    seed: "smoke-storm-layer",
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: gridPlayable,
    storm: Array.from({ length: gridSize * gridSize }, (_value, index) => index % 3 === 0 ? "2" : "0")
  },
  { x: 0, y: 0 },
  64,
  64,
  1,
  0.34,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0,
    constants: {
      fps: 20,
      scale: 0.15,
      speedX: -2,
      speedY: 5,
      speedZ: 0.1
    }
  }
);
if (!(stormLayer instanceof Uint8Array) || stormLayer.length !== 64 * 64) {
  throw new Error("native storm layer smoke failed: missing layer");
}
if (!stormLayer.some((value) => value === 1) || !stormLayer.some((value) => value === 2)) {
  throw new Error("native storm layer smoke failed: missing storm codes");
}

const nonPlayableStormLayer = stormLayerNative(
  {
    seed: "smoke-nonplayable-storm-layer",
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: Array.from({ length: gridSize * gridSize }, () => 0),
    storm: Array.from({ length: gridSize * gridSize }, () => "0")
  },
  { x: 0, y: 0 },
  64,
  64,
  1,
  0.34,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0,
    constants: {
      fps: 20,
      scale: 0.15,
      speedX: -2,
      speedY: 5,
      speedZ: 0.1
    }
  }
);
if (!(nonPlayableStormLayer instanceof Uint8Array) || !nonPlayableStormLayer.some((value) => value !== 0)) {
  throw new Error("native storm layer smoke failed: non-playable tiles did not render as storm");
}

const outOfBoundsStormLayer = stormLayerNative(
  {
    seed: "smoke-out-of-bounds-storm-layer",
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: gridPlayable,
    storm: Array.from({ length: gridSize * gridSize }, () => "0")
  },
  { x: -48, y: -48 },
  64,
  64,
  1,
  0.34,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0,
    constants: {
      fps: 20,
      scale: 0.15,
      speedX: -2,
      speedY: 5,
      speedZ: 0.1
    }
  }
);
if (!(outOfBoundsStormLayer instanceof Uint8Array) || !outOfBoundsStormLayer.some((value) => value !== 0)) {
  throw new Error("native storm layer smoke failed: out-of-bounds world did not render as storm");
}

const stormRuns = stormRunsNative(
  {
    seed: "smoke-storm-runs",
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: Array.from({ length: gridSize * gridSize }, () => 0),
    storm: Array.from({ length: gridSize * gridSize }, () => "0")
  },
  { x: 0, y: 0 },
  64,
  64,
  1,
  0.34,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0,
    constants: {
      fps: 20,
      scale: 0.15,
      speedX: -2,
      speedY: 5,
      speedZ: 0.1
    }
  }
);
if (!(stormRuns instanceof Int32Array) || stormRuns.length < 4 || stormRuns.length % 4 !== 0) {
  throw new Error("native storm runs smoke failed: missing runs");
}
if (!Array.from(stormRuns).some((_value, index) => index % 4 === 3 && (stormRuns[index] === 1 || stormRuns[index] === 2))) {
  throw new Error("native storm runs smoke failed: missing storm run codes");
}

const stringPlayableStormRuns = stormRunsNative(
  {
    seed: "smoke-storm-runs-string-playable",
    revision: 1,
    widthTiles: gridSize,
    heightTiles: gridSize,
    tileSize: 16,
    tiles: gridTiles,
    playable: "0".repeat(gridSize * gridSize),
    storm: Array.from({ length: gridSize * gridSize }, () => "0")
  },
  { x: 0, y: 0 },
  64,
  64,
  1,
  0.34,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0,
    constants: {
      fps: 20,
      scale: 0.15,
      speedX: -2,
      speedY: 5,
      speedZ: 0.1
    }
  }
);
if (!(stringPlayableStormRuns instanceof Int32Array) || stringPlayableStormRuns.length < 4) {
  throw new Error("native storm runs smoke failed: string playable mask did not render as storm");
}

const boundaryPlayableRows = [
  "00000",
  "01110",
  "01110",
  "01110",
  "00000"
];
const stormBoundaryRuns = stormBoundaryRunsNative(
  {
    seed: "smoke-storm-boundary-runs",
    revision: 1,
    widthTiles: 5,
    heightTiles: 5,
    tileSize: 16,
    tiles: Array.from({ length: 25 }, () => "."),
    playable: boundaryPlayableRows.join(""),
    storm: Array.from({ length: 25 }, () => "0")
  },
  { x: 0, y: 0 },
  80,
  80,
  1,
  -2,
  {
    sourcePadding: 8,
    lensEdgeScale: 1,
    lensPower: 2,
    lensNoiseRadial: 0,
    lensNoiseTangential: 0,
    lensDefectDensity: 0,
    constants: {
      fps: 20,
      scale: 0.15,
      speedX: -2,
      speedY: 5,
      speedZ: 0.1
    }
  }
);
if (!(stormBoundaryRuns instanceof Int32Array) || stormBoundaryRuns.length < 4 || stormBoundaryRuns.length % 4 !== 0) {
  throw new Error("native storm boundary smoke failed: missing boundary runs");
}
if (!Array.from(stormBoundaryRuns).some((_value, index) => index % 4 === 3 && stormBoundaryRuns[index] === 2)) {
  throw new Error("native storm boundary smoke failed: missing foreground boundary code");
}

console.log("native core smoke ok");
