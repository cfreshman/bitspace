import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { ENGINE, GAME_MODES } from "../shared/constants.js";
import { addPlayer, createArena, eliminatePlayer, setPlayerInput, snapshotArena, stepArena } from "../shared/arena.js";
import { registerLaserTagMap } from "../shared/laser-tag-maps.js";
import { applyArenaSnapshotDelta, diffArenaSnapshot } from "../shared/snapshot-delta.js";
import { createRoomManager, ROOM_STATES } from "../server/rooms.js";

// Synthetic open arena, isolated from the application's map loader and sockets.
const rows = Array.from({ length: 16 }, (_unused, y) => Array.from({ length: 30 }, (_cell, x) => {
  if (x === 0 || y === 0 || x === 29 || y === 15) return "#";
  if (y === 7 && x === 2) return "R";
  if (y === 7 && x === 27) return "B";
  return " ";
}).join(""));
assert.equal(registerLaserTagMap({ id: "room-lifecycle-test", rows }), true);

function roomFixture(named = false) {
  let now = 1000000;
  const manager = createRoomManager({ now: () => now, seedFactory: (n) => `room-lifecycle-${n}` });
  const clients = ["One", "Two"].map((name) => manager.connectClient({ name, socketId: name }).client);
  for (const client of clients) {
    const result = named
      ? manager.joinNamedRoom(client.clientId, "Lifecycle Test", { mode: GAME_MODES.laserTag })
      : manager.readyClient(client.clientId, { mode: GAME_MODES.laserTag });
    assert.equal(result.ok, true);
  }
  assert.equal(manager.startRoom(clients[0].clientId).ok, true);
  now += ENGINE.lobby.countdownSeconds * 1000 + 1;
  for (const client of clients) manager.recordHeartbeat(client.clientId, client.socketId);
  const tick = () => manager.stepActiveArena(1 / ENGINE.tickRate, stepArena);
  tick();
  tick();
  const room = manager.clientRoom(clients[0].clientId);
  assert.equal(room.state, ROOM_STATES.active);
  return { manager, room, clients, tick, advance: (ms) => { now += ms; } };
}

function holdControls(arena, playerId, sessionId = "lifecycle-session") {
  return setPlayerInput(arena, playerId, {
    sessionId, seq: 1, moveX: 1, aimAngle: 0,
    mining: true, huckRock: true, build: true, interact: true
  });
}

test("Laser Tag leave permanently disables held controls while preserving the score record and client prediction state", () => {
  const { manager, room, clients, tick } = roomFixture();
  const player = room.arena.players.get(clients[0].clientId);
  player.score = 17;
  assert.equal(holdControls(room.arena, player.id), true);
  const previous = snapshotArena(room.arena);
  manager.leaveClient(player.id);
  const { x, y, eliminatedAtTick } = player;
  assert.equal(player.participating, false);
  assert.equal(player.alive, false);
  assert.equal(eliminatePlayer(room.arena, player.id), false, "repeat elimination keeps its return semantics");
  assert.equal(eliminatePlayer(room.arena, "missing"), false);
  assert.equal(holdControls(room.arena, player.id, "new-input-session"), false);
  for (let i = 0; i < 20; i += 1) tick();
  assert.deepEqual([player.x, player.y, player.vx, player.vy], [x, y, 0, 0]);
  assert.equal(player.health, 0);
  assert.equal(player.score, 17);
  assert.equal(player.eliminatedAtTick, eliminatedAtTick);
  assert.equal(player.mining, false);
  assert.equal(player.thrusting, false);
  assert.deepEqual([player.input.moveX, player.input.moveY, player.input.mining, player.input.huckRock, player.input.build, player.input.interact], [0, 0, false, false, false, false]);
  assert.ok(room.arena.laserTag.shots.every((shot) => shot.ownerId !== player.id));

  const full = snapshotArena(room.arena);
  const rebuilt = applyArenaSnapshotDelta(previous, diffArenaSnapshot(previous, full));
  for (const snapshot of [full, rebuilt]) {
    const inactive = snapshot.players.find((candidate) => candidate.id === player.id);
    assert.equal(inactive.alive, false);
    assert.equal(inactive.participating, false);
    assert.equal(inactive.score, 17);
    const source = fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8");
    const declaration = source.match(/function reconcilePrediction\([^]*?^}/m)?.[0];
    assert.ok(declaration);
    const state = { playerId: player.id, prediction: { player: { id: player.id, alive: true }, huckRockCooldownSeconds: 1, huckRocks: [{}] } };
    const context = vm.createContext({ state, clearPredictedHuckRocks: () => { state.prediction.huckRocks = []; } });
    vm.runInContext(declaration, context);
    context.reconcilePrediction(snapshot, 2);
    assert.equal(state.prediction.player, null);
    assert.equal(state.prediction.huckRockCooldownSeconds, 0);
    assert.deepEqual(state.prediction.huckRocks, []);
  }
});

test("Laser Tag heartbeat expiry happens once and reconnect keeps the expired player spectating", () => {
  const { manager, room, clients, tick, advance } = roomFixture();
  const owner = clients[0];
  const player = room.arena.players.get(owner.clientId);
  holdControls(room.arena, player.id);
  manager.disconnectClient(owner.clientId, owner.socketId);
  advance(ENGINE.heartbeat.timeoutSeconds * 1000 + 1);
  manager.recordHeartbeat(clients[1].clientId, clients[1].socketId);
  assert.equal(tick().filter((event) => event.type === "heartbeat-timeout").length, 1);
  for (let i = 0; i < 4; i += 1) assert.equal(tick().filter((event) => event.type === "heartbeat-timeout").length, 0);
  assert.equal(player.alive, false);
  const reconnected = manager.connectClient({ ...owner, socketId: "replacement" });
  assert.equal(reconnected.client.clientId, owner.clientId);
  assert.equal(reconnected.client.clientSecret, owner.clientSecret);
  assert.equal(reconnected.room, room);
  assert.equal(manager.resumeClient(owner.clientId, room.id).ok, true);
  assert.equal(holdControls(room.arena, player.id, "replacement-session"), false);
  tick();
  assert.equal(player.participating, false);
  assert.equal(player.alive, false);
});

test("a reconnect before heartbeat expiry keeps Laser Tag participation and fresh-session input", () => {
  const { manager, room, clients, tick } = roomFixture();
  const owner = clients[0];
  const player = room.arena.players.get(owner.clientId);
  holdControls(room.arena, player.id);
  manager.disconnectClient(owner.clientId, owner.socketId);
  const reconnect = manager.connectClient({ ...owner, socketId: "replacement" });
  assert.equal(reconnect.room, room);
  assert.equal(manager.resumeClient(owner.clientId, room.id).ok, true);
  assert.equal(holdControls(room.arena, player.id, "replacement-session"), true);
  tick();
  assert.equal(player.participating, true);
  assert.equal(player.alive, true);
  assert.equal(player.inputSessionId, "replacement-session");
  assert.equal(player.thrusting, true);
});

test("ordinary Laser Tag hits still produce a temporary ghost and return with full health", () => {
  const arena = createArena({ mode: GAME_MODES.laserTag, playerCount: 2, seed: "lifecycle-tagging" });
  const shooter = addPlayer(arena, { id: "shooter", name: "Shooter" }).player;
  const target = addPlayer(arena, { id: "target", name: "Target" }).player;
  shooter.x = 8 * arena.asteroid.tileSize;
  target.x = 15 * arena.asteroid.tileSize;
  shooter.y = target.y = 10 * arena.asteroid.tileSize;
  for (let hit = 0; hit < ENGINE.laserTag.health; hit += 1) {
    shooter.laserTagCooldownSeconds = 0;
    setPlayerInput(arena, shooter.id, { sessionId: "tagging-session", seq: hit + 1, mining: true, aimAngle: 0 });
    stepArena(arena, 1 / ENGINE.tickRate);
  }
  assert.equal(target.health, 0);
  assert.equal(target.laserTagGhost, true);
  assert.equal(target.participating, true);
  assert.equal(target.alive, true);
  assert.ok(target.eliminatedAtTick > 0, "ordinary tag metadata must not imply permanent departure");
  setPlayerInput(arena, shooter.id, { sessionId: "tagging-session", seq: 4 });
  for (let i = 0; i < ENGINE.tickRate * 6; i += 1) stepArena(arena, 1 / ENGINE.tickRate);
  assert.equal(target.laserTagGhost, false);
  assert.equal(target.health, target.maxHealth);
  assert.equal(target.participating, true);
  assert.equal(target.alive, true);
  assert.equal(shooter.kills, 1);
});

test("leaving during a Laser Tag ghost return remains permanently inactive", () => {
  const { room, manager, clients, tick } = roomFixture();
  const player = room.arena.players.get(clients[0].clientId);
  player.laserTagGhost = true;
  player.health = 0;
  player.laserTagGhostReturn = { elapsedSeconds: 1 };
  manager.leaveClient(player.id);
  for (let i = 0; i < 20; i += 1) tick();
  assert.equal(player.participating, false);
  assert.equal(player.alive, false);
  assert.equal(player.health, 0);
  assert.equal(player.laserTagGhostReturn.elapsedSeconds, 1);
});

for (const named of [false, true]) {
  test(`an empty ${named ? "named" : "public"} Laser Tag room is destroyed when the match time expires`, () => {
    const { room, manager, clients, tick } = roomFixture(named);
    for (const client of clients) manager.leaveClient(client.clientId);
    assert.equal(room.participants.size, 0);
    assert.equal(room.state, ROOM_STATES.active, "preserve the match's existing terminal rule");
    room.arena.tick = room.arena.laserTag.matchSeconds * ENGINE.tickRate - 1;
    const events = tick();
    assert.equal(room.state, ROOM_STATES.ended);
    assert.ok(events.some((event) => event.type === "ended" && event.room === room));
    assert.equal(manager.allRooms().includes(room), false);
    assert.deepEqual(tick(), []);
    if (named) {
      const replacement = manager.joinNamedRoom(clients[0].clientId, "Lifecycle Test", { mode: GAME_MODES.laserTag });
      assert.equal(replacement.ok, true);
      assert.notEqual(replacement.room.id, room.id, "disposed named-room lookup must be removed too");
    }
  });
}

test("an ended public room with participants remains resumable", () => {
  const { room, manager, clients, tick } = roomFixture();
  room.arena.laserTag.teamScores.red = room.arena.laserTag.scoreLimit;
  tick();
  assert.equal(room.state, ROOM_STATES.ended);
  assert.equal(manager.allRooms().includes(room), true);
  assert.equal(manager.resumeClient(clients[0].clientId, room.id).ok, true);
});

test("named-room queued participants survive match end and get fresh participation next lobby", () => {
  const { room, manager, clients, tick, advance } = roomFixture(true);
  const queued = manager.connectClient({ name: "Queued", socketId: "queued" }).client;
  assert.equal(manager.joinNamedRoom(queued.clientId, "Lifecycle Test").queued, true);
  for (const client of clients) manager.leaveClient(client.clientId);
  assert.equal(room.participants.size, 1);
  room.arena.laserTag.teamScores.red = room.arena.laserTag.scoreLimit;
  tick();
  assert.equal(room.state, ROOM_STATES.ended);
  assert.equal(manager.allRooms().includes(room), true);
  advance(room.resetToLobbyAtMs - room.endedAtMs);
  manager.recordHeartbeat(queued.clientId, queued.socketId);
  tick();
  assert.equal(room.state, ROOM_STATES.waiting);
  const player = room.arena.players.get(queued.clientId);
  assert.equal(player.participating, true);
  assert.equal(player.alive, true);
  assert.equal(manager.roomSnapshot(queued.clientId).queued, false);
});
