package server

import (
	"encoding/json"
	"strings"
	"testing"
)

// Tests for the account-scoped preference blob (settings.go). The persistence
// round trip itself needs Redis (covered by the e2e path); these cover the
// validation rules and the privacy rule that only the owner receives them.

// Only a well-formed JSON object within the size bound is accepted: the blob
// is replayed to the client later, so anything else would surface as broken
// state after a reload.
func TestValidSettingsBlob(t *testing.T) {
	long := `{"lang":"` + strings.Repeat("x", maxSettingsBytes) + `"}`
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"object", `{"lang":"zh","sfxVolume":0.3}`, true},
		{"nested", `{"voice":{"micVolume":2,"mutedPeers":["acc-b"]}}`, true},
		{"empty object", `{}`, true},
		{"whitespace padded", "  \n {\"lang\":\"en\"}\t ", true},
		{"array", `[1,2,3]`, false},
		{"string", `"zh"`, false},
		{"number", `42`, false},
		{"null", `null`, false},
		{"empty", ``, false},
		{"malformed", `{"lang":`, false},
		{"oversized", long, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := validSettingsBlob(json.RawMessage(tc.raw)); got != tc.want {
				t.Fatalf("validSettingsBlob(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

// The owner gets their settings back in user-info; another player's profile
// must not carry them (a mute list reveals preferences about third parties).
func TestUserInfoSettingsOnlyForSelf(t *testing.T) {
	user := &UserRecord{
		UUID:     "acc-a",
		Username: "alice",
		Settings: json.RawMessage(`{"lang":"zh","sfxVolume":0.3}`),
	}

	// rdb is nil here on purpose: with no friends to resolve, createUserInfo
	// does not touch storage.
	own := decodeUserInfo(t, createUserInfo(nil, user, true))
	if len(own.Settings) == 0 {
		t.Fatalf("the owner must receive their settings")
	}
	if string(own.Settings) != `{"lang":"zh","sfxVolume":0.3}` {
		t.Fatalf("settings must pass through verbatim, got %s", own.Settings)
	}

	other := decodeUserInfo(t, createUserInfo(nil, user, false))
	if len(other.Settings) != 0 {
		t.Fatalf("another player's profile must not carry settings, got %s", other.Settings)
	}
}

// An account that never synced reports no settings rather than an empty
// object, so the client can tell "nothing stored yet" from "stored empty".
func TestUserInfoWithoutSettings(t *testing.T) {
	user := &UserRecord{UUID: "acc-a", Username: "alice"}
	info := decodeUserInfo(t, createUserInfo(nil, user, true))
	if len(info.Settings) != 0 {
		t.Fatalf("expected no settings, got %s", info.Settings)
	}
}

func decodeUserInfo(t *testing.T, raw []byte) userInfo {
	t.Helper()
	var info userInfo
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatalf("decode user-info: %v", err)
	}
	return info
}
