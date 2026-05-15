import Link from "next/link";
import { Button } from "@/components/ui/button";

interface PublicHeaderProps {
  isLoggedIn: boolean;
}

export function PublicHeader({ isLoggedIn }: PublicHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-primary">
            AG IA Esportes
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          <Link
            href="/"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Home
          </Link>
          <Link
            href="/picks"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Picks de Hoje
          </Link>
          <Link
            href="/history"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Histórico
          </Link>
        </nav>

        <Button asChild size="sm">
          <Link href={isLoggedIn ? "/dashboard" : "/auth/login"}>
            {isLoggedIn ? "Dashboard" : "Entrar"}
          </Link>
        </Button>
      </div>
    </header>
  );
}
