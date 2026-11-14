export const GENERIC_RECOVERY_RESPONSE = 'If an eligible administrator account exists, a password link will be sent.';
export const REQUESTS_PER_HOUR = 3;
export const ATTEMPTS_PER_HOUR = 10;
export function eligibleAdministrator(roles: Array<{ role: string; tenant_id: string | null }>, tenantId?: string) {
  return roles.length === 1 && roles[0]?.role === 'TENANT_ADMIN' && !!roles[0].tenant_id && (!tenantId || roles[0].tenant_id === tenantId);
}
export function verifiedAdministratorMatches(email: string | null | undefined, confirmedAt: string | null | undefined, expectedEmail: string) {
  return !!email && !!confirmedAt && email.trim().toLowerCase() === expectedEmail.trim().toLowerCase();
}
export function canVerify(status: string, expiresAt: string, attempts: number, now = Date.now()) {
  return status === 'PENDING' && Date.parse(expiresAt) > now && attempts < 5;
}
export function validPassword(password: string) {
  return password.length >= 12 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
}
