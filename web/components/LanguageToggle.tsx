import { useTranslation } from "../hooks/useTranslation";

export default function LanguageToggle() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <button
      onClick={() => setLanguage(language === "en" ? "zh" : "en")}
      className="btn btn-icon"
    >
      {t("switchLanguage")}
    </button>
  );
}
