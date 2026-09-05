import React, { useContext, useEffect, useState } from "react";
import { MdExpandLess } from "react-icons/md";
import { MdExpandMore } from "react-icons/md";
import classNames from "classnames";
import { useTranslation } from "../../hooks/useTranslation";
import { AppContext } from "../../providers/AppStore";
import Chat from "./Chat";
import Log from "./Log";

// Chat and hand-log panel in the room's bottom-left corner. Both start
// collapsed: only the two tab buttons (and the room name) are visible. Tapping
// a tab opens that panel; tapping the active tab again collapses it. Chat
// messages that arrive while the chat is hidden show as an unread count on
// the tab.
export default function ChatLog() {
  const { appState } = useContext(AppContext);
  const [open, setOpen] = useState(false);
  const [expand, setExpand] = useState(false);
  const [showChat, setShowChat] = useState(true);
  // Messages already on screen when the panel was last visible (or when the
  // room was entered) do not count as unread.
  const [seenMessages, setSeenMessages] = useState(
    () => appState.messages.length
  );
  const { t } = useTranslation();

  const chatVisible = open && showChat;
  useEffect(() => {
    if (chatVisible) {
      setSeenMessages(appState.messages.length);
    }
  }, [chatVisible, appState.messages.length]);
  const unread = chatVisible
    ? 0
    : Math.max(0, appState.messages.length - seenMessages);

  const toggle = (chat: boolean) => {
    if (open && showChat === chat) {
      setOpen(false);
      return;
    }
    setShowChat(chat);
    setOpen(true);
  };

  function chatHeight(expand: boolean) {
    return classNames(
      {
        "h-64 sm:h-96": expand,
        "h-32 sm:h-36": !expand,
      },
      "relative flex w-full sm:w-96 flex-col items-start justify-between rounded-tr-lg bg-floor p-3 text-muted"
    );
  }

  function tabStyle(active: boolean) {
    return classNames(
      {
        "opacity-100": active,
        "opacity-50": !active,
      },
      "inline-flex items-center gap-1 text-muted border border-muted/30 border-2 px-4 py-1 bg-floor"
    );
  }

  return (
    <div>
      <div className="flex flex-row items-end">
        <button
          className={tabStyle(chatVisible)}
          onClick={() => toggle(true)}
          aria-expanded={chatVisible}
        >
          {t("chat")}
          {unread > 0 && (
            <span className="rounded-full bg-rose-600 px-1.5 text-xs font-semibold leading-4 text-ink">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        <button
          className={tabStyle(open && !showChat)}
          onClick={() => toggle(false)}
          aria-expanded={open && !showChat}
        >
          {t("log")}
        </button>
        {appState.table && (
          <span className="ml-3 truncate pb-1 text-sm font-medium text-muted">
            {appState.table}
          </span>
        )}
      </div>
      {open && (
        <div className={chatHeight(expand)}>
          {showChat && <Chat />}
          {!showChat && <Log />}
          {expand ? (
            <button
              className="absolute top-0 right-0 pt-3 pr-7"
              onClick={() => setExpand(!expand)}
            >
              <MdExpandMore size="1.7rem" />
            </button>
          ) : (
            <button
              className="absolute top-0 right-0 pt-3 pr-7"
              onClick={() => setExpand(!expand)}
            >
              <MdExpandLess size="1.7rem" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
