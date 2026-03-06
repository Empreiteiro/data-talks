import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { Bot, CheckCircle2, Database, FileSpreadsheet, FileText, Info, Lightbulb, Save, Server, Sheet } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { isDocTopicId } from "./docStructure";

function DocSubsection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 mb-8">
      <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
        {title}
      </h3>
      <div className="text-sm text-muted-foreground space-y-3 leading-relaxed">{children}</div>
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
    <Card className="border-none shadow-none bg-transparent">
      <CardHeader className="px-0 pt-0">
        <div className="flex items-center gap-4 mb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 shadow-sm">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
            <CardDescription className="text-base">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pt-4">{children}</CardContent>
    </Card>
  );
}

function Tip({ children, isPt }: { children: React.ReactNode; isPt: boolean }) {
  return (
    <div className="flex gap-3 p-4 rounded-lg bg-primary/5 border border-primary/10 my-4 text-sm italic">
      <Lightbulb className="h-5 w-5 text-primary shrink-0" />
      <div>
        <span className="font-semibold block mb-1">{isPt ? "Dica Pro:" : "Pro Tip:"}</span>
        {children}
      </div>
    </div>
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
    <div className="py-10 px-8 lg:px-16 max-w-5xl animate-in fade-in slide-in-from-bottom-2 duration-500">
      <nav className="mb-10 text-sm font-medium flex items-center text-muted-foreground/60">
        <Link to="/" className="hover:text-primary transition-colors">
          Data Talks
        </Link>
        <span className="mx-3 opacity-40">/</span>
        <Link to="/flows" className="hover:text-primary transition-colors">
          Docs
        </Link>
        <span className="mx-3 opacity-40">/</span>
        <span className="text-foreground">{content.title}</span>
      </nav>
      {content.node}
    </div>
  );
}

function getTopicContent(topic: string, isPt: boolean) {
  switch (topic) {
    case "data-sources":
      return {
        title: isPt ? "Fontes de Dados" : "Data Sources",
        node: (
          <DocSection
            title={isPt ? "Gestão de Dados" : "Data Management"}
            description={isPt 
              ? "Centralize suas informações para que a inteligência artificial possa entender seu negócio." 
              : "Centralize your information so the AI can understand your business."}
            icon={Server}
          >
            <DocSubsection
              id="data-sources-add"
              title={isPt ? "Como Conectar seus Dados" : "How to Connect Your Data"}
            >
              <p>
                {isPt
                  ? "O primeiro passo para extrair inteligência dos seus dados é a conexão. No Data Talks, você pode carregar arquivos estáticos ou conectar bancos de dados dinâmicos. Cada fonte de dados serve como um 'livro de contexto' para seus agentes de IA."
                  : "The first step to extracting intelligence from your data is connectivity. In Data Talks, you can upload static files or connect dynamic databases. Each data source acts as a 'context book' for your AI agents."}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div className="p-4 border rounded-xl bg-card">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {isPt ? "Fácil Integração" : "Easy Integration"}
                  </h4>
                  <p className="text-xs">
                    {isPt 
                      ? "Arraste e solte arquivos ou use credenciais seguras para bancos de dados." 
                      : "Drag and drop files or use secure credentials for databases."}
                  </p>
                </div>
                <div className="p-4 border rounded-xl bg-card">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {isPt ? "Vínculo de Agente" : "Agent Association"}
                  </h4>
                  <p className="text-xs">
                    {isPt 
                      ? "Associe fontes específicas a agentes especializados para obter respostas mais precisas." 
                      : "Associate specific sources with specialized agents for more accurate answers."}
                  </p>
                </div>
              </div>
            </DocSubsection>
            
            <Tip isPt={isPt}>
              {isPt 
                ? "Manter suas fontes de dados atualizadas garante que a IA sempre tenha a última versão da verdade sobre seu negócio." 
                : "Keeping your data sources updated ensures the AI always has the latest version of the truth about your business."}
            </Tip>

            <DocSubsection id="data-sources-types" title={isPt ? "Tipos de Fonte Suportados" : "Supported Source Types"}>
              <p>
                {isPt
                  ? "Oferecemos flexibilidade total para diferentes necessidades corporativas:"
                  : "We offer total flexibility for different corporate needs:"}
              </p>
              <ul className="list-disc pl-5 mt-2 space-y-2">
                <li>
                  <strong>CSV / XLSX:</strong> {isPt ? "Ideal para análises rápidas de planilhas e relatórios pontuais." : "Ideal for rapid spreadsheet analysis and ad-hoc reporting."}
                </li>
                <li>
                  <strong>BigQuery:</strong> {isPt ? "Conecte-se ao data warehouse do Google para análises em larga escala." : "Connect to Google's data warehouse for large-scale analytics."}
                </li>
                <li>
                  <strong>Google Sheets:</strong> {isPt ? "Mantenha a agilidade usando planilhas colaborativas na nuvem." : "Maintain agility using collaborative cloud spreadsheets."}
                </li>
                <li>
                  <strong>SQL Databases:</strong> {isPt ? "Acesso direto aos seus bancos relacionais (Postgres, MySQL) para dados transacionais em tempo real." : "Direct access to your relational databases (Postgres, MySQL) for real-time transactional data."}
                </li>
              </ul>
            </DocSubsection>
          </DocSection>
        ),
      };

    case "asking-questions":
      return {
        title: isPt ? "Fazendo Perguntas" : "Asking Questions",
        node: (
          <DocSection
            title={isPt ? "Interação Natural" : "Natural Interaction"}
            description={isPt 
              ? "Transforme perguntas complexas em respostas simples através do chat." 
              : "Turn complex questions into simple answers through chat."}
            icon={Bot}
          >
            <DocSubsection id="asking-how" title={isPt ? "O Poder do Contexto" : "The Power of Context"}>
              <p>
                {isPt
                  ? "Diferente de sistemas de busca tradicionais, o Data Talks entende o contexto total dos seus dados. Quando você faz uma pergunta, o sistema não apenas busca palavras-chave, mas 'lê' a estrutura dos seus dados para gerar um raciocínio lógico."
                  : "Unlike traditional search systems, Data Talks understands the full context of your data. When you ask a question, the system doesn't just search for keywords; it 'reads' your data structure to generate logical reasoning."}
              </p>
            </DocSubsection>

            <DocSubsection id="asking-tips" title={isPt ? "Dicas para Melhores Perguntas" : "Tips for Better Questions"}>
              <p>{isPt ? "Para obter os melhores resultados, tente ser específico nas suas solicitações:" : "To get the best results, try to be specific in your requests:"}</p>
              <div className="space-y-4 mt-4">
                <div className="p-3 bg-muted/50 rounded-lg border border-border">
                  <span className="text-xs font-bold uppercase text-primary mb-1 block">{isPt ? "Faça assim:" : "Do it like this:"}</span>
                  <p className="text-sm">"{isPt ? "Qual foi o crescimento percentual de vendas entre Janeiro e Março deste ano?" : "What was the percentage growth in sales between January and March of this year?"}"</p>
                </div>
                <div className="p-3 bg-muted/20 opacity-70 rounded-lg border border-border">
                  <span className="text-xs font-bold uppercase text-muted-foreground mb-1 block">{isPt ? "Evite assim:" : "Avoid this:"}</span>
                  <p className="text-sm">"{isPt ? "As vendas subiram?" : "Did sales go up?"}"</p>
                </div>
              </div>
            </DocSubsection>

            <Tip isPt={isPt}>
              {isPt 
                ? "Você pode pedir para a IA cruzar dados de diferentes colunas ou tabelas, como 'relacione o custo de marketing com a receita total'." 
                : "You can ask the AI to cross-reference data from different columns or tables, like 'relate marketing cost to total revenue'."}
            </Tip>
          </DocSection>
        ),
      };

    case "answers-sessions":
      return {
        title: isPt ? "Respostas e Sessões" : "Answers & Sessions",
        node: (
          <DocSection
            title={isPt ? "Memória e Continuidade" : "Memory and Continuity"}
            description={isPt 
              ? "Mantenha o histórico de suas descobertas e aprofunde as análises." 
              : "Maintain a history of your discoveries and deepen your analysis."}
            icon={Save}
          >
            <DocSubsection id="sessions-continuity" title={isPt ? "Exploração Contínua" : "Continuous Exploration"}>
              <p>
                {isPt
                  ? "As conversas no Data Talks são organizadas em sessões, o que permite que a IA 'lembre' do que foi discutido anteriormente. Isso é fundamental para análises exploratórias onde uma pergunta leva a outra."
                  : "Conversations in Data Talks are organized into sessions, allowing the AI to 'remember' what was discussed previously. This is essential for exploratory analysis where one question leads to another."}
              </p>
              <div className="flex gap-4 items-start mt-4">
                <div className="h-10 w-10 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Info className="h-5 w-5 text-blue-500" />
                </div>
                <p className="text-xs italic">
                  {isPt 
                    ? "Exemplo: Após perguntar sobre o total de vendas, você pode simplesmente perguntar 'E qual foi o principal produto?' sem precisar repetir o período ou a fonte de dados." 
                    : "Example: After asking about total sales, you can simply ask 'And what was the top product?' without needing to repeat the time period or data source."}
                </p>
              </div>
            </DocSubsection>

            <DocSubsection id="sessions-export" title={isPt ? "Sugestões Inteligentes" : "Smart Suggestions"}>
              <p>
                {isPt
                  ? "Ao final de cada resposta, o sistema sugere 'perguntas de acompanhamento' baseadas no seu contexto atual, ajudando você a descobrir insights que talvez não tivesse imaginado."
                  : "At the end of each answer, the system suggests 'follow-up questions' based on your current context, helping you discover insights you might not have imagined."}
              </p>
            </DocSubsection>
          </DocSection>
        ),
      };

    case "llm-configuration":
      return {
        title: isPt ? "Configuração do LLM" : "LLM Configuration",
        node: (
          <DocSection
            title={isPt ? "Cérebro da Inteligência" : "Intelligence Engine"}
            description={isPt 
              ? "Escolha e configure os modelos de linguagem que melhor atendem seu negócio." 
              : "Choose and configure the language models that best serve your business."}
            icon={Bot}
          >
            <DocSubsection id="llm-providers" title={isPt ? "Escolhendo seu Provedor" : "Choosing Your Provider"}>
              <p>
                {isPt
                  ? "O Data Talks não está preso a um único modelo. Você pode escolher o 'cérebro' do seu sistema baseado em performance, custo ou privacidade:"
                  : "Data Talks is not locked into a single model. You can choose the 'engine' of your system based on performance, cost, or privacy:"}
              </p>
              <ul className="mt-4 space-y-4">
                <li className="p-4 border rounded-xl hover:bg-muted/30 transition-colors">
                  <h5 className="font-bold mb-1">OpenAI (SaaS)</h5>
                  <p className="text-xs text-muted-foreground">{isPt ? "O estado da arte em raciocínio e velocidade. Ideal para análises complexas e alta demanda." : "State-of-the-art reasoning and speed. Ideal for complex analysis and high demand."}</p>
                </li>
                <li className="p-4 border rounded-xl hover:bg-muted/30 transition-colors">
                  <h5 className="font-bold mb-1">Ollama (Local/Self-hosted)</h5>
                  <p className="text-xs text-muted-foreground">{isPt ? "Privacidade total. Seus dados nunca saem da sua infraestrutura. Ideal para dados sensíveis e conformidade LGPD/GDPR." : "Total privacy. Your data never leaves your infrastructure. Ideal for sensitive data and compliance (LGPD/GDPR)."}</p>
                </li>
                <li className="p-4 border rounded-xl hover:bg-muted/30 transition-colors">
                  <h5 className="font-bold mb-1">LiteLLM (Flexibilidade)</h5>
                  <p className="text-xs text-muted-foreground">{isPt ? "Um proxy versátil que permite conectar virtualmente qualquer modelo compatível com OpenAI." : "A versatile proxy that allows you to connect virtually any OpenAI-compatible model."}</p>
                </li>
              </ul>
            </DocSubsection>
            
            <DocSubsection id="llm-custom" title={isPt ? "Personalização por Agente" : "Per-Agent Customization"}>
              <p>
                {isPt
                  ? "Diferentes departamentos podem precisar de diferentes modelos. Você pode configurar um modelo mais rápido para atendimento simples e um modelo mais potente para analistas de dados seniores, tudo na mesma plataforma."
                  : "Different departments may need different models. You can configure a faster model for simple support and a more powerful model for senior data analysts, all within the same platform."}
              </p>
            </DocSubsection>
          </DocSection>
        ),
      };

    case "table-summaries":
      return {
        title: isPt ? "Resumos de Tabela" : "Table Summaries",
        node: (
          <DocSection
            title={isPt ? "O Studio de Insights" : "The Insights Studio"}
            description={isPt 
              ? "Obtenha uma visão panorâmica e estatística dos seus dados em segundos." 
              : "Get a bird's eye view and statistical overview of your data in seconds."}
            icon={FileText}
          >
            <DocSubsection id="summaries-what" title={isPt ? "O que o Resumo oferece?" : "What does the Summary offer?"}>
              <p>
                {isPt
                  ? "O recurso de Resumo de Tabela no Studio do Workspace é como ter um cientista de dados júnior fazendo um relatório inicial para você. Ele analisa automaticamente:"
                  : "The Table Summary feature in the Workspace Studio is like having a junior data scientist create an initial report for you. It automatically analyzes:"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                {[
                  { pt: "Top Insights", en: "Top Insights" },
                  { pt: "Tendências", en: "Trends" },
                  { pt: "Anomalias", en: "Anomalies" },
                  { pt: "Distribuição", en: "Distribution" },
                  { pt: "Sugestões", en: "Suggestions" },
                  { pt: "Estatísticas", en: "Statistics" }
                ].map((item, i) => (
                  <div key={i} className="py-2 px-3 border rounded-lg text-xs font-semibold text-center bg-muted/30">
                    {isPt ? item.pt : item.en}
                  </div>
                ))}
              </div>
            </DocSubsection>

            <DocSubsection id="summaries-speed" title={isPt ? "Velocidade na Tomada de Decisão" : "Speed in Decision Making"}>
              <p>
                {isPt
                  ? "Em vez de ler milhares de linhas ou criar gráficos complexos para entender o básico, o resumo executivo fornece os pontos principais de forma textual e estruturada, prontos para serem compartilhados em reuniões."
                  : "Instead of reading thousands of lines or creating complex charts to understand the basics, the executive summary provides key points in a structured textual format, ready to be shared in meetings."}
              </p>
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
            description={isPt ? "Analise suas planilhas de forma dinâmica." : "Analyze your spreadsheets dynamically."}
            icon={FileSpreadsheet}
          >
            <DocSubsection id="csv-how" title={isPt ? "Simplicidade e Versatilidade" : "Simplicity and Versatility"}>
              <p>
                {isPt
                  ? "O formato CSV/XLSX é o mais utilizado no mundo dos negócios. No Data Talks, tratamos essas planilhas não apenas como arquivos mortos, mas como bases de dados consultáveis."
                  : "The CSV/XLSX format is the most common in the business world. In Data Talks, we treat these spreadsheets not just as dead files, but as searchable databases."}
              </p>
            </DocSubsection>
            
            <DocSubsection id="csv-analysis" title={isPt ? "Análise de Colunas" : "Column Analysis"}>
              <p>
                {isPt
                  ? "Ao carregar um arquivo, o sistema mapeia automaticamente os tipos de dados de cada coluna (datas, números, categorias). Isso permite que a IA responda coisas como 'some o total da coluna Preço' ou 'agrupe por Região'."
                  : "When you upload a file, the system automatically maps the data types of each column (dates, numbers, categories). This allows the AI to answer things like 'sum the Total Price column' or 'group by Region'."}
              </p>
            </DocSubsection>

            <Tip isPt={isPt}>
              {isPt 
                ? "Certifique-se de que a primeira linha do seu arquivo contenha cabeçalhos claros para que a IA identifique as colunas corretamente." 
                : "Make sure the first row of your file contains clear headers so the AI can correctly identify the columns."}
            </Tip>
          </DocSection>
        ),
      };

    case "bigquery":
      return {
        title: "BigQuery",
        node: (
          <DocSection
            title="BigQuery"
            description={isPt ? "Poder do Google Cloud para grandes conjuntos de dados." : "Google Cloud power for large datasets."}
            icon={Database}
          >
            <DocSubsection id="bq-enterprise" title={isPt ? "Pronto para Corporações" : "Enterprise-Ready"}>
              <p>
                {isPt
                  ? "Ideal para empresas que já possuem seus dados consolidados no ecossistema Google Cloud. O Data Talks integra-se perfeitamente via Chave de Conta de Serviço, permitindo consultas em milhões de linhas em questão de segundos."
                  : "Ideal for companies that already have their data consolidated in the Google Cloud ecosystem. Data Talks integrates perfectly via Service Account Key, allowing queries across millions of rows in a matter of seconds."}
              </p>
            </DocSubsection>

            <DocSubsection id="bq-schema" title={isPt ? "Auto-Descoberta de Schema" : "Automatic Schema Discovery"}>
              <p>
                {isPt
                  ? "Uma vez conectado, o sistema 'estuda' suas tabelas e visões. Ele entende relacionamentos complexos e pode até sugerir insights baseados na hierarquia do seu dataset no BigQuery."
                  : "Once connected, the system 'studies' your tables and views. It understands complex relationships and can even suggest insights based on your BigQuery dataset hierarchy."}
              </p>
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
            description={isPt ? "Colaboração e dados em tempo real." : "Collaboration and real-time data."}
            icon={Sheet}
          >
            <DocSubsection id="sheets-live" title={isPt ? "Dados em Movimento" : "Data in Motion"}>
              <p>
                {isPt
                  ? "A maior vantagem de usar o Google Sheets é a agilidade. Diferente de um CSV estático, quando você altera um valor na sua planilha do Google, a próxima pergunta feita ao agente já usará o dado atualizado."
                  : "The biggest advantage of using Google Sheets is agility. Unlike a static CSV, when you change a value in your Google spreadsheet, the next question asked to the agent will already use the updated data."}
              </p>
            </DocSubsection>

            <DocSubsection id="sheets-security" title={isPt ? "Segurança no Acesso" : "Access Security"}>
              <p>
                {isPt
                  ? "Para que o Data Talks acesse sua planilha, você deve compartilhar o arquivo com o e-mail da conta de serviço gerada no backend. Isso garante que apenas os dados autorizados sejam acessados pelo sistema."
                  : "In order for Data Talks to access your spreadsheet, you must share the file with the service account email generated on the backend. This ensures only authorized data is accessed by the system."}
              </p>
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
            description={isPt ? "Conectividade direta com seu coração transacional." : "Direct connectivity to your transactional heart."}
            icon={Database}
          >
            <DocSubsection id="sql-realtime" title={isPt ? "Acesso Direto (Postgres/MySQL)" : "Direct Access (Postgres/MySQL)"}>
              <p>
                {isPt
                  ? "Conecte-se diretamente aos bancos de dados de produção ou réplicas de leitura. Isso permite que sua IA responda sobre o estado atual do seu negócio, sem necessidade de processos complexos de extração de dados (ETL)."
                  : "Connect directly to production databases or read replicas. This allows your AI to answer questions about the current state of your business without the need for complex data extraction processes (ETL)."}
              </p>
            </DocSubsection>

            <DocSubsection id="sql-mapping" title={isPt ? "Mapeamento Inteligente" : "Smart Mapping"}>
              <p>
                {isPt
                  ? "O sistema mapeia as tabelas selecionadas e entende a tipagem de cada campo. Isso é crucial para que o LLM saiba distinguir, por exemplo, um 'ID de Clientes' de um 'Valor de Compra' e possa realizar cálculos matemáticos precisos."
                  : "The system maps selected tables and understands each field's typing. This is crucial so the LLM knows how to distinguish, for example, a 'Customer ID' from a 'Purchase Value' and can perform precise mathematical calculations."}
              </p>
            </DocSubsection>
          </DocSection>
        ),
      };

    default:
      return { title: "Docs", node: null };
  }
}
