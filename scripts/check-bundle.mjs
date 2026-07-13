#!/usr/bin/env node
// Bundle budget guard (Plan 5; budget raised in Plan 7). Fails the build when
// the main chunk exceeds the gzip budget or when a lazy-only library's marker
// strings leak into it.
//
// Budget rationale: Plan 7 raised the ceiling 210 → 230 KiB (controller-
// approved): six → seven feature plans of deliberate UI growth had the entry
// chunk at 211,396 bytes with ~3.6 KiB headroom. The gate exists to catch
// ACCIDENTAL heavyweight imports — a static @dbml/core (~2.7 MB chunk) or
// elk.bundled (~1.4 MB) overshoots any sane budget by an order of magnitude,
// and the marker check below names the culprit even when minification shifts
// sizes — not to cap deliberate feature growth.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const raw = process.env.BUNDLE_BUDGET;
const BUDGET_BYTES = raw === undefined ? 230 * 1024 : Number(raw);
if (Number.isNaN(BUDGET_BYTES)) {
  console.error('check-bundle FAILED: BUNDLE_BUDGET is not a number: ' + raw);
  process.exit(1);
}
// Markers that exist ONLY in lazy chunks: elk.bundled.js ships ELK's Java
// option ids ('org.eclipse.elk…'); the @dbml/core chunk (reachable only via
// dynamic import of parseDbml.ts) contains the 'dbmlv2' format literal.
// src/core/layout/elkGraph.ts deliberately uses the short 'elk.*' option
// keys, so the entry chunk is marker-free unless a leak happens.
// NOTE: the 'dbmlv2' check assumes the default MINIFIED build — source
// COMMENTS in main-chunk files (e.g. convert.ts) mention the string and
// esbuild strips them; under build.minify:false this would false-positive.
const FORBIDDEN = ['org.eclipse.elk', 'dbmlv2'];

execSync('npm run build', { stdio: 'inherit' });

let html;
try {
  html = readFileSync('dist/index.html', 'utf8');
} catch {
  console.error('check-bundle FAILED: dist/index.html missing — did the build produce output?');
  process.exit(1);
}
const entry = html.match(/assets\/index-[^"]+\.js/)?.[0];
if (!entry) {
  console.error('check-bundle: could not find the entry chunk in dist/index.html');
  process.exit(1);
}
const chunk = readFileSync(`dist/${entry}`);
// Node's zlib gzips ~1% smaller than the size vite build prints for the same
// file (different encoder settings); this script's number is the enforced metric.
const gzBytes = gzipSync(chunk).length;

const failures = [];
if (gzBytes > BUDGET_BYTES) {
  failures.push(`entry chunk ${entry} is ${gzBytes} bytes gzipped — budget is ${BUDGET_BYTES}`);
}
for (const marker of FORBIDDEN) {
  if (chunk.includes(marker)) {
    failures.push(`entry chunk contains "${marker}" — a lazy-only library leaked into the main bundle`);
  }
}

if (failures.length > 0) {
  console.error(`check-bundle FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-bundle OK: ${entry} is ${gzBytes} bytes gzipped (budget ${BUDGET_BYTES}); no lazy-lib markers.`);
