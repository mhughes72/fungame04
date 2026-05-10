# AI Jeopardy!

A multiplayer Jeopardy game where you compete against AI contestants. Categories and clues are generated fresh each game by GPT-4o-mini. You answer by speaking — the game listens and judges your response.

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

- The board controller selects a tile. AIs select automatically based on their strategy.
- Once the clue finishes printing, buzz in with the **BUZZ IN** button and speak your answer. You have 5 seconds.
- If your answer is ambiguous (e.g. a surname that could match multiple people) you'll be asked to be more specific.
- AIs buzz in on a timer based on their speed. Multiple players can attempt the same clue if the first answer is wrong.
- Correct answers award the tile value; wrong answers deduct it. Scores can go negative.

## Daily Double

Two random tiles per game are Daily Doubles (hidden until revealed).

- Only the player who selected the tile gets to answer — others watch.
- Before the clue appears, you wager between $1 and your current score (minimum $1,000 if your score is below that).
- The clue then reveals and the 5-second answer timer starts automatically — no buzzing required.
- Win the wager on a correct answer, lose it on a wrong one.

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
| `riskTolerance` | string | `aggressive` `conservative` `calculated` | *(not yet active)* Daily Double wagering style. `aggressive` = wager high; `conservative` = wager low; `calculated` = wager based on score position. |
| `buzzAggressiveness` | number | 0.0–2.0 | *(not yet active)* Multiplier on per-question buzz probability. `1.0` = default; `2.0` = buzzes on nearly everything; `0.5` = much more selective. |
| `reactionVoice` | string | `clinical` `snarky` `warm` `dramatic` | *(not yet active)* Tone of the AI's result message feedback shown after answers. |

## Post-Game Breakdown

After the last tile is answered (or via the Cheat menu), a breakdown screen shows:

- Final scores and winner
- Each player's correct/attempt count and accuracy %
- Daily Double record per player
- Longest answer streak
- Highlights: stumped clues, category dominance, biggest Daily Double swing

## Cheat Menu

A **Cheat** button in the top-right header opens a menu with developer shortcuts:

- **End Game Now** — immediately triggers the post-game breakdown with current scores

## Clue Quality

Several mechanisms run at generation time to keep clues accurate and fair:

- **Answer leak detection** — clues are scanned to ensure no word from the answer appears in the clue text. Any leaking clue is individually rewritten (up to 3 passes) rather than regenerating the whole category.
- **Fact-checking** — each clue is independently fact-checked by a second model pass (nationalities, dates, record counts, attributions). Errors are corrected before the clue reaches the board.
- **Answer deduplication** — answers are tracked across games in `used-answers.json`. Recently seen answers are excluded from future generations to prevent repetition.

## Eval Suite

Run `node eval.js` (with the server running) to execute the full quality test suite. It covers:

- Judge accuracy & consistency
- Clarification round-trips
- Clue leak detection
- Difficulty spread & inversions
- Category coherence
- AI accuracy calibration & specialty effectiveness
- Wrong answer plausibility & isolation
- Board answer uniqueness & domain diversity
- Clue phrasing validation
- Factual accuracy (independent fact-check)
- Clue-answer logical fit
- API latency

Results are exported to a timestamped `eval-results-*.json` file.

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: OpenAI GPT-4o-mini (category generation, clue writing, AI answers, judging)
- **Speech**: Web Speech API (Chrome only)
- **Frontend**: Vanilla JS, no framework
