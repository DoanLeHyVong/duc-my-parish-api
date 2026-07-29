import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, PostStatus } from '@prisma/client';

const prisma = new PrismaClient();
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Cần SEED_ADMIN_EMAIL và SEED_ADMIN_PASSWORD trong .env');

const categoryNames = [
  'Tin giáo xứ',
  'Thông báo',
  'Lời Chúa hằng ngày',
  'Suy niệm Chúa nhật',
  'Tin Giáo phận',
  'Học hỏi Kinh Thánh',
  'Giáo lý',
  'Phụng vụ',
];
const slugify = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hero =
  'https://images.unsplash.com/photo-1520637836862-4d197d17c90a?auto=format&fit=crop&w=2000&q=85';

async function main() {
  const admin = await prisma.admin.upsert({
    where: { email: email!.toLowerCase() },
    update: { passwordHash: await bcrypt.hash(password!, 12), isActive: true },
    create: {
      fullName: 'Quản trị Giáo xứ Đức Mỹ',
      email: email!.toLowerCase(),
      passwordHash: await bcrypt.hash(password!, 12),
    },
  });

  const categories = [];
  for (const [sortOrder, name] of categoryNames.entries()) {
    categories.push(
      await prisma.category.upsert({
        where: { slug: slugify(name) },
        update: { name, sortOrder, isActive: true },
        create: { name, slug: slugify(name), sortOrder, description: 'Dữ liệu minh họa, có thể chỉnh sửa trong trang quản trị.' },
      }),
    );
  }

  const menu = await prisma.menu.upsert({
    where: { location: 'HEADER' },
    update: { name: 'Điều hướng chính', isActive: true },
    create: { name: 'Điều hướng chính', location: 'HEADER' },
  });
  await prisma.menuItem.deleteMany({ where: { menuId: menu.id } });
  const nav = [
    ['Trang chủ', '/'],
    ['Giới thiệu', '/gioi-thieu'],
    ['Thông báo', '/chuyen-muc/thong-bao'],
    ['Giờ lễ', '/gio-le'],
    ['Lời Chúa', '/chuyen-muc/loi-chua-hang-ngay'],
    ['Tin tức', '/chuyen-muc/tin-giao-xu'],
    ['Thư viện', '/thu-vien'],
    ['Liên hệ', '/lien-he'],
  ];
  await prisma.menuItem.createMany({
    data: nav.map(([label, url], sortOrder) => ({
      menuId: menu.id,
      label: label!,
      url,
      linkType: 'INTERNAL',
      sortOrder,
    })),
  });

  const postTitles = [
    'Cộng đoàn hiệp dâng Thánh lễ tạ ơn',
    'Chương trình mục vụ và sinh hoạt trong tuần',
    'Lời Chúa hôm nay: Hãy ở lại trong tình yêu của Thầy',
    'Suy niệm Chúa nhật: Sống niềm hy vọng',
    'Tin Giáo phận: Ngày hội của các gia đình',
    'Cùng học hỏi Tin Mừng theo Thánh Luca',
    'Giáo lý: Ý nghĩa của các Bí tích',
    'Hướng dẫn phụng vụ trong mùa thường niên',
    'Thiếu nhi Thánh Thể mừng ngày bổn mạng',
    'Thông báo đăng ký lớp giáo lý hôn nhân',
    'Lời Chúa là ngọn đèn soi cho con bước',
    'Suy niệm: Trở nên muối và ánh sáng',
    'Caritas giáo xứ thăm các gia đình khó khăn',
    'Khóa học Kinh Thánh căn bản',
    'Chuẩn bị tâm hồn tham dự Thánh lễ',
  ];
  for (const [index, title] of postTitles.entries()) {
    const slug = `${slugify(title)}-${index + 1}`;
    const post = await prisma.post.upsert({
      where: { slug },
      update: {},
      create: {
        title,
        slug,
        excerpt: 'Nội dung minh họa dành cho website Giáo xứ Đức Mỹ. Quản trị viên có thể cập nhật nội dung này.',
        content: `<p>Đây là nội dung minh họa cho <strong>${title}</strong>.</p><p>Xin cộng đoàn hiệp thông cầu nguyện và cùng lan tỏa tinh thần yêu thương, phục vụ.</p>`,
        authorId: admin.id,
        status: PostStatus.PUBLISHED,
        isFeatured: index < 3,
        publishedAt: new Date(Date.now() - index * 86_400_000),
        seoTitle: title,
        seoDescription: 'Nội dung minh họa của Giáo xứ Đức Mỹ.',
      },
    });
    await prisma.postCategory.upsert({
      where: { postId_categoryId: { postId: post.id, categoryId: categories[index % categories.length]!.id } },
      update: {},
      create: { postId: post.id, categoryId: categories[index % categories.length]!.id },
    });
  }

  await prisma.banner.deleteMany();
  await prisma.banner.createMany({
    data: [0, 1, 2].map((sortOrder) => ({
      title: sortOrder === 0 ? 'Giáo xứ Đức Mỹ' : `Đời sống đức tin ${sortOrder + 1}`,
      subtitle: 'Hiệp nhất trong đức tin — Lan tỏa yêu thương',
      imageUrl: hero,
      primaryText: 'Xem giờ lễ',
      primaryUrl: '/gio-le',
      sortOrder,
    })),
  });
  await prisma.announcement.deleteMany();
  await prisma.announcement.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      title: i === 0 ? 'Chương trình mục vụ và sinh hoạt trong tuần' : `Thông báo giáo xứ số ${i + 1}`,
      content: 'Thông tin minh họa, vui lòng cập nhật nội dung chính xác trong trang quản trị.',
      isPinned: i === 0,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + (14 + i) * 86_400_000),
    })),
  });
  await prisma.massSchedule.deleteMany();
  await prisma.massSchedule.createMany({
    data: [
      { dayOfWeek: 0, startTime: '05:00', massType: 'Thánh lễ Chúa nhật', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
      { dayOfWeek: 0, startTime: '17:30', massType: 'Thánh lễ Chúa nhật', location: 'Nhà thờ Đức Mỹ', sortOrder: 2 },
      { dayOfWeek: 1, startTime: '05:00', massType: 'Thánh lễ ngày thường', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
      { dayOfWeek: 2, startTime: '17:30', massType: 'Thánh lễ ngày thường', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
      { dayOfWeek: 3, startTime: '05:00', massType: 'Thánh lễ ngày thường', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
      { dayOfWeek: 4, startTime: '17:30', massType: 'Thánh lễ ngày thường', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
      { dayOfWeek: 5, startTime: '05:00', massType: 'Thánh lễ ngày thường', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
      { dayOfWeek: 6, startTime: '17:30', massType: 'Thánh lễ chiều thứ Bảy', location: 'Nhà thờ Đức Mỹ', sortOrder: 1 },
    ],
  });
  await prisma.event.deleteMany();
  await prisma.event.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      title: `Sinh hoạt mục vụ tháng ${i + 8}`,
      slug: `sinh-hoat-muc-vu-${i + 1}`,
      description: 'Sự kiện minh họa, thời gian và nội dung có thể chỉnh sửa trong admin.',
      startsAt: new Date(Date.now() + (i + 1) * 7 * 86_400_000),
      location: 'Khuôn viên Giáo xứ Đức Mỹ',
      imageUrl: hero,
      isFeatured: i === 0,
    })),
  });
  await prisma.album.upsert({
    where: { slug: 'doi-song-giao-xu' },
    update: {},
    create: { title: 'Đời sống Giáo xứ Đức Mỹ', slug: 'doi-song-giao-xu', description: 'Album minh họa.', coverUrl: hero, eventDate: new Date() },
  });
  await prisma.parishProfile.deleteMany();
  await prisma.parishProfile.create({
    data: {
      name: 'Giáo xứ Đức Mỹ',
      diocese: 'Giáo phận Bà Rịa',
      patronSaint: 'Đức Maria',
      description: 'Giáo xứ Đức Mỹ là cộng đoàn hiệp nhất trong đức tin, cùng nhau sống Tin Mừng và lan tỏa yêu thương. Nội dung hiện tại là dữ liệu minh họa.',
      address: 'Địa chỉ Giáo xứ Đức Mỹ — vui lòng cập nhật',
      phone: '0000 000 000',
      email: 'giaoxuducmy@example.com',
      heroUrl: hero,
    },
  });
  await prisma.homeSection.deleteMany();
  const sections = [
    ['about', 'Giới thiệu Giáo xứ Đức Mỹ', 'FEATURED'],
    ['latest-news', 'Tin tức mới nhất', 'GRID'],
    ['announcements', 'Thông báo giáo xứ', 'LIST'],
    ['daily-word', 'Chia sẻ Lời Chúa hằng ngày', 'FEATURED'],
    ['diocese-news', 'Tin Giáo phận', 'GRID'],
    ['bible-study', 'Học hỏi Kinh Thánh', 'GRID'],
    ['catechism', 'Giáo lý', 'GRID'],
    ['events', 'Sự kiện và lịch sinh hoạt', 'SLIDER'],
    ['albums', 'Album hình ảnh', 'SLIDER'],
    ['videos', 'Video', 'GRID'],
  ];
  for (const [sortOrder, [sectionKey, title, componentType]] of sections.entries()) {
    await prisma.homeSection.create({
      data: { sectionKey: sectionKey!, title: title!, componentType: componentType!, displayLimit: 6, sortOrder, settings: {} },
    });
  }
  await prisma.setting.upsert({
    where: { key: 'site.seo' },
    update: {},
    create: { key: 'site.seo', group: 'seo', value: { title: 'Giáo xứ Đức Mỹ', description: 'Cổng thông tin Giáo xứ Đức Mỹ' } },
  });
  console.log(`Seed hoàn tất. Admin: ${email} (mật khẩu lấy từ SEED_ADMIN_PASSWORD)`);
}

main().finally(() => prisma.$disconnect());
