const { test } = require('node:test');
const assert = require('node:assert/strict');
const checker = import('../scripts/check-sdk-comments.mjs');

const documented = (summary, tags = '') =>
  `/**\n * ${summary}\n${tags}\n */\n`;

test('comment checker validates formal parameter order, including optional arguments', async () => {
  const { checkTypeScriptComments } = await checker;
  const wrong = documented('Transfers one file.', ' * @param signal Caller cancellation.\n * @param source Readable file.') +
    'export function transfer(source: string, signal?: AbortSignal): Promise<void> { return Promise.resolve(); }';
  assert(checkTypeScriptComments('fixture.ts', wrong).some(message => message.includes('@param order must be: source, signal')));
  const fixed = wrong.replace('@param signal Caller cancellation.\n * @param source Readable file.', '@param source Readable file.\n * @param signal Caller cancellation.');
  assert.deepEqual(checkTypeScriptComments('fixture.ts', fixed), []);
});

test('comment checker covers private fields and callable constructor properties', async () => {
  const { checkTypeScriptComments } = await checker;
  const source = documented('Owns one transfer.') + 'class Owner { private active = false;\n' +
    documented('Creates the owner.', ' * @param send Packet sender.\n * @returns Initialized owner.') +
    'constructor(' + documented('Packet transport.') + 'private send: (packet: string) => Promise<void>) {} }';
  const failures = checkTypeScriptComments('fixture.ts', source);
  assert(failures.some(message => message.includes('active requires one documentation block')));
  assert(failures.some(message => message.includes('send @param order must be: packet')));
});

test('comment checker accepts documented aliases, getters and destructured option objects', async () => {
  const { checkTypeScriptComments } = await checker;
  const source = documented('Receives transferred bytes.', ' * @param bytes Transferred byte count.') +
    'type Progress = (bytes: number) => void;\n' +
    documented('Starts a transfer.', ' * @param options Transfer settings.') +
    'function start({ source }: {\n' + documented('Readable source.') + 'source: string }): void {}\n' +
    documented('Owns a transfer.') + 'class Owner {\n' + documented('Current activity.', ' * @returns Whether a transfer is active.') +
    'get active(): boolean { return false; } }';
  assert.deepEqual(checkTypeScriptComments('fixture.ts', source), []);
});

test('comment checker rejects single-line blocks and mismatched header filenames', async () => {
  const { checkTypeScriptComments, checkHeader } = await checker;
  assert(checkTypeScriptComments('fixture.ts', '/** One value. */\nexport const value = 1;').some(message => message.includes('multiline')));
  const source = require('node:fs').readFileSync(require.resolve('../src/index.ts'), 'utf8');
  assert.deepEqual(checkHeader('src/index.ts', source), []);
  assert.equal(checkHeader('src/Other.ts', source).length, 1);
});


test('comment checker allows result semantics in summaries and omits void return tags', async () => {
  const { checkTypeScriptComments } = await checker;
  const callback = documented('Receives a sample.', ' * @param bytes Sample byte count.') +
    'type Sample = (bytes: number) => void;';
  assert.deepEqual(checkTypeScriptComments('fixture.ts', callback), []);
  const asyncOperation = documented('Finishes pending writes.') +
    'function flush(): Promise<void> { return Promise.resolve(); }';
  assert.deepEqual(checkTypeScriptComments('fixture.ts', asyncOperation), []);
  const redundant = callback.replace('Sample byte count.', 'Sample byte count.\n * @returns No value.');
  assert(checkTypeScriptComments('fixture.ts', redundant).some(message => message.includes('must omit void')));
});

test('SDK formatter preserves nested callback signatures, property documentation and program semantics', async () => {
  const { formatDeclarations } = await import('../scripts/format-sdk.mjs');
  const { checkTypeScriptLayout } = await checker;
  const ts = require('typescript');
  const source = `class Owner {
  /** Owns packet delivery. */
  constructor(
    /** Sends packets. */
    private send: (packet: string) => void,
    /** Tracks packet count. */
    private count: number,
  ) {}
  bind(listener: (event: { type: string; size: number }) => void) {}
}`;
  const formatted = formatDeclarations('fixture.ts', source);
  assert.match(formatted, /class Owner \{\n\n/);
  assert.match(formatted, /bind\(\n    listener: \(\n      event:/);
  assert.match(formatted, /void,\n\n    \/\*\* Tracks packet count/);
  assert.deepEqual(checkTypeScriptLayout('fixture.ts', formatted), []);
  assert.equal(formatDeclarations('fixture.ts', formatted), formatted);
  const print = value => ts.createPrinter({ removeComments: true }).printFile(
    ts.createSourceFile('fixture.ts', value, ts.ScriptTarget.Latest, true),
  );
  assert.equal(print(formatted), print(source));
});

test('SDK formatter preserves multiline literal defaults when expanding an inline parameter type', async () => {
  const { formatDeclarations } = await import('../scripts/format-sdk.mjs');
  const source = 'function use(options: { label: string } = { label: `first  \nsecond` }) {}';
  const formatted = formatDeclarations('fixture.ts', source);
  assert(formatted.includes('`first  \nsecond`'));
  assert.equal(formatDeclarations('fixture.ts', formatted), formatted);
});


test('constructor field documentation remains sufficient when incidental validation is added', async () => {
  const { checkTypeScriptComments } = await checker;
  const prefix = documented('Owns transfer content.') + 'class Owner {\n' +
    documented('The content to transfer.') + 'private readonly data: string;\n' +
    documented('Creates transfer content.');
  const assignment = prefix + 'constructor(data: string) { this.data = data; } }';
  assert.deepEqual(checkTypeScriptComments('fixture.ts', assignment), []);
  const validation = prefix + 'constructor(data: string) { if (!data) throw new Error(); this.data = data; } }';
  assert.deepEqual(checkTypeScriptComments('fixture.ts', validation), []);
  const unmapped = prefix + 'constructor(source: string) { this.data = source; } }';
  assert(checkTypeScriptComments('fixture.ts', unmapped).some(message => message.includes('@param order must be: source')));
});

test('documentation language check accepts English across source languages and preserves header attribution', async () => {
  const { checkDocumentationLanguage } = await checker;
  for (const extension of ['ts', 'tsx', 'kt', 'h', 'mm']) {
    assert.deepEqual(checkDocumentationLanguage(`fixture.${extension}`, documented('Stops the current task.', ' * @param taskID The generation task identifier.')), []);
    assert(checkDocumentationLanguage(`fixture.${extension}`, documented('Stops the current task.', ' * @param taskID 任务标识。')).length);
  }
  assert.deepEqual(checkDocumentationLanguage('fixture.swift', '/// The uplink video statistics.\n///\n/// - Returns: The current sample.'), []);
  assert(checkDocumentationLanguage('fixture.swift', '/// 上行视频统计。').length);
  const header = '// Author: 翁跃庭 (Yueting Weng)\n';
  const runtime = 'const message = "上传成功";\n';
  assert.deepEqual(checkDocumentationLanguage('fixture.ts', header + runtime + documented('The upload result.')), []);
});

test('comment checker rejects return tags on asynchronous void methods', async () => {
  const { checkTypeScriptComments } = await checker;
  const source = documented('Releases pending writes.', ' * @returns Completion.') +
    'function flush(): Promise<void> { return Promise.resolve(); }';
  assert(checkTypeScriptComments('fixture.ts', source).some(message => message.includes('must omit void')));
});

test('SDK call formatter expands nested arguments while preserving comments, literal whitespace and interpolation', async () => {
  const { formatCalls } = await import('../scripts/format-sdk.mjs');
  const ts = require('typescript');
  const source = 'const result = send(first, nested(second, `line  \nkeep`), /* keep this reason */ third);\n' +
    'const label = `value: ${send(first, second)}`;\n' +
    'const bound = Math.min(first, second);';
  const formatted = formatCalls('fixture.ts', source);
  assert.match(formatted, /send\(\n  first,/);
  assert.match(formatted, /nested\(\n    second,/);
  assert(formatted.includes('`line  \nkeep`'));
  assert(formatted.includes('/* keep this reason */'));
  assert(formatted.includes('`value: ${send(first, second)}`'));
  assert(formatted.includes('Math.min(first, second)'));
  const interpolation = 'const label = `video: ${size(\n  width,\n  height,\n)}\nkeep  literal`;';
  const compact = formatCalls('fixture.ts', interpolation);
  assert(compact.includes('size(width, height)'));
  assert(compact.includes('\nkeep  literal`'));

  assert.equal(formatCalls('fixture.ts', formatted), formatted);
  const print = value => ts.createPrinter({ removeComments: true }).printFile(
    ts.createSourceFile('fixture.ts', value, ts.ScriptTarget.Latest, true),
  );
  assert.equal(print(formatted), print(source));
});

test('SDK call formatter preserves comments before argument separators and after the last argument', async () => {
  const { formatCalls } = await import('../scripts/format-sdk.mjs');
  const ts = require('typescript');
  const source = 'send(first /* comma, inside a comment */, second /* keep the last reason */);';
  const formatted = formatCalls('fixture.ts', source);
  assert(formatted.includes('first /* comma, inside a comment */,'));
  assert(formatted.includes('/* keep the last reason */'));
  assert.equal(formatCalls('fixture.ts', formatted), formatted);
  const print = value => ts.createPrinter({ removeComments: true }).printFile(
    ts.createSourceFile('fixture.ts', value, ts.ScriptTarget.Latest, true),
  );
  assert.equal(print(formatted), print(source));
});
