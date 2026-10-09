import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { Socket } from "socket.io";
import { createEmptyInput, normalizeInput } from "../shared/input.js";
import { buildPlayerWall, purchasePlayerUpgrade, sanitizePlayerName, sanitizeTalkText, snapshotArena } from "../shared/arena.js";
import { createRoomManager, ROOM_STATES, sanitizeClientId, sanitizeClientSecret, sanitizeNamedRoomName } from "../server/rooms.js";
import { ENGINE, GAME_MODES, isWaterThemedGameMode } from "../shared/constants.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../shared/protocol.js";

const client = fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../public/renderer.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const plain = (value) => JSON.parse(JSON.stringify(value));

// Load actual handlers into small fixtures without starting a server, opening
// a browser, or requesting a microphone. No production handler is copied here.
function loadFunctions(source, names, bindings) {
  const context = vm.createContext({ console, ...bindings });
  const declarations = names.map((name) => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, "m"));
    assert.ok(match, `Missing function ${name}`);
    return match[0];
  });
  vm.runInContext(declarations.join("\n"), context);
  return context;
}

function listener(source, event, indent = "") {
  const start = source.indexOf(`${indent}socket.on(${event},`);
  const ending = `\n${indent}});`;
  const end = source.indexOf(ending, start);
  assert.ok(start >= 0 && end > start, `Missing listener ${event}`);
  return source.slice(start, end + ending.length);
}

function voiceFixture() {
  const requests = [];
  const voice = { userGesture: true, joined: false, starting: false, peers: new Map(), micRequestId: 0 };
  const state = { settings: { voiceChat: true, micCapture: true }, room: { roomId: "room-1", state: "waiting" } };
  const context = loadFunctions(client, ["startVoiceMicrophone", "clearVoiceMicrophoneStartTimer", "stopVoiceRoom", "stopVoiceMicrophone", "stopVoiceStream", "updateLocalVoiceTrackState"], {
    voice, state, window: { clearTimeout() {} }, socket: { connected: true, emit() {} }, CLIENT_EVENTS,
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } },
    voiceRoomJoinAllowed: () => state.settings.voiceChat,
    voiceMicCaptureAllowed: () => state.settings.micCapture,
    voiceRoomTransmitAllowed: () => state.settings.voiceChat && state.settings.micCapture,
    disconnectLocalVoiceMeter() {}, resumeVoiceAudioContext() {}, setupLocalVoiceMeter() {},
    restartVoiceRoomForLocalTracks() {}, closeVoicePeer() {}
  });
  return { context, voice, state, requests };
}

function stream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

test("voice remains opt-in after reload and volume changes", () => {
  const storage = new Map([["settings", JSON.stringify({ voiceChat: true, hudLocation: "bottom", micCapture: false })]]);
  const context = loadFunctions(client, ["loadSettings", "normalizeSettings", "saveSettings", "setSettingValue", "isVolumeSetting", "effectiveVoiceSettingVolume"], {
    state: {}, clamp, SETTINGS_STORAGE_KEY: "settings", HUD_LOCATIONS: ["top-left", "top", "bottom"], MUSIC_TRACK_FULL_VOLUME_SETTING: 0.5,
    window: { localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } },
    applySettingsSideEffects() {}, requestVolumePreview() {}, requestMechanicalBeep() {}
  });
  vm.runInContext(client.match(/const DEFAULT_SETTINGS = Object.freeze\({[^]*?^}\);/m)[0], context);
  context.state.settings = context.loadSettings();
  assert.equal(context.state.settings.voiceChat, false);
  assert.equal(context.state.settings.hudLocation, "bottom");
  assert.equal(context.state.settings.micCapture, false);
  for (const id of ["masterVolume", "voiceVolume"]) {
    context.setSettingValue(id, 0);
    context.setSettingValue(id, 1);
    assert.equal(context.state.settings.voiceChat, false);
  }
  context.setSettingValue("voiceChat", true);
  assert.equal(context.state.settings.voiceChat, true);
  assert.equal(context.loadSettings().voiceChat, false);
});

test("voice off/on invalidates pending capture and stops every returned track", async () => {
  const { context, voice, state, requests } = voiceFixture();
  const oldRequest = context.startVoiceMicrophone();
  state.settings.voiceChat = false;
  context.stopVoiceRoom({ notify: false, keepGesture: true });
  state.settings.voiceChat = true;
  const newRequest = context.startVoiceMicrophone();
  const oldStream = stream(), newStream = stream();
  requests[0].resolve(oldStream);
  await oldRequest;
  assert.equal(oldStream.track.stopped, true);
  assert.equal(voice.micStarting, true, "stale completion must not clear the current request's flag");
  requests[1].resolve(newStream);
  await newRequest;
  assert.equal(voice.localStream, newStream);
  state.settings.voiceChat = false;
  context.stopVoiceRoom({ notify: false, keepGesture: true });
  assert.equal(newStream.track.stopped, true);
  assert.equal(voice.localStream, null);
});

test("stale microphone rejection cannot overwrite a newer attempt", async () => {
  const { context, voice, requests } = voiceFixture();
  const oldRequest = context.startVoiceMicrophone();
  context.stopVoiceMicrophone({ restartPeers: false });
  const newRequest = context.startVoiceMicrophone();
  requests[0].reject(new Error("old permission request"));
  await oldRequest;
  assert.equal(voice.micError, null);
  assert.equal(voice.micStarting, true);
  const current = stream();
  requests[1].resolve(current);
  await newRequest;
  context.stopVoiceMicrophone({ restartPeers: false });
  assert.equal(current.track.stopped, true);
});

test("malformed packet fields cannot throw or bypass normal input normalization", () => {
  const bad = JSON.parse('{"toString":null,"valueOf":null}');
  for (const payload of [null, false, [], "invalid"]) assert.deepEqual(normalizeInput(payload), createEmptyInput());
  const input = normalizeInput({ moveX: bad, aimAngle: bad, seq: bad, sessionId: bad, huckRockTargetX: bad });
  assert.equal(input.moveX, 0);
  assert.equal(input.aimAngle, 0);
  assert.equal(input.seq, 0);
  assert.equal(input.sessionId, "");
  assert.equal(input.huckRockTargetX, null);
  const diagonal = normalizeInput({ moveX: 1, moveY: 1 });
  assert.ok(Math.abs(Math.hypot(diagonal.moveX, diagonal.moveY) - 1) < 1e-12);
  assert.equal(normalizeInput({ sessionId: "session_123", seq: 2, moveX: 1 }).sessionId, "session_123");
  const arena = { mode: "bitspace", players: new Map([["player", { alive: true }]]) };
  for (const payload of [null, [], { tileX: bad, tileY: 1 }]) assert.equal(buildPlayerWall(arena, "player", payload).reason, "invalid_build_tile");
  assert.equal(purchasePlayerUpgrade(arena, "player", bad).reason, "unknown_upgrade");
  assert.equal(sanitizePlayerName(bad), "Pilot");
  assert.equal(sanitizeTalkText(bad), "");
  for (const sanitize of [sanitizeClientId, sanitizeClientSecret, sanitizeNamedRoomName]) assert.equal(sanitize(bad), "");
});

test("Socket.IO dispatch ignores malformed voice packets and still relays valid ones", async () => {
  const socket = new EventEmitter();
  socket.connected = true;
  socket.run = (_event, next) => next();
  const received = [];
  const room = { id: "room-1", participants: new Map([["local", {}], ["peer", {}]]) };
  const context = loadFunctions(server, ["relayVoiceSignal"], {
    socket, clientId: "local", CLIENT_EVENTS, SERVER_EVENTS, isCurrentSocket: () => true,
    roomManager: { clientRoom: () => room }, voiceClientsByRoom: new Map([[room.id, new Set(["local", "peer"])]]),
    socketForRoomParticipant: () => ({ emit: (...args) => received.push(args) })
  });
  vm.runInContext(listener(server, "CLIENT_EVENTS.voiceSignal", "  "), context);
  for (const payload of [null, undefined, [], false, "invalid"]) Socket.prototype.dispatch.call(socket, [CLIENT_EVENTS.voiceSignal, payload]);
  await new Promise(setImmediate);
  assert.equal(received.length, 0);
  Socket.prototype.dispatch.call(socket, [CLIENT_EVENTS.voiceSignal, { targetId: "peer", signal: { candidate: {} } }]);
  await new Promise(setImmediate);
  assert.equal(received.length, 1);
  assert.equal(received[0][1].fromId, "local");
});

test("stale disconnect preserves the new socket's game session and voice membership", () => {
  const manager = createRoomManager({ seedFactory: () => "regression-tabs", now: () => 1000 });
  const owner = manager.connectClient({ name: "Owner", socketId: "old" }).client;
  const room = manager.readyClient(owner.clientId).room;
  const peer = manager.connectClient({ name: "Peer", socketId: "peer" }).client;
  manager.readyClient(peer.clientId);
  manager.connectClient({ clientId: owner.clientId, clientSecret: owner.clientSecret, name: owner.name, socketId: "new" });
  const peers = new Set([owner.clientId, peer.clientId]);
  const socket = new EventEmitter();
  socket.id = "old";
  socket.data = { clientId: owner.clientId };
  const context = loadFunctions(server, ["leaveVoiceRoom", "isCurrentSocket"], {
    socket, clientId: owner.clientId, roomManager: manager, voiceClientsByRoom: new Map([[room.id, peers]]),
    SERVER_EVENTS, socketForRoomParticipant: () => ({ emit() {} }), broadcastRoom() {}
  });
  vm.runInContext(listener(server, '"disconnect"', "  "), context);
  socket.emit("disconnect");
  assert.equal(manager.isCurrentSocket(owner.clientId, "new"), true);
  assert.equal(peers.has(owner.clientId), true);
  socket.id = "new";
  socket.emit("disconnect");
  assert.equal(peers.has(owner.clientId), false);
});

test("snapshot cleanup removes destroyed rooms without removing live rooms", () => {
  const manager = createRoomManager({ seedFactory: (n) => `regression-cache-${n}`, now: () => 1000 });
  const client = manager.connectClient({ name: "Player", socketId: "player" }).client;
  const dead = manager.readyClient(client.clientId).room;
  manager.leaveClient(client.clientId);
  const live = manager.readyClient(client.clientId).room;
  const baselines = new Map();
  const context = loadFunctions(server, ["broadcastSnapshot"], {
    roomManager: manager, roomSnapshotBaselines: baselines, snapshotArena, ENGINE, ROOM_STATES, SERVER_EVENTS,
    io: { to: () => ({ emit() {} }) }, roomChannel: (room) => room.id,
    performance: { now: () => 1000 }, lastTickTime: 1000, stepArena() {}, takeAsteroidUpdates: () => []
  });
  context.broadcastSnapshot(dead);
  context.broadcastSnapshot(live);
  const body = server.match(/setInterval\(\(\) => \{([^]*?)\n\}, 1000 \/ ENGINE.tickRate\);/)[1];
  vm.runInContext(`function tick(){${body}\n}`, context);
  context.tick();
  assert.equal(baselines.has(dead.id), false);
  assert.equal(baselines.has(live.id), true);
});

function leaveFixture() {
  const storage = new Map([["room", "room-1"], ["identity", "keep-me"]]);
  const events = [];
  const state = { clientId: "client_12345", room: { state: "active", roomId: "room-1" }, pendingLeaveRoomId: "" };
  const socket = { connected: false, auth: {}, emit: (...args) => events.push(args), on: (_event, fn) => { context.welcome = fn; } };
  const context = loadFunctions(client, ["leaveCurrentRoom", "requestPendingRoomLeave", "loadPendingRoomLeave", "setPendingRoomLeave", "handleServerRoom"], {
    state, socket, CLIENT_EVENTS, SERVER_EVENTS, PENDING_LEAVE_STORAGE_KEY: "pending", ROOM_ID_PATTERN: /^room-\d+$/,
    window: { localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } },
    isLocalBotGame: () => state.localBots === true, clearResumeFallbackTimer() {},
    storedRoomId: () => storage.get("room"), forgetRegisteredRoom: () => storage.delete("room"),
    applyServerRoom: (room) => { state.room = room; }, emitHeartbeat() {},
    CLIENT_ID_STORAGE_KEY: "identity", CLIENT_SECRET_STORAGE_KEY: "secret",
    requestRoomReattach: () => events.push(["resume"]), requestPathNamedRoomJoin: () => events.push(["join"])
  });
  vm.runInContext(listener(client, "SERVER_EVENTS.welcome"), context);
  return { context, state, socket, storage, events };
}

test("offline leave reaches menu, persists across refresh, and completes on reconnect", () => {
  const { context, state, socket, storage, events } = leaveFixture();
  context.leaveCurrentRoom();
  assert.equal(state.room.state, "menu");
  assert.equal(storage.has("room"), false);
  assert.equal(storage.get("identity"), "keep-me");
  assert.equal(context.loadPendingRoomLeave(), "room-1");
  assert.equal(events.length, 0);
  state.pendingLeaveRoomId = context.loadPendingRoomLeave();
  socket.connected = true;
  context.welcome({ clientId: state.clientId, playerId: state.clientId });
  assert.deepEqual(plain(events), [[CLIENT_EVENTS.leave, { roomId: "room-1" }]]);
  context.handleServerRoom({ state: "active", roomId: "room-1" });
  assert.equal(state.room.state, "menu");
  context.handleServerRoom({ state: "menu" });
  assert.equal(storage.has("pending"), false);
});

test("leave acknowledgement does not replace an ongoing local bot game", () => {
  const { context, state, storage } = leaveFixture();
  context.leaveCurrentRoom();
  state.localBots = true;
  state.room = { state: "active", localBots: true };
  context.handleServerRoom({ state: "menu" });
  assert.equal(state.room.localBots, true);
  assert.equal(storage.has("pending"), false);
});

test("a deferred leave targets its original room rather than another current room", () => {
  let left = false, reported = false;
  const socket = new EventEmitter();
  const context = vm.createContext({ socket, clientId: "player", CLIENT_EVENTS, SERVER_EVENTS,
    isCurrentSocket: () => true, roomManager: { clientRoom: () => ({ id: "room-2" }), leaveClient: () => { left = true; } },
    emitRoom: () => { reported = true; } });
  vm.runInContext(listener(server, "CLIENT_EVENTS.leave", "  "), context);
  socket.emit(CLIENT_EVENTS.leave, { roomId: "room-1" });
  assert.equal(left, false);
  assert.equal(reported, true);
});

test("background input is neutral and held controller/touch input is cleared", () => {
  const state = { inputSeq: 0, playerId: "player", mouse: { down: true }, controller: { move: { x: 1, y: 0 }, mining: true, huckRock: true } };
  let mobileCleared = false, queueCleared = false;
  const context = loadFunctions(client, ["clearHeldPlayerInput", "isInputBlocked", "readInput"], {
    state, document: { hidden: true }, keys: new Set(["KeyW"]), releasedKeysUntilKeyup: new Set(),
    resetMobileJoysticks: () => { mobileCleared = true; }, clearMobileHuckRockQueue: () => { queueCleared = true; }, clearSettingsDrag() {},
    isRoomUiBlocking: () => false, predictedLocalPlayer: () => null, localPlayerFromSnapshot: () => ({}), inputAimAngleForPlayer: () => 0,
    normalizeInput, inputSessionId: "session_123", readMoveVector: () => state.controller.move
  });
  state.chat = { active: false };
  const input = context.readInput();
  assert.equal(input.moveX, 0);
  assert.equal(input.mining, false);
  assert.equal(input.huckRock, false);
  context.clearHeldPlayerInput();
  assert.equal(state.controller.move.x, 0);
  assert.equal(state.controller.mining, false);
  assert.equal(state.controller.huckRock, false);
  assert.ok(mobileCleared && queueCleared);
});

test("desktop thrust remains digital while touch thrust stays analog", () => {
  let mobile = false;
  const context = loadFunctions(client, ["readMoveVector", "controllerShipMoveVector"], {
    state: { mobile: { move: { x: 0.1, y: 0 } }, controller: { connected: true, cursor: { visible: false }, move: { x: 0.1, y: 0 } } },
    mobileControlsActive: () => mobile, axis: () => 0
  });
  assert.equal(context.readMoveVector().x, 1);
  mobile = true;
  assert.equal(context.readMoveVector().x, 0.1);
});

test("voice toggle is visible and hittable on countdown, terminal, and confirm screens", () => {
  const names = ["drawStartingOverlay", "drawTerminalLeaveAction", "drawTerminalConfirmLeaveAction", "drawVoiceToggle", "drawVoiceToggleAction", "drawVoiceToggleNearAction", "voiceHudLabel", "hudLocation", "hudStacksUp", "terminalActionLineStep", "mobileHudVisibleHeight", "mobileHudVisibleWidth", "mobileHudBottomY", "mobileHudControlBlockY"];
  const drawn = [];
  const context = loadFunctions(renderer, names, { HUD_PANEL_ROW_STEP: 10, HUD_PANEL_TEXT_HEIGHT: 7, HUD_PANEL_PADDING: 4, HUD_EDGE_INSET: 0, MOBILE_HUD_EDGE_INSET: 0, HUD_CONTROL_VISIBLE_HEIGHT: 9, MOBILE_HUD_ACTION_HEIGHT: 12, HUD_CONTROL_TEXT_BORDER: {},
    mobileControlsActiveForRender: () => false, drawPanel() {}, drawCenteredText() {}, drawControllerHudAction() {}, formatClock: () => "0:10" });
  const canvas = { width: 384, height: 384, fillRect() {} };
  const colors = { foreground: "#fff", background: "#000" };
  const text = { measure: (value) => value.length * 4, draw: (_ctx, value) => drawn.push(value) };
  for (const mobileActive of [false, true]) {
    for (const enabled of [false, true]) {
      for (const draw of ["drawStartingOverlay", "drawTerminalLeaveAction", "drawTerminalConfirmLeaveAction"]) {
        const voiceUi = { mobileActive, enabled, toggleRect: null };
        const options = { mobileActive, voiceUi, settings: { hudLocation: "bottom" } };
        if (draw === "drawStartingOverlay") context[draw](canvas, 10, options, colors, text);
        else context[draw](canvas, 0, 370, options, colors, text);
        assert.ok(voiceUi.toggleRect, draw);
        assert.ok(voiceUi.toggleRect.y >= 0 && voiceUi.toggleRect.y + voiceUi.toggleRect.height <= canvas.height);
        assert.ok(drawn.some((value) => value.includes(`VOICE IS ${enabled ? "ON" : "OFF"}`)));
        drawn.length = 0;
      }
    }
  }
});

test("touching the voice toggle in upgrades toggles voice without closing upgrades or buying", () => {
  const state = { upgrades: { active: true } };
  let toggled = false;
  const context = loadFunctions(client, ["handleMobilePointerDown"], {
    state, mobileControlsActive: () => true, unlockAudio() {}, updateMouse() {}, mobileHudFramePointFromEvent: () => ({ x: 10, y: 10 }), isSettingsMenu: () => false,
    screenRoomButtonAtPoint: () => "voiceToggle", handleRoomUiClick: () => { toggled = true; }
  });
  assert.equal(context.handleMobilePointerDown({ preventDefault() {} }), true);
  assert.equal(toggled, true);
  assert.equal(state.upgrades.active, true);
});

test("mobile upgrade rendering includes the voice toggle beside CLOSE", () => {
  const drawn = [];
  const context = loadFunctions(renderer, ["drawFrame", "drawVoiceToggle", "drawVoiceToggleAction", "voiceHudLabel"], {
    GAME_MODES, isWaterThemedGameMode, trueBackingColor: (colors) => colors.background,
    HUD_PANEL_ROW_STEP: 10, HUD_CONTROL_TEXT_BORDER: {}, MOBILE_UPGRADE_CLOSE_ACTION: { width: 52, gap: 7 },
    drawUpgradeHud() {}, upgradeMenuLayout: () => ({ panel: { x: 8, y: 140, width: 132, height: 124 } })
  });
  const voiceUi = { mobileActive: true, enabled: false, toggleRect: null };
  const canvas = { width: 220, height: 300, fillRect() {} };
  context.drawFrame(canvas, { tick: 1, players: [] }, {
    renderPhase: "hud", gameMode: GAME_MODES.bitspace, room: { state: "active" }, mobileActive: true, upgrades: { active: true }, voiceUi,
    renderState: { ready: true, localPlayer: { alive: true } }
  }, { foreground: "#fff", background: "#000" }, { measure: (value) => value.length * 4, draw: (_ctx, value) => drawn.push(value) }, {});
  assert.ok(drawn.includes("VOICE IS OFF"));
  assert.ok(voiceUi.toggleRect.x > 8 + 2 + 52);
  assert.ok(voiceUi.toggleRect.y + voiceUi.toggleRect.height <= canvas.height);
});

test("syntax check fails when an earlier file is invalid", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bitspace-check-"));
  try {
    for (const dir of ["server", "shared/core", "public", "scripts"]) fs.mkdirSync(path.join(directory, dir), { recursive: true });
    for (const file of ["server/a.js", "shared/a.js", "shared/core/a.js", "scripts/a.mjs"]) fs.writeFileSync(path.join(directory, file), "const valid = 1;\n");
    fs.writeFileSync(path.join(directory, "public/a.js"), "const invalid = ;\n");
    const result = spawnSync("sh", ["-c", pkg.scripts.check], { cwd: directory, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SyntaxError/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function deploymentFixture(failTests = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bitspace-deploy-"));
  const project = path.join(directory, "project"), other = path.join(directory, "other"), bin = path.join(directory, "bin");
  for (const dir of [path.join(project, "scripts"), other, bin]) fs.mkdirSync(dir, { recursive: true });
  for (const file of ["deploy.sh", "deploy-digitalocean.sh", "config.sh"]) {
    fs.copyFileSync(new URL(`../scripts/${file}`, import.meta.url), path.join(project, "scripts", file));
  }
  const log = path.join(directory, "calls");
  const record = 'printf "%s|%s\\n" "$PWD" "$*" >> "$BITSPACE_TEST_LOG"\n';
  fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env bash\n${record}if [[ "$1" == "test" && "$BITSPACE_TEST_FAIL" == "1" ]]; then exit 3; fi\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "ssh"), `#!/usr/bin/env bash\n${record}cat >/dev/null\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "rsync"), `#!/usr/bin/env bash\n${record}`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BITSPACE_TEST_LOG: log, BITSPACE_TEST_FAIL: failTests ? "1" : "0",
    BITSPACE_DO_HOST: "user@example.invalid", BITSPACE_REMOTE_HOST: "user@example.invalid", BITSPACE_DO_CONFIGURE_WEB: "0" };
  delete env.BITSPACE_DO_BOOTSTRAP;
  return { directory, project, other, log, env };
}

test("deployment anchors to its project and skips provisioning by default", () => {
  const fixture = deploymentFixture();
  try {
    const result = spawnSync("bash", [path.join(fixture.project, "scripts/deploy-digitalocean.sh")], { cwd: fixture.other, env: fixture.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(fixture.log, "utf8").split("\n").filter(Boolean);
    assert.ok(calls.every((line) => line.startsWith(`${fixture.project}|`)));
    assert.ok(calls.some((line) => line.includes("|test")));
    assert.ok(calls.some((line) => line.includes("mkdir -p")));
    assert.ok(calls.some((line) => line.includes("BITSPACE_BOOTSTRAP=0")));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("both deployment scripts stop before SSH or upload when tests fail", () => {
  for (const script of ["deploy.sh", "deploy-digitalocean.sh"]) {
    const fixture = deploymentFixture(true);
    try {
      const result = spawnSync("bash", [path.join(fixture.project, "scripts", script)], { cwd: fixture.other, env: fixture.env, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      const calls = fs.readFileSync(fixture.log, "utf8");
      assert.ok(calls.includes("|test"));
      assert.ok(!calls.includes("example.invalid"), "failed checks must not contact the deployment host");
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});
