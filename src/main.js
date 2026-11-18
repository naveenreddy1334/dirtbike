import * as THREE from 'three';
import { QUALITY, pickQuality, CFG } from './config.js';
import { loadAssets } from './loader.js';
import { buildFog, installShadowFilter, shared } from './shaderlib.js';
import { createSky } from './sky.js';
import { createWorld } from './world.js';
import { View } from './post.js';
import { createVegetation } from './veg.js';
import { makeBike } from './bike.js';
import { createGame } from './game.js';

const params = new URLSearchParams(location.search);
const LOOK = {
  skyGain: 1.0, sunBoost: 1.0, envIntensity: 1.0, sunColor: [1.0, 0.70, 0.42], sunIntensity: 9.5, shadowRadius: 2.2,
  fogDensity: 1.05e-4, fogH: 300, mistDensity: 1.4e-4, mistH: 10, fogGain: 0.62, fogCompress: 0.9,
  exposure: 0.80, bloom: 0.015
};

async function boot() {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: false });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false; renderer.info.autoReset = false;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  let qName = params.get('q') || 'auto'; if (!(qName in QUALITY)) qName = pickQuality(gpu);
  const q = QUALITY[qName];
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const shadowSize = [Math.min(q.shadow[0], maxTex), Math.min(q.shadow[1], maxTex)];
  const aniso = Math.min(q.aniso, renderer.capabilities.getMaxAnisotropy());

  const A = await loadAssets(aniso, (f) => { const el = document.getElementById('bar'); if (el) el.style.width = Math.round(f * 100) + '%'; });
  buildFog(A.sky, LOOK); installShadowFilter();

  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 1, 2);   // enables USE_FOG; the real fog lives in the shader chunk
  const sky = createSky(renderer, scene, A, LOOK);
  const world = createWorld(scene, A, LOOK, q);
  const veg = await createVegetation(scene, A, world, LOOK, q);

  // static shadow region: the track corridor
  const pts = []; for (let d = 0; d < world.L; d += 6) { const p = world.pointAt(d), t = world.tangentAt(d); for (const s of [-34, 0, 34]) pts.push(new THREE.Vector3(p.x - t.z * s, 0, p.z + t.x * s)); }
  const fit = sky.fitShadow(pts, shadowSize);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 12000);
  const views = [new View(renderer, q), new View(renderer, q)];
  views.forEach(v => { v.p.exposure = LOOK.exposure; v.p.bloom = LOOK.bloom; });
  const view = views[0];
  const game = createGame({ renderer, scene, world, sky, veg, q, LOOK, views, canvas });
  const cam = { pos: new THREE.Vector3(14, 2.6, 2.5), look: new THREE.Vector3(60, 1.0, -2) };
  let t = 0, shadowDone = false;
  function frame(dt) {
    t += dt; shared.uTime.value = t;
    veg.update([cam.pos]);
    camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.updateMatrixWorld();
    if (!shadowDone) { renderer.shadowMap.needsUpdate = true; }
    renderer.info.reset();
    renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
    view.render(scene, camera, sky.sunSky, t, renderer.domElement.height);
    if (!shadowDone) shadowDone = sky.publishShadow();
  }
  let last = performance.now(), running = !params.has('manual'), clock = 0;
  function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (running) { clock += dt; if (!shadowDone) renderer.shadowMap.needsUpdate = true; game.frame(dt, clock); if (!shadowDone) shadowDone = sky.publishShadow(); } requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  document.getElementById('loading').style.display = 'none';
  window.__vy = { game, views, makeBike, veg, THREE, renderer, scene, camera, cam, view, world, sky, frame, LOOK, gpu, qName, fit, info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length }), setRunning: v => running = v, ready: true };
}
boot().catch(e => { console.error(e); const el = document.getElementById('loadmsg'); if (el) el.textContent = 'Failed to start: ' + e.message; window.__vyError = String(e && e.stack || e); });
