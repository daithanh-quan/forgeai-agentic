#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(process.cwd());
const templateDir = path.resolve(__dirname, '../templates');

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const dryRun = args.has('--dry-run');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!dryRun) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) copyRecursive(path.join(src, item), path.join(dest, item));
    return;
  }
  if (fs.existsSync(dest) && !force) {
    console.log(`skip ${path.relative(root, dest)} already exists. Use --force to overwrite.`);
    return;
  }
  if (dryRun) console.log(`would create ${path.relative(root, dest)}`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`created ${path.relative(root, dest)}`);
  }
}

copyRecursive(templateDir, root);
console.log(dryRun ? 'Dry run complete.' : 'ForgeAI agentic markdown kit initialized.');
