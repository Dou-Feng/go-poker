import { useState } from "react";
import { FiSettings, FiX } from "react-icons/fi";
import { useTranslation } from "../hooks/useTranslation";
import {
  getSfxVolume,
  setSfxVolume,
  getBgmVolume,
  setBgmVolume,
  playSfx,
} from "../lib/sfx";
import { useVoice } from "../hooks/useVoice";
import { voice } from "../lib/voice";
import MicIcon from "./MicIcon";
import SpeakerIcon from "./SpeakerIcon";
import Portal from "./Portal";
import ui from "../styles/Dialog.module.css";

const sliderClass =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-cardhi accent-cyan-700";

type SettingsProps = {
  buttonClassName?: string;
};

export default function Settings({ buttonClassName }: SettingsProps) {
  const { language, setLanguage, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(() => Math.round(getSfxVolume() * 100));
  const [bgmVolume, setBgmVolumeState] = useState(() =>
    Math.round(getBgmVolume() * 100)
  );
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

  const applyBgm = (v: number) => {
    setBgmVolumeState(v);
    setBgmVolume(v / 100);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(true)}
        title={t("settings")}
        aria-label={t("settings")}
        className={buttonClassName ?? "btn btn-icon"}
      >
        <FiSettings size="1rem" />
      </button>

      {open && (
        <Portal>
          <div className={ui.overlay}>
            <div className={ui.dialog}>
              <div className={ui.dialogHeader}>
                <h2>{t("settings")}</h2>
                <button
                  onClick={() => setOpen(false)}
                  data-sfx="back"
                  aria-label={t("close")}
                  className={ui.iconButton}
                >
                  <FiX />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <p className="type-caption">{t("language")}</p>
                <div className="flex flex-row gap-2">
                  <button
                    onClick={() => setLanguage("en")}
                    aria-pressed={language === "en"}
                    className={optionButton(language === "en")}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setLanguage("zh")}
                    aria-pressed={language === "zh"}
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
                    aria-label={t("sfx")}
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
                    aria-label={t("sfx")}
                    aria-pressed={volume === 0}
                    className="btn btn-icon"
                  >
                    <SpeakerIcon off={volume === 0} className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <div className="flex flex-row items-center justify-between">
                  <p className="type-caption">{t("bgm")}</p>
                  <p className="type-caption font-mono">{bgmVolume}%</p>
                </div>
                <div className="flex flex-row items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    aria-label={t("bgm")}
                    value={bgmVolume}
                    onChange={(e) => applyBgm(Number(e.target.value))}
                    className={sliderClass}
                  />
                  <button
                    onClick={() => applyBgm(bgmVolume === 0 ? 15 : 0)}
                    title={t("bgm")}
                    aria-label={t("bgm")}
                    aria-pressed={bgmVolume === 0}
                    className="btn btn-icon"
                  >
                    <SpeakerIcon off={bgmVolume === 0} className="h-4 w-4" />
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
                      aria-label={t("micVolume")}
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
                      aria-label={t("othersVolume")}
                      value={outPct}
                      onChange={(e) =>
                        voice.setOutputVolume(Number(e.target.value) / 100)
                      }
                      className={sliderClass}
                    />
                  </div>
                  <div className="flex flex-row items-center justify-between">
                    <p className="text-sm text-ink">{t("echoCancellation")}</p>
                    <button
                      onClick={() =>
                        void voice.setEchoCancellation(!v.echoCancellation)
                      }
                      role="switch"
                      aria-label={t("echoCancellation")}
                      aria-checked={v.echoCancellation}
                      title={t("echoCancellationHint")}
                      className={optionButton(v.echoCancellation)}
                    >
                      {v.echoCancellation ? t("on") : t("off")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
