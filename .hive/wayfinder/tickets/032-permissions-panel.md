**Type:** wayfinder:prototype
**Blocked by:** 025, 026
**Blocks:** none

## Question

Land the Permissions panel: a live queue of pending approval requests (each actionable — approve/deny,
calling into 025's wiring) plus a history of past ones (approved/denied/timed-out, from the SQLite
history table). Decide whether pending requests also need a modal/toast interrupt when they arrive (so
you don't have to be looking at this panel to notice a task is blocked) or whether the Dashboard's status
indicator is enough signal.
