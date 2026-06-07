// Lightweight jq-path completion engine.
//
// Given the parsed JSON value, the full query text and the caret offset, it
// resolves the path the user is currently typing and returns the set of keys
// (or array accessors) available at that position. It understands the common
// jq subset used for plain navigation: ".", ".key", ".key.sub", ".[]",
// ".[0]", '.["weird key"]', pipe stages ("a | b") and element context inside
// iterating functions ("map(.x)", "select(.y)").

export interface CompletionItem {
  /** Text shown in the dropdown. */
  label: string;
  /** Text inserted, replacing [replaceStart, replaceEnd]. */
  insertText: string;
  /** Short type hint shown on the right (e.g. "string", "array(3)"). */
  detail?: string;
}

export interface CompletionResult {
  items: CompletionItem[];
  /** Absolute offset in the query text where the replacement starts. */
  replaceStart: number;
  /** Absolute offset in the query text where the replacement ends. */
  replaceEnd: number;
}

const EMPTY = (caret: number): CompletionResult => ({
  items: [],
  replaceStart: caret,
  replaceEnd: caret,
});

// How many candidate values we keep when an expression fans out via ".[]".
const MAX_CANDIDATES = 200;
// How many array elements we sample when iterating.
const MAX_SAMPLE = 100;

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// jq builtins whose parenthesised argument runs against each element.
const ITER_FUNCS = new Set([
  'map',
  'map_values',
  'select',
  'any',
  'all',
  'sort_by',
  'group_by',
  'unique_by',
  'min_by',
  'max_by',
]);

export function computeCompletions(
  root: unknown,
  text: string,
  caret: number,
  maxItems = 200
): CompletionResult {
  const upto = text.slice(0, Math.max(0, Math.min(caret, text.length)));

  // 1. Split into pipe stages and resolve every completed stage so the value
  //    flowing into the current stage is correct (e.g. ".items | .[0]").
  const stages = splitTop(upto, '|');
  let base: unknown[] | null = [root];
  for (let s = 0; s < stages.length - 1; s++) {
    base = base ? navigate(base, stages[s].text) : null;
  }
  if (!base) return EMPTY(caret);

  // 2. Within the current stage, descend into the innermost unclosed paren /
  //    last top-level comma to find the context for the path being typed.
  const stage = stages[stages.length - 1];
  const ctx = stageContext(stage.text);
  const ctxBase = ctx.iterate ? stepIterate(base) : base;
  const expr = stage.text.slice(ctx.start);
  const exprAbs = stage.start + ctx.start;

  return resolveForCompletion(ctxBase, expr, exprAbs, caret, maxItems);
}

// --- Stage splitting -------------------------------------------------------

interface Stage {
  text: string;
  start: number;
}

/** Split on a top-level separator, ignoring those inside strings/brackets/parens. */
function splitTop(text: string, sep: string): Stage[] {
  const stages: Stage[] = [];
  let depth = 0;
  let inStr = false;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
    } else if (c === sep && depth === 0) {
      stages.push({ text: text.slice(start, i), start });
      start = i + 1;
    }
  }
  stages.push({ text: text.slice(start), start });
  return stages;
}

interface StageCtx {
  start: number; // offset within the stage text where the current path begins
  iterate: boolean; // whether the base should be iterated (element context)
}

/** Find the start of the path currently being typed within a single stage. */
function stageContext(stage: string): StageCtx {
  let start = 0;
  let iterate = false;
  let inStr = false;
  let quote = '';
  const parenStack: boolean[] = []; // true if the paren introduces element context
  for (let i = 0; i < stage.length; i++) {
    const c = stage[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === '(') {
      const fn = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(stage.slice(0, i));
      const iter = !!fn && ITER_FUNCS.has(fn[1]);
      parenStack.push(iter);
      start = i + 1;
      iterate = iter;
    } else if (c === ')') {
      parenStack.pop();
      start = i + 1;
      iterate = parenStack.length > 0 ? parenStack[parenStack.length - 1] : false;
    } else if (c === ',' || c === ' ') {
      // a comma (or whitespace separating constructs) starts a fresh path
      if (c === ',') start = i + 1;
    }
  }
  // Skip leading whitespace of the current path.
  while (start < stage.length && stage[start] === ' ') start++;
  return { start, iterate };
}

// --- Full navigation (for completed stages) --------------------------------

/** Navigate a complete path against `base`. Returns null on unsupported syntax. */
function navigate(base: unknown[], text: string): unknown[] | null {
  let cands = base;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === ' ' || ch === '?') {
      i++;
      continue;
    }
    if (ch === '.') {
      const m = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i));
      if (m) {
        cands = stepKey(cands, m[1]);
        i += m[0].length;
        continue;
      }
      if (text[i + 1] === '[') {
        i++; // fall through to bracket
      } else {
        i++; // identity
        continue;
      }
    }
    if (text[i] === '[') {
      const rest = text.slice(i);
      let m: RegExpExecArray | null;
      if ((m = /^\[\s*\]/.exec(rest))) {
        cands = stepIterate(cands);
      } else if ((m = /^\[\s*(\d+)\s*\]/.exec(rest))) {
        cands = stepIndex(cands, parseInt(m[1], 10));
      } else if ((m = /^\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(rest))) {
        cands = stepKey(cands, safeUnescape(m[1]));
      } else {
        return null; // incomplete/unsupported bracket
      }
      i += m[0].length;
      continue;
    }
    return null; // functions, operators, etc. — can't resolve
  }
  return cands;
}

// --- Completion of the trailing path ---------------------------------------

function resolveForCompletion(
  base: unknown[],
  expr: string,
  abs: number,
  caret: number,
  maxItems: number
): CompletionResult {
  let candidates = base;
  let i = 0;
  const n = expr.length;

  if (n === 0) {
    return keyCompletions(candidates, '', abs, caret, 'bare', maxItems);
  }

  while (i < n) {
    const ch = expr[i];
    if (ch === '?' || ch === ' ') {
      i++;
      continue;
    }
    if (ch === '.') {
      const m = /^\.([A-Za-z_][A-Za-z0-9_]*)/.exec(expr.slice(i));
      if (m) {
        const tokenEndAbs = abs + i + m[0].length;
        if (tokenEndAbs >= caret) {
          const frag = expr.slice(i + 1, caret - abs);
          return keyCompletions(candidates, frag, abs + i, caret, 'dot', maxItems);
        }
        candidates = stepKey(candidates, m[1]);
        i += m[0].length;
        continue;
      }
      if (expr[i + 1] === '[') {
        i++;
      } else {
        if (abs + i + 1 >= caret) {
          return keyCompletions(candidates, '', abs + i, caret, 'dot', maxItems);
        }
        i++;
        continue;
      }
    }
    if (expr[i] === '[') {
      const rest = expr.slice(i);
      let m: RegExpExecArray | null;
      if ((m = /^\[\s*\]/.exec(rest))) {
        candidates = stepIterate(candidates);
        i += m[0].length;
        continue;
      }
      if ((m = /^\[\s*(\d+)\s*\]/.exec(rest))) {
        candidates = stepIndex(candidates, parseInt(m[1], 10));
        i += m[0].length;
        continue;
      }
      if ((m = /^\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(rest))) {
        candidates = stepKey(candidates, safeUnescape(m[1]));
        i += m[0].length;
        continue;
      }
      const inner = expr.slice(i + 1, caret - abs);
      const frag = inner.startsWith('"') ? inner.slice(1) : inner;
      return keyCompletions(candidates, frag, abs + i, caret, 'bracket', maxItems);
    }
    break;
  }

  return EMPTY(caret);
}

type Style = 'dot' | 'bracket' | 'bare';

function keyCompletions(
  candidates: unknown[],
  frag: string,
  replaceStart: number,
  replaceEnd: number,
  style: Style,
  maxItems: number
): CompletionResult {
  const keys = new Map<string, string>(); // key -> type label
  let arrayLen = -1;

  for (const v of candidates) {
    if (Array.isArray(v)) {
      arrayLen = Math.max(arrayLen, v.length);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        if (!keys.has(k)) {
          keys.set(k, typeName((v as Record<string, unknown>)[k]));
        }
      }
    }
  }

  const fragLower = frag.toLowerCase();
  const items: CompletionItem[] = [];

  const matched = [...keys.keys()]
    .filter((k) => k.toLowerCase().startsWith(fragLower))
    .sort();
  for (const k of matched) {
    items.push({ label: k, insertText: renderKey(k, style), detail: keys.get(k) });
  }

  // Array accessors — only when the value here is an array and no fragment typed.
  if (arrayLen >= 0 && frag === '' && style !== 'bracket') {
    items.push({ label: '[]', insertText: '[]', detail: `iterate ${arrayLen} items` });
    const upto = Math.min(arrayLen, 10);
    for (let idx = 0; idx < upto; idx++) {
      items.push({ label: `[${idx}]`, insertText: `[${idx}]`, detail: 'element' });
    }
  }

  return { items: items.slice(0, maxItems), replaceStart, replaceEnd };
}

function renderKey(key: string, style: Style): string {
  const valid = IDENT_RE.test(key);
  if (style === 'bracket') {
    return `["${escapeKey(key)}"]`;
  }
  return valid ? `.${key}` : `.["${escapeKey(key)}"]`;
}

function stepKey(cands: unknown[], key: string): unknown[] {
  const out: unknown[] = [];
  for (const v of cands) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nv = (v as Record<string, unknown>)[key];
      if (nv !== undefined) out.push(nv);
    }
  }
  return cap(out);
}

function stepIndex(cands: unknown[], idx: number): unknown[] {
  const out: unknown[] = [];
  for (const v of cands) {
    if (Array.isArray(v) && idx < v.length) out.push(v[idx]);
  }
  return cap(out);
}

function stepIterate(cands: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const v of cands) {
    if (Array.isArray(v)) {
      for (let i = 0; i < Math.min(v.length, MAX_SAMPLE); i++) out.push(v[i]);
    } else if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) out.push(val);
    }
    if (out.length >= MAX_CANDIDATES) break;
  }
  return cap(out);
}

function cap(arr: unknown[]): unknown[] {
  return arr.length > MAX_CANDIDATES ? arr.slice(0, MAX_CANDIDATES) : arr;
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  switch (typeof v) {
    case 'object':
      return `object(${Object.keys(v as object).length})`;
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return typeof v;
  }
}

function escapeKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function safeUnescape(s: string): string {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}
