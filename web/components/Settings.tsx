import { useState } from "react";
import { FiSettings } from "react-icons/fi";
import { useTranslation } from "../hooks/useTranslation";

export default function Settings() {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);

  const optionButton = (active: boolean) =>
    `rounded-sm px-3 py-1 text-sm ${
      active
        ? "bg-cyan-900 text-white"
        : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
    }`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(true)}
        title={t("settings")}
        className="rounded-sm border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200"
      >
        <FiSettings size="1rem" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-lg bg-zinc-800 p-5 shadow-2xl">
            <div className="mb-4 flex flex-row items-center justify-between">
              <p className="text-lg font-semibold text-white">
                {t("settings")}
              </p>
              <button
                onClick={() => setOpen(false)}
                className="rounded-sm px-2 py-1 text-neutral-400 hover:bg-zinc-700 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs text-neutral-400">{t("language")}</p>
              <div className="flex flex-row gap-2">
                <button
                  onClick={() => setLanguage("en")}
                  className={optionButton(language === "en")}
                >
                  English
                </button>
                <button
                  onClick={() => setLanguage("zh")}
                  className={optionButton(language === "zh")}
                >
                  中文
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
