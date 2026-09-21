package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
)

// Player preferences (audio volumes, voice toggles, language, muted peers, ...)
// are collected by the browser and kept on the account, so a player finds the
// same setup after signing in from another device or after clearing site data.
//
// The server deliberately treats the blob as opaque: it validates that it is a
// JSON object within a size bound, stores it verbatim, and hands it back in
// user-info. That keeps the layout owned by the web client — adding a setting
// needs no server change and no mirrored struct to keep in sync (see the
// note in AGENTS.md about the 1:1 type mirroring that costs time to maintain).
//
// The client stays authoritative for the live session: it applies the local
// copy immediately and pushes changes here in the background, so a failed
// save never blocks the UI.

// maxSettingsBytes bounds one blob. The real payload is well under 1 KiB
// (a handful of numbers, booleans and a mute list), so this leaves room for
// future settings while keeping a hostile client from filling the store.
const maxSettingsBytes = 4 << 10

// validSettingsBlob reports whether raw is an acceptable preference payload:
// a JSON object (not null, array or scalar) within the size bound. An empty
// blob is rejected too — clearing settings is not a thing the client does, and
// accepting it would let a bug wipe an account's preferences.
func validSettingsBlob(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || len(trimmed) > maxSettingsBytes {
		return false
	}
	if trimmed[0] != '{' {
		return false
	}
	// A well-formed object beyond the first character still has to parse: the
	// stored bytes are replayed to the client later, so garbage would surface
	// only after a reload.
	return json.Valid(trimmed)
}

// handleSetSettings stores a player's preference blob. The reply is a
// settings-result the client can log; failures use the shared error channel.
func handleSetSettings(c *Client, settings json.RawMessage) {
	if c.accountUUID == "" {
		c.send <- createError("not logged in")
		return
	}
	if !validSettingsBlob(settings) {
		c.send <- createError("invalid settings")
		return
	}
	user, err := loadUser(c.hub.rdb, c.accountUUID)
	if err != nil {
		c.send <- createError("could not save settings")
		return
	}
	user.Settings = bytes.TrimSpace(settings)
	if err := saveUser(c.hub.rdb, user); err != nil {
		slog.Default().Warn("Save user settings", "error", err)
		c.send <- createError("could not save settings")
		return
	}
	c.send <- createSettingsResult(true, "")
}

func createSettingsResult(ok bool, message string) []byte {
	resp := settingsResult{
		base:    base{actionSettingsResult},
		OK:      ok,
		Message: message,
	}
	bytes, err := json.Marshal(resp)
	if err != nil {
		slog.Default().Warn("Marshal settings result", "error", err)
	}
	return bytes
}
