import {
  planTrajectoryNative,
  stormPatternRowsNative,
  visibilitySpansFromGridNative,
  visibilitySpansNative,
  warmBitspaceCore
} from "../shared/core/bitspace-core.js";

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

console.log("native core smoke ok");
