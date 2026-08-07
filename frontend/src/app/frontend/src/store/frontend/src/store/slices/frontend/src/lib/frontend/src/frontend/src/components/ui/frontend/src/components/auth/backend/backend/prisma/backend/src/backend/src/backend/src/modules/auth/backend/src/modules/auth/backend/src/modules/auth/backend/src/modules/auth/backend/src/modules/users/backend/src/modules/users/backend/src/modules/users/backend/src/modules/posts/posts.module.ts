import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { S3Service } from '../../common/services/s3.service';
import { NotificationsService } from '../notifications/notifications.service';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    PrismaService,
    RedisService,
    S3Service,
    NotificationsService,
  ],
})
export class PostsModule {}
