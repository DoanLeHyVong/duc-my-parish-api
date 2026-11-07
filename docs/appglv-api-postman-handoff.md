# AppGLV API — Postman handoff

Tài liệu này được đối chiếu trực tiếp với Express routers và Zod schemas trong source hiện tại. Dùng để kiểm thử local và làm đầu vào tạo Postman Collection; không bổ sung nghiệp vụ mới.

## 1. Môi trường, response và quyền

- `baseUrl`: `http://localhost:5000/api/v1`
- Postman variables: `accessToken`, `adminAccessToken`, `teacherAccessToken`, `academicYearId`, `semesterId`, `classId`, `studentId`, `teacherId`, `assignmentId`, `templateId`, `sessionId`, `recordId`, `importId`, `gradeColumnId`, `ruleId`, `deletionRequestId`.
- JWT header: `Authorization: Bearer {{accessToken}}`.
- Refresh token là cookie HTTP-only tại `/api/v1/auth`; bật Postman cookie jar.
- `SUPER_ADMIN`: mọi permission; `APPGLV_ADMIN`: `appglv.manage`; `TEACHER`: `appglv.teach` và scope lớp đang phân công; `PARISH_ADMIN` không tự có quyền AppGLV.
- Thành công thường là `{ "data": ... }`; Auth/System có thể thêm `success` và `message`.
- Lỗi: `{ "error": { "code": "ERROR_CODE", "message": "...", "details": {} } }`.
- ID tối đa 30 ký tự. Instant ISO phải có `Z` hoặc offset.

## 2. System và Auth

| Method | Path | JWT/quyền | Query/body | Kết quả |
|---|---|---|---|---|
| GET | `/health` | Public | — | Process status và timestamp. |
| GET | `/ready` | Public | — | `200` nếu DB sẵn sàng; `503 NOT_READY` nếu lỗi DB. |
| POST | `/auth/login` | Public | `{username,password}` | Access token, user/roles/permissions; set refresh cookie. |
| POST | `/auth/refresh` | Refresh cookie | — | Xoay refresh token, trả access token mới. |
| POST | `/auth/logout` | JWT | — | Thu hồi session, xóa cookie. |
| GET | `/auth/me` | JWT | — | User, roles, permissions hiện tại. |
| PATCH | `/auth/me` | JWT | `{ "displayName":"Tên mới" }` | Profile đã cập nhật. |
| POST | `/auth/change-password` | JWT | `{currentPassword,newPassword}`; new ≥10 ký tự | Đổi mật khẩu và vô hiệu hóa phiên cũ. |

```json
{
  "username": "admin",
  "password": "<nhập thủ công trong Postman>"
}
```

```javascript
// Postman Tests của login
const json = pm.response.json();
pm.environment.set('accessToken', json.data.accessToken);
const roles = json.data.user.roles || [];
if (roles.includes('SUPER_ADMIN') || roles.includes('APPGLV_ADMIN')) {
  pm.environment.set('adminAccessToken', json.data.accessToken);
}
if (roles.includes('TEACHER')) {
  pm.environment.set('teacherAccessToken', json.data.accessToken);
}
```

## 3. Central RBAC và Teacher accounts

### Security — `SUPER_ADMIN` / `security.manage`

| Method | Path | Body | Kết quả |
|---|---|---|---|
| GET | `/admin/security/roles` | — | Roles, permissions, userCount. |
| GET | `/admin/security/users` | — | Users + roles/permissions; không trả password hash. |
| POST | `/admin/security/users` | `{username,displayName,email?,password,roles[]}` | Tạo user multi-role; password ≥10. |
| PUT | `/admin/security/users/:id/roles` | `{ "roles":["APPGLV_ADMIN","TEACHER"] }` | Thay roles, revoke sessions; bảo vệ Super Admin cuối. |

Role enum: `SUPER_ADMIN`, `PARISH_ADMIN`, `APPGLV_ADMIN`, `TEACHER`.

### Teacher management — `appglv.manage`

| Method | Path | Query/body | Kết quả |
|---|---|---|---|
| GET | `/admin/teachers` | `page`, `limit<=100`, `search?`, `status=active|locked|all` | Danh sách phân trang. |
| POST | `/admin/teachers` | `{username,displayName,password}`; password ≥12 | Tạo user role TEACHER. |
| PATCH | `/admin/teachers/:id` | `username?`, `displayName?`; ít nhất một field | Cập nhật Teacher. |
| POST | `/admin/teachers/:id/lock` | `{ "locked":true }` | Khóa/mở khóa; revoke sessions. |
| POST | `/admin/teachers/:id/reset-password` | `{ "newPassword":"..." }`; ≥12 | Reset và revoke sessions. |

## 4. Academic Management

Admin routes yêu cầu `appglv.manage`. List query chung: `page=1`, `limit=20`, `search?`, `status=OPEN|CLOSED|ALL`, `academicYearId?`.

| Method | Path | Query/body | Kết quả |
|---|---|---|---|
| GET | `/admin/academics/academic-years` | List query | Năm học và học kỳ. |
| POST | `/admin/academics/academic-years` | `{ "name":"2026-2027" }` | Tạo năm học OPEN. |
| PATCH | `/admin/academics/academic-years/:id` | `{name}` | Đổi tên năm OPEN. |
| POST | `/admin/academics/academic-years/:id/close` | — | Đóng năm và quan hệ đang hoạt động. |
| POST | `/admin/academics/academic-years/:id/semesters` | `{name}` | Tạo học kỳ. |
| PATCH | `/admin/academics/semesters/:id` | `{name}` | Đổi tên học kỳ OPEN. |
| POST | `/admin/academics/semesters/:id/close` | — | Đóng học kỳ. |
| GET | `/admin/academics/classes` | List query | Lớp + current enrollment/assignment counts. |
| POST | `/admin/academics/classes` | `{name,academicYearId}` | Tạo lớp. |
| GET | `/admin/academics/classes/:id` | — | Lớp, enrollment/assignment history. |
| PATCH | `/admin/academics/classes/:id` | `{name}` | Đổi tên lớp OPEN. |
| POST | `/admin/academics/classes/:id/close` | — | Đóng lớp, kết thúc current links. |
| GET | `/admin/academics/students` | List query | Tìm theo Tên Thánh/Họ tên. |
| POST | `/admin/academics/students` | `{saintName,fullName}` | Tạo student với internal ID. |
| GET | `/admin/academics/students/:id` | — | Hồ sơ + enrollment history. |
| PATCH | `/admin/academics/students/:id` | `{saintName,fullName}` | Cập nhật; không name-only auto merge. |
| POST | `/admin/academics/classes/:id/enrollments` | `{studentId}` | Ghi danh. |
| POST | `/admin/academics/students/:id/transfer` | `{classId}` | Chuyển lớp, bảo toàn lịch sử. |
| POST | `/admin/academics/classes/:id/assignments` | `{teacherId}` | Phân công Teacher active. |
| POST | `/admin/academics/assignments/:id/end` | — | Kết thúc phân công. |
| GET | `/teacher/classes` | JWT + `appglv.teach` | Lớp đang phân công. |
| GET | `/teacher/classes/:id/students` | JWT + `appglv.teach` | Roster hiện tại; `403` ngoài scope. |

List response mẫu:

```json
{ "data": { "items": [], "page": 1, "limit": 20, "total": 0 } }
```

## 5. Student Excel Import — `appglv.manage`

Upload dùng `multipart/form-data`; field file tên `file`, định dạng `.xlsx`.

| Method | Path | Input | Kết quả |
|---|---|---|---|
| POST | `/admin/academics/imports/headers` | form-data `file` | Headers, rowCount, size, SHA-256. |
| POST | `/admin/academics/imports/preview` | `file`, `classId`, `saintNameColumn`, `fullNameColumn` | Preview, row errors, possible duplicates. |
| POST | `/admin/academics/imports/:id/confirm` | Body dưới | Transaction + idempotency, tạo student/enrollment. |
| GET | `/admin/academics/imports` | `page`, `limit` | Import history. |
| GET | `/admin/academics/imports/:id` | — | Batch, rows, candidates, events. |

```json
{
  "requestId": "{{$guid}}",
  "revision": 0,
  "resolutions": [
    { "rowId":"<possibleDuplicateRowId>", "resolution":"CREATE_SEPARATE" },
    { "rowId":"<possibleDuplicateRowId2>", "resolution":"EXCLUDE" }
  ]
}
```

Mỗi dòng `POSSIBLE_DUPLICATE` phải có resolution. API không tự merge/cập nhật hồ sơ cũ.

## 6. Attendance Management

- `activityType`: `TUESDAY_MASS`, `THURSDAY_MASS`, `SUNDAY_MASS`, `CATECHISM_LESSON`.
- state: `NOT_MARKED`, `PRESENT`, `ABSENT`.
- status: `OPEN`, `SUBMITTED`, `FINALIZED`.
- List query: `page`, `limit`, `classId?`, `activityType?`, `status?`, `from?`, `to?`.

### Admin — `appglv.manage`

| Method | Path | Body/query | Kết quả |
|---|---|---|---|
| GET | `/admin/attendance/templates` | List query | Schedule templates. |
| POST | `/admin/attendance/templates` | Template body | Tạo lịch, không default giờ. |
| PATCH | `/admin/attendance/templates/:id` | Template fields + `revision` | Optimistic update. |
| POST | `/admin/attendance/templates/:id/deactivate` | `{revision}` | Ngừng lịch. |
| POST | `/admin/attendance/templates/:id/generate` | `{fromDate,toDate}` | `{created,existing}`, tối đa 366 ngày. |
| POST | `/admin/attendance/exceptions` | Exception body | `CANCEL`, `MOVE`, `ADD`. |
| GET | `/admin/attendance/sessions` | List query | Sessions. |
| GET | `/admin/attendance/sessions/:id` | — | Session + snapshot roster. |
| POST | `/admin/attendance/sessions/:id/save` | Save body | Lưu tạm, idempotent. |
| POST | `/admin/attendance/sessions/:id/submit` | Lifecycle body | OPEN → SUBMITTED; NOT_MARKED trả policy-pending conflict. |
| POST | `/admin/attendance/sessions/:id/finalize` | Lifecycle body | SUBMITTED → FINALIZED. |
| POST | `/admin/attendance/records/:id/correct` | Correction body | Sửa có lý do, vẫn FINALIZED, append audit. |
| GET | `/admin/attendance/history` | List query | Session history. |
| GET | `/admin/attendance/absences` | List query | ABSENT records. |
| GET | `/admin/attendance/audit` | List query | Attendance administrative audit. |

Template body:

```json
{
  "classId":"{{classId}}",
  "activityType":"SUNDAY_MASS",
  "weekday":0,
  "occurrenceMinute":420,
  "utcOffsetMinutes":420,
  "windowOpenOffsetMinutes":-30,
  "windowCloseOffsetMinutes":60,
  "effectiveStart":"2026-11-01",
  "effectiveEnd":"2027-05-31"
}
```

Các giá trị trên chỉ minh họa cấu trúc test, không phải default nghiệp vụ.

```json
{ "type":"CANCEL", "sessionId":"{{sessionId}}", "note":"Lý do test" }
```

```json
{
  "type":"ADD",
  "classId":"{{classId}}",
  "activityType":"CATECHISM_LESSON",
  "occursAt":"{{futureOccursAt}}",
  "windowOpensAt":"{{futureWindowOpensAt}}",
  "windowClosesAt":"{{futureWindowClosesAt}}",
  "note":"Phiên test"
}
```

```json
{
  "requestId":"{{$guid}}",
  "revision":0,
  "records":[{ "studentId":"{{studentId}}", "state":"PRESENT" }]
}
```

MOVE dùng cùng ba biến thời gian tương lai và bắt buộc `sessionId`:

```json
{
  "type":"MOVE",
  "sessionId":"{{sessionId}}",
  "occursAt":"{{futureOccursAt}}",
  "windowOpensAt":"{{futureWindowOpensAt}}",
  "windowClosesAt":"{{futureWindowClosesAt}}",
  "note":"Dời phiên test"
}
```

Pre-request script mẫu để mọi ADD/MOVE luôn nằm trong tương lai:

```javascript
const occurs = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const opens = new Date(occurs.getTime() - 30 * 60 * 1000);
const closes = new Date(occurs.getTime() + 60 * 60 * 1000);
pm.variables.set('futureOccursAt', occurs.toISOString());
pm.variables.set('futureWindowOpensAt', opens.toISOString());
pm.variables.set('futureWindowClosesAt', closes.toISOString());
```

Lifecycle: `{ "requestId":"{{$guid}}", "revision":1 }`.

Correction: `{ "requestId":"{{$guid}}", "state":"ABSENT", "reason":"Sửa theo xác minh của Admin" }`.

Sau khi tạo template, lưu ID để các request update/deactivate/generate chạy nối tiếp:

```javascript
pm.environment.set('templateId', pm.response.json().data.id);
```

### Teacher — `appglv.teach` + current assignment scope

| Method | Path | Input | Kết quả |
|---|---|---|---|
| GET | `/teacher/attendance/sessions` | List query | Sessions trong scope. |
| GET | `/teacher/attendance/sessions/:id` | — | Session/roster trong scope. |
| POST | `/teacher/attendance/sessions/:id/save` | Save body | Chỉ OPEN và trong configured window. |
| POST | `/teacher/attendance/sessions/:id/submit` | Lifecycle body | Chỉ trong configured window. |
| GET | `/teacher/attendance/history` | List query | History trong current scope. |
| GET | `/teacher/attendance/absences` | List query | Absences trong current scope. |

Teacher không có finalize, correction hoặc administrative audit.

## 7. Grades & Classification — `appglv.manage`

Teacher không có quyền grade/classification khi PD-30 còn Pending. Decimal gửi dưới dạng string.

| Method | Path | Query/body | Kết quả |
|---|---|---|---|
| GET | `/admin/grades/columns` | `classId`, `semesterId` | Grade columns. |
| POST | `/admin/grades/columns` | `{classId,semesterId,name,minimum,maximum,precision}` | Tạo column, không default scale. |
| PATCH | `/admin/grades/columns/:id` | `{revision,name,minimum,maximum,precision}` | Sửa column chưa sử dụng. |
| GET | `/admin/grades/sheet` | `classId`, `semesterId` | Columns, students, grades. |
| POST | `/admin/grades/grades` | Grade body | Upsert + revision + idempotency + audit. |
| GET | `/admin/grades/audit` | Ít nhất một scope filter + paging | Grade audit history. |
| POST | `/admin/grades/rules` | Rule body | Tạo DRAFT version. |
| GET | `/admin/grades/rules` | `classId`, `semesterId` | Rule versions. |
| POST | `/admin/grades/rules/:id/publish` | `{revision}` | Publish bất biến. |
| POST | `/admin/grades/calculate` | `{studentId,classId,semesterId,requestId}` | Persist result revision hoặc `NOT_CALCULATED`. |
| GET | `/admin/grades/results` | Scope filter + paging | Classification result history. |

Scope filters: `studentId?`, `classId?`, `semesterId?`, `academicYearId?`, `page`, `limit`; ít nhất một scope ID.

```json
{
  "studentId":"{{studentId}}",
  "classId":"{{classId}}",
  "semesterId":"{{semesterId}}",
  "gradeColumnId":"{{gradeColumnId}}",
  "value":"8.50",
  "revision":null,
  "requestId":"{{$guid}}"
}
```

```json
{
  "classId":"{{classId}}",
  "semesterId":"{{semesterId}}",
  "decimalPlaces":1,
  "roundingMethod":"HALF_UP",
  "weights":[{ "gradeColumnId":"{{gradeColumnId}}", "weight":"1" }],
  "bands":[{ "minimumInclusive":"0", "label":"<nhãn Admin cấu hình>" }]
}
```

Rounding enum: `HALF_UP`, `HALF_EVEN`, `DOWN`, `UP`. Các số ví dụ không phải business defaults.

## 8. Dashboards & Reports

Attendance filters: `academicYearId?`, `classId?`, `activityType?`, `from?`, `to?`; list report thêm `page`,`limit`.

| Method | Path | Quyền | Query/kết quả |
|---|---|---|---|
| GET | `/admin/reports/dashboard` | `appglv.manage` | `academicYearId` bắt buộc; totals, attendance lifecycle/marks, classification distribution. |
| GET | `/teacher/reports/dashboard` | `appglv.teach` | `academicYearId?`; assigned classes, upcoming, incomplete, attendance. |
| GET | `/admin/reports/attendance` | manage | Filters; summary + activity breakdown. |
| GET | `/teacher/reports/attendance` | teach | Filters, current assignment scope. |
| GET | `/admin/reports/absences` | manage | Filters + paging. |
| GET | `/teacher/reports/absences` | teach | Filters + paging + scope. |
| GET | `/admin/reports/incomplete-sessions` | manage | OPEN/SUBMITTED + paging. |
| GET | `/teacher/reports/incomplete-sessions` | teach | OPEN/SUBMITTED + paging + scope. |
| GET | `/admin/reports/classifications` | manage | `academicYearId`, `semesterId?`, `classId?`, paging; latest persisted revision. |
| GET | `/admin/reports/classifications/history` | manage | `studentId`,`classId`,`semesterId`, paging; revisions + rule version. |

Marked ratio = `present / (present + absent)`. `NOT_MARKED` tách riêng; mẫu số 0 trả `markedPercentage:null`, `INSUFFICIENT_DATA`.

## 9. Account Deletion

### Own requests — JWT hợp lệ

| Method | Path | Query/body | Kết quả |
|---|---|---|---|
| POST | `/account-deletion/requests` | Submit body | Xác minh current password; idempotent request. |
| GET | `/account-deletion/requests` | `page`, `limit<=50` | Lịch sử của chính user. |
| GET | `/account-deletion/requests/:id` | — | Chi tiết request của chính user. |

```json
{
  "requestKey":"{{$guid}}",
  "currentPassword":"<nhập thủ công>",
  "confirmation":"XÓA TÀI KHOẢN"
}
```

### Processing — chỉ `SUPER_ADMIN`

| Method | Path | Query/body | Kết quả |
|---|---|---|---|
| GET | `/admin/account-deletion/requests` | `page`, `limit`, `status?` | Tất cả requests. |
| GET | `/admin/account-deletion/requests/:id` | — | Chi tiết + `requiredRetentionCategories`. |
| POST | `/admin/account-deletion/requests/:id/transitions` | Transition body | Revision lifecycle, chống tự duyệt; APPROVED chưa phải EXECUTED. |

Lifecycle: `SUBMITTED → IN_REVIEW → VERIFIED`, sau đó rẽ sang `APPROVED → EXECUTED` hoặc `REJECTED` (terminal). `REJECT` chỉ hợp lệ từ `IN_REVIEW` hoặc `VERIFIED`.

```json
{ "action":"START_REVIEW", "revision":1, "reason":"Bắt đầu xác minh yêu cầu" }
```

Action enum: `START_REVIEW`, `VERIFY`, `APPROVE`, `REJECT`, `EXECUTE`. `EXECUTE` cần đúng mọi category API trả về:

```json
{
  "action":"EXECUTE",
  "revision":4,
  "reason":"Đã hoàn tất các bước phê duyệt",
  "retentionDecisions":[
    { "category":"ACCOUNT_DELETION_AUDIT", "basis":"<căn cứ đã phê duyệt, ít nhất 10 ký tự>" }
  ]
}
```

Không test EXECUTE trên tài khoản thật hoặc Super Admin cuối cùng.

## 10. Administrative audit

| Method | Path | Quyền | Kết quả |
|---|---|---|---|
| GET | `/admin/audit-logs` | `parish.manage` **hoặc** `security.manage` | Administrative audit; hiện tại `PARISH_ADMIN` và `SUPER_ADMIN` truy cập được, Teacher không được truy cập. |

## 11. Thứ tự test đề xuất

1. Health, ready, login, me.
2. Login Admin, lưu `adminAccessToken`; tạo Teacher test và Year → Semester → Class → Student → Enrollment → Assignment.
3. Login Teacher riêng, lưu `teacherAccessToken`; xác minh current class và `403` với lớp ngoài scope.
4. Dùng token Admin tạo attendance template/generate; chuyển sang token Teacher để save/submit; chuyển lại token Admin để finalize/correct.
5. Import headers → preview → resolve duplicates → confirm → history.
6. Tạo grade columns → grades → rule draft → publish → calculate → results/audit.
7. Reports Admin/Teacher; kiểm tra NOT_MARKED và grade endpoint của Teacher bị `403`.
8. Account deletion chỉ với user giả; không EXECUTE nếu retention gate chưa sẵn sàng.

## 12. Permission tests bắt buộc

- Không token: protected endpoint trả `401`.
- Chỉ `PARISH_ADMIN`: AppGLV endpoints trả `403`.
- `TEACHER`: `/admin/grades/*`, `/admin/security/*`, `/admin/audit-logs` trả `403`.
- Teacher ngoài assignment: scoped class/attendance/report trả `403`.
- Token cũ sau lock/reset/role change/deletion execution bị từ chối.
- Cùng idempotency key nhưng payload khác trả conflict.

## 13. Prompt tạo Postman Collection

Đưa file này cho ChatGPT và yêu cầu Postman Collection v2.1 + Environment:

- `{{baseUrl}} = http://localhost:5000/api/v1`.
- Login test script lưu `adminAccessToken` và `teacherAccessToken` riêng; mỗi request đặt `accessToken` theo role cần test; cookie jar giữ refresh token.
- Dùng `{{$guid}}` cho mỗi idempotency/request key mới; chỉ cố ý tái sử dụng key khi test replay hoặc conflict.
- Folder theo mục 2–10 và dùng variables cho IDs.
- Không nhúng password thật, JWT, dữ liệu học sinh thật hoặc căn cứ pháp lý giả.
- Không auto-run destructive actions: close year/class, lock, role replacement, deletion `EXECUTE`.
