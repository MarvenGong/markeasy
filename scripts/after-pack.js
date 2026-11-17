'use strict';

/*
 * electron-builder afterPack 钩子：
 * 未配置开发者证书时对 .app 做 ad-hoc 签名，避免 Apple Silicon 上提示“已损坏，无法打开”。
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
