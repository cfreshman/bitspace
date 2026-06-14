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
  maxPlayers: 4,
  world: {
    width: 2048,
    height: 2048,
    sectorSize: 16
  },
  ship: {
    radius: 7,
    thrust: 1000,
    drag: 0.9,
    maxSpeed: 160
  }
});
