import { describe, expect, it } from "vitest";
import locales from "../web/locales.json" with { type: "json" };
import { EN, LANGS, t, tf } from "../web/i18n.ts";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("worker interface languages", () => {
  it("ships all 16 languages", () => {
    expect(LANGS).toHaveLength(16);
    for (const lang of LANGS.filter((l) => l !== "en")) expect(Object.keys(locales)).toContain(lang);
  });

  it.each(LANGS.filter((l) => l !== "en"))("%s has every interface string, with the same placeholders as English", (lang) => {
    const dict = (locales as Record<string, Record<string, string>>)[lang]!;
    for (const [key, english] of Object.entries(EN)) {
      expect(dict[key], `${lang}.${key}`).toBeTruthy();
      expect(placeholders(dict[key]!), `${lang}.${key}`).toEqual(placeholders(english));
    }
  });

  it("fills placeholders and falls back to English for unknown keys", () => {
    expect(tf("en", "payRegularWhy", { hours: 8, rate: 95 })).toBe("8 hours at ₹95 an hour.");
    expect(tf("ta", "errTooFar", { m: 420 })).toContain("420");
    expect(t("en", "hello")).toBe("Hello");
  });
});
