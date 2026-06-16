import { ENGINE, RENDER } from "/shared/constants.js";
import {
  ASTEROID_TILE,
  blockingTilesAlongSegment,
  STORM_STATE,
  blockingTilesNearCircle,
  createLobbyAsteroid,
  createNaturalAsteroid,
  isAsteroidRockTile,
  raycastAsteroid
} from "/shared/asteroid.js";
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
const THEME_STORAGE_KEY = "bitspace.theme";
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
const ENGINE_AUDIO_MAX_GAIN = 0.032;
const MINING_AUDIO_MAX_GAIN = 0.022;
const AUDIO_CLUNK_COOLDOWN_SECONDS = 0.16;
const AUDIO_COLLISION_CLUNK_SPEED = 18;
const MENU_PLAYER_ID = "menu-player";
const MENU_ROOMS = Object.freeze({
  ready: "ready",
  theme: "theme"
});
const MENU_BUTTON_WIDTH = 112;
const MENU_BUTTON_WIDE_WIDTH = 128;
const MENU_BUTTON_HEIGHT = 32;
const MENU_BUTTON_GAP = 24;
const THEME_SWATCH_RADIUS = 15.5;
const THEME_SWATCH_RING_RADIUS = 76;
const THEME_ASTEROID_GAP = 24;
const THEME_PRESETS = Object.freeze([
  { id: "blue", label: "BLUE", background: "#1f2433", foreground: "#74cbef" },
  { id: "mono", label: "MONO", background: "#000000", foreground: "#ffffff", backing: "#101020" },
  { id: "green", label: "GREEN", background: "#27543c", foreground: "#ffbf00" },
  { id: "purple", label: "PURPLE", background: "#3d2945", foreground: "#65ceff" },
  { id: "tan", label: "TAN", background: "#555452", foreground: "#ffc366" },
  { id: "plum", label: "PLUM", background: "#412c34", foreground: "#d8bd7a" },
  { id: "matrix", label: "MATRIX", background: "#111111", foreground: "#00ff00" }
]);
const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 60,
  width: 260,
  rowTopOffset: 24,
  rowHeight: 14,
  rowInset: 8,
  rowHitPadding: 2
});
const ROOM_BUTTONS = Object.freeze({
  ready: { x: 132, y: 216, width: 120, height: 28 },
  leaveSpectating: { x: 132, y: 330, width: 120, height: 28 },
  leaveEnded: { x: 132, y: 330, width: 120, height: 28 }
});
const canvas = document.querySelector("#scene");
const renderer = createRenderer(canvas);
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
    lastTimeSeconds: 0
  },
  entitySmoothing: {
    byId: new Map()
  },
  eliminationNotices: [],
  playerAliveById: new Map(),
  lastRoomId: null,
  inputSeq: 0,
  nextHuckRockThunkAtSeconds: 0,
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
  build: {
    active: false
  },
  menu: {
    ...createMenuState()
  },
  theme: loadTheme(),
  uiHoverId: null,
  lastReattachRequestAt: 0
};

const mapGenMode = isMapGenMode();
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
  emitHeartbeat();
  requestRoomReattach(0, true);
});

socket.on("connect", () => {
  emitHeartbeat();
});

socket.on(SERVER_EVENTS.room, (room) => {
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
  }

  if (!room || room.state === "menu") {
    releaseSpaceUntilKeyup();
    state.snapshot = null;
    state.asteroid = null;
    state.prediction.player = null;
    resetEntitySmoothing();
    state.eliminationNotices = [];
    state.playerAliveById.clear();
    state.upgrades.active = false;
    state.build.active = false;
    state.menu.readySent = false;
    state.menu.activeTargetId = null;
    resetLocalDamageAudioState();
    enterMenuRoom(MENU_ROOMS.ready);
    forgetRegisteredRoom();
    return;
  }

  rememberRegisteredRoom(room.roomId);
  if (previousState !== room.state || previousRoomId !== nextRoomId) {
    releaseSpaceUntilKeyup();
    state.upgrades.active = false;
    state.build.active = false;
    resetLocalDamageAudioState();
    resetEntitySmoothing();
    cancelMiningRay();
  }
  if (room?.state === "menu") {
    state.menu.readySent = false;
  }
});

socket.on(SERVER_EVENTS.snapshot, (snapshot) => {
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
  state.asteroid = {
    ...asteroid,
    tiles: asteroid.tiles.split(""),
    amounts: asteroid.amounts.split(""),
    storm: asteroid.storm ? asteroid.storm.split("") : null,
    stormWarningStarted: asteroid.storm ? new Int32Array(asteroid.tiles.length) : null,
    stormWarningUntil: asteroid.storm ? new Int32Array(asteroid.tiles.length) : null
  };
  applyStormWarnings(state.asteroid, asteroid.stormWarnings || []);
});

socket.on(SERVER_EVENTS.asteroidUpdate, (updates) => {
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
});

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

  if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    keys.add(event.code);
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

  if (isReadyMenu()) {
    state.mouse.down = true;
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

  if (state.build.active) {
    buildWallAtMouse();
    state.mouse.down = false;
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
  const readyMenu = isReadyMenu();

  syncThemeFromCss();
  pruneEliminationNotices(timeSeconds);
  if (readyMenu) {
    updateMenuSimulation(timeSeconds);
  } else {
    updatePrediction(timeSeconds);
    updateAimFromSnapshot();
  }
  const cameraPlayerId = cameraPlayerIdForRoom();
  state.uiHoverId = screenRoomButtonAtPoint(state.mouse.x, state.mouse.y);
  const buildTarget = buildTargetFromMouse();
  const snapshot = readyMenu ? menuSnapshot() : renderSnapshot(timeSeconds);
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
    uiRayActive: state.mouse.down,
    uiTargetId: state.uiHoverId,
    aimAngle: menuPlayer?.aimAngle ?? state.mouse.aimAngle,
    mining: readyMenu
      ? menuPlayer?.mining === true
      : state.mouse.down && !state.chat.active && !state.upgrades.active && !state.build.active && !isInputBlocked(),
    predictedPlayer: readyMenu ? null : predictedLocalPlayer(),
    eliminationNotices: state.eliminationNotices,
    theme: state.theme,
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
    asteroids,
    asteroid,
    huckRocks: [],
    huckRockCooldownSeconds: 0,
    player: createMenuPlayer(asteroid)
  };
}

function createThemeMenuAsteroid() {
  const widthTiles = 48;
  const heightTiles = 48;
  const center = {
    x: (widthTiles * RENDER.tileSize) / 2,
    y: (heightTiles * RENDER.tileSize) / 2
  };
  const clearRadius = THEME_SWATCH_RING_RADIUS + THEME_SWATCH_RADIUS + THEME_ASTEROID_GAP;

  return createNaturalAsteroid({
    seed: "bitspace-menu-theme",
    widthTiles,
    heightTiles,
    createPockets: false,
    clearCircles: [{ x: center.x, y: center.y, radius: clearRadius }],
    playableCircles: [{ x: center.x, y: center.y, radius: clearRadius + RENDER.tileSize * 2 }],
    generation: {
      edgeMargin: 5,
      noiseScale: 0.09,
      noiseDetailScale: 0.22,
      noiseWarpScale: 0.06,
      noiseWarpStrength: 4,
      noiseCaveScale: 0.13,
      noiseCaveSecondaryScale: 0.17,
      noiseCaveDetailScale: 0.28,
      noiseCaveBand: 0.12,
      noiseCaveJunctionBand: 0.06,
      noiseCaveWidthJitter: 0.04,
      noiseCaveMinDepth: 0.08,
      noiseOctaves: 4,
      noisePersistence: 0.52,
      noiseLacunarity: 2,
      noiseFieldRadius: 19,
      noiseThreshold: -0.14,
      noiseRadialFalloff: 0.45,
      noiseMinComponentSize: 4,
      caveCloseMaxSize: 10,
      caveCloseProbabilityPower: 1.15,
      resourceCandidateChance: 0.48,
      resourceConnectionChance: 0.6,
      resourceConnectionMaxDistance: 5,
      resourceGraphKeepDegradation: 0.92,
      resourceMaxGraphs: 80,
      resourceMaxSpawnTiles: 120,
      oreChance: 0.82,
      diamondChance: 0.05,
      boundaryDilate: 8,
      boundaryShrink: 4,
      boundaryGap: 4
    }
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
    aimAngle: Math.PI / 2,
    mining: false,
    miningRay: null,
    miningHoldSeconds: 0,
    rayExtension: 0,
    thrusting: false,
    shake: 0,
    radius: ENGINE.ship.radius,
    upgrades: {},
    healthBars: ENGINE.player.startingHealthBars,
    health: maxHealth,
    maxHealth,
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
  player.aimAngle = Math.PI / 2;
  player.mining = false;
  player.miningRay = null;
  player.miningHoldSeconds = 0;
  player.rayExtension = 0;
  player.thrusting = false;
}

function updateMenuSimulation(timeSeconds) {
  const player = state.menu.player;
  const previousTime = state.menu.lastTimeSeconds || timeSeconds;
  const dtSeconds = clamp(timeSeconds - previousTime, 0, 1 / 15) || 1 / ENGINE.tickRate;
  state.menu.lastTimeSeconds = timeSeconds;
  state.menu.tick += 1;

  updateMenuAim(player);

  const move = state.chat.active ? { x: 0, y: 0 } : readMoveVector();
  const effects = aggregateUpgradeEffects(player.upgrades);
  const moving = move.x !== 0 || move.y !== 0;

  if (moving) {
    player.angle = normalizeAngle(Math.atan2(move.y, move.x));
    player.vx += move.x * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
    player.vy += move.y * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
  }

  player.thrusting = moving;
  player.mining = state.mouse.down && !state.chat.active;
  if (player.mining) {
    player.miningHoldSeconds += dtSeconds;
  } else {
    player.miningHoldSeconds = 0;
  }
  player.rayExtension = miningRayExtension(player.mining, player.miningHoldSeconds);

  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const drag = Math.pow(ENGINE.ship.drag * effects.dragMultiplier, dtSeconds / fixedStepSeconds);
  player.vx *= drag;
  player.vy *= drag;

  const velocity = clampMagnitude(player.vx, player.vy, ENGINE.ship.maxSpeed * effects.maxSpeedMultiplier);
  player.vx = velocity.x;
  player.vy = velocity.y;
  player.x += player.vx * dtSeconds;
  player.y += player.vy * dtSeconds;
  resolveMenuAsteroidCollisions(player);
  updateThemeRoomSelection(player);

  updateMenuMiningRay(player, dtSeconds);
  updateMenuHuckRocks(player, dtSeconds);
}

function updateThemeRoomSelection(player) {
  if (state.menu.room !== MENU_ROOMS.theme) {
    return;
  }

  const preset = closestThemePresetToPoint(player.x, player.y, menuCenter(state.menu.asteroid));
  if (preset && !themeMatchesPreset(state.theme, preset)) {
    setTheme(preset);
  }
}

function closestThemePresetToPoint(x, y, center) {
  const startAngle = -Math.PI / 2;
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let nextDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < THEME_PRESETS.length; index += 1) {
    const angle = startAngle + (index * Math.PI * 2) / THEME_PRESETS.length;
    const swatchX = center.x + Math.cos(angle) * THEME_SWATCH_RING_RADIUS;
    const swatchY = center.y + Math.sin(angle) * THEME_SWATCH_RING_RADIUS;
    const distance = Math.hypot(x - swatchX, y - swatchY);
    if (distance < closestDistance) {
      nextDistance = closestDistance;
      closestDistance = distance;
      closest = THEME_PRESETS[index];
    } else if (distance < nextDistance) {
      nextDistance = distance;
    }
  }

  return nextDistance - closestDistance >= 2 ? closest : null;
}

function updateMenuAim(player) {
  const dx = state.mouse.x - RENDER.width / 2;
  const dy = state.mouse.y - RENDER.height / 2;
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
  const activeRayLength = fullRayLength * player.rayExtension;
  const angle = player.aimAngle ?? player.angle;
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
  const start = {
    x: player.x + direction.x * player.radius,
    y: player.y + direction.y * player.radius
  };
  const asteroidHit = raycastAsteroid(state.menu.asteroid, start.x, start.y, angle, activeRayLength);
  const entityHit = raycastMenuEntities(start, direction, Math.min(asteroidHit.distance, activeRayLength));
  const hit = entityHit || asteroidHit;
  const fullAsteroidHit = raycastAsteroid(state.menu.asteroid, start.x, start.y, angle, fullRayLength);
  const fullEntityHit = raycastMenuEntities(start, direction, Math.min(fullAsteroidHit.distance, fullRayLength));
  const fullHit = fullEntityHit || fullAsteroidHit;
  const end = hit.hit ? hit : {
    x: start.x + direction.x * activeRayLength,
    y: start.y + direction.y * activeRayLength
  };

  player.miningRay = {
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
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
    extension: player.rayExtension,
    progress: 0
  };

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

    if (resolveMenuHuckRockAsteroidCollisions(rock, rock.previousX, rock.previousY, spawnedFragments)) {
      continue;
    }

    rocks.push(rock);
  }

  state.menu.huckRocks = rocks.concat(spawnedFragments);

  if (
    !activatedEntityThisFrame &&
    !state.chat.active &&
    !state.mouse.down &&
    keys.has("Space") &&
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
  const angle = player.aimAngle ?? player.angle;
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

    const hit = sweptCircleBoundsHit(
      previousX,
      previousY,
      rock.x,
      rock.y,
      rock.radius,
      blocker.x,
      blocker.y,
      blocker.size,
      blocker.size
    ) || circleTileOverlap(rock, blocker);
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
      const hit = circleTileOverlap(player, blocker);
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

  if (entity.action === "select-theme") {
    const preset = THEME_PRESETS.find((candidate) => candidate.id === entity.themeId);
    if (preset) {
      setTheme(preset);
    }
    enterMenuRoom(MENU_ROOMS.ready);
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
  return !state.room || state.room.state === "menu";
}

function menuEntities() {
  const center = menuCenter(state.menu.asteroid);
  const top = center.y + 28;

  if (state.menu.room === MENU_ROOMS.theme) {
    return themeSwatchEntities(center);
  }

  return [
    menuTitle("menu-title", "BITSPACE", center.x, center.y - 114),
    menuButton("menu-ready", "ready", "READY", center.x - MENU_BUTTON_WIDTH - MENU_BUTTON_GAP / 2, top, MENU_BUTTON_WIDTH),
    menuButton("menu-theme", "theme", "THEME", center.x + MENU_BUTTON_GAP / 2, top, MENU_BUTTON_WIDTH),
    menuHint("menu-controls", [
      { input: "WASD", action: "MOVE" },
      { input: "CLICK + HOLD", action: "MINING RAY" },
      { input: "SPACE", action: "HUCK ROCK" }
    ], center.x, top + MENU_BUTTON_HEIGHT + 30)
  ];
}

function menuTitle(id, label, x, y) {
  return {
    id,
    type: "menuTitle",
    label,
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
    height: 22
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
  return THEME_PRESETS.map((preset, index) => {
    const angle = startAngle + (index * Math.PI * 2) / THEME_PRESETS.length;
    return {
      id: `menu-theme-${preset.id}`,
      type: "themeSwatch",
      action: "select-theme",
      label: String(index + 1),
      themeId: preset.id,
      background: preset.background,
      foreground: preset.foreground,
      x: center.x + Math.cos(angle) * THEME_SWATCH_RING_RADIUS,
      y: center.y + Math.sin(angle) * THEME_SWATCH_RING_RADIUS,
      radius: THEME_SWATCH_RADIUS,
      active: state.menu.activeTargetId === `menu-theme-${preset.id}`,
      selected: themeMatchesPreset(state.theme, preset)
    };
  });
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
  state.build.active = false;
  state.mouse.down = false;
  updateUpgradeSelectionFromMouse();
}

function closeUpgrades() {
  state.upgrades.active = false;
}

function toggleBuildMode() {
  if (isInputBlocked() || state.room?.state !== "active") {
    return;
  }

  state.build.active = !state.build.active;
  state.upgrades.active = false;
  state.mouse.down = false;
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
  const speedLevel = clamp(speed / Math.max(1, ENGINE.ship.maxSpeed), 0, 1);
  const engineLevel = alive && player.thrusting ? Math.max(0.28, speedLevel) : 0;
  const miningActive = alive && player.mining === true;
  const miningContact = miningActive && player.miningRay?.hit === true;

  updateEngineAudio(context, engineLevel, speedLevel, timeSeconds);
  updateMiningAudio(context, miningActive, miningContact, timeSeconds);
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

function updateMiningAudio(context, active, contact, timeSeconds) {
  const shipAudio = audio.ship;
  const now = context.currentTime;
  const targetGain = active
    ? MINING_AUDIO_MAX_GAIN * (contact ? 1 : 0.74)
    : 0.0001;
  const baseFrequency = 310 + Math.sin(timeSeconds * 7.5) * 18 + (contact ? 32 : 0);

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
  if (state.chat.active || isInputBlocked()) {
    return normalizeInput({
      sessionId: inputSessionId,
      seq: state.inputSeq,
      moveX: 0,
      moveY: 0,
      aimAngle: state.mouse.aimAngle,
      mining: false,
      huckRock: false,
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
    mining: state.mouse.down && !state.upgrades.active && !state.build.active,
    huckRock: readHuckRockInput(),
    interact: false,
    build: false
  });
}

function readHuckRockInput() {
  const roomState = state.room?.state;
  if (
    !keys.has("Space") ||
    state.mouse.down ||
    (roomState !== "waiting" && roomState !== "active") ||
    state.upgrades.active ||
    state.build.active
  ) {
    return false;
  }

  if (roomState === "active") {
    const player = localPlayerFromSnapshot();
    if ((player?.resources?.rock || 0) < (ENGINE.huckRock.costRock || 0)) {
      return false;
    }
  }

  const now = performance.now() / 1000;
  if (now >= state.nextHuckRockThunkAtSeconds) {
    requestHuckRockThunk();
    state.nextHuckRockThunkAtSeconds = now + ENGINE.huckRock.fireIntervalSeconds;
  }

  return true;
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

function isMovementKey(code) {
  return ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(code);
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
    mining: state.mouse.down && !state.chat.active && !state.upgrades.active && !state.build.active && !isInputBlocked()
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
  const isMoving = move.x !== 0 || move.y !== 0;

  if (isMoving) {
    predicted.angle = normalizeAngle(Math.atan2(move.y, move.x));
    predicted.vx += move.x * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
    predicted.vy += move.y * ENGINE.ship.thrust * effects.thrustMultiplier * dtSeconds;
  }

  predicted.aimAngle = state.mouse.aimAngle;
  predicted.mining = state.mouse.down && !state.chat.active && !state.upgrades.active && !state.build.active && !isInputBlocked();
  if (predicted.mining) {
    predicted.miningHoldSeconds = (predicted.miningHoldSeconds || 0) + dtSeconds;
  } else {
    predicted.miningHoldSeconds = 0;
  }
  predicted.rayExtension = miningRayExtension(predicted.mining, predicted.miningHoldSeconds);
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
  resolvePredictionCollisions(predicted, effects);
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
    miningHoldSeconds: predicted.miningHoldSeconds,
    rayExtension: predicted.rayExtension,
    thrusting: predicted.thrusting
  };
}

function renderSnapshot(timeSeconds) {
  if (!state.snapshot) {
    return null;
  }

  updateEntitySmoothing(timeSeconds);
  const sourceEntities = Array.isArray(state.snapshot.entities) ? state.snapshot.entities : [];
  if (sourceEntities.length === 0) {
    return state.snapshot;
  }

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

  return {
    ...state.snapshot,
    entities
  };
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
      state.entitySmoothing.byId.set(entity.id, {
        type: entity.type,
        fragment: Boolean(entity.fragment),
        render: cloneRenderEntity(entity),
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

    const hit = sweptCircleBoundsHit(
      previousX,
      previousY,
      rock.x,
      rock.y,
      rock.radius,
      blocker.x,
      blocker.y,
      blocker.size,
      blocker.size
    ) || circleTileOverlap(rock, blocker);
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

function resolvePredictionCollisions(player, effects) {
  resolvePredictionAsteroidCollisions(player);
  resolvePredictionPlayerCollisions(player);
  const velocity = clampMagnitude(player.vx, player.vy, ENGINE.ship.maxSpeed * effects.maxSpeedMultiplier);
  player.vx = velocity.x;
  player.vy = velocity.y;
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
      const hit = circleTileOverlap(player, blocker);
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
    return {};
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

function buildWallAtMouse() {
  const target = buildTargetFromMouse();
  if (!target?.valid || !socket.connected) {
    return;
  }

  socket.emit(CLIENT_EVENTS.buildWall, {
    tileX: target.tileX,
    tileY: target.tileY
  });
}

function buildTargetFromMouse() {
  if (!state.build.active || state.room?.state !== "active" || !state.asteroid || !state.snapshot) {
    return null;
  }

  const player = predictedLocalPlayer() || localPlayerFromSnapshot();
  if (!player?.alive) {
    return null;
  }

  const tileSize = state.asteroid.tileSize || 16;
  const camera = {
    x: player.x - state.snapshot.render.width / 2,
    y: player.y - state.snapshot.render.height / 2
  };
  const tileX = Math.floor((camera.x + state.mouse.x) / tileSize);
  const tileY = Math.floor((camera.y + state.mouse.y) / tileSize);
  const index = tileY * state.asteroid.widthTiles + tileX;
  const inBounds = tileX >= 0 &&
    tileY >= 0 &&
    tileX < state.asteroid.widthTiles &&
    tileY < state.asteroid.heightTiles;
  const inRange = inBounds && tileWithinBuildRadius(player, tileX, tileY, tileSize);
  const empty = inBounds && state.asteroid.tiles[index] === ASTEROID_TILE.empty;
  const playable = inBounds && isPlayableBuildIndex(index);
  const stormSafe = inBounds && !isStormBuildIndex(index);
  const clear = inBounds && !tileOverlapsVisiblePlayer(tileX, tileY, tileSize);
  const affordable = (player.resources?.rock || 0) >= ENGINE.build.wallCostRock;

  return {
    tileX,
    tileY,
    index,
    inRange,
    empty,
    playable,
    clear,
    affordable,
    valid: inRange && empty && playable && stormSafe && clear && affordable
  };
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

  if (x < rowLeft || x > rowRight || y < rowTop - UPGRADE_MENU_LAYOUT.rowHitPadding || y >= rowBottom) {
    return null;
  }

  return clamp(
    Math.floor((y - rowTop + UPGRADE_MENU_LAYOUT.rowHitPadding) / UPGRADE_MENU_LAYOUT.rowHeight),
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
