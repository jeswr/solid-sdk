// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from 'vitest';
import {
  liveFormFillGrant,
  revokeProfileFormFillGrants,
  sanitiseFormFillGrants,
} from '../src/background/core/formfill-grant';

const grant = {
  origin: 'https://shop.example',
  profileId: '1',
  categories: ['contact', 'address'],
  createdAt: 100,
};
describe('separate form-fill grants', () => {
  it('copies only validated data and deduplicates categories', () => {
    expect(
      sanitiseFormFillGrants([{ ...grant, categories: ['contact', 'contact'], extra: 'ignored' }]),
    ).toEqual([{ ...grant, categories: ['contact'] }]);
    expect(sanitiseFormFillGrants([{ ...grant, categories: ['address'] }])).toEqual([
      { ...grant, categories: ['address'] },
    ]);
    expect(
      sanitiseFormFillGrants([{ ...grant, origin: 'http://localhost:3001', expiresAt: 200 }]),
    ).toEqual([{ ...grant, origin: 'http://localhost:3001', expiresAt: 200 }]);
  });
  it('fails closed on malformed or ambiguous records', () => {
    for (const raw of [null, {}, 'bad']) expect(sanitiseFormFillGrants(raw)).toEqual([]);
    const invalid = [
      null,
      false,
      'bad',
      {},
      { ...grant, origin: 'http://shop.example' },
      { ...grant, origin: 'https://shop.example/' },
      { ...grant, profileId: 1 },
      { ...grant, profileId: ' ' },
      { ...grant, createdAt: NaN },
      { ...grant, createdAt: -1 },
      { ...grant, expiresAt: Infinity },
      { ...grant, expiresAt: 100 },
      { ...grant, categories: null },
      { ...grant, categories: [] },
      { ...grant, categories: ['password'] },
    ];
    expect(sanitiseFormFillGrants(invalid)).toEqual([]);
    expect(sanitiseFormFillGrants([grant, grant])).toEqual([]);
  });
  it('checks origin and expiry on each use and revokes only the chosen profile', () => {
    const grants = sanitiseFormFillGrants([
      grant,
      { ...grant, origin: 'https://other.example', profileId: '2', expiresAt: 200 },
    ]);
    expect(liveFormFillGrant(grants, grant.origin, 500)).toEqual(grants[0]);
    expect(liveFormFillGrant(grants, 'https://other.example', 199)).toEqual(grants[1]);
    expect(liveFormFillGrant(grants, 'https://other.example', 200)).toBeNull();
    expect(liveFormFillGrant(grants, 'https://unknown.example', 100)).toBeNull();
    expect(revokeProfileFormFillGrants(grants, '1')).toEqual([grants[1]]);
  });
});
