#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..');

const REQUIRED_HEADINGS = [
  '# Contracts',
  '# When This Skill Is Legal',
  '# Required Input Artifacts',
  '# Workflow',
  '# Required Outputs',
  '# Phase Exit / Next Skill',
  '# Stop Conditions',
];

function run() {
  const skillsRoot = path.join(pluginRoot, 'skills');
  const governedSkills = fs.readdirSync(skillsRoot)
    .filter((name) => name.startsWith('cute-') || name === 'using-cutepower');

  for (const skillName of governedSkills) {
    const body = fs.readFileSync(path.join(skillsRoot, skillName, 'SKILL.md'), 'utf8');
    for (const heading of REQUIRED_HEADINGS) {
      assert(body.includes(heading), `${skillName} missing heading: ${heading}`);
    }
  }

  process.stdout.write('test-skill-docs: ok\n');
}

run();
