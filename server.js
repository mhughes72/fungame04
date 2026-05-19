require('dotenv').config();
const express = require('express');
const OpenAI  = require('openai');
const { wrapOpenAI } = require('langsmith/wrappers');
const path    = require('path');
const fs      = require('fs');
const { normaliseAnswer, answerLeaksIntoClue } = require('./utils');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set in .env');
  process.exit(1);
}

const client = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// Parse --dev flag — enables sound manager UI and write APIs
const DEV_MODE = process.argv.includes('--dev') || process.env.DEV === '1';
if (DEV_MODE) console.log('Dev mode: sound manager enabled');

// Block sounds-manager.html in production before static middleware handles it
if (!DEV_MODE) {
  app.get('/sounds-manager.html', (req, res) => res.status(404).send('Not found'));
}

// Parse --players "Name1,Name2" from CLI args, or fall back to PLAYERS env var
const playersFlagIdx = process.argv.indexOf('--players');
const selectedNames  = playersFlagIdx !== -1
  ? process.argv[playersFlagIdx + 1].split(',').map(s => s.trim())
  : process.env.PLAYERS
    ? process.env.PLAYERS.split(',').map(s => s.trim())
    : null;

if (selectedNames) console.log(`Players: You + ${selectedNames.join(', ')}`);

app.get('/api/players', (req, res) => {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'players.json'), 'utf8'));
  if (!selectedNames) return res.json(all);
  const filtered = all.filter(p => p.isHuman || selectedNames.includes(p.name));
  res.json(filtered);
});

// Step 1: generate category names only (fast)
app.get('/api/categories', async (req, res) => {
  try {
    const usedAnswers     = loadUsedAnswers();
    const usedCategories  = loadUsedCategories();
    const avoidAnswers    = usedAnswers.length
      ? `\nIMPORTANT: The following answers have appeared recently — do NOT design categories that would rely heavily on them: ${usedAnswers.slice(-30).join(', ')}.`
      : '';
    const avoidCategories = avoidCategoriesClause(usedCategories);
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      temperature: 1.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user',   content: `Generate 6 diverse, creative Jeopardy category names — mix subjects like history, science, pop culture, language, geography, sports, arts. Aim for interesting, unusual angles rather than generic topics. Avoid categories where writing accurate clues would require knowing specific statistics, founding dates, or technical records about obscure subjects (e.g. avoid "Football Leagues Beyond the NFL" or "Space Food Facts" — these force precise niche facts). Good niche categories describe things through their general characteristics and context; bad ones require memorising obscure data. Also avoid the most overused topics (no generic "World War II", "The Renaissance", "Classic Rock" etc.). IMPORTANT: Do NOT generate these category types — they reliably produce hallucinated clues: (1) Abstract word-puzzle categories (palindromes, anagrams, portmanteaus, cryptic wordplay, spoonerisms) — answers defined only by spelling or sound patterns force the model to invent fake meanings. (2) Etymology categories (word origins, language roots, etymologies) — word origin claims are notoriously unreliable and hard to verify. (3) Fictional mashup categories that invite inventing things that don't exist (e.g. "Foods Inspired by the Cosmos", "Cocktails Named After Scientists", "Dishes from Fictional Worlds") — these encourage fabrication of fake food names, fake events, or fake associations rather than description of real things.${avoidAnswers}${avoidCategories} CATEGORY NAME FORMAT: Keep names short — 2 to 5 words maximum. Do NOT use a colon, subtitle, or descriptive clause (e.g. NOT "Coastal Cultures: How the Sea Shapes Societies" — just "Coastal Cultures"). Think classic Jeopardy style: "Potent Potables", "Before & After", "US Presidents", "Movie Monsters". For each category also pick the single best domain from: science, history, popculture, sports, arts, geography, food, language, general. Return JSON: { "categories": [{"name": "...", "domain": "..."}, ...] }` },
      ],
    });
    const json = JSON.parse(completion.choices[0].message.content);
    // Record category names for future exclusion
    const names = (json.categories ?? []).map(c => (typeof c === 'object' ? c.name : c).toLowerCase());
    if (names.length) recordCategories(names);
    res.json(json);
  } catch (err) {
    console.error('Categories error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Persistent answer history to avoid repeating famous answers across games
const USED_ANSWERS_FILE    = path.join(__dirname, 'used-answers.json');
const USED_CATEGORIES_FILE = path.join(__dirname, 'used-categories.json');
const MAX_USED_ANSWERS     = 200;
const MAX_USED_CATEGORIES  = 60;

function loadUsedAnswers() {
  try { return JSON.parse(fs.readFileSync(USED_ANSWERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsedAnswers(list) {
  fs.writeFileSync(USED_ANSWERS_FILE, JSON.stringify(list, null, 2));
}

function loadUsedCategories() {
  try { return JSON.parse(fs.readFileSync(USED_CATEGORIES_FILE, 'utf8')); } catch { return []; }
}

function recordCategories(names) {
  const list    = loadUsedCategories();
  const updated = [...new Set([...list, ...names])].slice(-MAX_USED_CATEGORIES);
  fs.writeFileSync(USED_CATEGORIES_FILE, JSON.stringify(updated, null, 2));
}

function recordAnswers(answers) {
  const list = loadUsedAnswers();
  const normalised = answers.map(normaliseAnswer).filter(Boolean);
  const updated = [...new Set([...list, ...normalised])].slice(-MAX_USED_ANSWERS);
  saveUsedAnswers(updated);
}

app.post('/api/record-answers', (req, res) => {
  const { answers } = req.body;
  if (Array.isArray(answers)) recordAnswers(answers);
  res.json({ ok: true });
});

function avoidAnswersClause(list) {
  return list.length ? `\nDo NOT use any of these recently used answers: ${list.slice(-30).join(', ')}.` : '';
}

function avoidCategoriesClause(list) {
  return list.length ? `\nDo NOT reuse or closely overlap with these recent category themes: ${list.slice(-30).join(', ')}.` : '';
}

async function rewriteLeakingClue(clue) {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 200,
    temperature: 0.9,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a Jeopardy clue writer. Rewrite the given clue so that no word from the answer (3+ letters, ignoring articles/prepositions) appears anywhere in the clue text. Keep the same answer, category feel, and difficulty. Return JSON only.' },
      { role: 'user',   content: `Answer: "${clue.answer}"\nLeaking clue: "${clue.clue}"\n\nReturn JSON: { "clue": "rewritten clue here" }` },
    ],
  });
  const result = JSON.parse(completion.choices[0].message.content);
  return { ...clue, clue: result.clue };
}

async function factCheckClue(clue) {
  const completion = await client.chat.completions.create({
    model: 'o4-mini',
    max_completion_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an independent fact-checker for Jeopardy clues. The clue was written by a different AI model — your job is to verify it skeptically, not confirm it. Return JSON only.' },
      { role: 'user',   content: `Clue: "${clue.clue}"\nAnswer: "${clue.answer}"\n\nStep 1: List every specific factual claim in the clue (album/track names, release dates, chart positions, biographical details, scientific classifications, attributions, nationalities, record counts, geographic facts).\nStep 2: Verify each claim. Be especially skeptical of: specific album or track attributions, song release dates and chart positions, details about non-famous historical figures, and word or language claims.\nStep 3: If every claim is clearly correct and verifiable from a mainstream encyclopedia, return the clue unchanged. If you have ANY doubt about a claim, rewrite the clue to use only well-established, widely-known facts about the answer instead — it is better to rewrite than to leave a dubious claim in.\n\nReturn JSON: { "clue": "verified or rewritten clue", "changed": true|false }` },
    ],
  });
  const result = JSON.parse(completion.choices[0].message.content);
  if (result.changed) console.log(`  fact-check rewrote clue for "${clue.answer}"`);
  return { ...clue, clue: result.clue };
}

// Step 2: generate all 5 clues for one category
app.post('/api/category', async (req, res) => {
  const { name, round = 1 } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const makeRequest = () => client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 700,
    temperature: 1.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a Jeopardy clue writer. Rules:
${round === 2
  ? '- This is Double Jeopardy. All clues should skew harder than a standard round. $400 = requires some study; $800 = requires dedicated interest; $1200 = specialist knowledge; $1600 = expert-level; $2000 = only a true authority would know this. Avoid anything a casual fan of the subject would know.'
  : '- Difficulty must escalate clearly: $200 = widely known fact any adult would know; $400 = common knowledge; $600 = requires some study; $800 = requires dedicated interest in the subject; $1000 = specialist/obscure knowledge that only an expert would know. A $1000 clue should be genuinely hard — avoid famous names or well-known works at that value.'}
- The answer must NEVER appear in the clue text. Before writing each clue, list every word in the answer that is 3+ letters and not an article/preposition — then check none of those words appear anywhere in the clue, including partial matches. This is a hard rule with no exceptions.
  BAD (leaks): Answer is "The Silk Road". Clue: "Ancient traders travelled this overland road connecting China to Europe." — "road" is in the answer.
  GOOD rewrite: "Ancient traders used this network of overland routes linking China to the Mediterranean, carrying spices and textiles." — no word from "Silk Road" appears.
  BAD (leaks): Answer is "Spider-Man". Clue: "This Marvel superhero can shoot webs and climb walls like a spider." — "spider" is in the answer.
  GOOD rewrite: "This Marvel hero gained abilities from a radioactive arachnid bite, letting him scale buildings and shoot sticky threads."
- Clues should be specific and avoid the most obvious facts
- ACCURACY RULE: only state things you are confident would appear in a mainstream encyclopedia. Do not invent specific statistics, obscure event outcomes, niche historical details, or specialist classifications to make a clue sound interesting. Ask yourself: "would a Wikipedia article on this subject clearly state this claim?" If not, describe the answer through its well-established, widely-known characteristics instead. A clue that is factually safe is better than one that sounds impressive but may be wrong.
Return JSON only.`,
      },
      {
        role: 'user',
        content: (() => {
          const avoidClause = avoidAnswersClause(loadUsedAnswers());
          const valueList = round === 2 ? '$400, $800, $1200, $1600, $2000' : '$200, $400, $600, $800, $1000';
          const clueValues = round === 2 ? [400, 800, 1200, 1600, 2000] : [200, 400, 600, 800, 1000];
          return `Write 5 Jeopardy clues for the category "${name}" at values ${valueList}.${avoidClause} Return JSON:
{ "clues": [
  { "value": ${clueValues[0]}, "clue": "...", "answer": "..." },
  { "value": ${clueValues[1]}, "clue": "...", "answer": "..." },
  { "value": ${clueValues[2]}, "clue": "...", "answer": "..." },
  { "value": ${clueValues[3]}, "clue": "...", "answer": "..." },
  { "value": ${clueValues[4]}, "clue": "...", "answer": "..." }
] }`;
        })(),
      },
    ],
  });

  try {
    const completion = await makeRequest();
    let clues = JSON.parse(completion.choices[0].message.content).clues || [];

    // Fix leaking clues with targeted per-clue rewrites (up to 5 attempts each)
    for (let attempt = 0; attempt < 5; attempt++) {
      const leaking = clues.filter(c => answerLeaksIntoClue(c.clue, c.answer));
      if (leaking.length === 0) break;
      console.warn(`Attempt ${attempt + 1}: rewriting ${leaking.length} leaking clue(s) individually…`);
      clues = await Promise.all(clues.map(c =>
        answerLeaksIntoClue(c.clue, c.answer) ? rewriteLeakingClue(c) : Promise.resolve(c)
      ));
    }

    // Fact-check all clues in parallel
    try {
      clues = await Promise.all(clues.map(factCheckClue));
    } catch (err) {
      console.warn(`Fact-check failed for "${name}", using unverified clues:`, err.message);
    }

    res.json({ clues });
  } catch (err) {
    console.error(`Category "${name}" error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate one Final Jeopardy clue
app.get('/api/final-jeopardy', async (req, res) => {
  try {
    const avoidAnswers    = avoidAnswersClause(loadUsedAnswers());
    const avoidCategories = avoidCategoriesClause(loadUsedCategories());

    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a Final Jeopardy clue writer. Return JSON only.' },
        { role: 'user',   content: `Generate one Final Jeopardy category and clue. Final Jeopardy clues are harder than regular $1000 clues — they require broad but deep knowledge, are unambiguous, and are well-known enough that a well-read adult has a real chance. Choose a broad, prestigious category (e.g. "American History", "World Literature", "Science & Nature", "Classic Films") rather than niche. The answer must NEVER appear in the clue text. Every factual claim must be encyclopedically verifiable — apply the Wikipedia standard.${avoidAnswers}${avoidCategories} Return JSON: { "category": "...", "clue": "...", "answer": "..." }` },
      ],
    });

    let fj = JSON.parse(completion.choices[0].message.content);

    // Fact-check
    try { fj = { ...fj, ...(await factCheckClue(fj)) }; }
    catch (e) { console.warn('FJ fact-check failed:', e.message); }

    // Leak check with up to 5 rewrites
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!answerLeaksIntoClue(fj.clue, fj.answer)) break;
      try { const r = await rewriteLeakingClue(fj); fj.clue = r.clue; }
      catch { break; }
    }

    res.json(fj);
  } catch (err) {
    console.error('Final Jeopardy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Base miss probability by dollar value for a perfect (accuracy=1.0) player
const BASE_MISS = { 200: 0.03, 400: 0.10, 600: 0.20, 800: 0.32, 1000: 0.45 };

// Generate an AI player's answer
app.post('/api/ai-answer', async (req, res) => {
  const { clue, category, value, accuracy = 1.0, clarification = false, previousAnswer = '', wrongAnswers = [], domain = 'general', specialties = {} } = req.body;
  const specialtyMod      = specialties[domain] ?? 1.0;
  const effectiveAccuracy = Math.min(1.0, accuracy * specialtyMod);

  try {
    let messages;

    if (clarification) {
      // AI was asked to be more specific — no miss chance, just give the full specific answer
      messages = [
        { role: 'system', content: 'You are a Jeopardy contestant who was asked to be more specific. Give a more complete, specific version of your previous answer. No explanation, just the answer itself.' },
        { role: 'user',   content: `Category: ${category} ($${value})\nClue: ${clue}\nYou said: "${previousAnswer}"\nGive a more specific answer.` },
      ];
    } else {
      const base       = BASE_MISS[value] ?? 0.2;
      const missChance = 1 - (effectiveAccuracy * (1 - base));
      const shouldMiss = Math.random() < missChance;
      messages = [
        {
          role: 'system',
          content: shouldMiss
            ? 'You are a Jeopardy contestant who is unsure of this one. Give a plausible but incorrect answer — same category and era as the right answer, but wrong. No explanation, just the answer itself.'
            : 'You are a Jeopardy contestant. Give only your answer — no explanation, no "What is", just the answer itself.',
        },
        { role: 'user', content: `Category: ${category} ($${value})\nClue: ${clue}${wrongAnswers.length ? `\nPrevious wrong answers (do not repeat these): ${wrongAnswers.join(', ')}` : ''}\nWhat is your answer?` },
      ];
    }

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 64,
      temperature: clarification ? 0.3 : 0.4,
      messages,
    });
    res.json({ answer: completion.choices[0].message.content.trim() });
  } catch (err) {
    console.error('AI answer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Strip false starts from player answers: "Star Wars.. No Back to the Future" → "Back to the Future"
function stripFalseStart(answer) {
  if (!answer) return answer;
  // Match patterns like "X... no Y", "X, no Y", "X wait Y", "X actually Y", "X no wait Y"
  const correctionMatch = answer.match(/^.+?(?:\.\.\.|,)?\s*(?:no[,.]?\s*(?:wait\s*)?|wait[,.]?\s*(?:no\s*)?|actually[,.]?\s*)(.+)$/i);
  return correctionMatch ? correctionMatch[1].trim() : answer;
}

// Judge a player's spoken answer
app.post('/api/judge', async (req, res) => {
  const { clue, correctAnswer, clarification } = req.body;
  const playerAnswer = stripFalseStart(req.body.playerAnswer);
  if (!clue || !correctAnswer) return res.status(400).json({ error: 'Missing fields' });

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: clarification
            ? `You are a Jeopardy judge delivering a final verdict on a clarification answer. The player was asked to be more specific because their surname was ambiguous. Rules:
- Accept if the answer unambiguously identifies the correct person — missing middle initials, common nicknames, and minor spelling variants are fine (e.g. "Franklin Roosevelt" or "FDR" are correct for "Franklin D. Roosevelt")
- Reject if the answer names a different person who shares the surname (e.g. "Teddy Roosevelt" is wrong for "Franklin D. Roosevelt")
- Do not ask for further clarification — this is the final verdict
- Do not reveal the correct answer if wrong, and do not suggest trying again
- Keep feedback very short: "Correct!" for right answers, "Incorrect." for wrong ones — no explanation
Return JSON: { "correct": boolean, "needsClarification": false, "message": string }`
            : `You are a lenient Jeopardy judge. Rules:
- Accept reasonable variations: nicknames, minor spelling differences, plural/singular, and surnames alone when they unambiguously identify one person.
- DEMONYM/ADJECTIVAL RULE: always accept adjectival or demonym forms as correct. Examples: "Egyptian" for "Ancient Egypt", "French" for "France", "Victorian" for "Victorian Era", "Roman" for "Ancient Rome". These are correct answers.
- If the player gives a first AND last name, both must identify the correct person — a wrong first name with the right surname (e.g. "Teddy Roosevelt" when the answer is "Franklin Roosevelt") is incorrect, not a partial match.
- Self-correction rule: if the player explicitly corrects themselves mid-answer (e.g. "Smith... No, Mandella" or "Lincoln, wait no, Washington"), judge ONLY the final corrected answer and ignore the earlier false start.
- Speech recognition rule: this is a voice-controlled game, so the player's answer comes from speech-to-text and may be mishearing the name they intended. If the player's answer sounds phonetically like the correct answer (same syllable pattern, similar vowels/consonants) AND the clue clearly points to that person, treat it as a speech recognition error and mark it correct. Examples: "Lenin" → "Lennon", "Mayor" → "Mayer", "Frood" → "Freud", "Pluto" → "Plutarch". Do not penalise a player for what is clearly a microphone mishearing of the right answer.
- Ignore "What is" / "Who is" phrasing.
- CRITICAL: The "message" field must NEVER contain the correct answer or any part of it — not the name, not a hint, not a partial match. Other players may still buzz in. For wrong answers the message must be a generic phrase only, such as "That is incorrect." or "Sorry, that's wrong." — nothing else.
- CLARIFICATION RULE: only applies when the player gave a bare surname with NO first name or initial. If they gave a first name (even abbreviated or informal), accept or reject outright — do not ask for clarification. For bare surnames only: ask yourself whether that surname belongs to more than one distinct, well-known person in general knowledge. If yes, set needsClarification=true. Examples that always need clarification: "Roosevelt" (Theodore vs Franklin), "Kennedy" (John vs Robert), "Adams" (John vs John Quincy), "Johnson" (Andrew vs Lyndon), "Bush" (George H.W. vs George W.), "Brontë" (Charlotte vs Emily). Only accept a bare surname without clarification when it uniquely identifies one person (e.g. "Einstein", "Shakespeare", "Beyoncé").
Return JSON with fields: "correct" (boolean), "needsClarification" (boolean), "message" (one sentence).`,
        },
        {
          role: 'user',
          content: `Clue: ${clue}\nCorrect answer: ${correctAnswer}\nPlayer said: "${playerAnswer || ''}"\n\nReturn JSON with fields: "correct" (boolean), "needsClarification" (boolean), and "message" (brief judge feedback).`,
        },
      ],
    });

    const json = JSON.parse(completion.choices[0].message.content);
    res.json(json);
  } catch (err) {
    console.error('Judge error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Host commentary ──────────────────────────────────────────────────────────
const HOST_SYSTEM = `You are Chuck Pendleton, the charismatic host of "Definitely Not an AI Rip-Off of Jeopardy!", a late-1970s network television game show.
Speak in exactly one short sentence. Punchy, warm, slightly cheesy — classic wide-lapel-suit game show host energy.
React specifically and entertainingly to the situation you're given.
Never say "Great job", "Well done", "Fantastic", or any other generic praise. Never be boring.`;

const HOST_PROMPTS = {
  correct_notable: ({ player, category, value }) =>
    `${player} just correctly answered a $${value} clue in the category "${category}". React with host energy — brief, specific, a little theatrical.`,

  wrong_easy: ({ player, category, value }) =>
    `${player} just got the $${value} clue in "${category}" wrong — one of the easier ones on the board. React with gentle commiseration and a touch of disbelief.`,

  fj_wager: ({ player, wager, score }) =>
    `${player} (current score: $${score.toLocaleString()}) just locked in a Final Jeopardy wager of $${wager.toLocaleString()}. React as a game show host revealing this wager to the studio audience.`,

  game_over: ({ winner, score }) =>
    `${winner} just won the game with a final score of $${score.toLocaleString()}. Give a warm, slightly over-the-top game show closing line. One sentence.`,
};

app.post('/api/host-comment', async (req, res) => {
  const { event, context = {} } = req.body;
  if (!HOST_PROMPTS[event]) return res.status(400).json({ error: 'Unknown event' });

  try {
    const completion = await client.chat.completions.create({
      model:       'gpt-4o-mini',
      max_tokens:  80,
      temperature: 0.9,
      messages: [
        { role: 'system', content: HOST_SYSTEM },
        { role: 'user',   content: HOST_PROMPTS[event](context) },
      ],
    });
    res.json({ line: completion.choices[0].message.content.trim().replace(/^"|"$/g, '') });
  } catch (err) {
    console.error('Host comment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Host TTS (ElevenLabs text-to-speech) ─────────────────────────────────────
const HOST_VOICE_ID = 'lQgMO4VKveoqHDCZMAr1'; // custom host voice

app.get('/api/tts', async (req, res) => {
  const { text } = req.query;
  if (!text) return res.status(400).json({ error: 'Missing text' });
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'No ElevenLabs key' });

  try {
    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${HOST_VOICE_ID}`, {
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

    if (!elRes.ok) {
      const msg = await elRes.text();
      console.error(`ElevenLabs TTS error for "${text}":`, msg);
      return res.status(502).json({ error: msg });
    }

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    const buf = await elRes.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('TTS fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── Sound manager API ─────────────────────────────────────────────────────────
const CANDIDATES_DIR = path.join(__dirname, 'public', 'sounds', 'candidates');
const SOUNDS_MANIFEST = path.join(__dirname, 'public', 'sounds', 'manifest.json');

app.get('/api/sounds/manifest', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(SOUNDS_MANIFEST, 'utf8'))); }
  catch { res.json({ candidates: {}, active: {} }); }
});

const devOnly = (req, res, next) =>
  DEV_MODE ? next() : res.status(403).json({ error: 'Sound manager not available in production. Start server with --dev.' });

app.put('/api/sounds/manifest', devOnly, (req, res) => {
  try {
    fs.mkdirSync(path.dirname(SOUNDS_MANIFEST), { recursive: true });
    fs.writeFileSync(SOUNDS_MANIFEST, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sounds/candidates/:key', devOnly, (req, res) => {
  const key = req.params.key.replace(/[^a-z0-9\-]/gi, '');
  const p   = path.join(CANDIDATES_DIR, `${key}.mp3`);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sounds/generate', devOnly, async (req, res) => {
  const { type, prompt, text, duration = 3, voice = HOST_VOICE_ID } = req.body;
  if (!type) return res.status(400).json({ error: 'Missing type' });
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'No ElevenLabs key' });

  let manifest = { candidates: {}, active: {} };
  try { manifest = JSON.parse(fs.readFileSync(SOUNDS_MANIFEST, 'utf8')); } catch {}

  const base = type === 'sfx' ? 'sfx' : 'tts';
  let n = 1;
  while (manifest.candidates[`${base}-${n}`]) n++;
  const key = `${base}-${n}`;

  try {
    let audioBuf;
    if (type === 'sfx') {
      const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: prompt, duration_seconds: duration, prompt_influence: 0.4 }),
      });
      if (!r.ok) throw new Error(await r.text());
      audioBuf = Buffer.from(await r.arrayBuffer());
    } else {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.55, similarity_boost: 0.75 } }),
      });
      if (!r.ok) throw new Error(await r.text());
      audioBuf = Buffer.from(await r.arrayBuffer());
    }

    fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
    fs.writeFileSync(path.join(CANDIDATES_DIR, `${key}.mp3`), audioBuf);

    manifest.candidates[key] = type === 'sfx'
      ? { type: 'sfx', prompt, duration, created: new Date().toISOString() }
      : { type: 'tts', text, voice, created: new Date().toISOString() };
    fs.mkdirSync(path.dirname(SOUNDS_MANIFEST), { recursive: true });
    fs.writeFileSync(SOUNDS_MANIFEST, JSON.stringify(manifest, null, 2));

    res.json({ key });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI Jeopardy running at http://localhost:${PORT}`));
