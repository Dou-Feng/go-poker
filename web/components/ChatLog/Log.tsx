import React, { useContext } from "react";
import LogMessage from "./LogMessage";
import { AppContext } from "../../providers/AppStore";
import useChatScroll from "../../hooks/useChatScroll";

export default function Log() {
  const { appState, dispatch } = useContext(AppContext);
  const scrollRef = useChatScroll(appState.logs);

  return (
    <div
      ref={scrollRef}
      className="selectable h-full w-full overflow-auto bg-card p-2"
    >
      {appState.logs.map((log, index) => (
        <LogMessage
          key={index}
          message={log.message}
          timestamp={log.timestamp}
        />
      ))}
    </div>
  );
}
