/**
 * Baton release version.
 *
 * Release builds inline it at compile time:
 *   bun build ... --define 'process.env.BATON_VERSION="1.2.3"'
 * so a compiled binary reports the tag it was built from. Unbundled dev runs
 * (`bun run src/index.ts`) can set BATON_VERSION in the environment; otherwise
 * they report `0.0.0-dev`. The `typeof process` guard keeps this safe in the
 * browser / React Native, where `process` may not exist.
 */
export const BATON_VERSION: string =
  (typeof process !== 'undefined' && process.env.BATON_VERSION) || '0.0.0-dev';
