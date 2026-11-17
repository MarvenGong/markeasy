/*
 * 表格粘贴：把从 Excel / WPS / 企业微信微盘 / 腾讯文档 / 网页复制的表格转换为 Markdown 表格
 *
 * 剪贴板里通常同时有：
 *   text/html  —— <table> 结构（可识别表头、合并单元格、对齐）
 *   text/plain —— 制表符分隔（TSV），Excel 会对含换行/制表符的单元格加双引号
 *   image/png  —— Office 桌面端还会附带一张表格截图
 * 优先用 HTML 判断“这是一张表”，单元格内容在尺寸一致时以 TSV 为准（单元格内换行更准确）。
 */
(function () {
  'use strict';

  const ME = window.ME;

  /* ---------------------------------------------------------------- TSV */

  /** 按 Excel 规则解析 TSV（支持双引号包裹的多行单元格） */
  function parseQuotedTsv(text) {
    const s = text;
    const rows = [];
    let row = [];
    let cell = '';
    let inQuote = false;
    let atCellStart = true;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuote) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          cell += c;
        }
        continue;
      }
      if (c === '"' && atCellStart) {
        inQuote = true;
        atCellStart = false;
      } else if (c === '\t') {
        row.push(cell);
        cell = '';
        atCellStart = true;
      } else if (c === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        atCellStart = true;
      } else {
        cell += c;
        atCellStart = false;
      }
    }
    if (inQuote) return null; // 引号不配对，说明不是 Excel 风格的 TSV
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function parseSimpleTsv(text) {
    return text.split('\n').map((line) => line.split('\t'));
  }

  function isRectangular(rows) {
    return rows.length > 0 && rows.every((r) => r.length === rows[0].length);
  }

  /** 解析 TSV，返回二维数组；无法解析时返回 null */
  function parseTsv(text) {
    if (!text) return null;
    const s = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!s) return null;
    const quoted = parseQuotedTsv(s);
    if (quoted && isRectangular(quoted)) return quoted;
    const simple = parseSimpleTsv(s);
    if (isRectangular(simple)) return simple;
    return quoted || simple;
  }

  /* ---------------------------------------------------------------- HTML */

  const BLOCK_TAGS = /^(DIV|P|LI|UL|OL|H[1-6]|TR|BLOCKQUOTE|PRE)$/;

  function cellText(cell) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const tag = n.tagName;
      if (tag === 'BR') {
        out += '\n';
        return;
      }
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'TEMPLATE') return;
      if (n.style && n.style.display === 'none') return;
      const block = BLOCK_TAGS.test(tag);
      if (block && out && !out.endsWith('\n')) out += '\n';
      n.childNodes.forEach(walk);
      if (block && out && !out.endsWith('\n')) out += '\n';
    };
    cell.childNodes.forEach(walk);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');
  }

  function cellAlign(cell) {
    const a = String(cell.getAttribute('align') || (cell.style && cell.style.textAlign) || '').toLowerCase();
    if (a === 'left' || a === 'start') return 'left';
    if (a === 'center') return 'center';
    if (a === 'right' || a === 'end') return 'right';
    return '';
  }

  /** 把 <table> 展开为规整网格（处理 colspan / rowspan） */
  function tableToGrid(table) {
    const grid = [];
    const alignGrid = [];
    let headerRows = 0;
    Array.from(table.rows).forEach((tr, r) => {
      grid[r] = grid[r] || [];
      alignGrid[r] = alignGrid[r] || [];
      let c = 0;
      for (const cell of Array.from(tr.cells)) {
        while (grid[r][c] !== undefined) c++;
        const cs = Math.max(1, Math.min(100, parseInt(cell.getAttribute('colspan'), 10) || 1));
        const rs = Math.max(1, Math.min(1000, parseInt(cell.getAttribute('rowspan'), 10) || 1));
        const text = cellText(cell);
        const align = cellAlign(cell);
        for (let dr = 0; dr < rs; dr++) {
          grid[r + dr] = grid[r + dr] || [];
          alignGrid[r + dr] = alignGrid[r + dr] || [];
          for (let dc = 0; dc < cs; dc++) {
            grid[r + dr][c + dc] = dr === 0 && dc === 0 ? text : '';
            alignGrid[r + dr][c + dc] = align;
          }
        }
        c += cs;
      }
      const section = tr.parentElement && tr.parentElement.tagName;
      if (section === 'THEAD') headerRows = r + 1;
    });
    const cols = grid.reduce((m, row) => Math.max(m, row.length), 0);
    const cells = grid.map((row) => Array.from({ length: cols }, (_, i) => (row[i] === undefined ? '' : row[i])));
    // 列对齐：取表体中第一个显式设置的对齐方式
    const aligns = Array.from({ length: cols }, (_, i) => {
      for (let r = headerRows ? headerRows : 1; r < alignGrid.length; r++) {
        if (alignGrid[r] && alignGrid[r][i]) return alignGrid[r][i];
      }
      return (alignGrid[0] && alignGrid[0][i]) || '';
    });
    return { cells, aligns };
  }

  const compact = (s) => String(s || '').replace(/\s+/g, '');

  /** 从 HTML 中提取表格；若表格之外还有大量其它内容（如整段网页），返回 null 交给默认粘贴 */
  function htmlTables(html) {
    if (!html || !/<table[\s>]/i.test(html)) return null;
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (_) {
      return null;
    }
    const tables = Array.from(doc.querySelectorAll('table')).filter((t) => !t.parentElement || !t.parentElement.closest('table'));
    if (!tables.length) return null;
    doc.querySelectorAll('style, script, title, meta').forEach((n) => n.remove());
    const bodyLen = compact(doc.body ? doc.body.textContent : '').length;
    const tableLen = compact(tables.map((t) => t.textContent).join('')).length;
    if (bodyLen > 0 && tableLen / bodyLen < 0.9) return null;
    return tables.map(tableToGrid);
  }

  /* ---------------------------------------------------------------- 规整 & 输出 */

  /** 去掉末尾的全空行、全空列 */
  function trimGrid(grid) {
    const cells = grid.cells.map((r) => r.slice());
    const aligns = (grid.aligns || []).slice();
    const empty = (s) => !String(s).trim();
    while (cells.length && cells[cells.length - 1].every(empty)) cells.pop();
    let cols = cells.reduce((m, r) => Math.max(m, r.length), 0);
    while (cols > 0 && cells.every((r) => empty(r[cols - 1] || ''))) {
      cols--;
      cells.forEach((r) => (r.length = Math.min(r.length, cols)));
    }
    cells.forEach((r) => {
      while (r.length < cols) r.push('');
    });
    aligns.length = cols;
    return { cells, aligns, rows: cells.length, cols };
  }

  /** 显示宽度：中日韩全角字符按 2 计 */
  function displayWidth(s) {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      const wide =
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        cp >= 0x1f300;
      w += wide ? 2 : 1;
    }
    return w;
  }

  function escapeCell(s) {
    return String(s)
      .replace(/\r\n?/g, '\n')
      .trim()
      .replace(/\|/g, '\\|')
      .replace(/\n+/g, '<br>');
  }

  const MAX_PAD_WIDTH = 40;

  function toMarkdown(grid) {
    const { cells, aligns, cols } = grid;
    const rows = cells.map((r) => r.map(escapeCell));
    const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r) => displayWidth(r[c]))));
    // 内容太长时不做对齐填充，避免产生超长空白
    const pad = widths.every((w) => w <= MAX_PAD_WIDTH);
    const fmt = (text, c) => (pad ? text + ' '.repeat(widths[c] - displayWidth(text)) : text);
    const line = (r) => '| ' + r.map(fmt).join(' | ') + ' |';
    const sep = (c) => {
      const w = pad ? widths[c] : 3;
      const a = aligns[c];
      if (a === 'center') return ':' + '-'.repeat(Math.max(1, w - 2)) + ':';
      if (a === 'right') return '-'.repeat(Math.max(2, w - 1)) + ':';
      if (a === 'left') return ':' + '-'.repeat(Math.max(2, w - 1));
      return '-'.repeat(w);
    };
    const out = [line(rows[0]), '| ' + Array.from({ length: cols }, (_, c) => sep(c)).join(' | ') + ' |'];
    for (let i = 1; i < rows.length; i++) out.push(line(rows[i]));
    return out.join('\n');
  }

  /* ---------------------------------------------------------------- 入口 */

  /**
   * 分析剪贴板内容
   * @param {DataTransfer} dt
   * @returns {null | {markdown:string, rows:number, cols:number} | {plain:string}}
   *   markdown：应转换为表格；plain：是单个单元格，按纯文本粘贴；null：不处理
   */
  function fromClipboard(dt) {
    if (!dt) return null;
    const html = dt.getData('text/html');
    const plain = dt.getData('text/plain');

    const tables = htmlTables(html);
    if (tables && tables.length) {
      let grids = tables.map(trimGrid).filter((g) => g.rows > 0 && g.cols > 0);
      if (!grids.length) return null;
      if (grids.length === 1) {
        // 尺寸一致时采用 TSV 的单元格内容（保留单元格内换行与显示值）
        const tsv = parseTsv(plain);
        if (tsv && isRectangular(tsv)) {
          const t = trimGrid({ cells: tsv, aligns: grids[0].aligns });
          if (t.rows === grids[0].rows && t.cols === grids[0].cols) grids = [t];
        }
        const g = grids[0];
        if (g.rows === 1 && g.cols === 1) return { plain: g.cells[0][0] };
        return { markdown: toMarkdown(g), rows: g.rows, cols: g.cols };
      }
      const md = grids.map(toMarkdown).join('\n\n');
      return { markdown: md, rows: grids.reduce((n, g) => n + g.rows, 0), cols: Math.max(...grids.map((g) => g.cols)) };
    }

    // 只有纯文本：至少 2 行 2 列、每行列数一致的 TSV 才视为表格
    if (plain && plain.includes('\t')) {
      const rows = parseTsv(plain);
      if (rows && rows.length >= 2 && isRectangular(rows) && rows[0].length >= 2) {
        const g = trimGrid({ cells: rows, aligns: [] });
        if (g.rows >= 2 && g.cols >= 2) return { markdown: toMarkdown(g), rows: g.rows, cols: g.cols };
      }
    }
    return null;
  }

  ME.tablePaste = { fromClipboard, parseTsv, htmlTables, toMarkdown, trimGrid, displayWidth };
})();
