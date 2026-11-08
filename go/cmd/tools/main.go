// Command tools regenerates the static game data files consumed by La Pluma.
//
// Run it from the go module directory:
//
//	go run ./cmd/tools seed
//	go run ./cmd/tools materials
//
// Both commands support -source (gamedata root URL) and -out (target data
// directory). Tests use injected httptest clients; this CLI is the only entry
// point that talks to the public source.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mps233/la-pluma/go/internal/infra/gamedata"
)

const defaultOutDir = "resources/seed"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "tools:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		printUsage(os.Stdout)
		return nil
	}
	switch args[0] {
	case "seed":
		return runSeed(args[1:])
	case "materials":
		return runMaterials(args[1:])
	case "help", "-h", "--help":
		printUsage(os.Stdout)
		return nil
	default:
		printUsage(os.Stderr)
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func printUsage(writer *os.File) {
	fmt.Fprintln(writer, `Usage:
  tools seed [-source URL] [-out DIR]
  tools materials [-source URL] [-out DIR]

seed writes stages.json, paradox-operators.json, operator-materials.json and
operator-mastery.json. materials refreshes materials.json and
material-formulas.json.

Defaults: -source `+gamedata.DefaultSourceURL+`, -out `+defaultOutDir+`
(run from the go module directory).`)
}

func runSeed(args []string) error {
	flags := flag.NewFlagSet("seed", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	source := flags.String("source", gamedata.DefaultSourceURL, "gamedata root URL")
	outDir := flags.String("out", defaultOutDir, "target data directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 0 {
		return fmt.Errorf("seed takes no arguments, got %v", flags.Args())
	}

	client := gamedata.NewClient(gamedata.ClientOptions{BaseURL: *source})
	result, err := gamedata.Seed(context.Background(), client, *outDir)
	if err != nil {
		return err
	}
	for _, path := range result.Paths {
		absolute, absErr := filepath.Abs(path)
		if absErr != nil {
			absolute = path
		}
		fmt.Fprintln(os.Stdout, absolute)
	}
	fmt.Fprintf(os.Stdout, "stages=%d paradox=%d operator-materials=%d operator-mastery=%d skills=%d\n",
		result.StageCount,
		result.ParadoxOperatorCount,
		result.OperatorMaterialsCount,
		result.MasteryOperatorCount,
		result.MasterySkillCount,
	)
	return nil
}

func runMaterials(args []string) error {
	flags := flag.NewFlagSet("materials", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	source := flags.String("source", gamedata.DefaultSourceURL, "gamedata root URL")
	outDir := flags.String("out", defaultOutDir, "target data directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 0 {
		return fmt.Errorf("materials takes no arguments, got %v", flags.Args())
	}

	client := gamedata.NewClient(gamedata.ClientOptions{BaseURL: *source})
	result, err := gamedata.RefreshMaterials(context.Background(), client, *outDir)
	if err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, result.MaterialsPath)
	fmt.Fprintln(os.Stdout, result.FormulasPath)
	fmt.Fprintf(os.Stdout, "materials=%d formulas=%d recipes=%d\n",
		result.MaterialCount,
		result.RecipeCount,
		result.MergedCount,
	)
	return nil
}
