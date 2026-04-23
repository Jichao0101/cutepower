'use strict';

function includesAction(hostRuntime, action) {
  return Array.isArray(hostRuntime.allowed_actions)
    && hostRuntime.allowed_actions.includes(action);
}

function pathAllowed(hostRuntime, command) {
  return (hostRuntime.allowed_paths || []).some((allowedPath) => command.includes(allowedPath));
}

function gateToolAction({ action, hostRuntime, command }) {
  if (action === 'runtime_discovery_read') {
    return {
      decision: 'allow',
      status: 'ready',
      reason: 'runtime_discovery_read_allowed',
    };
  }

  if (action === 'repo_local_verification_exec') {
    if (!/node\s+scripts\/test-[\w-]+\.js(?:\s|$)/.test(command)) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'repo_local_verification_exec_only_allows_repo_test_scripts',
      };
    }
    if (
      Array.isArray(hostRuntime.allowed_actions)
      && hostRuntime.allowed_actions.length > 0
      && !includesAction(hostRuntime, action)
    ) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'route_missing_repo_local_verification_exec',
      };
    }
    if (
      hostRuntime.phase
      && hostRuntime.phase !== 'implementation'
      && hostRuntime.phase !== 'verification'
    ) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'repo_local_verification_exec_outside_implementation_phase',
      };
    }
    return {
      decision: 'allow',
      status: 'ready',
      reason: 'repo_local_verification_exec_allowed',
    };
  }

  if (action === 'authorized_business_context_read') {
    if (!includesAction(hostRuntime, action)) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'route_missing_authorized_business_context_read',
      };
    }
    if (!['evidence_collection', 'implementation'].includes(hostRuntime.phase)) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'authorized_business_context_read_outside_evidence_collection_phase',
      };
    }
    if (!['read_only', 'implementation'].includes(hostRuntime.evidence_collection_mode)) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'authorized_business_context_read_requires_read_only_evidence_collection_mode',
      };
    }
    if (!pathAllowed(hostRuntime, command)) {
      return {
        decision: 'deny',
        status: 'blocked',
        reason: 'authorized_business_context_read_outside_allowed_paths',
      };
    }
    return {
      decision: 'allow',
      status: 'ready',
      reason: 'authorized_business_context_read_allowed_for_read_only_audit',
    };
  }

  return {
    decision: 'deny',
    status: 'denied',
    reason: 'forbidden_business_context_read_denied',
  };
}

function artifactStatus(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value.status || value.decision || null;
}

function buildBlockedTerminalArtifacts({ sessionId, routeId, blockedReason }) {
  return {
    evidence_manifest: {
      session_id: sessionId,
      route_id: routeId,
      status: 'blocked',
      reason: blockedReason,
    },
    review_decision: {
      session_id: sessionId,
      route_id: routeId,
      decision: 'blocked',
      reason: blockedReason,
    },
    writeback_declined: {
      session_id: sessionId,
      route_id: routeId,
      status: 'declined',
      reason: 'blocked_review_cannot_writeback',
    },
    terminal_phase: 'blocked_closed',
  };
}

function evaluateStopGate({ hostRuntime, artifacts = {} }) {
  const evidenceStatus = artifactStatus(artifacts.evidence_manifest);
  const reviewStatus = artifactStatus(artifacts.review_decision);
  const hasWritebackReceipt = Boolean(artifacts.writeback_receipt);
  const hasWritebackDeclined = Boolean(artifacts.writeback_declined);
  const terminalPhase = artifacts.terminal_phase || null;

  if (
    evidenceStatus === 'blocked'
    && reviewStatus === 'blocked'
    && hasWritebackDeclined
    && terminalPhase === 'blocked_closed'
  ) {
    return {
      decision: 'allow',
      status: 'completed',
      reason: 'blocked_review_terminal_state_closed',
      terminal_phase: terminalPhase,
      terminal_outcome: 'blocked',
    };
  }

  if (
    evidenceStatus === 'complete'
    && reviewStatus === 'approved'
    && (hasWritebackDeclined || hasWritebackReceipt)
    && terminalPhase === 'closed'
  ) {
    return {
      decision: 'allow',
      status: 'completed',
      reason: 'review_terminal_state_closed',
      terminal_phase: terminalPhase,
      terminal_outcome: 'completed',
    };
  }

  const required = [
    'evidence_manifest',
    'review_decision',
    'writeback_receipt_or_writeback_declined',
    'terminal_phase',
  ];

  return {
    decision: 'pass_through',
    status: 'skipped',
    reason: 'run_is_not_closed',
    required,
    terminal_phase: terminalPhase,
  };
}

module.exports = {
  buildBlockedTerminalArtifacts,
  evaluateStopGate,
  gateToolAction,
};
