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
    title: 'Máquina de escribir',
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
        { label: 'Abrir archivo…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Biblioteca', accelerator: 'CmdOrCtrl+L', click: () => send('library') },
        { type: 'separator' },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Exportar a Word (.docx)…', accelerator: 'CmdOrCtrl+E', click: () => send('export-docx') },
        { label: 'Exportar a texto (.txt)…', click: () => send('export-txt') },
        { label: 'Exportar a Markdown (.md)…', click: () => send('export-md') },
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
      docs.push({ id: d.id, title: d.title, updated: d.updated, words: d.words, preview: (d.text || '').slice(0, 200) });
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

// ---------- Abrir / exportar archivos ----------
ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir archivo',
    properties: ['openFile'],
    filters: [{ name: 'Texto', extensions: ['txt', 'md', 'markdown', 'text'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p, path.extname(p)), text: await fs.readFile(p, 'utf8') };
});

ipcMain.handle('file:export', async (_e, { format, name, text, settings }) => {
  const ext = { docx: 'docx', txt: 'txt', md: 'md' }[format];
  const r = await dialog.showSaveDialog(win, {
    title: 'Exportar',
    defaultPath: path.join(app.getPath('documents'), `${name || 'Documento'}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;

  if (format === 'docx') {
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    const font = settings?.docxFont || 'Courier New';
    const doc = new Document({
      creator: 'Máquina de escribir',
      title: name,
      styles: { default: { document: { run: { font, size: 24 } } } },
      sections: [{
        children: text.split('\n').map((line) => new Paragraph({
          spacing: { after: 0, line: 360 },
          children: [new TextRun({ text: line, font })],
        })),
      }],
    });
    await fs.writeFile(r.filePath, await Packer.toBuffer(doc));
  } else {
    await fs.writeFile(r.filePath, text, 'utf8');
  }
  return r.filePath;
});

ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p));

ipcMain.on('theme', (_e, theme) => {
  if (win && !isMac && TITLEBAR[theme]) {
    try { win.setTitleBarOverlay({ ...TITLEBAR[theme], height: 36 }); } catch { /* plataforma sin overlay */ }
    win.setBackgroundColor(TITLEBAR[theme].color);
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
