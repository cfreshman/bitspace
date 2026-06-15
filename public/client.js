import { ENGINE } from "/shared/constants.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "/shared/protocol.js";
import { normalizeInput } from "/shared/input.js";
import {
  aggregateUpgradeEffects,
  canAffordUpgrade,
  nextUpgradeCost,
  UPGRADE_DEFINITIONS
} from "/shared/upgrades.js";
import { createRenderer } from "/renderer.js";

const TALK_MAX_CHARS = 36;
const CLIENT_ID_STORAGE_KEY = "bitspace.clientId";
const CLIENT_SECRET_STORAGE_KEY = "bitspace.clientSecret";
const ROOM_ID_STORAGE_KEY = "bitspace.roomId";
const LEGACY_REGISTERED_ROOM_STORAGE_KEY = "bitspace.registeredRoom";
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{12,48}$/;
const CLIENT_SECRET_PATTERN = /^[a-zA-Z0-9_-]{24,96}$/;
const ROOM_ID_PATTERN = /^room-\d+$/;
const PREDICTION_SNAP_DISTANCE = 96;
const PREDICTION_POSITION_CORRECTION = 0.08;
const PREDICTION_VELOCITY_CORRECTION = 0.2;
const ELIMINATION_NOTICE_SECONDS = 4;
const ELIMINATION_NOTICE_MAX = 3;
const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 60,
  width: 330,
  rowTopOffset: 38,
  rowHeight: 24,
  rowInset: 12
});
const ROOM_BUTTONS = Object.freeze({
  ready: { x: 132, y: 216, width: 120, height: 28 },
  leaveSpectating: { x: 132, y: 330, width: 120, height: 28 },
  leaveEnded: { x: 132, y: 330, width: 120, height: 28 }
});
const canvas = document.querySelector("#scene");
const renderer = createRenderer(canvas);
const talkInput = createTalkInput();
const keys = new Set();
const storedClientId = getClientId();
const storedClientSecret = getClientSecret();
const inputSessionId = randomClientSecret();
const audio = {
  context: null,
  unlocked: false,
  pendingBeeps: 0
};
const state = {
  clientId: storedClientId,
  playerId: null,
  room: null,
  snapshot: null,
  asteroid: null,
  prediction: {
    player: null,
    lastTimeSeconds: 0
  },
  eliminationNotices: [],
  playerAliveById: new Map(),
  lastRoomId: null,
  inputSeq: 0,
  mouse: {
    x: 0,
    y: 0,
    down: false,
    aimAngle: 0
  },
  chat: {
    active: false,
    draft: "",
    caret: 0,
    selectionStart: 0,
    selectionEnd: 0
  },
  upgrades: {
    active: false,
    selectedIndex: 0
  },
  uiHoverId: null,
  lastReattachRequestAt: 0
};

const socket = window.io({
  auth: {
    name: getPlayerName(),
    clientId: storedClientId,
    clientSecret: storedClientSecret
  }
});

socket.on(SERVER_EVENTS.welcome, (payload) => {
  state.clientId = payload.clientId;
  state.playerId = payload.playerId;
  if (payload.clientId) {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, payload.clientId);
    socket.auth = {
      ...socket.auth,
      clientId: payload.clientId
    };
  }
  if (payload.clientSecret) {
    window.localStorage.setItem(CLIENT_SECRET_STORAGE_KEY, payload.clientSecret);
    socket.auth = {
      ...socket.auth,
      clientSecret: payload.clientSecret
    };
  }
  requestRoomReattach(0, true);
});

socket.on(SERVER_EVENTS.room, (room) => {
  const previousState = state.room?.state;
  if (room?.clientId) {
    state.clientId = room.clientId;
    state.playerId = room.clientId;
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, room.clientId);
  }
  state.room = room;
  state.uiHoverId = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  if (state.lastRoomId !== (room?.roomId || null)) {
    state.lastRoomId = room?.roomId || null;
    state.eliminationNotices = [];
    state.playerAliveById.clear();
  }

  if (!room || room.state === "menu") {
    state.snapshot = null;
    state.asteroid = null;
    state.prediction.player = null;
    state.eliminationNotices = [];
    state.playerAliveById.clear();
    state.upgrades.active = false;
    state.mouse.down = false;
    forgetRegisteredRoom();
    return;
  }

  rememberRegisteredRoom(room.roomId);
  if (previousState !== room.state) {
    state.upgrades.active = false;
  }
});

socket.on(SERVER_EVENTS.snapshot, (snapshot) => {
  recordEliminations(snapshot, performance.now() / 1000);
  state.snapshot = snapshot;
  reconcilePrediction(snapshot, performance.now() / 1000);
});

socket.on(SERVER_EVENTS.asteroid, (asteroid) => {
  state.asteroid = {
    ...asteroid,
    tiles: asteroid.tiles.split(""),
    amounts: asteroid.amounts.split("")
  };
});

socket.on(SERVER_EVENTS.asteroidUpdate, (updates) => {
  if (!state.asteroid) {
    return;
  }

  for (const update of updates) {
    state.asteroid.tiles[update.index] = update.tile;
    state.asteroid.amounts[update.index] = update.amount;
  }
});

socket.on(SERVER_EVENTS.beep, () => {
  requestMechanicalBeep();
});

window.addEventListener("keydown", (event) => {
  unlockAudio();
  if (state.chat.active) {
    return;
  }

  if (isRoomUiBlocking()) {
    if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
      event.preventDefault();
    }
    keys.add(event.code);
    return;
  }

  if (state.upgrades.active) {
    handleUpgradeKey(event);
    return;
  }

  if (event.code === "KeyT" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    activateTalk();
    return;
  }

  if (event.code === "KeyU" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    activateUpgrades();
    return;
  }

  if (shouldCaptureKey(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  if (state.chat.active) {
    return;
  }

  if (isRoomUiBlocking()) {
    if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
      event.preventDefault();
    }
    keys.delete(event.code);
    return;
  }

  if (state.upgrades.active) {
    if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
      event.preventDefault();
    }
    return;
  }

  if (shouldCaptureKey(event.code)) {
    event.preventDefault();
  }
  keys.delete(event.code);
});

window.addEventListener("blur", () => {
  keys.clear();
  state.mouse.down = false;
});

talkInput.addEventListener("input", syncTalkDraft);
talkInput.addEventListener("keyup", syncTalkDraft);
talkInput.addEventListener("click", syncTalkDraft);
talkInput.addEventListener("select", syncTalkDraft);
talkInput.addEventListener("pointerup", syncTalkDraft);
talkInput.addEventListener("keydown", (event) => {
  event.stopPropagation();

  if (event.key === "Enter") {
    event.preventDefault();
    submitTalk();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeTalk();
    return;
  }

  requestAnimationFrame(syncTalkDraft);
});

canvas.addEventListener("pointermove", (event) => {
  updateMouse(event);
  state.uiHoverId = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  if (state.upgrades.active) {
    updateUpgradeSelectionFromMouse();
  }
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  unlockAudio();
  updateMouse(event);
  const screenButton = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  if (screenButton) {
    handleRoomUiClick(screenButton);
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (isRoomUiBlocking()) {
    state.mouse.down = false;
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (state.upgrades.active) {
    updateUpgradeSelectionFromMouse();
    buySelectedUpgrade();
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  state.mouse.down = true;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointerup", (event) => {
  event.preventDefault();
  updateMouse(event);
  state.mouse.down = false;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
});

canvas.addEventListener("pointercancel", (event) => {
  event.preventDefault();
  updateMouse(event);
  state.mouse.down = false;
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

setInterval(() => {
  if (!socket.connected || !state.playerId) {
    return;
  }

  const now = performance.now();
  if (needsReattachRepair()) {
    requestRoomReattach(now, true);
  }

  socket.emit(CLIENT_EVENTS.input, readInput());
}, 1000 / ENGINE.tickRate);

requestAnimationFrame(draw);

function draw(now = 0) {
  const timeSeconds = now / 1000;

  pruneEliminationNotices(timeSeconds);
  updatePrediction(timeSeconds);
  updateAimFromSnapshot();
  const cameraPlayerId = cameraPlayerIdForRoom();
  state.uiHoverId = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  renderer.draw(state.snapshot, {
    playerId: state.playerId,
    cameraPlayerId,
    asteroid: state.asteroid,
    chat: state.chat,
    upgrades: state.upgrades,
    room: state.room,
    clientId: state.clientId,
    roomButtons: activeRoomButtons(),
    uiRayActive: state.mouse.down,
    uiTargetId: state.uiHoverId,
    aimAngle: state.mouse.aimAngle,
    mining: state.mouse.down && !state.chat.active && !state.upgrades.active && !isInputBlocked(),
    predictedPlayer: predictedLocalPlayer(),
    eliminationNotices: state.eliminationNotices,
    timeSeconds
  });
  requestAnimationFrame(draw);
}

function createTalkInput() {
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = TALK_MAX_CHARS;
  input.autocomplete = "off";
  input.autocapitalize = "sentences";
  input.spellcheck = false;
  input.className = "talk-input";
  input.setAttribute("aria-label", "Talk");
  document.body.append(input);
  return input;
}

function activateTalk() {
  if (isInputBlocked()) {
    return;
  }

  state.chat.active = true;
  state.upgrades.active = false;
  state.mouse.down = false;
  keys.clear();
  talkInput.value = "";
  talkInput.focus({ preventScroll: true });
  syncTalkDraft();
}

function activateUpgrades() {
  if (isInputBlocked() || state.room?.state !== "active") {
    return;
  }

  state.upgrades.active = true;
  state.mouse.down = false;
  keys.clear();
  updateUpgradeSelectionFromMouse();
}

function closeUpgrades() {
  state.upgrades.active = false;
}

function handleUpgradeKey(event) {
  if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
    event.preventDefault();
  }

  if (event.code === "Escape" || event.code === "KeyU") {
    if (event.repeat) {
      return;
    }
    closeUpgrades();
    return;
  }
}

function closeTalk() {
  state.chat.active = false;
  talkInput.blur();
  talkInput.value = "";
  syncTalkDraft();
}

function submitTalk() {
  const text = talkInput.value.trim().replace(/\s+/g, " ");
  if (text && socket.connected) {
    socket.emit(CLIENT_EVENTS.talk, text);
  }

  closeTalk();
}

function syncTalkDraft() {
  state.chat.draft = talkInput.value;
  state.chat.caret = talkInput.selectionStart ?? talkInput.value.length;
  state.chat.selectionStart = talkInput.selectionStart ?? state.chat.caret;
  state.chat.selectionEnd = talkInput.selectionEnd ?? state.chat.caret;
}

function unlockAudio() {
  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  if (context.state === "suspended") {
    context.resume()
      .then(flushPendingBeeps)
      .catch(() => {});
  } else {
    flushPendingBeeps();
  }
  audio.unlocked = true;
}

function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  return new AudioContextClass();
}

function requestMechanicalBeep() {
  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  if (context.state === "suspended") {
    audio.pendingBeeps = Math.min(audio.pendingBeeps + 1, 3);
    context.resume()
      .then(flushPendingBeeps)
      .catch(() => {});
    return;
  }

  playMechanicalBeep(context);
}

function flushPendingBeeps() {
  const context = audio.context;
  if (!context || context.state !== "running" || audio.pendingBeeps <= 0) {
    return;
  }

  const beeps = audio.pendingBeeps;
  audio.pendingBeeps = 0;
  for (let index = 0; index < beeps; index += 1) {
    playMechanicalBeep(context, index * 0.18);
  }
}

function playMechanicalBeep(context, delay = 0) {
  const start = context.currentTime + 0.01;
  playMechanicalTone(context, 760, start + delay, 0.075, 0.065);
  playMechanicalTone(context, 520, start + delay + 0.092, 0.07, 0.055);
}

function playMechanicalTone(context, frequency, start, duration, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function readInput() {
  state.inputSeq += 1;
  if (state.chat.active || state.upgrades.active || isInputBlocked()) {
    return normalizeInput({
      sessionId: inputSessionId,
      seq: state.inputSeq,
      moveX: 0,
      moveY: 0,
      aimAngle: state.mouse.aimAngle,
      mining: false,
      interact: false,
      build: false
    });
  }

  const move = readMoveVector();

  return normalizeInput({
    sessionId: inputSessionId,
    seq: state.inputSeq,
    moveX: move.x,
    moveY: move.y,
    aimAngle: state.mouse.aimAngle,
    mining: state.mouse.down,
    interact: keys.has("KeyE"),
    build: keys.has("KeyB")
  });
}

function readMoveVector() {
  const x = axis("KeyD", "ArrowRight", "KeyA", "ArrowLeft");
  const y = axis("KeyS", "ArrowDown", "KeyW", "ArrowUp");
  const magnitude = Math.hypot(x, y);

  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: x / magnitude,
    y: y / magnitude
  };
}

function reconcilePrediction(snapshot, timeSeconds) {
  const authoritative = snapshot.players.find((candidate) => candidate.id === state.playerId);
  if (!authoritative || !authoritative.alive) {
    state.prediction.player = null;
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  if (!state.prediction.player || state.prediction.player.id !== authoritative.id) {
    state.prediction.player = { ...authoritative };
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  const predicted = state.prediction.player;
  const dx = authoritative.x - predicted.x;
  const dy = authoritative.y - predicted.y;
  const distance = Math.hypot(dx, dy);

  if (distance > PREDICTION_SNAP_DISTANCE) {
    state.prediction.player = { ...authoritative };
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  state.prediction.player = {
    ...authoritative,
    x: predicted.x + dx * PREDICTION_POSITION_CORRECTION,
    y: predicted.y + dy * PREDICTION_POSITION_CORRECTION,
    vx: predicted.vx + (authoritative.vx - predicted.vx) * PREDICTION_VELOCITY_CORRECTION,
    vy: predicted.vy + (authoritative.vy - predicted.vy) * PREDICTION_VELOCITY_CORRECTION,
    angle: predicted.angle,
    aimAngle: state.mouse.aimAngle,
    mining: state.mouse.down && !state.chat.active && !state.upgrades.active && !isInputBlocked()
  };
}

function updatePrediction(timeSeconds) {
  const predicted = state.prediction.player;
  if (!predicted || !predicted.alive) {
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  const dtSeconds = clamp(timeSeconds - state.prediction.lastTimeSeconds, 0, 1 / 15);
  state.prediction.lastTimeSeconds = timeSeconds;
  if (dtSeconds <= 0) {
    return;
  }

  const move = state.chat.active || state.upgrades.active || isInputBlocked()
    ? { x: 0, y: 0 }
    : readMoveVector();
  const effects = aggregateUpgradeEffects(predicted.upgrades);
  const isMoving = move.x !== 0 || move.y !== 0;

  if (isMoving) {
    predicted.angle = normalizeAngle(Math.atan2(move.y, move.x));
    predicted.vx += move.x * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
    predicted.vy += move.y * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
  }

  predicted.aimAngle = state.mouse.aimAngle;
  predicted.mining = state.mouse.down && !state.chat.active && !state.upgrades.active && !isInputBlocked();
  predicted.thrusting = isMoving;

  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const drag = Math.pow(ENGINE.ship.drag * effects.dragMultiplier, dtSeconds / fixedStepSeconds);
  predicted.vx *= drag;
  predicted.vy *= drag;

  const velocity = clampMagnitude(predicted.vx, predicted.vy, ENGINE.ship.maxSpeed * effects.maxSpeedMultiplier);
  predicted.vx = velocity.x;
  predicted.vy = velocity.y;
  predicted.x += predicted.vx * dtSeconds;
  predicted.y += predicted.vy * dtSeconds;
}

function predictedLocalPlayer() {
  const predicted = state.prediction.player;
  const authoritative = localPlayerFromSnapshot();
  if (!predicted || !authoritative || !authoritative.alive) {
    return null;
  }

  return {
    ...authoritative,
    x: predicted.x,
    y: predicted.y,
    vx: predicted.vx,
    vy: predicted.vy,
    angle: predicted.angle,
    aimAngle: predicted.aimAngle,
    mining: predicted.mining,
    thrusting: predicted.thrusting
  };
}

function recordEliminations(snapshot, timeSeconds) {
  if (state.room?.state !== "active" && state.room?.state !== "ended") {
    for (const player of snapshot.players || []) {
      state.playerAliveById.set(player.id, player.alive === true);
    }
    return;
  }

  for (const player of snapshot.players || []) {
    const wasAlive = state.playerAliveById.get(player.id);
    if (wasAlive === true && player.alive === false) {
      state.eliminationNotices.push({
        id: `${player.id}:${player.eliminatedAtTick ?? snapshot.tick}:${timeSeconds}`,
        text: "A PLAYER HAS BEEN ELIMINATED",
        createdAt: timeSeconds,
        expiresAt: timeSeconds + ELIMINATION_NOTICE_SECONDS
      });
      state.eliminationNotices = state.eliminationNotices.slice(-ELIMINATION_NOTICE_MAX);
    }

    state.playerAliveById.set(player.id, player.alive === true);
  }
}

function pruneEliminationNotices(timeSeconds) {
  if (state.eliminationNotices.length === 0) {
    return;
  }

  state.eliminationNotices = state.eliminationNotices.filter((notice) => notice.expiresAt > timeSeconds);
}

function axis(positiveKeyA, positiveKeyB, negativeKeyA, negativeKeyB) {
  const positive = keys.has(positiveKeyA) || keys.has(positiveKeyB);
  const negative = keys.has(negativeKeyA) || keys.has(negativeKeyB);

  if (positive === negative) {
    return 0;
  }

  return positive ? 1 : -1;
}

function getPlayerName() {
  const params = new URLSearchParams(window.location.search);
  const urlName = params.get("name");
  if (urlName) {
    window.localStorage.setItem("bitspace.name", urlName);
    return urlName;
  }

  const storedName = window.localStorage.getItem("bitspace.name");
  if (storedName) {
    return storedName;
  }

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const name = `Pilot ${suffix}`;
  window.localStorage.setItem("bitspace.name", name);
  return name;
}

function getClientId() {
  const stored = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (stored && CLIENT_ID_PATTERN.test(stored)) {
    return stored;
  }

  const generated = randomClientId();
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

function getClientSecret() {
  const stored = window.localStorage.getItem(CLIENT_SECRET_STORAGE_KEY);
  if (stored && CLIENT_SECRET_PATTERN.test(stored)) {
    return stored;
  }

  const generated = randomClientSecret();
  window.localStorage.setItem(CLIENT_SECRET_STORAGE_KEY, generated);
  return generated;
}

function randomClientId() {
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 32);
  }

  return Math.random().toString(36).slice(2, 18) + Date.now().toString(36);
}

function randomClientSecret() {
  const bytes = new Uint8Array(32);
  window.crypto?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function updateMouse(event) {
  const point = eventToFramebufferPoint(event);
  state.mouse.x = point.x;
  state.mouse.y = point.y;
  updateAimFromSnapshot();
}

function handleRoomUiClick(buttonId) {
  if (!buttonId || !socket.connected) {
    return;
  }

  if (buttonId === "ready") {
    socket.emit(CLIENT_EVENTS.ready, { button: true });
    return;
  }

  if (buttonId === "start") {
    socket.emit(CLIENT_EVENTS.start);
    return;
  }

  if (buttonId === "leaveSpectating" || buttonId === "leaveEnded") {
    forgetRegisteredRoom();
    socket.emit(CLIENT_EVENTS.leave);
  }
}

function requestRoomReattach(now = performance.now(), silent = true) {
  const roomId = storedRoomId();
  if (!roomId) {
    return;
  }

  if (state.lastReattachRequestAt > 0 && now - state.lastReattachRequestAt < 900) {
    return;
  }

  state.lastReattachRequestAt = now;
  socket.emit(CLIENT_EVENTS.resume, { roomId, silent });
}

function needsReattachRepair() {
  if (!storedRoomId()) {
    return false;
  }

  if (state.room?.state !== "waiting" && state.room?.state !== "active") {
    return false;
  }

  return !localPlayerFromSnapshot();
}

function storedRoomId() {
  const roomId = window.localStorage.getItem(ROOM_ID_STORAGE_KEY);
  if (roomId && ROOM_ID_PATTERN.test(roomId)) {
    return roomId;
  }

  window.localStorage.removeItem(ROOM_ID_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_REGISTERED_ROOM_STORAGE_KEY);
  return "";
}

function rememberRegisteredRoom(roomId) {
  if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
    return;
  }

  window.localStorage.setItem(ROOM_ID_STORAGE_KEY, roomId);
  window.localStorage.removeItem(LEGACY_REGISTERED_ROOM_STORAGE_KEY);
}

function forgetRegisteredRoom() {
  window.localStorage.removeItem(ROOM_ID_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_REGISTERED_ROOM_STORAGE_KEY);
}

function activeRoomButtons() {
  const room = state.room;
  if (!room || room.state === "menu") {
    return { ready: ROOM_BUTTONS.ready };
  }

  if (room.state === "active" && isLocalPlayerEliminated()) {
    return { leaveSpectating: ROOM_BUTTONS.leaveSpectating };
  }

  if (room.state === "ended") {
    return { leaveEnded: ROOM_BUTTONS.leaveEnded };
  }

  return {};
}

function screenRoomButtonAtPoint(x, y) {
  for (const [buttonId, rect] of Object.entries(activeRoomButtons())) {
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return buttonId;
    }
  }

  return null;
}

function isRoomUiBlocking() {
  const room = state.room;
  if (!room || room.state === "menu" || room.state === "ended") {
    return true;
  }

  if (room.state === "waiting") {
    return false;
  }

  return room.state === "active" && isLocalPlayerEliminated();
}

function isInputBlocked() {
  return isRoomUiBlocking();
}

function isLocalPlayerEliminated() {
  const player = localPlayerFromSnapshot();
  return Boolean(state.snapshot && (!player || !player.alive));
}

function updateUpgradeSelectionFromMouse() {
  const index = upgradeIndexAtPoint(state.mouse.x, state.mouse.y);
  if (index === null) {
    return;
  }

  if (state.upgrades.selectedIndex !== index) {
    state.upgrades.selectedIndex = index;
  }
}

function buySelectedUpgrade() {
  const player = localPlayerFromSnapshot();
  const definition = UPGRADE_DEFINITIONS[state.upgrades.selectedIndex];
  if (!player || !definition) {
    return;
  }

  const cost = nextUpgradeCost(player.upgrades, definition.id);
  if (socket.connected && canAffordUpgrade(player.resources, cost)) {
    socket.emit(CLIENT_EVENTS.upgrade, definition.id);
  }
}

function localPlayerFromSnapshot() {
  return state.snapshot?.players.find((candidate) => candidate.id === state.playerId) || null;
}

function cameraPlayerIdForRoom() {
  const room = state.room;
  const player = localPlayerFromSnapshot();
  if (room?.state === "ended" && room.winnerId) {
    return room.winnerId;
  }

  if (!player || player.alive) {
    return state.playerId;
  }

  if (player.killedById) {
    return player.killedById;
  }

  return state.snapshot?.players.find((candidate) => candidate.alive)?.id || state.playerId;
}

function upgradeIndexAtPoint(x, y) {
  const menuX = UPGRADE_MENU_LAYOUT.x;
  const menuY = UPGRADE_MENU_LAYOUT.y;
  const rowLeft = menuX + UPGRADE_MENU_LAYOUT.rowInset;
  const rowRight = menuX + UPGRADE_MENU_LAYOUT.width - UPGRADE_MENU_LAYOUT.rowInset;
  const rowTop = menuY + UPGRADE_MENU_LAYOUT.rowTopOffset;
  const rowBottom = rowTop + UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight;

  if (x < rowLeft || x > rowRight || y < rowTop - 6 || y >= rowBottom) {
    return null;
  }

  return clamp(
    Math.floor((y - rowTop + 6) / UPGRADE_MENU_LAYOUT.rowHeight),
    0,
    UPGRADE_DEFINITIONS.length - 1
  );
}

function updateAimFromSnapshot() {
  const snapshot = state.snapshot;
  if (!snapshot || !state.playerId) {
    return;
  }

  const player = predictedLocalPlayer() || snapshot.players.find((candidate) => candidate.id === state.playerId);
  if (!player) {
    return;
  }

  const camera = cameraForPlayer(snapshot, player);
  const playerX = player.x - camera.x;
  const playerY = player.y - camera.y;
  const dx = state.mouse.x - playerX;
  const dy = state.mouse.y - playerY;
  if (dx !== 0 || dy !== 0) {
    state.mouse.aimAngle = Math.atan2(dy, dx);
  }
}

function eventToFramebufferPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const x = event.clientX - rect.left - (rect.width - width) / 2;
  const y = event.clientY - rect.top - (rect.height - height) / 2;

  return {
    x: clamp(x / scale, 0, canvas.width),
    y: clamp(y / scale, 0, canvas.height)
  };
}

function cameraForPlayer(snapshot, player) {
  return {
    x: player.x - snapshot.render.width / 2,
    y: player.y - snapshot.render.height / 2
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampMagnitude(x, y, maxMagnitude) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return { x, y };
  }

  const scale = maxMagnitude / magnitude;
  return {
    x: x * scale,
    y: y * scale
  };
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function shouldCaptureKey(code) {
  return [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyT",
    "KeyU",
    "Space"
  ].includes(code);
}
