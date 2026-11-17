/* 编辑器：CodeMirror 封装 + 图片粘贴/拖拽 + 常用格式命令 */
(function () {
  'use strict';

  const ME = window.ME;
  const { path, isImage } = ME;

  const FONT_STACKS = {
    mono: '"SF Mono", "JetBrains Mono", Menlo, Monaco, "PingFang SC", monospace',
    system: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Hiragino Sans GB", sans-serif',
    serif: '"Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif'
  };

  class Editor {
    /**
     * @param {HTMLElement} el
     * @param {{getFilePath:Function, onChange:Function, onCursor:Function, onScroll:Function}} opts
     */
    constructor(el, opts) {
      this.opts = opts;
      this.silent = false;
      this.cm = CodeMirror(el, {
        value: '',
        mode: { name: 'gfm', highlightFormatting: true, fencedCodeBlockHighlighting: true },
        lineWrapping: true,
        lineNumbers: false,
        tabSize: 2,
        indentUnit: 2,
        indentWithTabs: false,
        styleActiveLine: { nonEmpty: false },
        matchBrackets: true,
        placeholder: '开始输入 Markdown…  直接 ⌘V 粘贴截图即可插入图片',
        spellcheck: false,
        autocorrect: false,
        extraKeys: {
          Enter: 'newlineAndIndentContinueMarkdownList',
          Tab: (cm) => {
            if (cm.somethingSelected()) cm.execCommand('indentMore');
            else cm.replaceSelection(' '.repeat(cm.getOption('indentUnit')), 'end');
          },
          'Shift-Tab': 'indentLess',
          'Cmd-/': () => this.format('quote')
        }
      });

      this.cm.on('changes', () => {
        if (!this.silent) this.opts.onChange(this.getValue());
      });
      this.cm.on('cursorActivity', () => this.opts.onCursor && this.opts.onCursor(this.cm.getCursor()));
      this.cm.on('scroll', () => this.opts.onScroll && this.opts.onScroll());
      this.cm.on('paste', (cm, e) => this.handlePaste(e));
      this.cm.on('drop', (cm, e) => this.handleDrop(e));
    }

    /* ---------------- 内容 ---------------- */

    getValue() {
      return this.cm.getValue();
    }

    /** 载入新文档：重置撤销历史 */
    load(content) {
      this.silent = true;
      this.cm.setValue(content);
      this.cm.clearHistory();
      this.cm.setCursor(0, 0);
      this.cm.scrollTo(0, 0);
      this.silent = false;
    }

    /** 外部修改后重新载入，尽量保留光标与滚动位置 */
    reload(content) {
      const cursor = this.cm.getCursor();
      const info = this.cm.getScrollInfo();
      this.silent = true;
      this.cm.setValue(content);
      this.silent = false;
      this.cm.setCursor(cursor);
      this.cm.scrollTo(info.left, info.top);
    }

    focus() {
      this.cm.focus();
    }

    hasFocus() {
      return this.cm.hasFocus();
    }

    refresh() {
      this.cm.refresh();
    }

    setReadOnly(ro) {
      this.cm.setOption('readOnly', ro ? 'nocursor' : false);
    }

    applySettings(s) {
      const root = document.documentElement.style;
      root.setProperty('--editor-font-size', s.editorFontSize + 'px');
      root.setProperty('--editor-font', FONT_STACKS[s.editorFontFamily] || FONT_STACKS.mono);
      root.setProperty('--editor-line-height', String(s.lineHeight));
      this.cm.setOption('lineNumbers', !!s.lineNumbers);
      this.cm.setOption('lineWrapping', !!s.lineWrapping);
      const tab = Number(s.tabSize) || 2;
      this.cm.setOption('tabSize', tab);
      this.cm.setOption('indentUnit', tab);
      // 字号/字体变化后需要重新测量
      requestAnimationFrame(() => this.cm.refresh());
    }

    /* ---------------- 滚动同步 ---------------- */

    getScrollRatio() {
      const info = this.cm.getScrollInfo();
      const max = info.height - info.clientHeight;
      return max > 0 ? info.top / max : 0;
    }

    setScrollRatio(r) {
      const info = this.cm.getScrollInfo();
      this.cm.scrollTo(null, r * (info.height - info.clientHeight));
    }

    /* ---------------- 图片粘贴/拖拽 ---------------- */

    collectImageFiles(dt) {
      if (!dt) return [];
      const files = [];
      const seen = new Set();
      const push = (f) => {
        if (!f) return;
        const key = `${f.name}|${f.size}|${f.type}`;
        if (seen.has(key)) return;
        seen.add(key);
        files.push(f);
      };
      Array.from(dt.files || []).forEach(push);
      if (!files.length && dt.items) {
        Array.from(dt.items)
          .filter((it) => it.kind === 'file')
          .forEach((it) => push(it.getAsFile()));
      }
      return files.filter((f) => (f.type && f.type.startsWith('image/')) || isImage(f.name));
    }

    handlePaste(e) {
      const dt = e.clipboardData;
      if (!dt) return;
      const inCode = this.inCodeBlock();

      // 1. 表格（Excel / 在线表格 / 网页表格）→ Markdown 表格
      const convert = this.opts.shouldConvertTable ? this.opts.shouldConvertTable() : true;
      if (convert && !inCode) {
        let result = null;
        try {
          result = ME.tablePaste.fromClipboard(dt);
        } catch (err) {
          console.warn('[paste] table convert failed', err);
        }
        if (result && result.markdown) {
          e.preventDefault();
          this.insertBlock(result.markdown);
          ME.toast(`已粘贴为 Markdown 表格（${result.rows} 行 × ${result.cols} 列），⇧⌘V 可粘贴为纯文本`, 'success', 2600);
          return;
        }
        if (result && typeof result.plain === 'string') {
          // 单个单元格：按纯文本粘贴，避免 Office 附带的截图被当成图片插入
          e.preventDefault();
          this.cm.replaceSelection(result.plain.replace(/\n+/g, ' '));
          return;
        }
      }

      // 2. 图片
      const files = this.collectImageFiles(dt);
      if (!files.length) return; // 交给默认粘贴
      const hasDiskPath = files.some((f) => window.api.getPathForFile(f));
      const text = dt.getData('text/plain');
      // Office / WPS 等复制文字时会额外附带一张渲染截图；有文字且不是磁盘上的图片文件时按文字粘贴
      if (!hasDiskPath && text && text.trim()) return;
      if (inCode && text && text.trim()) return;
      e.preventDefault();
      this.cm.replaceSelection('');
      this.insertImages(files, this.cm.getCursor());
    }

    /** 光标是否位于 ``` / ~~~ 围栏代码块内 */
    inCodeBlock() {
      const line = this.cm.getCursor('from').line;
      let open = null;
      for (let i = 0; i < line; i++) {
        const m = /^ {0,3}(`{3,}|~{3,})/.exec(this.cm.getLine(i));
        if (!m) continue;
        if (!open) open = m[1];
        else if (m[1][0] === open[0] && m[1].length >= open.length) open = null;
      }
      return !!open;
    }

    /** 以独立块的形式插入（前后补空行，避免表格与相邻段落粘连） */
    insertBlock(text) {
      const cm = this.cm;
      const from = cm.getCursor('from');
      const to = cm.getCursor('to');
      const before = cm.getLine(from.line).slice(0, from.ch);
      const after = cm.getLine(to.line).slice(to.ch);
      let prefix = '';
      if (before.trim()) prefix = '\n\n';
      else if (from.line > 0 && cm.getLine(from.line - 1).trim()) prefix = '\n';
      let suffix = '';
      if (after.trim()) suffix = '\n\n';
      else if (to.line < cm.lastLine() && cm.getLine(to.line + 1).trim()) suffix = '\n';
      else if (to.line === cm.lastLine()) suffix = '\n';
      cm.operation(() => {
        if (before && !before.trim()) {
          // 去掉光标前的缩进，表格必须顶格
          cm.replaceRange('', { line: from.line, ch: 0 }, from);
        }
        cm.replaceSelection(prefix + text + suffix, 'end');
      });
      cm.scrollIntoView(null, 60);
      cm.focus();
    }

    pastePlain(text) {
      this.cm.replaceSelection(String(text || ''));
      this.cm.focus();
    }

    handleDrop(e) {
      const files = this.collectImageFiles(e.dataTransfer);
      if (!files.length) {
        // 非图片文件：交给应用处理（打开 md / 文件夹），不要把文件内容插入编辑器
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          e.preventDefault();
          if (this.opts.onDropFiles) this.opts.onDropFiles(Array.from(e.dataTransfer.files));
        }
        return;
      }
      e.preventDefault();
      const pos = this.cm.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
      this.cm.setCursor(pos);
      this.insertImages(files, pos);
    }

    async insertImages(files, pos) {
      const mdPath = this.opts.getFilePath();
      if (!mdPath) {
        ME.toast('请先打开或新建一个 Markdown 文件再粘贴图片', 'warn');
        return;
      }
      // 书签可在异步保存期间跟随文档变化
      const bookmark = this.cm.setBookmark(pos, { insertLeft: false });
      const snippets = [];
      for (const file of files) {
        try {
          const srcPath = window.api.getPathForFile(file);
          let saved;
          if (srcPath && isImage(srcPath)) {
            saved = await window.api.image.copyFile(mdPath, srcPath);
          } else {
            const buf = new Uint8Array(await file.arrayBuffer());
            saved = await window.api.image.saveData(mdPath, buf, file.type);
          }
          const alt = path.basename(saved.name).replace(/\.[^.]+$/, '');
          snippets.push(`![${alt}](${saved.relPath})`);
        } catch (err) {
          ME.toast('图片保存失败：' + err.message, 'error');
        }
      }
      const at = bookmark.find() || this.cm.getCursor();
      bookmark.clear();
      if (!snippets.length) return;
      const text = snippets.join('\n');
      this.cm.replaceRange(text, at);
      this.cm.setCursor({ line: at.line, ch: at.ch + text.length });
      this.cm.focus();
      ME.toast(`已插入 ${snippets.length} 张图片`, 'success', 1600);
    }

    /* ---------------- 格式命令 ---------------- */

    wrap(before, after = before, placeholder = '') {
      const cm = this.cm;
      const sels = cm.listSelections();
      cm.operation(() => {
        const texts = cm.getSelections().map((t) => {
          if (t.startsWith(before) && t.endsWith(after) && t.length >= before.length + after.length) {
            return t.slice(before.length, t.length - after.length);
          }
          return before + (t || placeholder) + after;
        });
        cm.replaceSelections(texts, 'around');
        // 无选区时把光标放到占位文本上
        if (sels.length === 1 && sels[0].empty() && placeholder) {
          const c = cm.getCursor('from');
          cm.setSelection({ line: c.line, ch: c.ch + before.length }, { line: c.line, ch: c.ch + before.length + placeholder.length });
        }
      });
      cm.focus();
    }

    format(kind) {
      const cm = this.cm;
      switch (kind) {
        case 'bold':
          return this.wrap('**', '**', '粗体');
        case 'italic':
          return this.wrap('*', '*', '斜体');
        case 'code':
          return this.wrap('`', '`', 'code');
        case 'link': {
          const t = cm.getSelection();
          if (/^https?:\/\//.test(t)) cm.replaceSelection(`[](${t})`);
          else {
            cm.replaceSelection(`[${t || '链接文字'}](https://)`);
            const c = cm.getCursor();
            cm.setSelection({ line: c.line, ch: c.ch - 9 }, { line: c.line, ch: c.ch - 1 });
          }
          cm.focus();
          return;
        }
        case 'quote': {
          const from = cm.getCursor('from').line;
          const to = cm.getCursor('to').line;
          cm.operation(() => {
            for (let l = from; l <= to; l++) {
              const line = cm.getLine(l);
              if (line.startsWith('> ')) cm.replaceRange('', { line: l, ch: 0 }, { line: l, ch: 2 });
              else cm.replaceRange('> ', { line: l, ch: 0 });
            }
          });
          cm.focus();
          return;
        }
        default:
      }
    }

    exec(cmd) {
      this.cm.execCommand(cmd);
    }
  }

  ME.Editor = Editor;
  ME.FONT_STACKS = FONT_STACKS;
})();
