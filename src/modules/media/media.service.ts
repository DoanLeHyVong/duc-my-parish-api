import type { UploadApiResponse } from 'cloudinary';
import { cloudinary, cloudinaryConfigured } from '../../config/cloudinary.js';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/api-error.js';

const uploadBuffer = (buffer: Buffer, folder: string) =>
  new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ fetch_format: 'auto', quality: 'auto' }] },
      (error, result) => (error || !result ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });

export const mediaService = {
  async upload(files: Express.Multer.File[], adminId: number, folder = 'general') {
    if (!cloudinaryConfigured)
      throw new ApiError(503, 'Cloudinary chưa được cấu hình. Hãy bổ sung credentials trong .env backend.');
    const safeFolder = ['posts', 'banners', 'albums', 'general'].includes(folder) ? folder : 'general';
    const results = [];
    for (const file of files) {
      const asset = await uploadBuffer(file.buffer, `giao-xu-duc-my/${safeFolder}`);
      results.push(
        await prisma.media.create({
          data: {
            cloudinaryPublicId: asset.public_id,
            originalName: file.originalname,
            secureUrl: asset.secure_url,
            thumbnailUrl: cloudinary.url(asset.public_id, {
              width: 480,
              crop: 'fill',
              fetch_format: 'auto',
              quality: 'auto',
              secure: true,
            }),
            resourceType: asset.resource_type,
            format: asset.format,
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes,
            folder: `giao-xu-duc-my/${safeFolder}`,
            uploadedById: adminId,
          },
        }),
      );
    }
    return results;
  },
  async remove(id: number, adminId: number) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new ApiError(404, 'Không tìm thấy ảnh');
    if (!cloudinaryConfigured) throw new ApiError(503, 'Cloudinary chưa được cấu hình');
    await cloudinary.uploader.destroy(media.cloudinaryPublicId);
    await prisma.$transaction([
      prisma.media.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.auditLog.create({ data: { adminId, action: 'DELETE_MEDIA', entityType: 'media', entityId: String(id) } }),
    ]);
  },
};
