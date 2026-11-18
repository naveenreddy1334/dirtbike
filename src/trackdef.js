// Shared track definition (used by the game and by the offline tools).
import * as THREE from 'three';

export const TRACK_PTS = [[0,0],[4000,-500],[8000,0],[10500,2500],[9500,6000],[6500,7500],[4000,6000],[2000,8500],[-1500,9000],[-4500,6500],[-4000,2500],[-2000,500]]
  .map(([x, y]) => new THREE.Vector3(x / 100, 0, y / 100));

export function makeCurve() {
  const c = new THREE.CatmullRomCurve3(TRACK_PTS, true, 'centripetal');
  c.arcLengthDivisions = 4000;
  return c;
}

export const TRACK = { half: 5.0, ribbonHalf: 6.5, lane: 1.6, tape: 7.2 };
// mud jumps: steep take-off face, long rolling back side
export const JUMPS = [
  { lip: 48, H: 1.5, up: 7.5, down: 15 },
  { lip: 145, H: 1.35, up: 7.0, down: 14 },
  { lip: 352, H: 1.6, up: 8.0, down: 16 }
];
// a set of rollers ("whoops")
export const WHOOPS = { start: 262, count: 5, len: 6.0, H: 0.5 };

function jumpH(d, j) {
  const a = d - (j.lip - j.up);
  if (a < 0 || a > j.up + j.down) return 0;
  if (d <= j.lip) return j.H * Math.pow(a / j.up, 1.7);
  return j.H * 0.5 * (1 + Math.cos(Math.PI * (d - j.lip) / j.down));
}
// longitudinal ground profile on the racing lines (metres), d in [0, L)
export function groundH(d) {
  let h = 0;
  for (const j of JUMPS) h = Math.max(h, jumpH(d, j));
  const w = d - WHOOPS.start;
  if (w > 0 && w < WHOOPS.count * WHOOPS.len) h = Math.max(h, WHOOPS.H * 0.5 * (1 - Math.cos(2 * Math.PI * w / WHOOPS.len)));
  return h;
}
// lateral falloff of the mounds towards the track edge (s = lateral offset in metres)
export function crossProfile(s) {
  const a = Math.abs(s), t = Math.min(1, Math.max(0, (a - 3.7) / (6.3 - 3.7)));
  return 1 - t * t * (3 - 2 * t);
}
