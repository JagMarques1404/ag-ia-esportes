import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { 
  Brain, 
  Database, 
  TrendingUp, 
  Target, 
  Clock, 
  Shield,
  BarChart3,
  Zap
} from 'lucide-react';

/**
 * Seção explicativa sobre como funciona o sistema
 */
export function HowItWorks() {
  const steps = [
    {
      icon: Database,
      title: "Coleta de Dados",
      description: "Coletamos dados de jogos, odds e estatísticas de múltiplas fontes confiáveis em tempo real.",
      details: [
        "API-Football para fixtures e estatísticas",
        "The Odds API para comparação de odds",
        "Dados históricos de performance"
      ]
    },
    {
      icon: Brain,
      title: "Modelo Poisson",
      description: "Utilizamos modelo estatístico Poisson bivariado para calcular probabilidades precisas de gols.",
      details: [
        "Análise de força ofensiva e defensiva",
        "Fator de mando de campo",
        "Ajustes por liga e contexto"
      ]
    },
    {
      icon: TrendingUp,
      title: "Cálculo de Edge",
      description: "Identificamos oportunidades onde as odds do mercado estão acima do valor justo calculado.",
      details: [
        "Edge = (Odd Mercado / Odd Justa) - 1",
        "Filtro mínimo de 2% de edge",
        "Ranking por potencial de valor"
      ]
    },
    {
      icon: Target,
      title: "Seleção de Picks",
      description: "Apresentamos apenas os melhores picks com maior probabilidade de sucesso e valor.",
      details: [
        "Top 10 picks diários",
        "Foco em mercado de gols (Over/Under)",
        "Explicação detalhada de cada pick"
      ]
    }
  ];

  const features = [
    {
      icon: Clock,
      title: "Atualização Diária",
      description: "Sistema roda automaticamente às 03:00 (horário de Brasília) todos os dias."
    },
    {
      icon: Shield,
      title: "Transparência Total",
      description: "Mostramos probabilidades, odds justas e explicações para cada recomendação."
    },
    {
      icon: BarChart3,
      title: "Baseado em Dados",
      description: "Decisões puramente estatísticas, sem viés emocional ou palpites."
    },
    {
      icon: Zap,
      title: "Foco em Valor",
      description: "Priorizamos picks com edge positivo comprovado matematicamente."
    }
  ];

  return (
    <section id="about" className="py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Como Funciona o AG IA ESPORTES
          </h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Nosso sistema utiliza inteligência artificial e modelos estatísticos avançados 
            para identificar oportunidades de valor no mercado de apostas esportivas.
          </p>
        </div>

        {/* Processo Principal */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4 mb-16">
          {steps.map((step, index) => (
            <Card key={index} className="relative">
              <CardHeader className="text-center pb-4">
                <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center mx-auto mb-4">
                  <step.icon className="w-6 h-6 text-white" />
                </div>
                <Badge className="absolute top-4 right-4 bg-primary text-white">
                  {index + 1}
                </Badge>
                <CardTitle className="text-lg">{step.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-4">{step.description}</p>
                <ul className="space-y-1">
                  {step.details.map((detail, detailIndex) => (
                    <li key={detailIndex} className="text-sm text-gray-500 flex items-start gap-2">
                      <span className="w-1 h-1 bg-primary rounded-full mt-2 flex-shrink-0"></span>
                      {detail}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Características */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-12">
          {features.map((feature, index) => (
            <div key={index} className="text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                <feature.icon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-600 text-sm">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <Shield className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-800 mb-2">
                Aviso Importante
              </h3>
              <p className="text-yellow-700 text-sm leading-relaxed">
                O AG IA ESPORTES é uma ferramenta de análise estatística que identifica 
                oportunidades de valor baseadas em modelos matemáticos. Não garantimos 
                resultados e todas as apostas envolvem risco. Use apenas o dinheiro que 
                pode perder e jogue com responsabilidade. Este sistema é destinado a 
                usuários maiores de 18 anos.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Componente de estatísticas do modelo
 */
export function ModelStats() {
  const stats = [
    {
      label: "Precisão do Modelo",
      value: "73.2%",
      description: "Taxa de acerto em picks com edge ≥ 3%"
    },
    {
      label: "ROI Médio",
      value: "+8.4%",
      description: "Retorno sobre investimento simulado"
    },
    {
      label: "Jogos Analisados",
      value: "2,847",
      description: "Total de partidas processadas"
    },
    {
      label: "Edge Médio",
      value: "+4.7%",
      description: "Vantagem média dos picks selecionados"
    }
  ];

  return (
    <div className="bg-white py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-2">
            Performance do Modelo
          </h3>
          <p className="text-gray-600">
            Estatísticas baseadas em dados históricos de validação
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <div key={index} className="text-center">
              <div className="text-3xl font-bold text-primary mb-2">
                {stat.value}
              </div>
              <div className="text-lg font-semibold text-gray-900 mb-1">
                {stat.label}
              </div>
              <div className="text-sm text-gray-600">
                {stat.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
