#!/usr/bin/env node
import fs, { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(process.cwd());
const templateDir = path.resolve(__dirname, '../templates');
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const dryRun = args.has('--dry-run');
const check = args.has('--check');
const requiredHarnessFiles = [
    'CLAUDE.md',
    'AGENTS.md',
    '.ai/README.md',
    '.ai/BOOTSTRAP.md',
    '.ai/PROJECT.md',
    '.ai/RULES.md',
    '.ai/TASTE.md',
    '.ai/MEMORY.md',
    '.ai/AGENT_REGISTRY.md',
    '.ai/MODEL_ROUTING.md',
    '.ai/model-routing.yaml',
    '.ai/cli-adapters.json',
    '.ai/router/run-model.js',
    '.ai/WORKFLOW.md',
    '.ai/agents/orchestrator.md',
    '.ai/agents/reviewer.md',
    '.ai/skills/code-review/SKILL.md',
    '.ai/state/CURRENT.md',
    '.ai/state/assignments/TASK-CODEX-TEST.md',
    '.ai/state/assignments/TASK-REVIEWER-SMOKE.md',
    'openspec/README.md',
    'openspec/project.md'
];
const bootstrapFiles = ['.ai/PROJECT.md', '.ai/MEMORY.md', '.ai/AGENT_REGISTRY.md'];
function formatStatus(status, label) {
    return `${status.padEnd(16)} ${label}`;
}
function commandExists(command) {
    if (!command)
        return false;
    if (command.includes('/') || command.includes('\\')) {
        try {
            fs.accessSync(path.resolve(root, command), constants.X_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const extensions = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
        : [''];
    for (const entry of pathEntries) {
        for (const extension of extensions) {
            try {
                fs.accessSync(path.join(entry, `${command}${extension}`), constants.X_OK);
                return true;
            }
            catch {
                // Keep searching PATH.
            }
        }
    }
    return false;
}
function readJsonIfPresent(relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath))
        return null;
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}
function countTodos(relativePath) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath))
        return 0;
    const content = fs.readFileSync(absolutePath, 'utf8');
    return (content.match(/\bTODO\b/g) || []).length;
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function runCheck() {
    console.log('ForgeAI harness check');
    console.log('');
    let missingRequired = 0;
    for (const relativePath of requiredHarnessFiles) {
        const exists = fs.existsSync(path.join(root, relativePath));
        if (!exists)
            missingRequired += 1;
        console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
    }
    console.log('');
    console.log('Bootstrap status');
    let totalTodos = 0;
    for (const relativePath of bootstrapFiles) {
        const todos = countTodos(relativePath);
        totalTodos += todos;
        const status = todos > 0 ? 'needs bootstrap' : 'ok';
        console.log(formatStatus(status, `${relativePath}${todos > 0 ? ` (${todos} TODO)` : ''}`));
    }
    console.log('');
    console.log('Model adapters');
    const availableAdapters = [];
    let adapterReadFailed = false;
    try {
        const adapterConfig = readJsonIfPresent('.ai/cli-adapters.json');
        const adapters = adapterConfig?.adapters || {};
        const adapterEntries = Object.entries(adapters);
        if (adapterEntries.length === 0) {
            console.log(formatStatus('skipped', '.ai/cli-adapters.json has no adapters'));
        }
        for (const [provider, adapter] of adapterEntries) {
            const available = commandExists(adapter.command);
            if (available)
                availableAdapters.push(provider);
            console.log(formatStatus(available ? 'optional ok' : 'optional missing', `${provider} (${adapter.command ?? 'missing command'})`));
        }
    }
    catch (error) {
        adapterReadFailed = true;
        console.log(formatStatus('invalid', `.ai/cli-adapters.json (${getErrorMessage(error)})`));
    }
    console.log('');
    console.log('Orchestration');
    if (availableAdapters.length === 0) {
        console.log(formatStatus('single-agent', 'current model must orchestrate, implement, review, and validate locally'));
    }
    else {
        console.log(formatStatus('multi-agent', `orchestrator can be current model or: ${availableAdapters.join(', ')}`));
        console.log(formatStatus('policy', 'human chooses orchestrator; fallback is current_model_executes_locally'));
    }
    console.log('');
    if (missingRequired > 0 || adapterReadFailed) {
        console.log('Result: harness incomplete. Run forgeai-init or restore the missing/invalid files.');
        process.exitCode = 1;
        return;
    }
    if (totalTodos > 0) {
        console.log('Result: harness installed, but project context still needs bootstrap.');
        return;
    }
    console.log('Result: harness installed and ready.');
}
function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        if (!dryRun)
            fs.mkdirSync(dest, { recursive: true });
        for (const item of fs.readdirSync(src))
            copyRecursive(path.join(src, item), path.join(dest, item));
        return;
    }
    if (fs.existsSync(dest) && !force) {
        console.log(`skip ${path.relative(root, dest)} already exists. Use --force to overwrite.`);
        return;
    }
    if (dryRun)
        console.log(`would create ${path.relative(root, dest)}`);
    else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log(`created ${path.relative(root, dest)}`);
    }
}
if (check)
    runCheck();
else {
    copyRecursive(templateDir, root);
    console.log(dryRun ? 'Dry run complete.' : 'ForgeAI agentic markdown kit initialized.');
}
