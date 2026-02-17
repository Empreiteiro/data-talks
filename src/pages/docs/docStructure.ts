export type TocSection = { id: string; title: string; subs: { id: string; title: string }[] };

export const DOC_TOPIC_IDS = [
  "data-sources",
  "asking-questions",
  "answers-sessions",
  "llm-configuration",
  "table-summaries",
  "csv-xlsx",
  "bigquery",
  "google-sheets",
  "sql-database",
] as const;

export type DocTopicId = (typeof DOC_TOPIC_IDS)[number];

export function getDocStructure(isPt: boolean): TocSection[] {
  return [
    {
      id: "data-sources",
      title: isPt ? "Fontes de dados" : "Data sources",
      subs: [
        { id: "data-sources-add", title: isPt ? "Adicionar e vincular fontes" : "Adding and linking sources" },
        { id: "data-sources-types", title: isPt ? "Tipos de fonte" : "Source types" },
      ],
    },
    {
      id: "asking-questions",
      title: isPt ? "Perguntas" : "Asking questions",
      subs: [],
    },
    {
      id: "answers-sessions",
      title: isPt ? "Respostas e sessões" : "Answers & sessions",
      subs: [],
    },
    {
      id: "llm-configuration",
      title: isPt ? "Configuração do LLM" : "LLM configuration",
      subs: [
        { id: "llm-providers", title: isPt ? "Provedores (OpenAI, Ollama, LiteLLM)" : "Providers (OpenAI, Ollama, LiteLLM)" },
        { id: "llm-settings-api", title: isPt ? "API de configuração" : "Settings API" },
      ],
    },
    {
      id: "table-summaries",
      title: isPt ? "Resumos de tabela (Studio)" : "Table summaries (Studio)",
      subs: [
        { id: "table-summaries-generate", title: isPt ? "Gerar resumo" : "Generate summary" },
        { id: "table-summaries-api", title: isPt ? "API" : "API" },
      ],
    },
    {
      id: "csv-xlsx",
      title: "CSV / XLSX",
      subs: [
        { id: "csv-xlsx-storage", title: isPt ? "Upload e armazenamento" : "Upload & storage" },
        { id: "csv-xlsx-context", title: isPt ? "Contexto para o LLM" : "Context for the LLM" },
      ],
    },
    {
      id: "bigquery",
      title: "BigQuery",
      subs: [
        { id: "bigquery-config", title: isPt ? "Configuração e armazenamento" : "Configuration & storage" },
        { id: "bigquery-discovery", title: isPt ? "Discovery e atualização de metadata" : "Discovery & metadata refresh" },
        { id: "bigquery-context", title: isPt ? "Contexto para o LLM" : "Context for the LLM" },
      ],
    },
    {
      id: "google-sheets",
      title: "Google Sheets",
      subs: [
        { id: "google-sheets-config", title: isPt ? "Configuração" : "Configuration" },
        { id: "google-sheets-context", title: isPt ? "Contexto para o LLM" : "Context for the LLM" },
      ],
    },
    {
      id: "sql-database",
      title: "SQL Database",
      subs: [
        { id: "sql-config", title: isPt ? "Configuração" : "Configuration" },
        { id: "sql-context", title: isPt ? "Contexto para o LLM" : "Context for the LLM" },
      ],
    },
  ];
}

export function filterToc(sections: TocSection[], query: string): TocSection[] {
  if (!query.trim()) return sections;
  const q = query.toLowerCase().trim();
  return sections
    .map((sec) => {
      const titleMatch = sec.title.toLowerCase().includes(q);
      const filteredSubs = sec.subs.filter((sub) => sub.title.toLowerCase().includes(q));
      if (titleMatch) return { ...sec, subs: sec.subs };
      if (filteredSubs.length) return { ...sec, subs: filteredSubs };
      return null;
    })
    .filter((s): s is TocSection => s !== null);
}

export function isDocTopicId(s: string): s is DocTopicId {
  return DOC_TOPIC_IDS.includes(s as DocTopicId);
}
