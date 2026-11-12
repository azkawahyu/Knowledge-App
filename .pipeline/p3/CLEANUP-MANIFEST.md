# F3-B cleanup manifest — Phase 3 (2026-11-03, user-approved limited consent)

Scope: EXACTLY the 16 files below in `server/data/`. Nothing else. No directory deletion, no wildcards.

Verification performed before deletion:
- `public.documents` = 0 → **no database row references any blob** (blobs are content-addressed; a live row would exist if any document survived).
- All 16 files were created after 2026-11-03 15:00 (the F3-B implementer run) — `find -newermt '2026-11-03 15:00'` returned 16/16.
- Every filename is its own sha256 (content-addressed naming), and the recorded hash equals the filename — so the hash IS the identity; no ambiguity.
- `e3b0c442…855` is sha256 of the empty string — the 0-byte dedupe fixture.
- `server/data/` was empty before Phase 3 began (verified at phase start).

| # | relative path | bytes | sha256 (= filename) | class |
|---|---|---|---|---|
| 1 | uploads/04d2687541a9e4c5978d28a518656d11c9675d22c8dd1fc78581117cb734e405.txt | 32 | 04d2687541a9e4c5978d28a518656d11c9675d22c8dd1fc78581117cb734e405 | upload blob |
| 2 | uploads/174452cc024f75f994ecb8af068d1cf3372d944e6a0a48083b32d832a41aaa76.txt | 66 | 174452cc024f75f994ecb8af068d1cf3372d944e6a0a48083b32d832a41aaa76 | upload blob |
| 3 | uploads/2027b02fc1821615213829bb691a7b85a4dd3670a2592659cdcbbde8c55f08c7.txt | 32 | 2027b02fc1821615213829bb691a7b85a4dd3670a2592659cdcbbde8c55f08c7 | upload blob |
| 4 | uploads/94d6e468b5d85756f8bece4f9e2bb0a6ec2d091c1a02aa2cb0f8f910dcf0108c.txt | 66 | 94d6e468b5d85756f8bece4f9e2bb0a6ec2d091c1a02aa2cb0f8f910dcf0108c | upload blob |
| 5 | uploads/a874f95f47c271689df72a52f9a0b865a9ef5c5be2c49813b5311cd948a59d0e.txt | 469 | a874f95f47c271689df72a52f9a0b865a9ef5c5be2c49813b5311cd948a59d0e | upload blob |
| 6 | uploads/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.txt | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | upload blob (empty-string dedupe fixture) |
| 7 | uploads/e92f6eb40c0f04749ba1fa18c9a161e5a01ee6037e7e9eaab91717ef9b452d17.txt | 32 | e92f6eb40c0f04749ba1fa18c9a161e5a01ee6037e7e9eaab91717ef9b452d17 | upload blob |
| 8 | uploads/fdf831ec5bc6b17fc38d4b08c62bba2c82e8e60124f2bffbfa8a62c27173f872.txt | 66 | fdf831ec5bc6b17fc38d4b08c62bba2c82e8e60124f2bffbfa8a62c27173f872 | upload blob |
| 9 | extracts/04d2687541a9e4c5978d28a518656d11c9675d22c8dd1fc78581117cb734e405.txt | 32 | 04d2687541a9e4c5978d28a518656d11c9675d22c8dd1fc78581117cb734e405 | extract |
| 10 | extracts/174452cc024f75f994ecb8af068d1cf3372d944e6a0a48083b32d832a41aaa76.txt | 66 | 174452cc024f75f994ecb8af068d1cf3372d944e6a0a48083b32d832a41aaa76 | extract |
| 11 | extracts/2027b02fc1821615213829bb691a7b85a4dd3670a2592659cdcbbde8c55f08c7.txt | 32 | 2027b02fc1821615213829bb691a7b85a4dd3670a2592659cdcbbde8c55f08c7 | extract |
| 12 | extracts/94d6e468b5d85756f8bece4f9e2bb0a6ec2d091c1a02aa2cb0f8f910dcf0108c.txt | 66 | 94d6e468b5d85756f8bece4f9e2bb0a6ec2d091c1a02aa2cb0f8f910dcf0108c | extract |
| 13 | extracts/a874f95f47c271689df72a52f9a0b865a9ef5c5be2c49813b5311cd948a59d0e.txt | 469 | a874f95f47c271689df72a52f9a0b865a9ef5c5be2c49813b5311cd948a59d0e | extract |
| 14 | extracts/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.txt | 0 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 | extract |
| 15 | extracts/e92f6eb40c0f04749ba1fa18c9a161e5a01ee6037e7e9eaab91717ef9b452d17.txt | 32 | e92f6eb40c0f04749ba1fa18c9a161e5a01ee6037e7e9eaab91717ef9b452d17 | extract |
| 16 | extracts/fdf831ec5bc6b17fc38d4b08c62bba2c82e8e60124f2bffbfa8a62c27173f872.txt | 66 | fdf831ec5bc6b17fc38d4b08c62bba2c82e8e60124f2bffbfa8a62c27173f872 | extract |

Cross-check note: filenames in `uploads/` and `extracts/` pair one-to-one (same 8 hashes), because the
extract filename is derived from the source blob's content hash.
