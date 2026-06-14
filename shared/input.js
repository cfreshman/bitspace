export function createEmptyInput() {
  return {
    seq: 0,
    moveX: 0,
    moveY: 0,
    aimAngle: 0,
    mining: false,
    interact: false,
    build: false
  };
}

export function normalizeInput(payload = {}) {
  const move = normalizeMoveVector(payload.moveX, payload.moveY);

  return {
    seq: normalizeSequence(payload.seq),
    moveX: move.x,
    moveY: move.y,
    aimAngle: normalizeAngle(payload.aimAngle),
    mining: Boolean(payload.mining),
    interact: Boolean(payload.interact),
    build: Boolean(payload.build)
  };
}

function normalizeAxis(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, number));
}

function normalizeMoveVector(x, y) {
  const moveX = normalizeAxis(x);
  const moveY = normalizeAxis(y);
  const magnitude = Math.hypot(moveX, moveY);

  if (magnitude <= 1 || magnitude === 0) {
    return { x: moveX, y: moveY };
  }

  return {
    x: moveX / magnitude,
    y: moveY / magnitude
  };
}

function normalizeSequence(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return Math.floor(number);
}

function normalizeAngle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  const fullTurn = Math.PI * 2;
  return ((number % fullTurn) + fullTurn) % fullTurn;
}
