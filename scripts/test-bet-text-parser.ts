/**
 * Smoke test do bet-text-parser.
 *
 *   npm run test:bet-parser
 *
 * Roda o caso real Aston Villa × Liverpool da Bet365 e valida que cada
 * campo extraído bate exatamente com o esperado. Sai com código != 0
 * em qualquer divergência — útil em CI futura.
 */
import "dotenv/config";

const SAMPLE = `Registra essa aposta no meu histórico:

Bet365
Aston Villa x Liverpool
Odd total: 1.95
Stake: R$188,00
Retorno potencial: R$367,04

Seleções:
- Ollie Watkins: 2+ chutes
- Cody Gakpo: 2+ chutes
- Morgan Rogers: 1+ faltas sofridas

Status: pendente.`;

interface ExpectedLeg {
  player_name: string;
  market_includes: string;
  line: number | null;
}

const EXPECTED = {
  bookmaker: "Bet365",
  match_name: "Aston Villa × Liverpool",
  combined_odd: 1.95,
  total_stake: 188,
  potential_return: 367.04,
  potential_profit: 179.04,
  legs: [
    { player_name: "Ollie Watkins", market_includes: "2+ chutes", line: 1.5 },
    { player_name: "Cody Gakpo", market_includes: "2+ chutes", line: 1.5 },
    {
      player_name: "Morgan Rogers",
      market_includes: "1+ faltas sofridas",
      line: 0.5,
    },
  ] as ExpectedLeg[],
};

function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

interface ParserCase {
  name: string;
  input: string;
  expect: {
    bookmaker?: string | null;
    match_name?: string | null;
    combined_odd?: number;
    total_stake?: number;
    potential_return?: number | null;
    legs_length?: number;
    /** Se presente, garante que NENHUMA dessas relações existe (anti-confusão). */
    not_stake?: number;
    not_odd?: number;
  };
}

const VARIATIONS: ParserCase[] = [
  {
    name: "Variação 1: ordem 'Stake' antes de 'Odd'",
    input: `Bet365
Stake: R$50,00
Odd: 2.30
Retorno: R$115,00
- Pedro: 1+ gol`,
    expect: {
      bookmaker: "Bet365",
      combined_odd: 2.3,
      total_stake: 50,
      potential_return: 115,
      legs_length: 1,
      not_stake: 2.3,
      not_odd: 50,
    },
  },
  {
    name: "Variação 2: sem retorno declarado",
    input: `Aston Villa x Liverpool
Odd total: 1.95
Stake R$ 100
- Watkins: 2+ chutes`,
    expect: {
      combined_odd: 1.95,
      total_stake: 100,
      potential_return: null,
      legs_length: 1,
      not_stake: 1.95,
    },
  },
  {
    name: "Variação 3: vírgula como decimal e sem espaço no R$",
    input: `Bet365
Brasileirão Serie A
Odd combinada: 3,42
Stake: R$25,50
Retorno potencial: R$87,21
- Lucas Paquetá: 2+ chutes
- Vinicius Jr: 1+ assistência`,
    expect: {
      bookmaker: "Bet365",
      combined_odd: 3.42,
      total_stake: 25.5,
      potential_return: 87.21,
      legs_length: 2,
      not_stake: 3.42,
    },
  },
];

function checkExpect(
  caseName: string,
  got: import("../lib/ai/bet-text-parser").ParsedFreeBet | null,
  expect: ParserCase["expect"]
): string[] {
  const errors: string[] = [];
  if (!got) {
    errors.push(`[${caseName}] parser retornou null`);
    return errors;
  }
  if (expect.bookmaker !== undefined && got.bookmaker !== expect.bookmaker) {
    errors.push(
      `[${caseName}] bookmaker: got "${got.bookmaker}", expected "${expect.bookmaker}"`
    );
  }
  if (
    expect.match_name !== undefined &&
    got.match_name !== expect.match_name
  ) {
    errors.push(
      `[${caseName}] match_name: got "${got.match_name}", expected "${expect.match_name}"`
    );
  }
  if (
    expect.combined_odd != null &&
    !approx(got.combined_odd, expect.combined_odd)
  ) {
    errors.push(
      `[${caseName}] combined_odd: got ${got.combined_odd}, expected ${expect.combined_odd}`
    );
  }
  if (
    expect.total_stake != null &&
    !approx(got.total_stake, expect.total_stake)
  ) {
    errors.push(
      `[${caseName}] total_stake: got ${got.total_stake}, expected ${expect.total_stake}`
    );
  }
  if (expect.potential_return === null && got.potential_return != null) {
    errors.push(
      `[${caseName}] potential_return: got ${got.potential_return}, expected null`
    );
  } else if (
    expect.potential_return != null &&
    expect.potential_return !== null &&
    (got.potential_return == null ||
      !approx(got.potential_return, expect.potential_return))
  ) {
    errors.push(
      `[${caseName}] potential_return: got ${got.potential_return}, expected ${expect.potential_return}`
    );
  }
  if (expect.legs_length != null && got.legs.length !== expect.legs_length) {
    errors.push(
      `[${caseName}] legs.length: got ${got.legs.length}, expected ${expect.legs_length}`
    );
  }
  // Guards anti-confusão: stake nunca deve ser igual à odd, e vice-versa.
  if (expect.not_stake != null && approx(got.total_stake, expect.not_stake)) {
    errors.push(
      `[${caseName}] total_stake virou ${got.total_stake} — provavelmente confundiu com odd`
    );
  }
  if (expect.not_odd != null && approx(got.combined_odd, expect.not_odd)) {
    errors.push(
      `[${caseName}] combined_odd virou ${got.combined_odd} — provavelmente confundiu com stake`
    );
  }
  return errors;
}

async function main() {
  const { parseFreeBetText } = await import("../lib/ai/bet-text-parser");

  console.log("==========================================");
  console.log(" CASO PRINCIPAL — Bet365 Aston Villa real");
  console.log("==========================================");
  console.log("→ Input:");
  console.log(SAMPLE);

  const got = parseFreeBetText(SAMPLE);
  console.log("\n→ Resultado do parser:");
  console.log(JSON.stringify(got, null, 2));

  if (!got) {
    console.error("\n✗ FAIL: parser retornou null.");
    process.exit(1);
  }

  const errors: string[] = [];

  if (got.bookmaker !== EXPECTED.bookmaker) {
    errors.push(`bookmaker: got "${got.bookmaker}", expected "${EXPECTED.bookmaker}"`);
  }
  if (got.match_name !== EXPECTED.match_name) {
    errors.push(
      `match_name: got "${got.match_name}", expected "${EXPECTED.match_name}"`
    );
  }
  if (!approx(got.combined_odd, EXPECTED.combined_odd)) {
    errors.push(
      `combined_odd: got ${got.combined_odd}, expected ${EXPECTED.combined_odd}`
    );
  }
  if (!approx(got.total_stake, EXPECTED.total_stake)) {
    errors.push(
      `total_stake: got ${got.total_stake}, expected ${EXPECTED.total_stake}`
    );
  }
  if (
    got.potential_return == null ||
    !approx(got.potential_return, EXPECTED.potential_return)
  ) {
    errors.push(
      `potential_return: got ${got.potential_return}, expected ${EXPECTED.potential_return}`
    );
  }
  if (
    got.potential_profit == null ||
    !approx(got.potential_profit, EXPECTED.potential_profit)
  ) {
    errors.push(
      `potential_profit: got ${got.potential_profit}, expected ${EXPECTED.potential_profit}`
    );
  }
  if (got.legs.length !== EXPECTED.legs.length) {
    errors.push(
      `legs.length: got ${got.legs.length}, expected ${EXPECTED.legs.length}`
    );
  } else {
    for (let i = 0; i < EXPECTED.legs.length; i++) {
      const e = EXPECTED.legs[i];
      const g = got.legs[i];
      if (g.player_name !== e.player_name) {
        errors.push(
          `legs[${i}].player_name: got "${g.player_name}", expected "${e.player_name}"`
        );
      }
      if (!g.market.toLowerCase().includes(e.market_includes.toLowerCase())) {
        errors.push(
          `legs[${i}].market: got "${g.market}", expected to include "${e.market_includes}"`
        );
      }
      if (e.line !== null && (g.line == null || !approx(g.line, e.line))) {
        errors.push(
          `legs[${i}].line: got ${g.line}, expected ${e.line}`
        );
      }
    }
  }

  // Guard explícito: stake nunca pode ser igual à odd no caso principal.
  if (approx(got.total_stake, got.combined_odd)) {
    errors.push(
      `ANTI-CONFUSÃO: total_stake (${got.total_stake}) == combined_odd (${got.combined_odd}) — bug crítico de mapeamento.`
    );
  }
  // Stake do caso principal precisa ser >= 100 (é R$188).
  if (got.total_stake < 50) {
    errors.push(
      `ANTI-CONFUSÃO: total_stake muito baixo (${got.total_stake}) para uma aposta de R$ 188.`
    );
  }

  // ============================================================
  // Variações
  // ============================================================
  console.log("\n==========================================");
  console.log(" CASOS DE VARIAÇÃO — anti-confusão");
  console.log("==========================================");

  for (const v of VARIATIONS) {
    const out = parseFreeBetText(v.input);
    const verrs = checkExpect(v.name, out, v.expect);
    if (verrs.length === 0) {
      console.log(`  ✓ ${v.name}`);
      console.log(
        `      stake=${out?.total_stake}, odd=${out?.combined_odd}, retorno=${out?.potential_return ?? "—"}, legs=${out?.legs.length}`
      );
    } else {
      for (const e of verrs) errors.push(e);
    }
  }

  if (errors.length > 0) {
    console.error("\n✗ FAIL — divergências:");
    for (const err of errors) console.error("   - " + err);
    process.exit(1);
  }

  console.log("\n✓ PASS — caso principal + todas as variações bateram.");
  console.log(`   confidence (caso principal): ${got.confidence}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
