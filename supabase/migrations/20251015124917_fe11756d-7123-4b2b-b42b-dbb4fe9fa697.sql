-- Atualizar usuário democh@oriontech.me para plano Pro
UPDATE public.subscribers 
SET 
  subscribed = true,
  subscription_tier = 'Pro',
  subscription_end = now() + interval '1 year',
  updated_at = now()
WHERE email = 'democh@oriontech.me';