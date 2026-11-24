/* 设置面板 */
(function () {
  'use strict';

  const ME = window.ME;

  const NUMERIC = new Set(['editorFontSize', 'previewFontSize', 'lineHeight', 'tabSize', 'autoSaveDelay']);

  class SettingsPanel {
    /**
     * @param {{getSettings:Function, update:Function, reset:Function}} opts
     */
    constructor(opts) {
      this.opts = opts;
      this.dlg = document.getElementById('settings-dialog');
      this.form = document.getElementById('settings-form');
      this.form.addEventListener('input', (e) => this.onField(e, true));
      this.form.addEventListener('change', (e) => this.onField(e, false));
      document.getElementById('settings-reset').addEventListener('click', async () => {
        const idx = await ME.ask('恢复默认设置？', { detail: '字号、字体、编辑器与文件相关设置将恢复为默认值。', buttons: ['恢复默认', '取消'] });
        if (idx !== 0) return;
        await this.opts.reset();
        this.fill();
      });
      // 点击遮罩关闭
      this.dlg.addEventListener('click', (e) => {
        if (e.target === this.dlg) this.dlg.close();
      });

      // 纵向 Tab
      this.tabs = Array.from(this.dlg.querySelectorAll('.settings-tab'));
      this.tabs.forEach((btn) => btn.addEventListener('click', () => this.showTab(btn.dataset.tab, true)));
      this.dlg.querySelector('.settings-tabs').addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const i = this.tabs.findIndex((b) => b.classList.contains('active'));
        const next = this.tabs[(i + (e.key === 'ArrowDown' ? 1 : this.tabs.length - 1)) % this.tabs.length];
        this.showTab(next.dataset.tab, true);
        next.focus();
      });
    }

    showTab(name, remember) {
      if (!this.tabs.some((b) => b.dataset.tab === name)) name = this.tabs[0].dataset.tab;
      this.tabs.forEach((b) => {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      this.dlg.querySelectorAll('.settings-page').forEach((p) => (p.hidden = p.dataset.page !== name));
      this.dlg.querySelector('.settings-body').scrollTop = 0;
      if (name === 'preview') ME.codeTheme.renderSample(document.querySelector('#code-theme-sample code'));
      if (remember && this.opts.rememberTab) this.opts.rememberTab(name);
    }

    open(tab) {
      this.fill();
      this.showTab(tab || this.opts.getSettings().settingsTab || 'appearance', !!tab);
      if (!this.dlg.open) {
        this.dlg.showModal();
        // showModal 会自动聚焦第一个按钮（关闭按钮）并显示焦点框，打开时不需要
        if (document.activeElement && this.dlg.contains(document.activeElement)) document.activeElement.blur();
      }
    }

    fill() {
      const s = this.opts.getSettings();
      Array.from(this.form.elements).forEach((el) => {
        if (!el.name || !(el.name in s)) return;
        if (el.type === 'checkbox') el.checked = !!s[el.name];
        else el.value = String(s[el.name]);
      });
      this.syncOutputs();
    }

    syncOutputs() {
      this.form.querySelectorAll('output[data-for]').forEach((o) => {
        const input = this.form.elements[o.dataset.for];
        const v = Number(input.value);
        o.textContent = o.dataset.for === 'lineHeight' ? v.toFixed(1) : `${v}px`;
      });
    }

    onField(e, isInput) {
      const el = e.target;
      if (!el.name) return;
      // 文本框只在 change 时提交，range 在拖动时实时生效
      if (isInput && el.type !== 'range') return;
      let value;
      if (el.type === 'checkbox') value = el.checked;
      else if (NUMERIC.has(el.name)) value = Number(el.value);
      else value = el.value.trim();
      if (el.name === 'imageFolder') {
        value = value.replace(/^[/\\]+|[/\\]+$/g, '');
        if (!value || value.split(/[/\\]/).includes('..')) value = 'assets';
        el.value = value;
      }
      this.syncOutputs();
      this.opts.update({ [el.name]: value });
    }
  }

  ME.SettingsPanel = SettingsPanel;
})();
