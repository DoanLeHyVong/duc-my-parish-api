import type { UploadApiResponse } from 'cloudinary';
import { cloudinary, cloudinaryConfigured } from '../../config/cloudinary.js';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { logger } from '../../config/logger.js';

const uploadBuffer = (buffer: Buffer, folder: string) =>
  new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image', transformation: [{ fetch_format: 'auto', quality: 'auto' }] },
      (error, result) => (error || !result ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });

export const mediaService = {
  async upload(files: Express.Multer.File[], actorId: string, folder = 'general') {
    if (!cloudinaryConfigured)
      throw new ApiError(503, 'Cloudinary chưa được cấu hình. Hãy bổ sung credentials trong .env backend.');
    const safeFolder = ['posts', 'banners', 'albums', 'branding', 'general'].includes(folder) ? folder : 'general';
    const results = [];
    for (const file of files) {
      let asset: UploadApiResponse;
      try {
        asset = await uploadBuffer(file.buffer, `giao-xu-duc-my/${safeFolder}`);
      } catch (error) {
        const status = error && typeof error === 'object' && 'http_code' in error
          && typeof error.http_code === 'number' ? error.http_code : undefined;
        logger.error({ event: 'media_upload_failed', stage: 'cloudinary', providerStatus: status }, 'Media upload failed');
        throw status === 401 || status === 403
          ? new ApiError(503, 'Dịch vụ lưu trữ ảnh chưa sẵn sàng. Vui lòng liên hệ quản trị hệ thống.')
          : new ApiError(502, 'Không thể tải ảnh lên dịch vụ lưu trữ. Vui lòng thử lại sau.');
      }
      try {
        const thumbnailUrl = cloudinary.url(asset.public_id, {
          width: 480,
          crop: 'fill',
          fetch_format: 'auto',
          quality: 'auto',
          secure: true,
        });
        results.push(await prisma.media.create({
          data: {
            cloudinaryPublicId: asset.public_id,
            originalName: file.originalname,
            secureUrl: asset.secure_url,
            thumbnailUrl,
            resourceType: asset.resource_type,
            format: asset.format,
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes,
            folder: `giao-xu-duc-my/${safeFolder}`,
            uploadedById: actorId,
          },
        }));
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined;
        const stage = code ? 'database' : 'metadata';
        logger.error({ event: 'media_upload_failed', stage, prismaCode: code }, 'Media metadata save failed');
        try {
          await cloudinary.uploader.destroy(asset.public_id, { resource_type: 'image' });
        } catch {
          logger.error({ event: 'media_upload_cleanup_failed', stage }, 'New media asset cleanup failed');
        }
        throw new ApiError(500, 'Không thể lưu thông tin ảnh. Vui lòng thử lại sau.');
      }
    }
    return results;
  },
  async remove(id: number, actorId: string) {
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new ApiError(404, 'Không tìm thấy ảnh');
    // Published pages may still reference this URL. Hide the library entry without
    // destroying the Cloudinary object until a separate reference audit is available.
    await prisma.$transaction([
      prisma.media.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.auditLog.create({ data: { actorId, action: 'HIDE_MEDIA', entityType: 'media', entityId: String(id) } }),
    ]);
  },
};
