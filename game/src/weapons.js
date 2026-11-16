// The arsenal: five guns and two grenades, each with its own numbers and its own view
// model. The weapon owns fire rate, magazine, reload and spread; main.js owns the ray
// and the damage, so a shot is one fire() call plus one raycast per pellet.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// damage: body damage per pellet at close range. headMult multiplies on a head hit.
// falloffStart/falloffRange: past falloffStart the damage fades toward 40% of itself.
export const WEAPONS = {
  rifle: { id: 'rifle', name: 'Vandal-9', kind: 'primary', price: 0, auto: true, mag: 30, reserve: 90, fireGap: 0.096, reload: 1.9, damage: 34, headMult: 4, pellets: 1, spreadStill: 0.0022, spreadMoving: 0.028, falloffStart: 25, falloffRange: 30, ads: false, desc: 'Auto rifle. The workhorse: steady, forgiving, deadly when you stop to aim.' },
  dmr: { id: 'dmr', name: 'Longbow', kind: 'primary', price: 2200, auto: false, mag: 10, reserve: 30, fireGap: 0.45, reload: 2.6, damage: 80, headMult: 4, pellets: 1, spreadStill: 0.0012, spreadMoving: 0.05, falloffStart: 40, falloffRange: 40, ads: true, desc: 'Marksman rifle. One headshot ends a round. Right-click to scope in.' },
  shotgun: { id: 'shotgun', name: 'Scatter-12', kind: 'primary', price: 1400, auto: false, mag: 6, reserve: 24, fireGap: 0.8, reload: 2.8, damage: 12, headMult: 2, pellets: 8, spreadStill: 0.045, spreadMoving: 0.06, falloffStart: 10, falloffRange: 12, ads: false, desc: 'Pump shotgun. Eight pellets up close; a whisper past twelve metres.' },
  smg: { id: 'smg', name: 'Needler', kind: 'primary', price: 1600, auto: true, mag: 25, reserve: 100, fireGap: 0.07, reload: 1.6, damage: 22, headMult: 4, pellets: 1, spreadStill: 0.006, spreadMoving: 0.03, falloffStart: 16, falloffRange: 20, ads: false, desc: 'Machine pistol. Sprays fast, kicks wide, best on the move and up close.' },
  pistol: { id: 'pistol', name: 'P9', kind: 'sidearm', price: 0, auto: false, mag: 12, reserve: 48, fireGap: 0.16, reload: 1.4, damage: 28, headMult: 4, pellets: 1, spreadStill: 0.004, spreadMoving: 0.025, falloffStart: 18, falloffRange: 22, ads: false, desc: 'Sidearm. Free, reliable, and the only gun you keep when the money runs out.' },
};
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag charge', price: 300, max: 2, desc: 'Bounces once, then bursts: up to 120 damage in a 6 m radius.' },
  flash: { id: 'flash', name: 'Flashbang', price: 200, max: 2, desc: 'Blinds every Rustjackal that can see it burst, for 2.5 seconds.' },
};
const MOVE_REFERENCE = 5.2;

function buildViewModel(def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const rust = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.5, metalness: 0.3 });
  const group = new THREE.Group();
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (def.id === 'rifle') {
    add(new THREE.BoxGeometry(0.09, 0.1, 0.42), light, 0, 0, 0);
    add(new THREE.BoxGeometry(0.045, 0.045, 0.4), dark, 0, 0.025, -0.38);
    add(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark, 0, -0.02, 0.3);
    add(new THREE.BoxGeometry(0.03, 0.06, 0.1), accent, 0, 0.08, -0.1);
  } else if (def.id === 'dmr') {
    add(new THREE.BoxGeometry(0.08, 0.09, 0.55), light, 0, 0, 0);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.5), dark, 0, 0.02, -0.48);
    add(new THREE.BoxGeometry(0.06, 0.06, 0.16), dark, 0, 0.075, -0.05);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.12), accent, 0, -0.03, 0.32);
  } else if (def.id === 'shotgun') {
    add(new THREE.BoxGeometry(0.1, 0.11, 0.4), rust, 0, 0, 0);
    add(new THREE.BoxGeometry(0.06, 0.06, 0.5), dark, 0, 0.01, -0.42);
    add(new THREE.BoxGeometry(0.07, 0.07, 0.3), light, 0, -0.06, -0.2);
    add(new THREE.BoxGeometry(0.08, 0.09, 0.2), dark, 0, -0.02, 0.28);
  } else if (def.id === 'smg') {
    add(new THREE.BoxGeometry(0.08, 0.09, 0.3), light, 0, 0, 0);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.3), dark, 0, 0.02, -0.28);
    add(new THREE.BoxGeometry(0.03, 0.12, 0.05), dark, 0, -0.1, 0.02);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.18), accent, 0, 0.06, -0.05);
  } else {
    add(new THREE.BoxGeometry(0.06, 0.09, 0.26), light, 0, 0, 0);
    add(new THREE.BoxGeometry(0.05, 0.05, 0.16), dark, 0, 0.01, -0.18);
    add(new THREE.BoxGeometry(0.05, 0.1, 0.06), dark, 0, -0.09, 0.05);
  }
  group.position.set(0.24, -0.2, -0.42);
  return group;
}

export function createWeapons(camera, audio) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Ammo is tracked per weapon, so switching back to a gun keeps its own magazine.
  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };

  const state = {
    slot: 'primary', // 'primary' | 'pistol' | 'frag' | 'flash'
    primaryId: 'rifle',
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    frags: 0,
    flashes: 0,
    switchLeft: 0,
  };

  function currentDef() {
    return state.slot === 'pistol' ? WEAPONS.pistol : WEAPONS[state.primaryId];
  }

  function showModel() {
    for (const id of Object.keys(models)) models[id].visible = false;
    if (state.slot === 'primary' || state.slot === 'pistol') {
      models[currentDef().id].visible = true;
    }
  }
  showModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[currentDef().id];
    if (model) {
      model.position.z = -0.42 + state.kick;
      model.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) model.rotation.x = -0.55 * Math.min(1, (currentDef().reload - state.reloadLeft) * 2);
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const def = currentDef();
        const slot = ammo[def.id];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
        audio.reloadEnd();
      }
    }
  }

  return {
    state,
    WEAPONS,
    GRENADES,
    step,
    def() {
      return currentDef();
    },
    ready() {
      if (state.switchLeft > 0 || state.reloadLeft > 0 || state.cooldown > 0) return false;
      if (state.slot === 'frag') return state.frags > 0;
      if (state.slot === 'flash') return state.flashes > 0;
      return ammo[currentDef().id].mag > 0;
    },
    // Fires one trigger pull. Returns the shot's numbers, or null when it cannot fire.
    // Grenade slots return { grenade: 'frag' | 'flash' } and consume one grenade.
    fire() {
      if (state.reloadLeft > 0 || state.cooldown > 0 || state.switchLeft > 0) return null;
      if (state.slot === 'frag' || state.slot === 'flash') {
        if (state.slot === 'frag' && state.frags <= 0) return null;
        if (state.slot === 'flash' && state.flashes <= 0) return null;
        const kind = state.slot;
        if (kind === 'frag') state.frags -= 1;
        else state.flashes -= 1;
        state.cooldown = 0.5;
        audio.grenadePin();
        this.switchTo('primary');
        return { grenade: kind };
      }
      const slot = ammo[currentDef().id];
      if (slot.mag <= 0) {
        audio.dryFire();
        state.cooldown = 0.25;
        return null;
      }
      slot.mag -= 1;
      state.cooldown = currentDef().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      audio.shot();
      return { def: currentDef() };
    },
    reload() {
      const def = currentDef();
      const slot = ammo[def.id];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return;
      if (state.slot === 'frag' || state.slot === 'flash') return;
      state.reloadLeft = def.reload;
      audio.reloadStart();
    },
    spread(speed, aiming) {
      const def = currentDef();
      const base = def.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * def.spreadMoving;
      return aiming ? base * 0.45 : base;
    },
    switchTo(slot) {
      if (slot === state.slot || state.switchLeft > 0) return false;
      if (slot === 'frag' && state.frags <= 0) return false;
      if (slot === 'flash' && state.flashes <= 0) return false;
      state.slot = slot;
      state.switchLeft = 0.28;
      showModel();
      return true;
    },
    // Buy menu actions. Each returns true when the purchase lands.
    equipPrimary(id) {
      const def = WEAPONS[id];
      if (!def || def.kind !== 'primary') return false;
      state.primaryId = id;
      ammo[id] = { mag: def.mag, reserve: def.reserve };
      state.cooldown = 0;
      state.reloadLeft = 0;
      if (state.slot !== 'primary') this.switchTo('primary');
      showModel();
      return true;
    },
    refillAmmo() {
      const def = currentDef();
      ammo[def.id] = { mag: def.mag, reserve: def.reserve };
    },
    addGrenade(kind) {
      if (kind === 'frag' && state.frags < GRENADES.frag.max) {
        state.frags += 1;
        return true;
      }
      if (kind === 'flash' && state.flashes < GRENADES.flash.max) {
        state.flashes += 1;
        return true;
      }
      return false;
    },
    resetRound() {
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.switchLeft = 0;
      state.slot = 'primary';
      const def = WEAPONS[state.primaryId];
      ammo[def.id] = { mag: def.mag, reserve: def.reserve };
      showModel();
    },
    ammoOf(id) {
      return ammo[id];
    },
  };
}
