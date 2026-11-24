/* 代码块高亮主题：使用 highlight.js 自带的主题样式（@highlightjs/cdn-assets/styles） */
(function () {
  'use strict';

  const ME = (window.ME = window.ME || {});
  const BASE = '../../node_modules/@highlightjs/cdn-assets/styles/';

  /** light / dark 分别对应浅色、深色界面下使用的样式文件；两者相同即「固定主题」 */
  const THEMES = {
    github: { light: 'github', dark: 'github-dark' },
    'atom-one': { light: 'atom-one-light', dark: 'atom-one-dark' },
    vs: { light: 'vs', dark: 'vs2015' },
    stackoverflow: { light: 'stackoverflow-light', dark: 'stackoverflow-dark' },
    'tokyo-night': { light: 'tokyo-night-light', dark: 'tokyo-night-dark' },
    'rose-pine': { light: 'rose-pine-dawn', dark: 'rose-pine-moon' },
    solarized: { light: 'base16/solarized-light', dark: 'base16/solarized-dark' },
    gruvbox: { light: 'base16/gruvbox-light-medium', dark: 'base16/gruvbox-dark-medium' },
    monokai: { light: 'monokai-sublime', dark: 'monokai-sublime' },
    dracula: { light: 'base16/dracula', dark: 'base16/dracula' },
    nord: { light: 'nord', dark: 'nord' },
    'night-owl': { light: 'night-owl', dark: 'night-owl' },
    'github-dimmed': { light: 'github-dark-dimmed', dark: 'github-dark-dimmed' },
    xcode: { light: 'xcode', dark: 'xcode' },
    intellij: { light: 'intellij-light', dark: 'intellij-light' }
  };
  const DEFAULT = 'github';

  const SAMPLE = `// 代码块主题预览
async function fetchInvoice(id) {
  const res = await fetch(\`/api/invoice/\${id}\`);
  if (!res.ok) throw new Error('请求失败: ' + res.status);
  return { ...(await res.json()), fetchedAt: Date.now() };
}`;

  let current = null;
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function linkLoaded(link) {
    return new Promise((resolve) => {
      if (link.sheet && link.dataset.loaded === link.getAttribute('href')) return resolve();
      const done = () => {
        link.dataset.loaded = link.getAttribute('href');
        resolve();
      };
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', done, { once: true });
    });
  }

  /** 读取当前生效主题的背景色 / 前景色，写入 CSS 变量供代码块容器使用 */
  function syncColors() {
    const probe = document.createElement('code');
    probe.className = 'hljs';
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const bg = cs.backgroundColor;
    const fg = cs.color;
    probe.remove();
    const root = document.documentElement.style;
    const transparent = !bg || bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg);
    root.setProperty('--code-bg', transparent ? 'var(--bg-soft)' : bg);
    root.setProperty('--code-fg', fg || 'var(--text)');
    document.body.classList.toggle('code-theme-default', current === DEFAULT);
  }

  async function apply(name) {
    const key = THEMES[name] ? name : DEFAULT;
    const t = THEMES[key];
    current = key;
    const light = document.getElementById('hljs-light');
    const dark = document.getElementById('hljs-dark');
    const waits = [];
    for (const [link, file] of [
      [light, t.light],
      [dark, t.dark]
    ]) {
      const href = BASE + file + '.min.css';
      if (link.getAttribute('href') !== href) {
        link.setAttribute('href', href);
        waits.push(linkLoaded(link));
      }
    }
    await Promise.all(waits);
    syncColors();
  }

  /** 设置面板中的示例代码 */
  function renderSample(el) {
    if (!el || el.dataset.ready) return;
    el.innerHTML = window.hljs ? hljs.highlight(SAMPLE, { language: 'javascript' }).value : ME.escapeHtml(SAMPLE);
    el.dataset.ready = '1';
  }

  // 浅色 / 深色切换后，生效的样式表随 media 变化，重新读取颜色
  darkQuery.addEventListener('change', () => current && syncColors());

  ME.codeTheme = { THEMES, DEFAULT, apply, renderSample, get current() { return current; } };
})();
