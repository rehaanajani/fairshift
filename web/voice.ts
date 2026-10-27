/** Speech in and out using the phone's own engines: free, offline-capable on Android, and fine on cheap phones. */
import { SPEECH, type Lang } from "./i18n";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const Ctor = (globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

export const canListen = !!Ctor;

/** Starts dictation; calls onText with the running transcript. Returns a stop function. */
export function listen(lang: Lang, onText: (text: string) => void, onEnd: () => void): () => void {
  if (!Ctor) {
    onEnd();
    return () => {};
  }
  const r = new Ctor();
  r.lang = SPEECH[lang];
  r.interimResults = true;
  r.continuous = true;
  r.onresult = (e) => onText(Array.from(e.results, (res) => res[0]?.transcript ?? "").join(" "));
  r.onend = onEnd;
  r.onerror = onEnd;
  r.start();
  return () => r.stop();
}

export function speak(text: string, lang: Lang) {
  if (!("speechSynthesis" in globalThis)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH[lang];
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(SPEECH[lang].slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

export const stopSpeaking = () => globalThis.speechSynthesis?.cancel();
