# Giáo xứ Đức Mỹ — REST API

Express + TypeScript + Prisma API cho website Giáo xứ Đức Mỹ.

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
npm run prisma:seed
npm run dev
```

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
