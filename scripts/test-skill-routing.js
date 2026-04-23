#!/usr/bin/env node

const assert = require('assert');

const { buildTaskProfile, loadContracts } = require('./task-profile');
const { buildDispatchManifest } = require('./task-intake');

function run() {
  const docs = loadContracts();
  const profile = buildTaskProfile({
    task_goal: 'Fix the failing startup regression in the launcher and update the repo code.',
    cwd: process.cwd(),
  }, docs);

  assert.equal(profile.route_id, 'bug_fix_default');
  assert.deepEqual(
    profile.resolved_skill_chain,
    ['cute-scope-plan', 'cute-repo-change', 'cute-code-review', 'cute-writeback']
  );

  const dispatch = buildDispatchManifest({
    sessionId: 's-routing',
    taskProfile: profile,
    routeResolution: {
      route_id: profile.route_id,
      phase: 'analysis',
    },
    docs,
  });

  assert.equal(dispatch.current_skill, 'using-cutepower');
  assert.equal(dispatch.next_skill, 'cute-scope-plan');
  assert.deepEqual(
    dispatch.allowed_following_skills,
    ['cute-scope-plan', 'cute-repo-change', 'cute-code-review', 'cute-writeback']
  );

  process.stdout.write('test-skill-routing: ok\n');
}

run();
