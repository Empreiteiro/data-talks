import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { SEO } from "@/components/SEO";
import {
  FileSpreadsheet,
  Database,
  Sheet,
  Server,
  Save,
  BookOpen,
  Search,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";

type TocSection = { id: string; title: string; subs: { id: string; title: string }[] };

function getDocStructure(isPt: boolean): TocSection[] {
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

function filterToc(sections: TocSection[], query: string): TocSection[] {
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

function DocSubsection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 mb-6">
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      <div className="text-sm text-muted-foreground space-y-2">{children}</div>
    </div>
  );
}

function DocSection({
  id,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">{children}</CardContent>
      </Card>
    </section>
  );
}

export default function Flows() {
  const { t, language } = useLanguage();
  const isPt = language === "pt";
  const [search, setSearch] = useState("");
  const structure = useMemo(() => getDocStructure(isPt), [isPt]);
  const filteredToc = useMemo(() => filterToc(structure, search), [structure, search]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && filteredToc.length > 0) {
      const firstId = filteredToc[0].subs.length ? filteredToc[0].subs[0].id : filteredToc[0].id;
      document.getElementById(firstId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex">
      <SEO title={t("doc.title")} description={t("doc.subtitle")} />

      {/* Sidebar: TOC + search */}
      <aside className="w-64 shrink-0 border-r bg-background/95 sticky top-16 self-start max-h-[calc(100vh-4rem)] overflow-y-auto hidden lg:block">
        <div className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
<Input
                type="search"
                placeholder={t("doc.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9 h-9"
                aria-label={t("doc.searchPlaceholder")}
              />
          </div>
          <nav className="space-y-1">
            {filteredToc.map((sec) => (
              <div key={sec.id} className="space-y-0.5">
                <a
                  href={`#${sec.id}`}
                  className="block py-1.5 px-2 text-sm font-medium text-foreground hover:bg-muted rounded-md hover:text-primary"
                >
                  {sec.title}
                </a>
                {sec.subs.length > 0 && (
                  <ul className="ml-3 space-y-0.5 border-l border-border pl-2">
                    {sec.subs.map((sub) => (
                      <li key={sub.id}>
                        <a
                          href={`#${sub.id}`}
                          className="block py-1 px-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                        >
                          {sub.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="container max-w-3xl py-8 px-4 lg:px-8">
          <nav className="mb-6 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">
              Data Talks
            </Link>
            <span className="mx-2">/</span>
            <span className="text-foreground font-medium">{t("doc.title")}</span>
          </nav>
          <header className="mb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">{t("doc.title")}</h1>
            </div>
            <p className="text-muted-foreground text-lg max-w-2xl mb-4">{t("doc.subtitle")}</p>
            {/* Search on mobile (sidebar hidden) */}
            <div className="relative lg:hidden max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t("doc.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9 h-10"
                aria-label={t("doc.searchPlaceholder")}
              />
            </div>
          </header>

          <div className="space-y-8">
            {/* Data sources */}
            <DocSection
              id="data-sources"
              title={isPt ? "Fontes de dados" : "Data sources"}
              description={isPt ? "Como conectar e gerenciar suas fontes de dados." : "How to connect and manage your data sources."}
              icon={Server}
            >
              <DocSubsection
                id="data-sources-add"
                title={isPt ? "Adicionar e vincular fontes" : "Adding and linking sources"}
              >
                <p>
                  {isPt
                    ? "No workspace, o usuário abre o modal de fontes e adiciona uma fonte: upload de arquivo (CSV/XLSX) ou preenchimento de credenciais (BigQuery, Google Sheets, SQL). O backend expõe POST /api/sources/upload para arquivos e POST /api/sources para fontes com type e metadata. Cada fonte é salva com user_id; em seguida, PATCH /api/sources/{id} com agent_id e is_active vincula a fonte ao agente do workspace."
                    : "In the workspace, the user opens the source modal and adds a source: file upload (CSV/XLSX) or entering credentials (BigQuery, Google Sheets, SQL). The backend exposes POST /api/sources/upload for files and POST /api/sources for sources with type and metadata. Each source is saved with user_id; then PATCH /api/sources/{id} with agent_id and is_active links the source to the workspace agent."}
                </p>
              </DocSubsection>
              <DocSubsection
                id="data-sources-types"
                title={isPt ? "Tipos de fonte" : "Source types"}
              >
                <p>
                  {isPt
                    ? "O Data Talks suporta: CSV e XLSX (arquivos locais), BigQuery (credenciais e metadados no backend), Google Sheets (ID da planilha e aba), e SQL (connection string e informações de tabela). O backend roteia cada pergunta conforme o type da fonte ativa para o script correspondente."
                    : "Data Talks supports: CSV and XLSX (local files), BigQuery (credentials and metadata on the backend), Google Sheets (spreadsheet ID and sheet name), and SQL (connection string and table info). The backend routes each question by the active source type to the corresponding script."}
                </p>
              </DocSubsection>
            </DocSection>

            {/* Asking questions */}
            <DocSection
              id="asking-questions"
              title={isPt ? "Perguntas" : "Asking questions"}
              description={isPt ? "Como as perguntas são enviadas e processadas." : "How questions are sent and processed."}
              icon={Server}
            >
              <p className="text-sm text-muted-foreground">
                {isPt
                  ? "O usuário digita a pergunta no workspace. O frontend chama POST /api/ask-question com { question, agentId, sessionId? }. O backend carrega o agente e as fontes (por source_ids no agente ou agent_id na tabela sources), usa a primeira fonte ativa e, conforme o type (csv, xlsx, bigquery, google_sheets, sql_database), chama o script correspondente com a pergunta, a descrição do agente e os metadados da fonte."
                  : "The user types the question in the workspace. The frontend calls POST /api/ask-question with { question, agentId, sessionId? }. The backend loads the agent and sources (by agent.source_ids or source.agent_id), uses the first active source, and according to type (csv, xlsx, bigquery, google_sheets, sql_database) calls the corresponding script with the question, agent description, and source metadata."}
              </p>
            </DocSection>

            {/* Answers & sessions */}
            <DocSection
              id="answers-sessions"
              title={isPt ? "Respostas e sessões" : "Answers & sessions"}
              description={isPt ? "Como o LLM gera respostas e como as sessões são guardadas." : "How the LLM generates answers and how sessions are stored."}
              icon={Save}
            >
              <p className="text-sm text-muted-foreground">
                {isPt
                  ? "Cada script monta o contexto (schema, amostra de dados, etc.) e envia ao modelo (OpenAI, Ollama ou LiteLLM), que devolve answer, followUpQuestions e opcionalmente imageUrl. O backend cria ou atualiza a QASession (conversation_history, follow_up_questions) e retorna AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions). O frontend atualiza o chat e o histórico; as follow-ups aparecem como sugestões."
                  : "Each script builds the context (schema, sample data, etc.) and sends it to the model (OpenAI, Ollama, or LiteLLM), which returns answer, followUpQuestions, and optionally imageUrl. The backend creates or updates the QASession (conversation_history, follow_up_questions) and returns AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions). The frontend updates the chat and history; follow-ups appear as suggestions."}
              </p>
            </DocSection>

            {/* CSV / XLSX */}
            <DocSection
              id="csv-xlsx"
              title="CSV / XLSX"
              description={isPt ? "Arquivos enviados e armazenados localmente." : "Files uploaded and stored locally."}
              icon={FileSpreadsheet}
            >
              <DocSubsection id="csv-xlsx-storage" title={isPt ? "Upload e armazenamento" : "Upload & storage"}>
                <p>
                  {isPt
                    ? "O arquivo é enviado via FormData para POST /api/sources/upload e gravado em data_files/{user_id}/{uuid}.csv (ou .xlsx). O backend usa Pandas para extrair colunas e uma prévia de 5 linhas; os metadados (file_path, columns, preview_rows, row_count) são guardados em Source.metadata."
                    : "The file is sent via FormData to POST /api/sources/upload and written to data_files/{user_id}/{uuid}.csv (or .xlsx). The backend uses Pandas to extract columns and a 5-row preview; metadata (file_path, columns, preview_rows, row_count) is stored in Source.metadata."}
                </p>
              </DocSubsection>
              <DocSubsection id="csv-xlsx-context" title={isPt ? "Contexto para o LLM" : "Context for the LLM"}>
                <p>
                  {isPt
                    ? "Ao responder uma pergunta, o backend chama ask_csv(file_path, question, agent_description, columns, preview_rows, data_files_dir), com caminho relativo a data_files e metadados da fonte. O script monta o schema (colunas) e uma amostra (até 10 linhas), usa um system prompt de assistente de dados tabulares e user prompt com schema + amostra + pergunta. A resposta pode incluir follow-up questions (linhas terminando em '?')."
                    : "When answering a question, the backend calls ask_csv(file_path, question, agent_description, columns, preview_rows, data_files_dir), with path relative to data_files and source metadata. The script builds the schema (columns) and a sample (up to 10 rows), uses a tabular data assistant system prompt and user prompt with schema + sample + question. The answer may include follow-up questions (lines ending with '?')."}
                </p>
                <code className="block rounded bg-muted p-2 text-xs mt-2">
                  ask_csv(file_path, question, agent_description, columns, preview_rows, data_files_dir)
                </code>
              </DocSubsection>
            </DocSection>

            {/* BigQuery */}
            <DocSection
              id="bigquery"
              title="BigQuery"
              description={isPt ? "Credenciais e metadados armazenados localmente." : "Credentials and metadata stored locally."}
              icon={Database}
            >
              <DocSubsection id="bigquery-config" title={isPt ? "Configuração e armazenamento" : "Configuration & storage"}>
                <p>
                  {isPt
                    ? "O usuário envia o JSON de credenciais (ou escolhe um existente), informa Project ID, Dataset ID e tabelas (lista ou texto separado por vírgula). POST /api/sources com type: bigquery e metadata: { credentialsContent, projectId, datasetId, tables }. A fonte é criada no banco com type=bigquery; os metadados ficam apenas no backend — nada é enviado à nuvem além do que o backend usa nas consultas."
                    : "The user uploads the credentials JSON (or selects an existing one), enters Project ID, Dataset ID, and tables (list or comma-separated). POST /api/sources with type: bigquery and metadata: { credentialsContent, projectId, datasetId, tables }. The source is created in the DB with type=bigquery; metadata stays on the backend only — nothing is sent to the cloud except what the backend uses for queries."}
                </p>
              </DocSubsection>
              <DocSubsection id="bigquery-context" title={isPt ? "Contexto para o LLM" : "Context for the LLM"}>
                <p>
                  {isPt
                    ? "O backend chama ask_bigquery(credentials_content, project_id, dataset_id, tables, question, agent_description, table_infos) com dados do Source.metadata. O script monta o schema (project, dataset, tabelas; se houver table_infos, inclui colunas por tabela), usa um system prompt de assistente BigQuery (pode sugerir SQL SELECT) e user prompt com schema + pergunta. Resposta e follow-ups no mesmo formato das outras fontes."
                    : "The backend calls ask_bigquery(credentials_content, project_id, dataset_id, tables, question, agent_description, table_infos) with data from Source.metadata. The script builds the schema (project, dataset, tables; if table_infos is present, includes columns per table), uses a BigQuery assistant system prompt (may suggest SELECT SQL) and user prompt with schema + question. Answer and follow-ups in the same format as other sources."}
                </p>
                <code className="block rounded bg-muted p-2 text-xs mt-2">
                  ask_bigquery(..., question, agent_description, table_infos)
                </code>
              </DocSubsection>
            </DocSection>

            {/* Google Sheets */}
            <DocSection
              id="google-sheets"
              title="Google Sheets"
              description={isPt ? "Spreadsheet ID e nome da aba no metadata." : "Spreadsheet ID and sheet name in metadata."}
              icon={Sheet}
            >
              <DocSubsection id="google-sheets-config" title={isPt ? "Configuração" : "Configuration"}>
                <p>
                  {isPt
                    ? "O usuário informa o ID da planilha e o nome da aba. POST /api/sources com type: google_sheets e metadata: { spreadsheetId, sheetName }. A fonte é salva no banco; o metadata guarda apenas esses identificadores. As credenciais do Google (conta de serviço) vêm da variável de ambiente no backend."
                    : "The user enters the spreadsheet ID and sheet name. POST /api/sources with type: google_sheets and metadata: { spreadsheetId, sheetName }. The source is stored in the DB; metadata only holds these identifiers. Google (service account) credentials come from the backend environment variable."}
                </p>
              </DocSubsection>
              <DocSubsection id="google-sheets-context" title={isPt ? "Contexto para o LLM" : "Context for the LLM"}>
                <p>
                  {isPt
                    ? "O backend chama ask_google_sheets(spreadsheet_id, sheet_name, question, agent_description); os IDs vêm do metadata e as credenciais de GOOGLE_SHEETS_SERVICE_ACCOUNT. O contexto enviado ao LLM inclui spreadsheet_id e sheet_name; a amostra de dados pode ser obtida via API Google (quando implementado). Atualmente o prompt usa o contexto básico; system prompt de assistente de planilhas e user prompt com contexto + pergunta."
                    : "The backend calls ask_google_sheets(spreadsheet_id, sheet_name, question, agent_description); IDs come from metadata and credentials from GOOGLE_SHEETS_SERVICE_ACCOUNT. The context sent to the LLM includes spreadsheet_id and sheet_name; sample data can be fetched via Google API (when implemented). Currently the prompt uses basic context; system prompt is a sheets assistant and user prompt is context + question."}
                </p>
                <code className="block rounded bg-muted p-2 text-xs mt-2">
                  ask_google_sheets(spreadsheet_id, sheet_name, question, agent_description)
                </code>
              </DocSubsection>
            </DocSection>

            {/* SQL Database */}
            <DocSection
              id="sql-database"
              title="SQL Database"
              description={isPt ? "Connection string e informações de tabela no metadata." : "Connection string and table info in metadata."}
              icon={Database}
            >
              <DocSubsection id="sql-config" title={isPt ? "Configuração" : "Configuration"}>
                <p>
                  {isPt
                    ? "O usuário informa a connection string, o tipo (postgresql/mysql) e o nome da tabela. POST /api/sources com type: sql_database e metadata: { connectionString, table_infos: [{ table, columns? }] }. A fonte é salva no banco; o metadata guarda connectionString e table_infos para o contexto do LLM. As credenciais ficam apenas no backend."
                    : "The user enters the connection string, type (postgresql/mysql), and table name. POST /api/sources with type: sql_database and metadata: { connectionString, table_infos: [{ table, columns? }] }. The source is stored in the DB; metadata holds connectionString and table_infos for LLM context. Credentials stay on the backend only."}
                </p>
              </DocSubsection>
              <DocSubsection id="sql-context" title={isPt ? "Contexto para o LLM" : "Context for the LLM"}>
                <p>
                  {isPt
                    ? "O backend chama ask_sql(connection_string, question, agent_description, table_infos) com dados do Source.metadata. O script monta o schema a partir de table_infos (tabela + colunas), usa um system prompt de assistente SQL (pode sugerir queries SELECT) e user prompt com schema + pergunta. O LLM não executa SQL automaticamente; sugere quando apropriado. Resposta e follow-ups no mesmo formato das outras fontes."
                    : "The backend calls ask_sql(connection_string, question, agent_description, table_infos) with data from Source.metadata. The script builds the schema from table_infos (table + columns), uses a SQL assistant system prompt (may suggest SELECT queries) and user prompt with schema + question. The LLM does not execute SQL automatically; it suggests when appropriate. Answer and follow-ups in the same format as other sources."}
                </p>
                <code className="block rounded bg-muted p-2 text-xs mt-2">
                  ask_sql(connection_string, question, agent_description, table_infos)
                </code>
              </DocSubsection>
            </DocSection>
          </div>
        </div>
      </div>
    </div>
  );
}
