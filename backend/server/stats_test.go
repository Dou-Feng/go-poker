package server

import (
	"testing"

	"github.com/evanofslack/go-poker/poker"
)

func TestMergeStatsRestartsMixedEraPositionCounts(t *testing.T) {
	old := poker.PlayerStats{HandsPlayed: 30, VPIP: 20, HandsWon: 5, Calls: 40, MaxPotWon: 800}
	old.VPIPByPos[poker.PosUTG] = 11
	old.HandsByPos[poker.PosUTG] = 1 // old display was 1100%
	fresh := poker.PlayerStats{HandsPlayed: 2, VPIP: 1, PositionStatsVersion: poker.PositionStatsVersion}
	fresh.HandsByPos[poker.PosUTG] = 2
	fresh.VPIPByPos[poker.PosUTG] = 1
	mergeStats(&old, fresh)
	if old.PositionStatsVersion != poker.PositionStatsVersion || old.HandsByPos[poker.PosUTG] != 2 || old.VPIPByPos[poker.PosUTG] != 1 {
		t.Fatalf("legacy counters contaminated new sample: %+v", old)
	}
	mergeStats(&old, fresh)
	if old.HandsByPos[poker.PosUTG] != 4 || old.VPIPByPos[poker.PosUTG] != 2 {
		t.Fatalf("subsequent session discarded the valid sample: %+v", old)
	}
	if old.HandsPlayed != 34 || old.VPIP != 22 || old.HandsWon != 5 || old.Calls != 40 || old.MaxPotWon != 800 {
		t.Fatalf("migration changed unrelated lifetime statistics: %+v", old)
	}
}

func TestMergeStatsExcludesLegacyRecordsWithUnknownTableSizes(t *testing.T) {
	for _, version := range []uint{0, 1} {
		old := poker.PlayerStats{HandsPlayed: 4, VPIP: 2, PositionStatsVersion: version}
		old.HandsByPos[poker.PosUTG], old.VPIPByPos[poker.PosUTG] = 4, 2
		fresh := poker.PlayerStats{HandsPlayed: 1, VPIP: 1, PositionStatsVersion: poker.PositionStatsVersion}
		fresh.HandsByPos[poker.PosUTG], fresh.VPIPByPos[poker.PosUTG] = 1, 1
		mergeStats(&old, fresh)
		if old.HandsByPos[poker.PosUTG] != 1 || old.VPIPByPos[poker.PosUTG] != 1 || old.HandsPlayed != 5 || old.VPIP != 3 {
			t.Fatalf("legacy table sizes entered the five-player sample: %+v", old)
		}
	}
}

func TestMergeShortHandedSessionPreservesPositionSample(t *testing.T) {
	stats := poker.PlayerStats{HandsPlayed: 4, VPIP: 2, PositionStatsVersion: poker.PositionStatsVersion}
	stats.HandsByPos[poker.PosUTG], stats.VPIPByPos[poker.PosUTG] = 4, 2
	short := poker.PlayerStats{HandsPlayed: 10, VPIP: 8, PositionStatsVersion: poker.PositionStatsVersion}
	mergeStats(&stats, short)
	if stats.HandsPlayed != 14 || stats.VPIP != 10 || stats.HandsByPos[poker.PosUTG] != 4 || stats.VPIPByPos[poker.PosUTG] != 2 {
		t.Fatalf("short-handed session changed positional rates: %+v", stats)
	}
}

func TestMergeStatsRejectsIncompleteButPlausibleLegacyPositions(t *testing.T) {
	good := poker.PlayerStats{HandsPlayed: 2, VPIP: 1, PositionStatsVersion: poker.PositionStatsVersion}
	good.HandsByPos[poker.PosUTG], good.VPIPByPos[poker.PosUTG] = 2, 1
	// The percentage happens to be <=100%, but the numerator covers more history.
	old := poker.PlayerStats{HandsPlayed: 50, VPIP: 10}
	old.HandsByPos[poker.PosUTG], old.VPIPByPos[poker.PosUTG] = 2, 1
	mergeStats(&good, old)
	if good.HandsByPos[poker.PosUTG] != 2 || good.VPIPByPos[poker.PosUTG] != 1 {
		t.Fatalf("incomplete legacy session entered the valid sample: %+v", good)
	}
}

func TestMergeThreeBetStatsExcludesLegacyAndKeepsNewOpportunities(t *testing.T) {
	old := poker.PlayerStats{HandsPlayed: 10, ThreeBets: 30, VPIP: 5}
	fresh := poker.PlayerStats{HandsPlayed: 3, ThreeBets: 1, ThreeBetOpportunities: 2, ThreeBetStatsVersion: poker.ThreeBetStatsVersion}
	mergeStats(&old, fresh)
	mergeStats(&old, fresh)
	if old.ThreeBets != 2 || old.ThreeBetOpportunities != 4 || old.HandsPlayed != 16 || old.VPIP != 5 {
		t.Fatalf("legacy contaminated new three-bet sample: %+v", old)
	}
	mergeStats(&old, poker.PlayerStats{HandsPlayed: 2, ThreeBets: 6})
	if old.ThreeBets != 2 || old.ThreeBetOpportunities != 4 || old.HandsPlayed != 18 {
		t.Fatalf("legacy source contaminated sample: %+v", old)
	}
}
