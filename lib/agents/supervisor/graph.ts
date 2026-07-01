import { END, START, StateGraph } from "@langchain/langgraph";
import { getContentGenerationGraph } from "@/lib/agents/content_generation/graph";
import { AgentState } from "@/lib/agents/state";
import { supervisorNode } from "@/lib/agents/supervisor/nodes/supervisor";
import { universityPlaceholderNode } from "@/lib/agents/supervisor/nodes/university-placeholder";
import { routeByEducationLevel } from "@/lib/agents/supervisor/routing";

/** Lise (TYT/AYT/YKS) içerik üretim alt grafiği */
export const highSchoolContentGraph = getContentGenerationGraph();

/**
 * NotAl ana graf — uygulamanın dışarıya açılan tek yüzü.
 *
 * Akış:
 * START → supervisor → [high_school_content | university_placeholder] → END
 */
export function buildMainNotalGraph() {
  return new StateGraph(AgentState)
    .addNode("supervisor", supervisorNode)
    .addNode("high_school_content", highSchoolContentGraph)
    .addNode("university_placeholder", universityPlaceholderNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", routeByEducationLevel, {
      high_school: "high_school_content",
      university: "university_placeholder",
    })
    .addEdge("high_school_content", END)
    .addEdge("university_placeholder", END)
    .compile();
}

let compiledGraph: ReturnType<typeof buildMainNotalGraph> | null = null;

export function getMainNotalGraph() {
  if (!compiledGraph) {
    compiledGraph = buildMainNotalGraph();
  }

  return compiledGraph;
}

export const mainNotalGraph = getMainNotalGraph();
