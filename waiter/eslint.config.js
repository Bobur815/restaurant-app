// Expo's flat config, plus the rules the till keeps: no floats on money is checked by review,
// this only catches the obvious.
const expo = require('eslint-config-expo/flat');

module.exports = [
  ...expo,
  {
    ignores: ['android/**', 'ios/**', '.expo/**', 'node_modules/**', 'scripts/**', 'plugins/**', 'dist/**'],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
];
