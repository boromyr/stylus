#!/usr/bin/env node
'use strict';

const fs = require('fs');
const archiver = require('archiver');

function createZip(suffix) {
  const MANIFEST = 'manifest.json';
  const ignore = [
    MANIFEST,
    '.*', // dot files/folders (glob, not regexp)
    'BUILD.md',
    'node_modules', // may be a symlink in old node.js
    'node_modules/**',
    'tools/**',
    'package.json',
    'package-lock.json',
    'yarn.lock',
    '*.zip',
    '*.map',
    'build/**',
    'merge.bat',
    '*.bak',
    'LICENSE',
    'minify.bat',
  ];
  try {
    ignore.push(...fs.readFileSync('.gitignore', 'utf8').split(/\r?\n/));
  } catch (e) {}
  const mj = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  delete mj.key;
  if (suffix === 'chrome') {
    delete mj.applications;
  } else if (suffix === 'chrome-beta') {
    delete mj.applications;
    mj.name = 'Stylus';
  } else {
    mj.options_ui = {
      /*
       * Linking to dashboard, not to options, because this is aimed at users who removed the icon
       * from the toolbar (they rarely use Stylus) so they visit about:addons instead.
       */
      page: 'manage.html',
      open_in_tab: true,
    };
  }
  const fileName = `stylus-${suffix}.zip`;
  const file = fs.createWriteStream(fileName);
  const archive = archiver('zip');
  archive.pipe(file);
  archive.glob('**', {ignore});
  archive.append(Buffer.from(JSON.stringify(mj, null, 2)), {name: MANIFEST});
  return archive.finalize();
}

(async () => {
  try {
    await Promise.all(['chrome'].map(createZip));
    console.log('\x1b[32m%s\x1b[0m', 'Stylus zip complete');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
