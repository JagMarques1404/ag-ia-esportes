/**
 * AG IA ESPORTES - API Endpoint para Processamento Diário
 * Endpoint que será chamado pelo cron job da Vercel
 */

import { runDailyProcessing, runTestProcessing, updateOddsOnly } from '../lib/dailyProcessor.js';

// Função principal do endpoint
export default async function handler(req, res) {
  // Verificar método HTTP
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Método não permitido', 
      allowedMethods: ['POST'] 
    });
  }

  // Verificar token de autenticação (segurança)
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.VITE_API_INTERNAL_TOKEN || '9b8c7a2f6e3d4f0a1b5c9d8e2f3a6b7c';
  
  if (authToken !== expectedToken) {
    return res.status(401).json({ 
      error: 'Token de autenticação inválido' 
    });
  }

  try {
    // Obter tipo de processamento do body
    const { type = 'full' } = req.body;

    let result;
    
    switch (type) {
      case 'full':
        console.log('🚀 Executando processamento completo...');
        result = await runDailyProcessing();
        break;
        
      case 'test':
        console.log('🧪 Executando processamento de teste...');
        result = await runTestProcessing();
        break;
        
      case 'odds-only':
        console.log('📊 Atualizando apenas odds...');
        result = await updateOddsOnly();
        break;
        
      default:
        return res.status(400).json({ 
          error: 'Tipo de processamento inválido',
          validTypes: ['full', 'test', 'odds-only']
        });
    }

    // Retornar resultado
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Processamento concluído com sucesso',
        data: result
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Erro no processamento',
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Erro no endpoint de processamento:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Configuração do endpoint para Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
  // Aumentar timeout para processamento longo
  maxDuration: 300 // 5 minutos
}
