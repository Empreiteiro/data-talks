import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";


const Auth = () => {
  const { login, register, isAuthenticated } = useAuth();
  
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      window.location.href = '/dashboard';
    }
  }, [isAuthenticated]);
  async function onLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await login(String(data.get('email')), String(data.get('password')));
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message || 'Falha ao entrar. Tente novamente.');
    }
  }

  async function onRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      const res: any = await register(String(data.get('name')), String(data.get('email')), String(data.get('password')));
      if (res && !res.session) {
        setInfo('Cadastro realizado! Verifique seu e-mail para confirmar e então faça login.');
      } else {
        window.location.href = '/dashboard';
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao registrar. Tente novamente.');
    }
  }

  return (
    <main className="container py-16">
      <SEO title="Entrar | Converse com seus dados" description="Autenticação por e-mail e senha" canonical="/login" />
      <div className="max-w-md mx-auto bg-card border rounded-lg p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-6">Acessar sua conta</h1>
        <Tabs defaultValue="login">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Registrar</TabsTrigger>
          </TabsList>
          <TabsContent value="login">
            <form className="space-y-4" onSubmit={onLogin}>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input name="email" id="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input name="password" id="password" type="password" required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full">Entrar</Button>
            </form>
          </TabsContent>
          <TabsContent value="register">
            <form className="space-y-4" onSubmit={onRegister}>
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input name="name" id="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email2">E-mail</Label>
                <Input name="email" id="email2" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password2">Senha</Label>
                <Input name="password" id="password2" type="password" required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {info && <p className="text-sm text-muted-foreground">{info}</p>}
              <Button type="submit" className="w-full">Criar conta</Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export default Auth;
