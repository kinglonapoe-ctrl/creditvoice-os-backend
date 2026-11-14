import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Phone, ShieldCheck, Users, Sprout, Store, Landmark, Check } from "lucide-react";
import hero from "@/assets/creditvoice-phone.jpg";
import { Button } from "@/components/ui/button";
import { PublicLayout } from "@/components/public/public-layout";
import { VoiceSimulator } from "@/components/public/voice-simulator";
import { publicHead } from "@/lib/public-head";
export const Route = createFileRoute("/")({ head: () => publicHead("CreditVoice — Financial access by phone", "Customer credit accounts, personalized voice access and an auditable ledger for cooperatives and community organizations.", "/"), component: Homepage });
function Homepage() {
  return <PublicLayout>
    <section className="public-hero relative overflow-hidden bg-public-ink text-public-inverse">
      <img src={hero} alt="A small business owner accessing her account over the phone" width={1600} height={1008} className="absolute inset-0 h-full w-full object-cover object-right" fetchPriority="high" />
      <div className="public-hero-shade absolute inset-0" />
      <div className="public-container relative z-10 py-16 sm:py-20">
        <p className="public-eyebrow text-public-highlight">Financial access. Human connection.</p>
        <h1 className="mt-5 font-display text-5xl font-semibold leading-tight sm:text-6xl">CreditVoice<span className="text-public-highlight">.</span></h1>
        <p className="mt-5 max-w-md text-2xl leading-snug sm:text-3xl">Your community’s credit.<br />One phone call away.</p>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-public-inverse/80">Give customers a simple way to check their balance, access account information and transfer credit. No smartphone or internet connection required.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Button asChild size="lg"><Link to="/apply">Apply for a workspace <ArrowUpRight /></Link></Button><Button asChild variant="ghost" size="lg" className="text-public-inverse hover:bg-public-inverse/10 hover:text-public-inverse"><Link to="/how-it-works">Explore how it works <ArrowRight /></Link></Button></div>
        <div className="mt-10 flex flex-wrap gap-5 text-xs text-public-inverse/80"><span className="flex items-center gap-2"><Check className="size-4 text-public-highlight" /> Voice-first access</span><span className="flex items-center gap-2"><Check className="size-4 text-public-highlight" /> Organization-owned experience</span></div>
      </div>
    </section>
    <section className="border-b border-border"><div className="public-container flex flex-wrap items-center justify-between gap-6 py-7"><p className="text-xs font-semibold uppercase text-muted-foreground">Built around your community</p><div className="flex flex-wrap gap-7 text-sm font-semibold"><span className="flex items-center gap-2"><Sprout className="size-4 text-primary" /> Cooperatives</span><span className="flex items-center gap-2"><Store className="size-4 text-primary" /> Trade associations</span><span className="flex items-center gap-2"><Landmark className="size-4 text-primary" /> Credit organizations</span></div></div></section>
    <section className="public-container py-16 sm:py-20"><VoiceSimulator /></section>
    <section className="border-y border-border bg-secondary"><div className="public-container py-16"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="public-eyebrow">One platform. Two sides of the call.</p><h2 className="public-heading mt-3">Simple for customers.<br />Controlled by you.</h2></div><Link to="/how-it-works" className="flex items-center gap-2 text-sm font-semibold text-primary">Inside CreditVoice <ArrowUpRight className="size-4" /></Link></div><div className="mt-10 grid gap-8 md:grid-cols-3">{[{ icon: Phone, title: "A voice that feels like yours", copy: "Your organization’s number, chosen voice and welcome message. Personal greetings and transfer notices for individual customers." }, { icon: ShieldCheck, title: "Every movement accounted for", copy: "Credit transfers leave permanent, paired ledger entries. Account history is preserved, not quietly rewritten." }, { icon: Users, title: "Your workspace. Your community.", copy: "Manage customers, account numbering and call history in a workspace scoped to your organization." }].map(({ icon: Icon, title, copy }) => <article key={title} className="border-t border-border pt-6"><Icon className="size-6 text-primary" /><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy}</p></article>)}</div></div></section>
    <section className="public-container flex flex-wrap items-center justify-between gap-8 py-16"><div><p className="public-eyebrow">Closer to your customers</p><h2 className="public-heading mt-3">Start with your organization.</h2></div><Button size="lg" asChild><Link to="/apply">Apply for a workspace <ArrowUpRight /></Link></Button></section>
  </PublicLayout>;
}
