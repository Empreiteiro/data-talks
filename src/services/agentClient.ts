import Papa from "papaparse";
import * as XLSX from "xlsx";

export type SourceType = 'csv' | 'xlsx' | 'bigquery';

export interface Source {
  id: string;
  type: SourceType;
  name: string;
  metaJSON: any;
  ownerId: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  ownerId: string;
  name?: string;
  description: string;
  createdAt: string;
  // Sharing
  shareToken: string;
  sharePassword?: string;
}

export interface QASession {
  id: string;
  agentId: string;
  question: string;
  answerText: string;
  answerTableJSON?: any[];
  rawSQL?: string;
  latencyMs: number;
  status: 'ok' | 'error';
  createdAt: string;
  feedback?: 'up' | 'down';
}

export interface Alert {
  id: string;
  agentId: string;
  tableRef: string;
  conditionExpr?: string;
  query?: string;
  frequency: 'minute' | 'hour' | 'daily' | 'weekly';
  channel: 'in-app' | 'email';
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  matched: boolean;
  payloadJSON: any;
  createdAt: string;
}

const DB = {
  users: 'demo_users',
  sources: 'demo_sources',
  agents: 'demo_agents',
  agentSources: 'demo_agent_sources',
  qa: 'demo_qa',
  alerts: 'demo_alerts',
  alertEvents: 'demo_alert_events',
  session: 'demo_session_user',
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();

function getCurrentUserId(): string {
  const raw = localStorage.getItem(DB.session);
  if (!raw) throw new Error('Não autenticado');
  return JSON.parse(raw).id;
}

function read<T>(key: string): T[] {
  return JSON.parse(localStorage.getItem(key) || '[]');
}
function write<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const agentClient = {
  // Sources
  async uploadFiles(files: File[]): Promise<Source[]> {
    const ownerId = getCurrentUserId();
    const created: Source[] = [];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) throw new Error('Extensão inválida');
      const name = file.name;
      let preview: any[] = [];
      let schema: Record<string, string> = {};
      let rowCount = 0;

      if (ext === 'csv') {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const allData = parsed.data as any[];
        preview = allData.slice(0, 5);
        schema = inferSchema(allData);
        rowCount = allData.length;
      } else {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const firstSheet = wb.SheetNames[0];
        const ws = wb.Sheets[firstSheet];
        const json = XLSX.utils.sheet_to_json(ws);
        const allData = json as any[];
        preview = allData.slice(0, 5);
        schema = inferSchema(allData);
        rowCount = allData.length;
      }

      const source: Source = {
        id: uid(),
        type: ext === 'csv' ? 'csv' : 'xlsx',
        name,
        metaJSON: { schema, preview, rowCount },
        ownerId,
        createdAt: nowISO(),
      };
      const sources = read<Source>(DB.sources);
      sources.push(source);
      write(DB.sources, sources);
      created.push(source);
    }
    return created;
  },

  async connectBigQuery(credFile: File, opts: { project?: string; dataset?: string; tables?: string[] }) {
    const ownerId = getCurrentUserId();
    const text = await credFile.text();
    const json = JSON.parse(text);
    // Basic safety: remove private_key from UI logs
    const safe = { ...json };
    if (safe.private_key) safe.private_key = '***';
    const source: Source = {
      id: uid(),
      type: 'bigquery',
      name: opts.project || json.project_id || 'BigQuery',
      metaJSON: { credential: safe, project: opts.project || json.project_id, dataset: opts.dataset, tables: opts.tables || [] },
      ownerId,
      createdAt: nowISO(),
    };
    const sources = read<Source>(DB.sources);
    sources.push(source);
    write(DB.sources, sources);
    return source;
  },

  listSources(): Source[] {
    const ownerId = getCurrentUserId();
    return read<Source>(DB.sources).filter(s => s.ownerId === ownerId);
  },

  deleteSource(sourceId: string): void {
    const ownerId = getCurrentUserId();
    const sources = read<Source>(DB.sources).filter(s => !(s.id === sourceId && s.ownerId === ownerId));
    write(DB.sources, sources);
    // Also remove any agent-source links
    const links = read<{ agentId: string; sourceId: string }>(DB.agentSources).filter(l => l.sourceId !== sourceId);
    write(DB.agentSources, links);
  },

  // Agent
  createBriefing(sourceIds: string[], description: string, name?: string): Agent {
    if (description.trim().length < 200) throw new Error('Descrição mínima de 200 caracteres');
    const ownerId = getCurrentUserId();
    const agent: Agent = { id: uid(), ownerId, name: name?.trim() || undefined, description, createdAt: nowISO(), shareToken: uid(), sharePassword: undefined };
    const agents = read<Agent>(DB.agents);
    agents.push(agent);
    write(DB.agents, agents);
    const links = read<{ agentId: string; sourceId: string }>(DB.agentSources);
    sourceIds.forEach((sid) => links.push({ agentId: agent.id, sourceId: sid }));
    write(DB.agentSources, links);
    return agent;
  },

  listAgents(): Agent[] {
    const ownerId = getCurrentUserId();
    return read<Agent>(DB.agents).filter(a => a.ownerId === ownerId);
  },

  getAgent(id: string): Agent | undefined {
    const ownerId = getCurrentUserId();
    return read<Agent>(DB.agents).find(a => a.ownerId === ownerId && a.id === id);
  },

  getAgentSourceIds(agentId: string): string[] {
    const links = read<{ agentId: string; sourceId: string }>(DB.agentSources);
    return links.filter(l => l.agentId === agentId).map(l => l.sourceId);
  },

  updateAgent(agentId: string, updates: { name?: string; description?: string; sourceIds?: string[] }) {
    const agents = read<Agent>(DB.agents);
    const a = agents.find(x => x.id === agentId);
    if (!a) throw new Error('Agente não encontrado');
    if (typeof updates.name !== 'undefined') a.name = updates.name?.trim() || undefined;
    if (typeof updates.description !== 'undefined') a.description = updates.description;
    write(DB.agents, agents);

    if (updates.sourceIds) {
      const links = read<{ agentId: string; sourceId: string }>(DB.agentSources).filter(l => l.agentId !== agentId);
      updates.sourceIds.forEach(sid => links.push({ agentId, sourceId: sid }));
      write(DB.agentSources, links);
    }
    return a;
  },

  setAgentShare(agentId: string, password?: string) {
    const agents = read<Agent>(DB.agents);
    const a = agents.find(x => x.id === agentId);
    if (!a) throw new Error('Agente não encontrado');
    a.sharePassword = password || undefined;
    if (!a.shareToken) a.shareToken = uid();
    write(DB.agents, agents);
    return a;
  },

  deleteAgent(agentId: string): void {
    const ownerId = getCurrentUserId();
    // Remove agent
    const agents = read<Agent>(DB.agents).filter(a => !(a.id === agentId && a.ownerId === ownerId));
    write(DB.agents, agents);
    // Remove agent-source links
    const links = read<{ agentId: string; sourceId: string }>(DB.agentSources).filter(l => l.agentId !== agentId);
    write(DB.agentSources, links);
    // Remove QA sessions
    const qa = read<QASession>(DB.qa).filter(q => q.agentId !== agentId);
    write(DB.qa, qa);
    // Remove alerts
    const alerts = read<Alert>(DB.alerts).filter(a => a.agentId !== agentId);
    write(DB.alerts, alerts);
  },

  getAgentByShareToken(token: string): Agent | undefined {
    return read<Agent>(DB.agents).find(a => a.shareToken === token);
  },

  verifySharePassword(agentId: string, password: string): boolean {
    const a = read<Agent>(DB.agents).find(x => x.id === agentId);
    if (!a) return false;
    return (a.sharePassword || '') === (password || '');
  },

  // QA
  ask(agentId: string, question: string): QASession {
    const start = performance.now();
    const answer = synthAnswer(question);
    const latencyMs = Math.round(performance.now() - start) + 300; // simulate
    const session: QASession = {
      id: uid(), agentId, question,
      answerText: answer.text,
      answerTableJSON: answer.table,
      rawSQL: answer.sql,
      latencyMs, status: 'ok', createdAt: nowISO()
    };
    const qa = read<QASession>(DB.qa);
    qa.unshift(session);
    write(DB.qa, qa);
    return session;
  },

  listHistory(agentId?: string): QASession[] {
    const qa = read<QASession>(DB.qa);
    const ownerId = getCurrentUserId();
    const agents = this.listAgents().map(a => a.id);
    const filtered = qa.filter(q => agents.includes(q.agentId));
    return agentId ? filtered.filter(q => q.agentId === agentId) : filtered;
  },

  // Alerts
  createAlert(input: Omit<Alert, 'id' | 'createdAt' | 'isActive'> & { isActive?: boolean }): Alert {
    const alert: Alert = {
      ...input,
      id: uid(),
      isActive: input.isActive ?? true,
      createdAt: nowISO(),
      lastRunAt: undefined,
      nextRunAt: nextScheduleISO(input.frequency),
    };
    const alerts = read<Alert>(DB.alerts);
    alerts.unshift(alert);
    write(DB.alerts, alerts);
    return alert;
  },

  listAlerts(agentId?: string): Alert[] {
    const alerts = read<Alert>(DB.alerts);
    if (!agentId) return alerts;
    return alerts.filter(a => a.agentId === agentId);
  },

  testAlert(alertId: string) {
    const alerts = read<Alert>(DB.alerts);
    const a = alerts.find(x => x.id === alertId);
    if (!a) throw new Error('Alerta não encontrado');
    const matched = Math.random() > 0.5;
    a.lastRunAt = nowISO();
    a.nextRunAt = nextScheduleISO(a.frequency);
    write(DB.alerts, alerts);
    const evt: AlertEvent = { id: uid(), alertId: a.id, matched, payloadJSON: { sample: true }, createdAt: nowISO() };
    const events = read<AlertEvent>(DB.alertEvents);
    events.unshift(evt);
    write(DB.alertEvents, events);
    return evt;
  },

  // Feedback for QA sessions
  setFeedback(sessionId: string, feedback: 'up' | 'down' | null) {
    const qa = read<QASession>(DB.qa);
    const s = qa.find(x => x.id === sessionId);
    if (s) {
      (s as any).feedback = feedback || undefined;
      write(DB.qa, qa);
    }
    return s;
  },

  // Delete QA session
  deleteQuestion(sessionId: string): void {
    const ownerId = getCurrentUserId();
    const qa = read<QASession>(DB.qa);
    const agents = this.listAgents().map(a => a.id);
    const filtered = qa.filter(q => !(q.id === sessionId && agents.includes(q.agentId)));
    write(DB.qa, filtered);
  }
};

function inferSchema(rows: any[]): Record<string, string> {
  const first = rows[0] || {};
  const keys = Object.keys(first);
  const schema: Record<string, string> = {};
  for (const k of keys) {
    const sample = rows.find(r => r[k] != null)?.[k];
    schema[k] = inferType(sample);
  }
  return schema;
}

function inferType(v: any): string {
  if (v == null) return 'string';
  if (typeof v === 'number') return 'number';
  if (!isNaN(Number(v))) return 'number';
  const d = new Date(v);
  if (!isNaN(d.getTime())) return 'date';
  return 'string';
}

function nextScheduleISO(freq: Alert['frequency']): string {
  const d = new Date();
  switch (freq) {
    case 'minute': d.setMinutes(d.getMinutes() + 1); break;
    case 'hour': d.setHours(d.getHours() + 1); break;
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
  }
  return d.toISOString();
}

function synthAnswer(question: string): { text: string; table?: any[]; sql?: string } {
  const lower = question.toLowerCase();
  if (lower.includes('receita') || lower.includes('faturamento')) {
    const table = [
      { mes: '2025-06', norte: 120000, sul: 98000, sudeste: 210000 },
      { mes: '2025-07', norte: 132000, sul: 102500, sudeste: 220300 },
      { mes: '2025-08', norte: 141500, sul: 110200, sudeste: 238900 },
    ];
    return {
      text: 'Receita dos últimos 3 meses por região. Sudeste lidera com crescimento consistente.',
      table,
      sql: 'SELECT mes, SUM(receita) BY regiao ...',
    };
  }
  if (lower.includes('top') && lower.includes('clientes')) {
    const table = Array.from({ length: 10 }).map((_, i) => ({ rank: i + 1, cliente: `Cliente ${i + 1}`, valor: Math.round(50000 - i * 3200) }));
    return { text: 'Top 10 clientes por faturamento em 2025.', table, sql: 'SELECT ... ORDER BY faturamento DESC LIMIT 10' };
  }
  return { text: 'Aqui está uma resposta gerada pelo agente com base no seu briefing. Refine a pergunta para obter mais detalhes.' };
}
