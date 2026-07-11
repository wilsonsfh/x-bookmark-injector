import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const entryPoints = ['src/inpage.js', 'src/content.js', 'src/background.js', 'src/popup.js'];
const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

async function copyStatic() {
  await cp('manifest.json', 'dist/manifest.json');
  await cp('public/popup.html', 'dist/popup.html');
}

const ctx = await esbuild.context({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  await copyStatic();
  console.log('watching src → dist/ ...');
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
  console.log('build complete → dist/');
}
