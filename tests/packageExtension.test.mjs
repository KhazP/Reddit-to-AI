import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectFiles, outDir, packageExtension, root, verifyZip } from '../scripts/package-extension.mjs';

const script = await readFile(new URL('../scripts/package-extension.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));

assert.match(script, /import JSZip from 'jszip';/, 'package script must use jszip');
assert.match(script, /Reddit-to-AI-v\$\{version\}-upload\.zip/, 'upload zip name must include manifest version');
assert.match(script, /verifyZip/, 'package script must verify the zip after creating it');

for (const forbidden of ['node_modules', 'tests', 'scripts', 'docs', 'dist-extension', '.github', '.playwright-mcp']) {
  assert.match(script, new RegExp(`['"]${forbidden.replace('.', '\\.')}['"]`), `package script must exclude ${forbidden}`);
}

for (const forbidden of ['package.json', 'package-lock.json', 'eslint.config.js', '.DS_Store']) {
  assert.match(script, new RegExp(`['"]${forbidden.replace('.', '\\.')}['"]`), `package script must exclude ${forbidden}`);
}

assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'manifest version must be valid for the package script');

const result = await packageExtension();
const stagedFiles = await collectFiles(outDir);
const zipFiles = await verifyZip(outDir, result.zipPath);
assert.deepEqual(zipFiles, stagedFiles, 'upload zip must contain exactly the staged files');

for (const required of ['manifest.json', 'popup.html', 'preview.html', 'options.html', 'service_worker.js', '_locales/en/messages.json']) {
  assert.ok(stagedFiles.includes(required), `staged package must include ${required}`);
}

for (const forbidden of ['package.json', 'package-lock.json', 'tests/promptBuilder.test.mjs', 'scripts/package-extension.mjs', 'docs/PRIVACY.md']) {
  assert.ok(!stagedFiles.includes(forbidden), `staged package must not include ${forbidden}`);
}

await stat(join(root, `Reddit-to-AI-v${manifest.version}-upload.zip`));
