import React, { useContext, useEffect, useState } from "react";
import { MdExpandLess } from "react-icons/md";
import { MdExpandMore } from "react-icons/md";
import { FiList, FiMessageSquare, FiX } from "react-icons/fi";
import classNames from "classnames";
import { useTranslation } from "../../hooks/useTranslation";
import { AppContext } from "../../providers/AppStore";
import Chat from "./Chat";
import Log from "./Log";
import Portal from "../Portal";

type chatLogProps = {
  /**
   * Phone layout: two icon buttons stacked beside the table instead of the
   * bottom-left tab row (the bottom belongs to the action keys), and the
   * panel opens as an overlay above the action area.
   */
  compact?: boolean;
};

// Chat and hand-log panel. Both start collapsed: only the tab buttons (and
// the room name) are visible. Tapping a tab opens that panel; tapping the
// active tab again collapses it. Chat messages that arrive while the chat is
// hidden show as an unread count on the tab.
export default function ChatLog({ compact = false }: chatLogProps) {
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

  const unreadBadge = unread > 0 && (
    <span className="rounded-full bg-rose-600 px-1.5 text-xs font-semibold leading-4 text-ink">
      {unread > 99 ? "99+" : unread}
    </span>
  );

  if (compact) {
    return (
      <>
        <div className="flex flex-col items-center gap-1">
          <button
            className={classNames(
              "btn btn-icon relative h-9 w-9 justify-center px-0",
              chatVisible && "border-amber-500/60 bg-floor text-ink"
            )}
            onClick={() => toggle(true)}
            aria-expanded={chatVisible}
            title={t("chat")}
          >
            <FiMessageSquare size="1rem" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1">{unreadBadge}</span>
            )}
          </button>
          <button
            className={classNames(
              "btn btn-icon h-9 w-9 justify-center px-0",
              open && !showChat && "border-amber-500/60 bg-floor text-ink"
            )}
            onClick={() => toggle(false)}
            aria-expanded={open && !showChat}
            title={t("log")}
          >
            <FiList size="1rem" />
          </button>
        </div>
        {open && (
          <Portal>
            <div className="fixed inset-x-2 bottom-40 z-40 flex h-64 flex-col rounded-lg border border-muted/30 bg-floor p-3 text-muted shadow-2xl">
              <div className="mb-1 flex flex-row items-center justify-between">
                <span className="type-caption">
                  {showChat ? t("chat") : t("log")} · {appState.table}
                </span>
                <button
                  onClick={() => setOpen(false)}
                  data-sfx="back"
                  className="btn btn-text"
                  aria-label={t("close")}
                >
                  <FiX size="1rem" />
                </button>
              </div>
              {showChat ? <Chat /> : <Log />}
            </div>
          </Portal>
        )}
      </>
    );
  }

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
    <div className="pointer-events-auto w-fit">
      <div className="flex flex-row items-end">
        <button
          className={tabStyle(chatVisible)}
          onClick={() => toggle(true)}
          aria-expanded={chatVisible}
        >
          {t("chat")}
          {unreadBadge}
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
              aria-label={expand ? t("collapseChat") : t("expandChat")}
              aria-expanded={expand}
            >
              <MdExpandMore size="1.7rem" />
            </button>
          ) : (
            <button
              className="absolute top-0 right-0 pt-3 pr-7"
              onClick={() => setExpand(!expand)}
              aria-label={expand ? t("collapseChat") : t("expandChat")}
              aria-expanded={expand}
            >
              <MdExpandLess size="1.7rem" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
