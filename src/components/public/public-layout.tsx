import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import logo from "@/assets/logo_h.png.asset.json";
import { Button } from "@/components/ui/button";

const links = [{ to: "/how-it-works", label: "How it works" }, { to: "/security", label: "Security" }, { to: "/apply", label: "Apply" }] as const;
export function PublicLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="public-site min-h-screen bg-background text-foreground">
    <header className="public-header border-b border-border bg-background">
      <div className="public-container flex h-20 items-center justify-between gap-4">
        <Link to="/" aria-label="CreditVoice home"><img src={logo.url} alt="CreditVoice — Financial access by phone" className="w-48 max-w-full" width={240} height={70} /></Link>
        <nav aria-label="Public navigation" className="hidden items-center gap-8 md:flex">{links.map(link => <Link key={link.to} to={link.to} activeProps={{ className: "text-primary" }} className="text-sm font-semibold transition-colors hover:text-primary">{link.label}</Link>)}<Button asChild variant="outline"><Link to="/auth">Workspace sign in <ArrowUpRight /></Link></Button></nav>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button>
      </div>
      {open && <nav aria-label="Mobile navigation" className="public-container flex flex-col gap-5 pb-6 md:hidden">{links.map(link => <Link key={link.to} to={link.to} onClick={() => setOpen(false)}>{link.label}</Link>)}<Link to="/auth">Workspace sign in</Link></nav>}
    </header>
    <main>{children}</main>
    <footer className="border-t border-border bg-secondary py-12"><div className="public-container"><div className="flex flex-wrap justify-between gap-8"><div><img src={logo.url} alt="CreditVoice" width={240} height={70} className="w-48" loading="lazy" /><p className="mt-4 text-sm text-muted-foreground">Financial access by phone.</p></div><nav aria-label="Footer navigation" className="flex flex-wrap gap-6 text-sm">{links.map(link => <Link key={link.to} to={link.to}>{link.label}</Link>)}<Link to="/auth">Sign in</Link></nav></div><div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground"><p>© {new Date().getFullYear()} CreditVoice OS</p><p>Organization credit accounts. One approved operating currency per workspace.</p></div></div></footer>
  </div>;
}