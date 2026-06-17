import { randomBytes } from "node:crypto";

import { ENGINE, RENDER } from "../shared/constants.js";
import { createLobbyAsteroid } from "../shared/asteroid.js";
import { createSeededRandom } from "../shared/math.js";
import {
  addPlayer,
  clearPlayerInput,
  createArena,
  eliminatePlayer,
  sanitizePlayerName
} from "../shared/arena.js";

export const ROOM_STATES = Object.freeze({
  menu: "menu",
  waiting: "waiting",
  active: "active",
  ended: "ended"
});

const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{12,48}$/;
const CLIENT_SECRET_PATTERN = /^[a-zA-Z0-9_-]{24,96}$/;
const LOBBY_BUTTON_WIDTH = 112;
const LOBBY_BUTTON_HEIGHT = 32;
const LOBBY_BUTTON_GAP = 32;
const HEARTBEAT_TIMEOUT_MS = ENGINE.heartbeat.timeoutSeconds * 1000;
const FINAL_COUNTDOWN_BEEP_SECONDS = new Set([3, 2, 1, 0]);

export function createRoomManager(options = {}) {
  const now = options.now ?? (() => Date.now());
  const seedFactory = options.seedFactory ?? createRoomSeed;
  const clients = new Map();
  const rooms = new Map();
  const clientRooms = new Map();
  let nextRoomNumber = 1;

  function connectClient({ clientId, clientSecret, name, socketId }) {
    let normalizedClientId = sanitizeClientId(clientId);
    let normalizedClientSecret = sanitizeClientSecret(clientSecret);
    let client = normalizedClientId ? clients.get(normalizedClientId) : null;

    if (client?.clientSecret && client.clientSecret !== normalizedClientSecret) {
      client = null;
      normalizedClientId = "";
      normalizedClientSecret = "";
    }

    if (!client && normalizedClientId && roomForClient(normalizedClientId)) {
      normalizedClientId = "";
      normalizedClientSecret = "";
    }

    normalizedClientId ||= createClientId();
    normalizedClientSecret ||= createClientSecret();

    client ||= {
      clientId: normalizedClientId,
      clientSecret: normalizedClientSecret,
      name: sanitizePlayerName(name || ""),
      socketId: null,
      connected: false,
      lastHeartbeatAtMs: 0
    };

    client.clientSecret ||= normalizedClientSecret;
    client.name = sanitizePlayerName(name || client.name);
    client.socketId = socketId;
    client.connected = true;
    client.lastHeartbeatAtMs = now();
    clients.set(client.clientId, client);

    const room = roomForClient(client.clientId);
    const participant = room?.participants.get(client.clientId) || null;
    if (participant) {
      participant.name = client.name;
      participant.socketId = socketId;
      participant.connected = true;
      participant.lastHeartbeatAtMs = client.lastHeartbeatAtMs;
      ensureWaitingPlayer(room, client);
      clearParticipantInput(room, client.clientId);
    }

    return {
      client,
      room: participant ? room : null
    };
  }

  function disconnectClient(clientId, socketId) {
    const client = clients.get(clientId);
    if (client && client.socketId === socketId) {
      client.connected = false;
      client.socketId = null;
    }

    const room = roomForClient(clientId);
    const participant = room?.participants.get(clientId) || null;
    if (participant && participant.socketId === socketId) {
      participant.connected = false;
      participant.socketId = null;
      clearParticipantInput(room, clientId);
    }
  }

  function recordHeartbeat(clientId, socketId) {
    const client = clients.get(clientId);
    if (!client || client.socketId !== socketId) {
      return false;
    }

    const heartbeatAtMs = now();
    client.connected = true;
    client.lastHeartbeatAtMs = heartbeatAtMs;

    const room = roomForClient(clientId);
    const participant = room?.participants.get(clientId) || null;
    if (participant && participant.socketId === socketId) {
      participant.connected = true;
      participant.lastHeartbeatAtMs = heartbeatAtMs;
    }

    return true;
  }

  function isCurrentSocket(clientId, socketId) {
    return clients.get(clientId)?.socketId === socketId;
  }

  function renameClient(clientId, name) {
    const nextName = sanitizePlayerName(name || "");
    const client = clients.get(clientId);
    if (client) {
      client.name = nextName;
    }

    const room = roomForClient(clientId);
    const participant = room?.participants.get(clientId) || null;
    if (participant) {
      participant.name = nextName;
    }

    const player = room?.arena?.players.get(clientId);
    if (player) {
      player.name = nextName;
    }

    return { ok: Boolean(client), room };
  }

  function readyClient(clientId) {
    const client = clients.get(clientId);
    if (!client) {
      return { ok: false, reason: "unknown_client" };
    }

    const existingRoom = roomForClient(clientId);
    if (existingRoom) {
      const participant = existingRoom.participants.get(clientId);
      participant.connected = client.connected;
      participant.socketId = client.socketId;
      participant.name = client.name;
      participant.lastHeartbeatAtMs = client.lastHeartbeatAtMs || now();
      ensureWaitingPlayer(existingRoom, client);
      syncLobbyControls(existingRoom);
      return { ok: true, room: existingRoom, rejoined: true };
    }

    const room = availableWaitingRoom();
    if (!room) {
      return { ok: false, reason: "no_waiting_room" };
    }

    if (room.participants.size >= ENGINE.maxPlayers) {
      return { ok: false, reason: "room_full" };
    }

    const joinedAtMs = now();
    room.participants.set(clientId, {
      clientId,
      name: client.name,
      socketId: client.socketId,
      connected: client.connected,
      joinedAtMs,
      lastHeartbeatAtMs: client.lastHeartbeatAtMs || joinedAtMs
    });
    clientRooms.set(clientId, room.id);
    addPlayer(room.arena, {
      id: clientId,
      name: client.name,
      spawnNumber: nextLobbySpawnNumber(room)
    });

    if (!room.hostClientId) {
      room.hostClientId = clientId;
      room.waitingStartedAtMs = joinedAtMs;
      room.autoStartAtMs = joinedAtMs + ENGINE.lobby.autoStartSeconds * 1000;
    }
    if (room.participants.size === ENGINE.lobby.minPlayers) {
      room.autoStartAtMs = joinedAtMs + ENGINE.lobby.autoStartSeconds * 1000;
    }
    syncLobbyControls(room);

    if (room.participants.size >= ENGINE.maxPlayers) {
      armStartCountdown(room, "full");
    }

    return { ok: true, room, joined: true };
  }

  function resumeClient(clientId, roomId) {
    const client = clients.get(clientId);
    if (!client) {
      return { ok: false, reason: "unknown_client" };
    }

    const room = roomId ? rooms.get(String(roomId)) : roomForClient(clientId);
    if (!room?.participants.has(clientId)) {
      return { ok: false, reason: "not_registered" };
    }

    const participant = room.participants.get(clientId);
    participant.connected = client.connected;
    participant.socketId = client.socketId;
    participant.name = client.name;
    participant.lastHeartbeatAtMs = client.lastHeartbeatAtMs || now();
    clientRooms.set(clientId, room.id);
    ensureWaitingPlayer(room, client);
    clearParticipantInput(room, clientId);
    syncLobbyControls(room);

    return { ok: true, room, rejoined: true };
  }

  function startRoom(clientId) {
    const room = roomForClient(clientId);
    if (!room || room.state !== ROOM_STATES.waiting) {
      return { ok: false, reason: "no_waiting_room" };
    }

    if (room.hostClientId !== clientId) {
      return { ok: false, reason: "not_host" };
    }

    return armStartCountdown(room, "host");
  }

  function leaveClient(clientId) {
    const room = roomForClient(clientId);
    if (!room || !room.participants.has(clientId)) {
      return { ok: true, room: null };
    }

    if (room.state === ROOM_STATES.active && room.arena) {
      eliminatePlayer(room.arena, clientId, {
        tick: room.arena.tick,
        killedById: null
      });
    } else if (room.state === ROOM_STATES.waiting && room.arena) {
      room.arena.players.delete(clientId);
    }

    room.participants.delete(clientId);
    clientRooms.delete(clientId);
    if (room.hostClientId === clientId) {
      room.hostClientId = firstParticipantId(room);
    }
    if (room.state === ROOM_STATES.waiting && room.participants.size < ENGINE.lobby.minPlayers) {
      cancelStartCountdown(room);
    }
    syncLobbyControls(room);

    if (room.state === ROOM_STATES.active) {
      maybeEndActiveRoom(room, "leave");
    }

    if (
      (room.state === ROOM_STATES.waiting || room.state === ROOM_STATES.ended) &&
      room.participants.size === 0
    ) {
      destroyRoom(room);
      return { ok: true, room: null, previousRoom: room, emptied: true };
    }

    return { ok: true, room };
  }

  function stepActiveArena(dtSeconds, stepArenaFn) {
    const events = [];

    for (const room of Array.from(rooms.values())) {
      if (room.state === ROOM_STATES.waiting && room.arena) {
        const expiryEvent = expireWaitingRoomParticipants(room);
        if (expiryEvent) {
          events.push(expiryEvent);
          if (expiryEvent.emptied) {
            continue;
          }
        }

        if (room.participants.size < ENGINE.lobby.minPlayers) {
          cancelStartCountdown(room);
        } else if (!room.countdownArmed) {
          const remainingMs = room.autoStartAtMs - now();
          if (remainingMs <= ENGINE.lobby.countdownSeconds * 1000) {
            const result = armStartCountdown(room, "timer");
            if (result.ok && result.countdownStarted) {
              events.push({ type: "countdown", room });
            }
          }
        }

        const countdownBeepEvent = maybeFinalCountdownBeep(room);
        if (countdownBeepEvent) {
          events.push(countdownBeepEvent);
          if (countdownBeepEvent.secondsLeft === 0) {
            continue;
          }
        }

        if (room.participants.size >= ENGINE.lobby.minPlayers && now() >= room.autoStartAtMs) {
          const result = startWaitingRoom(room, room.countdownReason || "timer");
          if (result.ok) {
            events.push({ type: "started", room });
          }
          continue;
        }

        stepArenaFn(room.arena, dtSeconds);
        events.push(...processLobbyHuckRockButtonHits(room));
        events.push(...processLobbyButtonHits(room, dtSeconds));
      }

      if (room.state === ROOM_STATES.active && room.arena) {
        const timeoutEvents = expireActiveHeartbeatTimeouts(room);
        events.push(...timeoutEvents);
        if (room.state !== ROOM_STATES.active) {
          continue;
        }

        stepArenaFn(room.arena, dtSeconds);
        if (maybeEndActiveRoom(room, "last_alive")) {
          events.push({ type: "ended", room });
        }
      }
    }

    return events;
  }

  function roomSnapshot(clientId) {
    const room = roomForClient(clientId);
    if (!room || !room.participants.has(clientId)) {
      return {
        state: ROOM_STATES.menu,
        clientId,
        maxPlayers: ENGINE.maxPlayers,
        autoStartSeconds: ENGINE.lobby.autoStartSeconds,
        activeGame: Array.from(rooms.values()).some((candidate) => candidate.state === ROOM_STATES.active)
      };
    }

    return snapshotRoom(room, clientId);
  }

  function genericRoomSnapshot(room = primaryRoom()) {
    return room ? snapshotRoom(room, null) : null;
  }

  function activeRoom() {
    return primaryRoom();
  }

  function clientRoom(clientId) {
    return roomForClient(clientId);
  }

  function allRooms() {
    return Array.from(rooms.values());
  }

  function availableWaitingRoom() {
    return Array.from(rooms.values())
      .filter((room) =>
        room.state === ROOM_STATES.waiting &&
        !room.countdownArmed &&
        room.participants.size < ENGINE.maxPlayers
      )
      .sort((a, b) => a.createdAtMs - b.createdAtMs)[0] || createWaitingRoom();
  }

  function roomForClient(clientId) {
    const roomId = clientRooms.get(clientId);
    const mappedRoom = roomId ? rooms.get(roomId) : null;
    if (mappedRoom?.participants.has(clientId)) {
      return mappedRoom;
    }

    for (const room of rooms.values()) {
      if (room.participants.has(clientId)) {
        clientRooms.set(clientId, room.id);
        return room;
      }
    }

    return null;
  }

  function primaryRoom() {
    return Array.from(rooms.values())
      .sort((a, b) => {
        if (a.state === ROOM_STATES.waiting && b.state !== ROOM_STATES.waiting) {
          return -1;
        }
        if (b.state === ROOM_STATES.waiting && a.state !== ROOM_STATES.waiting) {
          return 1;
        }
        return b.createdAtMs - a.createdAtMs;
      })[0] || null;
  }

  function destroyRoom(room) {
    rooms.delete(room.id);

    for (const clientId of room.participants.keys()) {
      clientRooms.delete(clientId);
    }
  }

  function createWaitingRoom() {
    const createdAtMs = now();
    const roomNumber = nextRoomNumber;
    const seed = seedFactory(roomNumber);
    nextRoomNumber += 1;

    const room = {
      id: `room-${roomNumber}`,
      state: ROOM_STATES.waiting,
      seed,
      createdAtMs,
      waitingStartedAtMs: createdAtMs,
      autoStartAtMs: createdAtMs + ENGINE.lobby.autoStartSeconds * 1000,
      hostClientId: null,
      participants: new Map(),
      lobbySpawnNumbers: randomizedSpawnNumbers(`${seed}:lobby`, ENGINE.maxPlayers),
      arena: createLobbyArena(`room-${roomNumber}:waiting`, `${seed}:waiting`),
      startedAtMs: null,
      endedAtMs: null,
      startReason: null,
      endReason: null,
      winnerId: null,
      winnerName: null,
      countdownArmed: false,
      countdownReason: null,
      countdownStartedAtMs: null,
      countdownLastBeepSecond: null,
      countdownBeepSeq: 0
    };
    rooms.set(room.id, room);
    return room;
  }

  function armStartCountdown(room, reason) {
    if (!room || room.state !== ROOM_STATES.waiting) {
      return { ok: false, reason: "no_waiting_room" };
    }

    if (room.participants.size < ENGINE.lobby.minPlayers) {
      return { ok: false, reason: "not_enough_players" };
    }

    if (room.countdownArmed) {
      return {
        ok: true,
        room,
        countdown: true,
        countdownStarted: false
      };
    }

    const deadlineMs = now() + ENGINE.lobby.countdownSeconds * 1000;
    const countdownStarted = true;
    room.countdownArmed = true;
    room.countdownReason = reason;
    room.countdownStartedAtMs = now();
    room.countdownLastBeepSecond = null;
    room.autoStartAtMs = deadlineMs;

    if (countdownStarted) {
      room.countdownBeepSeq += 1;
    }

    return {
      ok: true,
      room,
      countdown: true,
      countdownStarted
    };
  }

  function cancelStartCountdown(room) {
    if (!room?.countdownArmed) {
      return;
    }

    room.countdownArmed = false;
    room.countdownReason = null;
    room.countdownStartedAtMs = null;
    room.countdownLastBeepSecond = null;
    room.autoStartAtMs = now() + ENGINE.lobby.autoStartSeconds * 1000;
  }

  function maybeFinalCountdownBeep(room) {
    if (!room?.countdownArmed) {
      return null;
    }

    const secondsLeft = Math.max(0, Math.ceil((room.autoStartAtMs - now()) / 1000));
    if (!FINAL_COUNTDOWN_BEEP_SECONDS.has(secondsLeft) || room.countdownLastBeepSecond === secondsLeft) {
      return null;
    }

    room.countdownLastBeepSecond = secondsLeft;
    room.countdownBeepSeq += 1;
    return { type: "countdown", room, secondsLeft };
  }

  function startWaitingRoom(room, reason) {
    if (!room || room.state !== ROOM_STATES.waiting) {
      return { ok: false, reason: "no_waiting_room" };
    }

    if (room.participants.size < ENGINE.lobby.minPlayers) {
      return { ok: false, reason: "not_enough_players" };
    }

    const participants = sortedParticipants(room);
    room.state = ROOM_STATES.active;
    room.startedAtMs = now();
    room.startReason = reason;
    room.arena = createArena({
      id: room.id,
      seed: room.seed,
      playerCount: participants.length
    });

    const spawnNumbers = randomizedSpawnNumbers(room.seed, participants.length);
    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index];
      addPlayer(room.arena, {
        id: participant.clientId,
        name: participant.name,
        spawnNumber: spawnNumbers[index]
      });
    }

    maybeEndActiveRoom(room, "last_alive");
    return { ok: true, room };
  }

  function maybeEndActiveRoom(room, reason) {
    if (!room || room.state !== ROOM_STATES.active || !room.arena) {
      return false;
    }

    const alivePlayers = Array.from(room.arena.players.values()).filter((player) => player.alive);
    if (alivePlayers.length > 1) {
      return false;
    }

    const winner = alivePlayers[0] || null;
    room.state = ROOM_STATES.ended;
    room.endedAtMs = now();
    room.endReason = reason;
    room.winnerId = winner?.id ?? null;
    room.winnerName = winner?.name ?? null;
    return true;
  }

  function expireWaitingRoomParticipants(room) {
    if (room.state !== ROOM_STATES.waiting || !room.arena || room.participants.size === 0) {
      return null;
    }

    const cutoffMs = now() - HEARTBEAT_TIMEOUT_MS;
    const removed = [];
    for (const participant of Array.from(room.participants.values())) {
      const heartbeatAtMs = participant.lastHeartbeatAtMs ??
        participant.joinedAtMs ??
        room.createdAtMs;
      if (heartbeatAtMs > cutoffMs) {
        continue;
      }

      removed.push({
        clientId: participant.clientId,
        socketId: participant.socketId
      });
      room.participants.delete(participant.clientId);
      room.arena.players.delete(participant.clientId);
      clientRooms.delete(participant.clientId);
    }

    if (removed.length === 0) {
      return null;
    }

    if (!room.participants.has(room.hostClientId)) {
      room.hostClientId = firstParticipantId(room);
    }
    if (room.participants.size < ENGINE.lobby.minPlayers) {
      cancelStartCountdown(room);
    }
    syncLobbyControls(room);

    const emptied = room.participants.size === 0;
    if (emptied) {
      destroyRoom(room);
    }

    return {
      type: "waiting-expired",
      room,
      removed,
      emptied
    };
  }

  function expireActiveHeartbeatTimeouts(room) {
    const events = [];
    if (room.state !== ROOM_STATES.active || !room.arena) {
      return events;
    }

    const cutoffMs = now() - HEARTBEAT_TIMEOUT_MS;
    for (const participant of room.participants.values()) {
      const player = room.arena.players.get(participant.clientId);
      if (!player?.alive) {
        continue;
      }

      const heartbeatAtMs = participant.lastHeartbeatAtMs ??
        participant.joinedAtMs ??
        room.startedAtMs ??
        room.createdAtMs;
      if (heartbeatAtMs > cutoffMs) {
        continue;
      }

      participant.connected = false;
      clearParticipantInput(room, participant.clientId);
      eliminatePlayer(room.arena, participant.clientId, {
        tick: room.arena.tick,
        killedById: null
      });
      events.push({
        type: "heartbeat-timeout",
        room,
        clientId: participant.clientId
      });
    }

    if (events.length > 0 && maybeEndActiveRoom(room, "heartbeat_timeout")) {
      events.push({ type: "ended", room });
    }

    return events;
  }

  function processLobbyHuckRockButtonHits(room) {
    if (room.state !== ROOM_STATES.waiting || !room.arena) {
      return [];
    }

    const hits = Array.isArray(room.arena.huckRockButtonHits)
      ? room.arena.huckRockButtonHits.splice(0)
      : [];
    for (const hit of hits) {
      const player = room.arena.players.get(hit.ownerId);
      const entity = room.arena.entities.get(hit.targetId);
      if (!player?.alive || entity?.type !== "lobbyButton" || entity.hidden) {
        continue;
      }

      if (entity.hostOnly && room.hostClientId !== player.id) {
        continue;
      }

      return activateLobbyButton(room, player.id, entity);
    }

    return [];
  }

  function processLobbyButtonHits(room, dtSeconds) {
    const events = [];
    if (room.state !== ROOM_STATES.waiting || !room.arena) {
      return events;
    }

    for (const player of room.arena.players.values()) {
      if (!player.alive || !player.mining || player.miningRay?.hitType !== "entity") {
        resetLobbyButtonTarget(player);
        continue;
      }

      const entity = room.arena.entities.get(player.miningRay.targetId);
      if (entity?.type !== "lobbyButton" || entity.hidden) {
        resetLobbyButtonTarget(player);
        continue;
      }

      if (entity.hostOnly && room.hostClientId !== player.id) {
        resetLobbyButtonTarget(player);
        continue;
      }

      if (player.buttonTargetId !== entity.id) {
        player.buttonTargetId = entity.id;
        player.buttonTargetSeconds = 0;
        player.buttonTargetActivated = false;
      }

      player.buttonTargetSeconds += dtSeconds;
      if (
        player.buttonTargetActivated ||
        player.buttonTargetSeconds < ENGINE.mining.buttonSeconds
      ) {
        continue;
      }

      player.buttonTargetActivated = true;
      return activateLobbyButton(room, player.id, entity);
    }

    return events;
  }

  function activateLobbyButton(room, playerId, entity) {
    const events = [];

    if (entity.action === "start") {
      const result = armStartCountdown(room, "host");
      if (result.ok && result.countdownStarted) {
        events.push({ type: "countdown", room: result.room });
      }
      return events;
    }

    if (entity.action === "leave") {
      const participant = room.participants.get(playerId);
      const socketId = participant?.socketId ?? null;
      const result = leaveClient(playerId);
      events.push({
        type: "left",
        room,
        clientId: playerId,
        socketId,
        emptied: result.emptied === true,
        beep: true
      });
    }

    return events;
  }

  function resetLobbyButtonTarget(player) {
    player.buttonTargetId = null;
    player.buttonTargetSeconds = 0;
    player.buttonTargetActivated = false;
  }

  return {
    connectClient,
    disconnectClient,
    renameClient,
    readyClient,
    startRoom,
    leaveClient,
    recordHeartbeat,
    stepActiveArena,
    roomSnapshot,
    genericRoomSnapshot,
    activeRoom,
    clientRoom,
    allRooms,
    resumeClient,
    isCurrentSocket
  };
}

function createLobbyArena(id, seed) {
  const asteroid = createLobbyAsteroid({ seed: `${seed}:box` });
  const arena = createArena({
    id,
    seed,
    asteroid,
    playerDamage: false
  });
  const center = {
    x: (asteroid.widthTiles * asteroid.tileSize) / 2,
    y: (asteroid.heightTiles * asteroid.tileSize) / 2
  };
  const startX = center.x - LOBBY_BUTTON_WIDTH - LOBBY_BUTTON_GAP / 2;
  const leaveX = center.x + LOBBY_BUTTON_GAP / 2;
  const buttonY = center.y - LOBBY_BUTTON_HEIGHT / 2;

  arena.entities.set("lobby-start", {
    id: "lobby-start",
    type: "lobbyButton",
    action: "start",
    label: "START",
    x: startX,
    y: buttonY,
    width: LOBBY_BUTTON_WIDTH,
    height: LOBBY_BUTTON_HEIGHT,
    hostOnly: true
  });
  arena.entities.set("lobby-leave", {
    id: "lobby-leave",
    type: "lobbyButton",
    action: "leave",
    label: "LEAVE",
    x: leaveX,
    y: buttonY,
    width: LOBBY_BUTTON_WIDTH,
    height: LOBBY_BUTTON_HEIGHT
  });

  clearLobbyButtonSpawns(arena, center);

  return arena;
}

function clearLobbyButtonSpawns(arena, center) {
  const buttons = Array.from(arena.entities.values()).filter((entity) => entity.type === "lobbyButton");
  const radius = ENGINE.ship.radius + 2;

  for (const pocket of arena.asteroid.pockets) {
    let x = pocket.spawnX;
    let y = pocket.spawnY;
    let guard = 32;

    while (guard > 0 && buttons.some((button) => circleOverlapsRect(x, y, radius, button))) {
      const dx = x - center.x;
      const dy = y - center.y;
      const distance = Math.hypot(dx, dy) || 1;
      x += (dx / distance) * RENDER.tileSize;
      y += (dy / distance) * RENDER.tileSize;
      guard -= 1;
    }

    pocket.spawnX = x;
    pocket.spawnY = y;
  }
}

function circleOverlapsRect(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;

  return dx * dx + dy * dy < radius * radius;
}

function syncLobbyHosts(room) {
  if (room.state !== ROOM_STATES.waiting || !room.arena) {
    return;
  }

  for (const player of room.arena.players.values()) {
    player.lobbyHost = player.id === room.hostClientId;
  }
}

function syncLobbyControls(room) {
  syncLobbyHosts(room);

  if (room.state !== ROOM_STATES.waiting || !room.arena) {
    return;
  }

  const startButton = room.arena.entities.get("lobby-start");
  if (startButton) {
    startButton.hidden = room.participants.size < ENGINE.lobby.minPlayers;
  }
}

function ensureWaitingPlayer(room, client) {
  if (room?.state !== ROOM_STATES.waiting || !room.arena || room.arena.players.has(client.clientId)) {
    return;
  }

  addPlayer(room.arena, {
    id: client.clientId,
    name: client.name,
    spawnNumber: nextLobbySpawnNumber(room)
  });
  syncLobbyControls(room);
}

function clearParticipantInput(room, clientId) {
  if (room?.arena) {
    clearPlayerInput(room.arena, clientId);
  }
}

function nextLobbySpawnNumber(room) {
  const used = new Set(Array.from(room.arena.players.values()).map((player) => player.spawnNumber));
  return room.lobbySpawnNumbers.find((spawnNumber) => !used.has(spawnNumber)) || room.arena.players.size + 1;
}

export function sanitizeClientId(value) {
  const text = String(value || "").trim();
  return CLIENT_ID_PATTERN.test(text) ? text : "";
}

export function createClientId() {
  return randomBytes(12).toString("base64url");
}

export function sanitizeClientSecret(value) {
  const text = String(value || "").trim();
  return CLIENT_SECRET_PATTERN.test(text) ? text : "";
}

export function createClientSecret() {
  return randomBytes(24).toString("base64url");
}

function createRoomSeed(roomNumber) {
  return `${randomBytes(5).toString("hex")}-${roomNumber}`;
}

function snapshotRoom(room, clientId) {
  return {
    state: room.state,
    roomId: room.id,
    clientId,
    maxPlayers: ENGINE.maxPlayers,
    minPlayers: ENGINE.lobby.minPlayers,
    autoStartSeconds: ENGINE.lobby.autoStartSeconds,
    countdownSeconds: ENGINE.lobby.countdownSeconds,
    hostClientId: room.hostClientId,
    isHost: clientId ? room.hostClientId === clientId : false,
    seed: room.seed,
    waitingStartedAtMs: room.waitingStartedAtMs,
    autoStartAtMs: room.autoStartAtMs,
    startedAtMs: room.startedAtMs,
    endedAtMs: room.endedAtMs,
    startReason: room.startReason,
    endReason: room.endReason,
    winnerId: room.winnerId,
    winnerName: room.winnerName,
    countdownArmed: room.countdownArmed,
    countdownStartedAtMs: room.countdownStartedAtMs,
    countdownBeepSeq: room.countdownBeepSeq,
    players: sortedParticipants(room).map((participant) => ({
      clientId: participant.clientId,
      name: participant.name,
      connected: participant.connected,
      host: participant.clientId === room.hostClientId
    })),
    render: RENDER
  };
}

function sortedParticipants(room) {
  return Array.from(room.participants.values())
    .sort((a, b) => a.joinedAtMs - b.joinedAtMs || a.clientId.localeCompare(b.clientId));
}

function firstParticipantId(room) {
  return sortedParticipants(room)[0]?.clientId ?? null;
}

function randomizedSpawnNumbers(seed, count) {
  const playerCount = clampInteger(count, 1, ENGINE.maxPlayers);
  const random = createSeededRandom(`${seed}:spawn-order:${playerCount}`);
  const spawnNumbers = Array.from({ length: ENGINE.maxPlayers }, (_value, index) => index + 1);

  for (let index = spawnNumbers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = spawnNumbers[index];
    spawnNumbers[index] = spawnNumbers[swapIndex];
    spawnNumbers[swapIndex] = value;
  }

  return spawnNumbers.slice(0, playerCount);
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
