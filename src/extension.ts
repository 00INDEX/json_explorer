import * as vscode from 'vscode';
import { computeCompletions } from './completions';
import { runJq, JqOptions } from './jq';

const VIEW_ID = 'jsonExplorer.inputView';
// Beyond this many characters we stop sending the result inline and only offer
// the "open in new document" link, to keep the webview responsive.
const MAX_INLINE_CHARS = 100_000;

export function activate(context: vscode.ExtensionContext) {
  const provider = new QueryViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jsonExplorer.focusInput', () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      provider.onActiveEditorChanged(editor);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === provider.targetDoc) provider.invalidate();
    })
  );

  // Seed the target document if a JSON file is already open.
  provider.onActiveEditorChanged(vscode.window.activeTextEditor);
}

export function deactivate() {}

function isJsonDocument(doc: vscode.TextDocument | undefined): boolean {
  return !!doc && (doc.languageId === 'json' || doc.languageId === 'jsonc');
}

interface ParseCache {
  version: number;
  value: unknown;
  ok: boolean;
}

class QueryViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  /** The JSON document queries run against — cached so it survives webview focus. */
  public targetDoc?: vscode.TextDocument;
  private cache?: ParseCache;
  /** Full (untruncated) results, kept so cells can be opened in a new document. */
  private results = new Map<number, string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.postContext();
    });
    this.postContext();
  }

  onActiveEditorChanged(editor: vscode.TextEditor | undefined) {
    if (isJsonDocument(editor?.document)) {
      if (editor!.document !== this.targetDoc) {
        this.targetDoc = editor!.document;
        this.cache = undefined;
      }
      const cfg = vscode.workspace.getConfiguration('jsonExplorer');
      // Reveal the panel the first time, but don't keep stealing focus on every
      // editor switch once it's already visible.
      if (cfg.get<boolean>('autoReveal', true) && !this.view?.visible) {
        vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      }
    }
    this.postContext();
  }

  invalidate() {
    this.cache = undefined;
  }

  private resolveTarget(): vscode.TextDocument | undefined {
    if (this.targetDoc && !this.targetDoc.isClosed) return this.targetDoc;
    this.targetDoc = undefined;
    const active = vscode.window.activeTextEditor?.document;
    if (isJsonDocument(active)) {
      this.targetDoc = active;
      return active;
    }
    return undefined;
  }

  private postContext() {
    if (!this.view) return;
    const doc = this.resolveTarget();
    this.view.webview.postMessage({
      type: 'context',
      fileName: doc ? doc.uri.path.split('/').pop() : undefined,
      isJson: !!doc,
    });
  }

  private onMessage(msg: any) {
    switch (msg?.type) {
      case 'ready':
        this.postContext();
        break;
      case 'complete':
        this.handleComplete(msg.text ?? '', msg.caret ?? 0);
        break;
      case 'run':
        this.handleRun(msg.query ?? '', msg.cellId);
        break;
      case 'openDoc':
        this.handleOpenDoc(msg.cellId);
        break;
    }
  }

  private getValue(): { value: unknown } | undefined {
    const doc = this.resolveTarget();
    if (!doc) return undefined;
    if (this.cache && this.cache.version === doc.version) {
      return this.cache.ok ? { value: this.cache.value } : undefined;
    }
    let value: unknown;
    let ok = true;
    try {
      value = JSON.parse(stripJsonComments(doc.getText()));
    } catch {
      ok = false;
    }
    this.cache = { version: doc.version, value, ok };
    return ok ? { value } : undefined;
  }

  private handleComplete(text: string, caret: number) {
    if (!this.view) return;
    const parsed = this.getValue();
    if (!parsed) {
      this.view.webview.postMessage({
        type: 'completions',
        items: [],
        replaceStart: caret,
        replaceEnd: caret,
      });
      return;
    }
    const max = vscode.workspace
      .getConfiguration('jsonExplorer')
      .get<number>('maxCompletionItems', 200);
    const result = computeCompletions(parsed.value, text, caret, max);
    this.view.webview.postMessage({ type: 'completions', ...result });
  }

  private async handleRun(query: string, cellId: number) {
    if (!this.view) return;
    const doc = this.resolveTarget();
    if (!doc) {
      this.view.webview.postMessage({
        type: 'result',
        cellId,
        ok: false,
        error: 'Open a JSON file first.',
      });
      return;
    }
    const filter = query.trim() === '' ? '.' : query;
    const cfg = vscode.workspace.getConfiguration('jsonExplorer');
    const opts: JqOptions = {
      jqPath: cfg.get<string>('jqPath', 'jq'),
      rawOutput: cfg.get<boolean>('rawOutput', true),
      extraArgs: cfg.get<string[]>('extraArgs', []),
    };

    let result;
    try {
      result = await runJq(filter, doc.getText(), opts);
    } catch (err: any) {
      this.view.webview.postMessage({
        type: 'result',
        cellId,
        ok: false,
        error: err.message ?? String(err),
      });
      return;
    }

    if (result.code !== 0) {
      this.view.webview.postMessage({
        type: 'result',
        cellId,
        ok: false,
        error: result.stderr.trim() || `jq exited with code ${result.code}`,
      });
      return;
    }

    const full = result.stdout.replace(/\n$/, '');
    this.results.set(cellId, full);
    const tooBig = full.length > MAX_INLINE_CHARS;
    const inline = tooBig ? full.slice(0, MAX_INLINE_CHARS) : full;
    this.view.webview.postMessage({
      type: 'result',
      cellId,
      ok: true,
      output: inline,
      tooBig,
      lines: full.length === 0 ? 0 : full.split('\n').length,
    });
  }

  private async handleOpenDoc(cellId: number) {
    const content = this.results.get(cellId);
    if (content === undefined) return;
    const cfg = vscode.workspace.getConfiguration('jsonExplorer');
    const rawOutput = cfg.get<boolean>('rawOutput', true);
    const language = detectLanguage(content, rawOutput);
    const document = await vscode.workspace.openTextDocument({ content, language });
    await vscode.window.showTextDocument(document, {
      viewColumn: cfg.get<boolean>('openBeside', true)
        ? vscode.ViewColumn.Beside
        : vscode.ViewColumn.Active,
      preview: false,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css')
    );
    const csp =
      `default-src 'none'; ` +
      `style-src ${webview.cspSource}; ` +
      `script-src 'nonce-${nonce}';`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="header"><span id="source">No JSON file open</span></div>
  <div id="cells"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function detectLanguage(content: string, rawOutput: boolean): string {
  const trimmed = content.trim();
  if (!trimmed) return 'plaintext';
  try {
    const v = JSON.parse(trimmed);
    if (v !== null && typeof v === 'object') return 'json';
    if (!rawOutput) return 'json';
  } catch {
    /* not a single JSON value */
  }
  return 'plaintext';
}

function stripJsonComments(text: string): string {
  let out = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === quote) {
        inStr = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
