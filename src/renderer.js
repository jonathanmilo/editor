// Lógica de la interfaz: biblioteca, editor en modo máquina de escribir, hoja, archivos, ajustes y notas.
(() => {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const root = document.documentElement;
  const ta = $('#text');
  const page = $('#page');
  const col = $('#col');
  const paper = $('#paper');
  const leds = [...document.querySelectorAll('#carriage .body i')];
  const isDesktop = !!window.api;

  // ---------------- Almacenamiento (Electron o, si no, localStorage) ----------------
  const api = window.api || (() => {
    const KEY = 'mde:docs';
    const all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
    const put = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* sin almacenamiento */ } };
    return {
      platform: 'web',
      async listDocs() {
        return Object.values(all())
          .map((d) => ({ id: d.id, title: d.title, updated: d.updated, words: d.words, source: d.source, preview: (d.text || '').slice(0, 200) }))
          .sort((a, b) => b.updated - a.updated);
      },
      async loadDoc(id) { return all()[id] || null; },
      async saveDoc(doc) { const o = all(); o[doc.id] = doc; put(o); return true; },
      async deleteDoc(id) { const o = all(); delete o[id]; put(o); return true; },
      async openFile() {
        return new Promise((res) => {
          const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.txt,.md,text/plain' });
          inp.onchange = async () => {
            const f = inp.files[0];
            res(f ? { name: f.name.replace(/\.[^.]+$/, ''), format: 'txt', text: await f.text() } : null);
          };
          inp.click();
        });
      },
      async saveFile({ format, name, text }) {
        if (format !== 'txt' && format !== 'md') return { error: 'Word y PDF solo están disponibles en la app de escritorio' };
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })),
          download: `${name}.${format}`,
        });
        a.click();
        return { name, format };
      },
      async confirm({ message, buttons }) { return confirm(message) ? 0 : buttons.length - 1; },
      reveal() {}, setTheme() {}, onMenu() {}, onOpenPath() {}, readPath: async () => null, pathForFile: () => null,
    };
  })();

  if (api.platform === 'darwin') body.classList.add('mac');
  if (!isDesktop) root.style.setProperty('--titlebar-pad', '12px');

  // ---------------- Hoja ----------------
  const PRESETS = {
    carta: [21.59, 27.94], a4: [21, 29.7], oficio: [21.59, 33.02], legal: [21.59, 35.56], a5: [14.8, 21], b5: [17.6, 25],
  };
  const PAGE_DEFAULT = { preset: 'carta', width: 21.59, height: 27.94, landscape: false, top: 2.5, bottom: 2.5, left: 3, right: 3, fontSize: 12, spacing: 1.15 };
  const MIN_COL_CM = 2;

  const presetOf = (w, h) => {
    const [a, b] = [Math.min(w, h), Math.max(w, h)];
    return Object.keys(PRESETS).find((k) => Math.abs(PRESETS[k][0] - a) < 0.15 && Math.abs(PRESETS[k][1] - b) < 0.15) || 'custom';
  };
  const sheetDims = (p) => (p.landscape ? { w: p.height, h: p.width } : { w: p.width, h: p.height });

  // Garantiza que la hoja sea coherente (márgenes que caben, valores numéricos)
  function fixPage(p) {
    const q = { ...PAGE_DEFAULT, ...p };
    for (const k of ['width', 'height', 'top', 'bottom', 'left', 'right', 'fontSize', 'spacing']) q[k] = +q[k] || 0;
    q.width = Math.max(5, q.width); q.height = Math.max(5, q.height);
    q.fontSize = Math.min(36, Math.max(6, q.fontSize || 12));
    q.spacing = q.spacing || 1;
    const { w, h } = sheetDims(q);
    q.left = Math.max(0, q.left); q.right = Math.max(0, q.right);
    if (q.left + q.right > w - MIN_COL_CM) { const k = (w - MIN_COL_CM) / (q.left + q.right); q.left *= k; q.right *= k; }
    q.top = Math.max(0, Math.min(q.top, h / 3)); q.bottom = Math.max(0, Math.min(q.bottom, h / 3));
    for (const k of ['top', 'bottom', 'left', 'right']) q[k] = Math.round(q[k] * 100) / 100;
    q.preset = presetOf(q.width, q.height);
    return q;
  }

  // ---------------- Ajustes ----------------
  const DEFAULTS = {
    theme: 'light', typewriter: true, font: 'Courier Prime',
    zoom: 130, rail: 77, light: 100, sound: true, fade: true, strict: false, showSheet: false,
    pageDefault: PAGE_DEFAULT,
  };
  let S = { ...DEFAULTS };
  try { Object.assign(S, JSON.parse(localStorage.getItem('mde:settings')) || {}); } catch { /* valores por defecto */ }
  if (S.font.includes(',')) S.font = S.font.split(',')[0].replace(/'/g, '').trim(); // ajustes de la versión anterior
  S.pageDefault = fixPage(S.pageDefault);
  const saveSettings = () => { try { localStorage.setItem('mde:settings', JSON.stringify(S)); } catch { /* ignorar */ } };

  let doc = null;
  const P = () => (doc ? doc.page : S.pageDefault);

  function applySettings() {
    body.classList.toggle('theme-light', S.theme === 'light');
    body.classList.toggle('theme-dark', S.theme === 'dark');
    body.classList.toggle('typewriter', S.typewriter);
    body.classList.toggle('fade-far', S.fade);
    body.classList.toggle('show-sheet', S.showSheet);
    root.style.setProperty('--font-text', `'${S.font}', 'Courier New', monospace`);
    root.style.setProperty('--light', S.light / 100);
    $('#tw-switch').checked = S.typewriter;
    $('#tw-state').textContent = S.typewriter ? 'Activada' : 'Desactivada';
    $('#s-font').value = S.font;
    $('#s-zoom').value = S.zoom; $('#o-zoom').textContent = S.zoom + ' %';
    $('#s-rail').value = S.rail; $('#o-rail').textContent = S.rail + ' %';
    $('#s-light').value = S.light; $('#o-light').textContent = S.light + ' %';
    $('#s-sound').checked = S.sound;
    $('#s-fade').checked = S.fade;
    $('#s-strict').checked = S.strict;
    $('#s-sheet').checked = S.showSheet;
    api.setTheme(S.theme);
    fillPageForm();
    layout(true);
  }

  function set(key, val) { S[key] = val; saveSettings(); applySettings(); }

  $('#s-font').onchange = (e) => { set('font', e.target.value); document.fonts.ready.then(() => layout(true)); };
  $('#s-zoom').oninput = (e) => set('zoom', +e.target.value);
  $('#s-rail').oninput = (e) => set('rail', +e.target.value);
  $('#s-light').oninput = (e) => set('light', +e.target.value);
  $('#s-sound').onchange = (e) => set('sound', e.target.checked);
  $('#s-fade').onchange = (e) => set('fade', e.target.checked);
  $('#s-strict').onchange = (e) => set('strict', e.target.checked);
  $('#s-sheet').onchange = (e) => set('showSheet', e.target.checked);
  $('#tw-switch').onchange = (e) => { set('typewriter', e.target.checked); ta.focus(); };
  $('#theme-btn').onclick = () => set('theme', S.theme === 'light' ? 'dark' : 'light');

  // ----- Formulario de la hoja -----
  const fmtNum = (n) => String(Math.round(n * 100) / 100);
  function fillPageForm() {
    const p = P();
    $('#p-preset').value = p.preset;
    document.querySelectorAll('#p-orient button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'landscape') === p.landscape));
    for (const k of ['width', 'height', 'top', 'bottom', 'left', 'right']) {
      const el = $('#p-' + k);
      if (document.activeElement !== el) el.value = fmtNum(p[k]);
    }
    if (document.activeElement !== $('#p-size')) $('#p-size').value = fmtNum(p.fontSize);
    $('#p-spacing').value = String(p.spacing);
    updateReadout();
  }

  function updateReadout() {
    const p = P();
    const { w, h } = sheetDims(p);
    const chCm = charCm(p.fontSize);
    const cols = Math.floor((w - p.left - p.right) / chCm + 0.001);
    const lines = linesPerPage(p);
    const pitch = Math.round(CM_PER_IN / chCm);
    $('#p-readout').innerHTML =
      `<b>${cols}</b> caracteres por línea · <b>${lines}</b> líneas por página<br>` +
      `Hoja ${fmtNum(w).replace('.', ',')} × ${fmtNum(h).replace('.', ',')} cm · paso ${pitch} car./pulgada`;
  }

  function editPage(patch) {
    if (!doc) return;
    doc.page = fixPage({ ...doc.page, ...patch });
    fillPageForm();
    layout(true);
    dirty();
  }

  $('#p-preset').onchange = (e) => {
    const v = e.target.value;
    if (PRESETS[v]) editPage({ width: PRESETS[v][0], height: PRESETS[v][1] });
    else fillPageForm();
  };
  document.querySelectorAll('#p-orient button').forEach((b) => (b.onclick = () => editPage({ landscape: b.dataset.v === 'landscape' })));
  const numField = (id, key) => {
    const el = $(id);
    el.addEventListener('change', () => { if (el.value !== '') editPage({ [key]: parseFloat(el.value) }); });
    el.addEventListener('blur', fillPageForm);
  };
  numField('#p-width', 'width'); numField('#p-height', 'height');
  numField('#p-top', 'top'); numField('#p-bottom', 'bottom'); numField('#p-left', 'left'); numField('#p-right', 'right');
  numField('#p-size', 'fontSize');
  $('#p-spacing').onchange = (e) => editPage({ spacing: parseFloat(e.target.value) });
  $('#p-make-default').onclick = () => { S.pageDefault = fixPage(P()); saveSettings(); toast('Hoja predeterminada actualizada'); };
  $('#p-reset').onclick = () => editPage({ ...S.pageDefault });

  // ---------------- Medidas ----------------
  const CM_PER_IN = 2.54;
  const PX_PER_CM = 96 / CM_PER_IN;
  let charRatio = 0.6; // ancho de un carácter / tamaño de letra (se mide con la fuente real)
  const charCm = (pt) => (pt / 72) * CM_PER_IN * charRatio;
  const lineCm = (p) => (p.fontSize * 1.2 * p.spacing / 72) * CM_PER_IN;
  const linesPerPage = (p) => Math.max(1, Math.floor((sheetDims(p).h - p.top - p.bottom) / lineCm(p) + 0.001));

  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', visibility: 'hidden', pointerEvents: 'none',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', tabSize: '4',
  });
  col.appendChild(mirror);
  const marker = document.createElement('span');

  function caretPos() {
    const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const v = ta.value;
    mirror.textContent = v.slice(0, pos);
    marker.textContent = v.slice(pos) || '.';
    mirror.appendChild(marker);
    return { top: marker.offsetTop, left: marker.offsetLeft, pos };
  }

  function charWidthPx() {
    mirror.textContent = '';
    const s = document.createElement('span');
    s.textContent = '0'.repeat(20);
    mirror.appendChild(s);
    return s.getBoundingClientRect().width / 20;
  }

  // ---------------- Disposición (hoja, riel, carro, topes) ----------------
  let railY = 0, review = 0, chW = 12, lineH = 28, scale = PX_PER_CM, lastLineTop = null, lastCol = 0, bellRung = false, raf = 0;
  const GAP = 26; // distancia entre la línea activa y el riel

  function geometry() {
    const p = P();
    const { w, h } = sheetDims(p);
    const want = PX_PER_CM * S.zoom / 100;
    const fit = (window.innerWidth - 64) / (w * want);
    scale = want * Math.min(1, fit); // px por cm
    const fontPx = (p.fontSize / 72) * CM_PER_IN * scale;
    lineH = fontPx * 1.2 * p.spacing;
    root.style.setProperty('--font-size', fontPx.toFixed(3) + 'px');
    root.style.setProperty('--line-px', lineH.toFixed(3) + 'px');
    root.style.setProperty('--sheet-w', (w * scale).toFixed(2) + 'px');
    root.style.setProperty('--sheet-h', (h * scale).toFixed(2) + 'px');
    root.style.setProperty('--pad-t', (p.top * scale).toFixed(2) + 'px');
    root.style.setProperty('--pad-b', (p.bottom * scale).toFixed(2) + 'px');
    root.style.setProperty('--pad-l', (p.left * scale).toFixed(2) + 'px');
    root.style.setProperty('--pad-r', (p.right * scale).toFixed(2) + 'px');
    root.style.setProperty('--page-px', (linesPerPage(p) * lineH).toFixed(3) + 'px');
  }

  function layout(instant = false) {
    railY = Math.round(window.innerHeight * S.rail / 100);
    root.style.setProperty('--rail-y', railY + 'px');
    geometry();
    chW = charWidthPx();
    const fontPx = parseFloat(root.style.getPropertyValue('--font-size'));
    if (fontPx > 0 && chW > 0) charRatio = chW / fontPx;

    const keep = paper.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    if (!S.typewriter) paper.scrollTop = keep;

    const c = caretPos();
    const padT = P().top * scale;
    const colRect = col.getBoundingClientRect();

    if (S.typewriter) {
      const maxReview = padT + c.top;
      const minReview = -(ta.scrollHeight - c.top - lineH);
      review = Math.max(minReview, Math.min(maxReview, review));
      const ty = Math.round(railY - GAP - (padT + c.top + lineH) + review);
      body.classList.toggle('animating', !instant);
      page.style.transform = `translate(-50%, ${ty}px)`;
      root.style.setProperty('--cx', Math.round(colRect.left + c.left + chW / 2) + 'px');
      root.style.setProperty('--stop-l', colRect.left.toFixed(1) + 'px');
      root.style.setProperty('--stop-r', colRect.right.toFixed(1) + 'px');
    } else {
      const y = colRect.top + c.top;
      if (y < 80) paper.scrollTop -= 80 - y;
      else if (y > window.innerHeight - 120) paper.scrollTop += y - (window.innerHeight - 120);
    }

    // páginas
    const lpp = linesPerPage(P());
    const curLine = Math.round(c.top / lineH);
    const totalLines = Math.max(1, Math.round(ta.scrollHeight / lineH));
    const pages = Math.ceil(totalLines / lpp);
    $('#pagecount').textContent = `Pág. ${Math.min(pages, Math.floor(curLine / lpp) + 1)} de ${pages}`;

    // timbre cerca del final de la línea (como una máquina real)
    const cols = Math.floor(ta.clientWidth / chW);
    const colN = Math.round(c.left / chW);
    if (c.top !== lastLineTop) bellRung = false;
    if (S.sound && !bellRung && colN >= cols - 8 && colN > lastCol && document.activeElement === ta) {
      TypeSound.bell(); bellRung = true;
    }
    lastLineTop = c.top; lastCol = colN;
  }

  const schedule = (instant) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layout(instant));
  };

  window.addEventListener('resize', () => layout(true));
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta) schedule(); });
  document.fonts.ready.then(() => { layout(true); updateReadout(); });

  // Rueda del ratón: releer el texto sin mover el cursor
  paper.addEventListener('wheel', (e) => {
    if (!S.typewriter) return;
    e.preventDefault();
    review -= e.deltaY;
    layout(true);
  }, { passive: false });

  paper.addEventListener('mousedown', (e) => {
    if (e.target === paper || e.target === page || e.target.id === 'sheet') { e.preventDefault(); ta.focus(); }
  });

  // ---------------- Topes de margen (arrastrables, como en la máquina) ----------------
  const tip = $('#stop-tip');
  function dragStop(side) {
    const el = $(`#stop-${side[0]}`);
    el.addEventListener('pointerdown', (e) => {
      if (!doc) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('drag');
      const sheetRect = $('#sheet').getBoundingClientRect();
      const move = (ev) => {
        const p = doc.page;
        const { w } = sheetDims(p);
        const step = charCm(p.fontSize); // se ajusta de carácter en carácter
        let cm = side === 'left' ? (ev.clientX - sheetRect.left) / scale : (sheetRect.right - ev.clientX) / scale;
        const other = side === 'left' ? p.right : p.left;
        cm = Math.max(0, Math.min(w - other - MIN_COL_CM, Math.round(cm / step) * step));
        doc.page = fixPage({ ...p, [side]: cm });
        layout(true);
        fillPageForm();
        const cols = Math.floor((w - doc.page.left - doc.page.right) / step + 0.001);
        tip.textContent = `${side === 'left' ? 'Izquierdo' : 'Derecho'} ${doc.page[side].toFixed(1).replace('.', ',')} cm · ${cols} car.`;
        tip.style.left = (side === 'left' ? $('#col').getBoundingClientRect().left : $('#col').getBoundingClientRect().right) + 'px';
        tip.classList.add('show');
      };
      const up = () => {
        el.classList.remove('drag');
        tip.classList.remove('show');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        dirty();
        ta.focus();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      move(e);
    });
  }
  dragStop('left'); dragStop('right');

  // ---------------- Escritura ----------------
  let strikeT;
  function strike() {
    body.classList.remove('typing'); void body.offsetWidth; body.classList.add('typing');
    leds[2].classList.add('on');
    clearTimeout(strikeT);
    strikeT = setTimeout(() => { leds[2].classList.remove('on'); body.classList.remove('typing'); }, 90);
  }

  ta.addEventListener('keydown', (e) => {
    if (S.strict && (e.key === 'Backspace' || e.key === 'Delete' || (e.ctrlKey && (e.key === 'x' || e.key === 'z')))) {
      e.preventDefault(); toast('Modo estricto: no se puede borrar'); return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '\t');
    }
    review = 0;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const printable = e.key.length === 1;
    if (printable || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab') strike();
    if (!S.sound || e.repeat) return;
    if (e.key === 'Enter') TypeSound.carriageReturn();
    else if (e.key === ' ') TypeSound.key('space');
    else if (e.key === 'Backspace' || e.key === 'Delete') TypeSound.key('back');
    else if (printable) TypeSound.key();
  });

  ta.addEventListener('beforeinput', (e) => {
    if (S.strict && e.inputType.startsWith('delete')) e.preventDefault();
  });

  ta.addEventListener('input', () => {
    review = 0;
    updateCount();
    dirty(true);
    layout();
  });

  ta.addEventListener('click', () => { review = 0; schedule(); });

  // ---------------- Documento actual ----------------
  let saveT, savedT;
  const FORMAT_LABEL = { docx: 'Word', doc: 'Word 97-2003', pdf: 'PDF', txt: 'Texto', md: 'Markdown' };

  const countWords = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  const titleOf = (t) => (t.split('\n').find((l) => l.trim()) || 'Sin título').trim().slice(0, 70);
  const fileBase = () => (doc.source?.name || titleOf(ta.value)).replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || 'Documento';

  function updateCount() {
    const n = countWords(ta.value);
    $('#wordcount').textContent = `${n.toLocaleString('es')} ${n === 1 ? 'palabra' : 'palabras'}`;
  }

  function updateFileName() {
    const el = $('#file-name');
    if (doc?.source?.path || doc?.source?.name) {
      const ext = doc.source.format;
      el.textContent = `${doc.source.name}.${ext}`;
      el.title = `${FORMAT_LABEL[ext] || ext}${doc.source.path ? ' · ' + doc.source.path : ''}${doc.fileDirty ? ' · cambios sin guardar en el archivo' : ''}`;
      el.classList.toggle('unsaved', !!doc.fileDirty);
    } else {
      el.textContent = '';
    }
  }

  // textChanged: el texto difiere del archivo de origen
  function dirty(textChanged = true) {
    leds[1].classList.remove('on');
    if (doc && textChanged && doc.source) { doc.fileDirty = true; updateFileName(); }
    clearTimeout(saveT);
    saveT = setTimeout(save, 700);
  }

  async function save() {
    if (!doc) return;
    clearTimeout(saveT);
    doc.text = ta.value;
    doc.notes = $('#notes').value;
    doc.title = doc.source?.name && !doc.text.trim() ? doc.source.name : titleOf(doc.text);
    doc.words = countWords(doc.text);
    doc.updated = Date.now();
    await api.saveDoc(doc);
    leds[1].classList.add('on');
    flash('Guardado');
  }

  function flash(msg) {
    const st = $('#save-state');
    st.textContent = msg;
    st.classList.add('show');
    clearTimeout(savedT);
    savedT = setTimeout(() => st.classList.remove('show'), 1600);
  }

  // Guarda en el archivo vinculado (o pregunta dónde). asFormat: fuerza "Guardar como" en ese formato.
  async function saveToFile({ asFormat = null, copy = false } = {}) {
    if (!doc) return;
    await save();
    const src = doc.source;
    const writable = src && src.path && ['docx', 'pdf', 'txt', 'md'].includes(src.format);
    const needDialog = !!asFormat || !writable;

    // Advertencia al sobrescribir un Word/PDF que vino de fuera: el editor guarda solo el texto
    if (!needDialog && src.imported && !src.overwriteOk && (src.format === 'docx' || src.format === 'pdf')) {
      const r = await api.confirm({
        message: `¿Sobrescribir «${src.name}.${src.format}»?`,
        detail: 'El editor trabaja con texto: se conservan el tamaño de hoja y los márgenes, pero se perderán imágenes, tablas, negritas y otros estilos del archivo original.',
        buttons: ['Sobrescribir', 'Guardar una copia…', 'Cancelar'],
      });
      if (r === 2) return;
      if (r === 1) return saveToFile({ asFormat: src.format });
      src.overwriteOk = true;
    }

    const res = await api.saveFile({
      path: src?.path, format: asFormat || src?.format || 'docx', name: fileBase(),
      text: ta.value, page: doc.page, font: S.font, dialog: needDialog,
    });
    if (!res) return;
    if (res.error) { toast(res.error); return; }
    if (!copy) {
      doc.source = { path: res.path, name: res.name, format: res.format, imported: false };
      doc.fileDirty = false;
      updateFileName();
      await save();
    }
    toast(`Guardado como ${FORMAT_LABEL[res.format]}: ${res.name}.${res.format}`);
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function openDoc(d) {
    if (doc) await save();
    d.page = fixPage(d.page || S.pageDefault);
    doc = d;
    ta.value = d.text || '';
    $('#notes').value = d.notes || '';
    updateCount();
    updateFileName();
    fillPageForm();
    leds[1].classList.add('on');
    body.classList.replace('view-library', 'view-editor');
    review = 0;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    layout(true);
  }

  async function newDoc({ text = '', page = null, source = null } = {}) {
    const now = Date.now();
    const d = {
      id: newId(), title: titleOf(text), text, notes: '', created: now, updated: now, words: countWords(text),
      page: fixPage({ ...S.pageDefault, ...(page || {}) }), source,
    };
    await openDoc(d);
    if (text || source) save();
  }

  // Abre un archivo leído por el proceso principal ({ path, name, format, text, page } o { error })
  async function importFile(r) {
    if (!r) return;
    if (r.error) { toast(r.error); return; }
    // si ya está en la biblioteca, se reutiliza
    if (r.path) {
      const existing = (await api.listDocs()).find((d) => d.source?.path === r.path);
      if (existing) {
        const full = await api.loadDoc(existing.id);
        if (full && !full.fileDirty) {
          full.text = r.text;
          return openDoc(full);
        }
      }
    }
    await newDoc({
      text: r.text,
      page: r.page,
      source: { path: r.path, name: r.name, format: r.format, imported: true },
    });
    if (r.format === 'doc') toast('Los .doc antiguos se abren como texto; al guardar se creará un .docx');
    else toast(`Abierto: ${r.name}.${r.format}`);
  }

  async function openFile() { importFile(await api.openFile()); }
  api.onOpenPath(async (p) => importFile(await api.readPath(p)));

  async function showLibrary() {
    if (doc) { await save(); doc = null; }
    closePanels();
    body.classList.replace('view-editor', 'view-library');
    const docs = await api.listDocs();
    const list = $('#doc-list');
    list.innerHTML = '';
    $('#lib-empty').hidden = docs.length > 0;
    const fmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    for (const d of docs) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="meta"><div class="t"></div><div class="p"></div></div>
        <span class="badge"></span>
        <span class="d"></span>
        <button class="icon del" title="Quitar de la biblioteca" aria-label="Quitar de la biblioteca">
          <svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
        </button>`;
      li.querySelector('.t').textContent = d.title || 'Sin título';
      const rest = (d.preview || '').split('\n').filter((l) => l.trim()).slice(1).join(' · ');
      li.querySelector('.p').textContent = rest || `${d.words || 0} palabras`;
      const badge = li.querySelector('.badge');
      if (d.source?.format) { badge.textContent = d.source.format.toUpperCase(); badge.title = d.source.path || ''; } else badge.remove();
      li.querySelector('.d').textContent = `${d.words || 0} pal. · ${fmt.format(d.updated)}`;
      li.onclick = async () => { const full = await api.loadDoc(d.id); if (full) openDoc(full); };
      li.querySelector('.del').onclick = async (e) => {
        e.stopPropagation();
        const extra = d.source?.path ? '\n\nEl archivo original en tu disco no se borra.' : '';
        if (confirm(`¿Quitar «${d.title}» de la biblioteca? Esta acción no se puede deshacer.${extra}`)) {
          await api.deleteDoc(d.id);
          showLibrary();
        }
      };
      list.appendChild(li);
    }
  }

  $('#notes').addEventListener('input', () => dirty(false));
  $('#back').onclick = showLibrary;
  $('#lib-new').onclick = () => newDoc();
  $('#lib-open').onclick = openFile;
  document.querySelectorAll('[data-export]').forEach((b) => (b.onclick = () => saveToFile({ asFormat: b.dataset.export })));

  // ---------------- Arrastrar y soltar archivos ----------------
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; body.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const p = api.pathForFile(f);
    if (p) importFile(await api.readPath(p));
    else if (/\.(txt|md)$/i.test(f.name)) importFile({ name: f.name.replace(/\.[^.]+$/, ''), format: 'txt', text: await f.text() });
    else toast('Ese formato solo se puede abrir en la app de escritorio');
  });

  // ---------------- Paneles ----------------
  function togglePanel(name, force) {
    const el = $(`#${name}-panel`);
    const open = force ?? !el.classList.contains('open');
    closePanels();
    el.classList.toggle('open', open);
    if (open && name === 'notes') $('#notes').focus();
    if (open && name === 'settings') fillPageForm();
    if (!open) ta.focus();
  }
  function closePanels() { document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open')); }

  $('#notes-btn').onclick = () => togglePanel('notes');
  $('#settings-btn').onclick = () => togglePanel('settings');
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.close, false)));

  // ---------------- Comandos (menú de la app y atajos) ----------------
  function command(cmd) {
    const inEditor = body.classList.contains('view-editor');
    switch (cmd) {
      case 'new': return newDoc();
      case 'open': return openFile();
      case 'library': return showLibrary();
      case 'save': return inEditor && saveToFile();
      case 'save-as': return inEditor && saveToFile({ asFormat: doc.source?.format === 'doc' ? 'docx' : doc.source?.format || 'docx' });
      case 'save-docx': return inEditor && saveToFile({ asFormat: 'docx', copy: true });
      case 'save-pdf': return inEditor && saveToFile({ asFormat: 'pdf', copy: true });
      case 'save-txt': return inEditor && saveToFile({ asFormat: 'txt', copy: true });
      case 'save-md': return inEditor && saveToFile({ asFormat: 'md', copy: true });
      case 'toggle-typewriter': return set('typewriter', !S.typewriter);
      case 'toggle-theme': return set('theme', S.theme === 'light' ? 'dark' : 'light');
      case 'toggle-notes': return inEditor && togglePanel('notes');
      case 'toggle-settings': return inEditor && togglePanel('settings');
    }
  }
  api.onMenu(command);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanels(); if (doc) ta.focus(); return; }
    if (isDesktop) return; // en Electron los atajos los gestiona el menú
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const map = { n: 'new', o: 'open', l: 'library', s: 'save', ',': 'toggle-settings' };
    if (mod && e.shiftKey && k === 't') { e.preventDefault(); command('toggle-typewriter'); }
    else if (mod && e.shiftKey && k === 'n') { e.preventDefault(); command('toggle-notes'); }
    else if (mod && e.shiftKey && k === 's') { e.preventDefault(); command('save-as'); }
    else if (mod && !e.shiftKey && map[k]) { e.preventDefault(); command(map[k]); }
  });

  window.addEventListener('beforeunload', () => { if (doc) save(); });

  // ---------------- Aviso ----------------
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------------- Inicio ----------------
  leds[0].classList.add('on');
  applySettings();
  showLibrary();
})();
