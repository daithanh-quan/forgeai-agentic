import fs from 'node:fs';
import path from 'node:path';
import { getArgValue, root } from './context.js';

export const SYSTEM_ONE_SIGNAL_NAMES = [
  'mechanical',
  'bounded_context',
  'deterministic_output',
  'cheap_verification',
  'ambiguous',
  'high_risk',
  'requires_synthesis',
] as const;

export type SystemOneSignalName = typeof SYSTEM_ONE_SIGNAL_NAMES[number];
export type SystemOneSignal = { probability: number; confidence: number };
export type SystemOneInput = {
  signals: Record<SystemOneSignalName, SystemOneSignal>;
  threshold?: number;
};
export type SystemOneDecision = {
  schema_version: 1;
  decision: 'answer_now' | 'fast' | 'deliberate';
  tier: 'direct' | 'fast' | 'standard';
  confidence: number;
  eligibility_lower_bound: number;
  uncertainty: number;
  vetoes: string[];
  effective_probabilities: Record<SystemOneSignalName, number>;
};

function boundedProbability(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a finite number from 0 to 1`);
  }
  return value;
}

function binaryEntropy(probability: number): number {
  if (probability === 0 || probability === 1) return 0;
  return -(probability * Math.log2(probability) + (1 - probability) * Math.log2(1 - probability));
}

export function decideSystemOneRoute(input: SystemOneInput): SystemOneDecision {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || typeof input.signals !== 'object' || input.signals === null) {
    throw new Error('input must contain a signals object');
  }

  const effective = {} as Record<SystemOneSignalName, number>;
  for (const name of SYSTEM_ONE_SIGNAL_NAMES) {
    const signal = input.signals[name];
    if (typeof signal !== 'object' || signal === null || Array.isArray(signal)) {
      throw new Error(`signals.${name} must contain probability and confidence`);
    }
    const probability = boundedProbability(signal.probability, `signals.${name}.probability`);
    const confidence = boundedProbability(signal.confidence, `signals.${name}.confidence`);
    effective[name] = 0.5 + (probability - 0.5) * confidence;
  }

  const desired = [
    effective.mechanical,
    effective.bounded_context,
    effective.deterministic_output,
    effective.cheap_verification,
    1 - effective.ambiguous,
    1 - effective.high_risk,
    1 - effective.requires_synthesis,
  ];
  const eligibilityLowerBound = Math.max(0, 1 - desired.reduce((sum, probability) => sum + (1 - probability), 0));
  const uncertainty = desired.reduce((sum, probability) => sum + binaryEntropy(probability), 0) / desired.length;
  const confidence = Math.min(...desired);
  const threshold = input.threshold === undefined
    ? 0.85
    : boundedProbability(input.threshold, 'threshold');
  const vetoes: string[] = [];

  if (effective.high_risk >= 0.2) vetoes.push('high_risk');
  if (effective.ambiguous >= 0.25) vetoes.push('ambiguous');
  if (effective.requires_synthesis >= 0.25) vetoes.push('requires_synthesis');
  if (effective.cheap_verification < 0.8) vetoes.push('verification_not_cheap');

  const answerNow = vetoes.length === 0
    && eligibilityLowerBound >= threshold
    && confidence >= 0.85
    && uncertainty <= 0.45;
  const fast = !answerNow
    && !vetoes.includes('high_risk')
    && effective.ambiguous < 0.45
    && effective.requires_synthesis < 0.45
    && confidence >= 0.6;

  return {
    schema_version: 1,
    decision: answerNow ? 'answer_now' : fast ? 'fast' : 'deliberate',
    tier: answerNow ? 'direct' : fast ? 'fast' : 'standard',
    confidence,
    eligibility_lower_bound: eligibilityLowerBound,
    uncertainty,
    vetoes,
    effective_probabilities: effective,
  };
}

export function runSystemOneRoute(): void {
  const signalsPath = getArgValue('--signals');
  if (!signalsPath) {
    process.stderr.write('Usage: forgeai-init --system-one-route --signals <json-file>\n');
    process.exitCode = 2;
    return;
  }

  try {
    const absolutePath = path.resolve(root, signalsPath);
    const input = JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as SystemOneInput;
    process.stdout.write(`${JSON.stringify(decideSystemOneRoute(input), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`System One routing failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
