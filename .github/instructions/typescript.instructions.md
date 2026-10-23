---
applyTo: "**/*.ts"
---

# TypeScript Instructions

- Keep code compatible with the project's `strict` TypeScript settings, ES2020 target, and CommonJS modules.
- Prefer explicit, useful types; avoid introducing `any` or weakening compiler settings to bypass errors.
- Use Node.js APIs and dependencies already present in the project unless a new dependency is necessary.
- Keep changes localized, preserve existing behavior outside the requested change, and handle filesystem, process, and registry errors clearly.
- Validate TypeScript changes with `npx tsc --noEmit` when practical. Do not invoke the setup workflow as a test because it can modify the machine.