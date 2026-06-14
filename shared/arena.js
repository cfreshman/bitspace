import { ENGINE, RENDER } from "./constants.js";
import { createEmptyInput, normalizeInput } from "./input.js";
import {
  clamp,
  clampMagnitude,
  roundForSnapshot
} from "./math.js";

const DEFAULT_ARENA_ID = "main";

export function createArena(options = {}) {
  return {
    id: options.id ?? DEFAULT_ARENA_ID,
    seed: options.seed ?? "bitspace-main",
    tick: 0,
    players: new Map(),
    // Extension channels are intentionally empty until the game design is explicit.
    entities: new Map(),
    effects: []
  };
}

export function addPlayer(arena, playerOptions) {
  if (arena.players.size >= ENGINE.maxPlayers) {
    return { ok: false, reason: "arena_full" };
  }

  const number = nextPlayerNumber(arena);
  const spawn = spawnForPlayerNumber(number);
  const player = {
    id: playerOptions.id,
    number,
    name: sanitizePlayerName(playerOptions.name || `Pilot ${number}`),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: spawn.angle,
    aimAngle: spawn.angle,
    mining: false,
    thrusting: false,
    radius: ENGINE.ship.radius,
    alive: true,
    input: createEmptyInput(),
    lastInputSeq: 0,
    joinedAtTick: arena.tick
  };

  arena.players.set(player.id, player);
  return { ok: true, player };
}

export function removePlayer(arena, playerId) {
  return arena.players.delete(playerId);
}

export function setPlayerInput(arena, playerId, payload) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  const input = normalizeInput(payload);
  if (input.seq !== 0 && input.seq < player.lastInputSeq) {
    return false;
  }

  player.input = input;
  player.lastInputSeq = Math.max(player.lastInputSeq, input.seq);
  return true;
}

export function setPlayerName(arena, playerId, name) {
  const player = arena.players.get(playerId);
  if (!player) {
    return false;
  }

  player.name = sanitizePlayerName(name || player.name);
  return true;
}

export function stepArena(arena, dtSeconds = 1 / ENGINE.tickRate) {
  arena.tick += 1;

  for (const player of arena.players.values()) {
    if (player.alive) {
      stepPlayer(player, dtSeconds);
    }
  }
}

export function snapshotArena(arena) {
  return {
    arenaId: arena.id,
    tick: arena.tick,
    serverTime: Date.now(),
    render: RENDER,
    world: ENGINE.world,
    players: Array.from(arena.players.values()).map(snapshotPlayer),
    entities: Array.from(arena.entities.values()),
    effects: arena.effects
  };
}

export function lobbySnapshot(arena) {
  return Array.from(arena.players.values())
    .sort((a, b) => a.number - b.number)
    .map((player) => ({
      id: player.id,
      number: player.number,
      name: player.name,
      alive: player.alive
    }));
}

export function sanitizePlayerName(name) {
  return String(name)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18) || "Pilot";
}

function stepPlayer(player, dtSeconds) {
  const move = clampMagnitude(player.input.moveX, player.input.moveY, 1);
  const isMoving = move.x !== 0 || move.y !== 0;
  player.thrusting = isMoving;

  if (isMoving) {
    player.angle = normalizeAngle(Math.atan2(move.y, move.x));
    player.vx += move.x * ENGINE.ship.thrust * dtSeconds;
    player.vy += move.y * ENGINE.ship.thrust * dtSeconds;
  }

  player.aimAngle = player.input.aimAngle;
  player.mining = player.input.mining;

  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const drag = Math.pow(ENGINE.ship.drag, dtSeconds / fixedStepSeconds);
  player.vx *= drag;
  player.vy *= drag;

  const velocity = clampMagnitude(player.vx, player.vy, ENGINE.ship.maxSpeed);
  player.vx = velocity.x;
  player.vy = velocity.y;

  player.x += player.vx * dtSeconds;
  player.y += player.vy * dtSeconds;

  constrainPlayerToWorld(player);
}

function constrainPlayerToWorld(player) {
  const min = player.radius;
  const maxX = ENGINE.world.width - player.radius;
  const maxY = ENGINE.world.height - player.radius;
  const x = clamp(player.x, min, maxX);
  const y = clamp(player.y, min, maxY);

  if (x !== player.x) {
    player.vx *= -0.25;
  }

  if (y !== player.y) {
    player.vy *= -0.25;
  }

  player.x = x;
  player.y = y;
}

function nextPlayerNumber(arena) {
  const usedNumbers = new Set(
    Array.from(arena.players.values()).map((player) => player.number)
  );

  for (let number = 1; number <= ENGINE.maxPlayers; number += 1) {
    if (!usedNumbers.has(number)) {
      return number;
    }
  }

  return arena.players.size + 1;
}

function spawnForPlayerNumber(number) {
  const margin = Math.max(RENDER.width, ENGINE.world.sectorSize * 32);
  const maxX = ENGINE.world.width - margin;
  const maxY = ENGINE.world.height - margin;
  const spawns = [
    { x: margin, y: margin, angle: Math.PI / 4 },
    { x: maxX, y: margin, angle: (Math.PI * 3) / 4 },
    { x: maxX, y: maxY, angle: (-Math.PI * 3) / 4 },
    { x: margin, y: maxY, angle: -Math.PI / 4 }
  ];

  return spawns[(number - 1) % spawns.length];
}

function snapshotPlayer(player) {
  return {
    id: player.id,
    number: player.number,
    name: player.name,
    x: roundForSnapshot(player.x),
    y: roundForSnapshot(player.y),
    vx: roundForSnapshot(player.vx),
    vy: roundForSnapshot(player.vy),
    angle: roundForSnapshot(player.angle),
    aimAngle: roundForSnapshot(player.aimAngle),
    mining: player.mining,
    thrusting: player.thrusting,
    radius: player.radius,
    alive: player.alive
  };
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}
