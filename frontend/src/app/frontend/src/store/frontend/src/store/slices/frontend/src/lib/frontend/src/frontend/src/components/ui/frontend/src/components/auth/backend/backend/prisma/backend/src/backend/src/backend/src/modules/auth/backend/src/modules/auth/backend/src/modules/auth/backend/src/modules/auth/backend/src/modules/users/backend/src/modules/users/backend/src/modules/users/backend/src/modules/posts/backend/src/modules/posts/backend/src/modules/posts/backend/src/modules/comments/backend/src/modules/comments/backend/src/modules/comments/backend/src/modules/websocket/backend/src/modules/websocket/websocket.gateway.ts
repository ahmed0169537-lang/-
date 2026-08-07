import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WebSocketService } from './websocket.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/',
})
export class WebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('WebSocketGateway');
  private connectedClients: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private webSocketService: WebSocketService,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from auth header
      const token = client.handshake.auth.token || client.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        this.logger.warn(`Client ${client.id} disconnected: No token provided`);
        client.disconnect();
        return;
      }

      // Verify token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      const userId = payload.userId;

      // Store client
      if (!this.connectedClients.has(userId)) {
        this.connectedClients.set(userId, new Set());
      }
      this.connectedClients.get(userId).add(client.id);

      // Store in Redis for cross-instance communication
      await this.redis.sadd(`user:sockets:${userId}`, client.id);

      // Update user status
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastLogin: new Date() },
      });

      // Join user's personal room
      client.join(`user:${userId}`);

      // Join user's notification room
      client.join(`notifications:${userId}`);

      // Send online status to friends
      await this.webSocketService.broadcastUserStatus(userId, 'online', this.server);

      this.logger.log(`Client ${client.id} connected for user ${userId}`);
      
      // Send pending messages
      await this.webSocketService.sendPendingMessages(userId, client);

    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    let userId: string | null = null;

    // Find user by client id
    for (const [uid, sockets] of this.connectedClients) {
      if (sockets.has(client.id)) {
        userId = uid;
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.connectedClients.delete(uid);
          await this.redis.srem(`user:sockets:${uid}`, client.id);
          
          // Check if user has no more connections
          const remainingSockets = await this.redis.scard(`user:sockets:${uid}`);
          if (remainingSockets === 0) {
            await this.webSocketService.broadcastUserStatus(uid, 'offline', this.server);
          }
        }
        break;
      }
    }

    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('message:send')
  @UseGuards(WsJwtGuard)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ) {
    try {
      const userId = client.data.userId;
      const { receiverId, content, groupId, mediaUrl, fileUrl, replyToId } = data;

      const message = await this.webSocketService.sendMessage({
        senderId: userId,
        receiverId,
        groupId,
        content,
        mediaUrl,
        fileUrl,
        replyToId,
      });

      // Send to receiver if online
      if (receiverId) {
        const receiverSockets = await this.redis.smembers(`user:sockets:${receiverId}`);
        if (receiverSockets.length > 0) {
          for (const socketId of receiverSockets) {
            this.server.to(socketId).emit('message:receive', message);
          }
        }
      }

      // Send to group members if group chat
      if (groupId) {
        const members = await this.webSocketService.getGroupMembers(groupId);
        for (const member of members) {
          if (member.id !== userId) {
            const memberSockets = await this.redis.smembers(`user:sockets:${member.id}`);
            for (const socketId of memberSockets) {
              this.server.to(socketId).emit('message:receive', message);
            }
          }
        }
      }

      // Send acknowledgment to sender
      client.emit('message:sent', message);

      // Send typing indicator
      if (receiverId) {
        const receiverSockets = await this.redis.smembers(`user:sockets:${receiverId}`);
        if (receiverSockets.length > 0) {
          for (const socketId of receiverSockets) {
            this.server.to(socketId).emit('user:typing', {
              userId,
              isTyping: false,
            });
          }
        }
      }

    } catch (error) {
      this.logger.error(`Error sending message: ${error.message}`);
      client.emit('message:error', { error: error.message });
    }
  }

  @SubscribeMessage('message:read')
  @UseGuards(WsJwtGuard)
  async handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string },
  ) {
    try {
      const userId = client.data.userId;
      await this.webSocketService.markMessageAsRead(data.messageId, userId);

      // Notify sender
      const message = await this.prisma.message.findUnique({
        where: { id: data.messageId },
        include: { sender: true },
      });

      if (message) {
        const senderSockets = await this.redis.smembers(`user:sockets:${message.senderId}`);
        for (const socketId of senderSockets) {
          this.server.to(socketId).emit('message:read', {
            messageId: data.messageId,
            userId,
          });
        }
      }

    } catch (error) {
      this.logger.error(`Error marking message as read: ${error.message}`);
    }
  }

  @SubscribeMessage('typing:start')
  @UseGuards(WsJwtGuard)
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId?: string; groupId?: string },
  ) {
    try {
      const userId = client.data.userId;

      if (data.receiverId) {
        const receiverSockets = await this.redis.smembers(`user:sockets:${data.receiverId}`);
        for (const socketId of receiverSockets) {
          this.server.to(socketId).emit('user:typing', {
            userId,
            isTyping: true,
            receiverId: data.receiverId,
          });
        }
      }

      if (data.groupId) {
        const members = await this.webSocketService.getGroupMembers(data.groupId);
        for (const member of members) {
          if (member.id !== userId) {
            const memberSockets = await this.redis.smembers(`user:sockets:${member.id}`);
            for (const socketId of memberSockets) {
              this.server.to(socketId).emit('user:typing', {
                userId,
                isTyping: true,
                groupId: data.groupId,
              });
            }
          }
        }
      }

    } catch (error) {
      this.logger.error(`Error handling typing start: ${error.message}`);
    }
  }

  @SubscribeMessage('typing:stop')
  @UseGuards(WsJwtGuard)
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId?: string; groupId?: string },
  ) {
    try {
      const userId = client.data.userId;

      if (data.receiverId) {
        const receiverSockets = await this.redis.smembers(`user:sockets:${data.receiverId}`);
        for (const socketId of receiverSockets) {
          this.server.to(socketId).emit('user:typing', {
            userId,
            isTyping: false,
          });
        }
      }

      if (data.groupId) {
        const members = await this.webSocketService.getGroupMembers(data.groupId);
        for (const member of members) {
          if (member.id !== userId) {
            const memberSockets = await this.redis.smembers(`user:sockets:${member.id}`);
            for (const socketId of memberSockets) {
              this.server.to(socketId).emit('user:typing', {
                userId,
                isTyping: false,
              });
            }
          }
        }
      }

    } catch (error) {
      this.logger.error(`Error handling typing stop: ${error.message}`);
    }
  }

  @SubscribeMessage('notification:read')
  @UseGuards(WsJwtGuard)
  async handleNotificationRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: string },
  ) {
    try {
      const userId = client.data.userId;
      await this.webSocketService.markNotificationAsRead(data.notificationId, userId);

    } catch (error) {
      this.logger.error(`Error marking notification as read: ${error.message}`);
    }
  }

  @SubscribeMessage('notification:read-all')
  @UseGuards(WsJwtGuard)
  async handleAllNotificationsRead(
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;
      await this.webSocketService.markAllNotificationsAsRead(userId);

    } catch (error) {
      this.logger.error(`Error marking all notifications as read: ${error.message}`);
    }
  }

  @SubscribeMessage('presence:update')
  @UseGuards(WsJwtGuard)
  async handlePresenceUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status: 'online' | 'idle' | 'dnd' | 'offline' },
  ) {
    try {
      const userId = client.data.userId;
      await this.webSocketService.broadcastUserStatus(userId, data.status, this.server);

    } catch (error) {
      this.logger.error(`Error updating presence: ${error.message}`);
    }
  }

  @SubscribeMessage('reaction:add')
  @UseGuards(WsJwtGuard)
  async handleAddReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: string; emoji: string },
  ) {
    try {
      const userId = client.data.userId;
      const reaction = await this.webSocketService.addReaction(data.messageId, userId, data.emoji);

      // Notify participants
      const message = await this.prisma.message.findUnique({
        where: { id: data.messageId },
        include: { sender: true },
      });

      if (message) {
        const participants = [message.senderId, message.receiverId].filter(Boolean);
        for (const participant of participants) {
          if (participant !== userId) {
            const sockets = await this.redis.smembers(`user:sockets:${participant}`);
            for (const socketId of sockets) {
              this.server.to(socketId).emit('reaction:added', reaction);
            }
          }
        }
      }

    } catch (error) {
      this.logger.error(`Error adding reaction: ${error.message}`);
    }
  }

  @SubscribeMessage('reaction:remove')
  @UseGuards(WsJwtGuard)
  async handleRemoveReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { reactionId: string },
  ) {
    try {
      const userId = client.data.userId;
      const result = await this.webSocketService.removeReaction(data.reactionId, userId);

      if (result) {
        // Notify participants
        const message = await this.prisma.message.findUnique({
          where: { id: result.messageId },
          include: { sender: true },
        });

        if (message) {
          const participants = [message.senderId, message.receiverId].filter(Boolean);
          for (const participant of participants) {
            if (participant !== userId) {
              const sockets = await this.redis.smembers(`user:sockets:${participant}`);
              for (const socketId of sockets) {
                this.server.to(socketId).emit('reaction:removed', {
                  reactionId: data.reactionId,
                  messageId: result.messageId,
                });
              }
            }
          }
        }
      }

    } catch (error) {
      this.logger.error(`Error removing reaction: ${error.message}`);
    }
  }
}
