import logoH from "@/assets/logo_h.png.asset.json";
import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { verifyAdministratorLink, completeAdministratorSetup } from '@/lib/onboarding.functions';

export const Route=createFileRoute('/reset-password')({head:()=>({meta:[{title:'Administrator password setup — CreditVoice OS'},{name:'description',content:'Secure organization administrator password setup and recovery.'},{property:'og:title',content:'Administrator password setup — CreditVoice OS'},{property:'og:description',content:'Secure organization administrator password setup and recovery.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary'}]}),component:ResetPassword});
function ResetPassword(){
 const verify=useServerFn(verifyAdministratorLink);const complete=useServerFn(completeAdministratorSetup);
 const started=useRef(false);const [requestId,setRequestId]=useState('');const [state,setState]=useState<'checking'|'invalid'|'ready'|'saving'|'done'>('checking');const [password,setPassword]=useState('');const [confirmation,setConfirmation]=useState('');const [error,setError]=useState('');
 useEffect(()=>{if(started.current)return;started.current=true;
  const url=new URL(window.location.href);const hash=new URLSearchParams(url.hash.slice(1));const tokenHash=hash.get('token_hash');const id=url.searchParams.get('request');
  window.history.replaceState(null,'','/reset-password');
  if(!tokenHash || hash.get('type')!=='recovery' || !id){setState('invalid');return;}
  setRequestId(id);
  void verify({data:{requestId:id,tokenHash}}).then(async result=>{
   const {error}=await supabase.auth.setSession({access_token:result.accessToken,refresh_token:result.refreshToken});
   setState(error?'invalid':'ready');
  }).catch(()=>setState('invalid'));
 },[verify]);
 async function submit(event:React.FormEvent){event.preventDefault();if(password!==confirmation){setError('Passwords do not match.');return;}setState('saving');setError('');
  try{await complete({data:{requestId,password}});setPassword('');setConfirmation('');await supabase.auth.signOut({scope:'global'});setState('done');}
  catch{setPassword('');setConfirmation('');setError('Password update failed. Use a new password link.');setState('invalid');}
 }
 return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12"><div className="w-full max-w-md space-y-6"><h1><img src={logoH.url} alt="CreditVoice OS" className="h-10 w-auto" /></h1><h2 className="text-lg font-medium">Administrator password</h2>{state==='checking'?<p>Checking password link…</p>:state==='invalid'?<p role="alert">{error || 'This password link is invalid or expired. Request a new link.'}</p>:state==='done'?<p role="status">Password updated. Sign in with your new password.</p>:<form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></div><div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></div><p className="text-sm text-muted-foreground">12–128 characters, including uppercase, lowercase and a number.</p>{error?<p role="alert">{error}</p>:null}<Button type="submit" disabled={state==='saving'}>Set password</Button></form>}<Button asChild variant="outline"><Link to="/auth">Back to sign in</Link></Button></div></main>;
}
