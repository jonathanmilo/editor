// Editor de texto enriquecido (Tiptap/ProseMirror). Se empaqueta con esbuild en src/vendor/editor.js
// y queda disponible como window.RichEditor.
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';

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

function create({ element, html = '', placeholder = '', maxImageWidth = () => 600, ownScroll = () => false, onUpdate, onSelection, onError }) {
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
  return editor;
}

// Texto plano → HTML (una línea, un párrafo)
function textToHtml(text) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return (text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
}

window.RichEditor = { create, textToHtml, PARSE };
