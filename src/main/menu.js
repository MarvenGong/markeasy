'use strict';

const { app, Menu } = require('electron');

function buildAppMenu({ sendMenuAction, isDev }) {
  const act = (action, payload) => () => sendMenuAction(action, payload);

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: act('open-settings') },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.name}` }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建 Markdown 文件…', accelerator: 'Cmd+N', click: act('new-file') },
        { label: '新建文件夹…', accelerator: 'Cmd+Shift+N', click: act('new-folder') },
        { type: 'separator' },
        { label: '打开文件夹…', accelerator: 'Cmd+O', click: act('open-folder') },
        { label: '关闭文件夹', click: act('close-folder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'Cmd+S', click: act('save') },
        { type: 'separator' },
        { label: '在 Finder 中显示当前文件', accelerator: 'Cmd+Alt+R', click: act('reveal-current') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        // 撤销/重做交给渲染进程处理，确保在 CodeMirror 中行为正确
        { label: '撤销', accelerator: 'Cmd+Z', click: act('undo') },
        { label: '重做', accelerator: 'Cmd+Shift+Z', click: act('redo') },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { label: '粘贴为纯文本', accelerator: 'Cmd+Shift+V', click: act('paste-plain') },
        { label: '全选', accelerator: 'Cmd+A', click: act('select-all') },
        { type: 'separator' },
        { label: '查找…', accelerator: 'Cmd+F', click: act('find') },
        { label: '替换…', accelerator: 'Cmd+Alt+F', click: act('replace') },
        { type: 'separator' },
        { label: '加粗', accelerator: 'Cmd+B', click: act('format', 'bold') },
        { label: '斜体', accelerator: 'Cmd+I', click: act('format', 'italic') },
        { label: '行内代码', accelerator: 'Cmd+E', click: act('format', 'code') },
        { label: '插入链接', accelerator: 'Cmd+K', click: act('format', 'link') }
      ]
    },
    {
      label: '显示',
      submenu: [
        { label: '切换侧边栏', accelerator: 'Cmd+\\', click: act('toggle-sidebar') },
        { type: 'separator' },
        { label: '仅编辑', accelerator: 'Cmd+1', click: act('view-mode', 'edit') },
        { label: '编辑 + 预览', accelerator: 'Cmd+2', click: act('view-mode', 'split') },
        { label: '仅预览', accelerator: 'Cmd+3', click: act('view-mode', 'preview') },
        { type: 'separator' },
        { label: '放大编辑器字体', accelerator: 'Cmd+=', click: act('font-size', 1) },
        { label: '缩小编辑器字体', accelerator: 'Cmd+-', click: act('font-size', -1) },
        { label: '重置编辑器字体', accelerator: 'Cmd+0', click: act('font-size', 0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
        ...(isDev || !app.isPackaged
          ? [{ type: 'separator' }, { role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }]
          : [])
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
