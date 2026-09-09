package server

import (
	"github.com/evanofslack/go-poker/poker"
	"sort"
)

type clientAvatar struct {
	emoji string
	image bool
}

// Cache only public avatar metadata; room broadcasts never read Redis per viewer.
func (c *Client) cacheAvatar(user *UserRecord) {
	c.publicAvatar.Store(&clientAvatar{emoji: user.Avatar, image: user.AvatarImage})
}

// Public room presence only: no wallets, session IDs or hole cards.
type roomSpectator struct {
	AccountUUID string `json:"accountUuid"`
	Username    string `json:"username"`
	Avatar      string `json:"avatar"`
	AvatarImage bool   `json:"avatarImage"`
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
		person := roomSpectator{AccountUUID: c.accountUUID, Username: c.username}
		if avatar := c.publicAvatar.Load(); avatar != nil {
			person.Avatar, person.AvatarImage = avatar.emoji, avatar.image
		}
		result = append(result, person)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Username == result[j].Username {
			return result[i].AccountUUID < result[j].AccountUUID
		}
		return result[i].Username < result[j].Username
	})
	return result
}
