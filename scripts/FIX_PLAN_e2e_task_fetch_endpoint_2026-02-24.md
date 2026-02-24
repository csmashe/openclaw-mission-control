# Mini Fix Plan — E2E task status polling 404 (2026-02-24)

## Root cause
`e2e_auto_transition_waits.mjs` polls `GET /api/tasks/:id`, but Mission Control does not expose that route.
Result: polling path always 404s, `waitForApiStatusAny` never sees status changes, and the run fails at the ack window even when task status actually advanced.

## Options considered
1. Add a new API route `GET /api/tasks/:id`.
2. Keep product API unchanged and update the E2E script to poll via `GET /api/tasks` then filter by `id`.
3. Query DB directly from script.

## Chosen patch
Option 2 (script-only):
- replace `fetchTask(taskId)` implementation to call `GET /api/tasks` and select the matching task by id.
- preserve existing evidence/wait behavior.

## Validation
- `npm run build`
- restart app on `:3080`
- rerun `node scripts/e2e_auto_transition_waits.mjs`
- confirm pass JSON + evidence artifacts
