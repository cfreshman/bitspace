import { ENGINE } from "./constants.js";
import { clamp } from "./math.js";

export function simulateCloudMovement(player, move, effects, dtSeconds = 1 / 60) {
  const magnitude = clamp(Math.hypot(move.x, move.y), 0, 1);
  const desiredSpeed =
    ENGINE.ship.baseTerminalSpeed *
    ENGINE.clouds.speedMultiplier *
    Math.max(0.1, Number(effects?.thrustMultiplier) || 1) *
    magnitude;
  const desiredVx = magnitude > 0.000001 ? (move.x / magnitude) * desiredSpeed : 0;
  const desiredVy = magnitude > 0.000001 ? (move.y / magnitude) * desiredSpeed : 0;
  const pitchCommand = pitchCommandForVelocityError(
    desiredVx - (Number(player.vx) || 0),
    desiredVy - (Number(player.vy) || 0)
  );
  const pitch = moveVectorToward(
    Number(player.cloudPitchX) || 0,
    Number(player.cloudPitchY) || 0,
    pitchCommand.x,
    pitchCommand.y,
    ENGINE.clouds.pitchResponseRate * Math.max(0, dtSeconds)
  );
  player.cloudPitchX = pitch.x;
  player.cloudPitchY = pitch.y;

  const pitchMagnitude = clamp(Math.hypot(player.cloudPitchX, player.cloudPitchY), 0, 1);
  if (pitchMagnitude <= 0.000001) {
    player.cloudPitchX = 0;
    player.cloudPitchY = 0;
    applyCloudAirFriction(player, dtSeconds);
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    clearPendingFacing(player);
    return;
  }

  const directionX = player.cloudPitchX / pitchMagnitude;
  const directionY = player.cloudPitchY / pitchMagnitude;
  const maxPitchRadians = Math.max(0.001, Number(ENGINE.clouds.maxPitchRadians) || Math.PI / 5);
  const pitchSpeedScale = clamp(
    Math.tan(maxPitchRadians * pitchMagnitude) / Math.tan(maxPitchRadians),
    0,
    1
  );
  const acceleration =
    Math.max(0, Number(ENGINE.clouds.rotorAcceleration) || 0) *
    Math.max(0.1, Number(effects?.thrustMultiplier) || 1) *
    pitchSpeedScale;

  player.vx += directionX * acceleration * Math.max(0, dtSeconds);
  player.vy += directionY * acceleration * Math.max(0, dtSeconds);
  applyCloudAirFriction(player, dtSeconds);
  player.angle = normalizeAngle(Math.atan2(directionY, directionX));
  player.facingMoveX = player.cloudPitchX;
  player.facingMoveY = player.cloudPitchY;
  clearPendingFacing(player);
}

function pitchCommandForVelocityError(errorX, errorY) {
  const fullPitchError = Math.max(1, ENGINE.ship.baseTerminalSpeed * ENGINE.clouds.speedMultiplier);
  const x = errorX / fullPitchError;
  const y = errorY / fullPitchError;
  const magnitude = Math.hypot(x, y);
  if (magnitude <= 1) {
    return { x, y };
  }
  return {
    x: x / magnitude,
    y: y / magnitude
  };
}

function applyCloudAirFriction(player, dtSeconds) {
  const fixedStepSeconds = 1 / ENGINE.tickRate;
  const baseFriction = clamp(Number(ENGINE.clouds.airFriction) || 1, 0, 1);
  const friction = Math.pow(baseFriction, Math.max(0, dtSeconds) / fixedStepSeconds);
  player.vx *= friction;
  player.vy *= friction;
  if (Math.hypot(player.vx, player.vy) <= 0.001) {
    player.vx = 0;
    player.vy = 0;
  }
}

function moveVectorToward(x, y, targetX, targetY, maxDelta) {
  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.000001 || distance <= maxDelta) {
    return { x: targetX, y: targetY };
  }

  const scale = maxDelta / distance;
  return {
    x: x + dx * scale,
    y: y + dy * scale
  };
}

function clearPendingFacing(player) {
  player.pendingFacingSignX = 0;
  player.pendingFacingSignY = 0;
  player.pendingFacingSeconds = 0;
  player.subReverseActive = false;
}

function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}
