'use strict';

const { app, Menu } = require('electron');

/**
 * 应用菜单（macOS 顶部菜单栏 / Windows 窗口菜单栏）
 * 快捷键统一用 CmdOrCtrl：macOS 为 ⌘，Windows / Linux 为 Ctrl。
 */
function buildAppMenu({ sendMenuAction, isDev, showAbout }) {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const FM = isMac ? 'Finder' : isWin ? '资源管理器' : '文件管理器';
  const act = (action, payload) => () => sendMenuAction(action, payload);
  const sep = { type: 'separator' };

  const settingsItem = { label: isMac ? '设置…' : '设置', accelerator: 'CmdOrCtrl+,', click: act('open-settings') };

  const macAppMenu = {
    label: app.name,
    submenu: [
      { role: 'about', label: `关于 ${app.name}` },
      sep,
      settingsItem,
      sep,
      { role: 'services', label: '服务' },
      sep,
      { role: 'hide', label: `隐藏 ${app.name}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      sep,
      { role: 'quit', label: `退出 ${app.name}` }
    ]
  };

  const fileMenu = {
    label: '文件',
    submenu: [
      { label: '新建 Markdown 文件…', accelerator: 'CmdOrCtrl+N', click: act('new-file') },
      { label: '新建文件夹…', accelerator: 'CmdOrCtrl+Shift+N', click: act('new-folder') },
      sep,
      { label: '打开文件夹…', accelerator: 'CmdOrCtrl+O', click: act('open-folder') },
      { label: '关闭文件夹', click: act('close-folder') },
      sep,
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: act('save') },
      sep,
      { label: `在 ${FM} 中显示当前文件`, accelerator: isMac ? 'Cmd+Alt+R' : 'Shift+Alt+R', click: act('reveal-current') },
      sep,
      ...(isMac ? [{ role: 'close', label: '关闭窗口' }] : [settingsItem, sep, { role: 'quit', label: '退出', accelerator: 'Alt+F4' }])
    ]
  };

  const editMenu = {
    label: '编辑',
    submenu: [
      // 撤销/重做交给渲染进程处理，确保在 CodeMirror 中行为正确
      { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: act('undo') },
      { label: '重做', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: act('redo') },
      sep,
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: isMac ? '拷贝' : '复制' },
      { role: 'paste', label: '粘贴' },
      { label: '粘贴为纯文本', accelerator: 'CmdOrCtrl+Shift+V', click: act('paste-plain') },
      { label: '全选', accelerator: 'CmdOrCtrl+A', click: act('select-all') },
      sep,
      { label: '查找…', accelerator: 'CmdOrCtrl+F', click: act('find') },
      { label: '替换…', accelerator: isMac ? 'Cmd+Alt+F' : 'Ctrl+H', click: act('replace') },
      sep,
      { label: '加粗', accelerator: 'CmdOrCtrl+B', click: act('format', 'bold') },
      { label: '斜体', accelerator: 'CmdOrCtrl+I', click: act('format', 'italic') },
      { label: '行内代码', accelerator: 'CmdOrCtrl+E', click: act('format', 'code') },
      { label: '插入链接', accelerator: 'CmdOrCtrl+K', click: act('format', 'link') }
    ]
  };

  const viewMenu = {
    label: '显示',
    submenu: [
      { label: '切换侧边栏', accelerator: 'CmdOrCtrl+\\', click: act('toggle-sidebar') },
      sep,
      { label: '仅编辑', accelerator: 'CmdOrCtrl+1', click: act('view-mode', 'edit') },
      { label: '编辑 + 预览', accelerator: 'CmdOrCtrl+2', click: act('view-mode', 'split') },
      { label: '仅预览', accelerator: 'CmdOrCtrl+3', click: act('view-mode', 'preview') },
      sep,
      { label: '放大编辑器字体', accelerator: 'CmdOrCtrl+=', click: act('font-size', 1) },
      { label: '缩小编辑器字体', accelerator: 'CmdOrCtrl+-', click: act('font-size', -1) },
      { label: '重置编辑器字体', accelerator: 'CmdOrCtrl+0', click: act('font-size', 0) },
      sep,
      { role: 'togglefullscreen', label: isMac ? '进入全屏' : '全屏' },
      ...(isDev || !app.isPackaged
        ? [sep, { role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }]
        : [])
    ]
  };

  const windowMenu = {
    label: '窗口',
    submenu: isMac
      ? [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, sep, { role: 'front', label: '前置全部窗口' }]
      : [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' }]
  };

  const helpMenu = {
    label: '帮助',
    submenu: [{ label: `关于 ${app.name}`, click: () => showAbout && showAbout() }]
  };

  const template = isMac
    ? [macAppMenu, fileMenu, editMenu, viewMenu, windowMenu]
    : [fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
