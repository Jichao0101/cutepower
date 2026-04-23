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

function ensurePluginPathExists(relativePath, description) {
  const fullPath = path.join(pluginRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`${description} is missing: ${relativePath}`);
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
  const skillRouteIds = new Set((docs["skill-route-matrix"]?.routes || []).map((route) => route.route_id));
  const passStatuses = new Set(docs["writeback-levels"].pass_statuses.map((passStatus) => passStatus.pass_id));

  ensureUnique("role ids", [...roles]);
  ensureUnique("route ids", [...routeIds]);
  ensureUnique("review type ids", [...reviewTypes]);
  ensureUnique("writeback pass ids", [...passStatuses]);

  ensureArray("task-normalization.primary_type_rules", docs["task-normalization"].primary_type_rules);
  ensureArray("task-normalization.modifier_rules", docs["task-normalization"].modifier_rules);
  ensureArray("task-normalization.context_rules", docs["task-normalization"].context_rules);
  ensureKeys("task-normalization.activation", docs["task-normalization"].activation, [
    "mode",
    "entry_skill",
    "profile_output",
    "autostart_primary_types",
    "prefer_intake_for_engineering_signals",
    "engineering_signal_terms",
    "fallback_behavior",
    "runtime_entry",
    "runtime_discovery"
  ]);
  ensureSkillExists(docs["task-normalization"].activation.entry_skill);
  ensureArray("task-normalization.activation.autostart_primary_types", docs["task-normalization"].activation.autostart_primary_types);
  ensureArray("task-normalization.activation.engineering_signal_terms", docs["task-normalization"].activation.engineering_signal_terms);
  ensureKeys("task-normalization.activation.runtime_entry", docs["task-normalization"].activation.runtime_entry, [
    "mandatory_dispatcher_skill",
    "intake_script",
    "route_resolution_output",
    "runtime_gate_output",
    "dispatch_output",
    "protected_execution_skills"
  ]);
  ensureSkillExists(docs["task-normalization"].activation.runtime_entry.mandatory_dispatcher_skill);
  ensurePluginPathExists(docs["task-normalization"].activation.runtime_entry.intake_script, "task-normalization runtime intake script");
  ensureArray(
    "task-normalization.activation.runtime_entry.protected_execution_skills",
    docs["task-normalization"].activation.runtime_entry.protected_execution_skills
  );
  for (const skillName of docs["task-normalization"].activation.runtime_entry.protected_execution_skills) {
    ensureSkillExists(skillName);
  }
  ensureKeys("task-normalization.activation.runtime_discovery", docs["task-normalization"].activation.runtime_discovery, [
    "keywords",
    "allowed_roots"
  ]);
  ensureArray("task-normalization.activation.runtime_discovery.keywords", docs["task-normalization"].activation.runtime_discovery.keywords);
  ensureArray("task-normalization.activation.runtime_discovery.allowed_roots", docs["task-normalization"].activation.runtime_discovery.allowed_roots);
  ensureKeys("task-normalization.guardrails", docs["task-normalization"].guardrails, [
    "strip_write_modifiers_when_read_only",
    "never_infer_board_target",
    "ambiguous_primary_type_result",
    "no_keyword_hard_skill_jump",
    "require_route_resolution_before_execution"
  ]);
  for (const rule of docs["task-normalization"].primary_type_rules) {
    ensureKeys(`task-normalization.primary_type_rule.${rule.primary_type}`, rule, [
      "primary_type",
      "priority",
      "match_any",
      "add_modifiers"
    ]);
    ensureArray(`task-normalization.primary_type_rule.${rule.primary_type}.match_any`, rule.match_any);
    ensureArray(`task-normalization.primary_type_rule.${rule.primary_type}.add_modifiers`, rule.add_modifiers);
  }
  for (const rule of docs["task-normalization"].modifier_rules) {
    ensureKeys(`task-normalization.modifier_rule.${rule.modifier}`, rule, ["modifier", "priority", "match_any"]);
    ensureArray(`task-normalization.modifier_rule.${rule.modifier}.match_any`, rule.match_any);
  }
  for (const rule of docs["task-normalization"].context_rules) {
    ensureKeys(`task-normalization.context_rule.${rule.field_id}`, rule, ["field_id", "infer_from", "missing_behavior"]);
    if (rule.required_for_primary_types) {
      ensureArray(`task-normalization.context_rule.${rule.field_id}.required_for_primary_types`, rule.required_for_primary_types);
    }
    if (rule.required_when_modifiers) {
      ensureArray(`task-normalization.context_rule.${rule.field_id}.required_when_modifiers`, rule.required_when_modifiers);
    }
    if (rule.required_when_keywords) {
      ensureArray(`task-normalization.context_rule.${rule.field_id}.required_when_keywords`, rule.required_when_keywords);
    }
  }

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

  ensureArray("skill-route-matrix.routes", docs["skill-route-matrix"].routes);
  for (const route of docs["routing-table"].routes) {
    if (!skillRouteIds.has(route.route_id)) {
      throw new Error(`skill-route-matrix missing route: ${route.route_id}`);
    }
  }
  const protectedSkills = new Set(docs["task-normalization"].activation.runtime_entry.protected_execution_skills);
  for (const route of docs["skill-route-matrix"].routes) {
    ensureKeys(`skill-route-matrix.${route.route_id}`, route, [
      "route_id",
      "dispatcher_skill",
      "ordered_skills"
    ]);
    if (!routeIds.has(route.route_id)) {
      throw new Error(`skill-route-matrix references unknown route: ${route.route_id}`);
    }
    ensureSkillExists(route.dispatcher_skill);
    ensureArray(`skill-route-matrix.${route.route_id}.ordered_skills`, route.ordered_skills);
    const routingRoute = docs["routing-table"].routes.find((entry) => entry.route_id === route.route_id);
    const orderedSkillIds = route.ordered_skills.map((entry) => entry.skill_id);
    if (JSON.stringify(orderedSkillIds) !== JSON.stringify(routingRoute.skill_chain)) {
      throw new Error(`skill-route-matrix skill order mismatch for route: ${route.route_id}`);
    }
    for (let index = 0; index < route.ordered_skills.length; index += 1) {
      const skill = route.ordered_skills[index];
      ensureKeys(`skill-route-matrix.${route.route_id}.${skill.skill_id}`, skill, [
        "skill_id",
        "phase",
        "allow_direct_entry",
        "allowed_predecessors",
        "required_artifacts_in",
        "required_artifacts_out"
      ]);
      ensureSkillExists(skill.skill_id);
      ensureArray(`skill-route-matrix.${route.route_id}.${skill.skill_id}.allowed_predecessors`, skill.allowed_predecessors);
      ensureArray(`skill-route-matrix.${route.route_id}.${skill.skill_id}.required_artifacts_in`, skill.required_artifacts_in);
      ensureArray(`skill-route-matrix.${route.route_id}.${skill.skill_id}.required_artifacts_out`, skill.required_artifacts_out);
      if (!states.has(skill.phase)) {
        throw new Error(`skill-route-matrix references unknown phase/state: ${route.route_id} -> ${skill.skill_id} -> ${skill.phase}`);
      }
      if (skill.allow_direct_entry !== false) {
        throw new Error(`skill-route-matrix may not allow direct governed entry: ${route.route_id} -> ${skill.skill_id}`);
      }
      if (!protectedSkills.has(skill.skill_id)) {
        throw new Error(`task-normalization protected_execution_skills missing governed skill: ${skill.skill_id}`);
      }
      const expectedPredecessor = index === 0
        ? route.dispatcher_skill
        : route.ordered_skills[index - 1].skill_id;
      if (!skill.allowed_predecessors.includes(expectedPredecessor)) {
        throw new Error(`skill-route-matrix predecessor mismatch: ${route.route_id} -> ${skill.skill_id}`);
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
