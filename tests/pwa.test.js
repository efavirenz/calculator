import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const readText = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

function extractArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array not found in service-worker.js`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function resolveUrl(url) {
  return join(ROOT, url === './' ? '' : url.slice(2));
}

function pngDimensions(filePath) {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${filePath} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('service worker precache manifests reference existing files (AUD-011)', () => {
  const source = readText('service-worker.js');
  const coreUrls = extractArray(source, 'CORE_URLS');
  const optionalUrls = extractArray(source, 'OPTIONAL_URLS');
  assert.ok(coreUrls.length > 0);
  assert.ok(optionalUrls.length > 0);

  for (const url of [...coreUrls, ...optionalUrls]) {
    const target = resolveUrl(url);
    assert.equal(existsSync(target), true, `Missing precache file: ${url}`);
  }
  assert.equal(statSync(resolveUrl('./')).isDirectory(), true);
});

test('service worker core cache includes every runtime JS module (AUD-011)', () => {
  const source = readText('service-worker.js');
  const coreUrls = extractArray(source, 'CORE_URLS');
  const jsFiles = readdirSync(join(ROOT, 'js')).filter((file) => file.endsWith('.js'));
  for (const file of jsFiles) {
    assert.ok(coreUrls.includes(`./js/${file}`), `js/${file} is not precached`);
  }
});

test('manifest icon entries exist on disk with matching dimensions (NEW-004)', () => {
  const manifest = JSON.parse(readText('manifest.json'));
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');

  for (const icon of manifest.icons) {
    const target = resolveUrl(icon.src);
    assert.equal(existsSync(target), true, `Missing manifest icon: ${icon.src}`);
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngDimensions(target), { width, height }, icon.src);
  }

  const touchIcons = [...readText('index.html').matchAll(/<link rel="apple-touch-icon"[^>]*href="\.\/([^"]+)"/g)];
  for (const [, href] of touchIcons) {
    assert.equal(existsSync(join(ROOT, href)), true, `Missing Apple touch icon: ${href}`);
  }
});

test('release version stays synchronized across all four locations', () => {
  const serviceWorker = readText('service-worker.js');
  const indexHtml = readText('index.html');
  const readme = readText('README.md');
  const agents = readText('AGENTS.md');

  const cacheVersion = serviceWorker.match(/const CACHE_VERSION = '([^']+)'/)?.[1];
  const badgeVersion = indexHtml.match(/id="version-badge"[^>]*>\s*([^<\s]+)\s*</)?.[1];
  const shieldVersion = readme.match(/badge\/version-(v[\d.]+)-blue/)?.[1];
  const agentsVersion = agents.match(/\*\*Current Release\*\*: (v[\d.]+)/)?.[1];

  assert.ok(cacheVersion, 'CACHE_VERSION not found');
  assert.equal(badgeVersion, cacheVersion);
  assert.equal(shieldVersion, cacheVersion);
  assert.equal(agentsVersion, cacheVersion);
});

test('runtime JavaScript contains no dynamic-code or HTML-injection APIs (AUD-022/AUD-023)', () => {
  const forbidden = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function\(/;
  const jsDir = join(ROOT, 'js');
  for (const file of readdirSync(jsDir).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(jsDir, file), 'utf8');
    assert.equal(forbidden.test(source), false, `Forbidden API found in js/${file}`);
  }
});
