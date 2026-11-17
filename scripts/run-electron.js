#!/usr/bin/env node
/*
 * 跨平台启动 Electron（替代 `env -u X VAR=1 electron .` 这类只能在 macOS/Linux shell 用的写法）
 *
 *   node scripts/run-electron.js [--dev]
 *   node scripts/run-electron.js --test=scripts/e2e-test.js [--screenshot=out.png]
 *
 * --test       自动化脚本路径（设置 MARKEASY_TEST_SCRIPT），并使用独立的临时用户数据目录
 * --screenshot 自测截图输出路径（默认系统临时目录 markeasy-shot.png）
 * 其余参数原样传给 Electron。
 */
'use strict';

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const electronBin = require('electron'); // 在 Node 中 require 得到可执行文件路径

const env = { ...process.env };
// 某些宿主环境（如部分 IDE / Agent 终端）会设置该变量，导致 Electron 以纯 Node 模式运行
delete env.ELECTRON_RUN_AS_NODE;

const passThrough = [];
for (const arg of process.argv.slice(2)) {
  const m = /^--(test|screenshot)=(.+)$/.exec(arg);
  if (!m) {
    passThrough.push(arg);
    continue;
  }
  if (m[1] === 'test') {
    env.MARKEASY_TEST_SCRIPT = path.resolve(m[2]);
    const ud = path.join(os.tmpdir(), `markeasy-test-${path.basename(m[2], '.js')}`);
    fs.rmSync(ud, { recursive: true, force: true });
    env.MARKEASY_USER_DATA = ud;
    if (!env.MARKEASY_SCREENSHOT) env.MARKEASY_SCREENSHOT = path.join(os.tmpdir(), 'markeasy-shot.png');
  } else {
    env.MARKEASY_SCREENSHOT = path.resolve(m[2]);
  }
}

const root = path.join(__dirname, '..');
const child = spawn(electronBin, [root, ...passThrough], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code || 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
