// Ember Charge — Emberline's lobbed explosive.
// Thrown by the player (G key) or by bots: it arcs under gravity, bounces off
// the floor and walls, fuses, then detonates. The blast hurts the thrower's
// enemies with distance falloff (and the thrower, up close), flashes a light,
// and makes a bang every bot in earshot turns to investigate.
import * as THREE from 'three';

export const GRENADE_FUSE = 1.8; // seconds from release to detonation
export const GRENADE_RADIUS = 7; // no damage past this distance
export const GRENADE_FULL_DAMAGE_RADIUS = 2.5; // full damage inside this
export const GRENADE_DAMAGE = 95; // centre damage before falloff
export const GRENADE_NOISE_RADIUS = 24; // bots this far away hear the bang

const GRAVITY = 14;
const FLOOR_BOUNCE = 0.42; // vertical speed kept after a floor bounce
const WALL_BOUNCE = 0.55; // speed kept after a wall bounce
const ROLL_FRICTION = 0.86; // horizontal speed kept per second on the floor
const BLAST_FADE = 0.45; // seconds the explosion shell stays visible

// Velocity that lobs `from` onto `to` in exactly `flight` seconds.
export function arcVelocity(from, to, flight) {
  const t = Math.max(0.4, flight);
  return {
    x: (to.x - from.x) / t,
    y: (to.y - from.y + 0.5 * GRAVITY * t * t) / t,
    z: (to.z - from.z) / t,
  };
}

// Damage at `dist` metres from the blast: full inside the inner radius,
// linear falloff to zero at the edge.
export function blastFalloff(dist) {
  if (dist >= GRENADE_RADIUS) return 0;
  if (dist <= GRENADE_FULL_DAMAGE_RADIUS) return 1;
  return 1 - (dist - GRENADE_FULL_DAMAGE_RADIUS) / (GRENADE_RADIUS - GRENADE_FULL_DAMAGE_RADIUS);
}

export function createGrenades(scene, world, onBlast) {
  const live = []; // { mesh, pos, vel, fuse, team, owner, spin }
  const blasts = []; // { shell, light, life }
  const shellGeo = new THREE.SphereGeometry(1, 20, 14);
  const shellMat = () =>
    new THREE.MeshBasicMaterial({
      color: 0xffa03a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

  function buildMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.35, metalness: 0.8 }),
    );
    g.add(body);
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.02, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 2.2 }),
    );
    band.rotation.x = Math.PI / 2;
    g.add(band);
    return g;
  }

  function spawn(pos, vel, team, owner) {
    const mesh = buildMesh();
    mesh.position.set(pos.x, pos.y, pos.z);
    scene.add(mesh);
    live.push({
      mesh, pos: mesh.position, vel: { ...vel },
      fuse: GRENADE_FUSE, team, owner, spin: Math.random() * Math.PI * 2,
    });
    return mesh;
  }

  function detonate(g) {
    const at = { x: g.pos.x, y: Math.max(0.3, g.pos.y), z: g.pos.z };
    // Expanding shell + a hard flash of light, both gone in under half a second.
    const shell = new THREE.Mesh(shellGeo, shellMat());
    shell.position.set(at.x, at.y, at.z);
    shell.scale.setScalar(0.3);
    scene.add(shell);
    const light = new THREE.PointLight(0xff8c3a, 90, 26, 1.6);
    light.position.set(at.x, at.y + 0.6, at.z);
    scene.add(light);
    blasts.push({ shell, light, life: BLAST_FADE });
    scene.remove(g.mesh);
    onBlast({ pos: at, team: g.team, owner: g.owner });
  }

  return {
    // Lob one from `pos` along `dir` (a normalised Vector3-like).
    throwFrom(pos, dir, team, owner, speed = 13.5) {
      const vel = {
        x: dir.x * speed,
        y: dir.y * speed + 2.6, // a little loft so it clears low cover
        z: dir.z * speed,
      };
      return spawn(pos, vel, team, owner);
    },
    // Lob one onto a target point (bots use this): flight time scales with range.
    throwAt(from, target, team, owner) {
      const dist = Math.hypot(target.x - from.x, target.z - from.z);
      const flight = Math.min(1.6, Math.max(0.7, dist / 9));
      const vel = arcVelocity(from, { x: target.x, y: 1.1, z: target.z }, flight);
      return spawn(from, vel, team, owner);
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const g = live[i];
        g.fuse -= dt;
        g.vel.y -= GRAVITY * dt;
        g.pos.x += g.vel.x * dt;
        g.pos.y += g.vel.y * dt;
        g.pos.z += g.vel.z * dt;
        g.spin += dt * 7;
        g.mesh.rotation.x = g.spin;
        g.mesh.rotation.z = g.spin * 0.6;
        // Floor: bounce while it still has energy, then roll to a stop.
        if (g.pos.y < 0.12) {
          g.pos.y = 0.12;
          if (Math.abs(g.vel.y) > 1.4) {
            g.vel.y = -g.vel.y * FLOOR_BOUNCE;
            g.vel.x *= 0.7;
            g.vel.z *= 0.7;
          } else {
            g.vel.y = 0;
            g.vel.x *= Math.pow(ROLL_FRICTION, dt * 60);
            g.vel.z *= Math.pow(ROLL_FRICTION, dt * 60);
          }
        }
        // Walls: reflect the blocked axis and keep a little over half the speed.
        if (world.blockedAt(g.pos.x, g.pos.z, 0.15)) {
          const px = g.pos.x - g.vel.x * dt, pz = g.pos.z - g.vel.z * dt;
          if (!world.blockedAt(px, g.pos.z, 0.15)) { g.pos.x = px; g.vel.x = -g.vel.x * WALL_BOUNCE; }
          else if (!world.blockedAt(g.pos.x, pz, 0.15)) { g.pos.z = pz; g.vel.z = -g.vel.z * WALL_BOUNCE; }
          else { g.pos.x = px; g.pos.z = pz; g.vel.x = -g.vel.x * WALL_BOUNCE; g.vel.z = -g.vel.z * WALL_BOUNCE; }
        }
        // The band blinks faster as the fuse runs down.
        const urgent = g.fuse < 0.5 ? (Math.sin(g.fuse * 40) > 0 ? 3.5 : 0.6) : 2.2;
        g.mesh.children[1].material.emissiveIntensity = urgent;
        if (g.fuse <= 0) { live.splice(i, 1); detonate(g); }
      }
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        b.life -= dt;
        const k = Math.max(0, b.life / BLAST_FADE);
        b.shell.scale.setScalar(0.3 + (1 - k) * GRENADE_RADIUS);
        b.shell.material.opacity = 0.85 * k;
        b.light.intensity = 90 * k;
        if (b.life <= 0) {
          scene.remove(b.shell); scene.remove(b.light);
          b.shell.material.dispose();
          blasts.splice(i, 1);
        }
      }
    },
    clear() {
      for (const g of live) scene.remove(g.mesh);
      live.length = 0;
      for (const b of blasts) { scene.remove(b.shell); scene.remove(b.light); b.shell.material.dispose(); }
      blasts.length = 0;
    },
    get count() { return live.length; },
  };
}
