/** Voice in and out. Recording uses the phone's microphone; Gemini on the server understands it. */
import { api, fileToBase64, type Role } from "./api";

export const canRecord = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Starts recording; call the returned function to stop and get the audio as base64. */
export async function record(): Promise<() => Promise<{ data: string; type: string } | null>> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  const started = Date.now();
  return () =>
    new Promise((resolve) => {
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (Date.now() - started < 400 || !chunks.length) return resolve(null);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const out = await fileToBase64(blob);
        resolve({ data: out.data, type: (rec.mimeType || "audio/webm").split(";")[0]! });
      };
      rec.stop();
    });
}

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
  globalThis.speechSynthesis?.cancel();
}

/** Plays server audio if we have it; otherwise asks the server for it; otherwise uses the phone's own voice. */
export async function speak(text: string, lang: string, role: Role, ready?: { audio: string | null; mime?: string } | null) {
  stopSpeaking();
  let clip = ready?.audio ? ready : null;
  if (!clip) clip = await api<{ audio: string | null; mime?: string }>("/speech", { body: { text, lang }, role }).catch(() => null);
  if (clip?.audio) {
    current = new Audio(`data:${clip.mime ?? "audio/wav"};base64,${clip.audio}`);
    await current.play().catch(() => {});
    return;
  }
  if ("speechSynthesis" in globalThis) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = `${lang}-IN`;
    speechSynthesis.speak(u);
  }
}
