# Knowledge-App

Aplikasi lokal untuk mengimpor dan mencari dokumen pengetahuan. Backend menggunakan Express + PostgreSQL, frontend menggunakan Next.js.

## Persyaratan

- Windows 10/11
- Node.js dan npm
- PostgreSQL lokal yang berjalan dan dapat diakses
- Database PostgreSQL sudah dibuat; backend akan membuat tabel saat pertama kali dijalankan

> API dikonfigurasi agar hanya mendengarkan pada `127.0.0.1`.

## Konfigurasi pertama kali

1. Salin `server/.env.example` menjadi `server/.env`.
2. Edit `server/.env`, terutama variabel berikut:

   ```dotenv
   PORT=4000
   HOST=127.0.0.1
   DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=GANTI_DENGAN_PASSWORD_KUAT
   JWT_SECRET=GANTI_DENGAN_SECRET_ACAK_YANG_PANJANG
   OPENAI_BASE_URL=https://openagentic.id/api/v1
   OPENAI_MODEL=gpt-6-luna
   OPENAI_API_KEY=
   OPENAI_MAX_TOKENS=2048
   LOG_LEVEL=info
   ```

   Ganti user, password, dan nama database sesuai PostgreSQL lokal Anda. Encode karakter khusus URL pada password di `DATABASE_URL`. Isi `OPENAI_API_KEY` dengan key OpenAgentic Anda; jangan kirim key melalui chat atau masukkan ke frontend. Pesan, riwayat percakapan, dan potongan dokumen yang cocok akan dikirim dari backend ke provider OpenAgentic untuk menghasilkan jawaban.

3. Pastikan PostgreSQL aktif sebelum menyalakan backend. `server/start_postgres.bat` hanya cocok untuk instalasi di `D:\Install\PostgreSQL\18`; ubah jalurnya jika perlu. SQL contoh pembuatan database/user ada di `server/create_db.sql` dan `server/create_user.sql`; sesuaikan kredensial sebelum digunakan.

Backend membuat tabel secara otomatis saat mulai. Jika username admin belum ada, admin awal dibuat dari `ADMIN_USERNAME` dan `ADMIN_PASSWORD`.

## Menjalankan aplikasi

Pastikan PostgreSQL aktif dan konfigurasi `server/.env` sudah dibuat serta diisi (lihat bagian konfigurasi di atas). Dari root proyek jalankan:

```bash
npm install
npm run dev
```

Perintah `npm run dev` menyalakan backend dan frontend sekaligus. Buka <http://localhost:3000> dan masuk menggunakan akun admin dari `server/.env`. Backend API berjalan di `http://127.0.0.1:4000`.

Untuk menjalankan hanya satu bagian:

```bash
npm run dev:server
npm run dev:web
```

Hentikan proses dengan `Ctrl+C`.

## Build dan lint

```bash
npm run build
npm run lint
```

Build menjalankan TypeScript backend lalu build produksi frontend. Lint frontend saat ini melaporkan error ESLint, termasuk penggunaan tipe `any`. Build frontend mengabaikan lint sesuai konfigurasi Next.js proyek; build yang berhasil tidak berarti lint lolos.

## Keamanan

- Jangan commit atau bagikan `server/.env`; file ini berisi rahasia dan diabaikan Git.
- Ganti password admin dan `JWT_SECRET`.
- Jangan ubah `HOST` menjadi `0.0.0.0` atau mengekspos port ke jaringan publik.
