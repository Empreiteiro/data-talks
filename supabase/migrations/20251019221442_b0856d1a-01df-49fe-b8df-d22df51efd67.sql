-- Add admin role to existing user
INSERT INTO public.user_roles (user_id, role, created_by)
VALUES ('9db8c95d-d77c-4481-9119-b2fd3746a646', 'admin', '9db8c95d-d77c-4481-9119-b2fd3746a646')
ON CONFLICT (user_id, role) DO NOTHING;