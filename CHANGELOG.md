# Change Log

All notable changes to the **Json Explorer** extension are documented here.

## [0.1.0] - 2026-06-07

### Added

- Notebook-style query panel docked at the bottom: type a jq filter, see the
  result inline below, then a fresh input appears for the next query while the
  previous one stays as a numbered, reusable cell.
- Field autocomplete derived from the open JSON document — `↑`/`↓` to select,
  `Tab` to complete, `Enter` to run, `Esc` to dismiss. Understands `.key`,
  `.key.sub`, `.[]`, `.[0]`, `.["weird key"]`, pipe stages, and element context
  inside `map(...)` / `select(...)`.
- Raw output by default (`jq -r`) so escaped strings become readable text.
- Long results collapse with an expand toggle and an "Open in new document"
  link; short results show in full.
- Settings: `jqPath`, `rawOutput`, `extraArgs`, `openBeside`, `autoReveal`,
  `maxCompletionItems`.
