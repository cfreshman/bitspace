import { ENGINE, RENDER } from "/shared/constants.js";
import {
  ASTEROID_TILE,
  blockingTilesNearCircle,
  createLobbyAsteroid,
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
const ELIMINATION_NOTICE_SECONDS = 4;
const ELIMINATION_NOTICE_MAX = 3;
const MENU_PLAYER_ID = "menu-player";
const MENU_ROOMS = Object.freeze({
  ready: "ready",
  theme: "theme"
});
const MENU_BUTTON_WIDTH = 112;
const MENU_BUTTON_WIDE_WIDTH = 128;
const MENU_BUTTON_HEIGHT = 32;
const MENU_BUTTON_GAP = 24;
const THEME_CANDIDATE_COUNT = 192;
const THEME_MIN_RGB_DISTANCE = 118;
const THEME_MIN_CONTRAST_RATIO = 3.2;
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
    state.build.active = false;
    state.menu.readySent = false;
    state.menu.activeTargetId = null;
    enterMenuRoom(MENU_ROOMS.ready);
    forgetRegisteredRoom();
    return;
  }

  rememberRegisteredRoom(room.roomId);
  if (previousState !== room.state || previousRoomId !== nextRoomId) {
    state.upgrades.active = false;
    state.build.active = false;
    cancelMiningRay();
  }
  if (room?.state === "menu") {
    state.menu.readySent = false;
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

requestAnimationFrame(draw);

function draw(now = 0) {
  const timeSeconds = now / 1000;
  const readyMenu = isReadyMenu();

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
  const snapshot = readyMenu ? menuSnapshot() : state.snapshot;
  const playerId = readyMenu ? MENU_PLAYER_ID : state.playerId;
  const menuPlayer = readyMenu ? state.menu.player : null;
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

function createMenuState() {
  const asteroid = createLobbyAsteroid({ seed: "bitspace-menu" });

  return {
    room: MENU_ROOMS.ready,
    tick: 0,
    lastTimeSeconds: 0,
    readySent: false,
    activeTargetId: null,
    buttonTargetId: null,
    buttonTargetSeconds: 0,
    buttonTargetActivated: false,
    asteroid,
    player: createMenuPlayer(asteroid)
  };
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

  const player = state.menu.player;
  const center = menuCenter(state.menu.asteroid);
  state.menu.room = room;
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
  player.rayExtension = clamp(player.miningHoldSeconds / ENGINE.mining.rayExtendSeconds, 0, 1);

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

  updateMenuMiningRay(player, dtSeconds);
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
    const hit = rayRectIntersection(start, direction, entity, maxDistance);
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

  if (entity.action === "randomize") {
    randomizeTheme();
    return;
  }

  if (entity.action === "reset") {
    resetTheme();
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

function menuSnapshot() {
  const world = menuWorld(state.menu.asteroid);
  return {
    arenaId: `menu-${state.menu.room}`,
    tick: state.menu.tick,
    serverTime: Date.now(),
    render: RENDER,
    world,
    players: [{ ...state.menu.player }],
    asteroidMining: [],
    entities: menuEntities(),
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
    const commandTop = center.y + 24;
    const backTop = commandTop + MENU_BUTTON_HEIGHT + 20;

    return [
      menuButton("menu-randomize", "randomize", "RANDOM", center.x - MENU_BUTTON_WIDTH - MENU_BUTTON_GAP / 2, commandTop, MENU_BUTTON_WIDTH),
      menuButton("menu-reset", "reset", "RESET", center.x + MENU_BUTTON_GAP / 2, commandTop, MENU_BUTTON_WIDTH),
      menuButton("menu-back", "back", "BACK", center.x - MENU_BUTTON_WIDTH / 2, backTop, MENU_BUTTON_WIDTH)
    ];
  }

  return [
    menuButton("menu-ready", "ready", "READY", center.x - MENU_BUTTON_WIDTH - MENU_BUTTON_GAP / 2, top, MENU_BUTTON_WIDTH),
    menuButton("menu-theme", "theme", "THEME", center.x + MENU_BUTTON_GAP / 2, top, MENU_BUTTON_WIDTH)
  ];
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
      return stored;
    }
  } catch {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  }

  return defaultTheme();
}

function randomizeTheme() {
  state.theme = randomTheme();
  saveTheme();
}

function resetTheme() {
  state.theme = defaultTheme();
  saveTheme();
}

function randomTheme() {
  const generators = [
    randomComplementaryTheme,
    randomSplitComplementaryTheme,
    randomAnalogousTheme,
    randomTriadicTheme,
    randomMonochromeTheme,
    randomWarmCoolTheme,
    randomMutedTheme,
    randomAccentTheme
  ];
  const primaryGenerator = randomPick(generators);

  return weightedThemePick(themeCandidatePool([primaryGenerator], THEME_CANDIDATE_COUNT)) ||
    weightedThemePick(themeCandidatePool(generators, THEME_CANDIDATE_COUNT * 2)) ||
    defaultTheme();
}

function themeCandidatePool(generators, count) {
  const candidates = [];

  for (let attempt = 0; attempt < count; attempt += 1) {
    const candidate = randomPick(generators)();
    const metrics = themeMetrics(candidate);
    if (passesThemeFilters(candidate, metrics)) {
      candidates.push({
        theme: candidate.theme,
        score: scoreThemeCandidate(candidate, metrics)
      });
    }
  }

  return candidates;
}

function randomComplementaryTheme() {
  const hue = randomHue();
  return themeCandidate("complementary", hue, hue + 180, {
    backgroundSaturation: [14, 58],
    backgroundLightness: [7, 25],
    foregroundSaturation: [30, 82],
    foregroundLightness: [54, 80]
  });
}

function randomSplitComplementaryTheme() {
  const hue = randomHue();
  return themeCandidate("split-complementary", hue, hue + randomPick([150, 210]), {
    backgroundSaturation: [12, 52],
    backgroundLightness: [8, 25],
    foregroundSaturation: [34, 82],
    foregroundLightness: [54, 78]
  });
}

function randomAnalogousTheme() {
  const hue = randomHue();
  return themeCandidate("analogous", hue, hue + randomPick([-45, -30, 30, 45]), {
    backgroundSaturation: [14, 44],
    backgroundLightness: [8, 27],
    foregroundSaturation: [28, 72],
    foregroundLightness: [58, 82]
  });
}

function randomTriadicTheme() {
  const hue = randomHue();
  return themeCandidate("triadic", hue, hue + randomPick([120, 240]), {
    backgroundSaturation: [16, 56],
    backgroundLightness: [7, 24],
    foregroundSaturation: [32, 78],
    foregroundLightness: [54, 80]
  });
}

function randomMonochromeTheme() {
  const hue = randomHue();
  return themeCandidate("monochrome", hue, hue + randomRange(-8, 8), {
    backgroundSaturation: [8, 38],
    backgroundLightness: [6, 22],
    foregroundSaturation: [22, 64],
    foregroundLightness: [62, 84]
  });
}

function randomWarmCoolTheme() {
  const warmHue = randomPick([8, 24, 38, 340]) + randomRange(-10, 10);
  const coolHue = randomPick([178, 202, 224, 258]) + randomRange(-14, 14);
  const warmBackground = randomFloat() < 0.5;
  return themeCandidate("warm-cool", warmBackground ? warmHue : coolHue, warmBackground ? coolHue : warmHue, {
    backgroundSaturation: [16, 54],
    backgroundLightness: [7, 24],
    foregroundSaturation: [28, 76],
    foregroundLightness: [56, 80]
  });
}

function randomMutedTheme() {
  const hue = randomHue();
  return themeCandidate("muted", hue, hue + randomPick([90, 120, 150, 180, 210, 240, 270]), {
    backgroundSaturation: [6, 28],
    backgroundLightness: [10, 30],
    foregroundSaturation: [16, 46],
    foregroundLightness: [62, 84]
  });
}

function randomAccentTheme() {
  const hue = randomHue();
  return themeCandidate("accent", hue, hue + randomPick([105, 135, 180, 225, 255]), {
    backgroundSaturation: [30, 70],
    backgroundLightness: [5, 18],
    foregroundSaturation: [38, 86],
    foregroundLightness: [50, 74]
  });
}

function themeCandidate(strategy, backgroundHue, foregroundHue, options = {}) {
  const backgroundHsl = {
    h: normalizeHue(backgroundHue),
    s: randomRange(...(options.backgroundSaturation || [18, 46])),
    l: randomRange(...(options.backgroundLightness || [9, 23]))
  };
  const foregroundHsl = {
    h: normalizeHue(foregroundHue),
    s: randomRange(...(options.foregroundSaturation || [40, 74])),
    l: randomRange(...(options.foregroundLightness || [60, 80]))
  };
  const background = hslToRgb(backgroundHsl.h, backgroundHsl.s, backgroundHsl.l);
  const foreground = hslToRgb(foregroundHsl.h, foregroundHsl.s, foregroundHsl.l);

  return {
    strategy,
    foreground,
    background,
    foregroundHsl,
    backgroundHsl,
    theme: {
      foreground: rgbToHex(foreground),
      background: rgbToHex(background)
    }
  };
}

function themeMetrics(candidate) {
  const foregroundLuminance = relativeLuminance(candidate.foreground);
  const backgroundLuminance = relativeLuminance(candidate.background);
  return {
    foregroundLuminance,
    backgroundLuminance,
    contrastRatio: contrastRatio(foregroundLuminance, backgroundLuminance),
    luminanceDelta: foregroundLuminance - backgroundLuminance,
    rgbDistance: rgbDistance(candidate.foreground, candidate.background),
    hueGap: hueDistance(candidate.foregroundHsl.h, candidate.backgroundHsl.h),
    foregroundMaxChannel: Math.max(candidate.foreground.r, candidate.foreground.g, candidate.foreground.b),
    backgroundMaxChannel: Math.max(candidate.background.r, candidate.background.g, candidate.background.b)
  };
}

function passesThemeFilters(candidate, metrics) {
  return metrics.foregroundLuminance > metrics.backgroundLuminance &&
    metrics.contrastRatio >= THEME_MIN_CONTRAST_RATIO &&
    metrics.rgbDistance >= THEME_MIN_RGB_DISTANCE &&
    metrics.luminanceDelta >= 0.20 &&
    metrics.backgroundLuminance >= 0.006 &&
    metrics.backgroundLuminance <= 0.24 &&
    metrics.foregroundLuminance >= 0.24 &&
    metrics.foregroundLuminance <= 0.76 &&
    metrics.backgroundMaxChannel <= 158 &&
    metrics.foregroundMaxChannel <= 246 &&
    candidate.backgroundHsl.s <= 74 &&
    candidate.foregroundHsl.s >= 16 &&
    candidate.foregroundHsl.s <= 88 &&
    candidate.foregroundHsl.l - candidate.backgroundHsl.l >= 30;
}

function scoreThemeCandidate(candidate, metrics) {
  const contrastScore = clamp((metrics.contrastRatio - THEME_MIN_CONTRAST_RATIO) / 3.2, 0, 1);
  const distanceScore = clamp((metrics.rgbDistance - THEME_MIN_RGB_DISTANCE) / 100, 0, 1);
  const backgroundScore = softRangeScore(metrics.backgroundLuminance, 0.01, 0.20, 0.03, 0.15);
  const foregroundScore = softRangeScore(metrics.foregroundLuminance, 0.26, 0.74, 0.34, 0.66);
  const saturationScore =
    softRangeScore(candidate.foregroundHsl.s, 18, 84, 30, 76) * 0.65 +
    softRangeScore(candidate.backgroundHsl.s, 4, 70, 10, 58) * 0.35;
  const hueScore = candidate.strategy === "monochrome"
    ? 0.55
    : clamp(metrics.hueGap / 180, 0, 1);
  const brightnessPenalty =
    clamp((metrics.foregroundMaxChannel - 235) / 20, 0, 1) * 0.45 +
    clamp((metrics.backgroundMaxChannel - 146) / 18, 0, 1) * 0.45;

  return contrastScore * 1.4 +
    distanceScore +
    backgroundScore +
    foregroundScore +
    saturationScore * 0.8 +
    hueScore * 0.45 -
    brightnessPenalty +
    randomFloat() * 0.08;
}

function softRangeScore(value, outerMin, outerMax, innerMin, innerMax) {
  if (value >= innerMin && value <= innerMax) {
    return 1;
  }

  if (value < innerMin) {
    return clamp((value - outerMin) / (innerMin - outerMin), 0, 1);
  }

  return clamp((outerMax - value) / (outerMax - innerMax), 0, 1);
}

function weightedThemePick(candidates) {
  if (candidates.length === 0) {
    return null;
  }

  const minScore = Math.min(...candidates.map((candidate) => candidate.score));
  const weights = candidates.map((candidate) => Math.pow(Math.max(0.04, candidate.score - minScore + 0.35), 1.15));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let cursor = randomFloat() * totalWeight;

  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return candidates[index].theme;
    }
  }

  return candidates[candidates.length - 1].theme;
}

function contrastRatio(a, b) {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function hueDistance(a, b) {
  const distance = Math.abs(normalizeHue(a) - normalizeHue(b));
  return Math.min(distance, 360 - distance);
}

function normalizeHue(hue) {
  return ((hue % 360) + 360) % 360;
}

function hslToRgb(hue, saturation, lightness) {
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const h = normalizeHue(hue) / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = l - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 1) {
    r = chroma;
    g = x;
  } else if (h < 2) {
    r = x;
    g = chroma;
  } else if (h < 3) {
    g = chroma;
    b = x;
  } else if (h < 4) {
    g = x;
    b = chroma;
  } else if (h < 5) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function relativeLuminance(color) {
  return 0.2126 * linearRgb(color.r) +
    0.7152 * linearRgb(color.g) +
    0.0722 * linearRgb(color.b);
}

function linearRgb(value) {
  const channel = clamp(value, 0, 255) / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function randomHue() {
  return randomRange(0, 360);
}

function randomRange(min, max) {
  return min + randomFloat() * (max - min);
}

function randomPick(values) {
  return values[Math.floor(randomFloat() * values.length)];
}

function randomFloat() {
  const bytes = new Uint32Array(1);
  window.crypto?.getRandomValues?.(bytes);
  if (bytes[0] !== 0) {
    return bytes[0] / 0x100000000;
  }

  return Math.random();
}

function rgbDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.hypot(dr, dg, db);
}

function rgbToHex(color) {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

function hexToRgb(value) {
  const hex = isHexColor(value) ? value.slice(1) : "000000";
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function hexByte(value) {
  return clamp(Math.floor(value), 0, 255).toString(16).padStart(2, "0");
}

function defaultTheme() {
  return {
    foreground: RENDER.foreground,
    background: RENDER.background
  };
}

function saveTheme() {
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state.theme));
}

function isValidTheme(theme) {
  return Boolean(theme) &&
    isHexColor(theme.foreground) &&
    isHexColor(theme.background);
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
    interact: false,
    build: false
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
  predicted.rayExtension = clamp(predicted.miningHoldSeconds / ENGINE.mining.rayExtendSeconds, 0, 1);
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
    const blockers = blockingTilesNearCircle(state.asteroid, player.x, player.y, player.radius);

    for (const blocker of blockers) {
      const hit = circleTileOverlap(player, blocker);
      if (!hit) {
        continue;
      }

      player.x += hit.normalX * hit.overlap;
      player.y += hit.normalY * hit.overlap;

      const normalSpeed = player.vx * hit.normalX + player.vy * hit.normalY;
      if (normalSpeed < 0) {
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
    valid: inRange && empty && playable && clear && affordable
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
    "KeyQ",
    "KeyE",
    "Space"
  ].includes(code);
}
