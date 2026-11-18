// Procedural 450cc motocross bike + rider (facing -Z, origin on the ground under the middle of the wheelbase).
import * as THREE from 'three';
import { patchStandard } from './shaderlib.js';

export const WR = 0.43;                      // wheel outer radius (m)
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function std(o, key) { const m = new THREE.MeshStandardMaterial(o); return patchStandard(m, { key: key || 'vy-bike', dyn: false, sunVis: '1.0' }); }
function phys(o, key) { const m = new THREE.MeshPhysicalMaterial(o); return patchStandard(m, { key: key || 'vy-bikeP', dyn: false, sunVis: '1.0' }); }

// roughed-up mud/dust overlay shared by all hard parts
function grime() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { const a = Math.random() * 0.10; g.fillStyle = `rgba(70,45,25,${a})`; const r = Math.random() * 6 + 1; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, 7); g.fill(); }
  }, true);
}

function tube(points, r, mat, seg = 24, rs = 8, closed = false) {
  const c = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.4);
  const m = new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, rs, closed), mat); m.castShadow = false; return m;
}
function cyl(r0, r1, len, mat, seg = 16) { return new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg), mat); }
function between(a, b, r, mat, seg = 12) {
  const d = b.clone().sub(a), len = d.length(), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); return m;
}
function capsuleBetween(a, b, r, mat) {
  const d = b.clone().sub(a), len = d.length(), m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 14), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); return m;
}
function shapeExtrude(shape, depth, bevel, mat) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -depth / 2); return new THREE.Mesh(g, mat);
}

function makeWheel(front, M) {
  const g = new THREE.Group();
  const tireR = 0.062, major = WR - tireR;
  const tire = new THREE.Mesh(new THREE.TorusGeometry(major, tireR, 14, 56), M.rubber); tire.rotation.y = Math.PI / 2; g.add(tire);
  // knobs
  const knob = new THREE.BoxGeometry(front ? 0.05 : 0.07, 0.018, 0.026), N = 34;
  const knobs = new THREE.InstancedMesh(knob, M.rubber, N * 3), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let i = 0; i < N; i++) for (let row = -1; row <= 1; row++) {
    const a = (i + (row ? 0.5 : 0)) / N * Math.PI * 2, r = WR - 0.005;
    p.set(row * 0.038 * (front ? 1 : 1.2), Math.sin(a) * r, Math.cos(a) * r);
    e.set(-a + Math.PI / 2 + Math.PI / 2, 0, row * 0.45 * (row ? 1 : 0)); e.set(a, 0, 0); q.setFromEuler(e); q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0));
    m.compose(p, q, s); knobs.setMatrixAt(k++, m);
  }
  g.add(knobs);
  // rim + hub + spokes
  const rim = new THREE.Mesh(new THREE.TorusGeometry(major - tireR + 0.012, 0.014, 8, 48), M.rim); rim.rotation.y = Math.PI / 2; g.add(rim);
  const hub = cyl(0.045, 0.045, 0.12, M.hub, 20); hub.rotation.z = Math.PI / 2; g.add(hub);
  const disc = cyl(0.14, 0.14, 0.006, M.steel, 36); disc.rotation.z = Math.PI / 2; disc.position.x = front ? -0.05 : 0.055; g.add(disc);
  const sp = new THREE.CylinderGeometry(0.0035, 0.0035, major - tireR - 0.04 + 0.08, 4);
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2, side = i % 2 ? 1 : -1, s1 = new THREE.Mesh(sp, M.steel);
    s1.position.set(side * 0.022, Math.sin(a) * 0.17, Math.cos(a) * 0.17); s1.rotation.set(-a + 0, 0, side * 0.09); s1.rotation.x = a; g.add(s1);
  }
  return g;
}

export function makeBike(C) {
  const M = {};
  const gr = grime();
  M.plastic = phys({ color: C.body, roughness: 0.38, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.28, map: gr }, 'vy-pl');
  M.plastic2 = phys({ color: C.dark, roughness: 0.4, metalness: 0, clearcoat: 0.5, map: gr }, 'vy-pl2');
  M.white = phys({ color: 0xe8e8e4, roughness: 0.45, clearcoat: 0.4, map: gr }, 'vy-wh');
  M.black = std({ color: 0x0d0e10, roughness: 0.55, metalness: 0.2, map: gr }, 'vy-bk');
  M.seat = std({ color: 0x15171a, roughness: 0.85, metalness: 0, map: gr }, 'vy-seat');
  M.steel = std({ color: 0xa8acb0, roughness: 0.38, metalness: 1, map: gr }, 'vy-steel');
  M.frame = std({ color: 0x8f9499, roughness: 0.42, metalness: 0.95, map: gr }, 'vy-frame');
  M.gold = std({ color: 0xb98a2a, roughness: 0.25, metalness: 1, map: gr }, 'vy-gold');
  M.rim = std({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.9 }, 'vy-rim');
  M.hub = std({ color: 0x777b80, roughness: 0.3, metalness: 1 }, 'vy-hub');
  M.rubber = std({ color: 0x17140f, roughness: 0.95, metalness: 0, map: gr }, 'vy-rub');
  M.exh = std({ color: 0xc4c6c8, roughness: 0.3, metalness: 1 }, 'vy-exh');
  M.exhEnd = std({ color: 0x2a2a2d, roughness: 0.5, metalness: 0.8 }, 'vy-exe');
  M.engine = std({ color: 0x6d7276, roughness: 0.48, metalness: 0.9, map: gr }, 'vy-eng');

  const bike = new THREE.Group(), steer = new THREE.Group(), rider = new THREE.Group(), body = new THREE.Group();
  bike.add(body); body.add(steer);

  // geometry anchor points (x right, y up, z back; forward is -Z)
  const WB = 0.74;                                           // half wheelbase
  const frontAxle = V(0, WR, -WB - 0.04), rearAxle = V(0, WR, WB + 0.06);
  const head = V(0, 0.98, -0.40), headLow = V(0, 0.86, -0.46);
  const pivot = V(0, 0.46, 0.22);

  // wheels
  const wheelF = makeWheel(true, M), wheelR = makeWheel(false, M);
  const fork = new THREE.Group();                            // rotates with steering (about the head tube axis)
  fork.position.copy(head); steer.add(fork);
  const axisDir = frontAxle.clone().sub(head).normalize(); // fork axis direction
  const q0 = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), axisDir);
  steer.userData.axis = axisDir;
  const forkLen = frontAxle.clone().sub(head).length();
  // fork legs
  for (const sx of [-0.1, 0.1]) {
    const top = V(sx, 0.18, 0.0), mid = V(sx * 1.02, 0, 0).add(axisDir.clone().multiplyScalar(forkLen * 0.45)), bot = axisDir.clone().multiplyScalar(forkLen).add(V(sx, 0, 0));
    const upper = between(top.clone().add(axisDir.clone().multiplyScalar(-0.02)), mid, 0.027, M.black, 14); fork.add(upper);
    const lower = between(mid.clone().add(axisDir.clone().multiplyScalar(-0.05)), bot, 0.032, M.gold, 14); fork.add(lower);
    const ring = between(mid.clone().addScaledVector(axisDir, -0.06), mid.clone().addScaledVector(axisDir, -0.02), 0.036, M.black, 14); fork.add(ring);
  }
  const clampTop = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.04, 0.08), M.black); clampTop.position.set(0, 0.09, 0); fork.add(clampTop);
  const clampBot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.08), M.black); clampBot.position.set(0, -0.06, 0.0); fork.add(clampBot);
  wheelF.position.copy(axisDir.clone().multiplyScalar(forkLen)); fork.add(wheelF);
  // front fender: swept arc over the wheel
  {
    const R0 = WR + 0.05, W0 = 0.075, A0 = -0.55, A1 = 1.25, NA = 22, NX = 6, pos = [], idx = [];
    for (let i = 0; i <= NA; i++) {
      const a = A0 + (A1 - A0) * i / NA, flare = 1 + 0.35 * Math.max(0, a - 0.5);
      for (let j = 0; j <= NX; j++) {
        const x = (j / NX * 2 - 1) * W0 * flare, drop = x * x * 4.5;
        pos.push(x, Math.cos(a) * (R0 - drop * 0.4) - drop * 0.2, -Math.sin(a) * (R0 - drop * 0.4));
      }
    }
    for (let i = 0; i < NA; i++) for (let j = 0; j < NX; j++) { const a = i * (NX + 1) + j, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mat = M.plastic.clone(); mat.side = THREE.DoubleSide; patchStandard(mat, { key: 'vy-pl', dyn: false, sunVis: '1.0' });
    const fd = new THREE.Mesh(g, mat); fd.position.copy(wheelF.position); fork.add(fd);
    for (const sx of [-1, 1]) { const st = between(V(sx * 0.07, 0.02, 0), V(sx * 0.06, 0.20, 0.03), 0.008, M.black, 6); st.position.add(wheelF.position).add(V(0, 0.18, 0.03)); }
  }
  // number plate (front)
  {
    const t = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 190px Arial Black,Impact,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(C.num, w / 2, h / 2 + 12); });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), std({ map: t, roughness: 0.5, metalness: 0, side: THREE.DoubleSide }, 'vy-plate'));
    plate.position.set(0, 0.22, -0.065); plate.rotation.set(0.05, Math.PI, 0); fork.add(plate);
    const tw = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.27, 0.012), M.white); tw.position.copy(plate.position).add(V(0, 0, 0.007)); fork.add(tw);
  }
  // handlebar
  {
    const bar = tube([V(-0.40, 0.08, 0.06), V(-0.28, 0.115, 0.03), V(-0.12, 0.10, 0.02), V(0.12, 0.10, 0.02), V(0.28, 0.115, 0.03), V(0.40, 0.08, 0.06)], 0.0125, M.black, 30, 8);
    bar.position.y += 0.0; fork.add(bar);
    for (const sx of [-1, 1]) {
      const grip = cyl(0.019, 0.019, 0.12, M.rubber, 12); grip.rotation.z = Math.PI / 2; grip.position.set(sx * 0.38, 0.082, 0.06); fork.add(grip);
      const lever = between(V(sx * 0.32, 0.085, 0.01), V(sx * 0.27, 0.07, -0.17), 0.006, M.black, 6); fork.add(lever);
      const guard = between(V(sx * 0.40, 0.11, 0.0), V(sx * 0.36, 0.08, -0.15), 0.011, M.plastic2, 8); fork.add(guard);
    }
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), M.black); riser.position.set(-0.11, 0.07, 0.03); fork.add(riser); const r2 = riser.clone(); r2.position.x = 0.11; fork.add(r2);
  }
  // headlight-less front mask shroud (the "number plate" area is covered above)

  // frame: twin spars + downtubes
  for (const sx of [-1, 1]) {
    const spar = tube([V(sx * 0.07, 0.99, -0.38), V(sx * 0.11, 0.93, -0.12), V(sx * 0.13, 0.84, 0.10), V(sx * 0.12, 0.62, 0.20), V(sx * 0.11, 0.48, 0.24)], 0.024, M.frame, 24, 10); body.add(spar);
    const down = tube([V(sx * 0.06, 0.90, -0.44), V(sx * 0.10, 0.60, -0.36), V(sx * 0.12, 0.36, -0.20), V(sx * 0.12, 0.32, 0.05), V(sx * 0.11, 0.44, 0.22)], 0.019, M.frame, 24, 8); body.add(down);
    const sub = tube([V(sx * 0.12, 0.80, 0.10), V(sx * 0.10, 0.80, 0.36), V(sx * 0.09, 0.78, 0.60)], 0.016, M.frame, 12, 8); body.add(sub);
    const sub2 = tube([V(sx * 0.11, 0.50, 0.23), V(sx * 0.10, 0.60, 0.40), V(sx * 0.09, 0.77, 0.58)], 0.014, M.frame, 12, 8); body.add(sub2);
  }
  const headTube = cyl(0.042, 0.042, 0.17, M.frame, 16); headTube.position.copy(head).add(V(0, -0.04, -0.03)); headTube.rotation.x = -0.50; body.add(headTube);
  // engine
  {
    const crank = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.27, 0.33), M.engine); crank.position.set(0, 0.36, 0.0); body.add(crank);
    const cases = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.215, 24), M.engine); cases.rotation.z = Math.PI / 2; cases.position.set(0, 0.30, 0.05); body.add(cases);
    for (const sx of [-1, 1]) { const cov = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.02, 24), M.steel); cov.rotation.z = Math.PI / 2; cov.position.set(sx * 0.115, 0.30, 0.05); body.add(cov); }
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.20, 20), M.black); cylinder.position.set(0, 0.64, -0.10); cylinder.rotation.x = 0.32; body.add(cylinder);
    for (let i = 0; i < 5; i++) { const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.108, 0.007, 20), M.engine); fin.position.set(0, 0.60 + i * 0.032, -0.11 + i * 0.012); fin.rotation.x = 0.32; body.add(fin); }
    const headE = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.17), M.engine); headE.position.set(0, 0.77, -0.145); headE.rotation.x = 0.32; body.add(headE);
  }
  // swingarm + rear wheel + shock
  const swing = new THREE.Group(); swing.position.copy(pivot); body.add(swing);
  for (const sx of [-1, 1]) {
    const arm = tube([V(sx * 0.09, 0, 0), V(sx * 0.11, -0.02, 0.28), V(sx * 0.11, -0.03, 0.56), rearAxle.clone().sub(pivot).add(V(sx * 0.07, 0, 0))], 0.02, M.steel, 14, 8); swing.add(arm);
  }
  swing.userData.axle = rearAxle.clone().sub(pivot);
  wheelR.position.copy(rearAxle).sub(pivot); swing.add(wheelR);
  const sprocket = cyl(0.085, 0.085, 0.012, M.steel, 28); sprocket.rotation.z = Math.PI / 2; sprocket.position.copy(wheelR.position).add(V(0.075, 0, 0)); swing.add(sprocket);
  // chain (loop between countershaft and sprocket)
  swing.add(tube([V(0.088, 0.06, -0.22), V(0.088, 0.075, 0.20), V(0.088, 0.09, 0.56), V(0.088, -0.09, 0.56), V(0.088, -0.12, 0.2), V(0.088, -0.10, -0.22)], 0.007, M.black, 24, 6, true));
  // rear shock
  const shock = between(V(0, 0.80, 0.26), V(0, 0.46, 0.38), 0.032, M.gold, 12); body.add(shock);
  const spring = between(V(0, 0.76, 0.27), V(0, 0.52, 0.365), 0.04, M.plastic2, 12); body.add(spring);
  // exhaust
  {
    const header = tube([V(-0.08, 0.72, -0.20), V(-0.17, 0.68, -0.26), V(-0.19, 0.44, -0.18), V(-0.18, 0.40, 0.10), V(-0.17, 0.50, 0.34)], 0.022, M.exh, 30, 10); body.add(header);
    const can = cyl(0.045, 0.045, 0.42, M.exh, 18); can.position.set(-0.17, 0.58, 0.45); can.rotation.x = Math.PI / 2 - 0.30; body.add(can);
    const tip = cyl(0.037, 0.037, 0.03, M.exhEnd, 14); tip.position.set(-0.17, 0.64, 0.66); tip.rotation.x = Math.PI / 2 - 0.30; body.add(tip);
  }
  // radiator shrouds + tank cover + seat + rear fender
  {
    for (const sx of [-1, 1]) {
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.30, 0.02); s.lineTo(0.42, 0.18); s.lineTo(0.20, 0.34); s.lineTo(-0.10, 0.30); s.lineTo(-0.16, 0.12); s.closePath();
      const sh = shapeExtrude(s, 0.05, 0.012, M.plastic); sh.rotation.y = Math.PI / 2; sh.position.set(sx * 0.155, 0.74, -0.30); sh.scale.set(sx, 0.72, 0.9); body.add(sh);
    }
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.22, 8, 18), M.plastic); tank.rotation.x = Math.PI / 2; tank.scale.set(1, 1, 0.62); tank.position.set(0, 0.97, -0.20); tank.scale.set(1.0, 1.0, 0.7); body.add(tank);
    const capT = cyl(0.03, 0.03, 0.02, M.black, 14); capT.position.set(0, 1.04, -0.12); body.add(capT);
    // seat
    const seatS = new THREE.Shape(); seatS.moveTo(-0.5, 0); seatS.lineTo(0.55, 0.01); seatS.quadraticCurveTo(0.7, 0.05, 0.60, 0.11); seatS.lineTo(0.15, 0.075); seatS.lineTo(-0.12, 0.09); seatS.quadraticCurveTo(-0.3, 0.12, -0.5, 0.06); seatS.closePath();
    const seat = shapeExtrude(seatS, 0.20, 0.025, M.seat); seat.rotation.y = Math.PI / 2; seat.position.set(0, 0.95, 0.25); body.add(seat);
    // rear fender + plastics
    const rf = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.014, 0.42), M.plastic2); rf.position.set(0, 0.90, 0.72); rf.rotation.x = 0.28; body.add(rf);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.60), M.plastic); rb.position.set(0, 0.88, 0.40); rb.rotation.x = 0.06; body.add(rb);
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.17, 0.44), M.white); sp.position.set(sx * 0.145, 0.88, 0.42); sp.rotation.x = 0.08; body.add(sp);
    }
    // side number boards
    for (const sx of [-1, 1]) {
      const t = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 96px Arial Black,Impact,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(C.num, w / 2, h / 2 + 6); });
      const nb = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), std({ map: t, roughness: 0.5, metalness: 0 }, 'vy-nb')); nb.position.set(sx * 0.155, 0.86, 0.43); nb.rotation.y = sx * Math.PI / 2; body.add(nb);
    }
  }
  // foot pegs
  for (const sx of [-1, 1]) { const peg = cyl(0.011, 0.011, 0.10, M.steel, 8); peg.rotation.z = Math.PI / 2; peg.position.set(sx * 0.19, 0.31, 0.06); body.add(peg); }
  const brake = between(V(0.19, 0.30, 0.0), V(0.20, 0.30, 0.20), 0.008, M.steel, 6); body.add(brake);

  // ------------------------------------------------------------------ rider
  const R = {};
  const jersey = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#' + new THREE.Color(C.body).getHexString(); g.fillRect(0, 0, w, h);
    g.fillStyle = '#' + new THREE.Color(C.gear).getHexString(); g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.42, 0); g.lineTo(w * 0.22, h); g.lineTo(0, h); g.fill();
    g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(w * 0.46, 0, 12, h); g.fillRect(w * 0.54, 0, 5, h);
    g.fillStyle = '#fff'; g.font = 'bold 120px Arial Black,Impact,sans-serif'; g.textAlign = 'center'; g.fillText(C.num, w * 0.78, h * 0.62);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(60,40,20,${Math.random() * 0.12})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, Math.random() * 7 + 1, 0, 7); g.fill(); }
  });
  R.jersey = std({ map: jersey, roughness: 0.78, metalness: 0 }, 'vy-jersey');
  R.pants = std({ color: C.gear, roughness: 0.7, metalness: 0, map: gr }, 'vy-pants');
  R.boot = std({ color: 0xe9e6df, roughness: 0.5, metalness: 0.05, map: gr }, 'vy-boot');
  R.glove = std({ color: 0x1b1d22, roughness: 0.7, metalness: 0 }, 'vy-glove');
  const helmTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#f2f2f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#' + new THREE.Color(C.body).getHexString(); g.fillRect(w * 0.22, 0, w * 0.10, h); g.fillRect(w * 0.72, 0, w * 0.10, h); g.fillStyle = '#' + new THREE.Color(C.gear).getHexString(); g.fillRect(0, h * 0.62, w, h * 0.16); });
  R.helmet = phys({ map: helmTex, roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08 }, 'vy-helm');
  R.visor = std({ color: 0x15171a, roughness: 0.4, metalness: 0.4 }, 'vy-visor');
  R.goggle = phys({ color: 0x0a0a0c, roughness: 0.05, metalness: 0.6, clearcoat: 1 }, 'vy-gog');
  R.skin = std({ color: 0x9a6a4e, roughness: 0.6, metalness: 0 }, 'vy-skin');

  const hips = V(0, 0.99, 0.15), shoulders = V(0, 1.34, -0.14), neck = V(0, 1.46, -0.19), headC = V(0, 1.56, -0.22);
  const torso = capsuleBetween(hips.clone().add(V(0, 0.02, 0)), shoulders, 0.14, R.jersey); torso.scale.set(1.15, 1, 0.80); rider.add(torso);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), R.jersey); chest.position.copy(shoulders).add(V(0, -0.02, 0.0)); chest.scale.set(1.2, 0.85, 0.9); rider.add(chest);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 12), R.pants); pelvis.position.copy(hips); pelvis.scale.set(1.1, 0.9, 0.95); rider.add(pelvis);
  const hel = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 20), R.helmet); hel.position.copy(headC); hel.scale.set(0.95, 1.0, 1.12); rider.add(hel);
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.085, 0.12), R.helmet); chin.position.copy(headC).add(V(0, -0.075, -0.115)); chin.rotation.x = 0.35; rider.add(chin);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.15), R.visor); peak.position.copy(headC).add(V(0, 0.10, -0.15)); peak.rotation.x = -0.25; rider.add(peak);
  const gog = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.14, 6, 12), R.goggle); gog.rotation.z = Math.PI / 2; gog.position.copy(headC).add(V(0, 0.018, -0.115)); gog.scale.set(1, 1, 0.9); rider.add(gog);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 28), R.goggle); strap.rotation.x = Math.PI / 2; strap.position.copy(headC).add(V(0, 0.02, 0)); strap.scale.set(1, 1.1, 1); rider.add(strap);
  const neckM = cyl(0.045, 0.05, 0.08, R.skin, 10); neckM.position.copy(neck).add(V(0, -0.01, 0.01)); rider.add(neckM);
  // arms: shoulder -> elbow -> grip
  rider.userData.arms = [];
  for (const sx of [-1, 1]) {
    const sh = shoulders.clone().add(V(sx * 0.19, 0.0, 0.0)), grip = V(sx * 0.38, 1.08, -0.40), el = V(sx * 0.37, 1.23, -0.21);
    rider.add(capsuleBetween(sh, el, 0.058, R.jersey)); rider.add(capsuleBetween(el, grip.clone().add(V(0, 0.01, 0.04)), 0.05, R.jersey));
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), R.glove); gl.position.copy(grip); gl.scale.set(1, 0.9, 1.3); rider.add(gl);
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), R.jersey); sp.position.copy(sh); rider.add(sp);
  }
  // legs: hip -> knee -> boot on peg
  for (const sx of [-1, 1]) {
    const hp = hips.clone().add(V(sx * 0.12, -0.03, -0.02)), kn = V(sx * 0.19, 0.74, -0.20), ank = V(sx * 0.20, 0.38, 0.05), toe = V(sx * 0.20, 0.31, -0.07);
    rider.add(capsuleBetween(hp, kn, 0.092, R.pants)); rider.add(capsuleBetween(kn, ank, 0.07, R.boot));
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), R.boot); pad.position.copy(kn).add(V(sx * 0.015, 0.0, -0.05)); pad.scale.set(0.9, 1, 0.8); rider.add(pad);
    const bt = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.085, 0.27), R.boot); bt.position.copy(ank).add(V(0, -0.075, -0.075)); rider.add(bt);
  }
  body.add(rider);

  // parts used by the sim ------------------------------------------------
  const axis = steer.userData.axis;
  const out = { bike, body, steer: fork, rider, wheelF, wheelR, swing, head, axis, rearOff: swing.userData.axle, WB };
  // fork rotates around its own (tilted) axis: rotate about axis in the head frame
  out.setSteer = (a) => { fork.quaternion.setFromAxisAngle(axis.clone().negate(), a); };
  out.setCompression = (front, rear) => {
    // front: telescopes along the axis; rear: swingarm rotation
    wheelF.position.copy(axis).multiplyScalar(forkLen - front * 0.08);
    swing.rotation.x = rear * 0.06;
  };
  bike.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return out;
}
