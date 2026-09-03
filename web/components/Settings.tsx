import { useState } from "react";
import { FiSettings } from "react-icons/fi";
import { useTranslation } from "../hooks/useTranslation";
import { getSfxVolume, setSfxVolume, playSfx } from "../lib/sfx";

export default function Settings() {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(() => Math.round(getSfxVolume() * 100));

  const optionButton = (active: boolean) =>
    `rounded-sm px-3 py-1 text-sm ${
      active
        ? "bg-cyan-900 text-white"
        : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600"
    }`;

  const applyVolume = (v: number) => {
    setVolume(v);
    setSfxVolume(v / 100);
  };

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

            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-row items-center justify-between">
                <p className="text-xs text-neutral-400">{t("sfx")}</p>
                <p className="font-mono text-xs text-neutral-500">{volume}%</p>
              </div>
              <div className="flex flex-row items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={volume}
                  onChange={(e) => applyVolume(Number(e.target.value))}
                  onPointerUp={() => playSfx("click")}
                  onKeyUp={() => playSfx("click")}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-600 accent-cyan-700"
                />
                <button
                  onClick={() => {
                    applyVolume(volume === 0 ? 50 : 0);
                  }}
                  title={t("sfx")}
                  className="rounded-sm border border-neutral-600 px-2 py-0.5 text-xs text-neutral-400 hover:text-neutral-200"
                >
                  {volume === 0 ? "🔇" : "🔊"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
