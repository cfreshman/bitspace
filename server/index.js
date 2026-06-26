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
import { diffArenaSnapshot } from "../shared/snapshot-delta.js";
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

app.get("*", (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

let lastTickTime = performance.now();
const roomSnapshotBaselines = new Map();
const voiceClientsByRoom = new Map();

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
      setPlayerInput(room.arena, clientId, payload);
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
    const result = (room?.state === ROOM_STATES.active || room?.state === ROOM_STATES.waiting) && room?.arena
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

    const result = roomManager.readyClient(clientId, {
      mode: payload?.mode
    });
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

  socket.on(CLIENT_EVENTS.joinNamedRoom, (payload = {}) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const roomName = typeof payload === "string" ? payload : payload?.name;
    const roomBeforeJoin = roomManager.clientRoom(clientId);
    const result = roomManager.joinNamedRoom(clientId, roomName, {
      mode: typeof payload === "object" ? payload?.mode : undefined
    });
    if (!result.ok) {
      socket.emit(SERVER_EVENTS.notice, {
        code: result.reason
      });
      emitRoom(socket);
      return;
    }

    if (roomBeforeJoin && roomBeforeJoin.id !== result.room.id) {
      socket.leave(roomChannel(roomBeforeJoin));
      broadcastRoom(roomBeforeJoin);
      if (roomBeforeJoin.arena) {
        broadcastSnapshot(roomBeforeJoin);
      }
    }

    socket.join(roomChannel(result.room));
    if (!payload?.silent && result.joined && result.room.state === ROOM_STATES.waiting) {
      broadcastBeep(result.room, "button");
    }
    emitGameState(socket, result.room);
    broadcastRoom(result.room);
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
    leaveVoiceRoom(clientId, roomBeforeLeave);
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

  socket.on(CLIENT_EVENTS.voiceJoin, () => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    const room = roomManager.clientRoom(clientId);
    if (!room?.participants.has(clientId)) {
      socket.emit(SERVER_EVENTS.voicePeers, { roomId: null, peers: [] });
      return;
    }

    const peers = joinVoiceRoom(clientId, room);
    socket.emit(SERVER_EVENTS.voicePeers, {
      roomId: room.id,
      peers
    });
  });

  socket.on(CLIENT_EVENTS.voiceLeave, () => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    leaveVoiceRoom(clientId, roomManager.clientRoom(clientId));
  });

  socket.on(CLIENT_EVENTS.voiceSignal, (payload = {}) => {
    if (!isCurrentSocket(socket)) {
      return;
    }

    relayVoiceSignal(clientId, payload);
  });

  socket.on("disconnect", () => {
    const room = roomManager.clientRoom(clientId);
    leaveVoiceRoom(clientId, room);
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
        leaveVoiceRoom(removed.clientId, event.room);
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
      leaveVoiceRoom(event.clientId, event.room);
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
  const ticksPerFullSnapshot = Math.max(1, ENGINE.tickRate);
  for (const room of roomManager.allRooms()) {
    if (!room.arena) {
      roomSnapshotBaselines.delete(room.id);
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
      const snapshot = snapshotArena(room.arena);
      const previous = roomSnapshotBaselines.get(room.id);
      const sendFull = !previous ||
        previous.arenaId !== snapshot.arenaId ||
        snapshot.tick % ticksPerFullSnapshot === 0;
      const payload = sendFull
        ? snapshot
        : diffArenaSnapshot(previous, snapshot) || snapshot;
      roomSnapshotBaselines.set(room.id, snapshot);
      io.to(roomChannel(room)).emit(SERVER_EVENTS.snapshot, payload);
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

  roomSnapshotBaselines.delete(room.id);
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

  const snapshot = snapshotArena(room.arena);
  roomSnapshotBaselines.set(room.id, snapshot);
  io.to(roomChannel(room)).emit(SERVER_EVENTS.snapshot, snapshot);
}

function broadcastBeep(room, kind = "button") {
  if (!room) {
    return;
  }

  io.to(roomChannel(room)).emit(SERVER_EVENTS.beep, { kind });
}

function joinVoiceRoom(clientId, room) {
  const roomId = room?.id || "";
  if (!roomId) {
    return [];
  }

  leaveVoiceRoomsExcept(clientId, roomId);

  const peers = voiceClientsByRoom.get(roomId) || new Set();
  const currentPeers = Array.from(peers)
    .filter((peerId) => peerId !== clientId && room.participants.has(peerId));
  const alreadyJoined = peers.has(clientId);
  peers.add(clientId);
  voiceClientsByRoom.set(roomId, peers);

  if (!alreadyJoined) {
    for (const peerId of currentPeers) {
      const peerSocket = socketForRoomParticipant(room, peerId);
      peerSocket?.emit(SERVER_EVENTS.voicePeerJoined, {
        roomId,
        clientId
      });
    }
  }

  return currentPeers;
}

function leaveVoiceRoomsExcept(clientId, keptRoomId) {
  for (const [roomId, peers] of voiceClientsByRoom.entries()) {
    if (roomId === keptRoomId || !peers.has(clientId)) {
      continue;
    }

    const room = roomManager.allRooms().find((candidate) => candidate.id === roomId);
    leaveVoiceRoom(clientId, room);
  }
}

function leaveVoiceRoom(clientId, expectedRoom = null) {
  for (const [roomId, peers] of voiceClientsByRoom.entries()) {
    if (expectedRoom && expectedRoom.id !== roomId) {
      continue;
    }

    if (!peers.delete(clientId)) {
      continue;
    }

    const room = expectedRoom?.id === roomId ? expectedRoom : roomManager.allRooms().find((candidate) => candidate.id === roomId);
    for (const peerId of peers) {
      const peerSocket = room ? socketForRoomParticipant(room, peerId) : null;
      peerSocket?.emit(SERVER_EVENTS.voicePeerLeft, {
        roomId,
        clientId
      });
    }

    if (peers.size <= 0) {
      voiceClientsByRoom.delete(roomId);
    }
  }
}

function relayVoiceSignal(clientId, payload = {}) {
  const targetId = typeof payload.targetId === "string" ? payload.targetId : "";
  const signal = payload.signal;
  if (!targetId || targetId === clientId || !signal || typeof signal !== "object") {
    return;
  }

  const room = roomManager.clientRoom(clientId);
  if (!room?.participants.has(clientId) || !room.participants.has(targetId)) {
    return;
  }

  const peers = voiceClientsByRoom.get(room.id);
  if (!peers?.has(clientId) || !peers.has(targetId)) {
    return;
  }

  const targetSocket = socketForRoomParticipant(room, targetId);
  targetSocket?.emit(SERVER_EVENTS.voiceSignal, {
    roomId: room.id,
    fromId: clientId,
    signal
  });
}

function socketForRoomParticipant(room, clientId) {
  const participant = room?.participants.get(clientId);
  if (!participant?.socketId) {
    return null;
  }

  return io.sockets.sockets.get(participant.socketId) || null;
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
