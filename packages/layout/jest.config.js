/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          strict: true,
          noUncheckedIndexedAccess: true,
          esModuleInterop: true,
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
};
