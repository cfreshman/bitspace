import express from "express";
import { randomBytes } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

import { ENGINE, RENDER } from "../shared/constants.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../shared/protocol.js";
import {
  addPlayer,
  createArena,
  lobbySnapshot,
  removePlayer,
  sanitizePlayerName,
  setPlayerInput,
  setPlayerName,
  setPlayerTalk,
  snapshotAsteroid,
  snapshotArena,
  takeAsteroidUpdates,
  stepArena
} from "../shared/arena.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const sharedDir = path.join(rootDir, "shared");
const port = Number(process.env.PORT || process.env.BITSPACE_PORT || 7023);
const arenaRoom = "arena:main";
const arenaSeed = process.env.BITSPACE_SEED || createArenaSeed();
const arena = createArena({ id: "main", seed: arenaSeed });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true
});

app.disable("x-powered-by");
app.use("/shared", express.static(sharedDir));
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    name: "BITSPACE",
    arena: arena.id,
    seed: arena.seed,
    asteroidSeed: arena.asteroid.seed,
    tick: arena.tick,
    players: arena.players.size,
    maxPlayers: ENGINE.maxPlayers,
    uptime: process.uptime()
  });
});

let lastTickTime = performance.now();

io.on("connection", (socket) => {
  const requestedName = sanitizePlayerName(socket.handshake.auth?.name || "");
  const joinResult = addPlayer(arena, {
    id: socket.id,
    name: requestedName || undefined
  });

  if (!joinResult.ok) {
    socket.emit(SERVER_EVENTS.error, {
      code: joinResult.reason,
      message: "Arena is full."
    });
    socket.disconnect(true);
    return;
  }

  socket.join(arenaRoom);
  socket.emit(SERVER_EVENTS.welcome, {
    playerId: socket.id,
    arenaId: arena.id,
    tickRate: ENGINE.tickRate,
    snapshotRate: ENGINE.snapshotRate,
    maxPlayers: ENGINE.maxPlayers,
    seed: arena.seed,
    asteroidSeed: arena.asteroid.seed,
    render: RENDER,
    world: ENGINE.world
  });
  socket.emit(SERVER_EVENTS.asteroid, snapshotAsteroid(arena));
  socket.emit(SERVER_EVENTS.snapshot, snapshotArena(arena));
  broadcastLobby();

  socket.on(CLIENT_EVENTS.input, (payload) => {
    setPlayerInput(arena, socket.id, payload);
  });

  socket.on(CLIENT_EVENTS.setName, (name) => {
    if (setPlayerName(arena, socket.id, name)) {
      broadcastLobby();
    }
  });

  socket.on(CLIENT_EVENTS.talk, (text) => {
    setPlayerTalk(arena, socket.id, text);
  });

  socket.on("disconnect", () => {
    removePlayer(arena, socket.id);
    broadcastLobby();
  });
});

setInterval(() => {
  const now = performance.now();
  const dtSeconds = Math.min(0.05, Math.max(0, (now - lastTickTime) / 1000));
  lastTickTime = now;

  stepArena(arena, dtSeconds);
  const asteroidUpdates = takeAsteroidUpdates(arena);
  if (asteroidUpdates.length > 0) {
    io.to(arenaRoom).emit(SERVER_EVENTS.asteroidUpdate, asteroidUpdates);
  }

  const ticksPerSnapshot = Math.max(1, Math.floor(ENGINE.tickRate / ENGINE.snapshotRate));
  if (arena.tick % ticksPerSnapshot === 0) {
    io.to(arenaRoom).volatile.emit(SERVER_EVENTS.snapshot, snapshotArena(arena));
  }
}, 1000 / ENGINE.tickRate);

server.listen(port, () => {
  console.log(`BITSPACE listening on port ${port}`);
  console.log(`seed: ${arena.seed}`);
  console.log(`asteroid seed: ${arena.asteroid.seed}`);
  console.log(`replay: BITSPACE_SEED=${arena.seed} npm start`);
});

function broadcastLobby() {
  io.to(arenaRoom).emit(SERVER_EVENTS.lobby, lobbySnapshot(arena));
}

function createArenaSeed() {
  return randomBytes(5).toString("hex");
}
