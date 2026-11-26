import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { callApiAdapter, validateApiAdaptersConfig } from '../bin/lib/api-adapter.js';
import { callAnthropic } from '../bin/lib/api-adapters/anthropic.js';
import { callGemini } from '../bin/lib/api-adapters/gemini.js';
import { callOpenAI } from '../bin/lib/api-adapters/openai.js';
import { executeCodeMode } from '../bin/lib/code-mode.js';
import { analyzeFilesQuality } from '../bin/lib/code-quality.js';
import { handleMcpRequest } from '../bin/lib/mcp.js';
import { tryParseAgentResponse } from '../bin/lib/router.js';
import { listRunRecords } from '../bin/lib/run-record.js';
import { initialState, reducer } from '../bin/ui/reducer.js';
import { minimalArtifact } from './api-adapter.test.js';

function createSampleRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgeai-code-mode-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'token.ts'),
    'export function verifyAuthToken(token: string) {\n  return token.startsWith("Bearer ");\n}\n'
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'middleware.ts'),
    'import { verifyAuthToken } from "./token";\nexport function authMiddleware(header: string) {\n  return verifyAuthToken(header);\n}\n'
  );
  return dir;
}

test('executeCodeMode chains try, context, expandContext, checkQuality, and graph in one script', () => {
  const cwd = createSampleRepo();
  try {
    const script = `
      const preview = await forgeai.try("authMiddleware");
      const ctx = await forgeai.context({ objective: "authMiddleware", budget: 4000, maxDepth: 0, maxNodes: 1 });
      const expanded = await forgeai.expandContext([
        { kind: "symbol", name: "verifyAuthToken", reason: "need token verification helper" }
      ]);
      const quality = await forgeai.checkQuality({ strict: true });
      const graph = await forgeai.graph({ symbol: "verifyAuthToken" });
      console.log("selected:", preview.selected.length);
      return {
        previewPaths: preview.selected.map(s => s.node.path),
        primaryFiles: ctx.selection.files.map(f => f.path),
        expandedFiles: expanded.artifact ? expanded.artifact.selection.files.map(f => f.path) : [],
        qualityPassed: quality.passed,
        graphNodes: graph.nodes.map(n => n.path)
      };
    `;
    const outcome = executeCodeMode(script, { repositoryRoot: cwd });
    assert.equal(outcome.ok, true, outcome.error ?? '');
    assert.deepEqual(outcome.operations, ['try', 'context', 'expandContext', 'checkQuality', 'graph']);
    assert.deepEqual(outcome.logs, ['selected: 2']);
    const res = outcome.result as {
      previewPaths: string[];
      primaryFiles: string[];
      expandedFiles: string[];
      qualityPassed: boolean;
      graphNodes: string[];
    };
    assert.ok(res.previewPaths.includes('src/middleware.ts'));
    assert.deepEqual(res.primaryFiles, ['src/middleware.ts']);
    assert.ok(res.expandedFiles.includes('src/token.ts'));
    assert.equal(res.qualityPassed, true);
    assert.deepEqual(res.graphNodes, ['src/token.ts']);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('executeCodeMode supports Claude Code expression-at-end syntax without explicit return', () => {
  const cwd = createSampleRepo();
  try {
    const script = `
      const g = forgeai.graph({ pathContains: "token" });
      ({ count: g.nodes.length, first: g.nodes[0].path });
    `;
    const outcome = executeCodeMode(script, { repositoryRoot: cwd });
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.result, { count: 1, first: 'src/token.ts' });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('executeCodeMode blocks sandbox escape attempts and enforces timeout', () => {
  const cwd = createSampleRepo();
  try {
    const evalEscape = executeCodeMode('eval("1 + 1")', { repositoryRoot: cwd });
    assert.equal(evalEscape.ok, false);
    assert.match(evalEscape.error ?? '', /Code generation from strings disallowed/);

    const ctorEscape = executeCodeMode('forgeai.try.constructor("return process")()', { repositoryRoot: cwd });
    assert.equal(ctorEscape.ok, false);
    assert.match(ctorEscape.error ?? '', /Code generation from strings disallowed/);

    const errorEscape = executeCodeMode(
      'try { forgeai.try(""); } catch (e) { return e.constructor.constructor("return process")(); }',
      { repositoryRoot: cwd }
    );
    assert.equal(errorEscape.ok, false);
    assert.match(errorEscape.error ?? '', /Code generation from strings disallowed/);

    const globalCheck = executeCodeMode(
      'return { hasProcess: typeof process, hasRequire: typeof require }',
      { repositoryRoot: cwd }
    );
    assert.equal(globalCheck.ok, true);
    assert.deepEqual(globalCheck.result, { hasProcess: 'undefined', hasRequire: 'undefined' });

    const loopOutcome = executeCodeMode('while (true) {}', { repositoryRoot: cwd, timeoutMs: 100 });
    assert.equal(loopOutcome.ok, false);
    assert.match(loopOutcome.error ?? '', /Script execution timed out/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('executeCodeMode enforces readScope and writeScope boundaries for file operations', () => {
  const cwd = createSampleRepo();
  try {
    const allowedOutcome = executeCodeMode(
      `
      const before = forgeai.readScopedFile("src/token.ts");
      forgeai.editFile("src/token.ts", "Bearer ", "Token ");
      forgeai.writeFile("src/extra.ts", "export const extra = 1;\\n");
      return { beforeHasBearer: before.includes("Bearer "), changed: forgeai.changedFiles() };
      `,
      { repositoryRoot: cwd, writeScope: ['src'], readScope: ['src/token.ts'] }
    );
    assert.equal(allowedOutcome.ok, true, allowedOutcome.error ?? '');
    assert.deepEqual(allowedOutcome.changed_files, ['src/extra.ts', 'src/token.ts']);
    assert.match(fs.readFileSync(path.join(cwd, 'src', 'token.ts'), 'utf8'), /Token /);

    const outOfScopeWrite = executeCodeMode('forgeai.writeFile("README.md", "hacked")', {
      repositoryRoot: cwd,
      writeScope: ['src']
    });
    assert.equal(outOfScopeWrite.ok, false);
    assert.match(outOfScopeWrite.error ?? '', /write access denied for 'README\.md'/);

    const protectedWrite = executeCodeMode('forgeai.writeFile(".ai/RULES.md", "hacked")', {
      repositoryRoot: cwd,
      writeScope: ['.ai']
    });
    assert.equal(protectedWrite.ok, false);
    assert.match(protectedWrite.error ?? '', /protected path/);

    const outOfScopeRead = executeCodeMode('forgeai.readScopedFile("src/middleware.ts")', {
      repositoryRoot: cwd,
      readScope: ['src/token.ts'],
      writeScope: []
    });
    assert.equal(outOfScopeRead.ok, false);
    assert.match(outOfScopeRead.error ?? '', /read access denied for 'src\/middleware\.ts'/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('MCP forgeai_code tool executes multi-step script and returns distilled output', () => {
  const cwd = createSampleRepo();
  try {
    const res = handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'forgeai_code',
          arguments: {
            code: `
              const ctx = forgeai.context({ objective: "verifyAuthToken", budget: 2000 });
              return ctx.excerpts.filter(e => e.mode === "full").map(e => ({ path: e.path, name: e.name }));
            `
          }
        }
      },
      cwd
    ) as { result: { isError: boolean; content: Array<{ text: string }> } };

    assert.equal(res.result.isError, false);
    const payload = JSON.parse(res.result.content[0].text) as {
      result: Array<{ path: string; name: string }>;
      operations: string[];
    };
    assert.deepEqual(payload.operations, ['context']);
    assert.ok(payload.result.some((item) => item.path === 'src/token.ts' && item.name === 'verifyAuthToken'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validateApiAdaptersConfig validates code_mode and max_tool_rounds', () => {
  const valid = validateApiAdaptersConfig({
    version: 1,
    adapters: {
      claude_code_mode: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        code_mode: true,
        max_tool_rounds: 5
      }
    }
  });
  assert.equal(valid.ok, true);

  const badCodeMode = validateApiAdaptersConfig({
    version: 1,
    adapters: {
      bad: { provider: 'anthropic', model: 'claude-sonnet-4-6', code_mode: 'yes' }
    }
  });
  assert.equal(badCodeMode.ok, false);
  if (!badCodeMode.ok) assert.match(badCodeMode.detail, /code_mode must be a boolean/);

  const badRounds = validateApiAdaptersConfig({
    version: 1,
    adapters: {
      bad: { provider: 'anthropic', model: 'claude-sonnet-4-6', max_tool_rounds: 99 }
    }
  });
  assert.equal(badRounds.ok, false);
  if (!badRounds.ok) assert.match(badRounds.detail, /max_tool_rounds must be an integer from 1 to 10/);
});

test('callAnthropic with code_mode executes forgeai_code tool_use loop and edits in-scope files', async () => {
  const cwd = createSampleRepo();
  const savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    let callCount = 0;
    let secondRoundBody: Record<string, unknown> | null = null;
    const mockFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      callCount += 1;
      const parsedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (callCount === 1) {
        assert.ok(Array.isArray(parsedBody.tools));
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'tool_use',
                id: 'toolu_01',
                name: 'forgeai_code',
                input: {
                  code: `
                    forgeai.editFile("src/token.ts", "Bearer ", "CustomBearer ");
                    const q = forgeai.checkQuality({ files: ["src/token.ts"] });
                    return { edited: forgeai.changedFiles(), qualityPassed: q.passed };
                  `
                }
              }
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 120, output_tokens: 60, cache_read_input_tokens: 10 }
          }),
          { status: 200 }
        );
      }
      secondRoundBody = parsedBody;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'completed',
                summary: 'Updated token prefix via Code Mode',
                changed_files: ['src/token.ts'],
                validation: [{ command: 'checkQuality', passed: true }],
                risks: [],
                next_action: 'commit changes'
              })
            }
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 180, output_tokens: 40, cache_read_input_tokens: 20 }
        }),
        { status: 200 }
      );
    };

    const result = await callAnthropic(
      minimalArtifact(),
      { provider: 'anthropic', model: 'claude-sonnet-4-6', code_mode: true },
      mockFetch as typeof fetch,
      undefined,
      { repositoryRoot: cwd, writeScope: ['src'] }
    );

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(callCount, 2);
    assert.equal(result.input_tokens, 300);
    assert.equal(result.output_tokens, 100);
    assert.equal(result.cached_tokens, 30);
    assert.match(fs.readFileSync(path.join(cwd, 'src', 'token.ts'), 'utf8'), /CustomBearer /);
    assert.ok(secondRoundBody !== null);
    const agentResp = tryParseAgentResponse(result.text ?? '');
    assert.equal(agentResp?.status, 'completed');
    assert.deepEqual(agentResp?.changed_files, ['src/token.ts']);
  } finally {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('callOpenAI with code_mode executes forgeai_code tool_calls loop', async () => {
  const cwd = createSampleRepo();
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  try {
    let callCount = 0;
    const mockFetch = async (): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'forgeai_code',
                        arguments: JSON.stringify({
                          code: 'return forgeai.try("verifyAuthToken").selected.map(s => s.node.path);'
                        })
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 0 } }
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Verified src/token.ts via Code Mode' } }],
          usage: { prompt_tokens: 150, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 50 } }
        }),
        { status: 200 }
      );
    };

    const result = await callOpenAI(
      minimalArtifact(),
      { provider: 'openai', model: 'gpt-4.1', code_mode: true },
      mockFetch as typeof fetch,
      undefined,
      { repositoryRoot: cwd }
    );

    assert.equal(result.ok, true, result.error ?? '');
    assert.equal(callCount, 2);
    assert.equal(result.text, 'Verified src/token.ts via Code Mode');
    assert.equal(result.input_tokens, 250);
    assert.equal(result.output_tokens, 50);
    assert.equal(result.cached_tokens, 50);
  } finally {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('executeCodeMode supports symbols(), callers(), and runCheck() inside sandbox', () => {
  const cwd = createSampleRepo();
  try {
    fs.writeFileSync(
      path.join(cwd, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "console.log(\'ok-check\')"' } })
    );
    const outcome = executeCodeMode(
      `
      const syms = forgeai.symbols("src/token.ts");
      const callers = forgeai.callers("verifyAuthToken");
      const check = forgeai.runCheck("test");
      return { syms, callers, check };
      `,
      { repositoryRoot: cwd }
    );
    assert.equal(outcome.ok, true, outcome.error ?? '');
    assert.deepEqual(outcome.operations, ['symbols', 'callers', 'runCheck']);
    const data = outcome.result as {
      syms: Array<{ name: string; kind: string; exported: boolean }>;
      callers: { symbol: string; definitions: string[]; callers: Array<{ path: string }> };
      check: { name: string; passed: boolean; output: string };
    };
    assert.equal(data.syms[0]?.name, 'verifyAuthToken');
    assert.equal(data.syms[0]?.exported, true);
    assert.deepEqual(data.callers.definitions, ['src/token.ts']);
    assert.deepEqual(data.callers.callers.map((c) => c.path), ['src/middleware.ts']);
    assert.equal(data.check.passed, true);
    assert.match(data.check.output, /ok-check/);

    const badCheck = executeCodeMode('forgeai.runCheck("arbitrary")', { repositoryRoot: cwd });
    assert.equal(badCheck.ok, false);
    assert.match(badCheck.error ?? '', /only allows: typecheck, lint, test, build/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('callGemini with code_mode executes forgeai_code functionCall loop and records telemetry in RunRecord', async () => {
  const cwd = createSampleRepo();
  const savedKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = 'test-gemini-key';
  try {
    fs.mkdirSync(path.join(cwd, '.ai'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.ai', 'api-adapters.json'),
      JSON.stringify({
        version: 1,
        adapters: {
          gemini_cm: { provider: 'gemini', model: 'gemini-2.5-flash', code_mode: true }
        }
      })
    );

    let callCount = 0;
    const mockFetch = async (): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'forgeai_code',
                        args: { code: 'return forgeai.symbols("src/token.ts").map(s => s.name);' }
                      }
                    }
                  ]
                }
              }
            ],
            usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 25, cachedContentTokenCount: 10 }
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Gemini Code Mode complete' }] } }],
          usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 15, cachedContentTokenCount: 20 }
        }),
        { status: 200 }
      );
    };

    const directResult = await callGemini(
      minimalArtifact(),
      { provider: 'gemini', model: 'gemini-2.5-flash', code_mode: true },
      mockFetch as typeof fetch,
      undefined,
      { repositoryRoot: cwd }
    );
    assert.equal(directResult.ok, true, directResult.error ?? '');
    assert.equal(directResult.code_mode, true);
    assert.equal(directResult.tool_rounds, 1);
    assert.deepEqual(directResult.sandbox_operations, ['symbols']);
    assert.equal(directResult.input_tokens, 200);
    assert.equal(directResult.output_tokens, 40);
    assert.equal(directResult.cached_tokens, 30);

    callCount = 0;
    const { record } = await callApiAdapter(
      'gemini_cm',
      minimalArtifact(),
      '.ai/state/context/TASK-20261125-cm.json',
      cwd,
      null,
      {
        dispatch: (art, entry, onDelta, cmOpts) =>
          callGemini(art, entry, mockFetch as typeof fetch, onDelta, cmOpts)
      }
    );
    assert.equal(record?.code_mode, true);
    assert.equal(record?.tool_rounds, 1);
    assert.deepEqual(record?.sandbox_operations, ['symbols']);
    const persisted = listRunRecords(cwd);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].code_mode, true);
    assert.equal(persisted[0].tool_rounds, 1);
    assert.deepEqual(persisted[0].sandbox_operations, ['symbols']);
  } finally {
    if (savedKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = savedKey;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('UI reducer formats code_mode_step monitor events', () => {
  const next = reducer(initialState(), {
    type: 'code_mode_step',
    ts: 1700000000,
    round: 2,
    operations: ['try', 'editFile'],
    changed_files: ['src/token.ts'],
    ok: true
  });
  assert.equal(next.connected, true);
  assert.equal(next.logs.length, 1);
  assert.match(next.logs[0].text, /code-mode round #2 ops=\[try,editFile\] files=\[src\/token\.ts\]/);
  assert.equal(next.logs[0].level, 'info');
});

test('Code Mode and all touched modules satisfy ForgeAI complexity (< 10) and duplication (< 0.8) gates', () => {
  const report = analyzeFilesQuality(process.cwd(), [
    'bin/lib/code-mode.ts',
    'bin/lib/mcp.ts',
    'bin/lib/api-adapters/code-mode-loop.ts',
    'bin/lib/api-adapters/anthropic.ts',
    'bin/lib/api-adapters/openai.ts',
    'bin/lib/api-adapters/gemini.ts',
    'bin/lib/api-adapter.ts',
    'bin/lib/router.ts',
    'bin/lib/task.ts',
    'bin/lib/run-record.ts',
    'bin/lib/context.ts',
    'bin/ui/reducer.ts'
  ]);
  assert.deepEqual(report.complex_functions, []);
  assert.deepEqual(report.duplicates, []);
  assert.equal(report.passed, true);
});

