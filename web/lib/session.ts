export type Session = {
    username: string;
    table: string;
    clientID: string | null;
};

const KEY = "gopoker-session";
const USER_KEY = "gopoker-user";

export function loadUser(): string | null {
    if (typeof window === "undefined") {
        return null;
    }
    return window.localStorage.getItem(USER_KEY);
}

export function saveUser(username: string) {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.setItem(USER_KEY, username);
}

export function clearUser() {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.removeItem(USER_KEY);
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
        if (parsed && typeof parsed.username === "string" && typeof parsed.table === "string") {
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
