**Type:** wayfinder:grilling
**Blocked by:** 017, 018
**Blocks:** 020, 022, 031

## Question

Design the Settings page's model behind "for tasks like frontend, backend, testing, architecture etc.,
configure which model and from where it should use" (user's words). Needs: the category taxonomy (does
it start from the existing `Router.heuristicRoute` regex categories — test/refactor/docs/devops/design/
research — or something else; is it user-extensible?), what a category maps to (harness + provider +
model, per 017's findings on what each harness actually supports), storage (SQLite table from 018, or a
config file — pick one), and precedence between this user-configured mapping and the existing regex
heuristic in `router.ts` (does a category mapping override the heuristic outright, or only apply when the
heuristic's pattern also matches that category?). Also resolve how the old ticket 006's planned `@override`
prompt syntax (never implemented) relates to this — is manual per-message override still wanted on top of
the Settings-level default?
