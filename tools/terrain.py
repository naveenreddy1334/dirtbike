# Offline terrain generation for VYORA Motocross.
# Produces: assets/terrain.bin (heights + baked light per vertex), assets/mask.png (near-field
# ground masks), assets/scatter.json (trees / rocks / bushes), plus previews.
import numpy as np, json, cv2, time, struct
from scipy.spatial import cKDTree
from scipy.ndimage import map_coordinates, gaussian_filter

t0 = time.time()
G = '/home/claude/game/'
tr = json.load(open(G + 'work/track.json'))
P = np.array(tr['pts'], np.float64); TAN = np.array(tr['tans'], np.float64); L = tr['L']
sky = json.load(open(G + 'work/sky.json'))
kd = cKDTree(P)
CX, CZ = 30.0, 42.0
SUN_AZ = np.radians(sky['sunAz']); LIGHT_EL = np.radians(12.0)
SUN_H = np.array([np.cos(SUN_AZ), np.sin(SUN_AZ)])          # horizontal unit vector towards the sun (x, z)

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# ------------------------------------------------------------------ noise helpers
def spectral(n, beta, seed, lo=0.0, hi=1e9):
    r = np.random.default_rng(seed)
    fx = np.fft.fftfreq(n)[:, None] * n; fy = np.fft.fftfreq(n)[None, :] * n
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    amp = f ** (-beta / 2); amp[0, 0] = 0
    amp[(f < lo) | (f > hi)] = 0
    x = np.fft.ifft2(amp * np.exp(1j * r.uniform(0, 2 * np.pi, (n, n)))).real
    return (x / x.std()).astype(np.float32)

def sample_tile(tex, x, z, tile, rot=0.0, ox=0.0, oz=0.0):
    n = tex.shape[0]; c, s = np.cos(rot), np.sin(rot)
    u = ((x * c - z * s) + ox) / tile * n; v = ((x * s + z * c) + oz) / tile * n
    return map_coordinates(tex, [v, u], order=1, mode='wrap')

N1 = spectral(1024, 3.3, 11); N2 = spectral(1024, 2.7, 12); N3 = spectral(512, 2.2, 13); N4 = spectral(1024, 3.0, 14)

# ------------------------------------------------------------------ far mountains (eroded)
FAR_R = 6400.0; FN = 512
ax = (np.arange(FN) + 0.5) / FN * 2 - 1
fx, fz = np.meshgrid(CX + ax * FAR_R, CZ + ax * FAR_R)          # fx varies along columns
rc = np.hypot(fx - CX, fz - CZ)
dirx, dirz = (fx - CX) / np.maximum(rc, 1), (fz - CZ) / np.maximum(rc, 1)
cs = dirx * SUN_H[0] + dirz * SUN_H[1]                           # cos(angle to sun azimuth)
gap = 1 - 0.86 * smooth(np.cos(np.radians(40)), np.cos(np.radians(13)), cs) - 0.45 * smooth(np.cos(np.radians(34)), np.cos(np.radians(10)), -cs)
def ridged(seed, bands, fall=0.45):
    out = np.zeros((FN, FN), np.float32); amp = 1.0; tot = 0
    for o, (lo, hi) in enumerate(bands):
        b = spectral(FN, 2.0, seed + o, lo, hi)
        out += amp * (1 - np.abs(np.tanh(b * 0.8))) ** 2; tot += amp; amp *= fall
    return out / tot
ridgeA = ridged(100, [(1.5, 4), (4, 9), (9, 20)])
ridgeB = ridged(140, [(1.0, 2.6), (2.6, 6), (6, 14), (14, 30)], 0.4)
warp = spectral(FN, 3.0, 120, 1, 6)
ramp1 = smooth(900, 2500, rc + warp * 240) * (1 - 0.6 * smooth(3000, 5200, rc))
ramp2 = smooth(2300, 5200, rc + warp * 300)
foot = smooth(170, 900, rc + warp * 120)
base = ((ramp1 * (20 + 210 * ridgeA ** 1.2) + ramp2 * (60 + 640 * ridgeB ** 1.5)) * gap
        + foot * (8 + 30 * (0.5 + 0.5 * spectral(FN, 2.6, 121, 3, 30))) * (0.3 + 0.7 * gap)).astype(np.float64)

def erode(h, iters, cell, K=0.22, m=0.5):
    n = h.shape[0]; offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    dist = np.array([np.hypot(a, b) for a, b in offs]) * cell
    idx = np.arange(n * n).reshape(n, n)
    for it in range(iters):
        hp = np.pad(h, 1, mode='edge'); best = np.zeros_like(h); rec = idx.copy()
        for k, (a, b) in enumerate(offs):
            nb = hp[1 + a:1 + a + n, 1 + b:1 + b + n]; s = (h - nb) / dist[k]
            ip = np.pad(idx, 1, mode='edge')[1 + a:1 + a + n, 1 + b:1 + b + n]
            better = s > best; best[better] = s[better]; rec[better] = ip[better]
        order = np.argsort(-h, axis=None).tolist(); area = [1.0] * (n * n); recf = rec.ravel(); recl = recf.tolist()
        for i in order:
            r = recl[i]
            if r != i: area[r] += area[i]
        A = np.array(area).reshape(n, n)
        dh = K * (A ** m) * best
        drop = (h - h.ravel()[recf].reshape(n, n))
        h = h - np.minimum(dh, drop * 0.85)
        if it % 6 == 5: h = 0.8 * h + 0.2 * gaussian_filter(h, 0.8)
    return h, A
keep = base.copy()
er, AREA = erode(base, 40, FAR_R * 2 / FN, K=0.10)
# keep the valley floor untouched, erosion only where the mountains are
far = np.where(rc < 300, keep, er * smooth(250, 700, rc) + keep * (1 - smooth(250, 700, rc)))
far = gaussian_filter(far, 1.25)
print('far terrain: max %.0f m, eroded in %.1fs' % (far.max(), time.time() - t0))

def far_h(x, z):
    u = (x - CX) / FAR_R * 0.5 + 0.5; v = (z - CZ) / FAR_R * 0.5 + 0.5
    return map_coordinates(far, [v * FN - 0.5, u * FN - 0.5], order=3, mode='nearest')

# ------------------------------------------------------------------ service road (two-track, towards the sun gap)
road = np.array([[-6, -19], [12, -27], [40, -36], [75, -54], [120, -92], [180, -132], [260, -176], [360, -250], [480, -330], [640, -420], [900, -560]], np.float64)
def densify(pl, step=1.0):
    out = []
    for a, b in zip(pl[:-1], pl[1:]):
        n = max(2, int(np.hypot(*(b - a)) / step)); t = np.linspace(0, 1, n, endpoint=False)[:, None]; out.append(a + (b - a) * t)
    return np.vstack(out + [pl[-1:]])
# smooth the road polyline a little
rd = densify(road, 2.0)
for _ in range(40): rd[1:-1] = 0.25 * rd[:-2] + 0.5 * rd[1:-1] + 0.25 * rd[2:]
rd = densify(rd, 0.5); kd_road = cKDTree(rd)
# paddock pad (flat dirt area beside the start straight, outside the loop)
PAD_C = np.array([22.0, -24.0]); PAD_R = np.array([26.0, 9.5])

def paddock(x, z):
    q = np.hypot((x - PAD_C[0]) / PAD_R[0], (z - PAD_C[1]) / PAD_R[1])
    return 1 - smooth(0.82, 1.18, q)

def track_dist(x, z):
    d, i = kd.query(np.stack([x.ravel(), z.ravel()], 1), workers=-1)
    return d.reshape(x.shape), i.reshape(x.shape)

def road_dist(x, z):
    d, _ = kd_road.query(np.stack([x.ravel(), z.ravel()], 1), workers=-1, distance_upper_bound=60)
    return np.minimum(d, 60).reshape(x.shape)

def height(x, z, return_parts=False):
    dT, _ = track_dist(x, z); dR = road_dist(x, z); pad = paddock(x, z)
    rcc = np.hypot(x - CX, z - CZ)
    hills = 7.5 * sample_tile(N1, x, z, 950.0, 0.3) + 1.7 * sample_tile(N4, x, z, 410.0, 1.1, 77, 31)
    und = 0.20 * sample_tile(N2, x, z, 96.0, 0.7) + 0.07 * sample_tile(N3, x, z, 23.0, 2.0)
    bowl = 0.00006 * np.clip(dT - 55, 0, 520) ** 2
    wh = smooth(18, 240, dT)
    nat = far_h(x, z) + wh * hills + bowl * (1 - 0.5 * smooth(0.2, 0.9, (x - CX) / np.maximum(rcc, 1) * SUN_H[0] + (z - CZ) / np.maximum(rcc, 1) * SUN_H[1])) + und * smooth(7.5, 16, dT)
    # flatten the road bed and the paddock
    flat_w = np.maximum(pad, 1 - smooth(1.6, 5.0, dR))
    lowf = far_h(x, z) + wh * 7.5 * sample_tile(N1, x, z, 950.0, 0.3) * 0.6
    nat = nat * (1 - flat_w * 0.85) + lowf * flat_w * 0.85
    h = -0.05 + (nat + 0.05) * smooth(7.2, 15.5, dT)
    if return_parts: return h, dT, dR, pad
    return h

# ------------------------------------------------------------------ warped render grid
N = 513; R0 = 5200.0; K = 4.9
tt = np.linspace(-1, 1, N)
rr = R0 * np.sinh(K * tt) / np.sinh(K)
gx, gz = np.meshgrid(CX + rr, CZ + rr)            # [row=z index, col=x index]
H, dT_v, dR_v, pad_v = height(gx, gz, True)
print('grid heights done %.1fs  range %.1f..%.1f' % (time.time() - t0, H.min(), H.max()))

# regular lookup grids for ray marching
NEAR_R = 1100.0; NN = 1536
na = (np.arange(NN) + 0.5) / NN * 2 - 1
nx, nz = np.meshgrid(CX + na * NEAR_R, CZ + na * NEAR_R)
Hn = height(nx, nz).astype(np.float32)
FAR2 = 1024
fa = (np.arange(FAR2) + 0.5) / FAR2 * 2 - 1
f2x, f2z = np.meshgrid(CX + fa * FAR_R, CZ + fa * FAR_R)
Hf = height(f2x, f2z).astype(np.float32)
np.savez(G + 'work/terrain_cache.npz', Hn=Hn, Hf=Hf)
print('lookup grids done %.1fs' % (time.time() - t0))

def hsample(x, z):
    un = (x - CX) / NEAR_R * 0.5 + 0.5; vn = (z - CZ) / NEAR_R * 0.5 + 0.5
    inside = (un > 0.002) & (un < 0.998) & (vn > 0.002) & (vn < 0.998)
    out = map_coordinates(Hf, [((z - CZ) / FAR_R * 0.5 + 0.5) * FAR2 - 0.5, ((x - CX) / FAR_R * 0.5 + 0.5) * FAR2 - 0.5], order=1, mode='nearest')
    if inside.any():
        out[inside] = map_coordinates(Hn, [vn[inside] * NN - 0.5, un[inside] * NN - 0.5], order=1, mode='nearest')
    return out

# ------------------------------------------------------------------ baked sun visibility + sky occlusion per vertex
def sun_vis(x, z, h, steps=56, maxd=5200.0, pen=np.radians(1.1)):
    vis = np.full(x.shape, 1e9, np.float32)
    ds = np.geomspace(3.0, maxd, steps); te = np.tan(LIGHT_EL)
    for d in ds:
        hx = hsample(x + SUN_H[0] * d, z + SUN_H[1] * d)
        ang = np.arctan2(hx - (h + 0.4), d) - LIGHT_EL            # >0: blocked
        vis = np.minimum(vis, -ang)
    return np.clip(0.5 + vis / (2 * pen), 0, 1)

def sky_occ(x, z, h):
    acc = np.zeros(x.shape, np.float32)
    for k in range(8):
        a = k / 8 * 2 * np.pi; mx = np.zeros(x.shape, np.float32)
        for d in (4.0, 10.0, 25.0, 60.0, 150.0, 400.0, 1000.0):
            hx = hsample(x + np.cos(a) * d, z + np.sin(a) * d)
            mx = np.maximum(mx, np.arctan2(hx - h, d))
        acc += np.cos(mx) ** 2
    return acc / 8

VIS = sun_vis(gx, gz, H); AO = sky_occ(gx, gz, H)
print('bake done %.1fs  vis mean %.2f ao min %.2f' % (time.time() - t0, VIS.mean(), AO.min()))

# slope (for scatter + rock mask)
def slope_at(x, z, e=2.0):
    return np.hypot(hsample(x + e, z) - hsample(x - e, z), hsample(x, z + e) - hsample(x, z - e)) / (2 * e)

# forest density field (used for far billboards and a darkening mask on the terrain)
def forest_field(x, z):
    f = 0.55 * sample_tile(N1, x, z, 1900.0, 2.1, 300, 50) + 0.45 * sample_tile(N4, x, z, 700.0, 0.4, 20, 900)
    return f
FOREST_V = np.clip(smooth(-0.15, 0.55, forest_field(gx, gz)) * smooth(60, 170, dT_v) * (1 - smooth(0.55, 0.9, slope_at(gx, gz, 6.0))) * (1 - smooth(200, 400, H)), 0, 1)

# ------------------------------------------------------------------ write terrain.bin
hdr = struct.pack('<4sIfffff', b'VYTR', N, R0, K, CX, CZ, float(H.max()))
with open(G + 'assets/terrain.bin', 'wb') as f:
    f.write(hdr)
    f.write(H.astype('<f4').tobytes())
    f.write((np.clip(VIS, 0, 1) * 255).astype(np.uint8).tobytes())
    f.write((np.clip(AO, 0, 1) * 255).astype(np.uint8).tobytes())
    f.write((FOREST_V * 255).astype(np.uint8).tobytes())
print('terrain.bin written')

# ------------------------------------------------------------------ near-field mask texture (0.5 m / texel over +-256 m)
MR = 256.0; MN = 1024
ma = (np.arange(MN) + 0.5) / MN * 2 - 1
mx_, mz_ = np.meshgrid(CX + ma * MR, CZ + ma * MR)
dTm, iTm = track_dist(mx_, mz_); dRm = road_dist(mx_, mz_); padm = paddock(mx_, mz_)
nz1 = sample_tile(N2, mx_, mz_, 61.0, 0.2, 5, 9); nz2 = sample_tile(N3, mx_, mz_, 17.0, 1.3); nz3 = sample_tile(N1, mx_, mz_, 240.0, 0.9, 40, 2)
apron = 1 - smooth(8.2, 13.5, dTm + nz1 * 1.6 + nz2 * 0.8)
# two wheel ruts on the service road, grass strip in the middle
ruts = (1 - smooth(0.35, 0.85, np.abs(dRm - 0.85) + nz2 * 0.12)) * (1 - smooth(0.0, 6.0, np.abs(dRm)) * 0)
roadbed = 1 - smooth(1.7, 3.0, dRm + nz2 * 0.3)
road_dirt = np.clip(ruts * 0.95 + roadbed * 0.35, 0, 1) * (dRm < 59)
pad_dirt = padm * (0.75 + 0.25 * smooth(-0.5, 0.5, nz2))
# worn patches / animal trails in the infield
trail = 1 - smooth(0.0, 0.22, np.abs(sample_tile(N4, mx_, mz_, 330.0, 0.5, 11, 70)) + 0.06)
bare = smooth(0.9, 1.5, nz1 * 0.7 + nz2 * 0.8) * 0.8
dirt = np.clip(np.maximum.reduce([apron, road_dirt, pad_dirt, trail * 0.5 * smooth(13, 25, dTm), bare * smooth(12, 20, dTm)]), 0, 1)
slm = slope_at(mx_, mz_, 1.0)
grass = np.clip((1 - smooth(0.25, 0.75, dirt)) * smooth(9.5, 13.0, dTm + nz2 * 0.9) * (1 - smooth(0.7, 1.1, slm)), 0, 1)
grass *= (0.72 + 0.28 * smooth(-1.0, 0.6, nz1))                     # patchiness
dry = np.clip(0.5 + 0.33 * nz3 + 0.17 * nz1, 0, 1)                   # dry (golden) vs green variation
mask = np.stack([dry, grass, dirt], -1)                                # written as BGR -> R=dirt G=grass B=dry

# ------------------------------------------------------------------ scatter (trees, bushes, rocks)
rng = np.random.default_rng(42)
def poisson(n_try, mind, accept, lo=-250, hi=250, cx=CX, cz=CZ, existing=None):
    pts = [] if existing is None else list(existing); base = len(pts); cell = mind / np.sqrt(2); grid = {}
    def key(p): return (int(np.floor(p[0] / cell)), int(np.floor(p[1] / cell)))
    for p in pts: grid.setdefault(key(p), []).append(p)
    cand = np.stack([rng.uniform(lo, hi, n_try) + cx, rng.uniform(lo, hi, n_try) + cz], 1)
    ok = accept(cand[:, 0], cand[:, 1])
    for p in cand[ok]:
        k = key(p); good = True
        for a in range(-2, 3):
            for b in range(-2, 3):
                for q in grid.get((k[0] + a, k[1] + b), []):
                    if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < mind * mind: good = False; break
                if not good: break
            if not good: break
        if good: pts.append(p); grid.setdefault(k, []).append(p)
    return np.array(pts[base:]).reshape(-1, 2)

def tdist(x, z): return kd.query(np.stack([x, z], 1))[0]
def rdist(x, z): return np.minimum(kd_road.query(np.stack([x, z], 1), distance_upper_bound=60)[0], 60)
def grove(x, z): return 0.6 * sample_tile(N1, x, z, 520.0, 1.7, 200, 90) + 0.4 * sample_tile(N4, x, z, 190.0, 0.2, 60, 10)
def sunside(x, z):
    # signed distance along the sun direction from the nearest track point (positive = towards the sun)
    d, i = kd.query(np.stack([x, z], 1)); return (x - P[i, 0]) * SUN_H[0] + (z - P[i, 1]) * SUN_H[1]
# keep a clear view of the low sun from the start straight
def sun_corridor(x, z):
    rx, rz = x - 25.0, z - 0.0; along = rx * SUN_H[0] + rz * SUN_H[1]; perp = np.abs(-rx * SUN_H[1] + rz * SUN_H[0])
    return (along > 5) & (perp < 16 + along * 0.16)

def acc_hero(x, z):
    d = tdist(x, z); g = grove(x, z)
    return (d > 15.5) & (d < 135) & (g > 0.42) & (rdist(x, z) > 6) & (paddock(x, z) < 0.05) & (~sun_corridor(x, z)) & (slope_at(x, z) < 0.5)
hero = poisson(60000, 8.0, acc_hero, -210, 210)
def acc_solo(x, z):
    d = tdist(x, z)
    return (d > 17) & (d < 120) & (rdist(x, z) > 7) & (paddock(x, z) < 0.05) & (~sun_corridor(x, z)) & (rng.uniform(0, 1, len(x)) < 0.012)
solo = poisson(30000, 26.0, acc_solo, -190, 190, existing=hero)
hero_all = np.vstack([hero, solo])
gh = grove(hero_all[:, 0], hero_all[:, 1]); hh = hsample(hero_all[:, 0], hero_all[:, 1])
spn = sample_tile(N4, hero_all[:, 0], hero_all[:, 1], 300.0, 2.2, 500, 123)
trees = []
for (x, z), g, y, s in zip(hero_all, gh, hh, spn):
    u = rng.uniform()
    if s > 0.45: sp = 'aspen'
    elif s < -0.35: sp = 'pine'
    else: sp = 'oak' if u < 0.45 else ('ash' if u < 0.75 else 'pine')
    if sp == 'aspen' and u < 0.12: sp = 'pine'
    size = float(np.clip(rng.normal(1.0, 0.16), 0.65, 1.4))
    trees.append(dict(x=round(float(x), 2), z=round(float(z), 2), y=round(float(y), 2), sp=sp, s=round(size, 3), r=round(float(rng.uniform(0, 6.283)), 3)))
print('hero trees', len(trees), {k: sum(t['sp'] == k for t in trees) for k in ('pine', 'oak', 'ash', 'aspen')})

def acc_bush(x, z):
    d = tdist(x, z)
    near_tree = cKDTree(hero_all).query(np.stack([x, z], 1))[0] < 9
    return (d > 11.5) & (d < 170) & (rdist(x, z) > 3.5) & (paddock(x, z) < 0.05) & (near_tree | (rng.uniform(0, 1, len(x)) < 0.04))
bush = poisson(26000, 3.2, acc_bush, -215, 215)
bush = bush[rng.uniform(0, 1, len(bush)) < 0.30]
def acc_rock(x, z):
    d = tdist(x, z); n = sample_tile(N2, x, z, 140.0, 0.9, 3, 77)
    return (d > 10.5) & (d < 230) & (rdist(x, z) > 3.0) & (paddock(x, z) < 0.3) & (n > 1.15)
rock = poisson(40000, 1.6, acc_rock, -240, 240)
rock = rock[rng.uniform(0, 1, len(rock)) < 0.5]
print('bushes', len(bush), 'rocks', len(rock))

# far / mid forest billboards (warped sampling: denser near)
cand_t = rng.uniform(-1, 1, (150000, 2)); rw = 2600 * np.sinh(3.2 * cand_t) / np.sinh(3.2)
bx, bz = CX + rw[:, 0], CZ + rw[:, 1]
dTb = tdist(bx, bz); ff = forest_field(bx, bz); sl = slope_at(bx, bz, 6.0); hb = hsample(bx, bz)
okb = (dTb > 150) & (ff + rng.normal(0, 0.18, len(bx)) > 0.12) & (sl < 0.75) & (hb < 330) & (rdist(bx, bz) > 8)
# thin with distance so the count stays bounded
rb = np.hypot(bx - CX, bz - CZ); okb &= rng.uniform(0, 1, len(bx)) < np.clip(1.25 - rb / 2600, 0.25, 1)
bb = np.stack([bx[okb], hb[okb], bz[okb], np.clip(rng.normal(1, 0.2, okb.sum()), 0.6, 1.6), (rng.uniform(0, 1, okb.sum()) < 0.62).astype(float)], 1).astype(np.float32)
print('far billboards', len(bb))
open(G + 'assets/forest.bin', 'wb').write(bb.astype('<f4').tobytes())

scatter = dict(trees=trees,
               bushes=[[round(float(x), 2), round(float(hsample(np.array([x]), np.array([z]))[0]), 2), round(float(z), 2), round(float(rng.uniform(0.7, 1.5)), 2), round(float(rng.uniform(0, 6.28)), 2), int(rng.integers(0, 3))] for x, z in bush],
               rocks=[[round(float(x), 2), round(float(hsample(np.array([x]), np.array([z]))[0]), 2), round(float(z), 2), round(float(np.clip(rng.lognormal(-0.75, 0.6), 0.14, 2.4)), 2), round(float(rng.uniform(0, 6.28)), 2), int(rng.integers(0, 6))] for x, z in rock],
               road=[[round(float(a), 2), round(float(b), 2)] for a, b in rd[::8]],
               paddock=dict(c=PAD_C.tolist(), r=PAD_R.tolist()),
               sun=dict(az=float(np.degrees(SUN_AZ)), el=float(np.degrees(LIGHT_EL)), skyEl=sky['sunEl']),
               center=[CX, CZ], maskR=MR)
json.dump(scatter, open(G + 'assets/scatter.json', 'w'), separators=(',', ':'))

# tree shade into the mask (soft blobs stretched away from the sun) -> used to thin the grass under canopies
shade = np.zeros((MN, MN), np.float32)
for t in trees:
    u = int(((t['x'] - CX) / MR * 0.5 + 0.5) * MN); v = int(((t['z'] - CZ) / MR * 0.5 + 0.5) * MN)
    if 0 <= u < MN and 0 <= v < MN: cv2.circle(shade, (u, v), int(3.2 * t['s'] / (2 * MR / MN)), 1.0, -1)
shade = gaussian_filter(shade, 3.0)
mask[..., 1] *= (1 - 0.45 * np.clip(shade, 0, 1))
cv2.imwrite(G + 'assets/mask.png', (np.clip(mask, 0, 1) * 255).astype(np.uint8))

# ------------------------------------------------------------------ previews
def relief(Hg, cell, vis=None):
    gy, gx_ = np.gradient(Hg, cell); n = np.stack([-gx_, np.ones_like(Hg), -gy], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    l = np.array([SUN_H[0] * np.cos(LIGHT_EL), np.sin(LIGHT_EL), SUN_H[1] * np.cos(LIGHT_EL)])
    sh = np.clip((n * l).sum(-1), 0, 1) * 3.0
    if vis is not None: sh = sh * vis
    return np.clip(0.25 + sh, 0, 1.3) / 1.3
_el = LIGHT_EL; LIGHT_EL = np.radians(35.0); pv = relief(Hf, FAR_R * 2 / FAR2); LIGHT_EL = _el
pv = (np.stack([pv, pv, pv], -1) * 255).astype(np.uint8)
cv2.imwrite('/home/claude/preview/terrain_far.jpg', cv2.resize(pv, (1000, 1000)))
# near preview with masks and objects (+-256 m)
visn = sun_vis(mx_, mz_, hsample(mx_, mz_), steps=40)
rl = relief(hsample(mx_, mz_), 2 * MR / MN, visn)
col = np.zeros((MN, MN, 3), np.float32)
col[...] = np.array([40, 90, 70]) / 255.0                               # BGR grass
col = col * (1 - mask[..., 2:3]) + np.array([60, 95, 140]) / 255.0 * mask[..., 2:3]
col = col * (0.35 + 0.9 * rl[..., None])
img = (np.clip(col, 0, 1) * 255).astype(np.uint8)
def px(x, z): return int(((x - CX) / MR * 0.5 + 0.5) * MN), int(((z - CZ) / MR * 0.5 + 0.5) * MN)
for i in range(0, len(P), 4): cv2.circle(img, px(*P[i]), 10, (70, 110, 165), -1)
colsp = dict(pine=(40, 90, 20), oak=(30, 140, 60), ash=(60, 170, 90), aspen=(40, 200, 235))
for t in trees: cv2.circle(img, px(t['x'], t['z']), int(5 * t['s']), colsp[t['sp']], -1)
for x, z in bush: cv2.circle(img, px(x, z), 2, (80, 200, 120), -1)
for x, z in rock: cv2.circle(img, px(x, z), 2, (200, 200, 200), -1)
c0 = px(25, 0); cv2.arrowedLine(img, c0, (int(c0[0] + SUN_H[0] * 120), int(c0[1] + SUN_H[1] * 120)), (0, 255, 255), 3)
cv2.imwrite('/home/claude/preview/terrain_near.jpg', img)
cv2.imwrite('/home/claude/preview/mask.jpg', (np.clip(mask, 0, 1) * 255).astype(np.uint8))
print('all done %.1fs' % (time.time() - t0))
