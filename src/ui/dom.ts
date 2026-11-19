/** 极简 DOM 辅助 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', {}, label), input);
}

export function numberInput(value: number, onChange: (v: number) => void, step = 1): HTMLInputElement {
  const i = el('input', { type: 'number', value: String(value), step: String(step) });
  i.addEventListener('change', () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

export function select<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = el('select');
  for (const [v, label] of options) {
    const o = el('option', { value: v }, label);
    if (v === value) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function table(headers: string[], rows: (string | number | HTMLElement)[][], rowClass?: (i: number) => string): HTMLTableElement {
  const t = el('table', { class: 'data' });
  const thead = el('thead');
  thead.append(el('tr', {}, ...headers.map(h => el('th', {}, h))));
  t.append(thead);
  const tbody = el('tbody');
  rows.forEach((r, i) => {
    const tr = el('tr', rowClass ? { class: rowClass(i) } : {});
    tr.append(...r.map(c => el('td', {}, typeof c === 'object' ? c : String(c))));
    tbody.append(tr);
  });
  t.append(tbody);
  return t;
}
