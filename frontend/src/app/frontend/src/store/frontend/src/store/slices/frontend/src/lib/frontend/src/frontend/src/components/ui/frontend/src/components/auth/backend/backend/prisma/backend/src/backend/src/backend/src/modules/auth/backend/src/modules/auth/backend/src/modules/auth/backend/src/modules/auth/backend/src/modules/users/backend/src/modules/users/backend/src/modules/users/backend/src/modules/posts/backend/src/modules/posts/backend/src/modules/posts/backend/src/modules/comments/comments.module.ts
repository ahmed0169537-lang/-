import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { NotificationsService } from '../notifications/notifications.service';

@Module({
  controllers: [CommentsController],
  providers: [
    CommentsService,
    PrismaService,
    RedisService,
    NotificationsService,
  ],
})
export class CommentsModule {}
