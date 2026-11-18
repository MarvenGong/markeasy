/* 预览：marked 解析 + highlight.js 高亮 + DOMPurify 净化 + 本地图片路径解析 */
(function () {
  'use strict';

  const ME = window.ME;
  const { path, escapeHtml, isMarkdown } = ME;

  let slugCounts = new Map();

  function slugify(text) {
    const base =
      String(text)
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    const n = slugCounts.get(base) || 0;
    slugCounts.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  }

  const md = new marked.Marked({
    gfm: true,
    breaks: false,
    renderer: {
      code({ text, lang }) {
        const language = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
        let html;
        if (language && hljs.getLanguage(language)) {
          try {
            html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
          } catch (_) {
            html = escapeHtml(text);
          }
        } else {
          html = escapeHtml(text);
        }
        const cls = language ? ` class="hljs language-${escapeHtml(language)}"` : ' class="hljs"';
        return `<pre><code${cls}>${html}</code></pre>\n`;
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = slugify(inner);
        return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>\n`;
      }
    }
  });

  function splitFrontMatter(src) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
    if (!m) return { front: '', body: src };
    return { front: m[1], body: src.slice(m[0].length) };
  }

  /** 解析相对路径为本地绝对路径（兼容 Windows 盘符与反斜杠） */
  function resolveLocal(src, baseDir) {
    return path.resolveRef(src, baseDir);
  }

  const SANITIZE_OPTS = {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['target', 'allowfullscreen', 'frameborder'],
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['srcdoc']
  };

  /**
   * iframe 沙箱：
   * - 本地 HTML：允许脚本（图表、交互），但不给 same-origin，页面无法访问 MarkEasy 本身与本地文件
   * - 网络页面：与 MarkEasy 本就不同源，可放开 same-origin 以兼容常见嵌入（视频、文档等）
   */
  const SANDBOX_LOCAL = 'allow-scripts allow-popups allow-forms allow-modals';
  const SANDBOX_REMOTE = 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation';

  /** 返回 root 自身及其后代中匹配 selector 的元素 */
  function selectAll(root, selector) {
    if (root.nodeType !== 1) return [];
    const list = Array.from(root.querySelectorAll(selector));
    if (root.matches(selector)) list.unshift(root);
    return list;
  }

  function signatureOf(node) {
    if (node.nodeType === 1) return node.outerHTML;
    if (node.nodeType === 3) return '#text:' + node.textContent;
    return '#' + node.nodeType + ':' + node.textContent;
  }

  class Preview {
    /**
     * @param {HTMLElement} el 渲染容器
     * @param {HTMLElement} scroller 滚动容器
     * @param {{onOpenFile:Function, onScroll:Function}} opts
     */
    constructor(el, scroller, opts) {
      this.el = el;
      this.scroller = scroller;
      this.opts = opts;
      this.baseDir = '';
      /** 节点 → 渲染签名，用于增量更新（未变化的块保持原 DOM，iframe 不会重新加载） */
      this.sigs = new WeakMap();
      this.el.addEventListener('click', (e) => this.onClick(e));
      this.scroller.addEventListener('scroll', () => this.opts.onScroll && this.opts.onScroll());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.restoreMaximized();
      });
    }

    render(source, filePath) {
      const baseDir = filePath ? path.dirname(filePath) : '';
      // 目录变化后相对路径含义不同，不能复用旧节点
      if (baseDir !== this.baseDir) this.el.replaceChildren();
      this.baseDir = baseDir;
      slugCounts = new Map();
      const { front, body } = splitFrontMatter(source || '');
      let html = '';
      try {
        html = md.parse(body);
      } catch (err) {
        html = `<pre class="render-error">${escapeHtml(String(err))}</pre>`;
      }
      if (front) html = `<pre class="front-matter"><code>${escapeHtml(front)}</code></pre>` + html;
      const clean = DOMPurify.sanitize(html, SANITIZE_OPTS);
      // template 内容是惰性的：图片、iframe 在挂到页面前不会加载
      const tpl = document.createElement('template');
      tpl.innerHTML = clean;
      this.patch(Array.from(tpl.content.childNodes));
    }

    /**
     * 按顶层块增量更新：签名相同的旧节点原地保留（不移动，iframe 不会被重新加载），
     * 其余删除或插入新节点。
     */
    patch(fresh) {
      const old = Array.from(this.el.childNodes);
      let oi = 0;
      for (const node of fresh) {
        const sig = signatureOf(node);
        let found = -1;
        for (let j = oi; j < old.length && j < oi + 64; j++) {
          if (this.sigs.get(old[j]) === sig) {
            found = j;
            break;
          }
        }
        if (found >= 0) {
          for (let j = oi; j < found; j++) old[j].remove();
          oi = found + 1;
          continue;
        }
        const placed = this.prepare(node);
        this.sigs.set(placed, sig);
        const ref = oi < old.length ? old[oi] : null;
        this.el.insertBefore(placed, ref);
      }
      for (let j = oi; j < old.length; j++) old[j].remove();
    }

    clear() {
      this.el.replaceChildren();
      document.body.classList.remove('embed-maximized');
    }

    /** 处理新节点中的本地资源（在挂到页面之前调用），返回实际要插入的节点 */
    prepare(root) {
      if (root.nodeType !== 1) return root;
      if (this.baseDir) {
        selectAll(root, 'img[src], video[src], source[src]').forEach((node) => {
          const abs = resolveLocal(node.getAttribute('src'), this.baseDir);
          if (abs) {
            node.setAttribute('src', path.toFileUrl(abs));
            node.dataset.localPath = abs;
          }
        });
      }
      selectAll(root, 'img').forEach((img) => {
        img.loading = 'lazy';
        img.addEventListener(
          'error',
          () => {
            img.classList.add('broken');
            img.title = '图片加载失败：' + (img.dataset.localPath || img.getAttribute('src'));
          },
          { once: true }
        );
      });
      selectAll(root, 'input[type="checkbox"]').forEach((c) => (c.disabled = true));
      let out = root;
      selectAll(root, 'iframe').forEach((frame) => {
        const wrap = this.prepareIframe(frame);
        if (frame === root) out = wrap; // 顶层就是 iframe（HTML 块）时，插入包装后的容器
      });
      return out;
    }

    /** iframe：解析本地路径、强制沙箱、包一层带工具栏的容器 */
    prepareIframe(frame) {
      const raw = (frame.getAttribute('src') || '').trim();
      const wrap = document.createElement('div');
      wrap.className = 'html-embed';
      frame.replaceWith(wrap);

      let abs = null;
      let url = '';
      if (/^https:\/\//i.test(raw)) {
        url = raw;
      } else if (this.baseDir || path.isAbsolute(raw) || /^file:/i.test(raw)) {
        abs = resolveLocal(raw, this.baseDir);
        if (abs) url = path.toFileUrl(abs);
      }
      if (!url) {
        wrap.classList.add('is-error');
        wrap.textContent = raw ? `无法嵌入：${raw}（仅支持本地文件或 https 地址）` : '无法嵌入：iframe 缺少 src';
        return wrap;
      }

      const name = abs ? path.basename(abs) : raw.replace(/^https:\/\//i, '');
      if (abs) wrap.dataset.localPath = abs;
      else wrap.dataset.url = url;

      const bar = document.createElement('div');
      bar.className = 'html-embed-bar';
      const label = document.createElement('span');
      label.className = 'html-embed-name';
      label.textContent = name;
      label.title = abs || url;
      const actions = document.createElement('span');
      actions.className = 'html-embed-actions';
      [
        ['reload', '刷新', '重新加载页面'],
        ['max', '放大', '放大到整个窗口（Esc 还原）'],
        ['open', '浏览器打开', abs ? '用系统默认浏览器打开' : '在浏览器中打开']
      ].forEach(([act, text, title]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = act;
        b.textContent = text;
        b.title = title;
        actions.appendChild(b);
      });
      bar.append(label, actions);

      // 沙箱必须在挂载（开始加载）之前设置
      frame.setAttribute('sandbox', abs ? SANDBOX_LOCAL : SANDBOX_REMOTE);
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('src', url);
      if (!frame.getAttribute('height')) frame.setAttribute('height', '600');
      frame.removeAttribute('width'); // 宽度由样式控制，始终撑满
      wrap.append(bar, frame);

      if (abs) {
        window.api.fs
          .exists(abs)
          .then((ok) => {
            if (ok) return;
            wrap.classList.add('is-error');
            wrap.replaceChildren(document.createTextNode(`HTML 文件不存在：${abs}`));
          })
          .catch(() => {});
      }
      return wrap;
    }

    onEmbedAction(btn) {
      const wrap = btn.closest('.html-embed');
      const frame = wrap && wrap.querySelector('iframe');
      if (!frame) return;
      const act = btn.dataset.act;
      if (act === 'reload') {
        frame.src = frame.src; // eslint-disable-line no-self-assign
      } else if (act === 'max') {
        if (wrap.classList.contains('is-max')) this.restoreMaximized();
        else {
          this.restoreMaximized();
          wrap.classList.add('is-max');
          document.body.classList.add('embed-maximized');
          btn.textContent = '还原';
        }
      } else if (act === 'open') {
        if (wrap.dataset.localPath) this.opts.onOpenLocal && this.opts.onOpenLocal(wrap.dataset.localPath);
        else if (wrap.dataset.url) window.api.shell.openExternal(wrap.dataset.url);
      }
    }

    restoreMaximized() {
      this.el.querySelectorAll('.html-embed.is-max').forEach((w) => {
        w.classList.remove('is-max');
        const b = w.querySelector('button[data-act="max"]');
        if (b) b.textContent = '放大';
      });
      document.body.classList.remove('embed-maximized');
    }

    onClick(e) {
      const embedBtn = e.target.closest('.html-embed-bar button');
      if (embedBtn) {
        e.preventDefault();
        this.onEmbedAction(embedBtn);
        return;
      }
      const a = e.target.closest('a[href]');
      const img = e.target.closest('img');
      if (img && !a && this.opts.onImageClick) {
        const imgs = Array.from(this.el.querySelectorAll('img'));
        const items = imgs.map((i) => (i.dataset.localPath ? { path: i.dataset.localPath } : { url: i.src }));
        this.opts.onImageClick(items, imgs.indexOf(img));
        return;
      }
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        const target = this.el.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (/^(https?|mailto):/i.test(href)) {
        window.api.shell.openExternal(href);
        return;
      }
      const abs = resolveLocal(href, this.baseDir);
      if (!abs) return;
      if (isMarkdown(abs)) this.opts.onOpenFile(abs);
      else if (ME.isImage(abs) && this.opts.onImageClick) this.opts.onImageClick([{ path: abs }], 0);
      else if (this.opts.onOpenLocal) this.opts.onOpenLocal(abs);
    }

    getScrollRatio() {
      const max = this.scroller.scrollHeight - this.scroller.clientHeight;
      return max > 0 ? this.scroller.scrollTop / max : 0;
    }

    setScrollRatio(r) {
      this.scroller.scrollTop = r * (this.scroller.scrollHeight - this.scroller.clientHeight);
    }

    applySettings(s) {
      const root = document.documentElement.style;
      root.setProperty('--preview-font-size', s.previewFontSize + 'px');
      root.setProperty('--preview-font', ME.FONT_STACKS[s.previewFontFamily] || ME.FONT_STACKS.system);
      root.setProperty('--preview-line-height', String(s.lineHeight));
    }
  }

  ME.Preview = Preview;
  ME.resolveLocal = resolveLocal;
})();
