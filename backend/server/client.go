package server

import (
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
	// maxMessageSize bounds one inbound frame. Game messages are a few hundred
	// bytes; a WebRTC SDP offer/answer relayed for voice chat is 2–8 KiB.
	maxMessageSize = 16 * 1024
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// kickRequest asks writePump to drop the peer. notice (optional, e.g. a
// session-expired payload) is written BEFORE the close frame so the browser
// acts on it before its 1s auto-reconnect replays a stale session. Carrying
// the notice here — instead of pushing to c.send — makes the ordering
// structural and avoids racing the hub's close(client.send).
type kickRequest struct {
	notice   []byte
	closeMsg []byte
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub         *Hub
	conn        *websocket.Conn // Websocket connection
	send        chan []byte     // Buffered channel of outbound bytes
	uuid        string          // per-session player UUID
	accountUUID string          // account UUID
	username    string          // display name
	table       *table          // Player's table

	// kicked is set when another connection took over this account: inbound
	// processing stops at once and teardown skips the offline timer (the seat
	// has already been transferred).
	kicked atomic.Bool

	// spectateReserved marks that the player wants to move to the spectator
	// side once the current hand ends.
	spectateReserved bool

	// ip is the peer address used for rate limiting; msgBucket throttles the
	// inbound message rate of this connection; releaseConn gives the
	// connection slot back to the guard when the socket closes.
	ip          string
	msgBucket   tokenBucket
	releaseConn func()
	// kick carries a close request that writePump must honor before shutting
	// down the socket (writePump is the only goroutine allowed to write).
	kick chan kickRequest

	// sendMu guards sendClosed. The hub closes `send` when a connection goes
	// away, but the table may still hold the client for a moment and try to
	// fan a message out to it; sending on a closed channel panics the whole
	// process, so every cross-client send goes through trySend and every
	// close through closeSend.
	sendMu     sync.Mutex
	sendClosed bool
}

// trySend queues a message for the peer without blocking. It reports false
// when the queue is full or the connection has already been closed.
func (c *Client) trySend(msg []byte) bool {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.sendClosed || c.send == nil {
		return false
	}
	select {
	case c.send <- msg:
		return true
	default:
		return false
	}
}

// closeSend closes the outbound queue exactly once; writePump then sends the
// close frame. Safe to call from any goroutine and more than once.
func (c *Client) closeSend() {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	if c.sendClosed || c.send == nil {
		return
	}
	c.sendClosed = true
	close(c.send)
}

func newClient(conn *websocket.Conn, hub *Hub) *Client {
	c := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 1024),
		kick: make(chan kickRequest, 1),
		uuid: uuid.New().String(),
	}
	if hub != nil && hub.guard != nil {
		c.msgBucket = hub.guard.newMessageBucket()
	}
	return c
}

func (c *Client) disconnect() {
	c.hub.unregister <- c
	c.detachTable()
	c.conn.Close()
	if c.releaseConn != nil {
		c.releaseConn()
	}
}

// detachTable removes the client from its table on teardown. A client kicked
// by a session takeover must not arm the offline timer: its seat has already
// been transferred to the new connection, and the timer would evict the new
// holder 60s later. The table unregister still runs so the table stops
// fanning broadcasts out to this (soon closed) send channel.
func (c *Client) detachTable() {
	if c.table == nil {
		return
	}
	c.table.unregister <- c
	if !c.kicked.Load() {
		c.table.markPlayerOffline(c.uuid)
	}
}

// allowMessage reports whether this connection may send another message.
func (c *Client) allowMessage() bool {
	if c.hub == nil || c.hub.guard == nil {
		return true
	}
	return c.msgBucket.allow(c.hub.guard.nowFunc())
}

// allowAuth reports whether this connection's IP may make another login or
// registration attempt (brute-force protection).
func (c *Client) allowAuth() bool {
	if c.hub == nil || c.hub.guard == nil {
		return true
	}
	return c.hub.guard.allowAuth(c.ip)
}

// readPump pumps events from the websocket connection to the hub.
//
// The application runs readPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) readPump() {
	defer func() {
		c.disconnect()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	if err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		slog.Default().Warn("set read deadline", "error", err)
	}
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	flooded := false
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Default().Warn("Websocket unexpected close", "error", err)
			}
			slog.Default().Warn("Read from websocket", "error", err)
			break
		}
		if flooded {
			// Draining until writePump has sent the close frame and shut
			// the socket; nothing more is processed from this peer.
			continue
		}
		if !c.allowMessage() {
			// A client flooding the socket is cut off rather than queued:
			// queuing would let it tie up the table goroutine. The close
			// frame goes through writePump (the sole writer); the short
			// read deadline bounds how long we keep draining.
			slog.Default().Warn("Websocket message rate exceeded, closing", "ip", c.ip)
			flooded = true
			select {
			case c.kick <- kickRequest{closeMsg: websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "message rate exceeded")}:
			default:
			}
			c.conn.SetReadDeadline(time.Now().Add(writeWait))
			continue
		}
		if err = c.processEvents(message); err != nil {
			slog.Default().Warn("Process websocket message", "error", err)
		}
	}
}

// writeMessage writes one text message honoring the write deadline. It
// reports whether the message was fully delivered.
func (c *Client) writeMessage(message []byte) bool {
	c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	w, err := c.conn.NextWriter(websocket.TextMessage)
	if err != nil {
		slog.Default().Warn("Write websocket message", "error", err)
		return false
	}
	if _, err := w.Write(message); err != nil {
		slog.Default().Warn("Write websocket message body", "error", err)
		return false
	}
	return w.Close() == nil
}

// writePump pumps messages from the hub to the websocket connection.
//
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				// The hub closed the channel.
				c.conn.SetWriteDeadline(time.Now().Add(writeWait))
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if !c.writeMessage(message) {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				slog.Default().Warn("Write websocket ping", "error", err)
				return
			}

		case req := <-c.kick:
			// The takeover notice must reach the peer before the close
			// frame: the browser auto-reconnects 1s after close and replays
			// its saved session; without the notice first it would kick the
			// new client right back.
			if req.notice != nil && !c.writeMessage(req.notice) {
				return
			}
			// Flush anything already queued before the close frame, then
			// drop the peer (message flood or session takeover) and let the
			// deferred Close end readPump.
			for {
				select {
				case message, ok := <-c.send:
					if !ok || !c.writeMessage(message) {
						c.conn.SetWriteDeadline(time.Now().Add(writeWait))
						c.conn.WriteMessage(websocket.CloseMessage, req.closeMsg)
						return
					}
				default:
					c.conn.SetWriteDeadline(time.Now().Add(writeWait))
					c.conn.WriteMessage(websocket.CloseMessage, req.closeMsg)
					return
				}
			}
		}
	}
}

// serveWs handles websocket requests from the peer.
func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	g := hub.guard
	ip := ""
	var release func()
	if g != nil {
		ip = g.clientIP(r)
		// Refuse the handshake outright when this IP (or the whole server)
		// already holds too many sockets, before any upgrade work is done.
		var ok bool
		release, ok = g.admitConn(ip)
		if !ok {
			w.Header().Set("Retry-After", "5")
			http.Error(w, "too many connections", http.StatusTooManyRequests)
			return
		}
	}

	up := upgrader // copy: CheckOrigin closes over the hub's guard
	up.CheckOrigin = func(r *http.Request) bool { return g == nil || g.allowOrigin(r) }
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		if release != nil {
			release()
		}
		return
	}
	client := newClient(conn, hub)
	client.ip = ip
	client.releaseConn = release

	client.hub.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}

func (c *Client) processEvents(rawMessage []byte) error {
	// A connection whose session was taken over is being closed; ignore
	// inbound messages still in flight (e.g. a leave-table that would evict
	// the seat now held by the new connection).
	if c.kicked.Load() {
		return nil
	}

	var baseMessage base
	err := json.Unmarshal(rawMessage, &baseMessage)
	if err != nil {
		return err
	}

	if baseMessage.Action == "" {
		return errors.New("deserialize message")
	}

	switch baseMessage.Action {

	case actionJoinTable:
		var table joinTable
		err := json.Unmarshal(rawMessage, &table)
		if err != nil {
			return err
		}
		handleJoinTable(c, table.Tablename, table.Password, table.PlayerUUID, table.Reconnect)
		return nil

	case actionLeaveTable:
		var table leaveTable
		err := json.Unmarshal(rawMessage, &table)
		if err != nil {
			return err
		}
		handleLeaveTable(c, table.Tablename)
		return nil

	case actionSendMessage:
		var message sendMessage
		err := json.Unmarshal(rawMessage, &message)
		if err != nil {
			return err
		}
		handleSendMessage(c, message.Username, message.Message)
		return nil

	case actionSendLog:
		var log sendLog
		err := json.Unmarshal(rawMessage, &log)
		if err != nil {
			return err
		}
		handleSendLog(c, log.Message)
		return nil

	case actionNewPlayer:
		var player newPlayer
		err := json.Unmarshal(rawMessage, &player)
		if err != nil {
			return err
		}
		handleNewPlayer(c, player.Username)
		return nil

	case actionRegisterUser:
		var user registerUser
		err := json.Unmarshal(rawMessage, &user)
		if err != nil {
			return err
		}
		if !c.allowAuth() {
			c.send <- createResult(actionRegisterResult, false, "too many attempts, try again later", "")
			return nil
		}
		handleRegisterUser(c, user.Username, user.UUID, user.Password, user.Avatar)
		return nil

	case actionLogin:
		var login login
		err := json.Unmarshal(rawMessage, &login)
		if err != nil {
			return err
		}
		if !c.allowAuth() {
			c.send <- createResult(actionLoginResult, false, "too many attempts, try again later", "")
			return nil
		}
		handleLogin(c, login.Identifier, login.Password)
		return nil

	case actionAddFriend:
		var friend addFriend
		err := json.Unmarshal(rawMessage, &friend)
		if err != nil {
			return err
		}
		handleAddFriend(c, friend.UUID)
		return nil

	case actionSetAvatar:
		var avatar setAvatar
		err := json.Unmarshal(rawMessage, &avatar)
		if err != nil {
			return err
		}
		handleSetAvatar(c, avatar.Avatar)
		return nil

	case actionReconnect:
		var reconnect reconnectUser
		err := json.Unmarshal(rawMessage, &reconnect)
		if err != nil {
			return err
		}
		handleReconnectUser(c, reconnect.UUID)
		return nil

	case actionListTables:
		handleListTables(c)
		return nil

	case actionCreateTable:
		var table createTable
		err := json.Unmarshal(rawMessage, &table)
		if err != nil {
			return err
		}
		handleCreateTable(c, table.Tablename, table.Password, table.SB, table.BB, table.BuyIn, table.MaxBuy, table.MaxPlayers, table.HandsLimit, table.Tournament)
		return nil

	case actionAddChips:
		var chips addChips
		err := json.Unmarshal(rawMessage, &chips)
		if err != nil {
			return err
		}
		handleAddChips(c, chips.Amount)
		return nil

	case actionRebuy:
		var rebuy rebuy
		err := json.Unmarshal(rawMessage, &rebuy)
		if err != nil {
			return err
		}
		handleRebuy(c, rebuy.Amount)
		return nil

	case actionUndoBuyIn:
		handleUndoRebuy(c)
		return nil

	case actionGetUser:
		var user getUser
		err := json.Unmarshal(rawMessage, &user)
		if err != nil {
			return err
		}
		handleGetUser(c, user.UUID)
		return nil

	case actionGetHistory:
		handleGetHistory(c)
		return nil

	case actionToggleReady:
		handleToggleReady(c)
		return nil

	case actionQueueNext:
		handleQueueNext(c)
		return nil

	case actionMoveSeat:
		var seat moveSeat
		err := json.Unmarshal(rawMessage, &seat)
		if err != nil {
			return err
		}
		handleMoveSeat(c, seat.SeatID)
		return nil

	case actionVoteSettle:
		handleVoteSettle(c)
		return nil

	case actionShowHand:
		handleShowHand(c)
		return nil

	case actionSpectate:
		handleSpectate(c)
		return nil

	case actionTakeSeat:
		var seat takeSeat
		err := json.Unmarshal(rawMessage, &seat)
		if err != nil {
			return err
		}
		handleTakeSeat(c, seat.Username, seat.SeatID, seat.BuyIn)
		return nil

	case actionStartGame:
		handleStartGame(c)
		return nil

	case actionResetGame:
		handleResetGame(c)
		return nil

	case actionDealGame:
		handleDealGame(c)
		return nil

	case actionPlayerCall:
		handleCall(c)
		return nil

	case actionPlayerCheck:
		handleCheck(c)
		return nil

	case actionPlayerRaise:
		var raise playerRaise
		err := json.Unmarshal(rawMessage, &raise)
		if err != nil {
			return err
		}
		handleRaise(c, raise.Amount)
		return nil

	case actionPlayerFold:
		handleFold(c)
		return nil

	case actionChangeUsername:
		var change changeUsername
		err := json.Unmarshal(rawMessage, &change)
		if err != nil {
			return err
		}
		handleChangeUsername(c, change.NewUsername)
		return nil

	case actionPing:
		c.send <- createPong()
		return nil

	case actionVoiceSignal:
		var sig voiceSignal
		err := json.Unmarshal(rawMessage, &sig)
		if err != nil {
			return err
		}
		return handleVoiceSignal(c, sig)

	case actionGetIceServers:
		var req getIceServers
		err := json.Unmarshal(rawMessage, &req)
		if err != nil {
			return err
		}
		handleGetIceServers(c, req.Host)
		return nil

	default:
		return errors.New("unexpected message action")
	}
}
