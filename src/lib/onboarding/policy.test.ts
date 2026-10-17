import { describe, expect, test } from 'bun:test';
import { canVerify, eligibleAdministrator, validPassword, REQUESTS_PER_HOUR, ATTEMPTS_PER_HOUR } from './policy';
describe('administrator onboarding security',()=>{
 test('expired link cannot verify',()=>expect(canVerify('PENDING','2026-10-16T00:00:00Z',0,Date.parse('2026-10-17T00:00:00Z'))).toBe(false));
 test('verified link cannot be reused',()=>expect(canVerify('VERIFIED','2026-10-18T00:00:00Z',0,Date.parse('2026-10-17T00:00:00Z'))).toBe(false));
 test('invalid attempt budget refuses sixth attempt',()=>expect(canVerify('PENDING','2026-10-18T00:00:00Z',5,Date.parse('2026-10-17T00:00:00Z'))).toBe(false));
 test('valid pending link is eligible',()=>expect(canVerify('PENDING','2026-10-18T00:00:00Z',0,Date.parse('2026-10-17T00:00:00Z'))).toBe(true));
 test('cross-tenant membership rejected',()=>expect(eligibleAdministrator([{role:'TENANT_ADMIN',tenant_id:'a'}],'b')).toBe(false));
 test('platform role rejected',()=>expect(eligibleAdministrator([{role:'SUPER_ADMIN',tenant_id:null}])).toBe(false));
 test('mixed roles rejected',()=>expect(eligibleAdministrator([{role:'TENANT_ADMIN',tenant_id:'a'},{role:'SUPER_ADMIN',tenant_id:null}],'a')).toBe(false));
 test('single matching tenant admin allowed',()=>expect(eligibleAdministrator([{role:'TENANT_ADMIN',tenant_id:'a'}],'a')).toBe(true));
 test('weak password rejected',()=>expect(validPassword('short')).toBe(false));
 test('strong password accepted',()=>expect(validPassword('ExampleOnly12345')).toBe(true));
 test('email budget is three per hour',()=>expect(REQUESTS_PER_HOUR).toBe(3));
 test('verification budget is ten per hour',()=>expect(ATTEMPTS_PER_HOUR).toBe(10));
});
