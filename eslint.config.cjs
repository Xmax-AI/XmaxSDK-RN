const reactNative = require('@react-native/eslint-config/flat');
module.exports = [
  { ignores: ['lib/**', 'docs/**', '**/Pods/**', '**/build/**', 'vendor/**'] },
  // This project uses TypeScript; do not enable the template's Flow-only rules.
  ...reactNative.filter(config => !config.plugins?.['ft-flow']),
  { rules: { 'no-void': ['error', { allowAsStatement: true }] } },
  {
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'Example/XLab/App.tsx',
      'Example/XLab/src/**/*.ts',
      'Example/XLab/src/**/*.tsx',
    ],
    rules: {
      'lines-between-class-members': [
        'error',
        {
          enforce: [
            { blankLine: 'always', prev: '*', next: 'method' },
            { blankLine: 'always', prev: 'method', next: '*' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'Example/XLab/App.tsx',
      'Example/XLab/src/**/*.ts',
      'Example/XLab/src/**/*.tsx',
    ],
    rules: {
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'function' },
        { blankLine: 'always', prev: 'function', next: '*' },
      ],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'lines-between-class-members': ['error', 'always'],
    },
  },
  // UUID encoding and the public logging bitmask intentionally use bitwise operations.
  {
    files: ['src/Foundation/Runtime/RuntimeInfo.ts', 'src/Core/XmaxClient.ts'],
    rules: { 'no-bitwise': 'off' },
  },
  {
    files: ['Example/XLab/*.js'],
    languageOptions: { parserOptions: { requireConfigFile: false } },
  },
];
