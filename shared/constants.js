export const BRAND = Object.freeze({
  name: "BITSPACE"
});

export const GAME_MODES = Object.freeze({
  bitspace: "bitspace",
  cars: "cars",
  subs: "subs",
  bugs: "bugs",
  clouds: "clouds"
});

export const RENDER = Object.freeze({
  width: 384,
  height: 384,
  tileSize: 16,
  viewportTiles: 24,
  lensEdgeScale: 1.14,
  lensPower: 3,
  foreground: "#74cbef",
  background: "#1f2433"
});

const ENGINE_TICK_RATE = 60;
const SHIP_THRUST = 360;
const SHIP_BASE_TERMINAL_SPEED = 56;
// Per-tick friction is derived so continuous base thrust settles at the intended speed.
const SHIP_FRICTION = Math.max(
  0,
  Math.min(0.999, 1 - (SHIP_THRUST / ENGINE_TICK_RATE) / SHIP_BASE_TERMINAL_SPEED)
);
const SUB_BASE_FRICTION = Math.min(0.999, SHIP_FRICTION + 0.032);
const SUB_FRICTION = Math.min(0.999, 1 - (1 - SUB_BASE_FRICTION) * 0.15);

export const ENGINE = Object.freeze({
  tickRate: ENGINE_TICK_RATE,
  snapshotRate: 60,
  maxPlayers: 8,
  heartbeat: {
    intervalSeconds: 5,
    timeoutSeconds: 15
  },
  lobby: {
    minPlayers: 2,
    autoStartSeconds: 300,
    countdownSeconds: 10,
    startingRock: 15
  },
  storm: {
    safeSeconds: 120,
    closeSeconds: 480,
    warningSeconds: 15,
    damageTiers: [
      { afterSeconds: 0, damagePerSecond: 6, warning: "!" },
      { afterSeconds: 420, damagePerSecond: 14, warning: "!!" },
      { afterSeconds: 720, damagePerSecond: 28, warning: "!!!" }
    ]
  },
  world: {
    width: 4096,
    height: 4096,
    sectorSize: 16
  },
  ship: {
    radius: 7,
    thrust: SHIP_THRUST,
    baseTerminalSpeed: SHIP_BASE_TERMINAL_SPEED,
    friction: SHIP_FRICTION,
    audioSpeedReference: SHIP_BASE_TERMINAL_SPEED,
    directionKeyGraceSeconds: 0.05
  },
  car: {
    maxSteerAngle: 0.72,
    steerRate: 8.5,
    wheelBase: 9,
    tileScale: 2,
    speedMultiplier: 10 / 3,
    friction: Math.max(0, SHIP_FRICTION - 0.045),
    frontAxleOffsetScale: 0.82,
    rearAxleOffsetScale: -0.82,
    frontTrackOffsetScale: 0.92,
    rearTrackOffsetScale: 0.88,
    tireGrip: 0.88,
    idleTireGrip: 0.72,
    driveMultiplier: 1,
    turnRate: 6.5,
    lateralFriction: 0.88
  },
  subs: {
    tileSize: 20,
    thrustMultiplier: 0.2,
    thrustFalloffSpeed: 42,
    thrustMinScale: 0.16,
    turnRate: 4.2,
    turnThrottleMinScale: 0.14,
    reverseConeRadians: Math.PI / 4,
    reverseThrottleScale: 0.5,
    massScale: 6,
    miningTimeScale: 1,
    friction: SUB_FRICTION,
    forwardFriction: Math.min(0.999, 1 - (1 - SUB_FRICTION) * 0.275),
    sideFriction: Math.min(0.999, 1 - (1 - SUB_FRICTION) * 0.2),
    sideToForwardConversion: 0.34
  },
  bugs: {
    radius: 5,
    tileSize: 12,
    legSpeed: 72,
    maxLegCenterOffset: 14,
    corePull: 58,
    coreDamping: 3.2,
    legDriveSpeed: 174,
    legDamping: 8,
    legRadius: 21,
    legSwingSpeed: 430,
    legMaxStepSeconds: 0.09,
    legLift: 8,
    legBaseSizeScale: 1,
    legSizeRampScale: 0.5,
    legAttachmentScale: 0.66,
    legRestScale: 1.95,
    legTargetRadiusScale: 2.32,
    legFrontScale: 0.95,
    legRandomForwardScale: 0.34,
    legRandomSideScale: 0.72,
    legDriveBias: 0.48
  },
  clouds: {
    radius: 5,
    tileSize: 16,
    speedMultiplier: 2,
    friction: 1,
    healthScale: 0.25,
    rayLengthScale: 1.25,
    miningTimeScale: 0.5,
    pitchResponseRate: 2,
    pitchReturnRate: 2,
    maxPitchRadians: Math.PI / 6,
    rotorAcceleration: 10000,
    airFriction: .5,
  },
  player: {
    startingHealthBars: 3,
    maxHealthBars: 8,
    healthPerBar: 100,
    maxHealth: 800,
    rechargeDelaySeconds: 5,
    maxResourceAmount: 999
  },
  mining: {
    rayLength: 28,
    maxRayCount: 3,
    sideRayOffset: 12,
    sideRayEndOffsetScale: 0.5,
    rayExtendSeconds: 0,
    buttonSeconds: 0.1,
    playerDamagePerSecond: 22.5,
    rockSeconds: 0.5,
    oreSeconds: 0.5,
    diamondSeconds: 5
  },
  build: {
    wallCostRock: 1,
    radiusTiles: 4
  },
  huckRock: {
    radius: 5,
    speed: 190,
    spawnOffset: 14,
    fireIntervalSeconds: 0.55,
    engineCutoutSeconds: 0,
    costRock: 1,
    damage: 12,
    restitution: 0.78,
    recoilImpulseScale: 1,
    shipMassScale: 2,
    lifetimeSeconds: 7,
    maxLobbyRocks: 32,
    fragments: {
      minCount: 2,
      maxCount: 3,
      minRadiusScale: 0.33,
      maxRadiusScale: 0.5,
      minLifetimeSeconds: 0,
      maxLifetimeSeconds: 0.22,
      minSpeedScale: 0.35,
      maxSpeedScale: 0.78,
      spreadRadians: 0.85,
      spawnJitter: 2
    }
  },
  collision: {
    boundaryRestitution: 0.42,
    shipRestitution: 0.55,
    shipPush: 28,
    shakeThreshold: 18,
    shakeScale: 0.018,
    maxShake: 3,
    shakeDecay: 8
  }
});

export function shipFrictionForGameMode(gameMode) {
  if (gameMode === GAME_MODES.cars) {
    return ENGINE.car.friction;
  }
  if (gameMode === GAME_MODES.subs) {
    return ENGINE.subs.friction;
  }
  if (gameMode === GAME_MODES.clouds) {
    return ENGINE.clouds.friction;
  }
  return ENGINE.ship.friction;
}

export function shipThrustForGameMode(gameMode) {
  if (gameMode === GAME_MODES.subs) {
    return ENGINE.ship.thrust * ENGINE.subs.thrustMultiplier;
  }
  return ENGINE.ship.thrust;
}

export function miningRayLengthForGameMode(gameMode, effects = {}) {
  const baseLength = ENGINE.mining.rayLength + Number(effects?.rayLengthBonus || 0);
  if (gameMode === GAME_MODES.clouds) {
    return baseLength * Math.max(0.01, Number(ENGINE.clouds.rayLengthScale) || 1);
  }
  return baseLength;
}

export function mapTileSizeForGameMode(gameMode) {
  if (gameMode === GAME_MODES.cars) {
    return RENDER.tileSize * ENGINE.car.tileScale;
  }
  if (gameMode === GAME_MODES.subs) {
    return ENGINE.subs.tileSize;
  }
  if (gameMode === GAME_MODES.bugs) {
    return ENGINE.bugs.tileSize;
  }
  if (gameMode === GAME_MODES.clouds) {
    return ENGINE.clouds.tileSize;
  }
  return RENDER.tileSize;
}

export function playerRadiusForGameMode(gameMode) {
  if (gameMode === GAME_MODES.bugs) {
    return ENGINE.bugs.radius;
  }
  if (gameMode === GAME_MODES.clouds) {
    return ENGINE.clouds.radius;
  }
  return ENGINE.ship.radius;
}

export function playerMassScaleForGameMode(gameMode) {
  if (gameMode === GAME_MODES.subs) {
    return ENGINE.subs.massScale;
  }
  return 1;
}

export function miningSecondsForGameMode(seconds, gameMode) {
  const baseSeconds = Number(seconds) || 0;
  if (gameMode === GAME_MODES.subs) {
    return baseSeconds * ENGINE.subs.miningTimeScale;
  }
  if (gameMode === GAME_MODES.clouds) {
    return baseSeconds * ENGINE.clouds.miningTimeScale;
  }
  return baseSeconds;
}
