// The charge: Vanguard carries it, plants it at a site by holding E, and defends it
// until it blows. A Rustjackal that reaches it channels a defuse. Planting takes 3
// seconds of standing still in the zone; the planted charge ticks for 25 seconds with
// beeps that speed up as the end nears.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_SECONDS = 3;
const DETONATE_SECONDS = 25;

export function createBomb(scene, world) {
  const chargeGroup = new THREE.Group();
  const chargeBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.26),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 }),
  );
  chargeBody.position.y = 0.11;
  const chargeLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.site) }),
  );
  chargeLight.position.set(0, 0.26, 0);
  const glow = new THREE.PointLight(new THREE.Color(PALETTE.site), 0, 6, 1.8);
  glow.position.set(0, 0.4, 0);
  chargeGroup.add(chargeBody, chargeLight, glow);
  chargeGroup.visible = false;
  scene.add(chargeGroup);

  const state = {
    status: 'carried', // carried | planting | planted | detonated | defused
    site: null,
    plantProgress: 0,
    timeLeft: DETONATE_SECONDS,
    position: new THREE.Vector3(),
    beepTimer: 0,
  };

  function siteAt(position) {
    for (const site of Object.values(world.sites)) {
      if (Math.abs(position.x - site.center.x) <= site.half.x && Math.abs(position.z - site.center.z) <= site.half.z) return site.id;
    }
    return null;
  }

  return {
    state,
    siteAt,
    reset() {
      state.status = 'carried';
      state.site = null;
      state.plantProgress = 0;
      state.timeLeft = DETONATE_SECONDS;
      state.beepTimer = 0;
      chargeGroup.visible = false;
      glow.intensity = 0;
    },
    step(dt, ctx) {
      if (state.status === 'carried' || state.status === 'planting') {
        const site = siteAt(ctx.playerPosition);
        if (ctx.playerAlive && site && ctx.plantHeld) {
          state.status = 'planting';
          state.site = site;
          state.plantProgress += dt / PLANT_SECONDS;
          if (state.plantProgress >= 1) {
            state.status = 'planted';
            state.timeLeft = DETONATE_SECONDS;
            state.position.copy(ctx.playerPosition);
            state.position.y = 0;
            chargeGroup.position.copy(state.position);
            chargeGroup.visible = true;
            ctx.onPlanted(site);
          }
        } else {
          state.status = 'carried';
          state.plantProgress = Math.max(0, state.plantProgress - dt / 1.5);
          state.site = null;
        }
      } else if (state.status === 'planted') {
        state.timeLeft -= dt;
        state.beepTimer -= dt;
        const interval = 0.25 + (state.timeLeft / DETONATE_SECONDS) * 0.75;
        if (state.beepTimer <= 0) {
          state.beepTimer = interval;
          ctx.audio.plantBeep(false);
          glow.intensity = 6;
        }
        glow.intensity = Math.max(0, glow.intensity - dt * 30);
        chargeLight.visible = state.timeLeft % 0.5 < 0.25;
        if (state.timeLeft <= 0) {
          state.status = 'detonated';
          chargeGroup.visible = false;
          ctx.onDetonated();
        }
      }
    },
    defuse() {
      if (state.status !== 'planted') return;
      state.status = 'defused';
      chargeGroup.visible = false;
    },
  };
}
