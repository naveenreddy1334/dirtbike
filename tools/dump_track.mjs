import { makeCurve } from '../src/trackdef.js';
import fs from 'fs';
const c = makeCurve(); const L = c.getLength();
const N = 4000, pts = [], tans = [];
for (let i = 0; i < N; i++) { const p = c.getPointAt(i / N), t = c.getTangentAt(i / N); pts.push([+p.x.toFixed(4), +p.z.toFixed(4)]); tans.push([+t.x.toFixed(5), +t.z.toFixed(5)]); }
fs.writeFileSync('work/track.json', JSON.stringify({ L, pts, tans }));
// curvature profile every 5 m
let out = [];
for (let d = 0; d < L; d += 5) {
  const a = c.getTangentAt(d / L), b = c.getTangentAt(((d + 4) % L) / L);
  const ang = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  out.push(`${d.toFixed(0)}:${(ang / 4 * 1000).toFixed(0)}`);
}
console.log('L', L.toFixed(2)); console.log('curv(1/km) per 5m:', out.join(' '));
