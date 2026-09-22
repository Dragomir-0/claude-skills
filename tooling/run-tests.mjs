#!/usr/bin/env node
// Runs every test file in one process. Usage: node run-tests.mjs
import { run } from '../map-codebase/harness.mjs'
import './cli.test.mjs'
import './lib/complexity-scoring.test.mjs'
import './lib/drift-guard.test.mjs'
import './lib/git-orchestration.test.mjs'
import './lib/commit-composer.test.mjs'
import './lib/changelog.test.mjs'
import './lib/plan-pruning.test.mjs'
import './lib/cross-repo-table.test.mjs'

process.exit(await run())
