//go:build !windows

package instancelock

import (
	"errors"
	"os"
	"syscall"
)

// lockFile takes a non-blocking exclusive flock. flock conflicts are per open
// file description, so two handles in the same process conflict as well.
func lockFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

func unlockFile(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
}

func isBusy(err error) bool {
	return errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN)
}
