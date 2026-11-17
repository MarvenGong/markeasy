/*
 * 端到端自测脚本（不随应用打包）
 * 用法：MARKEASY_USER_DATA=/tmp/me-ud MARKEASY_TEST_SCRIPT=scripts/e2e-test.js npx electron .
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { clipboard, nativeImage, ClipboardItem } = require('electron');

/** Electron 45 起 clipboard 为异步 Web 风格 API */
async function writeClip({ text, html, image } = {}) {
  const rec = {};
  if (text !== undefined) rec['text/plain'] = text;
  if (html !== undefined) rec['text/html'] = html;
  if (image) rec['image/png'] = new Blob([image.toPNG()], { type: 'image/png' });
  clipboard.clear();
  await clipboard.write([new ClipboardItem(rec)]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 生成 16x16 红色方块 PNG
function makePng() {
  const buf = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 0; // B
    buf[i + 1] = 0; // G
    buf[i + 2] = 255; // R
    buf[i + 3] = 255; // A
  }
  return nativeImage.createFromBitmap(buf, { width: 16, height: 16 });
}

module.exports = async function ({ app, win }) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  const js = (code) => win.webContents.executeJavaScript(code, true);

  try {
    // 准备多层级目录
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markeasy-e2e-'));
    fs.mkdirSync(path.join(root, '笔记', '2026', '十一月', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), '# 根目录\n\n```js\nconst a = 1;\n```\n\n- [x] 任务\n');
    fs.writeFileSync(path.join(root, '笔记', '2026', '十一月', 'deep', '深层.md'), '# 深层文件\n');
    fs.writeFileSync(path.join(root, 'ignore.txt'), 'x');

    await sleep(600);
    await js(`window.__markeasy.setRoot(${JSON.stringify(root)})`);
    await sleep(300);

    const rootRows = await js(`Array.from(document.querySelectorAll('.tree-row')).map(r => r.querySelector('.tree-name').textContent)`);
    check('文件树显示根目录内容（只显示 md 与目录）', rootRows.includes('README.md') && rootRows.includes('笔记') && !rootRows.includes('ignore.txt'), rootRows.join(','));

    // 逐级展开任意层级
    for (const seg of ['笔记', '2026', '十一月', 'deep']) {
      await js(`(() => { const r = Array.from(document.querySelectorAll('.tree-row')).find(r => r.querySelector('.tree-name').textContent === ${JSON.stringify(seg)}); r && r.click(); })()`);
      await sleep(150);
    }
    const deepRow = await js(`!!Array.from(document.querySelectorAll('.tree-row')).find(r => r.querySelector('.tree-name').textContent === '深层.md')`);
    check('多层级目录可逐级展开（4 层）', deepRow);

    // 新建文件（右键菜单的 new-file 动作走同一 IPC）
    const dir = path.join(root, '笔记', '2026');
    const created = await js(`window.api.fs.createFile(${JSON.stringify(dir)}, '测试文档')`);
    check('目录下新建文件（自动补 .md）', created === path.join(dir, '测试文档.md') && fs.existsSync(created), created);
    await sleep(500);
    const createdInTree = await js(`!!Array.from(document.querySelectorAll('.tree-row')).find(r => r.dataset.path === ${JSON.stringify(created)})`);
    check('新文件自动出现在文件树中（文件监听）', createdInTree);

    await js(`window.__markeasy.openFile(${JSON.stringify(created)})`);
    await sleep(300);
    const active = await js(`document.querySelector('.tree-row.active')?.dataset.path`);
    check('打开文件并在树中高亮', active === created);

    // 方式一：真实系统剪贴板 + 菜单粘贴
    await writeClip({ image: makePng() });
    await js(`(() => { const ed = window.__markeasy.editor; ed.cm.focus(); ed.cm.setCursor(ed.cm.lineCount(), 0); })()`);
    win.webContents.paste();
    await sleep(800);
    let content = await js(`window.__markeasy.editor.getValue()`);
    let m = content.match(/!\[[^\]]*\]\((assets\/[^)]+\.png)\)/);
    check('系统剪贴板粘贴截图 → 插入相对路径', !!m, m ? m[0] : content.slice(-120));
    if (m) {
      const abs = path.join(dir, decodeURIComponent(m[1]));
      check('图片保存在 md 同级 assets 目录', fs.existsSync(abs) && fs.statSync(abs).size > 0, abs);
    }

    // 方式二：构造 ClipboardEvent（模拟浏览器复制的图片）
    const pngB64 = makePng().toPNG().toString('base64');
    await js(`(async () => {
      const bytes = Uint8Array.from(atob('${pngB64}'), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      const ta = document.querySelector('.CodeMirror textarea');
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    })()`);
    await sleep(800);
    content = await js(`window.__markeasy.editor.getValue()`);
    const all = content.match(/!\[[^\]]*\]\(assets\/[^)]+\)/g) || [];
    check('ClipboardEvent 粘贴图片', all.length >= 2, `共 ${all.length} 处图片引用`);

    await sleep(1500); // 等待自动保存 + 预览渲染
    const disk = fs.readFileSync(created, 'utf8');
    check('自动保存写入磁盘', disk === content);

    const imgInfo = await js(`Array.from(document.querySelectorAll('#preview img')).map(i => ({ src: i.src, w: i.naturalWidth }))`);
    check('预览中图片按相对路径解析并成功加载', imgInfo.length >= 2 && imgInfo.every((i) => i.src.startsWith('file://') && i.w > 0), JSON.stringify(imgInfo[0] || {}));

    /* ---------------- 图片查看 ---------------- */
    const assetsDir = path.join(dir, 'assets');
    await js(`(async () => {
      const m = window.__markeasy;
      m.state.settings = await window.api.settings.set({ showAllFiles: true });
      await m.tree.refresh();
      await m.tree.expand(${JSON.stringify(assetsDir)});
      m.dryRunExternal = true;
    })()`);
    await sleep(200);
    const imgRows = await js(`Array.from(document.querySelectorAll('.tree-row.is-image')).map(r => r.dataset.path)`);
    check('文件树中显示 assets 下的图片', imgRows.length >= 2, `${imgRows.length} 张`);

    const clickRow = (p, detail) =>
      js(`document.querySelector('.tree-row[data-path=${JSON.stringify(JSON.stringify(p)).slice(1, -1)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: ${detail} }))`);
    const dblRow = (p) =>
      js(`document.querySelector('.tree-row[data-path=${JSON.stringify(JSON.stringify(p)).slice(1, -1)}]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))`);
    const viewerState = () =>
      js(`({ open: document.getElementById('image-viewer').open, w: document.getElementById('iv-img').naturalWidth, name: document.getElementById('iv-name').textContent, counter: document.getElementById('iv-counter').textContent, meta: document.getElementById('iv-meta').textContent })`);

    const toastsBefore = await js(`document.querySelectorAll('.toast').length`);
    await clickRow(imgRows[0], 1);
    await sleep(500);
    let vs = await viewerState();
    check('单击图片 → 应用内预览加载成功', vs.open && vs.w > 0 && vs.name === path.basename(imgRows[0]), JSON.stringify(vs));
    check('预览显示尺寸/大小与序号', /16 × 16/.test(vs.meta) && /B/.test(vs.meta) && vs.counter === `1 / ${imgRows.length}`, `${vs.meta} | ${vs.counter}`);
    const toastsAfter = await js(`Array.from(document.querySelectorAll('.toast')).slice(${toastsBefore}).map(t => t.textContent)`);
    check('不再提示“只能打开 Markdown 文件”', !toastsAfter.some((t) => t.includes('只能打开')), JSON.stringify(toastsAfter));

    await js(`document.getElementById('image-viewer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
    await sleep(300);
    vs = await viewerState();
    check('→ 切换到下一张', vs.name === path.basename(imgRows[1]) && vs.counter === `2 / ${imgRows.length}`, vs.name);
    await js(`document.getElementById('iv-close').click()`);
    await sleep(100);
    check('关闭查看器', !(await viewerState()).open);

    // 双击：click(1) + click(2) + dblclick → 用系统默认应用打开，且不弹出应用内预览
    await clickRow(imgRows[0], 1);
    await clickRow(imgRows[0], 2);
    await dblRow(imgRows[0]);
    await sleep(500);
    vs = await viewerState();
    const ext = await js(`window.__markeasy.lastExternal`);
    check('双击图片 → 调用系统默认应用打开', ext === imgRows[0] && !vs.open, `${ext} | viewerOpen=${vs.open}`);

    // 预览区点击图片
    await js(`document.querySelector('#preview img').click()`);
    await sleep(400);
    vs = await viewerState();
    check('点击预览区图片 → 打开查看器', vs.open && vs.w > 0, JSON.stringify(vs));
    if (process.env.MARKEASY_VIEWER_SHOT) {
      fs.writeFileSync(process.env.MARKEASY_VIEWER_SHOT, (await win.webContents.capturePage()).toPNG());
    }
    await js(`document.getElementById('iv-close').click()`);

    // 双击目录不会“展开又收起”
    const assetsOpenBefore = await js(`window.__markeasy.tree.expanded.has(${JSON.stringify(assetsDir)})`);
    await clickRow(assetsDir, 1);
    await clickRow(assetsDir, 2);
    await dblRow(assetsDir);
    await sleep(200);
    const assetsOpenAfter = await js(`window.__markeasy.tree.expanded.has(${JSON.stringify(assetsDir)})`);
    check('双击目录只切换一次展开状态', assetsOpenBefore !== assetsOpenAfter, `${assetsOpenBefore} → ${assetsOpenAfter}`);
    await js(`(async () => { const m = window.__markeasy; m.dryRunExternal = false; m.state.settings = await window.api.settings.set({ showAllFiles: false }); await m.tree.refresh(); })()`);

    /* ---------------- 表格粘贴 ---------------- */
    const pasteInto = async (initial, data) => {
      await js(`(() => { const cm = window.__markeasy.editor.cm; cm.setValue(${JSON.stringify(initial)}); cm.focus(); cm.setCursor(cm.lineCount(), 0); })()`);
      await writeClip(data);
      win.webContents.paste();
      await sleep(400);
      return js(`window.__markeasy.editor.getValue()`);
    };

    // Excel 桌面端风格：HTML + 带引号的 TSV + 附带截图
    const excelHtml =
      `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>.xl65{mso-number-format:General}</style></head><body>` +
      `<!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=300>\r\n` +
      ` <tr height=20>\r\n  <td height=20 class=xl65 width=87>姓名</td>\r\n  <td class=xl65 width=87>部门</td>\r\n  <td class=xl65>备注</td>\r\n </tr>\r\n` +
      ` <tr height=40>\r\n  <td height=40>张三</td>\r\n  <td>云发票</td>\r\n  <td>第一行<br style='mso-data-placement:same-cell;'>第二行</td>\r\n </tr>\r\n` +
      ` <tr height=20>\r\n  <td height=20>李四</td>\r\n  <td>A|B</td>\r\n  <td align=right>100</td>\r\n </tr>\r\n` +
      `<!--EndFragment--></table></body></html>`;
    const excelText = '姓名\t部门\t备注\r\n张三\t云发票\t"第一行\n第二行"\r\n李四\tA|B\t100\r\n';
    let v = await pasteInto('前文', { html: excelHtml, text: excelText, image: makePng() });
    const expectTable = ['| 姓名 | 部门   | 备注               |', '| ---- | ------ | -----------------: |', '| 张三 | 云发票 | 第一行<br>第二行 |', '| 李四 | A\\|B   | 100                |'];
    check('Excel 表格（含截图）粘贴为 Markdown 表格而非图片', v.includes('| 姓名 |') && !v.includes('!['), JSON.stringify(v));
    check('表格前自动补空行、单元格换行转 <br>、竖线转义', v.startsWith('前文\n\n| 姓名') && v.includes('第一行<br>第二行') && v.includes('A\\|B'), JSON.stringify(v));
    console.log('       实际输出:\n' + v.split('\n').map((l) => '       ' + l).join('\n'));
    void expectTable;

    await sleep(300);
    const tbl = await js(`(() => { const t = document.querySelector('#preview table'); return t ? { rows: t.rows.length, cols: t.rows[0].cells.length, br: !!t.querySelector('td br') } : null; })()`);
    check('预览渲染为 HTML 表格', tbl && tbl.rows === 3 && tbl.cols === 3 && tbl.br, JSON.stringify(tbl));

    // 在线表格风格：带合并单元格的 HTML，TSV 尺寸不一致
    const webHtml =
      `<meta charset="utf-8"><table><thead><tr><th colspan="2">季度</th><th>金额</th></tr></thead>` +
      `<tbody><tr><td><div>Q1</div></td><td><span>一月</span></td><td style="text-align:right">1,200</td></tr>` +
      `<tr><td>Q2</td><td>四月</td><td style="text-align:right">3,400</td></tr></tbody></table>`;
    v = await pasteInto('', { html: webHtml, text: '季度\t金额\nQ1\t一月\t1,200\nQ2\t四月\t3,400' });
    check('合并单元格表格展开、右对齐保留', /\| 季度 \|\s+\| 金额\s+\|/.test(v) && /-+: \|/.test(v) && v.includes('| Q2 '), JSON.stringify(v));

    // 只有纯文本 TSV
    v = await pasteInto('', { text: 'a\tb\tc\n1\t2\t3\n' });
    check('纯 TSV 文本粘贴为表格', v.startsWith('| a   | b   | c   |\n| --- | --- | --- |\n| 1   | 2   | 3   |'), JSON.stringify(v));

    // 单个单元格：纯文本，不插图片
    v = await pasteInto('x', { html: '<table><tr><td>单元格</td></tr></table>', text: '单元格\n', image: makePng() });
    check('单个单元格按纯文本粘贴', v === 'x单元格', JSON.stringify(v));

    // 普通网页内容（表格只占一小部分）不转换
    v = await pasteInto('', { html: '<p>' + '这是一段很长的正文内容。'.repeat(10) + '</p><table><tr><td>1</td><td>2</td></tr></table>', text: '正文\n1\t2' });
    check('表格只占一小部分的网页内容不做转换', !v.includes('| ---'), JSON.stringify(v.slice(0, 40)));

    // 代码块内不转换
    v = await pasteInto('```\n', { text: 'a\tb\n1\t2' });
    check('代码块内粘贴保持原样', v === '```\na\tb\n1\t2', JSON.stringify(v));

    // ⇧⌘V 粘贴为纯文本
    await js(`(() => { const cm = window.__markeasy.editor.cm; cm.setValue(''); cm.focus(); })()`);
    await writeClip({ html: excelHtml, text: 'a\tb\n1\t2' });
    await js(`window.__markeasy.onMenuAction('paste-plain')`);
    await sleep(200);
    v = await js(`window.__markeasy.editor.getValue()`);
    check('粘贴为纯文本不转换表格', v === 'a\tb\n1\t2', JSON.stringify(v));

    // 关闭设置后不转换
    await js(`window.__markeasy.state.settings.pasteTableAsMarkdown = false`);
    v = await pasteInto('', { text: 'a\tb\n1\t2' });
    check('关闭“粘贴表格转为 Markdown”后按原文粘贴', v === 'a\tb\n1\t2', JSON.stringify(v));
    await js(`window.__markeasy.state.settings.pasteTableAsMarkdown = true`);

    // 为截图准备一张表格
    await pasteInto('# 表格粘贴示例\n\n', { html: excelHtml, text: excelText });
    await js(`window.__markeasy.save()`);

    // 设置：字号
    await js(`window.api.settings.set({ editorFontSize: 20, previewFontSize: 18 }).then(s => { window.__markeasy.state.settings = s; })`);
    await js(`window.__markeasy.onMenuAction('font-size', 0)`); // 重置为 15
    await sleep(200);
    const fz = await js(`getComputedStyle(document.querySelector('.CodeMirror')).fontSize`);
    check('设置：编辑器字号生效', fz === '15px', fz);
    await js(`window.__markeasy.onMenuAction('font-size', 3)`);
    await sleep(200);
    const fz2 = await js(`getComputedStyle(document.querySelector('.CodeMirror')).fontSize`);
    check('设置：字号增大生效', fz2 === '18px', fz2);

    // 预览：代码高亮
    await js(`window.__markeasy.openFile(${JSON.stringify(path.join(root, 'README.md'))})`);
    await sleep(400);
    const hl = await js(`!!document.querySelector('#preview pre code.hljs .hljs-keyword')`);
    check('预览：代码块语法高亮', hl);

    // 截图
    await js(`window.__markeasy.openFile(${JSON.stringify(created)})`);
    await sleep(600);
    const shot = process.env.MARKEASY_SCREENSHOT;
    if (shot) {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(shot, image.toPNG());
      console.log('screenshot:', shot);
    }
    console.log('TEST_ROOT:', root);
  } catch (err) {
    check('脚本异常', false, err.stack);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  setTimeout(() => app.exit(failed ? 1 : 0), 200);
};
