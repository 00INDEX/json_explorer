# Json Explorer

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/00index.json-notebook?label=VS%20Marketplace&color=4f56e8)](https://marketplace.visualstudio.com/items?itemName=00index.json-notebook)
[![Open VSX Version](https://img.shields.io/open-vsx/v/00index/json-notebook?label=Open%20VSX&color=4f56e8)](https://open-vsx.org/extension/00index/json-notebook)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/00index/json-notebook?label=downloads&color=4f56e8)](https://open-vsx.org/extension/00index/json-notebook)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A VS Code extension for quickly exploring JSON files with [`jq`](https://stedolan.github.io/jq/).

Open a JSON file, type a jq filter in the docked **Json Explorer** panel at the bottom,
press **Enter**, and the result opens in a new tab. String fields are printed **raw**
(`jq -r`) so escaped text becomes readable — no more `\n`, `\"` and `\t` clutter.

## Demo

![Json Explorer demo](https://github.com/00INDEX/json_explorer/raw/main/media/demo.gif)

## Install

- **VS Code**: search **"Json Explorer"** in the Extensions view, or open the
  [Marketplace page](https://marketplace.visualstudio.com/items?itemName=00index.json-notebook).
- **VSCodium / Cursor / Gitpod / Theia** (Open VSX): search **"Json Explorer"**, or visit the
  [Open VSX page](https://open-vsx.org/extension/00index/json-notebook).
- **Manual**: download the `.vsix` from the
  [latest GitHub release](https://github.com/00INDEX/json_explorer/releases/latest)
  and run **Extensions: Install from VSIX…** from the Command Palette.

## Features

- **Docked query box** — a persistent input at the bottom of the window (next to the Terminal/Output tabs).
- **Field autocomplete** — as you type a path, it inspects the open JSON and suggests the available keys:
  - `↑` / `↓` to move through suggestions
  - `Tab` to complete the highlighted one
  - `Enter` to run the query
  - `Esc` to dismiss the dropdown
  - Understands `.`, `.key`, `.key.sub`, `.[]`, `.[0]`, `.["weird key!"]`, and pipe stages (`a | b`).
- **Raw output by default** (`jq -r`) — great for reading escaped text. Toggle with `jsonExplorer.rawOutput`.
- **Result in a new tab** — opened beside the source, ready to read or save.

## Examples

| Filter           | Result                                            |
| ---------------- | ------------------------------------------------- |
| `.`              | the whole document, pretty-printed                |
| `.content`       | the `content` string, **unescaped** and readable  |
| `.author.name`   | `Ada`                                             |
| `.items[].label` | each item's label, one per line                   |
| `.items \| map(.score) \| add` | sum of all scores                   |

## Usage

1. Open any `.json` file. The **Json Explorer** panel reveals automatically.
2. Click the input box and type a jq filter. Suggestions appear as you type `.`.
3. Press **Enter** to run — the result opens in a new editor tab.

## Requirements

`jq` must be installed and on your `PATH`. Override the location with the
`jsonExplorer.jqPath` setting if needed.

```sh
brew install jq      # macOS
sudo apt install jq  # Debian/Ubuntu
```

## Settings

| Setting                          | Default | Description                                              |
| -------------------------------- | ------- | -------------------------------------------------------- |
| `jsonExplorer.jqPath`            | `jq`    | Path to the jq executable.                               |
| `jsonExplorer.rawOutput`         | `true`  | Pass `-r` so string results print raw (unescaped).       |
| `jsonExplorer.extraArgs`         | `[]`    | Extra args passed to jq before the filter (e.g. `-S`).   |
| `jsonExplorer.openBeside`        | `true`  | Open the result beside the source file.                  |
| `jsonExplorer.autoReveal`        | `true`  | Reveal the panel when a JSON file becomes active.        |
| `jsonExplorer.maxCompletionItems`| `200`   | Max field suggestions in the dropdown.                   |

## Development

```sh
npm install
npm run compile      # or: npm run watch
```

Press **F5** in VS Code to launch an Extension Development Host, then open
`samples/demo.json` to try it out.
