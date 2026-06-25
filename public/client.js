import { ENGINE, GAME_MODES, RENDER } from "/shared/constants.js";
import { buildClosestTileRing, buildTileVisibleFromOrigin, closestBuildTileByCenterAngle } from "/shared/build.js";
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
import { simulateCarMovement } from "/shared/car-physics.js";
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
  setBotDebugEnabled,
  setBotProfileEnabled,
  snapshotPilotBotBrain,
  updatePilotBotBrain,
  updatePilotBotLocalPlanner
} from "/shared/bots.js";
import { bitspaceCoreStats, resetBitspaceCoreStats } from "/shared/core/bitspace-core.js";
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
import { applyArenaSnapshotDelta } from "/shared/snapshot-delta.js";
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
const PERF_DEBUG_STORAGE_KEY = "bitspace.debugPerf";
const PLAYER_MAP_STORAGE_KEY = "bitspace.playerMap";
const SPECTATOR_TARGET_STORAGE_KEY = "bitspace.spectatorTarget";
const SETTINGS_STORAGE_KEY = "bitspace.settings";
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
const MINING_AUDIO_MAX_GAIN = 0.0066;
const AUDIO_CLUNK_COOLDOWN_SECONDS = 0.16;
const AUDIO_COLLISION_CLUNK_SPEED = 18;
const AUDIO_ROCK_THUMP_COOLDOWN_SECONDS = 0.14;
const AUDIO_ROCK_THUMP_SPEED = 10;
const VOICE_REMOTE_GAIN = 0.82;
const VOICE_GAIN_FADE_IN_SECONDS = 0.25;
const VOICE_GAIN_FADE_OUT_SECONDS = 1;
const VOICE_RETRY_DELAY_MS = 5000;
const VOICE_PEER_REFRESH_MS = 2500;
const VOICE_MAX_TARGET_CHECKS = 5;
const VOICE_RTC_CONFIGURATION = Object.freeze({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
});
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
const PLAYER_MAP_FULL_STORM_BAND_TILES = 4;
const PLAYER_MAP_UNKNOWN = 255;
const PLAYER_MAP_BACKGROUND = 0;
const PLAYER_MAP_FOREGROUND = 2;
const PLAYER_MAP_STORM = 3;
const DEBUG_FEATURES = {
  playerMap: false
};
const MENU_PLAYER_ID = "menu-player";
const LOCAL_BOT_ROOM_ID = "local-bots";
const LOCAL_BOT_PLAYER_ID = "local-player";
const LOCAL_BOT_MIN_COUNT = 1;
const LOCAL_BOT_MAX_COUNT = 7;
const LOCAL_BOT_DEFAULT_COUNT = 5;
const LOCAL_BOT_SAVE_VERSION = 2;
const LOCAL_BOT_SAVE_INTERVAL_SECONDS = 1;
const LOCAL_BOT_PLAN_INTERVAL_TICKS = 12;
const LOCAL_BOT_INPUT_INTERVAL_TICKS = 2;
const LOCAL_BOT_MAX_STEPS_PER_FRAME = 4;
const BOT_DEBUG_CHUNK_TILES = 16;
const MUSIC_TRACKS = Object.freeze({
  menu: "/music/menu.mp3",
  lobby: "/music/lobby.mp3",
  arena: "/music/arena.mp3"
});
const MUSIC_TRACK_FULL_VOLUME_SETTING = 0.5;
const MUSIC_VISIBLE_OTHER_HOLD_MS = 2500;
const MUSIC_CROSSFADE_SECONDS = 0.16;
const MUSIC_ROOM_START_FORCE_ARENA_MS = 750;
const MUSIC_ROOM_START_CROSSFADE_SECONDS = 0.045;
const MENU_ROOMS = Object.freeze({
  ready: "ready",
  theme: "theme",
  settings: "prefs"
});
const HUD_LOCATIONS = Object.freeze(["top-left", "top", "bottom"]);
const DEFAULT_SETTINGS = Object.freeze({
  hudLocation: "top-left",
  voiceChat: true,
  micCapture: true,
  masterVolume: 1,
  effectsVolume: 1,
  musicVolume: MUSIC_TRACK_FULL_VOLUME_SETTING,
  voiceVolume: 1
});
const SETTINGS_PANEL = Object.freeze({
  minWidth: 132,
  rowHeight: 18,
  headerHeight: 26,
  padding: 8,
  bottomPadding: 8,
  columnGap: 10,
  sliderWidth: 64,
  sliderEndPadding: 10,
  edgeInset: 8
});
const VOLUME_PREVIEW_MIN_INTERVAL_SECONDS = 0.12;
const MENU_BUTTON_WIDTH = 112;
const MENU_BUTTON_WIDE_WIDTH = 128;
const MENU_BUTTON_HEIGHT = 32;
const MENU_BUTTON_GAP = 24;
const MENU_ESRB_SUBTITLE = "online interactions not rated by the ESRB";
const MENU_MINING_RAY_MIN_COUNT = 1;
const MENU_MINING_RAY_MAX_COUNT = 3;
const MENU_SPEED_UPGRADE_ID = "speed";
const PERF_DEBUG_PANEL_INTERVAL_MS = 250;
const THEME_SWATCH_RADIUS = 15.5;
const THEME_SWATCH_RING_RADIUS = 84;
const THEME_ASTEROID_GAP = 24;
const THEME_RANDOM_ID = "menu-theme-random";
const THEME_BACK_ID = "menu-theme-back";
const THEME_SWATCH_EFFECT_HOLD_MS = 1000;
const THEME_SWATCH_EFFECT_FADE_MS = 150;
const THEME_RANDOM_MIN_HUE_DISTANCE_DEGREES = 15;
const THEME_REPEAT_RANDOM_MIN_HUE_DISTANCE_DEGREES = 30;
const THEME_RANDOM_CONTRAST_SAMPLES = 10;
const THEME_PRESETS = Object.freeze([
  // { id: "blue", label: "BLUE", background: "#1f2433", foreground: "#74cbef" },
  // { id: "blue", label: "BLUE", background: "#1f2433", foreground: "#efcb74" },
  { id: "blue", label: "BLUE", background: "#231f33", foreground: "#74acef" },
  // { id: "mono", label: "MONO", background: "#000000", foreground: "#ffffff", backing: "#100810" },
  { id: "mono", label: "MONO", background: "#222222", foreground: "#ffffff" },
  // { id: "green", label: "GREEN", background: "#27543c", foreground: "#ffbf00" },
  // { id: "ember", label: "EMBER", background: "#211c26", foreground: "#ff6f4f" },
  // { id: "tan", label: "TAN", background: "#555452", foreground: "#ffc366" },
  // { id: "plum", label: "PLUM", background: "#412c34", foreground: "#d8bd7a" },
  // { id: "ice", label: "ICE", background: "#1f353d", foreground: "#9bf7ff" },
  // { id: "sodium", label: "SODIUM", background: "#202419", foreground: "#ffd84a" },
  // { id: "amber", label: "AMBER", background: "#18110d", foreground: "#ffb24a" },
  // { id: "amber", label: "EMBER", background: "#221c19", foreground: "#ffad3d", backing: '#100000' },
  // { id: "matrix", label: "MATRIX", background: "#111111", foreground: "#00ff00" }
  // { id: "honey", label: "HONEY", background: "#D19B3D", foreground: "#F7E2B1", backing: "#9C743B" },
  // { id: "honey", label: "HONEY", background: "#9C743B", foreground: "#F7E2B1", backing: "#2E2214" },
  // { id: "test", label: "TEST", background: "#5a5353", foreground: "#e6ccbe", backing: "#101010" },
  { id: "matrix", label: "MATRIX", background: "#182018", foreground: "#00ff00" },
  { id: "love", label: "LOVE", background: "#2e2234", foreground: "#ff72b6", backing: '#10080a' },
  { id: "blood", label: "BLOOD", background: "#300810", foreground: "#ff0000", backing: "#180008" },
  { id: "honey", label: "HONEY", background: "#d0942f", foreground: "#F7E2B1", backing: "#9C743B" },
  { id: "plant", label: "PLANT", background: "#3ba94d", foreground: "#77ff77", backing: "#2d7949" },
  // { id: "blossom", label: "BLOSSOM", background: "#A4133C", foreground: "#FFCCD5", backing: "#590D22" },
  // { id: "cloud", label: "CLOUD", background: "#3b89a9", foreground: "#9af2ff", backing: "#b1b1b1" },
  { id: "cloud", label: "CLOUD", background: "#3b89a9", foreground: "#9af2ff", backing: "#77bcd9" },
  { id: "hyper", label: "HYPER", background: "#007fff", foreground: "#f87cff", backing: "#005fbe" },
  { id: "berry", label: "BERRY", background: "#3b67a9", foreground: "#efaeff", backing: "#494758" },
  { id: "blue-angel", label: "BLUE ANGEL", background: "#004168", foreground: "#ffbc3d", backing: '#2a292b' },
]);
const UPGRADE_MENU_LAYOUT = Object.freeze({
  x: 8,
  y: 70,
  padding: 8,
  titleTop: 8,
  rowTopOffset: 20,
  rowHeight: 16,
  rowInset: 8,
  labelOffset: 14,
  columnGap: 8,
  rowHitPadding: 2,
  dividerTopGap: 5,
  dividerBottomGap: 5,
  rowTextHeight: 7,
  detailLineHeight: 12,
  detailLineCount: 4,
  bottomPadding: 8
});
const MOBILE_POINTER_QUERY = "(pointer: coarse)";
const MOBILE_HUD_SCALE = 1.75;
const HUD_EDGE_INSET = 0;
const MOBILE_HUD_EDGE_INSET = HUD_EDGE_INSET;
const MOBILE_JOYSTICK_DEADZONE_RATIO = 0.22;
const MOBILE_JOYSTICK_MIN_DEADZONE = 8;
const MOBILE_JOYSTICK_MIN_RADIUS = 42;
const MOBILE_JOYSTICK_MAX_RADIUS = 72;
const MOBILE_HUCK_ROCK_QUEUE_SECONDS = 0.35;
const MOBILE_UPGRADE_CLOSE_ACTION = Object.freeze({
  gap: 7,
  width: 52,
  height: 13
});
const HUD_PANEL_MIN_WIDTH = 112;
const HUD_PANEL_PADDING = 4;
const HUD_PANEL_TEXT_HEIGHT = 7;
const HUD_PANEL_ROW_STEP = 10;
const HUD_PANEL_ACTION_GAP = 7;
const MOBILE_HUD_ACTION_X = HUD_EDGE_INSET;
const MOBILE_HUD_ACTION_WIDTH = 118;
const MOBILE_HUD_ACTION_HEIGHT = 12;
const HUD_CONTROL_VISIBLE_HEIGHT = 9;
const MOBILE_CONTROL_LINE_STEP = MOBILE_HUD_ACTION_HEIGHT + 8;
const TERMINAL_LEAVE_ACTION = Object.freeze({
  x: HUD_EDGE_INSET,
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
const mobileControlsRoot = document.querySelector("#mobile-controls");
const mobileMoveJoystick = document.querySelector("#mobile-move-joystick");
const mobileMoveJoystickCanvas = document.querySelector("#mobile-move-joystick-canvas");
const mobileAimJoystick = document.querySelector("#mobile-aim-joystick");
const mobileAimJoystickCanvas = document.querySelector("#mobile-aim-joystick-canvas");
const perfDebugRoot = document.querySelector("#perf-debug");
const perfDebugPanel = document.querySelector("#perf-debug-panel");
const perfDebugCopy = document.querySelector("#perf-debug-copy");
const mapGenMode = isMapGenMode();
const renderer = mapGenMode ? createMapGenRendererStub() : createRenderer(canvas, minimapCanvas);
const gamepadControls = createGamepadControls();
const talkInput = createTalkInput();
const themeSource = document.querySelector("#bitspace-theme-source");
const cssDefaultTheme = readThemeSource() || {
  foreground: RENDER.foreground,
  background: RENDER.background
};
let perfDebugCopyResetTimer = null;
const keys = new Set();
const releasedKeysUntilKeyup = new Set();
const storedClientId = getClientId();
const storedClientSecret = getClientSecret();
const inputSessionId = randomClientSecret();
const audio = {
  context: null,
  unlocked: false,
  pendingBeeps: 0,
  pendingMelodies: [],
  ship: null,
  lastHealth: null,
  lastShake: 0,
  lastClunkAtSeconds: 0,
  lastRockThumpAtSeconds: 0,
  pendingDamage: 0,
  lastDamagePlayerId: "",
  huckRockAudioPlayerId: "",
  lastHuckRockCooldownSeconds: 0,
  endSoundKey: "",
  defeatSoundKey: "",
  lastDefeatAtSeconds: -Infinity,
  lastVolumePreviewAtSeconds: -Infinity,
  huckRockBuffer: null,
  rockThumpBuffer: null,
  music: {
    tracks: null,
    gain: null,
    currentKey: "",
    lastPlayAttemptAtMs: 0,
    visibleOtherUntilMs: 0,
    forceArenaUntilMs: 0,
    fastSwitchUntilMs: 0
  }
};
const voice = {
  userGesture: false,
  joined: false,
  starting: false,
  failed: false,
  micError: null,
  micAttempted: false,
  micStarting: false,
  retryAtMs: 0,
  roomId: null,
  lastJoinAnnounceAtMs: 0,
  localStream: null,
  localSource: null,
  localAnalyser: null,
  localZeroGain: null,
  peers: new Map()
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
    botCount: LOCAL_BOT_DEFAULT_COUNT,
    lobbySeed: null,
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
  perfDebug: {
    enabled: loadPerfDebug(),
    lastNowMs: 0,
    fps: 0,
    frameMs: 0,
    updateMs: 0,
    renderMs: 0,
    drawMs: 0,
    presentMs: 0,
    minimapMs: 0,
    stormGpuMs: 0,
    stormGpuReadMs: 0,
    stormGpuCalls: 0,
    stormGpuRequests: 0,
    visibilityGpuMs: 0,
    visibilityGpuReadMs: 0,
    visibilityGpuCalls: 0,
    visibilityGpuRequests: 0,
    stormGpuReady: false,
    frameGpuReady: false,
    frameStormReady: false,
    frameCheckerReady: false,
    buckets: {},
    panelLastUpdateMs: 0,
    panelLastText: "",
    panelLastColor: ""
  },
  entitySmoothing: {
    byId: new Map()
  },
  net: {
    inputSentCount: 0,
    inputRate: 0,
    lastInputRateAtMs: 0,
    snapshotCount: 0,
    snapshotRate: 0,
    lastSnapshotRateAtMs: 0,
    lastSnapshotAtMs: 0,
    snapshotAgeMs: 0,
    lastSnapshotBytes: 0,
    lastSnapshotDelta: false
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
  huckRockNeedRockFlashArmed: true,
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
  mobile: {
    enabled: false,
    move: { x: 0, y: 0 },
    moveJoystick: {
      pointerId: null,
      active: false,
      engaged: false,
      x: 0,
      y: 0,
      centerX: 0,
      centerY: 0,
      radius: 0
    },
    aimJoystick: {
      pointerId: null,
      active: false,
      engaged: false,
      x: 0,
      y: 0,
      centerX: 0,
      centerY: 0,
      radius: 0
    },
    aimAngle: 0,
    huckRockQueued: false,
    huckRockQueuedUntilSeconds: 0,
    huckRockTarget: null
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
  settings: loadSettings(),
  settingsUi: {
    selectedIndex: 0,
    navDirection: 0,
    valueDirection: 0,
    dragIndex: null,
    dragPointerId: null
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

state.menu.themeBaseId = themePresetIdForTheme(state.theme);

setBotDebugEnabled(state.botDebugOverlay);
installControlHandles();
installPerfDebugCopyButton();
const mobilePointerMedia = typeof window.matchMedia === "function"
  ? window.matchMedia(MOBILE_POINTER_QUERY)
  : null;
syncMobileControlsEnabled();
if (typeof mobilePointerMedia?.addEventListener === "function") {
  mobilePointerMedia.addEventListener("change", syncMobileControlsEnabled);
} else if (typeof mobilePointerMedia?.addListener === "function") {
  mobilePointerMedia.addListener(syncMobileControlsEnabled);
}
document.addEventListener("visibilitychange", handleDocumentVisibilityChange);

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
  syncVoiceRoomState();
});

socket.on("disconnect", () => {
  stopVoiceRoom({ notify: false, keepGesture: true });
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
    setSpectatorTarget(null);
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
    setSpectatorTarget(null);
    state.lastActiveMatchKey = null;
    state.upgrades.active = false;
    closeBuildMode();
    state.menu.readySent = false;
    state.menu.activeTargetId = null;
    resetLocalDamageAudioState();
    syncVoiceRoomState();
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
  if (previousState === "waiting" && room?.state === "active") {
    beginMusicRoomStartTransition();
  }
  if (room?.state === "menu") {
    state.menu.readySent = false;
  }
  if (room?.state === "ended" && previousState && previousState !== "ended") {
    handleRoomEndAudio(room, state.snapshot, performance.now() / 1000);
  }
  syncVoiceRoomState();
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
  state.huckRockNeedRockFlashArmed = true;
  state.controller.cursor.visible = false;
  resetControllerCursorPosition();
  resetControllerUpgradeNav();
  cancelMiningRay();
  releaseSpaceUntilKeyup();
}

socket.on(SERVER_EVENTS.snapshot, (payload) => {
  if (isLocalBotGame()) {
    return;
  }

  const receivedAtSeconds = performance.now() / 1000;
  const snapshot = applyArenaSnapshotDelta(state.snapshot, payload);
  if (!snapshot) {
    return;
  }

  snapshot.receivedAtSeconds = receivedAtSeconds;
  recordNetworkSnapshot(snapshot, receivedAtSeconds * 1000, payload);
  recordEntitySnapshot(snapshot, receivedAtSeconds);
  updateLocalDamageAudio(snapshot, receivedAtSeconds);
  recordEliminations(snapshot, receivedAtSeconds);
  state.snapshot = snapshot;
  handleRoomEndAudio(state.room, snapshot, receivedAtSeconds);
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
    revision: 0,
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
  state.asteroid.revision = (Number(state.asteroid.revision) || 0) + 1;
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

socket.on(SERVER_EVENTS.voicePeers, (payload = {}) => {
  handleVoicePeers(payload);
});

socket.on(SERVER_EVENTS.voicePeerJoined, (payload = {}) => {
  handleVoicePeerJoined(payload);
});

socket.on(SERVER_EVENTS.voicePeerLeft, (payload = {}) => {
  closeVoicePeer(payload.clientId);
});

socket.on(SERVER_EVENTS.voiceSignal, (payload = {}) => {
  handleVoiceSignal(payload);
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

  if (handleMenuRoomShortcutKey(event)) {
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

  if (handleSpectatorCycleKey(event)) {
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
  clearSettingsDrag();
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
  if (handleMobilePointerMove(event)) {
    return;
  }

  revealMousePointer();
  updateMouse(event);
  if (state.mouse.down && !state.build.active && !hasMousePointer()) {
    state.mouse.down = false;
  }
  if (isSettingsMenu()) {
    const hudPoint = eventToHudFramePoint(event);
    if (!updateSettingsDrag(hudPoint.x, hudPoint.y, event.pointerId)) {
      updateSettingsSelectionFromPoint(hudPoint.x, hudPoint.y);
    }
    state.uiHoverId = null;
    return;
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
  if (handleMobilePointerDown(event)) {
    return;
  }

  revealMousePointer();
  event.preventDefault();
  unlockAudio();
  updateMouse(event);
  if (isSettingsMenu()) {
    const hudPoint = eventToHudFramePoint(event);
    handleSettingsPointerDown(hudPoint.x, hudPoint.y, event.pointerId);
    return;
  }
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
  if (handleMobilePointerUp(event)) {
    return;
  }

  revealMousePointer();
  event.preventDefault();
  updateMouse(event);
  state.mouse.down = false;
  clearSettingsDrag(event.pointerId);
});

window.addEventListener("pointercancel", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }
  if (handleMobilePointerUp(event)) {
    return;
  }

  revealMousePointer();
  event.preventDefault();
  updateMouse(event);
  state.mouse.down = false;
  clearSettingsDrag(event.pointerId);
});

window.addEventListener("contextmenu", (event) => {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
});
window.addEventListener("touchstart", preventPageTouchGesture, { passive: false });
window.addEventListener("touchmove", preventPageTouchGesture, { passive: false });
window.addEventListener("gesturestart", preventPageGesture, { passive: false });
window.addEventListener("gesturechange", preventPageGesture, { passive: false });
window.addEventListener("gestureend", preventPageGesture, { passive: false });

function preventPageTouchGesture(event) {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
}

function preventPageGesture(event) {
  if (shouldIgnorePagePointerEvent()) {
    return;
  }

  event.preventDefault();
}

function shouldIgnorePagePointerEvent() {
  return document.body.classList.contains("mapgen-active");
}

function revealMousePointer() {
  setMousePointerHidden(false);
}

function updateMousePointerForControllerInput(input) {
  if (!input.connected) {
    setMousePointerHidden(false);
    return;
  }

  if (input.active) {
    setMousePointerHidden(true);
  }
}

function setMousePointerHidden(hidden) {
  const nextHidden = hidden === true;
  if (state.controller.mousePointerHidden === nextHidden) {
    return;
  }

  state.controller.mousePointerHidden = nextHidden;
  document.documentElement.classList.toggle("controller-pointer-hidden", nextHidden);
  document.body.classList.toggle("controller-pointer-hidden", nextHidden);
}

function syncMobileControlsEnabled() {
  const enabled = Boolean(mobilePointerMedia?.matches);
  state.mobile.enabled = enabled;
  document.body.classList.toggle("mobile-controls", enabled);
  renderer.resize?.();
  if (!enabled) {
    resetMobileJoysticks();
    clearMobileHuckRockQueue();
    state.mobile.move = { x: 0, y: 0 };
  }
  updateMobileControlUi();
}

function mobileControlsActive() {
  return state.mobile.enabled && !state.controller.connected;
}

function mobileAimJoystickEngaged() {
  return mobileControlsActive() && state.mobile.aimJoystick.active && state.mobile.aimJoystick.engaged;
}

function handleMobilePointerMove(event) {
  if (!mobileControlsActive()) {
    return false;
  }

  event.preventDefault();
  updateMouse(event);
  const hudPoint = mobileHudFramePointFromEvent(event);
  if (state.mobile.moveJoystick.active && event.pointerId === state.mobile.moveJoystick.pointerId) {
    updateMobileJoystickFromPointer(event, "move");
  }
  if (state.mobile.aimJoystick.active && event.pointerId === state.mobile.aimJoystick.pointerId) {
    updateMobileJoystickFromPointer(event, "aim");
  }
  state.uiHoverId = screenRoomButtonAtPoint(hudPoint.x, hudPoint.y);
  if (isSettingsMenu()) {
    if (!updateSettingsDrag(hudPoint.x, hudPoint.y, event.pointerId)) {
      updateSettingsSelectionFromPoint(hudPoint.x, hudPoint.y);
    }
    state.uiHoverId = null;
  }
  if (state.upgrades.active) {
    updateUpgradeSelectionFromPoint(hudPoint.x, hudPoint.y);
  }
  return true;
}

function handleMobilePointerDown(event) {
  if (!mobileControlsActive()) {
    return false;
  }

  event.preventDefault();
  unlockAudio();
  updateMouse(event);
  const hudPoint = mobileHudFramePointFromEvent(event);

  if (isSettingsMenu()) {
    handleSettingsPointerDown(hudPoint.x, hudPoint.y, event.pointerId);
    return true;
  }

  if (state.upgrades.active) {
    if (
      pointInRect(hudPoint.x, hudPoint.y, mobileUpgradeCloseActionRect()) ||
      !pointInRect(hudPoint.x, hudPoint.y, mobileUpgradePanelRect())
    ) {
      closeUpgrades();
      return true;
    }

    updateUpgradeSelectionFromPoint(hudPoint.x, hudPoint.y);
    buySelectedUpgrade();
    return true;
  }

  const moveJoystickRect = mobileJoystickCssRect("move");
  if (pointInCssRect(event.clientX, event.clientY, moveJoystickRect)) {
    state.mobile.moveJoystick.pointerId = event.pointerId;
    state.mobile.moveJoystick.active = true;
    updateMobileJoystickFromPointer(event, "move");
    return true;
  }

  const aimJoystickRect = mobileJoystickCssRect("aim");
  if (pointInCssRect(event.clientX, event.clientY, aimJoystickRect)) {
    state.mobile.aimJoystick.pointerId = event.pointerId;
    state.mobile.aimJoystick.active = true;
    updateMobileJoystickFromPointer(event, "aim");
    return true;
  }

  const mobileAction = mobileActionAtPoint(hudPoint.x, hudPoint.y);
  if (mobileAction) {
    handleMobileAction(mobileAction);
    return true;
  }

  const menuEntity = mobileMenuEntityAtPoint(state.mouse.x, state.mouse.y);
  if (menuEntity) {
    activateMenuEntity(menuEntity);
    return true;
  }

  const screenButton = screenRoomButtonAtPoint(hudPoint.x, hudPoint.y);
  if (screenButton) {
    handleRoomUiClick(screenButton);
    return true;
  }

  if (state.build.active && state.mouse.inFrame && !state.chat.active && !isRoomUiBlocking()) {
    state.mouse.down = true;
    buildWallAtMouse({ force: true });
    return true;
  }

  if (!state.chat.active && !isRoomUiBlocking() && state.mouse.inFrame) {
    queueMobileHuckRockFromPointer(event);
    return true;
  }

  return true;
}

function handleMobilePointerUp(event) {
  if (!mobileControlsActive()) {
    return false;
  }

  event.preventDefault();
  updateMouse(event);
  if (state.mobile.moveJoystick.active && event.pointerId === state.mobile.moveJoystick.pointerId) {
    resetMobileJoystick("move");
  }
  if (state.mobile.aimJoystick.active && event.pointerId === state.mobile.aimJoystick.pointerId) {
    resetMobileJoystick("aim");
  }
  clearSettingsDrag(event.pointerId);
  state.mouse.down = false;
  return true;
}

function handleMobileAction(action) {
  return runControlAction(action, { source: "mobile" });
}

function runControlAction(action, options = {}) {
  switch (action) {
    case "upgrades":
      activateUpgrades();
      return true;
    case "closeUpgrades":
      closeUpgrades();
      return true;
    case "build":
      toggleBuildMode();
      return true;
    case "map":
      if (playerMapAllowed()) {
        state.playerMap.large = !state.playerMap.large;
        return true;
      }
      return false;
    case "leave":
      return handleLeaveShortcut();
    case "botsFewer":
      return adjustLocalBotLobbyCount(-1);
    case "botsMore":
      return adjustLocalBotLobbyCount(1);
    case "themeBack":
      leaveThemeMenuRoom();
      return true;
    case "confirmLeave":
      return confirmLeaveShortcut();
    case "start":
      requestWaitingRoomStart();
      return true;
    default:
      return false;
  }
}

function mobileActionAtPoint(x, y) {
  if (state.upgrades.active && pointInRect(x, y, mobileUpgradeCloseActionRect())) {
    return "closeUpgrades";
  }

  if (leaveConfirmIsActive()) {
    return pointInRect(x, y, mobileConfirmLeaveActionRect()) ? "confirmLeave" : null;
  }

  if (state.room?.state === "waiting") {
    const localBotLobby = isLocalBotLobby();
    if (pointInRect(x, y, mobileWaitingLeaveActionRect())) {
      return "leave";
    }
    if (localBotLobby && pointInRect(x, y, mobileWaitingFewerActionRect())) {
      return "botsFewer";
    }
    if (localBotLobby && pointInRect(x, y, mobileWaitingMoreActionRect())) {
      return "botsMore";
    }
    if (canStartWaitingRoom() && pointInRect(x, y, mobileWaitingStartActionRect())) {
      return "start";
    }
    return null;
  }

  if (state.room?.state === "active" && !state.upgrades.active && !state.chat.active) {
    if (pointInRect(x, y, mobileHudActionRect("upgrades"))) {
      return "upgrades";
    }
    if (pointInRect(x, y, mobileHudActionRect("build"))) {
      return "build";
    }
    if (playerMapAllowed() && pointInRect(x, y, mobileHudActionRect("map"))) {
      return "map";
    }
    if (canLeaveWithShortcut() && pointInRect(x, y, mobileHudActionRect("leave"))) {
      return "leave";
    }
  }

  if (state.room?.state === "menu" && state.menu.room === MENU_ROOMS.theme) {
    return pointInRect(x, y, mobileThemeLeaveActionRect()) ? "themeBack" : null;
  }

  return null;
}

function mobileMenuEntityAtPoint(frameX, frameY) {
  if (state.room?.state !== "menu" || !state.menu.player || !state.mouse.inFrame) {
    return null;
  }

  const worldPoint = lensScreenPointToWorld(state.menu.player, frameX, frameY, framebufferSize());
  const entities = menuEntities();
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    if (!entity?.action) {
      continue;
    }

    if (menuEntityContainsPoint(entity, worldPoint.x, worldPoint.y)) {
      return entity;
    }
  }

  return null;
}

function menuEntityContainsPoint(entity, x, y) {
  if (entity.type === "themeSwatch") {
    const radius = Number(entity.radius || 0);
    const dx = x - entity.x;
    const dy = y - entity.y;
    return dx * dx + dy * dy <= radius * radius;
  }

  return x >= entity.x &&
    x <= entity.x + entity.width &&
    y >= entity.y &&
    y <= entity.y + entity.height;
}

function mobileHudActionRect(kind) {
  const index = mobileArenaActionKinds().indexOf(kind);
  const y = mobileArenaControlsY() + Math.max(0, index) * MOBILE_CONTROL_LINE_STEP;
  return {
    x: MOBILE_HUD_ACTION_X,
    y,
    width: MOBILE_HUD_ACTION_WIDTH,
    height: MOBILE_HUD_ACTION_HEIGHT
  };
}

function mobileUpgradeCloseActionRect() {
  const height = approximateUpgradeMenuHeight();
  return {
    x: UPGRADE_MENU_LAYOUT.x + 2,
    y: upgradeMenuY() + height + MOBILE_UPGRADE_CLOSE_ACTION.gap,
    width: MOBILE_UPGRADE_CLOSE_ACTION.width,
    height: MOBILE_UPGRADE_CLOSE_ACTION.height
  };
}

function mobileUpgradePanelRect() {
  return {
    x: UPGRADE_MENU_LAYOUT.x,
    y: upgradeMenuY(),
    width: approximateUpgradeMenuWidth(true),
    height: approximateUpgradeMenuHeight()
  };
}

function mobileConfirmLeaveActionRect() {
  return {
    x: MOBILE_HUD_ACTION_X,
    y: mobileHudControlBlockY(MOBILE_HUD_ACTION_HEIGHT),
    width: 112,
    height: MOBILE_HUD_ACTION_HEIGHT
  };
}

function mobileThemeLeaveActionRect() {
  return {
    x: MOBILE_HUD_ACTION_X,
    y: mobileHudControlBlockY(MOBILE_HUD_ACTION_HEIGHT),
    width: 96,
    height: MOBILE_HUD_ACTION_HEIGHT
  };
}

function mobileWaitingLeaveActionRect() {
  return mobileWaitingActionRect(0);
}

function mobileWaitingFewerActionRect() {
  return mobileWaitingActionRect(1, 128);
}

function mobileWaitingMoreActionRect() {
  return mobileWaitingActionRect(2, 128);
}

function mobileWaitingStartActionRect() {
  return mobileWaitingActionRect(isLocalBotLobby() ? 3 : 1);
}

function mobileWaitingActionRect(index, width = 96) {
  const actionY = mobileWaitingActionsY();
  return {
    x: MOBILE_HUD_ACTION_X,
    y: actionY + MOBILE_CONTROL_LINE_STEP * index,
    width,
    height: MOBILE_HUD_ACTION_HEIGHT
  };
}

function mobileWaitingActionsY() {
  return mobileHudControlBlockY(mobileControlListHeight(mobileWaitingActionCount()));
}

function mobileWaitingActionCount() {
  let count = 1;
  if (isLocalBotLobby()) {
    count += 2;
  }
  if (canStartWaitingRoom()) {
    count += 1;
  }
  return count;
}

function mobileArenaControlsY() {
  return mobileHudControlBlockY(mobileControlListHeight(mobileArenaActionKinds().length));
}

function mobileArenaActionKinds() {
  const kinds = ["upgrades", "build"];
  if (playerMapAllowed()) {
    kinds.push("map");
  }
  if (canLeaveWithShortcut()) {
    kinds.push("leave");
  }
  return kinds;
}

function mobileControlListHeight(lineCount, lineStep = MOBILE_CONTROL_LINE_STEP) {
  return Math.max(
    HUD_CONTROL_VISIBLE_HEIGHT,
    Math.max(0, Math.floor(lineCount) - 1) * lineStep + HUD_CONTROL_VISIBLE_HEIGHT
  );
}

function mobileHudControlBlockY(blockHeight) {
  const frame = mobileHudContentCssRect();
  return Math.max(
    MOBILE_HUD_EDGE_INSET,
    frame.logicalHeight - MOBILE_HUD_EDGE_INSET - Math.max(HUD_CONTROL_VISIBLE_HEIGHT, blockHeight)
  );
}

function upgradeMenuY() {
  if (!mobileControlsActive()) {
    return UPGRADE_MENU_LAYOUT.y;
  }

  return mobileHudControlBlockY(
    approximateUpgradeMenuHeight() +
    MOBILE_UPGRADE_CLOSE_ACTION.gap +
    MOBILE_UPGRADE_CLOSE_ACTION.height
  );
}

function hudPanelHeightForRows(rowCount) {
  return HUD_PANEL_PADDING * 2 +
    HUD_PANEL_TEXT_HEIGHT +
    Math.max(0, Math.floor(rowCount) - 1) * HUD_PANEL_ROW_STEP;
}

function approximateUpgradeMenuHeight() {
  const rowsBottom = UPGRADE_MENU_LAYOUT.rowTopOffset +
    UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight;
  if (mobileControlsActive()) {
    return rowsBottom + UPGRADE_MENU_LAYOUT.bottomPadding;
  }

  const dividerY = rowsBottom + UPGRADE_MENU_LAYOUT.dividerTopGap;
  const detailY = dividerY + 1 + UPGRADE_MENU_LAYOUT.dividerBottomGap;
  const detailHeight = UPGRADE_MENU_LAYOUT.rowTextHeight +
    Math.max(0, UPGRADE_MENU_LAYOUT.detailLineCount - 1) * UPGRADE_MENU_LAYOUT.detailLineHeight;
  return detailY + detailHeight + UPGRADE_MENU_LAYOUT.bottomPadding;
}

function queueMobileHuckRockFromPointer(event) {
  const player = isReadyMenu()
    ? state.menu.player
    : predictedLocalPlayer() || localPlayerFromSnapshot();
  if (!player) {
    return;
  }

  const target = lensScreenPointToWorld(player, state.mouse.x, state.mouse.y, framebufferSize());
  state.mobile.huckRockTarget = target;
  state.mobile.huckRockQueued = true;
  state.mobile.huckRockQueuedUntilSeconds = performance.now() / 1000 + MOBILE_HUCK_ROCK_QUEUE_SECONDS;
}

function clearMobileHuckRockQueue() {
  state.mobile.huckRockQueued = false;
  state.mobile.huckRockQueuedUntilSeconds = 0;
  state.mobile.huckRockTarget = null;
}

function mobileHuckRockQueued(nowSeconds = performance.now() / 1000) {
  if (!mobileControlsActive() || !state.mobile.huckRockQueued) {
    return false;
  }

  if (nowSeconds <= state.mobile.huckRockQueuedUntilSeconds) {
    return true;
  }

  clearMobileHuckRockQueue();
  return false;
}

function updateMobileJoystickFromPointer(event, kind) {
  const joystick = mobileJoystickState(kind);
  if (!joystick) {
    return;
  }

  const rect = mobileJoystickCssRect(kind);
  const dx = event.clientX - rect.centerX;
  const dy = event.clientY - rect.centerY;
  const distance = Math.hypot(dx, dy);
  const limit = Math.max(1, rect.radius);
  const clampedDistance = Math.min(distance, limit);
  const deadzone = Math.min(limit - 1, Math.max(MOBILE_JOYSTICK_MIN_DEADZONE, limit * MOBILE_JOYSTICK_DEADZONE_RATIO));
  const liveDistance = Math.max(0, clampedDistance - deadzone);
  const engaged = liveDistance > 0;
  const x = distance > 0 ? dx / distance : 0;
  const y = distance > 0 ? dy / distance : 0;

  joystick.x = x * clampedDistance;
  joystick.y = y * clampedDistance;
  joystick.centerX = rect.centerX;
  joystick.centerY = rect.centerY;
  joystick.radius = rect.radius;
  joystick.engaged = engaged;
  if (kind === "move") {
    const power = clamp(liveDistance / Math.max(1, limit * 0.5 - deadzone), 0, 1);
    state.mobile.move = engaged
      ? {
          x: x * power,
          y: y * power
        }
      : { x: 0, y: 0 };
  } else if (engaged) {
    state.mobile.aimAngle = Math.atan2(dy, dx);
    state.mouse.aimAngle = state.mobile.aimAngle;
  }
  updateMobileControlUi();
}

function mobileJoystickState(kind) {
  return kind === "move"
    ? state.mobile.moveJoystick
    : kind === "aim"
      ? state.mobile.aimJoystick
      : null;
}

function resetMobileJoystick(kind) {
  const joystick = mobileJoystickState(kind);
  if (!joystick) {
    return;
  }

  joystick.pointerId = null;
  joystick.active = false;
  joystick.engaged = false;
  joystick.x = 0;
  joystick.y = 0;
  if (kind === "move") {
    state.mobile.move = { x: 0, y: 0 };
  }
  updateMobileControlUi();
}

function resetMobileJoysticks() {
  resetMobileJoystick("move");
  resetMobileJoystick("aim");
  updateMobileControlUi();
}

function updateMobileControlUi() {
  if (
    !mobileControlsRoot ||
    !mobileMoveJoystick ||
    !mobileMoveJoystickCanvas ||
    !mobileAimJoystick ||
    !mobileAimJoystickCanvas
  ) {
    return;
  }

  const modalActive = state.upgrades.active === true || isSettingsMenu();
  const active = mobileControlsActive() && !shouldIgnorePagePointerEvent() && !modalActive;
  mobileControlsRoot.hidden = !active;
  if (!active) {
    if (modalActive) {
      state.mobile.moveJoystick.pointerId = null;
      state.mobile.moveJoystick.active = false;
      state.mobile.moveJoystick.engaged = false;
      state.mobile.moveJoystick.x = 0;
      state.mobile.moveJoystick.y = 0;
      state.mobile.aimJoystick.pointerId = null;
      state.mobile.aimJoystick.active = false;
      state.mobile.aimJoystick.engaged = false;
      state.mobile.aimJoystick.x = 0;
      state.mobile.aimJoystick.y = 0;
      state.mobile.move = { x: 0, y: 0 };
    }
    return;
  }

  updateMobileJoystickElement("move", mobileMoveJoystick, mobileMoveJoystickCanvas);
  updateMobileJoystickElement("aim", mobileAimJoystick, mobileAimJoystickCanvas);
}

function updateMobileJoystickElement(kind, element, joystickCanvas) {
  const joystick = mobileJoystickState(kind);
  const rect = mobileJoystickCssRect(kind);
  const foreground = state.theme?.foreground || cssDefaultTheme.foreground || RENDER.foreground;
  const background = state.theme?.background || cssDefaultTheme.background || RENDER.background;
  const diameter = Math.round(rect.radius * 2);
  element.style.left = `${Math.round(rect.left)}px`;
  element.style.top = `${Math.round(rect.top)}px`;
  element.style.width = `${diameter}px`;
  element.style.height = `${diameter}px`;
  drawMobileJoystickCanvas(joystickCanvas, diameter, joystick, foreground, background);
}

function drawMobileJoystickCanvas(joystickCanvas, diameter, joystick, foreground, background) {
  if (!joystickCanvas) {
    return;
  }

  if (joystickCanvas.width !== diameter || joystickCanvas.height !== diameter) {
    joystickCanvas.width = diameter;
    joystickCanvas.height = diameter;
  }

  const ctx = joystickCanvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, diameter, diameter);

  const center = Math.round(diameter / 2);
  const radius = Math.max(1, Math.floor(diameter / 2));
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = foreground;
  ctx.fillRect(center - 1, center - 11, 2, 22);
  ctx.fillRect(center - 11, center - 1, 22, 2);

  const knobSize = 26;
  const knobRadius = knobSize / 2;
  const knobX = Math.round(center + (joystick?.x || 0));
  const knobY = Math.round(center + (joystick?.y || 0));
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.arc(knobX, knobY, knobRadius - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = foreground;
  ctx.beginPath();
  ctx.arc(knobX, knobY, knobRadius - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function mobileJoystickCssRect(kind = "aim") {
  const drawer = mobileControlDrawerCssRect();
  const radius = Math.round(clamp(
    Math.min(drawer.width * 0.18, drawer.height * 0.36),
    MOBILE_JOYSTICK_MIN_RADIUS,
    MOBILE_JOYSTICK_MAX_RADIUS
  ));
  const centerX = kind === "move"
    ? drawer.left + drawer.width * 0.28
    : drawer.left + drawer.width * 0.72;
  const centerY = drawer.top + drawer.height / 2;
  const roundedCenterX = Math.round(centerX);
  const roundedCenterY = Math.round(centerY);

  return {
    centerX: roundedCenterX,
    centerY: roundedCenterY,
    radius,
    left: roundedCenterX - radius,
    top: roundedCenterY - radius,
    right: roundedCenterX + radius,
    bottom: roundedCenterY + radius
  };
}

function mobileControlDrawerCssRect() {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || window.innerWidth || RENDER.width;
  const viewportHeight = viewport?.height || window.innerHeight || RENDER.height;
  const drawerHeight = Math.min(
    mobileControlDrawerHeightPxClient(),
    Math.max(1, viewportHeight)
  );
  return {
    left: viewportLeft,
    top: viewportTop + viewportHeight - drawerHeight,
    width: viewportWidth,
    height: drawerHeight,
    right: viewportLeft + viewportWidth,
    bottom: viewportTop + viewportHeight
  };
}

function canvasContentCssRect(targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  const canvasWidth = targetCanvas.width || RENDER.width;
  const canvasHeight = targetCanvas.height || RENDER.height;
  const scale = Math.min(rect.width / canvasWidth, rect.height / canvasHeight);
  const width = canvasWidth * scale;
  const height = canvasHeight * scale;
  const offsetX = (rect.width - width) / 2;
  const offsetY = mobileControlsActive() && targetCanvas === canvas
    ? 0
    : (rect.height - height) / 2;

  return {
    left: rect.left + offsetX,
    top: rect.top + offsetY,
    width,
    height,
    right: rect.left + offsetX + width,
    bottom: rect.top + offsetY + height,
    scale
  };
}

function mobileHudFramePointFromEvent(event) {
  const basePoint = eventToFramebufferPoint(event);
  if (!mobileControlsActive()) {
    return basePoint;
  }

  const frame = mobileHudContentCssRect();
  const scaleX = Math.max(0.0001, frame.scaleX || frame.scale);
  const scaleY = Math.max(0.0001, frame.scaleY || frame.scale);
  const x = event.clientX - frame.left;
  const y = event.clientY - frame.top;
  return {
    x: clamp(x / scaleX, 0, frame.logicalWidth),
    y: clamp(y / scaleY, 0, frame.logicalHeight),
    inFrame: x >= 0 && x <= frame.width && y >= 0 && y <= frame.height
  };
}

function eventToHudFramePoint(event) {
  if (mobileControlsActive()) {
    return mobileHudFramePointFromEvent(event);
  }

  return eventToCanvasFramePoint(event, canvas);
}

function mobileHudContentCssRect() {
  const frame = canvasContentCssRect(canvas);
  if (!mobileControlsActive()) {
    return frame;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const scale = frame.scale * MOBILE_HUD_SCALE;
  const width = canvasRect.width;
  const height = canvasRect.height;
  const logicalSize = mobileHudLogicalSize(width, height, scale);
  return {
    left: canvasRect.left,
    top: canvasRect.top,
    width,
    height,
    right: canvasRect.left + width,
    bottom: canvasRect.top + height,
    logicalWidth: logicalSize.width,
    logicalHeight: logicalSize.height,
    scale,
    scaleX: width / Math.max(1, logicalSize.width),
    scaleY: height / Math.max(1, logicalSize.height)
  };
}

function mobileHudLogicalSize(width, height, scale) {
  const safeScale = Math.max(0.0001, scale);
  return {
    width: mobileHudRoundEven(width / safeScale),
    height: mobileHudRoundEven(height / safeScale)
  };
}

function mobileHudRoundEven(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

function canvasEdgePaddingPxClient() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--scene-edge-padding").trim();
  if (value.endsWith("em")) {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return (Number.parseFloat(value) || 0) * rootFontSize;
  }
  return Number.parseFloat(value) || 0;
}

function mobileControlDrawerHeightPxClient() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--mobile-control-drawer-height")
    .trim();
  if (value.endsWith("em")) {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return (Number.parseFloat(value) || 0) * rootFontSize;
  }
  return Math.max(1, Number.parseFloat(value) || 0);
}

function pointInRect(x, y, rect) {
  return Boolean(rect) && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function pointInCssRect(x, y, rect) {
  return Boolean(rect) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
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

  if (event.code === "Digit4" || event.code === "Numpad4") {
    event.preventDefault();
    cycleMenuSpeedUpgrade();
    return true;
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

function cycleMenuSpeedUpgrade() {
  const player = state.menu.player;
  if (!player) {
    return;
  }

  const definition = UPGRADE_DEFINITIONS.find((upgrade) => upgrade.id === MENU_SPEED_UPGRADE_ID);
  const maxLevel = Math.max(0, Number(definition?.maxLevel || 0));
  const currentLevel = clamp(Math.floor(Number(player.upgrades?.[MENU_SPEED_UPGRADE_ID] || 0)), 0, maxLevel);
  player.upgrades = {
    ...(player.upgrades || {}),
    [MENU_SPEED_UPGRADE_ID]: (currentLevel + 1) % (maxLevel + 1)
  };
}

if (!mapGenMode) {
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

    state.net.inputSentCount += 1;
    socket.emit(CLIENT_EVENTS.input, readInput());
  }, 1000 / ENGINE.tickRate);

  setInterval(() => {
    emitHeartbeat();
  }, ENGINE.heartbeat.intervalSeconds * 1000);

  requestAnimationFrame(draw);
}

function emitHeartbeat() {
  if (!socket.connected || !state.clientId) {
    return;
  }

  socket.emit(CLIENT_EVENTS.heartbeat);
}

function recordNetworkSnapshot(snapshot, nowMs = performance.now(), payload = snapshot) {
  const net = state.net;
  net.snapshotCount += 1;
  net.lastSnapshotAtMs = nowMs;
  net.lastSnapshotDelta = Boolean(payload?.delta);
  if (state.perfDebug.enabled) {
    net.lastSnapshotBytes = roughJsonByteLength(payload);
  }
}

function roughJsonByteLength(value) {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

function draw(now = 0) {
  if (state.perfDebug.enabled) {
    updatePerfFrameMetrics(now);
  }
  const updateStart = state.perfDebug.enabled ? performance.now() : 0;
  const timeSeconds = now / 1000;
  const loadingRoom = isLoadingRoom();
  const readyMenu = isReadyMenu();
  const localBotGame = isLocalBotGame();

  measureUpdateBucket("updateInputMs", () => {
    updateControllerState(timeSeconds);
    syncThemeFromCss();
    updateMobileControlUi();
    pruneEliminationNotices(timeSeconds);
  });
  measureUpdateBucket("updateGameMs", () => {
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
  });
  const cameraPlayerId = cameraPlayerIdForRoom();
  let botDebugOverlay = null;
  let buildTarget = null;
  measureUpdateBucket("updateUiMs", () => {
    logSpectatedBotDebug(cameraPlayerId, timeSeconds);
    botDebugOverlay = botDebugOverlayRenderState(cameraPlayerId);
    const screenPointer = screenPointerPoint();
    state.uiHoverId = screenRoomButtonAtPoint(screenPointer.x, screenPointer.y);
    buildTarget = buildTargetFromMouse();
    updateHeldBuild(buildTarget, timeSeconds);
  });
  let snapshot = null;
  measureUpdateBucket("snapshotMs", () => {
    snapshot = loadingRoom ? null : readyMenu ? menuSnapshot() : renderSnapshot(timeSeconds);
  });
  let mapAllowed = false;
  let playerMap = null;
  measureUpdateBucket("mapStateMs", () => {
    mapAllowed = playerMapAllowed();
    if (!mapAllowed && state.playerMap.large) {
      state.playerMap.large = false;
    }
    playerMap = mapAllowed ? playerMapRenderState(snapshot, cameraPlayerId) : null;
  });
  const playerMapVisible = mapAllowed && Boolean(playerMap);
  const playerId = readyMenu ? MENU_PLAYER_ID : state.playerId;
  const menuPlayer = readyMenu ? state.menu.player : null;
  const audioPlayer = readyMenu
    ? menuPlayer
    : audioPlayerForRender(snapshot, cameraPlayerId);
  measureUpdateBucket("audioMs", () => {
    updateLocalShipAudio(audioPlayer, timeSeconds);
    updateVoiceVisibility(snapshot, cameraPlayerId, timeSeconds);
    updateMusicPlayback({ snapshot, cameraPlayerId });
  });
  if (state.perfDebug.enabled) {
    updatePerfUpdateMetrics(performance.now() - updateStart);
  }
  const renderStart = state.perfDebug.enabled ? performance.now() : 0;
  const renderPerf = renderer.draw(snapshot, {
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
    menuRoom: readyMenu ? state.menu.room : null,
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
    mobileActive: mobileControlsActive(),
    controllerCursor: controllerCursorRenderState(),
    controllerAimCursor: controllerAimCursorRenderState(),
    hudFlash: hudFlashRenderState(timeSeconds),
    leaveConfirm: leaveConfirmRenderState(timeSeconds),
    playerMap: playerMapVisible ? playerMap : null,
    playerMapLarge: playerMapVisible && state.playerMap.large,
    playerMapVisible,
    playerMapFeatureEnabled: playerMapFeatureEnabled(),
    botChunkMap: botDebugOverlay ? botChunkMapRenderState(cameraPlayerId) : null,
    botDebugOverlay,
    theme: state.theme,
    themeName: themeLabelForTheme(state.theme),
    settings: state.settings,
    voiceHudActive: voiceHudActive(),
    settingsUi: state.settingsUi,
    timeSeconds,
    measurePerf: state.perfDebug.enabled
  });
  if (state.perfDebug.enabled) {
    updatePerfRenderMetrics(performance.now() - renderStart, renderPerf);
    updatePerfDebugPanel(now);
  }
  requestAnimationFrame(draw);
}

function updateControllerState(timeSeconds) {
  const input = gamepadControls.update();
  updateMousePointerForControllerInput(input);
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

  if (handleMenuRoomControllerActions(input)) {
    return;
  }

  if (input.pressed.select && leaveConfirmIsActive()) {
    confirmLeaveShortcut();
    return;
  }

  if (handleControllerSpectatorCycle(input)) {
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

function handleSpectatorCycleKey(event) {
  if (
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    !canCycleSpectatorTargets()
  ) {
    return false;
  }

  let direction = 0;
  if (event.code === "ArrowRight" || event.code === "KeyD") {
    direction = 1;
  } else if (event.code === "ArrowLeft" || event.code === "KeyA") {
    direction = -1;
  }

  if (direction === 0) {
    return false;
  }

  event.preventDefault();
  return cycleSpectatorTarget(direction);
}

function handleControllerSpectatorCycle(input) {
  if (!canCycleSpectatorTargets()) {
    state.controller.spectatorCycleDirection = 0;
    return false;
  }

  const direction = Math.abs(input.dpad.x) >= CONTROLLER_DPAD_NAV_THRESHOLD
    ? Math.sign(input.dpad.x)
    : 0;
  if (direction === 0) {
    state.controller.spectatorCycleDirection = 0;
    return false;
  }

  if (direction === state.controller.spectatorCycleDirection) {
    return false;
  }

  state.controller.spectatorCycleDirection = direction;
  return cycleSpectatorTarget(direction);
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
    miningRayDisabled: miningDisabledFlashActive()
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

function miningDisabledFlashActive() {
  if (
    state.chat.active ||
    state.upgrades.active ||
    state.build.active ||
    !physicalMiningInputActive()
  ) {
    return false;
  }

  if (state.room?.state === "menu" && state.menu.room === MENU_ROOMS.theme) {
    return miningRayHitsAsteroid(state.menu.player?.miningRay);
  }

  return false;
}

function miningRayHitsAsteroid(miningRay) {
  const lanes = Array.isArray(miningRay?.lanes) && miningRay.lanes.length > 0
    ? miningRay.lanes
    : miningRay ? [miningRay] : [];
  return lanes.some((lane) => lane?.hitType === "asteroid");
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
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "/mapgen" || params.get("mapgen") === "1" || window.location.hash === "#mapgen";
}

function createMapGenSocketStub() {
  return {
    auth: {},
    connected: false,
    on() {},
    emit() {}
  };
}

function createMapGenRendererStub() {
  return {
    resize() {},
    draw() {
      return {};
    }
  };
}

function setupMapGenMode() {
  const panel = document.querySelector("#mapgen-panel");
  const preview = document.querySelector("#mapgen-preview");
  const stats = document.querySelector("#mapgen-stats");
  if (!panel || !preview || !stats) {
    return;
  }

  document.body.classList.add("mapgen-active");
  panel.hidden = false;

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
  if (Object.values(controls).some((control) => !control)) {
    stats.textContent = "mapgen controls missing";
    return;
  }

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
  const rawValue = input.value;
  if (rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function mapGenParamNumber(params, key, fallback) {
  const rawValue = params.get(key);
  if (rawValue === null || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function renderMapGenPreview(canvasElement, statsElement, options) {
  const ctx = canvasElement.getContext("2d", { alpha: false });
  if (!ctx) {
    statsElement.textContent = "mapgen preview canvas unavailable";
    return;
  }

  let asteroid = null;
  try {
    asteroid = createNaturalAsteroid({
      seed: options.seed,
      playerCount: options.playerCount,
      generation: options.generation
    });
  } catch (error) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
    statsElement.textContent = `mapgen render failed: ${error?.message || error}`;
    console.error("BITSPACE mapgen render failed", error);
    return;
  }

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
    let head = 0;
    let size = 0;
    visited.add(index);

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
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
    spectatorCycleDirection: 0,
    waitingBotCountDirection: 0,
    mousePointerHidden: false,
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
  const readyAsteroid = createLobbyAsteroid({ seed: "bitspace-menu" });
  const asteroids = {
    [MENU_ROOMS.ready]: readyAsteroid,
    [MENU_ROOMS.theme]: createThemeMenuAsteroid(),
    [MENU_ROOMS.settings]: readyAsteroid
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
    themeFocusStartedMs: 0,
    themeFocusUntilMs: 0,
    themeFocusTheme: null,
    themeBaseId: null,
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
  const preserveMenuCamera = room === MENU_ROOMS.settings && state.menu.room === MENU_ROOMS.ready;
  state.menu.room = room;
  state.menu.asteroid = state.menu.asteroids[room];
  state.menu.huckRocks = [];
  state.menu.huckRockCooldownSeconds = 0;
  const center = menuCenter(state.menu.asteroid);
  state.menu.activeTargetId = null;
  resetMenuButtonTarget();
  if (!preserveMenuCamera) {
    player.x = center.x;
    player.y = center.y;
  }
  player.vx = 0;
  player.vy = 0;
  if (!preserveMenuCamera) {
    player.angle = Math.PI / 4;
  }
  player.facingMoveX = 0;
  player.facingMoveY = 0;
  clearPendingFacing(player);
  if (!preserveMenuCamera) {
    player.aimAngle = Math.PI / 2;
  }
  player.mining = false;
  player.miningRay = null;
  player.miningHoldSeconds = 0;
  player.rayExtension = 0;
  player.prototypeMiningRayCount = state.menu.rayCount;
  player.huckRockEngineCutoutSeconds = 0;
  player.thrusting = false;
  updateMobileControlUi();
}

function updateMenuSimulation(timeSeconds) {
  const player = state.menu.player;
  const previousTime = state.menu.lastTimeSeconds || timeSeconds;
  const dtSeconds = clamp(timeSeconds - previousTime, 0, 1 / 15) || 1 / ENGINE.tickRate;
  state.menu.lastTimeSeconds = timeSeconds;
  state.menu.tick += 1;
  player.shake = Math.max(0, (player.shake || 0) - ENGINE.collision.shakeDecay * dtSeconds);
  player.huckRockEngineCutoutSeconds = 0;
  if (state.menu.room === MENU_ROOMS.settings) {
    player.vx = 0;
    player.vy = 0;
    player.moveX = 0;
    player.moveY = 0;
    player.thrusting = false;
    player.mining = false;
    player.miningRay = null;
    player.miningHoldSeconds = 0;
    player.rayExtension = 0;
    state.menu.activeTargetId = null;
    resetMenuButtonTarget();
    return;
  }

  applyShipFriction(player, dtSeconds);

  updateMenuAim(player);
  player.prototypeMiningRayCount = state.menu.rayCount;

  const move = state.chat.active ? { x: 0, y: 0 } : readMoveVector();
  const effects = aggregateUpgradeEffects(player.upgrades);
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  const canThrust = hasMoveIntent;

  updateShipFacing(player, move, dtSeconds);
  player.moveX = move.x;
  player.moveY = move.y;

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

  if (mobileAimJoystickEngaged()) {
    player.aimAngle = state.mobile.aimAngle;
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

  const shouldSpawnMenuHuckRock =
    !activatedEntityThisFrame &&
    !state.chat.active &&
    huckRockPhysicalInputActive() &&
    state.menu.huckRockCooldownSeconds <= 0;
  if (shouldSpawnMenuHuckRock) {
    spawnMenuHuckRock(player);
    requestHuckRockThunk();
    state.menu.huckRockCooldownSeconds = ENGINE.huckRock.fireIntervalSeconds;
    if (mobileHuckRockQueued()) {
      clearMobileHuckRockQueue();
    }
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

  breakMenuHuckRock(a, null, spawnedFragments, "rock");
  breakMenuHuckRock(b, null, spawnedFragments, "rock");
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
        requestRockThump(-normalSpeed);
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

  if (entity.action === "cars") {
    activateReadyFromMenu(GAME_MODES.cars);
    return;
  }

  requestMechanicalBeep();

  if (entity.action === "theme") {
    enterMenuRoom(MENU_ROOMS.theme);
    return;
  }

  if (entity.action === "prefs") {
    enterMenuRoom(MENU_ROOMS.settings);
    return;
  }

  if (entity.action === "named-room") {
    promptNamedRoomFromMenu();
    return;
  }

  if (entity.action === "bots") {
    startLocalBotLobby();
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
    setTheme(randomTheme(), null);
    focusSelectedThemeSwatch(state.theme);
    return;
  }

  if (entity.action === "select-theme") {
    const preset = THEME_PRESETS.find((candidate) => candidate.id === entity.themeId);
    if (!preset) {
      return;
    }
    setTheme(themePresetIsSelected(preset) ? randomizedThemeVariant(preset) : preset, preset.id);
    focusSelectedThemeSwatch(state.theme);
    return;
  }

  if (entity.action === "back") {
    enterMenuRoom(MENU_ROOMS.ready);
  }
}

function activateReadyFromMenu(mode = GAME_MODES.bitspace) {
  if (state.menu.readySent || !socket.connected) {
    return;
  }

  state.menu.readySent = true;
  socket.emit(CLIENT_EVENTS.ready, {
    button: true,
    mode
  });
  cancelMiningRay();
  releaseSpaceUntilKeyup();
}

function promptNamedRoomFromMenu() {
  const initial = normalizedRoomNameDraft() || pathRoomName();
  cancelMiningRay();
  releaseSpaceUntilKeyup();
  const value = window.prompt("ROOM KEY", initial);
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

function startLocalBotLobby() {
  forgetRegisteredRoom();
  clearLocalBotSave();
  const botCount = LOCAL_BOT_DEFAULT_COUNT;
  const seed = `local-bots-lobby:${Date.now().toString(36)}`;
  const arena = createLocalBotLobbyArena(botCount, seed);

  state.localGame.active = true;
  state.localGame.arena = arena;
  state.localGame.bots = new Map();
  state.localGame.botCount = botCount;
  state.localGame.lobbySeed = seed;
  state.localGame.lastStepTimeSeconds = 0;
  state.localGame.accumulatorSeconds = 0;
  state.localGame.inputSeq = 0;
  state.localGame.lastSaveTimeSeconds = 0;
  state.playerId = LOCAL_BOT_PLAYER_ID;
  state.room = localBotRoomFromArena(arena, { state: "waiting", botCount });
  state.lastRoomId = LOCAL_BOT_ROOM_ID;
  state.lastActiveMatchKey = null;
  resetControlStateForNewMatch();
  resetLocalDamageAudioState();
  resetEntitySmoothing();
  state.prediction.player = null;
  state.prediction.huckRockCooldownSeconds = 0;
  clearPredictedHuckRocks();
  state.eliminationNotices = [];
  state.playerAliveById.clear();
  setSpectatorTarget(null);
  setClientAsteroid(snapshotAsteroid(arena));
  syncLocalArenaSnapshot(performance.now() / 1000, { skipEliminations: true });
}

function createLocalBotLobbyArena(botCount, seed, preservePlayer = null) {
  const asteroid = createThemeAsteroid({
    seed: `${seed}:theme-lobby`,
    createLobbyPockets: true,
    playerCount: ENGINE.maxPlayers
  });
  const arena = createArena({
    id: `${LOCAL_BOT_ROOM_ID}:waiting`,
    seed,
    asteroid,
    playerDamage: false,
    storm: false
  });
  const playerName = getPlayerName();
  const localPlayerId = LOCAL_BOT_PLAYER_ID;
  const localResult = addPlayer(arena, {
    id: localPlayerId,
    name: playerName || "Pilot",
    spawnNumber: 1,
    resources: {
      rock: ENGINE.lobby.startingRock
    }
  });
  const center = localBotLobbyCenter(asteroid);
  const localPlayer = localResult.player;
  if (localPlayer) {
    if (preservePlayer) {
      localPlayer.x = preservePlayer.x;
      localPlayer.y = preservePlayer.y;
      localPlayer.vx = preservePlayer.vx || 0;
      localPlayer.vy = preservePlayer.vy || 0;
      localPlayer.angle = preservePlayer.angle || localPlayer.angle;
      localPlayer.aimAngle = preservePlayer.aimAngle || localPlayer.aimAngle;
      localPlayer.resources = {
        ...localPlayer.resources,
        ...(preservePlayer.resources || {})
      };
    } else {
      localPlayer.x = center.x;
      localPlayer.y = center.y;
      localPlayer.angle = -Math.PI / 2;
      localPlayer.aimAngle = -Math.PI / 2;
    }
    localPlayer.lobbyHost = true;
  }

  for (let index = 0; index < botCount; index += 1) {
    const id = `bot-${index + 1}`;
    const result = addPlayer(arena, {
      id,
      name: `Bot ${index + 1}`,
      spawnNumber: index + 2
    });
    const bot = result.player;
    if (!bot) {
      continue;
    }
    const position = localBotLobbyBotPosition(index, center);
    bot.x = position.x;
    bot.y = position.y;
    bot.vx = 0;
    bot.vy = 0;
    bot.angle = position.angle;
    bot.aimAngle = position.angle;
  }

  return arena;
}

function startLocalBotGame(botCount = state.localGame.botCount || LOCAL_BOT_DEFAULT_COUNT) {
  forgetRegisteredRoom();
  botCount = clampLocalBotCount(botCount);
  const seed = `local-bots:${Date.now().toString(36)}`;
  const arena = createArena({
    id: LOCAL_BOT_ROOM_ID,
    seed,
    playerCount: botCount + 1,
    playerDamage: true,
    storm: true
  });
  const spawnNumbers = shuffledSpawnNumbers(botCount + 1, seed);
  const playerName = getPlayerName();
  const localPlayerId = LOCAL_BOT_PLAYER_ID;
  addPlayer(arena, {
    id: localPlayerId,
    name: playerName || "Pilot",
    spawnNumber: spawnNumbers[0]
  });

  const bots = new Map();
  for (let index = 0; index < botCount; index += 1) {
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
  state.localGame.botCount = botCount;
  state.localGame.lobbySeed = null;
  state.localGame.lastStepTimeSeconds = 0;
  state.localGame.accumulatorSeconds = 0;
  state.localGame.inputSeq = 0;
  state.localGame.lastSaveTimeSeconds = 0;
  state.playerId = localPlayerId;
  state.room = localBotRoomFromArena(arena, { state: "active" });
  state.lastRoomId = LOCAL_BOT_ROOM_ID;
  state.lastActiveMatchKey = `${LOCAL_BOT_ROOM_ID}:${seed}`;
  beginMusicRoomStartTransition();
  resetControlStateForNewMatch();
  resetLocalDamageAudioState();
  resetEntitySmoothing();
  state.prediction.player = null;
  state.prediction.huckRockCooldownSeconds = 0;
  clearPredictedHuckRocks();
  state.eliminationNotices = [];
  state.playerAliveById.clear();
  setSpectatorTarget(null);
  setClientAsteroid(snapshotAsteroid(arena));
  syncLocalArenaSnapshot(performance.now() / 1000);
}

function localBotLobbyCenter(asteroid) {
  return {
    x: (asteroid.widthTiles * asteroid.tileSize) / 2,
    y: (asteroid.heightTiles * asteroid.tileSize) / 2
  };
}

function localBotLobbyBotPosition(index, center) {
  const radius = RENDER.tileSize * 4;
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / LOCAL_BOT_MAX_COUNT);
  const x = center.x + Math.cos(angle) * radius;
  const y = center.y + Math.sin(angle) * radius;
  return {
    x,
    y,
    angle: Math.atan2(center.y - y, center.x - x)
  };
}

function clampLocalBotCount(value) {
  const count = Math.floor(Number(value));
  return clamp(Number.isFinite(count) ? count : LOCAL_BOT_DEFAULT_COUNT, LOCAL_BOT_MIN_COUNT, LOCAL_BOT_MAX_COUNT);
}

function adjustLocalBotLobbyCount(delta) {
  if (!isLocalBotLobby()) {
    return false;
  }

  const currentCount = clampLocalBotCount(state.localGame.botCount);
  const nextCount = clampLocalBotCount(currentCount + delta);
  if (nextCount === currentCount) {
    return false;
  }

  const currentPlayer = state.localGame.arena?.players.get(LOCAL_BOT_PLAYER_ID) || null;
  const seed = state.localGame.lobbySeed || `local-bots-lobby:${Date.now().toString(36)}`;
  const arena = createLocalBotLobbyArena(nextCount, seed, currentPlayer);
  state.localGame.arena = arena;
  state.localGame.bots = new Map();
  state.localGame.botCount = nextCount;
  state.localGame.lobbySeed = seed;
  state.room = localBotRoomFromArena(arena, { state: "waiting", botCount: nextCount });
  setClientAsteroid(snapshotAsteroid(arena));
  syncLocalArenaSnapshot(performance.now() / 1000, { skipEliminations: true });
  requestMechanicalBeep();
  return true;
}

function leaveLocalBotGame() {
  state.localGame.active = false;
  state.localGame.arena = null;
  state.localGame.bots.clear();
  state.localGame.botCount = LOCAL_BOT_DEFAULT_COUNT;
  state.localGame.lobbySeed = null;
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
  setSpectatorTarget(null);
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
  while (localGame.accumulatorSeconds >= stepSeconds && steps < LOCAL_BOT_MAX_STEPS_PER_FRAME) {
    const stepOptions = { updateBotInputs: true };
    if (botProfileActive()) {
      botProfileMeasure("stepLocalBotArena", () => stepLocalBotArena(stepSeconds, stepOptions));
    } else {
      stepLocalBotArena(stepSeconds, stepOptions);
    }
    localGame.accumulatorSeconds -= stepSeconds;
    steps += 1;
  }

  if (steps >= LOCAL_BOT_MAX_STEPS_PER_FRAME) {
    localGame.accumulatorSeconds = 0;
  }

  if (steps > 0 || !state.snapshot || state.snapshot.arenaId !== arena.id) {
    if (botProfileActive()) {
      botProfileMeasure("syncLocalArenaSnapshot", () => syncLocalArenaSnapshot(timeSeconds));
    } else {
      syncLocalArenaSnapshot(timeSeconds);
    }
  }
}

function stepLocalBotArena(stepSeconds, options = {}) {
  const arena = state.localGame.arena;
  if (!arena) {
    return;
  }

  setPlayerInput(arena, LOCAL_BOT_PLAYER_ID, readLocalPlayerInput());
  if (options.updateBotInputs !== false) {
    for (const [botId, brain] of state.localGame.bots.entries()) {
      const bot = arena.players.get(botId);
      if (!bot?.alive) {
        continue;
      }
      if (!shouldUpdateLocalBotInput(arena, botId, brain)) {
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
  }

  const stepOptions = {
    onAsteroidImpact: (_arena, player, speed) => {
      if (player?.id === LOCAL_BOT_PLAYER_ID) {
        requestRockThump(speed);
      }
    }
  };

  if (botProfileActive()) {
    botProfileMeasure("stepArena", () => stepArena(arena, stepSeconds, stepOptions));
  } else {
    stepArena(arena, stepSeconds, stepOptions);
  }
  const updates = takeAsteroidUpdates(arena);
  if (updates.length > 0) {
    applyClientAsteroidUpdates(updates);
  }
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

function shouldUpdateLocalBotInput(arena, botId, brain) {
  if (!brain?.input) {
    return true;
  }

  return arena.tick % LOCAL_BOT_INPUT_INTERVAL_TICKS === localBotInputPhase(botId);
}

function localBotInputPhase(botId) {
  const match = /(\d+)$/.exec(String(botId || ""));
  const number = match ? Number(match[1]) : stableTextHash(botId);
  return Math.abs(Math.floor(number)) % LOCAL_BOT_INPUT_INTERVAL_TICKS;
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
  if (huckRock && mobileHuckRockQueued()) {
    clearMobileHuckRockQueue();
  }
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
  if (!options.skipEliminations) {
    handleRoomEndAudio(state.room, snapshot, timeSeconds);
  }
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
  if (state.room?.state !== "active") {
    return;
  }

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

function isLocalBotLobby() {
  return state.localGame.active === true &&
    state.room?.localBots === true &&
    state.room?.state === "waiting";
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
  if (state.room?.state === "waiting") {
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
    playerCount: Math.max(1, (save.players || []).length),
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
  state.localGame.botCount = clampLocalBotCount(bots.size || LOCAL_BOT_DEFAULT_COUNT);
  state.localGame.lobbySeed = null;
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
  const roomState = options.state === "waiting"
    ? "waiting"
    : options.state === "ended"
      ? "ended"
      : "active";
  const botCount = clampLocalBotCount(
    options.botCount ?? state.localGame.botCount ?? Math.max(0, arena.players.size - 1)
  );
  const players = Array.from(arena.players.values()).map((player) => ({
    id: player.id,
    clientId: player.id === LOCAL_BOT_PLAYER_ID ? state.clientId : player.id,
    name: player.name,
    alive: player.alive,
    connected: true,
    host: player.id === LOCAL_BOT_PLAYER_ID,
    playerSlot: true
  }));

  return {
    state: roomState,
    roomId: LOCAL_BOT_ROOM_ID,
    local: true,
    localBots: true,
    roomName: roomState === "waiting" ? "BOTS" : "",
    maxPlayers: LOCAL_BOT_MAX_COUNT + 1,
    minPlayers: 1,
    playerSlots: botCount + 1,
    botCount,
    isHost: true,
    countdownArmed: false,
    countdownSeconds: ENGINE.lobby.countdownSeconds,
    autoStartAtMs: null,
    winnerId: roomState === "ended" ? options.winnerId ?? null : null,
    players
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
  const settingsMenu = state.menu.room === MENU_ROOMS.settings;
  const entities = menuEntities().concat(
    settingsMenu ? [] : state.menu.huckRocks.filter((entity) => entity.destroyed !== true)
  );
  return {
    arenaId: settingsMenu ? `menu-${MENU_ROOMS.ready}` : `menu-${state.menu.room}`,
    tick: state.menu.tick,
    serverTime: Date.now(),
    render: RENDER,
    world,
    players: settingsMenu ? [{ ...state.menu.player, hidden: true }] : [{ ...state.menu.player }],
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
  const buttonWidth = 88;
  const controlsRows = menuControlHintRows();

  if (state.menu.room === MENU_ROOMS.theme) {
    return themeSwatchEntities(center);
  }

  if (state.menu.room === MENU_ROOMS.settings) {
    return [];
  }

  const titleY = center.y - 80;
  const readyY = center.y + 38;
  const controlsY = readyY + MENU_BUTTON_HEIGHT + 9;
  const carsY = controlsY + controlsRows.length * 11 + 8;
  const sideXGap = 116;
  const sideTopY = center.y - 26;
  const sideBottomY = center.y + 16;

  return [
    menuTitle("menu-title", "BITSPACE", MENU_ESRB_SUBTITLE, center.x, titleY),
    menuButton("menu-ready", "ready", "READY", center.x - buttonWidth / 2, readyY, buttonWidth),
    menuHint("menu-controls", controlsRows, center.x, controlsY),
    menuButton("menu-cars", "cars", "CARS", center.x - buttonWidth / 2, carsY, buttonWidth),
    menuButton("menu-room", "named-room", "ROOM", center.x - sideXGap - buttonWidth / 2, sideTopY, buttonWidth),
    menuButton("menu-bots", "bots", "BOTS", center.x - sideXGap - buttonWidth / 2, sideBottomY, buttonWidth),
    menuButton("menu-theme", "theme", "THEME", center.x + sideXGap - buttonWidth / 2, sideTopY, buttonWidth),
    menuButton("menu-prefs", "prefs", "PREFS", center.x + sideXGap - buttonWidth / 2, sideBottomY, buttonWidth)
  ];
}

function menuControlHintRows() {
  if (mobileControlsActive()) {
    return [
      { input: "LEFT JOYSTICK", action: "MOVE" },
      { input: "RIGHT JOYSTICK", action: "MINING RAY" },
      { input: "TAP", action: "HUCK ROCK" }
    ];
  }

  if (state.controller.connected) {
    return [
      { input: "L STICK", action: "MOVE" },
      { input: "R STICK", action: "AIM" },
      { input: "R TRIGGER", action: "MINING RAY" },
      { input: "L TRIGGER", action: "HUCK ROCK" }
    ];
  }

  return [
    { input: "WASD", action: "MOVE" },
    { input: "CLICK + HOLD", action: "MINING RAY" },
    { input: "SPACE", action: "HUCK ROCK" }
  ];
}

function settingsRows() {
  const rows = [];
  if (!mobileControlsActive()) {
    rows.push({
      id: "hudLocation",
      label: "HUD LOCATION",
      type: "cycle",
      value: hudLocationLabel(state.settings.hudLocation)
    });
  }

  rows.push(
    {
      id: "voiceChat",
      label: "VOICE CHAT",
      type: "toggle",
      value: state.settings.voiceChat ? "ON" : "OFF"
    },
    {
      id: "micCapture",
      label: "MIC CAPTURE",
      type: "toggle",
      value: state.settings.micCapture === false ? "OFF" : "ON"
    },
    {
      id: "masterVolume",
      label: "MASTER",
      type: "slider",
      value: state.settings.masterVolume
    },
    {
      id: "effectsVolume",
      label: "EFFECTS",
      type: "slider",
      value: state.settings.effectsVolume
    },
    {
      id: "musicVolume",
      label: "MUSIC",
      type: "slider",
      value: state.settings.musicVolume
    },
    {
      id: "voiceVolume",
      label: "VOICE",
      type: "slider",
      value: state.settings.voiceVolume
    },
    {
      id: "back",
      label: "BACK",
      type: "action",
      value: ""
    }
  );

  return rows;
}

function hudLocationLabel(value) {
  if (value === "top") {
    return "TOP";
  }
  if (value === "bottom") {
    return "BOTTOM";
  }
  return "TOP LEFT";
}

function settingsFrameSize() {
  if (!mobileControlsActive()) {
    return framebufferSize();
  }

  const frame = mobileHudContentCssRect();
  return {
    width: frame.logicalWidth,
    height: frame.logicalHeight
  };
}

function settingsPanelRect(frame = settingsFrameSize()) {
  const rows = settingsRows();
  const metrics = settingsPanelMetrics(rows, frame);
  const height = SETTINGS_PANEL.headerHeight +
    rows.length * SETTINGS_PANEL.rowHeight +
    SETTINGS_PANEL.bottomPadding;
  return {
    x: Math.round((frame.width - metrics.width) / 2),
    y: Math.round((frame.height - height) / 2),
    width: metrics.width,
    height
  };
}

function settingsPanelMetrics(rows = settingsRows(), frame = settingsFrameSize()) {
  const labelWidth = Math.max(0, ...rows.map((row) => approximateBitmapTextWidth(row.label)));
  const controlWidth = Math.max(0, ...rows.map((row) => {
    if (row.type === "slider") {
      return SETTINGS_PANEL.sliderWidth + SETTINGS_PANEL.sliderEndPadding * 2;
    }
    return row.value ? approximateBitmapTextWidth(row.value) : 0;
  }));
  const titleWidth = approximateBitmapTextWidth("PREFS");
  const contentWidth = Math.max(
    titleWidth,
    labelWidth + (controlWidth > 0 ? SETTINGS_PANEL.columnGap + controlWidth : 0)
  );
  const maxWidth = Math.max(1, frame.width - SETTINGS_PANEL.edgeInset * 2);
  const width = Math.min(
    maxWidth,
    Math.max(SETTINGS_PANEL.minWidth, contentWidth + SETTINGS_PANEL.padding * 2)
  );
  return {
    width,
    labelWidth,
    controlWidth
  };
}

function settingsRowRect(index, frame = settingsFrameSize()) {
  const panel = settingsPanelRect(frame);
  return {
    x: panel.x + SETTINGS_PANEL.padding,
    y: panel.y + SETTINGS_PANEL.headerHeight + index * SETTINGS_PANEL.rowHeight,
    width: panel.width - SETTINGS_PANEL.padding * 2,
    height: SETTINGS_PANEL.rowHeight
  };
}

function settingsIndexAtPoint(x, y) {
  const rows = settingsRows();
  for (let index = 0; index < rows.length; index += 1) {
    const rect = settingsRowRect(index);
    if (pointInRect(x, y, rect)) {
      return index;
    }
  }
  return null;
}

function handleSettingsPointerDown(x, y, pointerId) {
  if (settingsLeaveControlAtPoint(x, y)) {
    leaveSettingsMenuRoom();
    return true;
  }

  const index = updateSettingsSelectionFromPoint(x, y);
  if (!Number.isInteger(index)) {
    clearSettingsDrag(pointerId);
    return false;
  }

  const row = settingsRows()[index];
  if (row?.type === "slider") {
    const value = settingSliderValueFromPoint(index, x);
    if (value === null) {
      clearSettingsDrag(pointerId);
      return true;
    }

    beginSettingsDrag(index, pointerId);
    setSettingValue(row.id, value, { silent: true });
    requestVolumePreview(row.id, { force: true });
    return true;
  }

  clearSettingsDrag(pointerId);
  activateSelectedSetting({ index });
  return true;
}

function settingSliderValueFromPoint(index, x, options = {}) {
  const row = settingsRows()[index];
  if (!row || row.type !== "slider") {
    return null;
  }

  const rect = settingsRowRect(index);
  const slider = settingsSliderRect(rect);
  const hitX = slider.x - SETTINGS_PANEL.sliderEndPadding;
  const hitWidth = slider.width + SETTINGS_PANEL.sliderEndPadding * 2;
  if (!options.clampOutside && (x < hitX || x > hitX + hitWidth)) {
    return null;
  }
  return clamp((x - slider.x) / Math.max(1, slider.width), 0, 1);
}

function settingsSliderRect(rowRect) {
  return {
    x: rowRect.x + rowRect.width - SETTINGS_PANEL.sliderWidth - SETTINGS_PANEL.sliderEndPadding,
    y: rowRect.y + 6,
    width: SETTINGS_PANEL.sliderWidth,
    height: 6
  };
}

function beginSettingsDrag(index, pointerId) {
  const row = settingsRows()[index];
  if (!row || row.type !== "slider") {
    clearSettingsDrag();
    return false;
  }

  state.settingsUi.dragIndex = index;
  state.settingsUi.dragPointerId = pointerId;
  return true;
}

function updateSettingsDrag(x, y, pointerId) {
  if (!Number.isInteger(state.settingsUi.dragIndex)) {
    return false;
  }

  if (
    state.settingsUi.dragPointerId !== null &&
    state.settingsUi.dragPointerId !== undefined &&
    pointerId !== state.settingsUi.dragPointerId
  ) {
    return true;
  }

  const index = state.settingsUi.dragIndex;
  const row = settingsRows()[index];
  if (!row || row.type !== "slider") {
    clearSettingsDrag(pointerId);
    return false;
  }

  state.settingsUi.selectedIndex = index;
  setSettingValue(row.id, settingSliderValueFromPoint(index, x, { clampOutside: true }), { silent: true });
  requestVolumePreview(row.id);
  return true;
}

function clearSettingsDrag(pointerId = null) {
  if (
    pointerId !== null &&
    pointerId !== undefined &&
    state.settingsUi.dragPointerId !== null &&
    state.settingsUi.dragPointerId !== undefined &&
    pointerId !== state.settingsUi.dragPointerId
  ) {
    return;
  }

  state.settingsUi.dragIndex = null;
  state.settingsUi.dragPointerId = null;
}

function settingsLeaveControlAtPoint(x, y) {
  if (!isSettingsMenu()) {
    return false;
  }

  const rect = settingsLeaveControlRect();
  return pointInRect(x, y, rect);
}

function settingsLeaveControlRect() {
  if (mobileControlsActive()) {
    return {
      x: MOBILE_HUD_ACTION_X,
      y: mobileHudControlBlockY(MOBILE_HUD_ACTION_HEIGHT),
      width: 96,
      height: MOBILE_HUD_ACTION_HEIGHT
    };
  }

  const position = hudControlPosition(0, { count: 1 });
  return {
    x: position.x,
    y: position.y,
    width: 96,
    height: 13
  };
}

function hudControlPosition(index, options = {}) {
  const placement = state.settings.hudLocation || DEFAULT_SETTINGS.hudLocation;
  const step = Math.max(1, Math.floor(Number(options.lineStep) || 14));
  const lineHeight = Math.max(1, Math.min(step, Math.floor(Number(options.lineHeight) || HUD_CONTROL_VISIBLE_HEIGHT)));
  const count = Math.max(1, Math.floor(Number(options.count) || 3));
  const panelHeight = Math.max(1, Math.floor(Number(options.panelHeight) || 58));
  const frame = framebufferSize();
  if (placement === "top") {
    return {
      x: HUD_EDGE_INSET,
      y: HUD_EDGE_INSET + index * step
    };
  }

  if (placement === "bottom") {
    const rowIndex = Math.max(0, Math.min(count - 1, Math.floor(Number(index) || 0)));
    return {
      x: HUD_EDGE_INSET,
      y: Math.max(HUD_EDGE_INSET, frame.height - HUD_EDGE_INSET - lineHeight - rowIndex * step)
    };
  }

  const panel = hudPanelRect(HUD_PANEL_MIN_WIDTH, panelHeight);
  return {
    x: panel.x + 2,
    y: panel.y + panel.height + HUD_PANEL_ACTION_GAP + index * step
  };
}

function hudPanelRect(width, height) {
  const frame = framebufferSize();
  const placement = state.settings.hudLocation || DEFAULT_SETTINGS.hudLocation;
  if (placement === "top") {
    return {
      x: Math.max(HUD_EDGE_INSET, frame.width - width - HUD_EDGE_INSET),
      y: HUD_EDGE_INSET,
      width,
      height
    };
  }

  if (placement === "bottom") {
    return {
      x: Math.max(HUD_EDGE_INSET, frame.width - width - HUD_EDGE_INSET),
      y: Math.max(HUD_EDGE_INSET, frame.height - height - HUD_EDGE_INSET),
      width,
      height
    };
  }

  return {
    x: HUD_EDGE_INSET,
    y: HUD_EDGE_INSET,
    width,
    height
  };
}

function updateSettingsSelectionFromPoint(x, y) {
  const index = settingsIndexAtPoint(x, y);
  if (Number.isInteger(index)) {
    state.settingsUi.selectedIndex = index;
  }
  return index;
}

function moveSettingsSelection(direction) {
  const rows = settingsRows();
  if (rows.length <= 0) {
    state.settingsUi.selectedIndex = 0;
    return;
  }

  const next = (state.settingsUi.selectedIndex + Math.sign(direction || 1) + rows.length) % rows.length;
  state.settingsUi.selectedIndex = next;
  requestMechanicalBeep();
}

function isSettingsMenu() {
  return state.room?.state === "menu" && state.menu.room === MENU_ROOMS.settings;
}

function activateSelectedSetting(options = {}) {
  const rows = settingsRows();
  if (Object.prototype.hasOwnProperty.call(options, "index") && !Number.isInteger(options.index)) {
    return false;
  }

  const index = clamp(
    Number.isInteger(options.index) ? options.index : state.settingsUi.selectedIndex,
    0,
    Math.max(0, rows.length - 1)
  );
  const row = rows[index];
  if (!row) {
    return false;
  }

  state.settingsUi.selectedIndex = index;
  if (row.id === "back") {
    leaveSettingsMenuRoom();
    return true;
  }

  if (row.type === "slider") {
    const value = Number.isFinite(options.value)
      ? options.value
      : Number(state.settings[row.id] || 0) + 0.1;
    setSettingValue(row.id, value > 1 ? 0 : value);
    return true;
  }

  adjustSelectedSetting(1);
  return true;
}

function adjustSelectedSetting(direction) {
  const rows = settingsRows();
  const row = rows[state.settingsUi.selectedIndex];
  if (!row || row.id === "back") {
    return false;
  }

  if (row.id === "hudLocation") {
    const current = Math.max(0, HUD_LOCATIONS.indexOf(state.settings.hudLocation));
    const next = (current + Math.sign(direction || 1) + HUD_LOCATIONS.length) % HUD_LOCATIONS.length;
    setSettingValue("hudLocation", HUD_LOCATIONS[next]);
    return true;
  }

  if (row.type === "toggle") {
    setSettingValue(row.id, !state.settings[row.id]);
    return true;
  }

  if (row.type === "slider") {
    setSettingValue(row.id, Number(state.settings[row.id] || 0) + Math.sign(direction || 1) * 0.1);
    return true;
  }

  return false;
}

function setSettingValue(id, value, options = {}) {
  if (id === "hudLocation") {
    state.settings.hudLocation = HUD_LOCATIONS.includes(value)
      ? value
      : DEFAULT_SETTINGS.hudLocation;
  } else if (id === "voiceChat") {
    state.settings.voiceChat = Boolean(value);
    if (state.settings.voiceChat && Number(state.settings.voiceVolume || 0) <= 0) {
      state.settings.voiceVolume = DEFAULT_SETTINGS.voiceVolume;
    }
  } else if (id === "micCapture") {
    state.settings.micCapture = Boolean(value);
  } else if (id === "masterVolume" || id === "effectsVolume" || id === "musicVolume" || id === "voiceVolume") {
    const previousEffectiveVoiceVolume = effectiveVoiceSettingVolume(state.settings);
    const clampedValue = clamp(Number(value), 0, 1);
    state.settings[id] = clampedValue;
    const nextEffectiveVoiceVolume = effectiveVoiceSettingVolume(state.settings);
    if ((id === "masterVolume" || id === "voiceVolume") && nextEffectiveVoiceVolume <= 0) {
      state.settings.voiceChat = false;
    } else if (
      (id === "masterVolume" || id === "voiceVolume") &&
      previousEffectiveVoiceVolume <= 0 &&
      nextEffectiveVoiceVolume > 0 &&
      state.settings.voiceChat === false
    ) {
      state.settings.voiceChat = true;
    }
  } else {
    return;
  }

  saveSettings();
  applySettingsSideEffects(id);
  if (!options.silent) {
    if (isVolumeSetting(id)) {
      requestVolumePreview(id, { force: true });
    } else {
      requestMechanicalBeep();
    }
  }
}

function applySettingsSideEffects(id = "") {
  if (id === "voiceChat" || id === "voiceVolume" || id === "masterVolume") {
    if (!state.settings.voiceChat) {
      stopVoiceRoom({ keepGesture: true });
    } else {
      syncVoiceRoomState();
    }
  }

  if (id === "masterVolume" || id === "musicVolume") {
    updateMusicPlayback({ force: true });
  }

  if (id === "micCapture") {
    if (state.settings.micCapture === false) {
      stopVoiceMicrophone();
    } else {
      syncVoiceRoomState();
    }
  }
}

function isVolumeSetting(id) {
  return id === "masterVolume" || id === "effectsVolume" || id === "musicVolume" || id === "voiceVolume";
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
  const selectedPresetId = selectedThemePresetId();
  const themeMatchesKnownPreset = Boolean(selectedPresetId);
  const ringItems = [
    // { type: "home" },
    ...presetItems,
    // presetItems[0],
    // presetItems[1],
    // presetItems[2],
    // presetItems[3],
    // presetItems[4],
    // presetItems[5],
    // presetItems[6],
    { type: "random" },
  ].filter(Boolean);
  const entities = ringItems.map((item, index) => {
    const angle = startAngle + (index * Math.PI * 2) / ringItems.length;
    const x = center.x + Math.cos(angle) * THEME_SWATCH_RING_RADIUS;
    const y = center.y + Math.sin(angle) * THEME_SWATCH_RING_RADIUS;

    if (item.type === "random") {
      return themeSwatchWithEffectColors({
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
        selected: !themeMatchesKnownPreset
      });
    }

    if (item.type === "home") {
      return themeSwatchWithEffectColors({
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
      });
    }

    const { preset } = item;
    const id = `menu-theme-${preset.id}`;
    const selected = selectedPresetId === preset.id;
    const swatchTheme = selected ? state.theme : preset;
    return themeSwatchWithEffectColors({
      id,
      type: "themeSwatch",
      action: "select-theme",
      label: String(item.themeNumber),
      themeId: preset.id,
      background: swatchTheme.background,
      foreground: swatchTheme.foreground,
      backing: swatchTheme.backing || "#000000",
      x,
      y,
      radius: THEME_SWATCH_RADIUS,
      active: state.menu.activeTargetId === id,
      selected
    });
  });

  return [
    {
      id: "menu-theme-band",
      type: "themeBand",
      x: center.x,
      y: center.y,
      ringRadius: THEME_SWATCH_RING_RADIUS,
      bandRadius: THEME_SWATCH_RADIUS
    },
    ...entities
  ];
}

function themeSwatchWithEffectColors(entity) {
  const effect = themeSwatchEffectState();
  if (!effect) {
    return entity;
  }

  return {
    ...entity,
    background: mixHexColor(effect.theme.background, entity.background, effect.t),
    foreground: mixHexColor(effect.theme.foreground, entity.foreground, effect.t),
    backing: mixHexColor(effect.theme.backing, entity.backing, effect.t)
  };
}

function themeSwatchEffectState(nowMs = performance.now()) {
  const startedAt = Number(state.menu.themeFocusStartedMs || 0);
  const until = Number(state.menu.themeFocusUntilMs || 0);
  const theme = normalizeTheme(state.menu.themeFocusTheme);
  if (!theme || startedAt <= 0 || nowMs >= until) {
    return null;
  }

  const elapsed = Math.max(0, nowMs - startedAt);
  const fadeElapsed = elapsed - THEME_SWATCH_EFFECT_HOLD_MS;
  const fadeDuration = Math.max(1, THEME_SWATCH_EFFECT_FADE_MS);
  return {
    theme,
    t: fadeElapsed <= 0 ? 0 : clamp(fadeElapsed / fadeDuration, 0, 1)
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

function loadPerfDebug() {
  return window.localStorage.getItem(PERF_DEBUG_STORAGE_KEY) === "1";
}

function loadSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "null");
    return normalizeSettings(stored);
  } catch {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const masterVolume = clamp(Number(source.masterVolume ?? DEFAULT_SETTINGS.masterVolume), 0, 1);
  const voiceVolume = clamp(Number(source.voiceVolume ?? DEFAULT_SETTINGS.voiceVolume), 0, 1);
  const hudLocation = source.hudLocation ?? source.controlsPlacement;
  return {
    hudLocation: HUD_LOCATIONS.includes(hudLocation)
      ? hudLocation
      : DEFAULT_SETTINGS.hudLocation,
    voiceChat: source.voiceChat !== false && masterVolume * voiceVolume > 0,
    micCapture: source.micCapture !== false,
    masterVolume,
    effectsVolume: clamp(Number(source.effectsVolume ?? DEFAULT_SETTINGS.effectsVolume), 0, 1),
    musicVolume: clamp(Number(source.musicVolume ?? DEFAULT_SETTINGS.musicVolume), 0, 1),
    voiceVolume
  };
}

function saveSettings() {
  state.settings = normalizeSettings(state.settings);
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function setBotDebugOverlay(enabled) {
  state.botDebugOverlay = Boolean(enabled);
  setBotDebugEnabled(state.botDebugOverlay);
  window.localStorage.setItem(BOT_DEBUG_OVERLAY_STORAGE_KEY, state.botDebugOverlay ? "1" : "0");
  console.log(`BITSPACE bot debug overlay ${state.botDebugOverlay ? "on" : "off"}`);
  return state.botDebugOverlay;
}

function setPerfDebug(enabled) {
  state.perfDebug.enabled = Boolean(enabled);
  window.localStorage.setItem(PERF_DEBUG_STORAGE_KEY, state.perfDebug.enabled ? "1" : "0");
  resetNetworkPerfMetrics();
  state.perfDebug.lastNowMs = 0;
  state.perfDebug.fps = 0;
  state.perfDebug.frameMs = 0;
  state.perfDebug.updateMs = 0;
  state.perfDebug.renderMs = 0;
  state.perfDebug.drawMs = 0;
  state.perfDebug.presentMs = 0;
  state.perfDebug.minimapMs = 0;
  state.perfDebug.stormGpuMs = 0;
  state.perfDebug.stormGpuReadMs = 0;
  state.perfDebug.stormGpuCalls = 0;
  state.perfDebug.stormGpuRequests = 0;
  state.perfDebug.visibilityGpuMs = 0;
  state.perfDebug.visibilityGpuReadMs = 0;
  state.perfDebug.visibilityGpuCalls = 0;
  state.perfDebug.visibilityGpuRequests = 0;
  state.perfDebug.stormGpuReady = false;
  state.perfDebug.frameGpuReady = false;
  state.perfDebug.frameStormReady = false;
  state.perfDebug.frameCheckerReady = false;
  state.perfDebug.buckets = {};
  state.perfDebug.panelLastUpdateMs = 0;
  state.perfDebug.panelLastText = "";
  updatePerfDebugPanel(performance.now(), true);
  console.log(`BITSPACE perf debug ${state.perfDebug.enabled ? "on" : "off"}`);
  return state.perfDebug.enabled;
}

function resetNetworkPerfMetrics(nowMs = performance.now()) {
  state.net.inputSentCount = 0;
  state.net.inputRate = 0;
  state.net.lastInputRateAtMs = nowMs;
  state.net.snapshotCount = 0;
  state.net.snapshotRate = 0;
  state.net.lastSnapshotRateAtMs = nowMs;
  state.net.snapshotAgeMs = 0;
  state.net.lastSnapshotBytes = 0;
  state.net.lastSnapshotDelta = false;
}

function setPlayerMapFeatureEnabled(enabled) {
  DEBUG_FEATURES.playerMap = Boolean(enabled);
  if (!DEBUG_FEATURES.playerMap) {
    state.playerMap.large = false;
  }
  console.log(`BITSPACE player map feature ${DEBUG_FEATURES.playerMap ? "on" : "off"}`);
  return DEBUG_FEATURES.playerMap;
}

function installControlHandles() {
  const handles = window.controls && typeof window.controls === "object"
    ? window.controls
    : {};
  handles.debugBot = (enabled = null) => setBotDebugOverlay(
    typeof enabled === "boolean" ? enabled : !state.botDebugOverlay
  );
  handles.debugMap = (enabled = null) => setPlayerMapFeatureEnabled(
    typeof enabled === "boolean" ? enabled : !DEBUG_FEATURES.playerMap
  );
  handles.debugPerf = (enabled = null) => setPerfDebug(
    typeof enabled === "boolean" ? enabled : !state.perfDebug.enabled
  );
  handles.voiceStart = () => {
    voice.micAttempted = false;
    voice.micError = null;
    markVoiceUserGesture();
    syncVoiceRoomState();
    startVoiceMicrophone();
    return voiceDebugSnapshot();
  };
  handles.voiceDebug = () => {
    const snapshot = voiceDebugSnapshot();
    console.table(snapshot.peers);
    console.log("BITSPACE voice", snapshot);
    return snapshot;
  };
  handles.voiceStats = async () => {
    const snapshot = await voiceStatsSnapshot();
    console.log("BITSPACE voice stats", snapshot);
    console.table(snapshot.peers);
    return snapshot;
  };
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
  handles.coreStats = () => {
    const snapshot = bitspaceCoreStats();
    console.table([snapshot]);
    return snapshot;
  };
  handles.resetCoreStats = () => {
    const snapshot = resetBitspaceCoreStats();
    console.table([snapshot]);
    return snapshot;
  };
  window.controls = handles;
}

function updatePerfFrameMetrics(nowMs) {
  if (!Number.isFinite(nowMs) || nowMs <= 0) {
    return;
  }
  const previous = state.perfDebug.lastNowMs;
  state.perfDebug.lastNowMs = nowMs;
  if (!previous) {
    return;
  }

  const frameMs = clamp(nowMs - previous, 0, 1000);
  const fps = frameMs > 0 ? 1000 / frameMs : 0;
  const alpha = 0.12;
  state.perfDebug.frameMs = state.perfDebug.frameMs
    ? state.perfDebug.frameMs * (1 - alpha) + frameMs * alpha
    : frameMs;
  state.perfDebug.fps = state.perfDebug.fps
    ? state.perfDebug.fps * (1 - alpha) + fps * alpha
    : fps;
  updateNetworkPerfMetrics(nowMs, alpha);
}

function updateNetworkPerfMetrics(nowMs, alpha) {
  const net = state.net;
  net.snapshotAgeMs = net.lastSnapshotAtMs > 0
    ? Math.max(0, nowMs - net.lastSnapshotAtMs)
    : 0;

  const snapshotElapsedSeconds = (nowMs - net.lastSnapshotRateAtMs) / 1000;
  if (snapshotElapsedSeconds >= 1) {
    const snapshotRate = net.snapshotCount / snapshotElapsedSeconds;
    net.snapshotRate = net.snapshotRate
      ? net.snapshotRate * (1 - alpha) + snapshotRate * alpha
      : snapshotRate;
    net.snapshotCount = 0;
    net.lastSnapshotRateAtMs = nowMs;
  }

  const inputElapsedSeconds = (nowMs - net.lastInputRateAtMs) / 1000;
  if (inputElapsedSeconds >= 1) {
    const inputRate = net.inputSentCount / inputElapsedSeconds;
    net.inputRate = net.inputRate
      ? net.inputRate * (1 - alpha) + inputRate * alpha
      : inputRate;
    net.inputSentCount = 0;
    net.lastInputRateAtMs = nowMs;
  }
}

function updatePerfRenderMetrics(renderMs, renderPerf = null) {
  if (!Number.isFinite(renderMs)) {
    return;
  }
  const alpha = 0.12;
  state.perfDebug.renderMs = state.perfDebug.renderMs
    ? state.perfDebug.renderMs * (1 - alpha) + renderMs * alpha
    : renderMs;
  updatePerfMetric("drawMs", renderPerf?.drawMs, alpha);
  updatePerfMetric("presentMs", renderPerf?.presentMs, alpha);
  updatePerfMetric("minimapMs", renderPerf?.minimapMs, alpha);
  updatePerfMetric("stormGpuMs", renderPerf?.stormGpuMs, alpha);
  updatePerfMetric("stormGpuReadMs", renderPerf?.stormGpuReadMs, alpha);
  if (Number.isFinite(renderPerf?.stormGpuCalls)) {
    state.perfDebug.stormGpuCalls = renderPerf.stormGpuCalls;
  }
  if (Number.isFinite(renderPerf?.stormGpuRequests)) {
    state.perfDebug.stormGpuRequests = renderPerf.stormGpuRequests;
  }
  updatePerfMetric("visibilityGpuMs", renderPerf?.visibilityGpuMs, alpha);
  updatePerfMetric("visibilityGpuReadMs", renderPerf?.visibilityGpuReadMs, alpha);
  if (Number.isFinite(renderPerf?.visibilityGpuCalls)) {
    state.perfDebug.visibilityGpuCalls = renderPerf.visibilityGpuCalls;
  }
  if (Number.isFinite(renderPerf?.visibilityGpuRequests)) {
    state.perfDebug.visibilityGpuRequests = renderPerf.visibilityGpuRequests;
  }
  state.perfDebug.stormGpuReady = Boolean(renderPerf?.stormGpuReady);
  state.perfDebug.frameGpuReady = Boolean(renderPerf?.frameGpuReady);
  state.perfDebug.frameStormReady = Boolean(renderPerf?.frameStormReady);
  state.perfDebug.frameCheckerReady = Boolean(renderPerf?.frameCheckerReady);
  updatePerfBuckets(renderPerf?.buckets, alpha);
}

function updatePerfUpdateMetrics(updateMs) {
  updatePerfMetric("updateMs", updateMs, 0.12);
}

function measureUpdateBucket(key, callback) {
  if (!state.perfDebug.enabled) {
    return callback();
  }

  const start = performance.now();
  try {
    return callback();
  } finally {
    updatePerfBucket(key, performance.now() - start, 0.12);
  }
}

function updatePerfMetric(key, value, alpha) {
  if (!Number.isFinite(value)) {
    return;
  }
  state.perfDebug[key] = state.perfDebug[key]
    ? state.perfDebug[key] * (1 - alpha) + value * alpha
    : value;
}

function updatePerfBucket(key, value, alpha) {
  if (!Number.isFinite(value)) {
    return;
  }

  const buckets = state.perfDebug.buckets;
  buckets[key] = buckets[key]
    ? buckets[key] * (1 - alpha) + value * alpha
    : value;
}

function updatePerfBuckets(buckets, alpha) {
  if (!buckets || typeof buckets !== "object") {
    return;
  }

  const next = { ...state.perfDebug.buckets };
  for (const [key, value] of Object.entries(buckets)) {
    if (!Number.isFinite(value)) {
      continue;
    }
    next[key] = next[key]
      ? next[key] * (1 - alpha) + value * alpha
      : value;
  }
  state.perfDebug.buckets = next;
}

function perfDebugRenderState() {
  const core = bitspaceCoreStats();
  return {
    fps: state.perfDebug.fps,
    frameMs: state.perfDebug.frameMs,
    updateMs: state.perfDebug.updateMs,
    renderMs: state.perfDebug.renderMs,
    drawMs: state.perfDebug.drawMs,
    presentMs: state.perfDebug.presentMs,
    minimapMs: state.perfDebug.minimapMs,
    stormGpuMs: state.perfDebug.stormGpuMs,
    stormGpuReadMs: state.perfDebug.stormGpuReadMs,
    stormGpuCalls: state.perfDebug.stormGpuCalls,
    stormGpuRequests: state.perfDebug.stormGpuRequests,
    visibilityGpuMs: state.perfDebug.visibilityGpuMs,
    visibilityGpuReadMs: state.perfDebug.visibilityGpuReadMs,
    visibilityGpuCalls: state.perfDebug.visibilityGpuCalls,
    visibilityGpuRequests: state.perfDebug.visibilityGpuRequests,
    stormGpuReady: state.perfDebug.stormGpuReady,
    frameGpuReady: state.perfDebug.frameGpuReady,
    frameStormReady: state.perfDebug.frameStormReady,
    frameCheckerReady: state.perfDebug.frameCheckerReady,
    buckets: state.perfDebug.buckets,
    net: { ...state.net },
    core
  };
}

function updatePerfDebugPanel(nowMs = performance.now(), force = false) {
  if (!perfDebugPanel) {
    return;
  }
  if (!state.perfDebug.enabled) {
    if (perfDebugRoot) {
      perfDebugRoot.hidden = true;
    } else {
      perfDebugPanel.hidden = true;
    }
    state.perfDebug.panelLastText = "";
    return;
  }
  if (
    !force &&
    state.perfDebug.panelLastUpdateMs &&
    nowMs - state.perfDebug.panelLastUpdateMs < PERF_DEBUG_PANEL_INTERVAL_MS
  ) {
    return;
  }

  const perf = perfDebugRenderState();
  const core = perf.core || {};
  const buckets = perf.buckets || {};
  const net = perf.net || {};
  state.perfDebug.panelLastUpdateMs = nowMs;
  if (perfDebugRoot) {
    perfDebugRoot.hidden = false;
  } else {
    perfDebugPanel.hidden = false;
  }
  const color = state.theme.foreground || RENDER.foreground;
  if (state.perfDebug.panelLastColor !== color) {
    state.perfDebug.panelLastColor = color;
    if (perfDebugRoot) {
      perfDebugRoot.style.color = color;
    } else {
      perfDebugPanel.style.color = color;
      perfDebugPanel.style.borderColor = color;
    }
  }
  const text = [
    "BITSPACE PERF",
    `FPS        ${formatPerfNumber(perf.fps, 1)}`,
    `FRAME MS   ${formatPerfNumber(perf.frameMs, 2)}`,
    `UPDATE MS  ${formatPerfNumber(perf.updateMs, 2)}`,
    `U INPUT    ${formatPerfNumber(buckets.updateInputMs, 2)}`,
    `U GAME     ${formatPerfNumber(buckets.updateGameMs, 2)}`,
    `U UI       ${formatPerfNumber(buckets.updateUiMs, 2)}`,
    `U SNAP     ${formatPerfNumber(buckets.snapshotMs, 2)}`,
    `U MAP      ${formatPerfNumber(buckets.mapStateMs, 2)}`,
    `U AUDIO    ${formatPerfNumber(buckets.audioMs, 2)}`,
    `NET SNAP   ${formatPerfNumber(net.snapshotRate || 0, 1)}HZ/${formatPerfInteger(net.snapshotAgeMs || 0)}MS ${net.lastSnapshotDelta ? "DELTA" : "FULL"}`,
    `NET SIZE   ${formatPerfBytes(net.lastSnapshotBytes || 0)}`,
    `NET INPUT  ${formatPerfNumber(net.inputRate || 0, 1)}HZ`,
    `RENDER MS  ${formatPerfNumber(perf.renderMs, 2)}`,
    `DRAW MS    ${formatPerfNumber(perf.drawMs, 2)}`,
    `PRESENT MS ${formatPerfNumber(perf.presentMs, 2)}`,
    `FRAME GPU  ${perf.frameGpuReady ? "ON" : "OFF"}`,
    `FRAME STORM ${perf.frameStormReady ? "ON" : "OFF"}`,
    `FRAME CHECK ${perf.frameCheckerReady ? "ON" : "OFF"}`,
    `MINIMAP MS ${formatPerfNumber(perf.minimapMs, 2)}`,
    `STORM GPU  ${perf.stormGpuReady ? `${perf.stormGpuRequests || 0}->${perf.stormGpuCalls || 0}/${formatPerfNumber(perf.stormGpuMs, 3)}MS` : "OFF"}`,
    `GPU READ   ${formatPerfNumber(perf.stormGpuReadMs, 3)}MS`,
    `VIS GPU    ${perf.stormGpuReady ? `${perf.visibilityGpuRequests || 0}->${perf.visibilityGpuCalls || 0}/${formatPerfNumber(perf.visibilityGpuMs, 3)}MS` : "OFF"}`,
    `VIS READ   ${formatPerfNumber(perf.visibilityGpuReadMs, 3)}MS`,
    `R VIS      ${formatPerfNumber(buckets.visibilityMs, 2)}`,
    `R GHOST    ${formatPerfNumber(buckets.ghostMs, 2)}`,
    `R GCHK     ${formatPerfNumber(buckets.ghostCheckerMs, 2)}`,
    `R GOUT     ${formatPerfNumber(buckets.ghostOutlineMs, 2)}`,
    `R GSTORM   ${formatPerfNumber(buckets.ghostStormMs, 2)}`,
    `R BG       ${formatPerfNumber(buckets.backgroundMs, 2)}`,
    `R STARS    ${formatPerfNumber(buckets.starsMs, 2)}`,
    `R AST      ${formatPerfNumber(buckets.asteroidMs, 2)}`,
    `R ENT      ${formatPerfNumber(buckets.entitiesMs, 2)}`,
    `R EMIT     ${formatPerfNumber(buckets.particleEmitMs, 2)}`,
    `R PART     ${formatPerfNumber(buckets.particlesMs, 2)}`,
    `R RAYS     ${formatPerfNumber(buckets.raysMs, 2)}`,
    `R SHIPS    ${formatPerfNumber(buckets.shipsMs, 2)}`,
    `R HUD      ${formatPerfNumber(buckets.hudMs, 2)}`,
    `CORE       ${core.ready ? "WASM" : "JS"}`,
    `VIS CALLS  ${core.visibilityNativeCalls || 0}/${core.visibilityCalls || 0}`,
    `VIS AVG    ${formatPerfNumber(core.visibilityAvgMs, 3)}MS`,
    `VIS SEGS   ${core.visibilityMaxSegments || 0}`,
    `LAYER AVG  ${formatPerfNumber(core.renderLayerAvgMs, 3)}MS`,
    `STORM AVG  ${formatPerfNumber(core.stormAvgMs, 3)}MS`,
    `STORM LYR  ${formatPerfNumber(core.stormLayerAvgMs, 3)}MS`,
    `STORM RUN  ${formatPerfNumber(core.stormRunAvgMs, 3)}MS/${core.stormRunMaxRuns || 0}`,
    `STORM BND  ${formatPerfNumber(core.stormBoundaryRunAvgMs, 3)}MS/${core.stormBoundaryRunMaxRuns || 0}`,
    `ROCK AVG   ${formatPerfNumber(core.huckRockAvgMs, 3)}MS`,
    `PATH AVG   ${formatPerfNumber(core.pathAvgMs, 3)}MS`,
    `TRAJ AVG   ${formatPerfNumber(core.avgMs, 3)}MS`
  ].join("\n");
  if (state.perfDebug.panelLastText !== text) {
    state.perfDebug.panelLastText = text;
    perfDebugPanel.textContent = text;
  }
}

function installPerfDebugCopyButton() {
  if (!perfDebugCopy) {
    return;
  }

  perfDebugCopy.addEventListener("click", async () => {
    const text = state.perfDebug.panelLastText || perfDebugPanel?.textContent || "";
    if (!text) {
      return;
    }

    const copied = await copyTextToClipboard(text);
    perfDebugCopy.textContent = copied ? "COPIED" : "FAILED";
    perfDebugCopy.blur();
    if (perfDebugCopyResetTimer) {
      window.clearTimeout(perfDebugCopyResetTimer);
    }
    perfDebugCopyResetTimer = window.setTimeout(() => {
      perfDebugCopy.textContent = "COPY";
      perfDebugCopyResetTimer = null;
    }, 900);
  });
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // Fall through to the textarea path for browsers that block clipboard writes.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-1000px";
  input.style.top = "-1000px";
  document.body.append(input);
  input.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    input.remove();
  }
  return copied;
}

function formatPerfNumber(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "-";
}

function formatPerfInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "-";
}

function formatPerfBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${Math.round(bytes)}B`;
}

function resetTheme() {
  setTheme(defaultTheme());
}

function cycleThemePreset(direction = 1) {
  const preset = adjacentThemePreset(state.theme, direction);
  setTheme(preset, preset.id);
}

function setTheme(theme, baseId = themePresetIdForTheme(theme)) {
  state.theme = normalizeTheme(theme);
  state.menu.themeBaseId = validThemePresetId(baseId);
  applyThemeToSource(state.theme);
  saveTheme();
}

function focusSelectedThemeSwatch(theme = state.theme) {
  const normalized = normalizeTheme(theme);
  const now = performance.now();
  state.menu.themeFocusStartedMs = now;
  state.menu.themeFocusUntilMs = now + THEME_SWATCH_EFFECT_HOLD_MS + THEME_SWATCH_EFFECT_FADE_MS;
  state.menu.themeFocusTheme = normalized;
}

function randomTheme() {
  return Math.random() < 0.5
    ? generatedRandomTheme()
    : hueRotatedPresetTheme();
}

function generatedRandomTheme() {
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

function hueRotatedPresetTheme() {
  const presets = THEME_PRESETS
    .map((preset) => normalizeTheme(preset))
    .filter((preset) => preset && themeHasHueRotatableColor(preset));
  if (presets.length <= 0) {
    return generatedRandomTheme();
  }

  const preset = presets[Math.floor(Math.random() * presets.length)];
  return scoredRandomizedTheme(
    () => randomizedThemeHueFrame(preset, preset, THEME_RANDOM_MIN_HUE_DISTANCE_DEGREES)
  );
}

function hueRotateTheme(theme, degrees) {
  const normalized = normalizeTheme(theme);
  if (!normalized) {
    return defaultTheme();
  }

  return {
    background: hueRotateHex(normalized.background, degrees),
    foreground: hueRotateHex(normalized.foreground, degrees),
    backing: hueRotateHex(normalized.backing, degrees)
  };
}

function randomizedThemeVariant(theme) {
  const makeCandidate = themeHasHueRotatableColor(theme)
    ? () => randomizedThemeHueFrame(theme, state.theme, THEME_REPEAT_RANDOM_MIN_HUE_DISTANCE_DEGREES)
    : () => generatedRandomTheme();
  return scoredRandomizedTheme(makeCandidate, (candidate) => !themeMatchesPreset(candidate, theme));
}

function scoredRandomizedTheme(makeCandidate, validate = () => true) {
  const candidates = [];
  for (let attempt = 0; attempt < THEME_RANDOM_CONTRAST_SAMPLES; attempt += 1) {
    const theme = normalizeTheme(makeCandidate());
    if (!theme || !validate(theme)) {
      continue;
    }

    candidates.push({
      theme,
      contrast: themeForegroundBackgroundContrast(theme)
    });
  }

  if (candidates.length <= 0) {
    return generatedRandomTheme();
  }

  candidates.sort((a, b) => b.contrast - a.contrast);
  let totalWeight = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const rank = candidates.length - index;
    const contrastWeight = Math.max(0.05, candidates[index].contrast);
    candidates[index].weight = rank * rank * contrastWeight;
    totalWeight += candidates[index].weight;
  }

  let remainingWeight = totalWeight * Math.random();
  for (const candidate of candidates) {
    remainingWeight -= candidate.weight;
    if (remainingWeight <= 0) {
      return candidate.theme;
    }
  }

  return candidates[0].theme;
}

function themeForegroundBackgroundContrast(theme) {
  const normalized = normalizeTheme(theme);
  const background = hexToRgb(normalized?.background);
  const foreground = hexToRgb(normalized?.foreground);
  if (!background || !foreground) {
    return Number.NEGATIVE_INFINITY;
  }

  return relativeLuminance(foreground) - relativeLuminance(background);
}

function randomizedThemeHueFrame(baseTheme, currentTheme, minDegrees) {
  const baseHue = themeAverageHue(baseTheme);
  const currentHue = themeAverageHue(currentTheme);
  if (!Number.isFinite(baseHue) || !Number.isFinite(currentHue)) {
    return hueRotateTheme(baseTheme, randomThemeHueDelta(minDegrees));
  }

  const targetHue = normalizeHue(currentHue + randomThemeHueDelta(minDegrees));
  return transformThemeHueFrame(baseTheme, baseHue, targetHue, false);
}

function randomThemeHueDelta(minDegrees = THEME_RANDOM_MIN_HUE_DISTANCE_DEGREES) {
  const min = clamp(minDegrees, 0, 179.999);
  const magnitude = randomBetween(min, 180);
  return (Math.random() < 0.5 ? -1 : 1) * magnitude;
}

function transformThemeHueFrame(theme, sourceAverageHue, targetAverageHue, flipOffsets) {
  const normalized = normalizeTheme(theme);
  if (!normalized) {
    return defaultTheme();
  }

  return {
    background: transformHueFrameHex(normalized.background, sourceAverageHue, targetAverageHue, flipOffsets),
    foreground: transformHueFrameHex(normalized.foreground, sourceAverageHue, targetAverageHue, flipOffsets),
    backing: transformHueFrameHex(normalized.backing, sourceAverageHue, targetAverageHue, flipOffsets)
  };
}

function transformHueFrameHex(value, sourceAverageHue, targetAverageHue, flipOffsets) {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return value;
  }

  const hsl = rgbToHsl(rgb);
  if (hsl.s <= 0) {
    return value;
  }

  const offset = signedHueDelta(sourceAverageHue, hsl.h) * (flipOffsets ? -1 : 1);
  return hslToHex(targetAverageHue + offset, hsl.s, hsl.l);
}

function signedHueDelta(fromHue, toHue) {
  return ((toHue - fromHue + 540) % 360) - 180;
}

function themeHasHueRotatableColor(theme) {
  return [theme.background, theme.foreground, theme.backing].some((color) => {
    const rgb = hexToRgb(color);
    if (!rgb) {
      return false;
    }

    return rgbToHsl(rgb).s > 0;
  });
}

function themeAverageHue(theme) {
  const normalized = normalizeTheme(theme);
  if (!normalized) {
    return null;
  }

  let x = 0;
  let y = 0;
  let totalWeight = 0;
  for (const color of [normalized.background, normalized.foreground, normalized.backing]) {
    const rgb = hexToRgb(color);
    if (!rgb) {
      continue;
    }

    const hsl = rgbToHsl(rgb);
    if (hsl.s <= 0) {
      continue;
    }

    const radians = normalizeHue(hsl.h) * Math.PI / 180;
    const weight = hsl.s;
    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0 || (Math.abs(x) <= 0.0001 && Math.abs(y) <= 0.0001)) {
    return null;
  }

  return normalizeHue(Math.atan2(y, x) * 180 / Math.PI);
}

function hueRotateHex(value, degrees) {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return value;
  }

  const hsl = rgbToHsl(rgb);
  if (hsl.s <= 0) {
    return value;
  }
  return hslToHex(hsl.h + degrees, hsl.s, hsl.l);
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
  const selectedPreset = selectedThemePresetId();
  const currentIndex = selectedPreset
    ? THEME_PRESETS.findIndex((preset) => preset.id === selectedPreset)
    : THEME_PRESETS.findIndex((preset) => themeMatchesPreset(theme, preset));
  const step = direction < 0 ? -1 : 1;
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + step + THEME_PRESETS.length) % THEME_PRESETS.length;
  return THEME_PRESETS[nextIndex];
}

function themePresetIsSelected(preset) {
  return selectedThemePresetId() === preset?.id;
}

function selectedThemePresetId() {
  return validThemePresetId(state.menu?.themeBaseId) || themePresetIdForTheme(state.theme);
}

function themePresetIdForTheme(theme) {
  return THEME_PRESETS.find((preset) => themeMatchesPreset(theme, preset))?.id || null;
}

function validThemePresetId(id) {
  return THEME_PRESETS.some((preset) => preset.id === id) ? id : null;
}

function themeMatchesPreset(theme, preset) {
  const normalized = normalizeTheme(theme);
  const presetTheme = normalizeTheme(preset);
  return normalized?.foreground === presetTheme?.foreground &&
    normalized?.background === presetTheme?.background &&
    normalized?.backing === presetTheme?.backing;
}

function themeLabelForTheme(theme) {
  const baseId = theme === state.theme ? selectedThemePresetId() : null;
  const preset = THEME_PRESETS.find((candidate) => candidate.id === baseId) ||
    THEME_PRESETS.find((candidate) => themeMatchesPreset(theme, candidate));
  return preset?.label || "RANDOM";
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
    state.menu.themeBaseId = themePresetIdForTheme(theme);
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
  document.documentElement.style.setProperty("--bitspace-backing", backing);
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

function rgbToHsl(color) {
  const r = clamp(color.r, 0, 255) / 255;
  const g = clamp(color.g, 0, 255) / 255;
  const b = clamp(color.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta <= 0) {
    return {
      h: 0,
      s: 0,
      l: lightness * 100
    };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) {
    hue = 60 * (((g - b) / delta) % 6);
  } else if (max === g) {
    hue = 60 * ((b - r) / delta + 2);
  } else {
    hue = 60 * ((r - g) / delta + 4);
  }

  return {
    h: normalizeHue(hue),
    s: saturation * 100,
    l: lightness * 100
  };
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

function mixHexColor(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) {
    return to;
  }

  const amount = clamp(Number(t), 0, 1);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  });
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
  updateMobileControlUi();
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
  updateMobileControlUi();
}

function toggleBuildMode() {
  if (isInputBlocked() || !roomAllowsBuilding()) {
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

function markVoiceUserGesture() {
  voice.userGesture = true;
  resumeVoiceAudioContext();
  syncVoiceRoomState();
}

function syncVoiceRoomState() {
  updateLocalVoiceTrackState();

  if (!voiceRoomJoinAllowed()) {
    stopVoiceRoom({ keepGesture: true });
    return;
  }

  const roomId = state.room?.roomId || null;
  if (voice.joined && voice.roomId === roomId) {
    if (voice.userGesture && voiceMicCaptureAllowed()) {
      startVoiceMicrophone();
    } else if (!voiceMicCaptureAllowed() && voice.localStream) {
      stopVoiceMicrophone();
    }
    refreshVoiceRoomPeersIfNeeded();
    return;
  }

  if (voice.joined || voice.roomId) {
    stopVoiceRoom({ keepGesture: true });
  }

  startVoiceRoom();
}

function voiceRoomJoinAllowed() {
  if (
    !state.settings.voiceChat ||
    isMapGenMode() ||
    isLocalBotGame() ||
    !socket.connected ||
    !state.clientId ||
    !state.room ||
    state.room.queued === true
  ) {
    return false;
  }

  if (
    state.room.state !== "waiting" &&
    state.room.state !== "active" &&
    state.room.state !== "ended"
  ) {
    return false;
  }

  const participant = state.room.players?.find((candidate) => candidate.clientId === state.clientId);
  return Boolean(participant && participant.playerSlot !== false);
}

function voiceRoomTransmitAllowed() {
  if (!voiceRoomJoinAllowed()) {
    return false;
  }

  if (!voiceMicCaptureAllowed()) {
    return false;
  }

  if (state.room?.state === "waiting" || state.room?.state === "ended") {
    return true;
  }

  const localPlayer = localPlayerFromSnapshot();
  return Boolean(localPlayer && (localPlayer.alive === true || localPlayer.alive === false));
}

function voiceMicCaptureAllowed() {
  return state.settings?.micCapture !== false;
}

function expectedVoicePeerIds() {
  if (!state.room?.players || !state.clientId) {
    return [];
  }

  return state.room.players
    .filter((participant) => (
      participant.clientId &&
      participant.clientId !== state.clientId &&
      participant.connected !== false &&
      participant.playerSlot !== false &&
      participant.queued !== true
    ))
    .map((participant) => participant.clientId);
}

async function startVoiceRoom() {
  if (voice.starting || voice.joined || !voiceRoomJoinAllowed()) {
    return;
  }

  const nowMs = performance.now();
  if (voice.failed && nowMs < voice.retryAtMs) {
    return;
  }

  if (typeof RTCPeerConnection === "undefined") {
    voice.failed = true;
    voice.retryAtMs = nowMs + VOICE_RETRY_DELAY_MS;
    return;
  }

  const roomId = state.room?.roomId || null;
  voice.starting = true;
  try {
    if (voice.userGesture && voiceMicCaptureAllowed() && !voice.localStream) {
      await startVoiceMicrophone({ restartPeers: false });
    }

    voice.failed = false;
    voice.retryAtMs = 0;
    voice.roomId = roomId;
    voice.joined = true;
    updateLocalVoiceTrackState();
    resumeVoiceAudioContext();
    announceVoiceJoin({ force: true });
  } catch (error) {
    console.warn("BITSPACE voice unavailable", error);
    voice.failed = true;
    voice.retryAtMs = performance.now() + VOICE_RETRY_DELAY_MS;
  } finally {
    voice.starting = false;
  }
}

async function startVoiceMicrophone(options = {}) {
  if (
    voice.localStream ||
    voice.micStarting ||
    !voice.userGesture ||
    !voiceRoomJoinAllowed() ||
    !voiceMicCaptureAllowed()
  ) {
    return;
  }

  if (voice.micAttempted && voice.micError) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    voice.micAttempted = true;
    voice.micError = {
      name: "MediaDevicesUnavailable",
      message: "getUserMedia is unavailable"
    };
    return;
  }

  const roomId = state.room?.roomId || null;
  voice.micAttempted = true;
  voice.micStarting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    if (!voiceRoomJoinAllowed() || !voiceMicCaptureAllowed() || state.room?.roomId !== roomId) {
      stopVoiceStream(stream);
      return;
    }

    voice.micError = null;
    voice.localStream = stream;
    updateLocalVoiceTrackState();
    resumeVoiceAudioContext();
    setupLocalVoiceMeter();
    if (options.restartPeers !== false) {
      restartVoiceRoomForLocalTracks();
    }
  } catch (error) {
    console.warn("BITSPACE voice microphone unavailable", error);
    voice.micError = {
      name: error?.name || "MicrophoneError",
      message: error?.message || String(error || "microphone unavailable")
    };
  } finally {
    voice.micStarting = false;
  }
}

function restartVoiceRoomForLocalTracks() {
  if (!voice.joined || !voice.roomId || !socket.connected) {
    return;
  }

  for (const peerId of Array.from(voice.peers.keys())) {
    closeVoicePeer(peerId);
  }
  socket.emit(CLIENT_EVENTS.voiceLeave);
  voice.joined = false;
  voice.roomId = null;
  voice.lastJoinAnnounceAtMs = 0;
  startVoiceRoom();
}

function setupLocalVoiceMeter() {
  if (!voice.localStream || voice.localSource || voice.localStream.getAudioTracks().length <= 0) {
    return;
  }

  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  const source = context.createMediaStreamSource(voice.localStream);
  const analyser = context.createAnalyser();
  const zeroGain = context.createGain();
  analyser.fftSize = 256;
  zeroGain.gain.value = 0;
  source.connect(analyser);
  analyser.connect(zeroGain);
  zeroGain.connect(context.destination);
  voice.localSource = source;
  voice.localAnalyser = analyser;
  voice.localZeroGain = zeroGain;
}

function disconnectLocalVoiceMeter() {
  try {
    voice.localSource?.disconnect();
    voice.localAnalyser?.disconnect();
    voice.localZeroGain?.disconnect();
  } catch {
    // Local meter shutdown is best effort.
  }
  voice.localSource = null;
  voice.localAnalyser = null;
  voice.localZeroGain = null;
}

function refreshVoiceRoomPeersIfNeeded() {
  if (!voice.joined || !voice.roomId || !socket.connected) {
    return;
  }

  const expectedPeers = expectedVoicePeerIds();
  if (expectedPeers.length <= 0 || voice.peers.size >= expectedPeers.length) {
    return;
  }

  announceVoiceJoin();
  ensureExpectedVoicePeers(expectedPeers);
}

function ensureExpectedVoicePeers(expectedPeers = expectedVoicePeerIds()) {
  if (!voice.joined) {
    return;
  }

  for (const peerId of expectedPeers) {
    if (!voice.peers.has(peerId)) {
      ensureVoicePeer(peerId, { offer: true });
    }
  }
}

function announceVoiceJoin(options = {}) {
  if (!voice.joined || !voice.roomId || !socket.connected) {
    return;
  }

  const nowMs = performance.now();
  if (!options.force && nowMs - voice.lastJoinAnnounceAtMs < VOICE_PEER_REFRESH_MS) {
    return;
  }

  voice.lastJoinAnnounceAtMs = nowMs;
  socket.emit(CLIENT_EVENTS.voiceJoin);
}

function stopVoiceRoom(options = {}) {
  const notify = options.notify !== false;
  const keepGesture = options.keepGesture === true;
  if (notify && voice.joined && socket.connected) {
    socket.emit(CLIENT_EVENTS.voiceLeave);
  }

  for (const peerId of Array.from(voice.peers.keys())) {
    closeVoicePeer(peerId);
  }
  disconnectLocalVoiceMeter();
  stopVoiceStream(voice.localStream);
  voice.localStream = null;
  voice.micAttempted = false;
  voice.micStarting = false;
  voice.micError = null;
  voice.joined = false;
  voice.starting = false;
  voice.roomId = null;
  if (!keepGesture) {
    voice.userGesture = false;
  }
}

function stopVoiceMicrophone(options = {}) {
  if (!voice.localStream && !voice.localSource && !voice.localAnalyser && !voice.micStarting && !voice.micAttempted && !voice.micError) {
    return;
  }

  disconnectLocalVoiceMeter();
  stopVoiceStream(voice.localStream);
  voice.localStream = null;
  voice.micAttempted = false;
  voice.micStarting = false;
  voice.micError = null;
  if (options.restartPeers !== false && voice.joined) {
    restartVoiceRoomForLocalTracks();
  }
}

function stopVoiceStream(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function updateLocalVoiceTrackState() {
  if (!voice.localStream) {
    return;
  }

  const enabled = voiceRoomTransmitAllowed();
  for (const track of voice.localStream.getAudioTracks()) {
    track.enabled = enabled;
  }
}

function handleVoicePeers(payload = {}) {
  if (!voiceActiveForRoom(payload.roomId)) {
    return;
  }

  const peers = Array.isArray(payload.peers) ? payload.peers : [];
  for (const peerId of peers) {
    if (peerId && peerId !== state.clientId) {
      ensureVoicePeer(peerId, { offer: true });
    }
  }
}

function handleVoicePeerJoined(payload = {}) {
  if (!voiceActiveForRoom(payload.roomId) || payload.clientId === state.clientId) {
    return;
  }

  ensureVoicePeer(payload.clientId);
}

async function handleVoiceSignal(payload = {}) {
  if (!voiceActiveForRoom(payload.roomId) || !payload.fromId || payload.fromId === state.clientId) {
    return;
  }

  const signal = payload.signal || {};
  const peer = ensureVoicePeer(payload.fromId);
  if (!peer) {
    return;
  }

  try {
    if (signal.description) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.description));
      await flushVoiceIceCandidates(peer);
      if (signal.description.type === "offer") {
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(telephoneVoiceDescription(answer));
        sendVoiceSignal(peer.id, { description: peer.pc.localDescription });
      }
    }

    if (signal.candidate) {
      await addVoiceIceCandidate(peer, signal.candidate);
    }
  } catch (error) {
    console.warn("BITSPACE voice signal failed", error);
    closeVoicePeer(peer.id);
  }
}

async function addVoiceIceCandidate(peer, candidate) {
  if (!peer?.pc || !candidate) {
    return;
  }

  if (!peer.pc.remoteDescription) {
    peer.pendingCandidates.push(candidate);
    return;
  }

  await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
}

async function flushVoiceIceCandidates(peer) {
  if (!peer?.pc || !peer.pc.remoteDescription || peer.pendingCandidates.length <= 0) {
    return;
  }

  const pending = peer.pendingCandidates.splice(0);
  for (const candidate of pending) {
    await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function ensureVoicePeer(peerId, options = {}) {
  if (!peerId || peerId === state.clientId || !voice.joined) {
    return null;
  }

  const existing = voice.peers.get(peerId);
  if (existing) {
    if (options.offer && !existing.offerStarted) {
      createVoiceOffer(existing);
    }
    return existing;
  }

  const pc = new RTCPeerConnection(voiceRtcConfiguration());
  const peer = {
    id: peerId,
    pc,
    offerStarted: false,
    remoteStream: new MediaStream(),
    audioElement: null,
    source: null,
    gain: null,
    analyser: null,
    audioNodes: null,
    audibleSinceMs: null,
    audibleUntilMs: 0,
    voiceCurrentGain: 0,
    voiceRampStartGain: 0,
    voiceRampTargetGain: 0,
    voiceRampStartTime: 0,
    voiceRampEndTime: 0,
    voiceTargetGain: 0,
    pendingCandidates: []
  };
  voice.peers.set(peerId, peer);

  const localTracks = voice.localStream?.getAudioTracks() || [];
  if (localTracks.length > 0) {
    for (const track of localTracks) {
      const sender = pc.addTrack(track, voice.localStream);
      configureVoiceSender(sender);
    }
  } else if (typeof pc.addTransceiver === "function") {
    pc.addTransceiver("audio", { direction: "recvonly" });
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendVoiceSignal(peerId, { candidate: event.candidate });
    }
  };
  pc.ontrack = (event) => {
    attachVoiceRemoteTrack(peer, event);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      closeVoicePeer(peerId);
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
      closeVoicePeer(peerId);
    }
  };

  if (options.offer) {
    createVoiceOffer(peer);
  }

  return peer;
}

async function createVoiceOffer(peer) {
  if (!peer || peer.offerStarted || peer.pc.signalingState !== "stable") {
    return;
  }

  peer.offerStarted = true;
  try {
    const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
    await peer.pc.setLocalDescription(telephoneVoiceDescription(offer));
    sendVoiceSignal(peer.id, { description: peer.pc.localDescription });
  } catch (error) {
    console.warn("BITSPACE voice offer failed", error);
    closeVoicePeer(peer.id);
  }
}

function closeVoicePeer(peerId) {
  const peer = voice.peers.get(peerId);
  if (!peer) {
    return;
  }

  voice.peers.delete(peerId);
  try {
    peer.audioElement?.pause();
    peer.audioElement && (peer.audioElement.srcObject = null);
    peer.source?.disconnect();
    peer.audioNodes?.highpass?.disconnect();
    peer.audioNodes?.lowpass?.disconnect();
    peer.audioNodes?.compressor?.disconnect();
    peer.analyser?.disconnect();
    peer.gain?.disconnect();
    peer.pc.close();
  } catch {
    // Peer shutdown is best effort; browsers throw if a node is already closed.
  }
}

function sendVoiceSignal(targetId, signal) {
  if (!socket.connected || !voice.joined || !voice.roomId || !targetId || !signal) {
    return;
  }

  socket.emit(CLIENT_EVENTS.voiceSignal, {
    targetId,
    signal
  });
}

function voiceActiveForRoom(roomId) {
  return Boolean(voice.joined && voice.roomId && roomId === voice.roomId);
}

function voiceRtcConfiguration() {
  const override = Array.isArray(window.BITSPACE_ICE_SERVERS)
    ? window.BITSPACE_ICE_SERVERS
    : null;
  return {
    ...VOICE_RTC_CONFIGURATION,
    iceServers: override || VOICE_RTC_CONFIGURATION.iceServers
  };
}

function configureVoiceSender(sender) {
  if (!sender?.getParameters || !sender.setParameters) {
    return;
  }

  try {
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = 16000;
    sender.setParameters(parameters).catch(() => {});
  } catch {
    // Some browsers expose setParameters but reject bitrate constraints for audio.
  }
}

function telephoneVoiceDescription(description) {
  if (!description?.sdp) {
    return description;
  }

  return {
    type: description.type,
    sdp: description.sdp.replace(
      /a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g,
      (_match, payloadType, params) => `a=fmtp:${payloadType} ${params};stereo=0;sprop-stereo=0;maxaveragebitrate=16000`
    )
  };
}

function attachVoiceRemoteTrack(peer, event) {
  const stream = event.streams?.[0] || null;
  const track = event.track;
  if (stream) {
    peer.remoteStream = stream;
  } else if (track && !peer.remoteStream.getTracks().includes(track)) {
    peer.remoteStream.addTrack(track);
  }

  setupVoiceAudioGraph(peer);
}

function ensureVoiceAudioElement(peer) {
  if (!peer?.remoteStream || peer.audioElement) {
    return;
  }

  const element = new Audio();
  element.autoplay = true;
  element.playsInline = true;
  element.muted = true;
  element.srcObject = peer.remoteStream;
  peer.audioElement = element;
  element.play?.().catch(() => {});
}

function setupVoiceAudioGraph(peer) {
  if (!peer?.remoteStream || peer.source || peer.remoteStream.getAudioTracks().length <= 0) {
    return;
  }

  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  ensureVoiceAudioElement(peer);
  const source = context.createMediaStreamSource(peer.remoteStream);
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  const gain = context.createGain();
  highpass.type = "highpass";
  highpass.frequency.value = 300;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 3400;
  compressor.threshold.value = -28;
  compressor.knee.value = 18;
  compressor.ratio.value = 7;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.18;
  analyser.fftSize = 256;
  gain.gain.value = 0;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(gain);
  gain.connect(context.destination);

  peer.source = source;
  peer.gain = gain;
  peer.analyser = analyser;
  peer.audioNodes = {
    highpass,
    lowpass,
    compressor
  };
  resumeVoiceAudioContext();
}

function resumeVoiceAudioContext() {
  const context = audio.context;
  if (context?.state === "suspended" && voice.userGesture) {
    context.resume().catch(() => {});
  }
}

function updateVoiceVisibility(snapshot, cameraPlayerId, timeSeconds) {
  syncVoiceRoomState();
  updateLocalVoiceTrackState();
  setupLocalVoiceMeter();
  if (!voice.joined || voice.peers.size <= 0) {
    return;
  }

  const observer = voiceObserverPlayer(snapshot, cameraPlayerId);
  const nowMs = timeSeconds * 1000;
  for (const peer of voice.peers.values()) {
    const target = snapshot?.players?.find((candidate) => candidate.id === peer.id) || null;
    if (!voicePeerAudible(observer, target, peer.id)) {
      peer.audibleSinceMs = null;
      peer.audibleUntilMs = 0;
      if (Math.abs((peer.voiceTargetGain || 0) - 0) > 0.001) {
        setVoicePeerGain(peer, 0, { fadeSeconds: VOICE_GAIN_FADE_OUT_SECONDS });
        peer.voiceTargetGain = 0;
      }
      continue;
    }

    if (peer.audibleSinceMs == null) {
      peer.audibleSinceMs = nowMs;
    }
    peer.audibleUntilMs = nowMs;
    const targetGain = voiceRemoteGain();
    if (Math.abs((peer.voiceTargetGain || 0) - targetGain) > 0.001) {
      setVoicePeerGain(peer, targetGain, { fadeSeconds: VOICE_GAIN_FADE_IN_SECONDS });
      peer.voiceTargetGain = targetGain;
    }
  }
}

function voiceObserverPlayer(snapshot, cameraPlayerId) {
  if (!snapshot) {
    return null;
  }

  if (cameraPlayerId === state.playerId) {
    return predictedLocalPlayer() || localPlayerFromSnapshot();
  }

  return snapshot.players?.find((candidate) => candidate.id === cameraPlayerId) || null;
}

function voicePeerAudible(observer, target, peerId = "") {
  if (state.room?.state === "ended") {
    return Boolean(peerId && peerId !== state.clientId);
  }

  const localPlayer = localPlayerFromSnapshot();
  if (
    state.room?.state === "active" &&
    localPlayer?.alive === false
  ) {
    return Boolean(target && target.alive === false && target.id !== localPlayer.id);
  }

  if (!observer || !target || target.alive === false || observer.id === target.id) {
    return false;
  }

  return voicePlayersVisible(observer, target);
}

function voicePlayersVisible(observer, target) {
  const dx = target.x - observer.x;
  const dy = target.y - observer.y;
  const distance = Math.hypot(dx, dy);
  const visibleRadius = playerMapVisibleRadiusPixels();
  if (distance > visibleRadius + (target.radius || ENGINE.ship.radius)) {
    return false;
  }

  if (!state.asteroid || distance <= 1) {
    return true;
  }

  const targetRadius = Math.max(1, target.radius || ENGINE.ship.radius);
  const nx = dx / Math.max(1, distance);
  const ny = dy / Math.max(1, distance);
  const px = -ny;
  const py = nx;
  const targetPoints = [
    { x: target.x, y: target.y },
    { x: target.x + px * targetRadius, y: target.y + py * targetRadius },
    { x: target.x - px * targetRadius, y: target.y - py * targetRadius },
    { x: target.x - nx * targetRadius, y: target.y - ny * targetRadius },
    { x: target.x + nx * targetRadius * 0.45, y: target.y + ny * targetRadius * 0.45 }
  ];

  for (let index = 0; index < Math.min(targetPoints.length, VOICE_MAX_TARGET_CHECKS); index += 1) {
    if (voiceLineOfSightClear(observer.x, observer.y, targetPoints[index].x, targetPoints[index].y)) {
      return true;
    }
  }

  return false;
}

function voiceLineOfSightClear(startX, startY, endX, endY) {
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  if (!state.asteroid || distance <= 1) {
    return true;
  }

  const hit = raycastAsteroid(
    state.asteroid,
    startX,
    startY,
    Math.atan2(dy, dx),
    distance,
    { blockNonPlayable: false }
  );
  return !hit?.hit || hit.distance >= distance - 1;
}

function setVoicePeerGain(peer, targetGain, options = {}) {
  if (!peer?.gain) {
    return;
  }

  const context = audio.context;
  if (!context) {
    return;
  }

  const gain = peer.gain.gain;
  const now = context.currentTime;
  const currentGain = voicePeerCurrentGain(peer, now);
  const maxGain = Math.max(0.0001, voiceRemoteGain());
  const nextGain = Math.max(0, Math.min(maxGain, Number(targetGain) || 0));

  gain.cancelScheduledValues(now);
  if (options.immediate) {
    gain.setValueAtTime(nextGain, now);
    peer.voiceCurrentGain = nextGain;
    peer.voiceRampStartGain = nextGain;
    peer.voiceRampTargetGain = nextGain;
    peer.voiceRampStartTime = now;
    peer.voiceRampEndTime = now;
    peer.voiceTargetGain = nextGain;
    return;
  }

  const baseFadeSeconds = Math.max(0.001, Number(options.fadeSeconds) || VOICE_GAIN_FADE_OUT_SECONDS);
  const gainDelta = Math.abs(nextGain - currentGain);
  const fadeSeconds = Math.max(0.001, baseFadeSeconds * clamp(gainDelta / maxGain, 0, 1));
  gain.setValueAtTime(currentGain, now);
  gain.linearRampToValueAtTime(nextGain, now + fadeSeconds);
  peer.voiceCurrentGain = currentGain;
  peer.voiceRampStartGain = currentGain;
  peer.voiceRampTargetGain = nextGain;
  peer.voiceRampStartTime = now;
  peer.voiceRampEndTime = now + fadeSeconds;
  peer.voiceTargetGain = nextGain;
}

function voicePeerCurrentGain(peer, now) {
  const startGain = Number(peer?.voiceRampStartGain ?? peer?.voiceCurrentGain ?? 0);
  const targetGain = Number(peer?.voiceRampTargetGain ?? peer?.voiceTargetGain ?? 0);
  const startTime = Number(peer?.voiceRampStartTime ?? 0);
  const endTime = Number(peer?.voiceRampEndTime ?? 0);
  if (endTime > startTime && now > startTime && now < endTime) {
    const progress = clamp((now - startTime) / (endTime - startTime), 0, 1);
    return startGain + (targetGain - startGain) * progress;
  }
  if (endTime > 0 && now >= endTime) {
    return targetGain;
  }
  return Number(peer?.voiceCurrentGain ?? 0);
}

function voiceHudActive() {
  if (!voiceRoomJoinAllowed() || !voice.joined) {
    return false;
  }

  if (voiceMicOutputActive()) {
    return true;
  }

  return voiceRemoteOutputActive();
}

function voiceMicOutputActive() {
  const tracks = voice.localStream?.getAudioTracks?.() || [];
  return tracks.some((track) => (
    track.readyState === "live" &&
    track.enabled === true &&
    track.muted !== true
  ));
}

function voiceRemoteOutputActive() {
  if (!voiceRoomJoinAllowed() || !voice.joined || voice.peers.size <= 0) {
    return false;
  }

  const context = audio.context;
  if (!context || context.state !== "running") {
    return false;
  }

  const now = context.currentTime;
  for (const peer of voice.peers.values()) {
    const connectionState = peer.pc?.connectionState;
    const iceState = peer.pc?.iceConnectionState;
    const connected = connectionState === "connected" ||
      connectionState === "completed" ||
      iceState === "connected" ||
      iceState === "completed";
    if (!connected || !peer.gain || peer.remoteStream?.getAudioTracks().length <= 0) {
      continue;
    }

    const currentGain = voicePeerCurrentGain(peer, now);
    const targetGain = Number(peer.voiceTargetGain || peer.voiceRampTargetGain || 0);
    if (Math.max(currentGain, targetGain) > 0.001) {
      return true;
    }
  }

  return false;
}

function voiceDebugSnapshot() {
  return {
    userGesture: voice.userGesture,
    joined: voice.joined,
    starting: voice.starting,
    failed: voice.failed,
    micAttempted: voice.micAttempted,
    micStarting: voice.micStarting,
    micError: voice.micError,
    retryInMs: voice.retryAtMs ? Math.max(0, Math.round(voice.retryAtMs - performance.now())) : 0,
    roomId: voice.roomId,
    roomState: state.room?.state || "-",
    joinAllowed: voiceRoomJoinAllowed(),
    transmitAllowed: voiceRoomTransmitAllowed(),
    micCapture: voiceMicCaptureAllowed(),
    secureContext: window.isSecureContext === true,
    hasMediaDevices: Boolean(navigator.mediaDevices),
    hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    socketConnected: socket.connected,
    audioContextState: audio.context?.state || "-",
    expectedPeerIds: expectedVoicePeerIds(),
    localLevel: voiceAnalyserLevel(voice.localAnalyser),
    localTracks: voice.localStream
      ? voice.localStream.getAudioTracks().map((track) => ({
          id: track.id,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        }))
      : [],
    peers: Array.from(voice.peers.values()).map((peer) => ({
      id: peer.id,
      connection: peer.pc.connectionState,
      ice: peer.pc.iceConnectionState,
      signaling: peer.pc.signalingState,
      offerStarted: peer.offerStarted,
      pendingCandidates: peer.pendingCandidates.length,
      remoteTracks: peer.remoteStream?.getAudioTracks().length || 0,
      gainNode: Boolean(peer.gain),
      gain: peer.gain ? Number(peer.gain.gain.value.toFixed(3)) : null,
      level: voiceAnalyserLevel(peer.analyser),
      audibleMs: Math.max(0, Math.round(peer.audibleUntilMs - performance.now()))
    }))
  };
}

async function voiceStatsSnapshot() {
  const peers = [];
  for (const peer of voice.peers.values()) {
    const stats = await peer.pc.getStats();
    const inboundAudio = [];
    const outboundAudio = [];
    const remoteInboundAudio = [];
    stats.forEach((entry) => {
      if (entry.type === "inbound-rtp" && entry.kind === "audio") {
        inboundAudio.push({
          id: entry.id,
          bytesReceived: entry.bytesReceived,
          packetsReceived: entry.packetsReceived,
          packetsLost: entry.packetsLost,
          audioLevel: numberOrNull(entry.audioLevel),
          totalAudioEnergy: numberOrNull(entry.totalAudioEnergy),
          totalSamplesDuration: numberOrNull(entry.totalSamplesDuration)
        });
      }
      if (entry.type === "outbound-rtp" && entry.kind === "audio") {
        outboundAudio.push({
          id: entry.id,
          bytesSent: entry.bytesSent,
          packetsSent: entry.packetsSent,
          totalAudioEnergy: numberOrNull(entry.totalAudioEnergy),
          totalSamplesDuration: numberOrNull(entry.totalSamplesDuration)
        });
      }
      if (entry.type === "remote-inbound-rtp" && entry.kind === "audio") {
        remoteInboundAudio.push({
          id: entry.id,
          packetsReceived: entry.packetsReceived,
          packetsLost: entry.packetsLost,
          roundTripTime: numberOrNull(entry.roundTripTime)
        });
      }
    });
    peers.push({
      id: peer.id,
      connection: peer.pc.connectionState,
      ice: peer.pc.iceConnectionState,
      signaling: peer.pc.signalingState,
      remoteTracks: peer.remoteStream?.getAudioTracks().map((track) => ({
        id: track.id,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      })) || [],
      level: voiceAnalyserLevel(peer.analyser),
      inboundAudio,
      outboundAudio,
      remoteInboundAudio
    });
  }

  return {
    localLevel: voiceAnalyserLevel(voice.localAnalyser),
    localTracks: voice.localStream?.getAudioTracks().map((track) => ({
      id: track.id,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState
    })) || [],
    peers
  };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function voiceAnalyserLevel(analyser) {
  if (!analyser) {
    return null;
  }

  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let sumSq = 0;
  let peak = 0;
  for (const sample of samples) {
    const centered = sample - (Math.abs(sample) > 2 ? 128 : 0);
    sumSq += centered * centered;
    peak = Math.max(peak, Math.abs(centered));
  }
  const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
  return {
    rms: Number(rms.toFixed(5)),
    peak: Number(peak.toFixed(5))
  };
}

function unlockAudio() {
  markVoiceUserGesture();
  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  if (context.state === "suspended") {
    context.resume()
      .then(flushPendingAudio)
      .catch(() => {});
  } else {
    flushPendingAudio();
  }
  audio.unlocked = true;
  updateMusicPlayback({ force: true });
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
      .then(flushPendingAudio)
      .catch(() => {});
    return;
  }

  playMechanicalBeep(context);
}

function requestVolumePreview(id, options = {}) {
  if (!isVolumeSetting(id)) {
    return false;
  }

  const nowSeconds = performance.now() / 1000;
  if (!options.force && nowSeconds - audio.lastVolumePreviewAtSeconds < VOLUME_PREVIEW_MIN_INTERVAL_SECONDS) {
    return false;
  }
  audio.lastVolumePreviewAtSeconds = nowSeconds;

  const context = audio.context || createAudioContext();
  if (!context) {
    return false;
  }

  audio.context = context;
  if (context.state === "suspended") {
    context.resume()
      .then(() => playVolumePreviewTone(context, id))
      .catch(() => {});
    return true;
  }

  playVolumePreviewTone(context, id);
  return true;
}

function flushPendingAudio() {
  flushPendingBeeps();
  flushPendingMelodies();
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

function requestEndFanfare(matchKey) {
  const key = String(matchKey || "");
  if (!key || audio.endSoundKey === key) {
    return false;
  }

  audio.endSoundKey = key;
  requestMelody("fanfare");
  return true;
}

function requestDefeatMotif(matchKey, timeSeconds = performance.now() / 1000) {
  const key = String(matchKey || "");
  if (!key || audio.defeatSoundKey === key) {
    return false;
  }

  audio.defeatSoundKey = key;
  audio.lastDefeatAtSeconds = timeSeconds;
  audio.pendingMelodies = audio.pendingMelodies.filter((kind) => kind !== "fanfare");
  requestMelody("defeat");
  return true;
}

function requestMelody(kind) {
  const context = audio.context || createAudioContext();
  if (!context) {
    return;
  }

  audio.context = context;
  if (context.state === "suspended") {
    queuePendingMelody(kind);
    context.resume()
      .then(flushPendingAudio)
      .catch(() => {});
    return;
  }

  playMelody(context, kind);
}

function queuePendingMelody(kind) {
  if (kind === "defeat") {
    audio.pendingMelodies = audio.pendingMelodies.filter((pending) => pending !== "fanfare");
  }
  audio.pendingMelodies = audio.pendingMelodies
    .filter((pending) => pending !== kind)
    .slice(-2);
  audio.pendingMelodies.push(kind);
}

function flushPendingMelodies() {
  const context = audio.context;
  if (!context || context.state !== "running" || audio.pendingMelodies.length <= 0) {
    return;
  }

  const melodies = audio.pendingMelodies.slice();
  audio.pendingMelodies = [];
  melodies.forEach((kind, index) => {
    playMelody(context, kind, index * 0.32);
  });
}

function playMelody(context, kind, delay = 0) {
  if (kind === "defeat") {
    playDefeatMotif(context, delay);
    return;
  }
  playEndFanfare(context, delay);
}

function playEndFanfare(context, delay = 0) {
  const start = context.currentTime + 0.018 + delay;
  playTrumpetTone(context, 523.25, start, 0.16, 0.032);
  playTrumpetTone(context, 659.25, start + 0.18, 0.16, 0.033);
  playTrumpetTone(context, 783.99, start + 0.36, 0.26, 0.036);
}

function playDefeatMotif(context, delay = 0) {
  const start = context.currentTime + 0.018 + delay;
  playDefeatTone(context, 329.63, start, 0.22, 0.028);
  playDefeatTone(context, 246.94, start + 0.28, 0.34, 0.031);
}

function playTrumpetTone(context, frequency, start, duration, volume) {
  const oscillator = context.createOscillator();
  const overtone = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  oscillator.type = "sawtooth";
  overtone.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  overtone.frequency.setValueAtTime(frequency * 2.01, start);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(frequency * 2.4, start);
  filter.Q.value = 3.5;
  gain.gain.setValueAtTime(0.0001, start);
  const scaledVolume = effectGain(volume);
  gain.gain.exponentialRampToValueAtTime(scaledVolume, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(scaledVolume * 0.62, start + duration * 0.62);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(filter);
  overtone.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  overtone.start(start);
  oscillator.stop(start + duration + 0.03);
  overtone.stop(start + duration + 0.03);
}

function playDefeatTone(context, frequency, start, duration, volume) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.82), start + duration);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(620, start);
  filter.frequency.exponentialRampToValueAtTime(260, start + duration);
  filter.Q.value = 0.6;
  gain.gain.setValueAtTime(0.0001, start);
  const scaledVolume = effectGain(volume);
  gain.gain.exponentialRampToValueAtTime(scaledVolume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(scaledVolume * 0.45, start + duration * 0.62);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playMechanicalBeep(context, delay = 0) {
  const start = context.currentTime + 0.01;
  playMechanicalTone(context, 760, start + delay, 0.075, 0.0325);
  playMechanicalTone(context, 520, start + delay + 0.092, 0.07, 0.0275);
}

function playVolumePreviewTone(context, id) {
  const start = context.currentTime + 0.006;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const scale = volumePreviewScale(id);
  const frequency = id === "voiceVolume"
    ? 640
    : id === "musicVolume" ? 560
      : id === "masterVolume" ? 720 : 820;

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.18, start + 0.09);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.06 * scale), start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + 0.14);
}

function playMechanicalTone(context, frequency, start, duration, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(effectGain(volume), start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function masterVolumeScale() {
  return clamp(Number(state.settings?.masterVolume ?? DEFAULT_SETTINGS.masterVolume), 0, 1);
}

function effectsVolumeScale() {
  return masterVolumeScale() *
    clamp(Number(state.settings?.effectsVolume ?? DEFAULT_SETTINGS.effectsVolume), 0, 1);
}

function effectiveVoiceSettingVolume(settings = state.settings) {
  return clamp(Number(settings?.masterVolume ?? DEFAULT_SETTINGS.masterVolume), 0, 1) *
    clamp(Number(settings?.voiceVolume ?? DEFAULT_SETTINGS.voiceVolume), 0, 1);
}

function voiceVolumeScale() {
  if (state.settings?.voiceChat === false) {
    return 0;
  }

  return effectiveVoiceSettingVolume(state.settings);
}

function volumePreviewScale(id) {
  if (id === "masterVolume") {
    return masterVolumeScale();
  }
  if (id === "voiceVolume") {
    return effectiveVoiceSettingVolume(state.settings);
  }
  if (id === "musicVolume") {
    return musicVolumeScale();
  }
  return effectsVolumeScale();
}

function effectGain(value) {
  return Math.max(0.0001, Number(value || 0) * effectsVolumeScale());
}

function voiceRemoteGain() {
  return VOICE_REMOTE_GAIN * voiceVolumeScale();
}

function musicVolumeScale(settings = state.settings) {
  const master = clamp(Number(settings?.masterVolume ?? DEFAULT_SETTINGS.masterVolume), 0, 1);
  const music = clamp(Number(settings?.musicVolume ?? DEFAULT_SETTINGS.musicVolume), 0, 1);
  return master * music / MUSIC_TRACK_FULL_VOLUME_SETTING;
}

function handleDocumentVisibilityChange() {
  if (document.hidden) {
    pauseMusicTracks();
    return;
  }

  if (audio.unlocked) {
    updateMusicPlayback({ force: true });
  }
}

function desiredMusicTrackKey(snapshot = null, cameraPlayerId = state.playerId, nowMs = performance.now()) {
  if (state.room?.state === "active") {
    if (nowMs <= audio.music.forceArenaUntilMs) {
      audio.music.visibleOtherUntilMs = 0;
      return "arena";
    }
    if (musicHasVisibleOtherPlayer(snapshot, cameraPlayerId)) {
      audio.music.visibleOtherUntilMs = nowMs + MUSIC_VISIBLE_OTHER_HOLD_MS;
    }
    return nowMs <= audio.music.visibleOtherUntilMs ? "lobby" : "arena";
  }

  if (state.room?.state === "waiting") {
    audio.music.forceArenaUntilMs = 0;
    if (musicHasVisibleOtherPlayer(snapshot, cameraPlayerId)) {
      audio.music.visibleOtherUntilMs = nowMs + MUSIC_VISIBLE_OTHER_HOLD_MS;
    }
    return nowMs <= audio.music.visibleOtherUntilMs ? "lobby" : "arena";
  }
  audio.music.visibleOtherUntilMs = 0;
  audio.music.forceArenaUntilMs = 0;
  return "menu";
}

function beginMusicRoomStartTransition(nowMs = performance.now()) {
  audio.music.visibleOtherUntilMs = 0;
  audio.music.forceArenaUntilMs = nowMs + MUSIC_ROOM_START_FORCE_ARENA_MS;
  audio.music.fastSwitchUntilMs = nowMs + MUSIC_ROOM_START_FORCE_ARENA_MS;
}

function musicHasVisibleOtherPlayer(snapshot, cameraPlayerId) {
  const observer = voiceObserverPlayer(snapshot, cameraPlayerId);
  if (!observer || !Array.isArray(snapshot?.players)) {
    return false;
  }

  return snapshot.players.some((target) => (
    target &&
    target.id !== observer.id &&
    target.alive !== false &&
    voicePlayersVisible(observer, target)
  ));
}

function ensureMusicAudio() {
  if (audio.music.tracks && audio.music.gain) {
    return audio.music;
  }

  if (typeof Audio === "undefined") {
    return null;
  }

  const context = audio.context || createAudioContext();
  if (!context) {
    return null;
  }

  audio.context = context;
  const gain = context.createGain();
  gain.gain.value = musicVolumeScale();
  gain.connect(context.destination);
  const tracks = new Map();

  for (const [key, src] of Object.entries(MUSIC_TRACKS)) {
    const element = new Audio(src);
    element.loop = true;
    element.preload = "auto";
    element.volume = 1;
    element.playsInline = true;
    const source = context.createMediaElementSource(element);
    const trackGain = context.createGain();
    trackGain.gain.value = 0;
    source.connect(trackGain);
    trackGain.connect(gain);
    element.load();
    tracks.set(key, { element, source, gain: trackGain });
  }

  audio.music.tracks = tracks;
  audio.music.gain = gain;
  return audio.music;
}

function updateMusicPlayback(options = {}) {
  if (document.hidden) {
    pauseMusicTracks();
    return false;
  }

  if (!audio.unlocked && !options.force) {
    return false;
  }

  const music = ensureMusicAudio();
  const context = audio.context;
  if (!music || !context || !music.tracks) {
    return false;
  }

  const gain = musicVolumeScale();
  if (music.gain) {
    const now = context.currentTime || 0;
    if (typeof music.gain.gain.setTargetAtTime === "function") {
      music.gain.gain.setTargetAtTime(gain, now, 0.03);
    } else {
      music.gain.gain.value = gain;
    }
  }

  const nowMs = performance.now();
  const desiredKey = desiredMusicTrackKey(options.snapshot, options.cameraPlayerId, nowMs);
  if (!music.tracks.has(desiredKey)) {
    return false;
  }

  if (!audio.unlocked || context.state !== "running" || gain <= 0.0001) {
    setMusicTrackGains("", 0.05);
    music.currentKey = desiredKey;
    return false;
  }

  const previousKey = music.currentKey;
  if (music.currentKey !== desiredKey) {
    music.currentKey = desiredKey;
  }

  const switchFadeSeconds = desiredKey === "arena" && nowMs <= music.fastSwitchUntilMs
    ? MUSIC_ROOM_START_CROSSFADE_SECONDS
    : MUSIC_CROSSFADE_SECONDS;
  setMusicTrackGains(desiredKey, previousKey && previousKey !== desiredKey ? switchFadeSeconds : 0.04);
  startMusicTracks(options.force === true, nowMs);
  return musicTrackIsPlaying(desiredKey);
}

function startMusicTracks(force = false, nowMs = performance.now()) {
  const tracks = audio.music.tracks;
  if (!tracks) {
    return false;
  }

  const pausedTracks = Array.from(tracks.values()).filter((track) => track.element.paused);
  if (pausedTracks.length <= 0) {
    return true;
  }

  if (
    !force &&
    nowMs - audio.music.lastPlayAttemptAtMs <= 500
  ) {
    return false;
  }

  audio.music.lastPlayAttemptAtMs = nowMs;
  for (const track of pausedTracks) {
    track.element.play().catch(() => {});
  }
  return true;
}

function pauseMusicTracks() {
  const tracks = audio.music.tracks;
  if (!tracks) {
    return;
  }

  for (const track of tracks.values()) {
    track.element.pause();
  }
}

function setMusicTrackGains(activeKey, fadeSeconds = MUSIC_CROSSFADE_SECONDS) {
  const tracks = audio.music.tracks;
  const context = audio.context;
  if (!tracks || !context) {
    return;
  }

  for (const [key, track] of tracks.entries()) {
    const gain = track.gain?.gain;
    if (!gain) {
      continue;
    }
    const target = key === activeKey ? 1 : 0;
    const now = context.currentTime || 0;
    if (typeof gain.cancelScheduledValues === "function") {
      gain.cancelScheduledValues(now);
    }
    if (typeof gain.setTargetAtTime === "function") {
      gain.setTargetAtTime(target, now, Math.max(0.01, fadeSeconds * 0.25));
    } else {
      gain.value = target;
    }
  }
}

function musicTrackIsPlaying(key) {
  const track = audio.music.tracks?.get(key);
  return Boolean(track && !track.element.paused);
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
  bodyGain.gain.exponentialRampToValueAtTime(effectGain(0.105), start + 0.008);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

  strike.buffer = audio.huckRockBuffer || createNoiseBuffer(context, 0.08);
  audio.huckRockBuffer = strike.buffer;
  strikeFilter.type = "lowpass";
  strikeFilter.frequency.setValueAtTime(420, start);
  strikeFilter.frequency.exponentialRampToValueAtTime(95, start + 0.07);
  strikeFilter.Q.value = 0.6;
  strikeGain.gain.setValueAtTime(0.0001, start);
  strikeGain.gain.exponentialRampToValueAtTime(effectGain(0.07), start + 0.004);
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
  const inputLevel = alive ? playerThrustInputLevel(player) : 0;
  const miningActive = state.room?.state !== "ended" && alive && playerMiningAudioActive(player);

  updateEngineAudio(context, inputLevel, timeSeconds);
  updateMiningAudio(context, miningActive, timeSeconds);
  updateFocusedHuckRockAudio(player, timeSeconds);
  flushPendingDamageClunk(timeSeconds);
}

function playerThrustInputLevel(player) {
  const moveX = Number.isFinite(player?.moveX)
    ? player.moveX
    : Number.isFinite(player?.input?.moveX) ? player.input.moveX : 0;
  const moveY = Number.isFinite(player?.moveY)
    ? player.moveY
    : Number.isFinite(player?.input?.moveY) ? player.input.moveY : 0;
  const inputLevel = clamp(Math.hypot(moveX, moveY), 0, 1);
  if (inputLevel > 0) {
    return inputLevel;
  }

  return player?.thrusting ? 1 : 0;
}

function playerMiningAudioActive(player) {
  if (!player) {
    return false;
  }

  if (player.mining === true) {
    return true;
  }

  if (player.miningRay) {
    return true;
  }

  return Number(player.rayExtension || 0) > 0.01;
}

function updateFocusedHuckRockAudio(player, timeSeconds) {
  const playerId = player?.id || "";
  const cooldownSeconds = Math.max(0, Number(player?.huckRockCooldownSeconds || 0));
  if (isReadyMenu() || playerId === state.playerId) {
    audio.huckRockAudioPlayerId = playerId;
    audio.lastHuckRockCooldownSeconds = cooldownSeconds;
    return;
  }

  if (!playerId || playerId !== audio.huckRockAudioPlayerId) {
    audio.huckRockAudioPlayerId = playerId;
    audio.lastHuckRockCooldownSeconds = cooldownSeconds;
    return;
  }

  if (
    playerId !== state.playerId &&
    player?.alive !== false &&
    cooldownSeconds > audio.lastHuckRockCooldownSeconds + 0.08
  ) {
    requestHuckRockThunk();
  }

  audio.lastHuckRockCooldownSeconds = cooldownSeconds;
}

function updateLocalDamageAudio(snapshot, timeSeconds) {
  const focusPlayerId = audioFocusPlayerIdForSnapshot(snapshot);
  const player = snapshot.players.find((candidate) => candidate.id === focusPlayerId);
  if (!player) {
    audio.lastDamagePlayerId = "";
    return;
  }

  if (audio.lastDamagePlayerId !== player.id) {
    audio.lastDamagePlayerId = player.id;
    audio.lastHealth = player.health;
    audio.lastShake = player.shake || 0;
    audio.pendingDamage = 0;
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
  audio.lastDamagePlayerId = "";
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

function updateEngineAudio(context, inputLevel, timeSeconds) {
  const shipAudio = audio.ship;
  const now = context.currentTime;
  const targetGain = inputLevel > 0
    ? effectGain(ENGINE_AUDIO_MAX_GAIN * (0.45 + inputLevel * 0.55))
    : 0.0001;
  const filterFrequency = 85 + inputLevel * 205 + Math.sin(timeSeconds * 18) * 7 * inputLevel;
  const oscillatorFrequency = 40 + inputLevel * 25 + Math.sin(timeSeconds * 9) * 2 * inputLevel;

  setAudioTarget(shipAudio.engineGain.gain, targetGain, now, 0.045);
  setAudioTarget(shipAudio.engineFilter.frequency, filterFrequency, now, 0.055);
  setAudioTarget(shipAudio.engineOscillator.frequency, oscillatorFrequency, now, 0.06);
  setAudioTarget(shipAudio.engineOscillatorGain.gain, inputLevel > 0 ? 0.006 : 0.0001, now, 0.05);
}

function updateMiningAudio(context, active, timeSeconds) {
  const shipAudio = audio.ship;
  const now = context.currentTime;
  const targetGain = active ? effectGain(MINING_AUDIO_MAX_GAIN) : 0.0001;
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

function requestRockThump(speed, timeSeconds = performance.now() / 1000) {
  if (speed < AUDIO_ROCK_THUMP_SPEED) {
    return false;
  }

  const context = audio.context;
  if (!audio.unlocked || !context || context.state !== "running") {
    return false;
  }

  if (timeSeconds - audio.lastRockThumpAtSeconds < AUDIO_ROCK_THUMP_COOLDOWN_SECONDS) {
    return false;
  }

  audio.lastRockThumpAtSeconds = timeSeconds;
  playRockThump(context, clamp(0.35 + (speed - AUDIO_ROCK_THUMP_SPEED) / 70, 0.25, 1.1));
  return true;
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
  noiseGain.gain.exponentialRampToValueAtTime(effectGain(0.034 * intensity), start + 0.006);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(155 + intensity * 18, start);
  oscillator.frequency.exponentialRampToValueAtTime(72, start + 0.13);
  oscillatorGain.gain.setValueAtTime(0.0001, start);
  oscillatorGain.gain.exponentialRampToValueAtTime(effectGain(0.025 * intensity), start + 0.006);
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

function playRockThump(context, intensity) {
  const start = context.currentTime + 0.004;
  const body = context.createOscillator();
  const bodyGain = context.createGain();
  const brush = context.createBufferSource();
  const brushFilter = context.createBiquadFilter();
  const brushGain = context.createGain();

  body.type = "sine";
  body.frequency.setValueAtTime(74 + intensity * 8, start);
  body.frequency.exponentialRampToValueAtTime(42, start + 0.2);
  bodyGain.gain.setValueAtTime(0.0001, start);
  bodyGain.gain.exponentialRampToValueAtTime(effectGain(0.105 * intensity), start + 0.018);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);

  brush.buffer = audio.rockThumpBuffer || createNoiseBuffer(context, 0.1);
  audio.rockThumpBuffer = brush.buffer;
  brushFilter.type = "lowpass";
  brushFilter.frequency.setValueAtTime(180, start);
  brushFilter.frequency.exponentialRampToValueAtTime(65, start + 0.12);
  brushFilter.Q.value = 0.35;
  brushGain.gain.setValueAtTime(0.0001, start);
  brushGain.gain.exponentialRampToValueAtTime(effectGain(0.042 * intensity), start + 0.012);
  brushGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

  body.connect(bodyGain);
  bodyGain.connect(context.destination);
  brush.connect(brushFilter);
  brushFilter.connect(brushGain);
  brushGain.connect(context.destination);
  body.start(start);
  body.stop(start + 0.28);
  brush.start(start);
  brush.stop(start + 0.18);
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
  if (huckRock && mobileHuckRockQueued()) {
    clearMobileHuckRockQueue();
  }

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
  const huckRockActive = huckRockPhysicalInputActive();
  if (!huckRockActive) {
    state.huckRockNeedRockFlashArmed = true;
    return false;
  }

  const now = performance.now() / 1000;
  if (!huckRockInputAllowed()) {
    if (
      huckRockBlockedForRockCost() &&
      state.huckRockNeedRockFlashArmed &&
      now >= state.nextHuckRockThunkAtSeconds
    ) {
      flashRockHud();
      state.huckRockNeedRockFlashArmed = false;
      state.nextHuckRockThunkAtSeconds = now + ENGINE.huckRock.fireIntervalSeconds;
    }
    if (huckRockBlockedForRockCost()) {
      clearMobileHuckRockQueue();
    }
    return false;
  }

  state.huckRockNeedRockFlashArmed = false;
  if (now >= state.nextHuckRockThunkAtSeconds) {
    requestHuckRockThunk();
    state.nextHuckRockThunkAtSeconds = now + ENGINE.huckRock.fireIntervalSeconds;
  }

  return true;
}

function huckRockPhysicalInputActive() {
  return keys.has("Space") ||
    (state.controller.connected && state.controller.huckRock) ||
    mobileHuckRockQueued();
}

function huckRockInputAllowed() {
  const roomState = state.room?.state;
  const controllerHuck = state.controller.connected && state.controller.huckRock;
  const mobileHuck = mobileHuckRockQueued();
  if (
    !huckRockPhysicalInputActive() ||
    (!controllerHuck && !mobileHuck && !hasMousePointer()) ||
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
  }

  if (huckRockBlockedForRockCost()) {
    return false;
  }

  return true;
}

function huckRockBlockedForRockCost() {
  if (!huckRockCostsRockInCurrentRoom()) {
    return false;
  }

  const player = localPlayerFromSnapshot();
  return (player?.resources?.rock || 0) < (ENGINE.huckRock.costRock || 0);
}

function huckRockCostsRockInCurrentRoom() {
  return state.room?.state === "waiting" || state.room?.state === "active";
}

function huckRockTargetForPlayer(player) {
  if (!player) {
    return null;
  }

  if (state.controller.connected) {
    return controllerAimTargetForPlayer(player);
  }

  if (mobileControlsActive() && state.mobile.huckRockTarget) {
    return state.mobile.huckRockTarget;
  }

  const aim = activeAimFramePoint();
  return lensScreenPointToWorld(player, aim.x, aim.y, aim);
}

function physicalMiningInputActive() {
  return (state.mouse.down && hasMousePointer()) ||
    controllerMiningActive() ||
    mobileAimJoystickEngaged();
}

function activeRoomMiningInputAllowed() {
  if (
    !physicalMiningInputActive() ||
    state.chat.active ||
    state.upgrades.active ||
    state.build.active ||
    isInputBlocked()
  ) {
    return false;
  }

  if (state.room?.state === "waiting") {
    return true;
  }

  return localPlayerCanUseCombat();
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

function applyShipFriction(player, dtSeconds, frictionPerTick = ENGINE.ship.friction) {
  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const friction = Math.pow(frictionPerTick, dtSeconds / fixedStepSeconds);
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
  if (mobileControlsActive()) {
    return state.mobile.move;
  }

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
    carHeading: Number.isFinite(predicted.carHeading) ? predicted.carHeading : predicted.angle,
    carSteerAngle: Number.isFinite(predicted.carSteerAngle) ? predicted.carSteerAngle : 0,
    carAngularVelocity: Number.isFinite(predicted.carAngularVelocity) ? predicted.carAngularVelocity : 0,
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
    carHeading: Number.isFinite(player.carHeading) ? player.carHeading : player.angle,
    carSteerAngle: Number.isFinite(player.carSteerAngle) ? player.carSteerAngle : 0,
    carAngularVelocity: Number.isFinite(player.carAngularVelocity) ? player.carAngularVelocity : 0,
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
  const gameMode = activeGameMode();
  applyShipFriction(predicted, dtSeconds, gameMode === GAME_MODES.cars ? ENGINE.car.friction : ENGINE.ship.friction);
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  const canThrust = hasMoveIntent;

  if (gameMode === GAME_MODES.cars) {
    simulateCarMovement(predicted, move, effects, dtSeconds);
  } else {
    updateShipFacing(predicted, move, dtSeconds);
    if (canThrust) {
      applyThrusterAcceleration(predicted, move, effects, dtSeconds);
    }
  }

  if (!isInputBlocked()) {
    predicted.aimAngle = inputAimAngleForPlayer(predicted);
  }
  predicted.moveX = move.x;
  predicted.moveY = move.y;
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

function activeGameMode() {
  return state.snapshot?.mode || state.room?.mode || GAME_MODES.bitspace;
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
    carHeading: predicted.carHeading,
    carSteerAngle: predicted.carSteerAngle,
    carAngularVelocity: predicted.carAngularVelocity,
    aimAngle: predicted.aimAngle,
    moveX: predicted.moveX,
    moveY: predicted.moveY,
    mining: predicted.mining,
    miningRay: predicted.mining ? predictedMiningRayForPlayer(predicted, authoritative.miningRay) : null,
    miningHoldSeconds: predicted.miningHoldSeconds,
    rayExtension: predicted.rayExtension,
    huckRockCooldownSeconds: state.prediction.huckRockCooldownSeconds,
    huckRockEngineCutoutSeconds: predicted.huckRockEngineCutoutSeconds,
    thrusting: predicted.thrusting
  };
}

function predictedMiningRayForPlayer(player, authoritativeRay = null) {
  const asteroid = state.asteroid;
  if (!player?.mining || !asteroid) {
    return null;
  }

  const effects = aggregateUpgradeEffects(player.upgrades);
  const rayLength = ENGINE.mining.rayLength + effects.rayLengthBonus;
  const extension = clamp(player.rayExtension ?? miningRayExtension(player.mining, player.miningHoldSeconds || 0), 0, 1);
  const angle = player.aimAngle ?? player.angle ?? 0;
  const lanes = miningRayLanesForPlayer(player, angle, rayLength).map((baseLane) => {
    const lane = clipPredictedMiningRayLaneStart(player, baseLane, angle, asteroid);
    const activeDistance = lane.rayDistance * extension;
    const activeAsteroidHit = raycastAsteroid(asteroid, lane.startX, lane.startY, lane.rayAngle, activeDistance, {
      blockNonPlayable: !asteroid.storm
    });
    const fullAsteroidHit = raycastAsteroid(asteroid, lane.startX, lane.startY, lane.rayAngle, lane.rayDistance, {
      blockNonPlayable: !asteroid.storm
    });
    const start = { x: lane.startX, y: lane.startY };
    const direction = { x: lane.rayDirectionX, y: lane.rayDirectionY };
    const activePlayerHit = predictedMiningRayPlayerHit(
      player,
      start,
      direction,
      Math.min(activeAsteroidHit.distance, activeDistance)
    );
    const fullPlayerHit = predictedMiningRayPlayerHit(
      player,
      start,
      direction,
      Math.min(fullAsteroidHit.distance, lane.rayDistance)
    );
    const activeHit = activePlayerHit || activeAsteroidHit;
    const fullHit = fullPlayerHit || fullAsteroidHit;
    const authoritativeLane = authoritativeMiningLaneFor(lane, authoritativeRay);
    return predictedMiningRayLaneState(lane, activeHit, fullHit, authoritativeLane);
  });

  const primaryLane = lanes.find((lane) => lane.hit) || lanes[0] || null;
  if (!primaryLane) {
    return null;
  }

  return {
    ...primaryLane,
    extension,
    progress: authoritativeRay?.progress ?? primaryLane.progress ?? 0,
    lanes
  };
}

function clipPredictedMiningRayLaneStart(player, lane, angle, asteroid) {
  const probe = miningRaySideStartProbe(player, lane, angle);
  if (!probe || !asteroid) {
    return lane;
  }

  const hit = raycastAsteroid(asteroid, probe.startX, probe.startY, probe.angle, probe.distance, {
    blockNonPlayable: !asteroid.storm
  });
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

function authoritativeMiningLaneFor(lane, authoritativeRay) {
  const lanes = Array.isArray(authoritativeRay?.lanes) && authoritativeRay.lanes.length > 0
    ? authoritativeRay.lanes
    : authoritativeRay
      ? [authoritativeRay]
      : [];
  return lanes.find((candidate) => (
    Number(candidate?.laneIndex) === Number(lane.index) ||
    Number(candidate?.offset) === Number(lane.offset)
  )) || null;
}

function predictedMiningRayLaneState(baseLane, activeHit, fullHit, authoritativeLane = null) {
  const hitType = activeHit.hitType || (activeHit.hit ? "asteroid" : null);
  const hitPlayer = hitType === "player";
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
    endX: activeHit.x,
    endY: activeHit.y,
    fullEndX: fullHit.x,
    fullEndY: fullHit.y,
    hit: activeHit.hit,
    hitType,
    mineable: !hitPlayer && activeHit.mineable,
    tileX: hitPlayer ? null : activeHit.tileX ?? null,
    tileY: hitPlayer ? null : activeHit.tileY ?? null,
    index: hitPlayer ? null : activeHit.index ?? null,
    tile: hitPlayer ? null : activeHit.tile ?? null,
    targetId: activeHit.targetId ?? null,
    targetNumber: activeHit.targetNumber ?? null,
    targetAction: null,
    progress: authoritativeLane?.progress ?? 0
  };
}

function predictedMiningRayPlayerHit(attacker, start, direction, maxDistance) {
  if (!Number.isFinite(maxDistance) || maxDistance <= 0 || !Array.isArray(state.snapshot?.players)) {
    return null;
  }

  let nearest = null;
  for (const target of state.snapshot.players) {
    if (!target?.alive || target.id === attacker.id) {
      continue;
    }

    const hit = rayCircleIntersection(start, direction, target, maxDistance);
    if (!hit || (nearest && hit.distance >= nearest.distance)) {
      continue;
    }

    nearest = {
      hit: true,
      mineable: false,
      hitType: "player",
      x: hit.x,
      y: hit.y,
      distance: hit.distance,
      targetId: target.id,
      targetNumber: target.number ?? null
    };
  }

  return nearest;
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
        requestRockThump(-normalSpeed);
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
      if (player.id === state.playerId) {
        requestDefeatMotif(roomEndAudioKey(state.room), timeSeconds);
      }
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

function handleRoomEndAudio(room, snapshot, timeSeconds = performance.now() / 1000) {
  if (room?.state !== "ended") {
    return;
  }

  const key = roomEndAudioKey(room);
  if (!key || audio.endSoundKey === key) {
    return;
  }

  const defeatJustPlayed = audio.defeatSoundKey === key &&
    timeSeconds - audio.lastDefeatAtSeconds < 1.5;
  if (defeatJustPlayed) {
    audio.endSoundKey = key;
    return;
  }

  const localPlayer = localEndAudioPlayer(snapshot);
  if (localPlayer && localPlayer.alive !== false && room.winnerId && room.winnerId !== localPlayer.id) {
    return;
  }

  requestEndFanfare(key);
}

function localEndAudioPlayer(snapshot) {
  if (!state.playerId) {
    return null;
  }

  return (snapshot?.players || []).find((candidate) => candidate.id === state.playerId) || null;
}

function roomEndAudioKey(room) {
  return state.lastActiveMatchKey ||
    [
      room?.roomId || LOCAL_BOT_ROOM_ID,
      room?.seed || "",
      room?.startedAtMs || "",
      room?.winnerId || ""
    ].join(":");
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

  if (buttonId === "start" && isLocalBotLobby()) {
    requestWaitingRoomStart();
    return;
  }

  if (!socket.connected) {
    return;
  }

  if (buttonId === "ready") {
    socket.emit(CLIENT_EVENTS.ready, {
      button: true,
      mode: GAME_MODES.bitspace
    });
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

  if (event.code === "KeyQ" && isLocalBotLobby()) {
    event.preventDefault();
    adjustLocalBotLobbyCount(-1);
    return true;
  }

  if (event.code === "KeyE" && isLocalBotLobby()) {
    event.preventDefault();
    adjustLocalBotLobbyCount(1);
    return true;
  }

  return false;
}

function handleMenuRoomShortcutKey(event) {
  if (
    state.room?.state !== "menu" ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  ) {
    return false;
  }

  if (state.menu.room === MENU_ROOMS.theme && event.code === "Escape") {
    event.preventDefault();
    leaveThemeMenuRoom();
    return true;
  }

  if (state.menu.room !== MENU_ROOMS.settings) {
    return false;
  }

  if (event.code === "Escape") {
    event.preventDefault();
    leaveSettingsMenuRoom();
    return true;
  }

  if (event.code === "ArrowUp" || event.code === "KeyW") {
    event.preventDefault();
    moveSettingsSelection(-1);
    return true;
  }

  if (event.code === "ArrowDown" || event.code === "KeyS") {
    event.preventDefault();
    moveSettingsSelection(1);
    return true;
  }

  if (event.code === "ArrowLeft" || event.code === "KeyA") {
    event.preventDefault();
    adjustSelectedSetting(-1);
    return true;
  }

  if (event.code === "ArrowRight" || event.code === "KeyD") {
    event.preventDefault();
    adjustSelectedSetting(1);
    return true;
  }

  if (event.code === "Enter" || event.code === "Space") {
    event.preventDefault();
    activateSelectedSetting();
    return true;
  }

  return false;
}

function handleWaitingRoomControllerActions(input) {
  if (state.room?.state !== "waiting") {
    state.controller.waitingBotCountDirection = 0;
    return false;
  }

  if (isLocalBotLobby()) {
    const direction = Math.abs(input.dpad.x) >= CONTROLLER_DPAD_NAV_THRESHOLD
      ? Math.sign(input.dpad.x)
      : 0;
    if (direction === 0) {
      state.controller.waitingBotCountDirection = 0;
    } else if (direction !== state.controller.waitingBotCountDirection) {
      state.controller.waitingBotCountDirection = direction;
      adjustLocalBotLobbyCount(direction);
      unlockAudio();
      return true;
    }
  } else {
    state.controller.waitingBotCountDirection = 0;
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

function handleMenuRoomControllerActions(input) {
  if (state.room?.state !== "menu") {
    return false;
  }

  if (state.menu.room === MENU_ROOMS.theme && input.pressed.reset) {
    leaveThemeMenuRoom();
    return true;
  }

  if (state.menu.room !== MENU_ROOMS.settings) {
    return false;
  }

  const rowDirection = Math.abs(input.dpad.y) >= CONTROLLER_DPAD_NAV_THRESHOLD
    ? Math.sign(input.dpad.y)
    : 0;
  if (rowDirection === 0) {
    state.settingsUi.navDirection = 0;
  } else if (rowDirection !== state.settingsUi.navDirection) {
    state.settingsUi.navDirection = rowDirection;
    moveSettingsSelection(rowDirection);
    unlockAudio();
    return true;
  }

  const valueDirection = Math.abs(input.dpad.x) >= CONTROLLER_DPAD_NAV_THRESHOLD
    ? Math.sign(input.dpad.x)
    : 0;
  if (valueDirection === 0) {
    state.settingsUi.valueDirection = 0;
  } else if (valueDirection !== state.settingsUi.valueDirection) {
    state.settingsUi.valueDirection = valueDirection;
    adjustSelectedSetting(valueDirection);
    unlockAudio();
    return true;
  }

  if (input.pressed.reset) {
    leaveSettingsMenuRoom();
    return true;
  }

  if (input.pressed.select) {
    activateSelectedSetting();
    return true;
  }

  return false;
}

function leaveThemeMenuRoom() {
  requestMechanicalBeep();
  enterMenuRoom(MENU_ROOMS.ready);
}

function leaveSettingsMenuRoom() {
  requestMechanicalBeep();
  enterMenuRoom(MENU_ROOMS.ready);
}

function requestWaitingRoomStart() {
  if (isLocalBotLobby()) {
    startLocalBotGame(state.localGame.botCount);
    return;
  }

  if (!socket.connected || !canStartWaitingRoom()) {
    return;
  }

  socket.emit(CLIENT_EVENTS.start);
}

function canStartWaitingRoom() {
  if (isLocalBotLobby()) {
    return true;
  }

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

function spectatorTargetRoomId() {
  return state.room?.roomId ||
    state.lastRoomId ||
    (state.localGame.active ? LOCAL_BOT_ROOM_ID : "") ||
    storedRoomId();
}

function loadSpectatorTargetMap() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SPECTATOR_TARGET_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    window.localStorage.removeItem(SPECTATOR_TARGET_STORAGE_KEY);
    return {};
  }
}

function storedSpectatorTargetId(roomId = spectatorTargetRoomId()) {
  if (!roomId) {
    return null;
  }

  const target = loadSpectatorTargetMap()[roomId];
  return typeof target === "string" && target.length > 0 ? target : null;
}

function rememberSpectatorTarget(targetId, roomId = spectatorTargetRoomId()) {
  if (!roomId) {
    return;
  }

  const targets = loadSpectatorTargetMap();
  if (targetId) {
    targets[roomId] = String(targetId);
  } else {
    delete targets[roomId];
  }
  window.localStorage.setItem(SPECTATOR_TARGET_STORAGE_KEY, JSON.stringify(targets));
}

function setSpectatorTarget(targetId, options = {}) {
  state.spectatorTargetId = targetId || null;
  if (options.persist) {
    rememberSpectatorTarget(state.spectatorTargetId);
  }
  return state.spectatorTargetId;
}

function activeRoomButtons() {
  if (canLeaveWithControllerReset()) {
    return { terminalLeave: terminalLeaveActionRect() };
  }

  return {};
}

function terminalLeaveActionRect() {
  if (mobileControlsActive()) {
    return mobileTerminalLeaveActionRect();
  }

  const ended = state.room?.state === "ended";
  return {
    x: TERMINAL_LEAVE_ACTION.x,
    y: ended ? endedTerminalLeaveActionY() : TERMINAL_LEAVE_ACTION.eliminatedY,
    width: TERMINAL_LEAVE_ACTION.width,
    height: TERMINAL_LEAVE_ACTION.height
  };
}

function mobileTerminalLeaveActionRect() {
  return {
    x: MOBILE_HUD_ACTION_X,
    y: mobileHudControlBlockY(MOBILE_HUD_ACTION_HEIGHT),
    width: 96,
    height: MOBILE_HUD_ACTION_HEIGHT
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
  updateUpgradeSelectionFromPoint(state.mouse.x, state.mouse.y);
}

function updateUpgradeSelectionFromPoint(x, y) {
  const index = upgradeIndexAtPoint(x, y);
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
      const result = purchasePlayerUpgrade(state.localGame.arena, LOCAL_BOT_PLAYER_ID, definition.id);
      if (result.ok) {
        requestMechanicalBeep();
        syncLocalArenaSnapshot(performance.now() / 1000);
      }
    }
    return;
  }

  if (socket.connected && canAffordUpgrade(player.resources, cost)) {
    requestMechanicalBeep();
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
  if (!state.build.active || state.chat.active || state.upgrades.active || !roomAllowsBuilding()) {
    return false;
  }

  return state.mouse.down ||
    (state.controller.connected && state.controller.mining) ||
    mobileAimJoystickEngaged();
}

function resetBuildHold() {
  state.build.lastTargetKey = "";
  state.build.nextAttemptSeconds = 0;
}

function buildWallAtMouse(options = {}) {
  const player = predictedLocalPlayer() || localPlayerFromSnapshot();
  if (
    state.build.active &&
    roomAllowsBuilding() &&
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
      tileY: target.tileY,
      angle: target.angle
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
    tileY: target.tileY,
    angle: target.angle
  });
}

function buildTargetKey(tileX, tileY) {
  return `${tileX},${tileY}`;
}

function buildTargetFromMouse() {
  if (
    !state.build.active ||
    !roomAllowsBuilding() ||
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
    angle,
    valid: affordable
  };
}

function buildAngleForPlayer(player) {
  if (state.controller.connected && state.build.active && !state.mouse.down) {
    return controllerAimAngleForPlayer(player);
  }

  if (mobileControlsActive() && state.build.active && !state.mouse.down) {
    return state.mobile.aimAngle;
  }

  const aim = activeAimFramePoint();
  const dx = aim.x - aim.width / 2;
  const dy = aim.y - aim.height / 2;
  return dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) : null;
}

function closestClientBuildTile(player, angle, tileSize) {
  const tiles = clientBuildTargetTiles(player, tileSize);
  return closestBuildTileByCenterAngle({
    tiles,
    tileSize,
    startX: player.x,
    startY: player.y,
    angle
  });
}

function clientBuildTargetTiles(player, tileSize) {
  const maxDistance = ENGINE.build.radiusTiles * tileSize;
  return buildClosestTileRing({
    widthTiles: state.asteroid.widthTiles,
    heightTiles: state.asteroid.heightTiles,
    tileSize,
    startX: player.x,
    startY: player.y,
    originRadius: player.radius || ENGINE.ship.radius || 0,
    maxDistance,
    isCandidate(tileX, tileY) {
      return isClientBuildCandidate(player, tileX, tileY, tileSize);
    },
    isNormallyVisible(tileX, tileY) {
      return isClientBuildTileNormallyVisible(player, tileX, tileY, tileSize);
    },
    isCornerVisible(tileX, tileY) {
      return isClientBuildTileCornerVisible(player, tileX, tileY, tileSize);
    }
  });
}

function isClientBuildTileNormallyVisible(player, tileX, tileY, tileSize) {
  return buildTileVisibleFromOrigin({
    tileX,
    tileY,
    tileSize,
    startX: player.x,
    startY: player.y,
    raycast(angle, distance) {
      return raycastAsteroid(state.asteroid, player.x, player.y, angle, distance);
    }
  });
}

function isClientBuildTileCornerVisible(player, tileX, tileY, tileSize) {
  return buildTileVisibleFromOrigin({
    tileX,
    tileY,
    tileSize,
    startX: player.x,
    startY: player.y,
    includeCorners: true,
    raycast(angle, distance) {
      return raycastAsteroid(state.asteroid, player.x, player.y, angle, distance);
    }
  });
}

function isClientBuildCandidate(player, tileX, tileY, tileSize) {
  if (tileX < 0 || tileY < 0 || tileX >= state.asteroid.widthTiles || tileY >= state.asteroid.heightTiles) {
    return false;
  }

  const index = tileY * state.asteroid.widthTiles + tileX;
  return tileWithinBuildRadius(player, tileX, tileY, tileSize) &&
    state.asteroid.tiles[index] === ASTEROID_TILE.empty &&
    isPlayableBuildIndex(index) &&
    !isStormBuildIndex(index) &&
    !tileOverlapsVisiblePlayer(tileX, tileY, tileSize);
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

function roomAllowsBuilding() {
  return state.room?.state === "active" || state.room?.state === "waiting";
}

function audioPlayerForRender(snapshot, cameraPlayerId) {
  if (!snapshot) {
    return null;
  }

  if (cameraPlayerId === state.playerId) {
    return predictedLocalPlayer() || snapshot.players?.find((candidate) => candidate.id === state.playerId) || null;
  }

  return snapshot.players?.find((candidate) => candidate.id === cameraPlayerId) ||
    snapshot.players?.find((candidate) => candidate.id === audioFocusPlayerIdForSnapshot(snapshot)) ||
    null;
}

function audioFocusPlayerIdForSnapshot(snapshot) {
  const players = snapshot?.players || [];
  const local = players.find((candidate) => candidate.id === state.playerId);
  if (local && local.alive !== false) {
    return local.id;
  }

  if (state.room?.state === "ended" && state.room.winnerId) {
    return state.room.winnerId;
  }

  const killer = local?.killedById
    ? players.find((candidate) => candidate.id === local.killedById && candidate.alive === true)
    : null;
  if (killer) {
    return killer.id;
  }

  const spectator = players.find((candidate) => candidate.id === state.spectatorTargetId && candidate.alive === true);
  if (spectator) {
    return spectator.id;
  }

  return players.find((candidate) => candidate.alive === true)?.id || local?.id || state.playerId;
}

function cameraPlayerIdForRoom() {
  const room = state.room;
  const player = localPlayerFromSnapshot();
  if (room?.state === "ended" && room.winnerId) {
    return room.winnerId;
  }

  if (!player && (room?.state === "waiting" || room?.state === "active")) {
    const restored = restoredAliveSpectatorTargetId();
    if (restored) {
      return restored;
    }

    return randomAliveSpectatorTargetId({
      id: state.playerId || state.clientId || "spectator",
      eliminatedAtTick: state.snapshot?.tick ?? 0
    }) || firstSnapshotPlayerId() || state.playerId;
  }

  if (!player || player.alive) {
    setSpectatorTarget(null);
    return state.playerId;
  }

  if (player.killedById) {
    const killer = state.snapshot?.players.find((candidate) => (
      candidate.id === player.killedById && candidate.alive === true
    ));
    if (killer) {
      return setSpectatorTarget(killer.id, { persist: true });
    }
  }

  if (aliveSpectatorPlayers().some((candidate) => candidate.id === state.spectatorTargetId)) {
    return state.spectatorTargetId;
  }

  const restored = restoredAliveSpectatorTargetId();
  if (restored) {
    return restored;
  }

  return randomAliveSpectatorTargetId(player) || state.playerId;
}

function canCycleSpectatorTargets() {
  if (leaveConfirmIsActive() || state.room?.state !== "active") {
    return false;
  }

  const player = localPlayerFromSnapshot();
  return Boolean(state.snapshot && (!player || player.alive === false) && aliveSpectatorPlayers().length > 1);
}

function cycleSpectatorTarget(direction) {
  const players = aliveSpectatorPlayers();
  if (players.length <= 1) {
    return false;
  }

  const currentId = state.spectatorTargetId || cameraPlayerIdForRoom();
  const currentIndex = players.findIndex((candidate) => candidate.id === currentId);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  const offset = direction >= 0 ? 1 : -1;
  const nextIndex = (startIndex + offset + players.length) % players.length;
  setSpectatorTarget(players[nextIndex].id, { persist: true });
  return true;
}

function aliveSpectatorPlayers() {
  return (state.snapshot?.players || [])
    .filter((candidate) => candidate.alive === true)
    .slice()
    .sort((a, b) => (
      (Number(a.number) || 0) - (Number(b.number) || 0) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    ));
}

function randomAliveSpectatorTargetId(eliminatedPlayer) {
  const alivePlayers = aliveSpectatorPlayers();
  if (alivePlayers.length <= 0) {
    setSpectatorTarget(null, { persist: true });
    return null;
  }

  if (alivePlayers.some((candidate) => candidate.id === state.spectatorTargetId)) {
    return state.spectatorTargetId;
  }

  const random = createSeededRandom(
    `${eliminatedPlayer.id}:${eliminatedPlayer.eliminatedAtTick ?? state.snapshot?.tick ?? 0}:spectator`
  );
  return setSpectatorTarget(
    alivePlayers[Math.floor(random() * alivePlayers.length)]?.id || alivePlayers[0].id,
    { persist: true }
  );
}

function restoredAliveSpectatorTargetId() {
  const alivePlayers = aliveSpectatorPlayers();
  if (alivePlayers.length <= 0) {
    return null;
  }

  const storedTargetId = storedSpectatorTargetId();
  if (!storedTargetId) {
    return null;
  }

  const target = alivePlayers.find((candidate) => candidate.id === storedTargetId);
  if (!target) {
    return null;
  }

  setSpectatorTarget(target.id);
  return target.id;
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
  return playerMapFeatureEnabled() &&
    state.room?.state === "active" &&
    !isReadyMenu() &&
    Boolean(state.asteroid) &&
    Boolean(state.playerMap.cells);
}

function playerMapFeatureEnabled() {
  return DEBUG_FEATURES.playerMap === true;
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
      radius: visibleRadius / chunkWorldSize,
      shipRadius: player.radius,
      angle: player.angle,
      aimAngle: player.aimAngle,
      health: player.health,
      maxHealth: player.maxHealth,
      healthBars: player.healthBars,
      miningRayCount: player.miningRayCount
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
    return miniPlayerRenderRadiusPixels() * WORLD_LENS_EDGE_SCALE;
  }

  return (Math.min(RENDER.width, RENDER.height) / 2) * WORLD_LENS_EDGE_SCALE;
}

function miniPlayerRenderRadiusPixels() {
  return Math.max(
    1,
    Math.min(
      Number(minimapCanvas?.width) || PLAYER_MAP_MINIPLAYER_RADIUS * 2,
      Number(minimapCanvas?.height) || PLAYER_MAP_MINIPLAYER_RADIUS * 2
    ) / 2
  );
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
  if (!state.botDebugOverlay) {
    state.botDebugLog.lastId = "";
    state.botDebugLog.lastAtSeconds = 0;
    return;
  }

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
    y: upgradeMenuY() + UPGRADE_MENU_LAYOUT.rowTopOffset,
    width: upgradeMenuRowWidth(),
    height: UPGRADE_DEFINITIONS.length * UPGRADE_MENU_LAYOUT.rowHeight
  };
}

function upgradeMenuRowWidth() {
  return approximateUpgradeMenuWidth(mobileControlsActive()) - UPGRADE_MENU_LAYOUT.rowInset * 2;
}

function approximateUpgradeMenuWidth(mobileActive = false) {
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
  const titleWidth = approximateBitmapTextWidth("UPGRADES");
  const widths = [
    titleWidth + UPGRADE_MENU_LAYOUT.padding * 2,
    rowWidth + UPGRADE_MENU_LAYOUT.rowInset * 2
  ];
  if (!mobileActive) {
    const detailWidth = Math.max(...approximateUpgradeMenuDetailLines().map(approximateBitmapTextWidth));
    widths.push(detailWidth + UPGRADE_MENU_LAYOUT.padding * 2);
  }

  return Math.ceil(Math.max(...widths));
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

  if (mobileControlsActive()) {
    if (state.mobile.aimJoystick.active && Number.isFinite(state.mobile.aimAngle)) {
      return state.mobile.aimAngle;
    }
    if (Number.isFinite(player?.aimAngle)) {
      return player.aimAngle;
    }
    if (Number.isFinite(player?.angle)) {
      return player.angle;
    }
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
  const canvasWidth = targetCanvas.width || RENDER.width;
  const canvasHeight = targetCanvas.height || RENDER.height;
  const rect = canvasContentCssRect(targetCanvas);
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  return {
    x: clamp(x / rect.scale, 0, canvasWidth),
    y: clamp(y / rect.scale, 0, canvasHeight),
    inFrame: x >= 0 && x <= rect.width && y >= 0 && y <= rect.height
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
