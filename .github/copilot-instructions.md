# Project Instructions

- This repository is a Windows-only Node.js/TypeScript CLI for preparing ICM CUSS airport simulator environments.
- Keep changes focused and follow the existing CommonJS, strict TypeScript, and configuration-file conventions.
- Treat registry writes, edits under `Program Files`, folder copies, and simulator launches as consequential side effects. Do not run the setup workflow or make those changes unless the user explicitly asks.
- Preserve the workflow's explicit confirmation before writing simulator configuration files, and keep repeated runs idempotent.
- Before changing behavior, inspect the relevant implementation and configuration. Do not assume local machine paths or registry state beyond what the code and configuration show.
- For code changes, validate with `npx tsc --noEmit` when practical. The setup command has real machine side effects and is not a routine test.
