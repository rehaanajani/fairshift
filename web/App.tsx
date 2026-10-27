/** Routes, the landing page, logins, and the two public pages (receipt check and skill passport). */
import { useEffect, useState } from "react";
import { BadgeCheck, Building2, HardHat, Languages, Mic, MonitorPlay, Receipt, ShieldAlert, Smartphone } from "lucide-react";
import { Admin } from "./Admin";
import { api, session } from "./api";
import { LANG_LABEL, type Lang } from "./i18n";
import { Avatar, Logo, SECTOR_LABEL, ThemeToggle, day, useLoad } from "./ui";
import { Worker } from "./Worker";

function useRoute() {
  const [hash, setHash] = useState(location.hash.slice(2));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(2));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.split("?")[0]!.split("/");
}

export function App() {
  const [page, arg] = useRoute();
  if (page === "worker") return <WorkerGate />;
  if (page === "admin") return <AdminGate />;
  if (page === "demo") return <Demo />;
  if (page === "r" && arg) return <VerifyReceipt code={arg} />;
  if (page === "p" && arg) return <Passport id={arg} />;
  return <Landing />;
}

interface Orgs {
  orgs: { id: string; name: string; sector: string }[];
  demo: { workers: { name: string; phone: string; org: string; orgId: string; job: string; lang: Lang }[]; workerPin: string; adminPin: string };
}
const useOrgs = () => useLoad(() => api<Orgs>("/orgs"));

function Landing() {
  return (
    <main className="landing" id="main">
      <header className="row">
        <Logo />
        <span className="grow" />
        <ThemeToggle />
        <a className="btn sm" href="#/demo">
          <MonitorPlay size={16} aria-hidden="true" /> Live demo
        </a>
      </header>
      <section className="hero">
        <span className="chip green" style={{ justifySelf: "start" }}>UN SDG 8 · Decent work and economic growth</span>
        <h1>
          Every hour gets a <em>receipt</em>. Every worker gets a <em>voice</em>.
        </h1>
        <p>
          FairShift replaces paper registers and WhatsApp groups on construction sites, in hospitals and on college campuses. Workers just talk, in any of 16 Indian
          languages. Employers see who is overworked, unsafe or about to quit, before it becomes a crisis.
        </p>
      </section>
      <div className="doors">
        <a className="door card" href="#/worker">
          <span className="ic" style={{ background: "var(--gold-soft)", color: "var(--gold)" }}><Smartphone aria-hidden="true" /></span>
          <h2>I'm a worker</h2>
          <span className="muted">Start and end shifts, hear your pay explained, report danger, speak up safely.</span>
        </a>
        <a className="door card" href="#/admin">
          <span className="ic" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}><Building2 aria-hidden="true" /></span>
          <h2>I'm an employer</h2>
          <span className="muted">Live workforce health, safety queue, fatigue-safe rostering and inspection-ready registers.</span>
        </a>
        <a className="door card" href="#/demo">
          <span className="ic" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}><MonitorPlay aria-hidden="true" /></span>
          <h2>Watch both, live</h2>
          <span className="muted">A worker's phone and the employer's dashboard side by side, updating in real time.</span>
        </a>
      </div>
      <section className="pillars" aria-label="What makes FairShift different">
        {[
          [Mic, "Nobody has to type", "Hold one button and speak. Gemini understands 16 Indian languages and Google Cloud answers out loud."],
          [Receipt, "Hours that can't vanish", "Each shift is sealed into a tamper-evident receipt chain. Corrections are visible to the worker, with a reason."],
          [HardHat, "Fatigue stopped before it starts", "Rostering refuses unsafe back-to-back shifts and suggests a rested colleague with the same skills."],
          [ShieldAlert, "Report danger with a photo", "Gemini reads the photo, rates the risk and alerts the manager live. Anonymous if you want."],
          [Languages, "From paper in one photo", "Snap the old handwritten register: Gemini reads it, imports every shift and flags unpaid overtime."],
          [BadgeCheck, "Skills that travel", "A QR skill passport any future employer can check, so experience is never lost."],
        ].map(([Icon, title, body]) => {
          const I = Icon as typeof Mic;
          return (
            <div className="pillar card" key={title as string}>
              <I size={22} color="var(--brand)" aria-hidden="true" />
              <h3>{title as string}</h3>
              <p className="muted small" style={{ margin: 0 }}>{body as string}</p>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function WorkerGate() {
  const [token, setToken] = useState(session.get("worker"));
  const { data } = useOrgs();
  const [pick, setPick] = useState<string>("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const embedded = location.hash.includes("embed");
  if (token) return <Worker onLogout={() => (session.set("worker", null), setToken(null))} />;
  const login = async (phone: string, p: string) => {
    try {
      const r = await api<{ token: string }>("/login/worker", { body: { phone, pin: p } });
      session.set("worker", r.token);
      setToken(r.token);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="login" id="main">
      {!embedded && <Logo />}
      <h1 style={{ fontSize: 26 }}>Who is working today?</h1>
      <p className="muted" style={{ margin: 0 }}>Tap your name. Demo PIN is {data?.demo.workerPin ?? "1234"}.</p>
      <div className="people" role="list">
        {data?.demo.workers.map((w) => (
          <button key={w.phone} type="button" role="listitem" className="person" aria-pressed={pick === w.phone} onClick={() => (setPick(w.phone), setPin(data.demo.workerPin), void login(w.phone, data.demo.workerPin))}>
            <span className="row" style={{ gap: 8 }}>
              <Avatar name={w.name} size={32} />
              <strong className="grow" style={{ fontSize: 14 }}>{w.name}</strong>
            </span>
            <span className="tiny muted">{w.job} · {w.org}</span>
            <span className="tiny" style={{ fontWeight: 700 }}>{LANG_LABEL[w.lang]}</span>
          </button>
        ))}
      </div>
      <form className="card pad col" onSubmit={(e) => (e.preventDefault(), void login(pick, pin))}>
        <label className="field">Phone number<input className="input" inputMode="numeric" autoComplete="tel" value={pick} onChange={(e) => setPick(e.target.value)} /></label>
        <label className="field">PIN<input className="input" inputMode="numeric" type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary lg" type="submit">Start</button>
      </form>
    </main>
  );
}

function AdminGate() {
  const [token, setToken] = useState(session.get("admin"));
  const { data } = useOrgs();
  const [error, setError] = useState("");
  const login = async (orgId: string, pin: string) => {
    try {
      const r = await api<{ token: string }>("/login/admin", { body: { orgId, pin } });
      session.set("admin", r.token);
      setToken(r.token);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (token && data) return <Admin key={token} orgs={data.orgs} onSwitch={(id) => void login(id, data.demo.adminPin)} onLogout={() => (session.set("admin", null), setToken(null))} />;
  return (
    <main className="login" id="main">
      <Logo />
      <h1 style={{ fontSize: 26 }}>Employer sign in</h1>
      <p className="muted" style={{ margin: 0 }}>The same FairShift engine, three very different workplaces. Demo PIN is {data?.demo.adminPin ?? "4321"}.</p>
      <div className="col">
        {data?.orgs.map((o) => (
          <button key={o.id} type="button" className="card pad row" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => void login(o.id, data.demo.adminPin)}>
            <Avatar name={o.name} />
            <span className="grow">
              <strong>{o.name}</strong>
              <br />
              <span className="muted small">{SECTOR_LABEL[o.sector]}</span>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

/** The judges' view: the worker's phone and the employer's dashboard, live, side by side. */
function Demo() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  const [tab, setTab] = useState<"worker" | "admin">("worker");
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  // on a phone there is no room for both screens: switch between them instead
  if (narrow)
    return (
      <main className="demo-mobile" id="main">
        <div className="demo-tabs" role="tablist" aria-label="Demo view">
          {(["worker", "admin"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "worker" ? "Worker's phone" : "Employer dashboard"}
            </button>
          ))}
        </div>
        <iframe key="w" src="#/worker?embed" title="Worker app" allow="microphone; camera; geolocation; autoplay" hidden={tab !== "worker"} />
        <iframe key="a" src="#/admin?embed" title="Employer dashboard" allow="camera; autoplay" hidden={tab !== "admin"} />
      </main>
    );
  return (
    <main className="demo" id="main">
      <div style={{ display: "grid", alignContent: "center" }}>
        <p className="demo-label">Worker's phone</p>
        <div className="demo-phone">
          <iframe src="#/worker?embed" title="Worker app" allow="microphone; camera; geolocation; autoplay" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
        <p className="demo-label">Employer dashboard · updates live</p>
        <div className="demo-screen">
          <iframe src="#/admin?embed" title="Employer dashboard" allow="camera; autoplay" />
        </div>
      </div>
    </main>
  );
}

function VerifyReceipt({ code }: { code: string }) {
  const { data, error } = useLoad(() => api<{ valid: boolean; corrected: boolean; receipt: { code: string; start: string; end: string; hours: number; overtime: number; employer: string; worker: string; kind: string; by: string } }>(`/receipts/${encodeURIComponent(code)}`), [code]);
  return (
    <main className="login" id="main">
      <Logo />
      <h1 style={{ fontSize: 26 }}>Shift receipt check</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <div className="receipt" style={{ borderColor: data.valid ? "var(--brand)" : "var(--red)" }}>
          <span className={`chip ${data.valid ? "green" : "red"}`} style={{ justifySelf: "start" }}>{data.valid ? "✓ Genuine, unchanged" : "✗ Tampered"}</span>
          {data.corrected && <span className="chip gold" style={{ justifySelf: "start" }}>A later correction exists for this shift</span>}
          <strong className="mono" style={{ fontSize: 22 }}>{data.receipt.code}</strong>
          <span>{data.receipt.worker} at {data.receipt.employer}</span>
          <span className="muted">{day(data.receipt.start)} · {new Date(data.receipt.start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} to {new Date(data.receipt.end).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
          <span><strong>{data.receipt.hours} hours</strong>{data.receipt.overtime > 0 && `, including ${data.receipt.overtime} overtime`}</span>
        </div>
      )}
    </main>
  );
}

function Passport({ id }: { id: string }) {
  const { data, error } = useLoad(() => api<{ name: string; job: string; employer: string; sector: string; since: string; shifts: number; hours: number; receipts: number; skills: { title: string; issuer: string; date: string; verified: boolean }[] }>(`/passport/${encodeURIComponent(id)}`), [id]);
  return (
    <main className="login" id="main">
      <Logo />
      {error && <p className="error" role="alert">{error}</p>}
      {data && (
        <>
          <div className="passport">
            <span className="tiny" style={{ letterSpacing: ".1em", fontWeight: 800, opacity: 0.8 }}>FAIRSHIFT SKILL PASSPORT · VERIFIED</span>
            <div className="row">
              <Avatar name={data.name} size={56} />
              <div>
                <h1 style={{ fontSize: 24 }}>{data.name}</h1>
                <span style={{ opacity: 0.85 }}>{data.job} · {SECTOR_LABEL[data.sector]}</span>
              </div>
            </div>
            <div className="row" style={{ gap: 22 }}>
              <div><strong style={{ fontSize: 24 }}>{data.hours}</strong><br /><span className="tiny">hours worked</span></div>
              <div><strong style={{ fontSize: 24 }}>{data.shifts}</strong><br /><span className="tiny">shifts</span></div>
              <div><strong style={{ fontSize: 24 }}>{data.receipts}</strong><br /><span className="tiny">sealed receipts</span></div>
            </div>
          </div>
          <div className="card pad col">
            <h2 style={{ fontSize: 18 }}>Skills and training</h2>
            {data.skills.map((s) => (
              <div key={s.title} className="row">
                <BadgeCheck color={s.verified ? "var(--brand)" : "var(--muted)"} aria-hidden="true" />
                <span className="grow"><strong>{s.title}</strong><br /><span className="small muted">{s.issuer} · {s.date}</span></span>
                {s.verified && <span className="chip green">Verified</span>}
              </div>
            ))}
            <p className="small muted" style={{ margin: 0 }}>Currently with {data.employer} since {data.since}.</p>
          </div>
        </>
      )}
    </main>
  );
}
