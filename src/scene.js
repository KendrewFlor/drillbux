// 3D offshore jack-up rig, ocean, and a cutaway of the subsurface.
// Uses only the vendored Three.js build (vendor/three, checksum-verified in CI).
import * as THREE from '../vendor/three/three.module.js';
import { FORMATIONS, TARGET_DEPTH } from './reservoir.js';

const SEABED_Y = -28;
const STRATA_HEIGHT = 70; // world units representing TARGET_DEPTH ft
const DECK_Y = 14;
const RIG_FLOOR_Y = DECK_Y + 2.2;

export const depthToY = (ft) => SEABED_Y - (ft / TARGET_DEPTH) * STRATA_HEIGHT;

export function createScene(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb8c4, 0.0042);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000);

  // ---------- Sky dome (vertex-colour gradient, no textures) ----------
  {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const top = new THREE.Color(0x2f6f93), mid = new THREE.Color(0xbcd3dc), low = new THREE.Color(0x0d2a33);
    const pos = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 900;
      const c = t > 0 ? mid.clone().lerp(top, Math.pow(t, 0.6)) : mid.clone().lerp(low, Math.min(1, -t * 4));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
  }

  // ---------- Lights ----------
  scene.add(new THREE.HemisphereLight(0xd6ecf5, 0x1b3a44, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(-60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 250 });
  scene.add(sun);

  // ---------- Ocean ----------
  const oceanGeo = new THREE.PlaneGeometry(600, 600, 160, 160);
  oceanGeo.rotateX(-Math.PI / 2);
  const oceanBase = Float32Array.from(oceanGeo.attributes.position.array);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x1d5f73, roughness: 0.22, metalness: 0.15, transparent: true, opacity: 0.9, flatShading: true,
  });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.receiveShadow = true;
  scene.add(ocean);

  // ---------- Seabed + strata cutaway ----------
  const subsurface = new THREE.Group();
  scene.add(subsurface);
  const seabed = new THREE.Mesh(
    new THREE.BoxGeometry(70, 1, 70),
    new THREE.MeshStandardMaterial({ color: 0x5a5440, roughness: 1 }),
  );
  seabed.position.y = SEABED_Y + 0.5;
  subsurface.add(seabed);

  let reservoirMat = null;
  for (const f of FORMATIONS) {
    const yTop = depthToY(f.top), yBase = depthToY(f.base);
    const h = yTop - yBase;
    const isRes = f.name.startsWith('Reservoir');
    const mat = new THREE.MeshStandardMaterial({
      color: f.color, roughness: 0.95, transparent: true, opacity: isRes ? 0.75 : 0.55,
      emissive: isRes ? 0x7a3d00 : 0x000000, emissiveIntensity: isRes ? 0.9 : 0,
    });
    if (isRes) reservoirMat = mat;
    const m = new THREE.Mesh(new THREE.BoxGeometry(70, h, 70), mat);
    m.position.y = yBase + h / 2;
    subsurface.add(m);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(m.geometry),
      new THREE.LineBasicMaterial({ color: 0x0d2a33, transparent: true, opacity: 0.35 }),
    );
    edges.position.copy(m.position);
    subsurface.add(edges);
  }
  subsurface.visible = false;

  // ---------- Rig ----------
  const rig = new THREE.Group();
  scene.add(rig);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa7ad, roughness: 0.55, metalness: 0.7 });
  const hiVis = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6, metalness: 0.2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.6, metalness: 0.1 });
  const derrickMat = new THREE.MeshStandardMaterial({ color: 0xe8e3d0, roughness: 0.5, metalness: 0.6 });
  const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // Hull
  const hull = cast(new THREE.Mesh(new THREE.BoxGeometry(26, 4, 22), hiVis));
  hull.position.y = DECK_Y - 2;
  rig.add(hull);
  const deck = cast(new THREE.Mesh(new THREE.BoxGeometry(26.4, 0.4, 22.4), steel));
  deck.position.y = DECK_Y + 0.2;
  rig.add(deck);

  // Three lattice legs down to seabed (triangular jack-up)
  const legPositions = [[-10, -8], [10, -8], [0, 9.5]];
  for (const [x, z] of legPositions) {
    const legH = DECK_Y + 30 - SEABED_Y;
    const leg = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, legH, 3, 24, true), new THREE.MeshStandardMaterial({ color: 0xffd23f, wireframe: true })));
    leg.position.set(x, SEABED_Y + legH / 2, z);
    rig.add(leg);
    const core = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, legH, 6), steel));
    core.position.copy(leg.position);
    rig.add(core);
    const can = cast(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1.2, 12), yellow));
    can.position.set(x, SEABED_Y + 0.6, z);
    rig.add(can);
  }

  // Derrick: tapered lattice tower built from struts
  const derrick = new THREE.Group();
  derrick.position.set(-3, RIG_FLOOR_Y, -2);
  rig.add(derrick);
  const strut = (a, b, r = 0.12) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = cast(new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 5), derrickMat));
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    derrick.add(m);
  };
  const H = 26, base = 3.2, topW = 0.9, levels = 9;
  const corner = (lvl, sx, sz) => {
    const t = lvl / levels, w = base + (topW - base) * t;
    return new THREE.Vector3(sx * w, t * H, sz * w);
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let l = 0; l < levels; l++) {
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = corners[c], [nx, nz] = corners[(c + 1) % 4];
      strut(corner(l, sx, sz), corner(l + 1, sx, sz), 0.18);
      strut(corner(l + 1, sx, sz), corner(l + 1, nx, nz), 0.08);
      strut(corner(l, sx, sz), corner(l + 1, nx, nz), 0.06); // diagonal bracing
    }
  }
  const crown = cast(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 2.6), hiVis));
  crown.position.y = H + 0.5;
  derrick.add(crown);
  const substructure = cast(new THREE.Mesh(new THREE.BoxGeometry(8, 2, 8), steel));
  substructure.position.set(-3, DECK_Y + 1.2, -2);
  rig.add(substructure);

  // Travelling block + top drive
  const block = cast(new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.0), yellow));
  derrick.add(block);

  // Drill string: rig floor → current depth
  const stringMat = new THREE.MeshStandardMaterial({ color: 0x3c4a50, metalness: 0.8, roughness: 0.35 });
  const drillString = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1, 8), stringMat);
  drillString.position.set(-3, 0, -2);
  rig.add(drillString);
  const bitMesh = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0xffb000, metalness: 0.9, roughness: 0.2, emissive: 0x331a00 }));
  bitMesh.rotation.x = Math.PI;
  rig.add(bitMesh);

  // Living quarters with lit windows
  const lq = cast(new THREE.Mesh(new THREE.BoxGeometry(9, 6, 7), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 })));
  lq.position.set(7.5, DECK_Y + 3.4, 5);
  rig.add(lq);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0xffd9a0, emissiveIntensity: 0.6 });
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), windowMat);
    w.position.set(3.4 + col * 1.9, DECK_Y + 1.6 + row * 1.7, 8.55);
    rig.add(w);
  }

  // Helipad (painted with a canvas texture — generated locally, no image files)
  const padTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#2d4a3a'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffd23f'; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f5f5f0'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const helipad = cast(new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.4, 40), [steel, new THREE.MeshStandardMaterial({ map: padTex }), steel]));
  helipad.position.set(7.5, DECK_Y + 6.6, 5);
  rig.add(helipad);

  // Flare boom + flame
  const boom = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 18, 6), steel));
  boom.position.set(-17, DECK_Y + 6, 6);
  boom.rotation.z = Math.PI / 3.2;
  rig.add(boom);
  const flareTip = new THREE.Vector3(-24.5, DECK_Y + 11, 6);
  const flameLight = new THREE.PointLight(0xff7a1a, 0, 60, 1.6);
  flameLight.position.copy(flareTip);
  rig.add(flameLight);
  const FLAME_N = 220;
  const flameGeo = new THREE.BufferGeometry();
  const flamePos = new Float32Array(FLAME_N * 3);
  const flameLife = new Float32Array(FLAME_N);
  flameGeo.setAttribute('position', new THREE.BufferAttribute(flamePos, 3));
  const flameMat = new THREE.PointsMaterial({ color: 0xff8a2a, size: 1.4, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Points(flameGeo, flameMat);
  rig.add(flame);
  for (let i = 0; i < FLAME_N; i++) flameLife[i] = Math.random();

  // Supply vessel circling
  const boat = new THREE.Group();
  const bHull = cast(new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, 3.2), new THREE.MeshStandardMaterial({ color: 0x1f6fb2 })));
  const bBridge = cast(new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.6), new THREE.MeshStandardMaterial({ color: 0xf2f2ee })));
  bBridge.position.set(3, 1.8, 0);
  boat.add(bHull, bBridge);
  scene.add(boat);

  // ---------- Loot crate (the one big orchestrated moment) ----------
  const crate = new THREE.Group();
  const crateBox = cast(new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), new THREE.MeshStandardMaterial({ color: 0x3a2a12, metalness: 0.4, roughness: 0.5, emissive: 0x000000 })));
  const crateEdges = new THREE.LineSegments(new THREE.EdgesGeometry(crateBox.geometry), new THREE.LineBasicMaterial({ color: 0xffd23f }));
  crate.add(crateBox, crateEdges);
  crate.visible = false;
  rig.add(crate);
  const burstLight = new THREE.PointLight(0xffffff, 0, 40, 1.5);
  rig.add(burstLight);
  const BURST_N = 400;
  const burstGeo = new THREE.BufferGeometry();
  const burstPos = new Float32Array(BURST_N * 3);
  const burstVel = new Float32Array(BURST_N * 3);
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
  const burstMat = new THREE.PointsMaterial({ size: 0.5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const burst = new THREE.Points(burstGeo, burstMat);
  rig.add(burst);
  let crateAnim = null;

  // ---------- Camera orbit (hand-rolled: no extra vendored addons) ----------
  const orbit = { theta: 0.8, phi: 1.2, radius: 115, target: new THREE.Vector3(0, 14, 0), auto: !reducedMotion, idleT: 0 };
  const pointers = new Map();
  let pinchDist = 0;
  canvas.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); orbit.idleT = 0; });
  canvas.addEventListener('pointerup', (e) => { pointers.delete(e.pointerId); pinchDist = 0; });
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinchDist = 0; });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    orbit.idleT = 0;
    if (pointers.size === 1) {
      orbit.theta -= (e.clientX - prev.x) * 0.005;
      orbit.phi = THREE.MathUtils.clamp(orbit.phi - (e.clientY - prev.y) * 0.005, 0.25, 2.6);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist) orbit.radius = THREE.MathUtils.clamp(orbit.radius * (pinchDist / d), 30, 220);
      pinchDist = d;
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.radius = THREE.MathUtils.clamp(orbit.radius * (1 + Math.sign(e.deltaY) * 0.08), 30, 220);
    orbit.idleT = 0;
  }, { passive: false });

  // ---------- State setters ----------
  const state = { depth: 0, drilling: false, xray: false, producing: 0, wave: reducedMotion ? 0.35 : 1 };

  function setDepth(ft) {
    state.depth = ft;
    const yTop = RIG_FLOOR_Y, yBit = depthToY(ft) ;
    const bitY = Math.min(SEABED_Y + 1, yBit);
    const len = yTop - bitY;
    drillString.scale.y = len;
    drillString.position.y = bitY + len / 2;
    bitMesh.position.set(-3, bitY - 0.4, -2);
  }

  function setXray(on) {
    state.xray = on;
    subsurface.visible = on;
    oceanMat.opacity = on ? 0.28 : 0.9;
    scene.fog.density = on ? 0.0018 : 0.0042;
    seabed.material.transparent = on;
    seabed.material.opacity = on ? 0.35 : 1;
    orbit.target.y = on ? -52 : 14;
    orbit.phi = on ? 1.42 : 1.2;
    orbit.radius = on ? 175 : 115;
    orbit.idleT = 0;
  }

  function setReservoirFill(frac) {
    if (!reservoirMat) return;
    reservoirMat.emissiveIntensity = 0.15 + 1.1 * THREE.MathUtils.clamp(frac, 0, 1);
  }

  function setDerrickColor(hex) {
    derrickMat.color.setHex(hex ?? 0xe8e3d0);
    derrickMat.emissive.setHex(hex && hex !== 0xd8e3ea ? hex : 0x000000);
    derrickMat.emissiveIntensity = hex ? 0.5 : 0;
    derrickMat.metalness = hex === 0xd8e3ea ? 1 : 0.6;
    derrickMat.roughness = hex === 0xd8e3ea ? 0.08 : 0.5;
  }

  function setFlareColor(hex) {
    flameMat.color.setHex(hex ?? 0xff8a2a);
    flameLight.color.setHex(hex ?? 0xff7a1a);
  }

  function playCrate(colorHex, { fast = false } = {}) {
    return new Promise((resolve) => {
      crate.visible = true;
      crate.position.set(helipad.position.x, helipad.position.y + 30, helipad.position.z);
      crateBox.material.emissive.setHex(0x000000);
      crateEdges.material.color.setHex(0xffd23f);
      crateAnim = { t: 0, color: new THREE.Color(colorHex), dur: fast || reducedMotion ? 1.2 : 3.4, resolve, burst: false };
      orbit.idleT = 0;
    });
  }

  // ---------- Frame loop ----------
  const timer = new THREE.Timer();
  timer.connect?.(document);
  let raf = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.fov = camera.aspect < 0.8 ? 64 : 48;
      camera.updateProjectionMatrix();
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.25);
    const t = timer.getElapsed();
    resize();

    // Ocean waves (sum of sines)
    const p = oceanGeo.attributes.position.array;
    const A = state.wave;
    for (let i = 0; i < p.length; i += 3) {
      const x = oceanBase[i], z = oceanBase[i + 2];
      p[i + 1] = A * (0.6 * Math.sin(x * 0.05 + t * 0.9) + 0.35 * Math.sin(z * 0.08 + t * 1.3) + 0.2 * Math.sin((x + z) * 0.12 + t * 1.9));
    }
    oceanGeo.attributes.position.needsUpdate = true;
    oceanGeo.computeVertexNormals();

    // Drilling: rotate string, bob the travelling block
    if (state.drilling) {
      drillString.rotation.y += dt * 9;
      bitMesh.rotation.y += dt * 9;
    }
    block.position.y = 6 + (state.drilling ? (Math.sin(t * 0.7) * 0.5 + 0.5) * 16 : 18);

    // Flare intensity tracks production
    const flareOn = state.producing > 0;
    flameLight.intensity = flareOn ? 40 + Math.sin(t * 23) * 8 + Math.random() * 6 : 0;
    flame.visible = flareOn;
    if (flareOn) {
      for (let i = 0; i < FLAME_N; i++) {
        flameLife[i] += dt * (1.2 + (i % 7) * 0.15);
        if (flameLife[i] > 1) flameLife[i] -= 1;
        const l = flameLife[i];
        flamePos[i * 3] = flareTip.x - l * 2.2 + Math.sin(i * 12.9 + t * 7) * l * 1.2;
        flamePos[i * 3 + 1] = flareTip.y + l * 6;
        flamePos[i * 3 + 2] = flareTip.z + Math.cos(i * 7.3 + t * 6) * l * 1.2;
      }
      flameGeo.attributes.position.needsUpdate = true;
    }

    // Boat orbit
    const bt = t * 0.06;
    boat.position.set(Math.cos(bt) * 60, A * 0.6 * Math.sin(t * 0.9), Math.sin(bt) * 60);
    boat.rotation.y = -bt;

    // Crate animation: drop → spin & glow → burst
    if (crateAnim) {
      crateAnim.t += dt;
      const k = crateAnim.t / crateAnim.dur;
      const padTop = helipad.position.y + 1.5;
      if (k < 0.3) {
        const d = k / 0.3;
        crate.position.y = padTop + 30 * (1 - d * d);
      } else if (k < 0.85) {
        const d = (k - 0.3) / 0.55;
        crate.position.y = padTop + Math.sin(d * Math.PI) * 2.5;
        crate.rotation.y += dt * (4 + d * 22);
        crateBox.material.emissive.copy(crateAnim.color).multiplyScalar(d);
        crateEdges.material.color.copy(crateAnim.color);
      } else if (!crateAnim.burst) {
        crateAnim.burst = true;
        crate.visible = false;
        burstMat.color.copy(crateAnim.color);
        burstMat.opacity = 1;
        burstLight.color.copy(crateAnim.color);
        burstLight.position.copy(crate.position);
        burstLight.intensity = 120;
        for (let i = 0; i < BURST_N; i++) {
          burstPos[i * 3] = crate.position.x; burstPos[i * 3 + 1] = crate.position.y; burstPos[i * 3 + 2] = crate.position.z;
          const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = 6 + Math.random() * 14;
          const r = Math.sqrt(1 - u * u);
          burstVel[i * 3] = r * Math.cos(th) * s; burstVel[i * 3 + 1] = Math.abs(u) * s + 4; burstVel[i * 3 + 2] = r * Math.sin(th) * s;
        }
      }
      if (crateAnim.burst) {
        for (let i = 0; i < BURST_N; i++) {
          burstVel[i * 3 + 1] -= 18 * dt;
          burstPos[i * 3] += burstVel[i * 3] * dt; burstPos[i * 3 + 1] += burstVel[i * 3 + 1] * dt; burstPos[i * 3 + 2] += burstVel[i * 3 + 2] * dt;
        }
        burstGeo.attributes.position.needsUpdate = true;
        burstMat.opacity = Math.max(0, burstMat.opacity - dt * 0.9);
        burstLight.intensity = Math.max(0, burstLight.intensity - dt * 150);
        if (burstMat.opacity <= 0) {
          const done = crateAnim.resolve;
          crateAnim = null;
          done();
        }
      }
    }

    // Camera
    orbit.idleT += dt;
    if (orbit.auto && orbit.idleT > 4) orbit.theta += dt * 0.04;
    const sp = new THREE.Vector3().setFromSphericalCoords(orbit.radius, orbit.phi, orbit.theta);
    camera.position.copy(orbit.target).add(sp);
    camera.lookAt(orbit.target);

    renderer.render(scene, camera);
  }

  setDepth(0);
  frame();

  return {
    setDepth,
    setDrilling: (on) => { state.drilling = on; },
    setProducing: (rate) => { state.producing = rate; },
    setXray,
    setReservoirFill,
    setDerrickColor,
    setFlareColor,
    playCrate,
    dispose: () => { cancelAnimationFrame(raf); renderer.dispose(); },
  };
}
