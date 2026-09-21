"use client";

import { useRouter } from "next/navigation";
import { UI_LANG_COOKIE, type UiLang } from "@/i18n";

/** Switches the interface language; the choice lives in a cookie so server pages render it too. */
export function LanguageToggle({ lang, label }: { lang: UiLang; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="button ghost"
      onClick={() => {
        const next: UiLang = lang === "en" ? "ko" : "en";
        document.cookie = `${UI_LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
