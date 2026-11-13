// AUTHORED-BY Codex GPT-6.1-Sol
import type { NativeRequest, NativeResult } from '@jeswr/agent-vault/browser';

export type VaultRequest = NativeRequest extends infer R
  ? R extends NativeRequest
    ? Omit<R, 'id'>
    : never
  : never;
export type CaptureChoices = Extract<NativeResult, { type: 'list' }>;
export type CapturePhase =
  | 'loading'
  | 'ready'
  | 'reviewing'
  | 'permission'
  | 'prompt'
  | 'confirming'
  | 'sending'
  | 'cleaning'
  | 'cancelled'
  | 'shared'
  | 'failed'
  | 'busy';
export interface CaptureView {
  phase: CapturePhase;
  message: string;
  warning: boolean;
  cleanupFailed: boolean;
  lease?: number;
  site?: string;
  choices?: CaptureChoices;
  preview?: { count: number; persona: string; profile: string };
}
export type CaptureIntent =
  | { type: 'load' | 'removeCookieAccess' }
  | { type: 'start'; profile: string; persona: string }
  | { type: 'requesting' | 'confirm' | 'cancel'; lease: number }
  | { type: 'permission'; lease: number; granted: boolean };

export const terminalCapturePhase = (phase: CapturePhase) =>
  phase === 'cancelled' || phase === 'shared' || phase === 'failed';

/** Closed intent protocol. Cookies and native requests are never accepted from the popup. */
export function captureIntent(input: unknown): CaptureIntent | undefined {
  if (!input || typeof input !== 'object' || !('type' in input)) return;
  const keys = Object.keys(input).sort().join(',');
  if ((input.type === 'load' || input.type === 'removeCookieAccess') && keys === 'type')
    return input as CaptureIntent;
  if (
    input.type === 'start' &&
    keys === 'persona,profile,type' &&
    'profile' in input &&
    typeof input.profile === 'string' &&
    input.profile.length <= 128 &&
    'persona' in input &&
    typeof input.persona === 'string' &&
    input.persona.length <= 128
  )
    return input as CaptureIntent;
  if (!('lease' in input) || !Number.isSafeInteger(input.lease) || Number(input.lease) <= 0) return;
  if (['requesting', 'confirm', 'cancel'].includes(String(input.type)) && keys === 'lease,type')
    return input as CaptureIntent;
  if (
    input.type === 'permission' &&
    keys === 'granted,lease,type' &&
    'granted' in input &&
    typeof input.granted === 'boolean'
  )
    return input as CaptureIntent;
}
