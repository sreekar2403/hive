**Type:** wayfinder:task
**Blocked by:** 021
**Blocks:** none

## Question

Update `Router.route`/`heuristicRoute` in `packages/server/src/router.ts` to consult the category→
harness/provider/model mapping designed in 021, applying the precedence rule decided there (mapping vs.
today's hardcoded regex rules). The existing regex table becomes either the fallback when no user mapping
exists for a detected category, or is retired outright — follow whatever 021 decided.
