export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clampMagnitude(x, y, maxMagnitude) {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= maxMagnitude || magnitude === 0) {
    return { x, y };
  }

  const scale = maxMagnitude / magnitude;
  return { x: x * scale, y: y * scale };
}

export function squaredDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function roundForSnapshot(value) {
  return Math.round(value * 100) / 100;
}

export function createSeededRandom(seed) {
  let state = 1779033703 ^ String(seed).length;

  for (let index = 0; index < String(seed).length; index += 1) {
    state = Math.imul(state ^ String(seed).charCodeAt(index), 3432918353);
    state = (state << 13) | (state >>> 19);
  }

  return function random() {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

const SIMPLEX_GRADIENTS_3D = Object.freeze([
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1]
]);

export function createSimplexNoise3D(seed) {
  const random = createSeededRandom(seed);
  const permutation = Array.from({ length: 256 }, (_value, index) => index);

  for (let index = permutation.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = permutation[index];
    permutation[index] = permutation[swapIndex];
    permutation[swapIndex] = value;
  }

  const perm = new Uint8Array(512);
  for (let index = 0; index < perm.length; index += 1) {
    perm[index] = permutation[index & 255];
  }

  return function simplex3D(x, y, z) {
    const skew = (x + y + z) / 3;
    const i = Math.floor(x + skew);
    const j = Math.floor(y + skew);
    const k = Math.floor(z + skew);
    const unskew = (i + j + k) / 6;
    const x0 = x - (i - unskew);
    const y0 = y - (j - unskew);
    const z0 = z - (k - unskew);
    let i1;
    let j1;
    let k1;
    let i2;
    let j2;
    let k2;

    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }

    const x1 = x0 - i1 + 1 / 6;
    const y1 = y0 - j1 + 1 / 6;
    const z1 = z0 - k1 + 1 / 6;
    const x2 = x0 - i2 + 1 / 3;
    const y2 = y0 - j2 + 1 / 3;
    const z2 = z0 - k2 + 1 / 3;
    const x3 = x0 - 0.5;
    const y3 = y0 - 0.5;
    const z3 = z0 - 0.5;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    return 32 * (
      simplexCorner(perm, ii, jj, kk, 0, 0, 0, x0, y0, z0) +
      simplexCorner(perm, ii, jj, kk, i1, j1, k1, x1, y1, z1) +
      simplexCorner(perm, ii, jj, kk, i2, j2, k2, x2, y2, z2) +
      simplexCorner(perm, ii, jj, kk, 1, 1, 1, x3, y3, z3)
    );
  };
}

function simplexCorner(perm, ii, jj, kk, i, j, k, x, y, z) {
  let influence = 0.6 - x * x - y * y - z * z;
  if (influence < 0) {
    return 0;
  }

  const gradient = SIMPLEX_GRADIENTS_3D[
    perm[ii + i + perm[jj + j + perm[kk + k]]] % SIMPLEX_GRADIENTS_3D.length
  ];
  influence *= influence;
  return influence * influence * (gradient[0] * x + gradient[1] * y + gradient[2] * z);
}
