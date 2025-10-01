import React from 'react';

export function ValuePick({ pick }) {
  if (!pick) return null;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {pick.homeTeam} vs {pick.awayTeam}
          </h3>
          <p className="text-sm text-gray-600">{pick.league}</p>
          <p className="text-sm text-gray-500">{pick.date} às {pick.time}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          pick.confidence === 'Forte' 
            ? 'bg-green-100 text-green-800' 
            : pick.confidence === 'Moderada'
            ? 'bg-yellow-100 text-yellow-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {pick.confidence}
        </span>
      </div>
      
      <div className="mb-4">
        <h4 className="font-medium text-gray-900 mb-2">{pick.market}</h4>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Probabilidade:</span>
            <p className="font-semibold">{pick.probability}</p>
          </div>
          <div>
            <span className="text-gray-600">Odd Justa:</span>
            <p className="font-semibold">{pick.fairOdd}</p>
          </div>
          <div>
            <span className="text-gray-600">Odd Mercado:</span>
            <p className="font-semibold">{pick.marketOdd}</p>
          </div>
        </div>
      </div>
      
      <div className="mb-4">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Edge:</span>
          <span className="text-lg font-bold text-green-600">{pick.edge}</span>
        </div>
      </div>
      
      {pick.analysis && (
        <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
          <strong>Análise:</strong> {pick.analysis}
        </div>
      )}
    </div>
  );
}
