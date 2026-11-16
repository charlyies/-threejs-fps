// Round recap — what happened, per round and for the match.
// Tracks the player's round: kills, deaths, shots, hits, damage, headshots and
// money earned. At the end of each round it shows a compact card under the
// banner; at the end of the match it renders the full round-by-round table
// that the match screen shows. It owns its own DOM node and never touches
// the simulation.
export function createRecap() {
  const el = document.createElement('div');
  el.id = 'recap';
  el.hidden = true;
  document.body.appendChild(el);

  let rounds = [];
  let cur = freshRound(1);

  function freshRound(n) {
    return { round: n, kills: 0, deaths: 0, damage: 0, headshots: 0, shots: 0, hits: 0, earned: 0, won: null };
  }
  function accuracy(r) { return r.shots ? Math.round((r.hits / r.shots) * 100) : 0; }
  function statRow(label, value) {
    return `<div class="recap-stat"><span>${label}</span><b>${value}</b></div>`;
  }

  return {
    startRound(n) { cur = freshRound(n); },
    reset() { rounds = []; cur = freshRound(1); el.hidden = true; },
    recordShot(hit, damage, headshot) {
      cur.shots += 1;
      if (!hit) return;
      cur.hits += 1;
      cur.damage += Math.round(damage);
      if (headshot) cur.headshots += 1;
    },
    recordKill() { cur.kills += 1; },
    recordDeath() { cur.deaths += 1; },
    recordEarned(n) { cur.earned += n; },
    // Called when a round ends: stores the round and shows its card for the
    // few seconds the round-end pause lasts.
    endRound(won, reason) {
      cur.won = won;
      rounds.push(cur);
      const totalKills = rounds.reduce((s, r) => s + r.kills, 0);
      const totalDeaths = rounds.reduce((s, r) => s + r.deaths, 0);
      const headNote = cur.headshots ? ` · ${cur.headshots} headshot${cur.headshots > 1 ? 's' : ''}` : '';
      el.innerHTML =
        `<div class="recap-title">ROUND ${cur.round} — ${won ? 'EMBER' : won === false ? 'FROST' : 'DRAW'}</div>` +
        `<div class="recap-sub">${reason}</div>` +
        `<div class="recap-grid">` +
        statRow('Kills', cur.kills) + statRow('Deaths', cur.deaths) +
        statRow('Accuracy', `${accuracy(cur)}%`) + statRow('Damage', cur.damage) +
        statRow('Earned', `$${cur.earned}`) + statRow('Match K/D', `${totalKills}–${totalDeaths}`) +
        `</div><div class="recap-note">You${headNote} · ${cur.shots} shots fired</div>`;
      el.hidden = false;
    },
    hide() { el.hidden = true; },
    // Full round-by-round table for the match-end screen.
    matchStatsHtml() {
      const rows = rounds.map((r) =>
        `<div class="stat-row"><span>Round ${r.round} — ${r.won ? 'Ember' : r.won === false ? 'Frost' : 'Draw'}</span>` +
        `<b>${r.kills}K · ${r.deaths}D · ${accuracy(r)}% · $${r.earned}</b></div>`).join('');
      const tot = rounds.reduce((a, r) => ({
        kills: a.kills + r.kills, deaths: a.deaths + r.deaths,
        shots: a.shots + r.shots, hits: a.hits + r.hits,
        damage: a.damage + r.damage, headshots: a.headshots + r.headshots,
        earned: a.earned + r.earned,
      }), { kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0, headshots: 0, earned: 0 });
      const acc = tot.shots ? Math.round((tot.hits / tot.shots) * 100) : 0;
      return rows +
        `<div class="stat-row"><span>Kills</span><b>${tot.kills}</b></div>` +
        `<div class="stat-row"><span>Deaths</span><b>${tot.deaths}</b></div>` +
        `<div class="stat-row"><span>Headshots</span><b>${tot.headshots}</b></div>` +
        `<div class="stat-row"><span>Accuracy</span><b>${acc}%</b></div>` +
        `<div class="stat-row"><span>Damage dealt</span><b>${tot.damage}</b></div>` +
        `<div class="stat-row"><span>Money earned</span><b>$${tot.earned}</b></div>`;
    },
  };
}
