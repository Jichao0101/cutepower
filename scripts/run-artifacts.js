'use strict';

const fs = require('fs');
const path = require('path');

function runRoot(rootDir, sessionId) {
  return path.join(rootDir || '.cutepower', 'run', sessionId);
}

function artifactPath(rootDir, sessionId, artifactName) {
  return path.join(runRoot(rootDir, sessionId), `${artifactName}.json`);
}

function writeArtifact(rootDir, sessionId, artifactName, value) {
  const target = artifactPath(rootDir, sessionId, artifactName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
  return target;
}

function readArtifact(rootDir, sessionId, artifactName) {
  const target = artifactPath(rootDir, sessionId, artifactName);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

module.exports = {
  artifactPath,
  readArtifact,
  runRoot,
  writeArtifact,
};
