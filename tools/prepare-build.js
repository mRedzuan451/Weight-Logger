const fs = require('fs');
const path = require('path');

function main() {
  const root = path.join(__dirname, '..');
  const src = path.join(root, 'assets', 'img', 'logoWeightLogger_512.png');
  const outDir = path.join(root, 'build');
  const dest = path.join(outDir, 'icon.png');

  if (!fs.existsSync(src)) {
    throw new Error(`Missing icon source: ${src}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(src, dest);
  process.stdout.write(`Prepared build resources: ${dest}\n`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
