/* 文件树：任意层级目录，按需加载，支持右键菜单与外部变更自动刷新 */
(function () {
  'use strict';

  const ME = window.ME;
  const { path, icons } = ME;

  class FileTree {
    /**
     * @param {HTMLElement} el
     * @param {{onOpen:Function, onContextMenu:Function, onExpandChange:Function, getReadOpts:Function}} opts
     */
    constructor(el, opts) {
      this.el = el;
      this.opts = opts;
      this.root = null;
      this.children = new Map(); // dirPath -> items[]
      this.expanded = new Set();
      this.selected = null; // 当前高亮（点击/右键）
      this.active = null; // 当前打开的文件
      this.bind();
    }

    bind() {
      this.el.addEventListener('click', (e) => {
        const row = e.target.closest('.tree-row');
        if (!row) return;
        const p = row.dataset.path;
        this.setSelected(p);
        if (e.detail > 1) return; // 双击产生的第二次 click 不重复处理（否则目录会展开又收起）
        if (row.dataset.dir === '1') return this.toggle(p);
        const kind = row.dataset.kind;
        if (kind === 'markdown') return this.opts.onOpen(p, kind);
        if (kind === 'image') {
          // 单击：应用内预览；稍作延迟，以便双击时取消
          clearTimeout(this.clickTimer);
          this.clickTimer = setTimeout(() => this.opts.onPreview(p), 250);
        }
        // 其它类型文件：单击仅选中，双击用系统默认应用打开
      });

      this.el.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.tree-row');
        if (!row || row.dataset.dir === '1' || row.dataset.kind === 'markdown') return;
        clearTimeout(this.clickTimer);
        this.opts.onOpenExternal(row.dataset.path);
      });

      this.el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.root) return;
        const row = e.target.closest('.tree-row');
        if (!row) {
          this.opts.onContextMenu('root', this.root);
          return;
        }
        const p = row.dataset.path;
        this.setSelected(p);
        row.classList.add('context');
        const done = () => row.classList.remove('context');
        const kind = row.dataset.dir === '1' ? 'dir' : row.dataset.kind; // dir | markdown | image | file
        Promise.resolve(this.opts.onContextMenu(kind, p)).finally(done);
      });

      this.el.addEventListener('keydown', (e) => this.onKey(e));
    }

    onKey(e) {
      const rows = Array.from(this.el.querySelectorAll('.tree-row'));
      if (!rows.length) return;
      let idx = rows.findIndex((r) => r.dataset.path === this.selected);
      const row = rows[idx];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        idx = Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
        this.setSelected(rows[idx].dataset.path);
        rows[idx].scrollIntoView({ block: 'nearest' });
      } else if (row && e.key === 'ArrowRight' && row.dataset.dir === '1' && !this.expanded.has(row.dataset.path)) {
        this.toggle(row.dataset.path, true);
      } else if (row && e.key === 'ArrowLeft') {
        if (row.dataset.dir === '1' && this.expanded.has(row.dataset.path)) this.toggle(row.dataset.path, false);
        else if (path.dirname(row.dataset.path) !== this.root && path.isInside(row.dataset.path, this.root)) {
          this.setSelected(path.dirname(row.dataset.path));
        }
      } else if (row && e.key === 'Enter') {
        e.preventDefault();
        const kind = row.dataset.kind;
        if (row.dataset.dir === '1') this.toggle(row.dataset.path);
        else if (kind === 'markdown') this.opts.onOpen(row.dataset.path, kind);
        else if (kind === 'image') this.opts.onPreview(row.dataset.path);
        else this.opts.onOpenExternal(row.dataset.path);
      }
    }

    async setRoot(root, expandedList = []) {
      this.root = root;
      this.children.clear();
      this.expanded = new Set();
      this.selected = null;
      if (!root) {
        this.render();
        return;
      }
      await this.load(root);
      // 恢复上次展开的目录（由浅到深依次加载）
      const list = expandedList.filter((p) => p !== root && path.isInside(p, root)).sort((a, b) => a.length - b.length);
      for (const p of list) {
        if (!this.expanded.has(path.dirname(p)) && path.dirname(p) !== root) continue;
        if (await this.load(p)) this.expanded.add(p);
      }
      this.render();
    }

    async load(dir) {
      try {
        const items = await window.api.fs.readDir(dir, this.opts.getReadOpts());
        this.children.set(dir, items);
        return true;
      } catch (_) {
        this.children.delete(dir);
        this.expanded.delete(dir);
        return false;
      }
    }

    async toggle(dir, force) {
      const willExpand = force === undefined ? !this.expanded.has(dir) : force;
      if (willExpand) {
        await this.load(dir);
        this.expanded.add(dir);
      } else {
        this.expanded.delete(dir);
      }
      this.render();
      this.opts.onExpandChange(Array.from(this.expanded));
    }

    async expand(dir) {
      if (!this.root || !path.isInside(dir, this.root)) return;
      // 逐级展开祖先目录
      const chain = [];
      let cur = dir;
      while (cur !== this.root && path.isInside(cur, this.root)) {
        chain.unshift(cur);
        cur = path.dirname(cur);
      }
      for (const d of chain) {
        await this.load(d);
        this.expanded.add(d);
      }
      this.render();
      this.opts.onExpandChange(Array.from(this.expanded));
    }

    collapseAll() {
      this.expanded.clear();
      this.render();
      this.opts.onExpandChange([]);
    }

    /** 外部文件变化后刷新受影响的已加载目录 */
    async refresh(changedPaths) {
      if (!this.root) return;
      const dirs = new Set();
      if (!changedPaths) {
        dirs.add(this.root);
        this.expanded.forEach((d) => dirs.add(d));
      } else {
        for (const p of changedPaths) {
          const parent = path.dirname(p);
          if (parent === this.root || this.expanded.has(parent)) dirs.add(parent);
          if (p === this.root || this.expanded.has(p)) dirs.add(p);
        }
      }
      if (!dirs.size) return;
      await Promise.all(Array.from(dirs).map((d) => this.load(d)));
      // 清理已不存在的展开目录
      for (const d of Array.from(this.expanded)) {
        const parent = path.dirname(d);
        const siblings = this.children.get(parent);
        if (siblings && !siblings.some((it) => it.path === d)) {
          this.expanded.delete(d);
          this.children.delete(d);
        }
      }
      this.render();
    }

    /** 重命名后修正展开状态中的路径 */
    remapPath(oldPath, newPath) {
      const remap = (p) => (path.isInside(p, oldPath) ? newPath + p.slice(oldPath.length) : p);
      this.expanded = new Set(Array.from(this.expanded).map(remap));
      const next = new Map();
      this.children.forEach((v, k) => next.set(remap(k), v));
      this.children = next;
      if (this.selected) this.selected = remap(this.selected);
      if (this.active) this.active = remap(this.active);
    }

    setSelected(p) {
      this.selected = p;
      this.el.querySelectorAll('.tree-row.selected').forEach((r) => r.classList.remove('selected'));
      const row = this.findRow(p);
      if (row) row.classList.add('selected');
    }

    setActive(p) {
      this.active = p;
      this.el.querySelectorAll('.tree-row.active').forEach((r) => r.classList.remove('active'));
      const row = this.findRow(p);
      if (row) {
        row.classList.add('active');
        row.scrollIntoView({ block: 'nearest' });
      }
    }

    findRow(p) {
      if (!p) return null;
      return Array.from(this.el.querySelectorAll('.tree-row')).find((r) => r.dataset.path === p) || null;
    }

    render() {
      const scroll = this.el.scrollTop;
      this.el.innerHTML = '';
      if (!this.root) return;
      const frag = document.createDocumentFragment();
      this.renderLevel(this.root, 0, frag);
      if (!frag.childNodes.length) {
        const empty = document.createElement('div');
        empty.className = 'tree-hint';
        empty.textContent = '目录为空，右键新建文件';
        frag.appendChild(empty);
      }
      this.el.appendChild(frag);
      this.el.scrollTop = scroll;
    }

    renderLevel(dir, depth, container) {
      const items = this.children.get(dir) || [];
      for (const it of items) {
        const row = document.createElement('div');
        const open = it.isDir && this.expanded.has(it.path);
        row.className = 'tree-row' + (it.isDir ? ' is-dir' : ` is-${it.kind}`) + (open ? ' open' : '');
        if (it.path === this.selected) row.classList.add('selected');
        if (it.path === this.active) row.classList.add('active');
        row.dataset.path = it.path;
        row.dataset.dir = it.isDir ? '1' : '0';
        row.dataset.kind = it.kind;
        row.style.paddingLeft = 8 + depth * 14 + 'px';
        row.title = it.path;
        row.setAttribute('role', 'treeitem');

        const icon = it.isDir ? (open ? icons.folderOpen : icons.folder) : icons[it.kind] || icons.file;
        row.innerHTML =
          `<span class="twisty">${it.isDir ? icons.chevron : ''}</span>` +
          `<span class="tree-icon">${icon}</span>` +
          `<span class="tree-name"></span>`;
        row.querySelector('.tree-name').textContent = it.name;
        container.appendChild(row);

        if (open) this.renderLevel(it.path, depth + 1, container);
      }
    }
  }

  ME.FileTree = FileTree;
})();
