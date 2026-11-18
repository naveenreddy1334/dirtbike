// Shared GLSL and global shader-chunk overrides (atmospheric fog, better shadow filtering).
import * as THREE from 'three';

// uniforms shared by reference between many materials
export const shared = {
  uTime: { value: 0 },
  uDynMap0: { value: null }, uDynMat0: { value: new THREE.Matrix4() },
  uDynMap1: { value: null }, uDynMat1: { value: new THREE.Matrix4() },
  uDynOn: { value: new THREE.Vector2(0, 0) },
  uBike0: { value: new THREE.Vector4(0, -100, 0, 0) },     // xyz = contact point, w = heading
  uBike1: { value: new THREE.Vector4(0, -100, 0, 0) },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 1.0, 0.0) }, // xy = direction, z = strength
  uShadowMap: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
  uAmbSky: { value: new THREE.Color(1, 1, 1) }, uAmbGround: { value: new THREE.Color(0.2, 0.2, 0.2) }
};

export const NOISE_GLSL = /* glsl */`
float vyHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vyHash3(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vyNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(vyHash(i), vyHash(i+vec2(1,0)), f.x), mix(vyHash(i+vec2(0,1)), vyHash(i+vec2(1,1)), f.x), f.y); }
float vyFbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vyNoise(p); p = p * 2.03 + 17.7; a *= 0.5; } return s; }
float vyIGN(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

let FOG_FUNC = '';
export function fogGLSL() { return FOG_FUNC; }

const v3 = c => `vec3(${c[0].toFixed(4)},${c[1].toFixed(4)},${c[2].toFixed(4)})`;

// Height fog with a sky-coloured in-scatter term taken from the HDRI horizon (so distance fades into the real sky).
export function buildFog(sky, P) {
  const hz = sky.horizon, hi = sky.horizonHi;
  FOG_FUNC = /* glsl */`
const vec3 VY_HZ[16] = vec3[16](${hz.map(v3).join(',')});
const vec3 VY_HI[16] = vec3[16](${hi.map(v3).join(',')});
vec3 vyRing(vec3 dir, bool high) {
  float f = fract(atan(dir.z, dir.x) / 6.28318530718 + 0.5) * 16.0; int i = int(f); float t = f - float(i); t = t*t*(3.0-2.0*t);
  int i0 = i & 15, i1 = (i + 1) & 15;
  return high ? mix(VY_HI[i0], VY_HI[i1], t) : mix(VY_HZ[i0], VY_HZ[i1], t);
}
vec3 vyFogColor(vec3 dir) {
  vec3 lo = vyRing(dir, false), up = vyRing(dir, true);
  vec3 c = mix(lo, up, smoothstep(0.02, 0.22, dir.y));
  // the glow right at the sun is far brighter than what the air scatters back: compress it
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return c * (${P.fogGain.toFixed(3)} / (1.0 + l * ${P.fogCompress.toFixed(3)}));
}
float vyFogT(vec3 cam, vec3 wp, float d) {
  float h0 = cam.y, h1 = wp.y, dh = h1 - h0;
  float k = ${(1 / P.fogH).toFixed(6)}, k2 = ${(1 / P.mistH).toFixed(6)};
  float a = abs(dh) > 0.05 ? (exp(-k * h0) - exp(-k * h1)) / (k * dh) : exp(-k * h0);
  float b = abs(dh) > 0.05 ? (exp(-k2 * h0) - exp(-k2 * h1)) / (k2 * dh) : exp(-k2 * h0);
  return exp(-d * (${P.fogDensity.toExponential(4)} * a + ${P.mistDensity.toExponential(4)} * max(b, 0.0)));
}
vec3 vyApplyFog(vec3 col, vec3 cam, vec3 wp) {
  vec3 v = wp - cam; float d = length(v);
  float T = vyFogT(cam, wp, d);
  return col * T + vyFogColor(v / max(d, 1e-3)) * (1.0 - T);
}
`;
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogWorld;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n varying vec3 vFogWorld;\n${FOG_FUNC}\n#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG\n gl_FragColor.rgb = vyApplyFog( gl_FragColor.rgb, cameraPosition, vFogWorld );\n#endif`;
}

// Replace three's PCF lookup with a wider Vogel-disc filter that uses receiver-plane depth bias
// (needed for a sun 12 degrees above the horizon: a constant bias would detach every shadow).
export function installShadowFilter() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const start = chunk.indexOf('float getShadow( sampler2DShadow shadowMap');
  const end = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  if (start < 0 || end < 0) { console.warn('shadow chunk layout changed; keeping the default filter'); return; }
  const fn = /* glsl */`float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( inFrustum && shadowCoord.z <= 1.0 ) {
				vec3 dx = dFdx( shadowCoord.xyz ), dy = dFdy( shadowCoord.xyz );
				float det = dx.x * dy.y - dx.y * dy.x;
				vec2 dz = abs( det ) > 1e-14 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
				vec2 radius = shadowRadius / shadowMapSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				float s = 0.0;
				for ( int i = 0; i < 8; i ++ ) {
					vec2 o = vogelDiskSample( i, 8, phi ) * radius;
					s += texture( shadowMap, vec3( shadowCoord.xy + o, shadowCoord.z + clamp( dot( dz, o ), -0.004, 0.004 ) ) );
				}
				shadow = s * 0.125;
				vec2 e = smoothstep( vec2( 0.0 ), vec2( 0.03 ), shadowCoord.xy ) * ( 1.0 - smoothstep( vec2( 0.97 ), vec2( 1.0 ), shadowCoord.xy ) );
				shadow = mix( 1.0, shadow, e.x * e.y );
			}
			return mix( 1.0, shadow, shadowIntensity );
		}

	`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + fn + chunk.slice(end);
}

// dynamic (per-bike) shadow lookup used by patched materials
export const DYN_SHADOW_GLSL = /* glsl */`
uniform highp sampler2DShadow uDynMap0; uniform highp sampler2DShadow uDynMap1;
uniform mat4 uDynMat0; uniform mat4 uDynMat1; uniform vec2 uDynOn;
float vyDynIGN(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float vyDyn1(highp sampler2DShadow m, mat4 M, vec3 wp, float bias) {
  vec4 sc = M * vec4(wp, 1.0);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 1.0;
  float pen = 0.0016 + max(sc.z - 0.262, 0.0) * 0.11;
  float phi = vyDynIGN(gl_FragCoord.xy) * 6.2831853, s = 0.0;
  for (int i = 0; i < 8; i++) { float r = sqrt((float(i) + 0.5) / 8.0), th = float(i) * 2.39996323 + phi; s += texture(m, vec3(sc.xy + vec2(cos(th), sin(th)) * r * pen, sc.z - bias)); }
  vec2 e = smoothstep(vec2(0.0), vec2(0.05), sc.xy) * (1.0 - smoothstep(vec2(0.95), vec2(1.0), sc.xy));
  return mix(1.0, s * 0.125, e.x * e.y);
}
float vyDynShadow(vec3 wp, vec3 nW, float bias) {
  vec3 p = wp + nW * 0.012; float s = 1.0;
  if (uDynOn.x > 0.5) s *= vyDyn1(uDynMap0, uDynMat0, p, bias);
  if (uDynOn.y > 0.5) s *= vyDyn1(uDynMap1, uDynMat1, p, bias);
  return s;
}
`;

// static shadow lookup for fully custom shaders (grass, particles, impostors)
export const STATIC_SHADOW_GLSL = /* glsl */`
uniform highp sampler2DShadow uShadowMap; uniform mat4 uShadowMat; uniform float uShadowOn;
float vyStaticShadow(vec3 wp) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(wp, 1.0);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float s = texture(uShadowMap, vec3(sc.xy, sc.z - 0.0009));
  vec2 e = smoothstep(vec2(0.0), vec2(0.03), sc.xy) * (1.0 - smoothstep(vec2(0.97), vec2(1.0), sc.xy));
  return mix(1.0, s, e.x * e.y);
}
`;

const LFB = () => THREE.ShaderChunk.lights_fragment_begin;

// Patch a built-in lit material: adds a world-position varying, the dynamic bike shadows and optional hooks.
export function patchStandard(mat, o = {}) {
  const key = o.key || 'vy';
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uDynMap0', 'uDynMat0', 'uDynMap1', 'uDynMat1', 'uDynOn', 'uTime', 'uBike0', 'uBike1', 'uWind']) sh.uniforms[k] = shared[k];
    if (o.uniforms) Object.assign(sh.uniforms, o.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime; uniform vec4 uWind;\n' + (o.vPars || ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (o.vBegin || ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n' + (o.vEnd || ''));
    if (o.vNormal) sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + o.vNormal);
    let fs = sh.fragmentShader;
    fs = fs.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime; uniform vec4 uBike0; uniform vec4 uBike1;\n' + DYN_SHADOW_GLSL + NOISE_GLSL + (o.fPars || ''));
    if (o.fBegin) fs = fs.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + o.fBegin);
    if (o.fColor) fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n' + o.fColor);
    if (o.fRough) fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + o.fRough);
    if (o.fMetal) fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + o.fMetal);
    if (o.fNormal) fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + o.fNormal);
    const dyn = o.dyn === false ? '' : ` * vyDynShadow( vWPos, inverseTransformDirection( normal, viewMatrix ), ${(o.dynBias || 0.0012).toFixed(5)} )`;
    fs = fs.replace('#include <lights_fragment_begin>', `float vySun = (${o.sunVis || '1.0'})${dyn};\n` +
      LFB().replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vySun;'));
    if (o.ao) fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n float vyAo = ${o.ao};\n reflectedLight.indirectDiffuse *= vyAo; reflectedLight.indirectSpecular *= vyAo * vyAo;`);
    if (o.fEnd) fs = fs.replace('#include <opaque_fragment>', o.fEnd + '\n#include <opaque_fragment>');
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
