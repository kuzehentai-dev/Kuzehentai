const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function main() {
  console.log('--- Starting WebP Image Compression & Optimization ---');

  const coversDir = path.join(__dirname, '..', 'public', 'covers');
  const apiCoversDir = path.join(__dirname, '..', 'public', 'api', 'covers');
  const dbPath = path.join(__dirname, '..', 'database.json');

  if (!fs.existsSync(apiCoversDir)) {
    fs.mkdirSync(apiCoversDir, { recursive: true });
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  let totalOrigBytes = 0;
  let totalNewBytes = 0;
  let count = 0;

  for (const anime of db.animes) {
    const coverFile = path.join(coversDir, `${anime.id}.webp`);
    if (fs.existsSync(coverFile)) {
      const inputBuf = fs.readFileSync(coverFile);
      totalOrigBytes += inputBuf.length;

      try {
        const webpBuf = await sharp(inputBuf)
          .resize(360, 540, { fit: 'cover', withoutEnlargement: true })
          .webp({ quality: 75, effort: 4 })
          .toBuffer();

        // Write compressed WebP binary files cleanly
        fs.writeFileSync(coverFile, webpBuf);
        fs.writeFileSync(path.join(apiCoversDir, `${anime.id}.webp`), webpBuf);

        // Update database.json base64 fallback to optimized WebP
        anime.coverData = 'data:image/webp;base64,' + webpBuf.toString('base64');
        anime.image = `/api/covers/${anime.id}.webp`;
        totalNewBytes += webpBuf.length;
        count++;
      } catch (err) {
        console.warn(`[Compression Warning] ${anime.id}:`, err.message);
      }
    }
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');

  console.log(`Successfully compressed ${count} anime covers to modern WebP!`);
  console.log(`Original Total: ${(totalOrigBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Compressed Total: ${(totalNewBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Weight Reduction: ${Math.round((1 - totalNewBytes / totalOrigBytes) * 100)}%`);
}

main().catch(console.error);
