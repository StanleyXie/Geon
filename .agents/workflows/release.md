---
description: Automated CI/CD pipeline for Geon (Continuous Integration and Deployment)
---

This workflow automates the build, test, and release process for Geon. Use this to safely push a new version to GitHub and NPM.

// turbo-all
### 🚢 1. Pre-release Quality Gate
Run the complete test suite to ensure no regressions.
```bash
/test
```

### 🏷️ 2. Version Bump
Bump the version in `package.json` (e.g., patch, minor).
```bash
# Example: bun version patch
# Use 'bun version minor' or 'bun version major' if needed
bun version patch
```

### 📦 3. Build & Compile
Generate the final production binary for distribution.
```bash
bun run build
```

### 🚀 4. Publish to NPM
Release the scoped package to the public NPM registry.
```bash
npm publish --access public
```

### 🚩 5. Sync with GitHub
Push the new version, tags, and code to the remote repository.
```bash
git push --follow-tags
```
