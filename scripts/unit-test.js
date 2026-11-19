/*
 * 纯逻辑单元测试（Node 直接运行，不需要 Electron）
 * 用法：npm run test:unit
 * 重点覆盖 Windows 路径（在 macOS 上也能验证）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function loadUtil(platform) {
  const ctx = { window: { api: { platform } }, console, URL };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'util.js'), 'utf8'), ctx);
  return ctx.window.ME;
}

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS ', name);
  } catch (err) {
    fail++;
    console.log('FAIL ', name, '\n      ', err.message);
  }
}
const eq = (a, b) => assert.deepStrictEqual(a, b);

/* ---------------- Windows ---------------- */
const W = loadUtil('win32');
const wp = W.path;

t('win basename / dirname', () => {
  eq(wp.basename('C:\\Users\\me\\笔记\\a.md'), 'a.md');
  eq(wp.dirname('C:\\Users\\me\\笔记\\a.md'), 'C:\\Users\\me\\笔记');
  eq(wp.dirname('C:\\a.md'), 'C:\\');
  eq(wp.dirname('C:\\'), 'C:\\');
  eq(wp.basename('C:\\'), '');
  eq(wp.dirname('C:\\Users\\me\\'), 'C:\\Users');
  eq(wp.dirname('\\\\server\\share\\docs\\a.md'), '\\\\server\\share\\docs');
  eq(wp.dirname('\\\\server\\share\\a.md'), '\\\\server\\share\\');
  eq(wp.extname('C:\\x\\README.MD'), '.md');
});

t('win join', () => {
  eq(wp.join('C:\\Users', 'me', 'a.md'), 'C:\\Users\\me\\a.md');
  eq(wp.join('C:\\', 'a.md'), 'C:\\a.md');
});

t('win isInside / equals 不区分大小写与分隔符', () => {
  assert(wp.isInside('C:\\Users\\me\\a.md', 'C:\\Users\\me'));
  assert(wp.isInside('c:\\users\\ME\\a.md', 'C:\\Users\\me'));
  assert(wp.isInside('C:\\a.md', 'C:\\'));
  assert(!wp.isInside('C:\\Users\\meow\\a.md', 'C:\\Users\\me'));
  assert(wp.equals('C:\\Users\\me\\', 'c:/users/me'));
});

t('win relative 用 / 展示', () => {
  eq(wp.relative('C:\\notes', 'C:\\notes\\02 项目\\MarkEasy'), '02 项目/MarkEasy');
  eq(wp.relative('C:\\notes', 'C:\\notes'), '');
});

t('win toFileUrl 保留盘符', () => {
  eq(wp.toFileUrl('C:\\Users\\me\\笔记\\assets\\a b.png'), 'file:///C:/Users/me/%E7%AC%94%E8%AE%B0/assets/a%20b.png');
  eq(wp.toFileUrl('\\\\nas\\share\\x.png'), 'file://nas/share/x.png');
});

t('win resolveRef 相对路径', () => {
  const base = 'C:\\Users\\me\\笔记\\2026';
  eq(wp.resolveRef('assets/image-1.png', base), 'C:\\Users\\me\\笔记\\2026\\assets\\image-1.png');
  eq(wp.resolveRef('assets\\image-1.png', base), 'C:\\Users\\me\\笔记\\2026\\assets\\image-1.png');
  eq(wp.resolveRef('../a%20b.md', base), 'C:\\Users\\me\\笔记\\a b.md');
  eq(wp.resolveRef('./x.png?v=1#top', base), 'C:\\Users\\me\\笔记\\2026\\x.png');
  eq(wp.resolveRef('D:\\pics\\x.png', base), 'D:\\pics\\x.png');
  eq(wp.resolveRef('D:/pics/x.png', base), 'D:\\pics\\x.png');
  eq(wp.resolveRef('/pics/x.png', base), 'C:\\pics\\x.png');
  eq(wp.resolveRef('file:///D:/pics/x%20y.png', base), 'D:\\pics\\x y.png');
  eq(wp.resolveRef('https://a.com/x.png', base), null);
  eq(wp.resolveRef('#anchor', base), null);
  eq(wp.resolveRef('data:image/png;base64,xx', base), null);
});

t('win 快捷键显示', () => {
  eq(W.platform.shortcut('Mod+Shift+N'), 'Ctrl+Shift+N');
  eq(W.platform.shortcut('Mod+,'), 'Ctrl+,');
  eq(W.platform.kbd('Mod+V'), '<kbd>Ctrl</kbd><kbd>V</kbd>');
  eq(W.platform.fileManager, '资源管理器');
  eq(W.platform.trash, '回收站');
});

/* ---------------- macOS ---------------- */
const M = loadUtil('darwin');
const mp = M.path;

t('mac 路径', () => {
  eq(mp.dirname('/Users/me/a.md'), '/Users/me');
  eq(mp.dirname('/a.md'), '/');
  eq(mp.basename('/Users/me/笔记/'), '笔记');
  eq(mp.join('/Users/me', 'a.md'), '/Users/me/a.md');
  assert(mp.isInside('/Users/me/a.md', '/Users/me'));
  assert(!mp.isInside('/Users/Me/a.md', '/Users/me'), 'mac 区分大小写');
  eq(mp.relative('/n', '/n/a/b'), 'a/b');
  eq(mp.toFileUrl('/Users/me/a b.png'), 'file:///Users/me/a%20b.png');
  eq(mp.resolveRef('assets/x.png', '/Users/me/n'), '/Users/me/n/assets/x.png');
  eq(mp.resolveRef('../x.png', '/Users/me/n'), '/Users/me/x.png');
  eq(mp.resolveRef('/abs/x.png', '/Users/me/n'), '/abs/x.png');
  eq(mp.resolveRef('C:\\x.png', '/Users/me/n'), null, 'mac 上 C: 视为协议');
});

t('mac 快捷键显示', () => {
  eq(M.platform.shortcut('Mod+Shift+N'), '⇧⌘N');
  eq(M.platform.shortcut('Mod+Alt+F'), '⌥⌘F');
  eq(M.platform.kbd('Mod+V'), '<kbd>⌘</kbd><kbd>V</kbd>');
  eq(M.platform.fileManager, 'Finder');
});

/* ---------------- 换行符 ---------------- */
t('换行符检测与还原', () => {
  const crlf = '# a\r\n\r\nb\r\n';
  eq(M.eol.detect(crlf), '\r\n');
  eq(M.eol.detect('a\nb'), '\n');
  const norm = M.eol.normalize(crlf);
  eq(norm, '# a\n\nb\n');
  eq(M.eol.restore(norm, '\r\n'), crlf);
  eq(M.eol.restore(norm, '\n'), norm);
});

/* ---------------- 主进程：文件名校验 ---------------- */
const fsService = require('../src/main/fsService');
t('Windows 文件名校验', () => {
  const v = (n) => fsService.validateName(n, 'win32');
  eq(v('笔记.md'), '笔记.md');
  for (const bad of ['a<b.md', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'a:b', 'CON', 'con.md', 'LPT1.txt', 'a.']) {
    assert.throws(() => v(bad), undefined, bad);
  }
});
t('macOS 文件名校验', () => {
  const v = (n) => fsService.validateName(n, 'darwin');
  eq(v('a?b.md'), 'a?b.md');
  eq(v('CON.md'), 'CON.md');
  assert.throws(() => v('a/b'));
  assert.throws(() => v('a:b'));
});

/* ---------------- 图片尺寸写回 ---------------- */
const IS = (() => {
  const ctx = { window: { api: { platform: 'darwin' } }, console, URL };
  vm.createContext(ctx);
  for (const f of ['util.js', 'image-resize.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', f), 'utf8'), ctx);
  }
  return ctx.window.ME.imageSize;
})();
const resize = (src, imgSrc, index, count, w, h) => {
  const it = IS.locate(src, imgSrc, index, count);
  if (!it) return null;
  return src.slice(0, it.start) + IS.buildReplacement(it, w, h) + src.slice(it.end);
};

t('图片尺寸：Markdown 语法 → <img> 带宽高', () => {
  eq(resize('前文 ![截图](assets/a.png) 后文', 'assets/a.png', 0, 1, 320, 180), '前文 <img src="assets/a.png" alt="截图" width="320" height="180" /> 后文');
  eq(resize('![t](a.png "标题")', 'a.png', 0, 1, 10, 20), '<img src="a.png" alt="t" title="标题" width="10" height="20" />');
});
t('图片尺寸：中文路径按编码/未编码都能匹配', () => {
  eq(resize('![x](assets/%E4%B8%9A%E5%8A%A1.png)', 'assets/业务.png', 0, 1, 5, 6), '<img src="assets/%E4%B8%9A%E5%8A%A1.png" alt="x" width="5" height="6" />');
  eq(resize('![x](<assets/a b.png>)', 'assets/a%20b.png', 0, 1, 5, 6), '<img src="assets/a%20b.png" alt="x" width="5" height="6" />');
});
t('图片尺寸：同一图片出现多次时改第 N 个，跳过代码块', () => {
  const src = '![a](p.png)\n\n```\n![a](p.png)\n```\n\n`![a](p.png)` ![b](p.png)\n';
  eq(resize(src, 'p.png', 1, 2, 7, 8), '![a](p.png)\n\n```\n![a](p.png)\n```\n\n`![a](p.png)` <img src="p.png" alt="b" width="7" height="8" />\n');
  eq(resize(src, 'p.png', 0, 3, 7, 8), null); // 数量对不上（如引用式图片）时拒绝修改
});
t('图片尺寸：已有 <img> 更新宽高，保留其它属性，去掉 Typora 的 zoom', () => {
  eq(resize('<img src="a.png" alt="x" width="1" height="2" class="c">', 'a.png', 0, 1, 30, 40), '<img src="a.png" alt="x" class="c" width="30" height="40">');
  eq(resize('<img src="a.png" style="zoom:50%; border:1px solid red" />', 'a.png', 0, 1, 30, 40), '<img src="a.png" style="border:1px solid red" width="30" height="40" />');
});
t('图片尺寸：还原原始尺寸', () => {
  eq(resize('<img src="a.png" alt="x" title="t" width="1" height="2" />', 'a.png', 0, 1, null, null), '![x](a.png "t")');
  eq(resize('<img src="a.png" class="c" width="1" height="2">', 'a.png', 0, 1, null, null), '<img src="a.png" class="c">');
  eq(resize('![x](a.png)', 'a.png', 0, 1, null, null), '![x](a.png)');
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
