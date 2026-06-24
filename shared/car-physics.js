import { ENGINE } from "./constants.js";
import { clamp } from "./math.js";

const CAR_REVERSE_CONE_HALF_RADIANS = Math.PI / 8;
const CAR_REVERSE_CONE_EPSILON = 0.000001;
const CAR_REVERSE_SPEED_MULTIPLIER = 1 / 3;

export function simulateCarMovement(player, move, effects, dtSeconds) {
  const hasMoveIntent = move.x !== 0 || move.y !== 0;
  const heading = Number.isFinite(player.carHeading)
    ? player.carHeading
    : Number.isFinite(player.angle) ? player.angle : 0;
  let steerAngle = Number.isFinite(player.carSteerAngle) ? player.carSteerAngle : 0;
  const radius = Math.max(1, Number(player.radius || ENGINE.ship.radius || 1));
  const bodyForward = directionFromAngle(heading);
  const bodySide = {
    x: -bodyForward.y,
    y: bodyForward.x
  };

  if (!hasMoveIntent) {
    steerAngle = approachNumber(steerAngle, 0, ENGINE.car.steerRate * dtSeconds);
    applyLateralGrip(player, bodyForward, bodySide, ENGINE.car.idleTireGrip, dtSeconds);
    player.angle = heading;
    player.carSteerAngle = steerAngle;
    player.carAngularVelocity = 0;
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    clearPendingFacing(player);
    return;
  }

  const desiredAngle = Math.atan2(move.y, move.x);
  const moveMagnitude = clamp(Math.hypot(move.x, move.y), 0, 1);
  const reverseDelta = Math.abs(normalizeSignedAngle(desiredAngle - normalizeAngle(heading + Math.PI)));
  const throttle = moveMagnitude;
  if (reverseDelta < CAR_REVERSE_CONE_HALF_RADIANS - CAR_REVERSE_CONE_EPSILON) {
    steerAngle = 0;
    const reverseAcceleration = throttle
      * ENGINE.ship.thrust
      * ENGINE.car.driveMultiplier
      * ENGINE.car.speedMultiplier
      * CAR_REVERSE_SPEED_MULTIPLIER
      * effects.thrustMultiplier
      * dtSeconds;
    player.vx -= bodyForward.x * reverseAcceleration;
    player.vy -= bodyForward.y * reverseAcceleration;
    player.carHeading = heading;
    player.carSteerAngle = steerAngle;
    player.carAngularVelocity = 0;
    player.angle = heading;
    player.facingMoveX = -bodyForward.x * throttle;
    player.facingMoveY = -bodyForward.y * throttle;
    clearPendingFacing(player);
    applyLateralGrip(player, bodyForward, bodySide, ENGINE.car.tireGrip, dtSeconds);
    return;
  }

  const targetSteer = clamp(
    normalizeSignedAngle(desiredAngle - heading),
    -ENGINE.car.maxSteerAngle,
    ENGINE.car.maxSteerAngle
  );
  steerAngle = approachNumber(steerAngle, targetSteer, ENGINE.car.steerRate * dtSeconds);

  const frontDrive = directionFromAngle(heading + steerAngle);
  const driveX = (frontDrive.x + bodyForward.x) * 0.5;
  const driveY = (frontDrive.y + bodyForward.y) * 0.5;
  const driveAcceleration = throttle
    * ENGINE.ship.thrust
    * ENGINE.car.driveMultiplier
    * ENGINE.car.speedMultiplier
    * effects.thrustMultiplier
    * dtSeconds;
  player.vx += driveX * driveAcceleration;
  player.vy += driveY * driveAcceleration;

  let forwardSpeed = player.vx * bodyForward.x + player.vy * bodyForward.y;
  if (forwardSpeed < 0) {
    player.vx -= bodyForward.x * forwardSpeed;
    player.vy -= bodyForward.y * forwardSpeed;
    forwardSpeed = 0;
  }
  const lateralSpeed = player.vx * bodySide.x + player.vy * bodySide.y;
  const visualWheelBase = radius * Math.abs(ENGINE.car.rearAxleOffsetScale - ENGINE.car.frontAxleOffsetScale);
  const wheelBase = Math.max(1, visualWheelBase || ENGINE.car.wheelBase);
  const driftRatio = Math.abs(lateralSpeed) / Math.max(1, Math.abs(forwardSpeed) + Math.abs(lateralSpeed));
  const driftTurnLoss = 1 - clamp(driftRatio * 0.55, 0, 0.55);
  const wheelYawRate = (forwardSpeed * Math.tan(steerAngle) / wheelBase) * driftTurnLoss;
  const lowSpeedYawRate = throttle * steerAngle * ENGINE.car.turnRate * 0.32;
  const yawRate = clamp(wheelYawRate + lowSpeedYawRate, -ENGINE.car.turnRate, ENGINE.car.turnRate);
  const nextHeading = normalizeAngle(heading + yawRate * dtSeconds);
  const nextForward = directionFromAngle(nextHeading);
  const nextSide = {
    x: -nextForward.y,
    y: nextForward.x
  };

  player.carHeading = nextHeading;
  player.carSteerAngle = steerAngle;
  player.carAngularVelocity = yawRate;
  player.angle = nextHeading;
  player.facingMoveX = bodyForward.x * throttle;
  player.facingMoveY = bodyForward.y * throttle;
  clearPendingFacing(player);

  applyLateralGrip(player, nextForward, nextSide, ENGINE.car.tireGrip, dtSeconds);
}

function applyLateralGrip(player, forward, side, grip, dtSeconds) {
  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const lateralKeep = Math.pow(clamp(grip, 0, 1), dtSeconds / fixedStepSeconds);
  const forwardSpeed = player.vx * forward.x + player.vy * forward.y;
  const lateralSpeed = player.vx * side.x + player.vy * side.y;
  player.vx = forward.x * forwardSpeed + side.x * lateralSpeed * lateralKeep;
  player.vy = forward.y * forwardSpeed + side.y * lateralSpeed * lateralKeep;
}

function clearPendingFacing(player) {
  player.pendingFacingSignX = 0;
  player.pendingFacingSignY = 0;
  player.pendingFacingSeconds = 0;
}

function approachNumber(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }

  return current + Math.sign(delta) * maxDelta;
}

function directionFromAngle(angle) {
  return {
    x: Math.cos(angle),
    y: Math.sin(angle)
  };
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function normalizeSignedAngle(angle) {
  const normalized = normalizeAngle(angle);
  return normalized > Math.PI ? normalized - Math.PI * 2 : normalized;
}
