package server

import (
	"github.com/evanofslack/go-poker/poker"
	"sort"
)

// Public room presence only: no wallets, session IDs or hole cards.
type roomSpectator struct {
	AccountUUID string `json:"accountUuid"`
	Username    string `json:"username"`
}

func (t *table) spectators(view *poker.GameView) []roomSpectator {
	seated, accounts := map[string]bool{}, map[string]bool{}
	for _, p := range view.Players {
		if p.UUID != "" {
			seated[p.UUID] = true
		}
		if p.AccountUUID != "" {
			accounts[p.AccountUUID] = true
		}
	}
	t.clientsMu.Lock()
	defer t.clientsMu.Unlock()
	result := make([]roomSpectator, 0)
	seen := map[string]bool{}
	for c := range t.clients {
		if c.isBot || c.kicked.Load() || seated[c.uuid] || accounts[c.accountUUID] {
			continue
		}
		if c.accountUUID != "" && seen[c.accountUUID] {
			continue
		}
		if c.accountUUID != "" {
			seen[c.accountUUID] = true
		}
		result = append(result, roomSpectator{AccountUUID: c.accountUUID, Username: c.username})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Username == result[j].Username {
			return result[i].AccountUUID < result[j].AccountUUID
		}
		return result[i].Username < result[j].Username
	})
	return result
}
