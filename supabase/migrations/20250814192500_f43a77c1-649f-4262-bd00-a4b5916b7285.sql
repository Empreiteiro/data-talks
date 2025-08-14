-- Create function to get QA sessions for shared agents
CREATE OR REPLACE FUNCTION public.get_shared_agent_qa_sessions(token_value text)
 RETURNS TABLE(
   id uuid,
   question text,
   answer text,
   sql_query text,
   table_data jsonb,
   created_at timestamp with time zone,
   status text,
   latency integer,
   feedback text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT 
    qs.id,
    qs.question,
    qs.answer,
    qs.sql_query,
    qs.table_data,
    qs.created_at,
    qs.status,
    qs.latency,
    qs.feedback
  FROM public.qa_sessions qs
  JOIN public.agents a ON a.id = qs.agent_id
  WHERE a.share_token = token_value
  AND qs.is_shared = true
  ORDER BY qs.created_at DESC;
$function$;