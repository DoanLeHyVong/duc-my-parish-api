# Giáo xứ Đức Mỹ — REST API

> Current deployment: `main` and pull requests targeting `main` run CI only; reviewed `main` artifacts are deployed manually via `deploy/manual/`. No Docker runtime or automatic VPS deployment is active.

## Unified local database và cách chạy trên Windows

Backend chung dùng database MySQL local `ducmy`. Sao chép `.env.example` thành `.env`, cấu hình `DATABASE_URL` và hai secret riêng `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (mỗi secret ít nhất 24 ký tự). Không commit `.env` hoặc in secret ra log.

```powershell
Set-Location D:\AppGLV\duc-my-parish-api
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate
npm.cmd run dev
```

Kiểm tra sau khi khởi động:

```powershell
Invoke-WebRequest http://localhost:5000/api/v1/health
Invoke-WebRequest http://localhost:5000/api/v1/ready
```

- API base URL: `http://localhost:5000/api/v1`
- Không chạy `prisma:seed` trên database đã gộp nếu không chủ động muốn tạo dữ liệu seed.
- Full AppGLV API/Postman handoff: [`docs/appglv-api-postman-handoff.md`](docs/appglv-api-postman-handoff.md).

Express + TypeScript + Prisma API cho website Giáo xứ Đức Mỹ.

## CMS website

Migrations `202611120001_parish_cms_branding_seo` và `202611130001_parish_page_seo` chỉ thêm cột tùy chọn cho cấu hình, SEO từng trang, banner, chuyên mục, sự kiện và album. Không chạy seed trên database đang dùng. Admin có quyền `parish.manage` quản lý nội dung qua `/api/v1/admin/*`; ảnh Cloudinary ở `/api/v1/admin/media`, còn `/api/v1/public/*` chỉ trả nội dung công khai. Xóa ảnh khỏi thư viện chỉ ẩn bản ghi để URL đã dùng trên website không bị hỏng. `/api/v1/public/sitemap.xml` tổng hợp bài viết, chuyên mục, sự kiện và chính sách đã công bố từ database; `CLIENT_URL` phải là origin HTTPS của website.

Kiểm thử database chỉ được chạy trên `appglv_unified_test`; `tests/setup-access.ts` từ chối ghi vào database tên khác. CMS unit tests không cần database: `npx.cmd vitest run --config vitest.cms.config.ts`. Khi triển khai production, dùng quy trình manual backup và restore check đã có trước khi áp dụng Prisma migration.

## Yêu cầu

- Node.js LTS 22 trở lên
- XAMPP (MariaDB/MySQL) chỉ dành cho phát triển local
- Production dùng MySQL/MariaDB managed hoặc database riêng trên server, với tài khoản và mật khẩu riêng

## Chạy local

1. Mở XAMPP Control Panel và chạy MySQL.
2. Tạo database UTF8MB4 tên `ducmy`.
3. Sao chép `.env.example` thành `.env`; cấu hình `DATABASE_URL`, JWT secrets, `SEED_ADMIN_USERNAME` và `SEED_ADMIN_PASSWORD`. Không commit mật khẩu hoặc file `.env`.
4. Chạy:

```powershell
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Chỉ chạy `npm run prisma:seed` khi chủ động khởi tạo database mới, trống. Không seed lại database `ducmy` đã gộp.

## Provision Super Admin local an toàn

Không dùng `prisma:seed` để đổi thông tin đăng nhập. Lệnh chuyên biệt dưới đây chỉ chấp nhận `DATABASE_URL` trỏ tới database `ducmy` trên `localhost`, cập nhật đúng tài khoản `SUPER_ADMIN` hiện có trong một transaction, tăng `authVersion`, thu hồi session và ghi audit không chứa credential.

Trong file `.env` bị Git ignore, cấu hình:

```dotenv
SUPER_ADMIN_SOURCE_USERNAME=admin
SUPER_ADMIN_TARGET_USERNAME=nguyenhoangbuukim
SUPER_ADMIN_TARGET_EMAIL=
SUPER_ADMIN_PASSWORD=
```

`SUPER_ADMIN_TARGET_EMAIL` là tùy chọn; để trống sẽ giữ email hiện tại. `SUPER_ADMIN_PASSWORD` là bắt buộc, phải dài ít nhất 12 ký tự và không vượt quá 72 byte UTF-8. Không đặt mật khẩu trong source, tài liệu, command line hoặc log. Giá trị local đã chọn có độ đoán cao nên chỉ được dùng cho development local và phải thay bằng secret riêng, mạnh trước mọi môi trường production.

Với MySQL trong XAMPP đang chạy:

```powershell
Set-Location D:\AppGLV\duc-my-parish-api
npm.cmd run prisma:migrate:deploy
npm.cmd run admin:provision
```

Lệnh có thể chạy lại an toàn: nó không tạo user hay role mới, vẫn giữ nguyên user ID và các quan hệ, đồng thời rotate credential và thu hồi session lần nữa. Nếu locator sai, role sai, có nhiều Super Admin, hoặc username/email đích thuộc tài khoản khác, transaction sẽ fail closed.

API: `http://localhost:5000/api/v1`  
Swagger: `http://localhost:5000/api-docs`

## Kiểm tra và build

```powershell
npm run lint
npm run test
npm run build
```

## Triển khai Railway

Repository có `railway.json` với lệnh build, migration production và health check. Kết nối service API với Railway MySQL bằng `DATABASE_URL`; không dùng database XAMPP trên production.

Các biến bắt buộc cần nhập trực tiếp trong Railway: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`. Cấu hình thêm `CLIENT_URL`, cookie HTTPS và Cloudinary theo `.env.example`. Chỉ chạy `npm run prisma:seed` một lần khi khởi tạo dữ liệu; không tự động seed mỗi lần deploy.

## Cloudinary

Điền `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Ảnh được upload từ memory, tối đa 10 MB vào `giao-xu-duc-my/{posts,banners,albums,general}`. Nếu chưa cấu hình, API trả lỗi rõ ràng và frontend dùng ảnh minh họa.

## Backup database local

```powershell
C:\xampp\mysql\bin\mysqldump.exe -u root ducmy > ducmy-backup.sql
```

Không commit file backup hoặc `.env`.
