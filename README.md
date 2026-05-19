# Definitely not an AI rip-off of Jeopardy!

A Jeopardy game where you compete against AI contestants. Categories and clues are generated fresh each game by GPT-4o. You answer by speaking — the game listens and judges your response.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a `.env` file in the root with your API keys:
   ```
   OPENAI_API_KEY=sk-...
   ELEVENLABS_API_KEY=sk-...   # optional — host voice; game runs fine without it
   ```

3. Start the server:
   ```
   node server.js
   ```
   To enable the Sound Manager UI, start with `--dev`:
   ```
   node server.js --dev
   ```
   Without `--dev`, `/sounds-manager.html` returns 404 and the sound write/generate/delete APIs are blocked. Use `--dev` locally only — never in a public deployment.

4. Open `http://localhost:3000` in Chrome (Web Speech API required).

## Selecting AI Players

When you open the game an opponent selection screen appears. Pick exactly **2 AI players** to compete against, then click **Start Game** — the board starts generating only after you confirm.

To limit which AI players appear in the selection screen, pass `--players` when starting the server:

```
node server.js --players "Rick Donovan,Debbie Fontaine"
```

Names are case-sensitive and must match exactly what's in `public/players.json`. The human player is always included automatically.

You can also set a `PLAYERS` environment variable instead of the CLI flag — useful for hosted deployments:

```
PLAYERS="Rick Donovan,Carol Ashworth" node server.js
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

Each AI is a human game-show contestant with a distinct personality and playstyle defined in `public/players.json`. Portrait images are shown on the opponent selection screen and in the scoreboard during play. Portraits are generated in a 1970s–1980s network TV photographic style (warm Kodachrome film, studio lighting).

| Player | Strengths | Weaknesses | Style |
|---|---|---|---|
| Rick Donovan 🚀 | Science | Pop culture, sports | Fast, high accuracy, goes for big value |
| Carol Ashworth 📚 | History, sports, geography | Pop culture | Medium speed, sweeps categories |
| Dr. Edmund Fitch 🎓 | Arts, history, science | Sports, pop culture | Slow but very accurate, big value hunter |
| Debbie Fontaine 💅 | Pop culture, food | Science, history | Fast, aggressive, random tile selection |
| Dale Kowalski 🔧 | Nothing in particular | Nothing in particular | Buzzes on everything, chaotic wildcard |
| Bobol Programer 🖥️ | Science | Sports, arts | Medium speed, calculated, big value hunter |

### Generating Player Images

Player portrait images are stored in `public/images/players/`. To generate them (uses DALL-E 3, requires server to be stopped):

```
node generate-player-images.js                             # all players missing a portrait
node generate-player-images.js --name "Debbie Fontaine"    # one player only
node generate-player-images.js --replace                   # regenerate everyone
node generate-player-images.js --name "Dale Kowalski" --replace
node generate-player-images.js --host                      # generate host portrait (public/images/host.png)
```

Images are derived from each player's `appearance` and `personality` fields in `players.json`.

### Creating a New Player

Generate a fully-configured player from a plain-English description:

```
node generate-player-images.js --create "a nervous librarian from Ohio who knows everything about classic literature"
```

This calls GPT-4o to produce a complete player JSON (name, stats, specialties, personality, appearance), appends it to `players.json`, and generates a DALL-E portrait. Restart the server after running to see the new player in the selection screen.

Some examples:

```
node generate-player-images.js --create "a retired rodeo cowboy from Amarillo, confident about everything"
node generate-player-images.js --create "a competitive crossword champion who freezes under pressure"
node generate-player-images.js --create "a diner waitress from New Jersey who has seen it all"
```

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

## Host Commentary

**Chuck Pendleton** hosts the show from a fixed corner panel (bottom-left) that floats above all game screens. Commentary fires automatically throughout the game — no setup required.

Two types of lines:

- **Lookup table** — instant canned lines for timing-sensitive moments (buzz window, correct/wrong answers, Daily Double reveal, round transitions). Several variants per event, picked at random. Some events fire at reduced probability so commentary doesn't become repetitive.
- **GPT-generated** — context-aware one-liners for moments where the specific game state matters: correct answers on $600+ clues (mentions the player and category), wrong answers on $200–$400 clues (gentle dig), Final Jeopardy wager reveal, and the game-over closing line. Fired async so they never block gameplay — the line appears a beat after the event.

| Event | Type | Notes |
|---|---|---|
| Game start | Lookup | Fires once when the board loads |
| Buzz window opens | Lookup | 35% chance — not every clue |
| Correct answer (≤$400) | Lookup | Generic congratulations |
| Correct answer (≥$600) | GPT | Names the player and category |
| Wrong answer (≥$600) | Lookup | Generic commiseration |
| Wrong answer (≤$400) | GPT | Gentle dig at the player |
| No buzz / timeout | Lookup | 65% chance |
| Daily Double | Lookup | Always fires |
| Double Jeopardy | Lookup | Always fires |
| Final Jeopardy | Lookup | Always fires |
| FJ wager locked | GPT | Reacts to the specific wager amount |
| Game over | GPT | Names the winner and score |

### Generating the Host Portrait

```
node generate-player-images.js --host
```

Saves to `public/images/host.png`. Uses the same 1970s Kodachrome TV style as the player portraits. If no portrait is present, the host panel shows without an image and commentary still works.

## Post-Game Breakdown

After Final Jeopardy, a breakdown screen shows:

- Final scores and winner
- Each player's correct/attempt count and accuracy %
- Daily Double record per player
- Longest answer streak
- Highlights: stumped clues, category dominance, biggest Daily Double swing

## Sound Effects

Game sounds are generated using ElevenLabs and managed through either the **Sound Manager UI** or the **`sounds.js` CLI**. Every event supports a **pool** — the game picks randomly from the pool each time the event fires. Pools of one always play the same sound. All sounds are optional; the game falls back to silence for any event with no active pool.

**Supported events:**

| Event | Fires when |
|---|---|
| `correct` | Any player answers correctly |
| `correct-voice` | Any player answers correctly (layered with `correct`) |
| `wrong` | Any player answers incorrectly |
| `wrong-voice` | Any player answers incorrectly (layered with `wrong`) |
| `buzz` | Human player buzzes in |
| `timeout` | Buzz window expires with no answer |
| `daily-double` | Daily Double tile is revealed |
| `double-jeopardy` | Double Jeopardy transition starts |
| `final-jeopardy` | Final Jeopardy screen opens |
| `game-over` | Post-game breakdown is shown |
| `loading` | Board is generating (round 1 and round 2) |

**Layering:** `correct` and `correct-voice` (and `wrong` / `wrong-voice`) play simultaneously — use one for an SFX sting and the other for a spoken host reaction.

Candidates are saved to `public/sounds/candidates/`. The active pool configuration and per-event volumes live in `public/sounds/manifest.json`.

## Sound Manager

The easiest way to manage sounds is the browser-based Sound Manager at `http://localhost:3000/sounds-manager.html`.

**Left panel — generate and browse:**

1. Click **Generate New Sound** to expand the form.
2. Choose **SFX** (ElevenLabs sound-generation from a text prompt) or **Voice (TTS)** (spoken line using ElevenLabs TTS).
   - SFX fields: prompt, duration (seconds), number of variants to generate at once.
   - Voice fields: text to speak, ElevenLabs voice ID (defaults to the host voice), number of variants.
3. Hit **Generate** — each clip appears in the **Just Generated** section as it finishes.
4. For each generated clip: **▶ Play** to audition it, **Keep** to move it to the candidates list, **Discard** to delete it, or use the **Add to event** dropdown to assign it directly to an event pool.
5. The **Candidates** list below shows all saved clips. Each card shows the type badge, the prompt or text, and a **loudness meter** (RMS bar + peak tick + dB reading in green/amber/red). Drag any card to an event slot on the right to add it to that pool.

**Right panel — event slots:**

- Each event has a drop zone showing its current pool.
- The **vol** slider on each event sets playback volume (0–100%). This is what the game uses and what you hear when previewing from the pool chips. Use it to balance SFX against voice, or quiet down a looping ambient clip.
- Pool chips have a **▶** button to preview at the event's current volume, and **✕** to remove from the pool (the file stays in candidates).
- Changes auto-save to `manifest.json` 600 ms after the last edit.

## `sounds.js` CLI

For scripted or bulk generation, use the CLI tool directly:

**Generate candidates:**

```bash
# SFX from a text prompt (ElevenLabs sound-generation)
node sounds.js sfx "triumphant game show ding, correct answer" --name correct --duration 2
node sounds.js sfx "harsh wrong answer buzzer, 1970s TV" --name wrong --duration 2
node sounds.js sfx "exciting daily double fanfare" --name daily-double --duration 3

# Spoken lines using your host voice (ElevenLabs TTS)
node sounds.js tts "That is correct!" --name correct-voice --variants 5
node sounds.js tts "Daily Double!" --name daily-double
node sounds.js tts "Double Jeopardy!" --name double-jeopardy
node sounds.js tts "Final Jeopardy!" --name final-jeopardy
```

**Preview and activate:**

```bash
node sounds.js list                     # show all candidates and active pools
node sounds.js preview correct-voice-2  # play a candidate

node sounds.js use correct-5            # set correct pool to just correct-5
node sounds.js use correct-voice-1      # set correct-voice pool to just correct-voice-1
node sounds.js add correct-voice-3      # add to pool — game now picks randomly between 1 and 3
node sounds.js add correct-voice-5      # pool is now 3 deep
```

**Modify pools:**

```bash
node sounds.js remove correct-voice-3   # remove from pool, keep the file
node sounds.js clear correct-voice      # empty the pool entirely (keeps files)
node sounds.js clear correct-voice-2    # delete a candidate file and remove from pool
```

**Import existing files:**

```bash
node sounds.js register correct-5 correct-6   # add files already in candidates/ to the manifest
```

## Host Voice

Chuck Pendleton's category announcements are spoken aloud using ElevenLabs TTS. When the board loads, all six category names are pre-generated in the background so audio is ready the instant a tile is clicked — no latency added to gameplay. If ElevenLabs is unavailable or the quota is exhausted the game continues silently.

To use a custom voice, replace `HOST_VOICE_ID` in `server.js` with your ElevenLabs Voice ID (find it in your ElevenLabs dashboard under Voices). The same voice ID is pre-filled in the Sound Manager's Voice (TTS) generation form.

## Header Buttons

Three buttons are always visible in the top-right header, even during the loading screen and player selection:

- **Help** — full how-to-play guide covering buzzing, answering, Daily Doubles, rounds, and AI opponent behaviour
- **About** — GitHub link and AI tech stack breakdown
- **Cheat** — developer shortcuts (see below)

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

## Visual Style

The game renders with a CRT television aesthetic:

- **Scanlines** — semi-transparent horizontal stripes overlaid at full viewport size
- **Vignette** — darkened edges simulating the curved glass of a tube TV
- **Phosphor glow** — text-shadow bloom on gold scores, category headers, and key banners
- **Grain** — subtle SVG `feTurbulence` noise texture at low opacity
- **Flicker** — occasional brightness dip (~once every 8 seconds) via CSS animation
- **Screen edge shadow** — outer ambient glow + inner depth shadow on the body element
- **Chromatic aberration** — slight red/blue lateral offset on the main title and winner headline
- **Dark bezel** — `html` background is near-black so the page looks like a screen in a cabinet

All effects are pure CSS — no canvas, no JS.

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: OpenAI GPT-4o (category + clue generation, new player creation), o4-mini (fact-checking), GPT-4o-mini (AI answers, judging, host commentary), DALL-E 3 (player and host portraits)
- **Voice**: ElevenLabs TTS (host category announcements, pre-cached at board load)
- **Speech**: Web Speech API (Chrome / Safari)
- **Tracing**: LangSmith
- **Frontend**: Vanilla JS, no framework
