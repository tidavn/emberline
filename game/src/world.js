// Dock 9: a night container yard, 44 x 34 m, built from boxes. Two bomb sites (A west,
// B east), three lanes (west crates, mid gantry, east crates) and a waypoint graph the
// bots path over. Every box is a collider for the player and a surface a bullet stops on.
// Waypoint edges were laid out against the obstacle list so no edge crosses a box.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: id -> [x, z]. Edges join neighbours along open lanes only.
const WAYPOINTS = [
  [0, 14], // 0 spawn south (player side)
  [-12, 10], // 1 west south
  [12, 10], // 2 east south
  [0, 5], // 3 mid south
  [-12, 0], // 4 west mid
  [12, 0], // 5 east mid
  [0, -3], // 6 mid north
  [-14, -7], // 7 west north
  [14, -7], // 8 east north
  [-17.5, -9], // 9 site A
  [17.5, -9], // 10 site B
  [0, -13], // 11 north mid
  [-8, -13], // 12 A approach
  [8, -13], // 13 B approach
];
const EDGES = [
  [0, 1], [0, 2], [0, 3],
  [1, 4], [2, 5],
  [3, 4], [3, 5], [3, 6],
  [4, 7], [5, 8],
  [6, 7], [6, 8], [6, 11],
  [7, 9], [8, 10],
  [9, 12], [10, 13],
  [11, 12], [11, 13],
  [7, 12], [8, 13],
  [4, 12], [5, 13],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'site' ? 0.5 : 0.92,
      metalness: name === 'steel' ? 0.35 : 0.04,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter, 5 m walls.
  box(44.4, 0.4, 34.4, 0, -0.2, 0, 'deck');
  box(0.4, 5, 34.4, -22.2, 2.5, 0, 'surface');
  box(0.4, 5, 34.4, 22.2, 2.5, 0, 'surface');
  box(44.4, 5, 0.4, 0, 2.5, -17.2, 'surface');
  box(44.4, 5, 0.4, 0, 2.5, 17.2, 'surface');

  // Containers, flanking the three lanes.
  box(6.1, 2.6, 2.4, -6, 1.3, 6, 'steel');
  box(6.1, 2.6, 2.4, 6, 1.3, 6, 'steel');
  box(2.4, 2.6, 5, -6, 1.3, -9.5, 'hairline');
  box(2.4, 2.6, 5, 6, 1.3, -9.5, 'hairline');
  box(2.4, 2.6, 6.1, -16, 1.3, 2, 'steel');
  box(2.4, 2.6, 6.1, 16, 1.3, 2, 'steel');
  box(2.4, 2.6, 4, -19, 1.3, -13, 'hairline');
  box(2.4, 2.6, 4, 19, 1.3, -13, 'hairline');
  // A second layer stacked on two of them, so the yard reads in depth.
  box(6.1, 2.6, 2.4, -6, 3.9, 6, 'surface');
  box(2.4, 2.6, 4, 19, 3.9, -13, 'surface');

  // Crates and low walls to crouch behind.
  box(1.2, 1.2, 1.2, -2, 0.6, 10, 'hairline');
  box(1.2, 1.2, 1.2, 2, 0.6, 10, 'hairline');
  box(1.2, 1.2, 1.2, -10, 0.6, -2, 'hairline');
  box(1.2, 1.2, 1.2, 10, 0.6, -2, 'hairline');
  box(1.2, 1.2, 1.2, -14, 0.6, 8, 'hairline');
  box(1.2, 1.2, 1.2, 14, 0.6, 8, 'hairline');
  box(1.2, 1.2, 1.2, -3, 0.6, -15.5, 'hairline');
  box(1.2, 1.2, 1.2, 3, 0.6, -15.5, 'hairline');
  box(2.4, 1.1, 0.6, -4, 0.55, 8, 'steel');
  box(2.4, 1.1, 0.6, 4, 0.55, 8, 'steel');
  box(0.6, 1.1, 2.4, -8, 0.55, -9, 'steel');
  box(0.6, 1.1, 2.4, 8, 0.55, -9, 'steel');

  // Crane gantry over mid: two legs and a beam, high enough to walk under.
  box(0.6, 5.4, 0.6, -4, 2.7, -2, 'steel');
  box(0.6, 5.4, 0.6, 4, 2.7, -2, 'steel');
  box(8.6, 0.8, 1.0, 0, 5.6, -2, 'rust');

  // Distant skyline silhouettes beyond the walls: pure dressing, no colliders.
  const skyline = new THREE.Group();
  scene.add(skyline);
  const skyMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#0b0e13') });
  const skyBoxes = [[-30, 6, -26, 8, 12, 4], [-8, 9, -28, 10, 18, 4], [14, 5, -27, 7, 10, 4], [30, 8, -24, 9, 16, 4], [-34, 4, 8, 6, 8, 4], [34, 7, 10, 8, 14, 4]];
  for (const [x, y, z, w, h, d] of skyBoxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skyMaterial);
    mesh.position.set(x, y, z);
    skyline.add(mesh);
  }

  // Site markers: a glowing floor ring and a floating letter, drawn on a canvas texture
  // at runtime (no image files, no network).
  function siteMarker(letter, x, z, colorName) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.6, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[colorName]), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    group.add(ring);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[colorName];
    ctx.font = 'bold 96px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    sign.position.set(x, 3.4, z);
    group.add(sign);
    return sign;
  }
  const siteSignA = siteMarker('A', -17.5, -9, 'site');
  const siteSignB = siteMarker('B', 17.5, -9, 'teal');

  // Light: cold moonlight as the key, warm amber lamps over the lanes, cool fill.
  // Bright enough that the yard reads at a glance even on a dim screen.
  const sky = new THREE.HemisphereLight(new THREE.Color('#3a4656'), new THREE.Color(PALETTE.canvas), 1.4);
  scene.add(sky);
  const moon = new THREE.DirectionalLight(new THREE.Color('#d5deeb'), 2.4);
  moon.position.set(14, 20, -8);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -26;
  moon.shadow.camera.right = 26;
  moon.shadow.camera.top = 22;
  moon.shadow.camera.bottom = -22;
  moon.shadow.camera.far = 60;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const lampA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 42, 24, 1.6);
  lampA.position.set(-10, 4.5, 8);
  scene.add(lampA);
  const lampB = new THREE.PointLight(new THREE.Color(PALETTE.accent), 42, 24, 1.6);
  lampB.position.set(10, 4.5, 8);
  scene.add(lampB);
  const lampC = new THREE.PointLight(new THREE.Color(PALETTE.teal), 28, 20, 1.6);
  lampC.position.set(0, 4.5, -12);
  scene.add(lampC);

  const sites = {
    A: { id: 'A', center: new THREE.Vector3(-17.5, 0, -9), half: new THREE.Vector3(3.5, 3, 3), sign: siteSignA },
    B: { id: 'B', center: new THREE.Vector3(17.5, 0, -9), half: new THREE.Vector3(3.5, 3, 3), sign: siteSignB },
  };

  return {
    colliders,
    shootables,
    group,
    sites,
    playerSpawn: new THREE.Vector3(0, 0, 14.5),
    botSpawns: [
      { site: 'A', position: new THREE.Vector3(-16, 0, -10.5) },
      { site: 'A', position: new THREE.Vector3(-19.5, 0, -6.5) },
      { site: 'B', position: new THREE.Vector3(16, 0, -10.5) },
      { site: 'B', position: new THREE.Vector3(19.5, 0, -6.5) },
    ],
    waypoints: WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    edges: EDGES,
  };
}
