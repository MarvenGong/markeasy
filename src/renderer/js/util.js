/* 通用工具：路径处理、防抖、图标 */
(function () {
  'use strict';

  const ME = (window.ME = window.ME || {});

  const MD_EXT = ['.md', '.markdown', '.mdown', '.mkd'];
  const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.avif', '.ico'];

  /**
   * 跨平台路径工具。主进程返回的都是系统原生路径：
   *   macOS / Linux：/Users/a/b.md
   *   Windows：      C:\Users\a\b.md 或 \\server\share\b.md
   * 这里只做字符串处理，与 Node 的 path 模块行为保持一致的子集。
   */
  function makePath(isWin) {
    const sep = isWin ? '\\' : '/';
    const SEP_RE = isWin ? /[\\/]/ : /\//;
    const isSep = (c) => c === '/' || (isWin && c === '\\');

    /** 根部分：'/'、'C:\'、'\\server\share\'；无根返回 '' */
    function rootOf(p) {
      const s = String(p || '');
      if (!isWin) return s.startsWith('/') ? '/' : '';
      let m = /^[A-Za-z]:[\\/]?/.exec(s);
      if (m) return m[0].slice(0, 2) + '\\';
      m = /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?/.exec(s);
      if (m) return m[0].replace(/\//g, '\\').replace(/\\?$/, '\\');
      return isSep(s[0]) ? '\\' : '';
    }

    /** 去掉末尾分隔符（根路径保留） */
    function trimEnd(p) {
      const s = String(p || '');
      const root = rootOf(s);
      let e = s.length;
      while (e > root.length && isSep(s[e - 1])) e--;
      return s.slice(0, Math.max(e, root.length)) || s;
    }

    const key = (p) => (isWin ? trimEnd(p).replace(/\//g, '\\').toLowerCase() : trimEnd(p));

    const api = {
      sep,
      isWin,
      rootOf,
      isAbsolute(p) {
        return !!rootOf(p) && (!isWin || /^([A-Za-z]:[\\/]|[\\/]{2})/.test(String(p)));
      },
      basename(p) {
        const s = trimEnd(p);
        if (s === rootOf(s)) return '';
        let i = s.length - 1;
        while (i >= 0 && !isSep(s[i])) i--;
        return s.slice(i + 1);
      },
      dirname(p) {
        const s = trimEnd(p);
        const root = rootOf(s);
        if (!s || s === root) return root || '.';
        let i = s.length - 1;
        while (i >= root.length && !isSep(s[i])) i--;
        if (i < root.length) return root || '.';
        return trimEnd(s.slice(0, i)) || root;
      },
      extname(p) {
        const b = api.basename(p);
        const i = b.lastIndexOf('.');
        return i > 0 ? b.slice(i).toLowerCase() : '';
      },
      join(...parts) {
        const list = parts.filter((x) => x !== undefined && x !== null && x !== '');
        if (!list.length) return '.';
        let out = String(list[0]);
        for (let i = 1; i < list.length; i++) {
          const seg = String(list[i]).replace(isWin ? /^[\\/]+/ : /^\/+/, '');
          out = isSep(out[out.length - 1]) ? out + seg : out + sep + seg;
        }
        return out;
      },
      /** 两个路径是否指向同一位置（Windows 不区分大小写与分隔符） */
      equals(a, b) {
        return key(a) === key(b);
      },
      /** a 是否等于 b 或位于 b 目录之下 */
      isInside(a, b) {
        if (!a || !b) return false;
        const ka = key(a);
        const kb = key(b);
        if (ka === kb) return true;
        const base = kb.endsWith(sep) ? kb : kb + sep;
        return ka.startsWith(base);
      },
      /** to 相对于 from 的路径（仅处理 to 在 from 之内的情况），统一用 / 便于展示 */
      relative(from, to) {
        if (!api.isInside(to, from)) return to;
        const base = trimEnd(from);
        return to
          .slice(base.length)
          .replace(isWin ? /^[\\/]+/ : /^\/+/, '')
          .split(SEP_RE)
          .join('/');
      },
      /** 本地路径 → file:// URL（每段做 URL 编码，保留 Windows 盘符） */
      toFileUrl(p) {
        let s = String(p || '');
        if (isWin) {
          s = s.replace(/\\/g, '/');
          if (s.startsWith('//')) {
            // UNC：\\server\share\a → file://server/share/a
            const parts = s.slice(2).split('/');
            return 'file://' + parts.map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');
          }
          const parts = s.split('/');
          return 'file:///' + parts.map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
        }
        return 'file://' + s.split('/').map(encodeURIComponent).join('/');
      },
      /**
       * 解析 Markdown 中引用的本地资源（图片 / 链接）为绝对路径。
       * 网络地址、锚点等返回 null。
       */
      resolveRef(src, baseDir) {
        if (!src || src.startsWith('#') || src.startsWith('//')) return null;
        let clean = String(src);
        const winAbs = isWin && /^[A-Za-z]:[\\/]/.test(clean);
        if (!winAbs && /^[a-z][a-z0-9+.-]*:/i.test(clean)) {
          if (!/^file:/i.test(clean)) return null; // http: mailto: data: ...
          try {
            clean = decodeURIComponent(new URL(clean).pathname);
            if (isWin) clean = clean.replace(/^\/([A-Za-z]:)/, '$1');
          } catch (_) {
            return null;
          }
        } else {
          clean = clean.split('#')[0].split('?')[0];
          try {
            clean = decodeURIComponent(clean);
          } catch (_) {}
        }
        let root;
        let rest;
        if (api.isAbsolute(clean)) {
          root = rootOf(clean);
          rest = clean.slice(root.length);
        } else if (isWin && isSep(clean[0])) {
          // \foo：相对于当前盘符根目录
          root = rootOf(baseDir);
          rest = clean;
        } else {
          root = rootOf(baseDir);
          rest = String(baseDir).slice(root.length) + sep + clean;
        }
        const out = [];
        for (const seg of rest.split(SEP_RE)) {
          if (!seg || seg === '.') continue;
          if (seg === '..') out.pop();
          else out.push(seg);
        }
        return root + out.join(sep);
      }
    };
    return api;
  }

  const IS_WIN = !!(window.api && window.api.platform === 'win32');
  const path = makePath(IS_WIN);

  function isMarkdown(p) {
    return MD_EXT.includes(path.extname(p));
  }
  function isImage(p) {
    return IMAGE_EXT.includes(path.extname(p));
  }
  function isHtml(p) {
    return ['.html', '.htm'].includes(path.extname(p));
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

  /* ---------------------------------------------------------------- 平台差异 */

  const IS_MAC = !!(window.api && window.api.platform === 'darwin');

  const platform = {
    isMac: IS_MAC,
    isWin: IS_WIN,
    /** 文件管理器名称 */
    fileManager: IS_MAC ? 'Finder' : IS_WIN ? '资源管理器' : '文件管理器',
    /** 回收站名称 */
    trash: IS_MAC ? '废纸篓' : '回收站',
    /**
     * 快捷键显示：'Mod+Shift+N' → macOS「⇧⌘N」/ 其它「Ctrl+Shift+N」
     * Mod = ⌘ / Ctrl，Alt = ⌥ / Alt
     */
    shortcut(spec) {
      const parts = String(spec).split('+');
      const keyName = parts.pop();
      const mods = new Set(parts.map((m) => m.toLowerCase()));
      if (IS_MAC) {
        let s = '';
        if (mods.has('ctrl')) s += '⌃';
        if (mods.has('alt')) s += '⌥';
        if (mods.has('shift')) s += '⇧';
        if (mods.has('mod')) s += '⌘';
        return s + keyName;
      }
      const out = [];
      if (mods.has('mod') || mods.has('ctrl')) out.push('Ctrl');
      if (mods.has('shift')) out.push('Shift');
      if (mods.has('alt')) out.push('Alt');
      out.push(keyName);
      return out.join('+');
    },
    /** 快捷键的 <kbd> 形式 */
    kbd(spec) {
      const text = platform.shortcut(spec);
      const keys = IS_MAC ? Array.from(text.match(/[⌃⌥⇧⌘]|.+$/g) || [text]) : text.split('+');
      return keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('');
    }
  };

  /**
   * 把页面上的平台相关文案替换为当前平台写法：
   *   data-shortcut="Mod+N"       → title 末尾追加 (⌘N) / (Ctrl+N)
   *   data-kbd="Mod+V"            → 内容替换为 <kbd> 组合
   *   data-fm-text / data-trash-text：文案中的 {fm} / {trash} 占位符
   */
  function localizePlatform(root = document) {
    root.querySelectorAll('[data-shortcut]').forEach((el) => {
      const base = el.dataset.titleBase || el.getAttribute('title') || '';
      el.dataset.titleBase = base;
      el.title = `${base} (${platform.shortcut(el.dataset.shortcut)})`;
    });
    root.querySelectorAll('[data-kbd]').forEach((el) => {
      el.innerHTML = platform.kbd(el.dataset.kbd);
    });
    root.querySelectorAll('[data-platform-text]').forEach((el) => {
      el.textContent = el.dataset.platformText.replace(/\{fm\}/g, platform.fileManager).replace(/\{trash\}/g, platform.trash);
    });
  }

  /** 统一换行符：编辑器内部始终用 \n，保存时还原文件原本的换行风格 */
  const eol = {
    detect(text) {
      return /\r\n/.test(text) ? '\r\n' : '\n';
    },
    normalize(text) {
      return String(text).replace(/\r\n?/g, '\n');
    },
    restore(text, style) {
      return style === '\r\n' ? String(text).replace(/\n/g, '\r\n') : String(text);
    }
  };

  Object.assign(ME, {
    path,
    makePath,
    platform,
    localizePlatform,
    eol,
    isMarkdown,
    isImage,
    isHtml,
    debounce,
    escapeHtml,
    formatTime,
    countWords,
    icons,
    mountIcons
  });
})();
