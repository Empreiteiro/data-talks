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

  async deleteAgent(id: string) {
    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
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
  }
};