// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
// ?debug=1 exposes window.__game for scripted play-tests; add &nolock=1 to run the
// simulation without pointer lock. ?selftest=1 runs the in-browser checks instead.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEconomy } from './economy.js';
import { createGame } from './game.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const debug = params.has('debug');
const noLock = params.has('nolock');
const selftest = params.has('selftest');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera, audio);
const bots = createBots(scene, world);
const bomb = createBomb(scene, world);
const economy = createEconomy(weapons);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const game = createGame({ scene, camera, world, player, weapons, bots, bomb, economy, hud, audio });

const body = player.state;
let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let fovTarget = 74;

hud.setHealth(body.health);
hud.setAmmo(weapons.ammoOf(weapons.def().id).mag, weapons.ammoOf(weapons.def().id).reserve, weapons.def().name);
hud.setMoney(economy.state.money);
hud.setScore(0, 0);
hud.setTimer(100);
hud.setAlive(1, 4);
hud.setGrenades(0, 0);

hud.onPlay(() => {
  if (shot || selftest) return;
  audio.resume();
  if (game.state.phase === 'menu' || game.state.phase === 'matchEnd') {
    game.startMatch();
    return;
  }
  if (game.state.phase === 'roundEnd') return;
  if (game.state.phase === 'round') input.requestLock();
});

function onLockChange(locked) {
  if (shot || selftest) return;
  if (locked) {
    hud.hideOverlay();
  } else if (game.state.phase === 'round') {
    hud.showOverlay('paused');
  } else if (game.state.phase === 'menu') {
    hud.showOverlay('start');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const wantFov = body.aiming && weapons.def().ads ? 46 : 74;
  fovTarget += (wantFov - fovTarget) * 0.2;
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov = fovTarget;
    camera.updateProjectionMatrix();
  }
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  elapsed += dt;
  const firingEdge = input.state.firing && !prevFiring;
  prevFiring = input.state.firing;
  const frameInput = {
    keys: input.state.keys,
    firing: input.state.firing,
    firingEdge,
    aiming: input.state.aiming,
  };
  // Single-press keys, drained once per frame.
  if (input.wasPressed('KeyR')) weapons.reload();
  if (input.wasPressed('Digit1')) weapons.switchTo('primary');
  if (input.wasPressed('Digit2')) weapons.switchTo('pistol');
  if (input.wasPressed('Digit3')) weapons.switchTo('frag');
  if (input.wasPressed('Digit4')) weapons.switchTo('flash');
  if (input.wasPressed('KeyB') && game.state.phase === 'buy') game.startRound();
  if (input.wasPressed('Enter') && game.state.phase === 'buy') game.startRound();
  const look = input.takeLook();
  player.look(look.x, look.y);
  game.step(dt, frameInput, random);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    // The round only simulates while the player holds the mouse; menus, buy phase
    // and the round-end pause run without pointer lock.
    const simLocked = noLock || input.state.locked || game.state.phase !== 'round';
    if (simLocked) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  document.getElementById('buy').hidden = true;
  bots.spawn(world.botSpawns);
  if (name === 'start') {
    body.position.set(0, 0, 14.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(30);
    aimAt(new THREE.Vector3(0, 1.5, -10));
    hud.showOverlay('start');
  } else if (name === 'play') {
    game.startMatch();
    game.startRound();
    // Freeze the defenders for the capture: the shot is about the player's aim, not a
    // firefight the setup cannot survive.
    for (const bot of bots.bots) bot.blindUntil = 1e9;
    // Walk up mid, aim at the bot holding the gantry, drop it with three shots.
    // The bot is close, so the kill and the fallen body fill the frame.
    body.position.set(0, 0, 6);
    const bot = bots.bots[2];
    bot.position.set(0, 0, -1);
    bot.model.group.position.copy(bot.position);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.0, -1));
    for (let round = 0; round < 3; round += 1) {
      game.shootPlayerWeapon(0, random);
      settle(8);
    }
    settle(20);
    aimAt(new THREE.Vector3(0, 0.5, -1));
    hud.setAlive(1, bots.aliveCount());
  } else if (name === 'plant') {
    game.startMatch();
    game.startRound();
    for (const bot of bots.bots) bot.blindUntil = 1e9;
    body.position.set(-17.5, 0, -6.5);
    settle(6);
    input.state.keys.add('KeyE');
    settle(185);
    input.state.keys.delete('KeyE');
    aimAt(new THREE.Vector3(-14, 1.2, -10));
    settle(30);
    hud.setBomb('planted', bomb.state.timeLeft);
  } else {
    game.startMatch();
    game.state.scoreUs = 5;
    game.state.scoreThem = 2;
    hud.setScore(5, 2);
    hud.showBanner('ROUND WON', 'Enemy team eliminated · +$3250', 60000);
    hud.showOverlay('match', 'Final score Vanguard 5 — 2 Rustjackals. Dock 9 is yours.');
    hud.setTimer(0);
  }
  hud.setScore(game.state.scoreUs, game.state.scoreThem);
  hud.setMoney(economy.state.money);
  hud.setAmmo(weapons.ammoOf(weapons.def().id).mag, weapons.ammoOf(weapons.def().id).reserve, weapons.def().name);
  document.getElementById('buy').hidden = true;
  paintTwiceThenReady();
}

// In-browser self-test: drives the real modules with synthetic input and reports
// every check to the console and to window.__selftest.
function runSelftest() {
  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail: detail ?? '' });
    // eslint-disable-next-line no-console
    console.log(`[selftest] ${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`);
  }
  try {
    check('world colliders', world.colliders.length >= 20, `${world.colliders.length} colliders`);
    check('world shootables', world.shootables.length >= 20, `${world.shootables.length} meshes`);
    const reachable = new Set([0]);
    const queue = [0];
    const adjacency = new Map();
    for (let i = 0; i < world.waypoints.length; i += 1) adjacency.set(i, []);
    for (const [a, b] of world.edges) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency.get(current)) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    check('waypoint graph connected', reachable.size === world.waypoints.length, `${reachable.size}/${world.waypoints.length} nodes`);
    check('sites defined', !!world.sites.A && !!world.sites.B, 'A and B');

    game.startMatch();
    game.startRound();
    // Freeze the defenders for the whole self-test: it measures the player's mechanics,
    // and live bots shooting during the long settles would kill the player at random.
    // Bot return fire is covered separately by the live play-test.
    for (const bot of bots.bots) bot.blindUntil = 1e9;
    check('round starts', game.state.phase === 'round' && bots.aliveCount() === 4, `phase=${game.state.phase} bots=${bots.aliveCount()}`);
    const startX = body.position.x;
    const startZ = body.position.z;
    input.state.keys.add('KeyW');
    settle(60);
    input.state.keys.delete('KeyW');
    const moved = Math.hypot(body.position.x - startX, body.position.z - startZ);
    check('player moves forward', moved > 2, `moved ${moved.toFixed(2)} m in 1 s`);
    input.state.keys.add('KeyA');
    settle(30);
    input.state.keys.delete('KeyA');
    check('player strafes', Math.abs(body.position.x - startX) > 0.3, `x=${body.position.x.toFixed(2)}`);

    const bot = bots.bots[0];
    bot.position.set(0, 0, -5);
    bot.model.group.position.copy(bot.position);
    aimAt(new THREE.Vector3(0, 1.0, -5));
    const healthBefore = bot.health;
    game.shootPlayerWeapon(0, random);
    settle(8);
    check('rifle hits bot', bot.health < healthBefore, `hp ${healthBefore} -> ${bot.health}`);
    aimAt(new THREE.Vector3(0, 1.45, -5));
    game.shootPlayerWeapon(0, random);
    check('headshot hurts more', bot.health <= healthBefore - 100, `hp ${bot.health}`);
    const magBefore = weapons.ammoOf('rifle').mag;
    weapons.reload();
    settle(130);
    check('reload refills', weapons.ammoOf('rifle').mag > magBefore, `mag ${magBefore} -> ${weapons.ammoOf('rifle').mag}`);

    economy.earn(5000);
    const bought = economy.buyPrimary('dmr');
    check('buy DMR', bought.ok && economy.state.ownedPrimary === 'dmr', `owned=${economy.state.ownedPrimary} money=${economy.state.money}`);
    const fragBought = economy.buyGrenade('frag');
    check('buy frag', fragBought.ok && weapons.state.frags === 1, `frags=${weapons.state.frags}`);
    weapons.switchTo('frag');
    settle(20);
    const fragCount = weapons.state.frags;
    game.shootPlayerWeapon(0, random);
    check('frag thrown', weapons.state.frags === fragCount - 1, `frags ${fragCount} -> ${weapons.state.frags}`);
    settle(100);
    check('frag exploded', game.state.grenades.length === 0, 'grenade list empty');

    body.position.set(-17.5, 0, -8);
    // Freeze the defenders for the plant: three bots at close range would kill the
    // player before the 3-second plant finishes, which tests the bots, not the plant.
    for (const bot of bots.bots) bot.blindUntil = 1e9;
    input.state.keys.add('KeyE');
    settle(200);
    input.state.keys.delete('KeyE');
    check('bomb plants at A', bomb.state.status === 'planted', `status=${bomb.state.status} site=${bomb.state.site}`);

    for (const other of bots.bots) {
      if (other.alive) bots.damage(other, 500, 'torso');
    }
    settle(5);
    check('round won when team wiped', game.state.phase === 'roundEnd' && game.state.roundEndWon, `phase=${game.state.phase} won=${game.state.roundEndWon}`);
    check('score updated', game.state.scoreUs === 1, `score ${game.state.scoreUs}-${game.state.scoreThem}`);
    settle(300);
    check('buy phase follows', game.state.phase === 'buy', `phase=${game.state.phase}`);
  } catch (error) {
    results.push({ name: 'selftest crashed', ok: false, detail: String(error && error.message ? error.message : error) });
  }
  const passed = results.filter((r) => r.ok).length;
  window.__selftest = { passed, failed: results.length - passed, results };
  document.title = `SELFTEST ${passed}/${results.length}`;
  // eslint-disable-next-line no-console
  console.log(`[selftest] ${passed}/${results.length} passed`);
  window.__shotReady = true;
  frozen = true;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (debug) {
  window.__game = { game, player, weapons, bots, bomb, economy, hud, input, world, camera, scene, audio, step, settle, aimAt };
}
if (noLock) {
  input.state.locked = true;
  input.requestLock = () => {};
}

syncCamera();
if (selftest) runSelftest();
else if (shot) runShot(shot);
else requestAnimationFrame(frame);
