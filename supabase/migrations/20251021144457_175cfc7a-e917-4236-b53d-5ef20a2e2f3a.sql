-- Add SELECT policy for creators to view their own agents immediately
-- This ensures .select().single() works right after INSERT
CREATE POLICY "Creators can view their own agents immediately"
ON public.agents
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
);