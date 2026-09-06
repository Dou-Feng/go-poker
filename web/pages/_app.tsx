import React from "react";
import { AppProps } from "next/app";
import { SocketProvider } from "../providers/WebSocket";
import { AppStoreProvider } from "../providers/AppStore";

import "../styles/index.css";
import "../styles/base.css";
import "../styles/shared.css";
import "../styles/game.css";
import "../styles/actionbar.css";
import "../styles/raisepanel.css";
import "../styles/seat.css";
import "../styles/recharge.css";
import "../styles/utilities.css";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AppStoreProvider>
      <SocketProvider>
        <Component {...pageProps} />
      </SocketProvider>
    </AppStoreProvider>
  );
}

export default MyApp;
