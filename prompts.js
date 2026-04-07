/**
 * prompts.js — Modular AI prompt builders for code review.
 *
 * Entry point:
 *   buildSystemPrompt(config)  — switches between strict / standard mode
 *   buildUserPrompt(...)       — assembles the user-side context
 *
 * Config fields that drive behaviour:
 *   strict_mode          boolean  — use strict 6-point analysis (default: false)
 *   strictness           string   — 'low' | 'medium' | 'high'  (default: 'medium')
 *   check_edge_cases     boolean
 *   check_code_structure boolean
 *   check_performance    boolean
 *   check_security       boolean
 *   check_best_practices boolean
 *   check_unit_tests     boolean
 */

// ─── JSON schema shared by both prompts ───────────────────────────────────────

const RESPONSE_SCHEMA = `{
  "summary": "<concise overview of what the PR does and overall quality>",
  "verdict": "approve" | "needs_changes",
  "confidence_score": <integer 0–100>,
  "issues": [
    {
      "category": "logical_error" | "return_value" | "unused_variable" | "naming_mismatch" | "edge_case" | "code_quality" | "security" | "performance" | "test_coverage",
      "file": "<filename as in the diff header, or \\"general\\">",
      "line": <integer line number in the NEW file, or null>,
      "severity": "high" | "medium" | "low",
      "issue": "<description of the problem>",
      "suggestion": "<actionable fix>"
    }
  ]
}`;

const VERDICT_RULE = `verdict rules:
- "needs_changes" if there is ANY high or medium severity issue
- "approve"       only when all issues are low severity or the issues array is empty`;

// ─── Depth instructions by strictness level ───────────────────────────────────

function depthLine(strictness, mode) {
  if (mode === 'strict') {
    if (strictness === 'low')  return 'Focus ONLY on high-severity issues (breaks functionality, security holes, data loss). Skip low-severity style issues.';
    if (strictness === 'high') return 'Be EXHAUSTIVE. Surface every issue — high, medium, and low — including minor style, naming, and micro-optimisations. Leave nothing out.';
    return 'Surface all high and medium issues. Include low-severity issues when they indicate a pattern or risk.';
  }
  if (strictness === 'low')  return 'Focus only on critical problems that break functionality, cause security holes, or risk data loss. Keep feedback concise.';
  if (strictness === 'high') return 'Be thorough. Surface all issues including minor style, structure, and naming improvements.';
  return 'Provide balanced feedback. Focus on meaningful issues while noting minor concerns briefly.';
}

// ─── Strict mode system prompt ────────────────────────────────────────────────

function buildStrictSystemPrompt(config = {}) {
  const strictness = config.strictness || 'medium';

  const checks = [
    '1. Logical errors — wrong conditions, off-by-one, incorrect branching',
    '2. Incorrect return values — functions returning wrong type, null/undefined leaks',
    '3. Unused variables — declared but never read, dead assignments',
    '4. Mismatch between function name and implementation — misleading names',
  ];

  if (config.check_edge_cases     !== false) checks.push('5. Edge cases — empty input, null/undefined, empty arrays, zero, negative numbers, concurrent calls');
  if (config.check_security       !== false) checks.push('6. Security — injection, auth bypass, insecure defaults, exposed secrets');
  if (config.check_performance    !== false) checks.push('7. Performance — N+1 queries, unnecessary loops, blocking I/O, memory leaks');
  if (config.check_best_practices !== false) checks.push('8. Code quality — duplication, magic numbers, overly complex logic, missing error handling');
  if (config.check_unit_tests     !== false) checks.push('9. Test coverage — untested paths, missing assertions, brittle tests');
  if (config.check_code_structure !== false) checks.push('10. Code structure — poor separation of concerns, circular dependencies, deep nesting');

  return `You are a STRICT senior software engineer doing a code review. Do NOT assume code is correct. Your job is to find issues.

Depth: ${depthLine(strictness, 'strict')}

Analyse the PR diff for ALL of the following:
${checks.join('\n')}

RULES:
- NEVER say "looks good" or "no issues" if ANY issue exists — no matter how minor
- Be critical and precise; explain WHY each item is an issue, not just what it is
- Every issue must include a concrete, actionable fix suggestion
- Severity guide:
    high   = breaks functionality, security hole, data loss risk
    medium = incorrect behaviour in common cases, bad practice with real impact
    low    = code smell, misleading name, missing edge-case guard, style

Respond ONLY with a valid JSON object — no markdown fences, no prose outside the JSON:

${RESPONSE_SCHEMA}

${VERDICT_RULE}`;
}

// ─── Standard mode system prompt ─────────────────────────────────────────────

function buildStandardSystemPrompt(config = {}) {
  const strictness = config.strictness || 'medium';

  return `You are an expert senior software engineer performing a code review.
${depthLine(strictness, 'standard')}

Analyse the PR diff and respond ONLY with a valid JSON object — no markdown fences, no prose outside the JSON:

${RESPONSE_SCHEMA}

Rules:
- Return ONLY JSON
- If the PR looks clean, return an empty issues array and a positive summary
- Be specific and actionable in every suggestion
- Use the exact file path as it appears in the diff header
- Line numbers must refer to lines in the NEW version of the file (right side of diff)
- ${VERDICT_RULE}`;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Returns the correct system prompt for the given project config.
 * If config.strict_mode is true → strict 6-point analysis prompt.
 * Otherwise → standard expert reviewer prompt.
 */
function buildSystemPrompt(config = {}) {
  return config.strict_mode
    ? buildStrictSystemPrompt(config)
    : buildStandardSystemPrompt(config);
}

// ─── User prompt ──────────────────────────────────────────────────────────────

function buildUserPrompt(diff, rules, docs, config, prDetails) {
  const checks = [];
  if (config?.check_edge_cases)     checks.push('edge cases and boundary conditions');
  if (config?.check_code_structure) checks.push('code structure and organisation');
  if (config?.check_performance)    checks.push('performance bottlenecks');
  if (config?.check_security)       checks.push('security vulnerabilities');
  if (config?.check_best_practices) checks.push('best practices and code quality');
  if (config?.check_unit_tests)     checks.push('unit test coverage gaps');

  const parts = [];

  if (prDetails) {
    parts.push(`PR: "${prDetails.title}" by @${prDetails.user?.login}`);
    if (prDetails.body?.trim()) {
      parts.push(`PR Description: ${prDetails.body.trim().substring(0, 500)}`);
    }
  }

  parts.push(
    `Mode: ${config?.strict_mode ? 'strict' : 'standard'} | Strictness: ${config?.strictness || 'medium'} (low = critical only, medium = balanced, high = exhaustive)`
  );

  if (checks.length) parts.push(`Focus areas: ${checks.join(', ')}`);

  if (rules?.length) {
    parts.push(`\nProject-specific rules:\n${rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}`);
  }

  if (docs?.trim()) {
    parts.push(`\nProject documentation / context:\n${docs.trim()}`);
  }

  const trimmedDiff =
    diff.length > 14000
      ? diff.substring(0, 14000) + '\n\n[...diff truncated for length...]'
      : diff;

  parts.push(`\nPR diff:\n\`\`\`diff\n${trimmedDiff}\n\`\`\``);
  return parts.join('\n');
}

module.exports = { buildSystemPrompt, buildUserPrompt };
