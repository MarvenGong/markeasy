'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const IGNORED_NAMES = new Set(['.DS_Store', 'node_modules', '.git', '.svn', '.hg']);

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/avif': '.avif'
};

function isMarkdown(p) {
  return MD_EXT.has(path.extname(p).toLowerCase());
}

function isImage(p) {
  return IMAGE_EXT.has(path.extname(p).toLowerCase());
}

/** 读取单层目录（文件树按需懒加载） */
async function readDir(dir, { showHidden = false, showAll = false } = {}) {
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  const items = [];
  for (const d of dirents) {
    const name = d.name;
    if (IGNORED_NAMES.has(name)) continue;
    if (!showHidden && name.startsWith('.')) continue;
    const full = path.join(dir, name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        isDir = (await fsp.stat(full)).isDirectory();
      } catch (_) {
        continue; // 断开的软链接
      }
    }
    if (!isDir && !showAll && !isMarkdown(name)) continue;
    items.push({
      name,
      path: full,
      isDir,
      kind: isDir ? 'dir' : isMarkdown(name) ? 'markdown' : isImage(name) ? 'image' : 'file'
    });
  }
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
  return items;
}

function validateName(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('名称不能为空');
  if (n === '.' || n === '..') throw new Error('名称不合法');
  if (/[/\\:\0]/.test(n)) throw new Error('名称不能包含 / \\ : 等字符');
  return n;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch (_) {
    return false;
  }
}

async function createFile(dir, name) {
  let n = validateName(name);
  if (!path.extname(n)) n += '.md';
  const full = path.join(dir, n);
  if (await exists(full)) throw new Error(`“${n}” 已存在`);
  await fsp.mkdir(dir, { recursive: true });
  const title = path.basename(n, path.extname(n));
  const initial = isMarkdown(n) ? `# ${title}\n\n` : '';
  await fsp.writeFile(full, initial, { encoding: 'utf8', flag: 'wx' });
  return full;
}

async function createFolder(dir, name) {
  const n = validateName(name);
  const full = path.join(dir, n);
  if (await exists(full)) throw new Error(`“${n}” 已存在`);
  await fsp.mkdir(full);
  return full;
}

async function rename(oldPath, newName) {
  const n = validateName(newName);
  const target = path.join(path.dirname(oldPath), n);
  if (target === oldPath) return oldPath;
  // macOS 默认大小写不敏感：允许仅大小写变化的重命名
  if (target.toLowerCase() !== oldPath.toLowerCase() && (await exists(target))) {
    throw new Error(`“${n}” 已存在`);
  }
  await fsp.rename(oldPath, target);
  return target;
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function timestampName() {
  const d = new Date();
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `image-${ts}-${rand}`;
}

/** 生成不冲突的文件路径 */
async function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  let i = 1;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base}-${i}${ext}`);
    i += 1;
  }
  return candidate;
}

function sanitizeFolderName(folder) {
  const f = String(folder || 'assets').trim().replace(/^[/\\]+|[/\\]+$/g, '');
  if (!f || f.split(/[/\\]/).some((seg) => seg === '..')) return 'assets';
  return f;
}

/** 计算 Markdown 中可用的相对路径（POSIX 分隔符，对空格等字符做 URL 编码） */
function toMarkdownRelative(mdPath, filePath) {
  const rel = path.relative(path.dirname(mdPath), filePath).split(path.sep).join('/');
  return rel
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%40/g, '@'))
    .join('/');
}

/** 保存粘贴的图片二进制数据到 <md 所在目录>/<imageFolder>/ */
async function saveImageData(mdPath, data, mime, imageFolder) {
  if (!mdPath) throw new Error('请先打开一个 Markdown 文件');
  const ext = MIME_EXT[String(mime || '').toLowerCase()] || '.png';
  const dir = path.join(path.dirname(mdPath), sanitizeFolderName(imageFolder));
  await fsp.mkdir(dir, { recursive: true });
  const target = await uniquePath(dir, timestampName(), ext);
  await fsp.writeFile(target, Buffer.from(data));
  return { absPath: target, relPath: toMarkdownRelative(mdPath, target), name: path.basename(target) };
}

/** 复制已有图片文件（拖拽 / 从 Finder 复制）到 assets 目录 */
async function copyImageFile(mdPath, srcPath, imageFolder) {
  if (!mdPath) throw new Error('请先打开一个 Markdown 文件');
  if (!isImage(srcPath) && path.extname(srcPath).toLowerCase() !== '.tiff') {
    throw new Error('不支持的图片格式');
  }
  const dir = path.join(path.dirname(mdPath), sanitizeFolderName(imageFolder));
  // 图片已在目标 assets 目录内则直接引用
  if (path.dirname(srcPath) === dir) {
    return { absPath: srcPath, relPath: toMarkdownRelative(mdPath, srcPath), name: path.basename(srcPath) };
  }
  await fsp.mkdir(dir, { recursive: true });
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext).replace(/\s+/g, '-') || timestampName();
  const target = await uniquePath(dir, base, ext.toLowerCase());
  await fsp.copyFile(srcPath, target);
  return { absPath: target, relPath: toMarkdownRelative(mdPath, target), name: path.basename(target) };
}

module.exports = {
  readDir,
  createFile,
  createFolder,
  rename,
  exists,
  isMarkdown,
  isImage,
  saveImageData,
  copyImageFile,
  toMarkdownRelative
};
