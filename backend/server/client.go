package server

import (
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 1024
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
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

	// spectateReserved marks that the player wants to move to the spectator
	// side once the current hand ends.
	spectateReserved bool
}

func newClient(conn *websocket.Conn, hub *Hub) *Client {
	return &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 1024),
		uuid: uuid.New().String(),
	}
}

func (c *Client) disconnect() {
	c.hub.unregister <- c
	if c.table != nil {
		c.table.unregister <- c
		c.table.markPlayerOffline(c.uuid)
	}
	c.conn.Close()
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
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Default().Warn("Websocket unexpected close", "error", err)
			}
			slog.Default().Warn("Read from websocket", "error", err)
			break
		}
		if err = c.processEvents(message); err != nil {
			slog.Default().Warn("Process websocket message", "error", err)
		}
	}
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
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				slog.Default().Warn("Write websocket message", "error", err)
				return
			}
			if _, err := w.Write(message); err != nil {
				slog.Default().Warn("Write websocket message body", "error", err)
				return
			}
			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				slog.Default().Warn("Write websocket ping", "error", err)
				return
			}
		}
	}
}

// serveWs handles websocket requests from the peer.
func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	client := newClient(conn, hub)

	client.hub.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}

func (c *Client) processEvents(rawMessage []byte) error {
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
		handleJoinTable(c, table.Tablename, table.Password, table.PlayerUUID)
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
		handleRegisterUser(c, user.Username, user.UUID, user.Password, user.Avatar)
		return nil

	case actionLogin:
		var login login
		err := json.Unmarshal(rawMessage, &login)
		if err != nil {
			return err
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
		handleCreateTable(c, table.Tablename, table.Password, table.SB, table.BB, table.BuyIn, table.MaxBuy, table.MaxPlayers, table.HandsLimit)
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

	default:
		return errors.New("unexpected message action")
	}
}
