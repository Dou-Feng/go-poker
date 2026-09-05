export type Session = {
  username: string;
  table: string;
  clientID: string | null;
};

const KEY = "gopoker-session";
// The account UUID (login identity) and its display name are stored
// separately: the UUID is what the server needs to restore the login, the
// username is only a cache so the lobby can show the right name before the
// server's user-info reply arrives.
const USER_KEY = "gopoker-user";
const USERNAME_KEY = "gopoker-username";
// Tab marker (sessionStorage): which account THIS tab authenticated. Only the
// tab that logged in may replay the shared login on reconnect — a second tab
// of the same browser must land on the login screen instead of kicking the
// first tab's connection (one live session per account). sessionStorage
// survives a refresh, is isolated across tabs, and is cleared on tab close.
const TAB_KEY = "gopoker-tab";

export function loadUser(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(USER_KEY);
}

export function saveUser(accountUUID: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(USER_KEY, accountUUID);
}

export function loadUsername(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(USERNAME_KEY);
}

export function saveUsername(username: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(USERNAME_KEY, username);
}

export function clearUser() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(USERNAME_KEY);
}

// markTabAuth records that this tab authenticated as the given account.
export function markTabAuth(accountUUID: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(TAB_KEY, accountUUID);
}

// tabAuthAccount returns the account this tab authenticated, or null.
export function tabAuthAccount(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(TAB_KEY);
}

export function clearTabAuth() {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.removeItem(TAB_KEY);
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.username === "string" &&
      typeof parsed.table === "string"
    ) {
      return parsed as Session;
    }
  } catch {
    // ignore malformed session
  }
  return null;
}

export function saveSession(session: Session) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(KEY);
}
