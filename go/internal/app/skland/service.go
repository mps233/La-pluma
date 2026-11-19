package skland

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mps233/la-pluma/go/internal/config"
	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
)

// Options wires the Skland client and local snapshot store.
type Options struct {
	Paths   config.Paths
	Logger  *slog.Logger
	BaseURL string
	HTTP    *http.Client
	Now     func() time.Time
}

// Service owns the Skland credential lifecycle and snapshot sync.
type Service struct {
	store   *Store
	logger  *slog.Logger
	baseURL string
	http    *http.Client
	now     func() time.Time

	trainingMu sync.Mutex
	trainingAt time.Time
	training   Training
	trainingOK bool
}

func NewService(options Options) *Service {
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:   NewStore(options.Paths),
		logger:  logger,
		baseURL: options.BaseURL,
		http:    options.HTTP,
		now:     now,
	}
}

func (s *Service) client(credentials Credentials) *Client {
	return NewClient(s.baseURL, credentials.Cred, credentials.Token, s.http)
}

// Status returns the safe credential/snapshot summary for the UI.
func (s *Service) Status() (Status, error) {
	credentials, configured, err := s.store.LoadCredentials()
	if err != nil {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_STORE_INVALID", "森空岛凭证读取失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	snapshot, hasSnapshot, err := s.store.LoadSnapshot()
	if err != nil {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_STORE_INVALID", "森空岛快照读取失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	status := Status{Configured: configured}
	if configured {
		status.UID = credentials.UID
		status.Channel = credentials.Channel
		status.Nickname = credentials.Nickname
		status.UpdatedAt = credentials.UpdatedAt
		status.AutoRefresh = credentials.Account != "" && credentials.Password != ""
	}
	if hasSnapshot {
		status.LastSyncedAt = snapshot.FetchedAt
		status.CharacterCount = len(snapshot.Characters)
		status.Training = snapshot.Training
		status.Sanity = snapshot.Sanity
		if status.Nickname == "" {
			status.Nickname = snapshot.Nickname
		}
	}
	return status, nil
}

// SaveCredentials validates the pair against the binding endpoint and stores
// the encrypted result. uid picks one binding when the account has several.
func (s *Service) SaveCredentials(ctx context.Context, cred, token, uid string) (Status, error) {
	cred = strings.TrimSpace(cred)
	token = strings.TrimSpace(token)
	uid = strings.TrimSpace(uid)
	if cred == "" || token == "" {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_CREDENTIALS_INVALID", "cred 和 token 都必须填写", http.StatusBadRequest, false, nil)
	}
	client := s.client(Credentials{Cred: cred, Token: token})
	accounts, err := client.Binding(ctx)
	if err != nil {
		return Status{}, err
	}
	account, err := chooseAccount(accounts, uid)
	if err != nil {
		return Status{}, err
	}
	credentials := Credentials{
		Cred:      cred,
		Token:     token,
		UID:       account.UID,
		Channel:   account.ChannelName,
		Nickname:  account.Nickname,
		UpdatedAt: s.nowISO(),
	}
	if err := s.store.SaveCredentials(credentials); err != nil {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_STORE_FAILED", "森空岛凭证保存失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	s.invalidateTraining()
	return s.Status()
}

// Login authenticates with phone/password, validates the binding and stores
// the resulting cred/token. The password is encrypted with the credential file
// so an expired session can be renewed without prompting again.
func (s *Service) Login(ctx context.Context, account, password, uid string) (Status, error) {
	account = strings.TrimSpace(account)
	if account == "" || password == "" {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_CREDENTIALS_INVALID", "账号和密码都必须填写", http.StatusBadRequest, false, nil)
	}
	client := s.client(Credentials{})
	credentials, err := client.Login(ctx, account, password)
	if err != nil {
		return Status{}, err
	}
	client.Cred = credentials.Cred
	client.Token = credentials.Token
	accounts, err := client.Binding(ctx)
	if err != nil {
		return Status{}, err
	}
	chosen, err := chooseAccount(accounts, strings.TrimSpace(uid))
	if err != nil {
		return Status{}, err
	}
	credentials.UID = chosen.UID
	credentials.Channel = chosen.ChannelName
	credentials.Nickname = chosen.Nickname
	credentials.Account = account
	credentials.Password = password
	if credentials.UpdatedAt == "" {
		credentials.UpdatedAt = s.nowISO()
	}
	if err := s.store.SaveCredentials(credentials); err != nil {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_STORE_FAILED", "森空岛凭证保存失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	s.invalidateTraining()
	return s.Status()
}

// Training returns the live training-room state. Results are cached for 30s so
// the mastery scheduler can call it without hitting Skland on every tick.
func (s *Service) Training(ctx context.Context) (Training, bool, error) {
	credentials, configured, err := s.store.LoadCredentials()
	if err != nil || !configured {
		return Training{}, false, nil
	}
	s.trainingMu.Lock()
	if !s.trainingAt.IsZero() && time.Since(s.trainingAt) < 30*time.Second {
		state, ok := s.training, s.trainingOK
		s.trainingMu.Unlock()
		return state, ok, nil
	}
	s.trainingMu.Unlock()

	raw, err := s.client(credentials).PlayerInfo(ctx, credentials.UID)
	if err != nil && isAuthInvalid(err) {
		refreshed, ok, refreshErr := s.refreshCredentials(ctx, credentials)
		if refreshErr == nil && ok {
			credentials = refreshed
			raw, err = s.client(credentials).PlayerInfo(ctx, credentials.UID)
		}
	}
	if err != nil {
		return Training{}, false, err
	}
	var player playerPayload
	if err := json.Unmarshal(raw, &player); err != nil {
		return Training{}, false, err
	}
	var state Training
	ok := false
	if training := player.Building.Training; training != nil && training.Trainee != nil {
		state = Training{
			TraineeID:   training.Trainee.CharID,
			TargetSkill: training.Trainee.TargetSkill,
			RemainSecs:  training.RemainSecs,
			SlotState:   training.SlotState,
		}
		if snapshot, has, _ := s.store.LoadSnapshot(); has {
			for _, character := range snapshot.Characters {
				if character.ID == state.TraineeID {
					state.TraineeName = character.Name
					break
				}
			}
		}
		ok = true
	}
	s.trainingMu.Lock()
	s.trainingAt = time.Now()
	s.training = state
	s.trainingOK = ok
	s.trainingMu.Unlock()
	return state, ok, nil
}

func (s *Service) invalidateTraining() {
	s.trainingMu.Lock()
	s.trainingAt = time.Time{}
	s.trainingOK = false
	s.trainingMu.Unlock()
}

func (s *Service) ClearCredentials() error {
	s.invalidateTraining()
	if err := s.store.ClearCredentials(); err != nil {
		return apperrors.WithStatus("AGENT_SKLAND_STORE_FAILED", "森空岛凭证清除失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	return nil
}

func isAuthInvalid(err error) bool {
	appErr, ok := apperrors.As(err)
	return ok && appErr.Code == "AGENT_SKLAND_AUTH_INVALID"
}

// refreshCredentials re-runs the password login only when the stored session
// can no longer sign requests. Manual cred/token logins have no password and
// keep the original error.
func (s *Service) refreshCredentials(ctx context.Context, credentials Credentials) (Credentials, bool, error) {
	if credentials.Account == "" || credentials.Password == "" {
		return credentials, false, nil
	}
	if _, err := s.Login(ctx, credentials.Account, credentials.Password, credentials.UID); err != nil {
		return credentials, false, err
	}
	refreshed, ok, err := s.store.LoadCredentials()
	if err != nil || !ok {
		return credentials, false, err
	}
	return refreshed, true, nil
}

// Sync pulls cultivate and player/info, then replaces the local snapshot.
func (s *Service) Sync(ctx context.Context) (Status, error) {
	credentials, configured, err := s.store.LoadCredentials()
	if err != nil || !configured {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_NOT_CONFIGURED", "尚未配置森空岛凭证", http.StatusConflict, false, nil)
	}
	snapshot, err := s.fetchSnapshot(ctx, credentials)
	if err != nil && isAuthInvalid(err) {
		refreshed, ok, refreshErr := s.refreshCredentials(ctx, credentials)
		if refreshErr != nil {
			return Status{}, apperrors.WithStatus("AGENT_SKLAND_AUTH_INVALID", "森空岛凭证已失效，自动续期失败："+refreshErr.Error(), http.StatusUnauthorized, false, nil)
		}
		if ok {
			credentials = refreshed
			snapshot, err = s.fetchSnapshot(ctx, credentials)
		}
	}
	if err != nil {
		return Status{}, err
	}
	if err := s.store.SaveSnapshot(snapshot); err != nil {
		return Status{}, apperrors.WithStatus("AGENT_SKLAND_STORE_FAILED", "森空岛快照保存失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	s.invalidateTraining()
	s.logger.Info("森空岛数据已同步", "characters", len(snapshot.Characters), "training", snapshot.Training != nil)
	return s.Status()
}

func (s *Service) fetchSnapshot(ctx context.Context, credentials Credentials) (Snapshot, error) {
	client := s.client(credentials)
	cultivate, err := client.Cultivate(ctx, credentials.UID)
	if err != nil {
		return Snapshot{}, err
	}
	playerInfo, err := client.PlayerInfo(ctx, credentials.UID)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot, err := buildSnapshot(cultivate, playerInfo)
	if err != nil {
		return Snapshot{}, err
	}
	snapshot.UID = credentials.UID
	snapshot.FetchedAt = s.nowISO()
	if snapshot.Nickname == "" {
		snapshot.Nickname = credentials.Nickname
	}
	return snapshot, nil
}

// Snapshot returns the last synced snapshot for the mastery UI.
func (s *Service) Snapshot() (Snapshot, bool, error) {
	snapshot, ok, err := s.store.LoadSnapshot()
	if err != nil {
		return Snapshot{}, false, apperrors.WithStatus("AGENT_SKLAND_STORE_INVALID", "森空岛快照读取失败："+err.Error(), http.StatusInternalServerError, false, nil)
	}
	return snapshot, ok, nil
}

func (s *Service) nowISO() string {
	return s.now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func chooseAccount(accounts []BindingAccount, uid string) (BindingAccount, error) {
	if uid != "" {
		for _, account := range accounts {
			if account.UID == uid {
				return account, nil
			}
		}
		return BindingAccount{}, apperrors.WithStatus("AGENT_SKLAND_BINDING_MISSING", "指定的角色 uid 不在绑定列表中", http.StatusNotFound, false, map[string]any{"uid": uid})
	}
	return accounts[0], nil
}

type cultivatePayload struct {
	Characters []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		EvolvePhase int    `json:"evolvePhase"`
		Level       int    `json:"level"`
		Skills      []struct {
			ID    string `json:"id"`
			Level int    `json:"level"`
		} `json:"skills"`
	} `json:"characters"`
}

type playerPayload struct {
	Status struct {
		Name string `json:"name"`
		AP   struct {
			Current              *int   `json:"current"`
			Max                  *int   `json:"max"`
			CompleteRecoveryTime *int64 `json:"completeRecoveryTime"`
		} `json:"ap"`
	} `json:"status"`
	Building struct {
		Training *struct {
			Trainee *struct {
				CharID      string `json:"charId"`
				TargetSkill int    `json:"targetSkill"`
			} `json:"trainee"`
			Trainer *struct {
				CharID string `json:"charId"`
			} `json:"trainer"`
			RemainSecs int `json:"remainSecs"`
			SlotState  int `json:"slotState"`
		} `json:"training"`
	} `json:"building"`
}

func buildSanity(currentPtr, maxPtr *int, completePtr *int64) *Sanity {
	current := 0
	if currentPtr != nil {
		current = *currentPtr
	}
	max := 0
	if maxPtr != nil {
		max = *maxPtr
	}
	var complete int64
	if completePtr != nil {
		complete = *completePtr
	}
	// Skland uses seconds; tolerate milliseconds from other deployments.
	if complete > 10_000_000_000 {
		complete /= 1000
	}
	if complete > 0 {
		fullAt := time.Unix(complete, 0).UTC()
		remaining := int(time.Until(fullAt).Seconds())
		if remaining > 0 {
			missing := (remaining + 359) / 360
			if max == 0 && currentPtr != nil {
				max = current + missing
			}
			if max > 0 {
				computed := max - missing
				if computed < 0 {
					computed = 0
				}
				// Skland's raw current can lag behind completeRecoveryTime; trust the
				// countdown when they disagree by more than one point.
				delta := current - computed
				if delta < 0 {
					delta = -delta
				}
				if currentPtr == nil || delta > 1 {
					current = computed
				}
			}
		} else {
			if max == 0 && currentPtr != nil {
				max = current
			}
			if max > 0 {
				current = max
			}
		}
	}
	if max == 0 {
		max = current
	}
	if current < 0 {
		current = 0
	}
	if max < current {
		max = current
	}
	if max == 0 {
		return nil
	}
	return &Sanity{
		Current:              current,
		Max:                  max,
		ReportAt:             time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		CompleteRecoveryTime: complete,
	}
}

func buildSnapshot(cultivateRaw, playerRaw json.RawMessage) (Snapshot, error) {
	var cultivate cultivatePayload
	if err := json.Unmarshal(cultivateRaw, &cultivate); err != nil {
		return Snapshot{}, apperrors.WithStatus("AGENT_SKLAND_RESPONSE_INVALID", "森空岛养成数据无法解析", http.StatusBadGateway, true, nil)
	}
	var player playerPayload
	if err := json.Unmarshal(playerRaw, &player); err != nil {
		return Snapshot{}, apperrors.WithStatus("AGENT_SKLAND_RESPONSE_INVALID", "森空岛实时数据无法解析", http.StatusBadGateway, true, nil)
	}
	names := make(map[string]string, len(cultivate.Characters))
	characters := make([]Character, 0, len(cultivate.Characters))
	for _, raw := range cultivate.Characters {
		skills := make([]Skill, 0, len(raw.Skills))
		for _, skill := range raw.Skills {
			skills = append(skills, Skill{ID: skill.ID, Level: skill.Level})
		}
		characters = append(characters, Character{
			ID:          raw.ID,
			Name:        raw.Name,
			EvolvePhase: raw.EvolvePhase,
			Level:       raw.Level,
			Skills:      skills,
		})
		names[raw.ID] = raw.Name
	}
	snapshot := Snapshot{
		Nickname:   player.Status.Name,
		Characters: characters,
	}
	snapshot.Sanity = buildSanity(player.Status.AP.Current, player.Status.AP.Max, player.Status.AP.CompleteRecoveryTime)
	if training := player.Building.Training; training != nil && training.Trainee != nil {
		entry := &Training{
			TraineeID:   training.Trainee.CharID,
			TraineeName: names[training.Trainee.CharID],
			TargetSkill: training.Trainee.TargetSkill,
			RemainSecs:  training.RemainSecs,
			SlotState:   training.SlotState,
		}
		if training.Trainer != nil {
			entry.TrainerID = training.Trainer.CharID
			entry.TrainerName = names[training.Trainer.CharID]
		}
		snapshot.Training = entry
	}
	return snapshot, nil
}
