// Lector de PDF → HTML (párrafos, títulos, negritas, tablas e imágenes).
// Un PDF no guarda estructura, solo dibujos en coordenadas, así que se reconstruye:
//  - tablas con bordes: a partir de las líneas dibujadas (cuadrícula exacta, celdas de varias líneas)
//  - tablas sin bordes: por columnas alineadas en líneas consecutivas
//  - imágenes: se extraen los píxeles y su posición
//  - párrafos: se unen las líneas que se cortaron por falta de espacio
const zlib = require('zlib');

const PT_PER_CM = 72 / 2.54;
const PX_PER_PT = 96 / 72;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// ---------------- Imágenes ----------------
function pngEncode(width, height, channels, pixels) {
  const type = { 1: 0, 3: 2, 4: 6 }[channels];
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy ? pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
      : raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const chunk = (name, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = type; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Convierte una imagen decodificada por pdf.js en un data URL (PNG, o JPEG si es una foto grande)
function imageToDataUrl(img) {
  const { width: w, height: h, kind, data } = img;
  if (!data || !w || !h) return null;
  let channels, px;
  if (kind === 1) { // 1 bit por píxel, blanco y negro
    channels = 1; px = Buffer.alloc(w * h);
    const rowBytes = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      px[y * w + x] = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    }
  } else if (kind === 2) { channels = 3; px = Buffer.from(data.buffer, data.byteOffset, w * h * 3); }
  else if (kind === 3) { channels = 4; px = Buffer.from(data.buffer, data.byteOffset, w * h * 4); }
  else return null;

  // En Electron, las fotos grandes se guardan como JPEG para no inflar el documento
  if (process.versions.electron && w * h > 250000 && channels !== 1) {
    try {
      const { nativeImage } = require('electron');
      const bgra = Buffer.alloc(w * h * 4);
      for (let i = 0, j = 0; i < w * h; i++, j += channels) {
        bgra[i * 4] = px[j + 2]; bgra[i * 4 + 1] = px[j + 1]; bgra[i * 4 + 2] = px[j]; bgra[i * 4 + 3] = channels === 4 ? px[j + 3] : 255;
      }
      const jpg = nativeImage.createFromBitmap(bgra, { width: w, height: h }).toJPEG(85);
      return 'data:image/jpeg;base64,' + jpg.toString('base64');
    } catch { /* se usa PNG */ }
  }
  return 'data:image/png;base64,' + pngEncode(w, h, channels, px).toString('base64');
}

// ---------------- Tablas con bordes ----------------
function findGrids(hl, vl) {
  const tol = 2.5;
  const segs = [...hl.map((s) => ({ ...s, h: true })), ...vl.map((s) => ({ ...s, h: false }))];
  const parent = segs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touch = (a, b) => {
    if (a.h && !b.h) return b.x >= a.x0 - tol && b.x <= a.x1 + tol && a.y >= b.y0 - tol && a.y <= b.y1 + tol;
    if (!a.h && b.h) return touch(b, a);
    return false;
  };
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (touch(segs[i], segs[j])) parent[find(i)] = find(j);
  }
  const groups = {};
  segs.forEach((s, i) => (groups[find(i)] ||= []).push(s));

  const uniq = (vals) => {
    const out = [];
    for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
    return out;
  };
  const grids = [];
  for (const g of Object.values(groups)) {
    const H = g.filter((s) => s.h), V = g.filter((s) => !s.h);
    const ys = uniq(H.map((s) => s.y)).reverse(); // de arriba a abajo
    const xs = uniq(V.map((s) => s.x));
    if (ys.length < 2 || xs.length < 2) continue;
    grids.push({ ys, xs, V, x0: xs[0], x1: xs[xs.length - 1], top: ys[0], bottom: ys[ys.length - 1] });
  }
  return grids;
}

// ---------------- Lectura principal ----------------
async function readPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = pdfjs.OPS;
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true, verbosity: 0, isOffscreenCanvasSupported: false,
  });
  const pdf = await task.promise;

  let pageSize = null;
  const bounds = { left: Infinity, right: Infinity, top: Infinity, bottom: Infinity };
  const sizes = [];
  const pages = [];
  const notes = []; // notas adhesivas del PDF → notas de escritura

  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    const [vx0, vy0, vx1, vy1] = pg.view;
    const W = vx1 - vx0, H = vy1 - vy0;
    if (!pageSize) pageSize = { W, H };

    // ----- gráficos: líneas (bordes de tabla) e imágenes -----
    const ops = await pg.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [], hl = [], vl = [], images = [];
    const strokeOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.constructPath) {
        const mm = args[2];
        if (!mm || !Number.isFinite(mm[0])) continue;
        const [ax, ay] = apply(ctm, mm[0], mm[1]), [bx, by] = apply(ctm, mm[2], mm[3]);
        const x0 = Math.min(ax, bx) - vx0, x1 = Math.max(ax, bx) - vx0, y0 = Math.min(ay, by) - vy0, y1 = Math.max(ay, by) - vy0;
        const w = x1 - x0, h = y1 - y0;
        if (w > W * 0.9 && h > H * 0.9) continue; // fondo de página
        if (h <= 2.5 && w > 4) hl.push({ y: (y0 + y1) / 2, x0, x1 });
        else if (w <= 2.5 && h > 4) vl.push({ x: (x0 + x1) / 2, y0, y1 });
        else if (strokeOps.has(args[0]) && w > 4 && h > 4) { // rectángulo con borde = 4 lados
          hl.push({ y: y0, x0, x1 }, { y: y1, x0, x1 });
          vl.push({ x: x0, y0, y1 }, { x: x1, y0, y1 });
        }
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        const [ax, ay] = apply(ctm, 0, 0), [bx, by] = apply(ctm, 1, 1);
        const x0 = Math.min(ax, bx) - vx0, y0 = Math.min(ay, by) - vy0, y1 = Math.max(ay, by) - vy0;
        const w = Math.abs(bx - ax), h = y1 - y0;
        if (w < 12 || h < 12) continue;
        let img = args[0];
        if (typeof img === 'string') {
          const store = img.startsWith('g_') ? pg.commonObjs : pg.objs;
          img = await new Promise((res) => { try { store.get(img, res); } catch { res(null); } });
        }
        const src = img && imageToDataUrl(img);
        if (src) images.push({ x0, w, h, top: y1, bottom: y0, src });
      }
    }

    // ----- texto -----
    try {
      for (const a of await pg.getAnnotations({ intent: 'display' })) {
        const text = (a.contentsObj?.str ?? a.contents ?? '').trim();
        if ((a.subtype === 'Text' || a.subtype === 'FreeText') && text) notes.push(text);
      }
    } catch { /* sin anotaciones legibles */ }
    const content = await pg.getTextContent();
    const frags = [];
    for (const it of content.items) {
      if (!it.str) continue;
      const x = it.transform[4] - vx0, y = it.transform[5] - vy0;
      const size = Math.abs(it.transform[3]) || it.height || 10;
      let fontName = '';
      try { if (pg.commonObjs.has(it.fontName)) fontName = pg.commonObjs.get(it.fontName).name || ''; } catch { /* sin nombre */ }
      const blank = !it.str.trim();
      frags.push({
        x, y, w: it.width, size, str: it.str, blank,
        bold: /bold|black|heavy|semibold|demi/i.test(fontName),
        italic: /italic|oblique/i.test(fontName),
      });
      if (!blank) {
        sizes.push(size);
        bounds.left = Math.min(bounds.left, x);
        bounds.right = Math.min(bounds.right, W - (x + it.width));
        bounds.top = Math.min(bounds.top, H - (y + size));
        if (n < pdf.numPages) bounds.bottom = Math.min(bounds.bottom, y);
      }
    }
    for (const im of images) {
      bounds.left = Math.min(bounds.left, im.x0);
      bounds.top = Math.min(bounds.top, H - im.top);
    }

    // ----- tablas con bordes -----
    const blocks = [];
    const used = new Set();
    for (const g of findGrids(hl, vl)) {
      const rows = [];
      for (let r = 0; r < g.ys.length - 1; r++) {
        const top = g.ys[r], bottom = g.ys[r + 1], mid = (top + bottom) / 2;
        // separadores verticales presentes en esta fila (los que faltan = celdas combinadas)
        const present = g.xs.map((x, k) => k === 0 || k === g.xs.length - 1 ||
          g.V.some((v) => Math.abs(v.x - x) < 2.5 && v.y0 <= mid && v.y1 >= mid));
        const cells = [];
        let start = 0;
        for (let k = 1; k < g.xs.length; k++) {
          if (!present[k]) continue;
          const left = g.xs[start], right = g.xs[k];
          const inside = frags.filter((f, idx) => {
            const cx = f.x + f.w / 2, cy = f.y + f.size * 0.35;
            const hit = cx > left && cx < right && cy < top && cy > bottom;
            if (hit) used.add(idx);
            return hit && !f.blank;
          });
          cells.push({ colspan: k - start, lines: groupLines(inside) });
          start = k;
        }
        rows.push(cells);
      }
      if (rows.length && rows.some((r) => r.some((c) => c.lines.length))) blocks.push({ kind: 'table', top: g.top, rows, x0: g.x0 });
    }

    // ----- líneas de texto (fuera de tablas) -----
    const lines = groupLines(frags.filter((f, i) => !used.has(i)));
    const gaps = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
    const typical = median(gaps.filter((g) => g > 0)) || 14;
    lines.forEach((l, i) => { l.gap = i ? lines[i - 1].y - l.y : null; });

    // ----- tablas sin bordes: columnas alineadas en líneas seguidas -----
    const flow = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.segs.length >= 2) {
        const anchors = l.segs.map((s) => s.x0);
        const tol = l.cw * 2;
        const col = (s) => { let k = -1; anchors.forEach((a, j) => { if (s.x0 >= a - tol) k = j; }); return k; };
        const fits = (ln) => ln.segs.every((s) => { const k = col(s); return k >= 0 && Math.abs(s.x0 - anchors[k]) < tol * 6; });
        const rows = [l];
        let j = i + 1;
        while (j < lines.length && lines[j].gap <= typical * 2.2 && fits(lines[j]) &&
          (lines[j].segs.length >= 2 || col(lines[j].segs[0]) > 0)) { rows.push(lines[j]); j++; }
        if (rows.length >= 2) {
          const out = [];
          for (const ln of rows) {
            const cells = anchors.map(() => []);
            for (const s of ln.segs) cells[col(s)].push(...s.runs);
            const continuation = out.length && !cells[0].length && ln.gap <= typical * 1.3;
            if (continuation) out[out.length - 1].forEach((c, k) => { if (cells[k].length) c.push({ text: ' ' }, ...cells[k]); });
            else out.push(cells);
          }
          flow.push({ kind: 'table', top: l.y + l.size, rows: out.map((r) => r.map((runs) => ({ colspan: 1, lines: [{ runs }] }))), x0: l.x });
          i = j - 1;
          continue;
        }
      }
      flow.push({ kind: 'line', top: l.y + l.size, ...l });
    }

    for (const im of images) flow.push({ kind: 'image', ...im });
    blocks.push(...flow);
    blocks.sort((a, b) => b.top - a.top);
    pages.push({ blocks, typical });
  }
  await task.destroy();

  // ----- reconstrucción del documento -----
  const body = median(sizes) || 12;
  const all = pages.flatMap((p, pi) => p.blocks.map((b, bi) => ({ ...b, typical: p.typical, pageStart: bi === 0 && pi > 0 })));
  const proseLines = all.filter((b) => b.kind === 'line');
  const maxRight = Math.max(...proseLines.map((l) => l.right), 0);
  const minLeft = Math.min(...proseLines.map((l) => l.x), Infinity);
  const colW = (pageSize.W - (Number.isFinite(bounds.left) ? bounds.left : 72) - (Number.isFinite(bounds.right) ? bounds.right : 72));

  // interlineado normal = separación más frecuente entre líneas seguidas
  const gapCount = {};
  for (const b of proseLines) if (b.gap > 0 && !b.pageStart) { const k = Math.round(b.gap * 2) / 2; gapCount[k] = (gapCount[k] || 0) + 1; }
  const mode = +Object.keys(gapCount).sort((a, b) => gapCount[b] - gapCount[a])[0] || body * 1.2;
  // niveles de título según el tamaño (el mayor es Título 1)
  const headSizes = [...new Set(proseLines.filter((l) => l.size / body >= 1.15).map((l) => Math.round(l.size)))].sort((a, b) => b - a);
  const tagOf = (size) => { const k = headSizes.indexOf(Math.round(size)); return k < 0 ? 'p' : 'h' + Math.min(3, k + 1); };

  const html = [];
  let para = null; // { tag, runs, last }
  const flush = () => { if (para) { html.push(`<${para.tag}>${runsHtml(para.runs)}</${para.tag}>`); para = null; } };

  let prev = null;
  for (const b of all) {
    const before = prev;
    prev = b;
    if (b.kind === 'table') {
      flush();
      html.push('<table><tbody>' + b.rows.map((row, ri) => {
        const header = ri === 0 && row.every((c) => c.lines.length && c.lines.every((l) => l.runs.every((r) => !r.text.trim() || r.bold)));
        return '<tr>' + row.map((c) => {
          const tag = header ? 'th' : 'td';
          const runs = c.lines.flatMap((l, k) => (k ? [{ text: ' ' }, ...l.runs] : l.runs));
          return `<${tag}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}><p>${runsHtml(runs, header)}</p></${tag}>`;
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>');
      continue;
    }
    if (b.kind === 'image') {
      flush();
      const px = Math.round(Math.min(b.w, colW) * PX_PER_PT);
      html.push(`<img src="${b.src}" width="${px}">`);
      continue;
    }
    // línea de texto
    const tag = tagOf(b.size);
    const indent = Math.round((b.x - minLeft) / b.cw);
    const lead = tag === 'p' && indent >= 2 ? '\t'.repeat(Math.floor(indent / 4)) + ' '.repeat(indent % 4) : '';
    const unit = Math.max(mode, b.size * 1.15);
    const afterBlock = before && before.kind !== 'line';
    const blanks = b.gap && !afterBlock && b.gap > unit * 1.6 ? Math.min(2, Math.round(b.gap / unit) - 1) : 0;
    const regular = b.gap === null || b.pageStart || Math.abs(b.gap - mode) < mode * 0.12 || (b.gap >= b.size * 0.95 && b.gap <= b.size * 1.45);
    const wraps = para && para.tag === tag && !lead && regular && !blanks &&
      (tag !== 'p' || para.last.right + para.last.cw + b.firstW > maxRight + para.last.cw * 0.5);
    if (wraps) {
      const prevText = para.runs[para.runs.length - 1]?.text || '';
      if (!prevText.endsWith('-')) para.runs.push({ text: ' ' });
      para.runs.push(...b.runs);
      para.last = b;
    } else {
      flush();
      if (!b.pageStart) for (let k = 0; k < blanks; k++) html.push('<p></p>');
      para = { tag, runs: lead ? [{ text: lead }, ...b.runs] : [...b.runs], last: b };
    }
  }
  flush();

  const portrait = { w: Math.min(pageSize.W, pageSize.H), h: Math.max(pageSize.W, pageSize.H) };
  const r1 = (n) => Math.round(n * 10) / 10, r2 = (n) => Math.round(n * 100) / 100;
  const toCm = (pt) => r1(Math.min(6, Math.max(0.5, pt / PT_PER_CM)));
  const top = Number.isFinite(bounds.top) ? toCm(bounds.top) : null;
  const left = Number.isFinite(bounds.left) ? toCm(bounds.left) : null;
  const fontSize = Math.round(body * 2) / 2;
  return {
    html: html.join(''),
    notes,
    hasText: sizes.length > 0 || html.some((h) => h.startsWith('<img')),
    page: {
      width: r2(portrait.w / PT_PER_CM), height: r2(portrait.h / PT_PER_CM), landscape: pageSize.W > pageSize.H,
      ...(top !== null && left !== null ? {
        left, top,
        // si el texto no llega al borde derecho no se puede deducir: se asume simétrico
        right: toCm(bounds.right) > left + 1.5 ? left : toCm(bounds.right),
        bottom: Number.isFinite(bounds.bottom) ? toCm(bounds.bottom) : top,
      } : {}),
      ...(fontSize >= 6 && fontSize <= 36 ? { fontSize } : {}),
    },
  };
}

// Agrupa fragmentos en líneas y cada línea en segmentos (columnas separadas por huecos grandes)
function groupLines(frags) {
  const lines = [];
  for (const f of frags) {
    let line = lines.find((l) => Math.abs(l.y - f.y) < Math.max(l.size, f.size) * 0.5);
    if (!line) { line = { y: f.y, size: f.size, frags: [] }; lines.push(line); }
    line.frags.push(f);
    line.size = Math.max(line.size, f.size);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) {
    l.frags.sort((a, b) => a.x - b.x);
    const solid = l.frags.filter((f) => !f.blank);
    l.cw = solid.reduce((a, f) => a + f.w, 0) / Math.max(1, solid.reduce((a, f) => a + f.str.length, 0)) || l.size * 0.5;
    l.segs = [];
    let seg = null, end = null;
    for (const f of l.frags) {
      if (f.blank) {
        if (f.w > l.cw * 2.5) seg = null; // espacio ancho = salto de columna
        else if (seg) seg.runs.push({ text: ' ', bold: f.bold, italic: f.italic });
        end = f.x + f.w;
        continue;
      }
      const gap = end === null ? 0 : f.x - end;
      if (!seg || gap > l.cw * 2.5) { seg = { x0: f.x, runs: [] }; l.segs.push(seg); }
      else if (gap > f.size * 0.2 && !/\s$/.test(seg.runs[seg.runs.length - 1]?.text || '') && !/^\s/.test(f.str)) seg.runs.push({ text: ' ' });
      seg.runs.push({ text: f.str, bold: f.bold, italic: f.italic });
      seg.x1 = f.x + f.w;
      end = f.x + f.w;
    }
    for (const s of l.segs) {
      const last = s.runs[s.runs.length - 1]; if (last) last.text = last.text.replace(/\s+$/, '');
      const first = s.runs[0]; if (first) first.text = first.text.replace(/^\s+/, '');
    }
    l.segs = l.segs.filter((s) => s.runs.some((r) => r.text));
    l.x = l.segs[0]?.x0 ?? 0;
    l.right = l.segs.length ? l.segs[l.segs.length - 1].x1 : 0;
    // texto de la línea completa (segmentos unidos por tabulación)
    l.runs = l.segs.flatMap((s, k) => (k ? [{ text: '\t' }, ...s.runs] : s.runs));
    const firstWord = (l.segs[0]?.runs.map((r) => r.text).join('') || '').trim().split(/\s+/)[0] || '';
    l.firstW = firstWord.length * l.cw;
  }
  return lines.filter((l) => l.segs.length);
}

// Une fragmentos con el mismo estilo y los convierte a HTML
function runsHtml(runs, forceBold = false) {
  const merged = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    const b = !!r.bold && !forceBold, it = !!r.italic;
    if (last && (last.b === b && last.it === it || !r.text.trim())) last.text += r.text;
    else merged.push({ text: r.text, b, it });
  }
  return merged.map((m) => {
    let s = esc(m.text);
    if (m.it) s = `<em>${s}</em>`;
    if (m.b) s = `<strong>${s}</strong>`;
    return s;
  }).join('');
}

module.exports = { readPdf, pngEncode };
