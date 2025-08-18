export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          share_password: string | null
          share_token: string | null
          source_ids: string[]
          suggested_questions: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          share_password?: string | null
          share_token?: string | null
          source_ids?: string[]
          suggested_questions?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          share_password?: string | null
          share_token?: string | null
          source_ids?: string[]
          suggested_questions?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          agent_id: string
          created_at: string
          day_of_month: number | null
          day_of_week: number | null
          email: string
          execution_time: string | null
          frequency: string
          id: string
          name: string
          next_run: string | null
          question: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          email: string
          execution_time?: string | null
          frequency: string
          id?: string
          name: string
          next_run?: string | null
          question: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          email?: string
          execution_time?: string | null
          frequency?: string
          id?: string
          name?: string
          next_run?: string | null
          question?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_sessions: {
        Row: {
          agent_id: string
          answer: string | null
          conversation_history: Json | null
          created_at: string
          feedback: string | null
          follow_up_questions: Json | null
          id: string
          is_shared: boolean | null
          latency: number | null
          question: string
          sql_query: string | null
          status: string | null
          table_data: Json | null
          user_id: string
        }
        Insert: {
          agent_id: string
          answer?: string | null
          conversation_history?: Json | null
          created_at?: string
          feedback?: string | null
          follow_up_questions?: Json | null
          id?: string
          is_shared?: boolean | null
          latency?: number | null
          question: string
          sql_query?: string | null
          status?: string | null
          table_data?: Json | null
          user_id: string
        }
        Update: {
          agent_id?: string
          answer?: string | null
          conversation_history?: Json | null
          created_at?: string
          feedback?: string | null
          follow_up_questions?: Json | null
          id?: string
          is_shared?: boolean | null
          latency?: number | null
          question?: string
          sql_query?: string | null
          status?: string | null
          table_data?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string
          id: string
          langflow_name: string | null
          langflow_path: string | null
          metadata: Json | null
          name: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          langflow_name?: string | null
          langflow_path?: string | null
          metadata?: Json | null
          name: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          langflow_name?: string | null
          langflow_path?: string | null
          metadata?: Json | null
          name?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      block_sensitive_agent_columns: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      can_access_alert_email: {
        Args: { alert_user_id: string }
        Returns: boolean
      }
      get_agent_share_token: {
        Args: { agent_id: string }
        Returns: string
      }
      get_shared_agent_qa_sessions: {
        Args: { token_value: string }
        Returns: {
          answer: string
          created_at: string
          feedback: string
          id: string
          latency: number
          question: string
          sql_query: string
          status: string
          table_data: Json
        }[]
      }
      get_shared_agent_safe_fields: {
        Args: { token_value: string }
        Returns: {
          created_at: string
          description: string
          has_password: boolean
          id: string
          name: string
        }[]
      }
      get_user_agents_safe: {
        Args: Record<PropertyKey, never>
        Returns: {
          created_at: string
          description: string
          has_password: boolean
          has_share_token: boolean
          id: string
          name: string
          source_ids: string[]
          suggested_questions: string[]
          updated_at: string
        }[]
      }
      update_agent_share_password_only: {
        Args: { agent_id: string; password: string }
        Returns: boolean
      }
      update_agent_sharing: {
        Args: { agent_id: string; enabled: boolean; password?: string }
        Returns: {
          created_at: string
          description: string
          has_share_token: boolean
          id: string
          name: string
          share_token: string
          source_ids: string[]
          suggested_questions: string[]
          updated_at: string
        }[]
      }
      verify_agent_share_password: {
        Args: { password_attempt: string; token_value: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
