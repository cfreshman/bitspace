export function createEmptyInput() {
  return {
    sessionId: "",
    seq: 0,
    moveX: 0,
    moveY: 0,
    aimAngle: 0,
    mining: false,
    huckRock: false,
    huckRockTargetX: null,
    huckRockTargetY: null,
    interact: false,
    build: false
  };
}

export function normalizeInput(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return createEmptyInput();
  }
  const move = normalizeMoveVector(payload.moveX, payload.moveY);

  return {
    sessionId: normalizeSessionId(payload.sessionId),
    seq: normalizeSequence(payload.seq),
    moveX: move.x,
    moveY: move.y,
    aimAngle: normalizeAngle(payload.aimAngle),
    mining: Boolean(payload.mining),
    huckRock: Boolean(payload.huckRock),
    huckRockTargetX: normalizeNullableNumber(payload.huckRockTargetX),
    huckRockTargetY: normalizeNullableNumber(payload.huckRockTargetY),
    interact: Boolean(payload.interact),
    build: Boolean(payload.build)
  };
}

function normalizeSessionId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{8,64}$/.test(text) ? text : "";
}

function normalizeAxis(value) {
  const number = numberFromInput(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, number));
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = numberFromInput(value);
  return Number.isFinite(number) ? number : null;
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
  const number = numberFromInput(value);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return Math.floor(number);
}

function normalizeAngle(value) {
  const number = numberFromInput(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  const fullTurn = Math.PI * 2;
  return ((number % fullTurn) + fullTurn) % fullTurn;
}

export function numberFromInput(value) {
  if (value !== null && value !== undefined &&
      typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
    return NaN;
  }
  return Number(value);
}
