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

function ensureArray(name, value) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}

function main() {
  const index = readJsonLike("contracts/contract-index.yaml");
  const indexSchema = readJsonLike("schemas/contract-index.schema.json");
  ensureRequired("contract-index", index, indexSchema);
  ensureArray("contract-index.contracts", index.contracts);

  const docs = {};
  for (const entry of index.contracts) {
    for (const key of ["id", "path", "schema_path", "version", "status", "precedence"]) {
      if (!(key in entry)) {
        throw new Error(`contract-index entry missing ${key}`);
      }
    }
    const doc = readJsonLike(entry.path);
    const schema = readJsonLike(entry.schema_path);
    ensureRequired(entry.id, doc, schema);
    docs[entry.id] = doc;
  }

  const states = new Set(docs["gate-matrix"].states);
  const actions = new Set(docs["gate-matrix"].actions);
  const roles = new Set(docs["role-contracts"].roles.map((role) => role.role_id));
  const levels = new Set(docs["writeback-levels"].levels.map((level) => level.level_id));

  for (const rule of docs["gate-matrix"].rules) {
    if (!states.has(rule.state)) {
      throw new Error(`gate-matrix rule references unknown state: ${rule.state}`);
    }
    for (const action of [...rule.allow, ...rule.deny]) {
      if (!actions.has(action)) {
        throw new Error(`gate-matrix rule references unknown action: ${action}`);
      }
    }
  }

  for (const role of docs["role-contracts"].roles) {
    ensureArray(`${role.role_id}.allowed_actions`, role.allowed_actions);
    for (const action of role.allowed_actions) {
      if (!actions.has(action)) {
        throw new Error(`role-contracts references unknown action: ${role.role_id} -> ${action}`);
      }
    }
  }

  for (const route of docs["routing-table"].routes) {
    for (const state of route.required_gates) {
      if (!states.has(state)) {
        throw new Error(`routing-table references unknown gate/state: ${route.route_id} -> ${state}`);
      }
    }
    for (const role of route.required_roles) {
      if (!roles.has(role)) {
        throw new Error(`routing-table references unknown role: ${route.route_id} -> ${role}`);
      }
    }
    if (!levels.has(route.writeback_level)) {
      throw new Error(`routing-table references unknown writeback level: ${route.route_id} -> ${route.writeback_level}`);
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
