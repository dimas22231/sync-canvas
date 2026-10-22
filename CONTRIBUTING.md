# Contributing ke SyncCanvas

Terima kasih sudah ingin berkontribusi. Dokumen ini merangkum cara menyiapkan lingkungan, konvensi kode, dan ekspektasi pull request.

## 1. Menyiapkan lingkungan

```bash
npm install
npm run build -w @synccanvas/shared
npm run dev
```

Sebelum membuka PR, jalankan:

```bash
npm run typecheck
npm run format:check
npm run build
```

Build produksi memastikan tidak ada masalah yang hanya muncul di Next.js/Socket.io.

## 2. Peta kontribusi

| Ingin mengubah        | Mulai dari                                                    |
| --------------------- | ------------------------------------------------------------- |
| Tampilan/toolbar      | `apps/client/src/components` + `app/globals.css`              |
| Perilaku sinkronisasi | `apps/client/src/hooks/use-whiteboard-socket.ts`              |
| Event/payload baru    | `packages/shared/src/index.ts` → server handler → client hook |
| Aturan domain         | `apps/server/src/services/room.service.ts`                    |
| Performa/rate limit   | `apps/server/src/socket/middleware` + `lib/token-bucket.ts`   |
| Dokumentasi           | `README.md`, `ARCHITECTURE.md`, `API_DOCS.md`                 |

## 3. Konvensi kode

### Penamaan

| Entitas           | Gaya                 | Contoh                                          |
| ----------------- | -------------------- | ----------------------------------------------- |
| File & direktori  | `kebab-case`         | `stroke.handler.ts`, `use-whiteboard-socket.ts` |
| Komponen React    | `PascalCase`         | `WhiteboardDemo`                                |
| Hook              | `use` + `PascalCase` | `useWhiteboardSocket`                           |
| Tipe/interface    | `PascalCase`         | `RoomMember`, `StartStrokeInput`                |
| Variabel & fungsi | `camelCase`          | `consumeBudget`, `pendingPointsRef`             |
| Konstanta         | `UPPER_SNAKE_CASE`   | `MAX_POINTS_PER_BATCH`                          |
| Boolean           | `is`/`has`/`can`     | `isConnected`, `hasStroke`                      |
| Event Socket.io   | `domain:action`      | `stroke:points`                                 |

### TypeScript

- **Strict mode wajib.** Jangan menonaktifkan `strict`, menambah `any`, atau memakai `@ts-ignore` tanpa alasan yang didokumentasikan.
- Data dari network selalu `unknown` sampai divalidasi Zod. Jangan cast `as Payload` tanpa parsing.
- Payload event diturunkan dari schema (`z.infer`), bukan ditulis dua kali.
- Gunakan `import type` untuk tipe (repo memakai `verbatimModuleSyntax`).
- Error yang sudah diantisipasi dikembalikan sebagai `Result<T>`, bukan dilempar.
- Pertahankan `noUnusedLocals`/`noUnusedParameters`; parameter yang sengaja tidak dipakai beri prefix `_`.

### Error handling

- Handler Socket.io wajib dibungkus `withErrorBoundary(logger, 'nama:event', ...)`.
- Event dengan ack membalas kegagalan lewat ack; event tanpa ack memakai `server:error` atau drop + log.
- Jangan pernah mengirim stack trace, query, atau isi token ke client.
- Log memakai objek kontekstual: `{ roomId, socketId, code }`, bukan string concatenation.

### Performa real-time

- Jangan memanggil `setState` per titik pointer. Simpan di `ref`, commit lewat `requestAnimationFrame`.
- Throttle kursor dan batch titik; jangan menaikkan frekuensi tanpa mengukur.
- Gunakan `volatile` hanya untuk data yang boleh hilang (posisi kursor, batch titik).
- Hindari membuat objek besar per event; batch dan batasi ukuran payload.
- Ukur sebelum mengoptimasi: dua tab + DevTools Performance/Network.

### Gaya umum

- Prettier mengatur format (100 kolom, single quote, trailing comma). Jangan debat format di review.
- Komentar menjelaskan **mengapa**, bukan mengulang **apa** yang sudah terbaca dari kode.
- Fungsi publik, hook, dan modul baru memakai JSDoc singkat (tujuan, parameter penting, efek samping).
- Satu file = satu tanggung jawab utama. Handler tidak boleh menyimpan state board sendiri.

## 4. Perubahan database

- Semua tabel didefinisikan di `packages/db/src/schema.ts`; jangan membuat SQL manual di aplikasi.
- Setelah mengubah schema: `npm run db:generate`, review file SQL di `packages/db/drizzle/`, lalu commit SQL + metadata.
- Jangan mengedit migration yang sudah ter-commit; buat migration baru.
- `npm run db:migrate` menerapkan migration ke `DATABASE_URL`. Di lokal, `npm run dev:local` menjalankan langkah ini otomatis.
- Query hanya boleh dipanggil dari server component, server action, route handler, atau server Socket.io — bukan client component.
- Selalu filter berdasarkan `workspace_id`/`board_id` yang sudah diverifikasi lewat `getWorkspaceAccess`/`getBoardAccess`. Jangan percaya ID dari form tanpa cek kepemilikan.

## 5. Menambah event atau fitur real-time

Checklist minimal:

1. [ ] Tambahkan schema Zod + tipe payload di `packages/shared/src/index.ts`.
2. [ ] Daftarkan event di `ClientToServerEvents` / `ServerToClientEvents`.
3. [ ] Tambahkan invariant di `RoomService` (jangan di handler).
4. [ ] Buat handler tipis: rate limit → validasi → cek membership/peran → service → broadcast.
5. [ ] Tambahkan action/state di hook client (bukan di komponen presentasional).
6. [ ] Tentukan strategi reliabilitas: butuh ack? boleh `volatile`? idempotent?
7. [ ] Perbarui `API_DOCS.md` (payload, ack, error, urutan event).
8. [ ] Tambahkan test untuk sukses, input invalid, dan akses tidak sah.

Contoh urutan handler yang benar:

```ts
socket.on(
  'nama:event',
  withErrorBoundary(logger, 'nama:event', (payload: Payload, ack: Ack<Hasil>) => {
    if (!consumeBudget(socket, 'write')) return ack(fail('RATE_LIMITED', '...'));

    const parsed = parsePayload(payloadSchema, payload);
    if (!parsed.ok) return ack(parsed);

    const membership = requireRoom(socket, parsed.data.roomId);
    if (!membership.ok) return ack(membership);

    const result = rooms.sesuatu(parsed.data);
    if (!result.ok) return ack(result);

    ack(ok(result.data));
  }),
);
```

## 6. Git & commit

Branch:

```
feat/nama-fitur
fix/deskripsi-singkat
docs/topik
refactor/area
```

Commit mengikuti [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(server): tambah rate limit per room
fix(client): rollback stroke optimistis saat ack gagal
docs(api): dokumentasikan event board:cleared
refactor(shared): satukan schema payload kursor
test(room): tambah kasus kapasitas member
chore(deps): update socket.io ke 4.8.1
```

Aturan:

- Satu commit = satu perubahan logis, build tetap hijau.
- Pesan commit dalam bahasa Indonesia atau Inggris, konsisten dalam satu PR.
- Jangan commit `.env`, kredensial, atau `dist/`/`.next/`.

## 7. Pull request

Checklist:

- [ ] `npm run typecheck` hijau.
- [ ] `npm run build` hijau.
- [ ] `npm run format:check` hijau.
- [ ] Perubahan kontrak tercermin di `API_DOCS.md` dan `ARCHITECTURE.md` bila relevan.
- [ ] Tidak ada `console.log` debug yang tertinggal (gunakan logger).
- [ ] Diuji manual: dua tab, join/leave, gambar bersamaan, clear, reconnect (matikan-nyalakan server).
- [ ] Tidak menambah dependensi tanpa alasan jelas.
- [ ] Deskripsi PR memuat: masalah, pendekatan, cara menguji, dan risiko.

## 8. Testing (target berikutnya)

Belum ada test runner di repo. Targetnya:

- `node:test` atau Vitest untuk `RoomService` dan `TokenBucket` (murni, cepat).
- Integration test dengan dua instance `socket.io-client` in-process untuk join/stroke/broadcast.
- Playwright untuk skenario dua browser (menggambar, reconnect, clear).

Saat menambah test, ikuti pola AAA (Arrange–Act–Assert) dan beri nama yang menjelaskan perilaku, mis. `menolak titik dari socket yang bukan pembuat stroke`.

## 9. Melaporkan bug

Sertakan:

- Langkah reproduksi (room, jumlah tab, aksi).
- Perilaku yang diharapkan vs aktual.
- Log server (JSON) di sekitar waktu kejadian.
- Versi Node, browser, dan OS.
- Screenshot/rekaman bila menyangkut rendering.

Jangan menyertakan data pribadi atau token di issue.
