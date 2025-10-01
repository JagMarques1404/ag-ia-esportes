import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { 
  TrendingUp, 
  Target, 
  Brain, 
  Menu, 
  X,
  BarChart3,
  Clock
} from 'lucide-react';

/**
 * Componente de cabeçalho da aplicação
 */
export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo e Título */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-lg">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                AG IA ESPORTES
              </h1>
              <p className="text-xs text-gray-600 hidden sm:block">
                Agente Esportivo com Inteligência Artificial
              </p>
            </div>
          </div>

          {/* Navegação Desktop */}
          <nav className="hidden md:flex items-center gap-6">
            <a 
              href="#home" 
              className="flex items-center gap-2 text-gray-700 hover:text-primary transition-colors"
            >
              <Target className="w-4 h-4" />
              <span>Top Picks</span>
            </a>
            <a 
              href="#analytics" 
              className="flex items-center gap-2 text-gray-700 hover:text-primary transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              <span>Análises</span>
            </a>
            <a 
              href="#about" 
              className="flex items-center gap-2 text-gray-700 hover:text-primary transition-colors"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Como Funciona</span>
            </a>
          </nav>

          {/* Status e Menu Mobile */}
          <div className="flex items-center gap-3">
            {/* Status Badge */}
            <Badge className="bg-green-100 text-green-800 border-green-200 hidden sm:flex">
              <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
              Sistema Ativo
            </Badge>

            {/* Menu Mobile Button */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={toggleMobileMenu}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Menu Mobile */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 py-4">
            <nav className="flex flex-col gap-4">
              <a 
                href="#home" 
                className="flex items-center gap-3 text-gray-700 hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Target className="w-5 h-5" />
                <span>Top Picks</span>
              </a>
              <a 
                href="#analytics" 
                className="flex items-center gap-3 text-gray-700 hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                <BarChart3 className="w-5 h-5" />
                <span>Análises</span>
              </a>
              <a 
                href="#about" 
                className="flex items-center gap-3 text-gray-700 hover:text-primary transition-colors py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                <TrendingUp className="w-5 h-5" />
                <span>Como Funciona</span>
              </a>
              <div className="pt-2 border-t border-gray-200">
                <Badge className="bg-green-100 text-green-800 border-green-200">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                  Sistema Ativo
                </Badge>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * Componente de estatísticas rápidas no header
 */
export function HeaderStats({ stats }) {
  if (!stats) return null;

  return (
    <div className="bg-gray-50 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center gap-8 py-3 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Clock className="w-4 h-4" />
            <span>Última atualização: {stats.lastUpdate}</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-gray-600">
            <Target className="w-4 h-4" />
            <span>{stats.totalPicks} picks analisados</span>
          </div>
          <div className="hidden md:flex items-center gap-2 text-gray-600">
            <TrendingUp className="w-4 h-4" />
            <span>Edge médio: +{stats.averageEdge}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
