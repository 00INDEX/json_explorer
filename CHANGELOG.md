# Change Log

All notable changes to the **Json Explorer** extension are documented here.

## [0.1.5] - 2026-06-08

### Changed

- Full rebrand to **JSON Notebook**: panel title, command, and configuration
  labels now read "JSON Notebook".
- Settings keys are renamed from `jsonExplorer.*` to `jsonNotebook.*` (re-set
  any customised options under the new keys).

## [0.1.4] - 2026-06-08

### Changed

- Display name is now **JSON Notebook** ("Json Explorer" was already taken on
  the VS Code Marketplace, which requires globally-unique display names).

## [0.1.3] - 2026-06-08

### Changed

- Renamed the extension id to `00index.json-notebook` (the `json-explorer`
  name was already taken on the VS Code Marketplace). The display name remains
  **Json Explorer**.

## [0.1.2] - 2026-06-08

### Changed

- Now also published to the VS Code Marketplace (in addition to Open VSX).

## [0.1.1] - 2026-06-08

### Changed

- README now includes a demo GIF, Open VSX badges, and install instructions.

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
