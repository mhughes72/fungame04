# AI Jeopardy!

A Jeopardy game where you compete against AI contestants. Categories and clues are generated fresh each game by GPT-4o. You answer by speaking — the game listens and judges your response.

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

When you open the game an opponent selection screen appears. Pick exactly **2 AI players** to compete against, then click **Start Game** — the board starts generating only after you confirm.

To limit which AI players appear in the selection screen, pass `--players` when starting the server:

```
node server.js --players "HAL 9000,Roxie"
```

Names are case-sensitive and must match exactly what's in `public/players.json`. The human player is always included automatically.

You can also set a `PLAYERS` environment variable instead of the CLI flag — useful for hosted deployments:

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

- A single broad category is revealed — all clues are harder than a regular $1000 clue.
- All players place their wagers secretly. AI wagers are computed using each player's `riskTolerance` setting but kept hidden until the reveal.
- The clue appears and a 30-second timer runs. The human answers by voice; AIs answer simultaneously in the background.
- Answers are revealed one by one, lowest score first. Each answer is judged and scores updated before moving to the next player.

## AI Players

Each AI has a distinct personality and playstyle defined in `public/players.json`. Portrait images are shown on the opponent selection screen and in the scoreboard during play.

| Player | Strengths | Weaknesses | Style |
|---|---|---|---|
| HAL 9000 🤖 | Science | Pop culture, sports | Fast, high accuracy, goes for big value |
| Deep Blue ♟️ | History, sports, geography | Pop culture | Medium speed, sweeps categories |
| The Professor 🎓 | Arts, history, science | Sports, pop culture | Slow but very accurate, big value hunter |
| Roxie 💅 | Pop culture, food | Science, history | Fast, aggressive, random tile selection |
| ARIA 🎲 | Nothing in particular | Nothing in particular | Buzzes on everything, chaotic wildcard |

### Generating Player Images

Player portrait images are stored in `public/images/players/`. To regenerate them (uses DALL-E 3):

```
node generate-player-images.js                    # all AI players, skips existing
node generate-player-images.js --name "Roxie"     # one player only
node generate-player-images.js --replace          # regenerate all
node generate-player-images.js --name "HAL 9000" --replace
```

Images are derived from each player's `appearance` and `personality` fields in `players.json`.

### AI Player Parameters (`players.json`)

| Field | Type | Values | Description |
|---|---|---|---|
| `name` | string | any | Display name shown on the scoreboard |
| `isHuman` | boolean | `true` / `false` | Marks the human player slot |
| `avatar` | string | any emoji | Fallback shown if portrait image is missing |
| `personality` | string | any | Character description used for image generation and (future) reaction dialogue |
| `appearance` | string | any | Visual description used as the DALL-E 3 image prompt |
| `strategy` | string | `highValue` `sweepCategory` `random` | Tile selection behaviour. `highValue` prioritises $800–$1000 tiles; `sweepCategory` completes one category before moving on; `random` picks randomly. |
| `speed` | string | `fast` `medium` `slow` | How quickly the AI buzzes in. `fast` ≈ 1–2s, `medium` ≈ 2–4s, `slow` ≈ 4–6s after the clue finishes. |
| `accuracy` | number | 0.0–1.0 | Base probability of answering correctly on a neutral clue. Modified by `specialties` per domain. |
| `specialties` | object | multipliers per domain | Per-domain accuracy multipliers. `1.0` = no change; `>1.0` = boosted; `<1.0` = weakened. Domains: `science`, `history`, `popculture`, `sports`, `arts`, `geography`, `food`, `general`. |
| `riskTolerance` | string | `aggressive` `conservative` `calculated` | Final Jeopardy wagering style. |
| `buzzAggressiveness` | number | 0.0–2.0 | *(not yet active)* Multiplier on per-question buzz probability. |
| `reactionVoice` | string | `clinical` `snarky` `warm` `dramatic` | *(not yet active)* Tone of AI result message feedback. |

## Post-Game Breakdown

After Final Jeopardy, a breakdown screen shows:

- Final scores and winner
- Each player's correct/attempt count and accuracy %
- Daily Double record per player
- Longest answer streak
- Highlights: stumped clues, category dominance, biggest Daily Double swing

## Cheat Menu

A **Cheat** button in the top-right header provides developer shortcuts:

- **Skip to Double Jeopardy** — marks all round 1 tiles done and jumps straight to the Double Jeopardy transition
- **Skip to Final Jeopardy** — awards each player a random $0–$5,000 bonus, then jumps to Final Jeopardy
- **End Game Now** — immediately triggers the post-game breakdown with current scores

## Clue Quality

Several mechanisms run at generation time to keep clues accurate and fair:

- **Answer leak detection** — clues are scanned to ensure no word from the answer appears in the clue text. Leaking clues are individually rewritten rather than regenerating the whole category.
- **Fact-checking** — each clue is independently fact-checked by o4-mini (a separate reasoning model from the GPT-4o generator). Using a different model avoids self-confirmation bias.
- **Category blocklist** — category types that reliably produce hallucinated clues are blocked: abstract word-puzzle categories (palindromes, anagrams), etymology categories, and fictional mashup categories.
- **Answer deduplication** — recently seen answers are tracked in `used-answers.json` and excluded from future generations.
- **Category deduplication** — category themes are tracked in `used-categories.json` and excluded from future games. Names are kept short (2–5 words) to avoid the model generating verbose subtitle-style names.

## Mobile

The game is playable on tablet and phone:

- On screens ≤640px the board becomes a **horizontal scroll-snap** view — one category per page, swipe left/right to navigate. Gold dot indicators below the board show your position.
- The buzz-in flow, clue modal, and Final Jeopardy screens are all mobile-friendly as-is.
- Requires Chrome on Android or Safari on iOS for Web Speech API support.

## Eval Suite

Start the server first, then run evals in a separate terminal:

**Round 1 eval:**
```
node eval.js
```
Covers: judge accuracy, clarification round-trips, clue leak detection, difficulty spread, AI calibration, factual accuracy, category freshness, API latency. Takes ~5–6 minutes.

**Double Jeopardy eval:**
```
node eval-r2.js
```
Covers: R2 values, difficulty calibration vs Round 1, clue quality, category freshness. Takes ~3–4 minutes.

Results export to timestamped `eval-results-*.json` / `eval-r2-results-*.json` files.

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: OpenAI GPT-4o (category + clue generation), o4-mini (fact-checking), GPT-4o-mini (AI answers + judging), DALL-E 3 (player portraits)
- **Speech**: Web Speech API (Chrome / Safari)
- **Frontend**: Vanilla JS, no framework
