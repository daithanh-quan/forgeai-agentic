#!/usr/bin/env node
import {
  help,
  version,
  listProfiles,
  checkGit,
  checkSessions,
  checkLifecycle,
  checkCodeGraph,
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
  checkApproval,
  checkEvaluation,
  statusSummary,
  diffSummary,
  testSummary,
  strict,
  watch,
  emit
} from './lib/context.js';
import { runWatch } from './lib/watch.js';
import { runEmit } from './lib/emit.js';
import { getPackageVersion } from './lib/utils.js';
import { getAvailableProfiles, runCheckProfile } from './lib/profiles.js';
import { runAddModel, runListModels, runRemoveModel } from './lib/model-routing.js';
import { runUpdatePreflight } from './lib/update-check.js';
import { runCheckSessions } from './lib/sessions.js';
import { runCheckLifecycle } from './lib/lifecycle.js';
import { runCheckCodeGraph } from './lib/codegraph.js';
import { runCheckGit } from './lib/git.js';
import { runCheck, runCheckAll } from './lib/check.js';
import { runCheckReview } from './lib/review.js';
import { runCheckSecurity } from './lib/security.js';
import { runCheckMemory } from './lib/memory.js';
import { runDecompose } from './lib/decompose.js';
import { runContextPack } from './lib/context-pack.js';
import { runStatusSummary, runDiffSummary, runTestSummary } from './lib/diagnostics.js';
import { runCheckApproval } from './lib/approval.js';
import { runCheckEvaluation } from './lib/evaluation.js';
import { usage, runInit } from './lib/init.js';

runUpdatePreflight();

if (help) console.log(usage());
else if (version) console.log(getPackageVersion());
else if (listProfiles) console.log(['base', ...getAvailableProfiles()].join('\n'));
else if (checkGit) runCheckGit();
else if (checkSessions) runCheckSessions();
else if (checkLifecycle) runCheckLifecycle();
else if (checkCodeGraph) runCheckCodeGraph({ strict });
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
else if (checkApproval) runCheckApproval();
else if (checkEvaluation) runCheckEvaluation();
else if (statusSummary) runStatusSummary();
else if (diffSummary) runDiffSummary();
else if (testSummary) runTestSummary();
else if (watch) runWatch();
else if (emit) runEmit();
else runInit();
