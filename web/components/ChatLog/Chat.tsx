import React, { useCallback, useContext, useState, useRef } from "react";
import { useSocket } from "../../hooks/useSocket";
import ChatMessage from "./ChatMessage";
import { AppContext } from "../../providers/AppStore";
import useChatScroll from "../../hooks/useChatScroll";
import { FiSend, FiSmile } from "react-icons/fi";
import { sendMessage } from "../../actions/actions";
import { useTranslation } from "../../hooks/useTranslation";

export default function Chat() {
  const socket = useSocket();
  const { appState } = useContext(AppContext);
  const { t, language } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const scrollRef = useChatScroll(appState.messages);
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
    <div className="game-chat">
      <div ref={scrollRef} className="game-chat-feed selectable">
        {appState.messages.map((message, index) => {
          const own = message.name === appState.username;
          const player = appState.game?.players
            .concat(appState.game?.departedPlayers ?? [])
            .find((candidate) => candidate.username === message.name);
          const spectator = appState.game?.spectators?.find(
            (candidate) => candidate.username === message.name
          );
          return (
            <ChatMessage
              key={`${message.timestamp}-${index}`}
              {...message}
              own={own}
              uuid={
                own
                  ? appState.uuid ?? undefined
                  : player?.accountUuid || spectator?.accountUuid
              }
              avatar={
                own
                  ? appState.avatar ?? "🙂"
                  : player?.avatar || spectator?.avatar || "🙂"
              }
              avatarImage={
                own
                  ? appState.avatarImage
                  : player?.avatarImage || spectator?.avatarImage || false
              }
              avatarVersion={own ? appState.avatarVersion : undefined}
            />
          );
        })}
      </div>
      <form className="game-chat-composer" onSubmit={handleSubmit}>
        {showQuickReplies && (
          <div className="game-chat-quick" role="dialog">
            <div className="game-chat-quick-emojis">
              {["😎", "😂", "😭", "🤔", "🔥", "👏"].map((emoji) => (
                <button
                  type="button"
                  key={emoji}
                  onClick={() => insertQuickReply(emoji)}
                >
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
    </div>
  );
}
