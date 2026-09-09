import React, { useCallback, useContext, useRef, useState } from "react";
import { FiSend, FiSmile } from "react-icons/fi";
import { useSocket } from "../../hooks/useSocket";
import { AppContext } from "../../providers/AppStore";
import { useTranslation } from "../../hooks/useTranslation";
import { sendMessage } from "../../actions/actions";

// Standalone chat input (emoji picker + message field + send). Extracted from
// Chat so the dock can drop a real composer into the trigger row when the
// panel is open — the collapsed "say something…" row becomes the live input.
export default function ChatComposer() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t, language } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const messageRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const message = inputValue.trim();
      if (socket && appState.username && message) {
        sendMessage(socket, appState.username, message);
        setInputValue("");
        setShowQuickReplies(false);
      }
    },
    [appState.username, inputValue, socket]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  const quickReplies =
    language === "zh"
      ? ["好牌！", "漂亮", "跟了！", "别诈我 😂", "再来一把"]
      : ["Nice hand!", "Nice!", "I call!", "Don't bluff me 😂", "One more!"];

  const insertQuickReply = (value: string) => {
    setInputValue((current) => `${current}${current ? " " : ""}${value}`);
    setShowQuickReplies(false);
    requestAnimationFrame(() => messageRef.current?.focus());
  };

  return (
    <form className="game-chat-composer" onSubmit={handleSubmit}>
      {showQuickReplies && (
        <div className="game-chat-quick" role="dialog">
          <div className="game-chat-quick-emojis">
            {["😎", "😂", "😭", "🤔", "🔥", "👏"].map((emoji) => (
              <button type="button" key={emoji} onClick={() => insertQuickReply(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
          <div className="game-chat-quick-phrases">
            {quickReplies.map((reply) => (
              <button
                type="button"
                key={reply}
                onClick={() => insertQuickReply(reply)}
              >
                {reply}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className="game-chat-emoji"
        aria-label={t("quickReplies")}
        aria-expanded={showQuickReplies}
        onClick={() => setShowQuickReplies((visible) => !visible)}
      >
        <FiSmile />
      </button>
      <input
        name="gopoker-chat-text"
        type="text"
        value={inputValue}
        placeholder={t("saySomething")}
        aria-label={t("saySomething")}
        onChange={handleChange}
        ref={messageRef}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button
        type="submit"
        aria-label={t("sendChatMessage")}
        className="game-chat-send"
        disabled={!socket || !appState.username || !inputValue.trim()}
      >
        <FiSend />
      </button>
    </form>
  );
}
