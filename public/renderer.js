import { ENGINE, RENDER } from "/shared/constants.js";
import { buildClosestTileRing, buildTileVisibleFromOrigin } from "/shared/build.js";
import { ASTEROID_TILE, STORM_STATE, isAsteroidRockTile, raycastAsteroid } from "/shared/asteroid.js";
import { createSeededRandom, createSimplexNoise3D } from "/shared/math.js";
import {
  miningRayClippedSideStartDistance,
  miningRayCountForPlayer,
  miningRayLaneWithStart,
  miningRaySideStartProbe,
  miningRayLanesForPlayer
} from "/shared/mining.js";
import {
  aggregateUpgradeEffects,
  canAffordUpgrade,
  nextUpgradeCost,
  UPGRADE_DEFINITIONS,
  upgradeLevel
} from "/shared/upgrades.js";
import {
  huckRockHullNative,
  stormBoundaryRunsNative,
  stormPatternRowsNative,
  stormLayerNative,
  stormRunsNative,
  visibilityCheckerLayerNative,
  visibilitySpansFromGridNative,
  visibilitySpansNative
} from "/shared/core/bitspace-core.js";

const ENTITY_PIXEL_SIZE = 1;
const CANVAS_EDGE_PADDING_EM = 1;
const MIN_RENDER_ASPECT = 2 / 3;
const MAX_RENDER_ASPECT = 3 / 2;
const WORLD_LENS_EDGE_SCALE = RENDER.lensEdgeScale || 1;
const WORLD_LENS_POWER = RENDER.lensPower || 2;
const WORLD_LENS_NOISE_RADIAL = 0.28;
const WORLD_LENS_NOISE_TANGENTIAL = 0.16;
const WORLD_LENS_DEFECT_DENSITY = 1.65;
const STAR_CELL_SIZE = 13;
const STAR_PARALLAX = 0.22;
const MENU_STAR_SEED = "bitspace-menu";
const MENU_STAR_SCROLL_SPEED = 12;
const ASTEROID_DASH_PERIOD = 10;
const ASTEROID_DASH_ON = 5;
const BUILD_DASH_PERIOD = 8;
const BUILD_DASH_ON = 4;
const BUILD_PREVIEW_GAP = 1;
const STORM_NOISE_SCALE = 0.15;
const STORM_NOISE_THRESHOLD = 0.34;
const STORM_BOUNDARY_NOISE_THRESHOLD = 0;
const STORM_NOISE_SPEED_X = -2;
const STORM_NOISE_SPEED_Y = 5;
const STORM_NOISE_SPEED_Z = 0.1;
const STORM_PATTERN_FPS = 20;
const STORM_PATTERN_MAX_CACHE = 4096;
const ASTEROID_VISIBILITY_EXPERIMENT = true;
const ASTEROID_VISIBILITY_BASE_RAYS = 96;
const ASTEROID_VISIBILITY_ANGLE_EPSILON = 0.0008;
const ASTEROID_VISIBILITY_DILATE_PIXELS = 1;
const GPU_VISIBILITY_MASK_SPANS_PER_ROW = 64;
const ASTEROID_VISIBILITY_CORNER = Object.freeze({
  topLeft: 1,
  topRight: 2,
  bottomRight: 4,
  bottomLeft: 8
});
const ASTEROID_VISIBILITY_ALL_CORNERS =
  ASTEROID_VISIBILITY_CORNER.topLeft |
  ASTEROID_VISIBILITY_CORNER.topRight |
  ASTEROID_VISIBILITY_CORNER.bottomRight |
  ASTEROID_VISIBILITY_CORNER.bottomLeft;
const ASTEROID_VISIBILITY_FULL_CIRCLE = Math.PI * 2;
const STORM_WARNING_BUFFER_OFFSETS = Object.freeze([
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
]);
const ROCK_OUTER_CORNER_RADIUS = Math.round(RENDER.tileSize / 3);
const ROCK_INNER_CORNER_RADIUS = 1;
const ASTEROID_VISIBILITY_OUTER_BEVEL_RADIUS = Math.max(2, Math.ceil(ROCK_OUTER_CORNER_RADIUS * 0.5));
const SMALL_ORB_RADIUS = 3;
const REAR_ORBS = Object.freeze([
  { rear: 7, side: -5, layer: "back" },
  { rear: 7, side: 5, layer: "back" },
  { rear: 9, side: 0, layer: "front" }
]);
const SHIP_SPHERE_DITHER = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
]);
const SHIP_SPHERE_LIGHT = Object.freeze(normalize3d(-0.42, -0.58, 0.7));
const SHIP_VISUAL_ROTATION_SPEED = Math.PI * 4;
const THRUSTER_PARTICLE_RATE = 500;
const THRUSTER_ENGINE_UPGRADE_ID = "speed";
const THRUSTER_ENGINE_MAX_LEVEL =
  UPGRADE_DEFINITIONS.find((upgrade) => upgrade.id === THRUSTER_ENGINE_UPGRADE_ID)?.maxLevel || 5;
const THRUSTER_ENGINE_RAMP = Object.freeze({
  rateMin: 1,
  rateMax: 2,
  plumeSpeedMin: 0.5,
  plumeSpeedMax: 1,
  lifeMin: 1,
  lifeMax: 1,
  nozzleMin: 0.5,
  nozzleMax: 0.67,
});
const MINING_PARTICLE_RATE = 150;
const MINING_RAY_VISUAL_RADIUS = 2;
const MINING_RAY_SIDE_WAVE_AMPLITUDE = 0.5;
const MINING_RAY_SIDE_WAVE_LENGTH = 9;
const MINING_RAY_SIDE_WAVE_SPEED = 18;
const MINING_RAY_EMITTER_RADIUS = 1;
const MINING_RAY_EMITTER_LENGTH = 8;
const MINING_RAY_HIT_FLARE_RADIUS = 3;
const HUD_FLASH_MODE = Object.freeze({
  additive: "additive",
  subtractive: "subtractive"
});
const HUD_FLASH_RATE = Object.freeze({
  slow: 4,
  fast: 14
});
const HUD_PANEL_MIN_WIDTH = 112;
const HUD_PANEL_PADDING = 4;
const HUD_PANEL_TEXT_HEIGHT = 7;
const HUD_PANEL_ROW_STEP = 10;
const HUD_PANEL_ACTION_GAP = 7;
const HUD_CONTROL_TEXT_BORDER = Object.freeze({
  borderTransparentAsBacking: true
});
const MOBILE_UPGRADE_CLOSE_ACTION = Object.freeze({
  gap: 7,
  width: 52,
  height: 13
});
const ENDED_HUD_LAYOUT = Object.freeze({
  x: 8,
  y: 8,
  width: HUD_PANEL_MIN_WIDTH,
  titleY: HUD_PANEL_PADDING,
  headerY: HUD_PANEL_PADDING + 14,
  rowStartY: HUD_PANEL_PADDING + 24,
  rowStep: HUD_PANEL_ROW_STEP,
  rowHighlightHeight: 9,
  countdownGap: HUD_PANEL_PADDING,
  bottomPadding: HUD_PANEL_PADDING
});
const REMOTE_PLAYER_LOOKAHEAD_SECONDS = 0.08;
const REMOTE_PLAYER_MAX_EXTRAPOLATION_SECONDS = 0.14;
const ORE_RING_STEPS = 16;
const ORE_MINING_ROTATION = 0.26;
const ORE_OCCLUSION_PADDING = 0.85;
const BOT_CHUNK_MAP_DOT_SIZE = 1;
const BOT_CHUNK_MAP_DOT_GAP = 1;
const BOT_CHUNK_MAP_ACTIVE_SIZE = 3;
const BOT_CHUNK_MAP_HEAT_SIZE = 2;
const PLAYER_MAP_CELL_SIZE = 1;
const PLAYER_MAP_COMPACT_SAMPLE_TILES = 2;
const PLAYER_MAP_COMPACT_OUTER_STORM_BORDER = 4;
const PLAYER_MAP_FALLBACK_SIZE = 128;
const PLAYER_MAP_RENDER_SCALE = 3;
const PLAYER_MAP_CSS_SCALE = 1;
const PLAYER_MAP_MINI_SHIP_SCALE = 0.6;
const PLAYER_MAP_MINI_SHIP_OUTLINE = 3;
const PLAYER_MAP_MARGIN = 8;
const PLAYER_MAP_CIRCLE_PADDING_TILES = 4;
const PLAYER_MAP_STORM_NONE = 0;
const PLAYER_MAP_STORM_BAND = 1;
const ASTEROID_VISIBILITY_CHECKER_SIZE = 2;
const playerMapArenaCircleCache = new WeakMap();
const playerMapStormMaskCache = new WeakMap();
const PLAYER_MAP_CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 0, y: 1 })
]);
const BOT_DEBUG_PANEL = Object.freeze({
  x: 8,
  y: 8,
  width: 220,
  padding: 5,
  titleHeight: 11,
  lineHeight: 9
});
const BOT_DEBUG_COLORS = Object.freeze({
  panelBackground: "#060910",
  panelBorder: "#65ceff",
  title: "#ffe066",
  text: "#d7f5ff",
  muted: "#7894a8",
  path: "#32d6ff",
  pathDone: "#465d73",
  pathActive: "#ffe066",
  pathInvalid: "#ff3355",
  mineable: "#ff8f3d",
  player: "#ffffff",
  mining: "#ff4d6d"
});
const stormNoiseCache = new Map();
const stormPatternCache = new Map();
let stormPatternCacheFrame = null;
let stormOverlayLayerCache = null;
let stormBoundaryRunCache = null;
const stormGpuPermutationCache = new Map();
const huckRockShapeCache = new Map();
const HUCK_ROCK_SHAPE_CACHE_MAX = 512;
const asteroidBoundaryContourCache = new WeakMap();
let playerMapScratchCanvas = null;
let playerMapScratchContext = null;

function playerMapCompactCellSize() {
  return PLAYER_MAP_CELL_SIZE / Math.max(1, PLAYER_MAP_COMPACT_SAMPLE_TILES);
}

function playerMapCompactRadius(mapCircle) {
  return mapCircle.radius * playerMapCompactCellSize() + PLAYER_MAP_COMPACT_OUTER_STORM_BORDER;
}

function playerMapCompactDiameter(mapCircle) {
  return Math.max(1, Math.ceil(playerMapCompactRadius(mapCircle)) * 2);
}

class PixelDivider {
  constructor({ sidePadding = 0, thickness = 1 } = {}) {
    this.sidePadding = sidePadding;
    this.thickness = thickness;
  }

  draw(ctx, panel, y, colors) {
    const left = Math.round(panel.x + this.sidePadding);
    const right = Math.round(panel.x + panel.width - this.sidePadding);
    const width = Math.max(0, right - left);
    if (width <= 0) {
      return;
    }

    ctx.fillStyle = colors.foreground;
    ctx.fillRect(left, Math.round(y), width, this.thickness);
  }
}

const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 70,
  padding: 8,
  titleTop: 8,
  rowTopOffset: 20,
  rowHeight: 16,
  rowInset: 8,
  labelOffset: 14,
  rowHighlightPadding: 2,
  rowTextInset: 4,
  rowTextHeight: 7,
  columnGap: 8,
  dividerTopGap: 5,
  dividerBottomGap: 5,
  detailLineHeight: 12,
  detailLineCount: 4,
  bottomPadding: 8
});
const UPGRADE_MENU_DIVIDER = new PixelDivider({
  sidePadding: UPGRADE_MENU_LAYOUT.padding
});
const BITMAP_GLYPHS = Object.freeze({
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["010", "110", "010", "010", "010", "010", "111"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["0", "0", "0", "0", "0", "0", "1"],
  ",": ["0", "0", "0", "0", "0", "1", "1"],
  "!": ["1", "1", "1", "1", "1", "0", "1"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "'": ["1", "1", "0", "0", "0", "0", "0"],
  "\"": ["101", "101", "000", "000", "000", "000", "000"],
  "-": ["0000", "0000", "0000", "1111", "0000", "0000", "0000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ":": ["0", "1", "0", "0", "0", "1", "0"],
  ";": ["0", "1", "0", "0", "0", "1", "1"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
  "(": ["001", "010", "100", "100", "100", "010", "001"],
  ")": ["100", "010", "001", "001", "001", "010", "100"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "01010"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "=": ["00000", "11111", "00000", "00000", "11111", "00000", "00000"],
  "@": ["01110", "10001", "10111", "10101", "10111", "10000", "01111"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "⌂": ["0001000", "0010100", "0100010", "1111111", "0100010", "0101010", "0111110"]
});
export function createRenderer(canvas, minimapCanvas = null) {
  const canvasContext = canvas.getContext("2d", { alpha: false });
  const minimapContext = minimapCanvas?.getContext("2d") || null;
  const presentCanvas = createScenePresentCanvas(canvas);
  let surface = null;
  let overlaySurface = null;
  let hudSurface = null;
  let textRenderer = null;
  const colors = {
    foreground: RENDER.foreground,
    background: RENDER.background,
    backing: "#000000"
  };
  const particles = [];
  const miningParticles = [];
  const emitCarry = new Map();
  let minimapSurface = null;
  let minimapTextRenderer = null;
  let particleSeed = 1;
  let lastFrameTime = null;
  let minimapExpanded = false;
  let minimapVisible = false;
  let minimapMapState = null;
  let minimapAsteroid = null;
  let minimapSizeKey = "";
  let gpuStormRenderer = null;
  let framePresenter = null;
  const visualShipAngles = new Map();

  function sizeCanvasBox() {
    const viewport = getViewportSize();
    resizeRenderSurface(viewport);
    resizeMinimapSurface(viewport);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    if (presentCanvas) {
      presentCanvas.style.width = `${viewport.width}px`;
      presentCanvas.style.height = `${viewport.height}px`;
    }
    if (minimapCanvas) {
      minimapCanvas.style.display = minimapVisible ? "block" : "none";
      if (!minimapVisible) {
        return;
      }
      const minimapRect = minimapCssRect(viewport);
      minimapCanvas.style.left = `${minimapRect.left}px`;
      minimapCanvas.style.top = `${minimapRect.top}px`;
      minimapCanvas.style.width = `${minimapRect.width}px`;
      minimapCanvas.style.height = `${minimapRect.height}px`;
    }
  }

  function resizeRenderSurface(viewport = getViewportSize()) {
    const size = renderSizeForViewport(viewport);
    if (canvas.width === size.width && canvas.height === size.height && surface && textRenderer) {
      syncFramePresenterVisibility();
      return;
    }

    canvas.width = size.width;
    canvas.height = size.height;
    surface = createPixelSurface(canvasContext, size.width, size.height);
    overlaySurface = createPixelSurface(canvasContext, size.width, size.height);
    hudSurface = createPixelSurface(canvasContext, size.width, size.height);
    textRenderer = createPixelTextRenderer(size.width, size.height, () => colors);
    gpuStormRenderer = createGpuStormRenderer(size.width, size.height);
    framePresenter = createGpuFramePresenter(presentCanvas, size.width, size.height);
    syncFramePresenterVisibility();
  }

  function syncFramePresenterVisibility() {
    const gpuPresent = Boolean(framePresenter);
    if (presentCanvas) {
      presentCanvas.style.display = gpuPresent ? "block" : "none";
    }
    canvas.style.opacity = gpuPresent ? "0" : "1";
    canvas.style.pointerEvents = gpuPresent ? "none" : "";
  }

  function resizeMinimapSurface(viewport = getViewportSize()) {
    if (!minimapCanvas) {
      return;
    }

    const { width, height } = minimapSurfaceSize(viewport);
    if (
      minimapCanvas.width === width &&
      minimapCanvas.height === height &&
      minimapSurface &&
      minimapTextRenderer
    ) {
      return;
    }

    minimapCanvas.width = width;
    minimapCanvas.height = height;
    minimapSurface = createPixelSurface(minimapContext, width, height);
    minimapTextRenderer = createPixelTextRenderer(width, height, () => colors);
    if (minimapContext) {
      minimapContext.imageSmoothingEnabled = false;
    }
  }

  function minimapSurfaceSize(viewport = getViewportSize()) {
    if (minimapMapState?.cells && minimapAsteroid) {
      return fullPlayerMapSurfaceSize(minimapMapState, minimapAsteroid);
    }

    return {
      width: PLAYER_MAP_FALLBACK_SIZE,
      height: PLAYER_MAP_FALLBACK_SIZE
    };
  }

  function fullPlayerMapSurfaceSize(mapState, asteroid) {
    const mapCircle = playerMapArenaCircle(mapState, asteroid);
    const diameter = playerMapCompactDiameter(mapCircle) * PLAYER_MAP_RENDER_SCALE;
    return { width: diameter, height: diameter };
  }

  function fullPlayerMapSurfaceKey(mapState, asteroid) {
    if (!mapState?.cells || !asteroid) {
      return "";
    }

    const mapCircle = playerMapArenaCircle(mapState, asteroid);
    return [
      mapState.widthChunks,
      mapState.heightChunks,
      mapState.chunkTiles,
      PLAYER_MAP_COMPACT_SAMPLE_TILES,
      PLAYER_MAP_CELL_SIZE,
      PLAYER_MAP_RENDER_SCALE,
      asteroid.widthTiles,
      asteroid.heightTiles,
      playerMapCompactDiameter(mapCircle)
    ].join(":");
  }

  function minimapCssRect(viewport = getViewportSize()) {
    const sceneRect = sceneContentRect(viewport);
    const { width, height } = minimapSurfaceSize(viewport);
    const cssWidth = width * PLAYER_MAP_CSS_SCALE;
    const cssHeight = height * PLAYER_MAP_CSS_SCALE;
    return {
      left: Math.round(sceneRect.left + sceneRect.width - cssWidth),
      top: Math.round(sceneRect.top),
      width: cssWidth,
      height: cssHeight
    };
  }

  function sceneContentRect(viewport = getViewportSize()) {
    const padding = canvasEdgePaddingPx();
    const scale = Math.min(viewport.width / canvas.width, viewport.height / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    return {
      left: padding + (viewport.width - width) / 2,
      top: padding + (viewport.height - height) / 2,
      width,
      height,
      scale
    };
  }

  sizeCanvasBox();
  window.addEventListener("resize", sizeCanvasBox);
  window.visualViewport?.addEventListener("resize", sizeCanvasBox);
  window.visualViewport?.addEventListener("scroll", sizeCanvasBox);

  return {
    draw(snapshot, options = {}) {
      const nextMinimapVisible = options.playerMapVisible === true &&
        Boolean(options.playerMap?.cells) &&
        Boolean(options.asteroid);
      const nextMinimapExpanded = nextMinimapVisible && options.playerMapLarge === true;
      const nextMinimapMapState = nextMinimapVisible ? options.playerMap : null;
      const nextMinimapAsteroid = nextMinimapVisible ? options.asteroid : null;
      const nextMinimapSizeKey = nextMinimapVisible
        ? fullPlayerMapSurfaceKey(options.playerMap, options.asteroid)
        : "";
      minimapMapState = nextMinimapMapState;
      minimapAsteroid = nextMinimapAsteroid;
      if (
        nextMinimapExpanded !== minimapExpanded ||
        nextMinimapVisible !== minimapVisible ||
        nextMinimapSizeKey !== minimapSizeKey
      ) {
        minimapExpanded = nextMinimapExpanded;
        minimapVisible = nextMinimapVisible;
        minimapSizeKey = nextMinimapSizeKey;
        sizeCanvasBox();
      }
      resizeRenderSurface();
      resizeMinimapSurface();
      const timeSeconds = options.timeSeconds ?? snapshot?.tick / 60 ?? performance.now() / 1000;
      const dtSeconds =
        lastFrameTime === null ? 1 / 60 : clamp(timeSeconds - lastFrameTime, 0, 1 / 15);
      lastFrameTime = timeSeconds;

      if (snapshot?.render) {
        colors.foreground = snapshot.render.foreground || colors.foreground;
        colors.background = snapshot.render.background || colors.background;
      }
      if (options.theme) {
        colors.foreground = options.theme.foreground || colors.foreground;
        colors.background = options.theme.background || colors.background;
        colors.backing = options.theme.backing || colors.backing;
      }
      const frameOptions = {
        ...options,
        timeSeconds,
        dtSeconds,
        visualShipAngles,
        gpuStormRenderer,
        gpuFrameStormReady: framePresenter?.supportsStorm === true,
        gpuFrameCheckerReady: framePresenter?.supportsChecker === true
      };
      const frameParticleState = {
        particles,
        miningParticles,
        emitCarry,
        nextSeed() {
          particleSeed += 1;
          return particleSeed;
        }
      };
      const measurePerf = options.measurePerf === true;
      const perf = measurePerf
        ? {
          drawMs: 0,
          presentMs: 0,
          minimapMs: 0,
          stormGpuMs: 0,
          stormGpuReadMs: 0,
          stormGpuCalls: 0,
          stormGpuRequests: 0,
          visibilityGpuMs: 0,
          visibilityGpuReadMs: 0,
          visibilityGpuCalls: 0,
          visibilityGpuRequests: 0,
          stormGpuReady: Boolean(gpuStormRenderer),
          frameGpuReady: Boolean(framePresenter),
          frameStormReady: framePresenter?.supportsStorm === true,
          frameCheckerReady: framePresenter?.supportsChecker === true,
          buckets: null
        }
        : null;

      gpuStormRenderer?.beginFrame?.();
      const drawStart = measurePerf ? performance.now() : 0;
      const sharedRenderState = {};
      const worldFrameOptions = {
        ...frameOptions,
        renderPhase: "worldBase",
        renderState: sharedRenderState
      };
      drawFrame(surface, snapshot, worldFrameOptions, colors, textRenderer, frameParticleState);
      const worldBuckets = worldFrameOptions.perfBuckets || null;
      overlaySurface?.clear?.();
      const overlayFrameOptions = {
        ...frameOptions,
        renderPhase: "worldOverlay",
        transparentBacking: true,
        renderState: sharedRenderState
      };
      drawFrame(overlaySurface, snapshot, overlayFrameOptions, colors, textRenderer, frameParticleState);
      const overlayBuckets = overlayFrameOptions.perfBuckets || null;
      hudSurface?.clear?.();
      const hudFrameOptions = {
        ...frameOptions,
        renderPhase: "hud",
        transparentBacking: true,
        renderState: sharedRenderState
      };
      drawFrame(hudSurface, snapshot, hudFrameOptions, colors, textRenderer, frameParticleState);
      const hudBuckets = hudFrameOptions.perfBuckets || null;
      if (worldBuckets) {
        mergeFramePerfBuckets(worldBuckets, overlayBuckets, hudBuckets);
      }
      if (measurePerf) {
        perf.drawMs = performance.now() - drawStart;
        perf.buckets = worldBuckets || hudBuckets || null;
        const stormStats = gpuStormRenderer?.frameStats?.();
        perf.stormGpuMs = stormStats?.totalMs || 0;
        perf.stormGpuReadMs = stormStats?.readMs || 0;
        perf.stormGpuCalls = stormStats?.calls || 0;
        perf.stormGpuRequests = stormStats?.requests || 0;
        perf.visibilityGpuMs = stormStats?.visibilityTotalMs || 0;
        perf.visibilityGpuReadMs = stormStats?.visibilityReadMs || 0;
        perf.visibilityGpuCalls = stormStats?.visibilityCalls || 0;
        perf.visibilityGpuRequests = stormStats?.visibilityRequests || 0;
      }
      const presentStart = measurePerf ? performance.now() : 0;
      surface.present(framePresenter, [overlaySurface, hudSurface]);
      if (measurePerf) {
        perf.presentMs = performance.now() - presentStart;
      }
      if (!minimapVisible) {
        return perf;
      }

      const minimapStart = measurePerf ? performance.now() : 0;
      if (options.playerMapLarge) {
        drawGameLensOverlay(
          minimapSurface,
          snapshot,
          frameOptions,
          colors,
          minimapTextRenderer,
          frameParticleState
        );
        minimapSurface?.present();
      } else {
        drawMinimapOverlay(
          minimapContext,
          minimapCanvas?.width ?? canvas.width,
          minimapCanvas?.height ?? canvas.height,
          options.playerMap,
          options.asteroid,
          colors,
          timeSeconds
        );
      }
      if (measurePerf) {
        perf.minimapMs = performance.now() - minimapStart;
      }
      return perf;
    }
  };
}

function createScenePresentCanvas(sourceCanvas) {
  if (!sourceCanvas?.parentNode || typeof document === "undefined") {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.id = "scene-present";
  canvas.setAttribute("aria-hidden", "true");
  sourceCanvas.after(canvas);
  return canvas;
}

function renderSizeForViewport(viewport) {
  if (typeof document !== "undefined" && document.body?.classList.contains("mobile-controls")) {
    const diameter = Math.min(RENDER.width, RENDER.height);
    return {
      width: diameter,
      height: diameter
    };
  }

  const aspect = clamp(viewport.width / Math.max(1, viewport.height), MIN_RENDER_ASPECT, MAX_RENDER_ASPECT);
  const diameter = Math.min(RENDER.width, RENDER.height);
  if (aspect >= 1) {
    return {
      width: roundEven(diameter * aspect),
      height: diameter
    };
  }

  return {
    width: diameter,
    height: roundEven(diameter / aspect)
  };
}

function roundEven(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function createPixelSurface(canvasContext, width, height) {
  const imageData = canvasContext.createImageData(width, height);
  const pixels = new Uint32Array(imageData.data.buffer);
  const colorCache = new Map();
  const circleClip = createCircleClipSpans(width, height);
  const circleBorderSpanCache = new Map([[0, circleClip]]);
  const lensProjectionCache = new Map();
  let currentColor = packColor(RENDER.foreground);
  let activeClip = null;
  let activeLens = null;
  let activeWorldMask = null;
  let queuedGpuStormLayers = [];
  let queuedGpuCheckerLayer = null;

  function circleSpansForInset(inset) {
    const key = Math.max(0, Math.floor(inset));
    let spans = circleBorderSpanCache.get(key);
    if (!spans) {
      spans = createCircleClipSpans(width, height, key);
      circleBorderSpanCache.set(key, spans);
    }
    return spans;
  }

  function lensProjectionFor(lens) {
    if (!lens) {
      return null;
    }

    const sourcePadding = Math.max(0, Math.floor(lens.sourcePadding || 0));
    const key = [
      sourcePadding,
      lens.centerX,
      lens.centerY,
      lens.maxSourceRadius,
      lens.edgeScale,
      lens.power,
      lens.noiseRadial,
      lens.noiseTangential
    ].join(":");
    let projection = lensProjectionCache.get(key);
    if (projection) {
      return projection;
    }

    const sourceWidth = width + sourcePadding * 2;
    const sourceHeight = height + sourcePadding * 2;
    const count = sourceWidth * sourceHeight;
    const invalid = -32768;
    const baseX = new Int16Array(count);
    const baseY = new Int16Array(count);
    const x = new Int16Array(count);
    const y = new Int16Array(count);
    baseX.fill(invalid);
    baseY.fill(invalid);
    x.fill(invalid);
    y.fill(invalid);

    let index = 0;
    for (let sourceY = -sourcePadding; sourceY < height + sourcePadding; sourceY += 1) {
      for (let sourceX = -sourcePadding; sourceX < width + sourcePadding; sourceX += 1) {
        const projected = projectLensPixel(sourceX, sourceY, lens);
        if (projected && canWriteFinalPixel(projected.x, projected.y)) {
          baseX[index] = projected.baseX;
          baseY[index] = projected.baseY;
          x[index] = projected.x;
          y[index] = projected.y;
        }
        index += 1;
      }
    }

    projection = {
      sourcePadding,
      sourceWidth,
      sourceHeight,
      invalid,
      baseX,
      baseY,
      x,
      y
    };
    lensProjectionCache.set(key, projection);
    return projection;
  }

  function lensProjectionIndex(projection, x, y) {
    const sourceX = x + projection.sourcePadding;
    const sourceY = y + projection.sourcePadding;
    if (
      sourceX < 0 ||
      sourceY < 0 ||
      sourceX >= projection.sourceWidth ||
      sourceY >= projection.sourceHeight
    ) {
      return -1;
    }

    return sourceY * projection.sourceWidth + sourceX;
  }

  function lensProjectedPoint(projection, index) {
    if (index < 0 || projection.x[index] === projection.invalid) {
      return null;
    }

    return {
      baseX: projection.baseX[index],
      baseY: projection.baseY[index],
      x: projection.x[index],
      y: projection.y[index]
    };
  }

  function writeMappedProjectedPoint(projection, index, color = currentColor) {
    if (index < 0 || projection.x[index] === projection.invalid) {
      return false;
    }

    const projectedBaseX = projection.baseX[index];
    const projectedBaseY = projection.baseY[index];
    const projectedX = projection.x[index];
    const projectedY = projection.y[index];
    let wrote = false;
    if (projectedBaseX !== projectedX || projectedBaseY !== projectedY) {
      wrote = writeProjectedPoint(projectedBaseX, projectedBaseY, color) || wrote;
    }

    return writeProjectedPoint(projectedX, projectedY, color) || wrote;
  }

  function canWriteFinalPixel(x, y) {
    return x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height &&
      (!activeClip || (x >= activeClip.starts[y] && x < activeClip.ends[y]));
  }

  function writeProjectedPixel(projected, color = currentColor) {
    if (!projected) {
      return false;
    }

    let wrote = false;
    if (projected.baseX !== projected.x || projected.baseY !== projected.y) {
      wrote = writeProjectedPoint(projected.baseX, projected.baseY, color) || wrote;
    }

    return writeProjectedPoint(projected.x, projected.y, color) || wrote;
  }

  function writeProjectedPoint(x, y, color = currentColor) {
    if (!canWriteFinalPixel(x, y)) {
      return false;
    }

    pixels[y * width + x] = color;
    return true;
  }

  function writeProjectedBridge(from, to, color = currentColor) {
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - from.x);
    const dy = -Math.abs(to.y - from.y);
    const stepX = from.x < to.x ? 1 : -1;
    const stepY = from.y < to.y ? 1 : -1;
    let error = dx + dy;

    while (true) {
      if (canWriteFinalPixel(x, y)) {
        pixels[y * width + x] = color;
      }

      if (x === to.x && y === to.y) {
        break;
      }

      const doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  }

  function forWorldMaskRanges(y, start, end, callback) {
    if (start >= end) {
      return true;
    }

    if (!activeWorldMask) {
      callback(start, end);
      return true;
    }

    const rows = activeWorldMask.spans?.rows;
    if (!Array.isArray(rows)) {
      return false;
    }

    const spans = rows[y - (activeWorldMask.spans.offsetY || 0)];
    if (!Array.isArray(spans)) {
      return true;
    }

    for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 2) {
      const rangeStart = Math.max(start, spans[spanIndex]);
      const rangeEnd = Math.min(end, spans[spanIndex + 1]);
      if (rangeStart < rangeEnd) {
        callback(rangeStart, rangeEnd);
      }
    }
    return true;
  }

  return {
    width,
    height,
    imageSmoothingEnabled: false,
    set fillStyle(value) {
      currentColor = colorFor(value, colorCache);
    },
    get fillStyle() {
      return currentColor;
    },
    beginCircleClip() {
      activeClip = circleClip;
    },
    beginLens(lens) {
      activeLens = lensProjectionFor(lens);
    },
    endLens() {
      activeLens = null;
    },
    beginWorldMask(mask) {
      activeWorldMask = mask || null;
    },
    endWorldMask() {
      activeWorldMask = null;
    },
    withoutWorldMask(callback) {
      const previous = activeWorldMask;
      activeWorldMask = null;
      try {
        return callback();
      } finally {
        activeWorldMask = previous;
      }
    },
    endClip() {
      activeClip = null;
    },
    clear() {
      queuedGpuStormLayers = [];
      queuedGpuCheckerLayer = null;
      pixels.fill(0);
    },
    getImageData() {
      return imageData;
    },
    getPixelColor(x, y) {
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= width || py >= height) {
        return null;
      }

      return pixels[py * width + px];
    },
    queueGpuStormLayer(layer) {
      if (!layer) {
        return false;
      }
      queuedGpuStormLayers.push(layer);
      return true;
    },
    queueGpuCheckerLayer(layer) {
      if (!layer) {
        return false;
      }
      queuedGpuCheckerLayer = layer;
      return true;
    },
    drawCircleBorder(color, thickness = 1, inset = 0) {
      const packed = colorFor(color || RENDER.background, colorCache);
      const line = Math.max(1, Math.floor(thickness));
      const offset = Math.max(0, Math.floor(inset));
      const outer = circleSpansForInset(offset);
      const inner = circleSpansForInset(offset + line);
      for (let y = 0; y < height; y += 1) {
        const outerStart = outer.starts[y];
        const outerEnd = outer.ends[y];
        if (outerStart >= outerEnd) {
          continue;
        }

        const row = y * width;
        const innerStart = inner.starts[y];
        const innerEnd = inner.ends[y];
        const leftEnd = Math.min(outerEnd, innerStart);
        for (let x = outerStart; x < leftEnd; x += 1) {
          pixels[row + x] = packed;
        }

        const rightStart = Math.max(outerStart, innerEnd);
        for (let x = rightStart; x < outerEnd; x += 1) {
          pixels[row + x] = packed;
        }
      }
    },
    fillRect(x, y, rectWidth, rectHeight) {
      const rawX0 = Math.floor(x);
      const rawY0 = Math.floor(y);
      const rawX1 = Math.ceil(x + rectWidth);
      const rawY1 = Math.ceil(y + rectHeight);

      if (activeLens) {
        const sourcePadding = activeLens.sourcePadding || 0;
        const x0 = Math.max(-sourcePadding, rawX0);
        const y0 = Math.max(-sourcePadding, rawY0);
        const x1 = Math.min(width + sourcePadding, rawX1);
        const y1 = Math.min(height + sourcePadding, rawY1);

        if (x0 >= x1 || y0 >= y1) {
          return;
        }

        const isThinStroke = (x1 - x0 === 1 && y1 - y0 > 1) ||
          (y1 - y0 === 1 && x1 - x0 > 1);
        if (isThinStroke) {
          const isVerticalStroke = x1 - x0 === 1;
          let previous = null;
          for (let py = y0; py < y1; py += 1) {
            let wroteMaskedRange = false;
            if (forWorldMaskRanges(py, x0, x1, (rangeStart, rangeEnd) => {
              for (let px = rangeStart; px < rangeEnd; px += 1) {
                const index = lensProjectionIndex(activeLens, px, py);
                const projected = lensProjectedPoint(activeLens, index);
                if (!writeProjectedPixel(projected)) {
                  previous = null;
                  continue;
                }

                if (previous) {
                  writeProjectedBridge(previous, projected);
                }
                previous = projected;
              }
              wroteMaskedRange = true;
              if (!isVerticalStroke) {
                previous = null;
              }
            })) {
              if (!wroteMaskedRange) {
                previous = null;
              }
              continue;
            }

            for (let px = x0; px < x1; px += 1) {
              if (activeWorldMask?.allows && !activeWorldMask.allows(px, py)) {
                previous = null;
                continue;
              }
              const index = lensProjectionIndex(activeLens, px, py);
              const projected = lensProjectedPoint(activeLens, index);
              if (!writeProjectedPixel(projected)) {
                previous = null;
                continue;
              }

              if (previous) {
                writeProjectedBridge(previous, projected);
              }
              previous = projected;
            }
          }
          return;
        }

        for (let py = y0; py < y1; py += 1) {
          if (forWorldMaskRanges(py, x0, x1, (rangeStart, rangeEnd) => {
            for (let px = rangeStart; px < rangeEnd; px += 1) {
              writeMappedProjectedPoint(activeLens, lensProjectionIndex(activeLens, px, py));
            }
          })) {
            continue;
          }

          for (let px = x0; px < x1; px += 1) {
            if (!activeWorldMask?.allows || activeWorldMask.allows(px, py)) {
              writeMappedProjectedPoint(activeLens, lensProjectionIndex(activeLens, px, py));
            }
          }
        }
        return;
      }

      const x0 = Math.max(0, rawX0);
      const y0 = Math.max(0, rawY0);
      const x1 = Math.min(width, rawX1);
      const y1 = Math.min(height, rawY1);

      if (x0 >= x1 || y0 >= y1) {
        return;
      }

      if (activeClip) {
        for (let py = y0; py < y1; py += 1) {
          const start = Math.max(x0, activeClip.starts[py]);
          const end = Math.min(x1, activeClip.ends[py]);
          if (start >= end) {
            continue;
          }

          const row = py * width;
          if (forWorldMaskRanges(py, start, end, (rangeStart, rangeEnd) => {
            for (let px = rangeStart; px < rangeEnd; px += 1) {
              pixels[row + px] = currentColor;
            }
          })) {
            continue;
          }

          for (let px = start; px < end; px += 1) {
            if (activeWorldMask?.allows && !activeWorldMask.allows(px, py)) {
              continue;
            }
            pixels[row + px] = currentColor;
          }
        }
        return;
      }

      if (!activeWorldMask && x0 === 0 && y0 === 0 && x1 === width && y1 === height) {
        pixels.fill(currentColor);
        return;
      }

      for (let py = y0; py < y1; py += 1) {
        const row = py * width;
        if (forWorldMaskRanges(py, x0, x1, (rangeStart, rangeEnd) => {
          pixels.fill(currentColor, row + rangeStart, row + rangeEnd);
        })) {
          continue;
        }

        for (let px = x0; px < x1; px += 1) {
          if (activeWorldMask?.allows && !activeWorldMask.allows(px, py)) {
            continue;
          }
          pixels[row + px] = currentColor;
        }
      }
    },
    drawCodeLayer(codes, palette = {}) {
      if (!codes || codes.length < width * height) {
        return;
      }
      const background = colorFor(palette.background || RENDER.background, colorCache);
      const foreground = colorFor(palette.foreground || RENDER.foreground, colorCache);
      const backing = colorFor(palette.backing || "#000000", colorCache);
      const codeColors = [0, background, foreground, backing];
      const maskSpans = activeWorldMask?.spans?.rows;
      if (Array.isArray(maskSpans)) {
        const offsetY = activeWorldMask.spans.offsetY || 0;
        for (let y = 0; y < height; y += 1) {
          if (activeClip && (activeClip.starts[y] >= activeClip.ends[y])) {
            continue;
          }

          const spans = maskSpans[y - offsetY];
          if (!Array.isArray(spans)) {
            continue;
          }

          const row = y * width;
          for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 2) {
            const start = Math.max(0, activeClip ? activeClip.starts[y] : 0, spans[spanIndex]);
            const end = Math.min(width, activeClip ? activeClip.ends[y] : width, spans[spanIndex + 1]);
            for (let x = start; x < end; x += 1) {
              const color = codeColors[codes[row + x]] || 0;
              if (color) {
                pixels[row + x] = color;
              }
            }
          }
        }
        return;
      }

      const count = width * height;
      let index = 0;
      while (index < count) {
        const code = codes[index];
        const color = codeColors[code] || 0;
        if (!color) {
          index += 1;
          continue;
        }

        const start = index;
        index += 1;
        while (index < count && codes[index] === code) {
          index += 1;
        }
        pixels.fill(color, start, index);
      }
    },
    drawCodeRuns(runs, palette = {}) {
      if (!runs || runs.length < 4) {
        return;
      }
      const background = colorFor(palette.background || RENDER.background, colorCache);
      const foreground = colorFor(palette.foreground || RENDER.foreground, colorCache);
      const backing = colorFor(palette.backing || "#000000", colorCache);
      const codeColors = [0, background, foreground, backing];
      const maskSpans = activeWorldMask?.spans?.rows;
      const maskOffsetY = activeWorldMask?.spans?.offsetY || 0;
      for (let index = 0; index + 3 < runs.length; index += 4) {
        const y = runs[index];
        if (y < 0 || y >= height) {
          continue;
        }

        const color = codeColors[runs[index + 3]] || 0;
        if (!color) {
          continue;
        }

        const row = y * width;
        let start = Math.max(0, runs[index + 1]);
        let end = Math.min(width, runs[index + 2]);
        if (activeClip) {
          start = Math.max(start, activeClip.starts[y]);
          end = Math.min(end, activeClip.ends[y]);
        }
        if (start >= end) {
          continue;
        }

        if (!Array.isArray(maskSpans)) {
          pixels.fill(color, row + start, row + end);
          continue;
        }

        const spans = maskSpans[y - maskOffsetY];
        if (!Array.isArray(spans)) {
          continue;
        }
        for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 2) {
          const clippedStart = Math.max(start, spans[spanIndex]);
          const clippedEnd = Math.min(end, spans[spanIndex + 1]);
          if (clippedStart < clippedEnd) {
            pixels.fill(color, row + clippedStart, row + clippedEnd);
          }
        }
      }
    },
    drawRgbaLayer(rgba, layerWidth, layerHeight, options = {}) {
      if (!rgba || layerWidth !== width || layerHeight !== height) {
        return;
      }

      const source = rgba instanceof Uint8ClampedArray
        ? new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4)
        : new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4);
      const flipY = options.flipY === true;
      const maskSpans = activeWorldMask?.spans?.rows;
      const maskOffsetY = activeWorldMask?.spans?.offsetY || 0;

      function copyRange(y, start, end) {
        if (start >= end) {
          return;
        }
        const sourceY = flipY ? height - 1 - y : y;
        const sourceRow = sourceY * width;
        const destRow = y * width;
        for (let x = start; x < end; x += 1) {
          const color = source[sourceRow + x];
          if ((color >>> 24) !== 0) {
            pixels[destRow + x] = color;
          }
        }
      }

      for (let y = 0; y < height; y += 1) {
        if (activeClip && activeClip.starts[y] >= activeClip.ends[y]) {
          continue;
        }

        const clipStart = activeClip ? activeClip.starts[y] : 0;
        const clipEnd = activeClip ? activeClip.ends[y] : width;
        if (!Array.isArray(maskSpans)) {
          if (activeWorldMask?.allows) {
            const sourceY = flipY ? height - 1 - y : y;
            const sourceRow = sourceY * width;
            const destRow = y * width;
            for (let x = clipStart; x < clipEnd; x += 1) {
              if (!activeWorldMask.allows(x, y)) {
                continue;
              }
              const color = source[sourceRow + x];
              if ((color >>> 24) !== 0) {
                pixels[destRow + x] = color;
              }
            }
            continue;
          }

          copyRange(y, clipStart, clipEnd);
          continue;
        }

        const spans = maskSpans[y - maskOffsetY];
        if (!Array.isArray(spans)) {
          continue;
        }
        for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 2) {
          copyRange(
            y,
            Math.max(clipStart, spans[spanIndex]),
            Math.min(clipEnd, spans[spanIndex + 1])
          );
        }
      }
    },
    drawGpuCodeLayer(rgba, layerWidth, layerHeight, palette = {}, options = {}) {
      if (!rgba || layerWidth !== width || layerHeight !== height) {
        return;
      }

      const background = colorFor(palette.background || RENDER.background, colorCache);
      const foreground = colorFor(palette.foreground || RENDER.foreground, colorCache);
      const backing = colorFor(palette.backing || "#000000", colorCache);
      const codeColors = [0, background, foreground, backing];
      const flipY = options.flipY === true;
      const maskSpans = activeWorldMask?.spans?.rows;
      const maskOffsetY = activeWorldMask?.spans?.offsetY || 0;

      function copyRange(y, start, end) {
        if (start >= end) {
          return;
        }
        const sourceY = flipY ? height - 1 - y : y;
        const sourceRow = sourceY * width * 4;
        const destRow = y * width;
        for (let x = start; x < end; x += 1) {
          const offset = sourceRow + x * 4;
          if (rgba[offset + 3] === 0) {
            continue;
          }

          const color = codeColors[rgba[offset]] || 0;
          if (color) {
            pixels[destRow + x] = color;
          }
        }
      }

      for (let y = 0; y < height; y += 1) {
        if (activeClip && activeClip.starts[y] >= activeClip.ends[y]) {
          continue;
        }

        const clipStart = activeClip ? activeClip.starts[y] : 0;
        const clipEnd = activeClip ? activeClip.ends[y] : width;
        if (!Array.isArray(maskSpans)) {
          if (activeWorldMask?.allows) {
            const sourceY = flipY ? height - 1 - y : y;
            const sourceRow = sourceY * width * 4;
            const destRow = y * width;
            for (let x = clipStart; x < clipEnd; x += 1) {
              if (!activeWorldMask.allows(x, y)) {
                continue;
              }

              const offset = sourceRow + x * 4;
              if (rgba[offset + 3] === 0) {
                continue;
              }

              const color = codeColors[rgba[offset]] || 0;
              if (color) {
                pixels[destRow + x] = color;
              }
            }
            continue;
          }

          copyRange(y, clipStart, clipEnd);
          continue;
        }

        const spans = maskSpans[y - maskOffsetY];
        if (!Array.isArray(spans)) {
          continue;
        }
        for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 2) {
          copyRange(
            y,
            Math.max(clipStart, spans[spanIndex]),
            Math.min(clipEnd, spans[spanIndex + 1])
          );
        }
      }
    },
    present(presenter = null, overlaySurfaces = null) {
      const stormLayers = queuedGpuStormLayers;
      const checkerLayer = queuedGpuCheckerLayer;
      queuedGpuStormLayers = [];
      queuedGpuCheckerLayer = null;
      const overlayList = Array.isArray(overlaySurfaces)
        ? overlaySurfaces
        : overlaySurfaces ? [overlaySurfaces] : [];
      const overlayImageDatas = overlayList
        .map((overlaySurface) => overlaySurface?.getImageData?.() || null)
        .filter(Boolean);
      if (presenter?.present?.(imageData, { checkerLayer, stormLayers, overlays: overlayImageDatas })) {
        return;
      }

      for (const overlayImageData of overlayImageDatas) {
        const overlayPixels = new Uint32Array(overlayImageData.data.buffer);
        for (let index = 0; index < pixels.length; index += 1) {
          if ((overlayPixels[index] >>> 24) !== 0) {
            pixels[index] = overlayPixels[index];
          }
        }
      }
      canvasContext.putImageData(imageData, 0, 0);
    }
  };
}

function createGpuFramePresenter(canvas, width, height) {
  if (!canvas) {
    return null;
  }

  try {
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    });
    if (!gl) {
      return null;
    }

    const program = createGpuProgram(gl, GPU_FRAME_VERTEX_SHADER, GPU_FRAME_FRAGMENT_SHADER, "GPU frame");
    const overlayProgram = createGpuProgram(gl, GPU_FRAME_VERTEX_SHADER, GPU_FRAME_OVERLAY_FRAGMENT_SHADER, "GPU frame overlay");
    const checkerProgram = createGpuProgram(gl, GPU_FRAME_VERTEX_SHADER, GPU_FRAME_CHECKER_FRAGMENT_SHADER, "GPU frame checker");
    const stormProgram = createGpuProgram(gl, GPU_STORM_VERTEX_SHADER, GPU_STORM_FRAGMENT_SHADER, "GPU frame storm");
    const compositeProgram = createGpuProgram(gl, GPU_FRAME_VERTEX_SHADER, GPU_FRAME_STORM_FRAGMENT_SHADER, "GPU frame storm composite");
    const stormOverlayProgram = createGpuProgram(gl, GPU_FRAME_VERTEX_SHADER, GPU_STORM_OVER_FRAGMENT_SHADER, "GPU frame storm overlay");
    if (!program || !overlayProgram) {
      return null;
    }
    const supportsChecker = Boolean(checkerProgram);
    const supportsStorm = Boolean(stormProgram && compositeProgram && stormOverlayProgram);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
      ]),
      gl.STATIC_DRAW
    );

    const texture = createNearestTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const overlayTexture = createNearestTexture(gl);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const stormTexture = createNearestTexture(gl);
    const stormFramebuffer = gl.createFramebuffer();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, stormTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, stormFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stormTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const gridTexture = createNearestTexture(gl);
    const permTexture = createNearestTexture(gl);
    const maskTexture = createNearestTexture(gl);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      GPU_VISIBILITY_MASK_SPANS_PER_ROW,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    let gridKey = "";
    let gridWidth = 0;
    let gridHeight = 0;
    let gridData = null;
    let permKey = "";
    let maskData = null;

    const locations = {
      position: gl.getAttribLocation(program, "a_position"),
      frame: gl.getUniformLocation(program, "u_frame")
    };
    const overlayLocations = {
      position: gl.getAttribLocation(overlayProgram, "a_position"),
      overlay: gl.getUniformLocation(overlayProgram, "u_overlay")
    };
    const checkerLocations = supportsChecker
      ? {
        position: gl.getAttribLocation(checkerProgram, "a_position"),
        frame: gl.getUniformLocation(checkerProgram, "u_frame"),
        grid: gl.getUniformLocation(checkerProgram, "u_grid"),
        resolution: gl.getUniformLocation(checkerProgram, "u_resolution"),
        camera: gl.getUniformLocation(checkerProgram, "u_camera"),
        mapSize: gl.getUniformLocation(checkerProgram, "u_mapSize"),
        tileSize: gl.getUniformLocation(checkerProgram, "u_tileSize"),
        cameraPixelOffset: gl.getUniformLocation(checkerProgram, "u_cameraPixelOffset"),
        checkerSize: gl.getUniformLocation(checkerProgram, "u_checkerSize"),
        lensEdgeScale: gl.getUniformLocation(checkerProgram, "u_lensEdgeScale"),
        lensPower: gl.getUniformLocation(checkerProgram, "u_lensPower"),
        lensNoiseRadial: gl.getUniformLocation(checkerProgram, "u_lensNoiseRadial"),
        lensNoiseTangential: gl.getUniformLocation(checkerProgram, "u_lensNoiseTangential"),
        lensDefectDensity: gl.getUniformLocation(checkerProgram, "u_lensDefectDensity"),
        rockCornerRadius: gl.getUniformLocation(checkerProgram, "u_rockCornerRadius"),
        backgroundColor: gl.getUniformLocation(checkerProgram, "u_backgroundColor"),
        backingColor: gl.getUniformLocation(checkerProgram, "u_backingColor")
      }
      : null;
    const compositeLocations = supportsStorm
      ? {
        position: gl.getAttribLocation(compositeProgram, "a_position"),
        frame: gl.getUniformLocation(compositeProgram, "u_frame"),
        storm: gl.getUniformLocation(compositeProgram, "u_storm"),
        backgroundColor: gl.getUniformLocation(compositeProgram, "u_backgroundColor"),
        foregroundColor: gl.getUniformLocation(compositeProgram, "u_foregroundColor"),
        backingColor: gl.getUniformLocation(compositeProgram, "u_backingColor")
      }
      : null;
    const stormOverlayLocations = supportsStorm
      ? {
        position: gl.getAttribLocation(stormOverlayProgram, "a_position"),
        storm: gl.getUniformLocation(stormOverlayProgram, "u_storm"),
        backgroundColor: gl.getUniformLocation(stormOverlayProgram, "u_backgroundColor"),
        foregroundColor: gl.getUniformLocation(stormOverlayProgram, "u_foregroundColor"),
        backingColor: gl.getUniformLocation(stormOverlayProgram, "u_backingColor")
      }
      : null;
    const stormLocations = supportsStorm
      ? {
        position: gl.getAttribLocation(stormProgram, "a_position"),
        resolution: gl.getUniformLocation(stormProgram, "u_resolution"),
        camera: gl.getUniformLocation(stormProgram, "u_camera"),
        mapSize: gl.getUniformLocation(stormProgram, "u_mapSize"),
        tileSize: gl.getUniformLocation(stormProgram, "u_tileSize"),
        time: gl.getUniformLocation(stormProgram, "u_time"),
        seed: gl.getUniformLocation(stormProgram, "u_seed"),
        threshold: gl.getUniformLocation(stormProgram, "u_threshold"),
        noiseScale: gl.getUniformLocation(stormProgram, "u_noiseScale"),
        speedX: gl.getUniformLocation(stormProgram, "u_speedX"),
        speedY: gl.getUniformLocation(stormProgram, "u_speedY"),
        speedZ: gl.getUniformLocation(stormProgram, "u_speedZ"),
        cameraPixelOffset: gl.getUniformLocation(stormProgram, "u_cameraPixelOffset"),
        checkerSize: gl.getUniformLocation(stormProgram, "u_checkerSize"),
        playerWorld: gl.getUniformLocation(stormProgram, "u_playerWorld"),
        playerStormBlob: gl.getUniformLocation(stormProgram, "u_playerStormBlob"),
        lensEdgeScale: gl.getUniformLocation(stormProgram, "u_lensEdgeScale"),
        lensPower: gl.getUniformLocation(stormProgram, "u_lensPower"),
        lensNoiseRadial: gl.getUniformLocation(stormProgram, "u_lensNoiseRadial"),
        lensNoiseTangential: gl.getUniformLocation(stormProgram, "u_lensNoiseTangential"),
        lensDefectDensity: gl.getUniformLocation(stormProgram, "u_lensDefectDensity"),
        grid: gl.getUniformLocation(stormProgram, "u_grid"),
        perm: gl.getUniformLocation(stormProgram, "u_perm"),
        mask: gl.getUniformLocation(stormProgram, "u_mask"),
        maskSize: gl.getUniformLocation(stormProgram, "u_maskSize"),
        maskOffset: gl.getUniformLocation(stormProgram, "u_maskOffset"),
        maskMode: gl.getUniformLocation(stormProgram, "u_maskMode")
      }
      : null;

    function uploadFrame(imageData) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
    }

    function uploadOverlay(imageData) {
      if (!imageData || imageData.width !== width || imageData.height !== height) {
        return false;
      }
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
      return true;
    }

    function bindFullscreenAttributes(programLocations) {
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(programLocations.position);
      gl.vertexAttribPointer(programLocations.position, 2, gl.FLOAT, false, 0, 0);
    }

    function uploadStormGrid(asteroid) {
      const nextWidth = Math.max(0, asteroid?.widthTiles | 0);
      const nextHeight = Math.max(0, asteroid?.heightTiles | 0);
      if (nextWidth <= 0 || nextHeight <= 0 || !asteroid?.storm) {
        return false;
      }

      const nextKey = [
        asteroid.seed || "default",
        asteroid.revision || asteroid._revision || 0,
        nextWidth,
        nextHeight,
        asteroid.tiles?.length || 0,
        asteroid.storm?.length || 0
      ].join(":");
      if (nextKey === gridKey) {
        return true;
      }

      gridWidth = nextWidth;
      gridHeight = nextHeight;
      const length = gridWidth * gridHeight * 4;
      if (!gridData || gridData.length !== length) {
        gridData = new Uint8Array(length);
      }

      for (let tileY = 0; tileY < gridHeight; tileY += 1) {
        for (let tileX = 0; tileX < gridWidth; tileX += 1) {
          const index = tileY * gridWidth + tileX;
          const offset = index * 4;
          gridData[offset] = Number(asteroid.storm[index] || STORM_STATE.safe);
          gridData[offset + 1] = isPlayableTile(asteroid, tileX, tileY) ? 255 : 0;
          gridData[offset + 2] = isSolidTile(asteroid.tiles[index]) ? 255 : 0;
          gridData[offset + 3] = 255;
        }
      }

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, gridTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gridWidth, gridHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, gridData);
      gridKey = nextKey;
      return true;
    }

    function uploadStormPermutation(seed) {
      const nextKey = `${seed || "default"}:storm-visual`;
      if (nextKey === permKey) {
        return;
      }

      const permutation = stormGpuPermutationForSeed(seed);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, permTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, permutation);
      permKey = nextKey;
    }

    function uploadStormMask(spans, sourcePadding = 0) {
      if (!spans?.rows) {
        return null;
      }

      const maskHeight = Math.max(1, spans.rows.length);
      const padding = Math.max(0, Math.floor(Number(sourcePadding || 0)));
      let minX = -padding;
      for (const row of spans.rows) {
        if (!Array.isArray(row)) {
          continue;
        }
        for (let spanIndex = 0; spanIndex + 1 < row.length; spanIndex += 2) {
          minX = Math.min(minX, Math.floor(row[spanIndex]));
        }
      }
      const offsetX = minX;
      const offsetY = Math.floor(Number(spans.offsetY || 0));
      const length = GPU_VISIBILITY_MASK_SPANS_PER_ROW * maskHeight * 4;
      if (!maskData || maskData.length !== length) {
        maskData = new Uint8Array(length);
      } else {
        maskData.fill(0);
      }

      for (let rowIndex = 0; rowIndex < spans.rows.length; rowIndex += 1) {
        const row = spans.rows[rowIndex];
        if (!Array.isArray(row)) {
          continue;
        }

        const rowOffset = rowIndex * GPU_VISIBILITY_MASK_SPANS_PER_ROW * 4;
        let outSpan = 0;
        for (let spanIndex = 0; spanIndex + 1 < row.length && outSpan < GPU_VISIBILITY_MASK_SPANS_PER_ROW; spanIndex += 2) {
          const isLastSlot = outSpan === GPU_VISIBILITY_MASK_SPANS_PER_ROW - 1;
          const start = Math.max(0, Math.floor(row[spanIndex]) - offsetX);
          const end = clamp(
            Math.ceil(isLastSlot ? row[row.length - 1] : row[spanIndex + 1]) - offsetX,
            0,
            65535
          );
          if (end <= start) {
            continue;
          }

          const offset = rowOffset + outSpan * 4;
          maskData[offset] = (start >> 8) & 255;
          maskData[offset + 1] = start & 255;
          maskData[offset + 2] = (end >> 8) & 255;
          maskData[offset + 3] = end & 255;
          outSpan += 1;
          if (isLastSlot) {
            break;
          }
        }
      }

      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, maskTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        GPU_VISIBILITY_MASK_SPANS_PER_ROW,
        maskHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        maskData
      );
      return {
        width: GPU_VISIBILITY_MASK_SPANS_PER_ROW,
        height: maskHeight,
        offsetX,
        offsetY
      };
    }

    function renderStormTexture(layer) {
      const asteroid = layer?.asteroid;
      if (!supportsStorm || !uploadStormGrid(asteroid)) {
        return false;
      }

      uploadStormPermutation(asteroid.seed);
      const stableTimeSeconds = Math.floor(Number(layer.timeSeconds || 0) * STORM_PATTERN_FPS) / STORM_PATTERN_FPS;
      const focusEnabled = layer.stormFocus?.enabled ? 1 : 0;
      const focusX = focusEnabled ? Number(layer.stormFocus.x || 0) : 0;
      const focusY = focusEnabled ? Number(layer.stormFocus.y || 0) : 0;
      const maskInfo = uploadStormMask(layer.visibilitySpans, layer.sourcePadding);
      const maskMode = maskInfo
        ? layer.visibilityMaskMode === "exclude" ? 2 : 1
        : 0;

      gl.bindFramebuffer(gl.FRAMEBUFFER, stormFramebuffer);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(stormProgram);
      bindFullscreenAttributes(stormLocations);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, gridTexture);
      gl.uniform1i(stormLocations.grid, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, permTexture);
      gl.uniform1i(stormLocations.perm, 3);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, maskTexture);
      gl.uniform1i(stormLocations.mask, 4);
      gl.uniform2f(stormLocations.maskSize, maskInfo?.width || 1, maskInfo?.height || 1);
      gl.uniform2f(stormLocations.maskOffset, maskInfo?.offsetX || 0, maskInfo?.offsetY || 0);
      gl.uniform1f(stormLocations.maskMode, maskMode);
      gl.uniform2f(stormLocations.resolution, width, height);
      gl.uniform2f(stormLocations.camera, Number(layer.camera?.x || 0), Number(layer.camera?.y || 0));
      gl.uniform2f(stormLocations.mapSize, gridWidth, gridHeight);
      gl.uniform1f(stormLocations.tileSize, asteroid.tileSize || RENDER.tileSize);
      gl.uniform1f(stormLocations.time, stableTimeSeconds);
      gl.uniform1f(stormLocations.seed, seedToUnitFloat(asteroid.seed));
      gl.uniform1f(stormLocations.threshold, STORM_NOISE_THRESHOLD);
      gl.uniform1f(stormLocations.noiseScale, STORM_NOISE_SCALE);
      gl.uniform1f(stormLocations.speedX, STORM_NOISE_SPEED_X);
      gl.uniform1f(stormLocations.speedY, STORM_NOISE_SPEED_Y);
      gl.uniform1f(stormLocations.speedZ, STORM_NOISE_SPEED_Z);
      gl.uniform2f(stormLocations.playerWorld, focusX, focusY);
      gl.uniform1f(stormLocations.playerStormBlob, focusEnabled);
      gl.uniform2f(
        stormLocations.cameraPixelOffset,
        renderedCameraPixelOffset(layer.camera?.x || 0),
        renderedCameraPixelOffset(layer.camera?.y || 0)
      );
      gl.uniform1f(stormLocations.checkerSize, ASTEROID_VISIBILITY_CHECKER_SIZE);
      gl.uniform1f(stormLocations.lensEdgeScale, WORLD_LENS_EDGE_SCALE);
      gl.uniform1f(stormLocations.lensPower, WORLD_LENS_POWER);
      gl.uniform1f(stormLocations.lensNoiseRadial, WORLD_LENS_NOISE_RADIAL);
      gl.uniform1f(stormLocations.lensNoiseTangential, WORLD_LENS_NOISE_TANGENTIAL);
      gl.uniform1f(stormLocations.lensDefectDensity, WORLD_LENS_DEFECT_DENSITY);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }

    function drawFrameOnly() {
      gl.useProgram(program);
      bindFullscreenAttributes(locations);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(locations.frame, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawFrameWithChecker(layer) {
      const asteroid = layer?.asteroid;
      if (!supportsChecker || !uploadStormGrid(asteroid)) {
        drawFrameOnly();
        return false;
      }

      const palette = layer.palette || {};
      const background = rgbFloatsForHex(palette.background || RENDER.background);
      const backing = rgbFloatsForHex(palette.backing || "#000000");
      const camera = layer.camera || {};
      gl.useProgram(checkerProgram);
      bindFullscreenAttributes(checkerLocations);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(checkerLocations.frame, 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, gridTexture);
      gl.uniform1i(checkerLocations.grid, 2);
      gl.uniform2f(checkerLocations.resolution, width, height);
      gl.uniform2f(checkerLocations.camera, Number(camera.x || 0), Number(camera.y || 0));
      gl.uniform2f(checkerLocations.mapSize, gridWidth, gridHeight);
      gl.uniform1f(checkerLocations.tileSize, asteroid.tileSize || RENDER.tileSize);
      gl.uniform2f(
        checkerLocations.cameraPixelOffset,
        renderedCameraPixelOffset(camera.x || 0),
        renderedCameraPixelOffset(camera.y || 0)
      );
      gl.uniform1f(checkerLocations.checkerSize, ASTEROID_VISIBILITY_CHECKER_SIZE);
      gl.uniform1f(checkerLocations.lensEdgeScale, WORLD_LENS_EDGE_SCALE);
      gl.uniform1f(checkerLocations.lensPower, WORLD_LENS_POWER);
      gl.uniform1f(checkerLocations.lensNoiseRadial, WORLD_LENS_NOISE_RADIAL);
      gl.uniform1f(checkerLocations.lensNoiseTangential, WORLD_LENS_NOISE_TANGENTIAL);
      gl.uniform1f(checkerLocations.lensDefectDensity, WORLD_LENS_DEFECT_DENSITY);
      gl.uniform1f(checkerLocations.rockCornerRadius, ROCK_OUTER_CORNER_RADIUS);
      gl.uniform3f(checkerLocations.backgroundColor, background[0], background[1], background[2]);
      gl.uniform3f(checkerLocations.backingColor, backing[0], backing[1], backing[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return true;
    }

    function drawFrameWithStorm(layer) {
      const palette = layer.palette || {};
      const background = rgbFloatsForHex(palette.background || RENDER.background);
      const foreground = rgbFloatsForHex(palette.foreground || RENDER.foreground);
      const backing = rgbFloatsForHex(palette.backing || "#000000");

      gl.useProgram(compositeProgram);
      bindFullscreenAttributes(compositeLocations);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(compositeLocations.frame, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stormTexture);
      gl.uniform1i(compositeLocations.storm, 1);
      gl.uniform3f(compositeLocations.backgroundColor, background[0], background[1], background[2]);
      gl.uniform3f(compositeLocations.foregroundColor, foreground[0], foreground[1], foreground[2]);
      gl.uniform3f(compositeLocations.backingColor, backing[0], backing[1], backing[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawStormOverCurrent(layer) {
      const palette = layer.palette || {};
      const background = rgbFloatsForHex(palette.background || RENDER.background);
      const foreground = rgbFloatsForHex(palette.foreground || RENDER.foreground);
      const backing = rgbFloatsForHex(palette.backing || "#000000");

      gl.useProgram(stormOverlayProgram);
      bindFullscreenAttributes(stormOverlayLocations);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stormTexture);
      gl.uniform1i(stormOverlayLocations.storm, 1);
      gl.uniform3f(stormOverlayLocations.backgroundColor, background[0], background[1], background[2]);
      gl.uniform3f(stormOverlayLocations.foregroundColor, foreground[0], foreground[1], foreground[2]);
      gl.uniform3f(stormOverlayLocations.backingColor, backing[0], backing[1], backing[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawOverlayOverCurrent() {
      gl.useProgram(overlayProgram);
      bindFullscreenAttributes(overlayLocations);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
      gl.uniform1i(overlayLocations.overlay, 5);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    return {
      supportsChecker,
      supportsStorm,
      present(imageData, options = {}) {
        if (!imageData || imageData.width !== width || imageData.height !== height) {
          return false;
        }

        uploadFrame(imageData);
        gl.viewport(0, 0, width, height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const checkerLayer = options.checkerLayer || null;
        const stormLayers = Array.isArray(options.stormLayers)
          ? options.stormLayers
          : options.stormLayer ? [options.stormLayer] : [];
        let drewFrame = false;
        if (checkerLayer) {
          drewFrame = drawFrameWithChecker(checkerLayer);
        }
        for (const stormLayer of stormLayers) {
          if (!renderStormTexture(stormLayer)) {
            continue;
          }

          if (!drewFrame) {
            drawFrameWithStorm(stormLayer);
            drewFrame = true;
          } else {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            drawStormOverCurrent(stormLayer);
            gl.disable(gl.BLEND);
          }
        }

        if (!drewFrame) {
          drawFrameOnly();
        }
        const overlays = Array.isArray(options.overlays)
          ? options.overlays
          : options.overlay ? [options.overlay] : [];
        for (const overlay of overlays) {
          if (uploadOverlay(overlay)) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            drawOverlayOverCurrent();
            gl.disable(gl.BLEND);
          }
        }
        return true;
      }
    };
  } catch (error) {
    console.warn("BITSPACE GPU frame presenter unavailable", error);
    return null;
  }
}

function createNearestTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createGpuStormRenderer(width, height) {
  if (typeof document === "undefined" || !document.createElement) {
    return null;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
    if (!gl) {
      return null;
    }

    const program = createGpuProgram(gl, GPU_STORM_VERTEX_SHADER, GPU_STORM_FRAGMENT_SHADER, "GPU storm");
    if (!program) {
      return null;
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
      ]),
      gl.STATIC_DRAW
    );

    const gridTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gridTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

    const permTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, permTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const locations = {
      position: gl.getAttribLocation(program, "a_position"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      camera: gl.getUniformLocation(program, "u_camera"),
      mapSize: gl.getUniformLocation(program, "u_mapSize"),
      tileSize: gl.getUniformLocation(program, "u_tileSize"),
      time: gl.getUniformLocation(program, "u_time"),
      seed: gl.getUniformLocation(program, "u_seed"),
      threshold: gl.getUniformLocation(program, "u_threshold"),
      noiseScale: gl.getUniformLocation(program, "u_noiseScale"),
      speedX: gl.getUniformLocation(program, "u_speedX"),
      speedY: gl.getUniformLocation(program, "u_speedY"),
      speedZ: gl.getUniformLocation(program, "u_speedZ"),
      cameraPixelOffset: gl.getUniformLocation(program, "u_cameraPixelOffset"),
      checkerSize: gl.getUniformLocation(program, "u_checkerSize"),
      playerWorld: gl.getUniformLocation(program, "u_playerWorld"),
      playerStormBlob: gl.getUniformLocation(program, "u_playerStormBlob"),
      lensEdgeScale: gl.getUniformLocation(program, "u_lensEdgeScale"),
      lensPower: gl.getUniformLocation(program, "u_lensPower"),
      lensNoiseRadial: gl.getUniformLocation(program, "u_lensNoiseRadial"),
      lensNoiseTangential: gl.getUniformLocation(program, "u_lensNoiseTangential"),
      lensDefectDensity: gl.getUniformLocation(program, "u_lensDefectDensity"),
      grid: gl.getUniformLocation(program, "u_grid"),
      perm: gl.getUniformLocation(program, "u_perm")
    };

    const rgba = new Uint8Array(width * height * 4);
    let gridKey = "";
    let gridWidth = 0;
    let gridHeight = 0;
    let gridData = null;
    let permKey = "";
    let layerKey = "";
    let layerRuns = null;
    let frameStats = {
      calls: 0,
      totalMs: 0,
      readMs: 0,
      requests: 0,
      visibilityCalls: 0,
      visibilityTotalMs: 0,
      visibilityReadMs: 0,
      visibilityRequests: 0
    };

    function uploadGrid(asteroid) {
      const nextWidth = Math.max(0, asteroid.widthTiles | 0);
      const nextHeight = Math.max(0, asteroid.heightTiles | 0);
      if (nextWidth <= 0 || nextHeight <= 0 || !asteroid.storm) {
        return false;
      }

      const nextKey = [
        asteroid.seed || "default",
        asteroid.revision || asteroid._revision || 0,
        nextWidth,
        nextHeight,
        asteroid.tiles?.length || 0,
        asteroid.storm?.length || 0
      ].join(":");
      if (nextKey === gridKey) {
        return true;
      }

      gridWidth = nextWidth;
      gridHeight = nextHeight;
      const length = gridWidth * gridHeight * 4;
      if (!gridData || gridData.length !== length) {
        gridData = new Uint8Array(length);
      }

      for (let tileY = 0; tileY < gridHeight; tileY += 1) {
        for (let tileX = 0; tileX < gridWidth; tileX += 1) {
          const index = tileY * gridWidth + tileX;
          const offset = index * 4;
          gridData[offset] = Number(asteroid.storm[index] || STORM_STATE.safe);
          gridData[offset + 1] = isPlayableTile(asteroid, tileX, tileY) ? 255 : 0;
          gridData[offset + 2] = isSolidTile(asteroid.tiles[index]) ? 255 : 0;
          gridData[offset + 3] = 255;
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, gridTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gridWidth,
        gridHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gridData
      );
      gridKey = nextKey;
      return true;
    }

    function uploadPermutation(seed) {
      const nextKey = `${seed || "default"}:storm-visual`;
      if (nextKey === permKey) {
        return;
      }

      const permutation = stormGpuPermutationForSeed(seed);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, permTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        256,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        permutation
      );
      permKey = nextKey;
    }

    return {
      width,
      height,
      beginFrame() {
        frameStats = {
          calls: 0,
          totalMs: 0,
          readMs: 0,
          requests: 0,
          visibilityCalls: 0,
          visibilityTotalMs: 0,
          visibilityReadMs: 0,
          visibilityRequests: 0
        };
      },
      frameStats() {
        return {
          calls: frameStats.calls,
          totalMs: frameStats.totalMs,
          readMs: frameStats.readMs,
          requests: frameStats.requests,
          visibilityCalls: frameStats.visibilityCalls,
          visibilityTotalMs: frameStats.visibilityTotalMs,
          visibilityReadMs: frameStats.visibilityReadMs,
          visibilityRequests: frameStats.visibilityRequests
        };
      },
      drawVisibilityChecker(asteroid, camera, timeSeconds) {
        void asteroid;
        void camera;
        void timeSeconds;
        frameStats.visibilityRequests += 1;
        return null;
      },
      draw(asteroid, camera, timeSeconds, stormFocus = null) {
        frameStats.requests += 1;
        const layer = renderCombinedLayer(asteroid, camera, timeSeconds, false, stormFocus);
        return layer ? { rgba, runs: layerRuns, width, height, cached: layer.cached } : null;
      }
    };

    function renderCombinedLayer(asteroid, camera, timeSeconds, countVisibilityStats, stormFocus = null) {
        if (!uploadGrid(asteroid)) {
          return null;
        }

        const stableTimeSeconds = Math.floor(Number(timeSeconds || 0) * STORM_PATTERN_FPS) / STORM_PATTERN_FPS;
        uploadPermutation(asteroid.seed);
        const focusEnabled = stormFocus?.enabled ? 1 : 0;
        const focusX = focusEnabled ? Number(stormFocus.x || 0) : 0;
        const focusY = focusEnabled ? Number(stormFocus.y || 0) : 0;
        const nextLayerKey = [
          gridKey,
          permKey,
          width,
          height,
          Math.round(Number(camera.x || 0) * 1000),
          Math.round(Number(camera.y || 0) * 1000),
          Math.round(stableTimeSeconds * STORM_PATTERN_FPS),
          focusEnabled,
          Math.round(focusX * 1000),
          Math.round(focusY * 1000)
        ].join(":");
        if (nextLayerKey === layerKey) {
          return { cached: true };
        }

        const startMs = performance.now();
        gl.viewport(0, 0, width, height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(locations.position);
        gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, gridTexture);
        gl.uniform1i(locations.grid, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, permTexture);
        gl.uniform1i(locations.perm, 1);
        gl.uniform2f(locations.resolution, width, height);
        gl.uniform2f(locations.camera, Number(camera.x || 0), Number(camera.y || 0));
        gl.uniform2f(locations.mapSize, gridWidth, gridHeight);
        gl.uniform1f(locations.tileSize, asteroid.tileSize || RENDER.tileSize);
        gl.uniform1f(locations.time, stableTimeSeconds);
        gl.uniform1f(locations.seed, seedToUnitFloat(asteroid.seed));
        gl.uniform1f(locations.threshold, STORM_NOISE_THRESHOLD);
        gl.uniform1f(locations.noiseScale, STORM_NOISE_SCALE);
        gl.uniform1f(locations.speedX, STORM_NOISE_SPEED_X);
        gl.uniform1f(locations.speedY, STORM_NOISE_SPEED_Y);
        gl.uniform1f(locations.speedZ, STORM_NOISE_SPEED_Z);
        gl.uniform2f(locations.playerWorld, focusX, focusY);
        gl.uniform1f(locations.playerStormBlob, focusEnabled);
        gl.uniform2f(
          locations.cameraPixelOffset,
          renderedCameraPixelOffset(camera?.x || 0),
          renderedCameraPixelOffset(camera?.y || 0)
        );
        gl.uniform1f(locations.checkerSize, ASTEROID_VISIBILITY_CHECKER_SIZE);
        gl.uniform1f(locations.lensEdgeScale, WORLD_LENS_EDGE_SCALE);
        gl.uniform1f(locations.lensPower, WORLD_LENS_POWER);
        gl.uniform1f(locations.lensNoiseRadial, WORLD_LENS_NOISE_RADIAL);
        gl.uniform1f(locations.lensNoiseTangential, WORLD_LENS_NOISE_TANGENTIAL);
        gl.uniform1f(locations.lensDefectDensity, WORLD_LENS_DEFECT_DENSITY);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const readStartMs = performance.now();
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        layerRuns = gpuStormRunsFromRgba(rgba, width, height, 0);
        const endMs = performance.now();
        frameStats.calls += 1;
        frameStats.totalMs += endMs - startMs;
        frameStats.readMs += endMs - readStartMs;
        if (countVisibilityStats) {
          frameStats.visibilityCalls += 1;
          frameStats.visibilityTotalMs += endMs - startMs;
          frameStats.visibilityReadMs += endMs - readStartMs;
        }
        layerKey = nextLayerKey;
        return { cached: false };
      }
  } catch (error) {
    console.warn("BITSPACE GPU storm renderer unavailable", error);
    return null;
  }
}

function createGpuProgram(gl, vertexSource, fragmentSource, label = "GPU program") {
  const vertexShader = compileGpuShader(gl, gl.VERTEX_SHADER, vertexSource, label);
  const fragmentShader = compileGpuShader(gl, gl.FRAGMENT_SHADER, fragmentSource, label);
  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(`BITSPACE ${label} program link failed`, gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function compileGpuShader(gl, type, source, label = "GPU program") {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(`BITSPACE ${label} shader compile failed`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function gpuStormRunsFromRgba(rgba, width, height, channel = 0) {
  const channelIndex = clamp(channel | 0, 0, 3);
  const runs = [];
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const sourceRow = sourceY * width * 4;
    let runCode = 0;
    let runStart = 0;

    for (let x = 0; x < width; x += 1) {
      const offset = sourceRow + x * 4;
      const code = rgba[offset + channelIndex];
      if (code === runCode) {
        continue;
      }

      if (runCode !== 0) {
        runs.push(y, runStart, x, runCode);
      }
      runCode = code;
      runStart = x;
    }

    if (runCode !== 0) {
      runs.push(y, runStart, width, runCode);
    }
  }
  return runs;
}

function seedToUnitFloat(seed) {
  const text = String(seed || "default");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function stormGpuPermutationForSeed(seed) {
  const cacheKey = `${seed || "default"}:storm-visual`;
  let cached = stormGpuPermutationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const random = createSeededRandom(cacheKey);
  const permutation = Array.from({ length: 256 }, (_value, index) => index);
  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = permutation[index];
    permutation[index] = permutation[swapIndex];
    permutation[swapIndex] = value;
  }

  cached = new Uint8Array(256 * 4);
  for (let index = 0; index < 256; index += 1) {
    const offset = index * 4;
    cached[offset] = permutation[index];
    cached[offset + 1] = permutation[index];
    cached[offset + 2] = permutation[index];
    cached[offset + 3] = 255;
  }
  stormGpuPermutationCache.set(cacheKey, cached);
  return cached;
}

const GPU_FRAME_VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = vec2((a_position.x + 1.0) * 0.5, 1.0 - (a_position.y + 1.0) * 0.5);
}
`;

const GPU_FRAME_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_frame;
varying vec2 v_texCoord;

void main() {
  gl_FragColor = texture2D(u_frame, v_texCoord);
}
`;

const GPU_FRAME_CHECKER_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_frame;
uniform sampler2D u_grid;
uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform vec2 u_mapSize;
uniform float u_tileSize;
uniform vec2 u_cameraPixelOffset;
uniform float u_checkerSize;
uniform float u_lensEdgeScale;
uniform float u_lensPower;
uniform float u_lensNoiseRadial;
uniform float u_lensNoiseTangential;
uniform float u_lensDefectDensity;
uniform float u_rockCornerRadius;
uniform vec3 u_backgroundColor;
uniform vec3 u_backingColor;
varying vec2 v_texCoord;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float lensNoiseUnit(vec2 p, float salt) {
  vec2 q = floor(p);
  return hash13(vec3(q.x * 0.071, q.y * 0.097, salt));
}

float lensNoiseSigned(vec2 p, float salt) {
  return lensNoiseUnit(p, salt) * 2.0 - 1.0;
}

vec2 inverseLensSource(vec2 screen) {
  if (u_lensEdgeScale <= 1.0001) {
    return screen;
  }

  vec2 center = u_resolution * 0.5;
  vec2 delta = screen + vec2(0.5) - center;
  float screenRadius = length(delta);
  if (screenRadius <= 0.0001) {
    return screen;
  }

  float radius = min(u_resolution.x, u_resolution.y) * 0.5;
  float maxSourceRadius = radius * u_lensEdgeScale;
  float lo = screenRadius;
  float hi = maxSourceRadius;
  for (int i = 0; i < 8; i += 1) {
    float mid = (lo + hi) * 0.5;
    float t = clamp(mid / maxSourceRadius, 0.0, 1.0);
    float scale = 1.0 + (u_lensEdgeScale - 1.0) * pow(t, max(1.0, u_lensPower));
    float projected = mid / scale;
    if (projected < screenRadius) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  float sourceRadius = hi;
  vec2 unit = delta / screenRadius;
  vec2 source = center + unit * sourceRadius - vec2(0.5);
  float t = clamp(sourceRadius / maxSourceRadius, 0.0, 1.0);
  float scale = 1.0 + (u_lensEdgeScale - 1.0) * pow(t, max(1.0, u_lensPower));
  float falloff = (scale - 1.0) / max(0.0001, u_lensEdgeScale - 1.0);
  float defectDensity = clamp(falloff * u_lensDefectDensity, 0.0, 1.0);
  if (lensNoiseUnit(source, 73.31) <= defectDensity) {
    vec2 tangent = vec2(-unit.y, unit.x);
    source += unit * lensNoiseSigned(source, 17.91) * u_lensNoiseRadial;
    source += tangent * lensNoiseSigned(source, 41.27) * u_lensNoiseTangential;
  }
  return source;
}

bool frameIsBacking(vec4 frame) {
  return distance(frame.rgb, u_backingColor) < 0.004;
}

bool solidTileAt(vec2 tile) {
  if (tile.x >= 0.0 && tile.y >= 0.0 && tile.x < u_mapSize.x && tile.y < u_mapSize.y) {
    vec4 grid = texture2D(u_grid, (tile + vec2(0.5)) / u_mapSize);
    return grid.g > 0.5 && grid.b > 0.5;
  }
  return false;
}

bool ghostCheckerShapeAllows(vec2 tile, vec2 local) {
  if (!solidTileAt(tile)) {
    return true;
  }

  bool north = solidTileAt(tile + vec2(0.0, -1.0));
  bool east = solidTileAt(tile + vec2(1.0, 0.0));
  bool south = solidTileAt(tile + vec2(0.0, 1.0));
  bool west = solidTileAt(tile + vec2(-1.0, 0.0));
  bool topOpen = !north;
  bool rightOpen = !east;
  bool bottomOpen = !south;
  bool leftOpen = !west;
  float r = max(1.0, u_rockCornerRadius);
  float edge = u_tileSize - 1.0;
  float lineEpsilon = 0.5;
  float arcEpsilon = 0.75;

  if (topOpen && local.y < lineEpsilon) {
    float trimLeft = leftOpen ? r : 0.0;
    float trimRight = rightOpen ? r : 0.0;
    if (local.x >= trimLeft && local.x <= edge - trimRight) {
      return true;
    }
  }
  if (rightOpen && local.x >= edge - lineEpsilon) {
    float trimTop = topOpen ? r : 0.0;
    float trimBottom = bottomOpen ? r : 0.0;
    if (local.y >= trimTop && local.y <= edge - trimBottom) {
      return true;
    }
  }
  if (bottomOpen && local.y >= edge - lineEpsilon) {
    float trimLeft = leftOpen ? r : 0.0;
    float trimRight = rightOpen ? r : 0.0;
    if (local.x >= trimLeft && local.x <= edge - trimRight) {
      return true;
    }
  }
  if (leftOpen && local.x < lineEpsilon) {
    float trimTop = topOpen ? r : 0.0;
    float trimBottom = bottomOpen ? r : 0.0;
    if (local.y >= trimTop && local.y <= edge - trimBottom) {
      return true;
    }
  }

  if (topOpen && leftOpen) {
    vec2 delta = local - vec2(r, r);
    if (delta.x <= 0.0 && delta.y <= 0.0) {
      float dist = length(delta);
      if (dist >= r - arcEpsilon) {
        return true;
      }
    }
  }
  if (topOpen && rightOpen) {
    vec2 delta = local - vec2(edge - r, r);
    if (delta.x >= 0.0 && delta.y <= 0.0) {
      float dist = length(delta);
      if (dist >= r - arcEpsilon) {
        return true;
      }
    }
  }
  if (bottomOpen && rightOpen) {
    vec2 delta = local - vec2(edge - r, edge - r);
    if (delta.x >= 0.0 && delta.y >= 0.0) {
      float dist = length(delta);
      if (dist >= r - arcEpsilon) {
        return true;
      }
    }
  }
  if (bottomOpen && leftOpen) {
    vec2 delta = local - vec2(r, edge - r);
    if (delta.x <= 0.0 && delta.y >= 0.0) {
      float dist = length(delta);
      if (dist >= r - arcEpsilon) {
        return true;
      }
    }
  }

  return false;
}

bool checkerPixelOn(vec2 source) {
  vec2 world = floor(source + u_cameraPixelOffset);
  vec2 tile = floor(world / u_tileSize);
  vec2 local = mod(mod(world, u_tileSize) + u_tileSize, u_tileSize);
  if (!ghostCheckerShapeAllows(tile, local)) {
    return false;
  }

  float cell = floor(local.x / u_checkerSize) + floor(local.y / u_checkerSize);
  return mod(cell, 2.0) >= 0.5;
}

void main() {
  vec4 frame = texture2D(u_frame, v_texCoord);
  vec2 screen = floor(v_texCoord * u_resolution);
  vec2 center = u_resolution * 0.5;
  vec2 delta = screen + vec2(0.5) - center;
  float radius = min(u_resolution.x, u_resolution.y) * 0.5;
  if (!frameIsBacking(frame) || dot(delta, delta) > radius * radius) {
    gl_FragColor = frame;
    return;
  }

  vec2 source = inverseLensSource(screen);
  if (checkerPixelOn(source)) {
    gl_FragColor = vec4(u_backgroundColor, 1.0);
  } else {
    gl_FragColor = frame;
  }
}
`;

const GPU_FRAME_OVERLAY_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_overlay;
varying vec2 v_texCoord;

void main() {
  vec4 overlay = texture2D(u_overlay, v_texCoord);
  if (overlay.a <= 0.0) {
    discard;
  }
  gl_FragColor = overlay;
}
`;

const GPU_FRAME_STORM_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_frame;
uniform sampler2D u_storm;
uniform vec3 u_backgroundColor;
uniform vec3 u_foregroundColor;
uniform vec3 u_backingColor;
varying vec2 v_texCoord;

void main() {
  vec4 frame = texture2D(u_frame, v_texCoord);
  vec4 storm = texture2D(u_storm, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
  if (storm.a < 0.5) {
    gl_FragColor = frame;
    return;
  }

  float code = floor(storm.r * 255.0 + 0.5);
  if (code < 1.5) {
    gl_FragColor = vec4(u_backgroundColor, 1.0);
  } else if (code < 2.5) {
    gl_FragColor = vec4(u_foregroundColor, 1.0);
  } else {
    gl_FragColor = vec4(u_backingColor, 1.0);
  }
}
`;

const GPU_STORM_OVER_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_storm;
uniform vec3 u_backgroundColor;
uniform vec3 u_foregroundColor;
uniform vec3 u_backingColor;
varying vec2 v_texCoord;

void main() {
  vec4 storm = texture2D(u_storm, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
  if (storm.a < 0.5) {
    discard;
  }

  float code = floor(storm.r * 255.0 + 0.5);
  if (code < 1.5) {
    gl_FragColor = vec4(u_backgroundColor, 1.0);
  } else if (code < 2.5) {
    gl_FragColor = vec4(u_foregroundColor, 1.0);
  } else {
    gl_FragColor = vec4(u_backingColor, 1.0);
  }
}
`;

const GPU_STORM_VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const GPU_STORM_FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform vec2 u_mapSize;
uniform float u_tileSize;
uniform float u_time;
uniform float u_seed;
uniform float u_threshold;
uniform float u_noiseScale;
uniform float u_speedX;
uniform float u_speedY;
uniform float u_speedZ;
uniform vec2 u_cameraPixelOffset;
uniform float u_checkerSize;
uniform vec2 u_playerWorld;
uniform float u_playerStormBlob;
uniform float u_lensEdgeScale;
uniform float u_lensPower;
uniform float u_lensNoiseRadial;
uniform float u_lensNoiseTangential;
uniform float u_lensDefectDensity;
uniform sampler2D u_grid;
uniform sampler2D u_perm;
uniform sampler2D u_mask;
uniform vec2 u_maskSize;
uniform vec2 u_maskOffset;
uniform float u_maskMode;

const int GPU_VISIBILITY_MASK_SPANS = 64;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float permLookup(float index) {
  float wrapped = mod(floor(index), 256.0);
  return floor(texture2D(u_perm, vec2((wrapped + 0.5) / 256.0, 0.5)).r * 255.0 + 0.5);
}

float gradientDot(float gradientIndex, float x, float y, float z) {
  float h = mod(gradientIndex, 12.0);
  if (h < 0.5) {
    return x + y;
  }
  if (h < 1.5) {
    return -x + y;
  }
  if (h < 2.5) {
    return x - y;
  }
  if (h < 3.5) {
    return -x - y;
  }
  if (h < 4.5) {
    return x + z;
  }
  if (h < 5.5) {
    return -x + z;
  }
  if (h < 6.5) {
    return x - z;
  }
  if (h < 7.5) {
    return -x - z;
  }
  if (h < 8.5) {
    return y + z;
  }
  if (h < 9.5) {
    return -y + z;
  }
  if (h < 10.5) {
    return y - z;
  }
  return -y - z;
}

float simplexCorner(float ii, float jj, float kk, float i, float j, float k, float x, float y, float z) {
  float influence = 0.6 - x * x - y * y - z * z;
  if (influence < 0.0) {
    return 0.0;
  }

  float hash = permLookup(ii + i + permLookup(jj + j + permLookup(kk + k)));
  influence *= influence;
  return influence * influence * gradientDot(hash, x, y, z);
}

float simplexNoise3D(vec3 p) {
  float skew = (p.x + p.y + p.z) / 3.0;
  float i = floor(p.x + skew);
  float j = floor(p.y + skew);
  float k = floor(p.z + skew);
  float unskew = (i + j + k) / 6.0;
  float x0 = p.x - (i - unskew);
  float y0 = p.y - (j - unskew);
  float z0 = p.z - (k - unskew);
  float i1;
  float j1;
  float k1;
  float i2;
  float j2;
  float k2;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1.0; j1 = 0.0; k1 = 0.0; i2 = 1.0; j2 = 1.0; k2 = 0.0;
    } else if (x0 >= z0) {
      i1 = 1.0; j1 = 0.0; k1 = 0.0; i2 = 1.0; j2 = 0.0; k2 = 1.0;
    } else {
      i1 = 0.0; j1 = 0.0; k1 = 1.0; i2 = 1.0; j2 = 0.0; k2 = 1.0;
    }
  } else if (y0 < z0) {
    i1 = 0.0; j1 = 0.0; k1 = 1.0; i2 = 0.0; j2 = 1.0; k2 = 1.0;
  } else if (x0 < z0) {
    i1 = 0.0; j1 = 1.0; k1 = 0.0; i2 = 0.0; j2 = 1.0; k2 = 1.0;
  } else {
    i1 = 0.0; j1 = 1.0; k1 = 0.0; i2 = 1.0; j2 = 1.0; k2 = 0.0;
  }

  float x1 = x0 - i1 + 1.0 / 6.0;
  float y1 = y0 - j1 + 1.0 / 6.0;
  float z1 = z0 - k1 + 1.0 / 6.0;
  float x2 = x0 - i2 + 1.0 / 3.0;
  float y2 = y0 - j2 + 1.0 / 3.0;
  float z2 = z0 - k2 + 1.0 / 3.0;
  float x3 = x0 - 0.5;
  float y3 = y0 - 0.5;
  float z3 = z0 - 0.5;
  float ii = mod(i, 256.0);
  float jj = mod(j, 256.0);
  float kk = mod(k, 256.0);

  return 32.0 * (
    simplexCorner(ii, jj, kk, 0.0, 0.0, 0.0, x0, y0, z0) +
    simplexCorner(ii, jj, kk, i1, j1, k1, x1, y1, z1) +
    simplexCorner(ii, jj, kk, i2, j2, k2, x2, y2, z2) +
    simplexCorner(ii, jj, kk, 1.0, 1.0, 1.0, x3, y3, z3)
  );
}

float lensNoiseUnit(vec2 p, float salt) {
  vec2 q = floor(p);
  return hash13(vec3(q.x * 0.071 + u_seed * 173.0, q.y * 0.097, salt));
}

float lensNoiseSigned(vec2 p, float salt) {
  return lensNoiseUnit(p, salt) * 2.0 - 1.0;
}

vec2 inverseLensSource(vec2 screen) {
  if (u_lensEdgeScale <= 1.0001) {
    return screen;
  }

  vec2 center = u_resolution * 0.5;
  vec2 delta = screen + vec2(0.5) - center;
  float screenRadius = length(delta);
  if (screenRadius <= 0.0001) {
    return screen;
  }

  float radius = min(u_resolution.x, u_resolution.y) * 0.5;
  float maxSourceRadius = radius * u_lensEdgeScale;
  float lo = screenRadius;
  float hi = maxSourceRadius;
  for (int i = 0; i < 8; i += 1) {
    float mid = (lo + hi) * 0.5;
    float t = clamp(mid / maxSourceRadius, 0.0, 1.0);
    float scale = 1.0 + (u_lensEdgeScale - 1.0) * pow(t, max(1.0, u_lensPower));
    float projected = mid / scale;
    if (projected < screenRadius) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  float sourceRadius = hi;
  vec2 unit = delta / screenRadius;
  vec2 source = center + unit * sourceRadius - vec2(0.5);
  float t = clamp(sourceRadius / maxSourceRadius, 0.0, 1.0);
  float scale = 1.0 + (u_lensEdgeScale - 1.0) * pow(t, max(1.0, u_lensPower));
  float falloff = (scale - 1.0) / max(0.0001, u_lensEdgeScale - 1.0);
  float defectDensity = clamp(falloff * u_lensDefectDensity, 0.0, 1.0);
  if (lensNoiseUnit(source, 73.31) <= defectDensity) {
    vec2 tangent = vec2(-unit.y, unit.x);
    source += unit * lensNoiseSigned(source, 17.91) * u_lensNoiseRadial;
    source += tangent * lensNoiseSigned(source, 41.27) * u_lensNoiseTangential;
  }
  return source;
}

bool gpuStormSafeTile(vec2 tile) {
  if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= u_mapSize.x || tile.y >= u_mapSize.y) {
    return false;
  }

  vec4 grid = texture2D(u_grid, (tile + vec2(0.5)) / u_mapSize);
  return grid.g > 0.5 && grid.r * 255.0 < 1.5;
}

float gpuStormDistanceToSafe(vec2 tile, vec2 world) {
  float nearest = 99.0;
  for (int offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (int offsetX = -2; offsetX <= 2; offsetX += 1) {
      vec2 candidate = tile + vec2(float(offsetX), float(offsetY));
      if (!gpuStormSafeTile(candidate)) {
        continue;
      }

      vec2 rectMin = candidate * u_tileSize;
      vec2 rectMax = rectMin + vec2(u_tileSize);
      vec2 delta = max(max(rectMin - world, world - rectMax), vec2(0.0));
      nearest = min(nearest, length(delta) / max(1.0, u_tileSize));
    }
  }
  return nearest;
}

float gpuStormValueAt(vec2 world) {
  vec2 visualWorld = floor(world);
  vec3 p = vec3(
    (visualWorld.x + u_time * u_speedX) * u_noiseScale,
    (visualWorld.y + u_time * u_speedY) * u_noiseScale,
    u_time * u_speedZ + u_seed * 11.0
  );
  return simplexNoise3D(p);
}

bool gpuStormBoundaryPixel(vec2 tile, vec2 world) {
  vec2 pixelWorld = floor(world);
  vec2 local = pixelWorld - tile * u_tileSize;
  bool boundary = false;
  boundary = boundary || (local.x < 1.0 && !gpuStormSafeTile(tile + vec2(-1.0, 0.0)));
  boundary = boundary || (local.x >= u_tileSize - 1.0 && !gpuStormSafeTile(tile + vec2(1.0, 0.0)));
  boundary = boundary || (local.y < 1.0 && !gpuStormSafeTile(tile + vec2(0.0, -1.0)));
  boundary = boundary || (local.y >= u_tileSize - 1.0 && !gpuStormSafeTile(tile + vec2(0.0, 1.0)));
  return boundary && gpuStormValueAt(world) >= 0.0;
}

float decodeMaskCoordinate(vec2 bytes) {
  vec2 value = floor(bytes * 255.0 + 0.5);
  return value.x * 256.0 + value.y;
}

bool gpuVisibilityMaskContains(vec2 source) {
  vec2 maskPoint = floor(source) - u_maskOffset;
  if (maskPoint.x < 0.0 || maskPoint.y < 0.0 || maskPoint.y >= u_maskSize.y) {
    return false;
  }

  float row = maskPoint.y;
  float x = maskPoint.x;
  for (int spanIndex = 0; spanIndex < GPU_VISIBILITY_MASK_SPANS; spanIndex += 1) {
    vec2 coord = (vec2(float(spanIndex) + 0.5, row + 0.5)) / u_maskSize;
    vec4 encoded = texture2D(u_mask, coord);
    float start = decodeMaskCoordinate(encoded.rg);
    float end = decodeMaskCoordinate(encoded.ba);
    if (end <= start) {
      continue;
    }
    if (x >= start && x < end) {
      return true;
    }
  }
  return false;
}

bool gpuVisibilityMaskAllows(vec2 source) {
  if (u_maskMode <= 0.5) {
    return true;
  }
  bool contains = gpuVisibilityMaskContains(source);
  if (u_maskMode < 1.5) {
    return contains;
  }
  return !contains;
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x - 0.5, u_resolution.y - gl_FragCoord.y - 0.5);
  vec2 sceneCenter = u_resolution * 0.5;
  if (length(screen + vec2(0.5) - sceneCenter) > min(u_resolution.x, u_resolution.y) * 0.5) {
    discard;
  }

  vec2 source = inverseLensSource(screen);
  if (!gpuVisibilityMaskAllows(source)) {
    discard;
  }

  vec2 world = source + u_camera;
  vec2 tile = floor(world / max(1.0, u_tileSize));

  bool inMap = tile.x >= 0.0 && tile.y >= 0.0 && tile.x < u_mapSize.x && tile.y < u_mapSize.y;
  float playable = 0.0;
  float stormState = 2.0;
  float solid = 0.0;
  bool safe = false;
  if (inMap) {
    vec4 grid = texture2D(u_grid, (tile + vec2(0.5)) / u_mapSize);
    stormState = grid.r * 255.0;
    playable = grid.g;
    solid = grid.b;
    safe = playable > 0.5 && stormState < 1.5;
  }

  float stormCode = 0.0;
  if (safe) {
    if (gpuStormBoundaryPixel(tile, world)) {
      stormCode = 2.0;
    }
  } else {
    float stormDistance = gpuStormDistanceToSafe(tile, world);
    float playerStormDistance = 99.0;
    if (u_playerStormBlob > 0.5) {
      float playerDistance = length(world - u_playerWorld) / max(1.0, u_tileSize);
      playerStormDistance = max(0.0, playerDistance - 1.0);
    }
    float edgeDistance = min(stormDistance, playerStormDistance);
    float stormValue = gpuStormValueAt(world);
    float fade = clamp(edgeDistance * 0.5, 0.0, 1.0);
    float foregroundThreshold = mix(u_threshold, 1.02, fade);
    float voidThreshold = fade;
    float normalizedStorm = stormValue * 0.5 + 0.5;
    if (normalizedStorm >= voidThreshold) {
      stormCode = stormValue >= foregroundThreshold ? 2.0 : 1.0;
    } else {
      stormCode = 3.0;
    }
  }

  if (stormCode <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(stormCode / 255.0, 0.0, 0.0, 1.0);
}
`;

function createCircleClipSpans(width, height, inset = 0) {
  const starts = new Int16Array(height);
  const ends = new Int16Array(height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(0, Math.min(width, height) / 2 - Math.max(0, inset));
  const radiusSquared = radius * radius;

  for (let y = 0; y < height; y += 1) {
    const dy = y + 0.5 - centerY;
    const horizontalSquared = radiusSquared - dy * dy;
    if (horizontalSquared < 0) {
      starts[y] = width;
      ends[y] = 0;
      continue;
    }

    const horizontal = Math.sqrt(horizontalSquared);
    starts[y] = clamp(Math.ceil(centerX - horizontal - 0.5), 0, width);
    ends[y] = clamp(Math.floor(centerX + horizontal - 0.5) + 1, 0, width);
  }

  return { starts, ends };
}

function createWorldLens(width, height) {
  const radius = Math.min(width, height) / 2;
  const edgeScale = Math.max(1, WORLD_LENS_EDGE_SCALE);
  const sourcePadding = worldLensSourcePadding(width, height);

  return {
    centerX: width / 2,
    centerY: height / 2,
    radius,
    edgeScale,
    power: Math.max(1, WORLD_LENS_POWER),
    maxSourceRadius: radius * edgeScale,
    noiseRadial: WORLD_LENS_NOISE_RADIAL,
    noiseTangential: WORLD_LENS_NOISE_TANGENTIAL,
    sourcePadding
  };
}

function worldLensSourcePadding(width, height) {
  const radius = Math.min(width, height) / 2;
  return Math.ceil(radius * (Math.max(1, WORLD_LENS_EDGE_SCALE) - 1)) + RENDER.tileSize * 2;
}

function projectLensPixel(x, y, lens) {
  const dx = x + 0.5 - lens.centerX;
  const dy = y + 0.5 - lens.centerY;
  const sourceRadius = Math.hypot(dx, dy);

  if (sourceRadius > lens.maxSourceRadius) {
    return null;
  }

  if (sourceRadius === 0) {
    const centerX = Math.floor(lens.centerX);
    const centerY = Math.floor(lens.centerY);
    return {
      baseX: centerX,
      baseY: centerY,
      x: centerX,
      y: centerY
    };
  }

  const t = clamp(sourceRadius / lens.maxSourceRadius, 0, 1);
  const scale = 1 + (lens.edgeScale - 1) * Math.pow(t, lens.power);
  const screenRadius = sourceRadius / scale;
  const unitX = dx / sourceRadius;
  const unitY = dy / sourceRadius;
  const baseX = Math.floor(lens.centerX + unitX * screenRadius);
  const baseY = Math.floor(lens.centerY + unitY * screenRadius);
  const lensFalloff = (scale - 1) / Math.max(0.0001, lens.edgeScale - 1);
  const defectDensity = clamp(lensFalloff * WORLD_LENS_DEFECT_DENSITY, 0, 1);

  if (lensNoiseUnitAt(x, y, 0x36d2ae31) > defectDensity) {
    return {
      baseX,
      baseY,
      x: baseX,
      y: baseY
    };
  }

  const radialNoise = lensNoiseAt(x, y, 0x4f1bbcdc) * lens.noiseRadial;
  const tangentNoise = lensNoiseAt(x, y, 0x8ab23d31) * lens.noiseTangential;

  return {
    baseX,
    baseY,
    x: Math.floor(lens.centerX + unitX * (screenRadius + radialNoise) - unitY * tangentNoise),
    y: Math.floor(lens.centerY + unitY * (screenRadius + radialNoise) + unitX * tangentNoise)
  };
}

function lensNoiseAt(x, y, salt) {
  return lensNoiseUnitAt(x, y, salt) * 2 - 1;
}

function lensNoiseUnitAt(x, y, salt) {
  let value = Math.imul(Math.floor(x), 374761393) ^
    Math.imul(Math.floor(y), 668265263) ^
    salt;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967295;
}

function createPixelTextRenderer(width, height, colorsForText = () => ({
  foreground: RENDER.foreground,
  background: RENDER.background
})) {
  return {
    measure(text, options = {}) {
      return measureBitmapText(text, options);
    },
    draw(ctx, text, x, y, options = {}) {
      const lines = options.lines || [text];
      const scale = textScale(options);
      const lineHeight = options.lineHeight || 9 * scale;
      const maxWidth = options.width || width;
      const heightPx = Math.max(1, lineHeight * lines.length);
      ctx.fillStyle = options.color || RENDER.foreground;

      lines.forEach((line, index) => {
        drawBitmapTextLine(ctx, String(line), x, y + index * lineHeight, maxWidth, scale, options, colorsForText());
      });

      return {
        width: Math.max(1, Math.min(maxWidth, Math.max(...lines.map((line) => this.measure(line, options))))),
        height: heightPx
      };
    }
  };
}

function measureBitmapText(text, options = {}) {
  const scale = textScale(options);
  const characters = String(text).toUpperCase();
  let width = 0;

  for (const character of characters) {
    width += (glyphWidth(character) + 1) * scale;
  }

  return Math.max(0, width - scale);
}

function drawBitmapTextLine(ctx, text, x, y, maxWidth, scale, options = {}, colors = {}) {
  let cursorX = x;
  const selectionStart = Math.min(options.selectionStart ?? -1, options.selectionEnd ?? -1);
  const selectionEnd = Math.max(options.selectionStart ?? -1, options.selectionEnd ?? -1);

  for (let index = 0; index < String(text).length; index += 1) {
    const character = String(text)[index].toUpperCase();
    const glyph = BITMAP_GLYPHS[character] || BITMAP_GLYPHS["?"];
    const glyphWidthPx = glyphWidth(character) * scale;
    if (cursorX + glyphWidthPx > x + maxWidth) {
      break;
    }

    const selected = index >= selectionStart && index < selectionEnd;
    const textColor = selected
      ? options.selectionColor || colors.background || RENDER.background
      : options.color || colors.foreground || RENDER.foreground;
    const borderColor = selected
      ? options.selectionBackground || colors.foreground || RENDER.foreground
      : bitmapTextBorderColor(textColor, options, colors);

    if (selected) {
      ctx.fillStyle = options.selectionBackground || colors.foreground || RENDER.foreground;
      ctx.fillRect(cursorX - Math.floor(scale / 2), y - scale, glyphWidthPx + scale, 9 * scale);
    }

    drawBitmapGlyph(ctx, glyph, cursorX, y, scale, textColor, borderColor);
    cursorX += glyphWidthPx + scale;
  }
}

function drawBitmapGlyph(ctx, glyph, x, y, scale, color, borderColor) {
  if (borderColor) {
    if (borderColor.mode === "adaptive") {
      drawBitmapGlyphAdaptiveBorder(ctx, glyph, x, y, scale, borderColor);
    } else {
      ctx.fillStyle = borderColor;
      drawBitmapGlyphBorder(ctx, glyph, x, y, scale);
    }
  }

  ctx.fillStyle = color;
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") {
        ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
      }
    }
  }
}

function drawBitmapGlyphAdaptiveBorder(ctx, glyph, x, y, scale, borderColor) {
  const background = borderColor.background || RENDER.background;
  const backing = borderColor.backing || "#000000";
  const packedBacking = packColor(backing) >>> 0;
  const transparentIsBacking = borderColor.transparentAsBacking === true;

  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] !== "1") {
        continue;
      }

      const startX = x + col * scale - 1;
      const startY = y + row * scale - 1;
      const size = scale + 2;
      for (let py = startY; py < startY + size; py += 1) {
        for (let px = startX; px < startX + size; px += 1) {
          const sample = typeof ctx.getPixelColor === "function"
            ? ctx.getPixelColor(px, py)
            : null;
          ctx.fillStyle = sample === packedBacking || (transparentIsBacking && sample === 0)
            ? backing
            : background;
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }
}

function drawBitmapGlyphBorder(ctx, glyph, x, y, scale) {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") {
        ctx.fillRect(x + col * scale - 1, y + row * scale - 1, scale + 2, scale + 2);
      }
    }
  }
}

function bitmapTextBorderColor(textColor, options = {}, colors = {}) {
  if (options.borderColor) {
    if (options.borderColor === "auto") {
      return adaptiveBitmapTextBorder(colors, options);
    }
    return options.borderColor;
  }

  const foreground = colors.foreground || RENDER.foreground;
  const background = colors.background || RENDER.background;
  return sameColor(textColor, background)
    ? foreground
    : adaptiveBitmapTextBorder(colors, options);
}

function adaptiveBitmapTextBorder(colors = {}, options = {}) {
  return {
    mode: "adaptive",
    background: options.borderBackgroundColor || colors.background || RENDER.background,
    backing: options.borderBackingColor || colors.backing || "#000000",
    transparentAsBacking: options.borderTransparentAsBacking === true
  };
}

function sameColor(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function glyphWidth(character) {
  const glyph = BITMAP_GLYPHS[String(character).toUpperCase()] || BITMAP_GLYPHS["?"];
  return glyph[0].length;
}

function textScale(options = {}) {
  if (options.scale) {
    return options.scale;
  }

  return (options.fontSize || 8) >= 10 ? 2 : 1;
}

function colorFor(value, cache) {
  if (!cache.has(value)) {
    cache.set(value, packColor(value));
  }

  return cache.get(value);
}

function packColor(hex) {
  const normalized = String(hex).replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return (255 << 24) | (blue << 16) | (green << 8) | red;
}

function rgbFloatsForHex(hex) {
  const normalized = String(hex || "#000000").replace("#", "").padEnd(6, "0");
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255
  ];
}

function getViewportSize() {
  const viewport = window.visualViewport;
  const padding = canvasEdgePaddingPx();
  return {
    width: Math.max(1, Math.floor((viewport?.width || window.innerWidth) - padding * 2)),
    height: Math.max(1, Math.floor((viewport?.height || window.innerHeight) - padding * 2))
  };
}

function canvasEdgePaddingPx() {
  const fontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return (Number.isFinite(fontSize) ? fontSize : 16) * CANVAS_EDGE_PADDING_EM;
}

function mergeFramePerfBuckets(target, ...sources) {
  if (!target) {
    return target;
  }

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number") {
        target[key] = (target[key] || 0) + value;
      }
    }
  }

  return target;
}

function drawFrame(ctx, snapshot, options, colors, textRenderer, particleState) {
  const perfBuckets = options.measurePerf === true
    ? {
      visibilityMs: 0,
      ghostMs: 0,
      ghostCheckerMs: 0,
      ghostOutlineMs: 0,
      ghostStormMs: 0,
      backgroundMs: 0,
      starsMs: 0,
      asteroidMs: 0,
      entitiesMs: 0,
      particleEmitMs: 0,
      particlesMs: 0,
      raysMs: 0,
      shipsMs: 0,
      hudMs: 0
    }
    : null;
  options.perfBuckets = perfBuckets;
  const measureBucket = perfBuckets
    ? (key, callback) => {
      const start = performance.now();
      const value = callback();
      perfBuckets[key] += performance.now() - start;
      return value;
    }
    : (_key, callback) => callback();
  const renderPhase = options.renderPhase || "full";
  const shouldDrawWorldBase = renderPhase === "full" || renderPhase === "world" || renderPhase === "worldBase";
  const shouldDrawWorldOverlay = renderPhase === "full" || renderPhase === "world" || renderPhase === "worldOverlay";
  const shouldDrawWorld = shouldDrawWorldBase || shouldDrawWorldOverlay;
  const shouldDrawHud = renderPhase === "full" || renderPhase === "hud";
  const roomState = options.room?.state || "";
  const gpuWorldEffectsAllowed = roomState === "active" || roomState === "ended";

  ctx.imageSmoothingEnabled = false;
  if (options.transparentBacking && typeof ctx.clear === "function") {
    ctx.clear();
  } else {
    ctx.fillStyle = colors.backing || "#000000";
    ctx.fillRect(0, 0, ctx.width, ctx.height);
  }
  ctx.fillStyle = colors.foreground;

  if (!snapshot) {
    if (shouldDrawWorld) {
      beginWorldViewport(ctx, colors);
      endWorldViewport(ctx);
    }
    if (shouldDrawHud && (options.room || Object.keys(options.roomButtons || {}).length > 0)) {
      drawRoomOverlay(ctx, options, null, colors, textRenderer);
    }
    return;
  }

  const sharedState = options.renderState;
  let predictedPlayer = sharedState?.predictedPlayer;
  let renderPlayers = sharedState?.renderPlayers;
  let camera = sharedState?.camera;
  let asteroidMiningTargets = sharedState?.asteroidMiningTargets;
  let localPlayer = sharedState?.localPlayer;
  let cameraPlayer = sharedState?.cameraPlayer;
  let visibility = sharedState?.visibility;
  let worldRenderPlayers = sharedState?.worldRenderPlayers;
  let localShipDrawsAfterVisibility = sharedState?.localShipDrawsAfterVisibility || false;

  if (!sharedState?.ready) {
    predictedPlayer = options.predictedPlayer?.id === options.playerId ? options.predictedPlayer : null;
    renderPlayers = snapshot.players.map((player) => {
      if (player.id === options.playerId) {
        return predictedPlayer || {
          ...player,
          aimAngle: options.aimAngle ?? player.aimAngle,
          mining: options.mining ?? player.mining
        };
      }

      return extrapolateRemotePlayer(player, snapshot, options.timeSeconds);
    });
    renderPlayers = applyVisualShipAngles(renderPlayers, options.visualShipAngles, options.dtSeconds);
    camera = cameraForSnapshot(
      snapshot,
      options.cameraPlayerId || options.playerId,
      options.timeSeconds,
      predictedPlayer,
      renderPlayers,
      ctx.width,
      ctx.height
    );
    asteroidMiningTargets = asteroidMiningTargetMap(snapshot);
    localPlayer = renderPlayers.find((player) => player.id === options.playerId);
    cameraPlayer = renderPlayers.find((player) => player.id === (options.cameraPlayerId || options.playerId)) ||
      localPlayer ||
      renderPlayers.find((player) => player.alive !== false) ||
      renderPlayers[0] ||
      null;
    visibility = shouldDrawWorld
      ? measureBucket("visibilityMs", () => (
        createAsteroidVisibilityMask(ctx, options, options.asteroid, cameraPlayer, camera)
      ))
      : null;
    worldRenderPlayers = visibility
      ? renderPlayers.filter((player) => playerTouchesAsteroidVisibility(visibility, player))
      : renderPlayers;
    localShipDrawsAfterVisibility = Boolean(visibility && localPlayer?.alive);

    if (sharedState) {
      Object.assign(sharedState, {
        ready: true,
        predictedPlayer,
        renderPlayers,
        camera,
        asteroidMiningTargets,
        localPlayer,
        cameraPlayer,
        visibility,
        worldRenderPlayers,
        localShipDrawsAfterVisibility
      });
    }
  }

  if (shouldDrawWorldBase) {
    if (options.playerMapLarge && options.playerMap?.cells && options.asteroid) {
      drawFullPlayerMapFrame(ctx, options, colors);
    } else {
      beginWorldViewport(ctx, colors, !visibility);
      if (visibility) {
        measureBucket("ghostMs", () => drawAsteroidVisibilityGhostMap(
          ctx,
          options.asteroid,
          camera,
          colors,
          options.timeSeconds ?? snapshot.tick / 60,
          visibility,
          options.gpuStormRenderer,
          options.gpuFrameStormReady === true && gpuWorldEffectsAllowed,
          options.gpuFrameCheckerReady === true && gpuWorldEffectsAllowed,
          perfBuckets
        ));
        if (typeof ctx.beginWorldMask === "function") {
          ctx.beginWorldMask(createAsteroidVisibilityWorldMask(visibility));
        }
        measureBucket("backgroundMs", () => drawVisibleBackground(ctx, options.asteroid, camera, visibility, colors));
        ctx.fillStyle = colors.foreground;
        measureBucket("starsMs", () => drawStars(ctx, snapshot, camera, visibility));
      } else {
        measureBucket("starsMs", () => drawStars(ctx, snapshot, camera));
      }
      if (options.asteroid) {
        measureBucket("asteroidMs", () => drawAsteroid(
          ctx,
          options.asteroid,
          camera,
          colors,
          options.timeSeconds ?? snapshot.tick / 60,
          asteroidMiningTargets,
          visibility,
          options.gpuStormRenderer,
          cameraPlayer,
          options.gpuFrameStormReady === true && gpuWorldEffectsAllowed
        ));
      } else {
        measureBucket("asteroidMs", () => drawWorldBounds(ctx, snapshot, camera));
      }
      endWorldViewport(ctx);
    }
  }

  if (shouldDrawWorldOverlay && !(options.playerMapLarge && options.playerMap?.cells && options.asteroid)) {
    beginWorldViewport(ctx, colors, false);
    if (visibility && typeof ctx.beginWorldMask === "function") {
      ctx.beginWorldMask(createAsteroidVisibilityWorldMask(visibility));
    }

    measureBucket("entitiesMs", () => {
      for (const entity of snapshot.entities || []) {
        drawEntity(ctx, entity, camera, options, colors, textRenderer);
      }
    });

    measureBucket("particleEmitMs", () => {
      for (const renderPlayer of worldRenderPlayers) {
        if (renderPlayer.thrusting) {
          emitThrusterParticles(particleState, renderPlayer, options.dtSeconds);
        }

        if (renderPlayer.mining && miningRayHasHit(renderPlayer.miningRay)) {
          emitMiningParticles(particleState, renderPlayer, options.dtSeconds);
        }
      }
    });

    measureBucket("particlesMs", () => {
      updateParticles(particleState.particles, options.dtSeconds);
      updateParticles(particleState.miningParticles, options.dtSeconds);
      drawParticles(ctx, particleState.particles, camera, colors, options.timeSeconds);
    });

    measureBucket("raysMs", () => {
      for (const renderPlayer of worldRenderPlayers) {
        if (renderPlayer.mining) {
          drawWithoutWorldMask(ctx, () => {
            drawMiningRay(ctx, renderPlayer, camera, options.asteroid, options.timeSeconds ?? snapshot.tick / 60, colors);
          });
        }
      }
    });

    measureBucket("shipsMs", () => {
      for (const renderPlayer of worldRenderPlayers) {
        if (localShipDrawsAfterVisibility && renderPlayer.id === localPlayer.id) {
          continue;
        }
        drawShip(
          ctx,
          renderPlayer,
          camera,
          options.asteroid,
          colors,
          options.timeSeconds ?? snapshot.tick / 60,
          textRenderer,
          options.room?.state === "ended"
        );
      }
    });

    drawControllerAimCursor(ctx, localPlayer, camera, options.controllerAimCursor, colors);

    if (localShipDrawsAfterVisibility) {
      measureBucket("shipsMs", () => drawWithoutWorldMask(ctx, () => {
        drawShip(
          ctx,
          localPlayer,
          camera,
          options.asteroid,
          colors,
          options.timeSeconds ?? snapshot.tick / 60,
          textRenderer,
          options.room?.state === "ended"
        );
      }));
    }

    measureBucket("particlesMs", () => drawWithoutWorldMask(ctx, () => {
      drawParticles(ctx, particleState.miningParticles, camera, colors, options.timeSeconds);
    }));

    measureBucket("raysMs", () => {
      for (const renderPlayer of worldRenderPlayers) {
        if (renderPlayer.mining) {
          drawWithoutWorldMask(ctx, () => {
            drawMiningRayHitpoints(ctx, renderPlayer, camera, options.asteroid, options.timeSeconds ?? snapshot.tick / 60, colors);
          });
        }
      }
    });

    if (options.build?.active && localPlayer?.alive && options.asteroid) {
      drawWithoutWorldMask(ctx, () => {
        drawBuildPreview(ctx, options.asteroid, localPlayer, renderPlayers, camera, options.build, colors);
      });
    }

    for (const renderPlayer of worldRenderPlayers) {
      drawTalkBubble(ctx, renderPlayer, camera, colors, textRenderer);
    }
    drawBotDebugWorldOverlay(ctx, options.botDebugOverlay, camera);
    endWorldViewport(ctx);
  }
  if (shouldDrawHud) measureBucket("hudMs", () => {
    const leaveConfirmActive = options.leaveConfirm?.active === true;
    if (options.room?.state === "active" && !leaveConfirmActive) {
      if (!localPlayer || !localPlayer.alive) {
        drawSpectatorHud(ctx, options, localPlayer, cameraPlayer, colors, textRenderer, snapshot);
      } else {
        const playersLeft = (snapshot.players || []).filter((player) => player.alive === true).length;
        drawPlayerHud(
          ctx,
          localPlayer,
          colors,
          textRenderer,
          options.hudFlash,
          options.timeSeconds,
          playersLeft
        );
        drawUpgradeHud(ctx, localPlayer, options.upgrades, colors, textRenderer, options.controllerActive, options.mobileActive);
        drawBuildHud(ctx, localPlayer, options.build, options.upgrades, colors, textRenderer, options.controllerActive, options.mobileActive);
        drawMapHud(ctx, localPlayer, options.upgrades, colors, textRenderer, options.controllerActive, options.mobileActive, options.playerMapFeatureEnabled);
        drawMobileLeaveHud(ctx, localPlayer, options, colors, textRenderer);
      }
    }
    drawRoomOverlay(ctx, { ...options, snapshot }, localPlayer, colors, textRenderer);
    drawLeaveConfirmHud(ctx, options.leaveConfirm, options, colors, textRenderer);
    drawBotChunkMap(ctx, options.botChunkMap, colors, textRenderer);
    drawEliminationNotices(ctx, options.eliminationNotices || [], colors, textRenderer, options.timeSeconds);
    drawChatOverlay(ctx, options.chat, colors, textRenderer, options.timeSeconds);
    drawControllerCursor(ctx, options.controllerCursor, colors);
    drawBotDebugPanel(ctx, options.botDebugOverlay, textRenderer);
  });
}

function drawMinimapOverlay(ctx, width, height, mapState, asteroid, colors, timeSeconds = 0) {
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, width, height);
  if (!mapState?.cells || !asteroid) {
    return;
  }

  const mapCircle = playerMapArenaCircle(mapState, asteroid);
  const logicalSize = playerMapCompactDiameter(mapCircle);
  const logicalRadius = playerMapCompactRadius(mapCircle);
  const compactCellSize = playerMapCompactCellSize();
  const scratch = playerMapScratch(logicalSize, logicalSize);
  const scratchCtx = scratch?.context;
  if (!scratchCtx) {
    return;
  }

  scratchCtx.clearRect(0, 0, logicalSize, logicalSize);
  drawPlayerMap(scratchCtx, mapState, asteroid, colors, {
    centerX: logicalSize / 2,
    centerY: logicalSize / 2,
    radius: logicalRadius,
    cellSize: compactCellSize,
    timeSeconds,
    stormMode: "full",
    stormBoundaryMode: "live",
    compactMap: true,
    compactSampleTiles: PLAYER_MAP_COMPACT_SAMPLE_TILES,
    drawMiniShip: false,
    border: false
  });

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch.canvas, 0, 0, logicalSize, logicalSize, 0, 0, width, height);

  const viewCircle = playerMapViewCirclePixels(
    mapState.viewCircle,
    logicalSize / 2 - mapCircle.x * compactCellSize,
    logicalSize / 2 - mapCircle.y * compactCellSize,
    compactCellSize
  );
  if (viewCircle) {
    const scaleX = width / logicalSize;
    const scaleY = height / logicalSize;
    const miniCircle = {
      ...viewCircle,
      x: viewCircle.x * scaleX,
      y: viewCircle.y * scaleY,
      radius: viewCircle.radius * Math.min(scaleX, scaleY)
    };
    fillPlayerMapMiniShipViewInterior(ctx, miniCircle, colors);
    drawPlayerMapMiniShipViewRing(ctx, miniCircle, colors);
    drawPlayerMapMiniShip(ctx, miniCircle, colors);
  }
}

function playerMapScratch(width, height) {
  if (!playerMapScratchCanvas) {
    playerMapScratchCanvas = document.createElement("canvas");
    playerMapScratchContext = playerMapScratchCanvas.getContext("2d");
  }

  if (!playerMapScratchContext) {
    return null;
  }

  if (playerMapScratchCanvas.width !== width || playerMapScratchCanvas.height !== height) {
    playerMapScratchCanvas.width = width;
    playerMapScratchCanvas.height = height;
  }

  playerMapScratchContext.imageSmoothingEnabled = false;
  return {
    canvas: playerMapScratchCanvas,
    context: playerMapScratchContext
  };
}

function drawGameLensOverlay(ctx, snapshot, options, colors, textRenderer, particleState) {
  if (!ctx) {
    return;
  }

  const previewRoom = options.room
    ? { ...options.room, state: "preview" }
    : { state: "preview" };
  drawFrame(ctx, snapshot, {
    ...options,
    transparentBacking: true,
    playerMapLarge: false,
    playerMap: null,
    room: previewRoom,
    roomButtons: {},
    leaveConfirm: null,
    botChunkMap: null,
    botDebugOverlay: null,
    eliminationNotices: [],
    chat: null,
    controllerCursor: null
  }, colors, textRenderer, particleState);
}

function drawFullPlayerMapFrame(ctx, options, colors) {
  ctx.beginCircleClip();
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(0, 0, ctx.width, ctx.height);
  const visualRadius = Math.min(ctx.width, ctx.height) / 2;
  drawPlayerMap(ctx, options.playerMap, options.asteroid, colors, {
    centerX: ctx.width / 2,
    centerY: ctx.height / 2,
    radius: visualRadius,
    timeSeconds: options.timeSeconds || 0,
    stormMode: "full",
    stormBoundaryMode: "live",
    border: false
  });
  ctx.endClip();
}

function beginWorldViewport(ctx, colors, fillBackground = true) {
  ctx.beginCircleClip();
  if (fillBackground) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, ctx.width, ctx.height);
  }
  ctx.beginLens(createWorldLens(ctx.width, ctx.height));
  ctx.fillStyle = colors.foreground;
}

function drawVisibleBackground(ctx, asteroid, camera, visibility, colors) {
  ctx.fillStyle = colors.background;
  if (!visibility || !asteroid?.storm) {
    const padding = visibility?.sourcePadding || 0;
    ctx.fillRect(-padding, -padding, ctx.width + padding * 2, ctx.height + padding * 2);
    return;
  }

  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const padding = visibility.sourcePadding || cameraCullPadding(camera);
  const minTileX = Math.floor((camera.x - padding) / tileSize) - 1;
  const maxTileX = Math.ceil((camera.x + ctx.width + padding) / tileSize) + 1;
  const minTileY = Math.floor((camera.y - padding) / tileSize) - 1;
  const maxTileY = Math.ceil((camera.y + ctx.height + padding) / tileSize) + 1;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    let runStartTileX = null;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const isStorm = stormTileStateAt(asteroid, tileX, tileY) === STORM_STATE.storm;
      if (!isStorm && runStartTileX === null) {
        runStartTileX = tileX;
      }

      if ((isStorm || tileX === maxTileX) && runStartTileX !== null) {
        const endTileX = isStorm ? tileX : tileX + 1;
        ctx.fillRect(
          Math.round(runStartTileX * tileSize - camera.x),
          Math.round(tileY * tileSize - camera.y),
          (endTileX - runStartTileX) * tileSize,
          tileSize
        );
        runStartTileX = null;
      }
    }
  }
}

function endWorldViewport(ctx) {
  if (typeof ctx.endWorldMask === "function") {
    ctx.endWorldMask();
  }
  ctx.endLens();
  ctx.endClip();
}

function drawWithoutWorldMask(ctx, callback) {
  if (typeof ctx.withoutWorldMask === "function") {
    return ctx.withoutWorldMask(callback);
  }

  return callback();
}

function drawRoomOverlay(ctx, options, localPlayer, colors, textRenderer) {
  const room = options.room || { state: "menu", maxPlayers: ENGINE.maxPlayers, players: [] };
  const state = room.state || "menu";

  if (state === "menu") {
    drawMenuOverlay(ctx, options, colors, textRenderer);
    return;
  }

  if (state === "waiting") {
    drawWaitingOverlay(ctx, room, options, colors, textRenderer, localPlayer);
    return;
  }

  if (state === "active" && (!localPlayer || !localPlayer.alive)) {
    return;
  }

  if (state === "ended") {
    drawEndedHud(ctx, room, options, colors, textRenderer);
  }
}

function drawMenuOverlay(ctx, options, colors, textRenderer) {
  drawRoomButtons(ctx, options, colors, textRenderer);
  if (options.menuRoom === "theme") {
    drawThemeTerminalHud(ctx, options, colors, textRenderer);
  }
}

function drawThemeTerminalHud(ctx, options, colors, textRenderer) {
  const label = `THEME - ${String(options.themeName || "RANDOM").toUpperCase()}`;
  const padding = HUD_PANEL_PADDING;
  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };
  const panel = mainHudPanelRect(
    ctx,
    Math.max(HUD_PANEL_MIN_WIDTH, textRenderer.measure(label, textOptions) + padding * 2),
    hudPanelHeightForRows(1)
  );
  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  textRenderer.draw(ctx, label, panel.x + padding, panel.y + padding, {
    ...textOptions,
    width: panel.width - padding * 2
  });

  const warningPosition = drawWaitingTerminalActions(
    ctx,
    panel.x + 2,
    panel.y + panel.height + 7,
    false,
    options,
    colors,
    textRenderer
  );
  drawWaitingDisabledFlash(ctx, warningPosition.x, warningPosition.y, options, colors, textRenderer);
}

function drawWaitingOverlay(ctx, room, options, colors, textRenderer, localPlayer) {
  const count = Number.isFinite(room.playerSlots) ? room.playerSlots : room.players?.length || 0;
  const maxPlayers = room.maxPlayers || ENGINE.maxPlayers;
  const minPlayers = room.minPlayers || ENGINE.lobby.minPlayers || 2;
  const secondsLeft = Math.max(0, Math.ceil(((room.autoStartAtMs || 0) - Date.now()) / 1000));
  const status = room.countdownArmed
    ? `STARTING ${formatClock(secondsLeft)}`
    : room.queued
      ? `QUEUE ${room.queuePosition || 1}`
      : count < minPlayers
      ? `NEED ${minPlayers} PLAYERS`
      : `START ${formatClock(secondsLeft)}`;

  if (room.countdownArmed) {
    drawStartingOverlay(ctx, secondsLeft, options, colors, textRenderer);
    return;
  }

  const playerHudPanel = localPlayer
    ? drawPlayerHud(ctx, localPlayer, colors, textRenderer, options.hudFlash, options.timeSeconds, count)
    : null;
  drawWaitingTerminalHud(ctx, room, count, maxPlayers, status, options, colors, textRenderer, playerHudPanel);
}

function drawWaitingTerminalHud(ctx, room, count, maxPlayers, status, options, colors, textRenderer, playerHudPanel) {
  const canStart = waitingRoomCanStart(room);
  const lobbyLabel = room.roomName
    ? `${String(room.roomName).toUpperCase()} ${count}/${maxPlayers}`
    : `LOBBY ${count}/${maxPlayers}`;
  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };
  const padding = HUD_PANEL_PADDING;
  const minWidth = playerHudPanel?.width || HUD_PANEL_MIN_WIDTH;
  const labelWidth = textRenderer.measure(lobbyLabel, textOptions);
  const statusWidth = textRenderer.measure(status, textOptions);
  const panel = mainHudPanelRect(
    ctx,
    Math.max(minWidth, labelWidth + padding * 2, statusWidth + padding * 2),
    hudPanelHeightForRows(2)
  );
  if (playerHudPanel) {
    panel.x = playerHudPanel.x;
    panel.y = playerHudPanel.y + playerHudPanel.height + 6;
  }

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  textRenderer.draw(ctx, lobbyLabel, panel.x + padding, panel.y + padding, {
    ...textOptions,
    width: panel.width - padding * 2
  });
  textRenderer.draw(ctx, status, panel.x + padding, panel.y + padding + HUD_PANEL_ROW_STEP, {
    ...textOptions,
    width: panel.width - padding * 2
  });
  const warningPosition = drawWaitingTerminalActions(
    ctx,
    panel.x + 2,
    panel.y + panel.height + HUD_PANEL_ACTION_GAP,
    canStart,
    options,
    colors,
    textRenderer
  );
  drawWaitingDisabledFlash(ctx, warningPosition.x, warningPosition.y, options, colors, textRenderer);
}

function drawWaitingTerminalActions(ctx, x, y, canStart, options, colors, textRenderer) {
  const keyboardLineStep = 12;
  const controllerLineStep = 15;
  const labelOffsetY = 2;

  if (options.controllerActive) {
    drawControllerHudAction(ctx, "faceRight", "LEAVE", x, y, colors, textRenderer);
    if (canStart) {
      drawControllerHudAction(ctx, "faceBottom", "START", x, y + 15, colors, textRenderer);
    }
    return {
      x: x + 19,
      y: y + labelOffsetY + controllerLineStep * (canStart ? 2 : 1)
    };
  }

  const textOptions = {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER
  };

  const firstLineY = y + labelOffsetY;

  if (options.mobileActive) {
    textRenderer.draw(ctx, "LEAVE", x, firstLineY, {
      ...textOptions,
      width: 96
    });
    if (canStart) {
      textRenderer.draw(ctx, "START", x, firstLineY + keyboardLineStep, {
        ...textOptions,
        width: 96
      });
    }
    return {
      x,
      y: firstLineY + keyboardLineStep * (canStart ? 2 : 1)
    };
  }

  textRenderer.draw(ctx, "ESC - LEAVE", x, firstLineY, {
    ...textOptions,
    width: 96
  });
  if (canStart) {
    textRenderer.draw(ctx, "ENTER - START", x, firstLineY + keyboardLineStep, {
      ...textOptions,
      width: 112
    });
  }
  return {
    x,
    y: firstLineY + keyboardLineStep * (canStart ? 2 : 1)
  };
}

function drawWaitingDisabledFlash(ctx, x, y, options, colors, textRenderer) {
  const text = options.hudFlash?.miningRayDisabled ? "MINING DISABLED" : "";

  if (!text || !hudFlashVisible(true, options.timeSeconds, {
    mode: HUD_FLASH_MODE.additive,
    rate: HUD_FLASH_RATE.slow
  })) {
    return;
  }

  textRenderer.draw(ctx, text, x, y, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER,
    width: 112
  });
}

function waitingRoomCanStart(room) {
  if (!room?.isHost || room.countdownArmed) {
    return false;
  }

  const count = room.players?.length || 0;
  const slotCount = Number.isFinite(room.playerSlots) ? room.playerSlots : count;
  const minPlayers = room.minPlayers || ENGINE.lobby.minPlayers || 2;
  return slotCount >= minPlayers;
}

function drawStartingOverlay(ctx, secondsLeft, options, colors, textRenderer) {
  const label = `STARTING ${formatClock(secondsLeft)}`;
  const textOptions = {
    scale: 3,
    color: colors.foreground
  };
  const textWidth = textRenderer.measure(label, textOptions);
  const panelWidth = Math.min(ctx.width - 24, textWidth + 24);
  const panel = {
    x: Math.round((ctx.width - panelWidth) / 2),
    y: 18,
    width: panelWidth,
    height: 39
  };

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  drawCenteredText(ctx, textRenderer, label, ctx.width / 2, panel.y + 9, textOptions);
}

function drawSpectatorHud(ctx, options, localPlayer, spectatedPlayer, colors, textRenderer, snapshot) {
  let stackPanel = null;
  const playersLeft = (snapshot?.players || []).filter((player) => player.alive === true).length;

  if (localPlayer) {
    stackPanel = drawEliminatedPanel(ctx, options, localPlayer, snapshot, colors, textRenderer);
  }

  if (spectatedPlayer && spectatedPlayer.id !== localPlayer?.id) {
    stackPanel = drawPlayerHud(
      ctx,
      spectatedPlayer,
      colors,
      textRenderer,
      {},
      options.timeSeconds,
      playersLeft,
      {
        header: spectatorHeaderForPlayer(spectatedPlayer),
        y: stackPanel ? stackPanel.y + stackPanel.height + 6 : undefined
      }
    );
  } else if (!stackPanel) {
    stackPanel = drawSpectatingFallbackPanel(ctx, colors, textRenderer);
  }

  drawTerminalLeaveAction(
    ctx,
    (stackPanel?.x ?? 8) + 2,
    (stackPanel?.y ?? 8) + (stackPanel?.height ?? 0) + HUD_PANEL_ACTION_GAP,
    options,
    colors,
    textRenderer
  );
}

function spectatorHeaderForPlayer(player) {
  const number = Number(player?.number);
  if (!Number.isFinite(number)) {
    return "SPECTATING SHIP";
  }
  return `SPECTATING SHIP ${Math.max(1, Math.floor(number))}`;
}

function drawEliminatedPanel(ctx, options, player, snapshot, colors, textRenderer) {
  const place = playerPlaceInSnapshot(options.room, snapshot, player.id);
  const kills = Math.max(0, Math.floor(Number(player.kills || 0)));
  const rows = [
    "ELIMINATED",
    place ? `FINISHED ${placeLabel(place)}` : "FINISHED",
    killCountLabel(kills)
  ];
  return drawHudTextPanel(ctx, rows, colors, textRenderer);
}

function killCountLabel(kills) {
  const count = Math.max(0, Math.floor(Number(kills) || 0));
  return `${count} KILL${count === 1 ? "" : "S"}`;
}

function drawSpectatingFallbackPanel(ctx, colors, textRenderer) {
  return drawHudTextPanel(ctx, ["SPECTATING"], colors, textRenderer);
}

function drawHudTextPanel(ctx, rows, colors, textRenderer) {
  const padding = HUD_PANEL_PADDING;
  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };
  const width = Math.max(
    HUD_PANEL_MIN_WIDTH,
    ...rows.map((row) => textRenderer.measure(row, textOptions) + padding * 2)
  );
  const panel = mainHudPanelRect(ctx, width, hudPanelHeightForRows(rows.length));

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  rows.forEach((row, index) => {
    textRenderer.draw(ctx, row, panel.x + padding, panel.y + padding + HUD_PANEL_ROW_STEP * index, {
      ...textOptions,
      width: panel.width - padding * 2
    });
  });

  return panel;
}

function drawLeaveConfirmHud(ctx, leaveConfirm, options, colors, textRenderer) {
  if (!leaveConfirm?.active) {
    return;
  }

  const panel = mainHudPanelRect(ctx, HUD_PANEL_MIN_WIDTH, hudPanelHeightForRows(2));
  const padding = HUD_PANEL_PADDING;
  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  textRenderer.draw(ctx, "CONFIRM LEAVE?", panel.x + padding, panel.y + padding, {
    fontSize: 8,
    color: colors.foreground,
    width: panel.width - padding * 2
  });
  drawLeaveConfirmFuse(
    ctx,
    panel.x + padding,
    panel.y + padding + HUD_PANEL_ROW_STEP + 2,
    panel.width - padding * 2,
    leaveConfirm.progress,
    colors
  );
  drawTerminalConfirmLeaveAction(ctx, panel.x + 2, panel.y + panel.height + HUD_PANEL_ACTION_GAP, options, colors, textRenderer);
}

function drawLeaveConfirmFuse(ctx, x, y, width, progress, colors) {
  const fuseProgress = clamp(Number(progress), 0, 1);
  const litWidth = Math.round(width * fuseProgress);
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y + 2, width, 1);
  ctx.fillRect(x, y, 1, 3);
  ctx.fillRect(x + width - 1, y, 1, 3);

  if (litWidth < width - 2) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(x + 1 + litWidth, y + 1, width - 2 - litWidth, 1);
  }

  if (litWidth > 0) {
    ctx.fillStyle = colors.foreground;
    ctx.fillRect(x + 1, y + 1, Math.min(width - 2, litWidth), 1);
  }
}

function drawPlayerMap(ctx, mapState, asteroid, colors, layout = null) {
  if (!mapState?.cells || !asteroid) {
    return;
  }

  const localLayout = layout?.mode === "local";
  const mapCircle = playerMapArenaCircle(mapState, asteroid);
  const fixedRadius = Number(layout?.radius);
  const fixedCenterX = Number(layout?.centerX);
  const fixedCenterY = Number(layout?.centerY);
  const hasFixedCircle = Number.isFinite(fixedRadius) && fixedRadius > 0 &&
    Number.isFinite(fixedCenterX) &&
    Number.isFinite(fixedCenterY);
  const requestedCellSize = Number(layout?.cellSize);
  const cellSize = hasFixedCircle
    ? Number.isFinite(requestedCellSize) && requestedCellSize > 0
      ? requestedCellSize
      : localLayout
        ? PLAYER_MAP_CELL_SIZE
        : fixedRadius / Math.max(1, mapCircle.radius)
    : PLAYER_MAP_CELL_SIZE;
  const scratchPadding = hasFixedCircle ? 0 : 1;
  const mapRadius = hasFixedCircle ? fixedRadius : Math.ceil(mapCircle.radius * cellSize);
  const mapSize = mapRadius * 2 + scratchPadding * 2;
  const canvasWidth = ctx.width ?? ctx.canvas?.width ?? mapSize + PLAYER_MAP_MARGIN * 2;
  const canvasHeight = ctx.height ?? ctx.canvas?.height ?? mapSize + PLAYER_MAP_MARGIN * 2;
  const mapLeft = hasFixedCircle
    ? fixedCenterX - mapRadius
    : Math.max(PLAYER_MAP_MARGIN, canvasWidth - mapSize - PLAYER_MAP_MARGIN);
  const mapTop = hasFixedCircle
    ? fixedCenterY - mapRadius
    : Math.max(PLAYER_MAP_MARGIN, canvasHeight - mapSize - PLAYER_MAP_MARGIN);
  const desiredMapCenterX = hasFixedCircle ? fixedCenterX : mapLeft + scratchPadding + mapRadius;
  const desiredMapCenterY = hasFixedCircle ? fixedCenterY : mapTop + scratchPadding + mapRadius;
  const mapAnchor = localLayout && mapState.viewCircle ? mapState.viewCircle : mapCircle;
  const timeSeconds = Number.isFinite(layout?.timeSeconds) ? layout.timeSeconds : 0;
  const stormMode = layout?.stormMode || "live";
  const stormBoundaryMode = layout?.stormBoundaryMode || "live";
  const compactMap = layout?.compactMap === true;
  const compactSampleTiles = compactMap
    ? Math.max(1, Math.floor(Number(layout?.compactSampleTiles) || 1))
    : 1;
  const mapOriginX = hasFixedCircle
    ? desiredMapCenterX - mapAnchor.x * cellSize
    : Math.round(desiredMapCenterX - mapCircle.x * cellSize);
  const mapOriginY = hasFixedCircle
    ? desiredMapCenterY - mapAnchor.y * cellSize
    : Math.round(desiredMapCenterY - mapCircle.y * cellSize);
  const mapCenterX = localLayout ? desiredMapCenterX : mapOriginX + mapCircle.x * cellSize;
  const mapCenterY = localLayout ? desiredMapCenterY : mapOriginY + mapCircle.y * cellSize;
  const viewCircle = playerMapViewCirclePixels(mapState.viewCircle, mapOriginX, mapOriginY, cellSize);

  if (!compactMap) {
    drawPlayerMapFilledCircle(ctx, mapCenterX, mapCenterY, mapRadius, colors.backing || "#000000");
  }

  if (hasFixedCircle || localLayout) {
    drawPlayerMapSampledCells(
      ctx,
      mapState,
      asteroid,
      mapOriginX,
      mapOriginY,
      cellSize,
      mapCenterX,
      mapCenterY,
      mapRadius,
      viewCircle,
      colors,
      { timeSeconds, stormMode, compactMap, compactSampleTiles }
    );
  } else {
    for (let chunkY = 0; chunkY < mapState.heightChunks; chunkY += 1) {
      for (let chunkX = 0; chunkX < mapState.widthChunks; chunkX += 1) {
        const cellIndex = chunkY * mapState.widthChunks + chunkX;
        const cellX = playerMapCellX(mapOriginX, chunkX, cellSize);
        const cellY = playerMapCellY(mapOriginY, chunkY, cellSize);
        if (!playerMapCellInsideCircle(cellX, cellY, cellSize, mapCenterX, mapCenterY, mapRadius)) {
          continue;
        }

        const stormState = playerMapChunkStormState(mapState, asteroid, chunkX, chunkY, stormMode);
        if (stormState === "hidden") {
          continue;
        }

        const inView = playerMapCellInsideView(cellX, cellY, cellSize, viewCircle);
        if (stormState === "band") {
          drawPlayerMapCell(ctx, cellX, cellY, cellSize, mapState.storm, mapState, colors);
          continue;
        }

        const sample = playerMapChunkVisibleSample(mapState, cellIndex);
        drawPlayerMapCell(ctx, cellX, cellY, cellSize, sample.value, mapState, colors, !inView, sample.seen, compactMap);
      }
    }
  }
  if (!compactMap) {
    drawPlayerMapStormBoundary(
      ctx,
      mapState,
      asteroid,
      mapOriginX,
      mapOriginY,
      cellSize,
      mapCenterX,
      mapCenterY,
      mapRadius,
      colors,
      timeSeconds,
      stormBoundaryMode
    );
  }
  if (compactMap && layout?.drawMiniShip !== false) {
    drawPlayerMapViewCircle(ctx, viewCircle, mapCenterX, mapCenterY, mapRadius, colors);
  }
  drawPlayerMapOtherPlayers(ctx, mapState.players, mapOriginX, mapOriginY, cellSize, mapCenterX, mapCenterY, mapRadius, colors, compactMap);
  if (!compactMap) {
    drawPlayerMapPlayerDot(ctx, viewCircle, colors);
  }
  if (hasFixedCircle && layout?.border !== false) {
    drawPlayerMapCircleBorder(ctx, mapCenterX, mapCenterY, mapRadius, colors);
  }
}

function playerMapCellX(originX, chunkX, cellSize) {
  return originX + chunkX * cellSize;
}

function playerMapCellY(originY, chunkY, cellSize) {
  return originY + chunkY * cellSize;
}

function drawPlayerMapStormBoundary(
  ctx,
  mapState,
  asteroid,
  mapOriginX,
  mapOriginY,
  cellSize,
  mapCenterX,
  mapCenterY,
  mapRadius,
  colors,
  timeSeconds,
  boundaryMode = "live"
) {
  const canvasWidth = ctx.width ?? ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.height ?? ctx.canvas?.height ?? 0;
  const minScreenX = Math.max(0, Math.floor(mapCenterX - mapRadius) - 1);
  const maxScreenX = Math.min(canvasWidth - 1, Math.ceil(mapCenterX + mapRadius) + 1);
  const minScreenY = Math.max(0, Math.floor(mapCenterY - mapRadius) - 1);
  const maxScreenY = Math.min(canvasHeight - 1, Math.ceil(mapCenterY + mapRadius) + 1);
  const minChunkX = clamp(Math.floor((minScreenX - mapOriginX) / cellSize) - 1, 0, mapState.widthChunks - 1);
  const maxChunkX = clamp(Math.ceil((maxScreenX - mapOriginX) / cellSize) + 1, 0, mapState.widthChunks - 1);
  const minChunkY = clamp(Math.floor((minScreenY - mapOriginY) / cellSize) - 1, 0, mapState.heightChunks - 1);
  const maxChunkY = clamp(Math.ceil((maxScreenY - mapOriginY) / cellSize) + 1, 0, mapState.heightChunks - 1);
  const clip = { x: mapCenterX, y: mapCenterY, radiusSq: mapRadius * mapRadius };

  ctx.fillStyle = colors.foreground;
  for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      if (!playerMapChunkIsBoundarySafe(mapState, asteroid, chunkX, chunkY, boundaryMode)) {
        continue;
      }

      const left = Math.round(mapOriginX + chunkX * cellSize);
      const right = Math.round(mapOriginX + (chunkX + 1) * cellSize);
      const top = Math.round(mapOriginY + chunkY * cellSize);
      const bottom = Math.round(mapOriginY + (chunkY + 1) * cellSize);
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);

      if (!playerMapChunkIsBoundarySafe(mapState, asteroid, chunkX - 1, chunkY, boundaryMode)) {
        drawStormBoundaryVertical(ctx, asteroid, left, top, height, left, top, timeSeconds, clip);
      }

      if (!playerMapChunkIsBoundarySafe(mapState, asteroid, chunkX + 1, chunkY, boundaryMode)) {
        drawStormBoundaryVertical(ctx, asteroid, right - 1, top, height, right - 1, top, timeSeconds, clip);
      }

      if (!playerMapChunkIsBoundarySafe(mapState, asteroid, chunkX, chunkY - 1, boundaryMode)) {
        drawStormBoundaryHorizontal(ctx, asteroid, left, top, width, left, top, timeSeconds, clip);
      }

      if (!playerMapChunkIsBoundarySafe(mapState, asteroid, chunkX, chunkY + 1, boundaryMode)) {
        drawStormBoundaryHorizontal(ctx, asteroid, left, bottom - 1, width, left, bottom - 1, timeSeconds, clip);
      }
    }
  }
}

function playerMapChunkIsBoundarySafe(mapState, asteroid, chunkX, chunkY, mode = "live") {
  if (chunkX < 0 || chunkY < 0 || chunkX >= mapState.widthChunks || chunkY >= mapState.heightChunks) {
    return false;
  }

  const startX = chunkX * mapState.chunkTiles;
  const startY = chunkY * mapState.chunkTiles;
  const endX = Math.min(asteroid.widthTiles, startX + mapState.chunkTiles);
  const endY = Math.min(asteroid.heightTiles, startY + mapState.chunkTiles);
  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      const safe = mode === "initial"
        ? isPlayableTile(asteroid, tileX, tileY)
        : isBoundarySafeTile(asteroid, tileX, tileY);
      if (safe) {
        return true;
      }
    }
  }

  return false;
}

function playerMapArenaCircle(mapState, asteroid) {
  if (
    mapState.circle &&
    Number.isFinite(mapState.circle.x) &&
    Number.isFinite(mapState.circle.y) &&
    Number.isFinite(mapState.circle.radius) &&
    mapState.circle.radius > 0
  ) {
    return mapState.circle;
  }

  const chunkTiles = Math.max(1, mapState.chunkTiles || 1);
  const cacheKey = `${chunkTiles}:${asteroid.widthTiles}:${asteroid.heightTiles}`;
  let cachedByKey = playerMapArenaCircleCache.get(asteroid);
  if (!cachedByKey) {
    cachedByKey = new Map();
    playerMapArenaCircleCache.set(asteroid, cachedByKey);
  } else if (cachedByKey.has(cacheKey)) {
    return cachedByKey.get(cacheKey);
  }

  const centerTileX = asteroid.widthTiles / 2;
  const centerTileY = asteroid.heightTiles / 2;
  let hasPlayableTile = false;
  let radiusTilesSq = 0;
  for (let tileY = 0; tileY < asteroid.heightTiles; tileY += 1) {
    for (let tileX = 0; tileX < asteroid.widthTiles; tileX += 1) {
      if (!isPlayableTile(asteroid, tileX, tileY)) {
        continue;
      }

      hasPlayableTile = true;
      for (let cornerY = 0; cornerY <= 1; cornerY += 1) {
        for (let cornerX = 0; cornerX <= 1; cornerX += 1) {
          const dx = tileX + cornerX - centerTileX;
          const dy = tileY + cornerY - centerTileY;
          radiusTilesSq = Math.max(radiusTilesSq, dx * dx + dy * dy);
        }
      }
    }
  }

  const circle = {
    x: centerTileX / chunkTiles,
    y: centerTileY / chunkTiles,
    radius: hasPlayableTile
      ? (Math.sqrt(radiusTilesSq) + PLAYER_MAP_CIRCLE_PADDING_TILES) / chunkTiles
      : Math.min(mapState.widthChunks, mapState.heightChunks) / 2
  };
  cachedByKey.set(cacheKey, circle);
  return circle;
}

function playerMapCellInsideCircle(x, y, size, cx, cy, radius) {
  const dx = x + size * 0.5 - cx;
  const dy = y + size * 0.5 - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function drawPlayerMapFilledCircle(ctx, cx, cy, radius, color) {
  const radiusSq = radius * radius;
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);

  ctx.fillStyle = color;
  for (let y = minY; y <= maxY; y += 1) {
    const dy = y + 0.5 - cy;
    const spanSq = radiusSq - dy * dy;
    if (spanSq < 0) {
      continue;
    }

    const span = Math.sqrt(spanSq);
    const x1 = Math.ceil(cx - span - 0.5);
    const x2 = Math.floor(cx + span - 0.5);
    if (x2 >= x1) {
      ctx.fillRect(x1, y, x2 - x1 + 1, 1);
    }
  }
}

function drawPlayerMapCircleBorder(ctx, cx, cy, radius, colors) {
  const radiusSq = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);

  ctx.fillStyle = colors.foreground;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!playerMapCirclePixelInside(x, y, cx, cy, radiusSq)) {
        continue;
      }

      if (playerMapCirclePixelTouchesOutside(x, y, cx, cy, radiusSq)) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function drawPlayerMapPlayerDot(ctx, circle, colors, compactMap = false) {
  if (!circle) {
    return;
  }

  const x = Math.round(circle.x - 0.5);
  const y = Math.round(circle.y - 0.5);
  if (compactMap) {
    drawPlayerMapCircleMarker(ctx, x, y, 6, colors.background);
    drawPlayerMapCircleMarker(ctx, x, y, 3, colors.foreground);
    return;
  }

  drawPlayerMapCrossMarker(ctx, x, y, colors);
}

function drawPlayerMapCrossMarker(ctx, x, y, colors) {
  ctx.fillStyle = colors.background;
  ctx.fillRect(x - 2, y - 1, 5, 3);
  ctx.fillRect(x - 1, y - 2, 3, 5);
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillRect(x, y - 1, 1, 3);
}

function drawPlayerMapCircleMarker(ctx, x, y, radius, color) {
  ctx.fillStyle = color;
  const radiusSq = radius * radius;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const halfWidth = Math.floor(Math.sqrt(Math.max(0, radiusSq - offsetY * offsetY)));
    ctx.fillRect(x - halfWidth, y + offsetY, halfWidth * 2 + 1, 1);
  }
}

function drawPlayerMapOtherPlayers(ctx, players, mapOriginX, mapOriginY, cellSize, mapCenterX, mapCenterY, mapRadius, colors, compactMap = false) {
  if (compactMap) {
    return;
  }

  if (!Array.isArray(players) || players.length === 0) {
    return;
  }

  const mapRadiusSq = mapRadius * mapRadius;
  for (const player of players) {
    const cx = mapOriginX + Number(player.x) * cellSize;
    const cy = mapOriginY + Number(player.y) * cellSize;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      continue;
    }

    const marker = { x: cx, y: cy };
    const markerX = Math.round(marker.x - 0.5);
    const markerY = Math.round(marker.y - 0.5);
    if (!playerMapCirclePixelInside(markerX, markerY, mapCenterX, mapCenterY, mapRadiusSq)) {
      continue;
    }

    drawPlayerMapPlayerDot(ctx, marker, colors, compactMap);
  }
}

function drawPlayerMapSampledCells(
  ctx,
  mapState,
  asteroid,
  mapOriginX,
  mapOriginY,
  cellSize,
  mapCenterX,
  mapCenterY,
  mapRadius,
  viewCircle,
  colors,
  options = {}
) {
  const mapRadiusSq = mapRadius * mapRadius;
  const canvasWidth = ctx.width ?? ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.height ?? ctx.canvas?.height ?? 0;
  const minX = Math.max(0, Math.floor(mapCenterX - mapRadius));
  const maxX = Math.min(canvasWidth - 1, Math.ceil(mapCenterX + mapRadius));
  const minY = Math.max(0, Math.floor(mapCenterY - mapRadius));
  const maxY = Math.min(canvasHeight - 1, Math.ceil(mapCenterY + mapRadius));
  let currentColor = null;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!playerMapCirclePixelInside(x, y, mapCenterX, mapCenterY, mapRadiusSq)) {
        continue;
      }

      const chunkX = Math.floor((x + 0.5 - mapOriginX) / cellSize);
      const chunkY = Math.floor((y + 0.5 - mapOriginY) / cellSize);
      if (chunkX < 0 || chunkY < 0 || chunkX >= mapState.widthChunks || chunkY >= mapState.heightChunks) {
        continue;
      }

      const color = playerMapSampledPixelColor(
        mapState,
        asteroid,
        chunkX,
        chunkY,
        x,
        y,
        mapOriginX,
        mapOriginY,
        cellSize,
        viewCircle,
        colors,
        options
      );
      if (!color) {
        continue;
      }

      if (color !== currentColor) {
        ctx.fillStyle = color;
        currentColor = color;
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function playerMapSampledPixelColor(
  mapState,
  asteroid,
  chunkX,
  chunkY,
  x,
  y,
  mapOriginX,
  mapOriginY,
  cellSize,
  viewCircle,
  colors,
  options = {}
) {
  const stormMode = options.stormMode || "live";
  const compactSampleTiles = options.compactMap === true
    ? Math.max(1, Math.floor(Number(options.compactSampleTiles) || 1))
    : 1;
  const sampleChunkX = compactSampleTiles > 1
    ? Math.floor(chunkX / compactSampleTiles) * compactSampleTiles
    : chunkX;
  const sampleChunkY = compactSampleTiles > 1
    ? Math.floor(chunkY / compactSampleTiles) * compactSampleTiles
    : chunkY;
  const stormState = compactSampleTiles > 1
    ? playerMapCompactStormState(mapState, asteroid, sampleChunkX, sampleChunkY, stormMode, compactSampleTiles)
    : playerMapChunkStormState(mapState, asteroid, sampleChunkX, sampleChunkY, stormMode);
  if (stormState === "hidden") {
    if (
      options.compactMap === true &&
      playerMapCompactOuterStormBorderCell(
        mapState,
        asteroid,
        sampleChunkX,
        sampleChunkY,
        stormMode,
        compactSampleTiles,
        PLAYER_MAP_COMPACT_OUTER_STORM_BORDER
      )
    ) {
      return colors.backing || "#000000";
    }
    return null;
  }

  if (
    options.compactMap === true &&
    stormState !== "band" &&
    playerMapCompactMapSideStormBorderCell(mapState, asteroid, sampleChunkX, sampleChunkY, stormMode, compactSampleTiles)
  ) {
    return colors.background;
  }

  const dimmed = options.dimOutsideView === false ? false : !playerMapPixelInsideView(x, y, viewCircle);
  if (stormState === "band") {
    if (options.compactMap === true) {
      const stormSample = playerMapStormSamplePoint(mapState, x, y, mapOriginX, mapOriginY, cellSize);
      return playerMapStormPixelColor(
        asteroid,
        stormSample.x,
        stormSample.y,
        colors,
        options.timeSeconds || 0,
        colors.foreground,
        colors.background
      );
    }
    return playerMapStormPixelColor(
      asteroid,
      x,
      y,
      colors,
      options.timeSeconds || 0
    );
  }

  const sample = compactSampleTiles > 1
    ? playerMapCompactVisibleSample(mapState, sampleChunkX, sampleChunkY, compactSampleTiles)
    : playerMapChunkVisibleSample(mapState, sampleChunkY * mapState.widthChunks + sampleChunkX);
  return playerMapValueColor(sample.value, mapState, colors, dimmed, x, y, sample.seen, options.compactMap === true);
}

function playerMapStormSamplePoint(mapState, x, y, mapOriginX, mapOriginY, cellSize) {
  const scale = Math.max(1, Number(mapState?.chunkTiles) || 1);
  const divisor = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 1;
  return {
    x: ((x + 0.5 - mapOriginX) / divisor) * scale,
    y: ((y + 0.5 - mapOriginY) / divisor) * scale
  };
}

function playerMapCompactVisibleSample(mapState, chunkX, chunkY, sampleTiles) {
  const tiles = Math.max(1, sampleTiles | 0);
  for (let offsetY = 0; offsetY < tiles; offsetY += 1) {
    const sampleY = chunkY + offsetY;
    if (sampleY < 0 || sampleY >= mapState.heightChunks) {
      continue;
    }

    for (let offsetX = 0; offsetX < tiles; offsetX += 1) {
      const sampleX = chunkX + offsetX;
      if (sampleX < 0 || sampleX >= mapState.widthChunks) {
        continue;
      }

      const value = mapState.cells[sampleY * mapState.widthChunks + sampleX];
      if (value !== mapState.unknown && value !== mapState.storm) {
        return { value: mapState.foreground, seen: true };
      }
    }
  }

  return { value: mapState.background, seen: false };
}

function playerMapCompactStormState(mapState, asteroid, chunkX, chunkY, stormMode, sampleTiles) {
  const tiles = Math.max(1, sampleTiles | 0);
  let sawVisible = false;
  for (let offsetY = 0; offsetY < tiles; offsetY += 1) {
    const sampleY = chunkY + offsetY;
    if (sampleY < 0 || sampleY >= mapState.heightChunks) {
      continue;
    }

    for (let offsetX = 0; offsetX < tiles; offsetX += 1) {
      const sampleX = chunkX + offsetX;
      if (sampleX < 0 || sampleX >= mapState.widthChunks) {
        continue;
      }

      const state = playerMapChunkStormState(mapState, asteroid, sampleX, sampleY, stormMode);
      if (state === "band") {
        return "band";
      }
      if (state !== "hidden") {
        sawVisible = true;
      }
    }
  }

  return sawVisible ? "none" : "hidden";
}

function playerMapCompactMapSideStormBorderCell(mapState, asteroid, chunkX, chunkY, stormMode, sampleTiles = 1) {
  const step = Math.max(1, sampleTiles | 0);
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      if (playerMapCompactStormState(mapState, asteroid, chunkX + offsetX * step, chunkY + offsetY * step, stormMode, step) === "band") {
        return true;
      }
    }
  }

  return false;
}

function playerMapCompactOuterStormBorderCell(mapState, asteroid, chunkX, chunkY, stormMode, sampleTiles = 1, borderPixels = 2) {
  const step = Math.max(1, sampleTiles | 0);
  const radius = Math.max(1, borderPixels | 0);

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const remainingX = radius - Math.abs(offsetY);
    for (let offsetX = -remainingX; offsetX <= remainingX; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      if (playerMapCompactStormState(
        mapState,
        asteroid,
        chunkX + offsetX * step,
        chunkY + offsetY * step,
        stormMode,
        step
      ) === "band") {
        return true;
      }
    }
  }

  return false;
}

function playerMapPixelInsideView(x, y, circle) {
  if (!circle) {
    return false;
  }

  const dx = x + 0.5 - circle.x;
  const dy = y + 0.5 - circle.y;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function playerMapChunkVisibleValue(mapState, cellIndex) {
  return playerMapChunkVisibleSample(mapState, cellIndex).value;
}

function playerMapChunkVisibleSample(mapState, cellIndex) {
  const cachedValue = mapState.cells[cellIndex];
  if (cachedValue !== mapState.unknown && cachedValue !== mapState.storm) {
    return { value: cachedValue, seen: true };
  }

  return {
    value: mapState.baseCells?.[cellIndex] ?? mapState.unknown,
    seen: false
  };
}

function playerMapValueColor(value, mapState, colors, dimmed = false, x = 0, y = 0, seen = true, compactMap = false) {
  if (compactMap) {
    return seen && value !== mapState.unknown ? colors.foreground : colors.backing || "#000000";
  }

  if (value === mapState.unknown) {
    return colors.backing || "#000000";
  }

  if (value === mapState.foreground) {
    if (!dimmed) {
      return colors.foreground;
    }
    return seen ? playerMapCheckerColor(x, y, colors) : colors.background;
  }

  if (dimmed) {
    return colors.backing || "#000000";
  }
  return colors.background;
}

function playerMapCompactValueColor(value, mapState, colors) {
  if (value === mapState.unknown) {
    return colors.backing || "#000000";
  }

  if (value === mapState.foreground) {
    return colors.foreground;
  }

  return colors.background;
}

function playerMapCheckerColor(x, y, colors) {
  return ((Math.floor(x) + Math.floor(y)) & 1) === 0
    ? colors.foreground
    : colors.background;
}

function playerMapStormPixelColor(
  asteroid,
  x,
  y,
  colors,
  timeSeconds,
  onColor = colors.background,
  offColor = colors.backing || "#000000"
) {
  return stormNoiseAt(asteroid, x + 0.5, y + 0.5, timeSeconds) >= STORM_NOISE_THRESHOLD
    ? onColor
    : offColor;
}

function drawPlayerMapCell(ctx, x, y, size, value, mapState, colors, dimmed = false, seen = true, compactMap = false) {
  if (compactMap && value !== mapState.storm) {
    ctx.fillStyle = seen && value !== mapState.unknown ? colors.foreground : colors.backing || "#000000";
    ctx.fillRect(x, y, size, size);
    return;
  }

  if (value === mapState.unknown) {
    ctx.fillStyle = colors.backing || "#000000";
    ctx.fillRect(x, y, size, size);
    return;
  }

  if (value === mapState.storm) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(x, y, size, size);
    return;
  }

  if (value === mapState.foreground) {
    if (!compactMap && dimmed && seen) {
      drawPlayerMapCheckerCell(ctx, x, y, size, colors);
      return;
    }

    ctx.fillStyle = colors.foreground;
    ctx.fillRect(x, y, size, size);
    return;
  }

  ctx.fillStyle = compactMap ? playerMapCompactValueColor(value, mapState, colors) : dimmed ? colors.backing || "#000000" : colors.background;
  ctx.fillRect(x, y, size, size);
}

function drawPlayerMapCheckerCell(ctx, x, y, size, colors) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.ceil(x + size);
  const bottom = Math.ceil(y + size);
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      ctx.fillStyle = playerMapCheckerColor(px, py, colors);
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

function playerMapViewCirclePixels(circle, mapOriginX, mapOriginY, cellSize) {
  if (!circle) {
    return null;
  }

  const cx = mapOriginX + circle.x * cellSize;
  const cy = mapOriginY + circle.y * cellSize;
  const radius = circle.radius * cellSize;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  return {
    x: cx,
    y: cy,
    radius,
    shipRadius: circle.shipRadius,
    angle: circle.angle,
    aimAngle: circle.aimAngle,
    health: circle.health,
    maxHealth: circle.maxHealth,
    healthBars: circle.healthBars,
    miningRayCount: circle.miningRayCount
  };
}

function playerMapCellInsideView(x, y, size, circle) {
  if (!circle) {
    return false;
  }

  const dx = x + size * 0.5 - circle.x;
  const dy = y + size * 0.5 - circle.y;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function drawPlayerMapViewCircle(ctx, circle, mapCenterX, mapCenterY, mapRadius, colors) {
  void mapCenterX;
  void mapCenterY;
  void mapRadius;
  if (!circle) {
    return;
  }

  drawPlayerMapMiniShip(ctx, circle, colors);
}

function drawPlayerMapMiniShip(ctx, circle, colors) {
  const angle = Number.isFinite(circle.angle)
    ? circle.angle
    : Number.isFinite(circle.aimAngle)
      ? circle.aimAngle
      : -Math.PI / 2;
  const sourceRadius = Math.max(1, Number(circle.shipRadius || ENGINE.ship.radius || 7));
  const radius = Math.max(1, sourceRadius * PLAYER_MAP_MINI_SHIP_SCALE);
  const ship = {
    id: "minimap-player",
    x: circle.x,
    y: circle.y,
    radius,
    angle,
    aimAngle: Number.isFinite(circle.aimAngle) ? circle.aimAngle : angle,
    alive: true,
    health: 0,
    maxHealth: circle.maxHealth || ENGINE.player.maxHealth,
    healthBars: circle.healthBars || ENGINE.player.startingHealthBars,
    miningRayCount: circle.miningRayCount || 1,
    upgrades: {}
  };
  drawPlayerMapMiniShipOutline(ctx, ship, colors);
  drawShip(ctx, ship, { x: 0, y: 0 }, null, colors, 0, null, true);
}

function fillPlayerMapMiniShipViewInterior(ctx, circle, colors) {
  const radius = Math.max(1, Number(circle.radius) || 1);
  drawPlayerMapFilledCircle(ctx, circle.x, circle.y, radius, colors.background);
}

function drawPlayerMapMiniShipViewRing(ctx, circle, colors) {
  const radius = Math.max(1, Number(circle.radius) || 1);
  drawPlayerMapCircleBand(ctx, circle.x, circle.y, radius, radius + 1, colors.background);
  drawPlayerMapCircleBand(ctx, circle.x, circle.y, radius + 1, radius + 2, colors.foreground);
  drawPlayerMapCircleBand(ctx, circle.x, circle.y, radius + 2, radius + 3, colors.background);
}

function drawPlayerMapCircleBand(ctx, cx, cy, innerRadius, outerRadius, color) {
  const innerRadiusSq = innerRadius * innerRadius;
  const outerRadiusSq = outerRadius * outerRadius;
  const minX = Math.floor(cx - outerRadius - 1);
  const maxX = Math.ceil(cx + outerRadius + 1);
  const minY = Math.floor(cy - outerRadius - 1);
  const maxY = Math.ceil(cy + outerRadius + 1);

  ctx.fillStyle = color;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > innerRadiusSq && distanceSq <= outerRadiusSq) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function drawPlayerMapMiniShipOutline(ctx, ship, colors) {
  const outlineColors = {
    ...colors,
    foreground: colors.background,
    background: colors.background
  };

  for (let y = -PLAYER_MAP_MINI_SHIP_OUTLINE; y <= PLAYER_MAP_MINI_SHIP_OUTLINE; y += 1) {
    for (let x = -PLAYER_MAP_MINI_SHIP_OUTLINE; x <= PLAYER_MAP_MINI_SHIP_OUTLINE; x += 1) {
      if (x === 0 && y === 0) {
        continue;
      }

      drawShip(ctx, {
        ...ship,
        x: ship.x + x,
        y: ship.y + y
      }, { x: 0, y: 0 }, null, outlineColors, 0, null, true);
    }
  }
}

function playerMapCirclePixelInside(x, y, cx, cy, radiusSq) {
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  return dx * dx + dy * dy <= radiusSq;
}

function playerMapCirclePixelTouchesOutside(x, y, cx, cy, radiusSq) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      if (!playerMapCirclePixelInside(x + offsetX, y + offsetY, cx, cy, radiusSq)) {
        return true;
      }
    }
  }

  return false;
}

function playerMapCirclePixelTouchesInside(x, y, cx, cy, radiusSq) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      if (playerMapCirclePixelInside(x + offsetX, y + offsetY, cx, cy, radiusSq)) {
        return true;
      }
    }
  }

  return false;
}

function playerMapChunkStormState(mapState, asteroid, chunkX, chunkY, mode = "live") {
  if (chunkX < 0 || chunkY < 0 || chunkX >= mapState.widthChunks || chunkY >= mapState.heightChunks) {
    return "hidden";
  }

  const index = chunkY * mapState.widthChunks + chunkX;
  const state = playerMapStormMask(mapState, asteroid)[index];
  if (state === PLAYER_MAP_STORM_BAND) {
    if (mode === "full") {
      const playable = playerMapChunkHasPlayableTile(mapState, asteroid, chunkX, chunkY);
      if (!playable && !mapState.fullMapStormMask?.[index]) {
        return "hidden";
      }
    }
    return "band";
  }

  return "none";
}

function playerMapChunkHasPlayableTile(mapState, asteroid, chunkX, chunkY) {
  const startX = chunkX * mapState.chunkTiles;
  const startY = chunkY * mapState.chunkTiles;
  const endX = Math.min(asteroid.widthTiles, startX + mapState.chunkTiles);
  const endY = Math.min(asteroid.heightTiles, startY + mapState.chunkTiles);
  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      if (isPlayableTile(asteroid, tileX, tileY)) {
        return true;
      }
    }
  }

  return false;
}

function playerMapStormMask(mapState, asteroid) {
  const cached = playerMapStormMaskCache.get(mapState);
  if (cached?.asteroid === asteroid) {
    return cached.states;
  }

  const width = mapState.widthChunks;
  const height = mapState.heightChunks;
  const count = width * height;
  const states = new Uint8Array(count);

  for (let chunkY = 0; chunkY < height; chunkY += 1) {
    for (let chunkX = 0; chunkX < width; chunkX += 1) {
      const index = chunkY * width + chunkX;
      states[index] = playerMapChunkHasStorm(mapState, asteroid, chunkX, chunkY)
        ? PLAYER_MAP_STORM_BAND
        : PLAYER_MAP_STORM_NONE;
    }
  }

  playerMapStormMaskCache.set(mapState, { asteroid, states });
  return states;
}

function playerMapChunkHasStorm(mapState, asteroid, chunkX, chunkY) {
  const startX = chunkX * mapState.chunkTiles;
  const startY = chunkY * mapState.chunkTiles;
  const endX = Math.min(asteroid.widthTiles, startX + mapState.chunkTiles);
  const endY = Math.min(asteroid.heightTiles, startY + mapState.chunkTiles);

  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      if (stormTileStateAt(asteroid, tileX, tileY) === STORM_STATE.storm) {
        return true;
      }
    }
  }

  return false;
}

function drawBotChunkMap(ctx, map, colors, textRenderer) {
  if (!map || !Number.isFinite(map.cellsX) || !Number.isFinite(map.cellsY)) {
    return;
  }

  const cellsX = Math.max(1, Math.floor(map.cellsX));
  const cellsY = Math.max(1, Math.floor(map.cellsY));
  const dotPitch = BOT_CHUNK_MAP_DOT_SIZE + BOT_CHUNK_MAP_DOT_GAP;
  const activeInset = Math.floor(BOT_CHUNK_MAP_ACTIVE_SIZE / 2);
  const mapWidth = (cellsX - 1) * dotPitch + BOT_CHUNK_MAP_DOT_SIZE;
  const mapHeight = (cellsY - 1) * dotPitch + BOT_CHUNK_MAP_DOT_SIZE;
  const padding = HUD_PANEL_PADDING;
  const titleHeight = 10;
  const title = "AI CHUNKS";
  const titleWidth = textRenderer.measure(title, { fontSize: 8 });
  const panel = {
    x: 8,
    y: ctx.height - (mapHeight + activeInset * 2 + titleHeight + padding * 2) - 8,
    width: Math.max(mapWidth + activeInset * 2 + padding * 2, titleWidth + padding * 2),
    height: mapHeight + activeInset * 2 + titleHeight + padding * 2
  };
  const mapX = panel.x + padding + activeInset;
  const mapY = panel.y + padding + titleHeight + activeInset;

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  textRenderer.draw(ctx, title, panel.x + padding, panel.y + padding, {
    fontSize: 8,
    color: colors.foreground,
    width: panel.width - padding * 2
  });

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(mapX - activeInset - 1, mapY - activeInset - 1, mapWidth + activeInset * 2 + 2, 1);
  ctx.fillRect(mapX - activeInset - 1, mapY + mapHeight + activeInset, mapWidth + activeInset * 2 + 2, 1);
  ctx.fillRect(mapX - activeInset - 1, mapY - activeInset - 1, 1, mapHeight + activeInset * 2 + 2);
  ctx.fillRect(mapX + mapWidth + activeInset, mapY - activeInset - 1, 1, mapHeight + activeInset * 2 + 2);

  for (const cell of map.heat || []) {
    drawBotChunkHeat(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  }

  for (const cell of map.explored || []) {
    drawBotChunkVisit(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  }

  const navSeen = new Set();
  for (const cell of map.nav || []) {
    const key = `${cell.x}:${cell.y}`;
    if (navSeen.has(key)) {
      continue;
    }
    navSeen.add(key);
    drawBotChunkDot(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  }

  drawBotChunkTarget(ctx, map.wander, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  drawBotChunkTarget(ctx, map.resource, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  drawBotChunkTarget(ctx, map.flee, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  drawBotChunkThreat(ctx, map.threat, mapX, mapY, dotPitch, cellsX, cellsY, colors);
  drawBotChunkCurrent(ctx, map.current, mapX, mapY, dotPitch, cellsX, cellsY, colors);
}

function drawBotChunkVisit(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors) {
  const point = botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY);
  if (!point) {
    return;
  }

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(point.x, point.y, BOT_CHUNK_MAP_DOT_SIZE, BOT_CHUNK_MAP_DOT_SIZE);
}

function drawBotChunkHeat(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors) {
  const point = botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY);
  if (!point) {
    return;
  }

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(point.x, point.y, BOT_CHUNK_MAP_HEAT_SIZE, BOT_CHUNK_MAP_HEAT_SIZE);
}

function drawBotChunkDot(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors) {
  const point = botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY);
  if (!point) {
    return;
  }

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(point.x, point.y, BOT_CHUNK_MAP_DOT_SIZE, BOT_CHUNK_MAP_DOT_SIZE);
}

function drawBotChunkTarget(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors) {
  const point = botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY);
  if (!point) {
    return;
  }

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(point.x, point.y, BOT_CHUNK_MAP_DOT_SIZE, BOT_CHUNK_MAP_DOT_SIZE);
}

function drawBotChunkThreat(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors) {
  const point = botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY);
  if (!point) {
    return;
  }

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(point.x, point.y, BOT_CHUNK_MAP_DOT_SIZE, BOT_CHUNK_MAP_DOT_SIZE);
}

function drawBotChunkCurrent(ctx, cell, mapX, mapY, dotPitch, cellsX, cellsY, colors) {
  const point = botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY);
  if (!point) {
    return;
  }

  const inset = Math.floor(BOT_CHUNK_MAP_ACTIVE_SIZE / 2);
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(
    point.x - inset,
    point.y - inset,
    BOT_CHUNK_MAP_ACTIVE_SIZE,
    BOT_CHUNK_MAP_ACTIVE_SIZE
  );
}

function botChunkCellPoint(cell, mapX, mapY, dotPitch, cellsX, cellsY) {
  if (!cell || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) {
    return null;
  }

  const x = Math.floor(cell.x);
  const y = Math.floor(cell.y);
  if (x < 0 || y < 0 || x >= cellsX || y >= cellsY) {
    return null;
  }

  return {
    x: mapX + x * dotPitch,
    y: mapY + y * dotPitch
  };
}

function drawBotDebugWorldOverlay(ctx, overlay, camera) {
  if (!overlay || !camera) {
    return;
  }

  const path = Array.isArray(overlay.path) ? overlay.path : [];
  const cursor = Math.max(0, Math.floor(Number(overlay.pathCursor || 0)));
  for (let index = 1; index < path.length; index += 1) {
    const from = worldToScreenExact(path[index - 1], camera);
    const to = worldToScreenExact(path[index], camera);
    const color = path[index].directFromPrevious === false
      ? BOT_DEBUG_COLORS.pathInvalid
      : index <= cursor
      ? BOT_DEBUG_COLORS.pathDone
      : index === cursor + 1
        ? BOT_DEBUG_COLORS.pathActive
        : path[index].mineable
          ? BOT_DEBUG_COLORS.mineable
          : BOT_DEBUG_COLORS.path;
    drawDebugLine(ctx, from, to, color);
  }

  for (let index = 0; index < path.length; index += 1) {
    const point = worldToScreen(path[index], camera);
    const color = index === cursor + 1
      ? BOT_DEBUG_COLORS.pathActive
      : path[index].mineable
        ? BOT_DEBUG_COLORS.mineable
        : BOT_DEBUG_COLORS.path;
    drawDebugBox(ctx, point.x, point.y, index === cursor + 1 ? 5 : 3, color);
  }

  for (const target of overlay.targets || []) {
    const point = worldToScreen(target, camera);
    drawDebugCross(ctx, point.x, point.y, target.color || BOT_DEBUG_COLORS.title);
  }

  if (overlay.miningTarget) {
    const point = worldToScreen(overlay.miningTarget, camera);
    drawDebugBox(ctx, point.x, point.y, 7, BOT_DEBUG_COLORS.mining);
  }

  if (overlay.player) {
    const point = worldToScreen(overlay.player, camera);
    drawDebugBox(ctx, point.x, point.y, 5, BOT_DEBUG_COLORS.player);
  }
}

function drawBotDebugPanel(ctx, overlay, textRenderer) {
  if (!overlay) {
    return;
  }

  const lines = Array.isArray(overlay.lines) ? overlay.lines : [];
  const panel = {
    x: BOT_DEBUG_PANEL.x,
    y: BOT_DEBUG_PANEL.y,
    width: Math.min(BOT_DEBUG_PANEL.width, ctx.width - BOT_DEBUG_PANEL.x * 2),
    height: BOT_DEBUG_PANEL.padding * 2 +
      BOT_DEBUG_PANEL.titleHeight +
      BOT_DEBUG_PANEL.lineHeight * Math.min(lines.length, 16)
  };

  ctx.fillStyle = BOT_DEBUG_COLORS.panelBackground;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.fillStyle = BOT_DEBUG_COLORS.panelBorder;
  ctx.fillRect(panel.x, panel.y, panel.width, 1);
  ctx.fillRect(panel.x, panel.y + panel.height - 1, panel.width, 1);
  ctx.fillRect(panel.x, panel.y, 1, panel.height);
  ctx.fillRect(panel.x + panel.width - 1, panel.y, 1, panel.height);

  textRenderer.draw(ctx, `BOT DEBUG: ${overlay.title || "-"}`, panel.x + BOT_DEBUG_PANEL.padding, panel.y + 4, {
    fontSize: 8,
    color: BOT_DEBUG_COLORS.title,
    width: panel.width - BOT_DEBUG_PANEL.padding * 2
  });

  const lineX = panel.x + BOT_DEBUG_PANEL.padding;
  let lineY = panel.y + BOT_DEBUG_PANEL.padding + BOT_DEBUG_PANEL.titleHeight;
  for (const line of lines.slice(0, 16)) {
    const color = line.startsWith("TARGET:") || line.startsWith("NAV:")
      ? BOT_DEBUG_COLORS.pathActive
      : line.startsWith("RES:") || line.startsWith("UP:")
        ? "#9effa2"
        : BOT_DEBUG_COLORS.text;
    textRenderer.draw(ctx, line, lineX, lineY, {
      fontSize: 8,
      color,
      width: panel.width - BOT_DEBUG_PANEL.padding * 2
    });
    lineY += BOT_DEBUG_PANEL.lineHeight;
  }
}

function drawDebugLine(ctx, from, to, color) {
  if (
    !Number.isFinite(from?.x) ||
    !Number.isFinite(from?.y) ||
    !Number.isFinite(to?.x) ||
    !Number.isFinite(to?.y)
  ) {
    return;
  }

  ctx.fillStyle = color;
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(to.x);
  const endY = Math.round(to.y);
  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;

  while (true) {
    ctx.fillRect(x, y, 1, 1);
    if (x === endX && y === endY) {
      break;
    }
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

function drawDebugBox(ctx, centerX, centerY, size, color) {
  const half = Math.floor(size / 2);
  const x = Math.round(centerX) - half;
  const y = Math.round(centerY) - half;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, 1);
  ctx.fillRect(x, y + size - 1, size, 1);
  ctx.fillRect(x, y, 1, size);
  ctx.fillRect(x + size - 1, y, 1, size);
}

function drawDebugCross(ctx, centerX, centerY, color) {
  const x = Math.round(centerX);
  const y = Math.round(centerY);
  ctx.fillStyle = color;
  ctx.fillRect(x - 4, y, 9, 1);
  ctx.fillRect(x, y - 4, 1, 9);
  ctx.fillRect(x - 1, y - 1, 3, 3);
}

function drawEndedHud(ctx, room, options, colors, textRenderer) {
  const won = room.winnerId && room.winnerId === options.playerId;
  const title = won ? "YOU WON!" : "GAME OVER";
  const results = endGameResults(room, options.snapshot);
  const rowCount = Math.max(1, results.length);
  const resetSeconds = Number.isFinite(room.resetToLobbyAtMs)
    ? Math.max(0, Math.ceil((room.resetToLobbyAtMs - Date.now()) / 1000))
    : null;
  const panel = mainHudPanelRect(
    ctx,
    ENDED_HUD_LAYOUT.width,
    endedHudPanelHeight(rowCount, resetSeconds !== null)
  );
  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };
  const padding = HUD_PANEL_PADDING;
  const placeX = panel.x + padding;
  const killsX = panel.x + 45;
  const timeX = panel.x + 78;

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  textRenderer.draw(ctx, title, placeX, panel.y + ENDED_HUD_LAYOUT.titleY, {
    ...textOptions,
    width: panel.width - padding * 2
  });
  textRenderer.draw(ctx, "KILLS", killsX, panel.y + ENDED_HUD_LAYOUT.headerY, {
    ...textOptions,
    width: timeX - killsX - 2
  });
  textRenderer.draw(ctx, "TIME", timeX, panel.y + ENDED_HUD_LAYOUT.headerY, {
    ...textOptions,
    width: panel.x + panel.width - padding - timeX
  });

  results.forEach((result, index) => {
    const rowY = panel.y + ENDED_HUD_LAYOUT.rowStartY + index * ENDED_HUD_LAYOUT.rowStep;
    const highlighted = result.id === options.playerId;
    const rowTextOptions = {
      ...textOptions,
      color: highlighted ? colors.background : colors.foreground
    };
    if (highlighted) {
      ctx.fillStyle = colors.foreground;
      ctx.fillRect(
        panel.x + 4,
        rowY - 1,
        panel.width - 8,
        ENDED_HUD_LAYOUT.rowHighlightHeight
      );
    }

    textRenderer.draw(ctx, placeLabel(index + 1), placeX, rowY, {
      ...rowTextOptions,
      width: 30
    });
    textRenderer.draw(ctx, result.killsLabel, killsX, rowY, {
      ...rowTextOptions,
      width: timeX - killsX - 2
    });
    textRenderer.draw(ctx, result.timeLabel, timeX, rowY, {
      ...rowTextOptions,
      width: panel.x + panel.width - padding - timeX
    });
  });

  if (resetSeconds !== null) {
    const countdownY = panel.y + endedHudCountdownY(rowCount);
    textRenderer.draw(ctx, `LOBBY ${formatClock(resetSeconds)}`, placeX, countdownY, {
      ...textOptions,
      width: panel.width - padding * 2
    });
  }
  drawTerminalLeaveAction(ctx, panel.x + 2, panel.y + panel.height + HUD_PANEL_ACTION_GAP, options, colors, textRenderer);
}

function endedHudPanelHeight(rowCount, hasCountdown) {
  const contentBottom = ENDED_HUD_LAYOUT.rowStartY + rowCount * ENDED_HUD_LAYOUT.rowStep;
  const countdownBottom = hasCountdown
    ? endedHudCountdownY(rowCount) + 8
    : contentBottom;
  return countdownBottom + ENDED_HUD_LAYOUT.bottomPadding;
}

function endedHudCountdownY(rowCount) {
  return ENDED_HUD_LAYOUT.rowStartY +
    rowCount * ENDED_HUD_LAYOUT.rowStep +
    ENDED_HUD_LAYOUT.countdownGap;
}

function playerPlaceInSnapshot(room, snapshot, playerId) {
  if (!playerId) {
    return null;
  }

  const index = endGameResults(room, snapshot).findIndex((result) => result.id === playerId);
  return index >= 0 ? index + 1 : null;
}

function endGameResults(room, snapshot) {
  const snapshotPlayers = Array.isArray(snapshot?.players) ? snapshot.players : [];
  const roomPlayers = Array.isArray(room?.players) ? room.players : [];
  const players = snapshotPlayers.length > 0
    ? snapshotPlayers
    : roomPlayers.map((player) => ({
        id: player.id || player.clientId,
        clientId: player.clientId,
        name: player.name,
        alive: player.alive !== false,
        kills: 0,
        eliminatedAtTick: null
      }));
  const winnerId = room?.winnerId || players.find((player) => player.alive === true)?.id || null;

  return players
    .map((player, index) => {
      const rawEliminatedAtTick = player.eliminatedAtTick;
      const eliminatedAtTick = Number(rawEliminatedAtTick);
      const hasEliminatedAtTick = rawEliminatedAtTick !== null &&
        rawEliminatedAtTick !== undefined &&
        Number.isFinite(eliminatedAtTick);
      const alive = player.alive === true || player.id === winnerId || player.clientId === winnerId;
      const kills = Math.max(0, Math.floor(Number(player.kills || 0)));
      return {
        id: player.id || player.clientId || `player-${index}`,
        number: Number.isFinite(player.number) ? player.number : index + 1,
        alive,
        kills,
        eliminatedAtTick: hasEliminatedAtTick ? eliminatedAtTick : null,
        killsLabel: kills > 0 ? String(kills) : "",
        timeLabel: alive || !hasEliminatedAtTick
          ? ""
          : formatClock(Math.max(0, Math.floor(eliminatedAtTick / ENGINE.tickRate)))
      };
    })
    .sort((a, b) => {
      const aWinner = a.id === winnerId;
      const bWinner = b.id === winnerId;
      if (aWinner !== bWinner) {
        return aWinner ? -1 : 1;
      }

      const aTick = Number.isFinite(a.eliminatedAtTick) ? a.eliminatedAtTick : Number.POSITIVE_INFINITY;
      const bTick = Number.isFinite(b.eliminatedAtTick) ? b.eliminatedAtTick : Number.POSITIVE_INFINITY;
      return bTick - aTick ||
        b.kills - a.kills ||
        a.number - b.number ||
        a.id.localeCompare(b.id);
    })
    .slice(0, ENGINE.maxPlayers);
}

function placeLabel(place) {
  if (place % 100 >= 11 && place % 100 <= 13) {
    return `${place}TH`;
  }

  switch (place % 10) {
    case 1:
      return `${place}ST`;
    case 2:
      return `${place}ND`;
    case 3:
      return `${place}RD`;
    default:
      return `${place}TH`;
  }
}

function drawTerminalLeaveAction(ctx, x, y, options, colors, textRenderer) {
  if (options.controllerActive) {
    drawControllerHudAction(ctx, "faceRight", "LEAVE", x, y, colors, textRenderer);
    return;
  }

  const textOptions = {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER
  };

  if (options.mobileActive) {
    textRenderer.draw(ctx, "LEAVE", x, y + 2, {
      ...textOptions,
      width: 96
    });
    return;
  }

  textRenderer.draw(ctx, "ESC - LEAVE", x, y + 2, {
    ...textOptions,
    width: 96
  });
}

function drawTerminalConfirmLeaveAction(ctx, x, y, options, colors, textRenderer) {
  if (options.controllerActive) {
    drawControllerHudAction(ctx, "faceBottom", "CONFIRM", x, y, colors, textRenderer);
    return;
  }

  if (options.mobileActive) {
    textRenderer.draw(ctx, "CONFIRM", x, y + 2, {
      fontSize: 8,
      color: colors.foreground,
      ...HUD_CONTROL_TEXT_BORDER,
      width: 112
    });
    return;
  }

  textRenderer.draw(ctx, "ENTER - CONFIRM", x, y + 2, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER,
    width: 112
  });
}

function drawEliminationNotices(ctx, notices, colors, textRenderer, timeSeconds = 0) {
  const activeNotices = notices
    .filter((notice) => notice.expiresAt > timeSeconds)
    .slice(-3)
    .reverse();
  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };

  activeNotices.forEach((notice, index) => {
    const textWidth = textRenderer.measure(notice.text, textOptions);
    const panelWidth = Math.min(ctx.width - 16, textWidth + 10);
    const panelHeight = 15;
    const x = ctx.width - panelWidth - 8;
    const y = ctx.height - 8 - panelHeight - index * (panelHeight + 3);

    drawPanel(ctx, x, y, panelWidth, panelHeight, colors);
    textRenderer.draw(ctx, notice.text, x + 5, y + 4, {
      ...textOptions,
      width: panelWidth - 10
    });
  });
}

function drawRoomButtons(ctx, options, colors, textRenderer) {
  const buttons = options.roomButtons || {};

  for (const [buttonId, rect] of Object.entries(buttons)) {
    drawRoomButton(
      ctx,
      buttonLabel(buttonId),
      rect,
      buttonId === options.uiTargetId,
      colors,
      textRenderer
    );
  }
}

function drawRoomButton(ctx, label, rect, selected, colors, textRenderer) {
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = selected ? colors.foreground : colors.background;
  ctx.fillRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);

  const textOptions = {
    fontSize: 10,
    color: selected ? colors.background : colors.foreground
  };
  const labelWidth = textRenderer.measure(label, textOptions);
  textRenderer.draw(ctx, label, Math.round(rect.x + (rect.width - labelWidth) / 2), rect.y + 7, {
    ...textOptions,
    width: rect.width - 4
  });
}

function buttonLabel(buttonId) {
  if (buttonId === "ready") {
    return "READY";
  }

  if (buttonId === "start") {
    return "START";
  }

  return "LEAVE";
}

function drawPanel(ctx, x, y, width, height, colors) {
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
}

function drawCenteredText(ctx, textRenderer, text, centerX, y, options = {}) {
  const width = options.width || ctx.width;
  const textWidth = textRenderer.measure(text, options);
  textRenderer.draw(ctx, text, Math.round(centerX - textWidth / 2), y, {
    ...options,
    width
  });
}

function drawRightAlignedText(ctx, textRenderer, text, rightX, y, options = {}) {
  if (!text) {
    return;
  }

  const textWidth = textRenderer.measure(text, options);
  textRenderer.draw(ctx, text, rightX - textWidth, y, {
    ...options,
    width: textWidth + 1
  });
}

function formatClock(seconds) {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const remainder = String(clamped % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function cameraForSnapshot(
  snapshot,
  playerId,
  timeSeconds = 0,
  predictedPlayer = null,
  renderedPlayers = null,
  viewportWidth = RENDER.width,
  viewportHeight = RENDER.height
) {
  const players = renderedPlayers || snapshot.players;
  const target =
    predictedPlayer?.id === playerId ? predictedPlayer :
    players.find((player) => player.id === playerId) ||
    players[0] || {
      x: snapshot.world.width / 2,
      y: snapshot.world.height / 2,
      shake: 0
    };
  const shake = shakeOffset(target.shake || 0, timeSeconds);

  return {
    x: target.x - viewportWidth / 2 + shake.x,
    y: target.y - viewportHeight / 2 + shake.y,
    lensSourcePadding: worldLensSourcePadding(viewportWidth, viewportHeight)
  };
}

function shakeOffset(amount, timeSeconds) {
  if (amount <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.round(Math.sin(timeSeconds * 91.7) * amount),
    y: Math.round(Math.cos(timeSeconds * 83.3) * amount)
  };
}

function cameraCullPadding(camera) {
  return camera?.lensSourcePadding || 0;
}

function asteroidMiningTargetMap(snapshot) {
  const targets = new Map();

  for (const miningState of snapshot.asteroidMining || []) {
    targets.set(miningState.index, {
      phase: miningState.phase,
      progress: miningState.progress || 0
    });
  }

  for (const player of snapshot.players || []) {
    for (const ray of miningRayRenderableLanes(player.miningRay)) {
      if (!ray?.mineable || ray.index === null || ray.index === undefined) {
        continue;
      }

      if (ray.tile === ASTEROID_TILE.ore || ray.tile === ASTEROID_TILE.diamond) {
        const current = targets.get(ray.index);
        const progress = ray.progress || 0;
        if (!current || progress > current.progress) {
          targets.set(ray.index, {
            phase: null,
            tile: ray.tile,
            progress
          });
        }
      }
    }
  }

  return targets;
}

function drawAsteroid(
  ctx,
  asteroid,
  camera,
  colors,
  timeSeconds,
  asteroidMiningTargets,
  visibility = null,
  gpuStormRenderer = null,
  stormFocusPlayer = null,
  gpuFrameStormReady = false
) {
  drawAsteroidTiles(ctx, asteroid, camera, colors, timeSeconds, asteroidMiningTargets, visibility);
  const stormOverlayIncludesBoundary = drawStormOverlay(
    ctx,
    asteroid,
    camera,
    colors,
    timeSeconds,
    visibility,
    gpuStormRenderer,
    stormFocusPlayer,
    gpuFrameStormReady
  );
  if (asteroid.storm) {
    if (!stormOverlayIncludesBoundary) {
      drawStormBoundary(ctx, asteroid, camera, colors, timeSeconds);
    }
  } else {
    drawAsteroidBoundary(ctx, asteroid, camera, colors, visibility);
  }
}

function drawStormOverlay(
  ctx,
  asteroid,
  camera,
  colors,
  timeSeconds,
  visibility = null,
  gpuStormRenderer = null,
  stormFocusPlayer = null,
  gpuFrameStormReady = false
) {
  if (!asteroid.storm) {
    return false;
  }

  const stormFocus = stormFocusForPlayer(asteroid, stormFocusPlayer);
  if (
    gpuFrameStormReady &&
    stormFocusPlayer &&
    typeof ctx.queueGpuStormLayer === "function" &&
    ctx.queueGpuStormLayer({
      asteroid,
      camera: { x: camera.x, y: camera.y },
      timeSeconds,
      stormFocus,
      sourcePadding: cameraCullPadding(camera),
      visibilitySpans: visibility?.spans || null,
      palette: {
        background: colors.background,
        foreground: colors.foreground,
        backing: colors.backing || "#000000"
      }
    })
  ) {
    return true;
  }

  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const padding = cameraCullPadding(camera);
  const lensSource = typeof ctx.lensSourceSize === "function" ? ctx.lensSourceSize() : null;
  const renderWidth = lensSource?.width || ctx.width;
  const renderHeight = lensSource?.height || ctx.height;
  const renderCamera = lensSource
    ? { x: camera.x - lensSource.padding, y: camera.y - lensSource.padding }
    : camera;
  const nativeStorm = typeof ctx.drawCodeRuns === "function" || typeof ctx.drawCodeLayer === "function"
    ? cachedStormOverlayNative(asteroid, renderCamera, renderWidth, renderHeight, timeSeconds, lensSource ? 0 : padding, Boolean(lensSource))
    : null;
  if (!stormFocus && nativeStorm?.runs && typeof ctx.drawCodeRuns === "function") {
    ctx.drawCodeRuns(nativeStorm.runs, {
      background: colors.background,
      foreground: colors.foreground,
      backing: colors.backing || "#000000"
    });
    return false;
  }
  if (!stormFocus && nativeStorm?.layer && typeof ctx.drawCodeLayer === "function") {
    ctx.drawCodeLayer(nativeStorm.layer, {
      background: colors.background,
      foreground: colors.foreground,
      backing: colors.backing || "#000000"
    });
    return false;
  }

  if (gpuStormRenderer && typeof ctx.drawGpuCodeLayer === "function") {
    const gpuStorm = gpuStormRenderer.draw(
      asteroid,
      camera,
      timeSeconds,
      stormFocus
    );
    if (gpuStorm?.runs && typeof ctx.drawCodeRuns === "function") {
      ctx.drawCodeRuns(gpuStorm.runs, {
        background: colors.background,
        foreground: colors.foreground,
        backing: colors.backing || "#000000"
      });
      return true;
    }
    if (gpuStorm?.rgba) {
      ctx.drawGpuCodeLayer(gpuStorm.rgba, gpuStorm.width, gpuStorm.height, {
        background: colors.background,
        foreground: colors.foreground,
        backing: colors.backing || "#000000"
      }, { flipY: true });
      return true;
    }
  }

  if (nativeStorm?.runs && typeof ctx.drawCodeRuns === "function") {
    ctx.drawCodeRuns(nativeStorm.runs, {
      background: colors.background,
      foreground: colors.foreground,
      backing: colors.backing || "#000000"
    });
    return false;
  }
  if (nativeStorm?.layer && typeof ctx.drawCodeLayer === "function") {
    ctx.drawCodeLayer(nativeStorm.layer, {
      background: colors.background,
      foreground: colors.foreground,
      backing: colors.backing || "#000000"
    });
    return false;
  }

  const minTileX = Math.floor((camera.x - padding) / tileSize) - 1;
  const maxTileX = Math.ceil((camera.x + ctx.width + padding) / tileSize) + 1;
  const minTileY = Math.floor((camera.y - padding) / tileSize) - 1;
  const maxTileY = Math.ceil((camera.y + ctx.height + padding) / tileSize) + 1;

  const visibleStormTiles = [];
  ctx.fillStyle = colors.background;
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    let runStartTileX = null;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const state = stormTileStateAt(asteroid, tileX, tileY);
      const isStorm = state === STORM_STATE.storm;
      if (isStorm) {
        visibleStormTiles.push({ tileX, tileY });
        if (runStartTileX === null) {
          runStartTileX = tileX;
        }
      }

      if (!isStorm && runStartTileX !== null) {
        drawStormBackingRun(ctx, runStartTileX, tileX, tileY, tileSize, camera);
        runStartTileX = null;
      }
    }

    if (runStartTileX !== null) {
      drawStormBackingRun(ctx, runStartTileX, maxTileX + 1, tileY, tileSize, camera);
    }
  }

  ctx.fillStyle = colors.foreground;
  for (const tile of visibleStormTiles) {
    const screenX = Math.round(tile.tileX * tileSize - camera.x);
    const screenY = Math.round(tile.tileY * tileSize - camera.y);
    drawStormTilePattern(ctx, asteroid, screenX, screenY, tileSize, tile.tileX, tile.tileY, timeSeconds);
  }
  return false;
}

function cachedStormOverlayNative(asteroid, camera, width, height, timeSeconds, padding, noLens = false) {
  const frame = Math.floor(Number(timeSeconds || 0) * STORM_PATTERN_FPS);
  const key = [
    asteroid.seed || "default",
    asteroid.revision || asteroid._revision || 0,
    asteroid.widthTiles,
    asteroid.heightTiles,
    asteroid.storm?.length || 0,
    Math.floor(width),
    Math.floor(height),
    Math.floor(Number(camera.x || 0)),
    Math.floor(Number(camera.y || 0)),
    Math.floor(Number(padding || 0)),
    noLens ? 1 : 0,
    frame
  ].join(":");
  if (stormOverlayLayerCache?.key === key) {
    return stormOverlayLayerCache.value;
  }

  const nativeOptions = {
    sourcePadding: padding,
    noLens,
    lensEdgeScale: WORLD_LENS_EDGE_SCALE,
    lensPower: WORLD_LENS_POWER,
    lensNoiseRadial: WORLD_LENS_NOISE_RADIAL,
    lensNoiseTangential: WORLD_LENS_NOISE_TANGENTIAL,
    lensDefectDensity: WORLD_LENS_DEFECT_DENSITY,
    constants: {
      fps: STORM_PATTERN_FPS,
      scale: STORM_NOISE_SCALE,
      speedX: STORM_NOISE_SPEED_X,
      speedY: STORM_NOISE_SPEED_Y,
      speedZ: STORM_NOISE_SPEED_Z
    }
  };
  const stableTimeSeconds = frame / STORM_PATTERN_FPS;
  const runs = stormRunsNative(asteroid, camera, width, height, stableTimeSeconds, STORM_NOISE_THRESHOLD, nativeOptions);
  const value = runs
    ? { runs }
    : {
      layer: stormLayerNative(asteroid, camera, width, height, stableTimeSeconds, STORM_NOISE_THRESHOLD, nativeOptions)
    };
  stormOverlayLayerCache = { key, value };
  return value;
}

function drawStormBackingRun(ctx, startTileX, endTileX, tileY, tileSize, camera) {
  ctx.fillRect(
    Math.round(startTileX * tileSize - camera.x),
    Math.round(tileY * tileSize - camera.y),
    (endTileX - startTileX) * tileSize,
    tileSize
  );
}

function extrapolateRemotePlayer(player, snapshot, timeSeconds) {
  if (!player.alive) {
    return player;
  }

  const receivedAtSeconds = snapshot.receivedAtSeconds ?? timeSeconds;
  const snapshotAgeSeconds = clamp(timeSeconds - receivedAtSeconds, 0, REMOTE_PLAYER_MAX_EXTRAPOLATION_SECONDS);
  const leadSeconds = clamp(
    snapshotAgeSeconds + REMOTE_PLAYER_LOOKAHEAD_SECONDS,
    0,
    REMOTE_PLAYER_MAX_EXTRAPOLATION_SECONDS
  );
  const motion = remotePlayerProjectedMotion(player, leadSeconds);
  const dx = motion.dx;
  const dy = motion.dy;
  if (dx === 0 && dy === 0) {
    return player;
  }

  return {
    ...player,
    x: player.x + dx,
    y: player.y + dy,
    vx: motion.vx,
    vy: motion.vy,
    miningRay: offsetMiningRay(player.miningRay, dx, dy)
  };
}

function applyVisualShipAngles(players, visualAngles, dtSeconds) {
  if (!(visualAngles instanceof Map) || !Array.isArray(players)) {
    return players;
  }

  const visibleKeys = new Set();
  const maxDelta = SHIP_VISUAL_ROTATION_SPEED * clamp(dtSeconds || 1 / 60, 0, 1 / 15);
  const result = players.map((player) => {
    const key = visualShipAngleKey(player);
    const target = shipControlAngle(player);
    if (!key || !Number.isFinite(target)) {
      return player;
    }

    visibleKeys.add(key);
    const previous = visualAngles.has(key)
      ? visualAngles.get(key)
      : target;
    const visualAngle = rotateAngleToward(previous, target, maxDelta);
    visualAngles.set(key, visualAngle);
    return {
      ...player,
      visualAngle
    };
  });

  for (const key of visualAngles.keys()) {
    if (!visibleKeys.has(key)) {
      visualAngles.delete(key);
    }
  }

  return result;
}

function visualShipAngleKey(player) {
  if (!player) {
    return null;
  }

  return player.id || (Number.isFinite(player.number) ? `ship-${player.number}` : null);
}

function shipVisualAngle(player) {
  return Number.isFinite(player?.visualAngle)
    ? player.visualAngle
    : shipControlAngle(player);
}

function shipControlAngle(player) {
  return Number.isFinite(player?.angle)
    ? player.angle
    : Number.isFinite(player?.aimAngle) ? player.aimAngle : 0;
}

function rotateAngleToward(current, target, maxDelta) {
  const delta = normalizeSignedAngle(target - current);
  if (Math.abs(delta) <= maxDelta) {
    return normalizeAngle(target);
  }

  return normalizeAngle(current + Math.sign(delta) * maxDelta);
}

function normalizeSignedAngle(angle) {
  const normalized = normalizeAngle(angle);
  return normalized > Math.PI ? normalized - Math.PI * 2 : normalized;
}

function normalizeAngle(angle) {
  return positiveModulo(angle, Math.PI * 2);
}

function remotePlayerProjectedMotion(player, seconds) {
  const vx = player.vx || 0;
  const vy = player.vy || 0;
  if (seconds <= 0) {
    return { dx: 0, dy: 0, vx, vy };
  }

  const moveMagnitude = Math.hypot(player.moveX || 0, player.moveY || 0);
  const canThrust = player.thrusting && moveMagnitude > 0.0001;
  if (!canThrust) {
    return {
      dx: vx * seconds,
      dy: vy * seconds,
      vx,
      vy
    };
  }

  const moveX = (player.moveX || 0) / moveMagnitude;
  const moveY = (player.moveY || 0) / moveMagnitude;
  const effects = aggregateUpgradeEffects(player.upgrades);
  const acceleration = ENGINE.ship.thrust * effects.thrustMultiplier;
  const accelerationX = moveX * acceleration;
  const accelerationY = moveY * acceleration;

  return {
    dx: vx * seconds + 0.5 * accelerationX * seconds * seconds,
    dy: vy * seconds + 0.5 * accelerationY * seconds * seconds,
    vx: vx + accelerationX * seconds,
    vy: vy + accelerationY * seconds
  };
}

function offsetMiningRay(miningRay, dx, dy) {
  if (!miningRay) {
    return miningRay;
  }

  return {
    ...miningRay,
    startX: Number.isFinite(miningRay.startX) ? miningRay.startX + dx : miningRay.startX,
    startY: Number.isFinite(miningRay.startY) ? miningRay.startY + dy : miningRay.startY,
    endX: Number.isFinite(miningRay.endX) ? miningRay.endX + dx : miningRay.endX,
    endY: Number.isFinite(miningRay.endY) ? miningRay.endY + dy : miningRay.endY,
    fullEndX: Number.isFinite(miningRay.fullEndX) ? miningRay.fullEndX + dx : miningRay.fullEndX,
    fullEndY: Number.isFinite(miningRay.fullEndY) ? miningRay.fullEndY + dy : miningRay.fullEndY,
    lanes: Array.isArray(miningRay.lanes)
      ? miningRay.lanes.map((lane) => offsetMiningRay(lane, dx, dy))
      : miningRay.lanes
  };
}

function drawStormTilePattern(
  ctx,
  asteroid,
  x,
  y,
  size,
  tileX,
  tileY,
  timeSeconds,
  threshold = STORM_NOISE_THRESHOLD
) {
  const rows = stormPatternRows(asteroid, tileX, tileY, size, timeSeconds, threshold);

  for (let py = 0; py < size; py += 1) {
    const row = rows[py] || 0;
    let px = 0;
    while (px < size) {
      while (px < size && (row & (1 << px)) === 0) {
        px += 1;
      }

      const runStart = px;
      while (px < size && (row & (1 << px)) !== 0) {
        px += 1;
      }

      if (px > runStart) {
        ctx.fillRect(x + runStart, y + py, px - runStart, 1);
      }
    }
  }
}

function stormPatternRows(asteroid, tileX, tileY, size, timeSeconds, threshold) {
  const frame = Math.floor(timeSeconds * STORM_PATTERN_FPS);
  if (stormPatternCacheFrame !== frame) {
    stormPatternCache.clear();
    stormPatternCacheFrame = frame;
  }

  const cacheKey = `${asteroid.seed || "default"}:${tileX}:${tileY}:${size}:${threshold}:${frame}`;
  const cached = stormPatternCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (stormPatternCache.size > STORM_PATTERN_MAX_CACHE) {
    stormPatternCache.clear();
  }

  const sampleTimeSeconds = frame / STORM_PATTERN_FPS;
  const nativeRows = stormPatternRowsNative(asteroid, tileX, tileY, size, sampleTimeSeconds, threshold, {
    fps: STORM_PATTERN_FPS,
    scale: STORM_NOISE_SCALE,
    speedX: STORM_NOISE_SPEED_X,
    speedY: STORM_NOISE_SPEED_Y,
    speedZ: STORM_NOISE_SPEED_Z
  });
  if (nativeRows) {
    stormPatternCache.set(cacheKey, nativeRows);
    return nativeRows;
  }

  const worldLeft = tileX * size;
  const worldTop = tileY * size;
  const rows = new Uint32Array(size);

  for (let py = 0; py < size; py += 1) {
    let row = 0;
    for (let px = 0; px < size; px += 1) {
      if (stormNoiseAt(asteroid, worldLeft + px, worldTop + py, sampleTimeSeconds) >= threshold) {
        row |= 1 << px;
      }
    }
    rows[py] = row;
  }

  stormPatternCache.set(cacheKey, rows);
  return rows;
}

function stormNoiseAt(asteroid, worldX, worldY, timeSeconds) {
  const noise = stormNoiseForSeed(asteroid.seed);
  const sampleX = (worldX + timeSeconds * STORM_NOISE_SPEED_X) * STORM_NOISE_SCALE;
  const sampleY = (worldY + timeSeconds * STORM_NOISE_SPEED_Y) * STORM_NOISE_SCALE;
  const sampleZ = timeSeconds * STORM_NOISE_SPEED_Z;
  return noise(sampleX, sampleY, sampleZ);
}

function stormNoiseForSeed(seed) {
  const cacheKey = `${seed || "default"}:storm-visual`;
  let noise = stormNoiseCache.get(cacheKey);
  if (!noise) {
    noise = createSimplexNoise3D(cacheKey);
    stormNoiseCache.set(cacheKey, noise);
  }

  return noise;
}

function drawAsteroidTiles(
  ctx,
  asteroid,
  camera,
  colors,
  timeSeconds,
  asteroidMiningTargets,
  visibility = null
) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const padding = cameraCullPadding(camera);
  const minTileX = Math.max(0, Math.floor((camera.x - padding) / tileSize) - 1);
  const maxTileX = Math.min(
    asteroid.widthTiles - 1,
    Math.ceil((camera.x + ctx.width + padding) / tileSize) + 1
  );
  const minTileY = Math.max(0, Math.floor((camera.y - padding) / tileSize) - 1);
  const maxTileY = Math.min(
    asteroid.heightTiles - 1,
    Math.ceil((camera.y + ctx.height + padding) / tileSize) + 1
  );

  if (!visibility) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const index = tileY * asteroid.widthTiles + tileX;
        const tile = asteroid.tiles[index];
        if (!isSolidTile(tile)) {
          continue;
        }

        const screenX = Math.round(tileX * tileSize - camera.x);
        const screenY = Math.round(tileY * tileSize - camera.y);
        drawRockFill(ctx, screenX, screenY, tileSize, colors);
      }
    }
  }

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const index = tileY * asteroid.widthTiles + tileX;
      const tile = asteroid.tiles[index];
      if (!isSolidTile(tile)) {
        continue;
      }
      if (visibility && !asteroidVisibilityRendersShell(visibility, tileX, tileY)) {
        continue;
      }

      const screenX = Math.round(tileX * tileSize - camera.x);
      const screenY = Math.round(tileY * tileSize - camera.y);
      if (tile === ASTEROID_TILE.wall) {
        drawWallOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors, visibility);
      } else {
        drawRockOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors, visibility);
      }
    }
  }

  drawInnerRockCornerConnectors(ctx, asteroid, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY, colors, visibility);

  const drawResources = () => {
    ctx.fillStyle = colors.foreground;
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const index = tileY * asteroid.widthTiles + tileX;
        const tile = asteroid.tiles[index];
        if (!isRockTile(tile)) {
          continue;
        }

        const screenX = Math.round(tileX * tileSize - camera.x);
        const screenY = Math.round(tileY * tileSize - camera.y);
        if (tile === ASTEROID_TILE.ore) {
          const amount = amountAt(asteroid, index);
          drawOreRings(
            ctx,
            screenX,
            screenY,
            tileSize,
            amount,
            hashCell(asteroid.seed, tileX, tileY),
            oreMiningProgressFor(asteroidMiningTargets, index, amount)
          );
        } else if (tile === ASTEROID_TILE.diamond) {
          drawDiamondWireframe(
            ctx,
            screenX,
            screenY,
            tileSize,
            hashCell(asteroid.seed, tileX, tileY),
            diamondMiningProgressFor(asteroidMiningTargets, index)
          );
        }
      }
    }
  };
  if (visibility && typeof ctx.withoutWorldMask === "function") {
    ctx.withoutWorldMask(drawResources);
  } else {
    drawResources();
  }
}

function createAsteroidVisibilityMask(ctx, options, asteroid, player, camera) {
  if (
    !ASTEROID_VISIBILITY_EXPERIMENT ||
    options.playerMapLarge ||
    !asteroid ||
    !player ||
    player.alive === false
  ) {
    return null;
  }

  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const width = asteroid.widthTiles;
  const height = asteroid.heightTiles;
  const playerId = player.id || "camera";
  const sourcePadding = cameraCullPadding(camera);
  const radius = Math.min(ctx.width, ctx.height) / 2 + sourcePadding;
  const bounds = {
    minTileX: clamp(Math.floor((player.x - radius) / tileSize) - 1, 0, width - 1),
    maxTileX: clamp(Math.ceil((player.x + radius) / tileSize) + 1, 0, width - 1),
    minTileY: clamp(Math.floor((player.y - radius) / tileSize) - 1, 0, height - 1),
    maxTileY: clamp(Math.ceil((player.y + radius) / tileSize) + 1, 0, height - 1)
  };
  const startTileX = Math.floor(player.x / tileSize);
  const startTileY = Math.floor(player.y / tileSize);
  if (startTileX < 0 || startTileY < 0 || startTileX >= width || startTileY >= height) {
    return null;
  }

  if (!asteroidVisibilityCanStartAt(asteroid, startTileX, startTileY)) {
    return null;
  }

  const origin = {
    x: player.x - camera.x,
    y: player.y - camera.y
  };
  const visibilityOptions = {
    baseRays: ASTEROID_VISIBILITY_BASE_RAYS,
    angleEpsilon: ASTEROID_VISIBILITY_ANGLE_EPSILON,
    dilatePixels: ASTEROID_VISIBILITY_DILATE_PIXELS,
    outerBevel: ASTEROID_VISIBILITY_OUTER_BEVEL_RADIUS,
    innerCorner: ROCK_INNER_CORNER_RADIUS,
    edgeOverlap: ASTEROID_VISIBILITY_DILATE_PIXELS
  };
  let spans = visibilitySpansFromGridNative(asteroid, player, camera, radius, bounds, visibilityOptions);
  if (!spans) {
    const segments = buildAsteroidVisibilitySegments(asteroid, camera, player, radius, bounds);
    spans = visibilitySpansNative(origin, radius, segments, visibilityOptions) ||
      rasterizeAsteroidVisibilityPolygon(buildAsteroidVisibilityPolygon(origin, radius, segments));
  }
  return {
    asteroid,
    width,
    height,
    tileSize,
    playerId,
    cameraX: camera.x,
    cameraY: camera.y,
    origin,
    radius,
    sourcePadding,
    spans
  };
}

function asteroidVisibilityCanStartAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return !isSolidTile(asteroid.tiles[index]);
}

function drawAsteroidVisibilityGhostMap(
  ctx,
  asteroid,
  camera,
  colors,
  timeSeconds,
  visibility = null,
  gpuStormRenderer = null,
  gpuFrameStormReady = false,
  gpuFrameCheckerReady = false,
  perfBuckets = null
) {
  if (!asteroid) {
    return;
  }
  const measureGhostBucket = perfBuckets
    ? (key, callback) => {
      const start = performance.now();
      const value = callback();
      perfBuckets[key] += performance.now() - start;
      return value;
    }
    : (_key, callback) => callback();

  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const padding = cameraCullPadding(camera);
  const viewMinTileX = Math.floor((camera.x - padding) / tileSize) - 1;
  const viewMaxTileX = Math.ceil((camera.x + ctx.width + padding) / tileSize) + 1;
  const viewMinTileY = Math.floor((camera.y - padding) / tileSize) - 1;
  const viewMaxTileY = Math.ceil((camera.y + ctx.height + padding) / tileSize) + 1;
  const minTileX = Math.max(0, viewMinTileX);
  const maxTileX = Math.min(
    asteroid.widthTiles - 1,
    viewMaxTileX
  );
  const minTileY = Math.max(0, viewMinTileY);
  const maxTileY = Math.min(
    asteroid.heightTiles - 1,
    viewMaxTileY
  );
  let gpuCheckerQueued = false;

  measureGhostBucket("ghostCheckerMs", () => {
    const queuedGpuChecker = gpuFrameCheckerReady &&
      typeof ctx.queueGpuCheckerLayer === "function" &&
      ctx.queueGpuCheckerLayer({
        asteroid,
        camera: { x: camera.x, y: camera.y },
        palette: {
          background: colors.background,
          backing: colors.backing || "#000000"
        }
      });
    if (queuedGpuChecker) {
      gpuCheckerQueued = true;
      return;
    }

    const nativeCheckerLayer = typeof ctx.drawCodeLayer === "function" && !ctx.isLensActive?.()
      ? visibilityCheckerLayerNative(asteroid, camera, ctx.width, ctx.height, {
        sourcePadding: padding,
        lensEdgeScale: WORLD_LENS_EDGE_SCALE,
        lensPower: WORLD_LENS_POWER,
        lensNoiseRadial: WORLD_LENS_NOISE_RADIAL,
        lensNoiseTangential: WORLD_LENS_NOISE_TANGENTIAL,
        lensDefectDensity: WORLD_LENS_DEFECT_DENSITY
      })
      : null;
    if (nativeCheckerLayer) {
      ctx.drawCodeLayer(nativeCheckerLayer, {
        background: colors.background,
        foreground: colors.foreground,
        backing: colors.backing || "#000000"
      });
    } else {
      for (let tileY = viewMinTileY; tileY <= viewMaxTileY; tileY += 1) {
        for (let tileX = viewMinTileX; tileX <= viewMaxTileX; tileX += 1) {
          if (
            tileX >= 0 &&
            tileY >= 0 &&
            tileX < asteroid.widthTiles &&
            tileY < asteroid.heightTiles &&
            isPlayableTile(asteroid, tileX, tileY) &&
            isSolidTile(asteroid.tiles[tileY * asteroid.widthTiles + tileX])
          ) {
            continue;
          }

          drawAsteroidVisibilityCheckerCell(ctx, tileX, tileY, tileSize, camera, colors);
        }
      }
    }
  });

  const ghostColors = {
    ...colors,
    foreground: colors.background,
    background: colors.backing || "#000000"
  };

  measureGhostBucket("ghostOutlineMs", () => {
    if (gpuCheckerQueued) {
      return;
    }

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const index = tileY * asteroid.widthTiles + tileX;
        const tile = asteroid.tiles[index];
        if (!isSolidTile(tile)) {
          continue;
        }

        const screenX = Math.round(tileX * tileSize - camera.x);
        const screenY = Math.round(tileY * tileSize - camera.y);
        if (tile === ASTEROID_TILE.wall) {
          drawAsteroidVisibilityGhostWallOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors, camera);
        } else {
          drawAsteroidVisibilityGhostRockOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors, camera);
        }
      }
    }

    drawAsteroidVisibilityGhostInnerRockCornerConnectors(
      ctx,
      asteroid,
      camera,
      tileSize,
      minTileX,
      maxTileX,
      minTileY,
      maxTileY,
      colors
    );
  });
  measureGhostBucket("ghostStormMs", () => {
    if (asteroid.storm) {
      const queuedGpuGhostStorm = gpuFrameStormReady &&
        typeof ctx.queueGpuStormLayer === "function" &&
        ctx.queueGpuStormLayer({
          asteroid,
          camera: { x: camera.x, y: camera.y },
          timeSeconds,
          stormFocus: null,
          sourcePadding: cameraCullPadding(camera),
          visibilitySpans: visibility?.spans || null,
          visibilityMaskMode: "exclude",
          palette: {
            background: ghostColors.background,
            foreground: ghostColors.foreground,
            backing: ghostColors.backing || ghostColors.background || "#000000"
          }
        });
      if (!queuedGpuGhostStorm) {
        const stormOverlayIncludesBoundary = drawStormOverlay(ctx, asteroid, camera, ghostColors, timeSeconds, null, gpuStormRenderer);
        if (!stormOverlayIncludesBoundary) {
          drawStormBoundary(ctx, asteroid, camera, ghostColors, timeSeconds);
        }
      }
    }
  });
}

function drawAsteroidVisibilityCheckerCell(ctx, tileX, tileY, tileSize, camera, colors) {
  const x = Math.round(tileX * tileSize - camera.x);
  const y = Math.round(tileY * tileSize - camera.y);

  ctx.fillStyle = colors.background;
  for (let offsetY = 0; offsetY < tileSize; offsetY += 1) {
    for (let offsetX = 0; offsetX < tileSize; offsetX += 1) {
      if (!asteroidVisibilityCheckerPixelOn(x + offsetX, y + offsetY, camera)) {
        continue;
      }

      ctx.fillRect(x + offsetX, y + offsetY, 1, 1);
    }
  }
}

function asteroidVisibilityCheckerPixelOn(pixelX, pixelY, camera) {
  const worldX = pixelX + renderedCameraPixelOffset(camera?.x || 0);
  const worldY = pixelY + renderedCameraPixelOffset(camera?.y || 0);
  return (((Math.floor(worldX / ASTEROID_VISIBILITY_CHECKER_SIZE) +
    Math.floor(worldY / ASTEROID_VISIBILITY_CHECKER_SIZE)) & 1)) !== 0;
}

function renderedCameraPixelOffset(value) {
  return Math.ceil(value - 0.5);
}

function drawAsteroidVisibilityGhostRockOutline(ctx, asteroid, tileX, tileY, x, y, size, colors, camera) {
  const north = rockTileBlocksVisibleOutline(asteroid, null, tileX, tileY - 1);
  const east = rockTileBlocksVisibleOutline(asteroid, null, tileX + 1, tileY);
  const south = rockTileBlocksVisibleOutline(asteroid, null, tileX, tileY + 1);
  const west = rockTileBlocksVisibleOutline(asteroid, null, tileX - 1, tileY);
  const northWest = rockTileBlocksVisibleOutline(asteroid, null, tileX - 1, tileY - 1);
  const northEast = rockTileBlocksVisibleOutline(asteroid, null, tileX + 1, tileY - 1);
  const southEast = rockTileBlocksVisibleOutline(asteroid, null, tileX + 1, tileY + 1);
  const southWest = rockTileBlocksVisibleOutline(asteroid, null, tileX - 1, tileY + 1);
  const right = x + size - 1;
  const bottom = y + size - 1;
  const topOpen = !north;
  const rightOpen = !east;
  const bottomOpen = !south;
  const leftOpen = !west;
  const outerTopLeft = topOpen && leftOpen;
  const outerTopRight = topOpen && rightOpen;
  const outerBottomRight = bottomOpen && rightOpen;
  const outerBottomLeft = bottomOpen && leftOpen;
  const topTrimLeft = outerTopLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : topOpen && west && northWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const topTrimRight = outerTopRight
    ? ROCK_OUTER_CORNER_RADIUS
    : topOpen && east && northEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const rightTrimTop = outerTopRight
    ? ROCK_OUTER_CORNER_RADIUS
    : rightOpen && north && northEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const rightTrimBottom = outerBottomRight
    ? ROCK_OUTER_CORNER_RADIUS
    : rightOpen && south && southEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const bottomTrimRight = outerBottomRight
    ? ROCK_OUTER_CORNER_RADIUS
    : bottomOpen && east && southEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const bottomTrimLeft = outerBottomLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : bottomOpen && west && southWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const leftTrimBottom = outerBottomLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : leftOpen && south && southWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const leftTrimTop = outerTopLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : leftOpen && north && northWest ? ROCK_INNER_CORNER_RADIUS : 0;

  if (outerTopLeft) {
    drawAsteroidVisibilityCheckerOuterRockCorner(
      ctx,
      x + ROCK_OUTER_CORNER_RADIUS,
      y + ROCK_OUTER_CORNER_RADIUS,
      -1,
      -1,
      colors,
      camera
    );
  }
  if (outerTopRight) {
    drawAsteroidVisibilityCheckerOuterRockCorner(
      ctx,
      right - ROCK_OUTER_CORNER_RADIUS,
      y + ROCK_OUTER_CORNER_RADIUS,
      1,
      -1,
      colors,
      camera
    );
  }
  if (outerBottomRight) {
    drawAsteroidVisibilityCheckerOuterRockCorner(
      ctx,
      right - ROCK_OUTER_CORNER_RADIUS,
      bottom - ROCK_OUTER_CORNER_RADIUS,
      1,
      1,
      colors,
      camera
    );
  }
  if (outerBottomLeft) {
    drawAsteroidVisibilityCheckerOuterRockCorner(
      ctx,
      x + ROCK_OUTER_CORNER_RADIUS,
      bottom - ROCK_OUTER_CORNER_RADIUS,
      -1,
      1,
      colors,
      camera
    );
  }

  if (topOpen && x + topTrimLeft <= right - topTrimRight) {
    drawAsteroidVisibilityCheckerLine(ctx, x + topTrimLeft, y, right - topTrimRight, y, camera, colors);
  }

  if (rightOpen && y + rightTrimTop <= bottom - rightTrimBottom) {
    drawAsteroidVisibilityCheckerLine(ctx, right, y + rightTrimTop, right, bottom - rightTrimBottom, camera, colors);
  }

  if (bottomOpen && x + bottomTrimLeft <= right - bottomTrimRight) {
    drawAsteroidVisibilityCheckerLine(ctx, right - bottomTrimRight, bottom, x + bottomTrimLeft, bottom, camera, colors);
  }

  if (leftOpen && y + leftTrimTop <= bottom - leftTrimBottom) {
    drawAsteroidVisibilityCheckerLine(ctx, x, bottom - leftTrimBottom, x, y + leftTrimTop, camera, colors);
  }

  drawAsteroidVisibilityCheckerOuterRockCorners(ctx, x, y, right, bottom, {
    outerTopLeft,
    outerTopRight,
    outerBottomRight,
    outerBottomLeft
  }, colors, camera);
}

function drawAsteroidVisibilityGhostWallOutline(ctx, asteroid, tileX, tileY, x, y, size, colors, camera) {
  const north = wallTileBlocksVisibleOutline(asteroid, null, tileX, tileY - 1);
  const east = wallTileBlocksVisibleOutline(asteroid, null, tileX + 1, tileY);
  const south = wallTileBlocksVisibleOutline(asteroid, null, tileX, tileY + 1);
  const west = wallTileBlocksVisibleOutline(asteroid, null, tileX - 1, tileY);
  const northWest = wallTileBlocksVisibleOutline(asteroid, null, tileX - 1, tileY - 1);
  const northEast = wallTileBlocksVisibleOutline(asteroid, null, tileX + 1, tileY - 1);
  const southEast = wallTileBlocksVisibleOutline(asteroid, null, tileX + 1, tileY + 1);
  const southWest = wallTileBlocksVisibleOutline(asteroid, null, tileX - 1, tileY + 1);
  const left = x + (west ? 0 : 1);
  const right = x + size - 1 - (east ? 0 : 1);
  const top = y + (north ? 0 : 1);
  const bottom = y + size - 1 - (south ? 0 : 1);

  if (!north) {
    drawAsteroidVisibilityCheckerLine(ctx, left, top, right, top, camera, colors);
  }

  if (!east) {
    drawAsteroidVisibilityCheckerLine(ctx, right, top, right, bottom, camera, colors);
  }

  if (!south) {
    drawAsteroidVisibilityCheckerLine(ctx, right, bottom, left, bottom, camera, colors);
  }

  if (!west) {
    drawAsteroidVisibilityCheckerLine(ctx, left, bottom, left, top, camera, colors);
  }

  if (north && west && !northWest) {
    drawAsteroidVisibilityCheckerLine(ctx, x + 1, y, x + 1, y + 1, camera, colors);
    drawAsteroidVisibilityCheckerLine(ctx, x, y + 1, x + 1, y + 1, camera, colors);
  }

  if (north && east && !northEast) {
    drawAsteroidVisibilityCheckerLine(ctx, x + size - 2, y, x + size - 2, y + 1, camera, colors);
    drawAsteroidVisibilityCheckerLine(ctx, x + size - 2, y + 1, x + size, y + 1, camera, colors);
  }

  if (south && east && !southEast) {
    drawAsteroidVisibilityCheckerLine(ctx, x + size - 2, y + size - 2, x + size - 2, y + size, camera, colors);
    drawAsteroidVisibilityCheckerLine(ctx, x + size - 2, y + size - 2, x + size, y + size - 2, camera, colors);
  }

  if (south && west && !southWest) {
    drawAsteroidVisibilityCheckerLine(ctx, x + 1, y + size - 2, x + 1, y + size, camera, colors);
    drawAsteroidVisibilityCheckerLine(ctx, x, y + size - 2, x + 1, y + size - 2, camera, colors);
  }
}

function drawAsteroidVisibilityCheckerOuterRockCorner(ctx, centerX, centerY, signX, signY, colors, camera) {
  const radiusSq = ROCK_OUTER_CORNER_RADIUS * ROCK_OUTER_CORNER_RADIUS;
  ctx.fillStyle = colors.background;
  for (let offsetY = 0; offsetY <= ROCK_OUTER_CORNER_RADIUS; offsetY += 1) {
    for (let offsetX = 0; offsetX <= ROCK_OUTER_CORNER_RADIUS; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY <= radiusSq) {
        continue;
      }

      const pixelX = centerX + signX * offsetX;
      const pixelY = centerY + signY * offsetY;
      if (!asteroidVisibilityCheckerPixelOn(pixelX, pixelY, camera)) {
        continue;
      }

      ctx.fillRect(pixelX, pixelY, 1, 1);
    }
  }
}

function drawAsteroidVisibilityCheckerOuterRockCorners(ctx, x, y, right, bottom, corners, colors, camera) {
  ctx.fillStyle = colors.background;
  if (corners.outerTopLeft) {
    drawAsteroidVisibilityCheckerRockCornerArc(
      ctx,
      x + ROCK_OUTER_CORNER_RADIUS,
      y + ROCK_OUTER_CORNER_RADIUS,
      ROCK_OUTER_CORNER_RADIUS,
      -1,
      -1,
      camera
    );
  }

  if (corners.outerTopRight) {
    drawAsteroidVisibilityCheckerRockCornerArc(
      ctx,
      right - ROCK_OUTER_CORNER_RADIUS,
      y + ROCK_OUTER_CORNER_RADIUS,
      ROCK_OUTER_CORNER_RADIUS,
      1,
      -1,
      camera
    );
  }

  if (corners.outerBottomRight) {
    drawAsteroidVisibilityCheckerRockCornerArc(
      ctx,
      right - ROCK_OUTER_CORNER_RADIUS,
      bottom - ROCK_OUTER_CORNER_RADIUS,
      ROCK_OUTER_CORNER_RADIUS,
      1,
      1,
      camera
    );
  }

  if (corners.outerBottomLeft) {
    drawAsteroidVisibilityCheckerRockCornerArc(
      ctx,
      x + ROCK_OUTER_CORNER_RADIUS,
      bottom - ROCK_OUTER_CORNER_RADIUS,
      ROCK_OUTER_CORNER_RADIUS,
      -1,
      1,
      camera
    );
  }
}

function drawAsteroidVisibilityCheckerRockCornerArc(ctx, centerX, centerY, radius, signX, signY, camera) {
  for (let step = 0; step <= radius; step += 1) {
    const other = Math.round(Math.sqrt(Math.max(0, radius * radius - step * step)));
    drawAsteroidVisibilityCheckerArcPixel(ctx, centerX + signX * step, centerY + signY * other, camera);
    drawAsteroidVisibilityCheckerArcPixel(ctx, centerX + signX * other, centerY + signY * step, camera);
  }
}

function drawAsteroidVisibilityCheckerArcPixel(ctx, x, y, camera) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (asteroidVisibilityCheckerPixelOn(px, py, camera)) {
    ctx.fillRect(px, py, 1, 1);
  }
}

function drawAsteroidVisibilityGhostInnerRockCornerConnectors(
  ctx,
  asteroid,
  camera,
  tileSize,
  minTileX,
  maxTileX,
  minTileY,
  maxTileY,
  colors
) {
  for (let tileY = minTileY - 1; tileY <= maxTileY + 1; tileY += 1) {
    for (let tileX = minTileX - 1; tileX <= maxTileX + 1; tileX += 1) {
      if (isRockTileAt(asteroid, tileX, tileY)) {
        continue;
      }

      const x = Math.round(tileX * tileSize - camera.x);
      const y = Math.round(tileY * tileSize - camera.y);
      const topEdge = y - 1;
      const leftEdge = x - 1;
      const rightEdge = x + tileSize;
      const bottomEdge = y + tileSize;
      const rightInside = rightEdge - 1;
      const bottomInside = bottomEdge - 1;
      const north = isRockTileAt(asteroid, tileX, tileY - 1);
      const east = isRockTileAt(asteroid, tileX + 1, tileY);
      const south = isRockTileAt(asteroid, tileX, tileY + 1);
      const west = isRockTileAt(asteroid, tileX - 1, tileY);
      const northWest = isRockTileAt(asteroid, tileX - 1, tileY - 1);
      const northEast = isRockTileAt(asteroid, tileX + 1, tileY - 1);
      const southEast = isRockTileAt(asteroid, tileX + 1, tileY + 1);
      const southWest = isRockTileAt(asteroid, tileX - 1, tileY + 1);

      if (north && west && northWest) {
        drawAsteroidVisibilityCheckerLine(ctx, x + ROCK_INNER_CORNER_RADIUS, topEdge, leftEdge, y + ROCK_INNER_CORNER_RADIUS, camera, colors);
      }

      if (north && east && northEast) {
        drawAsteroidVisibilityCheckerLine(ctx, rightInside - ROCK_INNER_CORNER_RADIUS, topEdge, rightEdge, y + ROCK_INNER_CORNER_RADIUS, camera, colors);
      }

      if (south && east && southEast) {
        drawAsteroidVisibilityCheckerLine(
          ctx,
          rightEdge,
          bottomInside - ROCK_INNER_CORNER_RADIUS,
          rightInside - ROCK_INNER_CORNER_RADIUS,
          bottomEdge,
          camera,
          colors
        );
      }

      if (south && west && southWest) {
        drawAsteroidVisibilityCheckerLine(ctx, x + ROCK_INNER_CORNER_RADIUS, bottomEdge, leftEdge, bottomInside - ROCK_INNER_CORNER_RADIUS, camera, colors);
      }
    }
  }
}

function drawAsteroidVisibilityCheckerLine(ctx, x0, y0, x1, y1, camera, colors) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  ctx.fillStyle = colors.background;
  while (true) {
    if (asteroidVisibilityCheckerPixelOn(x, y, camera)) {
      ctx.fillRect(x, y, 1, 1);
    }
    if (x === x1 && y === y1) {
      break;
    }

    const nextError = error * 2;
    if (nextError >= dy) {
      error += dy;
      x += sx;
    }

    if (nextError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function buildAsteroidVisibilitySegments(asteroid, camera, player, radius, bounds) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const segments = [];
  const radiusSq = radius * radius;

  for (let tileY = bounds.minTileY; tileY <= bounds.maxTileY; tileY += 1) {
    for (let tileX = bounds.minTileX; tileX <= bounds.maxTileX; tileX += 1) {
      const blockerKind = asteroidVisibilityBlockerKind(asteroid, tileX, tileY);
      if (!blockerKind) {
        continue;
      }

      const left = tileX * tileSize;
      const top = tileY * tileSize;
      if (!tileRectTouchesCircleWorld(left, top, tileSize, player.x, player.y, radiusSq)) {
        continue;
      }

      if (blockerKind === "rock") {
        addAsteroidVisibilityRockSegments(segments, asteroid, tileX, tileY, left, top, tileSize, camera);
      } else {
        addAsteroidVisibilitySquareSegments(segments, asteroid, tileX, tileY, left, top, tileSize, camera);
      }
    }
  }

  addAsteroidVisibilityInnerCornerSegments(segments, asteroid, player, radiusSq, bounds, tileSize, camera);

  return segments;
}

function asteroidVisibilityBlockerKind(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return null;
  }

  const tile = asteroid.tiles[tileY * asteroid.widthTiles + tileX];
  if (isRockTile(tile)) {
    return "rock";
  }

  return isWallTile(tile) ? "square" : null;
}

function addAsteroidVisibilitySquareSegments(segments, asteroid, tileX, tileY, left, top, size, camera) {
  const right = left + size;
  const bottom = top + size;
  if (!asteroidVisibilityBlocksSightTile(asteroid, tileX, tileY - 1)) {
    addAsteroidVisibilitySegment(segments, left, top, right, top, camera);
  }
  if (!asteroidVisibilityBlocksSightTile(asteroid, tileX + 1, tileY)) {
    addAsteroidVisibilitySegment(segments, right, top, right, bottom, camera);
  }
  if (!asteroidVisibilityBlocksSightTile(asteroid, tileX, tileY + 1)) {
    addAsteroidVisibilitySegment(segments, right, bottom, left, bottom, camera);
  }
  if (!asteroidVisibilityBlocksSightTile(asteroid, tileX - 1, tileY)) {
    addAsteroidVisibilitySegment(segments, left, bottom, left, top, camera);
  }
}

function addAsteroidVisibilityRockSegments(segments, asteroid, tileX, tileY, left, top, size, camera) {
  const north = asteroidVisibilityBlocksSightTile(asteroid, tileX, tileY - 1);
  const east = asteroidVisibilityBlocksSightTile(asteroid, tileX + 1, tileY);
  const south = asteroidVisibilityBlocksSightTile(asteroid, tileX, tileY + 1);
  const west = asteroidVisibilityBlocksSightTile(asteroid, tileX - 1, tileY);
  const northWest = asteroidVisibilityBlocksSightTile(asteroid, tileX - 1, tileY - 1);
  const northEast = asteroidVisibilityBlocksSightTile(asteroid, tileX + 1, tileY - 1);
  const southEast = asteroidVisibilityBlocksSightTile(asteroid, tileX + 1, tileY + 1);
  const southWest = asteroidVisibilityBlocksSightTile(asteroid, tileX - 1, tileY + 1);
  const right = left + size - 1;
  const bottom = top + size - 1;
  const topOpen = !north;
  const rightOpen = !east;
  const bottomOpen = !south;
  const leftOpen = !west;
  const outerTopLeft = topOpen && leftOpen;
  const outerTopRight = topOpen && rightOpen;
  const outerBottomRight = bottomOpen && rightOpen;
  const outerBottomLeft = bottomOpen && leftOpen;
  const outerBevel = ASTEROID_VISIBILITY_OUTER_BEVEL_RADIUS;
  const topTrimLeft = outerTopLeft
    ? outerBevel
    : topOpen && west && northWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const topTrimRight = outerTopRight
    ? outerBevel
    : topOpen && east && northEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const rightTrimTop = outerTopRight
    ? outerBevel
    : rightOpen && north && northEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const rightTrimBottom = outerBottomRight
    ? outerBevel
    : rightOpen && south && southEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const bottomTrimRight = outerBottomRight
    ? outerBevel
    : bottomOpen && east && southEast ? ROCK_INNER_CORNER_RADIUS : 0;
  const bottomTrimLeft = outerBottomLeft
    ? outerBevel
    : bottomOpen && west && southWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const leftTrimBottom = outerBottomLeft
    ? outerBevel
    : leftOpen && south && southWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const leftTrimTop = outerTopLeft
    ? outerBevel
    : leftOpen && north && northWest ? ROCK_INNER_CORNER_RADIUS : 0;

  if (topOpen && left + topTrimLeft <= right - topTrimRight) {
    addAsteroidVisibilityRockEdgeSegment(segments, left + topTrimLeft, top, right - topTrimRight, top, camera);
  }
  if (rightOpen && top + rightTrimTop <= bottom - rightTrimBottom) {
    addAsteroidVisibilityRockEdgeSegment(segments, right, top + rightTrimTop, right, bottom - rightTrimBottom, camera);
  }
  if (bottomOpen && left + bottomTrimLeft <= right - bottomTrimRight) {
    addAsteroidVisibilityRockEdgeSegment(segments, right - bottomTrimRight, bottom, left + bottomTrimLeft, bottom, camera);
  }
  if (leftOpen && top + leftTrimTop <= bottom - leftTrimBottom) {
    addAsteroidVisibilityRockEdgeSegment(segments, left, bottom - leftTrimBottom, left, top + leftTrimTop, camera);
  }

  if (outerTopLeft) {
    addAsteroidVisibilityRockBevelSegment(
      segments,
      left + outerBevel,
      top,
      left,
      top + outerBevel,
      camera
    );
  }
  if (outerTopRight) {
    addAsteroidVisibilityRockBevelSegment(
      segments,
      right,
      top + outerBevel,
      right - outerBevel,
      top,
      camera
    );
  }
  if (outerBottomRight) {
    addAsteroidVisibilityRockBevelSegment(
      segments,
      right - outerBevel,
      bottom,
      right,
      bottom - outerBevel,
      camera
    );
  }
  if (outerBottomLeft) {
    addAsteroidVisibilityRockBevelSegment(
      segments,
      left + outerBevel,
      bottom,
      left,
      bottom - outerBevel,
      camera
    );
  }
}

function addAsteroidVisibilityRockEdgeSegment(segments, x0, y0, x1, y1, camera) {
  const overlap = ASTEROID_VISIBILITY_DILATE_PIXELS;
  if (y0 === y1) {
    const direction = x1 >= x0 ? 1 : -1;
    addAsteroidVisibilitySegment(segments, x0 - direction * overlap, y0, x1 + direction * overlap, y1, camera);
    return;
  }

  if (x0 === x1) {
    const direction = y1 >= y0 ? 1 : -1;
    addAsteroidVisibilitySegment(segments, x0, y0 - direction * overlap, x1, y1 + direction * overlap, camera);
    return;
  }

  addAsteroidVisibilitySegment(segments, x0, y0, x1, y1, camera);
}

function addAsteroidVisibilityRockBevelSegment(segments, x0, y0, x1, y1, camera) {
  addAsteroidVisibilitySegment(segments, x0, y0, x1, y1, camera);
}

function addAsteroidVisibilityInnerCornerSegments(segments, asteroid, player, radiusSq, bounds, tileSize, camera) {
  for (let tileY = bounds.minTileY - 1; tileY <= bounds.maxTileY + 1; tileY += 1) {
    for (let tileX = bounds.minTileX - 1; tileX <= bounds.maxTileX + 1; tileX += 1) {
      if (asteroidVisibilityBlockerKind(asteroid, tileX, tileY)) {
        continue;
      }

      const left = tileX * tileSize;
      const top = tileY * tileSize;
      if (!tileRectTouchesCircleWorld(left, top, tileSize, player.x, player.y, radiusSq)) {
        continue;
      }

      const rightEdge = left + tileSize;
      const bottomEdge = top + tileSize;
      const topEdge = top - 1;
      const leftEdge = left - 1;
      const rightInside = rightEdge - 1;
      const bottomInside = bottomEdge - 1;
      const north = isRockTileAt(asteroid, tileX, tileY - 1);
      const east = isRockTileAt(asteroid, tileX + 1, tileY);
      const south = isRockTileAt(asteroid, tileX, tileY + 1);
      const west = isRockTileAt(asteroid, tileX - 1, tileY);
      const northWest = isRockTileAt(asteroid, tileX - 1, tileY - 1);
      const northEast = isRockTileAt(asteroid, tileX + 1, tileY - 1);
      const southEast = isRockTileAt(asteroid, tileX + 1, tileY + 1);
      const southWest = isRockTileAt(asteroid, tileX - 1, tileY + 1);

      if (north && west && northWest) {
        addAsteroidVisibilitySegment(
          segments,
          left + ROCK_INNER_CORNER_RADIUS,
          topEdge,
          leftEdge,
          top + ROCK_INNER_CORNER_RADIUS,
          camera
        );
      }

      if (north && east && northEast) {
        addAsteroidVisibilitySegment(
          segments,
          rightInside - ROCK_INNER_CORNER_RADIUS,
          topEdge,
          rightEdge,
          top + ROCK_INNER_CORNER_RADIUS,
          camera
        );
      }

      if (south && east && southEast) {
        addAsteroidVisibilitySegment(
          segments,
          rightEdge,
          bottomInside - ROCK_INNER_CORNER_RADIUS,
          rightInside - ROCK_INNER_CORNER_RADIUS,
          bottomEdge,
          camera
        );
      }

      if (south && west && southWest) {
        addAsteroidVisibilitySegment(
          segments,
          left + ROCK_INNER_CORNER_RADIUS,
          bottomEdge,
          leftEdge,
          bottomInside - ROCK_INNER_CORNER_RADIUS,
          camera
        );
      }
    }
  }
}

function addAsteroidVisibilitySegment(segments, x0, y0, x1, y1, camera) {
  if (x0 === x1 && y0 === y1) {
    return;
  }

  segments.push({
    x0: x0 - camera.x,
    y0: y0 - camera.y,
    x1: x1 - camera.x,
    y1: y1 - camera.y
  });
}

function asteroidVisibilityBlocksSightTile(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  if (!isPlayableTile(asteroid, tileX, tileY)) {
    return false;
  }

  return isSolidTile(asteroid.tiles[index]);
}

function tileRectTouchesCircleWorld(left, top, size, centerX, centerY, radiusSq) {
  const closestX = clamp(centerX, left, left + size);
  const closestY = clamp(centerY, top, top + size);
  const dx = centerX - closestX;
  const dy = centerY - closestY;
  return dx * dx + dy * dy <= radiusSq;
}

function buildAsteroidVisibilityPolygon(origin, radius, segments) {
  const sweepSegments = buildAsteroidVisibilitySweepSegments(origin, segments);
  const eventGroups = buildAsteroidVisibilityEventGroups(sweepSegments);
  const samples = buildAsteroidVisibilitySweepSamples(eventGroups);
  const activeSegments = new Set();
  const distanceHeap = [];
  for (const segment of sweepSegments) {
    if (segment.wraps) {
      activeSegments.add(segment);
    }
  }

  const points = [];
  let eventIndex = 0;
  for (const angle of samples) {
    while (
      eventIndex < eventGroups.length &&
      eventGroups[eventIndex].angle < angle - 0.000001
    ) {
      applyAsteroidVisibilityEventGroup(activeSegments, eventGroups[eventIndex]);
      eventIndex += 1;
    }

    const eventGroup = eventIndex < eventGroups.length &&
      Math.abs(eventGroups[eventIndex].angle - angle) <= 0.000001
      ? eventGroups[eventIndex]
      : null;
    points.push(nearestAsteroidVisibilityPoint(origin, radius, activeSegments, angle, eventGroup, distanceHeap));
  }

  return points;
}

function buildAsteroidVisibilitySweepSegments(origin, segments) {
  const sweepSegments = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const angle0 = normalizeVisibilityAngle(Math.atan2(segment.y0 - origin.y, segment.x0 - origin.x));
    const angle1 = normalizeVisibilityAngle(Math.atan2(segment.y1 - origin.y, segment.x1 - origin.x));
    let startAngle = angle0;
    let span = normalizeVisibilityAngle(angle1 - angle0);
    if (span < 0.000001) {
      continue;
    }

    if (span > Math.PI) {
      startAngle = angle1;
      span = ASTEROID_VISIBILITY_FULL_CIRCLE - span;
    }

    const endAngle = normalizeVisibilityAngle(startAngle + span);
    sweepSegments.push({
      ...segment,
      id: index,
      startAngle,
      endAngle,
      wraps: endAngle < startAngle
    });
  }

  return sweepSegments;
}

function buildAsteroidVisibilityEventGroups(sweepSegments) {
  const events = [];
  for (const segment of sweepSegments) {
    events.push({ angle: segment.startAngle, segment, entering: true });
    events.push({ angle: segment.endAngle, segment, entering: false });
  }

  events.sort((a, b) => a.angle - b.angle);
  const groups = [];
  for (const event of events) {
    const previous = groups[groups.length - 1];
    if (previous && Math.abs(previous.angle - event.angle) <= 0.000001) {
      previous.events.push(event);
    } else {
      groups.push({ angle: event.angle, events: [event] });
    }
  }

  return groups;
}

function buildAsteroidVisibilitySweepSamples(eventGroups) {
  const angles = [];
  for (let index = 0; index < ASTEROID_VISIBILITY_BASE_RAYS; index += 1) {
    angles.push((ASTEROID_VISIBILITY_FULL_CIRCLE * index) / ASTEROID_VISIBILITY_BASE_RAYS);
  }

  for (const group of eventGroups) {
    pushAsteroidVisibilityEventAngles(angles, group.angle);
  }

  angles.sort((a, b) => a - b);
  const uniqueAngles = [];
  for (const angle of angles) {
    const previous = uniqueAngles[uniqueAngles.length - 1];
    if (previous !== undefined && Math.abs(angle - previous) < 0.000001) {
      continue;
    }

    uniqueAngles.push(angle);
  }

  return uniqueAngles;
}

function pushAsteroidVisibilityEventAngles(angles, angle) {
  angles.push(normalizeVisibilityAngle(angle - ASTEROID_VISIBILITY_ANGLE_EPSILON));
  angles.push(normalizeVisibilityAngle(angle));
  angles.push(normalizeVisibilityAngle(angle + ASTEROID_VISIBILITY_ANGLE_EPSILON));
}

function normalizeVisibilityAngle(angle) {
  let normalized = angle % ASTEROID_VISIBILITY_FULL_CIRCLE;
  if (normalized < 0) {
    normalized += ASTEROID_VISIBILITY_FULL_CIRCLE;
  }
  return normalized;
}

function applyAsteroidVisibilityEventGroup(activeSegments, group) {
  for (const event of group.events) {
    if (event.entering) {
      activeSegments.add(event.segment);
    } else {
      activeSegments.delete(event.segment);
    }
  }
}

function nearestAsteroidVisibilityPoint(origin, radius, activeSegments, angle, eventGroup = null, distanceHeap = []) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  distanceHeap.length = 0;

  for (const segment of activeSegments) {
    pushAsteroidVisibilityHeapHit(distanceHeap, origin, dirX, dirY, segment);
  }

  if (eventGroup) {
    for (const event of eventGroup.events) {
      pushAsteroidVisibilityHeapHit(distanceHeap, origin, dirX, dirY, event.segment);
    }
  }

  const nearest = clamp(distanceHeap[0] ?? radius, 0, radius);
  return {
    x: origin.x + dirX * nearest,
    y: origin.y + dirY * nearest,
    angle
  };
}

function pushAsteroidVisibilityHeapHit(heap, origin, dirX, dirY, segment) {
  const distance = raySegmentIntersectionDistance(origin.x, origin.y, dirX, dirY, segment);
  if (distance === null) {
    return;
  }

  asteroidVisibilityHeapPush(heap, distance);
}

function asteroidVisibilityHeapPush(heap, distance) {
  heap.push(distance);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex] <= distance) {
      break;
    }

    heap[index] = heap[parentIndex];
    heap[parentIndex] = distance;
    index = parentIndex;
  }
}

function raySegmentIntersectionDistance(originX, originY, dirX, dirY, segment) {
  const segX = segment.x1 - segment.x0;
  const segY = segment.y1 - segment.y0;
  const denom = dirX * segY - dirY * segX;
  if (Math.abs(denom) < 0.000001) {
    return null;
  }

  const dx = segment.x0 - originX;
  const dy = segment.y0 - originY;
  const t = (dx * segY - dy * segX) / denom;
  const u = (dx * dirY - dy * dirX) / denom;
  if (t < 0 || u < -0.000001 || u > 1.000001) {
    return null;
  }

  return t;
}

function rasterizeAsteroidVisibilityPolygon(points) {
  if (points.length < 3) {
    return { offsetY: 0, rows: [] };
  }

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const offsetY = Math.floor(minY) - 1;
  const endY = Math.ceil(maxY) + 1;
  const rows = Array.from({ length: Math.max(0, endY - offsetY + 1) }, () => null);

  for (let y = offsetY; y <= endY; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        const t = (scanY - a.y) / (b.y - a.y);
        intersections.push(a.x + (b.x - a.x) * t);
      }
    }

    if (intersections.length < 2) {
      continue;
    }

    intersections.sort((a, b) => a - b);
    const spans = [];
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.ceil(intersections[index] - 0.5);
      const end = Math.floor(intersections[index + 1] - 0.5) + 1;
      if (end > start) {
        spans.push(start, end);
      }
    }
    rows[y - offsetY] = spans.length > 0 ? spans : null;
  }

  return dilateAsteroidVisibilitySpans(
    { offsetY, rows },
    ASTEROID_VISIBILITY_DILATE_PIXELS
  );
}

function dilateAsteroidVisibilitySpans(spans, pixels) {
  if (pixels <= 0 || spans.rows.length === 0) {
    return spans;
  }

  const offsetY = spans.offsetY - pixels;
  const rows = Array.from({ length: spans.rows.length + pixels * 2 }, () => null);
  for (let sourceIndex = 0; sourceIndex < spans.rows.length; sourceIndex += 1) {
    const sourceSpans = spans.rows[sourceIndex];
    if (!sourceSpans) {
      continue;
    }

    for (let dy = -pixels; dy <= pixels; dy += 1) {
      const targetIndex = sourceIndex + pixels + dy;
      if (targetIndex < 0 || targetIndex >= rows.length) {
        continue;
      }

      rows[targetIndex] = mergeAsteroidVisibilitySpans(
        rows[targetIndex],
        sourceSpans,
        pixels
      );
    }
  }

  return { offsetY, rows };
}

function mergeAsteroidVisibilitySpans(existing, added, padding) {
  const merged = existing ? [...existing] : [];
  for (let index = 0; index < added.length; index += 2) {
    merged.push(added[index] - padding, added[index + 1] + padding);
  }

  if (merged.length <= 2) {
    return merged;
  }

  const pairs = [];
  for (let index = 0; index < merged.length; index += 2) {
    pairs.push({ start: merged[index], end: merged[index + 1] });
  }
  pairs.sort((a, b) => a.start - b.start);

  const result = [];
  for (const pair of pairs) {
    if (result.length === 0 || pair.start > result[result.length - 1]) {
      result.push(pair.start, pair.end);
    } else {
      result[result.length - 1] = Math.max(result[result.length - 1], pair.end);
    }
  }

  return result;
}

function asteroidVisibilityTileCurrentlyVisible(visibility, tileX, tileY) {
  if (!visibility || tileX < 0 || tileY < 0 || tileX >= visibility.width || tileY >= visibility.height) {
    return false;
  }

  const tileSize = visibility.tileSize;
  const left = tileX * tileSize - visibility.cameraX;
  const top = tileY * tileSize - visibility.cameraY;
  const right = left + tileSize;
  const bottom = top + tileSize;
  return asteroidVisibilityRectTouchesCurrent(visibility, left, top, right, bottom);
}

function asteroidVisibilityRectTouchesCurrent(visibility, left, top, right, bottom) {
  const startRow = Math.floor(top) - visibility.spans.offsetY;
  const endRow = Math.ceil(bottom) - visibility.spans.offsetY;
  const startX = Math.floor(left);
  const endX = Math.ceil(right);
  for (let rowIndex = startRow; rowIndex < endRow; rowIndex += 1) {
    const spans = visibility.spans.rows[rowIndex];
    if (!spans) {
      continue;
    }

    for (let index = 0; index < spans.length; index += 2) {
      if (spans[index] < endX && spans[index + 1] > startX) {
        return true;
      }
    }
  }

  return false;
}

function asteroidVisibilityScreenPointVisible(visibility, screenX, screenY) {
  const rowIndex = Math.floor(screenY) - visibility.spans.offsetY;
  const spans = visibility.spans.rows[rowIndex];
  if (!spans) {
    return false;
  }

  const x = Math.floor(screenX);
  for (let index = 0; index < spans.length; index += 2) {
    if (x >= spans[index] && x < spans[index + 1]) {
      return true;
    }
  }
  return false;
}

function asteroidVisibilityPaintsBackground(visibility, tileX, tileY) {
  if (!visibility || tileX < 0 || tileY < 0 || tileX >= visibility.width || tileY >= visibility.height) {
    return false;
  }

  return asteroidVisibilityTileCurrentlyVisible(visibility, tileX, tileY);
}

function asteroidVisibilityRendersShell(visibility, tileX, tileY) {
  return asteroidVisibilityTileCurrentlyVisible(visibility, tileX, tileY);
}

function asteroidVisibilityCornerMaskAt() {
  return ASTEROID_VISIBILITY_ALL_CORNERS;
}

function asteroidVisibilityCornerMaskIncludes(mask, corner) {
  return (mask & corner) !== 0;
}

function asteroidVisibilityPointPaintsBackground(visibility, worldX, worldY) {
  if (!visibility) {
    return true;
  }

  return asteroidVisibilityScreenPointVisible(
    visibility,
    worldX - visibility.cameraX,
    worldY - visibility.cameraY
  );
}

function createAsteroidVisibilityWorldMask(visibility) {
  return {
    spans: visibility.spans,
    allows(screenX, screenY) {
      return asteroidVisibilityScreenPointVisible(visibility, screenX, screenY);
    }
  };
}

function playerTouchesAsteroidVisibility(visibility, player) {
  if (!visibility || !player) {
    return false;
  }

  if (visibility.playerId && player.id === visibility.playerId) {
    return true;
  }

  const radius = Math.max(1, Number(player.radius || ENGINE.ship.radius || 1));
  const screenX = player.x - visibility.cameraX;
  const screenY = player.y - visibility.cameraY;
  return asteroidVisibilityScreenPointVisible(visibility, screenX, screenY) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX - radius, screenY) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX + radius, screenY) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX, screenY - radius) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX, screenY + radius) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX - radius * 0.7, screenY - radius * 0.7) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX + radius * 0.7, screenY - radius * 0.7) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX + radius * 0.7, screenY + radius * 0.7) ||
    asteroidVisibilityScreenPointVisible(visibility, screenX - radius * 0.7, screenY + radius * 0.7);
}

function drawBuildPreview(ctx, asteroid, player, players, camera, build, colors) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const radiusPixels = ENGINE.build.radiusTiles * tileSize;
  const minTileX = Math.max(0, Math.floor((player.x - radiusPixels) / tileSize) - 1);
  const maxTileX = Math.min(
    asteroid.widthTiles - 1,
    Math.ceil((player.x + radiusPixels) / tileSize) + 1
  );
  const minTileY = Math.max(0, Math.floor((player.y - radiusPixels) / tileSize) - 1);
  const maxTileY = Math.min(
    asteroid.heightTiles - 1,
    Math.ceil((player.y + radiusPixels) / tileSize) + 1
  );

  ctx.fillStyle = colors.foreground;
  drawBuildAreaOutline(ctx, asteroid, player, players, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY);

  const target = build?.target;
  if (!target?.valid) {
    return;
  }

  const screenX = Math.round(target.tileX * tileSize - camera.x);
  const screenY = Math.round(target.tileY * tileSize - camera.y);
  drawBuildTargetSquare(ctx, screenX, screenY, tileSize);
}

function isBuildPreviewTile(asteroid, player, players, tileX, tileY, tileSize) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  if (
    !isPlayableTile(asteroid, tileX, tileY) ||
    asteroid.tiles[index] !== ASTEROID_TILE.empty ||
    Number(asteroid.storm?.[index] || STORM_STATE.safe) !== STORM_STATE.safe
  ) {
    return false;
  }

  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  return Math.hypot(centerX - player.x, centerY - player.y) <= ENGINE.build.radiusTiles * tileSize &&
    !tileOverlapsPlayers(players, tileX, tileY, tileSize);
}

function drawBuildAreaOutline(ctx, asteroid, player, players, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY) {
  const validTiles = new Set();
  const tiles = buildClosestTileRing({
    widthTiles: asteroid.widthTiles,
    heightTiles: asteroid.heightTiles,
    tileSize,
    startX: player.x,
    startY: player.y,
    originRadius: player.radius || ENGINE.ship.radius || 0,
    maxDistance: ENGINE.build.radiusTiles * tileSize,
    isCandidate(tileX, tileY) {
      return tileX >= minTileX &&
        tileX <= maxTileX &&
        tileY >= minTileY &&
        tileY <= maxTileY &&
        isBuildPreviewTile(asteroid, player, players, tileX, tileY, tileSize);
    },
    isNormallyVisible(tileX, tileY) {
      return isBuildPreviewTileNormallyVisible(asteroid, player, tileX, tileY, tileSize);
    },
    isCornerVisible(tileX, tileY) {
      return isBuildPreviewTileCornerVisible(asteroid, player, tileX, tileY, tileSize);
    }
  });

  for (const tile of tiles) {
    validTiles.add(tileKey(tile.tileX, tile.tileY));
  }

  const filledPixels = buildInsetPixelMask(validTiles, tileSize);
  const edges = buildPixelBoundaryEdges(filledPixels);
  const outgoingEdges = new Map();

  for (const edge of edges) {
    const key = vertexKey(edge.x0, edge.y0);
    if (!outgoingEdges.has(key)) {
      outgoingEdges.set(key, []);
    }
    outgoingEdges.get(key).push(edge);
  }

  for (const edge of edges) {
    if (!edge.used) {
      drawBuildPixelContour(ctx, edges, outgoingEdges, edge, camera);
    }
  }
}

function isBuildPreviewTileNormallyVisible(asteroid, player, tileX, tileY, tileSize) {
  return buildTileVisibleFromOrigin({
    tileX,
    tileY,
    tileSize,
    startX: player.x,
    startY: player.y,
    raycast(angle, distance) {
      return raycastAsteroid(asteroid, player.x, player.y, angle, distance);
    }
  });
}

function isBuildPreviewTileCornerVisible(asteroid, player, tileX, tileY, tileSize) {
  return buildTileVisibleFromOrigin({
    tileX,
    tileY,
    tileSize,
    startX: player.x,
    startY: player.y,
    includeCorners: true,
    raycast(angle, distance) {
      return raycastAsteroid(asteroid, player.x, player.y, angle, distance);
    }
  });
}

function buildInsetPixelMask(validTiles, tileSize) {
  const filledPixels = new Set();

  for (const key of validTiles) {
    const [tileX, tileY] = key.split(",").map(Number);
    const west = validTiles.has(tileKey(tileX - 1, tileY));
    const east = validTiles.has(tileKey(tileX + 1, tileY));
    const north = validTiles.has(tileKey(tileX, tileY - 1));
    const south = validTiles.has(tileKey(tileX, tileY + 1));
    const left = tileX * tileSize + (west ? 0 : BUILD_PREVIEW_GAP);
    const right = tileX * tileSize + tileSize - 1 - (east ? 0 : BUILD_PREVIEW_GAP);
    const top = tileY * tileSize + (north ? 0 : BUILD_PREVIEW_GAP);
    const bottom = tileY * tileSize + tileSize - 1 - (south ? 0 : BUILD_PREVIEW_GAP);

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        filledPixels.add(pixelKey(x, y));
      }
    }
  }

  return filledPixels;
}

function buildPixelBoundaryEdges(filledPixels) {
  const edges = [];

  for (const key of filledPixels) {
    const [x, y] = key.split(",").map(Number);

    if (!filledPixels.has(pixelKey(x, y - 1))) {
      edges.push(buildPixelEdge(x, y, x + 1, y, 0, x, y));
    }

    if (!filledPixels.has(pixelKey(x + 1, y))) {
      edges.push(buildPixelEdge(x + 1, y, x + 1, y + 1, 1, x, y));
    }

    if (!filledPixels.has(pixelKey(x, y + 1))) {
      edges.push(buildPixelEdge(x + 1, y + 1, x, y + 1, 2, x, y));
    }

    if (!filledPixels.has(pixelKey(x - 1, y))) {
      edges.push(buildPixelEdge(x, y + 1, x, y, 3, x, y));
    }
  }

  return edges;
}

function buildPixelEdge(x0, y0, x1, y1, direction, pixelX, pixelY) {
  return {
    x0,
    y0,
    x1,
    y1,
    direction,
    pixelX,
    pixelY,
    used: false
  };
}

function drawBuildPixelContour(ctx, edges, outgoingEdges, startEdge, camera) {
  const startKey = vertexKey(startEdge.x0, startEdge.y0);
  let edge = startEdge;
  const contour = [];
  let guard = edges.length + 1;
  let closed = false;

  while (edge && !edge.used && guard > 0) {
    edge.used = true;
    contour.push(edge);
    guard -= 1;

    const endKey = vertexKey(edge.x1, edge.y1);
    if (endKey === startKey) {
      closed = true;
      break;
    }

    edge = nextBuildContourEdge(edge, outgoingEdges.get(endKey) || []);
  }

  const perimeter = contour.length;
  const dashOffset = perimeter > 0
    ? positiveModulo(Math.floor((BUILD_DASH_PERIOD - (perimeter % BUILD_DASH_PERIOD)) / 2), BUILD_DASH_PERIOD)
    : 0;

  for (let index = 0; index < contour.length; index += 1) {
    if (positiveModulo(index + dashOffset, BUILD_DASH_PERIOD) < BUILD_DASH_ON) {
      drawBuildBoundaryPixel(ctx, contour[index], camera);
    }
  }
}

function nextBuildContourEdge(currentEdge, candidates) {
  const unused = candidates.filter((edge) => !edge.used);
  if (unused.length === 0) {
    return null;
  }

  const directionOrder = [
    (currentEdge.direction + 1) % 4,
    currentEdge.direction,
    (currentEdge.direction + 3) % 4,
    (currentEdge.direction + 2) % 4
  ];

  for (const direction of directionOrder) {
    const next = unused.find((edge) => edge.direction === direction);
    if (next) {
      return next;
    }
  }

  return unused[0];
}

function drawBuildBoundaryPixel(ctx, edge, camera) {
  ctx.fillRect(
    Math.round(edge.pixelX - camera.x),
    Math.round(edge.pixelY - camera.y),
    1,
    1
  );
}

function tileOverlapsPlayers(players, tileX, tileY, tileSize) {
  const tile = {
    x: tileX * tileSize,
    y: tileY * tileSize,
    size: tileSize
  };

  return players.some((player) => player.alive && circleOverlapsTile(player, tile));
}

function circleOverlapsTile(circle, tile) {
  const tileRight = tile.x + tile.size;
  const tileBottom = tile.y + tile.size;
  const closestX = clamp(circle.x, tile.x, tileRight);
  const closestY = clamp(circle.y, tile.y, tileBottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;

  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function tileKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}

function pixelKey(x, y) {
  return `${x},${y}`;
}

function vertexKey(x, y) {
  return `${x},${y}`;
}

function drawBuildTargetSquare(ctx, x, y, size) {
  const inset = Math.max(4, Math.floor(size * 0.25));
  const left = x + inset;
  const top = y + inset;
  const right = x + size - 1 - inset;
  const bottom = y + size - 1 - inset;

  drawPixelLine(ctx, left, top, right, top);
  drawPixelLine(ctx, right, top, right, bottom);
  drawPixelLine(ctx, right, bottom, left, bottom);
  drawPixelLine(ctx, left, bottom, left, top);
}

function drawRockFill(ctx, x, y, size, colors) {
  ctx.fillStyle = colors.background;
  ctx.fillRect(x, y, size, size);
}

function drawRockOutline(ctx, asteroid, tileX, tileY, x, y, size, colors, visibility = null) {
  const north = rockTileBlocksVisibleOutline(asteroid, visibility, tileX, tileY - 1);
  const east = rockTileBlocksVisibleOutline(asteroid, visibility, tileX + 1, tileY);
  const south = rockTileBlocksVisibleOutline(asteroid, visibility, tileX, tileY + 1);
  const west = rockTileBlocksVisibleOutline(asteroid, visibility, tileX - 1, tileY);
  const northWest = rockTileBlocksVisibleOutline(asteroid, visibility, tileX - 1, tileY - 1);
  const northEast = rockTileBlocksVisibleOutline(asteroid, visibility, tileX + 1, tileY - 1);
  const southEast = rockTileBlocksVisibleOutline(asteroid, visibility, tileX + 1, tileY + 1);
  const southWest = rockTileBlocksVisibleOutline(asteroid, visibility, tileX - 1, tileY + 1);
  const right = x + size - 1;
  const bottom = y + size - 1;
  const topOpen = !north;
  const rightOpen = !east;
  const bottomOpen = !south;
  const leftOpen = !west;
  const outerTopLeft = topOpen && leftOpen;
  const outerTopRight = topOpen && rightOpen;
  const outerBottomRight = bottomOpen && rightOpen;
  const outerBottomLeft = bottomOpen && leftOpen;
  let topTrimLeft = outerTopLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : topOpen && west && northWest ? ROCK_INNER_CORNER_RADIUS : 0;
  let topTrimRight = outerTopRight
    ? ROCK_OUTER_CORNER_RADIUS
    : topOpen && east && northEast ? ROCK_INNER_CORNER_RADIUS : 0;
  let rightTrimTop = outerTopRight
    ? ROCK_OUTER_CORNER_RADIUS
    : rightOpen && north && northEast ? ROCK_INNER_CORNER_RADIUS : 0;
  let rightTrimBottom = outerBottomRight
    ? ROCK_OUTER_CORNER_RADIUS
    : rightOpen && south && southEast ? ROCK_INNER_CORNER_RADIUS : 0;
  let bottomTrimRight = outerBottomRight
    ? ROCK_OUTER_CORNER_RADIUS
    : bottomOpen && east && southEast ? ROCK_INNER_CORNER_RADIUS : 0;
  let bottomTrimLeft = outerBottomLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : bottomOpen && west && southWest ? ROCK_INNER_CORNER_RADIUS : 0;
  let leftTrimBottom = outerBottomLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : leftOpen && south && southWest ? ROCK_INNER_CORNER_RADIUS : 0;
  let leftTrimTop = outerTopLeft
    ? ROCK_OUTER_CORNER_RADIUS
    : leftOpen && north && northWest ? ROCK_INNER_CORNER_RADIUS : 0;
  const cornerMask = visibility
    ? asteroidVisibilityCornerMaskAt(visibility, tileX, tileY)
    : ASTEROID_VISIBILITY_ALL_CORNERS;
  const cornerTopLeft = asteroidVisibilityCornerMaskIncludes(cornerMask, ASTEROID_VISIBILITY_CORNER.topLeft);
  const cornerTopRight = asteroidVisibilityCornerMaskIncludes(cornerMask, ASTEROID_VISIBILITY_CORNER.topRight);
  const cornerBottomRight = asteroidVisibilityCornerMaskIncludes(cornerMask, ASTEROID_VISIBILITY_CORNER.bottomRight);
  const cornerBottomLeft = asteroidVisibilityCornerMaskIncludes(cornerMask, ASTEROID_VISIBILITY_CORNER.bottomLeft);
  const visibilityTrim = Math.ceil(size * 0.5);

  if (visibility) {
    if (!cornerTopLeft) {
      topTrimLeft = Math.max(topTrimLeft, visibilityTrim);
      leftTrimTop = Math.max(leftTrimTop, visibilityTrim);
    }
    if (!cornerTopRight) {
      topTrimRight = Math.max(topTrimRight, visibilityTrim);
      rightTrimTop = Math.max(rightTrimTop, visibilityTrim);
    }
    if (!cornerBottomRight) {
      bottomTrimRight = Math.max(bottomTrimRight, visibilityTrim);
      rightTrimBottom = Math.max(rightTrimBottom, visibilityTrim);
    }
    if (!cornerBottomLeft) {
      bottomTrimLeft = Math.max(bottomTrimLeft, visibilityTrim);
      leftTrimBottom = Math.max(leftTrimBottom, visibilityTrim);
    }
  }

  const visibleCorners = {
    outerTopLeft: outerTopLeft && cornerTopLeft,
    outerTopRight: outerTopRight && cornerTopRight,
    outerBottomRight: outerBottomRight && cornerBottomRight,
    outerBottomLeft: outerBottomLeft && cornerBottomLeft
  };
  if (visibility) {
    drawOuterRockCornerBackgrounds(ctx, x, y, right, bottom, colors, visibleCorners);
  }
  ctx.fillStyle = colors.foreground;

  if (topOpen && x + topTrimLeft <= right - topTrimRight) {
    drawPixelLine(
      ctx,
      x + topTrimLeft,
      y,
      right - topTrimRight,
      y
    );
  }

  if (rightOpen && y + rightTrimTop <= bottom - rightTrimBottom) {
    drawPixelLine(
      ctx,
      right,
      y + rightTrimTop,
      right,
      bottom - rightTrimBottom
    );
  }

  if (bottomOpen && x + bottomTrimLeft <= right - bottomTrimRight) {
    drawPixelLine(
      ctx,
      right - bottomTrimRight,
      bottom,
      x + bottomTrimLeft,
      bottom
    );
  }

  if (leftOpen && y + leftTrimTop <= bottom - leftTrimBottom) {
    drawPixelLine(
      ctx,
      x,
      bottom - leftTrimBottom,
      x,
      y + leftTrimTop
    );
  }

  drawOuterRockCorners(ctx, x, y, right, bottom, visibleCorners);
}

function drawOuterRockCornerBackgrounds(ctx, x, y, right, bottom, colors, corners) {
  ctx.fillStyle = colors.background;
  if (corners.outerTopLeft) {
    drawRockOuterCornerBackground(ctx, x + ROCK_OUTER_CORNER_RADIUS, y + ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, -1, -1);
  }

  if (corners.outerTopRight) {
    drawRockOuterCornerBackground(ctx, right - ROCK_OUTER_CORNER_RADIUS, y + ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, 1, -1);
  }

  if (corners.outerBottomRight) {
    drawRockOuterCornerBackground(ctx, right - ROCK_OUTER_CORNER_RADIUS, bottom - ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, 1, 1);
  }

  if (corners.outerBottomLeft) {
    drawRockOuterCornerBackground(ctx, x + ROCK_OUTER_CORNER_RADIUS, bottom - ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, -1, 1);
  }
}

function drawRockOuterCornerBackground(ctx, centerX, centerY, radius, signX, signY) {
  const radiusSq = radius * radius;
  for (let offsetY = 0; offsetY <= radius; offsetY += 1) {
    for (let offsetX = 0; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY <= radiusSq) {
        continue;
      }

      ctx.fillRect(centerX + signX * offsetX, centerY + signY * offsetY, 1, 1);
    }
  }
}

function drawOuterRockCorners(ctx, x, y, right, bottom, corners) {
  if (corners.outerTopLeft) {
    drawRockCornerArc(ctx, x + ROCK_OUTER_CORNER_RADIUS, y + ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, -1, -1);
  }

  if (corners.outerTopRight) {
    drawRockCornerArc(ctx, right - ROCK_OUTER_CORNER_RADIUS, y + ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, 1, -1);
  }

  if (corners.outerBottomRight) {
    drawRockCornerArc(ctx, right - ROCK_OUTER_CORNER_RADIUS, bottom - ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, 1, 1);
  }

  if (corners.outerBottomLeft) {
    drawRockCornerArc(ctx, x + ROCK_OUTER_CORNER_RADIUS, bottom - ROCK_OUTER_CORNER_RADIUS, ROCK_OUTER_CORNER_RADIUS, -1, 1);
  }
}

function drawRockCornerArc(ctx, centerX, centerY, radius, signX, signY) {
  const drawn = new Set();
  for (let step = 0; step <= radius; step += 1) {
    const other = Math.round(Math.sqrt(Math.max(0, radius * radius - step * step)));
    drawRockArcPixel(ctx, drawn, centerX + signX * step, centerY + signY * other);
    drawRockArcPixel(ctx, drawn, centerX + signX * other, centerY + signY * step);
  }
}

function drawRockArcPixel(ctx, drawn, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  const key = `${px}:${py}`;
  if (drawn.has(key)) {
    return;
  }

  drawn.add(key);
  ctx.fillRect(px, py, 1, 1);
}

function drawWallOutline(ctx, asteroid, tileX, tileY, x, y, size, colors, visibility = null) {
  ctx.fillStyle = colors.foreground;

  const north = wallTileBlocksVisibleOutline(asteroid, visibility, tileX, tileY - 1);
  const east = wallTileBlocksVisibleOutline(asteroid, visibility, tileX + 1, tileY);
  const south = wallTileBlocksVisibleOutline(asteroid, visibility, tileX, tileY + 1);
  const west = wallTileBlocksVisibleOutline(asteroid, visibility, tileX - 1, tileY);
  const northWest = wallTileBlocksVisibleOutline(asteroid, visibility, tileX - 1, tileY - 1);
  const northEast = wallTileBlocksVisibleOutline(asteroid, visibility, tileX + 1, tileY - 1);
  const southEast = wallTileBlocksVisibleOutline(asteroid, visibility, tileX + 1, tileY + 1);
  const southWest = wallTileBlocksVisibleOutline(asteroid, visibility, tileX - 1, tileY + 1);
  const left = x + (west ? 0 : 1);
  const right = x + size - 1 - (east ? 0 : 1);
  const top = y + (north ? 0 : 1);
  const bottom = y + size - 1 - (south ? 0 : 1);

  if (!north) {
    drawPixelLine(ctx, left, top, right, top);
  }

  if (!east) {
    drawPixelLine(ctx, right, top, right, bottom);
  }

  if (!south) {
    drawPixelLine(ctx, right, bottom, left, bottom);
  }

  if (!west) {
    drawPixelLine(ctx, left, bottom, left, top);
  }

  if (north && west && !northWest) {
    drawPixelLine(ctx, x + 1, y, x + 1, y + 1);
    drawPixelLine(ctx, x, y + 1, x + 1, y + 1);
  }

  if (north && east && !northEast) {
    drawPixelLine(ctx, x + size - 2, y, x + size - 2, y + 1);
    drawPixelLine(ctx, x + size - 2, y + 1, x + size, y + 1);
  }

  if (south && east && !southEast) {
    drawPixelLine(ctx, x + size - 2, y + size - 2, x + size - 2, y + size);
    drawPixelLine(ctx, x + size - 2, y + size - 2, x + size, y + size - 2);
  }

  if (south && west && !southWest) {
    drawPixelLine(ctx, x + 1, y + size - 2, x + 1, y + size);
    drawPixelLine(ctx, x, y + size - 2, x + 1, y + size - 2);
  }
}

function drawInnerRockCornerConnectors(ctx, asteroid, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY, colors, visibility = null) {
  ctx.fillStyle = colors.foreground;

  for (let tileY = minTileY - 1; tileY <= maxTileY + 1; tileY += 1) {
    for (let tileX = minTileX - 1; tileX <= maxTileX + 1; tileX += 1) {
      if (visibility && !asteroidVisibilityPaintsBackground(visibility, tileX, tileY)) {
        continue;
      }
      if (isRockTileAt(asteroid, tileX, tileY)) {
        continue;
      }

      const x = Math.round(tileX * tileSize - camera.x);
      const y = Math.round(tileY * tileSize - camera.y);
      const topEdge = y - 1;
      const leftEdge = x - 1;
      const rightEdge = x + tileSize;
      const bottomEdge = y + tileSize;
      const rightInside = rightEdge - 1;
      const bottomInside = bottomEdge - 1;
      const north = isRockTileAt(asteroid, tileX, tileY - 1);
      const east = isRockTileAt(asteroid, tileX + 1, tileY);
      const south = isRockTileAt(asteroid, tileX, tileY + 1);
      const west = isRockTileAt(asteroid, tileX - 1, tileY);
      const northWest = isRockTileAt(asteroid, tileX - 1, tileY - 1);
      const northEast = isRockTileAt(asteroid, tileX + 1, tileY - 1);
      const southEast = isRockTileAt(asteroid, tileX + 1, tileY + 1);
      const southWest = isRockTileAt(asteroid, tileX - 1, tileY + 1);

      if (north && west && northWest) {
        drawPixelLine(ctx, x + ROCK_INNER_CORNER_RADIUS, topEdge, leftEdge, y + ROCK_INNER_CORNER_RADIUS);
      }

      if (north && east && northEast) {
        drawPixelLine(ctx, rightInside - ROCK_INNER_CORNER_RADIUS, topEdge, rightEdge, y + ROCK_INNER_CORNER_RADIUS);
      }

      if (south && east && southEast) {
        drawPixelLine(
          ctx,
          rightEdge,
          bottomInside - ROCK_INNER_CORNER_RADIUS,
          rightInside - ROCK_INNER_CORNER_RADIUS,
          bottomEdge
        );
      }

      if (south && west && southWest) {
        drawPixelLine(ctx, x + ROCK_INNER_CORNER_RADIUS, bottomEdge, leftEdge, bottomInside - ROCK_INNER_CORNER_RADIUS);
      }
    }
  }
}

function oreMiningProgressFor(targets, index, amount) {
  const target = targets.get(index);
  if (!target) {
    return null;
  }

  const expectedPhase = `${ASTEROID_TILE.ore}:${amount}`;
  if (target.phase !== expectedPhase && target.tile !== ASTEROID_TILE.ore) {
    return null;
  }

  return clamp(target.progress || 0, 0, 1);
}

function diamondMiningProgressFor(targets, index) {
  const target = targets.get(index);
  if (!target || (target.phase !== ASTEROID_TILE.diamond && target.tile !== ASTEROID_TILE.diamond)) {
    return null;
  }

  return clamp(target.progress || 0, 0, 1);
}

function drawOreRings(ctx, tileX, tileY, size, amount, hash, miningProgress = null) {
  const pieces = buildOrePieces(tileX, tileY, size, amount, hash, miningProgress);
  const drawOrder = [...pieces].sort((a, b) => a.depth - b.depth);

  for (const piece of drawOrder) {
    const occluders = pieces
      .filter((other) => other.depth > piece.depth)
      .map(orePieceOccluder);
    drawOrePiece(ctx, piece, occluders);
  }
}

function buildOrePieces(tileX, tileY, size, amount, hash, miningProgress) {
  const count = clamp(Math.round(amount), 1, 3);
  const activeIndex = count - 1;
  const progress = miningProgress === null ? 0 : clamp(miningProgress, 0, 1);
  const pieces = [];

  for (let index = 0; index < count; index += 1) {
    const seed = hash ^ Math.imul(index + 1, 1597334677);
    const radius = 2 + randomUnit(seed, 1) * 0.65;
    const margin = Math.ceil(radius + 2);
    const centerX = tileX + margin + Math.round(randomUnit(seed, 2) * (size - margin * 2));
    const centerY = tileY + margin + Math.round(randomUnit(seed, 3) * (size - margin * 2));
    const pieceProgress = index === activeIndex ? progress : 0;
    const rotateSign = randomUnit(seed, 7) < 0.5 ? -1 : 1;
    const tiltSign = randomUnit(seed, 8) < 0.5 ? -1 : 1;
    const tilt = clamp(randomUnit(seed, 4) * (Math.PI / 4) + tiltSign * pieceProgress * 0.07, 0, Math.PI / 4);
    const tiltAxis = randomUnit(seed, 5) * Math.PI * 2 + rotateSign * pieceProgress * ORE_MINING_ROTATION;
    const spin = randomUnit(seed, 6) * Math.PI * 2 + rotateSign * pieceProgress * 0.38;
    const depth = index + randomUnit(seed, 9) * 0.08;

    pieces.push({
      centerX,
      centerY,
      radius,
      tilt,
      tiltAxis,
      spin,
      depth
    });
  }

  return pieces;
}

function drawOrePiece(ctx, piece, occluders) {
  const points = projectedRingPoints(piece);

  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    drawPixelLine(ctx, from.x, from.y, to.x, to.y, occluders);
  }
}

function orePieceOccluder(piece) {
  const axis = {
    x: Math.cos(piece.tiltAxis),
    y: Math.sin(piece.tiltAxis)
  };
  const perpendicular = {
    x: -axis.y,
    y: axis.x
  };

  return {
    type: "ellipse",
    x: piece.centerX,
    y: piece.centerY,
    axis,
    perpendicular,
    radiusX: piece.radius + ORE_OCCLUSION_PADDING,
    radiusY: piece.radius * Math.cos(piece.tilt) + ORE_OCCLUSION_PADDING
  };
}

function projectedRingPoints({ centerX, centerY, radius, tilt, tiltAxis, spin }) {
  const axis = {
    x: Math.cos(tiltAxis),
    y: Math.sin(tiltAxis)
  };
  const perpendicular = {
    x: -axis.y,
    y: axis.x
  };
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const points = [];

  for (let step = 0; step < ORE_RING_STEPS; step += 1) {
    const angle = spin + (step / ORE_RING_STEPS) * Math.PI * 2;
    const alongAxis = Math.cos(angle) * radius;
    const alongTilt = Math.sin(angle) * radius;
    const z = alongTilt * sinTilt;
    const perspective = 1 + z * 0.035;
    points.push({
      x: Math.round(centerX + (axis.x * alongAxis + perpendicular.x * alongTilt * cosTilt) * perspective),
      y: Math.round(centerY + (axis.y * alongAxis + perpendicular.y * alongTilt * cosTilt) * perspective)
    });
  }

  return points;
}

function drawDiamondWireframe(ctx, tileX, tileY, size, hash, miningProgress = null) {
  const centerX = tileX + Math.floor(size / 2);
  const centerY = tileY + Math.floor(size / 2);
  const progressOffset = miningProgress === null ? 0 : clamp(miningProgress, 0, 1);
  const yaw = ((hash & 255) / 255) * Math.PI * 2 + progressOffset * 0.18;
  const pitch = (((hash >>> 8) & 255) / 255) * Math.PI * 2 + progressOffset * 0.12;
  const roll =
    (((hash >>> 16) & 255) / 255) * Math.PI * 2 +
    progressOffset * 0.28;
  const vertices = [
    { x: 1, y: 1, z: 1 },
    { x: -1, y: -1, z: 1 },
    { x: -1, y: 1, z: -1 },
    { x: 1, y: -1, z: -1 }
  ].map((point) => projectPoint3D(rotatePoint3D(point, yaw, pitch, roll), centerX, centerY));
  const edges = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3]
  ];

  for (const [fromIndex, toIndex] of edges) {
    const from = vertices[fromIndex];
    const to = vertices[toIndex];
    drawPixelLine(ctx, from.x, from.y, to.x, to.y);
  }
}

function rotatePoint3D(point, yaw, pitch, roll) {
  const yawCos = Math.cos(yaw);
  const yawSin = Math.sin(yaw);
  const pitchCos = Math.cos(pitch);
  const pitchSin = Math.sin(pitch);
  const rollCos = Math.cos(roll);
  const rollSin = Math.sin(roll);
  const yawed = {
    x: point.x * yawCos + point.z * yawSin,
    y: point.y,
    z: -point.x * yawSin + point.z * yawCos
  };
  const pitched = {
    x: yawed.x,
    y: yawed.y * pitchCos - yawed.z * pitchSin,
    z: yawed.y * pitchSin + yawed.z * pitchCos
  };

  return {
    x: pitched.x * rollCos - pitched.y * rollSin,
    y: pitched.x * rollSin + pitched.y * rollCos,
    z: pitched.z
  };
}

function projectPoint3D(point, centerX, centerY) {
  const perspective = 3.1 / (3.1 - point.z);
  const scale = 3.7 * perspective;

  return {
    x: Math.round(centerX + point.x * scale),
    y: Math.round(centerY + point.y * scale)
  };
}

function drawStormBoundary(ctx, asteroid, camera, colors, timeSeconds) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const padding = cameraCullPadding(camera);
  const lensSource = typeof ctx.lensSourceSize === "function" ? ctx.lensSourceSize() : null;
  const renderWidth = lensSource?.width || ctx.width;
  const renderHeight = lensSource?.height || ctx.height;
  const renderCamera = lensSource
    ? { x: camera.x - lensSource.padding, y: camera.y - lensSource.padding }
    : camera;
  const nativeBoundary = typeof ctx.drawCodeRuns === "function"
    ? cachedStormBoundaryNative(asteroid, renderCamera, renderWidth, renderHeight, timeSeconds, lensSource ? 0 : padding, Boolean(lensSource))
    : null;
  if (nativeBoundary?.runs && typeof ctx.drawCodeRuns === "function") {
    ctx.drawCodeRuns(nativeBoundary.runs, {
      background: colors.background,
      foreground: colors.foreground,
      backing: colors.backing || "#000000"
    });
    return;
  }

  const minTileX = Math.max(0, Math.floor((camera.x - padding) / tileSize) - 1);
  const maxTileX = Math.min(
    asteroid.widthTiles - 1,
    Math.ceil((camera.x + ctx.width + padding) / tileSize) + 1
  );
  const minTileY = Math.max(0, Math.floor((camera.y - padding) / tileSize) - 1);
  const maxTileY = Math.min(
    asteroid.heightTiles - 1,
    Math.ceil((camera.y + ctx.height + padding) / tileSize) + 1
  );

  ctx.fillStyle = colors.foreground;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (!isBoundarySafeTile(asteroid, tileX, tileY)) {
        continue;
      }

      const screenX = Math.round(tileX * tileSize - camera.x);
      const screenY = Math.round(tileY * tileSize - camera.y);
      const worldX = tileX * tileSize;
      const worldY = tileY * tileSize;

      if (!isBoundarySafeTile(asteroid, tileX - 1, tileY)) {
        drawStormBoundaryVertical(ctx, asteroid, screenX, screenY, tileSize, worldX, worldY, timeSeconds);
      }

      if (!isBoundarySafeTile(asteroid, tileX + 1, tileY)) {
        drawStormBoundaryVertical(
          ctx,
          asteroid,
          screenX + tileSize - 1,
          screenY,
          tileSize,
          worldX + tileSize - 1,
          worldY,
          timeSeconds
        );
      }

      if (!isBoundarySafeTile(asteroid, tileX, tileY - 1)) {
        drawStormBoundaryHorizontal(ctx, asteroid, screenX, screenY, tileSize, worldX, worldY, timeSeconds);
      }

      if (!isBoundarySafeTile(asteroid, tileX, tileY + 1)) {
        drawStormBoundaryHorizontal(
          ctx,
          asteroid,
          screenX,
          screenY + tileSize - 1,
          tileSize,
          worldX,
          worldY + tileSize - 1,
          timeSeconds
        );
      }
    }
  }
}

function cachedStormBoundaryNative(asteroid, camera, width, height, timeSeconds, padding, noLens = false) {
  const frame = Math.floor(Number(timeSeconds || 0) * STORM_PATTERN_FPS);
  const key = [
    asteroid.seed || "default",
    asteroid.revision || asteroid._revision || 0,
    asteroid.widthTiles,
    asteroid.heightTiles,
    asteroid.storm?.length || 0,
    Math.floor(width),
    Math.floor(height),
    Math.floor(Number(camera.x || 0)),
    Math.floor(Number(camera.y || 0)),
    Math.floor(Number(padding || 0)),
    noLens ? 1 : 0,
    frame
  ].join(":");
  if (stormBoundaryRunCache?.key === key) {
    return stormBoundaryRunCache.value;
  }

  const nativeOptions = {
    sourcePadding: padding,
    noLens,
    lensEdgeScale: WORLD_LENS_EDGE_SCALE,
    lensPower: WORLD_LENS_POWER,
    lensNoiseRadial: WORLD_LENS_NOISE_RADIAL,
    lensNoiseTangential: WORLD_LENS_NOISE_TANGENTIAL,
    lensDefectDensity: WORLD_LENS_DEFECT_DENSITY,
    constants: {
      fps: STORM_PATTERN_FPS,
      scale: STORM_NOISE_SCALE,
      speedX: STORM_NOISE_SPEED_X,
      speedY: STORM_NOISE_SPEED_Y,
      speedZ: STORM_NOISE_SPEED_Z
    }
  };
  const stableTimeSeconds = frame / STORM_PATTERN_FPS;
  const runs = stormBoundaryRunsNative(
    asteroid,
    camera,
    width,
    height,
    stableTimeSeconds,
    STORM_BOUNDARY_NOISE_THRESHOLD,
    nativeOptions
  );
  const value = runs ? { runs } : null;
  stormBoundaryRunCache = { key, value };
  return value;
}

function drawStormBoundaryVertical(ctx, asteroid, x, y, length, worldX, worldY, timeSeconds, clip = null) {
  for (let offset = 0; offset < length; offset += 1) {
    const pixelX = x;
    const pixelY = y + offset;
    if (clip && !playerMapCirclePixelInside(pixelX, pixelY, clip.x, clip.y, clip.radiusSq)) {
      continue;
    }

    if (stormBoundaryMaskOn(asteroid, worldX, worldY + offset, timeSeconds)) {
      ctx.fillRect(pixelX, pixelY, 1, 1);
    }
  }
}

function drawStormBoundaryHorizontal(ctx, asteroid, x, y, length, worldX, worldY, timeSeconds, clip = null) {
  for (let offset = 0; offset < length; offset += 1) {
    const pixelX = x + offset;
    const pixelY = y;
    if (clip && !playerMapCirclePixelInside(pixelX, pixelY, clip.x, clip.y, clip.radiusSq)) {
      continue;
    }

    if (stormBoundaryMaskOn(asteroid, worldX + offset, worldY, timeSeconds)) {
      ctx.fillRect(pixelX, pixelY, 1, 1);
    }
  }
}

function stormBoundaryMaskOn(asteroid, worldX, worldY, timeSeconds) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const tileX = Math.floor(worldX / tileSize);
  const tileY = Math.floor(worldY / tileSize);
  const localX = positiveModulo(Math.floor(worldX), tileSize);
  const localY = positiveModulo(Math.floor(worldY), tileSize);
  const rows = stormPatternRows(asteroid, tileX, tileY, tileSize, timeSeconds, STORM_BOUNDARY_NOISE_THRESHOLD);
  return ((rows[localY] || 0) & (1 << localX)) !== 0;
}

function drawAsteroidBoundary(ctx, asteroid, camera, colors, visibility = null) {
  const lines = asteroidBoundaryLines(asteroid);
  const padding = cameraCullPadding(camera);
  const minX = camera.x - padding - 1;
  const maxX = camera.x + ctx.width + padding + 1;
  const minY = camera.y - padding - 1;
  const maxY = camera.y + ctx.height + padding + 1;

  const draw = () => {
    if (!visibility) {
      ctx.fillStyle = colors.foreground;
    }

    for (const line of lines) {
      if (visibility) {
        drawDashedAsteroidBoundaryLineVisibilityAware(ctx, line, camera, minX, maxX, minY, maxY, colors, visibility);
      } else {
        drawDashedAsteroidBoundaryLine(ctx, line, camera, minX, maxX, minY, maxY);
      }
    }
  };

  if (visibility) {
    drawWithoutWorldMask(ctx, draw);
    return;
  }

  draw();
}

function asteroidBoundaryLines(asteroid) {
  const cached = asteroidBoundaryContourCache.get(asteroid);
  if (cached) {
    return cached;
  }

  const segments = buildAsteroidBoundarySegments(asteroid);
  const outgoingSegments = new Map();
  const lines = [];

  for (const segment of segments) {
    const key = vertexKey(segment.x0, segment.y0);
    if (!outgoingSegments.has(key)) {
      outgoingSegments.set(key, []);
    }

    outgoingSegments.get(key).push(segment);
  }

  for (const segment of segments) {
    if (segment.used) {
      continue;
    }

    const line = traceAsteroidBoundaryLine(segments, outgoingSegments, segment);
    if (line.length > 0) {
      lines.push(line);
    }
  }

  asteroidBoundaryContourCache.set(asteroid, lines);
  return lines;
}

function buildAsteroidBoundarySegments(asteroid) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const segments = [];

  for (let tileY = 0; tileY < asteroid.heightTiles; tileY += 1) {
    for (let tileX = 0; tileX < asteroid.widthTiles; tileX += 1) {
      if (!isBoundarySafeTile(asteroid, tileX, tileY)) {
        continue;
      }

      const x = tileX * tileSize;
      const y = tileY * tileSize;

      if (!isBoundarySafeTile(asteroid, tileX, tileY - 1)) {
        segments.push(buildBoundaryLineSegment(x, y, x + tileSize, y, 0));
      }

      if (!isBoundarySafeTile(asteroid, tileX + 1, tileY)) {
        segments.push(buildBoundaryLineSegment(x + tileSize, y, x + tileSize, y + tileSize, 1));
      }

      if (!isBoundarySafeTile(asteroid, tileX, tileY + 1)) {
        segments.push(buildBoundaryLineSegment(x + tileSize, y + tileSize, x, y + tileSize, 2));
      }

      if (!isBoundarySafeTile(asteroid, tileX - 1, tileY)) {
        segments.push(buildBoundaryLineSegment(x, y + tileSize, x, y, 3));
      }
    }
  }

  return segments;
}

function buildBoundaryLineSegment(x0, y0, x1, y1, direction) {
  return {
    x0,
    y0,
    x1,
    y1,
    direction,
    length: Math.abs(x1 - x0) + Math.abs(y1 - y0),
    used: false
  };
}

function traceAsteroidBoundaryLine(segments, outgoingSegments, startSegment) {
  const startKey = vertexKey(startSegment.x0, startSegment.y0);
  let segment = startSegment;
  const line = [];
  let guard = segments.length + 1;

  while (segment && !segment.used && guard > 0) {
    segment.used = true;
    line.push(segment);
    guard -= 1;

    const endKey = vertexKey(segment.x1, segment.y1);
    if (endKey === startKey) {
      break;
    }

    segment = nextBuildContourEdge(segment, outgoingSegments.get(endKey) || []);
  }

  return line;
}

function drawDashedAsteroidBoundaryLine(ctx, line, camera, minX, maxX, minY, maxY) {
  let distance = 0;

  for (const segment of line) {
    for (let offset = 0; offset < segment.length; offset += 1) {
      if (positiveModulo(distance + offset, ASTEROID_DASH_PERIOD) >= ASTEROID_DASH_ON) {
        continue;
      }

      const pixel = asteroidBoundarySegmentPixel(segment, offset);
      if (pixel.x < minX || pixel.x > maxX || pixel.y < minY || pixel.y > maxY) {
        continue;
      }

      ctx.fillRect(
        Math.round(pixel.x - camera.x),
        Math.round(pixel.y - camera.y),
        1,
        1
      );
    }

    distance += segment.length;
  }
}

function drawDashedAsteroidBoundaryLineVisibilityAware(ctx, line, camera, minX, maxX, minY, maxY, colors, visibility) {
  let distance = 0;
  ctx.fillStyle = colors.foreground;

  for (const segment of line) {
    for (let offset = 0; offset < segment.length; offset += 1) {
      if (positiveModulo(distance + offset, ASTEROID_DASH_PERIOD) >= ASTEROID_DASH_ON) {
        continue;
      }

      const pixel = asteroidBoundarySegmentPixel(segment, offset);
      if (pixel.x < minX || pixel.x > maxX || pixel.y < minY || pixel.y > maxY) {
        continue;
      }

      const screenX = Math.round(pixel.x - camera.x);
      const screenY = Math.round(pixel.y - camera.y);
      if (!asteroidVisibilityScreenPointVisible(visibility, screenX, screenY)) {
        continue;
      }

      ctx.fillRect(screenX, screenY, 1, 1);
    }

    distance += segment.length;
  }
}

function asteroidBoundarySegmentPixel(segment, offset) {
  if (segment.direction === 0) {
    return { x: segment.x0 + offset, y: segment.y0 };
  }

  if (segment.direction === 1) {
    return { x: segment.x0, y: segment.y0 + offset };
  }

  if (segment.direction === 2) {
    return { x: segment.x0 - offset, y: segment.y0 };
  }

  return { x: segment.x0, y: segment.y0 - offset };
}

function isRockTile(tile) {
  return tile === ASTEROID_TILE.rock || tile === ASTEROID_TILE.ore || tile === ASTEROID_TILE.diamond;
}

function isWallTile(tile) {
  return tile === ASTEROID_TILE.wall;
}

function isSolidTile(tile) {
  return isRockTile(tile) || isWallTile(tile);
}

function isRockTileAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  return isRockTile(asteroid.tiles[tileY * asteroid.widthTiles + tileX]);
}

function rockTileBlocksVisibleOutline(asteroid, visibility, tileX, tileY) {
  if (!visibility) {
    return isRockTileAt(asteroid, tileX, tileY);
  }

  if (!asteroidVisibilityPaintsBackground(visibility, tileX, tileY)) {
    return true;
  }

  return isRockTileAt(asteroid, tileX, tileY);
}

function isWallTileAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  return isWallTile(asteroid.tiles[tileY * asteroid.widthTiles + tileX]);
}

function wallTileBlocksVisibleOutline(asteroid, visibility, tileX, tileY) {
  if (!visibility) {
    return isWallTileAt(asteroid, tileX, tileY);
  }

  if (!asteroidVisibilityPaintsBackground(visibility, tileX, tileY)) {
    return true;
  }

  return isWallTileAt(asteroid, tileX, tileY);
}

function amountAt(asteroid, index) {
  return Number.parseInt(asteroid.amounts[index] || "0", 36) || 0;
}

function isPlayableTile(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  const value = asteroid.playable[tileY * asteroid.widthTiles + tileX];
  return value === "1" || value === true;
}

function isBoundarySafeTile(asteroid, tileX, tileY) {
  return isPlayableTile(asteroid, tileX, tileY) &&
    stormTileStateAt(asteroid, tileX, tileY) === STORM_STATE.safe;
}

function stormTileStateAt(asteroid, tileX, tileY) {
  if (!asteroid.storm) {
    return isPlayableTile(asteroid, tileX, tileY) ? STORM_STATE.safe : STORM_STATE.storm;
  }

  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return STORM_STATE.storm;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  if (!isPlayableTile(asteroid, tileX, tileY)) {
    return STORM_STATE.storm;
  }

  return Number(asteroid.storm[index] || STORM_STATE.safe);
}

function stormFocusForPlayer(asteroid, player) {
  if (!asteroid?.storm || !player || player.alive === false) {
    return null;
  }

  const x = Number(player.x);
  const y = Number(player.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const tileX = Math.floor(x / tileSize);
  const tileY = Math.floor(y / tileSize);
  if (stormTileStateAt(asteroid, tileX, tileY) !== STORM_STATE.storm) {
    return null;
  }

  return { enabled: true, x, y };
}

function drawWorldBounds(ctx, snapshot, camera) {
  const left = Math.round(-camera.x);
  const top = Math.round(-camera.y);
  const right = Math.round(snapshot.world.width - camera.x);
  const bottom = Math.round(snapshot.world.height - camera.y);
  const padding = cameraCullPadding(camera);

  if (left >= -padding && left < ctx.width + padding) {
    drawDashedVerticalLine(ctx, left, top, bottom, camera.y, padding);
  }

  if (top >= -padding && top < ctx.height + padding) {
    drawDashedHorizontalLine(ctx, top, left, right, camera.x, padding);
  }

  if (right >= -padding && right < ctx.width + padding) {
    drawDashedVerticalLine(ctx, right, top, bottom, camera.y, padding);
  }

  if (bottom >= -padding && bottom < ctx.height + padding) {
    drawDashedHorizontalLine(ctx, bottom, left, right, camera.x, padding);
  }
}

function drawDashedVerticalLine(ctx, x, worldTop, worldBottom, cameraY, padding = 0) {
  const start = Math.max(-padding, worldTop);
  const end = Math.min(ctx.height - 1 + padding, worldBottom);

  for (let y = start; y <= end; y += 1) {
    if (positiveModulo(Math.floor(cameraY + y), 8) < 4) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawDashedHorizontalLine(ctx, y, worldLeft, worldRight, cameraX, padding = 0) {
  const start = Math.max(-padding, worldLeft);
  const end = Math.min(ctx.width - 1 + padding, worldRight);

  for (let x = start; x <= end; x += 1) {
    if (positiveModulo(Math.floor(cameraX + x), 8) < 4) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function drawStars(ctx, snapshot, camera, visibility = null) {
  drawStarLayer(ctx, snapshot.arenaId, {
    x: camera.x * STAR_PARALLAX,
    y: camera.y * STAR_PARALLAX,
    lensSourcePadding: cameraCullPadding(camera)
  }, visibility, camera);
}

function drawMenuStars(ctx, timeSeconds) {
  drawStarLayer(ctx, MENU_STAR_SEED, {
    x: timeSeconds * MENU_STAR_SCROLL_SPEED,
    y: 0,
    lensSourcePadding: worldLensSourcePadding(ctx.width, ctx.height)
  });
}

function drawStarLayer(ctx, seed, starCamera, visibility = null, worldCamera = null) {
  const padding = starCamera.lensSourcePadding || 0;
  const minCellX = Math.floor((starCamera.x - padding) / STAR_CELL_SIZE) - 1;
  const maxCellX = Math.ceil((starCamera.x + ctx.width + padding) / STAR_CELL_SIZE) + 1;
  const minCellY = Math.floor((starCamera.y - padding) / STAR_CELL_SIZE) - 1;
  const maxCellY = Math.ceil((starCamera.y + ctx.height + padding) / STAR_CELL_SIZE) + 1;

  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const hash = hashCell(seed, cellX, cellY);
      const x = cellX * STAR_CELL_SIZE + (hash % STAR_CELL_SIZE);
      const y = cellY * STAR_CELL_SIZE + ((hash >>> 8) % STAR_CELL_SIZE);
      const screen = worldToScreen({ x, y }, starCamera);

      if (
        screen.x < -padding ||
        screen.x >= ctx.width + padding ||
        screen.y < -padding ||
        screen.y >= ctx.height + padding
      ) {
        continue;
      }
      if (visibility && !starVisibleInAsteroidMask(visibility, worldCamera, screen.x, screen.y)) {
        continue;
      }

      if (hash % 181 === 0) {
        drawLargeStar(ctx, screen.x, screen.y);
      } else if (hash % 61 === 0) {
        drawMediumStar(ctx, screen.x, screen.y);
      } else if (hash % 13 === 0) {
        ctx.fillRect(screen.x, screen.y, 1, 1);
      }
    }
  }
}

function starVisibleInAsteroidMask(visibility, camera, screenX, screenY) {
  if (!visibility || !camera) {
    return true;
  }

  return asteroidVisibilityPointPaintsBackground(visibility, camera.x + screenX, camera.y + screenY);
}

function drawLargeStar(ctx, x, y) {
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x - 1, y, 1, 1);
  ctx.fillRect(x + 1, y, 1, 1);
  ctx.fillRect(x, y - 1, 1, 1);
  ctx.fillRect(x, y + 1, 1, 1);
  ctx.fillRect(x, y - 2, 1, 1);
  ctx.fillRect(x, y + 2, 1, 1);
}

function drawMediumStar(ctx, x, y) {
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x, y + 1, 1, 1);
}

function drawEntity(ctx, entity, camera, options, colors, textRenderer) {
  if (entity.hidden) {
    return;
  }

  if (entity.type === "lobbyButton") {
    drawLobbyButtonEntity(ctx, entity, camera, options, colors, textRenderer);
    return;
  }

  if (entity.type === "themeSwatch") {
    drawThemeSwatchEntity(ctx, entity, camera, colors, textRenderer);
    return;
  }

  if (entity.type === "themeBand") {
    drawThemeBandEntity(ctx, entity, camera, colors);
    return;
  }

  if (entity.type === "menuTitle") {
    drawMenuTitleEntity(ctx, entity, camera, colors, textRenderer);
    return;
  }

  if (entity.type === "menuHint") {
    drawMenuHintEntity(ctx, entity, camera, colors, textRenderer);
    return;
  }

  if (entity.type === "huckRock") {
    drawHuckRockEntity(ctx, entity, camera, colors);
    return;
  }

  const screen = worldToScreen(entity, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);

  drawPixels(ctx, x, y, [
    [0, -2],
    [-1, -1],
    [0, -1],
    [1, -1],
    [-2, 0],
    [-1, 0],
    [0, 0],
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2]
  ], ENTITY_PIXEL_SIZE);
}

function drawMenuHintEntity(ctx, entity, camera, colors, textRenderer) {
  if (!textRenderer) {
    return;
  }

  const screen = worldToScreen(entity, camera);
  const x = Math.round(screen.x - (entity.width || 168) / 2);
  const y = Math.round(screen.y);
  const width = Math.round(entity.width || 168);
  const rows = Array.isArray(entity.rows) ? entity.rows : [];
  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };

  rows.slice(0, 4).forEach((row, index) => {
    const input = String(row.input || "").toUpperCase();
    const action = String(row.action || "").toUpperCase();
    const rowY = y + index * 11;
    const actionWidth = textRenderer.measure(action, textOptions);
    if (row.inputIcon) {
      drawControllerFaceButtons(ctx, x + 26, rowY + 5, row.inputIcon, colors);
    } else {
      textRenderer.draw(ctx, input, x + 10, rowY, {
        ...textOptions,
        width: Math.floor(width / 2) - 16
      });
    }
    textRenderer.draw(ctx, action, x + width - actionWidth - 10, rowY, {
      ...textOptions,
      width: actionWidth + 2
    });
  });
}

function drawHuckRockEntity(ctx, entity, camera, colors) {
  const screen = worldToScreen(entity, camera);
  const radius = Number(entity.radius || ENGINE.huckRock.radius);
  const seed = entity.shapeSeed || entity.id || "huck-rock";
  const centerX = Math.round(screen.x);
  const centerY = Math.round(screen.y);
  const yaw = Number(entity.angleY) || 0;
  const pitch = Number(entity.angleX) || 0;
  const roll = Number(entity.angleZ) || 0;
  const hull = huckRockHullNative(seed, centerX, centerY, radius, yaw, pitch, roll) ||
    convexHull(projectedHuckRockPoints(seed, centerX, centerY, radius, yaw, pitch, roll));

  if (hull.length < 2) {
    return;
  }

  ctx.fillStyle = colors.foreground;
  for (let index = 0; index < hull.length; index += 1) {
    const from = hull[index];
    const to = hull[(index + 1) % hull.length];
    drawPixelLine(ctx, Math.round(from.x), Math.round(from.y), Math.round(to.x), Math.round(to.y));
  }
}

function projectedHuckRockPoints(seed, centerX, centerY, radius, yaw, pitch, roll) {
  return huckRockShapePoints(seed).map((point) => {
    const rotated = rotatePoint3D(point, yaw, pitch, roll);
    const perspective = 2.7 / (2.7 - rotated.z * 0.55);
    return {
      x: centerX + rotated.x * radius * perspective,
      y: centerY + rotated.y * radius * perspective
    };
  });
}

function huckRockShapePoints(seed) {
  const cacheKey = String(seed);
  const cached = huckRockShapeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const random = createSeededRandom(cacheKey);
  const points = [];
  for (let index = 0; index < 14; index += 1) {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    points.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z
    });
  }

  huckRockShapeCache.set(cacheKey, points);
  if (huckRockShapeCache.size > HUCK_ROCK_SHAPE_CACHE_MAX) {
    huckRockShapeCache.delete(huckRockShapeCache.keys().next().value);
  }
  return points;
}

function convexHull(points) {
  const sorted = points
    .map((point) => ({
      x: Math.round(point.x * 100) / 100,
      y: Math.round(point.y * 100) / 100
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  if (sorted.length <= 3) {
    return sorted;
  }

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && hullCross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && hullCross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function hullCross(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function drawMenuTitleEntity(ctx, entity, camera, colors, textRenderer) {
  if (!textRenderer) {
    return;
  }

  const screen = worldToScreen(entity, camera);
  const label = String(entity.label || "").toUpperCase();
  const textOptions = {
    fontSize: 10,
    color: colors.foreground
  };
  const width = textRenderer.measure(label, textOptions);
  textRenderer.draw(ctx, label, Math.round(screen.x - width / 2), Math.round(screen.y), {
    ...textOptions,
    width: width + 2
  });

  const subtitle = String(entity.subtitle || "").toUpperCase();
  if (!subtitle) {
    return;
  }

  const subtitleOptions = {
    fontSize: 8,
    color: colors.foreground
  };
  const subtitleWidth = textRenderer.measure(subtitle, subtitleOptions);
  textRenderer.draw(ctx, subtitle, Math.round(screen.x - subtitleWidth / 2), Math.round(screen.y + 22), {
    ...subtitleOptions,
    width: subtitleWidth + 2
  });
}

function drawThemeSwatchEntity(ctx, entity, camera, colors, textRenderer) {
  const screen = worldToScreen(entity, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const radius = Number(entity.radius || 15);
  const selected = entity.selected === true;
  const background = entity.background || colors.background;
  const foreground = entity.foreground || colors.foreground;
  const backing = entity.backing || colors.backing || "#000000";
  const backingColor = selected ? foreground : backing;
  const fillColor = background;
  const detailColor = foreground;

  ctx.fillStyle = backingColor;
  fillSolidDisk(ctx, x, y, radius + 4);

  ctx.fillStyle = fillColor;
  fillSolidDisk(ctx, x, y, radius);
  ctx.fillStyle = detailColor;
  drawCenteredCircleLabel(ctx, textRenderer, String(entity.label || ""), x, y - 7, {
    fontSize: 10,
    color: detailColor,
    borderColor: "auto",
    borderBackgroundColor: background,
    borderBackingColor: backing
  });
}

function drawThemeBandEntity(ctx, entity, camera, colors) {
  const screen = worldToScreen(entity, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const ringRadius = Math.max(1, Number(entity.ringRadius || 1));
  const bandRadius = Math.max(1, Number(entity.bandRadius || 1));
  drawCircleBandSpans(ctx, x, y, Math.max(0, ringRadius - bandRadius), ringRadius + bandRadius, colors.backing || "#000000");
}

function drawCircleBandSpans(ctx, cx, cy, innerRadius, outerRadius, color) {
  const innerRadiusSq = Math.max(0, innerRadius * innerRadius);
  const outerRadiusSq = Math.max(0, outerRadius * outerRadius);
  const minY = Math.floor(cy - outerRadius);
  const maxY = Math.ceil(cy + outerRadius);

  ctx.fillStyle = color;
  for (let py = minY; py <= maxY; py += 1) {
    const dy = py + 0.5 - cy;
    const outerHorizontalSq = outerRadiusSq - dy * dy;
    if (outerHorizontalSq < 0) {
      continue;
    }

    const outerHorizontal = Math.sqrt(outerHorizontalSq);
    const outerStart = Math.ceil(cx - outerHorizontal);
    const outerEnd = Math.floor(cx + outerHorizontal);
    const innerHorizontalSq = innerRadiusSq - dy * dy;
    if (innerHorizontalSq <= 0) {
      ctx.fillRect(outerStart, py, outerEnd - outerStart + 1, 1);
      continue;
    }

    const innerHorizontal = Math.sqrt(innerHorizontalSq);
    const leftEnd = Math.floor(cx - innerHorizontal);
    const rightStart = Math.ceil(cx + innerHorizontal);
    if (leftEnd >= outerStart) {
      ctx.fillRect(outerStart, py, leftEnd - outerStart + 1, 1);
    }
    if (rightStart <= outerEnd) {
      ctx.fillRect(rightStart, py, outerEnd - rightStart + 1, 1);
    }
  }
}

function drawCenteredCircleLabel(ctx, textRenderer, label, centerX, y, options) {
  if (!textRenderer || !label) {
    return;
  }

  const width = textRenderer.measure(label, options);
  textRenderer.draw(ctx, label, Math.round(centerX - width / 2), y, {
    ...options,
    width: width + 2
  });
}

function drawLobbyButtonEntity(ctx, entity, camera, options, colors, textRenderer) {
  if (entity.hostOnly && options.room?.hostClientId !== options.clientId) {
    return;
  }

  const screen = worldToScreen(entity, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const width = Math.round(entity.width || 96);
  const height = Math.round(entity.height || 28);
  const label = String(entity.label || entity.action || "BUTTON").toUpperCase();
  const selected = entity.selected === true || entity.active === true;
  const fillColor = entity.fillColor || colors.background;
  const textColor = entity.textColor || (selected ? colors.background : colors.foreground);

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = selected && !entity.fillColor ? colors.foreground : fillColor;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
  ctx.fillStyle = colors.foreground;
  drawRectOutline(ctx, x, y, width, height);
  if (selected && entity.fillColor) {
    ctx.fillStyle = colors.foreground;
    drawRectOutline(ctx, x + 2, y + 2, width - 4, height - 4);
  }

  const textOptions = {
    fontSize: entity.fillColor ? 8 : 10,
    color: textColor
  };
  const labelWidth = textRenderer.measure(label, textOptions);
  textRenderer.draw(ctx, label, Math.round(x + (width - labelWidth) / 2), y + Math.floor((height - 14) / 2), {
    ...textOptions,
    width: width - 4
  });
}

function drawRectOutline(ctx, x, y, width, height) {
  ctx.fillRect(x, y, width, 1);
  ctx.fillRect(x, y + height - 1, width, 1);
  ctx.fillRect(x, y, 1, height);
  ctx.fillRect(x + width - 1, y, 1, height);
}

function shipMainRadius(player) {
  return Math.max(1, Number(player?.radius || ENGINE.ship.radius || 1));
}

function shipGeometryScaleForRadius(radius) {
  const baseRadius = Math.max(1, Number(ENGINE.ship.radius) || 1);
  return Math.max(0.1, radius / baseRadius);
}

function shipSmallOrbRadius(geometryScale) {
  return Math.max(1, SMALL_ORB_RADIUS * geometryScale);
}

function drawShip(ctx, player, camera, asteroid, colors, timeSeconds, textRenderer, freezeAuxiliaryAim = false) {
  const screen = worldToScreen(player, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const mainRadius = shipMainRadius(player);
  const geometryScale = shipGeometryScaleForRadius(mainRadius);
  const smallOrbRadius = shipSmallOrbRadius(geometryScale);
  const bodyAngle = shipVisualAngle(player);
  const rearAngle = bodyAngle + Math.PI;
  const rear = {
    x: Math.cos(rearAngle),
    y: Math.sin(rearAngle)
  };
  const side = {
    x: Math.cos(bodyAngle + Math.PI / 2),
    y: Math.sin(bodyAngle + Math.PI / 2)
  };
  const mainOccluder = {
    x,
    y,
    radius: mainRadius
  };

  for (const orb of REAR_ORBS.filter((candidate) => candidate.layer === "back")) {
    const orbX = Math.round(x + rear.x * orb.rear * geometryScale + side.x * orb.side * geometryScale);
    const orbY = Math.round(y + rear.y * orb.rear * geometryScale + side.y * orb.side * geometryScale);
    drawTruncatedRearSphere(ctx, orbX, orbY, smallOrbRadius, rear, colors, [mainOccluder]);
  }

  drawSphere(ctx, x, y, mainRadius, bodyAngle, colors);

  for (const orb of REAR_ORBS.filter((candidate) => candidate.layer === "front")) {
    const orbX = Math.round(x + rear.x * orb.rear * geometryScale + side.x * orb.side * geometryScale);
    const orbY = Math.round(y + rear.y * orb.rear * geometryScale + side.y * orb.side * geometryScale);
    drawTruncatedRearSphere(ctx, orbX, orbY, smallOrbRadius, rear, colors);
  }

  drawMiningRayEmitters(ctx, player, camera, asteroid, colors, freezeAuxiliaryAim);

  drawShipHealthIndicator(ctx, x, y, player, colors);
  drawShipStormWarning(ctx, x, y, player, colors, textRenderer);
}

function drawMiningRayEmitters(ctx, player, camera, asteroid, colors, freezeAim = false) {
  if (player.alive === false) {
    return;
  }

  const count = miningRayVisualCount(player);
  if (count <= 1) {
    return;
  }

  const angle = freezeAim
    ? player.angle ?? player.aimAngle ?? 0
    : player.aimAngle ?? player.angle ?? 0;
  const fallbackDirection = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const effects = aggregateUpgradeEffects(player.upgrades);
  const rayLength = ENGINE.mining.rayLength + effects.rayLengthBonus;
  const geometryScale = shipGeometryScaleForRadius(shipMainRadius(player));
  const emitterLength = MINING_RAY_EMITTER_LENGTH * geometryScale;
  const emitterRadius = Math.max(0.5, MINING_RAY_EMITTER_RADIUS * geometryScale);
  const lanes = miningRayLanesForPlayer(player, angle, rayLength)
    .map((lane) => clipRenderMiningRayLaneStart(player, asteroid, lane, angle))
    .filter((lane) => lane.offset !== 0);

  for (const lane of lanes) {
    const direction = miningRayLaneDirection(lane, fallbackDirection);
    const normal = {
      x: -direction.y,
      y: direction.x
    };
    const front = worldToScreen({ x: lane.startX, y: lane.startY }, camera);
    const rear = {
      x: front.x - direction.x * emitterLength,
      y: front.y - direction.y * emitterLength
    };
    drawSideMiningRayEmitter(
      ctx,
      rear,
      front,
      normal,
      lane.offset,
      emitterRadius,
      colors
    );
  }
}

function drawShipStormWarning(ctx, x, y, player, colors, textRenderer) {
  if (player.alive === false || !player.stormWarning || !textRenderer) {
    return;
  }

  const textOptions = {
    fontSize: 8,
    color: colors.foreground
  };
  const warning = String(player.stormWarning).slice(0, 3);
  const width = textRenderer.measure(warning, textOptions);
  const hasDownComponent = Math.sin(player.angle ?? 0) > 0;
  const warningY = hasDownComponent ? y + player.radius + 2 : y - player.radius - 9;
  const warningX = Math.round(x - width / 2);
  const drawOptions = {
    ...textOptions,
    width: width + 2
  };
  for (const offset of STORM_WARNING_BUFFER_OFFSETS) {
    textRenderer.draw(ctx, warning, warningX + offset.x, warningY + offset.y, {
      ...drawOptions,
      color: colors.background
    });
  }
  textRenderer.draw(ctx, warning, warningX, warningY, {
    ...drawOptions,
    color: colors.foreground
  });
}

function drawShipHealthIndicator(ctx, x, y, player, colors) {
  const maxHealth = Math.max(1, player.maxHealth || ENGINE.player.maxHealth);
  const health = clamp(player.health ?? maxHealth, 0, maxHealth);
  if (health <= 0) {
    return;
  }

  ctx.fillStyle = colors.foreground;

  const healthRatio = clamp(health / maxHealth, 0, 1);
  const healthBars = clamp(
    Math.round(player.healthBars || maxHealth / ENGINE.player.healthPerBar || ENGINE.player.startingHealthBars),
    1,
    ENGINE.player.maxHealthBars
  );
  const radius = Math.max(3, Math.floor(player.radius * 0.58));
  const depletedAngle = (1 - healthRatio) * Math.PI * 2;
  const segmentAngle = (Math.PI * 2) / healthBars;
  const gapPixels = 0.72;
  const minX = x - radius - 1;
  const maxX = x + radius + 1;
  const minY = y - radius - 1;
  const maxY = y + radius + 1;
  let drewPoint = false;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - x;
      const dy = py - y;
      if (Math.abs(Math.hypot(dx, dy) - radius) > 0.5) {
        continue;
      }

      const clockwiseAngle = positiveModulo(Math.atan2(dy, dx) + Math.PI / 2, Math.PI * 2);
      if (clockwiseAngle < depletedAngle) {
        continue;
      }

      const segmentPosition = positiveModulo(clockwiseAngle, segmentAngle);
      const boundaryDistance = Math.min(segmentPosition, segmentAngle - segmentPosition);
      if (healthBars > 1 && boundaryDistance * radius <= gapPixels) {
        continue;
      }

      drawPoint(ctx, px, py);
      drewPoint = true;
    }
  }

  if (!drewPoint) {
    const fallbackAngle = depletedAngle + (healthRatio * Math.PI);
    const fallbackX = Math.round(x + Math.sin(fallbackAngle) * radius);
    const fallbackY = Math.round(y - Math.cos(fallbackAngle) * radius);
    drawPoint(ctx, fallbackX, fallbackY);
  }
}

function drawTalkBubble(ctx, player, camera, colors, textRenderer) {
  if (!player.talk) {
    return;
  }

  const screen = worldToScreen(player, camera);
  const maxTextWidth = 160;
  const lines = wrapPixelText(player.talk, maxTextWidth, textRenderer, {
    fontSize: 10
  }).slice(0, 3);
  const lineHeight = 16;
  const textWidth = Math.max(...lines.map((line) => textRenderer.measure(line, { fontSize: 10 })));
  const width = Math.min(maxTextWidth + 8, textWidth + 8);
  const height = lines.length * lineHeight + 6;
  const x = clamp(Math.round(screen.x - width / 2), 2, ctx.width - width - 2);
  const y = clamp(Math.round(screen.y - player.radius - height - 9), 2, ctx.height - height - 2);

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, height);
  ctx.fillRect(Math.round(screen.x) - 1, y + height, 3, 2);
  ctx.fillRect(Math.round(screen.x), y + height + 2, 1, 1);
  ctx.fillStyle = colors.background;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);
  textRenderer.draw(ctx, "", x + 4, y + 3, {
    lines,
    width: width - 8,
    fontSize: 10,
    lineHeight,
    color: colors.foreground
  });
}

function drawChatOverlay(ctx, chat, colors, textRenderer, timeSeconds) {
  if (!chat?.active) {
    return;
  }

  const panelX = 10;
  const panelY = ctx.height - 43;
  const panelWidth = ctx.width - panelX * 2;
  const panelHeight = 33;
  const prompt = "type to talk, enter to send";
  const draft = chat.draft || "";
  const shownDraft = draft || " ";

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.fillStyle = colors.background;
  ctx.fillRect(panelX + 1, panelY + 1, panelWidth - 2, panelHeight - 2);
  textRenderer.draw(ctx, prompt, panelX + 5, panelY + 4, {
    fontSize: 8,
    color: colors.foreground
  });
  textRenderer.draw(ctx, shownDraft, panelX + 5, panelY + 17, {
    fontSize: 10,
    color: colors.foreground,
    width: panelWidth - 10,
    selectionStart: chat.selectionStart ?? chat.caret ?? 0,
    selectionEnd: chat.selectionEnd ?? chat.caret ?? 0,
    selectionBackground: colors.foreground,
    selectionColor: colors.background
  });

  if (Math.floor(timeSeconds * 2) % 2 === 0) {
    const beforeCaret = draft.slice(0, chat.caret ?? draft.length);
    const caretX = panelX + 5 + textRenderer.measure(beforeCaret, { fontSize: 10 });
    ctx.fillStyle = colors.foreground;
    ctx.fillRect(clamp(caretX, panelX + 5, panelX + panelWidth - 7), panelY + 17, 2, 14);
  }
}

function drawControllerCursor(ctx, cursor, colors) {
  if (!cursor) {
    return;
  }

  const x = Math.round(cursor.x);
  const y = Math.round(cursor.y);
  ctx.fillStyle = colors.background;
  fillSolidDisk(ctx, x, y, 5);
  ctx.fillStyle = colors.foreground;
  drawCircle(ctx, x, y, 5);
  fillSolidDisk(ctx, x, y, 1);
}

function drawControllerAimCursor(ctx, player, camera, cursor, colors) {
  if (!player || player.alive === false || !cursor) {
    return;
  }

  const cursorDistance = Number(cursor.distance);
  const cursorAngle = Number(cursor.angle);
  const distance = Number.isFinite(cursorDistance) && cursorDistance > 0
    ? cursorDistance
    : Number(player.radius ?? ENGINE.ship.radius ?? 0) + ENGINE.mining.rayLength;
  const angle = Number.isFinite(cursorAngle)
    ? cursorAngle
    : player.aimAngle ?? player.angle ?? 0;
  const point = worldToScreen({
    x: player.x + Math.cos(angle) * distance,
    y: player.y + Math.sin(angle) * distance
  }, camera);
  const x = Math.round(point.x);
  const y = Math.round(point.y);

  ctx.fillStyle = colors.background;
  fillSolidDisk(ctx, x, y, 4);
  ctx.fillStyle = colors.foreground;
  drawCircle(ctx, x, y, 4);
  fillSolidDisk(ctx, x, y, 1);
}

function drawPlayerHud(ctx, player, colors, textRenderer, hudFlash = {}, timeSeconds = 0, playersLeft = 0, layout = {}) {
  if (!player) {
    return null;
  }

  const header = String(layout.header || "").trim().toUpperCase();
  const headerOffset = header ? HUD_PANEL_ROW_STEP : 0;
  const width = HUD_PANEL_MIN_WIDTH;
  const height = 58 + headerOffset;
  const panel = mainHudPanelRect(ctx, width, height);
  if (Number.isFinite(layout.x)) {
    panel.x = Math.round(layout.x);
  }
  if (Number.isFinite(layout.y)) {
    panel.y = Math.round(layout.y);
  }
  const x = panel.x;
  const y = panel.y;
  const padding = HUD_PANEL_PADDING;
  const contentX = x + padding;
  const contentRight = x + width - padding;
  const hpY = y + padding + headerOffset;
  const rowY = y + 18 + headerOffset;
  const rowStep = HUD_PANEL_ROW_STEP;
  const hp = clamp(player.health ?? 0, 0, player.maxHealth || 1);
  const maxHp = Math.max(1, player.maxHealth || 1);
  const healthBars = clamp(
    Math.round(player.healthBars || maxHp / ENGINE.player.healthPerBar || ENGINE.player.startingHealthBars),
    1,
    ENGINE.player.maxHealthBars
  );
  const resources = player.resources || {};
  const killDropAmount = Math.max(0, Math.floor(Number(player.killDrop?.amount || 0)));

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);

  if (header) {
    textRenderer.draw(ctx, header, contentX, y + padding, {
      fontSize: 8,
      color: colors.foreground,
      width: contentRight - contentX
    });
  }

  textRenderer.draw(ctx, "HP", contentX, hpY, {
    fontSize: 8,
    color: colors.foreground
  });
  drawHudHealthBars(ctx, x + 22, hpY + 1, contentRight - (x + 22), 5, hp, maxHp, healthBars, colors);

  drawHudResource(ctx, "ROCK", resources.rock || 0, contentX, contentRight, rowY, textRenderer, colors, {
    flash: hudFlash.rock,
    timeSeconds
  });
  drawHudResource(ctx, "ORE", resources.ore || 0, contentX, contentRight, rowY + rowStep, textRenderer, colors);
  drawHudResource(ctx, "DIAMOND", resources.diamond || 0, contentX, contentRight, rowY + rowStep * 2, textRenderer, colors);
  if (killDropAmount > 0) {
    if (hudFlashVisible(true, timeSeconds, {
      mode: HUD_FLASH_MODE.additive,
      rate: HUD_FLASH_RATE.slow
    })) {
      drawHudMessage(ctx, `${killDropAmount} DIAMOND${killDropAmount === 1 ? "" : "S"}`, contentX, rowY + rowStep * 3, textRenderer, colors);
    }
    return panel;
  }

  drawHudKillRow(ctx, player.kills || 0, playersLeft, contentX, contentRight, rowY + rowStep * 3, textRenderer, colors);
  return panel;
}

function mainHudPanelRect(ctx, width, height) {
  return {
    x: 8,
    y: 8,
    width,
    height
  };
}

function hudPanelHeightForRows(rowCount) {
  return HUD_PANEL_PADDING * 2 +
    HUD_PANEL_TEXT_HEIGHT +
    Math.max(0, Math.floor(rowCount) - 1) * HUD_PANEL_ROW_STEP;
}

function drawUpgradeHud(ctx, player, upgradesUi, colors, textRenderer, controllerActive = false, mobileActive = false) {
  if (!player) {
    return;
  }

  if (!upgradesUi?.active) {
    if (mobileActive) {
      drawMobileHudAction(ctx, "UPGRADES", 10, 74, colors, textRenderer);
      return;
    }

    if (controllerActive) {
      drawControllerHudAction(ctx, "faceTop", "UPGRADES", 10, 74, colors, textRenderer);
      return;
    }

    textRenderer.draw(ctx, "Q - UPGRADES", 10, 74, {
      fontSize: 8,
      color: colors.foreground,
      ...HUD_CONTROL_TEXT_BORDER
    });
    return;
  }

  drawUpgradeMenu(ctx, player, upgradesUi, colors, textRenderer, controllerActive, mobileActive);
}

function drawBuildHud(ctx, player, buildUi, upgradesUi, colors, textRenderer, controllerActive = false, mobileActive = false) {
  if (!player || upgradesUi?.active) {
    return;
  }

  if (mobileActive) {
    drawMobileHudAction(ctx, buildUi?.active ? "MINING RAY" : "BUILDER ARM", 10, 88, colors, textRenderer);
    return;
  }

  if (controllerActive) {
    drawControllerHudAction(
      ctx,
      "faceLeft",
      buildUi?.active ? "MINING RAY" : "BUILDER ARM",
      10,
      92,
      colors,
      textRenderer
    );
    return;
  }

  textRenderer.draw(ctx, buildUi?.active ? "E - MINING RAY" : "E - BUILDER ARM", 10, 88, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER
  });
}

function drawMapHud(ctx, player, upgradesUi, colors, textRenderer, controllerActive = false, mobileActive = false, mapFeatureEnabled = true) {
  if (!mapFeatureEnabled || !player || upgradesUi?.active) {
    return;
  }

  if (mobileActive) {
    drawMobileHudAction(ctx, "MAP", 10, 102, colors, textRenderer);
    return;
  }

  if (controllerActive) {
    drawControllerDpadHudAction(ctx, "dpadUp", "MAP", 10, 110, colors, textRenderer);
    return;
  }

  textRenderer.draw(ctx, "M - MAP", 10, 102, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER
  });
}

function drawMobileLeaveHud(ctx, player, options, colors, textRenderer) {
  if (!options.mobileActive || !player || options.upgrades?.active || options.build?.active || options.leaveConfirm?.active) {
    return;
  }

  drawMobileHudAction(ctx, "LEAVE", 10, 116, colors, textRenderer);
}

function drawUpgradeMenu(ctx, player, upgradesUi, colors, textRenderer, controllerActive = false, mobileActive = false) {
  const layout = upgradeMenuLayout(textRenderer, controllerActive, mobileActive);
  const { panel, metrics } = layout;
  const resources = player.resources || {};
  const selectedIndex = Number.isInteger(upgradesUi.selectedIndex)
    ? clamp(upgradesUi.selectedIndex, 0, UPGRADE_DEFINITIONS.length - 1)
    : null;

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(panel.x + 1, panel.y + 1, panel.width - 2, panel.height - 2);

  textRenderer.draw(ctx, "UPGRADES", layout.contentX, layout.titleY, {
    fontSize: 8,
    color: colors.foreground
  });

  for (let index = 0; index < UPGRADE_DEFINITIONS.length; index += 1) {
    const definition = UPGRADE_DEFINITIONS[index];
    const level = upgradeLevel(player.upgrades, definition.id);
    const cost = nextUpgradeCost(player.upgrades, definition.id);
    const affordable = canAffordUpgrade(resources, cost);
    const selected = index === selectedIndex;
    const rowY = layout.rowTop + index * UPGRADE_MENU_LAYOUT.rowHeight;
    const rowTextY = rowY + UPGRADE_MENU_LAYOUT.rowTextInset;
    const levelText = `${level}/${definition.maxLevel}`;
    const levelWidth = textRenderer.measure(levelText, { fontSize: 8 });

    if (selected) {
      ctx.fillStyle = colors.foreground;
      ctx.fillRect(
        layout.rowX - UPGRADE_MENU_LAYOUT.rowHighlightPadding,
        rowY,
        layout.rowRight - layout.rowX + UPGRADE_MENU_LAYOUT.rowHighlightPadding * 2,
        UPGRADE_MENU_LAYOUT.rowHeight
      );
    }

    if (affordable) {
      textRenderer.draw(ctx, "+", layout.rowX, rowTextY, {
        fontSize: 8,
        color: selected ? colors.background : colors.foreground,
        width: 10
      });
    }

    textRenderer.draw(ctx, definition.label, layout.labelX, rowTextY, {
      fontSize: 8,
      color: selected ? colors.background : colors.foreground,
      width: metrics.tableColumns.labelWidth + 1
    });
    textRenderer.draw(ctx, levelText, layout.levelRight - levelWidth, rowTextY, {
      fontSize: 8,
      color: selected ? colors.background : colors.foreground,
      width: levelWidth + 1
    });
  }

  const selectedDefinition = selectedIndex === null ? null : UPGRADE_DEFINITIONS[selectedIndex];
  const selectedLevel = upgradeLevel(player.upgrades, selectedDefinition?.id);
  const selectedUpgradeLevel = selectedDefinition?.levels[selectedLevel];
  const selectedCost = nextUpgradeCost(player.upgrades, selectedDefinition?.id);
  const affordable = canAffordUpgrade(resources, selectedCost);
  const currentText = currentUpgradeStatText(selectedDefinition, selectedLevel);
  const nextText = selectedUpgradeLevel?.effectText || "MAX LEVEL";
  const costText = selectedCost
    ? `COST: ${formatUpgradeCostLong(selectedCost)}`
    : "COST: MAX LEVEL";
  const actionText = selectedCost
    ? affordable ? controllerActive ? "SELECT BUY" : mobileActive ? "TAP BUY" : "CLICK BUY" : "NEED RESOURCES"
    : "MAXED";

  UPGRADE_MENU_DIVIDER.draw(ctx, panel, layout.dividerY, colors);
  textRenderer.draw(ctx, "", layout.contentX, layout.detailY, {
    lines: selectedDefinition
      ? [
          `CURRENT: ${currentText}`,
          `NEXT: ${nextText}`,
          costText,
          actionText
        ]
      : ["HOVER UPGRADE TO SEE DETAILS", "", "", ""],
    fontSize: 8,
    lineHeight: UPGRADE_MENU_LAYOUT.detailLineHeight,
    color: colors.foreground,
    width: layout.contentWidth
  });

  if (mobileActive) {
    drawMobileUpgradeCloseAction(ctx, panel, colors, textRenderer);
  }
}

function drawMobileHudAction(ctx, label, x, y, colors, textRenderer) {
  textRenderer.draw(ctx, label, x, y + 2, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER,
    width: 120
  });
}

function drawMobileUpgradeCloseAction(ctx, panel, colors, textRenderer) {
  drawMobileHudAction(
    ctx,
    "CLOSE",
    panel.x + 2,
    panel.y + panel.height + MOBILE_UPGRADE_CLOSE_ACTION.gap,
    colors,
    textRenderer
  );
}

function drawControllerHudAction(ctx, buttonPosition, label, x, y, colors, textRenderer) {
  const rowCenterY = y + 5;
  const labelY = y + 2;

  drawControllerFaceButtons(ctx, x + 7, rowCenterY, buttonPosition, colors);
  textRenderer.draw(ctx, label, x + 19, labelY, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER,
    width: 120
  });
}

function drawControllerDpadHudAction(ctx, buttonPosition, label, x, y, colors, textRenderer) {
  const rowCenterY = y + 5;
  const labelY = y + 2;

  drawControllerDpadButtons(ctx, x + 7, rowCenterY, buttonPosition, colors);
  textRenderer.draw(ctx, label, x + 19, labelY, {
    fontSize: 8,
    color: colors.foreground,
    ...HUD_CONTROL_TEXT_BORDER,
    width: 120
  });
}

function drawControllerFaceButtons(ctx, cx, cy, selectedPosition, colors) {
  const buttons = [
    { position: "faceTop", x: 0, y: -4 },
    { position: "faceRight", x: 4, y: 0 },
    { position: "faceBottom", x: 0, y: 4 },
    { position: "faceLeft", x: -4, y: 0 }
  ];

  for (const button of buttons) {
    const x = Math.round(cx + button.x);
    const y = Math.round(cy + button.y);
    drawControllerButtonGlyph(ctx, x, y, button.position === selectedPosition, colors);
  }
}

function drawControllerDpadButtons(ctx, cx, cy, selectedPosition, colors) {
  const x = Math.round(cx);
  const y = Math.round(cy);
  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x - 2, y - 6, 5, 13);
  ctx.fillRect(x - 6, y - 2, 13, 5);
  ctx.fillStyle = colors.background;
  ctx.fillRect(x - 1, y - 5, 3, 11);
  ctx.fillRect(x - 5, y - 1, 11, 3);

  ctx.fillStyle = colors.foreground;
  if (selectedPosition === "dpadUp") {
    ctx.fillRect(x - 1, y - 5, 3, 3);
  } else if (selectedPosition === "dpadRight") {
    ctx.fillRect(x + 3, y - 1, 3, 3);
  } else if (selectedPosition === "dpadDown") {
    ctx.fillRect(x - 1, y + 3, 3, 3);
  } else if (selectedPosition === "dpadLeft") {
    ctx.fillRect(x - 5, y - 1, 3, 3);
  }
}

function drawControllerButtonGlyph(ctx, x, y, selected, colors) {
  ctx.fillStyle = colors.background;
  ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = colors.foreground;
  if (selected) {
    drawControllerPressedGlyph(ctx, x, y);
    return;
  }

  ctx.fillRect(x - 1, y, 1, 1);
  ctx.fillRect(x + 1, y, 1, 1);
  ctx.fillRect(x, y - 1, 1, 1);
  ctx.fillRect(x, y + 1, 1, 1);
}

function drawControllerPressedGlyph(ctx, x, y) {
  ctx.fillRect(x - 1, y - 2, 3, 1);
  ctx.fillRect(x - 2, y - 1, 5, 3);
  ctx.fillRect(x - 1, y + 2, 3, 1);
}

function measurePixelTableColumns(rows, textRenderer, options = {}) {
  return rows.reduce((columns, row) => ({
    labelWidth: Math.max(columns.labelWidth, textRenderer.measure(row.label, options)),
    levelWidth: Math.max(columns.levelWidth, textRenderer.measure(row.level, options))
  }), {
    labelWidth: 0,
    levelWidth: 0
  });
}

function upgradeMenuMetrics(textRenderer, controllerActive = false, mobileActive = false) {
  const textOptions = { fontSize: 8 };
  const tableColumns = measurePixelTableColumns(
    UPGRADE_DEFINITIONS.map((definition) => ({
      label: definition.label,
      level: `0/${definition.maxLevel}`
    })),
    textRenderer,
    textOptions
  );
  const baseRowWidth = UPGRADE_MENU_LAYOUT.labelOffset +
    tableColumns.labelWidth +
    UPGRADE_MENU_LAYOUT.columnGap +
    tableColumns.levelWidth;
  const detailWidth = Math.max(...upgradeMenuDetailLines(controllerActive, mobileActive).map((line) =>
    textRenderer.measure(line, textOptions)
  ));
  const titleWidth = textRenderer.measure("UPGRADES", textOptions);
  const width = Math.ceil(Math.max(
    titleWidth + UPGRADE_MENU_LAYOUT.padding * 2,
    baseRowWidth + UPGRADE_MENU_LAYOUT.rowInset * 2,
    detailWidth + UPGRADE_MENU_LAYOUT.padding * 2
  ));
  const rowWidth = width - UPGRADE_MENU_LAYOUT.rowInset * 2;
  const expandedTableColumns = expandPixelTableColumns(tableColumns, rowWidth);

  return {
    width,
    rowWidth,
    tableColumns: expandedTableColumns
  };
}

function upgradeMenuLayout(textRenderer, controllerActive = false, mobileActive = false) {
  const metrics = upgradeMenuMetrics(textRenderer, controllerActive, mobileActive);
  const panel = {
    x: UPGRADE_MENU_LAYOUT.x,
    y: UPGRADE_MENU_LAYOUT.y,
    width: metrics.width,
    height: 0
  };
  const contentX = panel.x + UPGRADE_MENU_LAYOUT.padding;
  const contentWidth = panel.width - UPGRADE_MENU_LAYOUT.padding * 2;
  const titleY = panel.y + UPGRADE_MENU_LAYOUT.titleTop;
  const rowX = panel.x + UPGRADE_MENU_LAYOUT.rowInset;
  const rowRight = rowX + metrics.rowWidth;
  const rowTop = panel.y + UPGRADE_MENU_LAYOUT.rowTopOffset;
  const labelX = rowX + UPGRADE_MENU_LAYOUT.labelOffset;
  const levelRight = rowRight;
  const lastRowTop = rowTop +
    Math.max(0, UPGRADE_DEFINITIONS.length - 1) * UPGRADE_MENU_LAYOUT.rowHeight;
  const rowsBottom = lastRowTop + UPGRADE_MENU_LAYOUT.rowHeight;
  const dividerY = rowsBottom + UPGRADE_MENU_LAYOUT.dividerTopGap;
  const detailY = dividerY + UPGRADE_MENU_DIVIDER.thickness + UPGRADE_MENU_LAYOUT.dividerBottomGap;
  const detailHeight = UPGRADE_MENU_LAYOUT.rowTextHeight +
    Math.max(0, UPGRADE_MENU_LAYOUT.detailLineCount - 1) * UPGRADE_MENU_LAYOUT.detailLineHeight;

  panel.height = detailY - panel.y + detailHeight + UPGRADE_MENU_LAYOUT.bottomPadding;

  return {
    panel,
    metrics,
    contentX,
    contentWidth,
    titleY,
    rowX,
    rowRight,
    rowTop,
    labelX,
    levelRight,
    dividerY,
    detailY
  };
}

function expandPixelTableColumns(columns, rowWidth) {
  const expandedLabelWidth = Math.max(
    columns.labelWidth,
    rowWidth - UPGRADE_MENU_LAYOUT.labelOffset - UPGRADE_MENU_LAYOUT.columnGap - columns.levelWidth
  );

  return {
    ...columns,
    labelWidth: expandedLabelWidth
  };
}

function upgradeMenuDetailLines(controllerActive = false, mobileActive = false) {
  const lines = new Set([
    "COST: MAX LEVEL",
    "MAXED",
    "NEED RESOURCES",
    controllerActive ? "SELECT BUY" : mobileActive ? "TAP BUY" : "CLICK BUY"
  ]);

  for (const definition of UPGRADE_DEFINITIONS) {
    lines.add(`CURRENT: ${definition.baseStatText || "BASE"}`);
    lines.add("NEXT: MAX LEVEL");
    for (const level of definition.levels || []) {
      lines.add(`CURRENT: ${level.effectText || definition.baseStatText || "BASE"}`);
      lines.add(`NEXT: ${level.effectText || "MAX LEVEL"}`);
      lines.add(`COST: ${formatUpgradeCostLong(level.cost)}`);
    }
  }

  return Array.from(lines);
}

function currentUpgradeStatText(definition, level) {
  if (!definition) {
    return "";
  }

  if (level <= 0) {
    return definition.baseStatText || "BASE";
  }

  return definition.levels[level - 1]?.effectText || definition.baseStatText || "BASE";
}

function formatUpgradeCostLong(cost) {
  if (!cost) {
    return "MAX";
  }

  const parts = [];
  if (cost.rock) {
    parts.push(`${cost.rock} ROCK`);
  }
  if (cost.ore) {
    parts.push(`${cost.ore} ORE`);
  }
  if (cost.diamond) {
    parts.push(`${cost.diamond} DIAMOND`);
  }

  return parts.join(" ");
}

function drawHudHealthBars(ctx, x, y, width, height, health, maxHealth, bars, colors) {
  const gap = 1;
  const usableWidth = Math.max(bars, Math.floor(width) - gap * (bars - 1));
  const segmentHealth = maxHealth / bars;

  for (let index = 0; index < bars; index += 1) {
    const segmentStart = Math.floor((usableWidth * index) / bars);
    const segmentEnd = Math.floor((usableWidth * (index + 1)) / bars);
    const segmentX = x + segmentStart + gap * index;
    const segmentWidth = Math.max(1, segmentEnd - segmentStart);
    const segmentProgress = clamp((health - segmentHealth * index) / segmentHealth, 0, 1);
    const fillWidth = Math.max(0, Math.round((segmentWidth - 2) * segmentProgress));

    ctx.fillStyle = colors.foreground;
    ctx.fillRect(segmentX, y, segmentWidth, 1);
    ctx.fillRect(segmentX, y + height - 1, segmentWidth, 1);
    ctx.fillRect(segmentX, y, 1, height);
    ctx.fillRect(segmentX + segmentWidth - 1, y, 1, height);
    if (fillWidth > 0) {
      ctx.fillRect(segmentX + 1, y + 1, fillWidth, height - 2);
    }
  }
}

function drawHudResource(ctx, label, value, labelX, countRight, y, textRenderer, colors, options = {}) {
  const count = String(Math.min(ENGINE.player.maxResourceAmount, Math.max(0, Math.floor(value))));
  const textOptions = { fontSize: 8 };
  const countWidth = textRenderer.measure(count, textOptions);
  if (!hudFlashVisible(options.flash, options.timeSeconds, {
    mode: HUD_FLASH_MODE.subtractive,
    rate: HUD_FLASH_RATE.fast
  })) {
    return;
  }

  textRenderer.draw(ctx, label, labelX, y, {
    fontSize: 8,
    color: colors.foreground,
    width: 60
  });
  textRenderer.draw(ctx, count, countRight - countWidth, y, {
    fontSize: 8,
    color: colors.foreground,
    width: countWidth + 1
  });
}

function hudFlashVisible(active, timeSeconds, options = {}) {
  const mode = options.mode || HUD_FLASH_MODE.additive;
  const enabled = Boolean(active);
  if (!enabled) {
    return mode === HUD_FLASH_MODE.subtractive;
  }

  const rate = Math.max(1, Number(options.rate || HUD_FLASH_RATE.slow));
  return Math.floor((timeSeconds || 0) * rate) % 2 === 1;
}

function drawHudKillRow(ctx, kills, playersLeft, labelX, countRight, y, textRenderer, colors) {
  const textOptions = { fontSize: 8 };
  const killCount = Math.min(999, Math.max(0, Math.floor(Number(kills) || 0)));
  const leftCount = Math.min(999, Math.max(0, Math.floor(Number(playersLeft) || 0)));
  const text = `${killCountLabel(killCount)} / ${leftCount} ALIVE`;
  const width = textRenderer.measure(text, textOptions);

  textRenderer.draw(ctx, text, labelX, y, {
    fontSize: 8,
    color: colors.foreground,
    width: Math.min(width + 1, countRight - labelX)
  });
}

function drawHudMessage(ctx, text, x, y, textRenderer, colors) {
  textRenderer.draw(ctx, text, x, y, {
    fontSize: 8,
    color: colors.foreground,
    width: 96
  });
}

function wrapPixelText(text, maxWidth, textRenderer, options) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (textRenderer.measure(nextLine, options) <= maxWidth) {
      line = nextLine;
      continue;
    }

    if (line) {
      lines.push(line);
      line = "";
    }

    if (textRenderer.measure(word, options) <= maxWidth) {
      line = word;
    } else {
      const chunks = breakPixelWord(word, maxWidth, textRenderer, options);
      lines.push(...chunks.slice(0, -1));
      line = chunks[chunks.length - 1] || "";
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [""];
}

function breakPixelWord(word, maxWidth, textRenderer, options) {
  const chunks = [];
  let chunk = "";

  for (const character of word) {
    const nextChunk = `${chunk}${character}`;
    if (textRenderer.measure(nextChunk, options) <= maxWidth || !chunk) {
      chunk = nextChunk;
    } else {
      chunks.push(chunk);
      chunk = character;
    }
  }

  if (chunk) {
    chunks.push(chunk);
  }

  return chunks;
}

function emitThrusterParticles(state, player, dtSeconds) {
  const basis = thrusterParticleBasis(player);
  if (!basis) {
    return;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const { rear, side } = basis;
  const origins = rearEnginePlumeOrigins(player, rear, side);
  const key = player.id || String(player.number);
  const particleMultiplier = effects.thrusterParticleMultiplier;
  const engineRamp = thrusterEngineRamp(player);
  const turnIntensity = Number.isFinite(basis.intensity)
    ? clamp(basis.intensity, 0, 1)
    : 1;
  if (turnIntensity <= 0.0001) {
    return;
  }

  for (let originIndex = 0; originIndex < origins.length; originIndex += 1) {
    const origin = origins[originIndex];
    const originKey = `${key}:thruster:${originIndex}`;
    const carry =
      (state.emitCarry.get(originKey) || 0) +
      (THRUSTER_PARTICLE_RATE * particleMultiplier * engineRamp.rate * turnIntensity * dtSeconds) / origins.length;
    const count = Math.floor(carry);
    state.emitCarry.set(originKey, carry - count);

    for (let index = 0; index < count; index += 1) {
      const seed = state.nextSeed();
      const nozzleWidth = Math.max(2, (origin.nozzleWidth || 0) * engineRamp.nozzle);
      const nozzleRadius = nozzleWidth * 0.5;
      const sideJitter = sampleProjectedNozzleOffset(seed, nozzleRadius);
      const sideRatio = clamp(Math.abs(sideJitter) / Math.max(1, nozzleRadius), 0, 1);
      const capOffset = 1 + sideRatio * sideRatio * Math.max(1, nozzleRadius * 0.7);
      const rearJitter = randomUnit(seed, 2) * 0.9;
      const speed = (92 + randomUnit(seed, 3) * 90) * Math.sqrt(particleMultiplier) * engineRamp.plumeSpeed;
      const spread = (randomUnit(seed, 4) - 0.5) * 10 * Math.sqrt(particleMultiplier);
      const localHeat = 1 - clamp(Math.abs(sideJitter) / (nozzleWidth * 0.5), 0, 1);
      const medialOffset = (origin.medialOffset || 0) + sideJitter;
      const medialHeatLinear = 1 - clamp(Math.abs(medialOffset) / Math.max(1, origin.medialRadius || 1), 0, 1);
      const medialHeat = medialHeatLinear * medialHeatLinear * medialHeatLinear;
      const centerHeat = localHeat * 0.5 + medialHeat * 0.5;
      const life =
        (0.05 + centerHeat * 0.68 + randomUnit(seed, 5) * (0.1 + centerHeat * 0.3)) *
        engineRamp.life;

      state.particles.push({
        x: origin.x + side.x * sideJitter + rear.x * (capOffset + rearJitter),
        y: origin.y + side.y * sideJitter + rear.y * (capOffset + rearJitter),
        vx: (player.vx || 0) + rear.x * speed + side.x * spread,
        vy: (player.vy || 0) + rear.y * speed + side.y * spread,
        age: randomUnit(seed, 6) * 0.025,
        life,
        seed
      });
    }
  }
}

function sampleProjectedNozzleOffset(seed, radius) {
  const distance = Math.sqrt(randomUnit(seed, 1)) * radius;
  const angle = randomUnit(seed, 9) * Math.PI * 2;
  return Math.cos(angle) * distance;
}

function thrusterEngineRamp(player) {
  const level = clamp(
    upgradeLevel(player?.upgrades, THRUSTER_ENGINE_UPGRADE_ID),
    0,
    THRUSTER_ENGINE_MAX_LEVEL
  );
  const t = THRUSTER_ENGINE_MAX_LEVEL > 0 ? level / THRUSTER_ENGINE_MAX_LEVEL : 0;

  return {
    rate: lerp(THRUSTER_ENGINE_RAMP.rateMin, THRUSTER_ENGINE_RAMP.rateMax, t),
    plumeSpeed: lerp(THRUSTER_ENGINE_RAMP.plumeSpeedMin, THRUSTER_ENGINE_RAMP.plumeSpeedMax, t),
    life: lerp(THRUSTER_ENGINE_RAMP.lifeMin, THRUSTER_ENGINE_RAMP.lifeMax, t),
    nozzle: lerp(THRUSTER_ENGINE_RAMP.nozzleMin, THRUSTER_ENGINE_RAMP.nozzleMax, t)
  };
}

function thrusterParticleBasis(player) {
  const rawMoveX = Number(player?.moveX ?? player?.input?.moveX);
  const rawMoveY = Number(player?.moveY ?? player?.input?.moveY);
  const moveX = Number.isFinite(rawMoveX) ? rawMoveX : 0;
  const moveY = Number.isFinite(rawMoveY) ? rawMoveY : 0;
  const moveMagnitude = Math.hypot(moveX, moveY);
  if (moveMagnitude <= 0.0001) {
    return null;
  }

  const visualAngle = shipVisualAngle(player);
  const forward = {
    x: Math.cos(visualAngle),
    y: Math.sin(visualAngle)
  };
  const intended = {
    x: moveX / moveMagnitude,
    y: moveY / moveMagnitude
  };
  const intensity = clamp(forward.x * intended.x + forward.y * intended.y, 0, 1);
  return {
    rear: {
      x: -forward.x,
      y: -forward.y
    },
    side: {
      x: -forward.y,
      y: forward.x
    },
    intensity
  };
}

function emitMiningParticles(state, player, dtSeconds) {
  const ray = player.miningRay;
  const hitLanes = miningRayRenderableLanes(ray).filter((lane) => lane.hit);
  if (hitLanes.length <= 0) {
    return;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const fallbackDirection = {
    x: Math.cos(player.aimAngle ?? player.angle),
    y: Math.sin(player.aimAngle ?? player.angle)
  };
  const key = `mine:${player.id || player.number}`;
  const carry =
    (state.emitCarry.get(key) || 0) +
    MINING_PARTICLE_RATE * effects.miningParticleMultiplier * dtSeconds;
  const count = Math.floor(carry);
  state.emitCarry.set(key, carry - count);

  for (let index = 0; index < count; index += 1) {
    const seed = state.nextSeed();
    const sideJitter = (randomUnit(seed, 1) - 0.5) * 7;
    const impactJitter = randomUnit(seed, 2) * 3;
    const speed = 22 + randomUnit(seed, 3) * 58;
    const spread = (randomUnit(seed, 4) - 0.5) * 48;
    const life = 0.16 + randomUnit(seed, 5) * 0.34;
    const lane = hitLanes[Math.floor(randomUnit(seed, 7) * hitLanes.length)] || hitLanes[0];
    const direction = miningRayLaneDirection(lane, fallbackDirection);
    const normal = {
      x: -direction.y,
      y: direction.x
    };

    state.miningParticles.push({
      x: lane.endX - direction.x * impactJitter + normal.x * sideJitter,
      y: lane.endY - direction.y * impactJitter + normal.y * sideJitter,
      vx: -direction.x * speed + normal.x * spread,
      vy: -direction.y * speed + normal.y * spread,
      age: 0,
      life,
      seed,
      size: randomUnit(seed, 8) > 0.58 ? 2 : 1
    });
  }
}

function rearEnginePlumeOrigins(player, rear, side) {
  const mainRadius = shipMainRadius(player);
  const geometryScale = shipGeometryScaleForRadius(mainRadius);
  const smallOrbRadius = shipSmallOrbRadius(geometryScale);
  const medialRadius = REAR_ORBS.reduce(
    (radius, orb) => Math.max(radius, Math.abs(orb.side) * geometryScale + smallOrbRadius),
    smallOrbRadius
  );

  return REAR_ORBS.map((orb) => ({
    x: player.x + rear.x * (orb.rear * geometryScale + smallOrbRadius + 1) + side.x * orb.side * geometryScale,
    y: player.y + rear.y * (orb.rear * geometryScale + smallOrbRadius + 1) + side.y * orb.side * geometryScale,
    nozzleWidth: smallOrbRadius * 1.8,
    medialOffset: orb.side * geometryScale,
    medialRadius
  }));
}

function updateParticles(particles, dtSeconds) {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.age += dtSeconds;

    if (particle.age >= particle.life) {
      particles.splice(index, 1);
      continue;
    }

    particle.x += particle.vx * dtSeconds;
    particle.y += particle.vy * dtSeconds;
    const drag = Math.pow(0.55, dtSeconds);
    particle.vx *= drag;
    particle.vy *= drag;
  }
}

function drawParticles(ctx, particles, camera, colors, timeSeconds) {
  ctx.fillStyle = colors.foreground;

  for (const particle of particles) {
    const progress = particle.age / particle.life;
    if (progress > 0.7 && ((Math.floor(timeSeconds * 30) + particle.seed) & 1) === 0) {
      continue;
    }

    const screen = worldToScreen(particle, camera);
    const heat = particleHeatFromLife(particle);
    if (heat > 0.05) {
      drawHotParticle(ctx, screen, particle);
      continue;
    }

    const size = particle.size || (progress < 0.18 && particle.seed % 7 === 0 ? 2 : 1);
    ctx.fillRect(screen.x, screen.y, size, size);
  }
}

function drawHotParticle(ctx, screen, particle) {
  const heat = particleHeatFromLife(particle);
  const size = 1 // heat > 0.52 ? 3 : heat > 0.30 ? 2 : 1;
  const offset = size > 1 ? -1 : 0;
  ctx.fillRect(screen.x + offset, screen.y + offset, size, size);
}

function particleHeatFromLife(particle) {
  const life = Math.max(0.001, Number(particle.life || 0));
  return Math.max(0, life - particle.age);
}

function drawSphere(ctx, cx, cy, radius, angle, colors, occluders = []) {
  void angle;
  fillDitheredSphere(ctx, cx, cy, radius, colors, { occluders });
  ctx.fillStyle = colors.foreground;
  drawCircle(ctx, cx, cy, radius, occluders);
}

function drawTruncatedRearSphere(ctx, cx, cy, radius, rear, colors, occluders = []) {
  const clipDistance = Math.max(0, radius - 1);
  fillDitheredSphere(ctx, cx, cy, radius, colors, {
    clipDirection: rear,
    clipDistance,
    occluders
  });
  ctx.fillStyle = colors.foreground;
  drawTruncatedCircle(ctx, cx, cy, radius, rear, clipDistance, occluders);
  drawTruncatedSphereEnd(ctx, cx, cy, radius, rear, clipDistance, occluders);
}

function fillDitheredSphere(ctx, cx, cy, radius, colors, options = {}) {
  const radiusSq = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  const background = colors.background;
  const clipDirection = options.clipDirection || null;
  const clipDistance = Number.isFinite(options.clipDistance) ? options.clipDistance : Infinity;
  const occluders = options.occluders || [];

  ctx.fillStyle = background;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radiusSq || isOccluded(px, py, occluders)) {
        continue;
      }

      if (clipDirection) {
        const projection = dx * clipDirection.x + dy * clipDirection.y;
        if (projection > clipDistance) {
          continue;
        }
      }

      ctx.fillRect(px, py, 1, 1);
    }
  }
}

function fillDisk(ctx, cx, cy, radius, occluders = []) {
  const radiusSq = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radiusSq && !isOccluded(px, py, occluders)) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

function fillTruncatedDisk(ctx, cx, cy, radius, clipDirection, clipDistance, occluders = []) {
  const radiusSq = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      const projection = dx * clipDirection.x + dy * clipDirection.y;
      if (
        dx * dx + dy * dy <= radiusSq &&
        projection <= clipDistance &&
        !isOccluded(px, py, occluders)
      ) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

function drawTruncatedCircle(ctx, cx, cy, radius, clipDirection, clipDistance, occluders = []) {
  const minX = Math.floor(cx - radius - 1);
  const maxX = Math.ceil(cx + radius + 1);
  const minY = Math.floor(cy - radius - 1);
  const maxY = Math.ceil(cy + radius + 1);

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      const projection = dx * clipDirection.x + dy * clipDirection.y;
      if (
        projection <= clipDistance &&
        Math.abs(Math.hypot(dx, dy) - radius) <= 0.5
      ) {
        drawPoint(ctx, px, py, occluders);
      }
    }
  }
}

function drawTruncatedSphereEnd(ctx, cx, cy, radius, clipDirection, clipDistance, occluders = []) {
  const halfLength = Math.sqrt(Math.max(0, radius * radius - clipDistance * clipDistance));
  const tangent = {
    x: -clipDirection.y,
    y: clipDirection.x
  };
  const center = {
    x: cx + clipDirection.x * clipDistance,
    y: cy + clipDirection.y * clipDistance
  };

  drawPixelLine(
    ctx,
    Math.round(center.x - tangent.x * halfLength),
    Math.round(center.y - tangent.y * halfLength),
    Math.round(center.x + tangent.x * halfLength),
    Math.round(center.y + tangent.y * halfLength),
    occluders
  );
}

function fillSolidDisk(ctx, cx, cy, radius) {
  const radiusSq = radius * radius;
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);

  for (let py = minY; py <= maxY; py += 1) {
    const dy = py - cy;
    const horizontalSq = radiusSq - dy * dy;
    if (horizontalSq < 0) {
      continue;
    }

    const horizontal = Math.sqrt(horizontalSq);
    const start = Math.ceil(cx - horizontal);
    const end = Math.floor(cx + horizontal);
    ctx.fillRect(start, py, end - start + 1, 1);
  }
}

function miningRayVisualCount(player) {
  return miningRayCountForPlayer(player);
}

function drawFilledCapsule(ctx, from, to, radius) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    fillSolidDisk(ctx, from.x, from.y, radius);
    return;
  }

  const minX = Math.floor(Math.min(from.x, to.x) - radius);
  const maxX = Math.ceil(Math.max(from.x, to.x) + radius);
  const minY = Math.floor(Math.min(from.y, to.y) - radius);
  const maxY = Math.ceil(Math.max(from.y, to.y) + radius);
  const radiusSq = radius * radius;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const pointX = px + 0.5;
      const pointY = py + 0.5;
      const t = clamp(((pointX - from.x) * dx + (pointY - from.y) * dy) / lengthSq, 0, 1);
      const closestX = from.x + dx * t;
      const closestY = from.y + dy * t;
      const distanceX = pointX - closestX;
      const distanceY = pointY - closestY;
      if (distanceX * distanceX + distanceY * distanceY <= radiusSq) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
}

function drawCapsuleOutline(ctx, from, to, radius, normal, colors) {
  ctx.fillStyle = colors.background;
  drawFilledCapsule(ctx, from, to, radius);

  ctx.fillStyle = colors.foreground;
  drawPixelLine(
    ctx,
    Math.round(from.x + normal.x * radius),
    Math.round(from.y + normal.y * radius),
    Math.round(to.x + normal.x * radius),
    Math.round(to.y + normal.y * radius)
  );
  drawPixelLine(
    ctx,
    Math.round(from.x - normal.x * radius),
    Math.round(from.y - normal.y * radius),
    Math.round(to.x - normal.x * radius),
    Math.round(to.y - normal.y * radius)
  );
  drawCircle(ctx, Math.round(from.x), Math.round(from.y), radius);
  drawCircle(ctx, Math.round(to.x), Math.round(to.y), radius);
}

function drawSideMiningRayEmitter(ctx, from, to, normal, offset, radius, colors) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return;
  }

  void offset;

  const length = Math.sqrt(lengthSq);
  const unit = {
    x: dx / length,
    y: dy / length
  };
  const minX = Math.floor(Math.min(from.x, to.x) - radius - 1);
  const maxX = Math.ceil(Math.max(from.x, to.x) + radius + 1);
  const minY = Math.floor(Math.min(from.y, to.y) - radius - 1);
  const maxY = Math.ceil(Math.max(from.y, to.y) + radius + 1);

  ctx.fillStyle = colors.background;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const pointX = px + 0.5;
      const pointY = py + 0.5;
      const behindMouth = (to.x - pointX) * unit.x + (to.y - pointY) * unit.y;
      if (behindMouth < 0 || behindMouth > length) {
        continue;
      }

      const cross = (pointX - to.x) * normal.x + (pointY - to.y) * normal.y;
      const falloff = clamp(behindMouth / length, 0, 1);
      const halfWidth = radius * Math.sqrt(Math.max(0, 1 - falloff * falloff));
      if (Math.abs(cross) <= halfWidth) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  ctx.fillStyle = colors.foreground;
  const steps = Math.max(8, Math.ceil(length * 2));
  let previous = null;

  for (let step = 0; step <= steps; step += 1) {
    const theta = -Math.PI / 2 + (Math.PI * step) / steps;
    const behindMouth = length * Math.cos(theta);
    const cross = radius * Math.sin(theta);
    const point = {
      x: Math.round(to.x - unit.x * behindMouth + normal.x * cross),
      y: Math.round(to.y - unit.y * behindMouth + normal.y * cross)
    };

    if (previous) {
      drawPixelLine(ctx, previous.x, previous.y, point.x, point.y);
    }
    previous = point;
  }

  drawPixelLine(
    ctx,
    Math.round(to.x + normal.x * radius),
    Math.round(to.y + normal.y * radius),
    Math.round(to.x - normal.x * radius),
    Math.round(to.y - normal.y * radius)
  );
}

function drawMiningRayBeam(ctx, from, to, direction, normal, colors, timeSeconds, hit, sideOffset = 0) {
  const radius = sideOffset === 0
    ? MINING_RAY_VISUAL_RADIUS
    : MINING_RAY_VISUAL_RADIUS * 0.5;
  drawMiningRaySquareBeam(ctx, from, to, direction, normal, radius, colors, timeSeconds, sideOffset);
  void hit;
}

function drawMiningRaySquareBeam(ctx, from, to, direction, normal, radius, colors, timeSeconds, sideOffset = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    ctx.fillStyle = colors.foreground;
    ctx.fillRect(Math.round(from.x - radius), Math.round(from.y - radius), radius * 2 + 1, radius * 2 + 1);
    return;
  }

  const maxRadius = radius + 1;
  const minX = Math.floor(Math.min(from.x, to.x) - maxRadius);
  const maxX = Math.ceil(Math.max(from.x, to.x) + maxRadius);
  const minY = Math.floor(Math.min(from.y, to.y) - maxRadius);
  const maxY = Math.ceil(Math.max(from.y, to.y) + maxRadius);
  const length = Math.sqrt(lengthSq);
  const rayDirection = normalizedRayBasis(direction, { x: dx / length, y: dy / length });
  const rayNormal = {
    x: -rayDirection.y,
    y: rayDirection.x
  };
  const sideSign = Math.sign(sideOffset);

  ctx.fillStyle = colors.foreground;
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const pointX = px + 0.5;
      const pointY = py + 0.5;
      const relativeX = pointX - from.x;
      const relativeY = pointY - from.y;
      const alongDistance = relativeX * rayDirection.x + relativeY * rayDirection.y;
      if (alongDistance < 0 || alongDistance > length) {
        continue;
      }

      const signedCross = relativeX * rayNormal.x + relativeY * rayNormal.y;
      const inside = sideSign === 0
        ? isInsideCenterMiningRayBeam(signedCross, radius, alongDistance, length, timeSeconds)
        : isInsideSideMiningRayBeam(signedCross, radius, alongDistance, length, timeSeconds, sideSign);
      if (inside) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
  void normal;
}

function normalizedRayBasis(value, fallback) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const length = Math.hypot(x, y);
  if (length > 0.000001) {
    return {
      x: x / length,
      y: y / length
    };
  }

  return fallback;
}

function isInsideCenterMiningRayBeam(signedCross, radius, alongDistance, length, timeSeconds) {
  const taper = miningRayTipTaper(radius, alongDistance, length);
  const wave = miningRaySideWave01(alongDistance, timeSeconds);
  const positiveRadius = quantizedMiningRaySideRadius(radius, wave) * taper;
  const negativeRadius = quantizedMiningRaySideRadius(radius, wave) * taper;

  return signedCross >= -negativeRadius && signedCross <= positiveRadius;
}

function isInsideSideMiningRayBeam(signedCross, radius, alongDistance, length, timeSeconds, sideSign) {
  const taper = miningRayTipTaper(radius, alongDistance, length);
  const innerRadius = radius * taper;
  const outerRadius = sinusoidalMiningRayOuterRadius(radius, alongDistance, timeSeconds) * taper;

  return sideSign > 0
    ? signedCross >= -innerRadius && signedCross <= outerRadius
    : signedCross <= innerRadius && signedCross >= -outerRadius;
}

function miningRayTipTaper(radius, alongDistance, length) {
  const taperDistance = Math.max(4, radius * 3);
  const distanceToTip = Math.max(0, length - alongDistance);
  return clamp(distanceToTip / taperDistance, 0, 1);
}

function miningRaySideWave01(alongDistance, timeSeconds) {
  const waveDistance = alongDistance + timeSeconds * MINING_RAY_SIDE_WAVE_SPEED;
  return (Math.sin((waveDistance / MINING_RAY_SIDE_WAVE_LENGTH) * Math.PI * 2) + 1) / 2;
}

function sinusoidalMiningRayOuterRadius(radius, alongDistance, timeSeconds) {
  return quantizedMiningRaySideRadius(radius, miningRaySideWave01(alongDistance, timeSeconds));
}

function quantizedMiningRaySideRadius(radius, wave01) {
  return radius + (wave01 > 1 - MINING_RAY_SIDE_WAVE_AMPLITUDE ? 1 : 0);
}

function drawMiningRayHitFlare(ctx, point, colors) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);

  ctx.fillStyle = colors.foreground;
  fillSolidDisk(ctx, x, y, MINING_RAY_HIT_FLARE_RADIUS);
}

function drawMiningRay(ctx, player, camera, asteroid, timeSeconds, colors) {
  if (player.alive === false || player.mining !== true) {
    return;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const rayLength = ENGINE.mining.rayLength + effects.rayLengthBonus;
  const rawExtension = player.rayExtension ?? player.miningRay?.extension ?? 1;
  const extension = Number.isFinite(rawExtension) ? clamp(rawExtension, 0, 1) : 1;
  const angle = player.aimAngle ?? player.angle;
  const lanes = miningRayRenderLanes(player, asteroid, angle, rayLength, extension);

  for (const lane of lanes) {
    const laneStartWorld = { x: lane.startX, y: lane.startY };
    const laneFullTipWorld = { x: lane.fullEndX, y: lane.fullEndY };
    const laneActiveTipWorld = { x: lane.endX, y: lane.endY };
    const start = worldToScreenExact(laneStartWorld, camera);
    const fullTip = worldToScreenExact(laneFullTipWorld, camera);
    const activeTip = worldToScreenExact(laneActiveTipWorld, camera);
    const fullDx = fullTip.x - start.x;
    const fullDy = fullTip.y - start.y;
    const fullLength = Math.hypot(fullDx, fullDy);
    if (fullLength <= 0) {
      continue;
    }

    const activeLength = activeTip
      ? Math.hypot(activeTip.x - start.x, activeTip.y - start.y)
      : 0;
    const visibleLength = clamp(Math.max(fullLength * extension, activeLength), 0, fullLength);
    if (visibleLength <= 0) {
      continue;
    }

    const unit = {
      x: fullDx / fullLength,
      y: fullDy / fullLength
    };
    const laneNormal = {
      x: -unit.y,
      y: unit.x
    };
    const visibleTip = {
      x: start.x + unit.x * visibleLength,
      y: start.y + unit.y * visibleLength
    };

    drawMiningRayBeam(
      ctx,
      start,
      visibleTip,
      unit,
      laneNormal,
      colors,
      timeSeconds * effects.raySpinMultiplier,
      Boolean(lane.hit),
      Number(lane.offset) || 0
    );
  }
}

function drawMiningRayHitpoints(ctx, player, camera, asteroid, timeSeconds, colors) {
  void timeSeconds;

  if (player.alive === false || player.mining !== true) {
    return;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const rayLength = ENGINE.mining.rayLength + effects.rayLengthBonus;
  const rawExtension = player.rayExtension ?? player.miningRay?.extension ?? 1;
  const extension = Number.isFinite(rawExtension) ? clamp(rawExtension, 0, 1) : 1;
  const angle = player.aimAngle ?? player.angle;
  const lanes = miningRayRenderLanes(player, asteroid, angle, rayLength, extension);

  for (const lane of lanes) {
    if (!lane.hit || !Number.isFinite(lane.endX) || !Number.isFinite(lane.endY)) {
      continue;
    }

    drawMiningRayHitFlare(ctx, worldToScreen({ x: lane.endX, y: lane.endY }, camera), colors);
  }
}

function miningRayRenderableLanes(miningRay) {
  if (!miningRay) {
    return [];
  }

  return Array.isArray(miningRay.lanes) && miningRay.lanes.length > 0
    ? miningRay.lanes
    : [miningRay];
}

function miningRayHasHit(miningRay) {
  return miningRayRenderableLanes(miningRay).some((lane) => lane.hit);
}

function miningRayRenderLanes(player, asteroid, angle, rayLength, extension) {
  const lanes = miningRayRenderableLanes(player.miningRay);
  if (lanes.length > 0) {
    return lanes;
  }

  return miningRayLanesForPlayer(player, angle, rayLength).map((lane) => {
    lane = clipRenderMiningRayLaneStart(player, asteroid, lane, angle);
    const activeDistance = lane.rayDistance * extension;
    const activeHit = asteroid
      ? raycastAsteroid(asteroid, lane.startX, lane.startY, lane.rayAngle, activeDistance, {
          blockNonPlayable: !asteroid.storm
        })
      : null;
    const fullHit = asteroid
      ? raycastAsteroid(asteroid, lane.startX, lane.startY, lane.rayAngle, lane.rayDistance, {
          blockNonPlayable: !asteroid.storm
        })
      : null;
    return {
      ...lane,
      endX: activeHit?.x ?? lane.startX + lane.rayDirectionX * activeDistance,
      endY: activeHit?.y ?? lane.startY + lane.rayDirectionY * activeDistance,
      fullEndX: fullHit?.x ?? lane.fullEndX,
      fullEndY: fullHit?.y ?? lane.fullEndY,
      hit: Boolean(activeHit?.hit)
    };
  });
}

function clipRenderMiningRayLaneStart(player, asteroid, lane, angle) {
  const probe = miningRaySideStartProbe(player, lane, angle);
  if (!probe || !asteroid) {
    return lane;
  }

  const hit = raycastAsteroid(asteroid, probe.startX, probe.startY, probe.angle, probe.distance, {
    blockNonPlayable: !asteroid.storm
  });
  if (!hit.hit) {
    return lane;
  }

  const distance = miningRayClippedSideStartDistance(probe, hit.distance);
  return miningRayLaneWithStart(
    lane,
    probe.startX + probe.directionX * distance,
    probe.startY + probe.directionY * distance
  );
}

function miningRayLaneDirection(lane, fallbackDirection) {
  if (Number.isFinite(lane.rayDirectionX) && Number.isFinite(lane.rayDirectionY)) {
    return {
      x: lane.rayDirectionX,
      y: lane.rayDirectionY
    };
  }

  const dx = Number(lane.fullEndX) - Number(lane.startX);
  const dy = Number(lane.fullEndY) - Number(lane.startY);
  const length = Math.hypot(dx, dy);
  if (length > 0.000001) {
    return {
      x: dx / length,
      y: dy / length
    };
  }

  return fallbackDirection;
}

function drawCircle(ctx, cx, cy, radius, occluders = []) {
  const minX = Math.floor(cx - radius - 1);
  const maxX = Math.ceil(cx + radius + 1);
  const minY = Math.floor(cy - radius - 1);
  const maxY = Math.ceil(cy + radius + 1);

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = px - cx;
      const dy = py - cy;
      if (Math.abs(Math.hypot(dx, dy) - radius) <= 0.5) {
        drawPoint(ctx, px, py, occluders);
      }
    }
  }
}

function drawPixels(ctx, originX, originY, pixels, pixelSize = 1) {
  for (const [x, y] of pixels) {
    ctx.fillRect(originX + x * pixelSize, originY + y * pixelSize, pixelSize, pixelSize);
  }
}

function drawPixelLine(ctx, x0, y0, x1, y1, occluders = []) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    drawPoint(ctx, x, y, occluders);
    if (x === x1 && y === y1) {
      break;
    }

    const nextError = error * 2;
    if (nextError >= dy) {
      error += dy;
      x += sx;
    }

    if (nextError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function drawPoint(ctx, x, y, occluders = []) {
  if (isOccluded(x, y, occluders)) {
    return;
  }

  ctx.fillRect(x, y, 1, 1);
}

function isOccluded(x, y, occluders) {
  return occluders.some((occluder) => {
    const dx = x - occluder.x;
    const dy = y - occluder.y;
    if (occluder.type === "ellipse") {
      const alongAxis = dx * occluder.axis.x + dy * occluder.axis.y;
      const alongPerpendicular = dx * occluder.perpendicular.x + dy * occluder.perpendicular.y;
      return (
        (alongAxis * alongAxis) / (occluder.radiusX * occluder.radiusX) +
          (alongPerpendicular * alongPerpendicular) / (occluder.radiusY * occluder.radiusY) <=
        1
      );
    }

    return dx * dx + dy * dy <= occluder.radius * occluder.radius;
  });
}

function drawBootMark(ctx) {
  const x = Math.floor(ctx.width / 2);
  const y = Math.floor(ctx.height / 2);
  ctx.fillRect(x - 18, y, 36, 1);
  ctx.fillRect(x, y - 18, 1, 36);
  ctx.fillRect(x - 3, y - 3, 7, 7);
}

function worldToScreen(point, camera) {
  return {
    x: Math.round(point.x - camera.x),
    y: Math.round(point.y - camera.y)
  };
}

function worldToScreenExact(point, camera) {
  return {
    x: point.x - camera.x,
    y: point.y - camera.y
  };
}

function hashCell(seed, x, y) {
  let hash = 2166136261;
  const text = `${seed}:${x}:${y}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function normalize3d(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return {
    x: x / length,
    y: y / length,
    z: z / length
  };
}

function randomUnit(seed, salt) {
  let value = Math.imul(seed ^ Math.imul(salt + 1, 374761393), 668265263);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
