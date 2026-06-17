import { ENGINE, RENDER } from "/shared/constants.js";
import { ASTEROID_TILE, STORM_STATE, raycastAsteroid } from "/shared/asteroid.js";
import { createSeededRandom, createSimplexNoise3D } from "/shared/math.js";
import {
  aggregateUpgradeEffects,
  canAffordUpgrade,
  nextUpgradeCost,
  UPGRADE_DEFINITIONS,
  upgradeLevel
} from "/shared/upgrades.js";

const ENTITY_PIXEL_SIZE = 1;
const CANVAS_EDGE_PADDING_EM = 1;
const MIN_RENDER_ASPECT = 2 / 3;
const MAX_RENDER_ASPECT = 3 / 2;
const WORLD_LENS_EDGE_SCALE = RENDER.lensEdgeScale || 1;
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
const STORM_NOISE_BROAD_SCALE = 0.43;
const STORM_NOISE_FINE_SCALE = 2.35;
const STORM_NOISE_SPEED_X = -2;
const STORM_NOISE_SPEED_Y = 5;
const STORM_NOISE_SPEED_Z = 0.1;
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
const ROCK_OUTER_CORNER_RADIUS = 3;
const ROCK_INNER_CORNER_RADIUS = 1;
const SMALL_ORB_RADIUS = 3;
const REAR_ORBS = Object.freeze([
  { rear: 7, side: -5, layer: "back" },
  { rear: 7, side: 5, layer: "back" },
  { rear: 9, side: 0, layer: "front" }
]);
const THRUSTER_PARTICLE_RATE = 70;
const MINING_PARTICLE_RATE = 90;
const MINING_RAY_BASE_SPIN_RATE = 2.5;
const MAX_PARTICLES = 260;
const REMOTE_PLAYER_LOOKAHEAD_SECONDS = 0.08;
const REMOTE_PLAYER_MAX_EXTRAPOLATION_SECONDS = 0.14;
const MENU_THEME_BACKING_COLOR = "#000000";
const ORE_RING_STEPS = 16;
const ORE_MINING_ROTATION = 0.26;
const ORE_OCCLUSION_PADDING = 0.85;
const stormNoiseCache = new Map();
const huckRockShapeCache = new Map();
const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 60,
  width: 260,
  padding: 8,
  titleTop: 8,
  rowTopOffset: 24,
  rowHeight: 14,
  rowInset: 8,
  rowHighlightPadding: 2,
  rowTextHeight: 7,
  separatorGap: 6,
  detailTopGap: 7,
  detailLineHeight: 10,
  detailLineCount: 4,
  bottomPadding: 8
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
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"]
});

export function createRenderer(canvas) {
  const canvasContext = canvas.getContext("2d", { alpha: false });
  let surface = null;
  let textRenderer = null;
  const colors = {
    foreground: RENDER.foreground,
    background: RENDER.background,
    backing: "#000000"
  };
  const particles = [];
  const miningParticles = [];
  const emitCarry = new Map();
  let particleSeed = 1;
  let lastFrameTime = null;

  function sizeCanvasBox() {
    const viewport = getViewportSize();
    resizeRenderSurface(viewport);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }

  function resizeRenderSurface(viewport = getViewportSize()) {
    const size = renderSizeForViewport(viewport);
    if (canvas.width === size.width && canvas.height === size.height && surface && textRenderer) {
      return;
    }

    canvas.width = size.width;
    canvas.height = size.height;
    surface = createPixelSurface(canvasContext, size.width, size.height);
    textRenderer = createPixelTextRenderer(size.width, size.height);
  }

  sizeCanvasBox();
  window.addEventListener("resize", sizeCanvasBox);
  window.visualViewport?.addEventListener("resize", sizeCanvasBox);
  window.visualViewport?.addEventListener("scroll", sizeCanvasBox);

  return {
    draw(snapshot, options = {}) {
      resizeRenderSurface();
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

      drawFrame(surface, snapshot, { ...options, timeSeconds, dtSeconds }, colors, textRenderer, {
        particles,
        miningParticles,
        emitCarry,
        nextSeed() {
          particleSeed += 1;
          return particleSeed;
        }
      });
      surface.present();
    }
  };
}

function renderSizeForViewport(viewport) {
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
  let currentColor = packColor(RENDER.foreground);
  let activeClip = null;
  let activeLens = null;

  function canWriteProjectedPixel(x, y) {
    return x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height &&
      (!activeClip || (x >= activeClip.starts[y] && x < activeClip.ends[y]));
  }

  function writeProjectedPixel(projected) {
    if (!projected || !canWriteProjectedPixel(projected.x, projected.y)) {
      return false;
    }

    pixels[projected.y * width + projected.x] = currentColor;
    return true;
  }

  function writeProjectedBridge(from, to) {
    let x = from.x;
    let y = from.y;
    const dx = Math.abs(to.x - from.x);
    const dy = -Math.abs(to.y - from.y);
    const stepX = from.x < to.x ? 1 : -1;
    const stepY = from.y < to.y ? 1 : -1;
    let error = dx + dy;

    while (true) {
      if (canWriteProjectedPixel(x, y)) {
        pixels[y * width + x] = currentColor;
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
      activeLens = lens;
    },
    endLens() {
      activeLens = null;
    },
    endClip() {
      activeClip = null;
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
          let previous = null;
          for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) {
              const projected = projectLensPixel(px, py, activeLens);
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
          for (let px = x0; px < x1; px += 1) {
            const projected = projectLensPixel(px, py, activeLens);
            writeProjectedPixel(projected);
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
          for (let px = start; px < end; px += 1) {
            pixels[row + px] = currentColor;
          }
        }
        return;
      }

      if (x0 === 0 && y0 === 0 && x1 === width && y1 === height) {
        pixels.fill(currentColor);
        return;
      }

      for (let py = y0; py < y1; py += 1) {
        const row = py * width;
        for (let px = x0; px < x1; px += 1) {
          pixels[row + px] = currentColor;
        }
      }
    },
    present() {
      canvasContext.putImageData(imageData, 0, 0);
    }
  };
}

function createCircleClipSpans(width, height) {
  const starts = new Int16Array(height);
  const ends = new Int16Array(height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2;
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
    maxSourceRadius: radius * edgeScale,
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
    return {
      x: Math.floor(lens.centerX),
      y: Math.floor(lens.centerY)
    };
  }

  const t = clamp(sourceRadius / lens.maxSourceRadius, 0, 1);
  const scale = 1 + (lens.edgeScale - 1) * t * t;

  return {
    x: Math.floor(lens.centerX + dx / scale),
    y: Math.floor(lens.centerY + dy / scale)
  };
}

function createPixelTextRenderer(width, height) {
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
        drawBitmapTextLine(ctx, String(line), x, y + index * lineHeight, maxWidth, scale, options);
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

function drawBitmapTextLine(ctx, text, x, y, maxWidth, scale, options = {}) {
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

    if (index >= selectionStart && index < selectionEnd) {
      ctx.fillStyle = options.selectionBackground || RENDER.foreground;
      ctx.fillRect(cursorX - Math.floor(scale / 2), y - scale, glyphWidthPx + scale, 9 * scale);
      ctx.fillStyle = options.selectionColor || RENDER.background;
    } else {
      ctx.fillStyle = options.color || RENDER.foreground;
    }

    drawBitmapGlyph(ctx, glyph, cursorX, y, scale);
    cursorX += glyphWidthPx + scale;
  }
}

function drawBitmapGlyph(ctx, glyph, x, y, scale) {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") {
        ctx.fillRect(x + col * scale, y + row * scale, scale, scale);
      }
    }
  }
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

function drawFrame(ctx, snapshot, options, colors, textRenderer, particleState) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = colors.backing || "#000000";
  ctx.fillRect(0, 0, ctx.width, ctx.height);
  ctx.fillStyle = colors.foreground;

  if (!snapshot) {
    beginWorldViewport(ctx, colors);
    endWorldViewport(ctx);
    if (options.room || Object.keys(options.roomButtons || {}).length > 0) {
      drawRoomOverlay(ctx, options, null, colors, textRenderer);
    }
    return;
  }

  const predictedPlayer = options.predictedPlayer?.id === options.playerId ? options.predictedPlayer : null;
  const renderPlayers = snapshot.players.map((player) => {
    if (player.id === options.playerId) {
      return predictedPlayer || {
        ...player,
        aimAngle: options.aimAngle ?? player.aimAngle,
        mining: options.mining ?? player.mining
      };
    }

    return extrapolateRemotePlayer(player, snapshot, options.timeSeconds);
  });
  const camera = cameraForSnapshot(
    snapshot,
    options.cameraPlayerId || options.playerId,
    options.timeSeconds,
    predictedPlayer,
    renderPlayers,
    ctx.width,
    ctx.height
  );
  const asteroidMiningTargets = asteroidMiningTargetMap(snapshot);
  beginWorldViewport(ctx, colors);
  drawStars(ctx, snapshot, camera);
  if (options.asteroid) {
    drawAsteroid(ctx, options.asteroid, camera, colors, options.timeSeconds ?? snapshot.tick / 60, asteroidMiningTargets);
  } else {
    drawWorldBounds(ctx, snapshot, camera);
  }

  for (const entity of snapshot.entities || []) {
    drawEntity(ctx, entity, camera, options, colors, textRenderer);
  }

  const localPlayer = renderPlayers.find((player) => player.id === options.playerId);

  if (options.build?.active && localPlayer?.alive && options.asteroid) {
    drawBuildPreview(ctx, options.asteroid, localPlayer, renderPlayers, camera, options.build, colors);
  }

  for (const renderPlayer of renderPlayers) {
    if (renderPlayer.thrusting) {
      emitThrusterParticles(particleState, renderPlayer, options.dtSeconds);
    }

    if (renderPlayer.mining && renderPlayer.miningRay?.hit) {
      emitMiningParticles(particleState, renderPlayer, options.dtSeconds);
    }
  }

  updateParticles(particleState.particles, options.dtSeconds);
  updateParticles(particleState.miningParticles, options.dtSeconds);
  drawParticles(ctx, particleState.particles, camera, colors, options.timeSeconds);

  for (const renderPlayer of renderPlayers) {
    if (renderPlayer.mining) {
      drawMiningRay(ctx, renderPlayer, camera, options.asteroid, options.timeSeconds ?? snapshot.tick / 60, colors);
    }
    drawShip(ctx, renderPlayer, camera, colors, options.timeSeconds ?? snapshot.tick / 60, textRenderer);
  }

  drawParticles(ctx, particleState.miningParticles, camera, colors, options.timeSeconds);

  for (const renderPlayer of renderPlayers) {
    drawTalkBubble(ctx, renderPlayer, camera, colors, textRenderer);
  }
  endWorldViewport(ctx);

  if (options.room?.state === "active") {
    drawPlayerHud(
      ctx,
      localPlayer,
      colors,
      textRenderer
    );
    drawUpgradeHud(ctx, localPlayer, options.upgrades, colors, textRenderer);
    drawBuildHud(ctx, localPlayer, options.build, options.upgrades, colors, textRenderer);
  }
  drawRoomOverlay(ctx, { ...options, snapshot }, localPlayer, colors, textRenderer);
  drawEliminationNotices(ctx, options.eliminationNotices || [], colors, textRenderer, options.timeSeconds);
  drawChatOverlay(ctx, options.chat, colors, textRenderer, options.timeSeconds);
}

function beginWorldViewport(ctx, colors) {
  ctx.beginCircleClip();
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, ctx.width, ctx.height);
  ctx.beginLens(createWorldLens(ctx.width, ctx.height));
  ctx.fillStyle = colors.foreground;
}

function endWorldViewport(ctx) {
  ctx.endLens();
  ctx.endClip();
}

function drawRoomOverlay(ctx, options, localPlayer, colors, textRenderer) {
  const room = options.room || { state: "menu", maxPlayers: ENGINE.maxPlayers, players: [] };
  const state = room.state || "menu";

  if (state === "menu") {
    drawMenuOverlay(ctx, options, colors, textRenderer);
    return;
  }

  if (state === "waiting") {
    drawWaitingOverlay(ctx, room, options, colors, textRenderer);
    return;
  }

  if (state === "active" && localPlayer && !localPlayer.alive) {
    drawSpectatorOverlay(ctx, options, localPlayer, colors, textRenderer);
    return;
  }

  if (state === "ended") {
    drawEndedOverlay(ctx, room, options, colors, textRenderer);
  }
}

function drawMenuOverlay(ctx, options, colors, textRenderer) {
  drawRoomButtons(ctx, options, colors, textRenderer);
}

function drawWaitingOverlay(ctx, room, options, colors, textRenderer) {
  const count = room.players?.length || 0;
  const maxPlayers = room.maxPlayers || ENGINE.maxPlayers;
  const minPlayers = room.minPlayers || ENGINE.lobby.minPlayers || 2;
  const secondsLeft = Math.max(0, Math.ceil(((room.autoStartAtMs || 0) - Date.now()) / 1000));

  if (room.countdownArmed) {
    drawStartingOverlay(ctx, secondsLeft, options, colors, textRenderer);
    return;
  }

  const panel = { x: Math.round((ctx.width - 212) / 2), y: 20, width: 212, height: 35 };

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  drawCenteredText(ctx, textRenderer, `WAITING ${count}/${maxPlayers}`, ctx.width / 2, panel.y + 8, {
    fontSize: 8,
    color: colors.foreground
  });
  const status = count < minPlayers
    ? `NEED ${minPlayers} PLAYERS`
    : `START ${formatClock(secondsLeft)}`;
  drawCenteredText(ctx, textRenderer, status, ctx.width / 2, panel.y + 21, {
    fontSize: 8,
    color: colors.foreground
  });
  drawRoomButtons(ctx, options, colors, textRenderer);
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
  drawRoomButtons(ctx, options, colors, textRenderer);
}

function drawSpectatorOverlay(ctx, options, localPlayer, colors, textRenderer) {
  const watchedId = localPlayer.killedById || options.cameraPlayerId;
  const watched = options.snapshot?.players?.find((player) => player.id === watchedId);
  const label = watched?.name ? `WATCHING ${watched.name}` : "WATCHING";
  const panel = { x: Math.round((ctx.width - 208) / 2), y: 122, width: 208, height: 70 };

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  drawCenteredText(ctx, textRenderer, "ELIMINATED", ctx.width / 2, panel.y + 13, {
    fontSize: 10,
    color: colors.foreground
  });
  drawCenteredText(ctx, textRenderer, label, ctx.width / 2, panel.y + 36, {
    fontSize: 8,
    color: colors.foreground,
    width: panel.width - 12
  });
  drawRoomButtons(ctx, options, colors, textRenderer);
}

function drawEndedOverlay(ctx, room, options, colors, textRenderer) {
  const won = room.winnerId && room.winnerId === options.playerId;
  const title = won ? "YOU WON!" : "GAME OVER";
  const panel = { x: Math.round((ctx.width - 192) / 2), y: 128, width: 192, height: 54 };

  drawPanel(ctx, panel.x, panel.y, panel.width, panel.height, colors);
  drawCenteredText(ctx, textRenderer, title, ctx.width / 2, panel.y + 19, {
    fontSize: 10,
    color: colors.foreground
  });
  drawRoomButtons(ctx, options, colors, textRenderer);
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
    const y = 8 + index * (panelHeight + 3);

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
    const ray = player.miningRay;
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

  return targets;
}

function drawAsteroid(ctx, asteroid, camera, colors, timeSeconds, asteroidMiningTargets) {
  drawAsteroidTiles(ctx, asteroid, camera, colors, timeSeconds, asteroidMiningTargets);
  drawStormOverlay(ctx, asteroid, camera, colors, timeSeconds);
  if (asteroid.storm) {
    drawStormBoundary(ctx, asteroid, camera, colors, timeSeconds);
  } else {
    drawAsteroidBoundary(ctx, asteroid, camera, colors);
  }
}

function drawStormOverlay(ctx, asteroid, camera, colors, timeSeconds) {
  if (!asteroid.storm) {
    return;
  }

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

  ctx.fillStyle = colors.foreground;
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const state = stormTileStateAt(asteroid, tileX, tileY);
      if (state !== STORM_STATE.storm) {
        continue;
      }

      const screenX = Math.round(tileX * tileSize - camera.x);
      const screenY = Math.round(tileY * tileSize - camera.y);
      ctx.fillStyle = colors.background;
      ctx.fillRect(screenX, screenY, tileSize, tileSize);
      ctx.fillStyle = colors.foreground;
      drawStormTilePattern(ctx, asteroid, screenX, screenY, tileSize, tileX, tileY, timeSeconds);
    }
  }
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
  const dx = (player.vx || 0) * leadSeconds;
  const dy = (player.vy || 0) * leadSeconds;
  if (dx === 0 && dy === 0) {
    return player;
  }

  return {
    ...player,
    x: player.x + dx,
    y: player.y + dy,
    miningRay: offsetMiningRay(player.miningRay, dx, dy)
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
    fullEndY: Number.isFinite(miningRay.fullEndY) ? miningRay.fullEndY + dy : miningRay.fullEndY
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
  const worldLeft = tileX * size;
  const worldTop = tileY * size;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      if (stormNoiseAt(asteroid, worldLeft + px, worldTop + py, timeSeconds) >= threshold) {
        ctx.fillRect(x + px, y + py, 1, 1);
      }
    }
  }
}

function stormNoiseAt(asteroid, worldX, worldY, timeSeconds) {
  const noise = stormNoiseForSeed(asteroid.seed);
  const sampleX = (worldX + timeSeconds * STORM_NOISE_SPEED_X) * STORM_NOISE_SCALE;
  const sampleY = (worldY + timeSeconds * STORM_NOISE_SPEED_Y) * STORM_NOISE_SCALE;
  const sampleZ = timeSeconds * STORM_NOISE_SPEED_Z;
  const medium = noise(sampleX, sampleY, sampleZ);
  const broad = noise(
    sampleX * STORM_NOISE_BROAD_SCALE + 17.3,
    sampleY * STORM_NOISE_BROAD_SCALE - 29.1,
    sampleZ * 0.7 + 5.7
  );
  const fine = noise(
    sampleX * STORM_NOISE_FINE_SCALE - 41.6,
    sampleY * STORM_NOISE_FINE_SCALE + 13.4,
    sampleZ * 1.6 - 9.2
  );
  return medium * 0.68 + broad * 0.22 + fine * 0.10;
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

function drawAsteroidTiles(ctx, asteroid, camera, colors, timeSeconds, asteroidMiningTargets) {
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
        drawWallOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors);
      } else {
        drawRockOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors);
      }
    }
  }

  drawInnerRockCornerConnectors(ctx, asteroid, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY, colors);

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
  if (!isPlayableTile(asteroid, tileX, tileY) || asteroid.tiles[index] !== ASTEROID_TILE.empty) {
    return false;
  }

  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  return Math.hypot(centerX - player.x, centerY - player.y) <= ENGINE.build.radiusTiles * tileSize &&
    !tileOverlapsPlayers(players, tileX, tileY, tileSize);
}

function drawBuildAreaOutline(ctx, asteroid, player, players, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY) {
  const validTiles = new Set();

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (isBuildPreviewTile(asteroid, player, players, tileX, tileY, tileSize)) {
        validTiles.add(tileKey(tileX, tileY));
      }
    }
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

function drawRockOutline(ctx, asteroid, tileX, tileY, x, y, size, colors) {
  ctx.fillStyle = colors.foreground;

  const north = isRockTileAt(asteroid, tileX, tileY - 1);
  const east = isRockTileAt(asteroid, tileX + 1, tileY);
  const south = isRockTileAt(asteroid, tileX, tileY + 1);
  const west = isRockTileAt(asteroid, tileX - 1, tileY);
  const northWest = isRockTileAt(asteroid, tileX - 1, tileY - 1);
  const northEast = isRockTileAt(asteroid, tileX + 1, tileY - 1);
  const southEast = isRockTileAt(asteroid, tileX + 1, tileY + 1);
  const southWest = isRockTileAt(asteroid, tileX - 1, tileY + 1);
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

  if (topOpen) {
    drawPixelLine(
      ctx,
      x + topTrimLeft,
      y,
      right - topTrimRight,
      y
    );
  }

  if (rightOpen) {
    drawPixelLine(
      ctx,
      right,
      y + rightTrimTop,
      right,
      bottom - rightTrimBottom
    );
  }

  if (bottomOpen) {
    drawPixelLine(
      ctx,
      right - bottomTrimRight,
      bottom,
      x + bottomTrimLeft,
      bottom
    );
  }

  if (leftOpen) {
    drawPixelLine(
      ctx,
      x,
      bottom - leftTrimBottom,
      x,
      y + leftTrimTop
    );
  }

  drawOuterRockCorners(ctx, x, y, right, bottom, {
    outerTopLeft,
    outerTopRight,
    outerBottomRight,
    outerBottomLeft
  });
}

function drawOuterRockCorners(ctx, x, y, right, bottom, corners) {
  if (corners.outerTopLeft) {
    drawPixelLine(ctx, x, y + ROCK_OUTER_CORNER_RADIUS, x + ROCK_OUTER_CORNER_RADIUS, y);
  }

  if (corners.outerTopRight) {
    drawPixelLine(ctx, right - ROCK_OUTER_CORNER_RADIUS, y, right, y + ROCK_OUTER_CORNER_RADIUS);
  }

  if (corners.outerBottomRight) {
    drawPixelLine(ctx, right, bottom - ROCK_OUTER_CORNER_RADIUS, right - ROCK_OUTER_CORNER_RADIUS, bottom);
  }

  if (corners.outerBottomLeft) {
    drawPixelLine(ctx, x + ROCK_OUTER_CORNER_RADIUS, bottom, x, bottom - ROCK_OUTER_CORNER_RADIUS);
  }
}

function drawWallOutline(ctx, asteroid, tileX, tileY, x, y, size, colors) {
  ctx.fillStyle = colors.foreground;

  const north = isWallTileAt(asteroid, tileX, tileY - 1);
  const east = isWallTileAt(asteroid, tileX + 1, tileY);
  const south = isWallTileAt(asteroid, tileX, tileY + 1);
  const west = isWallTileAt(asteroid, tileX - 1, tileY);
  const northWest = isWallTileAt(asteroid, tileX - 1, tileY - 1);
  const northEast = isWallTileAt(asteroid, tileX + 1, tileY - 1);
  const southEast = isWallTileAt(asteroid, tileX + 1, tileY + 1);
  const southWest = isWallTileAt(asteroid, tileX - 1, tileY + 1);
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

function drawInnerRockCornerConnectors(ctx, asteroid, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY, colors) {
  ctx.fillStyle = colors.foreground;

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

function drawStormBoundaryVertical(ctx, asteroid, x, y, length, worldX, worldY, timeSeconds) {
  for (let offset = 0; offset < length; offset += 1) {
    if (stormNoiseAt(asteroid, worldX, worldY + offset, timeSeconds) >= STORM_BOUNDARY_NOISE_THRESHOLD) {
      ctx.fillRect(x, y + offset, 1, 1);
    }
  }
}

function drawStormBoundaryHorizontal(ctx, asteroid, x, y, length, worldX, worldY, timeSeconds) {
  for (let offset = 0; offset < length; offset += 1) {
    if (stormNoiseAt(asteroid, worldX + offset, worldY, timeSeconds) >= STORM_BOUNDARY_NOISE_THRESHOLD) {
      ctx.fillRect(x + offset, y, 1, 1);
    }
  }
}

function drawAsteroidBoundary(ctx, asteroid, camera, colors) {
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

  ctx.fillStyle = colors.foreground;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (!isBoundarySafeTile(asteroid, tileX, tileY)) {
        continue;
      }

      const screenX = Math.round(tileX * tileSize - camera.x);
      const screenY = Math.round(tileY * tileSize - camera.y);

      if (!isBoundarySafeTile(asteroid, tileX - 1, tileY)) {
        drawDashedBoundaryVertical(ctx, screenX, screenY, tileSize, tileY * tileSize);
      }

      if (!isBoundarySafeTile(asteroid, tileX + 1, tileY)) {
        drawDashedBoundaryVertical(ctx, screenX + tileSize - 1, screenY, tileSize, tileY * tileSize);
      }

      if (!isBoundarySafeTile(asteroid, tileX, tileY - 1)) {
        drawDashedBoundaryHorizontal(ctx, screenX, screenY, tileSize, tileX * tileSize);
      }

      if (!isBoundarySafeTile(asteroid, tileX, tileY + 1)) {
        drawDashedBoundaryHorizontal(ctx, screenX, screenY + tileSize - 1, tileSize, tileX * tileSize);
      }
    }
  }
}

function drawDashedBoundaryVertical(ctx, x, y, length, worldY) {
  for (let offset = 0; offset < length; offset += 1) {
    if (positiveModulo(worldY + offset, ASTEROID_DASH_PERIOD) < ASTEROID_DASH_ON) {
      ctx.fillRect(x, y + offset, 1, 1);
    }
  }
}

function drawDashedBoundaryHorizontal(ctx, x, y, length, worldX) {
  for (let offset = 0; offset < length; offset += 1) {
    if (positiveModulo(worldX + offset, ASTEROID_DASH_PERIOD) < ASTEROID_DASH_ON) {
      ctx.fillRect(x + offset, y, 1, 1);
    }
  }
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

function isWallTileAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  return isWallTile(asteroid.tiles[tileY * asteroid.widthTiles + tileX]);
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

function drawStars(ctx, snapshot, camera) {
  drawStarLayer(ctx, snapshot.arenaId, {
    x: camera.x * STAR_PARALLAX,
    y: camera.y * STAR_PARALLAX,
    lensSourcePadding: cameraCullPadding(camera)
  });
}

function drawMenuStars(ctx, timeSeconds) {
  drawStarLayer(ctx, MENU_STAR_SEED, {
    x: timeSeconds * MENU_STAR_SCROLL_SPEED,
    y: 0,
    lensSourcePadding: worldLensSourcePadding(ctx.width, ctx.height)
  });
}

function drawStarLayer(ctx, seed, starCamera) {
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

  rows.slice(0, 3).forEach((row, index) => {
    const input = String(row.input || "").toUpperCase();
    const action = String(row.action || "").toUpperCase();
    const rowY = y + index * 11;
    const actionWidth = textRenderer.measure(action, textOptions);
    textRenderer.draw(ctx, input, x + 10, rowY, {
      ...textOptions,
      width: Math.floor(width / 2) - 16
    });
    textRenderer.draw(ctx, action, x + width - actionWidth - 10, rowY, {
      ...textOptions,
      width: actionWidth + 2
    });
  });
}

function drawHuckRockEntity(ctx, entity, camera, colors) {
  const screen = worldToScreen(entity, camera);
  const radius = Number(entity.radius || ENGINE.huckRock.radius);
  const points = projectedHuckRockPoints(
    entity.shapeSeed || entity.id || "huck-rock",
    Math.round(screen.x),
    Math.round(screen.y),
    radius,
    Number(entity.angleY) || 0,
    Number(entity.angleX) || 0,
    Number(entity.angleZ) || 0
  );
  const hull = convexHull(points);

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
}

function drawThemeSwatchEntity(ctx, entity, camera, colors, textRenderer) {
  const screen = worldToScreen(entity, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const radius = Number(entity.radius || 15);
  const selected = entity.selected === true;
  const background = entity.background || colors.background;
  const foreground = entity.foreground || colors.foreground;
  const fillColor = selected ? foreground : background;
  const detailColor = selected ? background : foreground;

  if (!selected) {
    ctx.fillStyle = MENU_THEME_BACKING_COLOR;
    fillDisk(ctx, x, y, radius + 4);
  }

  ctx.fillStyle = fillColor;
  fillDisk(ctx, x, y, radius);
  ctx.fillStyle = detailColor;
  drawCenteredCircleLabel(ctx, textRenderer, String(entity.label || ""), x, y - 7, {
    fontSize: 10,
    color: detailColor
  });
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

function drawShip(ctx, player, camera, colors, timeSeconds, textRenderer) {
  const screen = worldToScreen(player, camera);
  const x = Math.round(screen.x);
  const y = Math.round(screen.y);
  const rearAngle = player.angle + Math.PI;
  const rear = {
    x: Math.cos(rearAngle),
    y: Math.sin(rearAngle)
  };
  const side = {
    x: Math.cos(player.angle + Math.PI / 2),
    y: Math.sin(player.angle + Math.PI / 2)
  };
  const mainOccluder = {
    x,
    y,
    radius: player.radius
  };

  void timeSeconds;

  for (const orb of REAR_ORBS.filter((candidate) => candidate.layer === "back")) {
    const orbX = Math.round(x + rear.x * orb.rear + side.x * orb.side);
    const orbY = Math.round(y + rear.y * orb.rear + side.y * orb.side);
    drawSphere(ctx, orbX, orbY, SMALL_ORB_RADIUS, player.angle, colors, [mainOccluder]);
  }

  drawSphere(ctx, x, y, player.radius, player.angle, colors);

  for (const orb of REAR_ORBS.filter((candidate) => candidate.layer === "front")) {
    const orbX = Math.round(x + rear.x * orb.rear + side.x * orb.side);
    const orbY = Math.round(y + rear.y * orb.rear + side.y * orb.side);
    drawSphere(ctx, orbX, orbY, SMALL_ORB_RADIUS, player.angle, colors);
  }

  drawShipHealthIndicator(ctx, x, y, player, colors);
  drawShipStormWarning(ctx, x, y, player, colors, textRenderer);
}

function drawShipStormWarning(ctx, x, y, player, colors, textRenderer) {
  if (!player.stormWarning || !textRenderer) {
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

function drawPlayerHud(ctx, player, colors, textRenderer) {
  if (!player) {
    return;
  }

  const x = 8;
  const y = 8;
  const width = 112;
  const height = 48;
  const padding = 4;
  const contentX = x + padding;
  const contentRight = x + width - padding;
  const hpY = y + padding;
  const rowY = y + 18;
  const rowStep = 10;
  const hp = clamp(player.health ?? 0, 0, player.maxHealth || 1);
  const maxHp = Math.max(1, player.maxHealth || 1);
  const healthBars = clamp(
    Math.round(player.healthBars || maxHp / ENGINE.player.healthPerBar || ENGINE.player.startingHealthBars),
    1,
    ENGINE.player.maxHealthBars
  );
  const resources = player.resources || {};

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);

  textRenderer.draw(ctx, "HP", contentX, hpY, {
    fontSize: 8,
    color: colors.foreground
  });
  drawHudHealthBars(ctx, x + 22, hpY + 1, contentRight - (x + 22), 5, hp, maxHp, healthBars, colors);

  drawHudResource(ctx, "ROCK", resources.rock || 0, contentX, contentRight, rowY, textRenderer, colors);
  drawHudResource(ctx, "ORE", resources.ore || 0, contentX, contentRight, rowY + rowStep, textRenderer, colors);
  drawHudResource(ctx, "DIAMOND", resources.diamond || 0, contentX, contentRight, rowY + rowStep * 2, textRenderer, colors);
}

function drawUpgradeHud(ctx, player, upgradesUi, colors, textRenderer) {
  if (!player) {
    return;
  }

  if (!upgradesUi?.active) {
    textRenderer.draw(ctx, "Q - UPGRADES", 10, 62, {
      fontSize: 8,
      color: colors.foreground
    });
    return;
  }

  drawUpgradeMenu(ctx, player, upgradesUi, colors, textRenderer);
}

function drawBuildHud(ctx, player, buildUi, upgradesUi, colors, textRenderer) {
  if (!player || upgradesUi?.active) {
    return;
  }

  textRenderer.draw(ctx, buildUi?.active ? "E - MINING RAY" : "E - BUILDER ARM", 10, 72, {
    fontSize: 8,
    color: colors.foreground
  });
}

function drawUpgradeMenu(ctx, player, upgradesUi, colors, textRenderer) {
  const width = UPGRADE_MENU_LAYOUT.width;
  const height = upgradeMenuHeight();
  const x = UPGRADE_MENU_LAYOUT.x;
  const y = UPGRADE_MENU_LAYOUT.y;
  const resources = player.resources || {};
  const selectedIndex = clamp(
    Math.floor(upgradesUi.selectedIndex || 0),
    0,
    UPGRADE_DEFINITIONS.length - 1
  );

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(x + 1, y + 1, width - 2, height - 2);

  textRenderer.draw(ctx, "UPGRADES", x + UPGRADE_MENU_LAYOUT.padding, y + UPGRADE_MENU_LAYOUT.titleTop, {
    fontSize: 8,
    color: colors.foreground
  });

  const rowX = x + UPGRADE_MENU_LAYOUT.rowInset;
  const rowRight = x + width - UPGRADE_MENU_LAYOUT.rowInset;
  const rowTop = y + UPGRADE_MENU_LAYOUT.rowTopOffset;
  const rowHeight = UPGRADE_MENU_LAYOUT.rowHeight;

  for (let index = 0; index < UPGRADE_DEFINITIONS.length; index += 1) {
    const definition = UPGRADE_DEFINITIONS[index];
    const level = upgradeLevel(player.upgrades, definition.id);
    const cost = nextUpgradeCost(player.upgrades, definition.id);
    const affordable = canAffordUpgrade(resources, cost);
    const selected = index === selectedIndex;
    const rowY = rowTop + index * rowHeight;
    const levelText = `${level}/${definition.maxLevel}`;
    const levelWidth = textRenderer.measure(levelText, { fontSize: 8 });
    const labelX = rowX + 14;

    if (selected) {
      ctx.fillStyle = colors.foreground;
      ctx.fillRect(
        rowX - UPGRADE_MENU_LAYOUT.rowHighlightPadding,
        rowY - UPGRADE_MENU_LAYOUT.rowHighlightPadding,
        rowRight - rowX + UPGRADE_MENU_LAYOUT.rowHighlightPadding * 2,
        UPGRADE_MENU_LAYOUT.rowTextHeight + UPGRADE_MENU_LAYOUT.rowHighlightPadding * 2
      );
    }

    if (affordable) {
      textRenderer.draw(ctx, "+", rowX, rowY, {
        fontSize: 8,
        color: selected ? colors.background : colors.foreground,
        width: 10
      });
    }

    textRenderer.draw(ctx, definition.label, labelX, rowY, {
      fontSize: 8,
      color: selected ? colors.background : colors.foreground,
      width: 176
    });
    textRenderer.draw(ctx, levelText, rowRight - levelWidth, rowY, {
      fontSize: 8,
      color: selected ? colors.background : colors.foreground,
      width: levelWidth + 1
    });
  }

  const selectedDefinition = UPGRADE_DEFINITIONS[selectedIndex];
  const selectedLevel = upgradeLevel(player.upgrades, selectedDefinition?.id);
  const selectedUpgradeLevel = selectedDefinition?.levels[selectedLevel];
  const selectedCost = nextUpgradeCost(player.upgrades, selectedDefinition?.id);
  const rowsBottom = y + UPGRADE_MENU_LAYOUT.rowTopOffset + UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight;
  const separatorY = rowsBottom + UPGRADE_MENU_LAYOUT.separatorGap;
  const detailY = separatorY + UPGRADE_MENU_LAYOUT.detailTopGap;
  const affordable = canAffordUpgrade(resources, selectedCost);
  const currentText = currentUpgradeStatText(selectedDefinition, selectedLevel);
  const nextText = selectedUpgradeLevel?.effectText || "MAX LEVEL";
  const costText = selectedCost
    ? `COST: ${formatUpgradeCostLong(selectedCost)}`
    : "COST: MAX LEVEL";
  const actionText = selectedCost
    ? affordable ? "CLICK BUY" : "NEED RESOURCES"
    : "MAXED";

  ctx.fillStyle = colors.foreground;
  ctx.fillRect(x + UPGRADE_MENU_LAYOUT.padding, separatorY, width - UPGRADE_MENU_LAYOUT.padding * 2, 1);
  textRenderer.draw(ctx, "", x + UPGRADE_MENU_LAYOUT.padding, detailY, {
    lines: [
      `CURRENT: ${currentText}`,
      `NEXT: ${nextText}`,
      costText,
      actionText
    ],
    fontSize: 8,
    lineHeight: UPGRADE_MENU_LAYOUT.detailLineHeight,
    color: colors.foreground,
    width: width - UPGRADE_MENU_LAYOUT.padding * 2
  });
}

function upgradeMenuHeight() {
  const rowsBottom = UPGRADE_MENU_LAYOUT.rowTopOffset + UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight;
  const separatorY = rowsBottom + UPGRADE_MENU_LAYOUT.separatorGap;
  const detailTop = separatorY + UPGRADE_MENU_LAYOUT.detailTopGap;
  const detailHeight = 7 + (UPGRADE_MENU_LAYOUT.detailLineCount - 1) * UPGRADE_MENU_LAYOUT.detailLineHeight;
  return detailTop + detailHeight + UPGRADE_MENU_LAYOUT.bottomPadding;
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

function drawHudResource(ctx, label, value, labelX, countRight, y, textRenderer, colors) {
  const count = String(Math.min(ENGINE.player.maxResourceAmount, Math.max(0, Math.floor(value))));
  const countWidth = textRenderer.measure(count, { fontSize: 8 });

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
  const effects = aggregateUpgradeEffects(player.upgrades);
  const rearAngle = player.angle + Math.PI;
  const rear = {
    x: Math.cos(rearAngle),
    y: Math.sin(rearAngle)
  };
  const side = {
    x: Math.cos(player.angle + Math.PI / 2),
    y: Math.sin(player.angle + Math.PI / 2)
  };
  const center = boosterClusterCenter(player, rear, side);
  const origin = {
    x: center.x + rear.x * (SMALL_ORB_RADIUS + 1),
    y: center.y + rear.y * (SMALL_ORB_RADIUS + 1)
  };
  const key = player.id || String(player.number);
  const particleMultiplier = effects.thrusterParticleMultiplier;
  const carry = (state.emitCarry.get(key) || 0) + THRUSTER_PARTICLE_RATE * particleMultiplier * dtSeconds;
  const count = Math.floor(carry);
  state.emitCarry.set(key, carry - count);

  for (let index = 0; index < count; index += 1) {
    const seed = state.nextSeed();
    const sideJitter = (randomUnit(seed, 1) - 0.5) * 4;
    const rearJitter = (randomUnit(seed, 2) - 0.5) * 2;
    const speed = (38 + randomUnit(seed, 3) * 72) * Math.sqrt(particleMultiplier);
    const spread = (randomUnit(seed, 4) - 0.5) * 42 * Math.sqrt(particleMultiplier);
    const life = 0.22 + randomUnit(seed, 5) * 0.34;

    state.particles.push({
      x: origin.x + side.x * sideJitter + rear.x * rearJitter,
      y: origin.y + side.y * sideJitter + rear.y * rearJitter,
      vx: (player.vx || 0) + rear.x * speed + side.x * spread,
      vy: (player.vy || 0) + rear.y * speed + side.y * spread,
      age: randomUnit(seed, 6) * 0.025,
      life,
      seed
    });
  }

  if (state.particles.length > MAX_PARTICLES) {
    state.particles.splice(0, state.particles.length - MAX_PARTICLES);
  }
}

function emitMiningParticles(state, player, dtSeconds) {
  const ray = player.miningRay;
  const effects = aggregateUpgradeEffects(player.upgrades);
  const direction = {
    x: Math.cos(player.aimAngle ?? player.angle),
    y: Math.sin(player.aimAngle ?? player.angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const key = `mine:${player.id || player.number}`;
  const carry =
    (state.emitCarry.get(key) || 0) +
    MINING_PARTICLE_RATE * effects.miningParticleMultiplier * dtSeconds;
  const count = Math.floor(carry);
  state.emitCarry.set(key, carry - count);

  for (let index = 0; index < count; index += 1) {
    const seed = state.nextSeed();
    const sideJitter = (randomUnit(seed, 1) - 0.5) * 6;
    const impactJitter = randomUnit(seed, 2) * 2;
    const speed = 16 + randomUnit(seed, 3) * 44;
    const spread = (randomUnit(seed, 4) - 0.5) * 36;
    const life = 0.12 + randomUnit(seed, 5) * 0.24;

    state.miningParticles.push({
      x: ray.endX - direction.x * impactJitter + normal.x * sideJitter,
      y: ray.endY - direction.y * impactJitter + normal.y * sideJitter,
      vx: -direction.x * speed + normal.x * spread,
      vy: -direction.y * speed + normal.y * spread,
      age: 0,
      life,
      seed
    });
  }

  if (state.miningParticles.length > MAX_PARTICLES) {
    state.miningParticles.splice(0, state.miningParticles.length - MAX_PARTICLES);
  }
}

function boosterClusterCenter(player, rear, side) {
  const sum = REAR_ORBS.reduce(
    (total, orb) => ({
      rear: total.rear + orb.rear,
      side: total.side + orb.side
    }),
    { rear: 0, side: 0 }
  );

  return {
    x: player.x + rear.x * (sum.rear / REAR_ORBS.length) + side.x * (sum.side / REAR_ORBS.length),
    y: player.y + rear.y * (sum.rear / REAR_ORBS.length) + side.y * (sum.side / REAR_ORBS.length)
  };
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
    const size = progress < 0.18 && particle.seed % 7 === 0 ? 2 : 1;
    ctx.fillRect(screen.x, screen.y, size, size);
  }
}

function drawSphere(ctx, cx, cy, radius, angle, colors, occluders = []) {
  void angle;
  ctx.fillStyle = colors.background;
  fillDisk(ctx, cx, cy, radius, occluders);
  ctx.fillStyle = colors.foreground;
  drawCircle(ctx, cx, cy, radius, occluders);
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

function drawMiningRay(ctx, player, camera, asteroid, timeSeconds, colors) {
  ctx.fillStyle = colors.foreground;
  const effects = aggregateUpgradeEffects(player.upgrades);
  const rayLength = ENGINE.mining.rayLength + effects.rayLengthBonus;
  const hasFullTip = Number.isFinite(player.miningRay?.fullEndX) && Number.isFinite(player.miningRay?.fullEndY);
  const rawExtension = hasFullTip || !player.miningRay
    ? player.rayExtension ?? player.miningRay?.extension ?? 1
    : 1;
  const extension = Number.isFinite(rawExtension) ? clamp(rawExtension, 0, 1) : 1;
  const angle = player.aimAngle ?? player.angle;
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const fallbackStart = {
    x: player.x + direction.x * player.radius,
    y: player.y + direction.y * player.radius
  };
  const fallbackHit = !player.miningRay && asteroid
    ? raycastAsteroid(asteroid, fallbackStart.x, fallbackStart.y, angle, rayLength, {
        blockNonPlayable: !asteroid.storm
      })
    : null;
  const startWorld = player.miningRay
    ? { x: player.miningRay.startX, y: player.miningRay.startY }
    : fallbackStart;
  const fullTipWorld = player.miningRay
    ? {
        x: hasFullTip ? player.miningRay.fullEndX : player.miningRay.endX,
        y: hasFullTip ? player.miningRay.fullEndY : player.miningRay.endY
      }
    : fallbackHit
      ? { x: fallbackHit.x, y: fallbackHit.y }
    : {
        x: fallbackStart.x + direction.x * rayLength,
        y: fallbackStart.y + direction.y * rayLength
      };
  const activeTipWorld = player.miningRay
    ? { x: player.miningRay.endX, y: player.miningRay.endY }
    : null;
  const start = worldToScreen(startWorld, camera);
  const phase = timeSeconds * MINING_RAY_BASE_SPIN_RATE * effects.raySpinMultiplier + player.number;
  const fullTip = worldToScreen(fullTipWorld, camera);
  const activeTip = activeTipWorld ? worldToScreen(activeTipWorld, camera) : null;

  for (let index = 0; index < 3; index += 1) {
    const offset = Math.round(Math.sin(phase + (index * Math.PI * 2) / 3) * 2);
    const from = {
      x: Math.round(start.x + normal.x * offset),
      y: Math.round(start.y + normal.y * offset)
    };
    const fullDx = fullTip.x - from.x;
    const fullDy = fullTip.y - from.y;
    const fullLength = Math.hypot(fullDx, fullDy);
    if (fullLength <= 0) {
      continue;
    }
    const activeLength = activeTip
      ? Math.hypot(activeTip.x - from.x, activeTip.y - from.y)
      : 0;
    const visibleLength = clamp(Math.max(fullLength * extension, activeLength), 0, fullLength);
    const visibleTip = {
      x: Math.round(from.x + (fullDx / fullLength) * visibleLength),
      y: Math.round(from.y + (fullDy / fullLength) * visibleLength)
    };
    drawPixelLine(ctx, from.x, from.y, visibleTip.x, visibleTip.y);
  }
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

function randomUnit(seed, salt) {
  let value = Math.imul(seed ^ Math.imul(salt + 1, 374761393), 668265263);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
