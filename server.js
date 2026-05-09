require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set in .env');
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Step 1: generate category names only (fast)
app.get('/api/categories', async (req, res) => {
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 100,
      temperature: 1.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user',   content: 'Generate 6 diverse, creative Jeopardy category names — mix subjects like history, science, pop culture, language, geography, sports, arts. Return JSON: { "categories": ["name1", "name2", "name3", "name4", "name5", "name6"] }' },
      ],
    });
    const json = JSON.parse(completion.choices[0].message.content);
    res.json(json);
  } catch (err) {
    console.error('Categories error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: generate all 5 clues for one category
app.post('/api/category', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      temperature: 1.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a Jeopardy clue writer. Rules:
- Difficulty must escalate clearly from $200 (easy) to $1000 (hard/obscure)
- The answer must NEVER appear in the clue text — not even a partial or adjectival form
- Clues should be specific and avoid the most obvious facts
Return JSON only.`,
        },
        {
          role: 'user',
          content: `Write 5 Jeopardy clues for the category "${name}" at values $200, $400, $600, $800, $1000. Return JSON:
{ "clues": [
  { "value": 200,  "clue": "...", "answer": "..." },
  { "value": 400,  "clue": "...", "answer": "..." },
  { "value": 600,  "clue": "...", "answer": "..." },
  { "value": 800,  "clue": "...", "answer": "..." },
  { "value": 1000, "clue": "...", "answer": "..." }
] }`,
        },
      ],
    });
    const json = JSON.parse(completion.choices[0].message.content);
    res.json(json);
  } catch (err) {
    console.error(`Category "${name}" error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Base miss probability by dollar value for a perfect (accuracy=1.0) player
const BASE_MISS = { 200: 0.05, 400: 0.15, 600: 0.30, 800: 0.45, 1000: 0.60 };

// Generate an AI player's answer
app.post('/api/ai-answer', async (req, res) => {
  const { clue, category, value, accuracy = 1.0, clarification = false, previousAnswer = '' } = req.body;

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
      const missChance = 1 - (accuracy * (1 - base));
      const shouldMiss = Math.random() < missChance;
      messages = [
        {
          role: 'system',
          content: shouldMiss
            ? 'You are a Jeopardy contestant who is unsure of this one. Give a plausible but incorrect answer — same category and era as the right answer, but wrong. No explanation, just the answer itself.'
            : 'You are a Jeopardy contestant. Give only your answer — no explanation, no "What is", just the answer itself.',
        },
        { role: 'user', content: `Category: ${category} ($${value})\nClue: ${clue}\nWhat is your answer?` },
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

// Judge a player's spoken answer
app.post('/api/judge', async (req, res) => {
  const { clue, correctAnswer, playerAnswer, clarification } = req.body;
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
- Accept reasonable variations: adjectival/demonym forms, plural/singular, nicknames, minor spelling differences, and surnames alone when they unambiguously identify one person.
- If the player gives a first AND last name, both must identify the correct person — a wrong first name with the right surname (e.g. "Teddy Roosevelt" when the answer is "Franklin Roosevelt") is incorrect, not a partial match.
- Ignore "What is" / "Who is" phrasing.
- If the answer is incorrect, do NOT reveal or hint at the correct answer, and do not explain why it is wrong — other players may still buzz in. Keep incorrect feedback generic (e.g. "That is incorrect.").
- CLARIFICATION RULE: if the player gave only a surname (or partial name) that is genuinely ambiguous — meaning multiple distinct, well-known people with that surname could each plausibly be the answer to this specific clue — set needsClarification=true instead of marking it incorrect. Only do this when the ambiguity is real given the clue; if the clue clearly points to one person, accept the surname.
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
