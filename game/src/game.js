// EMBERLINE's match: menu, buy phase, round, round end, match end. One state object
// holds the phase, the round and match score, the timers and the thrown grenades, so
// the whole match can be read in one place. Shooting is resolved here too — the player
// raycast, the bots' return fire, tracers and grenades — because all of it reads and
// writes the same state. The fixed-step loop in main.js calls step(); rendering reads
// the scene directly.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, GRENADES } from './weapons.js';
import { REWARDS, AMMO_PRICE } from './economy.js';

const ROUND_SECONDS = 100;
const BUY_SECONDS = 20;
const ROUND_END_SECONDS = 4.5;
const ROUNDS_TO_WIN = 5;
const MAX_ROUNDS = 9;
const NOISE_RADIUS = 26;
const TRACER_COUNT = 14;
const TRACER_LIFE = 0.09;
const FRAG_FUSE = 1.4;
const FRAG_RADIUS = 6;
const FLASH_RADIUS = 12;
const FLASH_BLIND_SECONDS = 2.5;

export function createGame(deps) {
  const { scene, camera, world, player, weapons, bots, bomb, economy, hud, audio } = deps;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;

  // Tracer pool: pre-made lines, reused, never allocated per shot.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  function spawnTracer(from, to, color) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.color.set(color);
    tracer.line.material.opacity = 0.9;
    tracer.line.visible = true;
    tracer.life = TRACER_LIFE;
  }

  const direction = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const target = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const grenadeBox = new THREE.Box3();

  const state = {
    phase: 'menu', // menu | buy | round | roundEnd | matchEnd
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    roundTimer: ROUND_SECONDS,
    buyTimer: BUY_SECONDS,
    roundEndTimer: 0,
    roundEndReason: '',
    roundEndWon: false,
    overtime: false,
    time: 0,
    grenades: [],
    lastDamageFrom: null,
  };

  function playerBox() {
    const p = player.state;
    return { minX: p.position.x - 0.34, maxX: p.position.x + 0.34, minY: p.position.y, maxY: p.position.y + p.height, minZ: p.position.z - 0.34, maxZ: p.position.z + 0.34 };
  }

  // Slab test: does the ray from origin along dir hit the player's box before maxDist?
  // Returns the distance, or -1. No allocation: the box is read from playerBox().
  function rayHitsPlayer(origin, dir, maxDist) {
    const box = playerBox();
    let tMin = 0;
    let tMax = maxDist;
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    const lo = [box.minX, box.minY, box.minZ];
    const hi = [box.maxX, box.maxY, box.maxZ];
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(d[axis]) < 1e-9) {
        if (o[axis] < lo[axis] || o[axis] > hi[axis]) return -1;
      } else {
        let t1 = (lo[axis] - o[axis]) / d[axis];
        let t2 = (hi[axis] - o[axis]) / d[axis];
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return -1;
      }
    }
    return tMin;
  }

  function notifyNoise(position, radius) {
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const distance = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
      if (distance > radius) continue;
      bot.lastSeen.set(position.x + (Math.random() * 4 - 2), 0, position.z + (Math.random() * 4 - 2));
      bot.seenAt = state.time - 1;
      if (bot.state === 'patrol' || bot.state === 'investigate') {
        bot.state = 'investigate';
        bot.path = [];
      }
    }
  }

  function shootPlayerWeapon(spread, random) {
    const fired = weapons.fire();
    if (!fired) return null;
    if (fired.grenade) {
      throwGrenade(fired.grenade);
      return { grenade: fired.grenade };
    }
    const def = fired.def;
    camera.getWorldDirection(direction);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    muzzle.copy(camera.position);
    muzzle.addScaledVector(direction, 0.6);
    muzzle.y -= 0.12;
    muzzle.x += Math.cos(camera.rotation.y) * 0.2;
    let totalDamage = 0;
    let killedBot = null;
    let hitSomething = false;
    for (let pellet = 0; pellet < def.pellets; pellet += 1) {
      const pelletDir = direction.clone();
      if (def.pellets > 1) {
        pelletDir.x += (random() * 2 - 1) * def.spreadStill * 2;
        pelletDir.y += (random() * 2 - 1) * def.spreadStill * 2;
        pelletDir.normalize();
      }
      scene.updateMatrixWorld(true);
      raycaster.set(camera.position, pelletDir);
      const worldHit = raycaster.intersectObjects(world.shootables, false)[0];
      const botHit = raycaster.intersectObjects(bots.hitMeshes, false)[0];
      const worldDistance = worldHit ? worldHit.distance : Infinity;
      const botDistance = botHit ? botHit.distance : Infinity;
      if (botDistance < worldDistance) {
        const bot = botHit.object.userData.bot;
        const part = botHit.object.userData.part;
        const falloff = Math.max(0.4, 1 - Math.max(0, botDistance - def.falloffStart) / def.falloffRange);
        const amount = Math.round(def.damage * falloff * (part === 'head' ? def.headMult : 1));
        const killed = bots.damage(bot, amount, part);
        totalDamage += amount;
        hitSomething = true;
        hitPoint.copy(botHit.point);
        spawnTracer(muzzle, hitPoint, 0xf0a830);
        hud.hitMarker(killed);
        audio.hit();
        if (killed) {
          killedBot = bot;
          economy.earn(REWARDS.kill);
          hud.killfeed(`You eliminated ${bot.name} (+$${REWARDS.kill})`);
          audio.kill();
          hud.setMoney(economy.state.money);
        }
      } else if (worldHit) {
        hitSomething = true;
        hitPoint.copy(worldHit.point);
        spawnTracer(muzzle, hitPoint, 0xf0a830);
      } else {
        hitPoint.copy(camera.position).addScaledVector(pelletDir, 60);
        spawnTracer(muzzle, hitPoint, 0xf0a830);
      }
    }
    player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
    notifyNoise(player.state.position, NOISE_RADIUS);
    return { def, damage: totalDamage, killed: killedBot, hit: hitSomething };
  }

  function botShoot(bot) {
    const p = player.state;
    muzzle.set(bot.position.x, bot.position.y + 1.2, bot.position.z);
    target.set(p.position.x, p.position.y + (p.crouching ? 0.8 : 1.2), p.position.z);
    direction.copy(target).sub(muzzle);
    const distance = direction.length();
    direction.normalize();
    const playerSpeed = player.groundSpeed();
    const spread = 0.02 + distance * 0.0009 + playerSpeed * 0.004;
    direction.x += (Math.random() * 2 - 1) * spread;
    direction.y += (Math.random() * 2 - 1) * spread;
    direction.z += (Math.random() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(muzzle, direction);
    raycaster.far = 90;
    const wallHit = raycaster.intersectObjects(world.shootables, false)[0];
    const wallDistance = wallHit ? wallHit.distance : Infinity;
    const hitDistance = rayHitsPlayer(muzzle, direction, Math.min(wallDistance, 90));
    audio.enemyShot(distance);
    if (hitDistance >= 0 && hitDistance < wallDistance) {
      hitPoint.copy(muzzle).addScaledVector(direction, hitDistance);
      spawnTracer(muzzle, hitPoint, 0xd84a35);
      const head = hitPoint.y > p.position.y + p.height - 0.28;
      const amount = head ? 16 + Math.floor(Math.random() * 5) : 10 + Math.floor(Math.random() * 6);
      const died = player.damage(amount);
      hud.damageFlash();
      audio.hurt();
      hud.setHealth(p.health);
      if (died) endRound(false, 'You were eliminated');
    } else if (wallHit) {
      spawnTracer(muzzle, wallHit.point, 0xd84a35);
    } else {
      hitPoint.copy(muzzle).addScaledVector(direction, 60);
      spawnTracer(muzzle, hitPoint, 0xd84a35);
    }
  }

  function throwGrenade(kind) {
    const geometry = new THREE.SphereGeometry(0.09, 10, 8);
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(kind === 'frag' ? PALETTE.rust : PALETTE.site), roughness: 0.5, metalness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    camera.getWorldDirection(direction);
    const start = camera.position.clone().addScaledVector(direction, 0.5);
    start.y -= 0.1;
    mesh.position.copy(start);
    scene.add(mesh);
    const velocity = direction.clone().multiplyScalar(16);
    velocity.y += 4.5;
    state.grenades.push({ mesh, velocity, kind, fuse: FRAG_FUSE, bounced: 0 });
  }

  function explodeGrenade(grenade) {
    const position = grenade.mesh.position;
    scene.remove(grenade.mesh);
    if (grenade.kind === 'frag') {
      audio.explosion();
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const distance = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
        if (distance > FRAG_RADIUS) continue;
        const from = new THREE.Vector3(position.x, position.y + 0.2, position.z);
        const to = new THREE.Vector3(bot.position.x, bot.position.y + 1.0, bot.position.z);
        raycaster.set(from, to.clone().sub(from).normalize());
        raycaster.far = distance;
        if (raycaster.intersectObjects(world.shootables, false)[0]) continue;
        const amount = Math.round(120 * (1 - distance / FRAG_RADIUS) + 10);
        const killed = bots.damage(bot, amount, 'torso');
        if (killed) {
          economy.earn(REWARDS.kill);
          hud.killfeed(`Frag eliminated ${bot.name} (+$${REWARDS.kill})`);
          hud.setMoney(economy.state.money);
        }
      }
      const playerDistance = Math.hypot(player.state.position.x - position.x, player.state.position.z - position.z);
      if (playerDistance < 3 && player.state.alive) {
        player.damage(25);
        hud.setHealth(player.state.health);
        hud.damageFlash();
      }
    } else {
      audio.flash();
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const distance = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
        if (distance > FLASH_RADIUS) continue;
        const from = new THREE.Vector3(position.x, position.y + 0.2, position.z);
        const to = new THREE.Vector3(bot.position.x, bot.position.y + 1.45, bot.position.z);
        raycaster.set(from, to.clone().sub(from).normalize());
        raycaster.far = distance;
        if (raycaster.intersectObjects(world.shootables, false)[0]) continue;
        bot.blindUntil = state.time + FLASH_BLIND_SECONDS;
      }
      const playerDistance = Math.hypot(player.state.position.x - position.x, player.state.position.z - position.z);
      if (playerDistance < 9) {
        camera.getWorldDirection(direction);
        const toBurst = new THREE.Vector3().copy(position).sub(camera.position).normalize();
        if (direction.dot(toBurst) > 0.2) hud.flashWhite(Math.max(0.25, 1 - playerDistance / 12));
      }
    }
  }

  function stepGrenades(dt) {
    for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
      const grenade = state.grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= 14 * dt;
      const next = grenade.mesh.position.clone().addScaledVector(grenade.velocity, dt);
      grenadeBox.min.set(next.x - 0.09, next.y - 0.09, next.z - 0.09);
      grenadeBox.max.set(next.x + 0.09, next.y + 0.09, next.z + 0.09);
      let bounced = false;
      for (const collider of world.colliders) {
        if (!grenadeBox.intersectsBox(collider)) continue;
        bounced = true;
        if (Math.abs(grenade.velocity.y) > 1) grenade.velocity.y = -grenade.velocity.y * 0.35;
        else {
          grenade.velocity.x *= 0.5;
          grenade.velocity.z *= 0.5;
        }
        break;
      }
      if (!bounced) grenade.mesh.position.copy(next);
      if (grenade.mesh.position.y < 0.09) {
        grenade.mesh.position.y = 0.09;
        if (Math.abs(grenade.velocity.y) > 1.5) {
          grenade.velocity.y = -grenade.velocity.y * 0.35;
          if (grenade.bounced < 2) {
            grenade.bounced += 1;
            audio.bounce();
          }
        } else grenade.velocity.y = 0;
        grenade.velocity.x *= 0.92;
        grenade.velocity.z *= 0.92;
      }
      if (grenade.fuse <= 0) {
        explodeGrenade(grenade);
        state.grenades.splice(i, 1);
      }
    }
  }

  function shopItems() {
    const items = [];
    const keys = { rifle: '1', dmr: '2', shotgun: '3', smg: '4' };
    for (const id of ['rifle', 'dmr', 'shotgun', 'smg']) {
      const def = WEAPONS[id];
      items.push({ id: `gun:${id}`, name: def.name, price: def.price, desc: def.desc, key: keys[id], owned: economy.state.ownedPrimary === id });
    }
    items.push({ id: 'ammo', name: 'Refill ammo', price: AMMO_PRICE, desc: 'Full magazine and reserve for your current guns.', key: '5', owned: false });
    items.push({ id: 'grenade:frag', name: GRENADES.frag.name, price: GRENADES.frag.price, desc: GRENADES.frag.desc, key: '6', owned: false });
    items.push({ id: 'grenade:flash', name: GRENADES.flash.name, price: GRENADES.flash.price, desc: GRENADES.flash.desc, key: '7', owned: false });
    return items;
  }

  function buy(itemId) {
    let result;
    if (itemId.startsWith('gun:')) result = economy.buyPrimary(itemId.slice(4));
    else if (itemId.startsWith('grenade:')) result = economy.buyGrenade(itemId.slice(8));
    else if (itemId === 'ammo') result = economy.buyAmmo();
    else return;
    if (result.ok) {
      audio.buy();
      hud.setMoney(economy.state.money);
      hud.setGrenades(weapons.state.frags, weapons.state.flashes);
      hud.refreshBuy(economy.state.money, WEAPONS[economy.state.ownedPrimary].name);
      hud.setAmmo(weapons.ammoOf(weapons.def().id).mag, weapons.ammoOf(weapons.def().id).reserve, weapons.def().name);
    } else {
      audio.denied();
      hud.killfeed(`Buy failed: ${result.reason}`);
    }
  }

  function startBuy() {
    state.phase = 'buy';
    state.buyTimer = BUY_SECONDS;
    hud.hideOverlay();
    hud.buildBuy(shopItems(), (id) => buy(id), () => startRound());
    hud.refreshBuy(economy.state.money, WEAPONS[economy.state.ownedPrimary].name);
    hud.showBuy();
    hud.setTimer(state.buyTimer);
    hud.hideBanner();
  }

  function startRound() {
    hud.hideBuy();
    state.phase = 'round';
    state.roundTimer = ROUND_SECONDS;
    for (const grenade of state.grenades) scene.remove(grenade.mesh);
    state.grenades.length = 0;
    player.reset(world.playerSpawn);
    weapons.resetRound();
    bots.spawn(world.botSpawns);
    bomb.reset();
    hud.setHealth(player.state.health);
    hud.setAmmo(weapons.ammoOf(weapons.def().id).mag, weapons.ammoOf(weapons.def().id).reserve, weapons.def().name);
    hud.setGrenades(weapons.state.frags, weapons.state.flashes);
    hud.setMoney(economy.state.money);
    hud.setScore(state.scoreUs, state.scoreThem);
    hud.setAlive(1, bots.aliveCount());
    hud.setBomb(null);
    hud.setPlant(0);
    hud.hideBanner();
  }

  function endRound(won, reason) {
    if (state.phase !== 'round') return;
    state.phase = 'roundEnd';
    state.roundEndTimer = ROUND_END_SECONDS;
    state.roundEndReason = reason;
    state.roundEndWon = won;
    if (won) {
      state.scoreUs += 1;
      economy.earn(REWARDS.roundWin);
      audio.roundWin();
      hud.showBanner('ROUND WON', `${reason} · +$${REWARDS.roundWin}`);
    } else {
      state.scoreThem += 1;
      economy.earn(REWARDS.roundLoss);
      audio.roundLose();
      hud.showBanner('ROUND LOST', `${reason} · +$${REWARDS.roundLoss}`);
    }
    hud.setScore(state.scoreUs, state.scoreThem);
    hud.setMoney(economy.state.money);
    hud.setBomb(null);
    hud.setPlant(0);
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const won = state.scoreUs > state.scoreThem;
    const detail = `Final score Vanguard ${state.scoreUs} — ${state.scoreThem} Rustjackals. ${won ? 'Dock 9 is yours.' : 'The Rustjackals keep the dock.'}`;
    hud.showOverlay('match', detail);
  }

  function startMatch() {
    state.round = 1;
    state.scoreUs = 0;
    state.scoreThem = 0;
    state.overtime = false;
    economy.reset();
    weapons.equipPrimary('rifle');
    startBuy();
  }

  function step(dt, input, random) {
    state.time += dt;
    for (const tracer of tracers) {
      if (!tracer.line.visible) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.9;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    if (state.phase === 'menu') {
      bots.step(dt, {
        time: state.time,
        playerPosition: player.state.position,
        playerAlive: false,
        bombPlanted: false,
        bombSite: null,
        botShoot: () => {},
        bombDefused: () => {},
      });
      return;
    }
    if (state.phase === 'buy') {
      state.buyTimer -= dt;
      hud.setTimer(state.buyTimer);
      bots.step(dt, {
        time: state.time,
        playerPosition: player.state.position,
        playerAlive: false,
        bombPlanted: false,
        bombSite: null,
        botShoot: () => {},
        bombDefused: () => {},
      });
      player.step(dt, input.keys);
      if (state.buyTimer <= 0) startRound();
      return;
    }
    if (state.phase === 'round') {
      state.roundTimer -= dt;
      hud.setTimer(state.roundTimer);
      const planting = input.keys.has('KeyE');
      bomb.step(dt, {
        playerPosition: player.state.position,
        playerAlive: player.state.alive,
        plantHeld: planting,
        audio,
        onPlanted: (site) => {
          economy.earn(REWARDS.plant);
          hud.setMoney(economy.state.money);
          hud.killfeed(`Charge planted at ${site} (+$${REWARDS.plant})`);
          audio.plantBeep(true);
        },
        onDetonated: () => endRound(true, 'Charge detonated'),
      });
      hud.setPlant(bomb.state.status === 'planting' ? bomb.state.plantProgress : 0);
      if (bomb.state.status === 'planted') {
        hud.setBomb('planted', bomb.state.timeLeft);
      }
      const defusing = bots.bots.some((bot) => bot.alive && bot.state === 'defuse' && bot.defuseProgress > 0);
      if (bomb.state.status === 'planted' && defusing) hud.setBomb('defusing', bomb.state.timeLeft);
      player.step(dt, input.keys);
      player.state.aiming = input.aiming && weapons.def().ads;
      weapons.step(dt);
      bots.step(dt, {
        time: state.time,
        playerPosition: player.state.position,
        playerAlive: player.state.alive,
        bombPlanted: bomb.state.status === 'planted',
        bombSite: bomb.state.site,
        botShoot,
        bombDefused: () => {
          bomb.defuse();
          endRound(false, 'Charge defused');
        },
      });
      stepGrenades(dt);
      hud.setAlive(player.state.alive ? 1 : 0, bots.aliveCount());
      hud.setAmmo(weapons.ammoOf(weapons.def().id).mag, weapons.ammoOf(weapons.def().id).reserve, weapons.def().name);
      hud.setGrenades(weapons.state.frags, weapons.state.flashes);
      hud.setCrosshair(4 + weapons.spread(player.groundSpeed(), player.state.aiming) * 900);
      // Automatic guns fire while held; semi-automatic ones need a fresh trigger pull.
      const wantFire = weapons.def().auto ? input.firing : input.firingEdge;
      if (wantFire && weapons.ready()) shootPlayerWeapon(weapons.spread(player.groundSpeed(), player.state.aiming), random);
      if (!player.state.alive) return;
      if (bots.aliveCount() === 0) {
        if (bomb.state.status === 'planted') endRound(true, 'Site secured — charge blows');
        else endRound(true, 'Enemy team eliminated');
        return;
      }
      if (state.roundTimer <= 0) {
        if (bomb.state.status === 'planted') {
          // The charge decides the round; the timer no longer does.
        } else if (state.overtime) endRound(false, 'Overtime expired');
        else endRound(false, 'Time expired — charge never planted');
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.roundEndTimer -= dt;
      stepGrenades(dt);
      if (state.roundEndTimer <= 0) {
        if (state.scoreUs >= ROUNDS_TO_WIN || state.scoreThem >= ROUNDS_TO_WIN) {
          endMatch();
        } else if (state.round >= MAX_ROUNDS) {
          if (state.scoreUs === state.scoreThem && !state.overtime) {
            state.overtime = true;
            state.round += 1;
            hud.showBanner('OVERTIME', 'Next round wins the match');
            startBuy();
          } else endMatch();
        } else {
          state.round += 1;
          startBuy();
        }
      }
    }
  }

  return {
    state,
    step,
    startMatch,
    startRound,
    startBuy,
    buy,
    shootPlayerWeapon,
    botShoot,
    notifyNoise,
    shopItems,
    snapshot() {
      return {
        phase: state.phase,
        round: state.round,
        scoreUs: state.scoreUs,
        scoreThem: state.scoreThem,
        roundTimer: state.roundTimer,
        money: economy.state.money,
        playerHealth: player.state.health,
        playerAlive: player.state.alive,
        botsAlive: bots.aliveCount(),
        bombStatus: bomb.state.status,
        bombSite: bomb.state.site,
        time: state.time,
      };
    },
  };
}
