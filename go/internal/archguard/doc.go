// Package archguard contains executable architecture invariants for the Go
// backend. It has no production code; the tests walk the module source and fail
// when a dependency points in a forbidden direction.
package archguard
