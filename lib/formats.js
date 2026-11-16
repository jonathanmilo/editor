// Lectura y escritura de formatos: .docx, .doc (solo lectura), .pdf, .txt y .md.
// El editor trabaja con texto plano; al leer se intenta conservar el tamaño de hoja y los márgenes.
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const CM_PER_INCH = 2.54;
const TWIP_PER_CM = 1440 / CM_PER_INCH; // 1 pulgada = 1440 twips
const PT_PER_CM = 72 / CM_PER_INCH;

const READABLE = ['docx', 'doc', 'pdf', 'txt', 'md', 'markdown', 'text'];
const WRITABLE = ['docx', 'pdf', 'txt', 'md'];

const extOf = (p) => path.extname(p).toLowerCase().slice(1);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// Tipografías de pantalla → equivalentes instalados en casi cualquier Word
const DOCX_FONT = { 'Courier Prime': 'Courier New', 'IBM Plex Mono': 'Consolas' };

// ===================== LECTURA =====================

async function readFile(p) {
  const ext = extOf(p);
  const name = path.basename(p, path.extname(p));
  let r;
  if (ext === 'docx') r = await readDocx(p);
  else if (ext === 'doc') r = await readDoc(p);
  else if (ext === 'pdf') r = await readPdf(p);
  else if (READABLE.includes(ext)) r = { text: await fs.readFile(p, 'utf8') };
  else throw new Error(`Formato no compatible: .${ext}`);
  if (ext === 'pdf' && !r.text.trim()) throw new Error('el PDF no contiene texto (puede ser una imagen escaneada)');
  const format = ext === 'markdown' ? 'md' : ext === 'text' ? 'txt' : ext;
  return { path: p, name, format, text: normalize(r.text), page: r.page || null };
}

const normalize = (t) => t.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\n+$/, '');

async function readDocx(p) {
  const mammoth = require('mammoth');
  const buf = await fs.readFile(p);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  // mammoth termina cada párrafo con "\n\n": cada par equivale a un salto de línea
  const text = value.replace(/\n\n/g, '\n');
  return { text, page: await docxPage(buf) };
}

// Lee el tamaño de hoja, márgenes y tamaño de letra de document.xml / styles.xml
async function docxPage(buf) {
  try {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(buf);
    const doc = await zip.file('word/document.xml').async('string');
    const attr = (tag, name) => {
      const all = doc.match(new RegExp(`<w:${tag}\\b[^>]*>`, 'g'));
      if (!all) return null;
      const m = all[all.length - 1].match(new RegExp(`w:${name}="(-?\\d+)"`));
      return m ? +m[1] : null;
    };
    const w = attr('pgSz', 'w'), h = attr('pgSz', 'h');
    if (!w || !h) return null;
    const page = {
      width: round2(Math.min(w, h) / TWIP_PER_CM),
      height: round2(Math.max(w, h) / TWIP_PER_CM),
      landscape: w > h,
      top: round1((attr('pgMar', 'top') ?? 1418) / TWIP_PER_CM),
      right: round1((attr('pgMar', 'right') ?? 1701) / TWIP_PER_CM),
      bottom: round1((attr('pgMar', 'bottom') ?? 1418) / TWIP_PER_CM),
      left: round1((attr('pgMar', 'left') ?? 1701) / TWIP_PER_CM),
    };
    const styles = zip.file('word/styles.xml') && await zip.file('word/styles.xml').async('string');
    const sz = styles && styles.match(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/);
    if (sz) page.fontSize = +sz[1] / 2;
    return page;
  } catch {
    return null;
  }
}

async function readDoc(p) {
  const WordExtractor = require('word-extractor');
  const d = await new WordExtractor().extract(p);
  return { text: d.getBody() };
}

async function readPdf(p) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(p));
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  const pdf = await task.promise;

  let page = null;
  const bounds = { left: Infinity, right: Infinity, top: Infinity, bottom: Infinity };
  const sizes = [];
  const all = []; // líneas de todas las páginas: { text, x, right, first, blanks, charW }

  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    const [x0, y0, x1, y1] = pg.view;
    const W = x1 - x0, H = y1 - y0;
    if (!page) page = { W, H };
    const { items } = await pg.getTextContent();

    // Agrupar fragmentos en líneas según su coordenada vertical
    const lines = [];
    for (const it of items) {
      if (!it.str) continue;
      const x = it.transform[4] - x0, y = it.transform[5] - y0;
      const size = Math.abs(it.transform[3]) || it.height || 10;
      if (it.str.trim()) {
        sizes.push(size);
        bounds.left = Math.min(bounds.left, x);
        bounds.right = Math.min(bounds.right, W - (x + it.width));
        bounds.top = Math.min(bounds.top, H - (y + size));
        // el margen inferior solo se deduce de páginas llenas (no de la última)
        if (n < pdf.numPages) bounds.bottom = Math.min(bounds.bottom, y);
      }
      let line = lines.find((l) => Math.abs(l.y - y) < size * 0.5);
      if (!line) { line = { y, size, parts: [] }; lines.push(line); }
      line.parts.push({ x, w: it.width, str: it.str, size });
    }
    lines.sort((a, b) => b.y - a.y);

    // Interlineado típico para detectar líneas en blanco
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
    const typical = median(gaps.filter((g) => g > 0)) || 14;

    lines.forEach((l, i) => {
      l.parts.sort((a, b) => a.x - b.x);
      let s = '', end = null, chars = 0, width = 0, columns = false;
      const solid = l.parts.filter((p) => p.str.trim());
      const cw = solid.reduce((a, p) => a + p.w, 0) / Math.max(1, solid.reduce((a, p) => a + p.str.length, 0)) || l.size * 0.6;
      for (const part of l.parts) {
        if (!part.str.trim() && part.w > cw * 2.5) { // espacio ancho = salto de columna
          s = s.replace(/ +$/, '') + '\t'; columns = true; end = part.x + part.w; continue;
        }
        const gap = end === null ? 0 : part.x - end;
        if (end !== null && gap > cw * 2.5) { s = s.replace(/ +$/, '') + '\t'; columns = true; } // columnas / tabla
        else if (end !== null && gap > part.size * 0.25 && !s.endsWith(' ') && !part.str.startsWith(' ')) s += ' ';
        s += part.str;
        end = part.x + part.w;
        if (part.str.trim()) { chars += part.str.length; width += part.w; }
      }
      const text = s.replace(/\s+$/, '');
      if (!text.trim()) return;
      const charW = chars ? width / chars : l.size * 0.6;
      all.push({
        text: text.replace(/^\s+/, ''),
        x: l.parts[0].x + (s.length - s.trimStart().length) * charW,
        right: end,
        firstW: (text.trim().split(/\s+/)[0] || '').length * charW,
        blanks: i > 0 ? Math.max(0, Math.min(3, Math.round((lines[i - 1].y - l.y) / typical) - 1)) : 0,
        regular: i === 0 || Math.abs((lines[i - 1].y - l.y) - typical) < typical * 0.12,
        columns,
        charW,
        pageStart: i === 0,
      });
    });
  }
  await task.destroy();

  // Reconstruir párrafos: una línea que termina porque la palabra siguiente no cabía es un ajuste automático
  const maxRight = Math.max(...all.map((l) => l.right));
  const minLeft = Math.min(...all.map((l) => l.x));
  let text = '';
  all.forEach((l, i) => {
    const indent = Math.round((l.x - minLeft) / l.charW);
    const lead = indent >= 2 ? '\t'.repeat(Math.floor(indent / 4)) + ' '.repeat(indent % 4) : '';
    if (i > 0) {
      const prev = all[i - 1];
      const wrapped = !l.blanks && !lead && l.regular && !prev.columns && !l.columns &&
        prev.right + prev.charW + l.firstW > maxRight + prev.charW * 0.5;
      text += wrapped ? (prev.text.endsWith('-') ? '' : ' ') : '\n' + '\n'.repeat(l.pageStart ? 0 : l.blanks);
    }
    text += lead + l.text;
  });

  const portrait = { w: Math.min(page.W, page.H), h: Math.max(page.W, page.H) };
  const toCm = (pt) => round1(Math.min(6, Math.max(0.5, pt / PT_PER_CM)));
  const fontSize = Math.round(median(sizes) * 2) / 2;
  const top = Number.isFinite(bounds.top) ? toCm(bounds.top) : null;
  return {
    text,
    page: {
      width: round2(portrait.w / PT_PER_CM),
      height: round2(portrait.h / PT_PER_CM),
      landscape: page.W > page.H,
      ...(top !== null ? {
        left: toCm(bounds.left),
        // si el texto no llega al borde derecho no se puede deducir: se asume simétrico
        right: toCm(bounds.right) > toCm(bounds.left) + 1.5 ? toCm(bounds.left) : toCm(bounds.right),
        top,
        bottom: Number.isFinite(bounds.bottom) ? toCm(bounds.bottom) : top,
      } : {}),
      ...(fontSize >= 6 && fontSize <= 36 ? { fontSize } : {}),
    },
  };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ===================== ESCRITURA =====================

// page: { width, height, landscape, top, right, bottom, left (cm), fontSize (pt), spacing }
async function writeFile(p, format, text, page, font, appDir, makeWindow) {
  if (format === 'docx') await fs.writeFile(p, await buildDocx(text, page, font));
  else if (format === 'pdf') await fs.writeFile(p, await buildPdf(text, page, font, appDir, makeWindow));
  else await fs.writeFile(p, text.replace(/\n/g, process.platform === 'win32' && format === 'txt' ? '\r\n' : '\n'), 'utf8');
}

const sheetSize = (page) => page.landscape
  ? { w: page.height, h: page.width }
  : { w: page.width, h: page.height };

async function buildDocx(text, page, font) {
  const { Document, Packer, Paragraph, TextRun, Tab, PageOrientation, LineRuleType } = require('docx');
  const family = DOCX_FONT[font] || font || 'Courier New';
  const tw = (cm) => Math.round(cm * TWIP_PER_CM);
  const { w, h } = sheetSize(page);
  const lineTwips = Math.round(page.fontSize * 1.2 * page.spacing * 20);

  const doc = new Document({
    creator: 'Máquina de escribir',
    styles: { default: { document: { run: { font: family, size: Math.round(page.fontSize * 2) } } } },
    sections: [{
      properties: {
        page: {
          // la librería intercambia ancho/alto en horizontal: se pasan en vertical
          size: { width: tw(Math.min(w, h)), height: tw(Math.max(w, h)), orientation: page.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: tw(page.top), right: tw(page.right), bottom: tw(page.bottom), left: tw(page.left), header: 0, footer: 0, gutter: 0 },
        },
      },
      children: text.split('\n').map((line) => new Paragraph({
        spacing: { before: 0, after: 0, line: lineTwips, lineRule: LineRuleType.EXACT },
        children: [new TextRun({
          font: family,
          children: line.split('\t').flatMap((part, i) => (i ? [new Tab(), part] : [part])),
        })],
      })),
    }],
  });
  return Packer.toBuffer(doc);
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// El PDF se genera con el mismo motor que el editor, así el ajuste de líneas coincide.
async function buildPdf(text, page, font, appDir, makeWindow) {
  const { w, h } = sheetSize(page);
  const fontCss = ['courier-prime/400.css', 'courier-prime/700.css', 'ibm-plex-mono/400.css']
    .map((f) => `<link rel="stylesheet" href="${pathToFileURL(path.join(appDir, 'node_modules/@fontsource', f)).href}">`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8">${fontCss}<style>
    @page { size: ${w}cm ${h}cm; margin: ${page.top}cm ${page.right}cm ${page.bottom}cm ${page.left}cm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: ${font ? `'${font}', ` : ''}'Courier New', monospace; font-size: ${page.fontSize}pt;
      line-height: ${(page.fontSize * 1.2 * page.spacing).toFixed(3)}pt; color: #000;
      white-space: pre-wrap; overflow-wrap: break-word; tab-size: 4; orphans: 1; widows: 1; }
  </style></head><body>${esc(text)}</body></html>`;

  const os = require('os');
  const tmp = path.join(os.tmpdir(), `mde-pdf-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const win = makeWindow();
  try {
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    return await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: false });
  } finally {
    win.destroy();
    fs.rm(tmp, { force: true });
  }
}

module.exports = { readFile, writeFile, READABLE, WRITABLE, extOf, buildDocx };
