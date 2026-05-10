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

| Field | Description |
|---|---|
| `strategy` | Tile selection: `highValue`, `sweepCategory`, or `random` |
| `speed` | Buzz timing: `fast`, `medium`, or `slow` |
| `accuracy` | Base probability of knowing the correct answer (0.0–1.0) |
| `specialties` | Per-domain accuracy multipliers. Values above 1.0 boost accuracy, below 1.0 reduce it. Domains: `science`, `history`, `popculture`, `sports`, `arts`, `geography`, `food`, `general` |
| `riskTolerance` | *(not yet active)* `aggressive`, `conservative`, or `calculated` — Daily Double wagering style |
| `buzzAggressiveness` | *(not yet active)* 0.0–2.0 multiplier on per-question buzz probability |
| `reactionVoice` | *(not yet active)* `clinical`, `snarky`, `warm`, or `dramatic` — tone of result message feedback |

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
