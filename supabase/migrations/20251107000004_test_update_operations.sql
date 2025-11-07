-- Test if the issue is with UPDATE operations in general or just soft delete
-- This will help us understand what's causing the "new row" error

-- First, let's check what policies are currently active
-- Run this query to see current policies:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
-- FROM pg_policies WHERE tablename = 'qa_sessions';

-- Let's also temporarily disable RLS to see if that's the issue
-- WARNING: This removes all security temporarily for testing
-- ALTER TABLE public.qa_sessions DISABLE ROW LEVEL SECURITY;

-- After testing, re-enable with:
-- ALTER TABLE public.qa_sessions ENABLE ROW LEVEL SECURITY;
