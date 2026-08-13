import JSZip from 'jszip';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toFirefoxManifest } from './firefox-manifest.mjs';

export const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
export const outDir = join(root, 'dist-extension');
export const firefoxOutDir = join(root, 'dist-extension-firefox');

export const excludedDirs = new Set([
  '.git',
  '.github',
  '.playwright-mcp',
  '.agents',
  'node_modules',
  'tests',
  'scripts',
  'dist-extension',
  'dist-extension-firefox',
  '__MACOSX',
  'docs'
]);

export const excludedFiles = new Set([
  '.gitignore',
  '.DS_Store',
  'CITATION.cff',
  'README.md',
  'SOFTWARE_REQUIREMENTS.md',
  'UPDATE_NOTES.md',
  'package.json',
  'package-lock.json',
  'eslint.config.js',
  'ORIGINAL_REQUEST.md'
]);

export function toZipPath(path) {
  return path.split(sep).join('/');
}

export function shouldSkip(path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(/[\\/]/);
  if (parts.some(part => excludedDirs.has(part))) return true;
  const name = parts.at(-1);
  if (excludedFiles.has(name)) return true;
  return /\.zip$/i.test(name) || /\.log$/i.test(name);
}

export async function copyTree(src, dest) {
  if (shouldSkip(src)) return;
  const info = await stat(src);
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = (await readdir(src)).sort();
    for (const entry of entries) {
      await copyTree(join(src, entry), join(dest, entry));
    }
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
}

export async function collectFiles(dir, base = dir) {
  const entries = [];
  for (const entry of (await readdir(dir)).sort()) {
    const fullPath = join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      entries.push(...await collectFiles(fullPath, base));
    } else {
      entries.push(toZipPath(relative(base, fullPath)));
    }
  }
  return entries.sort();
}

export async function getManifestVersion(stageDir = outDir) {
  const manifest = JSON.parse(await readFile(join(stageDir, 'manifest.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) {
    throw new Error(`Invalid manifest version: ${manifest.version || '<missing>'}`);
  }
  return manifest.version;
}

export async function createZip(stageDir = outDir, zipPath) {
  const zip = new JSZip();
  const files = await collectFiles(stageDir);
  for (const file of files) {
    zip.file(file, await readFile(join(stageDir, file)));
  }
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX'
  });
  await writeFile(zipPath, buffer);
  return files;
}

export async function verifyZip(stageDir = outDir, zipPath) {
  const expectedFiles = await collectFiles(stageDir);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const actualFiles = Object.values(zip.files)
    .filter(entry => !entry.dir)
    .map(entry => entry.name)
    .sort();

  const expected = JSON.stringify(expectedFiles);
  const actual = JSON.stringify(actualFiles);
  if (actual !== expected) {
    throw new Error(`Zip contents do not match staged payload.\nExpected: ${expected}\nActual: ${actual}`);
  }
  return actualFiles;
}

// The Firefox payload is byte-identical to the Chrome one except for manifest.json,
// which is regenerated from the Chrome manifest by the transform in
// scripts/firefox-manifest.mjs.
export async function stageFirefox(stageDir = firefoxOutDir) {
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });
  await copyTree(join(root, 'src'), stageDir);

  const chromeManifest = JSON.parse(await readFile(join(root, 'src', 'manifest.json'), 'utf8'));
  const firefoxManifest = toFirefoxManifest(chromeManifest);
  await writeFile(join(stageDir, 'manifest.json'), `${JSON.stringify(firefoxManifest, null, 2)}\n`, 'utf8');
  return stageDir;
}

export async function packageExtension() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyTree(join(root, 'src'), outDir);

  const version = await getManifestVersion(outDir);
  const zipName = `Reddit-to-AI-v${version}-upload.zip`;
  const zipPath = join(root, zipName);
  await rm(zipPath, { force: true });
  const files = await createZip(outDir, zipPath);
  await verifyZip(outDir, zipPath);

  await stageFirefox(firefoxOutDir);
  const firefoxZipName = `Reddit-to-AI-v${version}-firefox.zip`;
  const firefoxZipPath = join(root, firefoxZipName);
  await rm(firefoxZipPath, { force: true });
  const firefoxFiles = await createZip(firefoxOutDir, firefoxZipPath);
  await verifyZip(firefoxOutDir, firefoxZipPath);

  console.log(`Extension package staged at ${outDir}`);
  console.log(`Upload archive created at ${zipPath}`);
  console.log(`Verified ${files.length} files in ${zipName}`);
  console.log(`Firefox package staged at ${firefoxOutDir}`);
  console.log(`Firefox archive created at ${firefoxZipPath}`);
  console.log(`Verified ${firefoxFiles.length} files in ${firefoxZipName}`);
  return { outDir, zipPath, files, firefoxOutDir, firefoxZipPath, firefoxFiles };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  await packageExtension();
}
