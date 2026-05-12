// eval.js — Automated eval suite for AI Jeopardy game mechanics
// Usage: node eval.js
// Requires the server running: node server.js  (takes ~3-4 minutes to complete)

const { BASE, timed, post, get, gptRate, G, R, Y, C, B, pass, fail, warn, section } = require('./eval-shared');
const { norm, answerLeaksIntoClue: leaks, messageLeaksAnswer, normaliseAnswer } = require('./utils');

// ══════════════════════════════════════════════════════════════════
// 1. JUDGE ACCURACY
// ══════════════════════════════════════════════════════════════════

const JUDGE_CASES = [
  // Correct
  { desc: 'exact match',                         clue: 'This 16th U.S. president led the Union through the Civil War.',              correctAnswer: 'Abraham Lincoln',       playerAnswer: 'Abraham Lincoln',            expectCorrect: true,  expectClarify: false },
  { desc: 'nickname (FDR)',                       clue: 'This president served four terms and enacted the New Deal.',                 correctAnswer: 'Franklin D. Roosevelt', playerAnswer: 'FDR',                        expectCorrect: true,  expectClarify: false },
  { desc: '"What is" preamble ignored',           clue: 'This president served four terms and enacted the New Deal.',                 correctAnswer: 'Franklin D. Roosevelt', playerAnswer: 'What is Franklin Roosevelt', expectCorrect: true,  expectClarify: false },
  { desc: 'surname alone (unambiguous)',           clue: 'This physicist developed the theory of general relativity.',                correctAnswer: 'Albert Einstein',       playerAnswer: 'Einstein',                   expectCorrect: true,  expectClarify: false },
  { desc: 'minor spelling variant (Ghandi)',       clue: 'This independence leader used non-violent civil disobedience in India.',    correctAnswer: 'Mahatma Gandhi',        playerAnswer: 'Ghandi',                     expectCorrect: true,  expectClarify: false },
  { desc: 'phonetic mishearing (Lenin → Lennon)',  clue: 'This Beatle wrote Imagine and was shot outside his New York home in 1980.', correctAnswer: 'John Lennon',           playerAnswer: 'Lenin',                      expectCorrect: true,  expectClarify: false },
  { desc: 'self-correction accepted',              clue: 'This 1990 holiday film features a boy left behind while his family travels to Paris.', correctAnswer: 'Home Alone', playerAnswer: 'Star Wars... no Home Alone', expectCorrect: true,  expectClarify: false },
  { desc: 'article dropped (The Beatles)',         clue: 'This British band released Abbey Road in 1969.',                           correctAnswer: 'The Beatles',           playerAnswer: 'Beatles',                    expectCorrect: true,  expectClarify: false },
  { desc: 'demonym form (Egyptian)',               clue: 'This ancient civilisation built the pyramids at Giza.',                    correctAnswer: 'Ancient Egypt',         playerAnswer: 'Egyptian',                   expectCorrect: true,  expectClarify: false },
  { desc: 'numeric variant (World War 2 → II)',    clue: 'This global conflict from 1939 to 1945 ended with the defeat of Nazi Germany and Imperial Japan.', correctAnswer: 'World War II', playerAnswer: 'World War 2', expectCorrect: true,  expectClarify: false },
  { desc: 'number spelled out (1984)',             clue: 'This George Orwell novel depicts a dystopian society ruled by a figure known as Big Brother.', correctAnswer: 'Nineteen Eighty-Four', playerAnswer: '1984', expectCorrect: true,  expectClarify: false },
  { desc: 'plural accepted (Black Holes)',         clue: 'These regions of space have gravity so strong that not even light can escape their pull.', correctAnswer: 'Black Holes', playerAnswer: 'Black Hole',               expectCorrect: true,  expectClarify: false },
  // Clarification needed
  { desc: 'ambiguous surname triggers clarify',    clue: 'This U.S. president led the famous Rough Riders cavalry regiment during the Spanish-American War.', correctAnswer: 'Theodore Roosevelt', playerAnswer: 'Roosevelt', expectCorrect: false, expectClarify: true  },
  // Incorrect
  { desc: 'wrong first name rejected',             clue: 'This president served four terms and enacted the New Deal.',               correctAnswer: 'Franklin D. Roosevelt', playerAnswer: 'Teddy Roosevelt',            expectCorrect: false, expectClarify: false },
  { desc: 'partial answer rejected (World War)',   clue: 'This global conflict from 1939 to 1945 ended with the defeat of Nazi Germany and Imperial Japan.', correctAnswer: 'World War II', playerAnswer: 'World War',  expectCorrect: false, expectClarify: false },
  { desc: 'completely wrong answer',               clue: 'This physicist developed the theory of general relativity.',               correctAnswer: 'Albert Einstein',       playerAnswer: 'Isaac Newton',               expectCorrect: false, expectClarify: false },
  { desc: 'empty answer rejected',                 clue: 'This 16th U.S. president led the Union through the Civil War.',            correctAnswer: 'Abraham Lincoln',       playerAnswer: '',                           expectCorrect: false, expectClarify: false },
  { desc: 'non-answer rejected',                   clue: 'This 16th U.S. president led the Union through the Civil War.',            correctAnswer: 'Abraham Lincoln',       playerAnswer: "I don't know",               expectCorrect: false, expectClarify: false },
];

async function runJudgeTests() {
  section('1. JUDGE ACCURACY');
  let passed = 0;
  const suggestions = [];

  for (const t of JUDGE_CASES) {
    let result;
    try { result = await post('/api/judge', { clue: t.clue, correctAnswer: t.correctAnswer, playerAnswer: t.playerAnswer }); }
    catch { console.log(fail(`${t.desc} — request failed`)); continue; }

    const correctOk = result.correct === t.expectCorrect;
    const clarifyOk = !t.expectClarify || result.needsClarification === true;
    // Bug fix: check for leaks on WRONG answers (message should not reveal correct answer to other players)
    const noLeak    = result.correct || !messageLeaksAnswer(result.message || '', t.correctAnswer);

    if (correctOk && clarifyOk && noLeak) {
      passed++;
      console.log(pass(t.desc));
    } else {
      const why = [];
      if (!correctOk) why.push(`judged ${result.correct ? 'correct' : 'incorrect'}, expected ${t.expectCorrect ? 'correct' : 'incorrect'}`);
      if (!clarifyOk) why.push('expected clarification');
      if (!noLeak)    why.push(`answer leaked in message: "${result.message}"`);
      console.log(fail(`${t.desc}  →  ${R(why.join('; '))}`));
      if (!correctOk && t.desc.includes('phonetic'))       suggestions.push('Phonetic mishearing rule missing cases — add more examples to the judge prompt.');
      if (!correctOk && t.desc.includes('self-correction')) suggestions.push('Self-correction pre-processing may be failing — check stripFalseStart() on the server.');
      if (!correctOk && t.desc.includes('demonym'))         suggestions.push('Demonym/adjectival form not being accepted — reinforce DEMONYM rule in judge prompt.');
      if (!clarifyOk)                                       suggestions.push(`Clarification not triggered for "${t.playerAnswer}" / "${t.correctAnswer}" — check CLARIFICATION RULE in judge prompt.`);
      if (!noLeak)                                          suggestions.push('Judge leaking correct answer in wrong-answer messages — reinforce the CRITICAL rule in the prompt.');
    }
  }

  console.log(`\n  Result: ${passed}/${JUDGE_CASES.length} passed`);
  return { passed, total: JUDGE_CASES.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 2. JUDGE CONSISTENCY  (same borderline cases run 3× each)
// ══════════════════════════════════════════════════════════════════

const CONSISTENCY_CASES = [
  { desc: 'surname alone (Lincoln)',  clue: 'This 16th U.S. president led the Union through the Civil War.',              correctAnswer: 'Abraham Lincoln',      playerAnswer: 'Lincoln'    },
  { desc: 'phonetic (Lenin/Lennon)',  clue: 'This Beatle wrote Imagine and was shot outside his New York home in 1980.',  correctAnswer: 'John Lennon',          playerAnswer: 'Lenin'      },
  { desc: 'demonym (Egyptian)',       clue: 'This ancient civilisation built the pyramids at Giza.',                      correctAnswer: 'Ancient Egypt',         playerAnswer: 'Egyptian'   },
  { desc: 'self-correction',          clue: 'This 1990 holiday film features a boy left behind while his family travels to Paris.', correctAnswer: 'Home Alone', playerAnswer: 'Die Hard no Home Alone' },
  { desc: 'wrong first name (Teddy)', clue: 'This president served four terms and enacted the New Deal.',                 correctAnswer: 'Franklin D. Roosevelt', playerAnswer: 'Teddy Roosevelt' },
];

async function runConsistencyTests() {
  section('2. JUDGE CONSISTENCY  (3 runs per borderline case)');
  const RUNS = 3;
  let consistent = 0;
  const suggestions = [];

  for (const t of CONSISTENCY_CASES) {
    const verdicts = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await post('/api/judge', { clue: t.clue, correctAnswer: t.correctAnswer, playerAnswer: t.playerAnswer });
        verdicts.push(r.correct);
      } catch { verdicts.push(null); }
    }
    const allSame = verdicts.every(v => v === verdicts[0]);
    if (allSame) {
      consistent++;
      console.log(pass(`${t.desc}  →  always ${verdicts[0] ? 'correct' : 'incorrect'}`));
    } else {
      const tally = `${verdicts.filter(Boolean).length}× correct, ${verdicts.filter(v => !v).length}× incorrect`;
      console.log(fail(`${t.desc}  →  inconsistent (${tally})`));
      suggestions.push(`Judge is inconsistent on "${t.desc}" — consider lower temperature or a more explicit prompt rule.`);
    }
  }

  console.log(`\n  Result: ${consistent}/${CONSISTENCY_CASES.length} consistent`);
  return { consistent, total: CONSISTENCY_CASES.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 3. CLARIFICATION ROUND-TRIP
// ══════════════════════════════════════════════════════════════════

// Clarification round-trip: vague surname → clarification triggered → specific answer judged.
// Note: good Jeopardy clues are specific enough that most surnames are accepted without clarification.
// The Rough Riders case is the most reliably ambiguous (both Roosevelts are famous presidents).
const CLARIFY_CASES = [
  { desc: 'Roosevelt → clarify → Theodore accepted', clue: 'This U.S. president led the famous Rough Riders cavalry regiment during the Spanish-American War.', correctAnswer: 'Theodore Roosevelt', vague: 'Roosevelt', specific: 'Theodore Roosevelt'                    },
  { desc: 'Roosevelt → clarify → Franklin rejected', clue: 'This U.S. president led the famous Rough Riders cavalry regiment during the Spanish-American War.', correctAnswer: 'Theodore Roosevelt', vague: 'Roosevelt', specific: 'Franklin Roosevelt', expectWrong: true },
];

async function runClarificationTests() {
  section('3. CLARIFICATION ROUND-TRIP');
  let passed = 0;
  const suggestions = [];

  for (const t of CLARIFY_CASES) {
    // Step 1: vague answer should trigger clarification
    let step1;
    try { step1 = await post('/api/judge', { clue: t.clue, correctAnswer: t.correctAnswer, playerAnswer: t.vague }); }
    catch { console.log(fail(`${t.desc} — step 1 request failed`)); continue; }

    if (!step1.needsClarification) {
      console.log(fail(`${t.desc}  →  step 1 did not trigger clarification`));
      suggestions.push(`"${t.vague}" for "${t.correctAnswer}" should trigger clarification but didn't.`);
      continue;
    }

    // Step 2: specific answer judged on its own merits
    let step2;
    try { step2 = await post('/api/judge', { clue: t.clue, correctAnswer: t.correctAnswer, playerAnswer: t.specific, clarification: true }); }
    catch { console.log(fail(`${t.desc} — step 2 request failed`)); continue; }

    const expectCorrect = !t.expectWrong;
    if (step2.correct === expectCorrect && step2.needsClarification === false) {
      passed++;
      console.log(pass(`${t.desc}  →  ${step2.correct ? 'correctly accepted' : 'correctly rejected'}`));
    } else {
      console.log(fail(`${t.desc}  →  step 2 judged ${step2.correct ? 'correct' : 'incorrect'}, expected ${expectCorrect ? 'correct' : 'incorrect'}`));
      suggestions.push(`Clarification round-trip failed for "${t.desc}" — check the clarification judge prompt.`);
    }
  }

  console.log(`\n  Result: ${passed}/${CLARIFY_CASES.length} passed`);
  return { passed, total: CLARIFY_CASES.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 4. CLUE QUALITY  (leak detection, answer uniqueness)
// ══════════════════════════════════════════════════════════════════

async function runClueQualityTests() {
  section('4. CLUE QUALITY  (3 categories)');
  const suggestions = [];
  let totalClues = 0, leakCount = 0, dupCount = 0;

  let cats;
  try { cats = await get('/api/categories'); } catch { console.log(fail('Could not reach /api/categories')); return { suggestions }; }

  const sample = cats.categories.slice(0, 3);

  for (const cat of sample) {
    const name   = typeof cat === 'object' ? cat.name   : cat;
    const domain = typeof cat === 'object' ? cat.domain : '?';
    console.log(`\n  ${B(name)} ${C(`(${domain})`)}`);

    let data;
    try { data = await post('/api/category', { name }); } catch { console.log(warn('  Request failed')); continue; }
    if (!data.clues?.length) { console.log(warn('  No clues returned')); continue; }

    // Answer uniqueness
    const answers = data.clues.map(c => norm(c.answer));
    const uniqueAnswers = new Set(answers).size;
    if (uniqueAnswers < data.clues.length) {
      dupCount++;
      console.log(warn(`  Duplicate answers detected (${uniqueAnswers} unique of ${data.clues.length})`));
      suggestions.push(`Category "${name}" has duplicate answers — clue generator may be looping on the same answer.`);
    }

    for (const clue of data.clues) {
      totalClues++;
      const leaked = leaks(clue.clue, clue.answer);
      if (leaked) leakCount++;
      const icon = leaked ? '❌' : '✅';
      console.log(`    ${icon} $${clue.value}${leaked ? R(' [LEAK]') : ''}`);
      console.log(`       Clue:   ${clue.clue.slice(0, 88)}${clue.clue.length > 88 ? '…' : ''}`);
      console.log(`       Answer: ${clue.answer}`);
      if (leaked) suggestions.push(`Answer "${clue.answer}" leaked into clue for "${name}" — retry limit may need raising.`);
    }
  }

  const leakRate = totalClues ? Math.round(leakCount / totalClues * 100) : 0;
  console.log(`\n  Leak rate: ${leakCount}/${totalClues} (${leakRate}%)`);
  if (leakRate > 10) suggestions.push(`Leak rate ${leakRate}% is high — increase retry cap in /api/category.`);

  return { leakCount, totalClues, dupCount, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 5. CLUE DIFFICULTY RATING  (GPT rates each clue 1-5)
// ══════════════════════════════════════════════════════════════════

async function runDifficultyRatingTests() {
  section('5. CLUE DIFFICULTY RATING  (GPT-rated, 1 category)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name }); } catch { console.log(warn('Request failed')); return { suggestions }; }
  if (!data.clues?.length) return { suggestions };

  const ratings = [];
  for (const clue of data.clues) {
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

  // Check ordering: higher $ should generally mean higher rating
  let inversions = 0;
  for (let i = 0; i < ratings.length - 1; i++) {
    if (ratings[i].rating !== null && ratings[i + 1].rating !== null && ratings[i].rating > ratings[i + 1].rating + 1) inversions++;
  }

  const ratingValues = ratings.map(r => r.rating).filter(Boolean);
  const low  = Math.min(...ratingValues);
  const high = Math.max(...ratingValues);

  console.log(`\n  Difficulty spread: ${low}–${high}/5`);
  if (high - low < 2) {
    console.log(warn('  Low spread — clues may not be scaling in difficulty'));
    suggestions.push(`Difficulty spread for "${name}" is only ${high - low} points — clue writer may not be differentiating $200 from $1000.`);
  } else {
    console.log(pass('  Good difficulty spread'));
  }
  if (inversions > 1) {
    console.log(warn(`  ${inversions} difficulty inversion(s) detected`));
    suggestions.push(`Difficulty inversions in "${name}" — a lower-value clue was rated harder than a higher-value one.`);
  }

  // Absolute calibration check: $200 should be genuinely easy, $1000 genuinely hard
  console.log(`\n  Absolute calibration:`);
  let calibrationIssues = 0;
  const calibrationClues = [data.clues[0], data.clues[4]].filter(Boolean); // $200 and $1000
  for (const clue of calibrationClues) {
    const isEasy = clue.value === 200;
    let result;
    try {
      result = await gptRate(
        isEasy
          ? 'You are assessing whether a Jeopardy clue is genuinely easy. Assume the player is a reasonably educated adult with NO specialist knowledge in this subject — just general life knowledge. Would most such adults be able to answer this correctly? Be strict: if it requires any niche knowledge, hobby interest, or academic study, it is NOT easy. Return JSON: { "appropriatelyEasy": true|false, "reason": string }'
          : 'You are assessing whether a Jeopardy clue is genuinely hard. Assume the player is a reasonably educated adult. Would this question stump most people who are not active experts or enthusiasts in this subject? If a casual fan or generally knowledgeable person could answer it, it is NOT hard enough for $1000. Return JSON: { "appropriatelyHard": true|false, "reason": string }',
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
    } catch { result = null; }

    const ok = isEasy ? result?.appropriatelyEasy !== false : result?.appropriatelyHard !== false;
    const label = isEasy ? '$200 easy enough' : '$1000 hard enough';
    if (ok) {
      console.log(pass(`  ${label}: ${clue.clue.slice(0, 60)}…`));
    } else {
      calibrationIssues++;
      console.log(fail(`  ${label}: ${clue.clue.slice(0, 60)}…`));
      if (result?.reason) console.log(`    ${Y(result.reason)}`);
      suggestions.push(`Difficulty calibration issue in "${name}" $${clue.value}: ${result?.reason ?? 'clue may not be appropriately ' + (isEasy ? 'easy' : 'hard')}`);
    }
  }

  return { spread: high - low, inversions, calibrationIssues, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 6. CATEGORY COHERENCE  (GPT checks clues belong to category)
// ══════════════════════════════════════════════════════════════════

async function runCoherenceTests() {
  section('6. CATEGORY COHERENCE  (1 category)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[1] ?? cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name }); } catch { console.log(warn('Request failed')); return { suggestions }; }
  if (!data.clues?.length) return { suggestions };

  let passed = 0;
  for (const clue of data.clues) {
    let belongs;
    try {
      const r = await gptRate(
        `Does this Jeopardy clue clearly belong to the category "${name}"? Answer JSON: { "belongs": true|false, "reason": string }`,
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
      belongs = r.belongs;
    } catch { belongs = null; }

    if (belongs === true) {
      passed++;
      console.log(pass(`$${clue.value}: ${clue.answer}`));
    } else if (belongs === false) {
      console.log(fail(`$${clue.value}: ${clue.answer}  — clue may not fit category`));
      suggestions.push(`$${clue.value} clue in "${name}" (answer: ${clue.answer}) was flagged as off-category.`);
    } else {
      console.log(warn(`$${clue.value}: ${clue.answer}  — coherence check failed`));
    }
  }

  console.log(`\n  Result: ${passed}/${data.clues.length} clues coherent`);
  return { passed, total: data.clues.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 7. AI ANSWER VARIETY & WRONG-ANSWER PROPAGATION
// ══════════════════════════════════════════════════════════════════

// accuracy: 0 forces the AI to always miss, so we can observe wrongAnswers propagation across 5 sequential calls
const VARIETY_CLUES = [
  { clue: 'This French emperor was exiled to the island of Saint Helena after his final defeat in 1815.', answer: 'Napoleon Bonaparte', category: 'European History', value: 800, domain: 'history',    accuracy: 0 },
  { clue: "This pop star's 2003 album Dangerously in Love won five Grammy Awards.",                        answer: 'Beyoncé',            category: 'Pop Music',        value: 600, domain: 'popculture', accuracy: 0 },
];

async function runVarietyTests() {
  section('7. AI ANSWER VARIETY & WRONG-ANSWER PROPAGATION');
  const suggestions = [];
  const RUNS = 5;

  for (const t of VARIETY_CLUES) {
    console.log(`\n  ${B('Clue:')} ${t.clue.slice(0, 65)}…`);
    console.log(`  ${B('Answer:')} ${t.answer}`);

    const answers = [], wrongAnswers = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        const d = await post('/api/ai-answer', { clue: t.clue, category: t.category, value: t.value, accuracy: t.accuracy ?? 0.85, domain: t.domain, specialties: {}, wrongAnswers });
        const ans = d.answer || '';
        answers.push(ans);
        if (ans && norm(ans) !== norm(t.answer) && !norm(ans).includes(norm(t.answer))) wrongAnswers.push(ans);
      } catch { answers.push('(error)'); }
    }

    const unique   = new Set(answers.map(a => norm(a))).size;
    const repeated = answers.length - unique;
    console.log(`  Answers: ${answers.map(a => `"${a}"`).join(', ')}`);
    console.log(`  ${unique >= 3 ? pass(`${unique}/${RUNS} unique`) : warn(`${unique}/${RUNS} unique — low variety`)}`);
    console.log(`  ${repeated <= 1 ? pass('No significant repetition') : warn(`${repeated} repeated answer(s)`)}`);
    if (unique < 3)   suggestions.push(`Low variety for "${t.category}" — check wrongAnswers propagation.`);
    if (repeated > 1) suggestions.push(`AI repeating answers for "${t.clue.slice(0, 40)}…" — wrongAnswers list may not be reaching the prompt.`);
  }

  return { suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 8. AI ACCURACY CALIBRATION
// ══════════════════════════════════════════════════════════════════

async function runAccuracyCalibration() {
  section('8. AI ACCURACY CALIBRATION');
  const suggestions = [];
  const RUNS   = 10;
  const CLUE   = { clue: 'This 16th U.S. president delivered the Gettysburg Address.', correctAnswer: 'Abraham Lincoln', category: 'History', value: 400, domain: 'history' };
  const LEVELS = [{ accuracy: 0.9, label: '90%', minExpected: 0.6 }, { accuracy: 0.2, label: '20%', maxExpected: 0.5 }];

  console.log(`  Clue: ${CLUE.clue}\n`);

  const results = {};
  for (const level of LEVELS) {
    let correct = 0;
    process.stdout.write(`  accuracy=${level.label}  [`);
    for (let i = 0; i < RUNS; i++) {
      const d = await post('/api/ai-answer', { clue: CLUE.clue, category: CLUE.category, value: CLUE.value, accuracy: level.accuracy, domain: CLUE.domain, specialties: {} });
      const ans = d.answer || '';
      const j   = await post('/api/judge', { clue: CLUE.clue, correctAnswer: CLUE.correctAnswer, playerAnswer: ans });
      const ok  = j.correct;
      if (ok) correct++;
      process.stdout.write(ok ? G('■') : R('□'));
    }
    const rate = correct / RUNS;
    process.stdout.write(`]  ${correct}/${RUNS} correct\n`);
    results[level.label] = rate;

    if (level.minExpected && rate < level.minExpected) {
      console.log(warn(`  Expected ≥${Math.round(level.minExpected * 100)}% at accuracy=${level.label}, got ${Math.round(rate * 100)}%`));
      suggestions.push(`High-accuracy AI (${level.label}) is underperforming — check miss-chance formula in /api/ai-answer.`);
    } else if (level.maxExpected && rate > level.maxExpected) {
      console.log(warn(`  Expected ≤${Math.round(level.maxExpected * 100)}% at accuracy=${level.label}, got ${Math.round(rate * 100)}%`));
      suggestions.push(`Low-accuracy AI (${level.label}) is overperforming — accuracy parameter may not be having enough effect.`);
    } else {
      console.log(pass(`  accuracy=${level.label} in expected range`));
    }
  }

  const delta = results['90%'] - results['20%'];
  console.log(`\n  Accuracy delta (90% vs 20%): ${Math.round(delta * 100)}pp`);
  if (delta < 0.3) suggestions.push(`Only ${Math.round(delta * 100)}pp spread between accuracy=90% and accuracy=20% — the parameter may not be calibrated correctly.`);

  return { results, delta, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 9. SPECIALTY EFFECTIVENESS
// ══════════════════════════════════════════════════════════════════

async function runSpecialtyTests() {
  section('9. SPECIALTY EFFECTIVENESS');
  const suggestions = [];
  const RUNS = 12;
  const T    = { clue: 'This physicist proposed the special theory of relativity in 1905, redefining space and time.', correctAnswer: 'Albert Einstein', category: 'Physics', value: 600, domain: 'science' };

  console.log(`  Clue: ${T.clue}\n`);
  console.log(`  Testing science domain: high specialty (×2.0) vs low specialty (×0.1), base accuracy 0.6\n`);

  const configs = [
    { label: 'High specialty (×2.0)', specialties: { science: 2.0 }, minExpected: 0.6 },
    { label: 'Low specialty  (×0.1)', specialties: { science: 0.1 }, maxExpected: 0.35 },
  ];

  const rates = [];
  for (const cfg of configs) {
    let correct = 0;
    process.stdout.write(`  ${cfg.label}  [`);
    for (let i = 0; i < RUNS; i++) {
      const d = await post('/api/ai-answer', { clue: T.clue, category: T.category, value: T.value, accuracy: 0.6, domain: T.domain, specialties: cfg.specialties });
      const j = await post('/api/judge', { clue: T.clue, correctAnswer: T.correctAnswer, playerAnswer: d.answer || '' });
      if (j.correct) correct++;
      process.stdout.write(j.correct ? G('■') : R('□'));
    }
    const rate = correct / RUNS;
    rates.push(rate);
    process.stdout.write(`]  ${correct}/${RUNS} correct\n`);
    if (cfg.minExpected && rate < cfg.minExpected) {
      console.log(warn(`  Expected ≥${Math.round(cfg.minExpected * 100)}%, got ${Math.round(rate * 100)}%`));
      suggestions.push(`High specialty multiplier not boosting accuracy enough — check specialty computation in /api/ai-answer.`);
    } else if (cfg.maxExpected && rate > cfg.maxExpected) {
      console.log(warn(`  Expected ≤${Math.round(cfg.maxExpected * 100)}%, got ${Math.round(rate * 100)}%`));
      suggestions.push(`Low specialty multiplier not reducing accuracy enough — effective accuracy floor may be too high.`);
    }
  }

  const delta = rates[0] - rates[1];
  console.log(`\n  Specialty delta: ${Math.round(delta * 100)}pp  ${delta >= 0.25 ? G('(meaningful differentiation)') : Y('(weak differentiation)')}`);
  if (delta < 0.25) suggestions.push(`Specialty delta only ${Math.round(delta * 100)}pp — specialties may not be differentiating AI players enough. Consider widening multiplier ranges.`);

  return { delta, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 10. WRONG ANSWER PLAUSIBILITY
// ══════════════════════════════════════════════════════════════════

async function runPlausibilityTests() {
  section('10. WRONG ANSWER PLAUSIBILITY');
  const suggestions = [];

  const PLAUS_CLUES = [
    { clue: 'This 16th U.S. president delivered the Gettysburg Address.', correctAnswer: 'Abraham Lincoln', category: 'History', value: 400, domain: 'history'    },
    { clue: 'This planet is the largest in our solar system.',             correctAnswer: 'Jupiter',          category: 'Astronomy', value: 600, domain: 'science' },
  ];

  for (const t of PLAUS_CLUES) {
    // Force wrong answer (accuracy=0 means always wrong)
    const wrongAnswers = [];
    for (let i = 0; i < 3; i++) {
      try {
        const d = await post('/api/ai-answer', { clue: t.clue, category: t.category, value: t.value, accuracy: 0.0, domain: t.domain, specialties: {}, wrongAnswers });
        if (d.answer) wrongAnswers.push(d.answer);
      } catch { /* skip */ }
    }

    if (!wrongAnswers.length) { console.log(warn(`No wrong answers generated for "${t.category}"`)); continue; }

    console.log(`\n  ${B(t.category)} — correct answer: ${t.correctAnswer}`);
    let totalRating = 0;

    for (const ans of wrongAnswers) {
      let rating = null;
      try {
        const r = await gptRate(
          `You are evaluating wrong answers to a Jeopardy question. A plausible wrong answer is in the same subject area and era as the correct answer, not the correct answer itself. Rate plausibility 1 (nonsensical) to 5 (very believable wrong answer). Return JSON: { "rating": number, "reason": string }`,
          `Category: ${t.category}\nClue: ${t.clue}\nCorrect answer: ${t.correctAnswer}\nWrong answer given: "${ans}"`,
        );
        rating = r.rating;
        totalRating += rating;
      } catch { /* skip */ }
      const bar = rating ? '█'.repeat(rating) + '░'.repeat(5 - rating) : '?????';
      console.log(`  [${bar}] ${rating ?? '?'}/5 — "${ans}"`);
    }

    const avg = wrongAnswers.length ? (totalRating / wrongAnswers.length).toFixed(1) : '?';
    console.log(`  Avg plausibility: ${avg}/5  ${avg >= 3 ? G('(good)') : Y('(weak)')}`);
    if (avg < 3) suggestions.push(`Wrong answers for "${t.category}" have low plausibility (${avg}/5) — the miss prompt may need to be more specific about staying in-domain.`);
  }

  return { suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 11. DOMAIN CLASSIFICATION & BOARD DIVERSITY
// ══════════════════════════════════════════════════════════════════

const VALID_DOMAINS = new Set(['science','history','popculture','sports','arts','geography','food','language','general']);

async function runDomainTests() {
  section('11. DOMAIN CLASSIFICATION & BOARD DIVERSITY');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { console.log(fail('Could not reach /api/categories')); return { suggestions }; }

  if (!cats.categories.length || typeof cats.categories[0] === 'string') {
    console.log(warn('Server returned plain strings — domain classification not active.'));
    suggestions.push('Ensure /api/categories returns {name, domain} objects.');
    return { suggestions };
  }

  let validCount = 0;
  const seenDomains = new Set();

  for (const cat of cats.categories) {
    const ok = VALID_DOMAINS.has(cat.domain);
    if (ok) { validCount++; seenDomains.add(cat.domain); console.log(pass(`"${cat.name}" → ${C(cat.domain)}`)); }
    else    { console.log(fail(`"${cat.name}" → "${cat.domain}" (invalid domain)`)); suggestions.push(`Invalid domain "${cat.domain}" for category "${cat.name}".`); }
  }

  const diversity = seenDomains.size;
  console.log(`\n  Valid domains: ${validCount}/${cats.categories.length}`);
  console.log(`  Unique domains on board: ${diversity}/6  ${diversity >= 4 ? G('(good variety)') : Y('(low variety)')}`);
  if (diversity < 4) suggestions.push(`Only ${diversity} unique domains across 6 categories — board may feel repetitive. Consider biasing category generation toward variety.`);

  return { validCount, total: cats.categories.length, diversity, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 12. API LATENCY
// ══════════════════════════════════════════════════════════════════

async function runLatencyTests() {
  section('12. API LATENCY');
  const suggestions = [];

  const THRESHOLDS = { '/api/categories': 6000, '/api/category': 16000, '/api/judge': 8000, '/api/ai-answer': 6000 };

  const latencies = {};

  // categories
  { const { ms } = await timed(() => get('/api/categories')); latencies['/api/categories'] = ms; }

  // category (pick first category from a fresh call)
  const cats = await get('/api/categories');
  const firstName = typeof cats.categories[0] === 'object' ? cats.categories[0].name : cats.categories[0];
  { const { ms } = await timed(() => post('/api/category', { name: firstName })); latencies['/api/category'] = ms; }

  // judge
  { const { ms } = await timed(() => post('/api/judge', { clue: 'This 16th president led the Union.', correctAnswer: 'Abraham Lincoln', playerAnswer: 'Lincoln' })); latencies['/api/judge'] = ms; }

  // ai-answer
  { const { ms } = await timed(() => post('/api/ai-answer', { clue: 'This 16th president led the Union.', category: 'History', value: 400, accuracy: 0.9, domain: 'history', specialties: {} })); latencies['/api/ai-answer'] = ms; }

  for (const [endpoint, ms] of Object.entries(latencies)) {
    const limit = THRESHOLDS[endpoint];
    const bar   = Math.round(ms / 500);
    const icon  = ms <= limit ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${endpoint.padEnd(18)} ${String(ms).padStart(5)}ms  ${'█'.repeat(Math.min(bar, 20))}${ms > limit ? R(' SLOW') : ''}`);
    if (ms > limit) suggestions.push(`${endpoint} is slow (${ms}ms > ${limit}ms threshold) — may impact gameplay responsiveness.`);
  }

  return { latencies, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 13. FULL BOARD — CROSS-CATEGORY ANSWER UNIQUENESS
// ══════════════════════════════════════════════════════════════════

async function runBoardUniquenessTest() {
  section('13. FULL BOARD — CROSS-CATEGORY ANSWER UNIQUENESS');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { console.log(fail('Could not reach /api/categories')); return { suggestions }; }

  console.log('  Generating all 6 categories — this takes ~30s…\n');

  const allAnswers = [];
  let totalLeaks   = 0;

  for (const cat of cats.categories) {
    const name   = typeof cat === 'object' ? cat.name   : cat;
    const domain = typeof cat === 'object' ? cat.domain : '?';
    process.stdout.write(`  ${name} (${domain})… `);
    try {
      const data  = await post('/api/category', { name });
      const clues = data.clues ?? [];
      const leaked = clues.filter(c => leaks(c.clue, c.answer));
      totalLeaks  += leaked.length;
      for (const c of clues) allAnswers.push({ answer: c.answer, category: name, value: c.value });
      console.log(`${clues.length} clues  ${leaked.length > 0 ? R(`${leaked.length} leak(s)`) : G('no leaks')}`);
    } catch { console.log(warn('request failed')); }
  }

  // Detect duplicate answers across different categories
  const answerMap = {};
  for (const { answer, category, value } of allAnswers) {
    const key = norm(answer);
    if (!answerMap[key]) answerMap[key] = [];
    answerMap[key].push(`${category} $${value}`);
  }
  const dupes = Object.entries(answerMap).filter(([, places]) => places.length > 1);

  console.log(`\n  Total clues: ${allAnswers.length}/30`);
  console.log(`  Cross-category duplicates: ${dupes.length}`);
  console.log(`  Total leaks (full board): ${totalLeaks}`);

  if (dupes.length === 0) {
    console.log(pass('No duplicate answers across categories'));
  } else {
    for (const [answer, places] of dupes) {
      console.log(warn(`  "${answer}" appears in: ${places.join(' · ')}`));
    }
    suggestions.push(`${dupes.length} answer(s) appear in multiple categories — clue generator may be reusing common answers.`);
  }
  if (totalLeaks > 0) suggestions.push(`Full board has ${totalLeaks} answer leak(s) across all clues — retry logic not catching all cases.`);

  return { totalClues: allAnswers.length, dupes: dupes.length, totalLeaks, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 14. CLUE PHRASING VALIDATION  (GPT checks Jeopardy format)
// ══════════════════════════════════════════════════════════════════

async function runPhrasingTests() {
  section('14. CLUE PHRASING VALIDATION  (GPT checks Jeopardy format)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const cat  = cats.categories[2] ?? cats.categories[0];
  const name = typeof cat === 'object' ? cat.name : cat;
  console.log(`  Category: ${B(name)}\n`);

  let data;
  try { data = await post('/api/category', { name }); } catch { console.log(warn('Request failed')); return { suggestions }; }
  if (!data.clues?.length) return { suggestions };

  let passed = 0;
  for (const clue of data.clues) {
    let result;
    try {
      result = await gptRate(
        `You are checking whether a Jeopardy clue is correctly formatted. In Jeopardy, clues must be statements or descriptions — NOT questions. The player responds "What is X?" or "Who is X?". Check two things: (1) is the clue a statement, not a question? (2) does the clue avoid directly naming the answer? Return JSON: { "valid": true|false, "issues": string }`,
        `Clue: ${clue.clue}\nAnswer: ${clue.answer}`,
      );
    } catch { result = null; }

    if (result?.valid !== false) {
      passed++;
      console.log(pass(`$${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
    } else {
      console.log(fail(`$${clue.value}: ${clue.clue.slice(0, 70)}${clue.clue.length > 70 ? '…' : ''}`));
      if (result?.issues) console.log(`    ${Y(result.issues)}`);
      suggestions.push(`$${clue.value} clue in "${name}" has phrasing issues: ${result?.issues ?? 'unknown'}`);
    }
  }

  console.log(`\n  Result: ${passed}/${data.clues.length} correctly phrased`);
  return { passed, total: data.clues.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 15. WRONG ANSWER ISOLATION  (multi-AI simulation)
// ══════════════════════════════════════════════════════════════════

async function runWrongAnswerIsolationTest() {
  section('15. WRONG ANSWER ISOLATION  (4 sequential AI players)');
  const suggestions = [];

  const CASES = [
    { clue: 'This planet is the largest in our solar system.',                                              correctAnswer: 'Jupiter',           category: 'Astronomy', value: 200, domain: 'science'  },
    { clue: 'This French emperor was exiled to the island of Saint Helena after his defeat in 1815.',       correctAnswer: 'Napoleon Bonaparte', category: 'History',   value: 600, domain: 'history'  },
  ];

  let totalRepeats = 0;

  for (const t of CASES) {
    console.log(`\n  ${B(t.category)} — ${t.clue}`);
    const wrongAnswers = [];
    const givenAnswers = [];
    let hasRepeat = false;

    for (let i = 1; i <= 4; i++) {
      try {
        const d   = await post('/api/ai-answer', { clue: t.clue, category: t.category, value: t.value, accuracy: 0.0, domain: t.domain, specialties: {}, wrongAnswers });
        const ans = d.answer || '(none)';
        const isRepeat = wrongAnswers.some(w => norm(w) === norm(ans));
        givenAnswers.push(ans);
        if (!isRepeat && norm(ans) !== norm(t.correctAnswer)) wrongAnswers.push(ans);
        console.log(`    AI ${i}: "${ans}"  [${isRepeat ? R('REPEAT') : G('unique')}]`);
        if (isRepeat) { hasRepeat = true; totalRepeats++; }
      } catch { console.log(`    AI ${i}: (error)`); }
    }

    const uniqueCount = new Set(givenAnswers.map(a => norm(a))).size;
    if (!hasRepeat) { console.log(pass(`  All ${uniqueCount} answers unique`)); }
    else            { console.log(fail(`  Repeated answer detected`)); suggestions.push(`Wrong answer isolation failed for "${t.category}" — an AI repeated a previous player's wrong answer.`); }
  }

  return { totalRepeats, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 16. FACTUAL ACCURACY  (independent GPT fact-check of generated clues)
// ══════════════════════════════════════════════════════════════════

async function runFactualAccuracyTests() {
  section('16. FACTUAL ACCURACY  (independent fact-check of generated clues)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  // Use two different categories to get a broader sample
  const picks = [cats.categories[0], cats.categories[3] ?? cats.categories[1]].filter(Boolean);
  let totalClues = 0, totalErrors = 0;

  for (const cat of picks) {
    const name = typeof cat === 'object' ? cat.name : cat;
    console.log(`\n  Category: ${B(name)}`);

    let data;
    try { data = await post('/api/category', { name }); } catch { console.log(warn('  Request failed')); continue; }
    if (!data.clues?.length) continue;

    for (const clue of data.clues) {
      totalClues++;
      let result;
      try {
        result = await gptRate(
          `You are an independent fact-checker. Verify every factual claim in this Jeopardy clue: nationalities, dates, statistics, record counts, event descriptions, and attributions. Do NOT rely on what sounds plausible — only confirm things you are confident are true. If you find any factual error, describe it briefly. Return JSON: { "accurate": true|false, "error": string|null }`,
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
        suggestions.push(`Factual error in "${name}" $${clue.value}: ${result?.error ?? 'unknown'}`);
      }
    }
  }

  console.log(`\n  Result: ${totalClues - totalErrors}/${totalClues} clues passed fact-check`);
  return { passed: totalClues - totalErrors, total: totalClues, errors: totalErrors, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 17. CLUE-ANSWER LOGICAL FIT  (does the clue actually lead to the answer?)
// ══════════════════════════════════════════════════════════════════

async function runLogicalFitTests() {
  section('17. CLUE-ANSWER LOGICAL FIT  (does the clue lead to the answer?)');
  const suggestions = [];

  let cats;
  try { cats = await get('/api/categories'); } catch { return { suggestions }; }

  const picks = [cats.categories[1], cats.categories[4] ?? cats.categories[0]].filter(Boolean);
  let totalClues = 0, totalMismatches = 0;

  for (const cat of picks) {
    const name = typeof cat === 'object' ? cat.name : cat;
    console.log(`\n  Category: ${B(name)}`);

    let data;
    try { data = await post('/api/category', { name }); } catch { console.log(warn('  Request failed')); continue; }
    if (!data.clues?.length) continue;

    for (const clue of data.clues) {
      totalClues++;
      let result;
      try {
        result = await gptRate(
          `You are checking whether a Jeopardy clue logically leads to its stated answer. Ignore whether facts are true — only judge whether a knowledgeable player reading the clue would arrive at the given answer. Important: in Jeopardy it is valid and common for a clue to describe a specific example, property, or characteristic of something while the answer is the general concept (e.g. clue describes chia seeds' fiber content → answer "Fiber" is correct; clue describes blueberry health compounds → answer "Blueberry" is correct). Only flag a mismatch when the clue clearly describes a different subject than the answer, or when the answer could not reasonably be inferred from the clue at all. Return JSON: { "fits": true|false, "reason": string|null }`,
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
        suggestions.push(`Clue-answer mismatch in "${name}" $${clue.value}: ${result?.reason ?? 'unknown'}`);
      }
    }
  }

  console.log(`\n  Result: ${totalClues - totalMismatches}/${totalClues} clues logically fit their answer`);
  return { passed: totalClues - totalMismatches, total: totalClues, mismatches: totalMismatches, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 18. ANSWER NORMALISATION  (unit tests for normaliseAnswer())
// ══════════════════════════════════════════════════════════════════

const NORMALISE_CASES = [
  { input: 'The Enlightenment (also: Age of Reason)', expected: 'Enlightenment',          desc: 'strip article + parenthetical' },
  { input: 'Franklin Delano Roosevelt',               expected: 'Franklin Delano Roosevelt', desc: 'keep first 3 words exactly' },
  { input: 'Muhammad Ali',                            expected: 'Muhammad Ali',            desc: '2 words unchanged' },
  { input: 'The Silk Road',                           expected: 'Silk Road',               desc: 'strip leading "The"' },
  { input: 'An Inconvenient Truth (2006)',            expected: 'Inconvenient Truth',       desc: 'strip "An" + parenthetical' },
  { input: 'A Tale of Two Cities',                    expected: 'Tale of Two',              desc: 'strip "A", truncate to 3 words' },
  { input: 'Photosynthesis',                          expected: 'Photosynthesis',           desc: 'single word unchanged' },
  { input: 'World War II',                            expected: 'World War II',             desc: 'alphanumeric preserved' },
];

async function runNormalisationTests() {
  section('18. ANSWER NORMALISATION  (unit tests for normaliseAnswer)');
  let passed = 0;
  const suggestions = [];

  for (const t of NORMALISE_CASES) {
    const result = normaliseAnswer(t.input);
    if (result === t.expected) {
      passed++;
      console.log(pass(`${t.desc}: "${t.input}" → "${result}"`));
    } else {
      console.log(fail(`${t.desc}: "${t.input}" → "${result}" (expected "${t.expected}")`));
      suggestions.push(`normaliseAnswer regression on "${t.desc}": got "${result}", expected "${t.expected}"`);
    }
  }

  console.log(`\n  Result: ${passed}/${NORMALISE_CASES.length} passed`);
  return { passed, total: NORMALISE_CASES.length, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// 19. CATEGORY REPETITION  (two /api/categories calls should not overlap)
// ══════════════════════════════════════════════════════════════════

async function runCategoryRepetitionTest() {
  section('19. CATEGORY REPETITION  (back-to-back games should vary categories)');
  const suggestions = [];

  let first, second;
  try {
    first  = await get('/api/categories');
    second = await get('/api/categories');
  } catch { console.log(warn('  Request failed')); return { suggestions }; }

  const names1 = (first.categories  ?? []).map(c => (typeof c === 'object' ? c.name : c).toLowerCase());
  const names2 = (second.categories ?? []).map(c => (typeof c === 'object' ? c.name : c).toLowerCase());

  const exactOverlap = names1.filter(n => names2.includes(n));

  console.log(`\n  Game 1: ${names1.join(', ')}`);
  console.log(`  Game 2: ${names2.join(', ')}`);

  if (exactOverlap.length === 0) {
    console.log(pass(`\n  No exact category name overlap`));
  } else {
    console.log(fail(`\n  ${exactOverlap.length} exact overlap(s): ${exactOverlap.join(', ')}`));
    suggestions.push(`Category repetition: ${exactOverlap.length} category name(s) repeated across back-to-back games: ${exactOverlap.join(', ')}`);
  }

  // GPT check for thematic overlap (same subject dressed differently)
  let thematicIssues = 0;
  try {
    const result = await gptRate(
      'You are checking whether two Jeopardy game category lists cover significantly overlapping subjects. Minor variation in wording is fine; flag only when two categories from different games are clearly about the same topic. Return JSON: { "overlapping_pairs": [{"cat1": string, "cat2": string}] }',
      `Game 1 categories: ${names1.join(', ')}\nGame 2 categories: ${names2.join(', ')}`,
    );
    const pairs = result?.overlapping_pairs ?? [];
    thematicIssues = pairs.length;
    if (pairs.length === 0) {
      console.log(pass('  No thematic overlap detected'));
    } else {
      pairs.forEach(p => {
        console.log(fail(`  Thematic overlap: "${p.cat1}" ↔ "${p.cat2}"`));
        suggestions.push(`Category thematic overlap across games: "${p.cat1}" ↔ "${p.cat2}"`);
      });
    }
  } catch { console.log(warn('  Thematic overlap check failed')); }

  console.log(`\n  Result: ${exactOverlap.length} exact + ${thematicIssues} thematic overlap(s)`);
  return { exactOverlap: exactOverlap.length, thematicOverlap: thematicIssues, suggestions };
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

const fs = require('fs');

async function main() {
  const startTime = Date.now();

  console.log(`\n${B('═'.repeat(64))}`);
  console.log(B('  AI JEOPARDY — EVAL SUITE'));
  console.log(B('═'.repeat(64)));
  console.log(`  Server : ${BASE}`);
  console.log(`  Note   : full run takes ~5-6 minutes\n`);

  try { await get('/api/players'); }
  catch { console.error(`\n${R(`Cannot reach ${BASE} — start the server first: node server.js`)}\n`); process.exit(1); }

  // Run sequentially to avoid rate limiting
  const judgeRes    = await runJudgeTests();
  const consistRes  = await runConsistencyTests();
  const clarifyRes  = await runClarificationTests();
  const clueRes     = await runClueQualityTests();
  const diffRes     = await runDifficultyRatingTests();
  const coherRes    = await runCoherenceTests();
  const varietyRes  = await runVarietyTests();
  const calibRes    = await runAccuracyCalibration();
  const specRes     = await runSpecialtyTests();
  const plausRes    = await runPlausibilityTests();
  const domainRes   = await runDomainTests();
  const latencyRes  = await runLatencyTests();
  const boardRes    = await runBoardUniquenessTest();
  const phrasingRes  = await runPhrasingTests();
  const isolationRes = await runWrongAnswerIsolationTest();
  const factualRes   = await runFactualAccuracyTests();
  const logicalRes   = await runLogicalFitTests();
  const normalRes    = await runNormalisationTests();
  const repeatRes    = await runCategoryRepetitionTest();

  // ── Suggestions ──
  const allResults = [judgeRes, consistRes, clarifyRes, clueRes, diffRes, coherRes, varietyRes, calibRes, specRes, plausRes, domainRes, latencyRes, boardRes, phrasingRes, isolationRes, factualRes, logicalRes, normalRes, repeatRes];
  const allSuggestions    = allResults.flatMap(r => r?.suggestions ?? []);
  const uniqueSuggestions = [...new Set(allSuggestions)];

  section('SUGGESTIONS');
  if (!uniqueSuggestions.length) {
    console.log(pass('No issues detected — everything looks healthy.'));
  } else {
    uniqueSuggestions.forEach((s, i) => console.log(`  ${i + 1}. ${Y(s)}`));
  }

  // ── Summary ──
  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  section('SUMMARY');
  const lat = latencyRes.latencies ?? {};
  console.log(`  Judge accuracy     : ${judgeRes.passed}/${judgeRes.total} passed`);
  console.log(`  Judge consistency  : ${consistRes.consistent}/${consistRes.total} consistent`);
  console.log(`  Clarification      : ${clarifyRes.passed}/${clarifyRes.total} round-trips correct`);
  console.log(`  Clue leaks (sample): ${clueRes.leakCount ?? '?'}/${clueRes.totalClues ?? '?'}`);
  console.log(`  Clue leaks (board) : ${boardRes.totalLeaks ?? '?'}/30`);
  console.log(`  Board dupes        : ${boardRes.dupes ?? '?'} cross-category answer duplicate(s)`);
  console.log(`  Clue difficulty    : spread ${diffRes.spread ?? '?'}/4, inversions ${diffRes.inversions ?? '?'}, calibration issues ${diffRes.calibrationIssues ?? '?'}`);
  console.log(`  Category coherence : ${coherRes.passed ?? '?'}/${coherRes.total ?? '?'} clues on-topic`);
  console.log(`  Clue phrasing      : ${phrasingRes.passed ?? '?'}/${phrasingRes.total ?? '?'} correctly formatted`);
  console.log(`  Accuracy delta     : ${Math.round((calibRes.delta ?? 0) * 100)}pp  (90% vs 20% AI)`);
  console.log(`  Specialty delta    : ${Math.round((specRes.delta ?? 0) * 100)}pp  (high vs low multiplier)`);
  console.log(`  Wrong ans isolaton : ${isolationRes.totalRepeats ?? '?'} repeat(s) across 8 sequential answers`);
  console.log(`  Factual accuracy   : ${factualRes.passed ?? '?'}/${factualRes.total ?? '?'} clues passed fact-check`);
  console.log(`  Logical fit        : ${logicalRes.passed ?? '?'}/${logicalRes.total ?? '?'} clues logically lead to answer`);
  console.log(`  Answer normalise   : ${normalRes.passed ?? '?'}/${normalRes.total ?? '?'} unit tests passed`);
  console.log(`  Category repeat    : ${repeatRes.exactOverlap ?? '?'} exact + ${repeatRes.thematicOverlap ?? '?'} thematic overlap(s)`);
  console.log(`  Board diversity    : ${domainRes.diversity ?? '?'} unique domains`);
  console.log(`  Latency (judge)    : ${lat['/api/judge'] ?? '?'}ms`);
  console.log(`  Latency (category) : ${lat['/api/category'] ?? '?'}ms`);
  console.log(`  Total suggestions  : ${uniqueSuggestions.length}`);
  console.log(`  Elapsed            : ${elapsedSec}s`);
  console.log();

  // ── Export results to JSON ──
  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = `eval-results-${timestamp}.json`;
  const exportData = {
    timestamp: new Date().toISOString(),
    elapsedSeconds: elapsedSec,
    server: BASE,
    summary: {
      judgeAccuracy:      { passed: judgeRes.passed,       total: judgeRes.total },
      judgeConsistency:   { consistent: consistRes.consistent, total: consistRes.total },
      clarification:      { passed: clarifyRes.passed,     total: clarifyRes.total },
      clueLeaksSample:    { leaks: clueRes.leakCount,      total: clueRes.totalClues },
      clueLeaksFullBoard: { leaks: boardRes.totalLeaks,    total: boardRes.totalClues },
      crossCategoryDupes: boardRes.dupes,
      difficultySpread:        diffRes.spread,
      difficultyInversions:    diffRes.inversions,
      difficultyCalibration:   diffRes.calibrationIssues,
      categoryCoherence:  { passed: coherRes.passed,       total: coherRes.total },
      cluePhrasingValid:  { passed: phrasingRes.passed,    total: phrasingRes.total },
      accuracyDeltaPP:    Math.round((calibRes.delta ?? 0) * 100),
      specialtyDeltaPP:   Math.round((specRes.delta ?? 0) * 100),
      wrongAnsRepeats:    isolationRes.totalRepeats,
      factualAccuracy:    { passed: factualRes.passed,  total: factualRes.total,  errors: factualRes.errors },
      logicalFit:         { passed: logicalRes.passed,  total: logicalRes.total,  mismatches: logicalRes.mismatches },
      answerNormalise:    { passed: normalRes.passed,  total: normalRes.total },
      categoryRepeat:     { exactOverlap: repeatRes.exactOverlap, thematicOverlap: repeatRes.thematicOverlap },
      boardDiversity:     domainRes.diversity,
      latencyMs:          lat,
    },
    suggestions: uniqueSuggestions,
    rawResults: {
      judge: judgeRes, consistency: consistRes, clarification: clarifyRes,
      clueQuality: clueRes, difficulty: diffRes, coherence: coherRes,
      variety: varietyRes, calibration: calibRes, specialty: specRes,
      plausibility: plausRes, domain: domainRes, latency: latencyRes,
      boardUniqueness: boardRes, phrasing: phrasingRes, isolation: isolationRes, factual: factualRes, logical: logicalRes, normalisation: normalRes, categoryRepeat: repeatRes,
    },
  };

  fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
  console.log(`  ${G('Results exported →')} ${outputFile}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
