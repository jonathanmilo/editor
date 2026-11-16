// Texto plano y Markdown ↔ documento del editor.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Cada línea del texto es un párrafo (se conservan tabulaciones y espacios)
function textToHtml(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
}

const inline = (nodes = [], md = false) => nodes.map((n) => {
  if (n.type === 'hardBreak') return md ? '  \n' : '\n';
  if (n.type === 'image') return md ? `![imagen](${n.attrs?.src || ''})` : '[imagen]';
  if (n.type !== 'text') return '';
  if (!md) return n.text;
  let t = n.text.replace(/([*_`\\])/g, '\\$1');
  const m = new Set((n.marks || []).map((x) => x.type));
  if (m.has('bold') && m.has('italic')) t = `***${t}***`;
  else if (m.has('bold')) t = `**${t}**`;
  else if (m.has('italic')) t = `*${t}*`;
  if (m.has('strike')) t = `~~${t}~~`;
  return t;
}).join('');

// Documento → texto plano. Las tablas quedan con columnas separadas por tabulación.
function jsonToText(json) {
  const out = [];
  const walk = (nodes, prefix = '') => {
    for (const n of nodes || []) {
      if (n.type === 'paragraph' || n.type === 'heading') out.push(prefix + inline(n.content));
      else if (n.type === 'image') out.push('[imagen]');
      else if (n.type === 'horizontalRule') out.push('----------');
      else if (n.type === 'codeBlock') out.push(...inline(n.content).split('\n'));
      else if (n.type === 'bulletList' || n.type === 'orderedList') {
        (n.content || []).forEach((li, i) => {
          const mark = n.type === 'bulletList' ? '• ' : `${(n.attrs?.start || 1) + i}. `;
          const [first, ...rest] = li.content || [];
          if (first) walk([first], prefix + mark);
          walk(rest, prefix + '   ');
        });
      } else if (n.type === 'table') {
        for (const row of n.content || []) {
          out.push((row.content || []).map((c) => cellText(c)).join('\t'));
        }
      } else walk(n.content, prefix);
    }
  };
  walk(json.content);
  return out.join('\n');
}

const cellText = (c, md = false) => (c.content || []).map((p) => inline(p.content, md)).join(' ').replace(/\n/g, ' ');

function jsonToMarkdown(json) {
  const out = [];
  const walk = (nodes, indent = '') => {
    for (const n of nodes || []) {
      switch (n.type) {
        case 'paragraph': out.push(indent + inline(n.content, true), ''); break;
        case 'heading': out.push('#'.repeat(n.attrs?.level || 1) + ' ' + inline(n.content, true), ''); break;
        case 'image': out.push(`![imagen](${n.attrs?.src || ''})`, ''); break;
        case 'horizontalRule': out.push('---', ''); break;
        case 'blockquote': {
          const start = out.length; walk(n.content);
          for (let i = start; i < out.length; i++) out[i] = out[i] ? '> ' + out[i] : '>';
          break;
        }
        case 'codeBlock': out.push('```', inline(n.content), '```', ''); break;
        case 'bulletList':
        case 'orderedList':
          (n.content || []).forEach((li, i) => {
            const mark = n.type === 'bulletList' ? '- ' : `${(n.attrs?.start || 1) + i}. `;
            const [first, ...rest] = li.content || [];
            out.push(indent + mark + inline(first?.content, true));
            walk(rest, indent + '   ');
          });
          out.push('');
          break;
        case 'table': {
          const rows = (n.content || []).map((r) => (r.content || []).map((c) => cellText(c, true).replace(/\|/g, '\\|')));
          if (!rows.length) break;
          const cols = Math.max(...rows.map((r) => r.length));
          const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') + ' |';
          out.push(line(rows[0]), '|' + ' --- |'.repeat(cols), ...rows.slice(1).map(line), '');
          break;
        }
        default: walk(n.content, indent);
      }
    }
  };
  walk(json.content);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ¿El documento tiene algo que el texto plano no puede guardar?
function richFeatures(json) {
  const found = new Set();
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.type === 'image') found.add('imágenes');
      if (n.type === 'table') found.add('tablas');
      if (n.type === 'heading') found.add('títulos');
      if ((n.marks || []).length) found.add('negritas y cursivas');
      walk(n.content);
    }
  };
  walk(json.content);
  return [...found];
}

module.exports = { textToHtml, jsonToText, jsonToMarkdown, richFeatures };
