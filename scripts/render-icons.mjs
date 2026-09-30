// Renders assets/studi-icon.svg to the PNG and ICO files the app, installer and landing site use.
// Run after editing the SVG: node scripts/render-icons.mjs
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("assets/studi-icon.svg");

async function png(size) {
  // Rasterise at the target size so large PNGs stay sharp.
  const image = await loadImage(Buffer.from(svg.toString().replace("<svg ", `<svg width="${size}" height="${size}" `)));
  const canvas = createCanvas(size, size);
  canvas.getContext("2d").drawImage(image, 0, 0, size, size);
  return canvas.encode("png");
}

// An ICO file is a small directory of embedded PNGs.
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icoImages = await Promise.all(icoSizes.map(async (size) => ({ size, data: await png(size) })));

writeFileSync("assets/studi-icon.png", await png(1024));
writeFileSync("assets/studi-icon.ico", ico(icoImages));
writeFileSync("landing/app/icon.svg", svg);
console.log("Wrote assets/studi-icon.png, assets/studi-icon.ico and landing/app/icon.svg");
