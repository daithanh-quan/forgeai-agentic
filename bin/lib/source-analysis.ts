import path from 'node:path';
import { parse, type ParserPlugin } from '@babel/parser';
import type { DependencyEdgeKind } from './types.js';

type AstNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  [key: string]: unknown;
};

export type ParsedImport = {
  kind: DependencyEdgeKind;
  specifier?: string;
  start: number;
  end: number;
};

export type SourceDeclarationKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'test';

export type SourceDeclaration = {
  kind: SourceDeclarationKind;
  name: string;
  search_names: string[];
  start: number;
  end: number;
  signature: string | null;
  exported: boolean;
};

export type SourceAnalysis = {
  imports: ParsedImport[];
  exports: string[];
  declarations: SourceDeclaration[];
};

function isAstNode(value: unknown): value is AstNode {
  return value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

function nodeName(value: unknown): string | null {
  if (!isAstNode(value)) return null;
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name;
  if ((value.type === 'StringLiteral' || value.type === 'Literal') && typeof value.value === 'string') return value.value;
  return null;
}

function literalValue(value: unknown): string | null {
  const name = nodeName(value);
  if (name !== null && isAstNode(value) && value.type !== 'Identifier') return name;
  if (isAstNode(value) && value.type === 'TemplateLiteral') {
    const expressions = Array.isArray(value.expressions) ? value.expressions : [];
    const quasis = Array.isArray(value.quasis) ? value.quasis : [];
    if (expressions.length === 0 && quasis.length === 1 && isAstNode(quasis[0])) {
      const cooked = quasis[0].value;
      if (cooked && typeof cooked === 'object' && typeof (cooked as { cooked?: unknown }).cooked === 'string') {
        return (cooked as { cooked: string }).cooked;
      }
    }
  }
  return null;
}

function span(node: AstNode): { start: number; end: number } | null {
  return typeof node.start === 'number' && typeof node.end === 'number'
    ? { start: node.start, end: node.end }
    : null;
}

function walkAst(value: unknown, visitor: (node: AstNode, parent: AstNode | null) => void, parent: AstNode | null = null): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => walkAst(entry, visitor, parent));
    return;
  }
  if (!isAstNode(value)) return;
  visitor(value, parent);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(child) || isAstNode(child)) walkAst(child, visitor, value);
  }
}

function parserPlugins(file: string): ParserPlugin[] {
  const extension = path.extname(file);
  const plugins: ParserPlugin[] = ['decorators-legacy', 'importAttributes', 'explicitResourceManagement'];
  if (['.ts', '.tsx', '.mts', '.cts'].includes(extension)) plugins.push('typescript');
  if (['.tsx', '.jsx', '.js', '.mjs', '.cjs'].includes(extension)) plugins.push('jsx');
  return plugins;
}

function collectBindingNames(value: unknown, output: Set<string>): void {
  if (!isAstNode(value)) return;
  const directName = nodeName(value);
  if (directName && value.type === 'Identifier') {
    output.add(directName);
    return;
  }
  if (value.type === 'VariableDeclaration' && Array.isArray(value.declarations)) {
    for (const declaration of value.declarations) {
      if (isAstNode(declaration)) collectBindingNames(declaration.id, output);
    }
    return;
  }
  if (['FunctionDeclaration', 'ClassDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration'].includes(value.type)) {
    const name = nodeName(value.id);
    if (name) output.add(name);
    return;
  }
  for (const key of ['left', 'argument', 'elements', 'properties']) {
    const child = value[key];
    if (Array.isArray(child)) child.forEach((entry) => collectBindingNames(entry, output));
    else collectBindingNames(child, output);
  }
  if (value.type === 'ObjectProperty' || value.type === 'RestProperty') collectBindingNames(value.value, output);
}

function isExportParent(parent: AstNode | null): boolean {
  return parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration';
}

function declarationSpan(node: AstNode, parent: AstNode | null): { start: number; end: number } | null {
  return isExportParent(parent) ? span(parent!) : span(node);
}

function buildSignature(content: string, declarationStart: number, body: unknown, suffix: string): string | null {
  if (!isAstNode(body) || typeof body.start !== 'number') return null;
  return `${content.slice(declarationStart, body.start).trimEnd()} ${suffix}`;
}

function classSearchNames(node: AstNode, fallback: string): string[] {
  const names = new Set<string>([fallback]);
  if (isAstNode(node.body) && Array.isArray(node.body.body)) {
    for (const member of node.body.body) {
      if (!isAstNode(member)) continue;
      const name = nodeName(member.key);
      if (name) names.add(name);
    }
  }
  return Array.from(names);
}

function variableSignature(content: string, declarationStart: number, node: AstNode): string | null {
  if (!Array.isArray(node.declarations) || node.declarations.length !== 1 || !isAstNode(node.declarations[0])) return null;
  const initializer = node.declarations[0].init;
  if (!isAstNode(initializer) || !['ArrowFunctionExpression', 'FunctionExpression'].includes(initializer.type)) return null;
  if (isAstNode(initializer.body) && initializer.body.type === 'BlockStatement') {
    return buildSignature(content, declarationStart, initializer.body, '{ /* body omitted */ };');
  }
  if (isAstNode(initializer.body) && typeof initializer.body.start === 'number') {
    return `${content.slice(declarationStart, initializer.body.start).trimEnd()} /* expression omitted */;`;
  }
  return null;
}

function callName(value: unknown): string | null {
  if (!isAstNode(value)) return null;
  if (value.type === 'Identifier') return nodeName(value);
  if ((value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression')) return nodeName(value.property);
  return null;
}

export function analyzeSource(content: string, file: string): SourceAnalysis {
  const ast = parse(content, {
    sourceFilename: file,
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    createImportExpressions: true,
    plugins: parserPlugins(file)
  });
  const imports: ParsedImport[] = [];
  const exports = new Set<string>();
  const declarations: SourceDeclaration[] = [];

  walkAst(ast.program, (node, parent) => {
    const nodeSpan = span(node);
    if (node.type === 'ImportDeclaration' && nodeSpan) {
      imports.push({ kind: 'static_import', specifier: literalValue(node.source) ?? undefined, ...nodeSpan });
      return;
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && nodeSpan) {
      if (node.source) imports.push({ kind: 'static_import', specifier: literalValue(node.source) ?? undefined, ...nodeSpan });
      if (node.declaration) collectBindingNames(node.declaration, exports);
      if (Array.isArray(node.specifiers)) {
        for (const specifier of node.specifiers) {
          if (!isAstNode(specifier)) continue;
          const name = nodeName(specifier.exported);
          if (name) exports.add(name);
        }
      }
      const exported = nodeName(node.exported);
      if (exported) exports.add(exported);
      return;
    }
    if (node.type === 'ExportDefaultDeclaration') exports.add('default');
    if (node.type === 'TSExportAssignment') exports.add('default');
    if (node.type === 'ImportExpression' && nodeSpan) {
      imports.push({ kind: 'dynamic_import', specifier: literalValue(node.source) ?? undefined, ...nodeSpan });
      return;
    }
    if (node.type === 'CallExpression' && isAstNode(node.callee) && nodeSpan) {
      const argumentsList = Array.isArray(node.arguments) ? node.arguments : [];
      if (node.callee.type === 'Import') {
        imports.push({ kind: 'dynamic_import', specifier: literalValue(argumentsList[0]) ?? undefined, ...nodeSpan });
      } else if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
        imports.push({ kind: 'require', specifier: literalValue(argumentsList[0]) ?? undefined, ...nodeSpan });
      }
      if (parent?.type === 'ExpressionStatement') {
        const runner = callName(node.callee);
        if (runner && ['it', 'test'].includes(runner)) {
          const parentSpan = span(parent);
          if (parentSpan) {
            const label = literalValue(argumentsList[0]) ?? runner;
            declarations.push({
              kind: 'test', name: label, search_names: [runner, label], ...parentSpan,
              signature: null, exported: false
            });
          }
        }
      }
      return;
    }
    if (node.type === 'TSImportEqualsDeclaration' && isAstNode(node.moduleReference) && node.moduleReference.type === 'TSExternalModuleReference' && nodeSpan) {
      imports.push({ kind: 'require', specifier: literalValue(node.moduleReference.expression) ?? undefined, ...nodeSpan });
      return;
    }

    const parentIsTopLevel = parent?.type === 'Program' || isExportParent(parent);
    if (!parentIsTopLevel) return;
    const declaration = declarationSpan(node, parent);
    if (!declaration) return;
    const exported = isExportParent(parent);
    if (node.type === 'FunctionDeclaration') {
      const name = nodeName(node.id) ?? 'default';
      declarations.push({
        kind: 'function', name, search_names: [name], ...declaration,
        signature: buildSignature(content, declaration.start, node.body, '{ /* body omitted */ }'), exported
      });
    } else if (node.type === 'ClassDeclaration') {
      const name = nodeName(node.id) ?? 'default';
      declarations.push({
        kind: 'class', name, search_names: classSearchNames(node, name), ...declaration,
        signature: buildSignature(content, declaration.start, node.body, '{ /* members omitted */ }'), exported
      });
    } else if (node.type === 'TSInterfaceDeclaration') {
      const name = nodeName(node.id) ?? 'anonymous-interface';
      declarations.push({
        kind: 'interface', name, search_names: [name], ...declaration,
        signature: buildSignature(content, declaration.start, node.body, '{ /* members omitted */ }'), exported
      });
    } else if (node.type === 'TSTypeAliasDeclaration') {
      const name = nodeName(node.id) ?? 'anonymous-type';
      declarations.push({ kind: 'type', name, search_names: [name], ...declaration, signature: null, exported });
    } else if (node.type === 'TSEnumDeclaration') {
      const name = nodeName(node.id) ?? 'anonymous-enum';
      declarations.push({
        kind: 'enum', name, search_names: [name], ...declaration,
        signature: buildSignature(content, declaration.start, node.body, '{ /* members omitted */ }'), exported
      });
    } else if (node.type === 'VariableDeclaration') {
      const names = new Set<string>();
      collectBindingNames(node, names);
      if (names.size > 0) {
        const name = Array.from(names).join(', ');
        declarations.push({
          kind: 'variable', name, search_names: Array.from(names), ...declaration,
          signature: variableSignature(content, declaration.start, node), exported
        });
      }
    }
  });

  return {
    imports,
    exports: Array.from(exports).sort(),
    declarations: declarations.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name))
  };
}
