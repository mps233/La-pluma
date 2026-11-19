package skland

// Credentials are the Skland session values used to sign API requests. They
// are stored encrypted; the raw token is never returned by the API.
type Credentials struct {
	Cred      string `json:"cred"`
	Token     string `json:"token"`
	UID       string `json:"uid"`
	Channel   string `json:"channel,omitempty"`
	Nickname  string `json:"nickname,omitempty"`
	UpdatedAt string `json:"updatedAt"`
	// Account and Password are encrypted with the rest of this file and used
	// only to renew an expired cred/token, matching Mower's password re-login.
	Account  string `json:"account,omitempty"`
	Password string `json:"password,omitempty"`
}

// Skill is one operator skill slot with its mastery level (0-3).
type Skill struct {
	ID    string `json:"id"`
	Level int    `json:"level"`
}

// Character is the cultivate payload reduced to what the mastery UI needs.
type Character struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	EvolvePhase int     `json:"evolvePhase"`
	Level       int     `json:"level"`
	Skills      []Skill `json:"skills"`
}

// Training is the live training room state from player/info.
type Training struct {
	TraineeID   string `json:"traineeId,omitempty"`
	TraineeName string `json:"traineeName,omitempty"`
	TargetSkill int    `json:"targetSkill"`
	TrainerID   string `json:"trainerId,omitempty"`
	TrainerName string `json:"trainerName,omitempty"`
	RemainSecs  int    `json:"remainSecs"`
	SlotState   int    `json:"slotState"`
}

// Sanity is the account AP snapshot used by the activity island.
type Sanity struct {
	Current              int    `json:"current"`
	Max                  int    `json:"max"`
	ReportAt             string `json:"reportAt"`
	CompleteRecoveryTime int64  `json:"completeRecoveryTime,omitempty"`
}

// Snapshot is the last successful Skland sync.
type Snapshot struct {
	FetchedAt  string      `json:"fetchedAt"`
	UID        string      `json:"uid"`
	Nickname   string      `json:"nickname,omitempty"`
	Characters []Character `json:"characters"`
	Training   *Training   `json:"training,omitempty"`
	Sanity     *Sanity     `json:"sanity,omitempty"`
}

// Status is safe to expose to the UI: no cred/token.
type Status struct {
	Configured     bool      `json:"configured"`
	UID            string    `json:"uid,omitempty"`
	Channel        string    `json:"channel,omitempty"`
	Nickname       string    `json:"nickname,omitempty"`
	UpdatedAt      string    `json:"updatedAt,omitempty"`
	LastSyncedAt   string    `json:"lastSyncedAt,omitempty"`
	CharacterCount int       `json:"characterCount"`
	Training       *Training `json:"training,omitempty"`
	Sanity         *Sanity   `json:"sanity,omitempty"`
	AutoRefresh    bool      `json:"autoRefresh"`
}
