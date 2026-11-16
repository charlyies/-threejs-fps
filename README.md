# emberline

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/charlyies/-threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/charlyies/-threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

**Emberline** — a round-based tactical FPS built with three.js. You lead **Ember**
(orange) against the **Frost** bots (blue) in the Foundry Yard, 5v5. Win a round by
eliminating the enemy team or by capturing **the Beacon** at mid — stand in the ring
for 5 seconds. First to **5 rounds** takes the match.

Kills (+$300) and round wins (+$325) earn cash for the between-round buy menu:
**Sidearm** (free), **Hornet SMG** ($600), **Longshot Rifle** ($1200),
**Deadeye** sniper ($2000), **Ember Charge** grenades ($300) and
**plating** ($400, absorbs 50% of damage). Each
weapon has its own damage, fire rate, magazine, spread and recoil — and its own
first-person viewmodel, with stride bob, recoil kick and a reload dip.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

## How to play

- **Move:** WASD · **Sprint:** Shift · **Jump:** Space · **Crouch:** Ctrl
- **Look / fire:** mouse (click to lock the pointer), click to shoot
- **Aim down sights:** right mouse (tighter spread, narrower view)
- **Throw Ember Charge:** G — it lobs, bounces, then detonates; the bang draws bots in
- **Reload:** R · **Weapons:** 1–4 · **Buy menu:** B (between rounds) · **Mute:** M
- **Objective:** clear the Frost team, or hold the Beacon ring until it captures.
  If the 100-second timer expires, the team with more agents standing wins the round.

## The map

The Foundry Yard is an original industrial arena: a central Beacon platform, a mid
lane, two flank routes, crate stacks, pipe columns and sightline-breaking walls —
dark steel with ember-orange and frost-blue accents, fog, shadows and furnace glow.
Two covered **service vents** run down the flanks, a sheltered third route into mid,
and every round ends with a recap card: kills, accuracy, damage and money earned.

## Bots

Nine bots fight beside and against you. They patrol waypoints, push the Beacon,
take cover, strafe while firing in bursts, and hunt you by line of sight. Each team
has a designated **pusher** who runs the Beacon and a **cover** bot who lays
suppressive fire down the mid lane; hurt bots fall back, and any bot that hears an
Ember Charge go off turns to investigate the blast. Bots also throw their own
Charges at enemies they have just lost sight of. Friendly
bots wear orange chevrons, enemies blue ones. On death you spectate a friendly bot
until the round ends.

## Tech

- Pure three.js 0.187.0 (vendored) + vanilla ES modules — no build step, no network
  requests, no external models or audio files. All bot models are boxes and
  capsules; all sound is synthesised with WebAudio.
- Fixed 1/60 s simulation, seeded RNG: `?seed=N` replays the same bot behaviour,
  and `?shot=start|play|end` stages deterministic screenshot scenes.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
