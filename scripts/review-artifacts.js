#!/usr/bin/env node
'use strict';

const FUNCTIONAL_REVIEW_REQUIRED_ARTIFACTS = Object.freeze([
  'requirements_package',
  'acceptance_items',
  'evidence_plan',
  'relevant_context',
  'evidence_manifest',
  'evidence_gaps',
  'review_decision',
  'compliance_matrix',
]);

function normalizeArray(value, preferredKeys = []) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) {
      return value[key];
    }
  }
  return [];
}

function normalizeRequirements(artifact) {
  return normalizeArray(artifact, ['requirements', 'items']);
}

function normalizeAcceptanceItems(artifact) {
  return normalizeArray(artifact, ['acceptance_items', 'items']);
}

function normalizeEvidenceEntries(artifact) {
  return normalizeArray(artifact, ['evidence', 'entries', 'items']);
}

function normalizeEvidenceGaps(artifact) {
  return normalizeArray(artifact, ['gaps', 'items']);
}

function normalizeComplianceRows(artifact) {
  return normalizeArray(artifact, ['rows', 'matrix', 'items']);
}

function normalizeAllowedPaths(evidencePlan, relevantContext) {
  const raw = [
    ...normalizeArray(evidencePlan, ['allowed_paths']),
    ...normalizeArray(relevantContext, ['allowed_paths', 'core_paths', 'paths']),
  ];
  return Array.from(new Set(raw.map((item) => String(item)).filter(Boolean)));
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function pathAllowedForEvidence(evidence, allowedPaths) {
  if (allowedPaths.length === 0) {
    return true;
  }
  const evidencePath = String(
    evidence.path
    || evidence.file
    || evidence.source_path
    || evidence.context_path
    || ''
  );
  if (!evidencePath) {
    return true;
  }
  return allowedPaths.some((allowedPath) => evidencePath.includes(allowedPath));
}

function buildRequirementRow({ requirement, acceptanceIds, evidenceIds, status, notes }) {
  return {
    requirement_id: String(requirement.requirement_id || requirement.id || ''),
    acceptance_item_ids: acceptanceIds,
    evidence_ids: evidenceIds,
    status,
    notes,
  };
}

function isFunctionalReviewSession(hostRuntime, artifacts = {}) {
  const routeId = String(hostRuntime?.route_id || '');
  const capability = String(hostRuntime?.capability || '');
  const taskProfile = artifacts.task_profile || null;
  return routeId === 'explicit_read_only_functional_audit'
    || capability === 'functional_audit_read_only'
    || taskProfile?.primary_type === 'functional_audit';
}

function validateFunctionalReviewArtifacts(artifacts = {}) {
  const requirements = normalizeRequirements(artifacts.requirements_package);
  const acceptanceItems = normalizeAcceptanceItems(artifacts.acceptance_items);
  const evidenceEntries = normalizeEvidenceEntries(artifacts.evidence_manifest);
  const declaredGaps = normalizeEvidenceGaps(artifacts.evidence_gaps);
  const complianceRows = normalizeComplianceRows(artifacts.compliance_matrix);
  const allowedPaths = normalizeAllowedPaths(artifacts.evidence_plan, artifacts.relevant_context);

  const acceptanceById = new Map();
  for (const item of acceptanceItems) {
    const acceptanceId = String(item.acceptance_item_id || item.id || '');
    if (acceptanceId) {
      acceptanceById.set(acceptanceId, item);
    }
  }

  const validEvidenceByAcceptance = new Map();
  const invalidEvidence = [];
  const orphanEvidence = [];

  for (const evidence of evidenceEntries) {
    const evidenceId = String(evidence.evidence_id || evidence.id || evidence.observation_id || '');
    const acceptanceIds = normalizeStringArray(
      evidence.acceptance_item_ids
      || evidence.supported_acceptance_item_ids
      || evidence.covers_acceptance_items
    );
    const pathAllowed = pathAllowedForEvidence(evidence, allowedPaths);

    if (acceptanceIds.length === 0) {
      orphanEvidence.push({
        evidence_id: evidenceId,
        reason: 'evidence_not_mapped_to_acceptance_item',
      });
      continue;
    }

    if (!pathAllowed) {
      invalidEvidence.push({
        evidence_id: evidenceId,
        acceptance_item_ids: acceptanceIds,
        reason: 'evidence_outside_allowed_review_context',
      });
      continue;
    }

    for (const acceptanceId of acceptanceIds) {
      const bucket = validEvidenceByAcceptance.get(acceptanceId) || [];
      bucket.push(evidenceId);
      validEvidenceByAcceptance.set(acceptanceId, bucket);
    }
  }

  const computedGaps = [];
  const computedRows = [];

  for (const requirement of requirements) {
    const requirementId = String(requirement.requirement_id || requirement.id || '');
    const mappedAcceptance = acceptanceItems.filter((item) =>
      normalizeStringArray(item.mapped_requirement_ids || item.requirement_ids).includes(requirementId)
    );
    const acceptanceIds = mappedAcceptance.map((item) => String(item.acceptance_item_id || item.id || '')).filter(Boolean);
    const evidenceIds = Array.from(new Set(
      acceptanceIds.flatMap((acceptanceId) => validEvidenceByAcceptance.get(acceptanceId) || [])
    ));

    if (acceptanceIds.length === 0) {
      computedGaps.push({
        requirement_id: requirementId,
        acceptance_item_id: null,
        reason: 'requirement_missing_acceptance_mapping',
        blocker: true,
      });
      computedRows.push(buildRequirementRow({
        requirement,
        acceptanceIds: [],
        evidenceIds: [],
        status: 'gap',
        notes: 'Requirement has no mapped acceptance item.',
      }));
      continue;
    }

    const uncoveredAcceptance = acceptanceIds.filter((acceptanceId) => (validEvidenceByAcceptance.get(acceptanceId) || []).length === 0);
    for (const acceptanceId of uncoveredAcceptance) {
      computedGaps.push({
        requirement_id: requirementId,
        acceptance_item_id: acceptanceId,
        reason: 'acceptance_item_missing_evidence_coverage',
        blocker: true,
      });
    }

    computedRows.push(buildRequirementRow({
      requirement,
      acceptanceIds,
      evidenceIds,
      status: uncoveredAcceptance.length === 0 ? 'pass' : 'gap',
      notes: uncoveredAcceptance.length === 0
        ? 'Requirement is covered by mapped evidence.'
        : `Missing evidence coverage for acceptance items: ${uncoveredAcceptance.join(', ')}`,
    }));
  }

  for (const evidence of invalidEvidence) {
    for (const acceptanceId of evidence.acceptance_item_ids) {
      const acceptanceItem = acceptanceById.get(acceptanceId);
      const mappedRequirementIds = normalizeStringArray(
        acceptanceItem?.mapped_requirement_ids
        || acceptanceItem?.requirement_ids
      );
      for (const requirementId of mappedRequirementIds) {
        computedGaps.push({
          requirement_id: requirementId,
          acceptance_item_id: acceptanceId,
          reason: 'evidence_outside_allowed_review_context',
          blocker: true,
        });
      }
    }
  }

  const declaredGapKeys = new Set(declaredGaps.map((gap) => JSON.stringify({
    requirement_id: gap.requirement_id || null,
    acceptance_item_id: gap.acceptance_item_id || null,
    reason: gap.reason || null,
  })));
  const missingDeclaredGaps = computedGaps.filter((gap) => !declaredGapKeys.has(JSON.stringify({
    requirement_id: gap.requirement_id || null,
    acceptance_item_id: gap.acceptance_item_id || null,
    reason: gap.reason || null,
  })));

  const complianceByRequirement = new Map(
    complianceRows.map((row) => [String(row.requirement_id || ''), row])
  );
  const complianceIssues = [];

  for (const row of computedRows) {
    const provided = complianceByRequirement.get(row.requirement_id);
    if (!provided) {
      complianceIssues.push({
        requirement_id: row.requirement_id,
        reason: 'compliance_matrix_missing_requirement_row',
      });
      continue;
    }
    const providedStatus = String(provided.status || '');
    if (row.status === 'gap' && providedStatus === 'pass') {
      complianceIssues.push({
        requirement_id: row.requirement_id,
        reason: 'compliance_matrix_masks_gap_as_pass',
      });
    }
  }

  const reviewDecision = artifacts.review_decision || {};
  const decision = String(reviewDecision.decision || '');
  const blockedBy = normalizeStringArray(reviewDecision.blocked_by);
  const allowsCompleted = reviewDecision.allow_completed !== false
    && reviewDecision.allows_completed !== false;
  const declaredBlockerGapCount = declaredGaps.filter((gap) => gap && gap.blocker).length;
  const blockerGapCount = Math.max(
    computedGaps.filter((gap) => gap.blocker).length,
    declaredBlockerGapCount
  );
  const decisionIssues = [];

  if (blockerGapCount > 0 && ['approved', 'pass', 'passed'].includes(decision)) {
    decisionIssues.push({
      reason: 'review_decision_approves_despite_blocking_evidence_gaps',
      blocker_gap_count: blockerGapCount,
    });
  }
  if (blockerGapCount > 0 && blockedBy.length === 0) {
    decisionIssues.push({
      reason: 'review_decision_missing_blocked_by_for_evidence_gaps',
      blocker_gap_count: blockerGapCount,
    });
  }
  if (blockerGapCount > 0 && allowsCompleted) {
    decisionIssues.push({
      reason: 'review_decision_allows_completed_with_blocking_gaps',
      blocker_gap_count: blockerGapCount,
    });
  }

  return {
    required_artifacts: FUNCTIONAL_REVIEW_REQUIRED_ARTIFACTS,
    coverage_summary: {
      requirements: requirements.length,
      acceptance_items: acceptanceItems.length,
      evidence_entries: evidenceEntries.length,
      blocker_gaps: blockerGapCount,
      orphan_evidence: orphanEvidence.length,
      invalid_evidence: invalidEvidence.length,
    },
    computed_compliance_matrix: {
      rows: computedRows,
    },
    computed_evidence_gaps: computedGaps,
    orphan_evidence: orphanEvidence,
    invalid_evidence: invalidEvidence,
    missing_declared_gaps: missingDeclaredGaps,
    compliance_issues: complianceIssues,
    decision_issues: decisionIssues,
    completion_ready: blockerGapCount === 0
      && missingDeclaredGaps.length === 0
      && complianceIssues.length === 0
      && decisionIssues.length === 0,
  };
}

module.exports = {
  FUNCTIONAL_REVIEW_REQUIRED_ARTIFACTS,
  isFunctionalReviewSession,
  normalizeAcceptanceItems,
  normalizeComplianceRows,
  normalizeEvidenceEntries,
  normalizeEvidenceGaps,
  normalizeRequirements,
  validateFunctionalReviewArtifacts,
};
