import { ENGINE, RENDER } from "/shared/constants.js";
import { ASTEROID_TILE, raycastAsteroid } from "/shared/asteroid.js";

const ENTITY_PIXEL_SIZE = 1;
const STAR_CELL_SIZE = 16;
const STAR_PARALLAX = 0.22;
const ASTEROID_DASH_PERIOD = 10;
const ASTEROID_DASH_ON = 5;
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
const MAX_PARTICLES = 260;
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
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"]
});

export function createRenderer(canvas) {
  canvas.width = RENDER.width;
  canvas.height = RENDER.height;
  const canvasContext = canvas.getContext("2d", { alpha: false });
  const surface = createPixelSurface(canvasContext, RENDER.width, RENDER.height);
  const textRenderer = createPixelTextRenderer(RENDER.width, RENDER.height);
  const colors = {
    foreground: RENDER.foreground,
    background: RENDER.background
  };
  const particles = [];
  const emitCarry = new Map();
  let particleSeed = 1;
  let lastFrameTime = null;

  function sizeCanvasBox() {
    const viewport = getViewportSize();
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  }

  sizeCanvasBox();
  window.addEventListener("resize", sizeCanvasBox);
  window.visualViewport?.addEventListener("resize", sizeCanvasBox);
  window.visualViewport?.addEventListener("scroll", sizeCanvasBox);

  return {
    draw(snapshot, options = {}) {
      const timeSeconds = options.timeSeconds ?? snapshot?.tick / 60 ?? performance.now() / 1000;
      const dtSeconds =
        lastFrameTime === null ? 1 / 60 : clamp(timeSeconds - lastFrameTime, 0, 1 / 15);
      lastFrameTime = timeSeconds;

      if (snapshot?.render) {
        colors.foreground = snapshot.render.foreground || colors.foreground;
        colors.background = snapshot.render.background || colors.background;
      }

      drawFrame(surface, snapshot, { ...options, timeSeconds, dtSeconds }, colors, textRenderer, {
        particles,
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

function createPixelSurface(canvasContext, width, height) {
  const imageData = canvasContext.createImageData(width, height);
  const pixels = new Uint32Array(imageData.data.buffer);
  const colorCache = new Map();
  let currentColor = packColor(RENDER.foreground);

  return {
    imageSmoothingEnabled: false,
    set fillStyle(value) {
      currentColor = colorFor(value, colorCache);
    },
    get fillStyle() {
      return currentColor;
    },
    fillRect(x, y, rectWidth, rectHeight) {
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(width, Math.ceil(x + rectWidth));
      const y1 = Math.min(height, Math.ceil(y + rectHeight));

      if (x0 >= x1 || y0 >= y1) {
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
  return {
    width: Math.max(1, Math.floor(viewport?.width || window.innerWidth)),
    height: Math.max(1, Math.floor(viewport?.height || window.innerHeight))
  };
}

function drawFrame(ctx, snapshot, options, colors, textRenderer, particleState) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, RENDER.width, RENDER.height);
  ctx.fillStyle = colors.foreground;

  if (!snapshot) {
    drawBootMark(ctx);
    return;
  }

  const camera = cameraForSnapshot(snapshot, options.playerId, options.timeSeconds);
  const diamondMiningTargets = diamondMiningTargetMap(snapshot);
  drawStars(ctx, snapshot, camera);
  if (options.asteroid) {
    drawAsteroid(ctx, options.asteroid, camera, colors, options.timeSeconds ?? snapshot.tick / 60, diamondMiningTargets);
  } else {
    drawWorldBounds(ctx, snapshot, camera);
  }

  for (const entity of snapshot.entities || []) {
    drawEntity(ctx, entity, camera);
  }

  const renderPlayers = snapshot.players.map((player) =>
    player.id === options.playerId
      ? {
          ...player,
          aimAngle: options.aimAngle ?? player.aimAngle,
          mining: options.mining ?? player.mining
        }
      : player
  );
  const localPlayer = renderPlayers.find((player) => player.id === options.playerId);

  for (const renderPlayer of renderPlayers) {
    if (renderPlayer.thrusting) {
      emitThrusterParticles(particleState, renderPlayer, options.dtSeconds);
    }

    if (renderPlayer.mining && renderPlayer.miningRay?.hit) {
      emitMiningParticles(particleState, renderPlayer, options.dtSeconds);
    }
  }

  updateThrusterParticles(particleState.particles, options.dtSeconds);
  drawThrusterParticles(ctx, particleState.particles, camera, colors, options.timeSeconds);

  for (const renderPlayer of renderPlayers) {
    if (renderPlayer.mining) {
      drawMiningRay(ctx, renderPlayer, camera, options.asteroid, options.timeSeconds ?? snapshot.tick / 60, colors);
    }
    drawShip(ctx, renderPlayer, camera, colors, options.timeSeconds ?? snapshot.tick / 60);
  }

  for (const renderPlayer of renderPlayers) {
    drawTalkBubble(ctx, renderPlayer, camera, colors, textRenderer);
  }

  drawPlayerHud(
    ctx,
    localPlayer,
    colors,
    textRenderer
  );
  drawChatOverlay(ctx, options.chat, colors, textRenderer, options.timeSeconds);
}

function cameraForSnapshot(snapshot, playerId, timeSeconds = 0) {
  const target =
    snapshot.players.find((player) => player.id === playerId) ||
    snapshot.players[0] || {
      x: snapshot.world.width / 2,
      y: snapshot.world.height / 2,
      shake: 0
    };
  const shake = shakeOffset(target.shake || 0, timeSeconds);

  return {
    x: target.x - RENDER.width / 2 + shake.x,
    y: target.y - RENDER.height / 2 + shake.y
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

function diamondMiningTargetMap(snapshot) {
  const targets = new Map();

  for (const miningState of snapshot.asteroidMining || []) {
    if (miningState.phase === ASTEROID_TILE.diamond) {
      targets.set(miningState.index, miningState.progress || 0);
    }
  }

  for (const player of snapshot.players || []) {
    if (player.miningRay?.mineable && player.miningRay.tile === ASTEROID_TILE.diamond) {
      targets.set(player.miningRay.index, player.miningRay.progress || 0);
    }
  }

  return targets;
}

function drawAsteroid(ctx, asteroid, camera, colors, timeSeconds, diamondMiningTargets) {
  drawAsteroidTiles(ctx, asteroid, camera, colors, timeSeconds, diamondMiningTargets);
  drawAsteroidBoundary(ctx, asteroid, camera, colors);
}

function drawAsteroidTiles(ctx, asteroid, camera, colors, timeSeconds, diamondMiningTargets) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const minTileX = Math.max(0, Math.floor(camera.x / tileSize) - 1);
  const maxTileX = Math.min(
    asteroid.widthTiles - 1,
    Math.ceil((camera.x + RENDER.width) / tileSize) + 1
  );
  const minTileY = Math.max(0, Math.floor(camera.y / tileSize) - 1);
  const maxTileY = Math.min(
    asteroid.heightTiles - 1,
    Math.ceil((camera.y + RENDER.height) / tileSize) + 1
  );

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const index = tileY * asteroid.widthTiles + tileX;
      const tile = asteroid.tiles[index];
      if (!isRockTile(tile)) {
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
      if (!isRockTile(tile)) {
        continue;
      }

      const screenX = Math.round(tileX * tileSize - camera.x);
      const screenY = Math.round(tileY * tileSize - camera.y);
      drawRockOutline(ctx, asteroid, tileX, tileY, screenX, screenY, tileSize, colors);
    }
  }

  drawInnerRockCornerConnectors(ctx, asteroid, camera, tileSize, minTileX, maxTileX, minTileY, maxTileY, colors);

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
        drawOreRings(ctx, screenX, screenY, tileSize, amountAt(asteroid, index), hashCell(asteroid.seed, tileX, tileY));
      } else if (tile === ASTEROID_TILE.diamond) {
        drawDiamondWireframe(
          ctx,
          screenX,
          screenY,
          tileSize,
          hashCell(asteroid.seed, tileX, tileY),
          diamondMiningTargets.get(index) ?? null
        );
      }
    }
  }
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

function drawOreRings(ctx, tileX, tileY, size, amount, hash) {
  const count = clamp(Math.round(amount), 1, 3);

  for (let index = 0; index < count; index += 1) {
    const seed = hash ^ Math.imul(index + 1, 1597334677);
    const radius = 2 + randomUnit(seed, 1) * 0.65;
    const margin = Math.ceil(radius + 2);
    const center = {
      x: tileX + margin + Math.round(randomUnit(seed, 2) * (size - margin * 2)),
      y: tileY + margin + Math.round(randomUnit(seed, 3) * (size - margin * 2))
    };
    const tilt = randomUnit(seed, 4) * (Math.PI / 4);
    const tiltAxis = randomUnit(seed, 5) * Math.PI * 2;
    const spin = randomUnit(seed, 6) * Math.PI * 2;

    drawProjectedRing(ctx, center.x, center.y, radius, tilt, tiltAxis, spin);
  }
}

function drawProjectedRing(ctx, centerX, centerY, radius, tilt, tiltAxis, spin) {
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

  for (let step = 0; step < 16; step += 1) {
    const angle = spin + (step / 16) * Math.PI * 2;
    const alongAxis = Math.cos(angle) * radius;
    const alongTilt = Math.sin(angle) * radius;
    const z = alongTilt * sinTilt;
    const perspective = 1 + z * 0.035;
    points.push({
      x: Math.round(centerX + (axis.x * alongAxis + perpendicular.x * alongTilt * cosTilt) * perspective),
      y: Math.round(centerY + (axis.y * alongAxis + perpendicular.y * alongTilt * cosTilt) * perspective)
    });
  }

  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    drawPixelLine(ctx, from.x, from.y, to.x, to.y);
  }
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

function drawAsteroidBoundary(ctx, asteroid, camera, colors) {
  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const minTileX = Math.max(0, Math.floor(camera.x / tileSize) - 1);
  const maxTileX = Math.min(
    asteroid.widthTiles - 1,
    Math.ceil((camera.x + RENDER.width) / tileSize) + 1
  );
  const minTileY = Math.max(0, Math.floor(camera.y / tileSize) - 1);
  const maxTileY = Math.min(
    asteroid.heightTiles - 1,
    Math.ceil((camera.y + RENDER.height) / tileSize) + 1
  );

  ctx.fillStyle = colors.foreground;

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (!isPlayableTile(asteroid, tileX, tileY)) {
        continue;
      }

      const screenX = Math.round(tileX * tileSize - camera.x);
      const screenY = Math.round(tileY * tileSize - camera.y);

      if (!isPlayableTile(asteroid, tileX - 1, tileY)) {
        drawDashedBoundaryVertical(ctx, screenX, screenY, tileSize, tileY * tileSize);
      }

      if (!isPlayableTile(asteroid, tileX + 1, tileY)) {
        drawDashedBoundaryVertical(ctx, screenX + tileSize - 1, screenY, tileSize, tileY * tileSize);
      }

      if (!isPlayableTile(asteroid, tileX, tileY - 1)) {
        drawDashedBoundaryHorizontal(ctx, screenX, screenY, tileSize, tileX * tileSize);
      }

      if (!isPlayableTile(asteroid, tileX, tileY + 1)) {
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

function isRockTileAt(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  return isRockTile(asteroid.tiles[tileY * asteroid.widthTiles + tileX]);
}

function amountAt(asteroid, index) {
  return Number.parseInt(asteroid.amounts[index] || "0", 36) || 0;
}

function isPlayableTile(asteroid, tileX, tileY) {
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return false;
  }

  return asteroid.playable[tileY * asteroid.widthTiles + tileX] === "1";
}

function drawWorldBounds(ctx, snapshot, camera) {
  const left = Math.round(-camera.x);
  const top = Math.round(-camera.y);
  const right = Math.round(snapshot.world.width - camera.x);
  const bottom = Math.round(snapshot.world.height - camera.y);

  if (left >= 0 && left < RENDER.width) {
    drawDashedVerticalLine(ctx, left, top, bottom, camera.y);
  }

  if (top >= 0 && top < RENDER.height) {
    drawDashedHorizontalLine(ctx, top, left, right, camera.x);
  }

  if (right >= 0 && right < RENDER.width) {
    drawDashedVerticalLine(ctx, right, top, bottom, camera.y);
  }

  if (bottom >= 0 && bottom < RENDER.height) {
    drawDashedHorizontalLine(ctx, bottom, left, right, camera.x);
  }
}

function drawDashedVerticalLine(ctx, x, worldTop, worldBottom, cameraY) {
  const start = Math.max(0, worldTop);
  const end = Math.min(RENDER.height - 1, worldBottom);

  for (let y = start; y <= end; y += 1) {
    if (positiveModulo(Math.floor(cameraY + y), 8) < 4) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawDashedHorizontalLine(ctx, y, worldLeft, worldRight, cameraX) {
  const start = Math.max(0, worldLeft);
  const end = Math.min(RENDER.width - 1, worldRight);

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
  const starCamera = {
    x: camera.x * STAR_PARALLAX,
    y: camera.y * STAR_PARALLAX
  };
  const minCellX = Math.floor(starCamera.x / STAR_CELL_SIZE) - 1;
  const maxCellX = Math.ceil((starCamera.x + RENDER.width) / STAR_CELL_SIZE) + 1;
  const minCellY = Math.floor(starCamera.y / STAR_CELL_SIZE) - 1;
  const maxCellY = Math.ceil((starCamera.y + RENDER.height) / STAR_CELL_SIZE) + 1;

  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const hash = hashCell(snapshot.arenaId, cellX, cellY);
      const x = cellX * STAR_CELL_SIZE + (hash % STAR_CELL_SIZE);
      const y = cellY * STAR_CELL_SIZE + ((hash >>> 8) % STAR_CELL_SIZE);
      const screen = worldToScreen({ x, y }, starCamera);

      if (screen.x < 0 || screen.x >= RENDER.width || screen.y < 0 || screen.y >= RENDER.height) {
        continue;
      }

      if (hash % 181 === 0) {
        drawLargeStar(ctx, screen.x, screen.y, hash);
      } else if (hash % 61 === 0) {
        drawMediumStar(ctx, screen.x, screen.y, hash);
      } else if (hash % 13 === 0) {
        ctx.fillRect(screen.x, screen.y, 1, 1);
      }
    }
  }
}

function drawLargeStar(ctx, x, y, hash) {
  ctx.fillRect(x, y, 1, 1);
  ctx.fillRect(x - 1, y, 1, 1);
  ctx.fillRect(x + 1, y, 1, 1);
  ctx.fillRect(x, y - 1, 1, 1);
  ctx.fillRect(x, y + 1, 1, 1);

  if (hash & 1) {
    ctx.fillRect(x - 2, y, 1, 1);
    ctx.fillRect(x + 2, y, 1, 1);
  } else {
    ctx.fillRect(x, y - 2, 1, 1);
    ctx.fillRect(x, y + 2, 1, 1);
  }
}

function drawMediumStar(ctx, x, y, hash) {
  ctx.fillRect(x, y, 1, 1);
  if (hash & 1) {
    ctx.fillRect(x + 1, y, 1, 1);
  } else {
    ctx.fillRect(x, y + 1, 1, 1);
  }
}

function drawEntity(ctx, entity, camera) {
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

function drawShip(ctx, player, camera, colors, timeSeconds) {
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
  const x = clamp(Math.round(screen.x - width / 2), 2, RENDER.width - width - 2);
  const y = clamp(Math.round(screen.y - player.radius - height - 9), 2, RENDER.height - height - 2);

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
  const panelY = RENDER.height - 43;
  const panelWidth = RENDER.width - panelX * 2;
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

function drawHudHealthBars(ctx, x, y, width, height, health, maxHealth, bars, colors) {
  const gap = 1;
  const segmentWidth = Math.max(3, Math.floor((width - gap * (bars - 1)) / bars));
  const segmentHealth = maxHealth / bars;

  for (let index = 0; index < bars; index += 1) {
    const segmentX = x + index * (segmentWidth + gap);
    const segmentProgress = clamp((health - segmentHealth * index) / segmentHealth, 0, 1);
    const fillWidth = Math.round((segmentWidth - 2) * segmentProgress);

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
  const carry = (state.emitCarry.get(key) || 0) + THRUSTER_PARTICLE_RATE * dtSeconds;
  const count = Math.floor(carry);
  state.emitCarry.set(key, carry - count);

  for (let index = 0; index < count; index += 1) {
    const seed = state.nextSeed();
    const sideJitter = (randomUnit(seed, 1) - 0.5) * 4;
    const rearJitter = (randomUnit(seed, 2) - 0.5) * 2;
    const speed = 38 + randomUnit(seed, 3) * 72;
    const spread = (randomUnit(seed, 4) - 0.5) * 42;
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
  const direction = {
    x: Math.cos(player.aimAngle ?? player.angle),
    y: Math.sin(player.aimAngle ?? player.angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const key = `mine:${player.id || player.number}`;
  const carry = (state.emitCarry.get(key) || 0) + MINING_PARTICLE_RATE * dtSeconds;
  const count = Math.floor(carry);
  state.emitCarry.set(key, carry - count);

  for (let index = 0; index < count; index += 1) {
    const seed = state.nextSeed();
    const sideJitter = (randomUnit(seed, 1) - 0.5) * 6;
    const impactJitter = randomUnit(seed, 2) * 2;
    const speed = 16 + randomUnit(seed, 3) * 44;
    const spread = (randomUnit(seed, 4) - 0.5) * 36;
    const life = 0.12 + randomUnit(seed, 5) * 0.24;

    state.particles.push({
      x: ray.endX - direction.x * impactJitter + normal.x * sideJitter,
      y: ray.endY - direction.y * impactJitter + normal.y * sideJitter,
      vx: -direction.x * speed + normal.x * spread,
      vy: -direction.y * speed + normal.y * spread,
      age: 0,
      life,
      seed
    });
  }

  if (state.particles.length > MAX_PARTICLES) {
    state.particles.splice(0, state.particles.length - MAX_PARTICLES);
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

function updateThrusterParticles(particles, dtSeconds) {
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

function drawThrusterParticles(ctx, particles, camera, colors, timeSeconds) {
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
  const angle = player.aimAngle ?? player.angle;
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const center = worldToScreen(player, camera);
  const fallbackStart = {
    x: player.x + direction.x * player.radius,
    y: player.y + direction.y * player.radius
  };
  const fallbackHit = !player.miningRay && asteroid
    ? raycastAsteroid(asteroid, fallbackStart.x, fallbackStart.y, angle, ENGINE.mining.rayLength)
    : null;
  const start = player.miningRay
    ? worldToScreen({ x: player.miningRay.startX, y: player.miningRay.startY }, camera)
    : {
        x: center.x + direction.x * player.radius,
        y: center.y + direction.y * player.radius
      };
  const phase = timeSeconds * 10 + player.number;
  const tip = player.miningRay
    ? worldToScreen({ x: player.miningRay.endX, y: player.miningRay.endY }, camera)
    : fallbackHit
      ? worldToScreen(fallbackHit, camera)
    : {
        x: Math.round(start.x + direction.x * ENGINE.mining.rayLength),
        y: Math.round(start.y + direction.y * ENGINE.mining.rayLength)
      };

  for (let index = 0; index < 3; index += 1) {
    const offset = Math.round(Math.sin(phase + (index * Math.PI * 2) / 3) * 2);
    const from = {
      x: Math.round(start.x + normal.x * offset),
      y: Math.round(start.y + normal.y * offset)
    };
    drawPixelLine(ctx, from.x, from.y, tip.x, tip.y);
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
    return dx * dx + dy * dy <= occluder.radius * occluder.radius;
  });
}

function drawBootMark(ctx) {
  const x = Math.floor(RENDER.width / 2);
  const y = Math.floor(RENDER.height / 2);
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
