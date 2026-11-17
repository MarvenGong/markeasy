'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
  clipboard,
  nativeTheme
} = require('electron');

const { SettingsStore } = require('./settings');
const fsService = require('./fsService');
const { buildAppMenu } = require('./menu');

const isDev = process.argv.includes('--dev');

// 允许通过环境变量隔离用户数据目录（自动化测试用），必须在 ready 之前设置
if (process.env.MARKEASY_USER_DATA) app.setPath('userData', process.env.MARKEASY_USER_DATA);

let mainWindow = null;
let settings = null;
let watcher = null;
let watchTimer = null;
let pendingChanges = new Set();
let docDirty = false;
let forceClose = false;
let quitting = false;
let pendingOpenFile = null;

/* ---------------------------------------------------------------- window */

function applyTheme(theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    title: 'MarkEasy',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // 阻止页面内跳转，外链走系统浏览器
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      openExternalSafe(url);
    } else if (!url.endsWith('/renderer/index.html')) {
      e.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (forceClose || !docDirty) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      message: '当前文档有未保存的修改',
      detail: '关闭前是否保存修改？'
    });
    if (choice === 0) {
      sendMenuAction('save-and-close');
    } else if (choice === 1) {
      closeNow();
    } else {
      quitting = false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopWatch();
    docDirty = false;
    forceClose = false;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenFile) {
      mainWindow.webContents.send('app:open-file', pendingOpenFile);
      pendingOpenFile = null;
    }
    runTestHook();
  });
}

function closeNow() {
  forceClose = true;
  if (quitting) app.quit();
  else if (mainWindow) mainWindow.close();
}

function sendMenuAction(action, payload) {
  if (!mainWindow) {
    createWindow();
    mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send('menu:action', action, payload));
    return;
  }
  mainWindow.webContents.send('menu:action', action, payload);
}

function openExternalSafe(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

/* ---------------------------------------------------------------- watcher */

function stopWatch() {
  if (watcher) {
    try {
      watcher.close();
    } catch (_) {}
    watcher = null;
  }
  clearTimeout(watchTimer);
  pendingChanges.clear();
}

function startWatch(dir) {
  stopWatch();
  if (!dir) return;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const name = filename.toString();
      if (name.split(path.sep).some((seg) => seg === '.git' || seg === 'node_modules')) return;
      pendingChanges.add(path.join(dir, name));
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        const changed = Array.from(pendingChanges);
        pendingChanges.clear();
        if (mainWindow) mainWindow.webContents.send('fs:changed', changed);
      }, 250);
    });
    watcher.on('error', (err) => console.warn('[watch] error', err.message));
  } catch (err) {
    console.warn('[watch] failed', err.message);
  }
}

/* ---------------------------------------------------------------- IPC */

function wrap(fn) {
  return async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  };
}

function registerIpc() {
  ipcMain.handle('settings:get', wrap(() => settings.get()));
  ipcMain.handle(
    'settings:set',
    wrap((patch) => {
      const next = settings.set(patch);
      if (patch && 'theme' in patch) applyTheme(next.theme);
      return next;
    })
  );
  ipcMain.handle(
    'settings:reset',
    wrap(() => {
      const next = settings.reset();
      applyTheme(next.theme);
      return next;
    })
  );

  ipcMain.handle(
    'dialog:openFolder',
    wrap(async () => {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '打开文件夹',
        properties: ['openDirectory', 'createDirectory']
      });
      return r.canceled ? null : r.filePaths[0];
    })
  );

  // 原生询问对话框，返回被点击按钮的下标；最后一个按钮视为“取消”
  ipcMain.handle(
    'dialog:ask',
    wrap(async ({ message, detail, buttons = ['确定', '取消'], danger = false }) => {
      const r = await dialog.showMessageBox(mainWindow, {
        type: danger ? 'warning' : 'question',
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        message,
        detail
      });
      return r.response;
    })
  );

  ipcMain.handle('fs:readDir', wrap((dir, opts) => fsService.readDir(dir, opts)));
  ipcMain.handle('fs:readFile', wrap((p) => fs.promises.readFile(p, 'utf8')));
  ipcMain.handle('fs:writeFile', wrap((p, content) => fs.promises.writeFile(p, content, 'utf8')));
  ipcMain.handle('fs:exists', wrap((p) => fsService.exists(p)));
  ipcMain.handle('fs:stat', wrap(async (p) => {
    const s = await fs.promises.stat(p);
    return { isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
  }));
  ipcMain.handle('fs:createFile', wrap((dir, name) => fsService.createFile(dir, name)));
  ipcMain.handle('fs:createFolder', wrap((dir, name) => fsService.createFolder(dir, name)));
  ipcMain.handle('fs:rename', wrap((p, name) => fsService.rename(p, name)));
  ipcMain.handle('fs:trash', wrap((p) => shell.trashItem(p)));
  ipcMain.handle('fs:reveal', wrap((p) => shell.showItemInFolder(p)));
  // 用系统默认应用打开（图片默认是“预览”）
  ipcMain.handle(
    'fs:openPath',
    wrap(async (p) => {
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    })
  );
  ipcMain.handle('fs:watch', wrap((dir) => startWatch(dir)));

  ipcMain.handle(
    'image:saveData',
    wrap(({ mdPath, data, mime }) => fsService.saveImageData(mdPath, data, mime, settings.get().imageFolder))
  );
  ipcMain.handle(
    'image:copyFile',
    wrap(({ mdPath, srcPath }) => fsService.copyImageFile(mdPath, srcPath, settings.get().imageFolder))
  );

  ipcMain.handle('shell:openExternal', wrap((url) => openExternalSafe(url)));
  ipcMain.handle('clipboard:writeText', wrap((text) => clipboard.writeText(String(text))));
  ipcMain.handle('clipboard:readText', wrap(() => clipboard.readText()));

  ipcMain.handle(
    'ctx:show',
    (e, { kind }) =>
      new Promise((resolve) => {
        let done = false;
        const pick = (action) => {
          if (done) return;
          done = true;
          resolve(action);
        };
        const item = (label, action, extra = {}) => ({ label, click: () => pick(action), ...extra });
        const sep = { type: 'separator' };
        let template;
        if (kind === 'root') {
          template = [
            item('新建 Markdown 文件', 'new-file'),
            item('新建文件夹', 'new-folder'),
            sep,
            item('刷新', 'refresh'),
            item('在 Finder 中显示', 'reveal'),
            item('复制路径', 'copy-path')
          ];
        } else if (kind === 'dir') {
          template = [
            item('新建 Markdown 文件', 'new-file'),
            item('新建文件夹', 'new-folder'),
            sep,
            item('重命名…', 'rename'),
            item('移到废纸篓', 'trash'),
            sep,
            item('在 Finder 中显示', 'reveal'),
            item('复制路径', 'copy-path')
          ];
        } else if (kind === 'image') {
          template = [
            item('预览图片', 'preview'),
            item('用默认应用打开', 'open-external'),
            sep,
            item('重命名…', 'rename'),
            item('移到废纸篓', 'trash'),
            sep,
            item('在 Finder 中显示', 'reveal'),
            item('复制路径', 'copy-path')
          ];
        } else if (kind === 'file') {
          template = [
            item('用默认应用打开', 'open-external'),
            sep,
            item('重命名…', 'rename'),
            item('移到废纸篓', 'trash'),
            sep,
            item('在 Finder 中显示', 'reveal'),
            item('复制路径', 'copy-path')
          ];
        } else {
          template = [
            item('打开', 'open'),
            sep,
            item('重命名…', 'rename'),
            item('移到废纸篓', 'trash'),
            sep,
            item('在 Finder 中显示', 'reveal'),
            item('复制路径', 'copy-path')
          ];
        }
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window: BrowserWindow.fromWebContents(e.sender),
          callback: () => setTimeout(() => pick(null), 80)
        });
      })
  );

  ipcMain.on('doc:state', (_e, { title, dirty, filePath }) => {
    docDirty = !!dirty;
    if (!mainWindow) return;
    mainWindow.setTitle(title || 'MarkEasy');
    mainWindow.setDocumentEdited(!!dirty);
    mainWindow.setRepresentedFilename(filePath || '');
  });

  ipcMain.on('app:close-now', () => closeNow());
}

/* ---------------------------------------------------------------- test hook */

// 仅用于自动化验证：MARKEASY_TEST_SCRIPT=/path/to/script.js
function runTestHook() {
  const script = process.env.MARKEASY_TEST_SCRIPT;
  if (!script || !mainWindow) return;
  try {
    require(path.resolve(script))({ app, win: mainWindow, settings });
  } catch (err) {
    console.error('[test-hook]', err);
    app.exit(1);
  }
}

/* ---------------------------------------------------------------- lifecycle */

app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('app:open-file', filePath);
  } else {
    pendingOpenFile = filePath;
    if (app.isReady() && !mainWindow) createWindow();
  }
});

app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  // 开发模式下 Dock 默认显示 Electron 图标，这里换成应用图标；打包后由 icon.icns 提供
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
    } catch (_) {}
  }
  settings = new SettingsStore();
  applyTheme(settings.get().theme);
  registerIpc();
  Menu.setApplicationMenu(buildAppMenu({ sendMenuAction, isDev }));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) app.quit();
});
