// ── Test mode — set to false when done testing clarification ──
const TEST_MODE = false;
const TEST_CLUES = [
  { clue: 'This Roosevelt led the country through the Great Depression and signed the New Deal into law.',   answer: 'Franklin D. Roosevelt' },
  { clue: 'This president launched Operation Desert Storm to liberate Kuwait in 1991.',                      answer: 'George H.W. Bush'       },
  { clue: 'This Massachusetts-born founding father served as the second president of the United States.',   answer: 'John Adams'             },
  { clue: 'This quarterback led the Indianapolis Colts to a victory in Super Bowl XLI.',                    answer: 'Peyton Manning'         },
  { clue: 'This tennis player won a record 23 Grand Slam singles titles in the Open Era.',                  answer: 'Serena Williams'        },
  { clue: 'This U.S. president, nicknamed "Old Hickory", is credited with founding the Democratic Party.', answer: 'Andrew Jackson'         },
];

const VALUES        = [200, 400, 600, 800, 1000];
const CIRCUMFERENCE = 2 * Math.PI * 44;

const SPEED_RANGES = {
  fast:   { min: 800,  max: 2000, rebuzzMin: 300,  rebuzzMax: 900  },
  medium: { min: 1500, max: 3500, rebuzzMin: 600,  rebuzzMax: 1500 },
  slow:   { min: 2500, max: 5000, rebuzzMin: 1000, rebuzzMax: 2000 },
};

const AI_BUZZ_CHANCE = { 200: 0.97, 400: 0.88, 600: 0.72, 800: 0.55, 1000: 0.40 };

let PLAYERS = [];
let CATEGORIES = [];
let board      = [];
const scores   = [];

let activeCell       = null;
let clueOpen         = false;
let aiTimers         = [];
let revealInterval   = null;
let attemptedPlayers = new Set();
let buzzTimeout      = null;
let boardController  = 0;

function setController(playerIdx) {
  boardController = playerIdx;
  PLAYERS.forEach((_, i) => {
    document.getElementById(`player-card-${i}`)
      ?.classList.toggle('active-turn', i === playerIdx);
  });
}

// ── DOM refs ──
const boardEl        = document.getElementById('board');
const overlay        = document.getElementById('overlay');
const modal          = document.getElementById('modal');
const loadingScreen  = document.getElementById('loading-screen');

const phaseClue      = document.getElementById('phase-clue');
const phaseListen    = document.getElementById('phase-listen');
const phaseClarify   = document.getElementById('phase-clarify');
const phaseJudging   = document.getElementById('phase-judging');
const phaseResult    = document.getElementById('phase-result');
const phaseAI        = document.getElementById('phase-ai');

const categoryLabel  = document.getElementById('category-label');
const clueText       = document.getElementById('clue-text');
const buzzBtn        = document.getElementById('buzz-btn');
const buzzTimerBar   = document.getElementById('buzz-timer-bar');

const countdownNum   = document.getElementById('countdown-num');
const ringProgress   = document.getElementById('ring-progress');
const transcriptDisp = document.getElementById('transcript-display');

const clarifyOriginalEl   = document.getElementById('clarify-original');
const clarifyRingProgress = document.getElementById('clarify-ring-progress');
const clarifyCountdownNum = document.getElementById('clarify-countdown-num');
const clarifyTranscript   = document.getElementById('clarify-transcript-display');

const resultBadge    = document.getElementById('result-badge');
const resultMessage  = document.getElementById('result-message');
const correctReveal  = document.getElementById('correct-answer-reveal');
const continueBtn    = document.getElementById('continue-btn');

const aiBuzzName     = document.getElementById('ai-buzz-name');
const aiBuzzStatus   = document.getElementById('ai-buzz-status');
const aiAnswerReveal = document.getElementById('ai-answer-reveal');

// ── Scoreboard ──
const scoreEls = [];

function buildScoreboard() {
  const sb = document.getElementById('scoreboard');
  sb.innerHTML = '';
  scoreEls.length = 0;
  PLAYERS.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'player-card' + (p.isHuman ? ' human' : '');
    card.id = `player-card-${i}`;
    const label = p.avatar ? `${p.avatar} ${p.name}` : p.name;
    card.innerHTML = `<div class="player-name">${label}</div><div class="player-score" id="pscore-${i}">$0</div><div class="turn-label">▶ your turn</div>`;
    sb.appendChild(card);
    scoreEls.push(card.querySelector('.player-score'));
  });
}

function updateScore(playerIdx, delta) {
  scores[playerIdx] += delta;
  const el = scoreEls[playerIdx];
  el.textContent = `$${scores[playerIdx].toLocaleString()}`;
  el.style.color = scores[playerIdx] < 0 ? '#ff6666' : '';
  refreshLeader();
}

function refreshLeader() {
  const max = Math.max(...scores);
  PLAYERS.forEach((_, i) => {
    document.getElementById(`player-card-${i}`)
      .classList.toggle('leader', max > 0 && scores[i] === max);
  });
}

// ── Init ──
async function init() {
  try {
    const [playersRes, categoriesRes] = await Promise.all([
      fetch('/players.json'),
      fetch('/api/categories'),
    ]);

    PLAYERS    = await playersRes.json();
    const cats = await categoriesRes.json();
    CATEGORIES = cats.categories;

    PLAYERS.forEach(() => scores.push(0));
    buildScoreboard();
    setController(0);

    board = CATEGORIES.map(() =>
      VALUES.map(() => ({ clue: null, answer: null, state: 'loading' }))
    );
    buildBoard();

    loadingScreen.classList.add('fade-out');
    setTimeout(() => loadingScreen.remove(), 400);

    CATEGORIES.forEach((name, ci) => {
      fetch('/api/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
        .then(r => r.json())
        .then(d => fillColumn(ci, d.clues))
        .catch(() => setColumnError(ci));
    });
  } catch (err) {
    document.querySelector('#loading-inner p').textContent = 'Failed to load. Check server.';
    console.error(err);
  }
}

function applyTestClues() {
  CATEGORIES.forEach((_, ci) => {
    const t = TEST_CLUES[ci % TEST_CLUES.length];
    board[ci][0].clue   = t.clue;
    board[ci][0].answer = t.answer;
  });
}

// ── Board ──
function buildBoard() {
  boardEl.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const h = document.createElement('div');
    h.className = 'cat-header';
    h.textContent = cat;
    boardEl.appendChild(h);
  });

  VALUES.forEach((_, vi) => {
    CATEGORIES.forEach((__, ci) => {
      const cell = document.createElement('div');
      cell.className = 'clue-cell loading';
      cell.dataset.ci = ci;
      cell.dataset.vi = vi;
      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    });
  });
}

function fillColumn(ci, clues) {
  VALUES.forEach((val, vi) => {
    const clueObj = clues.find(c => c.value === val) || {};
    board[ci][vi].clue   = clueObj.clue   || null;
    board[ci][vi].answer = clueObj.answer || null;
    board[ci][vi].state  = 'open';
    const cell = getCell(ci, vi);
    cell.classList.remove('loading');
    cell.textContent = `$${val}`;
    cell.style.animation = 'none';
    cell.offsetHeight;
    cell.style.animation = 'tile-reveal 0.25s ease-out';
  });
  if (TEST_MODE) applyTestClues();
}

function setColumnError(ci) {
  VALUES.forEach((_, vi) => {
    const cell = getCell(ci, vi);
    cell.classList.remove('loading');
    cell.textContent = '!';
    cell.style.color = '#ff6666';
  });
}

function getCell(ci, vi) {
  return boardEl.querySelector(`[data-ci="${ci}"][data-vi="${vi}"]`);
}

function onCellClick(e) {
  const ci = +e.currentTarget.dataset.ci;
  const vi = +e.currentTarget.dataset.vi;
  if (board[ci][vi].state !== 'open') return;
  setController(0);
  activeCell = { ci, vi };
  openModal(ci, vi);
}

// ── Modal ──
function showPhase(phase) {
  [phaseClue, phaseListen, phaseClarify, phaseJudging, phaseResult, phaseAI]
    .forEach(p => p.classList.add('hidden'));
  phase.classList.remove('hidden');
}

function openModal(ci, vi) {
  const entry = board[ci][vi];
  attemptedPlayers.clear();
  categoryLabel.textContent = `${CATEGORIES[ci]} — $${VALUES[vi]}`;
  clueText.textContent = entry.clue;
  transcriptDisp.textContent = '';
  buzzBtn.classList.add('locked');
  showPhase(phaseClue);
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');
  revealClue(entry.clue, activateBuzzing);
}

function activateBuzzing() {
  clueOpen = true;
  buzzBtn.classList.toggle('locked', attemptedPlayers.has(0));
  if (!attemptedPlayers.has(0)) buzzBtn.focus();
  startAITimers();
  startBuzzTimer();
}

function closeModal() {
  clearInterval(revealInterval);
  revealInterval = null;
  clueText.style.minHeight = '';
  cancelAITimers();
  clearBuzzTimer();
  clueOpen = false;
  attemptedPlayers.clear();
  overlay.classList.add('hidden');
  modal.classList.add('hidden');
  activeCell = null;
}

// ── Clue reveal ──
const MS_PER_CHAR = 38;

function revealClue(text, onComplete) {
  clearInterval(revealInterval);
  clueText.textContent = text;
  clueText.style.minHeight = clueText.offsetHeight + 'px';
  clueText.textContent = '';

  let i = 0;
  revealInterval = setInterval(() => {
    i++;
    clueText.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(revealInterval);
      revealInterval = null;
      onComplete();
    }
  }, MS_PER_CHAR);
}

// ── Buzz countdown ──
const BUZZ_DURATION_MS = 8000;

function startBuzzTimer() {
  clearBuzzTimer();
  const duration = attemptedPlayers.size > 0 ? 5000 : BUZZ_DURATION_MS;
  buzzTimerBar.style.transition = 'none';
  buzzTimerBar.style.transform  = 'scaleX(1)';
  buzzTimerBar.offsetHeight;
  buzzTimerBar.style.transition = `transform ${duration}ms linear`;
  buzzTimerBar.style.transform  = 'scaleX(0)';
  buzzTimeout = setTimeout(() => {
    if (!clueOpen) return;
    clueOpen = false;
    cancelAITimers();
    clueExpired();
  }, duration);
}

function clearBuzzTimer() {
  clearTimeout(buzzTimeout);
  buzzTimeout = null;
  buzzTimerBar.style.transition = 'none';
  buzzTimerBar.style.transform  = 'scaleX(0)';
}

function clueExpired() {
  const { ci, vi } = activeCell;
  board[ci][vi].state = 'done';
  getCell(ci, vi).classList.add('answered');
  getCell(ci, vi).textContent = '';
  resultBadge.textContent   = '⏱️';
  resultMessage.innerHTML   = "Time's up — nobody got it.";
  correctReveal.textContent = `Correct answer: ${board[ci][vi].answer}`;
  continueBtn.classList.remove('hidden');
  showPhase(phaseResult);
  continueBtn.focus();
}

// ── AI timers ──
function startAITimers() {
  aiTimers = [];
  const isRebuzz   = attemptedPlayers.size > 0;
  const buzzChance = AI_BUZZ_CHANCE[VALUES[activeCell.vi]] ?? 0.7;
  PLAYERS.forEach((player, playerIdx) => {
    if (player.isHuman) return;
    if (attemptedPlayers.has(playerIdx)) return;
    if (Math.random() > buzzChance) return;
    const range = SPEED_RANGES[player.speed] || SPEED_RANGES.medium;
    const delay = isRebuzz
      ? range.rebuzzMin + Math.random() * (range.rebuzzMax - range.rebuzzMin)
      : range.min       + Math.random() * (range.max       - range.min);
    aiTimers.push(setTimeout(() => {
      if (!clueOpen) return;
      clueOpen = false;
      cancelAITimers();
      clearBuzzTimer();
      handleAIBuzz(playerIdx);
    }, delay));
  });
}

function cancelAITimers() {
  aiTimers.forEach(clearTimeout);
  aiTimers = [];
}

// ── AI answer flow ──
async function handleAIBuzz(playerIdx) {
  const { ci, vi } = activeCell;
  const entry  = board[ci][vi];
  const player = PLAYERS[playerIdx];

  showPhase(phaseAI);
  aiBuzzName.textContent = `${player.name} buzzed in!`;
  aiBuzzStatus.textContent = 'Thinking…';
  aiAnswerReveal.classList.add('hidden');
  aiAnswerReveal.textContent = '';

  let spokenAnswer = '';
  try {
    const res = await fetch('/api/ai-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clue:     entry.clue,
        category: CATEGORIES[ci],
        value:    VALUES[vi],
        accuracy: player.accuracy ?? 1.0,
      }),
    });
    const data = await res.json();
    spokenAnswer = data.answer || '';
  } catch { /* leave empty */ }

  aiBuzzStatus.textContent = 'Answer:';
  aiAnswerReveal.textContent = `"${spokenAnswer}"`;
  aiAnswerReveal.classList.remove('hidden');

  await sleep(900);
  showPhase(phaseJudging);

  try {
    const judgeRes  = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clue: entry.clue, correctAnswer: entry.answer, playerAnswer: spokenAnswer }),
    });
    const judgeData = await judgeRes.json();

    if (judgeData.needsClarification) {
      await handleAIClarification(playerIdx, entry, ci, vi, spokenAnswer);
    } else {
      showResult(playerIdx, judgeData.correct, judgeData.message, entry.answer, VALUES[vi]);
    }
  } catch {
    showResult(playerIdx, false, 'Judge unavailable.', entry.answer, VALUES[vi]);
  }
}

async function handleAIClarification(playerIdx, entry, ci, vi, previousAnswer) {
  const player = PLAYERS[playerIdx];

  // Show "be more specific" in the AI phase
  showPhase(phaseAI);
  aiBuzzName.textContent   = `${player.name} — be more specific!`;
  aiBuzzStatus.textContent = 'Thinking…';
  aiAnswerReveal.classList.add('hidden');

  // Get a more specific answer
  let clarifiedAnswer = '';
  try {
    const res  = await fetch('/api/ai-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clue:           entry.clue,
        category:       CATEGORIES[ci],
        value:          VALUES[vi],
        accuracy:       player.accuracy ?? 1.0,
        clarification:  true,
        previousAnswer,
      }),
    });
    const data = await res.json();
    clarifiedAnswer = data.answer || '';
  } catch { /* leave empty */ }

  aiBuzzStatus.textContent = 'Answer:';
  aiAnswerReveal.textContent = `"${clarifiedAnswer}"`;
  aiAnswerReveal.classList.remove('hidden');

  await sleep(900);
  showPhase(phaseJudging);

  try {
    const res  = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clue: entry.clue, correctAnswer: entry.answer, playerAnswer: clarifiedAnswer, clarification: true }),
    });
    const data = await res.json();
    showResult(playerIdx, !!data.correct, data.message, entry.answer, VALUES[vi]);
  } catch {
    showResult(playerIdx, false, 'Judge unavailable.', entry.answer, VALUES[vi]);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Human buzz ──
buzzBtn.addEventListener('click', () => {
  if (!clueOpen) return;
  clueOpen = false;
  cancelAITimers();
  clearBuzzTimer();
  startListening();
});

function startListening() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Web Speech API is not supported in this browser. Please use Chrome.');
    return;
  }

  showPhase(phaseListen);

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';
  let submitted = false;
  let secondsLeft = 5;

  ringProgress.style.strokeDasharray = CIRCUMFERENCE;
  ringProgress.style.strokeDashoffset = 0;
  ringProgress.classList.remove('urgent');
  countdownNum.textContent = secondsLeft;

  recognition.onresult = e => {
    let interim = '';
    finalTranscript = '';
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    transcriptDisp.textContent = finalTranscript || interim;
  };

  recognition.onerror = e => {
    if (e.error !== 'no-speech') console.warn('Speech error:', e.error);
  };

  recognition.start();

  const interval = setInterval(() => {
    secondsLeft--;
    countdownNum.textContent = secondsLeft;
    ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - secondsLeft / 5);
    if (secondsLeft <= 2) ringProgress.classList.add('urgent');
    if (secondsLeft <= 0) {
      clearInterval(interval);
      recognition.stop();
      if (!submitted) { submitted = true; submitHumanAnswer(finalTranscript || transcriptDisp.textContent); }
    }
  }, 1000);

  recognition.onend = () => {
    if (!submitted && secondsLeft > 0) {
      submitted = true;
      clearInterval(interval);
      submitHumanAnswer(finalTranscript || transcriptDisp.textContent);
    }
  };
}

async function submitHumanAnswer(spokenText) {
  const { ci, vi } = activeCell;
  const entry = board[ci][vi];
  showPhase(phaseJudging);

  try {
    const res = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clue: entry.clue, correctAnswer: entry.answer, playerAnswer: spokenText }),
    });
    const data = await res.json();
    if (data.needsClarification) {
      showClarification(spokenText, VALUES[vi]);
    } else {
      showResult(0, data.correct, data.message, entry.answer, VALUES[vi]);
    }
  } catch {
    showResult(0, false, 'Could not reach the judge.', entry.answer, VALUES[vi]);
  }
}

// ── Clarification ──
function showClarification(originalAnswer, value) {
  clarifyOriginalEl.textContent = `You said: "${originalAnswer}"`;
  clarifyTranscript.textContent = '';
  showPhase(phaseClarify);
  setTimeout(() => startClarifyListening(value), 1500);
}

function startClarifyListening(value) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  const CLARIFY_SECS = 4;
  let finalTranscript = '';
  let submitted = false;
  let secondsLeft = CLARIFY_SECS;

  clarifyRingProgress.style.strokeDasharray = CIRCUMFERENCE;
  clarifyRingProgress.style.strokeDashoffset = 0;
  clarifyRingProgress.classList.remove('urgent');
  clarifyCountdownNum.textContent = secondsLeft;

  recognition.onresult = e => {
    let interim = '';
    finalTranscript = '';
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    clarifyTranscript.textContent = finalTranscript || interim;
  };

  recognition.onerror = e => {
    if (e.error !== 'no-speech') console.warn('Speech error:', e.error);
  };

  recognition.start();

  const interval = setInterval(() => {
    secondsLeft--;
    clarifyCountdownNum.textContent = secondsLeft;
    clarifyRingProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - secondsLeft / CLARIFY_SECS);
    if (secondsLeft <= 2) clarifyRingProgress.classList.add('urgent');
    if (secondsLeft <= 0) {
      clearInterval(interval);
      recognition.stop();
      if (!submitted) { submitted = true; submitClarifiedAnswer(finalTranscript || clarifyTranscript.textContent, value); }
    }
  }, 1000);

  recognition.onend = () => {
    if (!submitted && secondsLeft > 0) {
      submitted = true;
      clearInterval(interval);
      submitClarifiedAnswer(finalTranscript || clarifyTranscript.textContent, value);
    }
  };
}

async function submitClarifiedAnswer(spokenText, value) {
  const { ci, vi } = activeCell;
  const entry = board[ci][vi];
  showPhase(phaseJudging);

  try {
    const res = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clue: entry.clue, correctAnswer: entry.answer, playerAnswer: spokenText, clarification: true }),
    });
    const data = await res.json();
    showResult(0, !!data.correct, data.message, entry.answer, value);
  } catch {
    showResult(0, false, 'Could not reach the judge.', entry.answer, value);
  }
}

// ── Result ──
function showResult(playerIdx, correct, message, correctAnswer, value) {
  const { ci, vi } = activeCell;
  attemptedPlayers.add(playerIdx);
  updateScore(playerIdx, correct ? value : -value);

  const remaining = PLAYERS.filter((_, i) => !attemptedPlayers.has(i));
  const clueOver  = correct || remaining.length === 0;

  if (clueOver) {
    board[ci][vi].state = 'done';
    getCell(ci, vi).classList.add('answered');
    getCell(ci, vi).textContent = '';
  }

  const prefix = PLAYERS[playerIdx].isHuman ? '' : `<strong>${PLAYERS[playerIdx].name}</strong>: `;
  resultBadge.textContent   = correct ? '✅' : '❌';
  resultMessage.innerHTML   = prefix + message;
  correctReveal.textContent = clueOver ? `Correct answer: ${correctAnswer}` : '';
  continueBtn.classList.toggle('hidden', !clueOver);

  if (clueOver && correct) setController(playerIdx);

  showPhase(phaseResult);
  if (clueOver) continueBtn.focus();
  else setTimeout(() => { showPhase(phaseClue); activateBuzzing(); }, 2000);
}

// ── Continue button ──
continueBtn.addEventListener('click', () => {
  const controller = boardController;
  closeModal();
  if (!PLAYERS[controller].isHuman) aiSelectTile(controller);
});

overlay.addEventListener('click', () => {
  if (!phaseClue.classList.contains('hidden')) closeModal();
});

// ── AI tile selection ──
async function aiSelectTile(playerIdx) {
  const player = PLAYERS[playerIdx];
  const range  = SPEED_RANGES[player.speed] || SPEED_RANGES.medium;
  await sleep(range.min * 0.4 + Math.random() * 800); // thinking pause

  const pick = pickTile(player.strategy);
  if (!pick) return;

  const cell = getCell(pick.ci, pick.vi);
  cell.classList.add('ai-selecting');
  await sleep(700);
  cell.classList.remove('ai-selecting');

  setController(playerIdx);
  activeCell = { ci: pick.ci, vi: pick.vi };
  openModal(pick.ci, pick.vi);
}

function pickTile(strategy) {
  const open = [];
  board.forEach((col, ci) => col.forEach((entry, vi) => {
    if (entry.state === 'open') open.push({ ci, vi });
  }));
  if (!open.length) return null;

  if (strategy === 'highValue') {
    return open.reduce((best, c) => VALUES[c.vi] > VALUES[best.vi] ? c : best);
  }

  if (strategy === 'sweepCategory') {
    const counts = CATEGORIES.map((_, ci) => ({
      ci, count: board[ci].filter(e => e.state === 'open').length,
    }));
    const bestCi = counts.reduce((a, b) => b.count > a.count ? b : a).ci;
    return open.filter(c => c.ci === bestCi).sort((a, b) => a.vi - b.vi)[0];
  }

  return open[Math.floor(Math.random() * open.length)];
}

// ── Boot ──
init();
