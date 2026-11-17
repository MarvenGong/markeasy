'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error((res && res.error) || '未知错误');
  return res.data;
}

function on(channel, handler) {
  const listener = (_e, ...args) => handler(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
    reset: () => call('settings:reset')
  },

  dialog: {
    openFolder: () => call('dialog:openFolder'),
    ask: (opts) => call('dialog:ask', opts)
  },

  fs: {
    readDir: (dir, opts) => call('fs:readDir', dir, opts),
    readFile: (p) => call('fs:readFile', p),
    writeFile: (p, content) => call('fs:writeFile', p, content),
    exists: (p) => call('fs:exists', p),
    stat: (p) => call('fs:stat', p),
    createFile: (dir, name) => call('fs:createFile', dir, name),
    createFolder: (dir, name) => call('fs:createFolder', dir, name),
    rename: (p, name) => call('fs:rename', p, name),
    trash: (p) => call('fs:trash', p),
    reveal: (p) => call('fs:reveal', p),
    openPath: (p) => call('fs:openPath', p),
    watch: (dir) => call('fs:watch', dir)
  },

  image: {
    saveData: (mdPath, data, mime) => call('image:saveData', { mdPath, data, mime }),
    copyFile: (mdPath, srcPath) => call('image:copyFile', { mdPath, srcPath })
  },

  shell: {
    openExternal: (url) => call('shell:openExternal', url)
  },

  clipboard: {
    writeText: (text) => call('clipboard:writeText', text),
    readText: () => call('clipboard:readText')
  },

  /** 获取拖拽/粘贴的 File 对象在本地磁盘上的路径（无路径返回空字符串） */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (_) {
      return '';
    }
  },

  showContextMenu: (kind, targetPath) => ipcRenderer.invoke('ctx:show', { kind, path: targetPath }),

  setDocState: (state) => ipcRenderer.send('doc:state', state),
  closeNow: () => ipcRenderer.send('app:close-now'),

  onMenuAction: (handler) => on('menu:action', handler),
  onFsChanged: (handler) => on('fs:changed', handler),
  onOpenFile: (handler) => on('app:open-file', handler)
});
