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
      id: "overview",
      title: isPt ? "Visão geral" : "Overview",
      subs: [
        { id: "overview-1", title: isPt ? "Frontend: adicionar fonte" : "Frontend: add source" },
        { id: "overview-2", title: isPt ? "API: criar fonte e vincular ao agente" : "API: create source and link to agent" },
        { id: "overview-3", title: isPt ? "Frontend: usuário envia pergunta" : "Frontend: user sends question" },
        { id: "overview-4", title: isPt ? "Backend: carregar agente e fontes" : "Backend: load agent and sources" },
        { id: "overview-5", title: isPt ? "Backend: rotear por tipo de fonte" : "Backend: route by source type" },
        { id: "overview-6", title: isPt ? "LLM: gerar resposta" : "LLM: generate answer" },
        { id: "overview-7", title: isPt ? "Backend: salvar sessão e retornar" : "Backend: save session and return" },
      ],
    },
    {
      id: "csv-xlsx",
      title: "CSV / XLSX",
      subs: [
        { id: "csv-1", title: isPt ? "Upload no frontend" : "Upload on frontend" },
        { id: "csv-2", title: isPt ? "Backend: salvar arquivo" : "Backend: save file" },
        { id: "csv-3", title: isPt ? "Pergunta: roteamento" : "Question: routing" },
        { id: "csv-4", title: isPt ? "Script CSV: contexto para o LLM" : "Script CSV: context for LLM" },
        { id: "csv-5", title: isPt ? "Retorno" : "Return" },
      ],
    },
    {
      id: "bigquery",
      title: "BigQuery",
      subs: [
        { id: "bq-1", title: isPt ? "Configuração no frontend" : "Frontend setup" },
        { id: "bq-2", title: isPt ? "Armazenamento" : "Storage" },
        { id: "bq-3", title: isPt ? "Pergunta: roteamento" : "Question: routing" },
        { id: "bq-4", title: isPt ? "Script BigQuery: contexto para o LLM" : "Script BigQuery: context for LLM" },
        { id: "bq-5", title: isPt ? "Retorno" : "Return" },
      ],
    },
    {
      id: "google-sheets",
      title: "Google Sheets",
      subs: [
        { id: "gs-1", title: isPt ? "Configuração no frontend" : "Frontend setup" },
        { id: "gs-2", title: isPt ? "Armazenamento" : "Storage" },
        { id: "gs-3", title: isPt ? "Pergunta: roteamento" : "Question: routing" },
        { id: "gs-4", title: isPt ? "Script Google Sheets: contexto para o LLM" : "Script Google Sheets: context for LLM" },
        { id: "gs-5", title: isPt ? "Retorno" : "Return" },
      ],
    },
    {
      id: "sql-database",
      title: "SQL Database",
      subs: [
        { id: "sql-1", title: isPt ? "Configuração no frontend" : "Frontend setup" },
        { id: "sql-2", title: isPt ? "Armazenamento" : "Storage" },
        { id: "sql-3", title: isPt ? "Pergunta: roteamento" : "Question: routing" },
        { id: "sql-4", title: isPt ? "Script SQL: contexto para o LLM" : "Script SQL: context for LLM" },
        { id: "sql-5", title: isPt ? "Retorno" : "Return" },
      ],
    },
    {
      id: "common",
      title: isPt ? "Comum a todos os tipos" : "Common to all types",
      subs: [],
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

function Step({
  id,
  num,
  title,
  children,
  icon: Icon,
}: {
  id: string;
  num: number;
  title: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div id={id} className="flex gap-4 scroll-mt-24">
      <div className="flex flex-col items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background">
          {Icon ? <Icon className="h-5 w-5 text-primary" /> : <span className="text-sm font-bold">{num}</span>}
        </div>
        {num < 99 && <div className="mt-1 h-full w-0.5 flex-1 bg-border" />}
      </div>
      <div className="pb-8">
        <h3 className="font-semibold text-base">{title}</h3>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
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
            {/* Overview */}
            <DocSection
              id="overview"
              title={isPt ? "Visão geral" : "Overview"}
              description={isPt ? "Fluxo único até o roteamento por tipo de fonte." : "Single flow until routing by source type."}
              icon={Server}
            >
              <div className="space-y-0">
                <Step id="overview-1" num={1} title={isPt ? "Frontend: adicionar fonte" : "Frontend: add source"}>
            {isPt
              ? "Usuário abre o modal de fontes no workspace, faz upload (CSV/XLSX) ou preenche credenciais (BigQuery, Sheets, SQL)."
              : "User opens the source modal in the workspace, uploads a file (CSV/XLSX) or enters credentials (BigQuery, Sheets, SQL)."}
                </Step>
                <Step id="overview-2" num={2} title={isPt ? "API: criar fonte e vincular ao agente" : "API: create source and link to agent"}>
                  {isPt
                    ? "POST /api/sources/upload (arquivo) ou POST /api/sources (body: name, type, metadata). A fonte é salva no banco com user_id. Em seguida PATCH /api/sources/{id} com agent_id e is_active para vincular ao workspace."
                    : "POST /api/sources/upload (file) or POST /api/sources (body: name, type, metadata). Source is saved in DB with user_id. Then PATCH /api/sources/{id} with agent_id and is_active to link to the workspace."}
                </Step>
                <Step id="overview-3" num={3} title={isPt ? "Frontend: usuário envia pergunta" : "Frontend: user sends question"}>
                  {isPt
                    ? "No workspace, o usuário digita a pergunta. O frontend chama POST /api/ask-question com { question, agentId, sessionId? }."
                    : "In the workspace, the user types the question. The frontend calls POST /api/ask-question with { question, agentId, sessionId? }."}
                </Step>
                <Step id="overview-4" num={4} title={isPt ? "Backend: carregar agente e fontes" : "Backend: load agent and sources"}>
                  {isPt
                    ? "O endpoint carrega o Agent pelo agentId e as fontes: por source_ids no agente ou por agent_id na tabela sources. Usa a primeira fonte (ativa) para responder."
                    : "The endpoint loads the Agent by agentId and sources: either by agent.source_ids or by source.agent_id. It uses the first (active) source to answer."}
                </Step>
                <Step id="overview-5" num={5} title={isPt ? "Backend: rotear por tipo de fonte" : "Backend: route by source type"}>
                  {isPt
                    ? "Conforme source.type (csv, xlsx, google_sheets, sql_database, bigquery), chama o script correspondente passando pergunta, descrição do agente e metadados da fonte."
                    : "According to source.type (csv, xlsx, google_sheets, sql_database, bigquery), it calls the corresponding script with question, agent description, and source metadata."}
                </Step>
                <Step id="overview-6" num={6} title={isPt ? "LLM: gerar resposta" : "LLM: generate answer"}>
                  {isPt
                    ? "Cada script monta o contexto (schema, amostra de dados, etc.), envia para o modelo (OpenAI/Ollama) e devolve answer, followUpQuestions e opcionalmente imageUrl."
                    : "Each script builds the context (schema, sample data, etc.), sends it to the model (OpenAI/Ollama), and returns answer, followUpQuestions, and optionally imageUrl."}
                </Step>
                <Step id="overview-7" num={7} title={isPt ? "Backend: salvar sessão e retornar" : "Backend: save session and return"}>
                  {isPt
                    ? "Cria ou atualiza QASession (conversation_history, follow_up_questions). Commit no banco. Retorna AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions)."
                    : "Creates or updates QASession (conversation_history, follow_up_questions). Commits to DB. Returns AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions)."}
                </Step>
              </div>
            </DocSection>

            {/* CSV / XLSX */}
            <DocSection
              id="csv-xlsx"
              title="CSV / XLSX"
              description={isPt ? "Arquivos enviados e armazenados localmente." : "Files uploaded and stored locally."}
              icon={FileSpreadsheet}
            >
              <div className="space-y-0">
                <Step id="csv-1" num={1} title={isPt ? "Upload no frontend" : "Upload on frontend"}>
            {isPt ? "Arquivo enviado via FormData para POST /api/sources/upload." : "File sent via FormData to POST /api/sources/upload."}
                </Step>
                <Step id="csv-2" num={2} title={isPt ? "Backend: salvar arquivo" : "Backend: save file"}>
                  {isPt
                    ? "Arquivo gravado em data_files/{user_id}/{uuid}.csv (ou .xlsx). Pandas lê para extrair columns e preview (5 linhas). Metadados guardados em Source.metadata (file_path, columns, preview_rows, row_count)."
                    : "File written to data_files/{user_id}/{uuid}.csv (or .xlsx). Pandas reads to extract columns and preview (5 rows). Metadata stored in Source.metadata (file_path, columns, preview_rows, row_count)."}
                </Step>
                <Step id="csv-3" num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
                  <code className="rounded bg-muted px-1">ask_csv(file_path, question, agent_description, columns, preview_rows, data_files_dir)</code>
                  {isPt ? " — caminho relativo a data_files; colunas e preview vêm do metadata da fonte." : " — path relative to data_files; columns and preview from source metadata."}
                </Step>
                <Step id="csv-4" num={4} title={isPt ? "Script CSV: contexto para o LLM" : "Script CSV: context for LLM"}>
                  {isPt
                    ? "Monta schema (colunas) e amostra (até 10 linhas). System prompt: assistente de dados tabulares; User prompt: schema + sample + pergunta. Resposta pode incluir linhas com '?' como follow-up."
                    : "Builds schema (columns) and sample (up to 10 rows). System prompt: tabular data assistant; User prompt: schema + sample + question. Answer may include lines ending with '?' as follow-ups."}
                </Step>
                <Step id="csv-5" num={5} title={isPt ? "Retorno" : "Return"}>
                  {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
                </Step>
              </div>
            </DocSection>

            {/* BigQuery */}
            <DocSection
              id="bigquery"
              title="BigQuery"
              description={isPt ? "Credenciais e metadados armazenados localmente." : "Credentials and metadata stored locally."}
              icon={Database}
            >
              <div className="space-y-0">
                <Step id="bq-1" num={1} title={isPt ? "Configuração no frontend" : "Frontend setup"}>
            {isPt
              ? "Usuário envia JSON de credenciais (ou escolhe existente), informa Project ID, Dataset ID e tabelas (lista ou texto separado por vírgula). POST /api/sources com type: bigquery e metadata: { credentialsContent, projectId, datasetId, tables }."
                  : "User uploads credentials JSON (or selects existing), enters Project ID, Dataset ID, and tables (list or comma-separated). POST /api/sources with type: bigquery and metadata: { credentialsContent, projectId, datasetId, tables }."}
                </Step>
                <Step id="bq-2" num={2} title={isPt ? "Armazenamento" : "Storage"}>
                  {isPt ? "Source criada no banco com type=bigquery; metadata guarda credentialsContent (JSON string), projectId, datasetId, tables. Nada é enviado à nuvem além do que o backend usar para consultas." : "Source created in DB with type=bigquery; metadata holds credentialsContent (JSON string), projectId, datasetId, tables. Nothing is sent to the cloud except what the backend uses for queries."}
                </Step>
                <Step id="bq-3" num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
                  <code className="rounded bg-muted px-1">ask_bigquery(credentials_content, project_id, dataset_id, tables, question, agent_description, table_infos)</code>
                  {isPt ? " — metadados vêm do Source.metadata." : " — metadata from Source.metadata."}
                </Step>
                <Step id="bq-4" num={4} title={isPt ? "Script BigQuery: contexto para o LLM" : "Script BigQuery: context for LLM"}>
                  {isPt
                    ? "Schema: project, dataset, tables; se houver table_infos, adiciona colunas por tabela. System: assistente BigQuery, pode sugerir SQL (SELECT). User: schema + pergunta. Resposta e follow-ups como nas outras fontes."
                    : "Schema: project, dataset, tables; if table_infos present, adds columns per table. System: BigQuery assistant, may suggest SQL (SELECT). User: schema + question. Answer and follow-ups as in other sources."}
                </Step>
                <Step id="bq-5" num={5} title={isPt ? "Retorno" : "Return"}>
                  {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
                </Step>
              </div>
            </DocSection>

            {/* Google Sheets */}
            <DocSection
              id="google-sheets"
              title="Google Sheets"
              description={isPt ? "Spreadsheet ID e nome da aba no metadata." : "Spreadsheet ID and sheet name in metadata."}
              icon={Sheet}
            >
              <div className="space-y-0">
<Step id="gs-1" num={1} title={isPt ? "Configuração no frontend" : "Frontend setup"}>
                  {isPt
                    ? "Usuário informa ID da planilha e nome da aba. POST /api/sources com type: google_sheets e metadata: { spreadsheetId, sheetName }."
                    : "User enters spreadsheet ID and sheet name. POST /api/sources with type: google_sheets and metadata: { spreadsheetId, sheetName }."}
                </Step>
                <Step id="gs-2" num={2} title={isPt ? "Armazenamento" : "Storage"}>
                  {isPt ? "Source no banco com type=google_sheets; metadata guarda apenas spreadsheetId e sheetName. Credenciais do Google (serviço) vêm de variável de ambiente no backend." : "Source in DB with type=google_sheets; metadata only stores spreadsheetId and sheetName. Google (service) credentials come from backend env."}
                </Step>
                <Step id="gs-3" num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
                  <code className="rounded bg-muted px-1">ask_google_sheets(spreadsheet_id, sheet_name, question, agent_description)</code>
                  {isPt ? " — IDs vêm do metadata; credenciais de GOOGLE_SHEETS_SERVICE_ACCOUNT." : " — IDs from metadata; credentials from GOOGLE_SHEETS_SERVICE_ACCOUNT."}
                </Step>
                <Step id="gs-4" num={4} title={isPt ? "Script Google Sheets: contexto para o LLM" : "Script Google Sheets: context for LLM"}>
                  {isPt
                    ? "Contexto: spreadsheet_id e sheet_name; amostra pode ser obtida via API Google (quando implementado). Hoje o prompt usa apenas o contexto básico. System: assistente de planilhas; User: contexto + pergunta."
                    : "Context: spreadsheet_id and sheet_name; sample can be fetched via Google API (when implemented). Currently the prompt uses only basic context. System: sheets assistant; User: context + question."}
                </Step>
                <Step id="gs-5" num={5} title={isPt ? "Retorno" : "Return"}>
                  {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
                </Step>
              </div>
            </DocSection>

            {/* SQL Database */}
            <DocSection
              id="sql-database"
              title="SQL Database"
              description={isPt ? "Connection string e informações de tabela no metadata." : "Connection string and table info in metadata."}
              icon={Database}
            >
              <div className="space-y-0">
                <Step id="sql-1" num={1} title={isPt ? "Configuração no frontend" : "Frontend setup"}>
                  {isPt
                    ? "Usuário informa connection string, tipo (postgresql/mysql) e nome da tabela. POST /api/sources com type: sql_database e metadata: { connectionString, table_infos: [{ table, columns? }] }."
                    : "User enters connection string, type (postgresql/mysql), and table name. POST /api/sources with type: sql_database and metadata: { connectionString, table_infos: [{ table, columns? }] }."}
                </Step>
                <Step id="sql-2" num={2} title={isPt ? "Armazenamento" : "Storage"}>
                  {isPt ? "Source no banco com type=sql_database; metadata guarda connectionString e table_infos (para contexto do LLM). Credenciais ficam apenas no backend." : "Source in DB with type=sql_database; metadata holds connectionString and table_infos (for LLM context). Credentials stay on backend only."}
                </Step>
                <Step id="sql-3" num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
                  <code className="rounded bg-muted px-1">ask_sql(connection_string, question, agent_description, table_infos)</code>
                  {isPt ? " — connection_string e table_infos do Source.metadata." : " — connection_string and table_infos from Source.metadata."}
                </Step>
                <Step id="sql-4" num={4} title={isPt ? "Script SQL: contexto para o LLM" : "Script SQL: context for LLM"}>
                  {isPt
                    ? "Schema montado a partir de table_infos (tabela + colunas). System: assistente SQL, pode sugerir queries (SELECT). User: schema + pergunta. Não executa SQL automaticamente; o LLM sugere quando apropriado."
                    : "Schema built from table_infos (table + columns). System: SQL assistant, may suggest queries (SELECT). User: schema + question. Does not execute SQL automatically; LLM suggests when appropriate."}
                </Step>
                <Step id="sql-5" num={5} title={isPt ? "Retorno" : "Return"}>
                  {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
                </Step>
              </div>
            </DocSection>

            {/* Common: after answer */}
            <section id="common" className="scroll-mt-24">
              <Card className="border-dashed">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                      <Save className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight">{isPt ? "Comum a todos os tipos" : "Common to all types"}</h2>
                      <CardDescription>{isPt ? "Após o script retornar a resposta." : "After the script returns the answer."}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    <li>{isPt ? "Backend cria ou atualiza QASession (agent_id, source_id, question, answer, conversation_history, follow_up_questions)." : "Backend creates or updates QASession (agent_id, source_id, question, answer, conversation_history, follow_up_questions)."}
                    </li>
                    <li>{isPt ? "Resposta enviada ao frontend (answer, sessionId, followUpQuestions, imageUrl opcional)." : "Response sent to frontend (answer, sessionId, followUpQuestions, optional imageUrl)."}
                    </li>
                    <li>{isPt ? "Frontend atualiza o chat e o histórico; follow-ups aparecem como sugestões." : "Frontend updates chat and history; follow-ups appear as suggestions."}
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
