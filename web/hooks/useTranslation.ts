import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import {
  translations,
  errorKeyByMessage,
  Language,
  TranslationKey,
} from "../lib/translations";
import { settingsChanged } from "../lib/settings";

export function useTranslation() {
  const { appState, dispatch } = useContext(AppContext);
  const language: Language = appState.language ?? "en";

  const t = (key: TranslationKey): string => {
    return translations[language][key] ?? translations.en[key] ?? key;
  };

  // Renders a keyed log line (see backend/server/logs.go): the {0}, {1}, …
  // placeholders in the dictionary template are replaced by the params.
  // Logs without a key (or with an unknown one) fall back to the raw
  // message so nothing ever renders blank.
  const tLog = (log: {
    key?: string;
    params?: string[];
    message: string;
  }): string => {
    if (log.key) {
      const dict = translations[language] as Record<string, string>;
      const fallback = translations.en as Record<string, string>;
      const tpl = dict[log.key] ?? fallback[log.key];
      if (tpl) {
        return (log.params ?? []).reduce(
          (s, p, i) => s.split(`{${i}}`).join(p),
          tpl
        );
      }
    }
    return log.message;
  };

  const tError = (message: string | null | undefined): string => {
    if (!message) {
      return "";
    }
    const key = errorKeyByMessage[message];
    return key ? t(key) : message;
  };

  const setLanguage = (lang: Language) => {
    dispatch({ type: "setLanguage", payload: lang });
    if (typeof window !== "undefined") {
      window.localStorage.setItem("gopoker-lang", lang);
    }
    // Mirror onto the account too (see lib/settings.ts).
    settingsChanged();
  };

  return { t, tLog, tError, language, setLanguage };
}
