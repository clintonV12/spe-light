// Vite's `?raw` suffix imports a file as a plain string at build time —
// TypeScript doesn't know about this convention on its own, so every
// `import x from './file.md?raw'` needs this declared somewhere in the
// project. If a `vite-env.d.ts` (or similar) already declares `*.md?raw` or
// a blanket `*?raw`, this file is redundant and safe to delete — TypeScript
// module declarations are additive, so having both isn't an error, just
// duplication.
declare module '*.md?raw' {
  const content: string
  export default content
}