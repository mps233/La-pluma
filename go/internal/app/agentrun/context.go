package agentrun

import "context"

type parentRunKey struct{}

type scopeKey struct{}

// WithParentRun marks the run that owns an MAA subprocess. The MAA service
// attaches its command to this run instead of creating a nested run, so the
// outer action keeps a single run id and the stop endpoint sees the right run.
func WithParentRun(ctx context.Context, runID string) context.Context {
	if runID == "" {
		return ctx
	}
	return context.WithValue(ctx, parentRunKey{}, runID)
}

// ParentRunID returns the run attached by WithParentRun.
func ParentRunID(ctx context.Context) string {
	value, _ := ctx.Value(parentRunKey{}).(string)
	return value
}

// withScope attaches the owning scope to an action context. Execute does this
// so progress callbacks can report through the scope without a second lookup.
func withScope(ctx context.Context, scope *Scope) context.Context {
	return context.WithValue(ctx, scopeKey{}, scope)
}

// ScopeFrom returns the scope attached to an action context by Execute.
func ScopeFrom(ctx context.Context) (*Scope, bool) {
	scope, ok := ctx.Value(scopeKey{}).(*Scope)
	return scope, ok
}
