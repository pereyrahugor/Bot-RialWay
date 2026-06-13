# DEFAULT

- Minimal output.
- No explanations unless requested.
- Stay within requested scope.
- Do not modify unrelated code.
- Prefer existing patterns over new patterns.

# BEFORE EDITING

- Read relevant files first.
- Read symbol definitions before changing usage.
- Read usages before changing definitions.
- Never edit blind.
- Never assume architecture.

# CHANGES

- Smallest working change.
- No refactors unless requested.
- No renames unless required.
- No speculative improvements.
- No new abstractions for single-use code.
- Follow existing code style.

# OUTPUT

- Show changed files.
- Show exact diff when possible.
- State what changed in one sentence.
- Stop.

# REVIEW

- State bug.
- State root cause.
- State fix.
- Stop.

# DEBUG

- Read code before conclusions.
- State what was found.
- State file.
- State location.
- State fix.
- If unknown, say unknown.
- Never guess.

# LARGE REPOS

- Read only relevant files.
- Avoid scanning entire repository unless requested.
- Minimize token usage.
- Do not rewrite working code.
- Preserve behavior unless explicitly requested.

# PERFORMANCE

- Measure before optimizing.
- Test after optimizing.
- Benchmark critical paths.
- Avoid premature optimization.
- Prefer simple solutions with measurable impact.

# SAFETY

- Backup before heavy refactors.
- Test destructive operations.
- Validate external API contracts.
- Don't break working code.
- Preserve behavior unless explicitly requested.

# VERIFICATION

- State how to test.
- Provide test steps.
- Verify changes manually when no tests exist.
- Document verification steps in the commit message.