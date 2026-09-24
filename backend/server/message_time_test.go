package server

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMessageTimestampsIncludeTimezone(t *testing.T) {
	before := time.Now().UTC().Truncate(time.Second)
	messages := map[string][]byte{
		"chat":   createNewMessage("Alice", "hello"),
		"system": createNewMessage(gameAdminName, "Alice has joined"),
		"log":    createNewLog("starting new hand"),
	}
	for name, payload := range messages {
		t.Run(name, func(t *testing.T) {
			var message struct {
				Timestamp string `json:"timestamp"`
			}
			if err := json.Unmarshal(payload, &message); err != nil {
				t.Fatal(err)
			}
			got, err := time.Parse(time.RFC3339, message.Timestamp)
			if err != nil {
				t.Fatalf("timestamp must include date and timezone: %q: %v", message.Timestamp, err)
			}
			if got.Before(before) || got.After(time.Now()) {
				t.Fatalf("timestamp is not the message creation time: %v", got)
			}
		})
	}
}
