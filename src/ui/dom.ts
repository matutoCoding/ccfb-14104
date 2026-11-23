// 通用 DOM 构造助手, 避免引入框架
type ElProps<K extends keyof HTMLElementTagNameMap> =
  Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
    class?: string;
    style?: string | Partial<CSSStyleDeclaration>;
    dataset?: Record<string, string>;
  };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') el.className = v as string;
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else {
      (el as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function label(text: string, input: HTMLElement): HTMLLabelElement {
  return h('label', { class: 'field' }, [h('span', { textContent: text }), input]);
}

export function toast(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const t = h('div', { class: `toast toast-${kind}`, textContent: msg });
  document.getElementById('toast-root')!.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 400);
  }, 2600);
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}
