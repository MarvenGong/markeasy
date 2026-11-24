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

    // Windows 风格 CRLF 文件：打开不算修改，保存后保持 CRLF
    const crlfFile = path.join(root, 'windows.md');
    fs.writeFileSync(crlfFile, '# Win\r\n\r\n第一行\r\n');
    await js(`window.__markeasy.openFile(${JSON.stringify(crlfFile)})`);
    await sleep(300);
    const crlfDirty = await js(`window.__markeasy.state.dirty`);
    await js(`(() => { const cm = window.__markeasy.editor.cm; cm.replaceRange('第二行\\n', { line: cm.lastLine(), ch: 0 }); })()`);
    await js(`window.__markeasy.save()`);
    await sleep(300);
    const crlfDisk = fs.readFileSync(crlfFile, 'utf8');
    check('CRLF 文件打开后不显示为已修改', crlfDirty === false);
    check('CRLF 文件保存后保持 CRLF 换行', crlfDisk === '# Win\r\n\r\n第一行\r\n第二行\r\n', JSON.stringify(crlfDisk));

    /* ---------------- HTML 单文件拖入 → assets + iframe 嵌入 ---------------- */
    const htmlSrcDir = path.join(root, '外部资料');
    fs.mkdirSync(htmlSrcDir, { recursive: true });
    const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><title>T</title></head>
<body style="margin:0;font-family:sans-serif"><div style="padding:24px;background:linear-gradient(135deg,#3b6fe0,#7c4dff);color:#fff;height:400px">
<h1>业务梳理看板</h1><p id="p">脚本未运行</p></div>
<script>
document.getElementById('p').textContent = '脚本已运行 · 渲染于 iframe 中';
let leak = '';
try { leak = parent.document.title ? '-LEAK' : ''; } catch (e) {}
try { if (typeof require !== 'undefined' || typeof window.api !== 'undefined') leak += '-NODE'; } catch (e) {}
document.title = 'EMBED_OK' + leak;
</script></body></html>`;
    const htmlSrc = path.join(htmlSrcDir, '业务 梳理.html');
    fs.writeFileSync(htmlSrc, pageHtml);
    const embedMd = path.join(root, '笔记', '嵌入测试.md');
    fs.writeFileSync(embedMd, '# 嵌入测试\n\n前文\n');
    await js(`window.__markeasy.openFile(${JSON.stringify(embedMd)})`);
    await sleep(300);
    await js(`(() => { const cm = window.__markeasy.editor.cm; cm.setCursor({ line: cm.lastLine(), ch: 0 }); })()`);

    // 1) 有磁盘路径：走 html:copyFile（与真实从 Finder 拖入相同的 IPC）
    const copied = await js(`window.api.html.copyFile(${JSON.stringify(embedMd)}, ${JSON.stringify(htmlSrc)})`);
    check('HTML 文件复制到 md 同级 assets 目录', copied.absPath === path.join(root, '笔记', 'assets', '业务-梳理.html') && fs.readFileSync(copied.absPath, 'utf8') === pageHtml, copied.absPath);
    fs.unlinkSync(copied.absPath);

    // 2) 模拟拖放事件（合成 File 无磁盘路径，走 html:saveData）
    const dropErr = await js(`(() => { try {
      const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(pageHtml)}], '业务 梳理.html', { type: 'text/html' }));
      const target = document.querySelector('.CodeMirror-scroll');
      const r = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.bottom - 20 }));
      return '';
    } catch (e) { return String(e && e.stack || e); } })()`);
    if (dropErr) console.log('drop error:', dropErr);
    await sleep(900);
    content = await js(`window.__markeasy.editor.getValue()`);
    const im = content.match(/<iframe src="(assets\/[^"]+\.html)" width="100%" height="600" frameborder="0"><\/iframe>/);
    check('拖入 HTML → 插入 iframe 片段', !!im, im ? im[0] : content);
    check('iframe 作为独立段落插入（前后空行）', /前文\n\n<iframe [^\n]+><\/iframe>\n/.test(content), JSON.stringify(content));
    const savedHtml = im ? path.join(root, '笔记', decodeURIComponent(im[1])) : '';
    check('拖入的 HTML 保存到 assets 且内容一致', !!savedHtml && fs.existsSync(savedHtml) && fs.readFileSync(savedHtml, 'utf8') === pageHtml, savedHtml);

    await sleep(800);
    const frameInfo = await js(`(() => { const f = document.querySelector('#preview .html-embed iframe'); return f && { src: f.src, sandbox: f.getAttribute('sandbox'), h: f.getBoundingClientRect().height, name: document.querySelector('#preview .html-embed-name').textContent }; })()`);
    check('预览区渲染 iframe（本地 file:// + 沙箱）', frameInfo && frameInfo.src.startsWith('file://') && frameInfo.sandbox === 'allow-scripts allow-popups allow-forms allow-modals' && frameInfo.h === 600, JSON.stringify(frameInfo));

    const findFrame = () => win.webContents.mainFrame.framesInSubtree.find((f) => f !== win.webContents.mainFrame && /\.html$/.test(decodeURIComponent(f.url)));
    let child = null;
    for (let i = 0; i < 20 && !child; i++) {
      child = findFrame();
      if (!child) await sleep(150);
    }
    const title = child ? await child.executeJavaScript('document.title') : '';
    check('iframe 内脚本正常运行', title.startsWith('EMBED_OK'), title);
    check('iframe 无法访问 MarkEasy 页面与 Node 接口（沙箱隔离）', title === 'EMBED_OK', title);

    // 编辑其它段落时 iframe 不重新加载
    if (child) await child.executeJavaScript('window.__alive = 42');
    await js(`window.__embedEl = document.querySelector('#preview iframe')`);
    await js(`(() => { const cm = window.__markeasy.editor.cm; cm.replaceRange('补充一段说明。', { line: 2, ch: 2 }); cm.replaceRange('\\n\\n## 新增小节\\n', { line: cm.lastLine(), ch: 0 }); })()`);
    await sleep(1200);
    const sameEl = await js(`document.querySelector('#preview iframe') === window.__embedEl && !!document.querySelector('#preview h2')`);
    const alive = child ? await findFrame().executeJavaScript('window.__alive').catch(() => null) : null;
    check('编辑其它内容时 iframe 保持不刷新', sameEl && alive === 42, `sameEl=${sameEl} alive=${alive}`);

    // 放大 / 还原
    await js(`document.querySelector('#preview .html-embed-bar button[data-act="max"]').click()`);
    await sleep(200);
    const maxInfo = await js(`(() => { const w = document.querySelector('#preview .html-embed'); const r = w.getBoundingClientRect(); return { max: w.classList.contains('is-max'), w: Math.round(r.width), vw: innerWidth, h: Math.round(r.height), vh: innerHeight, same: w.querySelector('iframe') === window.__embedEl }; })()`);
    const embedShot = process.env.MARKEASY_SCREENSHOT ? process.env.MARKEASY_SCREENSHOT.replace(/\.png$/, '-embed-max.png') : '';
    if (embedShot) fs.writeFileSync(embedShot, (await win.webContents.capturePage()).toPNG());
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(200);
    const restored = await js(`!document.querySelector('#preview .html-embed.is-max') && document.querySelector('#preview iframe') === window.__embedEl`);
    const alive2 = await findFrame().executeJavaScript('window.__alive').catch(() => null);
    check('放大铺满窗口、Esc 还原且不重新加载', maxInfo.max && maxInfo.w === maxInfo.vw && maxInfo.h === maxInfo.vh && maxInfo.same && restored && alive2 === 42, JSON.stringify(maxInfo) + ` restored=${restored} alive=${alive2}`);

    // 文件不存在 / 不安全的 src
    await js(`(() => { const cm = window.__markeasy.editor.cm; cm.replaceRange('\\n<iframe src="assets/不存在.html"></iframe>\\n\\n<iframe src="javascript:alert(1)"></iframe>\\n', { line: cm.lastLine(), ch: 0 }); })()`);
    await sleep(900);
    const errs = await js(`Array.from(document.querySelectorAll('#preview .html-embed.is-error')).map(e => e.textContent)`);
    const jsFrame = await js(`Array.from(document.querySelectorAll('#preview iframe')).some(f => /^javascript:/i.test(f.getAttribute('src') || ''))`);
    check('不存在的 HTML 显示提示、javascript: 地址被拦截', errs.length === 2 && errs.some((t) => t.includes('不存在')) && !jsFrame, JSON.stringify(errs));

    /* ---------------- 预览宽度 + 图片拖拽调整宽高 ---------------- */
    const sizeDir = path.join(root, '尺寸');
    fs.mkdirSync(path.join(sizeDir, 'assets'), { recursive: true });
    const bigBuf = Buffer.alloc(400 * 200 * 4, 0x99);
    fs.writeFileSync(path.join(sizeDir, 'assets', 'big.png'), nativeImage.createFromBitmap(bigBuf, { width: 400, height: 200 }).toPNG());
    const sizeMd = path.join(sizeDir, '尺寸.md');
    fs.writeFileSync(sizeMd, '# 尺寸\n\n![图](assets/big.png)\n\n文字 ![图](assets/big.png)\n\n```\n![图](assets/big.png)\n```\n');
    await js(`window.__markeasy.openFile(${JSON.stringify(sizeMd)})`);
    await js(`window.__markeasy.onMenuAction('view-mode', 'preview')`);
    await sleep(700);

    const widthOf = (mode) =>
      js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ previewWidth: '${mode}' }); m.preview.applySettings(m.state.settings); const p = document.getElementById('preview'); const pane = document.getElementById('preview-pane'); return { w: Math.round(p.getBoundingClientRect().width), pane: pane.clientWidth, max: getComputedStyle(p).maxWidth }; })()`);
    const wFull = await widthOf('full');
    const wWide = await widthOf('wide');
    const wNormal = await widthOf('normal');
    check('预览宽度：铺满 / 宽 1200 / 适中 860', wFull.w === wFull.pane && wWide.max === '1200px' && wNormal.max === '860px' && wNormal.w === 860, JSON.stringify({ wFull, wWide, wNormal }));

    // 拖拽手柄：模拟真实指针事件
    const dragHandle = (imgIdx, dir, dx, dy, shift = false) =>
      js(`(async () => {
        const img = document.querySelectorAll('#preview img')[${imgIdx}];
        img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const box = document.querySelector('.img-resizer');
        if (box.hidden) return 'overlay-hidden';
        const h = box.querySelector('.ir-${dir}');
        const r = h.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
        for (let i = 1; i <= 5; i++) document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + ${dx} * i / 5, clientY: y + ${dy} * i / 5, shiftKey: ${shift} }));
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + ${dx}, clientY: y + ${dy} }));
        return 'ok';
      })()`);
    const imgRects = () => js(`Array.from(document.querySelectorAll('#preview img')).map(i => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);

    let dr = await dragHandle(1, 'se', -200, 0);
    await sleep(900);
    content = await js(`window.__markeasy.editor.getValue()`);
    check('拖动右下角等比缩放 → 写回第 2 张为 <img> 宽高，其它不动', dr === 'ok' && content === '# 尺寸\n\n![图](assets/big.png)\n\n文字 <img src="assets/big.png" alt="图" width="200" height="100" />\n\n```\n![图](assets/big.png)\n```\n', dr + ' ' + JSON.stringify(content));
    let rects = await imgRects();
    check('预览按固定宽高显示', JSON.stringify(rects) === '[[400,200],[200,100]]', JSON.stringify(rects));

    dr = await dragHandle(1, 'e', 100, 0);
    await sleep(900);
    content = await js(`window.__markeasy.editor.getValue()`);
    rects = await imgRects();
    check('拖动右边只改宽度（不等比）', content.includes('<img src="assets/big.png" alt="图" width="300" height="100" />') && JSON.stringify(rects[1]) === '[300,100]', JSON.stringify(rects));

    dr = await dragHandle(0, 's', 0, 50);
    await sleep(900);
    content = await js(`window.__markeasy.editor.getValue()`);
    check('拖动下边只改高度', content.includes('\n\n<img src="assets/big.png" alt="图" width="400" height="250" />\n\n文字'), JSON.stringify(content));

    const viewerAfterDrag = await js(`document.getElementById('image-viewer').open`);
    check('拖拽不会误触发图片查看器', viewerAfterDrag === false);

    // 正文区变窄时按比例压缩，不变形
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ viewMode: 'split' }); m.onMenuAction('view-mode', 'split'); })()`);
    await js(`(() => { const cm = window.__markeasy.editor.cm; const v = cm.getValue().replace('width="400" height="250"', 'width="2000" height="1000"'); cm.setValue(v); })()`);
    await sleep(900);
    rects = await imgRects();
    check('宽度超出正文区时等比压缩', rects[0][0] < 2000 && Math.abs(rects[0][0] / rects[0][1] - 2) < 0.02, JSON.stringify(rects));
    await js(`window.__markeasy.onMenuAction('view-mode', 'preview')`);
    await sleep(500);

    // 双击手柄还原
    await js(`(() => {
      const img = document.querySelectorAll('#preview img')[1];
      img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      document.querySelector('.img-resizer .ir-se').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    })()`);
    await sleep(900);
    content = await js(`window.__markeasy.editor.getValue()`);
    check('双击手柄还原为 Markdown 图片语法', content.includes('文字 ![图](assets/big.png)\n'), JSON.stringify(content));
    await js(`window.__markeasy.save()`);
    await sleep(300);
    check('尺寸修改保存到磁盘', fs.readFileSync(sizeMd, 'utf8') === content);
    await js(`window.__markeasy.onMenuAction('view-mode', 'split')`);

    /* ---------------- 代码块复制 / 代码主题 / 设置 Tab ---------------- */
    const codeMd = path.join(sizeDir, '代码.md');
    fs.writeFileSync(codeMd, '# 代码\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\n```\nplain text\n```\n\n- 列表\n\n  ```py\n  print(1)\n  ```\n');
    await js(`window.__markeasy.openFile(${JSON.stringify(codeMd)})`);
    await sleep(600);
    const blocks = await js(`Array.from(document.querySelectorAll('#preview pre')).map(p => ({ btn: !!p.querySelector('.code-copy'), lang: (p.querySelector('.code-lang') || {}).textContent || '' }))`);
    check('代码块（含列表内嵌套）显示复制按钮与语言', JSON.stringify(blocks) === '[{"btn":true,"lang":"js"},{"btn":true,"lang":""},{"btn":true,"lang":"py"}]', JSON.stringify(blocks));
    await writeClip({ text: 'x' });
    await js(`document.querySelector('#preview pre .code-copy').click()`);
    await sleep(300);
    const clip = await clipboard.readText();
    const btnText = await js(`document.querySelector('#preview pre .code-copy').textContent`);
    check('点击复制 → 剪贴板为代码原文（不含按钮文字）', clip === 'const a = 1;\nconsole.log(a);' && btnText === '已复制', JSON.stringify(clip) + ' ' + btnText);
    await js(`(() => { const cm = window.__markeasy.editor.cm; cm.replaceRange('补充\\n', { line: cm.lastLine(), ch: 0 }); })()`);
    await sleep(800);
    const btnCount = await js(`document.querySelectorAll('#preview .code-copy').length`);
    check('编辑后代码块不重复添加按钮', btnCount === 3, String(btnCount));

    const themeInfo = (name) =>
      js(`(async () => {
        const m = window.__markeasy;
        m.state.settings = await window.api.settings.set({ codeTheme: '${name}' });
        await ME.codeTheme.apply('${name}');
        const pre = document.querySelector('#preview pre');
        return { href: document.getElementById('hljs-light').getAttribute('href').split('/styles/')[1], dark: document.getElementById('hljs-dark').getAttribute('href').split('/styles/')[1], bg: getComputedStyle(pre).backgroundColor, kw: getComputedStyle(pre.querySelector('.hljs-keyword')).color, def: document.body.classList.contains('code-theme-default') };
      })()`);
    const tGithub = await themeInfo('github');
    const tMonokai = await themeInfo('monokai');
    const tAtom = await themeInfo('atom-one');
    check('代码主题切换：Monokai 背景与关键字颜色生效', tMonokai.href === 'monokai-sublime.min.css' && tMonokai.bg === 'rgb(35, 36, 31)' && tMonokai.kw !== tGithub.kw && !tMonokai.def && tGithub.def, JSON.stringify({ tGithub, tMonokai }));
    check('代码主题：成对主题浅色/深色分别加载', tAtom.href === 'atom-one-light.min.css' && tAtom.dark === 'atom-one-dark.min.css', JSON.stringify(tAtom));
    await themeInfo('github');

    // 设置面板纵向 Tab
    await js(`window.__markeasy.onMenuAction('open-settings')`);
    await sleep(300);
    const tabInfo = await js(`(() => {
      const vis = () => Array.from(document.querySelectorAll('.settings-page')).filter(p => !p.hidden).map(p => p.dataset.page);
      const a = vis();
      document.querySelector('.settings-tab[data-tab="preview"]').click();
      const b = vis();
      const sample = !!document.querySelector('#code-theme-sample .hljs-keyword');
      const sel = document.querySelector('select[name="codeTheme"]').value;
      return { a, b, sample, sel, open: document.getElementById('settings-dialog').open };
    })()`);
    check('设置面板纵向 Tab 切换，且不关闭弹窗', JSON.stringify(tabInfo.a) === '["appearance"]' && JSON.stringify(tabInfo.b) === '["preview"]' && tabInfo.open, JSON.stringify(tabInfo));
    check('预览页显示代码主题选项与示例代码', tabInfo.sample && tabInfo.sel === 'github', JSON.stringify(tabInfo));
    await js(`(() => { const s = document.querySelector('select[name="codeTheme"]'); s.value = 'dracula'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(600);
    const saved = await js(`window.api.settings.get().then(s => ({ codeTheme: s.codeTheme, tab: s.settingsTab }))`);
    const draculaBg = await js(`getComputedStyle(document.querySelector('#preview pre')).backgroundColor`);
    check('在设置中选择主题即时生效并保存，记住上次 Tab', saved.codeTheme === 'dracula' && saved.tab === 'preview' && draculaBg !== tGithub.bg, JSON.stringify(saved) + ' ' + draculaBg);
    await js(`document.getElementById('settings-dialog').close()`);
    await js(`window.api.settings.set({ codeTheme: 'github' }).then(s => { window.__markeasy.state.settings = s; window.__markeasy.preview.applySettings(s); })`);
    await sleep(300);

    // 截图：分栏中的嵌入效果
    await js(`(() => { const cm = window.__markeasy.editor.cm; const v = cm.getValue(); cm.setValue(v.replace(/\\n<iframe src="assets\\/不存在[\\s\\S]*$/, '\\n')); })()`);
    await js(`window.__markeasy.save()`);
    await sleep(900);
    if (embedShot) fs.writeFileSync(embedShot.replace('-embed-max', '-embed'), (await win.webContents.capturePage()).toPNG());

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
