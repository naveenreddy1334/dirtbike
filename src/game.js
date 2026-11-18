// Two-player race: cadence -> speed, automatic steering/leaning/jumping along the spline, camera, particles, HUD, audio.
import * as THREE from 'three';
import { CFG } from './config.js';
import { JUMPS, groundH, crossProfile } from './trackdef.js';
import { makeBike, WR } from './bike.js';
import { audio } from './audio.js';
import { shared } from './shaderlib.js';
import { View } from './post.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const moveToward = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = s => { const m = Math.floor(s / 60); return String(m).padStart(2, '0') + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };

const COLORS = [
  { name: 'P1', css: '#ff3d2e', body: 0xff5a1f, dark: 0xb23a10, gear: 0x15171b, num: '1', lane: -1.6, key: 'W' },
  { name: 'P2', css: '#2f7bff', body: 0x1f86ff, dark: 0x0f56b8, gear: 0xf0f0ee, num: '2', lane: 1.6, key: '↑' }
];

export function createGame({ renderer, scene, world, sky, veg, q, LOOK, views, canvas }) {
  const L = world.L, { pointAt, tangentAt } = world;
  const slopeAt = d => (groundH(d + 0.25) - groundH(d - 0.25)) / 0.5;
  const LIPS = JUMPS.map(j => j.lip);

  // ------------------------------------------------------------------ players
  const players = COLORS.map((C, i) => {
    const parts = makeBike(C); scene.add(parts.bike);
    const cam = new THREE.PerspectiveCamera(66, 1, 0.3, 12000);
    return {
      id: i, C, parts, cam, pedal: false, camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), first: true, crank: 0, spin: 0, shadow: null,
      S: { rpm: 0, target: 0, speed: 0, rev: 0, dist: 0, travelled: 0, lean: 0, steerA: 0, pitch: 0, air: false, vy: 0, y: 0, squash: 0, lap: 0, lapTime: 0, best: 0, running: false, shake: 0, done: false, finishT: 0, acc: 0 },
      hud: null, pos: new THREE.Vector3(), fwd: new THREE.Vector3()
    };
  });
  let raceState = 'idle', countdown = 0, raceTime = 0, winner = -1, lastBeep = 4;

  // ------------------------------------------------------------------ ground shadows (low sun -> long soft shadows)
  const sunH = new THREE.Vector2(-sky.sunDir.x, -sky.sunDir.z).normalize(), sunEl = Math.asin(sky.sunDir.y);
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(0,0,0,.95)'); gr.addColorStop(0.55, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.filter = 'blur(5px)'; g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, 14); g.lineTo(120, 24); g.lineTo(250, 30); g.lineTo(120, 40); g.lineTo(0, 50); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(34, 32, 40, 16, 0, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
  })();
  const SH_N = 14;
  for (const P of players) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array((SH_N + 1) * 2 * 3), uv = new Float32Array((SH_N + 1) * 2 * 2), idx = [];
    for (let i = 0; i <= SH_N; i++) { uv.set([i / SH_N, 0, i / SH_N, 1], i * 4); if (i < SH_N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x2a1a0e, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 2; scene.add(m); P.shadow = m;
  }
  const tmpA = new THREE.Vector3();
  function updateShadow(P, x, z, hdg, base) {
    const len = Math.min(5.0, 1.75 / Math.tan(Math.max(0.08, sunEl))), pos = P.shadow.geometry.attributes.position;
    const hx = -Math.sin(hdg), hz = -Math.cos(hdg), cross = Math.abs(hx * sunH.y - hz * sunH.x);         // heading vs shadow direction
    const w0 = 0.28 + 0.40 * cross, w1 = 0.10 + 0.22 * cross;
    for (let i = 0; i <= SH_N; i++) {
      const t = i / SH_N, cx = x + sunH.x * len * t, cz = z + sunH.y * len * t, w = lerp(w0, w1, t);
      const px = -sunH.y, pz = sunH.x;
      for (let s = 0; s < 2; s++) {
        const sg = s ? 1 : -1, vx = cx + px * w * sg, vz = cz + pz * w * sg;
        const gy = Math.max(world.heightAt(vx, vz), base) + 0.035;
        pos.setXYZ(i * 2 + s, vx, gy, vz);
      }
    }
    pos.needsUpdate = true;
  }
  // ------------------------------------------------------------------ particles (dust + mud)
  const MAXP = 700, pPos = new Float32Array(MAXP * 3), pVel = new Float32Array(MAXP * 3), pLife = new Float32Array(MAXP), pAge = new Float32Array(MAXP),
    pBase = new Float32Array(MAXP), pSize = new Float32Array(MAXP), pAlpha = new Float32Array(MAXP), pCol = new Float32Array(MAXP * 3), pGrav = new Float32Array(MAXP);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); dustGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
  dustGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1)); dustGeo.setAttribute('pcol', new THREE.BufferAttribute(pCol, 3));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { scale: { value: 500 }, sunC: { value: new THREE.Color(1.0, 0.72, 0.46) }, amb: { value: new THREE.Color(0.32, 0.38, 0.5) } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 pcol; varying float vA; varying vec3 vC; uniform float scale;
      void main(){ vA = alpha; vC = pcol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = clamp(size * scale / max(0.1, -mv.z), 1.0, 220.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC; uniform vec3 sunC; uniform vec3 amb;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1))) * 43758.5453); }
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
        float n = 0.75 + 0.5 * h21(floor(gl_PointCoord * 6.0)); float a = smoothstep(0.5, 0.05, d) * vA * n; if (a < 0.01) discard;
        vec3 lit = vC * (vec3(0.80, 0.78, 0.76) + sunC * (0.75 + 0.45 * (0.5 - c.y))); gl_FragColor = vec4(lit, a); }`
  });
  const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; dust.renderOrder = 3; scene.add(dust);
  let pCursor = 0;
  function emit(x, y, z, vx, vy, vz, life, size, col, grav = 3.2, alpha = 0.5) {
    const i = pCursor; pCursor = (pCursor + 1) % MAXP;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pLife[i] = life; pAge[i] = 0; pBase[i] = size; pSize[i] = size; pAlpha[i] = alpha; pGrav[i] = grav;
    const v = 0.85 + 0.3 * Math.random(); pCol[i * 3] = col[0] * v; pCol[i * 3 + 1] = col[1] * v; pCol[i * 3 + 2] = col[2] * v;
  }
  const DUST = [0.52, 0.36, 0.21], MUD = [0.36, 0.20, 0.09];
  function updateParticles(dt) {
    for (let i = 0; i < MAXP; i++) {
      if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
      pAge[i] += dt;
      if (pAge[i] >= pLife[i]) { pLife[i] = 0; pAlpha[i] = 0; continue; }
      const k = pAge[i] / pLife[i], drag = pGrav[i] > 5 ? 0.2 : 1.5;
      pVel[i * 3 + 1] -= pGrav[i] * dt; pVel[i * 3] *= (1 - drag * dt); pVel[i * 3 + 2] *= (1 - drag * dt);
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] = Math.max(0.04, pPos[i * 3 + 1] + pVel[i * 3 + 1] * dt); pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pGrav[i] > 5) { pSize[i] = pBase[i]; pAlpha[i] = 0.95 * (1 - k * k); } else { pSize[i] = pBase[i] * (1 + k * 2.6); pAlpha[i] = 0.46 * (1 - k) * Math.min(1, pAge[i] * 8); }
    }
    dustGeo.attributes.position.needsUpdate = dustGeo.attributes.size.needsUpdate = dustGeo.attributes.alpha.needsUpdate = true;
  }

  // ------------------------------------------------------------------ race control
  function resetRace() {
    for (const P of players) { Object.assign(P.S, { rpm: 0, target: 0, speed: 0, dist: 0, travelled: 0, lean: 0, steerA: 0, pitch: 0, air: false, vy: 0, y: 0, squash: 0, lap: 0, lapTime: 0, best: 0, running: false, done: false, finishT: 0 }); P.first = true; }
    raceTime = 0; winner = -1; $('banner').innerHTML = '';
    if (raceState !== 'idle') { raceState = 'countdown'; countdown = 3.99; lastBeep = 4; }
  }
  function startGame() {
    if (raceState !== 'idle') return;
    $('overlay').style.display = 'none'; audio.start();
    raceState = 'countdown'; countdown = 3.99; lastBeep = 4;
  }
  const keyMap = { KeyW: 0, ArrowUp: 1 };
  function setPedal(i, v) { players[i].pedal = v; const b = players[i].btn; if (b) b.classList.toggle('down', v); }
  function releasePedal(i) { const P = players[i]; if (!P.pedal) return; setPedal(i, false); if (P.S.rev > 0.5 && audio.ctx) audio.pops(i ? 0.5 : -0.5); }
  window.addEventListener('keydown', e => {
    if (e.code in keyMap) { if (raceState === 'idle') startGame(); setPedal(keyMap[e.code], true); e.preventDefault(); }
    else if (e.code === 'KeyR') resetRace();
    else if (e.code === 'KeyM') toggleMute();
    else if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!paused);
    else if (['Space', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { if (e.code in keyMap) releasePedal(keyMap[e.code]); });
  window.addEventListener('blur', () => players.forEach((_, i) => releasePedal(i)));
  $('overlay').addEventListener('pointerdown', startGame);
  let paused = false;
  function setPaused(v) {
    if (raceState === 'idle') return; paused = v; $('pause').classList.toggle('on', v);
    if (audio.ctx) { v ? audio.ctx.suspend() : audio.ctx.resume(); }
  }
  const toggleMute = () => { if (audio.ctx) audio.setMuted(!audio.muted); else audio.muted = !audio.muted; $('bMute').classList.toggle('off', audio.muted); };
  $('bPause').onclick = () => setPaused(!paused); $('pResume').onclick = () => setPaused(false);
  $('bRestart').onclick = $('pRestart').onclick = () => { setPaused(false); resetRace(); };
  $('bMute').onclick = $('pMute').onclick = toggleMute;
  function showWinner() { const c = players[winner].C; $('banner').innerHTML = `<div><div class="b1" style="color:${c.css}">PLAYER ${winner + 1} WINS</div><div class="b2">PRESS R TO RACE AGAIN</div></div>`; }

  // ------------------------------------------------------------------ HUD
  players.forEach((P, i) => {
    const el = document.createElement('div'); el.className = 'card'; el.style.setProperty('--c', P.C.css);
    el.innerHTML = `<div class="head"><span class="badge">P${i + 1}</span><span class="nm">PLAYER ${i + 1}</span><span class="pos"></span><span class="stripes"></span></div>
      <div class="body"><div class="gauge"><svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="40"/><circle class="val" cx="50" cy="50" r="40"/></svg><div class="num"><b>0</b><i>km/h</i></div></div>
      <div class="sep"></div><div class="tm"><div class="lb">&#9201; TIME</div><div class="t">00:00.00</div><div class="sub"><span class="lap">LAP 1/${CFG.laps}</span><span class="rpm">0 RPM</span></div></div></div>
      <div class="st">HOLD ${P.C.key} TO PEDAL</div>`;
    document.body.appendChild(el);
    const btn = document.createElement('button'); btn.className = 'pedal'; btn.style.setProperty('--c', P.C.css); btn.type = 'button'; btn.textContent = `P${i + 1} · HOLD ${P.C.key}`;
    btn.addEventListener('pointerdown', e => { e.preventDefault(); if (raceState === 'idle') startGame(); setPedal(i, true); btn.setPointerCapture && btn.setPointerCapture(e.pointerId); });
    ['pointerup', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => releasePedal(i)));
    document.body.appendChild(btn); P.btn = btn;
    P.hud = { el, pos: el.querySelector('.pos'), st: el.querySelector('.st'), rpm: el.querySelector('.rpm'), lap: el.querySelector('.lap'), time: el.querySelector('.t'), val: el.querySelector('.val'), big: el.querySelector('.num b') };
  });
  let rects = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }];
  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight, side = W / H > 1.25;
    const cssRects = side ? [{ x: 0, y: 0, w: Math.floor(W / 2) - 1, h: H }, { x: Math.ceil(W / 2) + 1, y: 0, w: W - Math.ceil(W / 2) - 1, h: H }]
                          : [{ x: 0, y: 0, w: W, h: Math.floor(H / 2) - 1 }, { x: 0, y: Math.ceil(H / 2) + 1, w: W, h: H - Math.ceil(H / 2) - 1 }];
    renderer.setSize(Math.round(W * dpr), Math.round(H * dpr), false);
    rects = cssRects.map(r => ({ x: Math.round(r.x * dpr), y: Math.round(r.y * dpr), w: Math.round(r.w * dpr), h: Math.round(r.h * dpr) }));
    views.forEach((v, i) => v.setRect(rects[i].x, rects[i].y, rects[i].w, rects[i].h));
    const dv = $('divider');
    if (side) Object.assign(dv.style, { left: (W / 2 - 1) + 'px', top: 0, width: '3px', height: '100%' }); else Object.assign(dv.style, { left: 0, top: (H / 2 - 1) + 'px', width: '100%', height: '3px' });
    players.forEach((P, i) => {
      const r = cssRects[i], h = P.hud;
      const top = (r.y + 12) + 'px';
      if (side && i === 1) { h.el.style.left = 'auto'; h.el.style.right = '12px'; } else { h.el.style.right = 'auto'; h.el.style.left = (r.x + 12) + 'px'; }
      h.el.style.top = top;
      if (side && i === 1) { P.btn.style.left = 'auto'; P.btn.style.right = '12px'; } else { P.btn.style.right = 'auto'; P.btn.style.left = (r.x + 12) + 'px'; }
      P.btn.style.bottom = (H - r.y - r.h + 12) + 'px';
    });
  }
  window.addEventListener('resize', layout);

  // minimap
  const mini = $('mini'), mg = mini.getContext('2d'), track = []; for (let d = 0; d < L; d += 4) { const p = pointAt(d); track.push([p.x, p.z]); }
  const mxs = track.map(p => p[0]), mzs = track.map(p => p[1]), minX = Math.min(...mxs), maxX = Math.max(...mxs), minZ = Math.min(...mzs), maxZ = Math.max(...mzs);
  const msc = Math.min((mini.width - 24) / (maxX - minX), (mini.height - 24) / (maxZ - minZ)), mp = (x, z) => [12 + (x - minX) * msc, mini.height - 12 - (z - minZ) * msc];
  function drawMini() {
    mg.clearRect(0, 0, mini.width, mini.height); mg.lineWidth = 4; mg.strokeStyle = 'rgba(255,255,255,.92)'; mg.lineJoin = 'round'; mg.beginPath();
    track.forEach(([x, z], i) => { const [a, b] = mp(x, z); i ? mg.lineTo(a, b) : mg.moveTo(a, b); }); mg.closePath(); mg.stroke();
    mg.fillStyle = '#d9a066'; for (const l of LIPS) { const p = pointAt(l), [a, b] = mp(p.x, p.z); mg.fillRect(a - 3, b - 3, 6, 6); }
    for (const P of players) { const p = pointAt(P.S.dist), [bx, by] = mp(p.x, p.z); mg.fillStyle = P.C.css; mg.beginPath(); mg.arc(bx, by, 5, 0, 7); mg.fill(); mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.stroke(); }
  }
  function updateHud() {
    const prog = players.map(P => P.S.done ? 1e6 - P.S.finishT : P.S.lap * L + P.S.dist);
    players.forEach((P, i) => {
      const S = P.S, h = P.hud, ahead = prog[i] >= prog[1 - i];
      h.pos.textContent = (S.running || players[1 - i].S.running) ? (prog[i] === prog[1 - i] ? '' : ahead ? '1ST' : '2ND') : '';
      h.rpm.textContent = S.rpm.toFixed(0) + ' RPM'; h.lap.textContent = 'LAP ' + Math.min(S.lap + 1, CFG.laps) + '/' + CFG.laps;
      h.time.textContent = fmt(S.lapTime); h.big.textContent = Math.round(S.speed);
      h.val.style.strokeDasharray = (188.5 * clamp(S.speed / CFG.maxKmh, 0, 1)).toFixed(1) + ' 251.3';
      h.st.textContent = S.done ? 'FINISHED  ' + fmt(S.finishT) : raceState === 'countdown' ? 'GET READY' : P.pedal ? 'PEDALLING' : (S.rpm > 1 ? 'COASTING' : `HOLD ${P.C.key} TO PEDAL`);
    });
  }

  // ------------------------------------------------------------------ simulation
  // ---- optional real-bike input: bridge.py pushes {"rpm":N,"player":0|1} over ws://127.0.0.1:8765
  const ext_ = [null, null];
  function connectBridge() {
    let ws; try { ws = new WebSocket('ws://127.0.0.1:8765'); } catch (e) { return; }
    ws.onmessage = ev => { try { const d = JSON.parse(ev.data), i = d.player | 0; if (i === 0 || i === 1) { ext_[i] = { rpm: +d.rpm || 0, t: performance.now() }; const b = $('bridge'); if (b) b.textContent = 'BIKE LINK ●'; } } catch (e) {} };
    ws.onclose = () => { const b = $('bridge'); if (b) b.textContent = ''; setTimeout(connectBridge, 2000); };
    ws.onerror = () => ws.close();
  }
  connectBridge();

  const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0);
  const qBasis = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), mBasis = new THREE.Matrix4(), X_AXIS = new THREE.Vector3(1, 0, 0);
  const r2 = new THREE.Vector3(), u2 = new THREE.Vector3(), b2 = new THREE.Vector3(), desired = new THREE.Vector3(), lookT = new THREE.Vector3(), tmp = new THREE.Vector3();

  function stepPlayer(P, dt, active) {
    const S = P.S, parts = P.parts, pan = P.id ? 0.5 : -0.5;
    const pedalling = active && P.pedal && !S.done;
    const ext = ext_[P.id];
    if (ext && performance.now() - ext.t < 1500) {            // real cycle: measured cadence drives the bike
      const tgt = active && !S.done ? clamp(ext.rpm, 0, 120) : 0;
      S.rpm = damp(S.rpm, tgt, 4, dt); P.pedal = tgt > 3;
    } else S.rpm = pedalling ? Math.min(S.rpm + 45 * dt, 90) : Math.max(S.rpm - (S.done ? 18 : 25) * dt, 0);
    S.target = clamp(S.rpm * CFG.kmhPerRpm, 0, CFG.maxKmh);
    S.speed = moveToward(S.speed, S.target, (S.target > S.speed ? CFG.accel : CFG.decel) * dt);
    if (S.speed < 0.05 && S.target < 0.05) S.speed = 0;
    const v = S.speed / 3.6, prev = S.dist;
    S.dist += v * dt; S.travelled += v * dt;
    let wrapped = false;
    if (S.dist >= L) {
      S.dist -= L; wrapped = true;
      if (S.running && !S.done) { S.lap++; if (S.best <= 0 || S.lapTime < S.best) S.best = S.lapTime; if (S.lap >= CFG.laps) { S.done = true; S.finishT = raceTime; if (winner < 0) { winner = P.id; showWinner(); } } }
      S.lapTime = 0;
    }
    if (S.speed > 0.5 && active) S.running = true;
    if (S.running && !S.done) S.lapTime += dt;

    // ground contact / take-off
    const lane = P.C.lane, prof = crossProfile(lane), gy = groundH(S.dist) * prof;
    if (!S.air) {
      S.y = gy;
      if (S.speed > 12) for (const lip of LIPS) {
        const crossed = wrapped ? (lip > prev || lip <= S.dist) : (prev < lip && S.dist >= lip);
        if (crossed) { S.air = true; S.vy = v * slopeAt(lip) * prof * 0.92; S.y = groundH(lip) * prof; break; }
      }
    }
    if (S.air) {
      S.vy -= CFG.gravity * dt; S.y += S.vy * dt;
      const g2 = groundH(S.dist) * prof;
      if (S.y <= g2) {
        const impact = -S.vy; S.air = false; S.y = g2; S.vy = 0; S.squash = clamp(impact / 6, 0.2, 1); S.shake = clamp(impact / 14, 0.05, 0.5);
        audio.thump(pan, clamp(impact / 7, 0.3, 1.2));
        const p = pointAt(S.dist), t = tangentAt(S.dist);
        for (let k = 0; k < 40; k++) { const a = Math.random() * 6.28, sp = rand(1.5, 5); emit(p.x - t.z * lane, 0.2 + g2, p.z + t.x * lane, Math.cos(a) * sp, rand(0.6, 2.4), Math.sin(a) * sp, rand(0.8, 1.6), rand(0.9, 1.7), DUST); }
        for (let k = 0; k < 26; k++) { const a = Math.random() * 6.28, sp = rand(2, 6.5); emit(p.x - t.z * lane, 0.15 + g2, p.z + t.x * lane, Math.cos(a) * sp, rand(2.5, 5.5), Math.sin(a) * sp, rand(0.5, 1.0), rand(0.05, 0.1), MUD, 9.8); }
      }
    }
    let y = S.y;
    if (S.squash > 0) S.squash = Math.max(0, S.squash - dt * 4);

    // pose
    const p = pointAt(S.dist), f = tangentAt(S.dist);
    fwd.copy(f); rgt.set(-f.z, 0, f.x);
    const look = Math.max(6, v * 1.2), fa = tangentAt(S.dist + look);
    const ang = Math.atan2(f.x * fa.z - f.z * fa.x, f.x * fa.x + f.z * fa.z), kappa = ang / look, lat = v * v * kappa, maxL = CFG.maxLeanDeg * Math.PI / 180;
    S.lean = damp(S.lean, clamp(Math.atan(lat / 9.81) * 0.6, -maxL, maxL), 6, dt);
    S.steerA = damp(S.steerA, clamp(-kappa * 5, -0.45, 0.45), 8, dt);
    const pitchT = S.air ? Math.atan2(S.vy, Math.max(v, 1)) : Math.atan(slopeAt(S.dist) * prof);
    S.pitch = damp(S.pitch, pitchT, S.air ? 3.5 : 12, dt);
    const cs = Math.cos(S.lean), sn = Math.sin(S.lean);
    r2.copy(rgt).multiplyScalar(cs).addScaledVector(upV, -sn); u2.copy(upV).multiplyScalar(cs).addScaledVector(rgt, sn); b2.copy(fwd).negate();
    mBasis.makeBasis(r2, u2, b2); qBasis.setFromRotationMatrix(mBasis); qPitch.setFromAxisAngle(X_AXIS, S.pitch);
    parts.bike.quaternion.copy(qBasis).multiply(qPitch);
    const wx = p.x + rgt.x * lane, wz = p.z + rgt.z * lane, sink = S.squash * 0.05;
    parts.bike.position.set(wx, y - sink + 0.0, wz);
    P.pos.set(wx, y, wz); P.fwd.copy(fwd);
    parts.setSteer(S.steerA);
    P.crank += S.rpm * Math.PI * 2 / 60 * dt;
    const sa = clamp(S.speed / CFG.maxKmh, 0, 1), sq = S.squash;
    parts.setCompression(sq * 0.9 + (S.air ? -0.2 : 0), sq);
    parts.rider.rotation.x = -0.04 - 0.05 * sa - (S.air ? 0.05 : 0) + Math.sin(P.crank * 2) * 0.008 * (S.rpm > 5 ? 1 : 0);
    parts.rider.position.y = -0.04 * sq + Math.sin(P.crank * 2) * 0.008 + (S.air ? 0.02 : 0);
    const spin = (v / WR) * dt; parts.wheelF.rotation.x -= spin; parts.wheelR.rotation.x -= spin;
    // wobble in the ruts
    if (!S.air && S.speed > 5) parts.body.rotation.z = Math.sin(P.crank * 3.1 + P.id) * 0.012 * sa; else parts.body.rotation.z *= 0.9;
    updateShadow(P, wx, wz, Math.atan2(-f.x, -f.z), groundH(S.dist) * prof);

    // dust + roost
    if (!S.air && S.speed > 6) {
      const boost = clamp((S.target - S.speed) / 20, 0, 1);
      S.acc += (10 + S.speed * 1.1 + boost * 50) * dt;
      while (S.acc >= 1) {
        S.acc -= 1;
        emit(wx - f.x * 0.8 + rand(-0.15, 0.15), 0.12 + y, wz - f.z * 0.8 + rand(-0.15, 0.15), -f.x * v * rand(0.12, 0.4) + rand(-0.6, 0.6), rand(0.8, 2.3) + boost * 1.2, -f.z * v * rand(0.12, 0.4) + rand(-0.6, 0.6), rand(0.6, 1.4), rand(0.4, 0.8), DUST);
        if (Math.random() < 0.22 + boost * 0.5) emit(wx - f.x * 0.75, 0.1 + y, wz - f.z * 0.75, -f.x * v * rand(0.3, 0.6) + rand(-1, 1), rand(1.8, 4.2), -f.z * v * rand(0.3, 0.6) + rand(-1, 1), rand(0.4, 0.8), rand(0.04, 0.08), MUD, 9.8);
      }
    }
    // engine revs
    const revT = clamp(0.12 + 0.88 * clamp(S.rpm / 80, 0, 1), 0, 1);
    S.rev = damp(S.rev, revT, revT > S.rev ? 7 : 2.5, dt);
    if (audio.engines[P.id]) audio.engines[P.id].update(S.rev, sa);

    // chase camera
    const cam = P.cam;
    cam.fov = lerp(58, 74, sa); cam.updateProjectionMatrix();
    desired.set(wx, 0, wz).addScaledVector(fwd, -(5.6 + sa * 1.5)).add(tmp.set(0, 2.15 + sa * 0.35 + y * 0.4, 0));
    lookT.set(wx, 1.15 + y * 0.6, wz).addScaledVector(fwd, 5.5);
    if (P.first) { P.camPos.copy(desired); P.camLook.copy(lookT); P.first = false; }
    P.camPos.lerp(desired, 1 - Math.exp(-9 * dt)); P.camLook.lerp(lookT, 1 - Math.exp(-10 * dt));
    S.shake = Math.max(0, S.shake - dt * 1.8);
    cam.position.copy(P.camPos).add(tmp.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(S.shake * 0.25 + (S.air ? 0 : sa * 0.004)));
    cam.position.y = Math.max(cam.position.y, world.heightAt(cam.position.x, cam.position.z) + 0.6);
    cam.lookAt(P.camLook); cam.updateMatrixWorld();
    P.sa = sa;
  }

  function stepAll(dt) {
    if (raceState === 'countdown') {
      countdown -= dt; const n = Math.ceil(countdown);
      if (n !== lastBeep && n >= 1 && n <= 3) { lastBeep = n; audio.beep(520, 0.15); }
      if (countdown > 0) $('banner').innerHTML = `<div class="hex">${n}</div>`;
      if (countdown <= 0) { raceState = 'racing'; audio.beep(900, 0.5); $('banner').innerHTML = '<div class="hex" style="font-size:48px">GO!</div>'; setTimeout(() => { if (raceState === 'racing' && winner < 0) $('banner').innerHTML = ''; }, 800); }
    }
    const active = raceState === 'racing';
    if (active) raceTime += dt;
    for (const P of players) stepPlayer(P, dt, active);
    updateParticles(dt);
  }

  // ------------------------------------------------------------------ frame: sim + render both viewports (+ adaptive resolution)
  let tClock = 0, acc = 0, nAcc = 0, scaleNow = q.scale, uiTimer = 0;
  function frame(dt, t) {
    tClock = t; shared.uTime.value = t;
    if (!paused) stepAll(dt);
    shared.uBike0.value.set(players[0].pos.x, players[0].pos.y, players[0].pos.z, 0); shared.uBike1.value.set(players[1].pos.x, players[1].pos.y, players[1].pos.z, 0);
    veg.update(players.map(P => P.cam.position));
    renderer.info.reset(); renderer.setRenderTarget(null); renderer.setClearColor(0x050607, 1); renderer.clear(true, false, false);
    players.forEach((P, i) => {
      const v = views[i]; v.p.blur = 0.028 * Math.pow(P.sa, 1.6); v.p.fade = 1;
      dustMat.uniforms.scale.value = v.ih * 0.95;
      v.render(scene, P.cam, sky.sunSky, t, renderer.domElement.height);
    });
    uiTimer += dt; if (uiTimer > 0.05) { uiTimer = 0; updateHud(); drawMini(); }
    // dynamic resolution
    acc += dt; nAcc++;
    if (nAcc >= 40) {
      const avg = acc / nAcc; acc = 0; nAcc = 0;
      if (avg > 0.026 && scaleNow > 0.5) scaleNow = Math.max(0.5, scaleNow - 0.08); else if (avg < 0.0185 && scaleNow < q.scale) scaleNow = Math.min(q.scale, scaleNow + 0.04);
      views.forEach(v => v.setScale(scaleNow));
    }
  }

  layout(); updateHud(); drawMini();
  window.__vyora = { stepAll, players, CFG, L, get state() { return raceState; }, press: (i, v) => { if (v && raceState === 'idle') startGame(); setPedal(i, v); }, groundH };
  return { frame, stepAll, players, layout, startGame, resetRace, get state() { return raceState; } };
}
