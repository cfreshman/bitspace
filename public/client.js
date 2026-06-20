import { ENGINE, RENDER } from "/shared/constants.js";
import { firstTileAlongBuildRay } from "/shared/build.js";
import {
  ASTEROID_TILE,
  blockingTilesAlongSegment,
  STORM_STATE,
  blockingTilesNearCircle,
  circleBlockerOverlap,
  createLobbyAsteroid,
  createNaturalAsteroid,
  createThemeAsteroid,
  isAsteroidRockTile,
  raycastAsteroid,
  sweptCircleBlockerHit
} from "/shared/asteroid.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "/shared/protocol.js";
import { normalizeInput } from "/shared/input.js";
import { createSeededRandom, inheritedVelocityLaunchAngle } from "/shared/math.js";
import {
  addPlayer,
  buildPlayerWall,
  createArena,
  purchasePlayerUpgrade,
  setPlayerInput,
  setPlayerTalk,
  snapshotArena,
  snapshotAsteroid,
  stepArena,
  takeAsteroidUpdates
} from "/shared/arena.js";
import {
  botProfileActive,
  botProfileMeasure,
  botProfileSnapshot,
  createPilotBotBrain,
  resetBotProfile,
  setBotProfileEnabled,
  snapshotPilotBotBrain,
  updatePilotBotBrain,
  updatePilotBotLocalPlanner
} from "/shared/bots.js";
import {
  miningRayClippedSideStartDistance,
  miningRayLaneWithStart,
  miningRaySideStartProbe,
  miningRayLanesForPlayer
} from "/shared/mining.js";
import {
  aggregateUpgradeEffects,
  canAffordUpgrade,
  nextUpgradeCost,
  UPGRADE_DEFINITIONS
} from "/shared/upgrades.js";
import { createGamepadControls } from "/gamepad.js";
import { createRenderer } from "/renderer.js";

const TALK_MAX_CHARS = 36;
const ROOM_NAME_MAX_CHARS = 24;
const CLIENT_ID_STORAGE_KEY = "bitspace.clientId";
const CLIENT_SECRET_STORAGE_KEY = "bitspace.clientSecret";
const ROOM_ID_STORAGE_KEY = "bitspace.roomId";
const ROOM_NAME_STORAGE_KEY = "bitspace.roomName";
const LEGACY_REGISTERED_ROOM_STORAGE_KEY = "bitspace.registeredRoom";
const THEME_STORAGE_KEY = "bitspace.theme";
const LOCAL_BOT_SAVE_STORAGE_KEY = "bitspace.localBotSave";
const BOT_DEBUG_OVERLAY_STORAGE_KEY = "bitspace.debugBotOverlay";
const PLAYER_MAP_STORAGE_KEY = "bitspace.playerMap";
const PLAYER_MAP_STORAGE_VERSION = 2;
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{12,48}$/;
const CLIENT_SECRET_PATTERN = /^[a-zA-Z0-9_-]{24,96}$/;
const ROOM_ID_PATTERN = /^room-\d+$/;
const PREDICTION_SNAP_DISTANCE = 96;
const PREDICTION_POSITION_CORRECTION = 0.08;
const PREDICTION_VELOCITY_CORRECTION = 0.2;
const ENTITY_SNAP_DISTANCE = 56;
const ENTITY_POSITION_CORRECTION = 0.14;
const ENTITY_VELOCITY_CORRECTION = 0.32;
const ENTITY_MAX_EXTRAPOLATION_SECONDS = 0.22;
const ELIMINATION_NOTICE_SECONDS = 4;
const ELIMINATION_NOTICE_MAX = 3;
const WORLD_LENS_EDGE_SCALE = RENDER.lensEdgeScale || 1;
const WORLD_LENS_POWER = RENDER.lensPower || 2;
const ENGINE_AUDIO_MAX_GAIN = 0.032;
const MINING_AUDIO_MAX_GAIN = 0.0055;
const AUDIO_CLUNK_COOLDOWN_SECONDS = 0.16;
const AUDIO_COLLISION_CLUNK_SPEED = 18;
const CONTROLLER_CURSOR_SPEED = 160;
const CONTROLLER_HUCK_TARGET_RAY_MULTIPLIER = 2.5;
const CONTROLLER_UPGRADE_NAV_INITIAL_DELAY_SECONDS = 0.28;
const CONTROLLER_UPGRADE_NAV_REPEAT_SECONDS = 0.11;
const CONTROLLER_DPAD_NAV_THRESHOLD = 0.5;
const HUD_RESOURCE_FLASH_SECONDS = 0.55;
const LEAVE_CONFIRM_SECONDS = 2.2;
const BUILD_REPEAT_SECONDS = 0.08;
const PLAYER_MAP_CHUNK_TILES = 1;
const PLAYER_MAP_CIRCLE_PADDING_TILES = 4;
const PLAYER_MAP_MINIPLAYER_RADIUS = 64;
const PLAYER_MAP_MINIPLAYER_RESOLUTION_SCALE = 2;
const PLAYER_MAP_FULL_STORM_BAND_TILES = 4;
const PLAYER_MAP_UNKNOWN = 255;
const PLAYER_MAP_BACKGROUND = 0;
const PLAYER_MAP_FOREGROUND = 2;
const PLAYER_MAP_STORM = 3;
const MENU_PLAYER_ID = "menu-player";
const LOCAL_BOT_ROOM_ID = "local-bots";
const LOCAL_BOT_PLAYER_ID = "local-player";
const LOCAL_BOT_COUNT = 7;
const LOCAL_BOT_SAVE_VERSION = 2;
const LOCAL_BOT_SAVE_INTERVAL_SECONDS = 1;
const LOCAL_BOT_PLAN_INTERVAL_TICKS = 12;
const BOT_DEBUG_CHUNK_TILES = 16;
const MENU_ROOMS = Object.freeze({
  ready: "ready",
  theme: "theme"
});
const MENU_BUTTON_WIDTH = 112;
const MENU_BUTTON_WIDE_WIDTH = 128;
const MENU_BUTTON_HEIGHT = 32;
const MENU_BUTTON_GAP = 24;
const MENU_ESRB_SUBTITLE = "online interactions not rated by the ESRB";
const MENU_MINING_RAY_MIN_COUNT = 1;
const MENU_MINING_RAY_MAX_COUNT = 3;
const THEME_SWATCH_RADIUS = 15.5;
const THEME_SWATCH_RING_RADIUS = 76;
const THEME_ASTEROID_GAP = 24;
const THEME_RANDOM_ID = "menu-theme-random";
const THEME_BACK_ID = "menu-theme-back";
const THEME_PRESETS = Object.freeze([
  // { id: "blue", label: "BLUE", background: "#1f2433", foreground: "#74cbef" },
  // { id: "blue", label: "BLUE", background: "#1f2433", foreground: "#efcb74" },
  { id: "blue", label: "BLUE", background: "#231f33", foreground: "#74acef" },
  { id: "mono", label: "MONO", background: "#000000", foreground: "#ffffff", backing: "#100810" },
  // { id: "green", label: "GREEN", background: "#27543c", foreground: "#ffbf00" },
  { id: "ember", label: "EMBER", background: "#211c26", foreground: "#ff6f4f" },
  // { id: "tan", label: "TAN", background: "#555452", foreground: "#ffc366" },
  { id: "rose", label: "ROSE", background: "#34222c", foreground: "#ff72b6" },
  // { id: "plum", label: "PLUM", background: "#412c34", foreground: "#d8bd7a" },
  // { id: "ice", label: "ICE", background: "#1f353d", foreground: "#9bf7ff" },
  // { id: "sodium", label: "SODIUM", background: "#202419", foreground: "#ffd84a" },
  { id: "amber", label: "AMBER", background: "#18110d", foreground: "#ffb24a" },
  { id: "matrix", label: "MATRIX", background: "#111111", foreground: "#00ff00" }
]);
const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 72,
  padding: 8,
  rowTopOffset: 20,
  rowHeight: 16,
  rowInset: 8,
  labelOffset: 14,
  columnGap: 8,
  rowHitPadding: 2
});
const TERMINAL_LEAVE_ACTION = Object.freeze({
  x: 10,
  eliminatedY: 41,
  endedPanelY: 8,
  endedRowStartY: 29,
  endedRowStep: 10,
  endedCountdownGap: 4,
  endedBottomPadding: 4,
  endedLeaveGap: 7,
  width: 98,
  height: 13
});
const canvas = document.querySelector("#scene");
const minimapCanvas = document.querySelector("#minimap");
const renderer = createRenderer(canvas, minimapCanvas);
const gamepadControls = createGamepadControls();
const talkInput = createTalkInput();
const themeSource = document.querySelector("#bitspace-theme-source");
const cssDefaultTheme = readThemeSource() || {
  foreground: RENDER.foreground,
  background: RENDER.background
};
const keys = new Set();
const releasedKeysUntilKeyup = new Set();
const storedClientId = getClientId();
const storedClientSecret = getClientSecret();
const inputSessionId = randomClientSecret();
const audio = {
  context: null,
  unlocked: false,
  pendingBeeps: 0,
  ship: null,
  lastHealth: null,
  lastShake: 0,
  lastClunkAtSeconds: 0,
  pendingDamage: 0,
  huckRockBuffer: null
};
const state = {
  clientId: storedClientId,
  playerId: null,
  room: null,
  snapshot: null,
  asteroid: null,
  prediction: {
    player: null,
    lastTimeSeconds: 0,
    huckRockCooldownSeconds: 0,
    huckRocks: [],
    huckRockSeq: 0
  },
  localGame: {
    active: false,
    arena: null,
    bots: new Map(),
    lastStepTimeSeconds: 0,
    accumulatorSeconds: 0,
    inputSeq: 0,
    lastSaveTimeSeconds: 0
  },
  botDebugLog: {
    lastId: "",
    lastAtSeconds: 0
  },
  botDebugOverlay: loadBotDebugOverlay(),
  entitySmoothing: {
    byId: new Map()
  },
  playerMap: {
    roomId: null,
    asteroidSeed: null,
    widthChunks: 0,
    heightChunks: 0,
    large: false,
    circle: null,
    baseCells: null,
    fullMapStormMask: null,
    cells: null,
    dirty: false,
    lastSaveAtMs: 0
  },
  eliminationNotices: [],
  playerAliveById: new Map(),
  spectatorTargetId: null,
  lastRoomId: null,
  lastActiveMatchKey: null,
  inputSeq: 0,
  nextHuckRockThunkAtSeconds: 0,
  hudFlash: {
    rockUntilSeconds: 0
  },
  leaveConfirmUntilSeconds: 0,
  mouse: {
    x: 0,
    y: 0,
    miniX: 0,
    miniY: 0,
    miniInFrame: false,
    inFrame: true,
    hasPointer: false,
    down: false,
    aimAngle: 0
  },
  controller: createControllerState(),
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
  build: {
    active: false,
    nextAttemptSeconds: 0,
    lastTargetKey: ""
  },
  menu: {
    ...createMenuState()
  },
  theme: loadTheme(),
  uiHoverId: null,
  lastReattachRequestAt: 0,
  resumePending: false,
  deferredMenuRoom: null,
  resumeFallbackTimer: null
};

installControlHandles();

const mapGenMode = isMapGenMode();
if (!mapGenMode) {
  restoreLocalBotGame();
}
if (mapGenMode) {
  setupMapGenMode();
}

const socket = mapGenMode
  ? createMapGenSocketStub()
  : window.io({
      auth: {
        name: getPlayerName(),
        clientId: storedClientId,
        clientSecret: storedClientSecret
      }
    });

socket.on(SERVER_EVENTS.welcome, (payload) => {
  state.clientId = payload.clientId;
  if (!isLocalBotGame()) {
    state.playerId = payload.playerId;
  }
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
  emitHeartbeat();
  if (!isLocalBotGame()) {
    if (storedRoomId()) {
      requestRoomReattach(0, true);
    } else {
      requestPathNamedRoomJoin();
    }
  }
});

socket.on("connect", () => {
  emitHeartbeat();
});

socket.on(SERVER_EVENTS.room, handleServerRoom);

function handleServerRoom(room) {
  if (isLocalBotGame()) {
    return;
  }

  if (state.resumePending && room?.state === "menu" && storedRoomId()) {
    state.deferredMenuRoom = room;
    return;
  }

  state.resumePending = false;
  state.deferredMenuRoom = null;
  clearResumeFallbackTimer();
  applyServerRoom(room);
}

function applyServerRoom(room) {
  const previousState = state.room?.state;
  const previousRoomId = state.lastRoomId;
  const nextRoomId = room?.roomId || null;
  if (room?.clientId) {
    state.clientId = room.clientId;
    state.playerId = room.clientId;
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, room.clientId);
  }
  state.room = room;
  state.uiHoverId = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  if (previousRoomId !== nextRoomId) {
    state.lastRoomId = nextRoomId;
    releaseSpaceUntilKeyup();
    state.eliminationNotices = [];
    state.playerAliveById.clear();
    state.spectatorTargetId = null;
  }

  if (!room || room.state === "menu") {
    updateRoomPath("");
    releaseSpaceUntilKeyup();
    state.snapshot = null;
    state.asteroid = null;
    resetPlayerMap();
    state.prediction.player = null;
    state.prediction.huckRockCooldownSeconds = 0;
    clearPredictedHuckRocks();
    resetEntitySmoothing();
    state.eliminationNotices = [];
    state.playerAliveById.clear();
    state.spectatorTargetId = null;
    state.lastActiveMatchKey = null;
    state.upgrades.active = false;
    closeBuildMode();
    state.menu.readySent = false;
    state.menu.activeTargetId = null;
    resetLocalDamageAudioState();
    enterMenuRoom(MENU_ROOMS.ready);
    forgetRegisteredRoom();
    return;
  }

  rememberRegisteredRoom(room.roomId);
  if (room.roomKind === "named" && room.roomName) {
    updateRoomPath(room.roomName);
  } else {
    updateRoomPath("");
  }
  const activeMatchKey = roomActiveMatchKey(room);
  if (activeMatchKey && activeMatchKey !== state.lastActiveMatchKey) {
    resetControlStateForNewMatch();
  }
  state.lastActiveMatchKey = activeMatchKey || (room.state === "ended" ? state.lastActiveMatchKey : null);
  if (!playerMapAllowed()) {
    state.playerMap.large = false;
  }
  if (previousState !== room.state || previousRoomId !== nextRoomId) {
    releaseSpaceUntilKeyup();
    state.upgrades.active = false;
    closeBuildMode();
    resetLocalDamageAudioState();
    resetEntitySmoothing();
    state.prediction.huckRockCooldownSeconds = 0;
    clearPredictedHuckRocks();
    cancelMiningRay();
  }
  if (room?.state === "menu") {
    state.menu.readySent = false;
  }
}

function roomActiveMatchKey(room) {
  if (room?.state !== "active") {
    return null;
  }

  return [
    room.roomId || "",
    room.startedAtMs || "",
    room.seed || ""
  ].join(":");
}

function resetControlStateForNewMatch() {
  closeUpgrades();
  state.upgrades.selectedIndex = null;
  closeBuildMode();
  closeTalk();
  state.playerMap.large = false;
  state.leaveConfirmUntilSeconds = 0;
  state.uiHoverId = null;
  state.hudFlash.rockUntilSeconds = 0;
  state.controller.cursor.visible = false;
  resetControllerCursorPosition();
  resetControllerUpgradeNav();
  cancelMiningRay();
  releaseSpaceUntilKeyup();
}

socket.on(SERVER_EVENTS.snapshot, (snapshot) => {
  if (isLocalBotGame()) {
    return;
  }

  const receivedAtSeconds = performance.now() / 1000;
  snapshot.receivedAtSeconds = receivedAtSeconds;
  recordEntitySnapshot(snapshot, receivedAtSeconds);
  updateLocalDamageAudio(snapshot, receivedAtSeconds);
  recordEliminations(snapshot, receivedAtSeconds);
  state.snapshot = snapshot;
  if (state.asteroid) {
    state.asteroid.tick = snapshot.tick;
  }
  reconcilePrediction(snapshot, receivedAtSeconds);
});

socket.on(SERVER_EVENTS.asteroid, (asteroid) => {
  if (isLocalBotGame()) {
    return;
  }

  setClientAsteroid(asteroid);
});

socket.on(SERVER_EVENTS.asteroidUpdate, (updates) => {
  if (isLocalBotGame()) {
    return;
  }

  applyClientAsteroidUpdates(updates);
});

function setClientAsteroid(asteroid) {
  state.asteroid = {
    ...asteroid,
    tiles: asteroid.tiles.split(""),
    amounts: asteroid.amounts.split(""),
    storm: asteroid.storm ? asteroid.storm.split("") : null,
    stormWarningStarted: asteroid.storm ? new Int32Array(asteroid.tiles.length) : null,
    stormWarningUntil: asteroid.storm ? new Int32Array(asteroid.tiles.length) : null
  };
  applyStormWarnings(state.asteroid, asteroid.stormWarnings || []);
  resetPlayerMap(state.asteroid, state.room?.roomId || state.lastRoomId);
}

function applyClientAsteroidUpdates(updates) {
  if (!state.asteroid) {
    return;
  }

  for (const update of updates) {
    if (update.type === "storm") {
      if (!state.asteroid.storm) {
        state.asteroid.storm = new Array(state.asteroid.tiles.length).fill(String(STORM_STATE.safe));
        state.asteroid.stormWarningStarted = new Int32Array(state.asteroid.tiles.length);
        state.asteroid.stormWarningUntil = new Int32Array(state.asteroid.tiles.length);
      }
      state.asteroid.storm[update.index] = String(update.state);
      if (Number(update.state) === STORM_STATE.warning) {
        state.asteroid.stormWarningStarted[update.index] = update.warningStartedTick || state.asteroid.tick || 0;
        state.asteroid.stormWarningUntil[update.index] = update.warningUntilTick || state.asteroid.tick || 0;
      } else {
        state.asteroid.stormWarningStarted[update.index] = 0;
        state.asteroid.stormWarningUntil[update.index] = 0;
      }
      continue;
    }

    state.asteroid.tiles[update.index] = update.tile;
    state.asteroid.amounts[update.index] = update.amount;
  }
}

function applyStormWarnings(asteroid, warnings) {
  if (!asteroid.storm || !asteroid.stormWarningStarted || !asteroid.stormWarningUntil) {
    return;
  }

  for (const warning of warnings) {
    const index = Number(warning.index);
    if (!Number.isInteger(index) || index < 0 || index >= asteroid.storm.length) {
      continue;
    }

    asteroid.stormWarningStarted[index] = Number(warning.startedTick) || 0;
    asteroid.stormWarningUntil[index] = Number(warning.untilTick) || 0;
  }
}

socket.on(SERVER_EVENTS.beep, () => {
  requestMechanicalBeep();
});

window.addEventListener("keydown", (event) => {
  unlockAudio();
  if (releasedKeysUntilKeyup.has(event.code)) {
    if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
      event.preventDefault();
    }
    return;
  }

  if (state.chat.active) {
    return;
  }

  if (handleMenuRayCountKey(event)) {
    return;
  }

  if (handleWaitingRoomShortcutKey(event)) {
    return;
  }

  if (
    event.code === "Escape" &&
    !event.repeat &&
    canLeaveWithShortcut()
  ) {
    event.preventDefault();
    handleLeaveShortcut();
    return;
  }

  if (
    event.code === "Enter" &&
    !event.repeat &&
    leaveConfirmIsActive()
  ) {
    event.preventDefault();
    confirmLeaveShortcut();
    return;
  }

  if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    keys.add(event.code);
    return;
  }

  if (event.code === "KeyM" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (!event.repeat && playerMapAllowed()) {
      state.playerMap.large = !state.playerMap.large;
    }
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

  if (event.code === "KeyQ" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    activateUpgrades();
    return;
  }

  if (event.code === "KeyE" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    toggleBuildMode();
    return;
  }

  if (shouldCaptureKey(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  if (releasedKeysUntilKeyup.delete(event.code)) {
    if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
      event.preventDefault();
    }
    keys.delete(event.code);
    return;
  }

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
    keys.delete(event.code);
    return;
  }

  if (shouldCaptureKey(event.code)) {
    event.preventDefault();
  }
  keys.delete(event.code);
});

window.addEventListener("blur", () => {
  keys.clear();
  releasedKeysUntilKeyup.clear();
  state.mouse.down = false;
});
window.addEventListener("pagehide", () => {
  saveLocalBotGame({ force: true });
});
window.addEventListener("beforeunload", () => {
  saveLocalBotGame({ force: true });
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

window.addEventListener("pointermove", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  updateMouse(event);
  if (state.mouse.down && !state.build.active && !hasMousePointer()) {
    state.mouse.down = false;
  }
  state.uiHoverId = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  if (state.upgrades.active) {
    updateUpgradeSelectionFromMouse();
  }
});

window.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) {
    clearPagePointerHover();
  }
});

window.addEventListener("pointerdown", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
  unlockAudio();
  updateMouse(event);
  const screenButton = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  if (screenButton) {
    handleRoomUiClick(screenButton);
    return;
  }

  if (state.upgrades.active) {
    updateUpgradeSelectionFromMouse();
    buySelectedUpgrade();
    return;
  }

  if (isReadyMenu()) {
    state.mouse.down = hasMousePointer();
    return;
  }

  if (isRoomUiBlocking()) {
    state.mouse.down = false;
    return;
  }

  if (state.build.active) {
    state.mouse.down = true;
    buildWallAtMouse({ force: true });
    return;
  }

  state.mouse.down = true;
});

window.addEventListener("pointerup", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
  updateMouse(event);
  state.mouse.down = false;
});

window.addEventListener("pointercancel", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
  updateMouse(event);
  state.mouse.down = false;
});

window.addEventListener("contextmenu", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
});

function shouldIgnorePagePointerEvent() {
  return document.body.classList.contains("mapgen-active");
}

function clearPagePointerHover() {
  state.uiHoverId = null;
  state.mouse.hasPointer = false;
  state.mouse.down = false;
  if (state.upgrades.active) {
    state.upgrades.selectedIndex = null;
  }
}

function handleMenuRayCountKey(event) {
  if (
    state.room?.state !== "menu" ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return false;
  }

  const countByCode = {
    Digit1: 1,
    Numpad1: 1,
    Digit2: 2,
    Numpad2: 2,
    Digit3: 3,
    Numpad3: 3
  };
  const count = countByCode[event.code];
  if (!count) {
    return false;
  }

  event.preventDefault();
  state.menu.rayCount = clamp(count, MENU_MINING_RAY_MIN_COUNT, MENU_MINING_RAY_MAX_COUNT);
  if (state.menu.player) {
    state.menu.player.prototypeMiningRayCount = state.menu.rayCount;
  }
  return true;
}

setInterval(() => {
  if (isLocalBotGame()) {
    return;
  }

  if (!socket.connected || !state.playerId) {
    return;
  }

  const now = performance.now();
  if (needsReattachRepair()) {
    requestRoomReattach(now, true);
  }

  socket.emit(CLIENT_EVENTS.input, readInput());
}, 1000 / ENGINE.tickRate);

setInterval(() => {
  emitHeartbeat();
}, ENGINE.heartbeat.intervalSeconds * 1000);

requestAnimationFrame(draw);

function emitHeartbeat() {
  if (!socket.connected || !state.clientId) {
    return;
  }

  socket.emit(CLIENT_EVENTS.heartbeat);
}

function draw(now = 0) {
  const timeSeconds = now / 1000;
  const loadingRoom = isLoadingRoom();
  const readyMenu = isReadyMenu();
  const localBotGame = isLocalBotGame();

  updateControllerState(timeSeconds);
  syncThemeFromCss();
  pruneEliminationNotices(timeSeconds);
  if (loadingRoom) {
    state.mouse.down = false;
  } else if (localBotGame) {
    updateLocalBotGame(timeSeconds);
  } else if (readyMenu) {
    updateMenuSimulation(timeSeconds);
  } else {
    updatePrediction(timeSeconds);
    updateAimFromSnapshot();
  }
  const cameraPlayerId = cameraPlayerIdForRoom();
  logSpectatedBotDebug(cameraPlayerId, timeSeconds);
  const botDebugOverlay = botDebugOverlayRenderState(cameraPlayerId);
  const screenPointer = screenPointerPoint();
  state.uiHoverId = screenRoomButtonAtPoint(screenPointer.x, screenPointer.y);
  const buildTarget = buildTargetFromMouse();
  updateHeldBuild(buildTarget, timeSeconds);
  const snapshot = loadingRoom ? null : readyMenu ? menuSnapshot() : renderSnapshot(timeSeconds);
  const mapAllowed = playerMapAllowed();
  if (!mapAllowed && state.playerMap.large) {
    state.playerMap.large = false;
  }
  const playerMap = mapAllowed ? playerMapRenderState(snapshot, cameraPlayerId) : null;
  const playerMapVisible = mapAllowed && Boolean(playerMap);
  const playerId = readyMenu ? MENU_PLAYER_ID : state.playerId;
  const menuPlayer = readyMenu ? state.menu.player : null;
  const audioPlayer = readyMenu
    ? menuPlayer
    : predictedLocalPlayer() || localPlayerFromSnapshot();
  updateLocalShipAudio(audioPlayer, timeSeconds);
  renderer.draw(snapshot, {
    playerId,
    cameraPlayerId: readyMenu ? MENU_PLAYER_ID : cameraPlayerId,
    asteroid: readyMenu ? state.menu.asteroid : state.asteroid,
    chat: state.chat,
    upgrades: state.upgrades,
    build: {
      active: state.build.active,
      target: buildTarget
    },
    room: state.room,
    clientId: state.clientId,
    roomButtons: activeRoomButtons(),
    uiRayActive: activeRoomMiningInputAllowed(),
    uiTargetId: state.uiHoverId,
    aimAngle: menuPlayer?.aimAngle ?? state.mouse.aimAngle,
    mining: readyMenu
      ? menuPlayer?.mining === true
      : activeRoomMiningInputAllowed(),
    predictedPlayer: readyMenu ? null : predictedLocalPlayer(),
    eliminationNotices: state.eliminationNotices,
    controllerActive: state.controller.connected,
	    controllerCursor: controllerCursorRenderState(),
	    controllerAimCursor: controllerAimCursorRenderState(),
	    hudFlash: hudFlashRenderState(timeSeconds),
	    leaveConfirm: leaveConfirmRenderState(timeSeconds),
	    playerMap: playerMapVisible ? playerMap : null,
	    playerMapLarge: playerMapVisible && state.playerMap.large,
	    playerMapVisible,
	    botChunkMap: botDebugOverlay ? botChunkMapRenderState(cameraPlayerId) : null,
	    botDebugOverlay,
	    theme: state.theme,
	    timeSeconds
	  });
  requestAnimationFrame(draw);
}

function updateControllerState(timeSeconds) {
  const input = gamepadControls.update();
  const previousVisible = state.controller.cursor.visible;
  const previousTime = state.controller.lastTimeSeconds || timeSeconds;
  const dtSeconds = clamp(timeSeconds - previousTime, 0, 1 / 15) || 1 / ENGINE.tickRate;
  state.controller.lastTimeSeconds = timeSeconds;
  state.controller.connected = input.connected;
  state.controller.id = input.id || "";
  state.controller.leftStick = input.leftStick;
  state.controller.dpad = input.dpad;
  state.controller.move = input.move;
  state.controller.menuMove = input.menuMove;
  state.controller.mining = input.buttons.mining;
  state.controller.huckRock = input.buttons.huckRock;
  state.controller.selectPressed = input.pressed.select;
  state.controller.resetPressed = input.pressed.reset;
  state.controller.buildPressed = input.pressed.build;
  state.controller.upgradesPressed = input.pressed.upgrades;
  state.controller.mapPressed = input.pressed.map;

  if (input.aim.active) {
    state.controller.aimActive = true;
    state.controller.aimAngle = Math.atan2(input.aim.y, input.aim.x);
    state.mouse.aimAngle = state.controller.aimAngle;
  } else {
    state.controller.aimActive = false;
  }

  const cursorVisible = controllerCursorShouldShow();
  state.controller.cursor.visible = cursorVisible;
  if (cursorVisible && !previousVisible) {
    resetControllerCursorPosition();
  }
  if (cursorVisible) {
    moveControllerCursor(input.menuMove, dtSeconds);
  }
  updateUpgradeSelectionFromControllerDpad(input.dpad, dtSeconds);

  if (
    input.pressed.select ||
    input.pressed.reset ||
    input.pressed.build ||
    input.pressed.upgrades ||
    input.pressed.map ||
    input.pressed.mining ||
    input.pressed.huckRock
  ) {
    unlockAudio();
  }

  handleControllerActions(input);
}

function handleControllerActions(input) {
  if (!input.connected || state.chat.active) {
    return;
  }

  if (handleWaitingRoomControllerActions(input)) {
    return;
  }

  if (input.pressed.select && leaveConfirmIsActive()) {
    confirmLeaveShortcut();
    return;
  }

  if (input.pressed.reset) {
    if (canLeaveWithControllerReset()) {
      handleLeaveShortcut();
      return;
    }

    if (state.upgrades.active) {
      closeUpgrades();
      return;
    }

    if (state.build.active) {
      closeBuildMode();
      return;
    }

    if (canLeaveWithShortcut()) {
      handleLeaveShortcut();
      return;
    }
  }

  if (input.pressed.upgrades) {
    toggleUpgrades({ controller: true });
  }

  if (input.pressed.map && !state.upgrades.active && playerMapAllowed()) {
    state.playerMap.large = !state.playerMap.large;
  }

  if (input.pressed.build) {
    toggleBuildMode();
  }

  if ((input.pressed.select || input.pressed.mining) && state.build.active) {
    buildWallAtMouse({ force: true });
    return;
  }

  if (input.pressed.select && state.upgrades.active) {
    buySelectedUpgrade();
    return;
  }

  const cursorActivatePressed = input.pressed.select ||
    (state.controller.cursor.visible && input.pressed.mining);
  if (!cursorActivatePressed) {
    return;
  }

  const buttonId = state.controller.cursor.visible
    ? screenRoomButtonAtPoint(state.controller.cursor.x, state.controller.cursor.y)
    : null;
  if (buttonId) {
    handleRoomUiClick(buttonId);
  }
}

function controllerCursorShouldShow() {
  if (!state.controller.connected || state.chat.active || isReadyMenu()) {
    return false;
  }

  if (canLeaveWithControllerReset()) {
    return false;
  }

  return Object.keys(activeRoomButtons()).length > 0;
}

function resetControllerCursorPosition() {
  const button = firstActiveRoomButton();
  if (button) {
    state.controller.cursor.x = button.x + button.width / 2;
    state.controller.cursor.y = button.y + button.height / 2;
    return;
  }

  const frame = framebufferSize();
  state.controller.cursor.x = frame.width / 2;
  state.controller.cursor.y = frame.height / 2;
}

function moveControllerCursor(move, dtSeconds) {
  const frame = framebufferSize();
  state.controller.cursor.x = clamp(
    state.controller.cursor.x + move.x * CONTROLLER_CURSOR_SPEED * dtSeconds,
    0,
    frame.width
  );
  state.controller.cursor.y = clamp(
    state.controller.cursor.y + move.y * CONTROLLER_CURSOR_SPEED * dtSeconds,
    0,
    frame.height
  );
}

function firstActiveRoomButton() {
  const [, rect] = Object.entries(activeRoomButtons())[0] || [];
  return rect || null;
}

function screenPointerPoint() {
  return state.controller.cursor.visible
    ? state.controller.cursor
    : state.mouse;
}

function controllerCursorRenderState() {
  if (!state.controller.cursor.visible) {
    return null;
  }

  return {
    x: state.controller.cursor.x,
    y: state.controller.cursor.y
  };
}

function controllerAimCursorRenderState() {
  if (
    !state.controller.connected ||
    !state.controller.aimActive ||
    physicalMiningInputActive() ||
    state.controller.cursor.visible ||
    state.upgrades.active ||
    state.build.active ||
    state.chat.active
  ) {
    return null;
  }

  const player = isReadyMenu()
    ? state.menu.player
    : predictedLocalPlayer() || localPlayerFromSnapshot();

  return {
    angle: controllerAimAngleForPlayer(player),
    distance: playerMiningRayRange(player)
  };
}

function hudFlashRenderState(timeSeconds) {
  return {
    rock: timeSeconds < state.hudFlash.rockUntilSeconds,
    miningRayDisabled: lobbyMiningRayAttemptActive()
  };
}

function leaveConfirmRenderState(timeSeconds) {
  if (state.leaveConfirmUntilSeconds <= timeSeconds) {
    state.leaveConfirmUntilSeconds = 0;
    return null;
  }

  if (!canLeaveWithShortcut() || state.room?.state !== "active") {
    state.leaveConfirmUntilSeconds = 0;
    return null;
  }

  const remainingSeconds = Math.max(0, state.leaveConfirmUntilSeconds - timeSeconds);
  return {
    active: true,
    expiresAt: state.leaveConfirmUntilSeconds,
    remainingSeconds,
    progress: clamp(remainingSeconds / LEAVE_CONFIRM_SECONDS, 0, 1)
  };
}

function flashRockHud() {
  state.hudFlash.rockUntilSeconds = performance.now() / 1000 + HUD_RESOURCE_FLASH_SECONDS;
}

function lobbyMiningRayAttemptActive() {
  return state.room?.state === "waiting" &&
    !state.chat.active &&
    !state.upgrades.active &&
    !state.build.active &&
    physicalMiningInputActive();
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

function isMapGenMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mapgen") === "1" || window.location.hash === "#mapgen";
}

function createMapGenSocketStub() {
  return {
    auth: {},
    connected: false,
    on() {},
    emit() {}
  };
}

function setupMapGenMode() {
  const panel = document.querySelector("#mapgen-panel");
  const preview = document.querySelector("#mapgen-preview");
  const stats = document.querySelector("#mapgen-stats");
  if (!panel || !preview || !stats) {
    return;
  }

  const controls = {
    seed: document.querySelector("#mapgen-seed"),
    nodes: document.querySelector("#mapgen-nodes"),
    players: document.querySelector("#mapgen-players"),
    links: document.querySelector("#mapgen-links"),
    degree: document.querySelector("#mapgen-degree"),
    radius: document.querySelector("#mapgen-radius"),
    center: document.querySelector("#mapgen-center"),
    curve: document.querySelector("#mapgen-curve"),
    feather: document.querySelector("#mapgen-feather"),
    regenerate: document.querySelector("#mapgen-regenerate"),
    random: document.querySelector("#mapgen-random")
  };
  const params = new URLSearchParams(window.location.search);
  const defaults = {
    seed: params.get("seed") || "bitspace-main:asteroid",
    nodes: 72,
    players: mapGenParamNumber(params, "players", 2),
    links: 4,
    degree: 3,
    radius: 0.95,
    center: 2.7,
    curve: 3.2,
    feather: 0.58
  };

  document.body.classList.add("mapgen-active");
  panel.hidden = false;
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  panel.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  controls.seed.value = defaults.seed;
  controls.nodes.value = defaults.nodes;
  controls.players.value = defaults.players;
  controls.links.value = defaults.links;
  controls.degree.value = defaults.degree;
  controls.radius.value = defaults.radius;
  controls.center.value = defaults.center;
  controls.curve.value = defaults.curve;
  controls.feather.value = defaults.feather;

  let pending = false;
  const requestRender = () => {
    if (pending) {
      return;
    }

    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      renderMapGenPreview(preview, stats, mapGenOptionsFromControls(controls));
    });
  };

  for (const control of [
    controls.seed,
    controls.nodes,
    controls.players,
    controls.links,
    controls.degree,
    controls.radius,
    controls.center,
    controls.curve,
    controls.feather
  ]) {
    control.addEventListener("input", requestRender);
    control.addEventListener("change", requestRender);
  }

  controls.regenerate.addEventListener("click", requestRender);
  controls.random.addEventListener("click", () => {
    controls.seed.value = `map-${Math.random().toString(36).slice(2, 10)}`;
    requestRender();
  });

  renderMapGenPreview(preview, stats, mapGenOptionsFromControls(controls));
}

function mapGenOptionsFromControls(controls) {
  return {
    seed: controls.seed.value.trim() || "bitspace-main:asteroid",
    playerCount: mapGenNumber(controls.players, 2),
    generation: {
      tunnelNodeCount: mapGenNumber(controls.nodes, 72),
      tunnelExtraConnectionCount: mapGenNumber(controls.links, 4),
      tunnelMaxNodeDegree: mapGenNumber(controls.degree, 3),
      tunnelCenterMaxDegree: mapGenNumber(controls.degree, 3),
      tunnelRadius: mapGenNumber(controls.radius, 0.95),
      tunnelCenterRadius: mapGenNumber(controls.center, 2.7),
      tunnelCurveStrength: mapGenNumber(controls.curve, 3.2),
      tunnelFeather: mapGenNumber(controls.feather, 0.58)
    }
  };
}

function mapGenNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function mapGenParamNumber(params, key, fallback) {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function renderMapGenPreview(canvasElement, statsElement, options) {
  const asteroid = createNaturalAsteroid({
    seed: options.seed,
    playerCount: options.playerCount,
    generation: options.generation
  });
  const ctx = canvasElement.getContext("2d", { alpha: false });
  const scale = Math.max(
    1,
    Math.floor(Math.min(canvasElement.width / asteroid.widthTiles, canvasElement.height / asteroid.heightTiles))
  );
  const offsetX = Math.floor((canvasElement.width - asteroid.widthTiles * scale) / 2);
  const offsetY = Math.floor((canvasElement.height - asteroid.heightTiles * scale) / 2);

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);

  for (let tileY = 0; tileY < asteroid.heightTiles; tileY += 1) {
    for (let tileX = 0; tileX < asteroid.widthTiles; tileX += 1) {
      const index = tileY * asteroid.widthTiles + tileX;
      const tile = asteroid.tiles[index];
      const color = mapGenTileColor(tile, asteroid.playable[index]);
      if (!color) {
        continue;
      }

      ctx.fillStyle = color;
      ctx.fillRect(offsetX + tileX * scale, offsetY + tileY * scale, scale, scale);
    }
  }

  drawMapGenPockets(ctx, asteroid, offsetX, offsetY, scale);
  statsElement.textContent = mapGenStats(asteroid, options);
}

function mapGenTileColor(tile, playable) {
  if (tile === ASTEROID_TILE.diamond) {
    return "#ffffff";
  }

  if (tile === ASTEROID_TILE.ore) {
    return "#ffbf00";
  }

  if (tile === ASTEROID_TILE.rock || tile === ASTEROID_TILE.wall) {
    return "#74cbef";
  }

  return playable ? "#111822" : null;
}

function drawMapGenPockets(ctx, asteroid, offsetX, offsetY, scale) {
  ctx.strokeStyle = "#ff4a7a";
  ctx.lineWidth = 1;
  for (const pocket of asteroid.pockets || []) {
    const x = offsetX + pocket.tileX * scale;
    const y = offsetY + pocket.tileY * scale;
    ctx.strokeRect(x - scale, y - scale, scale * 3, scale * 3);
  }
}

function mapGenStats(asteroid, options) {
  const rockComponents = mapGenRockComponents(asteroid);
  const openComponents = mapGenOpenComponents(asteroid);
  const oreComponents = mapGenOreComponents(asteroid);
  const totals = mapGenResourceTotals(asteroid);
  const rockTiles = asteroid.tiles.filter(mapGenIsRockTile).length;
  const tinyRockComponents = rockComponents.filter((size) => size <= 2).length;

  return [
    `seed: ${options.seed}`,
    `players: ${options.playerCount}`,
    `tiles: ${asteroid.widthTiles} x ${asteroid.heightTiles}`,
    `rock: ${rockTiles} (${((rockTiles / asteroid.tiles.length) * 100).toFixed(1)}%)`,
    `rock components: ${rockComponents.length} largest ${rockComponents.slice(0, 6).join(", ")}`,
    `1-2 tile rock components: ${tinyRockComponents}`,
    `open components: ${openComponents.length} largest ${openComponents.slice(0, 6).join(", ")}`,
    `resources: ROCK ${totals.rock} ORE ${totals.ore} DIAMOND ${totals.diamond}`,
    `ore tiles: 1x ${totals.ore1} 2x ${totals.ore2} 3x ${totals.ore3}`,
    `ore components: ${oreComponents.length} largest ${oreComponents.slice(0, 8).join(", ")}`,
    `pockets: ${asteroid.pockets.length}`,
    `generation: ${JSON.stringify(options.generation)}`
  ].join("\n");
}

function mapGenResourceTotals(asteroid) {
  const totals = {
    rock: 0,
    ore: 0,
    diamond: 0,
    ore1: 0,
    ore2: 0,
    ore3: 0
  };

  for (let index = 0; index < asteroid.tiles.length; index += 1) {
    const tile = asteroid.tiles[index];
    if (tile === ASTEROID_TILE.ore) {
      const amount = Number(asteroid.amounts[index]) || 0;
      totals.ore += amount;
      if (amount === 1) {
        totals.ore1 += 1;
      } else if (amount === 2) {
        totals.ore2 += 1;
      } else if (amount >= 3) {
        totals.ore3 += 1;
      }
    } else if (tile === ASTEROID_TILE.diamond) {
      totals.diamond += Number(asteroid.amounts[index]) || 0;
    } else if (tile === ASTEROID_TILE.rock) {
      totals.rock += 1;
    }
  }

  return totals;
}

function mapGenRockComponents(asteroid) {
  return mapGenComponents(asteroid, (index) => mapGenIsRockTile(asteroid.tiles[index]));
}

function mapGenOpenComponents(asteroid) {
  return mapGenComponents(
    asteroid,
    (index) => asteroid.playable[index] && !mapGenIsRockTile(asteroid.tiles[index])
  );
}

function mapGenOreComponents(asteroid) {
  return mapGenComponents(asteroid, (index) => asteroid.tiles[index] === ASTEROID_TILE.ore);
}

function mapGenComponents(asteroid, passable) {
  const visited = new Set();
  const components = [];

  for (let index = 0; index < asteroid.tiles.length; index += 1) {
    if (visited.has(index) || !passable(index)) {
      continue;
    }

    const queue = [index];
    let size = 0;
    visited.add(index);

    while (queue.length > 0) {
      const current = queue.shift();
      size += 1;
      for (const neighbor of mapGenNeighborIndexes(current, asteroid.widthTiles, asteroid.heightTiles)) {
        if (visited.has(neighbor) || !passable(neighbor)) {
          continue;
        }

        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    components.push(size);
  }

  return components.sort((a, b) => b - a);
}

function mapGenNeighborIndexes(index, widthTiles, heightTiles) {
  const x = index % widthTiles;
  const y = Math.floor(index / widthTiles);
  const neighbors = [];
  if (x > 0) {
    neighbors.push(index - 1);
  }
  if (x < widthTiles - 1) {
    neighbors.push(index + 1);
  }
  if (y > 0) {
    neighbors.push(index - widthTiles);
  }
  if (y < heightTiles - 1) {
    neighbors.push(index + widthTiles);
  }
  return neighbors;
}

function mapGenIsRockTile(tile) {
  return tile === ASTEROID_TILE.rock ||
    tile === ASTEROID_TILE.ore ||
    tile === ASTEROID_TILE.diamond ||
    tile === ASTEROID_TILE.wall;
}

function createControllerState() {
  const frame = framebufferSize();
  return {
    connected: false,
    id: "",
    leftStick: { x: 0, y: 0 },
    dpad: { x: 0, y: 0 },
    move: { x: 0, y: 0 },
    menuMove: { x: 0, y: 0 },
    aimActive: false,
    aimAngle: Math.PI / 2,
    mining: false,
    huckRock: false,
    selectPressed: false,
    resetPressed: false,
    buildPressed: false,
    upgradesPressed: false,
    mapPressed: false,
    lastTimeSeconds: 0,
    upgradeNavDirection: 0,
    upgradeNavRepeatSeconds: 0,
    cursor: {
      x: frame.width / 2,
      y: frame.height / 2,
      visible: false
    }
  };
}

function createMenuState() {
  const asteroids = {
    [MENU_ROOMS.ready]: createLobbyAsteroid({ seed: "bitspace-menu" }),
    [MENU_ROOMS.theme]: createThemeMenuAsteroid()
  };
  const asteroid = asteroids[MENU_ROOMS.ready];

  return {
    room: MENU_ROOMS.ready,
    tick: 0,
    lastTimeSeconds: 0,
    readySent: false,
    activeTargetId: null,
    buttonTargetId: null,
    buttonTargetSeconds: 0,
    buttonTargetActivated: false,
    roomNameDraft: initialRoomNameDraft(),
    asteroids,
    asteroid,
    huckRocks: [],
    huckRockCooldownSeconds: 0,
    rayCount: 1,
    player: createMenuPlayer(asteroid)
  };
}

function createThemeMenuAsteroid() {
  const clearRadius = THEME_SWATCH_RING_RADIUS + THEME_SWATCH_RADIUS + THEME_ASTEROID_GAP;

  return createThemeAsteroid({
    seed: "bitspace-menu-theme",
    clearRadius
  });
}

function createMenuPlayer(asteroid) {
  const maxHealth = ENGINE.player.startingHealthBars * ENGINE.player.healthPerBar;
  const center = menuCenter(asteroid);
  return {
    id: MENU_PLAYER_ID,
    number: 1,
    name: "READY",
    talk: "",
    x: center.x,
    y: center.y,
    vx: 0,
    vy: 0,
    angle: Math.PI / 4,
    facingMoveX: 0,
    facingMoveY: 0,
    pendingFacingSignX: 0,
    pendingFacingSignY: 0,
    pendingFacingSeconds: 0,
    aimAngle: Math.PI / 2,
    mining: false,
    miningRay: null,
    miningHoldSeconds: 0,
    rayExtension: 0,
    prototypeMiningRayCount: 1,
    huckRockEngineCutoutSeconds: 0,
    thrusting: false,
    shake: 0,
    radius: ENGINE.ship.radius,
    upgrades: {},
    healthBars: ENGINE.player.startingHealthBars,
    health: maxHealth,
    maxHealth,
    kills: 0,
    lastKillDropAmount: 0,
    lastKillDropTick: Number.NEGATIVE_INFINITY,
    resources: {
      rock: 0,
      ore: 0,
      diamond: 0
    },
    alive: true
  };
}

function cancelMiningRay() {
  state.mouse.down = false;
  state.menu.activeTargetId = null;
  resetMenuButtonTarget();

  if (state.menu.player) {
    state.menu.player.mining = false;
    state.menu.player.miningRay = null;
    state.menu.player.miningHoldSeconds = 0;
    state.menu.player.rayExtension = 0;
  }

  if (state.prediction.player) {
    state.prediction.player.mining = false;
    state.prediction.player.miningRay = null;
    state.prediction.player.miningHoldSeconds = 0;
    state.prediction.player.rayExtension = 0;
  }

  const player = localPlayerFromSnapshot();
  if (player) {
    player.mining = false;
    player.miningRay = null;
    player.rayExtension = 0;
  }
}

function enterMenuRoom(room) {
  if (!Object.values(MENU_ROOMS).includes(room)) {
    return;
  }

  cancelMiningRay();
  releaseSpaceUntilKeyup();

  const player = state.menu.player;
  state.menu.room = room;
  state.menu.asteroid = state.menu.asteroids[room];
  state.menu.huckRocks = [];
  state.menu.huckRockCooldownSeconds = 0;
  const center = menuCenter(state.menu.asteroid);
  state.menu.activeTargetId = null;
  resetMenuButtonTarget();
  player.x = center.x;
  player.y = center.y;
  player.vx = 0;
  player.vy = 0;
  player.angle = Math.PI / 4;
  player.facingMoveX = 0;
  player.facingMoveY = 0;
  clearPendingFacing(player);
  player.aimAngle = Math.PI / 2;
  player.mining = false;
  player.miningRay = null;
  player.miningHoldSeconds = 0;
  player.rayExtension = 0;
  player.prototypeMiningRayCount = state.menu.rayCount;
  player.huckRockEngineCutoutSeconds = 0;
  player.thrusting = false;
}

function updateMenuSimulation(timeSeconds) {
  const player = state.menu.player;
  const previousTime = state.menu.lastTimeSeconds || timeSeconds;
  const dtSeconds = clamp(timeSeconds - previousTime, 0, 1 / 15) || 1 / ENGINE.tickRate;
  state.menu.lastTimeSeconds = timeSeconds;
  state.menu.tick += 1;
  player.shake = Math.max(0, (player.shake || 0) - ENGINE.collision.shakeDecay * dtSeconds);
  player.huckRockEngineCutoutSeconds = 0;
  applyShipFriction(player, dtSeconds);

  updateMenuAim(player);
  player.prototypeMiningRayCount = state.menu.rayCount;

  const move = state.chat.active ? { x: 0, y: 0 } : readMoveVector();
  const effects = aggregateUpgradeEffects(player.upgrades);
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  const canThrust = hasMoveIntent;

  updateShipFacing(player, move, dtSeconds);

  if (canThrust) {
    applyThrusterAcceleration(player, move, effects, dtSeconds);
  }

  player.thrusting = canThrust;
  player.mining = physicalMiningInputActive() && !state.chat.active;
  if (player.mining) {
    player.miningHoldSeconds += dtSeconds;
  } else {
    player.miningHoldSeconds = 0;
  }
  player.rayExtension = miningRayExtension(player.mining, player.miningHoldSeconds);

  player.x += player.vx * dtSeconds;
  player.y += player.vy * dtSeconds;
  resolveMenuAsteroidCollisions(player);

  updateMenuMiningRay(player, dtSeconds);
  updateMenuHuckRocks(player, dtSeconds);
}

function updateMenuAim(player) {
  if (state.controller.connected) {
    player.aimAngle = controllerAimAngleForPlayer(player);
    state.mouse.aimAngle = player.aimAngle;
    return;
  }

  if (!hasMousePointer()) {
    return;
  }

  const frame = framebufferSize();
  const dx = state.mouse.x - frame.width / 2;
  const dy = state.mouse.y - frame.height / 2;
  if (dx !== 0 || dy !== 0) {
    player.aimAngle = Math.atan2(dy, dx);
    state.mouse.aimAngle = player.aimAngle;
  }
}

function updateMenuMiningRay(player, dtSeconds) {
  if (!player.mining) {
    player.miningRay = null;
    player.miningHoldSeconds = 0;
    player.rayExtension = 0;
    state.menu.activeTargetId = null;
    resetMenuButtonTarget();
    return;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const fullRayLength = ENGINE.mining.rayLength + effects.rayLengthBonus;
  const angle = player.aimAngle ?? player.angle;
  const lanes = miningRayLanesForPlayer(player, angle, fullRayLength).map((baseLane) => {
    baseLane = clipMenuMiningRayLaneStart(player, baseLane, angle);
    const start = {
      x: baseLane.startX,
      y: baseLane.startY
    };
    const direction = {
      x: baseLane.rayDirectionX,
      y: baseLane.rayDirectionY
    };
    const activeDistance = baseLane.rayDistance * player.rayExtension;
    const asteroidHit = raycastAsteroid(state.menu.asteroid, start.x, start.y, baseLane.rayAngle, activeDistance);
    const entityHit = raycastMenuEntities(start, direction, Math.min(asteroidHit.distance, activeDistance));
    const fullAsteroidHit = raycastAsteroid(state.menu.asteroid, start.x, start.y, baseLane.rayAngle, baseLane.rayDistance);
    const fullEntityHit = raycastMenuEntities(start, direction, Math.min(fullAsteroidHit.distance, baseLane.rayDistance));
    return menuMiningRayLaneState(baseLane, entityHit, asteroidHit, fullEntityHit || fullAsteroidHit);
  });
  const entityLane = lanes.find((lane) => lane._entityHit);
  const entityHit = entityLane?._entityHit ?? null;
  player.miningRay = menuMiningRayStateFromLanes(lanes, player.rayExtension);
  stripMenuMiningLaneHits(player.miningRay);

  if (!entityHit) {
    state.menu.activeTargetId = null;
    resetMenuButtonTarget();
    return;
  }

  state.menu.activeTargetId = entityHit.target.id;
  if (state.menu.buttonTargetId !== entityHit.target.id) {
    state.menu.buttonTargetId = entityHit.target.id;
    state.menu.buttonTargetSeconds = 0;
    state.menu.buttonTargetActivated = false;
  }

  state.menu.buttonTargetSeconds += dtSeconds;
  if (
    state.menu.buttonTargetActivated ||
    state.menu.buttonTargetSeconds < ENGINE.mining.buttonSeconds
  ) {
    return;
  }

  state.menu.buttonTargetActivated = true;
  activateMenuEntity(entityHit.target);
}

function clipMenuMiningRayLaneStart(player, lane, angle) {
  const probe = miningRaySideStartProbe(player, lane, angle);
  if (!probe || !state.menu.asteroid) {
    return lane;
  }

  const hit = raycastAsteroid(state.menu.asteroid, probe.startX, probe.startY, probe.angle, probe.distance);
  if (!hit.hit) {
    return lane;
  }

  const distance = miningRayClippedSideStartDistance(probe, hit.distance);
  return miningRayLaneWithStart(
    lane,
    probe.startX + probe.directionX * distance,
    probe.startY + probe.directionY * distance
  );
}

function menuMiningRayLaneState(baseLane, entityHit, asteroidHit, fullHit) {
  const hit = entityHit || asteroidHit;
  return {
    laneIndex: baseLane.index,
    offset: baseLane.offset,
    endOffset: baseLane.endOffset,
    power: baseLane.power,
    rayAngle: baseLane.rayAngle,
    rayDistance: baseLane.rayDistance,
    rayDirectionX: baseLane.rayDirectionX,
    rayDirectionY: baseLane.rayDirectionY,
    startX: baseLane.startX,
    startY: baseLane.startY,
    endX: hit.x,
    endY: hit.y,
    fullEndX: fullHit.x,
    fullEndY: fullHit.y,
    hit: hit.hit,
    hitType: entityHit ? "entity" : asteroidHit.hit ? "asteroid" : null,
    mineable: false,
    tileX: entityHit ? null : asteroidHit.tileX,
    tileY: entityHit ? null : asteroidHit.tileY,
    index: entityHit ? null : asteroidHit.index,
    tile: entityHit ? null : asteroidHit.tile,
    targetId: entityHit?.target.id ?? null,
    targetNumber: null,
    targetAction: entityHit?.target.action ?? null,
    progress: 0,
    _entityHit: entityHit
  };
}

function menuMiningRayStateFromLanes(lanes, extension) {
  const primaryLane = lanes.find((lane) => lane.hit) || lanes[0] || null;
  if (!primaryLane) {
    return null;
  }

  return {
    ...primaryLane,
    extension,
    lanes
  };
}

function stripMenuMiningLaneHits(miningRay) {
  if (!miningRay) {
    return;
  }

  delete miningRay._entityHit;
  for (const lane of miningRay.lanes || []) {
    delete lane._entityHit;
  }
}

function updateMenuHuckRocks(player, dtSeconds) {
  state.menu.huckRockCooldownSeconds = Math.max(0, state.menu.huckRockCooldownSeconds - dtSeconds);

  const movedRocks = [];
  const roomAtStart = state.menu.room;
  for (const rock of state.menu.huckRocks) {
    if (rock.destroyed) {
      continue;
    }

    rock.ageSeconds = (rock.ageSeconds || 0) + dtSeconds;
    if (rock.ageSeconds > (rock.lifetimeSeconds || ENGINE.huckRock.lifetimeSeconds)) {
      continue;
    }

    const previousX = rock.x;
    const previousY = rock.y;
    rock.previousX = previousX;
    rock.previousY = previousY;
    rock.x += rock.vx * dtSeconds;
    rock.y += rock.vy * dtSeconds;
    rock.angleX = normalizeAngle((rock.angleX || 0) + (rock.spinX || 0) * dtSeconds);
    rock.angleY = normalizeAngle((rock.angleY || 0) + (rock.spinY || 0) * dtSeconds);
    rock.angleZ = normalizeAngle((rock.angleZ || 0) + (rock.spinZ || 0) * dtSeconds);
    movedRocks.push(rock);
  }

  const spawnedFragments = [];
  resolveMenuHuckRockContacts(movedRocks, spawnedFragments);

  const rocks = [];
  let activatedEntityThisFrame = false;
  for (const rock of movedRocks) {
    if (rock.destroyed) {
      continue;
    }

    if (rock.fragment) {
      if (menuHuckRockFragmentAsteroidHit(rock, rock.previousX, rock.previousY)) {
        continue;
      }
      rocks.push(rock);
      continue;
    }

    if (menuHuckRockEntityHit(rock, rock.previousX, rock.previousY, spawnedFragments)) {
      activatedEntityThisFrame = true;
      state.menu.huckRockCooldownSeconds = ENGINE.huckRock.fireIntervalSeconds;
      if (state.menu.room !== roomAtStart) {
        return;
      }
      continue;
    }

    if (menuHuckRockPlayerHit(player, rock, rock.previousX, rock.previousY, spawnedFragments)) {
      continue;
    }

    if (resolveMenuHuckRockAsteroidCollisions(rock, rock.previousX, rock.previousY, spawnedFragments)) {
      continue;
    }

    rocks.push(rock);
  }

  state.menu.huckRocks = rocks.concat(spawnedFragments);

  if (
    !activatedEntityThisFrame &&
    !state.chat.active &&
    (keys.has("Space") || state.controller.huckRock) &&
    state.menu.huckRockCooldownSeconds <= 0
  ) {
    spawnMenuHuckRock(player);
    requestHuckRockThunk();
    state.menu.huckRockCooldownSeconds = ENGINE.huckRock.fireIntervalSeconds;
  }
}

function resolveMenuHuckRockContacts(rocks, spawnedFragments) {
  for (let index = 0; index < rocks.length; index += 1) {
    const a = rocks[index];
    if (a.destroyed || a.fragment) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < rocks.length; otherIndex += 1) {
      const b = rocks[otherIndex];
      if (b.destroyed || b.fragment || !huckRocksOverlap(a, b)) {
        continue;
      }

      bounceHuckRocks(a, b, spawnedFragments);
      if (a.destroyed) {
        break;
      }
    }
  }
}

function huckRocksOverlap(a, b) {
  const radius = (a.radius || ENGINE.huckRock.radius) + (b.radius || ENGINE.huckRock.radius);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy < radius * radius;
}

function bounceHuckRocks(a, b, spawnedFragments) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const normal = distance > 0
    ? { x: dx / distance, y: dy / distance }
    : deterministicContactNormal(a.id, b.id);
  const minDistance = (a.radius || ENGINE.huckRock.radius) + (b.radius || ENGINE.huckRock.radius);
  const overlap = Math.max(0, minDistance - distance);

  if (overlap > 0) {
    a.x -= normal.x * overlap * 0.5;
    a.y -= normal.y * overlap * 0.5;
    b.x += normal.x * overlap * 0.5;
    b.y += normal.y * overlap * 0.5;
  }

  const relativeSpeed = (b.vx - a.vx) * normal.x + (b.vy - a.vy) * normal.y;
  if (relativeSpeed < 0) {
    const impulse = (-(1 + ENGINE.huckRock.restitution) * relativeSpeed) / 2;
    a.vx -= normal.x * impulse;
    a.vy -= normal.y * impulse;
    b.vx += normal.x * impulse;
    b.vy += normal.y * impulse;
  }

  consumeHuckRockBounce(a, spawnedFragments, "rock");
  consumeHuckRockBounce(b, spawnedFragments, "rock");
}

function consumeHuckRockBounce(rock, spawnedFragments, reason) {
  if ((rock.bounceCount || 0) >= 1) {
    breakMenuHuckRock(rock, null, spawnedFragments, reason);
    return;
  }

  rock.bounceCount = 1;
}

function breakMenuHuckRock(rock, hit, spawnedFragments, reason = "break") {
  if (hit && !hit.destroy) {
    bounceMenuHuckRock(rock, hit);
  }

  if (!rock.fragment && !rock.fragmentsSpawned) {
    rock.fragmentsSpawned = true;
    spawnMenuHuckRockFragments(rock, spawnedFragments, reason);
  }
  rock.destroyed = true;
}

function spawnMenuHuckRockFragments(rock, spawnedFragments, reason) {
  const config = ENGINE.huckRock.fragments;
  const count = config.minCount + Math.floor(Math.random() * (config.maxCount - config.minCount + 1));
  const speed = Math.hypot(rock.vx || 0, rock.vy || 0);
  const baseAngle = speed > 0.001
    ? Math.atan2(rock.vy, rock.vx)
    : Number(rock.angleZ) || 0;
  const fragments = [];

  for (let index = 0; index < count; index += 1) {
    const scale = config.minRadiusScale + Math.random() * (config.maxRadiusScale - config.minRadiusScale);
    const radius = Math.max(1.25, (rock.radius || ENGINE.huckRock.radius) * scale);
    const angle = baseAngle + (Math.random() * 2 - 1) * config.spreadRadians;
    const fragmentSpeed = Math.max(
      18,
      speed * (config.minSpeedScale + Math.random() * (config.maxSpeedScale - config.minSpeedScale))
    );
    const sideAngle = baseAngle + Math.PI / 2;
    const sideJitter = (Math.random() * 2 - 1) * config.spawnJitter;
    const outwardJitter = Math.random() * config.spawnJitter;
    const id = `${rock.id}:fragment:${state.menu.tick}:${index}:${Math.random().toString(36).slice(2)}`;
    const fragment = {
      id,
      type: "huckRock",
      fragment: true,
      ownerId: rock.ownerId,
      shapeSeed: `${rock.shapeSeed || rock.id}:fragment:${index}:${reason}`,
      x: rock.x +
        Math.cos(baseAngle) * outwardJitter +
        Math.cos(sideAngle) * sideJitter,
      y: rock.y +
        Math.sin(baseAngle) * outwardJitter +
        Math.sin(sideAngle) * sideJitter,
      vx: Math.cos(angle) * fragmentSpeed,
      vy: Math.sin(angle) * fragmentSpeed,
      radius,
      angleX: Math.random() * Math.PI * 2,
      angleY: Math.random() * Math.PI * 2,
      angleZ: Math.random() * Math.PI * 2,
      spinX: (Math.random() - 0.5) * 5.5,
      spinY: (Math.random() - 0.5) * 5.5,
      spinZ: (Math.random() - 0.5) * 3.2,
      bounceCount: 2,
      ageSeconds: 0,
      lifetimeSeconds: config.minLifetimeSeconds +
        Math.random() * (config.maxLifetimeSeconds - config.minLifetimeSeconds),
      bornTick: state.menu.tick
    };

    if (!menuHuckRockFragmentAsteroidHit(fragment, fragment.x, fragment.y)) {
      fragments.push(fragment);
    }
  }

  preserveMenuHuckRockFragmentMomentum(fragments, rock.vx || 0, rock.vy || 0);
  spawnedFragments.push(...fragments);
}

function preserveMenuHuckRockFragmentMomentum(fragments, targetVx, targetVy) {
  const totalMass = fragments.reduce((sum, fragment) => sum + menuHuckRockFragmentMass(fragment), 0);
  if (totalMass <= 0) {
    return;
  }

  let currentVx = 0;
  let currentVy = 0;
  for (const fragment of fragments) {
    const mass = menuHuckRockFragmentMass(fragment);
    currentVx += fragment.vx * mass;
    currentVy += fragment.vy * mass;
  }

  currentVx /= totalMass;
  currentVy /= totalMass;
  const correctionX = targetVx - currentVx;
  const correctionY = targetVy - currentVy;
  for (const fragment of fragments) {
    fragment.vx += correctionX;
    fragment.vy += correctionY;
  }
}

function menuHuckRockFragmentMass(fragment) {
  const radius = Math.max(0.1, fragment.radius || ENGINE.huckRock.radius);
  return radius * radius;
}

function deterministicContactNormal(a, b) {
  const seed = `${a}:${b}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 4294967296) * Math.PI * 2;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function spawnMenuHuckRock(player) {
  const target = huckRockTargetForPlayer(player);
  const angle = huckRockLaunchAngleForPlayer(player, target?.x, target?.y);
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const config = ENGINE.huckRock;
  const id = `menu-huck-rock:${state.menu.tick}:${Math.random().toString(36).slice(2)}`;

  state.menu.huckRocks.push({
    id,
    type: "huckRock",
    ownerId: MENU_PLAYER_ID,
    shapeSeed: `${id}:shape`,
    x: player.x + direction.x * config.spawnOffset,
    y: player.y + direction.y * config.spawnOffset,
    vx: player.vx + direction.x * config.speed,
    vy: player.vy + direction.y * config.speed,
    radius: config.radius,
    angleX: Math.random() * Math.PI * 2,
    angleY: Math.random() * Math.PI * 2,
    angleZ: Math.random() * Math.PI * 2,
    spinX: (Math.random() - 0.5) * 2.2,
    spinY: (Math.random() - 0.5) * 2.2,
    spinZ: (Math.random() - 0.5) * 1.2,
    bounceCount: 0,
    ageSeconds: 0,
    bornTick: state.menu.tick
  });
  applyHuckRockRecoil(player, direction);
  player.huckRockEngineCutoutSeconds = 0;

  while (state.menu.huckRocks.length > ENGINE.huckRock.maxLobbyRocks) {
    state.menu.huckRocks.shift();
  }
}

function menuHuckRockEntityHit(rock, previousX = rock.x, previousY = rock.y, spawnedFragments = []) {
  let nearest = null;

  for (const entity of menuEntities()) {
    if (!entity.action) {
      continue;
    }

    const hit = entity.type === "themeSwatch"
      ? sweptCircleCircleHit(previousX, previousY, rock.x, rock.y, rock.radius, entity) || circleCircleOverlap(rock, entity)
      : sweptCircleRectHit(previousX, previousY, rock.x, rock.y, rock.radius, entity) || circleRectOverlap(rock, entity);
    if (!hit) {
      continue;
    }

    const time = Number.isFinite(hit.time) ? hit.time : 1;
    if (!nearest || time < nearest.time) {
      nearest = {
        entity,
        hit,
        time
      };
    }
  }

  if (nearest) {
    breakMenuHuckRock(rock, nearest.hit, spawnedFragments, "button");
    state.menu.huckRocks = state.menu.huckRocks.filter((candidate) => candidate.id !== rock.id);
    state.menu.activeTargetId = nearest.entity.id;
    activateMenuEntity(nearest.entity);
    state.menu.huckRockCooldownSeconds = ENGINE.huckRock.fireIntervalSeconds;
    return true;
  }

  return false;
}

function menuHuckRockPlayerHit(player, rock, previousX = rock.x, previousY = rock.y, spawnedFragments = []) {
  if (rock.ownerId === MENU_PLAYER_ID && (rock.ageSeconds || 0) < 0.15 && (rock.bounceCount || 0) === 0) {
    return false;
  }

  const hit = sweptCircleCircleHit(previousX, previousY, rock.x, rock.y, rock.radius, player) ||
    circleCircleOverlap(rock, player);
  if (!hit) {
    return false;
  }

  const relativeSpeed = Math.hypot(rock.vx - player.vx, rock.vy - player.vy);
  applyMenuHuckRockPlayerImpulse(rock, player, hit);
  player.shake = clamp(
    (player.shake || 0) + Math.max(0, relativeSpeed - ENGINE.collision.shakeThreshold) * ENGINE.collision.shakeScale,
    0,
    ENGINE.collision.maxShake
  );
  requestCollisionClunk(relativeSpeed);
  breakMenuHuckRock(rock, null, spawnedFragments, "player");
  return true;
}

function applyMenuHuckRockPlayerImpulse(rock, player, hit) {
  const normalX = Number.isFinite(hit.normalX) ? hit.normalX : 0;
  const normalY = Number.isFinite(hit.normalY) ? hit.normalY : 0;
  if (normalX === 0 && normalY === 0) {
    return;
  }

  if (Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
    rock.x = hit.x + normalX * 0.01;
    rock.y = hit.y + normalY * 0.01;
  } else if (Number.isFinite(hit.overlap) && hit.overlap > 0) {
    rock.x += normalX * hit.overlap;
    rock.y += normalY * hit.overlap;
  }

  const relativeNormalSpeed = (rock.vx - player.vx) * normalX + (rock.vy - player.vy) * normalY;
  if (relativeNormalSpeed >= 0) {
    return;
  }

  const rockMass = menuHuckRockBodyMass(rock);
  const playerMass = menuPlayerBodyMass(player);
  const impulse = (-(1 + ENGINE.huckRock.restitution) * relativeNormalSpeed) /
    ((1 / rockMass) + (1 / playerMass));

  rock.vx += (impulse / rockMass) * normalX;
  rock.vy += (impulse / rockMass) * normalY;
  player.vx -= (impulse / playerMass) * normalX;
  player.vy -= (impulse / playerMass) * normalY;
}

function menuHuckRockBodyMass(rock) {
  const radius = Math.max(0.1, rock.radius || ENGINE.huckRock.radius);
  return radius * radius;
}

function menuPlayerBodyMass(player) {
  const radius = Math.max(0.1, player.radius || ENGINE.ship.radius);
  return radius * radius * (ENGINE.huckRock.shipMassScale || 1);
}

function resolveMenuHuckRockAsteroidCollisions(rock, previousX = rock.x, previousY = rock.y, spawnedFragments = []) {
  const hit = nearestMenuHuckRockAsteroidHit(rock, previousX, previousY);
  if (!hit) {
    return false;
  }

  if (hit.destroy) {
    rock.destroyed = true;
    return true;
  }

  if (bounceMenuHuckRock(rock, hit)) {
    if ((rock.bounceCount || 0) >= 1) {
      breakMenuHuckRock(rock, null, spawnedFragments, "wall");
      return true;
    }
    rock.bounceCount = 1;
  }

  return false;
}

function menuHuckRockFragmentAsteroidHit(rock, previousX = rock.x, previousY = rock.y) {
  return Boolean(nearestMenuHuckRockAsteroidHit(rock, previousX, previousY));
}

function nearestMenuHuckRockAsteroidHit(rock, previousX, previousY) {
  const options = { blockNonPlayable: true };
  const blockers = blockingTilesAlongSegment(
    state.menu.asteroid,
    previousX,
    previousY,
    rock.x,
    rock.y,
    rock.radius,
    options
  );
  const seen = new Set();
  let nearest = null;
  let buried = false;

  for (const blocker of blockers) {
    const key = blocker.key ?? `${blocker.tileX}:${blocker.tileY}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const hit = sweptCircleBlockerHit(
      previousX,
      previousY,
      rock.x,
      rock.y,
      rock.radius,
      blocker
    ) || circleBlockerOverlap(rock, blocker);
    if (!hit) {
      continue;
    }

    if (!isExposedMenuBlockFace(blocker, hit, options)) {
      buried = true;
      continue;
    }

    if (nearest && hitTime(hit) >= hitTime(nearest)) {
      continue;
    }

    nearest = hit;
  }

  return nearest || (buried ? { destroy: true } : null);
}

function bounceMenuHuckRock(rock, hit) {
  if (hit.destroy) {
    rock.destroyed = true;
    return true;
  }

  if (Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
    rock.x = hit.x + hit.normalX * 0.01;
    rock.y = hit.y + hit.normalY * 0.01;
  } else {
    rock.x += hit.normalX * hit.overlap;
    rock.y += hit.normalY * hit.overlap;
  }

  const normalSpeed = rock.vx * hit.normalX + rock.vy * hit.normalY;
  if (normalSpeed < 0) {
    rock.vx -= (1 + ENGINE.huckRock.restitution) * normalSpeed * hit.normalX;
    rock.vy -= (1 + ENGINE.huckRock.restitution) * normalSpeed * hit.normalY;
    return true;
  }

  return false;
}

function isExposedMenuBlockFace(blocker, hit, options = {}) {
  const normalX = Math.abs(hit.normalX) >= Math.abs(hit.normalY) ? Math.sign(hit.normalX) : 0;
  const normalY = normalX === 0 ? Math.sign(hit.normalY) : 0;
  if (normalX === 0 && normalY === 0) {
    return true;
  }

  return !isBlockingMenuTile(blocker.tileX + normalX, blocker.tileY + normalY, options);
}

function isBlockingMenuTile(tileX, tileY, options = {}) {
  const asteroid = state.menu.asteroid;
  if (tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return options.blockNonPlayable !== false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return isAsteroidRockTile(asteroid.tiles[index]) ||
    (options.blockNonPlayable !== false && !(asteroid.playable[index] === true || asteroid.playable[index] === "1"));
}

function hitTime(hit) {
  return Number.isFinite(hit.time) ? hit.time : 1;
}

function resetMenuButtonTarget() {
  state.menu.buttonTargetId = null;
  state.menu.buttonTargetSeconds = 0;
  state.menu.buttonTargetActivated = false;
}

function resolveMenuAsteroidCollisions(player) {
  for (let pass = 0; pass < 4; pass += 1) {
    let resolved = false;
  const blockers = blockingTilesNearCircle(state.menu.asteroid, player.x, player.y, player.radius);

    for (const blocker of blockers) {
      const hit = circleBlockerOverlap(player, blocker);
      if (!hit) {
        continue;
      }

      player.x += hit.normalX * hit.overlap;
      player.y += hit.normalY * hit.overlap;

      const normalSpeed = player.vx * hit.normalX + player.vy * hit.normalY;
      if (normalSpeed < 0) {
        requestCollisionClunk(-normalSpeed);
        player.vx -= (1 + ENGINE.collision.boundaryRestitution) * normalSpeed * hit.normalX;
        player.vy -= (1 + ENGINE.collision.boundaryRestitution) * normalSpeed * hit.normalY;
      }

      resolved = true;
    }

    if (!resolved) {
      break;
    }
  }
}

function raycastMenuEntities(start, direction, maxDistance) {
  let nearest = null;

  for (const entity of menuEntities()) {
    if (!entity.action) {
      continue;
    }

    const hit = entity.type === "themeSwatch"
      ? rayCircleIntersection(start, direction, entity, maxDistance)
      : rayRectIntersection(start, direction, entity, maxDistance);
    if (!hit || (nearest && hit.distance >= nearest.distance)) {
      continue;
    }

    nearest = {
      hit: true,
      mineable: false,
      x: hit.x,
      y: hit.y,
      distance: hit.distance,
      target: entity
    };
  }

  return nearest;
}

function activateMenuEntity(entity) {
  if (entity.action === "ready") {
    activateReadyFromMenu();
    return;
  }

  requestMechanicalBeep();

  if (entity.action === "theme") {
    enterMenuRoom(MENU_ROOMS.theme);
    return;
  }

  if (entity.action === "named-room") {
    promptNamedRoomFromMenu();
    return;
  }

  if (entity.action === "bots") {
    startLocalBotGame();
    return;
  }

  if (entity.action === "next-theme") {
    cycleThemePreset();
    return;
  }

  if (entity.action === "previous-theme") {
    cycleThemePreset(-1);
    return;
  }

  if (entity.action === "reset") {
    resetTheme();
    return;
  }

  if (entity.action === "random-theme") {
    setTheme(randomTheme());
    return;
  }

  if (entity.action === "select-theme") {
    const preset = THEME_PRESETS.find((candidate) => candidate.id === entity.themeId);
    if (!preset) {
      return;
    }
    setTheme(preset);
    return;
  }

  if (entity.action === "back") {
    enterMenuRoom(MENU_ROOMS.ready);
  }
}

function activateReadyFromMenu() {
  if (state.menu.readySent || !socket.connected) {
    return;
  }

  state.menu.readySent = true;
  socket.emit(CLIENT_EVENTS.ready, { button: true });
  cancelMiningRay();
  releaseSpaceUntilKeyup();
}

function promptNamedRoomFromMenu() {
  const initial = normalizedRoomNameDraft() || pathRoomName();
  cancelMiningRay();
  releaseSpaceUntilKeyup();
  const value = window.prompt("ROOM", initial);
  if (value === null) {
    return;
  }

  joinNamedRoomFromMenu(value);
}

function joinNamedRoomFromMenu(value = state.menu.roomNameDraft) {
  const name = sanitizeRoomNameDraft(value).trim();
  if (!name) {
    return;
  }

  if (state.menu.readySent || !socket.connected) {
    return;
  }

  window.localStorage.setItem(ROOM_NAME_STORAGE_KEY, name);
  state.menu.roomNameDraft = name;
  updateRoomPath(name);
  state.menu.readySent = true;
  socket.emit(CLIENT_EVENTS.joinNamedRoom, { name, button: true });
  cancelMiningRay();
  releaseSpaceUntilKeyup();
}

function startLocalBotGame() {
  forgetRegisteredRoom();
  const seed = `local-bots:${Date.now().toString(36)}`;
  const arena = createArena({
    id: LOCAL_BOT_ROOM_ID,
    seed,
    playerCount: LOCAL_BOT_COUNT + 1,
    playerDamage: true,
    storm: true
  });
  const spawnNumbers = shuffledSpawnNumbers(LOCAL_BOT_COUNT + 1, seed);
  const playerName = getPlayerName();
  const localPlayerId = LOCAL_BOT_PLAYER_ID;
  addPlayer(arena, {
    id: localPlayerId,
    name: playerName || "Pilot",
    spawnNumber: spawnNumbers[0]
  });

  const bots = new Map();
  for (let index = 0; index < LOCAL_BOT_COUNT; index += 1) {
    const id = `bot-${index + 1}`;
    addPlayer(arena, {
      id,
      name: `Bot ${index + 1}`,
      spawnNumber: spawnNumbers[index + 1]
    });
    bots.set(id, createPilotBotBrain(id, { seed: `${seed}:${id}` }));
  }

  state.localGame.active = true;
  state.localGame.arena = arena;
  state.localGame.bots = bots;
  state.localGame.lastStepTimeSeconds = 0;
  state.localGame.accumulatorSeconds = 0;
  state.localGame.inputSeq = 0;
  state.localGame.lastSaveTimeSeconds = 0;
  state.playerId = localPlayerId;
  state.room = localBotRoomFromArena(arena, { state: "active" });
  state.lastRoomId = LOCAL_BOT_ROOM_ID;
  state.lastActiveMatchKey = `${LOCAL_BOT_ROOM_ID}:${seed}`;
  resetControlStateForNewMatch();
  resetLocalDamageAudioState();
  resetEntitySmoothing();
  state.prediction.player = null;
  state.prediction.huckRockCooldownSeconds = 0;
  clearPredictedHuckRocks();
  state.eliminationNotices = [];
  state.playerAliveById.clear();
  state.spectatorTargetId = null;
  setClientAsteroid(snapshotAsteroid(arena));
  syncLocalArenaSnapshot(performance.now() / 1000);
}

function leaveLocalBotGame() {
  state.localGame.active = false;
  state.localGame.arena = null;
  state.localGame.bots.clear();
  state.localGame.lastStepTimeSeconds = 0;
  state.localGame.accumulatorSeconds = 0;
  state.localGame.inputSeq = 0;
  state.localGame.lastSaveTimeSeconds = 0;
  clearLocalBotSave();
  state.playerId = state.clientId;
  state.room = {
    state: "menu",
    clientId: state.clientId
  };
  state.snapshot = null;
  state.asteroid = null;
  state.prediction.player = null;
  state.prediction.huckRockCooldownSeconds = 0;
  clearPredictedHuckRocks();
  resetEntitySmoothing();
  state.eliminationNotices = [];
  state.playerAliveById.clear();
  state.spectatorTargetId = null;
  state.lastActiveMatchKey = null;
  resetControlStateForNewMatch();
  resetLocalDamageAudioState();
  enterMenuRoom(MENU_ROOMS.ready);
}

function updateLocalBotGame(timeSeconds) {
  if (!botProfileActive()) {
    return updateLocalBotGameImpl(timeSeconds);
  }
  return botProfileMeasure("updateLocalBotGame", () => updateLocalBotGameImpl(timeSeconds));
}

function updateLocalBotGameImpl(timeSeconds) {
  const localGame = state.localGame;
  const arena = localGame.arena;
  if (!localGame.active || !arena) {
    return;
  }

  if (state.room?.state === "ended") {
    syncLocalArenaSnapshot(timeSeconds);
    return;
  }

  if (localGame.lastStepTimeSeconds <= 0) {
    localGame.lastStepTimeSeconds = timeSeconds;
    syncLocalArenaSnapshot(timeSeconds);
    return;
  }

  const elapsed = clamp(timeSeconds - localGame.lastStepTimeSeconds, 0, 0.25);
  localGame.lastStepTimeSeconds = timeSeconds;
  localGame.accumulatorSeconds += elapsed;

  const stepSeconds = 1 / ENGINE.tickRate;
  let steps = 0;
  while (localGame.accumulatorSeconds >= stepSeconds && steps < 8) {
    if (botProfileActive()) {
      botProfileMeasure("stepLocalBotArena", () => stepLocalBotArena(stepSeconds));
    } else {
      stepLocalBotArena(stepSeconds);
    }
    localGame.accumulatorSeconds -= stepSeconds;
    steps += 1;
  }

  if (steps >= 8) {
    localGame.accumulatorSeconds = 0;
  }

  if (botProfileActive()) {
    botProfileMeasure("syncLocalArenaSnapshot", () => syncLocalArenaSnapshot(timeSeconds));
  } else {
    syncLocalArenaSnapshot(timeSeconds);
  }
}

function stepLocalBotArena(stepSeconds) {
  const arena = state.localGame.arena;
  if (!arena) {
    return;
  }

  setPlayerInput(arena, LOCAL_BOT_PLAYER_ID, readLocalPlayerInput());
  for (const [botId, brain] of state.localGame.bots.entries()) {
    const bot = arena.players.get(botId);
    if (!bot?.alive) {
      continue;
    }

    const decision = shouldUpdateLocalBotBrain(arena, botId, brain)
      ? updatePilotBotBrain(arena, bot, brain)
      : updatePilotBotLocalPlanner(arena, bot, brain);
    setPlayerInput(arena, botId, decision.input);
    if (decision.upgradeId) {
      purchasePlayerUpgrade(arena, botId, decision.upgradeId);
    }
  }

  if (botProfileActive()) {
    botProfileMeasure("stepArena", () => stepArena(arena, stepSeconds));
  } else {
    stepArena(arena, stepSeconds);
  }
  applyClientAsteroidUpdates(takeAsteroidUpdates(arena));
  updateLocalRoomEndState(arena);
}

function shouldUpdateLocalBotBrain(arena, botId, brain) {
  if (
    !brain?.input ||
    !Number.isFinite(brain.seq) ||
    brain.seq <= 0 ||
    !Number.isFinite(brain.lastPlanTick)
  ) {
    return true;
  }

  return arena.tick % LOCAL_BOT_PLAN_INTERVAL_TICKS === localBotPlanPhase(botId);
}

function localBotPlanPhase(botId) {
  const match = /(\d+)$/.exec(String(botId || ""));
  const number = match ? Number(match[1]) : stableTextHash(botId);
  return Math.abs(Math.floor(number)) % LOCAL_BOT_PLAN_INTERVAL_TICKS;
}

function stableTextHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLocalPlayerInput() {
  state.localGame.inputSeq += 1;
  const player = localPlayerFromSnapshot();
  const aimAngle = inputAimAngleForPlayer(player);
  if (state.chat.active || isInputBlocked()) {
    return normalizeInput({
      sessionId: inputSessionId,
      seq: state.localGame.inputSeq,
      moveX: 0,
      moveY: 0,
      aimAngle,
      mining: false,
      huckRock: false,
      huckRockTargetX: null,
      huckRockTargetY: null,
      interact: false,
      build: false
    });
  }

  const move = readMoveVector();
  const huckRock = readHuckRockInput();
  const huckRockTarget = huckRock ? huckRockTargetForPlayer(player) : null;
  return normalizeInput({
    sessionId: inputSessionId,
    seq: state.localGame.inputSeq,
    moveX: move.x,
    moveY: move.y,
    aimAngle,
    mining: activeRoomMiningInputAllowed(),
    huckRock,
    huckRockTargetX: huckRockTarget?.x ?? null,
    huckRockTargetY: huckRockTarget?.y ?? null,
    interact: false,
    build: false
  });
}

function syncLocalArenaSnapshot(timeSeconds, options = {}) {
  const arena = state.localGame.arena;
  if (!arena) {
    return;
  }

  const snapshot = snapshotArena(arena);
  snapshot.receivedAtSeconds = timeSeconds;
  recordEntitySnapshot(snapshot, timeSeconds);
  updateLocalDamageAudio(snapshot, timeSeconds);
  if (options.skipEliminations) {
    primePlayerAliveState(snapshot);
  } else {
    recordEliminations(snapshot, timeSeconds);
  }
  state.snapshot = snapshot;
  if (state.asteroid) {
    state.asteroid.tick = snapshot.tick;
  }
  saveLocalBotGame({ timeSeconds });
}

function primePlayerAliveState(snapshot) {
  state.playerAliveById.clear();
  for (const player of snapshot.players || []) {
    state.playerAliveById.set(player.id, player.alive !== false);
  }
}

function updateLocalRoomEndState(arena) {
  const alive = Array.from(arena.players.values()).filter((player) => player.alive);
  if (alive.length > 1 || state.room?.state === "ended") {
    return;
  }

  state.room = localBotRoomFromArena(arena, {
    state: "ended",
    winnerId: alive[0]?.id ?? null
  });
  cancelMiningRay();
  releaseSpaceUntilKeyup();
  saveLocalBotGame({ force: true });
}

function isLocalBotGame() {
  return state.localGame.active === true;
}

function shuffledSpawnNumbers(count, seed) {
  const random = createSeededRandom(`${seed}:spawns`);
  const numbers = Array.from({ length: count }, (_, index) => index + 1);
  for (let index = numbers.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [numbers[index], numbers[other]] = [numbers[other], numbers[index]];
  }
  return numbers;
}

function saveLocalBotGame(options = {}) {
  const localGame = state.localGame;
  if (!localGame.active || !localGame.arena) {
    return;
  }

  const timeSeconds = Number.isFinite(options.timeSeconds)
    ? options.timeSeconds
    : performance.now() / 1000;
  if (
    !options.force &&
    localGame.lastSaveTimeSeconds > 0 &&
    timeSeconds - localGame.lastSaveTimeSeconds < LOCAL_BOT_SAVE_INTERVAL_SECONDS
  ) {
    return;
  }

  const save = createLocalBotSave();
  if (!save) {
    return;
  }

  try {
    window.localStorage.setItem(LOCAL_BOT_SAVE_STORAGE_KEY, JSON.stringify(save));
    localGame.lastSaveTimeSeconds = timeSeconds;
  } catch (error) {
    console.warn("Unable to save local bot game", error);
  }
}

function createLocalBotSave() {
  const arena = state.localGame.arena;
  if (!arena) {
    return null;
  }

  return {
    version: LOCAL_BOT_SAVE_VERSION,
    savedAt: Date.now(),
    seed: arena.seed,
    tick: arena.tick,
    inputSeq: state.localGame.inputSeq,
    roomState: state.room?.state === "ended" ? "ended" : "active",
    winnerId: state.room?.winnerId ?? null,
    asteroid: snapshotAsteroid(arena),
    asteroidMining: Array.from(arena.asteroidMining.entries()).map(([index, mining]) => ({
      index,
      phase: mining.phase,
      progress: mining.progress
    })),
    players: Array.from(arena.players.values())
      .sort((a, b) => a.number - b.number)
      .map(serializeLocalBotPlayer),
    bots: Array.from(state.localGame.bots.values()).map(snapshotPilotBotBrain),
    entities: Array.from(arena.entities.values())
      .filter((entity) => entity.destroyed !== true)
      .map((entity) => ({ ...entity }))
  };
}

function serializeLocalBotPlayer(player) {
  return {
    id: player.id,
    number: player.number,
    spawnNumber: player.spawnNumber,
    name: player.name,
    talk: player.talk,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    angle: player.angle,
    facingMoveX: player.facingMoveX,
    facingMoveY: player.facingMoveY,
    pendingFacingSignX: player.pendingFacingSignX,
    pendingFacingSignY: player.pendingFacingSignY,
    pendingFacingSeconds: player.pendingFacingSeconds,
    aimAngle: player.aimAngle,
    mining: player.mining,
    miningRayCount: player.miningRayCount,
    miningHoldSeconds: player.miningHoldSeconds,
    rayExtension: player.rayExtension,
    buttonTargetId: player.buttonTargetId,
    buttonTargetSeconds: player.buttonTargetSeconds,
    buttonTargetActivated: player.buttonTargetActivated,
    huckRockCooldownSeconds: player.huckRockCooldownSeconds,
    huckRockEngineCutoutSeconds: player.huckRockEngineCutoutSeconds,
    miningTargetIndex: player.miningTargetIndex,
    miningPhase: player.miningPhase,
    miningProgress: player.miningProgress,
    thrusting: player.thrusting,
    shake: player.shake,
    radius: player.radius,
    upgrades: { ...player.upgrades },
    healthBars: player.healthBars,
    health: player.health,
    maxHealth: player.maxHealth,
    kills: player.kills || 0,
    lastKillDropAmount: player.lastKillDropAmount || 0,
    lastKillDropTick: player.lastKillDropTick,
    lastDamageTick: player.lastDamageTick,
    killedById: player.killedById,
    eliminatedAtTick: player.eliminatedAtTick,
    resources: { ...player.resources },
    stormWarning: player.stormWarning,
    stormDamagePerSecond: player.stormDamagePerSecond,
    alive: player.alive,
    input: player.input ? { ...player.input } : null,
    inputSessionId: player.inputSessionId,
    lastInputSeq: player.lastInputSeq,
    joinedAtTick: player.joinedAtTick
  };
}

function restoreLocalBotGame() {
  let save = null;
  try {
    save = JSON.parse(window.localStorage.getItem(LOCAL_BOT_SAVE_STORAGE_KEY) || "null");
  } catch (error) {
    clearLocalBotSave();
    return false;
  }

  if (!validLocalBotSave(save)) {
    clearLocalBotSave();
    return false;
  }

  const asteroid = hydrateLocalBotAsteroid(save.asteroid);
  if (!asteroid) {
    clearLocalBotSave();
    return false;
  }

  const arena = createArena({
    id: LOCAL_BOT_ROOM_ID,
    seed: save.seed,
    playerCount: LOCAL_BOT_COUNT + 1,
    playerDamage: true,
    storm: true,
    asteroid
  });
  arena.tick = Math.max(0, Math.floor(Number(save.tick) || 0));
  arena.players.clear();
  arena.entities.clear();
  arena.asteroidMining.clear();
  arena.asteroidUpdates = [];
  arena.stormUpdates = [];
  arena.effects = [];
  arena.huckRockButtonHits = [];

  for (const savedPlayer of save.players.slice().sort((a, b) => numberOr(a.number, 0) - numberOr(b.number, 0))) {
    addPlayer(arena, {
      id: String(savedPlayer.id),
      name: savedPlayer.name,
      spawnNumber: numberOr(savedPlayer.spawnNumber, savedPlayer.number || 1)
    });
    const player = arena.players.get(String(savedPlayer.id));
    if (player) {
      restoreLocalBotPlayer(player, savedPlayer);
    }
  }

  restoreLocalBotStorm(arena, save.asteroid);
  restoreLocalBotMining(arena, save.asteroidMining);
  restoreLocalBotEntities(arena, save.entities);

  const savedBrainById = new Map((save.bots || []).map((brain) => [String(brain.id), brain]));
  const bots = new Map();
  for (const player of arena.players.values()) {
    if (player.id === LOCAL_BOT_PLAYER_ID) {
      continue;
    }

    const savedBrain = savedBrainById.get(player.id) || {};
    const brain = createPilotBotBrain(player.id, {
      ...savedBrain,
      seed: savedBrain.seed || `${save.seed}:${player.id}`
    });
    resetRestoredBotBrainTransientState(brain);
    bots.set(player.id, brain);
    player.inputSessionId = brain.sessionId;
    player.lastInputSeq = brain.seq || 0;
  }

  state.localGame.active = true;
  state.localGame.arena = arena;
  state.localGame.bots = bots;
  state.localGame.lastStepTimeSeconds = 0;
  state.localGame.accumulatorSeconds = 0;
  state.localGame.inputSeq = numberOr(save.inputSeq, 0);
  state.localGame.lastSaveTimeSeconds = 0;
  state.playerId = LOCAL_BOT_PLAYER_ID;
  state.room = localBotRoomFromArena(arena, {
    state: save.roomState,
    winnerId: save.winnerId
  });
  state.lastRoomId = LOCAL_BOT_ROOM_ID;
  state.resumePending = false;
  state.deferredMenuRoom = null;
  state.upgrades.active = false;
  closeBuildMode();
  cancelMiningRay();
  releaseSpaceUntilKeyup();
  resetLocalDamageAudioState();
  resetEntitySmoothing();
  state.prediction.player = null;
  state.prediction.huckRockCooldownSeconds = 0;
  clearPredictedHuckRocks();
  state.eliminationNotices = [];
  state.playerAliveById.clear();
  setClientAsteroid(snapshotAsteroid(arena));
  syncLocalArenaSnapshot(performance.now() / 1000, { skipEliminations: true });
  return true;
}

function resetRestoredBotBrainTransientState(brain) {
  brain.wanderTarget = null;
  brain.targetResource = null;
  brain.resourceTargetCache = null;
  brain.fleeTarget = null;
  brain.chaseMemory = null;
  brain.navGoalKey = "";
  brain.navPath = [];
  brain.navPathSteps = [];
  brain.navPathCursor = 0;
  brain.navSegmentCursor = -1;
  brain.navSegmentProgress = 0;
  brain.navAttachIndex = 0;
  brain.navUpdatedTick = 0;
  brain.navFailedKey = "";
  brain.navFailedUntilTick = 0;
  brain.attackFallbackTarget = null;
  brain.mineQueue = [];
  brain.input = null;
  brain.lastPlanTick = null;
  brain.trajectoryPlan = null;
  brain.lastX = null;
  brain.lastY = null;
  brain.stuckTicks = 0;
  brain.debug = null;
}

function validLocalBotSave(save) {
  return save &&
    save.version === LOCAL_BOT_SAVE_VERSION &&
    typeof save.seed === "string" &&
    save.asteroid &&
    Array.isArray(save.players) &&
    save.players.some((player) => player?.id === LOCAL_BOT_PLAYER_ID);
}

function hydrateLocalBotAsteroid(savedAsteroid) {
  const widthTiles = Math.floor(Number(savedAsteroid?.widthTiles) || 0);
  const heightTiles = Math.floor(Number(savedAsteroid?.heightTiles) || 0);
  const tileCount = widthTiles * heightTiles;
  if (
    tileCount <= 0 ||
    typeof savedAsteroid.tiles !== "string" ||
    typeof savedAsteroid.amounts !== "string" ||
    typeof savedAsteroid.playable !== "string" ||
    savedAsteroid.tiles.length !== tileCount ||
    savedAsteroid.amounts.length !== tileCount ||
    savedAsteroid.playable.length !== tileCount
  ) {
    return null;
  }

  return {
    seed: savedAsteroid.seed || "local-bots:asteroid",
    widthTiles,
    heightTiles,
    tileSize: Math.max(1, Math.floor(Number(savedAsteroid.tileSize) || RENDER.tileSize)),
    generation: savedAsteroid.generation || {},
    tiles: savedAsteroid.tiles.split(""),
    amounts: Uint8Array.from(savedAsteroid.amounts, (amount) => parseInt(amount, 36) || 0),
    playable: Array.from(savedAsteroid.playable, (cell) => cell === "1"),
    pockets: Array.isArray(savedAsteroid.pockets)
      ? savedAsteroid.pockets.map((pocket) => ({
          playerNumber: numberOr(pocket.playerNumber, 0),
          tileX: numberOr(pocket.tileX, 0),
          tileY: numberOr(pocket.tileY, 0),
          radius: numberOr(pocket.radius, 0),
          spawnX: numberOr(pocket.spawnX, 0),
          spawnY: numberOr(pocket.spawnY, 0)
        }))
      : []
  };
}

function restoreLocalBotPlayer(player, savedPlayer) {
  const numericFields = [
    "number",
    "spawnNumber",
    "x",
    "y",
    "vx",
    "vy",
    "angle",
    "facingMoveX",
    "facingMoveY",
    "pendingFacingSignX",
    "pendingFacingSignY",
    "pendingFacingSeconds",
    "aimAngle",
    "miningRayCount",
    "miningHoldSeconds",
    "rayExtension",
    "buttonTargetSeconds",
    "huckRockCooldownSeconds",
    "huckRockEngineCutoutSeconds",
    "miningTargetIndex",
    "miningProgress",
    "shake",
    "radius",
    "healthBars",
    "health",
    "maxHealth",
    "kills",
    "lastKillDropAmount",
    "lastKillDropTick",
    "lastDamageTick",
    "eliminatedAtTick",
    "stormDamagePerSecond",
    "lastInputSeq",
    "joinedAtTick"
  ];

  for (const field of numericFields) {
    if (Number.isFinite(savedPlayer[field])) {
      player[field] = savedPlayer[field];
    }
  }

  player.name = savedPlayer.name || player.name;
  player.talk = savedPlayer.talk || "";
  player.mining = savedPlayer.mining === true;
  player.buttonTargetId = savedPlayer.buttonTargetId ?? null;
  player.buttonTargetActivated = savedPlayer.buttonTargetActivated === true;
  player.miningPhase = savedPlayer.miningPhase ?? null;
  player.thrusting = savedPlayer.thrusting === true;
  player.upgrades = { ...player.upgrades, ...(savedPlayer.upgrades || {}) };
  player.killedById = savedPlayer.killedById ?? null;
  player.resources = {
    rock: numberOr(savedPlayer.resources?.rock, 0),
    ore: numberOr(savedPlayer.resources?.ore, 0),
    diamond: numberOr(savedPlayer.resources?.diamond, 0)
  };
  player.stormWarning = savedPlayer.stormWarning || "";
  player.alive = savedPlayer.alive !== false;
  player.input = normalizeInput(savedPlayer.input || {});
  player.inputSessionId = savedPlayer.inputSessionId || player.input.sessionId || "";
}

function restoreLocalBotStorm(arena, savedAsteroid) {
  if (!arena.storm || typeof savedAsteroid?.storm !== "string") {
    return;
  }

  const tileCount = arena.asteroid.tiles.length;
  if (savedAsteroid.storm.length !== tileCount) {
    return;
  }

  arena.storm.state = Uint8Array.from(savedAsteroid.storm, (state) => parseInt(state, 36) || 0);
  arena.storm.warningStartedTick = new Int32Array(tileCount);
  arena.storm.warningUntilTick = new Int32Array(tileCount);
  for (const warning of savedAsteroid.stormWarnings || []) {
    const index = Math.floor(Number(warning.index));
    if (index < 0 || index >= tileCount) {
      continue;
    }

    arena.storm.warningStartedTick[index] = Math.floor(Number(warning.startedTick) || 0);
    arena.storm.warningUntilTick[index] = Math.floor(Number(warning.untilTick) || 0);
  }

  arena.storm.playableCount = 0;
  arena.storm.claimedCount = 0;
  for (let index = 0; index < tileCount; index += 1) {
    if (!localBotPlayableCell(arena.asteroid, index)) {
      continue;
    }

    arena.storm.playableCount += 1;
    if (arena.storm.state[index] !== STORM_STATE.safe) {
      arena.storm.claimedCount += 1;
    }
  }
}

function restoreLocalBotMining(arena, asteroidMining) {
  if (!Array.isArray(asteroidMining)) {
    return;
  }

  for (const mining of asteroidMining) {
    const index = Math.floor(Number(mining.index));
    if (
      index < 0 ||
      index >= arena.asteroid.tiles.length ||
      typeof mining.phase !== "string" ||
      !Number.isFinite(mining.progress) ||
      mining.progress <= 0
    ) {
      continue;
    }

    arena.asteroidMining.set(index, {
      phase: mining.phase,
      progress: mining.progress
    });
  }
}

function restoreLocalBotEntities(arena, entities) {
  if (!Array.isArray(entities)) {
    return;
  }

  for (const entity of entities) {
    if (!entity?.id || entity.destroyed === true) {
      continue;
    }
    arena.entities.set(String(entity.id), { ...entity, id: String(entity.id) });
  }
}

function localBotRoomFromArena(arena, options = {}) {
  return {
    state: options.state === "ended" ? "ended" : "active",
    roomId: LOCAL_BOT_ROOM_ID,
    local: true,
    winnerId: options.state === "ended" ? options.winnerId ?? null : null,
    players: Array.from(arena.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive
    }))
  };
}

function clearLocalBotSave() {
  window.localStorage.removeItem(LOCAL_BOT_SAVE_STORAGE_KEY);
}

function localBotPlayableCell(asteroid, index) {
  return asteroid.playable[index] === true || asteroid.playable[index] === "1";
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function rayRectIntersection(start, direction, rect, maxDistance) {
  let near = 0;
  let far = maxDistance;

  if (Math.abs(direction.x) < 0.00001) {
    if (start.x < rect.x || start.x > rect.x + rect.width) {
      return null;
    }
  } else {
    const tx1 = (rect.x - start.x) / direction.x;
    const tx2 = (rect.x + rect.width - start.x) / direction.x;
    near = Math.max(near, Math.min(tx1, tx2));
    far = Math.min(far, Math.max(tx1, tx2));
  }

  if (Math.abs(direction.y) < 0.00001) {
    if (start.y < rect.y || start.y > rect.y + rect.height) {
      return null;
    }
  } else {
    const ty1 = (rect.y - start.y) / direction.y;
    const ty2 = (rect.y + rect.height - start.y) / direction.y;
    near = Math.max(near, Math.min(ty1, ty2));
    far = Math.min(far, Math.max(ty1, ty2));
  }

  if (near > far || far < 0 || near > maxDistance) {
    return null;
  }

  const distance = Math.max(0, near);
  return {
    x: start.x + direction.x * distance,
    y: start.y + direction.y * distance,
    distance
  };
}

function rayCircleIntersection(start, direction, circle, maxDistance) {
  const radius = circle.radius || THEME_SWATCH_RADIUS;
  const dx = start.x - circle.x;
  const dy = start.y - circle.y;
  const startDistanceSq = dx * dx + dy * dy;
  const projection = dx * direction.x + dy * direction.y;
  const closestDistanceSq = startDistanceSq - projection * projection;
  const radiusSq = radius * radius;
  if (closestDistanceSq > radiusSq) {
    return null;
  }

  const offset = Math.sqrt(radiusSq - closestDistanceSq);
  const nearDistance = -projection - offset;
  const farDistance = -projection + offset;
  const distance = nearDistance >= 0 ? nearDistance : farDistance;
  if (distance < 0 || distance > maxDistance) {
    return null;
  }

  return {
    x: start.x + direction.x * distance,
    y: start.y + direction.y * distance,
    distance
  };
}

function menuSnapshot() {
  const world = menuWorld(state.menu.asteroid);
  const entities = menuEntities().concat(
    state.menu.huckRocks.filter((entity) => entity.destroyed !== true)
  );
  return {
    arenaId: `menu-${state.menu.room}`,
    tick: state.menu.tick,
    serverTime: Date.now(),
    render: RENDER,
    world,
    players: [{ ...state.menu.player }],
    asteroidMining: [],
    entities,
    effects: []
  };
}

function isReadyMenu() {
  return state.room?.state === "menu";
}

function isLoadingRoom() {
  return state.room === null;
}

function menuEntities() {
  const center = menuCenter(state.menu.asteroid);
  const top = center.y + 28;
  const buttonWidth = 88;
  const buttonGap = 16;
  const controlsRows = menuControlHintRows();
  const controlsY = top + MENU_BUTTON_HEIGHT + 30;
  const controlsHeight = controlsRows.length * 11 - 1;
  const secondaryY = controlsY + controlsHeight + 18;

  if (state.menu.room === MENU_ROOMS.theme) {
    return themeSwatchEntities(center);
  }

  return [
    menuTitle("menu-title", "BITSPACE", MENU_ESRB_SUBTITLE, center.x, center.y - 84),
    menuButton("menu-ready", "ready", "READY", center.x - buttonWidth - buttonGap / 2, top, buttonWidth),
    menuButton("menu-theme", "theme", "THEME", center.x + buttonGap / 2, top, buttonWidth),
    menuHint("menu-controls", controlsRows, center.x, controlsY),
    menuButton("menu-room", "named-room", "ROOM", center.x - buttonWidth - buttonGap / 2, secondaryY, buttonWidth),
    menuButton("menu-bots", "bots", "BOTS", center.x + buttonGap / 2, secondaryY, buttonWidth)
  ];
}

function menuControlHintRows() {
  if (state.controller.connected) {
    return [
      { input: "L STICK", action: "MOVE" },
      { input: "R STICK", action: "AIM" },
      { input: "R TRIG", action: "MINING RAY" },
      { input: "L TRIG", action: "HUCK ROCK" }
    ];
  }

  return [
    { input: "WASD", action: "MOVE" },
    { input: "CLICK + HOLD", action: "MINING RAY" },
    { input: "SPACE", action: "HUCK ROCK" }
  ];
}

function menuTitle(id, label, subtitle, x, y) {
  return {
    id,
    type: "menuTitle",
    label,
    subtitle,
    x,
    y
  };
}

function menuHint(id, rows, x, y) {
  return {
    id,
    type: "menuHint",
    rows,
    x,
    y,
    width: 168,
    height: rows.length * 11 - 1
  };
}

function menuButton(id, action, label, x, y, width) {
  return {
    id,
    type: "lobbyButton",
    action,
    label,
    x,
    y,
    width,
    height: MENU_BUTTON_HEIGHT,
    active: state.menu.activeTargetId === id
  };
}

function themeSwatchEntities(center) {
  const startAngle = -Math.PI / 2;
  const presetItems = THEME_PRESETS.map((preset, index) => ({ type: "preset", preset, themeNumber: index + 1 }));
  const ringItems = [
    { type: "home" },
    presetItems[0],
    presetItems[1],
    presetItems[2],
    { type: "random" },
    presetItems[3],
    presetItems[4],
    presetItems[5]
  ].filter(Boolean);
  const entities = ringItems.map((item, index) => {
    const angle = startAngle + (index * Math.PI * 2) / ringItems.length;
    const x = center.x + Math.cos(angle) * THEME_SWATCH_RING_RADIUS;
    const y = center.y + Math.sin(angle) * THEME_SWATCH_RING_RADIUS;

    if (item.type === "random") {
      return {
        id: THEME_RANDOM_ID,
        type: "themeSwatch",
        action: "random-theme",
        label: "?",
        background: "#202020",
        foreground: "#f2f2f2",
        backing: "#000000",
        x,
        y,
        radius: THEME_SWATCH_RADIUS,
        active: state.menu.activeTargetId === THEME_RANDOM_ID,
        selected: false
      };
    }

    if (item.type === "home") {
      return {
        id: THEME_BACK_ID,
        type: "themeSwatch",
        action: "back",
        label: "⌂",
        background: state.theme.background,
        foreground: state.theme.foreground,
        backing: state.theme.backing || "#000000",
        x,
        y,
        radius: THEME_SWATCH_RADIUS,
        active: state.menu.activeTargetId === THEME_BACK_ID,
        selected: false
      };
    }

    const { preset } = item;
    const id = `menu-theme-${preset.id}`;
    return {
      id,
      type: "themeSwatch",
      action: "select-theme",
      label: String(item.themeNumber),
      themeId: preset.id,
      background: preset.background,
      foreground: preset.foreground,
      backing: preset.backing || "#000000",
      x,
      y,
      radius: THEME_SWATCH_RADIUS,
      active: state.menu.activeTargetId === id,
      selected: themeMatchesPreset(state.theme, preset)
    };
  });

  return entities;
}

function menuCenter(asteroid) {
  return {
    x: (asteroid.widthTiles * asteroid.tileSize) / 2,
    y: (asteroid.heightTiles * asteroid.tileSize) / 2
  };
}

function menuWorld(asteroid) {
  return {
    width: asteroid.widthTiles * asteroid.tileSize,
    height: asteroid.heightTiles * asteroid.tileSize
  };
}

function loadTheme() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) || "null");
    if (isValidTheme(stored)) {
      const theme = normalizeTheme(stored);
      applyThemeToSource(theme);
      return theme;
    }
  } catch {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  }

  return readThemeSource() || defaultTheme();
}

function loadBotDebugOverlay() {
  return window.localStorage.getItem(BOT_DEBUG_OVERLAY_STORAGE_KEY) === "1";
}

function setBotDebugOverlay(enabled) {
  state.botDebugOverlay = Boolean(enabled);
  window.localStorage.setItem(BOT_DEBUG_OVERLAY_STORAGE_KEY, state.botDebugOverlay ? "1" : "0");
  console.log(`BITSPACE bot debug overlay ${state.botDebugOverlay ? "on" : "off"}`);
  return state.botDebugOverlay;
}

function installControlHandles() {
  const handles = window.controls && typeof window.controls === "object"
    ? window.controls
    : {};
  handles.debugBot = (enabled = null) => setBotDebugOverlay(
    typeof enabled === "boolean" ? enabled : !state.botDebugOverlay
  );
  handles.profileBots = (seconds = 5) => {
    const durationSeconds = clamp(Number(seconds) || 5, 0.5, 60);
    resetBotProfile();
    setBotProfileEnabled(true);
    console.log(`BITSPACE bot profiler on for ${durationSeconds}s`);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        setBotProfileEnabled(false);
        const snapshot = botProfileSnapshot();
        console.table(snapshot.entries);
        resolve(snapshot);
      }, durationSeconds * 1000);
    });
  };
  handles.profileBotsStop = () => {
    setBotProfileEnabled(false);
    const snapshot = botProfileSnapshot();
    console.table(snapshot.entries);
    return snapshot;
  };
  handles.profileBotsNow = () => {
    const snapshot = botProfileSnapshot();
    console.table(snapshot.entries);
    return snapshot;
  };
  window.controls = handles;
}

function resetTheme() {
  setTheme(defaultTheme());
}

function cycleThemePreset(direction = 1) {
  setTheme(adjacentThemePreset(state.theme, direction));
}

function setTheme(theme) {
  state.theme = normalizeTheme(theme);
  applyThemeToSource(state.theme);
  saveTheme();
}

function randomTheme() {
  const candidates = [];

  for (let index = 0; index < 96; index += 1) {
    const candidate = randomThemeCandidate();
    const score = themeCandidateScore(candidate);
    if (Number.isFinite(score)) {
      candidates.push({
        theme: candidate,
        weight: Math.max(0.05, score)
      });
    }
  }

  if (candidates.length === 0) {
    return defaultTheme();
  }

  let remainingWeight = candidates.reduce((total, candidate) => total + candidate.weight, 0) * Math.random();
  for (const candidate of candidates) {
    remainingWeight -= candidate.weight;
    if (remainingWeight <= 0) {
      return candidate.theme;
    }
  }

  return candidates[candidates.length - 1].theme;
}

function randomThemeCandidate() {
  const hue = Math.random() * 360;
  const direction = Math.random() < 0.5 ? -1 : 1;

  switch (Math.floor(Math.random() * 5)) {
    case 0:
      return sampledTheme(
        hue,
        hue + direction * randomBetween(22, 70),
        randomBetween(16, 34),
        randomBetween(12, 30),
        randomBetween(44, 82),
        randomBetween(58, 84)
      );
    case 1:
      return sampledTheme(
        hue,
        hue + direction * randomBetween(90, 170),
        randomBetween(24, 56),
        randomBetween(10, 26),
        randomBetween(48, 88),
        randomBetween(60, 86)
      );
    case 2:
      return sampledTheme(
        hue + randomBetween(-24, 24),
        Math.random() * 360,
        randomBetween(6, 24),
        randomBetween(14, 32),
        randomBetween(68, 96),
        randomBetween(56, 82)
      );
    case 3:
      return sampledTheme(
        hue,
        hue + direction * randomBetween(35, 215),
        randomBetween(30, 66),
        randomBetween(8, 23),
        randomBetween(30, 62),
        randomBetween(68, 88)
      );
    default:
      return sampledTheme(
        hue,
        Math.random() * 360,
        randomBetween(0, 14),
        randomBetween(9, 25),
        randomBetween(50, 92),
        randomBetween(58, 88)
      );
  }
}

function sampledTheme(backgroundHue, foregroundHue, backgroundSaturation, backgroundLightness, foregroundSaturation, foregroundLightness) {
  return {
    background: hslToHex(backgroundHue, backgroundSaturation, backgroundLightness),
    foreground: hslToHex(foregroundHue, foregroundSaturation, foregroundLightness),
    backing: "#000000"
  };
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function themeCandidateScore(theme) {
  const background = hexToRgb(theme.background);
  const foreground = hexToRgb(theme.foreground);
  if (!background || !foreground) {
    return Number.NEGATIVE_INFINITY;
  }

  const backgroundLuminance = relativeLuminance(background);
  const foregroundLuminance = relativeLuminance(foreground);
  const colorDistance = Math.hypot(
    foreground.r - background.r,
    foreground.g - background.g,
    foreground.b - background.b
  ) / Math.hypot(255, 255, 255);

  const contrast = foregroundLuminance - backgroundLuminance;
  if (backgroundLuminance > 0.3 || foregroundLuminance < 0.32 || contrast < 0.24 || colorDistance < 0.24) {
    return Number.NEGATIVE_INFINITY;
  }

  return contrast * 1.8 + colorDistance * 1.2;
}

function adjacentThemePreset(theme, direction) {
  const currentIndex = THEME_PRESETS.findIndex((preset) => themeMatchesPreset(theme, preset));
  const step = direction < 0 ? -1 : 1;
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + step + THEME_PRESETS.length) % THEME_PRESETS.length;
  return THEME_PRESETS[nextIndex];
}

function themeMatchesPreset(theme, preset) {
  const normalized = normalizeTheme(theme);
  const presetTheme = normalizeTheme(preset);
  return normalized?.foreground === presetTheme?.foreground &&
    normalized?.background === presetTheme?.background &&
    normalized?.backing === presetTheme?.backing;
}

function syncThemeFromCss() {
  const cssTheme = readThemeSource();
  if (!cssTheme) {
    return;
  }

  const theme = normalizeTheme(cssTheme);
  if (
    theme.foreground !== state.theme.foreground ||
    theme.background !== state.theme.background ||
    theme.backing !== state.theme.backing
  ) {
    state.theme = theme;
    applyThemeBacking(state.theme);
  }
}

function readThemeSource() {
  if (!themeSource) {
    return null;
  }

  const style = window.getComputedStyle(themeSource);
  const foreground = cssColorToHex(style.color);
  const background = cssColorToHex(style.backgroundColor);
  const backing = cssColorToHex(style.getPropertyValue("--bitspace-backing")) || "#000000";
  if (!foreground || !background) {
    return null;
  }

  return {
    foreground,
    background,
    backing
  };
}

function applyThemeToSource(theme) {
  if (!themeSource || !isValidTheme(theme)) {
    return;
  }

  themeSource.style.color = theme.foreground;
  themeSource.style.backgroundColor = theme.background;
  themeSource.style.setProperty("--bitspace-backing", normalizeTheme(theme).backing);
  applyThemeBacking(theme);
}

function applyThemeBacking(theme) {
  const backing = normalizeTheme(theme).backing;
  document.documentElement.style.backgroundColor = backing;
  document.body.style.backgroundColor = backing;
  canvas.style.backgroundColor = backing;
}

function normalizeTheme(theme) {
  if (!isValidTheme(theme)) {
    return null;
  }

  const foreground = theme.foreground.toLowerCase();
  const background = theme.background.toLowerCase();
  const preset = THEME_PRESETS.find((candidate) =>
    candidate.foreground === foreground && candidate.background === background
  );
  const backing = theme.backing || preset?.backing || "#000000";

  return {
    foreground,
    background,
    backing: backing.toLowerCase()
  };
}

function rgbToHex(color) {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

function hslToHex(hue, saturation, lightness) {
  return rgbToHex(hslToRgb(hue, saturation, lightness));
}

function hslToRgb(hue, saturation, lightness) {
  const h = normalizeHue(hue) / 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;

  if (s <= 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255)
  };
}

function hueToRgb(p, q, t) {
  let value = t;
  if (value < 0) {
    value += 1;
  }
  if (value > 1) {
    value -= 1;
  }
  if (value < 1 / 6) {
    return p + (q - p) * 6 * value;
  }
  if (value < 1 / 2) {
    return q;
  }
  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6;
  }
  return p;
}

function normalizeHue(value) {
  return ((value % 360) + 360) % 360;
}

function hexToRgb(value) {
  if (!isHexColor(value)) {
    return null;
  }

  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16)
  };
}

function relativeLuminance(color) {
  return 0.2126 * linearSrgb(color.r) +
    0.7152 * linearSrgb(color.g) +
    0.0722 * linearSrgb(color.b);
}

function linearSrgb(value) {
  const channel = clamp(value, 0, 255) / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function cssColorToHex(value) {
  const color = String(value || "").trim();
  if (isHexColor(color)) {
    return color.toLowerCase();
  }

  const rgbMatch = color.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) {
    return null;
  }

  const parts = rgbMatch[1]
    .trim()
    .split(/[,\s/]+/)
    .filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const channels = parts.slice(0, 3).map(cssColorChannelToByte);
  if (channels.some((channel) => !Number.isFinite(channel))) {
    return null;
  }

  return rgbToHex({
    r: channels[0],
    g: channels[1],
    b: channels[2]
  });
}

function cssColorChannelToByte(value) {
  const text = String(value || "").trim();
  if (text.endsWith("%")) {
    return clamp(Number.parseFloat(text) * 2.55, 0, 255);
  }

  return clamp(Number.parseFloat(text), 0, 255);
}

function hexByte(value) {
  return clamp(Math.floor(value), 0, 255).toString(16).padStart(2, "0");
}

function defaultTheme() {
  return normalizeTheme(cssDefaultTheme);
}

function saveTheme() {
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state.theme));
}

function isValidTheme(theme) {
  return Boolean(theme) &&
    isHexColor(theme.foreground) &&
    isHexColor(theme.background) &&
    (theme.backing === undefined || isHexColor(theme.backing));
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ""));
}

function activateTalk() {
  if (isInputBlocked()) {
    return;
  }

  state.chat.active = true;
  state.upgrades.active = false;
  closeBuildMode();
  state.mouse.down = false;
  keys.clear();
  talkInput.value = currentTalkText();
  talkInput.focus({ preventScroll: true });
  talkInput.setSelectionRange(0, talkInput.value.length);
  syncTalkDraft();
}

function currentTalkText() {
  if (isReadyMenu()) {
    return state.menu.player?.talk || "";
  }

  return localPlayerFromSnapshot()?.talk || "";
}

function activateUpgrades(options = {}) {
  if (isInputBlocked() || state.room?.state !== "active") {
    return;
  }

  state.upgrades.active = true;
  if (options.controller && !Number.isInteger(state.upgrades.selectedIndex)) {
    state.upgrades.selectedIndex = 0;
  }
  closeBuildMode();
  state.mouse.down = false;
  resetControllerUpgradeNav();
  if (!options.controller) {
    updateUpgradeSelectionFromMouse();
  }
}

function toggleUpgrades(options = {}) {
  if (state.upgrades.active) {
    closeUpgrades();
    return;
  }

  activateUpgrades(options);
}

function closeUpgrades() {
  state.upgrades.active = false;
  resetControllerUpgradeNav();
}

function toggleBuildMode() {
  if (isInputBlocked() || state.room?.state !== "active") {
    return;
  }

  if (state.build.active) {
    closeBuildMode();
  } else {
    state.build.active = true;
    resetBuildHold();
  }
  state.upgrades.active = false;
  state.mouse.down = false;
}

function closeBuildMode() {
  state.build.active = false;
  resetBuildHold();
}

function handleUpgradeKey(event) {
  if (shouldCaptureKey(event.code) || event.code === "Enter" || event.code === "Escape") {
    event.preventDefault();
  }

  if (isMovementKey(event.code)) {
    keys.add(event.code);
    return;
  }

  if (event.code === "Escape" || event.code === "KeyQ") {
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
  if (isLocalBotGame()) {
    setPlayerTalk(state.localGame.arena, LOCAL_BOT_PLAYER_ID, text);
    syncLocalArenaSnapshot(performance.now() / 1000);
    closeTalk();
    return;
  }

  if (socket.connected) {
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

function sanitizeRoomNameDraft(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .trimStart()
    .slice(0, ROOM_NAME_MAX_CHARS);
}

function normalizedRoomNameDraft() {
  return sanitizeRoomNameDraft(state.menu.roomNameDraft).trim();
}

function initialRoomNameDraft() {
  return pathRoomName() ||
    sanitizeRoomNameDraft(window.localStorage.getItem(ROOM_NAME_STORAGE_KEY) || "");
}

function pathRoomName() {
  const pathname = decodeURIComponent(window.location.pathname || "/")
    .replace(/^\/+|\/+$/g, "");
  if (!pathname || pathname.includes("/") || pathname.includes(".")) {
    return "";
  }

  return sanitizeRoomNameDraft(pathname.replace(/-/g, " "));
}

function roomPathForName(name) {
  const key = sanitizeRoomNameDraft(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return key ? `/${encodeURIComponent(key)}` : "/";
}

function updateRoomPath(name) {
  const nextPath = name ? roomPathForName(name) : "/";
  if (window.location.pathname === nextPath) {
    return;
  }

  window.history.pushState({}, "", `${nextPath}${window.location.search || ""}${window.location.hash || ""}`);
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
  playMechanicalTone(context, 760, start + delay, 0.075, 0.0325);
  playMechanicalTone(context, 520, start + delay + 0.092, 0.07, 0.0275);
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

function requestHuckRockThunk() {
  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  if (context.state === "suspended") {
    context.resume()
      .then(() => playHuckRockThunk(context))
      .catch(() => {});
    return;
  }

  playHuckRockThunk(context);
}

function playHuckRockThunk(context) {
  const start = context.currentTime + 0.004;
  const body = context.createOscillator();
  const bodyGain = context.createGain();
  const strike = context.createBufferSource();
  const strikeFilter = context.createBiquadFilter();
  const strikeGain = context.createGain();

  body.type = "sine";
  body.frequency.setValueAtTime(92, start);
  body.frequency.exponentialRampToValueAtTime(42, start + 0.18);
  bodyGain.gain.setValueAtTime(0.0001, start);
  bodyGain.gain.exponentialRampToValueAtTime(0.105, start + 0.008);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

  strike.buffer = audio.huckRockBuffer || createNoiseBuffer(context, 0.08);
  audio.huckRockBuffer = strike.buffer;
  strikeFilter.type = "lowpass";
  strikeFilter.frequency.setValueAtTime(420, start);
  strikeFilter.frequency.exponentialRampToValueAtTime(95, start + 0.07);
  strikeFilter.Q.value = 0.6;
  strikeGain.gain.setValueAtTime(0.0001, start);
  strikeGain.gain.exponentialRampToValueAtTime(0.07, start + 0.004);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);

  body.connect(bodyGain);
  bodyGain.connect(context.destination);
  strike.connect(strikeFilter);
  strikeFilter.connect(strikeGain);
  strikeGain.connect(context.destination);
  body.start(start);
  body.stop(start + 0.24);
  strike.start(start);
  strike.stop(start + 0.1);
}

function updateLocalShipAudio(player, timeSeconds) {
  const context = audio.context;
  if (!audio.unlocked || !context || context.state !== "running") {
    return;
  }

  ensureShipAudio(context);
  const alive = player && player.alive !== false;
  const speed = alive ? Math.hypot(player.vx || 0, player.vy || 0) : 0;
  const speedLevel = clamp(speed / Math.max(1, ENGINE.ship.audioSpeedReference), 0, 1);
  const engineLevel = alive && player.thrusting ? Math.max(0.28, speedLevel) : 0;
  const miningActive = state.room?.state !== "ended" && alive && player.mining === true;

  updateEngineAudio(context, engineLevel, speedLevel, timeSeconds);
  updateMiningAudio(context, miningActive, timeSeconds);
  flushPendingDamageClunk(timeSeconds);
}

function updateLocalDamageAudio(snapshot, timeSeconds) {
  const player = snapshot.players.find((candidate) => candidate.id === state.playerId);
  if (!player) {
    return;
  }

  if (audio.lastHealth !== null) {
    const damage = audio.lastHealth - player.health;
    if (damage > 0.01) {
      audio.pendingDamage = Math.min(
        audio.pendingDamage + damage,
        ENGINE.player.healthPerBar * 2
      );
      flushPendingDamageClunk(timeSeconds);
    }
  }

  if (audio.lastShake !== null && player.shake > audio.lastShake + 0.04) {
    requestLocalClunk(0.45 + player.shake * 0.25, timeSeconds);
  }

  audio.lastHealth = player.health;
  audio.lastShake = player.shake || 0;
}

function flushPendingDamageClunk(timeSeconds = performance.now() / 1000) {
  if (audio.pendingDamage <= 0) {
    return;
  }

  const intensity = 0.38 + audio.pendingDamage / 36;
  if (requestLocalClunk(intensity, timeSeconds)) {
    audio.pendingDamage = 0;
  }
}

function resetLocalDamageAudioState() {
  audio.lastHealth = null;
  audio.lastShake = 0;
  audio.pendingDamage = 0;
}

function ensureShipAudio(context) {
  if (audio.ship) {
    return;
  }

  const engineGain = context.createGain();
  const engineFilter = context.createBiquadFilter();
  const engineNoise = context.createBufferSource();
  const engineOscillator = context.createOscillator();
  const engineOscillatorGain = context.createGain();
  const miningGain = context.createGain();
  const miningOscillators = [1, 1.52, 2.01].map((ratio, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 260 * ratio;
    gain.gain.value = index === 0 ? 0.62 : index === 1 ? 0.28 : 0.16;
    oscillator.connect(gain);
    gain.connect(miningGain);
    oscillator.start();
    return { oscillator, ratio };
  });

  engineNoise.buffer = createNoiseBuffer(context, 1);
  engineNoise.loop = true;
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 95;
  engineFilter.Q.value = 0.85;
  engineGain.gain.value = 0.0001;

  engineOscillator.type = "sawtooth";
  engineOscillator.frequency.value = 44;
  engineOscillatorGain.gain.value = 0.006;

  engineNoise.connect(engineFilter);
  engineOscillator.connect(engineOscillatorGain);
  engineOscillatorGain.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(context.destination);

  miningGain.gain.value = 0.0001;
  miningGain.connect(context.destination);

  engineNoise.start();
  engineOscillator.start();

  audio.ship = {
    engineGain,
    engineFilter,
    engineOscillator,
    engineOscillatorGain,
    miningGain,
    miningOscillators
  };
}

function updateEngineAudio(context, engineLevel, speedLevel, timeSeconds) {
  const shipAudio = audio.ship;
  const now = context.currentTime;
  const targetGain = engineLevel > 0
    ? ENGINE_AUDIO_MAX_GAIN * (0.45 + engineLevel * 0.55)
    : 0.0001;
  const filterFrequency = 80 + speedLevel * 210 + Math.sin(timeSeconds * 18) * 7;
  const oscillatorFrequency = 38 + speedLevel * 27 + Math.sin(timeSeconds * 9) * 2;

  setAudioTarget(shipAudio.engineGain.gain, targetGain, now, 0.045);
  setAudioTarget(shipAudio.engineFilter.frequency, filterFrequency, now, 0.055);
  setAudioTarget(shipAudio.engineOscillator.frequency, oscillatorFrequency, now, 0.06);
  setAudioTarget(shipAudio.engineOscillatorGain.gain, engineLevel > 0 ? 0.006 : 0.0001, now, 0.05);
}

function updateMiningAudio(context, active, timeSeconds) {
  const shipAudio = audio.ship;
  const now = context.currentTime;
  const targetGain = active ? MINING_AUDIO_MAX_GAIN : 0.0001;
  const baseFrequency = 310 + Math.sin(timeSeconds * 7.5) * 18;

  setAudioTarget(shipAudio.miningGain.gain, targetGain, now, 0.025);
  shipAudio.miningOscillators.forEach(({ oscillator, ratio }, index) => {
    const wobble = Math.sin(timeSeconds * (5 + index * 1.7) + index * 2.1) * (4 + index * 3);
    setAudioTarget(oscillator.frequency, baseFrequency * ratio + wobble, now, 0.035);
  });
}

function requestCollisionClunk(speed) {
  if (speed < AUDIO_COLLISION_CLUNK_SPEED) {
    return;
  }

  requestLocalClunk(0.45 + (speed - AUDIO_COLLISION_CLUNK_SPEED) / 55);
}

function requestLocalClunk(intensity = 1, timeSeconds = performance.now() / 1000) {
  const context = audio.context;
  if (!audio.unlocked || !context || context.state !== "running") {
    return false;
  }

  if (timeSeconds - audio.lastClunkAtSeconds < AUDIO_CLUNK_COOLDOWN_SECONDS) {
    return false;
  }

  audio.lastClunkAtSeconds = timeSeconds;
  playLocalClunk(context, clamp(intensity, 0.25, 1.6));
  return true;
}

function playLocalClunk(context, intensity) {
  const start = context.currentTime + 0.004;
  const noise = context.createBufferSource();
  const noiseFilter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  const oscillator = context.createOscillator();
  const oscillatorGain = context.createGain();

  noise.buffer = audio.clunkBuffer || createNoiseBuffer(context, 0.14);
  audio.clunkBuffer = noise.buffer;
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(260, start);
  noiseFilter.frequency.exponentialRampToValueAtTime(110, start + 0.11);
  noiseFilter.Q.value = 0.9;
  noiseGain.gain.setValueAtTime(0.0001, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.034 * intensity, start + 0.006);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(155 + intensity * 18, start);
  oscillator.frequency.exponentialRampToValueAtTime(72, start + 0.13);
  oscillatorGain.gain.setValueAtTime(0.0001, start);
  oscillatorGain.gain.exponentialRampToValueAtTime(0.025 * intensity, start + 0.006);
  oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(context.destination);
  oscillator.connect(oscillatorGain);
  oscillatorGain.connect(context.destination);
  noise.start(start);
  noise.stop(start + 0.15);
  oscillator.start(start);
  oscillator.stop(start + 0.16);
}

function createNoiseBuffer(context, seconds) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }

  return buffer;
}

function setAudioTarget(param, value, time, timeConstant) {
  param.setTargetAtTime(Math.max(0.0001, value), time, timeConstant);
}

function readInput() {
  state.inputSeq += 1;
  const player = predictedLocalPlayer() || localPlayerFromSnapshot();
  const aimAngle = inputAimAngleForPlayer(player);
  if (state.chat.active || isInputBlocked()) {
    return normalizeInput({
      sessionId: inputSessionId,
      seq: state.inputSeq,
      moveX: 0,
      moveY: 0,
      aimAngle,
      mining: false,
      huckRock: false,
      huckRockTargetX: null,
      huckRockTargetY: null,
      interact: false,
      build: false
    });
  }

  const move = readMoveVector();
  const huckRock = readHuckRockInput();
  const huckRockTarget = huckRock
    ? huckRockTargetForPlayer(player)
    : null;

  return normalizeInput({
    sessionId: inputSessionId,
    seq: state.inputSeq,
    moveX: move.x,
    moveY: move.y,
    aimAngle,
    mining: activeRoomMiningInputAllowed(),
    huckRock,
    huckRockTargetX: huckRockTarget?.x ?? null,
    huckRockTargetY: huckRockTarget?.y ?? null,
    interact: false,
    build: false
  });
}

function readHuckRockInput() {
  if (!huckRockInputAllowed()) {
    return false;
  }

  const now = performance.now() / 1000;
  if (now >= state.nextHuckRockThunkAtSeconds) {
    requestHuckRockThunk();
    state.nextHuckRockThunkAtSeconds = now + ENGINE.huckRock.fireIntervalSeconds;
  }

  return true;
}

function huckRockInputAllowed() {
  const roomState = state.room?.state;
  const controllerHuck = state.controller.connected && state.controller.huckRock;
  const keyboardHuck = keys.has("Space");
  if (
    (!keyboardHuck && !controllerHuck) ||
    (!controllerHuck && !hasMousePointer()) ||
    (roomState !== "waiting" && roomState !== "active") ||
    state.upgrades.active ||
    state.build.active
  ) {
    return false;
  }

  if (roomState === "active") {
    if (!localPlayerCanUseCombat()) {
      return false;
    }

    const player = localPlayerFromSnapshot();
    if ((player?.resources?.rock || 0) < (ENGINE.huckRock.costRock || 0)) {
      flashRockHud();
      return false;
    }
  }

  return true;
}

function huckRockTargetForPlayer(player) {
  if (!player) {
    return null;
  }

  if (state.controller.connected) {
    return controllerAimTargetForPlayer(player);
  }

  const aim = activeAimFramePoint();
  return lensScreenPointToWorld(player, aim.x, aim.y, aim);
}

function physicalMiningInputActive() {
  return (state.mouse.down && hasMousePointer()) || controllerMiningActive();
}

function activeRoomMiningInputAllowed() {
  return state.room?.state === "active" &&
    localPlayerCanUseCombat() &&
    physicalMiningInputActive() &&
    !state.chat.active &&
    !state.upgrades.active &&
    !state.build.active &&
    !isInputBlocked();
}

function localPlayerCanUseCombat() {
  return state.room?.state === "active" && !isLocalPlayerEliminated();
}

function controllerMiningActive() {
  return state.controller.connected && state.controller.mining && !state.controller.cursor.visible;
}

function controllerAimTargetForPlayer(player) {
  const angle = controllerAimAngleForPlayer(player);
  const distance = ENGINE.mining.rayLength * CONTROLLER_HUCK_TARGET_RAY_MULTIPLIER;
  return {
    x: player.x + Math.cos(angle) * distance,
    y: player.y + Math.sin(angle) * distance
  };
}

function playerMiningRayRange(player) {
  const effects = aggregateUpgradeEffects(player?.upgrades);
  const shipRadius = Number(player?.radius ?? ENGINE.ship.radius) || 0;
  return shipRadius + ENGINE.mining.rayLength + effects.rayLengthBonus;
}

function huckRockLaunchAngleForPlayer(player, targetX, targetY) {
  const fallbackAngle = player.aimAngle ?? player.angle;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    return fallbackAngle;
  }

  return inheritedVelocityLaunchAngle({
    originX: player.x,
    originY: player.y,
    inheritedVx: player.vx || 0,
    inheritedVy: player.vy || 0,
    targetX,
    targetY,
    launchSpeed: ENGINE.huckRock.speed,
    spawnOffset: ENGINE.huckRock.spawnOffset,
    fallbackAngle
  });
}

function applyHuckRockRecoil(player, direction) {
  const impulse = huckRockRecoilImpulse(player);
  player.vx -= direction.x * impulse;
  player.vy -= direction.y * impulse;
}

function applyShipFriction(player, dtSeconds) {
  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const friction = Math.pow(ENGINE.ship.friction, dtSeconds / fixedStepSeconds);
  player.vx *= friction;
  player.vy *= friction;
}

function applyThrusterAcceleration(player, move, effects, dtSeconds) {
  player.vx += move.x * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
  player.vy += move.y * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
}

function updateShipFacing(player, move, dtSeconds) {
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  if (!hasMoveIntent) {
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    clearPendingFacing(player);
    return;
  }

  const signX = signAxis(move.x);
  const signY = signAxis(move.y);
  if (
    player.pendingFacingSeconds > 0 &&
    player.pendingFacingSignX === signX &&
    player.pendingFacingSignY === signY
  ) {
    player.pendingFacingSeconds = Math.max(0, player.pendingFacingSeconds - dtSeconds);
    player.facingMoveX = move.x;
    player.facingMoveY = move.y;
    if (player.pendingFacingSeconds > 0.000001) {
      return;
    }
  } else {
    clearPendingFacing(player);
  }

  const previousSignX = signAxis(player.facingMoveX);
  const previousSignY = signAxis(player.facingMoveY);
  if (shouldDelayFacingUpdate(previousSignX, previousSignY, signX, signY)) {
    player.pendingFacingSignX = signX;
    player.pendingFacingSignY = signY;
    player.pendingFacingSeconds = Math.max(0, ENGINE.ship.directionKeyGraceSeconds - dtSeconds);
    player.facingMoveX = move.x;
    player.facingMoveY = move.y;
    if (player.pendingFacingSeconds > 0.000001) {
      return;
    }
  }

  player.angle = normalizeAngle(Math.atan2(move.y, move.x));
  player.facingMoveX = move.x;
  player.facingMoveY = move.y;
}

function shouldDelayFacingUpdate(previousSignX, previousSignY, signX, signY) {
  const previousWasDiagonal = previousSignX !== 0 && previousSignY !== 0;
  const previousWasIdle = previousSignX === 0 && previousSignY === 0;
  const currentIsCardinal = (signX !== 0) !== (signY !== 0);
  const keptOneDiagonalAxis =
    (signX !== 0 && signX === previousSignX) ||
    (signY !== 0 && signY === previousSignY);
  return currentIsCardinal && (
    previousWasIdle ||
    (previousWasDiagonal && keptOneDiagonalAxis)
  );
}

function clearPendingFacing(player) {
  player.pendingFacingSignX = 0;
  player.pendingFacingSignY = 0;
  player.pendingFacingSeconds = 0;
}

function signAxis(value) {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}

function huckRockRecoilImpulse(player) {
  const config = ENGINE.huckRock;
  const rockMass = config.radius * config.radius;
  const shipRadius = Math.max(0.1, player.radius || ENGINE.ship.radius);
  const shipMass = shipRadius * shipRadius * (config.shipMassScale || 1);
  const hitImpulse = ((1 + config.restitution) * config.speed) /
    ((1 / rockMass) + (1 / shipMass));
  return (hitImpulse / shipMass) * (config.recoilImpulseScale ?? 1);
}

function readMoveVector() {
  const keyboardX = axis("KeyD", "ArrowRight", "KeyA", "ArrowLeft");
  const keyboardY = axis("KeyS", "ArrowDown", "KeyW", "ArrowUp");
  const controllerMove = controllerShipMoveVector();
  const x = keyboardX + controllerMove.x;
  const y = keyboardY + controllerMove.y;
  const magnitude = Math.hypot(x, y);

  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: x / magnitude,
    y: y / magnitude
  };
}

function controllerShipMoveVector() {
  if (!state.controller.connected) {
    return { x: 0, y: 0 };
  }

  return state.controller.cursor.visible
    ? { x: 0, y: 0 }
    : state.controller.move;
}

function isMovementKey(code) {
  return ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(code);
}

function reconcilePrediction(snapshot, timeSeconds) {
  const authoritative = snapshot.players.find((candidate) => candidate.id === state.playerId);
  if (!authoritative || !authoritative.alive) {
    state.prediction.player = null;
    state.prediction.huckRockCooldownSeconds = 0;
    clearPredictedHuckRocks();
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  if (!state.prediction.player || state.prediction.player.id !== authoritative.id) {
    state.prediction.player = resetPredictedFacingState(authoritative);
    state.prediction.huckRockCooldownSeconds = Number(authoritative.huckRockCooldownSeconds) || 0;
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  const predicted = state.prediction.player;
  const dx = authoritative.x - predicted.x;
  const dy = authoritative.y - predicted.y;
  const distance = Math.hypot(dx, dy);

  if (distance > PREDICTION_SNAP_DISTANCE) {
    state.prediction.player = resetPredictedFacingState(authoritative);
    state.prediction.huckRockCooldownSeconds = Number(authoritative.huckRockCooldownSeconds) || 0;
    state.prediction.lastTimeSeconds = timeSeconds;
    return;
  }

  state.prediction.huckRockCooldownSeconds = Math.max(
    state.prediction.huckRockCooldownSeconds,
    Number(authoritative.huckRockCooldownSeconds) || 0
  );

  state.prediction.player = {
    ...authoritative,
    x: predicted.x + dx * PREDICTION_POSITION_CORRECTION,
    y: predicted.y + dy * PREDICTION_POSITION_CORRECTION,
    vx: predicted.vx + (authoritative.vx - predicted.vx) * PREDICTION_VELOCITY_CORRECTION,
    vy: predicted.vy + (authoritative.vy - predicted.vy) * PREDICTION_VELOCITY_CORRECTION,
    angle: predicted.angle,
    facingMoveX: predicted.facingMoveX,
    facingMoveY: predicted.facingMoveY,
    pendingFacingSignX: predicted.pendingFacingSignX,
    pendingFacingSignY: predicted.pendingFacingSignY,
    pendingFacingSeconds: predicted.pendingFacingSeconds,
    aimAngle: isInputBlocked()
      ? predicted.aimAngle
      : inputAimAngleForPlayer(predicted),
    mining: activeRoomMiningInputAllowed()
  };
}

function resetPredictedFacingState(player) {
  return {
    ...player,
    facingMoveX: 0,
    facingMoveY: 0,
    pendingFacingSignX: 0,
    pendingFacingSignY: 0,
    pendingFacingSeconds: 0
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

  const move = state.chat.active || isInputBlocked()
    ? { x: 0, y: 0 }
    : readMoveVector();
  const effects = aggregateUpgradeEffects(predicted.upgrades);
  predicted.huckRockEngineCutoutSeconds = 0;
  applyShipFriction(predicted, dtSeconds);
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  const canThrust = hasMoveIntent;

  updateShipFacing(predicted, move, dtSeconds);

  if (canThrust) {
    applyThrusterAcceleration(predicted, move, effects, dtSeconds);
  }

  if (!isInputBlocked()) {
    predicted.aimAngle = inputAimAngleForPlayer(predicted);
  }
  predicted.mining = activeRoomMiningInputAllowed();
  if (predicted.mining) {
    predicted.miningHoldSeconds = (predicted.miningHoldSeconds || 0) + dtSeconds;
  } else {
    predicted.miningHoldSeconds = 0;
  }
  predicted.rayExtension = miningRayExtension(predicted.mining, predicted.miningHoldSeconds);
  predicted.thrusting = canThrust;

  applyPredictedHuckRockRecoil(predicted, dtSeconds, timeSeconds);
  predicted.x += predicted.vx * dtSeconds;
  predicted.y += predicted.vy * dtSeconds;
  resolvePredictionCollisions(predicted);
}

function predictedLocalPlayer() {
  const predicted = state.prediction.player;
  const authoritative = localPlayerFromSnapshot();
  if (!predicted || !authoritative || !authoritative.alive) {
    return null;
  }

  const predictionDx = predicted.x - authoritative.x;
  const predictionDy = predicted.y - authoritative.y;

  return {
    ...authoritative,
    x: predicted.x,
    y: predicted.y,
    vx: predicted.vx,
    vy: predicted.vy,
    angle: predicted.angle,
    aimAngle: predicted.aimAngle,
    mining: predicted.mining,
    miningRay: predicted.mining
      ? translateMiningRay(authoritative.miningRay, predictionDx, predictionDy)
      : null,
    miningHoldSeconds: predicted.miningHoldSeconds,
    rayExtension: predicted.rayExtension,
    huckRockCooldownSeconds: state.prediction.huckRockCooldownSeconds,
    huckRockEngineCutoutSeconds: predicted.huckRockEngineCutoutSeconds,
    thrusting: predicted.thrusting
  };
}

function translateMiningRay(miningRay, dx, dy) {
  if (!miningRay) {
    return null;
  }

  return {
    ...miningRay,
    startX: translateNumber(miningRay.startX, dx),
    startY: translateNumber(miningRay.startY, dy),
    endX: translateNumber(miningRay.endX, dx),
    endY: translateNumber(miningRay.endY, dy),
    fullEndX: translateNumber(miningRay.fullEndX, dx),
    fullEndY: translateNumber(miningRay.fullEndY, dy),
    lanes: Array.isArray(miningRay.lanes)
      ? miningRay.lanes.map((lane) => translateMiningRay(lane, dx, dy))
      : miningRay.lanes
  };
}

function translateNumber(value, delta) {
  return Number.isFinite(value) ? value + delta : value;
}

function applyPredictedHuckRockRecoil(predicted, dtSeconds, timeSeconds) {
  state.prediction.huckRockCooldownSeconds = Math.max(
    0,
    state.prediction.huckRockCooldownSeconds - dtSeconds
  );

  if (!huckRockInputAllowed() || state.prediction.huckRockCooldownSeconds > 0) {
    return;
  }

  const target = huckRockTargetForPlayer(predicted);
  const angle = huckRockLaunchAngleForPlayer(predicted, target?.x, target?.y);
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  spawnPredictedHuckRock(predicted, direction, timeSeconds);
  applyHuckRockRecoil(predicted, direction);
  predicted.huckRockEngineCutoutSeconds = 0;
  state.prediction.huckRockCooldownSeconds = ENGINE.huckRock.fireIntervalSeconds;
}

function spawnPredictedHuckRock(player, direction, timeSeconds) {
  const config = ENGINE.huckRock;
  const id = `predicted-huck-rock:${state.playerId}:${state.prediction.huckRockSeq}`;
  state.prediction.huckRockSeq += 1;
  const random = createSeededRandom(`${state.clientId}:${id}`);
  state.prediction.huckRocks.push({
    id,
    type: "huckRock",
    predicted: true,
    ownerId: state.playerId,
    shapeSeed: `${state.clientId}:${id}:shape`,
    x: player.x + direction.x * config.spawnOffset,
    y: player.y + direction.y * config.spawnOffset,
    vx: (player.vx || 0) + direction.x * config.speed,
    vy: (player.vy || 0) + direction.y * config.speed,
    radius: config.radius,
    angleX: random() * Math.PI * 2,
    angleY: random() * Math.PI * 2,
    angleZ: random() * Math.PI * 2,
    spinX: (random() - 0.5) * 2.2,
    spinY: (random() - 0.5) * 2.2,
    spinZ: (random() - 0.5) * 1.2,
    bounceCount: 0,
    ageSeconds: 0,
    createdAtSeconds: timeSeconds,
    lastTimeSeconds: timeSeconds,
    hidden: false
  });
}

function renderSnapshot(timeSeconds) {
  if (!state.snapshot) {
    return null;
  }

  updateEntitySmoothing(timeSeconds);
  updatePredictedHuckRocks(timeSeconds);
  const sourceEntities = Array.isArray(state.snapshot.entities) ? state.snapshot.entities : [];
  const entities = [];
  for (const entity of sourceEntities) {
    const tracked = state.entitySmoothing.byId.get(entity.id);
    if (!tracked) {
      entities.push(entity);
      continue;
    }

    if (!tracked.hidden) {
      entities.push(renderEntityForFrame(entity, tracked.render));
    }
  }

  for (const rock of state.prediction.huckRocks) {
    if (!rock.hidden) {
      entities.push(renderEntityForFrame(rock, rock));
    }
  }

  return {
    ...state.snapshot,
    entities
  };
}

function updatePredictedHuckRocks(timeSeconds) {
  const rocks = [];

  for (const rock of state.prediction.huckRocks) {
    if (rock.hidden || timeSeconds - rock.createdAtSeconds > 0.75) {
      continue;
    }

    const dtSeconds = clamp(timeSeconds - rock.lastTimeSeconds, 0, 1 / 15);
    rock.lastTimeSeconds = timeSeconds;
    if (dtSeconds > 0) {
      advanceRenderEntity(rock, dtSeconds);
      const tracked = { render: rock, hidden: false };
      resolveRenderHuckRockTerrain(tracked);
      rock.hidden = tracked.hidden;
    }

    if (!rock.hidden) {
      rocks.push(rock);
    }
  }

  state.prediction.huckRocks = rocks;
}

function takePredictedHuckRockForEntity(entity, timeSeconds) {
  if (
    entity?.type !== "huckRock" ||
    entity.fragment ||
    entity.ownerId !== state.playerId ||
    state.prediction.huckRocks.length === 0
  ) {
    return null;
  }

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < state.prediction.huckRocks.length; index += 1) {
    const rock = state.prediction.huckRocks[index];
    const ageDelta = Math.abs((Number(entity.ageSeconds) || 0) - (rock.ageSeconds || 0));
    if (rock.hidden || timeSeconds - rock.createdAtSeconds > 0.9 || ageDelta > 0.45) {
      continue;
    }

    const distance = Math.hypot((entity.x || 0) - rock.x, (entity.y || 0) - rock.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex < 0 || bestDistance > 96) {
    return null;
  }

  const [rock] = state.prediction.huckRocks.splice(bestIndex, 1);
  return cloneRenderEntity({
    ...entity,
    x: rock.x,
    y: rock.y,
    vx: rock.vx,
    vy: rock.vy,
    angleX: rock.angleX,
    angleY: rock.angleY,
    angleZ: rock.angleZ,
    spinX: rock.spinX,
    spinY: rock.spinY,
    spinZ: rock.spinZ,
    ageSeconds: rock.ageSeconds
  });
}

function clearPredictedHuckRocks() {
  state.prediction.huckRocks = [];
}

function recordEntitySnapshot(snapshot, timeSeconds) {
  const entities = Array.isArray(snapshot.entities) ? snapshot.entities : [];
  const seen = new Set();

  for (const entity of entities) {
    if (!entity?.id || !shouldSmoothEntity(entity)) {
      continue;
    }

    seen.add(entity.id);
    const target = cloneRenderEntity(entity);
    const tracked = state.entitySmoothing.byId.get(entity.id);

    if (!tracked || tracked.type !== entity.type || tracked.fragment !== Boolean(entity.fragment)) {
      const predictedMatch = takePredictedHuckRockForEntity(entity, timeSeconds);
      state.entitySmoothing.byId.set(entity.id, {
        type: entity.type,
        fragment: Boolean(entity.fragment),
        render: predictedMatch || cloneRenderEntity(entity),
        target,
        lastRenderTimeSeconds: timeSeconds,
        targetReceivedAtSeconds: timeSeconds,
        hidden: false
      });
      continue;
    }

    tracked.target = target;
    tracked.targetReceivedAtSeconds = timeSeconds;
    tracked.hidden = false;

    const dx = target.x - tracked.render.x;
    const dy = target.y - tracked.render.y;
    if (Math.hypot(dx, dy) > ENTITY_SNAP_DISTANCE) {
      tracked.render = cloneRenderEntity(entity);
      tracked.lastRenderTimeSeconds = timeSeconds;
    }
  }

  for (const id of state.entitySmoothing.byId.keys()) {
    if (!seen.has(id)) {
      state.entitySmoothing.byId.delete(id);
    }
  }
}

function updateEntitySmoothing(timeSeconds) {
  for (const tracked of state.entitySmoothing.byId.values()) {
    const dtSeconds = clamp(timeSeconds - tracked.lastRenderTimeSeconds, 0, 1 / 15);
    tracked.lastRenderTimeSeconds = timeSeconds;
    if (dtSeconds > 0) {
      advanceRenderEntity(tracked.render, dtSeconds);
    }

    reconcileRenderEntity(tracked, timeSeconds, dtSeconds);

    if (tracked.render.type === "huckRock") {
      resolveRenderHuckRockTerrain(tracked);
    }
  }
}

function advanceRenderEntity(entity, dtSeconds) {
  entity.previousX = entity.x;
  entity.previousY = entity.y;
  entity.x += (entity.vx || 0) * dtSeconds;
  entity.y += (entity.vy || 0) * dtSeconds;
  entity.angleX = normalizeAngle((entity.angleX || 0) + (entity.spinX || 0) * dtSeconds);
  entity.angleY = normalizeAngle((entity.angleY || 0) + (entity.spinY || 0) * dtSeconds);
  entity.angleZ = normalizeAngle((entity.angleZ || 0) + (entity.spinZ || 0) * dtSeconds);
  entity.ageSeconds = (entity.ageSeconds || 0) + dtSeconds;
}

function reconcileRenderEntity(tracked, timeSeconds, dtSeconds) {
  const leadSeconds = clamp(
    timeSeconds - tracked.targetReceivedAtSeconds,
    0,
    ENTITY_MAX_EXTRAPOLATION_SECONDS
  );
  const projected = projectRenderEntity(tracked.target, leadSeconds);
  const dx = projected.x - tracked.render.x;
  const dy = projected.y - tracked.render.y;

  if (Math.hypot(dx, dy) > ENTITY_SNAP_DISTANCE) {
    tracked.render = projected;
    tracked.hidden = false;
    return;
  }

  const positionAlpha = frameAlpha(ENTITY_POSITION_CORRECTION, dtSeconds);
  const velocityAlpha = frameAlpha(ENTITY_VELOCITY_CORRECTION, dtSeconds);
  tracked.render.x += dx * positionAlpha;
  tracked.render.y += dy * positionAlpha;
  tracked.render.vx += ((projected.vx || 0) - (tracked.render.vx || 0)) * velocityAlpha;
  tracked.render.vy += ((projected.vy || 0) - (tracked.render.vy || 0)) * velocityAlpha;
  reconcileAngleField(tracked.render, projected, "angleX", positionAlpha);
  reconcileAngleField(tracked.render, projected, "angleY", positionAlpha);
  reconcileAngleField(tracked.render, projected, "angleZ", positionAlpha);
  tracked.render.spinX += ((projected.spinX || 0) - (tracked.render.spinX || 0)) * velocityAlpha;
  tracked.render.spinY += ((projected.spinY || 0) - (tracked.render.spinY || 0)) * velocityAlpha;
  tracked.render.spinZ += ((projected.spinZ || 0) - (tracked.render.spinZ || 0)) * velocityAlpha;
  tracked.render.ageSeconds += ((projected.ageSeconds || 0) - (tracked.render.ageSeconds || 0)) * positionAlpha;
}

function reconcileAngleField(render, target, field, alpha) {
  const current = Number(render[field]) || 0;
  const next = Number(target[field]) || 0;
  render[field] = normalizeAngle(current + normalizeSignedAngle(next - current) * alpha);
}

function projectRenderEntity(entity, seconds) {
  const projected = cloneRenderEntity(entity);
  projected.x += (projected.vx || 0) * seconds;
  projected.y += (projected.vy || 0) * seconds;
  projected.angleX = normalizeAngle((projected.angleX || 0) + (projected.spinX || 0) * seconds);
  projected.angleY = normalizeAngle((projected.angleY || 0) + (projected.spinY || 0) * seconds);
  projected.angleZ = normalizeAngle((projected.angleZ || 0) + (projected.spinZ || 0) * seconds);
  projected.ageSeconds = (projected.ageSeconds || 0) + seconds;
  return projected;
}

function resolveRenderHuckRockTerrain(tracked) {
  const rock = tracked.render;
  if (!state.asteroid) {
    return;
  }

  const hit = nearestRenderHuckRockAsteroidHit(rock, rock.previousX ?? rock.x, rock.previousY ?? rock.y);
  if (!hit) {
    return;
  }

  if (rock.fragment || hit.destroy) {
    tracked.hidden = true;
    return;
  }

  bounceRenderHuckRock(rock, hit);
}

function nearestRenderHuckRockAsteroidHit(rock, previousX, previousY) {
  const options = { blockNonPlayable: !state.asteroid?.storm };
  const blockers = blockingTilesAlongSegment(
    state.asteroid,
    previousX,
    previousY,
    rock.x,
    rock.y,
    rock.radius,
    options
  );
  const seen = new Set();
  let nearest = null;
  let buried = false;

  for (const blocker of blockers) {
    const key = blocker.key ?? `${blocker.tileX}:${blocker.tileY}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const hit = sweptCircleBlockerHit(
      previousX,
      previousY,
      rock.x,
      rock.y,
      rock.radius,
      blocker
    ) || circleBlockerOverlap(rock, blocker);
    if (!hit) {
      continue;
    }

    if (!isExposedRenderBlockFace(blocker, hit, options)) {
      buried = true;
      continue;
    }

    if (nearest && hitTime(hit) >= hitTime(nearest)) {
      continue;
    }

    nearest = hit;
  }

  return nearest || (buried ? { destroy: true } : null);
}

function isExposedRenderBlockFace(blocker, hit, options = {}) {
  const normalX = Math.abs(hit.normalX) >= Math.abs(hit.normalY) ? Math.sign(hit.normalX) : 0;
  const normalY = normalX === 0 ? Math.sign(hit.normalY) : 0;
  if (normalX === 0 && normalY === 0) {
    return true;
  }

  return !isBlockingRenderTile(blocker.tileX + normalX, blocker.tileY + normalY, options);
}

function isBlockingRenderTile(tileX, tileY, options = {}) {
  const asteroid = state.asteroid;
  if (!asteroid || tileX < 0 || tileY < 0 || tileX >= asteroid.widthTiles || tileY >= asteroid.heightTiles) {
    return options.blockNonPlayable !== false;
  }

  const index = tileY * asteroid.widthTiles + tileX;
  return isAsteroidRockTile(asteroid.tiles[index]) ||
    (options.blockNonPlayable !== false && !(asteroid.playable[index] === true || asteroid.playable[index] === "1"));
}

function bounceRenderHuckRock(rock, hit) {
  if (Number.isFinite(hit.x) && Number.isFinite(hit.y)) {
    rock.x = hit.x + hit.normalX * 0.01;
    rock.y = hit.y + hit.normalY * 0.01;
  } else {
    rock.x += hit.normalX * hit.overlap;
    rock.y += hit.normalY * hit.overlap;
  }

  const normalSpeed = rock.vx * hit.normalX + rock.vy * hit.normalY;
  if (normalSpeed < 0) {
    rock.vx -= (1 + ENGINE.huckRock.restitution) * normalSpeed * hit.normalX;
    rock.vy -= (1 + ENGINE.huckRock.restitution) * normalSpeed * hit.normalY;
  }
}

function renderEntityForFrame(authoritative, render) {
  return {
    ...authoritative,
    x: render.x,
    y: render.y,
    vx: render.vx,
    vy: render.vy,
    angleX: render.angleX,
    angleY: render.angleY,
    angleZ: render.angleZ,
    spinX: render.spinX,
    spinY: render.spinY,
    spinZ: render.spinZ,
    ageSeconds: render.ageSeconds
  };
}

function shouldSmoothEntity(entity) {
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) {
    return false;
  }

  return Number.isFinite(entity.vx) ||
    Number.isFinite(entity.vy) ||
    Number.isFinite(entity.spinX) ||
    Number.isFinite(entity.spinY) ||
    Number.isFinite(entity.spinZ);
}

function cloneRenderEntity(entity) {
  return {
    ...entity,
    x: Number(entity.x) || 0,
    y: Number(entity.y) || 0,
    vx: Number(entity.vx) || 0,
    vy: Number(entity.vy) || 0,
    angleX: Number(entity.angleX) || 0,
    angleY: Number(entity.angleY) || 0,
    angleZ: Number(entity.angleZ) || 0,
    spinX: Number(entity.spinX) || 0,
    spinY: Number(entity.spinY) || 0,
    spinZ: Number(entity.spinZ) || 0,
    ageSeconds: Number(entity.ageSeconds) || 0
  };
}

function frameAlpha(perTickAlpha, dtSeconds) {
  if (dtSeconds <= 0) {
    return 0;
  }

  return 1 - Math.pow(1 - perTickAlpha, dtSeconds * ENGINE.tickRate);
}

function resetEntitySmoothing() {
  state.entitySmoothing.byId.clear();
}

function resolvePredictionCollisions(player) {
  resolvePredictionAsteroidCollisions(player);
  resolvePredictionPlayerCollisions(player);
}

function resolvePredictionAsteroidCollisions(player) {
  if (!state.asteroid) {
    return;
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let resolved = false;
    const blockers = blockingTilesNearCircle(state.asteroid, player.x, player.y, player.radius, {
      blockNonPlayable: !state.asteroid.storm
    });

    for (const blocker of blockers) {
      const hit = circleBlockerOverlap(player, blocker);
      if (!hit) {
        continue;
      }

      player.x += hit.normalX * hit.overlap;
      player.y += hit.normalY * hit.overlap;

      const normalSpeed = player.vx * hit.normalX + player.vy * hit.normalY;
      if (normalSpeed < 0) {
        requestCollisionClunk(-normalSpeed);
        player.vx -= (1 + ENGINE.collision.boundaryRestitution) * normalSpeed * hit.normalX;
        player.vy -= (1 + ENGINE.collision.boundaryRestitution) * normalSpeed * hit.normalY;
      }

      resolved = true;
    }

    if (!resolved) {
      break;
    }
  }
}

function resolvePredictionPlayerCollisions(player) {
  if (!state.snapshot) {
    return;
  }

  for (const other of state.snapshot.players) {
    if (!other.alive || other.id === player.id) {
      continue;
    }

    const dx = player.x - other.x;
    const dy = player.y - other.y;
    const minDistance = (player.radius || ENGINE.ship.radius) + (other.radius || ENGINE.ship.radius);
    const distance = Math.hypot(dx, dy);
    if (distance >= minDistance) {
      continue;
    }

    const normalX = distance > 0 ? dx / distance : Math.cos((player.number || 1) * 2.399);
    const normalY = distance > 0 ? dy / distance : Math.sin((player.number || 1) * 2.399);
    const overlap = minDistance - distance;
    player.x += normalX * overlap;
    player.y += normalY * overlap;

    const normalSpeed = player.vx * normalX + player.vy * normalY;
    if (normalSpeed < 0) {
      requestCollisionClunk(-normalSpeed);
      player.vx -= (1 + ENGINE.collision.shipRestitution) * normalSpeed * normalX;
      player.vy -= (1 + ENGINE.collision.shipRestitution) * normalSpeed * normalY;
    }
  }
}

function circleTileOverlap(circle, tile) {
  const tileRight = tile.x + tile.size;
  const tileBottom = tile.y + tile.size;
  const closestX = clamp(circle.x, tile.x, tileRight);
  const closestY = clamp(circle.y, tile.y, tileBottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const distanceSq = dx * dx + dy * dy;

  if (distanceSq > 0) {
    if (distanceSq >= circle.radius * circle.radius) {
      return null;
    }

    const distance = Math.sqrt(distanceSq);
    return {
      normalX: dx / distance,
      normalY: dy / distance,
      overlap: circle.radius - distance
    };
  }

  const left = circle.x - tile.x;
  const right = tileRight - circle.x;
  const top = circle.y - tile.y;
  const bottom = tileBottom - circle.y;
  const nearest = Math.min(left, right, top, bottom);

  if (nearest === left) {
    return { normalX: -1, normalY: 0, overlap: circle.radius + left };
  }

  if (nearest === right) {
    return { normalX: 1, normalY: 0, overlap: circle.radius + right };
  }

  if (nearest === top) {
    return { normalX: 0, normalY: -1, overlap: circle.radius + top };
  }

  return { normalX: 0, normalY: 1, overlap: circle.radius + bottom };
}

function circleRectOverlap(circle, rect) {
  return circleBoundsOverlap(circle, rect.x, rect.y, rect.width, rect.height);
}

function circleBoundsOverlap(circle, x, y, width, height) {
  const right = x + width;
  const bottom = y + height;
  const closestX = clamp(circle.x, x, right);
  const closestY = clamp(circle.y, y, bottom);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  const distanceSq = dx * dx + dy * dy;

  if (distanceSq > 0) {
    if (distanceSq >= circle.radius * circle.radius) {
      return null;
    }

    const distance = Math.sqrt(distanceSq);
    return {
      normalX: dx / distance,
      normalY: dy / distance,
      overlap: circle.radius - distance
    };
  }

  const left = circle.x - x;
  const rightDistance = right - circle.x;
  const top = circle.y - y;
  const bottomDistance = bottom - circle.y;
  const nearest = Math.min(left, rightDistance, top, bottomDistance);

  if (nearest === left) {
    return { normalX: -1, normalY: 0, overlap: circle.radius + left };
  }

  if (nearest === rightDistance) {
    return { normalX: 1, normalY: 0, overlap: circle.radius + rightDistance };
  }

  if (nearest === top) {
    return { normalX: 0, normalY: -1, overlap: circle.radius + top };
  }

  return { normalX: 0, normalY: 1, overlap: circle.radius + bottomDistance };
}

function circleCircleOverlap(circle, target) {
  const radius = circle.radius + (target.radius || 0);
  const dx = circle.x - target.x;
  const dy = circle.y - target.y;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq >= radius * radius) {
    return null;
  }

  const distance = Math.sqrt(distanceSq) || 1;
  return {
    normalX: dx / distance,
    normalY: dy / distance,
    overlap: radius - distance
  };
}

function sweptCircleRectHit(previousX, previousY, x, y, radius, rect) {
  return sweptCircleBoundsHit(previousX, previousY, x, y, radius, rect.x, rect.y, rect.width, rect.height);
}

function sweptCircleBoundsHit(previousX, previousY, x, y, radius, boundsX, boundsY, width, height) {
  const dx = x - previousX;
  const dy = y - previousY;
  const minX = boundsX - radius;
  const minY = boundsY - radius;
  const maxX = boundsX + width + radius;
  const maxY = boundsY + height + radius;
  const axisX = sweptAxisInterval(previousX, dx, minX, maxX);
  const axisY = sweptAxisInterval(previousY, dy, minY, maxY);
  if (!axisX || !axisY) {
    return null;
  }

  const entry = Math.max(axisX.entry, axisY.entry);
  const exit = Math.min(axisX.exit, axisY.exit);
  if (entry > exit || entry < 0 || entry > 1) {
    return null;
  }

  const hitX = previousX + dx * entry;
  const hitY = previousY + dy * entry;
  const normal = axisX.entry > axisY.entry
    ? { x: dx > 0 ? -1 : 1, y: 0 }
    : { x: 0, y: dy > 0 ? -1 : 1 };

  return {
    time: entry,
    x: hitX,
    y: hitY,
    normalX: normal.x,
    normalY: normal.y,
    overlap: 0
  };
}

function sweptAxisInterval(position, delta, min, max) {
  if (Math.abs(delta) < 0.000001) {
    return position >= min && position <= max
      ? { entry: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY }
      : null;
  }

  const t1 = (min - position) / delta;
  const t2 = (max - position) / delta;
  return {
    entry: Math.min(t1, t2),
    exit: Math.max(t1, t2)
  };
}

function sweptCircleCircleHit(previousX, previousY, x, y, radius, target) {
  const targetRadius = target.radius || 0;
  const combinedRadius = radius + targetRadius;
  const dx = x - previousX;
  const dy = y - previousY;
  const sx = previousX - target.x;
  const sy = previousY - target.y;
  const a = dx * dx + dy * dy;
  const c = sx * sx + sy * sy - combinedRadius * combinedRadius;

  if (c <= 0) {
    const distance = Math.hypot(sx, sy);
    const normal = distance > 0
      ? { x: sx / distance, y: sy / distance }
      : { x: -1, y: 0 };
    return {
      time: 0,
      x: previousX,
      y: previousY,
      normalX: normal.x,
      normalY: normal.y,
      overlap: -c
    };
  }

  if (a <= 0.000001) {
    return null;
  }

  const b = 2 * (sx * dx + sy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (time < 0 || time > 1) {
    return null;
  }

  const hitX = previousX + dx * time;
  const hitY = previousY + dy * time;
  const nx = hitX - target.x;
  const ny = hitY - target.y;
  const distance = Math.hypot(nx, ny) || 1;
  return {
    time,
    x: hitX,
    y: hitY,
    normalX: nx / distance,
    normalY: ny / distance,
    overlap: 0
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
  const miniPoint = eventToMiniPlayerPoint(event);
  state.mouse.x = point.x;
  state.mouse.y = point.y;
  state.mouse.miniX = miniPoint.x;
  state.mouse.miniY = miniPoint.y;
  state.mouse.miniInFrame = miniPoint.inFrame;
  state.mouse.inFrame = point.inFrame;
  state.mouse.hasPointer = true;
  updateAimFromSnapshot();
}

function handleRoomUiClick(buttonId) {
  if (!buttonId) {
    return;
  }

  if (buttonId === "leaveSpectating" || buttonId === "leaveEnded" || buttonId === "terminalLeave") {
    leaveCurrentRoom();
    return;
  }

  if (!socket.connected) {
    return;
  }

  if (buttonId === "ready") {
    socket.emit(CLIENT_EVENTS.ready, { button: true });
    return;
  }

  if (buttonId === "start") {
    requestWaitingRoomStart();
    return;
  }

}

function handleWaitingRoomShortcutKey(event) {
  if (state.room?.state !== "waiting" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  if (event.code === "Escape") {
    event.preventDefault();
    leaveCurrentRoom();
    return true;
  }

  if (event.code === "Enter") {
    event.preventDefault();
    requestWaitingRoomStart();
    return true;
  }

  return false;
}

function handleWaitingRoomControllerActions(input) {
  if (state.room?.state !== "waiting") {
    return false;
  }

  if (input.pressed.reset) {
    leaveCurrentRoom();
    return true;
  }

  if (input.pressed.select) {
    requestWaitingRoomStart();
    return true;
  }

  return false;
}

function requestWaitingRoomStart() {
  if (!socket.connected || !canStartWaitingRoom()) {
    return;
  }

  socket.emit(CLIENT_EVENTS.start);
}

function canStartWaitingRoom() {
  if (state.room?.state !== "waiting" || state.room.countdownArmed || !state.room.isHost) {
    return false;
  }

  const playerCount = state.room.players?.length || 0;
  const minPlayers = state.room.minPlayers || ENGINE.lobby.minPlayers || 2;
  return playerCount >= minPlayers;
}

function canLeaveWithControllerReset() {
  return state.room?.state === "ended" ||
    (state.room?.state === "active" && isLocalPlayerEliminated());
}

function handleLeaveShortcut(nowSeconds = performance.now() / 1000) {
  if (!canLeaveWithShortcut()) {
    state.leaveConfirmUntilSeconds = 0;
    return false;
  }

  if (state.room?.state !== "active") {
    state.leaveConfirmUntilSeconds = 0;
    leaveCurrentRoom();
    return true;
  }

  if (state.leaveConfirmUntilSeconds > nowSeconds) {
    return true;
  }

  state.leaveConfirmUntilSeconds = nowSeconds + LEAVE_CONFIRM_SECONDS;
  return true;
}

function confirmLeaveShortcut(nowSeconds = performance.now() / 1000) {
  if (!leaveConfirmIsActive(nowSeconds)) {
    return false;
  }

  state.leaveConfirmUntilSeconds = 0;
  leaveCurrentRoom();
  return true;
}

function leaveConfirmIsActive(nowSeconds = performance.now() / 1000) {
  return state.room?.state === "active" &&
    canLeaveWithShortcut() &&
    state.leaveConfirmUntilSeconds > nowSeconds;
}

function canLeaveWithShortcut() {
  const roomState = state.room?.state;
  if (roomState === "ended" || (roomState === "active" && isLocalPlayerEliminated())) {
    return !state.chat.active;
  }

  return !state.chat.active &&
    !state.upgrades.active &&
    !state.build.active &&
    (roomState === "waiting" || roomState === "active" || roomState === "ended");
}

function leaveCurrentRoom() {
  state.leaveConfirmUntilSeconds = 0;
  if (isLocalBotGame() || state.room?.local) {
    leaveLocalBotGame();
    return;
  }

  if (!socket.connected) {
    return;
  }

  forgetRegisteredRoom();
  socket.emit(CLIENT_EVENTS.leave);
}

function requestPathNamedRoomJoin() {
  const name = pathRoomName();
  if (!name || !socket.connected || state.menu.readySent) {
    return false;
  }

  state.menu.roomNameDraft = name;
  state.menu.readySent = true;
  socket.emit(CLIENT_EVENTS.joinNamedRoom, { name });
  return true;
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
  state.resumePending = true;
  scheduleResumeFallback();
  socket.emit(CLIENT_EVENTS.resume, { roomId, silent });
}

function scheduleResumeFallback() {
  clearResumeFallbackTimer();
  state.resumeFallbackTimer = window.setTimeout(() => {
    if (!state.resumePending) {
      return;
    }

    const room = state.deferredMenuRoom || {
      state: "menu",
      clientId: state.clientId
    };
    state.resumePending = false;
    state.deferredMenuRoom = null;
    state.resumeFallbackTimer = null;
    applyServerRoom(room);
  }, 700);
}

function clearResumeFallbackTimer() {
  if (!state.resumeFallbackTimer) {
    return;
  }

  window.clearTimeout(state.resumeFallbackTimer);
  state.resumeFallbackTimer = null;
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
  if (canLeaveWithControllerReset()) {
    return { terminalLeave: terminalLeaveActionRect() };
  }

  return {};
}

function terminalLeaveActionRect() {
  const ended = state.room?.state === "ended";
  return {
    x: TERMINAL_LEAVE_ACTION.x,
    y: ended ? endedTerminalLeaveActionY() : TERMINAL_LEAVE_ACTION.eliminatedY,
    width: TERMINAL_LEAVE_ACTION.width,
    height: TERMINAL_LEAVE_ACTION.height
  };
}

function endedTerminalLeaveActionY() {
  return TERMINAL_LEAVE_ACTION.endedPanelY +
    endedHudPanelHeight() +
    TERMINAL_LEAVE_ACTION.endedLeaveGap;
}

function endedHudPanelHeight() {
  const rowCount = endedHudResultRowCount();
  const contentBottom = TERMINAL_LEAVE_ACTION.endedRowStartY +
    rowCount * TERMINAL_LEAVE_ACTION.endedRowStep;
  const countdownBottom = Number.isFinite(state.room?.resetToLobbyAtMs)
    ? contentBottom + TERMINAL_LEAVE_ACTION.endedCountdownGap + 8
    : contentBottom;
  return countdownBottom + TERMINAL_LEAVE_ACTION.endedBottomPadding;
}

function endedHudResultRowCount() {
  const snapshotPlayers = Array.isArray(state.snapshot?.players) ? state.snapshot.players : [];
  const roomPlayers = Array.isArray(state.room?.players) ? state.room.players : [];
  return Math.max(1, Math.min(ENGINE.maxPlayers, snapshotPlayers.length || roomPlayers.length || 0));
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
  if (state.upgrades.selectedIndex !== index) {
    state.upgrades.selectedIndex = index;
  }
}

function updateUpgradeSelectionFromControllerDpad(dpad, dtSeconds) {
  if (!state.upgrades.active || !state.controller.connected) {
    resetControllerUpgradeNav();
    return;
  }

  const direction = Math.abs(dpad.y) >= CONTROLLER_DPAD_NAV_THRESHOLD
    ? Math.sign(dpad.y)
    : 0;
  if (direction === 0) {
    resetControllerUpgradeNav();
    return;
  }

  if (direction !== state.controller.upgradeNavDirection) {
    state.controller.upgradeNavDirection = direction;
    state.controller.upgradeNavRepeatSeconds = CONTROLLER_UPGRADE_NAV_INITIAL_DELAY_SECONDS;
    moveUpgradeSelection(direction);
    return;
  }

  state.controller.upgradeNavRepeatSeconds -= dtSeconds;
  while (state.controller.upgradeNavRepeatSeconds <= 0) {
    moveUpgradeSelection(direction);
    state.controller.upgradeNavRepeatSeconds += CONTROLLER_UPGRADE_NAV_REPEAT_SECONDS;
  }
}

function resetControllerUpgradeNav() {
  state.controller.upgradeNavDirection = 0;
  state.controller.upgradeNavRepeatSeconds = 0;
}

function moveUpgradeSelection(direction) {
  const currentIndex = Number.isInteger(state.upgrades.selectedIndex)
    ? state.upgrades.selectedIndex
    : direction > 0 ? -1 : UPGRADE_DEFINITIONS.length;
  state.upgrades.selectedIndex = clamp(
    currentIndex + direction,
    0,
    UPGRADE_DEFINITIONS.length - 1
  );
}

function buySelectedUpgrade() {
  const player = localPlayerFromSnapshot();
  if (!Number.isInteger(state.upgrades.selectedIndex)) {
    return;
  }

  const definition = UPGRADE_DEFINITIONS[state.upgrades.selectedIndex];
  if (!player || !definition) {
    return;
  }

  const cost = nextUpgradeCost(player.upgrades, definition.id);
  if (isLocalBotGame()) {
    if (canAffordUpgrade(player.resources, cost)) {
      purchasePlayerUpgrade(state.localGame.arena, LOCAL_BOT_PLAYER_ID, definition.id);
      syncLocalArenaSnapshot(performance.now() / 1000);
    }
    return;
  }

  if (socket.connected && canAffordUpgrade(player.resources, cost)) {
    socket.emit(CLIENT_EVENTS.upgrade, definition.id);
  }
}

function updateHeldBuild(target, timeSeconds) {
  if (!buildHoldActive()) {
    resetBuildHold();
    return;
  }

  buildWallAtMouse({ target, timeSeconds });
}

function buildHoldActive() {
  if (!state.build.active || state.chat.active || state.upgrades.active || state.room?.state !== "active") {
    return false;
  }

  return state.mouse.down ||
    (state.controller.connected && state.controller.mining);
}

function resetBuildHold() {
  state.build.lastTargetKey = "";
  state.build.nextAttemptSeconds = 0;
}

function buildWallAtMouse(options = {}) {
  const player = predictedLocalPlayer() || localPlayerFromSnapshot();
  if (
    state.build.active &&
    state.room?.state === "active" &&
    (player?.resources?.rock || 0) < ENGINE.build.wallCostRock
  ) {
    flashRockHud();
  }

  const target = options.target || buildTargetFromMouse();
  const targetKey = target ? buildTargetKey(target.tileX, target.tileY) : "";
  const timeSeconds = options.timeSeconds ?? performance.now() / 1000;
  const targetChanged = targetKey && targetKey !== state.build.lastTargetKey;
  if (!options.force && !targetChanged && timeSeconds < state.build.nextAttemptSeconds) {
    return;
  }

  state.build.lastTargetKey = targetKey;
  state.build.nextAttemptSeconds = timeSeconds + BUILD_REPEAT_SECONDS;

  if (!target?.valid) {
    return;
  }

  if (isLocalBotGame()) {
    buildPlayerWall(state.localGame.arena, LOCAL_BOT_PLAYER_ID, {
      tileX: target.tileX,
      tileY: target.tileY
    });
    applyClientAsteroidUpdates(takeAsteroidUpdates(state.localGame.arena));
    syncLocalArenaSnapshot(timeSeconds);
    return;
  }

  if (!socket.connected) {
    return;
  }

  socket.emit(CLIENT_EVENTS.buildWall, {
    tileX: target.tileX,
    tileY: target.tileY
  });
}

function buildTargetKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}

function buildTargetFromMouse() {
  if (
    !state.build.active ||
    state.room?.state !== "active" ||
    !state.asteroid ||
    !state.snapshot
  ) {
    return null;
  }

  const player = predictedLocalPlayer() || localPlayerFromSnapshot();
  if (!player?.alive) {
    return null;
  }

  const angle = buildAngleForPlayer(player);
  if (!Number.isFinite(angle)) {
    return null;
  }

  const tileSize = state.asteroid.tileSize || 16;
  const snappedTile = closestClientBuildTile(player, angle, tileSize);
  if (!snappedTile) {
    return null;
  }

  const { tileX, tileY } = snappedTile;
  const index = tileY * state.asteroid.widthTiles + tileX;
  const affordable = (player.resources?.rock || 0) >= ENGINE.build.wallCostRock;

  return {
    tileX,
    tileY,
    index,
    inRange: true,
    empty: true,
    playable: true,
    clear: true,
    affordable,
    valid: affordable
  };
}

function buildAngleForPlayer(player) {
  if (state.controller.connected && state.build.active && !state.mouse.down) {
    return controllerAimAngleForPlayer(player);
  }

  const aim = activeAimFramePoint();
  const dx = aim.x - aim.width / 2;
  const dy = aim.y - aim.height / 2;
  return dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) : null;
}

function closestClientBuildTile(player, angle, tileSize) {
  return firstTileAlongBuildRay({
    widthTiles: state.asteroid.widthTiles,
    heightTiles: state.asteroid.heightTiles,
    tileSize,
    startX: player.x,
    startY: player.y,
    angle,
    isCandidate(tileX, tileY) {
      return isClientBuildCandidate(player, tileX, tileY, tileSize);
    },
    isBlocked(tileX, tileY) {
      return isClientBuildRayBlocked(tileX, tileY);
    }
  });
}

function isClientBuildCandidate(player, tileX, tileY, tileSize) {
  const index = tileY * state.asteroid.widthTiles + tileX;
  return tileWithinBuildRadius(player, tileX, tileY, tileSize) &&
    state.asteroid.tiles[index] === ASTEROID_TILE.empty &&
    isPlayableBuildIndex(index) &&
    !isStormBuildIndex(index) &&
    !tileOverlapsVisiblePlayer(tileX, tileY, tileSize);
}

function isClientBuildRayBlocked(tileX, tileY) {
  const index = tileY * state.asteroid.widthTiles + tileX;
  return isAsteroidRockTile(state.asteroid.tiles[index]) ||
    !isPlayableBuildIndex(index);
}

function tileWithinBuildRadius(player, tileX, tileY, tileSize) {
  const centerX = (tileX + 0.5) * tileSize;
  const centerY = (tileY + 0.5) * tileSize;
  return Math.hypot(centerX - player.x, centerY - player.y) <= ENGINE.build.radiusTiles * tileSize;
}

function isPlayableBuildIndex(index) {
  return state.asteroid?.playable?.[index] === "1" || state.asteroid?.playable?.[index] === true;
}

function isStormBuildIndex(index) {
  return Number(state.asteroid?.storm?.[index] || STORM_STATE.safe) !== STORM_STATE.safe;
}

function tileOverlapsVisiblePlayer(tileX, tileY, tileSize) {
  const tile = {
    x: tileX * tileSize,
    y: tileY * tileSize,
    size: tileSize
  };
  const predicted = predictedLocalPlayer();

  for (const player of state.snapshot?.players || []) {
    const visiblePlayer = predicted?.id === player.id ? predicted : player;
    if (visiblePlayer.alive && circleTileOverlap(visiblePlayer, tile)) {
      return true;
    }
  }

  return false;
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

  if (!player && (room?.state === "waiting" || room?.state === "active")) {
    return randomAliveSpectatorTargetId({
      id: state.playerId || state.clientId || "spectator",
      eliminatedAtTick: state.snapshot?.tick ?? 0
    }) || firstSnapshotPlayerId() || state.playerId;
  }

  if (!player || player.alive) {
    state.spectatorTargetId = null;
    return state.playerId;
  }

  if (player.killedById) {
    const killer = state.snapshot?.players.find((candidate) => (
      candidate.id === player.killedById && candidate.alive === true
    ));
    if (killer) {
      state.spectatorTargetId = killer.id;
      return killer.id;
    }
  }

  return randomAliveSpectatorTargetId(player) || state.playerId;
}

function randomAliveSpectatorTargetId(eliminatedPlayer) {
  const alivePlayers = (state.snapshot?.players || []).filter((candidate) => candidate.alive === true);
  if (alivePlayers.length <= 0) {
    state.spectatorTargetId = null;
    return null;
  }

  if (alivePlayers.some((candidate) => candidate.id === state.spectatorTargetId)) {
    return state.spectatorTargetId;
  }

  const random = createSeededRandom(
    `${eliminatedPlayer.id}:${eliminatedPlayer.eliminatedAtTick ?? state.snapshot?.tick ?? 0}:spectator`
  );
  state.spectatorTargetId = alivePlayers[Math.floor(random() * alivePlayers.length)]?.id || alivePlayers[0].id;
  return state.spectatorTargetId;
}

function firstSnapshotPlayerId() {
  return state.snapshot?.players?.[0]?.id ?? null;
}

function resetPlayerMap(asteroid = null, roomId = null) {
  if (state.playerMap.dirty) {
    savePlayerMap({ force: true });
  }

  if (!asteroid) {
    state.playerMap = {
      roomId: null,
      asteroidSeed: null,
      widthChunks: 0,
      heightChunks: 0,
      large: state.playerMap.large,
      circle: null,
      baseCells: null,
      fullMapStormMask: null,
      cells: null,
      dirty: false,
      lastSaveAtMs: 0
    };
    return;
  }

  const widthChunks = Math.ceil(asteroid.widthTiles / PLAYER_MAP_CHUNK_TILES);
  const heightChunks = Math.ceil(asteroid.heightTiles / PLAYER_MAP_CHUNK_TILES);
  const asteroidSeed = asteroid.seed || null;
  const cachedMap = loadPlayerMap(roomId, asteroidSeed, widthChunks, heightChunks);
  state.playerMap = {
    roomId: roomId || null,
    asteroidSeed,
    widthChunks,
    heightChunks,
    large: state.playerMap.large,
    circle: buildPlayerMapCircle(asteroid),
    baseCells: cachedMap?.baseCells || buildPlayerMapBaseCells(asteroid, widthChunks, heightChunks),
    fullMapStormMask: buildPlayerMapFullStormMask(asteroid, widthChunks, heightChunks),
    cells: cachedMap?.cells || new Uint8Array(widthChunks * heightChunks).fill(PLAYER_MAP_UNKNOWN),
    dirty: true,
    lastSaveAtMs: 0
  };
}

function loadPlayerMap(roomId, asteroidSeed, widthChunks, heightChunks) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PLAYER_MAP_STORAGE_KEY) || "null");
    if (
      !parsed ||
      parsed.version !== PLAYER_MAP_STORAGE_VERSION ||
      parsed.roomId !== (roomId || null) ||
      parsed.asteroidSeed !== (asteroidSeed || null) ||
      parsed.widthChunks !== widthChunks ||
      parsed.heightChunks !== heightChunks
    ) {
      return null;
    }

    const length = widthChunks * heightChunks;
    const cells = decodePlayerMapCells(parsed.cells, length);
    if (!cells) {
      return null;
    }

    return {
      cells,
      baseCells: decodePlayerMapCells(parsed.baseCells, length),
      circle: playerMapStoredCircle(parsed.circle)
    };
  } catch (error) {
    window.localStorage.removeItem(PLAYER_MAP_STORAGE_KEY);
    return null;
  }
}

function savePlayerMap(options = {}) {
  const map = state.playerMap;
  if (!map.cells || !map.baseCells || !map.roomId) {
    return;
  }

  const now = performance.now();
  if (!options.force && map.lastSaveAtMs > 0 && now - map.lastSaveAtMs < 500) {
    return;
  }

  try {
    window.localStorage.setItem(PLAYER_MAP_STORAGE_KEY, JSON.stringify({
      version: PLAYER_MAP_STORAGE_VERSION,
      roomId: map.roomId,
      asteroidSeed: map.asteroidSeed || null,
      widthChunks: map.widthChunks,
      heightChunks: map.heightChunks,
      circle: map.circle,
      baseCells: encodePlayerMapCells(map.baseCells),
      cells: encodePlayerMapCells(map.cells)
    }));
    map.dirty = false;
    map.lastSaveAtMs = now;
  } catch (error) {
    // The map is a convenience cache; gameplay should not depend on storage being available.
  }
}

function playerMapStoredCircle(circle) {
  if (
    !circle ||
    !Number.isFinite(circle.x) ||
    !Number.isFinite(circle.y) ||
    !Number.isFinite(circle.radius) ||
    circle.radius <= 0
  ) {
    return null;
  }

  return {
    x: circle.x,
    y: circle.y,
    radius: circle.radius
  };
}

function encodePlayerMapCells(cells) {
  let encoded = "";
  for (let index = 0; index < cells.length; index += 1) {
    encoded += playerMapCellCode(cells[index]);
  }
  return encoded;
}

function decodePlayerMapCells(encoded, length) {
  if (typeof encoded !== "string" || encoded.length !== length) {
    return null;
  }

  const cells = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    cells[index] = playerMapCellValue(encoded[index]);
  }
  return cells;
}

function playerMapCellCode(value) {
  switch (value) {
    case PLAYER_MAP_BACKGROUND:
      return "b";
    case PLAYER_MAP_FOREGROUND:
      return "f";
    case PLAYER_MAP_STORM:
      return "s";
    default:
      return "u";
  }
}

function playerMapCellValue(code) {
  switch (code) {
    case "b":
      return PLAYER_MAP_BACKGROUND;
    case "f":
      return PLAYER_MAP_FOREGROUND;
    case "s":
      return PLAYER_MAP_STORM;
    default:
      return PLAYER_MAP_UNKNOWN;
  }
}

function buildPlayerMapCircle(asteroid) {
  const chunkTiles = Math.max(1, PLAYER_MAP_CHUNK_TILES);
  const centerTileX = asteroid.widthTiles / 2;
  const centerTileY = asteroid.heightTiles / 2;
  let radiusTilesSq = 0;
  let hasPlayableTile = false;

  for (let tileY = 0; tileY < asteroid.heightTiles; tileY += 1) {
    for (let tileX = 0; tileX < asteroid.widthTiles; tileX += 1) {
      const index = tileY * asteroid.widthTiles + tileX;
      const playable = asteroid.playable?.[index] === true || asteroid.playable?.[index] === "1";
      if (!playable) {
        continue;
      }

      hasPlayableTile = true;
      for (let cornerY = 0; cornerY <= 1; cornerY += 1) {
        for (let cornerX = 0; cornerX <= 1; cornerX += 1) {
          const dx = tileX + cornerX - centerTileX;
          const dy = tileY + cornerY - centerTileY;
          radiusTilesSq = Math.max(radiusTilesSq, dx * dx + dy * dy);
        }
      }
    }
  }

  return {
    x: centerTileX / chunkTiles,
    y: centerTileY / chunkTiles,
    radius: hasPlayableTile
      ? (Math.sqrt(radiusTilesSq) + PLAYER_MAP_CIRCLE_PADDING_TILES) / chunkTiles
      : Math.min(Math.ceil(asteroid.widthTiles / chunkTiles), Math.ceil(asteroid.heightTiles / chunkTiles)) / 2
  };
}

function buildPlayerMapBaseCells(asteroid, widthChunks, heightChunks) {
  const cells = new Uint8Array(widthChunks * heightChunks);
  for (let chunkY = 0; chunkY < heightChunks; chunkY += 1) {
    for (let chunkX = 0; chunkX < widthChunks; chunkX += 1) {
      cells[chunkY * widthChunks + chunkX] = playerMapChunkValue(asteroid, chunkX, chunkY);
    }
  }
  return cells;
}

function buildPlayerMapFullStormMask(asteroid, widthChunks, heightChunks) {
  const count = widthChunks * heightChunks;
  const playableChunks = new Uint8Array(count);
  const mask = new Uint8Array(count);
  const radiusChunks = Math.max(1, Math.ceil(PLAYER_MAP_FULL_STORM_BAND_TILES / PLAYER_MAP_CHUNK_TILES));
  const radiusSq = radiusChunks * radiusChunks;

  for (let chunkY = 0; chunkY < heightChunks; chunkY += 1) {
    for (let chunkX = 0; chunkX < widthChunks; chunkX += 1) {
      const index = chunkY * widthChunks + chunkX;
      if (playerMapChunkHasPlayableTile(asteroid, chunkX, chunkY)) {
        playableChunks[index] = 1;
      }
    }
  }

  for (let chunkY = 0; chunkY < heightChunks; chunkY += 1) {
    for (let chunkX = 0; chunkX < widthChunks; chunkX += 1) {
      const index = chunkY * widthChunks + chunkX;
      if (!playableChunks[index]) {
        continue;
      }

      for (let offsetY = -radiusChunks; offsetY <= radiusChunks; offsetY += 1) {
        for (let offsetX = -radiusChunks; offsetX <= radiusChunks; offsetX += 1) {
          if (offsetX * offsetX + offsetY * offsetY > radiusSq) {
            continue;
          }

          const targetX = chunkX + offsetX;
          const targetY = chunkY + offsetY;
          if (targetX < 0 || targetY < 0 || targetX >= widthChunks || targetY >= heightChunks) {
            continue;
          }

          const targetIndex = targetY * widthChunks + targetX;
          if (!playableChunks[targetIndex]) {
            mask[targetIndex] = 1;
          }
        }
      }
    }
  }

  return mask;
}

function playerMapChunkHasPlayableTile(asteroid, chunkX, chunkY) {
  const startX = chunkX * PLAYER_MAP_CHUNK_TILES;
  const startY = chunkY * PLAYER_MAP_CHUNK_TILES;
  const endX = Math.min(asteroid.widthTiles, startX + PLAYER_MAP_CHUNK_TILES);
  const endY = Math.min(asteroid.heightTiles, startY + PLAYER_MAP_CHUNK_TILES);
  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      const index = tileY * asteroid.widthTiles + tileX;
      const playable = asteroid.playable?.[index] === true || asteroid.playable?.[index] === "1";
      if (playable) {
        return true;
      }
    }
  }

  return false;
}

function playerMapAllowed() {
  return state.room?.state === "active" &&
    !isReadyMenu() &&
    Boolean(state.asteroid) &&
    Boolean(state.playerMap.cells);
}

function playerMapRenderState(snapshot, cameraPlayerId = state.playerId) {
  if (!snapshot || state.room?.state !== "active" || !state.asteroid || !state.playerMap.cells || !state.playerMap.baseCells) {
    return null;
  }

  const authoritativePlayer = snapshot.players?.find((candidate) => candidate.id === cameraPlayerId) ||
    snapshot.players?.find((candidate) => candidate.id === state.playerId);
  const predicted = cameraPlayerId === state.playerId ? predictedLocalPlayer() : null;
  const player = predicted || authoritativePlayer;
  if (!player?.alive) {
    return null;
  }

  observePlayerMap(player);
  if (state.playerMap.dirty) {
    savePlayerMap();
  }

  const tileSize = state.asteroid.tileSize || RENDER.tileSize;
  const chunkWorldSize = PLAYER_MAP_CHUNK_TILES * tileSize;
  const visibleRadius = playerMapVisibleRadiusPixels();

  return {
    widthChunks: state.playerMap.widthChunks,
    heightChunks: state.playerMap.heightChunks,
    chunkTiles: PLAYER_MAP_CHUNK_TILES,
    circle: state.playerMap.circle,
    unknown: PLAYER_MAP_UNKNOWN,
    background: PLAYER_MAP_BACKGROUND,
    foreground: PLAYER_MAP_FOREGROUND,
    storm: PLAYER_MAP_STORM,
    baseCells: state.playerMap.baseCells,
    fullMapStormMask: state.playerMap.fullMapStormMask,
    cells: state.playerMap.cells,
    players: playerMapVisiblePlayers(snapshot, player, chunkWorldSize, visibleRadius),
    viewCircle: {
      x: player.x / chunkWorldSize,
      y: player.y / chunkWorldSize,
      radius: visibleRadius / chunkWorldSize
    }
  };
}

function playerMapVisiblePlayers(snapshot, localPlayer, chunkWorldSize, visibleRadius) {
  if (!Array.isArray(snapshot?.players) || !localPlayer) {
    return [];
  }

  const visibleRadiusSq = visibleRadius * visibleRadius;
  return snapshot.players
    .filter((player) => player?.alive && player.id !== localPlayer.id)
    .filter((player) => {
      const dx = player.x - localPlayer.x;
      const dy = player.y - localPlayer.y;
      return dx * dx + dy * dy <= visibleRadiusSq;
    })
    .map((player) => ({
      x: player.x / chunkWorldSize,
      y: player.y / chunkWorldSize
    }));
}

function observePlayerMap(player) {
  const asteroid = state.asteroid;
  const map = state.playerMap;
  if (!asteroid || !map.cells) {
    return;
  }

  const tileSize = asteroid.tileSize || RENDER.tileSize;
  const chunkWorldSize = PLAYER_MAP_CHUNK_TILES * tileSize;
  const visibleRadius = playerMapVisibleRadiusPixels();
  const chunkReach = visibleRadius + chunkWorldSize * Math.SQRT2 * 0.5;
  const minChunkX = clamp(Math.floor((player.x - chunkReach) / chunkWorldSize), 0, map.widthChunks - 1);
  const maxChunkX = clamp(Math.floor((player.x + chunkReach) / chunkWorldSize), 0, map.widthChunks - 1);
  const minChunkY = clamp(Math.floor((player.y - chunkReach) / chunkWorldSize), 0, map.heightChunks - 1);
  const maxChunkY = clamp(Math.floor((player.y + chunkReach) / chunkWorldSize), 0, map.heightChunks - 1);
  const visibleRadiusSq = visibleRadius * visibleRadius;
  let changed = false;

  for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
    const centerY = (chunkY + 0.5) * chunkWorldSize;
    const dy = centerY - player.y;
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      const centerX = (chunkX + 0.5) * chunkWorldSize;
      const dx = centerX - player.x;
      if (dx * dx + dy * dy > visibleRadiusSq) {
        continue;
      }

      const value = playerMapChunkValue(asteroid, chunkX, chunkY);
      const cellIndex = chunkY * map.widthChunks + chunkX;
      if (value !== PLAYER_MAP_UNKNOWN && map.cells[cellIndex] !== value) {
        map.cells[cellIndex] = value;
        changed = true;
      }
    }
  }

  if (changed) {
    map.dirty = true;
  }
}

function playerMapVisibleRadiusPixels() {
  if (playerMapMiniPlayerActive()) {
    const canvasRadius = Math.min(
      Number(minimapCanvas?.width) || 0,
      Number(minimapCanvas?.height) || 0
    ) / 2;
    const targetRadius = PLAYER_MAP_MINIPLAYER_RADIUS * PLAYER_MAP_MINIPLAYER_RESOLUTION_SCALE;
    return Math.max(targetRadius, canvasRadius) * WORLD_LENS_EDGE_SCALE;
  }

  return (Math.min(RENDER.width, RENDER.height) / 2) * WORLD_LENS_EDGE_SCALE;
}

function playerMapMiniPlayerActive() {
  return state.playerMap.large === true &&
    state.room?.state === "active" &&
    Boolean(state.playerMap.cells);
}

function playerMapChunkValue(asteroid, chunkX, chunkY) {
  const startX = chunkX * PLAYER_MAP_CHUNK_TILES;
  const startY = chunkY * PLAYER_MAP_CHUNK_TILES;
  const endX = Math.min(asteroid.widthTiles, startX + PLAYER_MAP_CHUNK_TILES);
  const endY = Math.min(asteroid.heightTiles, startY + PLAYER_MAP_CHUNK_TILES);
  let safePlayableCount = 0;
  let rockCount = 0;
  let playableCount = 0;
  let stormCount = 0;

  for (let tileY = startY; tileY < endY; tileY += 1) {
    for (let tileX = startX; tileX < endX; tileX += 1) {
      const index = tileY * asteroid.widthTiles + tileX;
      const playable = asteroid.playable?.[index] === true || asteroid.playable?.[index] === "1";
      if (!playable) {
        continue;
      }

      playableCount += 1;
      if (isPlayerMapStormTile(asteroid, index)) {
        stormCount += 1;
        continue;
      }
      safePlayableCount += 1;
      if (isAsteroidRockTile(asteroid.tiles[index])) {
        rockCount += 1;
      }
    }
  }

  if (stormCount > 0) {
    return PLAYER_MAP_STORM;
  }
  if (safePlayableCount <= 0) {
    return PLAYER_MAP_UNKNOWN;
  }

  return rockCount >= PLAYER_MAP_CHUNK_TILES * PLAYER_MAP_CHUNK_TILES
    ? PLAYER_MAP_FOREGROUND
    : PLAYER_MAP_BACKGROUND;
}

function isPlayerMapStormTile(asteroid, index) {
  return Boolean(asteroid.storm) && Number(asteroid.storm[index]) === STORM_STATE.storm;
}

function botChunkMapRenderState(cameraPlayerId) {
  if (!state.localGame.active || !state.asteroid || !cameraPlayerId || cameraPlayerId === state.playerId) {
    return null;
  }

  const brain = state.localGame.bots.get(cameraPlayerId);
  const bot = state.snapshot?.players.find((candidate) => candidate.id === cameraPlayerId);
  if (!brain || !bot) {
    return null;
  }

  const cellsX = Math.ceil(state.asteroid.widthTiles / BOT_DEBUG_CHUNK_TILES);
  const cellsY = Math.ceil(state.asteroid.heightTiles / BOT_DEBUG_CHUNK_TILES);
  const current = pointChunkForDebugMap(bot);
  return {
    label: bot.name || cameraPlayerId,
    cellsX,
    cellsY,
    current,
    explored: Array.from(brain.exploredCells || [])
      .map(([key, visits]) => {
        const cell = debugChunkFromKey(key);
        return cell ? { ...cell, visits: Math.max(1, Math.floor(Number(visits) || 1)) } : null;
      })
      .filter(Boolean),
    heat: Array.from(brain.exploreHeat || [])
      .map(([key, entry]) => {
        const cell = debugChunkFromKey(key);
        const heat = debugExploreHeat(entry);
        return cell && heat > 0 ? { ...cell, heat } : null;
      })
      .filter(Boolean),
    threat: debugChunkFromSector(brain.lastThreatSector),
    wander: debugChunkFromTarget(brain.wanderTarget),
    resource: debugChunkFromTarget(brain.targetResource),
    flee: debugChunkFromTarget(brain.fleeTarget),
    nav: Array.isArray(brain.navPath)
      ? brain.navPath.map((index) => debugChunkFromTileIndex(index)).filter(Boolean)
      : []
  };
}

function botDebugOverlayRenderState(cameraPlayerId) {
  if (!state.botDebugOverlay) {
    return null;
  }

  const details = spectatedBotDebugDetails(cameraPlayerId);
  if (!details) {
    return null;
  }

  const brain = state.localGame.bots.get(cameraPlayerId);
  const bot = state.snapshot?.players.find((candidate) => candidate.id === cameraPlayerId);
  if (!brain || !bot) {
    return null;
  }

  return {
    title: details.name || details.id,
    lines: botDebugOverlayLines(details),
    player: {
      x: bot.x,
      y: bot.y,
      radius: bot.radius || ENGINE.ship.radius
    },
    path: botDebugPathPoints(brain),
    pathCursor: Math.max(0, Math.floor(Number(brain.navPathCursor || 0))),
    targets: botDebugTargetPoints(brain),
    miningTarget: Number.isInteger(bot.miningTargetIndex)
      ? debugTileCenter(bot.miningTargetIndex)
      : null
  };
}

function spectatedBotDebugDetails(cameraPlayerId) {
  if (!state.localGame.active || !cameraPlayerId || cameraPlayerId === state.playerId) {
    return null;
  }

  const brain = state.localGame.bots.get(cameraPlayerId);
  const bot = state.snapshot?.players.find((candidate) => candidate.id === cameraPlayerId);
  if (!brain || !bot) {
    return null;
  }

  return {
    id: cameraPlayerId,
    name: bot.name,
    tick: state.snapshot?.tick ?? null,
    alive: bot.alive,
    position: debugPoint(bot),
    velocity: debugVector(bot.vx, bot.vy),
    health: {
      current: debugNumber(bot.health),
      max: debugNumber(bot.maxHealth),
      bars: bot.healthBars
    },
    resources: { ...(bot.resources || {}) },
    upgrades: { ...(bot.upgrades || {}) },
    input: bot.input ? {
      seq: bot.input.seq,
      moveX: debugNumber(bot.input.moveX),
      moveY: debugNumber(bot.input.moveY),
      aimAngle: debugNumber(bot.input.aimAngle),
      mining: bot.input.mining,
      huckRock: bot.input.huckRock
    } : null,
    mining: {
      active: bot.mining,
      targetIndex: bot.miningTargetIndex ?? null,
      phase: bot.miningPhase ?? null,
      progress: debugNumber(bot.miningProgress)
    },
    brain: {
      plan: brain.upgradePlan,
      seq: brain.seq,
      mode: brain.debug?.mode ?? null,
      target: brain.debug?.target ?? null,
      nav: brain.debug?.nav ?? null,
      threat: brain.debug?.threat ?? null,
      stormPressure: brain.debug?.stormPressure ?? null,
      effects: brain.debug?.effects ?? null,
      input: brain.debug?.input ?? null,
      stuckTicks: brain.stuckTicks || 0,
      targetResource: debugTarget(brain.targetResource),
      wanderTarget: debugTarget(brain.wanderTarget),
      fleeTarget: debugTarget(brain.fleeTarget),
      lastThreatSector: brain.lastThreatSector || null,
      chaseMemory: brain.chaseMemory || null,
      navGoalKey: brain.navGoalKey || "",
      navFailedKey: brain.navFailedKey || "",
      navFailedUntilTick: brain.navFailedUntilTick || 0,
      navPathCursor: brain.navPathCursor || 0,
      navAttachIndex: brain.navAttachIndex ?? brain.navPathCursor ?? 0,
      navPathLength: Array.isArray(brain.navPath) ? brain.navPath.length : 0,
      navNextIndex: Array.isArray(brain.navPath) ? brain.navPath[(brain.navPathCursor || 0) + 1] ?? null : null
    },
    tile: debugTileAtPoint(bot.x, bot.y)
  };
}

function logSpectatedBotDebug(cameraPlayerId, timeSeconds) {
  const details = spectatedBotDebugDetails(cameraPlayerId);
  if (!details) {
    state.botDebugLog.lastId = "";
    state.botDebugLog.lastAtSeconds = 0;
    return;
  }

  if (state.botDebugLog.lastId !== cameraPlayerId) {
    state.botDebugLog.lastId = cameraPlayerId;
    state.botDebugLog.lastAtSeconds = 0;
  }

  if (timeSeconds - state.botDebugLog.lastAtSeconds < 1) {
    return;
  }

  state.botDebugLog.lastAtSeconds = timeSeconds;
  console.log(botDebugSummary(details), details);
}

function botDebugOverlayLines(details) {
  const brain = details.brain || {};
  const input = brain.input || details.input || {};
  const nav = brain.nav || {};
  const target = brain.target || brain.targetResource || brain.wanderTarget || brain.fleeTarget || {};
  const targetIndex = target.index ?? "-";
  const actualMine = details.mining?.targetIndex ?? "-";
  const targetKind = target.resource ?? target.cellKey ?? target.id ?? "target";

  return [
    `MODE: ${brain.mode ?? "-"}   STUCK: ${brain.stuckTicks ?? 0}`,
    `TARGET: ${targetKind} ${targetIndex}`,
    `PATH: ${brain.navPathCursor ?? 0}/${brain.navPathLength ?? 0} A:${brain.navAttachIndex ?? "-"} -> ${brain.navNextIndex ?? "-"}`,
    `MINE: WANT ${targetIndex}  HIT ${actualMine}`,
    `MOVE: ${debugPair(input.moveX, input.moveY)}  SPEED: ${details.velocity?.speed ?? "-"}`
  ];
}

function botDebugTargetText(target) {
  if (!target) {
    return "-";
  }

  const kind = target.resource ?? target.cellKey ?? target.id ?? "target";
  const index = target.index ?? "-";
  const clear = target.clear ?? "-";
  const needed = target.needed ?? "-";
  return `${kind} IDX:${index} CLR:${clear} NEED:${needed}`;
}

function botDebugPathPoints(brain) {
  const steps = Array.isArray(brain.navPathSteps) && brain.navPathSteps.length > 0
    ? brain.navPathSteps
    : Array.isArray(brain.navPath)
      ? brain.navPath.map((index) => debugTileCenter(index)).filter(Boolean)
      : [];

  return steps
    .slice(0, 128)
    .map((step, pathIndex) => {
      if (!Number.isFinite(step?.x) || !Number.isFinite(step?.y)) {
        return null;
      }
      return {
        x: step.x,
        y: step.y,
        index: Number.isInteger(step.index) ? step.index : null,
        mineable: step.mineable === true || isDebugMineableIndex(step.index),
        directFromPrevious: step.directFromPrevious === true,
        pathIndex
      };
    })
    .filter(Boolean);
}

function botDebugTargetPoints(brain) {
  const points = [];
  addBotDebugTargetPoint(points, "target", brain.debug?.target, "#ffd34d");
  return points;
}

function addBotDebugTargetPoint(points, label, target, color) {
  const point = debugWorldPointFromTarget(target, label);
  if (!point) {
    return;
  }

  const key = `${label}:${Math.round(point.x)}:${Math.round(point.y)}`;
  if (points.some((candidate) => candidate.key === key)) {
    return;
  }

  points.push({ ...point, label, color, key });
}

function debugWorldPointFromTarget(target, label = "") {
  if (!target || typeof target !== "object") {
    return null;
  }

  if (Number.isFinite(target.lastX) && Number.isFinite(target.lastY)) {
    return { x: target.lastX, y: target.lastY };
  }

  if (Number.isFinite(target.sectorEntryX) && Number.isFinite(target.sectorEntryY)) {
    return { x: target.sectorEntryX, y: target.sectorEntryY };
  }

  if (label === "threat" && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return debugChunkCenter(target.x, target.y);
  }

  if (Number.isFinite(target.sectorX) && Number.isFinite(target.sectorY)) {
    return debugChunkCenter(target.sectorX, target.sectorY);
  }

  if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return { x: target.x, y: target.y };
  }

  if (Number.isInteger(target.index)) {
    return debugTileCenter(target.index);
  }

  if (target.cellKey) {
    const cell = debugChunkFromKey(target.cellKey);
    return cell ? debugChunkCenter(cell.x, cell.y) : null;
  }

  return null;
}

function debugTileCenter(index) {
  if (!state.asteroid || !Number.isInteger(index) || index < 0 || index >= state.asteroid.tiles.length) {
    return null;
  }

  const tileX = index % state.asteroid.widthTiles;
  const tileY = Math.floor(index / state.asteroid.widthTiles);
  return {
    x: (tileX + 0.5) * state.asteroid.tileSize,
    y: (tileY + 0.5) * state.asteroid.tileSize,
    index
  };
}

function debugChunkCenter(cellX, cellY) {
  if (!state.asteroid || !Number.isFinite(cellX) || !Number.isFinite(cellY)) {
    return null;
  }

  const tileSize = state.asteroid.tileSize || RENDER.tileSize || 16;
  const minTileX = cellX * BOT_DEBUG_CHUNK_TILES;
  const minTileY = cellY * BOT_DEBUG_CHUNK_TILES;
  const maxTileX = Math.min(state.asteroid.widthTiles, minTileX + BOT_DEBUG_CHUNK_TILES);
  const maxTileY = Math.min(state.asteroid.heightTiles, minTileY + BOT_DEBUG_CHUNK_TILES);
  return {
    x: (minTileX + maxTileX) * tileSize * 0.5,
    y: (minTileY + maxTileY) * tileSize * 0.5
  };
}

function isDebugMineableIndex(index) {
  return state.asteroid &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < state.asteroid.tiles.length &&
    isAsteroidRockTile(state.asteroid.tiles[index]);
}

function botDebugSummary(details) {
  const brain = details.brain || {};
  const nav = brain.nav || {};
  const input = brain.input || details.input || {};
  const target = brain.target || brain.targetResource || brain.wanderTarget || brain.fleeTarget || {};
  const tile = details.tile || {};
  const effects = brain.effects || {};
  return [
    "BITSPACE bot spectate",
    `${details.id}`,
    `tick=${details.tick}`,
    `mode=${brain.mode ?? "?"}`,
    `move=${debugPair(input.moveX, input.moveY)}`,
    `mining=${Boolean(input.mining || details.mining?.active)}`,
    `mine=${details.mining?.targetIndex ?? "-"}/${details.mining?.phase ?? "-"}/${details.mining?.progress ?? "-"}`,
    `nav=${brain.navPathCursor ?? 0}/${brain.navPathLength ?? 0}->${brain.navNextIndex ?? "-"}`,
    `attach=${brain.navAttachIndex ?? "-"}`,
    `navFail=${brain.navFailedUntilTick > details.tick ? brain.navFailedUntilTick - details.tick : "-"}`,
    `navMove=${debugPair(nav.moveX, nav.moveY)}`,
    `target=${target.resource ?? target.cellKey ?? target.id ?? target.index ?? "-"}`,
    `targetIndex=${target.index ?? "-"}`,
    `targetClear=${target.clear ?? "-"}`,
    `targetNeed=${target.needed ?? "-"}`,
    `route=${target.routeSeconds ?? "-"}/${target.minedTiles ?? "-"}`,
    `fx=${effects.thrust ?? "-"}/${effects.range ?? "-"}/${effects.miningPower ?? "-"}/${effects.damage ?? "-"}/${effects.rays ?? "-"}`,
    `pos=${debugPair(details.position?.x, details.position?.y)}`,
    `speed=${details.velocity?.speed ?? "-"}`,
    `stuck=${brain.stuckTicks ?? 0}`,
    `tile=${tile.index ?? "-"}:${tile.tile ?? "-"}`
  ].join(" ");
}

function debugPair(x, y) {
  return `(${x ?? "-"},${y ?? "-"})`;
}

function debugPoint(point) {
  if (!point) {
    return null;
  }

  return {
    x: debugNumber(point.x),
    y: debugNumber(point.y)
  };
}

function debugVector(x, y) {
  return {
    x: debugNumber(x),
    y: debugNumber(y),
    speed: debugNumber(Math.hypot(Number(x) || 0, Number(y) || 0))
  };
}

function debugTarget(target) {
  if (!target) {
    return null;
  }

  return {
    index: Number.isInteger(target.index) ? target.index : null,
    x: debugNumber(target.x),
    y: debugNumber(target.y),
    cellKey: target.cellKey || null,
    tick: Number.isFinite(target.tick) ? target.tick : null
  };
}

function debugTileAtPoint(x, y) {
  if (!state.asteroid) {
    return null;
  }

  const tileX = Math.floor(x / state.asteroid.tileSize);
  const tileY = Math.floor(y / state.asteroid.tileSize);
  const index = tileY * state.asteroid.widthTiles + tileX;
  if (index < 0 || index >= state.asteroid.tiles.length) {
    return { index: null, tileX, tileY, tile: "out" };
  }

  return {
    index,
    tileX,
    tileY,
    tile: state.asteroid.tiles[index],
    amount: state.asteroid.amounts?.[index] ?? 0,
    playable: state.asteroid.playable?.[index] === true || state.asteroid.playable?.[index] === "1"
  };
}

function debugNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function debugExploreHeat(entry) {
  if (Number.isFinite(entry)) {
    return debugNumber(Math.max(0, Number(entry)));
  }

  if (!entry || typeof entry !== "object") {
    return 0;
  }

  return debugNumber(Math.max(0, Number(entry.heat ?? entry.value ?? 0)));
}

function debugChunkFromKey(key) {
  const match = /^(\d+):(\d+)$/.exec(String(key || ""));
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2])
  };
}

function debugChunkFromTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }
  if (Number.isFinite(target.index)) {
    return debugChunkFromTileIndex(target.index);
  }
  if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
    return pointChunkForDebugMap(target);
  }
  return null;
}

function debugChunkFromSector(sector) {
  if (!sector || !Number.isFinite(sector.x) || !Number.isFinite(sector.y)) {
    return null;
  }

  return {
    x: Math.floor(sector.x),
    y: Math.floor(sector.y)
  };
}

function pointChunkForDebugMap(point) {
  if (!state.asteroid || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    return null;
  }

  return {
    x: Math.floor(point.x / state.asteroid.tileSize / BOT_DEBUG_CHUNK_TILES),
    y: Math.floor(point.y / state.asteroid.tileSize / BOT_DEBUG_CHUNK_TILES)
  };
}

function debugChunkFromTileIndex(index) {
  if (!state.asteroid || !Number.isInteger(index) || index < 0 || index >= state.asteroid.tiles.length) {
    return null;
  }

  const tileX = index % state.asteroid.widthTiles;
  const tileY = Math.floor(index / state.asteroid.widthTiles);
  return {
    x: Math.floor(tileX / BOT_DEBUG_CHUNK_TILES),
    y: Math.floor(tileY / BOT_DEBUG_CHUNK_TILES)
  };
}

function upgradeIndexAtPoint(x, y) {
  const rows = upgradeRowsRect();
  const rowLeft = rows.x;
  const rowRight = rows.x + rows.width;
  const rowTop = rows.y;
  const rowBottom = rowTop + UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight;

  if (
    x < rowLeft ||
    x > rowRight ||
    y < rowTop - UPGRADE_MENU_LAYOUT.rowHitPadding ||
    y >= rowBottom + UPGRADE_MENU_LAYOUT.rowHitPadding
  ) {
    return null;
  }

  const rowOffset = clamp(y - rowTop, 0, rowBottom - rowTop - 1);
  return clamp(
    Math.floor(rowOffset / UPGRADE_MENU_LAYOUT.rowHeight),
    0,
    UPGRADE_DEFINITIONS.length - 1
  );
}

function upgradeRowsRect() {
  return {
    x: UPGRADE_MENU_LAYOUT.x + UPGRADE_MENU_LAYOUT.rowInset,
    y: UPGRADE_MENU_LAYOUT.y + UPGRADE_MENU_LAYOUT.rowTopOffset,
    width: upgradeMenuRowWidth(),
    height: UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight
  };
}

function upgradeMenuRowWidth() {
  return approximateUpgradeMenuWidth() - UPGRADE_MENU_LAYOUT.rowInset * 2;
}

function approximateUpgradeMenuWidth() {
  const labelWidth = Math.max(...UPGRADE_DEFINITIONS.map((definition) =>
    approximateBitmapTextWidth(definition.label)
  ));
  const levelWidth = Math.max(...UPGRADE_DEFINITIONS.map((definition) =>
    approximateBitmapTextWidth(`0/${definition.maxLevel}`)
  ));
  const rowWidth = UPGRADE_MENU_LAYOUT.labelOffset +
    labelWidth +
    UPGRADE_MENU_LAYOUT.columnGap +
    levelWidth;
  const detailWidth = Math.max(...approximateUpgradeMenuDetailLines().map(approximateBitmapTextWidth));
  const titleWidth = approximateBitmapTextWidth("UPGRADES");

  return Math.ceil(Math.max(
    titleWidth + UPGRADE_MENU_LAYOUT.padding * 2,
    rowWidth + UPGRADE_MENU_LAYOUT.rowInset * 2,
    detailWidth + UPGRADE_MENU_LAYOUT.padding * 2
  ));
}

function approximateUpgradeMenuDetailLines() {
  const lines = new Set([
    "COST: MAX LEVEL",
    "MAXED",
    "NEED RESOURCES",
    "CLICK BUY",
    "SELECT BUY"
  ]);

  for (const definition of UPGRADE_DEFINITIONS) {
    lines.add(`CURRENT: ${definition.baseStatText || "BASE"}`);
    lines.add("NEXT: MAX LEVEL");
    for (const level of definition.levels || []) {
      lines.add(`CURRENT: ${level.effectText || definition.baseStatText || "BASE"}`);
      lines.add(`NEXT: ${level.effectText || "MAX LEVEL"}`);
      lines.add(`COST: ${approximateUpgradeCostText(level.cost)}`);
    }
  }

  return Array.from(lines);
}

function approximateUpgradeCostText(cost) {
  if (!cost) {
    return "MAX";
  }

  const parts = [];
  if (cost.rock) {
    parts.push(`${cost.rock} ROCK`);
  }
  if (cost.ore) {
    parts.push(`${cost.ore} ORE`);
  }
  if (cost.diamond) {
    parts.push(`${cost.diamond} DIAMOND`);
  }
  return parts.join(" ");
}

function approximateBitmapTextWidth(text) {
  const characters = String(text).toUpperCase();
  let width = 0;

  for (const character of characters) {
    width += approximateGlyphWidth(character) + 1;
  }

  return Math.max(0, width - 1);
}

function approximateGlyphWidth(character) {
  if (character === " ") {
    return 3;
  }
  if (character === "I" || character === "1" || character === "/" || character === ":") {
    return 3;
  }
  return 5;
}

function upgradeRowRect(index) {
  const rows = upgradeRowsRect();
  return {
    x: rows.x,
    y: rows.y + clamp(index, 0, UPGRADE_DEFINITIONS.length - 1) * UPGRADE_MENU_LAYOUT.rowHeight,
    width: rows.width,
    height: UPGRADE_MENU_LAYOUT.rowHeight
  };
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

  if (state.controller.connected) {
    state.mouse.aimAngle = controllerAimAngleForPlayer(player);
    return;
  }

  if (!hasMousePointer()) {
    return;
  }

  const aim = activeAimFramePoint();
  const dx = aim.x - aim.width / 2;
  const dy = aim.y - aim.height / 2;
  if (dx !== 0 || dy !== 0) {
    state.mouse.aimAngle = Math.atan2(dy, dx);
  }
}

function inputAimAngleForPlayer(player) {
  if (state.controller.connected) {
    return controllerAimAngleForPlayer(player);
  }

  return state.mouse.aimAngle;
}

function controllerAimAngleForPlayer(player) {
  if (state.controller.aimActive && Number.isFinite(state.controller.aimAngle)) {
    return state.controller.aimAngle;
  }

  if (Number.isFinite(player?.angle)) {
    return player.angle;
  }

  if (Number.isFinite(player?.aimAngle)) {
    return player.aimAngle;
  }

  return state.mouse.aimAngle;
}

function eventToFramebufferPoint(event) {
  return eventToCanvasFramePoint(event, canvas);
}

function eventToMiniPlayerPoint(event) {
  return eventToCanvasFramePoint(event, minimapCanvas);
}

function eventToCanvasFramePoint(event, targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  const canvasWidth = targetCanvas.width || RENDER.width;
  const canvasHeight = targetCanvas.height || RENDER.height;
  const scale = Math.min(rect.width / canvasWidth, rect.height / canvasHeight);
  const width = canvasWidth * scale;
  const height = canvasHeight * scale;
  const x = event.clientX - rect.left - (rect.width - width) / 2;
  const y = event.clientY - rect.top - (rect.height - height) / 2;

  return {
    x: clamp(x / scale, 0, canvasWidth),
    y: clamp(y / scale, 0, canvasHeight),
    inFrame: x >= 0 && x <= width && y >= 0 && y <= height
  };
}

function isMouseInPhysicalViewport() {
  return isPointInPhysicalViewport(state.mouse.x, state.mouse.y, state.mouse.inFrame);
}

function hasMousePointer() {
  return state.mouse.hasPointer;
}

function activeAimFramePoint() {
  if (miniPlayerAimActive()) {
    return {
      x: state.mouse.miniX,
      y: state.mouse.miniY,
      width: minimapCanvas.width || RENDER.width,
      height: minimapCanvas.height || RENDER.height
    };
  }

  const frame = framebufferSize();
  return {
    x: state.mouse.x,
    y: state.mouse.y,
    width: frame.width,
    height: frame.height
  };
}

function miniPlayerAimActive() {
  return playerMapMiniPlayerActive() &&
    Boolean(minimapCanvas);
}

function lensScreenPointToWorld(player, screenX, screenY, frame = framebufferSize()) {
  const centerX = frame.width / 2;
  const centerY = frame.height / 2;
  const dx = screenX - centerX;
  const dy = screenY - centerY;
  const radius = Math.min(frame.width, frame.height) / 2;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || radius <= 0) {
    return { x: player.x, y: player.y };
  }

  const t = clamp(distance / radius, 0, 1);
  const scale = 1 + (Math.max(1, WORLD_LENS_EDGE_SCALE) - 1) * Math.pow(t, WORLD_LENS_POWER);
  return {
    x: player.x + dx * scale,
    y: player.y + dy * scale
  };
}

function isPointInPhysicalViewport(x, y, inFrame = true) {
  if (!inFrame) {
    return false;
  }

  const frame = framebufferSize();
  const centerX = frame.width / 2;
  const centerY = frame.height / 2;
  const radius = Math.min(frame.width, frame.height) / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

function cameraForPlayer(snapshot, player) {
  const frame = framebufferSize();
  return {
    x: player.x - frame.width / 2,
    y: player.y - frame.height / 2
  };
}

function framebufferSize() {
  return {
    width: canvas.width || RENDER.width,
    height: canvas.height || RENDER.height
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

function miningRayExtension(mining, holdSeconds) {
  if (!mining) {
    return 0;
  }

  const extendSeconds = ENGINE.mining.rayExtendSeconds;
  return extendSeconds <= 0 ? 1 : clamp(holdSeconds / extendSeconds, 0, 1);
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function normalizeSignedAngle(angle) {
  const normalized = normalizeAngle(angle);
  return normalized > Math.PI ? normalized - Math.PI * 2 : normalized;
}

function releaseSpaceUntilKeyup() {
  releaseKeyUntilKeyup("Space");
}

function releaseKeyUntilKeyup(code) {
  const wasDown = keys.has(code);
  keys.delete(code);
  if (wasDown) {
    releasedKeysUntilKeyup.add(code);
  }
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
    "KeyQ",
    "KeyE",
    "Space"
  ].includes(code);
}
