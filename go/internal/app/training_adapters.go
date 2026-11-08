package app

import (
	"context"
	"fmt"

	"github.com/mps233/la-pluma/go/internal/app/training"
	"github.com/mps233/la-pluma/go/internal/config"
	"github.com/mps233/la-pluma/go/internal/infra/gamedata"
)

type trainingMaterialFetcher struct{ paths config.Paths }

func (f trainingMaterialFetcher) FetchOperatorMaterials(ctx context.Context) (training.FetchMaterialsResponse, error) {
	client := gamedata.NewClient(gamedata.ClientOptions{})
	result, err := gamedata.Seed(ctx, client, f.paths.DataDir)
	if err != nil {
		return training.FetchMaterialsResponse{}, err
	}
	return training.FetchMaterialsResponse{
		Success: true,
		Scripts: []training.FetchMaterialScriptResult{{
			Script: "gamedata-seed",
			OK:     true,
			Stdout: fmt.Sprintf("stages=%d paradox=%d operators=%d mastery=%d/%d",
				result.StageCount, result.ParadoxOperatorCount, result.OperatorMaterialsCount,
				result.MasteryOperatorCount, result.MasterySkillCount),
		}},
	}, nil
}
