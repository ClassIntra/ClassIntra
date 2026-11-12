# Daily Allowance Acceptance

## Run Record

- Status: automated state-contract checks passed; manual device and account checks are pending.
- Device/browser: not run. This environment has no browser automation tool or non-production account credentials.
- Production data: not accessed or changed.
- Build: Vite production build passed to a plan-local temporary output with pruning disabled. Existing `client/dist` was not modified.
- Automated coverage: `node --test client/test/daily-allowance-controller.test.mjs` covers read rejection, malformed data, retry locking, stale-value retention, duplicate claim, claim failure, and concurrent read/claim requests.

## Manual Matrix

Run with a disposable non-production account. For every row, check that the bar and all visible controls remain on-screen, do not overlap, have a clear accessible name, and work by touch and keyboard.

| Viewport | Theme | Scenario | Expected result | Run |
| --- | --- | --- | --- | --- |
| 960x600 landscape | Light | Initial wallet read pending | Loading is visible; claim is disabled | Pending |
| 960x600 landscape | Dark | Initial wallet read pending | Loading is visible; claim is disabled | Pending |
| 960x600 landscape | Light | Initial read offline, then retry succeeds | Error is distinct from empty; retry disables while loading; current status appears after success | Pending |
| 960x600 landscape | Dark | Claim succeeds | One success message; wallet balance matches server; Chat navigation opens | Pending |
| 960x600 landscape | Light | Server reports duplicate claim | Already-claimed message; no client-side balance increase | Pending |
| 960x600 landscape | Dark | Claim request fails | Failure feedback appears; busy state clears; safe retry is available | Pending |
| 390x844 portrait | Light | Refresh fails after a successful unclaimed read | Last known amount stays visible with a stale/unavailable label; claim stays disabled | Pending |
| 390x844 portrait | Dark | Refresh fails after a successful claimed read | Last known claim stays identifiable; stale label and retry remain usable | Pending |
| Both | Light and dark | Touch and keyboard activation | Buttons respond to tap, Enter, and Space; disabled controls cannot activate | Pending |

## Follow-Up

Record the exact tablet/browser build, account environment, viewport, theme, and any overlap or clipping before changing layout. Do not use a production account for claim, duplicate-claim, or failure-path checks.
