const Footer = () => {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container py-6">
        <p className="text-center text-sm text-muted-foreground">
          © {year} Converse com seus dados. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
