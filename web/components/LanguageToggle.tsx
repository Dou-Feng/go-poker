import { useTranslation } from "../hooks/useTranslation";

export default function LanguageToggle() {
    const { language, setLanguage, t } = useTranslation();

    return (
        <button
            onClick={() => setLanguage(language === "en" ? "zh" : "en")}
            className="rounded-sm border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
        >
            {t("switchLanguage")}
        </button>
    );
}
