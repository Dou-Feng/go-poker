import React, { useContext, useState, useEffect } from "react";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";

export default function GameInfo() {
  const { appState, dispatch } = useContext(AppContext);
  const { t } = useTranslation();

  return (
    <div className="invisible p-4 text-right text-zinc-600 sm:visible">
      {appState.game && (
        <p>
          {appState.game.config.sb}/{appState.game.config.bb}{" "}
          {t("nlTexasHoldem")}
        </p>
      )}
      <p>
        {t("table")}: {appState.table}
      </p>
    </div>
  );
}
