// Draws the README gallery into docs/gallery/: each diagram as the image a terminal
// shows (light and dark) and as the text art it falls back to, framed like a terminal.
// Needs rsvg-convert. Run with `node scripts/gallery.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { render, renderAscii } from 'pele/ascii';
import { DEFAULTS, flatten } from '../core/diagram.ts';

const out = new URL('../docs/gallery/', import.meta.url).pathname;
// Text art is drawn this many columns wide, about half a README.
const COLUMNS = 64;
// A pie fills whatever width it gets, so give it less.
const NARROW = { pie: 44 };
const FONT = { family: 'Menlo, monospace', size: 14, width: 8.43, line: 17 };
const TERMINAL = { bg: '#1b1d21', fg: '#e8eaed', pad: 20 };

const DIAGRAMS = {
  flowchart: `flowchart TD
  R[Request] --> C{Cached?}
  C -->|yes| S[Serve]
  C -->|no| B[Build page]
  B --> W[Write cache]
  W --> S`,
  sequence: `sequenceDiagram
  Browser->>API: POST /login
  API->>DB: Find user
  DB-->>API: User
  API-->>Browser: Session cookie`,
  state: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review: open PR
  Review --> Draft: changes requested
  Review --> Merged: approved
  Merged --> [*]`,
  er: `erDiagram
  USER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "ordered in"`,
  class: `classDiagram
  class Plugin {
    +name
    +register()
  }
  class Harness {
    +draw(block)
  }
  Harness <|-- ClaudeCode
  Harness <|-- Pi
  Plugin --> Harness`,
  pie: `pie title Where the time goes
  "Reading code" : 45
  "Writing code" : 25
  "Waiting on CI" : 20
  "Meetings" : 10`,
};

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const png = (svg, file, zoom) => {
  const tmp = `${out}${file}.svg`;
  writeFileSync(tmp, svg);
  execFileSync('rsvg-convert', ['-z', String(zoom), '-o', `${out}${file}.png`, tmp]);
  rmSync(tmp);
};

// Line characters and the cell edges they reach, drawn as paths the way terminals
// draw them: font glyphs leave seams between rows.
const LINES = {
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ur', '┘': 'ul',
  '├': 'udr', '┤': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'udlr',
};
const ROUND = { '╭': 'rd', '╮': 'ld', '╰': 'ur', '╯': 'ul' };

// Text art on a terminal-colored card.
const card = (lines) => {
  const { width: cw, line: ch, size } = FONT;
  const { pad } = TERMINAL;
  const cols = Math.max(...lines.map((l) => [...l].length));
  const w = Math.ceil(cols * cw + pad * 2);
  const h = Math.ceil(lines.length * ch + pad * 2);
  const paths = [];
  const rows = lines.map((line, r) => {
    const chars = [...line];
    chars.forEach((c, i) => {
      const edges = LINES[c] ?? ROUND[c];
      if (!edges) return;
      const x0 = pad + i * cw, y0 = pad + r * ch, x = x0 + cw / 2, y = y0 + ch / 2;
      const end = { u: [x, y0], d: [x, y0 + ch], l: [x0, y], r: [x0 + cw, y] };
      if (LINES[c]) for (const e of edges) paths.push(`M${x} ${y}L${end[e]}`);
      else {
        // A quarter circle between the two edges.
        const v = edges.includes('u') ? 'u' : 'd';
        const hz = edges.includes('l') ? 'l' : 'r';
        const rad = cw / 2;
        const from = [x, v === 'u' ? y - rad : y + rad];
        const to = [hz === 'l' ? x - rad : x + rad, y];
        paths.push(`M${end[v]}L${from}Q${x} ${y} ${to}L${end[hz]}`);
      }
      chars[i] = ' ';
    });
    const text = escape(chars.join(''));
    return `<text x="${pad}" y="${pad + r * ch + size - 1}" xml:space="preserve">${text}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="10" fill="${TERMINAL.bg}"/><path d="${paths.join('')}" fill="none" stroke="${TERMINAL.fg}" stroke-width="1.1" stroke-linecap="square"/><g font-family="${FONT.family}" font-size="${size}" fill="${TERMINAL.fg}">${rows.join('')}</g></svg>`;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [name, source] of Object.entries(DIAGRAMS)) {
  for (const appearance of ['light', 'dark']) {
    const r = render(source);
    png(flatten(r.svg, DEFAULTS[appearance]), `${name}-${appearance}`, 2);
  }
  png(card(renderAscii(source, { maxWidth: NARROW[name] ?? COLUMNS }).lines), `${name}-text`, 2);
  console.log(name);
}
