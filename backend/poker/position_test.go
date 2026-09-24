package poker

import "testing"

func TestPositionLabelsFollowParticipatingSeats(t *testing.T) {
	cases := []struct {
		name   string
		seats  int
		order  []uint // clockwise, starting at the button
		labels []PositionLabel
	}{
		{"five", 5, []uint{0, 1, 2, 3, 4}, []PositionLabel{PosBTN, PosSB, PosBB, PosUTG, PosCO}},
		{"six", 6, []uint{0, 1, 2, 3, 4, 5}, []PositionLabel{PosBTN, PosSB, PosBB, PosUTG, PosMP, PosCO}},
		{"seven", 7, []uint{0, 1, 2, 3, 4, 5, 6}, []PositionLabel{PosBTN, PosSB, PosBB, PosUTG, PosMP, PosMP, PosCO}},
		{"eight", 8, []uint{0, 1, 2, 3, 4, 5, 6, 7}, []PositionLabel{PosBTN, PosSB, PosBB, PosUTG, PosMP, PosMP, PosMP, PosCO}},
		{"skip unready", 8, []uint{0, 2, 3, 5, 6}, []PositionLabel{PosBTN, PosSB, PosBB, PosUTG, PosCO}},
		{"button wraps with unready seats", 8, []uint{5, 7, 0, 2, 3}, []PositionLabel{PosBTN, PosSB, PosBB, PosUTG, PosCO}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			g := NewGame()
			Configure(g, 1, 2, 200, 400, 8, 0)
			for i := 0; i < tc.seats; i++ {
				pn := g.AddPlayer()
				if err := BuyIn(g, pn, 200); err != nil {
					t.Fatal(err)
				}
			}
			for _, pn := range tc.order {
				if err := ToggleReady(g, pn, 0); err != nil {
					t.Fatal(err)
				}
			}
			g.dealerNum = tc.order[0]
			if err := Deal(g, g.dealerNum, 0); err != nil {
				t.Fatal(err)
			}
			for i, pn := range tc.order {
				p := g.players[pn]
				if p.HandPosition != tc.labels[i] || p.Stats.HandsByPos[tc.labels[i]] != 1 {
					t.Fatalf("seat %d: position %d, stats %+v, want position %d", pn, p.HandPosition, p.Stats, tc.labels[i])
				}
			}
			for pn, p := range g.players {
				if !p.Ready && (g.positionLabel(uint(pn)) != PosLabelCount || p.Stats.HandsPlayed != 0) {
					t.Fatalf("unready seat %d received a statistical position", pn)
				}
			}
		})
	}
}
