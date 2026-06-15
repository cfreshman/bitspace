import { ENGINE } from "/shared/constants.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "/shared/protocol.js";
import { normalizeInput } from "/shared/input.js";
import {
  canAffordUpgrade,
  nextUpgradeCost,
  UPGRADE_DEFINITIONS
} from "/shared/upgrades.js";
import { createRenderer } from "/renderer.js";

const TALK_MAX_CHARS = 36;
const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 60,
  width: 330,
  rowTopOffset: 38,
  rowHeight: 24,
  rowInset: 12
});
const canvas = document.querySelector("#scene");
const renderer = createRenderer(canvas);
const talkInput = createTalkInput();
const keys = new Set();
const state = {
  playerId: null,
  snapshot: null,
  asteroid: null,
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
  }
};

const socket = window.io({
  auth: {
    name: getPlayerName()
  }
});

socket.on(SERVER_EVENTS.welcome, (payload) => {
  state.playerId = payload.playerId;
});

socket.on(SERVER_EVENTS.snapshot, (snapshot) => {
  state.snapshot = snapshot;
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

window.addEventListener("keydown", (event) => {
  if (state.chat.active) {
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
  if (state.upgrades.active) {
    updateUpgradeSelectionFromMouse();
  }
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  updateMouse(event);
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

  socket.emit(CLIENT_EVENTS.input, readInput());
}, 1000 / ENGINE.tickRate);

requestAnimationFrame(draw);

function draw(now = 0) {
  updateAimFromSnapshot();
  renderer.draw(state.snapshot, {
    playerId: state.playerId,
    asteroid: state.asteroid,
    chat: state.chat,
    upgrades: state.upgrades,
    aimAngle: state.mouse.aimAngle,
    mining: state.mouse.down && !state.chat.active && !state.upgrades.active,
    timeSeconds: now / 1000
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
  state.chat.active = true;
  state.upgrades.active = false;
  state.mouse.down = false;
  keys.clear();
  talkInput.value = "";
  talkInput.focus({ preventScroll: true });
  syncTalkDraft();
}

function activateUpgrades() {
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

function readInput() {
  state.inputSeq += 1;
  if (state.chat.active || state.upgrades.active) {
    return normalizeInput({
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

function updateMouse(event) {
  const point = eventToFramebufferPoint(event);
  state.mouse.x = point.x;
  state.mouse.y = point.y;
  updateAimFromSnapshot();
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

  const player = snapshot.players.find((candidate) => candidate.id === state.playerId);
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
