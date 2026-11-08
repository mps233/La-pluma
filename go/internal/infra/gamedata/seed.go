package gamedata

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"

	apperrors "github.com/mps233/la-pluma/go/internal/util/errors"
	"github.com/mps233/la-pluma/go/internal/util/jsonstore"
)

// SeedResult reports the generated files and record counts.
type SeedResult struct {
	Paths                  []string
	StageCount             int
	ParadoxOperatorCount   int
	OperatorMaterialsCount int
	MasteryOperatorCount   int
	MasterySkillCount      int
}

// Seed fetches the five source tables once and writes the four static seed
// files: stages.json, paradox-operators.json, operator-materials.json and
// operator-mastery.json.
func Seed(ctx context.Context, client *Client, outDir string) (SeedResult, error) {
	if client == nil {
		client = NewClient(ClientOptions{})
	}
	if strings.TrimSpace(outDir) == "" {
		return SeedResult{}, apperrors.WithStatus(
			"GAMEDATA_OUTPUT_REQUIRED",
			"必须指定输出目录",
			http.StatusBadRequest,
			false,
			nil,
		)
	}

	tables, err := client.fetchTables(
		ctx,
		"stage_table.json",
		"handbook_info_table.json",
		"character_table.json",
		"item_table.json",
		"skill_table.json",
	)
	if err != nil {
		return SeedResult{}, err
	}

	characters := tables["character_table.json"]
	itemTable := tables["item_table.json"]
	stages := ParseStageData(tables["stage_table.json"])
	paradox := ParseParadoxOperators(tables["handbook_info_table.json"], characters)
	now := client.Now()
	operatorMaterials := BuildOperatorMaterialsFile(characters, itemTable, now)
	mastery := BuildMasteryFile(characters, tables["skill_table.json"], itemTable, now)

	paths := []string{
		filepath.Join(outDir, StagesFileName),
		filepath.Join(outDir, ParadoxOperatorsFileName),
		filepath.Join(outDir, OperatorMaterialsFileName),
		filepath.Join(outDir, OperatorMasteryFileName),
	}
	values := []any{stages, paradox, operatorMaterials, mastery}
	for index, path := range paths {
		if err := writeGenerated(path, values[index]); err != nil {
			return SeedResult{}, err
		}
	}

	return SeedResult{
		Paths:                  paths,
		StageCount:             len(stages),
		ParadoxOperatorCount:   len(paradox),
		OperatorMaterialsCount: len(operatorMaterials.Operators),
		MasteryOperatorCount:   len(mastery.Operators),
		MasterySkillCount:      mastery.Metadata.TotalSkills,
	}, nil
}

// writeGenerated atomically writes pretty JSON with jsonstore and wraps the
// failure in a stable application error.
func writeGenerated(path string, value any) error {
	if err := jsonstore.Write(path, value, true); err != nil {
		return apperrors.WithStatus(
			"GAMEDATA_WRITE_FAILED",
			"写入游戏数据失败",
			http.StatusInternalServerError,
			false,
			map[string]any{"path": path, "cause": err.Error()},
		)
	}
	return nil
}
