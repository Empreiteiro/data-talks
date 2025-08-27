import { supabase } from "@/integrations/supabase/client";
import { translateSupabaseError } from '@/utils/errorHandling';

export const supabaseClient = {
  // Sources
  async listSources() {
    const { data, error } = await supabase
      .from('sources')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Map database fields to expected interface
    return (data || []).map(source => ({
      id: source.id,
      name: source.name,
      type: source.type as 'csv' | 'xlsx' | 'bigquery',
      ownerId: source.user_id,
      createdAt: source.created_at,
      metaJSON: source.metadata,
      langflowPath: source.langflow_path,
      langflowName: source.langflow_name
    }));
  },

  async deleteSource(id: string) {
    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  // Agents - using secure functions to prevent exposure of sensitive fields
  async listAgents() {
    const { data, error } = await supabase
      .rpc('get_user_agents_safe');
    
    if (error) throw error;
    return data || [];
  },

  async createAgent(name: string, sourceIds: string[], description?: string, suggestedQuestions?: string[]) {
    try {
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
    } catch (error) {
      const friendlyError = translateSupabaseError(error);
      throw new Error(friendlyError);
    }
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
    const { data, error } = await supabase
      .rpc('update_agent_sharing', {
        agent_id: id,
        enabled: enabled,
        password: password || null
      });
    
    if (error) throw error;
    return data?.[0] || null;
  },

  async updateAgentSharePassword(id: string, password?: string) {
    const { data, error } = await supabase
      .rpc('update_agent_share_password_only', {
        agent_id: id,
        password: password || ''
      });
    
    if (error) throw error;
    return data;
  },

  async getAgentShareToken(id: string) {
    const { data, error } = await supabase
      .rpc('get_agent_share_token', { agent_id: id });
    
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

  // Get QA sessions for shared agents
  async getSharedAgentQASessions(token: string) {
    const { data, error } = await supabase.rpc('get_shared_agent_qa_sessions', {
      token_value: token
    });

    if (error) throw error;
    
    // Process the data to extract imageUrl from table_data and map fields correctly
    const processedData = (data || []).map((item: any) => ({
      ...item,
      answerText: item.answer,
      imageUrl: item.table_data?.image_url || null,
      answerTableJSON: item.table_data && item.table_data.table ? item.table_data.table : null,
      latencyMs: item.latency,
      followUpQuestions: item.follow_up_questions || [],
      conversationHistory: item.conversation_history || []
    }));
    
    return processedData;
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
    
    // Process the data to extract imageUrl from table_data and map fields correctly
    const processedData = (data || []).map((item: any) => ({
      ...item,
      answerText: item.answer,
      imageUrl: item.table_data?.image_url || null,
      answerTableJSON: item.table_data && item.table_data.table ? item.table_data.table : null,
      latencyMs: item.latency,
      followUpQuestions: item.follow_up_questions || [],
      conversationHistory: item.conversation_history || []
    }));
    
    return processedData;
  },

  async deleteQASession(id: string) {
    const { error } = await supabase
      .from('qa_sessions')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  // Update QA session feedback
  async updateQASessionFeedback(id: string, feedback: 'positive' | 'negative') {
    const { error } = await supabase
      .from('qa_sessions')
      .update({ feedback })
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

  async createAlert(
    agentId: string, 
    name: string, 
    question: string, 
    email: string, 
    frequency: string,
    executionTime: string,
    dayOfWeek?: number,
    dayOfMonth?: number
  ) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Calculate next run date based on frequency and timing
    const nextRun = new Date();
    const [hours, minutes] = executionTime.split(':').map(Number);
    
    switch (frequency) {
      case 'daily':
        nextRun.setDate(nextRun.getDate() + 1);
        nextRun.setHours(hours, minutes, 0, 0);
        break;
      case 'weekly':
        // Set to next occurrence of specified day of week
        const daysUntilTarget = (dayOfWeek! - nextRun.getDay() + 7) % 7;
        nextRun.setDate(nextRun.getDate() + (daysUntilTarget || 7));
        nextRun.setHours(hours, minutes, 0, 0);
        break;
      case 'monthly':
        // Set to next occurrence of specified day of month
        const currentDay = nextRun.getDate();
        if (currentDay < dayOfMonth!) {
          nextRun.setDate(dayOfMonth!);
        } else {
          nextRun.setMonth(nextRun.getMonth() + 1, dayOfMonth!);
        }
        nextRun.setHours(hours, minutes, 0, 0);
        break;
    }

    const { data, error } = await supabase
      .from('alerts')
      .insert({
        user_id: user.id,
        agent_id: agentId,
        name,
        question,
        email,
        frequency,
        execution_time: executionTime,
        day_of_week: dayOfWeek,
        day_of_month: dayOfMonth,
        next_run: nextRun.toISOString()
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // File uploads
  async uploadFile(file: File, selectedSheet?: string) {
    try {
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

      let fileToUpload: File = file;
      let finalFileExt = fileExt;
      let finalFileName = fileName;

      try {
        if (fileExt === 'csv') {
          const text = await file.text();
          fileInfo = await this.parseCSV(text, fileInfo);
        } else if (['xlsx', 'xls'].includes(fileExt || '')) {
          fileInfo = await this.parseExcel(file, fileInfo, selectedSheet);
          
          // Convert selected sheet to CSV
          if (selectedSheet) {
            const XLSX = await import('xlsx');
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            const worksheet = workbook.Sheets[selectedSheet];
            const csvContent = XLSX.utils.sheet_to_csv(worksheet);
            
            // Create CSV file
            const csvBlob = new Blob([csvContent], { type: 'text/csv' });
            fileToUpload = new File([csvBlob], file.name.replace(/\.(xlsx|xls)$/i, '.csv'), {
              type: 'text/csv'
            });
            
            finalFileExt = 'csv';
            finalFileName = `${user.id}/${Date.now()}.csv`;
          }
        }
      } catch (parseError) {
        console.warn('Failed to parse file content:', parseError);
      }
      
      const { data, error } = await supabase.storage
        .from('data-files')
        .upload(finalFileName, fileToUpload);
      
      if (error) throw error;
      
      fileInfo.file_path = data.path;
      
      // Upload to Langflow
      let langflowPath = null;
      let langflowName = null;
      
      try {
        const formData = new FormData();
        formData.append('file', fileToUpload);
        
        const { data: langflowData, error: langflowError } = await supabase.functions.invoke(
          'upload-to-langflow',
          {
            body: formData,
          }
        );

        if (langflowError) {
          console.error('Langflow upload error:', langflowError);
        } else if (langflowData) {
          langflowPath = langflowData.path;
          langflowName = langflowData.name;
          console.log('File uploaded to Langflow:', { path: langflowPath, name: langflowName });
        }
      } catch (error) {
        console.error('Error uploading to Langflow:', error);
        // Continue with source creation even if Langflow upload fails
      }
      
      // Create source record
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .insert({
          user_id: user.id,
          name: file.name,
          type: finalFileExt === 'csv' ? 'csv' : 'xlsx',
          langflow_path: langflowPath,
          langflow_name: langflowName,
          metadata: fileInfo
        })
        .select()
        .single();
      
      if (sourceError) throw sourceError;
      return source;
    } catch (error) {
      const friendlyError = translateSupabaseError(error);
      throw new Error(friendlyError);
    }
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

  async parseExcel(file: File, fileInfo: any, selectedSheet?: string) {
    const XLSX = await import('xlsx');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Use selected sheet or default to first sheet
    const sheetName = selectedSheet || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    if (jsonData && jsonData.length > 0) {
      fileInfo.columns = Object.keys(jsonData[0] as object);
      fileInfo.preview_rows = jsonData.slice(0, 5);
      fileInfo.row_count = jsonData.length;
      fileInfo.selected_sheet = sheetName;
      fileInfo.available_sheets = workbook.SheetNames;
    }
    
    return fileInfo;
  },

  // Get XLSX sheet names for sheet selection
  async getExcelSheets(file: File): Promise<string[]> {
    try {
      const XLSX = await import('xlsx');
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      return workbook.SheetNames;
    } catch (error) {
      console.error('Error reading Excel file:', error);
      return [];
    }
  },

  // BigQuery connection
  async connectBigQuery(credentials: string, projectId: string, datasetId: string, tables: string[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Create a file from the credentials string to upload to Langflow
    const credentialsBlob = new Blob([credentials], { type: 'application/json' });
    const credentialsFile = new File([credentialsBlob], `${projectId}-${datasetId}-credentials.json`, {
      type: 'application/json'
    });

    // Upload credentials to Langflow
    let langflowPath = null;
    let langflowName = null;
    
    try {
      const formData = new FormData();
      formData.append('file', credentialsFile);
      
      const { data: langflowData, error: langflowError } = await supabase.functions.invoke(
        'upload-to-langflow',
        {
          body: formData,
        }
      );

      if (langflowError) {
        console.error('Langflow upload error:', langflowError);
      } else if (langflowData) {
        langflowPath = langflowData.path;
        langflowName = langflowData.name;
        console.log('BigQuery credentials uploaded to Langflow:', { path: langflowPath, name: langflowName });
      }
    } catch (error) {
      console.error('Error uploading BigQuery credentials to Langflow:', error);
      // Continue with BigQuery connection even if Langflow upload fails
    }

    const { data, error } = await supabase.functions.invoke('bigquery-connect', {
      body: {
        credentials,
        projectId,
        datasetId,
        tables,
        langflowPath,
        langflowName
      }
    });

    if (error) throw error;
    if (data.error) throw new Error(data.error);
    
    return data;
  },

  // Ask question to agent
  async askQuestion(agentId: string, question: string, sessionId?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase.functions.invoke('ask-question', {
        body: { question, agentId, userId: user.id, sessionId }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      const friendlyError = translateSupabaseError(error);
      throw new Error(friendlyError);
    }
  },

  // Ask question to shared agent (without authentication)
  async askQuestionShared(agentId: string, question: string, shareToken: string, sessionId?: string) {
    try {
      const { data, error } = await supabase.functions.invoke('ask-question', {
        body: { question, agentId, shareToken, sessionId }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      const friendlyError = translateSupabaseError(error);
      throw new Error(friendlyError);
    }
  },
};
