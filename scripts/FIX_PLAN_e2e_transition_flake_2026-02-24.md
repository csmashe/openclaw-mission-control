# Fix Plan — E2E transition flake (2026-02-24)

## Root-cause hypothesis
1. The transition test uses broad `text=${task.title}` locators. The same text can appear in non-card UI regions (activity feed, modal text), causing click/column checks to target wrong nodes.
2. Wait windows are still too optimistic for real async dispatch+completion timing, especially when an agent response is delayed.
3. The flow assumes a strict `... -> testing -> review -> done` path, but some runs can reach `review/done` quickly after testing trigger, and UI polling may miss short-lived intermediate states.

## Researcher ideas integrated
From researcher output (task `edf1ca49-ac74-42c2-91da-06aedd898410`):
- Explicitly model the **acknowledgement phase** after dispatch.
- Prefer **polling for state transitions** over fixed sleeps.
- Accept that transitions are asynchronous and can have variable timing.

I will keep those ideas and strengthen selectors + status polling semantics.

## Alternatives considered
- **A) Increase all timeouts only**
  - Rejected as primary fix: reduces failures but doesn’t fix wrong-element targeting.
- **B) Disable UI checks and rely only on API**
  - Rejected: mission requires browser/live UI semantics.
- **C) Keep UI checks but scope card locators to board card containers + resilient state poll**
  - Chosen: best balance of UI fidelity and stability.

## Chosen approach
1. In `scripts/e2e_auto_transition_waits.mjs`, replace broad text locators with card-scoped locators (e.g., `h4` title within TaskCard container).
2. Update `getUiColumnForCard` to resolve from the actual card heading element and traverse only within board card ancestry.
3. Implement resilient status wait logic:
   - wait for `in_progress` (ack)
   - then wait for `testing OR review OR done` progression milestone
   - then wait for `review OR done`
   - finally approve to done if still in review; if already done, validate directly
4. Keep generous but bounded waits with periodic reloads.

## Risks
- Card container selector may drift if TaskCard markup/classes change.
- Broader acceptance (`testing|review|done`) can hide very short-lived testing visibility regressions.
- Longer waits increase runtime.

## Validation checklist
- [ ] Build succeeds (`npm run build`)
- [ ] Restart app on `:3080`
- [ ] Run `node scripts/e2e_auto_transition_waits.mjs` and confirm pass JSON output
- [ ] Run `node scripts/e2e_board_semantics.mjs` and confirm pass JSON output
- [ ] Verify evidence screenshots/json paths are produced
- [ ] Confirm no blank-board regression and terminal timestamp visibility from semantics run
