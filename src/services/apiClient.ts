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

// Medallion Architecture types
export interface MedallionLayerOut {
  id: string;
  sourceId: string;
  agentId: string;
  layer: 'bronze' | 'silver' | 'gold';
  tableName: string;
  status: 'pending' | 'ready' | 'error';
  schemaConfig: Record<string, unknown>;
  ddlSql: string;
  transformSql?: string | null;
  rowCount?: number | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface MedallionBuildLogOut {
  id: string;
  layerId?: string | null;
  action: string;
  layer: string;
  inputFeedback?: string | null;
  suggestion?: Record<string, unknown> | null;
  appliedConfig?: Record<string, unknown> | null;
  llmUsage?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt?: string | null;
}

export interface SilverColumnSuggestion {
  source_column: string;
  silver_name: string;
  target_type: string;
  transform: string;
  null_strategy: string;
  null_default?: string | null;
}

export interface SilverSuggestResponse {
  suggestion: {
    columns: SilverColumnSuggestion[];
    dedup_key: string[];
    dedup_order_by?: string | null;
    explanation?: string;
  };
  ddlPreview: string;
  transformPreview: string;
  buildLogId: string;
}

export interface GoldTableSuggestion {
  name: string;
  description: string;
  sql: string;
  dimensions: string[];
  measures: { column: string; agg_func: string; alias: string }[];
  explanation?: string;
}

export interface GoldSuggestResponse {
  suggestions: GoldTableSuggestion[];
  ddlPreviews: string[];
  buildLogId: string;
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
    const data = await api<Array<{ id: string; name: string; type: string; ownerId: string; agent_id?: string; is_active?: boolean; createdAt: string; metaJSON: Record<string, unknown>; langflowPath?: string; langflowName?: string }>>(path);
    return (data || []).map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
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

  async createSource(name: string, type: string, metadata: Record<string, unknown>, agentId?: string) {
    const data = await api<{ id: string; name: string; type: string; ownerId: string; createdAt: string; metaJSON: Record<string, unknown> }>('/api/sources', {
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
    return api<{ metaJSON: Record<string, unknown> }>(`/api/bigquery/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  async firebaseListCollections(body: { credentialsContent?: string; sourceId?: string }) {
    return api<{ collections: Array<{ id: string; name: string }> }>('/api/firebase/collections', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async refreshSourceFirebaseMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/firebase/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // MongoDB
  async mongodbTestConnection(body: { connectionString: string }) {
    return api<{ ok: boolean }>('/api/mongodb/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async mongodbListDatabases(body: { connectionString: string }) {
    return api<{ databases: Array<{ id: string; name: string }> }>('/api/mongodb/databases', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async mongodbListCollections(body: { connectionString: string; database: string }) {
    return api<{ collections: Array<{ id: string; name: string }> }>('/api/mongodb/collections', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async mongodbRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/mongodb/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Snowflake
  async snowflakeTestConnection(body: { account: string; user: string; password: string }) {
    return api<{ ok: boolean }>('/api/snowflake/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async snowflakeListWarehouses(body: { account: string; user: string; password: string }) {
    return api<{ warehouses: Array<{ id: string; name: string }> }>('/api/snowflake/warehouses', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async snowflakeListDatabases(body: { account: string; user: string; password: string }) {
    return api<{ databases: Array<{ id: string; name: string }> }>('/api/snowflake/databases', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async snowflakeListSchemas(body: { account: string; user: string; password: string; database: string }) {
    return api<{ schemas: Array<{ id: string; name: string }> }>('/api/snowflake/schemas', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async snowflakeListTables(body: { account: string; user: string; password: string; database: string; schema: string }) {
    return api<{ tables: Array<{ id: string; name: string }> }>('/api/snowflake/tables', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async snowflakeRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/snowflake/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Notion
  async notionTestConnection(body: { integrationToken: string }) {
    return api<{ ok: boolean }>('/api/notion/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async notionListDatabases(body: { integrationToken: string }) {
    return api<{ databases: Array<{ id: string; name: string }> }>('/api/notion/databases', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async notionRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/notion/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Jira
  async jiraTestConnection(body: { domain: string; email: string; apiToken: string }) {
    return api<{ ok: boolean; displayName: string }>('/api/jira/test-connection', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async jiraDiscover(body: { domain: string; email: string; apiToken: string }) {
    return api<{ projects: Array<{ id: string; key: string; name: string }>; boards: Array<{ id: number; name: string; type: string }> }>('/api/jira/discover', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async jiraRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/jira/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // HubSpot CRM
  async hubspotTestConnection(body: { apiKey: string }) {
    return api<{ ok: boolean }>('/api/hubspot/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async hubspotDiscover(body: { apiKey: string }) {
    return api<{ objectCounts: Record<string, number> }>('/api/hubspot/discover', { method: 'POST', body: JSON.stringify(body) });
  },
  async hubspotRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/hubspot/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Stripe
  async stripeTestConnection(body: { apiKey: string }) {
    return api<{ ok: boolean; balance: Record<string, unknown> }>('/api/stripe/test-connection', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async stripeDiscover(body: { apiKey: string; tables?: string[] }) {
    return api<{ resources: Array<{ table: string; fields: string[]; has_more: boolean; sample_count: number; preview: Record<string, unknown>[]; _error?: string }> }>('/api/stripe/discover', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async stripeRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/stripe/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Pipedrive CRM
  async pipedriveTestConnection(body: { apiToken: string }) {
    return api<{ ok: boolean; userName: string }>('/api/pipedrive/test-connection', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async pipedriveDiscover(body: { apiToken: string }) {
    return api<{ resourceCounts: Record<string, number> }>('/api/pipedrive/discover', {
      method: 'POST', body: JSON.stringify(body),
    });
  },
  async pipedriveRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/pipedrive/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Salesforce CRM
  async salesforceTestConnection(body: { accessToken: string; instanceUrl: string }) {
    return api<{ ok: boolean }>('/api/salesforce/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async salesforceDiscover(body: { accessToken: string; instanceUrl: string }) {
    return api<{ objectCounts: Record<string, number> }>('/api/salesforce/discover', { method: 'POST', body: JSON.stringify(body) });
  },
  async salesforceRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/salesforce/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Google Analytics 4
  async ga4TestConnection(body: { credentialsContent: string; propertyId: string }) {
    return api<{ ok: boolean }>('/api/ga4/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async ga4Discover(body: { credentialsContent: string; propertyId: string }) {
    return api<{ tables: Array<{ name: string; rowCount: number }> }>('/api/ga4/discover', { method: 'POST', body: JSON.stringify(body) });
  },
  async ga4RefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/ga4/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Intercom
  async intercomTestConnection(body: { accessToken: string }) {
    return api<{ ok: boolean }>('/api/intercom/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async intercomDiscover(body: { accessToken: string }) {
    return api<{ resources: Array<{ name: string; count: number }> }>('/api/intercom/discover', { method: 'POST', body: JSON.stringify(body) });
  },
  async intercomRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/intercom/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // GitHub Analytics
  async githubAnalyticsTestConnection(body: { token: string; owner: string; repo: string }) {
    return api<{ ok: boolean }>('/api/github-analytics/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async githubAnalyticsDiscover(body: { token: string; owner: string; repo: string }) {
    return api<{ tables: Array<{ name: string; count: number }> }>('/api/github-analytics/discover', { method: 'POST', body: JSON.stringify(body) });
  },
  async githubAnalyticsRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/github-analytics/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Shopify
  async shopifyTestConnection(body: { store: string; accessToken: string }) {
    return api<{ ok: boolean }>('/api/shopify/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async shopifyDiscover(body: { store: string; accessToken: string }) {
    return api<{ resources: Array<{ name: string; count: number }> }>('/api/shopify/discover', { method: 'POST', body: JSON.stringify(body) });
  },
  async shopifyRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/shopify/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // Excel Online
  async excelOnlineListFiles(body: { accessToken: string }) {
    return api<{ files: Array<{ id: string; name: string; driveId: string; size: number; webUrl: string }> }>('/api/excel-online/files', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async excelOnlineListSheets(body: { accessToken: string; driveId: string; itemId: string }) {
    return api<{ sheets: Array<{ id: string; name: string }> }>('/api/excel-online/sheets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async excelOnlineRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/excel-online/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // S3 / MinIO
  async s3TestConnection(body: { accessKeyId: string; secretAccessKey: string; region?: string; endpoint?: string }) {
    return api<{ ok: boolean }>('/api/s3/test-connection', { method: 'POST', body: JSON.stringify(body) });
  },
  async s3ListBuckets(body: { accessKeyId: string; secretAccessKey: string; region?: string; endpoint?: string }) {
    return api<{ buckets: Array<{ id: string; name: string }> }>('/api/s3/buckets', { method: 'POST', body: JSON.stringify(body) });
  },
  async s3ListObjects(body: { accessKeyId: string; secretAccessKey: string; region?: string; endpoint?: string; bucket: string; prefix?: string }) {
    return api<{ objects: Array<{ key: string; size: number; lastModified: string }> }>('/api/s3/objects', { method: 'POST', body: JSON.stringify(body) });
  },
  async s3RefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/s3/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  // REST API
  async restApiTest(body: { url: string; method?: string; headers?: Record<string, string>; queryParams?: Record<string, string>; body?: unknown; dataPath?: string }) {
    return api<{ columns: string[]; preview: Record<string, unknown>[]; rowCount: number }>('/api/rest-api/test', { method: 'POST', body: JSON.stringify(body) });
  },
  async restApiRefreshMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/rest-api/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  async dbtValidateManifest(body: Record<string, unknown>) {
    return api<{ models: Array<{ name: string; columns: string[]; description: string }>; total: number }>('/api/dbt/validate-manifest', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async dbtRefreshSourceMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown>; modelCount: number }>(`/api/dbt/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
  },
  async githubValidateFile(body: Record<string, unknown>) {
    return api<{ columns: string[]; previewRows: Record<string, unknown>[]; rowCount: number }>('/api/github/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async githubListFiles(body: Record<string, unknown>) {
    return api<{ files: Array<{ name: string; path: string; size: number }> }>('/api/github/list-files', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  async githubRefreshSourceMetadata(sourceId: string) {
    return api<{ metaJSON: Record<string, unknown> }>(`/api/github/sources/${sourceId}/refresh-metadata`, { method: 'POST' });
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
    return api<{ id: string; name: string; description: string; workspace_type?: string; workspace_config?: Record<string, unknown>; source_ids: string[]; source_relationships: SqlSourceRelationship[]; suggested_questions: string[]; llm_config_id?: string | null; sql_mode?: boolean }>(`/api/agents/${id}`);
  },

  async listAgents() {
    const data = await api<Array<{ id: string; name: string; description: string; source_ids: string[]; source_relationships: SqlSourceRelationship[]; suggested_questions: string[]; created_at: string; updated_at: string; source_count: number }>>('/api/agents');
    return (data || []).map((a) => ({
      ...a,
      source_relationships: a.source_relationships || [],
      suggested_questions: a.suggested_questions || [],
    }));
  },

  async createAgent(name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[], sourceRelationships?: SqlSourceRelationship[], workspaceType?: string) {
    return api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name, source_ids: sourceIds, description: description || '', suggested_questions: suggestedQuestions || [], source_relationships: sourceRelationships || [], workspace_type: workspaceType || 'analysis' }),
    });
  },

  async suggestQuestions(agentId: string, language?: string) {
    return api<{ questions: string[] }>(`/api/agents/${agentId}/suggest-questions`, {
      method: 'POST',
      body: JSON.stringify({ language }),
    });
  },

  async createDemoWorkspace(workspaceType: string) {
    return api<{ id: string; name: string; workspace_type: string; source_count: number }>('/api/demo/create', {
      method: 'POST',
      body: JSON.stringify({ workspace_type: workspaceType }),
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
    const data = await api<Record<string, unknown>[]>(path);
    return (data || []).map((s) => ({
      ...s,
      answerText: s.answer,
      imageUrl: toApiAssetUrl(s.imageUrl ?? (s.table_data && s.table_data.image_url)),
      answerTableJSON: s.table_data?.table,
      latencyMs: s.latency,
      followUpQuestions: s.follow_up_questions || [],
      conversationHistory: (s.conversation_history || []).map((entry) => ({
        ...entry,
        imageUrl: toApiAssetUrl(entry.imageUrl),
      })),
    }));
  },

  async deleteQASession(id: string) {
    await api(`/api/qa_sessions/${id}`, { method: 'DELETE' });
  },

  async updateQASession(id: string, body: { conversation_history?: Record<string, unknown>[] }) {
    await api(`/api/qa_sessions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async updateQASessionFeedback(id: string, feedback: 'positive' | 'negative') {
    await api(`/api/qa_sessions/${id}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback }) });
  },

  async listAlerts(agentId?: string) {
    const path = agentId ? `/api/alerts?agent_id=${encodeURIComponent(agentId)}` : '/api/alerts';
    return api(path);
  },

  async createAlert(agentId: string, name: string, question: string, email: string, frequency: string, executionTime: string, dayOfWeek?: number, dayOfMonth?: number, type?: string) {
    return api('/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ agentId, name, question, email, frequency, executionTime, dayOfWeek, dayOfMonth, type: type || 'alert' }),
    });
  },

  async updateAlert(id: string, body: Record<string, unknown>) {
    return api(`/api/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteAlert(id: string) {
    await api(`/api/alerts/${id}`, { method: 'DELETE' });
  },

  async testAlert(id: string) {
    return api<{ status: string; answer?: string; error?: string; email_sent?: boolean; webhooks_fired?: number; duration_ms?: number }>(`/api/alerts/${id}/test`, { method: 'POST' });
  },

  async listAlertExecutions(alertId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return api<Array<{
      id: string;
      status: string;
      answer?: string;
      error_message?: string;
      email_sent: boolean;
      webhooks_fired: number;
      duration_ms?: number;
      created_at: string;
    }>>(`/api/alerts/${alertId}/executions${params}`);
  },

  // Webhooks
  async listWebhooks(agentId?: string) {
    const path = agentId ? `/api/webhooks?agent_id=${encodeURIComponent(agentId)}` : '/api/webhooks';
    return api<Array<{
      id: string;
      name: string;
      url: string;
      agent_id?: string;
      events: string[];
      secret?: string;
      is_active: boolean;
      last_triggered_at?: string;
      last_status_code?: number;
      created_at: string;
    }>>(path);
  },

  async createWebhook(body: { name: string; url: string; agent_id?: string; events?: string[] }) {
    return api('/api/webhooks', { method: 'POST', body: JSON.stringify(body) });
  },

  async updateWebhook(id: string, body: Record<string, unknown>) {
    return api(`/api/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteWebhook(id: string) {
    await api(`/api/webhooks/${id}`, { method: 'DELETE' });
  },

  async uploadFile(file: File, _selectedSheet?: string) {
    const form = new FormData();
    form.append('file', file);
    const data = await apiFormData<{ id: string; name: string; type: string; ownerId: string; createdAt: string; metaJSON: Record<string, unknown> }>('/api/sources/upload', form);
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
    const data = await api<{ answer: string; imageUrl?: string; sessionId?: string; followUpQuestions?: string[]; turnId?: string; chartInput?: unknown }>('/api/ask-question', {
      method: 'POST',
      body: JSON.stringify({ question, agentId, sessionId }),
    });
    return {
      ...data,
      imageUrl: toApiAssetUrl(data.imageUrl),
    };
  },

  async generateChartForTurn(sessionId: string, body: { turnId?: string; turnIndex?: number }) {
    const data = await api<{ imageUrl: string; matplotlibScript?: string; chartSpec?: unknown; turnId?: string }>(`/api/ask-question/${sessionId}/chart`, {
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

  async getLlmStatus() {
    return api<{ configured: boolean; has_env: boolean; has_account: boolean; has_configs: boolean }>('/api/settings/llm-status');
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
      google_api_key?: string;
      google_model?: string;
      anthropic_api_key?: string;
      anthropic_model?: string;
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
    google_api_key?: string;
    google_model?: string;
    anthropic_api_key?: string;
    anthropic_model?: string;
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
      google_api_key?: string;
      google_model?: string;
      anthropic_api_key?: string;
      anthropic_model?: string;
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
      google_api_key?: string;
      google_model?: string;
      anthropic_api_key?: string;
      anthropic_model?: string;
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
    google_api_key?: string;
    google_model?: string;
    anthropic_api_key?: string;
    anthropic_model?: string;
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
  async generateTableSummary(agentId: string, sourceId?: string, language?: string) {
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
      body: JSON.stringify({ agentId, sourceId, language }),
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

  // Studio Reports (rich HTML reports with exploratory charts)
  async generateReport(agentId: string, sourceId?: string, language?: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      chartCount: number;
      createdAt: string;
    }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ agentId, sourceId, language }),
    });
  },

  async listReports(agentId?: string) {
    const path = agentId ? `/api/reports?agent_id=${encodeURIComponent(agentId)}` : '/api/reports';
    return api<Array<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      chartCount: number;
      createdAt: string;
    }>>(path);
  },

  async getReport(reportId: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      chartCount: number;
      createdAt: string;
    }>(`/api/reports/${reportId}`);
  },

  async getReportHtml(reportId: string): Promise<string> {
    const token = localStorage.getItem('dt_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(`/api/reports/${reportId}/html`, { headers });
    if (!resp.ok) throw new Error(`Failed to fetch report HTML: ${resp.status}`);
    return resp.text();
  },

  async deleteReport(reportId: string) {
    return api<{ ok: boolean }>(`/api/reports/${reportId}`, { method: 'DELETE' });
  },

  // Auto ML
  async trainAutoML(agentId: string, sourceId: string, targetColumn: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      targetColumn: string;
      taskType: string;
      modelType: string;
      metrics: Record<string, unknown>;
      featureImportance: Array<{ feature: string; importance: number }>;
      report: string;
      createdAt: string;
    }>('/api/automl/train', {
      method: 'POST',
      body: JSON.stringify({ agentId, sourceId, targetColumn }),
    });
  },

  async listAutoMLRuns(agentId?: string) {
    const path = agentId ? `/api/automl?agent_id=${encodeURIComponent(agentId)}` : '/api/automl';
    return api<Array<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      targetColumn: string;
      taskType: string;
      modelType: string;
      metrics: Record<string, unknown>;
      featureImportance: Array<{ feature: string; importance: number }>;
      report: string;
      createdAt: string;
    }>>(path);
  },

  async getAutoMLRun(runId: string) {
    return api<{
      id: string;
      agentId: string;
      sourceId: string;
      sourceName: string;
      targetColumn: string;
      taskType: string;
      modelType: string;
      metrics: Record<string, unknown>;
      featureImportance: Array<{ feature: string; importance: number }>;
      report: string;
      createdAt: string;
    }>(`/api/automl/${runId}`);
  },

  async deleteAutoMLRun(runId: string) {
    return api<{ ok: boolean }>(`/api/automl/${runId}`, { method: 'DELETE' });
  },

  async getAutoMLColumns(agentId: string, sourceId: string) {
    return api<{ columns: string[] }>(`/api/automl/columns?agent_id=${encodeURIComponent(agentId)}&source_id=${encodeURIComponent(sourceId)}`);
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

  // WhatsApp Integration
  async listWhatsAppBotConfigs(): Promise<{
    env_config: {
      id: string;
      key: string;
      name: string;
      phone_number_id: string;
      masked_token: string;
      is_env: boolean;
    } | null;
    configs: Array<{
      id: string;
      key: string;
      name: string;
      phone_number_id: string;
      masked_token: string;
      is_env: boolean;
      created_at?: string;
    }>;
  }> {
    return api('/api/whatsapp/bot-configs');
  },

  async createWhatsAppBotConfig(body: { name: string; phone_number_id: string; access_token: string; verify_token: string }) {
    return api('/api/whatsapp/bot-configs', { method: 'POST', body: JSON.stringify(body) });
  },

  async deleteWhatsAppBotConfig(configId: string): Promise<{ message: string }> {
    return api(`/api/whatsapp/bot-configs/${configId}`, { method: 'DELETE' });
  },

  async createWhatsAppConnection(
    agentId: string,
    body: { config_key: string }
  ): Promise<{ id: string; agent_id: string; phone_number_id: string; config_name?: string; created_at: string }> {
    return api(`/api/whatsapp/connections/${agentId}`, { method: 'POST', body: JSON.stringify(body) });
  },

  async listWhatsAppConnections(agentId: string): Promise<{ connections: Array<{ id: string; phone_number_id: string; config_name?: string; created_at: string }> }> {
    return api(`/api/whatsapp/connections/${agentId}`);
  },

  async deleteWhatsAppConnection(connectionId: string): Promise<{ message: string }> {
    return api(`/api/whatsapp/connections/${connectionId}`, { method: 'DELETE' });
  },

  // Slack Integration
  async listSlackBotConfigs(): Promise<{
    env_config: {
      id: string;
      key: string;
      name: string;
      masked_token: string;
      team_id?: string;
      team_name?: string;
      is_env: boolean;
    } | null;
    configs: Array<{
      id: string;
      key: string;
      name: string;
      masked_token: string;
      team_id?: string;
      team_name?: string;
      is_env: boolean;
      has_token?: boolean;
      created_at?: string;
    }>;
  }> {
    return api('/api/slack/bot-configs');
  },

  async createSlackBotConfig(body: { name: string; client_id: string; client_secret: string; signing_secret: string }) {
    return api('/api/slack/bot-configs', { method: 'POST', body: JSON.stringify(body) });
  },

  async deleteSlackBotConfig(configId: string): Promise<{ message: string }> {
    return api(`/api/slack/bot-configs/${configId}`, { method: 'DELETE' });
  },

  async createSlackConnection(
    agentId: string,
    body: { config_key: string; channel_id: string }
  ): Promise<{ id: string; channel_id: string; channel_name?: string; team_id?: string; created_at: string }> {
    return api(`/api/slack/channels/${agentId}`, { method: 'POST', body: JSON.stringify(body) });
  },

  async listSlackConnections(agentId: string): Promise<{ connections: Array<{ id: string; channel_id: string; channel_name?: string; team_id?: string; config_name?: string; created_at: string }> }> {
    return api(`/api/slack/channels/${agentId}`);
  },

  async deleteSlackConnection(connectionId: string): Promise<{ message: string }> {
    return api(`/api/slack/channels/${connectionId}`, { method: 'DELETE' });
  },

  // API Keys (external agent access)
  async listApiKeys(agentId?: string): Promise<Array<{
    id: string;
    agent_id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    is_active: boolean;
    last_used_at: string | null;
    created_at: string;
  }>> {
    const path = agentId ? `/api/api-keys?agent_id=${encodeURIComponent(agentId)}` : '/api/api-keys';
    return api(path);
  },

  async createApiKey(body: { agent_id: string; name: string }): Promise<{
    id: string;
    agent_id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    is_active: boolean;
    last_used_at: string | null;
    created_at: string;
    raw_key: string;
  }> {
    return api('/api/api-keys', { method: 'POST', body: JSON.stringify(body) });
  },

  async deleteApiKey(keyId: string): Promise<{ ok: boolean }> {
    return api(`/api/api-keys/${keyId}`, { method: 'DELETE' });
  },

  async updateApiKey(keyId: string, body: { name?: string; is_active?: boolean }): Promise<{
    id: string;
    agent_id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    is_active: boolean;
    last_used_at: string | null;
    created_at: string;
  }> {
    return api(`/api/api-keys/${keyId}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  // Audit Trail
  async listAuditLogs(params?: {
    limit?: number;
    offset?: number;
    category?: string;
    action?: string;
    user_id?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{
    total: number;
    items: Array<{
      id: string;
      user_id?: string;
      user_email?: string;
      action: string;
      category: string;
      resource_type?: string;
      resource_id?: string;
      detail?: string;
      ip_address?: string;
      metadata?: Record<string, unknown>;
      created_at: string;
    }>;
  }> {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      });
    }
    const q = qs.toString();
    return api(`/api/audit${q ? `?${q}` : ''}`);
  },

  async exportAuditCsv(params?: {
    category?: string;
    action?: string;
    user_id?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<Blob> {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      });
    }
    const q = qs.toString();
    return apiBlob(`/api/audit/export${q ? `?${q}` : ''}`);
  },

  async getAuditRetention(): Promise<{ retention_days: number; updated_at?: string }> {
    return api('/api/audit/retention');
  },

  async updateAuditRetention(retentionDays: number): Promise<{ retention_days: number }> {
    return api('/api/audit/retention', {
      method: 'PATCH',
      body: JSON.stringify({ retention_days: retentionDays }),
    });
  },

  async applyAuditRetention(): Promise<{ deleted: number }> {
    return api('/api/audit/retention/apply', { method: 'POST' });
  },

  // Report Templates
  async listTemplates(sourceId: string) {
    return api<Array<{
      id: string;
      name: string;
      sourceType: string;
      description: string;
      queries: Array<{ id: string; title: string; sql: string; chart_type: string; chart_config: Record<string, unknown> }>;
      layout: string;
      refreshInterval: number;
      isBuiltin: boolean;
      queryCount: number;
    }>>(`/api/templates/sources/${sourceId}/templates`);
  },

  async runTemplate(sourceId: string, templateId: string, body?: {
    filters?: Record<string, unknown>;
    dateRange?: { start?: string; end?: string };
    disabledQueries?: string[];
  }) {
    return api<{
      runId: string;
      templateId: string;
      templateName: string;
      status: string;
      results: Array<{
        queryId: string;
        title: string;
        rows: Record<string, unknown>[];
        chartSpec: { chartType: string; title: string; categories: string[]; series: Array<{ name: string; values: number[] }> } | null;
        error: string | null;
      }>;
      durationMs: number | null;
      createdAt: string;
    }>(`/api/templates/sources/${sourceId}/templates/${templateId}/run`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    });
  },

  async listTemplateRuns(sourceId: string, templateId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return api<Array<{
      runId: string;
      templateId: string;
      status: string;
      durationMs: number | null;
      createdAt: string;
    }>>(`/api/templates/sources/${sourceId}/templates/${templateId}/runs${params}`);
  },

  async customizeTemplate(sourceId: string, templateId: string, body: {
    filters?: Record<string, unknown>;
    dateRange?: { start?: string; end?: string };
    disabledQueries?: string[];
  }) {
    return api<{ ok: boolean }>(`/api/templates/sources/${sourceId}/templates/${templateId}/customize`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async resetTemplateCustomization(sourceId: string, templateId: string) {
    return api<{ ok: boolean }>(`/api/templates/sources/${sourceId}/templates/${templateId}/customize`, {
      method: 'DELETE',
    });
  },

  async generateTemplate(sourceId: string, body: { agentId: string; prompt?: string; language?: string }) {
    return api<{
      id: string;
      name: string;
      sourceType: string;
      description: string;
      queries: Array<{ id: string; title: string; sql: string; chart_type: string; chart_config: Record<string, unknown> }>;
      layout: string;
      refreshInterval: number;
      isBuiltin: boolean;
      queryCount: number;
    }>(`/api/templates/sources/${sourceId}/generate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteTemplate(sourceId: string, templateId: string) {
    return api<{ ok: boolean }>(`/api/templates/sources/${sourceId}/templates/${templateId}`, {
      method: 'DELETE',
    });
  },

  async runTemplateAsReport(sourceId: string, templateId: string, body: { agentId: string; language?: string }) {
    return api<{ id: string; sourceName: string; chartCount: number; createdAt: string }>(`/api/templates/sources/${sourceId}/templates/${templateId}/run-report`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listTemplateReports(sourceId: string, templateId: string) {
    return api<Array<{ id: string; sourceName: string; chartCount: number; createdAt: string }>>(`/api/templates/sources/${sourceId}/templates/${templateId}/reports`);
  },

  async updateTemplateQueries(sourceId: string, templateId: string, queries: Record<string, unknown>[]) {
    return api<{ queries: Record<string, unknown>[]; queryCount: number }>(`/api/templates/sources/${sourceId}/templates/${templateId}/queries`, {
      method: 'PATCH',
      body: JSON.stringify({ queries }),
    });
  },

  async addQueryToTemplate(sourceId: string, templateId: string, body: { agentId: string; description: string; language?: string }) {
    return api<{ query: Record<string, unknown>; queryCount: number }>(`/api/templates/sources/${sourceId}/templates/${templateId}/add-query`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async runTemplateWithCommentary(sourceId: string, templateId: string, body: {
    agentId: string; language?: string; filters?: Record<string, unknown>;
    dateRange?: { start?: string; end?: string }; disabledQueries?: string[];
  }) {
    return api<{
      runId: string; templateId: string; templateName: string; status: string;
      results: Array<{
        queryId: string; title: string; rows: Record<string, unknown>[];
        chartSpec: Record<string, unknown> | null; error: string | null;
        explanation?: string | null;
      }>;
      durationMs: number | null; createdAt: string;
    }>(`/api/templates/sources/${sourceId}/templates/${templateId}/run-with-commentary`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // -----------------------------------------------------------------------
  // Medallion Architecture
  // -----------------------------------------------------------------------

  async medallionListLayers(sourceId: string) {
    return api<MedallionLayerOut[]>(`/api/medallion/sources/${sourceId}/layers`);
  },

  async medallionListLogs(sourceId: string) {
    return api<MedallionBuildLogOut[]>(`/api/medallion/sources/${sourceId}/logs`);
  },

  async medallionGetLayer(layerId: string) {
    return api<MedallionLayerOut>(`/api/medallion/layers/${layerId}`);
  },

  async medallionGenerateBronze(body: { sourceId: string; agentId: string }) {
    return api<MedallionLayerOut>('/api/medallion/bronze/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async medallionSuggestSilver(body: { sourceId: string; agentId: string; feedback?: string }) {
    return api<SilverSuggestResponse>('/api/medallion/silver/suggest', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async medallionApplySilver(body: { sourceId: string; agentId: string; buildLogId: string; config: Record<string, unknown> }) {
    return api<MedallionLayerOut>('/api/medallion/silver/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async medallionSuggestGold(body: { sourceId: string; agentId: string; feedback?: string; reportPrompt?: string }) {
    return api<GoldSuggestResponse>('/api/medallion/gold/suggest', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async medallionApplyGold(body: { sourceId: string; agentId: string; buildLogId: string; selectedTables: Record<string, unknown>[] }) {
    return api<{ layers: MedallionLayerOut[]; totalRows: number }>('/api/medallion/gold/apply', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async medallionDeleteLayer(layerId: string) {
    return api<{ ok: boolean }>(`/api/medallion/layers/${layerId}`, { method: 'DELETE' });
  },
};
