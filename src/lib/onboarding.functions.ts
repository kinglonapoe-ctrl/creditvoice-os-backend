import { createServerFn } from '@tanstack/react-start';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { GENERIC_RECOVERY_RESPONSE, REQUESTS_PER_HOUR, ATTEMPTS_PER_HOUR, eligibleAdministrator, canVerify, validPassword } from './onboarding/policy';

async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function adminClient() { return (await import('@/integrations/supabase/client.server')).supabaseAdmin; }
async function audit(admin: any, event: string, row?: any, actor?: string) {
  const { error } = await admin.from('audit_logs').insert({ event_type: event, tenant_id: row?.tenant_id ?? null, actor_id: actor ?? null, actor_role: actor ? 'SUPER_ADMIN' : null, entity_type: 'admin_onboarding', entity_id: row?.id ?? null, metadata: {} });
  if(error) throw new Error('Unable to record security event.');
}
function deliveryBase() {
  const raw=process.env['ADMIN_ONBOARDING_BASE_URL'];
  if(process.env['ADMIN_ONBOARDING_EMAIL_READY'] !== 'true' || !raw) throw new Error('Secure password email setup is not configured.');
  const url=new URL(raw);
  if(url.protocol!=='https:' || url.pathname!=='/' || url.search || url.hash) throw new Error('Secure password email setup is not configured.');
  return url.origin;
}
function authClient() {
  const url=process.env['SUPABASE_URL']; const key=process.env['SUPABASE_PUBLISHABLE_KEY'];
  if(!url || !key) throw new Error('Authentication unavailable.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>{const headers=new Headers(init?.headers); if(headers.get('Authorization')===`Bearer ${key}`)headers.delete('Authorization');headers.set('apikey',key);return fetch(input,{...init,headers});}}});
}
async function requestLink(email: string, purpose: 'SETUP'|'RECOVERY', actor?: string, tenantId?: string) {
  const base=deliveryBase(); const admin=await adminClient();
  const { data: globallyAllowed, error: globalError } = await admin.rpc('admin_onboarding_rate_limit', { _key: await digest('request:global'), _limit: 30 });
  if(globalError || !globallyAllowed) { await audit(admin,'ADMIN_ONBOARDING_RATE_LIMITED',undefined,actor); return; }
  const key=await digest(`request:${email.toLowerCase()}`);
  const {data:allowed,error:limitError}=await admin.rpc('admin_onboarding_rate_limit',{_key:key,_limit:REQUESTS_PER_HOUR});
  if(limitError)throw new Error('Authentication unavailable.');
  if(!allowed){await audit(admin,'ADMIN_ONBOARDING_RATE_LIMITED',undefined,actor);return;}
  const {data:profile}=await admin.from('profiles').select('id').eq('email',email.toLowerCase()).maybeSingle();
  const {data:roles}=profile ? await admin.from('user_roles').select('role,tenant_id').eq('user_id',profile.id) : {data:[]};
  if(!profile || !eligibleAdministrator(roles??[],tenantId)){await audit(admin,'ADMIN_RECOVERY_REQUESTED');return;}
  const role=roles?.[0];
  const {data:row,error}=await admin.from('admin_onboarding_requests').insert({user_id:profile.id,tenant_id:role?.tenant_id,purpose}).select().single();
  if(error || !row)throw new Error('Authentication unavailable.');
  await audit(admin,purpose==='SETUP'?'ADMIN_INVITATION_REQUESTED':'ADMIN_RECOVERY_REQUESTED',row,actor);
  const result=await authClient().auth.resetPasswordForEmail(email,{redirectTo:`${base}/reset-password?request=${row.id}`});
  if(result.error){await admin.from('admin_onboarding_requests').update({status:'FAILED'}).eq('id',row.id);await audit(admin,'ADMIN_ONBOARDING_DISPATCH_FAILED',row,actor);if(actor)throw new Error('Password email could not be sent.');}
  else await audit(admin,'ADMIN_ONBOARDING_DISPATCH_ACCEPTED',row,actor);
}
export const requestAdministratorRecovery=createServerFn({method:'POST'}).inputValidator(input=>z.object({email:z.string().email().max(254)}).parse(input)).handler(async({data})=>{
  try {await requestLink(data.email,'RECOVERY');} catch { /* public response never reveals existence or provider outcome */ }
  return {message:GENERIC_RECOVERY_RESPONSE};
});
export const sendAdministratorSetup=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(input=>z.object({tenantId:z.string().uuid()}).parse(input)).handler(async({data,context})=>{
  const {data:roles,error}=await context.supabase.from('user_roles').select('role').eq('user_id',context.userId).eq('role','SUPER_ADMIN');
  if(error || !roles?.length)throw new Error('Platform administrator access required.');
  deliveryBase();
  const admin=await adminClient();
  const {data:globalAllowed}=await admin.rpc('admin_onboarding_rate_limit',{_key:await digest('verify:global'),_limit:100});
  if(!globalAllowed)throw new Error('This password link is invalid or expired.');
  const {data:target}=await admin.from('user_roles').select('user_id').eq('tenant_id',data.tenantId).eq('role','TENANT_ADMIN').single();
  if(!target)throw new Error('An existing organization administrator is required.');
  const {data:user}=await admin.auth.admin.getUserById(target.user_id);
  if(!user?.user?.email)throw new Error('An existing organization administrator is required.');
  await requestLink(user.user.email,'SETUP',context.userId,data.tenantId);
  return {message:'Password setup request processed. Check email delivery status.'};
});
export const verifyAdministratorLink=createServerFn({method:'POST'}).inputValidator(input=>z.object({requestId:z.string().uuid(),tokenHash:z.string().min(20).max(256)}).parse(input)).handler(async({data})=>{
  const admin=await adminClient();
  const {data:allowed}=await admin.rpc('admin_onboarding_rate_limit',{_key:await digest(`verify:${data.requestId}`),_limit:ATTEMPTS_PER_HOUR});
  if(!allowed)throw new Error('This password link is invalid or expired.');
  const {data:row}=await admin.from('admin_onboarding_requests').select('*').eq('id',data.requestId).single();
  if(!row) {await audit(admin,'ADMIN_ONBOARDING_INVALID_LINK');throw new Error('This password link is invalid or expired.');}
  if(!canVerify(row.status,row.expires_at,row.attempts)){
    if(Date.parse(row.expires_at)<=Date.now() && row.status==='PENDING'){await admin.from('admin_onboarding_requests').update({status:'EXPIRED'}).eq('id',row.id);await audit(admin,'ADMIN_ONBOARDING_EXPIRED',row);}
    else await audit(admin,'ADMIN_ONBOARDING_LINK_REJECTED',row);
    throw new Error('This password link is invalid or expired.');
  }
  const {data:roles}=await admin.from('user_roles').select('role,tenant_id').eq('user_id',row.user_id);
  if(!eligibleAdministrator(roles??[],row.tenant_id??undefined))throw new Error('This password link is invalid or expired.');
  const {data:auth,error}=await authClient().auth.verifyOtp({token_hash:data.tokenHash,type:'recovery'});
  if(error || !auth.session || auth.user?.id!==row.user_id){await admin.from('admin_onboarding_requests').update({attempts:row.attempts+1}).eq('id',row.id);await audit(admin,'ADMIN_ONBOARDING_VERIFICATION_FAILED',row);throw new Error('This password link is invalid or expired.');}
  const {error:save}=await admin.from('admin_onboarding_requests').update({status:'VERIFIED',session_hash:await digest(auth.session.access_token)}).eq('id',row.id).eq('status','PENDING');
  if(save)throw new Error('This password link is invalid or expired.');
  await audit(admin,'ADMIN_ONBOARDING_LINK_VERIFIED',row);
  return {accessToken:auth.session.access_token,refreshToken:auth.session.refresh_token};
});
export const completeAdministratorSetup=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(input=>z.object({requestId:z.string().uuid(),password:z.string().refine(validPassword,'Use 12–128 characters including upper/lowercase letters and a number.')}).parse(input)).handler(async({data,context})=>{
  const {data:roles}=await context.supabase.from('user_roles').select('role,tenant_id').eq('user_id',context.userId);
  if(!eligibleAdministrator(roles??[]))throw new Error('Organization administrator access required.');
  const {getRequest}=await import('@tanstack/react-start/server');
  const bearer=getRequest().headers.get('authorization')?.slice(7);
  if(!bearer)throw new Error('This password link is invalid or expired.');
  const admin=await adminClient();
  const {data:row}=await admin.from('admin_onboarding_requests').select('*').eq('id',data.requestId).single();
  if(!row || !eligibleAdministrator(roles??[],row.tenant_id??undefined))throw new Error('This password link is invalid or expired.');
  const {data:claimed,error}=await admin.rpc('admin_onboarding_claim',{_id:row.id,_session_hash:await digest(bearer),_user_id:context.userId});
  if(error || !claimed){await audit(admin,Date.parse(row.expires_at)<=Date.now()?'ADMIN_ONBOARDING_EXPIRED':'ADMIN_ONBOARDING_COMPLETION_REJECTED',row);throw new Error('This password link is invalid or expired.');}
  // Bound, one-time verified recovery session; never change roles or other accounts.
  const {error:update}=await admin.auth.admin.updateUserById(context.userId,{password:data.password});
  await admin.from('admin_onboarding_requests').update({status:update?'FAILED':'COMPLETED',session_hash:null}).eq('id',row.id);
  await audit(admin,update?'ADMIN_ONBOARDING_COMPLETION_FAILED':row.purpose==='SETUP'?'ADMIN_PASSWORD_SETUP_COMPLETED':'ADMIN_PASSWORD_RECOVERY_COMPLETED',row);
  if(update)throw new Error('Password could not be updated. Request a new link.');
  return {ok:true};
});
