/*
 * 生成 README 用的界面截图（不随应用打包）
 * 用法：npm run screenshots   → 输出到 docs/screenshots/
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

const DEMO = `# 项目周报

本周完成 **MarkEasy** 的核心功能开发，支持本地 Markdown 编辑与实时预览。

## 进展

- [x] 文件树：任意层级目录，右键新建文件
- [x] 粘贴截图自动保存到 \`assets/\`
- [x] 从 Excel 复制表格，粘贴即转 Markdown 表格
- [ ] 导出 PDF

## 数据

| 模块     | 负责人 | 进度 |
| -------- | ------ | ---: |
| 文件树   | 张三   | 100% |
| 编辑器   | 李四   |  90% |
| 图片管理 | 王五   |  80% |

## 代码

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> 本地优先：所有文件都是普通的 .md，存在你自己的硬盘上。

![logo](assets/logo.png)
`;

/** HTML 嵌入演示：模拟 AI 工具生成的业务梳理单文件（纯内联，无外部依赖） */
const EMBED_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>订单履约业务梳理</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f7fb;color:#1f2937}
.wrap{padding:20px 22px}h1{margin:0 0 4px;font-size:20px}.sub{color:#6b7280;font-size:12px;margin-bottom:16px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.kpi{background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.kpi b{display:block;font-size:20px;margin-top:4px}.kpi span{font-size:12px;color:#6b7280}.up{color:#dc2626;font-size:12px}.down{color:#16a34a;font-size:12px}
.card{background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.06);margin-bottom:12px}
.card h2{font-size:14px;margin:0 0 12px}
.flow{display:flex;align-items:center;gap:6px}
.step{flex:1;text-align:center;padding:10px 4px;border-radius:8px;background:#eef2ff;color:#3730a3;font-size:13px;cursor:pointer;transition:.2s}
.step:hover,.step.on{background:#4f46e5;color:#fff}.arrow{color:#9ca3af}
.tip{margin-top:10px;font-size:12px;color:#4b5563;min-height:18px}
.bars{display:flex;align-items:flex-end;gap:14px;height:110px;padding-top:6px}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:11px;color:#6b7280}
.bar i{display:block;width:100%;border-radius:6px 6px 0 0;background:linear-gradient(#818cf8,#4f46e5);margin-bottom:4px}
</style></head><body><div class="wrap">
<h1>订单履约业务梳理</h1><div class="sub">由 AI 根据需求文档自动生成 · 点击流程节点查看说明</div>
<div class="kpis">
<div class="kpi"><span>日均订单</span><b>12,480</b><em class="up">▲ 8.2%</em></div>
<div class="kpi"><span>支付成功率</span><b>98.6%</b><em class="up">▲ 0.4%</em></div>
<div class="kpi"><span>开票及时率</span><b>99.1%</b><em class="up">▲ 1.3%</em></div>
<div class="kpi"><span>履约时长</span><b>26.5h</b><em class="down">▼ 2.1h</em></div>
</div>
<div class="card"><h2>主流程</h2><div class="flow" id="flow"></div><div class="tip" id="tip"></div></div>
<div class="card"><h2>各环节耗时（小时）</h2><div class="bars" id="bars"></div></div>
</div>
<script>
var steps=[["下单","用户提交订单，校验库存与优惠",1.2],["支付","调用支付网关，回调更新订单状态",0.3],["开票","支付成功后自动申请电子发票",0.8],["发货","仓库拣货出库，同步物流单号",14.6],["签收","用户确认收货，触发结算",9.6]];
var flow=document.getElementById("flow"),tip=document.getElementById("tip"),bars=document.getElementById("bars");
steps.forEach(function(s,i){
  if(i){var a=document.createElement("span");a.className="arrow";a.textContent="→";flow.appendChild(a)}
  var d=document.createElement("div");d.className="step"+(i===2?" on":"");d.textContent=s[0];
  d.onclick=function(){document.querySelectorAll(".step").forEach(function(x){x.classList.remove("on")});d.classList.add("on");tip.textContent=s[0]+"："+s[1]};
  flow.appendChild(d);
  var b=document.createElement("div");b.className="bar";b.innerHTML="<i style=\\"height:"+(s[2]/14.6*80+6)+"%\\"></i>"+s[0]+" "+s[2];bars.appendChild(b);
});
tip.textContent=steps[2][0]+"："+steps[2][1];
</script></body></html>`;

const EMBED_MD = `# 订单履约业务梳理

下面是用 AI 工具梳理需求后生成的业务看板，直接拖进编辑器即可嵌入：

<iframe src="assets/订单履约业务梳理.html" width="100%" height="560" frameborder="0"></iframe>

## 待确认事项

- 开票失败时是否允许重试
`;

module.exports = async function ({ app, win }) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log('saved', name);
  };

  try {
    fs.mkdirSync(OUT, { recursive: true });
    // 演示工作区
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'markeasy-demo-')), '我的笔记');
    const mk = (rel, content = '') => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (content !== null) fs.writeFileSync(p, content);
      return p;
    };
    mk('01 会议纪要/2026-11-10 周会.md', '# 周会\n');
    mk('01 会议纪要/2026-11-17 周会.md', '# 周会\n');
    const doc = mk('02 项目/MarkEasy/项目周报.md', DEMO);
    mk('02 项目/MarkEasy/需求清单.md', '# 需求清单\n');
    mk('03 学习/Electron 笔记.md', '# Electron\n');
    mk('README.md', '# 我的笔记\n');
    const assets = path.join(path.dirname(doc), 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'src', 'renderer', 'assets', 'logo.png'), path.join(assets, 'logo.png'));
    fs.copyFileSync(path.join(__dirname, '..', 'build', 'icon.png'), path.join(assets, 'icon-1024.png'));

    win.setSize(1280, 800);
    await js(`window.api.settings.set({ theme: 'light', viewMode: 'split', showAllFiles: false }).then(s => { window.__markeasy.state.settings = s; })`);
    await sleep(500);
    await js(`window.__markeasy.setRoot(${JSON.stringify(root)})`);
    await js(`window.__markeasy.openFile(${JSON.stringify(doc)})`);
    await js(`window.__markeasy.tree.expand(${JSON.stringify(path.join(root, '01 会议纪要'))})`);
    await js(`window.__markeasy.tree.setActive(${JSON.stringify(doc)})`);
    await js(`window.__markeasy.editor.cm.setCursor(3, 0)`);
    await sleep(800);
    await shot('main.png');

    // 设置面板
    await js(`window.__markeasy.onMenuAction('open-settings')`);
    await js(`document.querySelector('.settings-tab[data-tab="preview"]').click()`);
    await sleep(400);
    await shot('settings.png');
    await js(`document.querySelector('.settings-tab[data-tab="appearance"]').click()`);
    await js(`document.getElementById('settings-dialog').close()`);

    // 文件树显示图片 + 图片查看器
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ showAllFiles: true }); await m.tree.refresh(); await m.tree.expand(${JSON.stringify(assets)}); })()`);
    await sleep(300);
    await js(`document.querySelector('.tree-row[data-path=${JSON.stringify(JSON.stringify(path.join(assets, 'icon-1024.png'))).slice(1, -1)}]').click()`);
    await sleep(900);
    await shot('image-viewer.png');
    await js(`document.getElementById('iv-close').click()`);

    // HTML 页面嵌入
    const embedDoc = mk('02 项目/MarkEasy/订单履约业务梳理.md', EMBED_MD);
    fs.writeFileSync(path.join(assets, '订单履约业务梳理.html'), EMBED_HTML);
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ showAllFiles: false }); await m.tree.refresh(); })()`);
    await js(`window.__markeasy.openFile(${JSON.stringify(embedDoc)})`);
    await js(`window.__markeasy.tree.setActive(${JSON.stringify(embedDoc)})`);
    await js(`window.__markeasy.editor.cm.setCursor(2, 0)`);
    await sleep(1500);
    await shot('html-embed.png');

    // 预览区调整图片尺寸（预览模式 + 悬停显示手柄）
    fs.copyFileSync(path.join(OUT, 'main.png'), path.join(assets, '主界面.png'));
    const sizeDoc = mk(
      '02 项目/MarkEasy/产品截图.md',
      '# 产品截图\n\n悬停图片，拖动右边、下边或右下角的手柄即可调整显示尺寸，双击手柄还原。\n\n<img src="assets/主界面.png" alt="主界面" width="640" height="400" />\n'
    );
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ previewWidth: 'wide' }); m.preview.applySettings(m.state.settings); })()`);
    await js(`window.__markeasy.openFile(${JSON.stringify(sizeDoc)})`);
    await js(`window.__markeasy.tree.setActive(${JSON.stringify(sizeDoc)})`);
    await js(`window.__markeasy.onMenuAction('view-mode', 'preview')`);
    await sleep(1000);
    await js(`document.querySelector('#preview img').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    await sleep(200);
    await shot('image-resize.png');
    await js(`(async () => { const m = window.__markeasy; m.onMenuAction('view-mode', 'split'); m.state.settings = await window.api.settings.set({ previewWidth: 'normal' }); m.preview.applySettings(m.state.settings); })()`);

    // 代码块：主题 + 悬停显示复制按钮
    const codeDoc = mk(
      '03 学习/代码片段.md',
      '# 代码片段\n\n悬停代码块，右上角出现「复制」按钮。\n\n```js\n// 防抖：停止触发 wait 毫秒后才执行\nfunction debounce(fn, wait = 300) {\n  let timer = null;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}\n```\n\n```python\ndef fib(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n```\n'
    );
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ codeTheme: 'atom-one', previewWidth: 'normal' }); m.preview.applySettings(m.state.settings); })()`);
    await js(`window.__markeasy.openFile(${JSON.stringify(codeDoc)})`);
    await js(`window.__markeasy.tree.setActive(${JSON.stringify(codeDoc)})`);
    await js(`window.__markeasy.onMenuAction('view-mode', 'preview')`);
    await sleep(1000);
    const pt = await js(`(() => { const r = document.querySelector('#preview pre').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x, y: pt.y });
    await sleep(400);
    await shot('code-block.png');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
    await js(`(async () => { const m = window.__markeasy; m.onMenuAction('view-mode', 'split'); m.state.settings = await window.api.settings.set({ codeTheme: 'github' }); m.preview.applySettings(m.state.settings); })()`);
    await sleep(300);

    // 深色主题（回到周报文档）
    await js(`window.__markeasy.openFile(${JSON.stringify(doc)})`);
    await js(`window.__markeasy.tree.setActive(${JSON.stringify(doc)})`);
    // 深色主题
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ theme: 'dark', showAllFiles: false }); await m.tree.refresh(); })()`);
    await sleep(800);
    await shot('dark.png');

    await js(`window.api.settings.set({ theme: 'system' })`);
  } catch (err) {
    console.error(err);
    app.exit(1);
    return;
  }
  setTimeout(() => app.exit(0), 200);
};
