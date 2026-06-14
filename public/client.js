import { ENGINE } from "/shared/constants.js";
import { CLIENT_EVENTS, SERVER_EVENTS } from "/shared/protocol.js";
import { normalizeInput } from "/shared/input.js";
import { createRenderer } from "/renderer.js";

const canvas = document.querySelector("#scene");
const renderer = createRenderer(canvas);
const keys = new Set();
const state = {
  playerId: null,
  snapshot: null,
  inputSeq: 0,
  mouse: {
    x: 0,
    y: 0,
    down: false,
    aimAngle: 0
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

window.addEventListener("keydown", (event) => {
  if (shouldCaptureKey(event.code)) {
    event.preventDefault();
  }
  keys.add(event.code);
});

window.addEventListener("keyup", (event) => {
  if (shouldCaptureKey(event.code)) {
    event.preventDefault();
  }
  keys.delete(event.code);
});

window.addEventListener("blur", () => {
  keys.clear();
  state.mouse.down = false;
});

canvas.addEventListener("pointermove", (event) => {
  updateMouse(event);
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  updateMouse(event);
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
    aimAngle: state.mouse.aimAngle,
    mining: state.mouse.down,
    timeSeconds: now / 1000
  });
  requestAnimationFrame(draw);
}

function readInput() {
  state.inputSeq += 1;
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
    "Space"
  ].includes(code);
}
