# AI Jeopardy!

A multiplayer Jeopardy game where you compete against AI contestants. Categories and clues are generated fresh each game by GPT-4o. You answer by speaking — the game listens and judges your response.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file in the root with your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-...
   ```

3. Start the server:
   ```
   node server.js
   ```

4. Open `http://localhost:3000` in Chrome (Web Speech API required).

## Selecting AI Players

By default all AI players join the game. To pick specific opponents, pass `--players` when starting the server:

```
node server.js --players "HAL 9000,Roxie"
node server.js --players "The Professor,ARIA,Deep Blue"
```

Names are case-sensitive and must match exactly what's in `public/players.json`. The human player is always included automatically.

You can also set a `PLAYERS` environment variable instead of the CLI flag — useful for hosted deployments (e.g. Railway):

```
PLAYERS="HAL 9000,Deep Blue" node server.js
```

## Gameplay

A full game runs three rounds: Jeopardy, Double Jeopardy, and Final Jeopardy.

- The board controller selects a tile. AIs select automatically based on their strategy.
- Once the clue finishes printing, buzz in with the **BUZZ IN** button and speak your answer. You have 5 seconds.
- If your answer is ambiguous (e.g. a surname that could match multiple people) you'll be asked to be more specific.
- AIs buzz in on a timer based on their speed. Multiple players can attempt the same clue if the first answer is wrong.
- Correct answers award the tile value; wrong answers deduct it. Scores can go negative.

## Double Jeopardy

After the first board is cleared, the game transitions to Double Jeopardy:

- A fresh board of 6 categories is generated with doubled values ($400–$2000).
- Clues are harder — the easiest Double Jeopardy clue requires study; the $2000 clue is expert-level.
- The player in last place controls the board at the start of the round.
- Two Daily Doubles are reassigned to the new board.

## Daily Double

Two random tiles per round are Daily Doubles (hidden until revealed).

- Only the player who selected the tile gets to answer — others watch.
- Before the clue appears, you wager between $0 and your current score.
- The clue then reveals and the 5-second answer timer starts automatically — no buzzing required.
- Win the wager on a correct answer, lose it on a wrong one.

## Final Jeopardy

After Double Jeopardy, all players compete in one final clue:

- A single broad category (e.g. "American History", "World Literature") is revealed — all clues are harder than a regular $1000 clue.
- All players place their wagers secretly. AI wagers are computed using each player's `riskTolerance` setting but kept hidden until the reveal.
- The clue appears and a 30-second timer runs. The human answers by voice; AIs answer simultaneously in the background.
- Answers are revealed one by one, lowest score first. Each answer is judged and scores updated before moving to the next player.

## AI Players

Each AI has a distinct personality defined in `public/players.json`:

| Player | Strengths | Weaknesses | Style |
|---|---|---|---|
| HAL 9000 🤖 | Science | Pop culture, sports | Fast, high accuracy, goes for big value |
| Deep Blue ♟️ | History, sports, geography | Pop culture | Medium speed, sweeps categories |
| The Professor 🎓 | Arts, history, science | Sports, pop culture | Slow but very accurate, big value hunter |
| Roxie 💅 | Pop culture, food | Science, history | Fast, aggressive, random tile selection |
| ARIA 🎲 | Nothing in particular | Nothing in particular | Buzzes on everything, chaotic wildcard |

### AI Player Parameters (`players.json`)

| Field | Type | Values | Description |
|---|---|---|---|
| `name` | string | any | Display name shown on the scoreboard |
| `isHuman` | boolean | `true` / `false` | Marks the human player slot. Only one entry should have this set. |
| `avatar` | string | any emoji | Shown next to the player's name |
| `strategy` | string | `highValue` `sweepCategory` `random` | Tile selection behaviour. `highValue` prioritises $800–$1000 tiles; `sweepCategory` completes one category before moving on; `random` picks randomly. |
| `speed` | string | `fast` `medium` `slow` | How quickly the AI buzzes in. `fast` ≈ 1–2s, `medium` ≈ 2–4s, `slow` ≈ 4–6s after the clue finishes. |
| `accuracy` | number | 0.0–1.0 | Base probability of answering correctly on a neutral clue. Modified by `specialties` per domain. A value of `1.0` means the AI will answer correctly unless the clue is very hard. |
| `specialties` | object | multipliers per domain | Per-domain accuracy multipliers applied on top of `accuracy`. `1.0` = no change; `>1.0` = boosted; `<1.0` = weakened. Available domains: `science`, `history`, `popculture`, `sports`, `arts`, `geography`, `food`, `general`. Example: `"science": 1.5` means the AI is 50% more likely to answer science questions correctly. |
| `riskTolerance` | string | `aggressive` `conservative` `calculated` | Final Jeopardy wagering style. `aggressive` = wager 80–100% of score; `conservative` = wager 10–30%; `calculated` = wager defensively when leading, aggressively when trailing. |
| `buzzAggressiveness` | number | 0.0–2.0 | *(not yet active)* Multiplier on per-question buzz probability. `1.0` = default; `2.0` = buzzes on nearly everything; `0.5` = much more selective. |
| `reactionVoice` | string | `clinical` `snarky` `warm` `dramatic` | *(not yet active)* Tone of the AI's result message feedback shown after answers. |

## Post-Game Breakdown

After Final Jeopardy, a breakdown screen shows:

- Final scores and winner
- Each player's correct/attempt count and accuracy %
- Daily Double record per player
- Longest answer streak
- Highlights: stumped clues, category dominance, biggest Daily Double swing

## Cheat Menu

A **Cheat** button in the top-right header is always accessible, even when a modal is open. It provides developer shortcuts:

- **Skip to Double Jeopardy** — marks all round 1 tiles done and jumps straight to the Double Jeopardy transition
- **Skip to Final Jeopardy** — awards each player a random $0–$5,000 bonus, then jumps to Final Jeopardy
- **End Game Now** — immediately triggers the post-game breakdown with current scores

## Clue Quality

Several mechanisms run at generation time to keep clues accurate and fair:

- **Answer leak detection** — clues are scanned to ensure no word from the answer appears in the clue text. Any leaking clue is individually rewritten (up to 5 passes) rather than regenerating the whole category.
- **Fact-checking** — each clue is independently fact-checked by o4-mini (a separate reasoning model from the GPT-4o generator). The checker explicitly enumerates every factual claim before verifying, and rewrites any claim it cannot confirm. Using a different model avoids self-confirmation bias.
- **Category blocklist** — certain category types that reliably produce hallucinated clues are blocked at generation time: abstract word-puzzle categories (palindromes, anagrams, spoonerisms), etymology categories (word origins are notoriously hard to verify), and fictional mashup categories that invite inventing things that don't exist (e.g. "Foods Inspired by the Cosmos").
- **Answer deduplication** — answers are tracked across games in `used-answers.json`. Recently seen answers are excluded from future generations to prevent repetition.
- **Category deduplication** — category themes are tracked in `used-categories.json` and excluded from future games to prevent thematic repetition.

## Eval Suite

Start the server first, then run the evals in a separate terminal:

```
node server.js
```

**Round 1 eval** — general clue quality, judge accuracy, AI calibration:

```
node eval.js
```

Covers: judge accuracy & consistency, clarification round-trips, clue leak detection, difficulty spread & inversions, category coherence, AI accuracy calibration & specialty effectiveness, wrong answer plausibility & isolation, board answer uniqueness & domain diversity, clue phrasing validation, factual accuracy (independent fact-check), clue-answer logical fit, difficulty absolute calibration ($200 vs $1000), answer normalisation unit tests, category repetition across back-to-back games, API latency.

Results are exported to a timestamped `eval-results-*.json` file. Takes ~5–6 minutes.

**Double Jeopardy eval** — Round 2-specific quality testing:

```
node eval-r2.js
```

Covers: correct R2 values ($400–$2000), clue leak detection on R2 clues, difficulty spread & absolute calibration ($400 = medium, $2000 = expert), comparative difficulty vs Round 1, category coherence, factual accuracy, clue-answer logical fit, clue phrasing validation, category freshness between rounds, API latency.

Results are exported to a timestamped `eval-r2-results-*.json` file. Takes ~3–4 minutes.

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: OpenAI GPT-4o (category generation, clue writing), o4-mini (fact-checking), GPT-4o-mini (AI player answers, judging)
- **Speech**: Web Speech API (Chrome only)
- **Frontend**: Vanilla JS, no framework
