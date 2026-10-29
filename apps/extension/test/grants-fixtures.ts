// AUTHORED-BY Codex GPT-6.1-Sol
import type { OriginGrant } from '../src/background/core/origin-grant';
import type { Profile } from '../src/shared/messages';

export const NOW = 1_800_000_000_000;
export const DAY = 86_400_000;
export const SITE = 'https://calendar.example';
export const profiles: readonly Profile[] = [
  {
    id: '1',
    label: 'Personal account',
    webId: 'https://pod.example/me#id',
    issuer: 'https://pod.example',
    dpopKeyRef: '1',
    sessionState: 'active',
  },
  {
    id: '2',
    label: 'Work',
    webId: 'https://work.example/me#id',
    issuer: 'https://work.example',
    dpopKeyRef: '2',
    sessionState: 'active',
    avatar: 'https://work.example/photo.jpg',
  },
  {
    id: '3',
    label: 'Old account',
    webId: 'https://old.example/me#id',
    issuer: 'https://old.example',
    dpopKeyRef: '3',
    sessionState: 'signed-out',
  },
];

export function siteGrant(overrides: Partial<OriginGrant> = {}): OriginGrant {
  return {
    origin: SITE,
    profileId: '1',
    createdAt: NOW - DAY,
    scope: {
      pods: ['https://pod.example'],
      classes: [
        {
          grantId: 'documents',
          origin: SITE,
          webId: profiles[0].webId,
          dataClass: 'https://schema.org/TextDigitalDocument',
          modes: ['read', 'append', 'write'],
          purpose: null,
          createdAt: NOW - DAY,
          expiresAt: NOW + DAY * 365,
          targets: [{ url: 'https://pod.example/docs/', kind: 'container' }],
        },
      ],
    },
    ...overrides,
  };
}
