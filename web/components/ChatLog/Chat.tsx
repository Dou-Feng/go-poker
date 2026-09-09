import React, { useContext } from "react";
import ChatMessage from "./ChatMessage";
import ChatComposer from "./ChatComposer";
import { AppContext } from "../../providers/AppStore";
import useChatScroll from "../../hooks/useChatScroll";

type chatProps = {
  /** Render only the message feed (no composer) — used when the room dock
      drops the live composer into the bottom trigger row instead. */
  noComposer?: boolean;
};

export default function Chat({ noComposer = false }: chatProps) {
  const { appState } = useContext(AppContext);
  const scrollRef = useChatScroll(appState.messages);

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
      {!noComposer && <ChatComposer />}
    </div>
  );
}
