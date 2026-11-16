// Word (.docx): lectura a HTML (con tablas, imágenes y estilos) y escritura desde el documento del editor.
const TWIP_PER_CM = 1440 / 2.54;
const PX_PER_CM = 96 / 2.54;

// Tipografías de pantalla → equivalentes instalados en casi cualquier Word
const DOCX_FONT = { 'Courier Prime': 'Courier New', 'IBM Plex Mono': 'Consolas' };

// ===================== LECTURA =====================
async function readDocx(buf) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.convertToHtml({ buffer: buf }, {
    ignoreEmptyParagraphs: false, // las líneas en blanco son parte del texto
    styleMap: ['u => u', 's => s', "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
  });
  return { html: value, page: await docxPage(buf) };
}

// Tamaño de hoja, márgenes y tamaño de letra de document.xml / styles.xml
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
    const r = (n) => Math.round(n * 100) / 100;
    const page = {
      width: r(Math.min(w, h) / TWIP_PER_CM),
      height: r(Math.max(w, h) / TWIP_PER_CM),
      landscape: w > h,
      top: r((attr('pgMar', 'top') ?? 1418) / TWIP_PER_CM),
      right: r((attr('pgMar', 'right') ?? 1701) / TWIP_PER_CM),
      bottom: r((attr('pgMar', 'bottom') ?? 1418) / TWIP_PER_CM),
      left: r((attr('pgMar', 'left') ?? 1701) / TWIP_PER_CM),
    };
    const styles = zip.file('word/styles.xml') && await zip.file('word/styles.xml').async('string');
    const sz = styles && styles.match(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/);
    if (sz) page.fontSize = +sz[1] / 2;
    return page;
  } catch {
    return null;
  }
}

// ===================== ESCRITURA =====================

// Tamaño en píxeles de una imagen PNG, JPEG, GIF o BMP
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), type: 'gif' };
  if (buf.length > 26 && buf.toString('ascii', 0, 2) === 'BM') return { w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)), type: 'bmp' };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function buildDocx(json, page, font) {
  const D = require('docx');
  const family = DOCX_FONT[font] || font || 'Courier New';
  const tw = (cm) => Math.round(cm * TWIP_PER_CM);
  const sheetW = page.landscape ? page.height : page.width;
  const sheetH = page.landscape ? page.width : page.height;
  const colCm = sheetW - page.left - page.right;
  const colPx = colCm * PX_PER_CM;
  const halfPts = Math.round(page.fontSize * 2);
  const lineTw = (pt) => Math.round(pt * 1.2 * page.spacing * 20);
  const HEAD = { 1: 1.5, 2: 1.25, 3: 1.1 };
  let listInstance = 0;

  const runsOf = (nodes = [], extra = {}) => {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') { out.push(new D.TextRun({ break: 1 })); continue; }
      if (n.type === 'image') { const img = imageRun(n); if (img) out.push(img); continue; }
      if (n.type !== 'text') continue;
      const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]));
      const fmt = {
        font: family, ...extra,
        bold: !!marks.bold || extra.bold, italics: !!marks.italic,
        underline: marks.underline ? {} : undefined, strike: !!marks.strike,
      };
      n.text.split('\t').forEach((part, i) => {
        if (i) out.push(new D.TextRun({ ...fmt, children: [new D.Tab()] }));
        if (part) out.push(new D.TextRun({ ...fmt, text: part }));
      });
    }
    return out;
  };

  function imageRun(n) {
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i.exec(n.attrs?.src || '');
    if (!m) return null;
    const data = Buffer.from(m[2], 'base64');
    const size = imageSize(data);
    if (!size) return null;
    let w = Number(n.attrs.width) || size.w;
    w = Math.min(w, colPx);
    const h = Math.round(w * size.h / size.w);
    return new D.ImageRun({ type: size.type, data, transformation: { width: Math.round(w), height: h } });
  }

  const para = (children, opts = {}) => new D.Paragraph({
    spacing: { before: 0, after: 0, line: lineTw(opts.pt || page.fontSize), lineRule: D.LineRuleType.EXACT },
    ...opts.p,
    children,
  });

  function blocks(nodes = [], ctx = {}) {
    const out = [];
    for (const n of nodes) {
      switch (n.type) {
        case 'paragraph': {
          const imgs = (n.content || []).some((c) => c.type === 'image');
          out.push(new D.Paragraph({
            spacing: imgs ? { before: 0, after: 0 } : { before: 0, after: 0, line: lineTw(page.fontSize), lineRule: D.LineRuleType.EXACT },
            alignment: alignOf(n),
            ...ctx.p,
            children: runsOf(n.content),
          }));
          break;
        }
        case 'heading': {
          const k = HEAD[n.attrs?.level] || 1.1;
          const pt = page.fontSize * k;
          out.push(para(runsOf(n.content, { bold: true, size: Math.round(pt * 2), color: '000000' }), {
            pt, p: { heading: D.HeadingLevel[`HEADING_${n.attrs?.level || 1}`], alignment: alignOf(n) },
          }));
          break;
        }
        case 'image': {
          const img = imageRun(n);
          if (img) out.push(new D.Paragraph({ children: [img] }));
          break;
        }
        case 'bulletList':
        case 'orderedList': {
          const level = ctx.level ?? 0;
          const instance = n.type === 'orderedList' ? ++listInstance : 0;
          for (const li of n.content || []) {
            (li.content || []).forEach((child, i) => {
              if (child.type === 'bulletList' || child.type === 'orderedList') {
                out.push(...blocks([child], { level: level + 1 }));
              } else if (i === 0) {
                const p = n.type === 'bulletList'
                  ? { bullet: { level } }
                  : { numbering: { reference: 'ol', level, instance } };
                out.push(...blocks([child], { p }));
              } else {
                out.push(...blocks([child], { p: { indent: { left: 720 * (level + 1) } } }));
              }
            });
          }
          break;
        }
        case 'blockquote':
          out.push(...blocks(n.content, { p: { indent: { left: 567 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: '999999', space: 8 } } } }));
          break;
        case 'codeBlock':
          for (const line of (n.content || []).map((t) => t.text).join('').split('\n')) out.push(para(runsOf([{ type: 'text', text: line }])));
          break;
        case 'horizontalRule':
          out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, children: [] }));
          break;
        case 'table':
          out.push(table(n));
          out.push(para([])); // Word necesita un párrafo después de una tabla
          break;
        default:
          if (n.content) out.push(...blocks(n.content, ctx));
      }
    }
    return out;
  }

  function table(n) {
    const rows = n.content || [];
    const cols = Math.max(1, ...rows.map((r) => (r.content || []).reduce((a, c) => a + (c.attrs?.colspan || 1), 0)));
    const colTw = Math.floor(tw(colCm) / cols);
    return new D.Table({
      width: { size: colTw * cols, type: D.WidthType.DXA },
      columnWidths: Array(cols).fill(colTw),
      rows: rows.map((r) => new D.TableRow({
        children: (r.content || []).map((c) => {
          const header = c.type === 'tableHeader';
          const kids = blocks(header ? boldify(c.content) : c.content);
          return new D.TableCell({
            columnSpan: c.attrs?.colspan > 1 ? c.attrs.colspan : undefined,
            rowSpan: c.attrs?.rowspan > 1 ? c.attrs.rowspan : undefined,
            width: { size: colTw * (c.attrs?.colspan || 1), type: D.WidthType.DXA },
            margins: { left: 80, right: 80, top: 30, bottom: 30 },
            shading: header ? { fill: 'EDEDED', type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
            children: kids.length ? kids : [para([])],
          });
        }),
      })),
    });
  }

  const doc = new D.Document({
    creator: 'Editor genial',
    styles: { default: { document: { run: { font: family, size: halfPts } } } },
    numbering: {
      config: [{
        reference: 'ol',
        levels: [0, 1, 2, 3, 4].map((level) => ({
          level, format: [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN][level % 3],
          text: `%${level + 1}.`, alignment: D.AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: tw(Math.min(sheetW, sheetH)), height: tw(Math.max(sheetW, sheetH)), orientation: page.landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
          margin: { top: tw(page.top), right: tw(page.right), bottom: tw(page.bottom), left: tw(page.left), header: 0, footer: 0, gutter: 0 },
        },
      },
      children: blocks(json.content),
    }],
  });
  return D.Packer.toBuffer(doc);

  function alignOf(n) {
    return { center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED }[n.attrs?.textAlign];
  }
}

// Marca todo el texto como negrita (celdas de encabezado)
function boldify(nodes = []) {
  return nodes.map((n) => (n.type === 'text'
    ? { ...n, marks: [...(n.marks || []).filter((m) => m.type !== 'bold'), { type: 'bold' }] }
    : { ...n, content: n.content ? boldify(n.content) : n.content }));
}

module.exports = { readDocx, buildDocx, imageSize, DOCX_FONT };
