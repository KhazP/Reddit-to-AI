import JSZip from 'jszip';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKGROUND_LIBS, GECKO_ID } from './firefox-manifest.mjs';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const stageDir = join(root, 'dist-extension');
const firefoxStageDir = join(root, 'dist-extension-firefox');

const forbiddenPathParts = new Set([
  '.git',
  '.github',
  '.playwright-mcp',
  '.agents',
  'node_modules',
  'tests',
  'scripts',
  'docs',
  'dist-extension',
  'dist-extension-firefox',
  '__MACOSX'
]);

const forbiddenFiles = new Set([
  '.DS_Store',
  '.gitignore',
  'package.json',
  'package-lock.json',
  'eslint.config.js',
  'ORIGINAL_REQUEST.md'
]);

const requiredFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'preview.html',
  'preview.css',
  'preview.js',
  'service_worker.js',
  'promptBuilder.js',
  'apiProviders.js',
  'cl100k_base.js',
  'cl100k_base.json',
  'redditScraper.js',
  'aiPaster.js',
  'i18n.js',
  'floatingPanel.js',
  'floatingPanel.css',
  'tooltip.js',
  'tooltip.css',
  'images/icon16.png',
  'images/icon48.png',
  'images/icon128.png',
  '_locales/en/messages.json'
];

function toZipPath(path) {
  return path.split(sep).join('/');
}

async function collectFiles(dir, base = dir) {
  const files = [];
  for (const entry of (await readdir(dir)).sort()) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      files.push(...await collectFiles(full, base));
    } else {
      files.push(toZipPath(relative(base, full)));
    }
  }
  return files.sort();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function validatePayloadFileList(files) {
  for (const required of requiredFiles) {
    assert(files.includes(required), `Missing required release file: ${required}`);
  }

  for (const file of files) {
    const parts = file.split('/');
    assert(!parts.some(part => forbiddenPathParts.has(part)), `Forbidden path in release payload: ${file}`);
    assert(!forbiddenFiles.has(parts.at(-1)), `Forbidden file in release payload: ${file}`);
    assert(!/\.zip$/i.test(file), `Nested zip is not allowed in release payload: ${file}`);
    assert(!/\.log$/i.test(file), `Log file is not allowed in release payload: ${file}`);
  }
}

async function validateNoRemotePageAssets(files, dir = stageDir) {
  const pageAssetFiles = files.filter(file => /\.(html|css)$/i.test(file));
  const remoteAssetPattern = /\b(?:href|src)\s*=\s*["']https?:\/\/|@import\s+url\(["']?https?:\/\//i;
  for (const file of pageAssetFiles) {
    const text = await readFile(join(dir, file), 'utf8');
    assert(!remoteAssetPattern.test(text), `Remote page asset reference found in ${file}`);
    assert(!/fonts\.(?:googleapis|gstatic)\.com/i.test(text), `Remote Google Fonts reference found in ${file}`);
  }
}

async function validateManifest(files, dir = stageDir) {
  const manifest = await readJson(join(dir, 'manifest.json'));
  const packageJson = await readJson(join(root, 'package.json'));
  assert(manifest.manifest_version === 3, 'Manifest must be MV3');
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version || ''), `Invalid manifest version: ${manifest.version || '<missing>'}`);
  assert(packageJson.version === manifest.version, 'package.json version must match manifest.json version');
  assert(manifest.default_locale === 'en', 'Manifest default_locale must be en');
  assert(files.includes(`_locales/${manifest.default_locale}/messages.json`), 'Default locale messages file is missing');

  const allowedPermissions = new Set(['activeTab', 'scripting', 'storage', 'notifications', 'unlimitedStorage', 'contextMenus']);
  for (const permission of manifest.permissions || []) {
    assert(allowedPermissions.has(permission), `Unexpected manifest permission: ${permission}`);
  }

  const allowedHostPermissions = new Set([
    '*://*.reddit.com/*',
    'https://*.redd.it/*',
    'https://i.redd.it/*',
    'https://preview.redd.it/*',
    'https://external-preview.redd.it/*',
    'https://gemini.google.com/*',
    'https://chatgpt.com/*',
    'https://claude.ai/*',
    'https://aistudio.google.com/*',
    'https://chat.deepseek.com/*',
    'https://*.groq.com/*',
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*'
  ]);
  for (const host of manifest.host_permissions || []) {
    assert(allowedHostPermissions.has(host), `Unexpected host permission: ${host}`);
  }

  for (const entry of manifest.web_accessible_resources || []) {
    assert(!entry.matches?.includes('<all_urls>'), 'web_accessible_resources must not target <all_urls>');
    for (const resource of entry.resources || []) {
      assert(!/(?:^|\/)(?:docs|tests|scripts|node_modules)\//.test(resource), `Forbidden web accessible resource: ${resource}`);
      assert(!/(?:package(?:-lock)?\.json|eslint\.config\.js|README\.md)$/i.test(resource), `Forbidden web accessible resource: ${resource}`);
    }
  }
  return manifest;
}

async function validateZip(files, version, suffix = 'upload') {
  const zipName = `Reddit-to-AI-v${version}-${suffix}.zip`;
  const zipPath = join(root, zipName);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  const zipFiles = Object.values(zip.files)
    .filter(entry => !entry.dir)
    .map(entry => entry.name)
    .sort();

  assert(JSON.stringify(zipFiles) === JSON.stringify(files), `${zipName} contents do not match its staged payload`);
  return zipName;
}

// Firefox ships the same payload with a transformed manifest. Everything the Chrome
// manifest is checked for still applies; these are the Gecko-specific extras.
function validateFirefoxManifest(manifest, chromeManifest) {
  assert(!manifest.background?.service_worker, 'Firefox manifest must not declare background.service_worker');
  assert(Array.isArray(manifest.background?.scripts), 'Firefox manifest must declare background.scripts');
  assert(
    JSON.stringify(manifest.background.scripts) === JSON.stringify([...BACKGROUND_LIBS, 'service_worker.js']),
    'Firefox background.scripts must load the shared libraries before service_worker.js'
  );
  assert(manifest.browser_specific_settings?.gecko?.id === GECKO_ID, `Firefox manifest must declare gecko id ${GECKO_ID}`);
  assert(
    /^\d+\.\d+$/.test(manifest.browser_specific_settings.gecko.strict_min_version || ''),
    'Firefox manifest must declare a gecko strict_min_version'
  );
  assert(!('options_page' in manifest), 'Firefox manifest must use options_ui instead of options_page');
  assert(manifest.options_ui?.page === 'options.html', 'Firefox manifest must point options_ui at options.html');
  for (const entry of manifest.web_accessible_resources || []) {
    assert(!('use_dynamic_url' in entry), 'use_dynamic_url is Chrome-only and must be stripped for Firefox');
  }
  assert(manifest.version === chromeManifest.version, 'Firefox and Chrome manifests must share a version');
}

const files = await collectFiles(stageDir);
validatePayloadFileList(files);
await validateNoRemotePageAssets(files);
const manifest = await validateManifest(files);
const zipName = await validateZip(files, manifest.version);

const firefoxFiles = await collectFiles(firefoxStageDir);
validatePayloadFileList(firefoxFiles);
await validateNoRemotePageAssets(firefoxFiles, firefoxStageDir);
const firefoxManifest = await validateManifest(firefoxFiles, firefoxStageDir);
validateFirefoxManifest(firefoxManifest, manifest);
const firefoxZipName = await validateZip(firefoxFiles, firefoxManifest.version, 'firefox');

console.log(`Release payload valid: ${files.length} files staged in dist-extension`);
console.log(`Upload archive valid: ${zipName}`);
console.log(`Firefox payload valid: ${firefoxFiles.length} files staged in dist-extension-firefox`);
console.log(`Firefox archive valid: ${firefoxZipName}`);
