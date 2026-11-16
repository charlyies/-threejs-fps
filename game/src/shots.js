// Screenshot scenes behind ?shot=start|play|end. Each stages a real game state
// (buy phase, a live mid-round firefight driven by the autopilot, a finished match)
// then renders it once and freezes, setting window.__shotReady.
const STEP = 1 / 60;

export function stageShot(name, ctx) {
  ctx.startMatch();
  if (name === 'play') {
    ctx.startRound();
    // ~8 s of live play: the autopilot walks to the Beacon and fires at Frost bots.
    // A Charge goes out at ~6.5 s so it is still arcing when the frame is taken.
    for (let i = 0; i < 8 / STEP; i++) {
      if (i === Math.floor(6.5 / STEP)) ctx.throwGrenade();
      ctx.step(STEP, true);
    }
    ctx.render();
    ctx.freeze();
    return;
  }
  if (name === 'end') {
    // A few buy-phase frames so the camera sits in the yard, then the match screen.
    for (let i = 0; i < 30; i++) ctx.step(STEP, false);
    ctx.setEnd(5, 2, 14);
    ctx.render();
    ctx.freeze();
    return;
  }
  // start: the buy-phase title view over the Foundry Yard.
  for (let i = 0; i < 30; i++) ctx.step(STEP, false);
  ctx.render();
  ctx.freeze();
}
