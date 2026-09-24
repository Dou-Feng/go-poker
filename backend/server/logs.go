package server

import (
	"encoding/json"
	"log/slog"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// Keyed log events. The wire carries a stable key plus substitution
// parameters so each client renders the line in its own language
// (web/lib/translations.ts holds the display strings; {0}, {1}, … are
// replaced by the params in order). message keeps an English rendering for
// clients that ignore keys.
const (
	logKeyStartHand      = "logStartHand"
	logKeySmallBlind     = "logSmallBlind"
	logKeyBigBlind       = "logBigBlind"
	logKeyFolds          = "logFolds"
	logKeyChecks         = "logChecks"
	logKeyCalls          = "logCalls"
	logKeyCallsAmount    = "logCallsAmount"
	logKeyBets           = "logBets"
	logKeyRaisesTo       = "logRaisesTo"
	logKeyAllIn          = "logAllIn"
	logKeyWins           = "logWins"
	logKeyChipsForfeited = "logChipsForfeited"
	logKeyBuysIn         = "logBuysIn"
	logKeySitsDown       = "logSitsDown"
	logKeyTimedOutLeft   = "logTimedOutLeft"
	logKeyTimeoutFold    = "logTimeoutFold"
	logKeyTimeoutCheck   = "logTimeoutCheck"
	logKeyOutOfChips     = "logOutOfChips"
	logKeyVotedSettle    = "logVotedSettle"
	logKeyCancelledVote  = "logCancelledVote"
	logKeySettleApproved = "logSettleApproved"
)

// logTemplates renders the English fallback for each key. Every placeholder
// is {n} so the same substitution works in Go and in the browser.
var logTemplates = map[string]string{
	logKeyStartHand:      "starting new hand",
	logKeySmallBlind:     "{0} is small blind ({1})",
	logKeyBigBlind:       "{0} is big blind ({1})",
	logKeyFolds:          "{0} folds",
	logKeyChecks:         "{0} checks",
	logKeyCalls:          "{0} calls",
	logKeyCallsAmount:    "{0} calls {1}",
	logKeyBets:           "{0} bets {1}",
	logKeyRaisesTo:       "{0} raises to {1}",
	logKeyAllIn:          "{0} is all in",
	logKeyWins:           "{0} wins {1}",
	logKeyChipsForfeited: "chips forfeited",
	logKeyBuysIn:         "{0} buys in for {1}",
	logKeySitsDown:       "{0} sits down at seat {1} for {2}",
	logKeyTimedOutLeft:   "{0} timed out and left the table",
	logKeyTimeoutFold:    "{0} ran out of time and folds",
	logKeyTimeoutCheck:   "{0} ran out of time and checks",
	logKeyOutOfChips:     "{0} is out of chips and moves to the spectators",
	logKeyVotedSettle:    "{0} voted to settle ({1}/{2})",
	logKeyCancelledVote:  "{0} cancelled their settle vote ({1}/{2})",
	logKeySettleApproved: "early settlement approved — will settle after this hand",
}

// renderLogTemplate substitutes {0}, {1}, … in order. Missing params leave
// their placeholder visible, which makes broken calls easy to spot.
func renderLogTemplate(tpl string, params []string) string {
	for i, p := range params {
		tpl = strings.ReplaceAll(tpl, "{"+strconv.Itoa(i)+"}", p)
	}
	return tpl
}

// createNewLogKey builds a new-log message from a key and its parameters.
// The English template fills message so clients that do not localize keys
// still show a sensible line.
func createNewLogKey(key string, params ...string) []byte {
	msg := key
	if tpl, ok := logTemplates[key]; ok {
		msg = renderLogTemplate(tpl, params)
	}
	log := newLog{
		base:      base{actionNewLog},
		Id:        uuid.New().String(),
		Message:   msg,
		Key:       key,
		Params:    params,
		Timestamp: currentTime(),
	}
	resp, err := json.Marshal(log)
	if err != nil {
		slog.Default().Warn("Marshal new log", "error", err)
	}
	return resp
}
