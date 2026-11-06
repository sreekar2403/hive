# Release notes

Hive release notes are generated from pull request titles and conventional
commits merged into `main`. A release is cut from the commit history since
the previous tag, so the single source of truth is the merge history — not
a hand-maintained file. This document is the template; actual releases are
published on the GitHub Releases page and cut via `.github/workflows/release.yml`.

## Commit format

```
type(scope): subject
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `security`.
Breaking changes end the subject with `!` or carry a `BREAKING CHANGE:`
footer.

PR titles follow the same format, since squash-merge turns the PR title
into the commit message that the release notes are generated from.

## Example entry format

### 0.1.0 — 2026-11-06

**Features**

- `feat(server)`: add `simpleMode` to config defaults — progressive
  disclosure for first-time setups (batch/05-popularity)

**Fixes**

- `fix(server)`: never bypass the budget check when fan-out plans a split

**Docs**

- `docs`: publish `ROADMAP.md` and `RELEASENOTES.md`

**Conventional commits used in this repo**

- `feat(scope)` — a new user-facing capability
- `fix(scope)` — a bug fix
- `docs(scope)` — documentation only
- `chore(scope)` — tooling, CI, dependency changes with no user-facing effect

See `CONTRIBUTING.md` for how to propose a change, and `ROADMAP.md` for
what is planned next.
