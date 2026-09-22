import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import {
  FiActivity,
  FiCheck,
  FiGlobe,
  FiMusic,
  FiSettings,
  FiUsers,
  FiX,
  FiZap,
} from "react-icons/fi";
import { GiSpades } from "react-icons/gi";
import { useTranslation } from "../hooks/useTranslation";
import {
  getSfxVolume,
  setSfxVolume,
  getBgmVolume,
  setBgmVolume,
  playSfx,
} from "../lib/sfx";
import { useVoice } from "../hooks/useVoice";
import { MAX_MIC_VOLUME, voice } from "../lib/voice";
import MicIcon from "./MicIcon";
import SpeakerIcon from "./SpeakerIcon";
import Portal from "./Portal";
import s from "../styles/Settings.module.css";

type SettingsProps = { buttonClassName?: string };

type VolumeControlProps = {
  label: string;
  icon: ReactNode;
  value: number;
  max?: number;
  hint?: string;
  secondary?: boolean;
  onChange: (value: number) => void;
  onToggleMute?: () => void;
  onPreview?: () => void;
};

function VolumeControl({
  label,
  icon,
  value,
  max = 100,
  hint,
  secondary,
  onChange,
  onToggleMute,
  onPreview,
}: VolumeControlProps) {
  const { t } = useTranslation();
  return (
    <div className={`${s.row} ${secondary ? s.secondaryRow : ""}`}>
      <span className={s.rowIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={s.label}>
        <span>{label}</span>
        {hint && <span className={s.hint}>{hint}</span>}
      </div>
      <div className={s.volumeControl}>
        {onToggleMute ? (
          <button
            type="button"
            className={s.volumeButton}
            onClick={onToggleMute}
            aria-label={`${
              value === 0 ? t("unmuteAudio") : t("muteAudio")
            }: ${label}`}
            aria-pressed={value === 0}
            title={value === 0 ? t("unmuteAudio") : t("muteAudio")}
          >
            <SpeakerIcon off />
          </button>
        ) : (
          <span className={s.volumeEnd} aria-hidden="true">
            {icon}
          </span>
        )}
        <div className={s.rangeWrap}>
          <output className={s.volumeValue} aria-hidden="true">
            {value}
            <span>%</span>
          </output>
          <input
            type="range"
            min={0}
            max={max}
            step={5}
            value={value}
            aria-label={label}
            aria-valuetext={`${value}%`}
            onChange={(e) => onChange(Number(e.target.value))}
            onPointerUp={onPreview}
            onKeyUp={onPreview}
            className={s.range}
            style={
              { "--range-fill": `${(value / max) * 100}%` } as CSSProperties
            }
          />
        </div>
        <span className={s.volumeEnd} aria-hidden="true">
          <SpeakerIcon />
        </span>
      </div>
    </div>
  );
}

type SettingSwitchProps = {
  label: string;
  hint: string;
  icon: ReactNode;
  checked: boolean;
  onChange: () => void;
};

function SettingSwitch({
  label,
  hint,
  icon,
  checked,
  onChange,
}: SettingSwitchProps) {
  const { t } = useTranslation();
  return (
    <div className={`${s.row} ${s.switchRow}`}>
      <span className={s.rowIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={s.label}>
        <span>{label}</span>
        <span className={s.hint}>{hint}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={s.switch}
        data-checked={checked}
        title={checked ? t("on") : t("off")}
      >
        <span className={s.switchMark} aria-hidden="true">
          {checked ? <FiCheck /> : <FiX />}
        </span>
        <span className={s.switchThumb} aria-hidden="true" />
      </button>
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { language, setLanguage, t } = useTranslation();
  const [volume, setVolume] = useState(() => Math.round(getSfxVolume() * 100));
  const [bgmVolume, setBgmVolumeState] = useState(() =>
    Math.round(getBgmVolume() * 100)
  );
  const v = useVoice();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  const applyVolume = (value: number) => {
    setVolume(value);
    setSfxVolume(value / 100);
  };
  const applyBgm = (value: number) => {
    setBgmVolumeState(value);
    setBgmVolume(value / 100);
  };

  return (
    <div
      className={s.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={s.dialog}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key !== "Tab") return;
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled])"
          );
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <span className={s.crest} aria-hidden="true">
          <GiSpades />
        </span>
        <div className={s.corners} aria-hidden="true">
          <GiSpades />
          <GiSpades />
          <GiSpades />
          <GiSpades />
        </div>
        <header className={s.header}>
          <h2 id="settings-title">
            <GiSpades aria-hidden="true" />
            {t("settings")}
          </h2>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            data-sfx="back"
            aria-label={t("close")}
            className={s.close}
          >
            <FiX />
          </button>
        </header>
        <div className={s.content}>
          <div className={s.settingsBody}>
            <div className={`${s.row} ${s.languageRow}`}>
              <span className={s.rowIcon} aria-hidden="true">
                <FiGlobe />
              </span>
              <span className={s.label}>{t("language")}</span>
              <div
                className={s.languages}
                role="group"
                aria-label={t("language")}
              >
                {(["en", "zh"] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    lang={lang}
                    onClick={() => setLanguage(lang)}
                    aria-pressed={language === lang}
                    className={s.language}
                  >
                    <FiCheck aria-hidden="true" />
                    <span>{lang === "en" ? "English" : "中文"}</span>
                  </button>
                ))}
              </div>
            </div>
            <VolumeControl
              label={t("sfx")}
              icon={<SpeakerIcon />}
              value={volume}
              onChange={applyVolume}
              onToggleMute={() => applyVolume(volume === 0 ? 50 : 0)}
              onPreview={() => playSfx("click")}
            />
            <VolumeControl
              label={t("bgm")}
              icon={<FiMusic />}
              value={bgmVolume}
              onChange={applyBgm}
              onToggleMute={() => applyBgm(bgmVolume === 0 ? 5 : 0)}
            />
            {v.supported && (
              <section
                className={s.voiceSection}
                aria-labelledby="settings-voice-title"
              >
                <h3 className={s.sectionTitle} id="settings-voice-title">
                  <span className={s.rowIcon} aria-hidden="true">
                    <MicIcon />
                  </span>
                  {t("voiceChat")}
                </h3>
                <VolumeControl
                  label={t("micVolume")}
                  icon={<MicIcon />}
                  value={Math.round(v.micVolume * 100)}
                  max={MAX_MIC_VOLUME * 100}
                  hint={t("micVolumeHint")}
                  secondary
                  onChange={(value) => voice.setMicVolume(value / 100)}
                />
                <VolumeControl
                  label={t("othersVolume")}
                  icon={<FiUsers />}
                  value={Math.round(v.outputVolume * 100)}
                  secondary
                  onChange={(value) => voice.setOutputVolume(value / 100)}
                />
                <SettingSwitch
                  label={t("echoCancellation")}
                  hint={t("micProcessingDescription")}
                  icon={<FiActivity />}
                  checked={v.echoCancellation}
                  onChange={() =>
                    void voice.setEchoCancellation(!v.echoCancellation)
                  }
                />
                <SettingSwitch
                  label={t("noiseCancellation")}
                  hint={t("noiseCancellationDescription")}
                  icon={<FiZap />}
                  checked={v.noiseCancellation}
                  onChange={() =>
                    void voice.setNoiseCancellation(!v.noiseCancellation)
                  }
                />
              </section>
            )}
          </div>
        </div>
        <footer className={s.footer} aria-hidden="true">
          <span>GOOD CARDS, BETTER FRIENDS</span>
        </footer>
      </div>
    </div>
  );
}

export default function Settings({ buttonClassName }: SettingsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("settings")}
        aria-label={t("settings")}
        aria-haspopup="dialog"
        className={buttonClassName ?? "btn btn-icon"}
      >
        <FiSettings size="1rem" />
      </button>
      {open && (
        <Portal>
          <SettingsDialog onClose={() => setOpen(false)} />
        </Portal>
      )}
    </>
  );
}
