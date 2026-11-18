// Vegetation and props: procedural trees/bushes (ez-tree geometry, our PBR materials), CC0 rocks, and chunked GPU grass.
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchStandard } from './shaderlib.js';

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }

const SPECIES = {
  pine:  { presets: ['Pine Medium', 'Pine Large'], seeds: [11, 47], h: 19, thin: 0.30 },
  oak:   { presets: ['Oak Medium', 'Oak Large'],   seeds: [5, 23],  h: 13, thin: 0.34 },
  ash:   { presets: ['Ash Medium', 'Ash Large'],   seeds: [9, 31],  h: 14.5, thin: 0.34 },
  aspen: { presets: ['Aspen Medium', 'Aspen Large'], seeds: [3, 17], h: 13, thin: 0.34 }
};
const BUSH = [{ p: 'Bush 1', seed: 2, h: 1.2 }, { p: 'Bush 2', seed: 8, h: 1.1 }, { p: 'Bush 3', seed: 14, h: 1.3 }];

// sway for trunks/leaves; amplitude grows with height above the root (template units)
const SWAY_V = (amp, flutter) => `
  { vec3 ip = vec3(instanceMatrix[3]); float ph = ip.x * 0.11 + ip.z * 0.13;
    float hh = max(position.y, 0.0);
    float w = sin(uTime * 1.1 + ph + hh * 0.05) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.4;
    transformed.x += uWind.x * w * hh * hh * ${amp};
    transformed.z += uWind.y * w * hh * hh * ${amp};
    ${flutter ? `transformed += ${flutter} * vec3(sin(uTime * 5.0 + position.x * 3.1 + ph), sin(uTime * 4.3 + position.z * 2.7), cos(uTime * 5.7 + position.y * 2.9 + ph));` : ''} }`;

// keep a fraction of the foliage quads and enlarge the survivors, so canopies keep their volume at a fraction of the vertices
function thinLeaves(g, keep) {
  if (keep >= 0.99) return g;
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, quads = P.count / 4 | 0, R = rng(99);
  const kept = []; for (let i = 0; i < quads; i++) if (R() < keep) kept.push(i);
  const n = kept.length, pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6), k = 1 / Math.sqrt(keep) * 0.92;
  kept.forEach((q, j) => {
    let cx = 0, cy = 0, cz = 0; for (let v = 0; v < 4; v++) { cx += P.getX(q * 4 + v) / 4; cy += P.getY(q * 4 + v) / 4; cz += P.getZ(q * 4 + v) / 4; }
    for (let v = 0; v < 4; v++) {
      const a = q * 4 + v, b = j * 4 + v;
      pos[b * 3] = cx + (P.getX(a) - cx) * k; pos[b * 3 + 1] = cy + (P.getY(a) - cy) * k; pos[b * 3 + 2] = cz + (P.getZ(a) - cz) * k;
      nrm[b * 3] = N.getX(a); nrm[b * 3 + 1] = N.getY(a); nrm[b * 3 + 2] = N.getZ(a); uv[b * 2] = U.getX(a); uv[b * 2 + 1] = U.getY(a);
    }
    idx.set([j * 4, j * 4 + 1, j * 4 + 2, j * 4, j * 4 + 2, j * 4 + 3], j * 6);
  });
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.BufferAttribute(pos, 3)); o.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); o.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); o.setIndex(new THREE.BufferAttribute(idx, 1)); o.computeBoundingBox(); o.computeBoundingSphere();
  return o;
}

function buildTemplate(preset, seed, targetH, kind, thin = 1) {
  const t = new Tree(); t.options.seed = seed; t.loadPreset(preset);
  const bg = t.branchesMesh.geometry; let lg = thinLeaves(t.leavesMesh.geometry, thin);
  bg.computeBoundingBox(); lg.computeBoundingBox();
  const box = bg.boundingBox.clone().union(lg.boundingBox);
  const h = Math.max(0.01, box.max.y - Math.max(0, box.min.y));
  const sc = targetH / h;
  // foliage normals: blend flat quad normals toward a crown-radial direction so canopies read as volumes
  const center = new THREE.Vector3(); lg.boundingBox.getCenter(center);
  const pos = lg.attributes.position, nrm = lg.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const rad = (lg.boundingBox.max.y - lg.boundingBox.min.y) * 0.5 + 1e-3;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center); v.y *= 0.8; v.normalize();
    n.fromBufferAttribute(nrm, i); if (n.dot(v) < 0) n.negate();
    n.lerp(v, kind === 'bush' ? 0.55 : 0.78).add(up.clone().multiplyScalar(0.12)).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  const bm = t.branchesMesh.material, lm = t.leavesMesh.material;
  const bark = new THREE.MeshStandardMaterial({ map: bm.map, normalMap: bm.normalMap, roughnessMap: bm.roughnessMap, aoMap: bm.aoMap, roughness: 1, metalness: 0, color: new THREE.Color(0.8, 0.78, 0.74) });
  patchStandard(bark, { key: 'vy-bark', vBegin: SWAY_V('0.0016', ''), sunVis: '1.0', ao: '1.0', dynBias: 0.002 });
  const leaf = new THREE.MeshStandardMaterial({ map: lm.map, alphaTest: Math.max(0.35, lm.alphaTest || 0.5), side: THREE.DoubleSide, roughness: 0.72, metalness: 0, color: new THREE.Color(kind === 'bush' ? 0.78 : 0.7, kind === 'bush' ? 0.85 : 0.82, 0.55) });
  patchStandard(leaf, {
    key: 'vy-leaf', vBegin: SWAY_V('0.0018', '0.018'), sunVis: '1.0', dynBias: 0.002,
    // cheap subsurface: leaves glow when backlit by the low sun
    fEnd: 'float vyBack = pow(clamp(dot(normalize(vNormal), -normalize(directionalLights[0].direction)), 0.0, 1.0), 1.6); outgoingLight += diffuseColor.rgb * directionalLights[0].color * vyBack * 0.20;'
  });
  return { bg, lg, bark, leaf, sc, box, h, noBranch: kind === 'bush' };
}

function instancedPair(tpl, list, shadows, cellSize = 70) {
  // bucket into map cells so the frustum can cull whole chunks per view
  const cells = new Map();
  for (const it of list) { const k = Math.floor(it.x / cellSize) + ',' + Math.floor(it.z / cellSize); (cells.get(k) || cells.set(k, []).get(k)).push(it); }
  const out = [];
  for (const [, items] of cells) for (const [geo, mat, cast] of [[tpl.bg, tpl.bark, shadows], [tpl.lg, tpl.leaf, shadows]]) {
    if (tpl.noBranch && geo === tpl.bg) continue;
    const m = new THREE.InstancedMesh(geo, mat, items.length);
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    items.forEach((it, i) => {
      e.set(it.tilt || 0, it.rot, it.tilt2 || 0); q.setFromEuler(e); s.setScalar(it.s * tpl.sc); p.set(it.x, it.y, it.z);
      mt.compose(p, q, s); m.setMatrixAt(i, mt);
      c.setRGB(it.c[0], it.c[1], it.c[2]); m.setColorAt(i, c);
    });
    m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = true; m.computeBoundingSphere();
    out.push(m);
  }
  return out;
}

export async function createVegetation(scene, A, world, P, q) {
  const R = rng(1337), stats = { trees: 0, bushes: 0, rocks: 0, grass: 0, treeVerts: 0 };
  const group = new THREE.Group(); scene.add(group);

  // ------------------------------------------------------------------ trees
  const byCls = {};
  for (const t of A.scatter.trees) {
    const sp = SPECIES[t.sp] ? t.sp : 'oak';
    const v = R() < 0.5 ? 0 : 1;
    (byCls[sp + v] ||= { sp, v, items: [] }).items.push({
      x: t.x, z: t.z, y: world.heightAt(t.x, t.z) - 0.2, s: t.s * (0.85 + 0.3 * R()), rot: R() * 6.283, tilt: (R() - 0.5) * 0.05, tilt2: (R() - 0.5) * 0.05,
      c: (() => { const b = 0.82 + 0.3 * R(), w = (R() - 0.5) * 0.12; return [b * (1 + w), b, b * (1 - w)]; })()
    });
  }
  for (const k in byCls) {
    const { sp, v, items } = byCls[k], S = SPECIES[sp];
    const tpl = buildTemplate(S.presets[v], S.seeds[v], S.h, 'tree', S.thin);
    void ('tpl', k, 'branch verts', tpl.bg.attributes.position.count, 'leaf verts', tpl.lg.attributes.position.count);
    const meshes = instancedPair(tpl, items, true); meshes.forEach(m => group.add(m));
    stats.trees += items.length; stats.treeVerts += (tpl.bg.attributes.position.count + tpl.lg.attributes.position.count) * items.length;
  }

  // ------------------------------------------------------------------ bushes
  const bushBy = [[], [], []];
  const bushCap = q.name === 'Low' ? 260 : q.name === 'Medium' ? 520 : 900;
  for (const b of A.scatter.bushes.slice(0, bushCap)) {
    const k = b[5] % 3, bu = BUSH[k], g = 0.9 + 0.5 * R();
    bushBy[k].push({ x: b[0], z: b[2], y: world.heightAt(b[0], b[2]) - 0.05, s: b[3] * g, rot: b[4], c: (() => { const c = 0.8 + 0.35 * R(); return [c, c, c * 0.9]; })() });
  }
  bushBy.forEach((items, k) => {
    if (!items.length) return;
    const tpl = buildTemplate(BUSH[k].p, BUSH[k].seed, BUSH[k].h, 'bush', 0.4);
    void ('bush', k, items.length, 'branch', tpl.bg.attributes.position.count, 'leaf', tpl.lg.attributes.position.count);
    instancedPair(tpl, items, false).forEach(m => group.add(m));
    stats.bushes += items.length;
  });

  // ------------------------------------------------------------------ rocks (CC0 photoscans from the ez-tree demo)
  try {
    const loader = new GLTFLoader();
    const glbs = await Promise.all(['rock1', 'rock2', 'rock3'].map(n => loader.loadAsync(`assets/${n}.txt`)));
    const geos = glbs.map(g => { let mesh = null; g.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; }); return mesh; });
    const rockMat = geos.map(m => patchStandard(m.material.clone(), { key: 'vy-rock', sunVis: '1.0', dynBias: 0.003 }));
    // keep triangle count sane: only rocks near the track, and few small ones far out
    const maxR = q.name === 'Low' ? 260 : q.name === 'Medium' ? 420 : 700;
    const lists = [[], [], []];
    for (const r of A.scatter.rocks.slice(0, maxR)) {
      const k = r[5] % 3;
      lists[k].push({ x: r[0], z: r[2], y: world.heightAt(r[0], r[2]) - 0.08 * r[3], s: Math.max(0.45, r[3]) * (r[5] > 2 ? 1.25 : 0.85), rot: r[4], tilt: (R() - 0.5) * 0.4, tilt2: (R() - 0.5) * 0.4 });
    }
    lists.forEach((items, k) => {
      if (!items.length) return;
      const geo = geos[k].geometry; geo.computeBoundingBox(); const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3());
      const norm = 1.0 / Math.max(size.x, size.z), cy = -bb.min.y;
      const im = new THREE.InstancedMesh(geo, rockMat[k], items.length), mt = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
      items.forEach((it, i) => { e.set(it.tilt, it.rot, it.tilt2); qq.setFromEuler(e); sc.setScalar(it.s * norm); pp.set(it.x, it.y + cy * it.s * norm, it.z); mt.compose(pp, qq, sc); im.setMatrixAt(i, mt); });
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = true; group.add(im); stats.rocks += items.length;
    });
  } catch (e) { console.warn('rocks failed', e); }

  // ------------------------------------------------------------------ grass (chunked, static instances, distance-faded in the shader)
  const grass = buildGrass(world, A, q, R, stats);
  group.add(grass.group);

  const wind = { update(t) {} };
  return { group, stats, grass, update(camPositions) { grass.update(camPositions); } };
}

function buildGrass(world, A, q, R, stats) {
  const g = new THREE.Group();
  // mask pixels on the CPU
  const img = A.maskImg, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const md = cx.getImageData(0, 0, cv.width, cv.height).data, MW = cv.width, MH = cv.height;
  const [mcx, mcz] = A.scatter.center, mR = A.scatter.maskR;
  const maskAt = (x, z) => {
    const u = (x - mcx) / (2 * mR) + 0.5, v = (z - mcz) / (2 * mR) + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const i = (Math.min(MH - 1, v * MH | 0) * MW + Math.min(MW - 1, u * MW | 0)) * 4; return [md[i] / 255, md[i + 1] / 255, md[i + 2] / 255];
  };
  // coarse track sample hash for distance queries
  const pts = [], cell = 12, hash = new Map();
  for (let d = 0; d < world.L; d += 2) { const p = world.pointAt(d); pts.push(p); const k = Math.floor(p.x / cell) + ',' + Math.floor(p.z / cell); (hash.get(k) || hash.set(k, []).get(k)).push(p); }
  const trackDist = (x, z) => {
    let best = 1e9; const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = hash.get((ci + i) + ',' + (cj + j)); if (a) for (const p of a) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; } }
    return Math.sqrt(best);
  };

  // blade-cluster geometry: 6 blades x 3 rows
  const BL = 6, pos = [], nrm = [], uvs = [], idx = [], rnd = R;
  for (let b = 0; b < BL; b++) {
    const yaw = (b / BL) * 6.283 + rnd() * 0.8, ox = (rnd() - 0.5) * 0.30, oz = (rnd() - 0.5) * 0.30, hgt = 0.55 + rnd() * 0.6, wid = 0.022 + rnd() * 0.014, lean = 0.10 + rnd() * 0.30;
    const cs = Math.cos(yaw), sn = Math.sin(yaw), base = pos.length / 3;
    for (let r = 0; r < 3; r++) {
      const t = r / 3, w = wid * (1 - t * 0.85), y = t * hgt, off = lean * t * t * hgt;
      for (const sgn of [-1, 1]) { pos.push(ox + cs * w * sgn + sn * off, y, oz + sn * w * sgn - cs * off); nrm.push(-sn, 0.55, cs); uvs.push(sgn * 0.5 + 0.5, t); }
    }
    pos.push(ox + sn * lean * hgt, hgt, oz - cs * lean * hgt); nrm.push(-sn, 0.7, cs); uvs.push(0.5, 1);
    for (let r = 0; r < 2; r++) { const a = base + r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    idx.push(base + 4, base + 5, base + 6);
  }
  const geoT = new THREE.BufferGeometry();
  geoT.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geoT.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geoT.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geoT.setIndex(idx);

  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0, color: 0xffffff });
  const fade = { value: new THREE.Vector2(q.grassDist * 0.55, q.grassDist) };
  patchStandard(mat, {
    key: 'vy-grass', dyn: false, uniforms: { uGrassFade: fade },
    vPars: 'attribute vec2 aG; attribute vec3 aTint; varying vec3 vTint; varying float vH; varying float vBk; uniform vec2 uGrassFade;',
    vBegin: `
      { vec3 ip = vec3(instanceMatrix[3]); float dd = distance(ip, cameraPosition);
        float f = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, dd);
        float h = position.y; vH = uv.y; vTint = aTint; vBk = aG.x;
        float ph = ip.x * 0.7 + ip.z * 0.5;
        float gust = sin(uTime * 1.6 + ph * 0.4) * 0.6 + sin(uTime * 3.1 + ph) * 0.25 + 0.4 * sin(uTime * 0.5 + ip.x * 0.05);
        transformed.xz *= f; transformed.y *= f * aG.y;
        transformed.x += uWind.x * gust * h * h * 0.55 * uWind.z; transformed.z += uWind.y * gust * h * h * 0.55 * uWind.z; }`,
    fPars: 'varying vec3 vTint; varying float vH; varying float vBk;',
    fColor: 'diffuseColor.rgb = vTint * mix(0.38, 1.25, smoothstep(0.0, 1.0, vH));',
    sunVis: 'vBk', ao: 'mix(0.55, 1.0, vH)'
  });

  const chunks = new Map(), CS = 36, dens = 1.15 * q.grass;
  const reach = 62;   // metres from the track that get grass
  const bounds = new THREE.Box3(); pts.forEach(p => bounds.expandByPoint(p));
  const dx = 1 / Math.sqrt(dens);
  for (let x = bounds.min.x - reach; x < bounds.max.x + reach; x += dx) for (let z = bounds.min.z - reach; z < bounds.max.z + reach; z += dx) {
    const jx = x + (R() - 0.5) * dx * 1.0, jz = z + (R() - 0.5) * dx * 1.0;
    const td = trackDist(jx, jz); if (td > reach || td < 8.6) continue;
    const mk = maskAt(jx, jz); if (!mk) continue;
    const gp = mk[1] * (1 - mk[0] * 0.9) * smooth(8.6, 14, td); if (R() > gp * 1.1) continue;
    const y = world.heightAt(jx, jz);
    const key = Math.floor(jx / CS) + ',' + Math.floor(jz / CS);
    (chunks.get(key) || chunks.set(key, []).get(key)).push([jx, y, jz, mk[2]]);
  }
  const list = [];
  for (const [, arr] of chunks) {
    const n = arr.length, m = new THREE.InstancedMesh(geoT.clone(), mat, n), aG = new Float32Array(n * 2), aT = new Float32Array(n * 3);
    const mt = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const bs = new THREE.Box3();
    arr.forEach(([x, y, z, dry], i) => {
      e.set(0, R() * 6.283, 0); qq.setFromEuler(e); const s = 0.8 + 0.7 * R() * R() * 1.4; sc.set(s * 0.9, s, s * 0.9); p.set(x, y - 0.02, z);
      mt.compose(p, qq, sc); m.setMatrixAt(i, mt); bs.expandByPoint(p);
      const vis = world.sampleGrid(world.VIS, x, z) / 255;
      aG[i * 2] = 0.25 + 0.75 * vis; aG[i * 2 + 1] = 0.7 + 0.6 * R();
      const d = Math.min(1, Math.max(0, dry + (R() - 0.5) * 0.5)), v = 0.75 + 0.5 * R();
      aT[i * 3] = (0.07 + 0.34 * d) * v; aT[i * 3 + 1] = (0.14 + 0.20 * d) * v; aT[i * 3 + 2] = (0.03 + 0.07 * d) * v;
    });
    m.geometry.setAttribute('aG', new THREE.InstancedBufferAttribute(aG, 2)); m.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(aT, 3));
    m.geometry.boundingSphere = null;
    const sph = new THREE.Sphere(); bs.getBoundingSphere(sph); sph.radius += 3; m.boundingSphere = sph; m.boundingBox = null;
    m.castShadow = false; m.receiveShadow = true; m.frustumCulled = true; m.userData.c = sph.center;
    g.add(m); list.push(m); stats.grass += n;
  }
  const lim = q.grassDist + 40;
  return {
    group: g, fade,
    update(cams) { for (const m of list) { let on = false; for (const c of cams) if (c.distanceTo(m.userData.c) < lim + m.boundingSphere.radius) { on = true; break; } m.visible = on; } }
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
