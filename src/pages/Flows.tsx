import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/LanguageContext";
import { SEO } from "@/components/SEO";
import {
  ArrowDown,
  FileSpreadsheet,
  Database,
  Sheet,
  Server,
  MessageSquare,
  Cpu,
  Save,
  ChevronRight,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

function Step({ num, title, children, icon: Icon }: { num: number; title: string; children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background">
          {Icon ? <Icon className="h-5 w-5 text-primary" /> : <span className="text-sm font-bold">{num}</span>}
        </div>
        {num < 99 && <div className="mt-1 h-full w-0.5 flex-1 bg-border" />}
      </div>
      <div className="pb-8">
        <h4 className="font-semibold">{title}</h4>
        <div className="mt-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function FlowSection({ title, description, icon: Icon, children }: { title: string; description: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </div>
              <ChevronRight className={`h-5 w-5 transition-transform ${open ? "rotate-90" : ""}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function Flows() {
  const { t, language } = useLanguage();
  const isPt = language === "pt";

  return (
    <div className="container max-w-4xl py-8">
      <SEO
        title={isPt ? "Fluxos de dados e perguntas" : "Data & question flows"}
        description={isPt ? "Etapas visuais do processo: fontes, agente e respostas." : "Visual steps: sources, agent, and answers."}
      />
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          {isPt ? "Fluxos do processo" : "Process flows"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {isPt
            ? "Da adição das fontes até a pergunta e resposta pelo agente, separado por tipo de fonte."
            : "From adding sources to the agent's question and answer, by source type."}
        </p>
      </div>

      {/* Overview */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {isPt ? "Visão geral" : "Overview"}
          </CardTitle>
          <CardDescription>
            {isPt ? "Fluxo único até o roteamento por tipo de fonte." : "Single flow until routing by source type."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          <Step num={1} title={isPt ? "Frontend: adicionar fonte" : "Frontend: add source"}>
            {isPt
              ? "Usuário abre o modal de fontes no workspace, faz upload (CSV/XLSX) ou preenche credenciais (BigQuery, Sheets, SQL)."
              : "User opens the source modal in the workspace, uploads a file (CSV/XLSX) or enters credentials (BigQuery, Sheets, SQL)."}
          </Step>
          <Step num={2} title={isPt ? "API: criar fonte e vincular ao agente" : "API: create source and link to agent"}>
            {isPt
              ? "POST /api/sources/upload (arquivo) ou POST /api/sources (body: name, type, metadata). A fonte é salva no banco com user_id. Em seguida PATCH /api/sources/{id} com agent_id e is_active para vincular ao workspace."
              : "POST /api/sources/upload (file) or POST /api/sources (body: name, type, metadata). Source is saved in DB with user_id. Then PATCH /api/sources/{id} with agent_id and is_active to link to the workspace."}
          </Step>
          <Step num={3} title={isPt ? "Frontend: usuário envia pergunta" : "Frontend: user sends question"}>
            {isPt
              ? "No workspace, o usuário digita a pergunta. O frontend chama POST /api/ask-question com { question, agentId, sessionId? }."
              : "In the workspace, the user types the question. The frontend calls POST /api/ask-question with { question, agentId, sessionId? }."}
          </Step>
          <Step num={4} title={isPt ? "Backend: carregar agente e fontes" : "Backend: load agent and sources"}>
            {isPt
              ? "O endpoint carrega o Agent pelo agentId e as fontes: por source_ids no agente ou por agent_id na tabela sources. Usa a primeira fonte (ativa) para responder."
              : "The endpoint loads the Agent by agentId and sources: either by agent.source_ids or by source.agent_id. It uses the first (active) source to answer."}
          </Step>
          <Step num={5} title={isPt ? "Backend: rotear por tipo de fonte" : "Backend: route by source type"}>
            {isPt
              ? "Conforme source.type (csv, xlsx, google_sheets, sql_database, bigquery), chama o script correspondente passando pergunta, descrição do agente e metadados da fonte."
              : "According to source.type (csv, xlsx, google_sheets, sql_database, bigquery), it calls the corresponding script with question, agent description, and source metadata."}
          </Step>
          <Step num={6} title={isPt ? "LLM: gerar resposta" : "LLM: generate answer"}>
            {isPt
              ? "Cada script monta o contexto (schema, amostra de dados, etc.), envia para o modelo (OpenAI/Ollama) e devolve answer, followUpQuestions e opcionalmente imageUrl."
              : "Each script builds the context (schema, sample data, etc.), sends it to the model (OpenAI/Ollama), and returns answer, followUpQuestions, and optionally imageUrl."}
          </Step>
          <Step num={7} title={isPt ? "Backend: salvar sessão e retornar" : "Backend: save session and return"}>
            {isPt
              ? "Cria ou atualiza QASession (conversation_history, follow_up_questions). Commit no banco. Retorna AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions)."
              : "Creates or updates QASession (conversation_history, follow_up_questions). Commits to DB. Returns AskQuestionResponse (answer, imageUrl, sessionId, followUpQuestions)."}
          </Step>
        </CardContent>
      </Card>

      {/* CSV / XLSX */}
      <FlowSection
        title="CSV / XLSX"
        description={isPt ? "Arquivos enviados e armazenados localmente." : "Files uploaded and stored locally."}
        icon={FileSpreadsheet}
      >
        <div className="space-y-0">
          <Step num={1} title={isPt ? "Upload no frontend" : "Upload on frontend"}>
            {isPt ? "Arquivo enviado via FormData para POST /api/sources/upload." : "File sent via FormData to POST /api/sources/upload."}
          </Step>
          <Step num={2} title={isPt ? "Backend: salvar arquivo" : "Backend: save file"}>
            {isPt
              ? "Arquivo gravado em data_files/{user_id}/{uuid}.csv (ou .xlsx). Pandas lê para extrair columns e preview (5 linhas). Metadados guardados em Source.metadata (file_path, columns, preview_rows, row_count)."
              : "File written to data_files/{user_id}/{uuid}.csv (or .xlsx). Pandas reads to extract columns and preview (5 rows). Metadata stored in Source.metadata (file_path, columns, preview_rows, row_count)."}
          </Step>
          <Step num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
            <code className="rounded bg-muted px-1">ask_csv(file_path, question, agent_description, columns, preview_rows, data_files_dir)</code>
            {isPt ? " — caminho relativo a data_files; colunas e preview vêm do metadata da fonte." : " — path relative to data_files; columns and preview from source metadata."}
          </Step>
          <Step num={4} title={isPt ? "Script CSV: contexto para o LLM" : "Script CSV: context for LLM"}>
            {isPt
              ? "Monta schema (colunas) e amostra (até 10 linhas). System prompt: assistente de dados tabulares; User prompt: schema + sample + pergunta. Resposta pode incluir linhas com '?' como follow-up."
              : "Builds schema (columns) and sample (up to 10 rows). System prompt: tabular data assistant; User prompt: schema + sample + question. Answer may include lines ending with '?' as follow-ups."}
          </Step>
          <Step num={5} title={isPt ? "Retorno" : "Return"}>
            {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
          </Step>
        </div>
      </FlowSection>

      {/* BigQuery */}
      <FlowSection
        title="BigQuery"
        description={isPt ? "Credenciais e metadados armazenados localmente." : "Credentials and metadata stored locally."}
        icon={Database}
      >
        <div className="space-y-0">
          <Step num={1} title={isPt ? "Configuração no frontend" : "Frontend setup"}>
            {isPt
              ? "Usuário envia JSON de credenciais (ou escolhe existente), informa Project ID, Dataset ID e tabelas (lista ou texto separado por vírgula). POST /api/sources com type: bigquery e metadata: { credentialsContent, projectId, datasetId, tables }."
              : "User uploads credentials JSON (or selects existing), enters Project ID, Dataset ID, and tables (list or comma-separated). POST /api/sources with type: bigquery and metadata: { credentialsContent, projectId, datasetId, tables }."}
          </Step>
          <Step num={2} title={isPt ? "Armazenamento" : "Storage"}>
            {isPt ? "Source criada no banco com type=bigquery; metadata guarda credentialsContent (JSON string), projectId, datasetId, tables. Nada é enviado à nuvem além do que o backend usar para consultas." : "Source created in DB with type=bigquery; metadata holds credentialsContent (JSON string), projectId, datasetId, tables. Nothing is sent to the cloud except what the backend uses for queries."}
          </Step>
          <Step num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
            <code className="rounded bg-muted px-1">ask_bigquery(credentials_content, project_id, dataset_id, tables, question, agent_description, table_infos)</code>
            {isPt ? " — metadados vêm do Source.metadata." : " — metadata from Source.metadata."}
          </Step>
          <Step num={4} title={isPt ? "Script BigQuery: contexto para o LLM" : "Script BigQuery: context for LLM"}>
            {isPt
              ? "Schema: project, dataset, tables; se houver table_infos, adiciona colunas por tabela. System: assistente BigQuery, pode sugerir SQL (SELECT). User: schema + pergunta. Resposta e follow-ups como nas outras fontes."
              : "Schema: project, dataset, tables; if table_infos present, adds columns per table. System: BigQuery assistant, may suggest SQL (SELECT). User: schema + question. Answer and follow-ups as in other sources."}
          </Step>
          <Step num={5} title={isPt ? "Retorno" : "Return"}>
            {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
          </Step>
        </div>
      </FlowSection>

      {/* Google Sheets */}
      <FlowSection
        title="Google Sheets"
        description={isPt ? "Spreadsheet ID e nome da aba no metadata." : "Spreadsheet ID and sheet name in metadata."}
        icon={Sheet}
      >
        <div className="space-y-0">
          <Step num={1} title={isPt ? "Configuração no frontend" : "Frontend setup"}>
            {isPt
              ? "Usuário informa ID da planilha e nome da aba. POST /api/sources com type: google_sheets e metadata: { spreadsheetId, sheetName }."
              : "User enters spreadsheet ID and sheet name. POST /api/sources with type: google_sheets and metadata: { spreadsheetId, sheetName }."}
          </Step>
          <Step num={2} title={isPt ? "Armazenamento" : "Storage"}>
            {isPt ? "Source no banco com type=google_sheets; metadata guarda apenas spreadsheetId e sheetName. Credenciais do Google (serviço) vêm de variável de ambiente no backend." : "Source in DB with type=google_sheets; metadata only stores spreadsheetId and sheetName. Google (service) credentials come from backend env."}
          </Step>
          <Step num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
            <code className="rounded bg-muted px-1">ask_google_sheets(spreadsheet_id, sheet_name, question, agent_description)</code>
            {isPt ? " — IDs vêm do metadata; credenciais de GOOGLE_SHEETS_SERVICE_ACCOUNT." : " — IDs from metadata; credentials from GOOGLE_SHEETS_SERVICE_ACCOUNT."}
          </Step>
          <Step num={4} title={isPt ? "Script Google Sheets: contexto para o LLM" : "Script Google Sheets: context for LLM"}>
            {isPt
              ? "Contexto: spreadsheet_id e sheet_name; amostra pode ser obtida via API Google (quando implementado). Hoje o prompt usa apenas o contexto básico. System: assistente de planilhas; User: contexto + pergunta."
              : "Context: spreadsheet_id and sheet_name; sample can be fetched via Google API (when implemented). Currently the prompt uses only basic context. System: sheets assistant; User: context + question."}
          </Step>
          <Step num={5} title={isPt ? "Retorno" : "Return"}>
            {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
          </Step>
        </div>
      </FlowSection>

      {/* SQL Database */}
      <FlowSection
        title="SQL Database"
        description={isPt ? "Connection string e informações de tabela no metadata." : "Connection string and table info in metadata."}
        icon={Database}
      >
        <div className="space-y-0">
          <Step num={1} title={isPt ? "Configuração no frontend" : "Frontend setup"}>
            {isPt
              ? "Usuário informa connection string, tipo (postgresql/mysql) e nome da tabela. POST /api/sources com type: sql_database e metadata: { connectionString, table_infos: [{ table, columns? }] }."
              : "User enters connection string, type (postgresql/mysql), and table name. POST /api/sources with type: sql_database and metadata: { connectionString, table_infos: [{ table, columns? }] }."}
          </Step>
          <Step num={2} title={isPt ? "Armazenamento" : "Storage"}>
            {isPt ? "Source no banco com type=sql_database; metadata guarda connectionString e table_infos (para contexto do LLM). Credenciais ficam apenas no backend." : "Source in DB with type=sql_database; metadata holds connectionString and table_infos (for LLM context). Credentials stay on backend only."}
          </Step>
          <Step num={3} title={isPt ? "Pergunta: roteamento" : "Question: routing"}>
            <code className="rounded bg-muted px-1">ask_sql(connection_string, question, agent_description, table_infos)</code>
            {isPt ? " — connection_string e table_infos do Source.metadata." : " — connection_string and table_infos from Source.metadata."}
          </Step>
          <Step num={4} title={isPt ? "Script SQL: contexto para o LLM" : "Script SQL: context for LLM"}>
            {isPt
              ? "Schema montado a partir de table_infos (tabela + colunas). System: assistente SQL, pode sugerir queries (SELECT). User: schema + pergunta. Não executa SQL automaticamente; o LLM sugere quando apropriado."
              : "Schema built from table_infos (table + columns). System: SQL assistant, may suggest queries (SELECT). User: schema + question. Does not execute SQL automatically; LLM suggests when appropriate."}
          </Step>
          <Step num={5} title={isPt ? "Retorno" : "Return"}>
            {isPt ? "{ answer, imageUrl: null, followUpQuestions }." : "{ answer, imageUrl: null, followUpQuestions }."}
          </Step>
        </div>
      </FlowSection>

      {/* Common: after answer */}
      <Card className="mt-8 border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Save className="h-4 w-4" />
            {isPt ? "Comum a todos os tipos" : "Common to all types"}
          </CardTitle>
          <CardDescription>
            {isPt ? "Após o script retornar a resposta." : "After the script returns the answer."}
          </CardDescription>
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
    </div>
  );
}
