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
  buildPlayerWall,
  purchasePlayerUpgrade,
  sanitizePlayerName,
  setPlayerInput,
  setPlayerName,
  setPlayerTalk,
  snapshotAsteroid,
  snapshotArena,
  takeAsteroidUpdates,
  stepArena
} from "../shared/arena.js";
import {
  createRoomManager,
  ROOM_STATES
} from "./rooms.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const sharedDir = path.join(rootDir, "shared");
const port = Number(process.env.PORT || process.env.BITSPACE_PORT || 7024);
const baseSeed = process.env.BITSPACE_SEED || createArenaSeed();
const roomManager = createRoomManager({
  seedFactory(roomNumber) {
    return `${baseSeed}:${roomNumber}`;
  }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true
});

app.disable("x-powered-by");
app.use("/shared", express.static(sharedDir));
app.use(express.static(publicDir, { extensions: ["html"] }));

app.get("/health", (_request, response) => {
  const rooms = roomManager.allRooms();
  response.json({
    ok: true,
    name: "BITSPACE",
    seed: baseSeed,
    rooms: rooms.map((room) => ({
      id: room.id,
      state: room.state,
      players: room.participants.size,
      arena: room.arena?.id ?? null,
      tick: room.arena?.tick ?? 0
    })),
    roomCount: rooms.length,
    maxPlayers: ENGINE.maxPlayers,
    uptime: process.uptime()
  });
});

let lastTickTime = performance.now();

io.on("connection", (socket) => {
  const requestedName = sanitizePlayerName(socket.handshake.auth?.name || "");
  const connectResult = roomManager.connectClient({
    clientId: socket.handshake.auth?.clientId,
    clientSecret: socket.handshake.auth?.clientSecret,
    name: requestedName,
    socketId: socket.id
  });
  const clientId = connectResult.client.clientId;
  socket.data.clientId = clientId;

  socket.emit(SERVER_EVENTS.welcome, {
    clientId,
    clientSecret: connectResult.client.clientSecret,
    playerId: clientId,
    tickRate: ENGINE.tickRate,
    snapshotRate: ENGINE.snapshotRate,
    maxPlayers: ENGINE.maxPlayers,
    seed: baseSeed,
    render: RENDER,
    world: ENGINE.world
  });

  if (connectResult.room) {
    socket.join(roomChannel(connectResult.room));
    emitGameState(socket, connectResult.room);
    broadcastRoom(connectResult.room);
  }
  emitRoom(socket);

  socket.on(CLIENT_EVENTS.input, (payload) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    roomManager.recordHeartbeat(clientId, socket.id);

    const room = roomManager.clientRoom(clientId);
    if (!room?.arena?.players.has(clientId)) {
      return;
    }

    if (room.state === ROOM_STATES.waiting || room.state === ROOM_STATES.active) {
      setPlayerInput(
        room.arena,
        clientId,
        room.state === ROOM_STATES.waiting
          ? { ...payload, mining: false }
          : payload
      );
    }
  });

  socket.on(CLIENT_EVENTS.heartbeat, () => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    roomManager.recordHeartbeat(clientId, socket.id);
  });

  socket.on(CLIENT_EVENTS.setName, (name) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const result = roomManager.renameClient(clientId, name);
    const room = roomManager.clientRoom(clientId);
    if (room?.arena) {
      setPlayerName(room.arena, clientId, name);
    }
    if (result.room) {
      broadcastRoom(result.room);
    }
  });

  socket.on(CLIENT_EVENTS.talk, (text) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const room = roomManager.clientRoom(clientId);
    if (room?.arena?.players.has(clientId)) {
      setPlayerTalk(room.arena, clientId, text);
    }
  });

  socket.on(CLIENT_EVENTS.upgrade, (upgradeId) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const room = roomManager.clientRoom(clientId);
    const result = room?.state === ROOM_STATES.active && room?.arena
      ? purchasePlayerUpgrade(room.arena, clientId, upgradeId)
      : { ok: false, reason: "no_active_room" };
    if (!result.ok) {
      socket.emit(SERVER_EVENTS.notice, {
        code: result.reason,
        upgradeId
      });
    }
  });

  socket.on(CLIENT_EVENTS.buildWall, (payload) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const room = roomManager.clientRoom(clientId);
    const result = room?.state === ROOM_STATES.active && room?.arena
      ? buildPlayerWall(room.arena, clientId, payload)
      : { ok: false, reason: "no_active_room" };
    if (!result.ok) {
      socket.emit(SERVER_EVENTS.notice, {
        code: result.reason
      });
    }
  });

  socket.on(CLIENT_EVENTS.ready, (payload = {}) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const result = roomManager.readyClient(clientId);
    if (!result.ok) {
      socket.emit(SERVER_EVENTS.notice, {
        code: result.reason
      });
      emitRoom(socket);
      return;
    }

    socket.join(roomChannel(result.room));
    if (!payload?.silent && result.joined) {
      broadcastBeep(result.room, "button");
    }
    broadcastRoom(result.room);
    if (result.room.arena) {
      broadcastGameState(result.room);
    }
  });

  socket.on(CLIENT_EVENTS.resume, (payload = {}) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const result = roomManager.resumeClient(clientId, payload?.roomId);
    if (!result.ok) {
      emitRoom(socket);
      return;
    }

    socket.join(roomChannel(result.room));
    emitGameState(socket, result.room);
    broadcastRoom(result.room);
  });

  socket.on(CLIENT_EVENTS.start, () => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const result = roomManager.startRoom(clientId);
    if (!result.ok) {
      socket.emit(SERVER_EVENTS.notice, {
        code: result.reason
      });
      return;
    }

    broadcastRoom(result.room);
    broadcastGameState(result.room);
    if (result.countdownStarted) {
      broadcastBeep(result.room, "countdown");
    }
  });

  socket.on(CLIENT_EVENTS.leave, () => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const roomBeforeLeave = roomManager.clientRoom(clientId);
    const result = roomManager.leaveClient(clientId);
    socket.emit(SERVER_EVENTS.beep, { kind: "button" });
    if (roomBeforeLeave) {
      socket.leave(roomChannel(roomBeforeLeave));
      broadcastRoom(roomBeforeLeave);
      if (roomBeforeLeave.arena) {
        broadcastSnapshot(roomBeforeLeave);
      }
    }
    emitRoom(socket);
    if (!result.ok) {
      socket.emit(SERVER_EVENTS.notice, {
        code: result.reason
      });
    }
  });

  socket.on("disconnect", () => {
    const room = roomManager.clientRoom(clientId);
    roomManager.disconnectClient(clientId, socket.id);
    if (room) {
      broadcastRoom(room);
    }
  });
});

setInterval(() => {
  const now = performance.now();
  const dtSeconds = Math.min(0.05, Math.max(0, (now - lastTickTime) / 1000));
  lastTickTime = now;

  const events = roomManager.stepActiveArena(dtSeconds, stepArena);
  for (const event of events) {
    if (event.type === "waiting-expired") {
      for (const removed of event.removed || []) {
        const staleSocket = removed.socketId ? io.sockets.sockets.get(removed.socketId) : null;
        staleSocket?.leave(roomChannel(event.room));
        staleSocket && emitRoom(staleSocket);
      }
      if (!event.emptied) {
        broadcastRoom(event.room);
        broadcastGameState(event.room);
      }
      continue;
    }

    if (event.type === "left") {
      const leavingSocket = event.socketId ? io.sockets.sockets.get(event.socketId) : null;
      if (event.beep) {
        broadcastBeep(event.room, "button");
      }
      leavingSocket?.leave(roomChannel(event.room));
      leavingSocket && emitRoom(leavingSocket);
      if (!event.emptied) {
        broadcastRoom(event.room);
        broadcastSnapshot(event.room);
      }
      continue;
    }

    if (event.type === "countdown") {
      broadcastBeep(event.room, "countdown");
    }
    broadcastRoom(event.room);
    broadcastGameState(event.room);
  }

  const ticksPerSnapshot = Math.max(1, Math.floor(ENGINE.tickRate / ENGINE.snapshotRate));
  for (const room of roomManager.allRooms()) {
    if (!room.arena) {
      continue;
    }

    const asteroidUpdates = takeAsteroidUpdates(room.arena);
    if (asteroidUpdates.length > 0) {
      io.to(roomChannel(room)).emit(SERVER_EVENTS.asteroidUpdate, asteroidUpdates);
    }

    if (
      (room.state === ROOM_STATES.waiting || room.state === ROOM_STATES.active) &&
      room.arena.tick % ticksPerSnapshot === 0
    ) {
      io.to(roomChannel(room)).volatile.emit(SERVER_EVENTS.snapshot, snapshotArena(room.arena));
    }
  }
}, 1000 / ENGINE.tickRate);

server.listen(port, () => {
  console.log(`BITSPACE listening on port ${port}`);
  console.log(`seed: ${baseSeed}`);
  console.log(`replay: BITSPACE_SEED=${baseSeed} npm start`);
});

function emitRoom(socket) {
  socket.emit(SERVER_EVENTS.room, roomManager.roomSnapshot(socket.data.clientId));
}

function broadcastRoom(room = roomManager.activeRoom()) {
  if (!room) {
    return;
  }

  for (const participant of room.participants.values()) {
    const participantSocket = participant.socketId
      ? io.sockets.sockets.get(participant.socketId)
      : null;
    if (!participantSocket) {
      continue;
    }

    participantSocket.emit(SERVER_EVENTS.room, roomManager.roomSnapshot(participant.clientId));
  }
}

function emitGameState(socket, room) {
  if (!room?.arena) {
    return;
  }

  socket.emit(SERVER_EVENTS.asteroid, snapshotAsteroid(room.arena));
  socket.emit(SERVER_EVENTS.snapshot, snapshotArena(room.arena));
}

function broadcastGameState(room) {
  if (!room?.arena) {
    return;
  }

  io.to(roomChannel(room)).emit(SERVER_EVENTS.asteroid, snapshotAsteroid(room.arena));
  broadcastSnapshot(room);
}

function broadcastSnapshot(room) {
  if (!room?.arena) {
    return;
  }

  io.to(roomChannel(room)).emit(SERVER_EVENTS.snapshot, snapshotArena(room.arena));
}

function broadcastBeep(room, kind = "button") {
  if (!room) {
    return;
  }

  io.to(roomChannel(room)).emit(SERVER_EVENTS.beep, { kind });
}

function isCurrentSocket(socket) {
  return roomManager.isCurrentSocket(socket.data.clientId, socket.id);
}

function roomChannel(room) {
  return `room:${room.id}`;
}

function createArenaSeed() {
  return randomBytes(5).toString("hex");
}
