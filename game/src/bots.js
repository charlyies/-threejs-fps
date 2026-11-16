// Bots: box-built humanoids with team-coloured chevrons, waypoint navigation,
// line-of-sight engagement, strafing and burst fire. No external models.
import * as THREE from 'three';
import { WAYPOINTS, BEACON } from './world.js';
import { range } from './random.js';
import { GRENADE_NOISE_RADIUS } from './grenade.js';

const TEAM_COLOR = { ember: 0xff7a1a, frost: 0x37b6ff };
const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Sable'];
const FROST_NAMES = ['Glacier', 'Rime', 'Blizzard', 'Hail', 'Sleet'];

function buildModel(team) {
  const color = TEAM_COLOR[team];
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: team === 'ember' ? 0x5a3a22 : 0x22384a, roughness: 0.8, metalness: 0.2 });
  const trim = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.85, 0.34), suit);
  body.position.y = 1.0; body.castShadow = true; g.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.36), trim);
  vest.position.y = 1.25; g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
  head.position.y = 1.62; head.castShadow = true; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), trim);
  visor.position.set(0, 1.64, 0.18); g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.7 }));
  gun.position.set(0.28, 1.15, 0.3); gun.castShadow = true; g.add(gun);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), suit);
  legL.position.set(-0.15, 0.28, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.15; g.add(legR);
  // Floating team chevron (down-pointing cone) above the head.
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 4),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, transparent: true, opacity: 0.95 }));
  chev.rotation.x = Math.PI; chev.position.y = 2.25; g.add(chev);
  return { group: g, body, head, gun, legL, legR, chev, suitMat: suit };
}

export function createBot(scene, world, opts) {
  const { team, index, x, z, rng } = opts;
  const name = team === 'ember' ? EMBER_NAMES[index % EMBER_NAMES.length] : FROST_NAMES[index % FROST_NAMES.length];
  const model = buildModel(team);
  model.group.position.set(x, 0, z);
  scene.add(model.group);
  const skill = team === 'frost' ? range(rng, 0.55, 0.8) : range(rng, 0.6, 0.85); // aim skill 0..1
  const bot = {
    team, name, isBot: true, alive: true, health: 100, armor: 0,
    pos: model.group.position, yaw: team === 'ember' ? Math.PI : 0,
    speed: range(rng, 3.4, 4.2), skill,
    weapon: team === 'frost' ? 'rifle' : 'rifle',
    shotDamage: 13, fireInterval: range(rng, 0.42, 0.6),
    burstLeft: 0, burstTimer: range(rng, 0.5, 2), cooldown: 0,
    waypoint: null, strafeDir: 1, strafeTimer: 0, walkPhase: 0,
    lastSeen: null, lastSeenAt: -99, flash: 0, model, group: model.group,
    grenades: 1, grenadeTimer: range(rng, 8, 16), // one Ember Charge per round
    role: null, // 'push' | 'cover' | null, assigned each round by main.js
    fleeUntil: 0, coverTimer: 0, lastNoiseAt: -99,
    spawn: { x, z },
    reset(nx, nz) {
      this.alive = true; this.health = 100; this.armor = 0;
      this.pos.set(nx, 0, nz); this.yaw = team === 'ember' ? Math.PI : 0;
      this.waypoint = null; this.lastSeen = null; this.burstLeft = 0;
      this.group.visible = true; this.flash = 0;
      this.grenades = 1; this.grenadeTimer = range(rng, 8, 16);
      this.role = null; this.fleeUntil = 0; this.coverTimer = 0; this.lastNoiseAt = -99;
      this.model.suitMat.emissive.setHex(0x000000);
    },
    damage(amount, headshot) {
      if (!this.alive) return false;
      this.health -= amount;
      this.flash = 0.12;
      this.model.suitMat.emissive.setHex(0xff2222);
      if (this.health <= 0) { this.alive = false; this.group.visible = false; return true; }
      return false;
    },
  };
  return bot;
}

// One AI tick. `targets` = [{pos:Vector3, alive, isPlayer, bot, eyeY}].
// `fire` = (shooter, targetPos, opts) called when the bot pulls the trigger.
// `ctx` carries the round state the AI reacts to: { roundTimeLeft, noise, throwGrenade }.
export function updateBot(bot, dt, world, targets, rng, fire, time, ctx = {}) {
  if (!bot.alive) return;
  const eye = { x: bot.pos.x, y: 1.5, z: bot.pos.z };
  // A grenade bang nearby: turn and investigate the blast site.
  if (ctx.noise && ctx.noise.at !== bot.lastNoiseAt) {
    bot.lastNoiseAt = ctx.noise.at;
    const nd = Math.hypot(ctx.noise.x - bot.pos.x, ctx.noise.z - bot.pos.z);
    if (nd < GRENADE_NOISE_RADIUS) {
      bot.lastSeen = { x: ctx.noise.x, z: ctx.noise.z };
      bot.lastSeenAt = time;
    }
  }
  // Find nearest visible enemy.
  let best = null, bestD = Infinity;
  for (const t of targets) {
    if (!t.alive || t.team === bot.team) continue;
    const d = Math.hypot(t.pos.x - bot.pos.x, t.pos.z - bot.pos.z);
    if (d > 42) continue;
    if (d < bestD && world.hasLOS(eye, { x: t.pos.x, y: t.eyeY ?? 1.3, z: t.pos.z })) { best = t; bestD = d; }
  }
  let moveX = 0, moveZ = 0;
  if (best) {
    bot.lastSeen = { x: best.pos.x, z: best.pos.z }; bot.lastSeenAt = time;
    const dx = best.pos.x - bot.pos.x, dz = best.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    bot.yaw = Math.atan2(dx, dz);
    // Hurt badly with the enemy close: break off and fall back.
    if (bot.health < 30 && dist < 14) bot.fleeUntil = Math.max(bot.fleeUntil, time + 1.2);
    // Strafe while engaging; close in if far, hold ground mid-range.
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) { bot.strafeDir *= -1; bot.strafeTimer = range(rng, 0.7, 1.6); }
    const px = -dz / dist * bot.strafeDir, pz = dx / dist * bot.strafeDir;
    const approach = dist > 16 ? 0.8 : dist < 6 ? -0.5 : 0;
    moveX = px * 0.9 + (dx / dist) * approach;
    moveZ = pz * 0.9 + (dz / dist) * approach;
    // Burst fire with skill-based inaccuracy.
    bot.cooldown -= dt;
    if (bot.burstLeft > 0) {
      if (bot.cooldown <= 0) {
        bot.cooldown = bot.fireInterval * 0.55;
        bot.burstLeft -= 1;
        const err = (1 - bot.skill) * 1.6 + 0.25;
        fire(bot, best, { err, dist });
      }
    } else {
      bot.burstTimer -= dt;
      if (bot.burstTimer <= 0 && dist < 38) {
        bot.burstLeft = 2 + Math.floor(rng() * 3);
        bot.burstTimer = range(rng, 0.9, 2.2);
      }
    }
  } else {
    // No contact: an enemy was just here — flush them out with the Charge.
    if (bot.grenades > 0 && bot.lastSeen && time - bot.lastSeenAt < 2.5) {
      const gd = Math.hypot(bot.lastSeen.x - bot.pos.x, bot.lastSeen.z - bot.pos.z);
      bot.grenadeTimer -= dt;
      if (gd > 5 && gd < 20 && bot.grenadeTimer <= 0 && ctx.throwGrenade) {
        ctx.throwGrenade(bot, bot.lastSeen);
        bot.grenades -= 1;
        bot.grenadeTimer = 999; // one Charge per round, and it is spent
      }
    }
    // No contact: head for the Beacon via waypoints, or the last-seen spot.
    // Pushers run the Beacon; everyone else hunts the last-seen spot. Late in
    // the round the whole team converges on the objective instead of hunting.
    const pushing = bot.role === 'push' || (ctx.roundTimeLeft ?? 99) < 25;
    let goal = pushing ? BEACON : bot.lastSeen && time - bot.lastSeenAt < 6 ? bot.lastSeen : { x: 0, z: 0 };
    if (!bot.waypoint || Math.hypot(bot.waypoint.x - bot.pos.x, bot.waypoint.z - bot.pos.z) < 1.5) {
      // Pick the waypoint closest to the goal that we can walk toward.
      let wp = WAYPOINTS[0], wd = Infinity;
      for (const w of WAYPOINTS) {
        const d = Math.hypot(w.x - goal.x, w.z - goal.z) + Math.hypot(w.x - bot.pos.x, w.z - bot.pos.z) * 0.15;
        if (d < wd) { wd = d; wp = w; }
      }
      bot.waypoint = wp;
    }
    const dx = bot.waypoint.x - bot.pos.x, dz = bot.waypoint.z - bot.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    moveX = dx / dist; moveZ = dz / dist;
    bot.yaw = Math.atan2(dx, dz);
    bot.cooldown -= dt;
    // Cover bots hold the mid lane and hose the last-seen spot so the pusher
    // can cross: tracers only, no damage — the shots are suppressive.
    if (bot.role === 'cover' && bot.lastSeen && time - bot.lastSeenAt < 8) {
      bot.coverTimer -= dt;
      const nearMid = Math.hypot(bot.pos.x, bot.pos.z) < 14;
      if (bot.coverTimer <= 0 && nearMid) {
        bot.coverTimer = 2.4;
        bot.yaw = Math.atan2(bot.lastSeen.x - bot.pos.x, bot.lastSeen.z - bot.pos.z);
        fire(bot, { pos: new THREE.Vector3(bot.lastSeen.x, 1.2, bot.lastSeen.z) }, { err: 0.6, dist: 20 });
      }
    }
  }
  // Retreating overrides the strafe: run away from the spotted enemy.
  if (time < bot.fleeUntil && best) {
    const fx = bot.pos.x - best.pos.x, fz = bot.pos.z - best.pos.z;
    const fl = Math.hypot(fx, fz) || 1;
    moveX = fx / fl; moveZ = fz / fl;
    bot.yaw = Math.atan2(fx, fz);
  }
  // Move axis-separated against colliders.
  const len = Math.hypot(moveX, moveZ);
  if (len > 0.01) {
    const nx = bot.pos.x + (moveX / len) * bot.speed * dt;
    if (!world.blockedAt(nx, bot.pos.z, 0.42)) bot.pos.x = nx;
    const nz = bot.pos.z + (moveZ / len) * bot.speed * dt;
    if (!world.blockedAt(bot.pos.x, nz, 0.42)) bot.pos.z = nz;
    bot.walkPhase += dt * 9;
  }
  bot.group.rotation.y = bot.yaw;
  bot.model.legL.rotation.x = len > 0.01 ? Math.sin(bot.walkPhase) * 0.55 : 0;
  bot.model.legR.rotation.x = len > 0.01 ? -Math.sin(bot.walkPhase) * 0.55 : 0;
  bot.model.chev.position.y = 2.25 + Math.sin(time * 2.4 + bot.pos.x) * 0.07;
  bot.model.chev.rotation.y += dt * 1.5;
  if (bot.flash > 0) {
    bot.flash -= dt;
    if (bot.flash <= 0) bot.model.suitMat.emissive.setHex(0x000000);
  }
}
