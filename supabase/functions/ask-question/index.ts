import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, agentId, userId } = await req.json();

    if (!question || !agentId || !userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get agent information
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: 'Agent not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get source information
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', agent.source_ids);

    if (sourcesError) {
      return new Response(
        JSON.stringify({ error: 'Error fetching sources' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build context from sources
    let context = '';
    let hasTableData = false;
    let sampleData: any[] = [];

    for (const source of sources) {
      context += `Fonte: ${source.name}\n`;
      context += `Tipo: ${source.type}\n`;
      
      if (source.metadata) {
        if (source.type === 'csv' && source.metadata.columns) {
          context += `Colunas: ${source.metadata.columns.join(', ')}\n`;
          context += `Total de linhas: ${source.metadata.row_count}\n`;
          if (source.metadata.preview_rows) {
            context += `Exemplos de dados:\n${JSON.stringify(source.metadata.preview_rows.slice(0, 3), null, 2)}\n`;
            sampleData = source.metadata.preview_rows;
            hasTableData = true;
          }
        } else if (source.type === 'bigquery' && source.metadata.table_infos) {
          for (const tableInfo of source.metadata.table_infos) {
            context += `Tabela: ${tableInfo.table_name}\n`;
            context += `Colunas: ${tableInfo.columns.join(', ')}\n`;
            context += `Total de linhas: ${tableInfo.row_count}\n`;
            if (tableInfo.preview_rows) {
              context += `Exemplos de dados:\n${JSON.stringify(tableInfo.preview_rows.slice(0, 3), null, 2)}\n`;
              sampleData = tableInfo.preview_rows;
              hasTableData = true;
            }
          }
        }
      }
      context += '\n';
    }

    // Create AI prompt
    const systemPrompt = `Você é um assistente de análise de dados especializado em responder perguntas sobre conjuntos de dados.

Contexto dos dados disponíveis:
${context}

INSTRUÇÕES IMPORTANTES:
- Responda APENAS com base nos dados fornecidos no contexto
- Se a pergunta não puder ser respondida com os dados disponíveis, informe isso claramente
- Seja preciso e conciso em suas respostas
- Se possível, forneça exemplos específicos dos dados
- Para perguntas numéricas, tente fornecer valores aproximados baseados nos dados de exemplo
- Use linguagem clara e profissional em português brasileiro`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0.1,
      }),
    });

    const aiData = await response.json();
    
    if (!response.ok) {
      console.error('OpenAI API error:', aiData);
      throw new Error('Erro na API do OpenAI');
    }

    const answer = aiData.choices[0].message.content;
    const latency = Date.now() - startTime;

    // Filter sample data based on the question to provide relevant table data
    let tableData = null;
    if (hasTableData && sampleData.length > 0) {
      // Show up to 10 sample rows for context
      tableData = sampleData.slice(0, 10);
    }

    // Save QA session to database
    const { data: qaSession, error: qaError } = await supabase
      .from('qa_sessions')
      .insert({
        user_id: userId,
        agent_id: agentId,
        question,
        answer,
        latency,
        table_data: tableData,
        status: 'completed'
      })
      .select()
      .single();

    if (qaError) {
      console.error('Error saving QA session:', qaError);
    }

    return new Response(
      JSON.stringify({
        answer,
        tableData,
        latency,
        sessionId: qaSession?.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in ask-question function:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Erro interno do servidor' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});