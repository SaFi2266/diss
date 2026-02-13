# نظام سجل طلاب إعدادية الديوانية الصناعية

مشروع يحتوي على:
1. **تطبيق ويب تقدمي (PWA) Offline-first** لإدارة بيانات الطلاب مع بحث/إضافة/تعديل/استيراد CSV وسجل تدقيق وصلاحيات (كاتب/مشرف/مدير).
2. **إضافة WordPress** لمزامنة بيانات الطلاب وعرض البحث للزوار بإخراج محدود (رقم السجل + رقم الصفحة).

## تشغيل تطبيق الويب
```bash
node server.js
```
ثم افتح `http://localhost:3000`.

### الصلاحيات في التطبيق
- يتم تمرير الصلاحية عبر واجهة الاختيار (writer/supervisor/admin) وتُرسل بالرؤوس `X-Role`, `X-User`.
- الكاتب: عملياته تحفظ كطلبات موافقة (`pending`).
- المشرف: يوافق على الطلبات عبر API.
- المدير: يملك الأرشفة والاستيراد/التصدير.

## API مختصر
- `GET /api/students/search?q=` بحث AJAX.
- `POST /api/students` إضافة (مع توليد RollNumberID بطول 13).
- `PUT /api/students/:id` تعديل.
- `PATCH /api/students/:id/archive` أرشفة (مدير).
- `POST /api/import` استيراد CSV (مدير).
- `GET /api/export` تصدير CSV (مدير).
- `GET /api/audit` سجل التغييرات.
- `POST /api/sync` مزامنة قائمة العمليات المؤجلة عند عودة الاتصال.

## الإضافة (WordPress)
المسار: `wp-plugin/student-registry-sync/student-registry-sync.php`

### الميزات
- مزامنة مجدولة/يدوية من API.
- تخزين محلي في جدول MySQL.
- بحث Server-side فقط عبر `admin-ajax.php`.
- Rate limiting على أساس IP.
- صفحة إعدادات للمدير.

### الاستخدام
- فعّل الإضافة في ووردبريس.
- اضبط `API URL` (مثال: `https://your-pwa.example/api/`) و `API Key` إن لزم.
- أضف الشورت كود: `[diw_student_search]`.
