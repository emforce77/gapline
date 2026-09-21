"use client";

import { createContext, useContext } from "react";
import type { Dictionary } from "./en";
import type { UiLang } from "./index";

const I18nContext = createContext<{ lang: UiLang; t: Dictionary } | null>(null);

export function I18nProvider({
  lang,
  t,
  children,
}: {
  lang: UiLang;
  t: Dictionary;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={{ lang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
