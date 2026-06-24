export const BRAND = Object.freeze({
  name: "BITSPACE"
});

export const GAME_MODES = Object.freeze({
  bitspace: "bitspace",
  cars: "cars"
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
    speedMultiplier: 3,
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
