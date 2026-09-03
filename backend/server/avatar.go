package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"strconv"
)

const maxAvatarUpload = 10 << 20 // 10 MB

// avatarSizes are the pre-rendered sizes we store, largest first.
var avatarSizes = []int{1024, 512, 256, 128, 64}

func avatarKey(uuid string) string {
	return fmt.Sprintf("gopoker:avatar:%s", uuid)
}

type avatarSet struct {
	Sizes map[int]string `json:"sizes"` // size -> base64-encoded jpeg
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
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarUpload)
	if err := r.ParseMultipartForm(maxAvatarUpload); err != nil {
		http.Error(w, "file too large", http.StatusBadRequest)
		return
	}

	uuid := r.FormValue("uuid")
	if uuid == "" {
		http.Error(w, "missing uuid", http.StatusBadRequest)
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

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		http.Error(w, "unsupported image", http.StatusBadRequest)
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
	if err := s.hub.rdb.Set(ctx, avatarKey(uuid), raw, 0).Err(); err != nil {
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}

	// Mark the account as having a custom image avatar.
	if user, err := loadUser(s.hub.rdb, uuid); err == nil {
		user.AvatarImage = true
		if err := saveUser(s.hub.rdb, user); err != nil {
			slog.Default().Warn("Save avatar flag", "error", err)
		}
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
