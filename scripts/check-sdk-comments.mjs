//
//  check-sdk-comments.mjs
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { formatDeclarations, formatCalls } from './format-sdk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Lists authored SDK files without including build output or the example app.
 *
 * @param directory Source directory to enumerate recursively.
 * @returns Absolute paths of files contained in the directory.
 */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

/**
 * Resolves function parameters, including callback properties and function aliases.
 *
 * @param node TypeScript declaration to inspect.
 * @returns Ordered formal parameters, or null for a non-callable declaration.
 */
function parameters(node) {
  if (node.parameters) return node.parameters;
  if (node.type && ts.isFunctionTypeNode(node.type))
    return node.type.parameters;
  if (
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  )
    return node.initializer.parameters;
  return null;
}

/**
 * Checks whether constructor parameters initialize fields whose documentation carries their meaning.
 *
 * @param node The declaration to inspect.
 * @param file The containing source file.
 * @returns Whether field documentation can describe the constructor parameters.
 */
function hasFieldParameterDocumentation(node, file) {
  if (!ts.isConstructorDeclaration(node) || !node.body) return false;
  const names = new Set(
    node.parameters.map(parameter => parameter.name.getText(file)),
  );
  const assignment = statement =>
    ts.isExpressionStatement(statement) &&
    ts.isBinaryExpression(statement.expression) &&
    statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(statement.expression.left) &&
    statement.expression.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
    ts.isIdentifier(statement.expression.right) &&
    names.has(statement.expression.right.text) &&
    statement.expression.left.name.text === statement.expression.right.text;
  const assigned = new Set(
    node.body.statements
      .filter(assignment)
      .map(statement => statement.expression.right.text),
  );
  return node.parameters.every(
    parameter =>
      ts.isParameterPropertyDeclaration(parameter, node) ||
      assigned.has(parameter.name.getText(file)),
  );
}

/**
 * Checks SDK declaration spacing and multiline formal parameter lists.
 *
 * @param filename Source path used to select TypeScript or TSX syntax.
 * @param source Complete source text.
 * @returns Layout violations; an empty list indicates compliance.
 */
export function checkTypeScriptLayout(filename, source) {
  return formatCalls(filename, formatDeclarations(filename, source)) === source
    ? []
    : [
        `${filename}: separate member documentation and use multiline declarations and multi-argument calls`,
      ];
}

/**
 * Checks one SDK source file for declaration coverage and ordered parameter tags.
 *
 * @param filename Source filename used for diagnostic locations.
 * @param source Complete TypeScript or TSX source text.
 * @returns Human-readable violations; an empty list indicates compliance.
 */
export function checkTypeScriptComments(filename, source) {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const failures = [];
  const report = (node, message) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    failures.push(`${filename}:${line + 1}: ${message}`);
  };
  const visit = node => {
    const topVariable =
      ts.isVariableDeclaration(node) &&
      ts.isVariableStatement(node.parent.parent) &&
      ts.isSourceFile(node.parent.parent.parent);
    const parameterProperty =
      ts.isParameter(node) &&
      ts.isConstructorDeclaration(node.parent) &&
      ts.isParameterPropertyDeclaration(node, node.parent);
    const declaration =
      topVariable ||
      parameterProperty ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isEnumMember(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node);
    if (declaration) {
      const target = topVariable ? node.parent.parent : node;
      const docs = target.jsDoc ?? [];
      const name = node.name?.getText(file) ?? 'constructor';
      if (docs.length !== 1) {
        report(node, `${name} requires one documentation block`);
      } else {
        const doc = docs[0];
        const text = source.slice(doc.pos, doc.end);
        if (!text.startsWith('/**\n') || !/\n\s*\*\/$/.test(text))
          report(node, `${name} requires a multiline /** ... */ block`);
        if (typeof doc.comment !== 'string' || !doc.comment.trim()) {
          // Structured @link comments are also valid summary text.
          if (!doc.comment?.length)
            report(node, `${name} requires a purpose summary`);
        }
        const formal = parameters(node);
        if (formal) {
          const expected = formal.map(parameter =>
            ts.isIdentifier(parameter.name)
              ? parameter.name.text
              : /^[A-Z]/.test(name)
              ? 'props'
              : 'options',
          );
          const tags = doc.tags ?? [];
          const documented = tags
            .filter(tag => tag.tagName.text === 'param')
            .map(tag => tag.name?.getText(file));
          const fieldConstructor = hasFieldParameterDocumentation(node, file);
          if (
            !(fieldConstructor && documented.length === 0) &&
            JSON.stringify(documented) !== JSON.stringify(expected)
          )
            report(
              node,
              `${name} @param order must be: ${
                expected.join(', ') || '(none)'
              }`,
            );
          for (const tag of tags.filter(tag => tag.tagName.text === 'param'))
            if (!tag.comment)
              report(
                node,
                `${name} requires a description for ${tag.name?.getText(file)}`,
              );
          const returns = tags.filter(tag => tag.tagName.text === 'returns');
          const callable = node.parameters
            ? node
            : node.type && ts.isFunctionTypeNode(node.type)
            ? node.type
            : node.initializer;
          const result = callable?.type;
          const isVoid =
            ts.isConstructorDeclaration(node) ||
            ts.isSetAccessor(node) ||
            result?.kind === ts.SyntaxKind.VoidKeyword ||
            (result &&
              ts.isTypeReferenceNode(result) &&
              result.typeName.getText(file) === 'Promise' &&
              result.typeArguments?.[0]?.kind === ts.SyntaxKind.VoidKeyword);
          if (returns.length > 1 || returns.some(tag => !tag.comment))
            report(
              node,
              `${name} requires meaningful, non-repeated @returns documentation`,
            );
          if (isVoid && returns.length)
            report(
              node,
              `${name} must omit void or constructor return documentation`,
            );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return failures;
}

/**
 * Checks documentation prose for the English language policy.
 *
 * @param filename The source filename used for diagnostics.
 * @param source The complete source text.
 * @returns Documentation blocks containing non-English prose.
 */
export function checkDocumentationLanguage(filename, source) {
  const pattern = filename.endsWith('.swift')
    ? /^[ \t]*\/\/\/[^\n]*(?:\n[ \t]*\/\/\/[^\n]*)*/gm
    : /\/\*\*[\s\S]*?\*\//g;
  const failures = [];
  for (const match of source.matchAll(pattern)) {
    const prose = match[0]
      .replace(/^[ \t]*(?:\/\/\/|\/\*\*|\*\/?)[ ]?/gm, '')
      .replace(
        /\n(?=\s*(?:@\w+|- (?:Parameters|Returns|Throws):|  - \w+:))/g,
        '\n\n',
      );
    const paragraphs = prose.split(/\n\s*\n/).map(paragraph =>
      paragraph
        .replace(
          /@(?:param|throws)\s+\S+|@\w+|- (?:Parameters|Returns|Throws):/g,
          '',
        )
        .replace(/^\s*- \w+:/gm, '')
        .trim(),
    );
    if (
      paragraphs.some(paragraph =>
        /[\u3400-\u9fff]/.test(paragraph.replace(/`[^`]*`/g, '')),
      )
    ) {
      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${filename}:${line}: documentation must use English`);
    }
  }
  return failures;
}

/**
 * Checks the standard header shared by SDK source languages.
 *
 * @param filename SDK source filename, including its actual extension.
 * @param source Complete source text.
 * @returns Header violations, or an empty list when the template matches.
 */
export function checkHeader(filename, source) {
  const header = [
    '//',
    `//  ${basename(filename)}`,
    '//  XmaxSDK',
    '//',
    '//  Author: 翁跃庭 (Yueting Weng)',
    '//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN',
    '//',
    '//  Copyright (c) 2026 XMAX.AI PTE. LTD.',
    '//',
    '',
  ].join('\n');
  return source.startsWith(`${header}\n`)
    ? []
    : [`${filename}: missing or incorrect SDK file header`];
}

/**
 * Validates authored TypeScript documentation and all SDK native source headers.
 *
 * Sets a failing process status when violations are found.
 */
function main() {
  const sdkFiles = ['src', 'ios', 'android/src/main'].flatMap(directory =>
    files(join(root, directory)).filter(filename =>
      /\.(?:tsx?|swift|kt|java|mm|m|h)$/.test(filename),
    ),
  );
  const failures = [];
  for (const filename of sdkFiles) {
    const source = readFileSync(filename, 'utf8');
    const name = relative(root, filename);
    failures.push(...checkHeader(name, source));
    failures.push(...checkDocumentationLanguage(name, source));
    if (/\.tsx?$/.test(filename)) {
      failures.push(...checkTypeScriptComments(name, source));
      failures.push(...checkTypeScriptLayout(name, source));
    }
  }
  if (failures.length) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `SDK comments: ${sdkFiles.length} source files checked.\n`,
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main();
