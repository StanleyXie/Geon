---
description: Run the complete testing suite for Geon (Unit, Integration, E2E, Security)
---

This workflow provides a standardized way to verify the quality of the codebase before any commit or release.

### 🧪 1. Unit Testing
Run the core unit tests for logic, context management, and adapters.
// turbo
```bash
bun test
```

### 🌉 2. Integration Testing
Run tests that verify interactions with external models (mocks or local instances).
// turbo
```bash
bun test src/__tests__/adapters.test.ts src/__tests__/server-helpers.test.ts
```

### 3. E2E Testing (System Verification)
Perform a full boot and basic prompt check to ensure the binary is stable.
// turbo
```bash
bun run build && dist/geon --version
```

### 🛡️ 4. Security Testing & Assessment
Perform a security audit of dependencies and secret scanning.
// turbo
```bash
bun audit
```

### 🏁 5. Final Quality Gate
Run type-checking to ensure no regressions in TypeScript definitions.
// turbo
```bash
bun run typecheck
```
