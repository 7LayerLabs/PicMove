import sharp from "sharp";
import { mkdirSync } from "fs";

mkdirSync("public", { recursive: true });

const bg = { r: 11, g: 11, b: 11, alpha: 1 };
const accent = "#4f8cff";

async function makeIcon(size, outPath) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect width="24" height="24" fill="#0b0b0b"/>
      <g fill="none" stroke="${accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2h5L16 6h3a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="12.5" r="3.5"/>
      </g>
    </svg>`;
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath);
  console.log(`✓ ${outPath}`);
}

await makeIcon(192, "public/icon-192.png");
await makeIcon(512, "public/icon-512.png");
await makeIcon(180, "public/apple-touch-icon.png");
await makeIcon(32, "public/favicon.ico"); // browsers accept PNG content here
