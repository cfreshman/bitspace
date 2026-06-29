import {
  laserTagMapCharForRgb,
  laserTagMapIdFromFilename,
  registerLaserTagMap
} from "/shared/laser-tag-maps.js";

export async function loadLaserTagMaps() {
  const files = await laserTagMapFiles();
  let loaded = 0;
  for (const filename of files) {
    const rows = await decodeLaserTagMapImage(`/maps/laser-tag/${filename}`);
    if (registerLaserTagMap({
      id: laserTagMapIdFromFilename(filename),
      rows
    })) {
      loaded += 1;
    }
  }
  return loaded;
}

async function laserTagMapFiles() {
  try {
    const response = await fetch("/maps/laser-tag/index.json", { cache: "no-cache" });
    if (response.ok) {
      const files = await response.json();
      if (Array.isArray(files) && files.length > 0) {
        return files.filter((filename) => /^map-[a-z0-9_-]+\.png$/i.test(String(filename)));
      }
    }
  } catch (_error) {
    // Fall back to the default map filename below.
  }
  return ["map-01.png"];
}

async function decodeLaserTagMapImage(src) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d", {
    alpha: true,
    willReadFrequently: true
  });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rows = [];
  for (let y = 0; y < canvas.height; y += 1) {
    let row = "";
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const char = laserTagMapCharForRgb(
        data[index],
        data[index + 1],
        data[index + 2],
        data[index + 3]
      );
      if (char === null) {
        throw new Error(`unknown laser tag map color at ${x},${y}`);
      }
      row += char;
    }
    rows.push(row);
  }
  return rows;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${src}`));
    image.src = src;
  });
}
