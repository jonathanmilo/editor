// Proceso principal de Electron: ventana, menú, almacenamiento y exportación.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const isMac = process.platform === 'darwin';
let win;

const docsDir = () => path.join(app.getPath('userData'), 'documentos');

const TITLEBAR = {
  light: { color: '#8c827d', symbolColor: '#2a2522' },
  dark: { color: '#1c1917', symbolColor: '#d9cfc4' },
};

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#8c827d',
    title: 'Editor genial',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: isMac ? undefined : { ...TITLEBAR.light, height: 36 },
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  win.webContents.session.setSpellCheckerLanguages(['es-ES', 'es']);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Abrir enlaces externos en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Menú contextual con sugerencias ortográficas
  win.webContents.on('context-menu', (_e, params) => {
    const items = params.dictionarySuggestions.map((s) => ({
      label: s,
      click: () => win.webContents.replaceMisspelling(s),
    }));
    if (params.misspelledWord) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: 'Añadir al diccionario',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    items.push(
      { role: 'cut', label: 'Cortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Pegar' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Seleccionar todo' },
    );
    Menu.buildFromTemplate(items).popup();
  });
}

function send(cmd) {
  if (win) win.webContents.send('menu', cmd);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo documento', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Abrir archivo (Word, PDF, texto)…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Biblioteca', accelerator: 'CmdOrCtrl+L', click: () => send('library') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        {
          label: 'Guardar una copia como',
          submenu: [
            { label: 'Word (.docx)…', click: () => send('save-docx') },
            { label: 'PDF (.pdf)…', accelerator: 'CmdOrCtrl+P', click: () => send('save-pdf') },
            { label: 'Texto (.txt)…', click: () => send('save-txt') },
            { label: 'Markdown (.md)…', click: () => send('save-md') },
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Cerrar' } : { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Insertar',
      submenu: [
        { label: 'Imagen…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('insert-image') },
        { label: 'Tabla', accelerator: 'CmdOrCtrl+Alt+T', click: () => send('insert-table') },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Modo máquina de escribir', accelerator: 'CmdOrCtrl+Shift+T', click: () => send('toggle-typewriter') },
        { label: 'Cambiar tema claro/oscuro', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('toggle-theme') },
        { label: 'Notas de escritura', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('toggle-notes') },
        { label: 'Ajustes', accelerator: 'CmdOrCtrl+,', click: () => send('toggle-settings') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Almacenamiento de documentos (JSON en la carpeta de usuario) ----------
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

ipcMain.handle('docs:list', async () => {
  await fs.mkdir(docsDir(), { recursive: true });
  const files = (await fs.readdir(docsDir())).filter((f) => f.endsWith('.json'));
  const docs = [];
  for (const f of files) {
    try {
      const d = JSON.parse(await fs.readFile(path.join(docsDir(), f), 'utf8'));
      docs.push({ id: d.id, title: d.title, updated: d.updated, words: d.words, source: d.source || null, preview: (d.text || '').slice(0, 200) });
    } catch { /* archivo dañado: se ignora */ }
  }
  return docs.sort((a, b) => b.updated - a.updated);
});

ipcMain.handle('docs:load', async (_e, id) => {
  try {
    return JSON.parse(await fs.readFile(path.join(docsDir(), safeId(id) + '.json'), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('docs:save', async (_e, doc) => {
  await fs.mkdir(docsDir(), { recursive: true });
  const file = path.join(docsDir(), safeId(doc.id) + '.json');
  const tmp = `${file}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc), 'utf8');
  await fs.rename(tmp, file); // escritura atómica
  return true;
});

ipcMain.handle('docs:delete', async (_e, id) => {
  await fs.rm(path.join(docsDir(), safeId(id) + '.json'), { force: true });
  return true;
});

// ---------- Abrir / guardar archivos (Word, PDF, texto) ----------
const formats = require('./lib/formats');

const OPEN_FILTERS = [
  { name: 'Documentos compatibles', extensions: ['docx', 'doc', 'pdf', 'txt', 'md'] },
  { name: 'Word', extensions: ['docx', 'doc'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Texto', extensions: ['txt', 'md', 'text'] },
];
const SAVE_FILTERS = {
  docx: { name: 'Documento de Word (.docx)', extensions: ['docx'] },
  pdf: { name: 'PDF (.pdf)', extensions: ['pdf'] },
  txt: { name: 'Texto (.txt)', extensions: ['txt'] },
  md: { name: 'Markdown (.md)', extensions: ['md'] },
};

async function readForRenderer(p) {
  try {
    return await formats.readFile(p);
  } catch (err) {
    return { error: `No se pudo leer «${path.basename(p)}»: ${err.message}` };
  }
}

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Abrir archivo', properties: ['openFile'], filters: OPEN_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  return readForRenderer(r.filePaths[0]);
});

ipcMain.handle('file:read', (_e, p) => readForRenderer(p));

// opts: { path?, format?, name, content: { json, html }, page, font, dialog }
ipcMain.handle('file:save', async (_e, opts) => {
  let target = opts.path;
  let format = opts.format;
  if (opts.dialog || !target || !formats.WRITABLE.includes(format)) {
    const first = formats.WRITABLE.includes(format) ? format : 'docx';
    const order = [first, ...formats.WRITABLE.filter((f) => f !== first)];
    const r = await dialog.showSaveDialog(win, {
      title: 'Guardar como',
      defaultPath: path.join(target ? path.dirname(target) : app.getPath('documents'), `${opts.name || 'Documento'}.${first}`),
      filters: order.map((f) => SAVE_FILTERS[f]),
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
    format = formats.extOf(target);
    if (!formats.WRITABLE.includes(format)) { format = first; target += '.' + first; }
  }
  try {
    const lost = await formats.writeFile(target, format, opts.content, opts.page, opts.font, __dirname, () => new BrowserWindow({
      show: false, webPreferences: { javascript: true, contextIsolation: true },
    }));
    app.addRecentDocument(target);
    return { path: target, format, name: path.basename(target, path.extname(target)), lost };
  } catch (err) {
    return { error: `No se pudo guardar: ${err.message}` };
  }
});

ipcMain.handle('file:confirm', async (_e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  return r.response;
});

ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p));

// Colores de la barra de la ventana según el tema de papel: { color, symbolColor }
const HEX = /^#[0-9a-f]{6}$/i;
ipcMain.on('theme', (_e, t) => {
  const colors = typeof t === 'string' ? TITLEBAR[t] : t;
  if (!win || !colors || !HEX.test(colors.color) || !HEX.test(colors.symbolColor)) return;
  if (!isMac) { try { win.setTitleBarOverlay({ ...colors, height: 36 }); } catch { /* plataforma sin overlay */ } }
  win.setBackgroundColor(colors.color);
});

// Renombrar el archivo vinculado en disco (misma carpeta y extensión)
ipcMain.handle('file:rename', async (_e, { path: from, name }) => {
  const clean = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/[. ]+$/, '');
  if (!clean) return { error: 'El nombre no es válido' };
  const to = path.join(path.dirname(from), clean + path.extname(from));
  if (to === from) return { path: to, name: clean };
  try {
    await fs.access(from);
  } catch {
    return { path: to, name: clean, missing: true }; // el archivo aún no existe: se usará el nombre nuevo al guardar
  }
  try {
    await fs.access(to);
    return { error: `Ya existe «${path.basename(to)}» en esa carpeta` };
  } catch { /* no existe: se puede renombrar */ }
  try {
    await fs.rename(from, to);
    return { path: to, name: clean };
  } catch (err) {
    return { error: `No se pudo renombrar: ${err.message}` };
  }
});

// Archivos pasados al ejecutar ("Abrir con…" o doble clic en un archivo asociado)
const fileFromArgs = (argv) => argv.slice(1).find((a) => !a.startsWith('-') && formats.READABLE.includes(formats.extOf(a)) && require('fs').existsSync(a));
let pendingPath = fileFromArgs(process.argv);

function openPath(p) {
  if (!p || !win) return;
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('open-path', p));
  else win.webContents.send('open-path', p);
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  openPath(fileFromArgs(argv));
});
app.on('open-file', (e, p) => { e.preventDefault(); if (win) openPath(p); else pendingPath = p; });

// La app antes se llamaba «Máquina de escribir»: la primera vez se copian su biblioteca y sus ajustes.
async function migrateOldData() {
  const target = app.getPath('userData');
  for (const oldName of ['Máquina de escribir', 'maquina-de-escribir']) {
    const old = path.join(app.getPath('appData'), oldName);
    if (old === target) continue;
    for (const sub of ['documentos', 'Local Storage']) {
      const from = path.join(old, sub), to = path.join(target, sub);
      try {
        await fs.access(from);
        try { await fs.access(to); continue; } catch { /* no existe: se copia */ }
        await fs.cp(from, to, { recursive: true });
      } catch { /* no hay datos anteriores */ }
    }
  }
}

app.whenReady().then(async () => {
  await migrateOldData();
  buildMenu();
  createWindow();
  openPath(pendingPath);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
