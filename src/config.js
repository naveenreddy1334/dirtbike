export const CFG = {
  kmhPerRpm: 0.8, maxKmh: 65, accel: 10, decel: 4, maxLeanDeg: 34,
  laps: 3, gravity: 9.81, maxRpm: 90
};

// Rendering quality tiers. "auto" picks one from the GPU name, then dynamic resolution keeps the frame rate up.
export const QUALITY = {
  low:    { name: 'Low',    scale: 0.66, msaa: 0, shadow: [2048, 1024], grass: 0.30, grassDist: 70,  treeLod: 45,  bloom: 5, godrays: false, aniso: 4,  dynShadow: 512,  maxPixels: 1280 * 720 },
  medium: { name: 'Medium', scale: 0.85, msaa: 2, shadow: [4096, 2048], grass: 0.60, grassDist: 95,  treeLod: 70,  bloom: 6, godrays: false,  aniso: 8,  dynShadow: 1024, maxPixels: 1600 * 900 },
  high:   { name: 'High',   scale: 1.0,  msaa: 4, shadow: [8192, 4096], grass: 1.00, grassDist: 120, treeLod: 95,  bloom: 6, godrays: false,  aniso: 16, dynShadow: 1024, maxPixels: 1920 * 1080 },
  ultra:  { name: 'Ultra',  scale: 1.0,  msaa: 4, shadow: [8192, 4096], grass: 1.50, grassDist: 150, treeLod: 140, bloom: 7, godrays: false,  aniso: 16, dynShadow: 2048, maxPixels: 2560 * 1440 }
};

export function pickQuality(gpuName) {
  const g = (gpuName || '').toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
  if (/rtx|radeon rx (6|7|9)|rx (6|7|9)\d{3}|arc\(tm\) a7|apple m[2-9]|apple m1 (pro|max|ultra)|gtx 1(07|08)0|gtx 16[5-6]0 ti|titan/.test(g)) return 'high';
  if (/gtx|radeon|apple|arc|mx[1-5]|quadro|iris\(r\) xe|iris xe/.test(g)) return 'medium';
  if (/intel|uhd|hd graphics|mali|adreno|powervr/.test(g)) return 'low';
  return 'medium';
}
