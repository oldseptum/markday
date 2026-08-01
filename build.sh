#!/usr/bin/env bash
# Builds main.js from src/ (ES modules, bundled by esbuild) and runs the test suite.
# Requires Node.js. First run: npm install
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
npm run build
npm test
