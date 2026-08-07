import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebSocketGateway } from './websocket.gateway';
import { WebSocketService } from './websocket.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { NotificationsService } from '../notifications/notifications.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    WebSocketGateway,
    WebSocketService,
    PrismaService,
    RedisService,
    NotificationsService,
  ],
  exports: [WebSocketService],
})
export class WebSocketModule {}
