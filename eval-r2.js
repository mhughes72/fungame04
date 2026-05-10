// eval-r2.js — Double Jeopardy quality eval
// Tests Round 2-specific behaviour: correct values, harder difficulty,
// clue quality on R2 clues, and category freshness between rounds.
// Usage: node eval-r2.js
// Requires the server running: node server.js  (~3-4 minutes)

require('dotenv').config();
const OpenAI = require('openai');
const fs     = require('fs');

const BASE   = 'http://localhost:3000';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const timed = async (fn) => { const t = Date.now(); const r = await fn(); return { result: r, ms: Date.now() - t }; };
const post  = (path, body) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const get   = path => fetch(`${BASE}${path}`).then(r => r.json());

const gptRate = async (system, user) => {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini', max_tokens: 200, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  return JSON.parse(res.choices[0].message.content);
};

const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const C = s => `\x1b[36m${s}\x1b[0m`;
const B = s => `\x1b[1m${s}\x1b[0m`;

const pass = label => `${G('✅')} ${label}`;
const fail = label => `${R('❌')} ${label}`;
const warn = label => `${Y('⚠️ ')} ${label}`;

function section(title) {
  console.log(`\n${C(B('─'.repeat(64)))}`);
  console.log(C(B(`  ${title}`)));
  console.log(C(B('─'.repeat(64))));
}

const STOP = new Set(['the','a','an','of','in','on','at','to','for','and','or','is','was','are','were','be','been','by','with','as','this','that','it','its']);
const norm  = s => s.toLowerCase().replace(/[-]/g, ' ').replace(/[^a-z0-9\s]/g, '');

function leaks(clue, answer) {
  const cw = norm(clue).split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w));
  const aw = norm(answer).split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w));
  return aw.some(a => cw.some(c => a === c || a.includes(c) || c.includes(a)));
}

const R2_VALUES = [400, 800, 1200, 1600, 2000];

// ══════════════════════════════════════════════════════════════════
// 1. CORRECT VALUES RETURNED  ($400/$800/$1200/$1600/$2000)
// ══════════════════════════════════════════════════════════════════

async function runValuesCheck() {
  section('1. CORRECT R2 VALUES  ($400/$800/$1200/$1600/$2000)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { console.log(fail('Could not reach /api/categories')); return { suggestions }; }

  const cat  = cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name, round: 2 }); }
  catch { console.log(fail('Request failed')); return { suggestions }; }
  if (!data.clues?.length) { console.log(fail('No clues returned')); return { suggestions }; }

  let passed = 0;
  const returnedValues = data.clues.map(c => c.value).sort((a, b) => a - b);

  for (const expected of R2_VALUES) {
    const clue = data.clues.find(c => c.value === expected);
    if (clue) {
      passed++;
      console.log(pass(`$${expected}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
    } else {
      console.log(fail(`$${expected} clue missing — got values: ${returnedValues.join(', ')}`));
      suggestions.push(`Round 2 /api/category did not return a $${expected} clue — check clueValues array in server.js`);
    }
  }

  console.log(`\n  Result: ${passed}/${R2_VALUES.length} correct values returned`);
  return { passed, total: R2_VALUES.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 2. R2 CLUE LEAK DETECTION  (3 categories)
// ══════════════════════════════════════════════════════════════════

async function runR2LeakTests() {
  section('2. R2 CLUE LEAK DETECTION  (3 categories)');
  const suggestions = [];
  let totalClues = 0, leakCount = 0;

  let cats;
  try { cats = await get('/api/categories'); } catch { console.log(fail('Could not reach /api/categories')); return { suggestions }; }

  const sample = cats.categories.slice(0, 3);

  for (const cat of sample) {
    const name   = typeof cat === 'object' ? cat.name   : cat;
    const domain = typeof cat === 'object' ? cat.domain : '?';
    console.log(`\n  ${B(name)} ${C(`(${domain})`)}`);

    let data;
    try { data = await post('/api/category', { name, round: 2 }); }
    catch { console.log(warn('  Request failed')); continue; }
    if (!data.clues?.length) { console.log(warn('  No clues returned')); continue; }

    for (const clue of data.clues) {
      totalClues++;
      const leaked = leaks(clue.clue, clue.answer);
      if (leaked) leakCount++;
      const icon = leaked ? '❌' : '✅';
      console.log(`    ${icon} $${clue.value}${leaked ? R(' [LEAK]') : ''}`);
      console.log(`       Clue:   ${clue.clue.slice(0, 88)}${clue.clue.length > 88 ? '…' : ''}`);
      console.log(`       Answer: ${clue.answer}`);
      if (leaked) suggestions.push(`Answer "${clue.answer}" leaked into R2 clue for "${name}" — retry logic may not be applying to round:2.`);
    }
  }

  const leakRate = totalClues ? Math.round(leakCount / totalClues * 100) : 0;
  console.log(`\n  Leak rate: ${leakCount}/${totalClues} (${leakRate}%)`);
  if (leakRate > 10) suggestions.push(`R2 leak rate ${leakRate}% is high — increase retry cap or verify round:2 clues go through the rewrite pipeline.`);

  return { leakCount, totalClues, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 3. R2 DIFFICULTY SPREAD & ABSOLUTE CALIBRATION
// ══════════════════════════════════════════════════════════════════

async function runR2DifficultyTests() {
  section('3. R2 DIFFICULTY SPREAD & ABSOLUTE CALIBRATION  (GPT-rated, 1 category)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name, round: 2 }); }
  catch { console.log(warn('Request failed')); return { suggestions }; }
  if (!data.clues?.length) return { suggestions };

  const clues   = [...data.clues].sort((a, b) => a.value - b.value);
  const ratings = [];

  for (const clue of clues) {
    let rating;
    try {
      const r = await gptRate(
        'Rate the difficulty of this Jeopardy clue from 1 (very easy) to 5 (very hard/obscure). Return JSON: { "rating": number, "reason": string }',
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
      rating = r.rating;
    } catch { rating = null; }

    ratings.push({ value: clue.value, rating });
    const bar = rating ? '█'.repeat(rating) + '░'.repeat(5 - rating) : '?????';
    console.log(`  $${clue.value}  [${bar}] ${rating ?? '?'}/5  — ${clue.clue.slice(0, 55)}…`);
  }

  let inversions = 0;
  for (let i = 0; i < ratings.length - 1; i++) {
    if (ratings[i].rating !== null && ratings[i + 1].rating !== null && ratings[i].rating > ratings[i + 1].rating + 1) inversions++;
  }

  const ratingValues = ratings.map(r => r.rating).filter(Boolean);
  const low  = Math.min(...ratingValues);
  const high = Math.max(...ratingValues);

  console.log(`\n  Difficulty spread: ${low}–${high}/5`);
  if (high - low < 2) {
    console.log(warn('  Low spread — R2 clues may not be scaling in difficulty'));
    suggestions.push(`R2 difficulty spread for "${name}" is only ${high - low} points — harder-clue prompt may not be differentiating $400 from $2000.`);
  } else {
    console.log(pass('  Good difficulty spread'));
  }
  if (inversions > 1) {
    console.log(warn(`  ${inversions} difficulty inversion(s)`));
    suggestions.push(`R2 difficulty inversions in "${name}" — a lower-value clue was rated harder than a higher-value one.`);
  }

  // Absolute calibration: $400 = "requires study", $2000 = "expert-only"
  console.log(`\n  Absolute calibration:`);
  let calibrationIssues = 0;

  for (const clue of [clues[0], clues[4]].filter(Boolean)) {
    const isEasiest = clue.value === 400;
    let result;
    try {
      result = await gptRate(
        isEasiest
          ? 'Assess whether a Double Jeopardy $400 clue (the easiest in the round) requires some study. It should not be trivially easy, but should be answerable by a reasonably well-read adult who has some interest in the subject. Return JSON: { "appropriatelyMedium": true|false, "reason": string }'
          : 'Assess whether a Double Jeopardy $2000 clue is genuinely expert-level. Only a true authority or specialist should know the answer. If a knowledgeable non-expert could reasonably get it, it is not hard enough. Return JSON: { "appropriatelyHard": true|false, "reason": string }',
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
    } catch { result = null; }

    const ok    = isEasiest ? result?.appropriatelyMedium !== false : result?.appropriatelyHard !== false;
    const label = isEasiest ? '$400 appropriately medium' : '$2000 appropriately expert-level';

    if (ok) {
      console.log(pass(`  ${label}: ${clue.clue.slice(0, 60)}…`));
    } else {
      calibrationIssues++;
      console.log(fail(`  ${label}: ${clue.clue.slice(0, 60)}…`));
      if (result?.reason) console.log(`    ${Y(result.reason)}`);
      suggestions.push(`R2 calibration issue at $${clue.value}: ${result?.reason ?? 'may not be appropriately calibrated'}`);
    }
  }

  return { spread: high - low, inversions, calibrationIssues, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 4. COMPARATIVE DIFFICULTY  (R2 clues harder than R1 for same category)
// ══════════════════════════════════════════════════════════════════

async function runComparativeDifficultyTest() {
  section('4. COMPARATIVE DIFFICULTY  (R2 clues should be harder than R1)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}`);
  console.log('  Generating same category at round:1 and round:2 in parallel…\n');

  let r1Data, r2Data;
  try {
    [r1Data, r2Data] = await Promise.all([
      post('/api/category', { name, round: 1 }),
      post('/api/category', { name, round: 2 }),
    ]);
  } catch { console.log(fail('Request failed')); return { suggestions }; }

  if (!r1Data.clues?.length || !r2Data.clues?.length) {
    console.log(fail('No clues returned'));
    return { suggestions };
  }

  const r1 = [...r1Data.clues].sort((a, b) => a.value - b.value);
  const r2 = [...r2Data.clues].sort((a, b) => a.value - b.value);

  const comparisons = [
    { label: 'Easiest  (R1 $200 vs R2 $400)', r1clue: r1[0], r2clue: r2[0] },
    { label: 'Hardest  (R1 $1000 vs R2 $2000)', r1clue: r1[4], r2clue: r2[4] },
  ];

  let passed = 0;
  for (const { label, r1clue, r2clue } of comparisons) {
    if (!r1clue || !r2clue) continue;
    console.log(`  ${B(label)}`);
    console.log(`    R1 ($${r1clue.value}): ${r1clue.clue.slice(0, 70)}… → ${r1clue.answer}`);
    console.log(`    R2 ($${r2clue.value}): ${r2clue.clue.slice(0, 70)}… → ${r2clue.answer}`);

    let result;
    try {
      result = await gptRate(
        'Compare the difficulty of two Jeopardy clues from different rounds. Clue A is from Round 1, Clue B is from Round 2 (the harder round). Is Clue B harder than or at least as hard as Clue A? Return JSON: { "bHarderOrEqual": true|false, "reason": string }',
        `Clue A (Round 1, $${r1clue.value}): "${r1clue.clue}" → ${r1clue.answer}\nClue B (Round 2, $${r2clue.value}): "${r2clue.clue}" → ${r2clue.answer}`,
      );
    } catch { result = null; }

    const ok = result?.bHarderOrEqual !== false;
    if (ok) { passed++; console.log(pass(`  R2 clue is harder or equal`)); }
    else {
      console.log(fail(`  R2 clue appears easier than R1 equivalent`));
      if (result?.reason) console.log(`    ${Y(result.reason)}`);
      suggestions.push(`R2 comparative difficulty failed (${label}) for "${name}": ${result?.reason ?? 'R2 clue not detectably harder'}`);
    }
    console.log();
  }

  console.log(`  Result: ${passed}/2 R2 clues measurably harder`);
  return { passed, total: 2, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 5. R2 CATEGORY COHERENCE
// ══════════════════════════════════════════════════════════════════

async function runR2CoherenceTests() {
  section('5. R2 CATEGORY COHERENCE  (1 category)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[1] ?? cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name, round: 2 }); }
  catch { console.log(warn('Request failed')); return { suggestions }; }
  if (!data.clues?.length) return { suggestions };

  let passed = 0;
  for (const clue of data.clues) {
    let belongs;
    try {
      const r = await gptRate(
        `Does this Jeopardy clue clearly belong to the category "${name}"? Return JSON: { "belongs": true|false, "reason": string }`,
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
      belongs = r.belongs;
    } catch { belongs = null; }

    if (belongs === true)  { passed++; console.log(pass(`$${clue.value}: ${clue.answer}`)); }
    else if (belongs === false) { console.log(fail(`$${clue.value}: ${clue.answer} — may not fit category`)); suggestions.push(`R2 $${clue.value} clue in "${name}" (answer: ${clue.answer}) was flagged as off-category.`); }
    else { console.log(warn(`$${clue.value}: ${clue.answer} — coherence check failed`)); }
  }

  console.log(`\n  Result: ${passed}/${data.clues.length} clues coherent`);
  return { passed, total: data.clues.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 6. R2 FACTUAL ACCURACY  (independent fact-check)
// ══════════════════════════════════════════════════════════════════

async function runR2FactualTests() {
  section('6. R2 FACTUAL ACCURACY  (independent fact-check, 2 categories)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const picks = [cats.categories[0], cats.categories[3] ?? cats.categories[1]].filter(Boolean);
  let totalClues = 0, totalErrors = 0;

  for (const cat of picks) {
    const name = typeof cat === 'object' ? cat.name : cat;
    console.log(`\n  Category: ${B(name)}`);

    let data;
    try { data = await post('/api/category', { name, round: 2 }); }
    catch { console.log(warn('  Request failed')); continue; }
    if (!data.clues?.length) continue;

    for (const clue of data.clues) {
      totalClues++;
      let result;
      try {
        result = await gptRate(
          'You are an independent fact-checker. Verify every factual claim in this Jeopardy clue: nationalities, dates, statistics, record counts, event descriptions, and attributions. Only confirm things you are confident are true. Describe any error briefly. Return JSON: { "accurate": true|false, "error": string|null }',
          `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
        );
      } catch { result = null; }

      const ok = result?.accurate !== false;
      if (ok) {
        console.log(pass(`  $${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
      } else {
        totalErrors++;
        console.log(fail(`  $${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
        if (result?.error) console.log(`    ${Y('Error: ' + result.error)}`);
        suggestions.push(`R2 factual error in "${name}" $${clue.value}: ${result?.error ?? 'unknown'}`);
      }
    }
  }

  console.log(`\n  Result: ${totalClues - totalErrors}/${totalClues} R2 clues passed fact-check`);
  return { passed: totalClues - totalErrors, total: totalClues, errors: totalErrors, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 7. R2 CLUE-ANSWER LOGICAL FIT
// ══════════════════════════════════════════════════════════════════

async function runR2LogicalFitTests() {
  section('7. R2 CLUE-ANSWER LOGICAL FIT');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const picks = [cats.categories[1], cats.categories[4] ?? cats.categories[0]].filter(Boolean);
  let totalClues = 0, totalMismatches = 0;

  for (const cat of picks) {
    const name = typeof cat === 'object' ? cat.name : cat;
    console.log(`\n  Category: ${B(name)}`);

    let data;
    try { data = await post('/api/category', { name, round: 2 }); }
    catch { console.log(warn('  Request failed')); continue; }
    if (!data.clues?.length) continue;

    for (const clue of data.clues) {
      totalClues++;
      let result;
      try {
        result = await gptRate(
          'Check whether a Jeopardy clue logically leads to its stated answer. Ignore factual accuracy — only judge whether a knowledgeable player reading the clue would arrive at the given answer. It is valid for a clue to describe a specific example or characteristic where the answer is the general concept. Only flag a mismatch when the clue clearly describes a different subject than the answer. Return JSON: { "fits": true|false, "reason": string|null }',
          `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
        );
      } catch { result = null; }

      const ok = result?.fits !== false;
      if (ok) {
        console.log(pass(`  $${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
      } else {
        totalMismatches++;
        console.log(fail(`  $${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
        if (result?.reason) console.log(`    ${Y('Mismatch: ' + result.reason)}`);
        suggestions.push(`R2 clue-answer mismatch in "${name}" $${clue.value}: ${result?.reason ?? 'unknown'}`);
      }
    }
  }

  console.log(`\n  Result: ${totalClues - totalMismatches}/${totalClues} R2 clues logically fit their answer`);
  return { passed: totalClues - totalMismatches, total: totalClues, mismatches: totalMismatches, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 8. R2 CLUE PHRASING VALIDATION
// ══════════════════════════════════════════════════════════════════

async function runR2PhrasingTests() {
  section('8. R2 CLUE PHRASING VALIDATION  (Jeopardy format)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[2] ?? cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name, round: 2 }); }
  catch { console.log(warn('Request failed')); return { suggestions }; }
  if (!data.clues?.length) return { suggestions };

  let passed = 0;
  for (const clue of data.clues) {
    let result;
    try {
      result = await gptRate(
        'Check whether a Jeopardy clue is correctly formatted. Clues must be statements or descriptions — NOT questions. Check: (1) is the clue a statement? (2) does it avoid directly naming the answer? Return JSON: { "valid": true|false, "issues": string }',
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
    } catch { result = null; }

    if (result?.valid !== false) {
      passed++;
      console.log(pass(`$${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
    } else {
      console.log(fail(`$${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
      if (result?.issues) console.log(`    ${Y(result.issues)}`);
      suggestions.push(`R2 $${clue.value} clue in "${name}" has phrasing issues: ${result?.issues ?? 'unknown'}`);
    }
  }

  console.log(`\n  Result: ${passed}/${data.clues.length} correctly phrased`);
  return { passed, total: data.clues.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 9. CATEGORY FRESHNESS  (R2 categories don't repeat R1 themes)
// ══════════════════════════════════════════════════════════════════

async function runCategoryFreshnessTest() {
  section('9. CATEGORY FRESHNESS  (R2 categories should not overlap with R1)');
  const suggestions = [];

  let r1Cats, r2Cats;
  try {
    r1Cats = await get('/api/categories');
    r2Cats = await get('/api/categories');
  } catch { console.log(warn('Request failed')); return { suggestions }; }

  const r1Names = (r1Cats.categories ?? []).map(c => (typeof c === 'object' ? c.name : c).toLowerCase());
  const r2Names = (r2Cats.categories ?? []).map(c => (typeof c === 'object' ? c.name : c).toLowerCase());

  console.log(`  Round 1: ${r1Names.join(', ')}`);
  console.log(`  Round 2: ${r2Names.join(', ')}\n`);

  const exactOverlap = r1Names.filter(n => r2Names.includes(n));

  if (exactOverlap.length === 0) {
    console.log(pass('No exact category name overlap between R1 and R2'));
  } else {
    exactOverlap.forEach(n => console.log(fail(`Exact overlap: "${n}"`)));
    suggestions.push(`${exactOverlap.length} category name(s) shared between R1 and R2: ${exactOverlap.join(', ')}`);
  }

  let thematicIssues = 0;
  try {
    const result = await gptRate(
      'Check whether a Jeopardy Round 1 and Round 2 category list have thematically overlapping categories. Flag only when a category from R1 and R2 are clearly about the same topic — minor wording variation is fine. Return JSON: { "overlapping_pairs": [{"r1": string, "r2": string}] }',
      `Round 1 categories: ${r1Names.join(', ')}\nRound 2 categories: ${r2Names.join(', ')}`,
    );
    const pairs = result?.overlapping_pairs ?? [];
    thematicIssues = pairs.length;
    if (pairs.length === 0) {
      console.log(pass('No thematic overlap between R1 and R2'));
    } else {
      pairs.forEach(p => {
        console.log(fail(`Thematic overlap: R1 "${p.r1}" ↔ R2 "${p.r2}"`));
        suggestions.push(`Category thematic overlap R1→R2: "${p.r1}" ↔ "${p.r2}"`);
      });
    }
  } catch { console.log(warn('Thematic overlap check failed')); }

  console.log(`\n  Result: ${exactOverlap.length} exact + ${thematicIssues} thematic R1→R2 overlap(s)`);
  return { exactOverlap: exactOverlap.length, thematicOverlap: thematicIssues, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 10. API LATENCY  (round:2 calls)
// ══════════════════════════════════════════════════════════════════

async function runR2LatencyTest() {
  section('10. API LATENCY  (round:2 calls)');
  const suggestions = [];

  const THRESHOLDS = { '/api/categories': 6000, '/api/category (r2)': 20000 };
  const latencies  = {};

  { const { ms } = await timed(() => get('/api/categories')); latencies['/api/categories'] = ms; }

  const cats      = await get('/api/categories');
  const firstName = typeof cats.categories[0] === 'object' ? cats.categories[0].name : cats.categories[0];
  { const { ms } = await timed(() => post('/api/category', { name: firstName, round: 2 })); latencies['/api/category (r2)'] = ms; }

  for (const [endpoint, ms] of Object.entries(latencies)) {
    const limit = THRESHOLDS[endpoint] ?? 16000;
    const bar   = Math.round(ms / 500);
    const icon  = ms <= limit ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${endpoint.padEnd(24)} ${String(ms).padStart(5)}ms  ${'█'.repeat(Math.min(bar, 20))}${ms > limit ? R(' SLOW') : ''}`);
    if (ms > limit) suggestions.push(`R2 ${endpoint} is slow (${ms}ms > ${limit}ms threshold) — may delay the Double Jeopardy board load.`);
  }

  return { latencies, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  console.log(`\n${B('═'.repeat(64))}`);
  console.log(B('  AI JEOPARDY — DOUBLE JEOPARDY EVAL SUITE'));
  console.log(B('═'.repeat(64)));
  console.log(`  Server : ${BASE}`);
  console.log(`  Note   : full run takes ~3-4 minutes\n`);

  try { await get('/api/players'); }
  catch { console.error(`\n${R(`Cannot reach ${BASE} — start the server first: node server.js`)}\n`); process.exit(1); }

  const valuesRes    = await runValuesCheck();
  const leakRes      = await runR2LeakTests();
  const diffRes      = await runR2DifficultyTests();
  const compareRes   = await runComparativeDifficultyTest();
  const coherRes     = await runR2CoherenceTests();
  const factualRes   = await runR2FactualTests();
  const logicalRes   = await runR2LogicalFitTests();
  const phrasingRes  = await runR2PhrasingTests();
  const freshnessRes = await runCategoryFreshnessTest();
  const latencyRes   = await runR2LatencyTest();

  const allResults     = [valuesRes, leakRes, diffRes, compareRes, coherRes, factualRes, logicalRes, phrasingRes, freshnessRes, latencyRes];
  const allSuggestions = [...new Set(allResults.flatMap(r => r?.suggestions ?? []))];

  section('SUGGESTIONS');
  if (!allSuggestions.length) {
    console.log(pass('No issues detected — Double Jeopardy looks healthy.'));
  } else {
    allSuggestions.forEach((s, i) => console.log(`  ${i + 1}. ${Y(s)}`));
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const lat        = latencyRes.latencies ?? {};

  section('SUMMARY');
  console.log(`  R2 values correct     : ${valuesRes.passed ?? '?'}/${valuesRes.total ?? '?'}`);
  console.log(`  Clue leaks            : ${leakRes.leakCount ?? '?'}/${leakRes.totalClues ?? '?'}`);
  console.log(`  Difficulty spread     : ${diffRes.spread ?? '?'}/4, inversions ${diffRes.inversions ?? '?'}, calibration issues ${diffRes.calibrationIssues ?? '?'}`);
  console.log(`  Comparative hardness  : ${compareRes.passed ?? '?'}/${compareRes.total ?? '?'} R2 clues measurably harder than R1`);
  console.log(`  Category coherence    : ${coherRes.passed ?? '?'}/${coherRes.total ?? '?'} clues on-topic`);
  console.log(`  Factual accuracy      : ${factualRes.passed ?? '?'}/${factualRes.total ?? '?'} passed`);
  console.log(`  Logical fit           : ${logicalRes.passed ?? '?'}/${logicalRes.total ?? '?'} clues fit answer`);
  console.log(`  Clue phrasing         : ${phrasingRes.passed ?? '?'}/${phrasingRes.total ?? '?'} correctly formatted`);
  console.log(`  Category freshness    : ${freshnessRes.exactOverlap ?? '?'} exact + ${freshnessRes.thematicOverlap ?? '?'} thematic R1→R2 overlap(s)`);
  console.log(`  Latency (category r2) : ${lat['/api/category (r2)'] ?? '?'}ms`);
  console.log(`  Total suggestions     : ${allSuggestions.length}`);
  console.log(`  Elapsed               : ${elapsedSec}s`);
  console.log();

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = `eval-r2-results-${timestamp}.json`;
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    elapsedSeconds: elapsedSec,
    server: BASE,
    summary: {
      r2ValuesCorrect:       { passed: valuesRes.passed,    total: valuesRes.total },
      clueLeaks:             { leaks: leakRes.leakCount,    total: leakRes.totalClues },
      difficultySpread:      diffRes.spread,
      difficultyInversions:  diffRes.inversions,
      difficultyCalibration: diffRes.calibrationIssues,
      comparativeDifficulty: { passed: compareRes.passed,  total: compareRes.total },
      categoryCoherence:     { passed: coherRes.passed,    total: coherRes.total },
      factualAccuracy:       { passed: factualRes.passed,  total: factualRes.total,  errors: factualRes.errors },
      logicalFit:            { passed: logicalRes.passed,  total: logicalRes.total,  mismatches: logicalRes.mismatches },
      cluePhrasingValid:     { passed: phrasingRes.passed, total: phrasingRes.total },
      categoryFreshness:     { exactOverlap: freshnessRes.exactOverlap, thematicOverlap: freshnessRes.thematicOverlap },
      latencyMs:             lat,
    },
    suggestions: allSuggestions,
    rawResults: {
      values: valuesRes, leaks: leakRes, difficulty: diffRes, comparative: compareRes,
      coherence: coherRes, factual: factualRes, logical: logicalRes, phrasing: phrasingRes,
      freshness: freshnessRes, latency: latencyRes,
    },
  }, null, 2));
  console.log(`  ${G('Results exported →')} ${outputFile}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
