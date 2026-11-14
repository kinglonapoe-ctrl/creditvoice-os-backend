import { useEffect, useState } from "react";
import { Phone, PhoneOff, RotateCcw, Volume2, VolumeX, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advanceDemo, DEMO, initialDemo, money, startDemo } from "@/lib/public-demo";

export function VoiceSimulator() {
  const [state, setState] = useState(initialDemo);
  const [digits, setDigits] = useState("");
  const [audio, setAudio] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(false);
  useEffect(() => { setAudioAvailable("speechSynthesis" in window); return () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }; }, []);
  useEffect(() => {
    if (!audio || !audioAvailable) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(state.message); speech.lang = "en-US"; speech.rate = 0.92;
    window.speechSynthesis.speak(speech);
    return () => window.speechSynthesis.cancel();
  }, [audio, audioAvailable, state.message]);
  const inputStep = ["code", "account", "pin", "recipient", "amount"].includes(state.step);
  const active = state.step !== "idle" && state.step !== "ended";
  function key(value: string) {
    if (value === "*") { setDigits(""); return; }
    if (inputStep && value !== "#") { setDigits(old => (old + value).slice(0, 12)); return; }
    const input = inputStep ? digits : value;
    setState(old => advanceDemo(old, input)); setDigits("");
  }
  return <div className="grid items-start gap-10 lg:grid-cols-[1fr_360px]">
    <div className="space-y-7">
      <div><p className="public-eyebrow">A familiar call. A different kind of access.</p><h2 className="public-heading mt-3">Hear it for yourself.</h2><p className="mt-4 max-w-lg text-muted-foreground">A personal welcome. A clear balance. A transfer you confirm before it happens.</p></div>
      <div className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="size-4" /> Fictional accounts · No real calls or money movement</div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-border py-5 text-sm">{[["Organization code", DEMO.code], ["Account number", DEMO.account], ["Demo PIN", DEMO.pin], ["Recipient account", DEMO.recipient]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-mono font-semibold">{value}</dd></div>)}</dl>
      <div><div className="flex justify-between"><h3 className="text-sm font-semibold">Demo account activity</h3><span className="text-sm font-mono">{money(state.balance)}</span></div>{state.entries.length ? <div className="mt-3 divide-y divide-border">{state.entries.map((entry, i) => <div key={i} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>Demo transfer {i + 1}</span><span className="font-mono text-muted-foreground">Debit {money(entry.debit)} <ArrowRight className="mx-1 inline size-3" /> Credit {money(entry.credit)}</span></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No demo transfers yet.</p>}</div>
      <p className="text-xs text-muted-foreground">Audio uses your browser’s voice, not the organization’s phone voice.</p>
    </div>
    <div className="demo-phone border border-border bg-card p-5">
      <div className="mb-5 flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold"><span className={`size-2 rounded-full ${active ? "bg-primary" : "bg-muted-foreground"}`} />{active ? "Demo call connected" : "Voice experience"}</span><Button size="icon" variant="ghost" disabled={!audioAvailable} title={audio ? "Mute voice" : "Enable voice"} aria-label={audio ? "Mute voice" : "Enable voice"} onClick={() => setAudio(!audio)}>{audio ? <Volume2 /> : <VolumeX />}</Button></div>
      <div className="demo-screen bg-secondary p-4"><p className="mb-3 text-xs font-semibold uppercase text-primary">Community Cooperative</p><p role="status" aria-live="polite" className="text-sm leading-relaxed">{state.message}</p></div>
      <div aria-label="Entered digits" className="my-4 h-7 overflow-hidden text-center font-mono text-xl">{state.step === "pin" ? "•".repeat(digits.length) : digits || "\u00a0"}</div>
      <div className="grid grid-cols-3 gap-2">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit, index) => <Button variant="outline" key={digit} aria-label={`Key ${digit}`} disabled={!active} onClick={() => key(digit)} className="h-14 flex-col gap-0 font-mono text-xl shadow-none"><span>{digit}</span><span className="h-3 font-sans text-[9px] text-muted-foreground">{["", "ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ", "Clear", "+", "Enter"][index]}</span></Button>)}</div>
      <div className="mt-4 flex gap-2">{active ? <Button variant="destructive" className="flex-1" onClick={() => { setState(old => ({ ...old, step: "ended", message: "Demo call ended." })); setDigits(""); }}><PhoneOff /> End call</Button> : <Button className="flex-1" onClick={() => { setState(startDemo()); setDigits(""); }}><Phone />{state.step === "ended" ? "Call again" : "Start demo call"}</Button>}<Button size="icon" variant="outline" aria-label="Reset demo" title="Reset demo" onClick={() => { setState(initialDemo); setDigits(""); }}><RotateCcw /></Button></div>
    </div>
  </div>;
}