// EMBERLINE — a round-based tactical FPS (5v5, Ember vs Frost) in the Foundry Yard.
// Boot, fixed 60 Hz simulation, round/match state, combat, Beacon objective,
// economy, buy phase, death-cam spectate, and ?shot=start|play|end staging.
import * as THREE from 'three';
import { createWorld, createTracers, BEACON, EMBER_SPAWN, FROST_SPAWN, MAP } from './world.js';
import { createBot, updateBot } from './bots.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createSound } from './sound.js';
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE, GRENADE_MAX_CARRY, START_MONEY, KILL_REWARD, WIN_REWARD, LOSS_REWARD, ROUND_TIME, CAPTURE_TIME, WIN_ROUNDS, weaponState } from './weapons.js';
import { createGrenades, blastFalloff, GRENADE_DAMAGE } from './grenade.js';
import { createViewmodel } from './viewmodel.js';
import { createRecap } from './recap.js';
import { mulberry32, range } from './random.js';
import { stageShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);
scene.fog = new THREE.Fog(0x14161a, 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x9fb4c8, 0x2a2018, 1.5));
scene.add(new THREE.AmbientLight(0x404654, 0.7));
const sun = new THREE.DirectionalLight(0xffe0b3, 2.4);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
scene.add(sun);

const world = createWorld(scene);
const tracers = createTracers(scene);
const recap = createRecap();
const grenades = createGrenades(scene, world, (blast) => blastDamage(blast));
const hud = createHud();
const sound = createSound();
const input = createInput(renderer.domElement, onLockChange);

// First-person viewmodel: one box-built gun per weapon, with stride bob,
// recoil kick, a reload dip and an aim-down-sights pose.
const viewmodel = createViewmodel(camera);
// Muzzle flash light, fired on every shot and decayed in step().
const muzzleLight = new THREE.PointLight(0xffc27a, 0, 9, 1.8);
muzzleLight.position.set(0.27, -0.2, -0.6);
camera.add(muzzleLight);

// ---- state ----
const match = {
  phase: 'title', round: 1, emberWins: 0, frostWins: 0,
  money: START_MONEY, kills: 0, deaths: 0, shots: 0, hits: 0, earned: 0,
  roundTime: ROUND_TIME, buyTime: 15, beaconProgress: 0, beaconOwner: null,
  roundEndAt: 0, time: 0,
};
const player = {
  pos: new THREE.Vector3(EMBER_SPAWN.x, 0, EMBER_SPAWN.z),
  velX: 0, velZ: 0, velY: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true,
  onGround: true, crouch: false, sprint: false, aiming: false, grenades: 1,
  owned: new Set(['pistol']), current: 'pistol',
  weapons: { pistol: weaponState(WEAPONS.pistol) },
  spectate: null, stepTimer: 0, spreadBloom: 0,
};
let bots = [];
let pendingNoise = null; // {x, z, at} — the latest grenade bang, for bot ears
let autopilot = false;
let autoStrafe = 0, autoStuckTimer = 0, autoStrafeTimer = 0;
let autoLastPos = { x: 0, z: 0 };
let paused = false;
let frozen = false; // shot mode freezes the frame once staged

function spawnPositions(team) {
  const base = team === 'ember' ? EMBER_SPAWN : FROST_SPAWN;
  const dir = team === 'ember' ? 1 : -1;
  return [
    { x: base.x, z: base.z },
    { x: base.x - 3.5, z: base.z - dir * 2 },
    { x: base.x + 3.5, z: base.z - dir * 2 },
    { x: base.x - 7, z: base.z + dir * 1 },
    { x: base.x + 7, z: base.z + dir * 1 },
  ];
}
function buildBots() {
  for (const b of bots) scene.remove(b.group);
  bots = [];
  const e = spawnPositions('ember'), f = spawnPositions('frost');
  for (let i = 0; i < 4; i++) bots.push(createBot(scene, world, { team: 'ember', index: i, x: e[i + 1].x, z: e[i + 1].z, rng }));
  for (let i = 0; i < 5; i++) bots.push(createBot(scene, world, { team: 'frost', index: i, x: f[i].x, z: f[i].z, rng }));
}
buildBots();

function aliveCount(team) {
  let n = team === 'ember' && player.alive ? 1 : 0;
  for (const b of bots) if (b.team === team && b.alive) n++;
  return n;
}
function curWeapon() { return player.weapons[player.current]; }

// ---- ray helpers ----
function raySphere(o, d, c, r) {
  const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z;
  const tca = ox * d.x + oy * d.y + oz * d.z;
  if (tca < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  if (d2 > r * r) return null;
  return tca - Math.sqrt(r * r - d2);
}
// First hit among walls and bots from origin along dir.
function rayHit(origin, dir, maxDist, shooter) {
  const wallD = world.rayWall(origin, dir, maxDist);
  let best = wallD === Infinity ? null : { type: 'wall', dist: wallD };
  for (const b of bots) {
    if (!b.alive || b === shooter) continue;
    const head = raySphere(origin, dir, { x: b.pos.x, y: 1.62, z: b.pos.z }, 0.26);
    const body = raySphere(origin, dir, { x: b.pos.x, y: 1.0, z: b.pos.z }, 0.52);
    const t = head !== null ? { dist: head, headshot: true } : body !== null ? { dist: body, headshot: false } : null;
    if (t && t.dist < maxDist && (!best || t.dist < best.dist)) best = { type: 'bot', bot: b, ...t };
  }
  return best;
}
function pointAt(o, d, t) { return new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t); }

// ---- player combat ----
function playerShoot() {
  const w = curWeapon();
  if (w.reloading || w.cooldown > 0) return;
  if (w.mag <= 0) { sound.dryFire(); startReload(); return; }
  w.mag -= 1; w.cooldown = w.def.fireInterval;
  match.shots += 1;
  player.spreadBloom = Math.min(0.03, player.spreadBloom + w.def.recoil * 0.4);
  player.pitch += w.def.recoil * (0.5 + Math.random() * 0.5);
  sound.shoot(w.def.sound);
  // Aiming down sights tightens the cone by almost half.
  const spread = (w.def.spread + player.spreadBloom + (player.sprint ? 0.02 : 0)) * (player.aiming ? 0.55 : 1);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.x += (Math.random() - 0.5) * 2 * spread;
  dir.y += (Math.random() - 0.5) * 2 * spread;
  dir.z += (Math.random() - 0.5) * 2 * spread;
  dir.normalize();
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const hit = rayHit(origin, dir, w.def.range, null);
  const end = hit ? pointAt(origin, dir, hit.dist) : pointAt(origin, dir, w.def.range);
  tracers.add(origin.clone().addScaledVector(dir, 0.6), end, w.def.tracer);
  viewmodel.kick();
  muzzleLight.intensity = 26;
  if (hit && hit.type === 'bot') {
    match.hits += 1;
    const dmg = w.def.damage * (hit.headshot ? w.def.headshotMult : 1) * (hit.dist > 30 ? 0.8 : 1);
    recap.recordShot(true, dmg, hit.headshot);
    const killed = hit.bot.damage(dmg, hit.headshot);
    hud.hitmarker(killed);
    if (killed) onKill(hit.bot, 'You');
    else sound.hit();
  } else {
    recap.recordShot(false, 0, false);
  }
}
function startReload() {
  const w = curWeapon();
  if (w.reloading || w.mag === w.def.mag || w.reserve <= 0) return;
  w.reloading = true; w.reloadEnd = match.time + w.def.reloadTime;
  viewmodel.startReload(w.def.reloadTime);
  sound.reload();
}
function finishReload() {
  const w = curWeapon();
  const need = w.def.mag - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take; w.reserve -= take; w.reloading = false;
}

// ---- Ember Charge ----
// The player lobs one along the camera's aim; it bounces, fuses, then pops.
function throwPlayerGrenade() {
  if (!player.alive || match.phase !== 'play' || player.grenades <= 0) return;
  player.grenades -= 1;
  hud.setGrenades(player.grenades);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  grenades.throwFrom(origin, dir, 'ember', player);
  sound.grenadeThrow();
}
// A bot lobs its Charge at a last-seen position.
function throwBotGrenade(bot, target) {
  const from = new THREE.Vector3(bot.pos.x, 1.4, bot.pos.z);
  grenades.throwAt(from, target, bot.team, bot);
  const d = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
  if (d < 30) sound.grenadeThrow();
}
// A Charge just went off: radial damage with falloff, then the bang itself
// becomes a noise event the bots turn to investigate.
function blastDamage(blast) {
  const distToPlayer = Math.hypot(player.pos.x - blast.pos.x, player.pos.z - blast.pos.z);
  if (distToPlayer < 30) sound.explosion(); else sound.explosionFar(distToPlayer);
  pendingNoise = { x: blast.pos.x, z: blast.pos.z, at: match.time };
  if (match.phase !== 'play') return; // a late fuse after the round: light, no hurt
  const eye = { x: blast.pos.x, y: blast.pos.y + 0.6, z: blast.pos.z };
  for (const b of bots) {
    if (!b.alive || b.team === blast.team) continue; // teammates are immune
    const d = Math.hypot(b.pos.x - blast.pos.x, b.pos.z - blast.pos.z);
    const fall = blastFalloff(d);
    if (fall <= 0) continue;
    if (!world.hasLOS(eye, { x: b.pos.x, y: 1.0, z: b.pos.z })) continue;
    const killed = b.damage(GRENADE_DAMAGE * fall, false);
    if (killed) onKill(b, blast.owner === player ? 'You' : blast.owner.name);
    else hud.feed(`${blast.owner === player ? 'You' : blast.owner.name} ▸ ${b.name} (blast)`, b.team === 'frost');
  }
  // An enemy Charge can hurt the player too.
  if (blast.team === 'frost' && player.alive) {
    const d = Math.hypot(player.pos.x - blast.pos.x, player.pos.z - blast.pos.z);
    const fall = blastFalloff(d);
    if (fall > 0 && world.hasLOS(eye, { x: player.pos.x, y: 1.2, z: player.pos.z })) {
      damagePlayer(GRENADE_DAMAGE * fall, blast.pos);
    }
  }
  // The thrower takes half damage if they stood too close to their own blast.
  if (blast.owner === player) {
    const d = Math.hypot(player.pos.x - blast.pos.x, player.pos.z - blast.pos.z);
    if (d < 3) damagePlayer(GRENADE_DAMAGE * blastFalloff(d) * 0.5, blast.pos);
  } else if (blast.owner && blast.owner.isBot) {
    const d = Math.hypot(blast.owner.pos.x - blast.pos.x, blast.owner.pos.z - blast.pos.z);
    if (d < 3) blast.owner.damage(GRENADE_DAMAGE * blastFalloff(d) * 0.5, false);
  }
}
function buyWeapon(id) {
  if (match.phase !== 'buy') return;
  if (id === 'grenade') {
    if (player.grenades >= GRENADE_MAX_CARRY || match.money < GRENADE_PRICE) { sound.denied(); return; }
    match.money -= GRENADE_PRICE; player.grenades += 1;
    sound.buy(); hud.setMoney(match.money); hud.setGrenades(player.grenades); return;
  }
  if (id === 'armor') {
    if (player.armor >= 100 || match.money < ARMOR_PRICE) { sound.denied(); return; }
    match.money -= ARMOR_PRICE; player.armor = 100; sound.buy(); hud.setMoney(match.money); return;
  }
  const def = WEAPONS[id];
  if (!def || player.owned.has(id) || match.money < def.price) { sound.denied(); return; }
  match.money -= def.price;
  player.owned.add(id);
  player.weapons[id] = weaponState(def);
  player.current = id;
  sound.buy(); hud.setMoney(match.money);
  hud.setAmmo(curWeapon().mag, curWeapon().reserve, def.name);
}
function selectWeapon(id) {
  if (!player.owned.has(id) || !player.alive) return;
  player.current = id;
  viewmodel.setWeapon(id);
  const w = curWeapon();
  hud.setAmmo(w.mag, w.reserve, w.def.name);
}
function damagePlayer(amount, fromPos) {
  if (!player.alive || match.phase !== 'play') return;
  let remaining = amount;
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, amount * 0.5);
    player.armor -= absorbed; remaining -= absorbed;
  }
  player.hp -= remaining;
  sound.hurt();
  if (fromPos) {
    const ang = Math.atan2(fromPos.x - player.pos.x, fromPos.z - player.pos.z) - player.yaw;
    hud.damageFrom((ang * 180) / Math.PI);
  }
  if (player.hp <= 0) {
    player.hp = 0; player.alive = false; match.deaths += 1;
    recap.recordDeath();
    const friends = bots.filter((b) => b.team === 'ember' && b.alive);
    player.spectate = friends.length ? friends[Math.floor(Math.random() * friends.length)] : null;
    input.releaseLock();
    hud.feed('You were eliminated', false);
  }
  hud.setHealth(player.hp, player.armor);
}
function onKill(bot, killerName) {
  sound.kill();
  hud.feed(`${killerName} ▸ ${bot.name} (${bot.team === 'frost' ? 'Frost' : 'Ember'})`, bot.team === 'frost');
  if (bot.team === 'frost' && killerName === 'You') {
    match.kills += 1; match.money += KILL_REWARD; match.earned += KILL_REWARD;
    recap.recordKill(); recap.recordEarned(KILL_REWARD);
    hud.setMoney(match.money);
  }
}

// Bot fires at a target: probabilistic hit after wall check, with tracer.
function botFire(shooter, target, opts) {
  const muzzle = new THREE.Vector3(shooter.pos.x, 1.35, shooter.pos.z)
    .addScaledVector(new THREE.Vector3(Math.sin(shooter.yaw), 0, Math.cos(shooter.yaw)), 0.5);
  const tp = target.pos;
  const dx = tp.x - muzzle.x, dz = tp.z - muzzle.z;
  const dist = Math.hypot(dx, dz);
  const dir = new THREE.Vector3(dx / (dist || 1), (1.2 - 1.35) / (dist || 1), dz / (dist || 1));
  const wallD = world.rayWall(muzzle, dir, dist);
  let end = new THREE.Vector3(tp.x, 1.2, tp.z);
  if (wallD !== Infinity) { end = pointAt(muzzle, dir, wallD); tracers.add(muzzle, end, 0x9fd8ff); return; }
  tracers.add(muzzle, end, shooter.team === 'frost' ? 0x7fd4ff : 0xffb347);
  if (shooter.team === 'frost' || target.isPlayer) sound.enemyShoot(dist);
  const hitP = Math.max(0.08, Math.min(0.6, (0.5 - dist * 0.008 - opts.err * 0.22) * shooter.skill * 1.4));
  if (Math.random() > hitP) return;
  const headshot = Math.random() < 0.12;
  const dmg = shooter.shotDamage * (headshot ? 2 : 1);
  if (target.isPlayer) damagePlayer(dmg, shooter.pos);
  else if (target.bot) {
    const killed = target.bot.damage(dmg, headshot);
    if (killed) onKill(target.bot, shooter.name);
  }
}

// ---- rounds ----
function startBuyPhase() {
  match.phase = 'buy';
  match.buyTime = 15;
  match.roundTime = ROUND_TIME;
  match.beaconProgress = 0; match.beaconOwner = null;
  player.hp = 100; player.alive = true; player.spectate = null;
  player.pos.set(EMBER_SPAWN.x, 0, EMBER_SPAWN.z);
  player.yaw = 0; player.pitch = 0; player.velY = 0;
  const e = spawnPositions('ember'), f = spawnPositions('frost');
  bots.forEach((b, i) => {
    const p = b.team === 'ember' ? e[i + 1] : f[i - 4];
    b.reset(p.x, p.z);
  });
  // Round roles: the first bot of each team pushes the Beacon, the second
  // covers the mid lane; the rest hunt freely.
  bots[0].role = 'push'; bots[1].role = 'cover';
  bots[4].role = 'push'; bots[5].role = 'cover';
  // A fresh round starts with at least one Ember Charge in the belt.
  player.grenades = Math.max(1, player.grenades);
  player.velX = 0; player.velZ = 0;
  grenades.clear();
  pendingNoise = null;
  recap.hide();
  recap.startRound(match.round);
  hud.setGrenades(player.grenades);
  for (const id of Object.keys(player.weapons)) {
    const w = player.weapons[id]; w.mag = w.def.mag; w.reserve = w.def.reserve; w.reloading = false;
  }
  hud.setHealth(player.hp, player.armor);
  hud.setScores(match.emberWins, match.frostWins, match.round);
  hud.setTimer(ROUND_TIME);
  hud.setBeacon(0, null);
  hud.setMoney(match.money);
  input.releaseLock();
  hud.buy(match.money, [...player.owned, ...(player.armor > 0 ? ['armor'] : [])],
    buyWeapon, () => startRound(), 15, player.grenades);
}
function startRound() {
  // Never start a round with a team already wiped (e.g. a stray call after a
  // round ended): go back to the buy phase so both teams respawn fresh.
  if (aliveCount('frost') === 0 || aliveCount('ember') === 0) { startBuyPhase(); return; }
  match.phase = 'play';
  match.roundTime = ROUND_TIME;
  hud.hideBuy();
  hud.banner(`ROUND ${match.round}`, 'Eliminate Frost — or capture the Beacon', 2600);
  sound.roundStart();
  if (!shot) input.requestLock();
}
function endRound(winner, reason) {
  if (match.phase !== 'play') return;
  match.phase = 'roundEnd';
  match.roundEndAt = match.time + 3.5;
  if (winner === 'ember') { match.emberWins += 1; match.money += WIN_REWARD; match.earned += WIN_REWARD; }
  else if (winner === 'frost') { match.frostWins += 1; match.money += LOSS_REWARD; match.earned += LOSS_REWARD; }
  if (winner) recap.recordEarned(winner === 'ember' ? WIN_REWARD : LOSS_REWARD);
  recap.endRound(winner === 'ember' ? true : winner === 'frost' ? false : null, reason);
  hud.setMoney(match.money);
  hud.setScores(match.emberWins, match.frostWins, match.round);
  const won = winner === 'ember';
  hud.banner(won ? 'ROUND WON' : winner === 'frost' ? 'ROUND LOST' : 'DRAW ROUND',
    reason, 3200);
  if (winner) (won ? sound.roundWin : sound.roundLose)();
  input.releaseLock();
}
function endMatch() {
  match.phase = 'matchEnd';
  const won = match.emberWins >= WIN_ROUNDS;
  hud.matchEnd(won, recap.matchStatsHtml());
  input.releaseLock();
}
function resetMatch() {
  match.round = 1; match.emberWins = 0; match.frostWins = 0;
  match.money = START_MONEY; match.kills = 0; match.deaths = 0;
  match.shots = 0; match.hits = 0; match.earned = 0;
  player.owned = new Set(['pistol']); player.current = 'pistol';
  player.weapons = { pistol: weaponState(WEAPONS.pistol) };
  player.armor = 0; player.grenades = 1;
  viewmodel.setWeapon('pistol');
  recap.reset();
  hud.setAmmo(30, 90, 'Sidearm');
  startBuyPhase();
}

// ---- per-frame update ----
function step(dt) {
  match.time += dt;
  tracers.update(dt);
  grenades.update(dt);
  world.beaconRing.rotation.z += dt * 0.4;
  world.beaconCore.position.y = 2.0 + Math.sin(match.time * 1.8) * 0.15;
  if (match.phase === 'buy') {
    match.buyTime -= dt;
    const bt = document.getElementById('buy-timer');
    if (bt) bt.textContent = `Buy phase — ${Math.ceil(match.buyTime)}s (B to close)`;
    camera.position.set(player.pos.x, 1.62, player.pos.z);
    camera.rotation.set(0, 0, 0, 'YXZ');
    if (match.buyTime <= 0) startRound();
    return;
  }
  if (match.phase === 'roundEnd') {
    if (match.time >= match.roundEndAt) {
      if (match.emberWins >= WIN_ROUNDS || match.frostWins >= WIN_ROUNDS) endMatch();
      else { match.round += 1; startBuyPhase(); }
    }
    updateBotsOnly(dt);
    return;
  }
  if (match.phase !== 'play') return;

  // Round timer
  match.roundTime -= dt;
  hud.setTimer(match.roundTime);
  if (match.roundTime <= 0) {
    const e = aliveCount('ember'), f = aliveCount('frost');
    endRound(e > f ? 'ember' : f > e ? 'frost' : null,
      e === f ? 'Time expired — even teams, no point' : `Time expired — ${e > f ? 'Ember' : 'Frost'} had more agents standing`);
    return;
  }

  // Player look + movement
  const look = input.consumeLook();
  player.yaw -= look.x * 0.0023;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * 0.0023));
  const keys = input.state.keys;
  player.crouch = keys.has('ControlLeft') || keys.has('ControlRight');
  player.sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !player.crouch;
  // Right mouse aims down sights — never while sprinting.
  player.aiming = input.state.aiming && !player.sprint && player.alive;
  if (autopilot) autopilotStep(dt);
  let moving = false;
  if (player.alive) {
    // Acceleration-based movement: velocity builds toward the wish direction
    // and decays when the keys lift, so stops and strafes feel weighted
    // instead of snapping. Air control is much weaker than ground control.
    const speed = (player.crouch ? 2.2 : player.sprint ? 7.2 : 4.6);
    let fx = 0, fz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    if (autopilot) { fz = 1; fx = autoStrafe; }
    const len = Math.hypot(fx, fz);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const wishX = len > 0 ? ((fx * cos - fz * sin) / len) * speed : 0;
    const wishZ = len > 0 ? ((-fx * sin - fz * cos) / len) * speed : 0;
    const accel = player.onGround ? 46 : 13; // ground grips, air drifts
    const rate = Math.min(1, (accel * dt) / speed);
    player.velX += (wishX - player.velX) * rate;
    player.velZ += (wishZ - player.velZ) * rate;
    // No input on the ground: friction bleeds the last of the slide.
    if (len === 0 && player.onGround) {
      const bleed = Math.max(0, 1 - 9 * dt);
      player.velX *= bleed; player.velZ *= bleed;
      if (Math.hypot(player.velX, player.velZ) < 0.05) { player.velX = 0; player.velZ = 0; }
    }
    const nx = player.pos.x + player.velX * dt;
    const nz = player.pos.z + player.velZ * dt;
    if (!world.blockedAt(nx, player.pos.z, 0.42)) player.pos.x = nx;
    else player.velX = 0;
    if (!world.blockedAt(player.pos.x, nz, 0.42)) player.pos.z = nz;
    else player.velZ = 0;
    moving = Math.hypot(player.velX, player.velZ) > 0.6;
    if (moving) {
      player.stepTimer -= dt * (player.sprint ? 1.6 : 1);
      if (player.stepTimer <= 0) { player.stepTimer = 0.38; sound.step(); }
    }
    if ((keys.has('Space')) && player.onGround) { player.velY = 5.2; player.onGround = false; }
    player.velY -= 14 * dt;
    player.pos.y += player.velY * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.velY = 0; player.onGround = true; }
    // Weapon switching / reload / fire
    if (keys.has('Digit1')) selectWeapon('pistol');
    if (keys.has('Digit2')) selectWeapon('smg');
    if (keys.has('Digit3')) selectWeapon('rifle');
    if (keys.has('Digit4')) selectWeapon('sniper');
    if (keys.has('KeyR')) startReload();
    const w = curWeapon();
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.reloading && match.time >= w.reloadEnd) finishReload();
    player.spreadBloom = Math.max(0, player.spreadBloom - dt * 0.05);
    const trigger = input.state.firing || autopilot;
    if (w.def.auto) { if (trigger) playerShoot(); }
    else if (trigger && !player._triggerHeld) playerShoot();
    player._triggerHeld = trigger;
  }

  // Bots
  updateBotsOnly(dt);

  // Beacon capture
  const inZone = (p) => Math.hypot(p.x - BEACON.x, p.z - BEACON.z) < BEACON.r;
  let eIn = player.alive && inZone(player.pos) ? 1 : 0, fIn = 0;
  for (const b of bots) if (b.alive && inZone(b.pos)) (b.team === 'ember' ? eIn++ : fIn++);
  if (eIn > 0 && fIn === 0) {
    if (match.beaconOwner !== 'ember') { match.beaconOwner = 'ember'; match.beaconProgress = 0; }
    match.beaconProgress += dt / CAPTURE_TIME;
    if (Math.floor(match.beaconProgress * 10) !== Math.floor((match.beaconProgress - dt / CAPTURE_TIME) * 10)) sound.captureTick();
    if (match.beaconProgress >= 1) { sound.captureDone(); endRound('ember', 'Ember captured the Beacon'); return; }
  } else if (fIn > 0 && eIn === 0) {
    if (match.beaconOwner !== 'frost') { match.beaconOwner = 'frost'; match.beaconProgress = 0; }
    match.beaconProgress += dt / CAPTURE_TIME;
    if (match.beaconProgress >= 1) { sound.captureDone(); endRound('frost', 'Frost captured the Beacon'); return; }
  } else {
    match.beaconOwner = eIn > 0 && fIn > 0 ? 'contested' : null;
    match.beaconProgress = Math.max(0, match.beaconProgress - dt * 0.2);
  }
  hud.setBeacon(match.beaconProgress, match.beaconOwner === 'contested' ? null : match.beaconOwner);

  // Elimination win check
  if (aliveCount('frost') === 0) { endRound('ember', 'Frost team eliminated'); return; }
  if (aliveCount('ember') === 0) { endRound('frost', 'Ember team eliminated'); return; }

  // Camera
  const eyeH = player.crouch ? 1.15 : 1.62;
  if (player.alive) {
    camera.position.set(player.pos.x, player.pos.y + eyeH, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  } else if (player.spectate && player.spectate.alive) {
    const s = player.spectate;
    camera.position.set(s.pos.x - Math.sin(s.yaw) * 3.2, 2.6, s.pos.z - Math.cos(s.yaw) * 3.2);
    camera.lookAt(s.pos.x, 1.4, s.pos.z);
  }
  // Viewmodel, muzzle light and aim FOV all ease toward their targets.
  viewmodel.update(dt, { moving, sprint: player.sprint, aiming: player.aiming });
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 260);
  const targetFov = player.aiming ? 58 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
  const w = curWeapon();
  hud.setAmmo(w.mag, w.reserve, w.def.name);
  hud.setSpread(4 + player.spreadBloom * 600 + (player.sprint ? 6 : 0));
}

function updateBotsOnly(dt) {
  const targets = bots.map((b) => ({ pos: b.pos, alive: b.alive, team: b.team, bot: b, eyeY: 1.3 }));
  targets.push({ pos: player.pos, alive: player.alive, team: 'ember', isPlayer: true, eyeY: 1.3 });
  const ctx = { roundTimeLeft: match.roundTime, noise: pendingNoise, throwGrenade: throwBotGrenade };
  for (const b of bots) updateBot(b, dt, world, targets, rng, botFire, match.time, ctx);
}

// Autopilot used by ?shot=play: walk to the Beacon, aim at the nearest visible Frost bot, fire.
// If it stops making progress (pressed against cover), it sidesteps to get around it.
function autopilotStep(dt) {
  autoStuckTimer += dt;
  if (autoStuckTimer >= 0.6) {
    const moved = Math.hypot(player.pos.x - autoLastPos.x, player.pos.z - autoLastPos.z);
    autoLastPos = { x: player.pos.x, z: player.pos.z };
    autoStuckTimer = 0;
    if (moved < 0.25 && autoStrafeTimer <= 0) { autoStrafe = autoStrafe === 0 ? 1 : -autoStrafe; autoStrafeTimer = 1.4; }
  }
  if (autoStrafeTimer > 0) { autoStrafeTimer -= dt; if (autoStrafeTimer <= 0) autoStrafe = 0; }
  let best = null, bestD = Infinity;
  for (const b of bots) {
    if (b.team !== 'frost' || !b.alive) continue;
    const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
    if (d < bestD && world.hasLOS({ x: player.pos.x, y: 1.5, z: player.pos.z }, { x: b.pos.x, y: 1.3, z: b.pos.z })) { best = b; bestD = d; }
  }
  const goal = best ?? { pos: { x: 0, z: 0 } };
  const dx = goal.pos.x - player.pos.x, dz = goal.pos.z - player.pos.z;
  const targetYaw = Math.atan2(-dx, -dz);
  let diff = targetYaw - player.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  player.yaw += diff * Math.min(1, dt * 4);
  player.pitch *= 0.9;
}

// ---- input / overlays ----
function onLockChange(locked) {
  if (shot) return;
  if (!locked && match.phase === 'play' && player.alive && !paused) {
    paused = true;
    hud.title();
    document.getElementById('overlay-title').textContent = 'PAUSED';
    document.getElementById('overlay-copy').innerHTML = 'Pointer released. Click below to jump back into the round.';
    document.getElementById('play').textContent = 'Resume';
  } else if (locked) paused = false;
}
hud.onPlay(() => {
  sound.unlock();
  if (match.phase === 'title') { resetMatch(); return; }
  if (match.phase === 'matchEnd') { resetMatch(); return; }
  if (paused) { paused = false; hud.hideOverlay(); input.requestLock(); return; }
  if (match.phase === 'play') input.requestLock();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && match.phase === 'buy') startRound();
  if (e.code === 'KeyM') sound.toggleMute();
  if (e.code === 'KeyG' && match.phase === 'play') throwPlayerGrenade();
  if (match.phase === 'buy') {
    if (e.code === 'Digit1') buyWeapon('pistol');
    if (e.code === 'Digit2') buyWeapon('smg');
    if (e.code === 'Digit3') buyWeapon('rifle');
    if (e.code === 'Digit4') buyWeapon('sniper');
    if (e.code === 'Digit5') buyWeapon('armor');
    if (e.code === 'Digit6') buyWeapon('grenade');
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- main loop ----
let accumulator = 0, lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) return;
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dt;
  while (accumulator >= FIXED_STEP) { step(FIXED_STEP); accumulator -= FIXED_STEP; }
  renderer.render(scene, camera);
}

hud.title();
hud.setHealth(100, 0);
hud.setAmmo(12, 48, 'Sidearm');
hud.setMoney(START_MONEY);
hud.setScores(0, 0, 1);
hud.setTimer(ROUND_TIME);

// Test / screenshot hooks.
window.__game = {
  get phase() { return match.phase; },
  get hp() { return player.hp; },
  get money() { return match.money; },
  get emberWins() { return match.emberWins; },
  get frostWins() { return match.frostWins; },
  alive: () => ({ ember: aliveCount('ember'), frost: aliveCount('frost') }),
  start: () => { resetMatch(); },
  buy: buyWeapon,
  startRound,
  damagePlayer: (n) => damagePlayer(n, null),
  // Test hook (single-player, offline): lets an automated playtest force a round
  // outcome without aiming. Not used by the game itself.
  debug: {
    killFrost() { for (const b of bots) if (b.team === 'frost' && b.alive && b.damage(999)) onKill(b, 'You'); },
    killPlayer() { damagePlayer(999, null); },
  },
  playerPos: () => ({ x: player.pos.x, z: player.pos.z }),
};

if (shot) {
  stageShot(shot, {
    startMatch: () => { resetMatch(); },
    startRound: () => { match.phase = 'play'; match.roundTime = ROUND_TIME; hud.hideBuy(); },
    step: (dt, auto) => { autopilot = auto; step(dt); },
    setEnd: (ember, frost, kills) => {
      match.emberWins = ember; match.frostWins = frost; match.kills = kills;
      match.deaths = 2; match.shots = 84; match.hits = 41; match.earned = 2450;
      match.phase = 'matchEnd';
      hud.setAmmo(12, 48, 'Sidearm');
      const acc = Math.round((match.hits / match.shots) * 100);
      const stats = `<div class="stat-row"><span>Kills</span><b>${match.kills}</b></div>` +
        `<div class="stat-row"><span>Deaths</span><b>${match.deaths}</b></div>` +
        `<div class="stat-row"><span>Accuracy</span><b>${acc}%</b></div>` +
        `<div class="stat-row"><span>Rounds</span><b>${ember} – ${frost}</b></div>` +
        `<div class="stat-row"><span>Money earned</span><b>$${match.earned}</b></div>`;
      hud.matchEnd(true, stats);
    },
    render: () => renderer.render(scene, camera),
    throwGrenade: () => { if (player.alive) throwPlayerGrenade(); },
    freeze: () => { frozen = true; window.__shotReady = true; },
  });
} else {
  requestAnimationFrame(frame);
}
