/**
 * Speech in 16 Indian languages, all on Google Cloud: Gemini on Vertex AI turns voice notes into text
 * (it understands every language FairShift supports, including code-mixed speech), and Cloud
 * Text-to-Speech reads answers aloud with Indian voices. Where Cloud TTS has no voice for a language,
 * the phone's own speech engine is used.
 */
import { GoogleAuth } from "google-auth-library";
import { transcribeWithGemini } from "./ai.ts";
import { LANGS, type Lang } from "./types.ts";

/** Cloud Text-to-Speech voices by language (Indian English and the major Indian languages). */
const TTS_CODES: Partial<Record<Lang, string>> = {
  en: "en-IN", hi: "hi-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", gu: "gu-IN", pa: "pa-IN", ur: "ur-IN",
  // Devanagari languages read well with Hindi or Marathi voices
  ne: "hi-IN", mai: "hi-IN", kok: "mr-IN",
};
const TIMEOUT_MS = 15_000;

export const speechStatus = () => ({ languages: LANGS.length, voices: Object.keys(TTS_CODES).length, engine: "gemini + cloud-tts" });

export interface Heard {
  text: string;
  lang: Lang;
  engine: "gemini";
}

/** Speech to text. `hint` is the worker's chosen language; Gemini also detects what was actually spoken. */
export async function transcribe(audio: Buffer, mime: string, hint: Lang): Promise<Heard | null> {
  const g = await transcribeWithGemini(audio, mime, hint);
  return g ? { ...g, engine: "gemini" } : null;
}

export interface Spoken {
  audio: string; // base64
  mime: string;
  engine: "cloud-tts";
}

let auth: GoogleAuth | undefined;

/** Text to speech with Cloud Text-to-Speech. Returns null when the phone should speak it instead. */
export async function synthesize(text: string, lang: Lang): Promise<Spoken | null> {
  const languageCode = TTS_CODES[lang];
  if (!languageCode || !process.env.GOOGLE_CLOUD_PROJECT || process.env.FAIRSHIFT_AI === "off") return null;
  try {
    auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const token = await auth.getAccessToken();
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-goog-user-project": process.env.GOOGLE_CLOUD_PROJECT },
      body: JSON.stringify({ input: { text: text.slice(0, 1400) }, voice: { languageCode }, audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("cloud tts:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const out = (await res.json()) as { audioContent?: string };
    return out.audioContent ? { audio: out.audioContent, mime: "audio/mpeg", engine: "cloud-tts" } : null;
  } catch (e) {
    console.warn("cloud tts:", (e as Error).message);
    return null;
  }
}
