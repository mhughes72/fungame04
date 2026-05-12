// sim.js — AI player performance simulation
// Tests all AI players across real generated clues to diagnose win/loss balance.
// Usage: node sim.js [--cats N] [--rounds N]
// Requires the server running: node server.js  (~3-5 minutes for defaults)

const fs = require('fs');
const { post, get, G, R, Y, C, B, pass, fail, warn, section } = require('./eval-shared');

const ARGS    = process.argv.slice(2);
const argVal  = key => { const i = ARGS.indexOf(key); return i !== -1 ? +ARGS[i + 1] : null; };
const N_CATS  = argVal('--cats')   ?? 4;  // categories per board
const N_ROUNDS = argVal('--rounds') ?? 3;  // boards to simulate

// Mirror game.js constants
const R1_VALUES      = [200, 400, 600, 800, 1000];
const AI_BUZZ_CHANCE = [0.97, 0.88, 0.72, 0.55, 0.40];

// Theoretical miss rate from the server formula, for comparison
const BASE_MISS = { 200: 0.03, 400: 0.10, 600: 0.20, 800: 0.32, 1000: 0.45 };
function theoreticalMiss(accuracy, value) {
  return 1 - (accuracy * (1 - (BASE_MISS[value] ?? 0.3)));
}
function theoreticalEV(accuracy, value, vi) {
  const buzz = AI_BUZZ_CHANCE[vi];
  const miss = theoreticalMiss(accuracy, value);
  return buzz * ((1 - miss) * value - miss * value);
}

function mkStats(player) {
  const byValue = {};
  R1_VALUES.forEach(v => { byValue[v] = { buzzed: 0, correct: 0, wrong: 0, net: 0 }; });
  return { player, buzzed: 0, correct: 0, wrong: 0, net: 0, byValue, byDomain: {} };
}

// Simulate all players on a single clue in parallel
async function simulateClue(clue, vi, domain, players) {
  const attempts = await Promise.all(players.map(async player => {
    if (Math.random() > (AI_BUZZ_CHANCE[vi] ?? 0.7)) return { player, buzzed: false };

    let answer = '';
    try {
      const d = await post('/api/ai-answer', {
        clue:        clue.clue,
        category:    clue.category,
        value:       clue.value,
        accuracy:    player.accuracy ?? 1.0,
        domain,
        specialties: player.specialties ?? {},
      });
      answer = d.answer || '';
    } catch {}

    return { player, buzzed: true, answer };
  }));

  // Judge all buzzing players in parallel
  return Promise.all(attempts.map(async a => {
    if (!a.buzzed) return a;
    try {
      const d = await post('/api/judge', {
        clue:          clue.clue,
        correctAnswer: clue.answer,
        playerAnswer:  a.answer,
      });
      return { ...a, correct: !!d.correct };
    } catch {
      return { ...a, correct: false };
    }
  }));
}

async function main() {
  console.log(`\n${B('═'.repeat(68))}`);
  console.log(B('  AI JEOPARDY — PLAYER PERFORMANCE SIM'));
  console.log(B('═'.repeat(68)));
  console.log(`  ${N_ROUNDS} board(s) × ${N_CATS} categories × 5 clues = ${N_ROUNDS * N_CATS * 5} clues total\n`);

  let players;
  try {
    players = (await get('/api/players')).filter(p => !p.isHuman);
  } catch {
    console.error(R('Cannot reach server — start with: node server.js'));
    process.exit(1);
  }
  console.log(`  Testing: ${players.map(p => C(p.name)).join(', ')}\n`);

  const stats = {};
  players.forEach(p => { stats[p.name] = mkStats(p); });
  let totalClues = 0;

  for (let round = 0; round < N_ROUNDS; round++) {
    section(`BOARD ${round + 1} / ${N_ROUNDS}`);

    let cats;
    try { cats = await get('/api/categories'); }
    catch { console.log(warn('Could not fetch categories — skipping board')); continue; }

    const sample = cats.categories.slice(0, N_CATS);

    for (const cat of sample) {
      const name   = typeof cat === 'object' ? cat.name   : cat;
      const domain = typeof cat === 'object' ? cat.domain : 'general';
      process.stdout.write(`  ${B(name)} ${C(`(${domain})`)}… `);

      let data;
      try { data = await post('/api/category', { name }); }
      catch { console.log(warn('request failed')); continue; }
      if (!data.clues?.length) { console.log(warn('no clues')); continue; }
      console.log(`${data.clues.length} clues`);

      for (const clue of data.clues) {
        const vi = R1_VALUES.indexOf(clue.value);
        if (vi === -1) continue;
        totalClues++;

        const results = await simulateClue({ ...clue, category: name }, vi, domain, players);

        for (const r of results) {
          if (!r.buzzed) continue;
          const s = stats[r.player.name];

          s.buzzed++;
          s.byValue[clue.value].buzzed++;

          if (!s.byDomain[domain]) s.byDomain[domain] = { buzzed: 0, correct: 0, wrong: 0, net: 0 };
          s.byDomain[domain].buzzed++;

          if (r.correct) {
            s.correct++;
            s.net += clue.value;
            s.byValue[clue.value].correct++;
            s.byValue[clue.value].net += clue.value;
            s.byDomain[domain].correct++;
            s.byDomain[domain].net += clue.value;
          } else {
            s.wrong++;
            s.net -= clue.value;
            s.byValue[clue.value].wrong++;
            s.byValue[clue.value].net -= clue.value;
            s.byDomain[domain].wrong++;
            s.byDomain[domain].net -= clue.value;
          }
        }
      }
    }
  }

  // ── Per-player results ──
  section('RESULTS BY PLAYER');

  for (const player of players) {
    const s = stats[player.name];
    if (s.buzzed === 0) { console.log(`  ${B(player.name)}: no buzzes recorded`); continue; }

    const acc   = Math.round(s.correct / s.buzzed * 100);
    const evAll = (s.net / totalClues).toFixed(1);
    const col   = s.net >= 0 ? G : R;

    console.log(`\n  ${B(player.name)}  accuracy=${player.accuracy}  speed=${player.speed}`);
    console.log(`    Buzzed:    ${s.buzzed}/${totalClues} clues (${Math.round(s.buzzed / totalClues * 100)}% buzz rate)`);
    console.log(`    Accuracy:  ${s.correct}/${s.buzzed} correct (${acc}%)`);
    console.log(`    Net score: ${col('$' + s.net.toLocaleString())}`);
    console.log(`    EV/clue:   ${col('$' + evAll)}  (per clue on the board, win or not)`);

    // Value tier breakdown
    console.log(`\n    $     Buzzed  Correct  EV/buzz  Theory-EV  Delta`);
    R1_VALUES.forEach((v, vi) => {
      const bv = s.byValue[v];
      if (bv.buzzed === 0) return;
      const bacc   = Math.round(bv.correct / bv.buzzed * 100);
      const evBuzz = (bv.net / bv.buzzed).toFixed(0);
      const thEV   = theoreticalEV(player.accuracy, v, vi).toFixed(0);
      const delta  = (bv.net / bv.buzzed - theoreticalEV(player.accuracy, v, vi)).toFixed(0);
      const evCol  = bv.net >= 0 ? G : R;
      const dCol   = +delta >= 0 ? G : R;
      console.log(`    $${String(v).padEnd(5)} ${String(bv.buzzed).padStart(4)}    ${String(bacc).padStart(3)}%   ${evCol(String(evBuzz).padStart(5))}    ${String(thEV).padStart(5)}     ${dCol(delta)}`);
    });

    // Domain breakdown (only domains with enough data)
    const domains = Object.entries(s.byDomain).filter(([, d]) => d.buzzed >= 3);
    if (domains.length) {
      console.log(`\n    Domain breakdown:`);
      domains.sort((a, b) => b[1].net - a[1].net).forEach(([dom, d]) => {
        const dacc = Math.round(d.correct / d.buzzed * 100);
        const col  = d.net >= 0 ? G : R;
        console.log(`      ${dom.padEnd(12)} ${d.buzzed} buzzes  ${dacc}% correct  ${col('$' + d.net.toLocaleString())}`);
      });
    }
  }

  // ── Value tier summary across all players ──
  section('VALUE TIER SUMMARY  (all players combined)');

  console.log(`  $     Buzzes  Correct  Actual-EV  Theory-EV  Judgment-gap`);
  R1_VALUES.forEach((v, vi) => {
    let totalBuzz = 0, totalCorrect = 0, totalNet = 0;
    players.forEach(p => {
      const bv = stats[p.name].byValue[v];
      totalBuzz    += bv.buzzed;
      totalCorrect += bv.correct;
      totalNet     += bv.net;
    });
    if (totalBuzz === 0) return;

    const acc    = Math.round(totalCorrect / totalBuzz * 100);
    const evBuzz = (totalNet / totalBuzz).toFixed(0);
    // Weighted theoretical EV (average across players by their actual buzz counts)
    const thEV   = (players.reduce((sum, p) => {
      const bv = stats[p.name].byValue[v];
      return sum + theoreticalEV(p.accuracy, v, vi) * bv.buzzed;
    }, 0) / totalBuzz).toFixed(0);
    const gap    = (totalNet / totalBuzz - +thEV).toFixed(0);
    const evCol  = totalNet >= 0 ? G : R;
    const gapCol = +gap >= 0 ? G : R;
    console.log(`  $${String(v).padEnd(5)} ${String(totalBuzz).padStart(5)}    ${String(acc).padStart(3)}%      ${evCol(String(evBuzz).padStart(5))}      ${String(thEV).padStart(5)}       ${gapCol(gap)}`);
  });

  console.log(`\n  Judgment-gap = actual EV minus theoretical EV.`);
  console.log(`  Negative gap means judge is stricter than the formula predicts.`);
  console.log(`  Positive gap means judge is more lenient.\n`);

  // ── Diagnostics ──
  section('DIAGNOSTICS');

  const suggestions = [];

  players.forEach(player => {
    const s = stats[player.name];
    if (s.buzzed < 5) return;

    if (s.net < 0) {
      suggestions.push(`${player.name} finished with negative net ($${s.net.toLocaleString()}) across ${totalClues} clues.`);
    }

    R1_VALUES.forEach((v, vi) => {
      const bv = s.byValue[v];
      if (bv.buzzed < 3) return;
      if (bv.net / bv.buzzed < -v * 0.15) {
        suggestions.push(`${player.name} losing heavily on $${v} clues: EV=$${(bv.net / bv.buzzed).toFixed(0)} (${Math.round(bv.correct / bv.buzzed * 100)}% correct).`);
      }
    });
  });

  // Check if judgment gap is consistently negative (judge too strict)
  let overallJudgmentGap = 0, totalBuzzAll = 0;
  R1_VALUES.forEach((v, vi) => {
    players.forEach(p => {
      const bv = stats[p.name].byValue[v];
      if (bv.buzzed === 0) return;
      overallJudgmentGap += (bv.net / bv.buzzed - theoreticalEV(p.accuracy, v, vi)) * bv.buzzed;
      totalBuzzAll += bv.buzzed;
    });
  });
  if (totalBuzzAll > 0) {
    const avgGap = overallJudgmentGap / totalBuzzAll;
    if (avgGap < -50) suggestions.push(`Overall judgment gap is $${avgGap.toFixed(0)}/buzz — judge may be stricter than intended. Consider loosening the judge prompt or raising AI accuracy values.`);
    if (avgGap > 50)  suggestions.push(`Overall judgment gap is +$${avgGap.toFixed(0)}/buzz — judge is more lenient than the formula predicts. AI accuracy values may be too conservative.`);
  }

  if (!suggestions.length) {
    console.log(pass('All players showing reasonable expected value — balance looks healthy.'));
  } else {
    suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${Y(s)}`));
  }

  const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputFile = `sim-results-${timestamp}.json`;
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { N_ROUNDS, N_CATS, totalClues },
    stats,
    suggestions,
  }, null, 2));

  console.log(`\n  ${G('Results exported →')} ${outputFile}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
