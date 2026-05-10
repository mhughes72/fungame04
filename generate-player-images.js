/**
 * Generate cartoony portrait images for AI players using DALL-E 3.
 *
 * Usage:
 *   node generate-player-images.js                  # all AI players, skip existing
 *   node generate-player-images.js --name "Roxie"   # one player only
 *   node generate-player-images.js --replace        # overwrite existing images
 *   node generate-player-images.js --name "Roxie" --replace
 */

require('dotenv').config();
const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');

const client     = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTPUT_DIR = path.join(__dirname, 'public', 'images', 'players');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const nameIdx    = args.indexOf('--name');
const targetName = nameIdx !== -1 ? args[nameIdx + 1] : null;
const replace    = args.includes('--replace');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading image`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function generateForPlayer(player) {
  const slug    = slugify(player.name);
  const outPath = path.join(OUTPUT_DIR, `${slug}.png`);

  if (!replace && fs.existsSync(outPath)) {
    console.log(`  [skip] ${player.name} — already exists (--replace to overwrite)`);
    return;
  }

  console.log(`  [gen]  ${player.name}…`);

  const prompt = [
    `Cartoon character portrait for a Jeopardy game show contestant named "${player.name}".`,
    `Style: vibrant, fun, slightly exaggerated cartoon illustration — think Pixar or a high-quality animated series.`,
    `Bust/portrait framing against a simple solid-colour background. No text or labels in the image.`,
    ``,
    `Appearance: ${player.appearance}`,
    ``,
    `Personality (use as mood/expression guidance only): ${player.personality}`,
  ].join('\n');

  const response = await client.images.generate({
    model:   'dall-e-3',
    prompt,
    n:       1,
    size:    '1024x1024',
    quality: 'standard',
  });

  const url = response.data[0].url;
  await downloadImage(url, outPath);
  console.log(`  [ok]   saved → ${path.relative(__dirname, outPath)}`);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set in .env');
    process.exit(1);
  }

  const all       = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'players.json'), 'utf8'));
  const aiPlayers = all.filter(p => !p.isHuman);

  let targets = aiPlayers;
  if (targetName) {
    targets = aiPlayers.filter(p => p.name.toLowerCase() === targetName.toLowerCase());
    if (!targets.length) {
      const names = aiPlayers.map(p => p.name).join(', ');
      console.error(`No AI player named "${targetName}". Available: ${names}`);
      process.exit(1);
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const player of targets) {
    await generateForPlayer(player);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
