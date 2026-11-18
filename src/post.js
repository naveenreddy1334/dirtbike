// Per-viewport HDR pipeline: scene -> bloom pyramid -> light shafts -> grade/tonemap -> FXAA to screen.
import * as THREE from 'three';

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsMesh = new THREE.Mesh(tri, null); fsMesh.frustumCulled = false;
const fsScene = new THREE.Scene(); fsScene.add(fsMesh);

const VS = /* glsl */`in vec3 position; out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const mk = (fs, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: 'precision highp float;\nprecision highp sampler2D;\nin vec2 vUv; out vec4 o;\n' + fs, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });

const matDown = mk(/* glsl */`
uniform sampler2D t; uniform vec2 px; uniform float first;
vec4 S(vec2 d){ return texture(t, vUv + d * px); }
float kw(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main(){
  vec4 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0)), g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2));
  vec4 j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
  if (first > 0.5) {
    // sky pixels were written with alpha 0: keep a sky mask in alpha for the light shafts
    a.a = 1.0 - a.a; b.a = 1.0 - b.a; c.a = 1.0 - c.a; d.a = 1.0 - d.a; e.a = 1.0 - e.a; f.a = 1.0 - f.a; g.a = 1.0 - g.a; h.a = 1.0 - h.a; i.a = 1.0 - i.a; j.a = 1.0 - j.a; k.a = 1.0 - k.a; l.a = 1.0 - l.a; m.a = 1.0 - m.a;
    // Karis average on the first pass kills fireflies
    vec4 g0 = (j + k + l + m); float w0 = kw(j.rgb) + kw(k.rgb) + kw(l.rgb) + kw(m.rgb);
    vec4 q0 = (j * kw(j.rgb) + k * kw(k.rgb) + l * kw(l.rgb) + m * kw(m.rgb)) / w0;
    vec4 q1 = (a + b + d + e) * 0.25, q2 = (b + c + e + f) * 0.25, q3 = (d + e + g + h) * 0.25, q4 = (e + f + h + i) * 0.25;
    float w1 = kw(q1.rgb), w2 = kw(q2.rgb), w3 = kw(q3.rgb), w4 = kw(q4.rgb), wq = kw(q0.rgb) * 4.0;
    o = (q0 * wq + q1 * w1 + q2 * w2 + q3 * w3 + q4 * w4) / (wq + w1 + w2 + w3 + w4);
    o.a = g0.a * 0.25;
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
}`, { t: { value: null }, px: { value: new THREE.Vector2() }, first: { value: 0 } });

const matUp = mk(/* glsl */`
uniform sampler2D t; uniform sampler2D base; uniform vec2 px; uniform float radius;
void main(){
  vec2 d = px * radius;
  vec4 s = texture(t, vUv) * 4.0;
  s += (texture(t, vUv + vec2(d.x, 0)) + texture(t, vUv - vec2(d.x, 0)) + texture(t, vUv + vec2(0, d.y)) + texture(t, vUv - vec2(0, d.y))) * 2.0;
  s += texture(t, vUv + d) + texture(t, vUv - d) + texture(t, vUv + vec2(d.x, -d.y)) + texture(t, vUv + vec2(-d.x, d.y));
  o = s / 16.0 + texture(base, vUv);
}`, { t: { value: null }, base: { value: null }, px: { value: new THREE.Vector2() }, radius: { value: 1 } });

const matRays = mk(/* glsl */`
uniform sampler2D t; uniform vec2 sun; uniform float strength; uniform float aspect;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  vec2 dir = sun - vUv; float len = length(dir * vec2(aspect, 1.0));
  vec2 stp = dir / 28.0 * min(1.0, 0.85 / max(len, 1e-3));
  vec2 p = vUv + stp * ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0); float w = 1.0, tw = 0.0;
  for (int i = 0; i < 28; i++) {
    vec4 s = texture(t, clamp(p, 0.001, 0.999));
    // only unoccluded sky near the sun feeds the shafts
    vec2 q = (p - sun) * vec2(aspect, 1.0);
    float near = exp(-dot(q, q) * 7.0);
    acc += min(s.rgb, vec3(30.0)) * s.a * near * w; tw += w; w *= 0.965; p += stp;
  }
  o = vec4(acc / tw * strength, 1.0);
}`, { t: { value: null }, sun: { value: new THREE.Vector2() }, strength: { value: 0 }, aspect: { value: 1 } });

const matComp = mk(/* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays;
uniform float exposure; uniform float bloomAmt; uniform float blur; uniform float raysOn; uniform float time; uniform float aspect; uniform float sat; uniform float fade;
uniform vec2 sun; uniform float flare; uniform vec2 px;
// AgX (Troy Sobotka), fitted version by Benjamin Wrensch
vec3 agxDefaultContrastApprox(vec3 x) { vec3 x2 = x * x, x4 = x2 * x2; return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 val) {
  const mat3 agx_mat = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float min_ev = -12.47393, max_ev = 4.026069;
  val = agx_mat * val; val = clamp(log2(max(val, 1e-10)), min_ev, max_ev); val = (val - min_ev) / (max_ev - min_ev);
  return agxDefaultContrastApprox(val);
}
vec3 agxEotf(vec3 val) {
  const mat3 agx_mat_inv = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  val = agx_mat_inv * val; return pow(max(val, 0.0), vec3(2.2));
}
vec3 agxLook(vec3 val) {
  float luma = dot(val, vec3(0.2126, 0.7152, 0.0722));
  val = pow(max(val, 0.0), vec3(1.38)) ;                // contrast ("punchy")
  luma = dot(val, vec3(0.2126, 0.7152, 0.0722));
  return luma + sat * (val - luma);
}
void main(){
  vec2 c = vUv - 0.5; float r2 = dot(c * vec2(aspect, 1.0), c * vec2(aspect, 1.0));
  // speed blur: radial, strongest at the screen edge
  vec3 col = vec3(0.0); float amt = blur * smoothstep(0.03, 0.42, r2);
  if (amt > 0.0005) { for (int i = 0; i < 8; i++) { float t = (float(i) + 0.5) / 8.0; col += texture(tScene, vUv - c * amt * t).rgb; } col /= 8.0; }
  else col = texture(tScene, vUv).rgb;
  vec3 bl = texture(tBloom, vUv).rgb;
  col = mix(col, bl, bloomAmt);
  if (raysOn > 0.5) col += texture(tRays, vUv).rgb;
  // simple lens ghosts when the sun is in frame
  if (flare > 0.001) {
    vec2 a = (vec2(0.5) - sun);
    vec3 g = texture(tBloom, sun + a * 1.55).rgb * vec3(0.5, 0.75, 1.0) * 0.012 + texture(tBloom, sun + a * 2.3).rgb * vec3(1.0, 0.6, 0.35) * 0.008;
    col += g * flare;
  }
  col *= exposure;
  col = agxEotf(agxLook(agx(col)));                      // display-linear
  // gentle split-tone: warm highlights, slightly cool shadows
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.97, 1.0, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.0, 0.7, l));
  col *= 1.0 - 0.34 * smoothstep(0.12, 0.78, r2);         // vignette
  col *= fade;
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  o = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));     // luma in alpha for FXAA
}`, { tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, exposure: { value: 1 }, bloomAmt: { value: 0.06 }, blur: { value: 0 }, raysOn: { value: 0 }, time: { value: 0 }, aspect: { value: 1 }, sat: { value: 1.08 }, fade: { value: 1 }, sun: { value: new THREE.Vector2() }, flare: { value: 0 }, px: { value: new THREE.Vector2() } });

// FXAA 3.11 (quality, trimmed) + film grain
const matFxaa = mk(/* glsl */`
uniform sampler2D t; uniform vec2 px; uniform float time; uniform float grain; uniform float sharpen;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec4 m = texture(t, vUv);
  float lM = m.a, lN = texture(t, vUv + vec2(0, px.y)).a, lS = texture(t, vUv - vec2(0, px.y)).a, lE = texture(t, vUv + vec2(px.x, 0)).a, lW = texture(t, vUv - vec2(px.x, 0)).a;
  float mx = max(lM, max(max(lN, lS), max(lE, lW))), mn = min(lM, min(min(lN, lS), min(lE, lW))), range = mx - mn;
  vec3 col = m.rgb;
  if (range > max(0.0312, mx * 0.125)) {
    float lNW = texture(t, vUv + vec2(-px.x, px.y)).a, lNE = texture(t, vUv + px).a, lSW = texture(t, vUv - px).a, lSE = texture(t, vUv + vec2(px.x, -px.y)).a;
    float eh = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
    float ev = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
    bool horz = eh >= ev;
    float l1 = horz ? lS : lW, l2 = horz ? lN : lE, g1 = l1 - lM, g2 = l2 - lM;
    bool steep1 = abs(g1) >= abs(g2); float gs = 0.25 * max(abs(g1), abs(g2));
    float stepL = horz ? px.y : px.x; float lAvg = 0.0;
    if (steep1) { stepL = -stepL; lAvg = 0.5 * (l1 + lM); } else { lAvg = 0.5 * (l2 + lM); }
    vec2 uv = vUv; if (horz) uv.y += stepL * 0.5; else uv.x += stepL * 0.5;
    vec2 off = horz ? vec2(px.x, 0.0) : vec2(0.0, px.y);
    vec2 u1 = uv - off, u2 = uv + off; float e1 = texture(t, u1).a - lAvg, e2 = texture(t, u2).a - lAvg;
    bool r1 = abs(e1) >= gs, r2 = abs(e2) >= gs;
    for (int i = 0; i < 7; i++) {
      if (!r1) { u1 -= off * 1.5; e1 = texture(t, u1).a - lAvg; r1 = abs(e1) >= gs; }
      if (!r2) { u2 += off * 1.5; e2 = texture(t, u2).a - lAvg; r2 = abs(e2) >= gs; }
      if (r1 && r2) break;
    }
    float d1 = horz ? (vUv.x - u1.x) : (vUv.y - u1.y), d2 = horz ? (u2.x - vUv.x) : (u2.y - vUv.y);
    bool dir1 = d1 < d2; float dist = min(d1, d2), span = d1 + d2;
    bool center = lM < lAvg; bool good = ((dir1 ? e1 : e2) < 0.0) != center;
    float pixOff = good ? (-dist / span + 0.5) : 0.0;
    float lAvgAll = (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0;
    float sub = clamp(abs(lAvgAll - lM) / range, 0.0, 1.0); sub = (-2.0 * sub + 3.0) * sub * sub; sub = sub * sub * 0.6;
    float fo = max(pixOff, sub);
    vec2 fuv = vUv; if (horz) fuv.y += fo * stepL; else fuv.x += fo * stepL;
    col = texture(t, fuv).rgb;
  } else if (sharpen > 0.0) {
    vec3 n = texture(t, vUv + vec2(0, px.y)).rgb + texture(t, vUv - vec2(0, px.y)).rgb + texture(t, vUv + vec2(px.x, 0)).rgb + texture(t, vUv - vec2(px.x, 0)).rgb;
    col = clamp(col + (col - n * 0.25) * sharpen, 0.0, 1.0);
  }
  float g = (hash(gl_FragCoord.xy + fract(time) * 173.0) - 0.5) * grain;
  col += g * (0.6 + 0.8 * (1.0 - m.a));
  o = vec4(col, 1.0);
}`, { t: { value: null }, px: { value: new THREE.Vector2() }, time: { value: 0 }, grain: { value: 0.035 }, sharpen: { value: 0.25 } });

function pass(renderer, mat, target) {
  fsMesh.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam);
}

export class View {
  constructor(renderer, q) {
    this.r = renderer; this.q = q; this.rect = { x: 0, y: 0, w: 2, h: 2 }; this.scale = q.scale; this.iw = 0; this.ih = 0;
    this.sceneRT = null; this.down = []; this.up = []; this.raysRT = null; this.ldrRT = null;
    this.p = { exposure: 1, bloom: 0.07, blur: 0, fade: 1, grain: 0.035 };
    this._v = new THREE.Vector3();
  }
  setRect(x, y, w, h) { this.rect = { x, y, w, h }; this._alloc(); }
  setScale(s) { if (Math.abs(s - this.scale) > 0.001) { this.scale = s; this._alloc(); } }
  setQuality(q) { this.q = q; this.scale = q.scale; this.dispose(); this._alloc(); }
  dispose() { [this.sceneRT, this.raysRT, this.ldrRT, ...this.down, ...this.up].forEach(t => t && t.dispose()); this.sceneRT = this.raysRT = this.ldrRT = null; this.down = []; this.up = []; this.iw = 0; }
  _alloc() {
    const q = this.q; let w = Math.max(8, Math.round(this.rect.w * this.scale)), h = Math.max(8, Math.round(this.rect.h * this.scale));
    const cap = Math.sqrt(q.maxPixels / (w * h)); if (cap < 1) { w = Math.round(w * cap); h = Math.round(h * cap); }
    if (w === this.iw && h === this.ih) return;
    this.dispose(); this.iw = w; this.ih = h;
    const HF = THREE.HalfFloatType, opt = { type: HF, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...opt, depthBuffer: true, samples: q.msaa });
    let mw = w, mh = h;
    for (let i = 0; i < q.bloom; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      this.down.push(new THREE.WebGLRenderTarget(mw, mh, opt));
      if (i < q.bloom - 1) this.up.push(new THREE.WebGLRenderTarget(mw, mh, opt));
    }
    this.raysRT = new THREE.WebGLRenderTarget(Math.max(2, w >> 2), Math.max(2, h >> 2), opt);
    this.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
  }
  // render the scene through this view's camera and present it into its rectangle on the canvas
  render(scene, camera, sunDirSky, time, canvasH) {
    const r = this.r, q = this.q, p = this.p;
    camera.aspect = this.rect.w / this.rect.h; camera.updateProjectionMatrix();
    r.setRenderTarget(this.sceneRT); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(scene, camera);
    // bloom pyramid
    const n = this.down.length;
    for (let i = 0; i < n; i++) {
      const src = i === 0 ? this.sceneRT : this.down[i - 1];
      matDown.uniforms.t.value = src.texture; matDown.uniforms.px.value.set(1 / src.width, 1 / src.height); matDown.uniforms.first.value = i === 0 ? 1 : 0;
      pass(r, matDown, this.down[i]);
    }
    let cur = this.down[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      matUp.uniforms.t.value = cur.texture; matUp.uniforms.base.value = this.down[i].texture; matUp.uniforms.px.value.set(1 / cur.width, 1 / cur.height); matUp.uniforms.radius.value = 1.0;
      pass(r, matUp, this.up[i]); cur = this.up[i];
    }
    // sun position on screen
    const v = this._v.copy(sunDirSky).multiplyScalar(1000).add(camera.position).project(camera);
    const facing = this._v2 || (this._v2 = new THREE.Vector3()); camera.getWorldDirection(facing);
    const cosS = facing.dot(sunDirSky), sunUv = matComp.uniforms.sun.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    const aspect = this.rect.w / this.rect.h;
    const onScreen = cosS > 0.2 ? Math.max(0, 1 - Math.max(0, Math.max(Math.abs(v.x), Math.abs(v.y)) - 1) * 1.6) : 0;
    let rays = 0;
    if (q.godrays && onScreen > 0.01) {
      rays = 1; matRays.uniforms.t.value = this.down[1].texture; matRays.uniforms.sun.value.copy(sunUv); matRays.uniforms.aspect.value = aspect; matRays.uniforms.strength.value = 0.30 * onScreen;
      pass(r, matRays, this.raysRT);
    }
    const u = matComp.uniforms;
    u.tScene.value = this.sceneRT.texture; u.tBloom.value = cur.texture; u.tRays.value = this.raysRT.texture; u.raysOn.value = rays;
    // stop down a little when looking into the sun (cheap eye adaptation)
    u.exposure.value = p.exposure * 1;
    u.bloomAmt.value = p.bloom; u.blur.value = p.blur; u.time.value = time; u.aspect.value = aspect; u.fade.value = p.fade; u.flare.value = 0;
    pass(r, matComp, this.ldrRT);
    // present
    const f = matFxaa.uniforms; f.t.value = this.ldrRT.texture; f.px.value.set(1 / this.iw, 1 / this.ih); f.time.value = time; f.grain.value = p.grain; f.sharpen.value = this.iw < this.rect.w * 0.95 ? 0.45 : 0.2;
    r.setRenderTarget(null);
    const y = canvasH - this.rect.y - this.rect.h;
    r.setViewport(this.rect.x, y, this.rect.w, this.rect.h); r.setScissor(this.rect.x, y, this.rect.w, this.rect.h); r.setScissorTest(true);
    fsMesh.material = matFxaa; r.render(fsScene, fsCam);
    r.setScissorTest(false);
  }
}
