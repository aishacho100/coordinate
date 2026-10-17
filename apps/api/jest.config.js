/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // fastify の light-my-request が使う cookie@2 は ESM のみのため、ts-jest で CommonJS に変換する。
  transformIgnorePatterns: ['/node_modules/(?!cookie/)'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          strict: true,
          noUncheckedIndexedAccess: true,
          esModuleInterop: true,
          allowJs: true,
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
};
