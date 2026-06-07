// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const cells = /** @type {HTMLDivElement} */ (document.getElementById('cells'));
  const source = /** @type {HTMLSpanElement} */ (document.getElementById('source'));

  let cellCounter = 0;
  let hasJson = false;

  // Per-cell output containers, so async results land in the right place.
  /** @type {Map<number, HTMLDivElement>} */
  const outputs = new Map();

  // State for the autocomplete on the *currently active* input.
  /** @type {{input: HTMLInputElement, list: HTMLUListElement} | null} */
  let active = null;
  /** @type {{label:string, insertText:string, detail?:string}[]} */
  let items = [];
  let selected = -1;
  let replaceStart = 0;
  let replaceEnd = 0;

  // --- Autocomplete --------------------------------------------------------

  function requestCompletions() {
    if (!active) return;
    const text = active.input.value;
    const caret = active.input.selectionStart ?? text.length;
    vscode.postMessage({ type: 'complete', text, caret });
  }

  function renderList() {
    if (!active) return;
    const list = active.list;
    const wasHidden = list.hidden;
    list.innerHTML = '';
    if (items.length === 0) {
      list.hidden = true;
      return;
    }
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      li.className = idx === selected ? 'active' : '';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = it.label;
      li.appendChild(label);
      if (it.detail) {
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = it.detail;
        li.appendChild(detail);
      }
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        accept(idx);
      });
      list.appendChild(li);
    });
    list.hidden = false;
    const el = list.children[selected];
    if (el) /** @type {HTMLElement} */ (el).scrollIntoView({ block: 'nearest' });
    // When the dropdown first opens, scroll the panel so the whole list is
    // visible (it opens downward and the input is the last cell).
    if (wasHidden) {
      requestAnimationFrame(() => list.scrollIntoView({ block: 'nearest' }));
    }
  }

  function hideList() {
    items = [];
    selected = -1;
    if (active) {
      active.list.hidden = true;
      active.list.innerHTML = '';
    }
  }

  function accept(idx) {
    if (!active) return;
    const it = items[idx];
    if (!it) return;
    const input = active.input;
    const before = input.value.slice(0, replaceStart);
    const after = input.value.slice(replaceEnd);
    input.value = before + it.insertText + after;
    const caret = before.length + it.insertText.length;
    input.setSelectionRange(caret, caret);
    hideList();
    input.focus();
    requestCompletions();
  }

  // --- Cells ---------------------------------------------------------------

  function addInputCell() {
    const cell = document.createElement('div');
    cell.className = 'cell active';

    const row = document.createElement('div');
    row.className = 'in-row';

    const prompt = document.createElement('span');
    prompt.className = 'prompt in-prompt';
    prompt.textContent = '›';

    const field = document.createElement('div');
    field.className = 'field';

    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = hasJson ? 'jq filter — e.g.  .  or  .content' : 'Open a JSON file to start';
    input.disabled = !hasJson;

    const list = document.createElement('ul');
    list.className = 'suggestions';
    list.hidden = true;

    field.appendChild(input);
    field.appendChild(list);
    row.appendChild(prompt);
    row.appendChild(field);
    cell.appendChild(row);
    cells.appendChild(cell);

    active = { input, list };

    input.addEventListener('input', requestCompletions);
    input.addEventListener('click', requestCompletions);
    input.addEventListener('blur', () => setTimeout(hideList, 120));
    input.addEventListener('keydown', onKeydown);

    input.focus();
    cell.scrollIntoView({ block: 'nearest' });
    return { cell, input, prompt };
  }

  function onKeydown(e) {
    if (!active) return;
    const open = !active.list.hidden && items.length > 0;
    switch (e.key) {
      case 'ArrowDown':
        if (open) {
          e.preventDefault();
          selected = (selected + 1) % items.length;
          renderList();
        }
        break;
      case 'ArrowUp':
        if (open) {
          e.preventDefault();
          selected = (selected - 1 + items.length) % items.length;
          renderList();
        }
        break;
      case 'Tab':
        if (open) {
          e.preventDefault();
          accept(selected >= 0 ? selected : 0);
        }
        break;
      case 'Enter':
        e.preventDefault();
        run();
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          hideList();
        }
        break;
    }
  }

  function run() {
    if (!active || !hasJson) return;
    const query = active.input.value;
    const id = ++cellCounter;

    // Freeze the current input cell.
    hideList();
    const frozenInput = active.input;
    const cell = /** @type {HTMLElement} */ (frozenInput.closest('.cell'));
    cell.classList.remove('active');
    cell.classList.add('frozen');

    // Replace the editable input with static, clickable code.
    const row = /** @type {HTMLElement} */ (frozenInput.closest('.in-row'));
    const code = document.createElement('code');
    code.className = 'in-code';
    code.textContent = query.trim() === '' ? '.' : query;
    code.title = 'Click to reuse this query';
    code.addEventListener('click', () => reuse(code.textContent || ''));
    /** @type {HTMLElement} */ (frozenInput.parentElement).replaceWith(code);
    row.querySelector('.in-prompt')?.replaceChildren(document.createTextNode(`[${id}]`));

    // Output placeholder.
    const out = document.createElement('div');
    out.className = 'out pending';
    out.textContent = 'Running…';
    cell.appendChild(out);
    outputs.set(id, out);

    active = null;
    vscode.postMessage({ type: 'run', query, cellId: id });

    // Fresh input for the next query.
    addInputCell();
  }

  function reuse(text) {
    if (active) {
      active.input.value = text;
      active.input.focus();
      const end = text.length;
      active.input.setSelectionRange(end, end);
      requestCompletions();
    }
  }

  function fillOutput(msg) {
    const out = outputs.get(msg.cellId);
    if (!out) return;
    out.classList.remove('pending');
    out.textContent = '';

    if (!msg.ok) {
      out.classList.add('error');
      const prompt = document.createElement('span');
      prompt.className = 'out-prompt';
      prompt.textContent = 'error';
      const body = document.createElement('pre');
      body.className = 'out-body';
      body.textContent = msg.error || 'Unknown error';
      out.appendChild(prompt);
      out.appendChild(body);
      return;
    }

    const prompt = document.createElement('span');
    prompt.className = 'out-prompt';
    prompt.textContent = 'out';
    out.appendChild(prompt);

    const body = document.createElement('pre');
    body.className = 'out-body collapsible';
    body.textContent = msg.output === '' ? '(empty)' : msg.output;
    out.appendChild(body);

    const tools = document.createElement('div');
    tools.className = 'out-tools';

    // Collapse tall output; reveal with a toggle. 300px ≈ the folded height.
    requestAnimationFrame(() => {
      if (body.scrollHeight > 300) {
        body.classList.add('collapsed');
        const toggle = link(`▸ Expand (${msg.lines} lines)`, () => {
          const collapsed = body.classList.toggle('collapsed');
          toggle.textContent = collapsed ? `▸ Expand (${msg.lines} lines)` : '▾ Collapse';
        });
        tools.prepend(toggle);
      }
    });

    if (msg.tooBig) {
      const note = document.createElement('span');
      note.className = 'out-note';
      note.textContent = 'Output truncated — open in a document to see all of it.';
      tools.appendChild(note);
    }

    tools.appendChild(link('Open in new document ↗', () =>
      vscode.postMessage({ type: 'openDoc', cellId: msg.cellId })
    ));
    out.appendChild(tools);
  }

  function link(text, onClick) {
    const a = document.createElement('a');
    a.className = 'out-link';
    a.href = '#';
    a.textContent = text;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return a;
  }

  // --- Messages ------------------------------------------------------------

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'completions':
        items = msg.items || [];
        replaceStart = msg.replaceStart;
        replaceEnd = msg.replaceEnd;
        selected = items.length > 0 ? 0 : -1;
        renderList();
        break;
      case 'result':
        fillOutput(msg);
        break;
      case 'context':
        hasJson = !!msg.isJson;
        source.textContent = hasJson
          ? `Source: ${msg.fileName || 'JSON file'}`
          : 'Open a JSON file to start';
        if (active) {
          active.input.disabled = !hasJson;
          active.input.placeholder = hasJson
            ? 'jq filter — e.g.  .  or  .content'
            : 'Open a JSON file to start';
        }
        break;
    }
  });

  addInputCell();
  vscode.postMessage({ type: 'ready' });
})();
