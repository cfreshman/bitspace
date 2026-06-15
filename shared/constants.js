export const BRAND = Object.freeze({
  name: "BITSPACE"
});

export const RENDER = Object.freeze({
  width: 384,
  height: 384,
  tileSize: 16,
  viewportTiles: 24,
  foreground: "#74cbef",
  background: "#1f2433"
});

export const ENGINE = Object.freeze({
  tickRate: 60,
  snapshotRate: 60,
  maxPlayers: 8,
  lobby: {
    autoStartSeconds: 300,
    countdownSeconds: 10
  },
  world: {
    width: 4096,
    height: 4096,
    sectorSize: 16
  },
  ship: {
    radius: 7,
    thrust: 460,
    drag: 0.9,
    maxSpeed: 72
  },
  player: {
    startingHealthBars: 3,
    maxHealthBars: 7,
    healthPerBar: 100,
    maxHealth: 300,
    rechargeDelaySeconds: 5,
    maxResourceAmount: 999
  },
  mining: {
    rayLength: 28,
    playerDamagePerSecond: 45,
    rockSeconds: 0.5,
    oreSeconds: 0.5,
    diamondSeconds: 5
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
