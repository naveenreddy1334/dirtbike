// Asset loading with progress reporting.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const BASE = './assets/';
export const N_LAYERS = 7, LAYER_SIZE = 1024;

function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed: ' + url)); im.src = url; });
}
function pixels(img, size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}
// stack several images into one array texture (rows flipped so v = 1 is the top of each image)
function arrayTexture(images, size, srgb, aniso) {
  const n = images.length, data = new Uint8Array(size * size * 4 * n), row = size * 4;
  images.forEach((img, l) => {
    const px = pixels(img, size), off = l * size * size * 4;
    for (let y = 0; y < size; y++) data.set(px.subarray(y * row, y * row + row), off + (size - 1 - y) * row);
  });
  const t = new THREE.DataArrayTexture(data, size, size, n);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}
function tex2d(img, srgb, aniso, repeat = true) {
  const t = new THREE.Texture(img);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}

export async function loadAssets(aniso, onProgress) {
  const jobs = []; let done = 0;
  const track = (p) => { jobs.push(p); p.then(() => { done++; onProgress(done / jobs.length); }); return p; };
  const hdr = new HDRLoader();
  const json = (f) => track(fetch(BASE + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }));
  const bin = (f) => track(fetch(BASE + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.arrayBuffer(); }));
  const img = (f) => track(loadImage(BASE + f));

  const pSky = track(hdr.loadAsync(BASE + 'sky.txt')), pIbl = track(hdr.loadAsync(BASE + 'sky_ibl.txt'));
  const pMeta = json('sky.json'), pScatter = json('scatter.json'), pLayers = json('layers.json');
  const pTerrain = bin('terrain.txt'), pForest = bin('forest.txt');
  const pAlb = [], pNh = [];
  for (let i = 0; i < N_LAYERS; i++) { pAlb.push(img(`gl_alb_${i}.jpg`)); pNh.push(img(`gl_nh_${i}.webp`)); }
  const pMask = img('mask.png'), pTa = img('track_a.webp'), pTb = img('track_b.webp');

  const A = {};
  [A.skyTex, A.iblTex, A.sky, A.scatter, A.layers, A.terrainBin, A.forestBin] = await Promise.all([pSky, pIbl, pMeta, pScatter, pLayers, pTerrain, pForest]);
  A.iblTex.mapping = THREE.EquirectangularReflectionMapping;
  const alb = await Promise.all(pAlb), nh = await Promise.all(pNh);
  A.groundAlb = arrayTexture(alb, LAYER_SIZE, true, aniso);
  A.groundNh = arrayTexture(nh, LAYER_SIZE, false, aniso);
  const [mask, ta, tb] = await Promise.all([pMask, pTa, pTb]);
  A.maskImg = mask;
  A.mask = tex2d(mask, false, 4, false); A.mask.flipY = false; A.mask.generateMipmaps = true;
  A.trackA = tex2d(ta, false, aniso); A.trackB = tex2d(tb, false, aniso);
  return A;
}
