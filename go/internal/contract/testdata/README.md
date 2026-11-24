# Node oracle fixtures

These fixtures were generated from the Node contract builders that were removed
with the Node server. They are frozen now: `go test ./internal/contract -run
NodeOracle` compares the Go registry against them.

Regeneration requires an external checkout of the pre-Go Node server; there is
no in-repo generator. Do not hand-edit the JSON. Parameter order is ignored
because Go builds query parameters from a map.