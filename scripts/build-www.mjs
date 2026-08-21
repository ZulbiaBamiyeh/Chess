// Stages the static site into www/ for Capacitor's webDir. There's no build
// step for the web game itself — this just copies the files the app
// actually loads at runtime and leaves out the repo's dev-only folders
// (test/, tools/, node_modules, .git, this script's own siblings).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const www = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const files = ['index.html'];
const dirs = ['css', 'js', 'assets', 'fonts', 'Music'];

for (const f of files) {
  const src = join(root, f);
  if (existsSync(src)) cpSync(src, join(www, f));
}
for (const d of dirs) {
  const src = join(root, d);
  if (existsSync(src)) cpSync(src, join(www, d), { recursive: true });
}

console.log(`Staged the site into ${www}`);
