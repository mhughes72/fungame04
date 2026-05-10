require('dotenv').config();
const express = require('express');
const OpenAI  = require('openai');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set in .env');
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    const avoidCategories = usedCategories.length
      ? `\nDo NOT reuse or closely overlap with these recent category themes: ${usedCategories.slice(-30).join(', ')}.`
      : '';
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      temperature: 1.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user',   content: `Generate 6 diverse, creative Jeopardy category names — mix subjects like history, science, pop culture, language, geography, sports, arts. Avoid the most obvious, overused topics (no generic "World War II", "The Renaissance", "Classic Rock" etc.) — aim for interesting angles and niche subjects.${avoidAnswers}${avoidCategories} For each category also pick the single best domain from: science, history, popculture, sports, arts, geography, food, language, general. Return JSON: { "categories": [{"name": "...", "domain": "..."}, ...] }` },
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

function normaliseAnswer(answer) {
  return answer
    .replace(/\(.*?\)/g, '')           // strip parentheticals
    .replace(/[^a-zA-Z0-9\s'-]/g, '')  // strip punctuation
    .trim()
    .replace(/^(the|a|an)\s+/i, '')    // strip leading articles
    .split(/\s+/).slice(0, 3).join(' ');// keep first 3 words
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

const STOP_WORDS = new Set(['the','a','an','of','in','on','at','to','for','and','or','is','was','are','were','be','been','by','with','as','this','that','it','its']);

function answerLeaksIntoClue(clue, answer) {
  const normalise   = s => s.toLowerCase().replace(/[-]/g, ' ').replace(/[^a-z0-9\s]/g, '');
  const clueWords   = normalise(clue).split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  const answerWords = normalise(answer).split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  // Flag exact matches AND stem overlaps (e.g. "marx" in clue leaks "marxism" as answer)
  return answerWords.some(aw => clueWords.some(cw => aw === cw || aw.includes(cw) || cw.includes(aw)));
}

// Step 2: generate all 5 clues for one category
app.post('/api/category', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const makeRequest = () => client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 700,
    temperature: 1.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a Jeopardy clue writer. Rules:
- Difficulty must escalate clearly: $200 = widely known fact any adult would know; $400 = common knowledge; $600 = requires some study; $800 = requires dedicated interest in the subject; $1000 = specialist/obscure knowledge that only an expert would know. A $1000 clue should be genuinely hard — avoid famous names or well-known works at that value.
- The answer must NEVER appear in the clue text. Before writing each clue, list every word in the answer that is 3+ letters and not an article/preposition — then check none of those words appear anywhere in the clue, including partial matches. This is a hard rule with no exceptions.
  BAD (leaks): Answer is "The Silk Road". Clue: "Ancient traders travelled this overland road connecting China to Europe." — "road" is in the answer.
  GOOD rewrite: "Ancient traders used this network of overland routes linking China to the Mediterranean, carrying spices and textiles." — no word from "Silk Road" appears.
  BAD (leaks): Answer is "Spider-Man". Clue: "This Marvel superhero can shoot webs and climb walls like a spider." — "spider" is in the answer.
  GOOD rewrite: "This Marvel hero gained abilities from a radioactive arachnid bite, letting him scale buildings and shoot sticky threads."
- Clues should be specific and avoid the most obvious facts
- ACCURACY RULE: only state things you are confident are true. Do not invent specific statistics, obscure event outcomes, or niche historical details to make a clue sound interesting — if you are not certain a claim is accurate, describe the answer through its well-established characteristics instead. A clue that is factually safe is better than one that sounds impressive but may be wrong.
Return JSON only.`,
      },
      {
        role: 'user',
        content: (() => {
          const usedAnswers = loadUsedAnswers();
          const avoidClause = usedAnswers.length
            ? `\nDo NOT use any of these recently used answers: ${usedAnswers.slice(-30).join(', ')}.`
            : '';
          return `Write 5 Jeopardy clues for the category "${name}" at values $200, $400, $600, $800, $1000.${avoidClause} Return JSON:
{ "clues": [
  { "value": 200,  "clue": "...", "answer": "..." },
  { "value": 400,  "clue": "...", "answer": "..." },
  { "value": 600,  "clue": "...", "answer": "..." },
  { "value": 800,  "clue": "...", "answer": "..." },
  { "value": 1000, "clue": "...", "answer": "..." }
] }`;
        })(),
      },
    ],
  });

  const rewriteLeakingClue = async (clue) => {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
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
  };

  const factCheckClue = async (clue) => {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a fact-checker for a single Jeopardy clue. Verify every factual claim: nationalities, dates, record counts, event descriptions, attributions. UNCERTAINTY RULE: if you are not fully confident a specific claim is accurate — even if it sounds plausible — rewrite the clue to describe the answer through safer, well-established facts instead. It is better to rewrite than to leave a dubious claim in. If the clue is clearly correct, return it unchanged. Return JSON only.' },
        { role: 'user',   content: `Clue: "${clue.clue}"\nAnswer: "${clue.answer}"\n\nReturn JSON: { "clue": "verified or corrected clue", "changed": true|false }` },
      ],
    });
    const result = JSON.parse(completion.choices[0].message.content);
    return { ...clue, clue: result.clue };
  };

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

// Base miss probability by dollar value for a perfect (accuracy=1.0) player
const BASE_MISS = { 200: 0.05, 400: 0.15, 600: 0.30, 800: 0.45, 1000: 0.60 };

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI Jeopardy running at http://localhost:${PORT}`));
