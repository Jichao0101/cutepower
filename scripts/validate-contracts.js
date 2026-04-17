#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const pluginRoot = path.resolve(__dirname, "..");

function readJsonLike(relativePath) {
  const fullPath = path.join(pluginRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function ensureRequired(docName, obj, schema) {
  const missing = [];
  for (const key of schema.required || []) {
    if (!(key in obj)) {
      missing.push(key);
    }
  }
  if (missing.length) {
    throw new Error(`${docName} missing required keys: ${missing.join(", ")}`);
  }
}

function ensureKeys(name, obj, keys) {
  for (const key of keys) {
    if (!(key in obj)) {
      throw new Error(`${name} missing required key: ${key}`);
    }
  }
}

function ensureArray(name, value) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}

function ensureUnique(name, values) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} must be unique`);
  }
}

function ensureSkillExists(skillName) {
  const skillPath = path.join(pluginRoot, "skills", skillName, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    throw new Error(`routing-table references missing skill: ${skillName}`);
  }
}

function main() {
  const index = readJsonLike("contracts/contract-index.yaml");
  const indexSchema = readJsonLike("schemas/contract-index.schema.json");
  ensureRequired("contract-index", index, indexSchema);
  ensureArray("contract-index.contracts", index.contracts);

  const docs = {};
  for (const entry of index.contracts) {
    ensureKeys("contract-index entry", entry, ["id", "path", "schema_path", "version", "status", "precedence"]);
    const doc = readJsonLike(entry.path);
    const schema = readJsonLike(entry.schema_path);
    ensureRequired(entry.id, doc, schema);
    docs[entry.id] = doc;
  }

  const states = new Set(docs["gate-matrix"].states);
  const actions = new Set(docs["gate-matrix"].actions);
  const roles = new Set(docs["role-contracts"].roles.map((role) => role.role_id));
  const reviewTypes = new Set(docs["review-boundaries"].review_types.map((reviewType) => reviewType.review_type));
  const levels = new Set(docs["writeback-levels"].levels.map((level) => level.level_id));
  const routeIds = new Set(docs["routing-table"].routes.map((route) => route.route_id));
  const passStatuses = new Set(docs["writeback-levels"].pass_statuses.map((passStatus) => passStatus.pass_id));

  ensureUnique("role ids", [...roles]);
  ensureUnique("route ids", [...routeIds]);
  ensureUnique("review type ids", [...reviewTypes]);
  ensureUnique("writeback pass ids", [...passStatuses]);

  ensureArray("role-contracts.role_aliases", docs["role-contracts"].role_aliases);
  for (const alias of docs["role-contracts"].role_aliases) {
    ensureKeys("role alias", alias, ["legacy_role_id", "canonical_role_id", "status"]);
    if (!roles.has(alias.canonical_role_id)) {
      throw new Error(`role alias references unknown canonical role: ${alias.canonical_role_id}`);
    }
  }

  for (const rule of docs["gate-matrix"].rules) {
    ensureKeys(`gate rule ${rule.state}`, rule, ["state", "allow", "deny"]);
    if (!states.has(rule.state)) {
      throw new Error(`gate-matrix rule references unknown state: ${rule.state}`);
    }
    ensureArray(`gate-matrix.${rule.state}.allow`, rule.allow);
    ensureArray(`gate-matrix.${rule.state}.deny`, rule.deny);
    for (const action of [...rule.allow, ...rule.deny]) {
      if (!actions.has(action)) {
        throw new Error(`gate-matrix rule references unknown action: ${action}`);
      }
    }
  }

  const boardPolicy = docs["gate-matrix"].board_policy;
  ensureKeys("gate-matrix.board_policy", boardPolicy, ["board_actions", "action_relationships", "review_stage_constraints"]);
  ensureArray("gate-matrix.board_policy.board_actions", boardPolicy.board_actions);
  ensureArray("gate-matrix.board_policy.action_relationships", boardPolicy.action_relationships);
  for (const action of boardPolicy.board_actions) {
    if (!actions.has(action)) {
      throw new Error(`gate-matrix board policy references unknown action: ${action}`);
    }
  }
  for (const relationship of boardPolicy.action_relationships) {
    ensureKeys("gate-matrix.board_policy.action_relationship", relationship, ["action", "action_axis", "paired_with"]);
    if (!actions.has(relationship.action)) {
      throw new Error(`gate-matrix action relationship references unknown action: ${relationship.action}`);
    }
    ensureArray(`gate-matrix.${relationship.action}.paired_with`, relationship.paired_with);
    for (const action of relationship.paired_with) {
      if (!actions.has(action)) {
        throw new Error(`gate-matrix action relationship references unknown paired action: ${relationship.action} -> ${action}`);
      }
    }
  }
  ensureKeys("gate-matrix.board_policy.review_stage_constraints", boardPolicy.review_stage_constraints, [
    "allowed_board_actions",
    "forbidden_board_actions",
    "allowed_roles",
    "purpose",
    "forbidden_responsibilities"
  ]);
  ensureArray("gate-matrix.board_policy.review_stage_constraints.allowed_board_actions", boardPolicy.review_stage_constraints.allowed_board_actions);
  ensureArray("gate-matrix.board_policy.review_stage_constraints.forbidden_board_actions", boardPolicy.review_stage_constraints.forbidden_board_actions);
  ensureArray("gate-matrix.board_policy.review_stage_constraints.allowed_roles", boardPolicy.review_stage_constraints.allowed_roles);
  ensureArray("gate-matrix.board_policy.review_stage_constraints.forbidden_responsibilities", boardPolicy.review_stage_constraints.forbidden_responsibilities);
  for (const action of [
    ...boardPolicy.review_stage_constraints.allowed_board_actions,
    ...boardPolicy.review_stage_constraints.forbidden_board_actions
  ]) {
    if (!actions.has(action)) {
      throw new Error(`gate-matrix review stage policy references unknown board action: ${action}`);
    }
  }
  for (const role of boardPolicy.review_stage_constraints.allowed_roles) {
    if (!roles.has(role)) {
      throw new Error(`gate-matrix review stage policy references unknown role: ${role}`);
    }
  }

  for (const role of docs["role-contracts"].roles) {
    ensureKeys(`role-contracts.${role.role_id}`, role, [
      "role_id",
      "allowed_actions",
      "required_inputs",
      "required_outputs",
      "stop_conditions"
    ]);
    ensureArray(`${role.role_id}.allowed_actions`, role.allowed_actions);
    ensureArray(`${role.role_id}.required_inputs`, role.required_inputs);
    ensureArray(`${role.role_id}.required_outputs`, role.required_outputs);
    ensureArray(`${role.role_id}.stop_conditions`, role.stop_conditions);
    for (const action of role.allowed_actions) {
      if (!actions.has(action)) {
        throw new Error(`role-contracts references unknown action: ${role.role_id} -> ${action}`);
      }
    }
  }

  for (const reviewType of docs["review-boundaries"].review_types) {
    ensureKeys(`review-boundaries.${reviewType.review_type}`, reviewType, [
      "review_type",
      "reviewer_role_id",
      "skill_id",
      "reviewer_can",
      "reviewer_cannot",
      "required_evidence",
      "minimum_evidence_package",
      "independence_requirements",
      "missing_evidence_behavior",
      "allowed_outcomes"
    ]);
    if (!roles.has(reviewType.reviewer_role_id)) {
      throw new Error(`review-boundaries references unknown reviewer role: ${reviewType.review_type} -> ${reviewType.reviewer_role_id}`);
    }
    ensureSkillExists(reviewType.skill_id);
    ensureArray(`${reviewType.review_type}.reviewer_can`, reviewType.reviewer_can);
    ensureArray(`${reviewType.review_type}.reviewer_cannot`, reviewType.reviewer_cannot);
    ensureArray(`${reviewType.review_type}.required_evidence`, reviewType.required_evidence);
    ensureArray(`${reviewType.review_type}.minimum_evidence_package`, reviewType.minimum_evidence_package);
    ensureArray(`${reviewType.review_type}.allowed_outcomes`, reviewType.allowed_outcomes);
    if (!reviewType.allowed_outcomes.includes("pass") || !reviewType.allowed_outcomes.includes("rework_required")) {
      throw new Error(`review-boundaries missing pass/rework outcome for ${reviewType.review_type}`);
    }
    if (!reviewType.allowed_outcomes.includes("blocked") || !reviewType.allowed_outcomes.includes("evidence_gap")) {
      throw new Error(`review-boundaries missing blocked/evidence_gap outcome for ${reviewType.review_type}`);
    }
    ensureKeys(`${reviewType.review_type}.independence_requirements`, reviewType.independence_requirements, [
      "separate_reviewer_stage_or_instance",
      "use_minimum_evidence_package",
      "allow_full_author_context",
      "allow_full_author_reasoning"
    ]);
    if (!reviewType.independence_requirements.separate_reviewer_stage_or_instance) {
      throw new Error(`review-boundaries must require a separate reviewer stage/instance for ${reviewType.review_type}`);
    }
    if (reviewType.independence_requirements.allow_full_author_context || reviewType.independence_requirements.allow_full_author_reasoning) {
      throw new Error(`review-boundaries may not allow full author context/reasoning for ${reviewType.review_type}`);
    }
    ensureKeys(`${reviewType.review_type}.missing_evidence_behavior`, reviewType.missing_evidence_behavior, [
      "allow_outcomes",
      "rework_requires_sufficient_evidence"
    ]);
    ensureArray(`${reviewType.review_type}.missing_evidence_behavior.allow_outcomes`, reviewType.missing_evidence_behavior.allow_outcomes);
    for (const outcome of reviewType.missing_evidence_behavior.allow_outcomes) {
      if (!reviewType.allowed_outcomes.includes(outcome)) {
        throw new Error(`review-boundaries missing-evidence outcome not declared in allowed_outcomes: ${reviewType.review_type} -> ${outcome}`);
      }
    }
    for (const field of reviewType.minimum_evidence_package) {
      if (!reviewType.required_evidence.includes(field)) {
        throw new Error(`review-boundaries minimum evidence package must be subset of required evidence: ${reviewType.review_type} -> ${field}`);
      }
    }
    if (reviewType.conditional_evidence_requirements) {
      ensureArray(`${reviewType.review_type}.conditional_evidence_requirements`, reviewType.conditional_evidence_requirements);
      for (const requirement of reviewType.conditional_evidence_requirements) {
        ensureKeys(`${reviewType.review_type}.conditional_evidence_requirement`, requirement, ["when", "required"]);
        ensureArray(`${reviewType.review_type}.conditional_evidence_requirement.required`, requirement.required);
      }
    }
  }

  for (const passStatus of docs["writeback-levels"].pass_statuses) {
    ensureKeys(`writeback-levels.${passStatus.pass_id}`, passStatus, ["pass_id", "review_type", "reviewer_role_id"]);
    if (!reviewTypes.has(passStatus.review_type)) {
      throw new Error(`writeback-levels references unknown review type: ${passStatus.pass_id} -> ${passStatus.review_type}`);
    }
    if (!roles.has(passStatus.reviewer_role_id)) {
      throw new Error(`writeback-levels references unknown reviewer role: ${passStatus.pass_id} -> ${passStatus.reviewer_role_id}`);
    }
  }

  for (const route of docs["routing-table"].routes) {
    ensureKeys(`routing-table.${route.route_id}`, route, [
      "route_id",
      "primary_type",
      "modifiers",
      "entry_skill",
      "skill_chain",
      "required_roles",
      "required_gates",
      "writeback_level"
    ]);
    ensureArray(`${route.route_id}.modifiers`, route.modifiers);
    ensureArray(`${route.route_id}.skill_chain`, route.skill_chain);
    ensureArray(`${route.route_id}.required_roles`, route.required_roles);
    ensureArray(`${route.route_id}.required_gates`, route.required_gates);
    ensureSkillExists(route.entry_skill);
    for (const skill of route.skill_chain) {
      ensureSkillExists(skill);
    }
    for (const state of route.required_gates) {
      if (!states.has(state)) {
        throw new Error(`routing-table references unknown gate/state: ${route.route_id} -> ${state}`);
      }
    }
    for (const role of route.required_roles) {
      if (!roles.has(role)) {
        throw new Error(`routing-table references unknown role: ${route.route_id} -> ${role}`);
      }
      if (role === "reviewer") {
        throw new Error(`routing-table may not use legacy reviewer alias: ${route.route_id}`);
      }
    }
    if (!levels.has(route.writeback_level)) {
      throw new Error(`routing-table references unknown writeback level: ${route.route_id} -> ${route.writeback_level}`);
    }
    if (route.conditional_handoffs) {
      ensureArray(`${route.route_id}.conditional_handoffs`, route.conditional_handoffs);
      for (const handoff of route.conditional_handoffs) {
        ensureKeys(`${route.route_id}.conditional_handoff`, handoff, ["condition", "skill_chain", "required_roles", "required_gates"]);
        ensureArray(`${route.route_id}.conditional_handoff.skill_chain`, handoff.skill_chain);
        ensureArray(`${route.route_id}.conditional_handoff.required_roles`, handoff.required_roles);
        ensureArray(`${route.route_id}.conditional_handoff.required_gates`, handoff.required_gates);
        for (const skill of handoff.skill_chain) {
          ensureSkillExists(skill);
        }
        for (const role of handoff.required_roles) {
          if (!roles.has(role)) {
            throw new Error(`routing-table conditional handoff references unknown role: ${route.route_id} -> ${role}`);
          }
        }
        for (const state of handoff.required_gates) {
          if (!states.has(state)) {
            throw new Error(`routing-table conditional handoff references unknown gate/state: ${route.route_id} -> ${state}`);
          }
        }
      }
    }
  }

  ensureArray("writeback-levels.route_writeback_matrix", docs["writeback-levels"].route_writeback_matrix);
  for (const entry of docs["writeback-levels"].route_writeback_matrix) {
    ensureKeys(`writeback-levels.route_writeback_matrix.${entry.route_id}`, entry, [
      "route_id",
      "scenario",
      "required_passes",
      "required_gate",
      "allowed_writeback_level",
      "required_preconditions"
    ]);
    if (!routeIds.has(entry.route_id)) {
      throw new Error(`writeback-levels references unknown route: ${entry.route_id}`);
    }
    ensureArray(`${entry.route_id}.${entry.scenario}.required_passes`, entry.required_passes);
    ensureArray(`${entry.route_id}.${entry.scenario}.required_preconditions`, entry.required_preconditions);
    if (!states.has(entry.required_gate)) {
      throw new Error(`writeback-levels references unknown gate/state: ${entry.route_id} -> ${entry.required_gate}`);
    }
    if (!levels.has(entry.allowed_writeback_level)) {
      throw new Error(`writeback-levels references unknown writeback level: ${entry.route_id} -> ${entry.allowed_writeback_level}`);
    }
    for (const passStatus of entry.required_passes) {
      if (!passStatuses.has(passStatus)) {
        throw new Error(`writeback-levels references unknown pass status: ${entry.route_id} -> ${passStatus}`);
      }
    }
    if (entry.forbidden_writeback_levels) {
      ensureArray(`${entry.route_id}.${entry.scenario}.forbidden_writeback_levels`, entry.forbidden_writeback_levels);
      for (const level of entry.forbidden_writeback_levels) {
        if (!levels.has(level)) {
          throw new Error(`writeback-levels references unknown forbidden writeback level: ${entry.route_id} -> ${level}`);
        }
      }
    }
  }

  const overlaySchema = readJsonLike("schemas/overlay.schema.json");
  ensureRequired("overlay.schema", overlaySchema, overlaySchema);
  ensureArray("overlay.allowed_fields", overlaySchema.allowed_fields);
  ensureArray("overlay.restrict_only_fields", overlaySchema.restrict_only_fields);
  ensureArray("overlay.forbidden_fields", overlaySchema.forbidden_fields);

  console.log("cutepower contracts validation passed");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
