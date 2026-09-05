import Layout from "../components/Layout";
import Game from "../components/Game";
import Register from "../components/Register";
import Lobby from "../components/Lobby";
import Profile from "../components/Profile";
import Toast from "../components/Toast";
import { useContext, useEffect } from "react";
import { AppContext } from "../providers/AppStore";
import { useSocket } from "../hooks/useSocket";
import { joinTable, reconnectUser } from "../actions/actions";
import {
  loadSession,
  loadUser,
  loadUsername,
  tabAuthAccount,
} from "../lib/session";
import { detectLanguage } from "../lib/language";

export default function IndexPage() {
  const { appState, dispatch } = useContext(AppContext);
  const socket = useSocket();

  // Restore the saved language preference, or detect a default based on
  // the browser locale and IP geolocation for first-time visitors.
  useEffect(() => {
    const saved = window.localStorage.getItem("gopoker-lang");
    if (saved === "en" || saved === "zh") {
      dispatch({ type: "setLanguage", payload: saved });
      return;
    }
    detectLanguage().then((lang) => {
      dispatch({ type: "setLanguage", payload: lang });
      window.localStorage.setItem("gopoker-lang", lang);
    });
  }, [dispatch]);

  // Reconnect to a previous session if one exists in localStorage. This also
  // re-runs whenever the socket reconnects after a disconnect. Only the tab
  // that authenticated the account may replay it: a second tab of the same
  // browser has no tab marker and lands on the login screen, because
  // replaying would kick the first tab's connection (one session per
  // account).
  useEffect(() => {
    if (!socket) {
      return;
    }

    const user = loadUser();
    if (!user || tabAuthAccount() !== user) {
      return;
    }
    const send = (fn: () => void) => {
      if (socket.readyState === WebSocket.OPEN) {
        fn();
      } else {
        socket.addEventListener("open", fn, { once: true });
      }
    };
    send(() => reconnectUser(socket, user));

    const session = loadSession();
    if (session && session.table) {
      // The user was in a room: rejoin it (restore seat if possible). This
      // is flagged as a reconnect so a recycled room is not recreated; the
      // server replies with "session-expired" and we fall back to the lobby.
      dispatch({ type: "setUsername", payload: session.username });
      dispatch({ type: "setTablename", payload: session.table });
      send(() =>
        joinTable(
          socket,
          session.table,
          session.clientID ?? undefined,
          undefined,
          true
        )
      );
    } else {
      // Not in a room: drop into the lobby under the cached display name.
      // `user` is the account UUID, never a display name. If no name is
      // cached yet, stay on the register screen until the server's user-info
      // reply (or a session-expired) settles it.
      const username = loadUsername();
      if (username) {
        dispatch({ type: "setUsername", payload: username });
      }
    }
  }, [socket, dispatch]);

  return (
    <Layout title="Poker">
      {!appState.username ? (
        <Register />
      ) : !appState.table ? (
        <Lobby />
      ) : (
        <Game />
      )}
      <Profile />
      <Toast />
    </Layout>
  );
}
