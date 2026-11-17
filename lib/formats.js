// Lectura y escritura de formatos: .docx, .doc (solo lectura), .pdf, .txt y .md.
// El editor trabaja con HTML (párrafos, títulos, listas, tablas e imágenes) y conserva hoja y márgenes.
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { readDocx, buildDocx } = require('./docx-io');
const { readPdf } = require('./pdf-reader');
const { textToHtml, jsonToText, jsonToMarkdown, richFeatures } = require('./text-io');

const READABLE = ['docx', 'doc', 'pdf', 'txt', 'md', 'markdown', 'text'];
const WRITABLE = ['docx', 'pdf', 'txt', 'md'];

const extOf = (p) => path.extname(p).toLowerCase().slice(1);

// ===================== LECTURA =====================
// Devuelve { path, name, format, html, page }
async function readFile(p) {
  const ext = extOf(p);
  const name = path.basename(p, path.extname(p));
  let r;
  if (ext === 'docx') r = await readDocx(await fs.readFile(p));
  else if (ext === 'doc') {
    const WordExtractor = require('word-extractor');
    const d = await new WordExtractor().extract(p);
    r = { html: textToHtml(d.getBody().replace(/\n+$/, '')) };
  } else if (ext === 'pdf') {
    r = await readPdf(await fs.readFile(p));
    if (!r.hasText) throw new Error('el PDF no contiene texto (puede ser una imagen escaneada)');
  } else if (READABLE.includes(ext)) {
    r = { html: textToHtml((await fs.readFile(p, 'utf8')).replace(/\n+$/, '')) };
  } else throw new Error(`Formato no compatible: .${ext}`);
  const format = ext === 'markdown' ? 'md' : ext === 'text' ? 'txt' : ext;
  return { path: p, name, format, html: r.html, page: r.page || null, notes: r.notes || [] };
}

// ===================== ESCRITURA =====================
// content: { json, html } del editor · page: hoja en cm/pt · font: tipografía
// Devuelve la lista de elementos que el formato elegido no puede guardar.
async function writeFile(p, format, content, page, font, appDir, makeWindow) {
  const notes = content.notes || [];
  if (format === 'docx') await fs.writeFile(p, await buildDocx(content.json, page, font, notes));
  else if (format === 'pdf') await fs.writeFile(p, await addPdfNotes(await buildPdf(content.html, page, font, appDir, makeWindow, content.look), notes, page));
  else {
    const text = format === 'md' ? jsonToMarkdown(content.json) : jsonToText(content.json);
    await fs.writeFile(p, text.replace(/\n/g, process.platform === 'win32' && format === 'txt' ? '\r\n' : '\n'), 'utf8');
  }
  // lo que el formato elegido no puede guardar
  const lost = format === 'txt' ? richFeatures(content.json) : [];
  if ((format === 'txt' || format === 'md') && notes.length) lost.push('las notas de escritura');
  return lost;
}

// Notas de escritura → notas adhesivas del PDF (anotaciones /Text en el margen derecho de la 1.ª página)
async function addPdfNotes(buf, notes, page) {
  if (!notes.length) return buf;
  const { PDFDocument, PDFString, PDFHexString } = require('pdf-lib');
  const pdf = await PDFDocument.load(buf);
  const first = pdf.getPage(0);
  const { width, height } = first.getSize();
  const right = Math.max(18, (page.right || 1) * 72 / 2.54);
  const x = width - Math.min(right, 60) + 4;
  notes.forEach((text, i) => {
    const y = height - 60 - i * 34;
    const annot = pdf.context.obj({
      Type: 'Annot', Subtype: 'Text', Name: 'Note', Open: false,
      Rect: [x, y - 22, x + 20, y],
      Contents: PDFHexString.fromText(text),
      T: PDFHexString.fromText('Editor de Joni :)'),
      NM: PDFString.of(`nota-${i + 1}`),
      C: [0.96, 0.84, 0.45], F: 4,
      M: PDFString.fromDate(new Date()),
    });
    first.node.addAnnot(pdf.context.register(annot));
  });
  return Buffer.from(await pdf.save());
}

// Tipografías que puede necesitar el PDF (las de la hoja y las de los temas Collage/Fotocopia)
const PDF_FONTS = [
  'courier-prime/400', 'courier-prime/700', 'courier-prime/400-italic', 'courier-prime/700-italic',
  'ibm-plex-mono/400', 'ibm-plex-mono/700', 'archivo-black/400', 'playfair-display/900', 'playfair-display/400-italic',
  'abril-fatface/400', 'anton/400', 'libre-baskerville/400-italic', 'oswald/700', 'alfa-slab-one/400',
  'special-elite/400', 'lobster/400', 'roboto-slab/800', 'nunito/400', 'nunito/800', 'nunito/900',
];

// El PDF se genera con el mismo motor y la misma hoja de estilos que el editor.
// look (opcional): aspecto del tema — documento con las palabras decoradas, colores y texturas del papel.
async function buildPdf(html, page, font, appDir, makeWindow, look = null) {
  const w = page.landscape ? page.height : page.width;
  const h = page.landscape ? page.width : page.height;
  const css = (f) => `<link rel="stylesheet" href="${pathToFileURL(path.join(appDir, f)).href}">`;
  const fonts = PDF_FONTS.map((f) => css(path.join('node_modules/@fontsource', f + '.css'))).join('');
  const safe = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
  const color = (v, d) => safe(v, /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i) || d;
  const base = `.doc-content { --doc-font: '${font || 'Courier Prime'}', 'Courier New', monospace; --doc-size: ${page.fontSize}pt; --doc-lh: ${(1.2 * page.spacing).toFixed(3)}; }
    .doc-content tr, .doc-content img { break-inside: avoid; }`;
  let head, bodyHtml;
  if (look) {
    // fondo de toda la hoja (márgenes incluidos): trama + texturas del tema + color del papel
    const layers = [look.trama && safe(look.trama, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/) ? `url("${look.trama}")` : null,
      look.pattern && look.pattern !== 'none' ? look.pattern.replace(/<\/style/gi, '') : null].filter(Boolean);
    const theme = safe(look.theme, /^[a-z-]+$/) || 'clasico';
    head = `${css('src/temas-especiales.css')}<style>
    @page {
      size: ${w}cm ${h}cm; margin: ${page.top}cm ${page.right}cm ${page.bottom}cm ${page.left}cm;
      background: ${layers.length ? layers.join(', ') + ', ' : ''}${color(look.bg, '#fff')};
    }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; }
    body { color: ${color(look.ink, '#000')}; }
    ${base}
    #text .doc-content { color: ${color(look.ink, '#000')}; filter: none !important; }
  </style>`;
    bodyHtml = `<body data-theme="${theme}"><div id="text"><div class="doc-content">${look.html}</div></div></body>`;
  } else {
    head = `<style>
    @page { size: ${w}cm ${h}cm; margin: ${page.top}cm ${page.right}cm ${page.bottom}cm ${page.left}cm; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    ${base}
  </style>`;
    bodyHtml = `<body><div class="doc-content">${html}</div></body>`;
  }
  const doc = `<!doctype html><html><head><meta charset="utf-8">${fonts}${css('src/content.css')}${head}</head>${bodyHtml}</html>`;

  const os = require('os');
  const tmp = path.join(os.tmpdir(), `mde-pdf-${Date.now()}.html`);
  await fs.writeFile(tmp, doc, 'utf8');
  const win = makeWindow();
  try {
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => 0))))');
    return await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    win.destroy();
    fs.rm(tmp, { force: true });
  }
}

module.exports = { readFile, writeFile, READABLE, WRITABLE, extOf };
