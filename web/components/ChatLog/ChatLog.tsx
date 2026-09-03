import React, { useState } from "react";
import { MdExpandLess } from "react-icons/md";
import { MdExpandMore } from "react-icons/md";
import classNames from "classnames";
import { useTranslation } from "../../hooks/useTranslation";
import Chat from "./Chat";
import Log from "./Log";

export default function ChatLog() {
  const [expand, setExpand] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const { t } = useTranslation();

  function chatHeight(expand: boolean) {
    return classNames(
      {
        "h-64 sm:h-96": expand,
        "h-32 sm:h-36": !expand,
      },
      "relative flex w-full sm:w-96 flex-col items-start justify-between rounded-tr-lg bg-zinc-700 p-3 text-neutral-400"
    );
  }

  function tabStyle(active: boolean) {
    return classNames(
      {
        "opacity-100": active,
        "opacity-50": !active,
      },
      " text-neutral-500 border border-zinc-700 border-2 px-4 py-1 bg-zinc-700"
    );
  }

  return (
    <div>
      <button className={tabStyle(showChat)} onClick={() => setShowChat(true)}>
        {t("chat")}
      </button>
      <button
        className={tabStyle(!showChat)}
        onClick={() => setShowChat(false)}
      >
        {t("log")}
      </button>
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
    </div>
  );
}
