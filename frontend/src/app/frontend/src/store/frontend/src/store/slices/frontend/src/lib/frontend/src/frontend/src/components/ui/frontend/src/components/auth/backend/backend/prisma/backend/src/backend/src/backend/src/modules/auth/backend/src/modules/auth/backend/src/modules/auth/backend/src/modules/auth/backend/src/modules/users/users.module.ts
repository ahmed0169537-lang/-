import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { S3Service } from '../../common/services/s3.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PrismaService, RedisService, S3Service],
  exports: [UsersService],
})
export class UsersModule {}
