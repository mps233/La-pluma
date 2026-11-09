//go:build !darwin

package main

import "github.com/egoist/mygo"

// roundWindowCorners is macOS-only: the Windows and Linux backends round a
// frameless window with the system's own corners.
func roundWindowCorners(*mygo.Window, float64) {}
