import { RENDER } from "/shared/constants.js";

const ENTITY_PIXEL_SIZE = 1;
const STAR_CELL_SIZE = 16;
const STAR_PARALLAX = 0.22;
const SMALL_ORB_RADIUS = 3;
const REAR_ORBS = Object.freeze([
  { rear: 9, side: 0 },
  { rear: 7, side: -5 },
  { rear: 7, side: 5 }
]);
const MINING_RAY_LENGTH = 28;
const THRUSTER_PARTICLE_RATE = 70;
const MAX_THRUSTER_PARTICLES = 180;

export function createRenderer(canvas) {
  canvas.width = RENDER.width;
  canvas.height = RENDER.height;
  const canvasContext = canvas.getContext("2d", { alpha: false });
  const surface = createPixelSurface(canvasContext, RENDER.width, RENDER.height);
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

      drawFrame(surface, snapshot, { ...options, timeSeconds, dtSeconds }, colors, {
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

function drawFrame(ctx, snapshot, options, colors, particleState) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, RENDER.width, RENDER.height);
  ctx.fillStyle = colors.foreground;

  if (!snapshot) {
    drawBootMark(ctx);
    return;
  }

  const camera = cameraForSnapshot(snapshot, options.playerId);
  drawStars(ctx, snapshot, camera);
  drawWorldBounds(ctx, snapshot, camera);

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

  for (const renderPlayer of renderPlayers) {
    if (renderPlayer.thrusting) {
      emitThrusterParticles(particleState, renderPlayer, options.dtSeconds);
    }
  }

  updateThrusterParticles(particleState.particles, options.dtSeconds);
  drawThrusterParticles(ctx, particleState.particles, camera, colors, options.timeSeconds);

  for (const renderPlayer of renderPlayers) {
    if (renderPlayer.mining) {
      drawMiningRay(ctx, renderPlayer, camera, options.timeSeconds ?? snapshot.tick / 60, colors);
    }
    drawShip(ctx, renderPlayer, camera, colors, options.timeSeconds ?? snapshot.tick / 60);
  }
}

function cameraForSnapshot(snapshot, playerId) {
  const target =
    snapshot.players.find((player) => player.id === playerId) ||
    snapshot.players[0] || {
      x: snapshot.world.width / 2,
      y: snapshot.world.height / 2
    };

  return {
    x: target.x - RENDER.width / 2,
    y: target.y - RENDER.height / 2
  };
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

  for (const orb of REAR_ORBS) {
    const orbX = Math.round(x + rear.x * orb.rear + side.x * orb.side);
    const orbY = Math.round(y + rear.y * orb.rear + side.y * orb.side);
    drawSphere(ctx, orbX, orbY, SMALL_ORB_RADIUS, player.angle, colors, [mainOccluder]);
  }

  drawSphere(ctx, x, y, player.radius, player.angle, colors);
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

  if (state.particles.length > MAX_THRUSTER_PARTICLES) {
    state.particles.splice(0, state.particles.length - MAX_THRUSTER_PARTICLES);
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

function drawMiningRay(ctx, player, camera, timeSeconds, colors) {
  ctx.fillStyle = colors.foreground;
  const center = worldToScreen(player, camera);
  const angle = player.aimAngle ?? player.angle;
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const normal = {
    x: -direction.y,
    y: direction.x
  };
  const start = {
    x: center.x + direction.x * player.radius,
    y: center.y + direction.y * player.radius
  };
  const length = MINING_RAY_LENGTH;
  const phase = timeSeconds * 10 + player.number;
  const tip = {
    x: Math.round(start.x + direction.x * length),
    y: Math.round(start.y + direction.y * length)
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
