import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root, packageName, skipUpdateCheck, help, version, listProfiles, checkUpdates, checkUpgrade } from './context.js';
import { getPackageVersion, getLatestPackageVersion, compareSemver, parseSemver, formatStatus } from './utils.js';
import { readManifest, readManifestResult } from './manifest.js';

export function shouldRunUpdateCheck(overrides?: { checkUpgrade?: boolean; interactive?: boolean; ci?: boolean }): boolean {
  const checkingUpgrade = overrides?.checkUpgrade ?? checkUpgrade;
  const interactive = overrides?.interactive ?? isInteractiveTerminal();
  const runningInCi = overrides?.ci ?? process.env.CI === 'true';
  if (skipUpdateCheck) return false;
  if (help || version || listProfiles || checkingUpgrade) return false;
  if (runningInCi) return false;
  if (!checkUpdates && !interactive && !process.env.FORGEAI_TEST_LATEST_VERSION) return false;
  return true;
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function promptUpdateChoice(latestVersion: string): 'skip' | 'update' {
  console.log('');
  console.log(`ForgeAI ${latestVersion} is available.`);
  console.log('Choose an option:');
  console.log('  1. Skip for now');
  console.log('  2. Update the ForgeAI harness to latest');
  process.stdout.write('Select 1 or 2: ');

  const buffer = Buffer.alloc(32);
  const bytesRead = fs.readSync(0, buffer, 0, buffer.length, null);
  const choice = buffer.subarray(0, bytesRead).toString('utf8').trim();
  return choice === '2' ? 'update' : 'skip';
}

export function rerunWithLatest(): void {
  const result = spawnSync('npx', [`${packageName}@latest`, '--upgrade', '--skip-update-check'], {
    cwd: root,
    env: { ...process.env, FORGEAI_SKIP_UPDATE_CHECK: '1' },
    stdio: 'inherit'
  });

  process.exit(result.status ?? 1);
}

export function runCheckUpgrade(): void {
  const currentVersion = getPackageVersion();
  const manifestResult = readManifestResult();

  if (manifestResult.state === 'missing') {
    console.log('no harness installed. Run forgeai-init to install.');
    process.exitCode = 1;
    return;
  }

  if (manifestResult.state === 'invalid') {
    console.log(`manifest is corrupt (${manifestResult.reason}); re-run forgeai-init --upgrade --profile <name> to recover`);
    process.exitCode = 1;
    return;
  }

  const manifest = manifestResult.data;

  if (!parseSemver(currentVersion)) {
    console.log(`cannot determine CLI version: "${currentVersion}"`);
    process.exitCode = 1;
    return;
  }

  if (manifest.package !== packageName) {
    console.log(`invalid manifest package: "${manifest.package}" (expected "${packageName}")`);
    process.exitCode = 1;
    return;
  }

  const installedVersion = manifest.package_version;
  if (!parseSemver(installedVersion)) {
    console.log(`invalid manifest package_version: "${installedVersion ?? 'undefined'}"`);
    process.exitCode = 1;
    return;
  }

  const comparison = compareSemver(installedVersion, currentVersion);

  if (comparison === 0) {
    console.log(formatStatus('ok', `harness ${installedVersion} matches CLI ${currentVersion}`));
    return;
  }

  if (comparison < 0) {
    console.log(formatStatus('outdated', `harness ${installedVersion} < CLI ${currentVersion}`));
    console.log(`Run: npx ${packageName}@${currentVersion} --upgrade`);
    process.exitCode = 1;
    return;
  }

  console.log(formatStatus('cli-too-old', `harness ${installedVersion} > CLI ${currentVersion}`));
  console.log('The installed harness is newer than this CLI. Use a newer CLI version.');
  process.exitCode = 1;
}

export function runUpdatePreflight(): void {
  if (!shouldRunUpdateCheck()) return;

  const currentVersion = getPackageVersion();
  const manifestResult2 = readManifestResult();
  const manifest = manifestResult2.state === 'valid' ? manifestResult2.data : null;
  const installedVersion = manifest?.package_version;
  const latest = getLatestPackageVersion();

  if (!latest.version) {
    if (isInteractiveTerminal()) {
      console.log(formatStatus('update skipped', `could not check latest ${packageName} version${latest.error ? ` (${latest.error})` : ''}`));
    }
    return;
  }

  const currentIsOutdated = compareSemver(currentVersion, latest.version) < 0;
  const installedIsOutdated = installedVersion ? compareSemver(installedVersion, latest.version) < 0 : false;
  if (!currentIsOutdated && !installedIsOutdated) return;

  console.log('ForgeAI update check');
  console.log(formatStatus(installedVersion && installedIsOutdated ? 'outdated' : 'ok', `installed harness: ${installedVersion ?? 'not installed yet'}`));
  console.log(formatStatus(currentIsOutdated ? 'outdated' : 'ok', `current CLI: ${currentVersion}`));
  console.log(formatStatus('latest', `${packageName}@${latest.version}`));

  if (!isInteractiveTerminal()) {
    console.log(`Recommendation: ask the human to run npx ${packageName}@latest --upgrade, or skip this update for now.`);
    console.log('');
    return;
  }

  if (promptUpdateChoice(latest.version) === 'update') rerunWithLatest();
  console.log('Skipping update for now.');
  console.log('');
}
