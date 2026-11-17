// Lógica de la interfaz: biblioteca, editor en modo máquina de escribir, hoja, archivos, ajustes y notas.
(() => {
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  const root = document.documentElement;
  const host = $('#text');
  const page = $('#page');
  const col = $('#col');
  const paper = $('#paper');
  const leds = [...document.querySelectorAll('#carriage .body i')];
  const isDesktop = !!window.api;
  const { textToHtml, PARSE } = window.RichEditor;

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
            res(f ? { name: f.name.replace(/\.[^.]+$/, ''), format: 'txt', html: textToHtml(await f.text()) } : null);
          };
          inp.click();
        });
      },
      async saveFile({ format, name, content }) {
        if (format !== 'txt' && format !== 'md') return { error: 'Word y PDF solo están disponibles en la app de escritorio' };
        const a = Object.assign(document.createElement('a'), {
          href: URL.createObjectURL(new Blob([content.text], { type: 'text/plain' })),
          download: `${name}.${format}`,
        });
        a.click();
        return { name, format, lost: [] };
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
    theme: 'clasico', lastLight: 'clasico', lastDark: 'noche', typewriter: true, font: 'Courier Prime',
    showNotes: true, zoom: 130, rail: 77, light: 100, sound: true, fade: true, strict: false, showSheet: false,
    pageDefault: PAGE_DEFAULT,
  };
  let S = { ...DEFAULTS };
  try { Object.assign(S, JSON.parse(localStorage.getItem('mde:settings')) || {}); } catch { /* valores por defecto */ }
  S.theme = { light: 'clasico', dark: 'noche' }[S.theme] || S.theme; // nombres de la versión anterior
  if (S.font.includes(',')) S.font = S.font.split(',')[0].replace(/'/g, '').trim(); // ajustes de la primera versión
  S.pageDefault = fixPage(S.pageDefault);
  const saveSettings = () => { try { localStorage.setItem('mde:settings', JSON.stringify(S)); } catch { /* ignorar */ } };

  // Temas de papel: [id, nombre, oscuro, fondo, tinta, riel]
  const THEMES = [
    ['clasico', 'Clásico', false, '#8c827d', '#161311', '#1d1b1a'],
    ['marfil', 'Marfil', false, '#e7e0d1', '#1d1a16', '#2a2622'],
    ['sepia', 'Sepia', false, '#b59a74', '#2e1d0e', '#2b1a0c'],
    ['plano', 'Plano', true, '#1d4f91', '#eef5ff', '#0e2a50'],
    ['pizarra', 'Pizarra', true, '#2f4237', '#eef2e6', '#7a5a3b'],
    ['fosforo', 'Fósforo', true, '#0b100c', '#5dff8f', '#1f4a2b'],
    ['noche', 'Noche', true, '#1c1917', '#efe6d8', '#3a3532'],
    ['collage', 'Collage', false, '#b48a58', '#1b140c', '#241a10'],
    ['collage-bn', 'Collage B/N', false, '#b4afa6', '#111111', '#121212'],
    ['fotocopia', 'Fotocopia', false, '#e9e8e2', '#0d0d0d', '#151515'],
  ];
  // temas que visten cada palabra (recortes o tóner irregular)
  const WORD_MODE = { collage: 'collage', 'collage-bn': 'collage', fotocopia: 'fotocopia' };
  const wordMode = () => WORD_MODE[S.theme] || null;
  let lastWordMode = null;
  const themeOf = (id) => THEMES.find((t) => t[0] === id) || THEMES[0];
  if (!THEMES.some((t) => t[0] === S.theme)) S.theme = 'clasico';

  const themesEl = $('#themes');
  for (const [id, name, , bg, ink, rail] of THEMES) {
    const b = document.createElement('button');
    b.className = 'theme-sw';
    b.dataset.theme = id;
    b.title = name;
    b.innerHTML = `<span class="pv" style="background:${bg};color:${ink};--sw-rail:${rail}">Aa</span><span class="nm">${name}</span>`;
    if (id === 'plano') b.querySelector('.pv').style.backgroundImage =
      'linear-gradient(rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.18) 1px, transparent 1px)';
    if (id === 'plano') b.querySelector('.pv').style.backgroundSize = '8px 8px';
    if (id === 'fosforo') b.querySelector('.pv').style.textShadow = '0 0 5px rgba(93,255,143,.7)';
    if (id === 'collage' || id === 'collage-bn') {
      const color = id === 'collage';
      b.querySelector('.pv').innerHTML =
        `<i style="font:400 14px 'Archivo Black';background:${color ? '#4767b6' : '#111'};color:#fff;padding:0 3px;transform:rotate(-4deg)">A</i>` +
        `<i style="font:400 16px 'Abril Fatface';background:#fff;color:#111;padding:0 3px;transform:rotate(3deg)">a</i>`;
      b.querySelector('.pv').style.cssText += `;display:flex;gap:2px;align-items:center;justify-content:center;background-image:var(${color ? '--tx-trama-cafe' : '--tx-trama-gris'});background-size:300px`;
      b.querySelectorAll('.pv i').forEach((i) => { i.style.display = 'inline-block'; i.style.fontStyle = 'normal'; i.style.boxShadow = '0 1px 1px rgba(0,0,0,.35)'; });
    }
    if (id === 'fotocopia') {
      const pv = b.querySelector('.pv');
      pv.style.fontFamily = "'Nunito', sans-serif"; pv.style.fontWeight = '900';
      pv.style.backgroundImage = 'var(--tx-toner), var(--tx-grano)';
      pv.style.textShadow = '0 0 .8px #000';
    }
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.onclick = () => setTheme(id);
    themesEl.appendChild(b);
  }
  function setTheme(id) {
    S[themeOf(id)[2] ? 'lastDark' : 'lastLight'] = id;
    set('theme', id);
  }
  const toggleLightDark = () => setTheme(themeOf(S.theme)[2] ? S.lastLight : S.lastDark);

  let doc = null;
  let ed = null; // editor enriquecido del documento abierto
  const P = () => (doc ? doc.page : S.pageDefault);

  function applySettings() {
    const th = themeOf(S.theme);
    body.dataset.theme = th[0];
    body.classList.toggle('is-dark', th[2]);
    document.querySelectorAll('.theme-sw').forEach((b) => b.classList.toggle('on', b.dataset.theme === th[0]));
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
    api.setTheme({ color: th[3], symbolColor: th[4] });
    body.classList.toggle('hide-notes', !S.showNotes);
    $('#s-notes').checked = S.showNotes;
    if (wordMode() !== lastWordMode) { lastWordMode = wordMode(); ed?.refreshWordStyle(); document.fonts.ready.then(() => layout(true)); }
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
  $('#s-notes').onchange = (e) => set('showNotes', e.target.checked);
  $('#tw-switch').onchange = (e) => { set('typewriter', e.target.checked); ed?.commands.focus(); };
  $('#theme-btn').onclick = toggleLightDark;

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
  // La hoja se dibuja en píxeles de documento (96 por pulgada) y se escala con CSS zoom.
  const CM_PER_IN = 2.54;
  const PX_PER_CM = 96 / CM_PER_IN;
  let charRatio = 0.6; // ancho de un carácter / tamaño de letra (se mide con la fuente real)
  const charCm = (pt) => (pt / 72) * CM_PER_IN * charRatio;
  const lineCm = (p) => (p.fontSize * 1.2 * p.spacing / 72) * CM_PER_IN;
  const linesPerPage = (p) => Math.max(1, Math.floor((sheetDims(p).h - p.top - p.bottom) / lineCm(p) + 0.001));
  const colPx = () => { const p = P(); return (sheetDims(p).w - p.left - p.right) * PX_PER_CM; };

  const measure = document.createElement('span');
  Object.assign(measure.style, {
    position: 'absolute', top: '0', left: '0', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre',
    fontFamily: 'var(--font-text)', fontSize: 'var(--font-size)',
  });
  measure.textContent = '0'.repeat(20);
  col.appendChild(measure);

  // ---------------- Disposición (hoja, riel, carro, topes) ----------------
  let railY = 0, review = 0, chW = 12, zoom = 1, lastLine = null, lastCol = 0, bellRung = false, raf = 0;
  const GAP = 26; // distancia entre la línea activa y el riel

  function geometry() {
    const p = P();
    const { w, h } = sheetDims(p);
    const want = S.zoom / 100;
    zoom = want * Math.min(1, (window.innerWidth - 64) / (w * PX_PER_CM * want));
    const fontPx = (p.fontSize / 72) * 96;
    const ratio = 1.2 * p.spacing;
    root.style.setProperty('--zoom', zoom.toFixed(4));
    root.style.setProperty('--font-size', fontPx.toFixed(3) + 'px');
    root.style.setProperty('--line-ratio', ratio.toFixed(4));
    root.style.setProperty('--sheet-w', (w * PX_PER_CM).toFixed(2) + 'px');
    root.style.setProperty('--sheet-h', (h * PX_PER_CM).toFixed(2) + 'px');
    root.style.setProperty('--pad-t', (p.top * PX_PER_CM).toFixed(2) + 'px');
    root.style.setProperty('--pad-b', (p.bottom * PX_PER_CM).toFixed(2) + 'px');
    root.style.setProperty('--pad-l', (p.left * PX_PER_CM).toFixed(2) + 'px');
    root.style.setProperty('--pad-r', (p.right * PX_PER_CM).toFixed(2) + 'px');
    root.style.setProperty('--page-px', (linesPerPage(p) * fontPx * ratio).toFixed(3) + 'px');
    return { fontPx, linePx: fontPx * ratio };
  }

  // Posición del cursor en pantalla
  function caretRect() {
    if (!ed) return null;
    try {
      const sel = ed.state.selection;
      if (sel.node) { // imagen u otro bloque seleccionado: se usa su caja completa
        const r = ed.view.nodeDOM(sel.from)?.getBoundingClientRect();
        if (r) return { left: r.right, top: r.top, bottom: r.bottom };
      }
      // Se mide con la selección del navegador: coordsAtPos de ProseMirror no tiene en cuenta el zoom de CSS
      let { node, offset } = ed.view.domAtPos(sel.head);
      // apuntar a un nodo de texto vecino si la posición cae entre elementos
      if (node.nodeType === 1) {
        const before = node.childNodes[offset - 1], after = node.childNodes[offset];
        if (before && before.nodeType === 3) { node = before; offset = before.length; }
        else if (after && after.nodeType === 3) { node = after; offset = 0; }
      }
      let r = null;
      if (node.nodeType === 3 && node.length) {
        // caja del carácter anterior (borde derecho) o del siguiente (borde izquierdo)
        const range = document.createRange();
        if (offset > 0) {
          range.setStart(node, offset - 1); range.setEnd(node, offset);
          const q = [...range.getClientRects()].pop();
          if (q) r = { left: q.right, top: q.top, bottom: q.bottom };
        } else {
          range.setStart(node, 0); range.setEnd(node, 1);
          const q = range.getClientRects()[0];
          if (q) r = { left: q.left, top: q.top, bottom: q.bottom };
        }
      }
      if (!r) {
        // posición sin caja propia (párrafo vacío, inicio de línea): se usa el elemento
        const el = node.nodeType === 3 ? node.parentElement : (node.childNodes[offset] || node);
        const box = (el.nodeType === 1 ? el : node.parentElement).getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el.nodeType === 1 ? el : node.parentElement).lineHeight) * zoom || box.height;
        return { left: box.left, top: box.top, bottom: box.top + Math.min(box.height, lh) };
      }
      return r;
    } catch { return null; }
  }

  function layout(instant = false) {
    railY = Math.round(window.innerHeight * S.rail / 100);
    root.style.setProperty('--rail-y', railY + 'px');
    const g = geometry();
    chW = measure.getBoundingClientRect().width / 20;
    if (chW > 0) charRatio = chW / (g.fontPx * zoom);
    if (!ed) return;

    const c = caretRect();
    const pageRect = page.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    const lineV = g.linePx * zoom;
    if (!c) return;
    const lineBottom = c.bottom + Math.max(0, (lineV - (c.bottom - c.top)) / 2);

    if (S.typewriter) {
      if (paper.scrollTop) paper.scrollTop = 0;
      const rel = lineBottom - pageRect.top; // posición del cursor dentro de la página (no depende del desplazamiento)
      review = Math.max(-(pageRect.height - rel), Math.min(rel, review));
      const ty = Math.round(railY - GAP - rel + review);
      body.classList.toggle('animating', !instant);
      page.style.transform = `translate(-50%, ${ty}px)`;
      root.style.setProperty('--cx', Math.round(c.left + chW / 2) + 'px');
      root.style.setProperty('--stop-l', colRect.left.toFixed(1) + 'px');
      root.style.setProperty('--stop-r', colRect.right.toFixed(1) + 'px');
    } else {
      if (c.top < 90) paper.scrollTop -= 90 - c.top;
      else if (c.bottom > window.innerHeight - 120) paper.scrollTop += c.bottom - (window.innerHeight - 120);
    }

    // páginas
    const pageV = linesPerPage(P()) * lineV;
    const total = Math.max(1, Math.ceil((host.getBoundingClientRect().height - 1) / pageV));
    const cur = Math.min(total, Math.floor((c.top - colRect.top) / pageV) + 1);
    $('#pagecount').textContent = `Pág. ${Math.max(1, cur)} de ${total}`;

    // timbre cerca del final de la línea (como una máquina real)
    const cols = Math.floor(colRect.width / chW);
    const colN = Math.round((c.left - colRect.left) / chW);
    const line = Math.round(c.top);
    if (line !== lastLine) bellRung = false;
    if (S.sound && !bellRung && colN >= cols - 8 && colN > lastCol && ed.isFocused) { TypeSound.bell(); bellRung = true; }
    lastLine = line; lastCol = colN;
  }

  const schedule = (instant) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layout(instant));
  };

  window.addEventListener('resize', () => layout(true));
  // en modo máquina el papel nunca se desplaza: lo mueve el riel
  paper.addEventListener('scroll', () => { if (S.typewriter && paper.scrollTop) { paper.scrollTop = 0; schedule(true); } });
  // si cambia la altura del texto (imágenes que terminan de cargar, tablas...) se recoloca el riel
  new ResizeObserver(() => schedule(true)).observe(host);
  document.fonts.ready.then(() => { layout(true); updateReadout(); });

  // Rueda del ratón: releer el texto sin mover el cursor
  paper.addEventListener('wheel', (e) => {
    if (!S.typewriter) return;
    e.preventDefault();
    review -= e.deltaY;
    layout(true);
  }, { passive: false });

  paper.addEventListener('mousedown', (e) => {
    if (ed && (e.target === paper || e.target === page || e.target.id === 'sheet' || e.target === col)) { e.preventDefault(); ed.commands.focus(); }
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
      const scale = PX_PER_CM * zoom; // px de pantalla por cm
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
        const r = col.getBoundingClientRect();
        tip.style.left = (side === 'left' ? r.left : r.right) + 'px';
        tip.classList.add('show');
      };
      const up = () => {
        el.classList.remove('drag');
        tip.classList.remove('show');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        dirty(false);
        ed?.commands.focus();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      move(e);
    });
  }
  dragStop('left'); dragStop('right');

  // ---------------- Escritura: sonido, golpe del tipo y modo estricto ----------------
  let strikeT;
  function strike() {
    body.classList.remove('typing'); void body.offsetWidth; body.classList.add('typing');
    leds[2].classList.add('on');
    clearTimeout(strikeT);
    strikeT = setTimeout(() => { leds[2].classList.remove('on'); body.classList.remove('typing'); }, 90);
  }

  // en fase de captura: se ejecuta antes que el editor
  col.addEventListener('keydown', (e) => {
    if (!ed) return;
    const del = e.key === 'Backspace' || e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && ['x', 'z'].includes(e.key.toLowerCase()));
    if (S.strict && del) { e.preventDefault(); e.stopPropagation(); toast('Modo estricto: no se puede borrar'); return; }
    review = 0;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const printable = e.key.length === 1;
    if (printable || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key)) strike();
    if (!S.sound || e.repeat) return;
    if (e.key === 'Enter') TypeSound.carriageReturn();
    else if (e.key === ' ') TypeSound.key('space');
    else if (e.key === 'Backspace' || e.key === 'Delete') TypeSound.key('back');
    else if (printable) TypeSound.key();
  }, true);
  col.addEventListener('beforeinput', (e) => {
    if (S.strict && /^delete/.test(e.inputType)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  col.addEventListener('cut', (e) => { if (S.strict) { e.preventDefault(); e.stopPropagation(); } }, true);

  // ---------------- Barra de formato ----------------
  const toolbarActions = {
    bold: (c) => c.toggleBold(),
    italic: (c) => c.toggleItalic(),
    underline: (c) => c.toggleUnderline(),
    h1: (c) => c.toggleHeading({ level: 1 }),
    h2: (c) => c.toggleHeading({ level: 2 }),
    bulletList: (c) => c.toggleBulletList(),
    orderedList: (c) => c.toggleOrderedList(),
    table: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    addRowAfter: (c) => c.addRowAfter(),
    addColumnAfter: (c) => c.addColumnAfter(),
    deleteRow: (c) => c.deleteRow(),
    deleteColumn: (c) => c.deleteColumn(),
    toggleHeaderRow: (c) => c.toggleHeaderRow(),
    mergeOrSplit: (c) => c.mergeOrSplit(),
    deleteTable: (c) => c.deleteTable(),
  };
  document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // no quitar el foco del texto
    b.addEventListener('click', () => {
      if (!ed) return;
      const cmd = b.dataset.cmd;
      if (cmd === 'image') { $('#image-input').click(); return; }
      toolbarActions[cmd](ed.chain().focus()).run();
    });
  });
  $('#image-input').addEventListener('change', (e) => {
    if (ed && e.target.files.length) ed.insertImages([...e.target.files]);
    e.target.value = '';
  });

  function updateToolbar() {
    if (!ed) return;
    const active = {
      bold: ed.isActive('bold'), italic: ed.isActive('italic'), underline: ed.isActive('underline'),
      h1: ed.isActive('heading', { level: 1 }), h2: ed.isActive('heading', { level: 2 }),
      bulletList: ed.isActive('bulletList'), orderedList: ed.isActive('orderedList'),
    };
    document.querySelectorAll('#toolbar [data-cmd]').forEach((b) => b.classList.toggle('on', !!active[b.dataset.cmd]));
    body.classList.toggle('in-table', ed.isActive('table'));
  }

  // ---------------- Documento actual ----------------
  let saveT, savedT;
  const FORMAT_LABEL = { docx: 'Word', doc: 'Word 97-2003', pdf: 'PDF', txt: 'Texto', md: 'Markdown' };

  const countWords = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  const titleOf = (t) => (t.split('\n').find((l) => l.trim()) || 'Sin título').trim().slice(0, 70);
  const plainText = () => (ed ? ed.getText({ blockSeparator: '\n' }) : '');
  const cleanName = (n) => String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '').slice(0, 120);
  // Nombre del documento: el del archivo vinculado, el que escribió el usuario o la primera línea
  const docName = () => doc.source?.name || doc.name || '';
  const fileBase = () => cleanName(docName() || titleOf(plainText())) || 'Documento';

  function updateCount() {
    const n = countWords(plainText());
    $('#wordcount').textContent = `${n.toLocaleString('es')} ${n === 1 ? 'palabra' : 'palabras'}`;
  }

  // ----- Nombre de archivo editable -----
  const nameInput = $('#file-name');
  function updateFileName() {
    if (!doc) return;
    const chip = $('#file-chip');
    if (document.activeElement !== nameInput) nameInput.value = docName();
    nameInput.placeholder = titleOf(plainText());
    nameInput.style.width = Math.max(4, Math.min(40, (nameInput.value || nameInput.placeholder).length + 1)) + 'ch';
    const ext = doc.source?.format;
    $('#file-ext').textContent = ext ? '.' + ext : '';
    chip.classList.toggle('unsaved', !!doc.fileDirty);
    chip.title = doc.source?.path
      ? `${FORMAT_LABEL[ext] || ext} · ${doc.source.path}${doc.fileDirty ? '\nHay cambios sin guardar en el archivo' : ''}\nHaz clic para cambiar el nombre`
      : 'Nombre del documento: se usará al guardarlo. Haz clic para cambiarlo';
    updateAutosave();
  }

  async function commitName() {
    if (!doc) return;
    const wanted = cleanName(nameInput.value);
    if (wanted === docName()) { updateFileName(); return; }
    if (!wanted) { // vacío: vuelve al nombre automático (solo si no hay archivo)
      if (!doc.source?.path) doc.name = '';
      updateFileName(); dirty(false); return;
    }
    if (doc.source?.path && api.renameFile) {
      const r = await api.renameFile({ path: doc.source.path, name: wanted });
      if (r.error) { toast(r.error, 3500); updateFileName(); return; }
      doc.source.path = r.path;
      doc.source.name = r.name;
      if (!r.missing) toast(`Archivo renombrado: ${r.name}.${doc.source.format}`);
    } else if (doc.source) {
      doc.source.name = wanted;
    } else {
      doc.name = wanted;
    }
    updateFileName();
    save();
  }
  nameInput.addEventListener('input', () => { nameInput.style.width = Math.max(4, Math.min(40, nameInput.value.length + 1)) + 'ch'; });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); nameInput.value = docName(); nameInput.blur(); }
    e.stopPropagation();
  });
  nameInput.addEventListener('blur', () => { commitName(); ed?.commands.focus(); });

  // ----- Autoguardado en el archivo -----
  const autoBox = $('#autosave');
  let autoT = null, autoBusy = false, autoAgain = false;
  function updateAutosave() {
    const on = !!doc?.autosave;
    autoBox.checked = on;
    $('#autosave-label').title = on && doc.source?.path
      ? `Autoguardado activado: los cambios se guardan solos en ${doc.source.name}.${doc.source.format}`
      : 'Guarda automáticamente en el archivo mientras escribes (la biblioteca se guarda siempre)';
  }
  async function runAutosave() {
    if (!doc?.autosave || !doc.fileDirty) return;
    if (autoBusy) { autoAgain = true; return; }
    autoBusy = true;
    $('#autosave-label').classList.add('saving');
    try { await saveToFile({ quiet: true }); } finally {
      autoBusy = false;
      $('#autosave-label').classList.remove('saving');
      if (autoAgain) { autoAgain = false; scheduleAutosave(); }
    }
  }
  function scheduleAutosave() {
    if (!doc?.autosave) return;
    clearTimeout(autoT);
    autoT = setTimeout(runAutosave, doc.source?.format === 'pdf' ? 4000 : 1500);
  }
  autoBox.addEventListener('change', async () => {
    if (!doc) { autoBox.checked = false; return; }
    if (!autoBox.checked) { doc.autosave = false; updateAutosave(); save(); ed?.commands.focus(); return; }
    // para activarlo hace falta un archivo: se guarda ahora (pide dónde si todavía no existe)
    const ok = await saveToFile();
    doc.autosave = !!ok;
    updateAutosave();
    if (ok) { save(); toast(`Autoguardado activado en ${doc.source.name}.${doc.source.format}`); }
    ed?.commands.focus();
  });

  // contentChanged: el documento difiere del archivo de origen
  function dirty(contentChanged = true) {
    leds[1].classList.remove('on');
    if (doc && contentChanged && doc.source) { doc.fileDirty = true; updateFileName(); scheduleAutosave(); }
    else if (doc && !docName()) updateFileName(); // el nombre automático sigue a la primera línea
    clearTimeout(saveT);
    saveT = setTimeout(save, 700);
  }

  async function save() {
    if (!doc || !ed) return;
    clearTimeout(saveT);
    doc.html = ed.getHTML();
    doc.text = plainText();
    doc.title = docName() || titleOf(doc.text);
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

  // Guarda en el archivo vinculado (o pregunta dónde). asFormat: "Guardar como" en ese formato.
  // copy: no vincular. quiet: sin avisos (autoguardado). Devuelve true si se guardó.
  async function saveToFile({ asFormat = null, copy = false, quiet = false } = {}) {
    if (!doc || !ed) return false;
    await save();
    const src = doc.source;
    const writable = src && src.path && ['docx', 'pdf', 'txt', 'md'].includes(src.format);
    const needDialog = !!asFormat || !writable;
    if (quiet && needDialog) return false;

    // Aviso al sobrescribir un Word/PDF que vino de fuera
    if (!needDialog && src.imported && !src.overwriteOk && (src.format === 'docx' || src.format === 'pdf')) {
      const r = await api.confirm({
        message: `¿Sobrescribir «${src.name}.${src.format}»?`,
        detail: 'Se conservan el texto, los títulos, las negritas, las listas, las tablas, las imágenes, la hoja y los márgenes. '
          + 'Se pueden perder encabezados y pies de página, colores, columnas, comentarios y el control de cambios del archivo original.',
        buttons: ['Sobrescribir', 'Guardar una copia…', 'Cancelar'],
      });
      if (r === 2) return false;
      if (r === 1) return saveToFile({ asFormat: src.format });
      src.overwriteOk = true;
    }

    const res = await api.saveFile({
      path: src?.path, format: asFormat || src?.format || 'docx', name: fileBase(),
      content: { json: ed.getJSON(), html: ed.getHTML(), text: plainText(), notes: (doc.notes || []).map((n) => n.text.trim()).filter(Boolean) },
      page: doc.page, font: S.font, dialog: needDialog,
    });
    if (!res) return false;
    if (res.error) { toast(res.error); if (quiet) { doc.autosave = false; updateAutosave(); } return false; }
    if (!copy) {
      doc.source = { path: res.path, name: res.name, format: res.format, imported: false };
      doc.name = '';
      doc.fileDirty = false;
      updateFileName();
      await save();
    }
    if (quiet) { flash(`Guardado en ${res.name}.${res.format}`); return true; }
    const lost = res.lost?.length ? ` (el .txt no guarda ${res.lost.join(', ')})` : '';
    toast(`Guardado como ${FORMAT_LABEL[res.format]}: ${res.name}.${res.format}${lost}`, lost ? 4500 : 2600);
    return true;
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function mountEditor(html) {
    if (ed) ed.destroy();
    host.innerHTML = '';
    ed = window.RichEditor.create({
      element: host,
      html,
      placeholder: 'Empieza a escribir…',
      maxImageWidth: colPx,
      ownScroll: () => S.typewriter,
      wordMode,
      onUpdate: () => { review = 0; updateCount(); dirty(true); layout(); },
      onSelection: () => { updateToolbar(); schedule(); },
      onError: toast,
    });
    ed.on('transaction', updateToolbar);
    ed.on('focus', () => schedule(true));
  }

  async function openDoc(d) {
    if (doc) { await runAutosave(); await save(); }
    clearTimeout(autoT);
    d.page = fixPage(d.page || S.pageDefault);
    doc = d;
    body.classList.replace('view-library', 'view-editor');
    mountEditor(d.html ?? textToHtml(d.text || ''));
    doc.notes = normalizeNotes(d.notes);
    renderNotes();
    updateCount();
    updateFileName();
    fillPageForm();
    updateToolbar();
    leds[1].classList.add('on');
    review = 0;
    ed.commands.focus('end');
    layout(true);

  }

  async function newDoc({ html = '', page = null, source = null, notes = null } = {}) {
    const now = Date.now();
    const d = {
      id: newId(), title: 'Sin título', html, text: '', notes: (notes || []).map((t) => ({ id: newId(), text: t })), created: now, updated: now, words: 0,
      page: fixPage({ ...S.pageDefault, ...(page || {}) }), source,
    };
    await openDoc(d);
    if (html || source) save();
  }

  // Abre un archivo leído por el proceso principal ({ path, name, format, html, page } o { error })
  async function importFile(r) {
    if (!r) return;
    if (r.error) { toast(r.error, 4000); return; }
    // si ya está en la biblioteca y no tiene cambios pendientes, se reutiliza
    if (r.path) {
      const existing = (await api.listDocs()).find((d) => d.source?.path === r.path);
      if (existing) {
        const full = await api.loadDoc(existing.id);
        if (full && !full.fileDirty) {
          full.html = r.html;
          if (r.page) full.page = { ...full.page, ...r.page };
          if (r.notes) full.notes = r.notes.map((t) => ({ id: newId(), text: t }));
          return openDoc(full);
        }
      }
    }
    await newDoc({ html: r.html, page: r.page, notes: r.notes, source: { path: r.path, name: r.name, format: r.format, imported: true } });
    if (r.format === 'doc') toast('Los .doc antiguos se abren solo con su texto; al guardar se creará un .docx', 4000);
    else toast(`Abierto: ${r.name}.${r.format}`);
  }

  async function openFile() { importFile(await api.openFile()); }
  api.onOpenPath(async (p) => importFile(await api.readPath(p)));

  async function showLibrary() {
    if (doc) { clearTimeout(autoT); await runAutosave(); await save(); doc = null; }
    if (ed) { ed.destroy(); ed = null; host.innerHTML = ''; }
    notesLayer.innerHTML = '';
    closePanels();
    body.classList.remove('in-table');
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

  $('#back').onclick = showLibrary;
  $('#lib-new').onclick = () => newDoc();
  $('#lib-open').onclick = openFile;
  document.querySelectorAll('[data-export]').forEach((b) => (b.onclick = () => saveToFile({ asFormat: b.dataset.export })));

  // ---------------- Notas de escritura: papelitos pegados al margen ----------------
  // Se guardan con el documento y, al guardar en Word o PDF, como notas adjuntas
  // (comentarios en Word, notas adhesivas en PDF).
  const notesLayer = $('#notes-layer');
  const NOTE_W = 210;
  // papel, bordes rasgados [arriba, derecha, abajo, izquierdo] y adornos
  const NOTE_STYLES = [
    { cls: 'kraft', torn: [1, 1, 1, 1], deco: '<span class="tape top"></span>' },
    { cls: 'cuadros', torn: [1, 0, 1, 0], deco: '<span class="tape tl"></span><span class="tape br"></span>' },
    { cls: 'crema', torn: [0, 0, 0, 1], deco: '<svg class="clip" viewBox="0 0 18 52"><path d="M5 40V9a4 4 0 0 1 8 0v34a6 6 0 0 1-12 0V14" fill="none" stroke="#6b6b6b" stroke-width="2.2" stroke-linecap="round"/></svg>' },
    { cls: 'azul', torn: [1, 1, 1, 1], deco: '<span class="tape top gold"></span>' },
    { cls: 'gris', torn: [1, 1, 1, 1], deco: '<span class="tape dots"></span>' },
    { cls: 'amarillo', torn: [0, 0, 1, 0], deco: '<span class="tape top"></span>' },
  ];
  const rng = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const seedOf = (str) => { let h = 7; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0; return h; };

  // contorno rasgado (clip-path) con dientes al azar, siempre igual para la misma nota
  function tornClip(note, torn) {
    const r = rng(seedOf(note.id)), pts = [], n = 22, j = (on, max) => (on ? (r() * max).toFixed(1) : 0);
    for (let i = 0; i <= n; i++) pts.push(`${(i * 100 / n).toFixed(1)}% ${j(torn[0], 7)}px`);
    for (let i = 1; i <= n; i++) pts.push(`calc(100% - ${j(torn[1], 6)}px) ${(i * 100 / n).toFixed(1)}%`);
    for (let i = n - 1; i >= 0; i--) pts.push(`${(i * 100 / n).toFixed(1)}% calc(100% - ${j(torn[2], 7)}px)`);
    for (let i = n - 1; i >= 1; i--) pts.push(`${j(torn[3], 6)}px ${(i * 100 / n).toFixed(1)}%`);
    return `polygon(${pts.join(',')})`;
  }

  function normalizeNotes(notes) {
    if (Array.isArray(notes)) return notes.filter((n) => n && typeof n.text === 'string');
    if (typeof notes === 'string' && notes.trim()) return [{ id: newId(), text: notes }]; // versión anterior: un solo texto
    return [];
  }

  // lugar libre en el margen: a la derecha de la columna de texto, o a la izquierda si no entra
  function defaultSpot(i) {
    const c = col.getBoundingClientRect();
    const right = c.right + 36, left = c.left - NOTE_W - 36;
    const fitsRight = right + NOTE_W <= window.innerWidth - 12, fitsLeft = left >= 12;
    // se apilan hacia abajo; cuando no entran, siguen en el otro margen
    const perCol = Math.max(1, Math.floor((window.innerHeight - 160) / 165));
    const colN = Math.floor(i / perCol);
    const xs = [fitsRight ? right : null, fitsLeft ? left : null].filter((v) => v != null);
    const x = xs.length ? xs[colN % xs.length] : window.innerWidth - NOTE_W - 16;
    const y = 104 + (i % perCol) * 165 + (colN >= xs.length ? 24 : 0);
    return { x: x / window.innerWidth, y: y / window.innerHeight };
  }

  function renderNotes() {
    notesLayer.innerHTML = '';
    if (!doc) return;
    doc.notes.forEach((note, i) => {
      if (note.x == null || note.y == null) Object.assign(note, defaultSpot(i));
      const st = NOTE_STYLES[(note.style ?? i) % NOTE_STYLES.length];
      note.style = NOTE_STYLES.indexOf(st);
      const el = document.createElement('div');
      el.className = `note ${st.cls}`;
      el.style.setProperty('--rot', ((rng(seedOf(note.id) + 9)() - .5) * 6).toFixed(2) + 'deg');
      el.innerHTML = `${st.deco}<div class="paper"><textarea rows="2" placeholder="Escribe una nota…" spellcheck="true"></textarea></div><button class="del" title="Quitar la nota" aria-label="Quitar la nota">×</button>`;
      el.querySelector('.paper').style.clipPath = tornClip(note, st.torn);
      const ta = el.querySelector('textarea');
      ta.value = note.text;
      const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', () => { note.text = ta.value; fit(); dirty(true); });
      ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { ta.blur(); ed?.commands.focus(); } });
      el.querySelector('.del').onclick = () => {
        if (note.text.trim() && !confirm('¿Quitar esta nota?')) return;
        doc.notes = doc.notes.filter((n) => n !== note);
        renderNotes(); dirty(true); ed?.commands.focus();
      };
      placeNote(el, note);
      makeDraggable(el, note);
      notesLayer.appendChild(el);
      requestAnimationFrame(fit);
    });
  }

  function placeNote(el, note) {
    const x = Math.min(Math.max(0, note.x * window.innerWidth), window.innerWidth - 60);
    const y = Math.min(Math.max(48, note.y * window.innerHeight), window.innerHeight - 60);
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }

  function makeDraggable(el, note) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('textarea, .del')) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const dx = e.clientX - el.offsetLeft, dy = e.clientY - el.offsetTop;
      const move = (ev) => { el.style.left = ev.clientX - dx + 'px'; el.style.top = ev.clientY - dy + 'px'; };
      const up = () => {
        el.classList.remove('dragging');
        note.x = el.offsetLeft / window.innerWidth; note.y = el.offsetTop / window.innerHeight;
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
        dirty(false);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  function addNote() {
    if (!doc) return;
    if (!S.showNotes) set('showNotes', true);
    const note = { id: newId(), text: '', style: doc.notes.length % NOTE_STYLES.length, ...defaultSpot(doc.notes.length) };
    doc.notes.push(note);
    renderNotes();
    notesLayer.lastElementChild?.querySelector('textarea').focus();
    dirty(false);
  }
  window.addEventListener('resize', () => notesLayer.querySelectorAll('.note').forEach((el, i) => doc?.notes[i] && placeNote(el, doc.notes[i])));

  // ---------------- Arrastrar y soltar archivos ----------------
  // Las imágenes soltadas sobre el texto las inserta el editor; los documentos se abren.
  let dragDepth = 0;
  const dragKind = (e) => {
    const items = [...(e.dataTransfer?.items || [])].filter((i) => i.kind === 'file');
    if (!items.length) return null;
    return items.every((i) => i.type.startsWith('image/')) ? 'image' : 'doc';
  };
  window.addEventListener('dragenter', (e) => {
    const k = dragKind(e);
    if (k === 'doc' || (k === 'image' && !ed)) { dragDepth++; body.classList.add('dragging'); }
  });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (dragKind(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragDepth = 0; body.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (f.type.startsWith('image/')) {
      if (ed) ed.insertImages([...e.dataTransfer.files].filter((x) => x.type.startsWith('image/')));
      else toast('Abre o crea un documento para insertar imágenes');
      return;
    }
    const p = api.pathForFile(f);
    if (p) importFile(await api.readPath(p));
    else if (/\.(txt|md)$/i.test(f.name)) importFile({ name: f.name.replace(/\.[^.]+$/, ''), format: 'txt', html: textToHtml(await f.text()) });
    else toast('Ese formato solo se puede abrir en la app de escritorio');
  });

  // ---------------- Paneles ----------------
  function togglePanel(name, force) {
    const el = $(`#${name}-panel`);
    const open = force ?? !el.classList.contains('open');
    closePanels();
    el.classList.toggle('open', open);
    if (open && name === 'settings') fillPageForm();
    if (!open || name === 'settings') ed?.commands.focus();
  }
  function closePanels() { document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open')); }

  $('#notes-btn').addEventListener('mousedown', (e) => e.preventDefault());
  $('#notes-btn').onclick = () => addNote();
  $('#settings-btn').onclick = () => togglePanel('settings');
  $('#settings-btn').addEventListener('mousedown', (e) => e.preventDefault()); // el texto conserva el foco y la selección
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => togglePanel(b.dataset.close, false)));

  // ---------------- Comandos (menú de la app y atajos) ----------------
  function command(cmd) {
    const inEditor = body.classList.contains('view-editor') && doc;
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
      case 'insert-image': return inEditor && $('#image-input').click();
      case 'insert-table': return inEditor && ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      case 'toggle-typewriter': return set('typewriter', !S.typewriter);
      case 'toggle-theme': return toggleLightDark();
      case 'toggle-notes': return inEditor && addNote();
      case 'toggle-settings': return inEditor && togglePanel('settings');
    }
  }
  api.onMenu(command);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanels(); ed?.commands.focus(); return; }
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
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  window.__mde = { caretRect, layout }; // para pruebas automáticas

  // Las texturas con filtros SVG (trama de semitono) se dibujan una sola vez como imagen:
  // así el navegador no recalcula el filtro en cada repintado mientras se escribe.
  function bakeTextures() {
    const css = getComputedStyle(root);
    for (const name of ['--tx-trama-cafe', '--tx-trama-gris']) {
      const m = /url\("(data:image\/svg\+xml[^"]+)"\)/.exec(css.getPropertyValue(name));
      if (!m) continue;
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 900; c.height = img.naturalHeight || 900;
          c.getContext('2d').drawImage(img, 0, 0);
          c.toBlob((blob) => { if (blob) root.style.setProperty(name, `url("${URL.createObjectURL(blob)}")`); }, 'image/png');
        } catch { /* se queda la versión SVG */ }
      };
      img.src = m[1];
    }
  }
  bakeTextures();

  // ---------------- Inicio ----------------
  leds[0].classList.add('on');
  applySettings();
  showLibrary();
})();
