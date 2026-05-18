#!/usr/bin/env node
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOUNDS_DIR     = path.join(__dirname, 'public', 'sounds');
const CANDIDATES_DIR = path.join(SOUNDS_DIR, 'candidates');
const MANIFEST_FILE  = path.join(__dirname, 'sounds-manifest.json');

const HOST_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'lQgMO4VKveoqHDCZMAr1';

const KNOWN_EVENTS = [
  'correct', 'wrong', 'buzz', 'daily-double',
  'double-jeopardy', 'final-jeopardy', 'timeout', 'game-over',
];

// ── Manifest ─────────────────────────────────────────────────────────────────

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); }
  catch { return { candidates: {}, active: {} }; }
}

function saveManifest(m) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2));
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
}

function nextVariant(name, manifest) {
  let n = 1;
  while (manifest.candidates[`${name}-${n}`]) n++;
  return `${name}-${n}`;
}

function candidatePath(key) {
  return path.join(CANDIDATES_DIR, `${key}.mp3`);
}

function activePath(event) {
  return path.join(SOUNDS_DIR, `${event}.mp3`);
}

// ── ElevenLabs API calls ──────────────────────────────────────────────────────

async function generateSFX(prompt, duration = 3) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set in .env');

  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: prompt, duration_seconds: duration, prompt_influence: 0.4 }),
  });

  if (!res.ok) throw new Error(`ElevenLabs SFX error: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateTTS(text, voiceId = HOST_VOICE_ID) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set in .env');

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.55, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs TTS error: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Preview ───────────────────────────────────────────────────────────────────

function playFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }
  try {
    if (process.platform === 'win32') execSync(`start "" "${filePath}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`afplay "${filePath}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${filePath}"`, { stdio: 'ignore' });
  } catch {
    console.log(`Could not auto-play. Open manually: ${filePath}`);
  }
}

// ── CLI commands ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args.flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else {
      args.positional.push(argv[i]);
    }
  }
  return args;
}

async function cmdSFX(args) {
  const prompt   = args.positional[0];
  const name     = args.flags.name;
  const duration = parseFloat(args.flags.duration ?? 3);
  const variants = parseInt(args.flags.variants ?? 1, 10);

  if (!prompt) { console.error('Usage: node sounds.js sfx "<prompt>" --name <event> [--duration 3] [--variants 2]'); process.exit(1); }
  if (!name)   { console.error('--name is required (e.g. --name correct)'); process.exit(1); }

  ensureDirs();
  const manifest = loadManifest();

  for (let i = 0; i < variants; i++) {
    const key = nextVariant(name, manifest);
    process.stdout.write(`Generating ${key}…`);
    try {
      const audio = await generateSFX(prompt, duration);
      fs.writeFileSync(candidatePath(key), audio);
      manifest.candidates[key] = { type: 'sfx', prompt, duration, created: new Date().toISOString() };
      saveManifest(manifest);
      console.log(` saved → public/sounds/candidates/${key}.mp3`);
    } catch (err) {
      console.error(` failed: ${err.message}`);
    }
  }
}

async function cmdTTS(args) {
  const text    = args.positional[0];
  const name    = args.flags.name;
  const voiceId = args.flags.voice ?? HOST_VOICE_ID;
  const variants = parseInt(args.flags.variants ?? 1, 10);

  if (!text) { console.error('Usage: node sounds.js tts "<text>" --name <event> [--voice <id>] [--variants 2]'); process.exit(1); }
  if (!name) { console.error('--name is required (e.g. --name daily-double)'); process.exit(1); }

  ensureDirs();
  const manifest = loadManifest();

  for (let i = 0; i < variants; i++) {
    const key = nextVariant(name, manifest);
    process.stdout.write(`Generating ${key}…`);
    try {
      const audio = await generateTTS(text, voiceId);
      fs.writeFileSync(candidatePath(key), audio);
      manifest.candidates[key] = { type: 'tts', text, voice: voiceId, created: new Date().toISOString() };
      saveManifest(manifest);
      console.log(` saved → public/sounds/candidates/${key}.mp3`);
    } catch (err) {
      console.error(` failed: ${err.message}`);
    }
  }
}

function cmdPreview(args) {
  const key = args.positional[0];
  if (!key) { console.error('Usage: node sounds.js preview <candidate-key>'); process.exit(1); }

  const manifest = loadManifest();

  // Allow previewing active event names too
  if (KNOWN_EVENTS.includes(key) && manifest.active[key]) {
    playFile(activePath(key));
  } else if (manifest.candidates[key]) {
    playFile(candidatePath(key));
  } else {
    console.error(`Unknown key "${key}". Run "node sounds.js list" to see options.`);
  }
}

function cmdUse(args) {
  const key = args.positional[0];
  if (!key) { console.error('Usage: node sounds.js use <candidate-key>'); process.exit(1); }

  const manifest = loadManifest();
  const candidate = manifest.candidates[key];
  if (!candidate) { console.error(`Candidate "${key}" not found. Run "node sounds.js list" to see options.`); process.exit(1); }

  // Derive event name by stripping trailing -N
  const event = key.replace(/-\d+$/, '');
  ensureDirs();
  fs.copyFileSync(candidatePath(key), activePath(event));
  manifest.active[event] = key;
  saveManifest(manifest);
  console.log(`✓ ${key} → public/sounds/${event}.mp3 (active)`);
}

function cmdClear(args) {
  const event = args.positional[0];
  if (!event) { console.error('Usage: node sounds.js clear <event>'); process.exit(1); }

  const manifest = loadManifest();
  const p = activePath(event);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  delete manifest.active[event];
  saveManifest(manifest);
  console.log(`Cleared active sound for "${event}".`);
}

function cmdList() {
  const manifest = loadManifest();

  console.log('\n── Active sounds ────────────────────────────────────');
  if (Object.keys(manifest.active).length === 0) {
    console.log('  (none)');
  } else {
    for (const [event, key] of Object.entries(manifest.active)) {
      const c = manifest.candidates[key] ?? {};
      const detail = c.type === 'sfx' ? `sfx  "${c.prompt}"` : `tts  "${c.text}"`;
      console.log(`  ${event.padEnd(18)} ← ${key.padEnd(22)} ${detail}`);
    }
  }

  console.log('\n── Candidates ───────────────────────────────────────');
  if (Object.keys(manifest.candidates).length === 0) {
    console.log('  (none)');
  } else {
    for (const [key, c] of Object.entries(manifest.candidates)) {
      const active = Object.values(manifest.active).includes(key) ? ' ✓' : '';
      const detail = c.type === 'sfx'
        ? `sfx  ${c.duration}s  "${c.prompt}"`
        : `tts       "${c.text}"`;
      console.log(`  ${key.padEnd(24)} ${detail}${active}`);
    }
  }

  console.log('\n── Known event names ────────────────────────────────');
  console.log(' ', KNOWN_EVENTS.join('  '));
  console.log('');
}

function cmdHelp() {
  console.log(`
Not Jeopardy — Sound Generator

COMMANDS
  sfx  "<prompt>" --name <event> [--duration <s>] [--variants <n>]
       Generate ambient/effect audio from a text prompt

  tts  "<text>" --name <event> [--voice <id>] [--variants <n>]
       Generate spoken audio using ElevenLabs TTS

  list
       Show all candidates and active sounds

  preview <key>
       Play a candidate or active event sound

  use  <candidate-key>
       Promote a candidate to the active slot for its event

  clear <event>
       Remove the active sound for an event (game falls back to silence)

EVENTS
  ${KNOWN_EVENTS.join('  ')}

EXAMPLES
  node sounds.js sfx "triumphant game show ding, correct answer" --name correct --duration 2 --variants 3
  node sounds.js sfx "harsh buzzer, wrong answer, classic 1970s TV" --name wrong --duration 2
  node sounds.js sfx "exciting daily double fanfare, game show" --name daily-double --duration 3
  node sounds.js tts "Daily Double!" --name daily-double
  node sounds.js tts "Double Jeopardy! Values are now doubled." --name double-jeopardy
  node sounds.js tts "Final Jeopardy!" --name final-jeopardy
  node sounds.js list
  node sounds.js preview correct-2
  node sounds.js use correct-2
  node sounds.js clear correct
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  const [,, cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case 'sfx':     await cmdSFX(args);     break;
    case 'tts':     await cmdTTS(args);     break;
    case 'preview': cmdPreview(args);       break;
    case 'use':     cmdUse(args);           break;
    case 'clear':   cmdClear(args);         break;
    case 'list':    cmdList();              break;
    default:        cmdHelp();              break;
  }
})();
