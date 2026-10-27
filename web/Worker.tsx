/**
 * The worker's phone app. Built for basic smartphones and limited literacy: one big talk button,
 * icons with every label, everything readable aloud, and the worker's own language throughout.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Camera,
  Home,
  IndianRupee,
  LogOut,
  MapPin,
  MessageCircleHeart,
  Mic,
  QrCode,
  Receipt,
  ScanLine,
  Volume2,
} from "lucide-react";
import QRCode from "qrcode";
import { api, ApiError, fileToBase64, live } from "./api";
import { LANG_LABEL, LANGS, RTL, t, tf, type Key, type Lang } from "./i18n";
import { Avatar, SkipLink, ThemeToggle, day, rupees, useLoad, useNow, when } from "./ui";
import { canRecord, record, speak, stopSpeaking } from "./voice";

interface ReceiptView {
  code: string;
  kind: string;
  start: string;
  end: string;
  hours: number;
  overtime: number;
  reason?: string;
  by: string;
}
interface Me {
  worker: { id: string; name: string; job: string; lang: Lang; hourlyRate: number; joinedOn: string };
  org: { name: string; sector: string; policy: { dailyHours: number; weeklyHours: number; overtimeRate: number; pfRate: number; esiRate: number } };
  site: { name: string };
  onShift: { start: string } | null;
  hours14d: { regular: number; overtime: number };
  daysWorked14d: number;
  fatigue: { kind: string; detail: string; at: string; value: number; limit: number }[];
  planned: { start: string; end: string }[];
  receipts: ReceiptView[];
  skills: { id: string; title: string; issuer: string; date: string; verified: boolean }[];
  passport: string;
  hazards: { id: string; category: string; status: string; summary: string; createdAt: string }[];
}
type Tab = "home" | "pay" | "danger" | "voice" | "passport";

export function Worker({ onLogout }: { onLogout: () => void }) {
  const { data: me, reload, error } = useLoad(() => api<Me>("/w/me"));
  const [tab, setTab] = useState<Tab>("home");
  // what the worker said to the assistant, carried into the report form so they never repeat it
  const [draft, setDraft] = useState("");
  // the worker's saved language, unless they just picked another one
  const [picked, setPicked] = useState<Lang | null>(null);
  const lang: Lang = picked ?? me?.worker.lang ?? "en";
  useEffect(() => live("/w/events", "worker", () => void reload()), [reload]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
  }, [lang]);
  const L = (k: Key) => t(lang, k);

  if (error)
    return (
      <main className="phone pad">
        <p className="error" role="alert">
          {error}
        </p>
        <button className="btn" onClick={onLogout}>
          {L("logout")}
        </button>
      </main>
    );
  if (!me)
    return (
      <main className="phone pad" aria-busy="true">
        <span className="spin" />
      </main>
    );

  const changeLang = async (l: Lang) => {
    setPicked(l);
    await api("/w/me", { method: "PATCH", body: { lang: l } }).catch(() => {});
  };
  const tabs: [Tab, typeof Home, Key][] = [
    ["home", Home, "home"],
    ["pay", IndianRupee, "pay"],
    ["danger", AlertTriangle, "safety"],
    ["voice", MessageCircleHeart, "voice"],
    ["passport", BadgeCheck, "skills"],
  ];

  return (
    <div className="phone">
      <SkipLink to="content">Skip to content</SkipLink>
      <header className="phone-top">
        <Avatar name={me.worker.name} size={42} />
        <div className="grow">
          <h1>
            {L("hello")}, {me.worker.name.split(" ")[0]}
          </h1>
          <span className="small muted">
            {me.worker.job} · {me.org.name}
          </span>
        </div>
        <ThemeToggle labels={{ system: L("themeSystem"), light: L("themeLight"), dark: L("themeDark") }} />
        <label className="sr-only" htmlFor="lang">
          Language
        </label>
        <select id="lang" className="lang-select" value={lang} onChange={(e) => void changeLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {LANG_LABEL[l]}
            </option>
          ))}
        </select>
      </header>
      <main className="phone-body" id="content" tabIndex={-1}>
        {tab === "home" && <HomeTab me={me} lang={lang} L={L} reload={reload} go={setTab} onDraft={setDraft} />}
        {tab === "pay" && <PayTab lang={lang} L={L} policy={me.org.policy} />}
        {tab === "danger" && <DangerTab me={me} lang={lang} L={L} reload={reload} draft={draft} clearDraft={() => setDraft("")} />}
        {tab === "voice" && <FeedbackTab lang={lang} L={L} />}
        {tab === "passport" && <PassportTab me={me} L={L} onLogout={onLogout} />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {tabs.map(([id, Icon, k]) => (
          <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => (stopSpeaking(), setTab(id))}>
            <Icon size={22} aria-hidden="true" />
            {L(k)}
          </button>
        ))}
      </nav>
    </div>
  );
}

type Props = { lang: Lang; L: (k: Key) => string };

/** Hold to talk: Gemini hears the worker, Gemini answers from their own records, and the answer is spoken. */
function TalkButton({ lang, L, onAction }: Props & { onAction: (action: string, said: string) => void }) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [said, setSaid] = useState("");
  const [reply, setReply] = useState<{ answer: string; action: string; intent: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const stop = useRef<null | (() => Promise<{ data: string; type: string } | null>)>(null);

  const send = async (body: object) => {
    setState("busy");
    setErr("");
    try {
      const r = await api<{
        heard: string;
        reply: { answer: string; action: string; intent: string };
        speech: { audio: string; mime: string } | null;
        lang: Lang;
      }>("/w/voice", { body: { ...body, lang } });
      setSaid(r.heard);
      setReply(r.reply);
      void speak(r.reply.answer, r.lang, "worker", r.speech);
    } catch (e) {
      setErr((e as Error).message);
    }
    setState("idle");
  };
  const start = async () => {
    if (state !== "idle") return;
    stopSpeaking();
    try {
      stop.current = await record();
      setState("rec");
    } catch {
      setErr("Allow the microphone, or type below.");
    }
  };
  const end = async () => {
    if (state !== "rec" || !stop.current) return;
    const audio = await stop.current();
    stop.current = null;
    if (!audio) return setState("idle");
    await send({ audio: audio.data, mime: audio.type });
  };

  return (
    <section className="card talk" aria-label={L("holdToTalk")}>
      <button
        type="button"
        className={`mic ${state === "rec" ? "on" : state === "busy" ? "busy" : ""}`}
        aria-label={state === "rec" ? L("listening") : L("holdToTalk")}
        disabled={!canRecord || state === "busy"}
        onPointerDown={(e) => (e.preventDefault(), void start())}
        onPointerUp={() => void end()}
        onPointerLeave={() => void end()}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), void start())}
        onKeyUp={(e) => (e.key === " " || e.key === "Enter") && void end()}
      >
        {state === "busy" ? <span className="spin" style={{ width: 40, height: 40, borderWidth: 4 }} /> : <Mic size={54} aria-hidden="true" />}
      </button>
      <strong style={{ fontSize: 18 }}>{state === "rec" ? L("listening") : state === "busy" ? L("thinking") : L("holdToTalk")}</strong>
      <span className="small muted">{L("talkHint")}</span>
      {said && (
        <p className="bubble me" style={{ margin: 0 }}>
          <span className="tiny muted">{L("you")}</span>
          <br />
          {said}
        </p>
      )}
      {reply && (
        <div className="bubble ai col" style={{ gap: 8 }} aria-live="polite">
          <span>{reply.answer}</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn sm" onClick={() => void speak(reply.answer, lang, "worker")}>
              <Volume2 size={16} aria-hidden="true" /> {L("listen")}
            </button>
            {reply.action === "report_hazard" && (
              <button type="button" className="btn sm danger" onClick={() => onAction("report_hazard", said)}>
                <AlertTriangle size={16} aria-hidden="true" /> {L("reportThis")}
              </button>
            )}
            {reply.action === "give_feedback" && (
              <button type="button" className="btn sm" onClick={() => onAction("give_feedback", said)}>
                {L("speakAnon")}
              </button>
            )}
          </div>
        </div>
      )}
      {err && (
        <p className="error" role="alert" style={{ margin: 0, width: "100%" }}>
          {err}
        </p>
      )}
      <form className="row" style={{ width: "100%" }} onSubmit={(e) => (e.preventDefault(), typed.trim() && void send({ text: typed.trim() }), setTyped(""))}>
        <label className="sr-only" htmlFor="ask">
          Type your question
        </label>
        <input id="ask" className="input grow" placeholder="…" value={typed} onChange={(e) => setTyped(e.target.value)} dir="auto" />
        <button className="btn primary" type="submit" disabled={!typed.trim() || state === "busy"}>
          {L("send")}
        </button>
      </form>
    </section>
  );
}

function HomeTab({ me, lang, L, reload, go, onDraft }: Props & { me: Me; reload: () => Promise<void>; go: (t: Tab) => void; onDraft: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const nowMs = useNow();

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setErr(errorText(e, lang));
    }
    setBusy(false);
  };
  const checkIn = (body: object) => act(() => api("/w/shift/check-in", { body }));
  const gps = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => void checkIn({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setErr(L("errLocationOff")),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  const checkOut = () => act(async () => setReceipt((await api<{ receipt: ReceiptView }>("/w/shift/check-out", { body: {} })).receipt));
  const hoursNow = me.onShift ? (nowMs - new Date(me.onShift.start).getTime()) / 3_600_000 : 0;
  const next = me.planned[0];

  return (
    <>
      <section className="card shift-card" aria-label={L("shift")}>
        <div className="row">
          <span className="grow small" style={{ opacity: 0.9 }}>
            {me.site.name}
          </span>
          <span className="chip" style={{ background: "rgb(255 255 255 / 18%)", color: "#fff" }}>
            {me.onShift ? "● LIVE" : L("notOnShift")}
          </span>
        </div>
        {me.onShift ? (
          <>
            <div>
              <div className="big">{hoursNow.toFixed(1)} h</div>
              <span className="small" style={{ opacity: 0.9 }}>
                {L("onShiftSince")} {new Date(me.onShift.start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
            {hoursNow > me.org.policy.dailyHours && (
              <span className="chip gold" style={{ justifySelf: "start" }}>
                {L("overtime")}: {(hoursNow - me.org.policy.dailyHours).toFixed(1)} h × {me.org.policy.overtimeRate}
              </span>
            )}
            <button type="button" className="btn lg light block" disabled={busy} onClick={() => void checkOut()}>
              {L("checkOut")}
            </button>
          </>
        ) : (
          <>
            <div className="big" style={{ fontSize: 26 }}>
              {L("checkIn")}
            </div>
            <div className="row">
              <button type="button" className="btn lg light grow" disabled={busy} onClick={() => setScan(true)}>
                <ScanLine aria-hidden="true" /> {L("scanQr")}
              </button>
              <button type="button" className="btn lg outline" disabled={busy} onClick={gps} aria-label={L("useLocation")}>
                <MapPin aria-hidden="true" />
              </button>
            </div>
            <form className="row" onSubmit={(e) => (e.preventDefault(), code && void checkIn({ code }))}>
              <label className="sr-only" htmlFor="code">
                {L("typeCode")}
              </label>
              <input
                id="code"
                className="input grow"
                style={{ minHeight: 44 }}
                placeholder={L("typeCode")}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
              />
              <button className="btn outline" type="submit" disabled={!code || busy}>
                OK
              </button>
            </form>
          </>
        )}
        {err && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {err}
          </p>
        )}
      </section>
      {scan && <QrScanner onCode={(c) => (setScan(false), void checkIn({ code: c }))} onClose={() => setScan(false)} />}
      {receipt && <ReceiptCard r={receipt} L={L} highlight />}

      <TalkButton lang={lang} L={L} onAction={(a, said) => (onDraft(said), go(a === "report_hazard" ? "danger" : "voice"))} />

      <div className="tiles">
        <button type="button" className="tile" onClick={() => go("pay")}>
          <span className="ic" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
            <IndianRupee aria-hidden="true" />
          </span>
          <span>
            <strong>
              {Math.round(me.hours14d.regular + me.hours14d.overtime)} {L("hours")}
            </strong>
            <br />
            <span className="small muted">
              {L("hours14")} · {Math.round(me.hours14d.overtime)} {L("overtime").toLowerCase()}
            </span>
          </span>
        </button>
        <button type="button" className="tile" onClick={() => go("danger")}>
          <span className="ic" style={{ background: "var(--red-soft)", color: "var(--red)" }}>
            <AlertTriangle aria-hidden="true" />
          </span>
          <strong>{L("safety")}</strong>
        </button>
      </div>
      {me.fatigue.length > 0 && (
        <div className="card pad" style={{ borderColor: "#f6dcae", background: "var(--gold-soft)" }} role="status">
          <strong>⚠ {L("tired")}</strong>
          <p className="small" style={{ margin: "4px 0 0" }}>
            {fatigueText(me.fatigue.at(-1)!, lang)}
          </p>
        </div>
      )}
      {next && (
        <div className="card pad row">
          <strong className="grow">{L("nextShift")}</strong>
          <span>{when(next.start)}</span>
        </div>
      )}
      {me.receipts[0] && !receipt && <ReceiptCard r={me.receipts[0]} L={L} />}
    </>
  );
}

function ReceiptCard({ r, L, highlight }: { r: ReceiptView; L: (k: Key) => string; highlight?: boolean }) {
  return (
    <section
      className="receipt"
      style={highlight ? { borderColor: "var(--brand)", background: "var(--brand-soft)" } : undefined}
      aria-label={L("receiptTitle")}
    >
      <div className="row">
        <Receipt size={18} color="var(--brand)" aria-hidden="true" />
        <strong className="grow">{L("receiptTitle")}</strong>
        {r.kind === "correction" && <span className="chip gold">{L("corrected")}</span>}
      </div>
      <span>
        <strong>
          {r.hours} {L("hours")}
        </strong>
        {r.overtime > 0 && ` · ${r.overtime} ${L("overtime").toLowerCase()}`} · {day(r.start)}
      </span>
      {r.reason && <span className="small">“{r.reason}”</span>}
      <a className="mono" href={`#/r/${r.code}`} style={{ fontWeight: 800, fontSize: 18 }}>
        {r.code}
      </a>
      <span className="tiny muted">{L("receiptNote")}</span>
    </section>
  );
}

/** Uses the phone's built-in QR reader (BarcodeDetector) where available; otherwise the worker types the code. */
function QrScanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const Detector = (window as unknown as { BarcodeDetector?: new (o: object) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } })
    .BarcodeDetector;
  const [msg, setMsg] = useState(Detector ? "" : "This phone can't scan here. Type the code on the poster instead.");
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    if (!Detector) return;
    const det = new Detector({ formats: ["qr_code"] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        video.current!.srcObject = s;
        await video.current!.play();
        timer = window.setInterval(async () => {
          const found = await det.detect(video.current!).catch(() => []);
          if (found[0]) onCode(found[0].rawValue);
        }, 400);
      })
      .catch(() => setMsg("Allow the camera, or type the code on the poster."));
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode, Detector]);
  return (
    <section className="card pad col" aria-label="QR scanner">
      <video ref={video} muted playsInline style={{ width: "100%", borderRadius: 14, background: "#000", aspectRatio: "1" }} />
      {msg && (
        <p className="note" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
      <button type="button" className="btn" onClick={onClose}>
        Close
      </button>
    </section>
  );
}

interface Slip {
  gross: number;
  net: number;
  deductions: number;
  shifts: number;
  lines: { key: string; label: string; hours?: number; rate?: number; amount: number; why: string }[];
}

const FATIGUE_KEY: Record<string, Key> = { "long-shift": "fatLong", "short-rest": "fatRest", "no-day-off": "fatDays", "week-over-limit": "fatWeek" };
const fatigueText = (f: { kind: string; detail: string; value: number; limit: number }, lang: Lang) =>
  FATIGUE_KEY[f.kind] && f.value !== undefined ? tf(lang, FATIGUE_KEY[f.kind]!, { value: f.value, limit: f.limit }) : f.detail;

/** Server errors carry a code so the worker sees them in their own language. */
const ERROR_KEY: Record<string, Key> = {
  already_in: "errAlreadyIn",
  not_in: "errNotIn",
  wrong_code: "errWrongCode",
  too_far: "errTooFar",
  need_code: "errNeedCode",
  bad_location: "errBadLocation",
};
function errorText(e: unknown, lang: Lang) {
  const body = e instanceof ApiError ? (e.body as { code?: string; meters?: number } | undefined) : undefined;
  return body?.code && ERROR_KEY[body.code] ? tf(lang, ERROR_KEY[body.code]!, { m: body.meters ?? "" }) : (e as Error).message;
}

type Policy = Me["org"]["policy"];
/** Each payslip line, said in the worker's language from the same numbers the server used. */
function payLine(l: Slip["lines"][number], lang: Lang, p: Policy): { label: string; why: string } {
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (l.key === "regular") return { label: t(lang, "payRegular"), why: tf(lang, "payRegularWhy", { hours: n(l.hours), rate: n(l.rate) }) };
  if (l.key === "overtime")
    return {
      label: t(lang, "payOvertime"),
      why: tf(lang, "payOvertimeWhy", { hours: n(l.hours), rate: n(l.rate), x: p.overtimeRate, daily: p.dailyHours, weekly: p.weeklyHours }),
    };
  if (l.key === "pf") return { label: t(lang, "payPf"), why: tf(lang, "payPfWhy", { pct: n(p.pfRate * 100) }) };
  if (l.key === "esi") return { label: t(lang, "payEsi"), why: tf(lang, "payEsiWhy", { pct: n(p.esiRate * 100) }) };
  return { label: l.label, why: l.why };
}

function PayTab({ lang, L, policy }: Props & { policy: Policy }) {
  const [period, setPeriod] = useState<"month" | "week">("month");
  const { data: slip } = useLoad(() => api<Slip>(`/w/payslip?period=${period}`), period);
  const [explain, setExplain] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const colors: Record<string, string> = { regular: "#161714", overtime: "#9b87ef", pf: "#d9cfb4", esi: "#b9b6c9" };
  const explainPay = async () => {
    setBusy(true);
    const r = await api<{ text: string }>("/w/payslip/explain", { body: { lang, period } }).catch((e) => ({ text: (e as Error).message }));
    setExplain(r.text);
    setBusy(false);
    void speak(r.text, lang, "worker");
  };
  if (!slip) return <span className="spin" aria-label="Loading" />;
  const total = slip.lines.reduce((s, l) => s + Math.abs(l.amount), 0) || 1;
  return (
    <>
      <div className="row" role="group" aria-label="Period">
        {(["month", "week"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`btn sm ${period === p ? "primary" : ""}`}
            aria-pressed={period === p}
            onClick={() => (setPeriod(p), setExplain(""))}
          >
            {L(p === "month" ? "last30" : "thisWeek")}
          </button>
        ))}
      </div>
      <section className="card pad col">
        <span className="muted small" style={{ fontWeight: 700 }}>
          {L("takeHome")} · {slip.shifts} {L("shifts")}
        </span>
        <span className="money">{rupees(slip.net)}</span>
        <div className="bar" aria-hidden="true">
          {slip.lines.map((l) => (
            <span key={l.key} style={{ width: `${(Math.abs(l.amount) / total) * 100}%`, background: colors[l.key] }} />
          ))}
        </div>
        <div>
          {slip.lines.map((l) => (
            <div className="line" key={l.key}>
              <span className="dot" style={{ background: colors[l.key] }} aria-hidden="true" />
              <span>
                <strong>{payLine(l, lang, policy).label}</strong>
                <br />
                <span className="small muted">{payLine(l, lang, policy).why}</span>
              </span>
              <strong style={{ color: l.amount < 0 ? "var(--ink-2)" : "var(--ink)" }}>
                {l.amount < 0 ? "−" : ""}
                {rupees(Math.abs(l.amount))}
              </strong>
            </div>
          ))}
        </div>
        <button type="button" className="btn primary lg block" disabled={busy} onClick={() => void explainPay()}>
          {busy ? <span className="spin" /> : <Volume2 aria-hidden="true" />} {L("explain")}
        </button>
        {explain && (
          <p className="bubble ai" style={{ margin: 0 }} aria-live="polite">
            {explain}
          </p>
        )}
      </section>
    </>
  );
}

function DangerTab({ me, lang, L, reload, draft, clearDraft }: Props & { me: Me; reload: () => Promise<void>; draft: string; clearDraft: () => void }) {
  const [text, setText] = useState(draft);
  const [track, setTrack] = useState("");
  const [tracked, setTracked] = useState<{ status: string; category: string; updates: { at: string; note: string }[] } | string | null>(null);
  const [photo, setPhoto] = useState<{ data: string; type: string; url: string } | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<null | (() => Promise<{ data: string; type: string } | null>)>(null);
  const [voice, setVoice] = useState<{ data: string; type: string } | null>(null);
  const [done, setDone] = useState<{ trackCode: string; category: string; severity: number; advice: string } | null>(null);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ trackCode: string; category: string; severity: number; advice: string; speech: { audio: string; mime: string } | null }>(
        "/w/hazards",
        {
          body: {
            text,
            lang,
            anonymous,
            ...(photo ? { photo: photo.data, photoType: photo.type } : {}),
            ...(voice ? { audio: voice.data, audioType: voice.type } : {}),
          },
        },
      );
      setDone(r);
      void speak(r.advice, lang, "worker", r.speech);
      setText("");
      clearDraft();
      setPhoto(null);
      setVoice(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const statusChip = (s: string) => <span className={`chip ${s === "fixed" ? "green" : s === "acknowledged" ? "blue" : "red"}`}>{L(s as Key)}</span>;

  return (
    <>
      <section className="card pad col" aria-label={L("safety")}>
        <h2 style={{ fontSize: 20 }}>{L("whatDanger")}</h2>
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setPhoto({ ...(await fileToBase64(f)), url: URL.createObjectURL(f) });
          }}
        />
        <div className="row">
          <button type="button" className="btn lg grow" onClick={() => file.current?.click()}>
            <Camera aria-hidden="true" /> {L("addPhoto")}
          </button>
          <button
            type="button"
            className={`btn lg ${rec ? "danger" : ""}`}
            disabled={!canRecord}
            aria-label={rec ? L("stop") : L("speak")}
            onClick={async () => {
              if (rec) {
                setVoice(await rec());
                setRec(null);
              } else {
                // store the stop function itself (a function passed straight to a setter would be called)
                const stop = await record().catch(() => null);
                setRec(() => stop);
              }
            }}
          >
            <Mic aria-hidden="true" /> {rec ? L("stop") : voice ? "✓" : L("speak")}
          </button>
        </div>
        {photo && <img className="photo-preview" src={photo.url} alt="Your photo of the danger" />}
        <label className="sr-only" htmlFor="hz">
          {L("whatDanger")}
        </label>
        <textarea id="hz" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
        <label className="row" style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} style={{ width: 24, height: 24 }} />
          {L("anonymous")}
        </label>
        {err && (
          <p className="error" role="alert">
            {err}
          </p>
        )}
        <button type="button" className="btn danger lg block" disabled={busy || (!text.trim() && !photo && !voice)} onClick={() => void submit()}>
          {busy ? <span className="spin" /> : <AlertTriangle aria-hidden="true" />} {L("send")}
        </button>
      </section>
      {done && (
        <section className="card pad col" style={{ borderColor: "var(--brand)" }} aria-live="polite">
          <strong>✓ {L("sent")}</strong>
          <span className="row wrap" style={{ gap: 6 }}>
            <span className={`chip ${done.severity === 3 ? "red" : "gold"}`}>{done.category}</span>
            <span className="chip">
              {L("trackCode")}: <span className="mono">{done.trackCode}</span>
            </span>
          </span>
          <p className="bubble ai" style={{ margin: 0 }}>
            {done.advice}
          </p>
        </section>
      )}
      {me.hazards.length > 0 && (
        <section className="card pad col">
          <h2 style={{ fontSize: 17 }}>{L("myReports")}</h2>
          {me.hazards.map((h) => (
            <div key={h.id} className="row" style={{ alignItems: "flex-start" }}>
              <span className="grow">
                <strong>{h.category}</strong>
                <br />
                <span className="small muted">{h.summary}</span>
              </span>
              {statusChip(h.status)}
            </div>
          ))}
        </section>
      )}
      <form
        className="card pad col"
        aria-label={L("trackCode")}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await api<{ status: string; category: string; updates: { at: string; note: string }[] }>(
            `/w/hazards/track/${encodeURIComponent(track.trim())}`,
          ).catch((err) => (err as Error).message);
          setTracked(r);
        }}
      >
        <label className="field">
          {L("trackCode")}
          <input
            className="input mono"
            value={track}
            onChange={(e) => setTrack(e.target.value.toUpperCase())}
            placeholder="SV-XXXXXX"
            autoCapitalize="characters"
          />
        </label>
        <button type="submit" className="btn" disabled={track.trim().length < 6}>
          OK
        </button>
        {typeof tracked === "string" && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {tracked}
          </p>
        )}
        {tracked && typeof tracked !== "string" && (
          <div className="col" style={{ gap: 6 }} aria-live="polite">
            <div className="row">
              <strong className="grow">{tracked.category}</strong>
              {statusChip(tracked.status)}
            </div>
            {tracked.updates.map((u) => (
              <span key={u.at} className="small muted">
                {when(u.at)} · {u.note}
              </span>
            ))}
          </div>
        )}
      </form>
    </>
  );
}

function FeedbackTab({ L }: Props) {
  const [topic, setTopic] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const topics: [string, string, Key][] = [
    ["manager", "🧑‍💼", "manager"],
    ["conditions", "🏗️", "conditions"],
    ["pay", "💰", "topicPay"],
    ["safety", "🦺", "topicSafety"],
  ];
  if (sent)
    return (
      <section className="card pad col" aria-live="polite">
        <strong style={{ fontSize: 20 }}>✓ {L("sent")}</strong>
        <button type="button" className="btn" onClick={() => (setSent(false), setTopic(""), setRating(0), setText(""))}>
          OK
        </button>
      </section>
    );
  return (
    <section className="card pad col">
      <h2 style={{ fontSize: 19 }}>{L("feedbackTitle")}</h2>
      <div className="topics" role="group" aria-label="Topic">
        {topics.map(([id, emoji, k]) => (
          <button key={id} type="button" className="topic" aria-pressed={topic === id} onClick={() => setTopic(id)}>
            <span style={{ fontSize: 24 }} aria-hidden="true">
              {emoji}
            </span>
            {L(k)}
          </button>
        ))}
      </div>
      <div className="faces" role="group" aria-label="Rating, 1 to 5">
        {["😡", "🙁", "😐", "🙂", "😄"].map((f, i) => (
          <button key={f} type="button" className="face" aria-pressed={rating === i + 1} aria-label={`${i + 1} of 5`} onClick={() => setRating(i + 1)}>
            {f}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="fb">
        Comment
      </label>
      <textarea id="fb" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}
      <button
        type="button"
        className="btn primary lg block"
        disabled={!topic || !rating}
        onClick={async () => {
          try {
            await api("/w/feedback", { body: { topic, rating, text } });
            setSent(true);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {L("send")}
      </button>
    </section>
  );
}

function PassportTab({ me, L, onLogout }: { me: Me; L: (k: Key) => string; onLogout: () => void }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(`${location.origin}/#/p/${me.passport}`, { margin: 1, width: 264 }).then(setQr);
  }, [me.passport]);
  return (
    <>
      <section className="passport" aria-label={L("skills")}>
        <span className="tiny" style={{ letterSpacing: ".1em", fontWeight: 800, opacity: 0.85 }}>
          FAIRSHIFT SKILL PASSPORT
        </span>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow col" style={{ gap: 6 }}>
            <strong style={{ fontSize: 22 }}>{me.worker.name}</strong>
            <span style={{ opacity: 0.85 }}>{me.worker.job}</span>
            <span className="small" style={{ opacity: 0.85 }}>
              {me.skills.filter((s) => s.verified).length} verified · {me.receipts.length}+ receipts
            </span>
          </div>
          {qr && <img className="qr" src={qr} alt="QR code of your skill passport" />}
        </div>
        <span className="small" style={{ opacity: 0.9 }}>
          <QrCode size={14} aria-hidden="true" /> {L("share")}
        </span>
      </section>
      <p className="small muted" style={{ margin: 0 }}>
        {L("passport")}
      </p>
      <section className="card pad col">
        {me.skills.length === 0 && <span className="muted">—</span>}
        {me.skills.map((s) => (
          <div key={s.id} className="row">
            <BadgeCheck color={s.verified ? "var(--brand)" : "var(--muted)"} aria-hidden="true" />
            <span className="grow">
              <strong>{s.title}</strong>
              <br />
              <span className="small muted">
                {s.issuer} · {s.date}
              </span>
            </span>
            {s.verified && <span className="chip green">{L("verified")}</span>}
          </div>
        ))}
      </section>
      <section className="col">
        <h2 style={{ fontSize: 17 }}>{L("receipts")}</h2>
        {me.receipts.slice(0, 5).map((r) => (
          <ReceiptCard key={r.code} r={r} L={L} />
        ))}
      </section>
      <button type="button" className="btn" onClick={onLogout}>
        <LogOut size={18} aria-hidden="true" /> {L("logout")}
      </button>
    </>
  );
}
