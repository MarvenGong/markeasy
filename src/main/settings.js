'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = Object.freeze({
  // 外观
  theme: 'system', // system | light | dark
  editorFontSize: 15,
  previewFontSize: 16,
  editorFontFamily: 'mono', // mono | system | serif
  previewFontFamily: 'system', // system | serif
  lineHeight: 1.7,
  previewWidth: 'normal', // normal(860px) | wide(1200px) | full
  // 编辑器
  lineNumbers: false,
  lineWrapping: true,
  tabSize: 2,
  autoSave: true,
  autoSaveDelay: 1000,
  syncScroll: true,
  pasteTableAsMarkdown: true,
  // 文件
  imageFolder: 'assets',
  showHiddenFiles: false,
  showAllFiles: false,
  // 界面状态（自动记忆）
  viewMode: 'split', // edit | split | preview
  sidebarVisible: true,
  sidebarWidth: 260,
  lastFolder: null,
  lastFile: null,
  expandedDirs: []
});

class SettingsStore {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...DEFAULT_SETTINGS, ...parsed };
    } catch (_) {
      this.data = { ...DEFAULT_SETTINGS };
    }
  }

  get() {
    return { ...this.data };
  }

  set(patch) {
    if (!patch || typeof patch !== 'object') return this.get();
    for (const key of Object.keys(patch)) {
      if (key in DEFAULT_SETTINGS) this.data[key] = patch[key];
    }
    this.save();
    return this.get();
  }

  reset() {
    // 只重置用户可配置项，保留界面状态
    const keep = ['lastFolder', 'lastFile', 'expandedDirs', 'sidebarWidth', 'sidebarVisible', 'viewMode'];
    const next = { ...DEFAULT_SETTINGS };
    for (const k of keep) next[k] = this.data[k];
    this.data = next;
    this.save();
    return this.get();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[settings] save failed', err);
    }
  }
}

module.exports = { SettingsStore, DEFAULT_SETTINGS };
