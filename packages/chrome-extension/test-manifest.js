const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running MUXARO Chrome Extension verification suite...');

const extDir = __dirname;
const manifestPath = path.join(extDir, 'manifest.json');
const rulesPath = path.join(extDir, 'rules.json');

// 1. Verify Manifest JSON
assert(fs.existsSync(manifestPath), 'manifest.json must exist');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
assert.strictEqual(manifest.name, 'MUXARO Direct Bridge', 'Name must match');
assert(manifest.version, 'Must have version string');

// 2. Verify Permissions
assert(manifest.permissions.includes('declarativeNetRequest'), 'Must have declarativeNetRequest');
assert(manifest.permissions.includes('scripting'), 'Must have scripting');
assert(manifest.permissions.includes('activeTab'), 'Must have activeTab');

// 3. Verify Host Permissions
assert(Array.isArray(manifest.host_permissions), 'Host permissions must be array');
assert(manifest.host_permissions.some(p => p.includes('googlevideo.com')), 'Must include googlevideo.com');
assert(manifest.host_permissions.some(p => p.includes('youtube.com')), 'Must include youtube.com');

// 4. Verify Background Service Worker
assert(manifest.background && manifest.background.service_worker, 'Background service worker must be declared');
assert(fs.existsSync(path.join(extDir, manifest.background.service_worker)), 'Service worker file must exist');

// 5. Verify Content Scripts
assert(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
manifest.content_scripts.forEach(cs => {
  cs.js.forEach(file => {
    assert(fs.existsSync(path.join(extDir, file)), `Content script file ${file} must exist`);
  });
});

// 6. Verify Action & Popup
assert(manifest.action && manifest.action.default_popup, 'Popup must be declared');
assert(fs.existsSync(path.join(extDir, manifest.action.default_popup)), 'popup.html must exist');
assert(fs.existsSync(path.join(extDir, 'popup.js')), 'popup.js must exist');
assert(fs.existsSync(path.join(extDir, 'popup.css')), 'popup.css must exist');

// 7. Verify Icons
assert(manifest.icons, 'Icons must be specified in manifest');
[16, 48, 128].forEach(size => {
  const iconPath = path.join(extDir, manifest.icons[size]);
  assert(fs.existsSync(iconPath), `Icon ${manifest.icons[size]} must exist`);
  const stat = fs.statSync(iconPath);
  assert(stat.size > 0, `Icon ${size} must have non-zero size`);
});

// 8. Verify DeclarativeNetRequest Rules
assert(fs.existsSync(rulesPath), 'rules.json must exist');
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
assert(Array.isArray(rules), 'rules.json must contain an array');
rules.forEach(rule => {
  assert(typeof rule.id === 'number', 'Rule ID must be a number');
  assert(rule.action && rule.action.type === 'modifyHeaders', 'Rule action must be modifyHeaders');
  assert(rule.condition, 'Rule condition must exist');
});

console.log('✓ All 8 MUXARO Chrome Extension integrity and specification checks passed!');
