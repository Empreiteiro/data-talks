/**
 * Python API client (Data Talks backend).
 * Used when VITE_API_URL is set; replaces Supabase/Langflow.
 */
import { getApiUrl, getToken } from '@/config';

export interface SqlSourceRelationship {
  leftSourceId: string;
  leftTable: string;
  leftColumn: string;
  rightSourceId: string;
  rightTable: string;
  rightColumn: string;
}

function toApiAssetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith('blob:') || path.startsWith('data:')) return path;
  const base = getApiUrl();
  if (!base) return path;
  if (path.startsWith('/')) return `${base}${path}`;
  return `${base}/${path}`;
}

async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getApiUrl();
  const url = base ? `${base}${path}` : path;
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = err.detail != null
      ? Array.isArray(err.detail)
        ? (err.detail[0]?.msg ?? err.detail[0]?.loc?.join?.(' ') ?? JSON.stringify(err.detail))
        : err.detail
      : err.error || res.statusText || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.json();
}

async function apiFormData<T>(path: string, formData: FormData): Promise<T> {
  const base = getApiUrl();
  const url = base ? `${base}${path}` : path;
  const token = getToken();
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = err.detail != null
      ? Array.isArray(err.detail)
        ? (err.detail[0]?.msg ?? err.detail[0]?.loc?.join?.(' ') ?? JSON.stringify(err.detail))
        : err.detail
      : err.error || res.statusText || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.json();
}

async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const base = getApiUrl();
  const url = base ? `${base}${path}` : path;
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const msg = err.detail != null
      ? Array.isArray(err.detail)
        ? (err.detail[0]?.msg ?? err.detail[0]?.loc?.join?.(' ') ?? JSON.stringify(err.detail))
        : err.detail
      : err.error || res.statusText || String(res.status);
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.blob();
}

export const apiClient = {
  async listSources(agentId?: string, isActive?: boolean) {
    const params = new URLSearchParams();
    if (agentId) params.set('agent_id', agentId);
    if (isActive !== undefined) params.set('is_active', String(isActive));
    const path = params.toString() ? `/api/sources?${params}` : '/api/sources';
    const data = await api<Array<{ id: string; name: string; type: string; ownerId: string; agent_id?: string; is_active?: boolean; createdAt: string; metaJSON: any; langflowPath?: string; langflowName?: string }>>(path);
    return (data || []).map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as 'csv' | 'xlsx' | 'bigquery' | 'google_sheets' | 'sql_database',
      ownerId: s.ownerId,
      agent_id: s.agent_id,
      is_active: s.is_active,
      createdAt: s.createdAt,
      metaJSON: s.metaJSON,
      langflowPath: s.langflowPath,
      langflowName: s.langflowName,
    }));
  },

  async updateSource(id: string, body: { agent_id?: string; is_active?: boolean }) {
    return api(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteSource(id: string) {
    await api(`/api/sources/${id}`, { method: 'DELETE' });
  },

  async createSource(name: string, type: 'bigquery' | 'google_sheets' | 'sql_database', metadata: Record<string, unknown>, agentId?: string) {
    const data = await api<{ id: string; name: string; type: string; ownerId: string; createdAt: string; metaJSON: any }>('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ name, type, metadata, agent_id: agentId ?? null }),
    });
    return {
      id: data.id,
      name: data.name,
      type: data.type,
      metadata: data.metaJSON,
      user_id: data.ownerId,
      created_at: data.createdAt,
    };
  },

  async bigqueryListProjects(body: { credentialsContent?: string; sourceId?: string }) {
    return api<{ projects: Array<{ id: string; name: string }> }>('/api/bigquery/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async bigqueryListDatasets(body: { credentialsContent?: string; sourceId?: string; projectId: string }) {
    return api<{ datasets: Array<{ id: string; name: string }> }>('/api/bigquery/datasets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async bigqueryListTables(body: { credentialsContent?: string; sourceId?: string; projectId: string; datasetId: string }) {
    return api<{ tables: Array<{ id: string; name: string }> }>('/api/bigquery/tables', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async sqlListTables(body: { connectionString: string }) {
    return api<{ tables: Array<{ id: string; name: string; columns?: string[] }> }>('/api/sql/tables', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async listAgentSqlSources(agentId: string) {
    return api<{
      sources: Array<{
        id: string;
        name: string;
        is_active?: boolean;
        table_infos?: Array<{ table: string; columns?: string[]; preview_rows?: Record<string, unknown>[] }>;
      }>;
      relationships: SqlSourceRelationship[];
    }>(`/api/sql/agents/${agentId}/sources`);
  },
  async listAgentSqlRelationshipSuggestions(agentId: string) {
    return api<{
      sources: Array<{
        id: string;
        name: string;
        is_active?: boolean;
        table_infos?: Array<{ table: string; columns?: string[]; preview_rows?: Record<string, unknown>[] }>;
      }>;
      relationships: SqlSourceRelationship[];
      suggestions: SqlSourceRelationship[];
    }>(`/api/sql/agents/${agentId}/relationship-suggestions`);
  },
  async saveAgentSqlRelationships(agentId: string, relationships: SqlSourceRelationship[]) {
    return api<{ relationships: SqlSourceRelationship[] }>(`/api/sql/agents/${agentId}/relationships`, {
      method: 'PUT',
      body: JSON.stringify({ relationships }),
    });
  },
  async dismissRelationshipSuggestion(agentId: string, key: string) {
    return api<{ dismissed: string[] }>(`/api/sql/agents/${agentId}/dismiss-relationship-suggestion`, {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
  },
  async refreshSourceBigQueryMetadata(sourceId: string) {
    return api<{ metaJSON: any }>(`/api/bigquery/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  async getGoogleSheetsServiceEmail(): Promise<string | null> {
    const data = await api<{ email: string | null }>('/api/settings/google-sheets-service-email');
    return data?.email ?? null;
  },
  async fetchBigQueryFullTable(sourceId: string, limit?: number) {
    return api<{ columns: string[]; rows: Record<string, unknown>[] }>(
      `/api/bigquery/sources/${sourceId}/full-table`,
      { method: 'POST', body: JSON.stringify(limit != null ? { limit } : {}) }
    );
  },

  async getAgent(id: string) {
    return api<{ id: string; name: string; description: string; source_ids: string[]; source_relationships: SqlSourceRelationship[]; suggested_questions: string[]; llm_config_id?: string | null; sql_mode?: boolean }>(`/api/agents/${id}`);
  },

  async listAgents() {
    const data = await api<Array<{ id: string; name: string; description: string; source_ids: string[]; source_relationships: SqlSourceRelationship[]; suggested_questions: string[]; created_at: string; updated_at: string; source_count: number }>>('/api/agents');
    return (data || []).map((a) => ({
      ...a,
      source_relationships: a.source_relationships || [],
      suggested_questions: a.suggested_questions || [],
    }));
  },

  async createAgent(name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[], sourceRelationships?: SqlSourceRelationship[]) {
    return api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name, source_ids: sourceIds, description: description || '', suggested_questions: suggestedQuestions || [], source_relationships: sourceRelationships || [] }),
    });
  },

  async updateAgent(id: string, name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[], llmConfigId?: string | null, sourceRelationships?: SqlSourceRelationship[], sqlMode?: boolean) {
    return api(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, source_ids: sourceIds, description: description || '', suggested_questions: suggestedQuestions || [], llm_config_id: llmConfigId ?? null, source_relationships: sourceRelationships, sql_mode: sqlMode }),
    });
  },

  async updateAgentLlmConfig(agentId: string, llmConfigId: string | null) {
    return api(`/api/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ llm_config_id: llmConfigId }),
    });
  },

  async deleteAgent(id: string) {
    await api(`/api/agents/${id}`, { method: 'DELETE' });
  },

  async listQASessions(agentId?: string) {
    const path = agentId ? `/api/qa_sessions?agent_id=${encodeURIComponent(agentId)}` : '/api/qa_sessions';
    const data = await api<any[]>(path);
    return (data || []).map((s) => ({
      ...s,
      answerText: s.answer,
      imageUrl: toApiAssetUrl(s.imageUrl ?? (s.table_data && s.table_data.image_url)),
      answerTableJSON: s.table_data?.table,
      latencyMs: s.latency,
      followUpQuestions: s.follow_up_questions || [],
      conversationHistory: (s.conversation_history || []).map((entry: any) => ({
        ...entry,
        imageUrl: toApiAssetUrl(entry.imageUrl),
      })),
    }));
  },

  async deleteQASession(id: string) {
    await api(`/api/qa_sessions/${id}`, { method: 'DELETE' });
  },

  async updateQASession(id: string, body: { conversation_history?: any[] }) {
    await api(`/api/qa_sessions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async updateQASessionFeedback(id: string, feedback: 'positive' | 'negative') {
    await api(`/api/qa_sessions/${id}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback }) });
  },

  async listAlerts(agentId?: string) {
    const path = agentId ? `/api/alerts?agent_id=${encodeURIComponent(agentId)}` : '/api/alerts';
    return api(path);
  },

  async createAlert(agentId: string, name: string, question: string, email: string, frequency: string, executionTime: string, dayOfWeek?: number, dayOfMonth?: number) {
    return api('/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ agentId, name, question, email, frequency, executionTime, dayOfWeek, dayOfMonth }),
    });
  },

  async deleteAlert(id: string) {
    await api(`/api/alerts/${id}`, { method: 'DELETE' });
  },

  async uploadFile(file: File, _selectedSheet?: string) {
    const form = new FormData();
    form.append('file', file);
    const data = await apiFormData<{ id: string; name: string; type: string; ownerId: string; createdAt: string; metaJSON: any }>('/api/sources/upload', form);
    return {
      id: data.id,
      name: data.name,
      type: data.type,
      metadata: data.metaJSON,
      user_id: data.ownerId,
      created_at: data.createdAt,
    };
  },

  async askQuestion(agentId: string, question: string, sessionId?: string) {
    const data = await api<{ answer: string; imageUrl?: string; sessionId?: string; followUpQuestions?: string[]; turnId?: string; chartInput?: any }>('/api/ask-question', {
      method: 'POST',
      body: JSON.stringify({ question, agentId, sessionId }),
    });
    return {
      ...data,
      imageUrl: toApiAssetUrl(data.imageUrl),
    };
  },

  async generateChartForTurn(sessionId: string, body: { turnId?: string; turnIndex?: number }) {
    const data = await api<{ imageUrl: string; matplotlibScript?: string; chartSpec?: any; turnId?: string }>(`/api/ask-question/${sessionId}/chart`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      ...data,
      imageUrl: toApiAssetUrl(data.imageUrl) || data.imageUrl,
    };
  },

  async listDashboards() {
    const data = await api<Array<{ id: string; name: string; description?: string; updated_at: string; chart_count: number }>>('/api/dashboards');
    return (data || []).map((d) => ({ ...d, chart_count: d.chart_count ?? 0 }));
  },

  async createDashboard(name: string, description?: string) {
    return api('/api/dashboards', { method: 'POST', body: JSON.stringify({ name, description }) });
  },

  async getDashboard(id: string) {
    return api(`/api/dashboards/${id}`);
  },

  async updateDashboard(id: string, name: string, description?: string) {
    return api(`/api/dashboards/${id}`, { method: 'PATCH', body: JSON.stringify({ name, description }) });
  },

  async deleteDashboard(id: string) {
    await api(`/api/dashboards/${id}`, { method: 'DELETE' });
  },

  async addChartToDashboard(dashboardId: string, qaSessionId: string, title?: string, description?: string) {
    const body: { qaSessionId: string; imageUrl?: string; title?: string; description?: string } = { qaSessionId, title, description };
    return api(`/api/dashboards/${dashboardId}/charts`, { method: 'POST', body: JSON.stringify(body) });
  },

  async removeChartFromDashboard(chartId: string) {
    await api(`/api/dashboard_charts/${chartId}`, { method: 'DELETE' });
  },

  async updateDashboardChart(chartId: string, updates: { title?: string; description?: string; position_x?: number; position_y?: number; width?: number; height?: number }) {
    return api(`/api/dashboard_charts/${chartId}`, { method: 'PATCH', body: JSON.stringify(updates) });
  },

  async connectBigQuery(_credentials: string, _projectId: string, _datasetId: string, _tables: string[]) {
    throw new Error('BigQuery via Python backend coming soon. Use CSV/XLSX only for now.');
  },

  async getLlmSettings() {
    return api<{
      llm_provider: string;
      openai_api_key?: string;
      openai_base_url?: string;
      openai_model?: string;
      openai_audio_model?: string;
      ollama_base_url?: string;
      ollama_model?: string;
      litellm_base_url?: string;
      litellm_model?: string;
      litellm_audio_model?: string;
      litellm_api_key?: string;
    }>('/api/settings/llm');
  },

  async updateLlmSettings(body: {
    llm_provider?: string;
    openai_api_key?: string;
    openai_base_url?: string;
    openai_model?: string;
    openai_audio_model?: string;
    ollama_base_url?: string;
    ollama_model?: string;
    litellm_base_url?: string;
    litellm_model?: string;
    litellm_audio_model?: string;
    litellm_api_key?: string;
  }) {
    return api<{
      llm_provider: string;
      openai_api_key?: string;
      openai_base_url?: string;
      openai_model?: string;
      openai_audio_model?: string;
      ollama_base_url?: string;
      ollama_model?: string;
      litellm_base_url?: string;
      litellm_model?: string;
      litellm_audio_model?: string;
      litellm_api_key?: string;
    }>('/api/settings/llm', { method: 'PATCH', body: JSON.stringify(body) });
  },

  async listLiteLLMModels(baseUrl?: string) {
    const params = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : '';
    return api<{ models: string[]; error?: string }>(`/api/settings/litellm/models${params}`);
  },

  async listOllamaModels(baseUrl?: string) {
    const params = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : '';
    return api<{ models: string[]; error?: string }>(`/api/settings/ollama/models${params}`);
  },

  async listLlmConfigs() {
    return api<Array<{
      id: string;
      name: string;
      llm_provider: string;
      openai_api_key?: string;
      openai_base_url?: string;
      openai_model?: string;
      openai_audio_model?: string;
      ollama_base_url?: string;
      ollama_model?: string;
      litellm_base_url?: string;
      litellm_model?: string;
      litellm_audio_model?: string;
      litellm_api_key?: string;
      created_at?: string;
    }>>('/api/settings/llm-configs');
  },

  async createLlmConfig(body: {
    name: string;
    llm_provider: string;
    openai_api_key?: string;
    openai_base_url?: string;
    openai_model?: string;
    openai_audio_model?: string;
    ollama_base_url?: string;
    ollama_model?: string;
    litellm_base_url?: string;
    litellm_model?: string;
    litellm_audio_model?: string;
    litellm_api_key?: string;
  }) {
    return api('/api/settings/llm-configs', { method: 'POST', body: JSON.stringify(body) });
  },

  async getLlmConfig(id: string) {
    return api(`/api/settings/llm-configs/${id}`);
  },

  async updateLlmConfig(id: string, body: Record<string, unknown>) {
    return api(`/api/settings/llm-configs/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async setLlmConfigDefault(id: string) {
    return this.updateLlmConfig(id, { is_default: true });
  },

  async deleteLlmConfig(id: string) {
    return api(`/api/settings/llm-configs/${id}`, { method: 'DELETE' });
  },

  // Studio Summary (table executive reports)
  async generateTableSummary(agentId: string, sourceId?: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      report: string;
      queriesRun: Array<{ query: string; rows: unknown[]; error?: string }>;
      createdAt: string;
    }>('/api/table_summaries', {
      method: 'POST',
      body: JSON.stringify({ agentId, sourceId }),
    });
  },

  async listTableSummaries(agentId?: string) {
    const path = agentId ? `/api/table_summaries?agent_id=${encodeURIComponent(agentId)}` : '/api/table_summaries';
    return api<Array<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      report: string;
      queriesRun: unknown[];
      createdAt: string;
    }>>(path);
  },

  async getTableSummary(summaryId: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      report: string;
      queriesRun: unknown[];
      createdAt: string;
    }>(`/api/table_summaries/${summaryId}`);
  },

  async deleteTableSummary(summaryId: string) {
    return api<{ ok: boolean }>(`/api/table_summaries/${summaryId}`, { method: 'DELETE' });
  },

  async generateAudioOverview(agentId: string, sourceId?: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      script: string;
      mimeType: string;
      createdAt: string;
    }>('/api/audio_overviews', {
      method: 'POST',
      body: JSON.stringify({ agentId, sourceId }),
    });
  },

  async listAudioOverviews(agentId?: string) {
    const path = agentId ? `/api/audio_overviews?agent_id=${encodeURIComponent(agentId)}` : '/api/audio_overviews';
    return api<Array<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      script: string;
      mimeType: string;
      createdAt: string;
    }>>(path);
  },

  async fetchAudioOverviewBlob(audioOverviewId: string) {
    return apiBlob(`/api/audio_overviews/${audioOverviewId}/audio`);
  },

  async deleteAudioOverview(audioOverviewId: string) {
    return api<{ ok: boolean }>(`/api/audio_overviews/${audioOverviewId}`, { method: 'DELETE' });
  },

  // Platform logs (LLM activity across all workspaces)
  async listPlatformLogs(limit?: number) {
    const params = limit != null ? `?limit=${limit}` : '';
    return api<Array<{
      action: string;
      channel?: string;
      timestamp: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      source?: string;
      trace?: Record<string, unknown>;
    }>>(`/api/logs${params}`);
  },

  // Telegram Integration
  async listTelegramBotConfigs(): Promise<{
    env_config: {
      id: string;
      key: string;
      name: string;
      bot_username: string;
      masked_token: string;
      is_env: boolean;
    } | null;
    configs: Array<{
      id: string;
      key: string;
      name: string;
      bot_username: string;
      masked_token: string;
      is_env: boolean;
      created_at?: string;
    }>;
  }> {
    return api('/api/telegram/bot-configs');
  },

  async createTelegramBotConfig(body: { name: string; bot_token: string; bot_username: string }) {
    return api('/api/telegram/bot-configs', { method: 'POST', body: JSON.stringify(body) });
  },

  async deleteTelegramBotConfig(configId: string): Promise<{ message: string }> {
    return api(`/api/telegram/bot-configs/${configId}`, { method: 'DELETE' });
  },

  async generateTelegramConnectionLink(
    agentId: string,
    body?: { bot_key?: string }
  ): Promise<{ url: string; expires_at: string; bot_key?: string; bot_username?: string; bot_name?: string }> {
    return api(`/api/telegram/connection-link/${agentId}`, { method: 'POST', body: JSON.stringify(body || {}) });
  },

  async listTelegramConnections(agentId: string): Promise<{ connections: Array<{ id: string; chat_id: string; chat_title?: string; created_at: string; bot_key?: string; bot_username?: string; bot_name?: string }> }> {
    return api(`/api/telegram/connections/${agentId}`);
  },

  async deleteTelegramConnection(connectionId: string): Promise<{ message: string }> {
    return api(`/api/telegram/connections/${connectionId}`, { method: 'DELETE' });
  },
};
