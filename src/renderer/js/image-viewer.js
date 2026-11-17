/* 应用内图片查看器：适应窗口 / 原始大小切换，← → 浏览同目录图片 */
(function () {
  'use strict';

  const ME = window.ME;
  const { path } = ME;
  const $ = (id) => document.getElementById(id);

  function formatSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  class ImageViewer {
    /**
     * @param {{openExternal:Function}} opts
     */
    constructor(opts) {
      this.opts = opts;
      this.items = []; // [{ path?: 本地绝对路径, url?: 远程地址 }]
      this.index = 0;
      this.size = null;
      this.dlg = $('image-viewer');
      this.img = $('iv-img');
      this.stage = $('iv-stage');

      $('iv-close').addEventListener('click', () => this.close());
      $('iv-prev').addEventListener('click', () => this.go(-1));
      $('iv-next').addEventListener('click', () => this.go(1));
      $('iv-open').addEventListener('click', () => {
        const it = this.current();
        if (it) this.opts.openExternal(it);
      });
      $('iv-reveal').addEventListener('click', () => {
        const it = this.current();
        if (it && it.path) window.api.fs.reveal(it.path);
      });

      this.img.addEventListener('click', () => this.stage.classList.toggle('actual'));
      this.img.addEventListener('load', () => this.updateMeta());
      this.img.addEventListener('error', () => {
        if (this.img.getAttribute('src')) $('iv-meta').textContent = '无法加载该图片';
      });

      this.dlg.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.go(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.go(1);
        }
      });
      // 点击遮罩关闭
      this.dlg.addEventListener('click', (e) => {
        if (e.target === this.dlg) this.close();
      });
      this.dlg.addEventListener('close', () => this.img.removeAttribute('src'));
    }

    get isOpen() {
      return this.dlg.open;
    }

    current() {
      return this.items[this.index];
    }

    open(items, index = 0) {
      if (!items || !items.length) return;
      this.items = items;
      this.index = Math.max(0, Math.min(index, items.length - 1));
      if (!this.dlg.open) this.dlg.showModal();
      this.show();
    }

    close() {
      if (this.dlg.open) this.dlg.close();
    }

    go(delta) {
      const n = this.items.length;
      if (n < 2) return;
      this.index = (this.index + delta + n) % n;
      this.show();
    }

    show() {
      const it = this.current();
      const multi = this.items.length > 1;
      this.stage.classList.remove('actual');
      this.stage.scrollTo(0, 0);
      this.size = null;
      $('iv-meta').textContent = '';
      $('iv-name').textContent = it.path ? path.basename(it.path) : decodeURIComponent(path.basename(String(it.url).split(/[?#]/)[0]));
      $('iv-name').title = it.path || it.url;
      $('iv-counter').textContent = multi ? `${this.index + 1} / ${this.items.length}` : '';
      $('iv-prev').hidden = !multi;
      $('iv-next').hidden = !multi;
      $('iv-reveal').hidden = !it.path;
      this.img.src = it.path ? path.toFileUrl(it.path) : it.url;
      if (it.path) {
        window.api.fs
          .stat(it.path)
          .then((s) => {
            if (this.current() !== it) return;
            this.size = s.size;
            this.updateMeta();
          })
          .catch(() => {});
      }
    }

    updateMeta() {
      const parts = [];
      if (this.img.naturalWidth) parts.push(`${this.img.naturalWidth} × ${this.img.naturalHeight}`);
      if (this.size != null) parts.push(formatSize(this.size));
      $('iv-meta').textContent = parts.join(' · ');
    }
  }

  ME.ImageViewer = ImageViewer;
})();
