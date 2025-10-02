// src/lib/getPicks.ts (ou .js)
export async function getPicks() {
  try {
    const r = await fetch('/api/picks', { cache: 'no-store' });
    const j = await r.json();

    // aceita "data" OU "picks" e cai pra [] se vier diferente
    const list = Array.isArray(j?.data)
      ? j.data
      : Array.isArray(j?.picks)
      ? j.picks
      : [];

    return list;
  } catch (e) {
    console.error('getPicks error', e);
    return [];
  }
}
