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
