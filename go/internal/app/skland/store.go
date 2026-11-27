package skland

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

const credentialsVersion = 1

type encryptedCredentials struct {
	Version int    `json:"version"`
	Nonce   string `json:"nonce"`
	Data    string `json:"data"`
}

// Store persists the encrypted credential blob and the plain snapshot under
// the user-configs directory.
type Store struct {
	paths config.Paths
	mu    sync.Mutex
}

func NewStore(paths config.Paths) *Store {
	return &Store{paths: paths}
}

func (s *Store) userConfigPath(name string) string {
	return s.paths.UserConfigPath(name)
}

func (s *Store) credentialsPath() string {
	return s.userConfigPath("skland.json")
}

func (s *Store) keyPath() string {
	return s.userConfigPath("skland.key")
}

func (s *Store) snapshotPath() string {
	return s.userConfigPath("skland-snapshot.json")
}

func (s *Store) loadKey() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.keyPath())
	if err == nil {
		if len(data) != 32 {
			return nil, errors.New("skland credential key is invalid")
		}
		return data, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	if err := jsonstore.EnsureDir(filepath.Dir(s.keyPath())); err != nil {
		return nil, err
	}
	if err := os.WriteFile(s.keyPath(), key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func (s *Store) SaveCredentials(credentials Credentials) error {
	key, err := s.loadKey()
	if err != nil {
		return err
	}
	plain, err := json.Marshal(credentials)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	sealed := gcm.Seal(nil, nonce, plain, nil)
	blob := encryptedCredentials{
		Version: credentialsVersion,
		Nonce:   base64.StdEncoding.EncodeToString(nonce),
		Data:    base64.StdEncoding.EncodeToString(sealed),
	}
	return jsonstore.Write(s.credentialsPath(), blob, true)
}

func (s *Store) LoadCredentials() (Credentials, bool, error) {
	raw, err := os.ReadFile(s.credentialsPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Credentials{}, false, nil
		}
		return Credentials{}, false, err
	}
	var blob encryptedCredentials
	if err := json.Unmarshal(raw, &blob); err != nil {
		return Credentials{}, false, err
	}
	key, err := s.loadKey()
	if err != nil {
		return Credentials{}, false, err
	}
	nonce, err := base64.StdEncoding.DecodeString(blob.Nonce)
	if err != nil {
		return Credentials{}, false, err
	}
	sealed, err := base64.StdEncoding.DecodeString(blob.Data)
	if err != nil {
		return Credentials{}, false, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return Credentials{}, false, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return Credentials{}, false, err
	}
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return Credentials{}, false, err
	}
	var credentials Credentials
	if err := json.Unmarshal(plain, &credentials); err != nil {
		return Credentials{}, false, err
	}
	return credentials, true, nil
}

func (s *Store) ClearCredentials() error {
	if err := os.Remove(s.credentialsPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_ = os.Remove(s.snapshotPath())
	return nil
}

func (s *Store) SaveSnapshot(snapshot Snapshot) error {
	return jsonstore.Write(s.snapshotPath(), snapshot, true)
}

func (s *Store) LoadSnapshot() (Snapshot, bool, error) {
	value, err := jsonstore.Read(s.snapshotPath(), nil)
	if err != nil {
		return Snapshot{}, false, err
	}
	if value == nil {
		return Snapshot{}, false, nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return Snapshot{}, false, err
	}
	var snapshot Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return Snapshot{}, false, err
	}
	return snapshot, true, nil
}
