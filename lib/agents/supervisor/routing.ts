import {
  resolveSupervisorRoute,
  type SupervisorRouteTarget,
} from "@/lib/agents/supervisor/types";
import type { AgentStateType } from "@/lib/agents/state";

/** Supervisor çıktısına göre alt departmana yönlendirme. */
export function routeByEducationLevel(
  state: AgentStateType,
): SupervisorRouteTarget {
  if (state.error && state.educationLevel === "unknown") {
    return "high_school";
  }

  return resolveSupervisorRoute(state.educationLevel);
}
