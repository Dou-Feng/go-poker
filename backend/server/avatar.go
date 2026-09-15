package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-redis/redis/v8"
	_ "golang.org/x/image/webp" // decode-only WebP support
)

const (
	maxAvatarUpload    = 10 << 20 // 10 MB compressed request body
	maxAvatarDimension = 8192
	maxAvatarPixels    = 16_777_216 // 4096 x 4096; comfortably fits phone photos
)

// errUnsupportedImage reports a file that could not be decoded as a supported
// image format (jpg, png, gif, webp).
var errUnsupportedImage = errors.New("unsupported image format (use jpg, png, gif or webp)")

// avatarSizes are the pre-rendered sizes we store, largest first.
var avatarSizes = []int{1024, 512, 256, 128, 64}

func avatarKey(uuid string) string {
	return fmt.Sprintf("gopoker:avatar:%s", uuid)
}

type avatarSet struct {
	Sizes map[int]string `json:"sizes"` // size -> base64-encoded jpeg
}

// avatarStore keeps HTTP avatar tests independent of Redis and gives the
// handler one boundary for both the account credential and image data.
type avatarStore interface {
	load(uuid string) (*UserRecord, error)
	saveAvatar(uuid, token string, raw []byte) error
}

type redisAvatarStore struct{ rdb *redis.Client }

func (s redisAvatarStore) load(uuid string) (*UserRecord, error) {
	return loadUser(s.rdb, uuid)
}

var errAvatarUnauthorized = errors.New("avatar session changed")

func (s redisAvatarStore) saveAvatar(uuid, token string, avatarRaw []byte) error {
	for attempts := 0; attempts < 3; attempts++ {
		err := s.rdb.Watch(ctx, func(tx *redis.Tx) error {
			userRaw, err := tx.Get(ctx, userKey(uuid)).Bytes()
			if err == redis.Nil {
				return errAvatarUnauthorized
			}
			if err != nil {
				return err
			}
			var current UserRecord
			if err := json.Unmarshal(userRaw, &current); err != nil {
				return err
			}
			// Processing several resized images takes time. Recheck the token in
			// the transaction so a logout/login rotation during processing wins.
			if !validSessionToken(&current, token) {
				return errAvatarUnauthorized
			}
			current.AvatarImage = true
			updatedUser, err := json.Marshal(&current)
			if err != nil {
				return err
			}
			_, err = tx.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
				pipe.Set(ctx, avatarKey(uuid), avatarRaw, 0)
				pipe.Set(ctx, userKey(uuid), updatedUser, 0)
				return nil
			})
			return err
		}, userKey(uuid))
		if err != redis.TxFailedErr {
			return err
		}
	}
	return redis.TxFailedErr
}

func bearerToken(r *http.Request) string {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

func validAvatarDimensions(cfg image.Config) bool {
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > maxAvatarDimension || cfg.Height > maxAvatarDimension {
		return false
	}
	return int64(cfg.Width)*int64(cfg.Height) <= maxAvatarPixels
}

// resize returns a nearest-neighbor scaled copy of src.
func resize(src image.Image, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	sb := src.Bounds()
	sw := sb.Dx()
	sh := sb.Dy()
	if sw == 0 || sh == 0 {
		return dst
	}
	for y := 0; y < h; y++ {
		sy := y * sh / h
		for x := 0; x < w; x++ {
			sx := x * sw / w
			dst.Set(x, y, src.At(sb.Min.X+sx, sb.Min.Y+sy))
		}
	}
	return dst
}

func encodeJPEG(img image.Image) (string, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func (s *Server) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		http.Error(w, "missing uuid", http.StatusBadRequest)
		return
	}
	if !validUUID(uuid) {
		http.Error(w, "invalid uuid", http.StatusBadRequest)
		return
	}
	token := bearerToken(r)
	user, err := s.avatars.load(uuid)
	if err != nil {
		http.Error(w, "could not load user", http.StatusInternalServerError)
		return
	}
	if !validSessionToken(user, token) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarUpload)
	if err := r.ParseMultipartForm(maxAvatarUpload); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			http.Error(w, "file too large", http.StatusBadRequest)
			return
		}
		http.Error(w, "invalid upload", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		http.Error(w, errUnsupportedImage.Error(), http.StatusBadRequest)
		return
	}
	if !validAvatarDimensions(cfg) {
		http.Error(w, "image dimensions too large", http.StatusBadRequest)
		return
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		http.Error(w, errUnsupportedImage.Error(), http.StatusBadRequest)
		return
	}

	set := avatarSet{Sizes: make(map[int]string, len(avatarSizes))}
	for _, size := range avatarSizes {
		encoded, err := encodeJPEG(resize(src, size, size))
		if err != nil {
			http.Error(w, "encode error", http.StatusInternalServerError)
			return
		}
		set.Sizes[size] = encoded
	}

	raw, err := json.Marshal(set)
	if err != nil {
		http.Error(w, "marshal error", http.StatusInternalServerError)
		return
	}
	if err := s.avatars.saveAvatar(uuid, token, raw); err != nil {
		if errors.Is(err, errAvatarUnauthorized) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (s *Server) getAvatar(w http.ResponseWriter, r *http.Request) {
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		http.NotFound(w, r)
		return
	}
	size := 128
	if n, err := strconv.Atoi(r.URL.Query().Get("size")); err == nil {
		size = n
	}

	raw, err := s.hub.rdb.Get(ctx, avatarKey(uuid)).Result()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	var set avatarSet
	if err := json.Unmarshal([]byte(raw), &set); err != nil {
		http.NotFound(w, r)
		return
	}

	// Pick the smallest stored size that is at least as large as requested.
	best := 0
	for _, s := range avatarSizes {
		if s >= size && (best == 0 || s < best) {
			best = s
		}
	}
	if best == 0 {
		best = 64
	}

	encoded, ok := set.Sizes[best]
	if !ok {
		http.NotFound(w, r)
		return
	}
	imgBytes, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(imgBytes)
}
