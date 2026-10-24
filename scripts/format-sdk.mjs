//
//  format-sdk.mjs
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Applies declaration spacing and parameter layout after standard formatting.
 *
 * @param filename Source path used to select TypeScript or TSX syntax.
 * @param source Standard-formatted source text.
 * @returns Source with separated member documentation and multiline parameters.
 */
export function formatDeclarations(filename, source) {
  // Expand inline parameter types before calculating nested declaration indentation.
  for (;;) {
    const tree = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    let replacement;
    const find = node => {
      if (replacement) return;
      if (
        node.parameters?.length &&
        !ts.isArrowFunction(node) &&
        !ts.isFunctionExpression(node)
      ) {
        const open = node
          .getChildren(tree)
          .find(child => child.kind === ts.SyntaxKind.OpenParenToken);
        const close = node
          .getChildren(tree)
          .find(child => child.kind === ts.SyntaxKind.CloseParenToken);
        const first = node.parameters[0];
        if (
          open &&
          close &&
          source.slice(open.end, first.getStart(tree)).indexOf('\n') < 0 &&
          source
            .slice(first.getStart(tree), close.getStart(tree))
            .includes('\n')
        ) {
          const indent = source
            .slice(
              source.lastIndexOf('\n', node.getStart(tree)) + 1,
              node.getStart(tree),
            )
            .match(/^ */)[0];
          const contentStart = first.getStart(tree);
          const content = source
            .slice(contentStart, close.getStart(tree))
            .trimEnd();
          const literals = [];
          const collectLiterals = child => {
            if (
              ts.isStringLiteralLike(child) ||
              ts.isTemplateLiteralToken(child)
            )
              literals.push([child.getStart(tree), child.end]);
            else ts.forEachChild(child, collectLiterals);
          };
          for (const parameter of node.parameters) collectLiterals(parameter);
          const indented = content.replace(/\n/g, (newline, offset) =>
            literals.some(
              ([start, end]) =>
                start < contentStart + offset && contentStart + offset < end,
            )
              ? newline
              : '\n  ',
          );
          replacement = {
            start: open.end,
            end: close.getStart(tree),
            text: `\n${indent}  ${indented}\n${indent}`,
          };
          return;
        }
      }
      ts.forEachChild(node, find);
    };
    find(tree);
    if (!replacement) break;
    source =
      source.slice(0, replacement.start) +
      replacement.text +
      source.slice(replacement.end);
  }
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const edits = [];
  const indentAt = position =>
    source
      .slice(source.lastIndexOf('\n', position - 1) + 1, position)
      .match(/^ */)[0];
  const blankBefore = (position, indent) => {
    const start = source.lastIndexOf('\n', position - 1) + 1;
    if (source.slice(start, position).trim()) {
      edits.push({ start: position, end: position, text: `\n\n${indent}` });
    } else if (
      start > 0 &&
      source
        .slice(0, start - 1)
        .split('\n')
        .at(-1)
        .trim()
    ) {
      edits.push({ start, end: start, text: '\n' });
    }
  };
  const visit = node => {
    // Parameter lists include callback types, but exclude inline implementation closures.
    const callable =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isFunctionTypeNode(node) ||
      ts.isCallSignatureDeclaration(node) ||
      ts.isConstructSignatureDeclaration(node) ||
      ts.isSetAccessor(node) ||
      (ts.isArrowFunction(node) &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isVariableStatement(node.parent.parent.parent) &&
        ts.isSourceFile(node.parent.parent.parent.parent));
    if (callable && node.parameters.length) {
      const open = node
        .getChildren(file)
        .find(child => child.kind === ts.SyntaxKind.OpenParenToken);
      const close = node
        .getChildren(file)
        .find(child => child.kind === ts.SyntaxKind.CloseParenToken);
      if (open && close) {
        let indent = indentAt(node.getStart(file));
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (!parent.parameters?.length) continue;
          const parentOpen = parent
            .getChildren(file)
            .find(child => child.kind === ts.SyntaxKind.OpenParenToken);
          const containing = parent.parameters.find(
            parameter => parameter.pos <= node.pos && parameter.end >= node.end,
          );
          if (
            parentOpen &&
            containing &&
            !source
              .slice(parentOpen.end, containing.getStart(file))
              .includes('\n')
          )
            indent += '  ';
        }
        const parameters = node.parameters;
        for (let index = 0; index < parameters.length; index++) {
          const parameter = parameters[index];
          const start =
            index === 0
              ? open.end
              : source.indexOf(',', parameters[index - 1].end) + 1;
          const end = parameter.getStart(file);
          const trivia = source.slice(start, end).trim();
          const lines = trivia ? trivia.split('\n') : [];
          const documentation = lines
            .map(
              (line, lineIndex) =>
                `${indent}  ${lineIndex === 0 ? '' : ' '}${line.trimStart()}`,
            )
            .join('\n');
          edits.push({
            start,
            end,
            text: `\n${documentation && index > 0 ? '\n' : ''}${
              documentation ? `${documentation}\n` : ''
            }${indent}  `,
          });
        }
        const last = parameters.at(-1);
        const comma = source.slice(last.end, close.pos).includes(',')
          ? ','
          : '';
        edits.push({
          start: last.end,
          end: close.getStart(file),
          text: `${comma}\n${indent}`,
        });
      }
    }
    if (
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeLiteralNode(node) ||
      ts.isEnumDeclaration(node)
    ) {
      for (const member of node.members) {
        const first =
          member.jsDoc?.[0]?.getStart(file) ?? member.getStart(file);
        blankBefore(first, `${indentAt(node.getStart(file))}  `);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Insertions at the same offset are combined; edits must never replace code tokens.
  const unique = [
    ...new Map(edits.map(edit => [`${edit.start}:${edit.end}`, edit])).values(),
  ];
  for (const edit of unique.sort((a, b) => b.start - a.start || b.end - a.end))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  const result = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const literals = [];
  const collectLiterals = node => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateLiteralToken(node) ||
      ts.isJsxText(node)
    )
      literals.push([node.getStart(result), node.end]);
    else ts.forEachChild(node, collectLiterals);
  };
  collectLiterals(result);
  return source.replace(/[ \t]+$/gm, (spaces, offset) =>
    literals.some(([start, end]) => start < offset && offset < end)
      ? spaces
      : '',
  );
}

/**
 * Expands multi-argument calls without changing tokens or literal contents.
 *
 * @param filename Source path used to select TypeScript or TSX syntax.
 * @param source Source with declaration formatting applied.
 * @returns Source with one argument per line in multi-argument calls.
 */
export function formatCalls(filename, source) {
  for (;;) {
    const file = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    let replacement;
    const indentAt = position =>
      source
        .slice(source.lastIndexOf('\n', position - 1) + 1, position)
        .match(/^ */)[0];
    const visit = node => {
      if (replacement) return;
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        node.arguments?.length
      ) {
        let interpolated = false;
        for (let parent = node.parent; parent; parent = parent.parent)
          if (ts.isTemplateExpression(parent)) interpolated = true;
        const scalar = /^Math\.(?:min|max)$/.test(
          node.expression.getText(file),
        );
        const open = node
          .getChildren(file)
          .find(child => child.kind === ts.SyntaxKind.OpenParenToken);
        const close = node
          .getChildren(file)
          .find(child => child.kind === ts.SyntaxKind.CloseParenToken);
        if (interpolated && open && close) {
          const contents = source.slice(open.end, close.getStart(file));
          const values = node.arguments.map(argument => argument.getText(file));
          const compact = values.join(', ');
          if (
            values.every(value => !value.includes('\n')) &&
            !contents.includes('//') &&
            !contents.includes('/*') &&
            contents !== compact
          ) {
            replacement = {
              start: open.end,
              end: close.getStart(file),
              text: compact,
            };
            return;
          }
        }
        if (
          !interpolated &&
          !scalar &&
          open &&
          close &&
          node.arguments.length > 1
        ) {
          const args = node.arguments;
          const positions = args.map(arg => arg.pos);
          // Preserve comments before separators as part of the preceding argument.
          const separators = args.slice(0, -1).map((arg, index) => {
            const scanner = ts.createScanner(
              ts.ScriptTarget.Latest,
              true,
              ts.LanguageVariant.Standard,
              source.slice(arg.end, args[index + 1].pos),
            );
            while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken)
              if (scanner.getToken() === ts.SyntaxKind.CommaToken)
                return arg.end + scanner.getTokenPos();
            throw new Error(`${filename}: missing argument separator`);
          });
          const expanded =
            args.every((arg, index) =>
              source.slice(positions[index], arg.getStart(file)).includes('\n'),
            ) &&
            source.slice(args.at(-1).end, close.getStart(file)).includes('\n');
          if (!expanded) {
            const indent = indentAt(node.getStart(file));
            const literals = [];
            const collect = child => {
              if (
                ts.isStringLiteralLike(child) ||
                ts.isTemplateLiteralToken(child) ||
                ts.isJsxText(child)
              )
                literals.push([child.getStart(file), child.end]);
              else ts.forEachChild(child, collect);
            };
            node.arguments.forEach(collect);
            const parts = args.map((arg, index) => {
              const raw = source.slice(
                positions[index],
                separators[index] ?? arg.end,
              );
              const leading = raw.length - raw.trimStart().length;
              const start = positions[index] + leading;
              const content = raw.trim();
              const delta = indent.length + 2 - indentAt(start).length;
              const shifted = content.replace(
                /\n([ \t]*)/g,
                (match, spaces, offset) => {
                  if (
                    literals.some(
                      ([a, b]) => a < start + offset && start + offset < b,
                    )
                  )
                    return match;
                  if (content[offset + match.length] === '\n') return '\n';
                  return (
                    '\n' +
                    (delta >= 0
                      ? ' '.repeat(delta) + spaces
                      : spaces.slice(-delta))
                  );
                },
              );
              return indent + '  ' + shifted;
            });
            const tail = source.slice(args.at(-1).end, close.getStart(file));
            const suffix = tail.replace(/^\s*,?/, '').trim();
            replacement = {
              start: open.end,
              end: close.getStart(file),
              text:
                '\n' +
                parts.join(',\n') +
                (tail.trimStart().startsWith(',') ? ',' : '') +
                (suffix ? '\n' + indent + '  ' + suffix : '') +
                '\n' +
                indent,
            };
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (!replacement) return source;
    source =
      source.slice(0, replacement.start) +
      replacement.text +
      source.slice(replacement.end);
  }
}

/**
 * Lists authored TypeScript sources without generated files or application code.
 *
 * @param directory SDK source directory to enumerate.
 * @returns Absolute source paths.
 */
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
      ? [join(directory, entry.name)]
      : [],
  );
}

/**
 * Formats SDK sources or reports files that need formatting.
 */
async function main() {
  const check = process.argv.includes('--check');
  const options = await prettier.resolveConfig(join(root, 'src/index.ts'));
  let failures = 0;
  for (const filename of files(join(root, 'src'))) {
    const source = readFileSync(filename, 'utf8');
    const formatted = formatCalls(
      filename,
      formatDeclarations(
        filename,
        prettier.format(source, { ...options, filepath: filename }),
      ),
    );
    // Refuse to write if formatting changes any parsed code or literal content.
    const printer = ts.createPrinter({ removeComments: true });
    const code = value =>
      prettier.format(
        printer.printFile(
          ts.createSourceFile(filename, value, ts.ScriptTarget.Latest, true),
        ),
        { ...options, filepath: filename },
      );
    if (code(source) !== code(formatted))
      throw new Error(`${filename}: formatting would change parsed code`);
    if (source === formatted) continue;
    if (check) {
      process.stderr.write(`${filename}: SDK formatting differs\n`);
      failures++;
    } else writeFileSync(filename, formatted);
  }
  if (failures) process.exitCode = 1;
  else
    process.stdout.write(`SDK formatting ${check ? 'checked' : 'applied'}.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main();
