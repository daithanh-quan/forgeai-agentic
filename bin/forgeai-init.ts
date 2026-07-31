#!/usr/bin/env node
import {
  help,
  version,
  listProfiles,
  checkGit,
  checkSessions,
  checkLifecycle,
  checkCodeGraph,
  refreshCodeGraph,
  checkProfile,
  checkAll,
  checkReview,
  checkSecurity,
  checkMemory,
  check,
  checkUpdates,
  addModel,
  listModels,
  removeModel,
  decompose,
  contextPack,
  compileContext,
  checkApproval,
  checkEvaluation,
  statusSummary,
  diffSummary,
  testSummary,
  strict,
  watch,
  emit,
  validateArtifact as validateArtifactFlag,
  route,
  expandContext,
  listRuns,
  evaluate,
  report,
  checkUpgrade,
  overrideFlag,
} from './lib/context.js';
import { runValidateArtifact, runRoute } from './lib/router.js';
import { runExpandContext } from './lib/context-expansion.js';
import { runWatch } from './lib/watch.js';
import { runEmit } from './lib/emit.js';
import { getPackageVersion } from './lib/utils.js';
import { getAvailableProfiles, runCheckProfile } from './lib/profiles.js';
import { runAddModel, runListModels, runRemoveModel } from './lib/model-routing.js';
import { runUpdatePreflight, runCheckUpgrade } from './lib/update-check.js';
import { runCheckSessions } from './lib/sessions.js';
import { runCheckLifecycle } from './lib/lifecycle.js';
import { runCheckCodeGraph } from './lib/codegraph.js';
import { runRefreshCodeGraph } from './lib/dependency-graph.js';
import { runCheckGit } from './lib/git.js';
import { runCheck, runCheckAll } from './lib/check.js';
import { runCheckReview } from './lib/review.js';
import { runCheckSecurity } from './lib/security.js';
import { runCheckMemory } from './lib/memory.js';
import { runDecompose } from './lib/decompose.js';
import { runContextPack } from './lib/context-pack.js';
import { runCompileContext } from './lib/context-compiler.js';
import { runStatusSummary, runDiffSummary, runTestSummary } from './lib/diagnostics.js';
import { runCheckApproval } from './lib/approval.js';
import { runCheckEvaluation } from './lib/evaluation.js';
import { usage, runInit } from './lib/init.js';
import { runListRuns } from './lib/run-record.js';
import { runEvaluate } from './lib/evaluation-record.js';
import { runReport } from './lib/evaluation-report.js';

runUpdatePreflight();

// The human-override flags (--outcome/--reason/--by/--clear-outcome) are honored only
// by --evaluate. Because the dispatch chain below picks the FIRST matching command, a
// higher-precedence command (e.g. --version, --check) would run and silently drop the
// decision. Require that --evaluate is the *selected* command: it is, iff --evaluate is
// set and none of the commands dispatched before it are. Keep this list in sync with the
// order of the chain below (every command that appears before `evaluate`).
if (overrideFlag) {
  const commandsBeforeEvaluate = [
    help, version, listProfiles, checkGit, checkSessions, checkLifecycle, checkCodeGraph,
    refreshCodeGraph, checkProfile, checkReview, checkSecurity, checkMemory, checkAll,
    check, checkUpdates, addModel, listModels, removeModel, decompose, contextPack,
    compileContext, checkApproval, checkEvaluation, statusSummary, diffSummary,
    testSummary, watch, emit, validateArtifactFlag, route, listRuns,
  ];
  if (!evaluate || commandsBeforeEvaluate.some(Boolean)) {
    process.stderr.write(`Error: ${overrideFlag} is only valid with --evaluate.\n`);
    process.exit(1);
  }
}

if (help) console.log(usage());
else if (version) console.log(getPackageVersion());
else if (listProfiles) console.log(['base', ...getAvailableProfiles()].join('\n'));
else if (checkGit) runCheckGit();
else if (checkSessions) runCheckSessions();
else if (checkLifecycle) runCheckLifecycle();
else if (checkCodeGraph) runCheckCodeGraph({ strict });
else if (refreshCodeGraph) runRefreshCodeGraph();
else if (checkProfile) runCheckProfile();
else if (checkReview) runCheckReview();
else if (checkSecurity) runCheckSecurity();
else if (checkMemory) runCheckMemory();
else if (checkAll) runCheckAll();
else if (check) runCheck();
else if (checkUpdates) console.log('Update check complete.');
else if (addModel) runAddModel();
else if (listModels) runListModels();
else if (removeModel) runRemoveModel();
else if (decompose) runDecompose();
else if (contextPack) runContextPack();
else if (compileContext) runCompileContext();
else if (checkApproval) runCheckApproval();
else if (checkEvaluation) runCheckEvaluation();
else if (statusSummary) runStatusSummary();
else if (diffSummary) runDiffSummary();
else if (testSummary) runTestSummary();
else if (watch) runWatch();
else if (emit) runEmit();
else if (validateArtifactFlag) runValidateArtifact();
else if (route) await runRoute();
else if (listRuns) runListRuns();
else if (evaluate) runEvaluate();
else if (report) runReport();
else if (expandContext) runExpandContext();
else if (checkUpgrade) runCheckUpgrade();
else runInit();
