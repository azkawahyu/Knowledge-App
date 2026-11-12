let token: string | null = null;
export function setToken(t: string | null): void { token = t; }
export function getToken(): string | null { return token; }
export type Foo = { a: number };
