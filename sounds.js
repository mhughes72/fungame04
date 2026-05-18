#!/usr/bin/env node
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOUNDS_DIR     = path.join(__dirname, 'public', 'sounds');
const CANDIDATES_DIR = path.join(SOUNDS_DIR, 'candidates');
const MANIFEST_FILE  = path.join(SOUNDS_DIR, 'manifest.json'); // served statically

const HOST_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'lQgMO4VKveoqHDCZMAr1';

const KNOWN_EVENTS = [
  'correct', 'correct-voice', 'wrong', 'wrong-voice', 'buzz', 'daily-double',
  'double-jeopardy', 'final-jeopardy', 'timeout', 'game-over',
];

// ── Manifest ──────────────────────────────────────────────────────────────────
// active[event] is always an array of candidate keys.
// Pool of 1 = always plays the same sound. Pool of N = random pick each time.

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); }
  catch { return { candidates: {}, active: {} }; }
}

function saveManifest(m) {
  ensureDirs();
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

// ── ElevenLabs API calls ──────────────────────────────────────────────────────

async function generateSFX(prompt, duration = 3) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set in .env');
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: duration, prompt_influence: 0.4 }),
  });
  if (!res.ok) throw new Error(`ElevenLabs SFX error: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateTTS(text, voiceId = HOST_VOICE_ID) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set in .env');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
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
  if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); return; }
  try {
    if (process.platform === 'win32') execSync(`start "" "${filePath}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`afplay "${filePath}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${filePath}"`, { stdio: 'ignore' });
  } catch {
    console.log(`Could not auto-play. Open manually: ${filePath}`);
  }
}

// ── Arg parser ────────────────────────────────────────────────────────────────

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

// ── Commands ──────────────────────────────────────────────────────────────────

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
      fs.writeFileSync(candidatePath(key), await generateSFX(prompt, duration));
      manifest.candidates[key] = { type: 'sfx', prompt, duration, created: new Date().toISOString() };
      saveManifest(manifest);
      console.log(` saved → candidates/${key}.mp3`);
    } catch (err) { console.error(` failed: ${err.message}`); }
  }
}

async function cmdTTS(args) {
  const text     = args.positional[0];
  const name     = args.flags.name;
  const voiceId  = args.flags.voice ?? HOST_VOICE_ID;
  const variants = parseInt(args.flags.variants ?? 1, 10);
  if (!text) { console.error('Usage: node sounds.js tts "<text>" --name <event> [--voice <id>] [--variants 2]'); process.exit(1); }
  if (!name) { console.error('--name is required (e.g. --name correct-voice)'); process.exit(1); }

  ensureDirs();
  const manifest = loadManifest();
  for (let i = 0; i < variants; i++) {
    const key = nextVariant(name, manifest);
    process.stdout.write(`Generating ${key}…`);
    try {
      fs.writeFileSync(candidatePath(key), await generateTTS(text, voiceId));
      manifest.candidates[key] = { type: 'tts', text, voice: voiceId, created: new Date().toISOString() };
      saveManifest(manifest);
      console.log(` saved → candidates/${key}.mp3`);
    } catch (err) { console.error(` failed: ${err.message}`); }
  }
}

function cmdPreview(args) {
  const key = args.positional[0];
  if (!key) { console.error('Usage: node sounds.js preview <candidate-key>'); process.exit(1); }
  const manifest = loadManifest();
  if (manifest.candidates[key]) { playFile(candidatePath(key)); return; }
  console.error(`Candidate "${key}" not found. Run "node sounds.js list".`);
}

function cmdUse(args) {
  const key = args.positional[0];
  if (!key) { console.error('Usage: node sounds.js use <candidate-key>'); process.exit(1); }
  const manifest = loadManifest();
  if (!manifest.candidates[key]) { console.error(`Candidate "${key}" not found. Run "node sounds.js list".`); process.exit(1); }
  const event = key.replace(/-\d+$/, '');
  manifest.active[event] = [key];
  saveManifest(manifest);
  console.log(`✓ ${key} set as active for "${event}" (pool of 1)`);
}

function cmdAdd(args) {
  const key = args.positional[0];
  if (!key) { console.error('Usage: node sounds.js add <candidate-key>'); process.exit(1); }
  const manifest = loadManifest();
  if (!manifest.candidates[key]) { console.error(`Candidate "${key}" not found. Run "node sounds.js list".`); process.exit(1); }
  const event = key.replace(/-\d+$/, '');
  const pool  = manifest.active[event] ?? [];
  if (pool.includes(key)) { console.log(`"${key}" is already in the pool for "${event}".`); return; }
  pool.push(key);
  manifest.active[event] = pool;
  saveManifest(manifest);
  console.log(`✓ ${key} added to "${event}" pool (${pool.length} total)`);
}

function cmdRemove(args) {
  const key = args.positional[0];
  if (!key) { console.error('Usage: node sounds.js remove <candidate-key>'); process.exit(1); }
  const manifest = loadManifest();
  const event    = key.replace(/-\d+$/, '');
  const pool     = manifest.active[event];
  if (!pool || !pool.includes(key)) { console.error(`"${key}" is not in the active pool for "${event}".`); process.exit(1); }
  manifest.active[event] = pool.filter(k => k !== key);
  if (manifest.active[event].length === 0) delete manifest.active[event];
  saveManifest(manifest);
  console.log(`Removed "${key}" from "${event}" pool.`);
}

function cmdClear(args) {
  const target = args.positional[0];
  if (!target) { console.error('Usage: node sounds.js clear <event|candidate-key>'); process.exit(1); }
  const manifest = loadManifest();

  // Candidate key — delete file and remove from all pools
  if (manifest.candidates[target]) {
    const p = candidatePath(target);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    delete manifest.candidates[target];
    for (const [event, pool] of Object.entries(manifest.active)) {
      const filtered = pool.filter(k => k !== target);
      if (filtered.length !== pool.length) {
        if (filtered.length === 0) delete manifest.active[event];
        else manifest.active[event] = filtered;
        console.log(`Removed from "${event}" pool.`);
      }
    }
    saveManifest(manifest);
    console.log(`Deleted candidate "${target}".`);
    return;
  }

  // Event name — clear the entire pool (keep candidate files)
  if (KNOWN_EVENTS.includes(target)) {
    delete manifest.active[target];
    saveManifest(manifest);
    console.log(`Cleared active pool for "${target}".`);
    return;
  }

  console.error(`"${target}" is not a known candidate or event. Run "node sounds.js list".`);
  process.exit(1);
}

function cmdList() {
  const manifest = loadManifest();

  console.log('\n── Active pools ─────────────────────────────────────');
  if (Object.keys(manifest.active).length === 0) {
    console.log('  (none)');
  } else {
    for (const [event, pool] of Object.entries(manifest.active)) {
      if (pool.length === 1) {
        const c = manifest.candidates[pool[0]] ?? {};
        const detail = c.type === 'sfx' ? `sfx "${c.prompt}"` : `tts "${c.text}"`;
        console.log(`  ${event.padEnd(18)} ${pool[0].padEnd(26)} ${detail}`);
      } else {
        console.log(`  ${event.padEnd(18)} [pool of ${pool.length}]`);
        for (const key of pool) {
          const c = manifest.candidates[key] ?? {};
          const detail = c.type === 'sfx' ? `sfx "${c.prompt}"` : `tts "${c.text}"`;
          console.log(`    ↳ ${key.padEnd(24)} ${detail}`);
        }
      }
    }
  }

  console.log('\n── Candidates ───────────────────────────────────────');
  if (Object.keys(manifest.candidates).length === 0) {
    console.log('  (none)');
  } else {
    const allActive = new Set(Object.values(manifest.active).flat());
    for (const [key, c] of Object.entries(manifest.candidates)) {
      const mark   = allActive.has(key) ? ' ✓' : '';
      const detail = c.type === 'sfx' ? `sfx ${c.duration}s  "${c.prompt}"` : `tts  "${c.text}"`;
      console.log(`  ${key.padEnd(26)} ${detail}${mark}`);
    }
  }

  console.log('\n── Known events ─────────────────────────────────────');
  console.log(' ', KNOWN_EVENTS.join('  '));
  console.log('');
}

function cmdHelp() {
  console.log(`
Not Jeopardy — Sound Generator

COMMANDS
  sfx  "<prompt>" --name <event> [--duration <s>] [--variants <n>]
       Generate an SFX clip from a text prompt

  tts  "<text>" --name <event> [--voice <id>] [--variants <n>]
       Generate a spoken clip using ElevenLabs TTS

  list
       Show all candidates and active pools

  preview <candidate-key>
       Play a candidate file

  use  <candidate-key>
       Set a candidate as the sole active sound for its event (pool of 1)

  add  <candidate-key>
       Add a candidate to the pool for its event (game picks randomly)

  remove <candidate-key>
       Remove a candidate from its event pool (keeps the file)

  clear <event|candidate-key>
       Clear an event pool (keeps files) or delete a candidate entirely

EVENTS
  ${KNOWN_EVENTS.join('  ')}

EXAMPLES
  # SFX
  node sounds.js sfx "triumphant game show ding" --name correct --duration 2 --variants 3
  node sounds.js sfx "harsh wrong answer buzzer, 1970s TV" --name wrong --duration 2

  # TTS pool — generate several takes, add the good ones
  node sounds.js tts "That is correct!" --name correct-voice --variants 5
  node sounds.js preview correct-voice-1
  node sounds.js preview correct-voice-3
  node sounds.js use correct-voice-1
  node sounds.js add correct-voice-3
  node sounds.js add correct-voice-5
  node sounds.js list

  # Manage
  node sounds.js remove correct-voice-3
  node sounds.js clear correct-voice
  node sounds.js clear correct-voice-2
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  const [,, cmd, ...rest] = process.argv;
  const args = parseArgs(rest);
  switch (cmd) {
    case 'sfx':     await cmdSFX(args);  break;
    case 'tts':     await cmdTTS(args);  break;
    case 'preview': cmdPreview(args);    break;
    case 'use':     cmdUse(args);        break;
    case 'add':     cmdAdd(args);        break;
    case 'remove':  cmdRemove(args);     break;
    case 'clear':   cmdClear(args);      break;
    case 'list':    cmdList();           break;
    default:        cmdHelp();           break;
  }
})();
