// Shared infrastructure for eval.js and eval-r2.js

require('dotenv').config();
const OpenAI = require('openai');

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

module.exports = { BASE, openai, timed, post, get, gptRate, G, R, Y, C, B, pass, fail, warn, section };
