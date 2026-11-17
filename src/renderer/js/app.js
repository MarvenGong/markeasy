/* 应用主控制器 */
(function () {
  'use strict';

  const ME = window.ME;
  const { path, debounce, isMarkdown } = ME;
  const api = window.api;

  const $ = (id) => document.getElementById(id);

  const state = {
    settings: null,
    root: null,
    file: null, // 当前打开文件的绝对路径
    saved: '', // 磁盘上的内容（最近一次保存/读取）
    dirty: false,
    saving: null // 正在进行中的保存 Promise
  };

  let tree, editor, preview, settingsPanel, viewer;

  /* ================================================================ 图片 / 其它文件 */

  /** 用系统默认应用打开本地文件（图片默认用“预览”） */
  async function openExternal(p) {
    if (window.__markeasy.dryRunExternal) {
      window.__markeasy.lastExternal = p; // 自动化测试用，不真的拉起外部应用
      return;
    }
    try {
      await api.fs.openPath(p);
    } catch (err) {
      ME.toast('无法打开：' + err.message, 'error');
    }
  }

  /** 应用内预览图片，可用 ← → 浏览同目录下的其它图片 */
  function previewImage(p) {
    const siblings = (tree.children.get(path.dirname(p)) || []).filter((it) => it.kind === 'image');
    const idx = siblings.findIndex((it) => it.path === p);
    if (idx < 0) viewer.open([{ path: p }], 0);
    else viewer.open(siblings.map((it) => ({ path: it.path })), idx);
  }

  /* ================================================================ 设置 */

  async function updateSettings(patch) {
    const prev = state.settings;
    state.settings = await api.settings.set(patch);
    applySettings(prev);
  }

  // 界面状态（侧边栏宽度、展开目录、上次文件等）合并后延迟写盘
  const persistUiState = (() => {
    let pending = {};
    const flush = debounce(() => {
      const patch = pending;
      pending = {};
      api.settings.set(patch).then((s) => {
        // 只同步这批字段，避免覆盖期间的本地修改
        for (const k of Object.keys(patch)) state.settings[k] = s[k];
      });
    }, 400);
    return (patch) => {
      Object.assign(pending, patch);
      Object.assign(state.settings, patch);
      flush();
    };
  })();

  function applySettings(prev = {}) {
    const s = state.settings;
    editor.applySettings(s);
    preview.applySettings(s);
    applyViewMode(s.viewMode);
    applySidebar(s.sidebarVisible, s.sidebarWidth);
    if (prev.showHiddenFiles !== undefined && (prev.showHiddenFiles !== s.showHiddenFiles || prev.showAllFiles !== s.showAllFiles)) {
      tree.refresh();
    }
    if (prev.imageFolder !== undefined && prev.imageFolder !== s.imageFolder) {
      ME.toast(`新粘贴的图片将保存到 “${s.imageFolder}/” 目录`, 'info');
    }
    document.querySelector('.welcome-tips li:nth-child(2)').innerHTML =
      `<kbd>⌘</kbd><kbd>V</kbd> 直接粘贴截图，图片自动存入 ${ME.escapeHtml(s.imageFolder)} 目录`;
  }

  /* ================================================================ 布局 */

  function applyViewMode(mode) {
    const ws = $('workspace');
    ws.classList.remove('mode-edit', 'mode-split', 'mode-preview');
    ws.classList.add('mode-' + mode);
    document.querySelectorAll('#view-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (mode !== 'preview') requestAnimationFrame(() => editor.refresh());
    if (mode !== 'edit' && state.file) renderPreview.flush();
  }

  function setViewMode(mode) {
    state.settings.viewMode = mode;
    applyViewMode(mode);
    persistUiState({ viewMode: mode });
  }

  function applySidebar(visible, width) {
    const app = $('app');
    app.classList.toggle('sidebar-hidden', !visible);
    $('sidebar').style.width = width + 'px';
    requestAnimationFrame(() => editor.refresh());
  }

  function toggleSidebar() {
    const v = !state.settings.sidebarVisible;
    state.settings.sidebarVisible = v;
    applySidebar(v, state.settings.sidebarWidth);
    persistUiState({ sidebarVisible: v });
  }

  function initSidebarResizer() {
    const handle = $('sidebar-resizer');
    let startX = 0;
    let startW = 0;
    const onMove = (e) => {
      const w = Math.max(180, Math.min(520, startW + e.clientX - startX));
      state.settings.sidebarWidth = w;
      $('sidebar').style.width = w + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
      editor.refresh();
      persistUiState({ sidebarWidth: state.settings.sidebarWidth });
    };
    handle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startW = $('sidebar').getBoundingClientRect().width;
      document.body.classList.add('resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      state.settings.sidebarWidth = 260;
      $('sidebar').style.width = '260px';
      persistUiState({ sidebarWidth: 260 });
    });
  }

  /* ================================================================ 文档状态 */

  function updateDocUI() {
    const name = state.file ? path.basename(state.file) : '';
    $('doc-name').textContent = name;
    $('doc-dirty').classList.toggle('show', state.dirty);
    $('doc-path').textContent = state.file && state.root ? path.relative(state.root, path.dirname(state.file)) : '';
    $('workspace').classList.toggle('has-file', !!state.file);
    api.setDocState({
      title: name ? `${name} — MarkEasy` : 'MarkEasy',
      dirty: state.dirty,
      filePath: state.file || ''
    });
    updateWelcome();
  }

  function updateWelcome() {
    const text = $('welcome-text');
    $('welcome-new').style.display = state.root ? '' : 'none';
    $('welcome-open').textContent = state.root ? '打开其他文件夹' : '打开文件夹';
    text.textContent = state.root ? '在左侧选择一个 Markdown 文件，或右键目录新建文件' : '打开一个文件夹，开始编写 Markdown';
  }

  function setSaveStatus(text, cls = '') {
    const el = $('status-save');
    el.textContent = text;
    el.className = 'status-save ' + cls;
  }

  function updateCounts() {
    if (!state.file) {
      $('status-count').textContent = '';
      $('status-pos').textContent = '';
      return;
    }
    const text = editor.getValue();
    $('status-count').textContent = `${ME.countWords(text)} 字 · ${text.length} 字符`;
  }

  const updateCountsLazy = debounce(updateCounts, 300);

  const renderPreview = debounce(() => {
    if (!state.file) return preview.clear();
    if (state.settings.viewMode === 'edit') return;
    preview.render(editor.getValue(), state.file);
  }, 120);

  /* ================================================================ 文件读写 */

  async function save({ silent = false } = {}) {
    if (!state.file) return true;
    if (state.saving) await state.saving;
    const file = state.file;
    const content = editor.getValue();
    if (content === state.saved && !state.dirty) return true;
    setSaveStatus('保存中…');
    state.saving = api.fs
      .writeFile(file, content)
      .then(() => {
        if (state.file === file) {
          state.saved = content;
          state.dirty = editor.getValue() !== content;
          updateDocUI();
        }
        setSaveStatus(`已保存 ${ME.formatTime()}`, 'ok');
        return true;
      })
      .catch((err) => {
        setSaveStatus('保存失败', 'error');
        if (!silent) ME.toast('保存失败：' + err.message, 'error');
        return false;
      })
      .finally(() => (state.saving = null));
    return state.saving;
  }

  const autoSave = (() => {
    let timer = null;
    const fn = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (state.settings.autoSave && state.dirty) save({ silent: true });
      }, Number(state.settings.autoSaveDelay) || 1000);
    };
    fn.cancel = () => clearTimeout(timer);
    return fn;
  })();

  /** 切换文件/关闭前确保修改不会丢失；返回 false 表示用户取消 */
  async function ensureSaved() {
    autoSave.cancel();
    if (!state.file || !state.dirty) return true;
    if (state.settings.autoSave) return save();
    const idx = await ME.ask(`是否保存对 “${path.basename(state.file)}” 的修改？`, {
      detail: '如果不保存，修改将会丢失。',
      buttons: ['保存', '不保存', '取消']
    });
    if (idx === 0) return save();
    if (idx === 1) {
      state.dirty = false;
      return true;
    }
    return false;
  }

  async function openFile(file, { force = false } = {}) {
    if (!file) return;
    if (!isMarkdown(file)) {
      ME.toast('只能打开 Markdown 文件（.md / .markdown）', 'warn');
      return;
    }
    if (!force && file === state.file) {
      editor.focus();
      return;
    }
    if (!(await ensureSaved())) return;
    let content;
    try {
      content = await api.fs.readFile(file);
    } catch (err) {
      ME.toast('打开失败：' + err.message, 'error');
      return;
    }
    // 文件不在当前根目录下（如从 Finder 双击打开）时，把其所在目录设为根目录
    if (!state.root || !path.isInside(file, state.root)) {
      await setRoot(path.dirname(file), { keepFile: true });
    }
    state.file = file;
    state.saved = content;
    state.dirty = false;
    editor.setReadOnly(false);
    editor.load(content);
    renderPreview.flush();
    preview.setScrollRatio(0);
    updateDocUI();
    updateCounts();
    setSaveStatus('');
    await tree.expand(path.dirname(file));
    tree.setActive(file);
    tree.setSelected(file);
    persistUiState({ lastFile: file });
    requestAnimationFrame(() => {
      editor.refresh();
      if (state.settings.viewMode !== 'preview') editor.focus();
    });
  }

  function closeFile() {
    state.file = null;
    state.saved = '';
    state.dirty = false;
    editor.load('');
    editor.setReadOnly(true);
    preview.clear();
    tree.setActive(null);
    updateDocUI();
    updateCounts();
    setSaveStatus('');
    persistUiState({ lastFile: null });
  }

  async function onExternalChange(changed) {
    await tree.refresh(changed);
    if (!state.file || !changed.includes(state.file)) return;
    let exists = true;
    try {
      exists = await api.fs.exists(state.file);
    } catch (_) {}
    if (!exists) {
      ME.toast('当前文件已被移动或删除', 'warn');
      state.dirty = true;
      updateDocUI();
      return;
    }
    if (state.saving) return;
    const disk = await api.fs.readFile(state.file).catch(() => null);
    if (disk === null || disk === state.saved || disk === editor.getValue()) {
      if (disk !== null) state.saved = disk;
      return;
    }
    if (state.dirty) {
      ME.toast('文件已在外部被修改，当前编辑内容尚未保存', 'warn', 4000);
      return;
    }
    state.saved = disk;
    editor.reload(disk);
    renderPreview.flush();
    updateCounts();
    setSaveStatus('已从磁盘重新载入', 'ok');
  }

  /* ================================================================ 目录 */

  async function setRoot(dir, { keepFile = false } = {}) {
    if (!keepFile && !(await ensureSaved())) return;
    state.root = dir;
    $('app').classList.toggle('no-root', !dir);
    $('folder-name').textContent = dir ? path.basename(dir) : '未打开文件夹';
    $('folder-name').title = dir || '';
    if (!keepFile && state.file && (!dir || !path.isInside(state.file, dir))) closeFile();
    const sameRoot = state.settings.lastFolder === dir;
    await tree.setRoot(dir, sameRoot ? state.settings.expandedDirs || [] : []);
    await api.fs.watch(dir);
    persistUiState({ lastFolder: dir, ...(sameRoot ? {} : { expandedDirs: [] }) });
    state.settings.lastFolder = dir;
    updateDocUI();
  }

  async function openFolder() {
    const dir = await api.dialog.openFolder();
    if (dir) await setRoot(dir);
  }

  /** 新建操作的目标目录：选中的目录 > 选中文件所在目录 > 当前文件所在目录 > 根目录 */
  function targetDir() {
    const sel = tree.selected;
    if (sel && state.root && path.isInside(sel, state.root)) {
      const row = tree.findRow(sel);
      if (row) return row.dataset.dir === '1' ? sel : path.dirname(sel);
    }
    if (state.file && state.root && path.isInside(state.file, state.root)) return path.dirname(state.file);
    return state.root;
  }

  function displayDir(dir) {
    return dir === state.root ? path.basename(dir) : path.relative(state.root, dir) || path.basename(dir);
  }

  async function newFile(dir = targetDir()) {
    if (!dir) {
      ME.toast('请先打开一个文件夹', 'warn');
      return openFolder();
    }
    const name = await ME.prompt({
      title: '新建 Markdown 文件',
      desc: `位置：${displayDir(dir)}/`,
      value: '未命名.md',
      okText: '创建'
    });
    if (!name) return;
    try {
      const file = await api.fs.createFile(dir, name);
      await tree.expand(dir);
      await tree.refresh([file]);
      await openFile(file);
    } catch (err) {
      ME.toast(err.message, 'error');
    }
  }

  async function newFolder(dir = targetDir()) {
    if (!dir) {
      ME.toast('请先打开一个文件夹', 'warn');
      return openFolder();
    }
    const name = await ME.prompt({ title: '新建文件夹', desc: `位置：${displayDir(dir)}/`, value: '新建文件夹', okText: '创建' });
    if (!name) return;
    try {
      const folder = await api.fs.createFolder(dir, name);
      await tree.expand(dir);
      await tree.refresh([folder]);
      tree.setSelected(folder);
    } catch (err) {
      ME.toast(err.message, 'error');
    }
  }

  async function renameItem(p) {
    const oldName = path.basename(p);
    const name = await ME.prompt({ title: '重命名', desc: path.relative(state.root, path.dirname(p)) || path.basename(state.root), value: oldName, okText: '重命名' });
    if (!name || name === oldName) return;
    try {
      const next = await api.fs.rename(p, name);
      tree.remapPath(p, next);
      if (state.file && path.isInside(state.file, p)) {
        state.file = next + state.file.slice(p.length);
        persistUiState({ lastFile: state.file });
        updateDocUI();
        renderPreview.flush();
      }
      await tree.refresh([p, next]);
      tree.setActive(state.file);
      persistUiState({ expandedDirs: Array.from(tree.expanded) });
    } catch (err) {
      ME.toast(err.message, 'error');
    }
  }

  async function trashItem(p, isDir) {
    const idx = await ME.ask(`确定要将 “${path.basename(p)}” 移到废纸篓吗？`, {
      detail: isDir ? '该文件夹及其中所有内容都会被移到废纸篓。' : '可以在废纸篓中恢复。',
      buttons: ['移到废纸篓', '取消'],
      danger: true
    });
    if (idx !== 0) return;
    try {
      if (state.file && path.isInside(state.file, p)) {
        autoSave.cancel();
        closeFile();
      }
      await api.fs.trash(p);
      await tree.refresh([p]);
    } catch (err) {
      ME.toast('删除失败：' + err.message, 'error');
    }
  }

  async function onContextMenu(kind, p) {
    const action = await api.showContextMenu(kind, p);
    if (!action) return;
    switch (action) {
      case 'new-file':
        return newFile(p);
      case 'new-folder':
        return newFolder(p);
      case 'rename':
        return renameItem(p);
      case 'trash':
        return trashItem(p, kind === 'dir');
      case 'open':
        return openFile(p);
      case 'preview':
        return previewImage(p);
      case 'open-external':
        return openExternal(p);
      case 'reveal':
        return api.fs.reveal(p);
      case 'refresh':
        return tree.refresh();
      case 'copy-path':
        await api.clipboard.writeText(p);
        return ME.toast('已复制路径', 'success', 1400);
      default:
    }
  }

  /* ================================================================ 滚动同步 */

  let scrollLock = null;
  let scrollLockTimer = null;
  function syncScroll(from) {
    if (!state.settings.syncScroll || state.settings.viewMode !== 'split') return;
    if (scrollLock && scrollLock !== from) return;
    scrollLock = from;
    clearTimeout(scrollLockTimer);
    scrollLockTimer = setTimeout(() => (scrollLock = null), 120);
    if (from === 'editor') preview.setScrollRatio(editor.getScrollRatio());
    else editor.setScrollRatio(preview.getScrollRatio());
  }

  /* ================================================================ 菜单 */

  function isTextInputFocused() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && !a.closest('.CodeMirror');
  }

  async function onMenuAction(action, payload) {
    switch (action) {
      case 'open-settings':
        return settingsPanel.open();
      case 'open-folder':
        return openFolder();
      case 'close-folder':
        if (await ensureSaved()) {
          closeFile();
          await setRoot(null, { keepFile: true });
        }
        return;
      case 'new-file':
        return newFile();
      case 'new-folder':
        return newFolder();
      case 'save':
        return save();
      case 'save-and-close':
        if (await save()) api.closeNow();
        return;
      case 'reveal-current':
        if (state.file) api.fs.reveal(state.file);
        return;
      case 'toggle-sidebar':
        return toggleSidebar();
      case 'view-mode':
        return setViewMode(payload);
      case 'font-size': {
        const cur = state.settings.editorFontSize;
        const next = payload === 0 ? 15 : Math.max(11, Math.min(28, cur + payload));
        return updateSettings({ editorFontSize: next });
      }
      case 'undo':
      case 'redo':
        if (editor.hasFocus()) editor.exec(action);
        else if (isTextInputFocused()) document.execCommand(action);
        return;
      case 'paste-plain': {
        const text = await api.clipboard.readText().catch(() => '');
        if (editor.hasFocus() && state.file) editor.pastePlain(text);
        else if (isTextInputFocused()) document.execCommand('insertText', false, text);
        return;
      }
      case 'select-all':
        if (editor.hasFocus()) editor.exec('selectAll');
        else if (isTextInputFocused()) document.activeElement.select();
        else if (state.settings.viewMode === 'preview') {
          const r = document.createRange();
          r.selectNodeContents($('preview'));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
        return;
      case 'find':
      case 'replace':
        if (!state.file) return;
        if (state.settings.viewMode === 'preview') setViewMode('split');
        editor.focus();
        editor.exec(action === 'find' ? 'findPersistent' : 'replace');
        return;
      case 'format':
        if (state.file && editor.hasFocus()) editor.format(payload);
        return;
      default:
    }
  }

  /* ================================================================ 拖放 */

  /** 拖入的是文件夹则作为根目录打开，是 Markdown 文件则直接打开 */
  async function openDroppedPath(p) {
    if (!p) return;
    try {
      const st = await api.fs.stat(p);
      if (st.isDir) await setRoot(p);
      else if (isMarkdown(p)) await openFile(p);
      else ME.toast('只能打开文件夹或 Markdown 文件', 'warn');
    } catch (_) {}
  }

  function initWindowDrop() {
    // 阻止拖入文件时页面被导航
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      if (e.defaultPrevented) return; // 编辑器已处理
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openDroppedPath(api.getPathForFile(f));
    });
  }

  /* ================================================================ 启动 */

  async function init() {
    ME.mountIcons();
    state.settings = await api.settings.get();

    editor = new ME.Editor($('editor'), {
      getFilePath: () => state.file,
      onChange: () => {
        if (!state.file) return;
        const dirty = editor.getValue() !== state.saved;
        if (dirty !== state.dirty) {
          state.dirty = dirty;
          updateDocUI();
        }
        if (dirty) setSaveStatus('未保存', 'warn');
        renderPreview();
        updateCountsLazy();
        if (state.settings.autoSave) autoSave();
      },
      onCursor: (c) => {
        if (state.file) $('status-pos').textContent = `行 ${c.line + 1}，列 ${c.ch + 1}`;
      },
      onScroll: () => syncScroll('editor'),
      shouldConvertTable: () => state.settings.pasteTableAsMarkdown !== false,
      onDropFiles: (files) => openDroppedPath(api.getPathForFile(files[0]))
    });
    editor.setReadOnly(true);

    preview = new ME.Preview($('preview'), $('preview-pane'), {
      onOpenFile: (p) => openFile(p),
      onOpenLocal: (p) => openExternal(p),
      onImageClick: (items, index) => viewer.open(items, index),
      onScroll: () => syncScroll('preview')
    });

    viewer = new ME.ImageViewer({
      openExternal: (it) => (it.path ? openExternal(it.path) : api.shell.openExternal(it.url))
    });

    tree = new ME.FileTree($('tree'), {
      onOpen: (p) => openFile(p),
      onPreview: (p) => previewImage(p),
      onOpenExternal: (p) => openExternal(p),
      onContextMenu,
      onExpandChange: (list) => persistUiState({ expandedDirs: list }),
      getReadOpts: () => ({ showHidden: !!state.settings.showHiddenFiles, showAll: !!state.settings.showAllFiles })
    });

    settingsPanel = new ME.SettingsPanel({
      getSettings: () => state.settings,
      update: updateSettings,
      reset: async () => {
        const prev = state.settings;
        state.settings = await api.settings.reset();
        applySettings(prev);
      }
    });

    applySettings();
    initSidebarResizer();
    initWindowDrop();

    // 按钮
    $('btn-open-folder').addEventListener('click', openFolder);
    $('btn-open-folder-2').addEventListener('click', openFolder);
    $('welcome-open').addEventListener('click', openFolder);
    $('welcome-new').addEventListener('click', () => newFile());
    $('btn-new-file').addEventListener('click', () => newFile());
    $('btn-new-folder').addEventListener('click', () => newFolder());
    $('btn-collapse').addEventListener('click', () => tree.collapseAll());
    $('btn-toggle-sidebar').addEventListener('click', toggleSidebar);
    $('btn-settings').addEventListener('click', () => settingsPanel.open());
    document.querySelectorAll('#view-mode button').forEach((b) => b.addEventListener('click', () => setViewMode(b.dataset.mode)));

    api.onMenuAction(onMenuAction);
    api.onFsChanged((changed) => onExternalChange(changed));
    api.onOpenFile((p) => openFile(p));

    window.addEventListener('blur', () => {
      if (state.settings.autoSave && state.dirty) save({ silent: true });
    });

    // 恢复上次的工作区
    const { lastFolder, lastFile } = state.settings;
    $('app').classList.add('no-root');
    if (lastFolder && (await api.fs.exists(lastFolder).catch(() => false))) {
      await setRoot(lastFolder, { keepFile: true });
      if (lastFile && path.isInside(lastFile, lastFolder) && (await api.fs.exists(lastFile).catch(() => false))) {
        await openFile(lastFile);
      }
    }
    updateDocUI();
    document.body.classList.add('ready');
  }

  // 暴露给自动化测试
  window.__markeasy = {
    state,
    get editor() {
      return editor;
    },
    get tree() {
      return tree;
    },
    setRoot,
    openFile,
    save,
    onMenuAction
  };

  init().catch((err) => {
    console.error(err);
    ME.toast('初始化失败：' + err.message, 'error', 8000);
  });
})();
