// Shared utilities used by server.js, eval.js, and eval-r2.js

const STOP_WORDS = new Set(['the','a','an','of','in','on','at','to','for','and','or','is','was','are','were','be','been','by','with','as','this','that','it','its']);

function normaliseAnswer(answer) {
  return answer
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-zA-Z0-9\s'-]/g, '')
    .trim()
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/).slice(0, 3).join(' ');
}

// Lowercase + strip punctuation normaliser used for leak detection
const norm = s => s.toLowerCase().replace(/[-]/g, ' ').replace(/[^a-z0-9\s]/g, '');

function answerLeaksIntoClue(clue, answer) {
  const clueWords   = norm(clue).split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  const answerWords = norm(answer).split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));
  return answerWords.some(aw => clueWords.some(cw => aw === cw || aw.includes(cw) || cw.includes(aw)));
}

function messageLeaksAnswer(message, answer) {
  const mw = norm(message).split(/\s+/);
  return norm(answer).split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
    .some(aw => mw.some(m => m === aw || m.includes(aw)));
}

module.exports = { STOP_WORDS, normaliseAnswer, norm, answerLeaksIntoClue, messageLeaksAnswer };
