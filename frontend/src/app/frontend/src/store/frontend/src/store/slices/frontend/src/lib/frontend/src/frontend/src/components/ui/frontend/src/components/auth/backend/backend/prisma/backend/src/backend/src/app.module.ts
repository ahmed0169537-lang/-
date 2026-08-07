import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PostsModule } from './modules/posts/posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StoriesModule } from './modules/stories/stories.module';
import { ReelsModule } from './modules/reels/reels.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { GroupsModule } from './modules/groups/groups.module';
import { PagesModule } from './modules/pages/pages.module';
import { EventsModule } from './modules/events/events.module';
import { SavedModule } from './modules/saved/saved.module';
import { ExploreModule } from './modules/explore/explore.module';
import { AdminModule } from './modules/admin/admin.module';
import { WebSocketModule } from './modules/websocket/websocket.module';

// Guards & Interceptors
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';

// Services
import { PrismaService } from './database/prisma.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
    }),
    AuthModule,
    UsersModule,
    PostsModule,
    CommentsModule,
    MessagesModule,
    NotificationsModule,
    StoriesModule,
    ReelsModule,
    MarketplaceModule,
    GroupsModule,
    PagesModule,
    EventsModule,
    SavedModule,
    ExploreModule,
    AdminModule,
    WebSocketModule,
  ],
  providers: [
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
