import { en, type Dictionary } from "./en";
import { ko } from "./ko";

export type UiLang = "en" | "ko";
export const UI_LANG_COOKIE = "scene_lang";

const DICTIONARIES: Record<UiLang, Dictionary> = { en, ko };

export function dictionary(lang: UiLang): Dictionary {
  return DICTIONARIES[lang];
}

export function asUiLang(value: string | undefined): UiLang {
  return value === "ko" ? "ko" : "en";
}

/** Fills {name} placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
