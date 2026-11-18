// Sky dome (real HDRI, bicubic-filtered), image-based lighting and the sun light with a baked shadow map.
import * as THREE from 'three';
import { shared } from './shaderlib.js';

export function createSky(renderer, scene, A, P) {
  const meta = A.sky, sc = A.scatter;
  const az = THREE.MathUtils.degToRad(sc.sun.az), el = THREE.MathUtils.degToRad(sc.sun.el), elSky = THREE.MathUtils.degToRad(meta.sunEl);
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));          // light direction (slightly raised)
  const sunSky = new THREE.Vector3(Math.cos(elSky) * Math.cos(az), Math.sin(elSky), Math.cos(elSky) * Math.sin(az)); // where the sun is visible
  shared.uSunDir.value.copy(sunDir);

  // ---- visible sky
  const tex = A.skyTex;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSky: { value: tex }, uSize: { value: new THREE.Vector2(tex.image.width, tex.image.height) }, uGain: { value: P.skyGain }, uSun: { value: sunSky }, uSunBoost: { value: P.sunBoost } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = ( projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 ) ).xyww; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uSky; uniform vec2 uSize; uniform float uGain; uniform vec3 uSun; uniform float uSunBoost;
      varying vec3 vDir;
      vec4 cubic(float v) { vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v; vec4 s = n * n * n; float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x, w = 6.0 - x - y - z; return vec4(x, y, z, w) / 6.0; }
      vec3 bicubic(vec2 uv) {
        vec2 tc = uv * uSize - 0.5; vec2 f = fract(tc); tc -= f;
        vec4 xc = cubic(f.x), yc = cubic(f.y);
        vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
        vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
        vec4 o = c + vec4(xc.yw, yc.yw) / s;
        o /= uSize.xxyy;
        vec3 s0 = texture2D(uSky, o.xz).rgb, s1 = texture2D(uSky, o.yz).rgb, s2 = texture2D(uSky, o.xw).rgb, s3 = texture2D(uSky, o.yw).rgb;
        float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
        return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
      }
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = vec2(atan(d.z, d.x) / 6.28318530718 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
        vec3 c = bicubic(uv) * uGain;
        // the photographed sun is clipped: add back a small hot core so it blooms like the real thing
        float sd = max(dot(d, uSun), 0.0);
        c += vec3(1.0, 0.82, 0.55) * uSunBoost * (pow(sd, 9000.0) * 60.0 + pow(sd, 900.0) * 2.5);
        gl_FragColor = vec4(c, 0.0);
      }`,
    depthWrite: false, depthFunc: THREE.LessEqualDepth, blending: THREE.NoBlending, fog: false, side: THREE.BackSide
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  dome.frustumCulled = false; dome.renderOrder = 1000; dome.matrixAutoUpdate = false;
  scene.add(dome);

  // ---- image-based lighting
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(A.iblTex).texture;
  scene.environment = env; scene.environmentIntensity = P.envIntensity;
  pm.dispose();

  // ---- sun
  const sunColor = new THREE.Color(P.sunColor[0], P.sunColor[1], P.sunColor[2]);
  const sun = new THREE.DirectionalLight(sunColor, P.sunIntensity);
  shared.uSunCol.value.copy(sunColor).multiplyScalar(P.sunIntensity);
  sun.castShadow = true;
  scene.add(sun, sun.target);

  // Fit the (static) shadow frustum to a set of receiver points given in world space.
  function fitShadow(points, mapSize, maxCasterDist = 150, heightMax = 4) {
    const center = new THREE.Vector3(); points.forEach(p => center.add(p)); center.multiplyScalar(1 / points.length);
    sun.target.position.copy(center); sun.position.copy(center).addScaledVector(sunDir, 400);
    sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position); cam.lookAt(center); cam.updateMatrixWorld();
    const inv = cam.matrixWorld.clone().invert(), v = new THREE.Vector3();
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of points) for (const h of [0, heightMax]) {
      v.set(p.x, p.y + h, p.z).applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    cam.left = minX; cam.right = maxX; cam.bottom = minY; cam.top = maxY;
    cam.near = Math.max(1, -maxZ - maxCasterDist); cam.far = -minZ + 12;
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(mapSize[0], mapSize[1]);
    sun.shadow.bias = -0.00006; sun.shadow.normalBias = 0.02; sun.shadow.radius = P.shadowRadius;
    sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    return { w: maxX - minX, h: maxY - minY, depth: cam.far - cam.near };
  }
  // after the first render the baked depth texture can be handed to the custom shaders
  function publishShadow() {
    if (sun.shadow.map && sun.shadow.map.depthTexture) {
      shared.uShadowMap.value = sun.shadow.map.depthTexture;
      shared.uShadowMat.value.copy(sun.shadow.matrix);
      shared.uShadowOn.value = 1;
      return true;
    }
    return false;
  }
  return { dome, sun, sunDir, sunSky, env, fitShadow, publishShadow, mat };
}
