// Cross-platform build (Windows/Mac/Linux): bundles src/main.js -> dist/game.js and copies assets.
import { build } from 'esbuild';
import fs from 'node:fs'; import path from 'node:path';
const minify = process.env.MINIFY !== '0';
fs.mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/game.js', minify, logLevel: 'warning', loader: { '.jpg': 'file', '.png': 'file' }, assetNames: 'tex/[name]', publicPath: '.' });
fs.copyFileSync('src/index.html', 'dist/index.html');
fs.rmSync('dist/assets', { recursive: true, force: true }); fs.mkdirSync('dist/assets', { recursive: true });
for (const f of fs.readdirSync('assets')) { const ext = path.extname(f); const out = ['.bin', '.hdr', '.glb'].includes(ext) ? f.slice(0, -ext.length) + '.txt' : f; fs.copyFileSync(path.join('assets', f), path.join('dist/assets', out)); }
console.log('built dist/');
