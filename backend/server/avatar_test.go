package server

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

type memoryAvatarStore struct {
	users   map[string]*UserRecord
	avatars map[string][]byte
}

func (s *memoryAvatarStore) load(uuid string) (*UserRecord, error) {
	u := s.users[uuid]
	if u == nil {
		return &UserRecord{UUID: uuid}, nil
	}
	cp := *u
	return &cp, nil
}

func (s *memoryAvatarStore) saveAvatar(uuid, token string, raw []byte) error {
	user := s.users[uuid]
	if !validSessionToken(user, token) {
		return errAvatarUnauthorized
	}
	cp := *user
	cp.AvatarImage = true
	s.users[uuid] = &cp
	s.avatars[uuid] = append([]byte(nil), raw...)
	return nil
}

func avatarUploadRequest(t *testing.T, uuid, token string) *http.Request {
	t.Helper()
	var imageData bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.White)
	if err := png.Encode(&imageData, img); err != nil {
		t.Fatalf("encode test image: %v", err)
	}

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", "avatar.png")
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write(imageData.Bytes()); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/avatar?uuid="+uuid, &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

func TestUploadAvatarRequiresMatchingSessionToken(t *testing.T) {
	owner := &UserRecord{UUID: "owner"}
	ownerToken, err := newSessionToken(owner)
	if err != nil {
		t.Fatalf("owner token: %v", err)
	}
	attacker := &UserRecord{UUID: "attacker"}
	attackerToken, err := newSessionToken(attacker)
	if err != nil {
		t.Fatalf("attacker token: %v", err)
	}
	store := &memoryAvatarStore{
		users:   map[string]*UserRecord{"owner": owner, "attacker": attacker},
		avatars: make(map[string][]byte),
	}
	s := &Server{avatars: store}

	for _, tc := range []struct {
		name  string
		token string
	}{
		{name: "missing token"},
		{name: "wrong token", token: ownerToken + "x"},
		{name: "another account token", token: attackerToken},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			s.uploadAvatar(rec, avatarUploadRequest(t, "owner", tc.token))
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d; body=%q", rec.Code, http.StatusUnauthorized, rec.Body.String())
			}
			if len(store.avatars) != 0 {
				t.Fatal("unauthorized upload changed avatar storage")
			}
		})
	}

	rec := httptest.NewRecorder()
	s.uploadAvatar(rec, avatarUploadRequest(t, "owner", ownerToken))
	if rec.Code != http.StatusOK {
		t.Fatalf("authorized status = %d, want %d; body=%q", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(store.avatars["owner"]) == 0 || !store.users["owner"].AvatarImage {
		t.Fatal("authorized upload did not persist the avatar and account flag")
	}
}

func TestAvatarDimensionLimit(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  image.Config
		want bool
	}{
		{name: "phone photo", cfg: image.Config{Width: 4032, Height: 3024}, want: true},
		{name: "too many pixels", cfg: image.Config{Width: 5000, Height: 5000}},
		{name: "too wide", cfg: image.Config{Width: maxAvatarDimension + 1, Height: 1}},
		{name: "empty", cfg: image.Config{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := validAvatarDimensions(tc.cfg); got != tc.want {
				t.Fatalf("validAvatarDimensions(%+v) = %v, want %v", tc.cfg, got, tc.want)
			}
		})
	}
}
