package updates

import "context"

// DryRunMessage is the default message used by sendDryRun for maintenance
// actions.
const DryRunMessage = "Dry run only"

// ActionOutcome is one Agent action response before the HTTP envelope is
// applied. Data is the exact response payload: a {plan} object for dry runs or
// the action result otherwise.
type ActionOutcome struct {
	Data    any
	Message string
	DryRun  bool
}

// UpdateCoreAction mirrors the update-core route, including its dry-run
// branch. The caller owns tracked-run creation and metadata.
func (s *Service) UpdateCoreAction(ctx context.Context, version string, dryRun bool) (ActionOutcome, error) {
	if dryRun {
		return ActionOutcome{
			Data:    map[string]any{"plan": PlanUpdateCore(version)},
			Message: DryRunMessage,
			DryRun:  true,
		}, nil
	}
	result, err := s.UpdateCore(ctx, version)
	if err != nil {
		return ActionOutcome{}, err
	}
	return ActionOutcome{Data: result, Message: result.Message}, nil
}

// UpdateCLIAction mirrors the update-cli route. A dry run still probes the
// self subcommand, so an unsupported build fails before returning a plan.
func (s *Service) UpdateCLIAction(ctx context.Context, dryRun bool) (ActionOutcome, error) {
	if dryRun {
		plan, err := s.PlanUpdateCLI(ctx)
		if err != nil {
			return ActionOutcome{}, err
		}
		return ActionOutcome{
			Data:    map[string]any{"plan": plan},
			Message: DryRunMessage,
			DryRun:  true,
		}, nil
	}
	result, err := s.UpdateCLI(ctx)
	if err != nil {
		return ActionOutcome{}, err
	}
	return ActionOutcome{Data: result, Message: result.Message}, nil
}

// HotUpdateResourcesAction mirrors the hot-update-resources route.
func (s *Service) HotUpdateResourcesAction(ctx context.Context, dryRun bool) (ActionOutcome, error) {
	if dryRun {
		return ActionOutcome{
			Data:    map[string]any{"plan": PlanHotUpdateResources()},
			Message: DryRunMessage,
			DryRun:  true,
		}, nil
	}
	result, err := s.HotUpdateResources(ctx)
	if err != nil {
		return ActionOutcome{}, err
	}
	return ActionOutcome{Data: result, Message: result.Message}, nil
}
