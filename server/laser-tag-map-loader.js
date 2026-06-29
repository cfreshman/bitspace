import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import {
  laserTagMapCharForRgb,
  laserTagMapIdFromFilename,
  registerLaserTagMap
} from "../shared/laser-tag-maps.js";

const PNG_SIGNATURE = "89504e470d0a1a0a";

export function laserTagMapFiles(directory) {
  try {
    return fs.readdirSync(directory)
      .filter((filename) => /^map-[a-z0-9_-]+\.png$/i.test(filename))
      .sort();
  } catch (_error) {
    return [];
  }
}

export function loadLaserTagMapsFromDirectory(directory) {
  let loaded = 0;
  for (const filename of laserTagMapFiles(directory)) {
    const id = laserTagMapIdFromFilename(filename);
    const filePath = path.join(directory, filename);
    const rows = decodeLaserTagMapPng(fs.readFileSync(filePath));
    if (registerLaserTagMap({ id, rows })) {
      loaded += 1;
    }
  }
  return loaded;
}

export function decodeLaserTagMapPng(data) {
  if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data);
  }
  if (data.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error("not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const palette = [];
  const transparency = [];
  const idat = [];

  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    offset += 4;
    const type = data.toString("ascii", offset, offset + 4);
    offset += 4;
    const chunk = data.subarray(offset, offset + length);
    offset += length + 4;

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "PLTE") {
      for (let index = 0; index < chunk.length; index += 3) {
        palette.push([chunk[index], chunk[index + 1], chunk[index + 2], 255]);
      }
    } else if (type === "tRNS") {
      transparency.push(...chunk);
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }

  if (interlace !== 0) {
    throw new Error("interlaced PNG maps are not supported");
  }
  for (let index = 0; index < transparency.length; index += 1) {
    if (palette[index]) {
      palette[index][3] = transparency[index];
    }
  }

  const pixels = inflatePngPixels({
    raw: zlib.inflateSync(Buffer.concat(idat)),
    width,
    height,
    bitDepth,
    colorType,
    palette
  });

  return rowsFromPixels(pixels, width, height);
}

function inflatePngPixels({ raw, width, height, bitDepth, colorType, palette }) {
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  if (!((colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) || ((colorType === 2 || colorType === 6) && bitDepth === 8))) {
    throw new Error(`unsupported PNG map format colorType=${colorType} bitDepth=${bitDepth}`);
  }

  const scanlineBytes = colorType === 3
    ? Math.ceil(width * bitDepth / 8)
    : width * channels;
  const bpp = colorType === 3 ? 1 : channels;
  let offset = 0;
  let previous = Buffer.alloc(scanlineBytes);
  const pixels = [];

  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const current = Buffer.from(raw.subarray(offset, offset + scanlineBytes));
    offset += scanlineBytes;
    unfilterScanline(current, previous, filter, bpp);
    previous = current;

    if (colorType === 3) {
      for (const paletteIndex of unpackIndexedPixels(current, bitDepth, width)) {
        pixels.push(palette[paletteIndex] || [0, 0, 0, 255]);
      }
    } else {
      for (let x = 0; x < width; x += 1) {
        const index = x * channels;
        pixels.push([
          current[index],
          current[index + 1],
          current[index + 2],
          channels === 4 ? current[index + 3] : 255
        ]);
      }
    }
  }

  return pixels;
}

function unfilterScanline(current, previous, filter, bpp) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bpp ? current[index - bpp] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= bpp ? previous[index - bpp] : 0;
    let add = 0;
    if (filter === 1) {
      add = left;
    } else if (filter === 2) {
      add = up;
    } else if (filter === 3) {
      add = Math.floor((left + up) / 2);
    } else if (filter === 4) {
      add = paeth(left, up, upLeft);
    } else if (filter !== 0) {
      throw new Error(`unsupported PNG filter ${filter}`);
    }
    current[index] = (current[index] + add) & 255;
  }
}

function unpackIndexedPixels(scanline, bitDepth, width) {
  const pixels = [];
  const mask = (1 << bitDepth) - 1;
  for (const byte of scanline) {
    for (let shift = 8 - bitDepth; shift >= 0 && pixels.length < width; shift -= bitDepth) {
      pixels.push((byte >> shift) & mask);
    }
  }
  return pixels;
}

function rowsFromPixels(pixels, width, height) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixels[y * width + x];
      const char = laserTagMapCharForRgb(r, g, b, a);
      if (char === null) {
        throw new Error(`unknown map color #${hex(r)}${hex(g)}${hex(b)} at ${x},${y}`);
      }
      row += char;
    }
    rows.push(row);
  }
  return rows;
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
}

function hex(value) {
  return value.toString(16).padStart(2, "0");
}
