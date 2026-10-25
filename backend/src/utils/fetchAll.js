/**
 * Supabase/PostgREST returns at most 1000 rows per request (default). Tables
 * like student_answers hold students x items rows (31 students x 40 items =
 * 1240), so a plain .select() silently drops the rest and every count that
 * follows is computed on only part of the class.
 *
 * Usage: await fetchAll((from, to) => supabase.from('t').select('*').eq(...).order('id').range(from, to))
 * Always include a stable .order() so pages never overlap or skip rows.
 * @returns {Promise<{data: any[], error: any}>}
 */
export async function fetchAll(buildPage, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return { data: all, error: null };
}
