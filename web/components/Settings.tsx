import { useState } from "react";
import { FiSettings } from "react-icons/fi";
import { useTranslation } from "../hooks/useTranslation";
import { getSfxVolume, setSfxVolume, playSfx } from "../lib/sfx";
import { useVoice } from "../hooks/useVoice";
import { voice } from "../lib/voice";
import MicIcon from "./MicIcon";
import SpeakerIcon from "./SpeakerIcon";

const sliderClass =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-cardhi accent-cyan-700";

export default function Settings() {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(() => Math.round(getSfxVolume() * 100));
  const v = useVoice();
  const micPct = Math.round(v.micVolume * 100);
  const outPct = Math.round(v.outputVolume * 100);

  const optionButton = (active: boolean) =>
    `rounded-sm px-3 py-1 text-sm ${
      active ? "bg-cyan-900 text-ink" : "bg-floor text-ink hover:bg-cardhi"
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
        className="btn btn-icon"
      >
        <FiSettings size="1rem" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-lg bg-card p-5 shadow-2xl">
            <div className="mb-4 flex flex-row items-center justify-between">
              <p className="type-heading">{t("settings")}</p>
              <button onClick={() => setOpen(false)} className="btn btn-text">
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <p className="type-caption">{t("language")}</p>
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
                <p className="type-caption">{t("sfx")}</p>
                <p className="type-caption font-mono">{volume}%</p>
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
                  className={sliderClass}
                />
                <button
                  onClick={() => {
                    applyVolume(volume === 0 ? 50 : 0);
                  }}
                  title={t("sfx")}
                  className="btn btn-icon"
                >
                  {volume === 0 ? "🔇" : "🔊"}
                </button>
              </div>
            </div>

            {v.supported && (
              <div className="mt-4 flex flex-col gap-3">
                <p className="type-caption">{t("voiceChat")}</p>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-row items-center justify-between">
                    <p className="flex flex-row items-center gap-1.5 text-sm text-ink">
                      <MicIcon className="h-4 w-4" />
                      {t("micVolume")}
                    </p>
                    <p className="type-caption font-mono">{micPct}%</p>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={micPct}
                    onChange={(e) =>
                      voice.setMicVolume(Number(e.target.value) / 100)
                    }
                    className={sliderClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-row items-center justify-between">
                    <p className="flex flex-row items-center gap-1.5 text-sm text-ink">
                      <SpeakerIcon className="h-4 w-4" />
                      {t("othersVolume")}
                    </p>
                    <p className="type-caption font-mono">{outPct}%</p>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={outPct}
                    onChange={(e) =>
                      voice.setOutputVolume(Number(e.target.value) / 100)
                    }
                    className={sliderClass}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
