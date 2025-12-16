const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

function isPngFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length < 8) return false;
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  } catch {
    return false;
  }
}

async function main() {
  const root = path.join(__dirname, '..');

  const candidates = [
    path.join(root, 'assets', 'img', 'logoWeightLogger_256.png'),
    path.join(root, 'assets', 'img', 'logoWeightLogger_512.png'),
  ];

  const sources = candidates.filter((p) => fs.existsSync(p) && isPngFile(p));
  if (!sources.length) {
    throw new Error('No valid PNG icon sources found under assets/img.');
  }

  const outDir = path.join(root, 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const outIcoPath = path.join(outDir, 'icon.ico');
  let icoBuf;
  try {
    icoBuf = await pngToIco(sources);
  } catch {
    // Some PNGs (even if valid) can fail parsing; fall back to the largest.
    const fallback = sources[sources.length - 1];
    icoBuf = await pngToIco([fallback]);
  }
  fs.writeFileSync(outIcoPath, icoBuf);

  process.stdout.write(`Generated ${outIcoPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
