---
description: Automated CI/CD pipeline for Geon (Continuous Integration and Deployment)
---

This workflow handles the building, testing, and release of new versions. It should be triggered manually or after major changes.

### 🧪 1. CI: Run Testing Workflow
Run all quality gates and tests before proceeding.
// turbo
```bash
/test
```

### 🔨 2. CI: Build Binary
Compile the binary for distribution.
// turbo
```bash
bun run build
```

### 🔖 3. CD: Version Bump & Tagging
Prepare for a new release.
*   Update `package.json` with the new version.
*   Create a Git tag.
*   Push to remote origin.

### 🚀 4. CD: Publish to Registry
Publish the final package to the NPM registry once tests pass.
// turbo
```bash
npm publish --access public
```

### 🏁 5. Post-Release
*   Verify the page on [NPM](https://www.npmjs.com/package/geon-agent).
*   Inform the users of the results of the CI/CD job.
