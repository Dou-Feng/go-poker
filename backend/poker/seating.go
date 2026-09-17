package poker

// SeatConfig describes a fully initialized seat. Publishing the seat in one
// mutation prevents observers from seeing a player with seat ID zero.
type SeatConfig struct {
	AccountUUID string
	Username    string
	Avatar      string
	AvatarImage bool
	SeatID      uint
	BuyIn       uint
	Bot         bool
	Ready       bool
}

// SeatPlayer validates and adds a player atomically, returning its stable UUID.
// A rejected request leaves the game unchanged.
func (g *Game) SeatPlayer(cfg SeatConfig) (string, error) {
	g.mtx.Lock()
	defer g.mtx.Unlock()
	if g.getStage() != NotReady || cfg.BuyIn == 0 || cfg.AccountUUID == "" {
		return "", ErrIllegalAction
	}
	if cfg.SeatID == 0 || (g.config.MaxPlayers != 0 && cfg.SeatID > g.config.MaxPlayers) {
		return "", ErrInvalidPosition
	}
	if g.config.MaxPlayers != 0 && uint(len(g.players)) >= g.config.MaxPlayers {
		return "", ErrOutOfBounds
	}
	if g.config.MaxBuy != 0 && cfg.BuyIn > g.config.MaxBuy {
		return "", ErrIllegalAction
	}
	for _, p := range g.players {
		if p.SeatID == cfg.SeatID || p.AccountUUID == cfg.AccountUUID {
			return "", ErrInvalidPosition
		}
	}
	p := player{}
	p.initialize()
	p.AccountUUID, p.Username = cfg.AccountUUID, cfg.Username
	p.Avatar, p.AvatarImage = cfg.Avatar, cfg.AvatarImage
	p.Stack, p.TotalBuyIn = cfg.BuyIn, cfg.BuyIn
	p.Bot = cfg.Bot
	if cfg.Ready {
		p.setState(PlayerReady)
	}
	g.players = append(g.players, p)
	// Validation above guarantees this succeeds while the game lock is held.
	_ = setSeatID(g, uint(len(g.players)-1), cfg.SeatID)
	g.updateBlindNums()
	return p.UUID, nil
}
