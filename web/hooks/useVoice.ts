import { useEffect, useState } from "react";
import { voice, VoiceState } from "../lib/voice";

// Subscribes a component to the voice-chat manager's state.
export function useVoice(): VoiceState {
  const [state, setState] = useState<VoiceState>(() => voice.getState());
  useEffect(() => {
    setState(voice.getState());
    return voice.subscribe(() => setState(voice.getState()));
  }, []);
  return state;
}
