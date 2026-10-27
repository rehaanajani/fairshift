/**
 * Speech in 16 Indian languages. Sarvam AI (built for Indian languages and accents) does speech-to-text
 * and text-to-speech for 11 of them; Gemini transcribes the rest, and Google Cloud Text-to-Speech voices
 * them where it has a voice. If nothing can voice a language, the phone's own speech engine is used.
 */
import { GoogleAuth } from "google-auth-library";
import { transcribeWithGemini } from "./ai.ts";
import { LANGS, type Lang } from "./types.ts";

const SARVAM = "https://api.sarvam.ai";
const SARVAM_CODES: Partial<Record<Lang, string>> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", gu: "gu-IN", pa: "pa-IN", or: "od-IN",
};
/** Google Cloud TTS voices for languages Sarvam doesn't speak yet. */
const GOOGLE_TTS: Partial<Record<Lang, string>> = { ur: "ur-IN", ne: "ne-NP", as: "as-IN", kok: "hi-IN", mai: "hi-IN" };
const TIMEOUT_MS = 15_000;

const key = () => process.env.SARVAM_API_KEY;
const fromSarvamCode = (code: string | undefined): Lang | undefined =>
  (Object.entries(SARVAM_CODES).find(([, c]) => c === code)?.[0] as Lang | undefined) ?? undefined;

export const speechStatus = () => ({ sarvam: !!key(), languages: LANGS.length, sarvamLanguages: Object.keys(SARVAM_CODES).length });

export interface Heard {
  text: string;
  lang: Lang;
  engine: "sarvam" | "gemini";
}

/** Speech to text. `hint` is the worker's chosen language; Sarvam also detects it from the audio. */
export async function transcribe(audio: Buffer, mime: string, hint: Lang): Promise<Heard | null> {
  if (key() && (SARVAM_CODES[hint] || hint === "en")) {
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${mime.includes("wav") ? "wav" : "webm"}`);
      form.append("model", process.env.SARVAM_STT_MODEL || "saarika:v2.5");
      form.append("language_code", "unknown");
      const res = await fetch(`${SARVAM}/speech-to-text`, { method: "POST", headers: { "api-subscription-key": key()! }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const out = (await res.json()) as { transcript?: string; language_code?: string };
        if (out.transcript?.trim()) return { text: out.transcript.trim(), lang: fromSarvamCode(out.language_code) ?? hint, engine: "sarvam" };
      } else console.warn("sarvam stt:", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.warn("sarvam stt:", (e as Error).message);
    }
  }
  const g = await transcribeWithGemini(audio, mime, hint);
  return g ? { ...g, engine: "gemini" } : null;
}

export interface Spoken {
  audio: string; // base64
  mime: string;
  engine: "sarvam" | "google";
}

/** Text to speech. Returns null when the browser should speak it instead. */
export async function synthesize(text: string, lang: Lang): Promise<Spoken | null> {
  const clipped = text.slice(0, 1400);
  const code = SARVAM_CODES[lang];
  if (key() && code) {
    try {
      const res = await fetch(`${SARVAM}/text-to-speech`, {
        method: "POST",
        headers: { "api-subscription-key": key()!, "content-type": "application/json" },
        body: JSON.stringify({ text: clipped, target_language_code: code, model: process.env.SARVAM_TTS_MODEL || "bulbul:v2", speaker: process.env.SARVAM_SPEAKER || "anushka", pace: 0.95 }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        const out = (await res.json()) as { audios?: string[] };
        if (out.audios?.[0]) return { audio: out.audios[0], mime: "audio/wav", engine: "sarvam" };
      } else console.warn("sarvam tts:", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.warn("sarvam tts:", (e as Error).message);
    }
  }
  return googleTts(clipped, GOOGLE_TTS[lang] ?? code ?? "en-IN");
}

let auth: GoogleAuth | undefined;
async function googleTts(text: string, languageCode: string): Promise<Spoken | null> {
  if (!process.env.GOOGLE_CLOUD_PROJECT || process.env.FAIRSHIFT_AI === "off") return null;
  try {
    auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const token = await auth.getAccessToken();
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-goog-user-project": process.env.GOOGLE_CLOUD_PROJECT },
      body: JSON.stringify({ input: { text }, voice: { languageCode }, audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("google tts:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const out = (await res.json()) as { audioContent?: string };
    return out.audioContent ? { audio: out.audioContent, mime: "audio/mpeg", engine: "google" } : null;
  } catch (e) {
    console.warn("google tts:", (e as Error).message);
    return null;
  }
}
