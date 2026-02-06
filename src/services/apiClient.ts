/**
 * Python API client (Data Talks backend).
 * Used when VITE_API_URL is set; replaces Supabase/Langflow.
 */
import { getApiUrl, getToken } from '@/config';

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
    throw new Error(err.detail || err.error || String(res.status));
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
    throw new Error(err.detail || err.error || String(res.status));
  }
  return res.json();
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

  async getAgent(id: string) {
    return api<{ id: string; name: string; description: string; source_ids: string[]; suggested_questions: string[] }>(`/api/agents/${id}`);
  },

  async listAgents() {
    const data = await api<Array<{ id: string; name: string; description: string; source_ids: string[]; suggested_questions: string[]; created_at: string; updated_at: string; source_count: number }>>('/api/agents');
    return (data || []).map((a) => ({
      ...a,
      suggested_questions: a.suggested_questions || [],
    }));
  },

  async createAgent(name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[]) {
    return api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name, source_ids: sourceIds, description: description || '', suggested_questions: suggestedQuestions || [] }),
    });
  },

  async updateAgent(id: string, name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[]) {
    return api(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, source_ids: sourceIds, description: description || '', suggested_questions: suggestedQuestions || [] }),
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
      imageUrl: s.imageUrl ?? (s.table_data && s.table_data.image_url),
      answerTableJSON: s.table_data?.table,
      latencyMs: s.latency,
      followUpQuestions: s.follow_up_questions || [],
      conversationHistory: s.conversation_history || [],
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
    const data = await api<{ answer: string; imageUrl?: string; sessionId?: string; followUpQuestions?: string[] }>('/api/ask-question', {
      method: 'POST',
      body: JSON.stringify({ question, agentId, sessionId }),
    });
    return data;
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
};
