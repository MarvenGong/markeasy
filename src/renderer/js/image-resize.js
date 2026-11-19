/* 图片尺寸：在预览区拖拽调整宽高，并写回 Markdown 源码 */
(function () {
  'use strict';

  const ME = (window.ME = window.ME || {});

  /* ================================================================ 源码处理（纯函数，可单测） */

  const MD_IMAGE =
    /!\[((?:\\.|[^\]\\\n])*)\]\(\s*(<[^>\n]*>|(?:\\.|[^\s()\\]|\([^\s()]*\))+)(?:\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?\s*\)/g;
  const HTML_IMAGE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const ATTR = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (_) {
      return s;
    }
  }

  /** 统一比较用的地址：去掉尖括号、解码百分号编码、统一分隔符 */
  function normalizeSrc(src) {
    let s = String(src || '').trim();
    if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
    return safeDecode(s).replace(/\\/g, '/');
  }

  function unquote(v) {
    if (v === undefined) return '';
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
    return v;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function unescapeAttr(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  /** 代码区间（围栏代码块 + 行内代码），其中的图片语法不算数 */
  function codeRanges(source) {
    const ranges = [];
    const lines = source.split('\n');
    let offset = 0;
    let open = null;
    let openAt = 0;
    const textParts = []; // 非围栏区域，用于找行内代码
    let textStart = 0;
    for (const line of lines) {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (m) {
        if (!open) {
          open = m[1];
          openAt = offset;
          textParts.push([textStart, offset]);
        } else if (m[1][0] === open[0] && m[1].length >= open.length) {
          ranges.push([openAt, offset + line.length]);
          open = null;
          textStart = offset + line.length;
        }
      }
      offset += line.length + 1;
    }
    if (open) ranges.push([openAt, source.length]);
    else textParts.push([textStart, source.length]);
    const inline = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)|(`+)(?!`)[^`]\2(?!`)/g;
    for (const [a, b] of textParts) {
      const seg = source.slice(a, b);
      let m;
      inline.lastIndex = 0;
      while ((m = inline.exec(seg))) ranges.push([a + m.index, a + m.index + m[0].length]);
    }
    return ranges;
  }

  function parseAttrs(tag) {
    const inner = tag.replace(/^<img\b/i, '').replace(/\/?>$/, '');
    const attrs = [];
    let m;
    ATTR.lastIndex = 0;
    while ((m = ATTR.exec(inner))) attrs.push({ name: m[1].toLowerCase(), raw: m[0], value: unescapeAttr(unquote(m[2])) });
    return attrs;
  }

  /** 找出源码中所有图片（Markdown 语法与 <img> 标签），按出现顺序 */
  function findImages(source) {
    const src = String(source || '');
    const excluded = codeRanges(src);
    const inCode = (i) => excluded.some(([a, b]) => i >= a && i < b);
    const list = [];
    let m;
    MD_IMAGE.lastIndex = 0;
    while ((m = MD_IMAGE.exec(src))) {
      if (inCode(m.index)) continue;
      const rawSrc = m[2];
      list.push({
        kind: 'md',
        start: m.index,
        end: m.index + m[0].length,
        raw: m[0],
        alt: m[1].replace(/\\(.)/g, '$1'),
        src: rawSrc.startsWith('<') ? rawSrc.slice(1, -1) : rawSrc.replace(/\\(.)/g, '$1'),
        title: m[3] ? m[3].slice(1, -1) : ''
      });
    }
    HTML_IMAGE.lastIndex = 0;
    while ((m = HTML_IMAGE.exec(src))) {
      if (inCode(m.index)) continue;
      const attrs = parseAttrs(m[0]);
      const get = (n) => (attrs.find((a) => a.name === n) || {}).value;
      list.push({
        kind: 'html',
        start: m.index,
        end: m.index + m[0].length,
        raw: m[0],
        attrs,
        alt: get('alt') || '',
        src: get('src') || '',
        title: get('title') || ''
      });
    }
    return list.sort((a, b) => a.start - b.start);
  }

  /**
   * 定位预览区中第 index 张（同一地址的图片中）对应的源码位置。
   * count 为预览区中同地址图片的数量，与源码不一致时说明有无法识别的写法（如引用式图片），拒绝修改。
   */
  function locate(source, src, index, count) {
    const key = normalizeSrc(src);
    const same = findImages(source).filter((it) => normalizeSrc(it.src) === key);
    if (count !== undefined && same.length !== count) return null;
    return same[index] || null;
  }

  /** 生成替换文本；width/height 为空表示还原原始尺寸 */
  function buildReplacement(item, width, height) {
    const reset = !width || !height;
    if (item.kind === 'md') {
      if (reset) return item.raw;
      const src = item.src.replace(/ /g, '%20').replace(/"/g, '%22');
      const title = item.title ? ` title="${escapeAttr(item.title)}"` : '';
      return `<img src="${src}" alt="${escapeAttr(item.alt)}"${title} width="${width}" height="${height}" />`;
    }
    // <img> 标签：去掉旧尺寸（含 style 中的 width/height/zoom，Typora 会写 zoom）
    const kept = [];
    for (const a of item.attrs) {
      if (a.name === 'width' || a.name === 'height') continue;
      if (a.name === 'style') {
        const style = a.value
          .split(';')
          .map((d) => d.trim())
          .filter((d) => d && !/^(width|height|zoom|max-width|max-height)\s*:/i.test(d))
          .join('; ');
        if (style) kept.push({ name: 'style', raw: ` style="${escapeAttr(style)}"` });
        continue;
      }
      kept.push(a);
    }
    if (reset) {
      // 只剩 src/alt/title 时还原为 Markdown 语法，更干净
      if (kept.every((a) => ['src', 'alt', 'title'].includes(a.name)) && item.src && !/[\s()<>]/.test(item.src)) {
        const title = item.title ? ` "${item.title.replace(/"/g, '\\"')}"` : '';
        return `![${item.alt.replace(/([\\\]])/g, '\\$1')}](${item.src}${title})`;
      }
    }
    const selfClose = /\/\s*>$/.test(item.raw);
    const size = reset ? '' : ` width="${width}" height="${height}"`;
    return `<img${kept.map((a) => a.raw).join('')}${size}${selfClose ? ' />' : '>'}`;
  }

  ME.imageSize = { findImages, locate, buildReplacement, normalizeSrc };

  /* ================================================================ 预览区拖拽 */

  const MIN = 16;

  class ImageResizer {
    /**
     * @param {HTMLElement} pane 滚动容器（定位参照）
     * @param {HTMLElement} content 预览内容
     * @param {{canEdit:Function, onCommit:Function, onReset:Function}} opts
     */
    constructor(pane, content, opts) {
      this.pane = pane;
      this.content = content;
      this.opts = opts;
      this.img = null;
      this.drag = null;

      const box = document.createElement('div');
      box.className = 'img-resizer';
      box.hidden = true;
      box.innerHTML =
        '<span class="ir-size"></span>' +
        '<i class="ir-handle ir-e" data-dir="e" title="拖动调整宽度（双击还原原始尺寸）"></i>' +
        '<i class="ir-handle ir-s" data-dir="s" title="拖动调整高度（双击还原原始尺寸）"></i>' +
        '<i class="ir-handle ir-se" data-dir="se" title="拖动等比缩放，按住 Shift 自由调整（双击还原原始尺寸）"></i>';
      pane.appendChild(box);
      this.box = box;
      this.label = box.querySelector('.ir-size');

      pane.addEventListener('mouseover', (e) => this.onOver(e));
      pane.addEventListener('mouseleave', () => {
        if (!this.drag) this.hide();
      });
      pane.addEventListener('scroll', () => this.img && !this.drag && this.place());
      window.addEventListener('resize', () => this.hide());
      box.addEventListener('pointerdown', (e) => this.onDown(e));
      box.addEventListener('dblclick', (e) => {
        if (!e.target.classList.contains('ir-handle') || !this.img) return;
        e.preventDefault();
        e.stopPropagation();
        const img = this.img;
        this.hide();
        this.opts.onReset(img);
      });
      this.onMove = (e) => this.move(e);
      this.onUp = (e) => this.up(e);
    }

    resizable(el) {
      return (
        el &&
        el.tagName === 'IMG' &&
        this.content.contains(el) &&
        !el.classList.contains('broken') &&
        el.naturalWidth > 0 &&
        !!el.dataset.origSrc &&
        this.opts.canEdit()
      );
    }

    onOver(e) {
      if (this.drag) return;
      const t = e.target;
      if (this.box.contains(t)) return;
      if (this.resizable(t)) {
        if (t !== this.img) this.show(t);
      } else {
        this.hide();
      }
    }

    show(img) {
      this.img = img;
      this.box.hidden = false;
      this.place();
    }

    hide() {
      this.img = null;
      this.box.hidden = true;
    }

    place() {
      const img = this.img;
      if (!img || !img.isConnected) return this.hide();
      const r = img.getBoundingClientRect();
      const p = this.pane.getBoundingClientRect();
      Object.assign(this.box.style, {
        left: `${r.left - p.left + this.pane.scrollLeft}px`,
        top: `${r.top - p.top + this.pane.scrollTop}px`,
        width: `${r.width}px`,
        height: `${r.height}px`
      });
      this.label.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    }

    /** 内容区可用宽度（图片不能比正文区更宽） */
    maxWidth() {
      const cs = getComputedStyle(this.content);
      return this.content.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    }

    onDown(e) {
      const dir = e.target.dataset && e.target.dataset.dir;
      if (!dir || !this.img || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const r = this.img.getBoundingClientRect();
      this.drag = { dir, x: e.clientX, y: e.clientY, w: r.width, h: r.height, ratio: r.width / r.height, moved: false };
      this.box.classList.add('dragging');
      document.body.classList.add('img-resizing', `img-resizing-${dir}`);
      // 用 document 级监听而不是 pointer capture：拖出窗口边缘也能继续
      document.addEventListener('pointermove', this.onMove);
      document.addEventListener('pointerup', this.onUp);
    }

    move(e) {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      const maxW = Math.max(MIN, this.maxWidth());
      let w = d.w;
      let h = d.h;
      if (d.dir === 'e') w = d.w + dx;
      else if (d.dir === 's') h = d.h + dy;
      else if (e.shiftKey) {
        w = d.w + dx;
        h = d.h + dy;
      } else {
        // 等比：取变化更大的方向
        w = Math.abs(dx) / d.w >= Math.abs(dy) / d.h ? d.w + dx : (d.h + dy) * d.ratio;
        w = Math.min(Math.max(MIN, w), maxW);
        h = w / d.ratio;
      }
      w = Math.round(Math.min(Math.max(MIN, w), maxW));
      h = Math.round(Math.max(MIN, h));
      d.cw = w;
      d.ch = h;
      const s = this.img.style;
      s.aspectRatio = '';
      s.width = `${w}px`;
      s.height = `${h}px`;
      this.place();
    }

    up() {
      const d = this.drag;
      document.removeEventListener('pointermove', this.onMove);
      document.removeEventListener('pointerup', this.onUp);
      document.body.classList.remove('img-resizing', 'img-resizing-e', 'img-resizing-s', 'img-resizing-se');
      this.box.classList.remove('dragging');
      this.drag = null;
      if (!d || !this.img) return;
      const img = this.img;
      if (!d.moved || !d.cw) {
        this.place();
        return;
      }
      this.hide();
      this.opts.onCommit(img, d.cw, d.ch);
    }
  }

  ME.ImageResizer = ImageResizer;
})();
