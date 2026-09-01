import { Language } from "./translations";

const CHINESE_COUNTRIES = new Set(["CN", "TW", "HK", "MO", "SG"]);

// initialLanguage is a synchronous check of the browser locale, used to seed
// the app before any network call can complete.
export function initialLanguage(): Language {
    if (typeof navigator !== "undefined") {
        const lang = (navigator.language || "").toLowerCase();
        if (lang.startsWith("zh")) {
            return "zh";
        }
    }
    return "en";
}

// detectLanguage resolves the default language for a new visitor: browser
// locale first, then an IP-based geolocation lookup for Chinese-speaking
// regions, falling back to English on any failure.
export async function detectLanguage(): Promise<Language> {
    if (initialLanguage() === "zh") {
        return "zh";
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch("https://ipapi.co/json/", {
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const data = await res.json();
            const code = String(data?.country_code ?? "").toUpperCase();
            if (CHINESE_COUNTRIES.has(code)) {
                return "zh";
            }
        }
    } catch {
        // Network or API failure — keep English.
    }

    return "en";
}
