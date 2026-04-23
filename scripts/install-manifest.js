#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_FILE = '.install-manifest.json';

function getManifestPath(layout) {
  return path.join(layout.installDir, MANIFEST_FILE);
}

function readInstallManifest(layout) {
  const manifestPath = getManifestPath(layout);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function writeInstallManifest(layout, manifest, options = {}) {
  if (options.dryRun) {
    return getManifestPath(layout);
  }
  const manifestPath = getManifestPath(layout);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

module.exports = {
  MANIFEST_FILE,
  getManifestPath,
  readInstallManifest,
  writeInstallManifest,
};
