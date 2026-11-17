// Editor de texto enriquecido (Tiptap/ProseMirror). Se empaqueta con esbuild en src/vendor/editor.js
// y queda disponible como window.RichEditor.
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const PARSE = { preserveWhitespace: 'full' };

// Tab escribe una tabulación (en tablas y listas conserva su función normal)
const TabKey = Extension.create({
  name: 'tabKey',
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('table') || this.editor.isActive('listItem')) return false;
        return this.editor.commands.command(({ tr }) => { tr.insertText('\t'); return true; });
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Estilo por palabra (temas Collage y Fotocopia).
// Cada palabra recibe clases que la hacen parecer un recorte de revista o una
// fotocopia irregular. Son decoraciones: el texto del documento no cambia y lo
// que se guarda en Word/PDF queda limpio.
// El estilo depende de la posición de la palabra en su párrafo y del inicio del
// párrafo, así una palabra no cambia de aspecto mientras se escribe.
const wordKey = new PluginKey('wordStyle');
const VARIANTS = { s: 14, r: 7, z: 4, c: 4 }; // estilos, giros, tamaños, recortes

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function decorateBlock(node, pos, out, prefix) {
  const text = node.textContent;
  const key = text.slice(0, 12);
  const re = /\S+/g;
  let m, i = 0;
  // posiciones de texto → posiciones del documento (los nodos en línea ocupan 1)
  const map = [];
  node.forEach((child, offset) => {
    if (child.isText) for (let k = 0; k < child.text.length; k++) map.push(pos + 1 + offset + k);
    else if (child.isInline) { /* imagen o salto: no forma parte de textContent */ }
  });
  while ((m = re.exec(text))) {
    const from = map[m.index], to = map[m.index + m[0].length - 1] + 1;
    if (from == null || to == null) continue;
    const h = hash(key + '|' + m.index + '|' + i++);
    const cls = `cw s${h % VARIANTS.s} r${(h >>> 4) % VARIANTS.r} z${(h >>> 8) % VARIANTS.z} c${(h >>> 12) % VARIANTS.c}`;
    out.push(Decoration.inline(from, to, { class: `${prefix} ${cls}` }));
  }
}

function buildAll(doc, prefix) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) { decorateBlock(node, pos, out, prefix); return false; }
    return true;
  });
  return DecorationSet.create(doc, out);
}

const WordStyle = Extension.create({
  name: 'wordStyle',
  addOptions() { return { mode: () => null }; },
  addProseMirrorPlugins() {
    const mode = this.options.mode;
    return [new Plugin({
      key: wordKey,
      state: {
        init: (_, state) => (mode() ? buildAll(state.doc, mode()) : DecorationSet.empty),
        apply(tr, set, _old, state) {
          const m = mode();
          if (!m) return DecorationSet.empty;
          if (tr.getMeta(wordKey) || set === DecorationSet.empty) return buildAll(state.doc, m);
          if (!tr.docChanged) return set;
          // solo se recalculan los párrafos tocados
          set = set.map(tr.mapping, tr.doc);
          const touched = new Set();
          tr.mapping.maps.forEach((map, i) => map.forEach((_s, _e, from, to) => {
            const rest = tr.mapping.slice(i + 1);
            touched.add([rest.map(from, -1), rest.map(to, 1)]);
          }));
          for (const [from, to] of touched) {
            const a = Math.max(0, Math.min(from, tr.doc.content.size)), b = Math.min(tr.doc.content.size, Math.max(to, a));
            tr.doc.nodesBetween(a, b, (node, pos) => {
              if (!node.isTextblock) return true;
              set = set.remove(set.find(pos, pos + node.nodeSize));
              const fresh = [];
              decorateBlock(node, pos, fresh, m);
              set = set.add(tr.doc, fresh);
              return false;
            });
          }
          return set;
        },
      },
      props: { decorations: (state) => wordKey.getState(state) },
    })];
  },
});

// La imagen guarda su ancho en píxeles de documento (96 por pulgada)
const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = parseFloat(el.getAttribute('width') || el.style.width);
          return Number.isFinite(w) && w > 0 ? Math.round(w) : null;
        },
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      height: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    };
  },
});

// Lee un archivo de imagen como data URL; formatos que Word no admite se convierten a PNG
function readImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const url = fr.result;
      const img = new window.Image();
      img.onload = () => {
        let src = url;
        if (!/^data:image\/(png|jpe?g|gif|bmp)/i.test(url)) {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          src = c.toDataURL('image/png');
        }
        resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => reject(new Error('imagen no válida'));
      img.src = url;
    };
    fr.readAsDataURL(file);
  });
}

const imageFiles = (list) => [...(list || [])].filter((f) => f.type.startsWith('image/'));

function create({ element, html = '', placeholder = '', maxImageWidth = () => 600, ownScroll = () => false, wordMode = () => null, onUpdate, onSelection, onError }) {
  let editor;
  const insertImages = async (files, pos) => {
    for (const f of files) {
      try {
        const im = await readImage(f);
        const width = Math.min(im.width, Math.round(maxImageWidth()));
        // la imagen y, debajo, una línea nueva para seguir escribiendo
        const content = [{ type: 'image', attrs: { src: im.src, width } }, { type: 'paragraph' }];
        if (pos != null) editor.chain().insertContentAt(pos, content).run();
        else editor.chain().insertContent(content).run();
      } catch (e) { onError?.(`No se pudo insertar la imagen: ${e.message}`); }
    }
    editor.commands.focus();
  };

  editor = new Editor({
    element,
    content: html,
    parseOptions: PARSE,
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      TableKit.configure({ table: { resizable: false, cellMinWidth: 30 } }),
      DocImage.configure({ allowBase64: true, inline: false, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 30, minHeight: 20 } }),
      Placeholder.configure({ placeholder }),
      TabKey,
      WordStyle.configure({ mode: wordMode }),
    ],
    editorProps: {
      attributes: { class: 'doc-content', spellcheck: 'true' },
      // en modo máquina de escribir el desplazamiento lo controla el riel, no el editor
      handleScrollToSelection: () => ownScroll(),
      // texto plano pegado: cada línea es un párrafo (se conservan líneas en blanco y tabulaciones)
      clipboardTextParser(text, $context) {
        const div = document.createElement('div');
        div.innerHTML = textToHtml(text);
        return PMDOMParser.fromSchema(editor.schema).parseSlice(div, { preserveWhitespace: 'full', context: $context });
      },
      handlePaste(view, event) {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        insertImages(files);
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        event.stopPropagation();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertImages(files, at ? at.pos : null);
        return true;
      },
    },
    onUpdate: () => onUpdate?.(),
    onSelectionUpdate: () => onSelection?.(),
  });

  editor.insertImages = insertImages;
  // recalcula el estilo de todas las palabras (al cambiar de tema)
  editor.refreshWordStyle = () => editor.view.dispatch(editor.state.tr.setMeta(wordKey, true));
  return editor;
}

// Texto plano → HTML (una línea, un párrafo)
function textToHtml(text) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return (text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
}

window.RichEditor = { create, textToHtml, PARSE };
