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

  // Square sibling of the wallet/stack buttons (see .room-icon-btn) so the
  // mic, speaker and settings keys read as one family. The emerald `is-on`
  // state marks a live mic/speaker; the slash stays for the muted state.
  const button = (on: boolean, dimmed = false) =>
    classNames("room-icon-btn", on && "is-on", dimmed && "is-dim");

  // Over plain http on a LAN address the browser hides the microphone API:
  // the button stays visible (so the player learns why) but dimmed, and
  // tapping it shows the explanation toast via the manager's error.
  const micTitle = !v.micAvailable
    ? t("micNeedsHttps")
    : v.micOn
    ? t("micOn")
    : t("micOff");

  return (
    <div className={classNames("flex flex-row items-center gap-1", className)}>
      <button
        onClick={() => void voice.setMic(!v.micOn)}
        title={micTitle}
        aria-label={micTitle}
        aria-pressed={v.micOn}
        className={button(v.micOn, !v.micAvailable)}
      >
        <MicIcon off={!v.micOn} className="h-4 w-4" />
      </button>
      <button
        onClick={() => voice.setSpeaker(!v.speakerOn)}
        title={v.speakerOn ? t("speakerOn") : t("speakerOff")}
        aria-label={v.speakerOn ? t("speakerOn") : t("speakerOff")}
        aria-pressed={v.speakerOn}
        className={button(v.speakerOn)}
      >
        <SpeakerIcon off={!v.speakerOn} className="h-4 w-4" />
      </button>
    </div>
  );
}
