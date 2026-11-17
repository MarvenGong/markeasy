/* 通用工具：路径处理、防抖、图标 */
(function () {
  'use strict';

  const ME = (window.ME = window.ME || {});

  const MD_EXT = ['.md', '.markdown', '.mdown', '.mkd'];
  const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.avif', '.ico'];

  const path = {
    sep: '/',
    basename(p) {
      const s = String(p || '').replace(/\/+$/, '');
      return s.slice(s.lastIndexOf('/') + 1);
    },
    dirname(p) {
      const s = String(p || '').replace(/\/+$/, '');
      const i = s.lastIndexOf('/');
      if (i <= 0) return '/';
      return s.slice(0, i);
    },
    extname(p) {
      const b = path.basename(p);
      const i = b.lastIndexOf('.');
      return i > 0 ? b.slice(i).toLowerCase() : '';
    },
    join(...parts) {
      return parts
        .filter(Boolean)
        .join('/')
        .replace(/\/{2,}/g, '/');
    },
    /** a 是否等于 b 或位于 b 目录之下 */
    isInside(a, b) {
      return a === b || a.startsWith(b.endsWith('/') ? b : b + '/');
    },
    relative(from, to) {
      if (path.isInside(to, from)) return to.slice(from.length).replace(/^\//, '');
      return to;
    },
    toFileUrl(p) {
      return 'file://' + String(p).split('/').map(encodeURIComponent).join('/');
    },
    fromFileUrl(u) {
      try {
        return decodeURIComponent(new URL(u).pathname);
      } catch (_) {
        return '';
      }
    }
  };

  function isMarkdown(p) {
    return MD_EXT.includes(path.extname(p));
  }
  function isImage(p) {
    return IMAGE_EXT.includes(path.extname(p));
  }

  function debounce(fn, wait) {
    let t = null;
    const d = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
    d.cancel = () => clearTimeout(t);
    d.flush = function (...args) {
      clearTimeout(t);
      fn.apply(this, args);
    };
    return d;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function formatTime(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** 统计字数：中日韩字符按字计，其它按单词计 */
  function countWords(text) {
    const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const words = (text.replace(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9_\u00C0-\u024F'-]+/g) || []).length;
    return cjk + words;
  }

  const svg = (body, extra = '') =>
    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

  const icons = {
    chevron: svg('<path d="M9 6l6 6-6 6"/>'),
    folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    folderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 7v10a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L21.8 11a1 1 0 0 0-1-1.3H8.2a2 2 0 0 0-1.9 1.4L4 19"/>'),
    folderPlus: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    markdown: svg('<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M6 15V9l2.5 3L11 9v6M16 9v6M14 12.5l2 2.5 2-2.5"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 9"/>'),
    filePlus: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>'),
    collapse: svg('<path d="M7 9l5-5 5 5M7 15l5 5 5-5"/>', 'transform="rotate(0)"'),
    sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>')
  };

  function mountIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.getAttribute('data-icon');
      if (icons[name] && !el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', icons[name]);
    });
  }

  Object.assign(ME, { path, isMarkdown, isImage, debounce, escapeHtml, formatTime, countWords, icons, mountIcons });
})();
