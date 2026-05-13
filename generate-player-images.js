/**
 * Generate and manage player portrait images using DALL-E 3.
 *
 * Usage:
 *   node generate-player-images.js                          # all AI players, skip existing
 *   node generate-player-images.js --name "Debbie Fontaine" # one player only
 *   node generate-player-images.js --replace                # overwrite existing images
 *   node generate-player-images.js --host                   # generate host portrait (public/images/host.png)
 *   node generate-player-images.js --create "a nervous librarian from Ohio who knows everything about classic literature"
 */

require('dotenv').config();
const OpenAI = require('openai');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');

const client      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTPUT_DIR  = path.join(__dirname, 'public', 'images', 'players');
const PLAYERS_FILE = path.join(__dirname, 'public', 'players.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const nameIdx     = args.indexOf('--name');
const targetName  = nameIdx !== -1 ? args[nameIdx + 1] : null;
const replace     = args.includes('--replace');
const genHost     = args.includes('--host');
const genYou      = args.includes('--you');
const createIdx   = args.indexOf('--create');
const createBrief = createIdx !== -1 ? args[createIdx + 1] : null;

const YOU = {
  name:        'You',
  personality: 'A mystery contestant — could be anyone. Confident, eager, unknowable.',
  appearance:  'A stylized silhouette of a game show contestant seen from the front, head and shoulders, against a warm studio backdrop. The figure is a solid dark shape with no facial features — just a clean human outline with a faint warm glow around the edges as if backlit by studio lights. The silhouette wears a collared shirt visible at the shoulders. A subtle "?" glows softly on the chest, rendered like a sequined name-tag badge. 1970s TV aesthetic, warm Kodachrome tones, slight film grain.',
};

const HOST = {
  name:        'Chuck Pendleton',
  personality: 'Warm, slightly corny, endlessly enthusiastic game show host who has been doing this since 1972 and loves every second of it. Wears his confidence like a blazer.',
  appearance:  'A handsome man in his mid-40s with a broad smile, a full head of perfectly styled dark hair going silver at the temples, and a wide-lapel polyester suit in a warm caramel brown. Large tinted glasses. The kind of man who shakes your hand and makes you feel like you just won something.',
};

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function saveBase64Image(b64, dest) {
  fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
}

// ── Portrait prompt ───────────────────────────────────────────────────────────
function buildPortraitPrompt(player) {
  return [
    `Portrait photograph of a Jeopardy! game show contestant named "${player.name}".`,
    ``,
    `Style: authentic 1970s–1980s network television. Warm Kodachrome colour film, slightly faded and saturated.`,
    `Soft studio lighting with a subtle warm key light. Shallow depth of field. Grain consistent with 35mm film.`,
    `The exact look of a CBS or NBC promotional headshot from 1979 — real, slightly imperfect, unmistakably of that era.`,
    `Head-and-shoulders framing. Plain neutral studio backdrop, slightly out of focus.`,
    `No text, no labels, no watermarks, no graphics in the image.`,
    ``,
    `Subject: ${player.appearance}`,
    ``,
    `Mood/expression (use as guidance only): ${player.personality}`,
  ].join('\n');
}

async function generatePortrait(player) {
  const slug    = slugify(player.name);
  const outPath = path.join(OUTPUT_DIR, `${slug}.png`);

  console.log(`  [gen]  ${player.name}…`);
  const response = await client.images.generate({
    model:   'gpt-image-1',
    prompt:  buildPortraitPrompt(player),
    n:       1,
    size:    '1024x1024',
    quality: 'medium',
  });

  saveBase64Image(response.data[0].b64_json, outPath);
  console.log(`  [ok]   saved → ${path.relative(__dirname, outPath)}`);
}

// ── --create: generate a new player from a plain-English brief ────────────────
async function createPlayer(brief) {
  console.log(`\nGenerating character from brief: "${brief}"\n`);

  const systemPrompt = `You design eccentric human contestants for a Jeopardy!-style TV game show set in the late 1970s/early 1980s.
Given a brief description, return a single JSON object with exactly these fields — nothing else, no markdown fences:

{
  "name":             string  (plausible full name matching the character),
  "isHuman":          false,
  "avatar":           string  (a single emoji that suits them),
  "strategy":         string  ("highValue" | "sweepCategory" | "random"),
  "speed":            string  ("slow" | "medium" | "fast"),
  "accuracy":         number  (0.50–0.95 — how often correct when they buzz in),
  "specialties": {
    "science":        number,
    "history":        number,
    "popculture":     number,
    "sports":         number,
    "arts":           number,
    "geography":      number,
    "food":           number,
    "general":        number
  },
  "riskTolerance":      string ("aggressive" | "calculated" | "conservative"),
  "buzzAggressiveness": number (0.30–2.00 — how eagerly they buzz in),
  "reactionVoice":      string ("clinical" | "snarky" | "warm" | "dramatic"),
  "personality":        string (2–3 vivid sentences about their game-show personality and quirks),
  "appearance":         string (2–3 sentences of specific physical description suitable for a photorealistic portrait)
}

Specialty values: 1.0 = average, below 1.0 = weak, above 1.0 = strong. Make the spread reflect the character's background.
Keep appearance grounded and era-appropriate (1970s–1980s clothing, hair, etc).`;

  const completion = await client.chat.completions.create({
    model:    'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: brief },
    ],
    temperature:  0.9,
    max_tokens:   700,
    response_format: { type: 'json_object' },
  });

  let player;
  try {
    player = JSON.parse(completion.choices[0].message.content);
  } catch {
    console.error('Failed to parse GPT response as JSON:');
    console.error(completion.choices[0].message.content);
    process.exit(1);
  }

  // Attach metadata comment fields to match existing schema
  player._riskTolerance      = 'aggressive | conservative | calculated — how boldly the AI wagers on Daily Doubles (not yet active)';
  player._buzzAggressiveness = '0.0–2.0 multiplier on per-question buzz probability (not yet active)';
  player._reactionVoice      = 'clinical | snarky | warm | dramatic — tone of result message feedback (not yet active)';

  console.log(`\nGenerated player: ${player.name}`);
  console.log(`  Accuracy: ${player.accuracy}  Speed: ${player.speed}  Voice: ${player.reactionVoice}`);
  console.log(`  Personality: ${player.personality.slice(0, 80)}…`);

  // Append to players.json
  const all = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  const exists = all.find(p => p.name.toLowerCase() === player.name.toLowerCase());
  if (exists) {
    console.warn(`\n  Warning: a player named "${player.name}" already exists — not appending.`);
    console.warn(`  Use --name "${player.name}" --replace to regenerate their portrait.\n`);
  } else {
    all.push(player);
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(all, null, 2));
    console.log(`\n  Appended to players.json`);
  }

  // Generate portrait
  console.log('');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await generatePortrait(player);
  console.log(`\nDone. Restart the server to see ${player.name} in the player select screen.\n`);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set in .env');
    process.exit(1);
  }

  if (createBrief) {
    await createPlayer(createBrief);
    return;
  }

  if (genYou) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(OUTPUT_DIR, 'you.png');
    if (!replace && fs.existsSync(outPath)) {
      console.log('  [skip] "you" portrait already exists (use --replace to overwrite)');
      return;
    }
    console.log(`\n  [gen]  You (mystery contestant)…`);
    const response = await client.images.generate({
      model:   'gpt-image-1',
      prompt:  buildPortraitPrompt(YOU),
      n:       1,
      size:    '1024x1024',
      quality: 'medium',
    });
    saveBase64Image(response.data[0].b64_json, outPath);
    console.log(`  [ok]   saved → public/images/players/you.png\n`);
    return;
  }

  if (genHost) {
    fs.mkdirSync(path.join(__dirname, 'public', 'images'), { recursive: true });
    const outPath = path.join(__dirname, 'public', 'images', 'host.png');
    if (!replace && fs.existsSync(outPath)) {
      console.log('  [skip] host portrait already exists (use --replace to overwrite)');
      return;
    }
    console.log(`\n  [gen]  ${HOST.name}…`);
    const response = await client.images.generate({
      model:   'gpt-image-1',
      prompt:  buildPortraitPrompt(HOST),
      n:       1,
      size:    '1024x1024',
      quality: 'medium',
    });
    saveBase64Image(response.data[0].b64_json, outPath);
    console.log(`  [ok]   saved → public/images/host.png\n`);
    return;
  }

  const all       = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
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

  if (!replace) {
    const missing = targets.filter(p => !fs.existsSync(path.join(OUTPUT_DIR, `${slugify(p.name)}.png`)));
    const have    = targets.length - missing.length;
    if (have > 0) console.log(`\n  ${have} player${have !== 1 ? 's' : ''} already have portraits — skipping (use --replace to regenerate)\n`);
    targets = missing;
  }

  if (!targets.length) {
    console.log('  Nothing to generate.\n');
    return;
  }

  console.log(`\nGenerating ${targets.length} portrait${targets.length !== 1 ? 's' : ''}…\n`);
  for (const player of targets) {
    await generatePortrait(player);
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
