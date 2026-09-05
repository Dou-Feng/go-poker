import { useContext, useEffect } from "react";
import classNames from "classnames";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";
import { useVoice } from "../hooks/useVoice";
import { voice } from "../lib/voice";
import MicIcon from "./MicIcon";
import SpeakerIcon from "./SpeakerIcon";

type voiceControlsProps = {
  className?: string;
};

// Mic and speaker toggles for in-room voice chat. Both start off; the mic
// button asks for microphone permission on first use.
export default function VoiceControls({ className }: voiceControlsProps) {
  const { dispatch } = useContext(AppContext);
  const { t } = useTranslation();
  const v = useVoice();

  // Surface manager errors (permission denied, unsupported browser) through
  // the shared toast, then clear them so they do not re-fire.
  useEffect(() => {
    if (v.error) {
      dispatch({ type: "setAuthError", payload: t(v.error) });
      voice.clearError();
    }
  }, [v.error, dispatch, t]);

  if (!v.supported) {
    return null;
  }

  const button = (on: boolean) =>
    classNames(
      "btn btn-icon h-7 w-9 px-0",
      on && "border-emerald-500 bg-emerald-700/80 text-ink hover:text-ink"
    );

  return (
    <div className={classNames("flex flex-row items-center gap-1", className)}>
      <button
        onClick={() => void voice.setMic(!v.micOn)}
        title={v.micOn ? t("micOn") : t("micOff")}
        aria-pressed={v.micOn}
        className={button(v.micOn)}
      >
        <MicIcon off={!v.micOn} className="h-4 w-4" />
      </button>
      <button
        onClick={() => voice.setSpeaker(!v.speakerOn)}
        title={v.speakerOn ? t("speakerOn") : t("speakerOff")}
        aria-pressed={v.speakerOn}
        className={button(v.speakerOn)}
      >
        <SpeakerIcon off={!v.speakerOn} className="h-4 w-4" />
      </button>
    </div>
  );
}
