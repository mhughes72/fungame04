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

let PLAYERS         = [];
let CATEGORIES      = [];
let categoryDomains = [];
let board           = [];
const scores   = [];

let activeCell       = null;
let clueOpen         = false;
let aiTimers         = [];
let revealInterval   = null;
let attemptedPlayers = new Set();
let wrongAnswers     = [];
let buzzTimeout      = null;
let boardController  = 0;
let dailyDoubles     = new Set();
let isDailyDouble    = false;
let currentWager     = 0;
let tileSelectorIdx  = 0;
let clueHadCorrect   = false;

let playerStats = [];
let stumpedCount = 0;

function initStats() {
  playerStats = PLAYERS.map(() => ({
    correct:        0,
    attempts:       0,
    currentStreak:  0,
    longestStreak:  0,
    biggestWin:     0,
    biggestLoss:    0,
    ddAttempts:     0,
    ddCorrect:      0,
    correctPerCat:  new Array(6).fill(0),
  }));
  stumpedCount = 0;
}

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

const clueHeader     = document.getElementById('clue-header');
const phaseBet       = document.getElementById('phase-bet');
const betInstruction = document.getElementById('bet-instruction');
const betFormEl      = document.getElementById('bet-form');
const betInput       = document.getElementById('bet-input');
const betSubmitBtn   = document.getElementById('bet-submit-btn');
const aiBetDisplay   = document.getElementById('ai-bet-display');

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
      fetch('/api/players'),
      fetch('/api/categories'),
    ]);

    PLAYERS    = await playersRes.json();
    const cats = await categoriesRes.json();
    // Support both old string[] and new {name, domain}[] format
    if (cats.categories.length && typeof cats.categories[0] === 'object') {
      CATEGORIES      = cats.categories.map(c => c.name);
      categoryDomains = cats.categories.map(c => c.domain || 'general');
    } else {
      CATEGORIES      = cats.categories;
      categoryDomains = cats.categories.map(() => 'general');
    }

    PLAYERS.forEach(() => scores.push(0));
    buildScoreboard();
    setController(0);
    initStats();

    board = CATEGORIES.map(() =>
      VALUES.map(() => ({ clue: null, answer: null, state: 'loading' }))
    );
    buildBoard();
    assignDailyDoubles();

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

function assignDailyDoubles() {
  const allCells = [];
  CATEGORIES.forEach((_, ci) => VALUES.forEach((_, vi) => allCells.push(`${ci},${vi}`)));
  for (let i = allCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allCells[i], allCells[j]] = [allCells[j], allCells[i]];
  }
  dailyDoubles = new Set(allCells.slice(0, 2));
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
  [phaseClue, phaseListen, phaseClarify, phaseJudging, phaseResult, phaseAI, phaseBet]
    .forEach(p => p.classList.add('hidden'));
  phase.classList.remove('hidden');
}

function openModal(ci, vi) {
  const entry = board[ci][vi];
  attemptedPlayers.clear();
  categoryLabel.textContent = `${CATEGORIES[ci]} — $${VALUES[vi]}`;
  clueText.textContent = entry.clue;
  transcriptDisp.textContent = '';
  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');

  tileSelectorIdx = boardController;

  if (dailyDoubles.has(`${ci},${vi}`)) {
    openDailyDouble(ci, vi);
  } else {
    clueHeader.classList.remove('hidden');
    buzzBtn.classList.add('locked');
    showPhase(phaseClue);
    revealClue(entry.clue, activateBuzzing);
  }
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
  wrongAnswers   = [];
  clueHadCorrect = false;
  isDailyDouble  = false;
  currentWager  = 0;
  clueHeader.classList.add('hidden');
  buzzBtn.classList.remove('hidden');
  document.getElementById('buzz-timer-track').classList.remove('hidden');
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
  if (!clueHadCorrect) stumpedCount++;
  setController(tileSelectorIdx);
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

// ── Daily Double ──
function openDailyDouble(ci, vi) {
  isDailyDouble = true;
  const selectorIdx = boardController;
  const player      = PLAYERS[selectorIdx];
  const maxBet      = Math.max(scores[selectorIdx], 1000);

  categoryLabel.textContent = `${CATEGORIES[ci]} — DAILY DOUBLE!`;
  showPhase(phaseBet);

  if (player.isHuman) {
    betInstruction.textContent = `Wager up to $${maxBet.toLocaleString()}`;
    betInput.max   = maxBet;
    betInput.min   = 1;
    betInput.value = '';
    betFormEl.classList.remove('hidden');
    aiBetDisplay.classList.add('hidden');
    betInput.focus();
  } else {
    const accuracy = player.accuracy ?? 1.0;
    const bet      = Math.max(1, Math.round(maxBet * accuracy * (0.7 + Math.random() * 0.3)));
    currentWager   = bet;
    betInstruction.textContent = `${player.name} is wagering…`;
    betFormEl.classList.add('hidden');
    aiBetDisplay.textContent = `$${bet.toLocaleString()}`;
    aiBetDisplay.classList.remove('hidden');
    setTimeout(() => startDailyDoubleClue(ci, vi, selectorIdx), 2500);
  }
}

betSubmitBtn.addEventListener('click', () => {
  const { ci, vi } = activeCell;
  const selectorIdx = boardController;
  const maxBet      = Math.max(scores[selectorIdx], 1000);
  let bet = parseInt(betInput.value, 10);
  if (isNaN(bet) || bet < 1) bet = 1;
  if (bet > maxBet) bet = maxBet;
  currentWager = bet;
  startDailyDoubleClue(ci, vi, selectorIdx);
});

betInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') betSubmitBtn.click();
});

betInput.addEventListener('input', () => {
  const max = parseInt(betInput.max, 10);
  const val = parseInt(betInput.value, 10);
  if (!isNaN(val) && !isNaN(max) && val > max) betInput.value = max;
  if (!isNaN(val) && val < 1) betInput.value = 1;
});

function startDailyDoubleClue(ci, vi, playerIdx) {
  const entry = board[ci][vi];
  clueHeader.classList.remove('hidden');
  buzzBtn.classList.add('hidden');
  document.getElementById('buzz-timer-track').classList.add('hidden');
  showPhase(phaseClue);
  if (PLAYERS[playerIdx].isHuman) {
    revealClue(entry.clue, () => startListening());
  } else {
    revealClue(entry.clue, () => handleAIDailyDouble(playerIdx));
  }
}

async function handleAIDailyDouble(playerIdx) {
  const { ci, vi } = activeCell;
  const entry  = board[ci][vi];
  const player = PLAYERS[playerIdx];

  showPhase(phaseAI);
  aiBuzzName.textContent   = `${player.name} — Daily Double!`;
  aiBuzzStatus.textContent = 'Thinking…';
  aiAnswerReveal.classList.add('hidden');
  aiAnswerReveal.textContent = '';

  let spokenAnswer = '';
  try {
    const res  = await fetch('/api/ai-answer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clue: entry.clue, category: CATEGORIES[ci], value: VALUES[vi], accuracy: player.accuracy ?? 1.0, domain: categoryDomains[ci] ?? 'general', specialties: player.specialties ?? {} }),
    });
    const data = await res.json();
    spokenAnswer = data.answer || '';
  } catch { /* leave empty */ }

  aiBuzzStatus.textContent   = 'Answer:';
  aiAnswerReveal.textContent = `"${spokenAnswer}"`;
  aiAnswerReveal.classList.remove('hidden');
  await sleep(900);
  showPhase(phaseJudging);

  try {
    const judgeRes  = await fetch('/api/judge', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clue: entry.clue, correctAnswer: entry.answer, playerAnswer: spokenAnswer }),
    });
    const judgeData = await judgeRes.json();
    if (judgeData.needsClarification) {
      await handleAIClarification(playerIdx, entry, ci, vi, spokenAnswer);
    } else {
      showResult(playerIdx, judgeData.correct, judgeData.message, entry.answer, currentWager);
    }
  } catch {
    showResult(playerIdx, false, 'Judge unavailable.', entry.answer, currentWager);
  }
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
        clue:        entry.clue,
        category:    CATEGORIES[ci],
        value:       VALUES[vi],
        accuracy:    player.accuracy ?? 1.0,
        domain:      categoryDomains[ci] ?? 'general',
        specialties: player.specialties ?? {},
        wrongAnswers,
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
      if (!judgeData.correct) wrongAnswers.push(spokenAnswer);
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
    showResult(playerIdx, !!data.correct, data.message, entry.answer, isDailyDouble ? currentWager : VALUES[vi]);
  } catch {
    showResult(playerIdx, false, 'Judge unavailable.', entry.answer, isDailyDouble ? currentWager : VALUES[vi]);
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
    const val = isDailyDouble ? currentWager : VALUES[vi];
    if (data.needsClarification) {
      showClarification(spokenText, val);
    } else {
      showResult(0, data.correct, data.message, entry.answer, val);
    }
  } catch {
    showResult(0, false, 'Could not reach the judge.', entry.answer, isDailyDouble ? currentWager : VALUES[vi]);
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

  // ── Stats ──
  const s = playerStats[playerIdx];
  s.attempts++;
  if (isDailyDouble) s.ddAttempts++;
  if (correct) {
    s.correct++;
    s.currentStreak++;
    s.longestStreak = Math.max(s.longestStreak, s.currentStreak);
    s.biggestWin    = Math.max(s.biggestWin, value);
    s.correctPerCat[ci]++;
    if (isDailyDouble) s.ddCorrect++;
    clueHadCorrect = true;
  } else {
    s.currentStreak = 0;
    s.biggestLoss   = Math.max(s.biggestLoss, value);
  }

  const remaining = PLAYERS.filter((_, i) => !attemptedPlayers.has(i));
  const clueOver  = isDailyDouble || correct || remaining.length === 0;

  if (clueOver && !clueHadCorrect) stumpedCount++;

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

  if (clueOver) setController(correct ? playerIdx : tileSelectorIdx);

  showPhase(phaseResult);
  if (clueOver) continueBtn.focus();
  else setTimeout(() => { showPhase(phaseClue); activateBuzzing(); }, 2000);
}

// ── Continue button ──
continueBtn.addEventListener('click', () => {
  const controller = boardController;
  closeModal();
  const anyOpen = board.some(col => col.some(cell => cell.state === 'open'));
  if (!anyOpen) { showBreakdown(); return; }
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

// ── Post-game breakdown ──
function showBreakdown() {
  const el = document.getElementById('game-over');

  const winner     = scores.indexOf(Math.max(...scores));
  const totalClues = CATEGORIES.length * VALUES.length;

  // Category each player dominated
  const catDominator = CATEGORIES.map((_, ci) => {
    const best = playerStats.reduce((a, b) => b.correctPerCat[ci] > a.correctPerCat[ci] ? b : a);
    const idx  = playerStats.indexOf(best);
    return best.correctPerCat[ci] > 0 ? idx : null;
  });

  // Longest streak across all players
  const streakLeader = playerStats.reduce((a, b, i) =>
    b.longestStreak > playerStats[a].longestStreak ? i : a, 0);

  // Best DD moment
  const ddPlayers = playerStats.filter(s => s.ddAttempts > 0);
  const ddBest    = ddPlayers.length
    ? playerStats.reduce((a, b, i) => b.biggestWin > playerStats[a].biggestWin ? i : a, 0)
    : null;

  el.innerHTML = `
    <div id="breakdown-inner">
      <div id="breakdown-winner">
        ${PLAYERS[winner].avatar ? PLAYERS[winner].avatar + ' ' : ''}${PLAYERS[winner].name} wins!
        <div id="breakdown-winner-score">$${scores[winner].toLocaleString()}</div>
      </div>

      <div id="breakdown-players">
        ${PLAYERS.map((p, i) => {
          const s    = playerStats[i];
          const pct  = s.attempts ? Math.round(s.correct / s.attempts * 100) : 0;
          const ddLine = s.ddAttempts
            ? `<div class="bd-stat"><span>Daily Double</span><span>${s.ddCorrect}/${s.ddAttempts}</span></div>`
            : '';
          const streakLine = s.longestStreak >= 2
            ? `<div class="bd-stat"><span>Best streak</span><span>${s.longestStreak} in a row</span></div>`
            : '';
          return `
            <div class="bd-player-card${i === winner ? ' bd-winner' : ''}">
              <div class="bd-name">${p.avatar ? p.avatar + ' ' : ''}${p.name}</div>
              <div class="bd-score">$${scores[i].toLocaleString()}</div>
              <div class="bd-stat"><span>Correct</span><span>${s.correct}/${s.attempts} (${pct}%)</span></div>
              ${ddLine}
              ${streakLine}
            </div>`;
        }).join('')}
      </div>

      <div id="breakdown-highlights">
        <div class="bd-highlight-title">Highlights</div>
        <div id="bd-highlight-grid">
          ${stumpedCount > 0 ? `<div class="bd-highlight"><div class="bd-hl-val">${stumpedCount}</div><div class="bd-hl-label">clue${stumpedCount !== 1 ? 's' : ''} stumped everyone</div></div>` : ''}
          ${playerStats[streakLeader].longestStreak >= 3 ? `<div class="bd-highlight"><div class="bd-hl-val">${playerStats[streakLeader].longestStreak}</div><div class="bd-hl-label">${PLAYERS[streakLeader].name}'s longest streak</div></div>` : ''}
          ${ddBest !== null && playerStats[ddBest].biggestWin > 0 ? `<div class="bd-highlight"><div class="bd-hl-val">$${playerStats[ddBest].biggestWin.toLocaleString()}</div><div class="bd-hl-label">${PLAYERS[ddBest].name}'s biggest Daily Double</div></div>` : ''}
          ${catDominator.map((pi, ci) => pi !== null
            ? `<div class="bd-highlight"><div class="bd-hl-val">${CATEGORIES[ci]}</div><div class="bd-hl-label">owned by ${PLAYERS[pi].name}</div></div>`
            : '').join('')}
        </div>
      </div>

      <button id="play-again-btn">Play Again</button>
    </div>`;

  document.getElementById('play-again-btn').addEventListener('click', () => location.reload());
  el.classList.remove('hidden');
}

// ── Cheat menu ──
document.getElementById('cheat-btn').addEventListener('click', () => {
  document.getElementById('cheat-overlay').classList.remove('hidden');
  document.getElementById('cheat-modal').classList.remove('hidden');
});

function closeCheat() {
  document.getElementById('cheat-overlay').classList.add('hidden');
  document.getElementById('cheat-modal').classList.add('hidden');
}

document.getElementById('cheat-close').addEventListener('click', closeCheat);
document.getElementById('cheat-overlay').addEventListener('click', closeCheat);

document.getElementById('cheat-end-game').addEventListener('click', () => {
  closeCheat();
  if (activeCell) closeModal();
  board.forEach(col => col.forEach(cell => { if (cell.state !== 'done') cell.state = 'done'; }));
  showBreakdown();
});

// ── Boot ──
init();
