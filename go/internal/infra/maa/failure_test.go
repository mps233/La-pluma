package maa

import "testing"

func TestClassifyMAAFailureUnknownSubcommand(t *testing.T) {
	stderr := "error: unrecognized subcommand 'infrast'\n\nUsage: maa [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n"
	failure := classifyMAAFailure(2, stderr, "")

	if failure.Kind != "invalid_command" {
		t.Fatalf("kind = %q", failure.Kind)
	}
	if failure.Retryable {
		t.Fatal("an unknown subcommand must not be retried")
	}
	if failure.Message == "" {
		t.Fatal("message is empty")
	}
}

func TestClassifyMAAFailureKeepsNetworkRetryable(t *testing.T) {
	failure := classifyMAAFailure(1, "network error", "")
	if failure.Kind != "network" || !failure.Retryable {
		t.Fatalf("failure = %+v", failure)
	}
}
