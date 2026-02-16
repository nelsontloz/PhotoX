# AGENTS.md

## Purpose
This repository uses docs-first execution. Every coding agent must read `/docs` before making changes.

## Mandatory First Reads (in order)
1. `docs/06-ai-agent-master-runbook.md`
2. `docs/07-ai-agent-task-contracts.md`
3. `docs/08-service-implementation-spec.md`
4. `docs/09-testing-and-quality-gates.md`
5. `docs/10-execution-checklists-and-handoffs.md`
6. `docs/11-current-implementation-status.md`
7. `docs/05-local-dev-quickstart.md`

## Required Workflow
- Identify task scope and acceptance criteria in docs before coding.
- Keep API behavior under `/api/v1` unless docs/contracts are updated together.
- Implement changes following service specs and architecture constraints in docs.
- Add/update unit and integration tests for non-trivial changes.
- Run quality gates from `docs/09-testing-and-quality-gates.md`.
- Provide a final handoff report matching the template in `docs/06-ai-agent-master-runbook.md`.

## Docs-First Policy
- If a request is ambiguous, resolve it using `/docs` first.
- If code and docs conflict, call out the conflict explicitly and propose the smallest safe fix.
- Do not mark work complete without matching docs/tests/gates updates when required by docs.

## Security and Reliability Baseline
- Never introduce hardcoded secrets.
- Preserve health/metrics and OpenAPI/Swagger endpoints for services.
- Avoid breaking changes without contract and test updates.

## Operational Notes
- Prefer repository-local conventions over generic defaults.
- Keep changes scoped, auditable, and test-backed.
