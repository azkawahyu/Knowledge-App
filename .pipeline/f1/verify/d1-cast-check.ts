// D1 check: does the PLAN §4.4(6) shape (`documentId = docResult.rows[0].id;`,
// no cast) actually fail under the repo's `strict: true`? Mirror the exact
// constructs: a `(string|null)[][]` push and a `Promise<string>` return.
declare const rows: any[];

export function withoutCast(): Promise<string> {
  let documentId: string | undefined;
  documentId = rows[0].id;
  const values: (string | null)[][] = [];
  values.push([documentId, 'chunk text', null, null, null]);
  return Promise.resolve(documentId);
}

export function withCast(): Promise<string> {
  let documentId: string | undefined;
  documentId = rows[0].id as string;
  const values: (string | null)[][] = [];
  values.push([documentId, 'chunk text', null, null, null]);
  return Promise.resolve(documentId);
}