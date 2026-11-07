package app

import (
	"context"

	"github.com/mps233/la-pluma/go/internal/app/updates"
)

type updatesAutoUpdater struct{ service *updates.Service }

func (u updatesAutoUpdater) Run(ctx context.Context, config map[string]any) error {
	if u.service == nil {
		return nil
	}
	return u.service.RunAutoUpdate(ctx, config)
}
