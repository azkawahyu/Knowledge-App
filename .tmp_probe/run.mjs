const m = await import('./mod.ts');
m.setToken("abc");
console.log("LOADED_TS_OK getToken=", m.getToken());
