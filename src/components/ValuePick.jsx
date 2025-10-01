import { Badge } from '@/components/ui/badge.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { TrendingUp, Clock, Target, Percent } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Componente para exibir um pick de valor individual
 */
export function ValuePick({ pick }) {
  const getRecommendationColor = (recommendation) => {
    switch (recommendation) {
      case 'Forte':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Moderada':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Fraca':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getEdgeColor = (edge) => {
    if (edge >= 5) return 'text-green-600';
    if (edge >= 3) return 'text-yellow-600';
    return 'text-blue-600';
  };

  const formatDate = (dateString) => {
    try {
      return format(new Date(dateString), "dd/MM 'às' HH:mm", { locale: ptBR });
    } catch {
      return 'Data inválida';
    }
  };

  return (
    <Card className="hover:shadow-lg transition-shadow duration-200 border-l-4 border-l-primary">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg font-semibold text-gray-900">
              {pick.fixture.home_team} vs {pick.fixture.away_team}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              <span>{formatDate(pick.fixture.date)}</span>
              <span className="text-gray-400">•</span>
              <span>{pick.fixture.league_name}</span>
            </div>
          </div>
          <Badge className={getRecommendationColor(pick.recommendation)}>
            {pick.recommendation}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Mercado e Seleção */}
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <span className="font-medium text-gray-900">Mercado</span>
          </div>
          <p className="text-lg font-semibold text-primary">
            {pick.market.display}
          </p>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Percent className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-600">Probabilidade</span>
            </div>
            <p className="text-xl font-bold text-gray-900">
              {Math.round(pick.prediction.probability * 100)}%
            </p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-600">Edge</span>
            </div>
            <p className={`text-xl font-bold ${getEdgeColor(pick.prediction.edge)}`}>
              +{pick.prediction.edge.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Odds */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
          <div>
            <span className="text-sm text-gray-600">Odd Justa</span>
            <p className="text-lg font-semibold text-gray-900">
              {pick.prediction.fairOdd.toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-600">Melhor Odd</span>
            <p className="text-lg font-semibold text-primary">
              {pick.prediction.marketOdd.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Explicação */}
        {pick.explanation && (
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <p className="text-sm text-blue-800 leading-relaxed">
              {pick.explanation}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Componente para lista de picks
 */
export function ValuePicksList({ picks, title = "Top Picks do Dia" }) {
  if (!picks || picks.length === 0) {
    return (
      <div className="text-center py-12">
        <Target className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Nenhum pick disponível
        </h3>
        <p className="text-gray-600">
          Os picks serão atualizados diariamente às 03:00 (horário de Brasília).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
        <p className="text-gray-600">
          Selecionados com base em análise estatística e modelo Poisson
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
        {picks.map((pick, index) => (
          <ValuePick key={pick.id || index} pick={pick} />
        ))}
      </div>

      {picks.length > 0 && (
        <div className="text-center text-sm text-gray-500 mt-8">
          <p>
            Última atualização: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </p>
          <p className="mt-1">
            ⚠️ Apostas envolvem risco. Jogue com responsabilidade.
          </p>
        </div>
      )}
    </div>
  );
}
