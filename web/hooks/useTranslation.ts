import { useContext } from "react";
import { AppContext } from "../providers/AppStore";
import { translations, errorKeyByMessage, Language, TranslationKey } from "../lib/translations";

export function useTranslation() {
    const { appState, dispatch } = useContext(AppContext);
    const language: Language = appState.language ?? "en";

    const t = (key: TranslationKey): string => {
        return translations[language][key] ?? translations.en[key] ?? key;
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
    };

    return { t, tError, language, setLanguage };
}
