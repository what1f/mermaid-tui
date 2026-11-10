// 由 core/diagram.ts 复制而来，改那边，再跑 pnpm build
// 和 harness 无关的纯函数：切分 mermaid 代码块、展开 SVG 里的 CSS 变量、配色、图片尺寸、哈希。

export type Segment = { kind: 'text'; text: string } | { kind: 'mermaid'; source: string; fence: string };

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;

// 把一段 markdown 切成文字段和闭合的 mermaid 代码块。没闭合的（还在流式输出）留在文字里。
export function split(text: string): Segment[] {
  const lines = text.split('\n');
  const out: Segment[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length > 0) out.push({ kind: 'text', text: buf.join('\n') });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const open = OPEN.exec(line);
    if (!open) {
      buf.push(line);
      continue;
    }
    const marker = open[1] ?? '```';
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (close.test(lines[j] ?? '')) {
        end = j;
        break;
      }
    }
    if (end < 0 || (open[2] ?? '').toLowerCase() !== 'mermaid') {
      // 普通代码块整块原样保留，里面的 ```mermaid 不算数
      const stop = end < 0 ? lines.length - 1 : end;
      buf.push(...lines.slice(i, stop + 1));
      i = stop;
      continue;
    }
    const source = lines.slice(i + 1, end).join('\n');
    if (source.trim() === '') {
      buf.push(...lines.slice(i, end + 1));
    } else {
      flush();
      out.push({ kind: 'mermaid', source, fence: lines.slice(i, end + 1).join('\n') });
    }
    i = end;
  }
  flush();
  return out.filter((s) => s.kind === 'mermaid' || s.text.trim() !== '');
}

export type Palette = Record<string, string>;
export type Appearance = 'light' | 'dark';

// 默认配色。背景透明，文字、线条要和终端底色有足够对比
export const DEFAULTS: Record<Appearance, Palette> = {
  light: {
    '--pele-bg': '#ffffff',
    '--pele-fg': '#1f2328',
    '--pele-muted': '#57606a',
    '--pele-line': '#424a53',
    '--pele-surface': '#f3f5f8',
    '--pele-surface-alt': '#e6eaef',
    '--pele-border': '#6e7781',
    '--pele-accent': '#0969da',
  },
  dark: {
    '--pele-bg': '#1b1d21',
    '--pele-fg': '#e8eaed',
    '--pele-muted': '#a2a9b4',
    '--pele-line': '#c2c8d1',
    '--pele-surface': '#262a31',
    '--pele-surface-alt': '#30353d',
    '--pele-border': '#8b939e',
    '--pele-accent': '#6ea8fe',
  },
};

// 主题文件里的键名 → pele 的 CSS 变量
const KEYS: Record<string, string> = {
  bg: '--pele-bg',
  fg: '--pele-fg',
  muted: '--pele-muted',
  line: '--pele-line',
  surface: '--pele-surface',
  surfaceAlt: '--pele-surface-alt',
  border: '--pele-border',
  accent: '--pele-accent',
  critical: '--pele-critical',
  radius: '--pele-radius',
  font: '--pele-font',
  fontMono: '--pele-font-mono',
  fgOnLight: '--pele-fg-on-light',
  fgOnDark: '--pele-fg-on-dark',
};

// 把主题文件的一节（顶层通用，或 light / dark 专用）换成 CSS 变量
export function paletteOf(section: unknown): Palette {
  const out: Palette = {};
  if (typeof section !== 'object' || section === null) return out;
  for (const [k, v] of Object.entries(section)) {
    if (k === 'series' && Array.isArray(v)) v.forEach((c, i) => typeof c === 'string' && (out[`--pele-series-${i + 1}`] = c));
    else if (KEYS[k] && (typeof v === 'string' || typeof v === 'number')) out[KEYS[k]] = k === 'radius' ? `${v}px` : String(v);
  }
  return out;
}

// rsvg-convert 不认 var()，先把变量展开成具体值。图里自己声明的变量（图表 frontmatter 的配色）优先。
export function flatten(svg: string, palette: Palette): string {
  const defs: Record<string, string> = { ...palette };
  for (const m of svg.matchAll(/(--[\w-]+)\s*:\s*((?:[^;"()]|\([^()]*(?:\([^()]*\)[^()]*)*\))+)/g)) {
    const [, name = '', value = ''] = m;
    defs[name] = value.trim();
  }
  const VAR = /var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g;
  const sub = (s: string) => s.replace(VAR, (_, name: string, fallback?: string) => defs[name] ?? (fallback ?? '').trim());
  let out = svg;
  for (let i = 0; i < 8 && out.includes('var('); i++) {
    for (const k in defs) defs[k] = sub(defs[k] ?? '');
    out = sub(out);
  }
  return out;
}

// FNV-1a，够做缓存文件名
export function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

// pele 的标签是 14px，终端一格大约 8px 宽，按这个比例出图，图里的字和终端字差不多大
const PX_PER_COLUMN = 8;
// 终端字符格的高宽比
const CELL_ASPECT = 2.05;
// 出图的像素密度：每列多少像素（Retina 上清楚）
const PNG_PX_PER_COLUMN = 18;
// 终端图片协议里一张图最多占多少格
const MAX_CELLS = 255;

// SVG 在终端里占多少列、多少行，以及转 PNG 时放大多少倍
export function fitImage(width: number, height: number, maxColumns: number, fontSize = 14) {
  // 字号调大时图跟着变大，图里的字和终端字的比例不变
  const pxPerColumn = (PX_PER_COLUMN * fontSize) / 14;
  let columns = Math.min(maxColumns, MAX_CELLS, Math.max(8, Math.round(width / pxPerColumn)));
  let rows = Math.max(1, Math.round((columns * height) / width / CELL_ASPECT));
  if (rows > MAX_CELLS) {
    columns = Math.max(8, Math.round((columns * MAX_CELLS) / rows));
    rows = MAX_CELLS;
  }
  return { columns, rows, zoom: (columns * PNG_PX_PER_COLUMN) / width };
}
