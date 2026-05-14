// Wrapper para o pacote `server-only`.
//
// Em runtime Next.js (dev/build/produção):
//   - server bundle: resolve para empty.js via condition "react-server" → noop.
//   - client bundle: resolve para index.js → throw, exatamente como queremos.
//
// Em scripts CLI rodados via tsx fora do runtime Next, o resolver de Node
// sempre pega index.js (não usa "react-server"), e o módulo lança SEMPRE,
// mesmo em uso server-side legítimo. Para esses casos, o smoke test seta
// AG_IA_SCRIPT_MODE=true ANTES de carregar os módulos do app, e o guard
// pula o import.
//
// Importante: AG_IA_SCRIPT_MODE NUNCA deve ser definido em produção. O guard
// é uma escotilha de saída para a CLI local, não uma flag de feature.

// require() é síncrono e funciona tanto em CJS (tsx) quanto no webpack
// do Next (que sempre injeta require). Evita top-level await — o esbuild
// do tsx ainda emite CJS para arquivos sem `"type": "module"` no package.json.
if (process.env.AG_IA_SCRIPT_MODE !== "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("server-only");
}

export {};
