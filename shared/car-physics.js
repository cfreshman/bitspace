import { ENGINE } from "./constants.js";
import { clamp } from "./math.js";

export function simulateCarMovement(player, move, effects, dtSeconds) {
  const moveMagnitude = clamp(Math.hypot(move.x, move.y), 0, 1);
  if (moveMagnitude <= 0) {
    player.carSteerAngle = 0;
    player.carAngularVelocity = 0;
    player.facingMoveX = 0;
    player.facingMoveY = 0;
    clearPendingFacing(player);
    return;
  }

  const moveX = move.x / moveMagnitude;
  const moveY = move.y / moveMagnitude;
  const heading = Math.atan2(moveY, moveX);
  const acceleration = ENGINE.ship.thrust
    * ENGINE.car.driveMultiplier
    * ENGINE.car.speedMultiplier
    * effects.thrustMultiplier
    * moveMagnitude
    * dtSeconds;

  player.vx += moveX * acceleration;
  player.vy += moveY * acceleration;
  player.angle = heading;
  player.carHeading = heading;
  player.carSteerAngle = 0;
  player.carAngularVelocity = 0;
  player.facingMoveX = moveX * moveMagnitude;
  player.facingMoveY = moveY * moveMagnitude;
  clearPendingFacing(player);
}

function clearPendingFacing(player) {
  player.pendingFacingSignX = 0;
  player.pendingFacingSignY = 0;
  player.pendingFacingSeconds = 0;
}
