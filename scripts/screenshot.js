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
    await sleep(400);
    await shot('settings.png');
    await js(`document.getElementById('settings-dialog').close()`);

    // 文件树显示图片 + 图片查看器
    await js(`(async () => { const m = window.__markeasy; m.state.settings = await window.api.settings.set({ showAllFiles: true }); await m.tree.refresh(); await m.tree.expand(${JSON.stringify(assets)}); })()`);
    await sleep(300);
    await js(`document.querySelector('.tree-row[data-path=${JSON.stringify(JSON.stringify(path.join(assets, 'icon-1024.png'))).slice(1, -1)}]').click()`);
    await sleep(900);
    await shot('image-viewer.png');
    await js(`document.getElementById('iv-close').click()`);

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
