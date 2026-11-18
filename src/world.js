// Terrain mesh (from the baked warped height grid), the rutted mud track ribbon and their shared ground material.
import * as THREE from 'three';
import { shared, patchStandard } from './shaderlib.js';
import { makeCurve, TRACK, groundH, crossProfile } from './trackdef.js';

export function createWorld(scene, A, P, q) {
  // ------------------------------------------------------------------ track curve helpers
  const curve = makeCurve(), L = curve.getLength();
  const wrapD = d => ((d % L) + L) % L;
  const _p = new THREE.Vector3(), _t = new THREE.Vector3();
  const pointAt = (d, out = new THREE.Vector3()) => curve.getPointAt(wrapD(d) / L, out);
  const tangentAt = (d, out = new THREE.Vector3()) => { curve.getTangentAt(wrapD(d) / L, out); out.y = 0; return out.normalize(); };

  // ------------------------------------------------------------------ terrain data
  const dv = new DataView(A.terrainBin);
  const N = dv.getUint32(4, true), R0 = dv.getFloat32(8, true), K = dv.getFloat32(12, true), CX = dv.getFloat32(16, true), CZ = dv.getFloat32(20, true);
  const H = new Float32Array(A.terrainBin, 28, N * N);
  const base = 28 + N * N * 4;
  const VIS = new Uint8Array(A.terrainBin, base, N * N), AO = new Uint8Array(A.terrainBin, base + N * N, N * N), FOREST = new Uint8Array(A.terrainBin, base + 2 * N * N, N * N);
  const sinhK = Math.sinh(K), axis = new Float32Array(N);
  for (let i = 0; i < N; i++) axis[i] = R0 * Math.sinh(K * (i / (N - 1) * 2 - 1)) / sinhK;
  const gridCoord = (w) => { const t = Math.asinh(THREE.MathUtils.clamp(w, -R0, R0) * sinhK / R0) / K; return (t + 1) * 0.5 * (N - 1); };
  function sampleGrid(arr, x, z) {
    const fj = gridCoord(x - CX), fi = gridCoord(z - CZ);
    const j = Math.min(N - 2, Math.max(0, Math.floor(fj))), i = Math.min(N - 2, Math.max(0, Math.floor(fi)));
    // interpolate in world space inside the (non-uniform) cell
    const tx = THREE.MathUtils.clamp((x - CX - axis[j]) / (axis[j + 1] - axis[j]), 0, 1), tz = THREE.MathUtils.clamp((z - CZ - axis[i]) / (axis[i + 1] - axis[i]), 0, 1);
    const a = arr[i * N + j], b = arr[i * N + j + 1], c = arr[(i + 1) * N + j], d = arr[(i + 1) * N + j + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  const heightAt = (x, z) => sampleGrid(H, x, z);

  // ------------------------------------------------------------------ ground material
  const means = A.layers.map(l => l.mean);
  const v3 = c => `vec3(${c[0].toFixed(4)},${c[1].toFixed(4)},${c[2].toFixed(4)})`;
  const tileScale = (Math.round(L / 32) * 32) / L;       // so the 32 m track texture wraps exactly at the start line
  const groundUniforms = {
    uAlb: { value: A.groundAlb }, uNrm: { value: A.groundNh }, uMask: { value: A.mask }, uTrkA: { value: A.trackA }, uTrkB: { value: A.trackB },
    uMaskRect: { value: new THREE.Vector4(A.scatter.center[0], A.scatter.center[1], 1 / (2 * A.scatter.maskR), 0) }
  };
  const MEADOW_GLSL = /* glsl */`
    // Shared with the grass shader so blades and the ground under them always agree.
    vec3 vyMeadowTint(vec3 macro, float dry) {
      vec3 green = macro * vec3(0.62, 1.02, 0.55), gold = macro * vec3(1.42, 1.12, 0.62);
      return mix(green, gold, dry);
    }`;
  const fPars = /* glsl */`
    uniform highp sampler2DArray uAlb; uniform highp sampler2DArray uNrm;
    uniform sampler2D uMask; uniform sampler2D uTrkA; uniform sampler2D uTrkB; uniform vec4 uMaskRect;
    varying vec4 vBake; varying vec4 vTrk; varying vec3 vRight; varying vec3 vNrmW;
    vec3 vyAlb; vec3 vyNw; float vyRough; float vyAoG; float vySunV;
    ${MEADOW_GLSL}
    const vec3 M0 = ${v3(means[0])}; const vec3 M3 = ${v3(means[3])}; const vec3 M6 = ${v3(means[6])};
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void vyGround() {
      vec3 P = vWPos; vec2 xz = P.xz;
      float dist = distance(P, cameraPosition);
      vec3 Ng = normalize(vNrmW);
      float slope = 1.0 - Ng.y;
      vec2 muv = (xz - uMaskRect.xy) * uMaskRect.z + 0.5;
      float inM = smoothstep(0.0, 0.05, min(min(muv.x, 1.0 - muv.x), min(muv.y, 1.0 - muv.y)));
      vec3 mk = texture2D(uMask, clamp(muv, 0.0, 1.0)).rgb;
      float dirtM = mk.r * inM, dryM = mix(0.5, mk.b, inM), grassM = mix(1.0, mk.g, inM);
      float nA = vyNoise(xz * 0.021), nB = vyNoise(xz * 0.13 + 3.7), nC = vyNoise(xz * 0.9 + 11.0);
      float nearW = 1.0 - smoothstep(30.0, 120.0, dist), closeW = 1.0 - smoothstep(8.0, 40.0, dist);

      // ---------------- meadow
      vec3 mG = mix(texture(uAlb, vec3(xz / 67.0, 1.0)).rgb, texture(uAlb, vec3(xz.yx / 181.0 + 0.37, 1.0)).rgb, 0.45);
      vec3 meadow = vyMeadowTint(mG, clamp(dryM + (nA - 0.5) * 0.35, 0.0, 1.0));
      vec3 dG = texture(uAlb, vec3(xz / 3.1, 0.0)).rgb, dG2 = texture(uAlb, vec3(xz.yx / 12.7 + 0.5, 0.0)).rgb;
      vec3 detG = mix(dG2, dG, 0.35 + 0.65 * closeW) / M0;
      meadow *= mix(vec3(1.0), clamp(detG, 0.25, 2.6), nearW * 0.85);
      vec3 nG = texture(uNrm, vec3(xz / 3.1, 0.0)).xyz;

      // ---------------- dirt (apron, paths, paddock)
      vec3 mD = texture(uAlb, vec3(xz / 43.0 + 0.11, 2.0)).rgb;
      vec3 dGr = texture(uAlb, vec3(xz / 2.3, 3.0)).rgb, dLo = texture(uAlb, vec3(xz / 1.9 + 0.21, 6.0)).rgb;
      vec3 nGr = texture(uNrm, vec3(xz / 2.3, 3.0)).xyz, nLo = texture(uNrm, vec3(xz / 1.9 + 0.21, 6.0)).xyz;
      float gravelW = smoothstep(0.35, 0.75, nB);
      vec3 detD = mix(dLo / M6, dGr / M3, gravelW * 0.7);
      vec3 dirtBase = mD * vec3(0.80, 0.70, 0.62);
      vec3 dirt = dirtBase * mix(vec3(1.0), clamp(detD, 0.3, 2.4), nearW * 0.9);
      vec3 nD = mix(nLo, nGr, gravelW * 0.7);
      // height-blend dirt into the grass (dirt wins in the low spots of the grass texture)
      float hG = nG.z, hD = nD.z;
      float dw = clamp((dirtM * 1.7 - 0.35) + (hD - hG) * 0.6 * nearW, 0.0, 1.0);
      dw = smoothstep(0.0, 1.0, dw);
      vec3 col = mix(meadow, dirt, dw);
      vec2 nxy = mix(nG.xy, nD.xy, dw) * 2.0 - 1.0;
      float rough = mix(0.93, 0.88, dw);

      // ---------------- rock on steep slopes / high ground
      float rockW = smoothstep(0.22, 0.42, slope + (nA - 0.5) * 0.12) + smoothstep(330.0, 520.0, P.y + nA * 60.0) * 0.6;
      rockW = clamp(rockW, 0.0, 1.0);
      if (rockW > 0.002) {
        vec2 ruv = abs(Ng.x) > abs(Ng.z) ? P.zy : P.xy;
        vec3 rk = mix(texture(uAlb, vec3(ruv / 23.0, 4.0)).rgb, texture(uAlb, vec3(xz / 61.0, 5.0)).rgb, 0.4 * (1.0 - smoothstep(0.3, 0.6, slope)));
        vec3 rn = texture(uNrm, vec3(ruv / 23.0, 4.0)).xyz;
        col = mix(col, rk * vec3(0.92, 0.9, 0.9), rockW); nxy = mix(nxy, rn.xy * 2.0 - 1.0, rockW); rough = mix(rough, 0.84, rockW);
      }
      // scree / stony patches on the lower slopes
      float scree = smoothstep(0.08, 0.2, slope) * smoothstep(0.45, 0.75, nB) * (1.0 - rockW);
      col = mix(col, texture(uAlb, vec3(xz / 37.0, 5.0)).rgb, scree * 0.6);
      // forest floor under the distant tree cover
      float forest = vBake.b * (1.0 - rockW) * (0.75 + 0.5 * nA);
      col = mix(col, vec3(0.020, 0.030, 0.012) * (0.7 + 0.9 * nB), clamp(forest, 0.0, 1.0) * 0.88);

      vec3 N = normalize(Ng + vec3(nxy.x, 0.0, nxy.y) * (0.25 + 0.75 * nearW) * 0.85);
      float ao = vBake.g;

      // ---------------- track overlay (ribbon vertices only)
      float tw = vTrk.z;
      if (tw > 0.001) {
        vec2 tuv = vec2(vTrk.x / 13.0 + 0.5, 1.0 - vTrk.y * ${(tileScale / 32).toFixed(7)});
        vec3 ta = texture2D(uTrkA, tuv).rgb, tb = texture2D(uTrkB, tuv).rgb;
        float wetK = vTrk.w;
        float wet = clamp(tb.r * (0.35 + 1.25 * wetK), 0.0, 1.0);
        float damp = smoothstep(0.10, 0.45, wet), puddle = smoothstep(0.60, 0.74, wet);
        vec3 tdet = mix(dLo / M6, dGr / M3, 0.22);
        vec3 tcol = mD * vec3(0.66, 0.53, 0.44) * clamp(tdet, 0.4, 2.2);
        tcol *= (0.72 + 0.56 * tb.b) * mix(0.80, 1.16, ta.b);            // variation + lighter dry ridges
        tcol *= mix(1.0, 0.46, damp);
        tcol = mix(tcol, vec3(0.020, 0.017, 0.013), puddle * 0.93);
        float trough = mix(0.90, 0.42, damp); trough = mix(trough, 0.035, puddle);
        vec2 tn = (ta.rg * 2.0 - 1.0) * 1.5 * (1.0 - puddle);
        vec3 fwd = normalize(cross(vRight, vec3(0.0, 1.0, 0.0)));
        vec2 dn = (nLo.xy * 2.0 - 1.0) * 0.55 * nearW * (1.0 - puddle);
        vec3 tN = normalize(Ng + normalize(vRight) * tn.x - fwd * tn.y + vec3(dn.x, 0.0, dn.y));
        // tiny wind ripples on standing water
        float rp = vyNoise(xz * 9.0 + uTime * vec2(0.9, 0.5)) - 0.5;
        tN = normalize(tN + vec3(rp, 0.0, -rp) * 0.035 * puddle);
        col = mix(col, tcol, tw); N = normalize(mix(N, tN, tw)); rough = mix(rough, trough, tw);
        ao *= mix(1.0, 0.62 + 0.38 * tb.g, tw);
      }
      // dark contact patch under each bike
      vec2 b0 = xz - uBike0.xz, b1 = xz - uBike1.xz;
      float h0 = max(0.0, 1.0 - abs(P.y - uBike0.y) * 1.4), h1 = max(0.0, 1.0 - abs(P.y - uBike1.y) * 1.4);
      ao *= 1.0 - 0.5 * h0 * exp(-dot(b0, b0) * 2.2) - 0.5 * h1 * exp(-dot(b1, b1) * 2.2);
      vyAlb = col; vyNw = N; vyRough = rough; vyAoG = ao; vySunV = vBake.r;
    }`;
  const groundMat = patchStandard(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }), {
    key: 'ground', uniforms: groundUniforms,
    vPars: 'attribute vec4 aBake; attribute vec4 aTrk; attribute vec3 aRight; varying vec4 vBake; varying vec4 vTrk; varying vec3 vRight; varying vec3 vNrmW;',
    vEnd: 'vBake = aBake; vTrk = aTrk; vRight = aRight; vNrmW = normalize( mat3( modelMatrix ) * objectNormal );',
    fPars, fBegin: 'vyGround();', fColor: 'diffuseColor.rgb = vyAlb;', fRough: 'roughnessFactor = vyRough;',
    fNormal: 'normal = normalize( mat3( viewMatrix ) * vyNw );', sunVis: 'vySunV', ao: 'vyAoG', dynBias: 0.0012
  });
  groundMat.envMapIntensity = 1.0;

  // ------------------------------------------------------------------ terrain mesh in chunks (for frustum culling)
  const terrain = new THREE.Group(); terrain.name = 'terrain';
  const CH = 64, nCh = (N - 1) / CH;
  const nrm = new Float32Array(N * N * 3);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1), i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
    const dx = (H[i * N + j1] - H[i * N + j0]) / (axis[j1] - axis[j0]), dz = (H[i1 * N + j] - H[i0 * N + j]) / (axis[i1] - axis[i0]);
    const l = 1 / Math.hypot(dx, 1, dz), k = (i * N + j) * 3; nrm[k] = -dx * l; nrm[k + 1] = l; nrm[k + 2] = -dz * l;
  }
  for (let ci = 0; ci < nCh; ci++) for (let cj = 0; cj < nCh; cj++) {
    const n1 = CH + 1, pos = new Float32Array(n1 * n1 * 3), nor = new Float32Array(n1 * n1 * 3), bake = new Uint8Array(n1 * n1 * 4);
    for (let a = 0; a < n1; a++) for (let b = 0; b < n1; b++) {
      const i = ci * CH + a, j = cj * CH + b, g = i * N + j, k = (a * n1 + b);
      pos[k * 3] = CX + axis[j]; pos[k * 3 + 1] = H[g]; pos[k * 3 + 2] = CZ + axis[i];
      nor[k * 3] = nrm[g * 3]; nor[k * 3 + 1] = nrm[g * 3 + 1]; nor[k * 3 + 2] = nrm[g * 3 + 2];
      bake[k * 4] = VIS[g]; bake[k * 4 + 1] = AO[g]; bake[k * 4 + 2] = FOREST[g]; bake[k * 4 + 3] = 255;
    }
    const idx = new Uint16Array(CH * CH * 6); let w = 0;
    for (let a = 0; a < CH; a++) for (let b = 0; b < CH; b++) { const k = a * n1 + b; idx[w++] = k; idx[w++] = k + n1; idx[w++] = k + 1; idx[w++] = k + n1; idx[w++] = k + n1 + 1; idx[w++] = k + 1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aBake', new THREE.BufferAttribute(bake, 4, true)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; m.matrixAutoUpdate = false;
    // only terrain close to the track needs to be in the baked shadow map
    const c = g.boundingSphere.center; m.castShadow = Math.hypot(c.x - CX, c.z - CZ) - g.boundingSphere.radius < 420;
    terrain.add(m);
  }
  scene.add(terrain);

  // ------------------------------------------------------------------ track ribbon
  const half = TRACK.ribbonHalf, stepD = 0.4, rows = Math.ceil(L / stepD), cols = 27;
  const wetMod = (d) => {
    const a = d / L * Math.PI * 2;
    let w = 0.55 + 0.30 * Math.sin(a * 3 + 1.2) + 0.22 * Math.sin(a * 7 + 0.4) + 0.12 * Math.sin(a * 13 + 2.0);
    w *= 1 - Math.min(1, groundH(d) * 1.6);       // jump faces drain and stay dry
    return THREE.MathUtils.clamp(w, 0, 1.25);
  };
  const surfaceY = (d, s) => groundH(wrapD(d)) * crossProfile(s);
  {
    const vn = (rows + 1) * cols, pos = new Float32Array(vn * 3), trk = new Float32Array(vn * 4), rgt = new Float32Array(vn * 3), bake = new Uint8Array(vn * 4);
    const r = new THREE.Vector3();
    for (let i = 0; i <= rows; i++) {
      const d = (i / rows) * L; pointAt(d, _p); tangentAt(d, _t); r.set(-_t.z, 0, _t.x);
      const wm = wetMod(d % L);
      for (let j = 0; j < cols; j++) {
        const s = (j / (cols - 1) * 2 - 1) * half, k = i * cols + j;
        const x = _p.x + r.x * s, z = _p.z + r.z * s;
        const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(s), 5.3, 6.45);
        pos[k * 3] = x; pos[k * 3 + 1] = surfaceY(d, s) + 0.012 * edge; pos[k * 3 + 2] = z;
        trk[k * 4] = s; trk[k * 4 + 1] = (i === rows ? L : d); trk[k * 4 + 2] = edge; trk[k * 4 + 3] = wm;
        rgt[k * 3] = r.x; rgt[k * 3 + 1] = 0; rgt[k * 3 + 2] = r.z;
        bake[k * 4] = sampleGrid(VIS, x, z); bake[k * 4 + 1] = Math.min(255, sampleGrid(AO, x, z) + 12); bake[k * 4 + 2] = 0; bake[k * 4 + 3] = 255;
      }
    }
    const idx = new Uint32Array(rows * (cols - 1) * 6); let w = 0;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols - 1; j++) { const k = i * cols + j; idx[w++] = k; idx[w++] = k + 1; idx[w++] = k + cols; idx[w++] = k + cols; idx[w++] = k + 1; idx[w++] = k + cols + 1; }
    // split into segments so the frustum can cull most of the loop
    const SEG = 16, rowsPer = Math.ceil(rows / SEG);
    const full = new THREE.BufferGeometry();
    full.setAttribute('position', new THREE.BufferAttribute(pos, 3)); full.setIndex(new THREE.BufferAttribute(idx, 1)); full.computeVertexNormals();
    const nor = full.getAttribute('normal').array;
    for (let sgi = 0; sgi < SEG; sgi++) {
      const r0 = sgi * rowsPer, r1 = Math.min(rows, r0 + rowsPer); if (r0 >= r1) continue;
      const v0 = r0 * cols, v1 = (r1 + 1) * cols, cnt = v1 - v0;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos.slice(v0 * 3, v1 * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor.slice(v0 * 3, v1 * 3), 3));
      g.setAttribute('aTrk', new THREE.BufferAttribute(trk.slice(v0 * 4, v1 * 4), 4)); g.setAttribute('aRight', new THREE.BufferAttribute(rgt.slice(v0 * 3, v1 * 3), 3));
      g.setAttribute('aBake', new THREE.BufferAttribute(bake.slice(v0 * 4, v1 * 4), 4, true));
      const ii = new Uint16Array((r1 - r0) * (cols - 1) * 6); let q2 = 0;
      for (let i = 0; i < r1 - r0; i++) for (let j = 0; j < cols - 1; j++) { const k = i * cols + j; ii[q2++] = k; ii[q2++] = k + 1; ii[q2++] = k + cols; ii[q2++] = k + cols; ii[q2++] = k + 1; ii[q2++] = k + cols + 1; }
      g.setIndex(new THREE.BufferAttribute(ii, 1)); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; m.castShadow = true; m.matrixAutoUpdate = false; m.name = 'ribbon';
      scene.add(m);
    }
    full.dispose();
  }

  return { curve, L, wrapD, pointAt, tangentAt, heightAt, sampleGrid, VIS, AO, surfaceY, groundMat, CX, CZ, MEADOW_GLSL, groundUniforms, terrain };
}
