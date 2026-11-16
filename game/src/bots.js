// The Rustjackals: four defending bots. Each one patrols its site on the waypoint
// graph, holds angles, investigates gunfire it hears, engages with aimed bursts when it
// sees the player, falls back when hurt, and rushes the planted charge to defuse it.
// Movement is a circle against the world's colliders, one axis at a time; routes come
// from a breadth-first search over the waypoint graph, so bots genuinely follow routes
// through the map instead of walking through walls.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_RADIUS = 0.35;
const BOT_HEIGHT = 1.72;
const PATROL_SPEED = 2.3;
const ENGAGE_SPEED = 3.1;
const INVESTIGATE_SPEED = 3.4;
const MAX_HEALTH = 100;
const LOS_INTERVAL = 0.12;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.11;
const DEFUSE_SECONDS = 5;

function buildBotModel(scene) {
  const rust = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.8, metalness: 0.05 });
  const visor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.3, metalness: 0.4, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.5 });
  const group = new THREE.Group();
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark, -0.11, 0.25, 0);
  add(new THREE.BoxGeometry(0.16, 0.5, 0.16), dark, 0.11, 0.25, 0);
  const torso = add(new THREE.BoxGeometry(0.55, 0.65, 0.3), rust, 0, 0.95, 0);
  const head = add(new THREE.BoxGeometry(0.3, 0.28, 0.28), dark, 0, 1.45, 0);
  add(new THREE.BoxGeometry(0.26, 0.07, 0.02), visor, 0, 1.47, -0.15);
  add(new THREE.BoxGeometry(0.08, 0.08, 0.62), dark, 0.2, 1.18, -0.2);
  add(new THREE.BoxGeometry(0.6, 0.08, 0.32), dark, 0, 1.3, 0);
  const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color('#111418'), depthWrite: false }));
  barBg.scale.set(0.62, 0.07, 1);
  barBg.position.set(0, 1.78, 0);
  group.add(barBg);
  const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: new THREE.Color('#57d977'), depthWrite: false }));
  barFg.scale.set(0.6, 0.05, 1);
  barFg.position.set(0, 1.78, 0);
  group.add(barFg);
  scene.add(group);
  return { group, torso, head, barFg };
}

export function createBots(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const probe = new THREE.Box3();
  const tmpDirection = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpHead = new THREE.Vector3();
  const adjacency = new Map();
  for (let i = 0; i < world.waypoints.length; i += 1) adjacency.set(i, []);
  for (const [a, b] of world.edges) {
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  const bots = [];
  const hitMeshes = [];

  function nearestNode(position) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < world.waypoints.length; i += 1) {
      const node = world.waypoints[i];
      const d = (node.x - position.x) ** 2 + (node.z - position.z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  }

  // Breadth-first search over the waypoint graph. Returns node ids from start to goal.
  function findPath(fromNode, toNode) {
    if (fromNode === toNode) return [fromNode];
    const cameFrom = new Map([[fromNode, -1]]);
    const queue = [fromNode];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency.get(current)) {
        if (cameFrom.has(next)) continue;
        cameFrom.set(next, current);
        if (next === toNode) {
          const path = [next];
          let node = current;
          while (node !== -1) {
            path.unshift(node);
            node = cameFrom.get(node);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [fromNode];
  }

  function overlaps(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.05, z + BOT_RADIUS);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveBot(bot, dt, targetX, targetZ, speed) {
    const dx = targetX - bot.position.x;
    const dz = targetZ - bot.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return true;
    const step = Math.min(length, speed * dt);
    const nx = bot.position.x + (dx / length) * step;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + (dz / length) * step;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    return Math.hypot(targetX - bot.position.x, targetZ - bot.position.z) < 0.5;
  }

  function hasLineOfSight(from, to) {
    tmpDirection.copy(to).sub(from);
    const distance = tmpDirection.length();
    if (distance < 0.01) return true;
    tmpDirection.normalize();
    raycaster.set(from, tmpDirection);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit;
  }

  function spawn(spawnDefs) {
    for (const bot of bots) scene.remove(bot.model.group);
    bots.length = 0;
    hitMeshes.length = 0;
    spawnDefs.forEach((def, index) => {
      const model = buildBotModel(scene);
      const bot = {
        id: index,
        name: ['RUST-1', 'RUST-2', 'RUST-3', 'RUST-4'][index] || `RUST-${index + 1}`,
        model,
        position: def.position.clone(),
        yaw: 0,
        health: MAX_HEALTH,
        alive: true,
        fall: 0,
        homeSite: def.site,
        state: 'patrol',
        path: [],
        pathIndex: 0,
        patrolRoute: def.site === 'A' ? [9, 12, 7, 12] : [10, 13, 8, 13],
        patrolIndex: index % 2 === 0 ? 0 : 2,
        holdUntil: 0,
        lastSeen: new THREE.Vector3(),
        seenAt: -100,
        reactAt: 0,
        burstLeft: 0,
        shotTimer: 0,
        pauseUntil: 0,
        strafeDir: index % 2 === 0 ? 1 : -1,
        strafeUntil: 0,
        defuseProgress: 0,
        blindUntil: 0,
        losTimer: index * 0.03,
      };
      model.torso.userData.bot = bot;
      model.torso.userData.part = 'torso';
      model.head.userData.bot = bot;
      model.head.userData.part = 'head';
      hitMeshes.push(model.torso, model.head);
      bots.push(bot);
    });
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.defuseProgress = 0;
    if (bot.health > 0) {
      // Being shot at tells the bot where the fire came from.
      bot.state = 'investigate';
      bot.path = [];
      return false;
    }
    bot.health = 0;
    bot.alive = false;
    bot.fall = 0;
    bot.defuseProgress = 0;
    return true;
  }

  function step(dt, ctx) {
    const now = ctx.time;
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.model.group.rotation.x = -bot.fall * 1.45;
        bot.model.group.position.y = -bot.fall * 0.08;
        continue;
      }
      const blinded = now < bot.blindUntil;
      // Staggered line-of-sight checks, so four bots never raycast on the same frame.
      bot.losTimer -= dt;
      if (bot.losTimer <= 0 && ctx.playerAlive && !blinded) {
        bot.losTimer = LOS_INTERVAL;
        tmpHead.set(bot.position.x, bot.position.y + 1.45, bot.position.z);
        tmpTarget.set(ctx.playerPosition.x, ctx.playerPosition.y + 1.2, ctx.playerPosition.z);
        if (hasLineOfSight(tmpHead, tmpTarget)) {
          bot.lastSeen.copy(ctx.playerPosition);
          bot.seenAt = now;
          if (bot.state !== 'engage' && bot.reactAt === 0) {
            bot.reactAt = now + 0.35 + Math.random() * 0.25;
          }
        }
      }
      if (bot.reactAt > 0 && now >= bot.reactAt && bot.state !== 'engage') {
        bot.state = 'engage';
        bot.reactAt = 0;
        bot.burstLeft = 0;
        bot.pauseUntil = 0;
      }
      // A planted charge pulls every living bot to the site to defuse it.
      if (ctx.bombPlanted && bot.state !== 'engage' && bot.state !== 'defuse') {
        bot.state = 'defuse';
        bot.path = [];
      }
      if (bot.state === 'defuse' && !ctx.bombPlanted) {
        bot.state = 'patrol';
        bot.path = [];
        bot.defuseProgress = 0;
      }

      if (blinded) {
        // A flashed bot freezes and cannot shoot.
        bot.model.group.position.copy(bot.position);
        bot.model.group.rotation.y = bot.yaw;
        continue;
      }

      if (bot.state === 'patrol') {
        const targetNode = bot.patrolRoute[bot.patrolIndex];
        const target = world.waypoints[targetNode];
        if (now < bot.holdUntil) {
          bot.yaw += dt * 0.5;
        } else if (moveBot(bot, dt, target.x, target.z, PATROL_SPEED)) {
          bot.patrolIndex = (bot.patrolIndex + 1) % bot.patrolRoute.length;
          bot.holdUntil = now + 1.5 + Math.random() * 2;
        }
      } else if (bot.state === 'investigate') {
        if (bot.path.length === 0) {
          const goal = nearestNode(bot.lastSeen);
          bot.path = findPath(nearestNode(bot.position), goal);
          bot.pathIndex = 0;
        }
        const node = world.waypoints[bot.path[bot.pathIndex]];
        if (moveBot(bot, dt, node.x, node.z, INVESTIGATE_SPEED)) {
          bot.pathIndex += 1;
          if (bot.pathIndex >= bot.path.length) {
            bot.state = 'patrol';
            bot.path = [];
            bot.holdUntil = now + 2;
          }
        }
        if (now - bot.seenAt < 1.5 && bot.state === 'investigate') {
          bot.state = 'engage';
          bot.reactAt = 0;
        }
      } else if (bot.state === 'engage') {
        const playerDistance = Math.hypot(ctx.playerPosition.x - bot.position.x, ctx.playerPosition.z - bot.position.z);
        const seenRecently = now - bot.seenAt < 2.5;
        if (!ctx.playerAlive) {
          bot.state = 'patrol';
          bot.path = [];
        } else if (!seenRecently) {
          // Lost the player: push to the last place they were seen.
          bot.state = 'investigate';
          bot.path = [];
        } else {
          // Strafe to stay a hard target, and close or open the distance.
          if (now > bot.strafeUntil) {
            bot.strafeDir *= -1;
            bot.strafeUntil = now + 0.9 + Math.random() * 0.9;
          }
          const dx = ctx.playerPosition.x - bot.position.x;
          const dz = ctx.playerPosition.z - bot.position.z;
          const length = Math.hypot(dx, dz) || 1;
          const px = -dz / length;
          const pz = dx / length;
          const approach = playerDistance > 20 ? 1 : playerDistance < 8 ? -1 : 0;
          const targetX = bot.position.x + (dx / length) * approach * ENGAGE_SPEED * dt + px * bot.strafeDir * ENGAGE_SPEED * 0.7 * dt;
          const targetZ = bot.position.z + (dz / length) * approach * ENGAGE_SPEED * dt + pz * bot.strafeDir * ENGAGE_SPEED * 0.7 * dt;
          moveBot(bot, dt, targetX, targetZ, ENGAGE_SPEED);
          bot.yaw = Math.atan2(-dx, -dz);
          // Fire in bursts with a pause between them.
          if (now >= bot.pauseUntil) {
            if (bot.burstLeft === 0) {
              bot.burstLeft = BURST_MIN + Math.floor(Math.random() * (BURST_MAX - BURST_MIN + 1));
              bot.shotTimer = 0;
            }
            bot.shotTimer -= dt;
            if (bot.shotTimer <= 0 && bot.burstLeft > 0) {
              bot.shotTimer = SHOT_GAP;
              bot.burstLeft -= 1;
              ctx.botShoot(bot);
              if (bot.burstLeft === 0) bot.pauseUntil = now + 0.55 + Math.random() * 0.45;
            }
          }
        }
        if (bot.health < 30 && bot.state === 'engage') {
          bot.state = 'patrol';
          bot.path = [];
        }
      } else if (bot.state === 'defuse') {
        const site = world.sites[ctx.bombSite];
        const distance = Math.hypot(site.center.x - bot.position.x, site.center.z - bot.position.z);
        if (distance > 1.6) {
          if (bot.path.length === 0) {
            const goal = site.id === 'A' ? 9 : 10;
            bot.path = findPath(nearestNode(bot.position), goal);
            bot.pathIndex = 0;
          }
          const node = world.waypoints[bot.path[bot.pathIndex]];
          if (moveBot(bot, dt, node.x, node.z, INVESTIGATE_SPEED)) {
            bot.pathIndex += 1;
            if (bot.pathIndex >= bot.path.length) bot.path = [];
          }
        } else {
          bot.defuseProgress += dt / DEFUSE_SECONDS;
          bot.yaw += dt * 0.2;
          if (bot.defuseProgress >= 1) ctx.bombDefused(bot);
        }
      }

      // Keep bots from stacking on each other.
      for (const other of bots) {
        if (other === bot || !other.alive) continue;
        const dx = bot.position.x - other.position.x;
        const dz = bot.position.z - other.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.01 && d2 < 0.64) {
          const d = Math.sqrt(d2);
          const push = (0.8 - d) * 0.5;
          bot.position.x += (dx / d) * push;
          bot.position.z += (dz / d) * push;
        }
      }

      bot.model.group.position.copy(bot.position);
      bot.model.group.rotation.y = bot.yaw;
      const fraction = Math.max(0, bot.health / MAX_HEALTH);
      bot.model.barFg.scale.x = 0.6 * fraction;
      bot.model.barFg.material.color.set(fraction > 0.5 ? '#57d977' : fraction > 0.25 ? '#f0a830' : '#d84a35');
    }
  }

  return {
    bots,
    hitMeshes,
    spawn,
    step,
    damage,
    nearestNode,
    aliveCount() {
      return bots.filter((bot) => bot.alive).length;
    },
    reset() {
      for (const bot of bots) {
        bot.health = MAX_HEALTH;
        bot.alive = true;
        bot.fall = 0;
        bot.state = 'patrol';
        bot.path = [];
        bot.defuseProgress = 0;
        bot.blindUntil = 0;
        bot.reactAt = 0;
        bot.burstLeft = 0;
        bot.model.group.rotation.set(0, 0, 0);
        bot.model.group.position.copy(bot.position);
        bot.model.barFg.scale.x = 0.6;
      }
    },
  };
}
