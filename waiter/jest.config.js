module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../src/shared/$1',
    // src/shared lives outside this folder: what it (and babel's output for it) imports comes
    // from waiter/node_modules, as Metro does (metro.config.js), never from the till's.
    '^decimal\.js$': '<rootDir>/node_modules/decimal.js',
    '^zod$': '<rootDir>/node_modules/zod',
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|lucide-react-native|react-native-svg)',
  ],
};
