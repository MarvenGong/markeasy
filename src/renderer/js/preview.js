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
      this.el.addEventListener('click', (e) => this.onClick(e));
      this.scroller.addEventListener('scroll', () => this.opts.onScroll && this.opts.onScroll());
    }

    render(source, filePath) {
      this.baseDir = filePath ? path.dirname(filePath) : '';
      slugCounts = new Map();
      const { front, body } = splitFrontMatter(source || '');
      let html = '';
      try {
        html = md.parse(body);
      } catch (err) {
        html = `<pre class="render-error">${escapeHtml(String(err))}</pre>`;
      }
      if (front) html = `<pre class="front-matter"><code>${escapeHtml(front)}</code></pre>` + html;
      const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style'] });
      this.el.innerHTML = clean;
      this.fixLocalResources();
    }

    clear() {
      this.el.innerHTML = '';
    }

    fixLocalResources() {
      if (!this.baseDir) return;
      this.el.querySelectorAll('img[src], video[src], source[src]').forEach((node) => {
        const abs = resolveLocal(node.getAttribute('src'), this.baseDir);
        if (abs) {
          node.setAttribute('src', path.toFileUrl(abs));
          node.dataset.localPath = abs;
        }
      });
      this.el.querySelectorAll('img').forEach((img) => {
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
      this.el.querySelectorAll('input[type="checkbox"]').forEach((c) => (c.disabled = true));
    }

    onClick(e) {
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
