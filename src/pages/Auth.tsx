import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

const Auth = () => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function onLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await login(String(data.get('email')), String(data.get('password')));
      navigate('/dashboard');
    } catch (err: any) { setError(err.message); }
  }

  async function onRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await register(String(data.get('name')), String(data.get('email')), String(data.get('password')));
      navigate('/dashboard');
    } catch (err: any) { setError(err.message); }
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
              <Button type="submit" className="w-full">Criar conta</Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export default Auth;
