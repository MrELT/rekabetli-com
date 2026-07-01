import { END, START, StateGraph } from "@langchain/langgraph";
import { classifyNode } from "@/lib/agents/content_generation/nodes/classify";
import { illustratorNode } from "@/lib/agents/content_generation/nodes/illustrator";
import { polishNode } from "@/lib/agents/content_generation/nodes/polish";
import { retrieveNode } from "@/lib/agents/content_generation/nodes/retrieve";
import { writeNode } from "@/lib/agents/content_generation/nodes/write";
import { AgentState } from "@/lib/agents/state";

/**
 * İçerik üretimi alt departmanı (Supervisor mimarisinin sub-graph'ı).
 *
 * Akış: classify → retrieve → write → illustrator → polish
 */
export function buildContentGenerationGraph() {
  return new StateGraph(AgentState)
    .addNode("classify", classifyNode)
    .addNode("retrieve", retrieveNode)
    .addNode("write", writeNode)
    .addNode("illustrator", illustratorNode)
    .addNode("polish", polishNode)
    .addEdge(START, "classify")
    .addEdge("classify", "retrieve")
    .addEdge("retrieve", "write")
    .addEdge("write", "illustrator")
    .addEdge("illustrator", "polish")
    .addEdge("polish", END)
    .compile();
}

let compiledGraph: ReturnType<typeof buildContentGenerationGraph> | null = null;

export function getContentGenerationGraph() {
  if (!compiledGraph) {
    compiledGraph = buildContentGenerationGraph();
  }

  return compiledGraph;
}

/** Supervisor grafiğine eklenebilir derlenmiş alt graf. */
export const contentGenerationGraph = getContentGenerationGraph();
