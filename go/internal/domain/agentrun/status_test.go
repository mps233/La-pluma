package agentrun

import "testing"

func TestStatusContractValues(t *testing.T) {
	// These strings are part of the public Agent API contract.
	want := map[Status]string{
		StatusAccepted:    "accepted",
		StatusWaiting:     "waiting",
		StatusRunning:     "running",
		StatusStopping:    "stopping",
		StatusSucceeded:   "succeeded",
		StatusFailed:      "failed",
		StatusStopped:     "stopped",
		StatusInterrupted: "interrupted",
	}
	for status, value := range want {
		if string(status) != value {
			t.Fatalf("status %q != %q", status, value)
		}
	}
	if len(want) != 8 {
		t.Fatalf("unexpected status count: %d", len(want))
	}
}

func TestStatusClassification(t *testing.T) {
	active := []Status{StatusAccepted, StatusWaiting, StatusRunning, StatusStopping}
	terminal := []Status{StatusSucceeded, StatusFailed, StatusStopped, StatusInterrupted}

	for _, status := range active {
		if !status.Active() || status.Terminal() || !status.Valid() {
			t.Fatalf("%q: active=%v terminal=%v valid=%v", status, status.Active(), status.Terminal(), status.Valid())
		}
	}
	for _, status := range terminal {
		if status.Active() || !status.Terminal() || !status.Valid() {
			t.Fatalf("%q: active=%v terminal=%v valid=%v", status, status.Active(), status.Terminal(), status.Valid())
		}
	}
	if Status("bogus").Valid() {
		t.Fatal("bogus status is valid")
	}
}

func TestToDTOCopiesRunFieldsAndLinks(t *testing.T) {
	duration := int64(1234)
	started := "2026-11-28T10:00:00Z"
	finished := "2026-11-28T10:01:00Z"
	run := &Run{
		RunID:       "run-1",
		OperationID: "fight",
		Status:      StatusSucceeded,
		CreatedAt:   "2026-11-28T09:59:00Z",
		StartedAt:   &started,
		FinishedAt:  &finished,
		DurationMS:  &duration,
		Progress:    map[string]any{"step": "done"},
		Result:      map[string]any{"ok": true},
	}

	dto := run.ToDTO()

	if dto.RunID != "run-1" || dto.OperationID != "fight" || dto.State != StatusSucceeded {
		t.Fatalf("dto = %#v", dto)
	}
	if dto.AcceptedAt != "2026-11-28T09:59:00Z" || dto.StartedAt != &started || dto.FinishedAt != &finished {
		t.Fatalf("timestamps not copied: %#v", dto)
	}
	if dto.DurationMS == nil || *dto.DurationMS != 1234 {
		t.Fatalf("duration = %#v", dto.DurationMS)
	}
	if dto.Links.Self != "/api/agent/runs/run-1" || dto.Links.Stop != "/api/agent/actions/stop" || dto.Links.TargetedStop != "/api/agent/runs/run-1/stop" {
		t.Fatalf("links = %#v", dto.Links)
	}
}

func TestToDTOOmitsUnsetOptionalFields(t *testing.T) {
	dto := (&Run{RunID: "run-2", Status: StatusAccepted}).ToDTO()

	if dto.DurationMS != nil || dto.Progress != nil || dto.Error != nil {
		t.Fatalf("optional fields not omitted: %#v", dto)
	}
}

func TestNilRunToDTOIsZero(t *testing.T) {
	var run *Run
	if dto := run.ToDTO(); dto.RunID != "" || dto.State != "" {
		t.Fatalf("dto = %#v", dto)
	}
}
