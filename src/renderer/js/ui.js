/* 弹窗与提示 */
(function () {
  'use strict';

  const ME = window.ME;

  /**
   * 输入框弹窗
   * @returns {Promise<string|null>} 用户输入；取消时为 null
   */
  function prompt({ title, desc = '', value = '', placeholder = '', okText = '确定', selectBase = true, validate } = {}) {
    const dlg = document.getElementById('prompt-dialog');
    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input');
    const err = document.getElementById('prompt-error');
    const btnOk = document.getElementById('prompt-ok');
    const btnCancel = document.getElementById('prompt-cancel');

    document.getElementById('prompt-title').textContent = title || '';
    document.getElementById('prompt-desc').textContent = desc;
    input.value = value;
    input.placeholder = placeholder;
    err.textContent = '';
    btnOk.textContent = okText;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        form.removeEventListener('submit', onSubmit);
        btnCancel.removeEventListener('click', onCancel);
        dlg.removeEventListener('cancel', onCancel);
        input.removeEventListener('input', onInput);
        if (dlg.open) dlg.close();
        resolve(result);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        const v = input.value.trim();
        const msg = validate ? validate(v) : v ? '' : '名称不能为空';
        if (msg) {
          err.textContent = msg;
          input.focus();
          return;
        }
        finish(v);
      };
      const onCancel = (e) => {
        if (e) e.preventDefault();
        finish(null);
      };
      const onInput = () => (err.textContent = '');

      form.addEventListener('submit', onSubmit);
      btnCancel.addEventListener('click', onCancel);
      dlg.addEventListener('cancel', onCancel);
      input.addEventListener('input', onInput);

      dlg.showModal();
      input.focus();
      // 默认只选中文件名主体（不含扩展名），方便直接改名
      const dot = value.lastIndexOf('.');
      if (selectBase && dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    });
  }

  function toast(message, type = 'info', duration = 2600) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, duration);
  }

  /** 原生询问框，返回按钮下标 */
  function ask(message, { detail = '', buttons = ['确定', '取消'], danger = false } = {}) {
    return window.api.dialog.ask({ message, detail, buttons, danger });
  }

  Object.assign(ME, { prompt, toast, ask });
})();
