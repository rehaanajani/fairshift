/**
 * Fills web/locales.json: the worker app's interface text in every supported language, translated by
 * Gemini on Vertex AI with instructions to use plain, spoken words. Run once after adding interface text:
 *   GOOGLE_CLOUD_PROJECT=... npx tsx scripts/translate.ts
 */
import { GoogleGenAI } from "@google/genai";
import { writeFileSync } from "node:fs";
import { EN, LANGS } from "../web/i18n.ts";
import { LANG_NAME } from "../server/types.ts";

const ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT!, location: process.env.GOOGLE_CLOUD_LOCATION || "global" });
const out: Record<string, Record<string, string>> = {};
await Promise.all(
  LANGS.filter((l) => l !== "en").map(async (lang) => {
    for (const model of ["gemini-3.5-flash", "gemini-3.5-flash-lite"]) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: `Translate the values of this JSON into ${LANG_NAME[lang]} for a mobile app used by daily-wage workers with limited literacy in India.
Use simple, everyday spoken words (not formal or Sanskritised), in the native script. Keep "QR", "PF", "ESI" as is. Keep the keys. Return JSON only.
${JSON.stringify(EN)}`,
          config: { responseMimeType: "application/json", temperature: 0.2 },
        });
        out[lang] = JSON.parse(res.text!);
        console.log(lang, model, Object.keys(out[lang]!).length);
        return;
      } catch (e) {
        console.warn(lang, model, (e as Error).message.slice(0, 100));
      }
    }
  }),
);
writeFileSync(new URL("../web/locales.json", import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
