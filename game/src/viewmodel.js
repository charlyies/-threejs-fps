// First-person viewmodel — the gun the player actually sees.
// One small box-built model per weapon (pistol, SMG, rifle, sniper), each with
// its own silhouette: barrel length, magazine, stock and, for the Deadeye, a
// scope. It bobs with the player's stride, kicks on every shot, dips while
// reloading, and slides to the centre of the screen when aiming down sights.
import * as THREE from 'three';

const DARK = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.7 });
const GRIP = new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.85, metalness: 0.1 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.9 });
const SCOPE_GLASS = new THREE.MeshStandardMaterial({ color: 0x0a2a3a, roughness: 0.15, metalness: 0.9 });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// Each model faces -z (downrange) and sits around the origin; the group is
// then placed at the hip or ADS position by update().
function buildPistol() {
  const g = new THREE.Group();
  g.add(box(0.06, 0.09, 0.26, DARK, 0, 0, -0.08));
  g.add(box(0.05, 0.12, 0.07, GRIP, 0, -0.09, 0.04));
  g.add(box(0.065, 0.02, 0.2, ACCENT, 0, 0.05, -0.06));
  g.add(box(0.02, 0.03, 0.05, DARK, 0, 0.05, -0.22)); // front sight
  return { group: g, muzzle: new THREE.Vector3(0, 0, -0.24) };
}
function buildSmg() {
  const g = new THREE.Group();
  g.add(box(0.09, 0.11, 0.42, DARK, 0, 0, -0.1));
  g.add(box(0.06, 0.16, 0.06, GRIP, 0, -0.12, -0.02)); // magazine
  g.add(box(0.07, 0.09, 0.16, GRIP, 0, -0.02, 0.16)); // stock
  g.add(box(0.095, 0.02, 0.3, ACCENT, 0, 0.06, -0.12));
  g.add(box(0.04, 0.06, 0.1, DARK, 0, -0.07, -0.2)); // foregrip
  return { group: g, muzzle: new THREE.Vector3(0, 0, -0.34) };
}
function buildRifle() {
  const g = new THREE.Group();
  g.add(box(0.09, 0.12, 0.55, DARK, 0, 0, -0.14));
  g.add(box(0.07, 0.1, 0.3, GRIP, 0, 0.01, -0.3)); // handguard
  g.add(box(0.06, 0.18, 0.07, GRIP, 0, -0.13, -0.05)); // magazine
  g.add(box(0.08, 0.1, 0.18, GRIP, 0, -0.01, 0.2)); // stock
  g.add(box(0.095, 0.02, 0.4, ACCENT, 0, 0.065, -0.16));
  return { group: g, muzzle: new THREE.Vector3(0, 0, -0.46) };
}
function buildSniper() {
  const g = new THREE.Group();
  g.add(box(0.07, 0.1, 0.72, DARK, 0, 0, -0.2));
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12), DARK);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.09, -0.08);
  g.add(scope);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 12), SCOPE_GLASS);
  glass.rotation.x = Math.PI / 2;
  glass.position.set(0, 0.09, -0.19);
  g.add(glass);
  g.add(box(0.06, 0.14, 0.06, GRIP, 0, -0.11, 0.02)); // bolt handle base
  g.add(box(0.05, 0.2, 0.06, GRIP, 0, -0.12, 0.1)); // magazine
  g.add(box(0.07, 0.09, 0.2, GRIP, 0, -0.01, 0.24)); // stock
  g.add(box(0.075, 0.015, 0.5, ACCENT, 0, 0.055, -0.2));
  return { group: g, muzzle: new THREE.Vector3(0, 0, -0.6) };
}

const BUILDERS = { pistol: buildPistol, smg: buildSmg, rifle: buildRifle, sniper: buildSniper };
const HIP_POS = new THREE.Vector3(0.27, -0.23, -0.42);
const ADS_POS = new THREE.Vector3(0, -0.148, -0.34);

export function createViewmodel(camera) {
  const root = new THREE.Group();
  root.position.copy(HIP_POS);
  camera.add(root);
  const models = {};
  for (const [id, build] of Object.entries(BUILDERS)) {
    const built = build();
    built.group.visible = false;
    root.add(built.group);
    models[id] = built;
  }
  let current = 'pistol';
  models.pistol.group.visible = true;

  // Muzzle flash: a small additive quad at the barrel tip, shown for one frame
  // after each shot. One shared quad, re-parented per weapon.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({
      color: 0xffc27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  flash.position.copy(models.pistol.muzzle);
  root.add(flash);

  let kick = 0; // 0..1, springs back to 0
  let flashT = 0; // seconds the flash stays lit
  let bobPhase = 0;
  let reloadT = 0, reloadDur = 1;
  let aimBlend = 0; // 0 = hip, 1 = aiming down sights

  return {
    setWeapon(id) {
      if (!models[id] || id === current) return;
      models[current].group.visible = false;
      current = id;
      models[current].group.visible = true;
      flash.position.copy(models[current].muzzle);
      kick = 0;
    },
    kick() { kick = 1; flashT = 0.05; flash.material.opacity = 0.95; },
    startReload(seconds) { reloadT = seconds; reloadDur = Math.max(0.1, seconds); },
    update(dt, { moving = false, sprint = false, aiming = false } = {}) {
      if (moving) bobPhase += dt * (sprint ? 13 : 9.5);
      kick = Math.max(0, kick - dt * 7);
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) flash.material.opacity = 0;
        else flash.rotation.z = Math.random() * Math.PI;
      }
      aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * 11);
      const pos = new THREE.Vector3().lerpVectors(HIP_POS, ADS_POS, aimBlend);
      // Stride bob, stronger while sprinting, gone entirely while aiming.
      const bobAmp = (moving ? 1 : 0) * (sprint ? 0.014 : 0.009) * (1 - aimBlend * 0.85);
      pos.x += Math.sin(bobPhase) * bobAmp;
      pos.y += Math.abs(Math.cos(bobPhase)) * bobAmp * 0.8 - 0.004;
      // Kick shoves the gun back and up; the reload dip drops and tilts it.
      pos.z += kick * 0.055;
      let dip = 0;
      if (reloadT > 0) {
        reloadT -= dt;
        dip = Math.sin(Math.PI * Math.max(0, 1 - reloadT / reloadDur));
      }
      pos.y -= dip * 0.09;
      root.position.copy(pos);
      root.rotation.x = kick * 0.07 - dip * 0.55;
      root.rotation.z = Math.sin(bobPhase) * bobAmp * 0.35;
    },
  };
}
