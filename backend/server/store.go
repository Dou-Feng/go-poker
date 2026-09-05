package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	"github.com/evanofslack/go-poker/poker"
	"github.com/go-redis/redis/v8"
	"golang.org/x/crypto/bcrypt"
)

// initialChips is the starting balance for a newly registered user.
const initialChips = 200

// UserRecord is the persistent account state for a single user. UUID is the
// account's immutable unique id; Username is a display alias that may not be
// unique across users.
type UserRecord struct {
	UUID         string            `json:"uuid"`
	Username     string            `json:"username"`
	PasswordHash string            `json:"passwordHash"`
	Chips        uint              `json:"chips"`
	Avatar       string            `json:"avatar"`
	AvatarImage  bool              `json:"avatarImage"`
	Friends      []string          `json:"friends"` // account UUIDs
	Stats        poker.PlayerStats `json:"stats"`
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func verifyPassword(hash string, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// ErrUsernameNotUnique is returned when more than one account shares the
// supplied username, so the caller must log in with the account UUID instead.
var ErrUsernameNotUnique = errors.New("username not unique")

var uuidPattern = regexp.MustCompile(`^[a-zA-Z0-9]{5,}$`)

// validUUID reports whether id is a legal account id: at least five letters
// and/or digits.
func validUUID(id string) bool {
	return uuidPattern.MatchString(id)
}

func userKey(uuid string) string {
	return fmt.Sprintf("gopoker:user:%s", uuid)
}

// usernameIndexKey holds the set of account UUIDs registered under a
// username, so the server can tell whether a username is unique at login.
func usernameIndexKey(username string) string {
	return fmt.Sprintf("gopoker:username:%s", username)
}

func indexUsername(rdb *redis.Client, username, uuid string) error {
	return rdb.SAdd(ctx, usernameIndexKey(username), uuid).Err()
}

func unindexUsername(rdb *redis.Client, username, uuid string) error {
	return rdb.SRem(ctx, usernameIndexKey(username), uuid).Err()
}

// loadUser returns the stored record for uuid, or a fresh record seeded with
// initialChips if none exists yet. It does not write the fresh record.
func loadUser(rdb *redis.Client, uuid string) (*UserRecord, error) {
	raw, err := rdb.Get(ctx, userKey(uuid)).Result()
	if err == redis.Nil {
		return &UserRecord{UUID: uuid, Chips: initialChips}, nil
	}
	if err != nil {
		return nil, err
	}
	var u UserRecord
	if err := json.Unmarshal([]byte(raw), &u); err != nil {
		return nil, err
	}
	if u.UUID == "" {
		u.UUID = uuid
	}
	return &u, nil
}

// loadUserByUsername returns the account registered under username when that
// username is unique. It returns ErrUsernameNotUnique when several accounts
// share the name and redis.Nil when nobody has it.
func loadUserByUsername(rdb *redis.Client, username string) (*UserRecord, error) {
	uuids, err := rdb.SMembers(ctx, usernameIndexKey(username)).Result()
	if err != nil {
		return nil, err
	}
	if len(uuids) == 0 {
		return nil, redis.Nil
	}
	if len(uuids) > 1 {
		return nil, ErrUsernameNotUnique
	}
	return loadUser(rdb, uuids[0])
}

func saveUser(rdb *redis.Client, u *UserRecord) error {
	raw, err := json.Marshal(u)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, userKey(u.UUID), raw, 0).Err()
}

// HistoryRecord is one finished table session for a user. SessionID links it
// to the shared SessionRecord of that room session (every participant's
// result), so the history can open the whole scoreboard.
type HistoryRecord struct {
	Room        string            `json:"room"`
	Username    string            `json:"username"`
	UUID        string            `json:"uuid"`
	Time        string            `json:"time"`
	BuyIn       uint              `json:"buyIn"`
	Net         int               `json:"net"`
	Avatar      string            `json:"avatar"`
	AvatarImage bool              `json:"avatarImage"`
	Stats       poker.PlayerStats `json:"stats"`
	SessionID   string            `json:"sessionId,omitempty"`
}

// SessionPlayer is one account's result in a room session: buy-ins, net and
// the stats it accumulated there (merged across re-seats).
type SessionPlayer struct {
	UUID        string            `json:"uuid"`
	Username    string            `json:"username"`
	Avatar      string            `json:"avatar"`
	AvatarImage bool              `json:"avatarImage"`
	Bot         bool              `json:"bot,omitempty"`
	BuyIn       uint              `json:"buyIn"`
	Net         int               `json:"net"`
	Stats       poker.PlayerStats `json:"stats"`
}

// SessionRecord is the shared scoreboard of one room session. It is rewritten
// whenever a player's result becomes final (leave, bust, spectate) and once
// more at settlement, so it is complete no matter how the session ended.
type SessionRecord struct {
	ID      string          `json:"id"`
	Room    string          `json:"room"`
	Time    string          `json:"time"` // last update, RFC 3339
	Settled bool            `json:"settled"`
	Players []SessionPlayer `json:"players"`
}

// sessionTTL bounds how long a shared session scoreboard is kept.
const sessionTTL = 60 * 24 * time.Hour

func sessionKey(id string) string {
	return fmt.Sprintf("gopoker:session:%s", id)
}

func saveSessionRecord(rdb *redis.Client, rec SessionRecord) error {
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return rdb.Set(ctx, sessionKey(rec.ID), raw, sessionTTL).Err()
}

func loadSessionRecord(rdb *redis.Client, id string) (*SessionRecord, error) {
	raw, err := rdb.Get(ctx, sessionKey(id)).Result()
	if err != nil {
		return nil, err
	}
	var rec SessionRecord
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func historyKey(uuid string) string {
	return fmt.Sprintf("gopoker:history:%s", uuid)
}

// appendHistory stores a finished session, keeping only the most recent 50.
func appendHistory(rdb *redis.Client, uuid string, rec HistoryRecord) error {
	raw, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	pipe := rdb.TxPipeline()
	pipe.RPush(ctx, historyKey(uuid), raw)
	pipe.LTrim(ctx, historyKey(uuid), -50, -1)
	_, err = pipe.Exec(ctx)
	return err
}

// loadHistory returns a user's session history, newest first.
func loadHistory(rdb *redis.Client, uuid string) ([]HistoryRecord, error) {
	rawList, err := rdb.LRange(ctx, historyKey(uuid), 0, -1).Result()
	if err != nil {
		return nil, err
	}
	records := make([]HistoryRecord, 0, len(rawList))
	for _, raw := range rawList {
		var rec HistoryRecord
		if err := json.Unmarshal([]byte(raw), &rec); err != nil {
			continue
		}
		records = append(records, rec)
	}
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}
	return records, nil
}

// mergeStats accumulates a single session's stats into a lifetime record.
func mergeStats(dst *poker.PlayerStats, src poker.PlayerStats) {
	dst.HandsPlayed += src.HandsPlayed
	dst.HandsWon += src.HandsWon
	dst.Folds += src.Folds
	dst.Calls += src.Calls
	dst.Raises += src.Raises
	dst.ThreeBets += src.ThreeBets
	dst.VPIP += src.VPIP
	for i := range src.VPIPByPos {
		dst.VPIPByPos[i] += src.VPIPByPos[i]
	}
	if src.MaxPotWon > dst.MaxPotWon {
		dst.MaxPotWon = src.MaxPotWon
	}
}

// flushPlayerSession merges a single table session into a user's lifetime
// record, returns the remaining stack to the balance, appends a history entry,
// and persists the result.
func flushPlayerSession(rdb *redis.Client, accountUUID string, room string, sessionID string, totalBuyIn uint, stack uint, stats poker.PlayerStats) (uint, error) {
	user, err := loadUser(rdb, accountUUID)
	if err != nil {
		return 0, err
	}
	mergeStats(&user.Stats, stats)
	user.Chips += stack
	if err := saveUser(rdb, user); err != nil {
		return 0, err
	}

	// Don't record sessions where the player never played a hand (e.g. they
	// sat down and left before any deal). Each player's history therefore
	// only reflects the hands they actually participated in.
	if stats.HandsPlayed == 0 {
		return user.Chips, nil
	}

	rec := HistoryRecord{
		Room:        room,
		Username:    user.Username,
		UUID:        accountUUID,
		Time:        time.Now().Format(time.RFC3339),
		BuyIn:       totalBuyIn,
		Net:         int(stack) - int(totalBuyIn),
		Avatar:      user.Avatar,
		AvatarImage: user.AvatarImage,
		Stats:       stats,
		SessionID:   sessionID,
	}
	if err := appendHistory(rdb, accountUUID, rec); err != nil {
		slog.Default().Warn("Append history", "error", err)
	}
	return user.Chips, nil
}
