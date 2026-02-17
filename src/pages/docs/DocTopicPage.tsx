import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { Bot, Database, FileSpreadsheet, FileText, Save, Server, Sheet } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { isDocTopicId } from "./docStructure";

function DocSubsection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 mb-6">
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      <div className="text-sm text-muted-foreground space-y-2">{children}</div>
    </div>
  );
}

function DocSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
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
  );
}

export default function DocTopicPage() {
  const { topic } = useParams<{ topic: string }>();
  const { language } = useLanguage();
  const isPt = language === "pt";

  if (!topic || !isDocTopicId(topic)) {
    return <Navigate to="/flows/data-sources" replace />;
  }

  const content = getTopicContent(topic, isPt);

  return (
    <div className="container max-w-3xl py-8 px-4 lg:px-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground transition-colors">
          Data Talks
        </Link>
        <span className="mx-2">/</span>
        <Link to="/flows/data-sources" className="hover:text-foreground transition-colors">
          Docs
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">{content.title}</span>
      </nav>
      {content.node}
    </div>
  );
}

function getTopicContent(topic: string, isPt: boolean) {
  switch (topic) {
    case "data-sources":
      return {
        title: isPt ? "Fontes de dados" : "Data sources",
        node: (
          <DocSection
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
            <DocSubsection id="data-sources-types" title={isPt ? "Tipos de fonte" : "Source types"}>
              <p>
                {isPt
                  ? "O Data Talks suporta: CSV e XLSX (arquivos locais), BigQuery (credenciais e metadados no backend), Google Sheets (ID da planilha e aba), e SQL (connection string e informações de tabela). O backend roteia cada pergunta conforme o type da fonte ativa para o script correspondente."
                  : "Data Talks supports: CSV and XLSX (local files), BigQuery (credentials and metadata on the backend), Google Sheets (spreadsheet ID and sheet name), and SQL (connection string and table info). The backend routes each question by the active source type to the corresponding script."}
              </p>
            </DocSubsection>
          </DocSection>
        ),
      };

    case "asking-questions":
      return {
        title: isPt ? "Perguntas" : "Asking questions",
        node: (
          <DocSection
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
        ),
      };

    case "answers-sessions":
      return {
        title: isPt ? "Respostas e sessões" : "Answers & sessions",
        node: (
          <DocSection
            title={isPt ? "Respostas e sessões" : "Answers & sessions"}
            description={isPt ? "Como o LLM gera respostas e como as sessões são guardadas." : "How the LLM generates answers and how sessions are stored."}
            icon={Save}
          >
            <p className="text-sm text-muted-foreground">
              {isPt
                ? "Cada script monta o contexto (schema, amostra de dados, etc.) e envia ao modelo. O provedor e o modelo são definidos pela configuração do usuário (Conta → LLM) ou por um LlmConfig vinculado ao agente (llm_config_id). Suporta OpenAI, Ollama e LiteLLM. O modelo devolve answer, followUpQuestions e opcionalmente imageUrl. O backend cria ou atualiza a QASession (conversation_history, follow_up_questions) e retorna AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions). O frontend atualiza o chat e o histórico; as follow-ups aparecem como sugestões."
                : "Each script builds the context (schema, sample data, etc.) and sends it to the model. The provider and model are determined by the user's settings (Account → LLM) or by an LlmConfig linked to the agent (llm_config_id). Supports OpenAI, Ollama, and LiteLLM. The model returns answer, followUpQuestions, and optionally imageUrl. The backend creates or updates the QASession (conversation_history, follow_up_questions) and returns AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions). The frontend updates the chat and history; follow-ups appear as suggestions."}
            </p>
          </DocSection>
        ),
      };

    case "llm-configuration":
      return {
        title: isPt ? "Configuração do LLM" : "LLM configuration",
        node: (
          <DocSection
            title={isPt ? "Configuração do LLM" : "LLM configuration"}
            description={isPt ? "Provedores de modelo e configuração por usuário ou por agente." : "Model providers and per-user or per-agent configuration."}
            icon={Bot}
          >
            <DocSubsection id="llm-providers" title={isPt ? "Provedores (OpenAI, Ollama, LiteLLM)" : "Providers (OpenAI, Ollama, LiteLLM)"}>
              <p>
                {isPt
                  ? "O Data Talks suporta três provedores: OpenAI (API key e modelo, ex. gpt-4o-mini), Ollama (URL base e modelo local, ex. llama3.2) e LiteLLM (URL do proxy OpenAI-compatível, modelo e opcional API key). Os valores padrão vêm das variáveis de ambiente (OPENAI_API_KEY, OLLAMA_BASE_URL, LITELLM_BASE_URL, etc.). O usuário pode sobrescrever em Conta → LLM; as configurações salvas em llm_settings têm prioridade sobre o env."
                  : "Data Talks supports three providers: OpenAI (API key and model, e.g. gpt-4o-mini), Ollama (base URL and local model, e.g. llama3.2), and LiteLLM (proxy URL, model, and optional API key). Defaults come from environment variables (OPENAI_API_KEY, OLLAMA_BASE_URL, LITELLM_BASE_URL, etc.). The user can override in Account → LLM; saved llm_settings take precedence over env."}
              </p>
            </DocSubsection>
            <DocSubsection id="llm-settings-api" title={isPt ? "API de configuração" : "Settings API"}>
              <p>
                {isPt
                  ? "GET /api/settings/llm retorna a configuração atual (chaves mascaradas). PATCH /api/settings/llm atualiza llm_provider, openai_api_key, openai_model, ollama_base_url, ollama_model, litellm_base_url, litellm_model, litellm_api_key. Opcionalmente, um agente pode usar uma configuração específica (llm_config_id) em vez da configuração padrão do usuário; os LlmConfigs são gerenciados via API de configurações."
                  : "GET /api/settings/llm returns the current configuration (keys masked). PATCH /api/settings/llm updates llm_provider, openai_api_key, openai_model, ollama_base_url, ollama_model, litellm_base_url, litellm_model, litellm_api_key. Optionally, an agent can use a specific config (llm_config_id) instead of the user's default; LlmConfigs are managed via the settings API."}
              </p>
              <code className="block rounded bg-muted p-2 text-xs mt-2">
                GET /api/settings/llm · PATCH /api/settings/llm
              </code>
            </DocSubsection>
          </DocSection>
        ),
      };

    case "table-summaries":
      return {
        title: isPt ? "Resumos de tabela (Studio)" : "Table summaries (Studio)",
        node: (
          <DocSection
            title={isPt ? "Resumos de tabela (Studio)" : "Table summaries (Studio)"}
            description={isPt ? "Relatórios executivos gerados por LLM a partir da fonte de dados." : "Executive reports generated by the LLM from the data source."}
            icon={FileText}
          >
            <DocSubsection id="table-summaries-generate" title={isPt ? "Gerar resumo" : "Generate summary"}>
              <p>
                {isPt
                  ? "No Studio do workspace, o usuário pode abrir o modal de Resumo da Tabela, escolher uma fonte (do workspace) e gerar um resumo. O backend chama o script de summary correspondente ao tipo da fonte (CSV/XLSX, BigQuery, SQL, Google Sheets). O script usa o LLM (com as mesmas overrides do usuário) e, quando aplicável, executa consultas analíticas para obter estatísticas; o resultado é um relatório em markdown (report) e opcionalmente uma lista de queries_run. O resumo é salvo em table_summaries e exibido no modal."
                  : "In the workspace Studio, the user can open the Table Summary modal, select a source (from the workspace), and generate a summary. The backend calls the summary script for the source type (CSV/XLSX, BigQuery, SQL, Google Sheets). The script uses the LLM (with the same user overrides) and, when applicable, runs analytical queries to get statistics; the result is a markdown report and optionally a list of queries_run. The summary is stored in table_summaries and shown in the modal."}
              </p>
            </DocSubsection>
            <DocSubsection id="table-summaries-api" title={isPt ? "API" : "API"}>
              <p>
                {isPt
                  ? "POST /api/table_summaries com { agentId, sourceId? } gera um novo resumo (sourceId opcional; se omitido, usa a fonte ativa do agente). GET /api/table_summaries?agent_id=... lista resumos do workspace. GET /api/table_summaries/{id} retorna um resumo. DELETE /api/table_summaries/{id} remove o resumo. A resposta de geração inclui id, agentId, sourceId, sourceName, report, queriesRun, createdAt."
                  : "POST /api/table_summaries with { agentId, sourceId? } generates a new summary (sourceId optional; if omitted, uses the agent's active source). GET /api/table_summaries?agent_id=... lists summaries for the workspace. GET /api/table_summaries/{id} returns one summary. DELETE /api/table_summaries/{id} removes it. The generate response includes id, agentId, sourceId, sourceName, report, queriesRun, createdAt."}
              </p>
              <code className="block rounded bg-muted p-2 text-xs mt-2">
                POST /api/table_summaries · GET /api/table_summaries · GET/DELETE /api/table_summaries/{id}
              </code>
            </DocSubsection>
          </DocSection>
        ),
      };

    case "csv-xlsx":
      return {
        title: "CSV / XLSX",
        node: (
          <DocSection
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
        ),
      };

    case "bigquery":
      return {
        title: "BigQuery",
        node: (
          <DocSection
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
            <DocSubsection id="bigquery-discovery" title={isPt ? "Discovery e atualização de metadata" : "Discovery & metadata refresh"}>
              <p>
                {isPt
                  ? "O backend expõe endpoints para listar projetos, datasets e tabelas do BigQuery e para atualizar o metadata da fonte com table_infos (schema com colunas). POST /api/bigquery/projects com credentialsContent ou sourceId retorna os projetos. POST /api/bigquery/datasets com credentialsContent/sourceId e projectId retorna os datasets. POST /api/bigquery/tables com credentialsContent/sourceId, projectId e datasetId retorna as tabelas. POST /api/bigquery/refresh_source atualiza a fonte com table_infos (e opcionalmente preview), permitindo que o LLM tenha contexto completo do schema."
                  : "The backend exposes endpoints to list BigQuery projects, datasets, and tables and to refresh source metadata with table_infos (schema with columns). POST /api/bigquery/projects with credentialsContent or sourceId returns projects. POST /api/bigquery/datasets with credentialsContent/sourceId and projectId returns datasets. POST /api/bigquery/tables with credentialsContent/sourceId, projectId, and datasetId returns tables. POST /api/bigquery/refresh_source updates the source with table_infos (and optional preview), so the LLM has full schema context."}
              </p>
              <code className="block rounded bg-muted p-2 text-xs mt-2">
                POST /api/bigquery/projects · /datasets · /tables · /refresh_source
              </code>
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
        ),
      };

    case "google-sheets":
      return {
        title: "Google Sheets",
        node: (
          <DocSection
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
        ),
      };

    case "sql-database":
      return {
        title: "SQL Database",
        node: (
          <DocSection
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
        ),
      };

    default:
      return { title: "Docs", node: null };
  }
}
