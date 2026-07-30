export class RagToolManager {
    /**
     * Revisa si el prompt del sistema menciona herramientas RAG y, en caso afirmativo,
     * inyecta dinámicamente las definiciones de 'search_knowledge_base' y 'file_search'.
     */
    static injectRagToolsIfNeeded(tools: any[], systemPrompt?: string): any[] {
        const resultTools = Array.isArray(tools) ? [...tools] : [];

        const RAG_TOOL_NAME = "search_knowledge_base";
        const hasRagTool = resultTools.some((t: any) => 
            (t.function?.name || t.name) === RAG_TOOL_NAME || 
            (t.function?.name || t.name) === "file_search"
        );

        const promptMentionsRag = systemPrompt && (
            systemPrompt.includes("file search") || 
            systemPrompt.includes("file_search") || 
            systemPrompt.includes("search_knowledge_base") || 
            systemPrompt.includes("documento") || 
            systemPrompt.includes("diplomaturas")
        );

        if (!hasRagTool && promptMentionsRag) {
            resultTools.push({
                type: "function",
                function: {
                    name: "search_knowledge_base",
                    description: "Busca información detallada, políticas, aranceles o instructivos de la empresa en los documentos de la base de conocimientos.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "La duda, tema o nombre del curso/diplomatura a consultar en los documentos de la empresa."
                            }
                        },
                        required: ["query"]
                    }
                }
            });

            if (systemPrompt && (systemPrompt.includes("file search") || systemPrompt.includes("file_search"))) {
                resultTools.push({
                    type: "function",
                    function: {
                        name: "file_search",
                        description: "Busca e inspecciona la información relevante de los documentos adjuntos de la empresa.",
                        parameters: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "La consulta o tema a buscar en los documentos."
                                }
                            },
                            required: ["query"]
                        }
                    }
                });
            }
        }

        return resultTools;
    }
}
