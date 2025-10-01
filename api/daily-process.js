export default async function handler(req, res) {
  // Verificar se é uma requisição POST ou GET
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🚀 Iniciando processamento diário...');
    
    // Simular processamento por enquanto
    const mockData = {
      processed_at: new Date().toISOString(),
      fixtures_found: 15,
      picks_generated: 8,
      status: 'success'
    };

    console.log('✅ Processamento concluído:', mockData);
    
    return res.status(200).json({
      success: true,
      message: 'Processamento diário executado com sucesso',
      data: mockData
    });

  } catch (error) {
    console.error('❌ Erro no processamento:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
}
