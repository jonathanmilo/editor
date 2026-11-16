// Lógica de la interfaz: biblioteca, editor en modo máquina de escribir, ajustes y notas.
(() => {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const root = document.documentElement;
  const ta = $('#text');
  const page = $('#page');
  const paper = $('#paper');
  const leds = [...document.querySelectorAll('#carriage .body i')];

  // ---------------- Almacenamiento (Electron o, si no, localStorage) ----------------
  const api = window.api || (() => {
    const KEY = 'mde:docs';
    const all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
    const put = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* sin almacenamiento */ } };
    return {
      platform: 'web',
      async listDocs() {
        return Object.values(all())
          .map((d) => ({ id: d.id, title: d.title, updated: d.updated, words: d.words, preview: (d.text || '').slice(0, 200) }))
          .sort((a, b) => b.updated - a.updated);
      },
      async loadDoc(id) { return all()[id] || null; },
      async saveDoc(doc) { const o = all(); o[doc.id] = doc; put(o); return true; },
      async deleteDoc(id) { const o = all(); delete o[id]; put(o); return true; },
      async openFile() {
        return new Promise((res) => {
          const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.txt,.md,.markdown,text/plain' });
          inp.onchange = async () => {
            const f = inp.files[0];
            res(f ? { name: f.name.replace(/\.[^.]+$/, ''), text: await f.text() } : null);
          };
          inp.click();
        });
      },
      async exportFile({ format, name, text }) {
        if (format === 'docx') { toast('La exportación a Word está disponible en la app de escritorio'); return null; }
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })),
          download: `${name}.${format}`,
        });
        a.click();
        return a.download;
      },
      reveal() {}, setTheme() {}, onMenu() {},
    };
  })();

  if (api.platform === 'darwin') body.classList.add('mac');
  if (api.platform === 'web') root.style.setProperty('--titlebar-pad', '12px');

  // ---------------- Ajustes ----------------
  const DEFAULTS = {
    theme: 'light', typewriter: true, font: "'Courier Prime', 'Courier New', monospace",
    size: 20, width: 64, rail: 77, light: 100, sound: true, fade: true, strict: false,
  };
  let S = { ...DEFAULTS };
  try { Object.assign(S, JSON.parse(localStorage.getItem('mde:settings')) || {}); } catch { /* valores por defecto */ }
  const saveSettings = () => { try { localStorage.setItem('mde:settings', JSON.stringify(S)); } catch { /* ignorar */ } };

  function applySettings() {
    body.classList.toggle('theme-light', S.theme === 'light');
    body.classList.toggle('theme-dark', S.theme === 'dark');
    body.classList.toggle('typewriter', S.typewriter);
    body.classList.toggle('fade-far', S.fade);
    root.style.setProperty('--font-text', S.font);
    root.style.setProperty('--font-size', S.size + 'px');
    root.style.setProperty('--page-w', S.width + 'ch');
    root.style.setProperty('--light', S.light / 100);
    $('#tw-switch').checked = S.typewriter;
    $('#tw-state').textContent = S.typewriter ? 'Activada' : 'Desactivada';
    $('#s-font').value = S.font;
    $('#s-size').value = S.size; $('#o-size').textContent = S.size + ' px';
    $('#s-width').value = S.width; $('#o-width').textContent = S.width + ' car.';
    $('#s-rail').value = S.rail; $('#o-rail').textContent = S.rail + ' %';
    $('#s-light').value = S.light; $('#o-light').textContent = S.light + ' %';
    $('#s-sound').checked = S.sound;
    $('#s-fade').checked = S.fade;
    $('#s-strict').checked = S.strict;
    api.setTheme(S.theme);
    layout(true);
  }

  function set(key, val) { S[key] = val; saveSettings(); applySettings(); }

  $('#s-font').onchange = (e) => { set('font', e.target.value); document.fonts.ready.then(() => layout(true)); };
  $('#s-size').oninput = (e) => set('size', +e.target.value);
  $('#s-width').oninput = (e) => set('width', +e.target.value);
  $('#s-rail').oninput = (e) => set('rail', +e.target.value);
  $('#s-light').oninput = (e) => set('light', +e.target.value);
  $('#s-sound').onchange = (e) => set('sound', e.target.checked);
  $('#s-fade').onchange = (e) => set('fade', e.target.checked);
  $('#s-strict').onchange = (e) => set('strict', e.target.checked);
  $('#tw-switch').onchange = (e) => { set('typewriter', e.target.checked); ta.focus(); };
  $('#theme-btn').onclick = () => set('theme', S.theme === 'light' ? 'dark' : 'light');

  // ---------------- Medición del cursor ----------------
  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', visibility: 'hidden', pointerEvents: 'none',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', letterSpacing: '.01em', tabSize: '4',
  });
  page.appendChild(mirror);
  const marker = document.createElement('span');

  function caretPos() {
    const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const v = ta.value;
    mirror.textContent = v.slice(0, pos);
    marker.textContent = v.slice(pos) || '.';
    mirror.appendChild(marker);
    return { top: marker.offsetTop, left: marker.offsetLeft, pos };
  }

  function charWidth() {
    mirror.textContent = '';
    const s = document.createElement('span');
    s.textContent = '0000000000';
    mirror.appendChild(s);
    return s.getBoundingClientRect().width / 10;
  }

  // ---------------- Disposición (riel, carro, desplazamiento) ----------------
  let railY = 0, review = 0, chW = 12, lastLineTop = null, lastCol = 0, bellRung = false, raf = 0;
  const lineH = () => S.size * 1.45;
  const GAP = 26; // distancia entre la línea activa y el riel

  function layout(instant = false) {
    railY = Math.round(window.innerHeight * S.rail / 100);
    root.style.setProperty('--rail-y', railY + 'px');
    chW = charWidth();

    const keep = paper.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    if (!S.typewriter) paper.scrollTop = keep;

    const c = caretPos();
    const lh = lineH();

    if (S.typewriter) {
      const maxReview = c.top;
      const minReview = -(ta.scrollHeight - c.top - lh);
      review = Math.max(minReview, Math.min(maxReview, review));
      const ty = Math.round(railY - GAP - (c.top + lh) + review);
      body.classList.toggle('animating', !instant);
      page.style.transform = `translate(-50%, ${ty}px)`;
      const left = page.getBoundingClientRect().left;
      root.style.setProperty('--cx', Math.round(left + c.left + chW / 2) + 'px');
    } else {
      // modo normal: mantener el cursor visible
      const r = page.getBoundingClientRect();
      const y = r.top + parseFloat(getComputedStyle(page).paddingTop) + c.top;
      if (y < 80) paper.scrollTop -= 80 - y;
      else if (y > window.innerHeight - 120) paper.scrollTop += y - (window.innerHeight - 120);
    }

    // timbre cerca del final de la línea (como una máquina real)
    const cols = Math.floor(ta.clientWidth / chW);
    const col = Math.round(c.left / chW);
    if (c.top !== lastLineTop) bellRung = false;
    if (S.sound && !bellRung && col >= cols - 8 && col > lastCol && document.activeElement === ta) {
      TypeSound.bell(); bellRung = true;
    }
    lastLineTop = c.top; lastCol = col;
  }

  const schedule = (instant) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layout(instant));
  };

  window.addEventListener('resize', () => layout(true));
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta) schedule(); });
  document.fonts.ready.then(() => layout(true));

  // Rueda del ratón: releer el texto sin mover el cursor
  paper.addEventListener('wheel', (e) => {
    if (!S.typewriter) return;
    e.preventDefault();
    review -= e.deltaY;
    layout(true);
  }, { passive: false });

  paper.addEventListener('mousedown', (e) => {
    if (e.target === paper) { e.preventDefault(); ta.focus(); }
  });

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
    dirty();
    layout();
  });

  ta.addEventListener('click', () => { review = 0; schedule(); });

  // ---------------- Documento actual ----------------
  let doc = null, saveT, savedT;

  const countWords = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  const titleOf = (t) => (t.split('\n').find((l) => l.trim()) || 'Sin título').trim().slice(0, 70);

  function updateCount() {
    const n = countWords(ta.value);
    $('#wordcount').textContent = `${n.toLocaleString('es')} ${n === 1 ? 'palabra' : 'palabras'}`;
  }

  function dirty() {
    leds[1].classList.remove('on');
    clearTimeout(saveT);
    saveT = setTimeout(save, 700);
  }

  async function save(showToast = false) {
    if (!doc) return;
    clearTimeout(saveT);
    doc.text = ta.value;
    doc.notes = $('#notes').value;
    doc.title = titleOf(doc.text);
    doc.words = countWords(doc.text);
    doc.updated = Date.now();
    await api.saveDoc(doc);
    leds[1].classList.add('on');
    const st = $('#save-state');
    st.textContent = 'Guardado';
    st.classList.add('show');
    clearTimeout(savedT);
    savedT = setTimeout(() => st.classList.remove('show'), 1400);
    if (showToast) toast('Documento guardado');
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function openDoc(d) {
    if (doc) await save();
    doc = d;
    ta.value = d.text || '';
    $('#notes').value = d.notes || '';
    updateCount();
    leds[1].classList.add('on');
    body.classList.replace('view-library', 'view-editor');
    review = 0;
    ta.focus();
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    layout(true);
  }

  async function newDoc(text = '', title) {
    const now = Date.now();
    const d = { id: newId(), title: title || titleOf(text), text, notes: '', created: now, updated: now, words: countWords(text) };
    await openDoc(d);
    if (text) save();
  }

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
        <span class="d"></span>
        <button class="icon del" title="Eliminar" aria-label="Eliminar">
          <svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
        </button>`;
      li.querySelector('.t').textContent = d.title || 'Sin título';
      const rest = (d.preview || '').split('\n').filter((l) => l.trim()).slice(1).join(' · ');
      li.querySelector('.p').textContent = rest || `${d.words || 0} palabras`;
      li.querySelector('.d').textContent = `${d.words || 0} pal. · ${fmt.format(d.updated)}`;
      li.onclick = async () => { const full = await api.loadDoc(d.id); if (full) openDoc(full); };
      li.querySelector('.del').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`¿Eliminar «${d.title}»? Esta acción no se puede deshacer.`)) {
          await api.deleteDoc(d.id);
          showLibrary();
        }
      };
      list.appendChild(li);
    }
  }

  async function openFile() {
    const f = await api.openFile();
    if (f) newDoc(f.text, f.name);
  }

  async function exportAs(format) {
    if (!doc) return;
    await save();
    const name = titleOf(ta.value).replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'Documento';
    const p = await api.exportFile({ format, name, text: ta.value, settings: { docxFont: S.font.split(',')[0].replace(/'/g, '') } });
    if (p) toast(`Exportado: ${p.split(/[\\/]/).pop()}`);
  }

  $('#notes').addEventListener('input', dirty);
  $('#back').onclick = showLibrary;
  $('#lib-new').onclick = () => newDoc();
  $('#lib-open').onclick = openFile;
  document.querySelectorAll('[data-export]').forEach((b) => (b.onclick = () => exportAs(b.dataset.export)));

  // ---------------- Paneles ----------------
  function togglePanel(name, force) {
    const el = $(`#${name}-panel`);
    const open = force ?? !el.classList.contains('open');
    closePanels();
    el.classList.toggle('open', open);
    if (open && name === 'notes') $('#notes').focus();
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
      case 'save': return inEditor && save(true);
      case 'export-docx': return exportAs('docx');
      case 'export-txt': return exportAs('txt');
      case 'export-md': return exportAs('md');
      case 'toggle-typewriter': return set('typewriter', !S.typewriter);
      case 'toggle-theme': return set('theme', S.theme === 'light' ? 'dark' : 'light');
      case 'toggle-notes': return inEditor && togglePanel('notes');
      case 'toggle-settings': return inEditor && togglePanel('settings');
    }
  }
  api.onMenu(command);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanels(); if (doc) ta.focus(); return; }
    if (window.api) return; // en Electron los atajos los gestiona el menú
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const map = { n: 'new', o: 'open', l: 'library', s: 'save', e: 'export-docx', ',': 'toggle-settings' };
    if (mod && e.shiftKey && k === 't') { e.preventDefault(); command('toggle-typewriter'); }
    else if (mod && e.shiftKey && k === 'n') { e.preventDefault(); command('toggle-notes'); }
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
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------------- Inicio ----------------
  leds[0].classList.add('on');
  applySettings();
  showLibrary();
})();
