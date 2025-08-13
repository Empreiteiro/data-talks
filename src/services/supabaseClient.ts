import { supabase } from "@/integrations/supabase/client";

export const supabaseClient = {
  // Sources
  async listSources() {
    const { data, error } = await supabase
      .from('sources')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async deleteSource(id: string) {
    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  // Agents
  async listAgents() {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async createAgent(name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('agents')
      .insert({
        user_id: user.id,
        name,
        description,
        source_ids: sourceIds,
        suggested_questions: suggestedQuestions || []
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateAgent(id: string, name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[]) {
    const { data, error } = await supabase
      .from('agents')
      .update({
        name,
        description,
        source_ids: sourceIds,
        suggested_questions: suggestedQuestions || []
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async deleteAgent(id: string) {
    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  async toggleAgentSharing(id: string, enabled: boolean, password?: string) {
    const updateData: any = {};
    
    if (enabled) {
      // Generate share token if enabling
      updateData.share_token = crypto.randomUUID();
      updateData.share_password = password || null;
    } else {
      // Clear sharing data if disabling
      updateData.share_token = null;
      updateData.share_password = null;
    }

    const { data, error } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateAgentSharePassword(id: string, password?: string) {
    const { data, error } = await supabase
      .from('agents')
      .update({
        share_password: password || null
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getSharedAgent(token: string) {
    const { data, error } = await supabase
      .rpc('get_shared_agent_safe_fields', { token_value: token });
    
    if (error) throw error;
    return data?.[0] || null;
  },

  async verifyAgentSharePassword(token: string, password: string) {
    const { data, error } = await supabase
      .rpc('verify_agent_share_password', { 
        token_value: token, 
        password_attempt: password 
      });
    
    if (error) throw error;
    return data;
  },

  // QA Sessions
  async listQASessions(agentId?: string) {
    let query = supabase
      .from('qa_sessions')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (agentId) {
      query = query.eq('agent_id', agentId);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  },

  async deleteQASession(id: string) {
    const { error } = await supabase
      .from('qa_sessions')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  // Alerts
  async listAlerts(agentId?: string) {
    let query = supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (agentId) {
      query = query.eq('agent_id', agentId);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  },

  async deleteAlert(id: string) {
    const { error } = await supabase
      .from('alerts')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  // File uploads
  async uploadFile(file: File) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    
    // Parse file content to extract schema and preview
    let fileInfo: any = {
      file_path: '',
      file_size: file.size,
      uploaded_at: new Date().toISOString(),
      row_count: 0,
      columns: [],
      preview_rows: []
    };

    try {
      if (fileExt === 'csv') {
        const text = await file.text();
        fileInfo = await this.parseCSV(text, fileInfo);
      } else if (['xlsx', 'xls'].includes(fileExt || '')) {
        fileInfo = await this.parseExcel(file, fileInfo);
      }
    } catch (parseError) {
      console.warn('Failed to parse file content:', parseError);
    }
    
    const { data, error } = await supabase.storage
      .from('data-files')
      .upload(fileName, file);
    
    if (error) throw error;
    
    fileInfo.file_path = data.path;
    
    // Create source record
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .insert({
        user_id: user.id,
        name: file.name,
        type: fileExt === 'csv' ? 'csv' : 'xlsx',
        metadata: fileInfo
      })
      .select()
      .single();
    
    if (sourceError) throw sourceError;
    return source;
  },

  async parseCSV(text: string, fileInfo: any) {
    const Papa = await import('papaparse');
    const result = Papa.parse(text, { 
      header: true, 
      skipEmptyLines: true,
      preview: 5 // Get first 5 rows for preview
    });
    
    if (result.data && result.data.length > 0) {
      fileInfo.columns = Object.keys(result.data[0] as object);
      fileInfo.preview_rows = result.data.slice(0, 5);
      
      // Parse full file to get row count
      const fullResult = Papa.parse(text, { header: true, skipEmptyLines: true });
      fileInfo.row_count = fullResult.data.length;
    }
    
    return fileInfo;
  },

  async parseExcel(file: File, fileInfo: any) {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Get first worksheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    if (jsonData && jsonData.length > 0) {
      fileInfo.columns = Object.keys(jsonData[0] as object);
      fileInfo.preview_rows = jsonData.slice(0, 5);
      fileInfo.row_count = jsonData.length;
    }
    
    return fileInfo;
  },

  // BigQuery connection
  async connectBigQuery(credentials: string, projectId: string, datasetId: string, tables: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase.functions.invoke('bigquery-connect', {
      body: {
        credentials,
        projectId,
        datasetId,
        tables
      }
    });

    if (error) throw error;
    if (data.error) throw new Error(data.error);
    
    return data;
  }
};