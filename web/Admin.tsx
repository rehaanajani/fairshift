/**
 * The employer's dashboard: live workforce health, the safety queue, fatigue-safe rostering,
 * paper-register import, crew check-in and inspection-ready registers. Updates the moment a worker acts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BadgeCheck, CalendarClock, Camera, ClipboardList, Download, FileSpreadsheet, LayoutDashboard, LogOut, QrCode, Receipt, RefreshCw, ShieldAlert, MessagesSquare, Users } from "lucide-react";
import { api, ApiError, download, fileToBase64, live } from "./api";
import { Avatar, Modal, SECTOR_LABEL, day, rupees, useLoad, when } from "./ui";

interface Person {
  id: string; name: string; job: string; lang: string; hourlyRate: number; onShift: boolean; onShiftHours: number; daysWorked: number;
  hours: { regular: number; overtime: number }; fatigue: { detail: string }[]; fatigueCount: number;
  risk: { score: number; level: "low" | "medium" | "high"; reasons: string[] }; skills: string[];
}
interface Hazard { id: string; category: string; severity: 1 | 2 | 3; summary: string; text: string; lang: string; status: string; createdAt: string; reporter: string; hasPhoto?: boolean; updates: { at: string; status: string; note: string }[] }
interface Overview {
  org: { id: string; name: string; sector: string; policy: { dailyHours: number; weeklyHours: number; minRestHours: number } };
  site: { name: string; checkInCode: string };
  headcount: number; onShiftNow: number; overtimeHours14d: number; overtimeCost14d: number;
  attendance: { day: string; present: number }[];
  people: Person[];
  planned: { id: string; workerId: string; name: string; start: string; end: string; override?: string }[];
  hazards: Hazard[];
  feedback: { topic: string; count: number; avg: number | null }[];
  ledger: { receipts: number; corrections: number; intact: boolean; latest: { code: string; name: string; hours: number; overtime: number; end: string; by: string; kind: string }[] };
  belowMinimumWage: string[];
}
type Change = { type: string; action?: string; severity?: number; workerId?: string; rows?: number };
type Toast = { id: number; text: string; red?: boolean };

export function Admin({ orgs, onSwitch, onLogout }: { orgs: { id: string; name: string; sector: string }[]; onSwitch: (id: string) => void; onLogout: () => void }) {
  const { data: o, reload, error } = useLoad(() => api<Overview>("/admin/overview"));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | { kind: "roster" | "skill"; person: Person } | { kind: "register" | "crew" | "qr" }>(null);
  const toast = useCallback((text: string, red?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, red }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const people = useRef<Person[]>([]);
  people.current = o?.people ?? [];

  useEffect(
    () =>
      live<Change>("/admin/events", "admin", (c) => {
        const name = people.current.find((p) => p.id === c.workerId)?.name ?? "A worker";
        if (c.type === "hazard" && c.action === "new") toast(`${c.severity === 3 ? "Danger reported" : "Safety report"}: open the safety queue`, c.severity === 3);
        if (c.type === "shift" && c.action === "in") toast(`${name} started work`);
        if (c.type === "shift" && c.action === "out") toast(`${name} ended work · receipt sealed`);
        if (c.type === "feedback") toast("New anonymous feedback");
        if (c.workerId) setFresh((s) => new Set(s).add(c.workerId!));
        void reload();
      }),
    [reload, toast],
  );

  if (error) return <main className="login"><p className="error" role="alert">{error}</p><button className="btn" onClick={onLogout}>Sign out</button></main>;
  if (!o) return <main className="login" aria-busy="true"><span className="spin" /></main>;

  const openHazards = o.hazards.filter((h) => h.status !== "fixed");
  const highRisk = o.people.filter((p) => p.risk.level === "high");
  const maxPresent = Math.max(1, ...o.attendance.map((a) => a.present), o.headcount);

  return (
    <div className="admin">
      <a className="skip" href="#main">Skip to dashboard</a>
      <aside className="side" aria-label="Employer">
        <a href="#/" className="logo"><span className="logo-mark" aria-hidden="true">F</span>FairShift</a>
        <label className="col" style={{ gap: 6 }}>
          <span className="tiny side-label" style={{ fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Workplace</span>
          <select className="select" value={o.org.id} onChange={(e) => onSwitch(e.target.value)} aria-label="Switch workplace">
            {orgs.map((x) => <option key={x.id} value={x.id}>{x.name} · {SECTOR_LABEL[x.sector]}</option>)}
          </select>
        </label>
        <nav aria-label="Sections">
          <a href="#overview" onClick={(e) => (e.preventDefault(), document.getElementById("overview")?.scrollIntoView())}><LayoutDashboard size={18} aria-hidden="true" /> Overview</a>
          <a href="#safety" onClick={(e) => (e.preventDefault(), document.getElementById("safety")?.scrollIntoView())}><ShieldAlert size={18} aria-hidden="true" /> Safety queue</a>
          <a href="#people" onClick={(e) => (e.preventDefault(), document.getElementById("people")?.scrollIntoView())}><Users size={18} aria-hidden="true" /> People and fatigue</a>
          <a href="#voice" onClick={(e) => (e.preventDefault(), document.getElementById("voice")?.scrollIntoView())}><MessagesSquare size={18} aria-hidden="true" /> Worker voice</a>
          <a href="#records" onClick={(e) => (e.preventDefault(), document.getElementById("records")?.scrollIntoView())}><FileSpreadsheet size={18} aria-hidden="true" /> Records</a>
        </nav>
        <span className="grow" />
        <span className="small row" style={{ gap: 8 }}><span className="live-dot" aria-hidden="true" /> Live</span>
        <button type="button" className="btn sm" onClick={onLogout}><LogOut size={16} aria-hidden="true" /> Sign out</button>
      </aside>

      <main className="main" id="main">
        <header id="overview">
          <div className="grow">
            <h1>{o.org.name}</h1>
            <span className="muted">{SECTOR_LABEL[o.org.sector]} · {o.site.name}</span>
          </div>
          <button type="button" className="btn" onClick={() => setModal({ kind: "register" })}><Camera size={18} aria-hidden="true" /> Import paper register</button>
          <button type="button" className="btn" onClick={() => setModal({ kind: "crew" })}><ClipboardList size={18} aria-hidden="true" /> Crew check-in</button>
          <button type="button" className="btn primary" onClick={() => setModal({ kind: "qr" })}><QrCode size={18} aria-hidden="true" /> Site QR</button>
        </header>

        <section className="kpis" aria-label="Today">
          <div className="kpi card"><span className="l">On shift now</span><span className="v">{o.onShiftNow}<span className="muted" style={{ fontSize: 18 }}> / {o.headcount}</span></span></div>
          <div className="kpi card"><span className="l">Open safety reports</span><span className="v" style={{ color: openHazards.some((h) => h.severity === 3) ? "var(--red)" : undefined }}>{openHazards.length}</span><span className="small muted">{openHazards.filter((h) => h.severity === 3).length} danger to life</span></div>
          <div className="kpi card"><span className="l">Overtime · 14 days</span><span className="v">{Math.round(o.overtimeHours14d)} h</span><span className="small muted">{rupees(o.overtimeCost14d)} owed at {"2×"}</span></div>
          <div className="kpi card"><span className="l">High quit risk</span><span className="v" style={{ color: highRisk.length ? "var(--gold)" : undefined }}>{highRisk.length}</span><span className="small muted">{highRisk.map((p) => p.name.split(" ")[0]).join(", ") || "nobody"}</span></div>
          <div className="kpi card"><span className="l">Shift receipts</span><span className="v">{o.ledger.receipts}</span><span className={`small ${o.ledger.intact ? "" : "error"}`} style={{ color: o.ledger.intact ? "var(--ok)" : undefined, fontWeight: 700 }}>{o.ledger.intact ? "✓ chain intact" : "✗ tampering detected"} · {o.ledger.corrections} corrections</span></div>
        </section>

        {o.belowMinimumWage.length > 0 && (
          <p className="card pad row" style={{ background: "var(--gold-soft)", borderColor: "#f6dcae", margin: 0 }} role="status">
            <AlertTriangle color="var(--gold)" aria-hidden="true" />
            <span><strong>Below minimum wage:</strong> {o.belowMinimumWage.join(", ")}. Raise their hourly rate before the next pay run.</span>
          </p>
        )}

        <div className="grid2">
          <section className="card" id="safety" aria-labelledby="safety-h">
            <div className="section-h"><ShieldAlert color="var(--red)" aria-hidden="true" /><h2 id="safety-h" className="grow">Safety queue</h2><span className="chip">{openHazards.length} open</span></div>
            <div style={{ marginTop: 12 }}>
              {o.hazards.slice(0, 8).map((h) => <HazardRow key={h.id} h={h} onDone={reload} fresh={Date.now() - new Date(h.createdAt).getTime() < 60_000} />)}
              {o.hazards.length === 0 && <p className="pad muted">No reports. Workers can report by voice or photo from their phone.</p>}
            </div>
          </section>

          <section className="card" aria-labelledby="att-h">
            <div className="section-h"><CalendarClock color="var(--brand)" aria-hidden="true" /><h2 id="att-h" className="grow">Attendance · 14 days</h2></div>
            <div className="chart" role="img" aria-label={`Attendance over 14 days, from ${o.attendance[0]?.present} to ${o.attendance.at(-1)?.present} people`} style={{ marginTop: 14 }}>
              {o.attendance.map((a) => (
                <div key={a.day}>
                  <span className="b" style={{ height: `${(a.present / maxPresent) * 96}px` }} title={`${a.present} on ${day(a.day)}`} />
                  <span>{new Date(a.day).getDate()}</span>
                </div>
              ))}
            </div>
            <div className="section-h"><Receipt color="var(--brand)" aria-hidden="true" /><h2 className="grow">Latest receipts</h2></div>
            <div className="pad col" style={{ gap: 8 }}>
              {o.ledger.latest.map((r) => (
                <div key={r.code} className="receipt-row small">
                  <span className="col" style={{ gap: 0 }}>
                    <strong className="ellipsis">{r.name}</strong>
                    <a className="mono tiny" href={`#/r/${r.code}`} target="_blank" rel="noreferrer">{r.code}</a>
                  </span>
                  <span className="num">{r.hours} h</span>
                  {r.overtime > 0 ? <span className="chip gold">+{r.overtime} OT</span> : r.kind === "correction" ? <span className="chip blue">corrected</span> : <span />}
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="card" id="people" aria-labelledby="people-h">
          <div className="section-h"><Users color="var(--brand)" aria-hidden="true" /><h2 id="people-h" className="grow">People, fatigue and quit risk</h2><span className="small muted">Sorted by risk · reasons shown, so you fix causes, not blame people</span></div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th scope="col">Worker</th><th scope="col">Last 14 days</th><th scope="col">Fatigue</th><th scope="col">Quit risk</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {o.people.map((p) => (
                  <tr key={p.id} className={fresh.has(p.id) ? "flash" : undefined}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <Avatar name={p.name} size={34} />
                        <span><strong>{p.name}</strong> {p.onShift && <span className="chip green">● {p.onShiftHours} h</span>}<br /><span className="small muted">{p.job} · ₹{p.hourlyRate}/h</span></span>
                      </div>
                    </td>
                    <td>{p.daysWorked} days · {Math.round(p.hours.regular + p.hours.overtime)} h<br /><span className={`small ${p.hours.overtime > 20 ? "" : "muted"}`} style={{ color: p.hours.overtime > 20 ? "var(--gold)" : undefined, fontWeight: 600 }}>{Math.round(p.hours.overtime)} h overtime</span></td>
                    <td style={{ maxWidth: 220 }}>{p.fatigueCount ? <><span className="chip red">{p.fatigueCount} warnings</span><br /><span className="tiny muted">{p.fatigue.at(-1)?.detail}</span></> : <span className="chip green">Rested</span>}</td>
                    <td style={{ minWidth: 170 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="meter grow" aria-hidden="true"><span style={{ width: `${p.risk.score}%`, background: p.risk.level === "high" ? "var(--red)" : p.risk.level === "medium" ? "#d97706" : "var(--ok)" }} /></div>
                        <strong>{p.risk.score}</strong>
                      </div>
                      <span className="tiny muted">{p.risk.reasons.join(" · ") || "no warning signs"}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button type="button" className="btn sm" onClick={() => setModal({ kind: "roster", person: p })} aria-label={`Plan a shift for ${p.name}`}><CalendarClock size={16} aria-hidden="true" /> Plan</button>
                        <button type="button" className="btn sm ghost" onClick={() => setModal({ kind: "skill", person: p })} aria-label={`Add a verified skill for ${p.name}`}><BadgeCheck size={16} aria-hidden="true" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.planned.length > 0 && (
            <div className="pad col" style={{ gap: 6 }}>
              <strong>Planned shifts</strong>
              {o.planned.map((p) => <span key={p.id} className="small">{p.name}: {when(p.start)} → {new Date(p.end).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}{p.override && <span className="chip gold" style={{ marginLeft: 6 }}>override: {p.override}</span>}</span>)}
            </div>
          )}
        </section>

        <div className="grid2">
          <WorkerVoice feedback={o.feedback} />
          <section className="card" id="records" aria-labelledby="rec-h">
            <div className="section-h"><FileSpreadsheet color="var(--brand)" aria-hidden="true" /><h2 id="rec-h" className="grow">Inspection-ready registers</h2></div>
            <div className="pad col">
              <p className="small muted" style={{ margin: 0 }}>Generated from sealed shift receipts: the attendance (muster roll), overtime and wage registers a labour inspector asks for. Last 30 days.</p>
              {[["attendance", "Attendance register"], ["overtime", "Overtime register"], ["wages", "Wage register"]].map(([k, label]) => (
                <button key={k} type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={() => void download(`/admin/registers/${k}`, `${o.org.id}-${k}-register.csv`).catch((e) => toast((e as Error).message, true))}>
                  <Download size={18} aria-hidden="true" /> {label} <span className="grow" /> <span className="tiny muted">CSV</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>

      {modal?.kind === "roster" && <RosterModal person={modal.person} onClose={() => setModal(null)} onDone={(m) => (toast(m), void reload())} />}
      {modal?.kind === "skill" && <SkillModal person={modal.person} onClose={() => setModal(null)} onDone={(m) => (toast(m), void reload())} />}
      {modal?.kind === "register" && <RegisterModal onClose={() => setModal(null)} onDone={() => void reload()} />}
      {modal?.kind === "crew" && <CrewModal people={o.people} onClose={() => setModal(null)} onDone={(m) => (toast(m), void reload())} />}
      {modal?.kind === "qr" && <QrModal code={o.site.checkInCode} site={o.site.name} onClose={() => setModal(null)} onDone={() => void reload()} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.red ? "red" : ""}`}>{t.red ? <AlertTriangle size={18} aria-hidden="true" /> : <span className="live-dot" aria-hidden="true" />}{t.text}</div>)}
      </div>
    </div>
  );
}

function HazardRow({ h, onDone, fresh }: { h: Hazard; onDone: () => Promise<void>; fresh: boolean }) {
  const [busy, setBusy] = useState(false);
  const set = async (status: string) => {
    setBusy(true);
    await api(`/admin/hazards/${h.id}`, { method: "PATCH", body: { status, note: status === "fixed" ? "Fixed on site" : "Seen, action planned" } }).catch(() => {});
    await onDone();
    setBusy(false);
  };
  return (
    <article className={`hazard sev${h.severity} ${fresh ? "new" : ""}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`chip ${h.severity === 3 ? "red" : h.severity === 2 ? "gold" : ""}`}>{h.severity === 3 ? "Fix today" : h.severity === 2 ? "This week" : "Low"}</span>
        <strong className="grow">{h.category}</strong>
        <span className={`chip ${h.status === "fixed" ? "green" : h.status === "acknowledged" ? "blue" : "red"}`}>{h.status}</span>
      </div>
      <span>{h.summary}</span>
      {h.text && h.text !== h.summary && <span className="small muted" dir="auto">“{h.text}”</span>}
      <div className="row wrap small muted" style={{ gap: 10 }}>
        <span>{h.reporter === "Anonymous" ? "🛡 Anonymous" : h.reporter}</span>
        <span>{when(h.createdAt)}</span>
        {h.hasPhoto && <span>📷 photo</span>}
        <span className="grow" />
        {h.status === "open" && <button type="button" className="btn sm" disabled={busy} onClick={() => void set("acknowledged")}>Acknowledge</button>}
        {h.status !== "fixed" && <button type="button" className="btn sm primary" disabled={busy} onClick={() => void set("fixed")}>Mark fixed</button>}
      </div>
    </article>
  );
}

function WorkerVoice({ feedback }: { feedback: Overview["feedback"] }) {
  const [themes, setThemes] = useState<{ themes: { title: string; count: number; mood: string }[]; action: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card" id="voice" aria-labelledby="voice-h">
      <div className="section-h"><MessagesSquare color="var(--gold)" aria-hidden="true" /><h2 id="voice-h" className="grow">Anonymous worker voice</h2></div>
      <div className="pad col">
        <p className="small muted" style={{ margin: 0 }}>No names are stored. Averages appear only once a topic has 3 or more responses, so a single person's answer can't be singled out.</p>
        {feedback.map((f) => (
          <div key={f.topic} className="row">
            <strong style={{ width: 110, textTransform: "capitalize" }}>{f.topic}</strong>
            {f.avg === null ? <span className="small muted grow">{f.count ? `${f.count} response${f.count > 1 ? "s" : ""}: hidden until 3` : "no responses"}</span> : (
              <>
                <div className="meter grow" aria-hidden="true"><span style={{ width: `${(f.avg / 5) * 100}%`, background: f.avg < 2.5 ? "var(--red)" : f.avg < 3.5 ? "#d97706" : "var(--ok)" }} /></div>
                <span className="small" style={{ width: 90, textAlign: "right" }}><strong>{f.avg}</strong>/5 · {f.count}</span>
              </>
            )}
          </div>
        ))}
        <button type="button" className="btn" disabled={busy} onClick={async () => (setBusy(true), setThemes(await api<typeof themes>("/admin/feedback/themes").catch(() => null)), setBusy(false))}>
          {busy ? <span className="spin" /> : <MessagesSquare size={16} aria-hidden="true" />} Summarise themes with Gemini
        </button>
        {themes && (
          <div className="col" style={{ gap: 8 }} aria-live="polite">
            <div className="row wrap" style={{ gap: 6 }}>{themes.themes.map((t) => <span key={t.title} className={`chip ${t.mood === "negative" ? "red" : t.mood === "positive" ? "green" : "gold"}`}>{t.title} · {t.count}</span>)}</div>
            <p className="note" style={{ margin: 0 }}>This week: {themes.action}</p>
          </div>
        )}
      </div>
    </section>
  );
}

const nextHour = (h = 1) => {
  const d = new Date(Date.now() + h * 3_600_000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function RosterModal({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: (m: string) => void }) {
  const [start, setStart] = useState(nextHour(person.onShift ? 2 : 12));
  const [hours, setHours] = useState(8);
  const [refused, setRefused] = useState<{ problems: string[]; alternatives: { id: string; name: string; job: string; sameJob: boolean; risk: number }[] } | null>(null);
  const [override, setOverride] = useState("");
  const [err, setErr] = useState("");
  const plan = async (workerId: string, why?: string) => {
    setErr("");
    try {
      await api("/admin/roster", { body: { workerId, start: new Date(start).toISOString(), hours, ...(why ? { override: why } : {}) } });
      onDone("Shift planned");
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setRefused(e.body as typeof refused);
      else setErr((e as Error).message);
    }
  };
  return (
    <Modal title={`Plan a shift · ${person.name}`} onClose={onClose}>
      <div className="row wrap">
        <label className="field grow">Starts<input className="input" type="datetime-local" value={start} onChange={(e) => (setStart(e.target.value), setRefused(null))} /></label>
        <label className="field" style={{ width: 120 }}>Hours<input className="input" type="number" min={1} max={16} value={hours} onChange={(e) => (setHours(Number(e.target.value)), setRefused(null))} /></label>
      </div>
      {!refused && <button type="button" className="btn primary lg" onClick={() => void plan(person.id)}>Check rest rules and plan</button>}
      {refused && (
        <div className="col" role="alert">
          <div className="error"><strong>Blocked: {person.name.split(" ")[0]} needs rest.</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{refused.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
          {refused.alternatives.length > 0 && <strong>Rested colleagues who can take it</strong>}
          {refused.alternatives.map((a) => (
            <button key={a.id} type="button" className="card pad row" style={{ cursor: "pointer", textAlign: "left" }} onClick={() => void plan(a.id)}>
              <Avatar name={a.name} size={34} />
              <span className="grow"><strong>{a.name}</strong><br /><span className="small muted">{a.job}{a.sameJob && " · same job"} · risk {a.risk}</span></span>
              <span className="chip green">Assign</span>
            </button>
          ))}
          <label className="field">Override anyway (recorded with your reason)<input className="input" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. emergency concrete pour, worker agreed" /></label>
          <button type="button" className="btn" disabled={override.trim().length < 8} onClick={() => void plan(person.id, override)}>Override and plan</button>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </Modal>
  );
}

function SkillModal({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <Modal title={`Verify a skill · ${person.name}`} onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>Added to {person.name.split(" ")[0]}'s portable skill passport, signed by your organisation.</p>
      <label className="field">Skill or training<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scaffolding safety, 2-day course" /></label>
      <button type="button" className="btn primary" disabled={title.trim().length < 3} onClick={async () => (await api("/admin/skills", { body: { workerId: person.id, title } }), onDone("Skill verified"), onClose())}>Add verified skill</button>
    </Modal>
  );
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ rowsRead: number; imported: number; added: string[]; findings: { name: string; shifts: number; hours: number; overtime: number; overtimePay: number; fatigue: string[] }[] } | null>(null);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pick = async (f: File) => {
    setPreview(URL.createObjectURL(f));
    setBusy(true);
    setErr("");
    try {
      const img = await fileToBase64(f, 2000);
      setResult(await api("/admin/register/import", { body: { photo: img.data, photoType: img.type } }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <Modal title="Import a paper register" onClose={onClose}>
      <div className="drop">
        <Camera size={30} color="var(--brand)" aria-hidden="true" />
        <strong>Photograph a page of your attendance book</strong>
        <span className="small muted">Handwritten is fine, in any language. Gemini reads every row, adds the shifts with sealed receipts, and shows overtime the paper never counted.</span>
        <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
        <button type="button" className="btn primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? <><span className="spin" /> Reading the register…</> : "Choose or take a photo"}</button>
      </div>
      {preview && <img src={preview} alt="The register page you chose" className="photo-preview" />}
      {err && <p className="error" role="alert">{err}</p>}
      {result && (
        <div className="col" aria-live="polite">
          <p className="note" style={{ margin: 0 }}>Read {result.rowsRead} rows · imported {result.imported} shifts{result.added.length > 0 && ` · added ${result.added.length} new workers`}</p>
          {result.findings.map((f) => (
            <div key={f.name} className="card pad col" style={{ gap: 4 }}>
              <div className="row"><strong className="grow">{f.name}</strong><span>{f.shifts} shifts · {f.hours} h</span></div>
              {f.overtime > 0 && <span style={{ color: "var(--gold)", fontWeight: 700 }}>{f.overtime} h overtime → {rupees(f.overtimePay)} owed at overtime rate</span>}
              {f.fatigue.map((x) => <span key={x} className="small" style={{ color: "var(--red)" }}>⚠ {x}</span>)}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function CrewModal({ people, onClose, onDone }: { people: Person[]; onClose: () => void; onDone: (m: string) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [out, setOut] = useState<{ name: string; receipt?: string }[] | null>(null);
  const run = async (action: "in" | "out") => {
    const r = await api<{ done: { name: string; receipt?: string }[] }>("/admin/crew", { body: { workerIds: [...sel], action } });
    setOut(r.done);
    onDone(`${r.done.length} checked ${action}`);
  };
  return (
    <Modal title="Crew check-in" onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>For workers without a smartphone: the supervisor checks in the whole crew from one phone. Each worker still gets their own sealed receipt.</p>
      <div className="col" style={{ gap: 6 }}>
        {people.map((p) => (
          <label key={p.id} className="row" style={{ padding: "6px 0" }}>
            <input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.has(p.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} />
            <Avatar name={p.name} size={30} />
            <span className="grow">{p.name} <span className="small muted">· {p.job}</span></span>
            {p.onShift && <span className="chip green">on shift</span>}
          </label>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn primary grow" disabled={!sel.size} onClick={() => void run("in")}>Check in {sel.size || ""}</button>
        <button type="button" className="btn grow" disabled={!sel.size} onClick={() => void run("out")}>Check out {sel.size || ""}</button>
      </div>
      {out && <div className="note">{out.length ? out.map((d) => `${d.name}${d.receipt ? ` (${d.receipt})` : ""}`).join(", ") : "Nobody to change."}</div>}
    </Modal>
  );
}

function QrModal({ code, site, onClose, onDone }: { code: string; site: string; onClose: () => void; onDone: () => void }) {
  const [svg, setSvg] = useState("");
  const [current, setCurrent] = useState(code);
  useEffect(() => {
    void api<string>("/admin/site/qr").then(setSvg);
  }, [current]);
  return (
    <Modal title="Site check-in poster" onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>Print and stick at the gate. Workers scan it to start and end work; GPS check-in also works within the site boundary.</p>
      <div className="card pad col" style={{ alignItems: "center", textAlign: "center" }}>
        <strong>{site}</strong>
        {svg && <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={`QR code for ${current}`} width={220} height={220} />}
        <span className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{current}</span>
      </div>
      <button type="button" className="btn" onClick={async () => (setCurrent((await api<{ checkInCode: string }>("/admin/site/rotate-code", { body: {} })).checkInCode), onDone())}><RefreshCw size={16} aria-hidden="true" /> Rotate code (if the poster was shared)</button>
    </Modal>
  );
}
